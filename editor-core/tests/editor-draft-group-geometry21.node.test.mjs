import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorSelection21 } from '../src/ui/editor-selection21.js';
import { createWorkspacePendingEdits } from '../src/ui/workspace-pending-edits.js';
import { applyPendingLayout21 } from '../src/ui/editor-draft-layout21.js';
import { applyPendingGeometry21 } from '../src/ui/editor-draft-geometry21.js';
import { computeLayoutBoxesForFile, hitTestBoxes } from '../src/preview/canvas-preview.js';
import { resolveNativeScenePlacement } from '../src/preview/native-scene-placement.js';

const position = (offset, size, extra = {}) => ({ offset, size, anchor_from: 'top_left', anchor_to: 'top_left', ...extra });
function tree({ clip = false, scroll = false, outer = false } = {}) {
  const nodesById = {
    root: { id: 'root', isFileRoot: true, type: 'file', props: {}, children: ['outer', 'other'] },
    outer: { id: 'outer', type: 'panel', props: position([0, 0], [90, 80], { clips_children: outer }), children: ['panel'] },
    panel: { id: 'panel', type: scroll ? 'scroll_view' : 'panel', props: position([10, 10], [30, 30], { clips_children: clip }), children: ['child'] },
    child: { id: 'child', type: 'image', props: position([0, 0], [scroll ? 70 : 20, scroll ? 70 : 20]), children: ['leaf'] },
    leaf: { id: 'leaf', type: 'image', props: position([1, 1], [4, 4]), children: [] },
    other: { id: 'other', type: 'image', props: position([100, 10], [10, 10]), children: [] },
  };
  return { id: 'f', rootId: 'root', nodesById };
}
const preset = { width: 240, height: 120 };
const boxes = layout => layout.boxes.map(({ id, x, y, w, h, clipRect }) => ({ id, x, y, w, h, clipRect }));
function queue() {
  const state = { workspaceId: 'ws', revision: 1, pendingOperations: [], pendingRedoOperations: [], pendingVersion: 0,
    pendingBaseRevision: null, drafts: new Map(), previewAllowed: true };
  const pending = createWorkspacePendingEdits({ state, notify() {}, normalizeOperation: op => op, commit() { throw new Error('この試験は再計算しない'); } });
  const add = (id, operation) => pending.enqueue([{ path: 'ui/test.json', sourceId: 'pack', pointer: '/' + id, targetMode: 'visual', ...operation }], {
    previewSelections: [{ nodeId: id, fileId: 'f', sourceId: 'pack', path: 'ui/test.json', pointer: '/' + id }],
  });
  return { pending, add };
}

test('グループに親子が同時選択されても上位だけenqueueし、子geometryを一度だけ移動する', () => {
  const file = tree(), selection = createEditorSelection21(); selection.useScreen('screen', file);
  selection.setSelection(['panel', 'child', 'other']);
  assert.deepEqual(selection.movementRoots(), ['panel', 'other']);
  selection.groupSelected(); const q = queue();
  for (const id of selection.movementRoots()) q.add(id, { type: 'move', delta: [15, 4] });
  const before = computeLayoutBoxesForFile(file, preset), draft = applyPendingLayout21(before, q.pending.transforms('f'), { nodesById: file.nodesById });
  for (const id of ['panel', 'child', 'leaf', 'other']) {
    const old = before.boxes.find(b => b.id === id), after = draft.boxes.find(b => b.id === id);
    assert.equal(after.x - old.x, 15); assert.equal(after.y - old.y, 4);
  }
});

test('親グループ移動後に子をAlt単体選択で移動すると子だけ追加deltaを持つ', () => {
  const file = tree(), selection = createEditorSelection21(); selection.useScreen('screen', file); selection.setSelection(['panel', 'other']); selection.groupSelected();
  const q = queue(); for (const id of selection.movementRoots()) q.add(id, { type: 'move', delta: [15, 4] });
  selection.select('child', { single: true }); assert.deepEqual(selection.movementRoots(), ['child']);
  q.add('child', { type: 'move', delta: [-2, 3] });
  const before = computeLayoutBoxesForFile(file, preset), draft = applyPendingLayout21(before, q.pending.transforms('f'), { nodesById: file.nodesById });
  for (const [id, dx, dy] of [['panel', 15, 4], ['child', 13, 7], ['leaf', 13, 7], ['other', 15, 4]]) {
    const old = before.boxes.find(b => b.id === id), after = draft.boxes.find(b => b.id === id);
    assert.equal(after.x - old.x, dx); assert.equal(after.y - old.y, dy);
  }
});

for (const method of ['move', 'set']) test(`delta→絶対offset(${method})→deltaの順序を上書き後基準で保つ`, () => {
  const file = tree(), q = queue(); q.add('panel', { type: 'move', delta: [90, 80] });
  q.add('panel', method === 'move' ? { type: 'move', offset: [30, 20] } : { type: 'set', property: 'offset', scope: 'shared', value: [30, 20] });
  q.add('panel', { type: 'move', delta: [-3, 5] });
  const before = computeLayoutBoxesForFile(file, preset), draft = applyPendingLayout21(before, q.pending.transforms('f'), { nodesById: file.nodesById });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { panel: { offset: [27, 25] } } });
  assert.deepEqual(boxes(draft), boxes(committed));
});

test('clipする親を移動すると子のclipとpickも新位置へ一度だけ移動する', () => {
  const file = tree({ clip: true }), before = computeLayoutBoxesForFile(file, preset);
  const draft = applyPendingLayout21(before, new Map([['panel', { dx: 50, dy: 0 }]]), { nodesById: file.nodesById });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { panel: { offset: [60, 10] } } });
  assert.deepEqual(boxes(draft), boxes(committed));
  assert.equal(hitTestBoxes(draft.boxes, 70, 20)?.id, 'child');
  assert.notEqual(hitTestBoxes(draft.boxes, 20, 20)?.id, 'child');
});

test('移動しない外側clipと移動する内側clipは再交差し、表示域を不正に広げない', () => {
  const file = tree({ clip: true, outer: true }), before = computeLayoutBoxesForFile(file, preset);
  const draft = applyPendingLayout21(before, new Map([['panel', { dx: 70, dy: 0 }]]), { nodesById: file.nodesById });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { panel: { offset: [80, 10] } } });
  assert.deepEqual(boxes(draft), boxes(committed));
  assert.equal(hitTestBoxes(draft.boxes, 85, 20)?.id, 'child');
  assert.notEqual(hitTestBoxes(draft.boxes, 95, 20)?.id, 'child');
});

test('由来不明のclipは移動しない', () => {
  const file = tree({ clip: true }), before = computeLayoutBoxesForFile(file, preset);
  const child = before.boxes.find(b => b.id === 'child'); child.clipRect = { x: 0, y: 0, w: 15, h: 15 };
  const draft = applyPendingLayout21(before, new Map([['panel', { dx: 50, dy: 0 }]]), { nodesById: file.nodesById });
  assert.deepEqual(draft.boxes.find(b => b.id === 'child').clipRect, child.clipRect);
});

test('scroll_viewの親移動はviewportとcontent clipも更新する', () => {
  const file = tree({ scroll: true }), before = computeLayoutBoxesForFile(file, preset);
  const draft = applyPendingLayout21(before, new Map([['outer', { dx: 40, dy: 5 }]]), { nodesById: file.nodesById });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { outer: { offset: [40, 5] } } });
  assert.deepEqual(boxes(draft), boxes(committed));
  assert.deepEqual(draft.scrollMetaById.panel.viewport, committed.scrollMetaById.panel.viewport);
});

for (const change of [{ deleted: true }, { properties: { visible: false } }]) test(`親の${change.deleted ? '削除' : '非表示'}で子のpickとscroll付随表示を残さない`, () => {
  const file = tree({ scroll: true }), before = computeLayoutBoxesForFile(file, preset);
  assert.ok(before.scrollMetaById.panel);
  const draft = applyPendingLayout21(before, new Map([['outer', change]]), { nodesById: file.nodesById });
  assert.equal(draft.boxes.some(b => ['outer', 'panel', 'child', 'leaf'].includes(b.id)), false);
  assert.equal(hitTestBoxes(draft.boxes, 20, 20), null);
  assert.equal(Object.hasOwn(draft.scrollMetaById, 'panel'), false);
  assert.ok(before.scrollMetaById.panel, '確定layoutは変更しない');
});

test('allow_clipping:falseで祖先clipから離れた枝は親移動後もclipを復活させない', () => {
  const file = tree({ clip: true, outer: true }); file.nodesById.child.props.allow_clipping = false;
  const before = computeLayoutBoxesForFile(file, preset);
  const draft = applyPendingLayout21(before, new Map([['panel', { dx: 100, dy: 0 }]]), { nodesById: file.nodesById });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { panel: { offset: [110, 10] } } });
  assert.deepEqual(boxes(draft), boxes(committed));
  assert.equal(draft.boxes.find(b => b.id === 'child').clipRect, null);
});

test('評価済みclips_childrenと逆順boxesでもclip由来を照合し元layoutを変更しない', () => {
  const file = tree(), propsByIdOverride = { panel: { clips_children: true } };
  const before = computeLayoutBoxesForFile(file, preset, { propsByIdOverride }); before.boxes.reverse();
  const preserved = JSON.stringify(before), prototype = Object.getPrototypeOf(before.scrollMetaById);
  const draft = applyPendingLayout21(before, new Map([['panel', { dx: 40, dy: 5 }]]), { nodesById: file.nodesById, propsByIdOverride });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { panel: { clips_children: true, offset: [50, 15] } } });
  assert.deepEqual(boxes(draft).reverse(), boxes(committed)); assert.equal(JSON.stringify(before), preserved);
  assert.equal(Object.getPrototypeOf(before.scrollMetaById), prototype);
});

test('scroll content以外の直下兄弟へviewport clipを誤適用しない', () => {
  const file = tree({ scroll: true }); file.nodesById.panel.children.push('chrome');
  file.nodesById.chrome = { id: 'chrome', type: 'image', props: position([35, 0], [20, 20]), children: [] };
  const before = computeLayoutBoxesForFile(file, preset);
  const draft = applyPendingLayout21(before, new Map([['panel', { dx: 30, dy: 5 }]]), { nodesById: file.nodesById });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { panel: { offset: [40, 15] } } });
  assert.deepEqual(boxes(draft), boxes(committed));
  assert.equal(draft.boxes.find(b => b.id === 'chrome').clipRect, null);
});

test('親グループ内の3D custom矩形は重ねて拡縮せず、子の配置へ同じdeltaだけ伝える', () => {
  const file = tree(); file.nodesById.child.type = 'custom';
  const before = computeLayoutBoxesForFile(file, preset), draft = applyPendingLayout21(before, new Map([['panel', { dx: 25, dy: 8 }]]), { nodesById: file.nodesById });
  const initial = resolveNativeScenePlacement({ kind: 'book' }, before.boxes.find(b => b.id === 'child'));
  const moved = resolveNativeScenePlacement({ kind: 'book' }, draft.boxes.find(b => b.id === 'child'));
  assert.equal(moved.x - initial.x, 25); assert.equal(moved.y - initial.y, 8); assert.equal(moved.extent, initial.extent);
});

test('ポインタ中の共有boxを含む草稿も元配列を変更せずclipを追従させる', () => {
  const file = tree({ clip: true }), base = computeLayoutBoxesForFile(file, preset);
  const pending = applyPendingLayout21(base, new Map([['panel', { dx: 5, dy: 0 }]]), { nodesById: file.nodesById });
  const moving = pending.boxes.map(box => ['panel', 'child', 'leaf'].includes(box.id) ? { ...box, x: box.x + 30 } : box);
  const saved = JSON.stringify({ pending, moving });
  for (const box of moving) Object.freeze(box);
  const draft = applyPendingGeometry21(pending, moving, { nodesById: file.nodesById });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { panel: { offset: [45, 10] } } });
  assert.deepEqual(boxes(draft), boxes(committed)); assert.equal(JSON.stringify({ pending, moving }), saved);
});
