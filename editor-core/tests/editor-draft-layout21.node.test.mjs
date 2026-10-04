import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPendingLayout21, mergePendingProperties21, movementDelta21 } from '../src/ui/editor-draft-layout21.js';
import { hitTestBoxes, computeLayoutBoxesForFile } from '../src/preview/canvas-preview.js';

const box = (id, parentId = null, extra = {}) => ({ id, parentId, x: 10, y: 20, w: 30, h: 40, type: 'panel', depth: 0, layer: 0, order: 0, ...extra });
const layout = (...boxes) => ({ boxes, preset: { width: 1000, height: 1000 }, stats: { boxCount: boxes.length } });
const transform = (dx = 0, dy = 0, properties = {}) => ({ dx, dy, deleted: false, properties });
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freezeDeep(child); }
  return value;
}

test('変更なしは同一layoutと同一overridesを返して不要な再計算を避ける', () => {
  const base = layout(box('a')), overrides = { a: { text: '元' } };
  assert.equal(applyPendingLayout21(base), base); assert.equal(mergePendingProperties21(overrides), overrides);
  assert.equal(applyPendingLayout21(null, new Map()), null);
});

test('親子の移動は加算し、選択していない子孫にも親の移動だけ伝える', () => {
  const base = layout(box('parent'), box('child', 'parent'), box('grandchild', 'child'), box('sibling', 'parent'), box('other'));
  const result = applyPendingLayout21(base, new Map([['parent', transform(5, 7)], ['child', transform(-3, 4)]]));
  assert.deepEqual(result.boxes.map(item => [item.id, item.x, item.y]), [
    ['parent', 15, 27], ['child', 12, 31], ['grandchild', 12, 31], ['sibling', 15, 27], ['other', 10, 20],
  ]);
});

test('子孫が親より前の配列でも同じ和になり、負の座標へ正しく移動する', () => {
  const result = applyPendingLayout21(layout(box('child', 'parent'), box('parent')), new Map([['parent', transform(-100, -80)], ['child', transform(1, -2)]]));
  assert.deepEqual(result.boxes.map(item => [item.x, item.y]), [[-89, -62], [-90, -60]]);
});

test('親を削除またはvisible falseにすると子孫も消し、兄弟の枝を残す', () => {
  for (const change of [{ deleted: true }, { properties: { visible: false } }]) {
    const result = applyPendingLayout21(layout(box('root'), box('a', 'root'), box('b', 'a'), box('c', 'root')),
      new Map([['a', change], ['b', { properties: { visible: true } }]]));
    assert.deepEqual(result.boxes.map(item => item.id), ['root', 'c']);
  }
});

test('子だけの削除は親と兄弟を削除しない', () => {
  const result = applyPendingLayout21(layout(box('root'), box('a', 'root'), box('b', 'root')), new Map([['a', { deleted: true }]]));
  assert.deepEqual(result.boxes.map(item => item.id), ['root', 'b']);
});

test('自分の移動でも親の移動でもclipRectを平行移動せず、交差済み祖先clipを保持', () => {
  const clip = { x: 0, y: 0, w: 15, h: 35 };
  const base = layout(box('parent'), box('child', 'parent', { clipRect: clip }));
  const result = applyPendingLayout21(base, new Map([['parent', transform(5, -6)], ['child', transform(10, 2)]]));
  assert.deepEqual(result.boxes[1].clipRect, clip); assert.notEqual(result.boxes[1].clipRect, clip, '返却矩形を変更しても元clipへ届かない');
  assert.deepEqual([result.boxes[1].x, result.boxes[1].y], [25, 16]);
});

test('実hitTestBoxesもclipRectを使い、祖先clipの外へ動いた部分を選択しない', () => {
  const base = layout(box('child', null, { x: 0, y: 0, w: 50, h: 20, clipRect: { x: 0, y: 0, w: 20, h: 20 } }));
  const result = applyPendingLayout21(base, new Map([['child', transform(10, 0)]]));
  assert.equal(hitTestBoxes(result.boxes, 15, 10)?.id, 'child');
  assert.equal(hitTestBoxes(result.boxes, 25, 10), null, '表示領域が右に動いても祖先clipは右へ広がらない');
});

test('clipRect nullを保持し、旧clipという無関係なデータを誤操作しない', () => {
  const oldClip = { x: 9, y: 10, w: 11, h: 12 };
  const result = applyPendingLayout21(layout(box('a', null, { clipRect: null, clip: oldClip })), new Map([['a', transform(5, 6)]]));
  assert.equal(result.boxes[0].clipRect, null); assert.equal(result.boxes[0].clip, oldClip);
});

test('数値sizeは0を含めて仮表示し、symbolicやmixed sizeは確定寸法を保持', () => {
  assert.deepEqual(applyPendingLayout21(layout(box('a')), new Map([['a', transform(0, 0, { size: [0, 55] })]])).boxes.map(item => [item.w, item.h]), [[0, 55]]);
  for (const size of [['50%', 55], ['40px', '20px'], '$size', ['100%c', '100%c'], [1], null]) {
    const result = applyPendingLayout21(layout(box('a')), new Map([['a', transform(0, 0, { size })]]));
    assert.deepEqual([result.boxes[0].w, result.boxes[0].h], [30, 40]);
  }
});

test('offsetの数値差分と後続deltaを加え、元の確定boxから仮表示する', () => {
  const result = applyPendingLayout21(layout(box('a')), new Map([['a', transform(2, -3, { offset: [9, 15] })]]),
    { nodesById: { a: { props: { offset: [4, 5] } } } });
  assert.deepEqual([result.boxes[0].x, result.boxes[0].y], [17, 27]);
});

test('評価済みnodeOverridesのoffsetを実node.propsより優先し、px文字列も安全に読む', () => {
  const result = applyPendingLayout21(layout(box('a')), new Map([['a', transform(1, 2, { offset: ['10px', '-4.5'] })]]),
    { nodesById: { a: { props: { offset: [100, 200] } } }, propsByIdOverride: { a: { offset: ['2px', -1.5] } } });
  assert.deepEqual([result.boxes[0].x, result.boxes[0].y], [19, 19]);
});

test('propsByIdOverrideにoffsetがなければ実node.propsへ戻り、nodeOverrides別名も扱う', () => {
  for (const context of [
    { nodesById: { a: { props: { offset: [3, 4] } } }, propsByIdOverride: { a: { text: '評価済み文字' } } },
    { nodeOverrides: { a: { offset: [3, 4] } } },
    { nodesById: new Map([['a', { props: { offset: [3, 4] } }]]) },
  ]) {
    const result = applyPendingLayout21(layout(box('a')), new Map([['a', transform(1, 2, { offset: [8, 9] })]]), context);
    assert.deepEqual([result.boxes[0].x, result.boxes[0].y], [16, 27]);
  }
});

test('symbolicまたは不明の絶対offsetでは後続deltaも旧基準へ誤適用しない', () => {
  for (const context of [{}, { nodesById: { a: { props: { offset: ['50%', 0] } } } },
    { nodesById: { a: { props: { offset: [1, 2] } } }, propsByIdOverride: { a: { offset: '$runtime' } } }]) {
    const result = applyPendingLayout21(layout(box('a')), new Map([['a', transform(10, 20, { offset: [100, 200] })]]), context);
    assert.deepEqual([result.boxes[0].x, result.boxes[0].y], [10, 20]);
  }
  const result = applyPendingLayout21(layout(box('a')), new Map([['a', transform(10, 20, { offset: ['50%', 3] })]]),
    { nodesById: { a: { props: { offset: [1, 2] } } } });
  assert.deepEqual([result.boxes[0].x, result.boxes[0].y], [10, 20]);
});

test('子の不明offsetを保留しても、親の独立した移動は子へ伝える', () => {
  const result = applyPendingLayout21(layout(box('parent'), box('child', 'parent')), new Map([
    ['parent', transform(5, 6)], ['child', transform(100, 100, { offset: ['$x', 0] })],
  ]), { nodesById: { child: { props: { offset: [0, 0] } } } });
  assert.deepEqual([result.boxes[1].x, result.boxes[1].y], [15, 26]);
});

test('親の絶対offset差分と子の絶対offset差分をそれぞれ一度だけ加算', () => {
  const result = applyPendingLayout21(layout(box('p'), box('c', 'p')), new Map([
    ['p', transform(1, 2, { offset: [5, 9] })], ['c', transform(-2, 1, { offset: [3, 8] })],
  ]), { nodesById: { p: { props: { offset: [2, 3] } }, c: { props: { offset: [1, 4] } } } });
  assert.deepEqual(result.boxes.map(item => [item.x, item.y]), [[14, 28], [14, 33]]);
});

test('循環と自己参照は明示エラーで停止し、無限ループや入力変更を起こさない', () => {
  for (const base of [layout(box('a', 'a')), layout(box('a', 'b'), box('b', 'a')), layout(box('tail', 'a'), box('a', 'b'), box('b', 'a'))]) {
    const before = structuredClone(base);
    assert.throws(() => applyPendingLayout21(base, new Map([['a', transform(1, 2)]])), { code: 'EDITOR_DRAFT_PARENT_CYCLE' });
    assert.deepEqual(base, before);
  }
});

test('深い階層は再帰スタックを使わず処理し、行順に依存しない', () => {
  const count = 12000;
  const boxes = Array.from({ length: count }, (_value, i) => box(String(i), i ? String(i - 1) : null)).reverse();
  const result = applyPendingLayout21(layout(...boxes), new Map([['0', transform(1, 2)], [String(count - 1), transform(3, 4)]]));
  assert.deepEqual([result.boxes[0].x, result.boxes[0].y], [14, 26]);
});

test('parentIdの0をルート扱いせず、未収録の親IDは確定座標の境界として扱う', () => {
  const result = applyPendingLayout21(layout(box(0), box('child', 0), box('orphan', 'not-in-layout')), new Map([['0', transform(2, 3)], ['orphan', transform(1, 1)]]));
  assert.deepEqual(result.boxes.map(item => [item.x, item.y]), [[12, 23], [12, 23], [11, 21]]);
});

test('重複ID・空ID・非Map変換は黙って別要素へ適用せず拒否', () => {
  assert.throws(() => applyPendingLayout21(layout(box('a'), box('a')), new Map([['a', transform(1, 2)]])), { code: 'EDITOR_DRAFT_NODE_INVALID' });
  assert.throws(() => applyPendingLayout21(layout(box('')), new Map([['a', transform(1, 2)]])), { code: 'EDITOR_DRAFT_NODE_INVALID' });
  assert.throws(() => applyPendingLayout21(layout(box('a')), { size: 1 }), { code: 'EDITOR_DRAFT_TRANSFORMS_INVALID' });
});

test('変換・size・offset・確定boxの非finiteを拒否し数値文字列をdeltaへ暗黙変換しない', () => {
  for (const dx of [NaN, Infinity, -Infinity, '2', null, undefined]) {
    assert.throws(() => applyPendingLayout21(layout(box('a')), new Map([['a', { dx }]])), { code: 'EDITOR_DRAFT_NONFINITE' });
  }
  for (const size of [[NaN, 1], ['50%', Infinity], [-1, 2]]) {
    assert.throws(() => applyPendingLayout21(layout(box('a')), new Map([['a', transform(0, 0, { size })]])));
  }
  assert.throws(() => applyPendingLayout21(layout(box('a')), new Map([['a', transform(0, 0, { offset: [Infinity, 0] })]]), { nodesById: { a: { props: { offset: [0, 0] } } } }), { code: 'EDITOR_DRAFT_NONFINITE' });
  assert.throws(() => applyPendingLayout21(layout(box('a', null, { x: NaN })), new Map([['a', transform(1, 1)]])), { code: 'EDITOR_DRAFT_NONFINITE' });
});

test('有限入力の加算overflowも非finiteとして拒否', () => {
  assert.throws(() => applyPendingLayout21(layout(box('p'), box('c', 'p')), new Map([['p', transform(Number.MAX_VALUE, 0)], ['c', transform(Number.MAX_VALUE, 0)]])), { code: 'EDITOR_DRAFT_NONFINITE' });
  assert.throws(() => applyPendingLayout21(layout(box('a', null, { x: Number.MAX_VALUE })), new Map([['a', transform(Number.MAX_VALUE, 0)]])), { code: 'EDITOR_DRAFT_NONFINITE' });
});

test('deepFreezeしたlayout・変換・確定属性を変更せず、clipコピーも元へ影響しない', () => {
  const base = freezeDeep(layout(box('a', null, { clipRect: { x: 0, y: 0, w: 100, h: 100 } })));
  const change = freezeDeep(transform(1, 2, { offset: [3, 4], size: [20, 10] }));
  const context = freezeDeep({ nodesById: { a: { props: { offset: [1, 1] } } } });
  const result = applyPendingLayout21(base, new Map([['a', change]]), context);
  result.boxes[0].clipRect.x = 999;
  assert.equal(base.boxes[0].clipRect.x, 0); assert.deepEqual(change.properties.offset, [3, 4]);
});

test('属性の草稿を別オブジェクトへ重ね、元属性とプロトタイプを破壊しない', () => {
  const overrides = freezeDeep({ a: { text: '元', color: [1, 1, 1] } });
  const changes = new Map([['a', freezeDeep(transform(0, 0, { text: '変更' }))], ['__proto__', transform(0, 0, { text: '要素名' })]]);
  const result = mergePendingProperties21(overrides, changes);
  assert.equal(result.a.text, '変更'); assert.equal(overrides.a.text, '元'); assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true); assert.equal(result.__proto__.text, '要素名'); assert.equal({}.text, undefined);
});

test('movementDeltaは負数・小数を保持し、不正値と差分overflowを拒否', () => {
  assert.deepEqual(movementDelta21({ x: 10.1234, y: -4 }, { x: 9, y: -6.0004 }), [-1.123, -2]);
  for (const x of [NaN, Infinity, '3', null, undefined]) assert.throws(() => movementDelta21({ x, y: 0 }, { x: 1, y: 1 }), { code: 'EDITOR_DRAFT_NONFINITE' });
  assert.throws(() => movementDelta21({ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }), { code: 'EDITOR_DRAFT_NONFINITE' });
  assert.deepEqual(movementDelta21({ x: 0, y: 0 }, { x: Number.MAX_VALUE, y: 0 }), [Number.MAX_VALUE, 0]);
});


test('symbolicなoffsetが混在しても、別軸のInfinityやNaNを見逃さない', () => {
  for (const offset of [['$x', Infinity], ['50%', NaN], [Infinity, '$y']]) {
    assert.throws(() => applyPendingLayout21(layout(box('a')), new Map([['a', transform(1, 2, { offset })]])), { code: 'EDITOR_DRAFT_NONFINITE' });
  }
});

test('変換本体とIDの型異常を拒否し、Map型の確定属性も保持する', () => {
  for (const value of [false, 3, NaN, [], 'move']) assert.throws(() => applyPendingLayout21(layout(box('a')), new Map([['a', value]])), { code: 'EDITOR_DRAFT_TRANSFORM_INVALID' });
  for (const id of [{}, [], NaN, Infinity]) assert.throws(() => applyPendingLayout21(layout(box(id)), new Map([['a', transform(1, 2)]])), { code: 'EDITOR_DRAFT_NODE_INVALID' });
  const base = new Map([['a', { text: '元', visible: true }], ['b', { text: '別' }]]);
  const result = mergePendingProperties21(base, new Map([['a', transform(0, 0, { text: '変更' })]]));
  assert.deepEqual(result, { a: { text: '変更', visible: true }, b: { text: '別' } });
  assert.equal(base.get('a').text, '元');
});


test('既知nodeのoffset省略は[0,0]であり、実layout計算と草稿結果が一致する', () => {
  const file = { rootId: 'root', nodesById: {
    root: { id: 'root', type: 'file', isFileRoot: true, props: {}, children: ['a'] },
    a: { id: 'a', type: 'panel', props: { size: [30, 40], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
  } };
  const preset = { width: 200, height: 100 };
  const before = computeLayoutBoxesForFile(file, preset);
  const pending = applyPendingLayout21(before, new Map([['a', transform(2, -3, { offset: [10, 20] })]]), { nodesById: file.nodesById });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { a: { offset: [12, 17] } } });
  assert.deepEqual(pending.boxes.map(item => [item.id, item.x, item.y, item.w, item.h]), committed.boxes.map(item => [item.id, item.x, item.y, item.w, item.h]));
  const unknown = applyPendingLayout21(before, new Map([['a', transform(2, -3, { offset: [10, 20] })]]));
  assert.deepEqual(unknown.boxes.map(item => [item.x, item.y]), before.boxes.map(item => [item.x, item.y]), 'node不明時に0と仮定しない');
});

test('legacy x/yがoffsetより優先する実layoutでは、offset変更を仮移動へ誤変換しない', () => {
  const file = { rootId: 'root', nodesById: {
    root: { id: 'root', type: 'file', isFileRoot: true, props: {}, children: ['a'] },
    a: { id: 'a', type: 'panel', props: { x: 12, y: 34, offset: [1, 2], size: [30, 40] }, children: [] },
  } };
  const preset = { width: 200, height: 100 }, before = computeLayoutBoxesForFile(file, preset);
  const pending = applyPendingLayout21(before, new Map([['a', transform(0, 0, { offset: [10, 20] })]]), { nodesById: file.nodesById });
  const committed = computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { a: { offset: [10, 20] } } });
  assert.deepEqual(pending.boxes.map(item => [item.x, item.y]), committed.boxes.map(item => [item.x, item.y]));
  assert.deepEqual(pending.boxes.map(item => [item.x, item.y]), before.boxes.map(item => [item.x, item.y]));
});
