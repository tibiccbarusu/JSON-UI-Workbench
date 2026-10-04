import { NATIVE_PREVIEW_MAX_DRAW_WORK_UNITS } from './native-model-preview.js';
import { isExplicitEventFactory38 } from '../engine/preview-context38.js';
import { resolveNativeScenePlacement, resolveNativeSceneRasterBounds } from './native-scene-placement.js';
import { PreviewRasterCache } from './raster-cache.js';
import { createNativeTextureShader } from './native-texture-shading26.js';
import { selectPreviewText } from './preview-text.js';
import { computeImageFitRect41 } from './image-draw-geometry41.js';
import { knownUnsupportedPreviewProperties41, NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41 } from './native-property-diagnostics41.js';
import { resolveNamedScrollControls, computeNamedScrollMetrics, createNamedScrollReflowOverrides } from './named-scroll-runtime37.js';
import { resolveSliderRuntime37, selectSliderStateChildren37, resolveSliderControls37, computeSliderGeometry37, readSliderEnabledState37, collectSliderDescendants37 } from './slider-runtime37.js';

// Caller opts in only for immutable pack texture/geometry snapshots. A WeakMap
// ties the bounded surfaces to their viewport lifetime. Pack epochs invalidate.
const viewportRasterCaches = new WeakMap();
const viewportPaintSnapshots = new WeakMap();
export function getCanvasPreviewPaintSnapshot(canvas) {
  return viewportPaintSnapshots.get(canvas) || null;
}
export function getCanvasPreviewRasterCacheStats(canvas) {
  return viewportRasterCaches.get(canvas)?.cache.snapshot() || null;
}

/*
  canvas-preview.js (S033)

  Canvas viewport for resolved JSON UI nodes, pack textures and glyphs.

  Scope:
  - Draw textures, nine-slices, bitmap labels and bounded native model meshes.
  - Provide pan/zoom math, clipping, stacking and hit-testing helpers.
  - Layout is a best-effort approximation (Bedrock JSON UI is richer).

  Coordinate system ("world"):
  - Uses a 1920x1080 device preset by default (the physical resolution is
    converted to Bedrock logical coordinates by the caller's UI scale).
  - Layout boxes are expressed in world units.
*/

/** @typedef {{ width: number, height: number }} CanvasPreset */

/**
 * @typedef {Object} LayoutBox
 * @property {string} id
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} depth
 * @property {string|null} parentId
 * @property {number} layer
 * @property {number} effectiveLayer Local layer plus every ancestor layer.
 * @property {number[]} paintPath Stable depth-first paint path.
 * @property {number} order
 * @property {number} renderAlpha Best-effort effective alpha after opted-in ancestor propagation.
 * @property {{ x:number, y:number, w:number, h:number }|null} [clipRect] Effective ancestor clip in world coordinates.
 */

/**
 * @typedef {Object} LayoutStats
 * @property {number} totalNodes
 * @property {number} renderedBoxes
 * @property {number} boxCount Alias of renderedBoxes (legacy UI).
 * @property {boolean} truncated
 * @property {number} maxBoxes
 */

/**
 * @typedef {Object} ScrollViewMeta
 * @property {string} id
 * @property {{ x:number, y:number, w:number, h:number }} viewport
 * @property {number} scrollX
 * @property {number} scrollY
 * @property {number} maxScrollX
 * @property {number} maxScrollY
 * @property {number} clampedScrollX
 * @property {number} clampedScrollY
 * @property {{ minX:number, minY:number, maxX:number, maxY:number }|null} contentBounds
 * @property {string|null} contentChildId
 * @property {{ x:number, y:number, w:number, h:number }|null} [clipRect] Effective ancestor clip for viewport chrome.
 */

/**
 * @typedef {Object} LayoutResult
 * @property {{ width:number, height:number, name:string }} preset
 * @property {LayoutBox[]} boxes
 * @property {LayoutStats} stats
 * @property {string[]} warnings
 * @property {Record<string, ScrollViewMeta>} [scrollMetaById]
 */


/**
 * Image draw data for an `image` element or a bounded native surrogate.
 *
 * The canvas preview is intentionally approximate; this metadata allows
 * the caller (main.js) to provide decoded texture images on-demand.
 *
 * @typedef {{
 *  state: 'ready'|'loading'|'missing'|'unsupported'|'native-placeholder'|'native-scene',
 *  placeholderKind?: 'banner-pattern'|'enchanting-book'|'horse-entity',
 *  bannerPatternIndex?: number,
 *  bannerColorIndex?: number,
 *  nativeScene?: { kind?: string, faces?: Array<any> },
 *  image?: CanvasImageSource|null,
 *  imageLayers?: Array<{ image: CanvasImageSource, width: number, height: number }>,
 *  width?: number,
 *  height?: number,
 *  keepRatio?: boolean,
 *  bilinear?: boolean,
 *  alpha?: number,
 *  uv?: [number, number]|null,
 *  uvSize?: [number, number]|null,
 *  uvSizeState?: 'absent'|'valid'|'zero'|'invalid',
 *  nineSlice?: number|number[]|null,
 *  baseSize?: [number, number]|null,
 *  fill?: boolean,
 *  tiled?: false|'x'|'y'|'both',
 *  tiledScale?: [number, number],
 *  clipRatio?: number|null,
 *  clipDirection?: 'left'|'right'|'up'|'down'|'center'|null,
 *  clipPixelPerfect?: boolean,
 *  tint?: [number, number, number, number]|null,
 *  grayscale?: boolean,
 * }} ImageDrawInfo
 */

/**
 * Text draw data for `label` and `button` elements.
 *
 * The font is resolved and loaded by caller code (main.js). Canvas preview
 * consumes resource bitmap layouts, or a positively loaded pack FontFace.
 *
 * @typedef {{
 *  state: 'ready'|'loading'|'missing'|'unsupported',
 *  fontBackend?: 'resource-bitmap'|'resource-font-face'|'unavailable',
 *  text: string,
 *  fontFamily: string,
 *  fontPx: number,
 *  color?: string,
 *  align?: 'left'|'center'|'right',
 *  verticalAlign?: string,
 *  alpha?: number,
 *  shadow?: boolean,
 * }} TextDrawInfo
 */

/**
 * @typedef {Object} CanvasView
 * @property {number} zoom
 * @property {number} viewX World-space coordinate of the left edge of the viewport.
 * @property {number} viewY World-space coordinate of the top edge of the viewport.
 */

/**
 * Resize handle rectangle in world-space coordinates.
 *
 * @typedef {{
 *  kind: 'nw'|'ne'|'sw'|'se',
 *  x: number,
 *  y: number,
 *  w: number,
 *  h: number,
 *  clipRect?: { x:number, y:number, w:number, h:number }|null,
 * }} ResizeHandle
 */

/**
 * Build 8 corner/edge resize handles for a layout box.
 *
 * Handles are sized in CSS pixels and converted to world units based on current zoom,
 * so they remain a constant on-screen size.
 *
 * @param {LayoutBox} box
 * @param {CanvasView} view
 * @param {{ handlePx?: number }} [opts]
 * @returns {ResizeHandle[]}
 */
export function getResizeHandlesForBox(box, view, opts = {}) {
  const z = clampZoom(view && typeof view.zoom === 'number' ? view.zoom : 1);

  const handlePxRaw = opts && typeof opts.handlePx === 'number' ? opts.handlePx : 10;
  const handlePx = Math.max(4, Math.min(24, handlePxRaw));

  const sizeWorld = handlePx / z;
  const half = sizeWorld / 2;

  const x = Number(box && box.x) || 0;
  const y = Number(box && box.y) || 0;
  const w = Number(box && box.w) || 0;
  const h = Number(box && box.h) || 0;

  const left = x;
  const top = y;
  const right = x + w;
  const bottom = y + h;
  const clipRect = box && box.clipRect ? { ...box.clipRect } : null;

  return [
    { kind: 'nw', x: left - half, y: top - half, w: sizeWorld, h: sizeWorld, clipRect },
    { kind: 'ne', x: right - half, y: top - half, w: sizeWorld, h: sizeWorld, clipRect },
    { kind: 'sw', x: left - half, y: bottom - half, w: sizeWorld, h: sizeWorld, clipRect },
    { kind: 'se', x: right - half, y: bottom - half, w: sizeWorld, h: sizeWorld, clipRect },
    { kind: 'n', x: (left + right) / 2 - half, y: top - half, w: sizeWorld, h: sizeWorld, clipRect },
    { kind: 'e', x: right - half, y: (top + bottom) / 2 - half, w: sizeWorld, h: sizeWorld, clipRect },
    { kind: 's', x: (left + right) / 2 - half, y: bottom - half, w: sizeWorld, h: sizeWorld, clipRect },
    { kind: 'w', x: left - half, y: (top + bottom) / 2 - half, w: sizeWorld, h: sizeWorld, clipRect },
  ];
}

/**
 * Hit-test resize handles in world coordinates.
 *
 * @param {ResizeHandle[]} handles
 * @param {number} worldX
 * @param {number} worldY
 * @param {{width?:number,height?:number}|null} [viewport]
 * @returns {ResizeHandle|null}
 */
export function hitTestResizeHandles(handles, worldX, worldY, viewport = null) {
  if (!Array.isArray(handles) || handles.length === 0) return null;
  const x = Number(worldX);
  const y = Number(worldY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (viewport) {
    const width = Number(viewport.width);
    const height = Number(viewport.height);
    if (Number.isFinite(width) && Number.isFinite(height)
      && (x < 0 || y < 0 || x > width || y > height)) return null;
  }

  let nearest = null, nearestDistance = Infinity;
  for (const h of handles) {
    if (!h) continue;
    const hx = Number(h.x);
    const hy = Number(h.y);
    const hw = Number(h.w);
    const hh = Number(h.h);
    if (!Number.isFinite(hx) || !Number.isFinite(hy) || !Number.isFinite(hw) || !Number.isFinite(hh))
      continue;
    if (h.clipRect && !pointInRect(h.clipRect, x, y)) continue;
    if (x >= hx && x <= hx + hw && y >= hy && y <= hy + hh) {
      const distance = (x - hx - hw / 2) ** 2 + (y - hy - hh / 2) ** 2;
      if (distance < nearestDistance) { nearest = h; nearestDistance = distance; }
    }
  }
  return nearest;
}

export const DEFAULT_CANVAS_PRESET = Object.freeze({ width: 1920, height: 1080 });
const DEFAULT_MIN_ZOOM = 0.05;
const DEFAULT_MAX_ZOOM = 8;

/**
 * Intersect two axis-aligned world-space rectangles. A null clip means
 * unbounded; an empty intersection is retained as a zero-size rectangle so
 * callers can distinguish it from "no clipping".
 *
 * Bedrock exposes `clips_children` and scroll viewports, but the exact runtime
 * scissor ordering is not fully specified by the public JSON UI references.
 * The preview therefore approximates it with nested axis-aligned intersections.
 *
 * @param {{ x:number, y:number, w:number, h:number }|null|undefined} inherited
 * @param {{ x:number, y:number, w:number, h:number }} local
 * @returns {{ x:number, y:number, w:number, h:number }}
 */
function intersectClipRects(inherited, local) {
  const lx = Number(local && local.x) || 0;
  const ly = Number(local && local.y) || 0;
  const lr = lx + Math.max(0, Number(local && local.w) || 0);
  const lb = ly + Math.max(0, Number(local && local.h) || 0);
  if (!inherited) return { x: lx, y: ly, w: Math.max(0, lr - lx), h: Math.max(0, lb - ly) };

  const ix = Number(inherited.x) || 0;
  const iy = Number(inherited.y) || 0;
  const ir = ix + Math.max(0, Number(inherited.w) || 0);
  const ib = iy + Math.max(0, Number(inherited.h) || 0);
  const x = Math.max(ix, lx);
  const y = Math.max(iy, ly);
  const right = Math.min(ir, lr);
  const bottom = Math.min(ib, lb);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** @param {{ x:number, y:number, w:number, h:number }} rect @param {number} x @param {number} y */
function pointInRect(rect, x, y) {
  if (!rect) return true;
  const rx = Number(rect.x) || 0;
  const ry = Number(rect.y) || 0;
  const rw = Math.max(0, Number(rect.w) || 0);
  const rh = Math.max(0, Number(rect.h) || 0);
  if (rw <= 0 || rh <= 0) return false;
  return x >= rx && y >= ry && x <= rx + rw && y <= ry + rh;
}

/**
 * Clamp zoom to a reasonable range so hit-testing and handle sizes remain stable.
 *
 * @param {any} zoom
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number}
 */
export function clampZoom(zoom, min = DEFAULT_MIN_ZOOM, max = DEFAULT_MAX_ZOOM) {
  const zRaw = typeof zoom === 'number' ? zoom : typeof zoom === 'string' ? Number(zoom) : NaN;
  const z = Number.isFinite(zRaw) ? zRaw : 1;
  const lo = Number.isFinite(min) ? min : DEFAULT_MIN_ZOOM;
  const hi = Number.isFinite(max) ? max : DEFAULT_MAX_ZOOM;
  if (hi <= lo) return Math.max(0.0001, z);
  return Math.max(lo, Math.min(hi, z));
}

/**
 * Compute an initial canvas view that fits a world-space preset inside a viewport.
 *
 * @param {number} viewportPxW
 * @param {number} viewportPxH
 * @param {CanvasPreset} preset
 * @param {number} [marginPx]
 * @returns {CanvasView}
 */
export function fitViewToPreset(viewportPxW, viewportPxH, preset, marginPx = 0) {
  const vw = Number(viewportPxW) || 0;
  const vh = Number(viewportPxH) || 0;

  const pw = Number(preset && preset.width) || DEFAULT_CANVAS_PRESET.width;
  const ph = Number(preset && preset.height) || DEFAULT_CANVAS_PRESET.height;

  const m = Math.max(0, Number(marginPx) || 0);
  const availW = Math.max(1, vw - m * 2);
  const availH = Math.max(1, vh - m * 2);

  const zFit = Math.min(availW / pw, availH / ph);
  const zoom = clampZoom(zFit);

  const worldViewW = vw / zoom;
  const worldViewH = vh / zoom;

  return {
    zoom,
    viewX: (pw - worldViewW) / 2,
    viewY: (ph - worldViewH) / 2,
  };
}

/**
 * Fit one authored UI rectangle instead of the entire logical screen.  This is
 * the useful default for compact inventory dialogs inside a 320x180 viewport.
 */
export function fitViewToBounds(viewportPxW, viewportPxH, bounds, marginPx = 24, maxZoom = 8) {
  const vw = Math.max(1, Number(viewportPxW) || 1);
  const vh = Math.max(1, Number(viewportPxH) || 1);
  const x = Number(bounds && bounds.x) || 0;
  const y = Number(bounds && bounds.y) || 0;
  const w = Math.max(1, Number(bounds && bounds.w) || 1);
  const h = Math.max(1, Number(bounds && bounds.h) || 1);
  const margin = Math.max(0, Number(marginPx) || 0);
  const zoom = clampZoom(
    Math.min(Math.max(1, vw - margin * 2) / w, Math.max(1, vh - margin * 2) / h),
    DEFAULT_MIN_ZOOM,
    Number.isFinite(Number(maxZoom)) ? Number(maxZoom) : DEFAULT_MAX_ZOOM,
  );
  return {
    zoom,
    viewX: x + w / 2 - vw / zoom / 2,
    viewY: y + h / 2 - vh / zoom / 2,
  };
}

/** Infer Minecraft's integer UI scale from one logical/observed calibration. */
export function inferObservedUiScale(calibration, fallback = 4) {
  const logicalW = Number(calibration && calibration.logicalWidth);
  const logicalH = Number(calibration && calibration.logicalHeight);
  const observedW = Number(calibration && calibration.observedWidth);
  const observedH = Number(calibration && calibration.observedHeight);
  const candidates = [];
  if (logicalW > 0 && observedW > 0) candidates.push(observedW / logicalW);
  if (logicalH > 0 && observedH > 0) candidates.push(observedH / logicalH);
  if (!candidates.length) return Math.max(1, Math.min(8, Math.round(Number(fallback) || 4)));
  const average = candidates.reduce((sum, value) => sum + value, 0) / candidates.length;
  return Math.max(1, Math.min(8, Math.round(average)));
}

/** Observed Classic JSON UI logical font sizes (scaled by the UI camera later). */
export function getBedrockLogicalFontPx(fontSize) {
  const key = String(fontSize || 'normal').trim().toLowerCase();
  if (key === 'small') return 6;
  if (key === 'large') return 10;
  if (key === 'extra_large') return 12;
  return 8;
}

/**
 * Deterministic fallback metrics for labels when the runtime font atlas is not
 * available. Callers with a browser canvas may replace only the measured
 * width; the logical line height and formatting-code handling stay identical.
 */
export function estimateTextIntrinsicSize(props, resolvedText) {
  const source = resolvedText === undefined ? resolveLocalTextToken(props && props.text, props) : resolvedText;
  const text = typeof source === 'string' ? source.replace(/\u00a7./gu, '') : '';
  const scaleRaw = Number(props && props.font_scale_factor);
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
  const lineHeight = getBedrockLogicalFontPx(props && props.font_size) * scale;
  const rawPadding = Number(props && props.line_padding);
  const linePadding = Number.isFinite(rawPadding) && rawPadding >= 0 ? Math.min(4096, rawPadding) : 0;
  const lines = text.split(/\r?\n/u);
  let width = 0;
  for (const line of lines) {
    let advance = 0;
    for (const char of Array.from(line)) {
      if (/\s/u.test(char)) advance += lineHeight * 0.35;
      else if (/^[ilI.,'`:;!|]$/u.test(char)) advance += lineHeight * 0.35;
      else if (/^[MW@#%&]$/u.test(char)) advance += lineHeight * 0.85;
      else if (/^[\u0000-\u007f]$/u.test(char)) advance += lineHeight * 0.58;
      else advance += lineHeight * 0.95;
    }
    width = Math.max(width, advance);
  }
  return {
    w: Math.max(0, Math.round(width * 100) / 100),
    h: Math.max(0, Math.round((lineHeight * Math.max(1, lines.length) + Math.max(0,lines.length-1)*linePadding) * 100) / 100),
  };
}

function resolveLocalTextToken(value, props, maxDepth = 8, preserveUnresolved = false) {
  let current = value;
  const seen = new Set();
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (typeof current !== 'string') return current;
    const token = current.trim();
    if (!/^[#$][A-Za-z0-9_:@.\-]+$/u.test(token)) return current;
    if (seen.has(token)) return preserveUnresolved ? current : '';
    seen.add(token);
    const bare = token.slice(1);
    if (props && Object.prototype.hasOwnProperty.call(props, bare)) {
      current = props[bare];
      continue;
    }
    if (props && Object.prototype.hasOwnProperty.call(props, token)) {
      current = props[token];
      continue;
    }
    return preserveUnresolved ? current : '';
  }
  return preserveUnresolved ? current : '';
}

/**
 * Convert canvas CSS pixel coordinates into world-space coordinates.
 *
 * @param {number} canvasPxX
 * @param {number} canvasPxY
 * @param {CanvasView} view
 * @returns {{ x:number, y:number }}
 */
export function canvasPxToWorld(canvasPxX, canvasPxY, view) {
  const z = clampZoom(view && typeof view.zoom === 'number' ? view.zoom : 1);
  const vx = Number(view && typeof view.viewX === 'number' ? view.viewX : 0) || 0;
  const vy = Number(view && typeof view.viewY === 'number' ? view.viewY : 0) || 0;
  const px = Number(canvasPxX) || 0;
  const py = Number(canvasPxY) || 0;
  return { x: vx + px / z, y: vy + py / z };
}



const DEFAULT_MAX_BOXES = 5000;

/**
 * @param {any} v
 * @returns {number|null}
 */
function toFiniteNumber(v) {
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a boolean-like property without letting an unresolved expression hide
 * or otherwise alter a control. The model normally supplies booleans; the
 * additional coercions cover evaluated bindings and legacy/raw fixtures.
 *
 * @param {any} props
 * @param {string} key
 * @returns {boolean}
 */
function isBooleanLikeEnabled(props, key) {
  try {
    if (!props || typeof props !== 'object' || !Object.prototype.hasOwnProperty.call(props, key)) return false;
    const value = props[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Return true only for an explicitly-authored boolean-like false value.
 * Unknown/runtime expressions retain the default behavior instead of silently
 * disabling a safety boundary in the static preview.
 *
 * @param {any} props
 * @param {string} key
 * @returns {boolean}
 */
function isBooleanLikeDisabled(props, key) {
  try {
    if (!props || typeof props !== 'object' || !Object.prototype.hasOwnProperty.call(props, key)) return false;
    const value = props[key];
    if (typeof value === 'boolean') return !value;
    if (typeof value === 'number') return value === 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off';
    }
    return false;
  } catch {
    return false;
  }
}

function isControlEnabledInSafeMode(props) {
  if (!props || typeof props !== 'object' || !Object.prototype.hasOwnProperty.call(props, 'enabled')) return true;
  const value = props.enabled;
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return /^(?:true|1|yes|on)$/iu.test(value.trim());
  return false;
}

function readBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (/^(?:true|1|yes|on)$/u.test(normalized)) return true;
    if (/^(?:false|0|no|off)$/u.test(normalized)) return false;
  }
  return null;
}

/**
 * Apply a texture sidecar's logical `base_size` only to axes whose `default`
 * size was explicitly authored on the image control.
 *
 * Omitted image sizes have different Bedrock semantics: they fill the parent.
 * The normalized model still exposes `["default", "default"]` for those
 * controls, so checking the normalized value alone incorrectly collapses edit
 * box state images (and any similar pack control) to the texture's tiny source
 * size.
 *
 * @param {any} node
 * @param {unknown} currentSize
 * @param {unknown} baseSize
 * @returns {[number|string, number|string]|null}
 */
export function mergeExplicitTextureBaseSize(node, currentSize, baseSize) {
  if (!node || node.propsPresent?.size !== true) return null;
  if (!Array.isArray(currentSize) || currentSize.length < 2) return null;
  if (!Array.isArray(baseSize) || baseSize.length < 2) return null;

  const logicalBaseSize = [Number(baseSize[0]), Number(baseSize[1])];
  if (!logicalBaseSize.every((value) => Number.isFinite(value) && value > 0)) return null;

  const widthIsDefault = String(currentSize[0]).trim().toLowerCase() === 'default';
  const heightIsDefault = String(currentSize[1]).trim().toLowerCase() === 'default';
  if (!widthIsDefault && !heightIsDefault) return null;

  return [
    widthIsDefault ? logicalBaseSize[0] : currentSize[0],
    heightIsDefault ? logicalBaseSize[1] : currentSize[1],
  ];
}

/** Normalize authored image properties without evaluating runtime expressions. */
export function buildImageDrawMetadataFromProps(props) {
  const safeProps = props && typeof props === 'object' ? props : {};
  const uv = Array.isArray(safeProps.uv) && safeProps.uv.length >= 2
    ? [toFiniteNumber(safeProps.uv[0]), toFiniteNumber(safeProps.uv[1])]
    : null;
  // Vanilla templates use `uv_size: []` as an optional/default sentinel. It
  // means “no crop”, not an invalid or zero-area source rectangle.
  const hasUvSize = Object.prototype.hasOwnProperty.call(safeProps, 'uv_size')
    && !(Array.isArray(safeProps.uv_size) && safeProps.uv_size.length === 0);
  const rawUvSize = hasUvSize && Array.isArray(safeProps.uv_size) && safeProps.uv_size.length >= 2
    ? [toFiniteNumber(safeProps.uv_size[0]), toFiniteNumber(safeProps.uv_size[1])]
    : null;
  let uvSizeState = 'absent';
  let uvSize = null;
  if (hasUvSize) {
    if (!rawUvSize || rawUvSize.some((value) => value === null || value < 0)) {
      uvSizeState = 'invalid';
    } else if (rawUvSize[0] === 0 || rawUvSize[1] === 0) {
      uvSizeState = 'zero';
      uvSize = /** @type {[number, number]} */ (rawUvSize);
    } else {
      uvSizeState = 'valid';
      uvSize = /** @type {[number, number]} */ (rawUvSize);
    }
  }

  const perEdge = [
    toFiniteNumber(safeProps.nine_slice_left),
    toFiniteNumber(safeProps.nine_slice_top),
    toFiniteNumber(safeProps.nine_slice_right),
    toFiniteNumber(safeProps.nine_slice_bottom ?? safeProps.nine_slice_buttom),
  ];
  const hasPerEdgeNineSlice = [
    'nine_slice_left',
    'nine_slice_top',
    'nine_slice_right',
    'nine_slice_bottom',
    'nine_slice_buttom',
  ].some((key) => Object.prototype.hasOwnProperty.call(safeProps, key));
  const nineSlice = hasPerEdgeNineSlice
    ? perEdge.map((value) => value === null ? 0 : value)
    : typeof safeProps.nineslice_size === 'number' || Array.isArray(safeProps.nineslice_size)
      ? safeProps.nineslice_size
      : null;

  const tiledRaw = safeProps.tiled;
  let tiled = false;
  if (tiledRaw === true || readBooleanLike(tiledRaw) === true) tiled = 'both';
  else if (typeof tiledRaw === 'string') {
    const normalized = tiledRaw.trim().toLowerCase();
    if (normalized === 'x' || normalized === 'horizontal') tiled = 'x';
    else if (normalized === 'y' || normalized === 'vertical') tiled = 'y';
    else if (normalized === 'both' || normalized === 'xy') tiled = 'both';
  }
  const rawTiledScale = Array.isArray(safeProps.tiled_scale)
    ? safeProps.tiled_scale
    : [safeProps.tiled_scale, safeProps.tiled_scale];
  const tiledScale = rawTiledScale.length >= 2
    ? rawTiledScale.slice(0, 2).map((value) => {
      const number = toFiniteNumber(value);
      return number !== null && number > 0 ? Math.max(0.01, Math.min(64, number)) : 1;
    })
    : [1, 1];

  const hasClipRatio = Object.prototype.hasOwnProperty.call(safeProps, 'clip_ratio');
  const ratio = toFiniteNumber(safeProps.clip_ratio);
  const directionRaw = typeof safeProps.clip_direction === 'string'
    ? safeProps.clip_direction.trim().toLowerCase()
    : '';
  const hasClipDirection = Object.prototype.hasOwnProperty.call(safeProps, 'clip_direction');
  const clipDirection = ['left', 'right', 'up', 'down', 'center'].includes(directionRaw)
    ? directionRaw
    : hasClipDirection
      ? null
      : 'left';
  const tintChannels = Array.isArray(safeProps.color) && (safeProps.color.length === 3 || safeProps.color.length === 4)
    ? safeProps.color.map(toFiniteNumber)
    : null;
  const tint = tintChannels && tintChannels.every((value) => value !== null)
    ? [
        Math.max(0, Math.min(1, tintChannels[0])),
        Math.max(0, Math.min(1, tintChannels[1])),
        Math.max(0, Math.min(1, tintChannels[2])),
        tintChannels.length === 4 ? Math.max(0, Math.min(1, tintChannels[3])) : 1,
      ]
    : null;

  return {
    keepRatio: readBooleanLike(safeProps.keep_ratio) ?? true,
    bilinear: readBooleanLike(safeProps.bilinear) ?? false,
    alpha: clampAlpha(safeProps.alpha, 1),
    uv: uv && uv.every((value) => value !== null) ? uv : null,
    uvSize,
    uvSizeState,
    nineSlice,
    baseSize: null,
    fill: readBooleanLike(safeProps.fill) ?? false,
    tiled,
    tiledScale,
    clipRatio: !hasClipRatio ? null : ratio === null || clipDirection === null ? 0 : Math.max(0, Math.min(1, ratio)),
    clipDirection,
    clipPixelPerfect: readBooleanLike(safeProps.clip_pixelperfect) ?? true,
    tint,
    grayscale: readBooleanLike(safeProps.grayscale) ?? false,
  };
}

/**
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
function clampAlpha(value, fallback = 1) {
  const number = toFiniteNumber(value);
  if (number === null) return fallback;
  return Math.max(0, Math.min(1, number));
}

/**
 * Best-effort visibility gate.
 *
 * Bedrock JSON UI commonly uses a `visible` property. Our bindings evaluator
 * attempts to coerce it to a boolean when possible, but the canvas preview
 * must also tolerate:
 * - raw file values (string/number)
 * - partial/unknown shapes
 *
 * Security/stability note:
 * - This function MUST NOT throw.
 * - Safe preview fails closed for an explicitly-authored but unresolved value.
 *   This prevents mutually-exclusive runtime branches from all being painted at
 *   once (a common source of misleading HUD previews).
 * - Structure preview keeps the historical fail-open behavior so authors can
 *   still inspect every unresolved branch when debugging a resource pack.
 *
 * @param {any} props
 * @param {{ mode?: 'safe'|'structure'|'debug' }} [opts]
 * @returns {boolean}
 */
export function isVisibleFromProps(props, opts = {}) {
  const modeRaw = opts && typeof opts.mode === 'string' ? opts.mode.trim().toLowerCase() : 'safe';
  const showUnresolved = modeRaw === 'structure' || modeRaw === 'debug';

  try {
    if (!props || typeof props !== 'object') return true;
    if (Object.prototype.hasOwnProperty.call(props, 'ignored')) {
      const ignored = props.ignored;
      if (typeof ignored === 'boolean') {
        if (ignored) return false;
      } else if (typeof ignored === 'number') {
        if (ignored !== 0) return false;
      } else if (typeof ignored === 'string') {
        const normalized = ignored.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return false;
        if (normalized !== 'false' && normalized !== '0' && normalized !== 'no' && normalized !== 'off') {
          // An explicit ignored expression is runtime-dependent too.
          if (!showUnresolved) return false;
        }
      } else if (ignored !== undefined && ignored !== null && !showUnresolved) {
        return false;
      }
    }
    if (!Object.prototype.hasOwnProperty.call(props, 'visible')) return true;

    const v = /** @type {any} */ (props).visible;
    if (v === undefined || v === null) return showUnresolved;

    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = String(v).trim().toLowerCase();
      if (!s) return showUnresolved;
      if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === 'hidden') return false;
      if (s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'visible') return true;

      const n = Number(s);
      if (Number.isFinite(n)) return n !== 0;

      // Unknown string (commonly an unevaluated #/$ binding or expression).
      return showUnresolved;
    }

    return showUnresolved;
  } catch {
    return showUnresolved;
  }
}

/** Count boxes that the normal (guides-off) renderer can actually paint. */
export function countDrawableCanvasBoxes({
  boxes,
  nodesById,
  propsByIdOverride,
  isTextureResolvable,
  isCustomDrawable,
} = {}) {
  const list = Array.isArray(boxes) ? boxes : [];
  const nodes = nodesById && typeof nodesById === 'object' ? nodesById : {};
  const overrides = propsByIdOverride && typeof propsByIdOverride === 'object' ? propsByIdOverride : {};
  let count = 0;
  for (const box of list) {
    if (!box) continue;
    const id = String(box.id || '');
    const node = nodes[id] && typeof nodes[id] === 'object' ? nodes[id] : null;
    const type = String(box.type || node?.type || '').toLowerCase();
    const props = {
      ...(node?.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {}),
      ...(node?.props && typeof node.props === 'object' ? node.props : {}),
      ...(overrides[id] && typeof overrides[id] === 'object' ? overrides[id] : {}),
    };
    const width = Number(box.w) || 0;
    const height = Number(box.h) || 0;
    const renderAlpha = Number.isFinite(Number(box.renderAlpha)) ? Number(box.renderAlpha) : Number(props.alpha ?? 1);
    const clip = box.clipRect && typeof box.clipRect === 'object' ? box.clipRect : null;
    if (width <= 0 || height <= 0 || renderAlpha <= 0 || (clip && (!(Number(clip.w) > 0) || !(Number(clip.h) > 0)))) continue;
    if (type === 'image' && typeof props.texture === 'string' && props.texture.trim()) {
      const imageMetadata = buildImageDrawMetadataFromProps(props);
      if (imageMetadata.uvSizeState === 'zero' || imageMetadata.uvSizeState === 'invalid') continue;
      if (imageMetadata.clipRatio !== null && !(imageMetadata.clipRatio > 0)) continue;
      if (!(imageMetadata.alpha > 0)) continue;
      if (Array.isArray(imageMetadata.tint) && !(Number(imageMetadata.tint[3]) > 0)) continue;
      const fileSystem = typeof props.texture_file_system === 'string' ? props.texture_file_system : '';
      if (fileSystem && fileSystem !== 'InUserPackage' && fileSystem !== 'InAppPackage') continue;
      const textureRef = resolveLocalTextToken(props.texture, props);
      if (typeof textureRef !== 'string' || !textureRef.trim() || /^[#$@]/u.test(textureRef.trim())) continue;
      if (typeof isTextureResolvable === 'function' && !isTextureResolvable(textureRef)) continue;
      count += 1;
      continue;
    }
    if (type === 'custom' && typeof isCustomDrawable === 'function' && isCustomDrawable(props, box)) {
      count += 1;
      continue;
    }
    if (type === 'label' || type === 'button' || type === 'dropdown' || type === 'edit_box') {
      const rawText = selectPreviewText(type, props, (value, localProps) => resolveLocalTextToken(value, localProps, 8, true));
      const text = String(rawText).trim();
      const unresolvedRuntimeText = text.startsWith('#') || text.startsWith('$');
      if (text && !unresolvedRuntimeText) count += 1;
    }
  }
  return count;
}

/**
 * Compute a pack-name-independent union of pixels the normal renderer can
 * paint. This is used only by the explicit “fit UI” convenience action; the
 * initial camera always shows the full logical device viewport.
 */
export function findDrawableCanvasBounds({
  layout,
  nodesById,
  propsByIdOverride,
  isTextureResolvable,
  isCustomDrawable,
} = {}) {
  const boxes = Array.isArray(layout?.boxes) ? layout.boxes : [];
  const nodes = nodesById && typeof nodesById === 'object' ? nodesById : {};
  const overrides = propsByIdOverride && typeof propsByIdOverride === 'object' ? propsByIdOverride : {};
  const presetWidth = Math.max(0, Number(layout?.preset?.width) || 0);
  const presetHeight = Math.max(0, Number(layout?.preset?.height) || 0);
  let bounds = null;

  const includeRect = (box) => {
    let left = Number(box.x) || 0;
    let top = Number(box.y) || 0;
    let right = left + Math.max(0, Number(box.w) || 0);
    let bottom = top + Math.max(0, Number(box.h) || 0);
    const clip = box.clipRect && typeof box.clipRect === 'object' ? box.clipRect : null;
    if (clip) {
      left = Math.max(left, Number(clip.x) || 0);
      top = Math.max(top, Number(clip.y) || 0);
      right = Math.min(right, (Number(clip.x) || 0) + Math.max(0, Number(clip.w) || 0));
      bottom = Math.min(bottom, (Number(clip.y) || 0) + Math.max(0, Number(clip.h) || 0));
    }
    if (presetWidth > 0 && presetHeight > 0) {
      left = Math.max(0, left);
      top = Math.max(0, top);
      right = Math.min(presetWidth, right);
      bottom = Math.min(presetHeight, bottom);
    }
    if (!(right > left) || !(bottom > top)) return;
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, left),
          minY: Math.min(bounds.minY, top),
          maxX: Math.max(bounds.maxX, right),
          maxY: Math.max(bounds.maxY, bottom),
        }
      : { minX: left, minY: top, maxX: right, maxY: bottom };
  };

  for (const box of boxes) {
    if (!box || !(Number(box.w) > 0) || !(Number(box.h) > 0) || !(Number(box.renderAlpha ?? 1) > 0)) continue;
    const id = String(box.id || '');
    const node = nodes[id] && typeof nodes[id] === 'object' ? nodes[id] : null;
    const props = {
      ...(node?.unknownProps || {}),
      ...(node?.props || {}),
      ...(overrides[id] || {}),
    };
    const type = String(box.type || node?.type || '').toLowerCase();
    if (type === 'image') {
      const metadata = buildImageDrawMetadataFromProps(props);
      const textureRef = resolveLocalTextToken(props.texture, props);
      const fileSystem = typeof props.texture_file_system === 'string' ? props.texture_file_system : '';
      if (typeof textureRef !== 'string' || !textureRef.trim() || /^[#$@]/u.test(textureRef.trim())) continue;
      if (fileSystem && fileSystem !== 'InUserPackage' && fileSystem !== 'InAppPackage') continue;
      if (metadata.uvSizeState === 'zero' || metadata.uvSizeState === 'invalid') continue;
      if (metadata.clipRatio !== null && !(metadata.clipRatio > 0)) continue;
      if (!(metadata.alpha > 0) || (Array.isArray(metadata.tint) && !(Number(metadata.tint[3]) > 0))) continue;
      if (typeof isTextureResolvable === 'function' && !isTextureResolvable(textureRef)) continue;
      const visibleDestination = computeImageClipRect(
        box,
        metadata.clipRatio,
        metadata.clipDirection || 'left',
        metadata.clipPixelPerfect,
      );
      if (visibleDestination) includeRect({ ...visibleDestination, clipRect: box.clipRect || null });
      continue;
    }
    if (type === 'custom' && typeof isCustomDrawable === 'function' && isCustomDrawable(props, box)) {
      includeRect(box);
      continue;
    }
    if (type === 'label' || type === 'button' || type === 'dropdown' || type === 'edit_box') {
      const resolvedText = selectPreviewText(type, props, (value, localProps) => resolveLocalTextToken(value, localProps, 8, true));
      if (typeof resolvedText === 'string' && resolvedText.trim() && !/^[#$]/u.test(resolvedText.trim())) includeRect(box);
    }
  }

  if (!bounds) return null;
  const result = {
    x: bounds.minX,
    y: bounds.minY,
    w: bounds.maxX - bounds.minX,
    h: bounds.maxY - bounds.minY,
  };
  if (presetWidth > 0 && presetHeight > 0
    && result.w >= presetWidth * 0.9 && result.h >= presetHeight * 0.9) return null;
  return result;
}

export function shouldShowCanvasEmptyState({ hasPreviewFile, hasLayoutError, renderedBoxes, drawableBoxes }) {
  if (!hasPreviewFile || hasLayoutError) return false;
  if (Number(renderedBoxes) === 0) return true;
  return Number.isFinite(Number(drawableBoxes)) && Number(drawableBoxes) === 0;
}

/**
 * @param {string} s
 * @returns {number|null}
 */
function parsePercent(s) {
  const str = String(s || '').trim();
  if (!str.endsWith('%')) return null;
  const n = Number(str.slice(0, -1));
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

/**
 * Parse a deliberately small, non-executable linear dimension expression.
 * Bedrock UI commonly uses values such as `100% - 44px`.  Supporting only
 * signed numeric/%/px terms avoids pretending to evaluate the wider runtime
 * expression language.
 *
 * @param {string} value
 * @param {number} parent
 * @returns {number|null}
 */
function parseLinearScalarExpression(value, parent, opts = {}) {
  const expression = String(value || '').trim().toLowerCase();
  // Require an operator between terms before removing whitespace. Otherwise
  // malformed sizes such as "10px20px", "1.2.3", and "10 20" silently become
  // valid sums or concatenated numbers, suppressing the unsupported diagnostic.
  const expressionPattern = /^[+-]?\s*(?:\d+(?:\.\d+)?|\.\d+)(?:%cm|%sm|%c|%x|%y|%|px)?(?:\s*[+-]\s*(?:\d+(?:\.\d+)?|\.\d+)(?:%cm|%sm|%c|%x|%y|%|px)?)*$/u;
  if (!expressionPattern.test(expression)) return null;
  const compact = expression.replace(/\s+/g, '');
  if (!compact) return null;
  const termPattern = /[+-]?(?:(?:\d+(?:\.\d+)?)|(?:\.\d+))(?:%cm|%sm|%c|%x|%y|%|px)?/g;
  const terms = compact.match(termPattern);
  if (!terms || terms.join('') !== compact) return null;
  let result = 0;
  for (const term of terms) {
    const match = term.match(/^([+-]?)(\d+(?:\.\d+)?|\.\d+)(%cm|%sm|%c|%x|%y|%|px)?$/);
    if (!match) return null;
    const sign = match[1] === '-' ? -1 : 1;
    const amount = Number(match[2]);
    if (!Number.isFinite(amount)) return null;
    const unit = match[3] || '';
    let basis = 1;
    if (unit === '%') {
      const percentBase = opts.percentBase;
      basis = (Number.isFinite(percentBase) ? percentBase : parent) / 100;
    }
    else if (unit === '%c') basis = (Number(opts.content) || 0) / 100;
    else if (unit === '%cm') basis = (Number(opts.contentMax ?? opts.content) || 0) / 100;
    else if (unit === '%sm') {
      const siblingMax = Number(opts.siblingMax);
      basis = (Number.isFinite(siblingMax) ? siblingMax : parent) / 100;
    }
    else if (unit === '%x') {
      const selfW = Number(opts.selfW);
      if (!Number.isFinite(selfW)) return null;
      basis = selfW / 100;
    }
    else if (unit === '%y') {
      const selfH = Number(opts.selfH);
      if (!Number.isFinite(selfH)) return null;
      basis = selfH / 100;
    }
    result += sign * amount * basis;
  }
  if (!Number.isFinite(result)) return null;
  const roundedInteger = Math.round(result);
  return Math.abs(result - roundedInteger) < 1e-9 ? roundedInteger : result;
}

/**
 * @param {string} name
 * @returns {{ ax: number, ay: number }}
 */
function anchorToUnit(name) {
  const s = String(name || '').trim().toLowerCase();
  switch (s) {
    case 'top_left':
    case 'topleft':
      return { ax: 0, ay: 0 };
    case 'top_middle':
    case 'top_center':
    case 'topmiddle':
    case 'topcenter':
      return { ax: 0.5, ay: 0 };
    case 'top_right':
    case 'topright':
      return { ax: 1, ay: 0 };
    case 'left_middle':
    case 'middle_left':
    case 'center_left':
    case 'middleleft':
    case 'centerleft':
      return { ax: 0, ay: 0.5 };
    case 'middle':
    case 'center':
      return { ax: 0.5, ay: 0.5 };
    case 'right_middle':
    case 'middle_right':
    case 'center_right':
    case 'middleright':
    case 'centerright':
      return { ax: 1, ay: 0.5 };
    case 'bottom_left':
    case 'bottomleft':
      return { ax: 0, ay: 1 };
    case 'bottom_middle':
    case 'bottom_center':
    case 'bottommiddle':
    case 'bottomcenter':
      return { ax: 0.5, ay: 1 };
    case 'bottom_right':
    case 'bottomright':
      return { ax: 1, ay: 1 };
    default:
      return { ax: 0, ay: 0 };
  }
}

/**
 * @param {string} type
 * @param {number} parentW
 * @param {number} parentH
 * @returns {{ w: number, h: number }}
 */
function fallbackSizeForType(type, parentW, parentH) {
  const t = String(type || '').toLowerCase();
  // Container-like elements default to fill parent.
  if (t === 'screen' || t === 'panel' || t === 'input_panel' || t === 'stack_panel' || t === 'grid' || t === 'scroll_view' || t === 'file') {
    return { w: parentW, h: parentH };
  }
  if (t === 'label') return { w: 0, h: 8 };
  if (t === 'button' || t === 'dropdown') return { w: 200, h: 40 };
  if (t === 'image') return { w: 96, h: 96 };
  if (t === 'edit_box') return { w: parentW, h: parentH };
  return { w: 120, h: 80 };
}

function contentFallbackSizeForType(type, props, sizing, base) {
  const t = String(type || '').toLowerCase();
  const contentW = Math.max(0, Number(sizing && sizing.contentW) || 0);
  const contentH = Math.max(0, Number(sizing && sizing.contentH) || 0);
  const contentMaxW = Math.max(0, Number(sizing && sizing.contentMaxW) || 0);
  const contentMaxH = Math.max(0, Number(sizing && sizing.contentMaxH) || 0);
  const hasMeasuredContent = Boolean(sizing && sizing.hasMeasuredChildren);
  const explicitSize = readVec2(props && props.size);
  const explicitlyDefault = (value) => typeof value === 'string' && value.trim().toLowerCase() === 'default';
  const explicitDefaultW = explicitlyDefault(explicitSize && explicitSize.x);
  const explicitDefaultH = explicitlyDefault(explicitSize && explicitSize.y);

  // Stack panels and grids have type-specific natural axes. A structural
  // panel's explicit `default`, however, is its inherited parent extent. If a
  // panel is content-fitted here, stock layouts such as the workbench center a
  // fixed input grid inside an 84px label instead of the authored 176px host.
  // Omitted size remains a separate, propsPresent-aware policy below.

  if (t === 'stack_panel' && (hasMeasuredContent || explicitDefaultW || explicitDefaultH)) {
    const horizontal = String(props && props.orientation || 'vertical').toLowerCase() === 'horizontal';
    const measuredFallback = horizontal
      ? { w: contentW, h: contentMaxH }
      : { w: contentMaxW, h: contentH };
    return {
      w: hasMeasuredContent || explicitDefaultW ? measuredFallback.w : base.w,
      h: hasMeasuredContent || explicitDefaultH ? measuredFallback.h : base.h,
    };
  }
  if (
    (hasMeasuredContent || explicitDefaultW || explicitDefaultH)
    && (t === 'button' || t === 'dropdown' || t === 'toggle' || t === 'grid'
      || t === 'scroll_track' || t === 'scrollbar_box' || t === 'unknown')
  ) {
    return {
      w: hasMeasuredContent || explicitDefaultW ? contentW : base.w,
      h: hasMeasuredContent || explicitDefaultH ? contentH : base.h,
    };
  }
  return base;
}

const MAX_LAYOUT_EXTENT = 10_000_000;

function textIntrinsicSizeForLayout(props) {
  // Preview-only glyph metrics are separate from authored size. In particular,
  // a fixed width must not become the content basis of its own `%c` limit.
  const measured = props && props.__jsonui_preview_text_intrinsic_size;
  if (Array.isArray(measured) && measured.length === 2
    && [measured[0], measured[1]].every(value => typeof value === 'number' && Number.isFinite(value)
      && value >= 0 && value <= MAX_LAYOUT_EXTENT)) {
    return { w: measured[0], h: measured[1] };
  }
  return estimateTextIntrinsicSize(props);
}

function withLabelTextContent(type, props, sizing) {
  if (String(type || '').toLowerCase() !== 'label'
    || sizing.hasChildControls || sizing.hasMeasuredChildren) return sizing;
  const intrinsic = textIntrinsicSizeForLayout(props);
  // Leaf labels have text as content. Labels with controls also occur in stock
  // UI (network_world_type_icon); those keep the existing child-content basis.
  return { ...sizing, contentW: intrinsic.w, contentH: intrinsic.h,
    contentMaxW: intrinsic.w, contentMaxH: intrinsic.h };
}

function boundLayoutExtent(value, axis, sizing) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    if (typeof sizing?.onSizeLimit === 'function') sizing.onSizeLimit(axis, numeric, 'nonfinite');
    return 0;
  }
  if (numeric > MAX_LAYOUT_EXTENT) {
    if (typeof sizing?.onSizeLimit === 'function') sizing.onSizeLimit(axis, numeric, 'maximum');
    return MAX_LAYOUT_EXTENT;
  }
  return Math.max(0, numeric);
}

function boundLayoutCoordinate(value, axis, sizing, reason = 'position') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    if (typeof sizing?.onPositionLimit === 'function') sizing.onPositionLimit(axis, numeric, reason);
    if (numeric === Number.POSITIVE_INFINITY) return MAX_LAYOUT_EXTENT;
    if (numeric === Number.NEGATIVE_INFINITY) return -MAX_LAYOUT_EXTENT;
    return 0;
  }
  if (Math.abs(numeric) > MAX_LAYOUT_EXTENT) {
    if (typeof sizing?.onPositionLimit === 'function') sizing.onPositionLimit(axis, numeric, reason);
    return Math.sign(numeric) * MAX_LAYOUT_EXTENT;
  }
  return numeric;
}

function boundLayoutLayer(value, sizing, reason = 'layer') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    if (typeof sizing?.onLayerLimit === 'function') sizing.onLayerLimit(numeric, reason);
    if (numeric === Number.POSITIVE_INFINITY) return MAX_LAYOUT_EXTENT;
    if (numeric === Number.NEGATIVE_INFINITY) return -MAX_LAYOUT_EXTENT;
    return 0;
  }
  if (Math.abs(numeric) > MAX_LAYOUT_EXTENT) {
    if (typeof sizing?.onLayerLimit === 'function') sizing.onLayerLimit(numeric, reason);
    return Math.sign(numeric) * MAX_LAYOUT_EXTENT;
  }
  return numeric;
}

function shouldFillParentWhenSizeOmitted(node) {
  if (!node || !node.propsPresent || node.propsPresent.size !== false) return false;
  const type = String(node.type || '').trim().toLowerCase();
  if (type === 'factory' && isExplicitEventFactory38(node)) return true;
  if (
    type === 'screen' || type === 'panel' || type === 'input_panel' || type === 'stack_panel'
    || type === 'scroll_view' || type === 'scroll_track' || type === 'scrollbar_box'
    || type === 'image' || type === 'edit_box'
    // 原common.container_slot_button_prototypeはsizeを省略し、18pxの
    // container_item全体を入力面にする。省略だけを扱い、明示[0,0]は維持する。
    || type === 'button' || type === 'toggle' || type === 'dropdown' || type === 'custom'
  ) return true;
  return type === 'unknown' && Array.isArray(node.children) && node.children.length > 0;
}

function isRuntimeOnlyPreviewNode(node, visibilityMode) {
  if (visibilityMode !== 'safe' || !node) return false;
  const type = String(node.type || '').trim().toLowerCase();
  const props = {
    ...(node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {}),
    ...(node.props && typeof node.props === 'object' ? node.props : {}),
  };
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  // A factory's authored children are templates, not instantiated controls.
  // Safe mode must exclude the whole node consistently from both measurement
  // and traversal; otherwise an omitted factory can still inflate `%c`.
  if (type === 'factory') return !isExplicitEventFactory38(node);
  if (!hasChildren && Object.prototype.hasOwnProperty.call(props, 'factory') && props.factory) return true;
  // Native renderer pixels may be unavailable, but their authored geometry is
  // real JSON UI input. Keeping custom leaves in measurement is essential for
  // `%c` parents such as Loom's result-banner outline. Painting remains a
  // separate, fail-closed decision in the draw metadata path.
  return type === 'unknown' && !hasChildren;
}

/**
 * Compute the maximum width/height among every entry except the entry at the
 * same index. Prefix/suffix maxima keep very wide stack/grid definitions
 * linear instead of performing an O(n²) peer scan for untrusted pack input.
 *
 * @param {{w:number,h:number}[]} sizes
 * @returns {{w:number,h:number}[]}
 */
function computePeerMaxSizes(sizes) {
  const list = Array.isArray(sizes) ? sizes : [];
  const count = list.length;
  const prefixW = new Array(count + 1).fill(0);
  const prefixH = new Array(count + 1).fill(0);
  const suffixW = new Array(count + 1).fill(0);
  const suffixH = new Array(count + 1).fill(0);
  for (let index = 0; index < count; index += 1) {
    prefixW[index + 1] = Math.max(prefixW[index], Math.max(0, Number(list[index]?.w) || 0));
    prefixH[index + 1] = Math.max(prefixH[index], Math.max(0, Number(list[index]?.h) || 0));
  }
  for (let index = count - 1; index >= 0; index -= 1) {
    suffixW[index] = Math.max(suffixW[index + 1], Math.max(0, Number(list[index]?.w) || 0));
    suffixH[index] = Math.max(suffixH[index + 1], Math.max(0, Number(list[index]?.h) || 0));
  }
  return list.map((_, index) => ({
    w: Math.max(prefixW[index], suffixW[index + 1]),
    h: Math.max(prefixH[index], suffixH[index + 1]),
  }));
}

function resolveGridGaps(props) {
  const source = props && typeof props === 'object' ? props : {};
  const gap = toFiniteNumber(source.grid_gap) ?? toFiniteNumber(source.grid_spacing) ?? toFiniteNumber(source.gap) ?? 0;
  const rawX = toFiniteNumber(source.column_gap)
    ?? toFiniteNumber(source.grid_gap_x)
    ?? toFiniteNumber(source.grid_gapx)
    ?? toFiniteNumber(source.column_spacing)
    ?? gap;
  const rawY = toFiniteNumber(source.row_gap)
    ?? toFiniteNumber(source.grid_gap_y)
    ?? toFiniteNumber(source.grid_gapy)
    ?? toFiniteNumber(source.row_spacing)
    ?? gap;
  return {
    x: Math.max(0, Math.min(500, Number(rawX) || 0)),
    y: Math.max(0, Math.min(500, Number(rawY) || 0)),
  };
}

/**
 * Resolve a scalar used by size/offset.
 *
 * Supported inputs (best-effort):
 * - number
 * - numeric string ("12")
 * - percent string ("50%") => relative to parent
 * - tokens: "fill" => parent, "default" => fallback
 *
 * @param {any} value
 * @param {number} parent
 * @param {number} fallback
 * @param {{ allowFill?: boolean, content?:number, contentMax?:number, siblingMax?:number, parentW?:number, parentH?:number, selfW?:number, selfH?:number, percentBase?:number }} [opts]
 */
function resolveScalar(value, parent, fallback, opts = {}) {
  const n = toFiniteNumber(value);
  if (n !== null) return n;

  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (s) {
    const pct = parsePercent(s);
    const percentBase = opts.percentBase;
    if (pct !== null) return (Number.isFinite(percentBase) ? percentBase : parent) * pct;
    const linear = parseLinearScalarExpression(s, parent, opts);
    if (linear !== null) return linear;
    if (opts.allowFill && (s === 'fill' || s === '100%')) return parent;
    if (s === 'default') return fallback;
  }

  return fallback;
}

/**
 * @param {any} v
 * @returns {{ x: any, y: any }|null}
 */
function readVec2(v) {
  if (Array.isArray(v) && v.length >= 2) return { x: v[0], y: v[1] };
  return null;
}

/**
 * @param {any} props
 * @param {number} parentW
 * @param {number} parentH
 * @param {string} type
 * @returns {{ w: number, h: number }}
 */
function computeSize(props, parentW, parentH, type, sizing = {}) {
  const intrinsic = String(type || '').toLowerCase() === 'label'
    ? textIntrinsicSizeForLayout(props)
    : null;
  sizing = withLabelTextContent(type, props, sizing);
  const baseFallback = intrinsic || fallbackSizeForType(type, parentW, parentH);
  const contentFallback = contentFallbackSizeForType(type, props, sizing, baseFallback);
  const fillBoth = Boolean(sizing && sizing.fillParentWhenDefault);
  const fb = {
    w: fillBoth || Boolean(sizing && sizing.fillParentWidthWhenDefault) ? parentW : contentFallback.w,
    h: fillBoth || Boolean(sizing && sizing.fillParentHeightWhenDefault) ? parentH : contentFallback.h,
  };

  // Legacy stub props.
  const w = toFiniteNumber(props && props.w);
  const h = toFiniteNumber(props && props.h);
  if (w !== null || h !== null) {
    return {
      w: boundLayoutExtent(w !== null ? w : fb.w, 'width', sizing),
      h: boundLayoutExtent(h !== null ? h : fb.h, 'height', sizing),
    };
  }

  // Omitted label size is intrinsic/default, but its min/max still applies.
  // Other control types retain their existing omitted-size policy.
  const sizeV = readVec2(props && props.size) || (intrinsic ? { x: 'default', y: 'default' } : null);
  if (!sizeV) {
    return {
      w: boundLayoutExtent(fb.w, 'width', sizing),
      h: boundLayoutExtent(fb.h, 'height', sizing),
    };
  }

  const widthContext = {
    allowFill: true,
    content: sizing.contentW,
    contentMax: sizing.contentMaxW,
    siblingMax: sizing.siblingMaxW,
    parentW,
    parentH,
    percentBase: sizing.percentBaseW,
  };
  const heightContext = {
    allowFill: true,
    content: sizing.contentH,
    contentMax: sizing.contentMaxH,
    siblingMax: sizing.siblingMaxH,
    parentW,
    parentH,
    percentBase: sizing.percentBaseH,
  };
  const minV = readVec2(props && props.min_size);
  const maxV = readVec2(props && props.max_size);
  const widthConstraintPercentBase = Number.isFinite(Number(sizing.constraintPercentBaseW))
    ? Number(sizing.constraintPercentBaseW)
    : sizing.percentBaseW;
  const heightConstraintPercentBase = Number.isFinite(Number(sizing.constraintPercentBaseH))
    ? Number(sizing.constraintPercentBaseH)
    : sizing.percentBaseH;

  const hasSelfAxisUnit = [sizeV.x, sizeV.y, minV?.x, minV?.y, maxV?.x, maxV?.y]
    .some((value) => typeof value === 'string' && /%[xy]\b/u.test(value.toLowerCase()));

  const coupledLimitHit = { w: false, h: false };
  const evaluateCandidate = (candidate) => {
    const selfW = Math.max(0, Number(candidate && candidate.w) || 0);
    const selfH = Math.max(0, Number(candidate && candidate.h) || 0);
    const widthSelfContext = { ...widthContext, selfW, selfH };
    const heightSelfContext = { ...heightContext, selfW, selfH };
    const widthConstraintContext = { ...widthSelfContext, percentBase: widthConstraintPercentBase };
    const heightConstraintContext = { ...heightSelfContext, percentBase: heightConstraintPercentBase };
    const rw = resolveScalar(sizeV.x, parentW, fb.w, widthSelfContext);
    const rh = resolveScalar(sizeV.y, parentH, fb.h, heightSelfContext);
    const minW = minV
      ? resolveScalar(minV.x, parentW, 0, { ...widthConstraintContext, allowFill: false })
      : 0;
    const minH = minV
      ? resolveScalar(minV.y, parentH, 0, { ...heightConstraintContext, allowFill: false })
      : 0;
    const maxW = maxV
      ? resolveScalar(maxV.x, parentW, Number.POSITIVE_INFINITY, { ...widthConstraintContext, allowFill: false })
      : Number.POSITIVE_INFINITY;
    const maxH = maxV
      ? resolveScalar(maxV.y, parentH, Number.POSITIVE_INFINITY, { ...heightConstraintContext, allowFill: false })
      : Number.POSITIVE_INFINITY;
    const constrainedW = Math.min(Math.max(rw, minW), maxW);
    const constrainedH = Math.min(Math.max(rh, minH), maxH);
    if (!Number.isFinite(constrainedW) || constrainedW > MAX_LAYOUT_EXTENT) coupledLimitHit.w = true;
    if (!Number.isFinite(constrainedH) || constrainedH > MAX_LAYOUT_EXTENT) coupledLimitHit.h = true;
    return {
      w: boundLayoutExtent(constrainedW, 'width', sizing),
      h: boundLayoutExtent(constrainedH, 'height', sizing),
    };
  };

  if (!hasSelfAxisUnit) return evaluateCandidate({ w: fb.w, h: fb.h });

  // `%x` and `%y` use this control's resolved width and height. Solve the two
  // affine size equations together; mapping them to the parent axes breaks
  // stock aspect-ratio idioms such as ["100%", "56.25%x"]. Min/max can make
  // the mapping piecewise, so verify the exact affine seed with a bounded
  // fixed-point iteration.
  const rawAt = (selfW, selfH) => ({
    w: resolveScalar(sizeV.x, parentW, fb.w, { ...widthContext, selfW, selfH }),
    h: resolveScalar(sizeV.y, parentH, fb.h, { ...heightContext, selfW, selfH }),
  });
  const rawZero = rawAt(0, 0);
  const rawUnitW = rawAt(1, 0);
  const rawUnitH = rawAt(0, 1);
  const coeff = {
    ww: rawUnitW.w - rawZero.w,
    wh: rawUnitH.w - rawZero.w,
    hw: rawUnitW.h - rawZero.h,
    hh: rawUnitH.h - rawZero.h,
  };
  const a11 = 1 - coeff.ww;
  const a12 = -coeff.wh;
  const a21 = -coeff.hw;
  const a22 = 1 - coeff.hh;
  const determinant = a11 * a22 - a12 * a21;
  let current = { w: Math.max(0, Number(fb.w) || 0), h: Math.max(0, Number(fb.h) || 0) };
  // Even a very small non-zero determinant can have a finite solution inside
  // the layout bound. Use it only as a seed; the bounded projection below is
  // still the authority and rejects numerically invalid candidates.
  if (Number.isFinite(determinant) && determinant !== 0) {
    const exactW = (rawZero.w * a22 - a12 * rawZero.h) / determinant;
    const exactH = (a11 * rawZero.h - rawZero.w * a21) / determinant;
    if ([exactW, exactH].every(Number.isFinite)) {
      current = {
        w: Math.max(0, Math.min(MAX_LAYOUT_EXTENT, exactW)),
        h: Math.max(0, Math.min(MAX_LAYOUT_EXTENT, exactH)),
      };
    }
  }

  let previous = null;
  let lastResidual = { w: Number.POSITIVE_INFINITY, h: Number.POSITIVE_INFINITY };
  let lastTolerance = { w: 1e-8, h: 1e-8 };
  for (let pass = 0; pass < 64; pass += 1) {
    const next = evaluateCandidate(current);
    const verified = evaluateCandidate(next);
    if (coupledLimitHit.w || coupledLimitHit.h) break;
    const scale = Math.max(1, current.w, current.h, next.w, next.h, verified.w, verified.h);
    const tolerance = Math.max(1e-8, scale * 1e-10);
    const step = Math.max(Math.abs(next.w - current.w), Math.abs(next.h - current.h));
    lastResidual = {
      w: Math.abs(verified.w - next.w),
      h: Math.abs(verified.h - next.h),
    };
    lastTolerance = {
      w: Math.max(1e-8, Math.max(1, Math.abs(next.w), Math.abs(verified.w)) * 1e-10),
      h: Math.max(1e-8, Math.max(1, Math.abs(next.h), Math.abs(verified.h)) * 1e-10),
    };
    const residual = Math.max(lastResidual.w, lastResidual.h);
    if (step <= tolerance && residual <= tolerance) return verified;

    // Clamps can create a two-cycle. The midpoint is only a new seed and must
    // still pass the same two-projection verification on a later iteration.
    if (previous) {
      const cycle = Math.max(Math.abs(next.w - previous.w), Math.abs(next.h - previous.h));
      if (cycle <= tolerance && residual > tolerance) {
        previous = current;
        current = { w: (current.w + next.w) / 2, h: (current.h + next.h) / 2 };
        continue;
      }
    }
    previous = current;
    current = next;
  }

  if (typeof sizing?.onSizeLimit === 'function') {
    if (coupledLimitHit.w || lastResidual.w > lastTolerance.w) {
      sizing.onSizeLimit('width', current.w, 'cross-axis-fixed-point');
    }
    if (coupledLimitHit.h || lastResidual.h > lastTolerance.h) {
      sizing.onSizeLimit('height', current.h, 'cross-axis-fixed-point');
    }
  }
  return evaluateCandidate({ w: 0, h: 0 });
}

/**
 * @param {any} props
 * @param {number} parentW
 * @param {number} parentH
 * @returns {{ dx: number, dy: number }}
 */
function computeOffset(props, parentW, parentH, sizing = {}) {
  // Legacy stub props.
  const x = toFiniteNumber(props && props.x);
  const y = toFiniteNumber(props && props.y);
  if (x !== null || y !== null) {
    return {
      dx: boundLayoutCoordinate(x !== null ? x : 0, 'x', sizing, 'legacy-offset'),
      dy: boundLayoutCoordinate(y !== null ? y : 0, 'y', sizing, 'legacy-offset'),
    };
  }

  const offV = readVec2(props && props.offset);
  if (!offV) return { dx: 0, dy: 0 };

  const dx = resolveScalar(offV.x, parentW, 0, {
    allowFill: false,
    content: sizing.contentW,
    contentMax: sizing.contentMaxW,
    siblingMax: sizing.siblingMaxW,
    parentW,
    parentH,
    selfW: sizing.selfW,
    selfH: sizing.selfH,
  });
  const dy = resolveScalar(offV.y, parentH, 0, {
    allowFill: false,
    content: sizing.contentH,
    contentMax: sizing.contentMaxH,
    siblingMax: sizing.siblingMaxH,
    parentW,
    parentH,
    selfW: sizing.selfW,
    selfH: sizing.selfH,
  });
  return {
    dx: boundLayoutCoordinate(dx, 'x', sizing, 'offset'),
    dy: boundLayoutCoordinate(dy, 'y', sizing, 'offset'),
  };
}

/**
 * Compute node bounding box in world units.
 *
 * For legacy stub nodes (x/y/w/h), box is computed as:
 *   x = parent.x + x
 *   y = parent.y + y
 *
 * For JSONUI-like nodes (offset/size/anchor_from/anchor_to), box is computed as:
 *   parentAnchor = parent + parent.size * anchor_from
 *   elementAnchor = size * anchor_to
 *   pos = parentAnchor + offset - elementAnchor
 *
 * @param {{ id: string, type: string, props?: any }} node
 * @param {{ x: number, y: number, w: number, h: number }} parent
 * @param {number} depth
 * @param {string|null} parentId
 * @returns {LayoutBox}
 */
function computeNodeBox(node, parent, depth, parentId, sizing = {}) {
  const type = String(node && node.type ? node.type : 'unknown');
  const props = node && node.props ? node.props : {};
  sizing = withLabelTextContent(type, props, {
    ...sizing, hasChildControls: Array.isArray(node.children) && node.children.length > 0,
  });

  const fillParentWhenDefault = shouldFillParentWhenSizeOmitted(node);
  const resolvedSize = sizing && sizing.resolvedSize &&
    Number.isFinite(Number(sizing.resolvedSize.w)) && Number.isFinite(Number(sizing.resolvedSize.h))
    ? { w: Math.max(0, Number(sizing.resolvedSize.w)), h: Math.max(0, Number(sizing.resolvedSize.h)) }
    : null;
  const naturalSize = resolvedSize || computeSize(props, parent.w, parent.h, type, { ...sizing, fillParentWhenDefault });
  const size = resolvedSize
    ? naturalSize
    : {
        w: isBooleanLikeEnabled(props, 'inherit_max_sibling_width')
          ? Math.max(naturalSize.w, Math.max(0, Number(sizing && sizing.siblingMaxW) || 0))
          : naturalSize.w,
        h: isBooleanLikeEnabled(props, 'inherit_max_sibling_height')
          ? Math.max(naturalSize.h, Math.max(0, Number(sizing && sizing.siblingMaxH) || 0))
          : naturalSize.h,
      };
  const off = computeOffset(props, parent.w, parent.h, { ...sizing, selfW: size.w, selfH: size.h });
  const localLayer = boundLayoutLayer(props.layer === undefined ? 0 : props.layer, sizing, 'local');
  const parentX = boundLayoutCoordinate(parent.x, 'x', sizing, 'parent');
  const parentY = boundLayoutCoordinate(parent.y, 'y', sizing, 'parent');

  // Legacy stub nodes use x/y with no anchors.
  const hasLegacyXY = toFiniteNumber(props && props.x) !== null || toFiniteNumber(props && props.y) !== null;
  if (hasLegacyXY) {
    return {
      id: String(node.id),
      type,
      x: boundLayoutCoordinate(parentX + off.dx, 'x', sizing, 'legacy-position'),
      y: boundLayoutCoordinate(parentY + off.dy, 'y', sizing, 'legacy-position'),
      w: size.w,
      h: size.h,
      depth,
      parentId,
      layer: localLayer,
      order: 0,
    };
  }

  const stackOwnsPlacement = Boolean(sizing && sizing.stackOwnsPlacement);
  // The paired Classic ActionForm captures place narrower children at the
  // leading edge of a vertical stack (not half the unused width to its right).
  // Keep the existing horizontal cross-axis contract; that is a separate
  // native observation. Explicit use_child_anchors still bypasses this rule.
  const stackAnchor = sizing.stackOrientation === 'vertical' ? 'top_left' : 'center';
  const aFrom = anchorToUnit(stackOwnsPlacement ? stackAnchor : props && props.anchor_from);
  const aTo = anchorToUnit(stackOwnsPlacement ? stackAnchor : props && props.anchor_to);

  const parentAx = boundLayoutCoordinate(parentX + parent.w * aFrom.ax, 'x', sizing, 'parent-anchor');
  const parentAy = boundLayoutCoordinate(parentY + parent.h * aFrom.ay, 'y', sizing, 'parent-anchor');

  const elAx = size.w * aTo.ax;
  const elAy = size.h * aTo.ay;

  return {
    id: String(node.id),
    type,
    x: boundLayoutCoordinate(parentAx + off.dx - elAx, 'x', sizing, 'anchored-position'),
    y: boundLayoutCoordinate(parentAy + off.dy - elAy, 'y', sizing, 'anchored-position'),
    w: size.w,
    h: size.h,
    depth,
    parentId,
    layer: localLayer,
    order: 0,
  };
}

/**
 * Build layout boxes for the currently opened file.
 *
 * @param {{ rootId: string, nodesById: Record<string, any> }} file
 * @param {CanvasPreset} [preset]
 * @param {{
 *  maxBoxes?: number,
 *  propsByIdOverride?: Record<string, Record<string, any>>,
 *  scrollById?: Record<string, any>,
 *  visibilityMode?: 'safe'|'structure'|'debug',
 * }} [opts]
 * @returns {LayoutResult}
 */
function computeLayoutBoxesPass37(file, preset = DEFAULT_CANVAS_PRESET, opts = {}) {
  const rootId = String(file && file.rootId ? file.rootId : '');
  const nodesById = file && file.nodesById ? file.nodesById : {};
  const propsByIdOverride =
    opts && opts.propsByIdOverride && typeof opts.propsByIdOverride === 'object' ? opts.propsByIdOverride : null;

  const scrollById = opts && opts.scrollById && typeof opts.scrollById === 'object' ? opts.scrollById : null;

  const visibilityModeRaw =
    opts && typeof opts.visibilityMode === 'string' ? opts.visibilityMode.trim().toLowerCase() : 'safe';
  const visibilityMode =
    visibilityModeRaw === 'structure' || visibilityModeRaw === 'debug' ? 'structure' : 'safe';

  const maxBoxes = Number(opts && opts.maxBoxes) > 0 ? Number(opts && opts.maxBoxes) : 5000;
  const nodeCountWithinDiscoveryBudget = Object.keys(nodesById).length <= maxBoxes;

  /** @type {LayoutBox[]} */
  const boxes = [];
  /** @type {string[]} */
  const warnings = [];
  const reportedNativeProperties41 = new Set();
  const reportedSizeLimits = new Set();
  const reportedPositionLimits = new Set();
  const reportedLayerLimits = new Set();
  const recursiveSizeLimitsThisPass = new Map();
  const maxLayoutDepth = 512;
  let measurementDepthReported = false;
  let visitDepthReported = false;

  function reportSizeLimit(nodeId, axis, _value, reason) {
    const key = `${String(nodeId)}:${String(axis)}:${String(reason)}`;
    const node = nodesById && nodesById[nodeId];
    const props = node ? effectivePropsForNodeId(nodeId) : {};
    const axisIndex = axis === 'height' ? 1 : 0;
    const sizeVector = readVec2(props && props.size);
    const dependencyValues = [props && props.size, props && props.min_size, props && props.max_size]
      .map(readVec2)
      .map((vector) => vector ? (axisIndex === 1 ? vector.y : vector.x) : null);
    const recursiveToken = dependencyValues.some((value, index) => {
      if (typeof value !== 'string') return false;
      const token = value.trim().toLowerCase();
      return /%(?:c|cm|sm|x|y)(?:\b|\s|[+\-])/u.test(token) || (index === 0 && token === 'default');
    }) || (!sizeVector && Array.isArray(node && node.children) && node.children.length > 0);
    if (recursiveToken) {
      const prior = recursiveSizeLimitsThisPass.get(String(nodeId)) || { w: false, h: false };
      recursiveSizeLimitsThisPass.set(String(nodeId), {
        w: prior.w || axis === 'width',
        h: prior.h || axis === 'height',
      });
    }
    if (reportedSizeLimits.has(key)) return;
    reportedSizeLimits.add(key);
    warnings.push(`LAYOUT_SIZE_LIMIT:${key}:${MAX_LAYOUT_EXTENT}`);
  }

  function reportPositionLimit(nodeId, axis, _value, reason) {
    const key = `${String(nodeId)}:${String(axis)}:${String(reason)}`;
    if (reportedPositionLimits.has(key)) return;
    reportedPositionLimits.add(key);
    warnings.push(`LAYOUT_POSITION_LIMIT:${key}:${MAX_LAYOUT_EXTENT}`);
  }

  function reportLayerLimit(nodeId, _value, reason) {
    const key = `${String(nodeId)}:${String(reason)}`;
    if (reportedLayerLimits.has(key)) return;
    reportedLayerLimits.add(key);
    warnings.push(`LAYOUT_LAYER_LIMIT:${key}:${MAX_LAYOUT_EXTENT}`);
  }

  // Root screen box.
  const screen = {
    x: 0,
    y: 0,
    w: Number(preset && preset.width) || 1280,
    h: Number(preset && preset.height) || 720,
    effectiveLayer: 0,
    paintPath: [],
  };

  const root = nodesById && rootId ? nodesById[rootId] : null;
  const rootIsFile = root && String(root.type || '').toLowerCase() === 'file';

  let totalNodes = 0;
  let truncated = false;
  let allocatedSubtreeReuseCount = 0;

  /** @type {Record<string, { minX:number, minY:number, maxX:number, maxY:number }>} */
  const scrollContentBoundsById = Object.create(null);
  /** @type {Record<string, ScrollViewMeta>} */
  const scrollMetaById = Object.create(null);
  const namedContentOwners = new Map();
  const namedViewportOwners = new Map();
  const sliderStates = new Map(), sliderOwners = new Map(), sliderChildRuntime = new Map();
  const sliderOmittedChildren = new Set();
  const reportedSliderIssues = new Set();
  function reportSliderIssues(nodeId, diagnostics) {
    for (const diagnostic of diagnostics) {
      const message = `${diagnostic}:${nodeId}`;
      if (!reportedSliderIssues.has(message)) { reportedSliderIssues.add(message); warnings.push(message); }
    }
  }
  function sliderStateFor(node, props) {
    const id = String(node.id);
    if (sliderStates.has(id)) return sliderStates.get(id);
    const children = (Array.isArray(node.children) ? node.children : []).map(childId => ({
      id: String(childId), name: nodesById[childId]?.props?.name,
    }));
    const discovery = collectSliderDescendants37(nodesById, node.children);
    const controls = resolveSliderControls37({ props, children, descendants: discovery.children });
    controls.diagnostics.push(...discovery.diagnostics);
    const runtime = resolveSliderRuntime37(props);
    const enabled = readSliderEnabledState37(props);
    const state = { controls, runtime, enabled };
    sliderStates.set(id, state);
    if (controls.boxId) sliderOwners.set(controls.boxId, state);
    for (const childId of controls.unresolvedIds) sliderOmittedChildren.add(childId);
    if (!runtime.ok || discovery.diagnostics.length) {
      if (controls.boxId) sliderOmittedChildren.add(controls.boxId);
      for (const childId of controls.progressIds) sliderOmittedChildren.add(childId);
    }
    reportSliderIssues(id, [...controls.diagnostics, ...runtime.diagnostics,
      ...(enabled === null ? ['SLIDER_ENABLED_UNRESOLVED'] : [])]);
    // An unresolved visibility binding on a slider state overlay must not be
    // mistaken for a confirmed enabled/disabled appearance. Keep that binding
    // unresolved; do not hide an authored overlay to make the PNG complete.
    if (discovery.children.some(child => {
      const candidate = nodesById[child.id];
      const evaluated = propsByIdOverride?.[child.id] || {};
      const visible = Object.hasOwn(evaluated, 'visible') ? evaluated.visible : candidate?.props?.visible;
      return visible === '#__jsonui_unresolved_runtime_visibility__';
    })) reportSliderIssues(id, ['SLIDER_STATE_VISIBILITY_UNRESOLVED']);
    return state;
  }

  /** @param {string} scrollViewId */
  function ensureBounds(scrollViewId) {
    if (!scrollContentBoundsById[scrollViewId]) {
      scrollContentBoundsById[scrollViewId] = {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      };
    }
    return scrollContentBoundsById[scrollViewId];
  }

  /**
   * Extract a "local name" from a Bedrock UI element key like "foo@bar" -> "foo".
   * This is a best-effort helper used by scroll_view properties that reference control names.
   *
   * @param {string} rawName
   */
  function getLocalName(rawName) {
    const s = String(rawName || '').trim();
    if (!s) return '';
    const at = s.indexOf('@');
    return (at >= 0 ? s.slice(0, at) : s).trim();
  }

  /**
   * Find a direct child node id by its local name (best-effort).
   *
   * @param {any} parentNode
   * @param {string} localName
   * @returns {string|null}
   */
  function findDirectChildByLocalName(parentNode, localName) {
    if (!parentNode || !Array.isArray(parentNode.children) || !localName) return null;
    const target = String(localName || '').trim();
    if (!target) return null;

    for (const cid of parentNode.children) {
      const childId = String(cid);
      const cn = nodesById && nodesById[childId] ? nodesById[childId] : null;
      if (!cn) continue;
      const childNameRaw = cn && cn.props ? cn.props.name : '';
      const childLocal = getLocalName(childNameRaw);
      if (childLocal === target) return childId;
    }
    return null;
  }



  /**
   * Apply a per-node props override without mutating the underlying node.
   *
   * This is used by the canvas preview to apply evaluated bindings output
   * (`propsByIdOverride`) to layout computation.
   *
   * @param {any} node
   * @param {Record<string, any>} override
   * @returns {any}
   */
  function overrideProps(node, override) {
    const n = node && typeof node === 'object' ? node : {};
    const baseProps = n && n.props && typeof n.props === 'object' ? n.props : {};
    const o = override && typeof override === 'object' ? override : {};

    // Non-mutating merge. Keep unknown node fields intact.
    return {
      ...n,
      props: {
        ...baseProps,
        ...o,
      },
    };
  }

  // Bedrock content dimensions (`%c`, `%cm`, `%sm`) are recursive.  Resolve a
  // bounded fixed point before placing boxes; unresolved runtime feedback is
  // reported instead of silently stretching controls to the full viewport.
  /** @type {Record<string, {w:number,h:number}>} */
  const measuredSizeById = Object.create(null);
  /** Natural sizes exclude `inherit_max_sibling_*`, preventing self-amplifying sibling feedback. */
  const naturalSizeById = Object.create(null);
  /** @type {Record<string, {contentW:number,contentH:number,contentMaxW:number,contentMaxH:number,siblingMaxW:number,siblingMaxH:number}>} */
  const sizingContextById = Object.create(null);
  const measurementStack = new Set();
  const reportedMeasurementCycles = new Set();
  const activeVisitIds = new Set();
  let measurementWork = 0;
  const maxMeasurementWork = Math.max(10_000, Math.min(300_000, Math.floor(maxBoxes) * 60));
  let measurementBudgetReported = false;
  const measurementBudgetWarning = `CONTENT_SIZE_MEASUREMENT_BUDGET:${maxMeasurementWork}`;

  function ensureMeasurementBudgetWarning() {
    if (measurementBudgetReported && !warnings.includes(measurementBudgetWarning)) {
      warnings.push(measurementBudgetWarning);
    }
  }

  const diagnosedScalarNodes = new Set();
  let scalarDiagnosticCount = 0;
  function diagnoseScalarProps(nodeId, props) {
    if(diagnosedScalarNodes.has(nodeId))return;
    diagnosedScalarNodes.add(nodeId);
    for(const field of ['size','min_size','max_size','offset']){
      const raw=props[field];if(raw===undefined||raw===null)continue;
      // The model accepts empty min/max vectors as an explicit absence of
      // constraints. Layout already applies that meaning; diagnostics must
      // agree without accepting malformed size/offset or one-axis vectors.
      if((field==='min_size'||field==='max_size')&&Array.isArray(raw)&&raw.length===0)continue;
      const vector=readVec2(raw);
      const values=vector?[vector.x,vector.y]:[raw];
      for(let axis=0;axis<values.length;axis++){
        const value=values[axis],token=typeof value==='string'?value.trim().toLowerCase():'';
        const context={content:1,contentMax:1,siblingMax:1,parentW:1,parentH:1,selfW:1,selfH:1};
        const supported=vector&&(toFiniteNumber(value)!==null||token==='default'||(field==='size'&&token==='fill')||parsePercent(token)!==null||parseLinearScalarExpression(token,1,context)!==null);
        if(supported)continue;
        if(scalarDiagnosticCount<1000)warnings.push(`LAYOUT_SCALAR_UNSUPPORTED:${String(nodeId)}:${field}:${vector?axis:'vector'}`);
        else if(scalarDiagnosticCount===1000)warnings.push('LAYOUT_SCALAR_DIAGNOSTIC_LIMIT:1000');
        scalarDiagnosticCount++;
      }
    }
  }

  // Bindings/animation overrides are immutable for this layout invocation.
  // Reuse their merged view throughout fixed-point passes instead of copying
  // every property bag again for every sibling/ancestor measurement.
  const effectivePropsCache = new Map();
  function effectivePropsForNodeId(nodeId) {
    if (effectivePropsCache.has(nodeId)) return effectivePropsCache.get(nodeId);
    const node = nodesById && nodesById[nodeId];
    if (!node) return {};
    const override = propsByIdOverride && propsByIdOverride[nodeId];
    const props=override ? { ...(node.props || {}), ...override } : node.props || {};
    diagnoseScalarProps(nodeId,props);
    effectivePropsCache.set(nodeId, props);
    return props;
  }

  const reportedGridPositionIssues = new Set();
  function readExplicitGridPosition(childId, columns = null, rows = null) {
    const node = nodesById && nodesById[childId];
    if (!node) return { status: 'missing', position: null };
    const props = {
      ...(node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {}),
      ...effectivePropsForNodeId(childId),
    };
    if (!Object.prototype.hasOwnProperty.call(props, 'grid_position')) {
      return { status: 'missing', position: null };
    }
    const vector = readVec2(props.grid_position);
    const columnValue = vector ? toFiniteNumber(vector.x) : null;
    const rowValue = vector ? toFiniteNumber(vector.y) : null;
    if (columnValue === null || rowValue === null) return { status: 'invalid', position: null };
    const position = { col: Math.floor(columnValue), row: Math.floor(rowValue) };
    if (Number.isFinite(columns) && Number.isFinite(rows)
      && !(position.col >= 0 && position.col < columns && position.row >= 0 && position.row < rows)) {
      return { status: 'out_of_bounds', position };
    }
    return { status: 'valid', position };
  }
  function reportGridPositionIssue(childId, status) {
    const code = status === 'out_of_bounds' ? 'GRID_POSITION_OUT_OF_BOUNDS' : 'GRID_POSITION_INVALID';
    const key = `${code}:${String(childId)}`;
    if (reportedGridPositionIssues.has(key)) return;
    reportedGridPositionIssues.add(key);
    warnings.push(key);
  }

  function selectSafeStateChildren(node, props, candidateIds) {
    const ids = Array.isArray(candidateIds) ? candidateIds.map(String).filter(id => !sliderOmittedChildren.has(id)) : [];
    if (visibilityMode !== 'safe') return ids;
    const type = String(node && node.type || '').toLowerCase();
    if (type === 'slider' || type === 'slider_box') {
      const state = type === 'slider' ? sliderStateFor(node, props) : sliderOwners.get(String(node.id));
      const selected = selectSliderStateChildren37({ type, props,
        enabled: isControlEnabledInSafeMode(props) && (state ? state.enabled === true : true),
        children: ids.map(id => ({ id, name: nodesById[id]?.props?.name })) });
      reportSliderIssues(String(node.id), selected.diagnostics);
      if (type !== 'slider') return selected.ids;
      const omitted = new Set(state.controls.unresolvedIds);
      if (!state.runtime.ok) {
        if (state.controls.boxId) omitted.add(state.controls.boxId);
        for (const id of state.controls.progressIds) omitted.add(id);
      }
      return selected.ids.filter(id => !omitted.has(id) && !sliderOmittedChildren.has(id));
    }
    const toggleStateKeys = [
      'toggle_state', 'toggle_default_state',
      'checked_control', 'unchecked_control',
      'checked_hover_control', 'unchecked_hover_control',
      'checked_locked_control', 'unchecked_locked_control',
      'checked_locked_hover_control', 'unchecked_locked_hover_control',
    ];
    // Vanilla's common.dropdown is a toggle overridden to type "dropdown".
    // Its eight state children keep toggle names, so the effective state
    // contract—not the final type string—must select the one safe child.
    const usesToggleStateContract = type === 'toggle'
      || (type === 'dropdown' && toggleStateKeys.some((key) => Object.prototype.hasOwnProperty.call(props || {}, key)));
    if (!usesToggleStateContract && (type === 'button' || type === 'dropdown' || type === 'edit_box')) {
      const enabled = isControlEnabledInSafeMode(props);
      const activeName = enabled
        ? getLocalName(props.default_control || 'default') || 'default'
        : getLocalName(props.locked_control || 'locked') || 'locked';
      const stateNames = new Set([
        'default',
        'hover',
        'pressed',
        'locked',
        'disabled',
        getLocalName(props.hover_control),
        getLocalName(props.pressed_control),
        getLocalName(props.locked_control),
      ].filter(Boolean));
      return ids.filter((childId) => {
        const child = nodesById && nodesById[childId];
        const localName = getLocalName(child && child.props ? child.props.name : '');
        return localName === activeName || !stateNames.has(localName);
      });
    }
    if (!usesToggleStateContract) return ids;

    const enabled = isControlEnabledInSafeMode(props);
    const hasBoundState = Object.prototype.hasOwnProperty.call(props, 'toggle_state');
    const boundState = hasBoundState ? readBooleanLike(props.toggle_state) : null;
    const defaultState = Object.prototype.hasOwnProperty.call(props, 'toggle_default_state')
      ? readBooleanLike(props.toggle_default_state)
      : null;
    // An explicitly bound but unresolved state is unknown; do not fabricate a
    // state by falling back to toggle_default_state.
    const checked = hasBoundState ? boundState : defaultState;
    const activeName = checked === null
      ? ''
      : getLocalName(
          checked
            ? enabled
              ? props.checked_control || 'checked'
              : props.checked_locked_control || 'checked_locked'
            : enabled
              ? props.unchecked_control || 'unchecked'
              : props.unchecked_locked_control || 'unchecked_locked',
        );
    const stateNames = new Set([
      'checked',
      'unchecked',
      'checked_hover',
      'unchecked_hover',
      'checked_locked',
      'unchecked_locked',
      'checked_locked_hover',
      'unchecked_locked_hover',
      getLocalName(props.checked_control),
      getLocalName(props.unchecked_control),
      getLocalName(props.checked_hover_control),
      getLocalName(props.unchecked_hover_control),
      getLocalName(props.checked_locked_control),
      getLocalName(props.unchecked_locked_control),
      getLocalName(props.checked_locked_hover_control),
      getLocalName(props.unchecked_locked_hover_control),
    ].filter(Boolean));
    return ids.filter((childId) => {
      const child = nodesById && nodesById[childId];
      const localName = getLocalName(child && child.props ? child.props.name : '');
      return !stateNames.has(localName) || (activeName && localName === activeName);
    });
  }

  function isStaticLeafMeasurement(node, props) {
    if (Array.isArray(node && node.children) && node.children.length > 0) return false;
    if (isBooleanLikeEnabled(props, 'inherit_max_sibling_width') || isBooleanLikeEnabled(props, 'inherit_max_sibling_height')) {
      return false;
    }
    const size = readVec2(props && props.size);
    const legacyWidth = toFiniteNumber(props && props.w);
    const legacyHeight = toFiniteNumber(props && props.h);
    const hasAbsoluteSize = size
      ? toFiniteNumber(size.x) !== null && toFiniteNumber(size.y) !== null
      : legacyWidth !== null && legacyHeight !== null;
    if (!hasAbsoluteSize) return false;
    for (const limit of [props && props.min_size, props && props.max_size]) {
      if (limit === undefined || limit === null) continue;
      const vector = readVec2(limit);
      const isStaticLimit = (value) => toFiniteNumber(value) !== null
        || (typeof value === 'string' && value.trim().toLowerCase() === 'default');
      if (!vector || !isStaticLimit(vector.x) || !isStaticLimit(vector.y)) return false;
    }
    return true;
  }

  function measureNode(nodeId, parentSize, siblingMax, defaultSizing = {}, measurementDepth = 0) {
    const node = nodesById && nodesById[nodeId];
    if (!node) return { w: 0, h: 0 };
    if (isRuntimeOnlyPreviewNode(node, visibilityMode)) return { w: 0, h: 0 };
    if (measurementDepth > maxLayoutDepth) {
      if (!measurementDepthReported) {
        measurementDepthReported = true;
        warnings.push(`LAYOUT_DEPTH_LIMIT:${maxLayoutDepth}`);
      }
      return { w: 0, h: 0 };
    }
    const props = effectivePropsForNodeId(nodeId);
    measurementWork += 1;
    if (measurementWork > maxMeasurementWork) {
      if (!measurementBudgetReported) {
        measurementBudgetReported = true;
        warnings.push(measurementBudgetWarning);
      }
      return measuredSizeById[nodeId] || { w: 0, h: 0 };
    }
    if (measuredSizeById[nodeId] && naturalSizeById[nodeId] && isStaticLeafMeasurement(node, props)) {
      sizingContextById[nodeId] = {
        ...(sizingContextById[nodeId] || {}),
        siblingMaxW: Number(siblingMax && siblingMax.w) || 0,
        siblingMaxH: Number(siblingMax && siblingMax.h) || 0,
      };
      return measuredSizeById[nodeId];
    }
    if (measurementStack.has(nodeId)) {
      if (!reportedMeasurementCycles.has(nodeId)) {
        reportedMeasurementCycles.add(nodeId);
        warnings.push(`CONTENT_SIZE_NODE_CYCLE:${nodeId}`);
      }
      return { w: 0, h: 0 };
    }
    measurementStack.add(nodeId);
    const previous = measuredSizeById[nodeId];
    const onSizeLimit = (axis, value, reason) => reportSizeLimit(nodeId, axis, value, reason);
    const fillParentWhenDefault = shouldFillParentWhenSizeOmitted(node);
    const defaultSizePolicy = fillParentWhenDefault && !defaultSizing.fillParentWidthWhenDefault && !defaultSizing.fillParentHeightWhenDefault
      ? { fillParentWhenDefault: true }
      : defaultSizing;
    const provisional = previous || computeSize(
      props,
      parentSize.w,
      parentSize.h,
      String(node.type || 'unknown'),
      {
        ...defaultSizePolicy,
        siblingMaxW: Number(siblingMax && siblingMax.w) || 0,
        siblingMaxH: Number(siblingMax && siblingMax.h) || 0,
        contentW: 0,
        contentH: 0,
        contentMaxW: 0,
        contentMaxH: 0,
        hasChildControls: Array.isArray(node.children) && node.children.length > 0,
        onSizeLimit,
      },
    );
    const visibleChildIds = Array.isArray(node.children) ? node.children.map(String).filter((childId) => {
      const childNode = nodesById && nodesById[childId];
      if (!childNode || isRuntimeOnlyPreviewNode(childNode, visibilityMode)) return false;
      const childProps = effectivePropsForNodeId(childId);
      return typeof isVisibleFromProps !== 'function' || isVisibleFromProps(childProps, { mode: visibilityMode });
    }) : [];
    let childIds = selectSafeStateChildren(node, props, visibleChildIds);
    const measuredNodeType = String(node.type || '').toLowerCase();
    // A grid's runtime cap and dimension binding define its actual sibling
    // group. Apply them before `%sm` and inherit_max_sibling_* measurement so
    // excluded collection prototypes cannot inflate included cells.
    if (measuredNodeType === 'grid') {
      let measuredDimensions = readVec2(props.grid_dimensions);
      let measuredColumns = measuredDimensions ? toFiniteNumber(measuredDimensions.x) : null;
      let measuredRows = measuredDimensions ? toFiniteNumber(measuredDimensions.y) : null;
      let measuredDimensionsValid = measuredColumns !== null && measuredRows !== null
        && measuredColumns > 0 && measuredRows > 0;
      const measuredBindingName = typeof props.grid_dimension_binding === 'string'
        ? props.grid_dimension_binding.trim()
        : '';
      let measuredBindingFailed = false;
      if (!measuredDimensionsValid && measuredBindingName) {
        const measuredBareName = measuredBindingName.replace(/^[#$]/u, '');
        const measuredBoundValue = Object.prototype.hasOwnProperty.call(props, measuredBindingName)
          ? props[measuredBindingName]
          : Object.prototype.hasOwnProperty.call(props, measuredBareName)
            ? props[measuredBareName]
            : undefined;
        measuredDimensions = readVec2(measuredBoundValue);
        measuredColumns = measuredDimensions ? toFiniteNumber(measuredDimensions.x) : null;
        measuredRows = measuredDimensions ? toFiniteNumber(measuredDimensions.y) : null;
        measuredDimensionsValid = measuredColumns !== null && measuredRows !== null
          && measuredColumns > 0 && measuredRows > 0;
        measuredBindingFailed = measuredBoundValue === undefined || !measuredDimensionsValid;
      }
      const measuredMaximumItemsRaw = toFiniteNumber(props.maximum_grid_items);
      const measuredMaximumItems = measuredMaximumItemsRaw === null
        ? 2048
        : Math.max(0, Math.min(2048, Math.floor(measuredMaximumItemsRaw)));
      childIds = measuredBindingFailed ? [] : childIds.slice(0, measuredMaximumItems);
      childIds = childIds.filter((childId) => {
        const result = readExplicitGridPosition(
          childId,
          measuredDimensionsValid ? Math.max(1, Math.min(2048, Math.floor(measuredColumns))) : null,
          measuredDimensionsValid ? Math.max(1, Math.min(2048, Math.floor(measuredRows))) : null,
        );
        if (result.status === 'missing' || result.status === 'valid') return true;
        reportGridPositionIssue(childId, result.status);
        return false;
      });
    }
    const previousNaturalSizes = childIds.map((childId) => naturalSizeById[childId] || { w: 0, h: 0 });
    const previousPeerMaxSizes = computePeerMaxSizes(previousNaturalSizes);
    const isHorizontalStack = measuredNodeType === 'stack_panel' &&
      String(props.orientation || 'vertical').toLowerCase() === 'horizontal';
    const isVerticalStack = measuredNodeType === 'stack_panel' && !isHorizontalStack;
    const gridSizeWasOmitted = node?.propsPresent?.size === false
      || (!node?.propsPresent && !Object.prototype.hasOwnProperty.call(props, 'size'));
    const gridUsesNaturalSize = measuredNodeType === 'grid'
      && gridSizeWasOmitted
      && toFiniteNumber(props.w) === null
      && toFiniteNumber(props.h) === null;
    const gridConstraintSeed = gridUsesNaturalSize && !previous
      ? {
          ...(provisional.w <= 0 && parentSize.w > 0 ? { constraintPercentBaseW: parentSize.w } : {}),
          ...(provisional.h <= 0 && parentSize.h > 0 ? { constraintPercentBaseH: parentSize.h } : {}),
        }
      : {};
    const childSizes = childIds.map((childId, index) => {
      const childNode = nodesById && nodesById[childId];
      const omittedChildSize = shouldFillParentWhenSizeOmitted(childNode);
      const childDefaultSizing = {
        ...gridConstraintSeed,
        ...(omittedChildSize && isHorizontalStack
          ? { fillParentHeightWhenDefault: true }
          : omittedChildSize && isVerticalStack
            ? { fillParentWidthWhenDefault: true }
            : {}),
      };
      return measureNode(childId, provisional, previousPeerMaxSizes[index], childDefaultSizing, measurementDepth + 1);
    });
    let contentChildIds = childIds;
    let contentChildSizes = childSizes;
    let maxChildW = childSizes.reduce((max, size) => Math.max(max, Number(size.w) || 0), 0);
    let maxChildH = childSizes.reduce((max, size) => Math.max(max, Number(size.h) || 0), 0);
    // `%c` is the total child extent while `%cm` is the largest visible
    // child. They must remain distinct for non-stack overlays too (for
    // example the stock close/help side tab). Grids replace these totals with
    // their row/column track measurement below.
    let contentW = isHorizontalStack || (!isHorizontalStack && !isVerticalStack)
        ? childSizes.reduce((sum, size) => sum + (Number(size.w) || 0), 0)
        : maxChildW;
    let contentH = isVerticalStack || (!isHorizontalStack && !isVerticalStack)
        ? childSizes.reduce((sum, size) => sum + (Number(size.h) || 0), 0)
        : maxChildH;

    if (measuredNodeType === 'grid') {
      let dimensions = readVec2(props.grid_dimensions);
      let columnsRaw = dimensions ? toFiniteNumber(dimensions.x) : null;
      let rowsRaw = dimensions ? toFiniteNumber(dimensions.y) : null;
      let hasValidDimensions = columnsRaw !== null && rowsRaw !== null && columnsRaw > 0 && rowsRaw > 0;
      let dimensionBindingFailed = false;
      const bindingName = typeof props.grid_dimension_binding === 'string'
        ? props.grid_dimension_binding.trim()
        : '';
      if (!hasValidDimensions && bindingName) {
        const bareName = bindingName.replace(/^[#$]/u, '');
        const boundValue = Object.prototype.hasOwnProperty.call(props, bindingName)
          ? props[bindingName]
          : Object.prototype.hasOwnProperty.call(props, bareName)
            ? props[bareName]
            : undefined;
        dimensions = readVec2(boundValue);
        columnsRaw = dimensions ? toFiniteNumber(dimensions.x) : null;
        rowsRaw = dimensions ? toFiniteNumber(dimensions.y) : null;
        hasValidDimensions = columnsRaw !== null && rowsRaw !== null && columnsRaw > 0 && rowsRaw > 0;
        dimensionBindingFailed = boundValue === undefined || !hasValidDimensions;
      }
      if (hasValidDimensions) {
        const columns = Math.max(1, Math.min(2048, Math.floor(columnsRaw)));
        const rows = Math.max(1, Math.min(2048, Math.floor(rowsRaw)));
        const maximumItemsRaw = toFiniteNumber(props.maximum_grid_items);
        const maximumItems = maximumItemsRaw === null ? 2048 : Math.max(0, Math.min(2048, Math.floor(maximumItemsRaw)));
        const gridChildIds = dimensionBindingFailed ? [] : childIds.slice(0, maximumItems);
        const gridChildSizes = dimensionBindingFailed ? [] : childSizes.slice(0, maximumItems);
        contentChildIds = gridChildIds;
        contentChildSizes = gridChildSizes;
        const gridMaxChildW = gridChildSizes.reduce((max, size) => Math.max(max, Number(size.w) || 0), 0);
        const gridMaxChildH = gridChildSizes.reduce((max, size) => Math.max(max, Number(size.h) || 0), 0);
        maxChildW = gridMaxChildW;
        maxChildH = gridMaxChildH;
        const columnWidths = new Array(columns).fill(gridChildSizes.length ? gridMaxChildW : 0);
        const rowHeights = new Array(rows).fill(gridChildSizes.length ? gridMaxChildH : 0);
        const verticalFill = String(props.grid_fill_direction || 'horizontal').trim().toLowerCase() === 'vertical';
        gridChildIds.forEach((childId, index) => {
          const childProps = effectivePropsForNodeId(childId);
          const position = readVec2(childProps.grid_position);
          let column = position ? Math.floor(Number(position.x)) : verticalFill ? Math.floor(index / rows) : index % columns;
          let row = position ? Math.floor(Number(position.y)) : verticalFill ? index % rows : Math.floor(index / columns);
          if (!(column >= 0 && column < columns && row >= 0 && row < rows)) return;
          columnWidths[column] = Math.max(columnWidths[column], Number(gridChildSizes[index]?.w) || 0);
          rowHeights[row] = Math.max(rowHeights[row], Number(gridChildSizes[index]?.h) || 0);
        });
        const gridGaps = resolveGridGaps(props);
        const hasGridContent = gridChildSizes.length > 0;
        contentW = columnWidths.reduce((sum, value) => sum + value, 0)
          + (hasGridContent ? gridGaps.x * Math.max(0, columns - 1) : 0);
        contentH = rowHeights.reduce((sum, value) => sum + value, 0)
          + (hasGridContent ? gridGaps.y * Math.max(0, rows - 1) : 0);
      } else if (!dimensionBindingFailed) {
        const maximumItemsRaw = toFiniteNumber(props.maximum_grid_items);
        const maximumItems = maximumItemsRaw === null ? 2048 : Math.max(0, Math.min(2048, Math.floor(maximumItemsRaw)));
        const gridChildIds = childIds.slice(0, maximumItems);
        const gridChildSizes = childSizes.slice(0, maximumItems);
        contentChildIds = gridChildIds;
        contentChildSizes = gridChildSizes;
        const gridMaxChildW = gridChildSizes.reduce((max, size) => Math.max(max, Number(size.w) || 0), 0);
        const gridMaxChildH = gridChildSizes.reduce((max, size) => Math.max(max, Number(size.h) || 0), 0);
        maxChildW = gridMaxChildW;
        maxChildH = gridMaxChildH;
        const count = gridChildSizes.length;
        const rescale = String(props.grid_rescaling_type || '').trim().toLowerCase();
        const gridGaps = resolveGridGaps(props);
        if (count > 0 && rescale === 'horizontal') {
          const capacity = gridMaxChildW > 0
            ? Math.floor((Math.max(0, provisional.w) + gridGaps.x) / Math.max(1, gridMaxChildW + gridGaps.x))
            : Math.ceil(Math.sqrt(count));
          const columns = Math.max(1, Math.min(count, Math.max(1, capacity)));
          const rows = Math.max(1, Math.ceil(count / columns));
          contentW = columns * gridMaxChildW + gridGaps.x * Math.max(0, columns - 1);
          contentH = rows * gridMaxChildH + gridGaps.y * Math.max(0, rows - 1);
        } else if (count > 0 && rescale === 'vertical') {
          const capacity = gridMaxChildH > 0
            ? Math.floor((Math.max(0, provisional.h) + gridGaps.y) / Math.max(1, gridMaxChildH + gridGaps.y))
            : Math.ceil(Math.sqrt(count));
          const rows = Math.max(1, Math.min(count, Math.max(1, capacity)));
          const columns = Math.max(1, Math.ceil(count / rows));
          contentW = columns * gridMaxChildW + gridGaps.x * Math.max(0, columns - 1);
          contentH = rows * gridMaxChildH + gridGaps.y * Math.max(0, rows - 1);
        } else if (count === 0) {
          contentW = 0;
          contentH = 0;
        }
      } else {
        contentChildIds = [];
        contentChildSizes = [];
        maxChildW = 0;
        maxChildH = 0;
        contentW = 0;
        contentH = 0;
      }
    }

    if (isBooleanLikeEnabled(props, 'use_child_anchors') && contentChildIds.length > 0) {
      let cursor = 0;
      let minX = 0;
      let minY = 0;
      let maxX = 0;
      let maxY = 0;
      contentChildIds.forEach((childId, index) => {
        const childNode = nodesById[childId];
        if (!childNode) return;
        const size = contentChildSizes[index] || { w: 0, h: 0 };
        const childProps = effectivePropsForNodeId(childId);
        const childForLayout = overrideProps(childNode, childProps);
        const childParent = isHorizontalStack
          ? { x: cursor, y: 0, w: size.w, h: provisional.h }
          : isVerticalStack
            ? { x: 0, y: cursor, w: provisional.w, h: size.h }
            : { x: 0, y: 0, w: provisional.w, h: provisional.h };
        const childBox = computeNodeBox(childForLayout, childParent, 0, nodeId, {
          ...(sizingContextById[childId] || {}),
          resolvedSize: size,
          onPositionLimit: (axis, value, reason) => reportPositionLimit(childId, axis, value, reason),
          onLayerLimit: (value, reason) => reportLayerLimit(childId, value, reason),
        });
        minX = Math.min(minX, childBox.x);
        minY = Math.min(minY, childBox.y);
        maxX = Math.max(maxX, childBox.x + childBox.w);
        maxY = Math.max(maxY, childBox.y + childBox.h);
        if (isHorizontalStack) cursor += Math.max(0, Number(size.w) || 0);
        if (isVerticalStack) cursor += Math.max(0, Number(size.h) || 0);
      });
      contentW = Math.max(0, maxX - minX);
      contentH = Math.max(0, maxY - minY);
    }

    const context = withLabelTextContent(measuredNodeType, props, {
      contentW,
      contentH,
      contentMaxW: maxChildW,
      contentMaxH: maxChildH,
      siblingMaxW: Number(siblingMax && siblingMax.w) || 0,
      siblingMaxH: Number(siblingMax && siblingMax.h) || 0,
      hasMeasuredChildren: contentChildIds.length > 0,
      hasChildControls: Array.isArray(node.children) && node.children.length > 0,
      onSizeLimit,
    });
    sizingContextById[nodeId] = context;
    const next = computeSize(
      props,
      parentSize.w,
      parentSize.h,
      String(node.type || 'unknown'),
      { ...context, ...defaultSizePolicy },
    );
    naturalSizeById[nodeId] = next;
    const inherited = {
      w: isBooleanLikeEnabled(props, 'inherit_max_sibling_width')
        ? Math.max(next.w, Math.max(0, Number(siblingMax && siblingMax.w) || 0))
        : next.w,
      h: isBooleanLikeEnabled(props, 'inherit_max_sibling_height')
        ? Math.max(next.h, Math.max(0, Number(siblingMax && siblingMax.h) || 0))
        : next.h,
    };
    measuredSizeById[nodeId] = inherited;
    measurementStack.delete(nodeId);
    return inherited;
  }

  let contentMeasurementConverged = false;
  let lastMeasurementDelta = 0;
  let lastChangedMeasurementIds = [];
  let lastChangedMeasurementAxes = new Map();
  const recentChangedAxisMaps = [];
  const measurementStateHistory = [];
  const measurementDeltaHistory = [];
  const contentSizeStepEpsilon = 0.0001;
  const unstableAxisTrackingEpsilon = 1e-9;

  const copySizeMap = (source) => Object.fromEntries(
    Object.entries(source).map(([id, size]) => [id, { w: Number(size.w) || 0, h: Number(size.h) || 0 }]),
  );
  const copyContextMap = () => Object.fromEntries(
    Object.entries(sizingContextById).map(([id, context]) => [id, { ...context }]),
  );
  const replaceRecord = (target, source) => {
    for (const key of Object.keys(target)) delete target[key];
    for (const [key, value] of Object.entries(source)) target[key] = { ...value };
  };
  const snapshotMeasurementState = () => ({
    measured: copySizeMap(measuredSizeById),
    natural: copySizeMap(naturalSizeById),
  });

  const measurementStateDelta = (first, second) => {
    let delta = 0;
    for (const mapName of ['measured', 'natural']) {
      const keys = new Set([
        ...Object.keys(first && first[mapName] || {}),
        ...Object.keys(second && second[mapName] || {}),
      ]);
      for (const id of keys) {
        const left = first?.[mapName]?.[id] || { w: 0, h: 0 };
        const right = second?.[mapName]?.[id] || { w: 0, h: 0 };
        delta = Math.max(
          delta,
          Math.abs((Number(left.w) || 0) - (Number(right.w) || 0)),
          Math.abs((Number(left.h) || 0) - (Number(right.h) || 0)),
        );
      }
    }
    return delta;
  };

  function buildAitkenCandidate(stride = 1) {
    const needed = stride * 2 + 1;
    if (measurementStateHistory.length < needed) return null;
    const latestIndex = measurementStateHistory.length - 1;
    const samples = [
      measurementStateHistory[latestIndex - stride * 2],
      measurementStateHistory[latestIndex - stride],
      measurementStateHistory[latestIndex],
    ];
    const candidate = { measured: {}, natural: {} };
    let accelerated = false;
    // `measured` is derived from natural sizes and sibling inheritance. Never
    // extrapolate it independently: doing so can create a state that no JSON
    // UI sibling group can actually produce.
    for (const [id, latest] of Object.entries(samples[2].natural)) {
      const first = samples[0].natural[id];
      const second = samples[1].natural[id];
      const output = { ...latest };
      for (const axis of ['w', 'h']) {
        if (!first || !second) continue;
        const x0 = Number(first[axis]);
        const x1 = Number(second[axis]);
        const x2 = Number(latest[axis]);
        const denominator = x2 - 2 * x1 + x0;
        const deltaScale = Math.max(Number.MIN_VALUE, Math.abs(x1 - x0), Math.abs(x2 - x1));
        if (![x0, x1, x2, denominator].every(Number.isFinite)
          || Math.abs(denominator) <= deltaScale * 1e-12) continue;
        const estimate = x0 - ((x1 - x0) * (x1 - x0)) / denominator;
        if (!Number.isFinite(estimate) || estimate < 0 || estimate > MAX_LAYOUT_EXTENT) continue;
        output[axis] = estimate;
        if (Math.abs(estimate - x2) > 1e-9) accelerated = true;
      }
      candidate.natural[id] = output;
    }
    candidate.measured = deriveMeasuredMap(candidate.natural);
    return accelerated ? candidate : null;
  }

  const rootIds = rootIsFile && Array.isArray(root && root.children)
    ? root.children.map(String)
    : root
      ? [rootId]
      : [];

  function deriveMeasuredMap(naturalMap, candidateRootIds = rootIds) {
    const derived = copySizeMap(naturalMap || {});
    const visited = new Set();
    const deriveGroup = (candidateIds, depth = 0) => {
      if (depth > maxLayoutDepth) return;
      const ids = (Array.isArray(candidateIds) ? candidateIds : []).map(String).filter((id) => {
        const node = nodesById && nodesById[id];
        if (!node || isRuntimeOnlyPreviewNode(node, visibilityMode)) return false;
        const props = effectivePropsForNodeId(id);
        return typeof isVisibleFromProps !== 'function' || isVisibleFromProps(props, { mode: visibilityMode });
      });
      const naturalSizes = ids.map((id) => naturalMap[id] || { w: 0, h: 0 });
      const peerSizes = computePeerMaxSizes(naturalSizes);
      ids.forEach((id, index) => {
        const props = effectivePropsForNodeId(id);
        const natural = naturalSizes[index];
        derived[id] = {
          w: isBooleanLikeEnabled(props, 'inherit_max_sibling_width')
            ? Math.max(Number(natural.w) || 0, Number(peerSizes[index]?.w) || 0)
            : Number(natural.w) || 0,
          h: isBooleanLikeEnabled(props, 'inherit_max_sibling_height')
            ? Math.max(Number(natural.h) || 0, Number(peerSizes[index]?.h) || 0)
            : Number(natural.h) || 0,
        };
      });
      ids.forEach((id) => {
        if (visited.has(id)) return;
        visited.add(id);
        const node = nodesById && nodesById[id];
        const props = effectivePropsForNodeId(id);
        const visibleChildren = Array.isArray(node && node.children) ? node.children.map(String).filter((childId) => {
          const child = nodesById && nodesById[childId];
          if (!child || isRuntimeOnlyPreviewNode(child, visibilityMode)) return false;
          const childProps = effectivePropsForNodeId(childId);
          return typeof isVisibleFromProps !== 'function' || isVisibleFromProps(childProps, { mode: visibilityMode });
        }) : [];
        deriveGroup(selectSafeStateChildren(node, props, visibleChildren), depth + 1);
      });
    };
    deriveGroup(candidateRootIds);
    return derived;
  }

  function trySafeguardedDamping(beforeState, currentState) {
    const baselineResidual = measurementStateDelta(beforeState, currentState);
    if (!Number.isFinite(baselineResidual) || baselineResidual <= contentSizeStepEpsilon) return { status: 'unavailable' };

    const savedMeasured = copySizeMap(measuredSizeById);
    const savedNatural = copySizeMap(naturalSizeById);
    const savedContexts = copyContextMap();
    const savedWarningsLength = warnings.length;
    const savedReportedLimits = [...reportedSizeLimits];
    const restoreCurrentState = () => {
      replaceRecord(measuredSizeById, savedMeasured);
      replaceRecord(naturalSizeById, savedNatural);
      replaceRecord(sizingContextById, savedContexts);
      warnings.length = savedWarningsLength;
      reportedSizeLimits.clear();
      for (const key of savedReportedLimits) reportedSizeLimits.add(key);
      recursiveSizeLimitsThisPass.clear();
    };

    for (const weight of [0.5, 0.25, 0.125, 0.0625]) {
      restoreCurrentState();
      const candidateNatural = {};
      const ids = new Set([
        ...Object.keys(beforeState.natural || {}),
        ...Object.keys(currentState.natural || {}),
      ]);
      for (const id of ids) {
        const previous = beforeState.natural?.[id] || { w: 0, h: 0 };
        const current = currentState.natural?.[id] || { w: 0, h: 0 };
        candidateNatural[id] = {
          w: (Number(previous.w) || 0) + weight * ((Number(current.w) || 0) - (Number(previous.w) || 0)),
          h: (Number(previous.h) || 0) + weight * ((Number(current.h) || 0) - (Number(previous.h) || 0)),
        };
      }
      const candidate = { natural: candidateNatural, measured: deriveMeasuredMap(candidateNatural) };
      replaceRecord(naturalSizeById, candidate.natural);
      replaceRecord(measuredSizeById, candidate.measured);
      recursiveSizeLimitsThisPass.clear();
      for (const childId of rootIds) measureNode(childId, { w: screen.w, h: screen.h }, { w: 0, h: 0 });
      if (measurementBudgetReported) {
        restoreCurrentState();
        ensureMeasurementBudgetWarning();
        return { status: 'budget' };
      }
      const evaluated = snapshotMeasurementState();
      const residual = measurementStateDelta(candidate, evaluated);
      if (recursiveSizeLimitsThisPass.size === 0
        && Number.isFinite(residual)
        && residual < baselineResidual * (1 - 1e-9)) {
        // Keep the damped point as the next iterate. `evaluated` is used only
        // to prove progress; installing F(candidate) would undo the damping
        // and can restore the same negative-gain cycle on the next pass.
        replaceRecord(naturalSizeById, candidate.natural);
        replaceRecord(measuredSizeById, candidate.measured);
        replaceRecord(sizingContextById, savedContexts);
        warnings.length = savedWarningsLength;
        reportedSizeLimits.clear();
        for (const key of savedReportedLimits) reportedSizeLimits.add(key);
        recursiveSizeLimitsThisPass.clear();
        return { status: 'accepted', residual };
      }
    }

    restoreCurrentState();
    return { status: 'rejected' };
  }

  function verifyAitkenCandidate(candidate) {
    if (!candidate) return 'unavailable';
    const savedMeasured = copySizeMap(measuredSizeById);
    const savedNatural = copySizeMap(naturalSizeById);
    const savedContexts = copyContextMap();
    const savedWarningsLength = warnings.length;
    const savedReportedLimits = [...reportedSizeLimits];
    const restoreSavedState = () => {
      replaceRecord(measuredSizeById, savedMeasured);
      replaceRecord(naturalSizeById, savedNatural);
      replaceRecord(sizingContextById, savedContexts);
      warnings.length = savedWarningsLength;
      reportedSizeLimits.clear();
      for (const key of savedReportedLimits) reportedSizeLimits.add(key);
      recursiveSizeLimitsThisPass.clear();
    };
    replaceRecord(measuredSizeById, candidate.measured);
    replaceRecord(naturalSizeById, candidate.natural);
    recursiveSizeLimitsThisPass.clear();
    for (const childId of rootIds) measureNode(childId, { w: screen.w, h: screen.h }, { w: 0, h: 0 });
    if (measurementBudgetReported) {
      restoreSavedState();
      ensureMeasurementBudgetWarning();
      return 'budget';
    }
    const projected = snapshotMeasurementState();
    recursiveSizeLimitsThisPass.clear();
    for (const childId of rootIds) measureNode(childId, { w: screen.w, h: screen.h }, { w: 0, h: 0 });
    if (measurementBudgetReported) {
      restoreSavedState();
      ensureMeasurementBudgetWarning();
      return 'budget';
    }

    let residual = 0;
    let candidateScale = 1;
    for (const mapName of ['measured', 'natural']) {
      const actualMap = mapName === 'measured' ? measuredSizeById : naturalSizeById;
      for (const [id, expected] of Object.entries(projected[mapName])) {
        const actual = actualMap[id];
        if (!actual) {
          residual = Number.POSITIVE_INFINITY;
          break;
        }
        for (const axis of ['w', 'h']) {
          const actualValue = Number(actual[axis]);
          const expectedValue = Number(expected[axis]);
          if (!Number.isFinite(actualValue) || !Number.isFinite(expectedValue)) {
            residual = Number.POSITIVE_INFINITY;
            break;
          }
          residual = Math.max(residual, Math.abs(actualValue - expectedValue));
          candidateScale = Math.max(candidateScale, Math.abs(actualValue), Math.abs(expectedValue));
        }
      }
    }
    const verificationTolerance = Math.max(1e-7, candidateScale * 1e-10);
    if (recursiveSizeLimitsThisPass.size === 0 && residual <= verificationTolerance) {
      lastMeasurementDelta = residual;
      return 'accepted';
    }

    restoreSavedState();
    return 'rejected';
  }
  // A plain fixed-point iteration keeps the natural size, sibling context,
  // and measured size on the same state. Per-coordinate extrapolation looks
  // attractive for a scalar `%c` equation, but is unsound for mutually
  // dependent `%sm` siblings. Small trees may use more passes, while the
  // global work budget keeps adversarial packs bounded.
  const maxContentSizePasses = 2048;
  for (let pass = 0; pass < maxContentSizePasses; pass += 1) {
    recursiveSizeLimitsThisPass.clear();
    const before = copySizeMap(measuredSizeById);
    const beforeNatural = copySizeMap(naturalSizeById);
    for (const childId of rootIds) measureNode(childId, { w: screen.w, h: screen.h }, { w: 0, h: 0 });
    if (measurementBudgetReported) {
      lastMeasurementDelta = Number.POSITIVE_INFINITY;
      lastChangedMeasurementIds = Object.keys(measuredSizeById);
      lastChangedMeasurementAxes = new Map(lastChangedMeasurementIds.map((id) => [id, { w: true, h: true }]));
      break;
    }
    lastMeasurementDelta = 0;
    lastChangedMeasurementIds = [];
    lastChangedMeasurementAxes = new Map();
    for (const [id, size] of Object.entries(measuredSizeById)) {
      const old = before[id] || { w: 0, h: 0 };
      const oldNatural = beforeNatural[id] || { w: 0, h: 0 };
      const currentNatural = naturalSizeById[id] || { w: 0, h: 0 };
      const widthDelta = Math.max(
        Math.abs((Number(size.w) || 0) - (Number(old.w) || 0)),
        Math.abs((Number(currentNatural.w) || 0) - (Number(oldNatural.w) || 0)),
      );
      const heightDelta = Math.max(
        Math.abs((Number(size.h) || 0) - (Number(old.h) || 0)),
        Math.abs((Number(currentNatural.h) || 0) - (Number(oldNatural.h) || 0)),
      );
      const nodeDelta = Math.max(widthDelta, heightDelta);
      lastMeasurementDelta = Math.max(lastMeasurementDelta, nodeDelta);
      if (nodeDelta >= unstableAxisTrackingEpsilon) {
        lastChangedMeasurementIds.push(id);
        lastChangedMeasurementAxes.set(id, {
          w: widthDelta >= unstableAxisTrackingEpsilon,
          h: heightDelta >= unstableAxisTrackingEpsilon,
        });
      }
    }
    recentChangedAxisMaps.push(new Map(lastChangedMeasurementAxes));
    if (recentChangedAxisMaps.length > 8) recentChangedAxisMaps.shift();
    measurementStateHistory.push(snapshotMeasurementState());
    if (measurementStateHistory.length > 5) measurementStateHistory.shift();
    measurementDeltaHistory.push(lastMeasurementDelta);
    if (measurementDeltaHistory.length > 3) measurementDeltaHistory.shift();

    const priorMeasurementDelta = measurementDeltaHistory.length >= 2
      ? measurementDeltaHistory[measurementDeltaHistory.length - 2]
      : Number.POSITIVE_INFINITY;
    const residualIsGrowing = Number.isFinite(priorMeasurementDelta)
      && lastMeasurementDelta > priorMeasurementDelta * (1 + 1e-9);
    let accelerationResult = 'unavailable';
    if (recursiveSizeLimitsThisPass.size === 0 && measurementStateHistory.length >= 3
      && (pass === 2 || pass % 16 === 0 || residualIsGrowing || lastMeasurementDelta < contentSizeStepEpsilon)) {
      accelerationResult = verifyAitkenCandidate(buildAitkenCandidate(1));
      if (accelerationResult === 'rejected' && measurementStateHistory.length >= 5) {
        accelerationResult = verifyAitkenCandidate(buildAitkenCandidate(2));
      }
      if (accelerationResult === 'accepted') {
        contentMeasurementConverged = true;
        break;
      }
      if (accelerationResult === 'budget') {
        lastMeasurementDelta = Number.POSITIVE_INFINITY;
        lastChangedMeasurementIds = Object.keys(measuredSizeById);
        lastChangedMeasurementAxes = new Map(lastChangedMeasurementIds.map((id) => [id, { w: true, h: true }]));
        break;
      }
    }

    // Clamps can turn a negative-gain fixed point into a 2-cycle, for which
    // scalar Aitken extrapolation produces a progress point rather than the
    // solution. Install a convex seed only when a full fresh evaluation proves
    // that it strictly reduces the whole-state residual. It is never treated
    // as convergence and remains subject to the global work/depth limits.
    if (accelerationResult === 'rejected' && recursiveSizeLimitsThisPass.size === 0) {
      const damped = trySafeguardedDamping(
        { measured: before, natural: beforeNatural },
        snapshotMeasurementState(),
      );
      if (damped.status === 'budget') {
        lastMeasurementDelta = Number.POSITIVE_INFINITY;
        lastChangedMeasurementIds = Object.keys(measuredSizeById);
        lastChangedMeasurementAxes = new Map(lastChangedMeasurementIds.map((id) => [id, { w: true, h: true }]));
        break;
      }
      if (damped.status === 'accepted') {
        lastMeasurementDelta = damped.residual;
        lastChangedMeasurementIds = Object.keys(measuredSizeById);
        lastChangedMeasurementAxes = new Map(lastChangedMeasurementIds.map((id) => [id, { w: true, h: true }]));
        measurementStateHistory.length = 0;
        measurementStateHistory.push(snapshotMeasurementState());
        measurementDeltaHistory.length = 0;
        measurementDeltaHistory.push(lastMeasurementDelta);
        continue;
      }
    }

    if (recursiveSizeLimitsThisPass.size > 0 && lastMeasurementDelta < contentSizeStepEpsilon) {
      lastChangedMeasurementAxes = new Map(recursiveSizeLimitsThisPass);
      lastChangedMeasurementIds = [...lastChangedMeasurementAxes.keys()];
      break;
    }

    // A small step is not sufficient: a high-gain peer may react only on the
    // following frame. Candidate acceleration above is accepted only after a
    // full residual evaluation; the non-accelerated path requires two exact
    // stable frames for piecewise/clamped layouts.
    const lastTwoDeltas = measurementDeltaHistory.slice(-2);
    if (lastTwoDeltas.length === 2 && lastTwoDeltas.every((delta) => delta === 0)) {
      contentMeasurementConverged = true;
      break;
    }
  }
  const fallbackContextResetFieldsById = new Map();
  if (!contentMeasurementConverged) {
    const deltaLabel = recursiveSizeLimitsThisPass.size > 0
      ? 'limit'
      : Number.isFinite(lastMeasurementDelta)
        ? Math.abs(lastMeasurementDelta) >= 0.01
          ? lastMeasurementDelta.toFixed(2)
          : lastMeasurementDelta.toPrecision(6)
        : 'budget';
    warnings.push(`CONTENT_SIZE_FIXED_POINT_LIMIT:${deltaLabel}`);
    // Do not expose arbitrary last-iteration geometry. Unstable content/sibling
    // feedback is reset to a deterministic zero basis while authored absolute
    // and parent-relative terms remain available.
    const unstableAxesById = new Map();
    const mergeUnstableAxes = (id, axes) => {
      const key = String(id);
      const prior = unstableAxesById.get(key) || { w: false, h: false };
      unstableAxesById.set(key, { w: prior.w || Boolean(axes?.w), h: prior.h || Boolean(axes?.h) });
    };
    if (recursiveSizeLimitsThisPass.size > 0) {
      // A direct size-limit callback identifies the failing node/axis more
      // precisely than early fixed-point deltas. Including the initial
      // settling frames here used to mark stable sibling axes as unstable.
      for (const [id, axes] of recursiveSizeLimitsThisPass) mergeUnstableAxes(id, axes);
      // A direct failure on one axis does not prove that every other equation
      // settled. Preserve the final-frame evidence so an independent cycle (or
      // a budget exit, which marks every axis) cannot leak its last iterate.
      for (const [id, axes] of lastChangedMeasurementAxes) mergeUnstableAxes(id, axes);
    } else {
      for (const changedMap of recentChangedAxisMaps) {
        for (const [id, axes] of changedMap) mergeUnstableAxes(id, axes);
      }
      for (const [id, axes] of lastChangedMeasurementAxes) mergeUnstableAxes(id, axes);
    }

    // Propagate only in the direction of an actual layout dependency. Treating
    // every ancestor/descendant edge as bidirectional makes one unstable `%c`
    // branch erase independent siblings below an absolute-sized parent.
    const parentByChildId = new Map();
    for (const [candidateParentId, candidateParent] of Object.entries(nodesById || {})) {
      for (const childId of Array.isArray(candidateParent && candidateParent.children)
        ? candidateParent.children.map(String)
        : []) {
        if (!parentByChildId.has(childId)) parentByChildId.set(childId, String(candidateParentId));
      }
    }
    const axisExpressionValues = (id, axis) => {
      const props = effectivePropsForNodeId(id);
      const axisIndex = axis === 'h' ? 1 : 0;
      return [props.size, props.min_size, props.max_size]
        .map(readVec2)
        .map((vector) => vector ? (axisIndex === 1 ? vector.y : vector.x) : null);
    };
    const hasUnit = (value, unit) => {
      if (typeof value !== 'string') return false;
      const token = value.toLowerCase();
      if (unit === 'c') return /%c(?:\b|(?=\s|[+\-*/)]|$))/u.test(token);
      if (unit === 'cm') return /%cm(?:\b|(?=\s|[+\-*/)]|$))/u.test(token);
      if (unit === 'sm') return /%sm(?:\b|(?=\s|[+\-*/)]|$))/u.test(token);
      if (unit === 'x') return /%x(?:\b|(?=\s|[+\-*/)]|$))/u.test(token);
      if (unit === 'y') return /%y(?:\b|(?=\s|[+\-*/)]|$))/u.test(token);
      return false;
    };
    const directContentFallbackTypes = new Set([
      'panel', 'input_panel', 'button', 'dropdown', 'toggle', 'grid',
      'scroll_track', 'scrollbar_box', 'unknown',
    ]);
    const defaultContentFieldForAxis = (id, axis) => {
      const node = nodesById && nodesById[id];
      const type = String(node?.type || '').toLowerCase();
      if (type === 'stack_panel') {
        const horizontal = String(effectivePropsForNodeId(id).orientation || 'vertical').toLowerCase() === 'horizontal';
        return horizontal === (axis === 'w') ? 'content' : 'contentMax';
      }
      return directContentFallbackTypes.has(type) ? 'content' : null;
    };
    const dependsOnChildContent = (id, axis) => axisExpressionValues(id, axis).some((value, index) => {
      if (typeof value !== 'string') return false;
      const token = value.trim().toLowerCase();
      return hasUnit(value, 'c') || hasUnit(value, 'cm')
        || (index === 0 && token === 'default' && defaultContentFieldForAxis(id, axis) !== null);
    });
    const dependsOnChildPositionContent = (id, axis) => axisExpressionValues(id, axis).some((value, index) => {
      if (typeof value !== 'string') return false;
      const token = value.trim().toLowerCase();
      return hasUnit(value, 'c')
        || (index === 0 && token === 'default' && defaultContentFieldForAxis(id, axis) === 'content');
    });
    const dependsOnParent = (id, axis) => {
      const node = nodesById && nodesById[id];
      const props = effectivePropsForNodeId(id);
      const values = axisExpressionValues(id, axis);
      if (values.some((value) => typeof value === 'string' && /%(?![a-z])/iu.test(value))) return true;
      if (typeof values[0] === 'string' && values[0].trim().toLowerCase() === 'fill') return true;
      const sizeVector = readVec2(props.size);
      const legacyValue = axis === 'h' ? props.h : props.w;
      return !sizeVector && legacyValue === undefined && shouldFillParentWhenSizeOmitted(node);
    };
    const dependsOnSibling = (id, axis) => {
      const props = effectivePropsForNodeId(id);
      return axisExpressionValues(id, axis).some((value) => hasUnit(value, 'sm'))
        || isBooleanLikeEnabled(
          props,
          axis === 'w' ? 'inherit_max_sibling_width' : 'inherit_max_sibling_height',
        );
    };
    // An offset reads the same recursive sizing context as `size`, but does not
    // make the control's measured width/height unstable. Track those position-
    // only dependencies independently so fail-closed recovery cannot retain an
    // arbitrary last-pass coordinate or collapse the control's stable size.
    const addOffsetContextResets = (id, fields) => {
      if (!id || !Array.isArray(fields) || fields.length === 0) return;
      const key = String(id);
      const existing = fallbackContextResetFieldsById.get(key) || new Set();
      for (const field of fields) existing.add(field);
      fallbackContextResetFieldsById.set(key, existing);
    };
    const offsetValueForAxis = (id, axis) => {
      const offset = readVec2(effectivePropsForNodeId(id).offset);
      return offset ? (axis === 'h' ? offset.y : offset.x) : null;
    };
    const offsetDependsOnParent = (id, axis) => {
      const value = offsetValueForAxis(id, axis);
      return typeof value === 'string' && /%(?![a-z])/iu.test(value);
    };
    const contentOffsetFields = (id, axis) => {
      const value = offsetValueForAxis(id, axis);
      const suffix = axis === 'h' ? 'H' : 'W';
      return [
        ...(hasUnit(value, 'c') ? [`content${suffix}`] : []),
        ...(hasUnit(value, 'cm') ? [`contentMax${suffix}`] : []),
      ];
    };
    const siblingOffsetFields = (id, axis) => hasUnit(offsetValueForAxis(id, axis), 'sm')
      ? [`siblingMax${axis === 'h' ? 'H' : 'W'}`]
      : [];
    const measuredChildrenCache = new Map();
    const measuredChildSetCache = new Map();
    const measuredChildrenFor = (parentId) => {
      const key = String(parentId);
      if (measuredChildrenCache.has(key)) return measuredChildrenCache.get(key);
      const parent = nodesById && nodesById[key];
      const visible = Array.isArray(parent && parent.children) ? parent.children.map(String).filter((childId) => {
        const child = nodesById && nodesById[childId];
        if (!child || isRuntimeOnlyPreviewNode(child, visibilityMode)) return false;
        const childProps = effectivePropsForNodeId(childId);
        return typeof isVisibleFromProps !== 'function'
          || isVisibleFromProps(childProps, { mode: visibilityMode });
      }) : [];
      const selected = selectSafeStateChildren(parent, effectivePropsForNodeId(key), visible);
      measuredChildrenCache.set(key, selected);
      return selected;
    };
    const measuredChildSetFor = (parentId) => {
      const key = String(parentId);
      if (!measuredChildSetCache.has(key)) {
        measuredChildSetCache.set(key, new Set(measuredChildrenFor(key)));
      }
      return measuredChildSetCache.get(key);
    };
    const addUnstableAxes = (id, axes, workQueue) => {
      if (!id) return;
      const key = String(id);
      const prior = unstableAxesById.get(key) || { w: false, h: false };
      const added = { w: Boolean(axes.w) && !prior.w, h: Boolean(axes.h) && !prior.h };
      if (!added.w && !added.h) return;
      const next = { w: prior.w || added.w, h: prior.h || added.h };
      unstableAxesById.set(key, next);
      workQueue.push({ kind: 'size', id: key, axes: added });
    };
    const unstableOffsetAxesById = new Map();
    const addUnstableOffsetAxes = (id, axes, workQueue) => {
      if (!id) return;
      const key = String(id);
      const prior = unstableOffsetAxesById.get(key) || { w: false, h: false };
      const added = { w: Boolean(axes.w) && !prior.w, h: Boolean(axes.h) && !prior.h };
      if (!added.w && !added.h) return;
      unstableOffsetAxesById.set(key, { w: prior.w || added.w, h: prior.h || added.h });
      workQueue.push({ kind: 'offset', id: key, axes: added });
    };
    const taintOffsetContext = (id, axis, fields, workQueue) => {
      if (!fields.length) return;
      addOffsetContextResets(id, fields);
      addUnstableOffsetAxes(id, { [axis]: true }, workQueue);
    };
    const siblingProvidersByGroupAxis = new Map();
    const propagateUnstableSiblingProvider = (parentId, providerId, axis, workQueue) => {
      const normalizedProviderId = String(providerId);
      if (!measuredChildSetFor(parentId).has(normalizedProviderId)) return;
      const groupKey = `${String(parentId)}\u0000${axis}`;
      const providers = siblingProvidersByGroupAxis.get(groupKey) || new Set();
      if (providers.has(normalizedProviderId)) return;
      const priorProvider = providers.size === 1 ? providers.values().next().value : null;
      providers.add(normalizedProviderId);
      siblingProvidersByGroupAxis.set(groupKey, providers);

      // `%sm` excludes the current node. The first unstable provider taints all
      // other peers; a second provider additionally taints the first. Every
      // later provider is already covered, keeping very wide groups O(n).
      const targets = providers.size === 1
        ? measuredChildrenFor(parentId).filter((siblingId) => siblingId !== normalizedProviderId)
        : providers.size === 2 && priorProvider
          ? [priorProvider]
          : [];
      for (const siblingId of targets) {
        taintOffsetContext(siblingId, axis, siblingOffsetFields(siblingId, axis), workQueue);
        addUnstableAxes(siblingId, { [axis]: dependsOnSibling(siblingId, axis) }, workQueue);
      }
    };

    const queue = [...unstableAxesById.entries()]
      .map(([id, axes]) => ({ kind: 'size', id, axes: { ...axes } }));
    for (let index = 0; index < queue.length; index += 1) {
      const { kind, id, axes } = queue[index];
      const node = nodesById && nodesById[id];
      const parentId = parentByChildId.get(String(id));
      const parent = parentId ? nodesById[parentId] : null;

      if (kind === 'offset') {
        // Offsets affect ancestor content bounds only when the parent opts into
        // anchored child extents. Position changes taint `%c`, never `%cm`
        // (which is based on child size rather than child position).
        if (parent && isBooleanLikeEnabled(effectivePropsForNodeId(parentId), 'use_child_anchors')) {
          if (axes.w) {
            const fields = hasUnit(offsetValueForAxis(parentId, 'w'), 'c') ? ['contentW'] : [];
            taintOffsetContext(parentId, 'w', fields, queue);
            if (dependsOnChildPositionContent(parentId, 'w')) addUnstableAxes(parentId, { w: true }, queue);
          }
          if (axes.h) {
            const fields = hasUnit(offsetValueForAxis(parentId, 'h'), 'c') ? ['contentH'] : [];
            taintOffsetContext(parentId, 'h', fields, queue);
            if (dependsOnChildPositionContent(parentId, 'h')) addUnstableAxes(parentId, { h: true }, queue);
          }
        }
        continue;
      }

      // `%x` is the control's own width and `%y` its own height. Couple the
      // opposite axis only after the referenced self-axis actually changes.
      if (axes.w && axisExpressionValues(id, 'h').some((value) => hasUnit(value, 'x'))) {
        addUnstableAxes(id, { h: true }, queue);
      }
      if (axes.h && axisExpressionValues(id, 'w').some((value) => hasUnit(value, 'y'))) {
        addUnstableAxes(id, { w: true }, queue);
      }
      const offsetX = offsetValueForAxis(id, 'w');
      const offsetY = offsetValueForAxis(id, 'h');
      if (axes.w) {
        addUnstableOffsetAxes(id, {
          w: hasUnit(offsetX, 'x'),
          h: hasUnit(offsetY, 'x'),
        }, queue);
      }
      if (axes.h) {
        addUnstableOffsetAxes(id, {
          w: hasUnit(offsetX, 'y'),
          h: hasUnit(offsetY, 'y'),
        }, queue);
      }

      if (parent) {
        if (axes.w) taintOffsetContext(parentId, 'w', contentOffsetFields(parentId, 'w'), queue);
        if (axes.h) taintOffsetContext(parentId, 'h', contentOffsetFields(parentId, 'h'), queue);
        addUnstableAxes(parentId, {
          w: axes.w && dependsOnChildContent(parentId, 'w'),
          h: axes.h && dependsOnChildContent(parentId, 'h'),
        }, queue);

        if (axes.w) propagateUnstableSiblingProvider(parentId, id, 'w', queue);
        if (axes.h) propagateUnstableSiblingProvider(parentId, id, 'h', queue);
      }

      for (const childId of node ? measuredChildrenFor(id) : []) {
        addUnstableAxes(childId, {
          w: axes.w && dependsOnParent(childId, 'w'),
          h: axes.h && dependsOnParent(childId, 'h'),
        }, queue);
        addUnstableOffsetAxes(childId, {
          w: axes.w && offsetDependsOnParent(childId, 'w'),
          h: axes.h && offsetDependsOnParent(childId, 'h'),
        }, queue);
      }
    }

    for (const [id, changedAxes] of unstableAxesById) {
      const previousContext = sizingContextById[id] || {};
      sizingContextById[id] = {
        ...previousContext,
        ...(changedAxes.w ? { contentW: 0, contentMaxW: 0, siblingMaxW: 0 } : {}),
        ...(changedAxes.h ? { contentH: 0, contentMaxH: 0, siblingMaxH: 0 } : {}),
      };
    }
    for (const [id, fields] of fallbackContextResetFieldsById) {
      const previousContext = sizingContextById[id] || {};
      const resetFields = Object.fromEntries([...fields].map((field) => [field, 0]));
      sizingContextById[id] = { ...previousContext, ...resetFields };
    }
  }

  function applyFallbackContextResets(nodeId, context) {
    const fields = fallbackContextResetFieldsById.get(String(nodeId));
    if (!fields || fields.size === 0) return context;
    const resetFields = Object.fromEntries([...fields].map((field) => [field, 0]));
    return { ...context, ...resetFields };
  }

  const allocatedContextWarnings = new Set();
  const allocatedFallbackContextKey = Symbol('allocatedFallbackContext');
  const allocatedGridPlanKey = Symbol('allocatedGridPlan');
  const zeroAllocatedContext = Object.freeze({
    contentW: 0,
    contentH: 0,
    contentMaxW: 0,
    contentMaxH: 0,
    siblingMaxW: 0,
    siblingMaxH: 0,
    hasMeasuredChildren: false,
  });

  function allocatedContextFor(contexts, id) {
    if (!contexts) return {};
    return contexts[id] || contexts[allocatedFallbackContextKey] || {};
  }

  function computeGridAllocation(
    gridNode,
    gridProps,
    gridBox,
    candidateChildIds,
    allocatedContexts = null,
    { emitWarnings = true } = {},
  ) {
    const gridId = String(gridNode && gridNode.id || '');
    const maxGridDimension = 2048;
    let cols = 1;
    let rows = 1;
    let hasAuthoredDimensions = false;
    let boundDimensionsFailed = false;
    const diagnostics = [];
    const positionIssues = [];
    const warn = (message) => {
      diagnostics.push(message);
      if (emitWarnings) warnings.push(message);
    };
    const notePositionIssue = (childId, status) => {
      positionIssues.push({ childId: String(childId), status });
      if (emitWarnings) reportGridPositionIssue(childId, status);
    };
    const acceptGridDimensions = (rawColumns, rawRows, source) => {
      if (rawColumns === null || rawRows === null || rawColumns <= 0 || rawRows <= 0) return false;
      cols = Math.max(1, Math.min(maxGridDimension, Math.floor(rawColumns)));
      rows = Math.max(1, Math.min(maxGridDimension, Math.floor(rawRows)));
      if (rawColumns > maxGridDimension || rawRows > maxGridDimension) {
        warn(`GRID_DIMENSION_LIMIT:${gridId}:${source}:${String(rawColumns)}x${String(rawRows)}:${maxGridDimension}`);
      }
      hasAuthoredDimensions = true;
      return true;
    };

    const dims = readVec2(gridProps && gridProps.grid_dimensions);
    if (dims) acceptGridDimensions(toFiniteNumber(dims.x), toFiniteNumber(dims.y), 'authored');
    const dimensionBinding = typeof gridProps?.grid_dimension_binding === 'string'
      ? gridProps.grid_dimension_binding.trim()
      : '';
    if (!hasAuthoredDimensions && dimensionBinding) {
      const bareBinding = /^[#$]/u.test(dimensionBinding) ? dimensionBinding.slice(1) : dimensionBinding;
      const boundValue = Object.prototype.hasOwnProperty.call(gridProps, dimensionBinding)
        ? gridProps[dimensionBinding]
        : bareBinding && Object.prototype.hasOwnProperty.call(gridProps, bareBinding)
          ? gridProps[bareBinding]
          : undefined;
      if (boundValue === undefined) {
        warn(`GRID_DIMENSION_BINDING_UNRESOLVED:${gridId}:${dimensionBinding}`);
        boundDimensionsFailed = true;
      } else {
        const boundDims = readVec2(boundValue);
        if (!acceptGridDimensions(
          boundDims ? toFiniteNumber(boundDims.x) : null,
          boundDims ? toFiniteNumber(boundDims.y) : null,
          'binding',
        )) {
          warn(`GRID_DIMENSION_BINDING_INVALID:${gridId}:${dimensionBinding}`);
          boundDimensionsFailed = true;
        }
      }
    }

    const visibleChildIds = (Array.isArray(candidateChildIds) ? candidateChildIds : [])
      .map(String)
      .filter((childId) => {
        const childNode = nodesById && nodesById[childId];
        if (!childNode || isRuntimeOnlyPreviewNode(childNode, visibilityMode)) return false;
        const childProps = effectivePropsForNodeId(childId);
        return typeof isVisibleFromProps !== 'function'
          || isVisibleFromProps(childProps, { mode: visibilityMode });
      });
    const maxItemsRaw = toFiniteNumber(gridProps && gridProps.maximum_grid_items);
    const maxItems = maxItemsRaw !== null ? Math.max(0, Math.floor(maxItemsRaw)) : null;
    const requestedChildIds = maxItems !== null ? visibleChildIds.slice(0, maxItems) : visibleChildIds;
    let childIds = boundDimensionsFailed ? [] : requestedChildIds.slice(0, 2048);
    if (!boundDimensionsFailed && requestedChildIds.length > childIds.length) {
      warn(`GRID_CHILD_LIMIT:${gridId}:${requestedChildIds.length}:2048`);
    }
    childIds = childIds.filter((childId) => {
      const result = readExplicitGridPosition(
        childId,
        hasAuthoredDimensions ? cols : null,
        hasAuthoredDimensions ? rows : null,
      );
      if (result.status === 'missing' || result.status === 'valid') return true;
      notePositionIssue(childId, result.status);
      return false;
    });

    const fill = String(gridProps?.grid_fill_direction || 'horizontal').trim().toLowerCase();
    const fillDir = fill === 'vertical' ? 'vertical' : 'horizontal';
    const rescaleRaw = typeof gridProps?.grid_rescaling_type === 'string'
      ? gridProps.grid_rescaling_type.trim().toLowerCase()
      : '';
    const rescale = ['none', 'horizontal', 'vertical'].includes(rescaleRaw) ? rescaleRaw : 'none';
    if (rescaleRaw && rescaleRaw !== rescale) warn(`GRID_RESCALING_TYPE_UNSUPPORTED:${gridId}:${rescaleRaw}`);
    const gaps = resolveGridGaps(gridProps);
    const gapX = gaps.x;
    const gapY = gaps.y;
    const boxW = Math.max(0, Number(gridBox && gridBox.w) || 0);
    const boxH = Math.max(0, Number(gridBox && gridBox.h) || 0);
    const hasParentPercent = (value) => typeof value === 'string' && /%(?![a-z])/iu.test(value);
    const childPercentAxes = (childId) => {
      if (!hasAuthoredDimensions) return { w: false, h: false };
      const childProps = effectivePropsForNodeId(childId);
      const vectors = [childProps.size, childProps.min_size, childProps.max_size].map(readVec2);
      return {
        w: vectors.some((vector) => vector && hasParentPercent(vector.x)),
        h: vectors.some((vector) => vector && hasParentPercent(vector.y)),
      };
    };
    const percentSizingForChild = (childId) => {
      const percentAxes = childPercentAxes(childId);
      return {
        ...(percentAxes.w ? { percentBaseW: boxW } : {}),
        ...(percentAxes.h ? { percentBaseH: boxH } : {}),
      };
    };
    const contextForChild = (childId, extra = {}) => {
      const childNode = nodesById && nodesById[childId];
      return {
        ...(sizingContextById[childId] || {}),
        ...allocatedContextFor(allocatedContexts, childId),
        fillParentWhenDefault: shouldFillParentWhenSizeOmitted(childNode),
        ...percentSizingForChild(childId),
        ...extra,
        hasChildControls: Array.isArray(childNode?.children) && childNode.children.length > 0,
      };
    };
    const sizeChild = (childId, parentW, parentH, extra = {}) => {
      const childNode = nodesById && nodesById[childId];
      return childNode
        ? computeSize(
            effectivePropsForNodeId(childId),
            parentW,
            parentH,
            String(childNode.type || 'unknown'),
            contextForChild(childId, extra),
          )
        : { w: 0, h: 0 };
    };
    const hasAuthoredSize = (childId) => {
      const childNode = nodesById && nodesById[childId];
      if (!childNode) return false;
      const childOverride = propsByIdOverride && propsByIdOverride[childId]
        ? propsByIdOverride[childId]
        : null;
      const baseSize = childNode.props && childNode.props.size;
      const overrideHasChangedSize = Boolean(
        childOverride
        && Object.prototype.hasOwnProperty.call(childOverride, 'size')
        && JSON.stringify(childOverride.size) !== JSON.stringify(baseSize),
      );
      return childNode.propsPresent && typeof childNode.propsPresent === 'object'
        ? Boolean(childNode.propsPresent.size) || overrideHasChangedSize
        : Boolean(readVec2(baseSize)) || overrideHasChangedSize;
    };

    const authoredSizes = childIds.map((childId) => (
      hasAuthoredSize(childId) ? sizeChild(childId, boxW, boxH) : { w: 0, h: 0 }
    ));
    const maxAuthoredW = authoredSizes.reduce((max, size) => Math.max(max, Number(size.w) || 0), 0);
    const maxAuthoredH = authoredSizes.reduce((max, size) => Math.max(max, Number(size.h) || 0), 0);
    if (!hasAuthoredDimensions && !boundDimensionsFailed) {
      const count = Math.max(0, Math.min(childIds.length, 2048));
      if (count > 0 && (rescale === 'horizontal' || rescale === 'vertical')) {
        const fallbackSpan = Math.max(1, Math.ceil(Math.sqrt(count)));
        if (rescale === 'horizontal') {
          const capacity = maxAuthoredW > 0
            ? Math.floor((boxW + gapX) / Math.max(1, maxAuthoredW + gapX))
            : fallbackSpan;
          cols = Math.max(1, Math.min(count, Math.max(1, capacity)));
          rows = Math.max(1, Math.ceil(count / cols));
        } else {
          const capacity = maxAuthoredH > 0
            ? Math.floor((boxH + gapY) / Math.max(1, maxAuthoredH + gapY))
            : fallbackSpan;
          rows = Math.max(1, Math.min(count, Math.max(1, capacity)));
          cols = Math.max(1, Math.ceil(count / rows));
        }
        warn(`GRID_DIMENSIONS_INFERRED:${gridId}:${cols}x${rows}:${rescale}:${fillDir}`);
      } else if (maxItems !== 0) {
        warn(`GRID_MISSING_DIMENSIONS:${gridId}`);
      }
    }

    // Positions cannot be range-checked until inferred dimensions are known.
    // Keep malformed/out-of-bounds controls out of the sequential fallback;
    // treating them as position-less silently renders authored invalid data.
    childIds = childIds.filter((childId) => {
      const result = readExplicitGridPosition(childId, cols, rows);
      if (result.status === 'missing' || result.status === 'valid') return true;
      notePositionIssue(childId, result.status);
      return false;
    });

    const availableW = Math.max(0, boxW - gapX * Math.max(0, cols - 1));
    const availableH = Math.max(0, boxH - gapY * Math.max(0, rows - 1));
    const divW = cols ? availableW / cols : 0;
    const divH = rows ? availableH / rows : 0;

    let cellW = divW;
    let cellH = divH;
    if (!hasAuthoredDimensions) {
      cellW = maxAuthoredW || divW;
      cellH = maxAuthoredH || divH;
    }
    cellW = Math.max(0, cellW);
    cellH = Math.max(0, cellH);

    const trackContentW = childIds.length > 0 ? cols * cellW + gapX * Math.max(0, cols - 1) : 0;
    const trackContentH = childIds.length > 0 ? rows * cellH + gapY * Math.max(0, rows - 1) : 0;
    const alignRaw = gridProps?.grid_alignment
      || gridProps?.grid_content_alignment
      || gridProps?.content_alignment
      || gridProps?.alignment
      || 'top_left';
    const align = anchorToUnit(alignRaw);
    const localOriginX = Math.max(0, boxW - trackContentW) * align.ax;
    const localOriginY = Math.max(0, boxH - trackContentH) * align.ay;
    const originX = (Number(gridBox && gridBox.x) || 0) + localOriginX;
    const originY = (Number(gridBox && gridBox.y) || 0) + localOriginY;
    const cellCount = Math.max(1, cols * rows);
    const posByChild = new Map();
    const used = new Set();
    for (const childId of childIds) {
      const explicit = readExplicitGridPosition(childId, cols, rows);
      if (explicit.status !== 'valid') continue;
      const key = `${explicit.position.col},${explicit.position.row}`;
      if (used.has(key)) warn(`GRID_POSITION_DUPLICATE:${gridId}:${key}`);
      posByChild.set(childId, explicit.position);
      used.add(key);
    }
    const idxToPos = (index) => {
      const value = ((Number(index) || 0) % cellCount + cellCount) % cellCount;
      if (fillDir === 'vertical') return { col: Math.floor(value / rows) % cols, row: value % rows };
      return { col: value % cols, row: Math.floor(value / cols) % rows };
    };
    let sequence = 0;
    for (const childId of childIds) {
      if (posByChild.has(childId)) continue;
      let position = idxToPos(sequence++);
      let key = `${position.col},${position.row}`;
      let attempts = 0;
      while (attempts < cellCount && used.has(key)) {
        position = idxToPos(sequence++);
        key = `${position.col},${position.row}`;
        attempts += 1;
      }
      posByChild.set(childId, position);
      used.add(key);
    }

    let cellNaturalSizes = childIds.map((childId) => sizeChild(childId, cellW, cellH, {
      siblingMaxW: 0,
      siblingMaxH: 0,
    }));
    const hasCellPeerExpressions = childIds.some((childId) => {
      const childProps = effectivePropsForNodeId(childId);
      return [childProps.size, childProps.min_size, childProps.max_size]
        .flat(2)
        .some((value) => typeof value === 'string' && /%sm(?:\b|\s|[+\-])/u.test(value.toLowerCase()));
    });
    let evaluationWork = 0;
    let evaluationBudgetHit = false;
    const evaluatePeerSizes = (basisSizes) => {
      const peerSizes = computePeerMaxSizes(basisSizes);
      return childIds.map((childId, index) => {
        evaluationWork += 1;
        if (evaluationWork > 65_536) {
          evaluationBudgetHit = true;
          return { ...(basisSizes[index] || { w: 0, h: 0 }) };
        }
        return sizeChild(childId, cellW, cellH, {
          siblingMaxW: peerSizes[index]?.w || 0,
          siblingMaxH: peerSizes[index]?.h || 0,
        });
      });
    };
    if (hasCellPeerExpressions) {
      const history = [];
      let converged = false;
      const buildCandidate = (stride) => {
        if (history.length < stride * 2 + 1) return null;
        const last = history.length - 1;
        const samples = [history[last - stride * 2], history[last - stride], history[last]];
        let accelerated = false;
        const candidate = samples[2].map((latest, index) => {
          const output = { ...latest };
          for (const axis of ['w', 'h']) {
            const x0 = Number(samples[0][index]?.[axis]);
            const x1 = Number(samples[1][index]?.[axis]);
            const x2 = Number(latest?.[axis]);
            const denominator = x2 - 2 * x1 + x0;
            const deltaScale = Math.max(Number.MIN_VALUE, Math.abs(x1 - x0), Math.abs(x2 - x1));
            if (![x0, x1, x2, denominator].every(Number.isFinite)
              || Math.abs(denominator) <= deltaScale * 1e-12) continue;
            const estimate = x0 - ((x1 - x0) * (x1 - x0)) / denominator;
            if (!Number.isFinite(estimate) || estimate < 0 || estimate > MAX_LAYOUT_EXTENT) continue;
            output[axis] = estimate;
            if (Math.abs(estimate - x2) > 1e-9) accelerated = true;
          }
          return output;
        });
        return accelerated ? candidate : null;
      };
      const verifyCandidate = (candidate) => {
        if (!candidate) return null;
        const projected = evaluatePeerSizes(candidate);
        if (evaluationBudgetHit) return null;
        const verified = evaluatePeerSizes(projected);
        if (evaluationBudgetHit) return null;
        let residual = 0;
        let scale = 1;
        for (let index = 0; index < verified.length; index += 1) {
          for (const axis of ['w', 'h']) {
            residual = Math.max(residual, Math.abs(verified[index][axis] - projected[index][axis]));
            scale = Math.max(scale, Math.abs(verified[index][axis]), Math.abs(projected[index][axis]));
          }
        }
        return residual <= Math.max(1e-7, scale * 1e-10) ? verified : null;
      };
      const tryDamping = (before, after, baselineDelta) => {
        if (!Number.isFinite(baselineDelta) || baselineDelta <= 1e-7) return null;
        for (const weight of [0.5, 0.25, 0.125, 0.0625]) {
          const candidate = after.map((currentValue, index) => ({
            w: (Number(before[index]?.w) || 0)
              + weight * ((Number(currentValue?.w) || 0) - (Number(before[index]?.w) || 0)),
            h: (Number(before[index]?.h) || 0)
              + weight * ((Number(currentValue?.h) || 0) - (Number(before[index]?.h) || 0)),
          }));
          const projected = evaluatePeerSizes(candidate);
          if (evaluationBudgetHit) return null;
          let residual = 0;
          for (let index = 0; index < projected.length; index += 1) {
            residual = Math.max(
              residual,
              Math.abs((Number(projected[index]?.w) || 0) - (Number(candidate[index]?.w) || 0)),
              Math.abs((Number(projected[index]?.h) || 0) - (Number(candidate[index]?.h) || 0)),
            );
          }
          if (Number.isFinite(residual) && residual < baselineDelta * (1 - 1e-9)) return { candidate, residual };
        }
        return null;
      };
      let priorDelta = Number.POSITIVE_INFINITY;
      const maxPasses = Math.max(8, Math.min(128, Math.floor(65_536 / Math.max(1, childIds.length))));
      for (let pass = 0; pass < maxPasses; pass += 1) {
        const before = cellNaturalSizes.map((size) => ({ ...size }));
        const next = evaluatePeerSizes(cellNaturalSizes);
        if (evaluationBudgetHit) break;
        let delta = 0;
        for (let index = 0; index < next.length; index += 1) {
          delta = Math.max(
            delta,
            Math.abs(next[index].w - (cellNaturalSizes[index]?.w || 0)),
            Math.abs(next[index].h - (cellNaturalSizes[index]?.h || 0)),
          );
        }
        cellNaturalSizes = next;
        history.push(next.map((size) => ({ ...size })));
        if (history.length > 5) history.shift();
        let verified = history.length >= 3 ? verifyCandidate(buildCandidate(1)) : null;
        if (!verified && history.length >= 5) verified = verifyCandidate(buildCandidate(2));
        if (verified) {
          cellNaturalSizes = verified;
          converged = true;
          break;
        }
        if (!verified && history.length >= 3) {
          const damped = tryDamping(before, next, delta);
          if (damped) {
            cellNaturalSizes = damped.candidate;
            history.length = 0;
            history.push(cellNaturalSizes.map((size) => ({ ...size })));
            priorDelta = damped.residual;
            continue;
          }
        }
        if (delta === 0 && priorDelta === 0) {
          converged = true;
          break;
        }
        priorDelta = delta;
      }
      if (!converged) {
        warn(`GRID_CELL_SIBLING_FIXED_POINT_LIMIT:${gridId}`);
        const projected = evaluationBudgetHit ? null : evaluatePeerSizes(cellNaturalSizes);
        let unstableW = evaluationBudgetHit || !projected;
        let unstableH = evaluationBudgetHit || !projected;
        if (projected && !evaluationBudgetHit) {
          let residualW = 0;
          let residualH = 0;
          let scaleW = 1;
          let scaleH = 1;
          for (let index = 0; index < projected.length; index += 1) {
            residualW = Math.max(residualW, Math.abs((Number(projected[index]?.w) || 0) - (Number(cellNaturalSizes[index]?.w) || 0)));
            residualH = Math.max(residualH, Math.abs((Number(projected[index]?.h) || 0) - (Number(cellNaturalSizes[index]?.h) || 0)));
            scaleW = Math.max(scaleW, Math.abs(Number(projected[index]?.w) || 0), Math.abs(Number(cellNaturalSizes[index]?.w) || 0));
            scaleH = Math.max(scaleH, Math.abs(Number(projected[index]?.h) || 0), Math.abs(Number(cellNaturalSizes[index]?.h) || 0));
          }
          unstableW = residualW > Math.max(1e-7, scaleW * 1e-10);
          unstableH = residualH > Math.max(1e-7, scaleH * 1e-10);
        }
        const lastPeerSizes = computePeerMaxSizes(cellNaturalSizes);
        cellNaturalSizes = childIds.map((childId, index) => sizeChild(childId, cellW, cellH, {
          siblingMaxW: unstableW ? 0 : lastPeerSizes[index]?.w || 0,
          siblingMaxH: unstableH ? 0 : lastPeerSizes[index]?.h || 0,
        }));
      }
    }

    const cellPeerSizes = computePeerMaxSizes(cellNaturalSizes);
    const resolvedCellSizes = childIds.map((childId, index) => {
      const childProps = effectivePropsForNodeId(childId);
      const natural = cellNaturalSizes[index] || { w: 0, h: 0 };
      return {
        w: isBooleanLikeEnabled(childProps, 'inherit_max_sibling_width')
          ? Math.max(natural.w, cellPeerSizes[index]?.w || 0)
          : natural.w,
        h: isBooleanLikeEnabled(childProps, 'inherit_max_sibling_height')
          ? Math.max(natural.h, cellPeerSizes[index]?.h || 0)
          : natural.h,
      };
    });
    const contentMaxW = resolvedCellSizes.reduce((max, size) => Math.max(max, Number(size.w) || 0), 0);
    const contentMaxH = resolvedCellSizes.reduce((max, size) => Math.max(max, Number(size.h) || 0), 0);
    let contentW = trackContentW;
    let contentH = trackContentH;
    if (childIds.length > 0 && isBooleanLikeEnabled(gridProps, 'use_child_anchors')) {
      const rootX = Number(gridBox && gridBox.x) || 0;
      const rootY = Number(gridBox && gridBox.y) || 0;
      let minX = rootX;
      let minY = rootY;
      let maxX = rootX;
      let maxY = rootY;
      childIds.forEach((childId, index) => {
        const childNode = nodesById && nodesById[childId];
        const position = posByChild.get(childId);
        if (!childNode || !position) return;
        const size = resolvedCellSizes[index] || { w: 0, h: 0 };
        const childBox = computeNodeBox(
          overrideProps(childNode, effectivePropsForNodeId(childId)),
          {
            x: originX + position.col * (cellW + gapX),
            y: originY + position.row * (cellH + gapY),
            w: cellW,
            h: cellH,
          },
          0,
          gridId,
          {
            ...contextForChild(childId),
            resolvedSize: size,
            siblingMaxW: cellPeerSizes[index]?.w || 0,
            siblingMaxH: cellPeerSizes[index]?.h || 0,
          },
        );
        minX = Math.min(minX, childBox.x);
        minY = Math.min(minY, childBox.y);
        maxX = Math.max(maxX, childBox.x + childBox.w);
        maxY = Math.max(maxY, childBox.y + childBox.h);
      });
      contentW = Math.max(0, maxX - minX);
      contentH = Math.max(0, maxY - minY);
    }

    return {
      childIds,
      cols,
      rows,
      gapX,
      gapY,
      cellW,
      cellH,
      localOriginX,
      localOriginY,
      posByChild,
      cellPeerSizes,
      resolvedCellSizes,
      childRootSizing: childIds.map(percentSizingForChild),
      contentW,
      contentH,
      contentMaxW,
      contentMaxH,
      hasMeasuredChildren: childIds.length > 0,
      diagnostics,
      positionIssues,
    };
  }

  function makeAllocatedFallbackContexts(ids, includeUndiscovered = false) {
    const fallback = Object.create(null);
    for (const id of ids) fallback[id] = { ...zeroAllocatedContext };
    if (includeUndiscovered) fallback[allocatedFallbackContextKey] = zeroAllocatedContext;
    return fallback;
  }

  function measureAllocatedSubtreeContexts(nodeId, allocatedSize, siblingMax, defaultSizing = {}) {
    const rootNode = nodesById && nodesById[nodeId];
    if (!rootNode || !Array.isArray(rootNode.children) || rootNode.children.length === 0) return null;

    // An ordinary fixed-size grid item (e.g. the 18x18 Vanilla inventory
    // slot) is commonly allocated exactly the extent already measured by the
    // global fixed point. Its descendants see that same parent rectangle.
    // Re-solving and snapshotting its complete subtree would add work for
    // every slot without changing any constraint. Stack/grid roots still need
    // allocation-specific refinement, as do unsettled or changed contexts.
    const priorSize = measuredSizeById[nodeId];
    const priorContext = sizingContextById[nodeId];
    const rootType = String(rootNode.type || '').toLowerCase();
    const rootSize = readVec2(effectivePropsForNodeId(nodeId).size);
    const absoluteRootSize = rootSize && toFiniteNumber(rootSize.x) !== null && toFiniteNumber(rootSize.y) !== null;
    if (contentMeasurementConverged && !measurementBudgetReported && nodeCountWithinDiscoveryBudget
      && absoluteRootSize
      && rootType !== 'stack_panel' && rootType !== 'grid'
      && priorSize && priorContext
      && priorSize.w === Number(allocatedSize?.w)
      && priorSize.h === Number(allocatedSize?.h)
      && (Number(priorContext.siblingMaxW) || 0) === (Number(siblingMax?.w) || 0)
      && (Number(priorContext.siblingMaxH) || 0) === (Number(siblingMax?.h) || 0)) {
      allocatedSubtreeReuseCount += 1;
      return null;
    }

    const subtreeIds = [];
    const pending = [{ id: String(nodeId), depth: 0 }];
    const seen = new Set();
    let discoveryLimited = false;
    let discoveryWork = 0;
    const maxDiscoveryWork = Math.max(10_000, Math.min(200_000, Math.floor(maxBoxes) * 20));
    const discoveredChildrenById = new Map();
    const discoverableChildren = (parentId) => {
      const cacheKey = String(parentId);
      if (discoveredChildrenById.has(cacheKey)) return discoveredChildrenById.get(cacheKey);
      const finish = (ids) => {
        const result = Array.isArray(ids) ? ids : [];
        discoveredChildrenById.set(cacheKey, result);
        return result;
      };
      const parent = nodesById && nodesById[parentId];
      const rawIds = Array.isArray(parent && parent.children) ? parent.children.map(String) : [];
      discoveryWork += rawIds.length;
      if (discoveryWork > maxDiscoveryWork) {
        discoveryLimited = true;
        return finish([]);
      }
      const visibleIds = rawIds.filter((childId) => {
        const child = nodesById && nodesById[childId];
        if (!child || isRuntimeOnlyPreviewNode(child, visibilityMode)) return false;
        const childProps = effectivePropsForNodeId(childId);
        return typeof isVisibleFromProps !== 'function'
          || isVisibleFromProps(childProps, { mode: visibilityMode });
      });
      let selectedIds = selectSafeStateChildren(parent, effectivePropsForNodeId(parentId), visibleIds);
      if (String(parent && parent.type || '').toLowerCase() !== 'grid') return finish(selectedIds);

      const parentProps = effectivePropsForNodeId(parentId);
      let dimensions = readVec2(parentProps.grid_dimensions);
      let columns = dimensions ? toFiniteNumber(dimensions.x) : null;
      let rows = dimensions ? toFiniteNumber(dimensions.y) : null;
      let dimensionsValid = columns !== null && rows !== null && columns > 0 && rows > 0;
      const bindingName = typeof parentProps.grid_dimension_binding === 'string'
        ? parentProps.grid_dimension_binding.trim()
        : '';
      if (!dimensionsValid && bindingName) {
        const bareName = bindingName.replace(/^[#$]/u, '');
        const boundValue = Object.prototype.hasOwnProperty.call(parentProps, bindingName)
          ? parentProps[bindingName]
          : Object.prototype.hasOwnProperty.call(parentProps, bareName)
            ? parentProps[bareName]
            : undefined;
        dimensions = readVec2(boundValue);
        columns = dimensions ? toFiniteNumber(dimensions.x) : null;
        rows = dimensions ? toFiniteNumber(dimensions.y) : null;
        dimensionsValid = columns !== null && rows !== null && columns > 0 && rows > 0;
        if (!dimensionsValid) return finish([]);
      }
      const maxItemsRaw = toFiniteNumber(parentProps.maximum_grid_items);
      const maxItems = maxItemsRaw === null ? 2048 : Math.max(0, Math.min(2048, Math.floor(maxItemsRaw)));
      selectedIds = selectedIds.slice(0, maxItems);
      if (!dimensionsValid) {
        return finish(selectedIds.filter((childId) => {
          const result = readExplicitGridPosition(childId);
          if (result.status === 'missing' || result.status === 'valid') return true;
          reportGridPositionIssue(childId, result.status);
          return false;
        }));
      }
      const boundedColumns = Math.max(1, Math.min(2048, Math.floor(columns)));
      const boundedRows = Math.max(1, Math.min(2048, Math.floor(rows)));
      return finish(selectedIds.filter((childId) => {
        const result = readExplicitGridPosition(childId, boundedColumns, boundedRows);
        if (result.status === 'missing' || result.status === 'valid') return true;
        reportGridPositionIssue(childId, result.status);
        return false;
      }));
    };
    while (pending.length > 0) {
      const entry = pending.pop();
      if (!entry || seen.has(entry.id)) continue;
      if (entry.depth > maxLayoutDepth || subtreeIds.length >= maxBoxes) {
        discoveryLimited = true;
        break;
      }
      seen.add(entry.id);
      subtreeIds.push(entry.id);
      for (const childId of discoverableChildren(entry.id)) {
        pending.push({ id: childId, depth: entry.depth + 1 });
      }
      if (discoveryLimited) break;
    }

    if (discoveryLimited || pending.length > 0) {
      const warningKey = `discovery:${String(nodeId)}`;
      if (!allocatedContextWarnings.has(warningKey)) {
        allocatedContextWarnings.add(warningKey);
        warnings.push(`ALLOCATED_SUBTREE_DISCOVERY_LIMIT:${String(nodeId)}`);
      }
      return makeAllocatedFallbackContexts(subtreeIds, true);
    }

    if (measurementBudgetReported) {
      ensureMeasurementBudgetWarning();
      return makeAllocatedFallbackContexts(subtreeIds);
    }

    const savedMeasured = new Map(subtreeIds.map((id) => [id, measuredSizeById[id] ? { ...measuredSizeById[id] } : null]));
    const savedNatural = new Map(subtreeIds.map((id) => [id, naturalSizeById[id] ? { ...naturalSizeById[id] } : null]));
    const savedContexts = new Map(subtreeIds.map((id) => [id, sizingContextById[id] ? { ...sizingContextById[id] } : null]));
    const savedWarningsLength = warnings.length;
    const savedReportedLimits = [...reportedSizeLimits];
    const budgetWasReported = measurementBudgetReported;
    const restoreSubtree = () => {
      for (const id of subtreeIds) {
        const measured = savedMeasured.get(id);
        const natural = savedNatural.get(id);
        const context = savedContexts.get(id);
        if (measured) measuredSizeById[id] = measured;
        else delete measuredSizeById[id];
        if (natural) naturalSizeById[id] = natural;
        else delete naturalSizeById[id];
        if (context) sizingContextById[id] = context;
        else delete sizingContextById[id];
      }
      warnings.length = savedWarningsLength;
      reportedSizeLimits.clear();
      for (const key of savedReportedLimits) reportedSizeLimits.add(key);
      recursiveSizeLimitsThisPass.clear();
    };

    const snapshotLocalState = () => ({
      measured: Object.fromEntries(subtreeIds.map((id) => [id, measuredSizeById[id]
        ? { ...measuredSizeById[id] }
        : { w: 0, h: 0 }])),
      natural: Object.fromEntries(subtreeIds.map((id) => [id, naturalSizeById[id]
        ? { ...naturalSizeById[id] }
        : { w: 0, h: 0 }])),
    });
    const installLocalState = (state) => {
      for (const id of subtreeIds) {
        measuredSizeById[id] = { ...(state.measured[id] || { w: 0, h: 0 }) };
        naturalSizeById[id] = { ...(state.natural[id] || { w: 0, h: 0 }) };
      }
    };
    const localStateDelta = (first, second) => {
      let delta = 0;
      let scale = 1;
      for (const mapName of ['measured', 'natural']) {
        for (const id of subtreeIds) {
          const left = first[mapName][id] || { w: 0, h: 0 };
          const right = second[mapName][id] || { w: 0, h: 0 };
          for (const axis of ['w', 'h']) {
            const leftValue = Number(left[axis]) || 0;
            const rightValue = Number(right[axis]) || 0;
            delta = Math.max(delta, Math.abs(leftValue - rightValue));
            scale = Math.max(scale, Math.abs(leftValue), Math.abs(rightValue));
          }
        }
      }
      return { delta, scale };
    };

    for (const id of subtreeIds) {
      delete measuredSizeById[id];
      delete naturalSizeById[id];
      delete sizingContextById[id];
    }

    const forcedSize = {
      w: Math.max(0, Math.min(MAX_LAYOUT_EXTENT, Number(allocatedSize && allocatedSize.w) || 0)),
      h: Math.max(0, Math.min(MAX_LAYOUT_EXTENT, Number(allocatedSize && allocatedSize.h) || 0)),
    };
    // The caller has already allocated this subtree root (stack fill, sibling
    // inheritance, or a grid cell). `measureNode` still has to traverse it to
    // refresh descendant contexts, but the root's authored natural size is not
    // a variable of this local fixed point. Re-pin both maps after every local
    // traversal so forced != authored cannot create an artificial residual.
    const repinAllocatedRootSize = () => {
      measuredSizeById[nodeId] = { ...forcedSize };
      naturalSizeById[nodeId] = { ...forcedSize };
    };
    let stableFrames = 0;
    let converged = false;
    let lastLocalBefore = null;
    let lastLocalAfter = null;
    const recentLocalChangedAxisMaps = [];
    const localHistory = [];
    const buildLocalAitkenCandidate = () => {
      if (localHistory.length < 3) return null;
      const samples = localHistory.slice(-3);
      const candidate = { measured: Object.create(null), natural: Object.create(null) };
      let accelerated = false;
      for (const id of subtreeIds) {
        const latest = samples[2].natural[id] || { w: 0, h: 0 };
        const output = { ...latest };
        for (const axis of ['w', 'h']) {
          const x0 = Number(samples[0].natural[id]?.[axis]);
          const x1 = Number(samples[1].natural[id]?.[axis]);
          const x2 = Number(latest[axis]);
          const denominator = x2 - 2 * x1 + x0;
          const deltaScale = Math.max(Number.MIN_VALUE, Math.abs(x1 - x0), Math.abs(x2 - x1));
          if (![x0, x1, x2, denominator].every(Number.isFinite)
            || Math.abs(denominator) <= deltaScale * 1e-12) continue;
          const estimate = x0 - ((x1 - x0) * (x1 - x0)) / denominator;
          if (!Number.isFinite(estimate) || estimate < 0 || estimate > MAX_LAYOUT_EXTENT) continue;
          output[axis] = estimate;
          if (Math.abs(estimate - x2) > 1e-9) accelerated = true;
        }
        candidate.natural[id] = output;
      }
      if (!accelerated) return null;
      candidate.natural[nodeId] = { ...forcedSize };
      candidate.measured = deriveMeasuredMap(candidate.natural, [nodeId]);
      candidate.measured[nodeId] = { ...forcedSize };
      return candidate;
    };
    const verifyLocalCandidate = (candidate) => {
      if (!candidate) return 'unavailable';
      const savedState = snapshotLocalState();
      const savedLocalContexts = new Map(subtreeIds.map((id) => [id, sizingContextById[id]
        ? { ...sizingContextById[id] }
        : null]));
      const savedLocalWarningsLength = warnings.length;
      const savedLocalLimits = [...reportedSizeLimits];
      const restoreCandidateState = () => {
        installLocalState(savedState);
        for (const id of subtreeIds) {
          const context = savedLocalContexts.get(id);
          if (context) sizingContextById[id] = context;
          else delete sizingContextById[id];
        }
        warnings.length = savedLocalWarningsLength;
        reportedSizeLimits.clear();
        for (const key of savedLocalLimits) reportedSizeLimits.add(key);
        recursiveSizeLimitsThisPass.clear();
      };

      installLocalState(candidate);
      let priorState = snapshotLocalState();
      let verifiedFrames = 0;
      const verificationPasses = Math.max(4, Math.min(32, subtreeIds.length + 4));
      for (let pass = 0; pass < verificationPasses; pass += 1) {
        repinAllocatedRootSize();
        recursiveSizeLimitsThisPass.clear();
        measureNode(
          nodeId,
          forcedSize,
          { w: Number(siblingMax && siblingMax.w) || 0, h: Number(siblingMax && siblingMax.h) || 0 },
          defaultSizing,
        );
        repinAllocatedRootSize();
        if (measurementBudgetReported) {
          restoreCandidateState();
          ensureMeasurementBudgetWarning();
          return 'budget';
        }
        if (recursiveSizeLimitsThisPass.size > 0) {
          restoreCandidateState();
          return 'rejected';
        }
        const nextState = snapshotLocalState();
        const { delta, scale } = localStateDelta(priorState, nextState);
        verifiedFrames = delta <= Math.max(1e-7, scale * 1e-10) ? verifiedFrames + 1 : 0;
        if (verifiedFrames >= 2) return 'accepted';
        priorState = nextState;
      }
      restoreCandidateState();
      return 'rejected';
    };

    const tryLocalSafeguardedDamping = (beforeState, currentState) => {
      const baseline = localStateDelta(beforeState, currentState).delta;
      if (!Number.isFinite(baseline) || baseline <= 1e-7) return { status: 'unavailable' };
      const savedState = snapshotLocalState();
      const savedLocalContexts = new Map(subtreeIds.map((id) => [id, sizingContextById[id]
        ? { ...sizingContextById[id] }
        : null]));
      const savedLocalWarningsLength = warnings.length;
      const savedLocalLimits = [...reportedSizeLimits];
      const restoreCandidateState = () => {
        installLocalState(savedState);
        for (const id of subtreeIds) {
          const context = savedLocalContexts.get(id);
          if (context) sizingContextById[id] = context;
          else delete sizingContextById[id];
        }
        warnings.length = savedLocalWarningsLength;
        reportedSizeLimits.clear();
        for (const key of savedLocalLimits) reportedSizeLimits.add(key);
        recursiveSizeLimitsThisPass.clear();
      };

      for (const weight of [0.5, 0.25, 0.125, 0.0625]) {
        restoreCandidateState();
        const candidateNatural = Object.create(null);
        for (const id of subtreeIds) {
          const previous = beforeState.natural[id] || { w: 0, h: 0 };
          const currentValue = currentState.natural[id] || { w: 0, h: 0 };
          candidateNatural[id] = {
            w: (Number(previous.w) || 0)
              + weight * ((Number(currentValue.w) || 0) - (Number(previous.w) || 0)),
            h: (Number(previous.h) || 0)
              + weight * ((Number(currentValue.h) || 0) - (Number(previous.h) || 0)),
          };
        }
        candidateNatural[nodeId] = { ...forcedSize };
        const candidate = {
          natural: candidateNatural,
          measured: deriveMeasuredMap(candidateNatural, [nodeId]),
        };
        candidate.measured[nodeId] = { ...forcedSize };
        installLocalState(candidate);
        recursiveSizeLimitsThisPass.clear();
        measureNode(
          nodeId,
          forcedSize,
          { w: Number(siblingMax && siblingMax.w) || 0, h: Number(siblingMax && siblingMax.h) || 0 },
          defaultSizing,
        );
        repinAllocatedRootSize();
        if (measurementBudgetReported) {
          restoreCandidateState();
          ensureMeasurementBudgetWarning();
          return { status: 'budget' };
        }
        const evaluated = snapshotLocalState();
        const residual = localStateDelta(candidate, evaluated).delta;
        if (recursiveSizeLimitsThisPass.size === 0
          && Number.isFinite(residual)
          && residual < baseline * (1 - 1e-9)) {
          installLocalState(candidate);
          for (const id of subtreeIds) {
            const context = savedLocalContexts.get(id);
            if (context) sizingContextById[id] = context;
            else delete sizingContextById[id];
          }
          warnings.length = savedLocalWarningsLength;
          reportedSizeLimits.clear();
          for (const key of savedLocalLimits) reportedSizeLimits.add(key);
          recursiveSizeLimitsThisPass.clear();
          return { status: 'accepted', residual };
        }
      }
      restoreCandidateState();
      return { status: 'rejected' };
    };

    const maxPasses = Math.max(4, Math.min(128, Math.floor(65_536 / Math.max(1, subtreeIds.length))));
    for (let pass = 0; pass < maxPasses; pass += 1) {
      repinAllocatedRootSize();
      const before = snapshotLocalState();
      recursiveSizeLimitsThisPass.clear();
      measureNode(
        nodeId,
        forcedSize,
        { w: Number(siblingMax && siblingMax.w) || 0, h: Number(siblingMax && siblingMax.h) || 0 },
        defaultSizing,
      );
      repinAllocatedRootSize();
      if (measurementBudgetReported) break;
      const after = snapshotLocalState();
      lastLocalBefore = before;
      lastLocalAfter = after;
      const { delta } = localStateDelta(before, after);
      const changedAxes = new Map();
      for (const id of subtreeIds) {
        const beforeMeasured = before.measured[id] || { w: 0, h: 0 };
        const afterMeasured = after.measured[id] || { w: 0, h: 0 };
        const beforeNatural = before.natural[id] || { w: 0, h: 0 };
        const afterNatural = after.natural[id] || { w: 0, h: 0 };
        const axisChanged = (axis) => {
          const first = Math.max(
            Math.abs((Number(afterMeasured[axis]) || 0) - (Number(beforeMeasured[axis]) || 0)),
            Math.abs((Number(afterNatural[axis]) || 0) - (Number(beforeNatural[axis]) || 0)),
          );
          const scale = Math.max(
            1,
            Math.abs(Number(afterMeasured[axis]) || 0),
            Math.abs(Number(beforeMeasured[axis]) || 0),
            Math.abs(Number(afterNatural[axis]) || 0),
            Math.abs(Number(beforeNatural[axis]) || 0),
          );
          return first > Math.max(1e-7, scale * 1e-10);
        };
        const axes = { w: axisChanged('w'), h: axisChanged('h') };
        if (axes.w || axes.h) changedAxes.set(id, axes);
      }
      // The first allocated frame starts from an intentionally empty state and
      // therefore says nothing about stability. Later frames are trustworthy.
      if (pass > 0) {
        recentLocalChangedAxisMaps.push(changedAxes);
        if (recentLocalChangedAxisMaps.length > 8) recentLocalChangedAxisMaps.shift();
      }
      localHistory.push(after);
      if (localHistory.length > 3) localHistory.shift();
      stableFrames = delta === 0 ? stableFrames + 1 : 0;
      if (recursiveSizeLimitsThisPass.size > 0) {
        // Keep measuring long enough to distinguish unrelated stable axes from
        // simultaneous cycles, but never accept a state with a direct failure.
        if (stableFrames >= 2) break;
        continue;
      }
      if (stableFrames >= 2) {
        converged = true;
        break;
      }
      if (localHistory.length >= 3) {
        const acceleration = verifyLocalCandidate(buildLocalAitkenCandidate());
        if (acceleration === 'accepted') {
          converged = true;
          break;
        }
        if (acceleration === 'budget') break;
        const damped = tryLocalSafeguardedDamping(before, after);
        if (damped.status === 'budget') break;
        if (damped.status === 'accepted') {
          stableFrames = 0;
          localHistory.length = 0;
          localHistory.push(snapshotLocalState());
          continue;
        }
      }
    }

    const refineAllocatedRootContext = (contexts) => {
      if (!contexts || !rootNode) return;
      const rootType = String(rootNode.type || '').trim().toLowerCase();
      if (rootType !== 'stack_panel' && rootType !== 'grid') return;
      const rootProps = effectivePropsForNodeId(nodeId);
      const childIds = discoverableChildren(nodeId);
      const childSize = (childId, parentSize, extraSizing = {}) => {
        const childNode = nodesById && nodesById[childId];
        if (!childNode) return { w: 0, h: 0 };
        return computeSize(
          effectivePropsForNodeId(childId),
          parentSize.w,
          parentSize.h,
          String(childNode.type || 'unknown'),
          {
            ...(contexts[childId] || {}),
            ...(shouldFillParentWhenSizeOmitted(childNode) ? { fillParentWhenDefault: true } : {}),
            ...extraSizing,
            hasChildControls: Array.isArray(childNode.children) && childNode.children.length > 0,
          },
        );
      };
      const baseContext = {
        ...(contexts[nodeId] || {}),
        siblingMaxW: Number(siblingMax && siblingMax.w) || 0,
        siblingMaxH: Number(siblingMax && siblingMax.h) || 0,
      };

      if (rootType === 'stack_panel') {
        const horizontal = String(rootProps.orientation || 'vertical').trim().toLowerCase() === 'horizontal';
        const baseMeasurements = childIds.map((childId) => {
          const childNode = nodesById[childId];
          const childProps = effectivePropsForNodeId(childId);
          const size = childSize(childId, forcedSize, shouldFillParentWhenSizeOmitted(childNode)
            ? horizontal
              ? { fillParentWhenDefault: false, fillParentHeightWhenDefault: true }
              : { fillParentWhenDefault: false, fillParentWidthWhenDefault: true }
            : {});
          const rawSize = readVec2(childProps.size);
          const rawMain = rawSize ? (horizontal ? rawSize.x : rawSize.y) : null;
          return {
            childId,
            childProps,
            natural: size,
            fills: typeof rawMain === 'string' && rawMain.trim().toLowerCase() === 'fill',
          };
        });
        const basePeerSizes = computePeerMaxSizes(baseMeasurements.map((entry) => entry.natural));
        const measured = baseMeasurements.map((entry, index) => ({
          ...entry,
          size: {
            w: isBooleanLikeEnabled(entry.childProps, 'inherit_max_sibling_width')
              ? Math.max(entry.natural.w, basePeerSizes[index]?.w || 0)
              : entry.natural.w,
            h: isBooleanLikeEnabled(entry.childProps, 'inherit_max_sibling_height')
              ? Math.max(entry.natural.h, basePeerSizes[index]?.h || 0)
              : entry.natural.h,
          },
        }));
        const availableMain = horizontal ? forcedSize.w : forcedSize.h;
        const fixedMain = measured.reduce((sum, entry) => sum + (entry.fills
          ? 0
          : horizontal ? entry.size.w : entry.size.h), 0);
        const fillCount = measured.filter((entry) => entry.fills).length;
        const fillMain = fillCount > 0 ? Math.max(0, availableMain - fixedMain) / fillCount : 0;
        const allocatedNatural = measured.map((entry) => ({
          w: horizontal && entry.fills ? fillMain : entry.natural.w,
          h: !horizontal && entry.fills ? fillMain : entry.natural.h,
        }));
        const allocatedPeers = computePeerMaxSizes(allocatedNatural);
        const resolvedSizes = measured.map((entry, index) => ({
          w: horizontal
            ? entry.fills ? fillMain : entry.size.w
            : isBooleanLikeEnabled(entry.childProps, 'inherit_max_sibling_width')
              ? Math.max(entry.natural.w, allocatedPeers[index]?.w || 0)
              : entry.natural.w,
          h: !horizontal
            ? entry.fills ? fillMain : entry.size.h
            : isBooleanLikeEnabled(entry.childProps, 'inherit_max_sibling_height')
              ? Math.max(entry.natural.h, allocatedPeers[index]?.h || 0)
              : entry.natural.h,
        }));
        let contentW = horizontal
          ? resolvedSizes.reduce((sum, size) => sum + size.w, 0)
          : resolvedSizes.reduce((max, size) => Math.max(max, size.w), 0);
        let contentH = horizontal
          ? resolvedSizes.reduce((max, size) => Math.max(max, size.h), 0)
          : resolvedSizes.reduce((sum, size) => sum + size.h, 0);
        const contentMaxW = resolvedSizes.reduce((max, size) => Math.max(max, size.w), 0);
        const contentMaxH = resolvedSizes.reduce((max, size) => Math.max(max, size.h), 0);

        if (isBooleanLikeEnabled(rootProps, 'use_child_anchors') && childIds.length > 0) {
          let cursor = 0;
          let minX = 0;
          let minY = 0;
          let maxX = 0;
          let maxY = 0;
          childIds.forEach((childId, index) => {
            const childNode = nodesById[childId];
            const size = resolvedSizes[index] || { w: 0, h: 0 };
            const parent = horizontal
              ? { x: cursor, y: 0, w: size.w, h: forcedSize.h }
              : { x: 0, y: cursor, w: forcedSize.w, h: size.h };
            const box = computeNodeBox(
              overrideProps(childNode, effectivePropsForNodeId(childId)),
              parent,
              0,
              nodeId,
              {
                ...(contexts[childId] || {}),
                resolvedSize: size,
                siblingMaxW: allocatedPeers[index]?.w || 0,
                siblingMaxH: allocatedPeers[index]?.h || 0,
              },
            );
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.w);
            maxY = Math.max(maxY, box.y + box.h);
            cursor += horizontal ? size.w : size.h;
          });
          contentW = Math.max(0, maxX - minX);
          contentH = Math.max(0, maxY - minY);
        }
        contexts[nodeId] = {
          ...baseContext,
          contentW,
          contentH,
          contentMaxW,
          contentMaxH,
          hasMeasuredChildren: childIds.length > 0,
        };
        return;
      }

      const gridCandidates = selectSafeStateChildren(
        rootNode,
        rootProps,
        Array.isArray(rootNode.children) ? rootNode.children.map(String) : [],
      );
      const allocation = computeGridAllocation(
        rootNode,
        rootProps,
        { x: 0, y: 0, w: forcedSize.w, h: forcedSize.h },
        gridCandidates,
        contexts,
        { emitWarnings: false },
      );
      contexts[nodeId] = {
        ...baseContext,
        contentW: allocation.contentW,
        contentH: allocation.contentH,
        contentMaxW: allocation.contentMaxW,
        contentMaxH: allocation.contentMaxH,
        hasMeasuredChildren: allocation.hasMeasuredChildren,
      };
      contexts[allocatedGridPlanKey] = {
        nodeId: String(nodeId),
        w: forcedSize.w,
        h: forcedSize.h,
        allocation,
      };
    };

    const makeAxisLocalFallbackContexts = () => {
      const unstableAxesById = new Map();
      const unstableOffsetAxesById = new Map();
      const resetFieldsById = new Map();
      const queue = [];
      const addResetFields = (id, fields) => {
        if (!id || !Array.isArray(fields) || fields.length === 0) return;
        const key = String(id);
        const prior = resetFieldsById.get(key) || new Set();
        for (const field of fields) prior.add(field);
        resetFieldsById.set(key, prior);
      };
      const addUnstableAxes = (id, axes) => {
        const key = String(id);
        const prior = unstableAxesById.get(key) || { w: false, h: false };
        const added = { w: Boolean(axes?.w) && !prior.w, h: Boolean(axes?.h) && !prior.h };
        if (!added.w && !added.h) return;
        unstableAxesById.set(key, { w: prior.w || added.w, h: prior.h || added.h });
        queue.push({ kind: 'size', id: key, axes: added });
      };
      const addUnstableOffsetAxes = (id, axes) => {
        if (!id) return;
        const key = String(id);
        const prior = unstableOffsetAxesById.get(key) || { w: false, h: false };
        const added = { w: Boolean(axes?.w) && !prior.w, h: Boolean(axes?.h) && !prior.h };
        if (!added.w && !added.h) return;
        unstableOffsetAxesById.set(key, { w: prior.w || added.w, h: prior.h || added.h });
        queue.push({ kind: 'offset', id: key, axes: added });
      };
      if (measurementBudgetReported) {
        for (const id of subtreeIds) addUnstableAxes(id, { w: true, h: true });
      } else if (recursiveSizeLimitsThisPass.size > 0) {
        // A direct limit pinpoints the bad node/axis. Do not union all early
        // settling frames: an independent axis may need several finite passes
        // before it stabilizes and must remain usable. The final frame is kept
        // as evidence for a genuinely independent cycle that is still moving.
        for (const [id, axes] of recursiveSizeLimitsThisPass) addUnstableAxes(id, axes);
        const finalChangedAxes = recentLocalChangedAxisMaps[recentLocalChangedAxisMaps.length - 1];
        if (finalChangedAxes) {
          for (const [id, axes] of finalChangedAxes) addUnstableAxes(id, axes);
        }
      } else {
        for (const changedMap of recentLocalChangedAxisMaps) {
          for (const [id, axes] of changedMap) addUnstableAxes(id, axes);
        }
      }
      if (unstableAxesById.size === 0 && lastLocalBefore && lastLocalAfter) {
        // No post-settling evidence was available. Reset every axis rather than
        // exposing an arbitrary state.
        for (const id of subtreeIds) addUnstableAxes(id, { w: true, h: true });
      }

      const parentByChildId = new Map();
      for (const parentId of subtreeIds) {
        for (const childId of discoverableChildren(parentId)) {
          if (!parentByChildId.has(childId)) parentByChildId.set(String(childId), String(parentId));
        }
      }
      const axisValues = (id, axis) => {
        const index = axis === 'h' ? 1 : 0;
        const props = effectivePropsForNodeId(id);
        return [props.size, props.min_size, props.max_size]
          .map(readVec2)
          .map((vector) => vector ? (index ? vector.y : vector.x) : null);
      };
      const containsUnit = (value, unit) => typeof value === 'string'
        && new RegExp(`%${unit}(?:\\b|(?=\\s|[+\\-*/)]|$))`, 'u').test(value.toLowerCase());
      const offsetValue = (id, axis) => {
        const offset = readVec2(effectivePropsForNodeId(id).offset);
        return offset ? (axis === 'h' ? offset.y : offset.x) : null;
      };
      const directContentFallbackTypes = new Set([
        'panel', 'input_panel', 'button', 'dropdown', 'toggle', 'grid',
        'scroll_track', 'scrollbar_box', 'unknown',
      ]);
      const defaultContentFieldForAxis = (id, axis) => {
        const node = nodesById && nodesById[id];
        const type = String(node?.type || '').toLowerCase();
        if (type === 'stack_panel') {
          const horizontal = String(effectivePropsForNodeId(id).orientation || 'vertical').toLowerCase() === 'horizontal';
          return horizontal === (axis === 'w') ? 'content' : 'contentMax';
        }
        return directContentFallbackTypes.has(type) ? 'content' : null;
      };
      const sizeReadsContent = (id, axis) => axisValues(id, axis).some((value, index) => {
        if (typeof value !== 'string') return false;
        const token = value.trim().toLowerCase();
        return containsUnit(value, 'c') || containsUnit(value, 'cm')
          || (index === 0 && token === 'default' && defaultContentFieldForAxis(id, axis) !== null);
      });
      const sizeReadsPositionContent = (id, axis) => axisValues(id, axis).some((value, index) => {
        if (typeof value !== 'string') return false;
        const token = value.trim().toLowerCase();
        return containsUnit(value, 'c')
          || (index === 0 && token === 'default' && defaultContentFieldForAxis(id, axis) === 'content');
      });
      const sizeReadsParent = (id, axis) => {
        const node = nodesById && nodesById[id];
        const props = effectivePropsForNodeId(id);
        const values = axisValues(id, axis);
        if (values.some((value) => typeof value === 'string' && /%(?![a-z])/iu.test(value))) return true;
        if (typeof values[0] === 'string' && values[0].trim().toLowerCase() === 'fill') return true;
        const sizeVector = readVec2(props.size);
        const legacyValue = axis === 'h' ? props.h : props.w;
        return !sizeVector && legacyValue === undefined && shouldFillParentWhenSizeOmitted(node);
      };
      const sizeReadsSibling = (id, axis) => {
        const props = effectivePropsForNodeId(id);
        return axisValues(id, axis).some((value) => containsUnit(value, 'sm'))
          || isBooleanLikeEnabled(props, axis === 'w' ? 'inherit_max_sibling_width' : 'inherit_max_sibling_height');
      };
      const offsetReadsParent = (id, axis) => {
        const value = offsetValue(id, axis);
        return typeof value === 'string' && /%(?![a-z])/iu.test(value);
      };
      const contentOffsetFields = (id, axis) => {
        const value = offsetValue(id, axis);
        const suffix = axis === 'h' ? 'H' : 'W';
        return [
          ...(containsUnit(value, 'c') ? [`content${suffix}`] : []),
          ...(containsUnit(value, 'cm') ? [`contentMax${suffix}`] : []),
        ];
      };
      const siblingOffsetFields = (id, axis) => containsUnit(offsetValue(id, axis), 'sm')
        ? [`siblingMax${axis === 'h' ? 'H' : 'W'}`]
        : [];
      const taintOffsetContext = (id, axis, fields) => {
        if (!fields.length) return;
        addResetFields(id, fields);
        addUnstableOffsetAxes(id, { [axis]: true });
      };

      // `%sm` excludes the current control. Index unstable providers per
      // parent/axis so each wide sibling group is scanned at most once (plus a
      // constant correction for the first provider when a second appears).
      const childSetByParentId = new Map();
      const childSetFor = (parentId) => {
        const key = String(parentId);
        if (!childSetByParentId.has(key)) childSetByParentId.set(key, new Set(discoverableChildren(key)));
        return childSetByParentId.get(key);
      };
      const siblingProvidersByGroupAxis = new Map();
      const propagateUnstableSiblingProvider = (parentId, providerId, axis) => {
        const normalizedProviderId = String(providerId);
        if (!childSetFor(parentId).has(normalizedProviderId)) return;
        const groupKey = `${String(parentId)}\u0000${axis}`;
        const providers = siblingProvidersByGroupAxis.get(groupKey) || new Set();
        if (providers.has(normalizedProviderId)) return;
        const priorProvider = providers.size === 1 ? providers.values().next().value : null;
        providers.add(normalizedProviderId);
        siblingProvidersByGroupAxis.set(groupKey, providers);
        const targets = providers.size === 1
          ? discoverableChildren(parentId).filter((siblingId) => String(siblingId) !== normalizedProviderId)
          : providers.size === 2 && priorProvider
            ? [priorProvider]
            : [];
        for (const siblingId of targets) {
          taintOffsetContext(siblingId, axis, siblingOffsetFields(siblingId, axis));
          if (sizeReadsSibling(siblingId, axis)) addUnstableAxes(siblingId, { [axis]: true });
        }
      };

      for (let index = 0; index < queue.length; index += 1) {
        const { kind, id, axes } = queue[index];
        const parentId = parentByChildId.get(id);
        const parent = parentId ? nodesById[parentId] : null;

        if (kind === 'offset') {
          // Child positions affect ancestor content bounds only when the
          // ancestor opts into anchored extents. `%cm` remains size-only.
          if (parent && isBooleanLikeEnabled(effectivePropsForNodeId(parentId), 'use_child_anchors')) {
            if (axes.w) {
              taintOffsetContext(
                parentId,
                'w',
                containsUnit(offsetValue(parentId, 'w'), 'c') ? ['contentW'] : [],
              );
              if (sizeReadsPositionContent(parentId, 'w')) addUnstableAxes(parentId, { w: true });
            }
            if (axes.h) {
              taintOffsetContext(
                parentId,
                'h',
                containsUnit(offsetValue(parentId, 'h'), 'c') ? ['contentH'] : [],
              );
              if (sizeReadsPositionContent(parentId, 'h')) addUnstableAxes(parentId, { h: true });
            }
          }
          continue;
        }

        const valuesW = axisValues(id, 'w');
        const valuesH = axisValues(id, 'h');
        if (axes.w && valuesH.some((value) => containsUnit(value, 'x'))) addUnstableAxes(id, { h: true });
        if (axes.h && valuesW.some((value) => containsUnit(value, 'y'))) addUnstableAxes(id, { w: true });
        const offsetW = offsetValue(id, 'w');
        const offsetH = offsetValue(id, 'h');
        if (axes.w) {
          addUnstableOffsetAxes(id, {
            w: containsUnit(offsetW, 'x'),
            h: containsUnit(offsetH, 'x'),
          });
        }
        if (axes.h) {
          addUnstableOffsetAxes(id, {
            w: containsUnit(offsetW, 'y'),
            h: containsUnit(offsetH, 'y'),
          });
        }

        if (parent) {
          if (axes.w) taintOffsetContext(parentId, 'w', contentOffsetFields(parentId, 'w'));
          if (axes.h) taintOffsetContext(parentId, 'h', contentOffsetFields(parentId, 'h'));
          addUnstableAxes(parentId, {
            w: axes.w && sizeReadsContent(parentId, 'w'),
            h: axes.h && sizeReadsContent(parentId, 'h'),
          });
          if (axes.w) propagateUnstableSiblingProvider(parentId, id, 'w');
          if (axes.h) propagateUnstableSiblingProvider(parentId, id, 'h');
        }

        for (const childId of nodesById[id] ? discoverableChildren(id) : []) {
          addUnstableAxes(childId, {
            w: axes.w && sizeReadsParent(childId, 'w'),
            h: axes.h && sizeReadsParent(childId, 'h'),
          });
          addUnstableOffsetAxes(childId, {
            w: axes.w && offsetReadsParent(childId, 'w'),
            h: axes.h && offsetReadsParent(childId, 'h'),
          });
        }
      }

      return Object.fromEntries(subtreeIds.map((id) => {
        const context = { ...(sizingContextById[id] || {}) };
        const axes = unstableAxesById.get(String(id)) || { w: false, h: false };
        if (axes.w) Object.assign(context, { contentW: 0, contentMaxW: 0, siblingMaxW: 0 });
        if (axes.h) Object.assign(context, { contentH: 0, contentMaxH: 0, siblingMaxH: 0 });
        for (const field of resetFieldsById.get(String(id)) || []) context[field] = 0;
        if (!sizingContextById[id]) context.hasMeasuredChildren = false;
        return [id, context];
      }));
    };

    const localContexts = converged
      ? Object.fromEntries(subtreeIds.map((id) => [id, sizingContextById[id] ? { ...sizingContextById[id] } : {}]))
      : makeAxisLocalFallbackContexts();
    if (converged) refineAllocatedRootContext(localContexts);
    const localBudgetExceeded = measurementBudgetReported && !budgetWasReported;
    restoreSubtree();
    if (localBudgetExceeded) ensureMeasurementBudgetWarning();
    if (!converged && !measurementBudgetReported && !allocatedContextWarnings.has(String(nodeId))) {
      allocatedContextWarnings.add(String(nodeId));
      warnings.push(`ALLOCATED_SUBTREE_CONTEXT_LIMIT:${String(nodeId)}`);
    }
    return localContexts;
  }

  /**
   * @param {string} nodeId
   * @param {{ x:number, y:number, w:number, h:number }} parentBox
   * @param {number} depth
   * @param {string|null} parentId
   * @param {{ scrollViewId:string, scrollX:number, scrollY:number }|null} scrollCtx
   * @param {number} inheritedAlpha Product of opted-in ancestor alpha values.
   * @param {{ x:number, y:number, w:number, h:number }|null} inheritedClip Effective ancestor clip.
   * @param {{w:number,h:number}|null} [resolvedSize] Size already measured by a container layout.
   * @param {Record<string, unknown>|null} [placementContext] Container-local `%c`/`%sm` bases.
   * @param {Record<string, Record<string, unknown>>|null} [allocatedContexts] Re-measured descendant contexts.
   * @returns {LayoutBox|null}
   */
  function visit(
    nodeId,
    parentBox,
    depth,
    parentId,
    scrollCtx,
    inheritedAlpha,
    inheritedClip,
    resolvedSize = null,
    placementContext = null,
    allocatedContexts = null,
  ) {
    const n = nodesById && nodeId ? nodesById[nodeId] : null;
    if (!n) return null;
    if (visibilityMode === 'safe' && sliderOmittedChildren.has(String(nodeId))) return null;
    const namedOwner = namedContentOwners.get(String(nodeId));
    if (namedOwner) {
      const meta = scrollMetaById[namedOwner];
      parentBox = { ...parentBox,
        x: boundLayoutCoordinate(parentBox.x - meta.scrollX, 'x', null, 'named-scroll-shift'),
        y: boundLayoutCoordinate(parentBox.y - meta.scrollY, 'y', null, 'named-scroll-shift') };
      scrollCtx = { scrollViewId: namedOwner, scrollX: meta.scrollX, scrollY: meta.scrollY };
      inheritedClip = intersectClipRects(inheritedClip, meta.viewport);
    }
    if (isRuntimeOnlyPreviewNode(n, visibilityMode)) return null;
    if (depth > maxLayoutDepth) {
      if (!visitDepthReported) {
        visitDepthReported = true;
        warnings.push(`LAYOUT_DEPTH_LIMIT:${maxLayoutDepth}`);
      }
      return null;
    }

    totalNodes++;
    if (boxes.length >= maxBoxes) {
      truncated = true;
      return null;
    }

    const override = propsByIdOverride && propsByIdOverride[nodeId] ? propsByIdOverride[nodeId] : null;
    const effectiveProps = override ? { ...(n.props || {}), ...override } : n.props || {};

    // Factories and collection-backed controls need Minecraft runtime data to
    // decide what (and how many items) to instantiate. Safe preview omits them;
    // Structure mode keeps their authored position available for inspection.
    const nodeType = String(n.type || '').trim().toLowerCase();
    for (const property of knownUnsupportedPreviewProperties41(nodeType, effectiveProps)) {
      const key = `${String(nodeId)}:${property}`;
      if (!reportedNativeProperties41.has(key)) {
        if (reportedNativeProperties41.size < NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41)
          warnings.push(`LAYOUT_NATIVE_PROPERTY_UNSUPPORTED:${String(nodeId).slice(0, 4096)}:${property}`);
        else if (reportedNativeProperties41.size === NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41)
          warnings.push(`LAYOUT_NATIVE_PROPERTY_DIAGNOSTIC_LIMIT:${NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41}`);
        // The traversal is already bounded by maxBoxes. Retaining the sentinel
        // only, rather than every omitted id, bounds diagnostic bookkeeping.
        if (reportedNativeProperties41.size <= NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41) reportedNativeProperties41.add(key);
      }
    }
    // A factory has no trustworthy authored instance without Minecraft runtime
    // data, so safe mode omits it. Collection-backed grids, however, can still
    // contain useful authored prototype children. Keep that one authored set
    // visible instead of turning the whole preview blank; the fidelity notice
    // explains that runtime repetition/count is not reproduced.
    const runtimeGenerated = nodeType === 'factory' && !isExplicitEventFactory38(n);
    if (visibilityMode === 'safe' && runtimeGenerated) return null;

    // Visibility gate.
    // Defense-in-depth: some deployments have reported a ReferenceError here
    // ("isVisibleFromProps is not defined") likely due to stale-cache / partial deploy.
    // `typeof` is safe on undeclared identifiers and prevents a hard crash.
    if (typeof isVisibleFromProps === 'function') {
      if (!isVisibleFromProps(effectiveProps, { mode: visibilityMode })) return null;
    }

    if (activeVisitIds.has(nodeId)) {
      if (!reportedMeasurementCycles.has(nodeId)) {
        reportedMeasurementCycles.add(nodeId);
        warnings.push(`CONTENT_SIZE_NODE_CYCLE:${nodeId}`);
      }
      return null;
    }
    activeVisitIds.add(nodeId);

    const nodeForLayout = override ? overrideProps(n, override) : n;

    const finalSizingContext = applyFallbackContextResets(nodeId, {
      ...(sizingContextById[nodeId] || {}),
      ...allocatedContextFor(allocatedContexts, nodeId),
      ...(placementContext || {}),
      resolvedSize,
      onPositionLimit: (axis, value, reason) => reportPositionLimit(nodeId, axis, value, reason),
      onLayerLimit: (value, reason) => reportLayerLimit(nodeId, value, reason),
    });
    const b = computeNodeBox(nodeForLayout, parentBox, depth, parentId, finalSizingContext);
    if (nodeType === 'factory' && isExplicitEventFactory38(n)) {
      const unusableAxis = [b.w, b.h].some((extent, axis) => extent <= 0 && n.children.some(childId => {
        const child = nodesById[childId];
        const size = propsByIdOverride?.[childId]?.size ?? child?.props?.size;
        return Array.isArray(size) && typeof size[axis] === 'string' && /%(?![A-Za-z])/u.test(size[axis]);
      }));
      if (unusableAxis) warnings.push(`LAYOUT_EVENT_FACTORY_PARENT_SIZE_UNUSABLE:${nodeId}`);
    }
    const sliderPlacement = sliderChildRuntime.get(String(nodeId));
    let sliderProgressClip = null;
    if (sliderPlacement) {
      const geometry = computeSliderGeometry37({ runtime: sliderPlacement.runtime,
        parent: sliderPlacement.kind === 'progress' ? b : sliderPlacement.parent, thumb: b });
      if (!geometry.ok) {
        reportSliderIssues(String(nodeId), geometry.diagnostics);
        activeVisitIds.delete(nodeId);
        return null;
      }
      if (sliderPlacement.kind === 'thumb') {
        b[geometry.axis] = boundLayoutCoordinate(geometry.position, geometry.axis, finalSizingContext, 'slider-position');
      } else sliderProgressClip = geometry.progressClip;
    }
    const runtimeThumb = opts._namedScrollThumbs?.[nodeId];
    if (runtimeThumb && Number.isFinite(runtimeThumb.deltaY) && Number.isFinite(runtimeThumb.h)) {
      b.y += runtimeThumb.deltaY; b.h = Math.max(0, runtimeThumb.h);
    }
    const viewportOwner = namedViewportOwners.get(String(nodeId));
    if (viewportOwner) scrollMetaById[viewportOwner].viewport = { x: b.x, y: b.y, w: b.w, h: b.h };
    b.effectiveLayer = boundLayoutLayer(
      (Number(parentBox && parentBox.effectiveLayer) || 0) + (Number(b.layer) || 0),
      finalSizingContext,
      'effective',
    );
    b.paintPath = [
      ...(Array.isArray(parentBox && parentBox.paintPath) ? parentBox.paintPath : []),
      boxes.length,
    ];
    const safeInheritedAlpha = clampAlpha(inheritedAlpha, 1);
    const localAlpha = clampAlpha(effectiveProps.alpha, 1);
    b.renderAlpha = Math.max(0, Math.min(1, safeInheritedAlpha * localAlpha));

    // Best-effort approximation of Bedrock's `propagate_alpha`: an ancestor
    // that opts in contributes its alpha throughout its descendant subtree.
    // A control that does not opt in still receives ancestor alpha, but its
    // own alpha is not added to the value passed further down.
    const childInheritedAlpha = isBooleanLikeEnabled(effectiveProps, 'propagate_alpha')
      ? b.renderAlpha
      : safeInheritedAlpha;

    // Keep authored geometry intact for scroll-range calculations, while
    // carrying the effective ancestor scissor into drawing and hit testing.
    // `allow_clipping:false` is treated as an escape from inherited scissoring
    // for this node and its subtree. Public references do not fully specify the
    // interaction with a node's own `clips_children`; our approximation still
    // allows that node to establish a fresh boundary for its descendants.
    const inheritedNodeClip = isBooleanLikeDisabled(effectiveProps, 'allow_clipping') ? null : inheritedClip;
    const nodeClip = sliderProgressClip ? intersectClipRects(inheritedNodeClip, sliderProgressClip) : inheritedNodeClip;
    b.clipRect = nodeClip ? { ...nodeClip } : null;
    const childClip = isBooleanLikeEnabled(effectiveProps, 'clips_children')
      ? intersectClipRects(nodeClip, { x: b.x, y: b.y, w: b.w, h: b.h })
      : nodeClip;

    b.order = boxes.length;
    boxes.push(b);

    // If this node is within a scroll_view content subtree, expand the unscrolled content bounds.
    if (scrollCtx && scrollCtx.scrollViewId) {
      const sx = Number(scrollCtx.scrollX) || 0;
      const sy = Number(scrollCtx.scrollY) || 0;
      const ux = (Number(b.x) || 0) + sx;
      const uy = (Number(b.y) || 0) + sy;
      const uw = Number(b.w) || 0;
      const uh = Number(b.h) || 0;

      const bounds = ensureBounds(scrollCtx.scrollViewId);
      bounds.minX = Math.min(bounds.minX, ux);
      bounds.minY = Math.min(bounds.minY, uy);
      bounds.maxX = Math.max(bounds.maxX, ux + uw);
      bounds.maxY = Math.max(bounds.maxY, uy + uh);
    }

    // Children traversal (special-cased for stack_panel and scroll_view).
    if (Array.isArray(n.children) && n.children.length) {
      const type = String(n.type || '').toLowerCase();
      const layoutChildren = selectSafeStateChildren(n, effectiveProps, n.children);
      if (type === 'slider' && visibilityMode === 'safe') {
        const state = sliderStateFor(n, effectiveProps);
        if (state.runtime.ok) {
          if (state.controls.boxId) sliderChildRuntime.set(state.controls.boxId, { kind: 'thumb', runtime: state.runtime, parent: b });
          for (const id of state.controls.progressIds) sliderChildRuntime.set(id, { kind: 'progress', runtime: state.runtime, parent: b });
        }
      }

      if (type === 'stack_panel') {
        const orientRaw =
          effectiveProps && typeof effectiveProps.orientation === 'string' ? effectiveProps.orientation : 'vertical';
        const orient = String(orientRaw || '').toLowerCase() === 'horizontal' ? 'horizontal' : 'vertical';

        const visibleChildren = layoutChildren.filter((childId) => {
          const childNode = nodesById && nodesById[childId];
          if (!childNode || isRuntimeOnlyPreviewNode(childNode, visibilityMode)) return false;
          const childOverride = propsByIdOverride && propsByIdOverride[childId];
          const childProps = childOverride ? { ...(childNode.props || {}), ...childOverride } : childNode.props || {};
          return typeof isVisibleFromProps !== 'function' || isVisibleFromProps(childProps, { mode: visibilityMode });
        });
        const baseMeasurements = visibleChildren.map((childId) => {
          const childNode = nodesById[childId];
          const childOverride = propsByIdOverride && propsByIdOverride[childId];
          const childProps = childOverride ? { ...(childNode.props || {}), ...childOverride } : childNode.props || {};
          const size = computeSize(
            childProps,
            b.w,
            b.h,
            String(childNode.type || 'unknown'),
            {
              ...(sizingContextById[childId] || {}),
              ...allocatedContextFor(allocatedContexts, childId),
              ...(shouldFillParentWhenSizeOmitted(childNode)
                ? orient === 'horizontal'
                  ? { fillParentHeightWhenDefault: true }
                  : { fillParentWidthWhenDefault: true }
                : {}),
              hasChildControls: Array.isArray(childNode.children) && childNode.children.length > 0,
            },
          );
          const rawSize = readVec2(childProps.size);
          const mainRaw = rawSize ? (orient === 'horizontal' ? rawSize.x : rawSize.y) : null;
          // `fill` consumes the remaining stack extent. A normal percentage,
          // including `100%`, is still measured against the stack itself and
          // may intentionally overflow when combined with siblings.
          const fills = typeof mainRaw === 'string' && mainRaw.trim().toLowerCase() === 'fill';
          return { childId, childProps, size, fills };
        });
        const peerMaxSizes = computePeerMaxSizes(baseMeasurements.map((item) => item.size));
        const measurements = baseMeasurements.map((item, index) => {
          const peerMaxW = peerMaxSizes[index].w;
          const peerMaxH = peerMaxSizes[index].h;
          return {
            ...item,
            naturalSize: item.size,
            size: {
              w: isBooleanLikeEnabled(item.childProps, 'inherit_max_sibling_width') ? Math.max(item.size.w, peerMaxW) : item.size.w,
              h: isBooleanLikeEnabled(item.childProps, 'inherit_max_sibling_height') ? Math.max(item.size.h, peerMaxH) : item.size.h,
            },
          };
        });
        const availableMain = orient === 'horizontal' ? b.w : b.h;
        const fixedMain = measurements.reduce((sum, item) => sum + (item.fills ? 0 : orient === 'horizontal' ? item.size.w : item.size.h), 0);
        const fillCount = measurements.filter((item) => item.fills).length;
        const fillMain = fillCount ? Math.max(0, availableMain - fixedMain) / fillCount : 0;
        const allocatedNaturalSizes = measurements.map((item) => ({
          w: orient === 'horizontal'
            ? item.fills ? fillMain : item.naturalSize.w
            : item.naturalSize.w,
          h: orient === 'vertical'
            ? item.fills ? fillMain : item.naturalSize.h
            : item.naturalSize.h,
        }));
        const allocatedPeerSizes = computePeerMaxSizes(allocatedNaturalSizes);
        let cursor = 0;

        for (let itemIndex = 0; itemIndex < measurements.length; itemIndex += 1) {
          const item = measurements[itemIndex];
          const childId = item.childId;
          const main = item.fills ? fillMain : orient === 'horizontal' ? item.size.w : item.size.h;
          const childParent = {
            x: b.x + (orient === 'horizontal' ? cursor : 0),
            y: b.y + (orient === 'vertical' ? cursor : 0),
            w: orient === 'horizontal' ? main : b.w,
            h: orient === 'vertical' ? main : b.h,
            effectiveLayer: b.effectiveLayer,
            paintPath: b.paintPath,
          };

          const resolvedChildSize = {
            w: orient === 'horizontal' ? main : item.size.w,
            h: orient === 'vertical' ? main : item.size.h,
          };
          const localPeerContext = {
            w: allocatedPeerSizes[itemIndex]?.w || 0,
            h: allocatedPeerSizes[itemIndex]?.h || 0,
          };
          const childAllocatedContexts = measureAllocatedSubtreeContexts(
            childId,
            resolvedChildSize,
            localPeerContext,
          );
          // The stack measured this child against the full stack box above.
          // Reusing that result avoids evaluating percentages a second time
          // against the smaller per-child allocation (50% -> 25%).
          const cb = visit(
            childId,
            childParent,
            depth + 1,
            String(n.id),
            scrollCtx,
            childInheritedAlpha,
            childClip,
            resolvedChildSize,
            {
              siblingMaxW: localPeerContext.w,
              siblingMaxH: localPeerContext.h,
              stackOwnsPlacement: !isBooleanLikeEnabled(effectiveProps, 'use_child_anchors'),
              stackOrientation: orient,
            },
            childAllocatedContexts,
          );
          if (cb) {
            cursor += Math.max(0, main);
          }
        }
      } else if (type === 'grid') {
        const cachedPlan = allocatedContexts && allocatedContexts[allocatedGridPlanKey];
        const canReusePlan = cachedPlan
          && cachedPlan.nodeId === String(n.id)
          && cachedPlan.w === b.w
          && cachedPlan.h === b.h;
        const allocation = canReusePlan
          ? cachedPlan.allocation
          : computeGridAllocation(n, effectiveProps, b, layoutChildren, allocatedContexts);
        if (canReusePlan) {
          for (const diagnostic of allocation.diagnostics || []) warnings.push(diagnostic);
          for (const issue of allocation.positionIssues || []) {
            reportGridPositionIssue(issue.childId, issue.status);
          }
        }

        for (let childIndex = 0; childIndex < allocation.childIds.length; childIndex += 1) {
          if (boxes.length >= maxBoxes) break;
          const childId = allocation.childIds[childIndex];
          const childNode = nodesById && nodesById[childId];
          if (!childNode) continue;
          const position = allocation.posByChild.get(childId);
          if (!position) {
            visit(
              childId,
              b,
              depth + 1,
              String(n.id),
              scrollCtx,
              childInheritedAlpha,
              childClip,
              null,
              null,
              allocatedContexts,
            );
            continue;
          }

          const localPeerContext = {
            w: allocation.cellPeerSizes[childIndex]?.w || 0,
            h: allocation.cellPeerSizes[childIndex]?.h || 0,
          };
          const resolvedCellSize = allocation.resolvedCellSizes[childIndex]
            || { w: allocation.cellW, h: allocation.cellH };
          const childAllocatedContexts = measureAllocatedSubtreeContexts(
            childId,
            resolvedCellSize,
            localPeerContext,
            allocation.childRootSizing[childIndex] || {},
          );
          visit(
            childId,
            {
              x: b.x + allocation.localOriginX + position.col * (allocation.cellW + allocation.gapX),
              y: b.y + allocation.localOriginY + position.row * (allocation.cellH + allocation.gapY),
              w: allocation.cellW,
              h: allocation.cellH,
              effectiveLayer: b.effectiveLayer,
              paintPath: b.paintPath,
            },
            depth + 1,
            String(n.id),
            scrollCtx,
            childInheritedAlpha,
            childClip,
            resolvedCellSize,
            {
              siblingMaxW: localPeerContext.w,
              siblingMaxH: localPeerContext.h,
            },
            childAllocatedContexts,
          );
        }
      } else if (type === 'scroll_view') {
        const svId = String(n.id);

        // Scroll offsets are stored in world/UI units. We clamp during interaction in main.js using maxScroll*.
        const raw = scrollById && scrollById[svId] && typeof scrollById[svId] === 'object' ? scrollById[svId] : null;
        const scrollLimitContext = {
          onPositionLimit: (axis, value, reason) => reportPositionLimit(svId, axis, value, reason),
        };
        const scrollX = boundLayoutCoordinate(raw ? raw.x : 0, 'x', scrollLimitContext, 'scroll');
        const scrollY = boundLayoutCoordinate(raw ? raw.y : 0, 'y', scrollLimitContext, 'scroll');

        const named = typeof effectiveProps.scroll_content === 'string' && effectiveProps.scroll_content.trim()
          ? (opts._namedScrollResolved?.[svId] || resolveNamedScrollControls(nodesById, svId, effectiveProps, {
              maxNodes: Math.min(maxBoxes, 100000),
              isNodeVisible: (node, id) => !isRuntimeOnlyPreviewNode(node, visibilityMode)
                && isVisibleFromProps(effectivePropsForNodeId(id), { mode: visibilityMode }),
            })) : null;
        for (const diagnostic of named?.diagnostics || []) warnings.push(`${diagnostic.code}:${svId}:${diagnostic.property || ''}`);
        const contentId = named ? named.contentId : (layoutChildren.length ? String(layoutChildren[0]) : null);
        if (named?.contentId) namedContentOwners.set(named.contentId, svId);
        if (named?.viewportId) namedViewportOwners.set(named.viewportId, svId);

        // Record scroll meta (bounds/maxes computed after traversal).
        scrollMetaById[svId] = {
          id: svId,
          namedControls: named,
          alwaysVisible: effectiveProps.scrollbar_always_visible,
          viewport: { x: b.x, y: b.y, w: b.w, h: b.h },
          scrollX,
          scrollY,
          maxScrollX: 0,
          maxScrollY: 0,
          clampedScrollX: 0,
          clampedScrollY: 0,
          contentBounds: null,
          contentChildId: contentId,
          clipRect: b.clipRect ? { ...b.clipRect } : null,
        };

        // A scroll content subtree is always constrained to its viewport in
        // this static preview. This is a documented approximation of the
        // runtime scroll-view scissor, intersected with any ancestor clip.
        const viewportClip = intersectClipRects(childClip, { x: b.x, y: b.y, w: b.w, h: b.h });

        for (const cid of layoutChildren) {
          const childId = String(cid);

          if (!named && contentId && childId === contentId) {
            // Apply scroll by shifting the coordinate system for the content subtree.
            const shifted = {
              x: boundLayoutCoordinate(b.x - scrollX, 'x', scrollLimitContext, 'scroll-shift'),
              y: boundLayoutCoordinate(b.y - scrollY, 'y', scrollLimitContext, 'scroll-shift'),
              w: b.w,
              h: b.h,
              effectiveLayer: b.effectiveLayer,
              paintPath: b.paintPath,
            };
            visit(
              childId,
              shifted,
              depth + 1,
              String(n.id),
              { scrollViewId: svId, scrollX, scrollY },
              childInheritedAlpha,
              viewportClip,
              null,
              null,
              allocatedContexts,
            );
          } else {
            visit(
              childId,
              {
                x: b.x,
                y: b.y,
                w: b.w,
                h: b.h,
                effectiveLayer: b.effectiveLayer,
                paintPath: b.paintPath,
              },
              depth + 1,
              String(n.id),
              scrollCtx,
              childInheritedAlpha,
              childClip,
              null,
              null,
              allocatedContexts,
            );
          }
        }
      } else {
        for (const cid of layoutChildren) {
          const childId = String(cid);
          visit(
            childId,
            {
              x: b.x,
              y: b.y,
              w: b.w,
              h: b.h,
              effectiveLayer: b.effectiveLayer,
              paintPath: b.paintPath,
            },
            depth + 1,
            String(n.id),
            scrollCtx,
            childInheritedAlpha,
            childClip,
            null,
            null,
            allocatedContexts,
          );
        }
      }
    }

    activeVisitIds.delete(nodeId);
    return b;
  }

  // Root traversal.
  if (rootIsFile && Array.isArray(root.children)) {
    // The "file" node is just a container; do not draw its own box by default.
    for (const cid of root.children) {
      visit(String(cid), screen, 1, rootId, null, 1, null);
    }
  } else if (root) {
    visit(rootId, screen, 0, null, null, 1, null);
  } else {
    warnings.push('NO_ROOT_NODE');
  }

  // Compute scroll ranges (best-effort) using unscrolled content bounds.
  /** @param {number} n @param {number} min @param {number} max */
  function clamp(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  for (const svId of Object.keys(scrollMetaById)) {
    const meta = scrollMetaById[svId];
    if (!meta) continue;

    const vp = meta.viewport || { x: 0, y: 0, w: 0, h: 0 };
    const bounds = scrollContentBoundsById[svId] || null;

    if (bounds && Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY)) {
      meta.contentBounds = { ...bounds };

      const maxScrollY = Math.max(0, (bounds.maxY - vp.y) - vp.h);
      const maxScrollX = Math.max(0, (bounds.maxX - vp.x) - vp.w);

      meta.maxScrollY = maxScrollY;
      meta.maxScrollX = maxScrollX;
      meta.clampedScrollY = clamp(meta.scrollY, 0, maxScrollY);
      meta.clampedScrollX = clamp(meta.scrollX, 0, maxScrollX);
    } else {
      meta.contentBounds = null;
      meta.maxScrollY = 0;
      meta.maxScrollX = 0;
      meta.clampedScrollY = 0;
      meta.clampedScrollX = 0;
    }
  }

  const boxesById = new Map(boxes.map(box => [box.id, box]));
  for (const meta of Object.values(scrollMetaById)) {
    if (!meta.namedControls?.contentId) continue;
    const track = boxesById.get(meta.namedControls.trackId);
    meta.namedMetrics = computeNamedScrollMetrics({ viewport: meta.viewport,
      contentBounds: meta.contentBounds, trackRect: track || meta.viewport,
      scrollX: meta.scrollX, scrollY: meta.scrollY, alwaysVisible: meta.alwaysVisible });
  }

  // Sanity filter (avoid NaN boxes).
  const safeBoxes = boxes.filter((b) => {
    const safe = b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h)
      && Number.isFinite(b.layer) && Number.isFinite(b.effectiveLayer);
    if (!safe && b) warnings.push(`LAYOUT_NONFINITE_BOX_DROPPED:${String(b.id)}`);
    return safe;
  });

  return {
    preset: { width: screen.w, height: screen.h, name: String(preset && preset.name ? preset.name : 'custom') },
    boxes: safeBoxes,
    stats: { totalNodes, renderedBoxes: safeBoxes.length, boxCount: safeBoxes.length, truncated, maxBoxes,
      measurementWork, allocatedSubtreeReuseCount },
    warnings,
    scrollMetaById,
  };
}

/** Named scroll runtime reflows at most once; source props remain immutable. */
export function computeLayoutBoxesForFile(file, preset = DEFAULT_CANVAS_PRESET, opts = {}) {
  const first = computeLayoutBoxesPass37(file, preset, opts);
  const overrides = { ...(opts.propsByIdOverride || {}) };
  const scrolls = { ...(opts.scrollById || {}) };
  const thumbs = Object.create(null), resolved = Object.create(null);
  let needsReflow = false;
  const initialBoxes = new Map(first.boxes.map(box => [box.id, box]));
  for (const [id, meta] of Object.entries(first.scrollMetaById || {})) {
    const named = meta.namedControls, metrics = meta.namedMetrics;
    if (!named?.contentId || !metrics?.ok) continue;
    resolved[id] = named;
    const hidden = createNamedScrollReflowOverrides(named, metrics, overrides);
    if (Object.keys(hidden).length) { Object.assign(overrides, hidden); needsReflow = true; }
    if (metrics.clampedScrollX !== meta.scrollX || metrics.clampedScrollY !== meta.scrollY) {
      scrolls[id] = { x: metrics.clampedScrollX, y: metrics.clampedScrollY }; needsReflow = true;
    }
    if (named.boxId && named.trackId && metrics.scrollbarVisible) {
      const originalBox = initialBoxes.get(named.boxId);
      if (originalBox) {
        thumbs[named.boxId] = { deltaY: metrics.thumbY - originalBox.y, h: metrics.thumbHeight }; needsReflow = true;
      }
    }
  }
  if (!needsReflow) { first.stats.namedScrollPasses = 1; return first; }
  const result = computeLayoutBoxesPass37(file, preset, { ...opts, propsByIdOverride: overrides,
    scrollById: scrolls, _namedScrollResolved: resolved, _namedScrollThumbs: thumbs });
  result.stats.namedScrollPasses = 2;
  result.stats.measurementWork += first.stats.measurementWork || 0;
  result.warnings = [...new Set([...first.warnings, ...result.warnings])];
  return result;
}

/**
 * Hit test: return the "topmost" box containing the point.
 *
 * Strategy:
 * - Match the canvas painter order: higher layer, then later order.
 * - If both are equal, the later box in the layout array wins.
 *
 * @param {LayoutBox[]} boxes
 * @param {number} worldX
 * @param {number} worldY
 * @param {{width?:number,height?:number}|null} [viewport]
 * @returns {LayoutBox|null}
 */
export function hitTestBoxes(boxes, worldX, worldY, viewport = null) {
  const x = Number(worldX) || 0;
  const y = Number(worldY) || 0;
  if (viewport) {
    const width = Number(viewport.width);
    const height = Number(viewport.height);
    if (Number.isFinite(width) && Number.isFinite(height)
      && (x < 0 || y < 0 || x > width || y > height)) return null;
  }

  /** @type {LayoutBox|null} */
  let best = null;

  for (const b of boxes || []) {
    if (!b) continue;
    if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) continue;
    if (b.clipRect && !pointInRect(b.clipRect, x, y)) continue;

    if (!best) {
      best = b;
      continue;
    }

    if (compareCanvasPaintOrder(b, best) >= 0) best = b;
  }

  return best;
}

/** Resolve a painted descendant back to its nearest interactive owner. */
export function findNearestLayoutNodeByType({ nodesById, boxes, startId, wantedType, maxDepth = 64 } = {}) {
  const nodes = nodesById && typeof nodesById === 'object' ? nodesById : {};
  const list = Array.isArray(boxes) ? boxes : [];
  const parentById = new Map();
  const boxById = new Map();
  for (const box of list) {
    if (!box || box.id === undefined) continue;
    const id = String(box.id);
    boxById.set(id, box);
    parentById.set(id, box.parentId == null ? null : String(box.parentId));
  }
  let id = startId == null ? null : String(startId);
  const wanted = String(wantedType || '').toLowerCase();
  const seen = new Set();
  for (let depth = 0; id && depth < Math.max(1, Number(maxDepth) || 64); depth += 1) {
    if (seen.has(id)) return null;
    seen.add(id);
    const node = nodes[id];
    if (node && String(node.type || '').toLowerCase() === wanted) return boxById.get(id) || null;
    id = parentById.get(id) || null;
  }
  return null;
}

/** Compare boxes using inherited layer sum followed by stable DFS order. */
export function compareCanvasPaintOrder(a, b) {
  const layerA = Number.isFinite(Number(a && a.effectiveLayer))
    ? Number(a.effectiveLayer)
    : Number(a && a.layer) || 0;
  const layerB = Number.isFinite(Number(b && b.effectiveLayer))
    ? Number(b.effectiveLayer)
    : Number(b && b.layer) || 0;
  if (layerA !== layerB) return layerA - layerB;
  return (Number(a && a.order) || 0) - (Number(b && b.order) || 0);
}

/**
 * Resize a canvas backing store to match its rendered size (devicePixelRatio-aware).
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ cssW: number, cssH: number, dpr: number, changed: boolean }}
 */
export function resizeCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const dpr = Math.max(1, Math.min(4, window.devicePixelRatio || 1));

  const needW = Math.round(cssW * dpr);
  const needH = Math.round(cssH * dpr);

  const changed = canvas.width !== needW || canvas.height !== needH;
  if (changed) {
    canvas.width = needW;
    canvas.height = needH;
  }

  return { cssW, cssH, dpr, changed };
}

/**
 * @param {string} name
 * @param {string} fallback
 */
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Draw text inside a box (best-effort).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {TextDrawInfo} info
 */
function drawTextInBox(ctx, box, info) {
  if (!ctx || !info || info.state !== 'ready' || info.fontBackend !== 'resource-font-face') return;

  const rawText = typeof info.text === 'string' ? info.text : '';
  if (!rawText) return;

  const fontPx = Number(info.fontPx) || 14;
  const family = String(info.fontFamily || '').trim() || 'sans-serif';
  const align = info.align === 'center' || info.align === 'right' ? info.align : 'left';
  const color = String(info.color || '').trim();

  const pad = 6;
  const x = Number(box.x) || 0;
  const y = Number(box.y) || 0;
  const w = Math.max(0, Number(box.w) || 0);
  const h = Math.max(0, Number(box.h) || 0);

  ctx.save();
  ctx.setLineDash([]);

  // Clip to the element rectangle.
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Bedrock is pixel-ish; disable smoothing side effects by not using shadows heavily.
  if (info.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // Use quotes around family to safely support unusual names.
  ctx.font = `${Math.max(0.01, Math.min(256, fontPx))}px "${family}"`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;

  if (color) {
    ctx.fillStyle = color;
  } else {
    ctx.fillStyle = cssVar('--text', '#ddd');
  }

  const ty = y + h / 2;
  const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - pad : x + pad;
  // JSON UI does not define automatic end-ellipsis substitution. Paint the
  // authored/localized string and let the already-applied element clip match
  // Bedrock's overflow behavior.
  drawCoveredFontLine(ctx,rawText,info.fontCoverage,{x:tx,y:ty,fontPx,align});

  ctx.restore();
}

function normalizeNineSliceMargins(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return [raw, raw, raw, raw];
  if (Array.isArray(raw) && raw.length === 2 && raw.every((value) => Number.isFinite(Number(value)))) {
    return [Number(raw[0]), Number(raw[1]), Number(raw[0]), Number(raw[1])];
  }
  if (Array.isArray(raw) && raw.length === 4 && raw.every((value) => Number.isFinite(Number(value)))) {
    return raw.map(Number);
  }
  return null;
}

function fitOpposingMargins(first, second, extent) {
  const available = Math.max(0, Number(extent) || 0);
  let a = Math.max(0, Number(first) || 0);
  let b = Math.max(0, Number(second) || 0);
  const total = a + b;
  if (total > available && total > 0) {
    const scale = available / total;
    a *= scale;
    b *= scale;
  }
  return [a, b];
}

/** Resolve an image's UV crop while preserving absent/zero/invalid semantics. */
export function computeImageSourceRect(imageSize, uv, uvSize, uvSizeState = 'absent', baseSize = null) {
  const imageW = Math.max(0, Number(imageSize && imageSize.width) || 0);
  const imageH = Math.max(0, Number(imageSize && imageSize.height) || 0);
  const logicalW = Array.isArray(baseSize) && Number(baseSize[0]) > 0 ? Number(baseSize[0]) : imageW;
  const logicalH = Array.isArray(baseSize) && Number(baseSize[1]) > 0 ? Number(baseSize[1]) : imageH;
  const densityX = logicalW > 0 ? imageW / logicalW : 1;
  const densityY = logicalH > 0 ? imageH / logicalH : 1;
  const sourceX = Array.isArray(uv) && Number.isFinite(Number(uv[0]))
    ? Math.max(0, Number(uv[0]) * densityX)
    : 0;
  const sourceY = Array.isArray(uv) && Number.isFinite(Number(uv[1]))
    ? Math.max(0, Number(uv[1]) * densityY)
    : 0;
  if (!(sourceX < imageW) || !(sourceY < imageH)) return null;
  const state = String(uvSizeState || 'absent');
  if (state === 'zero' || state === 'invalid') return null;
  let width = imageW - sourceX;
  let height = imageH - sourceY;
  if (state === 'valid') {
    if (!Array.isArray(uvSize) || uvSize.length < 2) return null;
    const requestedW = Number(uvSize[0]);
    const requestedH = Number(uvSize[1]);
    if (!(requestedW > 0) || !(requestedH > 0)) return null;
    width = Math.min(width, requestedW * densityX);
    height = Math.min(height, requestedH * densityY);
  }
  return width > 0 && height > 0 ? { x: sourceX, y: sourceY, w: width, h: height } : null;
}

/** Prepared image geometry in logical UI units. This reports the same crop
 * and fit calculations as the painter, not occupied-alpha pixels or a promise
 * that a GPU draw succeeded. Native/model image layers remain outside scope. */
export function computeImageDrawGeometry41(box, info, viewport = null) {
  const result = { schema: 'jsonui-image-geometry-v1', scope: 'prepared-painter-geometry',
    units: 'logical-ui', source_units: 'texture-pixels', native_verified: false, alpha_coverage_verified: false,
    layout_box: box ? { x: box.x, y: box.y, w: box.w, h: box.h } : null,
    source_rect: null, destination_rect: null, effective_clip: null, visible_rect: null,
    mode: 'unavailable', keep_ratio: typeof info?.keepRatio === 'boolean' ? info.keepRatio : true };
  if (!box || !info || info.state !== 'ready' || info.nativeScene || (Array.isArray(info.imageLayers) && info.imageLayers.length > 1)) return result;
  const width = Number(info.width) || Number(info.image?.naturalWidth || info.image?.width) || 0;
  const height = Number(info.height) || Number(info.image?.naturalHeight || info.image?.height) || 0;
  const source = computeImageSourceRect({ width, height }, info.uv, info.uvSize,
    info.uvSizeState || (Array.isArray(info.uvSize) ? 'valid' : 'absent'), info.baseSize);
  result.source_rect = source;
  if (!source) { result.mode = 'empty-source'; return result; }
  const destination = result.layout_box;
  const patches = info.nineSlice !== null && info.nineSlice !== undefined
    ? computeNineSlicePatches(source, destination, info.nineSlice, 1, info.baseSize, { width, height }) : null;
  const nineSlice = Boolean(patches?.length);
  result.mode = nineSlice ? 'nine-slice' : info.tiled ? 'tiled'
    : result.keep_ratio && !info.fill ? 'aspect-fit' : 'stretch';
  const fit = nineSlice || info.tiled ? { ...destination }
    : computeImageFitRect41(source, destination, result.keep_ratio, Boolean(info.fill));
  result.destination_rect = fit;
  const scissor = computeImageClipRect(destination, info.clipRatio, info.clipDirection || 'left', info.clipPixelPerfect !== false, source);
  if (!scissor || !fit) return result;
  let effective = box.clipRect ? intersectClipRects(scissor, box.clipRect) : scissor;
  if (viewport) effective = intersectClipRects(effective, viewport);
  result.effective_clip = effective;
  const visible = intersectClipRects(fit, effective);
  result.visible_rect = visible && visible.w > 0 && visible.h > 0 ? visible : null;
  return result;
}

/** Compute the destination scissor used by Bedrock image `clip_ratio`. */
export function computeImageClipRect(destination, ratio, direction = 'left', pixelPerfect = true, source = null) {
  const dest = {
    x: Number(destination && destination.x) || 0,
    y: Number(destination && destination.y) || 0,
    w: Math.max(0, Number(destination && destination.w) || 0),
    h: Math.max(0, Number(destination && destination.h) || 0),
  };
  if (!(dest.w > 0) || !(dest.h > 0)) return null;
  if (ratio === null || ratio === undefined) return dest;
  let amount = Number(ratio);
  if (!Number.isFinite(amount)) return null;
  amount = Math.max(0, Math.min(1, amount));
  const vertical = direction === 'up' || direction === 'down';
  if (pixelPerfect && amount > 0 && amount < 1) {
    const sourcePixels = Math.max(0, Number(vertical ? source && source.h : source && source.w) || 0);
    if (sourcePixels > 0) amount = Math.floor(amount * sourcePixels) / sourcePixels;
  }
  if (!(amount > 0)) return null;
  if (direction === 'right') {
    const width = dest.w * amount;
    return { x: dest.x + dest.w - width, y: dest.y, w: width, h: dest.h };
  }
  if (direction === 'up') return { x: dest.x, y: dest.y, w: dest.w, h: dest.h * amount };
  if (direction === 'down') {
    const height = dest.h * amount;
    return { x: dest.x, y: dest.y + dest.h - height, w: dest.w, h: height };
  }
  if (direction === 'center') {
    const width = dest.w * amount;
    return { x: dest.x + (dest.w - width) / 2, y: dest.y, w: width, h: dest.h };
  }
  return { x: dest.x, y: dest.y, w: dest.w * amount, h: dest.h };
}

/**
 * base_size describes the complete texture, while source is a physical crop.
 * Convert that crop back to logical pixels before tiling. Using base_size
 * directly would enlarge every sprite cut out of a high-density atlas.
 * Older direct callers that omit imageSize retain their whole-image contract.
 */
export function computeImageLogicalSourceSize(source, baseSize = null, imageSize = null) {
  return ['w', 'h'].map((axis, index) => {
    const extent = Number(source?.[axis]) || 0;
    const base = Array.isArray(baseSize) ? Number(baseSize[index]) : 0;
    const image = Number(imageSize?.[index ? 'height' : 'width']);
    if (!(Number.isFinite(base) && base > 0)) return extent;
    return Number.isFinite(image) && image > 0 ? extent * base / image : base;
  });
}

/** Build bounded patches for whole-image or cropped-sprite x/y/xy tiling. */
export function computeTiledImagePatches(source, destination, tiled, tiledScale = [1, 1], baseSize = null, maxTiles = 4096, destinationScale = 1, imageSize = null) {
  const mode = tiled === 'x' || tiled === 'y' || tiled === 'both' ? tiled : false;
  if (!mode) return null;
  const scaleX = Array.isArray(tiledScale) && Number(tiledScale[0]) > 0 ? Number(tiledScale[0]) : 1;
  const scaleY = Array.isArray(tiledScale) && Number(tiledScale[1]) > 0 ? Number(tiledScale[1]) : 1;
  const drawScale = Number.isFinite(Number(destinationScale)) && Number(destinationScale) > 0 ? Number(destinationScale) : 1;
  const [logicalW, logicalH] = computeImageLogicalSourceSize(source, baseSize, imageSize);
  const tileW = mode === 'y' ? destination.w : logicalW * scaleX * drawScale;
  const tileH = mode === 'x' ? destination.h : logicalH * scaleY * drawScale;
  if (!(tileW > 0) || !(tileH > 0) || !(destination.w > 0) || !(destination.h > 0)) return null;
  const columns = mode === 'y' ? 1 : Math.ceil(destination.w / tileW);
  const rows = mode === 'x' ? 1 : Math.ceil(destination.h / tileH);
  const requestedLimit = Number(maxTiles);
  if (Number.isFinite(requestedLimit) && requestedLimit <= 0) {
    return { patches: [], truncated: true, requiredPatches: columns * rows };
  }
  const limit = Math.max(1, Math.min(4096, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 4096)));
  const requiredPatches = columns * rows;
  if (!Number.isSafeInteger(requiredPatches) || requiredPatches > limit) {
    return { patches: [], truncated: true, requiredPatches };
  }
  const patches = [];
  let truncated = false;
  outer: for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (patches.length >= limit) {
        truncated = true;
        break outer;
      }
      const dx = destination.x + column * tileW;
      const dy = destination.y + row * tileH;
      const dw = Math.min(tileW, destination.x + destination.w - dx);
      const dh = Math.min(tileH, destination.y + destination.h - dy);
      if (!(dw > 0) || !(dh > 0)) continue;
      patches.push({
        sx: source.x,
        sy: source.y,
        sw: source.w * (dw / tileW),
        sh: source.h * (dh / tileH),
        dx,
        dy,
        dw,
        dh,
      });
    }
  }
  return { patches, truncated, requiredPatches };
}

/**
 * Compute source and destination patches for a Bedrock nine-slice texture.
 *
 * `nineslice_size` is authored in the texture's logical `base_size` units.
 * Resource packs frequently ship a 2x/4x/5x PNG for that logical size, so the
 * source crop and destination edge cannot use the same raw number. Source
 * margins are scaled to PNG pixels; destination margins stay in logical units
 * and are multiplied only by the display zoom.
 *
 * @param {{ x:number, y:number, w:number, h:number }} source
 * @param {{ x:number, y:number, w:number, h:number }} destination
 * @param {number|number[]|null|undefined} rawMargins
 * @param {number} zoom
 * @param {[number,number]|null|undefined} baseSize
 * @param {{ width:number, height:number }|null|undefined} imageSize
 * @returns {{ sx:number, sy:number, sw:number, sh:number, dx:number, dy:number, dw:number, dh:number }[]|null}
 */
export function computeNineSlicePatches(source, destination, rawMargins, zoom, baseSize, imageSize) {
  const margins = normalizeNineSliceMargins(rawMargins);
  if (!margins) return null;

  const baseW = Array.isArray(baseSize) ? Number(baseSize[0]) : 0;
  const baseH = Array.isArray(baseSize) ? Number(baseSize[1]) : 0;
  const imageW = Number(imageSize && imageSize.width) || Number(source.w) || 0;
  const imageH = Number(imageSize && imageSize.height) || Number(source.h) || 0;
  const densityX = baseW > 0 && imageW > 0 ? imageW / baseW : 1;
  const densityY = baseH > 0 && imageH > 0 ? imageH / baseH : 1;

  const [left, right] = fitOpposingMargins(margins[0] * densityX, margins[2] * densityX, source.w);
  const [top, bottom] = fitOpposingMargins(margins[1] * densityY, margins[3] * densityY, source.h);
  const safeZoom = Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;
  const [dLeft, dRight] = fitOpposingMargins(margins[0] * safeZoom, margins[2] * safeZoom, destination.w);
  const [dTop, dBottom] = fitOpposingMargins(margins[1] * safeZoom, margins[3] * safeZoom, destination.h);
  const sourceMiddleW = Math.max(0, source.w - left - right);
  const sourceMiddleH = Math.max(0, source.h - top - bottom);
  const destinationMiddleW = Math.max(0, destination.w - dLeft - dRight);
  const destinationMiddleH = Math.max(0, destination.h - dTop - dBottom);

  // Several stock Bedrock textures deliberately put the opposing slice guides
  // on the same coordinate (for example book_back is 28x28 with margin 14,
  // and many solid fills are only 1x1). The client still stretches a seam
  // sample through the destination middle. Dropping a zero-width source slice
  // leaves only four tiny corners and makes the control appear blank. Extrude
  // at most one physical source pixel, allowing bounded overlap with the
  // adjacent slice, only when there is a destination middle to paint.
  const seamSourceSpan = (extent, firstMargin, middleSpan, destinationMiddleSpan) => {
    if (middleSpan > 0 || !(destinationMiddleSpan > 0) || !(extent > 0)) {
      return { offset: firstMargin, span: middleSpan };
    }
    const span = Math.min(1, extent);
    return {
      offset: Math.max(0, Math.min(extent - span, firstMargin)),
      span,
    };
  };
  const middleX = seamSourceSpan(source.w, left, sourceMiddleW, destinationMiddleW);
  const middleY = seamSourceSpan(source.h, top, sourceMiddleH, destinationMiddleH);
  const sourceX = [source.x, source.x + middleX.offset, source.x + source.w - right];
  const sourceY = [source.y, source.y + middleY.offset, source.y + source.h - bottom];
  const sourceW = [left, middleX.span, right];
  const sourceH = [top, middleY.span, bottom];
  const destX = [destination.x, destination.x + dLeft, destination.x + destination.w - dRight];
  const destY = [destination.y, destination.y + dTop, destination.y + destination.h - dBottom];
  const destW = [dLeft, destinationMiddleW, dRight];
  const destH = [dTop, destinationMiddleH, dBottom];
  const patches = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      if (sourceW[column] <= 0 || sourceH[row] <= 0 || destW[column] <= 0 || destH[row] <= 0) continue;
      patches.push({
        sx: sourceX[column],
        sy: sourceY[row],
        sw: sourceW[column],
        sh: sourceH[row],
        dx: destX[column],
        dy: destY[row],
        dw: destW[column],
        dh: destH[row],
      });
    }
  }
  return patches;
}

function drawNineSliceImage(ctx, image, source, destination, rawMargins, zoom, baseSize, onDrawFailure) {
  const imageSize = {
    width: Number(image && (image.naturalWidth || image.width)) || Number(source.w) || 0,
    height: Number(image && (image.naturalHeight || image.height)) || Number(source.h) || 0,
  };
  const patches = computeNineSlicePatches(source, destination, rawMargins, zoom, baseSize, imageSize);
  if (!patches) return false;
  let drewPatch = false;
  for (const patch of patches) {
    try {
      ctx.drawImage(image, patch.sx, patch.sy, patch.sw, patch.sh, patch.dx, patch.dy, patch.dw, patch.dh);
      drewPatch = true;
    } catch {
      // A detached/corrupt image source must not abort the rest of the frame.
      onDrawFailure?.();
    }
  }
  return drewPatch;
}

// Some Canvas backends interpolate CanvasPattern even when smoothing is off.
// On an integer device-pixel grid, build the visible repeat using disjoint
// image copies instead. Doubling rows/columns takes O(log(width)+log(height))
// copies, not one draw per tile, and never allocates the full offscreen UI.
function drawIntegerTiledRaster(ctx, image, source, destination, tileWidth, tileHeight, budget, onRaster = null) {
  if (ctx.imageSmoothingEnabled !== false || typeof ctx.getTransform !== 'function') return false;
  try {
    const m = ctx.getTransform();
    if (![m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite) || m.a <= 0 || m.d <= 0 || m.b !== 0 || m.c !== 0) return false;
    const raw = [tileWidth * m.a, tileHeight * m.d, destination.x * m.a + m.e, destination.y * m.d + m.f];
    if (!raw.every(v => Number.isFinite(v) && Math.abs(v - Math.round(v)) < 1e-6)) return false;
    const [periodX, periodY, originX, originY] = raw.map(Math.round);
    if (periodX < 1 || periodY < 1 || periodX > 4096 || periodY > 4096) return false;
    const left = Math.max(0, originX), top = Math.max(0, originY);
    const right = Math.min(ctx.canvas.width, Math.ceil(originX + destination.w * m.a));
    const bottom = Math.min(ctx.canvas.height, Math.ceil(originY + destination.h * m.d));
    const visibleW = right - left, visibleH = bottom - top;
    if (!(visibleW > 0 && visibleH > 0)) return true;
    const offsetX = (left - originX) % periodX, offsetY = (top - originY) % periodY;
    const width = Math.max(periodX, visibleW + offsetX), height = Math.max(periodY, visibleH + offsetY);
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels > 4_000_000
      || !budget || pixels > budget.remainingPixels || budget.remainingVariants <= 0) return false;
    const surface = createNativeSceneScratchSurface(width, height);
    const scratch = surface?.getContext('2d');
    if (!scratch) return false;
    budget.remainingPixels -= pixels; budget.remainingVariants -= 1;
    scratch.imageSmoothingEnabled = false;
    // Sample directly from the authored crop once, just like an ordinary
    // patch. An intermediate ceil-sized sprite would resample fractional UVs.
    scratch.drawImage(image, source.x, source.y, source.w, source.h, 0, 0, periodX, periodY);
    let filledW = periodX, filledH = periodY;
    while (filledW < width) {
      const next = Math.min(filledW, width - filledW);
      scratch.drawImage(surface, 0, 0, next, filledH, filledW, 0, next, filledH); filledW += next;
    }
    while (filledH < height) {
      const next = Math.min(filledH, height - filledH);
      scratch.drawImage(surface, 0, 0, width, next, 0, filledH, width, next); filledH += next;
    }
    ctx.drawImage(surface, offsetX, offsetY, visibleW, visibleH,
      (left - m.e) / m.a, (top - m.f) / m.d, visibleW / m.a, visibleH / m.d);
    if (typeof onRaster === 'function') onRaster({
      image: surface, sx: offsetX, sy: offsetY, sw: visibleW, sh: visibleH,
      offsetX: (left - originX) / m.a, offsetY: (top - originY) / m.d,
      width: visibleW / m.a, height: visibleH / m.d,
    });
    return true;
  } catch { return false; }
}

function drawTiledPatternFallback(
  ctx,
  image,
  source,
  destination,
  tiled,
  tiledScale,
  baseSize,
  destinationScale,
  sourceCache,
  budget,
  preparedSource = null,
  onSource = null,
  onRaster = null,
) {
  const scale = Array.isArray(tiledScale) ? tiledScale : [1, 1];
  const drawScale = Number.isFinite(Number(destinationScale)) && Number(destinationScale) > 0
    ? Number(destinationScale) : 1;
  const [logicalWidth, logicalHeight] = computeImageLogicalSourceSize(source, baseSize,
    { width: Number(image.width) || Number(image.naturalWidth), height: Number(image.height) || Number(image.naturalHeight) });
  const tileWidth = tiled === 'y' ? destination.w : logicalWidth * Math.max(0.01, Number(scale[0]) || 1) * drawScale;
  const tileHeight = tiled === 'x' ? destination.h : logicalHeight * Math.max(0.01, Number(scale[1]) || 1) * drawScale;
  if (!(tileWidth > 0) || !(tileHeight > 0)) return false;
  if (drawIntegerTiledRaster(ctx, image, source, destination, tileWidth, tileHeight, budget, onRaster)) return true;
  const cropWidth = Math.max(1, Math.ceil(Number(source && source.w) || 0));
  const cropHeight = Math.max(1, Math.ceil(Number(source && source.h) || 0));
  if (cropWidth > 4096 || cropHeight > 4096 || cropWidth * cropHeight > 4_000_000) return false;
  try {
    let variants = sourceCache instanceof Map ? sourceCache.get(image) : null;
    if (!variants && sourceCache instanceof Map) {
      variants = new Map();
      sourceCache.set(image, variants);
    }
    const sourceKey = `${source.x}:${source.y}:${source.w}:${source.h}:${cropWidth}:${cropHeight}`;
    let tileCanvas = preparedSource && preparedSource.width === cropWidth && preparedSource.height === cropHeight
      ? preparedSource : variants instanceof Map ? variants.get(sourceKey) : null;
    if (!tileCanvas) {
      const pixels = cropWidth * cropHeight;
      if (budget && (pixels > budget.remainingPixels || budget.remainingVariants <= 0)) return false;
      tileCanvas = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(cropWidth, cropHeight)
        : typeof document !== 'undefined' && typeof document.createElement === 'function'
          ? document.createElement('canvas')
          : null;
      if (!tileCanvas) return false;
      tileCanvas.width = cropWidth;
      tileCanvas.height = cropHeight;
      const tileContext = tileCanvas.getContext('2d');
      if (!tileContext) return false;
      tileContext.drawImage(image, source.x, source.y, source.w, source.h, 0, 0, cropWidth, cropHeight);
      if (budget) {
        budget.remainingPixels -= pixels;
        budget.remainingVariants -= 1;
      }
      if (variants instanceof Map) variants.set(sourceKey, tileCanvas);
    }
    if (typeof onSource === 'function') onSource(tileCanvas);
    if (typeof ctx?.createPattern !== 'function') return false;
    const repetition = tiled === 'x' ? 'repeat-x' : tiled === 'y' ? 'repeat-y' : 'repeat';
    const pattern = ctx.createPattern(tileCanvas, repetition);
    if (!pattern) return false;
    const patternScaleX = tileWidth / cropWidth;
    const patternScaleY = tileHeight / cropHeight;
    let saved = false;
    try {
      ctx.save();
      saved = true;
      ctx.translate(destination.x, destination.y);
      ctx.scale(patternScaleX, patternScaleY);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, destination.w / patternScaleX, destination.h / patternScaleY);
      return true;
    } finally {
      if (saved) ctx.restore();
    }
  } catch {
    return false;
  }
}

function getShadedNativeFaceTexture(shader, image, width, height, shade, uv) {
  if (!shader) return null;
  if (typeof shader.getForRegion !== 'function' || !uv) return shader.get(image, width, height, shade);
  const x = Number(uv.x) * width, y = Number(uv.y) * height;
  const endX = x + Number(uv.w) * width, endY = y + Number(uv.h) * height;
  // Match the source rectangle used for drawing, including reversed UVs.
  const left = Math.max(0, Math.min(width, Math.min(x, endX)));
  const top = Math.max(0, Math.min(height, Math.min(y, endY)));
  const right = Math.max(0, Math.min(width, Math.max(x, endX)));
  const bottom = Math.max(0, Math.min(height, Math.max(y, endY)));
  return shader.getForRegion(image, width, height, shade,
    { x: left, y: top, w: right - left, h: bottom - top });
}

function drawNativePreviewScene(ctx, image, imageWidth, imageHeight, scene, destination, alpha, border, imageLayers = null, textureShader = null) {
  let faces;
  try {
    faces = scene?.faces;
  } catch {
    return false;
  }
  if (!ctx || !image || !Array.isArray(faces) || faces.length > 8192) return false;
  const layers = Array.isArray(imageLayers) && imageLayers.length
    ? imageLayers
    : [{ image, width: imageWidth, height: imageHeight }];
  if (layers.length < 1 || layers.length > 4 || layers.some((layer) => {
    const width = Number(layer?.width);
    const height = Number(layer?.height);
    return !layer?.image || !Number.isFinite(width) || !Number.isFinite(height)
      || width <= 0 || height <= 0 || width > 16384 || height > 16384
      || width * height > 16_777_216;
  })) return false;
  const placement = resolveNativeScenePlacement(scene, destination);
  if (!placement) return false;
  const extent = placement.extent;
  const drawW = extent;
  const drawH = extent;
  const drawX = placement.x;
  const drawY = placement.y;
  let drew = false;
  let expectedTexturedFaces = 0;
  let drawnTexturedFaces = 0;
  let invalidFace = false;

  const pointFor = (point) => {
    const px = Number(point?.x);
    const py = Number(point?.y);
    if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(px) > 4 || Math.abs(py) > 4) return null;
    return { x: drawX + px * drawW, y: drawY + py * drawH };
  };

  for (const face of faces) {
    let points;
    let uvPoints;
    let shade;
    let textured;
    try {
      if (!face || !Array.isArray(face.points) || face.points.length !== 4) {
        invalidFace = true;
        continue;
      }
      points = face.points.map(pointFor);
      if (points.some((point) => !point)) {
        invalidFace = true;
        continue;
      }
      uvPoints = Array.isArray(face.uvPoints) && face.uvPoints.length === 4
        ? face.uvPoints.map(pointFor)
        : points;
      if (uvPoints.some((point) => !point)) {
        invalidFace = true;
        continue;
      }
      const numericShade = Number(face.shade);
      if (!Number.isFinite(numericShade)) {
        invalidFace = true;
        continue;
      }
      shade = Math.max(0, Math.min(1, numericShade));
      textured = face.texture !== false;
      if (textured) expectedTexturedFaces += 1;
    } catch {
      invalidFace = true;
      continue;
    }
    let faceDrew = false;
    let saved = false;
    try {
      ctx.save();
      saved = true;
      ctx.setLineDash([]);
      ctx.globalAlpha = Math.max(0, Math.min(1, Number(alpha) || (alpha === 0 ? 0 : 1)));
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
      ctx.closePath();
      ctx.clip();

      const uv = textured && face.uv && typeof face.uv === 'object' ? face.uv : null;
      if (uv) {
        let allLayersDrew = true;
        for (const layer of layers) {
          const layerWidth = Number(layer.width);
          const layerHeight = Number(layer.height);
          const ux = Number(uv.x) * layerWidth;
          const uy = Number(uv.y) * layerHeight;
          const uw = Number(uv.w) * layerWidth;
          const uh = Number(uv.h) * layerHeight;
          const ux2 = ux + uw;
          const uy2 = uy + uh;
          const sx = Math.max(0, Math.min(layerWidth, Math.min(ux, ux2)));
          const sy = Math.max(0, Math.min(layerHeight, Math.min(uy, uy2)));
          const ex = Math.max(0, Math.min(layerWidth, Math.max(ux, ux2)));
          const ey = Math.max(0, Math.min(layerHeight, Math.max(uy, uy2)));
          const sw = ex - sx;
          const sh = ey - sy;
          // Compiled geometry forbids atlas overflow. Enforce that same rule
          // here: cropping then stretching a clipped UV silently changes it.
          const tolerance = 1e-7;
          if (![ux, uy, uw, uh].every(Number.isFinite)
            || Math.min(ux, ux2) < -tolerance || Math.min(uy, uy2) < -tolerance
            || Math.max(ux, ux2) > layerWidth + tolerance || Math.max(uy, uy2) > layerHeight + tolerance) {
            allLayersDrew = false;
            break;
          }
          const flipX = uw < 0;
          const flipY = uh < 0;
          const corner = (xHigh, yHigh) => uvPoints[yHigh ? (xHigh ? 2 : 3) : (xHigh ? 1 : 0)];
          const originPoint = corner(flipX, flipY);
          const xPoint = corner(!flipX, flipY);
          const yPoint = corner(flipX, !flipY);
          const a = (xPoint.x - originPoint.x) / sw;
          const b = (xPoint.y - originPoint.y) / sw;
          const c = (yPoint.x - originPoint.x) / sh;
          const d = (yPoint.y - originPoint.y) / sh;
          const e = originPoint.x - a * sx - c * sy;
          const f = originPoint.y - b * sx - d * sy;
          if (!(sw > 0 && sh > 0) || ![a, b, c, d, e, f].every(Number.isFinite)) {
            allLayersDrew = false;
            break;
          }
          let layerSaved = false;
          try {
            ctx.save();
            layerSaved = true;
            ctx.imageSmoothingEnabled = false;
            ctx.transform(a, b, c, d, e, f);
            const shaded = getShadedNativeFaceTexture(textureShader, layer.image, layerWidth, layerHeight, shade, uv);
            ctx.drawImage(shaded?.image || layer.image,
              sx - (shaded?.sourceOffsetX || 0), sy - (shaded?.sourceOffsetY || 0), sw, sh,
              sx, sy, sw, sh);
          } catch {
            allLayersDrew = false;
          } finally {
            if (layerSaved) {
              try { ctx.restore(); } catch { allLayersDrew = false; }
            }
          }
          if (!allLayersDrew) break;
        }
        if (allLayersDrew) {
          drew = true;
          faceDrew = true;
          drawnTexturedFaces += 1;
        }
      } else if (!textured) {
        ctx.fillStyle = scene.kind === 'book' ? '#4a2b20' : border;
        ctx.fillRect(drawX - drawW, drawY - drawH, drawW * 3, drawH * 3);
        drew = true;
        faceDrew = true;
      }
    } catch {
      // A malformed individual face must not prevent the rest of the UI from
      // painting. The scene is validated again at this final boundary.
    } finally {
      if (saved) {
        try { ctx.restore(); } catch { invalidFace = true; }
      }
    }

    // Textured faces use an isolated alpha-preserving source surface above.
    // Untextured fallback faces retain their existing bounded flat shading.
    if (faceDrew && !textured && shade < 0.999) {
      let shadeSaved = false;
      try {
        ctx.save();
        shadeSaved = true;
        ctx.setLineDash([]);
        ctx.globalAlpha = Math.max(0, Math.min(0.35, (1 - shade) * 0.35 * alpha));
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
        ctx.closePath();
        ctx.fill();
      } catch {
        // Shading is cosmetic. A hostile or partially detached canvas
        // implementation must not abort the rest of the UI frame.
      } finally {
        if (shadeSaved) {
          try { ctx.restore(); } catch { invalidFace = true; }
        }
      }
    }
  }
  // A partially textured model is more misleading than a diagnosed neutral
  // fallback. Require every authored textured face to complete.
  return drew && !invalidFace && drawnTexturedFaces === expectedTexturedFaces;
}

function drawFailedNativeScenePlaceholder(ctx, destination, alpha, border) {
  let saved = false;
  try {
    const { x, y, w, h } = destination;
    ctx.save();
    saved = true;
    ctx.setLineDash([]);
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(alpha) || (alpha === 0 ? 0 : 1))) * 0.32;
    ctx.fillStyle = border;
    ctx.fillRect(x + w * 0.18, y + h * 0.18, w * 0.64, h * 0.64);
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(alpha) || (alpha === 0 ? 0 : 1))) * 0.8;
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.18, y + h * 0.18);
    ctx.lineTo(x + w * 0.82, y + h * 0.82);
    ctx.moveTo(x + w * 0.82, y + h * 0.18);
    ctx.lineTo(x + w * 0.18, y + h * 0.82);
    ctx.stroke();
  } catch {
    // The surrounding box draw remains isolated even for detached contexts.
  } finally {
    if (saved) {
      try { ctx.restore(); } catch { /* final isolation boundary */ }
    }
  }
}

function createNativeSceneScratchSurface(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width > 4096 || height > 4096
    || width * height > 4_000_000) return null;
  try {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  } catch {
    // Fall through to a detached DOM canvas where available.
  }
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  } catch {
    // A detached/hostile document cannot provide an atomic render target.
  }
  return null;
}

function drawNativePreviewSceneAtomically(
  ctx,
  image,
  imageWidth,
  imageHeight,
  scene,
  destination,
  alpha,
  border,
  imageLayers,
  surfaceBudget,
  rasterCache = null,
  textureShader = null,
  onShadeIssue = null,
) {
  const placement = resolveNativeScenePlacement(scene, destination);
  if (!placement) return { ok: false, budgetExceeded: false };
  const rasterBounds = resolveNativeSceneRasterBounds(scene, destination, placement);
  if (!rasterBounds) return { ok: false, budgetExceeded: false };
  const surfaceWidth = rasterBounds.w;
  const surfaceHeight = rasterBounds.h;
  const pixels = surfaceWidth * surfaceHeight;
  if (!Number.isSafeInteger(pixels) || pixels > surfaceBudget.remainingPixels) {
    return { ok: false, budgetExceeded: true };
  }
  const layerKeys = Array.isArray(imageLayers)
    ? imageLayers.flatMap((layer) => [layer.image, layer.width, layer.height]) : [];
  // Prepare/charge variants before checking the final scene cache. Cache
  // warmth must not hide an unavailable effect or change the frame budget.
  let shadesComplete = true;
  const shadeLayers = Array.isArray(imageLayers) && imageLayers.length
    ? imageLayers : [{ image, width: imageWidth, height: imageHeight }];
  if (textureShader) for (const face of scene.faces) {
    if (face.texture === false || !Number.isFinite(Number(face.shade))) continue;
    const shade = Math.max(0, Math.min(1, Number(face.shade)));
    for (const layer of shadeLayers) {
      const result = getShadedNativeFaceTexture(textureShader, layer.image,
        Number(layer.width), Number(layer.height), shade, face.uv);
      if (!result.ok) { shadesComplete = false; onShadeIssue?.(result.issue); }
    }
  }
  const cacheKey = rasterCache?.key(['native', scene, image, imageWidth, imageHeight,
    destination.w, destination.h, border, ...layerKeys]);
  let surface = cacheKey && shadesComplete ? rasterCache.get(cacheKey) : null;
  // Cached surfaces consume the same per-frame pixel/work budget as fresh ones.
  // Cache reuse must never become a bypass for a hostile oversized scene.
  surfaceBudget.remainingPixels -= pixels;
  if (!surface) {
    surface = createNativeSceneScratchSurface(surfaceWidth, surfaceHeight);
    if (!surface) return { ok: false, budgetExceeded: true };
    let scratch;
    try { scratch = surface.getContext('2d'); } catch { scratch = null; }
    if (!scratch) return { ok: false, budgetExceeded: false };
    const localDestination = {
      x: destination.x - placement.x + 1,
      y: destination.y - placement.y + 1,
      w: destination.w,
      h: destination.h,
    };
    // Keep the original face coordinate calculations as well as their pixel
    // phase. Expanding storage must not change the model/camera normalization.
    scratch.transform(1, 0, 0, 1, placement.x - 1 - rasterBounds.x, placement.y - 1 - rasterBounds.y);
    const complete = drawNativePreviewScene(scratch, image, imageWidth, imageHeight,
      scene, localDestination, 1, border, imageLayers, textureShader);
    if (!complete) return { ok: false, budgetExceeded: false };
    if (cacheKey && shadesComplete) rasterCache.set(cacheKey, surface, pixels);
  }
  let saved = false;
  try {
    ctx.save();
    saved = true;
    ctx.setLineDash([]);
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(alpha) || (alpha === 0 ? 0 : 1)));
    ctx.drawImage(
      surface,
      rasterBounds.x,
      rasterBounds.y,
    );
    return { ok: true, budgetExceeded: false };
  } catch {
    return { ok: false, budgetExceeded: false };
  } finally {
    if (saved) {
      try { ctx.restore(); } catch { /* final isolation boundary */ }
    }
  }
}

function safelyDrawNativePlaceholder(ctx, draw) {
  let saved = false;
  try {
    ctx.save();
    saved = true;
    ctx.setLineDash([]);
    draw();
    return true;
  } catch {
    return false;
  } finally {
    if (saved) {
      try { ctx.restore(); } catch { /* final isolation boundary */ }
    }
  }
}

/**
 * Draw boxes into canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {LayoutResult} layout
 * @param {CanvasView} view
 * @param {{ selectedId?: string|null, hoverId?: string|null, showAll?: boolean, showGuides?: boolean, showScreenBoundary?: boolean, showResizeHandles?: boolean, handlePx?: number, imageDrawById?: Record<string, ImageDrawInfo>, textDrawById?: Record<string, TextDrawInfo>, showMissingTexturePlaceholders?: boolean, onNativeSceneIssue?: (issue:{code:string,nodeId:string})=>void, onImageDrawIssue?: (issue:{code:string,nodeId:string})=>void }} [selection]
 */
export function drawCanvasPreview(canvas, layout, view, selection = {}) {
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { cssW, cssH, dpr } = resizeCanvasToDisplaySize(canvas);
  const paintSnapshot = { layout, imageDrawById: selection.imageDrawById, textDrawById: selection.textDrawById,
    zoom: clampZoom(view?.zoom), nativeFallbackIds: new Set(), tiledDrawById: new Map() };
  viewportPaintSnapshots.set(canvas, paintSnapshot);
  let rasterCache = null;
  const rasterCacheOwner = selection.rasterCacheSource && typeof selection.rasterCacheSource === 'object'
    ? selection.rasterCacheSource : canvas;
  if (selection.cacheStableSources === true) {
    const epoch = selection.rasterCacheEpoch;
    let stored = viewportRasterCaches.get(rasterCacheOwner);
    if (!stored || stored.epoch !== epoch) {
      stored = { epoch, cache: new PreviewRasterCache() };
      viewportRasterCaches.set(rasterCacheOwner, stored);
    }
    rasterCache = stored.cache;
  } else viewportRasterCaches.delete(rasterCacheOwner);
  const nativeTextureShader = createNativeTextureShader({ createSurface: createNativeSceneScratchSurface, rasterCache });


  // Draw in CSS pixel coordinates (scale backing store by dpr).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Theme-aware colors.
  const bg = cssVar('--panel', '#111');
  const border = cssVar('--border', '#444');
  const focus = cssVar('--focus', '#4b82ff');

  // Clear.
  ctx.clearRect(0, 0, cssW, cssH);
  if (selection.transparentBackground !== true) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  const z = clampZoom(view && view.zoom);
  const viewX = Number(view && view.viewX) || 0;
  const viewY = Number(view && view.viewY) || 0;

  /** @param {number} wx */
  const sx = (wx) => (wx - viewX) * z;
  /** @param {number} wy */
  const sy = (wy) => (wy - viewY) * z;
  const showGuides = selection && selection.showGuides === false ? false : true;
  const showScreenBoundary = selection && selection.showScreenBoundary === false ? false : true;

  // Screen outline.
  const pw = Number(layout && layout.preset ? layout.preset.width : DEFAULT_CANVAS_PRESET.width) || DEFAULT_CANVAS_PRESET.width;
  const ph = Number(layout && layout.preset ? layout.preset.height : DEFAULT_CANVAS_PRESET.height) || DEFAULT_CANVAS_PRESET.height;

  function applyDeviceViewportClip() {
    if (!(pw > 0) || !(ph > 0)) return false;
    ctx.beginPath();
    ctx.rect(sx(0), sy(0), pw * z, ph * z);
    ctx.clip();
    return true;
  }

  if (showScreenBoundary) {
    ctx.save();
    // A subtle transparency grid distinguishes the authored 16:9 viewport
    // from the surrounding editor even when the UI itself is intentionally
    // empty or runtime-hidden.
    const left = sx(0);
    const top = sy(0);
    const width = pw * z;
    const height = ph * z;
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    const tile = 16;
    for (let y = Math.floor(top / tile) * tile; y < top + height; y += tile) {
      for (let x = Math.floor(left / tile) * tile; x < left + width; x += tile) {
        if ((Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0) {
          ctx.fillStyle = 'rgba(127,127,127,0.035)';
          ctx.fillRect(x, y, tile, tile);
        }
      }
    }
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(Math.round(sx(0)) + 0.5, Math.round(sy(0)) + 0.5, Math.round(pw * z), Math.round(ph * z));
    ctx.restore();
  }

  const boxes = layout && Array.isArray(layout.boxes)
    ? layout.boxes.slice().sort(compareCanvasPaintOrder)
    : [];
  const selectedId = selection && selection.selectedId ? String(selection.selectedId) : null;
  const hoverId = selection && selection.hoverId ? String(selection.hoverId) : null;

  /** @type {Record<string, ImageDrawInfo>|null} */
  const imageDrawById =
    selection && selection.imageDrawById && typeof selection.imageDrawById === 'object'
      ? /** @type {any} */ (selection.imageDrawById)
      : null;

  const effectedImagesBySource = new Map();
  const tiledPatternSourcesByImage = new Map();
  const tiledPatternBudget = { remainingPixels: 8_000_000, remainingVariants: 128 };
  let remainingEffectPixels = 16_000_000;
  let remainingEffectVariants = 128;
  // Native model previews are synchronous Canvas work. Keep ample headroom for
  // Vanilla's horse (currently 72 faces across three layers) while preventing
  // a valid-but-hostile geometry from monopolizing repeated hover/resize
  // redraws. A rejected scene is replaced atomically and diagnosed below.
  let remainingNativeWorkUnits = 4096;
  let remainingNativeScenes = 32;
  const nativeSurfaceBudget = { remainingPixels: 2_000_000 };
  const notifiedNativeIssues = new Set();
  const notifyNativeIssue = (code, nodeId) => {
    if (notifiedNativeIssues.has(code)) return;
    notifiedNativeIssues.add(code);
    if (typeof selection?.onNativeSceneIssue !== 'function') return;
    try {
      selection.onNativeSceneIssue(Object.freeze({ code, nodeId: String(nodeId || '') }));
    } catch {
      // Diagnostics callbacks are never allowed to interrupt a frame.
    }
  };
  // 欠けた画像効果・描画失敗を完成した画素と区別する。通知側の不具合で描画は止めない。
  const notifiedImageIssues = new Set();
  const notifyImageIssue = (code, nodeId) => {
    const key = `${code}:${String(nodeId || '')}`;
    if (notifiedImageIssues.has(key) || notifiedImageIssues.size >= 128) return;
    notifiedImageIssues.add(key);
    try { selection?.onImageDrawIssue?.(Object.freeze({ code, nodeId: String(nodeId || '') })); }
    catch { /* 診断の失敗は後続controlの描画へ伝播させない。 */ }
  };
  let remainingTilePatches = 8192;
  function getEffectedImageSource(image, width, height, tint, grayscale) {
    const rgbTint = Array.isArray(tint) && tint.length >= 3
      ? tint.slice(0, 3).map((value) => Math.max(0, Math.min(1, Number(value))))
      : null;
    const needsTint = Boolean(rgbTint && rgbTint.some((value) => Math.abs(value - 1) > 1e-6));
    const needsGrayscale = Boolean(grayscale);
    if (!needsTint && !needsGrayscale) return { image, processed: false };
    const safeWidth = Math.max(1, Math.ceil(Number(width) || 0));
    const safeHeight = Math.max(1, Math.ceil(Number(height) || 0));
    const pixels = safeWidth * safeHeight;
    let variants = effectedImagesBySource.get(image);
    if (!variants) {
      variants = new Map();
      effectedImagesBySource.set(image, variants);
    }
    const key = `${safeWidth}:${safeHeight}:${needsGrayscale ? 1 : 0}:${needsTint ? rgbTint.join(',') : 'none'}`;
    if (variants.has(key)) return { image: variants.get(key), processed: true };
    if (
      safeWidth > 4096 || safeHeight > 4096 || pixels > 4_000_000
      || pixels > remainingEffectPixels || remainingEffectVariants <= 0
    ) {
      return { image, processed: false, issue: 'IMAGE_EFFECT_BUDGET_EXCEEDED' };
    }
    const persistentKey = rasterCache?.key(['effect', image, key]);
    const persisted = persistentKey ? rasterCache.get(persistentKey) : null;
    if (persisted) {
      // Reuse avoids raster work, but does not change the frame's supported
      // effect set. Charge each distinct source/variant once, just like a
      // freshly composed surface; otherwise warm caches alter fallback pixels.
      remainingEffectPixels -= pixels;
      remainingEffectVariants -= 1;
      variants.set(key, persisted);
      return { image: persisted, processed: true };
    }
    // Failed attempts still allocate/process surfaces. Charge before touching
    // host Canvas APIs so repeated failures cannot bypass the per-frame cap.
    remainingEffectPixels -= pixels;
    remainingEffectVariants -= 1;
    try {
      const effectCanvas = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(safeWidth, safeHeight)
        : typeof document !== 'undefined' && typeof document.createElement === 'function'
          ? document.createElement('canvas')
          : null;
      if (!effectCanvas) return { image, processed: false, issue: 'IMAGE_EFFECT_UNAVAILABLE' };
      effectCanvas.width = safeWidth;
      effectCanvas.height = safeHeight;
      const effectContext = effectCanvas.getContext('2d');
      if (!effectContext) return { image, processed: false, issue: 'IMAGE_EFFECT_UNAVAILABLE' };
      if (needsGrayscale && !('filter' in effectContext)) return { image, processed: false, issue: 'IMAGE_EFFECT_UNAVAILABLE' };
      effectContext.clearRect(0, 0, safeWidth, safeHeight);
      if (needsGrayscale && 'filter' in effectContext) effectContext.filter = 'grayscale(1)';
      effectContext.drawImage(image, 0, 0, safeWidth, safeHeight);
      if ('filter' in effectContext) effectContext.filter = 'none';
      if (needsTint) {
        // Canvas multiply is a backdrop blend, not a texture color multiplier:
        // its source-over term adds tint through partially transparent texels.
        // Work on straight RGBA once per bounded, cached source variant so the
        // original alpha survives and transparent colored edges keep their RGB.
        if (typeof effectContext.getImageData !== 'function' || typeof effectContext.putImageData !== 'function') {
          return { image, processed: false, issue: 'IMAGE_EFFECT_UNAVAILABLE' };
        }
        const rgba = effectContext.getImageData(0, 0, safeWidth, safeHeight);
        const data = rgba.data;
        for (let index = 0; index < data.length; index += 4) {
          data[index] = Math.round(data[index] * rgbTint[0]);
          data[index + 1] = Math.round(data[index + 1] * rgbTint[1]);
          data[index + 2] = Math.round(data[index + 2] * rgbTint[2]);
        }
        effectContext.putImageData(rgba, 0, 0);
      }
      variants.set(key, effectCanvas);
      if (persistentKey) rasterCache.set(persistentKey, effectCanvas, pixels);
      return { image: effectCanvas, processed: true };
    } catch {
      return { image, processed: false, issue: 'IMAGE_EFFECT_FAILED' };
    }
  }

  /** @type {Record<string, TextDrawInfo>|null} */
  const textDrawById =
    selection && selection.textDrawById && typeof selection.textDrawById === 'object'
      ? /** @type {any} */ (selection.textDrawById)
      : null;

  /**
   * Apply the layout-computed ancestor clip to the current canvas state.
   * @param {{ clipRect?: { x:number, y:number, w:number, h:number }|null }} item
   * @returns {boolean} false when the clip is empty
   */
  function applyWorldClip(item) {
    const clip = item && item.clipRect ? item.clipRect : null;
    if (!clip) return true;
    const w = Math.max(0, Number(clip.w) || 0);
    const h = Math.max(0, Number(clip.h) || 0);
    if (w <= 0 || h <= 0) return false;
    ctx.beginPath();
    ctx.rect(sx(Number(clip.x) || 0), sy(Number(clip.y) || 0), w * z, h * z);
    ctx.clip();
    return true;
  }

  // Draw all boxes.
  ctx.save();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  for (const b of boxes) {
    if (!b) continue;
    const id = String(b.id);

    const x = sx(Number(b.x) || 0);
    const y = sy(Number(b.y) || 0);
    const w = (Number(b.w) || 0) * z;
    const h = (Number(b.h) || 0) * z;

    // Thin authored images can be panel borders. Their area remains visible
    // under Canvas coverage sampling even below half a CSS pixel; removing
    // them changes the UI when the preview is zoomed out or uses high DPR.
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const nativeInfo = imageDrawById?.[id];
    const nativePlacement = nativeInfo?.state === 'native-scene' && selection.forceNativeFallback !== true
      ? resolveNativeScenePlacement(nativeInfo.nativeScene, { x, y, w, h }) : null;
    // Native controls locate the model, but are not its visible bounds. This
    // also matters for a one-pixel editor probe far outside a large control.
    const paintBounds = nativePlacement
      ? resolveNativeSceneRasterBounds(nativeInfo.nativeScene, { x, y, w, h }, nativePlacement) || { x, y, w, h }
      : { x, y, w, h };
    if (paintBounds.x > cssW + 50 || paintBounds.y > cssH + 50
      || paintBounds.x + paintBounds.w < -50 || paintBounds.y + paintBounds.h < -50) continue;

    ctx.save();
    if (!applyDeviceViewportClip() || !applyWorldClip(b)) {
      ctx.restore();
      continue;
    }

    // Image rendering (S041): draw decoded textures for image elements.
    const type = String(b.type || '').toLowerCase();
    if ((type === 'image' || type === 'custom') && imageDrawById) {
      const info = imageDrawById[id] || null;
      const hasImage = Boolean(info && info.state === 'ready' && info.image);
      const hasNativeScene = Boolean(info && info.state === 'native-scene' && info.image && info.nativeScene);

      if (hasNativeScene) {
        const img = /** @type {any} */ (info.image);
        const iw = Number(info.width) || Number(img.width) || Number(img.naturalWidth) || 0;
        const ih = Number(info.height) || Number(img.height) || Number(img.naturalHeight) || 0;
        let faceCount = Number.POSITIVE_INFINITY;
        let layerCount = Number.POSITIVE_INFINITY;
        try {
          faceCount = Array.isArray(info.nativeScene?.faces) ? info.nativeScene.faces.length : Number.POSITIVE_INFINITY;
          layerCount = Array.isArray(info.imageLayers) && info.imageLayers.length
            ? info.imageLayers.length
            : 1;
        } catch {
          faceCount = Number.POSITIVE_INFINITY;
          layerCount = Number.POSITIVE_INFINITY;
        }
        const nativeWorkUnits = Number.isSafeInteger(faceCount)
          && Number.isSafeInteger(layerCount)
          && faceCount >= 0
          && layerCount >= 1
          && layerCount <= 4
          && faceCount <= Math.floor(Number.MAX_SAFE_INTEGER / layerCount)
          ? faceCount * layerCount
          : Number.POSITIVE_INFINITY;
        const withinNativeBudget = selection.forceNativeFallback !== true && Number.isSafeInteger(nativeWorkUnits)
          && faceCount >= 0
          && nativeWorkUnits <= NATIVE_PREVIEW_MAX_DRAW_WORK_UNITS
          && nativeWorkUnits <= remainingNativeWorkUnits
          && remainingNativeScenes > 0;
        let drewNativeScene = false;
        if (withinNativeBudget) {
          // Reserve for the whole frame before invoking any face operations.
          remainingNativeWorkUnits -= nativeWorkUnits;
          remainingNativeScenes -= 1;
          let atomicResult = { ok: false, budgetExceeded: false };
          try {
            atomicResult = drawNativePreviewSceneAtomically(
              ctx,
              img,
              iw,
              ih,
              info.nativeScene,
              { x, y, w, h },
              Math.max(0, Math.min(1, Number(info.alpha) || (info.alpha === 0 ? 0 : 1))),
              border,
              info.imageLayers,
              nativeSurfaceBudget,
              rasterCache,
              nativeTextureShader,
              code => notifyNativeIssue(code, id),
            );
          } catch {
            atomicResult = { ok: false, budgetExceeded: false };
          }
          drewNativeScene = atomicResult.ok;
          if (!drewNativeScene) notifyNativeIssue(
            atomicResult.budgetExceeded
              ? 'NATIVE_PREVIEW_FRAME_BUDGET_EXCEEDED'
              : 'NATIVE_PREVIEW_DRAW_FAILED',
            id,
          );
        } else {
          notifyNativeIssue('NATIVE_PREVIEW_FRAME_BUDGET_EXCEEDED', id);
        }
        if (!drewNativeScene) {
          paintSnapshot.nativeFallbackIds.add(id);
          drawFailedNativeScenePlaceholder(
            ctx,
            { x, y, w, h },
            Math.max(0, Math.min(1, Number(info.alpha) || (info.alpha === 0 ? 0 : 1))),
            border,
          );
        }
      } else if (hasImage) {
        const img = /** @type {any} */ (info.image);
        const keepRatio = typeof info.keepRatio === 'boolean' ? info.keepRatio : true;
        const bilinear = typeof info.bilinear === 'boolean' ? info.bilinear : false;

        const iw = Number(info.width) || Number(img.width) || Number(img.naturalWidth) || 0;
        const ih = Number(info.height) || Number(img.height) || Number(img.naturalHeight) || 0;
        const tintAlpha = Array.isArray(info.tint) && Number.isFinite(Number(info.tint[3]))
          ? Math.max(0, Math.min(1, Number(info.tint[3])))
          : 1;
        const drawAlpha = Math.max(0, Math.min(1, Number(info.alpha) || (info.alpha === 0 ? 0 : 1))) * tintAlpha;
        const source = computeImageSourceRect(
          { width: iw, height: ih },
          info.uv,
          info.uvSize,
          info.uvSizeState || (Array.isArray(info.uvSize) ? 'valid' : 'absent'),
          info.baseSize,
        );
        const destination = { x, y, w, h };
        const clipRect = source
          ? computeImageClipRect(destination, info.clipRatio, info.clipDirection || 'left', info.clipPixelPerfect !== false, source)
          : null;
        // Intentionally empty pixels need no recoloring surface. Charging that
        // work would falsely reject transparent/zero-UV/zero-clip strict PNGs.
        const effected = drawAlpha > 0 && source && clipRect
          ? getEffectedImageSource(img, iw, ih, info.tint, info.grayscale)
          : { image: img, processed: false };
        const renderImg = effected.image;
        if (effected.issue) {
          const needsTint = Array.isArray(info.tint) && info.tint.slice(0, 3).some(value => Math.abs(Math.max(0, Math.min(1, Number(value))) - 1) > 1e-6);
          // grayscaleだけなら出力contextのfilterで同じ処理を実行できる。
          if (needsTint || (info.grayscale && !('filter' in ctx))) notifyImageIssue(effected.issue, id);
        }

        ctx.save();
        if (!renderImg) {
          ctx.restore();
          ctx.restore();
          continue;
        }
        ctx.imageSmoothingEnabled = Boolean(bilinear);
        ctx.globalAlpha = drawAlpha;
        if (info.grayscale && !effected.processed && 'filter' in ctx) ctx.filter = 'grayscale(1)';
        if (!source || !clipRect) {
          ctx.restore();
          ctx.restore();
          continue;
        }
        ctx.beginPath();
        ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
        ctx.clip();
        const drawCropped = (dx, dy, dw, dh) => {
          try {
            ctx.drawImage(renderImg, source.x, source.y, source.w, source.h, dx, dy, dw, dh);
            return true;
          } catch {
            notifyImageIssue('IMAGE_DRAW_FAILED', id);
            return false;
          }
        };

        const hasNineSlice = info.nineSlice !== null && info.nineSlice !== undefined;
        if (hasNineSlice && drawNineSliceImage(ctx, renderImg, source, destination, info.nineSlice, z, info.baseSize,
          () => notifyImageIssue('IMAGE_DRAW_FAILED', id))) {
          // Nine-slice geometry takes precedence when both texture metadata
          // flags are present; whole-image tiling would destroy fixed corners.
        } else if (info.tiled) {
          const tiledResult = computeTiledImagePatches(
            source,
            destination,
            info.tiled,
            info.tiledScale,
            info.baseSize,
            Math.min(1024, remainingTilePatches),
            z,
            { width: iw, height: ih },
          );
          if (tiledResult && !tiledResult.truncated) {
            remainingTilePatches -= tiledResult.patches.length;
          }
          if (selection.forceTiledMode === 'integer-raster') {
            // The editor probe must sample the exact integer-grid raster used
            // by the visible frame. Repeating the original texture at a
            // fractional probe origin can change alpha coverage and recreate
            // a megatexel source for every pointer movement.
            const raster = selection.preparedTiledRaster;
            if (raster?.image) {
              try {
                ctx.drawImage(raster.image, raster.sx, raster.sy, raster.sw, raster.sh,
                  x + raster.offsetX, y + raster.offsetY, raster.width, raster.height);
              } catch { /* An unavailable saved source must not invent pixels. */ }
            }
            paintSnapshot.tiledDrawById.set(id, { mode: 'integer-raster', raster });
          } else if (selection.forceTiledMode === 'stretched') {
            drawCropped(x, y, w, h);
            paintSnapshot.tiledDrawById.set(id, { mode: 'stretched' });
          } else if (selection.forceTiledMode === 'pattern' || (tiledResult && tiledResult.truncated)) {
            let tileSource = null;
            let tiledRaster = null;
            if (!drawTiledPatternFallback(
              ctx,
              renderImg,
              source,
              destination,
              info.tiled,
              info.tiledScale,
              info.baseSize,
              z,
              tiledPatternSourcesByImage,
              tiledPatternBudget,
              selection.preparedTileSource,
              source => { tileSource = source; },
              raster => { tiledRaster = raster; },
            )) {
              // Pattern creation is not universally available (notably some
              // constrained webviews). Preserve the texture as a stretched
              // degradation instead of making the entire control disappear.
              notifyImageIssue('IMAGE_TILING_FALLBACK', id);
              drawCropped(x, y, w, h);
              paintSnapshot.tiledDrawById.set(id, { mode: 'stretched' });
            } else paintSnapshot.tiledDrawById.set(id, tiledRaster
              ? { mode: 'integer-raster', raster: tiledRaster }
              : { mode: 'pattern', source: tileSource });
          } else {
            for (const patch of tiledResult ? tiledResult.patches : []) {
              try {
                ctx.drawImage(renderImg, patch.sx, patch.sy, patch.sw, patch.sh, patch.dx, patch.dy, patch.dw, patch.dh);
              } catch {
                // Keep drawing later controls when an individual source fails.
                notifyImageIssue('IMAGE_DRAW_FAILED', id);
              }
            }
          }
        } else {
          const fit = computeImageFitRect41(source, destination, keepRatio, Boolean(info.fill));
          if (fit) drawCropped(fit.x, fit.y, fit.w, fit.h);
        }

        ctx.restore();
      } else if (info && info.state === 'native-placeholder' && info.placeholderKind === 'banner-pattern') {
        // `banner_pattern_renderer` needs live pattern/color arrays. Preserve a
        // clearly neutral banner silhouette so its authored 7x14 / 20x40
        // geometry and surrounding pack textures remain inspectable without
        // inventing pattern pixels.
        const placeholderDrew = safelyDrawNativePlaceholder(ctx, () => {
          ctx.globalAlpha = Math.max(0, Math.min(1, Number(info.alpha) || (info.alpha === 0 ? 0 : 1))) * 0.55;
          ctx.fillStyle = cssVar('--text', '#ddd');
          const bannerX = x + w * 0.18;
          const bannerW = w * 0.64;
          ctx.fillRect(bannerX, y + h * 0.08, bannerW, h * 0.7);
          ctx.fillRect(bannerX, y + h * 0.74, bannerW * 0.4, h * 0.18);
          ctx.fillRect(bannerX + bannerW * 0.6, y + h * 0.74, bannerW * 0.4, h * 0.18);
          // Pattern-ID to atlas UV is not supplied by the pack. Retain the
          // diagnosed silhouette instead of inventing different pattern pixels.
          ctx.globalAlpha = Math.max(0, Math.min(1, Number(info.alpha) || (info.alpha === 0 ? 0 : 1))) * 0.75;
          ctx.strokeStyle = border;
          ctx.strokeRect(bannerX, y + h * 0.08, bannerW, h * 0.7);
        });
        if (!placeholderDrew) notifyNativeIssue('NATIVE_PREVIEW_DRAW_FAILED', id);
      } else if (
        selection.showMissingTexturePlaceholders !== false
        && info
        && (info.state === 'loading' || info.state === 'missing' || info.state === 'unsupported')
      ) {
        // Placeholder for missing/unsupported/async-loading textures.
        ctx.save();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = border;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        ctx.moveTo(x + w, y);
        ctx.lineTo(x, y + h);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Hover hint: draw solid with focus color.
    if (showGuides && hoverId && id === hoverId) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = focus;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      ctx.restore();
    } else if (showGuides) {
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    }

    // Text rendering (S042): draw label/button text (best-effort).
    if ((type === 'label' || type === 'button' || type === 'dropdown' || type === 'edit_box') && textDrawById) {
      const info = textDrawById[id] || null;
      if (info && typeof info.text === 'string' && info.text) {
        const fontPx = Number(info.fontPx) || 14;
        const family = String(info.fontFamily || '').trim() || 'sans-serif';
        const alignRaw = String(info.align || '').toLowerCase();
        const align = alignRaw === 'center' ? 'center' : alignRaw === 'right' ? 'right' : 'left';

        // Templates define padding in logical units. A fixed CSS-pixel pad
        // changes when only the editor zoom changes.
        const pad = 0;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, Number(info.alpha) || (info.alpha === 0 ? 0 : 1)));
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();

        ctx.textBaseline = 'middle';
        ctx.textAlign = align;
        // Keep the exact zoomed font size used by intrinsic measurement.
        // Rounding here alone can make a correctly-sized box look too narrow.
        if (info.fontBackend === 'resource-font-face' && info.state === 'ready') ctx.font = `${fontPx}px "${family}"`;

        const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - pad : x + pad;
        const vertical = String(info.verticalAlign || '').toLowerCase();
        const lines = String(info.text).split(/\r?\n/u);
        const lineHeight = fontPx + Math.max(0,Number(info.linePadding)||0);
        const blockHeight = fontPx * Math.max(1, lines.length) + Math.max(0,lines.length-1)*(lineHeight-fontPx);
        const firstTy = vertical.includes('top')
          ? y + pad + fontPx / 2
          : vertical.includes('bottom')
            ? y + h - pad - blockHeight + fontPx / 2
            : y + (h - blockHeight) / 2 + fontPx / 2;

        if (info.shadow) {
          ctx.shadowColor = 'rgba(0,0,0,0.55)';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = z;
          ctx.shadowOffsetY = z;
        }

        ctx.fillStyle = info.color || cssVar('--text', '#ddd');
        if(info.bitmapLayout?.drawable || info.bitmapLayout?.ready){
          ctx.shadowColor='transparent';ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
          drawBitmapText(ctx,info.bitmapLayout,{x,y,w,h,align,vertical,shadow:info.shadow});
        } else if (info.fontBackend === 'resource-font-face' && info.state === 'ready') for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex];
          if (line) drawCoveredFontLine(ctx,line,info.fontCoverage,{x:tx,y:firstTy + lineIndex * lineHeight,fontPx,align});
        }

        ctx.restore();
      }
    }
    ctx.restore();
  }
  ctx.restore();

// Scrollbars (S047): render basic scroll_view scrollbars (best-effort).
try {
  const metaById =
    layout && layout.scrollMetaById && typeof layout.scrollMetaById === 'object'
      ? /** @type {any} */ (layout.scrollMetaById)
      : null;

  if (showGuides && metaById) {
    ctx.save();
    ctx.setLineDash([]);

    for (const k of Object.keys(metaById)) {
      const meta = metaById[k];
      if (!meta || !meta.viewport) continue;

      ctx.save();
      if (!applyDeviceViewportClip() || !applyWorldClip(meta)) {
        ctx.restore();
        continue;
      }

      const vp = meta.viewport;
      const maxY = Number(meta.maxScrollY) || 0;
      const maxX = Number(meta.maxScrollX) || 0;

      // Vertical scrollbar (right side).
      if (maxY > 0 && Number(vp.h) > 0 && Number(vp.w) > 0) {
        const pad = 2;
        const barW = Math.max(6, Math.min(12, Number(vp.w) * 0.02));
        const trackX = Number(vp.x) + Number(vp.w) - barW - pad;
        const trackY = Number(vp.y) + pad;
        const trackH = Math.max(0, Number(vp.h) - pad * 2);

        const contentH = Number(vp.h) + maxY;
        const ratio = contentH > 0 ? Number(vp.h) / contentH : 1;

        const minThumb = Math.min(trackH, Math.max(12, trackH * 0.15));
        const thumbH = Math.max(minThumb, trackH * ratio);

        const clampedY = Number(meta.clampedScrollY) || 0;
        const t = maxY > 0 ? clampedY / maxY : 0;
        const thumbY = trackY + t * (trackH - thumbH);

        const sx0 = sx(trackX);
        const sy0 = sy(trackY);

        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = border;
        ctx.fillRect(Math.round(sx0), Math.round(sy0), Math.round(barW * z), Math.round(trackH * z));
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = focus;
        ctx.fillRect(Math.round(sx(trackX)), Math.round(sy(thumbY)), Math.round(barW * z), Math.round(thumbH * z));
        ctx.restore();
      }

      // Horizontal scrollbar (bottom).
      if (maxX > 0 && Number(vp.h) > 0 && Number(vp.w) > 0) {
        const pad = 2;
        const barH = Math.max(6, Math.min(12, Number(vp.h) * 0.02));
        const trackX = Number(vp.x) + pad;
        const trackY = Number(vp.y) + Number(vp.h) - barH - pad;
        const trackW = Math.max(0, Number(vp.w) - pad * 2);

        const contentW = Number(vp.w) + maxX;
        const ratio = contentW > 0 ? Number(vp.w) / contentW : 1;

        const minThumb = Math.min(trackW, Math.max(12, trackW * 0.15));
        const thumbW = Math.max(minThumb, trackW * ratio);

        const clampedX = Number(meta.clampedScrollX) || 0;
        const t = maxX > 0 ? clampedX / maxX : 0;
        const thumbX = trackX + t * (trackW - thumbW);

        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = border;
        ctx.fillRect(Math.round(sx(trackX)), Math.round(sy(trackY)), Math.round(trackW * z), Math.round(barH * z));
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = focus;
        ctx.fillRect(Math.round(sx(thumbX)), Math.round(sy(trackY)), Math.round(thumbW * z), Math.round(barH * z));
        ctx.restore();
      }
      ctx.restore();
    }

    ctx.restore();
  }
} catch {}

  // Draw selected last.
  let selectedBox = null;
  if (selectedId) {
    selectedBox = boxes.find((b) => String(b.id) === selectedId) || null;
  }

  if (showGuides && selectedBox) {
    const x = sx(Number(selectedBox.x) || 0);
    const y = sy(Number(selectedBox.y) || 0);
    const w = (Number(selectedBox.w) || 0) * z;
    const h = (Number(selectedBox.h) || 0) * z;

    ctx.save();
    const canDrawSelection = applyDeviceViewportClip() && applyWorldClip(selectedBox);
    ctx.strokeStyle = focus;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    if (canDrawSelection) {
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    }
    ctx.restore();
  }

  const showResizeHandles = Boolean(selection && selection.showResizeHandles);
  if (showGuides && showResizeHandles && selectedBox) {
    const handlePx = selection && typeof selection.handlePx === 'number' ? selection.handlePx : undefined;
    const handles = getResizeHandlesForBox(selectedBox, view, { handlePx });

    ctx.save();
    const canDrawHandles = applyDeviceViewportClip() && applyWorldClip(selectedBox);
    ctx.fillStyle = focus;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (const h of canDrawHandles ? handles : []) {
      const hx = sx(Number(h.x) || 0);
      const hy = sy(Number(h.y) || 0);
      const hw = (Number(h.w) || 0) * z;
      const hh = (Number(h.h) || 0) * z;
      ctx.fillRect(Math.round(hx), Math.round(hy), Math.round(hw), Math.round(hh));
      ctx.strokeRect(Math.round(hx) + 0.5, Math.round(hy) + 0.5, Math.round(hw), Math.round(hh));
    }
    ctx.restore();
  }
}
import { drawBitmapText } from './bitmap-font.js';
import { drawCoveredFontLine } from './font-coverage-preview.js';
