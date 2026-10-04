import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';

const path = 'ui/demo.json';
const target = { path, sourceId: 'pack', pointer: '/screen/controls/0/a', nodeId: 'a', fileId: 'view', screen: { path, sourceId: 'pack', pointer: '/screen' } };
function fixture({ deferRead = false } = {}) {
  const calls = []; let release;
  const state = { ok: true, workspaceId: 'ws', revision: 'r0', sources: [{ id: 'pack', kind: 'imported' }], files: [{ path, sourceId: 'pack' }], nodes: [{ ...target, rawKey: 'a', props: {} }] };
  const controller = createWorkspaceEditor({ request: async (route) => {
    calls.push(route);
    if (route === 'read') {
      if (deferRead) await new Promise(resolve => { release = resolve; });
      return { ...state, path, sourceId: 'pack', text: '{"screen":{}}' };
    }
    return state;
  } });
  return { controller, calls, release: () => release() };
}
test('原文選択解除はpreview対象・削除予定・記憶を消し、未反映操作と元原文を保持する', async () => {
  const { controller: c, calls } = fixture(); await c.ensure([{ id: 'pack' }], 'key');
  await c.readDocument(path, { sourceId: 'pack' }); await c.selectPreviewTarget(target, target);
  c.queueOperations([{ type: 'move', ...target, delta: [3, 4] }]);
  c.state.deletePlan = { revision: 'r0' }; const before = JSON.stringify(c.state.pendingOperations);
  const text = c.getDocument().text; calls.length = 0;
  c.selectPointer('');
  assert.equal(c.state.selectedPointer, ''); assert.equal(c.state.previewSelection, null); assert.equal(c.state.deletePlan, null);
  assert.equal(c.state.selectionMemory.get(JSON.stringify(['pack', path])), '');
  assert.equal(JSON.stringify(c.state.pendingOperations), before); assert.equal(c.getDocument().text, text);
  assert.deepEqual(calls, []);
});
test('原文選択解除後に古い非同期選択readが到着しても旧対象を復元しない', async () => {
  const { controller: c, release } = fixture({ deferRead: true }); await c.ensure([{ id: 'pack' }], 'key');
  const pending = c.selectPreviewTarget(target, target);
  c.selectPointer('', path, 'pack'); release();
  await assert.rejects(pending, { code: 'WORKSPACE_READ_SUPERSEDED' });
  assert.equal(c.state.selectedPointer, ''); assert.equal(c.state.previewSelection, null); assert.equal(c.state.documents.size, 0);
});
