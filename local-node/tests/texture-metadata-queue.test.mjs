import test from 'node:test';
import assert from 'node:assert/strict';
import { TextureMetadataCache } from '../../editor-core/src/assets/texture-metadata-cache.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
test('スロット素材の待ち行列は再描画なしでも全件完了する', async () => {
  const releases = []; let running = 0; let maxRunning = 0;
  const cache = new TextureMetadataCache({ concurrency: 2 });
  for (let i = 0; i < 7; i++) cache.request(`slot-${i}`, () => new Promise((resolve) => {
    running++; maxRunning = Math.max(maxRunning, running);
    releases.push(() => { running--; resolve({ status: 'ready', value: { nineSlice: i } }); });
  }));
  await tick();
  assert.deepEqual(cache.snapshot(), { entries: 7, active: 2, queued: 5 });
  while (releases.length) { releases.shift()(); await tick(); }
  assert.equal(maxRunning, 2);
  assert.equal(cache.snapshot().queued, 0);
  for (let i = 0; i < 7; i++) assert.equal(cache.get(`slot-${i}`).value.nineSlice, i);
});

test('読込が永久停止してもtimeout後に後続の枠を取得できる', async () => {
  let finished; const done = new Promise((resolve) => { finished = resolve; });
  const cache = new TextureMetadataCache({ concurrency: 1, timeoutMs: 20, onChange: (key) => { if (key === 'next') finished(); } });
  cache.request('stalled', () => new Promise(() => {}));
  cache.request('next', () => ({ status: 'ready', value: { baseSize: [5, 5] } }));
  await done;
  assert.equal(cache.get('stalled').code, 'TEXTURE_SIDECAR_TIMEOUT');
  assert.equal(cache.get('next').status, 'ready');
  assert.equal(cache.snapshot().active, 0);
});

test('パック切替時に旧読込を中断し新素材を旧結果で上書きしない', async () => {
  let release; let oldSignal; let notifications = 0;
  const cache = new TextureMetadataCache({ concurrency: 1, onChange: () => notifications++ });
  cache.request('slot', (signal) => { oldSignal = signal; return new Promise((resolve) => { release = resolve; }); });
  await tick(); cache.clear();
  cache.request('slot', () => ({ status: 'ready', value: { generation: 2 } }));
  await tick();
  assert.equal(oldSignal.aborted, true);
  assert.equal(cache.get('slot').value.generation, 2);
  release({ status: 'ready', value: { generation: 1 } }); await tick();
  assert.equal(cache.get('slot').value.generation, 2);
  assert.equal(notifications, 1);
});

test('容量到達時に完了済みだけを退避し読込中のidentityを保つ', async () => {
  let release;
  const cache = new TextureMetadataCache({ maxEntries: 2, concurrency: 1 });
  const first = cache.request('pending', () => new Promise((resolve) => { release = resolve; }));
  cache.request('queued', () => ({ status: 'missing', value: null })); await tick();
  assert.equal(cache.request('over', () => {}).code, 'TEXTURE_SIDECAR_CACHE_LIMIT');
  assert.equal(cache.get('pending'), first);
  release({ status: 'ready', value: {} }); await tick();
  cache.request('over', () => ({ status: 'ready', value: {} })); await tick();
  assert.equal(cache.get('over').status, 'ready');
  assert.equal(cache.snapshot().entries, 2);
});
