import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { siteText } from '../src/i18n/site-messages.js';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';

// Actual main.js functions are executed with IO/store/DOM boundaries replaced.
// This is an asynchronous commit regression, not a browser interaction test.
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1);
  const end = name === 'importPackFromFile'
    ? source.indexOf('\nasync function importPackFixture()', start) - 2
    : source.indexOf('\n}\n', start);
  assert.notEqual(end, -1);
  return source.slice(start, end + 2);
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const index = { textures: { totalPaths: 0, uniqueLowerKeys: 0 }, font: { totalPaths: 0, uniqueLowerKeys: 0 }, texts: { totalPaths: 0, uniqueLowerKeys: 0 } };
function harness({ unloadGate = null, indexGate = null } = {}) {
  const requests = [], dispatches = [], statuses = [];
  let context;
  context = vm.createContext({
    AbortController, performance, siteText,
    // Use the real clean workspace state and guard; unexpected workspace IO must fail.
    sourceWorkspace: createWorkspaceEditor({ request: async () => { throw new Error('UNEXPECTED_WORKSPACE_IO'); } }),
    store: { dispatch: (action) => dispatches.push(action) },
    actions: new Proxy({}, { get: (_, type) => (value) => ({ type, value }) }),
    setStatus: (message) => statuses.push(message), t: (key) => key, render() {},
    diagnostics: { log() {}, captureError() {} },
    importResourcePackZip: (file, options) => { const wait = deferred(); requests.push({ file, options, ...wait }); return wait.promise; },
    unloadImportedPackRuntime: async () => { context.importedPackLoadGeneration += 1; context.importedPackLoadAbortController?.abort(); context.importedPackLoadAbortController = null; context.importedPackRuntime = null; if (unloadGate) await unloadGate.promise; },
    resetUiDefsEditorState() {}, resetGlobalVarsEditorState() {}, resetScreenOpenState() {},
    packImportErrorToMessage: (error) => String(error?.message || error),
    AssetIndexer: { buildAssetIndexFromPackPathsAsync() {} },
    buildAssetIndexFromPackPathsAsync: async () => indexGate ? indexGate.promise : index,
    isLikelyMobileViewport: () => false, DEFAULT_CLASSIC_UI_SCALE: 4,
    clearTextureSidecarCache() {}, parseJsonc: (text) => ({ ok: true, value: JSON.parse(text) }),
    inferPackUiScaleFromBuildInfo: (info) => info.scale, canvasUiState: { byFileKey: {} },
    summarizeAssetIndex: () => ({}), resetLangTableRuntime() {}, resetGlobalVarNamesRuntime() {},
    requestGlobalVarNamesLoad() {}, requestUiCatalogBuild() {},
    getImportedPackDisplayName: ({ fileName }) => fileName,
    importedPackLoadGeneration: 0, importedPackLoadAbortController: null,
    importedPackLoadProgress: {}, importedPackRuntime: null,
  });
  vm.runInContext(`${extract('assertStudioExternalChange21')}\n${extract('importPackFromFile')}\n${extract('cancelImportedPackLoad')}`, context);
  return { context, requests, dispatches, statuses, start: (name = 'pack.zip') => context.importPackFromFile({ name, size: 5 }), cancel: () => context.cancelImportedPackLoad() };
}
function result({ metadata = null, name = 'pack' } = {}) {
  const tracking = { closed: 0, signal: null, reads: 0 };
  const value = { ok: true, packPaths: metadata ? ['build-info.json'] : [], rootPrefix: '', manifestSummary: { header: { uuid: name } }, fileIndex: {}, zipReader: {
    close: async () => { tracking.closed += 1; },
    readText: async (_, options) => { tracking.signal = options.signal; tracking.reads += 1; return metadata.promise; },
  } };
  return { value, tracking };
}
const successes = (h) => h.dispatches.filter((action) => action.type === 'packImportSuccess');

test('build-info読込中のcancel後に成功応答が届いてもcommitしない', async () => {
  const h = harness(), metadata = deferred(), r = result({ metadata });
  const pending = h.start(); await tick(); h.requests[0].resolve(r.value); await tick();
  assert.equal(r.tracking.reads, 1); assert.equal(h.context.importedPackRuntime, null);
  h.cancel(); assert.equal(r.tracking.signal.aborted, true);
  metadata.resolve('{"scale": 8}'); await pending;
  assert.equal(successes(h).length, 0); assert.equal(h.context.importedPackRuntime, null);
  assert.equal(r.tracking.closed, 1); assert.equal(h.context.importedPackLoadProgress.phase, 'cancelled');
});
test('build-infoがabortでrejectしても完了通知へ進まない', async () => {
  const h = harness(), metadata = deferred(), r = result({ metadata });
  const pending = h.start(); await tick(); h.requests[0].resolve(r.value); await tick();
  h.cancel(); metadata.reject(new Error('ABORTED')); await pending;
  assert.equal(successes(h).length, 0); assert.equal(r.tracking.closed, 1);
  assert.equal(h.statuses.includes('editor.import.status.importOk'), false);
});
test('新pack成功後に旧metadataが届いても新runtimeを変更しない', async () => {
  const h = harness(), metadata = deferred(), old = result({ metadata, name: 'old' });
  const first = h.start('old.zip'); await tick(); h.requests[0].resolve(old.value); await tick();
  const next = result({ name: 'new' }); const second = h.start('new.zip'); await tick(); h.requests[1].resolve(next.value); await second;
  const current = h.context.importedPackRuntime; assert.equal(current.observedUiScale, 4);
  metadata.resolve('{"scale": 8}'); await first;
  assert.equal(h.context.importedPackRuntime, current); assert.equal(current.observedUiScale, 4);
  assert.equal(successes(h).length, 1); assert.equal(old.tracking.closed, 1); assert.equal(next.tracking.closed, 0);
});
test('前pack close待ちでもcancelでき新規uploadを開始しない', async () => {
  const unloadGate = deferred(), h = harness({ unloadGate }); const pending = h.start();
  h.cancel(); unloadGate.resolve(); await pending;
  assert.equal(h.requests.length, 0); assert.equal(successes(h).length, 0);
  assert.equal(h.context.importedPackLoadProgress.phase, 'cancelled');
});
test('索引成功応答とcancelの競合でもruntimeへ登録しない', async () => {
  const indexGate = deferred(), h = harness({ indexGate }), r = result();
  const pending = h.start(); await tick(); h.requests[0].resolve(r.value); await tick();
  h.cancel(); indexGate.resolve(index); await pending;
  assert.equal(successes(h).length, 0); assert.equal(r.tracking.closed, 1);
});
test('正常metadataだけがcommitされ成功通知は一度になる', async () => {
  const h = harness(), metadata = deferred(), r = result({ metadata });
  const pending = h.start(); await tick(); h.requests[0].resolve(r.value); await tick();
  metadata.resolve('{"scale": 6}'); await pending;
  assert.equal(successes(h).length, 1); assert.equal(h.context.importedPackRuntime.observedUiScale, 6);
  assert.equal(r.tracking.closed, 0); assert.equal(h.context.importedPackLoadProgress.phase, 'complete');
});
