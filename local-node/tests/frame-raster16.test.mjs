import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliClient } from '../cli-client.mjs';
import { renderFramePng, loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

// Public HTTP import/project/frame/resource paths remain part of every case.
// Small fixtures isolate the selection/scale failures from a giant vanilla ZIP.
const backend = loadRasterBackend();
const options = { skip: !backend, timeout: 60000 };
function png(width, height, colorAt) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(colorAt(x, y), (y * width + x) * 4);
  return pngjs.PNG.sync.write({ width, height, data });
}
const red = png(2, 2, () => [255, 0, 0, 255]);
const blue = png(2, 2, () => [0, 0, 255, 255]);
const green = png(2, 2, () => [0, 255, 0, 255]);
const font = png(128, 128, (x, y) => [255, 255, 255, x % 8 < 5 && y % 8 < 7 ? 255 : 0]);
const atlas = entries => JSON.stringify({ texture_data: entries });
const atOrigin = { size: [16, 16], anchor_from: 'top_left', anchor_to: 'top_left', keep_ratio: false };
const item = fields => ({ icon: { type: 'custom', renderer: 'inventory_item_renderer', ...atOrigin, ...fields } });
const pixel = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

async function setup(t, { controls, vanilla = {}, imported = null } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-raster16-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const document = { namespace: 'raster16', screen: { type: 'screen', size: [64, 48],
    anchor_from: 'top_left', anchor_to: 'top_left', controls } };
  const base = { 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/raster16.json"]}',
    'ui/raster16.json': JSON.stringify(document), ...vanilla };
  const client = await CliClient.start();
  t.after(() => client.close());
  const sources = [];
  for (const [kind, files] of [['vanilla', base], ...(imported ? [['imported', { 'manifest.json': manifest, ...imported }]] : [])]) {
    const filename = path.join(directory, `${kind}.zip`);
    await writeFile(filename, makeZip(files));
    const loaded = await client.importPack(filename);
    sources.push({ id: loaded.id, kind, rootPrefix: loaded.rootPrefix });
  }
  const catalog = await client.request('/api/node/catalog', { payload: { sources } });
  const record = catalog.records.find(row => row.qualifiedName === 'raster16.screen');
  assert(record);
  const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } });
  assert.equal(projection.ok, true);
  const frameRequest = { projectionId: projection.nodeProjectionId, recordId: record.id, filePath: record.filePath,
    preset: { width: 64, height: 48 }, generation: 0, animationTime: 0, visibilityMode: 'safe' };
  const frame = await client.request('/api/node/frame', { payload: frameRequest });
  return { client, sources, projection, frame, frameRequest, width: 64, height: 48, locale: 'en_US' };
}

test('PNG legacy profile item atlas aux variant paints the selected texture instead of the first dependency', options, async t => {
  const args = await setup(t, { controls: [item({ '#item_id_aux': 264 * 65536 + 1, __jsonui_preview_item_id_profile: 'r41-legacy-five' })],
    vanilla: { 'textures/item_texture.json': atlas({ diamond: { textures: ['textures/items/red', 'textures/items/blue'] } }),
      'textures/items/red.png': red, 'textures/items/blue.png': blue } });
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.complete, true);
  assert.deepEqual(pixel(pngjs.PNG.sync.read(result.png), 8, 8), [0, 0, 255, 255]);
  assert.equal(result.rendering.counts.textures, 1);
  assert.equal(result.provenance.some(row => row.packPath === 'textures/items/red.png'), false);
});

test('PNG current-profile static sign property bag uses its sprite with no collection', options, async t => {
  const args = await setup(t, { controls: [item({ property_bag: { '#item_id_aux': 589 * 65536 } })],
    vanilla: { 'textures/item_texture.json': atlas({ acacia_sign: { textures: 'textures/items/sign_acacia' } }),
      'textures/items/sign_acacia.png': blue, 'textures/blocks/planks_acacia.png': red } });
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.complete, true);
  assert.deepEqual(pixel(pngjs.PNG.sync.read(result.png), 8, 8), [0, 0, 255, 255]);
  assert.equal(result.provenance.some(row => row.packPath === 'textures/blocks/planks_acacia.png'), false);
});

test('PNG does not reject a selected valid atlas variant because an unused variant is missing', options, async t => {
  const args = await setup(t, { controls: [item({ __jsonui_preview_item_atlas_key: 'sample', __jsonui_preview_item_variant: 1 })],
    vanilla: { 'textures/item_texture.json': atlas({ sample: { textures: ['textures/items/missing', 'textures/items/blue'] } }),
      'textures/items/blue.png': blue } });
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.complete, true);
  assert.deepEqual(pixel(pngjs.PNG.sync.read(result.png), 8, 8), [0, 0, 255, 255]);
});

test('PNG resolves an item identifier through its definition and higher pack atlas', options, async t => {
  const args = await setup(t, { controls: [item({ __jsonui_preview_item_id: 'test:custom' })],
    vanilla: {
      'items/custom.json': JSON.stringify({ 'minecraft:item': { description: { identifier: 'test:custom' }, components: { 'minecraft:icon': 'authored_icon' } } }),
      'textures/item_texture.json': atlas({ authored_icon: { textures: 'textures/items/red' } }), 'textures/items/red.png': red,
    }, imported: { 'textures/item_texture.json': atlas({ authored_icon: { textures: 'textures/items/green' } }), 'textures/items/green.png': green } });
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(pixel(pngjs.PNG.sync.read(result.png), 8, 8), [0, 255, 0, 255]);
  assert(result.provenance.some(row => row.kind === 'texture' && row.source === 'imported' && row.packPath === 'textures/items/green.png'));
});

test('PNG treats an unpopulated dynamic inventory item as empty while rejecting an unknown renderer', options, async t => {
  const args = await setup(t, { controls: [item({})] });
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.complete, true);
  assert.equal(result.rendering.counts.textures, 0);
  const invalid = await setup(t, { controls: [{ icon: { type: 'custom', renderer: 'unknown_renderer16', ...atOrigin } }] });
  const rejected = await renderFramePng(invalid);
  assert.equal(rejected.ok, false);
  assert(rejected.diagnostics.some(row => row.code === 'RASTER_NATIVE_UNSUPPORTED'));
});

test('PNG only requires a valid atlas when the selected item actually uses it', options, async t => {
  for (const props of [{}, { '#item_valid': false }, { __jsonui_preview_item_texture: 'textures/items/blue' }]) {
    const args = await setup(t, { controls: [item(props)], vanilla: {
      'textures/item_texture.json': '{invalid atlas', 'textures/items/blue.png': blue,
    } });
    const result = await renderFramePng(args);
    assert.equal(result.ok, true, JSON.stringify({ props, result }));
    assert.equal(result.complete, true);
    if (props.__jsonui_preview_item_texture) assert.deepEqual(pixel(pngjs.PNG.sync.read(result.png), 8, 8), [0, 0, 255, 255]);
  }
  const args = await setup(t, { controls: [item({ __jsonui_preview_item_atlas_key: 'sample' })],
    vanilla: { 'textures/item_texture.json': '{invalid atlas' } });
  const rejected = await renderFramePng(args);
  assert.equal(rejected.ok, false);
  assert(rejected.diagnostics.some(row => row.code === 'ITEM_TEXTURE_ATLAS_INVALID'));
});

test('PNG fourfold UI scale expands textures and resource glyphs together in every pixel', options, async t => {
  const args = await setup(t, { controls: [
    { image: { type: 'image', ...atOrigin, texture: 'textures/items/blue' } },
    { label: { type: 'label', size: [32, 26], offset: [20, 0], anchor_from: 'top_left', anchor_to: 'top_left',
      text: 'A日\nA', localize: false, font_type: 'unicode', color: [1, 1, 1], line_padding: 2 } },
  ], vanilla: { 'textures/items/blue.png': blue, 'font/glyph_00.png': font, 'font/glyph_65.png': font } });
  const unit = await renderFramePng(args);
  const scaled = await renderFramePng({ ...args, width: 256, height: 192, uiScale: 4 });
  assert.equal(unit.ok, true, JSON.stringify(unit));
  assert.equal(scaled.ok, true, JSON.stringify(scaled));
  assert.equal(scaled.rendering.ui_scale, 4);
  const a = pngjs.PNG.sync.read(unit.png), b = pngjs.PNG.sync.read(scaled.png);
  assert.deepEqual([b.width, b.height], [256, 192]);
  assert.deepEqual(pixel(b, 84, 4), [255, 255, 255, 255], 'ASCII 原字形も 4 倍で描く');
  assert.deepEqual(pixel(b, 108, 4), [255, 255, 255, 255], '和文字形も 4 倍で描く');
  assert.deepEqual(pixel(b, 84, 44), [255, 255, 255, 255], '改行間隔も 4 倍で描く');
  let differingPixels = 0;
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
    const ai = (Math.floor(y / 4) * a.width + Math.floor(x / 4)) * 4, bi = (y * b.width + x) * 4;
    if (!b.data.subarray(bi, bi + 4).equals(a.data.subarray(ai, ai + 4))) differingPixels++;
  }
  assert.equal(differingPixels, 0, '整数倍率の画像・文字・背景が 1 倍画像の厳密な 4 倍拡大と一致する');
});

function jpegTexture() {
  const canvas = backend.createCanvas(16, 16), context = canvas.getContext('2d');
  context.fillStyle = '#20a040'; context.fillRect(0, 0, 16, 16);
  return canvas.toBuffer('image/jpeg');
}

test('PNG paints an actual JPEG pack texture with original image provenance', options, async t => {
  const jpeg = jpegTexture();
  const args = await setup(t, { controls: [{ picture: { type: 'image', ...atOrigin, texture: 'textures/items/photo' } }],
    vanilla: { 'textures/items/photo.jpg': jpeg } });
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true);
  const actual = pixel(pngjs.PNG.sync.read(result.png), 8, 8);
  for (const [index, expected] of [32, 160, 64].entries()) assert(Math.abs(actual[index] - expected) <= 3, JSON.stringify(actual));
  assert.equal(actual[3], 255);
  assert(result.provenance.some(row => row.kind === 'texture' && row.packPath === 'textures/items/photo.jpg'
    && row.mimeType === 'image/jpeg' && row.width === 16 && row.height === 16));
});

test('PNG rejects a spoofed or oversized JPEG before passing bytes to the native decoder', options, async t => {
  const oversized = Buffer.from(jpegTexture());
  const marker = oversized.indexOf(Buffer.from([0xff, 0xc0]));
  assert(marker >= 0, '検査 JPEG に baseline SOF ヘッダーが存在する');
  oversized.writeUInt16BE(8193, marker + 7);
  for (const [bytes, code] of [[red, 'RASTER_JPEG_HEADER_INVALID'], [oversized, 'RASTER_DECODE_LIMIT']]) {
    const args = await setup(t, { controls: [{ picture: { type: 'image', ...atOrigin, texture: 'textures/items/photo' } }],
      vanilla: { 'textures/items/photo.jpg': bytes } });
    let decoded = 0;
    const result = await renderFramePng({ ...args, backend: { ...backend, loadImage() { decoded++; throw new Error('must not decode invalid image'); } } });
    assert.equal(result.ok, false);
    assert.equal(decoded, 0);
    assert(result.diagnostics.some(row => row.code === code), JSON.stringify(result));
  }
});
