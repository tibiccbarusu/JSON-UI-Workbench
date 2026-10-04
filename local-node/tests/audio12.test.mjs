import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AUDIO_LIMITS, oggPageCrc, preflightOggVorbis } from '../audio-preflight.mjs';
import { createSoundResolver, normalizeSoundPath, selectSoundCandidate } from '../sound-resolver.mjs';
import { createLocalServer } from '../server.mjs';
import { makeZip, manifest } from './fixtures.mjs';
const ogg = await readFile(new URL('./audio-fixtures/click.ogg', import.meta.url));
function pages(bytes) { const out = []; for (let offset = 0; offset < bytes.length;) { let size = 27 + bytes[offset + 26]; for (let i = 0; i < bytes[offset + 26]; i++) size += bytes[offset + 27 + i]; out.push([offset, size]); offset += size; } return out; }
function mutatePage(original, index, edit) { const bytes = Buffer.from(original), [offset, length] = pages(bytes).at(index), page = bytes.subarray(offset, offset + length); edit(page); page.writeUInt32LE(oggPageCrc(page), 22); return bytes; }
function fakePack(files, rootPrefix = 'nested/') {
  const map = new Map(Object.entries(files).map(([name, value]) => [rootPrefix + name, Buffer.isBuffer(value) ? value : Buffer.from(value)])), reads = [];
  return { rootPrefix, packPaths: Object.keys(files), reads, zipReader: {
    entryIndex: new Map([...map].map(([path, bytes]) => [path, { info: { uncompressedSize: bytes.length } }])),
    async bytes(path, cap) { reads.push(path); assert(map.has(path), path); const value = map.get(path); if (value.length > cap) throw new Error('ZIP_ENTRY_READ_LIMIT'); return value; },
    async readText(path, options) { return (await this.bytes(path, options.maxBytes)).toString('utf8'); },
  } };
}
const definitions = data => JSON.stringify({ format_version: '1.14.0', sound_definitions: data });

test('OGG preflight accepts actual generated mono Vorbis and reserves context-rate PCM', () => {
  const result = preflightOggVorbis(ogg, { contextSampleRate: 96000 });
  assert.equal(result.codec, 'vorbis'); assert.equal(result.channels, 1); assert.equal(result.sampleRate, 48000);
  assert.equal(result.durationSeconds, 0.12); assert.equal(result.audioPackets, 8); assert.equal(result.maximumBlockSize, 2048);
  assert.equal(result.sourceSampleUpperBound, 10240); assert.equal(result.pcmReservationBytes, (20480 + 4096) * 4);
  assert(result.encodedBytes < 4096); assert(result.pages >= 3);
});
test('a CRC-correct forged tiny granule cannot under-reserve PCM; a short encoded packet flood is refused before decode', () => {
  const real = preflightOggVorbis(ogg), forged = preflightOggVorbis(mutatePage(ogg, -1, page => page.writeBigUInt64LE(1n, 6)));
  assert.equal(forged.durationSeconds, 1 / 48000); assert.equal(forged.pcmReservationBytes, real.pcmReservationBytes);
  assert.equal(forged.sourceSampleUpperBound, real.sourceSampleUpperBound); assert(forged.pcmReservationBytes >= 5760 * 4);
  const headerPages = pages(ogg), headerEnd = headerPages[1][0] + headerPages[1][1], chunks = [ogg.subarray(0, headerEnd)];
  let left = 2050, sequence = 2;
  while (left) {
    const count = Math.min(255, left); left -= count;
    const page = Buffer.alloc(27 + count * 2); page.write('OggS'); page[5] = left ? 0 : 4;
    page.writeBigUInt64LE(left ? 0n : 1n, 6); page.writeUInt32LE(ogg.readUInt32LE(14), 14); page.writeUInt32LE(sequence++, 18); page[26] = count;
    page.fill(1, 27, 27 + count); page.writeUInt32LE(oggPageCrc(page), 22); chunks.push(page);
  }
  const flood = Buffer.concat(chunks); assert(flood.length < 10000);
  assert.throws(() => preflightOggVorbis(flood), /AUDIO_PCM_BUDGET/);
});
test('OGG rejects corruption, truncation, long metadata, Opus, chained streams and unsupported channels', () => {
  const bad = Buffer.from(ogg); bad[bad.length - 1] ^= 1;
  assert.throws(() => preflightOggVorbis(bad), /AUDIO_CONTAINER_CRC_INVALID/);
  assert.throws(() => preflightOggVorbis(ogg.subarray(0, 50)), /AUDIO_CONTAINER_CRC_INVALID/);
  assert.throws(() => preflightOggVorbis(mutatePage(ogg, -1, page => page.writeBigUInt64LE(480001n, 6))), /AUDIO_DURATION_UNSUPPORTED/);
  assert.throws(() => preflightOggVorbis(mutatePage(ogg, 0, page => { const start = 27 + page[26]; page.write('OpusHead', start); })), /AUDIO_FORMAT_UNSUPPORTED/);
  assert.throws(() => preflightOggVorbis(Buffer.concat([ogg, ogg])), /AUDIO_CONTAINER_INVALID/);
  assert.throws(() => preflightOggVorbis(mutatePage(ogg, 0, page => { page[27 + page[26] + 11] = 8; })), /AUDIO_FORMAT_UNSUPPORTED/);
  assert.throws(() => preflightOggVorbis(ogg, { contextSampleRate: NaN }), /AUDIO_SAMPLE_RATE_INVALID/);
  assert.throws(() => preflightOggVorbis(Buffer.alloc(AUDIO_LIMITS.encodedBytes + 1)), /AUDIO_ENCODED_BUDGET/);
});
test('sound path rejects URL, traversal, escapes, ambiguous separators and unsupported formats', () => {
  assert.equal(normalizeSoundPath('sounds/random/click'), 'sounds/random/click.ogg');
  assert.equal(normalizeSoundPath('sounds/Click.OGG'), 'sounds/Click.OGG');
  for (const path of ['../click', '/click', 'https://x/a', 'C:/x', 'sounds/../click', 'sounds\\click', 'sounds//click', 'sounds/%2e%2e/click', 'sounds/a\0b', 'sounds/a?b', 'sounds/a.']) assert.throws(() => normalizeSoundPath(path), /AUDIO_PATH_UNSAFE/, path);
  assert.equal(normalizeSoundPath('sounds/click.wav'), 'sounds/click.wav');
  assert.throws(() => normalizeSoundPath('sounds/click.mp3'), /AUDIO_FORMAT_UNSUPPORTED/);
});
test('weighted preview choice is deterministic, honours weights, rejects unsafe unsupported alternatives', () => {
  const definition = { sounds: [{ name: 'sounds/a', weight: 1, volume: 0 }, { name: 'sounds/b', weight: 9, pitch: 1.5 }] };
  const selected = selectSoundCandidate(definition, 'stable'); assert.deepEqual(selectSoundCandidate(definition, 'stable'), selected);
  let heavy = 0; for (let index = 0; index < 1000; index++) heavy += selectSoundCandidate(definition, String(index)).index === 1;
  assert(heavy > 850 && heavy < 950, heavy);
  assert.throws(() => selectSoundCandidate({ sounds: [{ name: 'sounds/a', weight: 0 }] }), /AUDIO_WEIGHT_INVALID/);
  assert.throws(() => selectSoundCandidate({ sounds: [{ name: 'sounds/a', pitch: [0.5, 1] }] }), /AUDIO_PITCH_UNSUPPORTED/);
  assert.throws(() => selectSoundCandidate({ sounds: [{ name: 'sounds/a', stream: true }] }), /AUDIO_STREAM_UNSUPPORTED/);
  assert.throws(() => selectSoundCandidate({ sounds: ['sounds/a', '../unsafe'] }), /AUDIO_PATH_UNSAFE/);
});
test('definition and file precedence are independent, rootPrefix applies only to bytes read, preflight cache reused', async () => {
  const vanilla = fakePack({ 'sounds/sound_definitions.json': definitions({ 'random.click': { sounds: ['sounds/click'] } }), 'sounds/click.ogg': ogg }, 'vanilla/');
  const imported = fakePack({ 'sounds/click.ogg': ogg }, 'outer/imported/');
  const packs = { v: vanilla, i: imported }, resolver = createSoundResolver([{ id: 'v', kind: 'vanilla' }, { id: 'i', kind: 'imported' }], id => packs[id]);
  const result = await resolver.resolve({ soundId: 'random.click' });
  assert.equal(result.definitionSource, 'vanilla'); assert.equal(result.fileSource, 'imported');
  assert.equal(result.filePath, 'sounds/click.ogg'); assert.equal(result.readPath, 'outer/imported/sounds/click.ogg');
  assert.equal(result.contentRevision.length, 64); assert.deepEqual(imported.reads, ['outer/imported/sounds/click.ogg']);
  await resolver.resolve({ soundId: 'random.click' }); assert.equal(imported.reads.length, 1);
});
test('upper invalid definition and upper unsupported file cannot silently fall back', async () => {
  const lower = fakePack({ 'sounds/sound_definitions.json': definitions({ click: { sounds: ['sounds/click'] } }), 'sounds/click.ogg': ogg });
  for (const upper of [fakePack({ 'sounds/sound_definitions.json': definitions({ click: { sounds: [] } }) }), fakePack({ 'sounds/click.wav': 'wav' }), fakePack({ 'sounds/sound_definitions.json': '{ broken' })]) {
    const resolver = createSoundResolver([{ id: 'l', kind: 'vanilla' }, { id: 'u', kind: 'imported' }], id => id === 'l' ? lower : upper);
    await assert.rejects(resolver.resolve({ soundId: 'click' }), /AUDIO_(DEFINITION_INVALID|WAV_CONTAINER_INVALID)/);
  }
});
test('unrelated malformed lower definitions cannot veto a complete upper definition or its lower file fallback', async () => {
  const lower = fakePack({ 'sounds/sound_definitions.json': '{ broken lower JSONC', 'sounds/click.ogg': ogg });
  for (const ownFile of [true, false]) {
    const upper = fakePack({ 'sounds/sound_definitions.json': definitions({ click: { sounds: [{ name: 'sounds/click', volume: 4 }] } }), ...(ownFile ? { 'sounds/click.ogg': ogg } : {}) });
    const resolver = createSoundResolver([{ id: 'l', kind: 'vanilla' }, { id: 'u', kind: 'imported' }], id => id === 'l' ? lower : upper);
    const result = await resolver.resolve({ soundId: 'click' }); assert.equal(result.definitionPackId, 'u'); assert.equal(result.candidateVolume, 4);
    assert.equal(result.filePackId, ownFile ? 'u' : 'l'); assert(!lower.reads.includes('nested/sounds/sound_definitions.json'));
  }
});
test('exact name wins; non-exact case collision is rejected; edited definition overlays are used', async () => {
  const pack = fakePack({ 'sounds/sound_definitions.json': definitions({ click: { sounds: ['sounds/CLICK'] } }), 'sounds/Click.ogg': ogg, 'sounds/click.ogg': ogg });
  await assert.rejects(createSoundResolver([{ id: 'i', kind: 'imported' }], () => pack).resolve({ soundId: 'click' }), /AUDIO_PATH_AMBIGUOUS/);
  const resolver = createSoundResolver([{ id: 'i', kind: 'imported', overrides: { 'sounds/sound_definitions.json': definitions({ click: { sounds: ['sounds/click'] } }) } }], () => pack);
  assert.equal((await resolver.resolve({ soundId: 'click' })).filePath, 'sounds/click.ogg');
});

test('sound HTTP API keeps header auth, validates catalog revision and returns read path for authenticated bytes', async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`, capabilities = await (await fetch(base + 'capabilities')).json();
  assert.equal(capabilities.features.shortOggAudio, true);
  const headers = { 'X-JSONUI-Token': capabilities.token, 'Content-Type': 'application/json' };
  const post = (route, value, h = headers) => fetch(base + route, { method: 'POST', headers: h, body: JSON.stringify(value) });
  assert.equal((await post('sound-resolve', {}, { 'Content-Type': 'application/json' })).status, 401);
  const id = randomUUID(), bytes = makeZip({ 'root/manifest.json': manifest,
    'root/ui/_ui_defs.json': '{"ui_defs":["ui/main.json"]}', 'root/ui/main.json': '{"namespace":"a","main":{"type":"screen"}}',
    'root/sounds/sound_definitions.json': definitions({ click: { sounds: ['sounds/click'] } }), 'root/sounds/click.ogg': ogg });
  const uploaded = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id, 'X-JSONUI-Name': 'audio.zip' }, body: bytes });
  assert.equal(uploaded.status, 200); await uploaded.arrayBuffer();
  const catalog = await (await post('catalog', { sources: [{ id, kind: 'imported' }] })).json();
  const request = { catalogId: catalog.nodeCatalogId, soundId: 'click', contextSampleRate: 48000, selectionSeed: 'one' };
  const response = await post('sound-resolve', request); assert.equal(response.status, 200);
  const sound = await response.json(); assert.equal(sound.processing, 'node-worker'); assert.equal(sound.readPath, 'root/sounds/click.ogg');
  assert(!JSON.stringify(sound).includes(capabilities.token)); assert(!JSON.stringify(sound).includes(app.root));
  const read = `packs/${id}/read?${new URLSearchParams({ path: sound.readPath, maxBytes: String(sound.encodedBytes) })}`;
  assert.equal((await fetch(base + read)).status, 401);
  assert.deepEqual(Buffer.from(await (await fetch(base + read, { headers })).arrayBuffer()), ogg);
  assert.equal((await post('sound-resolve', { ...request, catalogId: randomUUID() })).status, 409);
  assert.equal((await post('sound-resolve', { ...request, soundId: '$variable' })).status, 400);
  assert.equal((await post('sound-resolve', { ...request, path: '/native/path.ogg' })).status, 400);
  assert.equal((await post('sound-resolve', request, { ...headers, Origin: 'http://evil.invalid' })).status, 403);
  assert.equal((await fetch(base + `packs/${id}`, { method: 'DELETE', headers })).status, 200);
  assert.equal((await post('sound-resolve', request)).status, 409);
});
