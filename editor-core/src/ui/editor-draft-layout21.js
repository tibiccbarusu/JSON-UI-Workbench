// ブラウザー ESM。確定した Node 配置に軽量な草稿だけを重ね、解釈やレイアウトを再実行しない。
import { applyPendingGeometry21 } from './editor-draft-geometry21.js';
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const emptyTransform = Object.freeze({ dx: 0, dy: 0, dlayer: 0, hidden: false });

function draftError(code, message) { throw Object.assign(new TypeError(message), { code }); }
function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) draftError('EDITOR_DRAFT_NONFINITE', `${label} は有限な数値で指定してください。`);
  return value;
}
function addFinite(left, right, label) { return finiteNumber(left + right, label); }
function draftComponent(change, key) { return hasOwn(change, key) ? finiteNumber(change[key], key) : 0; }
function mapValue(source, id) {
  if (source instanceof Map) return source.get(id);
  return source && hasOwn(source, id) ? source[id] : undefined;
}
function idText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!['string', 'number'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) draftError('EDITOR_DRAFT_NODE_INVALID', '配置の要素 ID は文字列または有限な数値で指定してください。');
  return String(value);
}

/** 割合・変数・式は評価せず、絶対値として読める offset だけを返す。 */
function absoluteOffset(value) {
  if (!Array.isArray(value)) return null;
  for (const component of value) if (typeof component === 'number') finiteNumber(component, 'offset');
  if (value.length !== 2) return null;
  const result = [];
  for (const component of value) {
    if (typeof component === 'number') { result.push(finiteNumber(component, 'offset')); continue; }
    if (typeof component !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/u.test(component.trim())) return null;
    result.push(finiteNumber(Number(component.trim().replace(/px$/u, '')), 'offset'));
  }
  return result;
}
function baselineOffset(id, context) {
  const overrides = mapValue(context.propsByIdOverride ?? context.nodeOverrides, id);
  const node = mapValue(context.nodesById, id), props = node?.props;
  // 確定layoutでは legacy x/y が offset より優先される。単純なoffset差分へ置き換えない。
  if (['x', 'y'].some(key => overrides && hasOwn(overrides, key) || props && hasOwn(props, key))) return null;
  if (overrides && hasOwn(overrides, 'offset')) return absoluteOffset(overrides.offset);
  if (props && hasOwn(props, 'offset')) return absoluteOffset(props.offset);
  // 解決済みnodeが既知でoffset省略なら、computeOffset / model既定と同じ[0,0]。
  // node自体が不明な場合は確定時の条件が分からないので推定しない。
  return node && typeof node === 'object' ? [0, 0] : null;
}
function numericSize(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  // mixed/symbolic size でも不正数値を隠さない。
  for (const component of value) if (typeof component === 'number') {
    finiteNumber(component, 'size');
    if (component < 0) draftError('EDITOR_DRAFT_SIZE_INVALID', 'size は 0 以上で指定してください。');
  }
  return value.every(component => typeof component === 'number') ? [value[0], value[1]] : null;
}
function localTransform(id, change, context, box) {
  if (change === null || change === undefined) return emptyTransform;
  if (typeof change !== 'object' || Array.isArray(change)) draftError('EDITOR_DRAFT_TRANSFORM_INVALID', '要素の草稿変換はオブジェクトで指定してください。');
  let dx = draftComponent(change, 'dx'), dy = draftComponent(change, 'dy');
  const properties = change.properties;
  if (properties && hasOwn(properties, 'offset')) {
    const before = baselineOffset(id, context), after = absoluteOffset(properties.offset);
    // 絶対 offset の差分が不明なら後続 delta も旧位置へ仮適用しない。
    if (before && after) {
      dx = addFinite(finiteNumber(after[0] - before[0], 'offset 差分'), dx, '草稿の横移動');
      dy = addFinite(finiteNumber(after[1] - before[1], 'offset 差分'), dy, '草稿の縦移動');
    } else { dx = 0; dy = 0; }
  }
  const dlayer = properties && hasOwn(properties, 'layer') ? finiteNumber(properties.layer, 'layer') - finiteNumber(box.layer ?? 0, '確定 layer') : 0;
  return { dx, dy, dlayer: finiteNumber(dlayer, '重なり順の差分'), hidden: change.deleted === true || properties?.visible === false };
}

/**
 * 親子の未反映移動を合算する。入力は変更しない。
 * @param {object} layout 確定済みの boxes / clipRect を持つ配置。
 * @param {Map<string, object>} transforms キューが返す dx/dy/deleted/properties。
 * @param {{nodesById?: object|Map, propsByIdOverride?: object|Map, nodeOverrides?: object|Map}} context
 *   propsByIdOverride は草稿を重ねる前の評価済み属性。nodeOverrides は同義の別名。
 * @returns {object} 草稿配置。由来を確認できる祖先clipだけをbox移動に追従させる。
 */
export function applyPendingLayout21(layout, transforms = new Map(), context = {}) {
  if (!layout || !Array.isArray(layout.boxes) || !layout.boxes.length) return layout;
  if (!(transforms instanceof Map)) draftError('EDITOR_DRAFT_TRANSFORMS_INVALID', '草稿の変換には Map を指定してください。');
  if (!transforms.size) return layout;
  if (!context || typeof context !== 'object') draftError('EDITOR_DRAFT_CONTEXT_INVALID', '確定属性の参照情報が不正です。');

  const parents = new Map(), locals = new Map(), accumulated = new Map();
  for (const box of layout.boxes) {
    const id = idText(box?.id);
    if (id === null || parents.has(id)) draftError('EDITOR_DRAFT_NODE_INVALID', '配置の要素 ID が空または重複しています。');
    for (const key of ['x', 'y', 'w', 'h']) finiteNumber(box[key], `配置の ${key}`);
    parents.set(id, idText(box.parentId));
    locals.set(id, localTransform(id, transforms.get(id), context, box));
  }

  // 明示スタックとメモ化で深い階層を線形に処理し、循環を検出して停止する。
  for (const start of parents.keys()) {
    if (accumulated.has(start)) continue;
    const trail = [], seen = new Set();
    let id = start;
    while (id !== null && parents.has(id) && !accumulated.has(id)) {
      if (seen.has(id)) draftError('EDITOR_DRAFT_PARENT_CYCLE', '配置の親子関係が循環しているため、草稿を表示できません。');
      seen.add(id); trail.push(id); id = parents.get(id);
    }
    let inherited = accumulated.get(id) || emptyTransform;
    for (let index = trail.length - 1; index >= 0; index--) {
      const current = trail[index], local = locals.get(current);
      inherited = { dx: addFinite(inherited.dx, local.dx, '親子の横移動'), dy: addFinite(inherited.dy, local.dy, '親子の縦移動'), dlayer: addFinite(inherited.dlayer, local.dlayer, '親子の重なり順'), hidden: inherited.hidden || local.hidden };
      accumulated.set(current, inherited);
    }
  }

  const boxes = [];
  for (const box of layout.boxes) {
    const id = String(box.id), applied = accumulated.get(id);
    if (applied.hidden) continue;
    const change = transforms.get(id), size = numericSize(change?.properties?.size);
    const next = { ...box, x: addFinite(box.x, applied.dx, '草稿の x'), y: addFinite(box.y, applied.dy, '草稿の y') };
    if (size) { next.w = size[0]; next.h = size[1]; }
    if (change?.properties && hasOwn(change.properties, 'layer')) next.layer = finiteNumber(change.properties.layer, '草稿 layer');
    if (applied.dlayer) next.effectiveLayer = addFinite(box.effectiveLayer ?? box.layer ?? 0, applied.dlayer, '草稿の累積 layer');
    // 元clipをまず保持し、後段で元propsと一致する祖先clipだけ再交差する。
    if (box.clipRect && typeof box.clipRect === 'object') next.clipRect = { ...box.clipRect };
    boxes.push(next);
  }
  return applyPendingGeometry21(layout, boxes, context);
}

/** 草稿属性だけを重ねる。確定属性・属性配列を変更せず、特殊な ID もデータとして保持する。 */
export function mergePendingProperties21(overrides, transforms = new Map()) {
  if (!(transforms instanceof Map)) draftError('EDITOR_DRAFT_TRANSFORMS_INVALID', '草稿の変換には Map を指定してください。');
  if (!transforms.size) return overrides;
  const output = overrides instanceof Map ? Object.fromEntries(overrides) : { ...(overrides || {}) };
  for (const [id, change] of transforms) if (change?.properties) {
    Object.defineProperty(output, String(id), { value: { ...(mapValue(overrides, id) || {}), ...change.properties }, enumerable: true, writable: true, configurable: true });
  }
  return output;
}

/** ドラッグの差分。空文字・null・数値文字列から暗黙変換しない。 */
export function movementDelta21(start, end) {
  return ['x', 'y'].map(axis => {
    const value = finiteNumber(finiteNumber(end?.[axis], `終了 ${axis}`) - finiteNumber(start?.[axis], `開始 ${axis}`), '移動差分');
    // 1000 倍が overflow するほど大きい有限値は、不要な丸めを避ける。
    return Math.abs(value) <= Number.MAX_VALUE / 1000 ? Math.round(value * 1000) / 1000 : value;
  });
}
