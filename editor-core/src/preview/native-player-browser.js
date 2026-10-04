/** Browser transport for an optional, privately installed player reference. */
import { createDefaultPlayerRuntime, DEFAULT_PLAYER_ASSET_BASE, DEFAULT_PLAYER_SOURCE } from './native-player-default.js';
import { loadPlayerPreviewFromSources } from './native-model-loader.js';

const optionalReferenceAvailability = new WeakMap();

/**
 * Create the lowest player reference layer using fixed same-origin assets.
 * The single deadline covers fetch headers and every body chunk. Promise.race
 * also bounds a transport that fails to honor abort. No retries or redirects.
 * @param {{fetchImpl?:typeof fetch,timeoutMs?:number}} [options]
 * @returns {object} Pack-compatible runtime; source identity belongs to caller.
 */
export function createBrowserDefaultPlayerRuntime({ fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('DEFAULT_PLAYER_FETCH_UNAVAILABLE');
  const duration = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(8000, timeoutMs)) : 8000;
  // Only the three fixed paths accepted by createDefaultPlayerRuntime can
  // enter this cache. Availability checks and later model/texture reads share
  // at most 14,386 bytes; failed or cancelled reads are never retained.
  const decodedAssets = new Map();
  return createDefaultPlayerRuntime({ async readBytes(path, { signal, maxBytes }) {
    if (decodedAssets.has(path)) return decodedAssets.get(path);
    const controller = new AbortController();
    let reader, timer, abortListener;
    const abortError = () => Object.assign(new Error(signal?.aborted
      ? 'NATIVE_PREVIEW_ABORTED' : 'DEFAULT_PLAYER_READ_TIMEOUT'), { name: signal?.aborted ? 'AbortError' : 'TimeoutError' });
    const externalAbort = () => controller.abort();
    signal?.addEventListener('abort', externalAbort, { once: true });
    const deadline = new Promise((_, reject) => {
      abortListener = () => reject(abortError());
      controller.signal.addEventListener('abort', abortListener, { once: true });
      timer = setTimeout(() => controller.abort(), duration);
      if (signal?.aborted) controller.abort();
    });
    try {
      const response = await Promise.race([Promise.resolve().then(() => fetchImpl(
        new URL(path, DEFAULT_PLAYER_ASSET_BASE), {
          signal: controller.signal, credentials: 'same-origin', redirect: 'error', cache: 'force-cache',
        },
      )), deadline]);
      if (!response?.ok) throw new Error(`DEFAULT_PLAYER_HTTP_${response?.status || 'INVALID'}`);
      const length = response.headers?.get('content-length');
      if (length !== null && length !== undefined && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) {
        throw new Error('DEFAULT_PLAYER_READ_LIMIT');
      }
      if (typeof response.body?.getReader !== 'function') throw new Error('DEFAULT_PLAYER_STREAM_UNAVAILABLE');
      reader = response.body.getReader();
      const bytes = new Uint8Array(maxBytes);
      let count = 0, reads = 0;
      while (true) {
        if (++reads > maxBytes + 32) throw new Error('DEFAULT_PLAYER_STREAM_WORK_LIMIT');
        const { done, value } = await Promise.race([reader.read(), deadline]);
        if (done) break;
        if (!(value instanceof Uint8Array) || value.byteLength > maxBytes - count) throw new Error('DEFAULT_PLAYER_READ_LIMIT');
        bytes.set(value, count); count += value.byteLength;
      }
      const result = bytes.subarray(0, count);
      if (count === maxBytes) decodedAssets.set(path, result);
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', externalAbort);
      controller.signal.removeEventListener('abort', abortListener);
      controller.abort();
      try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* best-effort cleanup */ }
      try { reader?.releaseLock(); } catch { /* an outstanding aborted read may own the lock */ }
    }
  } });
}

/**
 * Probe the complete optional reference before advertising its candidate
 * paths. In a public install these URLs return 404. Blindly adding that layer
 * made version selection read a nonexistent default entity even when a valid
 * imported player existed under another filename. The usual source/version
 * selection remains unchanged when all three reference assets are present.
 */
export async function inspectBrowserDefaultPlayerReference(runtime, { signal } = {}) {
  if (signal?.aborted) return { status: 'cancelled' };
  if (!runtime || typeof runtime !== 'object' || typeof runtime.zipReader?.readText !== 'function'
    || typeof runtime.zipReader?.readBlob !== 'function') {
    return { status: 'unavailable', issue: 'DEFAULT_PLAYER_REFERENCE_UNAVAILABLE' };
  }
  const cached = optionalReferenceAvailability.get(runtime);
  if (cached) return cached;
  // The underlying transport enforces byte limits and one deadline across
  // headers/body. Await all outcomes so cancellation leaves no unowned tasks.
  const reads = await Promise.allSettled([
    Promise.resolve().then(() => runtime.zipReader.readText('entity/player.entity.json', { signal, maxBytes: 8397 })),
    Promise.resolve().then(() => runtime.zipReader.readText('models/entity/humanoid.custom.geo.json', { signal, maxBytes: 4610 })),
    Promise.resolve().then(() => runtime.zipReader.readBlob('textures/entity/steve.png', { signal, maxBytes: 1379, mimeType: 'image/png' })),
  ]);
  if (signal?.aborted) return { status: 'cancelled' };
  const errors = reads.filter(row => row.status === 'rejected').map(row => String(row.reason?.message || ''));
  let result;
  if (!errors.length) result = Object.freeze({ status: 'ready' });
  else if (errors.some(error => /^DEFAULT_PLAYER_HTTP_(?:404|410)$/u.test(error))) {
    result = Object.freeze({ status: 'not-installed', issue: 'DEFAULT_PLAYER_REFERENCE_NOT_INSTALLED' });
  } else return { status: 'unavailable', issue: 'DEFAULT_PLAYER_REFERENCE_UNAVAILABLE' };
  // Local optional references are immutable for one browser session. Reload
  // the page after installing/removing them; cancellation is not a cache value.
  optionalReferenceAvailability.set(runtime, result);
  return result;
}

/** Browser-only composition; the Node player endpoint remains independent. */
export async function loadBrowserPlayerPreview({ defaultRuntime, ...options }) {
  if (options.signal?.aborted) return { status: 'cancelled' };
  if (!Array.isArray(options.sources)) return { status: 'invalid', issue: 'NATIVE_PREVIEW_PACK_INDEX_INVALID' };
  const reference = await inspectBrowserDefaultPlayerReference(defaultRuntime, { signal: options.signal });
  if (reference.status === 'cancelled' || options.signal?.aborted) return { status: 'cancelled' };
  const sources = reference.status === 'ready'
    ? [...options.sources, { source: DEFAULT_PLAYER_SOURCE, runtime: defaultRuntime }]
    : options.sources;
  const result = await loadPlayerPreviewFromSources({ ...options, sources });
  if (options.signal?.aborted || result.status === 'cancelled') return { status: 'cancelled' };
  return { ...result, optionalPlayerReference: reference };
}
