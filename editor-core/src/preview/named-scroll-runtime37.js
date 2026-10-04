// Pure, bounded support for Bedrock scroll_view control-name references.
// Layout and painting remain owned by canvas-preview; no source node mutates.
const ROLE_PROPERTIES = Object.freeze({
  contentId: 'scroll_content',
  viewportId: 'scroll_view_port',
  trackId: 'scrollbar_track',
  boxId: 'scrollbar_box',
  barPanelId: 'scroll_box_and_track_panel',
});

function localName(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const at = text.indexOf('@');
  return at < 0 ? text : text.slice(0, at);
}

function boundedLimit(value, fallback, ceiling) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : fallback;
}

function staticallyVisible(node) {
  const props = node?.props || {};
  return props.ignored !== true && props.ignored !== 'true' && props.ignored !== 1
    && props.visible !== false && props.visible !== 'false' && props.visible !== 0;
}

/**
 * Search active descendants within this scroll view's scope. Another nested
 * scroll_view is a boundary: its own named internals belong to that view.
 * Callers should provide their evaluated visibility policy when available.
 * An explicitly missing or ambiguous name is never replaced with an arbitrary
 * wrapper node. An absent name stays null for the caller's legacy fallback.
 */
export function resolveNamedScrollControls(nodesById, scrollViewId, props = {}, options = {}) {
  const rootId = String(scrollViewId || '');
  const root = nodesById?.[rootId];
  const maxNodes = boundedLimit(options.maxNodes, 4096, 100000);
  const maxDepth = boundedLimit(options.maxDepth, 96, 256);
  const visible = typeof options.isNodeVisible === 'function' ? options.isNodeVisible : staticallyVisible;
  const result = { complete: true, visitedNodes: 0, scheduledNodes: 0,
    maxNodes, maxDepth, diagnostics: [], references: {},
    contentId: null, viewportId: null, trackId: null, boxId: null, barPanelId: null };
  const matches = new Map();
  for (const [role, property] of Object.entries(ROLE_PROPERTIES)) {
    const raw = props[property];
    const name = typeof raw === 'string' ? raw.trim() : '';
    const status = !name ? 'absent' : name.length > 256 || /[$()]/u.test(name) ? 'unresolved' : 'pending';
    result.references[property] = { role, name: name.slice(0, 256), status, nodeId: null };
    if (status === 'pending' && !matches.has(name)) matches.set(name, new Set());
  }
  if (!root) {
    result.complete = false;
    result.diagnostics.push({ code: 'NAMED_SCROLL_ROOT_MISSING', nodeId: rootId });
    return result;
  }

  const stack = [], seen = new Set();
  let limited = false;
  function schedule(children, depth, ancestors) {
    if (!Array.isArray(children)) return;
    const remaining = Math.max(0, maxNodes - result.scheduledNodes);
    const count = Math.min(children.length, remaining);
    if (count < children.length) limited = true;
    // Preserve author order while keeping the pending frontier bounded.
    for (let index = count - 1; index >= 0; index -= 1) {
      stack.push({ id: String(children[index]), depth, ancestors });
    }
    result.scheduledNodes += count;
  }
  schedule(root.children, 1, [rootId]);
  while (stack.length) {
    const frame = stack.pop(), node = nodesById?.[frame.id];
    if (!node || !visible(node, frame.id)) continue;
    if (frame.ancestors.includes(frame.id)) {
      result.complete = false;
      if (!result.diagnostics.some(item => item.code === 'NAMED_SCROLL_CYCLE'))
        result.diagnostics.push({ code: 'NAMED_SCROLL_CYCLE', nodeId: frame.id });
      continue;
    }
    if (frame.depth > maxDepth) { limited = true; continue; }
    if (seen.has(frame.id)) continue;
    seen.add(frame.id);
    result.visitedNodes += 1;
    matches.get(localName(node.props?.name))?.add(frame.id);
    if (String(node.type || '').toLowerCase() === 'scroll_view') continue;
    schedule(node.children, frame.depth + 1, [...frame.ancestors, frame.id]);
  }
  if (limited) {
    result.complete = false;
    result.diagnostics.push({ code: 'NAMED_SCROLL_SCAN_LIMIT', nodeId: rootId, maxNodes, maxDepth });
  }
  for (const [property, reference] of Object.entries(result.references)) {
    if (reference.status === 'absent') continue;
    const candidates = matches.get(reference.name) || new Set();
    if (reference.status !== 'unresolved') reference.status = !result.complete ? 'incomplete'
      : candidates.size > 1 ? 'ambiguous' : candidates.size === 0 ? 'missing' : 'resolved';
    if (reference.status === 'resolved') {
      reference.nodeId = candidates.values().next().value;
      result[reference.role] = reference.nodeId;
    } else {
      result.diagnostics.push({ code: `NAMED_SCROLL_REFERENCE_${reference.status.toUpperCase()}`,
        nodeId: rootId, property, name: reference.name, candidates: [...candidates].slice(0, 8) });
    }
  }
  return result;
}

function rectangle(value) {
  if (!value || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(value[key]))) return null;
  return { x: value.x, y: value.y, w: Math.max(0, value.w), h: Math.max(0, value.h) };
}

/** Calculate a vertical scrollbar from unscrolled content bounds. */
export function computeNamedScrollMetrics({ viewport, contentBounds = null, trackRect = null,
  scrollX = 0, scrollY = 0, alwaysVisible = false, minimumThumbSize = 0 } = {}) {
  const vp = rectangle(viewport), track = trackRect ? rectangle(trackRect) : vp;
  if (!vp || !track || contentBounds && !['minX', 'minY', 'maxX', 'maxY']
    .every(key => Number.isFinite(contentBounds[key]))) return { ok: false, reason: 'NONFINITE_SCROLL_GEOMETRY' };
  const contentWidth = contentBounds ? Math.max(0, contentBounds.maxX - vp.x) : 0;
  const contentHeight = contentBounds ? Math.max(0, contentBounds.maxY - vp.y) : 0;
  if (!Number.isFinite(contentWidth) || !Number.isFinite(contentHeight))
    return { ok: false, reason: 'NONFINITE_SCROLL_GEOMETRY' };
  const maxScrollX = Math.max(0, contentWidth - vp.w), maxScrollY = Math.max(0, contentHeight - vp.h);
  const clamp = (value, maximum) => Math.max(0, Math.min(maximum, Number.isFinite(value) ? value : 0));
  const clampedScrollX = clamp(scrollX, maxScrollX), clampedScrollY = clamp(scrollY, maxScrollY);
  const scrollbarVisible = alwaysVisible === true || alwaysVisible === 'true' || alwaysVisible === 1 || maxScrollY > 0;
  const ratio = contentHeight > 0 ? Math.min(1, vp.h / contentHeight) : 1;
  const minimum = clamp(minimumThumbSize, track.h);
  // The observed Classic home/routes thumbs cover whole logical pixels:
  // 160*164/187 -> 141 and 160*164/173.5 -> 152. Round upward once in
  // logical coordinates, then retain the authored track boundary.
  const thumbHeight = Math.min(track.h, Math.ceil(Math.max(minimum, track.h * ratio)));
  const thumbOffsetY = maxScrollY > 0 ? clampedScrollY / maxScrollY * (track.h - thumbHeight) : 0;
  const thumbY = track.y + thumbOffsetY;
  if (!Number.isFinite(thumbY)) return { ok: false, reason: 'NONFINITE_SCROLL_GEOMETRY' };
  return { ok: true, viewport: vp, contentWidth, contentHeight, maxScrollX, maxScrollY,
    clampedScrollX, clampedScrollY, scrollbarVisible, thumbHeight, thumbOffsetY,
    thumbY, trackRect: track };
}

/**
 * Return only the additional property patch for a single optional reflow.
 * Omitting a bar's whole horizontal-stack slot lets the existing fill layout
 * reclaim its width. The caller must cap reflow to one further layout pass.
 */
export function createNamedScrollReflowOverrides(resolved, metrics, propsByIdOverride = {}) {
  const id = resolved?.barPanelId;
  if (!resolved?.complete || !resolved.contentId || !id || !metrics?.ok || metrics.scrollbarVisible) return {};
  const previous = propsByIdOverride[id] || {};
  if (previous.ignored === true || previous.ignored === 'true' || previous.ignored === 1) return {};
  return { [id]: { ...previous, ignored: true } };
}
