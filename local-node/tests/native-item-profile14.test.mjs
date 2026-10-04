import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNativeRendererTexture, parseItemTextureAtlas } from '../../editor-core/src/preview/native-renderer-preview.js';
import { DEFAULT_ITEM_ID_PROFILE, LEGACY_ITEM_ID_PROFILE, lookupCurrentNativeItemRawId, lookupCurrentNativeItemIdentifier } from '../../editor-core/src/preview/native-item-id-profile.js';
import { buildItemIconIndex, buildBlockItemVisualIndex } from '../../editor-core/src/preview/item-icon-index.js';
import { normalizePreviewState } from '../../editor-core/src/engine/preview-state.js';
import { loadPackItemIconIndex } from '../item-icon-index.mjs';
const native = rawId => ({ type: 'custom', renderer: 'inventory_item_renderer', property_bag: { '#item_id_aux': rawId * 65536 } });
const atlas = texture_data => parseItemTextureAtlas(JSON.stringify({ texture_data })).atlas;
const index = (directTextures = {}) => ({ icons: {}, blocked: {}, directTextures });

test('static property bags resolve a sign sprite without collection or borrowed plank material', () => {
  const context = { importedItemsStatus: 'ready', importedItems: index({ 'minecraft:sign_acacia': 'textures/items/sign_acacia' }) };
  const found = resolveNativeRendererTexture(native(589), context);
  assert.equal(found.textureRef, 'textures/items/sign_acacia');
  assert.equal(found.itemIdentifier, 'minecraft:acacia_sign');
  assert.equal(found.itemIdProfile, DEFAULT_ITEM_ID_PROFILE);
  assert.equal(found.nativeParityVerified, false);
  assert.equal(lookupCurrentNativeItemRawId('minecraft:acacia_sign'), 589);
  assert.equal(lookupCurrentNativeItemRawId('minecraft:acacia_planks'), -742);
});

test('negative raw IDs retain signed identity in signed and unsigned packed forms', () => {
  for (const rawId of [-742, -312]) {
    for (const packed of [rawId * 65536, (rawId * 65536) >>> 0]) {
      const found = resolveNativeRendererTexture({ renderer: 'inventory_item_renderer', '#item_id_aux': packed });
      assert.equal(found.rawItemId, rawId);
      assert.equal(found.itemIdentifier, rawId === -742 ? 'minecraft:acacia_planks' : 'minecraft:lightning_rod');
      assert.equal(found.issue, 'NATIVE_ITEM_MODEL_REQUIRED');
    }
  }
});

test('sign species with different real filenames do not use a guessed naming convention', () => {
  for (const [id, file] of [['dark_oak_sign', 'sign_darkoak'], ['bamboo_sign', 'bamboo_sign'], ['cherry_sign', 'cherry_sign'], ['mangrove_sign', 'mangrove_sign']]) {
    const context = { importedItemsStatus: 'ready', importedItems: index({ [`minecraft:${file}`]: `textures/items/${file}` }) };
    const found = resolveNativeRendererTexture({ renderer: 'inventory_item_renderer', __jsonui_preview_item_id: `minecraft:${id}` }, context);
    assert.equal(found.textureRef, `textures/items/${file}`, id);
  }
});

test('model materials and entity UV atlases are never presented as automatic inventory sprites', () => {
  for (const [rawId, name, texture] of [[-312, 'lightning_rod', 'textures/blocks/lightning_rod'], [358, 'shield', 'textures/entity/shield']]) {
    const found = resolveNativeRendererTexture(native(rawId), { importedAtlas: atlas({ [name]: { textures: texture } }) });
    assert.equal(found.issue, 'NATIVE_ITEM_MODEL_REQUIRED');
    assert.equal(found.textureRef, null);
    assert.equal(found.nativeSourceTexture, texture);
  }
});

test('current profile never silently interprets an obsolete numeric ID as its old item', () => {
  assert.equal(resolveNativeRendererTexture(native(523)).textureRef, 'textures/items/emerald');
  assert.notEqual(resolveNativeRendererTexture(native(388)).textureRef, 'textures/items/emerald');
  assert.equal(resolveNativeRendererTexture(native(388), { itemIdProfile: LEGACY_ITEM_ID_PROFILE }).textureRef, 'textures/items/emerald');
  assert.equal(resolveNativeRendererTexture(native(742), { itemIdProfile: LEGACY_ITEM_ID_PROFILE }).textureRef, 'textures/items/netherite_ingot');
  assert.equal(resolveNativeRendererTexture(native(624)).textureRef, 'textures/items/netherite_ingot');
  assert.equal(resolveNativeRendererTexture(native(523), { itemIdProfile: 'unknown' }).issue, 'NATIVE_ITEM_ID_PROFILE_INVALID');
});

test('BP-defined IDs and auxiliary item data fail closed instead of choosing unrelated icons', () => {
  assert.equal(lookupCurrentNativeItemRawId('minecraft:apple'), null);
  assert.equal(lookupCurrentNativeItemIdentifier(852), null);
  assert.equal(resolveNativeRendererTexture(native(852)).issue, 'NATIVE_ITEM_ID_RUNTIME_DEPENDENT');
  assert.equal(resolveNativeRendererTexture({ renderer: 'inventory_item_renderer', '#item_id_aux': 589 * 65536 + 1 }).issue, 'NATIVE_ITEM_AUX_DATA_UNSUPPORTED');
});

test('modern opaque renderer data is unresolved, not silently counted as an empty slot', () => {
  const found = resolveNativeRendererTexture({ renderer: 'inventory_item_renderer', property_bag: { '#item_renderer_data': { native: true } } });
  assert.equal(found.issue, 'NATIVE_ITEM_RENDERER_DATA_UNSUPPORTED');
  assert.equal(found.empty, undefined);
  assert.equal(resolveNativeRendererTexture({ renderer: 'inventory_item_renderer', '#item_valid': false, '#item_renderer_data': {} }).empty, true);
});

test('preview item rows produce current raw IDs and leave custom / dynamic identities symbolic', () => {
  const data = normalizePreviewState({ slots: { items: [{ id: 'acacia_sign' }, { id: 'acacia_planks' }, { id: 'apple' }, { id: 'custom:gem' }, { id: 'acacia_sign', count: 0 }] } }).collectionData.items;
  assert.deepEqual(data.map(row => row['#item_id_aux']), [589 * 65536, -742 * 65536, 0, 0, 0]);
  assert.equal(data[2].__jsonui_preview_item_id, 'minecraft:apple');
  assert.equal(data[3].__jsonui_preview_item_id, 'custom:gem');
  assert.equal(data[4]['#item_valid'], false);
});

test('custom block visuals require models unless an explicit same-ID icon is provided', async () => {
  const block = { 'minecraft:block': { description: { identifier: 'test:machine' }, components: {
    'minecraft:item_visual': { geometry: 'geometry.machine', material_instances: { '*': { texture: 'machine_uv' } } },
  } } };
  const blockIndex = buildBlockItemVisualIndex([{ path: 'blocks/machine.json', document: block }]);
  const context = { importedItemsStatus: 'ready', importedItems: { ...index(), ...blockIndex },
    importedAtlas: atlas({ 'test:machine': { textures: 'textures/blocks/machine_uv' }, machine_icon: { textures: 'textures/items/machine_icon' } }) };
  const props = { renderer: 'inventory_item_renderer', __jsonui_preview_item_id: 'test:machine' };
  assert.equal(resolveNativeRendererTexture(props, context).issue, 'NATIVE_ITEM_MODEL_REQUIRED');
  const item = { 'minecraft:item': { description: { identifier: 'test:machine' }, components: {
    'minecraft:icon': { textures: { default: 'machine_icon' } },
    'minecraft:block_placer': { block: 'test:machine', replace_block_item: true },
  } } };
  context.importedItems.icons = buildItemIconIndex({ itemDefinitions: [{ path: 'items/machine.json', document: item }] }).icons;
  assert.equal(resolveNativeRendererTexture(props, context).textureRef, 'textures/items/machine_icon');
  const files = { 'blocks/machine.json': JSON.stringify(block), 'items/machine.json': JSON.stringify(item) };
  const loaded = await loadPackItemIconIndex({ packPaths: Object.keys(files), rootPrefix: '', zipReader: { readText: async path => files[path] } });
  assert.equal(loaded.models['test:machine'].kind, 'block-item-model');
  assert.equal(loaded.icons['test:machine'].atlasKey, 'machine_icon');
});

test('profile getters are not executed', () => {
  let count = 0;
  const context = Object.defineProperty({}, 'itemIdProfile', { get() { count++; throw new Error('not allowed'); } });
  assert.equal(resolveNativeRendererTexture(native(589), context).issue, 'NATIVE_ITEM_ID_PROFILE_INVALID');
  assert.equal(count, 0);
});
