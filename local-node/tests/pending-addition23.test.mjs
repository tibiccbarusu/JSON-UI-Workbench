import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspacePendingEdits } from '../../editor-core/src/ui/workspace-pending-edits.js';
import { editWorkspaceBatch } from '../workspace-batch.mjs';
import { workspaceRevision } from '../workspace-edit.mjs';

const selection = { fileId: 'f', nodeId: 'root', previewDefinitionId: 'screen', sourceId: '', path: 'ui/demo.json', pointer: '/screen' };
function setup() {
  const original = '{"namespace":"demo","screen":{"type":"screen","controls":[{"old":{"type":"label","text":"既存"}}]}}';
  const state = { workspaceId: 'w', revision: 'r1', pendingVersion: 0, pendingOperations: [], pendingRedoOperations: [],
    previewSelection: selection, drafts: new Map() };
  const commits = [];
  const pending = createWorkspacePendingEdits({ state, notify() {}, normalizeOperation: value => value,
    commit: async (operation, accept) => {
      const documents = { 'ui/demo.json': original };
      const result = await editWorkspaceBatch({ documents, operation, expectedRevision: workspaceRevision(documents) });
      assert.equal(result.ok, true, JSON.stringify(result)); commits.push(result); accept(); return result;
    } });
  const add = () => {
    pending.enqueue([{ type: 'add', path: selection.path, parentPointer: selection.pointer, name: 'new_label',
      value: { type: 'label', offset: [20, 30], size: [100, 20], text: '追加' } }]);
    return pending.additions('f')[0].id;
  };
  return { state, pending, original, commits, add };
}

test('追加・移動・属性変更を適用前に保持し、実Node原文へ1 addとして反映する', async () => {
  const { pending, add, state, original, commits } = setup();
  const id = add();
  pending.editAddition(id, { type: 'move', delta: [7, -5] });
  pending.editAddition(id, { type: 'set', property: 'text', value: '移動後の文字' });
  const addition = pending.additions('f')[0];
  assert.deepEqual(addition.operation.value.offset, [27, 25]);
  assert.equal(addition.operation.value.text, '移動後の文字');
  assert.equal(pending.compiledOperations().length, 1);
  assert.equal(state.revision, 'r1'); assert.equal(commits.length, 0);
  assert.equal(pending.transforms('f').size, 0, '新規要素の編集を親の移動と誤認しない');
  await pending.apply();
  const parsed = JSON.parse(commits[0].documents['ui/demo.json']);
  assert.deepEqual(parsed.screen.controls[0], JSON.parse(original).screen.controls[0]);
  assert.deepEqual(parsed.screen.controls[1].new_label, addition.operation.value);
  assert.equal(state.pendingOperations.length, 0);
});

test('新規要素の編集と削除を段階的にundo/redoできる', () => {
  const { pending, add } = setup(), id = add();
  pending.editAddition(id, { type: 'move', delta: [7, -5] });
  pending.editAddition(id, { type: 'delete' });
  assert.equal(pending.additions().length, 0);
  assert.throws(() => pending.editAddition(id, { type: 'move', delta: [1, 0] }), { code: 'WORKSPACE_PENDING_ADDITION_DELETED' });
  pending.undo(); assert.deepEqual(pending.additions()[0].operation.value.offset, [27, 25]);
  pending.undo(); assert.deepEqual(pending.additions()[0].operation.value.offset, [20, 30]);
  pending.redo(); assert.deepEqual(pending.additions()[0].operation.value.offset, [27, 25]);
  pending.redo(); assert.equal(pending.additions().length, 0);
});

test('追加を削除して同名で作り直しても旧IDを復活させず、新しい追加だけを編集・確定できる', async () => {
  const { pending, add, state, commits } = setup(), originalId = add();
  pending.editAddition(originalId, { type: 'delete' });
  add();
  const newId = state.pendingOperations.at(-1).pendingAdditionId;
  assert.notEqual(newId, originalId);
  assert.deepEqual(pending.additions().map(item => item.id), [newId], '削除した追加IDを同名の新追加へ接続しない');
  assert.throws(() => pending.editAddition(originalId, { type: 'move', delta: [1, 2] }), { code: 'WORKSPACE_PENDING_ADDITION_DELETED' });
  pending.editAddition(newId, { type: 'set', property: 'text', value: '新しい追加' });
  pending.editAddition(newId, { type: 'move', delta: [3, -4] });
  assert.deepEqual(pending.additions()[0].operation.value.offset, [23, 26]);
  pending.undo(); pending.undo(); pending.undo();
  assert.equal(pending.additions().length, 0, '再追加のundo後も旧追加は削除済み');
  pending.undo();
  assert.deepEqual(pending.additions().map(item => item.id), [originalId]);
  assert.equal(pending.additions()[0].operation.value.text, '追加');
  pending.redo(); pending.redo(); pending.redo(); pending.redo();
  assert.deepEqual(pending.additions().map(item => item.id), [newId]);
  await pending.apply();
  const controls = JSON.parse(commits[0].documents['ui/demo.json']).screen.controls;
  assert.equal(controls.length, 2);
  assert.equal(controls[1].new_label.text, '新しい追加');
  assert.deepEqual(controls[1].new_label.offset, [23, 26]);
});

test('追加予定要素の文字変更後も既存要素の編集を続けて同じbatchへ確定できる', async () => {
  const { pending, add, commits } = setup(), id = add();
  pending.editAddition(id, { type: 'set', property: 'text', value: '文字編集済みの追加' });
  pending.enqueue([{ type: 'set', path: 'ui/demo.json', pointer: '/screen/controls/0/old/text', value: '既存も変更' }]);
  await pending.apply();
  const controls = JSON.parse(commits[0].documents['ui/demo.json']).screen.controls;
  assert.equal(controls[0].old.text, '既存も変更');
  assert.equal(controls[1].new_label.text, '文字編集済みの追加');
});

test('追加後に削除しただけの反映ではHTTPも原文も履歴も変更しない', async () => {
  const { pending, add, commits } = setup(), id = add();
  pending.editAddition(id, { type: 'delete' });
  assert.equal((await pending.apply()).applied, 0); assert.equal(commits.length, 0);
  assert.equal(pending.hasChanges(), false);
});

test('外部から取得した追加値の書換えはキューを汚染しない', () => {
  const { pending, add } = setup(); add();
  pending.additions()[0].operation.value.offset[0] = 999;
  pending.compiledOperations()[0].value.text = '外部変更';
  assert.deepEqual(pending.additions()[0].operation.value.offset, [20, 30]);
  assert.equal(pending.additions()[0].operation.value.text, '追加');
});

test('非有限値・危険な属性・構造置換・過大な座標をキューへ保存しない', () => {
  const { pending, add, state } = setup(), id = add();
  for (const change of [
    { type: 'move', delta: [Infinity, 0] }, { type: 'move', delta: [1000000, 0] },
    { type: 'set', property: '__proto__', value: {} }, { type: 'set', property: 'controls', value: [] },
    { type: 'set', property: 'text', value: undefined },
  ]) { assert.throws(() => pending.editAddition(id, change)); assert.equal(state.pendingOperations.length, 1); }
});

test('新規要素の編集を他画面の既存操作と混在しても原文pointerを混同しない', async () => {
  const { pending, add, commits } = setup(), id = add();
  pending.editAddition(id, { type: 'move', delta: [1, 2] });
  pending.enqueue([{ type: 'set', path: 'ui/demo.json', pointer: '/screen/controls/0/old/text', value: '既存変更' }]);
  await pending.apply();
  const controls = JSON.parse(commits[0].documents['ui/demo.json']).screen.controls;
  assert.equal(controls[0].old.text, '既存変更'); assert.deepEqual(controls[1].new_label.offset, [21, 32]);
});
