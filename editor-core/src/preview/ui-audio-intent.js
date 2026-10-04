/** Shared browser/Node audio intent. This describes a request; it never
 * decodes, starts audio, certifies audible output, or mutates UI state. */
const AUDIO_TYPES = new Set(['button', 'toggle', 'dropdown', 'input_panel', 'panel']);
const AUDIO_PROPERTIES = new Set(['sound_name', 'sound_volume', 'sound_pitch']);
const truthy = value => [true, 1, 'true', '1'].includes(value);
const falsey = value => [false, 0, 'false', '0'].includes(value);
const unresolvedByDiagnostics = new WeakMap();

function hasUnresolvedAudioBinding(context, nodeId) {
  const rows = context.bindingDiagnostics ?? context.bindings?.diagnostics;
  if (context.bindingObservationComplete === false
    || context.bindings?.observationCaptureComplete === false) return true;
  if (!Array.isArray(rows)) return false;
  // A truncated evaluator cannot prove that a retained authored sound is the
  // current runtime value. Index once per immutable frame, not per UI control.
  if (rows.length > 50000) return true;
  let ids = unresolvedByDiagnostics.get(rows);
  if (!ids) {
    ids = new Set();
    for (const row of rows) {
      if (row?.status === 'unresolved'
        && AUDIO_PROPERTIES.has(String(row.targetProperty || '').replace(/^#/, '').toLowerCase())) {
        ids.add(String(row.nodeId));
      }
    }
    unresolvedByDiagnostics.set(rows, ids);
  }
  return ids.has(String(nodeId));
}

/** Effective props must come from the selected frame's authored + evaluated
 * control, including ancestor visibility/enabled gates. Unknown action
 * mappings do not silence an otherwise valid audio request: UI audio and
 * simulated action effects are independent, as in the visual preview. */
export function buildUiAudioIntent({ context = {}, target, interactionId,
  catalogId, packEpoch, runtimeDirty = false, event = 'activate' } = {}) {
  if (!context.enabled || context.pocket || !target || runtimeDirty || event !== 'activate') return null;
  const props = target.effectiveProps || {}, type = target.node?.type;
  if (!AUDIO_TYPES.has(type)
    || props.enabled !== undefined && !truthy(props.enabled)
    || props.visible !== undefined && !truthy(props.visible)
    || props.ignored !== undefined && !falsey(props.ignored)
    || typeof props.sound_name !== 'string' || !props.sound_name
    || hasUnresolvedAudioBinding(context, target.node?.id)) return null;
  // Invalid/unresolved scalar values reach the resolver/player's existing
  // reason-coded validation. They are never silently replaced with defaults.
  return { soundName: props.sound_name, soundVolume: props.sound_volume, soundPitch: props.sound_pitch,
    catalogId, packEpoch, originScreenId: `${context.file?.path || ''}@${context.screenDefinition || ''}`, interactionId };
}
