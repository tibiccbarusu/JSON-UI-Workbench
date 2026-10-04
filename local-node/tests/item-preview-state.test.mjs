import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNativeRendererTexture, parseItemTextureAtlas } from '../../editor-core/src/preview/native-renderer-preview.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';

const renderer = 'inventory_item_renderer';
const textureKey = '__jsonui_preview_item_texture';
const atlasKey = '__jsonui_preview_item_atlas_key';
const variantKey = '__jsonui_preview_item_variant';
const atlas = (rows) => parseItemTextureAtlas(JSON.stringify({ texture_data: rows })).atlas;

test('明示した交易品目のpack素材を未知numeric IDより優先する', () => {
  const value = resolveNativeRendererTexture({ renderer, '#item_id_aux': 999 << 16, [textureKey]: 'textures/items/apple' });
  assert.equal(value.status, 'resolved');
  assert.equal(value.textureRef, 'textures/items/apple');
  assert.equal(value.source, 'preview-state');
  assert.equal(value.previewOverride, true);
});

test('collection_detailsの品目指定を読み、行データを変更しない', () => {
  const row = Object.freeze({ [textureKey]: 'textures/items/coal', '#item_id_aux': 263 << 16 });
  const input = Object.freeze({ renderer, __jsonui_preview_collection_details: row });
  assert.equal(resolveNativeRendererTexture(input).textureRef, 'textures/items/coal');
  assert.deepEqual(Object.keys(row), [textureKey, '#item_id_aux']);
  assert.equal(resolveNativeRendererTexture({ ...input, [textureKey]: 'textures/items/apple' }).textureRef, 'textures/items/apple');
});

test('custom atlas keyとvariantはimported優先・範囲外を診断する', () => {
  const importedAtlas = atlas({ 'custom:trade': { textures: ['textures/items/one', 'textures/items/two'] } });
  const vanillaAtlas = atlas({ 'custom:trade': { textures: 'textures/items/vanilla' } });
  const props = { renderer, [atlasKey]: 'custom:trade', [variantKey]: 1 };
  const result = resolveNativeRendererTexture(props, { importedAtlas, vanillaAtlas });
  assert.equal(result.textureRef, 'textures/items/two');
  assert.equal(result.source, 'imported');
  assert.equal(resolveNativeRendererTexture({ ...props, [variantKey]: 9 }, { importedAtlas }).issue, 'ITEM_TEXTURE_ATLAS_VARIANT_OUT_OF_RANGE');
  assert.equal(resolveNativeRendererTexture(props).issue, 'ITEM_TEXTURE_ATLAS_UNAVAILABLE');
  assert.equal(resolveNativeRendererTexture(props, { importedStatus: 'loading', vanillaAtlas }).status, 'pending');
});

test('未知keyを推測したtexture pathで埋めず、sparse importedではvanillaを参照する', () => {
  const props = { renderer, [atlasKey]: 'coal' };
  const importedAtlas = atlas({ diamond: { textures: 'textures/items/diamond' } });
  const vanillaAtlas = atlas({ coal: { textures: 'textures/items/coal' } });
  assert.equal(resolveNativeRendererTexture(props, { importedAtlas }).issue, 'ITEM_TEXTURE_ATLAS_ENTRY_MISSING');
  assert.equal(resolveNativeRendererTexture(props, { importedAtlas, vanillaAtlas }).textureRef, 'textures/items/coal');
});

test('不正な明示品目を別アイテムへ黙って戻さない', () => {
  const invalid = [
    { [textureKey]: '../textures/items/apple' }, { [textureKey]: 'https://example.com/a.png' },
    { [textureKey]: '/textures/a' }, { [textureKey]: 'font/glyph_00.png' },
    { [textureKey]: 'textures/a', [atlasKey]: 'a' }, { [variantKey]: 1 },
    { [atlasKey]: 'coal', [variantKey]: -1 }, { [atlasKey]: 'coal', [variantKey]: 65536 },
    { [atlasKey]: 'coal', [variantKey]: '1' }, { [textureKey]: 'textures/a', [variantKey]: 0 },
  ];
  for (const value of invalid) {
    const result = resolveNativeRendererTexture({ renderer, '#item_id_aux': 523 << 16, ...value });
    assert.equal(result.status, 'unresolved', JSON.stringify(value));
    assert.equal(result.issue, 'NATIVE_PREVIEW_ITEM_OVERRIDE_INVALID');
  }
});

test('品目getterを実行せず拒否し、非inventory rendererに適用しない', () => {
  let reads = 0;
  const input = { renderer };
  Object.defineProperty(input, textureKey, { get() { reads++; throw new Error('do not execute'); } });
  assert.equal(resolveNativeRendererTexture(input).issue, 'NATIVE_PREVIEW_ITEM_OVERRIDE_INVALID');
  assert.equal(reads, 0);
  assert.equal(resolveNativeRendererTexture({ renderer: 'live_horse_renderer', [textureKey]: 'textures/items/apple' }).status, 'not-applicable');
});

test('実binding evaluatorのcollection_detailsから品目textureがrendererへ届く', () => {
  // A custom renderer consumes a row; the collection_panel owns the list.
  const model = buildUiScreenModelFromJson({ namespace: 'test', owner: {
    type: 'collection_panel', collection_name: 'items', controls: [{ item: {
      type: 'custom', renderer, collection_index: 0,
      bindings: [{ binding_type: 'collection_details', binding_collection_name: 'items' }],
    } }],
  } }, { filePath: 'ui/items.json' });
  const result = evaluateBindingsForUiModel(model, { mockData: {}, collectionData: { items: [{ [textureKey]: 'textures/items/apple' }] } });
  const node = model.root.children.flatMap(owner => owner.children).find((node) => node.type === 'custom');
  assert(node);
  const props = { ...node.unknownProps, ...node.props, ...result.propsById[node.id] };
  assert.equal(resolveNativeRendererTexture(props).textureRef, 'textures/items/apple');
});

test('数量0などの明示empty itemは既存品目textureを残さない', () => {
  const row = { [textureKey]: 'textures/items/apple', '#item_valid': false };
  const empty = resolveNativeRendererTexture({ renderer, __jsonui_preview_collection_details: row });
  assert.equal(empty.status, 'not-applicable');
  assert.equal(empty.empty, true);
  assert.equal(empty.textureRef, null);
  const direct = resolveNativeRendererTexture({ renderer, '#item_valid': true, __jsonui_preview_collection_details: row });
  assert.equal(direct.textureRef, 'textures/items/apple');
  assert.equal(resolveNativeRendererTexture({ renderer, '#item_valid': 'false' }).issue, 'NATIVE_PREVIEW_ITEM_STATE_INVALID');
});
