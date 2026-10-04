import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserDefaultPlayerRuntime } from '../src/preview/native-player-browser.js';
import { DEFAULT_PLAYER_ASSET_BASE, DEFAULT_PLAYER_TEXTURE_REF, resolveDefaultPlayerTexture } from '../src/preview/native-player-default.js';

const asset = 'textures/entity/steve.png';
// Transport/size tests only: deterministic synthetic bytes, not a game texture.
const bytes = Uint8Array.from({ length: 1379 }, (_, index) => index % 251);
const read = runtime => runtime.zipReader.readBlob(asset, { mimeType: 'image/png' });

test('ブラウザ既定Steveは固定同origin URLだけを期限付きstreamで読み込む', async () => {
  const calls = [];
  const runtime = createBrowserDefaultPlayerRuntime({ async fetchImpl(url, options) {
    calls.push({ url, options }); return new Response(bytes);
  } });
  const blob = await read(runtime);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  assert.equal(calls.length, 1); assert.equal(calls[0].url.href, new URL(asset, DEFAULT_PLAYER_ASSET_BASE).href);
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.credentials, 'same-origin');
  assert.ok(calls[0].options.signal.aborted, 'completed read also cleans up its transport signal');
  await assert.rejects(runtime.zipReader.readBlob('https://example.com/skin.png'), /PATH_INVALID/);
  assert.equal(calls.length, 1);
});

test('headers取得が永遠に止まっても全体deadlineで中断する', async () => {
  const start = performance.now();
  const runtime = createBrowserDefaultPlayerRuntime({ timeoutMs: 20, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(read(runtime), /READ_TIMEOUT/);
  assert.ok(performance.now() - start < 1000);
});

test('body取得とcancelが永遠に止まってもdeadline後に解放して返る', async () => {
  let cancelled = 0, released = 0;
  const runtime = createBrowserDefaultPlayerRuntime({ timeoutMs: 20, async fetchImpl() {
    return { ok: true, headers: { get: () => null }, body: { getReader: () => ({
      read: () => new Promise(() => {}), cancel() { cancelled++; return new Promise(() => {}); },
      releaseLock() { released++; },
    }) } };
  } });
  await assert.rejects(read(runtime), /READ_TIMEOUT/);
  assert.equal(cancelled, 1); assert.equal(released, 1);
});

test('外部abortはheader待ちとbody待ちを中断する', async () => {
  for (const stage of ['headers', 'body']) {
    const controller = new AbortController();
    const runtime = createBrowserDefaultPlayerRuntime({ timeoutMs: 500, fetchImpl: () => stage === 'headers'
      ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({}))) });
    const promise = runtime.zipReader.readBlob(asset, { signal: controller.signal });
    const abort = setTimeout(() => controller.abort(), 10);
    try { await assert.rejects(promise, /NATIVE_PREVIEW_ABORTED/); } finally { clearTimeout(abort); }
  }
});

test('過大header/body、破損サイズ、不正HTTPとstream不在を拒否する', async () => {
  const cases = [
    [() => new Response(bytes, { headers: { 'content-length': String(bytes.length + 1) } }), /READ_LIMIT/],
    [() => new Response(new Uint8Array(bytes.length + 1)), /READ_LIMIT/],
    [() => new Response(bytes.subarray(1)), /ASSET_INVALID/],
    [() => new Response(null, { status: 404 }), /HTTP_404/],
    [() => ({ ok: true, headers: { get: () => null }, body: null }), /STREAM_UNAVAILABLE/],
  ];
  for (const [response, error] of cases) {
    const runtime = createBrowserDefaultPlayerRuntime({ fetchImpl: async () => response() });
    await assert.rejects(read(runtime), error);
  }
});

test('空chunkの連発はdeadlineをstarveさせず有限回数で拒否する', async () => {
  let reads = 0;
  const runtime = createBrowserDefaultPlayerRuntime({ fetchImpl: async () => ({ ok: true, headers: { get: () => null },
    body: { getReader: () => ({ read() { reads++; return Promise.resolve({ done: false, value: new Uint8Array() }); },
      cancel() {}, releaseLock() {} }) } }) });
  await assert.rejects(read(runtime), /STREAM_WORK_LIMIT/);
  assert.equal(reads, bytes.length + 32);
});

test('既定Steveのtexture補完は明示した来歴と正確なrefだけに適用する', () => {
  const missing = { ok: true, kind: 'texture', resolved: null, collision: null };
  const preview = { status: 'ready', provenance: { defaultPlayerStatus: 'BUNDLED_ORIGINAL_STEVE_REFERENCE' } };
  const result = resolveDefaultPlayerTexture(missing, DEFAULT_PLAYER_TEXTURE_REF, preview);
  assert.equal(result.resolved.source, 'default-player'); assert.equal(result.resolved.packPath, asset);
  assert.equal(missing.resolved, null);
  for (const ref of ['textures/entity/custom', 'textures/entity/steve.png', 'textures/../entity/steve']) {
    assert.equal(resolveDefaultPlayerTexture(missing, ref, preview), missing);
  }
  for (const state of [undefined, { status: 'missing' }, { status: 'ready', provenance: { defaultPlayerStatus: 'PACK_RESOURCES' } }]) {
    assert.equal(resolveDefaultPlayerTexture(missing, DEFAULT_PLAYER_TEXTURE_REF, state), missing);
  }
  for (const state of [{ ...missing, resolved: { source: 'imported' } }, { ...missing, collision: {} }, { ok: false }]) {
    assert.equal(resolveDefaultPlayerTexture(state, DEFAULT_PLAYER_TEXTURE_REF, preview), state);
  }
});
