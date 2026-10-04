/** Shared whole-image fit geometry. Units are supplied by the caller: logical
 * for evidence, zoomed canvas coordinates for drawing. Never changes hit boxes. */
export function computeImageFitRect41(source, box, keepRatio = true, fill = false) {
  if (!source || !box || ![source.w, source.h, box.x, box.y, box.w, box.h].every(Number.isFinite)
    || source.w <= 0 || source.h <= 0 || box.w <= 0 || box.h <= 0) return null;
  if (!keepRatio || fill) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const scale = Math.min(box.w / source.w, box.h / source.h);
  const w = source.w * scale, h = source.h * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
