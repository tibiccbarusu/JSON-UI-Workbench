/** Shared, bounded quality assessment of the final binding evaluation.
 * This checks visual/input prerequisites, never Minecraft equivalence.
 * Inactive branches are classified by the evaluator after its fixed point;
 * absence from safe layout is deliberately not evidence of inactivity. */
import { readSliderEnabledState37, selectSliderStateChildren37, resolveSliderControls37 } from '../preview/slider-runtime37.js';
const MAX_BINDINGS = 50000;
const MAX_DIAGNOSTICS = 64;
const EFFECT_PROPERTIES = new Set([
  'visible', 'ignored', 'enabled', 'focus_enabled', 'toggle_state', 'checked',
  'text', 'button_text', 'placeholder_text', 'place_holder_text', 'texture',
  'clip_ratio', 'alpha', 'color', 'size', 'min_size', 'max_size', 'offset',
  'anchor_from', 'anchor_to', 'layer', 'uv', 'uv_size', 'font_type', 'font_size',
  'font_scale_factor', 'text_alignment', 'text_wrap', 'sound_name', 'sound_volume',
  'sound_pitch', 'button_mappings', 'toggle_group_forced_index',
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeText = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 512) : '';
const reasonCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/u.test(value) ? value : 'EVIDENCE_INVALID';

function affectsPreview(row) {
  const target = String(row.targetProperty || '').replace(/^#/, '').toLowerCase();
  // The existing collection axis owns metadata-only collection_details.
  if (!target && row.bindingType === 'collection_details') return false;
  return !target || EFFECT_PROPERTIES.has(target);
}

/** Follow the same confirmed slider state selection used by raster resources.
 * Both the final evaluated props and the original model are required; geometry
 * omission alone can never establish a definitely inactive state. */
function inactiveSliderStates({ model, propsById = {}, visibilityMode } = {}) {
  const ids = new Set(), owners = new Map();
  if (visibilityMode !== 'safe' || !model?.root) return ids;
  const stack = [{ node: model.root, excluded: false }], visited = new Set();
  while (stack.length && visited.size < MAX_BINDINGS) {
    const { node, excluded } = stack.pop();
    if (!node || visited.has(node.id)) return new Set();
    visited.add(node.id);
    if (excluded) ids.add(node.id);
    const props = { ...node.unknownProps, ...node.props, ...propsById[node.id] };
    const children = (node.children || []).map(child => ({ id: child.id, name: child.key?.raw }));
    let selected = null;
    if (['slider', 'slider_box'].includes(node.type)) {
      let enabled = readSliderEnabledState37(props);
      if (node.type === 'slider') {
        const controls = resolveSliderControls37({ props, children });
        if (controls.boxId) owners.set(controls.boxId, enabled);
      } else if (owners.has(node.id)) {
        const parentEnabled = owners.get(node.id);
        enabled = enabled === false || parentEnabled === false ? false
          : enabled === true && parentEnabled === true ? true : null;
      }
      if (enabled !== null) {
        const selection = selectSliderStateChildren37({ type: node.type, props, enabled, children });
        if (!selection.diagnostics.length) selected = new Set(selection.ids);
      }
    }
    for (const child of node.children || []) stack.push({ node: child,
      excluded: excluded || Boolean(selected && !selected.has(child.id)) });
  }
  return stack.length ? new Set() : ids;
}

/**
 * @param {object|null|undefined} bindings Final frame's evaluator evidence.
 * @param {object} [context] Optional final model/propsById/visibilityMode for
 * confirmed slider state pruning; absent context stays conservative.
 * @returns {object} Bounded observed quality; unresolved non-render metadata
 * remains inspectable without blocking unrelated supported previews.
 */
export function summarizeBindingQuality(bindings, context) {
  const rows = Array.isArray(bindings?.diagnostics) ? bindings.diagnostics : null;
  const legacyEmpty = !rows && bindings?.stats?.bindingsSeen === 0;
  const diagnostics = [], codes = new Set();
  const inactiveStateIds = inactiveSliderStates(context);
  let unresolved = 0, critical = 0, inactive = 0, applied = 0, malformed = false, inactiveStates = 0;
  let globalFallbackCount = 0;
  for (const row of (rows || []).slice(0, MAX_BINDINGS)) {
    if (!record(row) || !['applied', 'inactive', 'unresolved'].includes(row.status)
      || typeof row.nodeId !== 'string' || !Number.isInteger(row.bindingIndex)
      || typeof row.targetProperty !== 'string' || reasonCode(row.reason) === 'EVIDENCE_INVALID') {
      malformed = true; continue;
    }
    if (row.status === 'inactive') { inactive++; continue; }
    if (row.status === 'applied') {
      applied++;
      if (row.sourceResolution === 'global_fallback') globalFallbackCount++;
      continue;
    }
    if (inactiveStateIds.has(row.nodeId)) { inactive++; inactiveStates++; continue; }
    unresolved++;
    const essential = affectsPreview(row);
    if (essential) { critical++; if (codes.size < MAX_DIAGNOSTICS) codes.add(row.reason); }
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({
      nodeId: safeText(row.nodeId), bindingIndex: row.bindingIndex,
      bindingType: safeText(row.bindingType), targetProperty: safeText(row.targetProperty),
      status: 'unresolved', reason: row.reason, affects_preview: essential,
      ...(typeof row.sourceNodeId === 'string' ? { sourceNodeId: safeText(row.sourceNodeId) } : {}),
      ...(typeof row.sourceProperty === 'string' ? { sourceProperty: safeText(row.sourceProperty) } : {}),
      ...(row.localReason ? { localReason: reasonCode(row.localReason) } : {}),
    });
  }
  const truncated = Boolean(rows && rows.length > MAX_BINDINGS);
  const captured = Boolean(rows || legacyEmpty) && bindings?.observationCaptureComplete !== false && !truncated && !malformed;
  if (!captured && bindings) codes.add(malformed ? 'BINDING_QUALITY_EVIDENCE_INVALID' : 'BINDING_QUALITY_CAPTURE_INCOMPLETE');
  // Global name lookup is retained as a helpful preview approximation. It
  // does not invalidate the computed image, nor certify native name scope.
  // Keep this compatibility axis separate from visual binding completion.
  const scopeWarnings = globalFallbackCount ? ['VIEW_SOURCE_GLOBAL_FALLBACK'] : [];
  return {
    status: !bindings ? 'not_evaluated' : malformed ? 'failed' : critical || !captured ? 'unknown' : 'passed',
    scope: 'selected_frame_visual_and_input_bindings',
    binding_count: rows?.length ?? (legacyEmpty ? 0 : null), applied_count: applied, inactive_count: inactive,
    confirmed_inactive_state_count: inactiveStates,
    diagnostic_count: unresolved, critical_count: critical, noncritical_count: unresolved - critical,
    reason_codes: [...codes], diagnostics, omitted_diagnostics: Math.max(0, unresolved - diagnostics.length),
    observation_capture_complete: captured, native_parity_verified: false,
    source_scope: { status: globalFallbackCount ? 'unknown' : captured ? 'passed' : 'unknown',
      global_fallback_count: globalFallbackCount, reason_codes: scopeWarnings,
      native_scope_verified: false },
  };
}
