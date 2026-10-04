import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { WorkspaceSessions } from '../workspace-session.mjs';
import { createLocalServer } from '../server.mjs';
import { LIMITS } from '../limits.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const MiB = 1024 * 1024;
const digest = text => createHash('sha256').update(text).digest('hex');
const padded = (target, namespace) => {
  const text = JSON.stringify({ namespace, screen: { type: 'panel' } });
  return text + '/*' + 'a'.repeat(target - text.length - 4) + '*/';
};
function fixture(documents) {
  let invalidations = 0;
  const manager = new WorkspaceSessions({
    getPack: () => ({ packPaths: Object.keys(documents), rootPrefix: '',
      zipReader: { readText: async path => documents[path] } }),
    checkSources: sources => sources,
    invalidate: () => { invalidations++; },
  });
  return { manager, invalidations: () => invalidations };
}
function snapshot(manager, id) {
  const workspace = manager.get(id);
  return {
    revision: workspace.revision, editCount: workspace.editCount, historyBytes: workspace.historyBytes,
    documents: Object.entries(workspace.documents).map(([path, text]) => [path, digest(text)]),
    sources: digest(JSON.stringify(workspace.sources)),
    undo: workspace.undo.map(entry => [entry.before, entry.after, entry.bytes]),
    redo: workspace.redo.map(entry => [entry.before, entry.after, entry.bytes]),
  };
}
const identity = state => ({ workspaceId: state.workspaceId, expectedRevision: state.revision });
const move = value => ({ type: 'set', path: 'ui/small.json', pointer: '/screen/offset', value: [value, 0] });

test('総原文32MiBを超える編集は413となり本文・revision・履歴・層を変更しない', async () => {
  const documents = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
    `ui/${index}.json`, padded(8 * MiB - 1024, 'n' + index),
  ]));
  documents['ui/small.json'] = padded(100, 'small');
  const { manager, invalidations } = fixture(documents);
  let state = await manager.open({ sources: [{ id: 'pack', kind: 'vanilla' }] });
  state = manager.edit({ ...identity(state), operation: move(1) });
  state = manager.history(identity(state), 'undo');
  const before = snapshot(manager, state.workspaceId), beforeInvalidations = invalidations();
  assert.equal(state.canRedo, true);
  assert.throws(() => manager.edit({ ...identity(state), operation: {
    type: 'replaceText', path: 'ui/small.json', text: padded(8192, 'small'),
  } }), error => error.code === 'WORKSPACE_TEXT_LIMIT' && error.status === 413);
  assert.deepEqual(snapshot(manager, state.workspaceId), before);
  assert.equal(invalidations(), beforeInvalidations);
  assert.equal(manager.get(state.workspaceId).documents['ui/small.json'], documents['ui/small.json']);
});

test('応答32MiBを超えるopenはセッション枠を消費しない', async () => {
  const documents = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
    `ui/file${index}.json`, JSON.stringify({ namespace: 'large' + index, screen: { type: 'label', text: 'a'.repeat(5 * MiB) } }),
  ]));
  const { manager, invalidations } = fixture(documents);
  const overrides = Object.fromEntries(Object.entries(documents).slice(0, 3));
  assert(Object.values(overrides).reduce((sum, text) => sum + Buffer.byteLength(text), 0) < LIMITS.jsonBytes);
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(manager.open({ sources: [{ id: 'pack' + attempt, kind: 'imported', overrides }] }),
      error => error.code === 'NODE_REPLY_LIMIT' && error.status === 413);
    assert.equal(manager.sessions.size, 0);
  }
  assert.equal(invalidations(), 0);
});

test('undo/redoの応答拒否は両履歴stackと層所有を交換しない', async () => {
  const { manager, invalidations } = fixture({ 'ui/small.json': padded(100, 'small') });
  let state = await manager.open({ sources: [{ id: 'pack', kind: 'vanilla' }] });
  state = manager.edit({ ...identity(state), operation: move(1) });
  state = manager.edit({ ...identity(state), operation: move(2) });
  state = manager.history(identity(state), 'undo');
  const before = snapshot(manager, state.workspaceId), beforeInvalidations = invalidations();
  // Every historic state was accepted originally. Inject an oversized response
  // to exercise the later boundary without fabricating historic source edits.
  const describe = manager.describe.bind(manager);
  manager.describe = workspace => ({ ...describe(workspace), auditPadding: 'x'.repeat(LIMITS.replyBytes) });
  for (const direction of ['undo', 'redo']) {
    assert.throws(() => manager.history(identity(state), direction),
      error => error.code === 'NODE_REPLY_LIMIT' && error.status === 413);
    assert.deepEqual(snapshot(manager, state.workspaceId), before);
    assert.equal(invalidations(), beforeInvalidations);
  }
});

test('履歴会計はundoとredoの総量を維持し新編集でredoの量を除外する', async () => {
  const { manager } = fixture({ 'ui/small.json': padded(100, 'small') });
  let state = await manager.open({ sources: [{ id: 'pack', kind: 'vanilla' }] });
  const check = () => {
    const workspace = manager.get(state.workspaceId);
    assert.equal(workspace.historyBytes, [...workspace.undo, ...workspace.redo].reduce((sum, entry) => sum + entry.bytes, 0));
    assert(workspace.historyBytes <= state.limits.historyBytes);
    assert(workspace.undo.length + workspace.redo.length <= state.limits.historyEntries);
  };
  for (let index = 0; index < 70; index++) { state = manager.edit({ ...identity(state), operation: move(index) }); check(); }
  assert.equal(manager.get(state.workspaceId).undo.length, 64);
  const retainedBytes = manager.get(state.workspaceId).historyBytes;
  for (let index = 0; index < 5; index++) { state = manager.history(identity(state), 'undo'); check(); }
  assert.equal(manager.get(state.workspaceId).historyBytes, retainedBytes);
  for (let index = 0; index < 2; index++) { state = manager.history(identity(state), 'redo'); check(); }
  assert.equal(manager.get(state.workspaceId).historyBytes, retainedBytes);
  const oldRedo = manager.get(state.workspaceId).redo.length;
  state = manager.edit({ ...identity(state), operation: move(1000) });
  check(); assert.equal(oldRedo, 3); assert.equal(manager.get(state.workspaceId).redo.length, 0);
});

test('実ZIP/HTTP:巨大textの応答拒否で編集は確定せず原本とundo/redoを保全する', { timeout: 55000 }, async () => {
  const app = await createLocalServer({ port: 0 });
  try {
    const base = `http://127.0.0.1:${app.port}/api/node/`;
    const { token } = await (await fetch(base + 'capabilities')).json();
    const post = async (route, payload) => {
      const response = await fetch(base + route, { method: 'POST', headers: {
        'content-type': 'application/json', 'x-jsonui-token': token }, body: JSON.stringify(payload) });
      return { status: response.status, data: await response.json() };
    };
    const files = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
      `ui/file${index}.json`, JSON.stringify({ namespace: 'large' + index, screen: { type: 'label', text: 'a'.repeat(5 * MiB) } }),
    ]));
    const bytes = makeZip({ 'manifest.json': manifest, ...files });
    const id = randomUUID();
    const upload = await fetch(base + 'packs', { method: 'POST', headers: {
      'content-type': 'application/zip', 'content-length': String(bytes.length),
      'x-jsonui-upload-id': id, 'x-jsonui-token': token }, body: bytes });
    assert.equal(upload.status, 200, await upload.text());
    let { data: state } = await post('workspace-open', { sources: [{ id, kind: 'imported' }] });
    for (let index = 0; index < 2; index++) {
      const result = await post('workspace-edit', { ...identity(state), operation: {
        type: 'set', path: `ui/file${index}.json`, pointer: '/screen/offset', value: [index + 1, 0],
      } });
      assert.equal(result.status, 200); state = result.data;
    }
    const beforeSources = digest(JSON.stringify(state.sources));
    const rejected = await post('workspace-edit', { ...identity(state), operation: {
      type: 'set', path: 'ui/file2.json', pointer: '/screen/offset', value: [3, 0],
    } });
    assert.equal(rejected.status, 413); assert.equal(rejected.data.error, 'NODE_REPLY_LIMIT');
    const after = await post('workspace-status', { workspaceId: state.workspaceId });
    assert.equal(after.status, 200);
    assert.equal(after.data.revision, state.revision); assert.equal(after.data.editCount, state.editCount);
    assert.equal(after.data.canUndo, state.canUndo); assert.equal(after.data.canRedo, state.canRedo);
    assert.equal(digest(JSON.stringify(after.data.sources)), beforeSources);
    const read = await post('workspace-read', { workspaceId: state.workspaceId, path: 'ui/file2.json' });
    assert.equal(read.status, 200); assert.equal(read.data.text, files['ui/file2.json']);
    const raw = await fetch(base + `packs/${id}/read?path=ui/file2.json&maxBytes=${8 * MiB}`, { headers: { 'x-jsonui-token': token } });
    assert.equal(raw.status, 200); assert.equal(digest(Buffer.from(await raw.arrayBuffer())), digest(files['ui/file2.json']));
    const undone = await post('workspace-undo', identity(state));
    assert.equal(undone.status, 200); assert.equal(undone.data.canRedo, true);
    const redone = await post('workspace-redo', identity(undone.data));
    assert.equal(redone.status, 200); assert.equal(redone.data.revision, state.revision);
    assert.equal(digest(JSON.stringify(redone.data.sources)), beforeSources);
  } finally { await app.close(); }
});
