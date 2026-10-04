import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorSelection21, marqueeViewport21 } from '../src/ui/editor-selection21.js';

function fixture() {
  const selection = createEditorSelection21();
  selection.useScreen('pack|screen', { rootId: 'root', nodesById: {
    root: { children: ['a', 'b', 'c'], isFileRoot: true }, a: {}, b: {}, c: {},
  } });
  return selection;
}
test('矩形選択は祖先clipに隠れたboxとゼロ面積clipを除外する', () => {
  const selection = fixture();
  const boxes = [
    { id: 'a', x: 50, y: 50, w: 10, h: 10, clipRect: { x: 0, y: 0, w: 20, h: 20 } },
    { id: 'b', x: 1, y: 1, w: 10, h: 10, clipRect: { x: 1, y: 1, w: 0, h: 5 } },
    { id: 'c', x: 3, y: 3, w: 2, h: 2, clipRect: null },
  ];
  assert.deepEqual(selection.selectBox({ x: 0, y: 0, w: 100, h: 100 }, boxes).selectedIds, ['c']);
});
test('一部clipされた要素は見えている領域の包含と交差で選択する', () => {
  const selection = fixture();
  const boxes = [{ id: 'a', x: 0, y: 0, w: 40, h: 40, clipRect: { x: 10, y: 10, w: 10, h: 10 } }];
  assert.deepEqual(selection.selectBox({ x: 10, y: 10, w: 10, h: 10 }, boxes).selectedIds, ['a']);
  assert.deepEqual(selection.selectBox({ x: 0, y: 0, w: 9, h: 9 }, boxes, { mode: 'intersect' }).selectedIds, []);
  assert.deepEqual(selection.selectBox({ x: 19, y: 19, w: 2, h: 2 }, boxes, { mode: 'intersect' }).selectedIds, ['a']);
});
test('Canvas外へ捕捉dragしても現在の可視world矩形外の要素は選択しない', () => {
  const selection = fixture();
  const boxes = [{ id: 'a', x: 0, y: 0, w: 20, h: 20 }, { id: 'b', x: 110, y: 60, w: 10, h: 10 }];
  const viewport = marqueeViewport21({ view: { viewX: 100, viewY: 50, zoom: 2 }, canvasWidth: 200, canvasHeight: 100, logicalWidth: 500, logicalHeight: 500 });
  assert.deepEqual(viewport, { x: 100, y: 50, w: 100, h: 50 });
  assert.deepEqual(selection.selectBox({ x: -100, y: -100, w: 600, h: 600 }, boxes, { viewport }).selectedIds, ['b']);
});
test('Canvas可視範囲とゲーム範囲の共通部分を使い、全てpanで外れた時は選択を空にする', () => {
  const args = { view: { viewX: -20, viewY: -10, zoom: 0.5 }, canvasWidth: 100, canvasHeight: 80, logicalWidth: 80, logicalHeight: 60 };
  assert.deepEqual(marqueeViewport21(args), { x: 0, y: 0, w: 80, h: 60 });
  const viewport = marqueeViewport21({ ...args, view: { viewX: 200, viewY: 100, zoom: 1 } });
  const selection = fixture(); selection.select('a');
  assert.deepEqual(selection.selectBox({ x: 0, y: 0, w: 1000, h: 1000 }, [{ id: 'a', x: 0, y: 0, w: 5, h: 5 }], { viewport }).selectedIds, []);
});
test('不正viewportは旧選択を保って拒否し、clipとboxの元データを変更しない', () => {
  const selection = fixture(); selection.select('a');
  assert.throws(() => selection.selectBox({ x: 0, y: 0, w: 10, h: 10 }, [], { viewport: { x: 0, y: 0, w: NaN, h: 10 } }), /表示領域/);
  assert.deepEqual(selection.snapshot().selectedIds, ['a']);
  assert.throws(() => marqueeViewport21({ view: { viewX: 0, viewY: 0, zoom: 0 }, canvasWidth: 10, canvasHeight: 10, logicalWidth: 10, logicalHeight: 10 }), /不正/);
  const clipRect = Object.freeze({ x: 0, y: 0, w: 10, h: 10 });
  const box = Object.freeze({ id: 'a', x: 0, y: 0, w: 20, h: 20, clipRect });
  assert.deepEqual(selection.selectBox({ x: 10, y: 10, w: -10, h: -10 }, [box]).selectedIds, ['a']);
  assert.equal(box.clipRect, clipRect); assert.equal(box.w, 20);
});
