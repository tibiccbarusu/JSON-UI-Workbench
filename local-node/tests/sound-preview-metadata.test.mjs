import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSoundResolver, selectSoundCandidate } from '../sound-resolver.mjs';

const ogg = await readFile(new URL('./audio-fixtures/click.ogg', import.meta.url));
function resolver(definition) {
  const files = new Map([
    ['sounds/sound_definitions.json', Buffer.from(JSON.stringify({ format_version: '1.20.20', sound_definitions: { demo: definition } }))],
    ['sounds/demo.ogg', ogg],
  ]);
  const pack = { rootPrefix: '', packPaths: [...files.keys()], zipReader: {
    entryIndex: files, bytes: async name => files.get(name), readText: async name => files.get(name).toString('utf8'),
  } };
  return createSoundResolver([{ id: 'custom', kind: 'imported' }], () => pack);
}

test('custom UI OGG exposes codec bytes and game mixer limitation without claiming audible playback', async () => {
  const result = await resolver({ category: 'ui', sounds: [{ name: 'sounds/demo', is3D: false, stream: false }] }).resolve({ soundId: 'demo' });
  assert.equal(result.filePath, 'sounds/demo.ogg'); assert.equal(result.codec, 'vorbis');
  assert.equal(result.contentRevision.length, 64); assert.equal(result.encodedBytes, ogg.length);
  assert.equal(result.definitionCategory, 'ui'); assert.equal(result.candidateIs3D, false);
  assert.equal(result.spatialAudioMode, 'nonpositional_preview');
  assert.deepEqual(result.warnings, ['AUDIO_PREVIEW_CATEGORY_MIXER_NOT_APPLIED']);
  for (const key of ['gameMixerVerified', 'audibleVerified', 'nativeVerified']) assert.equal(result[key], false);
});

test('positional and distance properties remain explicit preview limitations after successful preflight', async () => {
  for (const definition of [
    { sounds: [{ name: 'sounds/demo', is3D: true }] },
    { sounds: ['sounds/demo'], min_distance: 0, max_distance: 16 },
  ]) {
    const result = await resolver(definition).resolve({ soundId: 'demo' });
    assert.deepEqual(result.warnings, ['AUDIO_PREVIEW_POSITIONAL_NOT_APPLIED']);
    assert.equal(result.nativeVerified, false);
  }
  assert.throws(() => selectSoundCandidate({ sounds: [{ name: 'sounds/demo', is3D: 'false' }] }), /AUDIO_CANDIDATE_INVALID/);
});

test('weighted choice still warns independently of category and positional limitations', async () => {
  const result = await resolver({ category: 'music', sounds: [
    { name: 'sounds/demo', is3D: true }, { name: 'sounds/demo', is3D: true, weight: 2 },
  ] }).resolve({ soundId: 'demo', selectionSeed: 'press' });
  assert.deepEqual(result.warnings, ['AUDIO_PREVIEW_WEIGHTED_SELECTION',
    'AUDIO_PREVIEW_CATEGORY_MIXER_NOT_APPLIED', 'AUDIO_PREVIEW_POSITIONAL_NOT_APPLIED']);
  assert.equal(result.selectionPolicy, 'sha256-weighted-v1');
});
