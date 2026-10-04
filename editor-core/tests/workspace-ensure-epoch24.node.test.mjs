import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';

test('旧workspaceのclose応答はreset後のworkspaceを消さず余分なopenも送らない', async () => {
  let releaseClose, closeStarted;
  const started = new Promise(resolve => { closeStarted = resolve; });
  const closing = new Promise(resolve => { releaseClose = resolve; });
  const opened = [];
  const controller = createWorkspaceEditor({ request: async (operation, value) => {
    if (operation === 'close') { closeStarted(); await closing; return { ok: true }; }
    assert.equal(operation, 'open');
    const id = value.sources[0].id; opened.push(id);
    return { ok: true, workspaceId: `workspace-${id}`, revision: id, files: [], nodes: [], sources: value.sources };
  } });
  await controller.ensure([{ id: 'first' }], 'first');
  const outdated = controller.ensure([{ id: 'old-request' }], 'old-request');
  const rejected = assert.rejects(outdated, { code: 'WORKSPACE_SUPERSEDED' });
  await started;
  controller.reset({ discardPending: true });
  await controller.ensure([{ id: 'new-request' }], 'new-request');
  releaseClose(); await rejected;
  assert.equal(controller.state.workspaceId, 'workspace-new-request');
  assert.equal(controller.state.revision, 'new-request');
  assert.deepEqual(opened, ['first', 'new-request']);
  assert.equal(controller.state.busy, false);
});
