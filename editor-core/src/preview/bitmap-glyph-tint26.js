// Tint only one original glyph cell. A five-colour label must not repaint the
// entire 256-cell atlas for every character when its four-colour LRU churns.
export function createBitmapGlyphTintCache(image, createSurface, { maxEntries = 256 } = {}) {
  if (!image || !Number.isSafeInteger(image.width) || image.width !== image.height
    || image.width < 128 || image.width > 1024 || image.width % 16
    || typeof createSurface !== 'function' || !Number.isSafeInteger(maxEntries)
    || maxEntries < 1 || maxEntries > 256) throw new Error('FONT_GLYPH_TINT_OPTIONS');
  const rows = new Map();
  const stats = { hits: 0, misses: 0, evictions: 0, invalidations: 0, processedPixels: 0, pixels: 0 };
  function get(color, glyph) {
    if (typeof color !== 'string' || color.length > 128 || !glyph
      || ![glyph.sx, glyph.sy, glyph.sw, glyph.sh].every(Number.isSafeInteger)
      || glyph.sx < 0 || glyph.sy < 0 || glyph.sw < 1 || glyph.sh < 1
      || glyph.sw !== image.width / 16 || glyph.sh !== image.height / 16
      || glyph.sx + glyph.sw > image.width || glyph.sy + glyph.sh > image.height) {
      throw new Error('FONT_GLYPH_TINT_INPUT');
    }
    const key = JSON.stringify([glyph.sx, glyph.sy, glyph.sw, glyph.sh, color]);
    const hit = rows.get(key);
    if (hit) { rows.delete(key); rows.set(key, hit); stats.hits++; return hit.image; }
    stats.misses++;
    const surface = createSurface(glyph.sw, glyph.sh), ctx = surface?.getContext('2d');
    if (!ctx) throw new Error('FONT_GLYPH_TINT_UNAVAILABLE');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, glyph.sx, glyph.sy, glyph.sw, glyph.sh, 0, 0, glyph.sw, glyph.sh);
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color;
    ctx.fillRect(0, 0, glyph.sw, glyph.sh);
    const pixels = glyph.sw * glyph.sh;
    while (rows.size >= maxEntries) {
      const oldest = rows.keys().next().value;
      stats.pixels -= rows.get(oldest).pixels; rows.delete(oldest); stats.evictions++;
    }
    rows.set(key, { image: surface, pixels }); stats.pixels += pixels; stats.processedPixels += pixels;
    return surface;
  }
  return { get, clear() { rows.clear(); stats.pixels = 0; stats.invalidations++; },
    snapshot: () => ({ ...stats, entries: rows.size, maxEntries }) };
}
