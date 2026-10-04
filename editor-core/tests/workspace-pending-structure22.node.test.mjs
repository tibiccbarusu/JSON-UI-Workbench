import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';

const path = 'ui/demo.json';
const pointer = index => `/main/controls/${index}/node_${index}`;
const target = (index, overrides = {}) => ({ path, sourceId: 'pack', pointer: pointer(index), ...overrides });
const remove = (index, overrides = {}) => ({ type: 'delete', ...target(index, overrides), cascade: true });
const move = (index, overrides = {}) => ({ type: 'move', ...target(index, overrides), delta: [7, -3] });
const add = (name, overrides = {}) => ({ type: 'add', path, sourceId: 'pack', parentPointer: '/main', name,
  value: { type: 'panel', size: [20, 20] }, ...overrides });
const selection = index => ({ ...target(index), nodeId: `node_${index}`, fileId: 'demo', previewDefinitionId: 'demo.main' });

async function fixture({ mutation } = {}) {
  let revision = 'r0';
  const requests = [], commits = [];
  const result = () => ({ ok: true, workspaceId: 'w', revision, files: [{ path, sourceId: 'pack' }], nodes: [], sources: [{ id: 'pack', kind: 'imported' }] });
  const controller = createWorkspaceEditor({ request: async (route, payload) => {
    requests.push({ route, payload: structuredClone(payload) });
    if (route === 'edit') {
      if (mutation) return mutation();
      revision = 'r1';
    }
    return route === 'read' ? { ...result(), path, sourceId: 'pack', text: '{}' } : result();
  }, onCommit: async (...args) => { commits.push(args); } });
  await controller.ensure([{ id: 'pack', kind: 'imported' }], 'one');
  requests.length = 0;
  return { controller, requests, commits };
}

test('連続削除・兄弟移動は元revisionのpointerを維持し、反映時だけ通信する', async () => {
  const { controller, requests, commits } = await fixture();
  const operations = [move(2), remove(0), remove(1), move(2)];
  for (const operation of operations) await controller.edit(operation);
  assert.equal(requests.length, 0);
  assert.equal(controller.pendingCount, 4);
  assert.deepEqual(controller.state.pendingOperations.map(row => row.operation), operations);
  await controller.applyPending();
  const edit = requests.filter(row => row.route === 'edit');
  assert.equal(edit.length, 1);
  assert.equal(edit[0].payload.expectedRevision, 'r0');
  assert.equal(edit[0].payload.operation.pointerBasis, 'base-revision');
  assert.deepEqual(edit[0].payload.operation.operations, operations);
  assert.equal(commits.length, 1);
  assert.equal(controller.pendingCount, 0);
});

test('連続追加・既存要素移動はまとめて保存され、undo/redoは操作単位を維持する', async () => {
  const { controller, requests } = await fixture();
  await controller.edit(add('new_panel_1'));
  controller.queueOperations([add('new_panel_2'), move(2)], { label: '追加と配置' });
  assert.equal(controller.pendingCount, 3);
  assert.equal(requests.length, 0);
  await controller.history('undo');
  assert.equal(controller.pendingCount, 1);
  await controller.history('redo');
  assert.equal(controller.pendingCount, 3);
  assert.equal(controller.state.pendingOperations[1].groupId, controller.state.pendingOperations[2].groupId);
});

test('削除予定の本人・子・追加先・画面はキューへ途中追加せず拒否する', async () => {
  for (const operation of [move(0), remove(0), move(0, { pointer: `${pointer(0)}/controls/0/child` }),
    add('child', { parentPointer: pointer(0) }), move(2, { path: 'ui/shared.json', screen: target(0) })]) {
    const { controller } = await fixture();
    await controller.edit(remove(0));
    const before = structuredClone(controller.state.pendingOperations);
    assert.throws(() => controller.queueOperations([move(2), operation]), { code: 'WORKSPACE_PENDING_TARGET_DELETED' });
    assert.deepEqual(controller.state.pendingOperations, before);
  }
});

test('同じpointerでも別パック・別ファイルの要素は削除予定と取り違えない', async () => {
  const { controller } = await fixture();
  controller.queueOperations([remove(0), move(0, { sourceId: 'other' }), move(0, { path: 'ui/other.json' })]);
  assert.equal(controller.pendingCount, 3);
});

test('pointer区切りを比較し、名前が前方一致する別要素を拒否しない', async () => {
  const { controller } = await fixture();
  controller.queueOperations([remove(0, { pointer: '/main/controls/0/a' }), move(0, { pointer: '/main/controls/0/ab' })]);
  assert.equal(controller.pendingCount, 2);
});

test('同じ親への追加名重複は継承名違いでも全拒否し、別親・別パックは区別する', async () => {
  const { controller } = await fixture();
  await controller.edit(add('tile@common.first'));
  assert.throws(() => controller.queueOperations([move(2), add('tile@common.second')]), { code: 'WORKSPACE_PENDING_ADD_NAME_CONFLICT' });
  assert.equal(controller.pendingCount, 1);
  controller.queueOperations([add('tile', { parentPointer: '/other' }), add('tile', { sourceId: 'other' })]);
  assert.equal(controller.pendingCount, 3);
});

test('任意の構造置換・継承変更は引き続き最後に限定する', async () => {
  for (const operation of [
    { type: 'set', path, sourceId: 'pack', pointer: '/main/controls', value: [] },
    { type: 'replaceText', path, sourceId: 'pack', text: '{}' },
    { type: 'inherit', ...target(2), inherit: 'other.base' },
  ]) {
    const { controller } = await fixture();
    assert.throws(() => controller.queueOperations([operation, move(2)]), { code: 'WORKSPACE_PENDING_STRUCTURE_ORDER' });
    assert.equal(controller.pendingCount, 0);
    controller.queueOperations([remove(0), operation]);
    await assert.rejects(controller.edit(move(2)), { code: 'WORKSPACE_PENDING_STRUCTURE_BARRIER' });
    assert.equal(controller.pendingCount, 2);
  }
});

test('削除のundo後は元要素を再編集でき、無効になったredoを破棄する', async () => {
  const { controller } = await fixture();
  await controller.edit(remove(0));
  await controller.history('undo');
  await controller.edit(move(0));
  assert.equal(controller.pendingCount, 1);
  assert.equal(controller.state.pendingRedoOperations.length, 0);
});

test('原文pointerが添字付きでも仮配置は元のnode IDに対応する', async () => {
  const { controller } = await fixture();
  controller.queueOperations([remove(0), move(2)], { previewSelections: [selection(0), selection(2)] });
  const transforms = controller.pendingNodeTransforms('demo');
  assert.equal(transforms.get('node_0').deleted, true);
  assert.equal(transforms.get('node_2').dx, 7);
  assert.equal(transforms.get('node_2').dy, -3);
  assert.equal(transforms.size, 2);
});

test('Nodeの明示的な候補拒否は操作を保持し、結果不明として誤停止しない', async () => {
  for (const code of ['EDIT_BATCH_POINTER_BASIS_INVALID', 'EDIT_BATCH_TARGET_REMOVED',
    'EDIT_BATCH_SELECTION_AMBIGUOUS', 'EDIT_BATCH_BASE_TARGET_REQUIRED']) {
    const { controller, commits } = await fixture({ mutation: () => ({ ok: false, status: 422, error: { code, message: '候補変更を拒否しました' } }) });
    await controller.edit(remove(0));
    await assert.rejects(controller.applyPending(), { code });
    assert.equal(controller.pendingCount, 1);
    assert.equal(controller.state.pendingCommitUncertain, false);
    assert.equal(controller.previewBlocked(), false);
    assert.equal(commits.length, 0);
  }
});

test('新しい拒否コードでもHTTP 500は確定不明として再送を止める', async () => {
  const { controller, requests } = await fixture({ mutation: () => ({ ok: false, status: 500,
    error: { code: 'EDIT_BATCH_TARGET_REMOVED', message: 'サーバー障害' } }) });
  await controller.edit(remove(0));
  await assert.rejects(controller.applyPending());
  assert.equal(controller.state.pendingCommitUncertain, true);
  await assert.rejects(controller.applyPending(), { code: 'WORKSPACE_PENDING_COMMIT_UNCERTAIN' });
  assert.equal(requests.filter(row => row.route === 'edit').length, 1);
});
