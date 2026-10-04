import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalServer } from '../../local-node/server.mjs';
import { makeZip, manifest } from '../../local-node/tests/fixtures.mjs';
import { createWorkspaceEditor, escapeSourcePointer, findAuthoredNodeForPreview, workspacePreviewDefinitionIdentity } from '../src/ui/workspace-editor.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';
import pngModule from '../../local-node/vendor/pngjs/lib/png.js';

const commonText = JSON.stringify({ namespace: 'common', close_button: { type: 'button', size: [21, 21], offset: [10, 20], button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: 'button.close' }], controls: [
  { default: { type: 'image', size: [18, 18], offset: [2, 3], texture: 'textures/ui/close' } },
  { hover: { type: 'image', size: [18, 18], offset: [2, 3], texture: 'textures/ui/close_hover' } },
] }, base_screen: { type: 'screen', controls: [{ 'close@common.close_button': {} }] } });
const screenText = JSON.stringify({ namespace: 'sample', 'main@common.base_screen': {}, 'chest@common.base_screen': {} });
const rootKey = (projection, name = 'main') => Object.keys(projection.document).find(key => key.split('@')[0] === name);
const child = (projection, name = 'main') => { const root = projection.document[rootKey(projection, name)]; return root.controls[0][Object.keys(root.controls[0])[0]]; };

async function setup(t) {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const cap = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' }, packId = randomUUID();
  const response = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': packId, 'X-JSONUI-Name': 'intent20.zip' }, body: makeZip({
    'manifest.json': manifest, 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/common.json', 'ui/sample.json'] }),
    'ui/common.json': commonText, 'ui/sample.json': screenText,
    'textures/ui/close.png': pngModule.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([255, 255, 255, 255]) }),
    'textures/ui/close_hover.png': pngModule.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([128, 128, 128, 255]) }),
  }) });
  assert.equal(response.status, 200); await response.arrayBuffer();
  const requests = [];
  const post = async (route, payload, options = {}) => {
    requests.push({ route, payload });
    const reply = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(payload), signal: options.signal });
    if (reply.ok && options.blob && !(reply.headers.get('content-type') || '').includes('application/json')) return reply.blob();
    const result = await reply.json();
    if (!reply.ok) throw Object.assign(new Error(result.error?.message || result.error), { code: result.error?.code || result.error || result.code, status: reply.status });
    return result;
  };
  let file;
  const project = async name => {
    const catalog = await post('catalog', { sources: controller.state.sources });
    const record = catalog.records.find(row => row.qualifiedName === `sample.${name}`);
    assert(record, `定義 ${name} がある`);
    const projection = await post('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
    return { ...projection, selected: { ...projection.selected, rawKey: record.rawKey } };
  };
  const projectMain = async () => {
    const projection = await project('main');
    const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: 'ui/sample.json' });
    file = { id: 'screen:ui/sample.json', path: 'ui/sample.json', uiModel, ...buildTreeFromUiScreenModel(uiModel),
      meta: { selectedDefinition: projection.selected, previewProjection: true, resolution: { nodeSources: projection.nodeSources } } };
    return projection;
  };
  const selectVisual = async () => {
    const nodeId = Object.keys(file.nodesById).find(id => id.endsWith('/default'));
    const source = findAuthoredNodeForPreview({ file, nodeId, nodes: controller.state.nodes, sourceId: packId, sources: controller.state.sources });
    assert(source, '表示部品に原文の対応がある');
    return controller.selectPreviewTarget(source, { fileId: file.id, nodeId, previewDefinitionId: workspacePreviewDefinitionIdentity(file),
      effectivePointer: source.previewPointer, screen: { path: file.path, pointer: `/${escapeSourcePointer(file.meta.selectedDefinition.rawKey)}`, sourceId: packId } });
  };
  const controller = createWorkspaceEditor({ request: (route, payload, options) => post('workspace-' + route, payload, options),
    onCommit: async () => { await projectMain(); await selectVisual(); } });
  await controller.ensure([{ id: packId, kind: 'imported' }], 'fixture');
  await projectMain(); await selectVisual();
  const reimport = async blob => {
    const id = randomUUID();
    const uploaded = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id, 'X-JSONUI-Name': 'exported.mcpack' }, body: blob });
    assert.equal(uploaded.status, 200); await uploaded.arrayBuffer();
    const catalog = await post('catalog', { sources: [{ id, kind: 'imported' }] });
    const results = {};
    for (const name of ['main', 'chest']) {
      const record = catalog.records.find(row => row.qualifiedName === `sample.${name}`);
      assert(record); results[name] = await post('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
    }
    return results;
  };
  return { controller, project, projectMain, post, packId, requests, reimport };
}


test('実HTTP: 継承された画像の連続編集を手動batchで反映し、別UIと操作親を保持', { timeout: 30000 }, async t => {
  const { controller, project, post, packId, requests } = await setup(t);
  const beforeRevision = controller.state.revision;
  assert.equal(controller.state.editTargetMode, 'visual');
  const plan = await controller.planPreviewEdit(); assert.equal(plan.promoted, false); assert.equal(plan.target.type, 'image');
  const beforeCount = requests.length;
  await controller.movePreviewElement([5, -4]); await controller.movePreviewElement([2, 3]);
  await controller.editPreviewProperty('alpha', 0.5);
  assert.equal(requests.length, beforeCount, '個別編集では一切通信しない');
  assert.equal(controller.state.revision, beforeRevision);
  assert.deepEqual(child(await project('main')).controls[0].default.offset, [2, 3], '反映前の確定原文は不変');
  await controller.applyPending();
  const batchRequests = requests.filter(row => row.route === 'workspace-edit' && row.payload.operation.type === 'batch');
  assert.equal(batchRequests.length, 1); assert.equal(batchRequests[0].payload.operation.operations.length, 3);
  const main = child(await project('main')), chest = child(await project('chest'), 'chest');
  assert.deepEqual(main.offset, [10, 20]); assert.deepEqual(main.controls[0].default.offset, [9, 2]);
  assert.equal(main.controls[0].default.alpha, 0.5); assert.deepEqual(main.controls[1].hover.offset, [2, 3]);
  assert.deepEqual(chest.controls[0].default.offset, [2, 3]);
  const raw = await post('workspace-read', { workspaceId: controller.state.workspaceId, sourceId: packId, path: 'ui/common.json' });
  assert.deepEqual(JSON.parse(raw.text).close_button, JSON.parse(commonText).close_button);
  assert.equal(controller.pendingCount, 0);
  await controller.history('undo'); assert.deepEqual(child(await project('main')).controls[0].default.offset, [2, 3]);
  await controller.history('redo'); assert.deepEqual(child(await project('main')).controls[0].default.offset, [9, 2]);
});

test('実HTTP: 同一batchの後半失敗は前半も確定せず全キューを保持', { timeout: 30000 }, async t => {
  const { controller, project, packId } = await setup(t);
  const beforeRevision = controller.state.revision;
  await controller.movePreviewElement([5, -4]);
  await controller.edit({ type: 'delete', path: 'ui/common.json', sourceId: packId, pointer: '/存在しない要素', cascade: true });
  await assert.rejects(controller.applyPending());
  assert.equal(controller.pendingCount, 2); assert.equal(controller.state.revision, beforeRevision);
  assert.equal(controller.state.pendingCommitUncertain, false); assert.equal(controller.previewBlocked(), false);
  assert.deepEqual(child(await project('main')).controls[0].default.offset, [2, 3]);
  controller.undoPending(); assert.equal(controller.pendingCount, 1);
  await controller.applyPending(); assert.deepEqual(child(await project('main')).controls[0].default.offset, [7, -1]);
});

test('実HTTP: 手動反映した画像編集の選択書出し・再読込で結果を保持', { timeout: 30000 }, async t => {
  const { controller, project, packId, reimport } = await setup(t);
  await controller.movePreviewElement([5, -4]);
  controller.selectExport({ filePath: 'ui/sample.json', rawKey: 'main@common.base_screen', sourceId: packId });
  await assert.rejects(controller.export('zip'), { code: 'WORKSPACE_UNAPPLIED_PENDING' });
  await controller.applyPending(); controller.state.selections = [];
  for (const name of ['main', 'chest']) {
    const projection = await project(name); controller.selectExport({ filePath: 'ui/sample.json', rawKey: projection.selected.rawKey, sourceId: packId });
  }
  const exported = await controller.export('zip'); assert(exported instanceof Blob); assert(exported.size > 0);
  const imported = await reimport(exported);
  assert.deepEqual(child(imported.main).controls[0].default.offset, [7, -1]);
  assert.deepEqual(child(imported.chest, 'chest').controls[0].default.offset, [2, 3]);
});
