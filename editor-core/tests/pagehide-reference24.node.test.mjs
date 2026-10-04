import { createNodeRequestLog35 } from '../src/diagnostics/node-request-log35.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { studioProgressModel26 } from '../src/ui/editor-arrangement26.js';
import { readFile } from 'node:fs/promises';
import { createAppStore, actions } from '../src/state-store/app-store.js';

// 実mainの参照検証関数と実lifecycle登録行を抽出する。製品hook/私有状態の改変なし。
// DOM/時刻/HTTPだけを境界adapterにし、storeは実createAppStoreを使用する。
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const remoteSource = await readFile(new URL('../src/pack-io/node-remote-client.js', import.meta.url), 'utf8');
function fn(name, optional = false) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  if (start < 0 && optional) return '';
  assert(start >= 0, name);
  const end = source.indexOf('\n}\n', start); assert(end >= 0, name + ' boundary');
  return source.slice(start, end + 2);
}
function clock() {
  let now = 0, sequence = 0; const timers = new Map();
  const due = () => { let count = 0; while (true) { const row = [...timers].find(([, t]) => t.at <= now); if (!row) break; assert(++count < 100, 'bounded clock'); timers.delete(row[0]); row[1].callback(); } };
  return { setTimeout(callback, ms = 0) { const id = ++sequence; timers.set(id, { at: now + ms, callback }); return id; }, clearTimeout(id) { timers.delete(id); }, due, advance(ms) { now += ms; due(); }, size: () => timers.size };
}
function fixture({ ignoreAbort = false } = {}) {
  const store = createAppStore(), file = { id: 'screen', path: 'ui/main.json', kind: 'screen', uiModel: { marker: 1 }, nodesById: {},
    meta: { resolution: { nodeProjectionId: 'a'.repeat(64) }, selectedDefinition: { recordId: 'main' } } };
  store.dispatch(actions.openFile(file));
  const time = clock(), listeners = new Map(), calls = [], errors = [], workspace = { blocked: false };
  // 参照再検証の250ms timerと独立した、実進捗intervalの時刻adapter。
  const intervals = new Map(); let intervalId = 0;
  const window = { addEventListener(type, callback) { const list = listeners.get(type) || []; list.push(callback); listeners.set(type, list); } };
  const context = vm.createContext({ store, actions, studioProgressModel26, document: { getElementById: () => null }, setInterval(callback, ms) { const id = ++intervalId; intervals.set(id, { callback, ms }); return id; }, clearInterval(id) { intervals.delete(id); }, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    AbortController, AbortSignal, window, sourceWorkspace: { state: { workspaceId: 'workspace' }, previewBlocked: () => workspace.blocked },
    nativeHorsePreviewState: { status: 'idle' }, nativePlayerPreviewState: { status: 'idle' }, nativeTextureFailureCodes: new Map(), MAX_NATIVE_TEXTURE_FAILURE_CODES: 32,
    nodeValidatePreview(request, signal) { return new Promise((resolve, reject) => { const call = { request, signal, resolve, reject }; calls.push(call); if (!ignoreAbort) signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true }); }); },
    diagnostics: { captureError: error => errors.push(error.message) }, siteText: (parts, ...values) => typeof parts === 'string' ? parts : parts.reduce((s, p, i) => s + p + (values[i] || ''), ''),
    previewPlayback: { pause() {} }, stopNativeMotionPreview() {}, scheduledWorkspaceRender: { cancel() {} }, scheduledPreviewDataRender: { cancel() {} },
    validateUiScreenModel() { throw new Error('unexpected local validation'); },
  });
  const variables = [...source.matchAll(/^let (?:referenceRevalidation\w*|validationRunActive|validationPending|validationGeneration|referenceValidationAbort) = [^\n]+;/gm)].map(x => x[0]).join('\n');
  const functions = ['getOpenFilesList', 'validationContentKey', 'scheduleReferenceContextRevalidation', 'suspendReferenceContextRevalidation', 'resumeReferenceContextRevalidation', 'revalidateScreenFiles', 'revalidateOpenScreenFiles', 'revalidateCurrentScreenFile'].map(name => fn(name, name.startsWith('suspend') || name.startsWith('resume'))).join('\n');
  const bindings = source.split('\n').filter(line => line.includes("window.addEventListener('pagehide'") && (line.includes('scheduledWorkspaceRender.cancel()') || line.includes('studioProgressTimer26')) || line.includes("window.addEventListener('pageshow'")).join('\n');
  const progressStart = source.indexOf('const studioActivities26 ='), progressEnd = source.indexOf('const sourceWorkspace = createWorkspaceEditor(', progressStart); assert(progressStart >= 0 && progressEnd > progressStart);
  const progress = source.slice(progressStart, progressEnd);
  vm.runInContext(`${progress}\n${variables}\n${functions}\n${bindings}\nthis.api={schedule:scheduleReferenceContextRevalidation,validate:revalidateOpenScreenFiles};`, context);
  const flush = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); time.due(); } };
  const emit = (type, event) => { for (const callback of listeners.get(type) || []) callback(event); };
  const finish = async (index, marker = 'fresh') => { calls[index].resolve({ validation: { ok: true, marker } }); await flush(); };
  return { store, calls, errors, workspace, time, intervals, emit, flush, finish, api: context.api, validation: () => store.getState().files.byId.screen.validation };
}

test('表示中は250msの重複予約をまとめて実storeへ検証結果を反映する', async () => {
  const h = fixture(); h.api.schedule(); h.api.schedule(); assert.equal(h.time.size(), 1); h.time.advance(249); assert.equal(h.calls.length, 0); h.time.advance(1); await h.flush(); assert.equal(h.calls.length, 1); await h.finish(0); assert.equal(h.validation().marker, 'fresh'); assert.equal(h.errors.length, 0);
});
test('pagehideは待機timerを取消し旧予約からHTTPを送らない', async () => {
  const h = fixture(); h.api.schedule(); h.emit('pagehide', {}); assert.equal(h.time.size(), 0); h.time.advance(500); await h.flush(); assert.equal(h.calls.length, 0);
});
test('pagehide後の素材完了callbackによる再予約と直接検証を抑止する', async () => {
  const h = fixture(); h.emit('pagehide', {}); h.api.schedule(); h.api.validate(); h.time.advance(500); await h.flush(); assert.equal(h.time.size(), 0); assert.equal(h.calls.length, 0);
});
test('実行中検証のAbortSignalをpagehideで中断し診断へ古い失敗を残さない', async () => {
  const h = fixture(); h.api.validate(); await h.flush(); assert.equal(h.calls.length, 1); h.emit('pagehide', {}); assert.equal(h.calls[0].signal.aborted, true); await h.flush(); assert.equal(h.errors.length, 0); assert.equal(h.validation(), undefined);
});
test('中断を無視する遅い成功応答もpagehideの世代失効によりstoreへ反映しない', async () => {
  const h = fixture({ ignoreAbort: true }); h.api.validate(); await h.flush(); h.emit('pagehide', {}); await h.finish(0, 'old'); assert.equal(h.validation(), undefined); assert.equal(h.errors.length, 0);
});
test('BFCacheからのpageshowは1回だけ予約して正常な再検証を再開する', async () => {
  const h = fixture(); h.api.schedule(); h.emit('pagehide', { persisted: true }); assert.equal(h.time.size(), 0); h.emit('pageshow', { persisted: true }); h.emit('pageshow', { persisted: true }); assert.equal(h.time.size(), 1); h.time.advance(250); await h.flush(); assert.equal(h.calls.length, 1); await h.finish(0, 'resumed'); h.emit('pageshow', { persisted: true }); assert.equal(h.time.size(), 0); assert.equal(h.validation().marker, 'resumed');
});
test('BFCache復帰後に古い無視応答が到着しても新しい世代だけを採用する', async () => {
  const h = fixture({ ignoreAbort: true }); h.api.validate(); await h.flush(); h.emit('pagehide', { persisted: true }); h.emit('pageshow', { persisted: true }); h.time.advance(250); await h.flush(); await h.finish(0, 'old'); assert.equal(h.validation(), undefined); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].signal.aborted, false); await h.finish(1, 'new'); assert.equal(h.validation().marker, 'new');
});
test('通常離脱後のpageshow非persistedとevent未指定は検証を再開しない', async () => {
  const h = fixture(); h.emit('pagehide'); h.emit('pageshow'); h.emit('pageshow', { persisted: false }); h.api.schedule(); h.time.advance(500); await h.flush(); assert.equal(h.calls.length, 0);
});
test('通常編集のpreviewBlockedを保持し解除後は再検証できる', async () => {
  const h = fixture(); h.workspace.blocked = true; h.api.schedule(); h.time.advance(250); await h.flush(); assert.equal(h.calls.length, 0); h.workspace.blocked = false; h.api.schedule(); h.time.advance(250); await h.flush(); assert.equal(h.calls.length, 1); await h.finish(0); assert.equal(h.validation().marker, 'fresh');
});
test('表示中でも別モデルへ切替済みの古い結果を反映しない', async () => {
  const h = fixture(); h.api.validate(); await h.flush(); h.store.dispatch(actions.patchFile({ fileId: 'screen', patch: { uiModel: { marker: 2 } } })); await h.finish(0, 'old'); assert.equal(h.validation(), undefined);
});

async function remoteFixture() {
  const listeners = new Map(), requests = [];
  const context = vm.createContext({ createNodeRequestLog35, AbortController, AbortSignal, Blob, File, TextDecoder, URLSearchParams, crypto,
    window: { addEventListener(type, callback) { listeners.set(type, callback); } },
    createFrameDeltaClient: () => ({}), createNodeReadQueue: () => ({ run: task => task() }), waitForNodeReadRetry: async () => {}, workspaceExportError: () => new Error('unexpected export'),
    fetch: async (url, options = {}) => { requests.push({ url, method: options.method || 'GET' }); let data = {};
      if (url.endsWith('/capabilities')) data = { protocol: 'jsonui-node/v1', token: 'test-token' };
      else if (url.endsWith('/packs') && options.method === 'POST') data = { id: options.headers['X-JSONUI-Upload-ID'], zipMeta: { fileName: 'fixture.zip', entryCount: 0 }, entries: [] };
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data }; },
  });
  const program = remoteSource.replace(/^import .*;\n/gm, '').replace(/\bexport (?=(?:async )?function|class|const)/g, '');
  vm.runInContext(`${program}\nthis.api={import:tryNodeImport};`, context);
  await context.api.import(new File(['fixture'], 'fixture.zip'));
  return { emit: event => listeners.get('pagehide')(event), requests, flush: async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); } };
}
test('Node clientはpersisted pagehideで復帰用packをDELETEしない', async () => {
  const h = await remoteFixture(); h.emit({ persisted: true }); await h.flush(); assert.equal(h.requests.filter(x => x.method === 'DELETE').length, 0);
});
test('Node clientは通常pagehideで従来どおりpackをDELETEする', async () => {
  const h = await remoteFixture(); h.emit({ persisted: false }); await h.flush(); assert.equal(h.requests.filter(x => x.method === 'DELETE').length, 1);
});
test('Node clientのevent未指定入口も例外なく通常cleanupする', async () => {
  const h = await remoteFixture(); h.emit(); await h.flush(); assert.equal(h.requests.filter(x => x.method === 'DELETE').length, 1);
});

test('進捗監視intervalはpageshow重複で増殖せずpagehideで解除し、参照検証timerとは独立する', () => {
  const h = fixture(); h.emit('pageshow', { persisted: true }); h.emit('pageshow', { persisted: true });
  assert.equal(h.intervals.size, 1); assert.equal([...h.intervals.values()][0].ms, 1000);
  for (const timer of h.intervals.values()) assert.doesNotThrow(() => timer.callback());
  h.emit('pagehide', { persisted: true }); assert.equal(h.intervals.size, 0); assert.equal(h.time.size(), 0);
  h.emit('pageshow', { persisted: true }); assert.equal(h.intervals.size, 1);
});
