import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceDraftPreview23 } from '../../editor-core/src/ui/workspace-draft-preview23.js';

const snapshot = () => ({ workspaceId: 'workspace', expectedRevision: 'revision', pendingVersion: 3,
  screen: { path: 'ui/screen.json', pointer: '/screen' }, preview: {},
  operation: { type: 'batch', operations: [{ type: 'move', delta: [10, 0] }] },
  frame: { generation: 3, preset: { width: 480, height: 270 }, mockData: {} } });
const answer = value => ({ ok: true, baseRevision: value.expectedRevision, pendingVersion: value.pendingVersion,
  frame: { width: value.frame.preset.width } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('同一草稿の時間切れ後に通常通知が繰り返されても再送せず、明示再計算で復帰する', { timeout: 1000 }, async t => {
  const value = snapshot(); let calls = 0;
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value, delayMs: 0, timeoutMs: 12,
    project: request => ++calls === 1 ? new Promise(() => {}) : Promise.resolve(answer(request)) });
  t.after(() => client.cancel());
  await client.flush();
  assert.equal(client.getStatus().error.code, 'WORKSPACE_DRAFT_TIMEOUT');
  await Promise.all([client.request(), client.request(), client.request()]);
  await wait(25);
  assert.equal(calls, 1);
  assert.equal(client.getStatus().retryRequired, true);
  assert.equal(client.getStatus().suppressedRetries, 3);
  assert.equal(client.getResult(), null);
  const result = await client.flush();
  assert.equal(calls, 2); assert.equal(result.pendingVersion, 3);
  assert.equal(client.getStatus().retryRequired, false);
  assert.equal(client.getStatus().status, 'ready');
});

test('一時的な通信失敗後でも新しい編集世代は自動計算できる', { timeout: 1000 }, async t => {
  let value = snapshot(), calls = 0;
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value, delayMs: 0,
    project: async request => { if (++calls === 1) throw new Error('temporary'); return answer(request); } });
  t.after(() => client.cancel());
  await client.flush(); assert.equal(client.getStatus().status, 'error');
  value = { ...value, pendingVersion: 4 };
  await client.request(); await wait(15);
  assert.equal(calls, 2); assert.equal(client.getResult().pendingVersion, 4);
  assert.equal(client.getStatus().retryRequired, false);
});

for (const [field, change] of [
  ['frame.preset', value => { value.frame = { ...value.frame, preset: { width: 720, height: 405 } }; }],
  ['frame.mockData', value => { value.frame = { ...value.frame, mockData: { '#caption': '変更後' } }; }],
  ['frame.collectionData', value => { value.frame = { ...value.frame, collectionData: { items: [{ count: 2 }] } }; }],
  ['variables', value => { value.variables = { '$text': '変更後' }; }],
  ['representativeCollections', value => { value.representativeCollections = { items: [1, 2] }; }],
]) test(`同じ草稿番号でも ${field} の変化後に旧応答を再利用しない`, { timeout: 1000 }, async t => {
  let value = snapshot(), calls = 0;
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value, delayMs: 0,
    project: async request => { calls++; return answer(request); } });
  t.after(() => client.cancel());
  const first = await client.flush(); assert.equal(calls, 1);
  value = structuredClone(value); change(value);
  assert.equal(client.getResult(), null);
  const second = await client.flush();
  assert.equal(calls, 2); assert.notEqual(second, first);
});

test('送信中に表示条件が同じオブジェクト上で変わっても旧応答を公開しない', { timeout: 1000 }, async t => {
  const value = snapshot(); let finish;
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value, delayMs: 0,
    project: request => new Promise(resolve => { const result = answer(request); finish = () => resolve(result); }) });
  t.after(() => client.cancel());
  const pending = client.flush(); await wait(1);
  value.frame.preset.width = 960;
  finish(); await pending;
  assert.equal(client.getResult(), null);
  assert.equal(client.getStatus().completed, 0);
  assert.equal(client.getStatus().superseded, 1);
});

test('破棄後は同じ草稿番号の再要求も一時失敗の記録に遮られない', { timeout: 1000 }, async t => {
  const value = snapshot(); let calls = 0;
  const client = createWorkspaceDraftPreview23({ readSnapshot: () => value, delayMs: 0,
    project: async request => { if (++calls === 1) throw new Error('temporary'); return answer(request); } });
  t.after(() => client.cancel());
  await client.flush(); client.cancel();
  await client.request(); await wait(15);
  assert.equal(calls, 2); assert.equal(client.getStatus().status, 'ready');
});
