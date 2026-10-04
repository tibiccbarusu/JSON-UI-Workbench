/**
 * 描画ボックスと操作対象を結ぶブラウザ/Node共用の純粋境界。
 * 装飾画像は入力を奪わず、無効な操作要素は背面へのクリックを遮断する。
 * モデルと配列が差し替わると弱参照キャッシュも自然に無効になる。
 */
import { compareCanvasPaintOrder } from './canvas-preview.js';

const modelIndexes = new WeakMap();
const layoutIndexes = new WeakMap();
const ACTIVE_TYPES = new Set(['button', 'edit_box', 'toggle', 'dropdown']);
const truthy = value => [true, 1, 'true', '1'].includes(value);
const falsey = value => [false, 0, 'false', '0'].includes(value);

function indexes(context) {
  const model = context.model;
  let nodes = model && modelIndexes.get(model);
  if (!nodes) {
    nodes = new Map();
    const stack = model?.root ? [model.root] : [], seen = new Set();
    while (stack.length && seen.size < 20000) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node); nodes.set(String(node.id), node);
      for (const child of node.children || []) if (child && typeof child === 'object') stack.push(child);
    }
    if (model && typeof model === 'object') modelIndexes.set(model, nodes);
  }
  const boxes = Array.isArray(context.boxes) ? context.boxes : [];
  let layout = layoutIndexes.get(boxes);
  if (!layout) {
    layout = new Map(boxes.filter(Boolean).map(box => [String(box.id), box]));
    layoutIndexes.set(boxes, layout);
  }
  return { nodes, layout };
}

function propsFor(context, id, nodes) {
  const node = nodes.get(id) || context.nodesById?.[id];
  const props = { ...node?.localVariables, ...node?.unknownProps, ...node?.props, ...context.nodesById?.[id]?.props, ...context.propsById?.[id] };
  return props;
}

/** 元モデルのbindings/localVariablesを失わずに描画用flat nodeへ対応づける。 */
export function getUiInteractionSourceNode(context = {}, nodeId) {
  return indexes(context).nodes.get(String(nodeId)) || context.nodesById?.[nodeId] || null;
}

/** 祖先の無効/非表示を合成し、子だけを操作可能にしない。 */
export function getUiInteractionEffectiveProps(context = {}, nodeId) {
  const { nodes, layout } = indexes(context), selectedId = String(nodeId ?? '');
  const output = propsFor(context, selectedId, nodes), seen = new Set();
  let id = selectedId;
  for (let depth = 0; id && depth < 128; depth += 1) {
    if (seen.has(id)) { output.enabled = false; break; }
    seen.add(id);
    const props = propsFor(context, id, nodes);
    if (props.enabled !== undefined && !truthy(props.enabled)) output.enabled = false;
    if (props.visible !== undefined && !truthy(props.visible)) output.visible = false;
    if (props.ignored !== undefined && !falsey(props.ignored)) output.ignored = true;
    id = layout.get(id)?.parentId == null ? '' : String(layout.get(id).parentId);
  }
  return output;
}

function isActionOwner(node, props) {
  let mappings = props.button_mappings;
  const seen = new Set();
  // 同じ有界なlexical alias契約をengineと共有する。$button_mappingsを
  //持つ入力panelを、hit段階だけで装飾扱いして取りこぼさない。
  for (let depth = 0; typeof mappings === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(mappings) && depth < 32; depth += 1) {
    if (seen.has(mappings)) break;
    seen.add(mappings);
    mappings = Object.hasOwn(props, mappings) ? props[mappings] : props[`${mappings}|default`];
  }
  return ACTIVE_TYPES.has(node?.type) || (['input_panel', 'panel'].includes(node?.type) && Array.isArray(mappings) && mappings.length > 0);
}

/** wantedTypeを省略するとtoggle・明示mapping付きpanelも同じ経路で返す。 */
export function findUiInteractionTarget(context = {}, hit, wantedType = null) {
  if (!hit) return null;
  const { nodes, layout } = indexes(context), seen = new Set();
  let id = String(hit.id);
  for (let depth = 0; id && depth < 128; depth += 1) {
    if (seen.has(id)) return null;
    seen.add(id);
    const node = nodes.get(id) || context.nodesById?.[id], props = propsFor(context, id, nodes);
    if (node && (wantedType ? node.type === wantedType : isActionOwner(node, props))) {
      return { node, effectiveProps: getUiInteractionEffectiveProps(context, id), box: layout.get(id) || hit };
    }
    id = layout.get(id)?.parentId == null ? '' : String(layout.get(id).parentId);
  }
  return null;
}

/** CSS座標から変換済みのworld座標を受け取る。DPRを二重に掛けない。 */
export function hitTestUiInteraction(context = {}, worldX, worldY, viewport = null) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  if (viewport && (worldX < 0 || worldY < 0 || worldX > viewport.width || worldY > viewport.height)) return null;
  const { nodes } = indexes(context);
  let best = null;
  for (const box of context.boxes || []) {
    if (!box || !(box.w > 0 && box.h > 0) || worldX < box.x || worldY < box.y || worldX > box.x + box.w || worldY > box.y + box.h) continue;
    const clip = box.clipRect;
    if (clip && (worldX < clip.x || worldY < clip.y || worldX > clip.x + clip.w || worldY > clip.y + clip.h)) continue;
    const node = nodes.get(String(box.id)) || context.nodesById?.[box.id];
    if (!isActionOwner(node, propsFor(context, String(box.id), nodes))) continue;
    const props = getUiInteractionEffectiveProps(context, box.id);
    // enabled=falseは対象として返し、engine側の理由付き拒否へ送る。
    if (props.visible !== undefined && !truthy(props.visible) || props.ignored !== undefined && !falsey(props.ignored)) continue;
    if (!best || compareCanvasPaintOrder(box, best) > 0) best = box;
  }
  return best;
}
