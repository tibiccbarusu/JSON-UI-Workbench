import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorSelection21, movementRootIds21 } from '../src/ui/editor-selection21.js';

// 製品と同じ children だけの flat tree。生成時の親参照はモデルから独立している。
function sampleFile() {
  return { id: 'screen:ui/anvil_screen.json', rootId: 'root', nodesById: {
    root: { id: 'root', isFileRoot: true, children: ['panel', 'other', 'tail'] },
    panel: { id: 'panel', children: ['background', 'label'] },
    background: { id: 'background', children: [] },
    label: { id: 'label', children: [] },
    other: { id: 'other', children: [] },
    tail: { id: 'tail', children: [] },
  } };
}

function editor(file = sampleFile()) {
  const selection = createEditorSelection21();
  selection.useScreen('pack-a|anvil', file);
  return selection;
}

function selectPair(selection, first = 'background', second = 'label') {
  selection.select(first);
  selection.select(second, { toggle: true });
}

test('大量UIの巡回で未設定の画面を解放し、作成済みグループを維持する', () => {
  const selection = createEditorSelection21({ maxScreens: 4, evictUnmodified: true });
  selection.useScreen('saved-screen', sampleFile());
  selectPair(selection); selection.groupSelected({ name: '保持するグループ' });
  for (let i = 0; i < 600; i++) selection.useScreen(`screen-${i}`, sampleFile());
  assert.equal(selection.exportMetadata().screens.length, 4);
  selection.useScreen('saved-screen', sampleFile());
  assert.equal(selection.snapshot().groups[0].name, '保持するグループ');
});

test('グループ解除後も取り消し履歴がある画面は自動解放しない', () => {
  const selection = createEditorSelection21({ maxScreens: 2, evictUnmodified: true });
  for (const identity of ['a', 'b']) {
    selection.useScreen(identity, sampleFile()); selectPair(selection);
    selection.groupSelected(); selection.ungroupSelected();
  }
  assert.throws(() => selection.useScreen('c', sampleFile()), /上限/);
  selection.useScreen('a', sampleFile());
  assert.equal(selection.undoGroup().groups.length, 1);
});

test('グループのパネル内をクリックすると全体を選び、単体指定では子だけを選ぶ', () => {
  const selection = editor();
  selection.setSelection(['panel', 'other']); selection.groupSelected();
  selection.select(null);
  assert.deepEqual(selection.select('background').selectedIds, ['panel', 'other']);
  assert.deepEqual(selection.movementRoots(), ['panel', 'other']);
  assert.deepEqual(selection.select('background', { single: true }).selectedIds, ['background']);
  assert.deepEqual(selection.select('label', { toggle: true }).selectedIds.sort(), ['background', 'other', 'panel']);
  assert.deepEqual(selection.movementRoots().sort(), ['other', 'panel']);
});

test('背景の単体選択は input_panel の親へ昇格しない', () => {
  const selection = editor();
  const state = selection.select('background');
  assert.deepEqual(state.selectedIds, ['background']);
  assert.deepEqual(selection.movementRoots(), ['background']);
  selection.select('root');
  assert.deepEqual(selection.snapshot().selectedIds, ['background']);
});

test('Shift は追加と解除、空白と無効 ID は意図した選択だけを変える', () => {
  const selection = editor();
  selectPair(selection);
  assert.deepEqual(selection.snapshot().selectedIds, ['background', 'label']);
  selection.select('background', { toggle: true });
  assert.deepEqual(selection.snapshot().selectedIds, ['label']);
  selection.select('missing');
  selection.select(null, { toggle: true });
  assert.deepEqual(selection.snapshot().selectedIds, ['label']);
  assert.deepEqual(selection.select(null).selectedIds, []);
});

test('グループを通常クリックでまとめて選び、Alt は構成要素一つだけを選ぶ', () => {
  const selection = editor();
  selectPair(selection);
  const result = selection.groupSelected({ name: '背景と文字' });
  assert.equal(result.groups[0].name, '背景と文字');
  selection.select('other');
  assert.deepEqual(selection.select('background').selectedIds, ['background', 'label']);
  assert.deepEqual(selection.select('background', { single: true }).selectedIds, ['background']);
  assert.deepEqual(selection.select('label', { toggle: true }).selectedIds, ['background', 'label']);
  assert.deepEqual(selection.select('label', { toggle: true }).selectedIds, []);
});

test('親子同時選択は移動 root に一回だけ含め、独立した選択も維持する', () => {
  const selection = editor();
  selection.setSelection(['background', 'other', 'panel', 'label']);
  assert.deepEqual(selection.movementRoots(), ['other', 'panel']);
  assert.deepEqual(movementRootIds21(['background', 'panel', 'label'], sampleFile()), ['panel']);
  selection.setSelection(['panel', 'background']);
  assert.equal(selection.snapshot().canGroup, false);
  assert.throws(() => selection.groupSelected(), /独立した要素/);
});

test('矩形は逆向きドラッグ・包含/交差・不可視・非有限の box を扱える', () => {
  const selection = editor();
  const boxes = [
    { id: 'root', x: 0, y: 0, w: 10, h: 10 },
    { id: 'background', x: 2, y: 2, w: 4, h: 4 },
    { id: 'label', x: 8, y: 8, w: 4, h: 4 },
    { id: 'other', x: 1, y: 1, w: 1, h: 1, visible: false },
    { id: 'tail', x: NaN, y: 1, w: 1, h: 1 },
  ];
  assert.deepEqual(selection.selectBox({ x: 10, y: 10, w: -10, h: -10 }, boxes).selectedIds, ['background']);
  assert.deepEqual(selection.selectBox({ x: 0, y: 0, w: 10, h: 10 }, boxes, { mode: 'intersect' }).selectedIds, ['background', 'label']);
  assert.throws(() => selection.selectBox({ x: Infinity, y: 0, w: 1, h: 1 }, boxes), /有限/);
  assert.throws(() => selection.selectBox({ x: 0, y: 0, w: 1, h: 1 }, boxes, { mode: 'invalid' }), /mode/);
});

test('Shift 矩形が同じグループに二回命中してもグループは一回だけ切り替わる', () => {
  const selection = editor();
  selectPair(selection);
  selection.groupSelected();
  const boxes = ['background', 'label'].map((id, index) => ({ id, x: index * 2, y: 0, w: 1, h: 1 }));
  const rect = { x: 0, y: 0, w: 10, h: 10 };
  assert.deepEqual(selection.selectBox(rect, boxes, { toggle: true }).selectedIds, []);
  selection.select('background', { single: true });
  assert.deepEqual(selection.selectBox(rect, boxes, { toggle: true }).selectedIds, ['background', 'label']);
});

test('既存グループ同士は平坦な一つのグループへ統合でき、解除後は個別に戻る', () => {
  const selection = editor();
  selectPair(selection);
  selection.groupSelected();
  selectPair(selection, 'other', 'tail');
  selection.groupSelected();
  selection.select('background');
  selection.select('other', { toggle: true });
  assert.equal(selection.groupSelected().groups.length, 1);
  assert.equal(selection.snapshot().groups[0].members.length, 4);
  assert.equal(selection.ungroupSelected().groups.length, 0);
  assert.deepEqual(selection.select('background').selectedIds, ['background']);
});

test('グループ Undo / Redo は選択込みで戻り、新しいグループ操作で Redo を無効化', () => {
  const selection = editor();
  selectPair(selection);
  selection.groupSelected();
  selection.ungroupSelected();
  assert.equal(selection.undoGroup().groups.length, 1);
  assert.equal(selection.undoGroup().groups.length, 0);
  assert.equal(selection.redoGroup().groups.length, 1);
  assert.equal(selection.redoGroup().groups.length, 0);
  selection.undoGroup();
  selection.groupSelected({ name: '別のグループ' });
  assert.equal(selection.snapshot().canRedoGroup, false);
});

test('画面 identity を切り替えても同じ node ID の別画面を変更しない', () => {
  const selection = editor();
  selectPair(selection);
  selection.groupSelected();
  selection.useScreen('pack-b|anvil', sampleFile());
  assert.equal(selection.snapshot().groups.length, 0);
  selection.select('other');
  selection.useScreen('pack-a|anvil', sampleFile());
  assert.equal(selection.snapshot().groups.length, 1);
  assert.deepEqual(selection.snapshot().selectedIds, ['background', 'label']);
  assert.equal(selection.snapshot().canUndoGroup, true);
});

test('再投影で消えた ID は選択・グループ・Undo の復元から除外する', () => {
  const selection = editor();
  selectPair(selection);
  selection.groupSelected();
  selection.ungroupSelected();
  const changed = sampleFile();
  delete changed.nodesById.label;
  changed.nodesById.panel.children = ['background'];
  selection.useScreen('pack-a|anvil', changed);
  assert.deepEqual(selection.snapshot().selectedIds, ['background']);
  assert.equal(selection.undoGroup().groups.length, 0);
  assert.deepEqual(selection.snapshot().selectedIds, ['background']);
});

test('グループ metadata は別 factory へ復元でき、まだ開いていない画面も保持する', () => {
  const selection = editor();
  selectPair(selection);
  selection.groupSelected({ name: '保存対象' });
  const data = JSON.parse(JSON.stringify(selection.exportMetadata()));
  const restored = createEditorSelection21();
  restored.importMetadata(data);
  restored.useScreen('pack-a|anvil', sampleFile());
  assert.equal(restored.snapshot().groups[0].name, '保存対象');
  assert.deepEqual(restored.select('background').selectedIds, ['background', 'label']);
});

test('不正な metadata は全体を拒否し、それ以前のグループを壊さない', () => {
  const selection = editor();
  selectPair(selection);
  selection.groupSelected();
  const before = selection.exportMetadata();
  const bad = selection.exportMetadata();
  bad.screens.push({ identity: 'later', selectedIds: [], groups: [{ id: 'bad', name: '不正', members: ['a', 'a'] }] });
  assert.throws(() => selection.importMetadata(bad), /重複/);
  assert.deepEqual(selection.exportMetadata(), before);
  assert.throws(() => selection.importMetadata({ schema: 'unknown', screens: [] }), /形式/);
});

test('返却 snapshot を変更しても内部状態も JSON UI 本体も変わらない', () => {
  const file = sampleFile();
  const before = JSON.stringify(file);
  for (const node of Object.values(file.nodesById)) { Object.freeze(node.children); Object.freeze(node); }
  Object.freeze(file.nodesById);
  Object.freeze(file);
  const selection = editor(file);
  selectPair(selection);
  const snapshot = selection.groupSelected();
  snapshot.groups[0].members.push('other');
  snapshot.selectedIds.length = 0;
  snapshot.groups[0].name = '外部変更';
  assert.equal(selection.snapshot().groups[0].members.length, 2);
  assert.equal(selection.snapshot().selectedIds.length, 2);
  assert.equal(JSON.stringify(file), before);
});

test('parentId 形式にも対応し、循環・複数親は明示的に拒否する', () => {
  const file = { rootId: 'root', nodesById: {
    root: { isFileRoot: true }, a: { parentId: 'root' }, b: { parentId: 'a' },
  } };
  assert.deepEqual(movementRootIds21(['b', 'a'], file), ['a']);
  const cyclic = { nodesById: { a: { parentId: 'b' }, b: { parentId: 'a' } } };
  assert.throws(() => movementRootIds21(['a', 'b'], cyclic), /循環/);
  const conflicting = { nodesById: { a: { children: ['c'] }, b: { children: ['c'] }, c: {} } };
  assert.throws(() => movementRootIds21(['c'], conflicting), /複数の親/);
});

test('画面・履歴の上限と明示的な破棄を扱う', () => {
  const selection = createEditorSelection21({ maxScreens: 1, historyLimit: 1 });
  selection.useScreen('one', sampleFile());
  selectPair(selection);
  selection.groupSelected();
  selection.ungroupSelected();
  selection.undoGroup();
  assert.equal(selection.snapshot().canUndoGroup, false);
  assert.throws(() => selection.useScreen('two', sampleFile()), /上限/);
  assert.equal(selection.snapshot().identity, 'one');
  assert.equal(selection.forgetScreen('one'), true);
  selection.useScreen('two', sampleFile());
  assert.equal(selection.clear().identity, null);
  assert.throws(() => selection.select('background'), /useScreen/);
});

test('深い親子グラフでも再帰 stack を使わず親子移動を正しく削減する', () => {
  const nodesById = Object.create(null);
  for (let index = 0; index < 12000; index++) nodesById[`n${index}`] = { parentId: index ? `n${index - 1}` : null };
  const roots = movementRootIds21(['n11999', 'n2', 'n8000'], { nodesById });
  assert.deepEqual(roots, ['n2']);
});
