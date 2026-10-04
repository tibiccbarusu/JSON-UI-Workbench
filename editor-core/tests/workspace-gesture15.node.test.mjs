import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalServer } from '../../local-node/server.mjs';
import { makeZip, manifest } from '../../local-node/tests/fixtures.mjs';
import { createWorkspaceEditor, offsetAfterAuthoredMove, shouldDeferWorkspaceCanvasRender } from '../src/ui/workspace-editor.js';
import { captureWorkspaceSourceDrag, isWorkspaceSourceDragCurrent } from '../src/ui/workspace-gesture14.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';

test('実HTTP: 同一内容の別フレーム応答は移動を取り消さず、px原文の移動を保存できる', { timeout: 30000 }, async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const capabilities = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': capabilities.token, 'Content-Type': 'application/json' };
  const path = 'ui/gesture.json', packId = randomUUID();
  const source = '{"namespace":"gesture","main":{"type":"screen","controls":[{"tile":{"type":"panel","anchor_from":"top_left","anchor_to":"top_left","offset":["10px","20px"],"size":[40,30]}}]},"sibling":{"type":"screen"}}';
  const upload = await fetch(base + 'packs', { method: 'POST', headers: { ...headers,
    'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': packId, 'X-JSONUI-Name': 'gesture15.zip' },
    body: makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': JSON.stringify({ ui_defs: [path] }), [path]: source }) });
  assert.equal(upload.status, 200); await upload.arrayBuffer();
  const post = async (route, data, options = {}) => {
    const response = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(data), signal: options.signal });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const controller = createWorkspaceEditor({ manualApply: false, request: (operation, data, options) => post('workspace-' + operation, data, options) });
  await controller.ensure([{ id: packId, kind: 'imported' }], 'gesture15');
  await controller.readDocument(path, { sourceId: packId });
  const project = async () => {
    const catalog = await post('catalog', { sources: controller.state.sources });
    const record = catalog.records.find(row => row.localName === 'main');
    return post('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
  };
  const projection = await project();
  const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: path });
  const file = { id: 'gesture', path, uiModel, ...buildTreeFromUiScreenModel(uiModel) };
  const frameRequest = { projectionId: projection.nodeProjectionId, filePath: path, preset: { width: 480, height: 270 }, generation: 1 };
  const before = await post('frame', frameRequest);
  const repeated = await post('frame', frameRequest);
  assert.notEqual(before.layout, repeated.layout, 'HTTP JSON の再解析で別オブジェクトになる');
  assert.deepEqual(before.layout.boxes, repeated.layout.boxes);
  const current = { file, revision: controller.state.revision, layout: before.layout, context: 'same-frame-context', view: { zoom: 1, viewX: 0, viewY: 0 } };
  const snapshot = captureWorkspaceSourceDrag(current);
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...current, layout: repeated.layout }), true);
  const tile = controller.state.nodes.find(node => node.localName === 'tile');
  const offset = offsetAfterAuthoredMove({ value: tile.props, dx: 7, dy: -4 });
  assert.deepEqual(offset, ['17px', '16px']);
  await controller.edit({ type: 'set', path, sourceId: packId, pointer: `${tile.pointer}/offset`, value: offset });
  const afterProjection = await project();
  const after = await post('frame', { ...frameRequest, projectionId: afterProjection.nodeProjectionId, generation: 2 });
  const beforeBox = before.layout.boxes.find(box => box.id.endsWith('/tile'));
  const afterBox = after.layout.boxes.find(box => box.id.endsWith('/tile'));
  assert(beforeBox); assert(afterBox);
  assert.equal(afterBox.x - beforeBox.x, 7);
  assert.equal(afterBox.y - beforeBox.y, -4);
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...current, revision: controller.state.revision, layout: after.layout }), false);
  assert(JSON.parse(controller.getDocument().text).sibling, '別 UI 定義を保持');
  await controller.history('undo');
  assert.equal(controller.getDocument().text, source, 'undo はコメント等を含む原文を復元する境界');
});

test('開始時に配置を固定し、参照が同じまま座標・clip・親・presetを書換えても拒否する', () => {
  const file = { id: 'f', uiModel: {}, nodesById: {} };
  const make = () => ({ file, revision: 'r', context: 'c', view: { zoom: 1, viewX: 0, viewY: 0 },
    layout: { preset: { width: 480, height: 270 }, boxes: [{ id: 'child', parentId: 'parent', x: 10, y: 20, w: 30, h: 40, clipRect: { x: 0, y: 0, w: 100, h: 100 } }] } });
  for (const mutate of [
    state => { state.layout.boxes[0].x++; }, state => { state.layout.boxes[0].parentId = 'other'; },
    state => { state.layout.boxes[0].clipRect.w--; }, state => { state.layout.preset.width++; },
  ]) {
    const state = make(), snapshot = captureWorkspaceSourceDrag(state);
    mutate(state); assert.equal(isWorkspaceSourceDragCurrent(snapshot, state), false);
  }
  const state = make(), snapshot = captureWorkspaceSourceDrag(state);
  const copy = structuredClone(state.layout); copy.stats = { elapsedMs: 400 };
  assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...state, layout: copy }), true, '配置と無関係な計測値の更新は許容');
  const cycle = make(); cycle.layout.boxes[0].self = cycle.layout.boxes[0];
  assert.equal(isWorkspaceSourceDragCurrent(captureWorkspaceSourceDrag(cycle), cycle), false);
  for (const patch of [{ context: 'changed' }, { revision: 'changed' }, { file: { ...file, uiModel: {} } }, { view: { zoom: 2, viewX: 0, viewY: 0 } }]) {
    assert.equal(isWorkspaceSourceDragCurrent(snapshot, { ...state, ...patch }), false);
  }
});

test('px絶対offsetと割合offsetを保持し、動的な式や自動配置は拒否する', () => {
  assert.deepEqual(offsetAfterAuthoredMove({ value: { offset: ['-1.5px', '+2.25px'] }, dx: 0.125, dy: -0.5 }), ['-1.375px', '1.75px']);
  assert.deepEqual(offsetAfterAuthoredMove({ value: { offset: ['50% + 2px', '25%'] }, dx: 3, dy: -4 }), ['50% + 5px', '25% - 4px']);
  assert.throws(() => offsetAfterAuthoredMove({ value: { offset: ['$offset', '2px'] }, dx: 1, dy: 1 }), { code: 'WORKSPACE_DYNAMIC_OFFSET' });
  assert.throws(() => offsetAfterAuthoredMove({ value: { offset: ['1px', '2px'] }, parentType: 'grid', dx: 1, dy: 1 }), { code: 'WORKSPACE_FLOW_LAYOUT' });
});

test('編集モードの表示パンも同一Canvasを保持し、別UI・停止状態には持ち越さない', () => {
  const file = { id: 'f', uiModel: {}, nodesById: {} };
  const interaction = { active: true, mode: 'pan', targetId: null, sourceFile: file };
  assert.equal(shouldDeferWorkspaceCanvasRender({ mode: 'edit', blocked: false, file, interaction }), true);
  assert.equal(shouldDeferWorkspaceCanvasRender({ mode: 'edit', blocked: true, file, interaction }), false);
  assert.equal(shouldDeferWorkspaceCanvasRender({ mode: 'edit', blocked: false, file: { ...file, id: 'other' }, interaction }), false);
  assert.equal(interaction.targetId, null, '表示パンの記録は原文要素の移動対象を持たない');
});
