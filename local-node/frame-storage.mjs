import { fail } from './limits.mjs';

/** Exact JSON UTF-8 accounting for Node-owned immutable IR. It does not accept
 * externally mutable input: FrameIrProcessor snapshots models at its boundary
 * and creates fresh changed property/box records before calling this helper.
 * Weak references let evicted frames and their byte metadata be collected. */
export class ImmutableJsonSize {
  constructor() { this.clear(); }
  clear() { this.sizes = new WeakMap(); this.keys = new Map(); }
  bytes(value, maximum = Infinity) {
    const active = new WeakSet();
    const visit = (item, depth = 0) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') return undefined;
      if (item === null) return 4;
      if (typeof item !== 'object') {
        let json;
        try { json = JSON.stringify(item); } catch { fail('NODE_FRAME_REPLY_LIMIT', 413); }
        return Buffer.byteLength(json);
      }
      const retained = this.sizes.get(item);
      if (retained !== undefined) return retained;
      if (active.has(item) || depth > 768) fail('NODE_FRAME_REPLY_LIMIT', 413);
      const toJson = Object.getOwnPropertyDescriptor(item, 'toJSON');
      if (toJson && (!Object.hasOwn(toJson, 'value') || typeof toJson.value === 'function')) fail('NODE_FRAME_REPLY_LIMIT', 413);
      const prototype = Object.getPrototypeOf(item);
      if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) fail('NODE_FRAME_REPLY_LIMIT', 413);
      active.add(item);
      let size = 2, count = 0;
      if (Array.isArray(item)) {
        for (let i = 0; i < item.length; i++) {
          size += (count++ ? 1 : 0) + (visit(item[i], depth + 1) ?? 4);
          if (size > maximum) fail('NODE_FRAME_REPLY_LIMIT', 413);
        }
      } else {
        for (const key of Object.keys(item)) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('NODE_FRAME_REPLY_LIMIT', 413);
          const child = visit(descriptor.value, depth + 1);
          if (child === undefined) continue;
          let keyBytes = this.keys.get(key);
          if (keyBytes === undefined) {
            keyBytes = Buffer.byteLength(JSON.stringify(key));
            if (this.keys.size < 4096 && key.length <= 1024) this.keys.set(key, keyBytes);
          }
          size += (count++ ? 1 : 0) + keyBytes + 1 + child;
          if (size > maximum) fail('NODE_FRAME_REPLY_LIMIT', 413);
        }
      }
      active.delete(item); this.sizes.set(item, size); return size;
    };
    const bytes = visit(value);
    if (bytes === undefined || bytes > maximum) fail('NODE_FRAME_REPLY_LIMIT', 413);
    return bytes;
  }
}

/** Node-owned IR cache. Byte limits count the complete JSON representation,
 * even when multiple frames share unchanged boxes. No repeated full stringify
 * or parse is required before the delta encoder can inspect a cache hit. */
export class FrameResultCache {
  constructor({ maxBytes, maxEntries = 24 }) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries;
    this.rows = new Map(); this.bytes = 0; this.hits = 0; this.misses = 0; this.evictions = 0;
  }
  get(key) {
    const row = this.rows.get(key);
    if (!row) { this.misses++; return null; }
    this.hits++; this.rows.delete(key); this.rows.set(key, row); return row;
  }
  set(key, result, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) return;
    if (this.rows.has(key)) { this.bytes -= this.rows.get(key).bytes; this.rows.delete(key); }
    while (this.rows.size && (this.rows.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
      const first = this.rows.keys().next().value;
      this.bytes -= this.rows.get(first).bytes; this.rows.delete(first); this.evictions++;
    }
    this.rows.set(key, { result, bytes }); this.bytes += bytes;
  }
  clear() { this.rows.clear(); this.bytes = 0; }
  snapshot() { return { entries: this.rows.size, bytes: this.bytes, max_bytes: this.maxBytes,
    hits: this.hits, misses: this.misses, evictions: this.evictions }; }
}
