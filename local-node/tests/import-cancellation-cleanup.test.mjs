import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CliClient } from '../cli-client.mjs';
import { createRenderer } from '../api.mjs';
import { makeZip, manifest } from './fixtures.mjs';

async function inputs(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-import-cleanup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const old = path.join(directory, 'old.mcpack'), next = path.join(directory, 'next.mcpack');
  const pack = namespace => makeZip({ 'manifest.json': manifest, 'ui/test.json': JSON.stringify({ namespace, screen: { type: 'panel', size: [32, 24] } }) });
  const bytes = pack('old'); await writeFile(old, bytes); await writeFile(next, pack('next'));
  return { old, next, bytes };
}
async function rendererWithClient(t) {
  const start = CliClient.start; let client;
  t.mock.method(CliClient, 'start', async function (options) { client = await start.call(this, options); return client; });
  const renderer = await createRenderer(); t.after(() => renderer.close());
  return { renderer, client };
}
function delayedResponseAbort(t, getController, { cleanupStatus } = {}) {
  const fetch = globalThis.fetch; const observation = { replies: 0, cleanupCalls: 0, cleanupAborted: [] };
  t.mock.method(globalThis, 'fetch', async function (url, options) {
    if (options?.method === 'DELETE' && /\/api\/node\/packs\/[0-9a-f-]{36}$/u.test(String(url))) {
      observation.cleanupCalls++; observation.cleanupAborted.push(options.signal.aborted);
      if (cleanupStatus) {
        // A 404 models a registration already removed by another cleanup path.
        // A 503 deliberately leaves it registered and tests the owned-server fallback.
        if (cleanupStatus === 404) await fetch(url, options);
        return new Response(JSON.stringify({ error: cleanupStatus === 404 ? 'NODE_PACK_NOT_FOUND' : 'NODE_BUSY' }), {
          status: cleanupStatus, headers: { 'content-type': 'application/json' },
        });
      }
    }
    const response = await fetch(url, options), controller = getController();
    if (controller && options?.method === 'POST' && String(url).endsWith('/api/node/packs')) {
      const body = response.body; observation.replies++;
      Object.defineProperty(response, 'body', { value: {
        cancel: () => body.cancel(),
        async *[Symbol.asyncIterator]() {
          // Real HTTP headers have arrived. Let the server finish its reply
          // before cancelling admission of its body, which has the registration ID.
          await new Promise(resolve => setTimeout(resolve, 30));
          controller.abort(new Error('private abort reason'));
          for await (const chunk of body) yield chunk;
        },
      } });
    }
    return response;
  });
  return observation;
}

test('late SDK import cancellation cleans the owned upload before any reply ID is read, repeatedly beyond pack capacity', async t => {
  const { old, bytes } = await inputs(t), { renderer, client } = await rendererWithClient(t);
  let controller; const observed = delayedResponseAbort(t, () => controller);
  for (let index = 0; index < 6; index++) {
    controller = new AbortController();
    await assert.rejects(renderer.import({ pack: old }, { signal: controller.signal }), { code: 'API_CANCELLED' });
    controller = null;
    // Status joins the serial queue after the underlying task's cleanup.
    assert.equal((await renderer.status()).imported, false);
    assert.deepEqual(await readdir(path.join(client.app.root, 'packs')), []);
  }
  assert.equal(observed.replies, 6); assert.equal(observed.cleanupCalls, 6);
  assert(observed.cleanupAborted.every(value => value === false), 'cleanup never inherits caller cancellation');
  await renderer.import({ pack: old });
  assert.equal((await renderer.render({ file: 'ui/test.json', definition: 'old.screen' })).ok, true);
  assert.deepEqual(await readFile(old), bytes);
});

test('late cancellation of a replacement retains the old pack and reopens its invalidated workspace', async t => {
  const { old, next, bytes } = await inputs(t), { renderer, client } = await rendererWithClient(t);
  await renderer.import({ pack: old });
  await renderer.render({ file: 'ui/test.json', definition: 'old.screen' });
  let controller = new AbortController(); delayedResponseAbort(t, () => controller);
  await assert.rejects(renderer.import({ pack: next }, { signal: controller.signal }), { code: 'API_CANCELLED' });
  controller = null;
  assert.equal((await renderer.status()).imported, true);
  assert.equal((await readdir(path.join(client.app.root, 'packs'))).length, 1);
  assert.equal((await renderer.render({ file: 'ui/test.json', definition: 'old.screen' })).ok, true);
  assert.deepEqual(await readFile(old), bytes);
});

test('CLI client identity rejection cleans a completed upload even when its caller signal has just aborted', async t => {
  const { old, bytes } = await inputs(t), controller = new AbortController();
  const client = await CliClient.start({ signal: controller.signal, keepPacksAlive: true }); t.after(() => client.close());
  const request = client.request.bind(client);
  t.mock.method(client, 'request', async function (route, options) {
    const result = await request(route, options);
    if (route === '/api/node/packs') controller.abort();
    return result;
  });
  await assert.rejects(client.importPack(old, { checksum_sha256: '0'.repeat(64), size_bytes: bytes.length }), { code: 'CLI_SOURCE_CHANGED' });
  assert.deepEqual(await readdir(path.join(client.app.root, 'packs')), []);
  assert.equal((await new CliClient(client.app, client.token).request('/api/node/capabilities', { method: 'GET' })).protocol, 'jsonui-node/v1');
});

test('mismatched reply registration ID never deletes a different previously owned pack', async t => {
  const { old, next } = await inputs(t), client = await CliClient.start({ keepPacksAlive: true }); t.after(() => client.close());
  const previous = await client.importPack(old), request = client.request.bind(client);
  t.mock.method(client, 'request', async function (route, options) {
    const result = await request(route, options);
    return route === '/api/node/packs' ? { ...result, id: previous.id } : result;
  });
  await assert.rejects(client.importPack(next), { code: 'CLI_PROTOCOL_INVALID' });
  assert.deepEqual(await readdir(path.join(client.app.root, 'packs')), [previous.id + '.zip']);
  const text = await request(`/api/node/packs/${previous.id}/read?path=ui%2Ftest.json`, { method: 'GET', binary: true });
  assert.equal(JSON.parse(text.toString('utf8')).namespace, 'old');
});

test('already-absent cleanup response preserves the reusable renderer and its prior stack', async t => {
  const { old, next } = await inputs(t), { renderer, client } = await rendererWithClient(t);
  await renderer.import({ pack: old });
  let controller = new AbortController(); delayedResponseAbort(t, () => controller, { cleanupStatus: 404 });
  await assert.rejects(renderer.import({ pack: next }, { signal: controller.signal }), { code: 'API_CANCELLED' });
  controller = null;
  assert.equal((await renderer.status()).imported, true);
  assert.equal((await readdir(path.join(client.app.root, 'packs'))).length, 1);
  assert.equal((await renderer.render({ file: 'ui/test.json', definition: 'old.screen' })).ok, true);
});

test('failed precise cleanup closes the owned server instead of leaking a pinned registration', async t => {
  const { old, next } = await inputs(t), { renderer, client } = await rendererWithClient(t);
  await renderer.import({ pack: old });
  const controller = new AbortController(); const observed = delayedResponseAbort(t, () => controller, { cleanupStatus: 503 });
  await assert.rejects(renderer.import({ pack: next }, { signal: controller.signal }), { code: 'API_CANCELLED' });
  await assert.rejects(renderer.status(), error => {
    assert.equal(error.code, 'API_CLOSED'); assert.equal(error.context.recreate_renderer_required, true);
    assert.equal(error.context.previous_stack_preserved, false);
    assert.equal(error.context.import_cleanup.completed, false); return true;
  });
  await renderer.close();
  await assert.rejects(readdir(client.app.root), { code: 'ENOENT' });
  assert(observed.cleanupAborted.every(value => value === false));
  await assert.rejects(fetch(`http://127.0.0.1:${client.app.port}/api/node/capabilities`, { signal: AbortSignal.timeout(2000) }));
});
