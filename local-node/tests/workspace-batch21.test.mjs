import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WorkspaceSessions } from '../workspace-session.mjs';
import { buildScopedEditContext } from '../workspace-scoped-edit.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { pointerJoin, pointerParts } from '../workspace-jsonc.mjs';
import { createLocalServer } from '../server.mjs';
import { LIMITS } from '../limits.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { scoped20Documents, scoped20Cases } from './workspace-scoped20-fixtures.mjs';
const encode = values => Object.fromEntries(Object.entries(values).map(([path, value]) => [path, JSON.stringify(value)]));
const simple = () => encode({ 'ui/test.json': { namespace: 'a', root: { type: 'screen', controls: [
  { first: { type: 'image', offset: [1, 2] } }, { second: { type: 'label', text: '二番', offset: [4, 5] } },
] } } });
const identity = state => ({ workspaceId: state.workspaceId, expectedRevision: state.revision });
const at = (value, pointer) => pointerParts(pointer).reduce((current, key) => current?.[key], value);
const batch = operations => ({ type: 'batch', operations });
async function opened(documents = simple()) {
  let invalidations = 0;
  const manager = new WorkspaceSessions({ getPack: () => ({ packPaths: Object.keys(documents), rootPrefix: '',
    zipReader: { readText: async path => documents[path] } }), checkSources: sources => sources,
    invalidate: () => { invalidations++; } });
  const state = await manager.open({ sources: [{ id: 'pack', kind: 'imported' }] });
  return { manager, state, documents, invalidations: () => invalidations };
}
async function project(manager, id, symbol, preview = {}) {
  const workspace = manager.get(id);
  const context = await buildScopedEditContext({ documents: workspace.documents, documentSources: workspace.documentSources });
  const record = context.catalog.recordsById[context.catalog.symbols[symbol].winnerId];
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id, ...preview });
  assert.equal(projection.ok, true);
  return { context, record, projection };
}
async function move(manager, state, symbol, pointer, delta = [10, 20], extra = {}) {
  const { record, projection } = await project(manager, state.workspaceId, symbol, extra.preview);
  const source = projection.nodeSources[pointer]; assert(source, pointer);
  return { type: 'move', scope: 'screen', targetMode: 'visual', delta,
    screen: { path: record.filePath, sourceId: record.sourceId, pointer: pointerJoin([record.rawKey]) },
    path: source.path, sourceId: source.sourceId, pointer: source.pointer, effectivePointer: pointer, ...extra };
}
const snapshot = (manager, id) => { const item = manager.get(id); return JSON.stringify({ documents: item.documents,
  sources: item.sources, revision: item.revision, undo: item.undo, redo: item.redo, editCount: item.editCount, historyBytes: item.historyBytes }); };

for (const name of ['first', 'second']) test(`同一要素 ${name} の連続移動は差分を累積し1履歴`, async () => {
  const { manager, state, invalidations, documents } = await opened();
  const pointer = `/root/controls/${name === 'first' ? 0 : 1}/${name}`;
  const operation = await move(manager, state, 'a.root', pointer);
  const result = await manager.edit({ ...identity(state), operation: batch([operation, { ...operation, delta: [-2, 3] }]) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const value = at((await project(manager, state.workspaceId, 'a.root')).projection.document, pointer);
  assert.deepEqual(value.offset, (name === 'first' ? [1, 2] : [4, 5]).map((v, i) => v + [8, 23][i]));
  assert.equal(result.editCount, 1); assert.equal(manager.get(state.workspaceId).undo.length, 1); assert.equal(invalidations(), 1);
  const { validationCache, validationDurationMs, cacheReason, storageReason, storageEncoding, expandedBytes, jsonUtf8Bytes, retainedBytes, cacheEncodeMs, cacheDecodeMs, ...batchResult } = result.batch;
  assert.deepEqual(batchResult, { atomic: true, operationCount: 2, appliedCount: 2 });
  assert.equal(validationCache, 'miss');
  assert(Number.isFinite(validationDurationMs) && validationDurationMs >= 0);
  const undone = manager.history(identity(result), 'undo');
  assert.deepEqual(manager.get(state.workspaceId).documents, Object.assign(Object.create(null), documents));
  const redone = manager.history(identity(undone), 'redo'); assert.equal(redone.revision, result.revision);
});

test('異なる要素の移動と属性設定を全体1履歴にまとめる', async () => {
  const { manager, state } = await opened();
  const first = await move(manager, state, 'a.root', '/root/controls/0/first', [2, 3]);
  const second = await move(manager, state, 'a.root', '/root/controls/1/second', [-1, -2], { type: 'set', property: 'text', value: '変更後' });
  const result = await manager.edit({ ...identity(state), operation: batch([first, second]) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const controls = (await project(manager, state.workspaceId, 'a.root')).projection.document.root.controls;
  assert.deepEqual(controls[0].first.offset, [3, 5]); assert.equal(controls[1].second.text, '変更後');
});

test('継承元複製で原文キーが変わっても同一要素の次操作を対応付ける', async () => {
  const { manager, state } = await opened(scoped20Documents), fixture = scoped20Cases[0];
  const operation = await move(manager, state, fixture.screen, fixture.effectivePointer, [2, 3], { generatedScope: 'template' });
  const other = (await project(manager, state.workspaceId, 'fixture.screen_b')).projection.document;
  const result = await manager.edit({ ...identity(state), operation: batch([operation, { ...operation, delta: [4, 5] }]) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(at((await project(manager, state.workspaceId, fixture.screen)).projection.document, fixture.effectivePointer).offset, [6, 8]);
  assert.deepEqual((await project(manager, state.workspaceId, 'fixture.screen_b')).projection.document, other);
});

test('別の継承系統の3要素を開始revisionの選択から編集する', async () => {
  const { manager, state } = await opened(scoped20Documents);
  const operations = await Promise.all(scoped20Cases.map(item => move(manager, state, item.screen, item.effectivePointer, [3, 7], { generatedScope: 'template' })));
  const result = await manager.edit({ ...identity(state), operation: batch(operations) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const document = (await project(manager, state.workspaceId, 'fixture.screen_a')).projection.document;
  for (const fixture of scoped20Cases) assert.deepEqual(at(document, fixture.effectivePointer).offset, [3, 7]);
  assert.equal(manager.get(state.workspaceId).undo.length, 1);
});

test('同一原文のnormal/hover反復はtemplate同意を維持し逐次差分を適用', async () => {
  const { manager, state } = await opened(scoped20Documents), first = scoped20Cases[0].effectivePointer;
  const second = first.replace('/controls/0/default/', '/controls/1/hover/');
  const operations = await Promise.all([first, second].map(pointer => move(manager, state, 'fixture.screen_a', pointer, [1, 2], { generatedScope: 'template' })));
  const result = await manager.edit({ ...identity(state), operation: batch(operations) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const document = (await project(manager, state.workspaceId, 'fixture.screen_a')).projection.document;
  assert.deepEqual(at(document, first).offset, [2, 4]); assert.deepEqual(at(document, second).offset, [2, 4]);
});

for (const inherited of [false, true]) test(`後続無効値で全ロールバック（継承=${inherited}）`, async () => {
  const { manager, state, invalidations } = await opened(inherited ? scoped20Documents : simple());
  const operation = await move(manager, state, inherited ? 'fixture.screen_a' : 'a.root',
    inherited ? scoped20Cases[0].effectivePointer : '/root/controls/0/first', [1, 2], { generatedScope: 'template' });
  const before = snapshot(manager, state.workspaceId);
  const result = await manager.edit({ ...identity(state), operation: batch([operation, { ...operation, delta: [Infinity, 0] }]) });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_DELTA_INVALID');
  assert.equal(result.batch.failedOperationIndex, 1); assert.equal(result.batch.appliedCount, 0);
  assert.equal(result.documents, undefined); assert.equal(result.editPlan, undefined);
  assert.equal(snapshot(manager, state.workspaceId), before); assert.equal(invalidations(), 0);
});

test('stale選択は初期検査で拒否し先行操作も確定しない', async () => {
  const { manager, state, invalidations } = await opened();
  const operation = await move(manager, state, 'a.root', '/root/controls/0/first'), before = snapshot(manager, state.workspaceId);
  const result = await manager.edit({ ...identity(state), operation: batch([operation, { ...operation, pointer: '/root/controls/1/second' }]) });
  assert.equal(result.code, 'EDIT_SELECTION_STALE'); assert.equal(result.batch.failedOperationIndex, 1);
  assert.equal(snapshot(manager, state.workspaceId), before); assert.equal(invalidations(), 0);
});

test('Pocket選択とPocket再現変数は拒否', async () => {
  const { manager, state } = await opened(scoped20Documents);
  const first = await move(manager, state, 'fixture.screen_a', scoped20Cases[0].effectivePointer);
  for (const operation of [{ ...first, preview: { variables: { $pocket_screen: true } } },
    { ...first, screen: { path: 'ui/pocket/fixture_pocket.json', sourceId: 'pack', pointer: '/pocket_screen' },
      effectivePointer: first.effectivePointer.replace('/screen_a/', '/pocket_screen/') }]) {
    const result = await manager.edit({ ...identity(state), operation: batch([operation]) });
    assert.equal(result.code, 'EDIT_POCKET_PREVIEW_FORBIDDEN'); assert.equal(result.batch.appliedCount, 0);
  }
});

test('expectedRevision競合・128件上限・内部操作・入れ子を拒否', async () => {
  const { manager, state } = await opened();
  const operation = { type: 'set', path: 'ui/test.json', pointer: '/root/offset', value: [1, 2] };
  assert.throws(() => manager.edit({ ...identity(state), expectedRevision: 'stale', operation: batch([operation]) }), { code: 'WORKSPACE_REVISION_CONFLICT' });
  await assert.rejects(manager.edit({ ...identity(state), operation: batch(Array.from({ length: 129 }, () => operation)) }), { code: 'WORKSPACE_BATCH_LIMIT' });
  for (const operations of [[], [{ type: 'batch', operations: [operation] }], [{ type: 'replaceTexts', texts: {} }], [{ type: 'planEdit' }]])
    await assert.rejects(manager.edit({ ...identity(state), operation: batch(operations) }), error => /^WORKSPACE_BATCH_/u.test(error.code));
  const accepted = await manager.edit({ ...identity(state), operation: batch(Array.from({ length: 128 }, () => operation)) });
  assert.equal(accepted.ok, true); assert.equal(accepted.batch.operationCount, 128); assert.equal(accepted.editCount, 1);
});

test('registryを書き換える操作を一括でも受け付けない', async () => {
  const { manager, state } = await opened({ ...simple(), 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}' });
  await assert.rejects(manager.edit({ ...identity(state), operation: batch([
    { type: 'replaceText', path: 'ui/_ui_defs.json', text: '{"ui_defs":[]}' },
  ]) }), { code: 'WORKSPACE_UI_REGISTRY_READ_ONLY' });
});

for (const type of ['add', 'delete']) test(`移動後の末尾${type}を1履歴で適用しundoで両方取消`, async () => {
  const { manager, state, documents } = await opened();
  const operation = await move(manager, state, 'a.root', '/root/controls/0/first', [2, 3]);
  const last = type === 'add' ? { type, path: 'ui/test.json', pointer: '/root', name: 'third', value: { type: 'label', text: '追加' } }
    : { type, path: 'ui/test.json', pointer: '/root/controls/1/second', cascade: true };
  const result = await manager.edit({ ...identity(state), operation: batch([operation, last]) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const controls = (await project(manager, state.workspaceId, 'a.root')).projection.document.root.controls;
  assert.equal(controls.length, type === 'add' ? 3 : 1); assert.deepEqual(controls[0].first.offset, [3, 5]);
  manager.history(identity(result), 'undo'); assert.deepEqual(manager.get(state.workspaceId).documents, Object.assign(Object.create(null), documents));
});

test('構造変更後の操作および複数構造変更は処理前に拒否', async () => {
  const { manager, state, invalidations } = await opened();
  const operation = await move(manager, state, 'a.root', '/root/controls/0/first');
  for (const structural of [{ type: 'delete', path: 'ui/test.json', pointer: '/root/controls/1/second', cascade: true },
    { type: 'set', path: 'ui/test.json', pointer: '/root/controls', value: [] }, { ...operation, type: 'set', property: 'type', value: 'panel' }]) {
    const result = await manager.edit({ ...identity(state), operation: batch([structural, operation]) });
    assert.equal(result.code, 'EDIT_BATCH_STRUCTURE_LAST'); assert.equal(result.batch.failedOperationIndex, 0);
  }
  assert.equal(invalidations(), 0);
});

test('応答上限超過は変更を確定せず履歴も保持', async () => {
  const { manager, state, invalidations } = await opened();
  const operation = await move(manager, state, 'a.root', '/root/controls/0/first');
  const before = snapshot(manager, state.workspaceId), describe = manager.describe.bind(manager);
  manager.describe = workspace => ({ ...describe(workspace), testPadding: 'x'.repeat(LIMITS.replyBytes) });
  await assert.rejects(manager.edit({ ...identity(state), operation: batch([operation, operation]) }), { code: 'NODE_REPLY_LIMIT' });
  assert.equal(snapshot(manager, state.workspaceId), before); assert.equal(invalidations(), 0);
});

test('同時編集が先にcommitすれば古いasync batchは上書きしない', async () => {
  const { manager, state } = await opened(scoped20Documents);
  const operation = await move(manager, state, 'fixture.screen_a', scoped20Cases[0].effectivePointer, [1, 2], { generatedScope: 'template' });
  const promise = manager.edit({ ...identity(state), operation: batch([operation, operation]) });
  const concurrent = manager.edit({ ...identity(state), operation: { type: 'set', path: 'ui/fixture_screens.json', pointer: '/screen_b/offset', value: [12, 34] } });
  await assert.rejects(promise, { code: 'WORKSPACE_REVISION_CONFLICT' });
  assert.equal(manager.get(state.workspaceId).revision, concurrent.revision); assert.equal(manager.get(state.workspaceId).undo.length, 1);
});

test('HTTP: batch1回で確定し同revision再送409、undo1回で両変更取消', { timeout: 55000 }, async () => {
  const app = await createLocalServer({ port: 0 });
  try {
    const base = `http://127.0.0.1:${app.port}/api/node/`, { token } = await (await fetch(base + 'capabilities')).json();
    const post = async (route, payload) => { const response = await fetch(base + route, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jsonui-token': token }, body: JSON.stringify(payload) });
      return { status: response.status, data: await response.json() }; };
    const id = randomUUID(), bytes = makeZip({ 'manifest.json': manifest, ...simple() });
    const uploaded = await fetch(base + 'packs', { method: 'POST', headers: { 'content-type': 'application/zip',
      'content-length': String(bytes.length), 'x-jsonui-upload-id': id, 'x-jsonui-token': token }, body: bytes });
    assert.equal(uploaded.status, 200);
    const { data: state } = await post('workspace-open', { sources: [{ id, kind: 'imported' }] });
    const operation = batch([{ type: 'move', path: 'ui/test.json', pointer: '/root/controls/0/first', offset: [11, 12] },
      { type: 'set', path: 'ui/test.json', pointer: '/root/controls/1/second/text', value: 'HTTP変更' }]);
    const applied = await post('workspace-edit', { ...identity(state), operation });
    assert.equal(applied.status, 200); assert.equal(applied.data.ok, true, JSON.stringify(applied.data));
    assert.equal(applied.data.editCount, 1); assert.equal(applied.data.batch.operationCount, 2);
    const replay = await post('workspace-edit', { ...identity(state), operation }); assert.equal(replay.status, 409);
    const undone = await post('workspace-undo', identity(applied.data)); assert.equal(undone.status, 200); assert.equal(undone.data.revision, state.revision);
  } finally { await app.close(); }
});

test('128件の共有要素移動でもbatch内専用cloneを再利用し原文定義が増殖しない', async () => {
  const { manager, state } = await opened(scoped20Documents), fixture = scoped20Cases[0];
  const operation = await move(manager, state, fixture.screen, fixture.effectivePointer, [1, 2], { generatedScope: 'template' });
  const result = await manager.edit({ ...identity(state), operation: batch(Array.from({ length: 128 }, () => operation)) });
  assert.equal(result.ok, true, JSON.stringify(result));
  const plans = result.editPlan.operations.map(item => item.editPlan);
  assert(plans[0].clonedDefinitions.length > 0);
  for (const plan of plans.slice(1)) assert.equal(plan.clonedDefinitions.length, 0);
  assert.deepEqual(at((await project(manager, state.workspaceId, fixture.screen)).projection.document, fixture.effectivePointer).offset, [128, 256]);
  assert.equal(manager.get(state.workspaceId).undo.length, 1);
});

test('別screenの同じ共有原文は各screen専用cloneに分けて保持', async () => {
  const { manager, state } = await opened(scoped20Documents), fixture = scoped20Cases[0];
  const a = await move(manager, state, 'fixture.screen_a', fixture.effectivePointer, [3, 4], { generatedScope: 'template' });
  const bPointer = fixture.effectivePointer.replace('/screen_a/', '/screen_b/');
  const b = await move(manager, state, 'fixture.screen_b', bPointer, [7, 8], { generatedScope: 'template' });
  const result = await manager.edit({ ...identity(state), operation: batch([a, b, a]) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(at((await project(manager, state.workspaceId, 'fixture.screen_a')).projection.document, fixture.effectivePointer).offset, [6, 8]);
  assert.deepEqual(at((await project(manager, state.workspaceId, 'fixture.screen_b')).projection.document, bPointer).offset, [7, 8]);
});
