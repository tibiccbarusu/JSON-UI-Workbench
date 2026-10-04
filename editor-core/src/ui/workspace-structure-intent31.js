/** UIの構造操作を現在の配置へ固定する。共有編集へ自動で切り替えない。 */
export function structureIdentity31(state) {
  const s=state.previewSelection;
  return JSON.stringify([state.workspaceId,state.revision,state.mode,state.editScope,state.editTargetMode,
    state.selectedPointer,state.activePath,state.activeSourceId,s?.screen,s?.effectivePointer,s?.nodeId,s?.preview,state.addGeneration32||0,state.deleteUnit32||'selected']);
}
export function screenStructureOperation31(state, change, targetSelection = null) {
  const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
  if(state.editScope!=='screen'||!['add','delete'].includes(change?.type))fail('WORKSPACE_STRUCTURE_SCOPE','画面限定の追加・削除を指定してください。');
  const s=targetSelection || state.previewSelection;
  if (targetSelection && (change.type!=='add' || !state.previewSelection?.screen ||
      JSON.stringify(s.screen)!==JSON.stringify(state.previewSelection.screen) || s.fileId!==state.previewSelection.fileId))
    fail('WORKSPACE_STRUCTURE_TARGET_STALE','追加先と現在のUIが一致しません。追加先を選び直してください。');
  if(!s?.screen?.path||!s.screen.pointer||!s.effectivePointer||(!targetSelection && (s.path!==state.activePath||s.pointer!==state.selectedPointer||String(s.sourceId||'')!==String(state.activeSourceId||''))))fail('WORKSPACE_PREVIEW_EDIT_SELECTION_REQUIRED','プレビューまたは要素一覧から、追加先の親／削除する配置を選んでください。');
  return {...change,path:s.path,pointer:s.pointer,sourceId:s.sourceId,
    ...(change.type==='add'?{parentPointer:s.pointer}:{}),scope:'screen',targetMode:state.editTargetMode,
    effectivePointer:s.effectivePointer,screen:{...s.screen},...(s.preview?{preview:s.preview}:{})};
}
