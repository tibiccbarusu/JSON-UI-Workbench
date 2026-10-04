import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../src/bindings/bindings-evaluator.js';
import { findInteractionCollectionAddress, resolveUiInteraction } from '../src/preview/ui-interaction-engine.js';
import { resolveCollectionRowAddress, isCollectionOwnerType } from '../src/bindings/collection-context.js';
import { buildUiCatalog } from '../src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../src/json/jsonc.js';

const rows = Array.from({ length: 16 }, (_, index) => ({ '#text': `row-${index}`, '#texture': `texture-${index}` }));
const binding = name => ({ binding_type: 'collection', binding_collection_name: name, binding_name: '#text', binding_name_override: '#text' });
const detail = name => ({ binding_type: 'collection_details', binding_collection_name: name });
const node = (id, type, props = {}, children = [], bindings = []) => ({ id, type, props, children, bindings, key: { raw: id, local_name: id } });
const leaf = (id, index, name = 'rows') => node(id, 'button', { collection_index: index, text: 'authored' }, [], [detail(name), binding(name)]);
function setup(root, collectionData = { rows }) {
  const model = { root }, nodesById = {}, boxes = [];
  function visit(n, parentId = null) { nodesById[n.id] = n; boxes.push({ id: n.id, parentId }); n.children?.forEach(ch => visit(ch, n.id)); }
  visit(root);
  const evaluated = evaluateBindingsForUiModel(model, { collectionData });
  return { model, nodesById, boxes, collectionData, propsById: evaluated.propsById, evaluated };
}
const address = (ctx, nodeId, collection = 'rows') => findInteractionCollectionAddress({ ...ctx, nodeId, collection });
const hasWarning = (ctx, code) => ctx.evaluated.warnings.some(value => value.startsWith(`${code}:`));

test('R39 native collection owner types are explicit and plain panel is excluded', () => {
  for (const type of ['collection_panel', 'stack_panel', 'grid']) assert.equal(isCollectionOwnerType(type), true);
  for (const type of ['panel', 'button', 'custom', '', undefined]) assert.equal(isCollectionOwnerType(type), false);
});
test('R39 old plain panel cannot supply the row for either text or collection_details interaction', () => {
  const ctx = setup(node('home', 'panel', { collection_name: 'rows' }, [leaf('button', 7)]));
  assert.equal(ctx.propsById.button.text, 'authored');
  assert.equal(ctx.propsById.button.__jsonui_preview_collection_details, undefined);
  assert(hasWarning(ctx, 'COLLECTION_OWNER_INVALID'));
  assert.equal(address(ctx, 'button'), null);
});
test('R39 collection_panel preserves all 16 authored indices even when controls are reversed', () => {
  const buttons = Array.from({ length: 16 }, (_, index) => leaf(`b${index}`, index)).reverse();
  const ctx = setup(node('home', 'collection_panel', { collection_name: 'rows' }, buttons));
  for (let index = 0; index < 16; index += 1) {
    assert.equal(ctx.propsById[`b${index}`].text, `row-${index}`);
    assert.deepEqual(address(ctx, `b${index}`), { collection: 'rows', index });
  }
  assert.deepEqual(ctx.evaluated.warnings, []);
});
test('R39 stack_panel retains static indices unrelated to visual ordering', () => {
  const ctx = setup(node('owner', 'stack_panel', { collection_name: 'rows' }, [leaf('a', 3), leaf('b', 2)]));
  assert.equal(ctx.propsById.a.text, 'row-3'); assert.equal(ctx.propsById.b.text, 'row-2');
});
test('R39 panel wrappers inherit an established child row without becoming owners', () => {
  const ctx = setup(node('owner', 'collection_panel', { collection_name: 'rows' }, [node('row', 'panel', { collection_index: 5 }, [node('wrap', 'panel', {}, [node('label', 'label', {}, [], [binding('rows')])])])]));
  assert.equal(ctx.propsById.label.text, 'row-5'); assert.deepEqual(address(ctx, 'label'), { collection: 'rows', index: 5 });
});
test('R39 missing static index does not silently choose row zero in a multirow collection', () => {
  const ctx = setup(node('owner', 'collection_panel', { collection_name: 'rows' }, [node('button', 'button', { text: 'authored' }, [], [detail('rows'), binding('rows')])]));
  assert.equal(ctx.propsById.button.text, 'authored'); assert(hasWarning(ctx, 'COLLECTION_INDEX_UNRESOLVED')); assert.equal(address(ctx, 'button'), null);
});
test('R39 malformed explicit indices stay unresolved rather than using row zero', () => {
  for (const index of [-1, 0.5, '3', 1_000_001, null]) {
    const ctx = setup(node('owner', 'collection_panel', { collection_name: 'rows' }, [leaf('button', index)]));
    assert.equal(ctx.propsById.button.text, 'authored'); assert(hasWarning(ctx, 'COLLECTION_INDEX_INVALID')); assert.equal(address(ctx, 'button'), null);
  }
});
test('R39 out-of-data-range index is diagnosed by bounded data lookup', () => {
  const ctx = setup(node('owner', 'collection_panel', { collection_name: 'rows' }, [leaf('button', 20)]));
  assert.equal(ctx.propsById.button.text, 'authored'); assert(ctx.evaluated.warnings.some(value => value.startsWith('COLLECTION_')));
});
test('R39 horizontal authored grid resolves row-major coordinates in display and interaction', () => {
  const ctx = setup(node('grid', 'grid', { collection_name: 'rows', grid_dimensions: [4, 4] }, [node('cell', 'button', { grid_position: [2, 1] }, [], [detail('rows'), binding('rows')])]));
  assert.equal(ctx.propsById.cell.text, 'row-6'); assert.deepEqual(address(ctx, 'cell'), { collection: 'rows', index: 6 });
});
test('R39 vertical authored grid resolves column-major coordinates consistently', () => {
  const ctx = setup(node('grid', 'grid', { collection_name: 'rows', grid_dimensions: [4, 4], grid_fill_direction: 'vertical' }, [node('cell', 'button', { grid_position: [2, 1] }, [], [detail('rows'), binding('rows')])]));
  assert.equal(ctx.propsById.cell.text, 'row-9'); assert.deepEqual(address(ctx, 'cell'), { collection: 'rows', index: 9 });
});
test('R39 invalid grid position or direction does not create a row address', () => {
  for (const [position, direction] of [[[4, 0], 'horizontal'], [[0, 0], 'diagonal']]) {
    const ctx = setup(node('grid', 'grid', { collection_name: 'rows', grid_dimensions: [4, 4], grid_fill_direction: direction }, [node('cell', 'button', { grid_position: position }, [], [binding('rows')])]));
    assert.equal(ctx.propsById.cell.text, undefined); assert.equal(address(ctx, 'cell'), null);
    assert(ctx.evaluated.warnings.some(value => /^COLLECTION_GRID_.*_INVALID:/.test(value)));
  }
});
test('R39 generated row metadata is a distinct valid boundary with exact index', () => {
  const ctx = setup(node('row', 'panel', { __jsonui_preview_collection_name: 'rows', collection_index: 8 }, [node('label', 'label', {}, [], [binding('rows')])]));
  assert.equal(ctx.propsById.label.text, 'row-8'); assert.deepEqual(address(ctx, 'label'), { collection: 'rows', index: 8 });
});
test('R39 a generated marker without a valid index is diagnosed', () => {
  const ctx = setup(node('row', 'panel', { __jsonui_preview_collection_name: 'rows' }, [node('label', 'label', {}, [], [binding('rows')])]));
  assert(hasWarning(ctx, 'COLLECTION_INDEX_INVALID')); assert.equal(address(ctx, 'label'), null);
});
test('R39 nested static collection uses its own child index and not its owner index', () => {
  const ctx = setup(node('outer', 'collection_panel', { collection_name: 'outer' }, [node('inner', 'collection_panel', { collection_name: 'rows', collection_index: 4 }, [leaf('label', 2)])]), { rows, outer: rows });
  assert.equal(ctx.propsById.label.text, 'row-2'); assert.deepEqual(address(ctx, 'label'), { collection: 'rows', index: 2 });
});
test('R39 explicitly named outer collection uses its owner row rather than the inner child index', () => {
  const ctx = setup(node('outer', 'collection_panel', { collection_name: 'rows' }, [node('inner', 'collection_panel', { collection_name: 'other', collection_index: 4 }, [leaf('label', 2)])]), { rows, other: rows });
  assert.equal(ctx.propsById.label.text, 'row-4'); assert.deepEqual(address(ctx, 'label'), { collection: 'rows', index: 4 });
});
test('R39 collection_details singleton controls without an owner remain supported', () => {
  const ctx = setup(node('button', 'button', {}, [], [detail('rows'), binding('rows')]), { rows: [rows[0]] });
  assert.equal(ctx.propsById.button.text, 'row-0'); assert.deepEqual(address(ctx, 'button'), { collection: 'rows', index: 0 });
});
test('R39 collection_details alone does not turn an arbitrary explicit multirow index into an owner', () => {
  const ctx = setup(leaf('button', 3));
  assert.equal(ctx.propsById.button.text, 'authored'); assert(hasWarning(ctx, 'COLLECTION_INDEX_UNRESOLVED')); assert.equal(address(ctx, 'button'), null);
});
test('R39 resolved parsed model type and inherited lexical collection name are used', () => {
  const model = buildUiScreenModelFromJson({ namespace: 'scoped', root: { type: 'collection_panel', $collection: 'rows', collection_name: '$collection', controls: [{ button: { type: 'button', collection_index: 4, bindings: [binding('rows')] } }] } }, { filePath: 'ui/scoped.json' });
  const result = evaluateBindingsForUiModel(model, { collectionData: { rows } });
  assert.equal(result.propsById['root/root/button'].text, 'row-4');
});
test('R39 shared scope traversal bounds cycles and depth without stack recursion', () => {
  const options = { currentId: 'a', collectionName: 'rows', getNode: () => ({ type: 'panel' }), getProps: () => ({}), resolveName: name => name, resolveDimensions: () => null };
  assert.match(resolveCollectionRowAddress({ ...options, getParentId: () => 'a' }).warning, /^COLLECTION_SCOPE_CYCLE:/);
  assert.match(resolveCollectionRowAddress({ ...options, getParentId: id => `${id}x` }).warning, /^COLLECTION_SCOPE_DEPTH_LIMIT:/);
});
test('R39 unrelated ordinary panel decoration never produces owner warnings', () => {
  const ctx = setup(node('root', 'panel', {}, [node('decoration', 'panel', { text: 'decoration' }), node('owner', 'collection_panel', { collection_name: 'rows' }, [leaf('button', 1)])]));
  assert.equal(ctx.propsById.button.text, 'row-1'); assert.deepEqual(ctx.evaluated.warnings, []);
});
test('R39 generated row which owns a nested static collection supplies independent inner child indices', () => {
  const ctx = setup(node('row', 'collection_panel', { __jsonui_preview_collection_name: 'outer', collection_index: 4, collection_name: 'rows' }, [leaf('label', 2)]), { rows, outer: rows });
  assert.equal(ctx.propsById.label.text, 'row-2'); assert.deepEqual(address(ctx, 'label'), { collection: 'rows', index: 2 });
  assert.deepEqual(findInteractionCollectionAddress({ ...ctx, nodeId: 'label' }), { collection: 'rows', index: 2 });
});
test('R39 property_bag renderer metadata is not silently accepted as an authored child index', () => {
  const ctx = setup(node('owner', 'collection_panel', { collection_name: 'rows' }, [node('button', 'button', { property_bag: { '#collection_index': 3 }, text: 'authored' }, [], [binding('rows')])]));
  assert.equal(ctx.propsById.button.text, 'authored'); assert(hasWarning(ctx, 'COLLECTION_INDEX_SOURCE_UNSUPPORTED')); assert.equal(address(ctx, 'button'), null);
});
test('R39 collection child text and texture use the same exact selected row', () => {
  const ctx = setup(node('owner', 'collection_panel', { collection_name: 'rows' }, [node('row', 'panel', { collection_index: 7 }, [node('label', 'label', {}, [], [binding('rows')]), node('image', 'image', {}, [], [{ binding_type: 'collection', binding_collection_name: 'rows', binding_name: '#texture', binding_name_override: '#texture' }])])]));
  assert.equal(ctx.propsById.label.text, 'row-7'); assert.equal(ctx.propsById.image.texture, 'texture-7');
});
test('R39 collection owner inherited across two files retains its type and indexed child bindings', async () => {
  const docs = {
    'ui/base.json': { namespace: 'base39', owner: { type: 'collection_panel', collection_name: 'rows' } },
    'ui/selected.json': { namespace: 'selected39', 'screen@base39.owner': { controls: [{ item: { type: 'button', collection_index: 11, bindings: [detail('rows'), binding('rows')] } }] } },
  };
  const catalog = await buildUiCatalog({ parseJsonc, sources: [{ id: 'inherit39', kind: 'imported', precedence: 20, filePaths: Object.keys(docs), readText: async file => JSON.stringify(docs[file]) }] });
  const record = catalog.records.find(row => row.qualifiedName === 'selected39.screen');
  const projection = resolveEffectiveUi({ catalog, recordId: record.id });
  assert.equal(projection.ok, true);
  const model = buildUiScreenModelFromJson(projection.document, { filePath: 'ui/selected.json' });
  const ctx = setup(model.root);
  const item = Object.values(ctx.nodesById).find(value => value.key?.local_name === 'item');
  assert(item); assert.equal(ctx.propsById[item.id].text, 'row-11'); assert.deepEqual(address(ctx, item.id), { collection: 'rows', index: 11 });
});
test('R39 all 16 preview form responses use the address resolved from the displayed button', () => {
  const formRows = rows.map((row, index) => ({ ...row, '#form_button_text': `button-${index}` }));
  const buttons = formRows.map((_, index) => {
    const button = leaf(`b${index}`, index, 'form_buttons');
    button.props.button_mappings = [{ from_button_id: 'button.menu_select', to_button_id: 'button.form_button_click', mapping_type: 'pressed' }];
    return button;
  });
  const ctx = setup(node('owner', 'collection_panel', { collection_name: 'form_buttons' }, buttons), { form_buttons: formRows });
  for (const button of buttons) {
    const result = resolveUiInteraction({ ...ctx, enabled: true, screenDefinition: 'server_form.long_form', node: button,
      effectiveProps: ctx.propsById[button.id], collectionAddress: address(ctx, button.id, 'form_buttons') });
    assert.equal(result.status, 'applied');
    assert.equal(result.effects[0].patch.__jsonui_preview_form_response.selection, button.props.collection_index);
    assert.equal(result.effects[0].patch.__jsonui_preview_form_response.text, `button-${button.props.collection_index}`);
  }
});
test('R39 vanilla ModalForm radio focus can name its enclosing custom_form row without using the radio index', () => {
  const radio = index => node(`radio${index}`, 'panel', { __jsonui_preview_collection_name: 'custom_dropdown', collection_index: index }, [node(`focus${index}`, 'button', {}, [], [
    { binding_type: 'collection', binding_collection_name: 'custom_form', binding_name: '#custom_toggle_focus_id', binding_name_override: '#focus_identifier' },
    { binding_type: 'collection', binding_collection_name: 'custom_dropdown', binding_name: '#custom_radio_text', binding_name_override: '#text' },
  ])]);
  const ctx = setup(node('form', 'stack_panel', { collection_name: 'custom_form' }, [
    node('dropdown', 'panel', { __jsonui_preview_collection_name: 'custom_form', collection_index: 2 }, [
      node('radio_group', 'stack_panel', { collection_name: 'custom_dropdown' }, [radio(0), radio(1)]),
    ]),
  ]), { custom_form: [{ '#custom_toggle_focus_id': 'wrong-zero' }, { '#custom_toggle_focus_id': 'wrong-one' }, { '#custom_toggle_focus_id': 'outer-focus-two' }],
    custom_dropdown: [{ '#custom_radio_text': '巡航' }, { '#custom_radio_text': '探索' }] });
  for (const index of [0, 1]) {
    assert.equal(ctx.propsById[`focus${index}`].focus_identifier, 'outer-focus-two');
    assert.deepEqual(address(ctx, `focus${index}`, 'custom_form'), { collection: 'custom_form', index: 2 });
  }
  assert.equal(ctx.propsById.focus0.text, '巡航'); assert.equal(ctx.propsById.focus1.text, '探索');
  assert.deepEqual(ctx.evaluated.warnings, []);
});
