import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewRasterCache } from '../../editor-core/src/preview/raster-cache.js';

test('画素数と件数の両方でLRUを制限する', () => {
  const cache = new PreviewRasterCache({ maxPixels: 10, maxEntries: 2 });
  const a = {}, b = {}, c = {};
  cache.set('a', a, 4); cache.set('b', b, 4);
  assert.equal(cache.get('a'), a);
  cache.set('c', c, 4);
  assert.equal(cache.get('b'), null);
  assert.equal(cache.snapshot().pixels, 8);
  cache.set('c', c, 9);
  assert.equal(cache.get('a'), null);
  assert.equal(cache.snapshot().pixels, 9);
  cache.set('oversized', {}, 11);
  assert.equal(cache.get('oversized'), null);
  assert.equal(cache.snapshot().pixels, 9);
});

test('geometry/textureの参照交換と寸法変更は別entryにする', () => {
  const cache = new PreviewRasterCache(); const scene = {}, texture = {};
  const key = cache.key(['native', scene, texture, 18, 18]);
  assert.equal(key, cache.key(['native', scene, texture, 18, 18]));
  assert.notEqual(key, cache.key(['native', {}, texture, 18, 18]));
  assert.notEqual(key, cache.key(['native', scene, {}, 18, 18]));
  assert.notEqual(key, cache.key(['native', scene, texture, 36, 36]));
});
