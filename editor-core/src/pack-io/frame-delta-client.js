const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function invalid() { throw new Error('NODE_FRAME_DELTA_INVALID'); }
const token = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
function checkedBox(box) {
  if (!object(box) || typeof box.id !== 'string' || !box.id.length
    || ![box.x, box.y, box.w, box.h].every(value => typeof value === 'number' && Number.isFinite(value))
    || box.w < 0 || box.h < 0) invalid();
}
function checkedLayout(layout) {
  if (!object(layout) || !Array.isArray(layout.boxes) || layout.boxes.length > 5000) invalid();
  const ids = new Set();
  for (const box of layout.boxes) { checkedBox(box); if (ids.has(box.id)) invalid(); ids.add(box.id); }
}
function patchRecord(before, patch) {
  if (!object(before) || !object(patch?.set) || !Array.isArray(patch.remove)) invalid();
  // Object spread treats __proto__ as literal data, unlike property assignment.
  const after = { ...before, ...patch.set };
  for (const key of patch.remove) { if (typeof key !== 'string') invalid(); delete after[key]; }
  return after;
}
export function restoreFrameDelta(before, wire) {
  if (wire?.schema !== 'jsonui-frame-delta-v1') return wire;
  if (!before || wire.baseFrameId !== before.frameId || wire.modelId !== before.modelId) invalid();
  const delta = wire.layoutDelta;
  let layout;
  if (object(delta?.replace)) {
    checkedLayout(delta.replace);
    layout = delta.replace;
  } else {
    if (!Array.isArray(before.layout?.boxes) || delta?.boxCount !== before.layout.boxes.length || !Array.isArray(delta.boxes)) invalid();
    const { boxes: previousBoxes, ...previousMeta } = before.layout;
    const boxes = previousBoxes.slice(), seen = new Set();
    for (const tuple of delta.boxes) {
      if (!Array.isArray(tuple) || tuple.length !== 2) invalid();
      const [index, patch] = tuple;
      if (!Number.isSafeInteger(index) || index < 0 || index >= boxes.length || seen.has(index)) invalid();
      seen.add(index); boxes[index] = patchRecord(boxes[index], patch);
      if (boxes[index].id !== previousBoxes[index].id) invalid();
      checkedBox(boxes[index]);
    }
    layout = { ...patchRecord(previousMeta, delta.meta), boxes };
  }
  const { baseFrameId, layoutDelta, propsDelta, basePropsDelta, ...rest } = wire;
  return { ...rest, schema: 'jsonui-frame-v1', layout,
    propsById: patchRecord(before.propsById, propsDelta), basePropsById: patchRecord(before.basePropsById, basePropsDelta) };
}

/** A small transport-only LRU; the UI already owns each returned frame. A
 * missing token is a full-frame request, so another tab, eviction, cancellation
 * or old Node version cannot silently apply patches to the wrong snapshot. */
export function createFrameDeltaClient(request, { maxEntries = 2, maxBytes = 48 * 1024 * 1024 } = {}) {
  const frames = new Map(); let bytes = 0, epoch = 0;
  const metrics = { full: 0, delta: 0, retries: 0, evicted: 0, context_requests: 0, context_retries: 0 };
  async function render(data, signal) {
    const admittedEpoch = epoch;
    function ensureCurrent() {
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('NODE_FRAME_CANCELLED'), { name: 'AbortError' });
      if (admittedEpoch !== epoch) throw Object.assign(new Error('NODE_FRAME_CLIENT_CLEARED'), { name: 'AbortError' });
    }
    async function requestCurrent(input) {
      ensureCurrent(); const result = await request(input, signal); ensureCurrent(); return result;
    }
    ensureCurrent();
    const { contextRevision, ...requestData } = data;
    const { modelId, file, projectionId, filePath, recordId, animationTime, generation, ...state } = requestData;
    // An explicit store revision covers mock/collection data. Other inputs,
    // especially newly measured intrinsic sizes, remain part of the key.
    // Generic callers without revisions get full structural comparison.
    const stateKey = JSON.stringify(contextRevision === undefined ? state : { ...state, mockData: '@revision', collectionData: '@revision', contextRevision });
    const retained = modelId ? frames.get(modelId) : null, before = retained?.frame;
    const contextId = retained?.stateKey === stateKey ? before.transport?.contextId : null;
    const fullInput = { ...requestData, frameTransport: 'delta-v1', ...(before?.frameId ? { previousFrameId: before.frameId } : {}) };
    const input = contextId ? { modelId, contextId, animationTime, generation, frameTransport: 'delta-v1', ...(before?.frameId ? { previousFrameId: before.frameId } : {}) } : fullInput;
    if (contextId) metrics.context_requests++;
    let wire, frame;
    try { wire = await requestCurrent(input); }
    catch (error) {
      if (!contextId || error.message !== 'NODE_FRAME_CONTEXT_STALE') throw error;
      metrics.context_retries++; wire = await requestCurrent(fullInput);
    }
    try { frame = restoreFrameDelta(before, wire); }
    catch (error) {
      if (error.message !== 'NODE_FRAME_DELTA_INVALID') throw error;
      metrics.retries++;
      wire = await requestCurrent({ ...requestData, frameTransport: 'delta-v1' });
      if (wire?.schema === 'jsonui-frame-delta-v1') invalid();
      frame = wire;
    }
    if (frame?.schema !== 'jsonui-frame-v1' || !token(frame.modelId)
      || (modelId !== undefined && frame.modelId !== modelId)
      || (generation !== undefined && frame.generation !== generation)
      || (frame.frameId !== undefined && !token(frame.frameId))) invalid();
    if (wire?.schema === 'jsonui-frame-delta-v1') metrics.delta++;
    else { checkedLayout(frame.layout); metrics.full++; }
    const old = frames.get(frame.modelId);
    if (old) { bytes -= old.bytes; frames.delete(frame.modelId); }
    const size = frame.transport?.fullBytes;
    if (typeof frame.frameId === 'string' && Number.isSafeInteger(size) && size > 0 && size <= maxBytes) {
      while (frames.size && (frames.size >= maxEntries || bytes + size > maxBytes)) {
        const key = frames.keys().next().value; bytes -= frames.get(key).bytes; frames.delete(key); metrics.evicted++;
      }
      frames.set(frame.modelId, { frame, bytes: size, stateKey }); bytes += size;
    }
    return frame;
  }
  return { render, clear() { epoch++; frames.clear(); bytes = 0; }, snapshot() { return { ...metrics, entries: frames.size, bytes, max_bytes: maxBytes }; } };
}
