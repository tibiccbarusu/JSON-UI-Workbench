/** PHASE700〜702: browser互換描画のsidecar曖昧性をNodeと同じコードで拒否する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { TextureMetadataCache } from '../../editor-core/src/assets/texture-metadata-cache.js';
import { resolveTextureSidecarDrawState } from '../../editor-core/src/preview/texture-sidecar-contract.js';
const source = await readFile(process.env.JSONUI_SIDECAR_REVIEW_SOURCE || new URL('../../editor-core/src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function findTextureSidecarPackPath(');
const end = source.indexOf('// Additional safety:', start);
assert(start >= 0 && end > start);
function setup(importedPaths, importedOverrides = {}, vanillaPaths = ['textures/ui/frame.json']) {
  const reads = [];
  const runtime = (kind, packPaths, overridesTextByPackPath = {}) => ({ packPaths, overridesTextByPackPath, rootPrefix: '', zipReader: { async readText(path) { reads.push(`${kind}:${path}`); return '{"base_size":[5,5]}'; } } });
  const cache = new TextureMetadataCache();
  const context = vm.createContext({ textureSidecarCache: cache, textureSidecarPathIndexByRuntime: new WeakMap(),
    importedPackRuntime: runtime('imported', importedPaths, importedOverrides), vanillaReferenceRuntime: runtime('vanilla', vanillaPaths),
    parseJsonc: text => ({ ok: true, value: JSON.parse(text) }) });
  vm.runInContext(source.slice(start, end), context, { filename: 'main-sidecar-functions.js' });
  return { context, cache, reads };
}
async function settle(cache) { for (let i = 0; i < 20 && cache.active; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(cache.active, 0); }
for (const [name, paths, overrides] of [
  ['原pack pathの大小文字衝突', ['textures/ui/frame.json', 'textures/UI/Frame.json'], {}],
  ['override同士の大小文字衝突', [], { 'textures/ui/frame.json': '{"base_size":[7,7]}', 'textures/UI/frame.json': '{"base_size":[9,9]}' }],
  ['overrideがあっても原pack pathの衝突', ['textures/ui/frame.json', 'textures/UI/Frame.json'], { 'textures/ui/frame.json': '{"base_size":[7,7]}' }],
]) test(`${name}は下位fallbackせず描画前と非同期cacheの両方で拒否する`, async () => {
  const { context, cache, reads } = setup(paths, overrides);
  const first = context.getTextureSidecarDrawRecord('textures/ui/frame.png');
  assert.equal(first.code, 'RASTER_SIDECAR_AMBIGUOUS');
  assert.equal(context.getTextureSidecarMetadata('imported', 'textures/ui/frame.png'), null);
  await settle(cache);
  const after = context.getTextureSidecarDrawRecord('textures/ui/frame.png');
  assert.equal(after.status, 'error');
  assert.equal(after.code, 'RASTER_SIDECAR_AMBIGUOUS');
  assert.equal(cache.get('logical:textures/ui/frame.json')?.code, 'RASTER_SIDECAR_AMBIGUOUS');
  assert.equal(resolveTextureSidecarDrawState({}, after).state, 'missing');
  assert.deepEqual(reads, []);
});
test('一意な上位overrideは下位衝突に影響されず使用される', async () => {
  const { context, cache, reads } = setup(['textures/ui/frame.json'], { 'textures/ui/frame.json': '{"base_size":[7,7]}' }, ['textures/ui/frame.json', 'textures/UI/Frame.json']);
  context.getTextureSidecarMetadata('imported', 'textures/ui/frame.png'); await settle(cache);
  const value = context.getTextureSidecarMetadata('imported', 'textures/ui/frame.png');
  assert.deepEqual([...value.baseSize], [7, 7]); assert.equal(value.sourceKind, 'imported'); assert.deepEqual(reads, []);
});
test('上位にsidecarがなければ一意な下位を読取り、双方欠落ならcache枠を使わない', async () => {
  const x = setup([]); x.context.getTextureSidecarMetadata('imported', 'textures/ui/frame.png'); await settle(x.cache);
  assert.deepEqual(x.reads, ['vanilla:textures/ui/frame.json']); assert.equal(x.context.getTextureSidecarDrawRecord('textures/ui/frame.png').status, 'ready');
  const empty = setup([], {}, []); assert.equal(empty.context.getTextureSidecarMetadata('imported', 'textures/ui/frame.png'), null);
  assert.equal(empty.context.getTextureSidecarDrawRecord('textures/ui/frame.png').status, 'missing'); assert.equal(empty.cache.records.size, 0);
});
