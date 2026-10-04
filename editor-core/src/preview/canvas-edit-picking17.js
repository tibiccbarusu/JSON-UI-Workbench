import { compareCanvasPaintOrder, drawCanvasPreview, getCanvasPreviewPaintSnapshot, hitTestBoxes } from './canvas-preview.js';
import { resolveNativeSceneRasterBounds } from './native-scene-placement.js';

// Normal editing targets painted controls. Structural containers and unloaded
// native renderers remain available through the explicit structure/source view.
// Candidate metadata is the exact snapshot passed to the last canvas draw.
function positiveAlpha(value) { return value === undefined || (Number.isFinite(Number(value)) && Number(value) > 0); }

function candidateBounds(box, selection, zoom, framePaint) {
  const info = selection.imageDrawById?.[box.id];
  if (info?.state !== 'native-scene' || framePaint?.nativeFallbackIds.has(box.id)) return box;
  const bounds = resolveNativeSceneRasterBounds(info.nativeScene, { x: box.x * zoom, y: box.y * zoom, w: box.w * zoom, h: box.h * zoom });
  return bounds ? { ...box, x: bounds.x / zoom, y: bounds.y / zoom, w: bounds.w / zoom, h: bounds.h / zoom } : box;
}

export function hasCanvasEditPaint(box, selection = {}) {
  if (!box || !(box.w > 0) || !(box.h > 0) || !positiveAlpha(box.renderAlpha)) return false;
  if (box.type === 'image' || box.type === 'custom') {
    const info = selection.imageDrawById?.[box.id];
    if (!info || !positiveAlpha(info.alpha) || !positiveAlpha(info.tint?.[3])) return false;
    if (info.state === 'native-placeholder') return info.placeholderKind === 'banner-pattern';
    if (info.state === 'native-scene') return Boolean(info.image && info.nativeScene);
    return info.state === 'ready' && Boolean(info.image) && !['zero', 'invalid'].includes(info.uvSizeState)
      && (info.clipRatio == null || info.clipRatio > 0);
  }
  if (['label', 'button', 'dropdown', 'edit_box'].includes(box.type)) {
    const info = selection.textDrawById?.[box.id];
    return Boolean(info?.text?.trim() && positiveAlpha(info.alpha)
      && (info.bitmapLayout?.drawable || info.bitmapLayout?.ready || (info.state === 'ready' && info.fontBackend === 'resource-font-face')));
  }
  return false;
}

/**
 * Use ordinary painter ordering, then test only overlapping drawable candidates
 * against one CSS pixel using the same image/text/native drawing code. No UI
 * layout, pack loading or full-frame rendering is performed on pointer movement.
 * UVs, nine-slices, texture alpha, clipping and glyph spaces therefore retain
 * the renderer's behavior instead of inventing another geometry implementation.
 */
export function createCanvasEditPicker({ createCanvas = () => document.createElement('canvas'), onIssue } = {}) {
  let probe = null;
  let last = null;
  let reportedReadFailure = false;
  return {
    hitTest({ layout, selection, view, worldX, worldY, sourceCanvas, structureMode = false } = {}) {
      if (structureMode) return hitTestBoxes(layout?.boxes || [], worldX, worldY, layout?.preset);
      if (!layout || !selection || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
      const zoom = Number(view?.zoom);
      if (!(zoom > 0) || !hitTestBoxes([{ id: 'viewport', x: 0, y: 0, w: layout.preset?.width, h: layout.preset?.height }], worldX, worldY)) return null;
      const dpr = Math.max(1, Math.min(4, globalThis.window?.devicePixelRatio || 1));
      // The sampled backing pixel is not the CSS center at even DPR values.
      // Position its actual center on the requested world coordinate.
      const probeSampleOffset = (Math.floor(Math.round(dpr) / 2) + 0.5) / dpr;
      const recorded = sourceCanvas ? getCanvasPreviewPaintSnapshot(sourceCanvas) : null;
      const framePaint = recorded?.layout === layout && recorded.zoom === zoom
        && recorded.imageDrawById === selection.imageDrawById && recorded.textDrawById === selection.textDrawById ? recorded : null;
      if (last?.layout === layout && last.selection === selection && last.zoom === zoom && last.dpr === dpr
        && framePaint && last.framePaint === framePaint && last.x === worldX && last.y === worldY) return last.hit;
      const candidates = (layout.boxes || []).filter(box => hasCanvasEditPaint(box, selection)
        && hitTestBoxes([candidateBounds(box, selection, zoom, framePaint)], worldX, worldY, layout.preset)).sort(compareCanvasPaintOrder).reverse();
      let hit = null;
      try {
        if (candidates.length && !probe) {
          probe = createCanvas();
          // Detached canvases have a zero DOM rectangle. Explicitly give this
          // bounded raster probe one CSS pixel, preserving the display DPR.
          probe.getBoundingClientRect = () => ({ width: 1, height: 1 });
        }
        // The layout service already bounds the number of boxes. Do not truncate
        // candidates here: many transparent overlays must not hide an editable
        // painted control. Only overlapping drawable candidates are sampled.
        for (const box of candidates) {
          const rawInfo = selection.imageDrawById?.[box.id];
          const imageDrawById = rawInfo ? { [box.id]: { ...rawInfo,
            // Picking only measures alpha. Avoid megatexel RGB recoloring and
            // filter surfaces that do not change coverage on pointer movement.
            tint: Array.isArray(rawInfo.tint) ? [1, 1, 1, rawInfo.tint[3]] : rawInfo.tint,
            grayscale: false,
          } } : undefined;
          drawCanvasPreview(probe, { ...layout, boxes: [box], scrollMetaById: {} },
            { zoom, viewX: worldX - probeSampleOffset / zoom, viewY: worldY - probeSampleOffset / zoom }, {
              imageDrawById, textDrawById: selection.textDrawById,
              forceNativeFallback: framePaint?.nativeFallbackIds.has(box.id) === true,
              forceTiledMode: framePaint?.tiledDrawById.get(box.id)?.mode,
              preparedTileSource: framePaint?.tiledDrawById.get(box.id)?.source,
              preparedTiledRaster: framePaint?.tiledDrawById.get(box.id)?.raster,
              transparentBackground: true, showGuides: false, showScreenBoundary: false,
              showMissingTexturePlaceholders: false, showResizeHandles: false,
              cacheStableSources: true, rasterCacheEpoch: selection.rasterCacheEpoch,
              rasterCacheSource: sourceCanvas,
            });
          const context = probe.getContext('2d');
          const pixel = context.getImageData(Math.min(probe.width - 1, Math.floor(probe.width / 2)),
            Math.min(probe.height - 1, Math.floor(probe.height / 2)), 1, 1).data;
          if (pixel[3] > 0) { hit = box; break; }
        }
      } catch {
        // A tainted/unsupported canvas must never silently select a different
        // object. The source list and explicit structure view stay usable.
        hit = null;
        if (!reportedReadFailure) {
          reportedReadFailure = true;
          try { onIssue?.({ code: 'CANVAS_EDIT_PIXEL_READ_FAILED' }); } catch { /* Diagnostics must not change selection. */ }
        }
      }
      last = { layout, selection, zoom, dpr, framePaint, x: worldX, y: worldY, hit };
      return hit;
    },
  };
}
