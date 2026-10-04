import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNamedScrollControls, computeNamedScrollMetrics, createNamedScrollReflowOverrides }
  from '../src/preview/named-scroll-runtime37.js';

const n = (name, children = [], type = 'panel', props = {}) => ({ type, props: { name, ...props }, children });
const names = { scroll_content: 'scrolling_content', scroll_view_port: 'scrolling_view_port',
  scrollbar_track: 'track', scrollbar_box: 'box', scroll_box_and_track_panel: 'bar_and_track' };
const scene = () => ({ root: n('scroll', ['stack', 'ignoredBranch'], 'scroll_view'),
  stack: n('stack_panel', ['background', 'bar'], 'stack_panel'),
  background: n('background_and_viewport', ['viewport']),
  viewport: n('scrolling_view_port', ['content']),
  content: n('scrolling_content@common.template', ['inner']), inner: n('inner'),
  bar: n('bar_and_track', ['padding', 'center']), padding: n('padding'),
  center: n('centered_panel', ['track', 'boxWrap']), track: n('track', [], 'scroll_track'),
  boxWrap: n('scroll_box', ['box']), box: n('box', [], 'scrollbar_box'),
  ignoredBranch: n('ignored_branch', ['duplicate'], 'panel', { ignored: true }),
  duplicate: n('scrolling_content'),
});

test('named scroll: common構造の深い5役を解決し、非表示branchを除外する', () => {
  const nodes = scene(), before = JSON.stringify(nodes);
  const result = resolveNamedScrollControls(nodes, 'root', names);
  assert.equal(result.complete, true);
  assert.deepEqual([result.contentId, result.viewportId, result.trackId, result.boxId, result.barPanelId],
    ['content', 'viewport', 'track', 'box', 'bar']);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(JSON.stringify(nodes), before);
});

test('named scroll: 別scroll_viewの内部へ入らず、明示曖昧名を勝手に選ばない', () => {
  const nodes = scene(); nodes.root.children.push('nested');
  nodes.nested = n('nested', ['foreign'], 'scroll_view'); nodes.foreign = n('scrolling_content');
  assert.equal(resolveNamedScrollControls(nodes, 'root', names).contentId, 'content');
  nodes.root.children.push('second'); nodes.second = n('scrolling_content');
  const ambiguous = resolveNamedScrollControls(nodes, 'root', names);
  assert.equal(ambiguous.contentId, null);
  assert(ambiguous.diagnostics.some(item => item.code === 'NAMED_SCROLL_REFERENCE_AMBIGUOUS'));
});

test('named scroll: 名前未指定・欠落・動的名を区別する', () => {
  const nodes = scene();
  assert.equal(resolveNamedScrollControls(nodes, 'root').references.scroll_content.status, 'absent');
  const result = resolveNamedScrollControls(nodes, 'root', { scroll_content: 'not_here', scrollbar_box: '$runtime_box' });
  assert.equal(result.references.scroll_content.status, 'missing');
  assert.equal(result.references.scrollbar_box.status, 'unresolved');
  assert.equal(result.contentId, null);
});

test('named scroll: 探索仕事量・深さ・循環を有限に止める', () => {
  const nodes = scene();
  const limit = resolveNamedScrollControls(nodes, 'root', names, { maxNodes: 3 });
  assert.equal(limit.complete, false);
  assert(limit.scheduledNodes <= 3);
  assert.equal(limit.contentId, null);
  assert(limit.diagnostics.some(item => item.code === 'NAMED_SCROLL_SCAN_LIMIT'));
  assert.equal(resolveNamedScrollControls(nodes, 'root', names, { maxDepth: 2 }).complete, false);
  nodes.inner.children = ['stack'];
  const cycle = resolveNamedScrollControls(nodes, 'root', names);
  assert.equal(cycle.complete, false);
  assert(cycle.diagnostics.some(item => item.code === 'NAMED_SCROLL_CYCLE'));
});

test('named scroll: barが不要ならslotを1回の再flowで除外できるoverrideを返す', () => {
  const resolved = resolveNamedScrollControls(scene(), 'root', names);
  const metrics = computeNamedScrollMetrics({ viewport: { x: 10, y: 20, w: 100, h: 100 },
    contentBounds: { minX: 10, minY: 20, maxX: 110, maxY: 100 } });
  assert.equal(metrics.scrollbarVisible, false);
  assert.equal(metrics.maxScrollY, 0);
  const prior = { bar: { offset: [1, 2] } };
  const patch = createNamedScrollReflowOverrides(resolved, metrics, prior);
  assert.deepEqual(patch, { bar: { offset: [1, 2], ignored: true } });
  assert.deepEqual(prior, { bar: { offset: [1, 2] } });
  assert.deepEqual(createNamedScrollReflowOverrides(resolved, metrics, patch), {});
});

test('named scroll: viewport内容比でthumbを算出し、末尾超過もtrack内へclampする', () => {
  const input = { viewport: { x: 10, y: 20, w: 100, h: 100 },
    contentBounds: { minX: 10, minY: 20, maxX: 110, maxY: 420 },
    trackRect: { x: 112, y: 22, w: 3, h: 96 } };
  const top = computeNamedScrollMetrics(input);
  assert.equal(top.thumbHeight, 24);
  assert.equal(top.thumbY, 22);
  assert.equal(top.maxScrollY, 300);
  const bottom = computeNamedScrollMetrics({ ...input, scrollY: 9999 });
  assert.equal(bottom.clampedScrollY, 300);
  assert.equal(bottom.thumbY + bottom.thumbHeight, 118);
  assert.equal(computeNamedScrollMetrics({ ...input, scrollY: -100 }).clampedScrollY, 0);
  assert.equal(computeNamedScrollMetrics({ ...input, scrollY: 150 }).thumbY, 58);
});

test('named scroll: always-visible / 空 / 非数geometryを区別する', () => {
  const viewport = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(computeNamedScrollMetrics({ viewport, alwaysVisible: true }).scrollbarVisible, true);
  assert.equal(computeNamedScrollMetrics({ viewport }).scrollbarVisible, false);
  assert.equal(computeNamedScrollMetrics({ viewport: { ...viewport, h: Number.NaN } }).ok, false);
  assert.equal(computeNamedScrollMetrics({ viewport: { ...viewport, x: -1e308 },
    contentBounds: { minX: -1e308, minY: 0, maxX: 1e308, maxY: 1 } }).ok, false);
});

test('named scroll: 観測home/routesの非整数thumbを論理pixelで切り上げ、track端を超えない', () => {
  const input = { viewport: { x: 0, y: 0, w: 100, h: 164 }, trackRect: { x: 100, y: 2, w: 5, h: 160 } };
  for (const [height, expected] of [[187, 141], [173.5, 152]]) {
    const contentBounds = { minX: 0, minY: 0, maxX: 100, maxY: height };
    const top = computeNamedScrollMetrics({ ...input, contentBounds });
    assert.equal(top.thumbHeight, expected); assert.equal(top.thumbY, 2);
    const end = computeNamedScrollMetrics({ ...input, contentBounds, scrollY: 1000 });
    assert.equal(end.thumbY + end.thumbHeight, 162);
  }
  const tiny = computeNamedScrollMetrics({ viewport: { x: 0, y: 0, w: 1, h: 1 },
    trackRect: { x: 0, y: 0, w: 1, h: 0.5 }, contentBounds: { minX: 0, minY: 0, maxX: 1, maxY: 10 } });
  assert.equal(tiny.thumbHeight, 0.5);
});
