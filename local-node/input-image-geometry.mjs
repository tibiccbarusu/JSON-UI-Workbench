/** Compare projected input bounds with prepared image bounds. This does not
 * execute native hit testing or infer that deliberate button padding is bad. */
const INPUT_TYPES = new Set(['button', 'toggle', 'dropdown', 'slider', 'edit_box', 'input_panel']);
const rectangle = value => value && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(value[key]))
  ? { x: value.x, y: value.y, w: Math.max(0, value.w), h: Math.max(0, value.h) } : null;
function intersect(a, b) {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}
function relation(input, visual) {
  if (!input || !visual) return 'unavailable';
  if (input.w <= 0 || input.h <= 0 || visual.w <= 0 || visual.h <= 0) return 'empty';
  const epsilon = 0.01;
  if (['x', 'y', 'w', 'h'].every(key => Math.abs(input[key] - visual[key]) <= epsilon)) return 'aligned';
  const contains = (a, b) => a.x <= b.x + epsilon && a.y <= b.y + epsilon
    && a.x + a.w >= b.x + b.w - epsilon && a.y + a.h >= b.y + b.h - epsilon;
  if (contains(input, visual)) return 'input_contains_visual';
  if (contains(visual, input)) return 'visual_contains_input';
  const overlap = intersect(input, visual);
  return overlap.w > 0 && overlap.h > 0 ? 'partial_overlap' : 'disjoint';
}

/** Build one bounded lookup per frame rather than repeatedly scanning boxes.
 * Nearest input ancestry is an observable structural relation. Sibling hit
 * overlays, input mappings, disabled states and native focus are not inferred. */
export function createInputImageGeometryAudit(boxes, viewport) {
  const byId = new Map(boxes.map(box => [String(box.id), box]));
  return (box, imageGeometry) => {
    let input = box, depth = 0;
    const seen = new Set();
    while (input && !INPUT_TYPES.has(input.type)) {
      const id = String(input.id);
      if (seen.has(id) || ++depth > 256) return {
        schema: 'jsonui-input-image-geometry-v1', scope: 'projected-input-ancestor-vs-image',
        native_input_verified: false, complete: false, reason: 'INPUT_GEOMETRY_ANCESTRY_LIMIT',
      };
      seen.add(id);
      input = input.parentId == null ? null : byId.get(String(input.parentId));
    }
    if (!input) return null;
    const inputRect = rectangle(input);
    let inputClipped = inputRect;
    if (input.clipRect) inputClipped = intersect(inputClipped, rectangle(input.clipRect));
    if (viewport) inputClipped = intersect(inputClipped, rectangle(viewport));
    const visual = rectangle(imageGeometry?.destination_rect);
    const visible = rectangle(imageGeometry?.visible_rect);
    return {
      schema: 'jsonui-input-image-geometry-v1', scope: 'projected-input-ancestor-vs-image',
      native_input_verified: false, complete: true, units: 'logical-ui',
      input_node_id: String(input.id), input_type: input.type,
      input_layout_rect: inputRect, input_clipped_rect: inputClipped,
      visual_destination_rect: visual, visual_visible_rect: visible,
      relation: relation(inputRect, visual), visible_relation: relation(inputClipped, visible),
      visual_minus_input: inputRect && visual ? {
        x: visual.x - inputRect.x, y: visual.y - inputRect.y,
        w: visual.w - inputRect.w, h: visual.h - inputRect.h,
      } : null,
      interpretation: 'geometry_only; padding_may_be_intentional; native_hit_test_not_executed',
    };
  };
}
