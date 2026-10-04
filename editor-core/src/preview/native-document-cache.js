/** Bounded cache for immutable ZIP JSON snapshots, shared by browser and Node.
 * Enable it only for readers whose contents do not change in place. Edited
 * documents are identified by their complete override text, never its length.
 * Limits measure retained UTF-8 source bytes, not JavaScript heap consumption.
 */
export class NativePreviewDocumentCache {
  constructor({ maxBytes = 8 * 1024 * 1024, maxEntries = 128 } = {}) {
    this.maxBytes = Math.max(1, Math.min(16 * 1024 * 1024, Number(maxBytes) || 1));
    this.maxEntries = Math.max(1, Math.min(256, Math.floor(maxEntries) || 1));
    this.owners = new WeakMap(); this.nextOwner = 1;
    this.entries = new Map(); this.bytes = 0;
    this.hits = 0; this.misses = 0; this.evictions = 0;
  }

  key(owner, path) {
    if (!owner || !['object', 'function'].includes(typeof owner)) return null;
    let id = this.owners.get(owner);
    if (!id) { id = this.nextOwner++; this.owners.set(owner, id); }
    return `${id}:${String(path)}`;
  }

  get(key, override, maxBytes) {
    const item = key ? this.entries.get(key) : null;
    if (!item || item.override !== override || item.bytes > maxBytes) {
      this.misses++; return null;
    }
    this.entries.delete(key); this.entries.set(key, item); this.hits++;
    return item.document;
  }

  set(key, override, document, bytes) {
    if (!key || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.maxBytes) return;
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key); }
    while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldest).bytes; this.entries.delete(oldest); this.evictions++;
    }
    this.entries.set(key, { override, document, bytes }); this.bytes += bytes;
  }

  snapshot() {
    return { entries: this.entries.size, sourceBytes: this.bytes, hits: this.hits, misses: this.misses, evictions: this.evictions };
  }

  clear() { this.entries.clear(); this.bytes = 0; this.owners = new WeakMap(); this.nextOwner = 1; }
}
