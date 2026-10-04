import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliClient } from '../cli-client.mjs';
import { renderFramePng, loadRasterBackend } from '../frame-raster13.mjs';
import { drawCanvasPreview } from '../../editor-core/src/preview/canvas-preview.js';
import { PreviewRasterCache } from '../../editor-core/src/preview/raster-cache.js';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const backend = loadRasterBackend();
const options = { skip: !backend, timeout: 60000 };
const pixel = bytes => [...pngjs.PNG.sync.read(bytes).data.subarray(0, 4)];

async function setup(t, imageSize, color) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-effects23-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = await CliClient.start();
  t.after(() => client.close());
  const source = backend.createCanvas(imageSize, imageSize);
  source.getContext('2d').fillStyle = '#ffffff';
  source.getContext('2d').fillRect(0, 0, imageSize, imageSize);
  const document = { namespace: 'effects23', screen: { type: 'screen', size: [32, 32], controls: [
    { picture: { type: 'image', texture: 'textures/ui/test', size: [32, 32],
      anchor_from: 'top_left', anchor_to: 'top_left', keep_ratio: false, color } },
  ] } };
  const packPath = path.join(directory, 'fixture.mcpack');
  await writeFile(packPath, makeZip({ 'manifest.json': manifest, 'ui/effects.json': JSON.stringify(document),
    'ui/_ui_defs.json': '{"ui_defs":["ui/effects.json"]}', 'textures/ui/test.png': source.toBuffer('image/png') }));
  const loaded = await client.importPack(packPath);
  const sources = [{ id: loaded.id, kind: 'imported', rootPrefix: loaded.rootPrefix }];
  const catalog = await client.request('/api/node/catalog', { payload: { sources } });
  const record = catalog.records.find(row => row.qualifiedName === 'effects23.screen');
  const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } });
  const frameRequest = { projectionId: projection.nodeProjectionId, recordId: record.id, filePath: record.filePath,
    preset: { width: 32, height: 32 }, generation: 0, animationTime: 0, visibilityMode: 'safe' };
  const frame = await client.request('/api/node/frame', { payload: frameRequest });
  return { client, sources, projection, frameRequest, frame, width: 32, height: 32 };
}

test('画像着色が画素予算で省略されたPNGを厳格モードの完全成功にしない', options, async t => {
  const args = await setup(t, 2048, [1, 0, 0]);
  const strict = await renderFramePng(args);
  assert.equal(strict.ok, false, '白い代替画素を赤い原指定の完成PNGとして返さない');
  assert.equal(strict.complete, false);
  assert(strict.diagnostics.some(row => row.code === 'IMAGE_EFFECT_BUDGET_EXCEEDED'));
  assert.equal(strict.png, undefined);
  const partial = await renderFramePng({ ...args, allowPartial: true });
  assert.equal(partial.ok, true);
  assert.equal(partial.complete, false);
  assert.deepEqual(pixel(partial.png), [255, 255, 255, 255]);
  assert(partial.diagnostics.some(row => row.code === 'IMAGE_EFFECT_BUDGET_EXCEEDED' && row.nodeId.includes('picture')));
});

test('同じ大型原画像でも着色不要なら厳格PNGを過剰に拒否しない', options, async t => {
  const args = await setup(t, 2048, [1, 1, 1]);
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.complete, true);
  assert.deepEqual(pixel(result.png), [255, 255, 255, 255]);
});

test('透明な着色画像は効果予算を消費せず厳格PNGを拒否しない', options, async t => {
  const args = await setup(t, 2048, [1, 0, 0, 0]);
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.complete, true);
  assert(!result.diagnostics.some(row => row.code.startsWith('IMAGE_EFFECT_')));
});

test('予算内の原画像は指定色で描画され厳格PNGが成功する', options, async t => {
  const args = await setup(t, 16, [1, 0, 0]);
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.complete, true);
  assert.deepEqual(pixel(result.png), [255, 0, 0, 255]);
});

test('Canvas描画失敗は診断し、診断callbackの例外で後続要素を消さない', options, () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  try {
    const out = backend.createCanvas(32, 32);
    out.getBoundingClientRect = () => ({ width: 32, height: 32 });
    const valid = backend.createCanvas(1, 1);
    valid.getContext('2d').fillStyle = '#ff0000'; valid.getContext('2d').fillRect(0, 0, 1, 1);
    const issues = [];
    drawCanvasPreview(out, { preset: { width: 32, height: 32 }, boxes: [
      { id: 'broken', type: 'image', x: 0, y: 0, w: 16, h: 16 },
      { id: 'valid', type: 'image', x: 16, y: 0, w: 16, h: 16 },
    ] }, { zoom: 1, viewX: 0, viewY: 0 }, {
      showGuides: false, showScreenBoundary: false, transparentBackground: true,
      rasterCache: new PreviewRasterCache(), imageDrawById: {
        broken: { state: 'ready', image: {}, width: 1, height: 1, keepRatio: false },
        valid: { state: 'ready', image: valid, width: 1, height: 1, keepRatio: false },
      }, onImageDrawIssue: issue => { issues.push(issue); throw new Error('diagnostic callback failure'); },
    });
    assert.deepEqual(issues.map(row => [row.code, row.nodeId]), [['IMAGE_DRAW_FAILED', 'broken']]);
    assert.deepEqual([...out.getContext('2d').getImageData(20, 4, 1, 1).data], [255, 0, 0, 255]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window;
  }
});
