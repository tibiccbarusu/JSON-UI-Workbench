// Browser-safe synchronous cache. The existing glyph layout and draw functions
// do not mutate layouts; font sheets remain owned by BitmapFontCache.
export class BitmapTextLayoutCache {
  constructor(fontCache, { maxEntries = 512, maxGlyphs = 65536, maxTextUnits = 262144 } = {}) {
    if (!fontCache || typeof fontCache.get !== 'function') throw new Error('FONT_LAYOUT_CACHE_SOURCE_INVALID');
    if (![maxEntries, maxGlyphs, maxTextUnits].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('FONT_LAYOUT_CACHE_LIMIT_INVALID');
    this.fontCache = fontCache; this.maxEntries = maxEntries; this.maxGlyphs = maxGlyphs; this.maxTextUnits = maxTextUnits;
    this.rows = new Map(); this.glyphs = 0; this.textUnits = 0; this.revision = fontCache.revision;
    this.metrics = { hits: 0, misses: 0, invalidations: 0, evictions: 0, bypasses: 0 };
  }
  clear() { this.rows.clear(); this.glyphs = 0; this.textUnits = 0; this.revision = this.fontCache.revision; }
  remove(key) {
    const row = this.rows.get(key); if (!row) return;
    this.rows.delete(key); this.glyphs -= row.glyphs; this.textUnits -= row.textUnits;
  }
  getOrCreate(text, options, { sources, locale }, build) {
    if (this.revision !== this.fontCache.revision) { this.clear(); this.metrics.invalidations++; }
    const { fontType = 'default', fontPx = 8, color = '#ffffff', linePadding = 0, maxWidth, remapping, roundingScale = 1, fontProfile = 'bitmap' } = options;
    // Invalid inputs must reach the normal layout validator. In particular,
    // JSON.stringify maps Infinity/NaN/undefined to overlapping key values.
    if (typeof text !== 'string' || typeof fontType !== 'string' || typeof color !== 'string'
      || !Number.isFinite(fontPx) || fontPx <= 0 || fontPx > 4096
      || !Number.isFinite(linePadding) || linePadding < 0 || linePadding > 4096
      || (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0))
      || !Number.isFinite(roundingScale) || roundingScale <= 0 || roundingScale > 4096
      || !['bitmap', 'observed-smooth'].includes(fontProfile)
      || !Array.isArray(sources) || typeof locale !== 'string') {
      this.metrics.bypasses++; return build();
    }
    const key = JSON.stringify([sources.map(source => [source.kind, source.id]), locale,
      text, fontType, fontPx, color, linePadding, maxWidth ?? null, roundingScale, fontProfile]);
    const hit = this.rows.get(key);
    if (hit) {
      // Keep active sheets recent and verify identity even if a custom cache
      // owner missed a revision bump. Never return an evicted/closed sheet.
      if (hit.remapping === remapping && hit.sheets.every(sheet => this.fontCache.get(sources, locale, sheet.sheet) === sheet && sheet.status === 'ready')) {
        this.rows.delete(key); this.rows.set(key, hit); this.metrics.hits++; return hit.layout;
      }
      this.remove(key); this.metrics.invalidations++;
    }
    this.metrics.misses++;
    const layout = build();
    // A loading/missing glyph must be recomputed when data arrives; retaining
    // only fully ready layouts also preserves the existing diagnostic flow.
    if (!layout?.ready || !Array.isArray(layout.lines)) return layout;
    let glyphs = 0; const sheets = new Set();
    for (const line of layout.lines) {
      if (!Array.isArray(line.glyphs)) return layout;
      glyphs += line.glyphs.length;
      for (const glyph of line.glyphs) if (glyph.sheet) sheets.add(glyph.sheet);
    }
    if (glyphs > this.maxGlyphs || key.length > this.maxTextUnits || !this.maxEntries) { this.metrics.bypasses++; return layout; }
    // `build` is synchronous, but callers may change resources inside their
    // callback. Such a result belongs to an obsolete generation.
    if (this.revision !== this.fontCache.revision
      || [...sheets].some(sheet => sheet.status !== 'ready' || this.fontCache.get(sources, locale, sheet.sheet) !== sheet)) return layout;
    while (this.rows.size && (this.rows.size >= this.maxEntries || this.glyphs + glyphs > this.maxGlyphs || this.textUnits + key.length > this.maxTextUnits)) {
      this.remove(this.rows.keys().next().value); this.metrics.evictions++;
    }
    this.rows.set(key, { layout, glyphs, textUnits: key.length, sheets: [...sheets], remapping });
    this.glyphs += glyphs; this.textUnits += key.length; return layout;
  }
  stats() { return { ...this.metrics, entries: this.rows.size, glyphs: this.glyphs, textUnits: this.textUnits,
    maxEntries: this.maxEntries, maxGlyphs: this.maxGlyphs, maxTextUnits: this.maxTextUnits, revision: this.revision }; }
}
