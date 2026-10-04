import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';

// サーバーの revision とクライアントを別々に保持する。成功済み POST の
// 応答欠落でも、リクエスト回数と確定内容から重複実行を検出できる。
async function fixture(mutate) {
  let revision = 'before', committedValue = 0;
  const mutations = [];
  const status = () => ({ ok: true, workspaceId: 'w', revision,
    files: [{ path: 'ui/demo.json', sourceId: 'pack', sourceKind: 'imported' }],
    sources: [{ id: 'pack', kind: 'imported' }], nodes: [] });
  const controller = createWorkspaceEditor({ request: async (route, payload) => {
    if (route === 'edit') {
      mutations.push(structuredClone(payload));
      return mutate({ attempt: mutations.length, commit() { revision = 'after'; committedValue++; }, status });
    }
    if (route === 'read') return { ...status(), path: payload.path, sourceId: payload.sourceId, text: '{"namespace":"demo","main":{"type":"screen"}}' };
    return status();
  } });
  await controller.ensure([{ id: 'pack', kind: 'imported' }], 'stack');
  controller.queueOperations([{ type: 'set', path: 'ui/demo.json', sourceId: 'pack', pointer: '/main/text', value: '変更' }]);
  return { controller, mutations, get committedValue() { return committedValue; } };
}

for (const failure of [
  { status: 499, code: 'NODE_JOB_CANCELLED' },
  { status: 413, code: 'NODE_REPLY_LIMIT' },
  { status: 400, code: 'NODE_OPERATION_FAILED' },
  { status: 422, code: 'EDIT_NEW_UNDOCUMENTED_CODE' },
  { status: 422 },
  { status: 408, code: 'EDIT_PROPERTY_INVALID' },
]) test(`commit 後の ${failure.status} / ${failure.code || 'コードなし'} は再同期しても再送しない`, async () => {
  const f = await fixture(({ commit }) => { commit(); throw Object.assign(new Error('反映応答を確定できない'), failure); });
  await assert.rejects(f.controller.applyPending());
  assert.equal(f.committedValue, 1);
  assert.equal(f.controller.state.revision, 'before');
  assert.equal(f.controller.pendingCount, 1);
  assert.equal(f.controller.state.pendingCommitUncertain, true);
  assert.equal(f.controller.previewBlocked(), true);
  await f.controller.refresh();
  assert.equal(f.controller.state.revision, 'after', '確定状態は status で観測できる');
  await assert.rejects(f.controller.applyPending(), { code: 'WORKSPACE_PENDING_COMMIT_UNCERTAIN' });
  assert.equal(f.mutations.length, 1, '改訂番号の照合だけを根拠に元の操作を再送しない');
  assert.equal(f.committedValue, 1);
});

test('既知 EDIT_PROPERTY_INVALID の真正 422 拒否だけは未確定と判断し手動再試行できる', async () => {
  const f = await fixture(({ attempt, commit, status }) => {
    if (attempt === 1) throw Object.assign(new Error('属性検証で拒否'), { status: 422, code: 'EDIT_PROPERTY_INVALID' });
    commit(); return status();
  });
  await assert.rejects(f.controller.applyPending(), { code: 'EDIT_PROPERTY_INVALID' });
  assert.equal(f.committedValue, 0); assert.equal(f.controller.pendingCount, 1);
  assert.equal(f.controller.state.pendingCommitUncertain, false);
  assert.equal(f.controller.previewBlocked(), false);
  await f.controller.applyPending();
  assert.equal(f.committedValue, 1); assert.equal(f.controller.pendingCount, 0);
  assert.equal(f.mutations.length, 2);
});

for (const reply of [
  { ok: false, error: { code: 'NODE_JOB_CANCELLED', status: 499 } },
  { ok: false, status: 499, error: { code: 'EDIT_PROPERTY_INVALID' } },
  { ok: false, error: { code: 'EDIT_NEW_UNDOCUMENTED_CODE' } },
]) test(`失敗 reply の ${JSON.stringify(reply.error)} も未知確定状態を checked() で失わない`, async () => {
  const f = await fixture(({ commit }) => { commit(); return reply; });
  await assert.rejects(f.controller.applyPending());
  assert.equal(f.controller.state.pendingCommitUncertain, true);
  await assert.rejects(f.controller.applyPending(), { code: 'WORKSPACE_PENDING_COMMIT_UNCERTAIN' });
  assert.equal(f.mutations.length, 1); assert.equal(f.committedValue, 1);
});
