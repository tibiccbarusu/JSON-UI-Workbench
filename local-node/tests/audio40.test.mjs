import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { preflightWavPcm16 } from '../wav-preflight40.mjs';
import { createSoundResolver, normalizeSoundPath } from '../sound-resolver.mjs';
import { wav, riff, chunk, fakePack, definitions } from './wav40-fixtures.mjs';

const records = [], ogg = await readFile(new URL('./audio-fixtures/click.ogg', import.meta.url)), validWav = wav();
let sequence = 0;
function check(title, expected, input, run) {
  const caseId = `wav-${String(++sequence).padStart(3, '0')}`;
  test(`${caseId} ${title}`, async () => {
    const timestamp = new Date().toISOString(); let actual, details;
    try { const result = await run(); actual = result?.actual ?? result; details = result?.details; }
    catch (error) { actual = error.code || error.message; }
    const row = { case_id: caseId, title, expected, actual, input, status: actual === expected ? 'PASS' : 'FAIL', timestamp, ...(details ? { details } : {}) };
    records.push(row); assert.equal(actual, expected, JSON.stringify(row));
  });
}
after(async () => {
  if (!process.env.R40_AUDIO_EVIDENCE_DIR) return;
  await mkdir(process.env.R40_AUDIO_EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(process.env.R40_AUDIO_EVIDENCE_DIR, 'node-case-results.json'), JSON.stringify({ schema: 'r40-audio-cases-v1', cases: records }, null, 2) + '\n');
});
for (const sampleRate of [8000, 11025, 16000, 22050, 44100, 48000, 96000, 192000]) for (const channels of [1, 2]) for (const fmtBytes of [16, 18]) {
  const frames = Math.floor(sampleRate / 10);
  check('有効PCM16の独立形式', 'ACCEPT', { sample_rate: sampleRate, channels, fmt_bytes: fmtBytes, frames, context_rate: 48000 }, () => {
    const bytes = wav({ sampleRate, channels, fmtBytes, frames }), result = preflightWavPcm16(bytes);
    assert.equal(result.codec, 'pcm_s16le'); assert.equal(result.sampleRate, sampleRate); assert.equal(result.channels, channels);
    assert.equal(result.sourceFrames, frames); assert.equal(result.durationSeconds, frames / sampleRate);
    assert.equal(result.pcmReservationBytes, (Math.ceil(frames * 48000 / sampleRate) + 4096) * channels * 4);
    return { actual: 'ACCEPT', details: { ...result, sha256: createHash('sha256').update(bytes).digest('hex') } };
  });
}
const fmt = validWav.subarray(20, 36), data = validWav.subarray(44);
const mutate = edit => { const bytes = Buffer.from(validWav); edit(bytes); return bytes; };
const malformed = [
  ['RIFF署名違い', 'AUDIO_WAV_CONTAINER_INVALID', () => mutate(b => b.write('RIFX'))],
  ['WAVE署名違い', 'AUDIO_WAV_CONTAINER_INVALID', () => mutate(b => b.write('AVI ', 8))],
  ['ヘッダー短縮', 'AUDIO_WAV_CONTAINER_INVALID', () => validWav.subarray(0, 11)],
  ['RIFFサイズ切詰め', 'AUDIO_WAV_CONTAINER_INVALID', () => mutate(b => b.writeUInt32LE(b.length - 9, 4))],
  ['RIFFサイズ超過', 'AUDIO_WAV_CONTAINER_INVALID', () => mutate(b => b.writeUInt32LE(b.length - 7, 4))],
  ['RIFF後余剰データ', 'AUDIO_WAV_CONTAINER_INVALID', () => Buffer.concat([validWav, Buffer.from([0])])],
  ['chunkヘッダー短縮', 'AUDIO_WAV_CONTAINER_INVALID', () => riff([chunk('fmt ', fmt), Buffer.alloc(7)])],
  ['chunkサイズ超過', 'AUDIO_WAV_CONTAINER_INVALID', () => mutate(b => b.writeUInt32LE(0xffffffff, 40))],
  ['奇数chunk padding欠落', 'AUDIO_WAV_CONTAINER_INVALID', () => riff([chunk('fmt ', fmt), chunk('data', data), chunk('JUNK', Buffer.from([1])).subarray(0, 9)])],
  ['fmtなし', 'AUDIO_WAV_HEADER_INVALID', () => riff([chunk('data', data)])],
  ['dataなし', 'AUDIO_WAV_HEADER_INVALID', () => riff([chunk('fmt ', fmt)])],
  ['fmt重複', 'AUDIO_WAV_HEADER_INVALID', () => riff([chunk('fmt ', fmt), chunk('data', data), chunk('fmt ', fmt)])],
  ['data重複', 'AUDIO_WAV_HEADER_INVALID', () => riff([chunk('fmt ', fmt), chunk('data', data), chunk('data', data)])],
  ['fmt短縮', 'AUDIO_WAV_HEADER_INVALID', () => riff([chunk('fmt ', fmt.subarray(0, 14)), chunk('data', data)])],
  ['fmt17bytes', 'AUDIO_WAV_HEADER_INVALID', () => riff([chunk('fmt ', Buffer.concat([fmt, Buffer.from([0])])), chunk('data', data)])],
  ['fmt拡張値不明', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => { const bytes = wav({ fmtBytes: 18 }); bytes.writeUInt16LE(2, 36); return bytes; }],
  ['extensible', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => wav({ tag: 65534 })],
  ['float', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => wav({ tag: 3 })],
  ['ADPCM', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => wav({ tag: 2 })],
  ['8bit', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => wav({ bits: 8 })],
  ['24bit', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => wav({ bits: 24 })],
  ['0channel', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => mutate(b => b.writeUInt16LE(0, 22))],
  ['3channel', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => wav({ channels: 3 })],
  ['低sample rate', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => wav({ sampleRate: 7999 })],
  ['高sample rate', 'AUDIO_WAV_FORMAT_UNSUPPORTED', () => wav({ sampleRate: 192001 })],
  ['blockAlign不整合', 'AUDIO_WAV_HEADER_INVALID', () => mutate(b => b.writeUInt16LE(3, 32))],
  ['byteRate不整合', 'AUDIO_WAV_HEADER_INVALID', () => mutate(b => b.writeUInt32LE(96001, 28))],
  ['空data', 'AUDIO_WAV_DATA_INVALID', () => wav({ frames: 0 })],
  ['部分frame', 'AUDIO_WAV_DATA_INVALID', () => riff([chunk('fmt ', fmt), chunk('data', data.subarray(0, -1))])],
  ['10秒超過', 'AUDIO_DURATION_UNSUPPORTED', () => wav({ sampleRate: 8000, frames: 80001 })],
  ['容量超過', 'AUDIO_ENCODED_BUDGET', () => Buffer.alloc(4 * 1024 * 1024 + 1)],
  ['chunk数超過', 'AUDIO_WAV_CHUNK_BUDGET', () => riff([...Array.from({ length: 16383 }, () => chunk('JUNK', Buffer.alloc(0))), chunk('fmt ', fmt), chunk('data', data)])],
];
for (const [title, expected, make] of malformed) check(title, expected, { mutation: title }, () => {
  const bytes = make(); return preflightWavPcm16(bytes);
});
function resolver(files, lower, overrides) {
  const upper = fakePack(files, 'upper/'), low = lower && fakePack(lower, 'lower/');
  return { upper, low, instance: createSoundResolver([{ id: 'upper', kind: 'imported', ...(overrides ? { overrides } : {}) }, ...(low ? [{ id: 'lower', kind: 'vanilla' }] : [])], id => id === 'upper' ? upper : low) };
}
const def = name => ({ 'sounds/sound_definitions.json': definitions({ click: { sounds: [name] } }) });
const resolve = async (files, lower, expectedField = 'codec', overrides) => (await resolver(files, lower, overrides).instance.resolve({ soundId: 'click' }))[expectedField];
const resolution = [
  ['明示WAV', 'pcm_s16le', () => resolve({ ...def('sounds/click.wav'), 'sounds/click.wav': validWav })],
  ['拡張子なしWAV', 'pcm_s16le', () => resolve({ ...def('sounds/click'), 'sounds/click.wav': validWav })],
  ['明示OGG', 'vorbis', () => resolve({ ...def('sounds/click.ogg'), 'sounds/click.ogg': ogg })],
  ['拡張子なしOGG', 'vorbis', () => resolve({ ...def('sounds/click'), 'sounds/click.ogg': ogg })],
  ['同層二形式', 'AUDIO_FORMAT_AMBIGUOUS', () => resolve({ ...def('sounds/click'), 'sounds/click.wav': validWav, 'sounds/click.ogg': ogg })],
  ['二形式で明示WAV', 'pcm_s16le', () => resolve({ ...def('sounds/click.wav'), 'sounds/click.wav': validWav, 'sounds/click.ogg': ogg })],
  ['二形式で明示OGG', 'vorbis', () => resolve({ ...def('sounds/click.ogg'), 'sounds/click.wav': validWav, 'sounds/click.ogg': ogg })],
  ['上位WAV下位OGG', 'upper', () => resolve({ 'sounds/click.wav': validWav }, { ...def('sounds/click'), 'sounds/click.ogg': ogg }, 'filePackId')],
  ['上位OGG下位WAV', 'upper', () => resolve({ 'sounds/click.ogg': ogg }, { ...def('sounds/click'), 'sounds/click.wav': validWav }, 'filePackId')],
  ['壊れた上位WAV', 'AUDIO_WAV_CONTAINER_INVALID', () => resolve({ 'sounds/click.wav': Buffer.from('bad') }, { ...def('sounds/click'), 'sounds/click.ogg': ogg })],
  ['未対応上位MP3', 'AUDIO_FORMAT_UNSUPPORTED', () => resolve({ 'sounds/click.mp3': 'x' }, { ...def('sounds/click'), 'sounds/click.wav': validWav })],
  ['上位二形式重複', 'AUDIO_FORMAT_AMBIGUOUS', () => resolve({ 'sounds/click.ogg': ogg, 'sounds/click.wav': validWav }, { ...def('sounds/click'), 'sounds/click.wav': validWav })],
  ['明示WAVの上位OGG遮断', 'AUDIO_FORMAT_MISMATCH', () => resolve({ 'sounds/click.ogg': ogg }, { ...def('sounds/click.wav'), 'sounds/click.wav': validWav })],
  ['明示OGGの上位WAV遮断', 'AUDIO_FORMAT_MISMATCH', () => resolve({ 'sounds/click.wav': validWav }, { ...def('sounds/click.ogg'), 'sounds/click.ogg': ogg })],
  ['上位定義を下位bytesで補完', 'lower', () => resolve(def('sounds/click'), { 'sounds/click.wav': validWav }, 'filePackId')],
  ['壊れた上位定義', 'AUDIO_DEFINITION_INVALID', () => resolve({ 'sounds/sound_definitions.json': '{broken' }, { ...def('sounds/click'), 'sounds/click.wav': validWav })],
  ['無関係な壊れた下位定義', 'upper', () => resolve({ ...def('sounds/click'), 'sounds/click.wav': validWav }, { 'sounds/sound_definitions.json': '{broken' }, 'filePackId')],
  ['大文字WAV完全一致', 'pcm_s16le', () => resolve({ ...def('sounds/Click.WAV'), 'sounds/Click.WAV': validWav })],
  ['大文字非完全一致一意', 'pcm_s16le', () => resolve({ ...def('sounds/CLICK.wav'), 'sounds/click.wav': validWav })],
  ['大文字衝突非完全一致', 'AUDIO_PATH_AMBIGUOUS', () => resolve({ ...def('sounds/CLICK.wav'), 'sounds/Click.wav': validWav, 'sounds/click.wav': validWav })],
  ['大文字衝突完全一致', 'pcm_s16le', () => resolve({ ...def('sounds/click.wav'), 'sounds/Click.wav': validWav, 'sounds/click.wav': validWav })],
  ['親traversal', 'AUDIO_PATH_UNSAFE', () => normalizeSoundPath('../click.wav')],
  ['URL拒否', 'AUDIO_PATH_UNSAFE', () => normalizeSoundPath('https://x/click.wav')],
  ['percent escape拒否', 'AUDIO_PATH_UNSAFE', () => normalizeSoundPath('sounds/%2e%2e/click.wav')],
  ['二重separator拒否', 'AUDIO_PATH_UNSAFE', () => normalizeSoundPath('sounds//click.wav')],
  ['明示MP3拒否', 'AUDIO_FORMAT_UNSUPPORTED', () => normalizeSoundPath('sounds/click.mp3')],
  ['override定義を採用', 'override', async () => {
    const result = await resolve({ ...def('sounds/click'), 'sounds/click.wav': validWav, 'sounds/second.wav': wav({ channels: 2 }) }, null, 'filePath', { 'sounds/sound_definitions.json': definitions({ click: { sounds: ['sounds/second'] } }) });
    assert.equal(result, 'sounds/second.wav'); return 'override';
  }],
  ['有効WAVのcache再利用', 'read_once', async () => {
    const { instance, upper } = resolver({ ...def('sounds/click'), 'sounds/click.wav': validWav }); await instance.resolve({ soundId: 'click' }); await instance.resolve({ soundId: 'click' });
    assert.equal(upper.reads.filter(file => file.endsWith('.wav')).length, 1); return 'read_once';
  }],
  ['context変更で再予約', 'read_twice', async () => {
    const { instance, upper } = resolver({ ...def('sounds/click'), 'sounds/click.wav': validWav });
    const first = await instance.resolve({ soundId: 'click', contextSampleRate: 48000 }), second = await instance.resolve({ soundId: 'click', contextSampleRate: 96000 });
    assert(second.pcmReservationBytes > first.pcmReservationBytes); assert.equal(upper.reads.filter(file => file.endsWith('.wav')).length, 2); return 'read_twice';
  }],
  ['定義音量0保持', 'zero', async () => { assert.equal(await resolve({ 'sounds/sound_definitions.json': definitions({ click: { sounds: [{ name: 'sounds/click', volume: 0 }] } }), 'sounds/click.wav': validWav }, null, 'candidateVolume'), 0); return 'zero'; }],
  ['candidate pitch保持', 'pitch1.5', async () => { assert.equal(await resolve({ 'sounds/sound_definitions.json': definitions({ click: { sounds: [{ name: 'sounds/click', pitch: 1.5 }] } }), 'sounds/click.wav': validWav }, null, 'candidatePitch'), 1.5); return 'pitch1.5'; }],
  ['stream拒否', 'AUDIO_STREAM_UNSUPPORTED', () => resolve({ 'sounds/sound_definitions.json': definitions({ click: { sounds: [{ name: 'sounds/click', stream: true }] } }), 'sounds/click.wav': validWav })],
];
for (const [title, expected, run] of resolution) check(title, expected, { scenario: title }, run);
assert.equal(sequence, 96);

test('additional WAV structure: odd JUNK, LIST, data-before-fmt, input slices and exact boundaries', () => {
  const extra = [chunk('JUNK', Buffer.from([1, 2, 3])), chunk('LIST', Buffer.from('INFO')), chunk('JUNK', Buffer.alloc(0))];
  assert.equal(preflightWavPcm16(wav({ extras: extra, dataFirst: true })).chunks, 5);
  const bytes = wav();
  const framed = new Uint8Array(bytes.length + 2); framed.set(bytes, 1);
  assert.equal(preflightWavPcm16(framed.subarray(1, -1)).sourceFrames, 5760);
  assert.equal(preflightWavPcm16(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)).sourceFrames, 5760);
  assert.equal(preflightWavPcm16(wav({ sampleRate: 8000, frames: 80000 })).durationSeconds, 10);
  assert.throws(() => preflightWavPcm16(wav({ sampleRate: 8000, frames: 80000, channels: 2 }), { contextSampleRate: 192000 }), /AUDIO_PCM_BUDGET/);
  for (const rate of [7999, 192001, NaN, '48000']) assert.throws(() => preflightWavPcm16(bytes, { contextSampleRate: rate }), /AUDIO_SAMPLE_RATE_INVALID/);
  assert.throws(() => preflightWavPcm16('RIFF'), /AUDIO_WAV_CONTAINER_INVALID/);
});

test('FOURCC high bits cannot alias RIFF/WAVE/fmt/data; full extensible header is classified unsupported', () => {
  for (const position of [0, 8]) {
    const bytes = wav(); bytes[position] |= 128;
    assert.throws(() => preflightWavPcm16(bytes), /AUDIO_WAV_CONTAINER_INVALID/);
  }
  for (const position of [12, 36]) {
    const bytes = wav(); bytes[position] |= 128;
    assert.throws(() => preflightWavPcm16(bytes), /AUDIO_WAV_HEADER_INVALID/);
  }
  const extended = Buffer.alloc(40); fmt.copy(extended); extended.writeUInt16LE(65534, 0); extended.writeUInt16LE(22, 16);
  assert.throws(() => preflightWavPcm16(riff([chunk('fmt ', extended), chunk('data', data)])), /AUDIO_WAV_FORMAT_UNSUPPORTED/);
});
