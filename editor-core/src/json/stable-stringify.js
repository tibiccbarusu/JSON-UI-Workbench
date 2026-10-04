/*
  Deterministic JSON serializer utilities.

  Goals (S019):
  - Always emit strict JSON (no comments).
  - Stable formatting (indent=2 by default).
  - Optional deep key sorting to make output deterministic across runs.
*/

/**
 * @typedef {{
 *  indent?: number,
 *  sortKeys?: boolean,
 *  finalNewline?: boolean,
 * }} StableStringifyOptions
 */

/**
 * Deep-sorts keys of plain objects only (arrays keep order).
 * This is used to make JSON.stringify output deterministic.
 *
 * @param {any} value
 * @returns {any}
 */
function deepSortKeys(value) {
  if (Array.isArray(value)) return value.map(deepSortKeys);

  if (!value || typeof value !== 'object') return value;

  // Keep non-plain objects untouched (Date, Map, etc.).
  const proto = Object.getPrototypeOf(value);
  const isPlain = proto === Object.prototype || proto === null;
  if (!isPlain) return value;

  /** @type {Record<string, any>} */
  // JSON keys such as __proto__ are data. Assigning them on {} would invoke
  // its inherited setter and silently omit the authored key from the output.
  const out = Object.create(null);
  const keys = Object.keys(value).sort();
  for (const k of keys) out[k] = deepSortKeys(value[k]);
  return out;
}

/**
 * Deterministic JSON stringify:
 * - Indent defaults to 2 spaces.
 * - Optional deep key sorting.
 * - Optionally adds a trailing newline.
 *
 * @param {any} value
 * @param {StableStringifyOptions} [opts]
 */
export function stableStringify(value, opts = {}) {
  const indent = Number.isFinite(opts.indent) ? Number(opts.indent) : 2;
  const sortKeys = Boolean(opts.sortKeys);
  const finalNewline = opts.finalNewline === undefined ? true : Boolean(opts.finalNewline);

  const normalized = sortKeys ? deepSortKeys(value) : value;
  const json = JSON.stringify(normalized, null, indent);
  return finalNewline ? `${json}\n` : json;
}
