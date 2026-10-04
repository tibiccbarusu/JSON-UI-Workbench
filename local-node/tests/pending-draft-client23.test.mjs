import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceDraftPreview23 } from '../../editor-core/src/ui/workspace-draft-preview23.js';
import { createWorkspaceEditIntent } from '../../editor-core/src/ui/workspace-edit-intent.js';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = version => ({ workspaceId: 'w', expectedRevision: 'r', pendingVersion: version,
  screen: { path: 'ui/a.json', pointer: '/screen' }, operation: { type: 'batch', operations: [] } });
const answer = value => ({ ok: true, baseRevision: value.expectedRevision, pendingVersion: value.pendingVersion, projection: { boxes: [] } });

test('連続入力をまとめ最新世代だけNodeへ送り、確定版番号を変更しない', async () => {
  let value = snapshot(1); const calls = [];
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value, delayMs: 10,
    project: async request => { calls.push(request); return answer(request); } });
  client.request(); value = snapshot(2); client.request(); value = snapshot(3); client.request();
  await wait(35);
  assert.deepEqual(calls.map(row => row.pendingVersion), [3]);
  assert.equal(client.getResult().pendingVersion, 3); assert.equal(value.expectedRevision, 'r');
  client.cancel();
});

test('旧世代の遅い応答が到着しても巻き戻さず次の最新版を処理する', async () => {
  let value = snapshot(1), finish; const calls = [];
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value, delayMs: 0,
    project: request => { calls.push(request); return new Promise(resolve => { finish = () => resolve(answer(request)); }); } });
  const old = client.flush(); await wait(1);
  value = snapshot(2); client.request(); finish(); await old;
  assert.equal(client.getResult(), null);
  await wait(5); assert.equal(calls.length, 2); finish(); await wait(1);
  assert.equal(client.getResult().pendingVersion, 2); assert.equal(client.getStatus().superseded, 1);
  client.cancel();
});

test('破棄後の応答、版番号不一致、通信失敗を表示へ公開しない', async () => {
  let value = snapshot(1);
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value,
    project: async request => ({ ...answer(request), baseRevision: '別版' }) });
  await client.flush(); assert.equal(client.getResult(), null); assert.equal(client.getStatus().status, 'error');
  assert.equal(client.getStatus().error.code, 'WORKSPACE_DRAFT_RESPONSE_INVALID');
  value = null; client.cancel(); assert.equal(client.getResult(), null);
});

test('応答が来ない場合は時間制限で停止し自動の無限再試行をしない', async () => {
  let calls = 0;
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => snapshot(1), timeoutMs: 12,
    project: () => { calls++; return new Promise(() => {}); } });
  await client.flush();
  assert.equal(client.getStatus().error.code, 'WORKSPACE_DRAFT_TIMEOUT');
  assert.equal(client.getStatus().timedOut, 1); assert.equal(calls, 1);
  await wait(20); assert.equal(calls, 1); client.cancel();
});

test('同じ番号でも画面が変われば旧画面の応答を使用しない', async () => {
  let value = snapshot(1), finish; const calls = [];
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value, delayMs: 0,
    project: request => { calls.push(request); return new Promise(resolve => { finish = () => resolve(answer(request)); }); } });
  const old = client.flush(); await wait(1);
  value = { ...snapshot(1), screen: { path: 'ui/b.json', pointer: '/screen' } }; client.request();
  finish(); await old; await wait(5); assert.equal(calls.length, 2);
  assert.equal(client.getResult(), null); finish(); await wait(1);
  assert.equal(client.getResult().pendingVersion, 1); client.cancel();
});

test('取消直後に同じ編集世代を再要求しても中止済み通信を再利用しない', async () => {
  const value = snapshot(1), calls = []; let finish;
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value, delayMs: 0,
    project: request => { calls.push(request); return new Promise(resolve => { finish = () => resolve(answer(request)); }); } });
  const old = client.flush(); await wait(1); client.cancel(); client.request();
  finish(); await old; await wait(5);
  assert.equal(calls.length, 2); assert.equal(client.getResult(), null);
  finish(); await wait(1); assert.equal(client.getResult().pendingVersion, 1); client.cancel();
});

test('未反映の画面限定操作を共有元へ付け替えず、scope変更だけを明示拒否する', () => {
  const state = { busy: false, editScope: 'screen', editTargetMode: 'visual', pendingOperations: [{ operation: { type: 'move', scope: 'screen' } }] };
  const before = structuredClone(state.pendingOperations);
  const intent = createWorkspaceEditIntent({ state, request: async () => {}, notify() {} });
  assert.throws(() => intent.setOptions({ scope: 'shared' }), { code: 'WORKSPACE_PENDING_SCOPE_CHANGE' });
  assert.equal(state.editScope, 'screen'); assert.deepEqual(state.pendingOperations, before);
  intent.setOptions({ targetMode: 'interaction' }); assert.equal(state.editTargetMode, 'interaction');
  state.pendingOperations = []; intent.setOptions({ scope: 'shared' }); assert.equal(state.editScope, 'shared');
});
