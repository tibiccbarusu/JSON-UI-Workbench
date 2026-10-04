/*
  font-face-cache.js (S042)

  Load and cache FontFace objects for canvas text rendering.

  Goals
  - Provide a small bounded cache for dynamically loaded fonts.
  - Deduplicate in-flight loads by key ("source:packPath").
  - Provide a negative cache for repeated failures.
  - Best-effort removal from document.fonts on eviction.

  Non-goals
  - Perfect Bedrock parity for font fallback.
  - Parsing font metadata files.

  Notes
  - The cache budget is in *compressed font bytes* (Blob.size). This is not a
    perfect proxy for memory, but it is stable and avoids large unbounded loads.
  - Browser behavior around unloading fonts varies. We try document.fonts.delete
    on eviction, but do not rely on it.
*/

/**
 * Default cache budgets.
 *
 * NOTE: These are intentionally small; fonts are usually not huge, and the
 * editor should not keep unbounded font data alive.
 */
export const DEFAULT_FONT_CACHE_BUDGETS = Object.freeze({
  desktopMaxBytesTotal: 33_554_432, // 32 MiB
  mobileMaxBytesTotal: 16_777_216, // 16 MiB
});

/**
 * Hard-ish limits for a single font load.
 */
export const DEFAULT_FONT_LOAD_LIMITS = Object.freeze({
  perFontMaxBytes: 8_388_608, // 8 MiB
});

/**
 * @typedef {{
 *  code: string,
 *  message: string,
 *  atMs: number,
 * }} NegativeCacheEntry
 */

/**
 * @typedef {{
 *  key: string,
 *  family: string,
 *  face: FontFace,
 *  bytes: number,
 *  createdAtMs: number,
 * }} FontFaceCacheEntry
 */

/**
 * @typedef {{
 *  maxEntries?: number,
 *  maxBytesTotal?: number,
 *  negativeTtlMs?: number,
 *  perFontMaxBytes?: number,
 *  loadTimeoutMs?: number,
 *  maxInflight?: number,
 * }} FontFaceCacheOptions
 */

/**
 * Best-effort removal from document.fonts.
 * @param {FontFaceCacheEntry} entry
 */
function tryUnregisterFontFace(entry) {
  try {
    if (typeof document === 'undefined') return;
    const set = document.fonts;
    if (!set) return;
    if (typeof set.delete === 'function') {
      set.delete(entry.face);
    }
  } catch {
    // ignore
  }
}

/**
 * Create a bounded LRU cache for FontFace objects.
 *
 * @param {FontFaceCacheOptions} [options]
 */
export function createFontFaceCache(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, Number(options.maxEntries)) : 64;
  const maxBytesTotal = Number.isFinite(options.maxBytesTotal) ? Math.max(1, Number(options.maxBytesTotal)) : DEFAULT_FONT_CACHE_BUDGETS.desktopMaxBytesTotal;
  const negativeTtlMs = Number.isFinite(options.negativeTtlMs) ? Math.max(0, Number(options.negativeTtlMs)) : 30_000;
  const perFontMaxBytes = Number.isFinite(options.perFontMaxBytes) ? Math.max(1, Number(options.perFontMaxBytes)) : DEFAULT_FONT_LOAD_LIMITS.perFontMaxBytes;
  const loadTimeoutMs = Number.isFinite(options.loadTimeoutMs) ? Math.max(1, Number(options.loadTimeoutMs)) : 20_000;
  const maxInflight = Number.isFinite(options.maxInflight) ? Math.max(1, Number(options.maxInflight)) : 8;

  /** @type {Map<string, FontFaceCacheEntry>} */
  const lru = new Map();
  /** @type {Map<string, Promise<FontFaceCacheEntry>>} */
  const inflight = new Map();
  /** @type {Map<string, NegativeCacheEntry>} */
  const negative = new Map();

  let totalBytes = 0;
  let generation = 0;

  function pruneNegative(nowMs) {
    const now = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
    for (const [k, v] of negative.entries()) {
      if (!v) {
        negative.delete(k);
        continue;
      }
      if (now - Number(v.atMs || 0) > negativeTtlMs) {
        negative.delete(k);
      }
    }
  }

  function evictAsNeeded() {
    // Evict by LRU order (Map iteration order = insertion order).
    while (lru.size > maxEntries || totalBytes > maxBytesTotal) {
      const oldestKey = lru.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      const entry = lru.get(oldestKey);
      lru.delete(oldestKey);
      if (entry) {
        totalBytes = Math.max(0, totalBytes - (Number(entry.bytes) || 0));
        tryUnregisterFontFace(entry);
      }
    }
  }

  /**
   * @param {string} key
   */
  function get(key) {
    const k = String(key || '');
    const entry = lru.get(k) || null;
    if (!entry) return null;
    // Refresh LRU position.
    lru.delete(k);
    lru.set(k, entry);
    return entry;
  }

  /**
   * @param {string} key
   */
  function isLoading(key) {
    return inflight.has(String(key || ''));
  }

  /**
   * @param {string} key
   */
  function getFailure(key) {
    pruneNegative(Date.now());
    return negative.get(String(key || '')) || null;
  }

  /**
   * Load or return a cached FontFace.
   *
   * The loader must perform:
   * - reading the Blob / ArrayBuffer
   * - constructing a FontFace
   * - awaiting face.load()
   * - adding it to document.fonts (if available)
   *
   * And return: { family, face, bytes }
   *
   * @param {string} key
   * @param {(signal: AbortSignal) => Promise<{ family: string, face: FontFace, bytes?: number }>} loader
   */
  function load(key, loader) {
    const k = String(key || '');
    const cached = get(k);
    if (cached) return Promise.resolve(cached);

    const fail = getFailure(k);
    if (fail) return Promise.reject(new Error(fail.code || 'FONT_LOAD_FAILED'));

    const infl = inflight.get(k);
    if (infl) return infl;
    if (inflight.size >= maxInflight) return Promise.reject(new Error('FONT_LOAD_CONCURRENCY_LIMIT'));

    const loadGeneration = generation;
    const controller = new AbortController();
    let timer = null;
    let timedOut = false;
    const p = Promise.resolve()
      .then(async () => {
        if (typeof loader !== 'function') throw new Error('FONT_LOAD_MISSING_LOADER');
        const loaded = Promise.resolve(loader(controller.signal)).then((result) => {
          if (timedOut && result?.face) {
            tryUnregisterFontFace(result);
            throw new Error('FONT_LOAD_TIMEOUT');
          }
          return result;
        });
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true; controller.abort(); reject(new Error('FONT_LOAD_TIMEOUT'));
          }, loadTimeoutMs);
        });
        const result = await Promise.race([loaded, timeout]);
        if (!result || !result.face || !result.family) {
          if (result?.face) tryUnregisterFontFace(result);
          throw new Error('FONT_LOAD_INVALID_RESULT');
        }
        if (loadGeneration !== generation) {
          tryUnregisterFontFace({
            key: k,
            family: String(result.family),
            face: result.face,
            bytes: Number(result.bytes) || 0,
            createdAtMs: Date.now(),
          });
          throw new Error('FONT_LOAD_STALE_GENERATION');
        }

        const bytes = Number.isFinite(result.bytes) ? Number(result.bytes) : 0;
        if ((result.bytes !== undefined && !Number.isFinite(result.bytes)) || bytes < 0 || bytes > Math.min(perFontMaxBytes, maxBytesTotal)) {
          tryUnregisterFontFace(result);
          throw new Error('FONT_LOAD_TOO_LARGE');
        }

        /** @type {FontFaceCacheEntry} */
        const entry = {
          key: k,
          family: String(result.family),
          face: result.face,
          bytes: bytes,
          coverage: result.coverage || null,
          createdAtMs: Date.now(),
        };

        lru.set(k, entry);
        totalBytes += bytes;
        evictAsNeeded();

        return entry;
      })
      .catch((err) => {
        const code = err instanceof Error ? err.message : String(err || 'FONT_LOAD_FAILED');
        if (loadGeneration === generation) negative.set(k, { code, message: code, atMs: Date.now() });
        throw err;
      })
      .finally(() => {
        clearTimeout(timer);
        if (inflight.get(k) === p) inflight.delete(k);
      });

    inflight.set(k, p);
    return p;
  }

  function clear() {
    generation += 1;
    for (const entry of lru.values()) {
      if (entry) tryUnregisterFontFace(entry);
    }
    lru.clear();
    inflight.clear();
    negative.clear();
    totalBytes = 0;
  }

  return {
    get,
    load,
    isLoading,
    getFailure,
    clear,
    limits: {
      maxEntries,
      maxBytesTotal,
      perFontMaxBytes,
      negativeTtlMs,
      loadTimeoutMs,
      maxInflight,
    },
    stats() {
      pruneNegative(Date.now());
      return {
        entries: lru.size,
        inflight: inflight.size,
        negative: negative.size,
        totalBytes,
        generation,
      };
    },
  };
}
