import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';
import { MAX_PENDING_OPERATIONS, isStructuralWorkspaceOperation } from '../src/ui/workspace-pending-edits.js';

const path = 'ui/demo.json';
const pointer = '/main/controls/0/label';
const move = (delta = [1, 2]) => ({ type: 'move', path, sourceId: 'pack', pointer, effectivePointer: pointer,
  screen: { path, pointer: '/main', sourceId: 'pack' }, scope: 'screen', targetMode: 'visual', delta });
const selection = (nodeId = 'label') => ({ fileId: 'preview:main', previewDefinitionId: 'demo.main', nodeId,
  path, sourceId: 'pack', pointer, effectivePointer: pointer, screen: { path, pointer: '/main', sourceId: 'pack' } });
async function fixture({ mutation, failAfterCommit = '', onCommit } = {}) {
  let revision = 'r0', text = '{"namespace":"demo","main":{"type":"screen"}}', committedOnce = false;
  const requests = [], changes = [], commits = [];
  const nodes = [{ path, sourceId: 'pack', pointer, rawKey: 'label', props: { text: '元の文字' } }];
  const status = () => ({ ok: true, workspaceId: 'workspace', revision, files: [{ path, sourceId: 'pack', sourceKind: 'imported' }],
    sources: [{ id: 'pack', kind: 'imported' }], nodes });
  const controller = createWorkspaceEditor({ request: async (route, payload, options) => {
    requests.push({ route, payload: structuredClone(payload), signal: options?.signal });
    if (route === 'edit' && payload.operation.type === 'planEdit') return { ...status(), editPlan: { target: { path, pointer }, targetMode: 'visual', scope: 'screen', affectedInstances: 1 } };
    if (route === 'edit') {
      if (mutation) return mutation({ payload, status, setRevision(value) { revision = value; } });
      revision = 'r1'; committedOnce = true; text = '{"namespace":"demo","main":{"type":"screen","text":"変更後"}}'; return status();
    }
    if (route === failAfterCommit && committedOnce) { committedOnce = false; throw new Error('確定後の同期失敗'); }
    return route === 'read' ? { ...status(), path, sourceId: 'pack', text } : status();
  }, onChange(_state, kind) { changes.push(kind); }, onCommit: async (...args) => { commits.push(args); await onCommit?.(...args); } });
  await controller.ensure([{ id: 'pack', kind: 'imported' }], 'one');
  await controller.readDocument(path, { sourceId: 'pack' });
  await controller.selectPreviewTarget(selection(), selection());
  await controller.planPreviewEdit();
  requests.length = 0; changes.length = 0;
  return { controller, requests, changes, commits, changeRevision(value) { revision = value; } };
}

test('個別編集の既定値はvisualで、move/setは通信も再投影も行わずキューへ保存', async () => {
  const { controller, requests, changes, commits } = await fixture();
  assert.equal(controller.state.editTargetMode, 'visual');
  await controller.movePreviewElement([5, -4]);
  await controller.movePreviewElement([2, 3]);
  await controller.editPreviewProperty('text', '変更予定');
  assert.equal(requests.length, 0); assert.equal(commits.length, 0);
  assert.equal(controller.state.revision, 'r0'); assert.equal(controller.pendingCount, 3);
  assert.equal(controller.previewBlocked(), false); assert(changes.every(kind => kind === 'pending'));
  assert.deepEqual(controller.pendingNodeTransforms('preview:main').get('label'), { dx: 7, dy: -1, deleted: false, properties: { text: '変更予定' } });
  assert.equal(controller.pendingNodeTransforms('別のUI').size, 0);
});

test('反映ボタンは全変更をbatch一回・onCommit一回へまとめる', async () => {
  const { controller, requests, commits } = await fixture();
  await controller.movePreviewElement([5, -4]); await controller.editPreviewProperty('text', '変更予定');
  await controller.applyPending();
  const mutations = requests.filter(row => row.route === 'edit');
  assert.equal(mutations.length, 1); assert.equal(mutations[0].payload.expectedRevision, 'r0');
  assert.equal(mutations[0].payload.operation.type, 'batch'); assert.equal(mutations[0].payload.operation.operations.length, 2);
  assert.equal(commits.length, 1); assert.equal(commits[0][1].type, 'batch');
  assert.equal(controller.pendingCount, 0); assert.equal(controller.state.revision, 'r1'); assert.equal(controller.previewBlocked(), false);
  assert.equal(controller.state.lastPendingCommit.count, 2);
  await controller.applyPending(); assert.equal(requests.filter(row => row.route === 'edit').length, 1, '空のキューを再送しない');
});

test('グループ移動は1回のundo/redoで全要素を戻し、別要素の仮配置も保持', async () => {
  const { controller, requests } = await fixture();
  const secondPointer = '/main/controls/1/other';
  const secondSelection = { ...selection('other'), pointer: secondPointer, effectivePointer: secondPointer };
  controller.queueOperations([move([2, 4]), { ...move([2, 4]), pointer: secondPointer, effectivePointer: secondPointer }],
    { label: 'グループ移動', previewSelections: [selection(), secondSelection] });
  assert.equal(controller.pendingCount, 2); assert.equal(controller.pendingNodeTransforms('preview:main').size, 2);
  await controller.history('undo'); assert.equal(controller.pendingCount, 0); assert.equal(controller.canRedoPending, true);
  await controller.history('redo'); assert.equal(controller.pendingCount, 2); assert.equal(requests.length, 0);
  assert.equal(controller.state.pendingOperations[0].groupId, controller.state.pendingOperations[1].groupId);
});

test('キューの値と選択情報は呼出元から切り離し、外部変更で確定内容を改変させない', async () => {
  const { controller } = await fixture();
  const operation = move([3, 4]), selected = selection();
  controller.queueOperations([operation], { previewSelections: [selected] });
  operation.delta[0] = 999; selected.nodeId = '別要素';
  assert.deepEqual(controller.state.pendingOperations[0].operation.delta, [3, 4]);
  assert.equal(controller.state.pendingOperations[0].previewSelection.nodeId, 'label');
});

test('undo後の新操作はredoを消去し、未反映の確定履歴との混在を防ぐ', async () => {
  const { controller, requests } = await fixture();
  await controller.movePreviewElement([3, 4]); controller.undoPending();
  await assert.rejects(controller.history('undo'), { code: 'WORKSPACE_PENDING_HISTORY_REQUIRED' });
  await controller.movePreviewElement([5, 6]); assert.equal(controller.canRedoPending, false);
  assert.equal(requests.length, 0);
});

test('削除後の同じ要素は拒否し、任意構造置換だけ末尾制約を維持する', async () => {
  const { controller } = await fixture();
  const remove = { type: 'delete', path, sourceId: 'pack', pointer, cascade: true };
  assert.throws(() => controller.queueOperations([remove, move()]), { code: 'WORKSPACE_PENDING_TARGET_DELETED' });
  assert.equal(controller.pendingCount, 0);
  controller.queueOperations([move(), remove]);
  await assert.rejects(controller.movePreviewElement([1, 0]), { code: 'WORKSPACE_PENDING_TARGET_DELETED' });
  assert.equal(controller.pendingCount, 2);
  controller.undoPending(); assert.equal(controller.pendingCount, 0);
  assert(isStructuralWorkspaceOperation({ type: 'set', path, pointer: '/main/controls', value: [] }));
  assert(isStructuralWorkspaceOperation({ type: 'set', path, pointer: '/main/controls/0/label', value: { type: 'panel' } }));
});

test('不正な数値は文字列・NaN・Infinity・疎配列から暗黙変換しない', async () => {
  const { controller, requests } = await fixture();
  for (const delta of [['2', 3], [NaN, 0], [Infinity, 0], new Array(2), [null, 0]]) await assert.rejects(controller.movePreviewElement(delta), { code: 'WORKSPACE_MOVE_INVALID' });
  await assert.rejects(controller.editPreviewProperty('alpha', NaN), { code: 'WORKSPACE_PENDING_VALUE_INVALID' });
  await assert.rejects(controller.editPreviewProperty('text', undefined), { code: 'WORKSPACE_PENDING_VALUE_INVALID' });
  assert.equal(controller.pendingCount, 0); assert.equal(requests.length, 0);
});

test('上限128件を超えるグループは途中まで追加せず全体を拒否', async () => {
  const { controller } = await fixture();
  controller.queueOperations(Array.from({ length: MAX_PENDING_OPERATIONS - 1 }, () => move()));
  assert.throws(() => controller.queueOperations([move(), move()]), { code: 'WORKSPACE_PENDING_LIMIT' });
  assert.equal(controller.pendingCount, MAX_PENDING_OPERATIONS - 1);
});

test('未反映の操作と原文草稿は相互に競合し、書出し・パック変更も保存せず拒否', async () => {
  const { controller, requests } = await fixture();
  await controller.movePreviewElement([1, 2]);
  assert.throws(() => controller.setDraft(path, '{}'), { code: 'WORKSPACE_UNAPPLIED_PENDING' });
  assert.throws(() => controller.applyDraft(), { code: 'WORKSPACE_UNAPPLIED_PENDING' });
  controller.selectExport({ filePath: path, rawKey: 'main', sourceId: 'pack' });
  await assert.rejects(controller.export(), { code: 'WORKSPACE_UNAPPLIED_PENDING' });
  await assert.rejects(controller.ensure([{ id: 'other' }], 'other'), { code: 'WORKSPACE_UNAPPLIED_PENDING' });
  assert.throws(() => controller.reset(), { code: 'WORKSPACE_UNAPPLIED_PENDING' });
  assert.equal(requests.length, 0);
  controller.discardPending(); controller.setDraft(path, '{}');
  await assert.rejects(controller.movePreviewElement([1, 2]), { code: 'WORKSPACE_UNAPPLIED_DRAFT' });
});

test('原文草稿は明示的なapplyDraftで即座に検証反映し、キューに入れない', async () => {
  const { controller, requests, commits } = await fixture();
  controller.setDraft(path, '{}'); await controller.applyDraft();
  assert.equal(requests.filter(row => row.route === 'edit').length, 1);
  assert.equal(requests.find(row => row.route === 'edit').payload.operation.type, 'replaceText');
  assert.equal(controller.pendingCount, 0); assert.equal(commits.length, 1);
});

test('バッチが明示拒否された場合は全操作を保持し、確定画面も停止しない', async () => {
  const { controller, requests, commits } = await fixture({ mutation: () => ({ ok: false, error: { code: 'EDIT_VALIDATION_FAILED', message: '不正な属性です' } }) });
  await controller.movePreviewElement([1, 2]);
  await assert.rejects(controller.applyPending(), { code: 'EDIT_VALIDATION_FAILED' });
  assert.equal(controller.pendingCount, 1); assert.equal(controller.state.pendingCommitUncertain, false);
  assert.equal(controller.previewBlocked(), false); assert.equal(commits.length, 0);
  await assert.rejects(controller.applyPending()); assert.equal(requests.filter(row => row.route === 'edit').length, 2, '既知拒否は修正後の再操作が可能');
});

test('revision競合は編集内容を保持し、再同期後の自動再送を拒否', async () => {
  const { controller, requests, changeRevision } = await fixture({ mutation: () => { throw Object.assign(new Error('WORKSPACE_REVISION_CONFLICT'), { status: 409, code: 'WORKSPACE_REVISION_CONFLICT' }); } });
  await controller.movePreviewElement([1, 2]); await assert.rejects(controller.applyPending());
  assert.equal(controller.state.pendingConflict, true); assert.equal(controller.state.pendingCommitUncertain, false);
  changeRevision('外部で変更'); await controller.refresh();
  assert.equal(controller.pendingNodeTransforms('preview:main').size, 0, '違うrevisionへ旧仮配置を重ねない');
  await assert.rejects(controller.applyPending(), { code: 'WORKSPACE_PENDING_REVISION_CONFLICT' });
  assert.equal(requests.filter(row => row.route === 'edit').length, 1);
});

test('応答欠落・形式不正・500エラー時はキューを保持し再送を禁止', async () => {
  for (const mutation of [() => { throw new Error('応答が失われました'); }, () => ({ ok: true }), () => null,
    () => { throw Object.assign(new Error('内部エラー'), { status: 500 }); }]) {
    const { controller, requests } = await fixture({ mutation });
    await controller.movePreviewElement([1, 2]); await assert.rejects(controller.applyPending());
    assert.equal(controller.state.pendingCommitUncertain, true); assert.equal(controller.pendingCount, 1);
    assert.equal(controller.previewBlocked(), true); assert.equal(controller.pendingNodeTransforms('preview:main').size, 0);
    await controller.refresh();
    await assert.rejects(controller.applyPending(), { code: 'WORKSPACE_PENDING_COMMIT_UNCERTAIN' });
    assert.equal(requests.filter(row => row.route === 'edit').length, 1, '同じrevisionのstatusだけで遅延POSTを再送しない');
    controller.discardPending(); assert.equal(controller.pendingCount, 0); assert.equal(controller.previewBlocked(), false);
  }
});

test('確定後にstatus/read/onCommitが失敗しても適用済みキューは再送しない', async () => {
  for (const failAfterCommit of ['status', 'read', 'onCommit']) {
    let fail = true;
    const { controller, requests } = await fixture({ failAfterCommit, onCommit: () => { if (failAfterCommit === 'onCommit' && fail) { fail = false; throw new Error('確定後の同期失敗'); } } });
    await controller.movePreviewElement([1, 2]); await assert.rejects(controller.applyPending(), /確定後の同期失敗/u);
    assert.equal(controller.pendingCount, 0); assert.equal(controller.state.lastPendingCommit.count, 1);
    assert.equal(controller.previewBlocked(), true);
    await controller.refresh(); await controller.applyPending();
    assert.equal(requests.filter(row => row.route === 'edit').length, 1);
  }
});

test('送信中の追加・破棄・二重反映を拒否し、cancelでは再送不明状態に移る', async () => {
  let start, stop;
  const started = new Promise(resolve => { start = resolve; });
  const { controller, requests } = await fixture({ mutation: () => { start(); return new Promise((_resolve, reject) => { stop = reject; }); } });
  await controller.movePreviewElement([1, 2]);
  const applying = controller.applyPending(), rejected = assert.rejects(applying, /中止/u); await started;
  await assert.rejects(controller.movePreviewElement([1, 2]), { code: 'WORKSPACE_BUSY' });
  assert.throws(() => controller.discardPending(), { code: 'WORKSPACE_BUSY' });
  await assert.rejects(controller.applyPending(), { code: 'WORKSPACE_BUSY' });
  controller.cancel(); assert.equal(requests.at(-1).signal.aborted, true); stop(new Error('中止')); await rejected;
  assert.equal(controller.state.pendingCommitUncertain, true); assert.equal(controller.pendingCount, 1);
});

test('古い要求の完了は強制reset後の新作業領域を変更しない', async () => {
  let release;
  const { controller } = await fixture({ mutation: ({ status }) => new Promise(resolve => { release = () => resolve({ ...status(), revision: 'r1' }); }) });
  await controller.movePreviewElement([1, 2]);
  const applying = controller.applyPending(), rejected = assert.rejects(applying, { code: 'WORKSPACE_SUPERSEDED' });
  controller.reset({ discardPending: true });
  release(); await rejected;
  assert.equal(controller.state.workspaceId, null); assert.equal(controller.pendingCount, 0); assert.equal(controller.state.projectionError, false);
});

test('操作全体モードは保持するが子画像だけの仮移動で誤表示しない', async () => {
  const { controller } = await fixture();
  controller.setEditOptions({ targetMode: 'interaction' });
  await controller.movePreviewElement([3, 4]);
  assert.equal(controller.state.pendingOperations[0].operation.targetMode, 'interaction');
  assert.equal(controller.pendingNodeTransforms('preview:main').size, 0);
});

test('既知の反復テンプレートでは同意なしのキュー追加を拒否し、取得済み計画を再通信しない', async () => {
  const { controller, requests } = await fixture();
  await controller.planPreviewEdit(); controller.state.editPlan.generated = true; controller.state.editPlan.affectedInstances = 27;
  const count = requests.length;
  await assert.rejects(controller.movePreviewElement([1, 2]), { code: 'WORKSPACE_GENERATED_SCOPE_REQUIRED' });
  assert.equal(controller.pendingCount, 0); assert.equal(requests.length, count);
  controller.setEditGeneratedTemplate(true); await controller.movePreviewElement([1, 2]);
  assert.equal(controller.state.pendingOperations[0].operation.generatedScope, 'template'); assert.equal(requests.length, count);
});

test('全変更破棄は未反映redoと仮表示も除去し、確定原文を保持', async () => {
  const { controller, requests } = await fixture(); const original = controller.getDocument().text;
  await controller.movePreviewElement([1, 2]); controller.undoPending(); controller.discardPending();
  assert.equal(controller.pendingCount, 0); assert.equal(controller.canRedoPending, false);
  assert.equal(controller.getDocument().text, original); assert.equal(requests.length, 0);
});


test('絶対offset設定は前の仮移動を置換し、その後のdeltaだけを加算する', async () => {
  const { controller } = await fixture();
  await controller.movePreviewElement([5, 6]);
  await controller.editPreviewProperty('offset', ['50% + 2px', 4]);
  await controller.movePreviewElement([1, 2]);
  assert.deepEqual(controller.pendingNodeTransforms('preview:main').get('label'), { dx: 1, dy: 2, deleted: false, properties: { offset: ['50% + 2px', 4] } });
});


test('pendingVersionはキュー・undo・redo・破棄・確定ごとに単調増加する', async () => {
  const { controller } = await fixture(); let previous = controller.state.pendingVersion;
  for (const action of [() => controller.movePreviewElement([1, 2]), () => controller.undoPending(), () => controller.redoPending(),
    () => controller.discardPending(), () => controller.movePreviewElement([1, 2]), () => controller.applyPending()]) {
    await action(); assert(controller.state.pendingVersion > previous); previous = controller.state.pendingVersion;
  }
});

test('互換APIの即時反映は明示manualApply:falseに限定し、製品既定は手動', async () => {
  const calls = [], response = { ok: true, workspaceId: 'w', revision: 'r0', files: [], nodes: [], sources: [] };
  const immediate = createWorkspaceEditor({ manualApply: false, request: async (route, payload) => { calls.push({ route, payload }); return response; } });
  await immediate.ensure([{ id: 'p' }], 'p'); calls.length = 0;
  await immediate.edit({ type: 'set', path: 'ui/a.json', pointer: '/a/text', value: '変更' });
  assert.equal(calls.filter(call => call.route === 'edit').length, 1); assert.equal(immediate.pendingCount, 0);
  assert.equal(createWorkspaceEditor({ request: async () => response }).state.manualApply, true);
});
