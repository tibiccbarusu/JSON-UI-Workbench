/** JSON UI補間用。関数はplanに含めず、Node/ブラウザが同じ名前を評価する。 */
const bounceOut = (t) => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) { const x = t - 1.5 / d; return n * x * x + 0.75; }
  if (t < 2.5 / d) { const x = t - 2.25 / d; return n * x * x + 0.9375; }
  const x = t - 2.625 / d; return n * x * x + 0.984375;
};
const definitions = {
  linear: (t) => t,
  in_sine: (t) => 1 - Math.cos(t * Math.PI / 2),
  in_expo: (t) => t === 0 ? 0 : 2 ** (10 * t - 10),
  in_circ: (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t)),
  in_back: (t) => 2.70158 * t ** 3 - 1.70158 * t * t,
  in_elastic: (t) => t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3)),
  out_bounce: bounceOut,
};
for (const [name, power] of [['quad', 2], ['cubic', 3], ['quart', 4], ['quint', 5]]) definitions[`in_${name}`] = (t) => t ** power;
for (const name of ['quad', 'cubic', 'quart', 'quint', 'sine', 'expo', 'circ', 'back', 'elastic', 'bounce']) {
  if (!definitions[`in_${name}`]) definitions[`in_${name}`] = (t) => 1 - definitions[`out_${name}`](1 - t);
  if (!definitions[`out_${name}`]) definitions[`out_${name}`] = (t) => 1 - definitions[`in_${name}`](1 - t);
  definitions[`in_out_${name}`] = (t) => t < 0.5 ? definitions[`in_${name}`](2 * t) / 2 : 1 - definitions[`in_${name}`](2 - 2 * t) / 2;
}
// Back/elastic have dedicated in-out curves; simply scaling the in curve
// changes the overshoot/oscillation period and produces a different motion.
definitions.in_out_back = (t) => {
  const c = 1.70158 * 1.525;
  return t < 0.5 ? (2 * t) ** 2 * ((c + 1) * 2 * t - c) / 2 : ((2 * t - 2) ** 2 * ((c + 1) * (2 * t - 2) + c) + 2) / 2;
};
definitions.in_out_elastic = (t) => {
  if (t === 0 || t === 1) return t;
  const s = Math.sin((20 * t - 11.125) * (2 * Math.PI / 4.5));
  return t < 0.5 ? -(2 ** (20 * t - 10) * s) / 2 : (2 ** (-20 * t + 10) * s) / 2 + 1;
};
export const PREVIEW_ANIMATION_EASING_NAMES = Object.freeze(Object.keys(definitions));
export const PREVIEW_ANIMATION_EASINGS = Object.freeze(definitions);
