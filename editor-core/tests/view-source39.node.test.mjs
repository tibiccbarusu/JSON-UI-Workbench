import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../src/bindings/bindings-evaluator.js';
import { resolvePreviewVerticalAlignment } from '../src/preview/preview-text.js';

const view = (source, expression) => ({ binding_type: 'view',
  ...(source ? { source_control_name: source, resolve_sibling_scope: true } : {}),
  source_property_name: expression, target_property_name: '#visible' });
function evaluate(controls) {
  const model = buildUiScreenModelFromJson({ namespace: 'fixture', screen: { type: 'panel', controls } }, { filePath: 'ui/view-source39.json' });
  return evaluateBindingsForUiModel(model);
}
function bySuffix(result, suffix) {
  const rows = Object.entries(result.propsById).filter(([id]) => id.endsWith(suffix));
  assert.equal(rows.length, 1, suffix);
  return rows[0][1];
}
const panel = texture => ({ type: 'panel', bindings: [view('image', "(not (#texture = ''))")],
  controls: [{ image: { type: 'image', texture, bindings: [view('', "(not ((#texture = '') or (#texture = 'loading')))")] } }] });

for (const count of [1, 2, 9, 16]) {
  for (const texture of ['', 'loading', 'textures/starweave/star_current']) {
    test(`own image source: ${count} occurrences / ${texture || 'empty'}`, () => {
      const result = evaluate([
        ...Array.from({ length: count }, (_, i) => ({ ['row_' + i]: { type: 'panel', controls: [{ panel_name: panel(texture) }] } })),
        { title_gate: { type: 'panel', bindings: [view('', '(true)')] } },
      ]);
      assert.ok(!result.warnings.some(s => /VIEW_SOURCE_|NONCONVERGENT/u.test(s)), result.warnings.join('\n'));
      assert.equal(bySuffix(result, '/title_gate').visible, true);
      for (let i = 0; i < count; i++) {
        assert.equal(bySuffix(result, `/row_${i}/panel_name`).visible, texture !== '');
        assert.equal(bySuffix(result, `/row_${i}/panel_name/image`).visible, texture !== '' && texture !== 'loading');
      }
    });
  }
}
test('explicit sibling wins over caller child', () => {
  const result = evaluate([{ row: { type: 'panel', controls: [
    { image: { type: 'image', texture: 'sibling' } },
    { panel_name: panel('') },
  ] } }]);
  assert.equal(bySuffix(result, '/panel_name').visible, true);
});
test('two local children stay ambiguous instead of choosing a first match', () => {
  const p = panel('one');
  p.controls.push({ image: { type: 'image', texture: 'two' } });
  const result = evaluate([{ panel_name: p }]);
  assert.ok(result.warnings.some(s => s.startsWith('VIEW_SOURCE_AMBIGUOUS')));
});
test('a missing source cannot borrow the unique image of another generated occurrence', () => {
  const rows = [0, 1].map(i => ({ ['row_' + i]: { type: 'panel', collection_index: i,
    __jsonui_preview_collection_name: 'form_buttons', controls: [{ panel_name: {
      ...panel('other-row'), ...(i === 0 ? { controls: [] } : {}),
    } }] } }));
  const result = evaluate(rows);
  assert.ok(result.warnings.some(s => s.startsWith('VIEW_SOURCE_UNRESOLVED') && s.includes('/row_0/')));
});
test('unrelated inactive ancestor remains excluded', () => {
  const result = evaluate([
    { inactive_screen: { type: 'panel', visible: false, controls: [{ image: { type: 'image', texture: 'hidden' } }] } },
    { caller: { type: 'panel', bindings: [view('image', "(not (#texture = ''))")] } },
  ]);
  assert.ok(result.warnings.some(s => s.startsWith('VIEW_SOURCE_UNRESOLVED')));
});
test('structurally ignored child remains excluded', () => {
  const p = panel('present'); p.controls[0].image.ignored = true;
  const result = evaluate([{ panel_name: p }]);
  assert.ok(result.warnings.some(s => s.startsWith('VIEW_SOURCE_UNRESOLVED')));
});
test('genuine visibility oscillation remains nonconvergent', () => {
  const result = evaluate([{ cyclic: { type: 'panel', visible: true, bindings: [view('', '(not #visible)')] } }]);
  assert.ok(result.warnings.some(s => s.startsWith('VIEW_BINDING_CYCLE_OR_NONCONVERGENT')));
});
test('label anchors position the rectangle independently of top-aligned text and native-invalid property is ignored', () => {
  assert.equal(resolvePreviewVerticalAlignment('label', { anchor_to: 'top_left' }), 'top');
  assert.equal(resolvePreviewVerticalAlignment('label', { anchor_to: 'top_middle' }), 'top');
  assert.equal(resolvePreviewVerticalAlignment('label', { anchor_to: 'bottom_right' }), 'top');
  assert.equal(resolvePreviewVerticalAlignment('label', { anchor_to: 'center' }), 'top');
  assert.equal(resolvePreviewVerticalAlignment('label', {}), 'top');
  assert.equal(resolvePreviewVerticalAlignment('label', { anchor_to: 'top_left', vertical_alignment: 'center' }), 'top');
  assert.equal(resolvePreviewVerticalAlignment('button', { anchor_to: 'top_left' }), 'center');
});
