import { open } from 'node:fs/promises';
import '../editor-core/vendor/zip.js-2.8.16/zip.min.js';
import { normalizeZipPath } from '../editor-core/src/path/normalize-zip-path.js';
import { LIMITS, fail, boundedInteger } from './limits.mjs';
const zip = globalThis.zip;
zip.configure({ useWebWorkers: false, useCompressionStream: true });

export class DiskReader extends zip.Reader {
  constructor(handle, size, { cachePages = 4 } = {}) {
    super();
    if (!Number.isSafeInteger(cachePages) || cachePages < 0 || cachePages > 4) fail('ZIP_READ_CACHE_INVALID');
    this.handle = handle; this.size = size; this.cachePages = cachePages;
    this.pages = new Map(); this.pageBytes = 64 * 1024;
    this.readAheadBytes = 0; this.readAheadBudget = Math.min(size, 16 * 1024 * 1024);
    this.metrics = { physical_reads: 0, physical_bytes: 0, small_read_hits: 0, small_read_misses: 0, read_ahead_exhausted: 0 };
  }
  async readUint8Array(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
      || offset + length > this.size || length > LIMITS.centralBytes) fail('ZIP_READ_RANGE');
    if (length === 0) return Buffer.alloc(0);
    // Imported ZIPs are private immutable files. Local-header and name probes
    // commonly revisit the same page; retaining at most 256 KiB avoids one
    // filesystem operation per tiny probe. Entry caps and CRC checks still run
    // above this byte-reader boundary, including when a page is already warm.
    // Large/overlapping reads remain direct to bound read-ahead and copying.
    const pageOffset = Math.floor(offset / this.pageBytes) * this.pageBytes;
    if (this.cachePages && length <= 4096 && offset + length <= pageOffset + this.pageBytes) {
      let page = this.pages.get(pageOffset);
      if (page) { this.pages.delete(pageOffset); this.metrics.small_read_hits++; }
      else {
        this.metrics.small_read_misses++;
        const pageLength = Math.min(this.pageBytes, this.size - pageOffset);
        // A deliberately scattered central index must not cause unbounded
        // read amplification. Existing warm pages remain useful after budget
        // exhaustion, and all later misses use their exact requested ranges.
        if (this.readAheadBytes + pageLength > this.readAheadBudget) {
          this.metrics.read_ahead_exhausted++;
          return this.readDirect(offset, length);
        }
        this.readAheadBytes += pageLength;
        page = await this.readDirect(pageOffset, pageLength);
      }
      this.pages.set(pageOffset, page);
      while (this.pages.size > this.cachePages) this.pages.delete(this.pages.keys().next().value);
      // Callers own their result: mutation must never alter future reads.
      // zip.js uses the backing ArrayBuffer for several header DataViews. An
      // unpooled allocation preserves byteOffset === 0 like the direct path.
      const bytes = Buffer.alloc(length);
      page.copy(bytes, 0, offset - pageOffset, offset - pageOffset + length);
      return bytes;
    }
    return this.readDirect(offset, length);
  }
  async readDirect(offset, length) {
    const bytes = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const r = await this.handle.read(bytes, read, length - read, offset + read);
      this.metrics.physical_reads++; this.metrics.physical_bytes += r.bytesRead;
      if (!r.bytesRead) fail('ZIP_TRUNCATED');
      read += r.bytesRead;
    }
    return bytes;
  }
  snapshot() { return { ...this.metrics, cache_pages: this.pages.size,
    cache_bytes: [...this.pages.values()].reduce((sum, page) => sum + page.byteLength, 0),
    max_cache_bytes: this.cachePages * this.pageBytes, read_ahead_bytes: this.readAheadBytes,
    read_ahead_budget: this.readAheadBudget }; }
  clear() { this.pages.clear(); }
}

function safePath(name) {
  const path = normalizeZipPath(name);
  if (path.split('/').some(p => /[<>:"|?*]/u.test(p) || /[. ]$/u.test(p)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(p))) fail('ZIP_PATH_WINDOWS_UNSAFE');
  return path;
}

async function preflight(reader) {
  const n = Math.min(reader.size, 65557);
  const bytes = await reader.readUint8Array(reader.size - n, n);
  let at = -1;
  for (let i = n - 22; i >= 0; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === n) { at = i; break; }
  }
  if (at < 0) fail('ZIP_EOCD_NOT_FOUND');
  if (bytes.readUInt16LE(at + 4) || bytes.readUInt16LE(at + 6)) fail('ZIP_MULTIDISK_UNSUPPORTED');
  let count = bytes.readUInt16LE(at + 10), centralSize = bytes.readUInt32LE(at + 12), offset = bytes.readUInt32LE(at + 16);
  const eocdOffset = reader.size - n + at;
  let boundary = eocdOffset;
  if (count === 65535 || centralSize === 0xffffffff || offset === 0xffffffff) {
    if (eocdOffset < 20) fail('ZIP64_LOCATOR_MISSING');
    const locator = await reader.readUint8Array(eocdOffset - 20, 20);
    if (locator.readUInt32LE(0) !== 0x07064b50 || locator.readUInt32LE(4) || locator.readUInt32LE(16) !== 1) fail('ZIP64_LOCATOR_INVALID');
    boundary = Number(locator.readBigUInt64LE(8));
    const large = await reader.readUint8Array(boundary, 56);
    if (large.readUInt32LE(0) !== 0x06064b50 || large.readUInt32LE(16) || large.readUInt32LE(20)) fail('ZIP64_EOCD_INVALID');
    const recordSize=Number(large.readBigUInt64LE(4));
    if(!Number.isSafeInteger(recordSize)||recordSize<44||boundary+12+recordSize!==eocdOffset-20)fail('ZIP64_EOCD_SIZE_INVALID');
    count = Number(large.readBigUInt64LE(32)); centralSize = Number(large.readBigUInt64LE(40)); offset = Number(large.readBigUInt64LE(48));
    if (large.readBigUInt64LE(24) !== large.readBigUInt64LE(32)) fail('ZIP_MULTIDISK_UNSUPPORTED');
  } else if (bytes.readUInt16LE(at + 8) !== count) fail('ZIP_MULTIDISK_UNSUPPORTED');
  if (![count, centralSize, offset].every(Number.isSafeInteger) || count > LIMITS.entries || centralSize > LIMITS.centralBytes
    || offset < 0 || centralSize < 0 || offset + centralSize !== boundary) fail('ZIP_CENTRAL_LIMIT_OR_RANGE');
  return { count, offset, centralSize };
}

// The archive is never expanded to paths supplied by its entries. Only lazy,
// CRC-verified bounded bytes leave this reader; zip.js owns ZIP64/CP437 decoding.
export class DiskZipReader {
  constructor({ cachePages = 4 } = {}) { this.entryIndex = new Map(); this.closed = false; this.cachePages = cachePages; }
  /** MCADDON child archives remain bounded data; never extract entry paths. */
  async openFromBytes(bytes, name) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 22 || bytes.byteLength > LIMITS.entryBytes) fail('ADDON_NESTED_SIZE_LIMIT', 413);
    this.fileName = name; this.size = bytes.byteLength;
    let retained = bytes;
    class BoundedMemoryReader extends zip.Reader {
      constructor(size) { super(); this.size = size; }
      async readUint8Array(offset, length) {
        if (!retained) fail('ZIP_CLOSED');
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
          || offset + length > retained.byteLength || length > LIMITS.centralBytes) fail('ZIP_READ_RANGE');
        const result = Buffer.alloc(length); result.set(retained.subarray(offset, offset + length)); return result;
      }
      clear() { retained = null; }
      snapshot() { return { in_memory: true, retained_bytes: retained?.byteLength || 0, maximum_bytes: LIMITS.entryBytes }; }
    }
    this.reader = new BoundedMemoryReader(this.size);
    this.central = await preflight(this.reader);
    this.archive = new zip.ZipReader(this.reader, { checkSignature: true, checkOverlappingEntry: true });
  }
  async openFromFile(file) {
    this.handle = await open(file.diskPath, 'r');
    const stat = await this.handle.stat();
    if (!stat.isFile() || stat.size > LIMITS.zipBytes) fail('ZIP_SIZE_LIMIT');
    this.fileName = file.name; this.size = stat.size;
    this.reader = new DiskReader(this.handle, stat.size, { cachePages: this.cachePages });
    this.central = await preflight(this.reader);
    this.archive = new zip.ZipReader(this.reader, { checkSignature: true, checkOverlappingEntry: true });
  }
  async listEntries() {
    if (this.meta) return { meta: this.meta, warnings: [], entries: [] };
    const folded = new Set(); const ranges = []; let total = 0, directories = 0;
    for await (const entry of this.archive.getEntriesGenerator()) {
      if (this.entryIndex.size >= LIMITS.entries) fail('ZIP_ENTRY_COUNT_LIMIT');
      const path = safePath(entry.filename), key = path.normalize('NFC').toLowerCase();
      if (folded.has(key)) fail('ZIP_PATH_COLLISION');
      folded.add(key);
      if (entry.encrypted) fail('ZIP_ENCRYPTED_UNSUPPORTED');
      const type = ((entry.versionMadeBy >>> 8) === 3 || (entry.versionMadeBy >>> 8) === 19)
        ? ((entry.externalFileAttributes >>> 16) & 0xf000) : (entry.unixMode || 0) & 0xf000;
      if (type && type !== 0x8000 && type !== 0x4000) fail('ZIP_SPECIAL_FILE_UNSUPPORTED');
      if (![0, 8].includes(entry.compressionMethod)) fail('ZIP_COMPRESSION_UNSUPPORTED');
      if (![entry.uncompressedSize, entry.compressedSize, entry.offset].every(Number.isSafeInteger)) fail('ZIP_SIZE_INVALID');
      total += entry.uncompressedSize;
      if (total > LIMITS.expandedBytes) fail('ZIP_EXPANDED_TOTAL_LIMIT');
      const local = await this.reader.readUint8Array(entry.offset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== entry.compressionMethod
        || Boolean(local.readUInt16LE(6) & 8) !== Boolean(entry.bitFlag.dataDescriptor)
        || Boolean(local.readUInt16LE(6) & 0x800) !== Boolean(entry.bitFlag.languageEncodingFlag)
        || (local.readUInt16LE(6) & 1)) fail('ZIP_LOCAL_HEADER_MISMATCH');
      const nameSize = local.readUInt16LE(26), extraSize = local.readUInt16LE(28);
      const rawName = await this.reader.readUint8Array(entry.offset + 30, nameSize);
      if (!rawName.equals(Buffer.from(entry.rawFilename))) fail('ZIP_LOCAL_NAME_MISMATCH');
      const start = entry.offset;
      let end = start + 30 + nameSize + extraSize + entry.compressedSize;
      if (end > this.central.offset) fail('ZIP_ENTRY_RANGE');
      if (!entry.bitFlag.dataDescriptor && local.readUInt32LE(14) !== entry.signature) fail('ZIP_LOCAL_CRC_MISMATCH');
      if (!entry.bitFlag.dataDescriptor) {
        let compressed = local.readUInt32LE(18), expanded = local.readUInt32LE(22);
        if (compressed === 0xffffffff || expanded === 0xffffffff) {
          const extra = await this.reader.readUint8Array(entry.offset + 30 + nameSize, extraSize);
          let found = false;
          for (let at = 0; at + 4 <= extra.length;) {
            const tag = extra.readUInt16LE(at), size = extra.readUInt16LE(at+2); at+=4;
            if (at+size>extra.length) fail('ZIP_LOCAL_EXTRA_INVALID');
            if(tag===1){let pos=at; if(expanded===0xffffffff){if(pos+8>at+size)fail('ZIP64_LOCAL_INVALID');expanded=Number(extra.readBigUInt64LE(pos));pos+=8;}
              if(compressed===0xffffffff){if(pos+8>at+size)fail('ZIP64_LOCAL_INVALID');compressed=Number(extra.readBigUInt64LE(pos));}found=true;break;}at+=size;
          }
          if(!found)fail('ZIP64_LOCAL_MISSING');
        }
        if(compressed!==entry.compressedSize||expanded!==entry.uncompressedSize)fail('ZIP_LOCAL_SIZE_MISMATCH');
      }
      if (entry.bitFlag.dataDescriptor) {
        const descriptor=await this.reader.readUint8Array(end,Math.min(24,this.central.offset-end));
        const matches=[];let crcMatch=false;
        for(const offset of [0,4]){
          if(offset&&descriptor.readUInt32LE(0)!==0x08074b50)continue;
          if(descriptor.length<offset+12||descriptor.readUInt32LE(offset)!==entry.signature)continue;
          crcMatch=true;
          if(!entry.zip64&&descriptor.readUInt32LE(offset+4)===entry.compressedSize&&descriptor.readUInt32LE(offset+8)===entry.uncompressedSize)matches.push(offset+12);
          else if(descriptor.length>=offset+20&&Number(descriptor.readBigUInt64LE(offset+4))===entry.compressedSize&&Number(descriptor.readBigUInt64LE(offset+12))===entry.uncompressedSize)matches.push(offset+20);
        }
        if(!matches.length)fail(crcMatch?'ZIP_DESCRIPTOR_SIZE_MISMATCH':'ZIP_DESCRIPTOR_CRC_MISMATCH');
        if(matches.length!==1)fail('ZIP_DESCRIPTOR_AMBIGUOUS');
        end+=matches[0];
      }
      ranges.push([start, end]);
      if (entry.directory) directories++;
      const blockedReason = entry.uncompressedSize > LIMITS.entryBytes || entry.compressedSize > LIMITS.compressedEntryBytes
        ? 'ZIP_ENTRY_READ_LIMIT' : entry.uncompressedSize >= LIMITS.ratioFloor && entry.uncompressedSize / Math.max(1, entry.compressedSize) > LIMITS.ratio
          ? 'ZIP_ENTRY_COMPRESSION_RATIO' : null;
      this.entryIndex.set(path, { entry, info: { path, originalName: entry.filename, directory: entry.directory,
        compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize, encrypted: false, zip64: Boolean(entry.zip64), blockedReason } });
    }
    if (this.entryIndex.size !== this.central.count) fail('ZIP_ENTRY_COUNT_MISMATCH');
    ranges.sort((a,b) => a[0]-b[0]);
    for (let i=1;i<ranges.length;i++) if (ranges[i][0] < ranges[i-1][1]) fail('ZIP_ENTRY_OVERLAP');
    this.meta = { fileName: this.fileName, zipBytes: this.size, entryCount: this.entryIndex.size,
      fileCount: this.entryIndex.size-directories, dirCount: directories, totalUncompressedBytes: total,
      blockedReadCount: [...this.entryIndex.values()].filter(x=>x.info.blockedReason).length };
    return { meta: this.meta, warnings: this.meta.blockedReadCount?[{code:'ZIP_ENTRIES_READ_BLOCKED',message:`${this.meta.blockedReadCount} 件の大容量または高圧縮率の項目は読取上限により利用できません。`}]:[], entries: [] };
  }
  async listAllFilePaths() { return [...this.entryIndex].filter(([,v])=>!v.info.directory).map(([p])=>p); }
  async bytes(path, maxBytes = LIMITS.entryBytes) {
    if (this.closed) fail('ZIP_CLOSED');
    const item = this.entryIndex.get(safePath(path));
    if (!item || item.info.directory) fail('ZIP_ENTRY_NOT_FOUND', 404);
    const cap = boundedInteger(maxBytes, LIMITS.entryBytes, LIMITS.entryBytes);
    if (item.info.blockedReason) fail(item.info.blockedReason, 413);
    if (item.info.uncompressedSize > cap) fail('ZIP_ENTRY_READ_LIMIT', 413);
    const chunks = []; let size = 0;
    class CappedWriter extends zip.Writer {
      writeUint8Array(chunk) {
        size += chunk.byteLength;
        if (size > cap || size > item.info.uncompressedSize) fail('ZIP_ACTUAL_SIZE_LIMIT', 413);
        chunks.push(Buffer.from(chunk));
      }
      getData() { return null; }
    }
    const writer = new CappedWriter();
    await item.entry.getData(writer, { checkSignature: true, checkOverlappingEntry: true });
    if (size !== item.info.uncompressedSize) fail('ZIP_ACTUAL_SIZE_MISMATCH');
    return Buffer.concat(chunks, size);
  }
  // Text is an editable source artifact. Retain the BOM as U+FEFF rather than
  // letting the decoder silently consume it; JSONC parsing handles it separately.
  async readText(path, opts = {}) { return new TextDecoder(opts.encoding || 'utf-8', { fatal: true, ignoreBOM: true }).decode(await this.bytes(path, opts.maxBytes ?? LIMITS.textBytes)); }
  async readBlob(path, opts = {}) { return new Blob([await this.bytes(path, opts.maxBytes)], { type: opts.mimeType || '' }); }
  async close() { if (this.closed) return; this.closed = true; try { await this.archive?.close(); } finally { this.reader?.clear(); await this.handle?.close(); this.entryIndex.clear(); } }
}
