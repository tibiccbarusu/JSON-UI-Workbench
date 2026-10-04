import { test, assert, assertEqual, assertDeepEqual, assertThrows } from './test-harness.js';
import { MemoryPackSource } from '../src/pack-io/memory-pack-source.js';
import { OverlayPackSource } from '../src/pack-io/overlay-pack-source.js';
import { isPackNotFoundError } from '../src/pack-io/pack-source.js';
import { buildAssetIndexFromPackPathsAsync } from '../src/assets/asset-indexer.js';

test('OverlayPackSource resolves overrides first, then base', async () => {
  const base = new MemoryPackSource({
    id: 'base',
    files: {
      'ui/a.json': { text: '{"from":"base"}' },
      'textures/t.png': { text: 'PNGDATA' },
    },
  });
  const overrides = new MemoryPackSource({
    id: 'overrides',
    files: {
      'ui/a.json': { text: '{"from":"override"}' },
      'ui/b.json': { text: '{"from":"override"}' },
    },
  });

  const overlay = new OverlayPackSource({ id: 'overlay', base, overrides });

  const a = await overlay.readText('ui/a.json');
  const b = await overlay.readText('ui/b.json');
  const t = await overlay.readText('textures/t.png');

  assertEqual(a, '{"from":"override"}');
  assertEqual(b, '{"from":"override"}');
  assertEqual(t, 'PNGDATA');

  const listRes = await overlay.listFiles();
  assert(listRes && Array.isArray(listRes.paths), 'Expected listFiles() to return {paths[]}');
  assertDeepEqual(listRes.paths, ['textures/t.png', 'ui/a.json', 'ui/b.json']);
  assertEqual(Boolean(listRes.complete), true);
});

test('OverlayPackSource throws PACK_NOT_FOUND when missing', async () => {
  const base = new MemoryPackSource({ id: 'base', files: { 'ui/a.json': { text: 'x' } } });
  const overrides = new MemoryPackSource({ id: 'overrides', files: {} });
  const overlay = new OverlayPackSource({ id: 'overlay', base, overrides });

  await assertThrows(async () => {
    await overlay.readText('ui/missing.json');
  }, {
    predicate: (err) => isPackNotFoundError(err),
  });
});

test('async asset indexing honors cancellation before scanning', async () => {
  const controller = new AbortController();
  controller.abort();
  await assertThrows(
    () => buildAssetIndexFromPackPathsAsync(['textures/ui/example.png'], { signal: controller.signal }),
    { messageIncludes: 'ASSET_INDEX_ABORTED' },
  );
});
