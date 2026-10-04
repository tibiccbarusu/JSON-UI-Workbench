// 読み取り専用の brarchive v1 パーサー。Mojang 公式のバイナリ仕様ではない。
// 形式根拠: https://github.com/bedrock-crustaceans/brarchive/blob/main/FORMAT.md
// 実物照合: 提供 v26.45 textures/items.brarchive（472 entries / PNG 原本）。
// 全体の展開・パスへの書出し・MCB の推測変換は行わない。
import { open as openFile } from 'node:fs/promises';
import { LIMITS, fail } from './limits.mjs';

const MAGIC = 0x267052a0b125277dn;
const HEADER = 16, DESCRIPTOR = 256;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const HARD_LIMITS = Object.freeze({
  archiveBytes: LIMITS.expandedBytes,
  entries: LIMITS.entries,
  indexBytes: LIMITS.centralBytes,
  entryBytes: LIMITS.entryBytes,
  totalBytes: LIMITS.expandedBytes,
});

function integer(value, maximum, code) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(code, 413);
  return value;
}

function safeName(name) {
  if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\')
    || /[\u0000-\u001f\u007f<>:"|?*]/u.test(name)) fail('BRARCHIVE_PATH_UNSAFE');
  for (const part of name.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/u.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)) fail('BRARCHIVE_PATH_UNSAFE');
  }
  return name;
}

function contentKind(bytes, name) {
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes.subarray(1, 4).toString('ascii') === 'MCB')
    fail('BRARCHIVE_MCB_UNSUPPORTED', 422);
  const compressed = [
    [0x1f, 0x8b], // gzip
    [0x28, 0xb5, 0x2f, 0xfd], // Zstandard
    [0x50, 0x4b, 0x03, 0x04], // ZIP
    [0x42, 0x5a, 0x68], // bzip2
    [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // xz
  ];
  if (compressed.some(magic => bytes.length >= magic.length && magic.every((v, i) => bytes[i] === v)))
    fail('BRARCHIVE_COMPRESSED_CONTENT_UNSUPPORTED', 422);
  // zlib CMF/FLG. TGA can coincidentally begin with these bytes: only apply to
  // text and PNG, whose accepted uncompressed signatures cannot be zlib.
  const text = /\.(?:json|jsonc|lang|txt|material)$/iu.test(name);
  if ((text || /\.png$/iu.test(name)) && bytes.length >= 2 && (bytes[0] & 15) === 8
    && (bytes[0] >>> 4) <= 7 && ((bytes[0] << 8) + bytes[1]) % 31 === 0)
    fail('BRARCHIVE_COMPRESSED_CONTENT_UNSUPPORTED', 422);
  if (/\.png$/iu.test(name) && (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG)))
    fail('BRARCHIVE_PNG_SIGNATURE_INVALID', 422);
  if (/\.jpe?g$/iu.test(name) && (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff))
    fail('BRARCHIVE_JPEG_SIGNATURE_INVALID', 422);
  if (text) {
    let value;
    try { value = utf8.decode(bytes); } catch { fail('BRARCHIVE_TEXT_ENCODING_INVALID', 422); }
    if (value.includes('\0')) fail('BRARCHIVE_TEXT_BINARY_UNSUPPORTED', 422);
  }
}

/**
 * source: diskPath string / {diskPath,name?} / {size,readUint8Array(offset,length)}.
 * Callback sources are borrowed: caller retains ownership of their close().
 * Every callback read must return exactly the requested number of bytes.
 * The source must remain immutable until close(); returned entry bytes are copies.
 */
export class BrArchiveReader {
  static async open(source, options = {}) {
    const reader = new BrArchiveReader(options);
    try {
      if (typeof source === 'string' || (source && typeof source.diskPath === 'string')) {
        reader.handle = await openFile(typeof source === 'string' ? source : source.diskPath, 'r');
        const stat = await reader.handle.stat();
        if (!stat.isFile()) fail('BRARCHIVE_NOT_FILE');
        reader.fileName = typeof source === 'string' ? '' : source.name || '';
        reader.source = {
          size: stat.size,
          async readUint8Array(offset, length) {
            const out = Buffer.alloc(length);
            let done = 0;
            while (done < length) {
              const result = await reader.handle.read(out, done, length - done, offset + done);
              if (!result.bytesRead) fail('BRARCHIVE_TRUNCATED');
              done += result.bytesRead;
            }
            return out;
          },
        };
      } else {
        if (!source || typeof source.readUint8Array !== 'function') fail('BRARCHIVE_SOURCE_INVALID');
        reader.source = source;
      }
      await reader.index();
      return reader;
    } catch (error) {
      await reader.close();
      throw error;
    }
  }

  static async fromBytes(bytes, options = {}) {
    if (!(bytes instanceof Uint8Array)) fail('BRARCHIVE_SOURCE_INVALID');
    // No whole-archive copy; the supplied bytes must remain immutable.
    return BrArchiveReader.open({ size: bytes.byteLength,
      readUint8Array: async (offset, length) => bytes.subarray(offset, offset + length) }, options);
  }

  constructor(options = {}) {
    this.limits = {};
    for (const [name, maximum] of Object.entries(HARD_LIMITS))
      this.limits[name] = integer(options[name] ?? maximum, maximum, 'BRARCHIVE_LIMIT_INVALID');
    this.entryIndex = new Map();
    this.closed = false;
  }

  async read(offset, length) {
    if (this.closed) fail('BRARCHIVE_CLOSED');
    integer(offset, this.size, 'BRARCHIVE_READ_RANGE');
    integer(length, Math.max(this.limits.indexBytes, this.limits.entryBytes, HEADER), 'BRARCHIVE_READ_RANGE');
    if (offset + length > this.size) fail('BRARCHIVE_READ_RANGE');
    const data = await this.source.readUint8Array(offset, length);
    if (!(data instanceof Uint8Array) || data.byteLength !== length) fail('BRARCHIVE_TRUNCATED');
    // Snapshot each bounded read, so a borrowed buffer cannot change underneath
    // index parsing. Never transfer or expose the source's backing ArrayBuffer.
    return Buffer.from(data);
  }

  async index() {
    this.size = integer(this.source.size, this.limits.archiveBytes, 'BRARCHIVE_SIZE_LIMIT');
    if (this.size < HEADER) fail('BRARCHIVE_HEADER_TRUNCATED');
    const header = await this.read(0, HEADER);
    if (header.readBigUInt64LE(0) !== MAGIC) fail('BRARCHIVE_MAGIC_UNSUPPORTED');
    if (header.readUInt32LE(12) !== 1) fail('BRARCHIVE_VERSION_UNSUPPORTED', 422);
    const count = integer(header.readUInt32LE(8), this.limits.entries, 'BRARCHIVE_ENTRY_COUNT_LIMIT');
    const indexBytes = integer(count * DESCRIPTOR, this.limits.indexBytes, 'BRARCHIVE_INDEX_LIMIT');
    this.contentBase = HEADER + indexBytes;
    if (this.contentBase > this.size) fail('BRARCHIVE_INDEX_TRUNCATED');
    const descriptors = await this.read(HEADER, indexBytes);
    const folded = new Set(), ranges = [];
    let total = 0, stubs = 0, blocked = 0;
    for (let i = 0; i < count; i++) {
      const at = i * DESCRIPTOR, nameLength = descriptors[at];
      if (!nameLength || nameLength > 247) fail('BRARCHIVE_NAME_LENGTH_INVALID');
      let name;
      try { name = utf8.decode(descriptors.subarray(at + 1, at + 1 + nameLength)); }
      catch { fail('BRARCHIVE_NAME_ENCODING_INVALID'); }
      safeName(name);
      const key = name.normalize('NFC').toLowerCase();
      if (folded.has(key)) fail('BRARCHIVE_PATH_COLLISION');
      folded.add(key);
      const relativeOffset = descriptors.readUInt32LE(at + 248);
      const size = descriptors.readUInt32LE(at + 252);
      const offset = this.contentBase + relativeOffset;
      if (offset > this.size || size > this.size - offset) fail('BRARCHIVE_ENTRY_RANGE');
      total += size;
      if (total > this.limits.totalBytes) fail('BRARCHIVE_TOTAL_LIMIT', 413);
      const stub = size === 0;
      if (stub) stubs++;
      const blockedReason = stub ? 'BRARCHIVE_ENTRY_STUB'
        : size > this.limits.entryBytes ? 'BRARCHIVE_ENTRY_READ_LIMIT' : null;
      if (blockedReason) blocked++;
      this.entryIndex.set(name, Object.freeze({ path: name, name, offset,
        uncompressedSize: size, compressedSize: size, directory: false, stub, blockedReason }));
      if (size) ranges.push([offset, offset + size]);
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 1; i < ranges.length; i++) {
      const [a, b] = ranges[i - 1], [c, d] = ranges[i];
      if (c < b && (a !== c || b !== d)) fail('BRARCHIVE_PARTIAL_OVERLAP');
    }
    this.meta = Object.freeze({ fileName: this.fileName || '', archiveBytes: this.size,
      version: 1, entryCount: count, totalUncompressedBytes: total, stubCount: stubs,
      blockedReadCount: blocked, formatEvidence: 'COMMUNITY_IMPLEMENTATION_AND_V26_45_SAMPLE' });
  }

  async listEntries() {
    if (this.closed) fail('BRARCHIVE_CLOSED');
    if (!this.meta) fail('BRARCHIVE_NOT_OPEN');
    return { meta: this.meta, entries: [...this.entryIndex.values()], warnings: this.meta.stubCount
      ? [{ code: 'BRARCHIVE_STUB_ENTRIES', message: `${this.meta.stubCount} 件は実体を含まない可能性のある空の項目です。` }] : [] };
  }

  async listAllFilePaths() {
    const { entries } = await this.listEntries();
    return entries.map(entry => entry.path);
  }

  async bytes(name, maxBytes = this.limits.entryBytes) {
    if (this.closed) fail('BRARCHIVE_CLOSED');
    integer(maxBytes, this.limits.entryBytes, 'BRARCHIVE_LIMIT_INVALID');
    const entry = this.entryIndex.get(safeName(name));
    if (!entry) fail('BRARCHIVE_ENTRY_NOT_FOUND', 404);
    if (entry.blockedReason) fail(entry.blockedReason, entry.stub ? 422 : 413);
    if (entry.uncompressedSize > maxBytes) fail('BRARCHIVE_ENTRY_READ_LIMIT', 413);
    const bytes = await this.read(entry.offset, entry.uncompressedSize);
    contentKind(bytes, name);
    return bytes;
  }

  async readText(name, options = {}) {
    const bytes = await this.bytes(name, options.maxBytes ?? Math.min(LIMITS.textBytes, this.limits.entryBytes));
    try { return utf8.decode(bytes); } catch { fail('BRARCHIVE_TEXT_ENCODING_INVALID', 422); }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.entryIndex.clear();
    this.source = null;
    await this.handle?.close();
    this.handle = null;
  }
}
