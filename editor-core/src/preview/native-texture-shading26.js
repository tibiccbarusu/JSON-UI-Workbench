// Isolated source-atop black preserves destination alpha while multiplying RGB.
// This uses the scene's bounded preview lighting, not a native material shader.
export function createNativeTextureShader({ createSurface, rasterCache = null,
  maxPixels = 4_000_000, maxVariants = 64 } = {}) {
  if (typeof createSurface !== 'function' || !Number.isSafeInteger(maxPixels) || maxPixels < 0
    || !Number.isSafeInteger(maxVariants) || maxVariants < 0) throw new Error('NATIVE_SHADE_OPTIONS');
  const sources = new Map();
  // 連続する同じ予算超過を1件だけ記憶し、診断の重複と保持数の無制限増加を防ぐ。
  let lastBudgetFailure = null;
  const stats = { pixels: 0, variants: 0, hits: 0, failures: 0, uncachedFailures: 0,
    croppedVariants: 0, avoidedAtlasPixels: 0 };
  function get(image, width, height, shade, region = null) {
    if (!image || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1 || !Number.isFinite(shade) || shade < 0 || shade > 1) {
      return { image, ok: false, issue: 'NATIVE_PREVIEW_SHADE_INVALID' };
    }
    if (shade === 1) return { image, ok: true };
    const sourceX = region?.x ?? 0, sourceY = region?.y ?? 0;
    const drawWidth = region?.w ?? width, drawHeight = region?.h ?? height;
    let variants = sources.get(image);
    const key = `${width}:${height}:${shade}${region ? `:region:${sourceX}:${sourceY}:${drawWidth}:${drawHeight}` : ''}`;
    if (variants?.has(key)) return variants.get(key);
    const pixels = drawWidth * drawHeight;
    let result;
    if (drawWidth > 4096 || drawHeight > 4096 || pixels > maxPixels - stats.pixels || stats.variants >= maxVariants) {
      if (lastBudgetFailure?.image === image && lastBudgetFailure.key === key) return lastBudgetFailure.result;
      stats.failures++; stats.uncachedFailures++;
      result = { image, ok: false, issue: 'NATIVE_PREVIEW_SHADE_BUDGET_EXCEEDED' };
      lastBudgetFailure = { image, key, result };
      return result;
    } else {
      // Warm/cold caches support the same frame. Failed allocations also count.
      stats.pixels += pixels; stats.variants++;
      if (region) { stats.croppedVariants++; stats.avoidedAtlasPixels += width * height - pixels; }
      const persistentKey = rasterCache?.key(['native-texture-shade-v1', image, key]);
      const cached = persistentKey ? rasterCache.get(persistentKey) : null;
      if (cached) { stats.hits++; result = { image: cached, ok: true }; }
      else try {
        const surface = createSurface(drawWidth, drawHeight), ctx = surface?.getContext('2d');
        if (!ctx) throw new Error('unavailable');
        ctx.imageSmoothingEnabled = false;
        if (region) ctx.drawImage(image, sourceX, sourceY, drawWidth, drawHeight, 0, 0, drawWidth, drawHeight);
        else ctx.drawImage(image, 0, 0, width, height);
        ctx.globalCompositeOperation = 'source-atop';
        if (ctx.globalCompositeOperation !== 'source-atop') throw new Error('unavailable');
        ctx.globalAlpha = 1 - shade;
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, drawWidth, drawHeight);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        if (persistentKey) rasterCache.set(persistentKey, surface, pixels);
        result = { image: surface, ok: true };
      } catch { result = { image, ok: false, issue: 'NATIVE_PREVIEW_SHADE_UNAVAILABLE' }; }
    }
    if (result.ok && region) result = { ...result, sourceOffsetX: sourceX, sourceOffsetY: sourceY };
    if (!result.ok) stats.failures++;
    if (!variants) { variants = new Map(); sources.set(image, variants); }
    variants.set(key, result);
    return result;
  }
  /**
   * Shade the original integer texels used by a face when its complete atlas
   * cannot fit the per-frame budget. Fractional UVs keep the original path:
   * an intermediate resampling must not change the authored texel boundaries.
   * Region selection depends on the hard budget, never warm-cache state.
   */
  function getForRegion(image, width, height, shade, region) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 16_777_216
      || !region || ![region.x, region.y, region.w, region.h].every(Number.isFinite)
      || region.x < 0 || region.y < 0 || region.w <= 0 || region.h <= 0
      || region.x + region.w > width || region.y + region.h > height) {
      return { image, ok: false, issue: 'NATIVE_PREVIEW_SHADE_INVALID' };
    }
    const oversized = width > 4096 || height > 4096 || width * height > maxPixels;
    const integerRegion = [region.x, region.y, region.w, region.h].every(Number.isSafeInteger);
    return get(image, width, height, shade, oversized && integerRegion ? region : null);
  }
  return { get: (image, width, height, shade) => get(image, width, height, shade), getForRegion,
    snapshot: () => ({ ...stats, retainedSources: sources.size, retainedVariants: stats.variants, retainedBudgetFailures: lastBudgetFailure ? 1 : 0, maxPixels, maxVariants }) };
}
