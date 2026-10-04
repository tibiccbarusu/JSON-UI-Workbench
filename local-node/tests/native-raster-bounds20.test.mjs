import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { drawCanvasPreview } from '../../editor-core/src/preview/canvas-preview.js';
import { createCanvasEditPicker } from '../../editor-core/src/preview/canvas-edit-picking17.js';
import { compileBedrockGeometryScene } from '../../editor-core/src/preview/native-model-preview.js';
import { sampleNativePreviewMotion } from '../../editor-core/src/preview/native-motion.js';

const backend = loadRasterBackend();
const options = { skip: !backend };
const box = { id: 'model', type: 'custom', x: 64, y: 64, w: 64, h: 64, renderAlpha: 1 };
// A retained 3D camera can produce normalized coordinates outside [0, 1].
// The original normalization intentionally keeps scale/anchor fixed at turn.
function scene(points = [[-.5, .25], [1.5, .25], [1.5, .75], [-.5, .75]]) {
  return { kind: 'book', motionApplied: true, faces: [{
    points: points.map(([x, y]) => ({ x, y })),
    uv: { x: 0, y: 0, w: 1, h: 1 }, shade: 1, texture: true,
  }] };
}
function draw(t, { model = scene(), clipped = false, alpha = 1, zoom = 1, rectangle = {} } = {}) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalOffscreen = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: function(w, h) { return backend.createCanvas(w, h); } });
  t.after(() => {
    for (const [key, descriptor] of [['window', originalWindow], ['OffscreenCanvas', originalOffscreen]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const canvas = backend.createCanvas(256 * zoom, 192 * zoom);
  canvas.getBoundingClientRect = () => ({ width: 256 * zoom, height: 192 * zoom });
  const image = backend.createCanvas(4, 4), context = image.getContext('2d');
  context.fillStyle = '#20a040'; context.fillRect(0, 0, 4, 4);
  const layout = { preset: { width: 256, height: 192 }, boxes: [{ ...box, ...rectangle,
    ...(clipped ? { clipRect: { x: 48, y: 0, w: 96, h: 192 } } : {}) }] };
  const issues = [], selection = { transparentBackground: true, showGuides: false, showScreenBoundary: false,
    showResizeHandles: false, imageDrawById: { model: { state: 'native-scene', image, width: 4, height: 4, nativeScene: model, alpha } },
    onNativeSceneIssue: issue => issues.push(issue) };
  const view = { zoom, viewX: 0, viewY: 0 };
  drawCanvasPreview(canvas, layout, view, selection);
  return { canvas, layout, selection, view, issues, pixel: (x, y) => Array.from(canvas.getContext('2d').getImageData(x * zoom, y * zoom, 1, 1).data) };
}

test('回転後3Dの元正規化範囲外の画素をscratchで切り捨てない', options, t => {
  for (const zoom of [1, 2]) {
    const r = draw(t, { zoom });
    assert.deepEqual(r.issues, []);
    for (const x of [40, 80, 150]) assert.deepEqual(r.pixel(x, 96), [32, 160, 64, 255]);
    assert.equal(r.pixel(30, 96)[3], 0); assert.equal(r.pixel(162, 96)[3], 0);
  }
});

test('3D範囲拡大後も親クリップと透明度を維持する', options, t => {
  const r = draw(t, { clipped: true, alpha: .5 });
  assert.deepEqual(r.issues, []);
  assert.equal(r.pixel(40, 96)[3], 0); assert.equal(r.pixel(150, 96)[3], 0);
  assert.equal(r.pixel(52, 96)[3], 128); assert.equal(r.pixel(140, 96)[3], 128);
});

test('目視選択は拡大後3Dの可視画素を対象にし透明な外側を除く', options, t => {
  const r = draw(t), picker = createCanvasEditPicker({ createCanvas: () => backend.createCanvas(1, 1) });
  const input = { ...r, sourceCanvas: r.canvas };
  for (const worldX of [40, 80, 150]) assert.equal(picker.hitTest({ ...input, worldX, worldY: 96 })?.id, 'model');
  assert.equal(picker.hitTest({ ...input, worldX: 30, worldY: 96 }), null);
});

test('異常な3D範囲は原子的に診断し一部のモデルを公開しない', options, t => {
  const r = draw(t, { model: scene([[-5, .25], [1.5, .25], [1.5, .75], [-5, .75]]) });
  assert(r.issues.some(issue => issue.code === 'NATIVE_PREVIEW_DRAW_FAILED'));
  assert.equal(r.pixel(40, 96)[3], 0);
});

test('原geometryをコンパイルした奥行きの長いモデルも回転後のscaleを保持して全幅を描く', options, t => {
  const uv = Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map(name => [name, { uv: [0, 0], uv_size: [4, 4] }]));
  const compiled = compileBedrockGeometryScene({ description: { texture_width: 4, texture_height: 4 },
    bones: [{ name: 'body', cubes: [{ origin: [-1, -1, -6], size: [2, 2, 12], uv }] }] },
    { camera: { yaw: 0, pitch: 0 }, geometryFormatVersion: [1, 21, 0], retainMotionMesh: true });
  assert.equal(compiled.ok, true);
  const base = { ...compiled.scene, kind: 'player' };
  const turned = sampleNativePreviewMotion(base, { pointer: { active: true, x: 1, y: 0 } });
  assert.equal(turned.motionApplied, true);
  assert(Math.max(...turned.faces.flatMap(face => face.points.map(p => p.x))) > 2);
  const r = draw(t, { model: turned });
  assert.deepEqual(r.issues, []);
  // The end faces keep full coverage after the new alpha-preserving shade.
  // This test checks retained bounds, not the former omission of lighting.
  for (const x of [20, 200]) {
    const rgba = r.pixel(x, 96);
    assert.equal(rgba[3], 255);
    assert(rgba[1] > 0 && rgba[1] <= 160);
  }
});

test('拡大した実surfaceの画素数を描画予算に算入する', options, t => {
  const r = draw(t, { model: scene([[-4, -4], [4, -4], [4, 4], [-4, 4]]), zoom: 4 });
  assert(r.issues.some(issue => issue.code === 'NATIVE_PREVIEW_FRAME_BUDGET_EXCEEDED'));
  assert.equal(r.pixel(20, 96)[3], 0);
});

test('controlが画面外でも回転モデルの見える部分をcullingで消さない', options, t => {
  const r = draw(t, { model: scene([[-4, .25], [0, .25], [0, .75], [-4, .75]]), rectangle: { x: 320 } });
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.pixel(100, 96), [32, 160, 64, 255]);
});
