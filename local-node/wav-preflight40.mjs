import { fail } from './limits.mjs';
import { AUDIO_LIMITS } from './audio-preflight.mjs';

export const WAV_POLICY_VERSION = 'pcm16-short-v1-riff-bounded';
export const WAV_CHUNK_LIMIT = 16384;

/**
 * Inspect one bounded RIFF/WAVE PCM16 file before browser decode.
 * Accepts Buffer, Uint8Array or ArrayBuffer; performs no I/O and no audio output.
 * Unknown chunks are length/padding checked and skipped, never interpreted.
 */
export function preflightWavPcm16(input, { contextSampleRate = 48000 } = {}) {
  if (!Number.isInteger(contextSampleRate) || contextSampleRate < 8000 || contextSampleRate > 192000) fail('AUDIO_SAMPLE_RATE_INVALID');
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) fail('AUDIO_WAV_CONTAINER_INVALID');
  if (!input.byteLength || input.byteLength > AUDIO_LIMITS.encodedBytes) fail('AUDIO_ENCODED_BUDGET', 413);
  const bytes = Buffer.isBuffer(input) ? input : input instanceof ArrayBuffer ? Buffer.from(input) : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  // latin1 preserves the high bit; Node's ascii decoder would mask it and accept forged FOURCCs.
  if (bytes.length < 12 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) fail('AUDIO_WAV_CONTAINER_INVALID');
  let offset = 12, chunks = 0, format = null, data = null;
  while (offset < bytes.length) {
    if (++chunks > WAV_CHUNK_LIMIT) fail('AUDIO_WAV_CHUNK_BUDGET', 413);
    if (bytes.length - offset < 8) fail('AUDIO_WAV_CONTAINER_INVALID');
    const id = bytes.toString('latin1', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + length, next = end + (length & 1);
    if (!Number.isSafeInteger(next) || end > bytes.length || next > bytes.length) fail('AUDIO_WAV_CONTAINER_INVALID');
    if (id === 'fmt ') {
      if (format || length < 16) fail('AUDIO_WAV_HEADER_INVALID');
      if (bytes.readUInt16LE(start) !== 1) fail('AUDIO_WAV_FORMAT_UNSUPPORTED', 415);
      if (![16, 18].includes(length)) fail('AUDIO_WAV_HEADER_INVALID');
      format = { tag: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bitsPerSample: bytes.readUInt16LE(start + 14) };
      if (length === 18 && bytes.readUInt16LE(start + 16) !== 0) fail('AUDIO_WAV_FORMAT_UNSUPPORTED', 415);
    } else if (id === 'data') {
      if (data) fail('AUDIO_WAV_HEADER_INVALID');
      data = { offset: start, bytes: length };
    }
    // Eight header bytes guarantee progress even for an empty unknown chunk.
    offset = next;
  }
  if (!format || !data) fail('AUDIO_WAV_HEADER_INVALID');
  const { tag, channels, sampleRate, byteRate, blockAlign, bitsPerSample } = format;
  if (tag !== 1 || ![1, 2].includes(channels) || bitsPerSample !== 16 || sampleRate < 8000 || sampleRate > 192000) fail('AUDIO_WAV_FORMAT_UNSUPPORTED', 415);
  if (blockAlign !== channels * 2 || byteRate !== sampleRate * blockAlign) fail('AUDIO_WAV_HEADER_INVALID');
  if (!data.bytes || data.bytes % blockAlign !== 0) fail('AUDIO_WAV_DATA_INVALID');
  const sourceFrames = data.bytes / blockAlign, durationSeconds = sourceFrames / sampleRate;
  if (durationSeconds > AUDIO_LIMITS.durationSeconds) fail('AUDIO_DURATION_UNSUPPORTED', 415);
  const pcmReservationBytes = (Math.ceil(sourceFrames * contextSampleRate / sampleRate) + 4096) * channels * 4;
  if (!Number.isSafeInteger(pcmReservationBytes) || pcmReservationBytes > AUDIO_LIMITS.pcmBytes) fail('AUDIO_PCM_BUDGET', 413);
  return { container: 'wav', codec: 'pcm_s16le', bitsPerSample, channels, sampleRate, contextSampleRate, sourceFrames,
    durationSeconds, durationEstimate: durationSeconds, encodedBytes: bytes.length, pcmReservationBytes,
    dataOffset: data.offset, dataBytes: data.bytes, chunks, decodedFrameTolerance: 2, policyVersion: WAV_POLICY_VERSION };
}
