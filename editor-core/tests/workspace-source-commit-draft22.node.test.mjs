import test from 'node:test';
import assert from 'node:assert/strict';
import { captureWorkspaceSourceDrag, captureWorkspaceSourceCommitDraft, workspaceSourceCommitDraftInteraction } from '../src/ui/workspace-gesture14.js';

function fixture() {
  const current = { file: { id: 'screen', uiModel: {}, nodesById: {} }, revision: 'r0',
    layout: { boxes: [{ id: 'image', parentId: null, x: 10, y: 20, w: 20, h: 20 }] },
    context: 'frame0', view: { zoom: 2, viewX: 0, viewY: 0 }, pendingVersion: 4, selectionIds: ['image'] };
  const startBox = { x: 10, y: 20, w: 20, h: 20 }, draftBox = { ...startBox, x: 25, y: 17 };
  const snapshot = captureWorkspaceSourceDrag(current);
  const held = captureWorkspaceSourceCommitDraft(snapshot, { targetId: 'image', startBox, draftBox });
  return { current, startBox, draftBox, snapshot, held };
}

test('pointerup後に元gestureを消しても、計画応答待ちの移動位置を独立保持する', async () => {
  const { held, current, startBox, draftBox } = fixture();
  Object.assign(startBox, { x: 100 }); Object.assign(draftBox, { x: 200 });
  let finish;
  const awaitingPlan = new Promise(resolve => { finish = resolve; });
  const interaction = workspaceSourceCommitDraftInteraction(held, current);
  assert.equal(interaction.active, true); assert.equal(interaction.moved, true);
  assert.deepEqual(interaction.startBox, { x: 10, y: 20, w: 20, h: 20 });
  assert.deepEqual(interaction.draftBox, { x: 25, y: 17, w: 20, h: 20 });
  await Promise.resolve();
  assert.equal(workspaceSourceCommitDraftInteraction(held, current), interaction);
  finish(); await awaitingPlan;
});

test('queue通知直後はfinallyより先にghostを消し、保持移動を二重適用しない', () => {
  const { held, current } = fixture();
  assert.notEqual(workspaceSourceCommitDraftInteraction(held, current), null);
  assert.equal(workspaceSourceCommitDraftInteraction(held, { ...current, pendingVersion: 5 }), null);
  assert.equal(workspaceSourceCommitDraftInteraction(null, current), null, '失敗・終了時のfinallyでnull化可能');
});

test('対象確認待ち中の画面・配置・選択・倍率変更には旧ghostを重ねない', () => {
  const { held, current } = fixture();
  assert.notEqual(workspaceSourceCommitDraftInteraction(held, { ...current, layout: structuredClone(current.layout) }), null);
  for (const change of [
    { file: { ...current.file, uiModel: {} } }, { revision: 'r1' }, { context: 'frame1' },
    { layout: { boxes: [{ ...current.layout.boxes[0], x: 11 }] } }, { selectionIds: ['other'] },
    { view: { ...current.view, zoom: 3 } },
  ]) assert.equal(workspaceSourceCommitDraftInteraction(held, { ...current, ...change }), null);
});

test('保持対象の不一致・重複・非finite矩形を拒否する', () => {
  const { snapshot, startBox, draftBox } = fixture();
  for (const change of [
    { groupIds: ['other'] }, { groupIds: ['image', 'image'] }, { groupIds: new Array(1) },
    { targetId: '' }, { draftBox: { ...draftBox, x: Infinity } }, { startBox: { ...startBox, w: -1 } },
  ]) assert.throws(() => captureWorkspaceSourceCommitDraft(snapshot, { targetId: 'image', startBox, draftBox, ...change }), { code: 'WORKSPACE_SOURCE_COMMIT_DRAFT_INVALID' });
});
