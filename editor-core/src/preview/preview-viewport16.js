/** Physical output pixels and Bedrock logical UI coordinates are distinct.
 * Shared by the browser viewport and CLI PNG; no DOM or resource I/O. */
import { inferObservedUiScale } from './canvas-preview.js';

export const DEFAULT_CLASSIC_UI_SCALE = 4;
export function activeClassicUiScale({ mode = 'auto', manualUiScale, observedUiScale } = {}) {
  const value = mode === 'manual' ? manualUiScale : observedUiScale;
  return Math.max(1, Math.min(8, Math.round(Number(value) || DEFAULT_CLASSIC_UI_SCALE)));
}
export function logicalCanvasPreset(devicePreset, scale = DEFAULT_CLASSIC_UI_SCALE) {
  const uiScale = activeClassicUiScale({ mode: 'manual', manualUiScale: scale });
  return { width: devicePreset.width / uiScale, height: devicePreset.height / uiScale,
    name: `${devicePreset.width}x${devicePreset.height}-classic-${uiScale}x-logical` };
}
export function inferPackUiScaleFromBuildInfo(buildInfo) {
  const rows = Array.isArray(buildInfo?.ratio_classes) ? buildInfo.ratio_classes : [];
  const scales = rows.map(row => inferObservedUiScale({
    logicalWidth: Array.isArray(row?.logical) ? row.logical[0] : null,
    logicalHeight: Array.isArray(row?.logical) ? row.logical[1] : null,
    observedWidth: Array.isArray(row?.observed?.pixels) ? row.observed.pixels[0] : null,
    observedHeight: Array.isArray(row?.observed?.pixels) ? row.observed.pixels[1] : null,
  }, DEFAULT_CLASSIC_UI_SCALE)).filter(Number.isFinite);
  if (!scales.length) return DEFAULT_CLASSIC_UI_SCALE;
  scales.sort((a, b) => a - b);
  return activeClassicUiScale({ observedUiScale: scales[Math.floor(scales.length / 2)] });
}
