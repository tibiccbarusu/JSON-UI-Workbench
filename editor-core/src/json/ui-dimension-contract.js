/** ブラウザ/Node 共通の純粋 ESM。寸法の固定数値文字列だけを識別する。 */
const DIMENSION_PROPERTIES = new Set(['offset', 'size', 'min_size', 'max_size']);
const UNITLESS_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

// 数値 JSON と文字列の文法を混同しない。%/px/$変数/@animation/式は対象外。
export function isUnitlessDimensionNumber(value) {
  return typeof value === 'string' && UNITLESS_NUMBER.test(value.trim());
}

/** 既存のベクトル形状検査と併用する。uv/uv_size や一般 text は検査しない。 */
export function unitlessDimensionComponents(property, value) {
  if (!DIMENSION_PROPERTIES.has(property)) return [];
  if (isUnitlessDimensionNumber(value)) return [null];
  if (!Array.isArray(value)) return [];
  const indices = [];
  for (let index = 0; index < Math.min(value.length, 2); index++) {
    if (isUnitlessDimensionNumber(value[index])) indices.push(index);
  }
  return indices;
}
