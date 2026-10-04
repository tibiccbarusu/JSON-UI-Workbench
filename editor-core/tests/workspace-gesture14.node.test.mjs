import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';
import { resumeWorkspacePreviewAfterDraft, captureWorkspaceSourceDrag, isWorkspaceSourceDragCurrent } from '../src/ui/workspace-gesture14.js';

test('手入力で原文通りへ戻すと、失効済みプレビューフレームを再要求する', async () => {
  const text = '{"namespace":"demo","root":{"type":"screen"}}';
  const state = { ok: true, workspaceId: 'workspace', revision: 'r0', files: [{ path: 'ui/demo.json' }], nodes: [], sources: [] };
  let pauses = 0, requestedFrames = 0;
  const controller = createWorkspaceEditor({ request: async operation => operation === 'read' ? { ...state, text } : state,
    onChange: (_state, kind) => { if (kind === 'draft') resumeWorkspacePreviewAfterDraft(controller, {
      pause() { pauses++; }, requestFrame() { requestedFrames++; },
    }); },
  });
  await controller.ensure([{ kind: 'vanilla', id: 'p' }], 'p'); await controller.readDocument('ui/demo.json');
  controller.setDraft('ui/demo.json', text + ' ');
  assert.equal(controller.previewBlocked(), true); assert.equal(requestedFrames, 0);
  controller.setDraft('ui/demo.json', text);
  assert.equal(controller.getDraft().dirty, false); assert.equal(controller.previewBlocked(), false);
  assert.equal(requestedFrames, 1); assert.equal(pauses, 2);
  controller.state.projectionError = true;
  controller.setDraft('ui/demo.json', text);
  assert.equal(requestedFrames, 1, '別の停止理由を原文復元で解除しない');
});

test('別ファイルに未適用草稿が残る間は手入力復元でフレームを要求しない', async () => {
  const text = '{}';
  const state = { ok: true, workspaceId: 'workspace', revision: 'r0', files: [{ path: 'ui/a.json' }, { path: 'ui/b.json' }], nodes: [], sources: [] };
  let requestedFrames = 0;
  const controller = createWorkspaceEditor({ request: async operation => operation === 'read' ? { ...state, text } : state });
  await controller.ensure([{ kind: 'vanilla', id: 'p' }], 'p');
  await controller.readDocument('ui/a.json'); await controller.readDocument('ui/b.json');
  controller.setDraft('ui/a.json', '{'); controller.setDraft('ui/b.json', '{'); controller.setDraft('ui/b.json', '{}');
  resumeWorkspacePreviewAfterDraft(controller, { pause() {}, requestFrame() { requestedFrames++; } });
  assert.equal(requestedFrames, 0);
});

test('ドラッグ開始配置と終了配置を混ぜた移動量を保存せず、配置・倍率変更を拒否する', () => {
  const file = { id: 'screen', uiModel: {}, nodesById: {} };
  const layout = { boxes: [{ id: 'label', x: 10, y: 8, w: 50, h: 20 }] };
  const current = { file, revision: 'r0', layout, context: 'frame0', view: { zoom: 1, viewX: 0, viewY: 0 } };
  const snapshot = captureWorkspaceSourceDrag(current);
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...current, file: { ...file, validation: { ok: true } } }), true);
  const draftBox = { x: 15, y: 8 };
  const updatedLayout = { boxes: [{ id: 'label', x: 50, y: 8, w: 60, h: 20 }] };
  assert.equal(draftBox.x - layout.boxes[0].x, 5);
  assert.equal(draftBox.x - updatedLayout.boxes[0].x, -35, '修正前に起き得る混在deltaを再現');
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...current, layout: updatedLayout }), false);
  for (const modified of [
    { ...current, context: 'frame1' }, { ...current, revision: 'r1' },
    { ...current, file: { ...file, uiModel: {} } },
    { ...current, view: { ...current.view, zoom: 2 } },
    { ...current, view: { ...current.view, viewX: 1 } },
    { ...current, view: { ...current.view, viewY: -1 } },
  ]) assert.equal(isWorkspaceSourceDragCurrent(snapshot, modified), false);
  assert.equal(isWorkspaceSourceDragCurrent(null, current), false);
});

test('原文revisionと確定配置が同じでも保留操作の追加・Undo・破棄を跨ぐドラッグは拒否する', () => {
  const file = { id: 'screen', uiModel: {}, nodesById: {} };
  const current = { file, revision: 'r0', layout: { boxes: [{ id: 'label', x: 10, y: 8, w: 50, h: 20 }] },
    context: 'frame0', view: { zoom: 2, viewX: 5, viewY: -3 }, pendingVersion: 7 };
  const snapshot = captureWorkspaceSourceDrag(current);
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...current, layout: structuredClone(current.layout) }), true,
    '同じ保留世代の同値フレーム再取得は操作を失効させない');
  for (const pendingVersion of [8, 9, 10]) {
    assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...current, pendingVersion }), false,
      '原文確定前の仮配置だけが変わっても、古い移動は保存しない');
  }
  const next = { ...current, pendingVersion: 10 };
  assert.equal(isWorkspaceSourceDragCurrent(captureWorkspaceSourceDrag(next), next), true,
    '最新の状態から開始し直したドラッグは使える');
});

test('ドラッグ中の選択集合変更では別要素を動かさず、開始対象を独立保持する', () => {
  const selectionIds = ['a', 'b'];
  const current = { file: { id: 'screen', uiModel: {}, nodesById: {} }, revision: 'r0',
    layout: { boxes: [] }, context: 'frame0', view: { zoom: 1, viewX: 0, viewY: 0 }, selectionIds };
  const snapshot = captureWorkspaceSourceDrag(current);
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...current, selectionIds: ['a', 'b'] }), true);
  selectionIds.push('c');
  assert.deepEqual(snapshot.selectionIds, ['a', 'b']);
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, current), false);
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...current, selectionIds: [] }), false);
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...current, selectionIds: ['a', 'c'] }), false);
});
