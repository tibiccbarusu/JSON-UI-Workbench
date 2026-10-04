import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CliClient } from '../cli-client.mjs';
import { makeZip, manifest } from './fixtures.mjs';

test('UI登録表の変更拒否は実HTTPの原文・source・revision・undo/redoを変更しない', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jsonui-registry13-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryText = '{"ui_defs":["ui/a.json"]}';
  const input = path.join(directory, 'input.zip');
  await writeFile(input, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': registryText,
    'ui/a.json': '{"namespace":"a","screen":{"type":"panel"}}',
    'other/b.json': '{"namespace":"b","screen":{"type":"panel"}}' }));
  const client = await CliClient.start();
  t.after(() => client.close());
  const imported = await client.importPack(input);
  let workspace = await client.request('/api/node/workspace-open', { payload: { sources: [{ id: imported.id, kind: 'imported' }] } });
  const identity = state => ({ workspaceId: state.workspaceId, expectedRevision: state.revision });
  for (const value of [1, 2]) workspace = await client.request('/api/node/workspace-edit', { payload: {
    ...identity(workspace), operation: { type: 'set', path: 'ui/a.json', pointer: '/screen/offset', value: [value, 0] },
  } });
  workspace = await client.request('/api/node/workspace-undo', { payload: identity(workspace) });
  assert.equal(workspace.canUndo, true);
  assert.equal(workspace.canRedo, true);
  const read = file => client.request('/api/node/workspace-read', { payload: { workspaceId: workspace.workspaceId, path: file, sourceId: 'imported' } });
  const beforeState = await client.request('/api/node/workspace-status', { payload: { workspaceId: workspace.workspaceId } });
  const beforeUi = await read('ui/a.json');
  const beforeRegistry = await read('ui/_ui_defs.json');
  assert.equal(beforeRegistry.text, registryText);
  for (const operation of [
    { type: 'replaceText', path: 'ui/_ui_defs.json', sourceId: 'imported', text: '{"ui_defs":["other/b.json"]}' },
    { type: 'set', path: 'ui/_ui_defs.json', sourceId: imported.id, pointer: '/ui_defs', value: ['other/b.json'] },
  ]) {
    await assert.rejects(client.request('/api/node/workspace-edit', { payload: { ...identity(workspace), operation } }),
      error => error.code === 'WORKSPACE_UI_REGISTRY_READ_ONLY' && error.context?.http_status === 422);
    assert.deepEqual(await client.request('/api/node/workspace-status', { payload: { workspaceId: workspace.workspaceId } }), beforeState);
    assert.deepEqual(await read('ui/a.json'), beforeUi);
    assert.deepEqual(await read('ui/_ui_defs.json'), beforeRegistry);
  }
  // 拒否後も既存の通常UI編集履歴は機能する。
  workspace = await client.request('/api/node/workspace-redo', { payload: identity(workspace) });
  assert.deepEqual(JSON.parse((await read('ui/a.json')).text).screen.offset, [2, 0]);
  workspace = await client.request('/api/node/workspace-undo', { payload: identity(workspace) });
  assert.equal(workspace.revision, beforeState.revision);
  assert.equal((await read('ui/_ui_defs.json')).text, registryText);
});
