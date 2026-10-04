/** ブラウザー/Node 共通。表示座標の変形だけを計算し、DOM・原文・通信へ触れない。 */
const HANDLES = new Set(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
const round = value => Math.round(value * 1000) / 1000;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function validBox(box) {
  if (!box || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(box[key])) || box.w <= 0 || box.h <= 0) {
    fail('WORKSPACE_RESIZE_BOX_INVALID', 'サイズ変更する要素の位置と大きさを確認できません。');
  }
}

/** 8 個のハンドル。Shift は比率維持、Ctrl は中心固定。反対辺を越えても反転しない。 */
export function resizeBox33(start, handle, dx, dy, { preserveRatio = false, fromCenter = false, minSize = 1, maxSize = 100000 } = {}) {
  validBox(start);
  if (!HANDLES.has(handle) || !Number.isFinite(dx) || !Number.isFinite(dy)) fail('WORKSPACE_RESIZE_INPUT_INVALID', 'サイズ変更の操作が不正です。');
  const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s');
  const horizontal = west || east, vertical = north || south, scale = fromCenter ? 2 : 1;
  let w = horizontal ? start.w + dx * (west ? -scale : scale) : start.w;
  let h = vertical ? start.h + dy * (north ? -scale : scale) : start.h;
  if (preserveRatio) {
    let factor = horizontal && vertical ? (Math.abs(w / start.w - 1) >= Math.abs(h / start.h - 1) ? w / start.w : h / start.h)
      : horizontal ? w / start.w : h / start.h;
    factor = Math.max(Math.max(minSize / start.w, minSize / start.h), Math.min(Math.min(maxSize / start.w, maxSize / start.h), factor));
    w = start.w * factor; h = start.h * factor;
  } else { w = Math.max(minSize, Math.min(maxSize, w)); h = Math.max(minSize, Math.min(maxSize, h)); }
  const x = fromCenter || !horizontal && preserveRatio ? start.x + (start.w - w) / 2 : west ? start.x + start.w - w : start.x;
  const y = fromCenter || !vertical && preserveRatio ? start.y + (start.h - h) / 2 : north ? start.y + start.h - h : start.y;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

function anchorUnit(value) {
  const key = String(value || 'center').toLowerCase().replaceAll('_', '');
  const units = { topleft: [0, 0], topmiddle: [.5, 0], topcenter: [.5, 0], topright: [1, 0],
    leftmiddle: [0, .5], leftcenter: [0, .5], center: [.5, .5], middle: [.5, .5],
    rightmiddle: [1, .5], rightcenter: [1, .5], bottomleft: [0, 1], bottommiddle: [.5, 1], bottomcenter: [.5, 1], bottomright: [1, 1] };
  if (!units[key]) fail('WORKSPACE_RESIZE_ANCHOR_DYNAMIC', '位置の基準が動的なため、ハンドルでサイズを変更できません。属性で基準を確認してください。');
  return units[key];
}

/** 位置の割合表記は move の差分で保持し、size と同じ Undo 単位へまとめる。 */
export function resizeChanges33(start, end, props = {}) {
  validBox(start); validBox(end);
  if (props.size !== undefined && (!Array.isArray(props.size) || props.size.length !== 2)) {
    fail('WORKSPACE_RESIZE_SIZE_DYNAMIC', 'サイズ全体が動的なため、属性で確認してから変更してください。');
  }
  if (props.size?.some(value => typeof value === 'string' && /[$@#()]|\b(?:min|max)\b/u.test(value))) {
    fail('WORKSPACE_RESIZE_SIZE_DYNAMIC', 'サイズに変数や計算式があります。式を固定値へ置き換えずに保つため、属性で元の変数・式を編集してください。');
  }
  const [ax, ay] = anchorUnit(props.anchor_to);
  const delta = [round(end.x - start.x + (end.w - start.w) * ax), round(end.y - start.y + (end.h - start.h) * ay)];
  const changes = [];
  // move を先に検査し、自動配置や動的 offset の保護を維持する。
  if (delta.some(value => value !== 0)) changes.push({ type: 'move', delta });
  changes.push({ type: 'set', property: 'size', value: [
    end.w === start.w && props.size ? props.size[0] : round(end.w),
    end.h === start.h && props.size ? props.size[1] : round(end.h),
  ] });
  return changes;
}

/** 新規追加直後の未確定要素を、原文 pointer を作らず同じ変形履歴で編集する。 */
export function resizePendingAddition33(controller, scene, nodeId, start, end) {
  const id = scene?.additionsByNodeId?.get(nodeId);
  if (!id || scene.pendingVersion !== controller.state.pendingVersion || scene.baseRevision !== controller.state.revision) {
    fail('WORKSPACE_DRAFT_ADDITION_STALE', '追加予定の表示が更新されました。選び直してください。');
  }
  const addition = controller.pendingAdditions().find(item => item.id === id);
  if (!addition) fail('WORKSPACE_PENDING_ADDITION_MISSING', '追加予定の要素が見つかりません。');
  return controller.editPendingAddition(id, resizeChanges33(start, end, addition.operation.value));
}
