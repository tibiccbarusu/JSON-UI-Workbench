/** R31: 配置の操作本体を限定する。JSON原文・プレビュー状態は変更しない。 */
import { pointerParts, pointerJoin, editFail } from './workspace-jsonc.mjs';
export const TARGET_POLICY_VERSION31 = 'bounded-functional-owner-31.1';
const types = new Set(['button', 'edit_box', 'toggle', 'slider', 'dropdown']);
const decorative = new Set(['image', 'label', 'panel', 'stack_panel']);
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const at = (v, p) => pointerParts(p).reduce((v, k) => v?.[k], v);
const scans = new WeakMap();
function parent(p, sources) {
  const parts = pointerParts(p);
  while (parts.length) { parts.pop(); const next = pointerJoin(parts); if (sources[next]) return next; }
  return null;
}
function unresolvedChildren(value) {
  if (value?.factory) return true;
  const controls = value?.controls;
  if (controls === undefined) return false;
  if (Array.isArray(controls)) return controls.some(c => !object(c) || Object.values(c).some(v => !object(v)));
  return !object(controls) || Object.values(controls).some(v => !object(v));
}
function children(value) {
  const controls = value?.controls;
  return Array.isArray(controls) ? controls.flatMap(c => object(c) ? Object.values(c).filter(object) : [])
    : object(controls) ? Object.values(controls).filter(object) : [];
}
/** 限定走査。予算切れを「入力がない」と読み替えない。projectionごとに再利用。 */
function describe(projection, pointer) {
  let cache = scans.get(projection); if (!cache) { cache = new Map(); scans.set(projection, cache); }
  if (cache.has(pointer)) return cache.get(pointer);
  const root = at(projection.document, pointer);
  const stack = children(root).map(value => ({ value, nested: false }));
  const result = { nodes: 1, nestedPanels: 0, controls: 0, buttons: 0, collections: new Set(), slotAction: false, incomplete: unresolvedChildren(root) };
  while (stack.length) {
    if (result.nodes >= 4096) { result.incomplete = true; break; }
    const { value, nested } = stack.pop(); result.nodes++;
    if (value.ignored === true) continue;
    if (unresolvedChildren(value)) result.incomplete = true;
    if (value.type === 'input_panel') result.nestedPanels++;
    if (types.has(value.type) && !nested) { result.controls++; if (value.type === 'button') result.buttons++; }
    for (const b of Array.isArray(value.bindings) ? value.bindings : []) {
      if (typeof b.binding_collection_name === 'string' && b.binding_collection_name) result.collections.add(b.binding_collection_name);
    }
    for (const m of Array.isArray(value.button_mappings) ? value.button_mappings : []) {
      if (typeof m.to_button_id === 'string' && /^button\.(?:container|anvil|inventory)_take_(?:all|half)_place_(?:all|one)$/.test(m.to_button_id)) result.slotAction = true;
    }
    stack.push(...children(value).map(child => ({ value: child, nested: nested || types.has(value.type) })));
  }
  cache.set(pointer, result); return result;
}
function ownMappings(value) { return Array.isArray(value?.button_mappings) ? value.button_mappings : []; }
function panelRole(projection, pointer) {
  const value = at(projection.document, pointer), s = describe(projection, pointer), mappings = ownMappings(value);
  const routing = mappings.some(m => m.to_button_id === 'button.container_reset_held')
    || mappings.some(m => m.mapping_type === 'global') && (s.controls > 0 || s.nestedPanels > 0);
  // 入力の複数単位を包含する祖先は、選択した装飾から自動で変更しない。
  if (routing || s.nestedPanels > 0 || s.controls > 1) return { kind: 'boundary', stats: s };
  if (s.incomplete) return { kind: 'unknown', stats: s };
  const slotDefault = ['common.container_slot_button_prototype', 'anvil.anvil_output_slot_button'].includes(value.$button_ref || value['$button_ref|default']);
  const collection = value.$item_collection_name || value['$item_collection_name|default'];
  const generated = projection.nodeSources[pointer]?.generated;
  if (s.buttons === 1 && (s.slotAction || slotDefault || typeof collection === 'string' && collection.length > 0
    || s.collections.size === 1 || generated === 'grid')) return { kind: 'slot', stats: s };
  if (s.controls === 0 && mappings.some(m => typeof m.to_button_id === 'string' && m.mapping_type !== 'global')) return { kind: 'local-input', stats: s };
  return { kind: 'unknown', stats: s };
}
function ambiguous(pointer, candidate, reason) {
  editFail('EDIT_INTERACTION_TARGET_AMBIGUOUS',
    'この要素の機能範囲を一意に確定できません。共通の親へ自動移動せず停止しました。要素一覧で動かしたいボタン／パネル本体を直接選択するか、装飾だけなら「見た目の部品だけ」を明示してください。',
    pointer, { candidate, reason, policy: TARGET_POLICY_VERSION31 });
}
function decorativeAtBoundary(projection, selected, boundary) {
  const value = at(projection.document, selected), scan = describe(projection, selected);
  if (!decorative.has(value?.type) || scan.incomplete || scan.controls || scan.nestedPanels || ownMappings(value).length
    || value.always_handle_pointer === true || value.gesture_tracking_button) ambiguous(selected, boundary, 'unproven-decoration');
  // 経路上の独自入力・データ項目との結合は、機能がないと誤認しない。
  for (let p = selected; p && p !== boundary; p = parent(p, projection.nodeSources)) {
    const item = at(projection.document, p);
    if (ownMappings(item).length || (Array.isArray(item?.bindings) && item.bindings.some(b => b.binding_type === 'collection' || b.binding_type === 'collection_details'))) {
      ambiguous(selected, boundary, 'path-has-interaction-or-collection');
    }
  }
  return { effectivePointer: selected, decision: 'decoration-within-routing-boundary',
    reason: 'この表示部品を移動します。画面共通の入力パネルへの自動拡大は行いません。', boundary, stats: scan };
}
export function chooseInteractionTarget31(projection, operation, isTransform) {
  const selected = operation.effectivePointer, value = at(projection.document, selected);
  if (operation.targetMode !== 'interaction' || !isTransform) return { effectivePointer: selected, decision: 'selected-visual', reason: '選択した表示要素を編集します。' };
  // 親自身を直接指定した操作と、子からの自動昇格を区別する。
  if (types.has(value?.type) || value?.type === 'input_panel' || value?.type === 'screen') {
    return { effectivePointer: selected, decision: 'explicit-owner', reason: '直接選択した操作本体と、その配下を同じ単位で編集します。' };
  }
  for (let p = parent(selected, projection.nodeSources); p; p = parent(p, projection.nodeSources)) {
    const candidate = at(projection.document, p);
    if (types.has(candidate?.type)) return { effectivePointer: p, decision: 'local-control',
      reason: '操作本体と通常・ホバー・押下などの子要素を同じ単位で編集します。' };
    if (candidate?.type === 'input_panel') {
      const role = panelRole(projection, p);
      if (role.kind === 'boundary') return decorativeAtBoundary(projection, selected, p);
      if (role.kind === 'unknown') ambiguous(selected, p, 'unknown-input-panel');
      return { effectivePointer: p, decision: role.kind, stats: role.stats,
        reason: '入力パネルの背景・アイテム・状態表示・操作を同じ単位で編集します。' };
    }
    if (candidate?.type === 'screen') return decorativeAtBoundary(projection, selected, p);
  }
  return { effectivePointer: selected, decision: 'no-input-ancestor', reason: '操作を受ける祖先がないため、この表示要素を移動します。' };
}
