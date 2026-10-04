import { siteText } from '../i18n/site-messages.js';

// ブラウザー/Node共通の純粋なガード。Minecraft用の編集設定を、非同期の
// 選択同期を待つ間に別の設定へ読み替えない。プレビュー動作ON/OFFとは無関係。
export function captureGeometryPolicy29(state) {
  return JSON.stringify([state.workspaceId, state.sourceKey, state.revision, state.mode,
    state.editScope || 'screen', state.editTargetMode || 'visual', state.pendingVersion]);
}
export function assertGeometryPolicy29(state, captured) {
  if (captureGeometryPolicy29(state) !== captured) {
    throw Object.assign(new Error(siteText('待機中に編集設定または原文が変わりました。変更は追加していません。対象と設定を確認して操作し直してください。')),
      { code: 'WORKSPACE_SELECTION_SUPERSEDED' });
  }
}

/** 同じ機能親を複数選んでも二重に移動しない。全件計画後に一括キューへ入れる。 */
export function distinctPlannedMoves29(entries) {
  const selected = new Map();
  for (const entry of entries) {
    const plan = entry.plan, pointer = plan?.target?.effectivePointer;
    if (!pointer || !Array.isArray(entry.targetIds) || !entry.targetIds.length) {
      throw Object.assign(new Error(siteText('実際に移動する要素を確認できません。要素を選び直してください。')),
        { code: 'WORKSPACE_PREVIEW_TARGET_UNRESOLVED' });
    }
    if (plan.generated || plan.requiresTemplateConsent || Number(plan.affectedInstances) > 1) {
      throw Object.assign(new Error(siteText('共有・生成テンプレートはまとめて移動できません。1要素を選択し、影響範囲を確認してください。')),
        { code: 'WORKSPACE_GROUP_SHARED_TARGET' });
    }
    const screen = JSON.stringify(entry.operation.screen), key = JSON.stringify([screen, pointer]);
    if (!selected.has(key)) selected.set(key, { ...entry, screen, pointer });
  }
  const all = [...selected.values()];
  return all.filter(entry => !all.some(parent => parent !== entry && parent.screen === entry.screen
    && entry.pointer.startsWith(`${parent.pointer}/`)));
}
