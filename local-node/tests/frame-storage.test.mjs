import test from 'node:test';
import assert from 'node:assert/strict';
import { ImmutableJsonSize, FrameResultCache } from '../frame-storage.mjs';
import { applyRetainedPaintAnimation } from '../frame-paint.mjs';
import { applyPreviewPaintAnimation } from '../../editor-core/src/ui/preview-workspace.js';
import { FrameIrProcessor } from '../frame-ir.mjs';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';

test('不変IRサイズ: 日本語・制御文字・孤立surrogate・共有部分木・undefinedをJSON UTF-8と同じサイズで計数', () => {
  const sizer = new ImmutableJsonSize();
  const shared = { 日本語: '日本語😀\n\t\u0000\ud800', value: null, omitted: undefined, number: -0, nonFinite: Infinity };
  const input = { a: shared, b: [shared, undefined, true, false, NaN], nested: { '"\\': 'x' } };
  for (const value of [input, { ...input, changed: '値' }, shared, ['x', undefined]]) {
    const expected = Buffer.byteLength(JSON.stringify(value));
    assert.equal(sizer.bytes(value), expected);
    assert.equal(sizer.bytes(value, expected), expected);
    assert.throws(() => sizer.bytes(value, expected - 1), /NODE_FRAME_REPLY_LIMIT/);
  }
  const cycle = {}; cycle.child = cycle;
  assert.throws(() => sizer.bytes(cycle), /NODE_FRAME_REPLY_LIMIT/);
  assert.throws(() => sizer.bytes({ value: 1n }), /NODE_FRAME_REPLY_LIMIT/);
  const accessor = Object.defineProperty({}, 'a', { get() { throw new Error('must not run'); }, enumerable: true });
  assert.throws(() => sizer.bytes(accessor), /NODE_FRAME_REPLY_LIMIT/);
  sizer.clear(); assert.equal(sizer.bytes(input), Buffer.byteLength(JSON.stringify(input)));
});

test('不変IRキャッシュ: entry数と完全JSONサイズでLRUを制限しclearで解放', () => {
  const cache = new FrameResultCache({ maxEntries: 2, maxBytes: 100 });
  cache.set('a', { a: 1 }, 40); cache.set('b', { b: 2 }, 40);
  assert.deepEqual(cache.get('a').result, { a: 1 });
  cache.set('c', { c: 3 }, 40); assert.equal(cache.get('b'), null);
  cache.set('oversize', {}, 101); assert.equal(cache.get('oversize'), null);
  assert.equal(cache.snapshot().bytes, 80); assert.equal(cache.snapshot().entries, 2);
  cache.clear(); assert.equal(cache.snapshot().bytes, 0); assert.equal(cache.get('a'), null);
});

test('保持paint: painter順序に依存せずalpha伝播を既存計算と一致、無変化boxと元frameを保持', () => {
  const nodes = {
    root: { props: { alpha: 0.7, propagate_alpha: 'true' } },
    middle: { props: { alpha: 0.8, propagate_alpha: true } },
    leaf: { props: { alpha: 0.5 } },
    detached: { props: { alpha: 1 } },
  };
  const layout = { boxes: [{ id: 'leaf', parentId: 'middle', renderAlpha: 0.28 },
    { id: 'middle', parentId: 'root', renderAlpha: 0.56 }, { id: 'root', renderAlpha: 0.7 },
    { id: 'detached', renderAlpha: 1 }], warnings: [] };
  const before = JSON.stringify(layout);
  for (const overrides of [{}, { root: { alpha: 0.2 } }, { middle: { propagate_alpha: false } },
    { leaf: { alpha: undefined } }, { root: { alpha: '0.3' }, leaf: { alpha: Infinity } }]) {
    const actual = applyRetainedPaintAnimation(layout, nodes, overrides);
    assert.deepEqual(actual, applyPreviewPaintAnimation(layout, nodes, overrides));
    assert.equal(actual.boxes[3], layout.boxes[3]);
    assert.equal(JSON.stringify(layout), before);
  }
});

test('保持IR: 入力modelの後続変更と返却JSONの書換えが保持frameへ混入しない', () => {
  const processor = new FrameIrProcessor();
  const uiModel = buildUiScreenModelFromJson({ namespace: 'storage', screen: { type: 'screen', controls: [
    { label: { type: 'label', text: '元の文字列', size: [30, 10] } },
  ] } }, { filePath: 'ui/storage.json' });
  const file = { ...buildTreeFromUiScreenModel(uiModel), uiModel };
  const first = JSON.parse(processor.execute({ file, preset: { width: 320, height: 180 } }).body);
  const original = JSON.stringify(first.layout);
  first.layout.boxes[0].w = 12345;
  for (const node of Object.values(file.nodesById)) node.props.text = '外部変更';
  const next = JSON.parse(processor.execute({ modelId: first.modelId, preset: { width: 320, height: 180 } }).body);
  assert.equal(JSON.stringify(next.layout), original); assert.equal(next.metrics.cacheHit, true);
});
