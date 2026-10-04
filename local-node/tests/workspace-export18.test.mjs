import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkspaceExport } from '../workspace-export.mjs';
import { DiskZipReader } from '../disk-zip.mjs';
import { importResourcePackZip } from '../../editor-core/src/pack-io/pack-importer.js';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { manifest } from './fixtures.mjs';

function source(files, kind = 'imported') {
  const bytes = new Map(Object.entries({ 'manifest.json': manifest, ...files }).map(([path, value]) =>
    [path, Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))]));
  return { id: kind, kind, paths: [...bytes.keys()], readText: async path => bytes.get(path).toString('utf8'), readBytes: async path => bytes.get(path) };
}
const request = (sources, rawKey = 'root') => ({ sources, selections: [{ filePath: 'ui/main.json', rawKey }] });
async function catalog(sources) { return buildUiCatalog({ parseJsonc, sources: sources.map(item => ({ ...item,
  precedence: item.kind === 'imported' ? 1 : 0, filePaths: item.paths, readText: path => item.readText(path) })) }); }
function projected(cat) { const result = resolveEffectiveUi({ catalog: cat, recordId: cat.symbols['n.root'].winnerId }); assert(result.ok); return result.document; }
async function restored(result, callback) {
  assert(result.ok, JSON.stringify(result.plan.unresolved));
  const dir = await mkdtemp(join(tmpdir(), 'jsonui-export18-')), path = join(dir, 'selected.zip'); let pack;
  try {
    await writeFile(path, result.bytes);
    pack = await importResourcePackZip({ diskPath: path, name: 'selected.zip', size: result.bytes.length }, { zipReader: new DiskZipReader() });
    assert(pack.ok);
    const readText = path => pack.zipReader.readText(pack.rootPrefix + path, { maxBytes: 8 * 1024 * 1024 });
    await callback(await catalog([{ id: 'restored', kind: 'imported', paths: pack.packPaths, readText }]), pack, readText);
  } finally { if (pack?.ok) await pack.zipReader.close(); await rm(dir, { recursive: true, force: true }); }
}

test('同じUIファイルの上下層にある別定義を結合し編集offsetをZIP再読込後も維持', async () => {
  const sources = [source({ 'ui/main.json': { namespace: 'n', root: { type: 'panel', controls: [{ 'icon@n.icon': {} }] },
    icon: { type: 'image', texture: 'textures/icon', offset: [0, 0] }, unused: { type: 'panel' } }, 'textures/icon.png': Buffer.from([1]) }, 'vanilla'),
  source({ 'ui/main.json': { namespace: 'n', icon: { type: 'image', texture: 'textures/icon', offset: [13, 7] } },
    'textures/icon.png': Buffer.from([2]), 'textures/unused.png': Buffer.from([3]) })];
  const before = projected(await catalog(sources)), result = await buildWorkspaceExport(request(sources));
  await restored(result, async (cat, pack, readText) => {
    assert.deepEqual(projected(cat), before);
    const main = JSON.parse(await readText('ui/main.json'));
    assert.deepEqual(main.icon.offset, [13, 7]); assert(!main.unused);
    assert(!pack.packPaths.includes('textures/unused.png'));
    assert.deepEqual(await pack.zipReader.bytes('textures/icon.png'), Buffer.from([2]));
  });
});

test('同名ファイルで文書変数の値が競合する場合は未確定scopeを成功として出力しない', async () => {
  const sources = [source({ 'ui/main.json': { namespace: 'n', '$shape': [21, 22], root: { type: 'panel', size: '$shape',
    controls: [{ 'icon@n.icon': {} }] } } }, 'vanilla'), source({ 'ui/main.json': { namespace: 'n', '$shape': [4, 5],
    icon: { type: 'panel', size: '$shape' } } })];
  const result = await buildWorkspaceExport(request(sources));
  assert(!result.ok); assert.equal(result.bytes, undefined);
  assert(result.plan.unresolved.some(row => row.code === 'EXPORT_UI_DOCUMENT_VARIABLE_SCOPE_UNSUPPORTED'));
});

test('同名自己継承を一層へ誤結合せず拒否する', async () => {
  const sources = [source({ 'ui/main.json': { namespace: 'n', root: { type: 'panel' } } }, 'vanilla'),
    source({ 'ui/main.json': { namespace: 'n', 'root@n.root': { size: [10, 10] } } })];
  const result = await buildWorkspaceExport(request(sources, 'root@n.root'));
  assert(!result.ok); assert.equal(result.bytes, undefined);
  assert(result.plan.unresolved.some(row => row.code === 'EXPORT_UI_LAYER_COMPOSITION_UNSUPPORTED'));
});

test('既知engine textとcontroller bindingだけを外部依存へ分類しplatform glyphを残す', async () => {
  const files = { 'ui/main.json': { namespace: 'n', root: { type: 'panel', controls: [
    { text: { type: 'label', text: '#inventory_stack_count' } },
    { glyph: { type: 'image', texture: '#controller_face_left_icon' } }] } },
    'textures/ui/xbox_face_button_left.png': Buffer.from([1]), 'textures/ui/ps4_face_button_left.png': Buffer.from([2]),
    'textures/unused.png': Buffer.from([3]) };
  const result = await buildWorkspaceExport(request([source(files)]));
  assert(result.ok, JSON.stringify(result.plan.unresolved));
  assert(result.plan.warnings.some(row => row.code === 'EXPORT_ENGINE_TEXT_BINDING_DEPENDENCY'));
  assert(result.plan.warnings.some(row => row.code === 'EXPORT_ENGINE_CONTROLLER_TEXTURE_DEPENDENCY'));
  assert(result.plan.files.some(row => row.path === 'textures/ui/ps4_face_button_left.png'));
  assert(!result.plan.files.some(row => row.path === 'textures/unused.png'));
  for (const bad of [{ type: 'image', texture: '#my_unknown_runtime_texture' }, { type: 'image', texture: 'textures/missing' },
    { type: 'label', text: '#my_unknown_runtime_text' }, { type: 'image', texture: '#inventory_stack_count' }]) {
    const failure = await buildWorkspaceExport(request([source({ 'ui/main.json': { namespace: 'n', root: bad } })]));
    assert(!failure.ok); assert.equal(failure.bytes, undefined);
  }
});

test('明示collection item bindingは実機依存を報告し、裸renderer/未知renderer/独自item素材は拒否', async () => {
  const root = { type: 'custom', renderer: 'inventory_item_renderer', bindings: [
    { binding_name: '#item_renderer_data', binding_type: 'collection', binding_collection_name: 'inventory_items' }] };
  const result = await buildWorkspaceExport(request([source({ 'ui/main.json': { namespace: 'n', root } })]));
  assert(result.ok, JSON.stringify(result.plan.unresolved));
  assert(result.plan.warnings.some(row => row.code === 'EXPORT_NATIVE_ENGINE_INVENTORY_DEPENDENCY'));
  for (const value of [{ type: 'custom', renderer: 'inventory_item_renderer' }, { type: 'custom', renderer: 'unknown_renderer' }]) {
    assert(!(await buildWorkspaceExport(request([source({ 'ui/main.json': { namespace: 'n', root: value } })]))).ok);
  }
  const custom = await buildWorkspaceExport(request([source({ 'ui/main.json': { namespace: 'n', root }, 'textures/items/custom.png': Buffer.from([1]) })]));
  assert(!custom.ok); assert.equal(custom.bytes, undefined);
  assert(custom.plan.unresolved.some(row => row.code === 'EXPORT_NATIVE_RUNTIME_CUSTOM_ASSETS_UNRESOLVED'));
  const unknownCollection = structuredClone(root); unknownCollection.bindings[0].binding_collection_name = 'user_custom_collection';
  assert(!(await buildWorkspaceExport(request([source({ 'ui/main.json': { namespace: 'n', root: unknownCollection } })]))).ok);
});

test('既知runtime文字では独自rootfont・locale font・全文翻訳を欠落させず保持する', async () => {
  for (const path of ['font/default8.png', 'font/glyph_6F.png', 'texts/ja_JP/font/glyph_6F.png', 'texts/ja_JP.lang']) {
    const result = await buildWorkspaceExport(request([source({ 'ui/main.json': { namespace: 'n', root: { type: 'label', text: '#item_name' } },
      [path]: path.endsWith('.lang') ? 'item.diamond.name=漢字の名前\n' : Buffer.from([1]) })]));
    assert(result.ok, JSON.stringify(result.plan.unresolved)); assert(result.bytes);
    assert(result.plan.files.some(row => row.path === path), path);
    assert(result.plan.runtimeTextOverrideRetention.paths.includes(path));
  }
});

test('既知controller bindingでも別binding・view・property bagで上書きされた独自素材は省かない', async () => {
  for (const input of [
    { bindings: [{ binding_type: 'view', source_property_name: "('textures/custom_icon')", target_property_name: '#controller_face_left_icon' }] },
    { bindings: [{ binding_name: '#my_custom_texture', binding_name_override: '#controller_face_left_icon' }] },
    { property_bag: { '#controller_face_left_icon': 'textures/custom_icon' } },
  ]) {
    const result = await buildWorkspaceExport(request([source({ 'ui/main.json': { namespace: 'n', root: {
      type: 'image', texture: '#controller_face_left_icon', ...input } }, 'textures/custom_icon.png': Buffer.from([1]) })]));
    assert(!result.ok); assert.equal(result.bytes, undefined);
    assert(result.plan.unresolved.some(row => row.code === 'EXPORT_ENGINE_BINDING_OVERRIDE_UNRESOLVED'));
  }
});

test('標準名とvanilla指定だけでは組込画面と認定せず、未確認内容・直接参照・改変は厳格走査', async () => {
  const files = {
    'ui/main.json': { namespace: 'n', 'root@common.screen_panel': {} },
    'ui/ui_common.json': { namespace: 'common', screen_panel: { type: 'panel', controls: [
      { popup_dialog_factory: { type: 'factory', control_ids: {
        storage_dependency_popup: '@storage_management_popup.storage_dependency_modal' } } }] } },
    'ui/storage_management_popup.json': { namespace: 'storage_management_popup', storage_dependency_modal: {
      type: 'panel', controls: [{ 'bad@missing.control': {} }] } },
  };
  const vanilla = source(files, 'vanilla');
  const result = await buildWorkspaceExport(request([vanilla], 'root@common.screen_panel'));
  assert(!result.ok); assert.equal(result.bytes, undefined);
  assert.deepEqual(result.plan.externalUiDefinitions, []);
  assert(result.plan.unresolved.some(row => row.code === 'EXPORT_UI_SYMBOL_MISSING'));
  const selected = await buildWorkspaceExport({ sources: [vanilla], selections: [{ filePath: 'ui/storage_management_popup.json', rawKey: 'storage_dependency_modal' }] });
  assert(!selected.ok); assert(selected.plan.unresolved.some(row => row.code === 'EXPORT_UI_SYMBOL_MISSING'));
  const directFiles = structuredClone(files);
  directFiles['ui/main.json'] = { namespace: 'n', root: { type: 'panel', controls: [
    { 'common@common.screen_panel': {} }, { 'direct@storage_management_popup.storage_dependency_modal': {} }] } };
  assert(!(await buildWorkspaceExport(request([source(directFiles, 'vanilla')]))).ok);
  const changed = source(files, 'vanilla');
  changed.overrides = { 'ui/ui_common.json': JSON.stringify(files['ui/ui_common.json']) + '\n' };
  assert(!(await buildWorkspaceExport(request([changed], 'root@common.screen_panel'))).ok);
  const targetChanged = source(files, 'vanilla');
  targetChanged.overrides = { 'ui/storage_management_popup.json': JSON.stringify(files['ui/storage_management_popup.json']) + '\n' };
  assert(!(await buildWorkspaceExport(request([targetChanged], 'root@common.screen_panel'))).ok);
  const custom = source({ 'ui/custom_dialog.json': { namespace: 'popup_dialog', customized: { type: 'panel' } } });
  assert(!(await buildWorkspaceExport(request([vanilla, custom], 'root@common.screen_panel'))).ok);
  const wrongEvent = structuredClone(files);
  wrongEvent['ui/ui_common.json'].screen_panel.controls[0].popup_dialog_factory.control_ids = { user_event: '@storage_management_popup.storage_dependency_modal' };
  assert(!(await buildWorkspaceExport(request([source(wrongEvent, 'vanilla')], 'root@common.screen_panel'))).ok);
});
