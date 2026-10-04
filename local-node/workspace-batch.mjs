/** Node Worker-only atomic draft execution. No live session is changed here. */
import { editWorkspace, workspaceRevision } from './workspace-edit.mjs';
import { buildScopedEditContext, editWorkspaceScoped, inspectScopedEditSelection,
  SCOPED_RESULT_REBASE, SCOPED_RESULT_CONTEXT, SCOPED_BATCH_OWNERSHIP,
  SCOPED_BATCH_MOVE_SEQUENCE, SCOPED_BATCH_MOVE_VALUES, SCOPED_SEQUENCE_FAILED_INDEX, rebaseScopedSelectionAfterStructure } from './workspace-scoped-edit.mjs';
import { WorkspaceEditError, editFail, pointerParts } from './workspace-jsonc.mjs';
import { preflightBaseTargets, structuralLocationMapper, rebaseRawOperation } from './workspace-batch-structure.mjs';

// The total operation budget also bounds add/delete in the opt-in contract.
export const WORKSPACE_BATCH_LIMITS = Object.freeze({ operations: 128, legacyStructuralOperations: 1,
  baseRevisionStructuralOperations: 128 });
const STRUCTURAL_TYPES = new Set(['add', 'delete', 'inherit', 'replaceText']);
const ALLOWED_TYPES = new Set(['move', 'set', ...STRUCTURAL_TYPES]);
const DISPLAY_PROPERTIES = new Set(['offset', 'size', 'min_size', 'max_size', 'anchor_from', 'anchor_to',
  'text', 'texture', 'color', 'alpha', 'font_type', 'font_scale_factor', 'font_size', 'shadow',
  'layer', 'uv', 'uv_size', 'nineslice_size', 'keep_ratio', 'text_alignment', 'line_padding',
  'visible', 'enabled', 'clip_children', 'rotate', 'grayscale']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function structural(operation) {
  if (STRUCTURAL_TYPES.has(operation.type)) return true;
  if (operation.type !== 'set') return false;
  const property = operation.scope === undefined ? pointerParts(operation.pointer).at(-1) : operation.property;
  // Changing variables, control arrays, types or an entire object can invalidate
  // later selections, including repeated equal local names at array indices.
  return !DISPLAY_PROPERTIES.has(property);
}
function sameMoveSelection(first, next) {
  if (first.type !== 'move' || next.type !== 'move' || first.scope === undefined || next.scope === undefined
    || first.delta === undefined || next.delta === undefined) return false;
  // Ignore only the delta itself; all other supplied semantics must agree.
  const identity = operation => Object.fromEntries(Object.keys(operation).filter(key => key !== 'delta').sort().map(key => [key, operation[key]]));
  return JSON.stringify(identity(first)) === JSON.stringify(identity(next));
}
function failed(error, index, count) {
  if (!(error instanceof WorkspaceEditError)) error = new WorkspaceEditError(
    'EDIT_BATCH_INTERNAL_ERROR', '一括編集の検査で予期しないエラーが発生しました。変更は反映されていません。', [], error);
  const details = [...error.details, ...(index === undefined ? [] : [{ kind: 'batch_operation',
    field: `/operation/operations/${index}`, reason: error.code, message: `${index + 1} 件目の操作を反映できません。`, operationIndex: index }])];
  return { ok: false, code: error.code, message: error.message, previewAllowed: false, diagnostics: [],
    error: { code: error.code, message: error.message, category: error.category, retryable: false,
      correlation_id: null, details }, batch: { atomic: true, operationCount: count, appliedCount: 0,
      ...(index === undefined ? {} : { failedOperationIndex: index }) } };
}
function failedResult(result, index, count) {
  // Intermediate authored documents and edit plans must not escape a rolled
  // back transaction. The original structured failure remains the cause.
  const detail = { kind: 'batch_operation', field: `/operation/operations/${index}`, reason: result.code || 'EDIT_BATCH_FAILED',
    message: `${index + 1} 件目の操作を反映できません。`, operationIndex: index };
  return { ok: false, code: result.code, message: result.message, previewAllowed: false,
    diagnostics: result.diagnostics || [], error: { ...result.error, details: [...(result.error?.details || []), detail] },
    batch: { atomic: true, operationCount: count, appliedCount: 0, failedOperationIndex: index } };
}

/**
 * Operations have already had physical paths resolved by WorkspaceSessions.
 * Scoped selections refer to the starting revision. Trusted copy proofs update
 * them after each isolation; caller-supplied replacement paths are never used.
 * Legacy batches permit one structural operation at the end. Explicit
 * pointerBasis:'base-revision' batches also permit intermediate add/delete,
 * with authored ranges and source ancestry proving every later selection.
 * Inherit, whole-text replacement and structural set remain last-only.
 */
export async function editWorkspaceBatch({ documents, documentSources, operation, expectedRevision, checkpoint = () => {}, reuseReferenceProof = true } = {}) {
  let operationIndex;
  const count = Array.isArray(operation?.operations) ? operation.operations.length : 0;
  try {
    checkpoint('batch-validation', 0, count);
    const beforeRevision = workspaceRevision(documents, documentSources);
    if (expectedRevision !== beforeRevision) editFail('EDIT_REVISION_CONFLICT', '編集前の状態が更新されています。草稿を確認してください。', 'expectedRevision');
    if (!object(operation) || operation.type !== 'batch' || !Array.isArray(operation.operations) || !count) {
      editFail('EDIT_BATCH_INVALID', '一括編集には 1 件以上の操作配列を指定してください。', '/operation/operations');
    }
    if (count > WORKSPACE_BATCH_LIMITS.operations) editFail('EDIT_BATCH_LIMIT', '一括編集の上限は 128 件です。変更を反映してから次の操作を行ってください。', '/operation/operations');
    if (operation.pointerBasis !== undefined && operation.pointerBasis !== 'base-revision') editFail('EDIT_BATCH_POINTER_BASIS_INVALID', '一括編集の選択基準が不正です。');
    const basePointers = operation.pointerBasis === 'base-revision';
    const pending = operation.operations.map(item => ({ ...item }));
    for (const [index, item] of operation.operations.entries()) {
      checkpoint('batch-validation', index, count);
      operationIndex = index;
      if (!object(item) || !ALLOWED_TYPES.has(item.type)) editFail('EDIT_BATCH_OPERATION_INVALID', '一括編集には移動・属性設定・追加・削除・継承変更・原文置換を指定してください。', `/operation/operations/${index}/type`);
      if (item.scope !== undefined && (!['screen', 'shared'].includes(item.scope) || !['visual', 'interaction'].includes(item.targetMode))) {
        editFail('EDIT_SCOPE_INVALID', '編集範囲と移動単位を指定してください。', `/operation/operations/${index}/scope`);
      }
      if (item.scope !== undefined && !['move', 'set', 'add', 'delete'].includes(item.type)) {
        editFail('EDIT_SCOPED_OPERATION_INVALID', '範囲付き編集は移動と属性設定に対応します。', `/operation/operations/${index}/type`);
      }
      if(item.scope !== undefined && ['add','delete'].includes(item.type) && index !== count-1) editFail('EDIT_BATCH_STRUCTURE_LAST','画面限定の構造変更は最後の1件として確定してください。', `/operation/operations/${index}`);
      if (structural(item) && !(basePointers && ['add', 'delete'].includes(item.type)) && index !== count - 1) editFail('EDIT_BATCH_STRUCTURE_LAST',
        'この構造変更は一括編集の最後の 1 件にしてください。追加・削除の連続操作には開始 revision 基準を指定してください。', `/operation/operations/${index}`);
    }
    const baseTrees = new Map();
    if (basePointers) for (const [index, item] of pending.entries()) {
      operationIndex = index; preflightBaseTargets(documents, item, baseTrees);
    }
    let context;
    if (pending.some(item => item.scope !== undefined)) {
      context = await buildScopedEditContext({ documents, documentSources, checkpoint });
      const projections = new Map();
      // Every frozen selection is checked against the initial revision before
      // any operation can change the interpretation of another selection.
      for (const [index, item] of pending.entries()) if (item.scope !== undefined) {
        checkpoint('selection-validation', index, count);
        operationIndex = index;
        inspectScopedEditSelection(context, item, projections);
      }
      projections.clear();
    }
    let currentDocuments = documents, revision = beforeRevision, last;
    const summaries = [], privateDefinitions = new Map();
    for (let index = 0; index < pending.length; index++) {
      checkpoint('batch-edit', index, count);
      // Its mapping/context have already been consumed below the prior turn.
      // Do not retain the previous full node list and rebase closure while the
      // next edit constructs its temporary validation trees.
      last = undefined;
      const item = pending[index];
      operationIndex = index;
      let sequenceEnd = index + 1;
      while (sequenceEnd < pending.length && sameMoveSelection(item, pending[sequenceEnd])) sequenceEnd++;
      const beforeDocuments = currentDocuments;
      if (basePointers && ['add', 'delete'].includes(item.type) && pending.slice(index + 1).some(next => next.scope !== undefined)
        && context?.revision !== revision) context = await buildScopedEditContext({ documents: currentDocuments, documentSources, checkpoint });
      const beforeContext = context;
      const executing = sequenceEnd > index + 1 ? { ...item, [SCOPED_BATCH_MOVE_SEQUENCE]: pending.slice(index + 1, sequenceEnd).map(next => next.delta) } : item;
      if (item.scope !== undefined) {
        if (context?.revision !== revision) context = await buildScopedEditContext({ documents: currentDocuments, documentSources, checkpoint });
        context[SCOPED_BATCH_OWNERSHIP] = privateDefinitions;
        last = await editWorkspaceScoped({ documents: currentDocuments, documentSources, operation: executing, expectedRevision: revision, context, checkpoint, reuseReferenceProof });
      } else last = editWorkspace({ documents: currentDocuments, documentSources, operation: item, expectedRevision: revision });
      if (!last.ok) return failedResult(last, index + (last[SCOPED_SEQUENCE_FAILED_INDEX] || 0), count);
      currentDocuments = last.documents;
      revision = last.revision;
      summaries.push({ index, type: item.type, ...(last.editPlan ? { editPlan: last.editPlan } : {}) });
      for (let offset = 1; index + offset < sequenceEnd; offset++) {
        const nextOperation = last[SCOPED_RESULT_REBASE]?.(pending[index + offset]) || pending[index + offset];
        const plan = last.editPlan;
        const previousOffset = last[SCOPED_BATCH_MOVE_VALUES][offset - 1];
        const target = { ...plan.target, pointer: plan.committedTarget.pointer, props: { ...plan.target.props, offset: previousOffset } };
        summaries.push({ index: index + offset, type: 'move', editPlan: { ...plan,
          selected: { ...plan.selected, pointer: nextOperation.pointer }, target,
          committedTarget: { ...target, pointer: plan.committedTarget.pointer }, clonedDefinitions: [] } });
      }
      if (last[SCOPED_RESULT_REBASE]) {
        for (let next = index + 1; next < pending.length; next++) pending[next] = last[SCOPED_RESULT_REBASE](pending[next]);
      }
      if (item.scope === 'screen' && last.editPlan?.clonedDefinitions?.length) {
        const screen = last.editPlan.affectedScreens[0];
        const key = JSON.stringify([screen.sourceId, screen.path, screen.qualifiedName]);
        if (!privateDefinitions.has(key)) privateDefinitions.set(key, new Set());
        for (const copy of last.editPlan.clonedDefinitions) privateDefinitions.get(key).add(
          JSON.stringify([copy.sourceId, copy.path, copy.qualifiedName]));
      }
      // Raw/shared/structural edits can introduce a reference to a formerly
      // private clone. Ownership is a transaction proof, not a permanent name
      // convention; discard it before any later screen isolation reuses it.
      if (item.scope !== 'screen' || !(item.type === 'move'
        || item.type === 'set' && ['offset', 'size', 'min_size', 'max_size', 'anchor_from', 'anchor_to'].includes(item.property))) {
        privateDefinitions.clear();
      }
      context = last[SCOPED_RESULT_CONTEXT];
      if (basePointers && ['add', 'delete'].includes(item.type) && index + 1 < pending.length) {
        const mapLocation = structuralLocationMapper(beforeDocuments, item, last);
        const hasScoped = pending.slice(index + 1).some(next => next.scope !== undefined);
        if (hasScoped) context = await buildScopedEditContext({ documents: currentDocuments, documentSources, checkpoint });
        const caches = {};
        for (let next = index + 1; next < pending.length; next++) {
          operationIndex = next;
          pending[next] = pending[next].scope !== undefined
            ? rebaseScopedSelectionAfterStructure(beforeContext, context, pending[next], mapLocation, caches)
            : rebaseRawOperation(beforeDocuments, pending[next], mapLocation);
        }
      }
      index = sequenceEnd - 1;
      checkpoint('batch-edit', sequenceEnd, count);
    }
    const changes = Object.entries(currentDocuments).filter(([path, text]) => documents[path] !== text)
      .map(([path, text]) => ({ path, before: documents[path], after: text }));
    return { ok: true, documents: currentDocuments, beforeRevision, revision,
      changes, previewAllowed: last.previewAllowed, diagnostics: last.diagnostics || [], nodes: last.nodes || [],
      batch: { atomic: true, operationCount: count, appliedCount: count },
      editPlan: { type: 'batch', operations: summaries, deviceValidation: 'NOT_RUN' },
      ...(last.deletePlan ? { deletePlan: last.deletePlan } : {}) };
  } catch (error) {
    if (error?.code === 'NODE_JOB_CANCELLED') throw error;
    return failed(error, operationIndex, count);
  }
}
