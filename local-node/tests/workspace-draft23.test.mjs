import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CliClient } from '../cli-client.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jui-draft23-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = await CliClient.start(); t.after(() => client.close());
  const file = path.join(directory, 'draft.mcpack');
  await writeFile(file, makeZip({ 'manifest.json': manifest,
    'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/base.json', 'ui/test.json'] }),
    'ui/base.json': JSON.stringify({ namespace: 'base', panel: { type: 'panel', ...origin, size: [60, 40],
      controls: [{ original: { type: 'panel', ...origin, size: [8, 8], offset: [3, 4] } }] } }),
    'ui/test.json': JSON.stringify({ namespace: 'test', 'screen@base.panel': { type: 'screen' },
      pocket: { type: 'screen', $pocket_screen: true } }) }));
  const loaded = await client.importPack(file), call = (action, data) => client.request(`/api/node/${action}`, { payload: data });
  const state = await call('workspace-open', { sources: [{ id: loaded.id, kind: 'imported' }] });
  assert(state.ok);
  const base = { workspaceId: state.workspaceId, expectedRevision: state.revision, pendingVersion: 1,
    screen: { path: 'ui/test.json', pointer: '/screen@base.panel', sourceId: loaded.id },
    frame: { preset: { width: 80, height: 60 }, generation: 1, animationTime: 0, visibilityMode: 'safe' } };
  const draft = operations => call('workspace-preview-draft', { ...base,
    operation: { type: 'batch', pointerBasis: 'base-revision', operations } });
  return { state, call, base, draft };
}

test('draft move/add/anchor layout runs in Node without committing source, history, or existing projection', { timeout: 60000 }, async t => {
  const api = await setup(t);
  const catalog = await api.call('workspace-catalog', { workspaceId: api.state.workspaceId });
  const record = catalog.records.find(record => record.qualifiedName === 'test.screen');
  const projected = await api.call('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
  const readBefore = await api.call('workspace-read', { workspaceId: api.state.workspaceId, path: 'ui/base.json' });
  const result = await api.draft([
    { type: 'move', path: 'ui/base.json', pointer: '/panel/controls/0/original', offset: [22, 12] },
    { type: 'add', path: 'ui/base.json', parentPointer: '/panel', name: 'added', value: {
      type: 'panel', anchor_from: 'bottom_right', anchor_to: 'bottom_right', size: ['50%', 10], offset: [-2, -3] } },
  ]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.committed, false); assert.equal(result.baseRevision, api.state.revision);
  assert.notEqual(result.draftRevision, api.state.revision); assert.equal(result.pendingVersion, 1);
  const original = result.frame.layout.boxes.find(box => box.id.endsWith('/original'));
  const added = result.frame.layout.boxes.find(box => box.id.endsWith('/added'));
  assert.deepEqual([original.x, original.y], [22, 12]);
  assert.deepEqual([added.x, added.y, added.w, added.h], [28, 27, 30, 10]);
  const after = await api.call('workspace-status', { workspaceId: api.state.workspaceId });
  assert.equal(after.revision, api.state.revision); assert.equal(after.canUndo, false); assert.equal(after.editCount, 0);
  assert.equal((await api.call('workspace-read', { workspaceId: api.state.workspaceId, path: 'ui/base.json' })).text, readBefore.text);
  const retained = await api.call('frame', { ...api.base.frame, projectionId: projected.nodeProjectionId, filePath: record.filePath });
  assert.deepEqual(retained.layout.boxes.filter(box => box.id.endsWith('/original')).map(box => [box.x, box.y]), [[3, 4]]);
  assert(!retained.layout.boxes.some(box => box.id.endsWith('/added')));
});

test('draft validation failure returns operation details and leaves all source bytes unchanged', { timeout: 60000 }, async t => {
  const api = await setup(t), before = await api.call('workspace-read', { workspaceId: api.state.workspaceId, path: 'ui/base.json' });
  const result = await api.draft([{ type: 'move', path: 'ui/base.json', pointer: '/panel/controls/0/original', offset: [20, 20] },
    { type: 'delete', path: 'ui/base.json', pointer: '/does-not-exist' }]);
  assert.equal(result.ok, false); assert.equal(result.batch.appliedCount, 0);
  const after = await api.call('workspace-read', { workspaceId: api.state.workspaceId, path: 'ui/base.json' });
  assert.equal(after.text, before.text); assert.equal(after.revision, before.revision);
});

test('draft endpoint rejects stale revisions, invalid versions and Pocket screens', { timeout: 60000 }, async t => {
  const api = await setup(t), operation = { type: 'batch', pointerBasis: 'base-revision', operations: [
    { type: 'move', path: 'ui/base.json', pointer: '/panel/controls/0/original', offset: [6, 7] }] };
  for (const [patch, code] of [
    [{ expectedRevision: 'stale' }, 'WORKSPACE_REVISION_CONFLICT'],
    [{ pendingVersion: -1 }, 'WORKSPACE_DRAFT_VERSION_INVALID'],
    [{ screen: { path: 'ui/test.json', pointer: '/pocket' } }, 'POCKET_PREVIEW_BLOCKED'],
    [{ frame: { ...api.base.frame, modelId: 'forbidden' } }, 'WORKSPACE_DRAFT_FRAME_INVALID'],
  ]) await assert.rejects(() => api.call('workspace-preview-draft', { ...api.base, operation, ...patch }), error => error.code === code);
  assert.equal((await api.call('workspace-status', { workspaceId: api.state.workspaceId })).revision, api.state.revision);
});
