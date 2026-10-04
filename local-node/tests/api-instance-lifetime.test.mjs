import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createRenderer } from '../api.mjs';
import { CliClient } from '../cli-client.mjs';
import { LIMITS } from '../limits.mjs';
import { makeZip, manifest } from './fixtures.mjs';
const target = { file: 'ui/test.json', definition: 'sample.screen', format: 'json', width: 128, height: 96, uiScale: 1, frame: 0 };
async function source(t, marker) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-instance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'pack.mcpack');
  const bytes = makeZip({ 'manifest.json': manifest,
    'ui/test.json': JSON.stringify({ namespace: 'sample', screen: { type: 'panel', size: [80, 60], controls: [
      { [marker]: { type: 'panel', size: [5, 5] } },
      { gate: { type: 'panel', size: [9, 9], bindings: [{ binding_name: '#show_gate', binding_name_override: '#visible' }] } },
    ] } }) });
  await writeFile(filename, bytes); return { filename, bytes };
}
const has = (result, suffix) => result.frame.layout.boxes.some(box => box.id.endsWith('/' + suffix));
test('concurrent renderer instances isolate packs/default state and closing one keeps the other usable', async t => {
  const a = await source(t, 'only_a'), b = await source(t, 'only_b');
  const [left, right] = await Promise.all([
    createRenderer({ settings: { mock_data: { '#show_gate': true } } }),
    createRenderer({ settings: { mock_data: { '#show_gate': false } } }),
  ]);
  t.after(() => Promise.all([left.close(), right.close()]));
  await Promise.all([left.import({ pack: a.filename }), right.import({ pack: b.filename })]);
  let [la, rb] = await Promise.all([left.render(target), right.render(target)]);
  assert(has(la, 'only_a') && !has(la, 'only_b') && has(la, 'gate'));
  assert(has(rb, 'only_b') && !has(rb, 'only_a') && !has(rb, 'gate'));
  [la, rb] = await Promise.all([
    left.render({ ...target, state: { mockData: { '#show_gate': false } } }),
    right.render({ ...target, state: { mockData: { '#show_gate': true } } }),
  ]);
  assert(!has(la, 'gate')); assert(has(rb, 'gate'));
  assert(has(await left.render(target), 'gate')); assert(!has(await right.render(target), 'gate'));
  await left.close(); assert(has(await right.render(target), 'only_b'));
  assert.deepEqual(await readFile(a.filename), a.bytes); assert.deepEqual(await readFile(b.filename), b.bytes);
});
test('SDK holds bounded packs past virtual idle expiry while legacy clients retain automatic idle cleanup', async t => {
  const pack = await source(t, 'pinned');
  const originalInterval = globalThis.setInterval, originalNow = Date.now, reap = [];
  let renderer, legacy;
  try {
    globalThis.setInterval = function (callback, ms, ...args) {
      if (ms === 60000) reap.push(callback);
      return originalInterval(callback, ms, ...args);
    };
    renderer = await createRenderer({ settings: { mock_data: { '#show_gate': true } } });
    legacy = await CliClient.start();
    globalThis.setInterval = originalInterval;
    assert.equal(reap.length, 2);
    await renderer.import({ pack: pack.filename });
    const imported = await legacy.importPack(pack.filename);
    await nextTurn();
    Date.now = () => originalNow() + LIMITS.idleMs + 1000;
    await reap[0](); await reap[1]();
    Date.now = originalNow;
    assert.equal((await renderer.status()).imported, true);
    assert(has(await renderer.render(target), 'pinned'));
    await assert.rejects(legacy.request(`/api/node/packs/${imported.id}/read?path=manifest.json`, { method: 'GET', binary: true }), { code: 'NODE_PACK_NOT_FOUND' });
  } finally {
    globalThis.setInterval = originalInterval; Date.now = originalNow;
    await Promise.all([renderer?.close(), legacy?.close()]);
  }
});
test('Worker recovery invalidates stale SDK state, reports the live Worker and permits explicit reimport', async t => {
  const pack = await source(t, 'recovered');
  const originalStart = CliClient.start; let client, renderer;
  try {
    CliClient.start = async function (options) { client = await originalStart.call(this, options); return client; };
    renderer = await createRenderer({ settings: { mock_data: { '#show_gate': true } } });
  } finally { CliClient.start = originalStart; }
  t.after(() => renderer.close());
  await renderer.import({ pack: pack.filename });
  const oldProcessor = client.app.processor, ownedRoot = client.app.root;
  await oldProcessor.close();
  await assert.rejects(renderer.render(target), { code: 'API_REIMPORT_REQUIRED' });
  assert.notEqual(client.app.processor, oldProcessor);
  const status = await renderer.status();
  assert.equal(status.imported, false); assert.equal(status.worker.dead, false);
  await renderer.import({ pack: pack.filename }); assert(has(await renderer.render(target), 'recovered'));
  await renderer.close(); await assert.rejects(lstat(ownedRoot), { code: 'ENOENT' });
});
