import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSliderRuntime37, selectSliderStateChildren37, resolveSliderControls37,
  computeSliderGeometry37, readSliderEnabledState37, collectSliderDescendants37 } from '../src/preview/slider-runtime37.js';
import { computeLayoutBoxesForFile } from '../src/preview/canvas-preview.js';

const children = names => names.map(name => ({ id: name, name }));
const boxes = layout => Object.fromEntries(layout.boxes.map(box => [box.id, box]));
function scene({ value = 0.7, vertical = false, enabled = true } = {}) {
  const file = { rootId: 'root', nodesById: {} };
  const node = (id, type, size, childIds = [], extra = {}) => {
    file.nodesById[id] = { id, type, props: { name: id, size, anchor_from: 'top_left', anchor_to: 'top_left', ...extra }, children: childIds };
  };
  node('root', 'screen', [400, 300], ['slider']);
  node('slider', 'slider', vertical ? [10, 184] : [184, 10], ['thumb', 'bar', 'barHover', 'progress', 'progressHover', 'decoration'], {
    offset: [30, 40], slider_value: value, slider_direction: vertical ? 'vertical' : 'horizontal', enabled,
    slider_box_control: 'thumb', default_control: 'bar', hover_control: 'barHover', progress_control: 'progress', progress_hover_control: 'progressHover',
  });
  node('thumb', 'slider_box', [10, 16], ['normal', 'hot', 'dim', 'indent'], {
    anchor_from: 'center', anchor_to: 'center', default_control: 'normal', hover_control: 'hot', locked_control: 'dim', indent_control: 'indent',
  });
  for (const id of ['normal', 'hot', 'dim', 'indent', 'bar', 'barHover', 'progress', 'progressHover']) node(id, 'image', ['100%', '100%']);
  node('decoration', 'label', [4, 4], [], { text: 'x' });
  return file;
}
const preset = { width: 400, height: 300 };

test('slider ratio: finite numbers and numeric strings clamp; unresolved values stay unknown', () => {
  for (const [raw, ratio] of [[0, 0], [0.7, 0.7], ['0.7', 0.7], [1, 1], [-1, 0], [2, 1]]) {
    assert.deepEqual(resolveSliderRuntime37({ slider_value: raw }), { ok: true, ratio, axis: 'x', diagnostics: [] });
  }
  for (const slider_value of [undefined, null, true, false, '', ' ', '#value', '$value', '(1 / 2)', NaN, Infinity, {}, []]) {
    const result = resolveSliderRuntime37({ slider_value });
    assert.equal(result.ok, false); assert.equal(result.ratio, null); assert(result.diagnostics.includes('SLIDER_VALUE_UNRESOLVED'));
  }
  assert.equal(resolveSliderRuntime37({ slider_value: 0.7, slider_direction: 'vertical' }).axis, 'y');
  assert.equal(resolveSliderRuntime37({ slider_value: 0.7, slider_direction: '$direction' }).axis, null);
});

test('slider enabled: known and unknown states remain distinct for asset inspection', () => {
  assert.equal(readSliderEnabledState37({}), true);
  for (const enabled of [true, 1, 'true', ' yes ', 'on']) assert.equal(readSliderEnabledState37({ enabled }), true);
  for (const enabled of [false, 0, 'false', ' no ', 'off']) assert.equal(readSliderEnabledState37({ enabled }), false);
  for (const enabled of [null, undefined, '#enabled', {}, [], 2]) assert.equal(readSliderEnabledState37({ enabled }), null);
});

test('slider states: inactive hover/indent are omitted; unrelated decoration and locked track survive', () => {
  const props = { default_control: 'normal', hover_control: 'hot', locked_control: 'dim', indent_control: 'dent' };
  const all = children(['normal', 'hot', 'dim', 'dent', 'label']);
  assert.deepEqual(selectSliderStateChildren37({ type: 'slider_box', props, children: all }).ids, ['normal', 'label']);
  assert.deepEqual(selectSliderStateChildren37({ type: 'slider_box', props, children: all, enabled: false }).ids, ['dim', 'label']);
  assert.deepEqual(selectSliderStateChildren37({ type: 'slider', props: { default_control: 'bar', hover_control: 'hot' }, children: children(['bar', 'hot', 'box']), enabled: false }).ids, ['bar', 'box']);
  assert(selectSliderStateChildren37({ type: 'slider', props: { default_control: '$unknown' }, children: children(['default']) }).diagnostics.includes('SLIDER_STATE_REFERENCE_UNRESOLVED:default_control'));
});

test('slider references: only unique direct names resolve, limits and unknowns are explicit', () => {
  const props = { slider_box_control: 'thumb', progress_control: 'progress' };
  assert.deepEqual(resolveSliderControls37({ props, children: children(['thumb@base.box', 'progress']) }),
    { boxId: 'thumb@base.box', progressIds: ['progress'], unresolvedIds: [], diagnostics: [] });
  const ambiguous = resolveSliderControls37({ props, children: [{ id: 'a', name: 'thumb' }, { id: 'b', name: 'thumb' }] });
  assert.equal(ambiguous.boxId, null); assert.deepEqual(ambiguous.unresolvedIds, ['a', 'b']);
  assert(ambiguous.diagnostics.includes('SLIDER_REFERENCE_AMBIGUOUS:slider_box_control'));
  assert(ambiguous.diagnostics.includes('SLIDER_REFERENCE_MISSING:progress_control'));
  assert(resolveSliderControls37({ props: { slider_box_control: '$box' } }).diagnostics.includes('SLIDER_REFERENCE_UNRESOLVED:slider_box_control'));
  assert.deepEqual(selectSliderStateChildren37({ type: 'slider', children: Array.from({ length: 4097 }, (_, i) => ({ id: i, name: 'n' })) }), { ids: [], diagnostics: ['SLIDER_CHILD_LIMIT'] });
});

test('slider geometry: observed native track predicts thumb center1093.2px at0.7, not946px', () => {
  const result = computeSliderGeometry37({ runtime: resolveSliderRuntime37({ slider_value: 0.7 }),
    parent: { x: 578, y: 582, w: 736, h: 40 }, thumb: { x: 0, y: 0, w: 40, h: 64 } });
  assert.equal(result.ok, true); assert.equal(result.center, 1093.1999999999998);
  assert(Math.abs(result.center - 1093) <= 0.21);
  assert.equal(result.position, result.center - 20);
  assert.equal(result.progressClip.w, 515.1999999999999);
  assert.equal(computeSliderGeometry37({ runtime: resolveSliderRuntime37({ slider_value: 1 }), parent: { x: Number.MAX_VALUE, y: 0, w: Number.MAX_VALUE, h: 1 }, thumb: { x: 0, y: 0, w: 1, h: 1 } }).ok, false);
});

test('slider layout: evaluated ratio places thumb and all descendants; safe branch keeps only normal', () => {
  const file = scene(), original = JSON.stringify(file);
  const layout = computeLayoutBoxesForFile(file, preset), b = boxes(layout);
  assert(Math.abs(b.thumb.x + b.thumb.w / 2 - 158.8) < 1e-9);
  assert.equal(b.normal.x, b.thumb.x); assert.equal(b.normal.y, b.thumb.y);
  assert.equal(b.thumb.y, 37); assert.equal(b.normal.w, 10); assert.equal(b.normal.h, 16);
  for (const id of ['hot', 'dim', 'indent', 'barHover', 'progressHover']) assert.equal(b[id], undefined, id);
  assert(b.decoration); assert(b.bar);
  assert.deepEqual(b.progress.clipRect, { x: 30, y: 40, w: 128.79999999999998, h: 10 });
  assert.equal(JSON.stringify(file), original);
});

test('slider layout: ratio0/1 endpoints and explicit values outside0..1 clamp without moving cross axis', () => {
  for (const [value, center] of [[0, 30], [1, 214], [-3, 30], [4, 214]]) {
    const b = boxes(computeLayoutBoxesForFile(scene({ value }), preset));
    assert.equal(b.thumb.x + b.thumb.w / 2, center); assert.equal(b.thumb.y, 37);
    assert.equal(b.progress.clipRect.w, center - 30);
  }
});

test('slider layout: vertical ratio and binding override use the same runtime geometry', () => {
  const file = scene({ value: 0.2, vertical: true });
  const b = boxes(computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { slider: { slider_value: 0.75 } } }));
  assert.equal(b.thumb.y + b.thumb.h / 2, 178); assert.equal(b.thumb.x, 30);
  assert.deepEqual(b.progress.clipRect, { x: 30, y: 40, w: 10, h: 138 });
});

test('slider layout: disabled owner selects locked thumb and does not show inactive images', () => {
  const b = boxes(computeLayoutBoxesForFile(scene({ enabled: false }), preset));
  assert(b.dim); assert(b.bar); assert.equal(b.normal, undefined); assert.equal(b.hot, undefined); assert.equal(b.indent, undefined);
});

test('slider layout: unknown ratio hides runtime thumb/progress, retains track, emits diagnostic', () => {
  const file = scene({ value: '#unresolved' });
  const layout = computeLayoutBoxesForFile(file, preset), b = boxes(layout);
  assert.equal(b.thumb, undefined); assert.equal(b.progress, undefined); assert(b.bar); assert(b.decoration);
  assert(layout.warnings.includes('SLIDER_VALUE_UNRESOLVED:slider'));
  const structure = boxes(computeLayoutBoxesForFile(file, preset, { visibilityMode: 'structure' }));
  assert(structure.thumb); assert(structure.hot); assert(structure.indent); assert(structure.progress);
  assert.equal(structure.thumb.x + structure.thumb.w / 2, 122);
});

test('slider layout: progress clip intersects ancestor clip and applies to its descendants', () => {
  const file = scene(); file.nodesById.root.props.size = [100, 300]; file.nodesById.root.props.clips_children = true;
  file.nodesById.progress.children = ['inside'];
  file.nodesById.inside = { id: 'inside', type: 'image', props: { name: 'inside', size: ['100%', '100%'] }, children: [] };
  const b = boxes(computeLayoutBoxesForFile(file, preset));
  assert.deepEqual(b.progress.clipRect, { x: 30, y: 40, w: 70, h: 10 });
  assert.deepEqual(b.inside.clipRect, b.progress.clipRect);
});

test('slider layout: vanilla-style nested sizing_panel progress uses its own inset extent', () => {
  const file = scene();
  file.nodesById.slider.children = ['thumb', 'bar', 'barHover', 'decoration'];
  file.nodesById.bar.children = ['sizing']; file.nodesById.barHover.children = ['progressHover'];
  file.nodesById.sizing = { id: 'sizing', type: 'panel', props: { name: 'sizing_panel', size: [180, 8], offset: [2, 1], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['progress'] };
  const layout = computeLayoutBoxesForFile(file, preset), b = boxes(layout);
  assert.deepEqual(b.progress.clipRect, { x: 32, y: 41, w: 126, h: 8 });
  assert.equal(b.progressHover, undefined);
  assert.equal(layout.warnings.some(w => w.startsWith('SLIDER_REFERENCE_MISSING')), false);
  const unknown = boxes(computeLayoutBoxesForFile(file, preset, { propsByIdOverride: { slider: { slider_value: '#unknown' } } }));
  assert.equal(unknown.progress, undefined); assert.equal(unknown.thumb, undefined); assert(unknown.bar); assert(unknown.sizing);
});

test('slider descendant discovery: nested owner boundary, cycles, depth and breadth are bounded', () => {
  const nodes = {
    parent: { props: { name: 'panel' }, type: 'panel', children: ['inner', 'progress'] },
    progress: { props: { name: 'progress' }, type: 'image', children: [] },
    inner: { props: { name: 'inner' }, type: 'slider', children: ['privateProgress'] },
    privateProgress: { props: { name: 'progress' }, type: 'image', children: [] },
  };
  const nested = collectSliderDescendants37(nodes, ['parent']);
  assert.deepEqual(nested.children.map(c => c.id), ['parent', 'inner', 'progress']);
  assert.deepEqual(nested.diagnostics, []);
  nodes.progress.children = ['parent'];
  assert(collectSliderDescendants37(nodes, ['parent']).diagnostics.includes('SLIDER_REFERENCE_CYCLE'));
  const chain = Object.fromEntries(Array.from({ length: 98 }, (_, i) => [String(i), { type: 'panel', props: { name: String(i) }, children: i < 97 ? [String(i + 1)] : [] }]));
  const limited = collectSliderDescendants37(chain, ['0']);
  assert.equal(limited.children.length, 96); assert(limited.diagnostics.includes('SLIDER_DEPTH_LIMIT'));
  const broad = collectSliderDescendants37({}, Array.from({ length: 100000 }, (_, i) => String(i)));
  assert(broad.diagnostics.includes('SLIDER_CHILD_LIMIT'));
});

test('slider integration must leave unrelated unclipped image and label visible', () => {
  const file = { rootId: 'root', nodesById: {
    root: { id: 'root', type: 'screen', props: { size: [100, 100] }, children: ['image', 'label'] },
    image: { id: 'image', type: 'image', props: { name: 'image', size: [20, 20] }, children: [] },
    label: { id: 'label', type: 'label', props: { name: 'label', text: '字', size: [20, 20] }, children: [] },
  } };
  const b = boxes(computeLayoutBoxesForFile(file, preset));
  assert.equal(b.root.clipRect, null); assert.equal(b.image.clipRect, null); assert.equal(b.label.clipRect, null);
});
