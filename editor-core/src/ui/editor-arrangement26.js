/** 編集画面だけのロック・重なり計画。JSON UI の解釈や原文の書換えは行わない。 */
function failure(code, message) { throw Object.assign(new Error(message), { code }); }
const childId = value => typeof value === 'string' ? value : value?.id;

function indexTree(nodes) {
  const parents = new Map(), children = new Map();
  for (const [id, node] of Object.entries(nodes || {})) {
    children.set(id, (node?.children || []).map(childId).filter(value => typeof value === 'string'));
    if (node?.parentId) parents.set(id, String(node.parentId));
  }
  for (const [parent, members] of children) for (const id of members) {
    if (parents.has(id) && parents.get(id) !== parent) failure('EDITOR_TREE_INVALID', '要素の親子関係を確認できません。');
    parents.set(id, parent);
  }
  return { parents, children };
}

/** 自身・祖先・子孫のロックを検査し、親移動によるロックの迂回も防ぐ。 */
export function lockedMovement26(ids, nodes, locked = new Set()) {
  if (!locked.size || !ids.length) return null;
  const { parents, children } = indexTree(nodes), visited = new Set();
  for (const id of ids) {
    const trail = new Set(); let cursor = id;
    while (cursor) {
      if (trail.has(cursor)) failure('EDITOR_TREE_CYCLE', '要素の親子関係が循環しています。');
      trail.add(cursor);
      if (locked.has(cursor)) return { id: cursor, relation: cursor === id ? 'self' : 'ancestor' };
      cursor = parents.get(cursor);
    }
  }
  const todo = [...ids];
  while (todo.length) {
    const id = todo.pop(); if (visited.has(id)) continue; visited.add(id);
    if (locked.has(id)) return { id, relation: ids.includes(id) ? 'self' : 'descendant' };
    todo.push(...(children.get(id) || []));
  }
  return null;
}

/** 同じ親の要素だけを比較。controls の順序と layer の違いを混同しない。 */
export function planLayerMove26({ nodeId, nodesById, boxes, direction, properties = null }) {
  if (!['forward', 'backward', 'front', 'back'].includes(direction)) failure('EDITOR_LAYER_DIRECTION', '重なり順の操作が不正です。');
  const { parents, children } = indexTree(nodesById), parent = parents.get(nodeId);
  if (!parent) failure('EDITOR_LAYER_ROOT', '画面全体の重なり順は変更できません。子要素を選択してください。');
  const lookup = new Map((boxes || []).map((box, index) => [String(box.id), { ...box, order: index }]));
  const box = lookup.get(nodeId);
  const props = properties || nodesById[nodeId]?.props || {};
  const local = props.layer ?? 0;
  if (typeof local !== 'number' || !Number.isFinite(local)) failure('EDITOR_LAYER_DYNAMIC', '重なり順に変数や計算式が使われています。原文の設定を確認してください。');
  if (!box || !Number.isFinite(box.layer)) failure('EDITOR_LAYER_UNAVAILABLE', 'この要素の描画順を確認できません。プレビューの更新後に操作してください。');
  const siblings = (children.get(parent) || []).filter(id => lookup.has(id)).map(id => lookup.get(id))
    .sort((a, b) => a.layer - b.layer || a.order - b.order);
  const index = siblings.findIndex(item => item.id === nodeId);
  if (index < 0) failure('EDITOR_LAYER_UNAVAILABLE', '同じ親の要素一覧を確認できません。');
  const forward = direction === 'forward' || direction === 'front';
  const targetIndex = direction === 'front' ? siblings.length - 1 : direction === 'back' ? 0 : index + (forward ? 1 : -1);
  const target = siblings[Math.max(0, Math.min(siblings.length - 1, targetIndex))];
  let delta;
  if (direction === 'front' || direction === 'back') {
    const range = id => {
      let min = Infinity, max = -Infinity; const todo = [id], seen = new Set();
      while (todo.length) {
        const current = todo.pop(); if (seen.has(current)) continue; seen.add(current);
        const item = lookup.get(current);
        if (item) { const layer = item.effectiveLayer ?? item.layer; if (!Number.isFinite(layer)) failure('EDITOR_LAYER_UNAVAILABLE', '子要素の描画順を確認できません。'); min = Math.min(min, layer); max = Math.max(max, layer); }
        todo.push(...(children.get(current) || []));
      }
      return { min, max };
    };
    const own = range(nodeId), others = siblings.filter(item => item.id !== nodeId).map(item => range(item.id));
    if (!others.length) return null;
    const min = Math.min(...others.map(item => item.min)), max = Math.max(...others.map(item => item.max));
    if (forward && own.min > max || !forward && own.max < min) return null;
    delta = forward ? max - own.min + 1 : min - own.max - 1;
  } else {
    if (targetIndex < 0 || targetIndex >= siblings.length || targetIndex === index) return null;
    delta = target.layer - box.layer + (forward ? 1 : -1);
  }
  // 子を含む描画範囲を前後へ移す。controlsや親子関係には触れない。
  const value = local + delta;
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) failure('EDITOR_LAYER_RANGE', '重なり順の値が大きいため、自動変更を停止しました。原文を確認してください。');
  return { property: 'layer', value, targetId: String(target.id), parentId: parent, direction };
}

/** 既知の工程の総数だけを百分率にする。未知量やゼロ除算に仮の % を付けない。 */
export function studioProgressModel26({ label, progress = {}, startedAt, now }) {
  const completed = progress.completed ?? progress.processed;
  const total = progress.total;
  const known = typeof completed === 'number' && Number.isFinite(completed) && completed >= 0
    && typeof total === 'number' && Number.isFinite(total) && total > 0 && completed <= total;
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const percent = known ? Math.floor(completed / total * 100) : null;
  const waiting = progress.status === 'queued';
  return { label, percent, elapsed, waiting, slow: elapsed >= 30,
    text: `${label}${waiting ? ' · 前の処理を待っています' : ''}${known ? ` ${percent}% (${completed} / ${total})` : ''} · ${elapsed}秒${elapsed >= 30 ? ' · 処理に時間がかかっています' : ''}` };
}
