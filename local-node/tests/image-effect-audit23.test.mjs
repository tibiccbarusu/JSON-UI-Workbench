import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCanvasPreview } from '../../editor-core/src/preview/canvas-preview.js';
import { createCanvasEditPicker } from '../../editor-core/src/preview/canvas-edit-picking17.js';
import { loadRasterBackend } from '../frame-raster13.mjs';

const backend = loadRasterBackend();
function environment(t) {
  for (const [key, value] of Object.entries({ window: { devicePixelRatio: 1 }, OffscreenCanvas: function(w, h) { return backend.createCanvas(w, h); } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const output = backend.createCanvas(32, 32); output.getBoundingClientRect = () => ({ width: 32, height: 32 });
  const source = size => { const canvas = backend.createCanvas(size, size), ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); return canvas; };
  const layout = { preset: { width: 32, height: 32 }, boxes: [{ id: 'picture', type: 'image', x: 0, y: 0, w: 32, h: 32 }] };
  const view = { zoom: 1, viewX: 0, viewY: 0 };
  return { output, source, layout, view, draw(info, extra = {}) { const issues = []; const selection = { transparentBackground: true, showGuides: false, showScreenBoundary: false,
    imageDrawById: { picture: { state: 'ready', image: info.image, keepRatio: false, ...info } }, onImageDrawIssue: issue => issues.push(issue), ...extra };
    drawCanvasPreview(output, layout, view, selection); return { issues, selection, pixel: [...output.getContext('2d').getImageData(4, 4, 1, 1).data] }; } };
}

test('透明alpha・ゼロUV・ゼロclipの画像に未使用の効果予算エラーを出さない', { skip: !backend }, t => {
  const f = environment(t), image = f.source(2048);
  for (const empty of [{ tint: [1, 0, 0, 0] }, { alpha: 0 }, { uvSize: [0, 0], uvSizeState: 'zero' }, { clipRatio: 0 }]) {
    const result = f.draw({ image, width: 2048, height: 2048, tint: [1, 0, 0, 1], ...empty });
    assert.deepEqual(result.pixel, [0, 0, 0, 0]); assert.deepEqual(result.issues, [], JSON.stringify(empty));
  }
});

test('nine-sliceの一部patchだけ失敗しても描画不完全を通知する', { skip: !backend }, t => {
  const f = environment(t), image = f.source(4), ctx = f.output.getContext('2d'), original = ctx.drawImage.bind(ctx); let calls = 0;
  ctx.drawImage = (...args) => { if (++calls === 2) throw new Error('one patch failed'); return original(...args); };
  const result = f.draw({ image, width: 4, height: 4, nineSlice: 1 });
  assert(calls > 2); assert.deepEqual(result.issues.map(row => [row.code, row.nodeId]), [['IMAGE_DRAW_FAILED', 'picture']]);
});

test('画像診断callbackは重複を抑え128件以内で、後続の正常画像も描く', { skip: !backend }, t => {
  const f = environment(t), issues = [], image = f.source(1), imageDrawById = {};
  f.layout.boxes = Array.from({ length: 200 }, (_, i) => ({ id: `bad${i}`, type: 'image', x: 0, y: 0, w: 8, h: 8 }));
  for (const box of f.layout.boxes) imageDrawById[box.id] = { state: 'ready', image: {}, width: 4, height: 4, nineSlice: 1 };
  f.layout.boxes.push({ id: 'valid', type: 'image', x: 16, y: 0, w: 8, h: 8 });
  imageDrawById.valid = { state: 'ready', image, width: 1, height: 1, keepRatio: false };
  drawCanvasPreview(f.output, f.layout, f.view, { transparentBackground: true, showGuides: false, showScreenBoundary: false,
    imageDrawById, onImageDrawIssue: issue => issues.push(issue) });
  assert.equal(issues.length, 128); assert.equal(new Set(issues.map(issue => `${issue.code}:${issue.nodeId}`)).size, 128);
  assert.deepEqual([...f.output.getContext('2d').getImageData(20, 4, 1, 1).data], [255, 255, 255, 255]);
});

test('同じCanvasの温キャッシュでも着色結果と診断は一致し、ピクセル選択を保持する', { skip: !backend }, t => {
  const f = environment(t), image = f.source(16), info = { image, width: 16, height: 16, tint: [1, 0, 0, 0.5] };
  const cold = f.draw(info, { cacheStableSources: true, rasterCacheEpoch: 1 });
  const warm = f.draw(info, { cacheStableSources: true, rasterCacheEpoch: 1 });
  assert.deepEqual(cold.pixel, [255, 0, 0, 128]); assert.deepEqual(warm.pixel, cold.pixel);
  assert.deepEqual(cold.issues, []); assert.deepEqual(warm.issues, []);
  const picker = createCanvasEditPicker({ createCanvas: () => backend.createCanvas(1, 1) });
  assert.equal(picker.hitTest({ layout: f.layout, selection: warm.selection, view: f.view, sourceCanvas: f.output, worldX: 4, worldY: 4 })?.id, 'picture');
});

test('失敗する画像効果も実行前に画素予算を消費し、大量controlで再確保を続けない', { skip: !backend }, t => {
  const f = environment(t), image = f.source(1), imageDrawById = {}, issues = []; let allocations = 0;
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: function() {
    allocations++; return { getContext: () => ({ clearRect() {}, drawImage() { throw new Error('effect decoder unavailable'); } }) };
  } });
  f.layout.boxes = Array.from({ length: 40 }, (_, i) => ({ id: `effect${i}`, type: 'image', x: 0, y: 0, w: 16, h: 16 }));
  for (const box of f.layout.boxes) imageDrawById[box.id] = { state: 'ready', image, width: 1000, height: 1000, tint: [1, 0, 0] };
  drawCanvasPreview(f.output, f.layout, f.view, { showGuides: false, showScreenBoundary: false, imageDrawById,
    onImageDrawIssue: issue => issues.push(issue) });
  assert.equal(allocations, 16); assert.equal(issues.filter(issue => issue.code === 'IMAGE_EFFECT_FAILED').length, 16);
  assert.equal(issues.filter(issue => issue.code === 'IMAGE_EFFECT_BUDGET_EXCEEDED').length, 24);
});
