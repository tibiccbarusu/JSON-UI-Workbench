/*
  http-pack-source.js (S023/S024)

  Remote PackSource implementation backed by fetch().

  S023: minimal HTTP reads for Vanilla reference packs hosted remotely.
  S024: add timeout, retry/backoff, in-memory caching, and in-flight request
       de-duplication.

  Security:
  - Only http(s) URLs are allowed.
  - Never sends credentials.
  - maxBytes is enforced best-effort.
*/

import { normalizePackPath } from '../path/normalize-pack-path.js';
import { PACK_NOT_FOUND, makePackError } from './pack-source.js';

/** @typedef {{ value: any, bytes: number, lastAccessMs: number }} CacheRec */

const PACK_HTTP_URL_OUTSIDE_BASE = 'PACK_HTTP_URL_OUTSIDE_BASE';
const PACK_HTTP_AMBIGUOUS_PATH_ENCODING = 'PACK_HTTP_AMBIGUOUS_PATH_ENCODING';

class LruCache {
  /**
   * @param {{ maxEntries: number, maxBytesTotal: number, label: string }} opts
   */
  constructor(opts) {
    this.label = String(opts?.label || 'cache');
    this.maxEntries = Math.max(0, Number(opts?.maxEntries || 0));
    this.maxBytesTotal = Math.max(0, Number(opts?.maxBytesTotal || 0));

    /** @type {Map<string, CacheRec>} */
    this.map = new Map();
    this.bytesTotal = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /** @param {string} key */
  get(key) {
    const k = String(key);
    const rec = this.map.get(k);
    if (!rec) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    rec.lastAccessMs = Date.now();
    // Refresh LRU order.
    this.map.delete(k);
    this.map.set(k, rec);
    return rec.value;
  }

  /** @param {string} key */
  has(key) {
    return this.map.has(String(key));
  }

  /**
   * @param {string} key
   * @param {any} value
   * @param {number} bytes
   */
  set(key, value, bytes) {
    const k = String(key);
    const b = Math.max(0, Number(bytes || 0));

    // If a single entry exceeds cache budget, do not store.
    if ((this.maxBytesTotal > 0 && b > this.maxBytesTotal) || this.maxEntries === 0) {
      return;
    }

    // Replace existing.
    const existing = this.map.get(k);
    if (existing) {
      this.bytesTotal -= existing.bytes;
      this.map.delete(k);
    }

    this.map.set(k, { value, bytes: b, lastAccessMs: Date.now() });
    this.bytesTotal += b;
    this._evictIfNeeded();
  }

  /** @param {string} key */
  delete(key) {
    const k = String(key);
    const existing = this.map.get(k);
    if (existing) {
      this.bytesTotal -= existing.bytes;
      this.map.delete(k);
    }
  }

  clear() {
    this.map.clear();
    this.bytesTotal = 0;
  }

  _evictIfNeeded() {
    if (this.maxEntries > 0) {
      while (this.map.size > this.maxEntries) {
        const firstKey = this.map.keys().next().value;
        if (firstKey === undefined) break;
        this.delete(firstKey);
        this.evictions += 1;
      }
    }
    if (this.maxBytesTotal > 0) {
      while (this.bytesTotal > this.maxBytesTotal) {
        const firstKey = this.map.keys().next().value;
        if (firstKey === undefined) break;
        this.delete(firstKey);
        this.evictions += 1;
      }
    }
  }

  getStats() {
    return {
      label: this.label,
      entries: this.map.size,
      bytesTotal: this.bytesTotal,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}

/**
 * Ensure a base URL ends with a slash so `new URL(relative, base)` works as expected.
 * @param {string} baseUrl
 */
function normalizeBaseUrl(baseUrl) {
  const s = String(baseUrl || '');
  if (!s) throw makePackError('PACK_HTTP_MISSING_BASE_URL');
  const url = new URL(s, globalThis.location ? globalThis.location.href : 'http://localhost/');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw makePackError('PACK_HTTP_INVALID_PROTOCOL', { data: { protocol: url.protocol } });
  }
  if (!url.href.endsWith('/')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  }
  return url;
}

/**
 * Assert that a URL remains on the configured origin and beneath its base
 * pathname. The trailing slash on baseUrl makes this a directory boundary,
 * so "/packs/base2/" does not match "/packs/base/".
 *
 * @param {string|URL} candidateUrl
 * @param {URL} baseUrl
 * @returns {URL}
 */
function assertUrlWithinBase(candidateUrl, baseUrl) {
  let candidate;
  try {
    candidate = candidateUrl instanceof URL
      ? candidateUrl
      : new URL(String(candidateUrl), baseUrl);
  } catch (cause) {
    throw makePackError('PACK_HTTP_INVALID_URL', { cause });
  }

  // Reject encodings that can become a dot segment, a path separator, a
  // second percent-encoding layer, or a control byte after server/proxy
  // decoding. Raw GitHub pack paths do not need these ambiguous forms.
  if (/%(?:0[0-9a-f]|1[0-9a-f]|25|2e|2f|5c|7f)/i.test(candidate.pathname)) {
    throw makePackError(PACK_HTTP_AMBIGUOUS_PATH_ENCODING, {
      data: { candidatePathname: candidate.pathname },
    });
  }

  const basePath = baseUrl.pathname.endsWith('/')
    ? baseUrl.pathname
    : `${baseUrl.pathname}/`;
  const sameOrigin = candidate.origin === baseUrl.origin;
  const withinPath = candidate.pathname.startsWith(basePath);

  if (!sameOrigin || !withinPath) {
    throw makePackError(PACK_HTTP_URL_OUTSIDE_BASE, {
      data: {
        candidateOrigin: candidate.origin,
        candidatePathname: candidate.pathname,
        baseOrigin: baseUrl.origin,
        basePathname: basePath,
      },
    });
  }

  return candidate;
}

/**
 * Resolve a normalized pack path and enforce containment after WHATWG URL
 * canonicalization (including percent-encoded dot-segment handling).
 *
 * @param {string} path
 * @param {URL} baseUrl
 */
function resolvePackUrl(path, baseUrl) {
  return assertUrlWithinBase(path, baseUrl);
}

/**
 * Validate the final response URL after redirects. Synthetic responses used by
 * tests may have an empty `.url`; in that case the already-validated request
 * URL is used.
 *
 * @param {any} response
 * @param {string} requestUrl
 * @param {URL} baseUrl
 */
function assertResponseUrlWithinBase(response, requestUrl, baseUrl) {
  const finalUrl = response && typeof response.url === 'string' && response.url
    ? response.url
    : requestUrl;
  assertUrlWithinBase(finalUrl, baseUrl);
}

/**
 * @param {number} ms
 * @param {AbortSignal|undefined} [signal]
 */
function sleep(ms, signal) {
  const t = Math.max(0, Number(ms || 0));
  if (!t) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makePackError('PACK_ABORTED'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, t);
    const onAbort = () => {
      clearTimeout(timer);
      reject(makePackError('PACK_ABORTED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Create a timeout signal.
 * Returns a signal + a cleanup callback.
 * @param {number} timeoutMs
 */
function createTimeoutSignal(timeoutMs) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return { signal: null, cleanup: () => {} };
  }

  // Use an owned timer instead of AbortSignal.timeout(). Besides allowing
  // deterministic cleanup, this behaves consistently in Node tests where the
  // platform timeout signal may use an unref'ed timer.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }, ms);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

/**
 * Combine multiple AbortSignals into one.
 * Returns a combined signal + cleanup callback.
 *
 * @param {(AbortSignal|null|undefined)[]} signals
 */
function combineSignals(signals) {
  const list = (Array.isArray(signals) ? signals : []).filter(Boolean);
  if (list.length === 0) return { signal: null, cleanup: () => {} };

  // Prefer AbortSignal.any() if available.
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any(list), cleanup: () => {} };
  }

  const controller = new AbortController();
  const onAbort = () => {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  };

  for (const s of list) {
    try {
      if (s.aborted) {
        onAbort();
        break;
      }
      s.addEventListener('abort', onAbort, { once: true });
    } catch {
      // ignore
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const s of list) {
        try {
          s.removeEventListener('abort', onAbort);
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * @param {any} err
 */
function isAbortError(err) {
  // Standard fetch abort.
  if (err && typeof err === 'object' && err.name === 'AbortError') return true;
  return false;
}

/**
 * Heuristic retryable HTTP statuses.
 * @param {number} status
 */
function isRetryableStatus(status) {
  // Conservative: retry common transient status codes.
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * @param {string} url
 * @param {{
 *  signal?: AbortSignal,
 *  timeoutMs?: number,
 *  maxRetries?: number,
 *  backoffBaseMs?: number,
 *  backoffMaxMs?: number,
 *  onAttempt?: (info: { attempt: number, url: string }) => void,
 *  onRetry?: (info: { attempt: number, url: string, delayMs: number, reason: string }) => void,
 *  validateResponseUrl?: (response: any, requestUrl: string) => void,
 * }} opts
 */
async function fetchWithRetry(url, opts) {
  const maxRetries = Math.max(0, Number(opts?.maxRetries ?? 0));
  const timeoutMs = Math.max(0, Number(opts?.timeoutMs ?? 0));
  const backoffBaseMs = Math.max(0, Number(opts?.backoffBaseMs ?? 200));
  const backoffMaxMs = Math.max(backoffBaseMs, Number(opts?.backoffMaxMs ?? 4000));

  /** @type {any} */
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (opts?.signal?.aborted) throw makePackError('PACK_ABORTED');

    if (typeof opts?.onAttempt === 'function') {
      try {
        opts.onAttempt({ attempt, url });
      } catch {
        // ignore
      }
    }

    const timeout = createTimeoutSignal(timeoutMs);
    const combined = combineSignals([opts?.signal || null, timeout.signal]);
    let response = null;

    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        signal: combined.signal || undefined,
      });
      response = res;
      if (typeof opts?.validateResponseUrl === 'function') {
        opts.validateResponseUrl(res, url);
      }
      if (res.status === 404) {
        timeout.cleanup();
        combined.cleanup();
        throw makePackError(PACK_NOT_FOUND, { data: { url, status: res.status } });
      }

      if (!res.ok) {
        if (attempt < maxRetries && isRetryableStatus(res.status)) {
          cancelBodyBestEffort(res.body, 'PACK_HTTP_RETRY');
          timeout.cleanup();
          combined.cleanup();
          const exp = Math.min(backoffMaxMs, backoffBaseMs * Math.pow(2, attempt));
          const jitter = Math.floor(Math.random() * Math.min(250, exp));
          const delayMs = Math.min(backoffMaxMs, exp + jitter);

          if (typeof opts?.onRetry === 'function') {
            try {
              opts.onRetry({ attempt, url, delayMs, reason: `HTTP_${res.status}` });
            } catch {
              // ignore
            }
          }

          await sleep(delayMs, opts?.signal);
          continue;
        }

        timeout.cleanup();
        combined.cleanup();
        throw makePackError('PACK_HTTP_BAD_STATUS', { data: { url, status: res.status } });
      }

      // The timeout and combined signal must remain active until the caller
      // finishes consuming the response body. Returning a cleanup handle makes
      // this lifetime explicit and testable.
      return {
        response: res,
        bodySignal: combined.signal || undefined,
        timeoutSignal: timeout.signal || undefined,
        cleanup: () => {
          timeout.cleanup();
          combined.cleanup();
        },
      };
    } catch (e) {
      cancelBodyBestEffort(response?.body, 'PACK_HTTP_FETCH_FAILED');
      timeout.cleanup();
      combined.cleanup();

      // If the caller aborted, do not retry.
      if (opts?.signal?.aborted) throw makePackError('PACK_ABORTED', { cause: e });

      // Distinguish timeout aborts vs other aborts.
      if (isAbortError(e)) {
        // In browsers with AbortSignal.timeout, aborts are still AbortError.
        // Treat as retryable if we have retries left.
        if (attempt < maxRetries) {
          const exp = Math.min(backoffMaxMs, backoffBaseMs * Math.pow(2, attempt));
          const jitter = Math.floor(Math.random() * Math.min(250, exp));
          const delayMs = Math.min(backoffMaxMs, exp + jitter);
          if (typeof opts?.onRetry === 'function') {
            try {
              opts.onRetry({ attempt, url, delayMs, reason: 'TIMEOUT_OR_ABORT' });
            } catch {
              // ignore
            }
          }
          await sleep(delayMs, opts?.signal);
          continue;
        }
        throw makePackError('PACK_HTTP_TIMEOUT', { cause: e, data: { url, timeoutMs } });
      }

      // Pack-not-found should not be retried.
      if (e instanceof Error && e.message === PACK_NOT_FOUND) {
        throw makePackError(PACK_NOT_FOUND, { cause: e, data: { url } });
      }

      // HTTP response statuses have already passed the explicit retry policy.
      // Deterministic statuses such as 400 must not become network retries.
      if (e instanceof Error && e.message === 'PACK_HTTP_BAD_STATUS') throw e;

      // A containment failure is deterministic and security-sensitive. Never
      // retry it as a transient network error.
      if (
        e instanceof Error
        && (e.message === PACK_HTTP_URL_OUTSIDE_BASE || e.message === PACK_HTTP_AMBIGUOUS_PATH_ENCODING)
      ) {
        throw e;
      }

      lastError = e;
      if (attempt < maxRetries) {
        const exp = Math.min(backoffMaxMs, backoffBaseMs * Math.pow(2, attempt));
        const jitter = Math.floor(Math.random() * Math.min(250, exp));
        const delayMs = Math.min(backoffMaxMs, exp + jitter);

        if (typeof opts?.onRetry === 'function') {
          try {
            opts.onRetry({ attempt, url, delayMs, reason: 'FETCH_THROW' });
          } catch {
            // ignore
          }
        }

        await sleep(delayMs, opts?.signal);
        continue;
      }

      throw makePackError('PACK_HTTP_FETCH_FAILED', { cause: lastError, data: { url } });
    }
  }

  // Should be unreachable.
  throw makePackError('PACK_HTTP_FETCH_FAILED', { cause: lastError, data: { url } });
}

/**
 * @param {any} res
 * @param {number} maxBytes
 */
function enforceContentLengthHeader(res, maxBytes) {
  if (!maxBytes || !Number.isFinite(maxBytes) || maxBytes <= 0) return;
  try {
    const raw = res.headers?.get?.('content-length');
    if (!raw) return;
    const n = Number(raw);
    if (Number.isFinite(n) && n > maxBytes) {
      throw makePackError('PACK_HTTP_TOO_LARGE', { data: { contentLength: n, maxBytes } });
    }
  } catch (e) {
    if (e instanceof Error) throw e;
  }
}

/**
 * @param {string} s
 */
function byteLengthUtf8(s) {
  try {
    return new TextEncoder().encode(String(s)).byteLength;
  } catch {
    // Fallback: approximate via UTF-16 code units (overestimates sometimes).
    return String(s).length * 2;
  }
}

/**
 * Await one stream read while still reacting to a timeout/caller abort even
 * when a synthetic test stream does not observe the fetch signal itself.
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {AbortSignal|undefined} signal
 */
function awaitBodyOperation(operation, signal) {
  if (!signal) return Promise.resolve().then(operation);
  if (signal.aborted) throw makePackError('PACK_HTTP_BODY_ABORTED');

  return new Promise((resolve, reject) => {
    const settle = (callback, value) => {
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => settle(reject, makePackError('PACK_HTTP_BODY_ABORTED'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw makePackError('PACK_HTTP_BODY_ABORTED');
      return operation();
    }).then(value => settle(resolve, value), error => settle(reject, error));
  });
}

async function readStreamChunk(reader, signal) {
  return awaitBodyOperation(() => reader.read(), signal);
}

/** Cleanup must not delay the primary error. A broken underlying source may
 * return a never-settling cancel promise; consume rejection without awaiting it. */
function cancelBodyBestEffort(body, reason) {
  try { Promise.resolve(body?.cancel?.(reason)).catch(() => {}); }
  catch { /* Preserve the original failure if cancellation throws synchronously. */ }
}

/**
 * Read a response body with a hard incremental byte limit.
 * @param {any} response
 * @param {number} maxBytes
 * @param {AbortSignal|undefined} signal
 * @param {'text'|'blob'} fallbackKind
 */
async function readResponseBytesBounded(response, maxBytes, signal, fallbackKind) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Number(maxBytes) : Number.POSITIVE_INFINITY;
  const reader = response?.body && typeof response.body.getReader === 'function'
    ? response.body.getReader()
    : null;

  if (!reader) {
    // Browser fetch responses expose a stream. This branch keeps deterministic
    // compatibility with minimal synthetic responses in the unit tests.
    let bytes;
    if (fallbackKind === 'text' && typeof response?.text === 'function') {
      bytes = new TextEncoder().encode(await awaitBodyOperation(() => response.text(), signal));
    } else if (typeof response?.blob === 'function') {
      const blob = await awaitBodyOperation(() => response.blob(), signal);
      bytes = new Uint8Array(await awaitBodyOperation(() => blob.arrayBuffer(), signal));
    } else if (typeof response?.arrayBuffer === 'function') {
      bytes = new Uint8Array(await awaitBodyOperation(() => response.arrayBuffer(), signal));
    } else {
      throw makePackError('PACK_HTTP_BODY_UNREADABLE');
    }
    if (bytes.byteLength > limit) {
      throw makePackError('PACK_HTTP_TOO_LARGE', { data: { bytes: bytes.byteLength, maxBytes: limit } });
    }
    return bytes;
  }

  const chunks = [];
  let total = 0;
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await readStreamChunk(reader, signal);
      if (done) { complete = true; break; }
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      total += chunk.byteLength;
      if (total > limit) {
        throw makePackError('PACK_HTTP_TOO_LARGE', { data: { bytes: total, maxBytes: limit } });
      }
      chunks.push(chunk);
    }
  } finally {
    if (!complete) cancelBodyBestEffort(reader, signal?.aborted ? 'PACK_HTTP_BODY_ABORTED' : 'PACK_HTTP_BODY_INCOMPLETE');
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * @implements {import('./pack-source.js').PackSource}
 */
export class HttpPackSource {
  /**
   * @param {{
   *  id: string,
   *  baseUrl: string,
   *  fileIndexPaths?: string[],
   *  timeoutMs?: number,
   *  retry?: { maxRetries?: number, backoffBaseMs?: number, backoffMaxMs?: number },
   *  cache?: {
   *    text?: { maxEntries?: number, maxBytesTotal?: number },
   *    blob?: { maxEntries?: number, maxBytesTotal?: number },
   *  },
   *  limits?: { maxTextBytes?: number, maxBlobBytes?: number },
   * }} opts
   */
  constructor(opts) {
    if (!opts || !opts.baseUrl) {
      throw makePackError('PACK_HTTP_MISSING_BASE_URL');
    }

    this.id = String(opts.id || 'vanilla');
    this.kind = 'http';

    this.baseUrl = normalizeBaseUrl(opts.baseUrl);

    /** @type {string[]|null} */
    this._index = Array.isArray(opts.fileIndexPaths)
      ? opts.fileIndexPaths.map((p) => normalizePackPath(p)).sort()
      : null;

    this.supportsListing = Boolean(this._index && this._index.length);

    this._timeoutMs = Math.max(0, Number(opts.timeoutMs ?? 8000));
    this._retry = {
      maxRetries: Math.max(0, Number(opts?.retry?.maxRetries ?? 2)),
      backoffBaseMs: Math.max(0, Number(opts?.retry?.backoffBaseMs ?? 200)),
      backoffMaxMs: Math.max(0, Number(opts?.retry?.backoffMaxMs ?? 4000)),
    };

    this._limits = {
      maxTextBytes: Math.max(0, Number(opts?.limits?.maxTextBytes ?? 6 * 1024 * 1024)),
      maxBlobBytes: Math.max(0, Number(opts?.limits?.maxBlobBytes ?? 24 * 1024 * 1024)),
    };

    const textCache = opts?.cache?.text || {};
    const blobCache = opts?.cache?.blob || {};
    this._textCache = new LruCache({
      label: 'http:text',
      maxEntries: Math.max(0, Number(textCache.maxEntries ?? 128)),
      maxBytesTotal: Math.max(0, Number(textCache.maxBytesTotal ?? 8 * 1024 * 1024)),
    });
    this._blobCache = new LruCache({
      label: 'http:blob',
      maxEntries: Math.max(0, Number(blobCache.maxEntries ?? 64)),
      maxBytesTotal: Math.max(0, Number(blobCache.maxBytesTotal ?? 16 * 1024 * 1024)),
    });

    /** @type {Map<string|symbol, Promise<{ text: string, bytes: number }>>} */
    this._inFlightText = new Map();
    /** @type {Map<string|symbol, Promise<{ blob: Blob, bytes: number }>>} */
    this._inFlightBlob = new Map();

    this._stats = {
      fetchCalls: 0,
      fetchOk: 0,
      fetchFail: 0,
      retries: 0,
      inFlightJoins: 0,
      lastUrl: null,
      lastStatus: null,
      lastErrorCode: null,
    };
  }

  getStats() {
    return {
      ...this._stats,
      caches: {
        text: this._textCache.getStats(),
        blob: this._blobCache.getStats(),
      },
      inFlight: {
        text: this._inFlightText.size,
        blob: this._inFlightBlob.size,
      },
      config: {
        baseUrl: this.baseUrl.toString(),
        timeoutMs: this._timeoutMs,
        retry: { ...this._retry },
        limits: { ...this._limits },
      },
    };
  }

  resetStats() {
    this._stats.fetchCalls = 0;
    this._stats.fetchOk = 0;
    this._stats.fetchFail = 0;
    this._stats.retries = 0;
    this._stats.inFlightJoins = 0;
    this._stats.lastUrl = null;
    this._stats.lastStatus = null;
    this._stats.lastErrorCode = null;
  }

  clearCache() {
    this._textCache.clear();
    this._blobCache.clear();
  }

  /**
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<import('./pack-source.js').PackFileList>}
   */
  async listFiles(options = {}) {
    if (options?.signal?.aborted) {
      throw makePackError('PACK_ABORTED');
    }

    if (!this._index) {
      return { paths: [], complete: false };
    }

    // Return a copy to avoid external mutation.
    return { paths: this._index.slice(), complete: true };
  }

  /**
   * @param {string} rawPath
   * @param {{ encoding?: string, signal?: AbortSignal, maxBytes?: number }} [options]
   */
  async readText(rawPath, options = {}) {
    if (options?.signal?.aborted) throw makePackError('PACK_ABORTED');

    const path = normalizePackPath(rawPath);

    // Cache hit.
    const cached = this._textCache.get(path);
    if (typeof cached === 'string') {
      const maxBytes = Number(options?.maxBytes);
      if (Number.isFinite(maxBytes) && maxBytes > 0) {
        const bytes = byteLengthUtf8(cached);
        if (bytes > maxBytes) {
          throw makePackError('PACK_HTTP_TOO_LARGE', { data: { sourceId: this.id, path, bytes, maxBytes } });
        }
      }
      return cached;
    }

    const effectiveMax = this._effectiveMaxBytes('text', options?.maxBytes);
    // A caller owns its abort signal. Sharing another caller's promise would
    // ignore this caller's cancellation or cancel an unrelated reader.
    const inFlightKey = options?.signal ? Symbol(path) : `text:${path}:${effectiveMax}`;

    const inflight = this._inFlightText.get(inFlightKey);
    if (inflight) {
      this._stats.inFlightJoins += 1;
      const { text } = await inflight;
      const maxBytes = Number(options?.maxBytes);
      if (Number.isFinite(maxBytes) && maxBytes > 0) {
        const bytes = byteLengthUtf8(text);
        if (bytes > maxBytes) {
          throw makePackError('PACK_HTTP_TOO_LARGE', { data: { sourceId: this.id, path, bytes, maxBytes } });
        }
      }
      return text;
    }

    const p = this._readTextUncached(path, { ...options, maxBytes: effectiveMax })
      .finally(() => {
        this._inFlightText.delete(inFlightKey);
      });

    this._inFlightText.set(inFlightKey, p);
    const { text } = await p;

    // NOTE: encoding option is ignored; Response.text() is UTF-8.
    return text;
  }

  /**
   * @param {string} rawPath
   * @param {{ mimeType?: string, signal?: AbortSignal, maxBytes?: number }} [options]
   */
  async readBlob(rawPath, options = {}) {
    if (options?.signal?.aborted) throw makePackError('PACK_ABORTED');

    const path = normalizePackPath(rawPath);

    // Cache hit.
    const cached = this._blobCache.get(path);
    if (cached instanceof Blob) {
      const maxBytes = Number(options?.maxBytes);
      if (Number.isFinite(maxBytes) && maxBytes > 0 && cached.size > maxBytes) {
        throw makePackError('PACK_HTTP_TOO_LARGE', { data: { sourceId: this.id, path, bytes: cached.size, maxBytes } });
      }
      return this._maybeWrapMime(cached, options?.mimeType);
    }

    const effectiveMax = this._effectiveMaxBytes('blob', options?.maxBytes);
    const inFlightKey = options?.signal ? Symbol(path) : `blob:${path}:${effectiveMax}`;

    const inflight = this._inFlightBlob.get(inFlightKey);
    if (inflight) {
      this._stats.inFlightJoins += 1;
      const { blob } = await inflight;
      const maxBytes = Number(options?.maxBytes);
      if (Number.isFinite(maxBytes) && maxBytes > 0 && blob.size > maxBytes) {
        throw makePackError('PACK_HTTP_TOO_LARGE', { data: { sourceId: this.id, path, bytes: blob.size, maxBytes } });
      }
      return this._maybeWrapMime(blob, options?.mimeType);
    }

    const p = this._readBlobUncached(path, { ...options, maxBytes: effectiveMax })
      .finally(() => {
        this._inFlightBlob.delete(inFlightKey);
      });

    this._inFlightBlob.set(inFlightKey, p);
    const { blob } = await p;
    return this._maybeWrapMime(blob, options?.mimeType);
  }

  /**
   * @param {'text'|'blob'} kind
   * @param {number|undefined} requested
   */
  _effectiveMaxBytes(kind, requested) {
    const req = Number(requested);
    const cap = kind === 'text' ? this._limits.maxTextBytes : this._limits.maxBlobBytes;
    if (Number.isFinite(req) && req > 0) return Math.min(req, cap);
    return cap;
  }

  /**
   * @param {string} path
   * @param {{ signal?: AbortSignal, maxBytes?: number }} options
   */
  async _readTextUncached(path, options) {
    const url = resolvePackUrl(path, this.baseUrl).toString();
    this._stats.lastUrl = url;
    let fetchSession = null;

    try {
      fetchSession = await fetchWithRetry(url, {
        signal: options?.signal,
        timeoutMs: this._timeoutMs,
        maxRetries: this._retry.maxRetries,
        backoffBaseMs: this._retry.backoffBaseMs,
        backoffMaxMs: this._retry.backoffMaxMs,
        validateResponseUrl: (response, requestUrl) => {
          assertResponseUrlWithinBase(response, requestUrl, this.baseUrl);
        },
        onAttempt: () => {
          this._stats.fetchCalls += 1;
        },
        onRetry: ({ reason }) => {
          this._stats.retries += 1;
          this._stats.lastErrorCode = reason;
        },
      });
      const res = fetchSession.response;
      this._stats.lastStatus = res.status;

      const maxBytes = Number(options?.maxBytes);
      let payload;
      try {
        enforceContentLengthHeader(res, maxBytes);
        payload = await readResponseBytesBounded(res, maxBytes, fetchSession.bodySignal, 'text');
      } finally {
        fetchSession.cleanup();
      }
      const text = new TextDecoder('utf-8').decode(payload);
      const bytes = payload.byteLength;

      this._textCache.set(path, text, bytes);
      this._stats.fetchOk += 1;
      return { text, bytes };
    } catch (e) {
      cancelBodyBestEffort(fetchSession?.response?.body, 'PACK_HTTP_READ_FAILED');
      this._stats.fetchFail += 1;
      let code = e instanceof Error ? e.message : 'PACK_HTTP_FETCH_FAILED';
      if (code === 'PACK_HTTP_BODY_ABORTED') {
        code = options?.signal?.aborted ? 'PACK_ABORTED' : 'PACK_HTTP_TIMEOUT';
      }
      this._stats.lastErrorCode = code;

      if (e instanceof Error && e.message === PACK_NOT_FOUND) {
        throw makePackError(PACK_NOT_FOUND, { cause: e, data: { sourceId: this.id, path, url } });
      }
      if (e instanceof Error) {
        throw makePackError(code, { cause: e, data: { sourceId: this.id, path, url } });
      }
      throw makePackError('PACK_HTTP_FETCH_FAILED', { cause: e, data: { sourceId: this.id, path, url } });
    }
  }

  /**
   * @param {string} path
   * @param {{ signal?: AbortSignal, maxBytes?: number }} options
   */
  async _readBlobUncached(path, options) {
    const url = resolvePackUrl(path, this.baseUrl).toString();
    this._stats.lastUrl = url;
    let fetchSession = null;

    try {
      fetchSession = await fetchWithRetry(url, {
        signal: options?.signal,
        timeoutMs: this._timeoutMs,
        maxRetries: this._retry.maxRetries,
        backoffBaseMs: this._retry.backoffBaseMs,
        backoffMaxMs: this._retry.backoffMaxMs,
        validateResponseUrl: (response, requestUrl) => {
          assertResponseUrlWithinBase(response, requestUrl, this.baseUrl);
        },
        onAttempt: () => {
          this._stats.fetchCalls += 1;
        },
        onRetry: ({ reason }) => {
          this._stats.retries += 1;
          this._stats.lastErrorCode = reason;
        },
      });
      const res = fetchSession.response;
      this._stats.lastStatus = res.status;

      const maxBytes = Number(options?.maxBytes);
      let payload;
      try {
        enforceContentLengthHeader(res, maxBytes);
        payload = await readResponseBytesBounded(res, maxBytes, fetchSession.bodySignal, 'blob');
      } finally {
        fetchSession.cleanup();
      }
      const contentType = res.headers?.get?.('content-type') || 'application/octet-stream';
      const blob = new Blob([payload], { type: contentType });
      const bytes = payload.byteLength;

      this._blobCache.set(path, blob, bytes);
      this._stats.fetchOk += 1;
      return { blob, bytes };
    } catch (e) {
      cancelBodyBestEffort(fetchSession?.response?.body, 'PACK_HTTP_READ_FAILED');
      this._stats.fetchFail += 1;
      let code = e instanceof Error ? e.message : 'PACK_HTTP_FETCH_FAILED';
      if (code === 'PACK_HTTP_BODY_ABORTED') {
        code = options?.signal?.aborted ? 'PACK_ABORTED' : 'PACK_HTTP_TIMEOUT';
      }
      this._stats.lastErrorCode = code;

      if (e instanceof Error && e.message === PACK_NOT_FOUND) {
        throw makePackError(PACK_NOT_FOUND, { cause: e, data: { sourceId: this.id, path, url } });
      }
      if (e instanceof Error) {
        throw makePackError(code, { cause: e, data: { sourceId: this.id, path, url } });
      }
      throw makePackError('PACK_HTTP_FETCH_FAILED', { cause: e, data: { sourceId: this.id, path, url } });
    }
  }

  /**
   * @param {Blob} blob
   * @param {string|undefined} mimeType
   */
  _maybeWrapMime(blob, mimeType) {
    if (mimeType && String(mimeType) !== blob.type) {
      return new Blob([blob], { type: String(mimeType) });
    }
    return blob;
  }
}
