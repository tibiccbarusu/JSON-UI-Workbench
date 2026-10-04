import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsWithRepresentativeRuntime } from '../../editor-core/src/engine/preview-bindings-runtime.js';
import { buildRepresentativeClassicBindingMockData } from '../../editor-core/src/engine/representative-classic-runtime.js';
import { resolveNativeRendererTexture } from '../../editor-core/src/preview/native-renderer-preview.js';

// 固定common UIの実binding名・override先を使い、collection解決からnative判断まで通す。
const bar = (name, target) => ({ type: 'custom', renderer: 'progress_bar_renderer', size: [12, 1], bindings: [
  { binding_type: 'collection', binding_collection_name: 'anvil_input_items', binding_name: name, binding_name_override: target },
] });
function model() {
  return buildUiScreenModelFromJson({ namespace: 'anvil', anvil_screen: { type: 'screen', controls: [
    { slot: { type: 'panel', collection_index: 0, __jsonui_preview_collection_name: 'anvil_input_items', controls: [
      { durability: bar('#item_durability_visible', '#touch_progress_bar_visible') },
      { storage: bar('#item_storage_visible', '#progress_bar_visible') },
    ] } },
    { text: { type: 'label', text: '#item_name', bindings: [{ binding_name: '#text_box_item_name', binding_name_override: '#item_name' }] } },
  ] } }, { filePath: 'ui/anvil_screen.json' });
}
function properties(result, suffix) {
  const entry = Object.entries(result.propsById).find(([id]) => id.endsWith(suffix));
  assert.ok(entry, suffix); return entry[1];
}

test('空金床の共有binding解決では耐久・収納バーと入力文字が空状態になる', () => {
  const result = evaluateBindingsWithRepresentativeRuntime(model(), 'anvil.anvil_screen', {});
  for (const name of ['/durability', '/storage']) {
    const resolved = resolveNativeRendererTexture(properties(result, name));
    assert.equal(resolved.status, 'not-applicable'); assert.equal(resolved.empty, true);
    assert.equal(resolved.source, 'runtime-visibility');
  }
  assert.equal(properties(result, '/text').item_name, '');
});

test('利用者が耐久・収納バーを有効化したslotはemptyとして省略しない', () => {
  const result = evaluateBindingsWithRepresentativeRuntime(model(), 'anvil.anvil_screen', { __collections: {
    anvil_input_items: [{ '#item_valid': true, '#item_durability_visible': true, '#item_storage_visible': true }],
  }, '#text_box_item_name': '検証した名前' });
  for (const name of ['/durability', '/storage']) assert.notEqual(resolveNativeRendererTexture(properties(result, name)).empty, true);
  assert.equal(properties(result, '/text').item_name, '検証した名前');
});

test('任意画面・入力済みアイテムに未指定文字や耐久状態を捏造しない', () => {
  const custom = buildRepresentativeClassicBindingMockData({ qualifiedName: 'custom.anvil_screen' });
  assert.equal(Object.hasOwn(custom, '#text_box_item_name'), false);
  assert.equal(Object.hasOwn(custom, '#selected_item_durability_visible'), false);
  const occupied = buildRepresentativeClassicBindingMockData({ qualifiedName: 'anvil.anvil_screen', userMockData: {
    '#inventory_selected_item': 17301504,
    __collections: { anvil_input_items: [{ '#item_valid': true }] },
  } });
  assert.equal(Object.hasOwn(occupied, '#text_box_item_name'), false);
  assert.equal(Object.hasOwn(occupied, '#selected_item_durability_visible'), false);
  const explicit = buildRepresentativeClassicBindingMockData({ qualifiedName: 'anvil.anvil_screen', userMockData: {
    '#inventory_selected_item_stack_count': '5', '#selected_item_durability_visible': true, '#progress_bar_visible': true,
  } });
  assert.equal(explicit['#inventory_selected_item_stack_count'], '5');
  assert.equal(explicit['#selected_item_durability_visible'], true); assert.equal(explicit['#progress_bar_visible'], true);
});

test('専用visibilityは明示falseだけを空と判定し未指定・不正・別rendererを省略しない', () => {
  const renderer = 'progress_bar_renderer';
  for (const props of [{}, { progress_bar_visible: true }, { progress_bar_visible: 'false' },
    { progress_bar_visible: false, '#progress_bar_visible': true },
    { progress_bar_visible: false, touch_progress_bar_visible: true }]) {
    assert.notEqual(resolveNativeRendererTexture({ renderer, ...props }).empty, true);
  }
  const overridden = resolveNativeRendererTexture({ renderer, progress_bar_visible: true, property_bag: { '#progress_bar_visible': false } });
  assert.notEqual(overridden.empty, true);
  assert.equal(resolveNativeRendererTexture({ renderer, property_bag: { '#progress_bar_visible': false } }).empty, true);
  assert.notEqual(resolveNativeRendererTexture({ renderer: 'flying_item_renderer', progress_bar_visible: false }).empty, true);
  let calls = 0;
  const hostile = resolveNativeRendererTexture({ renderer, get progress_bar_visible() { calls += 1; return false; } });
  assert.notEqual(hostile.empty, true); assert.equal(calls, 0);
});
