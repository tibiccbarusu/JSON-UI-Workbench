import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createUiAudioPlayer } from '../src/preview/ui-audio-player.js';
import { preflightWavPcm16 } from '../../local-node/wav-preflight40.mjs';
import { wav } from '../../local-node/tests/wav40-fixtures.mjs';

const records = [], bytes = wav(), base = { schema: 'jsonui-sound-v2', ...preflightWavPcm16(bytes),
  filePackId: 'pack', fileSource: 'imported', contentRevision: 'fixture', filePath: 'sounds/click.wav',
  candidateVolume: 1, candidatePitch: 1, candidateCount: 1, candidateIndex: 0 };
const intent = extra => ({ soundName: 'click', interactionId: 'one', catalogId: 'catalog', packEpoch: 1, soundVolume: 1, soundPitch: 1, ...extra });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const decoded = extra => ({ length: 5760, numberOfChannels: 1, sampleRate: 48000, duration: 0.12, ...extra });
function fixture({ metadata = {}, context: contextOptions = {}, player: playerOptions = {}, readBytes } = {}) {
  const calls = { starts: [], resume: 0, decode: 0, resolve: 0, read: 0 }, diagnostics = [];
  const context = { sampleRate: 48000, state: 'running', destination: {},
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource: () => ({ playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() { calls.starts.push(this); }, stop() { this.onended?.(); } }),
    resume() { calls.resume++; this.state = 'running'; return Promise.resolve(); }, close() { this.state = 'closed'; return Promise.resolve(); },
    decodeAudioData() { calls.decode++; return Promise.resolve(decoded()); }, ...contextOptions };
  const player = createUiAudioPlayer({ createContext: () => context, getSessionEpoch: () => 1,
    resolveSound: async () => { calls.resolve++; return { ...base, ...metadata }; },
    readBytes: readBytes || (async () => { calls.read++; return new ArrayBuffer(bytes.length); }),
    onDiagnostic: row => diagnostics.push(row), ...playerOptions });
  return { player, context, calls, diagnostics };
}
let sequence = 96;
function check(title, expected, scenario, run) {
  const caseId = `wav-${String(++sequence).padStart(3, '0')}`;
  test(`${caseId} ${title}`, async () => {
    const timestamp = new Date().toISOString(); let actual, details;
    try { const result = await run(); actual = result?.actual ?? result; details = result?.details; }
    catch (error) { actual = error.code || error.message; }
    const row = { case_id: caseId, title, expected, actual, input: { scenario }, status: actual === expected ? 'PASS' : 'FAIL', timestamp,
      evidence_kind: 'mock_player_control_flow_not_real_audio', ...(details ? { details } : {}) };
    records.push(row); assert.equal(actual, expected, JSON.stringify(row));
  });
}
after(async () => {
  if (!process.env.R40_AUDIO_EVIDENCE_DIR) return;
  await mkdir(process.env.R40_AUDIO_EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(process.env.R40_AUDIO_EVIDENCE_DIR, 'player-case-results.json'), JSON.stringify({ schema: 'r40-audio-cases-v1', cases: records }, null, 2) + '\n');
});
async function request(options = {}, extra = {}) {
  const f = fixture(options);
  try { const result = await f.player.request(intent(extra)); return { actual: result.code, details: { result, calls: { starts: f.calls.starts.length, decode: f.calls.decode } } }; }
  finally { f.player.dispose(); }
}
const basic = [
  ['v2 WAV 再生開始', 'AUDIO_STARTED', {}],
  ['v2 OGG 再生開始', 'AUDIO_STARTED', { container: 'ogg', codec: 'vorbis' }],
  ['v1 OGG互換', 'AUDIO_STARTED', { schema: 'jsonui-sound-v1', codec: 'vorbis' }],
  ['v1 WAV拒否', 'AUDIO_METADATA_INVALID', { schema: 'jsonui-sound-v1' }],
  ['未知schema拒否', 'AUDIO_METADATA_INVALID', { schema: 'jsonui-sound-v3' }],
  ['WAV container不整合', 'AUDIO_METADATA_INVALID', { container: 'ogg' }],
  ['WAV bit不整合', 'AUDIO_METADATA_INVALID', { bitsPerSample: 24 }],
  ['WAV元frameなし', 'AUDIO_METADATA_INVALID', { sourceFrames: undefined }],
  ['WAV元rateなし', 'AUDIO_METADATA_INVALID', { sampleRate: undefined }],
  ['WAV秒数不整合', 'AUDIO_METADATA_INVALID', { durationSeconds: 0.13 }],
  ['WAV丸め許容量偽装', 'AUDIO_METADATA_INVALID', { decodedFrameTolerance: 1000 }],
];
for (const [title, expected, metadata] of basic) check(title, expected, metadata, () => request({ metadata }));
const decoderCases = [
  ['WAV decode短縮', 'AUDIO_DECODED_MISMATCH', { length: 5757, duration: 5757 / 48000 }],
  ['WAV decode伸長', 'AUDIO_DECODED_MISMATCH', { length: 5763, duration: 5763 / 48000 }],
  ['WAV decodech変更', 'AUDIO_DECODED_BUDGET', { numberOfChannels: 2 }],
  ['WAV decode rate変更', 'AUDIO_DECODED_BUDGET', { sampleRate: 44100 }],
  ['WAV decode丸め1', 'AUDIO_STARTED', { length: 5761, duration: 5761 / 48000 }],
];
for (const [title, expected, altered] of decoderCases) check(title, expected, altered, () => request({ context: { decodeAudioData: async () => decoded(altered) } }));
check('UI音量0', 'AUDIO_MUTED', 'soundVolume0', () => request({}, { soundVolume: 0 }));
check('候補音量0', 'AUDIO_MUTED', 'candidateVolume0', () => request({ metadata: { candidateVolume: 0 } }));
check('gain合成', 'gain0.16', 'soundVolume.4 candidate.4', async () => {
  const result = await request({ metadata: { candidateVolume: 0.4 } }, { soundVolume: 0.4 });
  assert.equal(result.actual, 'AUDIO_STARTED'); assert(Math.abs(result.details.result.outputGain - 0.16) < 1e-12); return 'gain0.16';
});
check('pitch合成', 'pitch1.5', 'soundPitch1.25 candidate1.2', async () => {
  const result = await request({ metadata: { candidatePitch: 1.2 } }, { soundPitch: 1.25 });
  assert.equal(result.actual, 'AUDIO_STARTED'); assert.equal(result.details.result.outputPitch, 1.5); return 'pitch1.5';
});
check('gain上限制限', 'gain1', 'soundVolume4 candidate2', async () => {
  const result = await request({ metadata: { candidateVolume: 2 } }, { soundVolume: 4 });
  assert.equal(result.actual, 'AUDIO_STARTED'); assert.equal(result.details.result.outputGain, 1); assert.equal(result.details.result.gainClamped, true); return 'gain1';
});
check('合成pitch範囲外', 'AUDIO_PITCH_UNSUPPORTED', 'soundPitch2 candidate2', () => request({ metadata: { candidatePitch: 2 } }, { soundPitch: 2 }));
check('音声OFF', 'AUDIO_DISABLED', 'enabledfalse', async () => { const f = fixture(); try { f.player.setEnabled(false); return (await f.player.request(intent())).code; } finally { f.player.dispose(); } });
check('旧pack epoch', 'AUDIO_INVALIDATED', 'intent pack1 actual2', async () => { const f = fixture(); try { f.player.setPackEpoch(2); return (await f.player.request(intent())).code; } finally { f.player.dispose(); } });
check('synthetic unlock拒否', 'AUDIO_ACTIVATION_UNTRUSTED', 'event isTrustedfalse', async () => {
  const f = fixture({ context: { state: 'suspended' } });
  try { const result = await f.player.unlock({ isTrusted: false }); assert.equal(f.calls.resume, 0); return result.code; } finally { f.player.dispose(); }
});
check('準備のみ無音', 'AUDIO_PREPARED', 'prepare suspended', async () => {
  const f = fixture({ context: { state: 'suspended' } });
  try { const [result] = await f.player.prepare(intent()); assert.equal(f.calls.starts.length, 0); assert.equal(f.calls.resume, 0); return result.code; } finally { f.player.dispose(); }
});
check('期限超過', 'AUDIO_EXPIRED', 'decode resolves at301ms', async () => {
  const hold = deferred(); let now = 0;
  const f = fixture({ context: { decodeAudioData: () => hold.promise }, player: { now: () => now } });
  try { const pending = f.player.request(intent()); await turn(); now = 301; hold.resolve(decoded()); const result = await pending; assert.equal(f.calls.starts.length, 0); return result.code; }
  finally { hold.resolve(decoded()); f.player.dispose(); }
});
check('voice上限', 'AUDIO_VOICE_BUDGET', 'voices1 twice', async () => {
  const f = fixture({ player: { limits: { voices: 1 } } });
  try { assert.equal((await f.player.request(intent())).code, 'AUDIO_STARTED'); return (await f.player.request(intent({ interactionId: 'two' }))).code; } finally { f.player.dispose(); }
});
check('request上限', 'AUDIO_REQUEST_BUDGET', 'requests1 blocked resolve', async () => {
  const hold = deferred(), f = fixture({ player: { limits: { requests: 1 }, resolveSound: () => hold.promise } });
  try { const pending = f.player.request(intent()); const result = await f.player.request(intent({ interactionId: 'two' })); f.player.dispose(); hold.resolve(base); await pending; await turn(); return result.code; }
  finally { hold.resolve(base); f.player.dispose(); }
});
check('PCM予約上限', 'AUDIO_MEMORY_BUDGET', 'pcmBytes100', () => request({ player: { limits: { pcmBytes: 100 } } }));
check('byte長不一致', 'AUDIO_BYTES_MISMATCH', 'received byteLength-1', () => request({ readBytes: async () => new ArrayBuffer(bytes.length - 1) }));
check('decode拒否', 'AUDIO_DECODE_FAILED', 'decode rejects', () => request({ context: { decodeAudioData: async () => { throw new Error('fixture decode rejection'); } } }));
assert.equal(sequence, 128);
