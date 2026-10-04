import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureImageCache, decodeImageFromBlob } from '../src/assets/texture-image-cache.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function replace(t, target, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  t.after(() => descriptor ? Object.defineProperty(target, key, descriptor) : delete target[key]);
}
function pngBlob() {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, 1); new DataView(bytes.buffer).setUint32(20, 1);
  return new Blob([bytes], { type: 'image/png' });
}
const pixel = close => ({ image: { close }, width: 1, height: 1, decodedBytes: 4 });

test('直接bitmapは未完了でも外部取消へ応答し、遅れて返ったbitmapを一度だけ閉じる', { timeout: 2000 }, async t => {
  let complete, started, closes = 0;
  const ready = new Promise(resolve => started = resolve);
  replace(t, globalThis, 'createImageBitmap', () => new Promise(resolve => { complete = resolve; started(); }));
  const controller = new AbortController();
  const request = decodeImageFromBlob(pngBlob(), { signal: controller.signal });
  const observed = request.then(() => 'unexpected', error => error.message);
  await ready; controller.abort();
  assert.equal(await Promise.race([observed, pause(250).then(() => 'still-pending')]), 'IMAGE_CACHE_ABORTED');
  complete({ width: 1, height: 1, close() { closes++; } }); await pause(0);
  assert.equal(closes, 1);
});

test('bitmap無応答は明示timeoutで終了し、遅い失敗を未処理例外にしない', { timeout: 2000 }, async t => {
  let fail;
  replace(t, globalThis, 'createImageBitmap', () => new Promise((resolve, reject) => fail = reject));
  await assert.rejects(decodeImageFromBlob(pngBlob(), { decodeTimeoutMs: 20 }), { name: 'TimeoutError', code: 'IMAGE_DECODE_TIMEOUT' });
  fail(new Error('late-host-failure')); await pause(0);
});

test('PNG寸法取得の無応答も同じ期限に含み、遅いbytesから復号を始めない', { timeout: 2000 }, async t => {
  let complete, decodes = 0;
  replace(t, globalThis, 'createImageBitmap', () => { decodes++; return pixel(() => {}).image; });
  const original = pngBlob();
  const stalled = { size: original.size, type: original.type, slice: () => ({ arrayBuffer: () => new Promise(resolve => complete = resolve) }) };
  await assert.rejects(decodeImageFromBlob(stalled, { decodeTimeoutMs: 20 }), { code: 'IMAGE_DECODE_TIMEOUT' });
  complete(await original.arrayBuffer()); await pause(0); assert.equal(decodes, 0);
});

test('HTML画像の無応答は期限でsrc/listener/Blob URLを解放する', { timeout: 2000 }, async t => {
  let element; const assigned = [], revoked = [];
  replace(t, globalThis, 'Image', class { constructor() { element = this; } set src(value) { assigned.push(value); } });
  replace(t, URL, 'createObjectURL', () => 'blob:deadline');
  replace(t, URL, 'revokeObjectURL', value => revoked.push(value));
  await assert.rejects(decodeImageFromBlob(pngBlob(), { preferImageBitmap: false, decodeTimeoutMs: 20 }), { code: 'IMAGE_DECODE_TIMEOUT' });
  await pause(0);
  assert.equal(element.onload, null); assert.equal(element.onerror, null);
  assert.deepEqual(assigned, ['blob:deadline', '']); assert.deepEqual(revoked, ['blob:deadline']);
});

test('TGAからのbitmap生成も同じ期限で終了しlate bitmapを回収する', { timeout: 2000 }, async t => {
  let complete, closes = 0;
  replace(t, globalThis, 'OffscreenCanvas', class { getContext() { return { createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} }; } });
  replace(t, globalThis, 'createImageBitmap', () => new Promise(resolve => complete = resolve));
  const bytes = new Uint8Array(21); bytes[2] = 2; bytes[12] = 1; bytes[14] = 1; bytes[16] = 24;
  await assert.rejects(decodeImageFromBlob(new Blob([bytes], { type: 'image/tga' }), { decodeTimeoutMs: 20 }), { code: 'IMAGE_DECODE_TIMEOUT' });
  complete({ close() { closes++; } }); await pause(0); assert.equal(closes, 1);
});

test('loader無応答を期限で記録し予約を戻す。後続は予約取得から完全な期限を持つ', { timeout: 2000 }, async t => {
  const cache = createTextureImageCache({ maxConcurrentDecodes: 1, perImageMaxPixels: 1, perImageMaxDecodedBytes: 4,
    maxDecodedBytesTotal: 8, maxInflightDecodedBytes: 4, loadTimeoutMs: 30 }); t.after(() => cache.clear());
  let complete, signal, closes = 0, calls = 0;
  const held = cache.load('held', context => { signal = context.signal; return new Promise(resolve => complete = resolve); });
  const rejected = assert.rejects(held, { name: 'TimeoutError', code: 'IMAGE_CACHE_LOAD_TIMEOUT' });
  const next = cache.load('next', async () => { calls++; await pause(20); return pixel(() => {}); });
  await rejected; assert.equal(signal.aborted, true);
  assert.equal((await next).decodedBytes, 4); assert.equal(calls, 1);
  assert.equal(cache.stats().activeDecodes, 0); assert.equal(cache.stats().queuedDecodes, 0);
  assert.equal(cache.stats().inflight, 0); assert.equal(cache.stats().inflightReservedDecodedBytes, 0);
  assert.equal(cache.getFailure('held').code, 'IMAGE_CACHE_LOAD_TIMEOUT');
  await assert.rejects(cache.load('held', () => { calls++; return pixel(() => {}); }), /IMAGE_CACHE_RECENT_FAILURE:IMAGE_CACHE_LOAD_TIMEOUT/u);
  assert.equal(calls, 1);
  complete(pixel(() => { closes++; })); await pause(0); assert.equal(closes, 1);
});

test('成功した復号には後から期限が作用せず、返した画像の所有を奪わない', { timeout: 2000 }, async t => {
  let closes = 0;
  replace(t, globalThis, 'createImageBitmap', async () => ({ width: 1, height: 1, close() { closes++; } }));
  const result = await decodeImageFromBlob(pngBlob(), { decodeTimeoutMs: 10 });
  await pause(20); assert.equal(result.decodedBytes, 4); assert.equal(closes, 0);
  result.image.close(); assert.equal(closes, 1);
});
