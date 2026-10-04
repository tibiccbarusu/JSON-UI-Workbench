import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { createNativeTextureShader } from '../../editor-core/src/preview/native-texture-shading26.js';
import { drawCanvasPreview } from '../../editor-core/src/preview/canvas-preview.js';
import { PreviewRasterCache } from '../../editor-core/src/preview/raster-cache.js';

const backend = loadRasterBackend();
const raster = { skip: !backend };
const createSurface = (width, height) => backend.createCanvas(width, height);
const pixel = (image, x, y) => [...image.getContext('2d').getImageData(x, y, 1, 1).data];
const hash = image => createHash('sha256').update(image.getContext('2d')
  .getImageData(0, 0, image.width, image.height).data).digest('hex');

function browserContext(t) {
  const descriptors = ['window', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true,
    value: function(width, height) { return createSurface(width, height); } });
  t.after(() => descriptors.forEach(([key, descriptor]) => descriptor
    ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]));
}

function texture(size = 8) {
  const image = createSurface(size, size), ctx = image.getContext('2d');
  ctx.fillStyle = '#f06020'; ctx.fillRect(0, 0, size / 2, size / 2);
  ctx.fillStyle = 'rgba(32,160,64,.5)'; ctx.fillRect(size / 2, 0, size / 2, size / 2);
  ctx.fillStyle = '#2040e0'; ctx.fillRect(0, size / 2, size / 2, size / 2);
  return image;
}

function sceneRender(image, uv, { shade = .5, flipPoints = 0, layers = null, alpha = 1 } = {}) {
  const canvas = createSurface(64, 64);
  canvas.getBoundingClientRect = () => ({ width: 64, height: 64 });
  const points = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => ({ x, y }));
  const uvPoints = [...points.slice(flipPoints), ...points.slice(0, flipPoints)];
  const scene = { kind: 'book', faces: [{ points, uvPoints, uv, shade, texture: true }] };
  const issues = [], layout = { preset: { width: 64, height: 64 }, boxes: [
    { id: 'model', type: 'custom', x: 0, y: 0, w: 64, h: 64, renderAlpha: 1 },
  ] };
  const options = { transparentBackground: true, showGuides: false, showScreenBoundary: false,
    showResizeHandles: false, cacheStableSources: true, rasterCacheEpoch: 'atlas33',
    imageDrawById: { model: { state: 'native-scene', image, width: image.width, height: image.height,
      nativeScene: scene, imageLayers: layers, alpha } }, onNativeSceneIssue: issue => issues.push(issue) };
  const draw = () => drawCanvasPreview(canvas, layout, { zoom: 1, viewX: 0, viewY: 0 }, options);
  draw(); return { canvas, draw, issues };
}

test('r33: 大atlasの整数UV領域だけ陰影化し、位置・RGB・alpha・原画像を保つ', raster, t => {
  const atlas = createSurface(2048, 2048), source = texture();
  atlas.getContext('2d').drawImage(source, 1024, 1536);
  const before = hash(atlas), allocations = [];
  const shader = createNativeTextureShader({ createSurface: (w, h) => { allocations.push([w, h]); return createSurface(w, h); } });
  const result = shader.getForRegion(atlas, 2048, 2048, .5, { x: 1024, y: 1536, w: 8, h: 8 });
  assert.equal(result.ok, true);
  assert.deepEqual(allocations, [[8, 8]]);
  assert.equal(result.sourceOffsetX, 1024); assert.equal(result.sourceOffsetY, 1536);
  assert.deepEqual(pixel(result.image, 1, 1), [120, 48, 16, 255]);
  assert.deepEqual(pixel(result.image, 6, 1), [16, 80, 32, pixel(atlas, 1030, 1537)[3]]);
  assert.equal(pixel(result.image, 6, 6)[3], 0);
  assert.equal(hash(atlas), before);
  assert.equal(shader.snapshot().pixels, 64);
  assert.equal(shader.snapshot().avoidedAtlasPixels, 2048 * 2048 - 64);
  t.diagnostic(JSON.stringify({ atlasPixels: 2048 * 2048, processedPixels: 64,
    reductionFactor: 2048 * 2048 / 64 }));
});

test('r33: UV切り出しは上下左右反転・90度回転・model alphaでも小画像の基準画素と一致する', raster, t => {
  browserContext(t);
  const small = texture(), atlas = createSurface(2048, 2048);
  atlas.getContext('2d').drawImage(small, 1000, 1500);
  for (const flipX of [false, true]) for (const flipY of [false, true]) for (const flipPoints of [0, 1, 2, 3]) {
    const uv = { x: (1000 + (flipX ? 8 : 0)) / 2048, y: (1500 + (flipY ? 8 : 0)) / 2048,
      w: (flipX ? -8 : 8) / 2048, h: (flipY ? -8 : 8) / 2048 };
    const referenceUv = { x: Number(flipX), y: Number(flipY), w: flipX ? -1 : 1, h: flipY ? -1 : 1 };
    const reference = sceneRender(small, referenceUv, { flipPoints, alpha: .5 });
    const actual = sceneRender(atlas, uv, { flipPoints, alpha: .5 });
    assert.deepEqual(actual.issues, []);
    assert.equal(hash(actual.canvas), hash(reference.canvas), `${flipX}/${flipY}/${flipPoints}`);
    const first = hash(actual.canvas); actual.draw();
    assert.deepEqual(actual.issues, []); assert.equal(hash(actual.canvas), first, 'warm scene cacheでも一致');
  }
});

test('r33: 基本色と透明な上層で解像度が違っても同じUV位置を描画する', raster, t => {
  browserContext(t);
  const base = createSurface(2048, 2048), overlay = createSurface(4096, 4096);
  const ctx = base.getContext('2d'); ctx.fillStyle = '#c86432'; ctx.fillRect(512, 768, 8, 8);
  overlay.getContext('2d').drawImage(texture(16), 1024, 1536);
  const actual = sceneRender(base, { x: .25, y: .375, w: 8 / 2048, h: 8 / 2048 }, {
    layers: [{ image: base, width: 2048, height: 2048 }, { image: overlay, width: 4096, height: 4096 }],
  });
  assert.deepEqual(actual.issues, []);
  assert.deepEqual(pixel(actual.canvas, 48, 48), [100, 50, 25, 255]);
  assert.deepEqual(pixel(actual.canvas, 16, 16), [120, 48, 16, 255]);
});

test('r33: 小atlasは従来の全体cacheを維持し同一textureの面ごとに再処理しない', raster, () => {
  const atlas = texture(128), allocations = [];
  const shader = createNativeTextureShader({ createSurface: (w, h) => { allocations.push([w, h]); return createSurface(w, h); } });
  const first = shader.getForRegion(atlas, 128, 128, .5, { x: 0, y: 0, w: 8, h: 8 });
  const next = shader.getForRegion(atlas, 128, 128, .5, { x: 8, y: 8, w: 8, h: 8 });
  assert.equal(first, next); assert.deepEqual(allocations, [[128, 128]]);
  assert.equal(shader.snapshot().croppedVariants, 0);
});

test('r33: warm/cold cacheで切り出し予算は同じ、失敗surfaceも再試行しない', raster, () => {
  const atlas = texture(16), cache = new PreviewRasterCache(); let allocations = 0;
  const options = { maxPixels: 64, maxVariants: 1, rasterCache: cache,
    createSurface: (w, h) => { allocations++; return createSurface(w, h); } };
  for (const index of [0, 1]) {
    const shader = createNativeTextureShader(options);
    const first = shader.getForRegion(atlas, 16, 16, .5, { x: 4, y: 4, w: 8, h: 8 });
    assert.equal(first.ok, true); assert.equal(first.sourceOffsetX, 4);
    assert.equal(shader.getForRegion(atlas, 16, 16, .25, { x: 4, y: 4, w: 8, h: 8 }).issue,
      'NATIVE_PREVIEW_SHADE_BUDGET_EXCEEDED');
    assert.equal(shader.snapshot().hits, index); assert.equal(shader.snapshot().pixels, 64);
  }
  assert.equal(allocations, 1);
  const failing = createNativeTextureShader({ maxPixels: 64, createSurface: () => { throw new Error('unavailable'); } });
  const one = failing.getForRegion(atlas, 16, 16, .5, { x: 4, y: 4, w: 8, h: 8 });
  assert.equal(one.issue, 'NATIVE_PREVIEW_SHADE_UNAVAILABLE');
  assert.equal(one.image, atlas); assert.equal(one.sourceOffsetX, undefined);
  assert.equal(failing.getForRegion(atlas, 16, 16, .5, { x: 4, y: 4, w: 8, h: 8 }), one);
  assert.equal(failing.snapshot().variants, 1);
});

test('r33: 不正領域を割当前に拒否し小数UV／全atlasは従来の有限fallbackを保つ', () => {
  let allocations = 0;
  const shader = createNativeTextureShader({ maxPixels: 64, createSurface: () => { allocations++; return null; } });
  for (const region of [null, {}, { x: -1, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 0, h: 1 },
    { x: 0, y: 0, w: Infinity, h: 1 }, { x: 15, y: 0, w: 2, h: 1 }]) {
    assert.equal(shader.getForRegion({}, 16, 16, .5, region).issue, 'NATIVE_PREVIEW_SHADE_INVALID');
  }
  for (const region of [{ x: .5, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 16, h: 16 }]) {
    assert.equal(shader.getForRegion({}, 16, 16, .5, region).issue, 'NATIVE_PREVIEW_SHADE_BUDGET_EXCEEDED');
  }
  for (const width of [NaN, Infinity, 0, '16', 16385, Number.MAX_SAFE_INTEGER]) {
    assert.equal(shader.getForRegion({}, width, 16, .5, { x: 0, y: 0, w: 1, h: 1 }).issue,
      'NATIVE_PREVIEW_SHADE_INVALID');
  }
  assert.equal(allocations, 0); assert.equal(shader.snapshot().retainedSources, 0);
});

test('r33: 大atlasの異なる失敗UV領域を多数照会してもcache上限を維持する', () => {
  let allocations = 0;
  const atlas = {}, shader = createNativeTextureShader({ maxPixels: 0,
    createSurface: () => { allocations++; return null; } });
  for (let index = 0; index < 20000; index++) {
    const region = { x: index % 2048, y: Math.floor(index / 2048), w: 1, h: 1 };
    assert.equal(shader.getForRegion(atlas, 2048, 2048, .5, region).issue,
      'NATIVE_PREVIEW_SHADE_BUDGET_EXCEEDED');
  }
  assert.equal(allocations, 0); assert.equal(shader.snapshot().retainedSources, 0);
  assert.equal(shader.snapshot().retainedBudgetFailures, 1);
});
