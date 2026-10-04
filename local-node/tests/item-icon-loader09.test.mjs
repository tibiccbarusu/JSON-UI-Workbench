import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPackItemIconIndex } from '../item-icon-index.mjs';
const doc = (id, icon) => JSON.stringify({ 'minecraft:item': { description: { identifier: id }, components: { 'minecraft:icon': icon } } });
function runtime(files) {
  const reads = [];
  return { reads, packPaths: Object.keys(files), rootPrefix: 'RP/', zipReader: {
    async readText(path, options) {
      reads.push({ path, options });
      const text = files[path.slice(3)];
      assert.equal(typeof text, 'string');
      return text;
    },
    async bytes() { throw new Error('image bytes must not be read'); },
  } };
}

test('loader reads nested JSONC definitions with root prefix and exact byte limit', async () => {
  const item = runtime({ 'items/food/apple.json': `// comment\n${doc('apple', 'apple_icon')}`, 'ui/test.json': 'ignored' });
  const result = await loadPackItemIconIndex(item);
  assert.equal(result.icons['minecraft:apple'].atlasKey, 'apple_icon');
  assert.deepEqual(item.reads, [{ path: 'RP/items/food/apple.json', options: { maxBytes: 512 * 1024 } }]);
  assert.equal(result.processing, 'node-worker');
});

test('overrides win and newly created item definitions are indexed', async () => {
  const item = runtime({ 'items/apple.json': doc('apple', 'original') });
  const result = await loadPackItemIconIndex(item, { 'items/apple.json': doc('apple', 'replacement'), 'items/new.json': doc('custom:foo', { textures: { default: 'bar' } }) });
  assert.equal(result.icons['minecraft:apple'].atlasKey, 'replacement');
  assert.equal(result.icons['custom:foo'].atlasKey, 'bar');
  assert.equal(item.reads.length, 0);
});

test('direct icons inspect paths only, with no nested-directory or custom namespace guessing', async () => {
  const item = runtime({
    'textures/items/coal.png': null,
    'textures/items/coal.tga': null,
    'textures/items/gold_ingot.jpeg': null,
    'textures/items/nested/gem.png': null,
    'textures/blocks/stone.png': null,
  });
  const result = await loadPackItemIconIndex(item);
  assert.deepEqual(JSON.parse(JSON.stringify(result.directTextures)), {
    'minecraft:coal': 'textures/items/coal', 'minecraft:gold_ingot': 'textures/items/gold_ingot',
  });
  assert.equal(item.reads.length, 0);
});

test('case collisions block direct icons and reject item-definition paths', async () => {
  const result = await loadPackItemIconIndex(runtime({ 'textures/items/Foo.png': null, 'textures/items/foo.tga': null }));
  assert.equal(result.blocked['minecraft:foo'], 'ambiguous_direct_texture');
  assert.equal(Object.hasOwn(result.directTextures, 'minecraft:foo'), false);
  await assert.rejects(loadPackItemIconIndex(runtime({ 'items/A.json': doc('a', 'a'), 'items/a.json': doc('b', 'b') })), { code: 'ITEM_ICON_PATH_AMBIGUOUS' });
});

test('definition duplicates stay blocked even when a same-name image exists', async () => {
  const result = await loadPackItemIconIndex(runtime({ 'items/a.json': doc('foo', 'a'), 'items/b.json': doc('foo', 'b'), 'textures/items/foo.png': null }));
  assert.equal(result.blocked['minecraft:foo'], 'ambiguous_duplicate');
  assert.equal(Object.hasOwn(result.directTextures, 'minecraft:foo'), false);
});

test('same-key concurrent and completed calls share one read; irrelevant edits preserve cache', async () => {
  const item = runtime({ 'items/a.json': doc('apple', 'apple') });
  const [a, b] = await Promise.all([loadPackItemIconIndex(item), loadPackItemIconIndex(item)]);
  assert.equal(a, b);
  assert.equal(item.reads.length, 1);
  assert.equal(await loadPackItemIconIndex(item, { 'ui/a.json': 'different' }), a);
  assert.equal(item.reads.length, 1);
});

test('two-generation LRU invalidates changed item overrides and evicts older versions', async () => {
  const item = runtime({ 'items/a.json': doc('apple', 'apple') });
  const original = await loadPackItemIconIndex(item);
  const b = await loadPackItemIconIndex(item, { 'items/new.json': doc('b', 'b') });
  const c = await loadPackItemIconIndex(item, { 'items/new.json': doc('c', 'c') });
  assert.notEqual(b, c);
  const again = await loadPackItemIconIndex(item);
  assert.notEqual(original, again);
  assert.equal(item.reads.length, 4);
});

test('invalid JSON and overlarge documents fail explicitly and failed cache entries are retried', async () => {
  const bad = runtime({ 'items/bad.json': '{ nope' });
  await assert.rejects(loadPackItemIconIndex(bad), { code: 'ITEM_ICON_PARSE_FAILED' });
  await assert.rejects(loadPackItemIconIndex(bad), { code: 'ITEM_ICON_PARSE_FAILED' });
  assert.equal(bad.reads.length, 2);
  await assert.rejects(loadPackItemIconIndex(runtime({ 'items/large.json': ' '.repeat(512 * 1024 + 1) })), { code: 'ITEM_ICON_DOCUMENT_LIMIT' });
  await assert.rejects(loadPackItemIconIndex(runtime({}), { 'items/large.json': ' '.repeat(512 * 1024 + 1) }), { code: 'ITEM_ICON_DOCUMENT_LIMIT' });
});

test('override getters are rejected without execution and definition counts are bounded', async () => {
  let called = 0;
  const overrides = Object.defineProperty({}, 'items/a.json', { enumerable: true, get() { called += 1; return ''; } });
  await assert.rejects(loadPackItemIconIndex(runtime({}), overrides), { code: 'ITEM_ICON_OVERRIDE_INVALID' });
  assert.equal(called, 0);
  const item = runtime({});
  item.packPaths = Array.from({ length: 10001 }, (_, i) => `items/${i}.json`);
  await assert.rejects(loadPackItemIconIndex(item), { code: 'ITEM_ICON_DEFINITION_LIMIT' });
});

test('16 MiB aggregate byte limit stops subsequent item reads', async () => {
  const files = {};
  const body = doc('same', 'same').padEnd(512 * 1024, ' ');
  for (let i = 0; i < 34; i += 1) files[`items/${i}.json`] = body;
  const item = runtime(files);
  await assert.rejects(loadPackItemIconIndex(item), { code: 'ITEM_ICON_TOTAL_LIMIT' });
  assert.equal(item.reads.length, 33);
});
