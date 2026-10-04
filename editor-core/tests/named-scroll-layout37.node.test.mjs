import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayoutBoxesForFile, hitTestBoxes } from '../src/preview/canvas-preview.js';

const preset = { width: 320, height: 240, name: 'named-scroll-layout37' };
const point = (x, y, w, h) => ({ x, y, w, h });
const geometry = box => point(box.x, box.y, box.w, box.h);
function scene(contentHeight = 200) {
  const file = { rootId: 'root', nodesById: {} }, nodes = file.nodesById;
  const node = (id, name, type, size, children = [], extra = {}) => {
    nodes[id] = { id, type, props: { name, ...(size ? { size } : {}),
      anchor_from: 'top_left', anchor_to: 'top_left', ...extra }, children };
  };
  node('root', 'root', 'screen', ['100%', '100%'], ['scroll']);
  node('scroll', 'scroll', 'scroll_view', [100, 80], ['wrapper'], { offset: [20, 10],
    scroll_content: 'content', scroll_view_port: 'viewport',
    scrollbar_track: 'track', scrollbar_box: 'box', scroll_box_and_track_panel: 'bar' });
  node('wrapper', 'wrapper', 'stack_panel', ['100%', '100%'], ['viewportHolder', 'bar'], { orientation: 'horizontal' });
  node('viewportHolder', 'viewportHolder', 'panel', ['fill', '100%'], ['viewport']);
  node('viewport', 'viewport', 'panel', ['100%', '100%'], ['content']);
  node('content', 'content', 'panel', ['100%', contentHeight], ['marker']);
  node('marker', 'marker', 'image', [10, 10], [], { offset: [5, 0], layer: 2 });
  node('bar', 'bar', 'panel', [8, '100%'], ['track', 'thumbHolder']);
  node('track', 'track', 'scroll_track', null);
  node('thumbHolder', 'thumbHolder', 'panel', ['100%', '100%'], ['box']);
  node('box', 'box', 'scrollbar_box', null, ['handle']);
  node('handle', 'handle', 'image', [5, '100%'], [], { layer: 3 });
  return file;
}
const lookup = layout => Object.fromEntries(layout.boxes.map(box => [box.id, box]));

test('named scroll layout: 深い本文だけ移動し、wrapper / viewport / rail を固定する', () => {
  const file = scene(), original = JSON.stringify(file);
  const base = computeLayoutBoxesForFile(file, preset);
  const moved = computeLayoutBoxesForFile(file, preset, { scrollById: { scroll: { x: 0, y: 30 } } });
  const a = lookup(base), b = lookup(moved);
  assert.equal(b.content.y, a.content.y - 30);
  assert.equal(b.marker.y, a.marker.y - 30);
  for (const id of ['wrapper', 'viewportHolder', 'viewport', 'bar', 'track']) assert.deepEqual(geometry(b[id]), geometry(a[id]), id);
  assert.deepEqual(b.content.clipRect, geometry(b.viewport));
  assert.deepEqual(b.marker.clipRect, geometry(b.viewport));
  assert.equal(b.track.clipRect, null);
  assert.equal(moved.scrollMetaById.scroll.contentChildId, 'content');
  assert.deepEqual(moved.scrollMetaById.scroll.viewport, geometry(b.viewport));
  assert.equal(moved.stats.namedScrollPasses, 2);
  assert.equal(JSON.stringify(file), original);
});

test('named scroll layout: thumbの実寸と配下100%画像を同時に変える', () => {
  const layout = computeLayoutBoxesForFile(scene(), preset, { scrollById: { scroll: { y: 60 } } });
  const boxes = lookup(layout);
  assert.equal(boxes.track.h, 80);
  assert.equal(boxes.box.h, 32);
  assert.equal(boxes.handle.h, 32);
  assert.equal(boxes.box.y, boxes.track.y + 24);
  assert.equal(boxes.handle.y, boxes.box.y);
  assert.equal(layout.scrollMetaById.scroll.maxScrollY, 120);
});

test('named scroll layout: fit時はbarの横幅を再配分し、max2passで終わる', () => {
  const file = scene(60), old = JSON.stringify(file);
  const layout = computeLayoutBoxesForFile(file, preset), boxes = lookup(layout);
  assert.equal(boxes.bar, undefined);
  assert.equal(boxes.track, undefined);
  assert.equal(boxes.box, undefined);
  assert.equal(boxes.viewport.w, 100);
  assert.equal(boxes.content.w, 100);
  assert.equal(layout.scrollMetaById.scroll.maxScrollY, 0);
  assert.equal(layout.stats.namedScrollPasses, 2);
  assert.equal(layout.warnings.some(item => item.includes('NAMED_SCROLL_REFERENCE_MISSING')), false);
  assert.equal(JSON.stringify(file), old);
});

test('named scroll layout: always visibleはfitでもbar幅を保つ', () => {
  const file = scene(60); file.nodesById.scroll.props.scrollbar_always_visible = true;
  const layout = computeLayoutBoxesForFile(file, preset), boxes = lookup(layout);
  assert(boxes.bar);
  assert.equal(boxes.viewport.w, 92);
  assert.equal(boxes.box.h, 80);
  assert.equal(boxes.handle.h, 80);
});

test('named scroll layout: 範囲外scrollをgeometryにもclampし、viewport外をhitさせない', () => {
  const top = lookup(computeLayoutBoxesForFile(scene(), preset));
  for (const [requested, expected] of [[999, 120], [-999, 0]]) {
    const layout = computeLayoutBoxesForFile(scene(), preset, { scrollById: { scroll: { y: requested } } });
    const boxes = lookup(layout);
    assert.equal(boxes.content.y, top.content.y - expected);
    assert.equal(layout.scrollMetaById.scroll.scrollY, expected);
    assert.equal(layout.scrollMetaById.scroll.clampedScrollY, expected);
    assert.equal(hitTestBoxes(layout.boxes, 25, 95)?.id === 'content', false);
    assert(boxes.box.y >= boxes.track.y);
    assert(boxes.box.y + boxes.box.h <= boxes.track.y + boxes.track.h);
  }
});

test('named scroll layout: 明示名欠落・曖昧をwrapper全体のscrollへ置き換えない', () => {
  for (const ambiguous of [false, true]) {
    const file = scene();
    if (ambiguous) {
      file.nodesById.duplicate = { id: 'duplicate', type: 'panel', props: { name: 'content', size: [1, 1] }, children: [] };
      file.nodesById.wrapper.children.push('duplicate');
    } else file.nodesById.scroll.props.scroll_content = 'missing';
    const base = lookup(computeLayoutBoxesForFile(file, preset));
    const layout = computeLayoutBoxesForFile(file, preset, { scrollById: { scroll: { y: 30 } } });
    const boxes = lookup(layout);
    assert.deepEqual(geometry(boxes.wrapper), geometry(base.wrapper));
    assert.equal(boxes.content.y, base.content.y);
    assert.equal(layout.scrollMetaById.scroll.contentChildId, null);
    assert(layout.warnings.some(item => item.includes(ambiguous ? 'REFERENCE_AMBIGUOUS' : 'REFERENCE_MISSING')));
  }
});

test('named scroll layout: 大きいouter offsetをclampしても内側thumbがtrackに追随する', () => {
  const file = scene(300), nodes = file.nodesById;
  const inner = scene(200);
  for (const [id, node] of Object.entries(inner.nodesById)) if (id !== 'root') {
    nodes[`nested-${id}`] = { ...node, id: `nested-${id}`, props: { ...node.props },
      children: node.children.map(child => `nested-${child}`) };
  }
  nodes.content.children.push('nested-scroll');
  nodes['nested-scroll'].props.offset = [0, 150];
  const layout = computeLayoutBoxesForFile(file, preset, { scrollById: { scroll: { y: 999 }, 'nested-scroll': { y: 60 } } });
  const boxes = lookup(layout), track = boxes['nested-track'], box = boxes['nested-box'];
  assert.equal(layout.stats.namedScrollPasses, 2);
  assert.equal(box.y, track.y + 24);
  assert(box.y >= track.y);
  assert(box.y + box.h <= track.y + track.h);
});

test('vertical stack: 位置所有とuse_child_anchors opt-inをcenter/rightでも区別する', () => {
  for (const flag of [undefined, false, true]) {
    for (const [anchor, optInX] of [['left_middle', 0], ['center', 45], ['right_middle', 90]]) {
      const props = { size: [100, 80], orientation: 'vertical', anchor_from: 'top_left', anchor_to: 'top_left' };
      if (flag !== undefined) props.use_child_anchors = flag;
      const file = { rootId: 'root', nodesById: {
        root: { id: 'root', type: 'stack_panel', props, children: ['child'] },
        child: { id: 'child', type: 'panel', props: { size: [10, 20], anchor_from: anchor, anchor_to: anchor }, children: [] },
      } };
      const boxes = lookup(computeLayoutBoxesForFile(file, preset));
      assert.equal(boxes.child.x, flag === true ? optInX : 0, `${String(flag)}:${anchor}`);
      assert.equal(boxes.child.y, 0, `${String(flag)}:${anchor}`);
    }
  }
});

test('named scroll layout: viewportの余白をrootの矩形へ拡張せずclipする', () => {
  const file = scene();
  file.nodesById.viewport.props.size = ['100% - 4px', '100% - 6px'];
  file.nodesById.viewport.props.offset = [2, 3];
  const layout = computeLayoutBoxesForFile(file, preset), boxes = lookup(layout);
  assert.deepEqual(geometry(boxes.viewport), { x: 22, y: 13, w: 88, h: 74 });
  assert.deepEqual(boxes.content.clipRect, geometry(boxes.viewport));
  assert.equal(hitTestBoxes(layout.boxes, 21, 15)?.id === 'content', false);
  assert.equal(layout.scrollMetaById.scroll.maxScrollY, 126);
});
