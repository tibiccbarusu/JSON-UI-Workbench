// ブラウザ用。原文草稿・ポインター操作と再描画の整合性を扱う import-safe 境界。
import { sameWorkspacePreviewModel } from './workspace-editor.js';

// Node の同じ frame を再取得してもオブジェクト参照は毎回変わる。
// 操作開始時に配置内容を固定し、同値の新オブジェクトと実配置変更を区別する。
// 上限超過・循環など、不明な配置は同一とは判定しない。
function sourceDragLayoutSignature(layout) {
  if (!layout || !Array.isArray(layout.boxes) || layout.boxes.length > 10000) return null;
  try { return JSON.stringify([layout.preset || null, layout.boxes]); }
  catch { return null; }
}

/** 手入力で原文へ戻した場合も、失効済みのフレームを一度要求する。 */
export function resumeWorkspacePreviewAfterDraft(controller, { pause, requestFrame }) {
  pause();
  if (!controller.previewBlocked()) requestFrame();
}

/** モデルだけでなく、ドラッグ開始時の配置・座標変換も固定する。 */
export function captureWorkspaceSourceDrag({ file, revision, layout, context, view, pendingVersion = 0, selectionIds = [] }) {
  if (!Array.isArray(selectionIds) || selectionIds.length > 50000) throw new TypeError('ドラッグ対象の選択一覧が不正です。');
  return { file, revision, pendingVersion, selectionIds: [...selectionIds], layout, layoutSignature: sourceDragLayoutSignature(layout), context,
    view: [view.zoom, view.viewX, view.viewY] };
}

/** 配置や倍率が途中で変わった操作を、別の座標として原文に保存しない。 */
export function isWorkspaceSourceDragCurrent(snapshot, { file, revision, layout, context, view, pendingVersion = 0, selectionIds = [] }) {
  return Boolean(snapshot && sameWorkspacePreviewModel(snapshot.file, file)
    && snapshot.revision === revision && snapshot.context === context
    && snapshot.pendingVersion === pendingVersion
    && Array.isArray(selectionIds) && snapshot.selectionIds.length === selectionIds.length
    && snapshot.selectionIds.every((id, index) => id === selectionIds[index])
    && snapshot.layoutSignature !== null && snapshot.layoutSignature === sourceDragLayoutSignature(layout)
    && snapshot.view.every((value, index) => value === [view.zoom, view.viewX, view.viewY][index]));
}

/** pointerup から対象確認・キュー保存までの間、最後の表示位置を独立して保持する。 */
export function captureWorkspaceSourceCommitDraft(snapshot, { targetId, startBox, draftBox, mode = 'move', groupIds = snapshot?.selectionIds } = {}) {
  const invalid = () => { throw Object.assign(new TypeError('移動の仮配置を保持できません。要素を選び直してください。'), { code: 'WORKSPACE_SOURCE_COMMIT_DRAFT_INVALID' }); };
  if (!['move', 'resize'].includes(mode) || !snapshot || !Array.isArray(snapshot.selectionIds) || !Array.isArray(snapshot.view)
    || typeof targetId !== 'string' || !targetId || !Array.isArray(groupIds)
    || !groupIds.length || groupIds.length > 50000 || new Set(groupIds).size !== groupIds.length
    || !Array.from(groupIds).every(id => typeof id === 'string' && id.length > 0)
    || groupIds.length !== snapshot.selectionIds.length
    || !groupIds.every((id, index) => id === snapshot.selectionIds[index])) invalid();
  const copyBox = box => {
    if (!box || !['x', 'y', 'w', 'h'].every(key => typeof box[key] === 'number' && Number.isFinite(box[key]))
      || box.w < 0 || box.h < 0) invalid();
    return Object.freeze(Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, box[key]])));
  };
  return Object.freeze({
    sourceDrag: Object.freeze({ ...snapshot, selectionIds: Object.freeze([...snapshot.selectionIds]), view: Object.freeze([...snapshot.view]) }),
    interaction: Object.freeze({ active: true, moved: true, mode, targetId,
      groupIds: Object.freeze([...groupIds]), startBox: copyBox(startBox), draftBox: copyBox(draftBox) }),
  });
}

/** キュー世代が変わった時点で表示を引き継ぎ、同じ移動量の二重描画を防ぐ。 */
export function workspaceSourceCommitDraftInteraction(draft, current) {
  return draft && isWorkspaceSourceDragCurrent(draft.sourceDrag, current) ? draft.interaction : null;
}
