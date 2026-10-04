/**
 * Texture metadata participates in the same ready state as its raster.
 * A small nine-slice source is not a truthful stretched fallback while its
 * sidecar is still loading or failed. Browser/Node import-safe pure module.
 */
export function resolveTextureSidecarDrawState(authoredMetadata, record) {
  const metadata = { ...(authoredMetadata || {}) };
  const status = record?.status || 'loading';
  if (status === 'loading') return { state: 'loading', metadata, issue: null };
  if (status === 'error') {
    return { state: 'missing', metadata, issue: record?.code || 'TEXTURE_SIDECAR_LOAD_FAILED' };
  }
  if (status === 'missing') return { state: 'ready', metadata, issue: null };
  if (status !== 'ready' || !record?.value || typeof record.value !== 'object') {
    return { state: 'missing', metadata, issue: 'TEXTURE_SIDECAR_STATE_INVALID' };
  }
  const value = record.value;
  if (value.tiled !== null && value.tiled !== undefined && typeof value.tiled !== 'boolean') {
    return { state: 'missing', metadata, issue: 'TEXTURE_SIDECAR_TILED_INVALID' };
  }
  if (value.baseSize !== null && value.baseSize !== undefined) {
    const base = value.baseSize;
    if (!Array.isArray(base) || base.length !== 2
      || !base.every((number) => typeof number === 'number' && Number.isFinite(number) && number > 0)) {
      return { state: 'missing', metadata, issue: 'TEXTURE_SIDECAR_BASE_SIZE_INVALID' };
    }
    metadata.baseSize = [...base];
  }
  if (metadata.nineSlice === null || metadata.nineSlice === undefined) {
    const raw = value.nineSlice;
    if (raw !== null && raw !== undefined) {
      const margins = Array.isArray(raw) ? raw : [raw];
      if ((Array.isArray(raw) && ![2, 4].includes(margins.length))
        || !margins.every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)) {
        return { state: 'missing', metadata, issue: 'TEXTURE_SIDECAR_NINE_SLICE_INVALID' };
      }
      metadata.nineSlice = Array.isArray(raw) ? [...raw] : raw;
    }
  }
  // The caller signals an authored tiled=false by setting tiledAuthored.
  if (!metadata.tiledAuthored && value.tiled === true) metadata.tiled = 'both';
  delete metadata.tiledAuthored;
  return { state: 'ready', metadata, issue: null };
}
