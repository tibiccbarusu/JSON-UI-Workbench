import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalServer } from '../../local-node/server.mjs';
import { makeZip, manifest } from '../../local-node/tests/fixtures.mjs';
import { createWorkspaceEditor, escapeSourcePointer, findAuthoredNodeForPreview, workspacePreviewDefinitionIdentity } from '../src/ui/workspace-editor.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';

test('実HTTP controller: 移動→連続削除→移動→追加を1確定、undo/redo、書き出し', { timeout: 55000 }, async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const { token } = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': token, 'Content-Type': 'application/json' };
  const packId = randomUUID(), path = 'ui/sequence.json';
  const original = JSON.stringify({ namespace: 'demo', main: { type: 'screen', controls: [
    { first: { type: 'label', text: '先頭', offset: [0, 0], size: [20, 10] } },
    { second: { type: 'label', text: '中央', offset: [10, 0], size: [20, 10] } },
    { third: { type: 'label', text: '残す', offset: [20, 0], size: [20, 10] } },
  ] }, other: { type: 'screen', controls: [{ unchanged: { type: 'panel', size: [1, 1] } }] } });
  const upload = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip',
    'X-JSONUI-Upload-ID': packId, 'X-JSONUI-Name': 'pending-structure22.mcpack' }, body: makeZip({
    'manifest.json': manifest, 'ui/_ui_defs.json': JSON.stringify({ ui_defs: [path] }), [path]: original,
  }) });
  assert.equal(upload.status, 200); await upload.arrayBuffer();
  const requests = [], commits = [];
  const post = async (route, payload, options = {}) => {
    requests.push({ route, payload: structuredClone(payload) });
    const reply = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(payload), signal: options.signal });
    if (reply.ok && options.blob && !(reply.headers.get('content-type') || '').includes('application/json')) return reply.blob();
    const result = await reply.json();
    if (!reply.ok) throw Object.assign(new Error(result.error?.message || result.error), { code: result.error?.code || result.error || result.code, status: reply.status });
    return result;
  };
  const controller = createWorkspaceEditor({ request: (route, payload, options) => post(`workspace-${route}`, payload, options),
    onCommit: async (_status, operation) => { commits.push(operation); } });
  await controller.ensure([{ id: packId, kind: 'imported' }], 'sequence');
  await controller.readDocument(path, { sourceId: packId });
  const initialRevision = controller.state.revision;
  const catalog = await post('catalog', { sources: controller.state.sources });
  const record = catalog.records.find(row => row.qualifiedName === 'demo.main');
  const projection = await post('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
  const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: path });
  const file = { id: `screen:${path}`, path, uiModel, ...buildTreeFromUiScreenModel(uiModel), meta: {
    selectedDefinition: { ...projection.selected, rawKey: record.rawKey }, previewProjection: true,
    resolution: { nodeSources: projection.nodeSources },
  } };
  const nodeId = Object.keys(file.nodesById).find(id => id.endsWith('/third'));
  const target = findAuthoredNodeForPreview({ file, nodeId, nodes: controller.state.nodes, sourceId: packId, sources: controller.state.sources });
  assert(target);
  await controller.selectPreviewTarget(target, { fileId: file.id, nodeId, previewDefinitionId: workspacePreviewDefinitionIdentity(file),
    effectivePointer: target.previewPointer, screen: { path, pointer: `/${escapeSourcePointer(record.rawKey)}`, sourceId: packId } });
  // 選択時の読取専用計画を済ませ、各編集自体は通信しないことを検査する。
  await controller.planPreviewEdit();
  const baselineRequests = requests.length;
  await controller.movePreviewElement([7, -3]);
  await controller.edit({ type: 'delete', path, sourceId: packId, pointer: '/main/controls/0/first', cascade: true });
  await controller.edit({ type: 'delete', path, sourceId: packId, pointer: '/main/controls/1/second', cascade: true });
  await controller.movePreviewElement([7, -3]);
  await controller.edit({ type: 'add', path, sourceId: packId, parentPointer: '/main', name: 'new_panel_1', value: { type: 'panel', size: [30, 10] } });
  assert.equal(controller.pendingCount, 5);
  assert.equal(requests.length, baselineRequests, '反映前の各編集で通信・再計算しない');
  assert.equal(controller.state.revision, initialRevision);
  await controller.applyPending();
  const mutations = requests.filter(row => row.route === 'workspace-edit' && row.payload.operation.type !== 'planEdit');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].payload.operation.pointerBasis, 'base-revision');
  assert.equal(mutations[0].payload.operation.operations[2].pointer, '/main/controls/1/second');
  assert.equal(commits.length, 1);
  assert.equal(controller.pendingCount, 0);
  const after = controller.getDocument(path, packId).text;
  const parsed = JSON.parse(after);
  assert.deepEqual(parsed.main.controls.map(row => Object.keys(row)[0]), ['third', 'new_panel_1']);
  assert.deepEqual(parsed.main.controls[0].third.offset, [34, -6]);
  assert.deepEqual(parsed.other, JSON.parse(original).other);
  await controller.history('undo');
  assert.equal(controller.getDocument(path, packId).text, original);
  await controller.history('redo');
  assert.equal(controller.getDocument(path, packId).text, after);
  controller.selectExport({ filePath: path, rawKey: 'main', sourceId: packId });
  const plan = await controller.export('plan');
  assert.equal(plan.ok, true);
  const blob = await controller.export('zip');
  assert(blob instanceof Blob); assert(blob.size > 0);
});
