import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadPlayerPreviewFromSources } from '../../editor-core/src/preview/native-model-loader.js';
import { sampleNativePreviewMotion } from '../../editor-core/src/preview/native-motion.js';
import { createLocalServer } from '../server.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { validateUiScreenModel } from '../../editor-core/src/validation/validator.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildAssetIndexFromPackPaths } from '../../editor-core/src/assets/asset-indexer.js';
import { createNodeDefaultPlayerRuntime } from '../native-player-default.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

// Original synthetic solid-color asset: no Minecraft skin or external file.
function syntheticTexture() {
  const data = Buffer.alloc(64 * 64 * 4);
  for (let at = 0; at < data.length; at += 4) data.set([40, 80, 160, 255], at);
  return pngjs.PNG.sync.write({ width: 64, height: 64, data });
}

function fixture({ texture = 'textures/entity/steve', minVersion = [1, 21, 0], model = true } = {}) {
  const entity = { format_version: '1.26.0', 'minecraft:client_entity': { description: {
    identifier: 'minecraft:player', min_engine_version: minVersion, geometry: { default: 'geometry.player' },
    textures: { default: texture }, materials: { default: 'entity_alphatest' },
  } } };
  const geometry = { format_version: '1.21.0', 'minecraft:geometry': [{ description: {
    identifier: 'geometry.player', texture_width: 64, texture_height: 64,
  }, bones: [{ name: 'root', cubes: [{ origin: [-4, 0, -2], size: [8, 12, 4], uv: [0, 0] }] }] }] };
  const files = { 'entity/player.json': JSON.stringify(entity), ...(model ? { 'models/entity/player.json': JSON.stringify(geometry) } : {}) };
  let reads = 0;
  const runtime = { rootPrefix: '', packPaths: Object.keys(files), zipReader: {
    entryIndex: new Map(Object.entries(files).map(([name, text]) => [name, { info: { uncompressedSize: Buffer.byteLength(text) } }])),
    async readText(p) { reads++; return files[p]; },
  } };
  return { files, entity, geometry, runtime, sources: [{ source: 'imported', runtime }], reads: () => reads };
}
const run = (f, options = {}) => loadPlayerPreviewFromSources({ sources: f.sources, targetEngineVersion: [1, 26, 45], cacheDocuments: true, ...options });

test('プレイヤーは原geometry/原texture aliasを使い本人skinではないと明示する', async () => {
  const f = fixture(); const result = await run(f);
  assert.equal(result.status, 'ready'); assert.equal(result.scene.kind, 'player');
  assert.equal(result.textureRef, 'textures/entity/steve'); assert.ok(result.scene.motionMesh);
  assert.equal(result.provenance.accountSkinStatus, 'NOT_AVAILABLE');
  assert.equal(result.provenance.equipmentStatus, 'NOT_EVALUATED');
  const pose = sampleNativePreviewMotion(result.scene, { pointer: { active: true, x: 1, y: 0 } });
  assert.notDeepEqual(pose.faces, result.scene.faces);
  assert.equal(sampleNativePreviewMotion(result.scene, { pointer: { active: false } }), result.scene);
});

test('欠落モデルや不明texture式に代替人形を生成しない', async () => {
  assert.equal((await run(fixture({ model: false }))).issue, 'NATIVE_PREVIEW_MODEL_MISSING');
  for (const texture of ['variable.skin', '../steve', 'textures/../steve', 'textures/../../steve', 'https://example.com/steve']) {
    assert.equal((await run(fixture({ texture }))).issue, 'NATIVE_PREVIEW_PLAYER_DEFAULT_TEXTURE_UNRESOLVED');
  }
});

test('playerのpack優先度と互換engine版を守り曖昧候補を拒否する', async () => {
  const a = fixture({ texture: 'textures/entity/custom' }), b = fixture();
  const result = await run({ sources: [...a.sources, { source: 'vanilla', runtime: b.runtime }] });
  assert.equal(result.textureRef, 'textures/entity/custom');
  assert.equal(result.provenance.entitySource, 'imported');
  assert.equal((await run(fixture({ minVersion: [9, 0, 0] }))).issue, 'NATIVE_PREVIEW_ENGINE_VERSION_INCOMPATIBLE');
  const dup = fixture(); dup.runtime.packPaths.push('entity/duplicate.json');
  dup.runtime.overridesTextByPackPath = { 'entity/duplicate.json': dup.files['entity/player.json'] };
  assert.equal((await run(dup)).issue, 'NATIVE_PREVIEW_ENTITY_AMBIGUOUS');
});

test('playerもcamera更新時のJSONキャッシュを使い取消・破棄を尊重する', async () => {
  const f = fixture(); await run(f); assert.equal(f.reads(), 2);
  const next = await run(f, { camera: { yaw: 40, pitch: 10 } }); assert.equal(next.status, 'ready'); assert.equal(f.reads(), 2);
  const controller = new AbortController(); controller.abort();
  assert.equal((await run(f, { signal: controller.signal })).status, 'cancelled'); assert.equal(f.reads(), 2);
});

test('検証もplayerの解決済textureと原model欠落を別々に診断する', () => {
  const json = { namespace: 'test', screen: { type: 'screen', controls: [{ player: { type: 'custom', renderer: 'live_player_renderer' } }] } };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/player.json' });
  const referenceContext = { importedIndex: buildAssetIndexFromPackPaths(['textures/entity/steve.png']),
    nativeModelPreviews: { player: { status: 'ready', textureRef: 'textures/entity/steve' } } };
  const result = validateUiScreenModel(model, { sourceJson: json, referenceContext });
  const issues = result.issues || result.diagnostics;
  assert.ok(issues.some((i) => i.code === 'CUSTOM_RENDERER_STATIC_RESOURCE_PREVIEW'));
  assert.ok(!issues.some((i) => i.code === 'CUSTOM_RENDERER_RUNTIME_DEPENDENT'));
  referenceContext.nativeModelPreviews.player = { status: 'missing', issue: 'NATIVE_PREVIEW_MODEL_MISSING' };
  const missing = validateUiScreenModel(model, { sourceJson: json, referenceContext });
  assert.ok(missing.issues.some((i) => i.code === 'NATIVE_PREVIEW_MODEL_MISSING'));
});

test('player HTTP routeの認証・cache・source解除境界', async (t) => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const cap = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' };
  const post = (data, override = {}) => fetch(base + 'player', { method: 'POST', headers, body: JSON.stringify(data), ...override });
  const f = fixture({ texture: 'textures/entity/synthetic_player' }), id = randomUUID();
  const texture = syntheticTexture();
  const zip = makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/example.json"]}',
    'ui/example.json': '{"namespace":"test","screen":{"type":"screen"}}', ...f.files,
    'textures/entity/synthetic_player.png': texture });
  const upload = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id, 'X-JSONUI-Name': 'player.zip' }, body: zip });
  assert.equal(upload.status, 200); await upload.arrayBuffer();
  const request = { sources: [{ id, kind: 'imported' }], targetEngineVersion: [1, 26, 45] };
  assert.equal((await post(request, { headers: { 'Content-Type': 'application/json' } })).status, 401);
  const first = await post(request); assert.equal(first.status, 200); const firstText = await first.text();
  const firstData = JSON.parse(firstText);
  assert.equal(firstData.status, 'ready', firstText);
  assert.equal(firstData.scene.kind, 'player');
  assert.equal(firstData.textureRef, 'textures/entity/synthetic_player');
  assert.equal(firstData.provenance.entitySource, 'imported');
  assert.equal(firstData.provenance.modelSource, 'imported');
  assert.equal(firstData.provenance.defaultPlayerStatus, 'PACK_RESOURCES');
  const image = await fetch(base + `packs/${id}/read?path=textures%2Fentity%2Fsynthetic_player.png&maxBytes=4096`, { headers });
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), texture);
  const second = await post(request); assert.equal(await second.text(), firstText);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(post(request, { signal: controller.signal }), (e) => e.name === 'AbortError');
  const stillThere = await post(request); assert.equal(stillThere.status, 200); await stillThere.arrayBuffer();
  const release = await fetch(base + 'packs/' + id, { method: 'DELETE', headers }); assert.equal(release.status, 200); await release.arrayBuffer();
  const afterRelease = await post(request); assert.equal(afterRelease.status, 404); await afterRelease.arrayBuffer();
});

test('未導入の任意player参照は架空の既定資産を列挙せず独自モデルを妨げない', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-player-reference-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = pathToFileURL(directory + path.sep);
  const absent = createNodeDefaultPlayerRuntime(base);
  assert.deepEqual(absent.packPaths, []);
  assert.equal(absent.issue, 'DEFAULT_PLAYER_REFERENCE_NOT_INSTALLED');
  const f = fixture({ texture: 'textures/entity/synthetic_player' });
  const result = await run({ sources: [...f.sources, { source: 'default-player', runtime: absent }] });
  assert.equal(result.status, 'ready');
  assert.equal(result.provenance.entitySource, 'imported');
  assert.equal(result.provenance.modelSource, 'imported');
  const onlyAbsent = await run({ sources: [{ source: 'default-player', runtime: absent }] });
  assert.equal(onlyAbsent.status, 'missing');
  assert.equal(onlyAbsent.issue, 'NATIVE_PREVIEW_MODEL_MISSING');
  await assert.rejects(absent.zipReader.readText('entity/player.entity.json'), /DEFAULT_PLAYER_REFERENCE_NOT_INSTALLED/u);
  // A partial installation is also absent, instead of poisoning valid packs.
  await mkdir(path.join(directory, 'entity'));
  await writeFile(path.join(directory, 'entity/player.entity.json'), f.files['entity/player.json']);
  assert.deepEqual(createNodeDefaultPlayerRuntime(base).packPaths, []);
});

test('導入済みplayer参照は従来の読込制限とfallback機能を保持する（合成資産）', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-player-installed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = pathToFileURL(directory + path.sep);
  const f = fixture();
  const texture = syntheticTexture();
  const files = {
    'entity/player.entity.json': Buffer.from(f.files['entity/player.json'].padEnd(8397)),
    'models/entity/humanoid.custom.geo.json': Buffer.from(f.files['models/entity/player.json'].padEnd(4610)),
    'textures/entity/steve.png': Buffer.concat([texture, Buffer.alloc(1379 - texture.length)]),
  };
  for (const [relative, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
    await writeFile(path.join(directory, relative), bytes);
  }
  const installed = createNodeDefaultPlayerRuntime(base);
  assert.equal(installed.packPaths.length, 3);
  const result = await run({ sources: [{ source: 'default-player', runtime: installed }] });
  assert.equal(result.status, 'ready');
  assert.equal(result.scene.kind, 'player');
  assert.equal(result.textureRef, 'textures/entity/steve');
  assert.equal(result.provenance.entitySource, 'default-player');
  const image = await installed.zipReader.readBlob('textures/entity/steve.png', { maxBytes: 1379 });
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), files['textures/entity/steve.png']);
  await assert.rejects(installed.zipReader.readText('entity/player.entity.json', { maxBytes: 1 }), /DEFAULT_PLAYER_READ_LIMIT/u);
});
