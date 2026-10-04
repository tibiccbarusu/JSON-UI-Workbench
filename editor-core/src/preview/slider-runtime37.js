// Slider visuals use evaluated values. Pointer/keyboard slider interactions are
// intentionally not synthesized here; the current interaction engine exposes
// no game hover/pressed visual state.
const MAX_CHILDREN = 4096;
const localName = value => typeof value === 'string' ? value.trim().split('@', 1)[0].trim() : '';
const literalName = value => {
  const name = localName(value);
  return name && !/^[#$(:]/u.test(name) ? name : '';
};

export function readSliderEnabledState37(props = {}) {
  if (!Object.prototype.hasOwnProperty.call(props, 'enabled')) return true;
  const value = props.enabled;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    if (/^(?:true|1|yes|on)$/iu.test(value.trim())) return true;
    if (/^(?:false|0|no|off)$/iu.test(value.trim())) return false;
  }
  return null;
}

export function resolveSliderRuntime37(props = {}) {
  const raw = props.slider_value;
  const number = typeof raw === 'number' ? raw
    : typeof raw === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(raw.trim()) ? Number(raw) : NaN;
  const direction = props.slider_direction === undefined ? 'horizontal' : props.slider_direction;
  const diagnostics = [];
  if (!Number.isFinite(number)) diagnostics.push('SLIDER_VALUE_UNRESOLVED');
  if (direction !== 'horizontal' && direction !== 'vertical') diagnostics.push('SLIDER_DIRECTION_UNRESOLVED');
  return diagnostics.length ? { ok: false, ratio: null, axis: null, diagnostics }
    : { ok: true, ratio: Math.min(1, Math.max(0, number)), axis: direction === 'vertical' ? 'y' : 'x', diagnostics };
}

/** Select direct state controls without inferring unprovided pointer state. */
export function selectSliderStateChildren37({ type, props = {}, children = [], enabled = true } = {}) {
  if (children.length > MAX_CHILDREN) return { ids: [], diagnostics: ['SLIDER_CHILD_LIMIT'] };
  if (type !== 'slider' && type !== 'slider_box') return { ids: children.map(child => String(child.id)), diagnostics: [] };
  const states = new Set(['default', 'hover', 'pressed', 'locked', 'disabled', 'indent']);
  const active = new Set();
  const diagnostics = [];
  const stateName = key => {
    const value = props[key], name = literalName(value);
    if (value !== undefined && value !== '' && !name) diagnostics.push(`SLIDER_STATE_REFERENCE_UNRESOLVED:${key}`);
    return name;
  };
  const groups = [['default_control', 'hover_control', 'locked_control', 'default']];
  if (type === 'slider') groups.push(
    ['background_control', 'background_hover_control', 'background_locked_control', ''],
    ['progress_control', 'progress_hover_control', 'progress_locked_control', ''],
  );
  for (const [baseKey, hoverKey, lockedKey, fallback] of groups) {
    const base = props[baseKey] === undefined ? fallback : stateName(baseKey);
    const locked = stateName(lockedKey);
    for (const key of [baseKey, hoverKey, lockedKey]) {
      const name = stateName(key); if (name) states.add(name);
    }
    const selected = !enabled && locked ? locked : base;
    if (selected) active.add(selected);
  }
  for (const key of ['indent_control', 'pressed_control']) {
    const name = stateName(key); if (name) states.add(name);
  }
  return { ids: children.filter(child => {
    const name = localName(child.name);
    return !states.has(name) || active.has(name);
  }).map(child => String(child.id)), diagnostics: [...new Set(diagnostics)] };
}

/** Descendant progress names are scoped to this slider; nested sliders stop traversal. */
export function collectSliderDescendants37(nodesById, childIds = []) {
  const children = [], diagnostics = [], seen = new Set();
  const queue = childIds.slice(0, MAX_CHILDREN).map(id => ({ id: String(id), depth: 1 }));
  if (childIds.length > MAX_CHILDREN) diagnostics.push('SLIDER_CHILD_LIMIT');
  let scheduled = queue.length;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { id, depth } = queue[cursor];
    if (seen.has(id)) { diagnostics.push('SLIDER_REFERENCE_CYCLE'); continue; }
    seen.add(id);
    const node = nodesById?.[id]; if (!node) continue;
    children.push({ id, name: node.props?.name });
    if (String(node.type).toLowerCase() === 'slider') continue;
    const next = Array.isArray(node.children) ? node.children : [];
    if (depth >= 96 && next.length) { diagnostics.push('SLIDER_DEPTH_LIMIT'); continue; }
    for (const child of next) {
      if (scheduled >= MAX_CHILDREN) { diagnostics.push('SLIDER_CHILD_LIMIT'); break; }
      queue.push({ id: String(child), depth: depth + 1 }); scheduled++;
    }
  }
  return { children, diagnostics: [...new Set(diagnostics)] };
}

/** Thumb names are direct children; progress names may be scoped descendants. */
export function resolveSliderControls37({ props = {}, children = [], descendants = children } = {}) {
  const result = { boxId: null, progressIds: [], unresolvedIds: [], diagnostics: [] };
  if (children.length > MAX_CHILDREN) return { ...result, unresolvedIds: children.slice(0, MAX_CHILDREN).map(c => String(c.id)), diagnostics: ['SLIDER_CHILD_LIMIT'] };
  const byName = new Map();
  if (descendants.length > MAX_CHILDREN) return { ...result, diagnostics: ['SLIDER_CHILD_LIMIT'] };
  for (const child of descendants) {
    const name = localName(child.name);
    const matches = byName.get(name) || []; matches.push(String(child.id)); byName.set(name, matches);
  }
  for (const key of ['slider_box_control', 'progress_control', 'progress_hover_control', 'progress_locked_control']) {
    if (props[key] === undefined || props[key] === '') continue;
    const name = literalName(props[key]);
    const matches = key === 'slider_box_control'
      ? children.filter(child => localName(child.name) === name).map(child => String(child.id))
      : byName.get(name) || [];
    if (!name || matches.length !== 1) {
      result.diagnostics.push(!name ? `SLIDER_REFERENCE_UNRESOLVED:${key}`
        : matches.length ? `SLIDER_REFERENCE_AMBIGUOUS:${key}` : `SLIDER_REFERENCE_MISSING:${key}`);
      result.unresolvedIds.push(...matches);
    } else if (key === 'slider_box_control') result.boxId = matches[0];
    else result.progressIds.push(matches[0]);
  }
  result.progressIds = [...new Set(result.progressIds)];
  result.unresolvedIds = [...new Set(result.unresolvedIds)];
  return result;
}

/** Return finite thumb placement and full-track progress scissor. */
export function computeSliderGeometry37({ runtime, parent, thumb } = {}) {
  const finiteRect = value => value && ['x', 'y', 'w', 'h'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k])) && value.w >= 0 && value.h >= 0;
  if (!runtime?.ok || !finiteRect(parent) || !finiteRect(thumb)) return { ok: false, diagnostics: ['SLIDER_GEOMETRY_UNRESOLVED'] };
  const axis = runtime.axis, size = axis === 'y' ? 'h' : 'w';
  if (!['x', 'y'].includes(axis) || !Number.isFinite(runtime.ratio) || runtime.ratio < 0 || runtime.ratio > 1) return { ok: false, diagnostics: ['SLIDER_GEOMETRY_UNRESOLVED'] };
  const center = parent[axis] + parent[size] * runtime.ratio;
  const position = center - thumb[size] / 2;
  const progressClip = { x: parent.x, y: parent.y, w: parent.w, h: parent.h, [size]: parent[size] * runtime.ratio };
  if (!Number.isFinite(center) || !Number.isFinite(position) || !finiteRect(progressClip)) return { ok: false, diagnostics: ['SLIDER_GEOMETRY_UNRESOLVED'] };
  return { ok: true, axis, center, position, progressClip, diagnostics: [] };
}
