import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { findOriginalExportEntry, preserveExportEntryPoint } from '../workspace-export-entry.mjs';
import { buildWorkspaceExport } from '../workspace-export.mjs';
import { manifest } from './fixtures.mjs';

const encode = values => Object.fromEntries(Object.entries(values).map(([path, value]) => [path, JSON.stringify(value)]));
async function catalog(documents) {
  return buildUiCatalog({ parseJsonc, sources: [{ id: 'test', kind: 'imported', precedence: 1,
    filePaths: Object.keys(documents), readText: async path => documents[path] }] });
}
const fixture = () => ({
  'ui/base.json': { namespace: 'common',
    button: { type: 'button', size: [20, 10], button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: 'button.anvil_take_all_place_all', mapping_type: 'pressed' }],
      bindings: [{ binding_type: 'view', source_control_name: 'item', source_property_name: '#selected', target_property_name: '#visible' }] },
    base: { type: 'screen', '$factory|default': 'common.button', controls: [{ 'input@button': {} }] },
    private: { type: 'screen', '$factory|default': 'common.button', controls: [{ 'input@button': { offset: [11, 7] } }] },
    'container@common.base': { button_mappings: [{ from_button_id: 'button.menu_cancel', to_button_id: 'button.menu_exit', mapping_type: 'global' }] },
    'private_container@common.private': { button_mappings: [{ from_button_id: 'button.menu_cancel', to_button_id: 'button.menu_exit', mapping_type: 'global' }] },
  },
  'ui/main.json': { namespace: 'anvil', 'anvil_screen@common.private_container': {
    variables: [{ requires: '$desktop_screen', '$screen_content': 'anvil.panel' }, { requires: '$pocket_screen', '$screen_content': 'anvil.pocket_panel' }],
    '$close_on_player_hurt|default': true, close_on_player_hurt: '$close_on_player_hurt' },
    other: { type: 'screen', controls: [{ 'input@common.button': {} }] },
  },
});
const originalDocument = { namespace: 'anvil', 'anvil_screen@common.container': {} };

test('外部 screen key を保持し、移動・操作名・bindings・生の条件分岐を残す', async () => {
  const documents = encode(fixture()), cat = await catalog(documents), selected = cat.recordsById[cat.symbols['anvil.anvil_screen'].winnerId];
  const before = resolveEffectiveUi({ catalog: cat, recordId: selected.id, variables: { '$desktop_screen': true, '$pocket_screen': false } });
  assert.equal(before.ok, true);
  const result = preserveExportEntryPoint({ catalog: cat, selected, original: findOriginalExportEntry(originalDocument, selected) });
  assert.equal(result.record.rawKey, 'anvil_screen@common.container');
  assert.deepEqual(result.report.preservedProperties, [{ property: 'controls', authoredNamespace: 'common' }]);
  assert.deepEqual(result.record.value.variables, selected.value.variables);
  assert.equal(result.record.value.close_on_player_hurt, '$close_on_player_hurt');
  assert.equal(Object.keys(result.record.value.controls[0])[0], 'input@common.button');
  const output = fixture(); delete output['ui/main.json'][selected.rawKey]; output['ui/main.json'][result.record.rawKey] = result.record.value;
  const afterCat = await catalog(encode(output));
  const after = resolveEffectiveUi({ catalog: afterCat, recordId: afterCat.symbols['anvil.anvil_screen'].winnerId,
    variables: { '$desktop_screen': true, '$pocket_screen': false } });
  assert.equal(after.ok, true); assert.deepEqual(after.document, before.document);
  const control = after.document.anvil_screen.controls[0].input;
  assert.deepEqual(control.offset, [11, 7]);
  assert.equal(control.button_mappings[0].to_button_id, 'button.anvil_take_all_place_all');
  assert.equal(control.bindings[0].source_control_name, 'item');
  assert.deepEqual(resolveEffectiveUi({ catalog: afterCat, recordId: afterCat.symbols['anvil.other'].winnerId }).document,
    resolveEffectiveUi({ catalog: cat, recordId: cat.symbols['anvil.other'].winnerId }).document);
});

test('継承元の namespace をgrid/factory/animation/参照用変数に保存し、文字列を一律置換しない', async () => {
  const data = fixture();
  const body = data['ui/base.json'].private;
  body.controls = [{ panel: { type: 'panel', '$template': 'common.button', '$caption': 'button',
    controls: [{ 'child@$template': {} }], grid_item_template: 'button', collection_item_template: 'button',
    factory: { control_ids: { one: '@button' }, control_name: 'row@button' },
    anims: ['@fade'], text: '$caption', source_control_name: 'button' } }];
  const cat = await catalog(encode(data)), selected = cat.recordsById[cat.symbols['anvil.anvil_screen'].winnerId];
  const result = preserveExportEntryPoint({ catalog: cat, selected, original: findOriginalExportEntry(originalDocument, selected) });
  const child = result.record.value.controls[0].panel;
  assert.equal(child.$template, 'common.button'); assert.equal(child.$caption, 'button');
  assert.equal(child.grid_item_template, 'common.button'); assert.equal(child.collection_item_template, 'common.button');
  assert.equal(child.factory.control_ids.one, '@common.button'); assert.equal(child.factory.control_name, 'row@common.button');
  assert.equal(child.anims[0], '@common.fade'); assert.equal(child.source_control_name, 'button');
  assert.equal(Object.keys(child.controls[0])[0], 'child@$template');
});

test('参照と表示式・条件に兼用する変数は一切書換えず停止する', async () => {
  for (const usage of [{ text: '$template' }, { text: "($template + ' suffix')" }, { requires: "($template = 'button')" }]) {
    const data = fixture(); data['ui/base.json'].private.controls = [{ panel: { type: 'panel', '$template': 'button',
      ...usage, controls: [{ 'child@$template': {} }] } }];
    const cat = await catalog(encode(data)), selected = cat.recordsById[cat.symbols['anvil.anvil_screen'].winnerId];
    assert.throws(() => preserveExportEntryPoint({ catalog: cat, selected, original: findOriginalExportEntry(originalDocument, selected) }),
      { code: 'EXPORT_ENTRY_NAMESPACE_VARIABLE_UNPROVEN' });
    assert.equal(data['ui/base.json'].private.controls[0].panel.$template, 'button');
  }
});

test('兄弟controlの同名変数宣言で外部の省略namespaceを隠さない', async () => {
  const data = fixture();
  data['ui/base.json'].private['$factory|default'] = 'button'; data['ui/base.json'].base['$factory|default'] = 'button';
  data['ui/base.json'].private.controls = [{ local: { type: 'panel', '$factory': 'common.button', controls: [{ 'child@$factory': {} }] } },
    { external: { type: 'panel', controls: [{ 'child@$factory': {} }] } }];
  const cat = await catalog(encode(data)), selected = cat.recordsById[cat.symbols['anvil.anvil_screen'].winnerId];
  assert.throws(() => preserveExportEntryPoint({ catalog: cat, selected, original: findOriginalExportEntry(originalDocument, selected) }),
    { code: 'EXPORT_ENTRY_NAMESPACE_EXTERNAL_VARIABLE_UNPROVEN' });
});

test('動的なtemplate参照を元namespace不明のまま移植しない', async () => {
  for (const dynamic of ["('button')", '#template']) {
    const data = fixture(); data['ui/base.json'].private.controls = [{ panel: { type: 'grid', grid_item_template: dynamic } }];
    const cat = await catalog(encode(data)), selected = cat.recordsById[cat.symbols['anvil.anvil_screen'].winnerId];
    assert.throws(() => preserveExportEntryPoint({ catalog: cat, selected, original: findOriginalExportEntry(originalDocument, selected) }),
      { code: 'EXPORT_ENTRY_NAMESPACE_DYNAMIC_REFERENCE_UNPROVEN' });
  }
});

test('@を含む変数名・property_bag keyをcontrol参照と混同しない', async () => {
  const data = fixture(); data['ui/base.json'].private.controls = [{ panel: { type: 'panel', '$key@custom': 'button',
    property_bag: { '#key@custom': 'button' }, controls: [{ 'child@button': {} }] } }];
  const cat = await catalog(encode(data)), selected = cat.recordsById[cat.symbols['anvil.anvil_screen'].winnerId];
  const result = preserveExportEntryPoint({ catalog: cat, selected, original: findOriginalExportEntry(originalDocument, selected) });
  const panel = result.record.value.controls[0].panel;
  assert.equal(panel['$key@custom'], 'button'); assert.deepEqual(panel.property_bag, { '#key@custom': 'button' });
  assert.equal(Object.keys(panel.controls[0])[0], 'child@common.button');
});

test('移植範囲外の変数はcallerを上書きせず、namespace付きの全候補だけ許可する', async () => {
  for (const explicit of [true, false]) {
    const data = fixture();
    data['ui/base.json'].private.controls = [{ 'input@$factory': { offset: [11, 7] } }];
    data['ui/base.json'].private['$factory|default'] = explicit ? 'common.button' : 'button';
    data['ui/base.json'].base['$factory|default'] = explicit ? 'common.button' : 'button';
    const cat = await catalog(encode(data)), selected = cat.recordsById[cat.symbols['anvil.anvil_screen'].winnerId];
    const run = () => preserveExportEntryPoint({ catalog: cat, selected, original: findOriginalExportEntry(originalDocument, selected) });
    if (explicit) assert.equal(Object.keys(run().record.value.controls[0])[0], 'input@$factory');
    else assert.throws(run, { code: 'EXPORT_ENTRY_NAMESPACE_EXTERNAL_VARIABLE_UNPROVEN' });
  }
});

test('modifications・動的継承・変数スコープ差分は未証明として停止する', async () => {
  for (const kind of ['modifications', 'dynamic', 'variables']) {
    const data = fixture();
    if (kind === 'modifications') data['ui/base.json'].private.modifications = [];
    if (kind === 'dynamic') { data['ui/base.json']['private@$base'] = data['ui/base.json'].private; delete data['ui/base.json'].private; }
    if (kind === 'variables') data['ui/base.json'].private['$changed'] = true;
    const cat = await catalog(encode(data)), selected = cat.recordsById[cat.symbols['anvil.anvil_screen'].winnerId];
    assert.throws(() => preserveExportEntryPoint({ catalog: cat, selected, original: findOriginalExportEntry(originalDocument, selected) }),
      { code: kind === 'modifications' ? 'EXPORT_ENTRY_MODIFICATIONS_UNPROVEN'
        : kind === 'dynamic' ? 'EXPORT_ENTRY_DYNAMIC_INHERITANCE' : 'EXPORT_ENTRY_VARIABLE_SCOPE_UNPROVEN' });
  }
});

test('実export境界もoverride前のscreen keyを保存し、元入力を変更しない', async () => {
  const data = fixture();
  // The integration fixture needs no runtime assets; remove the view-only binding.
  delete data['ui/base.json'].button.bindings;
  const edited = encode(data), originals = { ...edited,
    'manifest.json': typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    'ui/main.json': JSON.stringify({ ...originalDocument, other: data['ui/main.json'].other }) };
  const input = { id: 'test', kind: 'imported', paths: Object.keys(originals), overrides: { 'ui/main.json': edited['ui/main.json'] },
    readText: async path => originals[path], readBytes: async path => Buffer.from(originals[path]) };
  const result = await buildWorkspaceExport({ sources: [input], selections: [{ filePath: 'ui/main.json', definition: 'anvil.anvil_screen' }] });
  assert.equal(result.ok, true, JSON.stringify(result.plan.unresolved));
  assert.equal(result.plan.selectedDefinitions[0].rawKey, 'anvil_screen@common.container');
  assert.equal(result.plan.entryPointPreservation.length, 1);
  assert.equal(input.overrides['ui/main.json'], edited['ui/main.json']);
  assert.equal(originals['ui/main.json'], JSON.stringify({ ...originalDocument, other: data['ui/main.json'].other }));
});

test('特殊なJSONキーをprototype setterとして扱わず原文data propertyとして保存する', async () => {
  const data = fixture();
  Object.defineProperty(data['ui/base.json'].private, '__proto__', { value: { authored: true }, enumerable: true });
  const cat = await catalog(encode(data)), selected = cat.recordsById[cat.symbols['anvil.anvil_screen'].winnerId];
  const result = preserveExportEntryPoint({ catalog: cat, selected, original: findOriginalExportEntry(originalDocument, selected) });
  assert.equal(Object.hasOwn(result.record.value, '__proto__'), true);
  assert.deepEqual(result.record.value.__proto__, { authored: true });
  assert.equal(Object.getPrototypeOf(result.record.value), Object.prototype);
  assert.equal(Object.prototype.authored, undefined);
});

test('元入口不明の私有継承mcpackは未復元を診断し、復元済みとは報告しない', async () => {
  const data = fixture(), main = data['ui/main.json'];
  main['anvil_screen@common.__jsonui_123456abcdef_1'] = main['anvil_screen@common.private_container']; delete main['anvil_screen@common.private_container'];
  data['ui/base.json']['__jsonui_123456abcdef_1@common.private'] = data['ui/base.json']['private_container@common.private'];
  delete data['ui/base.json'].button.bindings;
  const documents = encode(data); documents['manifest.json'] = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
  const input = { id: 'imported', kind: 'imported', paths: Object.keys(documents), readText: async path => documents[path], readBytes: async path => Buffer.from(documents[path]) };
  const result = await buildWorkspaceExport({ sources: [input], selections: [{ filePath: 'ui/main.json', definition: 'anvil.anvil_screen' }] });
  assert.equal(result.ok, true, JSON.stringify(result.plan.unresolved));
  assert.deepEqual(result.plan.entryPointPreservation, []);
  assert(result.plan.warnings.some(row => row.code === 'EXPORT_ENTRY_ORIGINAL_UNAVAILABLE'));
});
