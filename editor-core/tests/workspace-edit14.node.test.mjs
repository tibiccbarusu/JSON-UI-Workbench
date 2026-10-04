import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createWorkspaceEditor, findAuthoredNodeForPreview, offsetAfterAuthoredMove, renderWorkspaceSourceEditor,
  sameWorkspacePreviewModel, shouldDeferWorkspaceCanvasRender, selectWorkspacePreviewDefinition } from '../src/ui/workspace-editor.js';
import { createLocalServer } from '../../local-node/server.mjs';
import { makeZip, manifest } from '../../local-node/tests/fixtures.mjs';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';

const source = JSON.stringify({ namespace: 'sample', main: { type: 'screen', controls: [
  { caption: { type: 'label', text: '修理', size: [60, 20], offset: [5, 6] } },
] }, second: { type: 'screen', controls: [{ other: { type: 'label', text: '保持' } }] } });

function asFile(projection) {
  const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: 'ui/sample.json' });
  return { id: 'screen:ui/sample.json', path: 'ui/sample.json', uiModel,
    ...buildTreeFromUiScreenModel(uiModel), meta: { selectedDefinition: projection.selected } };
}

test('実HTTP: 原文更新は旧projectionを失効し、再投影が終わるまで編集プレビューを停止する', { timeout: 30000 }, async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const cap = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' };
  const packId = randomUUID();
  const upload = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': packId, 'X-JSONUI-Name': 'edit14.zip' }, body: makeZip({
    'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/sample.json"]}', 'ui/sample.json': source,
  }) });
  assert.equal(upload.status, 200); await upload.arrayBuffer();
  const post = async (route, payload, options = {}) => {
    const response = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(payload), signal: options.signal });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  };
  let oldProjection, file, frames = 0, commits = 0, staleReproductions = 0;
  const projectAndFrame = async sources => {
    const catalog = await post('catalog', { sources });
    const record = catalog.records.find(row => row.localName === 'main');
    const projection = await post('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
    const frame = await post('frame', { projectionId: projection.nodeProjectionId, filePath: 'ui/sample.json', preset: { width: 480, height: 270 }, generation: ++frames });
    assert.equal(frame.schema, 'jsonui-frame-v1');
    file = asFile(projection); oldProjection = projection;
    return frame;
  };
  const controller = createWorkspaceEditor({ manualApply: false, request: (operation, payload, options) => post('workspace-' + operation, payload, options), onCommit: async committed => {
    commits++;
    assert.equal(controller.previewBlocked(), true, '新モデルを取得する前に停止する');
    await assert.rejects(post('frame', { projectionId: oldProjection.nodeProjectionId, filePath: 'ui/sample.json', preset: { width: 480, height: 270 }, generation: 900 }), { message: 'NODE_FRAME_PROJECTION_STALE', status: 409 });
    staleReproductions++;
    await projectAndFrame(committed.sources);
    assert.equal(controller.previewBlocked(), true, 'onCommit完了前は旧Canvasを再表示しない');
  } });
  await controller.ensure([{ id: packId, kind: 'vanilla' }], 'pack-v1');
  await controller.readDocument('ui/sample.json', { sourceId: packId });
  await projectAndFrame(controller.state.sources);
  controller.setMode('edit');
  selectWorkspacePreviewDefinition(controller, file, packId);
  assert.equal(controller.state.selectedPointer, '/main');
  let caption = file.uiModel.root.children[0].children[0];
  const authored = findAuthoredNodeForPreview({ file, nodeId: caption.id, nodes: controller.state.nodes, sourceId: packId });
  assert.equal(authored.pointer, '/main/controls/0/caption');
  const offset = offsetAfterAuthoredMove({ value: authored.props, dx: 9, dy: -3 });
  await controller.edit({ type: 'set', path: file.path, sourceId: packId, pointer: `${authored.pointer}/offset`, value: offset });
  assert.deepEqual(file.uiModel.root.children[0].children[0].props.offset, [14, 3]);
  assert.equal(controller.previewBlocked(), false);
  await controller.edit({ type: 'add', path: file.path, sourceId: packId, parentPointer: '/main', name: 'placed', value: { type: 'panel', offset: [25, 30], size: [40, 50] } });
  assert.equal(controller.state.selectedPointer, '/main/controls/1/placed');
  assert.deepEqual(file.uiModel.root.children[0].children[1].props.offset, [25, 30]);
  await controller.planDelete(file.path, controller.state.selectedPointer, packId);
  await controller.confirmDelete();
  assert.equal(file.uiModel.root.children[0].children.length, 1);
  await controller.history('undo');
  assert.equal(file.uiModel.root.children[0].children.length, 2);
  assert.equal(commits, 4); assert.equal(staleReproductions, 4);
  const saved = controller.getDocument().text;
  assert.match(saved, /保持/u, '非選択UIを保持する');
  controller.setDraft(file.path, '{"namespace":', packId);
  await assert.rejects(controller.applyDraft());
  assert.equal(commits, 4); assert.equal(controller.previewBlocked(), true);
  controller.discardDraft(); assert.equal(controller.previewBlocked(), false);
});

test('ドラッグ中の無害な検証patchは同一モデル、新model・他file・停止状態は区別', () => {
  const file = { id: 'f', uiModel: {}, nodesById: {} };
  const validationPatch = { ...file, validation: { ok: true } };
  const interaction = { active: true, sourceFile: file };
  assert.equal(sameWorkspacePreviewModel(file, validationPatch), true);
  assert.equal(shouldDeferWorkspaceCanvasRender({ mode: 'edit', blocked: false, file: validationPatch, interaction }), true);
  for (const candidate of [{ ...file, id: 'other' }, { ...file, uiModel: {} }, { ...file, nodesById: {} }, null]) {
    assert.equal(sameWorkspacePreviewModel(file, candidate), false);
    assert.equal(Boolean(shouldDeferWorkspaceCanvasRender({ mode: 'edit', blocked: false, file: candidate, interaction })), false);
  }
  assert.equal(shouldDeferWorkspaceCanvasRender({ mode: 'preview', blocked: false, file, interaction }), false);
  assert.equal(shouldDeferWorkspaceCanvasRender({ mode: 'edit', blocked: true, file, interaction }), false);
  assert.equal(shouldDeferWorkspaceCanvasRender({ mode: 'edit', blocked: false, file, interaction: { ...interaction, active: false } }), false);
});

test('同じファイル内の別UI選択・同一UI内の子選択・レイヤーを混同しない', () => {
  const sourceId = 'vanilla';
  const nodes = ['main', 'second'].flatMap(name => ['vanilla', 'custom'].map(sourceId => ({ path: 'ui/a.json', sourceId, isDefinition: true, localName: name, pointer: `/${name}` })));
  const state = { nodes, activePath: 'ui/a.json', activeSourceId: sourceId, selectedPointer: '/main/controls/0/child' };
  const controller = { state, selectPointer(pointer, path, sourceId) { Object.assign(state, { selectedPointer: pointer, activePath: path, activeSourceId: sourceId }); } };
  const file = { path: 'ui/a.json', meta: { selectedDefinition: { definition: 'main' } } };
  selectWorkspacePreviewDefinition(controller, file, sourceId);
  assert.equal(state.selectedPointer, '/main/controls/0/child');
  file.meta.selectedDefinition.definition = 'second';
  selectWorkspacePreviewDefinition(controller, file, sourceId); assert.equal(state.selectedPointer, '/second');
  selectWorkspacePreviewDefinition(controller, file, 'custom'); assert.equal(state.activeSourceId, 'custom');
});

const element = (tag, attrs = {}, children = []) => ({ tag, attrs, children: children.flat(Infinity).filter(value => value !== '' && value != null), value: attrs.value ?? '' });
const descendants = node => typeof node === 'object' && node ? [node, ...(node.children || []).flatMap(descendants)] : [];
test('原文編集モードの属性はすぐ表示、直接JSON編集は保持できる開閉状態を持つ', () => {
  const controller = { state: { activePath: 'ui/a.json', activeSourceId: '', selectedPointer: '/main', files: [], nodes: [{ path: 'ui/a.json', pointer: '/main', rawKey: 'main', props: {} }], drafts: new Map([['ui/a.json', { text: '{}' }]]) } };
  const render = () => renderWorkspaceSourceEditor(element, { controller, renderPicker: options => element('picker', options) });
  let rows = descendants(render());
  const sourceIndex = rows.findIndex(row => row.attrs.class === 'workspace-source-section');
  assert(rows.findIndex(row => row.attrs.id === 'workspace-property-name') < sourceIndex);
  assert.equal(rows[sourceIndex].attrs.open, false);
  rows[sourceIndex].attrs.onToggle({ currentTarget: { isConnected: true, open: true } });
  rows = descendants(render()); assert.equal(rows.find(row => row.attrs.class === 'workspace-source-section').attrs.open, true);
  controller.state.sourceDetailsOpen = false; controller.state.drafts.get('ui/a.json').invalid = true;
  assert.equal(descendants(render()).find(row => row.attrs.class === 'workspace-source-section').attrs.open, true);
});

test('編集CSSは倍率に依存せずCanvas枠を保持する契約（ブラウザ実寸検査の代用ではない）', async () => {
  const css = await readFile(new URL('../app/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.is-source-editing \.canvas-stage\s*\{[^}]*min-height:\s*320px/u);
  assert.match(css, /\.studio-workspace\.is-source-editing\s*\{[^}]*overflow:\s*auto/u);
  assert.match(css, /grid-template-areas:\s*"center right" "left right"/u);
  assert.match(css, /grid-template-areas:\s*"center" "right" "left"/u);
});
