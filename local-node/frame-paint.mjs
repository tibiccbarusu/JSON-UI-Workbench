// CPU-only paint animation. Keep shared boxes when their effective alpha does
// not change, so the byte-accounting and delta encoder can reuse their work.
const clamp = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 1;
const enabled = value => typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0
  : typeof value === 'string' && ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());

export function applyRetainedPaintAnimation(layout, nodesById, propsById) {
  const boxes = Array.isArray(layout?.boxes) ? layout.boxes : [];
  const byId = new Map(boxes.map(box => [String(box.id), box]));
  const inherited = new Map(), active = new Set();
  function property(id, name) {
    const override = propsById?.[id];
    return override && Object.hasOwn(override, name) ? override[name] : nodesById?.[id]?.props?.[name];
  }
  function alphaFromParents(id, depth = 0) {
    if (inherited.has(id)) return inherited.get(id);
    if (depth > 200 || active.has(id)) return 1;
    active.add(id);
    const parentId = byId.get(id)?.parentId;
    let value = 1;
    if (parentId && byId.has(String(parentId))) {
      const parent = String(parentId);
      value = alphaFromParents(parent, depth + 1);
      if (enabled(property(parent, 'propagate_alpha'))) value *= clamp(property(parent, 'alpha') ?? 1);
    }
    active.delete(id); inherited.set(id, value); return value;
  }
  let changed = false;
  const painted = boxes.map(box => {
    const id = String(box.id), renderAlpha = alphaFromParents(id) * clamp(property(id, 'alpha') ?? 1);
    if (box.renderAlpha === renderAlpha) return box;
    changed = true; return { ...box, renderAlpha };
  });
  return changed ? { ...layout, boxes: painted } : layout;
}
