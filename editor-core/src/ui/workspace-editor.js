import { screenStructureOperation31, structureIdentity31 } from './workspace-structure-intent31.js';
import { isUnitlessDimensionNumber } from '../json/ui-dimension-contract.js';
import { readDiagnosticDataProperty } from '../diagnostics/site-diagnostic-session.js';
import { siteText, translateSiteMessage } from '../i18n/site-messages.js';
import { workspaceExportPlan, workspaceExportError } from './workspace-export-report.js';
import { createWorkspacePendingEdits, isStructuralWorkspaceOperation } from './workspace-pending-edits.js';
import { createWorkspaceEditIntent, renderWorkspaceEditPlan, workspaceEditSelectionIdentity, workspacePreviewEditOperation } from './workspace-edit-intent.js';
// ブラウザ用。import 時に DOM・通信・保存を行わない原文編集コントローラー。
const MAX_DRAFT_CHARS = 8 * 1024 * 1024;
const UI_REGISTRY_READ_ONLY_MESSAGE = 'UIファイルの登録は閲覧専用です。変更したパックを再読込してください。';
const isReadOnlyUiRegistry = path => typeof path === 'string' && /^ui\/_ui_defs\.jsonc?$/iu.test(path);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const localName = key => String(key || '').split('@', 1)[0];
export const escapeSourcePointer = value => String(value).replace(/~/gu, '~0').replace(/\//gu, '~1');
/** 同じ物理パスにある別レイヤーの原文を区別するキー。内部仮想パスは公開しない。 */
export const workspaceDocumentKey = (path, sourceId = '') => sourceId ? JSON.stringify([sourceId, path]) : String(path || '');
export const matchesWorkspaceDocument = (row, path, sourceId = '') => (row?.physicalPath || row?.path) === path && String(row?.sourceId || '') === String(sourceId || '');
export function workspaceRecordSourceId(record, sources = []) {
  if (!record) return '';
  const raw = record.sourceId;
  const exact = sources.filter(source => source.id === raw);
  if (exact.length === 1) return exact[0].id;
  if (raw && !['vanilla-reference', 'imported-pack'].includes(raw)) fail('WORKSPACE_SOURCE_CHANGED', siteText('選択した原文のパックは現在の作業領域にありません。'));
  const kind = raw === 'vanilla-reference' ? 'vanilla' : raw === 'imported-pack' ? 'imported' : record.sourceKind;
  const candidates = sources.filter(source => source.kind === kind);
  if (candidates.length !== 1) fail('WORKSPACE_SOURCE_AMBIGUOUS', siteText('原文のパックを一意に特定できません。読み込むパックを確認してください。'));
  return candidates[0].id;
}


function fail(code, message = code, sourceError = null) {
  const error = Object.assign(new Error(message), { code });
  for (const key of ['category', 'correlation_id']) {
    const value = readDiagnosticDataProperty(sourceError, key);
    if (typeof value === 'string') error[key] = value;
  }
  const retryable = readDiagnosticDataProperty(sourceError, 'retryable');
  if (typeof retryable === 'boolean') error.retryable = retryable;
  const details=readDiagnosticDataProperty(sourceError,'details');
  if(code.startsWith('EDIT_STRUCTURE_REFERENCE')&&Array.isArray(details))error.referenceInfo32=details.slice(0,8).map(item=>Object.fromEntries(
    ['sourceProperty','referenceKind','sourcePath','sourcePointer','candidateTarget','reason','policy'].map(key=>[key,readDiagnosticDataProperty(item,key)]).filter(([,v])=>typeof v==='string').map(([k,v])=>[k,v.slice(0,1024)])));
  throw error;
}
// この一覧は Node の原子的編集検証で、session 公開前にだけ返る拒否コード。
// 未知コード・取消・応答生成失敗は HTTP 4xx でも結果不明として再送しない。
// 根拠: workspace-session.commitEdit() の candidate 検証後に sessions.set() が走る。
const DEFINITIVE_EDIT_REJECTION_CODES = new Set([
  'EDIT_INTERACTION_TARGET_AMBIGUOUS', 'EDIT_STRUCTURE_GENERATED', 'EDIT_STRUCTURE_PARENT', 'EDIT_STRUCTURE_ROOT_DELETE',
  'EDIT_STRUCTURE_REFERENCE_UNKNOWN', 'EDIT_STRUCTURE_DELETE_UNIT', 'EDIT_STRUCTURE_LIMIT', 'EDIT_STRUCTURE_REFERENCE_LIMIT', 'EDIT_STRUCTURE_REFERENCED', 'EDIT_STRUCTURE_POINTER',
  'EDIT_STRUCTURE_SHAPE', 'EDIT_STRUCTURE_SCOPE', 'EDIT_STRUCTURE_SHARED', 'EDIT_STRUCTURE_ADD_COMPLEX', 'EDIT_STRUCTURE_CASCADE',
  'EDIT_ADD_INVALID', 'EDIT_ANIMATED_POSITION', 'EDIT_ARRAY_INSERT_INVALID', 'EDIT_BATCH_FAILED',
  'EDIT_BATCH_INTERNAL_ERROR', 'EDIT_BATCH_INVALID', 'EDIT_BATCH_LIMIT', 'EDIT_BATCH_OPERATION_INVALID',
  'EDIT_BATCH_STRUCTURE_LAST', 'EDIT_CASCADE_REQUIRED', 'EDIT_CLONE_BYTE_LIMIT', 'EDIT_CLONE_LIMIT',
  'EDIT_BATCH_POINTER_BASIS_INVALID', 'EDIT_BATCH_TARGET_REMOVED',
  'EDIT_BATCH_SELECTION_AMBIGUOUS', 'EDIT_BATCH_BASE_TARGET_REQUIRED',
  'EDIT_COPY_PROOF_INVALID', 'EDIT_DELETE_IMPACT_UNKNOWN', 'EDIT_DELTA_INVALID', 'EDIT_DELTA_REQUIRED',
  'EDIT_DEPTH_LIMIT', 'EDIT_DIAGNOSTIC_LIMIT', 'EDIT_DOCUMENTS_INVALID', 'EDIT_DOCUMENT_NOT_FOUND',
  'EDIT_DUPLICATE_KEY', 'EDIT_DYNAMIC_CONTROLS', 'EDIT_DYNAMIC_OFFSET', 'EDIT_DYNAMIC_POSITION',
  'EDIT_DYNAMIC_ROUTE', 'EDIT_ELEMENT_LIMIT', 'EDIT_ELEMENT_NOT_FOUND', 'EDIT_FACTORY_REFERENCE_LIMIT',
  'EDIT_FILE_LIMIT', 'EDIT_FLOW_LAYOUT', 'EDIT_GENERATED_ROUTE_AMBIGUOUS', 'EDIT_GENERATED_SCOPE_REQUIRED',
  'EDIT_INHERITANCE_CYCLE', 'EDIT_INHERITANCE_INVALID', 'EDIT_INTERNAL_ERROR', 'EDIT_JSONC_SYNTAX',
  'EDIT_KEY_RENAME_INVALID', 'EDIT_MULTI_INSTANCE_OFFSET', 'EDIT_NAME_CONFLICT', 'EDIT_NODE_LIMIT',
  'EDIT_NUMBER_INVALID', 'EDIT_OFFSET_INVALID', 'EDIT_OPERATION_INVALID', 'EDIT_PARENT_INVALID',
  'EDIT_PATH_AMBIGUOUS', 'EDIT_PATH_INVALID', 'EDIT_POCKET_PREVIEW_FORBIDDEN', 'EDIT_POINTER_INVALID',
  'EDIT_POINTER_NOT_FOUND', 'EDIT_PREVIEW_INVALID', 'EDIT_PREVIEW_LIMIT', 'EDIT_PROJECTION_FAILED',
  'EDIT_PROJECTION_NODE_NOT_FOUND', 'EDIT_PROPERTY_INVALID', 'EDIT_RANGE_INVALID', 'EDIT_REFERENCE_AMBIGUOUS',
  'EDIT_REFERENCE_DYNAMIC', 'EDIT_REFERENCE_MISSING', 'EDIT_REFERENCE_SCAN_LIMIT', 'EDIT_REPROJECTION_LIMIT',
  'EDIT_REPROJECTION_MISMATCH', 'EDIT_REPROJECTION_SIDE_EFFECT', 'EDIT_REVISION_CONFLICT',
  'EDIT_ROOT_DELETE_FORBIDDEN', 'EDIT_ROUTE_LIMIT', 'EDIT_ROUTE_UNRESOLVED', 'EDIT_SCOPED_OPERATION_INVALID',
  'EDIT_SCOPE_INVALID', 'EDIT_SCREEN_AMBIGUOUS', 'EDIT_SCREEN_IS_SHARED', 'EDIT_SCREEN_REQUIRED',
  'EDIT_SCREEN_SHADOWED', 'EDIT_SELECTION_STALE', 'EDIT_SOURCE_NOT_FOUND', 'EDIT_TEXT_INVALID',
  'EDIT_TEXT_LIMIT', 'EDIT_UI_NAME_INVALID', 'EDIT_UI_PROPERTY_INVALID', 'EDIT_UI_STRUCTURE',
  'EDIT_VALIDATION_FAILED', 'EDIT_VALUE_INVALID', 'EDIT_VALUE_LIMIT', 'EDIT_WORKSPACE_LIMIT',
  'WORKSPACE_BATCH_INVALID', 'WORKSPACE_BATCH_LIMIT', 'WORKSPACE_BATCH_OPERATION_INVALID',
  'WORKSPACE_EDIT_HISTORY_LIMIT', 'WORKSPACE_FILE_AMBIGUOUS', 'WORKSPACE_FILE_DELETE_UNSUPPORTED',
  'WORKSPACE_FILE_LIMIT', 'WORKSPACE_FILE_NOT_FOUND', 'WORKSPACE_NOT_FOUND', 'WORKSPACE_OPERATION_UNSUPPORTED',
  'WORKSPACE_PATH_INVALID', 'WORKSPACE_REVISION_CONFLICT', 'WORKSPACE_SOURCE_NOT_FOUND', 'WORKSPACE_TEXT_LIMIT',
  'WORKSPACE_UI_REGISTRY_READ_ONLY',
]);
function definitiveMutationFailure(error) {
  const status = error?.status;
  if (status !== undefined && (!Number.isInteger(status) || status < 400 || status >= 500 || status === 408 || status === 499)) return false;
  const code = typeof error === 'string' ? error : error?.code || error?.message;
  return DEFINITIVE_EDIT_REJECTION_CODES.has(code);
}
function checked(result) {
  if (!result || result.ok === false) {
    const issue = readDiagnosticDataProperty(result, 'error');
    const textField = (value, key) => {
      const text = readDiagnosticDataProperty(value, key);
      return typeof text === 'string' ? text : undefined;
    };
    const diagnostics = readDiagnosticDataProperty(result, 'diagnostics');
    let diagnosticMessage;
    if (Array.isArray(diagnostics)) {
      for (let index = 0; index < Math.min(diagnostics.length, 2048); index += 1) {
        const item = readDiagnosticDataProperty(diagnostics, String(index));
        if (textField(item, 'severity') !== 'error') continue;
        diagnosticMessage = textField(item, 'message');
        break;
      }
    }
    fail(typeof issue === 'string' ? issue : textField(issue, 'code') || textField(result, 'code') || 'WORKSPACE_REQUEST_FAILED',
      (typeof issue === 'string' ? issue : textField(issue, 'message')) || diagnosticMessage || siteText('編集を適用できませんでした。'), issue);
  }
  return result;
}

/** HTTP アダプターを注入する。原文ドラフトと確定済み Node revision を分離する。 */
export function createWorkspaceEditor({ request, onChange = () => {}, onCommit = async () => {}, manualApply = true, resolvePreviewEditTargets }) {
  if (typeof request !== 'function') fail('WORKSPACE_ADAPTER_REQUIRED');
  const state = {
    mode: 'preview', workspaceId: null, revision: 0, sourceKey: '', busy: false,
    files: [], nodes: [], sources: [], activePath: '', activeSourceId: '', selectedPointer: '', selectionMemory: new Map(),
    documents: new Map(), drafts: new Map(), selections: [], previewSelection: null, error: '', message: '',
    deletePlan: null, exportPlan: null, addType: '', insertionRelation32:'inside', addGeneration32:0, addFlight32:null, addStatus32:null, deleteUnit32:'selected', lastStructureAttempt32:null, canUndo: false, canRedo: false, previewAllowed: true, projectionError: false,
    editScope: 'screen', editTargetMode: 'visual', editGeneratedTemplate: false, editTemplateConsentKey: '',
    editPlan: null, editPlanKey: '', editPlanBusy: false, editPlanError: '', lastEditPlan: null,
    lastHistoryAction: null,
    manualApply: manualApply !== false, pendingVersion: 0, pendingOperations: [], pendingRedoOperations: [], pendingBaseRevision: null, pendingCommitUncertain: false,
    pendingCommitError: '', pendingConflict: false, lastPendingCommit: null,
  };
  let epoch = 0;
  let readEpoch = 0;
  let selectionEpoch = 0;
  let abort = null;
  const notify = kind => onChange(state, kind);
  const editIntent = createWorkspaceEditIntent({ state, request, notify });
  function accept(result) {
    checked(result);
    if (result.revision !== undefined && result.revision !== state.revision) editIntent.invalidate();
    if (typeof result.revision === 'string' || Number.isSafeInteger(result.revision)) state.revision = result.revision;
    for (const key of ['workspaceId', 'files', 'nodes', 'sources', 'canUndo', 'canRedo', 'previewAllowed']) {
      if (hasOwn(result, key)) state[key] = result[key];
    }
    if (result.history) {
      state.canUndo = Number(result.history.undo ?? result.history.undoCount) > 0;
      state.canRedo = Number(result.history.redo ?? result.history.redoCount) > 0;
    }
  }
  async function run(action) {
    if (state.busy) fail('WORKSPACE_BUSY', siteText('処理中です。完了してから操作してください。'));
    const ownEpoch = epoch;
    state.busy = true; state.error = ''; notify('busy');
    abort = new AbortController();
    try { return await action(abort.signal, () => ownEpoch === epoch); }
    catch (error) {
      if (ownEpoch === epoch) { state.error = String(error.message || error); notify('error'); }
      throw error;
    } finally {
      if (ownEpoch === epoch) { state.busy = false; abort = null; notify('settled'); }
    }
  }
  async function status(signal, current) {
    const result = checked(await request('status', { workspaceId: state.workspaceId }, { signal }));
    if (!current()) fail('WORKSPACE_SUPERSEDED');
    accept(result);
    return result;
  }
  function defaultSourceForPath(path, requested) {
    if (requested !== undefined && requested !== null) return ['vanilla-reference', 'imported-pack'].includes(requested)
      ? workspaceRecordSourceId({ sourceId: requested }, state.sources) : String(requested);
    const candidates = state.files.filter(file => (file.physicalPath || file.path) === path);
    if (!candidates.length) return '';
    const highestKind = candidates.some(file => file.sourceKind === 'imported') ? 'imported' : candidates[0].sourceKind;
    const highest = candidates.filter(file => file.sourceKind === highestKind);
    if (highest.length !== 1) fail('WORKSPACE_SOURCE_AMBIGUOUS', siteText('同じパスを持つパックが複数あります。原文のパックを選択してください。'));
    return String(highest[0].sourceId || '');
  }
  async function readDocument(path, options = {}) {
    if (!state.workspaceId) fail('WORKSPACE_NOT_OPEN');
    const requestedSourceId = defaultSourceForPath(path, options.sourceId);
    const ownEpoch = epoch, ownRead = ++readEpoch, revision = state.revision;
    const ownSelection = options.selectionEpoch ?? ++selectionEpoch;
    const result = checked(await request('read', { workspaceId: state.workspaceId, path, ...(requestedSourceId ? { sourceId: requestedSourceId } : {}) }, options));
    if (ownEpoch !== epoch || revision !== state.revision || ownRead !== readEpoch || ownSelection !== selectionEpoch) fail('WORKSPACE_READ_SUPERSEDED');
    if (typeof result.text !== 'string') fail('WORKSPACE_DOCUMENT_INVALID');
    const sourceId = String(result.sourceId || requestedSourceId || '');
    if (requestedSourceId && sourceId !== requestedSourceId) fail('WORKSPACE_SOURCE_CHANGED', siteText('要求と異なるパックの原文が返されました。'));
    const key = workspaceDocumentKey(path, sourceId);
    state.documents.set(key, { ...result, path, sourceId });
    if (Array.isArray(result.nodes)) state.nodes = [...state.nodes.filter(node => !matchesWorkspaceDocument(node, path, sourceId)), ...result.nodes];
    if (!state.drafts.has(key)) state.drafts.set(key, { text: result.text, dirty: false, invalid: false, path, sourceId });
    if (state.selectedPointer) state.selectionMemory.set(workspaceDocumentKey(state.activePath, state.activeSourceId), state.selectedPointer);
    if (state.previewSelection && (state.previewSelection.path !== path || state.previewSelection.sourceId !== sourceId)) { state.previewSelection = null; editIntent.invalidate(); }
    state.activePath = path; state.activeSourceId = sourceId;
    const selected = state.selectionMemory.get(key) || '';
    state.selectedPointer = state.nodes.some(node => matchesWorkspaceDocument(node, path, sourceId) && node.pointer === selected) ? selected : '';
    notify('document');
    return result;
  }
  function activeFileExists() { return state.files.some(file => matchesWorkspaceDocument(file, state.activePath, state.activeSourceId)); }
  function blocked() { return state.busy || state.previewAllowed === false || state.projectionError || [...state.drafts.values()].some(draft => draft.dirty || draft.invalid); }
  async function commitOperation(operation, onAccepted = () => {}) {
    if (!state.workspaceId) fail('WORKSPACE_NOT_OPEN');
    if (isReadOnlyUiRegistry(operation.path)) fail('WORKSPACE_UI_REGISTRY_READ_ONLY', siteText(UI_REGISTRY_READ_ONLY_MESSAGE));
    if (operation.type !== 'replaceText' && [...state.drafts.values()].some(draft => draft.dirty)) fail('WORKSPACE_UNAPPLIED_DRAFT', siteText('先に原文の変更を適用するか取り消してください。'));
    const displayOperation = operation.type === 'batch' ? operation.operations.at(-1) : operation;
    const sourceId = defaultSourceForPath(displayOperation.path, displayOperation.sourceId ?? (displayOperation.path === state.activePath ? state.activeSourceId : undefined));
    if (operation.type !== 'batch') operation = { ...operation, ...(sourceId ? { sourceId } : {}) };
    const documentKey = workspaceDocumentKey(operation.path, sourceId);
    const previousTarget = state.nodes.find(node => matchesWorkspaceDocument(node, displayOperation.path, sourceId) && node.pointer === displayOperation.pointer);
    return run(async (signal, current) => {
      let result, definitiveFailure = false, receivedFailureReply = false;
      const previousProjectionError = state.projectionError;
      // POST の応答が失われた場合も、サーバーで確定済みかもしれない。再同期するまで旧描画を止める。
      state.projectionError = true;
      try {
        const reply = await request('edit', { workspaceId: state.workspaceId, expectedRevision: state.revision, operation }, { signal });
        if (!current()) fail('WORKSPACE_SUPERSEDED');
        if (reply?.ok === false) {
          receivedFailureReply = true;
          const issue = readDiagnosticDataProperty(reply, 'error');
          definitiveFailure = definitiveMutationFailure({ status: readDiagnosticDataProperty(reply, 'status') ?? readDiagnosticDataProperty(issue, 'status'),
            code: typeof issue === 'string' ? issue : readDiagnosticDataProperty(issue, 'code') || readDiagnosticDataProperty(reply, 'code') });
          if (definitiveFailure) state.projectionError = previousProjectionError;
        }
        if (operation.type === 'batch' && reply?.ok !== false && (!reply || reply.ok !== true || !(typeof reply.revision === 'string' && reply.revision || Number.isSafeInteger(reply.revision)))) fail('WORKSPACE_EDIT_RESPONSE_INVALID', siteText('反映結果の改訂番号を確認できません。再送せず再同期してください。'));
        result = checked(reply);
      }
      catch (error) {
        if (current() && !receivedFailureReply && definitiveMutationFailure(error)) { definitiveFailure = true; state.projectionError = previousProjectionError; }
        if (operation.type === 'batch' && !definitiveFailure && current()) {
          if (!error || typeof error !== 'object') error = new Error(String(error));
          error.workspaceMutationUncertain = true;
        }
        if (operation.type === 'replaceText') {
          const draft = state.drafts.get(documentKey);
          if (draft && current()) draft.invalid = true;
        }
        throw error;
      }
      if (!current()) fail('WORKSPACE_SUPERSEDED');
      accept(result);
      onAccepted(result);
      state.lastHistoryAction = null;
      const committed = await status(signal, current);
      // 確定対象以外の未適用ドラフトは保存し続ける。
      state.documents.clear();
      if (operation.type === 'replaceText') state.drafts.delete(documentKey);
      else for (const [path, draft] of state.drafts) if (!draft.dirty) state.drafts.delete(path);
      state.deletePlan = null; state.exportPlan = null;
      const structural31 = displayOperation.scope === 'screen' && ['add', 'delete'].includes(displayOperation.type);
      const operationPlan31 = result.editPlan?.type === 'batch' ? result.editPlan.operations?.at(-1)?.editPlan : result.editPlan;
      const committedTarget31 = structural31 ? operationPlan31?.committedTarget : null;
      const path = committedTarget31?.path || displayOperation.path || state.activePath;
      const readSource31 = committedTarget31?.sourceId || sourceId;
      if (path && state.files.some(file => matchesWorkspaceDocument(file, path, readSource31))) await readDocument(path, { signal, sourceId: readSource31 });
      if (displayOperation.type === 'inherit' && previousTarget) {
        const replacement = state.nodes.find(node => matchesWorkspaceDocument(node, path, sourceId) && node.parentPointer === previousTarget.parentPointer && node.localName === previousTarget.localName);
        if (replacement) state.selectedPointer = replacement.pointer;
      }
      if (displayOperation.type === 'add') {
        const added = state.nodes.find(node => matchesWorkspaceDocument(node, path, readSource31) && String(node.parentPointer || '') === String(committedTarget31?.pointer ?? displayOperation.parentPointer ?? '') && node.rawKey === displayOperation.name);
        if (added) state.selectedPointer = added.pointer;
      }
      // 個別化によって原文pointerが変わる。削除済みpointerを次の兄弟として再利用しない。
      state.lastStructureSelection31 = null;
      if (structural31 && committedTarget31) {
        if (displayOperation.type === 'delete') {
          let parent = committedTarget31.pointer;
          do { parent = parent.slice(0, parent.lastIndexOf('/')); }
          while (parent && !state.nodes.some(node => matchesWorkspaceDocument(node, path, readSource31) && node.pointer === parent));
          state.selectedPointer = parent;
        }
        if (state.selectedPointer) {
          state.selectionMemory.set(workspaceDocumentKey(path, readSource31), state.selectedPointer);
          state.lastStructureSelection31 = { path, sourceId: readSource31, pointer: state.selectedPointer, operation: displayOperation.type };
        }
      }
      if (state.previewSelection?.pointer !== state.selectedPointer) state.previewSelection = null;
      state.projectionError = true;
      await onCommit(committed, operation);
      // 再投影中にパックが置き換わった場合、新しい作業領域の停止状態を解除しない。
      if (!current()) fail('WORKSPACE_SUPERSEDED');
      state.projectionError = false;
      state.message = siteText`変更を適用しました（改訂 ${String(state.revision).slice(0, 12)}）。`;
      return result;
    });
  }
  function requireNoPending() {
    if (state.pendingCommitUncertain || state.pendingConflict) fail('WORKSPACE_UNAPPLIED_PENDING', siteText('前回の確定内容を確認する必要があります。「確定済みの内容を確認」を先に選んでください。'));
    if (pending.hasChanges()) fail('WORKSPACE_UNAPPLIED_PENDING', siteText('未確定の変更があります。「JSON UIに確定」または「未確定の変更を破棄」を選んでください。'));
  }
  const pending = createWorkspacePendingEdits({ state, notify, commit: commitOperation,
    normalizeOperation(operation) {
      if (typeof operation.path !== 'string' || !operation.path) fail('WORKSPACE_PENDING_PATH_REQUIRED');
      if (isReadOnlyUiRegistry(operation.path)) fail('WORKSPACE_UI_REGISTRY_READ_ONLY', siteText(UI_REGISTRY_READ_ONLY_MESSAGE));
      const sourceId = defaultSourceForPath(operation.path, operation.sourceId ?? (operation.path === state.activePath ? state.activeSourceId : undefined));
      return { ...operation, ...(sourceId ? { sourceId } : {}) };
    },
  });
  const api = {
    state,
    previewBlocked: blocked,
    setEditOptions: editIntent.setOptions,
    setEditGeneratedTemplate: editIntent.setGeneratedTemplate,
    planPreviewEdit: editIntent.plan,
    editPreviewProperty(property, value) { return (state.manualApply ? editIntent.enqueue : editIntent.apply)({ type: 'set', property, value }, api.edit); },
    movePreviewElement(delta) { return (state.manualApply ? editIntent.enqueue : editIntent.apply)({ type: 'move', delta }, api.edit); },
    /** ハンドル変形の位置補正とsizeを一つの取消単位で保存する。 */
    transformPreviewElement(changes) {
      if (!Array.isArray(changes) || !changes.length || changes.length > 2 || changes.some(change =>
        !(change?.type === 'move' || change?.type === 'set' && change.property === 'size'))) fail('WORKSPACE_RESIZE_INPUT_INVALID');
      return editIntent.enqueue(changes[0], async (_operation, { editPlan }) => {
        const operations = changes.map(change => workspacePreviewEditOperation(state, change));
        if (!state.manualApply) return commitOperation({ type: 'batch', pointerBasis: 'base-revision', operations });
        const targetIds = typeof resolvePreviewEditTargets === 'function' ? resolvePreviewEditTargets(state.previewSelection, editPlan) : [state.previewSelection?.nodeId];
        return pending.enqueue(operations, { label: siteText('サイズを変更'), previewNodeIds: operations.map(() => targetIds) });
      });
    },
    setMode(mode) {
      const next = mode === 'edit' ? 'edit' : 'preview';
      if (next !== state.mode) editIntent.invalidate();
      state.mode = next; state.addType = ''; state.addGeneration32=(state.addGeneration32||0)+1; notify('mode');
    },
    async ensure(sources, sourceKey) {
      if (state.workspaceId && state.sourceKey === sourceKey) return state;
      requireNoPending();
      if (!Array.isArray(sources) || !sources.length || sources.some(source => !source.id)) fail('WORKSPACE_NODE_REQUIRED', siteText('START.bat から起動し、パックを読み込んでください。'));
      return run(async (signal, current) => {
        if (state.workspaceId) {
          try { await request('close', { workspaceId: state.workspaceId }, { signal }); }
          catch (error) { if (!String(error.message || error).includes('WORKSPACE_NOT_FOUND')) throw error; }
          // reset 後の新しい作業領域を、旧 close の遅延応答で消さない。
          if (!current()) fail('WORKSPACE_SUPERSEDED');
          state.workspaceId = null;
        }
        const result = checked(await request('open', { sources }, { signal }));
        if (!current()) fail('WORKSPACE_SUPERSEDED');
        accept(result); state.sourceKey = sourceKey;
        state.documents.clear(); state.drafts.clear(); state.activePath = ''; state.activeSourceId = ''; state.selectedPointer = ''; state.selectionMemory.clear();
        state.selections = []; state.previewSelection = null; state.deletePlan = null; state.exportPlan = null; state.projectionError = false;
        pending.clear(); state.lastPendingCommit = null;
        state.lastEditPlan = null; state.lastHistoryAction = null; state.editScope = 'screen'; state.editTargetMode = 'visual'; editIntent.invalidate();
        return state;
      });
    },
    adoptSourceKey(key) { state.sourceKey = key; },
    readDocument,
    getDocument(path = state.activePath, sourceId = state.activeSourceId) { return state.documents.get(workspaceDocumentKey(path, sourceId)); },
    getDraft(path = state.activePath, sourceId = state.activeSourceId) { return state.drafts.get(workspaceDocumentKey(path, sourceId)); },
    selectPointer(pointer, path = state.activePath, sourceId = state.activeSourceId) {
      selectionEpoch++; readEpoch++;
      editIntent.invalidate();
      state.activePath = path; state.activeSourceId = String(sourceId || ''); state.selectedPointer = String(pointer || '');
      state.previewSelection = null;
      state.selectionMemory.set(workspaceDocumentKey(path, sourceId), state.selectedPointer); state.deletePlan = null; notify('selection');
    },
    async selectPreviewTarget(target, previewSelection = {}) {
      if (!target?.path || !target.pointer) fail('WORKSPACE_PREVIEW_SOURCE_REQUIRED');
      const ownSelection = ++selectionEpoch; readEpoch++;
      const previousSelection = state.previewSelection;
      const sourceId = String(target.sourceId || '');
      if (!api.getDocument(target.path, sourceId) || state.activePath !== target.path || state.activeSourceId !== sourceId) {
        await readDocument(target.path, { sourceId, selectionEpoch: ownSelection });
      }
      if (ownSelection !== selectionEpoch) fail('WORKSPACE_SELECTION_SUPERSEDED');
      const node = state.nodes.find(row => matchesWorkspaceDocument(row, target.path, sourceId) && row.pointer === target.pointer);
      if (!node) fail('WORKSPACE_PREVIEW_SOURCE_STALE', siteText('選択した要素の原文が更新されました。プレビューを再計算してください。'));
      state.activePath = target.path; state.activeSourceId = sourceId; state.selectedPointer = node.pointer;
      state.previewSelection = { ...target, ...previewSelection, path: target.path, sourceId, pointer: node.pointer };
      if (workspaceEditSelectionIdentity(previousSelection) !== workspaceEditSelectionIdentity(state.previewSelection)) editIntent.invalidate();
      state.selectionMemory.set(workspaceDocumentKey(target.path, sourceId), node.pointer); state.deletePlan = null;
      state.error = ''; notify('selection');
      return node;
    },
    setDraft(path, text, sourceId = state.activeSourceId) {
      requireNoPending();
      if (state.busy) fail('WORKSPACE_BUSY');
      if (isReadOnlyUiRegistry(path)) fail('WORKSPACE_UI_REGISTRY_READ_ONLY', siteText(UI_REGISTRY_READ_ONLY_MESSAGE));
      if (typeof text !== 'string' || text.length > MAX_DRAFT_CHARS) fail('WORKSPACE_TEXT_LIMIT', siteText('原文は8 Mi文字以下にしてください。'));
      const key = workspaceDocumentKey(path, sourceId);
      const original = state.documents.get(key)?.text;
      if (typeof original !== 'string') fail('WORKSPACE_DOCUMENT_NOT_READ');
      state.drafts.set(key, { text, dirty: text !== original, invalid: false, path, sourceId });
      editIntent.invalidate();
      state.error = ''; state.deletePlan = null; state.exportPlan = null; notify('draft');
    },
    discardDraft(path = state.activePath, sourceId = state.activeSourceId) {
      const key = workspaceDocumentKey(path, sourceId);
      const original = state.documents.get(key)?.text;
      if (typeof original !== 'string') return;
      state.drafts.set(key, { text: original, dirty: false, invalid: false, path, sourceId }); state.error = ''; notify('discard');
    },
    async edit(operation, { editPlan } = {}) {
      if (!state.manualApply) return commitOperation(operation);
      let previewNodeIds;
      if (editPlan && typeof resolvePreviewEditTargets === 'function') {
        const targets = resolvePreviewEditTargets(state.previewSelection, editPlan);
        if (!Array.isArray(targets) || !targets.length || targets.some(id => typeof id !== 'string' || !id)) {
          fail('WORKSPACE_PREVIEW_TARGET_UNRESOLVED', siteText('変更先をプレビューへ対応付けできません。要素を選び直し、変更先を再確認してください。'));
        }
        previewNodeIds = [[...new Set(targets)]];
      }
      return pending.enqueue([operation], previewNodeIds ? { previewNodeIds } : {});
    },
    queueOperations(operations, options) { return pending.enqueue(operations, options); },
    async applyPending() {
      const operation=state.pendingOperations.find(entry=>['add','delete'].includes(entry.operation?.type));
      const result=await pending.apply();
      if(result?.ok && operation)state.lastStructureAttempt32={type:operation.operation.type,status:'committed',operationId:operation.operation.operationId||null};
      return result;
    },
    discardPending() { return pending.discard(); },
    undoPending() { return pending.undo(); },
    redoPending() { return pending.redo(); },
    hasPendingEdits: () => pending.hasChanges(),
    get pendingCount() { return state.pendingOperations.length; },
    get canUndoPending() { return state.pendingOperations.length > 0 && !state.pendingCommitUncertain && !state.busy; },
    get canRedoPending() { return state.pendingRedoOperations.length > 0 && !state.pendingCommitUncertain && !state.busy; },
    pendingNodeTransforms: fileId => pending.transforms(fileId),
    pendingCompiledOperations: () => pending.compiledOperations(),
    pendingAdditions: fileId => pending.additions(fileId),
    editPendingAddition: (id, change) => pending.editAddition(id, change),
    applyDraft(path = state.activePath, sourceId = state.activeSourceId) {
      requireNoPending();
      const draft = state.drafts.get(workspaceDocumentKey(path, sourceId));
      if (!draft) fail('WORKSPACE_DOCUMENT_NOT_READ');
      return commitOperation({ type: 'replaceText', path, text: draft.text, ...(sourceId ? { sourceId } : {}) });
    },
    async history(direction) {
      if (!['undo', 'redo'].includes(direction)) fail('WORKSPACE_HISTORY_INVALID');
      if (direction === 'undo' && pending.hasChanges()) return pending.undo();
      if (direction === 'redo' && state.pendingRedoOperations.length) return pending.redo();
      requireNoPending();
      if (state.pendingRedoOperations.length) fail('WORKSPACE_PENDING_HISTORY_REQUIRED', siteText('未反映のやり直し履歴を取り消してから確定履歴を操作してください。')); 
      if ([...state.drafts.values()].some(draft => draft.dirty)) fail('WORKSPACE_UNAPPLIED_DRAFT', siteText('原文の未適用変更を取り消してから履歴を操作してください。'));
      const selectedBefore = state.nodes.find(node => matchesWorkspaceDocument(node, state.activePath, state.activeSourceId) && node.pointer === state.selectedPointer);
      const previewSelectionBefore = state.previewSelection;
      return run(async (signal, current) => {
        state.projectionError = true;
        const result = checked(await request(direction, { workspaceId: state.workspaceId, expectedRevision: state.revision }, { signal }));
        if (!current()) fail('WORKSPACE_SUPERSEDED');
        accept(result);
        state.lastHistoryAction = result.historyAction || null;
        const restoredIntent = result.historyAction?.editPlan;
        if (restoredIntent && ['screen', 'shared'].includes(restoredIntent.scope) && ['interaction', 'visual'].includes(restoredIntent.targetMode)) {
          state.editScope = restoredIntent.scope; state.editTargetMode = restoredIntent.targetMode;
          editIntent.invalidate(); state.propertyInputs?.clear();
        }
        const committed = await status(signal, current);
        state.documents.clear(); state.drafts.clear(); state.deletePlan = null; state.exportPlan = null;
        if (state.activePath && activeFileExists()) await readDocument(state.activePath, { signal, sourceId: state.activeSourceId });
        state.projectionError = true;
        await onCommit(committed, { type: direction, historyAction: result.historyAction, previewSelectionBefore });
        if (!current()) fail('WORKSPACE_SUPERSEDED');
        if (!state.selectedPointer && selectedBefore) {
          const replacement = state.nodes.find(node => matchesWorkspaceDocument(node, state.activePath, state.activeSourceId) && node.localName === selectedBefore.localName && node.parentPointer === selectedBefore.parentPointer);
          if (replacement) state.selectedPointer = replacement.pointer;
        }
        if (state.previewSelection?.pointer !== state.selectedPointer) state.previewSelection = null;
        state.projectionError = false;
        state.message = direction === 'undo' ? siteText('直前の変更を元に戻しました。') : siteText('変更をやり直しました。');
        return result;
      });
    },
    async prepareStructure31(change, options = {}) {
      if (state.pendingCommitUncertain || state.pendingConflict || pending.compiledOperations().some(isStructuralWorkspaceOperation)) requireNoPending();
      if (blocked()) fail('WORKSPACE_UNAPPLIED_DRAFT');
      const operation=screenStructureOperation31(state,change,options.targetSelection), identity=structureIdentity31(state);
      try {
        const prepared=await run(async(signal,current)=>{
          const result=checked(await request('edit',{workspaceId:state.workspaceId,expectedRevision:state.revision,
            operation:{...operation,type:change.type==='delete'?'planDelete':'planEdit',intendedType:change.type}}, {signal}));
          if(!current()||structureIdentity31(state)!==identity||options.isCurrent?.()===false)fail('WORKSPACE_SELECTION_SUPERSEDED');
          return {operation,result,identity,previewSelection:{...(options.targetSelection||state.previewSelection)}};
        });
        state.lastStructureAttempt32={type:change.type,status:'planned',operationId:change.operationId||null};
        return prepared;
      } catch(error) {
        if(structureIdentity31(state)===identity)state.lastStructureAttempt32={type:change.type,status:'rejected',code:error.code||'WORKSPACE_REQUEST_FAILED',
          message:String(error.message||error).slice(0,1024),reference:error.referenceInfo32?.[0]||null,operationId:change.operationId||null};
        throw error;
      }
    },
    async addScreenElement31(change, options = {}) {
      const prepared=await api.prepareStructure31({...change,type:'add'},options);
      if(structureIdentity31(state)!==prepared.identity||options.isCurrent?.()===false)fail('WORKSPACE_SELECTION_SUPERSEDED');
      const result=state.manualApply ? pending.enqueue([prepared.operation],{previewSelections:[prepared.previewSelection]})
        : await commitOperation(prepared.operation);
      state.lastStructureAttempt32={type:'add',status:state.manualApply?'queued':'committed',operationId:change.operationId||null};
      return result;
    },
    async planScreenDelete31() {
      const prepared=await api.prepareStructure31({type:'delete',cascade:true,deletionUnit:state.deleteUnit32||'selected'});
      if(structureIdentity31(state)!==prepared.identity)fail('WORKSPACE_SELECTION_SUPERSEDED');
      state.deletePlan={result:prepared.result,path:prepared.operation.path,pointer:prepared.operation.pointer,
        sourceId:prepared.operation.sourceId,revision:state.revision,operation:prepared.operation,identity31:prepared.identity};
      notify('delete-plan'); return prepared.result;
    },
    async planDelete(path = state.activePath, pointer = state.selectedPointer, sourceId = state.activeSourceId) {
      if (isReadOnlyUiRegistry(path)) fail('WORKSPACE_UI_REGISTRY_READ_ONLY', siteText(UI_REGISTRY_READ_ONLY_MESSAGE));
      if (blocked()) fail('WORKSPACE_UNAPPLIED_DRAFT');
      return run(async (signal, current) => {
        const result = checked(await request('edit', { workspaceId: state.workspaceId, expectedRevision: state.revision, operation: { type: 'planDelete', path, pointer, cascade: true, ...(sourceId ? { sourceId } : {}) } }, { signal }));
        if (!current()) fail('WORKSPACE_SUPERSEDED');
        state.deletePlan = { result, path, pointer, sourceId, revision: state.revision }; return result;
      });
    },
    async confirmDelete() {
      const plan = state.deletePlan;
      if (!plan || plan.revision !== state.revision) fail('WORKSPACE_DELETE_PLAN_STALE');
      if(plan.operation) {
        if(structureIdentity31(state)!==plan.identity31)fail('WORKSPACE_DELETE_PLAN_STALE');
        const result=await api.edit(plan.operation, { editPlan: plan.result?.editPlan });
        state.lastStructureAttempt32={type:'delete',status:state.manualApply?'queued':'committed'};
        return result;
      }
      return api.edit({ type: 'delete', path: plan.path, pointer: plan.pointer, sourceId: plan.sourceId, cascade: true });
    },
    selectExport(selection) {
      if (!selection?.filePath) fail('WORKSPACE_SELECTION_INVALID');
      if (!state.selections.some(row => row.filePath === selection.filePath && row.rawKey === selection.rawKey && String(row.sourceId || '') === String(selection.sourceId || ''))) state.selections.push({ ...selection });
      state.exportPlan = null; notify('export-selection');
    },
    removeExport(index) { state.selections.splice(index, 1); state.exportPlan = null; notify('export-selection'); },
    async export(mode = 'plan', options = {}) {
      requireNoPending();
      if (!['plan', 'zip'].includes(mode) || !state.selections.length) fail('WORKSPACE_EXPORT_SELECTION_REQUIRED', siteText('書き出すUIを追加してください。'));
      if (blocked()) fail('WORKSPACE_UNAPPLIED_DRAFT', siteText('未適用の原文があります。修正を適用するか取り消してください。'));
      return run(async (signal, current) => {
        let result;
        state.exportPlan = null;
        try {
          result = await request('export', { workspaceId: state.workspaceId, expectedRevision: state.revision, selections: state.selections, mode,
            packOptions: options.packOptions, iconPngBase64: options.iconPngBase64 }, { signal, blob: mode === 'zip' });
        } catch (error) {
          if (!current()) fail('WORKSPACE_SUPERSEDED');
          if (workspaceExportPlan(error?.exportResult)) state.exportPlan = error.exportResult;
          throw error;
        }
        if (!current()) fail('WORKSPACE_SUPERSEDED');
        if (mode === 'plan') {
          state.exportPlan = workspaceExportPlan(result) ? result : null;
          if (!workspaceExportPlan(result) || result?.ok === false || workspaceExportPlan(result)?.ok === false) throw workspaceExportError(result);
          checked(result);
        }
        return result;
      });
    },
    async refresh() {
      return run(async (signal, current) => {
        state.projectionError = true;
        const committed = await status(signal, current);
        state.documents.clear();
        for (const [path, draft] of state.drafts) if (!draft.dirty) state.drafts.delete(path);
        if (state.activePath && activeFileExists()) await readDocument(state.activePath, { signal, sourceId: state.activeSourceId });
        await onCommit(committed, { type: 'refresh' });
        if (!current()) fail('WORKSPACE_SUPERSEDED');
        state.projectionError = false;
      });
    },
    cancel() { abort?.abort(); },
    reset({ discardPending = false } = {}) {
      if (!discardPending) requireNoPending();
      epoch++; readEpoch++; selectionEpoch++; abort?.abort(); abort = null;
      pending.clear(); state.lastPendingCommit = null;
      state.addGeneration32=(state.addGeneration32||0)+1;state.addFlight32=null;state.addStatus32=null;state.lastStructureAttempt32=null;
      editIntent.invalidate();
      Object.assign(state, { workspaceId: null, revision: 0, sourceKey: '', busy: false, activePath: '', activeSourceId: '', selectedPointer: '', files: [], nodes: [], sources: [], selections: [], previewSelection: null, error: '', message: '', deletePlan: null, exportPlan: null, addType: '', canUndo: false, canRedo: false, previewAllowed: true, projectionError: false });
      state.lastEditPlan = null; state.lastHistoryAction = null; state.editScope = 'screen'; state.editTargetMode = 'visual';
      state.documents.clear(); state.drafts.clear(); state.selectionMemory.clear(); state.propertyInputs?.clear(); notify('reset');
    },
  };
  return api;
}

/** 検証結果だけの file レコード差替えは、編集中モデルの差替えとは区別する。 */
export function sameWorkspacePreviewModel(left, right) {
  return Boolean(left && right && left.id === right.id && left.uiModel === right.uiModel
    && left.nodesById === right.nodesById);
}

/** ポインターを保持する Canvas を、無関係な完了通知で交換しない。 */
export function shouldDeferWorkspaceCanvasRender({ mode, blocked, file, interaction }) {
  const owner = interaction?.sourceFile || interaction?.pendingAdditionDrag23?.file;
  return mode === 'edit' && !blocked && interaction?.active === true
    && Boolean(owner) && sameWorkspacePreviewModel(file, owner);
}

/** 同じ JSON 内の別 UI に切替えた際も、その UI の原文要素を選択する。 */
export function workspacePreviewDefinitionIdentity(file) {
  const definition = file?.meta?.selectedDefinition;
  if (!definition || typeof definition !== 'object') return null;
  return JSON.stringify([definition.recordId || null, definition.qualifiedName || definition.definition || null,
    definition.sourceId || null, definition.sourceKind || null]);
}
export function keepWorkspacePreviewSourceSelection(state, file) {
  const selected = state.previewSelection;
  return Boolean(selected?.fileId === file?.id && selected?.nodeId && file?.nodesById?.[selected.nodeId]
    && selected.previewDefinitionId && selected.previewDefinitionId === workspacePreviewDefinitionIdentity(file)
    && selected.pointer === state.selectedPointer
    && matchesWorkspaceDocument(selected, state.activePath, state.activeSourceId));
}
export function selectWorkspacePreviewDefinition(controller, file, sourceId) {
  const state = controller.state;
  // 継承元へ原文を切り替えても、表示中の UI を開き直す通知で選択を奪わない。
  if (keepWorkspacePreviewSourceSelection(state, file)) return null;
  const definition = file?.meta?.selectedDefinition;
  const root = state.nodes.find(node => matchesWorkspaceDocument(node, file?.path, sourceId)
    && node.isDefinition && node.localName === definition?.definition);
  if (!root) return null;
  const pointer = state.selectedPointer;
  if (state.activePath !== file.path || state.activeSourceId !== sourceId
    || !(pointer === root.pointer || pointer?.startsWith(`${root.pointer}/`))) {
    controller.selectPointer(root.pointer, file.path, sourceId);
  }
  return root;
}

// model と原文索引が同じ間だけ共有する対応表。選択ごとの全ツリー再探索を避ける。
const authoredPreviewNodeCache = new WeakMap();
/** resolver が発行した実効 JSON pointer を model の ID に対応させる。配列の添字は実効文書内にのみ使う。 */
export function buildWorkspacePreviewSourceMap(file) {
  const sources = file?.meta?.resolution?.nodeSources;
  const root = file?.uiModel?.root;
  const mapping = new Map();
  if (!sources || typeof sources !== 'object' || !root) return mapping;
  const queue = (root.children || []).map(node => ({ node, pointer: `/${escapeSourcePointer(node.key?.raw)}` }));
  for (let index = 0; index < queue.length; index++) {
    const { node, pointer } = queue[index];
    const source = sources[pointer];
    if (source?.path && typeof source.pointer === 'string') mapping.set(node.id, { ...source, previewPointer: pointer });
    const body = node.origin?.kind === 'named' ? node.origin.raw?.[node.key?.raw] : node.origin?.raw;
    for (const child of node.children || []) {
      let childPointer;
      if (Array.isArray(body?.controls)) {
        if (!Number.isSafeInteger(child.origin?.index)) continue;
        childPointer = `${pointer}/controls/${child.origin.index}`;
        if (child.origin.kind === 'named') childPointer += `/${escapeSourcePointer(child.key?.raw)}`;
      } else if (body?.controls && typeof body.controls === 'object') childPointer = `${pointer}/controls/${escapeSourcePointer(child.key?.raw)}`;
      else continue;
      queue.push({ node: child, pointer: childPointer });
    }
  }
  return mapping;
}
/** 保守的な JSON pointer 対応。解決結果の配列番号を原文に流用しない。 */
export function findAuthoredNodeForPreview({ file, nodeId, nodes, sourceId = '', sources = [] }) {
  const model = file?.uiModel;
  if (!model?.root || !nodeId || nodeId === model.root.id) return null;
  let cached = authoredPreviewNodeCache.get(model);
  if (!cached || cached.nodes !== nodes || cached.path !== file.path || cached.sourceId !== sourceId) {
    const provenance = file?.meta?.resolution?.nodeSources;
    if (provenance && typeof provenance === 'object') {
      const mapping = buildWorkspacePreviewSourceMap(file);
      const authored = new Map((nodes || []).map(node => [JSON.stringify([node.sourceId || '', node.physicalPath || node.path, node.pointer]), node]));
      for (const [id, source] of mapping) {
        const resolvedSourceId = sources.length ? workspaceRecordSourceId(source, sources) : String(source.sourceId || '');
        const row = authored.get(JSON.stringify([resolvedSourceId, source.path, source.pointer]));
        mapping.set(id, { ...row, ...source, sourceId: resolvedSourceId, rawKey: row?.rawKey || source.rawKey, props: row?.props });
      }
      cached = { nodes, path: file.path, sourceId, mapping };
      authoredPreviewNodeCache.set(model, cached);
      return mapping.get(nodeId) || null;
    }
    const byParent = new Map();
    for (const node of nodes || []) {
      if (!matchesWorkspaceDocument(node, file.path, sourceId)) continue;
      const parent = String(node.parentPointer || '');
      if (!byParent.has(parent)) byParent.set(parent, new Map());
      const siblings = byParent.get(parent), name = localName(node.rawKey || node.name || node.localName || node.key);
      // 同名候補が複数なら解決モデル側の順序や描画座標で推測しない。
      siblings.set(name, siblings.has(name) ? null : node);
    }
    const mapping = new Map();
    const queue = (model.root.children || []).map(node => ({ node, parent: '' }));
    for (let index = 0; index < queue.length; index++) {
      const { node, parent } = queue[index];
      const name = node.key?.local_name || localName(node.key?.raw);
      const match = byParent.get(parent)?.get(name);
      if (!match) continue;
      mapping.set(node.id, match);
      for (const child of node.children || []) queue.push({ node: child, parent: match.pointer });
    }
    cached = { nodes, path: file.path, sourceId, mapping };
    authoredPreviewNodeCache.set(model, cached);
  }
  return cached.mapping.get(nodeId) || null;
}

/** 相対率と anchor を保持した delta 変換。式やレイアウト依存配置は拒否する。 */
export function offsetAfterAuthoredMove({ value, effectiveProps = {}, frameProps = {}, parentType, dx, dy }) {
  if (!value || typeof value !== 'object' || !Number.isFinite(dx) || !Number.isFinite(dy)) fail('WORKSPACE_MOVE_INVALID');
  if (['stack_panel', 'grid'].includes(parentType) || hasOwn(value, 'grid_position')) fail('WORKSPACE_FLOW_LAYOUT', siteText('stack_panel・grid による自動配置はドラッグできません。配置を原文で編集してください。'));
  const offset = hasOwn(value, 'offset') ? value.offset : effectiveProps.offset ?? [0, 0];
  if (!Array.isArray(offset) || offset.length !== 2) fail('WORKSPACE_DYNAMIC_OFFSET', siteText('動的な offset はドラッグできません。原文で設定してください。'));
  const bindings = [...(Array.isArray(value.bindings) ? value.bindings : []), ...(Array.isArray(effectiveProps.bindings) ? effectiveProps.bindings : [])];
  if (bindings.some(binding => /(?:offset|anchor|position|size|^#?[xy]$)/iu.test(String(binding?.target_property_name || binding?.binding_name_override || binding?.binding_name || '')))) fail('WORKSPACE_DYNAMIC_OFFSET', siteText('binding が位置・サイズを変更するためドラッグできません。'));
  if ([value.anims, effectiveProps.anims].some(anims => Array.isArray(anims) ? anims.length : typeof anims === 'string' && anims.length)) fail('WORKSPACE_ANIMATED_POSITION', siteText('アニメーション指定のある要素は、原文で位置を編集してください。'));
  for (const key of ['offset', 'anchor_from', 'anchor_to']) {
    if (hasOwn(frameProps, key) && hasOwn(effectiveProps, key) && JSON.stringify(frameProps[key]) !== JSON.stringify(effectiveProps[key])) fail('WORKSPACE_DYNAMIC_OFFSET', siteText('実行時の値が位置を変更しています。原文または状態データを編集してください。'));
  }
  return offset.map((component, index) => {
    const delta = index === 0 ? dx : dy;
    const round = number => {
      const result = Math.round(number * 1000) / 1000;
      if (!Number.isFinite(result)) fail('WORKSPACE_MOVE_INVALID', siteText('移動後のoffsetが有限な数値を超えるため保存できません。'));
      return result;
    };
    if (typeof component === 'number' && Number.isFinite(component)) return round(component + delta);
    if (typeof component !== 'string') fail('WORKSPACE_DYNAMIC_OFFSET', siteText('offset の指定をドラッグで安全に変換できません。'));
    const text = component.trim();
    if (isUnitlessDimensionNumber(text)) {
      const numeric = round(Number(text) + delta);
      if (!Number.isFinite(numeric)) fail('WORKSPACE_MOVE_INVALID', siteText('offset の数値を有限な移動位置へ変換できません。'));
      return numeric;
    }
    const absolutePixels = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/u.exec(text);
    if (absolutePixels) {
      const result = round(Number(absolutePixels[1]) + delta);
      if (/[eE]/u.test(String(result))) fail('WORKSPACE_MOVE_INVALID', siteText('移動後のpx値を通常の10進表記で安全に保存できません。'));
      return `${result}px`;
    }
    const relative = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)%[cxy]?)(?:\s*([+-])\s*(\d+(?:\.\d*)?|\.\d+)(?:px)?)?$/u.exec(text);
    if (!relative) fail('WORKSPACE_DYNAMIC_OFFSET', siteText`動的な offset (${text.slice(0, 80)}) はドラッグできません。`);
    if (!Number.isFinite(parseFloat(relative[1]))) fail('WORKSPACE_MOVE_INVALID', siteText('offsetの割合が有限な数値を超えています。'));
    const pixels = round((relative[3] ? Number(relative[3]) * (relative[2] === '-' ? -1 : 1) : 0) + delta);
    if (/[eE]/u.test(String(pixels))) fail('WORKSPACE_MOVE_INVALID', siteText('移動後のpx値を通常の10進表記で安全に保存できません。'));
    return pixels ? `${relative[1]} ${pixels < 0 ? '-' : '+'} ${Math.abs(pixels)}px` : relative[1];
  });
}

/** 副作用は明示的な UI 操作のコールバック内に限定する。 */
export function renderWorkspaceSourceEditor(h, { controller, onSelectNode, onError, renderPicker, previewProperties = null }) {
  const state = controller.state;
  const invoke = action => Promise.resolve().then(action).catch(error => onError?.(error));
  const path = state.activePath, sourceId = state.activeSourceId || '';
  const registryReadOnly = isReadOnlyUiRegistry(path);
  const rawEditingAllowed = state.editScope !== 'screen';
  const scopedDeleteAllowed31=state.editScope==='screen' && typeof controller.planScreenDelete31==='function' && Boolean(state.previewSelection?.screen) && !state.pendingOperations?.length;
  const key = workspaceDocumentKey(path, sourceId);
  const draft = state.drafts.get(key);
  const node = state.nodes.find(row => matchesWorkspaceDocument(row, path, sourceId) && row.pointer === state.selectedPointer);
  const disabled = state.busy;
  const files = state.files.map(file => ({ value: workspaceDocumentKey(file.path, file.sourceId), label: `${state.drafts.get(workspaceDocumentKey(file.path, file.sourceId))?.dirty ? siteText('● 未適用 · ') : ''}${file.sourceKind === 'vanilla' ? siteText('バニラ') : file.sourceKind === 'imported' ? siteText('通常パック') : siteText('原文')} · ${file.path}` }));
  const source = h('textarea', {
    id: 'workspace-source-text', class: 'workspace-source-text', spellcheck: 'false', autocomplete: 'off',
    'aria-label': siteText('JSON UI の原文（コメント対応）'), value: draft?.text || '', disabled: disabled || !draft,
    readonly: registryReadOnly || !rawEditingAllowed ? 'readonly' : null, 'aria-readonly': String(registryReadOnly || !rawEditingAllowed),
    onInput: event => { if (registryReadOnly || !rawEditingAllowed) return; try { controller.setDraft(path, event.currentTarget.value, sourceId); } catch (error) { onError?.(error); } },
    onKeydown: event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); event.stopPropagation?.(); if (!event.isComposing && !registryReadOnly && rawEditingAllowed) void invoke(() => controller.applyDraft(path, sourceId));
      }
    },
  });
  const sourceDetails = h('details', { class: 'workspace-source-section', open: Boolean(draft?.dirty || draft?.invalid || state.sourceDetailsOpen), onToggle: event => { if (event.currentTarget.isConnected) state.sourceDetailsOpen = event.currentTarget.open; } }, [
    h('summary', {}, [siteText('JSON を直接編集')]),
    h('p', { class: 'workspace-scope-notice' }, [siteText('JSON の直接編集はこの原文自体を変更し、継承先にも反映されます。利用する場合は「共有元を編集」に切り替えてください。')]),
    h('p', { class: 'hint' }, [registryReadOnly ? siteText(UI_REGISTRY_READ_ONLY_MESSAGE) : siteText('原文を変更したら「検証して反映」。不正な原文は保持し、修正が完了するまでプレビューを停止します。Ctrl＋S でも適用できます。')]),
    source,
    h('div', { class: 'workspace-editor-actions' }, [
      h('button', { type: 'button', class: 'btn btn-primary', disabled: disabled || !draft || registryReadOnly || !rawEditingAllowed, onClick: () => void invoke(() => controller.applyDraft(path, sourceId)) }, [siteText('検証して反映')]),
      h('button', { type: 'button', class: 'btn', disabled: disabled || !draft, onClick: () => controller.discardDraft(path, sourceId) }, [siteText('未適用の変更を取り消す')]),
    ]),
  ]);
  const properties = { ...(previewProperties || {}), ...(node?.props || node?.value || {}) };
  const geometryNames = new Set(['offset', 'size', 'min_size', 'max_size', 'anchor_from', 'anchor_to']);
  const geometryPlanReady = !controller.planPreviewEdit || Boolean(state.editPlan && state.editPlan.targetMode === state.editTargetMode);
  if (geometryPlanReady && state.editPlan?.target?.props) {
    for (const name of geometryNames) delete properties[name];
    for (const name of geometryNames) if (Object.hasOwn(state.editPlan.target.props, name)) properties[name] = state.editPlan.target.props[name];
  }
  const propertyText = name => Object.hasOwn(properties, name) ? JSON.stringify(properties[name], null, 2)
    : controller.planPreviewEdit && geometryNames.has(name) ? '' : JSON.stringify(name === 'size' ? [100, 40] : null, null, 2);
  const propertyInputs = state.propertyInputs ||= new Map();
  const propertyKey = `${state.revision}:${key}:${node?.pointer || ''}`;
  if (!propertyInputs.has(propertyKey)) {
    if (propertyInputs.size >= 64) propertyInputs.delete(propertyInputs.keys().next().value);
    propertyInputs.set(propertyKey, { name: 'size', text: geometryPlanReady ? propertyText('size') : '', customName: '', baseRef: node?.baseRef || '', dirty: false, targetKey: '' });
  }
  const propertyInput = propertyInputs.get(propertyKey);
  let propertyName = propertyInput.name;
  const geometryTargetKey = JSON.stringify([state.editScope, state.editTargetMode, state.editPlan?.target || null]);
  if (geometryNames.has(propertyName) && geometryPlanReady && !propertyInput.dirty && propertyInput.targetKey !== geometryTargetKey) {
    propertyInput.text = propertyText(propertyName);
    propertyInput.targetKey = geometryTargetKey;
  }
  const propertyValue = h('textarea', { id: 'workspace-property-value', class: 'workspace-property-value', spellcheck: 'false', 'aria-label': siteText('属性の JSON 値'), value: propertyInput.text, maxlength: '131072', onInput: event => { propertyInput.text = event.currentTarget.value; propertyInput.dirty = true; }, disabled: disabled || !node || (geometryNames.has(propertyName) && !geometryPlanReady) });
  const propertyNames = [['type',siteText('種類')],['size',siteText('サイズ')],['offset',siteText('位置のずれ')],['anchor_from',siteText('親の基準位置')],['anchor_to',siteText('要素の基準位置')],['texture',siteText('テクスチャ')],['text',siteText('文字')],['color',siteText('文字の色')],['alpha',siteText('不透明度')],['visible',siteText('表示条件')],['layer',siteText('重なり順')],['bindings',siteText('データ連携')],['button_mappings',siteText('ボタンの動作')],['controls',siteText('子要素')],['custom',siteText('その他の属性')]];
  const custom = h('input', { class: 'workspace-property-name', type: 'text', hidden: propertyName !== 'custom', value: propertyInput.customName, onInput: event => { propertyInput.customName = event.currentTarget.value; }, placeholder: siteText('属性名'), 'aria-label': siteText('その他の属性名') });
  const propertySelect = h('select', { id: 'workspace-property-name', value: propertyName, disabled: disabled || !node, 'aria-label': siteText('変更する属性'), onChange: event => {
    propertyName = event.currentTarget.value; propertyInput.name = propertyName;
    custom.hidden = propertyName !== 'custom';
    propertyValue.value = propertyText(propertyName); propertyInput.text = propertyValue.value; propertyInput.dirty = false;
    if (state.previewSelection?.screen && controller.planPreviewEdit && propertyName !== 'custom') void invoke(() => controller.planPreviewEdit({ type: 'set', property: propertyName }));
  } }, propertyNames.filter(([value]) => value !== 'controls' || !controller.editPreviewProperty).map(([value, label]) => h('option', { value }, [`${label} (${value})`])));
  const inheritance = h('input', { id: 'workspace-inheritance', type: 'text', value: propertyInput.baseRef, onInput: event => { propertyInput.baseRef = event.currentTarget.value; }, placeholder: 'common.button', 'aria-label': siteText('継承元の定義'), disabled: disabled || !node });
  const nodes = state.nodes.filter(row => matchesWorkspaceDocument(row, path, sourceId)).map(row => ({ value: row.pointer, label: `${row.isDefinition ? siteText('定義') : siteText('要素')} · ${row.rawKey} · ${row.pointer}` }));
  const deletePlan = state.deletePlan?.result?.deletePlan || state.deletePlan?.result;
  return h('div', { class: 'workspace-source-editor' }, [
    h('h3', {}, [siteText('原文と要素の編集')]),
    h('p', { class: 'hint' }, [siteText('プレビューで要素を選択してドラッグできます。継承された要素も対応する原文を自動で開きます。同名ファイルはパック別に管理し、元のZIPは変更しません。')]),
    state.previewSelection ? h('div', { class: 'workspace-selection-source', role: 'status' }, [
      h('strong', {}, [siteText('編集対象の原文')]),
      h('div', {}, [`${state.previewSelection.sourceKind === 'vanilla' ? siteText('バニラ') : siteText('通常パック')} · ${path} · ${node?.rawKey || state.previewSelection.rawKey || state.selectedPointer}`]),
      h('p', { class: 'hint' }, [state.editScope === 'screen'
        ? siteText('この原文を参照する、現在の UI 内の配置に変更を保存します。共有元の原文は保持します。')
        : siteText('この共有元の原文を変更します。同じ定義を使う他の UI にも反映されます。')]),
      Number(state.previewSelection.instances) > 1 ? h('p', { class: 'hint' }, [siteText`この共有元に対応する表示は、現在のプレビューに ${state.previewSelection.instances} 要素あります。実際の変更範囲は下の確認結果に表示します。`]) : '',
    ]) : '',
    controller.planPreviewEdit ? renderWorkspaceEditPlan(h, { controller, onError }) : '',
    renderPicker({ id: 'workspace-source-file', label: siteText('編集する JSON ファイル'), entries: files, selectedValue: key, disabled,
      onSelect: next => void invoke(() => { const file = state.files.find(row => workspaceDocumentKey(row.path, row.sourceId) === next); if (!file) fail('WORKSPACE_DOCUMENT_NOT_FOUND'); return controller.readDocument(file.path, { sourceId: file.sourceId }); }) }),
    renderPicker({ id: 'workspace-source-node', label: siteText('原文の要素'), entries: nodes, selectedValue: state.selectedPointer, disabled,
      onSelect: pointer => { controller.selectPointer(pointer, path, sourceId); onSelectNode?.(pointer, path, sourceId); } }),
    node ? h('div', { class: 'workspace-element-properties' }, [
      h('strong', {}, [node.rawKey]),
      h('label', { for: 'workspace-property-name' }, [siteText('設定する属性')]), propertySelect, custom,
      h('p', { class: 'hint' }, [siteText('値は JSON 形式です。文字列は "文字"、サイズは [100, 40]、相対値は ["50%", "100%"]。動作・継承・未知の属性も原文として保持します。')]),
      geometryNames.has(propertyName) && geometryPlanReady && !Object.hasOwn(properties, propertyName) ? h('p', { class: 'hint' }, [siteText('変更する要素にこの属性の指定がありません。新しく設定する値を入力してください。選んだ画像の値は操作要素へ流用しません。')]) : '',
      propertyValue,
      h('button', { type: 'button', class: 'btn btn-primary', disabled: disabled || (geometryNames.has(propertyName) && !geometryPlanReady) || (Boolean(controller.editPreviewProperty) && !state.previewSelection?.screen), onClick: () => void invoke(() => {
        const name = propertyName === 'custom' ? custom.value.trim() : propertyName;
        if (!name || /[\u0000-\u001f]/u.test(name)) fail('WORKSPACE_PROPERTY_INVALID', siteText('属性名を指定してください。'));
        let value; try { value = JSON.parse(propertyValue.value); } catch { fail('WORKSPACE_PROPERTY_JSON', siteText('属性の値が JSON として正しくありません。')); }
        return controller.editPreviewProperty ? controller.editPreviewProperty(name, value)
          : controller.edit({ type: 'set', path, ...(sourceId ? { sourceId } : {}), pointer: `${node.pointer}/${escapeSourcePointer(name)}`, value });
      }) }, [siteText(state.manualApply === false ? '属性を反映' : '属性の変更を追加')]),
      controller.editPreviewProperty && !state.previewSelection?.screen ? h('p', { class: 'hint' }, [siteText('属性を反映するにはプレビュー上の要素を選んでください。画面との対応がない原文は直接 JSON 編集で変更できます。')]) : '',
      h('p', { class: 'workspace-scope-notice' }, [siteText('継承・JSON直接編集は共有元を変更します。画面限定の削除は、プレビューで選んだ通常配置を確認して実行します。')]),
      h('label', { for: 'workspace-inheritance' }, [siteText('継承元（空欄で解除）')]), inheritance,
      h('button', { type: 'button', class: 'btn', disabled: disabled || !rawEditingAllowed, onClick: () => void invoke(() => controller.edit({ type: 'inherit', path, ...(sourceId ? { sourceId } : {}), pointer: node.pointer, baseRef: inheritance.value.trim() || null })) }, [siteText(state.manualApply === false ? '継承を反映' : '継承の変更を追加')]),
      h('button', { type: 'button', class: 'btn workspace-danger', disabled: disabled || !(rawEditingAllowed || scopedDeleteAllowed31), onClick: () => void invoke(() => state.editScope==='screen' ? controller.planScreenDelete31() : controller.planDelete(path, node.pointer, sourceId)) }, [siteText('この要素の削除範囲を確認')]),
    ]) : h('p', { class: 'hint' }, [siteText('プレビューまたは一覧から編集対象の要素を選んでください。')]),
    sourceDetails,
    deletePlan ? h('section', { class: 'workspace-delete-plan', role: 'status' }, [
      h('strong', {}, [siteText`削除予定: ${deletePlan.count ?? deletePlan.affected?.length ?? '?'} 要素`]),
      state.deletePlan?.result?.editPlan?.structure?.notice ? h('p', {class:'hint'}, [state.deletePlan.result.editPlan.structure.notice]) : '',
      state.deletePlan?.result?.editPlan?.target ? h('p', {class:'hint'}, [`削除先: ${state.deletePlan.result.editPlan.target.effectivePointer}`]) : '',
      h('p', {}, [siteText(state.manualApply === false ? '子要素・継承先を含みます。以下の確定ボタンで削除します。「元に戻す」で復元できます。' : '子要素・継承先を含みます。削除を変更一覧へ追加し、「JSON UIに確定」で確定します。反映前は「元に戻す」で取り消せます。')]),
      h('ul', {}, (deletePlan.affected || []).slice(0, 50).map(item => h('li', {}, [`${item.sourceKind === 'vanilla' ? siteText('バニラ') : item.sourceKind === 'imported' ? siteText('通常パック') : siteText('原文')} · ${item.physicalPath || item.path} # ${item.rawKey || item.pointer}`]))),
      (deletePlan.affected || []).length > 50 ? h('p', {}, [siteText('最初の50件を表示しています。')]) : '',
      h('button', { type: 'button', class: 'btn workspace-danger', disabled: disabled || !(rawEditingAllowed || scopedDeleteAllowed31), onClick: () => void invoke(() => controller.confirmDelete()) }, [siteText(state.manualApply === false ? '表示された範囲を削除' : '削除を変更一覧へ追加')]),
    ]) : '',
    h('p', { id: 'workspace-editor-message', class: state.error ? 'workspace-error' : 'hint', role: state.error ? 'alert' : 'status' }, [translateSiteMessage(state.error) || translateSiteMessage(state.message) || siteText('追加した変更は草稿プレビューへ反映し、「JSON UIに確定」で原文へ確定します。JSON の直接編集は「検証して反映」で適用します。')]),
  ]);
}
