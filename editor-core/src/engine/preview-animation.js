/** 有限予算でJSON UI animationを解釈する、DOM/I/Oを持たない共有ESM。 */
import { safeEvalExpression } from '../bindings/bindings-evaluator.js';
import { PREVIEW_ANIMATION_EASINGS as EASING } from './animation-easing.js';
import { createAnimationObservation } from './animation-quality41.js';
const MAX_DEFINITIONS = 2048, MAX_TRACKS = 2048, MAX_CHAIN = 64, MAX_NODES = 50000;
const TYPES = new Set(['alpha', 'offset', 'size', 'uv', 'color', 'wait', 'flip_book']);
const FIELDS = new Set(['anim_type','from','to','duration','easing','next','looping','initial_uv','frame_count','frame_step','fps','reversible','play_event','end_event','reset_event','destroy_at_end','start_event','delay','variables','scale_from_starting_alpha','activated','resettable','wait_until_rendered_to_play']);
function own(value, key) { const d = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : null; return d && Object.hasOwn(d, 'value') ? d.value : undefined; }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function qualify(ref, namespace) { if (typeof ref !== 'string') return ''; const value = ref.replace(/^@/u, ''); if (!value) return ''; return value.includes('.') || !namespace ? value : `${namespace}.${value}`; }
function namespaceOf(name) { const at = name.lastIndexOf('.'); return at < 0 ? '' : name.slice(0, at); }
function addDiagnostic(list, code, ref, detail = '') { if (list.length < 256 && !list.some((item) => item.code === code && item.ref === ref && item.detail === detail)) list.push({ code, severity: code === 'ANIMATION_EVENT_NOT_TRIGGERED' ? 'info' : 'warning', ref: String(ref).slice(0, 256), detail: String(detail).slice(0, 512) }); }
function cloneJson(value, depth = 0) {
  if (depth > 20) return undefined;
  if (Array.isArray(value)) return value.slice(0, 1024).map((v) => cloneJson(v, depth + 1));
  if (object(value)) { const out = Object.create(null); for (const key of Object.keys(value).slice(0, 2048)) { if (['__proto__','constructor','prototype'].includes(key)) continue; const v = own(value, key); if (v !== undefined) out[key] = cloneJson(v, depth + 1); } return out; }
  return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
}
// References assigned by an animation definition retain the namespace of
// that declaration even when the animation is inherited by another file.
function qualifyDeclaredReferences(value, namespace, depth = 0) {
  if (depth > 20) return undefined;
  if (typeof value === 'string' && value.startsWith('@')) return `@${qualify(value, namespace)}`;
  if (Array.isArray(value)) return value.slice(0, 1024).map((child) => qualifyDeclaredReferences(child, namespace, depth + 1));
  if (object(value)) { const out = Object.create(null); for (const key of Object.keys(value).slice(0, 2048)) {
    if (['__proto__','constructor','prototype'].includes(key)) continue;
    out[key] = qualifyDeclaredReferences(own(value, key), namespace, depth + 1);
  } return out; }
  return cloneJson(value);
}
/** Node側catalogから優先層のanimationだけを取り出す。catalog単位でキャッシュ可。 */
export function collectPreviewAnimationDefinitions(catalog) {
  const definitions = Object.create(null), diagnostics = [], resolved = new Map();
  const resolveRecord = (record, stack = []) => {
    if (!record || record.profile === 'pocket') return null;
    if (resolved.has(record.id)) return resolved.get(record.id);
    if (stack.length >= MAX_CHAIN || stack.includes(record.id)) {
      addDiagnostic(diagnostics, 'ANIMATION_INHERITANCE_CYCLE_OR_BUDGET', record.qualifiedName);
      return null;
    }
    let base = null;
    if (record.baseRef) {
      const baseName = qualify(record.baseRef, record.namespace);
      const symbol = own(catalog?.symbols, baseName);
      const candidateIds = Array.isArray(symbol?.candidateIds) ? symbol.candidateIds : [symbol?.winnerId];
      const baseId = candidateIds.find((candidateId) => candidateId !== record.id);
      base = resolveRecord(own(catalog?.recordsById, baseId), [...stack, record.id]);
    }
    const value = Object.create(null);
    if (base) Object.assign(value, base);
    for (const key of Object.keys(record.value || {})) if (FIELDS.has(key) || key.startsWith('$')) {
      const raw = own(record.value, key);
      value[key] = key === 'next' || key === 'variables' || key.startsWith('$')
        ? qualifyDeclaredReferences(raw, record.namespace) : cloneJson(raw);
    }
    value.__source = { qualifiedName: record.qualifiedName, filePath: record.filePath, sourceKind: record.sourceKind };
    resolved.set(record.id, value); return value;
  };
  let bytes = 0;
  for (const name of Object.keys(catalog?.symbols || {}).slice(0, 50000)) {
    const value = resolveRecord(own(catalog?.recordsById, own(catalog?.symbols, name)?.winnerId));
    if (!value?.anim_type) continue;
    const size = JSON.stringify(value).length * 2;
    if (Object.keys(definitions).length >= MAX_DEFINITIONS || bytes + size > 2 * 1024 * 1024) { addDiagnostic(diagnostics, 'ANIMATION_DEFINITION_BUDGET', name); break; }
    bytes += size; definitions[name] = value;
  }
  return { definitions, variables: cloneJson(catalog?.globalVariables || {}), diagnostics };
}
function variablesFor(parent, local, baseProps = {}) {
  const result = { ...parent };
  const declare = (source) => { for (const [key, value] of Object.entries(source || {}).slice(0, 2048)) {
    if (!key.startsWith('$')) continue;
    const [name, modifier] = key.split('|');
    if (modifier === 'default' && Object.hasOwn(result, name)) continue;
    if (value === name && Object.hasOwn(result, name)) continue;
    result[name] = value;
  } };
  declare(local);
  for (const branch of (Array.isArray(local?.variables) ? local.variables : []).slice(0, 256)) {
    if (!object(branch)) continue;
    const requirement = branch.requires;
    if (requirement === undefined || resolveValue(requirement, result, baseProps) === true) declare(branch);
  }
  return result;
}
function resolveValue(value, variables, baseProps, depth = 0) {
  if (depth > 16) return undefined;
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, variables, baseProps, depth + 1));
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^[#$][A-Za-z0-9_:.-]+$/u.test(trimmed)) {
    const next = trimmed.startsWith('#')
      ? Object.hasOwn(baseProps, trimmed.slice(1)) ? own(baseProps, trimmed.slice(1)) : Object.hasOwn(baseProps, trimmed) ? own(baseProps, trimmed) : own(variables, trimmed)
      : own(variables, trimmed);
    return next === undefined || next === trimmed ? undefined : resolveValue(next, variables, baseProps, depth + 1);
  }
  if (trimmed.startsWith('(') && trimmed.endsWith(')') && trimmed.length <= 4096) return safeEvalExpression(trimmed.slice(1, -1), { mockData: variables, props: { ...baseProps, ...variables } });
  return value;
}
function scalar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return { percent: 0, pixels: value };
  if (typeof value !== 'string' || value.length > 128) return null;
  const raw = value.replace(/\s+/gu, '');
  const terms = raw.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px)?/gu);
  if (!terms || terms.join('') !== raw) return null;
  let percent = 0, pixels = 0;
  for (const term of terms) { const number = Number.parseFloat(term); if (!Number.isFinite(number)) return null; if (term.endsWith('%')) percent += number; else pixels += number; }
  return { percent, pixels };
}
function interpolation(from, to) {
  if (Array.isArray(from) || Array.isArray(to)) {
    if (!Array.isArray(from) || !Array.isArray(to) || from.length !== to.length || from.length < 2 || from.length > 4) return null;
    const values = from.map((v, i) => interpolation(v, to[i]));
    return values.every(Boolean) ? { values } : null;
  }
  const a = scalar(from), b = scalar(to);
  return a && b ? { a, b } : null;
}
function interpolate(compiled, t) {
  if (compiled.values) return compiled.values.map((value) => interpolate(value, t));
  const percent = compiled.a.percent + (compiled.b.percent - compiled.a.percent) * t;
  const pixels = compiled.a.pixels + (compiled.b.pixels - compiled.a.pixels) * t;
  if (percent === 0) return pixels;
  return `${percent}%${pixels < 0 ? ' - ' : ' + '}${Math.abs(pixels)}px`;
}
function compileTrack(ref, id, namespace, variables, baseProps, definitions, diagnostics, event, availableEvents, attachments) {
  const segments = [], seen = new Map();
  let next = qualify(ref, namespace), duration = 0, loopStart = null;
  for (let i = 0; next && i < MAX_CHAIN; i++) {
    if (seen.has(next)) { loopStart = seen.get(next); if (duration - loopStart <= 0) { addDiagnostic(diagnostics, 'ANIMATION_ZERO_DURATION_CYCLE', next); return null; } break; }
    seen.set(next, duration);
    const definition = own(definitions, next);
    if (!object(definition)) { addDiagnostic(diagnostics, 'ANIMATION_REFERENCE_MISSING', next); break; }
    const vars = variablesFor(variables, definition, baseProps);
    const playEvent = resolveValue(definition.play_event, vars, baseProps);
    if (i === 0 && typeof playEvent === 'string' && playEvent && availableEvents.size < 256) availableEvents.add(playEvent);
    if (i === 0 && definition.play_event !== undefined && typeof playEvent !== 'string') { addDiagnostic(diagnostics, 'ANIMATION_EVENT_UNRESOLVED', next); return null; }
    if (i === 0 && playEvent && playEvent !== event) { addDiagnostic(diagnostics, 'ANIMATION_EVENT_NOT_TRIGGERED', next, String(playEvent)); return null; }
    const type = resolveValue(definition.anim_type, vars, baseProps);
    const looping = resolveValue(definition.looping, vars, baseProps);
    const reversibleFlag = resolveValue(definition.reversible, vars, baseProps);
    const scaleAlpha = resolveValue(definition.scale_from_starting_alpha, vars, baseProps);
    const resolvedNext = resolveValue(definition.next, vars, baseProps);
    const hasNext = definition.next !== undefined && resolvedNext !== '';
    if ([['looping',looping],['reversible',reversibleFlag],['scale_from_starting_alpha',scaleAlpha]].some(([key,value]) => definition[key] !== undefined && typeof value !== 'boolean')) { addDiagnostic(diagnostics, 'ANIMATION_FLAG_INVALID', next); break; }
    if (!TYPES.has(type)) { addDiagnostic(diagnostics, 'ANIMATION_TYPE_UNSUPPORTED', next, String(type)); break; }
    // UV/size were rejected by the supplied native CONCERT 88 Content Logs;
    // offset was rejected by Expedition Control 1.0.1 on 2026-10-04.
    // A boolean type alone does not establish field support.
    // Keep a numerical preview available, but never report it as supported.
    // Do not generalize the observation to flip_book or every animation type.
    if (definition.looping !== undefined && ['uv', 'size', 'offset'].includes(type)) {
      addDiagnostic(diagnostics, 'ANIMATION_LOOPING_NATIVE_REJECTED', next,
        `looping on ${type} was rejected in the supplied native Content Log. Remove the field; the local sample is not native validation.`);
    }
    if (type === 'flip_book') {
      if (i === 0 && attachments.has('anims')) addDiagnostic(diagnostics, 'ANIMATION_FLIPBOOK_ANIMS_NATIVE_UNVERIFIED', next,
        'flip_book attached through anims failed in the supplied native example. Prefer a standalone uv reference and verify on the target game version.');
      if (i > 0 || hasNext) addDiagnostic(diagnostics, 'ANIMATION_FLIPBOOK_CHAIN_NATIVE_UNVERIFIED', next,
        'A next chain containing flip_book failed in the supplied native example. Local UV sampling does not prove native chain support; the report replaced it with ordinary uv animation chains.');
    }
    const eventSideEffects = ['end_event', 'reset_event', 'start_event'].some(key => definition[key] !== undefined
      && resolveValue(definition[key], vars, baseProps) !== '')
      || definition.destroy_at_end !== undefined && resolveValue(definition.destroy_at_end, vars, baseProps) !== false;
    if (eventSideEffects) addDiagnostic(diagnostics, 'ANIMATION_EVENT_SIDE_EFFECT_UNSUPPORTED', next);
    if (definition.activated !== undefined || definition.resettable !== undefined) addDiagnostic(diagnostics, 'ANIMATION_ACTIVATION_STATE_UNSUPPORTED', next);
    if (definition.wait_until_rendered_to_play !== undefined && resolveValue(definition.wait_until_rendered_to_play, vars, baseProps) !== false) addDiagnostic(diagnostics, 'ANIMATION_RENDER_VISIBILITY_TIMING_UNSUPPORTED', next, 'wait_until_rendered_to_play の描画状態に応じた開始時刻制御は未対応です。プレビュー時間軸で表示します。');
    const easingName = resolveValue(definition.easing, vars, baseProps) || 'linear';
    if (!Object.hasOwn(EASING, easingName)) { addDiagnostic(diagnostics, 'ANIMATION_EASING_UNSUPPORTED', next, String(easingName)); break; }
    let segmentDuration = resolveValue(definition.duration, vars, baseProps);
    const delay = resolveValue(definition.delay, vars, baseProps) ?? 0;
    if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0 || delay > 3600) { addDiagnostic(diagnostics, 'ANIMATION_DELAY_INVALID', next); break; }
    let compiled = null, flip = null;
    if (reversibleFlag === true && type !== 'flip_book') { addDiagnostic(diagnostics, 'ANIMATION_REVERSIBLE_TYPE_UNSUPPORTED', next, type); break; }
    if (type === 'flip_book') {
      const uvSize = resolveValue(baseProps.uv_size, vars, baseProps);
      const defaultStep = Array.isArray(uvSize) && uvSize.length === 2 && typeof uvSize[0] === 'number' && uvSize[0] > 0 ? uvSize[0] : undefined;
      const count = resolveValue(definition.frame_count, vars, baseProps), fps = resolveValue(definition.fps, vars, baseProps), step = resolveValue(definition.frame_step === undefined ? defaultStep : definition.frame_step, vars, baseProps), initial = resolveValue(definition.initial_uv ?? [0,0], vars, baseProps);
      if (!Number.isInteger(count) || count < 1 || count > 4096 || typeof fps !== 'number' || fps <= 0 || fps > 240 || typeof step !== 'number' || !Number.isFinite(step) || !Array.isArray(initial) || initial.length !== 2 || initial.some((v) => typeof v !== 'number' || !Number.isFinite(v))) { addDiagnostic(diagnostics, 'ANIMATION_FLIPBOOK_INVALID', next); break; }
      const reversible = reversibleFlag === true;
      const frames = reversible && count > 1 ? count * 2 - 2 : count;
      segmentDuration = frames / fps;
      flip = { count, fps, step, initial, reversible, frames };
      // Observed vanilla spinner definitions omit looping. The preview
      // profile repeats flipbooks by default, without synthesizing game events.
      if (looping !== false && !hasNext) loopStart = duration + delay;
    } else if (type !== 'wait') {
      let from = resolveValue(definition.from, vars, baseProps), to = resolveValue(definition.to, vars, baseProps);
      if (type === 'alpha' && scaleAlpha === true) {
        const rawAlpha = resolveValue(baseProps.alpha, vars, baseProps);
        // A direct @animation alpha replaces the schema's default opacity.
        // Other unresolved authored values must not be guessed as opaque.
        const startingAlpha = rawAlpha === undefined && baseProps.alpha === undefined
          || typeof rawAlpha === 'string' && rawAlpha.startsWith('@') ? 1 : rawAlpha;
        if (typeof startingAlpha !== 'number' || !Number.isFinite(startingAlpha)
          || typeof from !== 'number' || typeof to !== 'number') {
          addDiagnostic(diagnostics, 'ANIMATION_START_ALPHA_UNRESOLVED', next); break;
        }
        from *= startingAlpha; to *= startingAlpha;
      }
      compiled = interpolation(from, to);
      if (!compiled || (type === 'alpha' && (typeof from !== 'number' || typeof to !== 'number')) || (['offset','size','uv'].includes(type) && (!Array.isArray(from) || from.length !== 2)) || (type === 'color' && (!Array.isArray(from) || ![3,4].includes(from.length)))) { addDiagnostic(diagnostics, 'ANIMATION_VALUE_UNSUPPORTED', next, type); break; }
    }
    if (typeof segmentDuration !== 'number' || !Number.isFinite(segmentDuration) || segmentDuration < 0 || segmentDuration > 3600) { addDiagnostic(diagnostics, 'ANIMATION_DURATION_INVALID', next); break; }
    // Validate the complete segment before adding its delay; malformed input
    // must not create a wait-only animation that appears to have succeeded.
    if (delay > 0) { segments.push({ type: 'wait', start: duration, duration: delay }); duration += delay; }
    segments.push({ type, start: duration, duration: segmentDuration, compiled, flip, easing: easingName });
    duration += segmentDuration;
    if (looping === true && !hasNext && type !== 'flip_book') loopStart = duration - segmentDuration;
    if (hasNext && typeof resolvedNext !== 'string') {
      addDiagnostic(diagnostics, 'ANIMATION_NEXT_UNRESOLVED', next, 'next の参照先を文字列として解決できません。直前までの区間だけを表示します。');
      break;
    }
    next = qualify(resolvedNext, namespaceOf(next));
    if (i === MAX_CHAIN - 1 && next) addDiagnostic(diagnostics, 'ANIMATION_CHAIN_BUDGET', next);
  }
  if (!segments.length || (loopStart !== null && duration <= loopStart)) return null;
  return { id, segments, duration, loopStart };
}
/**
 * 一回だけtreeを走査・参照解決。毎フレーム再resolve/binding評価しない。
 * @param {object} uiModel
 * @param {{definitions?:object,variables?:object,basePropsById?:object,event?:string}} options
 */
export function compilePreviewAnimations(uiModel, options = {}) {
  const tracks = [], diagnostics = [], availableEvents = new Set();
  const definitions = options.definitions || {}, event = options.event || 'screen.entrance_push';
  const capture = createAnimationObservation(event);
  if (options.bindingObservationCaptureComplete === false || (options.bindingDiagnostics || []).length > MAX_NODES) {
    capture.incomplete('ANIMATION_VISIBILITY_EVIDENCE_INCOMPLETE');
  }
  if (!uiModel?.root) return { tracks, diagnostics, duration: 0, loop: false, availableEvents: [], observation: capture.finish() };
  // Binding evidence, not absence from geometry, establishes uncertainty.
  const unknownVisibility = new Map();
  for (const row of (options.bindingDiagnostics || []).slice(0, MAX_NODES)) {
    const property = String(row?.targetProperty || '').replace(/^#/, '');
    if (row?.status === 'unresolved' && ['visible', 'ignored'].includes(property)) {
      if (!unknownVisibility.has(row.nodeId)) unknownVisibility.set(row.nodeId, new Set());
      unknownVisibility.get(row.nodeId).add(property);
    }
  }
  const stack = [{ node: uiModel.root, variables: options.variables || {}, visibility: 'visible' }], seen = new Set();
  let nodes = 0, referencesSeen = 0, compiledReferences = 0;
  while (stack.length && nodes < MAX_NODES && compiledReferences < MAX_TRACKS) {
    const { node, variables: parentVars, visibility: parentVisibility } = stack.pop();
    if (!node) continue;
    if (seen.has(node)) { capture.incomplete('ANIMATION_MODEL_CYCLE_OR_ALIAS'); continue; }
    seen.add(node); nodes++;
    const props = { ...node.unknownProps, ...node.props, ...options.basePropsById?.[node.id] };
    const visibilityProp = key => Object.hasOwn(options.basePropsById?.[node.id] || {}, key)
      ? props[key] : own(node.unknownProps, key) ?? props[key];
    const visible = visibilityProp('visible'), ignored = visibilityProp('ignored');
    const ownUnknown = unknownVisibility.has(node.id)
      || visible !== undefined && typeof visible !== 'boolean' || ignored !== undefined && typeof ignored !== 'boolean';
    const visibility = parentVisibility === 'inactive' || visible === false && !unknownVisibility.get(node.id)?.has('visible')
      || ignored === true && !unknownVisibility.get(node.id)?.has('ignored') ? 'inactive'
      : parentVisibility === 'unknown' || ownUnknown ? 'unknown' : 'visible';
    const variables = variablesFor(variablesFor(parentVars, node.localVariables, props), props, props);
    // Preserve the attachment site even when the same reference appears in
    // anims and a direct property. Their native compatibility differs.
    const references = new Map();
    const attach = (ref, source) => {
      if (!references.has(ref)) references.set(ref, new Set());
      references.get(ref).add(source);
    };
    const anims = resolveValue(props.anims, variables, props);
    if (Array.isArray(anims)) {
      for (const ref of anims.slice(0, 64)) attach(ref, 'anims');
      if (anims.length > 64) { addDiagnostic(diagnostics, 'ANIMATION_REFERENCE_BUDGET', String(node.id)); capture.incomplete('ANIMATION_REFERENCE_BUDGET'); }
    } else if (props.anims !== undefined) {
      attach(null, 'anims');
    }
    for (const property of ['alpha','offset','size','uv','color']) {
      const authored = own(node.unknownProps, property);
      const candidate = typeof authored === 'string' && authored.startsWith('@') ? authored : props[property];
      if (typeof candidate === 'string' && candidate.startsWith('@')) attach(candidate, property);
    }
    for (const [ref, attachments] of references) {
      if (visibility !== 'inactive' && compiledReferences >= MAX_TRACKS) { capture.incomplete('ANIMATION_NODE_TRACK_BUDGET'); break; }
      referencesSeen++;
      const id = String(node.id), resolvedRef = typeof ref === 'string' ? qualify(ref, uiModel.namespace) : '';
      if (visibility === 'inactive') { capture.record({ nodeId: id, ref: resolvedRef, status: 'inactive', visibility, codes: ['ANIMATION_CONFIRMED_INACTIVE'] }); continue; }
      compiledReferences++;
      const localDiagnostics = [];
      const track = typeof ref === 'string' && ref.length
        ? compileTrack(ref, id, uiModel.namespace, variables, props, definitions, localDiagnostics, event, availableEvents, attachments) : null;
      if (!ref || typeof ref !== 'string') addDiagnostic(localDiagnostics, 'ANIMATION_REFS_UNRESOLVED', resolvedRef);
      const inactive = !track && localDiagnostics.length > 0 && localDiagnostics.every(row => row.code === 'ANIMATION_EVENT_NOT_TRIGGERED');
      if (visibility === 'unknown' && !inactive) addDiagnostic(localDiagnostics, 'ANIMATION_VISIBILITY_UNKNOWN', resolvedRef);
      const status = inactive ? 'inactive' : !track || localDiagnostics.some(row => row.severity !== 'info') ? 'unknown' : 'supported';
      capture.record({ nodeId: id, ref: resolvedRef, status, visibility, codes: localDiagnostics.map(row => row.code), segmentCount: track?.segments.length || 0 });
      for (const row of localDiagnostics) if (diagnostics.length < 256) diagnostics.push({ ...row, nodeId: id.slice(0, 256) });
      if (track) tracks.push(track);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], variables, visibility });
  }
  if (stack.length) { addDiagnostic(diagnostics, 'ANIMATION_NODE_TRACK_BUDGET', '', `${nodes}/${referencesSeen}`); capture.incomplete('ANIMATION_NODE_TRACK_BUDGET'); }
  capture.result.nodes_observed = nodes;
  return { tracks, diagnostics, duration: tracks.reduce((max, track) => Math.max(max, track.duration), 0),
    loop: tracks.some((track) => track.loopStart !== null), availableEvents: [...availableEvents].sort(),
    stats: { nodes, tracks: tracks.length, references: referencesSeen, compiledReferences }, observation: capture.finish() };
}
/** 現画面が参照するplay_eventのみ列挙。ゲームイベントを発火しない。 */
export function listPreviewAnimationEvents(uiModel, options = {}) {
  return compilePreviewAnimations(uiModel, options).availableEvents;
}
function segmentValue(segment, elapsed) {
  if (segment.type === 'flip_book') {
    const { count, fps, step, initial, reversible, frames } = segment.flip;
    let frame = Math.min(frames - 1, Math.floor(Math.max(0, elapsed) * fps));
    if (reversible && frame >= count) frame = frames - frame;
    // Mojang's auto_save/loading_bar/tnt_animated are horizontal strips.
    return [initial[0] + frame * step, initial[1]];
  }
  const progress = segment.duration === 0 ? 1 : Math.max(0, Math.min(1, elapsed / segment.duration));
  return interpolate(segment.compiled, progress === 0 || progress === 1 ? progress : EASING[segment.easing](progress));
}
/**
 * 有限時刻に対する同一結果。baseのmappingと変更nodeだけ浅copyしtreeは共有。
 * @returns {{propsById:object,diagnostics:object[],active:boolean,timeSeconds:number}}
 */
export function samplePreviewAnimations(plan, timeSeconds, options = {}) {
  const time = typeof timeSeconds === 'number' && Number.isFinite(timeSeconds) ? Math.max(0, Math.min(86400, timeSeconds)) : 0;
  const propsById = Object.assign(Object.create(null), options.basePropsById || {}), changed = new Set();
  let active = false, affectsLayout = false;
  const changedPropsById = Object.create(null);
  for (const track of (plan?.tracks || []).slice(0, MAX_TRACKS)) {
    const applySegment = (segment, elapsed) => {
      if (segment.type === 'wait') return;
      if (!changed.has(track.id)) { propsById[track.id] = { ...propsById[track.id] }; changed.add(track.id); }
      const property = segment.type === 'flip_book' ? 'uv' : segment.type;
      const sampledValue = segmentValue(segment, elapsed);
      propsById[track.id][property] = sampledValue;
      if (!changedPropsById[track.id]) changedPropsById[track.id] = Object.create(null);
      changedPropsById[track.id][property] = sampledValue;
      if (property === 'size' || property === 'offset') affectsLayout = true;
    };
    let sampleTime = time;
    if (track.loopStart !== null && sampleTime >= track.duration) {
      // A wait at the beginning of a repeated chain holds the previous
      // cycle's final values. Absolute seek must reconstruct that state
      // without relying on which earlier frames happened to be sampled.
      for (const segment of track.segments) applySegment(segment, segment.duration);
      sampleTime = track.loopStart + ((sampleTime - track.loopStart) % (track.duration - track.loopStart));
    }
    if (track.loopStart !== null || time < track.duration) active = true;
    for (const segment of track.segments) {
      if (sampleTime < segment.start) break;
      applySegment(segment, sampleTime - segment.start);
      if (sampleTime < segment.start + segment.duration) break;
    }
  }
  return { propsById, changedPropsById, affectsLayout, diagnostics: plan?.diagnostics || [], active, timeSeconds: time };
}
