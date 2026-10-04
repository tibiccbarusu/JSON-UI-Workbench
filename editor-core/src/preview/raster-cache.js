/** Pixel-bounded LRU for explicitly immutable preview source snapshots. */
export class PreviewRasterCache {
  constructor({ maxPixels = 8_000_000, maxEntries = 128 } = {}) {
    this.maxPixels = Math.max(1, Math.min(16_000_000, Math.floor(maxPixels) || 8_000_000));
    this.maxEntries = Math.max(1, Math.min(256, Math.floor(maxEntries) || 128));
    this.entries = new Map(); this.ids = new WeakMap(); this.nextId = 1;
    this.pixels = 0; this.hits = 0; this.misses = 0;
  }
  key(parts) {
    return JSON.stringify(parts.map((part) => {
      if (part && (typeof part === 'object' || typeof part === 'function')) {
        if (!this.ids.has(part)) this.ids.set(part, this.nextId++);
        return ['ref', this.ids.get(part)];
      }
      return part;
    }));
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) { this.misses++; return null; }
    this.hits++; this.entries.delete(key); this.entries.set(key, entry);
    return entry.surface;
  }
  set(key, surface, pixels) {
    if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > this.maxPixels) return surface;
    const previous = this.entries.get(key);
    if (previous) { this.pixels -= previous.pixels; this.entries.delete(key); }
    while (this.entries.size && (this.entries.size >= this.maxEntries || this.pixels + pixels > this.maxPixels)) {
      const oldest = this.entries.keys().next().value;
      this.pixels -= this.entries.get(oldest).pixels; this.entries.delete(oldest);
    }
    this.entries.set(key, { surface, pixels }); this.pixels += pixels;
    return surface;
  }
  snapshot() { return { entries: this.entries.size, pixels: this.pixels, hits: this.hits, misses: this.misses }; }
}
