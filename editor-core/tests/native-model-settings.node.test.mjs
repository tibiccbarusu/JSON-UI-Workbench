import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { siteText } from '../src/i18n/site-messages.js';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';
import {
  DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS, parseNativeModelPreviewFields,
  nativeModelPreviewFields, horsePreviewOptionsKey, nativeModelPreviewStatusText,
} from '../src/ui/native-model-settings.js';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
// Evaluate the actual entrypoint's asynchronous glue with IO/DOM boundaries
// replaced. This tests its commit/abort behavior, not a copied state machine.
function sourceFunction(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} exists`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} has an entrypoint boundary`);
  return source.slice(start, end + 2);
}

function harness({ useNode = true } = {}) {
  const requests = [];
  let refreshCount = 0;
  let fontClearCount = 0;
  let textLayoutClearCount = 0;
  const context = vm.createContext({
    AbortController, siteText, DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS,
    sourceWorkspace: createWorkspaceEditor({ request: async () => { throw new Error('UNEXPECTED_WORKSPACE_IO'); } }), horsePreviewOptionsKey, nativeModelPreviewStatusText,
    bitmapFontNotices: new Set(), warnedFontLoadKeys: new Set(),
    document: { getElementById: () => null }, bitmapFontCache: { clear() { fontClearCount += 1; } },
    bitmapTextLayoutCache: { clear() { textLayoutClearCount += 1; } },
    importedPackRuntime: { zipReader: useNode ? { nodePackId: 'test-pack' } : {} }, vanillaReferenceRuntime: null,
    nativePreviewTargetEngineVersion: () => [1, 26, 40],
    nodeHorsePreview: (sources, targetEngineVersion, signal, options) => new Promise((resolve, reject) => requests.push({ sources, targetEngineVersion, signal, options, resolve, reject, transport: 'node' })),
    loadHorsePreviewFromSources: (args) => new Promise((resolve, reject) => requests.push({ ...args, options: { previewState: args.previewState, camera: args.camera }, resolve, reject, transport: 'local' })),
    buildEnchantingBookPreviewScene: (options) => ({ kind: 'book', openingDegrees: options.openingDegrees }),
    requestCanvasTextureMetadataRefresh: () => { refreshCount += 1; },
    scheduleReferenceContextRevalidation() {}, markPreviewContextMutation() {}, safeRender() {}, requestCanvasTextureRedraw() {},
  });
  vm.runInContext(`
    let nativeHorsePreviewEpoch = 0;
    let nativeHorsePreviewAbortController = null;
    let nativeHorsePreviewState = { status: 'idle' };
    let nativeModelPreviewOptions = DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS;
    const nativeModelPreviewUiState = { error: '' };
    let enchantingBookPreviewScene = { kind: 'book', openingDegrees: 130 };
    ${sourceFunction('clearNativeHorsePreviewCache')}
    ${sourceFunction('loadHorsePreviewFromPackStack')}
    ${sourceFunction('requestNativeHorsePreview')}
    ${sourceFunction('assertStudioExternalChange21')}
    ${sourceFunction('applyNativeModelPreviewOptions')}
    globalThis.api = {
      request: requestNativeHorsePreview,
      apply: applyNativeModelPreviewOptions,
      clear: clearNativeHorsePreviewCache,
      state: () => nativeHorsePreviewState,
      epoch: () => nativeHorsePreviewEpoch,
      book: () => enchantingBookPreviewScene,
    };
  `, context);
  return { api: context.api, requests, refreshCount: () => refreshCount, fontClearCount: () => fontClearCount,
    textLayoutClearCount: () => textLayoutClearCount };
}

function changedOptions(patch = {}) {
  const result = parseNativeModelPreviewFields({ ...nativeModelPreviewFields(), ...patch });
  assert.equal(result.ok, true);
  return result.options;
}

test('表示条件は境界内の不変snapshotへ変換する', () => {
  const options = changedOptions({ variant: '31', markVariant: '31', yaw: '-180', pitch: '89', bookOpeningDegrees: '20' });
  assert.equal(options.previewState.variant, 31);
  assert.equal(options.camera.yaw, -180);
  assert.equal(Object.isFrozen(options), true);
  assert.equal(Object.isFrozen(options.previewState), true);
  assert.equal(Object.isFrozen(options.camera), true);
});

test('空欄・小数番号・範囲外・不正booleanを拒否する', () => {
  for (const patch of [
    { variant: '' }, { variant: '1.5' }, { markVariant: 32 }, { variant: -1 },
    { yaw: Infinity }, { yaw: 181 }, { pitch: -90 },
    { isSaddled: 'false' }, { bookOpeningDegrees: 19 }, { bookOpeningDegrees: NaN },
  ]) assert.equal(parseNativeModelPreviewFields({ ...nativeModelPreviewFields(), ...patch }).ok, false, JSON.stringify(patch));
});

test('同じ条件の同時要求を重複送信しない', async () => {
  const h = harness();
  const first = h.api.request();
  const second = h.api.request();
  assert.equal(first.promise, second.promise);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ status: 'ready', scene: { id: 'only' } });
  await first.promise;
  assert.equal(h.api.request().scene.id, 'only');
  assert.equal(h.requests.length, 1);
});

test('新しい設定の完了後に古い応答が届いても置換しない', async () => {
  const h = harness();
  const old = h.api.request();
  h.api.apply(changedOptions({ variant: 2, yaw: 148 }));
  const current = h.api.request();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests[1].options.previewState.variant, 2);
  assert.equal(h.requests[1].options.camera.yaw, 148);
  h.requests[1].resolve({ status: 'ready', scene: { id: 'new' } });
  await current.promise;
  h.requests[0].resolve({ status: 'ready', scene: { id: 'old' } });
  await old.promise;
  assert.equal(h.api.state().scene.id, 'new');
  assert.equal(h.refreshCount(), 1);
});

test('古い要求の失敗も新しい結果を上書きしない', async () => {
  const h = harness();
  const old = h.api.request();
  h.api.apply(changedOptions({ isSaddled: true, hasRider: true }));
  const current = h.api.request();
  h.requests[1].resolve({ status: 'ready', scene: { id: 'new' } });
  await current.promise;
  h.requests[0].reject(new Error('late failure'));
  await old.promise;
  assert.equal(h.api.state().status, 'ready');
  assert.equal(h.api.state().scene.id, 'new');
});

test('パック解除後に旧応答でモデルが復活しない', async () => {
  const h = harness();
  const old = h.api.request();
  h.api.clear();
  h.requests[0].resolve({ status: 'ready', scene: { id: 'old' } });
  await old.promise;
  assert.equal(h.api.state().status, 'idle');
  assert.equal(h.api.state().scene, null);
});

test('パックにない番号は失敗を維持し、変更すると再要求できる', async () => {
  const h = harness();
  h.api.apply(changedOptions({ variant: 31 }));
  const pending = h.api.request();
  h.requests[0].resolve({ status: 'invalid', issue: 'NATIVE_PREVIEW_VARIANT_OUT_OF_RANGE' });
  await pending.promise;
  assert.equal(h.api.request().status, 'invalid');
  assert.equal(h.requests.length, 1);
  assert.match(nativeModelPreviewStatusText(h.api.state()), /別の番号/);
  h.api.apply(changedOptions({ variant: 1 }));
  const next = h.api.request();
  h.requests[1].resolve({ status: 'ready', scene: { id: 'valid' } });
  await next.promise;
  assert.equal(h.api.state().scene.id, 'valid');
});

test('既存ローカルfallbackにも同じ明示設定を渡す', async () => {
  const h = harness({ useNode: false });
  h.api.apply(changedOptions({ markVariant: 3, pitch: -25 }));
  const pending = h.api.request();
  assert.equal(h.requests[0].transport, 'local');
  assert.equal(h.requests[0].options.previewState.markVariant, 3);
  assert.equal(h.requests[0].options.camera.pitch, -25);
  h.requests[0].resolve({ status: 'ready', scene: { id: 'fallback' } });
  await pending.promise;
  assert.equal(h.api.state().scene.id, 'fallback');
});

test('本の開き角度だけの変更では馬の要求を破棄しない', async () => {
  const h = harness();
  const horse = h.api.request();
  const epoch = h.api.epoch();
  h.api.apply(changedOptions({ bookOpeningDegrees: 90 }));
  assert.equal(h.api.epoch(), epoch);
  assert.equal(h.requests[0].signal.aborted, false);
  assert.equal(h.api.book().openingDegrees, 90);
  h.requests[0].resolve({ status: 'ready', scene: { id: 'horse' } });
  await horse.promise;
  assert.equal(h.api.state().scene.id, 'horse');
});

test('馬鎧だけの変更でも旧応答を破棄し新しいNode snapshotを要求する', async () => {
  const h = harness();
  const old = h.api.request();
  h.api.apply(changedOptions({ armorVariant: 2 }));
  const current = h.api.request();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests[1].options.previewState.armorVariant, 2);
  h.requests[1].resolve({ status: 'ready', scene: { id: 'iron' } });
  await current.promise;
  h.requests[0].resolve({ status: 'ready', scene: { id: 'none' } });
  await old.promise;
  assert.equal(h.api.state().scene.id, 'iron');
  assert.match(nativeModelPreviewStatusText({ status: 'invalid', issue: 'NATIVE_PREVIEW_ARMOR_OUT_OF_RANGE' }), /馬鎧番号/);
  assert.match(nativeModelPreviewStatusText({ status: 'invalid', issue: 'NATIVE_PREVIEW_ARMOR_MATERIAL_UNSUPPORTED' }), /染色/);
});

test('モデル条件変更でフォントを破棄せず、パック解除時は破棄する', () => {
  const h = harness();
  h.api.apply(changedOptions({ variant: 1 }));
  assert.equal(h.fontClearCount(), 0);
  assert.equal(h.textLayoutClearCount(), 0);
  h.api.clear();
  assert.equal(h.fontClearCount(), 1);
  assert.equal(h.textLayoutClearCount(), 1);
});

test('連続した解除と変更の後も古いsnapshotを採用しない', async () => {
  const h = harness();
  const pending = [h.api.request()];
  h.api.clear();
  h.api.clear();
  h.api.apply(changedOptions({ variant: 1 }));
  pending.push(h.api.request());
  h.api.apply(changedOptions({ variant: 2 }));
  pending.push(h.api.request());
  h.requests[2].resolve({ status: 'ready', scene: { id: 'latest' } });
  await pending[2].promise;
  h.requests[1].resolve({ status: 'ready', scene: { id: 'middle' } });
  h.requests[0].resolve({ status: 'ready', scene: { id: 'first' } });
  await Promise.all(pending.slice(0, 2).map((state) => state.promise));
  assert.equal(h.api.state().scene.id, 'latest');
  assert.equal(h.api.state().previewState.variant, 2);
  assert.equal(h.refreshCount(), 1);
});
