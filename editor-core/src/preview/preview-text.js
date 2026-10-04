/** Select authored display text without changing the caller's runtime or
 * localization rules. The resolver must preserve unresolved tokens so they
 * remain distinguishable from an input that resolved to an empty value.
 * @param {string} type
 * @param {Record<string, unknown>} props
 * @param {(value: unknown, props: Record<string, unknown>) => unknown} resolveRuntime
 * @returns {unknown}
 */
export function selectPreviewText(type, props, resolveRuntime) {
  const text = resolveRuntime(props.text ?? '', props);
  if (type === 'edit_box' && (text === undefined || text === null || text === '')) {
    // An explicitly empty official placeholder suppresses the compatibility alias.
    return resolveRuntime(props.place_holder_text ?? props.placeholder_text ?? '', props);
  }
  return text;
}

/** Resolve the supported text-block approximation in browser and PNG alike.
 * Native device logs reject label.vertical_alignment. Preserve that authored
 * key for editing/export, but never let it improve the preview silently.
 * Element anchors position the label rectangle, not its text inside it.
 * The supplied native CONCERT 88 captures show that a tall center-anchored
 * label starts its text at the top. A natural-height label is centered by
 * anchoring its small rectangle, without an extra internal centering pass.
 * This is not a claim of exact native font metrics or all anchor semantics.
 * @param {string} type
 * @param {Record<string, unknown>} props
 * @returns {'top'|'center'|'bottom'}
 */
export function resolvePreviewVerticalAlignment(type, props) {
  if (type !== 'label') {
    // R41 evidence identifies label controls only. Retain historical non-label
    // approximation without claiming that it is a supported native property.
    const explicit = typeof props.vertical_alignment === 'string' ? props.vertical_alignment.trim().toLowerCase() : '';
    return ['top', 'center', 'bottom'].includes(explicit) ? explicit : 'center';
  }
  return 'top';
}
