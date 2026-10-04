import { createHash } from 'node:crypto';

/** Cache immutable serialized values only; callers cannot mutate the retained result. */
export class ResponseCache {
  constructor({ maxBytes, maxEntries = 64 }) { this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.rows = new Map(); this.bytes = 0; this.hits = 0; this.misses = 0; this.evictions = 0; }
  get(key) { const row = this.rows.get(key); if (!row) { this.misses++; return null; } this.hits++; this.rows.delete(key); this.rows.set(key, row); return row.value; }
  set(key, value) {
    const size = typeof value.body === 'string' ? Buffer.byteLength(value.body) : value.body.byteLength;
    if (size > this.maxBytes) return value;
    if (this.rows.has(key)) { this.bytes -= this.rows.get(key).size; this.rows.delete(key); }
    while (this.rows.size && (this.rows.size >= this.maxEntries || this.bytes + size > this.maxBytes)) { const first = this.rows.keys().next().value; this.bytes -= this.rows.get(first).size; this.rows.delete(first); this.evictions++; }
    this.rows.set(key, { value, size }); this.bytes += size; return value;
  }
  clear() { this.rows.clear(); this.bytes = 0; }
  snapshot() { return { entries: this.rows.size, bytes: this.bytes, max_bytes: this.maxBytes, hits: this.hits, misses: this.misses, evictions: this.evictions }; }
}

export function responseKey(value) {
  // JSON input is already size bounded. Sort object keys so equivalent variable maps share work.
  const normalize = (item, depth = 0) => {
    if (depth > 64) throw Object.assign(new Error('NODE_REQUEST_DEPTH_LIMIT'), { status: 413 });
    if (Array.isArray(item)) return item.map(x => normalize(x, depth + 1));
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key], depth + 1)]));
  };
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
