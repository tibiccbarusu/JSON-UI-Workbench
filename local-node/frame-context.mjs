import { randomUUID } from 'node:crypto';
import { responseKey } from './response-cache.mjs';
import { fail } from './limits.mjs';

/** State changes are validated once by FrameIrProcessor; playback refers to
 * that immutable request using a model-bound token. No authored input is
 * skipped merely because its object identity happens to look unchanged. */
export class FrameContextCache {
  constructor({ maxBytes = 8 * 1024 * 1024, maxEntries = 8, contextBytes = 2 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.contextBytes = contextBytes;
    this.rows = new Map(); this.bytes = 0; this.metrics = { registered: 0, reused: 0, evicted: 0, too_large: 0 };
  }
  clear() { this.rows.clear(); this.bytes = 0; }
  snapshot() { return { ...this.metrics, entries: this.rows.size, bytes: this.bytes, max_bytes: this.maxBytes }; }
  resolve(input) {
    if (typeof input.contextId !== 'string' || !/^[0-9a-f-]{36}$/u.test(input.contextId)) fail('NODE_FRAME_CONTEXT_INVALID');
    if (Object.keys(input).some(key => !['contextId', 'modelId', 'animationTime', 'generation', 'frameTransport', 'previousFrameId'].includes(key))) fail('NODE_FRAME_CONTEXT_INVALID');
    const row = this.rows.get(input.contextId);
    if (!row || row.modelId !== input.modelId) fail('NODE_FRAME_CONTEXT_STALE', 409);
    this.rows.delete(row.id); this.rows.set(row.id, row); this.metrics.reused++;
    return row;
  }
  capture(modelId, request) {
    const { generation, animationTime, frameTransport, previousFrameId, ...state } = request;
    const json = JSON.stringify(state), bytes = Buffer.byteLength(json);
    if (bytes > this.contextBytes || bytes > this.maxBytes) { this.metrics.too_large++; return null; }
    const key = responseKey(state);
    for (const row of this.rows.values()) if (row.modelId === modelId && row.key === key) return row;
    while (this.rows.size && (this.rows.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
      const id = this.rows.keys().next().value; this.bytes -= this.rows.get(id).bytes; this.rows.delete(id); this.metrics.evicted++;
    }
    const row = { id: randomUUID(), modelId, key, request: structuredClone(state), bytes,
      bindingKey: responseKey({ qualifiedName: state.qualifiedName, mockData: state.mockData, collectionData: state.collectionData,
        uiInstanceId: state.uiInstanceId, localToggleState: state.localToggleState }) };
    this.rows.set(row.id, row); this.bytes += bytes; this.metrics.registered++;
    return row;
  }
}
