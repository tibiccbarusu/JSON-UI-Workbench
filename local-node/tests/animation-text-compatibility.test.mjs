import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePreviewAnimations, samplePreviewAnimations } from '../../editor-core/src/engine/preview-animation.js';
import { summarizeAnimationQuality } from '../../editor-core/src/engine/animation-quality41.js';
import { resolvePreviewVerticalAlignment } from '../../editor-core/src/preview/preview-text.js';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';
import { drawBitmapText } from '../../editor-core/src/preview/bitmap-font.js';

// Original minimal fixtures: no Minecraft textures, fonts, or pack sources.
const flip = () => ({ anim_type: 'flip_book', initial_uv: [2, 3], frame_count: 4, frame_step: 2, fps: 2, looping: false });
const uv = () => ({ anim_type: 'uv', from: [2, 3], to: [10, 3], duration: 2 });
function compile(definitions, props = { uv: '@fixture.first' }) {
  return compilePreviewAnimations({ namespace: 'fixture', root: { id: 'image', props, children: [] } }, { definitions });
}
const codes = plan => plan.diagnostics.map(row => row.code);
const quality = plan => summarizeAnimationQuality({ observation: plan.observation, timeSeconds: 1 });

test('ordinary uv/size looping flags are native-incompatible even when false; input remains unchanged', () => {
  for (const anim_type of ['uv', 'size']) for (const looping of [false, true]) {
    const definitions = { 'fixture.first': { ...uv(), anim_type, looping } };
    const before = JSON.stringify(definitions);
    const plan = compile(definitions, { [anim_type]: '@fixture.first' });
    assert(codes(plan).includes('ANIMATION_LOOPING_NATIVE_REJECTED'));
    assert.equal(quality(plan).status, 'unknown');
    assert.equal(quality(plan).native_parity_verified, false);
    assert.equal(plan.tracks.length, 1, 'diagnosed numerical preview remains available');
    assert.equal(JSON.stringify(definitions), before);
  }
});

test('standalone direct UV flipbook preserves initial_uv and valid looping behavior', () => {
  for (const looping of [undefined, false, true]) {
    const definition = flip();
    if (looping === undefined) delete definition.looping;
    else definition.looping = looping;
    const plan = compile({ 'fixture.first': definition });
    assert.deepEqual(codes(plan), []);
    assert.deepEqual(samplePreviewAnimations(plan, 1).propsById.image.uv, [6, 3]);
    assert.equal(quality(plan).status, 'passed');
    assert.equal(quality(plan).native_parity_verified, false, 'local pass never means native verification');
  }
});

test('anims attachment is distinguished from direct UV, including duplicate attachment paths', () => {
  for (const props of [{ anims: ['@fixture.first'] }, { anims: ['@fixture.first'], uv: '@fixture.first' }]) {
    const plan = compile({ 'fixture.first': flip() }, props);
    assert.equal(plan.tracks.length, 1, 'duplicate reference is compiled only once');
    assert(codes(plan).includes('ANIMATION_FLIPBOOK_ANIMS_NATIVE_UNVERIFIED'));
    assert.equal(quality(plan).status, 'unknown');
  }
});

test('direct UV next chains diagnose each affected flipbook while retaining boundary samples', () => {
  const definitions = {
    'fixture.first': { ...flip(), next: '@fixture.second' },
    'fixture.second': { ...flip(), initial_uv: [12, 5], next: '@fixture.third' },
    'fixture.third': { ...flip(), initial_uv: [22, 7] },
  };
  const plan = compile(definitions);
  const issues = plan.diagnostics.filter(row => row.code === 'ANIMATION_FLIPBOOK_CHAIN_NATIVE_UNVERIFIED');
  assert.deepEqual(issues.map(row => row.ref), ['fixture.first', 'fixture.second', 'fixture.third']);
  assert.equal(quality(plan).status, 'unknown');
  assert.deepEqual(samplePreviewAnimations(plan, 2).propsById.image.uv, [12, 5]);
  assert.deepEqual(samplePreviewAnimations(plan, 4).propsById.image.uv, [22, 7]);
  assert.deepEqual(samplePreviewAnimations(plan, 6).propsById.image.uv, [28, 7]);
});

test('ordinary UV replacement chain is locally supported with stable absolute seek and terminal stop', () => {
  const plan = compile({
    'fixture.first': { ...uv(), next: '@fixture.second' },
    'fixture.second': { ...uv(), from: [12, 5], to: [20, 5] },
  });
  assert.deepEqual(codes(plan), []);
  assert.equal(quality(plan).status, 'passed');
  for (const [time, expected] of [[0, [2, 3]], [1, [6, 3]], [2, [12, 5]], [3, [16, 5]], [4, [20, 5]], [1, [6, 3]]]) {
    assert.deepEqual(samplePreviewAnimations(plan, time).propsById.image.uv, expected);
  }
  assert.equal(samplePreviewAnimations(plan, 4).active, false);
});

test('a flipbook reached from an ordinary UV segment is still marked as a native-unverified chain', () => {
  const plan = compile({ 'fixture.first': { ...uv(), next: '@fixture.second' }, 'fixture.second': flip() });
  assert(plan.diagnostics.some(row => row.ref === 'fixture.second' && row.code === 'ANIMATION_FLIPBOOK_CHAIN_NATIVE_UNVERIFIED'));
  assert.equal(quality(plan).status, 'unknown');
});

test('center anchors position natural and tall label boxes; glyphs start at each box top', () => {
  const glyphLayout = { height: 8, fontPx: 8, scale: 1, lines: [{ width: 5, glyphs: [{ x: 0, color: '#fff',
    glyph: { sx: 0, sy: 0, sw: 8, sh: 8 }, sheet: { tinted: () => ({}) } }] }] };
  for (const [height, expectedTop] of [[80, 10], ['default', 46]]) {
    const props = { text: 'A', size: [80, height], anchor_from: 'center', anchor_to: 'center', text_alignment: 'center' };
    const file = { rootId: 'root', nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [200, 100] }, children: ['caption'] },
      caption: { id: 'caption', type: 'label', props, children: [] },
    } };
    const layout = computeLayoutBoxesForFile(file, { width: 200, height: 100 }, {
      propsByIdOverride: { caption: { __jsonui_preview_text_intrinsic_size: [5, 8] } },
    });
    const box = layout.boxes.find(row => row.id === 'caption');
    assert.equal(box.y, expectedTop);
    const translations = [];
    const context = { save() {}, restore() {}, translate(x, y) { translations.push([x, y]); }, drawImage() {} };
    drawBitmapText(context, glyphLayout, { ...box, align: 'center', vertical: resolvePreviewVerticalAlignment('label', props) });
    assert.equal(translations[0][1], expectedTop, 'fixed label height must not add a second vertical centering offset');
    assert.equal(translations[0][0], box.x + (box.w - 5) / 2, 'horizontal text alignment stays independent');
  }
});

test('invalid vertical_alignment cannot silently repair label placement; non-label behavior stays unchanged', () => {
  for (const anchor_to of ['top_left', 'center', 'bottom_right']) for (const vertical_alignment of ['center', 'bottom', undefined]) {
    assert.equal(resolvePreviewVerticalAlignment('label', { anchor_to, vertical_alignment }), 'top');
  }
  assert.equal(resolvePreviewVerticalAlignment('button', { vertical_alignment: 'bottom' }), 'bottom');
});
