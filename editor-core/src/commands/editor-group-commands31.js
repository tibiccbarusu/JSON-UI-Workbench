/** グループ操作は原文の親子関係を変えず、既存選択メタデータを操作する。 */
export const GROUP_SHORTCUTS31 = Object.freeze({ group: 'Mod+Alt+G', ungroup: 'Mod+Alt+Shift+G' });
const scopes = '#preview-canvas, .studio-elements26, #studio-ribbon, #studio-context-menu';
export function acceptsGroupKey31(event, { editing = false, modalOpen = false } = {}) {
  if (!editing || modalOpen || event?.isComposing || event?.keyCode === 229 || event?.getModifierState?.('AltGraph')) return false;
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return false;
  if (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="dialog"], dialog')) return false;
  return !!target.closest(scopes);
}
export function groupUnavailableReason31(state, action) {
  if (!state?.editing) return '編集モードでUIを開いてから操作してください。';
  if (state.busy) return '原文の処理が完了してからグループを操作してください。';
  const s = state.selection || {};
  if (action === 'ungroup') return s.canUngroup ? '' : '解除するグループの要素を選択してください。';
  if (s.canGroup) return '';
  const selected = s.selectedIds?.length || 0, roots = s.movementRootIds?.length || 0;
  return selected >= 2 && roots < 2
    ? `${selected}要素を選択していますが、親子関係を除く独立した対象は${roots}個です。別の要素を追加選択してください。`
    : 'グループ化するには独立した要素を2個以上選択してください。';
}
export function registerEditorGroupCommands31(system, { getState, group, ungroup, notify }) {
  for (const [action, run] of [['group', group], ['ungroup', ungroup]]) system.register({
    id: 'editor.' + action, titleKey: `cmd.editor.${action}.title`, descriptionKey: `cmd.editor.${action}.desc`,
    shortcuts: [GROUP_SHORTCUTS31[action]], allowRepeat: false, consumeRepeat: true,
    acceptsEvent: ev => acceptsGroupKey31(ev, getState()),
    isEnabled: () => !groupUnavailableReason31(getState(), action),
    onDisabled: () => notify?.(groupUnavailableReason31(getState(), action)),
    run: () => run(),
  });
}
