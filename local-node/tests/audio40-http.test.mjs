import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createLocalServer } from '../server.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { wav, definitions } from './wav40-fixtures.mjs';

test('R40 real HTTP + browser client module carries v2 WAV/OGG through authenticated bounded bytes (not browser playback)', async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const nativeFetch = globalThis.fetch, previousWindow = globalThis.window, base = `http://127.0.0.1:${app.port}`;
  const cap = await (await nativeFetch(base + '/api/node/capabilities')).json();
  assert.equal(cap.features.shortOggAudio, true); assert.equal(cap.features.shortWavAudio, true);
  assert.deepEqual(cap.features.audioFormats, ['ogg-vorbis', 'wav-pcm-s16le']);
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' }, packId = randomUUID();
  const wave = wav(), ogg = await readFile(new URL('./audio-fixtures/click.ogg', import.meta.url));
  const archive = makeZip({ 'root/manifest.json': manifest,
    'root/ui/_ui_defs.json': '{"ui_defs":["ui/main.json"]}', 'root/ui/main.json': '{"namespace":"audio","main":{"type":"screen"}}',
    'root/sounds/sound_definitions.json': definitions({ wav: { sounds: ['sounds/short'] }, ogg: { sounds: ['sounds/control.ogg'] } }),
    'root/sounds/short.wav': wave, 'root/sounds/control.ogg': ogg });
  const uploaded = await nativeFetch(base + '/api/node/packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': packId, 'X-JSONUI-Name': 'audio40.zip' }, body: archive });
  assert.equal(uploaded.status, 200); await uploaded.arrayBuffer();
  const catalogResponse = await nativeFetch(base + '/api/node/catalog', { method: 'POST', headers, body: JSON.stringify({ sources: [{ id: packId, kind: 'imported' }] }) });
  assert.equal(catalogResponse.status, 200); const catalog = await catalogResponse.json();
  const urls = [];
  globalThis.window = { addEventListener() {} };
  globalThis.fetch = (url, options) => { urls.push(String(url)); return nativeFetch(new URL(url, base), options); };
  t.after(() => { globalThis.fetch = nativeFetch; if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const client = await import('../../editor-core/src/pack-io/node-remote-client.js?audio40-http');
  for (const [soundId, expectedBytes, codec, container] of [['wav', wave, 'pcm_s16le', 'wav'], ['ogg', ogg, 'vorbis', 'ogg']]) {
    const metadata = await client.resolveNodeSound({ catalogId: catalog.nodeCatalogId, soundId, contextSampleRate: 48000 });
    assert.equal(metadata.schema, 'jsonui-sound-v2'); assert.equal(metadata.codec, codec); assert.equal(metadata.container, container);
    assert.equal(metadata.filePackId, packId); assert.equal(metadata.contextSampleRate, 48000);
    const bytes = await client.readNodeSoundBytes(metadata); assert.deepEqual(Buffer.from(bytes), expectedBytes);
    if (codec === 'vorbis') assert.deepEqual(Buffer.from(await client.readNodeSoundBytes({ ...metadata, schema: 'jsonui-sound-v1' })), ogg);
    assert(!JSON.stringify(metadata).includes(cap.token)); assert(!JSON.stringify(metadata).includes(app.root));
  }
  const before = urls.length;
  for (const bad of [{ schema: 'jsonui-sound-v3' }, { schema: 'jsonui-sound-v2', filePackId: '../other' }, { schema: 'jsonui-sound-v2', filePackId: packId, readPath: 'root/sounds/short.wav', encodedBytes: 4 * 1024 * 1024 + 1 }]) {
    await assert.rejects(client.readNodeSoundBytes(bad), /AUDIO_METADATA_INVALID/);
  }
  assert.equal(urls.length, before, 'invalid metadata rejected before network');
  assert(urls.every(url => !url.includes(cap.token)), 'auth never enters URL');
  assert.equal((await nativeFetch(base + '/api/node/sound-resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await nativeFetch(base + `/api/node/packs/${packId}/read?${new URLSearchParams({ path: 'root/sounds/short.wav', maxBytes: String(wave.length) })}`)).status, 401);
});
