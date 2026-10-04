// Node が確認した編集先と表示モデルを照合する。原文の推測・再解釈はしない。
export function resolvePlannedPreviewNodeIds22(mapping, plan) {
  const pointers = plan?.affectedEffectivePointers;
  const fail = () => { throw Object.assign(new Error('変更先をプレビューへ対応付けできません。要素を選び直し、変更先を再確認してください。'), { code: 'WORKSPACE_PREVIEW_TARGET_UNRESOLVED' }); };
  if (!(mapping instanceof Map) || !Array.isArray(pointers) || !pointers.length
    || pointers.length > 50000 || pointers.some(pointer => typeof pointer !== 'string' || !pointer)
    || !pointers.includes(plan?.target?.effectivePointer)) fail();
  const byPointer = new Map();
  for (const [id, source] of mapping) {
    const pointer = source?.previewPointer;
    if (typeof pointer !== 'string') continue;
    if (byPointer.has(pointer)) byPointer.set(pointer, null);
    else byPointer.set(pointer, id);
  }
  const ids = [...new Set(pointers)].map(pointer => byPointer.get(pointer));
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) fail();
  return ids;
}

// 診断には処理の種類と件数だけを加え、原文・属性値・入力文字列を複写しない。
export function pendingEditDiagnosticSummary22(state) {
  const entries = Array.isArray(state.pendingOperations) ? state.pendingOperations : [];
  const short = value => typeof value === 'string' ? value.slice(0, 120) : null;
  const vector = value => Array.isArray(value) && value.length === 2
    && value.every(item => typeof item === 'number' && Number.isFinite(item)) ? [...value] : null;
  return {
    count: entries.length, redoCount: state.pendingRedoOperations?.length || 0,
    version: state.pendingVersion, baseRevision: state.pendingBaseRevision,
    commitUncertain: Boolean(state.pendingCommitUncertain), conflict: Boolean(state.pendingConflict),
    planBusy: Boolean(state.editPlanBusy), planAvailable: Boolean(state.editPlan),
    operations: entries.slice(0, 16).map(({ operation = {}, previewNodeIds }) => ({
      type: short(operation.type), scope: short(operation.scope), targetMode: short(operation.targetMode),
      generatedScope: short(operation.generatedScope), previewTargetCount: previewNodeIds?.length ?? null,
      delta: Array.isArray(operation.delta) && operation.delta.length === 2 && operation.delta.every(Number.isFinite)
        ? [...operation.delta] : null,
    })),
    omittedOperations: Math.max(0, entries.length - 16),
    // デバッグ専用の限定詳細。原文・属性値・画像・入力文字列は複製しない。
    operationDetails: entries.slice(0, 128).map((entry, index) => {
      const operation = entry.operation || {}, targets = entry.previewNodeIds || [];
      const location = value => typeof value === 'string' ? value.slice(0, 512) : null;
      return { index, groupId: Number.isSafeInteger(entry.groupId) ? entry.groupId : null,
        pendingAdditionId: short(entry.pendingAdditionId), additionEdit: entry.pendingAdditionEdit === true,
        type: short(operation.type), path: location(operation.path), sourceId: short(operation.sourceId),
        pointer: location(operation.pointer), parentPointer: location(operation.parentPointer),
        scope: short(operation.scope), targetMode: short(operation.targetMode), generatedScope: short(operation.generatedScope),
        property: short(operation.property), name: operation.type === 'add' ? short(operation.name) : null,
        delta: vector(operation.delta), offset: vector(operation.offset),
        previewFileId: short(entry.previewSelection?.fileId), previewNodeId: short(entry.previewSelection?.nodeId),
        previewNodeIds: targets.slice(0, 32).map(short), omittedPreviewNodeIds: Math.max(0, targets.length - 32),
        truncatedLocationFields: ['path', 'pointer', 'parentPointer'].filter(key => typeof operation[key] === 'string' && operation[key].length > 512),
        truncatedPreviewNodeIds: targets.slice(0, 32).filter(id => typeof id === 'string' && id.length > 120).length };
    }),
    omittedOperationDetails: Math.max(0, entries.length - 128),
  };
}
