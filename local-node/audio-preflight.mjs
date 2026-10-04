import { fail } from './limits.mjs';

export const AUDIO_LIMITS = Object.freeze({ encodedBytes: 4 * 1024 * 1024, definitionBytes: 8 * 1024 * 1024,
  durationSeconds: 10, pcmBytes: 8 * 1024 * 1024, pages: 16384, candidates: 64, definitions: 50000, jobMs: 5000 });
export const AUDIO_POLICY_VERSION = 'vorbis-short-v2-packet-bound';
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index << 24;
  for (let bit = 0; bit < 8; bit++) value = (value << 1) ^ (value < 0 ? 0x04c11db7 : 0);
  return value >>> 0;
});

// Ogg uses a non-reflected CRC. The four checksum bytes are zero during calculation.
export function oggPageCrc(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ (i >= 22 && i < 26 ? 0 : bytes[i])) & 255]) >>> 0;
  return crc;
}

/** Bounded container/header inspection, not a full Vorbis decoder or a native-memory hard cap. */
export function preflightOggVorbis(input, { contextSampleRate = 48000 } = {}) {
  if (!Number.isInteger(contextSampleRate) || contextSampleRate < 8000 || contextSampleRate > 192000) fail('AUDIO_SAMPLE_RATE_INVALID');
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!bytes.length || bytes.length > AUDIO_LIMITS.encodedBytes) fail('AUDIO_ENCODED_BUDGET', 413);
  let offset = 0, serial, nextSequence = 0, pending = [], pendingBytes = 0, packetCount = 0;
  let channels, sampleRate, maximumBlockSize, lastGranule = 0n, finalGranule = null, pages = 0, ended = false;
  const packet = data => {
    if (packetCount === 0) {
      if (data.subarray(0, 8).toString('ascii') === 'OpusHead') fail('AUDIO_FORMAT_UNSUPPORTED', 415);
      if (data.length !== 30 || data[0] !== 1 || data.subarray(1, 7).toString('ascii') !== 'vorbis') fail('AUDIO_FORMAT_UNSUPPORTED', 415);
      channels = data[11]; sampleRate = data.readUInt32LE(12);
      const shortBlock = data[28] & 15, longBlock = data[28] >>> 4;
      if (data.readUInt32LE(7) !== 0 || !(data[29] & 1) || shortBlock < 6 || longBlock > 13 || shortBlock > longBlock) fail('AUDIO_HEADER_INVALID');
      maximumBlockSize = 2 ** longBlock;
      if (channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 192000) fail('AUDIO_FORMAT_UNSUPPORTED', 415);
    } else if (packetCount < 3) {
      if (data.length < 8 || data[0] !== (packetCount === 1 ? 3 : 5) || data.subarray(1, 7).toString('ascii') !== 'vorbis') fail('AUDIO_HEADER_INVALID');
    } else if (!data.length || (data[0] & 1)) fail('AUDIO_CONTAINER_INVALID');
    packetCount++;
  };
  while (offset < bytes.length) {
    if (ended || ++pages > AUDIO_LIMITS.pages || offset + 27 > bytes.length) fail('AUDIO_CONTAINER_INVALID');
    const page = bytes.subarray(offset), flags = page[5], count = page[26];
    if (page.subarray(0, 4).toString('ascii') !== 'OggS' || page[4] !== 0 || flags & ~7 || page.length < 27 + count || !count) fail('AUDIO_CONTAINER_INVALID');
    if (pages === 1) { if (!(flags & 2) || flags & 1) fail('AUDIO_CONTAINER_INVALID'); serial = page.readUInt32LE(14); }
    else if (flags & 2 || page.readUInt32LE(14) !== serial) fail('AUDIO_CHAINED_STREAM_UNSUPPORTED', 415);
    if (page.readUInt32LE(18) !== nextSequence++ || Boolean(flags & 1) !== Boolean(pendingBytes)) fail('AUDIO_CONTAINER_INVALID');
    let bodyBytes = 0;
    for (let i = 0; i < count; i++) bodyBytes += page[27 + i];
    const size = 27 + count + bodyBytes;
    if (size > page.length || oggPageCrc(page.subarray(0, size)) !== page.readUInt32LE(22)) fail('AUDIO_CONTAINER_CRC_INVALID');
    let cursor = 27 + count, completed = 0;
    for (let i = 0; i < count; i++) {
      const segment = page[27 + i]; pending.push(page.subarray(cursor, cursor + segment)); pendingBytes += segment; cursor += segment;
      if (segment < 255) { packet(pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes)); pending = []; pendingBytes = 0; completed++; }
    }
    const granule = page.readBigUInt64LE(6);
    if (granule !== 0xffffffffffffffffn) {
      if (!completed || granule < lastGranule || granule > BigInt(sampleRate * AUDIO_LIMITS.durationSeconds)) fail('AUDIO_DURATION_UNSUPPORTED', 415);
      lastGranule = granule;
    }
    if (flags & 4) {
      if (pendingBytes || granule === 0xffffffffffffffffn || packetCount < 4 || granule <= 0n) fail('AUDIO_DURATION_UNKNOWN', 415);
      ended = true; finalGranule = granule;
    }
    offset += size;
  }
  if (!ended || finalGranule === null) fail('AUDIO_DURATION_UNKNOWN', 415);
  const durationSeconds = Number(finalGranule) / sampleRate;
  const audioPackets = packetCount - 3;
  // Vorbis I §4.3.8 emits previousBlock/4 + currentBlock/4 samples per overlap,
  // at most maxBlock/2. Count every audio packet at that maximum, then retain
  // another full maximum block for priming/end padding. This deliberately does
  // not trust a small/forged EOS granule as an upper bound on decoder output.
  const packetSampleUpperBound = audioPackets * maximumBlockSize / 2 + maximumBlockSize;
  const sourceSampleUpperBound = Math.max(Number(finalGranule), packetSampleUpperBound);
  // Resampling/frame rounding receives a separate 4096 output-sample allowance.
  const pcmReservationBytes = (Math.ceil(sourceSampleUpperBound * contextSampleRate / sampleRate) + 4096) * channels * 4;
  if (pcmReservationBytes > AUDIO_LIMITS.pcmBytes) fail('AUDIO_PCM_BUDGET', 413);
  return { codec: 'vorbis', channels, sampleRate, contextSampleRate, durationSeconds, durationEstimate: durationSeconds,
    audioPackets, maximumBlockSize, sourceSampleUpperBound, packetDurationUpperBound: packetSampleUpperBound / sampleRate,
    encodedBytes: bytes.length, pcmReservationBytes, pages, policyVersion: AUDIO_POLICY_VERSION };
}
