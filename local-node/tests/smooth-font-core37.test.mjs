import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSmoothRemapping37, compileSmoothGlyphMetrics37, rasterizeSmoothGlyph37,
  drawSmoothGlyph37, smoothGlyphCacheStats37, SMOOTH_FONT_PROFILE37 } from '../../editor-core/src/preview/smooth-font37.js';
import { glyphAddress, normalizeBitmapFontType, layoutBitmapText, drawBitmapText } from '../../editor-core/src/preview/bitmap-font.js';

const fontdata = (ratio = 0.9073984622955322) => {
  const bytes = new Uint8Array(1028), view = new DataView(bytes.buffer);
  for (let n = 0; n < 256; n++) view.setFloat32(4 + n * 4, ratio, true);
  return bytes;
};
const mapping = (...pairs) => {
  const bytes = new Uint8Array(pairs.length * 4), view = new DataView(bytes.buffer);
  pairs.forEach(([a, b], n) => { view.setUint16(n * 4, a, true); view.setUint16(n * 4 + 2, b, true); }); return bytes;
};
function smoothSheet() {
  const pixels = { width: 1024, height: 1024, data: new Uint8ClampedArray(1024 * 1024 * 4) };
  return { image: {}, status: 'ready', pixels,
    metrics: compileSmoothGlyphMetrics37(fontdata(), { sheet: 'smooth_21', width: 1024, height: 1024 }),
    createCanvas(width, height) { return { width, height, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }; },
    tinted() { throw new Error('RAW_MSDF_TINT_FORBIDDEN'); } };
}
const recorder = () => ({ globalAlpha: 1, images: [], save() {}, restore() {}, translate() {}, transform() {}, fillRect() {},
  drawImage(...args) { this.images.push(args); } });

test('明示smooth family、UTF16 remapとASCII identityを分離しbitmap経路を保持', () => {
  const remap = parseSmoothRemapping37(mapping([0x4eba, 0x2100], [0x898b, 0x2102]));
  assert.equal(normalizeBitmapFontType(' Smooth '), 'smooth');
  assert.deepEqual(glyphAddress('見', 'smooth', remap), { sheet: 'smooth_21', cell: 2 });
  assert.deepEqual(glyphAddress('A', 'smooth', remap), { sheet: 'smooth_00', cell: 65 });
  assert.deepEqual(glyphAddress('A', 'default'), { sheet: 'default8', cell: 65 });
  assert.deepEqual(glyphAddress('見', 'unicode'), { sheet: 'glyph_89', cell: 0x8b });
  assert.equal(glyphAddress('😀', 'smooth', remap), null);
  assert.equal(glyphAddress('見', 'smooth', new Map([[0x898b, NaN]])), null);
});

test('remappingの切断・重複・surrogate・過大入力を拒否', () => {
  for (const data of [new Uint8Array(), new Uint8Array(3), new Uint8Array(65536 * 4 + 4)]) assert.throws(() => parseSmoothRemapping37(data), /FONT_SMOOTH_REMAPPING_SIZE/);
  for (const data of [mapping([65, 1], [65, 2]), mapping([0xd800, 1]), mapping([65, 0xdfff])]) assert.throws(() => parseSmoothRemapping37(data), /FONT_SMOOTH_REMAPPING_ENTRY/);
});

test('fontdataのadvanceはMSDFセル比率、alpha bitmap境界から推定しない', () => {
  const metrics = compileSmoothGlyphMetrics37(fontdata(), { sheet: 'smooth_21', width: 1024, height: 1024 });
  assert.equal(metrics.format, 'msdf'); assert.equal(metrics.glyphs[2].advance, 9.678916931152344);
  assert.deepEqual([metrics.glyphs[2].sx, metrics.glyphs[2].sy, metrics.glyphs[2].sw], [128, 0, 64]);
  assert.equal(metrics.glyphs[2].drawX, 0); assert.equal(metrics.glyphs[2].drawW, 64);
  for (const [bytes, options] of [[fontdata(NaN), {}], [fontdata(-1), {}], [new Uint8Array(1024), {}], [fontdata(), { width: 128 }], [fontdata(), { sheet: '../smooth_21' }]]) {
    assert.throws(() => compileSmoothGlyphMetrics37(bytes, { sheet: 'smooth_21', width: 1024, height: 1024, ...options }), /FONT_SMOOTH_/);
  }
  const header = fontdata(); header[0] = 1; assert.throws(() => compileSmoothGlyphMetrics37(header, { sheet: 'smooth_21', width: 1024, height: 1024 }), /FONT_SMOOTH_FONTDATA_HEADER/);
});

test('全角5文字幅を保持し独立実機観測に基づく53 1/3pxの行進行を累積する', () => {
  const sheet = smoothSheet(), remapping = new Map();
  const logical = layoutBitmapText('航路を選ぶ', { fontType: 'smooth', remapping, getSheet: () => sheet });
  const physical = layoutBitmapText('航路を選ぶ', { fontType: 'smooth', remapping, fontPx: 32, roundingScale: 4, getSheet: () => sheet });
  assert.equal(logical.ready, true); assert.equal(logical.width, 49); assert.equal(physical.width, 196);
  assert.equal(layoutBitmapText('星\n見', { fontType: 'smooth', remapping, getSheet: () => sheet }).height, 13 + 40 / 3);
  assert.equal(layoutBitmapText('星\n見\n航', { fontType: 'smooth', remapping, getSheet: () => sheet }).height, 13 + 80 / 3);
  const five = layoutBitmapText('星\n見\n航\n路\n記', { fontType: 'smooth', remapping, fontPx: 32, roundingScale: 4, getSheet: () => sheet });
  assert.equal(five.lineHeight, 160 / 3);
  assert.equal(five.height, 52 + 640 / 3);
  assert.equal(logical.metricsProfile, 'observed-smooth-msdf-v2');
});

test('Map未取得はmissing診断、raw bitmapをsmoothとして受理しない', () => {
  const sheet = smoothSheet();
  const waiting = layoutBitmapText('見', { fontType: 'smooth', getSheet: () => sheet });
  assert.equal(waiting.ready, false); assert.deepEqual(waiting.missing, ['smooth_remapping']); assert.equal(waiting.issues[0].code, 'FONT_SMOOTH_REMAPPING_REQUIRED');
  const bad = layoutBitmapText('見', { fontType: 'smooth', remapping: new Map(), getSheet: () => ({ ...sheet, metrics: { ...sheet.metrics, format: 'bitmap' } }) });
  assert.equal(bad.ready, false); assert.equal(bad.issues[0].code, 'FONT_SMOOTH_METRICS_REQUIRED');
});

test('MSDFはRGB medianからcoverageを作りraw alpha/色を表示しない', () => {
  const sheet = smoothSheet(), glyph = sheet.metrics.glyphs[0];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 1024 + x) * 4; sheet.pixels.data.set(x < 32 ? [255, 0, 0, 255] : [255, 255, 0, 0], i);
  }
  const result = rasterizeSmoothGlyph37({ pixels: sheet.pixels, glyph, color: 'rgba(12,34,56,0.5)', pixelSize: 64 });
  assert.deepEqual([...result.data.slice(0, 4)], [12, 34, 56, 0]);
  assert.deepEqual([...result.data.slice(40 * 4, 41 * 4)], [12, 34, 56, 128]);
  assert.throws(() => rasterizeSmoothGlyph37({ pixels: sheet.pixels, glyph, pixelSize: 2048 }), /FONT_SMOOTH_RASTER_LIMIT/);
  assert.throws(() => rasterizeSmoothGlyph37({ pixels: sheet.pixels, glyph: { ...glyph, sx: 1020 }, pixelSize: 16 }), /FONT_SMOOTH_GLYPH_BOUNDS/);
});

test('smooth描画はtintedを呼ばず、glyph cacheをbyte/件数で有限化', () => {
  const sheet = smoothSheet(), remapping = new Map(), ctx = recorder();
  const text = layoutBitmapText('§l見', { fontType: 'smooth', remapping, getSheet: () => sheet });
  drawBitmapText(ctx, text, { x: 0, y: 0, w: 30, h: 30, shadow: true });
  assert.equal(ctx.images.length, 3);
  sheet.smoothCacheMaxBytes = 1024;
  for (let n = 0; n < 80; n++) drawSmoothGlyph37(ctx, sheet, sheet.metrics.glyphs[n], { color: '#ffffff', x: 0, y: 0, size: 8 });
  const stats = smoothGlyphCacheStats37(sheet);
  assert.ok(stats.bytes <= 1024); assert.ok(stats.entries <= SMOOTH_FONT_PROFILE37.maxCacheEntries);
});

test('非公開提供資産から抽出したremap/metricsに再現可能な値がある', t => {
  const base = new URL('../../docs/r37/device/font-source/', import.meta.url);
  let remappingBytes, metricsBytes;
  try {
    remappingBytes = readFileSync(new URL('remapping.dat', base));
    metricsBytes = readFileSync(new URL('smooth_21.fontdata', base));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('NOT_RUN: 公開版にはMinecraft提供font資産を同梱しません。合成MSDFの機能検査は別テストで実行しますが、実資産の照合成功を意味しません。');
    return;
  }
  const remap = parseSmoothRemapping37(remappingBytes);
  assert.equal(remap.size, 31232); assert.equal(remap.get(0x661f), 0x2fe0); assert.equal(remap.get(0x898b), 0x2102);
  const metrics = compileSmoothGlyphMetrics37(metricsBytes, { sheet: 'smooth_21', width: 1024, height: 1024 });
  assert.equal(metrics.glyphs[2].advanceRatio, 0.9073984622955322);
});

test('smoothの短い固定title/close高さで先頭行を負のcenter offsetにしない', () => {
  const sheet = smoothSheet(), remapping = new Map();
  const layout = layoutBitmapText('見', { fontType: 'smooth', remapping, fontPx: 32, roundingScale: 4, getSheet: () => sheet });
  assert.equal(layout.height, 52);
  for (const h of [48, 40]) {
    const ctx = recorder(), translations = [];
    ctx.translate = (x, y) => translations.push([x, y]);
    drawBitmapText(ctx, layout, { x: 416, y: 156, w: 100, h });
    assert.equal(translations[0][1], 160);
  }
  const roomy = recorder(), translations = [];
  roomy.translate = (x, y) => translations.push([x, y]);
  drawBitmapText(roomy, layout, { x: 416, y: 156, w: 100, h: 60 });
  assert.equal(translations[0][1], 164);
});

test('短い高さでもsmooth明示top/bottomと従来bitmapのcenterを変えない', () => {
  const sheet = smoothSheet(), remapping = new Map();
  const smooth = layoutBitmapText('見', { fontType: 'smooth', remapping, fontPx: 32, getSheet: () => sheet });
  for (const [vertical, expected] of [['top', 160], ['bottom', 148]]) {
    const ctx = recorder(), translations = [];
    ctx.translate = (x, y) => translations.push([x, y]);
    drawBitmapText(ctx, smooth, { x: 416, y: 156, w: 100, h: 40, vertical });
    assert.equal(translations[0][1], expected);
  }
  const bitmapSheet = { ...sheet, metrics: { ...sheet.metrics, format: 'bitmap' }, tinted: () => ({}) };
  const bitmap = layoutBitmapText('A', { fontType: 'default', fontPx: 32, getSheet: () => bitmapSheet });
  const ctx = recorder(), translations = [];
  ctx.translate = (x, y) => translations.push([x, y]);
  drawBitmapText(ctx, bitmap, { x: 416, y: 156, w: 100, h: 24 });
  assert.equal(translations[0][1], 152);
});
