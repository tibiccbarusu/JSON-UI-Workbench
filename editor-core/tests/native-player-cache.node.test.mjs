import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { siteText } from '../src/i18n/site-messages.js';
const source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start); return source.slice(start, end + 2);
}
function harness({ loggerFails = false } = {}) {
  const requests = []; let refreshes = 0;
  const context = vm.createContext({ AbortController, siteText, importedPackRuntime: { zipReader: { nodePackId: 'pack' } }, vanillaReferenceRuntime: null,
    nativePreviewTargetEngineVersion: () => [1, 26, 45],
    nodePlayerPreview: (sources, target, signal, options) => new Promise((resolve, reject) => requests.push({ sources, target, signal, options, resolve, reject })),
    diagnostics: { log() { if (loggerFails) throw new Error('logger'); }, captureError() {} },
    requestCanvasTextureMetadataRefresh() { refreshes++; }, scheduleReferenceContextRevalidation() {},
  });
  vm.runInContext(`let nativePlayerPreviewEpoch=0,nativePlayerPreviewController=null,nativePlayerPreviewState={status:'idle',scene:null};
    ${fn('clearNativePlayerPreviewCache')}
    ${fn('requestNativePlayerPreview')}
    globalThis.api={request:requestNativePlayerPreview,clear:clearNativePlayerPreviewCache,state:()=>nativePlayerPreviewState};`, context);
  return { api: context.api, requests, refreshes: () => refreshes };
}
test('playerの重複要求は1回にまとまり解除後の遅延応答を無視する', async () => {
  const h = harness(), first = h.api.request(), duplicate = h.api.request();
  assert.equal(first.promise, duplicate.promise); assert.equal(h.requests.length, 1);
  h.api.clear(); assert.equal(h.requests[0].signal.aborted, true);
  const current = h.api.request();
  h.requests[1].resolve({ status: 'ready', scene: { id: 'new' } }); await current.promise;
  h.requests[0].resolve({ status: 'ready', scene: { id: 'old' } }); await first.promise;
  assert.equal(h.api.state().scene.id, 'new'); assert.equal(h.refreshes(), 1);
});
test('playerの古い失敗とログ失敗で現行の有効modelを破棄しない', async () => {
  const h = harness({ loggerFails: true }), first = h.api.request(); h.api.clear();
  const current = h.api.request(); h.requests[1].resolve({ status: 'ready', scene: { id: 'new' } }); await current.promise;
  h.requests[0].reject(new Error('late')); await first.promise;
  assert.equal(h.api.state().status, 'ready'); assert.equal(h.api.state().scene.id, 'new');
});
test('player source失敗は診断状態として保持し解除後に再要求できる', async () => {
  const h = harness(), first = h.api.request(); h.requests[0].reject(new Error('source unavailable')); await first.promise;
  assert.equal(h.api.state().status, 'invalid'); h.api.request(); assert.equal(h.requests.length, 1);
  h.api.clear(); const second = h.api.request(); assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ status: 'missing', issue: 'NATIVE_PREVIEW_MODEL_MISSING' }); await second.promise;
  assert.equal(h.api.state().status, 'missing');
});
