/** 草稿のbox移動に、出所を検証できるclipとscroll geometryを追従させる。DOM/解釈/通信なし。 */
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const get = (source, id) => source instanceof Map ? source.get(id) : source && own(source, id) ? source[id] : undefined;
const copyRect = rect => rect ? { ...rect } : null;

function properties(id, context) {
  const node = get(context.nodesById, id);
  if (!node || typeof node !== 'object') return null;
  return { ...node.props, ...get(context.propsByIdOverride ?? context.nodeOverrides, id) };
}
function enabled(props, key, expected) {
  if (!props || !own(props, key)) return false;
  const value = props[key];
  if (typeof value === 'boolean') return value === expected;
  if (typeof value === 'number') return expected ? value !== 0 : value === 0;
  if (typeof value !== 'string') return false;
  return (expected ? ['true', '1', 'yes', 'on'] : ['false', '0', 'no', 'off']).includes(value.trim().toLowerCase());
}
function finiteRect(rect) {
  return Boolean(rect) && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key]));
}
function sameRect(left, right) {
  if (!left || !right) return !left && !right;
  return finiteRect(left) && finiteRect(right) && ['x', 'y', 'w', 'h'].every(key => left[key] === right[key]);
}
function intersect(inherited, local) {
  if (!finiteRect(local) || inherited && !finiteRect(inherited)) return undefined;
  const x = Math.max(inherited?.x ?? -Infinity, local.x), y = Math.max(inherited?.y ?? -Infinity, local.y);
  const right = Math.min(inherited ? inherited.x + Math.max(0, inherited.w) : Infinity, local.x + Math.max(0, local.w));
  const bottom = Math.min(inherited ? inherited.y + Math.max(0, inherited.h) : Infinity, local.y + Math.max(0, local.h));
  const result = { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
  return finiteRect(result) ? result : undefined;
}
function inheritedClip(parent, childId, props, layout) {
  let clip = parent.clipRect || null;
  if (enabled(props, 'clips_children', true)) clip = intersect(clip, parent);
  const scroll = get(layout.scrollMetaById, String(parent.id));
  if (clip !== undefined && scroll?.contentChildId === childId) clip = intersect(clip, parent);
  return clip;
}
function translatedBounds(bounds, dx, dy) {
  if (!bounds || !['minX', 'minY', 'maxX', 'maxY'].every(key => Number.isFinite(bounds[key]))) return bounds;
  const next = { ...bounds, minX: bounds.minX + dx, minY: bounds.minY + dy, maxX: bounds.maxX + dx, maxY: bounds.maxY + dy };
  return Object.values(next).filter(value => typeof value === 'number').every(Number.isFinite) ? next : bounds;
}

/**
 * 元propsと元親boxで旧clipを再現できる枝だけを再計算する。
 * 説明できないclipは固定して保持。引数のboxも変更しない。
 * @param {object} layout 確定済みlayout。
 * @param {object[]} boxes 移動/削除を反映したbox配列。未移動boxを共有していてもよい。
 * @param {object} context 確定済みnodesByIdと評価済みprops。草稿属性は混ぜない。
 * @returns {object} 草稿layout。
 */
export function applyPendingGeometry21(layout, boxes, context) {
  const originals = new Map(layout.boxes.map(box => [String(box.id), box]));
  const drafts = new Map(boxes.map(box => [String(box.id), box]));
  const done = new Set();
  for (const start of drafts.keys()) {
    if (done.has(start)) continue;
    const trail = [], seen = new Set(); let cursor = start;
    while (drafts.has(cursor) && !done.has(cursor)) {
      if (seen.has(cursor)) throw new Error('EDITOR_DRAFT_PARENT_CYCLE');
      seen.add(cursor); trail.push(cursor);
      const parent = drafts.get(cursor).parentId; cursor = parent == null ? null : String(parent);
    }
    for (let index = trail.length - 1; index >= 0; index--) {
      const id = trail[index], original = originals.get(id), draft = drafts.get(id);
      const parentId = original.parentId == null ? null : String(original.parentId);
      const parent = originals.get(parentId), parentDraft = drafts.get(parentId);
      const props = properties(id, context), parentProps = properties(parentId, context);
      if (props && parent && parentDraft && parentProps) {
        const escapes = enabled(props, 'allow_clipping', false);
        const before = escapes ? null : inheritedClip(parent, id, parentProps, layout);
        // 比較は厳密一致。未知のscissorや独自viewportを動く親へ誤帰属させない。
        if (before !== undefined && sameRect(before, original.clipRect)) {
          const after = escapes ? null : inheritedClip(parentDraft, id, parentProps, layout);
          if (after !== undefined && !sameRect(after, draft.clipRect)) drafts.set(id, { ...draft, clipRect: copyRect(after) });
        }
      }
      done.add(id);
    }
  }
  const updatedBoxes = boxes.map(box => drafts.get(String(box.id)));
  const metadata = layout.scrollMetaById;
  if (!metadata || typeof metadata !== 'object') return { ...layout, boxes: updatedBoxes };
  const scrollMetaById = Object.create(null);
  for (const [id, meta] of Object.entries(metadata)) {
    const original = originals.get(id), draft = drafts.get(id);
    if (!draft) continue; // 削除されたscroll_viewのガイドや当たり判定情報を残さない。
    if (!meta || !original || !sameRect(meta.viewport, original)) { scrollMetaById[id] = meta; continue; }
    const dx = draft.x - original.x, dy = draft.y - original.y;
    scrollMetaById[id] = { ...meta, viewport: { x: draft.x, y: draft.y, w: draft.w, h: draft.h },
      contentBounds: translatedBounds(meta.contentBounds, dx, dy),
      clipRect: sameRect(meta.clipRect, original.clipRect) ? copyRect(draft.clipRect) : copyRect(meta.clipRect) };
  }
  return { ...layout, boxes: updatedBoxes, scrollMetaById };
}
