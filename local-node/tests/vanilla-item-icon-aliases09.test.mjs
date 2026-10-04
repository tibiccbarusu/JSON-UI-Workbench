import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVanillaItemIconAlias } from '../../editor-core/src/preview/vanilla-item-icon-aliases.js';
import { parseItemTextureAtlas, resolveNativeRendererTexture } from '../../editor-core/src/preview/native-renderer-preview.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/vanilla-item-icon-aliases09.json', import.meta.url), 'utf8'));

test('86 verified vanilla IDs resolve through the captured official atlas', () => {
  assert.equal(Object.keys(fixture.verifiedItems).length, 86);
  const parsed = parseItemTextureAtlas(JSON.stringify({ texture_data: fixture.texture_data }));
  assert.equal(parsed.ok, true);
  for (const [identifier, expected] of Object.entries(fixture.verifiedItems)) {
    const alias = getVanillaItemIconAlias(identifier);
    assert(alias, identifier);
    assert.equal(alias.textureRef, expected.textureRef, identifier);
    const result = resolveNativeRendererTexture({
      renderer: 'inventory_item_renderer',
      __jsonui_preview_item_atlas_key: alias.atlasKey,
      __jsonui_preview_item_variant: alias.variant,
    }, { vanillaAtlas: parsed.atlas });
    assert.equal(result.status, 'resolved', identifier);
    assert.equal(result.textureRef, expected.textureRef, identifier);
    const automatic = resolveNativeRendererTexture({renderer:'inventory_item_renderer',__jsonui_preview_item_id:identifier,'#item_valid':true}, {vanillaAtlas:parsed.atlas});
    assert.equal(automatic.textureRef, expected.textureRef, identifier + ' automatic ID');
  }
});

test('books use distinct normal, enchanted, writable, and written textures', () => {
  assert.deepEqual(getVanillaItemIconAlias('minecraft:book'), { atlasKey: 'book_normal', variant: 0, textureRef: 'textures/items/book_normal' });
  assert.deepEqual(getVanillaItemIconAlias('minecraft:enchanted_book'), { atlasKey: 'book_enchanted', variant: 0, textureRef: 'textures/items/book_enchanted' });
  assert.deepEqual(getVanillaItemIconAlias('minecraft:writable_book'), { atlasKey: 'book_writable', variant: 0, textureRef: 'textures/items/book_writable' });
  assert.deepEqual(getVanillaItemIconAlias('minecraft:written_book'), { atlasKey: 'book_written', variant: 0, textureRef: 'textures/items/book_written' });
});

test('tool material indices match their official texture names for all five categories', () => {
  const materials = [['wooden', 'wood'], ['stone', 'stone'], ['iron', 'iron'], ['golden', 'gold'], ['diamond', 'diamond'], ['netherite', 'netherite'], ['copper', 'copper']];
  for (const tool of ['sword', 'axe', 'pickaxe', 'shovel', 'hoe']) {
    for (const [itemMaterial, textureMaterial] of materials) {
      const alias = getVanillaItemIconAlias(`minecraft:${itemMaterial}_${tool}`);
      assert.equal(fixture.texture_data[alias.atlasKey].textures[alias.variant], `textures/items/${textureMaterial}_${tool}`);
    }
  }
});

test('armor material indices match their official texture names', () => {
  const materials = [['leather', 'leather'], ['chainmail', 'chainmail'], ['iron', 'iron'], ['golden', 'gold'], ['diamond', 'diamond'], ['netherite', 'netherite']];
  for (const armor of ['helmet', 'chestplate', 'leggings', 'boots']) {
    for (const [itemMaterial, textureMaterial] of materials) {
      const alias = getVanillaItemIconAlias(`minecraft:${itemMaterial}_${armor}`);
      assert.equal(fixture.texture_data[alias.atlasKey].textures[alias.variant], `textures/items/${textureMaterial}_${armor}`);
    }
  }
});

test('raw and cooked foods are never interchanged', () => {
  for (const [identifier, atlasKey] of [['beef', 'beef_raw'], ['cooked_beef', 'beef_cooked'], ['chicken', 'chicken_raw'], ['cooked_chicken', 'chicken_cooked'], ['porkchop', 'porkchop_raw'], ['cooked_porkchop', 'porkchop_cooked']]) {
    assert.equal(getVanillaItemIconAlias(`minecraft:${identifier}`).atlasKey, atlasKey);
  }
});

test('custom, unknown, malformed, and non-string IDs never receive vanilla aliases', () => {
  let coercions = 0;
  for (const identifier of ['custom:book', 'book', 'minecraft:unknown', 'minecraft:__proto__', 'Minecraft:book', 'minecraft:Book', 'minecraft:book ', null, 1, { toString() { coercions += 1; return 'minecraft:book'; } }]) {
    assert.equal(getVanillaItemIconAlias(identifier), null);
  }
  assert.equal(coercions, 0);
});

test('aliases contain only verified pack-relative references and cannot be modified by a caller', () => {
  const alias = getVanillaItemIconAlias('minecraft:book');
  assert.deepEqual(Object.keys(alias), ['atlasKey', 'variant', 'textureRef']);
  assert.equal(alias.textureRef, 'textures/items/book_normal');
  assert.equal(Object.isFrozen(alias), true);
  assert.throws(() => { alias.atlasKey = 'book_enchanted'; }, TypeError);
  assert.equal(getVanillaItemIconAlias('minecraft:book').atlasKey, 'book_normal');
});

test('a missing current-pack array element stays unresolved', () => {
  const atlas = parseItemTextureAtlas(JSON.stringify({ texture_data: { sword: { textures: ['textures/custom/only_wood'] } } })).atlas;
  const alias = getVanillaItemIconAlias('minecraft:golden_sword');
  const result = resolveNativeRendererTexture({ renderer: 'inventory_item_renderer', __jsonui_preview_item_atlas_key: alias.atlasKey, __jsonui_preview_item_variant: alias.variant }, { importedAtlas: atlas });
  assert.equal(result.status, 'unresolved');
  assert.equal(result.issue, 'ITEM_TEXTURE_ATLAS_VARIANT_OUT_OF_RANGE');
});
