import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliClient } from '../cli-client.mjs';
import { renderFramePng, loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const backend = loadRasterBackend();
const options = { skip: !backend, timeout: 60000 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const texture = color => pngjs.PNG.sync.write({ width: 2, height: 2, data: Buffer.from([...color, ...color, ...color, ...color]) });
const pixel = (png, x, y) => {
  const image = pngjs.PNG.sync.read(png), at = (y * image.width + x) * 4;
  return [...image.data.subarray(at, at + 4)];
};
const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
const baseDocument = { namespace: 'shared', tile: { type: 'image', texture: 'textures/red', size: [8, 8],
  offset: '$position', '$position|default': [2, 3], ...origin, keep_ratio: false } };
const screenDocument = { namespace: 'demo', screen: { type: 'screen', size: ['100%', '100%'], ...origin,
  controls: [{ 'tile@shared.tile': { '$position': [4, 5] } }] } };

async function setup(t, { lower = baseDocument, upper = screenDocument, samePath = false, allowPartial = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-projection17-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = await CliClient.start(); t.after(() => client.close());
  const call = (action, payload) => client.request(`/api/node/${action}`, { payload });
  const packs = samePath
    ? [['vanilla', { 'ui/shared.json': JSON.stringify(lower) }], ['imported', { 'ui/shared.json': JSON.stringify(upper) }]]
    : [['vanilla', { 'ui/base.json': '\uFEFF// 原文を保持\r\n' + JSON.stringify(lower) + '\r\n', 'ui/main.json': JSON.stringify(upper) }]];
  const sources = [];
  for (const [kind, documents] of packs) {
    const file = path.join(directory, `${kind}.zip`);
    await writeFile(file, makeZip({ 'manifest.json': manifest,
      'ui/_ui_defs.json': JSON.stringify({ ui_defs: Object.keys(documents) }),
      'textures/red.png': texture([255, 0, 0, 255]), 'textures/blue.png': texture([0, 0, 255, 255]), ...documents }));
    const loaded = await client.importPack(file);
    sources.push({ id: loaded.id, kind, rootPrefix: loaded.rootPrefix });
  }
  let state = await call('workspace-open', { sources }); assert.equal(state.ok, true);
  const workspaceId = state.workspaceId;
  async function commit(operation) {
    state = await call('workspace-edit', { workspaceId, expectedRevision: state.revision, operation });
    assert.equal(state.ok, true, JSON.stringify(state)); return state;
  }
  async function history(direction) {
    state = await call(`workspace-${direction}`, { workspaceId, expectedRevision: state.revision });
    assert.equal(state.ok, true); return state;
  }
  async function render(symbol = 'demo.screen') {
    // Rebuild the catalog from exactly the source stack returned by commit,
    // matching main.js's buildNodeCatalog path, not a separately parsed fixture.
    const catalog = await call('catalog', { sources: state.sources });
    const record = catalog.records.find(row => row.qualifiedName === symbol); assert(record, symbol);
    const projection = await call('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
    assert.equal(projection.ok, true, JSON.stringify(projection.error));
    const frameRequest = { projectionId: projection.nodeProjectionId, recordId: record.id, filePath: record.filePath,
      preset: { width: 64, height: 48 }, generation: 0, animationTime: 0, visibilityMode: 'safe' };
    const frame = await call('frame', frameRequest);
    const raster = await renderFramePng({ client, sources: state.sources, projection, frame, frameRequest,
      width: 64, height: 48, locale: 'ja_JP', allowPartial });
    assert.equal(raster.ok, true, JSON.stringify(raster)); assert.equal(raster.complete, !allowPartial, JSON.stringify(raster.diagnostics));
    if (allowPartial) assert.deepEqual(raster.diagnostics.map(row => [row.code, row.nodeId]), [['RASTER_NATIVE_UNSUPPORTED', 'root/screen/flying_item_renderer']]);
    return { catalog, projection, frame, frameRequest, png: raster.png };
  }
  return { call, commit, history, render, workspaceId, get state() { return state; } };
}

test('HTTP commit changes the selected inherited instance in source, projection, layout and actual PNG; undo/redo restores exact pixels', options, async t => {
  const api = await setup(t), initial = api.state.revision;
  const before = await api.render(), repeated = await api.render();
  assert.equal(before.catalog.nodeCatalogId, repeated.catalog.nodeCatalogId);
  assert.equal(before.projection.nodeProjectionId, repeated.projection.nodeProjectionId);
  assert.equal(hash(before.png), hash(repeated.png));
  const source = before.projection.nodeSources['/screen/controls/0/tile'];
  assert.equal(source.path, 'ui/main.json'); assert.equal(source.pointer, '/screen/controls/0/tile@shared.tile');
  assert.deepEqual(pixel(before.png, 5, 6), [255, 0, 0, 255]);
  const original = await api.call('workspace-read', { workspaceId: api.workspaceId, path: 'ui/base.json' });
  await api.commit({ type: 'move', sourceId: source.sourceId, path: source.path, pointer: source.pointer, offset: [20, 12] });
  assert.notEqual(api.state.revision, initial);
  await assert.rejects(() => api.call('frame', before.frameRequest), error => error.code === 'NODE_FRAME_PROJECTION_STALE');
  const moved = await api.render();
  assert.notEqual(before.catalog.nodeCatalogId, moved.catalog.nodeCatalogId);
  assert.notEqual(before.projection.nodeProjectionId, moved.projection.nodeProjectionId);
  assert.deepEqual(moved.projection.document.screen.controls[0].tile.offset, [20, 12]);
  const tile = moved.frame.layout.boxes.find(box => box.id.endsWith('/tile'));
  assert.deepEqual([tile.x, tile.y, tile.w, tile.h], [20, 12, 8, 8]);
  assert.deepEqual(pixel(moved.png, 21, 13), [255, 0, 0, 255]);
  assert.notDeepEqual(pixel(moved.png, 5, 6), pixel(before.png, 5, 6));
  assert.notEqual(hash(before.png), hash(moved.png));
  assert.equal((await api.call('workspace-read', { workspaceId: api.workspaceId, path: 'ui/base.json' })).text, original.text);
  await api.commit({ type: 'set', sourceId: source.sourceId, path: source.path, pointer: source.pointer + '/texture', value: 'textures/blue' });
  const recolored = await api.render(); assert.deepEqual(pixel(recolored.png, 21, 13), [0, 0, 255, 255]);
  await api.history('undo'); assert.equal(hash((await api.render()).png), hash(moved.png));
  await api.history('undo'); assert.equal(api.state.revision, initial); assert.equal(hash((await api.render()).png), hash(before.png));
  await api.history('redo'); await api.history('redo'); assert.equal(hash((await api.render()).png), hash(recolored.png));
});

test('HTTP edits to the lower layer of a same-path inherited image survive recomposition without changing the upper source', options, async t => {
  const lower = { namespace: 'layered', screen: { type: 'screen', size: ['100%', '100%'], ...origin,
    controls: [{ tile: { ...baseDocument.tile, offset: [4, 5] } }] } };
  const upper = { namespace: 'layered', 'screen@layered.screen': { alpha: 1 } };
  const api = await setup(t, { lower, upper, samePath: true });
  const before = await api.render('layered.screen');
  const source = before.projection.nodeSources['/screen/controls/0/tile'];
  assert.equal(source.sourceId, 'vanilla-reference');
  const upperBefore = await api.call('workspace-read', { workspaceId: api.workspaceId, path: 'ui/shared.json', sourceId: 'imported-pack' });
  await api.commit({ type: 'move', sourceId: source.sourceId, path: source.path, pointer: source.pointer, offset: [30, 20] });
  const after = await api.render('layered.screen');
  assert.deepEqual(pixel(after.png, 31, 21), [255, 0, 0, 255]); assert.notEqual(hash(before.png), hash(after.png));
  assert.equal((await api.call('workspace-read', { workspaceId: api.workspaceId, path: 'ui/shared.json', sourceId: 'imported-pack' })).text, upperBefore.text);
  assert.deepEqual(api.state.sources.find(source => source.kind === 'imported').overrides, {});
  assert(Object.keys(api.state.sources.find(source => source.kind === 'vanilla').overrides).length === 1);
});

test('negative control: moving an inactive flying-item surface changes its actual layout but leaves every preview pixel unchanged', options, async t => {
  const upper = structuredClone(screenDocument);
  upper.screen.controls.push({ flying_item_renderer: { type: 'custom', renderer: 'flying_item_renderer', layer: 20, size: ['100%', '100%'], ...origin } });
  const api = await setup(t, { upper, allowPartial: true }), before = await api.render();
  const source = before.projection.nodeSources['/screen/controls/1/flying_item_renderer'];
  await api.commit({ type: 'move', sourceId: source.sourceId, path: source.path, pointer: source.pointer, offset: [17, 9] });
  const after = await api.render();
  const a = before.frame.layout.boxes.find(box => box.id.endsWith('/flying_item_renderer'));
  const b = after.frame.layout.boxes.find(box => box.id === a.id);
  assert.deepEqual([b.x - a.x, b.y - a.y], [17, 9]);
  assert.deepEqual(after.projection.document.screen.controls[1].flying_item_renderer.offset, [17, 9]);
  assert.equal(hash(before.png), hash(after.png));
});
