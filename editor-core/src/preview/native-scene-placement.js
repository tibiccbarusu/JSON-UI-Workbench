/**
 * Classic horse placement calibrated from the supplied device capture.
 * This is an observed preview profile, not a claim about every native renderer.
 * The small horse custom control locates the feet at its centre; it is not the
 * complete model bounds. Its observed model height is approximately 2 controls.
 */
export const CLASSIC_HORSE_PLACEMENT_PROFILE = 'observed-classic-horse-feet-v1';

export function resolveNativeScenePlacement(scene, destination) {
  try {
    const { x, y, w, h } = destination;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    const observedHorse = scene?.kind === 'horse'
      && scene.presentationProfile === CLASSIC_HORSE_PLACEMENT_PROFILE;
    // The stock 30x30 live-player control locates a body in its 52x70 panel;
    // it is not the complete body bounds. Keep the ratio invariant under zoom.
    const classicPlayer = scene?.kind === 'player'
      && scene.presentationProfile === 'classic-player-panel-v2';
    const multiplier = classicPlayer ? 2.2 : observedHorse ? 2 : scene?.kind === 'horse' ? 3.25 : 1;
    const extent = Math.min(Math.max(1, w * multiplier), Math.max(1, h * multiplier));
    let bottom = 0.5;
    if (observedHorse) {
      const faces = scene.faces;
      if (!Array.isArray(faces) || faces.length < 1 || faces.length > 8192) return null;
      bottom = -Infinity;
      for (const face of faces) {
        if (!Array.isArray(face?.points) || face.points.length !== 4) return null;
        for (const point of face.points) {
          const minY = scene.motionApplied === true ? -4 : 0;
          const maxY = scene.motionApplied === true ? 4 : 1;
          if (!Number.isFinite(point?.y) || point.y < minY || point.y > maxY) return null;
          bottom = Math.max(bottom, point.y);
        }
      }
      // A bounded camera turn preserves the base model's scale and anchor.
      // Refitting each pose would make an animal expand/shrink as it turns.
      if (scene.motionApplied === true) {
        if (!Number.isFinite(scene.motionAnchorY) || scene.motionAnchorY < -4 || scene.motionAnchorY > 4) return null;
        bottom = scene.motionAnchorY;
      }
    }
    const result = { x: x + w / 2 - extent / 2, y: y + h / 2 - extent * bottom + (classicPlayer ? h * .45 : 0), extent };
    // 入力が有限でも拡大・加算で overflow し得る。最終配置まで検証する。
    return [result.x, result.y, result.extent].every(Number.isFinite) && result.extent > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * The camera keeps the original model scale as it turns, so projected faces
 * can extend outside the original [0, 1] normalization square. This rectangle
 * covers those pixels without refitting the model. Keep the original square
 * as a minimum so unchanged scenes retain their previous raster sampling.
 * Limits match the final Canvas face boundary; invalid input fails closed.
 */
export function resolveNativeSceneRasterBounds(scene, destination, placement = resolveNativeScenePlacement(scene, destination)) {
  try {
    if (!placement || ![placement.x, placement.y, placement.extent].every(Number.isFinite) || placement.extent <= 0) return null;
    const faces = scene?.faces;
    if (!Array.isArray(faces) || faces.length < 1 || faces.length > 8192) return null;
    let minX = 0, minY = 0, maxX = 1, maxY = 1;
    for (const face of faces) {
      if (!Array.isArray(face?.points) || face.points.length !== 4) return null;
      for (const point of face.points) {
        const x = point?.x, y = point?.y;
        if (![x, y].every(Number.isFinite) || Math.abs(x) > 4 || Math.abs(y) > 4) return null;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    // Expand by whole scratch pixels relative to the original origin. A
    // fractional shift here would resample every old face just to add an edge.
    const left = Math.floor(minX * placement.extent), top = Math.floor(minY * placement.extent);
    const right = Math.ceil(maxX * placement.extent), bottom = Math.ceil(maxY * placement.extent);
    const result = { x: placement.x + left - 1, y: placement.y + top - 1,
      w: right - left + 2, h: bottom - top + 2 };
    return [result.x, result.y, result.w, result.h].every(Number.isFinite) && result.w > 0 && result.h > 0 ? result : null;
  } catch { return null; }
}
