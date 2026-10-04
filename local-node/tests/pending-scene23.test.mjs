import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';
import { buildWorkspaceDraftScene23, advanceWorkspaceDraftScene23, moveWorkspaceDraftAddition23 } from '../../editor-core/src/ui/workspace-draft-scene23.js';
const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
function fileOf(document) {
  const uiModel = buildUiScreenModelFromJson(document, { filePath: 'ui/test.json' });
  return { id: 'f', path: 'ui/test.json', uiModel, ...buildTreeFromUiScreenModel(uiModel), meta: {} };
}
function fixture() {
  const document = { namespace: 'test', screen: { type: 'screen', ...origin, size: [200, 100], offset: [0, 0],
    controls: [{ old: { type: 'label', ...origin, offset: [10, 20], size: [30, 20], text: '既存' } }] } };
  const file = fileOf(document), after = structuredClone(document);
  after.screen.offset = [10, 0];
  const value = { type: 'label', ...origin, offset: [30, 40], size: [50, 20], text: '追加' };
  after.screen.controls.push({ added: value });
  const draftFile = fileOf(after), rootId = Object.keys(file.nodesById).find(id => id.endsWith('/screen'));
  const addedId = Object.keys(draftFile.nodesById).find(id => id.endsWith('/added'));
  const additions = [{ id: 'p1', operation: { type: 'add', name: 'added', value }, previewSelection: { fileId: 'f', nodeId: rootId } }];
  const transforms = new Map([[rootId, { dx: 10, dy: 0, properties: {} }]]);
  const result = { ok: true, committed: false, baseRevision: 'r', pendingVersion: 2, projection: { document: after },
    frame: { schema: 'jsonui-frame-v1', propsById: {}, layout: computeLayoutBoxesForFile(draftFile, { width: 200, height: 100 }) } };
  return { file, result, additions, transforms, rootId, addedId, scene: buildWorkspaceDraftScene23({ file, result, additions, transforms }) };
}
test('Node草稿sceneは既存fileを変更せず、新規要素を指定親の追加IDだけへ対応する', () => {
  const { file, scene, addedId } = fixture();
  assert(!file.nodesById[addedId]); assert(scene.file.nodesById[addedId]);
  assert.equal(scene.additionsByNodeId.get(addedId), 'p1'); assert.equal(scene.baseFile, file);
});
test('次のNode応答待ちにも親と新規要素の移動を二重加算せず保持する', () => {
  const { scene, additions, rootId, addedId } = fixture();
  const changed = structuredClone(additions); changed[0].operation.value.offset = [35, 40]; changed[0].operation.value.text = '変更';
  const result = advanceWorkspaceDraftScene23(scene, { additions: changed,
    transforms: new Map([[rootId, { dx: 15, dy: 0, properties: {} }]]) });
  const added = result.layout.boxes.find(box => box.id === addedId), original = result.layout.boxes.find(box => box.id.endsWith('/old'));
  assert.equal(added.x, 50); assert.equal(original.x, 25);
  assert.equal(result.propsByIdOverride[addedId].text, '変更');
  assert.equal(scene.layout.boxes.find(box => box.id === addedId).x, 40);
});
test('親移動のundoと新規要素削除を即時表示へ反映する', () => {
  const { scene, additions, addedId } = fixture();
  const undo = advanceWorkspaceDraftScene23(scene, { additions });
  assert.equal(undo.layout.boxes.find(box => box.id === addedId).x, 30);
  const remove = advanceWorkspaceDraftScene23(scene, { additions: [] });
  assert(!remove.layout.boxes.some(box => box.id === addedId));
});
test('草稿モデルにないboxや重複IDは成功したsceneとして公開しない', () => {
  const { file, result } = fixture();
  for (const badBox of [{ ...result.frame.layout.boxes[0], id: 'not-found' }, { ...result.frame.layout.boxes[0] }]) {
    const invalid = structuredClone(result); invalid.frame.layout.boxes.push(badBox);
    assert.throws(() => buildWorkspaceDraftScene23({ file, result: invalid }), { code: 'WORKSPACE_DRAFT_SCENE_NODE_INVALID' });
  }
});
test('新規要素のdragは同じrevision/versionだけをキューへ渡す', () => {
  const { scene, addedId } = fixture(), calls = [];
  const controller = { state: { revision: 'r', pendingVersion: 2 }, editPendingAddition: (...args) => calls.push(args) };
  moveWorkspaceDraftAddition23(controller, scene, addedId, { x: 40, y: 40 }, { x: 42.5, y: 37 });
  assert.deepEqual(calls, [['p1', { type: 'move', delta: [2.5, -3] }]]);
  controller.state.pendingVersion = 3;
  assert.throws(() => moveWorkspaceDraftAddition23(controller, scene, addedId, { x: 40, y: 40 }, { x: 42, y: 37 }), { code: 'WORKSPACE_DRAFT_ADDITION_STALE' });
  assert.equal(calls.length, 1);
});
