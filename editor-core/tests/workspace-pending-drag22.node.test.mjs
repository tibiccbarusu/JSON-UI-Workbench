import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspacePendingEdits } from '../src/ui/workspace-pending-edits.js';
import { applyPendingLayout21 } from '../src/ui/editor-draft-layout21.js';

const selection = { fileId: 'anvil-preview', previewDefinitionId: 'anvil-screen', nodeId: 'close/image',
  path: 'ui/ui_common.json', sourceId: 'vanilla', pointer: '/close/controls/0/image' };
const operation = { type: 'move', ...selection, targetMode: 'interaction', scope: 'screen', delta: [13, -4] };
const box = (id, parentId, x, y, type = 'image') => ({ id, parentId, x, y, w: 20, h: 20, type });
const baseLayout = { preset: { width: 480, height: 270 }, boxes: [
  box('close', null, 400, 30, 'button'), box('close/image', 'close', 402, 32),
  box('close/label', 'close', 403, 33, 'label'), box('unrelated', null, 200, 100),
] };
function fixture(commit = async () => ({ ok: false })) {
  const state = { workspaceId: 'w', revision: 'r0', busy: false, previewAllowed: true, drafts: new Map(),
    pendingOperations: [], pendingRedoOperations: [], pendingVersion: 0, previewSelection: structuredClone(selection) };
  const pending = createWorkspacePendingEdits({ state, notify() {}, normalizeOperation: value => value, commit });
  return { state, pending, paint: () => applyPendingLayout21(baseLayout, pending.transforms(selection.fileId)) };
}

test('ドラッグ終了後もNodeで確認した操作親と全ての子を仮位置へ保持する', () => {
  const { pending, paint } = fixture();
  pending.enqueue([operation], { previewNodeIds: [['close']] });
  assert.deepEqual(paint().boxes.map(({ id, x, y }) => [id, x, y]), [
    ['close', 413, 26], ['close/image', 415, 28], ['close/label', 416, 29], ['unrelated', 200, 100],
  ]);
  assert.deepEqual(baseLayout.boxes.map(({ x, y }) => [x, y]), [[400, 30], [402, 32], [403, 33], [200, 100]], '確定配置は書き換えない');
});

test('連続ドラッグとundo/redo後も元の確定位置から差分を合算する', () => {
  const { pending, paint } = fixture();
  pending.enqueue([operation], { previewNodeIds: [['close']] });
  pending.enqueue([{ ...operation, delta: [-3, 5] }], { previewNodeIds: [['close']] });
  assert.deepEqual([paint().boxes[1].x, paint().boxes[1].y], [412, 33]);
  pending.undo(); assert.deepEqual([paint().boxes[1].x, paint().boxes[1].y], [415, 28]);
  pending.redo(); assert.deepEqual([paint().boxes[1].x, paint().boxes[1].y], [412, 33]);
  pending.discard(); assert.equal(paint(), baseLayout);
});

test('同意した反復テンプレートの全対象を1操作で保持し元へ戻せる', () => {
  const { pending } = fixture();
  const ids = [['cell0', 'cell1', 'cell2']];
  pending.enqueue([{ ...operation, generatedScope: 'template' }], { previewNodeIds: ids });
  ids[0][0] = '外部から改変';
  assert.deepEqual([...pending.transforms(selection.fileId).keys()], ['cell0', 'cell1', 'cell2']);
  assert(pending.undo()); assert.equal(pending.transforms(selection.fileId).size, 0);
  assert(pending.redo()); assert.equal(pending.transforms(selection.fileId).get('cell2').dx, 13);
  assert.equal(pending.transforms('別の画面').size, 0);
});

test('適用の既知拒否でも移動の仮位置を保持し、差分の原点を変えない', async () => {
  const { pending, paint } = fixture(async () => { throw Object.assign(new Error('拒否'), { code: 'EDIT_VALIDATION_FAILED' }); });
  pending.enqueue([operation], { previewNodeIds: [['close']] });
  await assert.rejects(pending.apply(), { code: 'EDIT_VALIDATION_FAILED' });
  assert.deepEqual([paint().boxes[1].x, paint().boxes[1].y], [415, 28]);
  assert.equal(pending.hasChanges(), true);
});

test('解決済み対象の欠落・重複・空ID・選択不一致を途中まで保存しない', () => {
  for (const previewNodeIds of [null, [[]], [['close', 'close']], [['']], [[null]], [new Array(1)], ['close']]) {
    const { pending, state } = fixture();
    assert.throws(() => pending.enqueue([operation], { previewNodeIds }), { code: 'WORKSPACE_PENDING_PREVIEW_TARGET_INVALID' });
    assert.equal(state.pendingOperations.length, 0);
  }
  const { pending, state } = fixture();
  assert.throws(() => pending.enqueue([{ ...operation, sourceId: '別パック' }], { previewNodeIds: [['close']] }), { code: 'WORKSPACE_PENDING_PREVIEW_TARGET_INVALID' });
  assert.equal(state.pendingOperations.length, 0);
});

test('未確認の操作親へ選択画像だけを移動する代替は行わない', () => {
  const { pending } = fixture();
  pending.enqueue([operation]);
  assert.equal(pending.transforms(selection.fileId).size, 0);
});
