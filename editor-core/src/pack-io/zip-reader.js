/*
  zip-reader.js

  S018: ZIP handling wrapper with limits

  This module provides a small abstraction over the chosen ZIP library (zip.js)
  so later steps can build import/export flows without coupling the rest of the
  app to the library's raw API.

  Requirements (S018):
  - openFromFile(file)
  - listEntries()
  - readText(path)
  - readBlob(path)
  - Enforce size/entry limits (zip-bomb mitigation)

  S057: Performance hardening
  - Enable zip.js web workers (when supported) to keep decompression off the main thread.
  - Add bounded read caches (text/blob) and in-flight read dedupe to reduce repeated work.
  - Replace "every N entries" yields with time-based yields to avoid long tasks on very large packs.
*/

import { normalizeZipPath } from '../path/normalize-zip-path.js';
import { DEFAULT_ZIP_LIMITS } from './zip-limits.js';

/**
 * @typedef {{
 *  path: string,
 *  originalName: string,
 *  directory: boolean,
 *  compressedSize: number,
 *  uncompressedSize: number,
 *  encrypted: boolean,
 *  zip64: boolean,
 *  blockedReason?: string,
 * }} ZipEntryInfo
 */

/**
 * @typedef {{
 *  fileName: string,
 *  zipBytes: number,
 *  entryCount: number,
 *  fileCount: number,
 *  dirCount: number,
 *  totalUncompressedBytes: number,
 *  blockedReadCount: number,
 * }} ZipListingMeta
 */

/**
 * @typedef {{
 *  code: string,
 *  message: string,
 *  path?: string,
 * }} ZipWarning
 */

/**
 * Get the global zip.js object.
 *
 * In this buildless setup, zip.js is loaded by app/index.html as a regular script.
 * The library attaches itself to window.zip.
 *
 * @returns {any}
 */
function getZipLib() {
  const z = globalThis.zip;
  if (!z) {
    throw new Error('ZIP_LIB_NOT_LOADED');
  }
  if (!z.ZipReader || !z.BlobReader) {
    throw new Error('ZIP_LIB_MISSING_REQUIRED_EXPORTS');
  }
  return z;
}

function nowMs() {
  try {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    // ignore
  }
  return Date.now();
}

/** @returns {Promise<void>} */
function yieldToMain() {
  return new Promise((resolve) => {
    try {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
        return;
      }
    } catch {
      // ignore
    }
    setTimeout(resolve, 0);
  });
}

/**
 * @param {number} n
 * @param {number} min
 * @param {number} max
 */
function clampInt(n, min, max) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

const YIELD_EVERY_MS = 12;

// --- zip.js web worker configuration -------------------------------------

let didAttemptZipConfigure = false;
let didConfigureZipWorkers = false;

/**
 * Best-effort: derive the zip.js distribution base URL from the loaded script tag.
 *
 * Example:
 *  script src = ../vendor/zip.js-2.8.16/zip.min.js
 *  base       = ../vendor/zip.js-2.8.16/
 *
 * @returns {string|null}
 */
function guessZipJsDistBaseUrlFromScripts() {
  try {
    if (typeof document === 'undefined' || !document || !document.scripts) return null;
    const scripts = Array.from(document.scripts);
    const s = scripts.find((el) => {
      if (!el || typeof el.src !== 'string') return false;
      return (
        el.src.includes('/vendor/zip.js-2.8.16/zip.min.js') ||
        (el.src.includes('@zip.js/zip.js') && el.src.includes('/dist/'))
      );
    });
    if (!s || !s.src) return null;
    if (s.src.includes('/vendor/zip.js-2.8.16/zip.min.js')) {
      return new URL('./', s.src).href;
    }
    const idx = s.src.indexOf('/dist/');
    if (idx < 0) return null;
    return s.src.slice(0, idx + '/dist/'.length);
  } catch {
    return null;
  }
}

/**
 * @returns {string}
 */
function defaultZipJsWorkerUrl() {
  // Fallback used when we can't derive the distribution base URL from script tags.
  // Keep this aligned with app/index.html's vendored zip.js version.
  try {
    return new URL('../vendor/zip.js-2.8.16/zip-web-worker.js', document.baseURI).href;
  } catch {
    return '../vendor/zip.js-2.8.16/zip-web-worker.js';
  }
}

/**
 * Configure zip.js to use explicit worker script URLs (CSP-friendly) when possible.
 *
 * zip.js can also create workers from Blob URLs by default, but explicit URLs are:
 * - easier to reason about
 * - compatible with strict CSP that disallows `blob:` in worker-src
 *
 * This is best-effort and must never block ZIP usage if configuration fails.
 *
 * @param {any} zip
 * @param {boolean} enabled
 */
function ensureZipWorkersConfigured(zip, enabled) {
  if (!enabled) return;
  if (didConfigureZipWorkers) return;
  if (typeof Worker === 'undefined') return;

  // Only attempt once per page load to avoid repeated overhead/spam.
  if (didAttemptZipConfigure) return;
  didAttemptZipConfigure = true;

  try {
    if (!zip || typeof zip.configure !== 'function') return;

    const base = guessZipJsDistBaseUrlFromScripts();
    // Only configure explicit URIs when we can reliably infer the correct /dist/ base URL.
    // Otherwise, let zip.js fall back to its internal defaults.
    if (!base) return;

    const workerURI = `${base}zip-web-worker.js`;
    const wasmURI = `${base}zip-module.wasm`;

    const hc = (() => {
      try {
        // hardwareConcurrency can be undefined in some environments.
        return Number(globalThis.navigator && globalThis.navigator.hardwareConcurrency) || 4;
      } catch {
        return 4;
      }
    })();

    // Cap worker count to avoid CPU saturation on very high-core machines.
    const maxWorkers = clampInt(hc, 1, 4);

    zip.configure({
      useWebWorkers: true,
      maxWorkers,
      workerURI,
      wasmURI,
    });

    didConfigureZipWorkers = true;
  } catch {
    // Swallow configuration errors (still allow zip operations).
    didConfigureZipWorkers = false;
  }
}

// --- bounded read caches --------------------------------------------------

/**
 * Minimal LRU cache with byte and entry budgets.
 *
 * Used for:
 * - small JSON/text files (ui screens, defs, vars, lang tables)
 * - small blobs that are read frequently (optional)
 */
class ReadLruCache {
  /**
   * @param {{ maxEntries: number, maxBytes: number }} limits
   */
  constructor(limits) {
    this.maxEntries = clampInt(limits.maxEntries, 0, 1_000_000);
    this.maxBytes = clampInt(limits.maxBytes, 0, 2_147_483_647);
    /** @type {Map<string, { value: any, bytes: number }>} */
    this.map = new Map();
    this.totalBytes = 0;
  }

  /**
   * @param {string} key
   */
  get(key) {
    const rec = this.map.get(key);
    if (!rec) return null;
    // Refresh LRU position.
    this.map.delete(key);
    this.map.set(key, rec);
    return rec.value;
  }

  /**
   * @param {string} key
   * @param {any} value
   * @param {number} bytes
   */
  set(key, value, bytes) {
    if (this.maxEntries <= 0 || this.maxBytes <= 0) return;

    const b = clampInt(bytes, 0, 2_147_483_647);
    if (b > this.maxBytes) return;

    const existing = this.map.get(key);
    if (existing) {
      this.map.delete(key);
      this.totalBytes -= clampInt(existing.bytes, 0, 2_147_483_647);
    }

    this.map.set(key, { value, bytes: b });
    this.totalBytes += b;
    this.evictIfNeeded();
  }

  evictIfNeeded() {
    while (this.map.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const first = this.map.entries().next().value;
      if (!first) break;
      const [k, rec] = first;
      this.map.delete(k);
      this.totalBytes -= clampInt(rec && rec.bytes ? rec.bytes : 0, 0, 2_147_483_647);
    }
  }

  clear() {
    this.map.clear();
    this.totalBytes = 0;
  }

  snapshot() {
    return {
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      entryCount: this.map.size,
      totalBytes: this.totalBytes,
    };
  }
}

const DEFAULT_READ_CACHE_LIMITS = Object.freeze({
  // Cache small text reads (UI JSON, defs, vars, lang tables).
  text: {
    maxEntries: 256,
    maxBytes: 8 * 1024 * 1024, // 8 MiB
    maxEntryBytes: 512 * 1024, // only cache files <= 512 KiB
  },
  // Cache small blob reads (optional; keeps memory bounded).
  blob: {
    maxEntries: 128,
    maxBytes: 32 * 1024 * 1024, // 32 MiB
    maxEntryBytes: 2 * 1024 * 1024, // only cache blobs <= 2 MiB
  },
});

// Vendored zip.js 2.8.16 calls its CRC-32 gate "checkSignature". Newer
// documentation may call the equivalent option "checkCrc32"; do not rename
// this until the vendored dependency is upgraded and an actual corrupt-CRC
// integration test passes with the new option.
export const ZIP_READER_INTEGRITY_OPTIONS = Object.freeze({
  checkSignature: true,
  checkOverlappingEntry: true,
});

// --- ZipReader -----------------------------------------------------------

/**
 * Safe wrapper around zip.js.
 */
export class ZipReader {
  /**
   * @param {{ limits?: Partial<typeof DEFAULT_ZIP_LIMITS> }} [options]
   */
  constructor(options = {}) {
    this.limits = { ...DEFAULT_ZIP_LIMITS, ...(options.limits || {}) };
    this.file = null;
    this.zipReader = null;
    /** @type {Map<string, { entry: any, info: ZipEntryInfo }>|null} */
    this.entryIndex = null;
    /** @type {ZipListingMeta|null} */
    this.meta = null;
    /** @type {ZipWarning[]} */
    this.warnings = [];

    // Bounded read caches + in-flight dedupe to reduce repeated decompression work.
    this.textCache = new ReadLruCache(DEFAULT_READ_CACHE_LIMITS.text);
    this.blobCache = new ReadLruCache(DEFAULT_READ_CACHE_LIMITS.blob);
    /** @type {Map<string, Promise<string>>} */
    this.inflightTextReads = new Map();
    /** @type {Map<string, Promise<Blob>>} */
    this.inflightBlobReads = new Map();

    this.stats = {
      configuredWorkers: false,
      cacheHitsText: 0,
      cacheHitsBlob: 0,
      cacheMissText: 0,
      cacheMissBlob: 0,
    };
  }

  /**
   * Open a zip from an uploaded File.
   * @param {File} file
   */
  async openFromFile(file) {
    if (!file) throw new Error('ZIP_OPEN_MISSING_FILE');
    if (typeof file.size !== 'number') throw new Error('ZIP_OPEN_INVALID_FILE');

    // Reset any previous state.
    await this.close();

    if (file.size > this.limits.maxZipBytes) {
      throw new Error('ZIP_TOO_LARGE');
    }

    const zip = getZipLib();
    this.file = file;
    this.warnings = [];

    const useWorkers = Boolean(this.limits.useWebWorkers && typeof Worker !== 'undefined');
    this.stats.configuredWorkers = useWorkers;

    // Best-effort configuration (explicit worker script URL) to keep decompression off the main thread.
    ensureZipWorkersConfigured(zip, useWorkers);

    this.zipReader = new zip.ZipReader(new zip.BlobReader(file), {
      useWebWorkers: useWorkers,
      ...ZIP_READER_INTEGRITY_OPTIONS,
    });

    // Index is built lazily on listEntries/read.
    this.entryIndex = null;
    this.meta = null;

    // Reset read caches.
    this.textCache.clear();
    this.blobCache.clear();
    this.inflightTextReads.clear();
    this.inflightBlobReads.clear();
    this.stats.cacheHitsText = 0;
    this.stats.cacheHitsBlob = 0;
    this.stats.cacheMissText = 0;
    this.stats.cacheMissBlob = 0;
  }

  /**
   * Close the underlying zip reader and release references.
   */
  async close() {
    try {
      if (this.zipReader && typeof this.zipReader.close === 'function') {
        await this.zipReader.close();
      }
    } finally {
      this.zipReader = null;
      this.file = null;
      this.entryIndex = null;
      this.meta = null;
      this.warnings = [];

      this.textCache.clear();
      this.blobCache.clear();
      this.inflightTextReads.clear();
      this.inflightBlobReads.clear();
    }
  }

  /**
   * List entries while enforcing safety limits.
   *
   * Note: This will scan all entries to compute totals and detect forbidden conditions.
   * The returned `entries` list is intentionally limited (preview) to keep memory small.
   *
   * @param {{ previewLimit?: number, signal?: AbortSignal, onProgress?: (progress: { phase: string, processed: number, total: number|null, zipBytes: number }) => void }} [options]
   * @returns {Promise<{ meta: ZipListingMeta, entries: ZipEntryInfo[], warnings: ZipWarning[], truncated: boolean }>}
   */
  async listEntries(options = {}) {
    if (options.signal?.aborted) throw new Error('ZIP_LIST_ABORTED');
    if (!this.zipReader || !this.file) {
      throw new Error('ZIP_NOT_OPEN');
    }
    if (this.entryIndex) {
      const previewLimit = Number.isFinite(options.previewLimit)
        ? Math.max(0, Number(options.previewLimit))
        : 200;

      /** @type {ZipEntryInfo[]} */
      const preview = [];
      for (const rec of this.entryIndex.values()) {
        preview.push(rec.info);
        if (preview.length >= previewLimit) break;
      }

      return {
        meta: this.meta,
        entries: preview,
        warnings: this.warnings.slice(),
        truncated: this.entryIndex.size > previewLimit,
      };
    }

    const previewLimit = Number.isFinite(options.previewLimit)
      ? Math.max(0, Number(options.previewLimit))
      : 200;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    /** @type {Map<string, { entry: any, info: ZipEntryInfo }>} */
    const index = new Map();
    /** @type {ZipEntryInfo[]} */
    const preview = [];

    /** @type {ZipListingMeta} */
    const meta = {
      fileName: String(this.file.name || 'uploaded.zip'),
      zipBytes: Number(this.file.size || 0),
      entryCount: 0,
      fileCount: 0,
      dirCount: 0,
      totalUncompressedBytes: 0,
      blockedReadCount: 0,
    };

    const getGenerator = this.zipReader.getEntriesGenerator
      ? () => this.zipReader.getEntriesGenerator()
      : async function* fallbackGetEntriesGenerator() {
        const entries = await this.zipReader.getEntries();
        for (const e of entries) yield e;
      }.bind(this);

    try {
      let lastYieldMs = nowMs();
      for await (const entry of getGenerator()) {
        if (options.signal?.aborted) throw new Error('ZIP_LIST_ABORTED');
        meta.entryCount += 1;
        if (meta.entryCount > this.limits.maxEntryCount) {
          throw new Error('ZIP_TOO_MANY_ENTRIES');
        }

        const originalName = String(entry.filename || '');
        const directory = Boolean(entry.directory);
        const compressedSize = Number(entry.compressedSize || 0);
        const uncompressedSize = Number(entry.uncompressedSize || 0);
        const encrypted = Boolean(entry.encrypted);
        const zip64 = Boolean(entry.zip64);

        if (encrypted && !this.limits.allowEncryptedZip) {
          throw new Error('ZIP_ENCRYPTED_NOT_ALLOWED');
        }

        let path;
        try {
          path = normalizeZipPath(originalName);
        } catch (e) {
          const code = e instanceof Error ? e.message : 'ZIP_PATH_NORMALIZE_FAILED';
          throw new Error(`ZIP_ENTRY_INVALID_PATH:${code}`);
        }

        if (index.has(path)) {
          throw new Error('ZIP_DUPLICATE_PATH_AFTER_NORMALIZATION');
        }

        if (directory) meta.dirCount += 1;
        else meta.fileCount += 1;

        if (!directory) {
          meta.totalUncompressedBytes += uncompressedSize;
          if (meta.totalUncompressedBytes > this.limits.maxTotalUncompressedBytes) {
            throw new Error('ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE');
          }
        }

        let blockedReason;

        // Zip bomb heuristic: suspiciously high compression ratio.
        if (!directory && uncompressedSize > 0) {
          const denom = Math.max(1, compressedSize);
          const ratio = uncompressedSize / denom;
          if (ratio > this.limits.maxCompressionRatioPerEntry) {
            blockedReason = 'SUSPICIOUS_COMPRESSION_RATIO';
            meta.blockedReadCount += 1;
            this.warnings.push({
              code: 'ZIP_ENTRY_SUSPICIOUS_RATIO',
              message: `Entry has suspicious compression ratio (~${ratio.toFixed(2)}). Reads are blocked.`,
              path,
            });
          }
        }

        // Read budget: extremely large entries are blocked from read* methods.
        if (!directory && uncompressedSize > this.limits.maxEntryUncompressedBytesForRead) {
          blockedReason = blockedReason || 'ENTRY_TOO_LARGE_FOR_READ';
          if (!blockedReason.includes('SUSPICIOUS')) {
            meta.blockedReadCount += 1;
          }
          this.warnings.push({
            code: 'ZIP_ENTRY_TOO_LARGE_FOR_READ',
            message: `Entry is larger than read budget (${uncompressedSize} bytes). Reads are blocked.`,
            path,
          });
        }

        /** @type {ZipEntryInfo} */
        const info = {
          path,
          originalName,
          directory,
          compressedSize,
          uncompressedSize,
          encrypted,
          zip64,
          ...(blockedReason ? { blockedReason } : {}),
        };

        index.set(path, { entry, info });
        if (preview.length < previewLimit) preview.push(info);

        // Avoid long tasks for very large zips.
        const now = nowMs();
        if (now - lastYieldMs >= YIELD_EVERY_MS) {
          if (onProgress) {
            onProgress({
              phase: 'index',
              processed: meta.entryCount,
              total: null,
              zipBytes: meta.zipBytes,
            });
          }
          await yieldToMain();
          lastYieldMs = nowMs();
        }
      }
      if (options.signal?.aborted) throw new Error('ZIP_LIST_ABORTED');
      if (onProgress) {
        onProgress({
          phase: 'index-complete',
          processed: meta.entryCount,
          total: meta.entryCount,
          zipBytes: meta.zipBytes,
        });
      }
    } catch (e) {
      // Ensure we don't keep a partially-open reader around on errors.
      await this.close();
      throw e;
    }

    this.entryIndex = index;
    this.meta = meta;

    return {
      meta,
      entries: preview,
      warnings: this.warnings.slice(),
      truncated: index.size > previewLimit,
    };
  }

  /**
   * Read an entry as text (with bounded cache + in-flight dedupe).
   *
   * @param {string} rawPath
   * @param {{ encoding?: string, maxBytes?: number, signal?: AbortSignal }} [options]
   */
  async readText(rawPath, options = {}) {
    if (options.signal?.aborted) throw new Error('ZIP_READ_ABORTED');
    const encoding = options.encoding || 'utf-8';
    const maxBytes = Number.isFinite(options.maxBytes)
      ? Math.max(0, Number(options.maxBytes))
      : this.limits.maxTextFileBytesForRead;

    const { entry, info } = await this.getEntryForRead(rawPath, maxBytes, 'text');

    const cacheKey = `${info.path}|${String(encoding)}`;
    const cached = this.textCache.get(cacheKey);
    if (cached !== null) {
      this.stats.cacheHitsText += 1;
      return cached;
    }
    this.stats.cacheMissText += 1;

    const inflight = this.inflightTextReads.get(cacheKey);
    if (inflight) return inflight;

    const zip = getZipLib();
    const useWorkers = Boolean(this.limits.useWebWorkers && typeof Worker !== 'undefined');
    const promise = (async () => {
      const txt = await entry.getData(new zip.TextWriter(encoding), {
        useWebWorkers: useWorkers,
        signal: options.signal || undefined,
      });
      if (options.signal?.aborted) throw new Error('ZIP_READ_ABORTED');

      // Cache only small-ish files to keep memory bounded.
      const maxEntryBytes = DEFAULT_READ_CACHE_LIMITS.text.maxEntryBytes;
      const approxBytes = clampInt(info.uncompressedSize || 0, 0, 2_147_483_647);
      if (approxBytes > 0 && approxBytes <= maxEntryBytes && approxBytes <= maxBytes) {
        this.textCache.set(cacheKey, txt, approxBytes);
      }
      return txt;
    })();

    this.inflightTextReads.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inflightTextReads.delete(cacheKey);
    }
  }

  /**
   * Read an entry as a Blob (with bounded cache + in-flight dedupe).
   *
   * @param {string} rawPath
   * @param {{ mimeType?: string, maxBytes?: number, signal?: AbortSignal }} [options]
   */
  async readBlob(rawPath, options = {}) {
    if (options.signal?.aborted) throw new Error('ZIP_READ_ABORTED');
    const mimeType = options.mimeType || 'application/octet-stream';
    const maxBytes = Number.isFinite(options.maxBytes)
      ? Math.max(0, Number(options.maxBytes))
      : this.limits.maxEntryUncompressedBytesForRead;

    const { entry, info } = await this.getEntryForRead(rawPath, maxBytes, 'blob');

    const cacheKey = `${info.path}|${String(mimeType)}`;
    const cached = this.blobCache.get(cacheKey);
    if (cached !== null) {
      this.stats.cacheHitsBlob += 1;
      return cached;
    }
    this.stats.cacheMissBlob += 1;

    const inflight = this.inflightBlobReads.get(cacheKey);
    if (inflight) return inflight;

    const zip = getZipLib();
    const useWorkers = Boolean(this.limits.useWebWorkers && typeof Worker !== 'undefined');
    const promise = (async () => {
      const blob = await entry.getData(new zip.BlobWriter(mimeType), {
        useWebWorkers: useWorkers,
        signal: options.signal || undefined,
      });
      if (options.signal?.aborted) throw new Error('ZIP_READ_ABORTED');

      // Cache only small-ish blobs to keep memory bounded.
      const maxEntryBytes = DEFAULT_READ_CACHE_LIMITS.blob.maxEntryBytes;
      const approxBytes = clampInt(info.uncompressedSize || 0, 0, 2_147_483_647);
      if (approxBytes > 0 && approxBytes <= maxEntryBytes && approxBytes <= maxBytes) {
        this.blobCache.set(cacheKey, blob, approxBytes);
      }
      return blob;
    })();

    this.inflightBlobReads.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inflightBlobReads.delete(cacheKey);
    }
  }

  /**
   * @param {string} rawPath
   * @param {number} maxBytes
   * @param {'text'|'blob'} kind
   * @returns {Promise<{ entry: any, info: ZipEntryInfo }>}
   */
  async getEntryForRead(rawPath, maxBytes, kind) {
    if (!this.zipReader || !this.file) {
      throw new Error('ZIP_NOT_OPEN');
    }
    if (!this.entryIndex) {
      // Build index (no preview needed).
      await this.listEntries({ previewLimit: 0 });
    }

    let path;
    try {
      path = normalizeZipPath(String(rawPath || ''));
    } catch (e) {
      const code = e instanceof Error ? e.message : 'ZIP_PATH_NORMALIZE_FAILED';
      throw new Error(`ZIP_READ_INVALID_PATH:${code}`);
    }

    const rec = this.entryIndex.get(path);
    if (!rec) throw new Error('ZIP_ENTRY_NOT_FOUND');

    const info = rec.info;
    if (info.directory) throw new Error('ZIP_ENTRY_IS_DIRECTORY');
    if (info.encrypted) throw new Error('ZIP_ENTRY_ENCRYPTED');
    if (info.blockedReason) {
      throw new Error(`ZIP_ENTRY_READ_BLOCKED:${info.blockedReason}`);
    }
    if (info.uncompressedSize > maxBytes) {
      throw new Error(`ZIP_ENTRY_TOO_LARGE_FOR_${kind.toUpperCase()}`);
    }

    return { entry: rec.entry, info };
  }

  /**
   * List all normalized entry paths.
   *
   * This forces index creation (but does NOT extract file contents).
   *
   * WARNING: For very large ZIPs, the returned array may be large.
   * Later steps may introduce streaming/partial listing as needed.
   *
   * @param {{ includeDirectories?: boolean }} [options]
   * @returns {Promise<string[]>}
   */
  async listAllFilePaths(options = {}) {
    if (!this.zipReader || !this.file) {
      throw new Error('ZIP_NOT_OPEN');
    }

    if (!this.entryIndex) {
      // Build index (no preview needed).
      await this.listEntries({ previewLimit: 0 });
    }

    const includeDirectories = Boolean(options && options.includeDirectories);

    /** @type {string[]} */
    const out = [];

    let lastYieldMs = nowMs();
    for (const rec of this.entryIndex.values()) {
      if (includeDirectories || !rec.info.directory) {
        out.push(rec.info.path);
      }

      const now = nowMs();
      if (now - lastYieldMs >= YIELD_EVERY_MS) {
        await yieldToMain();
        lastYieldMs = nowMs();
      }
    }

    // Deterministic order.
    out.sort();
    return out;
  }

  /**
   * Expose internal budgets for debugging (optional).
   */
  getDebugStats() {
    return {
      configuredWorkers: this.stats.configuredWorkers,
      caches: {
        text: this.textCache.snapshot(),
        blob: this.blobCache.snapshot(),
      },
      cacheHits: {
        text: this.stats.cacheHitsText,
        blob: this.stats.cacheHitsBlob,
      },
      cacheMiss: {
        text: this.stats.cacheMissText,
        blob: this.stats.cacheMissBlob,
      },
    };
  }
}
