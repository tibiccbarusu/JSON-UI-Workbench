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
  const controller = createWorkspaceEditor({ manualApply: false, request: (route, payload, options) => post('workspace-' + route, payload, options),
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

test('実HTTP: このUIの操作全体を移動し、共有原文と同ファイルの別UIを保持、再選択とundoを維持', { timeout: 30000 }, async t => {
  const { controller, project, post, packId, requests, reimport } = await setup(t);
  controller.setEditOptions({ targetMode: 'interaction' });
  const beforeRevision = controller.state.revision;
  const plan = await controller.planPreviewEdit();
  assert.equal(plan.promoted, true); assert.equal(plan.target.type, 'button'); assert.equal(plan.scope, 'screen');
  assert.deepEqual(plan.target.props.offset, [10, 20]); assert.deepEqual(plan.target.props.size, [21, 21]);
  assert.equal(controller.state.revision, beforeRevision, '計画で履歴revisionを変更しない');
  await controller.movePreviewElement([5, -4]);
  const main = await project('main'), chest = await project('chest');
  assert.deepEqual(child(main).offset, [15, 16]); assert.deepEqual(child(chest, 'chest').offset, [10, 20]);
  assert.deepEqual(child(main).controls[0].default.offset, [2, 3]); assert.deepEqual(child(main).controls[1].hover.offset, [2, 3]);
  const raw = await post('workspace-read', { workspaceId: controller.state.workspaceId, sourceId: packId, path: 'ui/common.json' });
  assert(raw.text.startsWith(commonText.slice(0, -1)), '共有buttonと基底screenの既存原文を1バイトも変更しない。専用定義の追記は許容');
  assert.deepEqual(JSON.parse(raw.text).close_button, JSON.parse(commonText).close_button);
  assert.deepEqual(JSON.parse(raw.text).base_screen, JSON.parse(commonText).base_screen);
  assert(controller.state.previewSelection, '複製後も選択を保持');
  const secondPlan = await controller.planPreviewEdit();
  assert.notEqual(secondPlan.target.pointer, '/close_button', '操作ownerは新しい分岐へ再対応する。子画像は共有元を保持してよい');
  assert.deepEqual(secondPlan.target.props.offset, [15, 16]);
  const sent = requests.filter(row => row.route === 'workspace-edit' && row.payload.operation.type === 'move');
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].payload.operation.delta, [5, -4]);
  await controller.movePreviewElement([1, 2]);
  const finalMain = await project('main'); assert.deepEqual(child(finalMain).offset, [16, 18]);
  assert.notEqual(controller.state.previewSelection.screen.pointer, '/main@common.base_screen', '継承画面の改名後pointerを次の編集へ使う');
  for (const name of ['main', 'chest']) {
    const projection = await project(name);
    controller.selectExport({ filePath: 'ui/sample.json', rawKey: projection.selected.rawKey, sourceId: packId });
  }
  const exported = await controller.export('zip'); assert(exported instanceof Blob); assert(exported.size > 0);
  controller.setEditOptions({ scope: 'shared', targetMode: 'visual' });
  await controller.history('undo');
  assert.equal(controller.state.editScope, 'screen'); assert.equal(controller.state.editTargetMode, 'interaction');
  assert.equal(controller.state.lastHistoryAction.direction, 'undo'); assert.equal(controller.state.editGeneratedTemplate, false);
  assert.deepEqual(child(await project('main')).offset, [15, 16]);
  await controller.history('redo'); assert.equal(controller.state.editScope, 'screen'); assert.equal(controller.state.lastHistoryAction.direction, 'redo');
  assert.deepEqual(child(await project('main')).offset, [16, 18]);
  await controller.history('undo');
  await controller.history('undo');
  assert.deepEqual(child(await project('main')).offset, [10, 20]);
  // 再importは現在のworkspaceを失効させるので、旧workspace履歴の確認を先に終える。
  const imported = await reimport(exported);
  assert.deepEqual(child(imported.main).offset, [16, 18]); assert.deepEqual(child(imported.chest, 'chest').offset, [10, 20]);
});

test('実HTTP: 共有元＋見た目だけの明示選択では画像のみ両UIへ伝播する', { timeout: 30000 }, async t => {
  const { controller, project } = await setup(t);
  controller.setEditOptions({ scope: 'shared', targetMode: 'visual' });
  const plan = await controller.planPreviewEdit(); assert.equal(plan.promoted, false); assert.equal(plan.target.type, 'image');
  await controller.movePreviewElement([5, -4]);
  for (const name of ['main', 'chest']) {
    const value = child(await project(name), name);
    assert.deepEqual(value.offset, [10, 20]); assert.deepEqual(value.controls[0].default.offset, [7, -1]);
    assert.deepEqual(value.controls[1].hover.offset, [2, 3]);
  }
});
