import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpPackSource } from '../../editor-core/src/pack-io/http-pack-source.js';

for (const method of ['readText', 'readBlob']) {
  test(`HTTP ${method}: 同一パスの別要求を取り消さず、自分の取消を返す`, async t => {
    const original = globalThis.fetch;
    const responses = [];
    globalThis.fetch = async (_url, options) => ({ ok: true, status: 200,
      headers: new Headers(), url: '', body: new ReadableStream({
        start(controller) {
          responses.push(controller);
          options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
        },
      }),
    });
    t.after(() => { globalThis.fetch = original; });
    const source = new HttpPackSource({ baseUrl: 'https://example.test/pack/', timeoutMs: 1000, retry: { maxRetries: 0 } });
    const one = new AbortController(), two = new AbortController();
    const first = source[method]('ui/shared.json', { signal: one.signal });
    const cancelled = source[method]('ui/shared.json', { signal: two.signal });
    const rejected = assert.rejects(cancelled, { message: 'PACK_ABORTED' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(responses.length, 2);
    two.abort();
    await rejected;
    assert.equal(one.signal.aborted, false);
    responses[0].enqueue(new TextEncoder().encode('survivor'));
    responses[0].close();
    const result = await first;
    assert.equal(method === 'readText' ? result : await result.text(), 'survivor');
    assert.deepEqual(source.getStats().inFlight, { text: 0, blob: 0 });
  });
}

test('HTTP: signal 未指定の重複要求は従来どおり1回へ統合する', async t => {
  const original = globalThis.fetch;
  let controller, calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(new ReadableStream({ start(value) { controller = value; } })); };
  t.after(() => { globalThis.fetch = original; });
  const source = new HttpPackSource({ baseUrl: 'https://example.test/pack/', timeoutMs: 1000, retry: { maxRetries: 0 } });
  const one = source.readText('ui/shared.json'), two = source.readText('ui/shared.json');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  controller.enqueue(new TextEncoder().encode('shared')); controller.close();
  assert.deepEqual(await Promise.all([one, two]), ['shared', 'shared']);
  assert.equal(source.getStats().inFlight.text, 0);
});
