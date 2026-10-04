import test from 'node:test';
import assert from 'node:assert/strict';
import { NativePreviewDocumentCache } from '../../editor-core/src/preview/native-document-cache.js';
import { loadHorsePreviewFromSources } from '../../editor-core/src/preview/native-model-loader.js';

function fixture() {
  const entity = { format_version: '1.10.0', 'minecraft:client_entity': { description: {
    identifier: 'minecraft:horse', geometry: { default: 'geometry.horse' }, textures: { default: 'textures/horse' },
  } } };
  const geometry = { format_version: '1.21.0', 'minecraft:geometry': [{ description: {
    identifier: 'geometry.horse', texture_width: 64, texture_height: 64,
  }, bones: [{ name: 'root', cubes: [{ origin: [0, 0, 0], size: [2, 4, 3], uv: [0, 0] }] }] }] };
  const documents = { 'entity/horse.json': JSON.stringify(entity), 'models/entity/horse.json': JSON.stringify(geometry) };
  let reads = 0;
  const zipReader = { entryIndex: new Map(Object.entries(documents).map(([name, text]) => [name, { info: { uncompressedSize: Buffer.byteLength(text) } }])),
    async readText(name) { reads++; return documents[name]; } };
  const runtime = { rootPrefix: '', zipReader, packPaths: Object.keys(documents), overridesTextByPackPath: {} };
  return { runtime, documents, entity, sources: [{ source: 'imported', runtime }], reads: () => reads };
}
const run = (f, extra = {}) => loadHorsePreviewFromSources({ sources: f.sources, targetEngineVersion: [1, 26, 40], cacheDocuments: true, ...extra });

test('カメラ変更でJSONの再展開を行わず、無キャッシュと同じ投影を返す', async () => {
  const f = fixture(); const cold = await run(f); assert.equal(cold.status, 'ready');
  const firstReads = f.reads(); assert.equal(firstReads, 2);
  const camera = { yaw: 62, pitch: -12 };
  const warm = await run(f, { camera });
  assert.equal(f.reads(), firstReads); assert.equal(warm.status, 'ready');
  assert.notDeepEqual(warm.scene.faces, cold.scene.faces);
  const reference = await run(f, { camera, cacheDocuments: false });
  assert.deepEqual(warm, reference); assert.equal(f.reads(), firstReads * 2);
});

test('Nodeの新runtime wrapperでも同じZIP readerとpathは再利用できる', async () => {
  const f = fixture(); await run(f);
  f.sources = [{ source: 'imported', runtime: { ...f.runtime, overridesTextByPackPath: {} } }];
  await run(f, { camera: { yaw: 20, pitch: 8 } }); assert.equal(f.reads(), 2);
});

test('同じ文字数の編集を含めoverride変更・削除を厳密に追従する', async () => {
  const f = fixture(); await run(f);
  f.entity['minecraft:client_entity'].description.textures.default = 'textures/zebra';
  f.runtime.overridesTextByPackPath['entity/horse.json'] = JSON.stringify(f.entity);
  assert.equal((await run(f)).textureRef, 'textures/zebra');
  f.entity['minecraft:client_entity'].description.textures.default = 'textures/brown';
  f.runtime.overridesTextByPackPath['entity/horse.json'] = JSON.stringify(f.entity);
  assert.equal((await run(f)).textureRef, 'textures/brown');
  delete f.runtime.overridesTextByPackPath['entity/horse.json'];
  assert.equal((await run(f)).textureRef, 'textures/horse');
});

test('異なるZIPと取消済みsignalはwarm cacheを流用しない', async () => {
  const f = fixture(); await run(f); const other = fixture();
  await run(other); assert.equal(other.reads(), 2);
  const controller = new AbortController(); controller.abort();
  assert.equal((await run(f, { signal: controller.signal })).status, 'cancelled');
});

test('読取失敗は永続化せず次回を妨げない', async () => {
  const f = fixture(); const original = f.runtime.zipReader.readText;
  f.runtime.zipReader.readText = async () => { throw new Error('fixture'); };
  assert.equal((await run(f)).status, 'invalid');
  f.runtime.zipReader.readText = original; assert.equal((await run(f)).status, 'ready');
});

test('LRUの件数とUTF-8 source予算の双方を守り、読取上限を飛び越えない', () => {
  const cache = new NativePreviewDocumentCache({ maxBytes: 10, maxEntries: 2 }), owner = {};
  const a = cache.key(owner, 'a'), b = cache.key(owner, 'b'), c = cache.key(owner, 'c');
  cache.set(a, undefined, { a: 1 }, 4); cache.set(b, undefined, { b: 1 }, 4);
  assert.deepEqual(cache.get(a, undefined, 4), { a: 1 });
  cache.set(c, undefined, { c: 1 }, 4);
  assert.equal(cache.get(b, undefined, 4), null); assert.equal(cache.get(a, undefined, 3), null);
  cache.set(c, undefined, { c: 2 }, 9); assert.equal(cache.snapshot().sourceBytes, 9);
  assert.equal(cache.get(a, undefined, 4), null);
  cache.clear(); assert.equal(cache.snapshot().sourceBytes, 0);
});
