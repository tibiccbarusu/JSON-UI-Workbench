import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const same = (a, b) => a === b || isDeepStrictEqual(a, b);
function changes(before = {}, after = {}) {
  const set = Object.create(null), remove = [];
  for (const key of Object.keys(after)) if (after[key] !== undefined && !same(before[key], after[key])) set[key] = after[key];
  for (const key of Object.keys(before)) if (before[key] !== undefined && (!Object.hasOwn(after, key) || after[key] === undefined)) remove.push(key);
  return { set, remove };
}
function layoutChanges(before, after) {
  // Visibility, clipping and ordering changes retain the complete new box list.
  // Stable topology can use per-field patches (including alpha/position changes).
  const { boxes: oldBoxes, ...oldMeta } = before;
  const { boxes, ...meta } = after;
  if (oldBoxes.length !== boxes.length || boxes.some((box, i) => box.id !== oldBoxes[i].id)) return { replace: after };
  const patches = [];
  for (let i = 0; i < boxes.length; i++) {
    if (oldBoxes[i] === boxes[i]) continue;
    const patch = changes(oldBoxes[i], boxes[i]);
    if (Object.keys(patch.set).length || patch.remove.length) patches.push([i, patch]);
  }
  return { meta: changes(oldMeta, meta), boxCount: boxes.length, boxes: patches };
}

/** Bounded, optional delta wire format. Tokens are meaningful only for the
 * exact retained model and response; loss/eviction always returns a full frame.
 * Execution results are immutable inside FrameIrProcessor. Snapshots share
 * them instead of making an additional deep copy of the large layout. */
export class FrameDeltaEncoder {
  constructor({ maxBytes = 24 * 1024 * 1024, maxEntries = 8 } = {}) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.rows = new Map(); this.bytes = 0;
    this.metrics = { full: 0, delta: 0, fallback: 0, bytes_saved: 0, evicted: 0 };
  }
  clear() { this.rows.clear(); this.bytes = 0; }
  snapshot() { return { ...this.metrics, entries: this.rows.size, bytes: this.bytes, max_bytes: this.maxBytes }; }
  encode(result, previousFrameId, fullBytes, contextId) {
    const before = this.rows.get(result.modelId), frameId = randomUUID();
    const canDelta = Boolean(before && before.frameId === previousFrameId);
    const transport = { fullBytes: fullBytes + 1024, ...(contextId ? { contextId } : {}) };
    let encoded;
    if (canDelta) {
      const { layout, propsById, basePropsById, ...rest } = result;
      const delta = { ...rest, schema: 'jsonui-frame-delta-v1', frameId, baseFrameId: before.frameId, transport,
        layoutDelta: layoutChanges(before.result.layout, layout),
        propsDelta: changes(before.result.propsById, propsById), basePropsDelta: changes(before.result.basePropsById, basePropsById) };
      const body = JSON.stringify(delta);
      // Some frames replace most boxes. Full output is then the simpler wire.
      if (Buffer.byteLength(body) < fullBytes * 0.9) {
        encoded = body; this.metrics.delta++; this.metrics.bytes_saved += Math.max(0, fullBytes - Buffer.byteLength(body));
      }
    } else if (previousFrameId) this.metrics.fallback++;
    if (encoded === undefined) { encoded = JSON.stringify({ ...result, frameId, transport }); this.metrics.full++; }
    if (before) { this.rows.delete(result.modelId); this.bytes -= before.bytes; }
    const bytes = transport.fullBytes;
    if (bytes <= this.maxBytes) {
      while (this.rows.size && (this.rows.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
        const key = this.rows.keys().next().value; this.bytes -= this.rows.get(key).bytes; this.rows.delete(key); this.metrics.evicted++;
      }
      this.rows.set(result.modelId, { frameId, result, bytes }); this.bytes += bytes;
    }
    return encoded;
  }
}
