import test from 'node:test';
import assert from 'node:assert/strict';

async function client(t, fontResponse) {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  globalThis.window = {};
  globalThis.fetch = async (url, options) => url === '/api/node/capabilities'
    ? new Response(JSON.stringify({ protocol: 'jsonui-node/v1', token: 'fixture-only' }), { headers: { 'content-type': 'application/json' } })
    : fontResponse(options);
  t.after(() => { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
  return (await import(`../../editor-core/src/pack-io/node-remote-client.js?font37=${crypto.randomUUID()}`)).nodeFontSheet;
}

test('R37 font transport: streamed UTF8境界を保持しincludePixelsを送る', async t => {
  const encoded = new TextEncoder().encode(JSON.stringify({ kind: 'fixture', label: '星' }));
  const request = await client(t, options => {
    assert.equal(JSON.parse(options.body).includePixels, true);
    let index = 0;
    return new Response(new ReadableStream({ pull(controller) {
      if (index === encoded.length) controller.close(); else controller.enqueue(encoded.subarray(index, ++index));
    } }));
  });
  assert.deepEqual(await request({ sheet: 'smooth_00', includePixels: true }), { kind: 'fixture', label: '星' });
});

test('R37 font transport: Content-Length超過を読取前に拒否', async t => {
  let cancelled = false;
  const request = await client(t, () => new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { 'content-length': String(12 * 1024 * 1024 + 1) } }));
  await assert.rejects(request({ sheet: 'smooth_00' }), /FONT_RESPONSE_BYTE_LIMIT/u); assert.equal(cancelled, true);
});

test('R37 font transport: 宣言なしstreamも12MiBで停止', async t => {
  let reads = 0, cancelled = false;
  const request = await client(t, () => new Response(new ReadableStream({ pull(controller) {
    reads++; controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
  }, cancel() { cancelled = true; } })));
  await assert.rejects(request({ sheet: 'smooth_00' }), /FONT_RESPONSE_BYTE_LIMIT/u);
  assert.equal(cancelled, true); assert(reads <= 14);
});

test('R37 font transport: 不正UTF8とJSONを成功扱いしない', async t => {
  let calls = 0;
  const request = await client(t, () => new Response(calls++ === 0 ? new Uint8Array([0xff]) : '{invalid'));
  await assert.rejects(request({ sheet: 'smooth_00' }), TypeError);
  await assert.rejects(request({ sheet: 'smooth_00' }), SyntaxError);
});

test('R37 font transport: 不正UTF8で停止したstreamをcancelする', async t => {
  let reads = 0, cancelled = false;
  const request = await client(t, () => new Response(new ReadableStream({ pull(controller) {
    reads++; controller.enqueue(new Uint8Array([0xff]));
  }, cancel() { cancelled = true; } })));
  await assert.rejects(request({ sheet: 'smooth_00' }), TypeError);
  assert.equal(cancelled, true); assert(reads <= 2);
});
