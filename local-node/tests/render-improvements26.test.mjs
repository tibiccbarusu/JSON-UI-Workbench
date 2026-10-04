import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { createNativeTextureShader } from '../../editor-core/src/preview/native-texture-shading26.js';
import { createBitmapGlyphTintCache } from '../../editor-core/src/preview/bitmap-glyph-tint26.js';
import { compileGlyphMetrics, layoutBitmapText, drawBitmapText } from '../../editor-core/src/preview/bitmap-font.js';
import { drawCanvasPreview } from '../../editor-core/src/preview/canvas-preview.js';
import { PreviewRasterCache } from '../../editor-core/src/preview/raster-cache.js';
import { decodeFontSheet } from '../font-sheet.mjs';

const backend = loadRasterBackend();
const raster = { skip: !backend };
const createSurface = (w, h) => backend.createCanvas(w, h);
const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
const pixel = (canvas, x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
const hash = canvas => createHash('sha256').update(pixels(canvas)).digest('hex');
function context(t) {
  const descriptors = ['window', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: function(w, h) { return createSurface(w, h); } });
  t.after(() => descriptors.forEach(([key, descriptor]) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]));
}
function source() {
  const out = createSurface(4, 4), ctx = out.getContext('2d');
  ctx.fillStyle = '#20a040'; ctx.fillRect(0, 0, 1, 4);
  ctx.fillStyle = 'rgba(32, 160, 64, 0.5)'; ctx.fillRect(1, 0, 1, 4);
  return out;
}
function renderNative(image, { shade = 1, uv = { x: 0, y: 0, w: 1, h: 1 }, layers, alpha = 1, cache = false } = {}) {
  const canvas = createSurface(64, 64); canvas.getBoundingClientRect = () => ({ width: 64, height: 64 });
  const issues = [], scene = { kind: 'book', faces: [{ points: [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => ({ x, y })), uv, shade, texture: true }] };
  const selection = { transparentBackground: true, showGuides: false, showScreenBoundary: false, showResizeHandles: false,
    cacheStableSources: cache, rasterCacheEpoch: 'fixture',
    imageDrawById: { model: { state: 'native-scene', image, width: image.width, height: image.height, nativeScene: scene, imageLayers: layers, alpha } },
    onNativeSceneIssue: issue => issues.push(issue) };
  const layout = { preset: { width: 64, height: 64 }, boxes: [{ id: 'model', type: 'custom', x: 0, y: 0, w: 64, h: 64, renderAlpha: 1 }] };
  const draw = () => drawCanvasPreview(canvas, layout, { zoom: 1, viewX: 0, viewY: 0 }, selection);
  draw(); return { canvas, issues, draw, scene };
}

test('3D陰影はRGBを変え、透明・半透明texelのalphaを維持する', raster, () => {
  const image = source(), original = hash(image);
  for (const shade of [0, .1, .5, .72, 1]) {
    const shader = createNativeTextureShader({ createSurface });
    const out = shader.get(image, 4, 4, shade);
    assert.equal(out.ok, true);
    for (const x of [0, 1, 2]) {
      const before = pixel(image, x, 1), after = pixel(out.image, x, 1);
      assert.equal(after[3], before[3]);
      if (after[3]) for (let i = 0; i < 3; i++) assert(Math.abs(after[i] - before[i] * shade) <= 2, `${shade}/${x}/${i}`);
    }
  }
  assert.equal(hash(image), original, '原textureは変更しない');
});

test('実Canvasの3D面でも陰影差とmodel alpha・透明領域を保持する', raster, t => {
  context(t); const image = source();
  const light = renderNative(image), dark = renderNative(image, { shade: .5, alpha: .5, cache: true });
  assert.deepEqual(light.issues, []); assert.deepEqual(dark.issues, []);
  assert.equal(pixel(dark.canvas, 8, 32)[3], 128);
  assert.equal(pixel(dark.canvas, 24, 32)[3], 64);
  assert.equal(pixel(dark.canvas, 48, 32)[3], 0);
  assert(pixel(dark.canvas, 8, 32)[1] < pixel(light.canvas, 8, 32)[1]);
  const first = hash(dark.canvas); dark.draw(); assert.equal(hash(dark.canvas), first);
});

test('3D texture layerごとに陰影をかけ、上層の透明部分に色を埋めない', raster, t => {
  context(t);
  const base = createSurface(4, 4); base.getContext('2d').fillStyle = '#c86432'; base.getContext('2d').fillRect(0, 0, 4, 4);
  const overlay = source();
  const out = renderNative(base, { shade: .5, layers: [{ image: base, width: 4, height: 4 }, { image: overlay, width: 4, height: 4 }] });
  assert.deepEqual(out.issues, []);
  assert.deepEqual(pixel(out.canvas, 48, 32), [100, 50, 25, 255]);
  assert.deepEqual(pixel(out.canvas, 8, 32), [16, 80, 32, 255]);
});

test('陰影の予算はwarm cacheでも同一で失敗したsourceを再割当しない', raster, () => {
  const image = source(), cache = new PreviewRasterCache(); let allocations = 0;
  const make = () => createNativeTextureShader({ createSurface: (w, h) => { allocations++; return createSurface(w, h); }, rasterCache: cache, maxPixels: 16, maxVariants: 1 });
  const a = make(); assert.equal(a.get(image, 4, 4, .5).ok, true); assert.equal(a.get(image, 4, 4, .1).issue, 'NATIVE_PREVIEW_SHADE_BUDGET_EXCEEDED');
  const b = make(); assert.equal(b.get(image, 4, 4, .5).ok, true); assert.equal(b.get(image, 4, 4, .1).issue, 'NATIVE_PREVIEW_SHADE_BUDGET_EXCEEDED');
  assert.equal(b.snapshot().hits, 1); assert.equal(allocations, 1);
  for (let i = 0; i < 10; i++) b.get(image, 4, 4, .1);
  assert.equal(b.snapshot().failures, 1); assert.equal(allocations, 1);
  const failed = createNativeTextureShader({ createSurface: () => { throw new Error('unavailable'); } });
  assert.equal(failed.get(image, 4, 4, .5).issue, 'NATIVE_PREVIEW_SHADE_UNAVAILABLE');
  assert.equal(failed.get(image, 4, 4, .5).image, image);
  assert.equal(failed.snapshot().variants, 1);
});

test('3Dのatlas境界外UVを伸長表示せず診断し、正規の負UV幅は反転する', raster, t => {
  context(t); const image = source();
  const mirrored = renderNative(image, { uv: { x: 1, y: 0, w: -1, h: 1 } });
  assert.deepEqual(mirrored.issues, []); assert.deepEqual(pixel(mirrored.canvas, 56, 32), [32, 160, 64, 255]);
  assert.equal(pixel(mirrored.canvas, 8, 32)[3], 0);
  const outside = renderNative(image, { uv: { x: -.25, y: 0, w: 1, h: 1 } });
  assert(outside.issues.some(issue => issue.code === 'NATIVE_PREVIEW_DRAW_FAILED'));
  assert.equal(pixel(outside.canvas, 5, 5)[3], 0, '失敗したtextureの断片を公開しない');
});

function fontSheet() {
  const image = createSurface(128, 128), ctx = image.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(9, 33, 4, 5);
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(13, 33, 1, 5);
  const metrics = compileGlyphMetrics({ width: 128, height: 128, data: pixels(image) }, 'default8');
  const legacy = color => {
    const out = createSurface(128, 128), c = out.getContext('2d'); c.drawImage(image, 0, 0);
    c.globalCompositeOperation = 'source-in'; c.fillStyle = color; c.fillRect(0, 0, 128, 128); return out;
  };
  const cache = createBitmapGlyphTintCache(image, createSurface);
  return { image, metrics, tinted: legacy, tintedGlyph: cache.get, cache };
}
function drawText(text, sheet, { fontPx = 8, shadow = false } = {}) {
  const layout = layoutBitmapText(text, { getSheet: () => sheet, fontPx });
  const canvas = createSurface(Math.ceil(layout.width + fontPx), Math.ceil(layout.height + fontPx));
  drawBitmapText(canvas.getContext('2d'), layout, { x: 0, y: 0, w: layout.width, h: layout.height, vertical: 'top', shadow });
  return canvas;
}

test('glyph単位着色は原atlas方式と色・alpha・太字・斜体・影の全画素が一致する', raster, () => {
  const sheet = fontSheet();
  for (const fontPx of [4, 8, 16, 32]) for (const shadow of [false, true]) {
    const text = '§cA§lA§oA§rA';
    const old = drawText(text, { ...sheet, tintedGlyph: null }, { fontPx, shadow });
    const current = drawText(text, sheet, { fontPx, shadow });
    assert.equal(hash(current), hash(old), `${fontPx}px / shadow=${shadow}`);
  }
});

test('交互5色5000glyphは全atlasを再描画せず5つのcellを再利用する', raster, t => {
  const sheet = fontSheet(), text = '§aA§bA§cA§dA§eA'.repeat(1000);
  const layout = layoutBitmapText(text, { getSheet: () => sheet });
  const canvas = createSurface(64, 16);
  drawBitmapText(canvas.getContext('2d'), layout, { x: 0, y: 0, w: layout.width, h: 8, vertical: 'top' });
  const stats = sheet.cache.snapshot();
  assert.equal(stats.misses, 5); assert.equal(stats.hits, 4995);
  assert.equal(stats.processedPixels, 320); assert.equal(stats.pixels, 320);
  t.diagnostic(JSON.stringify({ glyphs: 5000, ...stats, legacy_four_color_lru_processed_pixels: 5000 * 128 * 128 }));
});

test('glyph tint cacheは256件上限を守り不正cellを割当前に拒否する', raster, () => {
  const sheet = fontSheet(), glyph = sheet.metrics.glyphs[65];
  for (let i = 0; i < 300; i++) sheet.cache.get(`rgb(${i % 256},${Math.floor(i / 256)},0)`, glyph);
  const stats = sheet.cache.snapshot();
  assert.equal(stats.entries, 256); assert.equal(stats.pixels, 128 * 128); assert.equal(stats.evictions, 44);
  for (const invalid of [{ ...glyph, sw: 1024 }, { ...glyph, sx: -1 }, { ...glyph, sh: Infinity }]) assert.throws(() => sheet.cache.get('#ffffff', invalid), /FONT_GLYPH_TINT_INPUT/);
  assert.equal(sheet.cache.snapshot().misses, 300);
});

test('既存PNG decoderの最大1024 atlas・64pixel cellを同じ色付け経路で処理できる', raster, () => {
  const image = createSurface(1024, 1024), ctx = image.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(64, 256, 64, 64);
  const metrics = decodeFontSheet(image.toBuffer('image/png'), 'default8');
  assert.equal(metrics.glyphs[65].sw, 64);
  const cache = createBitmapGlyphTintCache(image, createSurface);
  const out = cache.get('#ff0000', metrics.glyphs[65]);
  assert.equal(out.width, 64); assert.equal(out.height, 64);
  assert.deepEqual(pixel(out, 32, 32), [255, 0, 0, 255]);
  for (let i = 0; i < 255; i++) cache.get(`rgb(${i},1,0)`, metrics.glyphs[65]);
  assert.equal(cache.snapshot().pixels, image.width * image.height);
  for (const width of [2048, 4096]) {
    const header = Buffer.from(image.toBuffer('image/png')); header.writeUInt32BE(width, 16); header.writeUInt32BE(width, 20);
    assert.throws(() => decodeFontSheet(header, 'default8'), /FONT_SHEET_DIMENSIONS/, '元から対応外であり今回の制限ではない');
  }
});

test('大きな3D textureは陰影予算超過を毎回通知し元画像を保持する', raster, t => {
  context(t); const image = createSurface(2048, 2048), ctx = image.getContext('2d');
  ctx.fillStyle = '#20a040'; ctx.fillRect(0, 0, 2048, 2048);
  const result = renderNative(image, { shade: .5, cache: true });
  assert.deepEqual(pixel(result.canvas, 32, 32), [32, 160, 64, 255]);
  assert(result.issues.some(issue => issue.code === 'NATIVE_PREVIEW_SHADE_BUDGET_EXCEEDED'));
  result.issues.length = 0; const first = hash(result.canvas); result.draw();
  assert.equal(hash(result.canvas), first);
  assert(result.issues.some(issue => issue.code === 'NATIVE_PREVIEW_SHADE_BUDGET_EXCEEDED'), 'scene cacheで未適用診断を隠さない');
});
