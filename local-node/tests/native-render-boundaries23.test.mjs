import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnchantingBookPreviewScene, compileBedrockGeometryScene, normalizeNativePreviewCamera } from '../../editor-core/src/preview/native-model-preview.js';
import { resolveEnchantingBookPreviewScene } from '../../editor-core/src/preview/native-book-preview.js';
import { sampleNativePreviewMotion } from '../../editor-core/src/preview/native-motion.js';
import { loadHorsePreviewFromSources, loadPlayerPreviewFromSources } from '../../editor-core/src/preview/native-model-loader.js';

const faceUv = Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map(name => [name, { uv: [4, 4], uv_size: [8, 8] }]));
function geometry(size = [3, 5, 7], inflate = 0) {
  return { description: { identifier: 'geometry.test', texture_width: 64, texture_height: 64 },
    bones: [{ name: 'body', cubes: [{ origin: [1, 2, 3], size, inflate, uv: faceUv }] }] };
}
function compile(value, camera = { yaw: 175, pitch: 15 }) {
  const result = compileBedrockGeometryScene(value, { geometryFormatVersion: [1, 21, 0], camera, retainMotionMesh: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.scene;
}
function fixture(kind = 'horse') {
  const files = { [`entity/${kind}.json`]: JSON.stringify({ format_version: '1.10.0', 'minecraft:client_entity': { description: {
    identifier: `minecraft:${kind}`, geometry: { default: 'geometry.test' }, textures: { default: `textures/${kind}` },
    ...(kind === 'player' ? { materials: { default: 'entity_alphatest' } } : {}),
  } } }), 'models/entity/test.json': JSON.stringify({ format_version: '1.21.0', 'minecraft:geometry': [geometry()] }) };
  let reads = 0;
  const runtime = { packPaths: Object.keys(files), zipReader: {
    entryIndex: new Map(Object.entries(files).map(([path, text]) => [path, { info: { uncompressedSize: Buffer.byteLength(text) } }])),
    async readText(path) { reads += 1; return files[path]; },
  } };
  return { files, runtime, sources: [{ source: 'imported', runtime }], reads: () => reads };
}
const load = (kind, sources, options = {}) => (kind === 'horse' ? loadHorsePreviewFromSources : loadPlayerPreviewFromSources)({
  sources, targetEngineVersion: [1, 26, 45], ...options,
});

test('本を閉じる内部回転は180度境界でもモデルを失わず設定値を変更しない', () => {
  for (const yaw of [-180, -160, 0, 140, 145, 160, 180]) {
    const base = buildEnchantingBookPreviewScene({ camera: { yaw, pitch: 20 } });
    for (const open of [0, .25, .5, 1]) {
      const scene = resolveEnchantingBookPreviewScene(base, { '#open': open });
      assert.ok(scene, `yaw=${yaw}, open=${open}`);
      assert.ok(scene.camera.yaw >= -180 && scene.camera.yaw <= 180);
      const actual = scene.camera.yaw * Math.PI / 180;
      const expected = (yaw + 40 * (1 - open)) * Math.PI / 180;
      assert.ok(Math.abs(Math.sin(actual) - Math.sin(expected)) < 1e-12);
      assert.ok(Math.abs(Math.cos(actual) - Math.cos(expected)) < 1e-12);
      assert.equal(scene.motionMesh.normalization.scale, base.motionMesh.normalization.scale);
    }
    assert.equal(base.camera.yaw, yaw);
  }
  assert.equal(normalizeNativePreviewCamera({ yaw: 181 }), null);
  assert.equal(normalizeNativePreviewCamera({ yaw: Infinity }), null);
});

test('馬とプレイヤーは±180度を跨いでもカーソル追従角が固定されない', () => {
  for (const kind of ['horse', 'player']) for (const yaw of [-175, 175]) {
    const scene = { ...compile(geometry(), { yaw, pitch: 15 }), kind };
    const sign = Math.sign(yaw);
    const a = sampleNativePreviewMotion(scene, { pointer: { active: true, x: sign * .5, y: 0 } });
    const b = sampleNativePreviewMotion(scene, { pointer: { active: true, x: sign, y: 0 } });
    assert.equal(a.motionApplied, true); assert.equal(b.motionApplied, true);
    assert.notEqual(a.camera.yaw, b.camera.yaw);
    assert.notDeepEqual(a.faces, b.faces);
    assert.equal(sampleNativePreviewMotion(scene, { pointer: { active: false } }), scene);
  }
});

test('点・線cubeをinflateした体積は静止・動態mesh双方に残る', () => {
  for (const size of [[0, 0, 0], [0, 0, 4], [0, 4, 0], [4, 0, 0]]) {
    const scene = compile(geometry(size, 1));
    assert.equal(scene.faces.length, 6);
    assert.equal(scene.motionMesh.faces.length, 6);
    const points = scene.motionMesh.vertices;
    for (let axis = 0; axis < 3; axis += 1) {
      const extent = Math.max(...points.map(p => p[axis])) - Math.min(...points.map(p => p[axis]));
      assert.equal(extent, size[axis] + 2);
    }
    const moved = sampleNativePreviewMotion(scene, { pointer: { active: true, x: 1, y: .5 } });
    assert.equal(moved.motionApplied, true);
  }
  const empty = compileBedrockGeometryScene(geometry([0, 0, 4], 0), { geometryFormatVersion: [1, 21, 0] });
  assert.equal(empty.ok, false);
});

test('負inflateで体積が線に縮んだcubeは有効な隣接cubeの描画を壊さない', () => {
  const value = geometry([2, 2, 6], -1);
  value.bones[0].cubes.push({ origin: [10, 0, 0], size: [2, 3, 4], uv: faceUv });
  const scene = compile(value);
  assert.equal(scene.faces.length, 6);
  assert.equal(scene.motionMesh.faces.length, 6);
});

test('馬・プレイヤーの不正レイヤーと重複は読取前に具体的理由で拒否する', async () => {
  for (const kind of ['horse', 'player']) {
    const f = fixture(kind);
    for (const sources of [undefined, null, {}, [null], [{}], [...f.sources, ...f.sources], Array(2)]) {
      assert.equal((await load(kind, sources)).issue, 'NATIVE_PREVIEW_PACK_INDEX_INVALID');
    }
    assert.equal((await load(kind, Array(65).fill(f.sources[0]))).issue, 'NATIVE_PREVIEW_LIMIT_EXCEEDED');
    assert.equal(f.reads(), 0);
    let getters = 0;
    assert.equal((await load(kind, [{ get source() { getters += 1; return 'imported'; }, runtime: f.runtime }])).status, 'invalid');
    assert.equal(getters, 0);
  }
});

test('取消済みの空パックもmissingへ変換せずcancelledで終わる', async () => {
  const controller = new AbortController(); controller.abort();
  for (const kind of ['horse', 'player']) {
    assert.deepEqual(await load(kind, [], { signal: controller.signal }), { status: 'cancelled' });
  }
});

test('JSON失敗はパック相対path・段階・予算を保持し本文や例外文字列を返さない', async () => {
  for (const kind of ['horse', 'player']) {
    const f = fixture(kind);
    f.runtime.overridesTextByPackPath = { 'models/entity/test.json': '{"secret":"NEVER_COPY_TO_DIAGNOSTICS",}' + 'invalid' };
    const result = await load(kind, f.sources);
    assert.equal(result.status, 'invalid'); assert.equal(result.issue, 'NATIVE_PREVIEW_SCAN_INCOMPLETE');
    assert.equal(result.detail.packPath, 'models/entity/test.json'); assert.equal(result.detail.stage, 'geometry');
    assert.equal(result.detail.source, 'imported'); assert.equal(result.detail.reason, 'json-invalid');
    assert.equal(result.detail.scan.documentCount, 2); assert.equal(result.detail.scan.completedDocumentCount, 1);
    assert.ok(result.detail.parseLocation.line >= 1);
    assert.ok(!JSON.stringify(result).includes('NEVER_COPY_TO_DIAGNOSTICS'));
    f.runtime.overridesTextByPackPath = {};
    f.runtime.zipReader.readText = async () => { throw new Error('PRIVATE_PATH_AND_PAYLOAD'); };
    const failure = await load(kind, f.sources);
    assert.equal(failure.detail.reason, 'read-failed');
    assert.ok(!JSON.stringify(failure).includes('PRIVATE_PATH_AND_PAYLOAD'));
  }
});

test('成功provenanceの走査根拠はcacheの有無に依存せず実読取で減る予算を示す', async () => {
  for (const kind of ['horse', 'player']) {
    const f = fixture(kind);
    const initial = await load(kind, f.sources, { cacheDocuments: true });
    assert.equal(initial.status, 'ready'); assert.equal(f.reads(), 2);
    assert.equal(initial.provenance.scan.documentCount, 2);
    assert.deepEqual(initial.provenance.scan.stages, { entity: 1, controller: 0, geometry: 1 });
    assert.equal(initial.provenance.scan.reservedTextBytes, Object.values(f.files).reduce((sum, text) => sum + Buffer.byteLength(text), 0));
    const cached = await load(kind, f.sources, { cacheDocuments: true });
    assert.equal(f.reads(), 2); assert.deepEqual(cached, initial);
    const uncached = await load(kind, f.sources, { cacheDocuments: false });
    assert.equal(f.reads(), 4); assert.deepEqual(uncached, initial);
  }
});
