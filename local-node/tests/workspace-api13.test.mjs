import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalServer } from '../server.mjs';
import { makeZip, manifest } from './fixtures.mjs';

async function withApi(task) {
  const app = await createLocalServer({ port: 0 });
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const { token } = await (await fetch(base + 'capabilities')).json();
  const post = async (route, payload) => {
    const response = await fetch(base + route, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-jsonui-token': token }, body: JSON.stringify(payload) });
    const data = response.headers.get('content-type')?.startsWith('application/zip')
      ? Buffer.from(await response.arrayBuffer()) : await response.json();
    return { status: response.status, data };
  };
  const upload = async files => {
    const bytes = Buffer.isBuffer(files) ? files : makeZip({ 'manifest.json': manifest, ...files });
    const id = randomUUID();
    const response = await fetch(base + 'packs', { method: 'POST', headers: {
      'content-type': 'application/zip', 'content-length': String(bytes.length),
      'x-jsonui-upload-id': id, 'x-jsonui-token': token }, body: bytes });
    assert.equal(response.status, 200, await response.text());
    return id;
  };
  try { await task({ post, upload, token, base }); } finally { await app.close(); }
}

const singleFiles = {
  'ui/_ui_defs.json': '{"ui_defs":["ui/base.json","ui/screen.json"]}',
  'ui/base.json': '{"namespace":"base","panel":{"type":"panel","size":[100,60]}}',
  'ui/screen.json': '// 原文コメント\r\n{"namespace":"demo","screen@base.panel":{"controls":[{"box":{"type":"panel","offset":[0,0],"size":[20,10]}}]},"other":{"type":"panel","size":[1,1]}}\r\n',
};

test('HTTP: バニラ単体で編集→再投影→undo/redo→限定ZIP再読込が接続する', async () => withApi(async ({ post, upload }) => {
  const id = await upload(singleFiles);
  let { data: state } = await post('workspace-open', { sources: [{ id, kind: 'vanilla' }] });
  assert.equal(state.ok, true); assert.equal(state.files.length, 3);
  const workspaceId = state.workspaceId, initialRevision = state.revision;
  const read = await post('workspace-read', { workspaceId, path: 'ui/screen.json' });
  assert.equal(read.data.text, singleFiles['ui/screen.json']);
  assert(read.data.nodes.some(node => node.pointer === '/screen@base.panel/controls/0/box'));
  ({ data: state } = await post('workspace-edit', { workspaceId, expectedRevision: state.revision,
    operation: { type: 'set', path: 'ui/screen.json', pointer: '/screen@base.panel/controls/0/box/offset', value: ['50% + 12px', 3] } }));
  assert.equal(state.ok, true);
  let { data: catalog } = await post('workspace-catalog', { workspaceId });
  const record = catalog.records.find(item => item.qualifiedName === 'demo.screen');
  const { data: projected } = await post('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
  assert.equal(projected.ok, true);
  assert.deepEqual(projected.document.screen.controls[0].box.offset, ['50% + 12px', 3]);
  ({ data: state } = await post('workspace-undo', { workspaceId, expectedRevision: state.revision }));
  assert.equal(state.revision, initialRevision); assert.equal(state.canRedo, true);
  assert.deepEqual(state.sources[0].overrides, {});
  ({ data: state } = await post('workspace-redo', { workspaceId, expectedRevision: state.revision }));
  const exported = await post('workspace-export', { workspaceId, expectedRevision: state.revision, mode: 'zip',
    selections: [{ filePath: 'ui/screen.json', definition: 'demo.screen' }] });
  assert.equal(exported.status, 200); assert(Buffer.isBuffer(exported.data), JSON.stringify(exported.data));
  const reimported = await upload(exported.data);
  ({ data: catalog } = await post('catalog', { sources: [{ id: reimported, kind: 'imported' }] }));
  assert(!catalog.records.some(item => item.qualifiedName === 'demo.other'));
  const after = await post('project', { catalogId: catalog.nodeCatalogId,
    recordId: catalog.records.find(item => item.qualifiedName === 'demo.screen').id });
  assert.deepEqual(after.data.document, projected.document);
}));

test('HTTP: 不正草稿と古いrevisionは原文を変更せず、削除もundoできる', async () => withApi(async ({ post, upload }) => {
  const id = await upload(singleFiles);
  const { data: state } = await post('workspace-open', { sources: [{ id, kind: 'imported' }] });
  const identity = { workspaceId: state.workspaceId, expectedRevision: state.revision };
  const bad = await post('workspace-edit', { ...identity, operation: { type: 'replaceText', path: 'ui/screen.json', text: '{' } });
  assert.equal(bad.data.ok, false); assert.equal(bad.data.previewAllowed, false);
  const same = await post('workspace-read', { workspaceId: state.workspaceId, path: 'ui/screen.json' });
  assert.equal(same.data.text, singleFiles['ui/screen.json']);
  const conflict = await post('workspace-edit', { ...identity, expectedRevision: 'stale', operation: {} });
  assert.equal(conflict.status, 409); assert.equal(conflict.data.error, 'WORKSPACE_REVISION_CONFLICT');
  const deletion = { type: 'delete', path: 'ui/base.json', pointer: '/panel', cascade: true };
  const plan = await post('workspace-edit', { ...identity, operation: { ...deletion, type: 'planDelete' } });
  assert.equal(plan.data.ok, true); assert(plan.data.deletePlan.count >= 3);
  const done = await post('workspace-edit', { ...identity, operation: deletion });
  assert.equal(done.data.ok, true);
  const { data: catalog } = await post('workspace-catalog', { workspaceId: state.workspaceId });
  assert.deepEqual(catalog.records.map(item => item.qualifiedName), ['demo.other']);
  const undone = await post('workspace-undo', { workspaceId: state.workspaceId, expectedRevision: done.data.revision });
  assert.equal(undone.data.revision, state.revision);
}));

test('HTTP: 二層の別ファイルの連鎖削除は元の層へ適用し下位定義を復活させない', async () => withApi(async ({ post, upload }) => {
  const lower = await upload({ 'ui/base.json': singleFiles['ui/base.json'] });
  const upper = await upload({ 'ui/screen.json': singleFiles['ui/screen.json'] });
  const { data: state } = await post('workspace-open', { sources: [{ id: lower, kind: 'vanilla' }, { id: upper, kind: 'imported' }] });
  const done = await post('workspace-edit', { workspaceId: state.workspaceId, expectedRevision: state.revision,
    operation: { type: 'delete', path: 'ui/base.json', pointer: '/panel', cascade: true } });
  assert.equal(done.data.ok, true);
  assert(done.data.sources.find(source => source.kind === 'vanilla').overrides['ui/base.json']);
  const { data: catalog } = await post('workspace-catalog', { workspaceId: state.workspaceId });
  assert.deepEqual(catalog.records.map(item => item.qualifiedName), ['demo.other']);
}));

test('HTTP: パック変更はworkspaceを無効化し、無認証操作は拒否する', async () => withApi(async ({ post, upload, base }) => {
  const id = await upload(singleFiles);
  const { data: state } = await post('workspace-open', { sources: [{ id, kind: 'vanilla' }] });
  const unauthorized = await fetch(base + 'workspace-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: state.workspaceId }) });
  assert.equal(unauthorized.status, 401);
  await upload({ 'ui/new.json': '{"namespace":"new","screen":{"type":"panel"}}' });
  assert.equal((await post('workspace-read', { workspaceId: state.workspaceId })).status, 404);
}));

test('HTTP: textures/uiはUI原文へ混ぜず、登録したルート外UIと別層を扱う', async () => withApi(async ({ post, upload }) => {
  const lower = await upload({
    'ui/_ui_defs.json': '{"ui_defs":["custom/base.json","screen.json"]}',
    'custom/base.json': '{"namespace":"base","panel":{"type":"panel"}}',
    'ui/screen.json': '{"namespace":"demo","screen@base.panel":{"type":"panel"}}',
    'ui/draft.json': '{',
    'textures/ui/Banners.json': '{"nineslice_size":2,"base_size":[16,16]}',
  });
  const upper = await upload({
    'ui/extra.json': '{"namespace":"extra","label":{"type":"label","text":"before"}}',
    'textures/ui/Banners.json': '{"nineslice_size":[2,2,2,2]}',
  });
  const { data: state } = await post('workspace-open', { sources: [{ id: lower, kind: 'vanilla' }, { id: upper, kind: 'imported' }] });
  assert.equal(state.ok, true);
  assert.deepEqual(state.files.map(file => file.path).sort(), ['custom/base.json', 'ui/_ui_defs.json', 'ui/extra.json', 'ui/screen.json']);
  const changed = await post('workspace-edit', { workspaceId: state.workspaceId, expectedRevision: state.revision,
    operation: { type: 'set', path: 'ui/extra.json', pointer: '/label/text', value: 'after' } });
  assert.equal(changed.data.ok, true, JSON.stringify(changed.data));
  const { data: catalog } = await post('workspace-catalog', { workspaceId: state.workspaceId });
  const projected = await post('project', { catalogId: catalog.nodeCatalogId,
    recordId: catalog.records.find(record => record.qualifiedName === 'extra.label').id });
  assert.equal(projected.data.document.label.text, 'after');
}));

test('HTTP: 同名ファイルの下位自己継承を層別編集し、連鎖削除後に復活させない', async () => withApi(async ({ post, upload }) => {
  const path = 'ui/layered.json';
  const lowerText = '{"namespace":"layered","base":{"type":"panel","size":[120,60]},"leaf@layered.base":{"offset":[1,2]}}';
  const upperText = '{"namespace":"layered","base@layered.base":{"offset":[3,4]},"upper_only":{"type":"panel"}}';
  const lower = await upload({ [path]: lowerText }), upper = await upload({ [path]: upperText });
  let { data: state } = await post('workspace-open', { sources: [{ id: lower, kind: 'vanilla' }, { id: upper, kind: 'imported' }] });
  assert.equal(state.ok, true); assert.equal(state.workspaceValid, true, JSON.stringify(state.diagnostics));
  const initial = state.revision, workspaceId = state.workspaceId;
  assert.deepEqual(state.files.map(file => file.sourceId).sort(), [lower, upper].sort());
  const readLower = await post('workspace-read', { workspaceId, path, sourceId: 'vanilla-reference' });
  assert.equal(readLower.data.text, lowerText); assert.equal(readLower.data.sourceId, lower);
  const readUpper = await post('workspace-read', { workspaceId, path });
  assert.equal(readUpper.data.text, upperText); assert.equal(readUpper.data.sourceId, upper);
  ({ data: state } = await post('workspace-edit', { workspaceId, expectedRevision: state.revision,
    operation: { type: 'set', sourceId: lower, path, pointer: '/base/size', value: [140,70] } }));
  assert.equal(state.ok, true, JSON.stringify(state)); assert.notEqual(state.revision, initial);
  assert(state.sources.find(source => source.id === lower).overrides[path]);
  assert.deepEqual(state.sources.find(source => source.id === upper).overrides, {});
  let { data: catalog } = await post('workspace-catalog', { workspaceId });
  const preview = await post('project', { catalogId: catalog.nodeCatalogId,
    recordId: catalog.records.find(record => record.rawKey === 'base@layered.base').id });
  assert.equal(preview.data.ok, true); assert.deepEqual(preview.data.document.base.size, [140,70]);
  assert.deepEqual(preview.data.document.base.offset, [3,4]);
  const plan = await post('workspace-edit', { workspaceId, expectedRevision: state.revision,
    operation: { type: 'planDelete', sourceId: upper, path, pointer: '/base@layered.base' } });
  assert.equal(plan.data.ok, true, JSON.stringify(plan.data));
  assert.deepEqual([...new Set(plan.data.deletePlan.removals.map(node => node.sourceId))].sort(), [lower, upper].sort());
  assert(plan.data.deletePlan.affected.every(node => node.path === path));
  const deleted = await post('workspace-edit', { workspaceId, expectedRevision: state.revision,
    operation: { type: 'delete', sourceId: upper, path, pointer: '/base@layered.base', cascade: true } });
  assert.equal(deleted.data.ok, true, JSON.stringify(deleted.data));
  ({ data: catalog } = await post('workspace-catalog', { workspaceId }));
  assert.deepEqual(catalog.records.map(record => record.qualifiedName), ['layered.upper_only']);
  const restored = await post('workspace-undo', { workspaceId, expectedRevision: deleted.data.revision });
  assert.equal(restored.data.revision, state.revision);
  assert.equal((await post('workspace-read', { workspaceId, path, sourceId: upper })).data.text, upperText);
  const original = await post('workspace-undo', { workspaceId, expectedRevision: restored.data.revision });
  assert.equal(original.data.revision, initial);
  assert(original.data.sources.every(source => Object.keys(source.overrides).length === 0));
}));
