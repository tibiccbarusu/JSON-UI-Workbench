import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpPackSource } from '../../editor-core/src/pack-io/http-pack-source.js';
import '../../editor-core/tests/suite-security.js';
import { getRegisteredTests } from '../../editor-core/tests/test-harness.js';

const response = extra => ({ status: 200, ok: true, url: 'https://trusted.example/pack/ui/test.json', headers: { get: () => null }, ...extra });
const source = extra => new HttpPackSource({ baseUrl: 'https://trusted.example/pack/', timeoutMs: 20,
  retry: { maxRetries: 0, backoffBaseMs: 0, backoffMaxMs: 0 }, ...extra });
function mockedFetch(t, replacement) {
  const original = globalThis.fetch; globalThis.fetch = replacement;
  t.after(() => { globalThis.fetch = original; });
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('TEST_OPERATION_DID_NOT_FINISH')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

for (const tc of getRegisteredTests().filter(item => item.name.startsWith('HttpPackSource'))) {
  test(tc.name, { timeout: 5000 }, tc.fn);
}

for (const mode of ['limit', 'timeout']) {
  test(`HttpPackSource ${mode} は未決の cancel を待たず一次失敗を返す`, async t => {
    let cancelled = 0;
    mockedFetch(t, async () => response({ body: new ReadableStream({
      start(controller) { if (mode === 'limit') controller.enqueue(new Uint8Array(8)); },
      pull() { return new Promise(() => {}); },
      cancel() { cancelled++; return new Promise(() => {}); },
    }) }));
    const reader = source();
    await assert.rejects(bounded(reader.readText('ui/test.json', { maxBytes: 4 })),
      { message: mode === 'limit' ? 'PACK_HTTP_TOO_LARGE' : 'PACK_HTTP_TIMEOUT' });
    assert.equal(cancelled, 1);
    assert.equal(reader.getStats().inFlight.text, 0);
    assert.equal(reader.getStats().caches.text.entries, 0);
  });
}

for (const mode of ['text', 'blob', 'arrayBuffer']) {
  test(`HttpPackSource body なし ${mode} の期限後結果を cache に登録しない`, async t => {
    let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    const extra = mode === 'text' ? { text: () => pending }
      : mode === 'blob' ? { blob: () => pending }
        : { arrayBuffer: () => pending };
    mockedFetch(t, async () => response({ body: null, ...extra }));
    const reader = source();
    const operation = mode === 'text' ? reader.readText('ui/test.json') : reader.readBlob('ui/test.json');
    await assert.rejects(bounded(operation), { message: 'PACK_HTTP_TIMEOUT' });
    complete(mode === 'text' ? 'late content' : mode === 'blob' ? new Blob(['late content']) : new ArrayBuffer(8));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(reader.getStats().fetchOk, 0);
    assert.deepEqual(reader.getStats().inFlight, { text: 0, blob: 0 });
    assert.equal(reader.getStats().caches.text.entries + reader.getStats().caches.blob.entries, 0);
  });
}

test('HttpPackSource body なし blob.arrayBuffer の caller abort を期限と区別する', async t => {
  mockedFetch(t, async () => response({ blob: async () => ({ arrayBuffer: () => new Promise(() => {}) }) }));
  const controller = new AbortController(), reader = source({ timeoutMs: 1000 });
  const pending = reader.readBlob('ui/test.json', { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 10); t.after(() => clearTimeout(timer));
  await assert.rejects(bounded(pending), { message: 'PACK_ABORTED' });
  assert.equal(reader.getStats().inFlight.blob, 0);
});

test('HttpPackSource HTTP 400 は 1 回で BAD_STATUS を返し本文の取消を依頼する', async t => {
  let calls = 0, cancelled = 0;
  mockedFetch(t, async () => {
    calls++; return response({ status: 400, ok: false, body: new ReadableStream({
      cancel() { cancelled++; return new Promise(() => {}); },
    }) });
  });
  const reader = source({ retry: { maxRetries: 2, backoffBaseMs: 0, backoffMaxMs: 0 } });
  await assert.rejects(bounded(reader.readText('ui/test.json')), { message: 'PACK_HTTP_BAD_STATUS' });
  assert.equal(calls, 1); assert.equal(cancelled, 1); assert.equal(reader.getStats().retries, 0);
});

test('HttpPackSource HTTP 503 の再試行は本文取消が未決でも正常な次要求へ進む', async t => {
  let calls = 0, cancelled = 0;
  mockedFetch(t, async () => {
    if (++calls > 1) return response({ text: async () => 'ok' });
    return response({ status: 503, ok: false, body: new ReadableStream({
      cancel() { cancelled++; return new Promise(() => {}); },
    }) });
  });
  const reader = source({ retry: { maxRetries: 2, backoffBaseMs: 0, backoffMaxMs: 0 } });
  assert.equal(await bounded(reader.readText('ui/test.json')), 'ok');
  assert.equal(calls, 2); assert.equal(cancelled, 1); assert.equal(reader.getStats().retries, 1);
});

test('HttpPackSource Content-Length 上限拒否時にも受信本文を取り消す', async t => {
  let cancelled = 0;
  mockedFetch(t, async () => response({ headers: { get: key => key === 'content-length' ? '100' : null },
    body: new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }) }));
  await assert.rejects(bounded(source().readText('ui/test.json', { maxBytes: 4 })), { message: 'PACK_HTTP_TOO_LARGE' });
  assert.equal(cancelled, 1);
});
