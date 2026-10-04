import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItemIconIndex, normalizeItemIconIdentifier, ITEM_ICON_INDEX_MAX_DEFINITIONS } from '../../editor-core/src/preview/item-icon-index.js';

function definition(identifier, icon, path = 'items/item.json') {
  return { path, document: { 'minecraft:item': { description: { identifier }, components: { 'minecraft:icon': icon } } } };
}

test('official icon forms map the exact identifier to its atlas key', () => {
  const result = buildItemIconIndex({ itemDefinitions: [
    definition('minecraft:apple', 'apple'),
    definition('minecraft:golden_apple', { texture: 'apple_golden' }),
    definition('example:gem', { textures: { default: 'special_gem', trim: 'unused' } }),
  ] });
  assert.deepEqual(JSON.parse(JSON.stringify(result.icons)), {
    'minecraft:apple': { atlasKey: 'apple' },
    'minecraft:golden_apple': { atlasKey: 'apple_golden' },
    'example:gem': { atlasKey: 'special_gem' },
  });
  assert.equal(result.stats.mapped, 3);
  assert.equal(result.diagnostics.length, 0);
});

test('vanilla shorthand normalizes without stripping custom namespaces', () => {
  assert.equal(normalizeItemIconIdentifier('diamond'), 'minecraft:diamond');
  assert.equal(normalizeItemIconIdentifier('custom:diamond'), 'custom:diamond');
  const result = buildItemIconIndex({ itemDefinitions: [definition('diamond', 'diamond'), definition('custom:diamond', 'gem_blue')] });
  assert.equal(result.icons['minecraft:diamond'].atlasKey, 'diamond');
  assert.equal(result.icons['custom:diamond'].atlasKey, 'gem_blue');
  assert.equal(Object.hasOwn(result.icons, 'diamond'), false);
});

test('duplicates block both conflicting and identical declarations', () => {
  for (const second of ['apple', 'pear']) {
    const result = buildItemIconIndex({ itemDefinitions: [definition('apple', 'apple'), definition('minecraft:apple', second)] });
    assert.equal(Object.hasOwn(result.icons, 'minecraft:apple'), false);
    assert.equal(result.blocked['minecraft:apple'], 'ambiguous_duplicate');
    assert.equal(result.stats.blocked, 1);
  }
});

test('a malformed duplicate cannot leave the earlier identifier active', () => {
  const result = buildItemIconIndex({ itemDefinitions: [definition('apple', null), definition('apple', 'apple')] });
  assert.equal(Object.hasOwn(result.icons, 'minecraft:apple'), false);
  assert.equal(result.blocked['minecraft:apple'], 'ambiguous_duplicate');
});

test('different old and new icon keys block guessing; equal keys are accepted', () => {
  const result = buildItemIconIndex({ itemDefinitions: [
    definition('bad', { texture: 'first', textures: { default: 'second' } }),
    definition('good', { texture: 'same', textures: { default: 'same' } }),
  ] });
  assert.equal(result.blocked['minecraft:bad'], 'ambiguous_icon_keys');
  assert.equal(result.icons['minecraft:good'].atlasKey, 'same');
});

test('a missing component does not invent a definition mapping', () => {
  const missing = definition('apple', 'unused');
  delete missing.document['minecraft:item'].components['minecraft:icon'];
  const result = buildItemIconIndex({ itemDefinitions: [missing] });
  assert.equal(result.diagnostics[0].code, 'missing_icon');
  assert.equal(result.stats.mapped, 0);
  assert.equal(result.stats.blocked, 0);
});

test('unsafe identifiers and keys cannot pollute objects or traverse paths', () => {
  for (const identifier of ['__proto__', 'minecraft:constructor', '../apple', 'minecraft:a/../b', 'A:apple', 'a:b:c', 'x:apple\\a']) {
    assert.equal(normalizeItemIconIdentifier(identifier), null);
  }
  for (const icon of ['__proto__', 'a/../b', 'a\\b', 'a\u0000b', ' x', 'x ', '', 'x'.repeat(257)]) {
    const result = buildItemIconIndex({ itemDefinitions: [definition('apple', icon)] });
    assert.equal(result.stats.mapped, 0);
    assert.equal(result.blocked['minecraft:apple'], 'invalid_icon_key');
  }
  assert.equal({}.atlasKey, undefined);
});

test('getters in options, array entries, definitions, identifiers, and icons are never executed', () => {
  let calls = 0;
  const getter = () => { calls += 1; throw new Error('must not run'); };
  const options = Object.defineProperty({}, 'itemDefinitions', { get: getter });
  assert.equal(buildItemIconIndex(options).diagnostics[0].code, 'invalid_definitions');
  const list = [];
  Object.defineProperty(list, '0', { get: getter, configurable: true });
  buildItemIconIndex({ itemDefinitions: list });
  const a = definition('apple', 'apple');
  Object.defineProperty(a, 'document', { get: getter });
  const b = definition('apple', 'apple');
  Object.defineProperty(b.document['minecraft:item'].description, 'identifier', { get: getter });
  const c = definition('apple', Object.defineProperty({}, 'texture', { get: getter }));
  const result = buildItemIconIndex({ itemDefinitions: [a, b, c] });
  assert.equal(result.stats.mapped, 0);
  assert.equal(calls, 0);
});

test('inherited values and non-plain definitions are rejected', () => {
  const item = definition('apple', 'apple');
  item.document['minecraft:item'].description = Object.create({ identifier: 'apple' });
  const result = buildItemIconIndex({ itemDefinitions: [item] });
  assert.equal(result.diagnostics[0].code, 'invalid_identifier');
});

test('the definition bound rejects the whole catalog before reading any entry', () => {
  let calls = 0;
  const definitions = new Array(ITEM_ICON_INDEX_MAX_DEFINITIONS + 1);
  Object.defineProperty(definitions, '0', { get() { calls += 1; return definition('apple', 'apple'); } });
  const result = buildItemIconIndex({ itemDefinitions: definitions });
  assert.equal(result.stats.limited, true);
  assert.equal(result.stats.scanned, 0);
  assert.equal(calls, 0);
});

test('null-prototype JSON data round-trips and is not mutated', () => {
  const original = definition('custom:apple', { textures: { default: 'custom:apple_icon' } });
  const before = JSON.stringify(original);
  const nullDocument = Object.assign(Object.create(null), original.document);
  const result = buildItemIconIndex({ itemDefinitions: [{ path: original.path, document: nullDocument }] });
  assert.equal(JSON.stringify(original), before);
  assert.equal(JSON.parse(JSON.stringify(result)).icons['custom:apple'].atlasKey, 'custom:apple_icon');
});

test('irrelevant pack paths never cause inferred aliases or asset access', () => {
  let calls = 0;
  const options = { itemDefinitions: [definition('example:apple', 'a')] };
  Object.defineProperty(options, 'packPaths', { get() { calls += 1; throw new Error('must not read'); } });
  const result = buildItemIconIndex(options);
  assert.equal(result.icons['example:apple'].atlasKey, 'a');
  assert.equal(Object.hasOwn(result.icons, 'minecraft:apple'), false);
  assert.equal(calls, 0);
});
