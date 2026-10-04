import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserDefaultPlayerRuntime, loadBrowserPlayerPreview } from '../src/preview/native-player-browser.js';
import { DEFAULT_PLAYER_ASSET_BASE } from '../src/preview/native-player-default.js';
import pngjs from '../../local-node/vendor/pngjs/lib/png.js';

// These small cuboids and flat pixels are original test data, not game assets.
const entity = (minVersion = [1, 21, 0]) => ({ format_version: '1.26.0', 'minecraft:client_entity': { description: {
  identifier: 'minecraft:player', min_engine_version: minVersion, geometry: { default: 'geometry.synthetic_player' },
  textures: { default: 'textures/entity/steve' }, materials: { default: 'entity_alphatest' },
} } });
const model = { format_version: '1.21.0', 'minecraft:geometry': [{ description: {
  identifier: 'geometry.synthetic_player', texture_width: 64, texture_height: 64,
}, bones: [{ name: 'root', cubes: [{ origin: [-2, 0, -2], size: [4, 8, 4], uv: [0, 0] }] }] }] };
function imported({ includeModel = true } = {}) {
  // Deliberately different paths from the optional reference. The bug was
  // hidden when tests happened to shadow its exact entity filename.
  const files = { 'entity/alternative.player.json': JSON.stringify(entity()),
    ...(includeModel ? { 'models/entity/alternative.player.json': JSON.stringify(model) } : {}) };
  let reads = 0;
  return { source: 'imported', runtime: { rootPrefix: '', packPaths: Object.keys(files), zipReader: {
    entryIndex: new Map(Object.entries(files).map(([name, text]) => [name, { info: { uncompressedSize: Buffer.byteLength(text) } }])),
    async readText(path) { reads++; return files[path]; },
  } }, reads: () => reads };
}
function optional({ missing = false, missingModel = false, stall = false } = {}) {
  const pixels = Buffer.alloc(64 * 64 * 4, 255);
  const png = pngjs.PNG.sync.write({ width: 64, height: 64, data: pixels });
  const files = {
    'entity/player.entity.json': Buffer.from(JSON.stringify(entity([1, 0, 0])).padEnd(8397)),
    'models/entity/humanoid.custom.geo.json': Buffer.from(JSON.stringify(model).padEnd(4610)),
    'textures/entity/steve.png': Buffer.concat([png, Buffer.alloc(1379 - png.length)]),
  };
  const calls = [];
  const state = { stall, missing };
  const runtime = createBrowserDefaultPlayerRuntime({ timeoutMs: 1000, async fetchImpl(url, options) {
    calls.push({ url, options });
    if (state.stall) return new Promise(() => {});
    const relative = url.href.slice(DEFAULT_PLAYER_ASSET_BASE.length);
    if (state.missing || missingModel && relative.startsWith('models/')) return new Response(null, { status: 404 });
    assert(Object.hasOwn(files, relative), relative);
    return new Response(files[relative]);
  } });
  return { runtime, calls, state };
}
const preview = (sources, reference, extra = {}) => loadBrowserPlayerPreview({ sources, defaultRuntime: reference.runtime,
  targetEngineVersion: [1, 26, 45], cacheDocuments: true, ...extra });

test('browser optional-reference 404 does not invalidate an imported player under another filename', async () => {
  const own = imported(), ref = optional({ missing: true });
  const result = await preview([own], ref);
  assert.equal(result.status, 'ready');
  assert.equal(result.provenance.entitySource, 'imported');
  assert.equal(result.provenance.modelSource, 'imported');
  assert.equal(result.provenance.defaultPlayerStatus, 'PACK_RESOURCES');
  assert.equal(result.optionalPlayerReference.issue, 'DEFAULT_PLAYER_REFERENCE_NOT_INSTALLED');
  assert.equal(ref.calls.length, 3);
  const again = await preview([own], ref, { camera: { yaw: 20, pitch: 5 } });
  assert.equal(again.status, 'ready');
  assert.equal(ref.calls.length, 3, 'camera changes must not repeat the 404 probes');
  assert.equal(own.reads(), 2, 'the native model document cache remains active');
});

test('browser partial optional installation is excluded and a missing player stays explicitly missing', async () => {
  const ref = optional({ missingModel: true });
  assert.equal((await preview([imported()], ref)).status, 'ready');
  const missing = await preview([], ref);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.issue, 'NATIVE_PREVIEW_MODEL_MISSING');
  assert.equal(missing.optionalPlayerReference.status, 'not-installed');
});

test('browser installed optional reference still supplies missing geometry and standalone fallback', async () => {
  const ref = optional(), own = imported({ includeModel: false });
  const result = await preview([own], ref);
  assert.equal(result.status, 'ready');
  assert.equal(result.provenance.entitySource, 'imported');
  assert.equal(result.provenance.modelSource, 'default-player');
  assert.equal(result.optionalPlayerReference.status, 'ready');
  assert.equal(ref.calls.length, 3, 'probing and model compilation share bounded successful asset bytes');
  const fallback = await preview([], ref);
  assert.equal(fallback.status, 'ready');
  assert.equal(fallback.provenance.entitySource, 'default-player');
  await ref.runtime.zipReader.readBlob('textures/entity/steve.png');
  assert.equal(ref.calls.length, 3, 'fallback texture redraws reuse the fixed asset cache');
});

test('browser valid installed reference retains imported model precedence at the selected version', async () => {
  const result = await preview([imported()], optional());
  assert.equal(result.status, 'ready');
  assert.equal(result.provenance.entitySource, 'imported');
  assert.equal(result.provenance.modelSource, 'imported');
});

test('browser optional-reference abort cancels all reads and is not cached as absence', async () => {
  const ref = optional({ stall: true }), own = imported(), controller = new AbortController();
  const pending = preview([own], ref, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 10);
  const result = await pending;
  clearTimeout(timer);
  assert.equal(result.status, 'cancelled');
  assert.equal(own.reads(), 0);
  assert.equal(ref.calls.length, 3);
  assert(ref.calls.every(call => call.options.signal.aborted));
  ref.state.stall = false;
  const retried = await preview([own], ref);
  assert.equal(retried.status, 'ready');
  assert.equal(retried.optionalPlayerReference.status, 'ready');
  assert.equal(ref.calls.length, 6);
  const early = new AbortController(); early.abort();
  assert.equal((await preview([own], ref, { signal: early.signal })).status, 'cancelled');
  assert.equal(ref.calls.length, 6);
});
