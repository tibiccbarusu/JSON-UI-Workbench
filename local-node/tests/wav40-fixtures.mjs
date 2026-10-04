import assert from 'node:assert/strict';

export function chunk(id, bytes) {
  const out = Buffer.alloc(8 + bytes.length + (bytes.length & 1));
  out.write(id, 0, 4, 'ascii'); out.writeUInt32LE(bytes.length, 4); bytes.copy(out, 8); return out;
}
export function riff(chunks) {
  const data = Buffer.concat(chunks), out = Buffer.alloc(12 + data.length);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVE', 8); data.copy(out, 12); return out;
}
export function wav({ sampleRate = 48000, channels = 1, fmtBytes = 16, frames = 5760, bits = 16, tag = 1, extras = [], dataFirst = false } = {}) {
  const format = Buffer.alloc(fmtBytes); format.writeUInt16LE(tag, 0); format.writeUInt16LE(channels, 2);
  format.writeUInt32LE(sampleRate, 4); format.writeUInt32LE(sampleRate * channels * 2, 8);
  format.writeUInt16LE(channels * 2, 12); format.writeUInt16LE(bits, 14);
  const samples = Buffer.alloc(frames * channels * 2);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) samples.writeInt16LE(Math.round(10000 * Math.sin(2 * Math.PI * (440 + channel * 110) * frame / sampleRate)), (frame * channels + channel) * 2);
  return riff([...extras, ...(dataFirst ? [chunk('data', samples), chunk('fmt ', format)] : [chunk('fmt ', format), chunk('data', samples)])]);
}
export function fakePack(files, rootPrefix = 'nested/') {
  const map = new Map(Object.entries(files).map(([name, value]) => [rootPrefix + name, Buffer.isBuffer(value) ? value : Buffer.from(value)])), reads = [];
  return { rootPrefix, packPaths: Object.keys(files), reads, zipReader: {
    entryIndex: new Map([...map].map(([path, bytes]) => [path, { info: { uncompressedSize: bytes.length } }])),
    async bytes(path, cap) { reads.push(path); assert(map.has(path), path); const value = map.get(path); if (value.length > cap) throw new Error('ZIP_ENTRY_READ_LIMIT'); return value; },
    async readText(path, options) { return (await this.bytes(path, options.maxBytes)).toString('utf8'); },
  } };
}
export const definitions = data => JSON.stringify({ format_version: '1.14.0', sound_definitions: data });
