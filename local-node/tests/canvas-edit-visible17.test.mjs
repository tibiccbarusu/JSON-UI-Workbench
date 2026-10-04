import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CliClient } from '../cli-client.mjs';
import { loadRasterBackend, renderFramePng } from '../frame-raster13.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';
import { makeZip, manifest } from './fixtures.mjs';
import { createCanvasEditPicker } from '../../editor-core/src/preview/canvas-edit-picking17.js';
import { hitTestBoxes } from '../../editor-core/src/preview/canvas-preview.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { createWorkspaceEditor, findAuthoredNodeForPreview, offsetAfterAuthoredMove, workspacePreviewDefinitionIdentity } from '../../editor-core/src/ui/workspace-editor.js';

const backend = loadRasterBackend(), hash = data => createHash('sha256').update(data).digest('hex');
const png = color => pngjs.PNG.sync.write({ width: 2, height: 2, data: Buffer.from([...color, ...color, ...color, ...color]) });
const red = png([240, 20, 20, 255]), blue = png([20, 20, 240, 255]);
const atOrigin = { anchor_from: 'top_left', anchor_to: 'top_left' };
const pixel = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
function synchronousPick(args) {
  const values = { window: { devicePixelRatio: 1 }, OffscreenCanvas: function(w, h) { return backend.createCanvas(w, h); },
    document: { documentElement: {}, createElement: () => backend.createCanvas(1, 1) }, getComputedStyle: () => ({ getPropertyValue: () => '' }) };
  const descriptors = new Map();
  try { for (const [key, value] of Object.entries(values)) { descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true }); }
    return createCanvasEditPicker().hitTest(args);
  } finally { for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } }
}

test('実HTTP: 透明全画面の誤選択ではPNG不変、可視継承画像の編集は原文・frame・PNGを変更してundoで復元', { skip: !backend, timeout: 60000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jsonui-edit-visible17-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const source = '\uFEFF// preserve comment\n' + JSON.stringify({ namespace: 'base', frame: { type: 'panel', size: [64, 48], ...atOrigin, controls: [
    { background: { type: 'image', size: [64, 48], texture: 'textures/red', keep_ratio: false, ...atOrigin } },
    { icon: { type: 'image', size: [8, 8], offset: [8, 8], texture: 'textures/blue', keep_ratio: false, layer: 1, ...atOrigin } },
    { bundle_slot_panel: { type: 'panel', size: [64, 48], layer: 50, ...atOrigin } },
    { flying_item_renderer: { type: 'custom', renderer: 'flying_item_renderer', size: [64, 48], layer: 100, ...atOrigin } },
  ] } });
  const main = JSON.stringify({ namespace: 'demo', 'screen@base.frame': { type: 'screen' } });
  const packPath = path.join(dir, 'edit.zip');
  await writeFile(packPath, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/base.json', 'ui/main.json'] }),
    'ui/base.json': source, 'ui/main.json': main, 'textures/red.png': red, 'textures/blue.png': blue }));
  const client = await CliClient.start(); t.after(() => client.close());
  const loaded = await client.importPack(packPath), packId = loaded.id;
  let sources = [{ id: packId, kind: 'vanilla' }], projection, frame, frameRequest, file, generation = 0;
  async function project(nextSources = sources) {
    sources = nextSources;
    const catalog = await client.request('/api/node/catalog', { payload: { sources } });
    const record = catalog.records.find(row => row.qualifiedName === 'demo.screen'); assert(record);
    projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } }); assert(projection.ok);
    frameRequest = { projectionId: projection.nodeProjectionId, filePath: record.filePath, generation: ++generation, preset: { width: 64, height: 48 }, animationTime: 0, visibilityMode: 'safe' };
    frame = await client.request('/api/node/frame', { payload: frameRequest });
    const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: 'ui/main.json' });
    file = { id: 'preview:ui/main.json', path: 'ui/main.json', uiModel, ...buildTreeFromUiScreenModel(uiModel),
      meta: { previewProjection: true, selectedDefinition: projection.selected, resolution: projection } };
  }
  async function raster() {
    const result = await renderFramePng({ client, sources, projection, frame, frameRequest, width: 64, height: 48, locale: 'en_US', allowPartial: true });
    assert.equal(result.ok, true, JSON.stringify(result)); return result.png;
  }
  const editor = createWorkspaceEditor({ manualApply: false, request: (op, payload) => client.request('/api/node/workspace-' + op, { payload }), onCommit: state => project(state.sources) });
  await editor.ensure(sources, 'picking17'); await editor.readDocument('ui/main.json', { sourceId: packId }); editor.setMode('edit'); await project();
  const before = await raster(), beforeImage = pngjs.PNG.sync.read(before);
  assert.deepEqual(pixel(beforeImage, 10, 10), [20, 20, 240, 255]);
  const oldHit = hitTestBoxes(frame.layout.boxes, 10, 10, frame.layout.preset); assert(oldHit.id.endsWith('/flying_item_renderer'));
  async function move(hit, dx, dy) {
    const target = findAuthoredNodeForPreview({ file, nodeId: hit.id, nodes: editor.state.nodes, sourceId: packId, sources }); assert(target);
    const node = await editor.selectPreviewTarget(target, { fileId: file.id, nodeId: hit.id, previewDefinitionId: workspacePreviewDefinitionIdentity(file) });
    const offset = offsetAfterAuthoredMove({ value: node.props, effectiveProps: file.nodesById[hit.id].props, frameProps: frame.propsById?.[hit.id], dx, dy });
    await editor.edit({ type: 'set', path: node.path, sourceId: node.sourceId, pointer: node.pointer + '/offset', value: offset });
    return { path: node.path, pointer: node.pointer, offset };
  }
  const wrong = await move(oldHit, 16, 0);
  const wrongImage = await raster(); assert.equal(hash(wrongImage), hash(before), '旧処理は保存成功しても見える画像に変化がない');
  await editor.history('undo');
  const blueImage = await backend.loadImage(blue), redImage = await backend.loadImage(red);
  const imageDrawById = {};
  for (const b of frame.layout.boxes) {
    if (b.id.endsWith('/icon') || b.id.endsWith('/background')) imageDrawById[b.id] = { state: 'ready', image: b.id.endsWith('/icon') ? blueImage : redImage, width: 2, height: 2, keepRatio: false, alpha: b.renderAlpha };
    else if (b.type === 'custom') imageDrawById[b.id] = { state: 'unsupported' };
  }
  const hit = synchronousPick({ layout: frame.layout, selection: { imageDrawById }, view: { zoom: 1 }, worldX: 10, worldY: 10 });
  assert(hit.id.endsWith('/icon')); const oldBox = { ...hit };
  const changed = await move(hit, 16, 4); assert.equal(changed.path, 'ui/base.json'); assert(changed.pointer.endsWith('/icon'));
  const newBox = frame.layout.boxes.find(box => box.id === hit.id);
  assert.equal(newBox.x - oldBox.x, 16); assert.equal(newBox.y - oldBox.y, 4);
  assert.equal(file.path, 'ui/main.json'); assert.match(editor.getDocument('ui/base.json', packId).text, /24,\s*12/u);
  const after = await raster(), afterImage = pngjs.PNG.sync.read(after);
  assert.notEqual(hash(after), hash(before));
  assert.deepEqual(pixel(afterImage, 10, 10), [240, 20, 20, 255]); assert.deepEqual(pixel(afterImage, 26, 14), [20, 20, 240, 255]);
  await editor.history('undo'); const undo = await raster(); assert.equal(hash(undo), hash(before));
  assert.equal(editor.getDocument('ui/base.json', packId).text, source, 'BOM・コメントを含む原文の全文復元');
  const evidence = { schema: 'jsonui-visible-edit17', oldHit: oldHit.id, picked: hit.id, wrong, changed,
    before: { box: oldBox, pngSha256: hash(before) }, wrongPngSha256: hash(wrongImage),
    after: { box: newBox, pngSha256: hash(after) }, undoPngSha256: hash(undo), rawRestored: true };
  if (process.env.JSONUI_PICKING17_EVIDENCE_DIR) {
    const out = process.env.JSONUI_PICKING17_EVIDENCE_DIR; await mkdir(out, { recursive: true });
    await Promise.all([writeFile(path.join(out, 'visible-edit17.json'), JSON.stringify(evidence, null, 2) + '\n'),
      writeFile(path.join(out, 'visible-edit17-before.png'), before), writeFile(path.join(out, 'visible-edit17-after.png'), after)]);
  }
});
