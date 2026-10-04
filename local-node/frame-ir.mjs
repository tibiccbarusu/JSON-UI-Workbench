import { createHash, randomUUID } from 'node:crypto';
import { summarizeEvaluationQuality, surveyExecutionWorkload } from '../editor-core/src/engine/evaluation-quality.js';
import { summarizeFrameForTransport } from './frame-summary.mjs';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { computeLayoutBoxesForFile } from '../editor-core/src/preview/canvas-preview.js';
import { evaluateBindingsWithRepresentativeRuntime } from '../editor-core/src/engine/preview-bindings-runtime.js';
import { compilePreviewAnimations, samplePreviewAnimations } from '../editor-core/src/engine/preview-animation.js';
import { summarizeAnimationQuality } from '../editor-core/src/engine/animation-quality41.js';
import { applyRetainedPaintAnimation } from './frame-paint.mjs';
import { isPocketUiPath } from '../editor-core/src/engine/ui-catalog.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { responseKey } from './response-cache.mjs';
import { FrameResultCache, ImmutableJsonSize } from './frame-storage.mjs';
import { fail } from './limits.mjs';
import { FrameDeltaEncoder } from './frame-delta.mjs';
import { FrameContextCache } from './frame-context.mjs';
import { normalizeLocalToggleState } from '../editor-core/src/preview/local-toggle-state.js';

export const FRAME_LIMITS = Object.freeze({
  // Retained execution models are constructed inside Node from a bounded
  // projection; this is deliberately separate from the unchanged 16MiB HTTP
  // input cap. Large Classic inventory trees contain several thousand nodes.
  modelBytes: 64 * 1024 * 1024, modelsBytes: 64 * 1024 * 1024, models: 8,
  nodes: 50000, boxes: 5000, depth: 256, stateBytes: 1024 * 1024,
  replyBytes: 24 * 1024 * 1024, cacheBytes: 24 * 1024 * 1024,
});
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const reserved = key => ['__proto__', 'constructor', 'prototype'].includes(key);

function jsonBytes(value, maximum, code) {
  let json;
  try { json = JSON.stringify(value); } catch { fail(code); }
  if (typeof json !== 'string' || Buffer.byteLength(json) > maximum) fail(code, 413);
  return json;
}

function checkedMap(value, code, maximum = FRAME_LIMITS.nodes) {
  if (value === undefined || value === null) return {};
  if (!record(value) || Object.keys(value).length > maximum) fail(code);
  return value;
}

// The browser already owns authored node props. Only runtime differences cross
// the wire, which prevents repeatedly transferring textures, bindings and the
// same large static property objects during scrubbing/scrolling.
function compactOverrides(file, overrides) {
  const compact = Object.create(null);
  for (const [id, props] of Object.entries(overrides)) {
    const original = file.nodesById[id];
    if (!original) continue;
    const authored = { ...original.unknownProps, ...original.props };
    let changed = null;
    for (const [key, value] of Object.entries(props)) {
      if (value === authored[key]) continue;
      if (value && typeof value === 'object' && authored[key] && typeof authored[key] === 'object' && JSON.stringify(value) === JSON.stringify(authored[key])) continue;
      (changed ||= Object.create(null))[key] = value;
    }
    if (changed) compact[id] = changed;
  }
  return compact;
}

function checkedModel(input) {
  if (!record(input) || typeof input.rootId !== 'string' || !record(input.nodesById)) fail('NODE_FRAME_MODEL_INVALID');
  const nodes = input.nodesById, ids = Object.keys(nodes);
  if (!ids.length || ids.length > FRAME_LIMITS.nodes) fail('NODE_FRAME_NODE_LIMIT', 413);
  if (!Object.hasOwn(nodes, input.rootId)) fail('NODE_FRAME_ROOT_INVALID');
  for (const id of ids) {
    const node = nodes[id];
    if (reserved(id) || !record(node) || node.id !== id || !Array.isArray(node.children)) fail('NODE_FRAME_NODE_INVALID');
    if (node.children.some(child => typeof child !== 'string' || !Object.hasOwn(nodes, child))) fail('NODE_FRAME_CHILD_INVALID');
  }
  // Validate the entire reachable tree, including cycles/multiple parent aliases,
  // before any recursive layout or binding function can see untrusted input.
  const seen = new Set(), stack = [[input.rootId, 0]];
  while (stack.length) {
    const [id, depth] = stack.pop();
    if (seen.has(id)) fail('NODE_FRAME_TREE_INVALID');
    if (depth > FRAME_LIMITS.depth) fail('NODE_FRAME_DEPTH_LIMIT', 413);
    seen.add(id);
    for (const child of nodes[id].children) stack.push([child, depth + 1]);
  }
  if (seen.size !== ids.length) fail('NODE_FRAME_UNREACHABLE_NODE');
  const uiModel = input.uiModel;
  const selected = input.meta?.selectedDefinition;
  const modelPath = uiModel?.filePath || selected?.filePath || input.path || input.rootId;
  const namespace = uiModel?.namespace || selected?.namespace || '';
  const explicitPocket = node => node?.localVariables?.$pocket_screen === true
    || node?.props?.$pocket_screen === true || node?.unknownProps?.$pocket_screen === true;
  const definitionNodes = nodes[input.rootId].type === 'file'
    ? nodes[input.rootId].children.map(id => nodes[id]) : [nodes[input.rootId]];
  const modelDefinitions = uiModel?.root?.type === 'file' && Array.isArray(uiModel.root.children) ? uiModel.root.children : [uiModel?.root];
  if (selected?.profile === 'pocket' || input.meta?.resolution?.profile === 'pocket'
    || isPocketUiPath(modelPath, namespace) || explicitPocket(nodes[input.rootId])
    || explicitPocket(uiModel?.root) || uiModel?.unknownFields?.$pocket_screen === true
    || definitionNodes.some(explicitPocket) || modelDefinitions.some(explicitPocket)) fail('POCKET_PREVIEW_BLOCKED', 422);
  if (uiModel !== undefined && uiModel !== null) {
    if (!record(uiModel) || !record(uiModel.root) || uiModel.root.id !== input.rootId) fail('NODE_FRAME_BINDING_MODEL_INVALID');
    const visited = new Set(), pending = [[uiModel.root, 0]];
    while (pending.length) {
      const [node, depth] = pending.pop();
      if (!record(node) || typeof node.id !== 'string' || visited.has(node.id) || !Object.hasOwn(nodes, node.id)) fail('NODE_FRAME_BINDING_TREE_INVALID');
      if (depth > FRAME_LIMITS.depth) fail('NODE_FRAME_DEPTH_LIMIT', 413);
      visited.add(node.id);
      const children = node.children ?? [];
      if (!Array.isArray(children) || children.length !== nodes[node.id].children.length || children.some((child, i) => child?.id !== nodes[node.id].children[i])) fail('NODE_FRAME_BINDING_TREE_INVALID');
      for (const child of children) pending.push([child, depth + 1]);
    }
    if (visited.size !== ids.length) fail('NODE_FRAME_BINDING_TREE_INVALID');
    // The flat tree and binding tree describe the same UI. Accepting different
    // props silently lets binding evaluation override a different layout model.
    // Bindings/localVariables have one authority (uiModel); display/layout
    // fields must match the existing canonical UiModel -> flat conversion.
    const canonical = buildTreeFromUiScreenModel(uiModel).nodesById;
    for (const id of ids) {
      const actual = nodes[id], expected = canonical[id];
      if (actual.type !== expected.type) fail('NODE_FRAME_MODEL_INCONSISTENT');
      for (const field of ['props', 'propsPresent', 'propsValid', 'unknownProps']) {
        if (!isDeepStrictEqual(actual[field] || {}, expected[field] || {})) fail('NODE_FRAME_MODEL_INCONSISTENT');
      }
    }
  }
  return { rootId: input.rootId, nodesById: nodes, uiModel: uiModel || null,
    meta: { selectedDefinition: input.meta?.selectedDefinition || null,
      resolution: { animationDefinitions: input.meta?.resolution?.animationDefinitions || {} } } };
}

function checkedRequest(input) {
  if (!record(input)) fail('NODE_FRAME_REQUEST_INVALID');
  if ((input.file === undefined) === (input.modelId === undefined)) fail('NODE_FRAME_MODEL_SOURCE_INVALID');
  if (input.modelId !== undefined && (typeof input.modelId !== 'string' || !/^[0-9a-f-]{36}$/u.test(input.modelId))) fail('NODE_FRAME_MODEL_ID_INVALID');
  if (input.frameTransport !== undefined && !['delta-v1', 'summary-v1'].includes(input.frameTransport)) fail('NODE_FRAME_TRANSPORT_INVALID');
  if (input.previousFrameId !== undefined && (input.frameTransport !== 'delta-v1' || typeof input.previousFrameId !== 'string' || !/^[0-9a-f-]{36}$/u.test(input.previousFrameId))) fail('NODE_FRAME_TRANSPORT_INVALID');
  const preset = input.preset;
  if (!record(preset) || ![preset.width, preset.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 16384)) fail('NODE_FRAME_PRESET_INVALID');
  const generation = input.generation ?? 0;
  if (!Number.isSafeInteger(generation) || generation < 0) fail('NODE_FRAME_GENERATION_INVALID');
  const visibilityMode = input.visibilityMode ?? 'safe';
  if (!['safe', 'structure'].includes(visibilityMode)) fail('NODE_FRAME_VISIBILITY_INVALID');
  if (input.animationTime !== undefined && (typeof input.animationTime !== 'number' || !Number.isFinite(input.animationTime) || input.animationTime < 0 || input.animationTime > 3600)) fail('NODE_FRAME_ANIMATION_TIME_INVALID');
  const animationEvent = input.animationEvent ?? 'screen.entrance_push';
  if (typeof animationEvent !== 'string' || animationEvent.length > 256 || /[\u0000-\u001f]/u.test(animationEvent)) fail('NODE_FRAME_ANIMATION_EVENT_INVALID');
  if (input.qualifiedName !== undefined && (typeof input.qualifiedName !== 'string' || input.qualifiedName.length > 1024)) fail('NODE_FRAME_NAME_INVALID');
  const mockData = checkedMap(input.mockData, 'NODE_FRAME_STATE_INVALID');
  const collectionData = checkedMap(input.collectionData, 'NODE_FRAME_COLLECTION_INVALID', 1024);
  const uiInstanceId = input.uiInstanceId ?? 'jsonui-static';
  if (typeof uiInstanceId !== 'string' || !uiInstanceId.length || uiInstanceId.length > 256 || /[\u0000-\u001f]/u.test(uiInstanceId)) fail('NODE_FRAME_INSTANCE_INVALID');
  const normalizedLocal = normalizeLocalToggleState(input.localToggleState, { instanceId: uiInstanceId });
  if (!normalizedLocal.ok) fail(normalizedLocal.error?.code || 'NODE_FRAME_LOCAL_STATE_INVALID');
  const localToggleState = normalizedLocal.state;
  jsonBytes({ mockData, collectionData, localToggleState }, FRAME_LIMITS.stateBytes, 'NODE_FRAME_STATE_LIMIT');
  const propsByIdOverride = checkedMap(input.propsByIdOverride, 'NODE_FRAME_PROPS_INVALID');
  const scrollById = checkedMap(input.scrollById, 'NODE_FRAME_SCROLL_INVALID');
  for (const scroll of Object.values(scrollById)) if (!record(scroll) || ![scroll.x ?? 0, scroll.y ?? 0].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6)) fail('NODE_FRAME_SCROLL_INVALID');
  return { preset: { width: preset.width, height: preset.height }, generation, visibilityMode,
    mockData, collectionData, uiInstanceId, localToggleState, propsByIdOverride, scrollById, animationTime: input.animationTime,
    animationEvent, qualifiedName: input.qualifiedName, frameTransport: input.frameTransport, previousFrameId: input.previousFrameId };
}

/** CPU-only retained-model -> binding/layout IR. No rasterization or browser globals. */
export class FrameIrProcessor {
  constructor() {
    this.models = new Map(); this.modelBytes = 0; this.delta = new FrameDeltaEncoder(); this.contexts = new FrameContextCache();
    this.frames = new FrameResultCache({ maxBytes: FRAME_LIMITS.cacheBytes, maxEntries: 24 });
    this.jsonSize = new ImmutableJsonSize();
    this.metrics = { registered: 0, reused: 0, evicted: 0, frames: 0, bindingBuilds: 0, bindingHits: 0 };
  }
  clear() { this.models.clear(); this.modelBytes = 0; this.frames.clear(); this.delta.clear(); this.contexts.clear(); this.jsonSize.clear(); }
  snapshot() { return { ...this.metrics, models: this.models.size, model_bytes: this.modelBytes, frame_cache: this.frames.snapshot(), frame_transport: this.delta.snapshot(), frame_contexts: this.contexts.snapshot() }; }
  hasModel(modelId) { return this.models.has(modelId); }
  registerModel(file) { return this.model({ file }).id; }
  model(input) {
    if (input.modelId !== undefined) {
      const entry = this.models.get(input.modelId);
      if (!entry) fail('NODE_FRAME_MODEL_STALE', 409);
      this.models.delete(entry.id); this.models.set(entry.id, entry); this.metrics.reused++;
      return entry;
    }
    const file = checkedModel(input.file);
    const json = jsonBytes(file, FRAME_LIMITS.modelBytes, 'NODE_FRAME_MODEL_LIMIT');
    const digest = createHash('sha256').update(json).digest('hex');
    for (const entry of this.models.values()) if (entry.digest === digest) {
      this.models.delete(entry.id); this.models.set(entry.id, entry); this.metrics.reused++;
      return entry;
    }
    const bytes = Buffer.byteLength(json);
    while (this.models.size && (this.models.size >= FRAME_LIMITS.models || this.modelBytes + bytes > FRAME_LIMITS.modelsBytes)) {
      const first = this.models.keys().next().value;
      this.modelBytes -= this.models.get(first).bytes; this.models.delete(first); this.metrics.evicted++;
    }
    // Own an immutable snapshot; callers cannot change cached model semantics.
    // structuredClone preserves shared property references between the flat
    // tree and binding model; JSON.parse would duplicate those subgraphs.
    const entry = { id: randomUUID(), digest, file: structuredClone(file), bytes, evaluation: null, animationPlan: null, workload: surveyExecutionWorkload(file.nodesById, file.uiModel) };
    this.models.set(entry.id, entry); this.modelBytes += bytes; this.metrics.registered++;
    return entry;
  }
  execute(input) {
    const started = performance.now();
    let context = input?.contextId !== undefined ? this.contexts.resolve(input) : null;
    // Validate temporal values with the same public request contract. The
    // retained maps/preset are immutable, already validated and size bounded.
    const checked = context ? checkedRequest({ modelId: input.modelId, preset: context.request.preset,
      generation: input.generation, animationTime: input.animationTime, frameTransport: input.frameTransport, previousFrameId: input.previousFrameId }) : checkedRequest(input);
    // Binding values may themselves be arrays/objects. Own the request before
    // retaining their computed props, even for direct Node API callers that
    // later mutate an input map. Context playback already owns this snapshot.
    const request = context ? { ...context.request, generation: checked.generation, animationTime: checked.animationTime, frameTransport: checked.frameTransport, previousFrameId: checked.previousFrameId } : structuredClone(checked);
    const entry = this.model(input);
    const qualifiedName = request.qualifiedName ?? entry.file.meta?.selectedDefinition?.qualifiedName ?? '';
    request.qualifiedName = qualifiedName;
    if (!context && request.frameTransport === 'delta-v1') context = this.contexts.capture(entry.id, request);
    const { generation, frameTransport, previousFrameId, ...state } = request;
    const transport = { frameTransport, previousFrameId, contextId: context?.id };
    const key = context ? responseKey({ modelId: entry.id, contextKey: context.key, animationTime: request.animationTime }) : responseKey({ modelId: entry.id, ...state, qualifiedName });
    const hit = this.frames.get(key);
    if (hit) return this.response(hit.result, generation, { cacheHit: true, totalMs: performance.now() - started }, transport, hit.bytes);
    for (const [id, props] of Object.entries(request.propsByIdOverride)) {
      if (reserved(id) || !Object.hasOwn(entry.file.nodesById, id) || !record(props)) fail('NODE_FRAME_PROPS_INVALID');
    }
    const bindingKey = context?.bindingKey ?? responseKey({ qualifiedName, mockData: request.mockData, collectionData: request.collectionData,
      uiInstanceId: request.uiInstanceId, localToggleState: request.localToggleState });
    const bindingStarted = performance.now();
    let evaluated;
    if (entry.evaluation?.key === bindingKey) { evaluated = entry.evaluation.value; this.metrics.bindingHits++; }
    else {
      const userData = Object.keys(request.collectionData).length
        ? { ...request.mockData, __collections: request.collectionData } : request.mockData;
      evaluated = evaluateBindingsWithRepresentativeRuntime(entry.file.uiModel, qualifiedName, userData, request) || { propsById: {}, stats: {}, warnings: [] };
      entry.evaluation = { key: bindingKey, value: evaluated }; entry.animationPlan = null; this.metrics.bindingBuilds++;
    }
    const bindingMs = performance.now() - bindingStarted;
    const baseKey = context?.baseKey ?? responseKey({ bindingKey, propsByIdOverride: request.propsByIdOverride });
    if (context) context.baseKey = baseKey;
    if (entry.renderBase?.key !== baseKey) {
      const props = { ...evaluated.propsById };
      for (const [id, extra] of Object.entries(request.propsByIdOverride)) props[id] = { ...(props[id] || {}), ...extra };
      entry.renderBase = { key: baseKey, props, compact: compactOverrides(entry.file, props) };
    }
    const propsById = { ...entry.renderBase.props }, basePropsById = entry.renderBase.compact;
    let animation = null, affectsLayout = false, changedPropsById = {};
    if (request.animationTime !== undefined) {
      const payload = entry.file.meta?.resolution?.animationDefinitions || {};
      const planKey = context?.planKey ?? responseKey({ bindingKey, event: request.animationEvent, propsByIdOverride: request.propsByIdOverride });
      if (context) context.planKey = planKey;
      if (entry.animationPlan?.key !== planKey) entry.animationPlan = { key: planKey,
        value: compilePreviewAnimations(entry.file.uiModel, { definitions: payload.definitions || {}, variables: payload.variables || {}, event: request.animationEvent, basePropsById: propsById, bindingDiagnostics: evaluated.diagnostics,
          bindingObservationCaptureComplete: evaluated.observationCaptureComplete }) };
      const plan = entry.animationPlan.value;
      const sampled = samplePreviewAnimations(plan, request.animationTime, { basePropsById: propsById });
      affectsLayout = Boolean(sampled.affectsLayout); changedPropsById = sampled.changedPropsById || {};
      for (const [id, props] of Object.entries(sampled.changedPropsById || {})) propsById[id] = { ...(propsById[id] || {}), ...props };
      animation = { active: sampled.active, duration: plan.duration, loop: plan.loop,
        trackCount: plan.tracks.length, availableEvents: plan.availableEvents || [], diagnostics: plan.diagnostics,
        timeSeconds: sampled.timeSeconds, clock: 'absolute_preview_seconds', observation: plan.observation };
      animation.quality = summarizeAnimationQuality(animation);
    }
    const layoutStarted = performance.now();
    const geometryKey = context?.geometryKey ?? responseKey({ baseKey, preset: request.preset, scrollById: request.scrollById, visibilityMode: request.visibilityMode });
    if (context) context.geometryKey = geometryKey;
    const geometryReuse = !affectsLayout && entry.geometry?.key === geometryKey;
    let layout;
    if (geometryReuse) layout = Object.keys(changedPropsById).length
      ? applyRetainedPaintAnimation(entry.geometry.layout, entry.file.nodesById, propsById) : entry.geometry.layout;
    else {
      layout = computeLayoutBoxesForFile(entry.file, request.preset, { maxBoxes: FRAME_LIMITS.boxes,
        propsByIdOverride: affectsLayout ? propsById : entry.renderBase.props,
        scrollById: request.scrollById, visibilityMode: request.visibilityMode });
      if (!affectsLayout) {
        entry.geometry = { key: geometryKey, layout };
        if (Object.keys(changedPropsById).length) layout = applyRetainedPaintAnimation(layout, entry.file.nodesById, propsById);
      }
    }
    const compactProps = { ...basePropsById };
    for (const id of Object.keys(changedPropsById)) {
      const compactNode = compactOverrides(entry.file, { [id]: propsById[id] });
      if (compactNode[id]) compactProps[id] = compactNode[id]; else delete compactProps[id];
    }
    this.metrics.frames++;
    const result = { schema: 'jsonui-frame-v1', modelId: entry.id, layout, propsById: compactProps, basePropsById,
      workload: entry.workload,
      uiInstanceId: request.uiInstanceId,
      bindings: { stats: evaluated.stats, warnings: evaluated.warnings, diagnostics: evaluated.diagnostics,
        localToggleState: evaluated.localToggleState, localToggleDiagnostics: evaluated.localToggleDiagnostics,
        observationCaptureComplete: evaluated.observationCaptureComplete }, animation,
      metrics: { processing: 'node-worker', nodeCount: Object.keys(entry.file.nodesById).length, bindingMs,
        layoutMs: performance.now() - layoutStarted, geometryReuse, modelBytes: entry.bytes } };
    result.evaluation = summarizeEvaluationQuality({ frame: { ...result, evaluation: entry.file.meta?.resolution?.evaluation }, modelStats: entry.file.uiModel?.stats });
    if (frameTransport === 'summary-v1') return this.response(result, generation, { cacheHit: false, totalMs: performance.now() - started }, transport);
    const bytes = this.jsonSize.bytes(result, FRAME_LIMITS.replyBytes);
    this.frames.set(key, result, bytes);
    return this.response(result, generation, { cacheHit: false, totalMs: performance.now() - started }, transport, bytes);
  }
  response(result, generation, metrics, transport, fullBytes) {
    const frame = { ...result, generation, metrics: { ...result.metrics, ...metrics, durationMs: metrics.totalMs } };
    if (transport?.frameTransport === 'summary-v1') {
      return { kind: 'json', body: jsonBytes(summarizeFrameForTransport(frame, FRAME_LIMITS.replyBytes), FRAME_LIMITS.replyBytes, 'NODE_FRAME_REPLY_LIMIT') };
    }
    if (transport?.frameTransport === 'delta-v1') {
      const body = this.delta.encode(frame, transport.previousFrameId, fullBytes, transport.contextId);
      if (Buffer.byteLength(body) > FRAME_LIMITS.replyBytes) fail('NODE_FRAME_REPLY_LIMIT', 413);
      return { kind: 'json', body };
    }
    return { kind: 'json', body: jsonBytes(frame, FRAME_LIMITS.replyBytes, 'NODE_FRAME_REPLY_LIMIT') };
  }
}
