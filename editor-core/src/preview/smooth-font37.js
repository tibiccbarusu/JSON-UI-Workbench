// Explicit preview profile derived from the supplied smooth MSDF resources
// and bounded device captures. This does not certify arbitrary font aliases,
// native shader parity, or every Minecraft release.
export const SMOOTH_FONT_PROFILE37 = Object.freeze({
  id: 'observed-smooth-msdf-v2', atlasSize: 1024, cellSize: 64,
  // R38: Chrono five-line and independent Starlane two/three-line captures
  // support 53 1/3 physical pixels at fontPx=8, UI scale 4. Keep fractional
  // advance until rasterization; rounding every line to 54 accumulates drift.
  cellPerFontPx: 4 / 3, lineHeightPerFontPx: 5 / 3,
  lineBoxPerFontPx: 13 / 8, drawOffsetPerFontPx: 1 / 8,
  distanceRange: 8, maxGlyphPixels: 1048576, maxCacheBytes: 524288,
  maxCacheEntries: 64,
});

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('FONT_SMOOTH_BYTES_REQUIRED');
}
const bmp = value => Number.isInteger(value) && value >= 0 && value <= 65535
  && !(value >= 0xd800 && value <= 0xdfff);

export function parseSmoothRemapping37(value) {
  const bytes = bytesOf(value);
  if (!bytes.length || bytes.length % 4 || bytes.length > 65536 * 4) throw new Error('FONT_SMOOTH_REMAPPING_SIZE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = new Map();
  for (let i = 0; i < bytes.length; i += 4) {
    const source = view.getUint16(i, true), target = view.getUint16(i + 2, true);
    if (!bmp(source) || !bmp(target) || result.has(source)) throw new Error('FONT_SMOOTH_REMAPPING_ENTRY');
    result.set(source, target);
  }
  return result;
}

export function smoothGlyphAddress37(character, remapping) {
  const cp = String(character).codePointAt(0);
  if (!bmp(cp)) return null;
  // Identity is the observed unmapped ASCII/resource-address rule. A mapped
  // codepoint never silently falls back when its mapped asset is unavailable.
  const mapped = remapping instanceof Map && remapping.has(cp) ? remapping.get(cp) : cp;
  if (!bmp(mapped)) return null;
  return { sheet: `smooth_${(mapped >>> 8).toString(16).padStart(2, '0').toUpperCase()}`, cell: mapped & 255 };
}

export function compileSmoothGlyphMetrics37(value, { sheet, width, height } = {}) {
  const bytes = bytesOf(value);
  if (!/^smooth_[0-9A-F]{2}$/u.test(String(sheet)) || width !== 1024 || height !== 1024) throw new Error('FONT_SMOOTH_SHEET_DIMENSIONS');
  if (bytes.length !== 1028) throw new Error('FONT_SMOOTH_FONTDATA_SIZE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0) throw new Error('FONT_SMOOTH_FONTDATA_HEADER');
  const glyphs = [];
  for (let n = 0; n < 256; n++) {
    const ratio = view.getFloat32(4 + n * 4, true);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 4) throw new Error('FONT_SMOOTH_ADVANCE');
    glyphs.push({ cell: n, sx: (n % 16) * 64, sy: Math.floor(n / 16) * 64,
      sw: 64, sh: 64, drawX: 0, drawW: 64, advance: ratio * 8 * 4 / 3,
      advanceRatio: ratio, empty: ratio === 0, ink: null });
  }
  return { width, height, sheet, cellSize: 64, glyphs, format: 'msdf',
    profile: SMOOTH_FONT_PROFILE37.id, metricsProfile: SMOOTH_FONT_PROFILE37.id };
}

function colorRgba(value) {
  const color = String(value || '#ffffff').trim();
  if (/^#[\da-f]{3}$/iu.test(color)) return [...color.slice(1)].map(x => parseInt(x + x, 16)).concat(255);
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/iu.test(color)) {
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), color.length === 9 ? parseInt(color.slice(7, 9), 16) : 255];
  }
  const functional = /^(rgb|rgba)\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/iu.exec(color);
  if (functional) {
    const values = functional.slice(2, 5).map(Number), alpha = functional[5] === undefined ? 1 : Number(functional[5]);
    if (values.every(x => Number.isFinite(x) && x >= 0 && x <= 255) && Number.isFinite(alpha) && alpha >= 0 && alpha <= 1
      && (functional[1].toLowerCase() === 'rgba') === (functional[5] !== undefined)) return values.map(Math.round).concat(Math.round(alpha * 255));
  }
  const named = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', transparent: '#00000000' };
  if (Object.hasOwn(named, color.toLowerCase())) return colorRgba(named[color.toLowerCase()]);
  throw new Error('FONT_SMOOTH_COLOR');
}

export function rasterizeSmoothGlyph37({ pixels, glyph, color = '#ffffff', pixelSize, phaseX = 0, phaseY = 0, distanceRange = 8 } = {}) {
  const { width: aw, height: ah, data: source } = pixels || {};
  if (aw !== 1024 || ah !== 1024 || !source || source.length !== aw * ah * 4) throw new Error('FONT_SMOOTH_PIXELS');
  if (!glyph || ![glyph.sx, glyph.sy, glyph.sw, glyph.sh].every(Number.isInteger)
    || glyph.sw !== 64 || glyph.sh !== 64 || glyph.sx < 0 || glyph.sy < 0
    || glyph.sx + 64 > aw || glyph.sy + 64 > ah) throw new Error('FONT_SMOOTH_GLYPH_BOUNDS');
  if (![pixelSize, phaseX, phaseY, distanceRange].every(Number.isFinite) || pixelSize <= 0
    || phaseX < 0 || phaseX >= 1 || phaseY < 0 || phaseY >= 1 || distanceRange <= 0 || distanceRange > 32) throw new Error('FONT_SMOOTH_RASTER_ARGUMENT');
  const width = Math.ceil(pixelSize + phaseX), height = Math.ceil(pixelSize + phaseY);
  if (!Number.isSafeInteger(width * height) || width * height > SMOOTH_FONT_PROFILE37.maxGlyphPixels) throw new Error('FONT_SMOOTH_RASTER_LIMIT');
  const out = new Uint8ClampedArray(width * height * 4), rgba = colorRgba(color);
  const scale = pixelSize / 64, screenRange = Math.max(1, distanceRange * scale);
  const sample = (x, y, ch) => source[((glyph.sy + y) * aw + glyph.sx + x) * 4 + ch] / 255;
  for (let y = 0; y < height; y++) {
    const sy = (y + 0.5 - phaseY) / scale - 0.5;
    if (sy < -0.5 || sy >= 63.5) continue;
    const py = Math.max(0, Math.min(63, sy)), iy = Math.floor(py), jy = Math.min(63, iy + 1), fy = py - iy;
    for (let x = 0; x < width; x++) {
      const sx = (x + 0.5 - phaseX) / scale - 0.5;
      if (sx < -0.5 || sx >= 63.5) continue;
      const px = Math.max(0, Math.min(63, sx)), ix = Math.floor(px), jx = Math.min(63, ix + 1), fx = px - ix;
      const rgb = [0, 1, 2].map(ch => {
        const top = sample(ix, iy, ch) * (1 - fx) + sample(jx, iy, ch) * fx;
        const bottom = sample(ix, jy, ch) * (1 - fx) + sample(jx, jy, ch) * fx;
        return top * (1 - fy) + bottom * fy;
      });
      const median = Math.max(Math.min(rgb[0], rgb[1]), Math.min(Math.max(rgb[0], rgb[1]), rgb[2]));
      const alpha = Math.max(0, Math.min(1, screenRange * (median - 0.5) + 0.5));
      const offset = (y * width + x) * 4;
      out[offset] = rgba[0]; out[offset + 1] = rgba[1]; out[offset + 2] = rgba[2]; out[offset + 3] = Math.round(rgba[3] * alpha);
    }
  }
  return { width, height, data: out, profile: SMOOTH_FONT_PROFILE37.id };
}

const sheetCaches = new WeakMap();
export function smoothGlyphCacheStats37(sheet) {
  const cache = sheetCaches.get(sheet);
  return { bytes: cache?.bytes || 0, entries: cache?.entries.size || 0 };
}
function glyphCanvas(sheet, glyph, color, size, phaseX, phaseY) {
  let cache = sheetCaches.get(sheet);
  if (!cache) { cache = { bytes: 0, entries: new Map() }; sheetCaches.set(sheet, cache); }
  const key = `${glyph.cell}|${color}|${size}|${phaseX}|${phaseY}`;
  if (cache.entries.has(key)) {
    const hit = cache.entries.get(key); cache.entries.delete(key); cache.entries.set(key, hit); return hit.canvas;
  }
  const image = rasterizeSmoothGlyph37({ pixels: sheet.pixels, glyph, color, pixelSize: size, phaseX, phaseY });
  const canvas = typeof sheet.createCanvas === 'function' ? sheet.createCanvas(image.width, image.height)
    : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(image.width, image.height)
      : typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) throw new Error('FONT_SMOOTH_CANVAS_REQUIRED');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d'), data = ctx.createImageData(image.width, image.height);
  data.data.set(image.data); ctx.putImageData(data, 0, 0);
  const bytes = image.width * image.height * 4;
  const declaredLimit = Number(sheet.smoothCacheMaxBytes);
  const cacheLimit = Number.isFinite(declaredLimit) && declaredLimit >= 0
    ? Math.min(SMOOTH_FONT_PROFILE37.maxCacheBytes, Math.floor(declaredLimit)) : SMOOTH_FONT_PROFILE37.maxCacheBytes;
  if (bytes <= cacheLimit) {
    while (cache.entries.size && (cache.bytes + bytes > cacheLimit || cache.entries.size >= SMOOTH_FONT_PROFILE37.maxCacheEntries)) {
      const oldest = cache.entries.keys().next().value, removed = cache.entries.get(oldest);
      cache.entries.delete(oldest); cache.bytes -= removed.bytes;
    }
    cache.entries.set(key, { canvas, bytes }); cache.bytes += bytes;
  }
  return canvas;
}

export function drawSmoothGlyph37(ctx, sheet, glyph, { color, x, y, size, deviceScale = 1 } = {}) {
  if (!sheet?.pixels || sheet?.metrics?.format !== 'msdf') throw new Error('FONT_SMOOTH_ASSET_REQUIRED');
  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const axisAligned = !transform || (transform.b === 0 && transform.c === 0 && transform.a > 0 && transform.d > 0 && Math.abs(transform.a - transform.d) < 1e-6);
  const sx = transform ? transform.a * x + transform.c * y + transform.e : x;
  const sy = transform ? transform.b * x + transform.d * y + transform.f : y;
  const phaseX = axisAligned ? sx - Math.floor(sx) : 0, phaseY = axisAligned ? sy - Math.floor(sy) : 0;
  const image = glyphCanvas(sheet, glyph, color, size * deviceScale, phaseX, phaseY);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, x - phaseX / deviceScale, y - phaseY / deviceScale, image.width / deviceScale, image.height / deviceScale);
}
