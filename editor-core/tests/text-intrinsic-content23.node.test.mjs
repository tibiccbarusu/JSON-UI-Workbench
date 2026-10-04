import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayoutBoxesForFile, estimateTextIntrinsicSize } from '../src/preview/canvas-preview.js';

const metric = '__jsonui_preview_text_intrinsic_size';
function fixture(props = {}, children = [], type = 'label') {
  return { rootId: 'root', nodesById: {
    root: { id: 'root', type: 'panel', props: { size: [200, 100] }, children: ['label'] },
    label: { id: 'label', type, props: { text: 'book.signButton', ...props }, children: children.map(child => child.id) },
    ...Object.fromEntries(children.map(child => [child.id, { type: 'panel', children: [], ...child }])),
  } };
}
function layout(file, intrinsic = [16, 8]) {
  const overrides = { label: { [metric]: intrinsic } };
  const before = JSON.stringify({ file, overrides });
  const result = computeLayoutBoxesForFile(file, { width: 200, height: 100 }, { propsByIdOverride: overrides });
  assert.equal(JSON.stringify({ file, overrides }), before, '測定値を原本へ書き込まない');
  return result;
}
function size(result, id = 'label') {
  const box = result.boxes.find(item => item.id === id);
  assert.ok(box, id);
  return [box.w, box.h];
}

test('日本語実測をdefaultと葉labelの%c制約へ使い、署名幅を0にしない', () => {
  for (const props of [{}, { size: ['default', 'default'] }]) {
    const result = layout(fixture({ ...props, max_size: ['100%c', 10] }));
    assert.deepEqual(size(result), [16, 8]);
    assert.deepEqual(result.warnings, []);
  }
});

test('葉labelの%c/%cm sizeとmin_sizeに内在寸法を供給する', () => {
  for (const unit of ['c', 'cm']) {
    assert.deepEqual(size(layout(fixture({ size: [`100%${unit} + 4px`, `100%${unit} + 2px`] }))), [20, 10]);
    assert.deepEqual(size(layout(fixture({ size: [1, 1], min_size: [`100%${unit}`, `100%${unit}`] }))), [16, 8]);
  }
});

test('明示sizeを実測へ置換せず、authoringのmin/maxと0を保つ', () => {
  assert.deepEqual(size(layout(fixture({ size: [70, 20] }))), [70, 20]);
  assert.deepEqual(size(layout(fixture({ size: [0, 0] }))), [0, 0]);
  assert.deepEqual(size(layout(fixture({ size: [9, 'default'] }))), [9, 8]);
  for (const props of [{}, { size: ['default', 'default'] }, { size: [70, 20] }]) {
    assert.deepEqual(size(layout(fixture({ ...props, max_size: [0, 0] }))), [0, 0]);
  }
  assert.deepEqual(size(layout(fixture({ size: [70, 20], max_size: ['100%c', 10] }))), [16, 10]);
});

test('子ありlabelの%c/%cmは既存の子の寸法を維持する', () => {
  for (const unit of ['c', 'cm']) {
    const file = fixture({ size: [`100%${unit}`, `100%${unit}`] }, [
      { id: 'padding', props: { size: [6, 10] } },
      { id: 'icon', props: { size: [40, 12] } },
    ]);
    const result = layout(file, [90, 30]);
    assert.deepEqual(size(result), unit === 'c' ? [46, 22] : [40, 12]);
    assert.deepEqual(size(result), size(computeLayoutBoxesForFile(file, { width: 200, height: 100 })));
  }
});

test('非表示の子を持つlabelを葉と誤認して内在寸法へ置換しない', () => {
  const file = fixture({ size: ['100%c', '100%c'] }, [{ id: 'hidden', props: { visible: false, size: [40, 12] } }]);
  assert.deepEqual(size(layout(file)), [0, 0]);
});

test('無効・上限超過のpreview内在寸法を拒否し通常推定へ戻る', () => {
  const file = fixture({ size: ['default', 'default'], text: 'AB' });
  const expected = estimateTextIntrinsicSize(file.nodesById.label.props);
  for (const invalid of [null, [], [16], [16, 8, 1], ['16', 8], [NaN, 8], [Infinity, 8], [-1, 8], [10_000_001, 8], { w: 16, h: 8 }, [, 8], new Array(2)]) {
    assert.deepEqual(size(layout(file, invalid)), [expected.w, expected.h]);
  }
  assert.deepEqual(size(layout(file, [0, 0])), [0, 0], '空の文字列寸法0は正当');
  assert.deepEqual(size(layout(file, [10_000_000, 8])), [10_000_000, 8], '既存layout上限まで受け付ける');
});

test('metadataなしの葉labelは推定寸法を%cに使う', () => {
  const file = fixture({ size: ['100%c', '100%cm'], text: 'AB' });
  const expected = estimateTextIntrinsicSize(file.nodesById.label.props);
  assert.deepEqual(size(computeLayoutBoxesForFile(file, { width: 200, height: 100 })), [expected.w, expected.h]);
});

test('panelの%cと省略sizeの既存基準へlabel metadataを混入しない', () => {
  for (const props of [{}, { size: ['100%c', '100%cm'] }, { size: [20, 30], max_size: [10, 10] }]) {
    const file = fixture(props, [], 'panel');
    const base = computeLayoutBoxesForFile(file, { width: 200, height: 100 });
    assert.deepEqual(size(layout(file)), size(base));
  }
});
