import { siteText } from '../i18n/site-messages.js';
import { compileWorkspacePending23, workspacePendingAdditions23 } from './workspace-pending-additions23.js';

// ブラウザ用の軽量な編集キュー。原文の解釈・複製・レイアウト計算は行わない。
export const MAX_PENDING_OPERATIONS = 128;
const MAX_PENDING_CHARS = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['set', 'move', 'add', 'delete', 'inherit', 'replaceText']);
const STRUCTURAL_TYPES = new Set(['add', 'delete', 'inherit', 'replaceText']);
const DISPLAY_PROPERTIES = new Set(['offset', 'size', 'min_size', 'max_size', 'anchor_from', 'anchor_to',
  'text', 'texture', 'color', 'alpha', 'font_type', 'font_scale_factor', 'font_size', 'shadow',
  'layer', 'uv', 'uv_size', 'nineslice_size', 'keep_ratio', 'text_alignment', 'line_padding',
  'visible', 'enabled', 'clip_children', 'rotate', 'grayscale']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = (code, message) => { throw Object.assign(new Error(message || code), { code }); };
const pointerContains = (parent, child) => parent === child || child.startsWith(`${parent}/`);

function copyJson(value) {
  let text;
  try {
    text = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'number' && !Number.isFinite(item) || ['bigint', 'function', 'symbol'].includes(typeof item)) {
        fail('WORKSPACE_PENDING_VALUE_INVALID', siteText('編集値は JSON として保存できる有限の値で指定してください。'));
      }
      return item;
    });
    if (typeof text !== 'string') fail('WORKSPACE_PENDING_VALUE_INVALID');
    if (text.length > MAX_PENDING_CHARS) fail('WORKSPACE_PENDING_LIMIT', siteText('未反映の変更が大きすぎます。先に「JSON UIに確定」を選んでください。'));
    return JSON.parse(text);
  } catch (error) {
    if (error?.code) throw error;
    fail('WORKSPACE_PENDING_VALUE_INVALID', siteText('編集値を保存できません。循環参照や不正な値がないか確認してください。'));
  }
}

/** controls 配列や定義そのものの置換も、後続 pointer を変える構造変更として扱う。 */
export function isStructuralWorkspaceOperation(operation) {
  if (STRUCTURAL_TYPES.has(operation.type)) return true;
  if (operation.type !== 'set') return false;
  const property = operation.scope !== undefined ? operation.property
    : String(operation.pointer || '').split('/').at(-1).replace(/~1/gu, '/').replace(/~0/gu, '~');
  return !DISPLAY_PROPERTIES.has(property);
}

// 共有原文のadd/deleteは既存のpointer追跡を使う。画面限定の構造操作は
// 参照を個別化するため末尾で確定する。追加予定要素自身の編集はaddへ畳み込む。
const isOpaqueStructure = operation => operation.scope === 'screen' && ['add', 'delete'].includes(operation.type)
  || isStructuralWorkspaceOperation(operation) && operation.type !== 'add' && operation.type !== 'delete';
const sameDocument = (left, right) => left.path === right.path
  && String(left.sourceId || '') === String(right.sourceId || '');

/** 反映前の座標を保持したまま、削除済み要素への後続編集をキュー境界で拒否する。 */
function validateBaseRevisionSequence(operations) {
  const deletions = [], additions = new Set();
  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    if (isOpaqueStructure(operation) && index !== operations.length - 1) {
      fail('WORKSPACE_PENDING_STRUCTURE_ORDER', siteText('継承変更や原文・構造の置換は、一括反映の最後に配置してください。'));
    }
    const references = [{ ...operation, pointer: operation.type === 'add' ? operation.parentPointer : operation.pointer }];
    if (operation.screen?.path) references.push(operation.screen);
    for (const removed of deletions) if (references.some(reference => sameDocument(removed, reference)
      && typeof reference.pointer === 'string' && pointerContains(removed.pointer, reference.pointer))) {
      fail('WORKSPACE_PENDING_TARGET_DELETED', siteText('削除予定の要素やその子要素は編集できません。削除を元に戻すか、先に「JSON UIに確定」を選んでください。'));
    }
    if (operation.type === 'delete' && typeof operation.pointer === 'string') deletions.push(operation);
    if (operation.type === 'add') {
      const identity = JSON.stringify([String(operation.sourceId || ''), operation.path, operation.parentPointer || '',
        String(operation.name || '').split('@', 1)[0]]);
      if (additions.has(identity)) fail('WORKSPACE_PENDING_ADD_NAME_CONFLICT', siteText('同じ親へ追加予定の要素名が重複しています。別の名前を指定してください。'));
      additions.add(identity);
    }
  }
}

/** 状態だけを変更する。複数要素の 1 操作を同一 groupId として undo/redo する。 */
export function createWorkspacePendingEdits({ state, notify, normalizeOperation, commit }) {
  let groupSequence = 0;
  const hasChanges = () => state.pendingOperations.length > 0;
  const hasDraft = () => [...state.drafts.values()].some(draft => draft.dirty || draft.invalid);
  const ensureEditable = () => {
    if (!state.workspaceId) fail('WORKSPACE_NOT_OPEN');
    if (state.busy) fail('WORKSPACE_BUSY', siteText('処理中です。完了してから操作してください。'));
    if (state.pendingCommitUncertain) fail('WORKSPACE_PENDING_COMMIT_UNCERTAIN', siteText('前回の確定内容を確認する必要があります。「確定済みの内容を確認」を先に選んでください。'));
    if (state.projectionError || state.previewAllowed === false) fail('WORKSPACE_PROJECTION_REQUIRED', siteText('現在の確定内容を再同期してから編集してください。'));
    if (hasDraft()) fail('WORKSPACE_UNAPPLIED_DRAFT', siteText('先に原文の変更を適用するか取り消してください。'));
    if (hasChanges() && state.pendingBaseRevision !== state.revision) fail('WORKSPACE_PENDING_REVISION_CONFLICT', siteText('確定内容が変更されています。未反映の変更を確認して取り消し、編集し直してください。'));
  };
  const changed = () => {
    state.pendingVersion++;
    state.exportPlan = null; state.deletePlan = null; state.error = '';
    state.message = hasChanges() ? siteText`未確定の変更が ${state.pendingOperations.length} 件あります。草稿プレビューへ反映し、「JSON UIに確定」で原文へ確定します。` : siteText('未反映の変更はありません。');
    notify('pending');
  };
  const clear = () => {
    state.pendingVersion++;
    state.pendingOperations = []; state.pendingRedoOperations = []; state.pendingBaseRevision = null;
    state.pendingCommitUncertain = false; state.pendingCommitError = ''; state.pendingConflict = false;
  };
  const api = {
    hasChanges,
    clear,
    enqueue(operations, { label = '', previewSelections = [], previewNodeIds = [] } = {}) {
      ensureEditable();
      if (!Array.isArray(operations) || !operations.length) fail('WORKSPACE_PENDING_OPERATIONS_REQUIRED');
      if (!Array.isArray(previewNodeIds) || previewNodeIds.length && previewNodeIds.length !== operations.length) {
        fail('WORKSPACE_PENDING_PREVIEW_TARGET_INVALID', siteText('仮配置の対象一覧を確認できません。編集対象を選び直してください。'));
      }
      if (state.pendingOperations.length + operations.length > MAX_PENDING_OPERATIONS) fail('WORKSPACE_PENDING_LIMIT', siteText`一度に反映できる変更は ${MAX_PENDING_OPERATIONS} 件までです。先に「JSON UIに確定」を選んでください。`);
      // 追加予定要素の属性編集は通常addへ折り畳まれる。原文pointerを持たない
      // 内部setを原文の構造置換と取り違えて、後続の通常編集を拒否しない。
      if (state.pendingOperations.some(entry => !entry.pendingAdditionEdit && isOpaqueStructure(entry.operation))) fail('WORKSPACE_PENDING_STRUCTURE_BARRIER', siteText('追加・削除や継承変更などの構造編集を「JSON UIに確定」してから、次の要素を編集してください。'));
      const copied = operations.map(operation => {
        if (!operation || typeof operation !== 'object' || !ALLOWED_TYPES.has(operation.type)) fail('WORKSPACE_PENDING_OPERATION_INVALID');
        if (operation.type === 'set' && (!own(operation, 'value') || operation.value === undefined)) fail('WORKSPACE_PENDING_VALUE_INVALID', siteText('属性に設定する JSON 値がありません。'));
        if (operation.type === 'move' && operation.delta !== undefined && (!Array.isArray(operation.delta) || operation.delta.length !== 2 || ![operation.delta[0], operation.delta[1]].every(value => typeof value === 'number' && Number.isFinite(value)))) fail('WORKSPACE_MOVE_INVALID', siteText('移動量は有限な数値 2 個で指定してください。'));
        return copyJson(normalizeOperation(operation));
      });
      validateBaseRevisionSequence([...compileWorkspacePending23(state.pendingOperations), ...copied]);
      const groupId = ++groupSequence;
      const entries = copied.map((operation, index) => {
        const proposed = previewSelections[index] || state.previewSelection;
        const selected = proposed && operation.path === proposed.path && String(operation.sourceId || '') === String(proposed.sourceId || '')
          && (pointerContains(String(proposed.pointer || ''), String(operation.pointer || '')) || operation.type === 'add' && operation.parentPointer === proposed.pointer) ? copyJson(proposed) : null;
        const targetIds = previewNodeIds.length ? previewNodeIds[index] : undefined;
        // Node の事前計画から対応が確認された ID だけを保存する。空・重複・別選択の
        // 対象は、一部の表示だけ動かして保存範囲を誤認させないよう全操作を拒否する。
        if (previewNodeIds.length && (!selected?.fileId || !selected.nodeId || !Array.isArray(targetIds)
          || !targetIds.length || targetIds.length > 50000
          || !Array.from(targetIds).every(id => typeof id === 'string' && id.length > 0)
          || new Set(targetIds).size !== targetIds.length)) {
          fail('WORKSPACE_PENDING_PREVIEW_TARGET_INVALID', siteText('仮配置の対象一覧を確認できません。編集対象を選び直してください。'));
        }
        return { operation, previewSelection: selected,
          ...(operation.type === 'add' ? { pendingAdditionId: `pending-add-${groupId}-${index}` } : {}),
          ...(targetIds ? { previewNodeIds: [...targetIds] } : {}),
          identity: selected ? JSON.stringify([selected.fileId, selected.previewDefinitionId, selected.nodeId, selected.sourceId, selected.path, selected.pointer]) : null, groupId, label: String(label).slice(0, 200) };
      });
      if (JSON.stringify([...state.pendingOperations, ...entries]).length > MAX_PENDING_CHARS) fail('WORKSPACE_PENDING_LIMIT', siteText('未反映の変更が大きすぎます。先に「JSON UIに確定」を選んでください。'));
      if (!hasChanges()) state.pendingBaseRevision = state.revision;
      state.pendingOperations.push(...entries); state.pendingRedoOperations = []; changed();
      return { ok: true, pending: true, pendingCount: state.pendingOperations.length, groupId };
    },
    compiledOperations: () => compileWorkspacePending23(state.pendingOperations),
    additions: fileId => workspacePendingAdditions23(state.pendingOperations, fileId),
    editAddition(id, change) {
      ensureEditable();
      const added = state.pendingOperations.find(entry => !entry.pendingAdditionEdit && entry.pendingAdditionId === id);
      if (!added) fail('WORKSPACE_PENDING_ADDITION_MISSING', siteText('追加予定の要素が見つかりません。選択し直してください。'));
      const changes = Array.isArray(change) ? change : [change];
      if (!changes.length || changes.length > 4 || changes.some(item => !item || !['set', 'move', 'delete'].includes(item.type))) fail('WORKSPACE_PENDING_ADDITION_OPERATION_INVALID');
      if (state.pendingOperations.length + changes.length > MAX_PENDING_OPERATIONS) fail('WORKSPACE_PENDING_LIMIT');
      const groupId = ++groupSequence;
      const entries = changes.map(item => ({ operation: copyJson({ ...item, path: added.operation.path, sourceId: added.operation.sourceId }),
        pendingAdditionEdit: true, pendingAdditionId: id, previewSelection: added.previewSelection,
        groupId, label: siteText('追加予定の要素を編集') }));
      const candidate = [...state.pendingOperations, ...entries];
      compileWorkspacePending23(candidate); // 失敗はキューへ追加する前に止める。
      if (JSON.stringify(candidate).length > MAX_PENDING_CHARS) fail('WORKSPACE_PENDING_LIMIT');
      state.pendingOperations.push(...entries); state.pendingRedoOperations = []; changed();
      return { ok: true, pending: true, pendingCount: state.pendingOperations.length, groupId };
    },
    undo() {
      ensureEditable();
      if (!hasChanges()) return false;
      const groupId = state.pendingOperations.at(-1).groupId;
      const index = state.pendingOperations.findIndex(entry => entry.groupId === groupId);
      state.pendingRedoOperations.push(state.pendingOperations.splice(index)); changed(); return true;
    },
    redo() {
      ensureEditable();
      if (!state.pendingRedoOperations.length) return false;
      if (state.pendingBaseRevision !== state.revision) fail('WORKSPACE_PENDING_REVISION_CONFLICT');
      const entries = state.pendingRedoOperations.pop(); state.pendingOperations.push(...entries); changed(); return true;
    },
    discard() {
      if (state.busy) fail('WORKSPACE_BUSY');
      // 不明な POST は取り消せない。確定画面の再同期ゲートを残したまま、ローカルのキューだけ捨てる。
      clear(); changed();
    },
    async apply() {
      ensureEditable();
      if (!hasChanges()) return { ok: true, pending: false, applied: 0 };
      const entries = state.pendingOperations, workspaceId = state.workspaceId;
      const operations = compileWorkspacePending23(entries);
      // 追加後に削除しただけなら確定原文も履歴も変更する必要がない。
      if (!operations.length) { clear(); changed(); return { ok: true, pending: false, applied: 0 }; }
      const operation = { type: 'batch', pointerBasis: 'base-revision', operations };
      try {
        return await commit(operation, () => {
          if (workspaceId !== state.workspaceId || entries !== state.pendingOperations) return;
          state.lastPendingCommit = { revision: state.revision, operations: copyJson(operations), count: operations.length };
          clear();
        });
      } catch (error) {
        if (workspaceId === state.workspaceId && entries === state.pendingOperations) {
          state.pendingVersion++;
          state.pendingCommitUncertain = error.workspaceMutationUncertain === true;
          state.pendingCommitError = String(error.message || error);
          state.pendingConflict = /REVISION_CONFLICT/u.test(String(error.code || error.message || ''));
          notify('pending-error');
        }
        throw error;
      }
    },
    transforms(fileId) {
      const transforms = new Map();
      if (state.pendingCommitUncertain || state.pendingBaseRevision !== state.revision) return transforms;
      for (const { operation, previewSelection: selection, previewNodeIds, pendingAdditionEdit } of state.pendingOperations) {
        if (pendingAdditionEdit) continue;
        if (!selection?.nodeId || selection.fileId !== fileId || operation.type === 'add') continue;
        // 操作親への昇格・反復テンプレートの全対象は、事前計画から解決した ID に反映。
        // 対応不明な互換呼出しで操作親を推測したり、選択画像だけ動かしたりしない。
        const targets = previewNodeIds || (operation.targetMode === 'interaction' ? [] : [selection.nodeId]);
        for (const nodeId of targets) {
          let transform = transforms.get(nodeId);
          if (!transform) { transform = { dx: 0, dy: 0, deleted: false, properties: {} }; transforms.set(nodeId, transform); }
          if (operation.type === 'move' && Array.isArray(operation.delta)) { transform.dx += operation.delta[0]; transform.dy += operation.delta[1]; }
          if (operation.type === 'move' && Array.isArray(operation.offset)) { transform.properties.offset = copyJson(operation.offset); transform.dx = 0; transform.dy = 0; }
          if (operation.type === 'delete') transform.deleted = true;
          if (operation.type === 'set') {
            const property = operation.property || (String(operation.pointer).startsWith(`${selection.pointer}/`) ? String(operation.pointer).slice(selection.pointer.length + 1).replace(/~1/gu, '/').replace(/~0/gu, '~') : '');
            if (property && !property.includes('/') && !['__proto__', 'constructor', 'prototype'].includes(property)) {
              transform.properties[property] = copyJson(operation.value);
              if (property === 'offset') { transform.dx = 0; transform.dy = 0; }
            }
          }
        }
      }
      return transforms;
    },
  };
  return api;
}
