/**
 * Fixed, original Mojang Steve resources used only as the lowest native-player
 * reference layer. A host adapter owns I/O; this module cannot fetch arbitrary
 * paths and never modifies a user's imported pack.
 */
export const DEFAULT_PLAYER_SOURCE = 'default-player';
export const DEFAULT_PLAYER_TEXTURE_REF = 'textures/entity/steve';
export const DEFAULT_PLAYER_TEXTURE_PATH = `${DEFAULT_PLAYER_TEXTURE_REF}.png`;
export const DEFAULT_PLAYER_ASSET_BASE = new URL('../../assets/native-default-player/', import.meta.url).href;

/**
 * Fill only a missing exact Steve texture for an explicitly selected bundled
 * reference. Existing assets, collisions, invalid refs, and custom textures
 * keep their original resolution and diagnostics unchanged.
 * @param {object|null} result Result from resolveTextureRef.
 * @param {string} ref Requested texture path without extension.
 * @param {object} nativePreview Ready player snapshot including provenance.
 * @returns {object|null} Original result or a fixed default-player resolution.
 */
export function resolveDefaultPlayerTexture(result, ref, nativePreview) {
  if (ref !== DEFAULT_PLAYER_TEXTURE_REF || !result?.ok || result.resolved || result.collision
    || nativePreview?.status !== 'ready'
    || nativePreview?.provenance?.defaultPlayerStatus !== 'BUNDLED_ORIGINAL_STEVE_REFERENCE') return result;
  return { ...result, resolved: { source: DEFAULT_PLAYER_SOURCE, packPath: DEFAULT_PLAYER_TEXTURE_PATH,
    matchedCandidate: DEFAULT_PLAYER_TEXTURE_PATH } };
}

const FILE_BYTES = Object.freeze({
  'entity/player.entity.json': 8397,
  'models/entity/humanoid.custom.geo.json': 4610,
  'textures/entity/steve.png': 1379,
});

/**
 * Construct a pack-compatible reader for three fixed assets. readBytes must
 * return Uint8Array and honor the supplied AbortSignal when its host permits.
 * Exact sizes reject incomplete/corrupt fallback installation without trying
 * another file or running an unbounded retry loop.
 * @param {{readBytes:(path:string,options:{signal?:AbortSignal,maxBytes:number})=>Promise<Uint8Array>}} adapter
 * @returns {object} Runtime for loadPlayerPreviewFromSources and texture cache.
 */
export function createDefaultPlayerRuntime({ readBytes }) {
  if (typeof readBytes !== 'function') throw new TypeError('DEFAULT_PLAYER_READER_INVALID');
  const packPaths = Object.freeze(Object.keys(FILE_BYTES));
  const entryIndex = new Map(packPaths.map(path => [path,
    { info: Object.freeze({ uncompressedSize: FILE_BYTES[path] }) }]));
  async function bytes(path, options = {}) {
    if (typeof path !== 'string' || !Object.hasOwn(FILE_BYTES, path)) throw new Error('DEFAULT_PLAYER_PATH_INVALID');
    const expected = FILE_BYTES[path];
    if (options.signal?.aborted) throw new Error('NATIVE_PREVIEW_ABORTED');
    if (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < expected)) {
      throw new Error('DEFAULT_PLAYER_READ_LIMIT');
    }
    const data = await readBytes(path, { signal: options.signal, maxBytes: expected });
    if (options.signal?.aborted) throw new Error('NATIVE_PREVIEW_ABORTED');
    if (!(data instanceof Uint8Array) || data.byteLength !== expected) throw new Error('DEFAULT_PLAYER_ASSET_INVALID');
    return data;
  }
  return Object.freeze({ rootPrefix: '', packPaths, zipReader: Object.freeze({
    entryIndex,
    async readText(path, options) { return new TextDecoder('utf-8', { fatal: true }).decode(await bytes(path, options)); },
    async readBlob(path, options) { return new Blob([await bytes(path, options)], { type: options?.mimeType || 'application/octet-stream' }); },
  }) });
}
