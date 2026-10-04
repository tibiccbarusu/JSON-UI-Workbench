import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';

const unknown = '#__jsonui_unresolved_runtime_visibility__';
const source = () => ({ namespace: 'dynamic37', root: { type: 'panel', controls: [0, 1].map(index => ({
  [`row${index}`]: { type: 'panel', collection_index: index, __jsonui_preview_collection_name: 'rows',
    $dropdown_name: 'custom_dropdown', controls: [
      { custom_dropdown: { type: 'dropdown', bindings: [{ binding_type: 'collection', binding_collection_name: 'rows',
        binding_name: "('#' + $dropdown_name)", binding_name_override: '#toggle_state' }] } },
      { content: { type: 'panel', bindings: [{ binding_type: 'view', source_control_name: 'custom_dropdown',
        source_property_name: '#toggle_state', target_property_name: '#visible', resolve_sibling_scope: true }] } },
    ] },
})) } });
const evaluate = (rows, mockData = {}) => evaluateBindingsForUiModel(buildUiScreenModelFromJson(source(), { filePath: 'ui/dynamic37.json' }), { collectionData: { rows }, mockData });
const prop = (result, index, child, key) => result.propsById[`root/root/row${index}/${child}`]?.[key];

test('constructed collection references preserve explicit false/true and sibling row isolation', () => {
  const result = evaluate([{ '#custom_dropdown': false }, { '#custom_dropdown': true }]);
  assert.equal(prop(result, 0, 'custom_dropdown', 'toggle_state'), false);
  assert.equal(prop(result, 0, 'content', 'visible'), false);
  assert.equal(prop(result, 1, 'custom_dropdown', 'toggle_state'), true);
  assert.equal(prop(result, 1, 'content', 'visible'), true);
});

test('constructed collection reference does not borrow global state when row data is absent', () => {
  const result = evaluate([{}, { '#custom_dropdown': false }], { '#custom_dropdown': true, '#toggle_state': true });
  assert.equal(prop(result, 0, 'custom_dropdown', 'toggle_state'), unknown);
  assert.equal(prop(result, 0, 'content', 'visible'), unknown);
  assert.equal(prop(result, 1, 'content', 'visible'), false);
});

test('constructed row references retain bounded aliases and never invoke accessors', () => {
  let invoked = 0;
  const row = {};
  Object.defineProperty(row, '#custom_dropdown', { enumerable: true, get() { invoked += 1; return false; } });
  const invalid = evaluate([row, { '#custom_dropdown': '#alias', '#alias': false }]);
  assert.equal(invoked, 0);
  assert.equal(prop(invalid, 0, 'content', 'visible'), unknown);
  assert.equal(prop(invalid, 1, 'content', 'visible'), false);
  const cycle = evaluate([{ '#custom_dropdown': '#alias', '#alias': '#custom_dropdown' }, {}]);
  assert.equal(prop(cycle, 0, 'content', 'visible'), unknown);
  const long = { '#custom_dropdown': '#a0' };
  for (let index = 0; index < 12; index += 1) long[`#a${index}`] = index === 11 ? false : `#a${index + 1}`;
  const bounded = evaluate([long, {}]);
  assert.equal(prop(bounded, 0, 'content', 'visible'), unknown);
  assert(bounded.warnings.some(value => value.startsWith('COLLECTION_EXPRESSION_REF_LIMIT:')));
});
