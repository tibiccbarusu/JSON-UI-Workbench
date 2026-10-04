import test from 'node:test';
import assert from 'node:assert/strict';
import { applySlotTransfer, extractUiInteractionActions, resolveUiInteraction, describeTextInteraction, commitTextInteraction, findInteractionCollectionAddress, listUiInteractionCapabilities } from '../src/preview/ui-interaction-engine.js';
import { normalizePreviewState } from '../src/engine/preview-state.js';
const button = (action = 'button.menu_exit', more = {}) => ({ id: 'button', type: 'button', unknownProps: { button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: action, mapping_type: 'pressed' }] }, ...more });
const act = (node, more = {}) => resolveUiInteraction({ enabled: true, node, ...more });
const editBox = (more = {}) => ({ id: 'input', type: 'edit_box', props: { max_length: 30, text_type: 'ExtendedASCII' }, children: [{ id: 'label', type: 'label', props: { text: '#item_name' }, bindings: [{ binding_name: '#text_box_item_name', binding_name_override: '#item_name', binding_type: 'global' }] }], ...more });
const row = id => normalizePreviewState({ slots: { inventory_items: [{ id, texture: 'textures/items/test' }] } }).collectionData.inventory_items[0];
const empty = () => ({ '#item_valid': false, '#is_selected_slot': false, '#item_id_aux': 0 });
const transfer = (fromRows, toRows = [empty()], more = {}) => applySlotTransfer({ enabled: true, from: { collection: 'inventory_items', index: 0 }, to: { collection: 'hotbar_items', index: 0 }, collectionData: { inventory_items: fromRows, hotbar_items: toRows }, ...more });

test('OFF/Pocket gates every side-effect entry before action resolution', () => {
  for (const opts of [{ enabled: false }, { enabled: true, pocket: true }]) {
    for (const result of [act(button(), opts), describeTextInteraction({ node: editBox(), ...opts }), commitTextInteraction({ edit: {}, value: 'a', ...opts }), transfer([row('diamond')], undefined, opts)]) {
      assert.equal(result.status, 'blocked'); assert.deepEqual(result.effects, []);
    }
  }
});
test('mapping filters mouse pressed, ignores keyboard global and hover', () => {
  const node = button(); node.unknownProps.button_mappings.push({ from_button_id: 'button.menu_cancel', to_button_id: 'button.other', mapping_type: 'global' }, { from_button_id: 'button.menu_select', to_button_id: 'button.hover', mapping_type: 'focused' });
  assert.deepEqual(extractUiInteractionActions(node), ['button.menu_exit']);
  assert.deepEqual(extractUiInteractionActions(node, {}, 'escape'), ['button.other']);
});
test('mapping local/default token chains resolve and cycles fail closed', () => {
  const node = button('$click', { localVariables: { '$click': '$alias', '$alias|default': 'button.menu_exit' } });
  assert.equal(act(node).effects[0].type, 'close');
  node.localVariables.$alias = '$click'; assert.equal(act(node).status, 'unsupported');
});
test('unresolved ignored mappings cannot become actions', () => {
  const node = button(); node.unknownProps.button_mappings[0].ignored = '$unknown';
  assert.equal(act(node).status, 'unsupported');
});
test('ambiguous multiple pressed mappings do not partially execute', () => {
  const node = button(); node.unknownProps.button_mappings.push({ from_button_id: 'button.menu_select', to_button_id: 'button.other', mapping_type: 'pressed' });
  assert.equal(act(node).diagnostics[0].code, 'INTERACTION_MULTIPLE_ACTIONS');
});
test('arbitrary action names never become filename navigation or binding patches', () => {
  const answer = act(button('button.anvil'), { availableScreenPaths: ['ui/anvil_screen.json'] });
  assert.equal(answer.status, 'unsupported'); assert.deepEqual(answer.effects, []);
});
test('explicit navigation requires an exact existing safe path', () => {
  const node = button('custom.open');
  assert.equal(act(node, { actionMap: { 'custom.open': 'screen:ui/a.json' }, availableScreenPaths: ['ui/a.json'] }).effects[0].fileId, 'screen:ui/a.json');
  assert.equal(act(node, { actionMap: { 'custom.open': 'ui/missing.json' }, availableScreenPaths: ['ui/a.json'] }).status, 'blocked');
  for (const path of ['ui/../a.json', 'https://site/a.json', 'ui/a_pocket.json']) {
    assert.equal(act(node, { actionMap: { 'custom.open': path }, availableScreenPaths: [path] }).status, 'blocked');
  }
});
test('help offers only source-present exact definitions and does not guess context', () => {
  const answer = act(button('button.help'), { availableScreenPaths: ['ui/encyclopedia_screen.json', 'ui/how_to_play_screen.json', 'ui/helpful_fake.json'] });
  assert.equal(answer.effects[0].type, 'chooseNavigate'); assert.equal(answer.effects[0].candidates.length, 1);
  assert.deepEqual(answer.effects[0].candidates.map(x => x.definition), ['how_to_play.how_to_play_screen']);
  assert.equal(act(button('button.help')).status, 'unsupported');
});
test('disabled/hidden/ignored or unresolved visibility fail closed', () => {
  for (const effectiveProps of [{ enabled: false }, { visible: false }, { ignored: true }, { enabled: '#unknown' }, { visible: { unresolved: true } }]) assert.equal(act(button(), { effectiveProps }).status, 'blocked');
});
test('outside cannot borrow escape mapping; fullscreen cannot close', () => {
  assert.equal(act(button(), { event: 'outside' }).status, 'blocked');
  assert.equal(act(button(), { event: 'outside', outsidePolicy: { close: true, source: 'explicit-preview-setting' } }).effects[0].type, 'close');
  assert.equal(act(button(), { event: 'outside', outsidePolicy: { close: true, source: 'explicit-preview-setting', fullscreen: true } }).status, 'blocked');
});
test('book signing and cancelling are finite scoped view-state transitions', () => {
  const source = { '#editable': true, '#viewing': true };
  const sign = act(button('button.sign_book'), { screenDefinition: 'book.book_screen', mockData: source });
  assert.equal(sign.effects[0].patch['#signing'], true); assert.deepEqual(source, { '#editable': true, '#viewing': true });
  const back = act(button('button.book_exit'), { screenDefinition: 'book.book_screen', mockData: { '#signing': true } });
  assert.equal(back.effects[0].type, 'mockPatch');
  assert.equal(act(button('button.book_exit'), { screenDefinition: 'book.book_screen' }).effects[0].type, 'close');
  assert.equal(act(button('button.sign_book'), { screenDefinition: 'other.screen' }).status, 'unsupported');
  assert.equal(act(button('button.finalize'), { screenDefinition: 'book.book_screen' }).status, 'unsupported');
});
test('book pen affects only confirmed page row; readonly cannot edit', () => {
  const rows = [{ '#edit_controls_active': false }, { '#edit_controls_active': false }];
  const settings = { screenDefinition: 'book.book_screen', collectionAddress: { collection: 'book_pages', index: 1 }, collectionData: { book_pages: rows } };
  const value = act(button('button.edit_page'), settings); const next = value.effects[0].patch.book_pages;
  assert.equal(next[0], rows[0]); assert.equal(next[1]['#edit_controls_active'], true); assert.equal(next[1]['#edit_button_active'], false); assert.equal(rows[1]['#edit_controls_active'], false);
  assert.equal(act(button('button.edit_page'), { ...settings, mockData: { '#editable': false } }).status, 'blocked');
  assert.equal(act(button('button.edit_page'), { ...settings, collectionAddress: null }).status, 'blocked');
});
test('edit_box identifies source binding instead of text_box_name', () => {
  const node = editBox(); node.props.text_box_name = '#wrong_identity';
  const answer = describeTextInteraction({ enabled: true, node }); assert.equal(answer.edit.binding, '#text_box_item_name'); assert.equal(answer.edit.maxLength, 30);
});
test('text descriptor supports lexical variables and enabled_newline', () => {
  const node = editBox({ localVariables: { '$type': 'collection', '$collection': 'book_pages', '$content': '#page_text' }, props: { enabled_newline: true, max_length: 100 }, children: [{ id: 'label', type: 'label', props: { text: '#item_name' }, bindings: [{ binding_type: '$type', binding_collection_name: '$collection', binding_name: '$content', binding_name_override: '#item_name' }] }] });
  const result = describeTextInteraction({ enabled: true, node, collectionIndex: 1 });
  assert.equal(result.edit.binding, '#page_text'); assert.equal(result.edit.collection, 'book_pages'); assert.equal(result.edit.index, 1); assert.equal(result.edit.multiline, true);
  assert.equal(describeTextInteraction({ enabled: true, node }).status, 'blocked');
});
test('missing max_length variable is not treated as unlimited input', () => {
  const node = editBox(); node.props.max_length = '$max_page_length';
  assert.equal(describeTextInteraction({ enabled: true, node }).status, 'unsupported');
});
test('ambiguous text sources and nested text inputs do not write broadly', () => {
  const node = editBox(); node.children.push({ id: 'other', type: 'label', props: { text: '#b' }, bindings: [{ binding_name: '#b', binding_name_override: '#text' }] });
  assert.equal(describeTextInteraction({ enabled: true, node }).status, 'unsupported');
});
test('max_length 0, paste/IME strings and UTF-16 length are validated on commit', () => {
  const edit = describeTextInteraction({ enabled: true, node: editBox() }).edit;
  assert.equal(commitTextInteraction({ enabled: true, edit, value: 'a'.repeat(30) }).status, 'applied');
  assert.equal(commitTextInteraction({ enabled: true, edit, value: 'a'.repeat(31) }).status, 'blocked');
  assert.equal(commitTextInteraction({ enabled: true, edit: { ...edit, maxLength: 0 }, value: '' }).status, 'applied');
  assert.equal(commitTextInteraction({ enabled: true, edit: { ...edit, maxLength: 0 }, value: 'a' }).status, 'blocked');
  assert.equal(commitTextInteraction({ enabled: true, edit: { ...edit, maxLength: 1 }, value: '😀' }).status, 'blocked');
});
test('Numeric/ASCII/newline restrictions are applied atomically', () => {
  const edit = { binding: '#value', maxLength: 50, textType: 'Numeric', multiline: false };
  assert.equal(commitTextInteraction({ enabled: true, edit, value: '123' }).status, 'applied');
  for (const value of ['1a', '-1', '1\n2']) assert.equal(commitTextInteraction({ enabled: true, edit, value }).status, 'blocked');
  assert.equal(commitTextInteraction({ enabled: true, edit: { ...edit, textType: 'ASCII' }, value: '日本語' }).status, 'blocked');
  assert.equal(commitTextInteraction({ enabled: true, edit: { ...edit, textType: 'ExtendedASCII', multiline: true }, value: '日本語\n本' }).status, 'applied');
});
test('collection text edits update exactly one row without changing input', () => {
  const rows = [{ '#page_text': 'one' }, { '#page_text': 'two' }];
  const answer = commitTextInteraction({ enabled: true, edit: { binding: '#page_text', collection: 'book_pages', index: 1, maxLength: 30, textType: 'ExtendedASCII', multiline: true }, value: 'changed', collectionData: { book_pages: rows } });
  assert.equal(answer.effects[0].patch.book_pages[0], rows[0]); assert.equal(answer.effects[0].patch.book_pages[1]['#page_text'], 'changed'); assert.equal(rows[1]['#page_text'], 'two');
});
test('safe text binding names reject prototype-sensitive writes', () => {
  for (const binding of ['#__proto__', '#constructor', '#prototype']) assert.equal(commitTextInteraction({ enabled: true, edit: { binding, textType: 'ExtendedASCII' }, value: 'x' }).status, 'blocked');
});
test('slot full-stack move preserves item metadata and slot selection', () => {
  const source = { ...row('diamond'), '#is_selected_slot': true, '#slot_locked': false }; const target = { ...empty(), '#slot_locked': true };
  const answer = transfer([source], [target]); const patch = answer.effects[0].patch;
  assert.equal(patch.hotbar_items[0].__jsonui_preview_item_id, 'minecraft:diamond'); assert.equal(patch.hotbar_items[0]['#is_selected_slot'], false); assert.equal(patch.hotbar_items[0]['#slot_locked'], true);
  assert.equal(patch.inventory_items[0]['#is_selected_slot'], true); assert.equal(patch.inventory_items[0]['#item_valid'], false); assert.equal(source['#item_valid'], true);
});
test('same collection swap is lossless and original untouched', () => {
  const rows = [row('diamond'), row('emerald')];
  const answer = applySlotTransfer({ enabled: true, collectionData: { inventory_items: rows }, from: { collection: 'inventory_items', index: 0 }, to: { collection: 'inventory_items', index: 1 } });
  assert.equal(answer.effects[0].patch.inventory_items[0].__jsonui_preview_item_id, 'minecraft:emerald'); assert.equal(answer.effects[0].patch.inventory_items[1].__jsonui_preview_item_id, 'minecraft:diamond'); assert.equal(rows[0].__jsonui_preview_item_id, 'minecraft:diamond');
});
test('occupied destination is swapped only when reverse placement is legal', () => {
  const diamond = row('diamond'), fuel = row('coal');
  const value = applySlotTransfer({ enabled: true, collectionData: { inventory_items: [diamond], furnace_fuel_items: [fuel] }, from: { collection: 'furnace_fuel_items', index: 0 }, to: { collection: 'inventory_items', index: 0 } });
  assert.equal(value.status, 'blocked'); assert.equal(fuel.__jsonui_preview_item_id, 'minecraft:coal');
});
test('output destination denied, output-to-empty inventory allowed', () => {
  const diamond = row('diamond');
  const data = { inventory_items: [empty()], furnace_output_items: [diamond] };
  assert.equal(applySlotTransfer({ enabled: true, collectionData: data, from: { collection: 'furnace_output_items', index: 0 }, to: { collection: 'inventory_items', index: 0 } }).status, 'applied');
  data.inventory_items = [diamond]; data.furnace_output_items = [empty()];
  assert.equal(applySlotTransfer({ enabled: true, collectionData: data, from: { collection: 'inventory_items', index: 0 }, to: { collection: 'furnace_output_items', index: 0 } }).status, 'blocked');
});
test('brewing result is a bottle receptacle, not output-only slot', () => {
  for (const [id, expected] of [['glass_bottle', 'applied'], ['potion', 'applied'], ['diamond', 'blocked']]) assert.equal(transfer([row(id)], undefined, { collectionData: { inventory_items: [row(id)], brewing_result_items: [empty()] }, to: { collection: 'brewing_result_items', index: 0 } }).status, expected);
});
test('armor slot constraints include position, unknown restriction denies', () => {
  for (const [id, index, expected] of [['diamond_helmet', 0, 'applied'], ['diamond_helmet', 1, 'blocked'], ['elytra', 1, 'applied'], ['diamond', 0, 'blocked']]) assert.equal(transfer([row(id)], undefined, { collectionData: { inventory_items: [row(id)], armor_items: [empty(), empty(), empty(), empty()] }, to: { collection: 'armor_items', index } }).status, expected);
});
test('stale drag/no item/invalid address remain atomic', () => {
  assert.equal(transfer([row('diamond')], undefined, { expectedSource: row('diamond') }).diagnostics[0].code, 'INTERACTION_SLOT_STALE');
  assert.equal(transfer([empty()]).status, 'blocked');
  assert.equal(transfer([row('diamond')], undefined, { to: { collection: 'hotbar_items', index: -1 } }).status, 'blocked');
});
test('shulker container cannot nest shulker boxes', () => {
  const source = row('red_shulker_box');
  const options = { screenDefinition: 'chest.shulker_box_screen', collectionData: { inventory_items: [source], container_items: [empty()] }, to: { collection: 'container_items', index: 0 } };
  assert.equal(transfer([source], undefined, options).status, 'blocked');
});
test('collection address uses bounded ancestry and matching marker', () => {
  const nodes = { root: { props: { collection_name: 'inventory_items' } }, cell: { props: { collection_index: 2, __jsonui_preview_collection_name: 'inventory_items' } }, image: { props: {} } }; const boxes = [{ id: 'image', parentId: 'cell' }, { id: 'cell', parentId: 'root' }, { id: 'root' }];
  assert.deepEqual(findInteractionCollectionAddress({ nodeId: 'image', nodesById: nodes, boxes }), { collection: 'inventory_items', index: 2 });
  assert.equal(findInteractionCollectionAddress({ nodeId: 'image', nodesById: nodes, boxes, collection: 'other' }), null);
});
test('capability listing is bounded and retains unsupported reasons', () => {
  const model = { root: { id: 'root', children: [button(), button('unknown'), button('button.help')] } };
  const value = listUiInteractionCapabilities({ model, maxEntries: 2 }); assert.equal(value.entries.length, 2); assert.equal(value.truncated, true); assert.equal(value.entries[1].status, 'unsupported'); assert.match(value.entries[1].reason, /未対応/u);
});
test('authored book-style named grid maps left/right and vertical fill exactly', () => {
  const nodes = { grid: { type: 'grid', props: { collection_name: 'book_pages', grid_dimensions: [2, 1] } }, left: { props: { grid_position: [0, 0] } }, right: { props: { grid_position: [1, 0] } }, text: { props: {} } }; const boxes = [{ id: 'left', parentId: 'grid' }, { id: 'right', parentId: 'grid' }, { id: 'text', parentId: 'right' }];
  assert.deepEqual(findInteractionCollectionAddress({ nodeId: 'text', nodesById: nodes, boxes }), { collection: 'book_pages', index: 1 });
  assert.deepEqual(findInteractionCollectionAddress({ nodeId: 'left', nodesById: nodes, boxes }), { collection: 'book_pages', index: 0 });
  nodes.grid.props.grid_dimensions = [2, 3]; nodes.grid.props.grid_fill_direction = 'vertical'; nodes.right.props.grid_position = [1, 2];
  assert.deepEqual(findInteractionCollectionAddress({ nodeId: 'text', nodesById: nodes, boxes }), { collection: 'book_pages', index: 5 });
});
test('decorative unnamed grids and invalid positions never invent an address', () => {
  const nodes = { grid: { type: 'grid', props: { grid_dimensions: [2, 1] } }, child: { props: { grid_position: [1, 0] } } }; const boxes = [{ id: 'child', parentId: 'grid' }];
  assert.equal(findInteractionCollectionAddress({ nodeId: 'child', nodesById: nodes, boxes }), null);
  nodes.grid.props.collection_name = 'book_pages'; nodes.child.props.grid_position = [2, 0];
  assert.equal(findInteractionCollectionAddress({ nodeId: 'child', nodesById: nodes, boxes }), null);
});
test('recipe/offer display collections cannot leak displayed items into inventory', () => {
  for (const collection of ['recipe_display', 'trade_item_1', 'sell_item']) {
    const value = applySlotTransfer({ enabled: true, from: { collection, index: 0 }, to: { collection: 'inventory_items', index: 0 }, collectionData: { [collection]: [row('diamond')], inventory_items: [empty()] } });
    assert.equal(value.status, 'blocked'); assert.equal(value.diagnostics[0].code, 'INTERACTION_SLOT_SOURCE_UNCONFIRMED');
  }
});
test('disabled source or destination slot rejects transfer without changes', () => {
  for (const extra of [{ fromSlotProps: { enabled: false } }, { toSlotProps: { enabled: false } }, { toSlotProps: { visible: '#unknown' } }]) assert.equal(transfer([row('diamond')], undefined, extra).status, 'blocked');
});
test('input-mode-conditional actions cannot fire as ordinary mouse actions', () => {
  const node = button(); node.unknownProps.button_mappings[0].input_mode_condition = 'gamepad';
  assert.equal(act(node).status, 'unsupported');
});
test('confirmed help topics are explicit section previews and never encyclopedia root', () => {
  for (const [source, topic] of [['anvil.anvil_screen','anvil_section'], ['brewing_stand.brewing_stand_screen','brewing_stand_section'], ['enchanting.enchanting_screen','enchanting_table_section'], ['furnace.furnace_screen','furnace_section'], ['book.book_screen','book_and_quill_section'], ['horse.horse_screen','mounts_section']]) {
    const answer = act(button('button.help'), { screenDefinition: source, availableScreenPaths: ['ui/encyclopedia_screen.json'] });
    assert.equal(answer.effects[0].candidates.length, 1); assert.equal(answer.effects[0].candidates[0].definition, `encyclopedia.${topic}`); assert.equal(answer.effects[0].candidates[0].previewTopic, true);
  }
  assert.equal(act(button('button.help'), { screenDefinition: 'custom.anvil_screen', availableScreenPaths: ['ui/encyclopedia_screen.json'] }).status, 'unsupported');
});
test('single-item equipment and potion placements reject multi-item stacks', () => {
  for (const [collection, id] of [['armor_items','diamond_helmet'], ['horse_equip_items','saddle'], ['brewing_result_items','potion'], ['offhand_items','shield'], ['furnace_fuel_items','lava_bucket']]) {
    const source = { ...row(id), __jsonui_preview_item_count: 2 };
    const answer = transfer([source], undefined, { collectionData: { inventory_items: [source], [collection]: [empty()] }, to: { collection, index: 0 } });
    assert.equal(answer.status, 'blocked'); assert.equal(answer.diagnostics[0].code, 'INTERACTION_SLOT_SINGLE_ITEM');
  }
});
test('animal equipment follows actual saddle/armor/carpet UI flags', () => {
  const place = (id,index,mockData) => transfer([row(id)], undefined, { collectionData: { inventory_items: [row(id)], horse_equip_items: [empty(),empty()] }, to: { collection: 'horse_equip_items', index }, mockData });
  const horse = { '#has_saddle_slot': true, '#has_horse_armor_and_saddle_slot': true };
  assert.equal(place('saddle',0,horse).status,'applied'); assert.equal(place('diamond_horse_armor',1,horse).status,'applied');
  const llama = { '#has_only_carpet_slot': true };
  assert.equal(place('red_carpet',0,llama).status,'applied'); assert.equal(place('saddle',0,llama).status,'blocked'); assert.equal(place('diamond_horse_armor',0,llama).status,'blocked');
  assert.equal(place('diamond_horse_armor',1,{}).status,'blocked');
  assert.equal(place('diamond_horse_armor',1,{...horse,'#has_only_carpet_slot':true}).status,'blocked');
});
