/** UI instance + stable node ID の純粋な local toggle 状態。radio は同じ親の明示 group に限定。 */
const MAX_VALUES = 20_000;
const MAX_NODES = 50_000;
const MAX_STATE_NODE_DIAGNOSTICS = 256;
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
export const LOCAL_TOGGLE_UNKNOWN = '#__jsonui_unresolved_runtime_visibility__';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = (value, max = 1024) => typeof value === 'string' && value.length > 0 && value.length <= max
  && !/[\u0000-\u001f\u007f]/u.test(value) && !UNSAFE.has(value);
const own = (value, key) => {
  const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : null;
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const failure = (code, message) => ({ ok: false, error: { code, message } });
function copyValues(value, maxEntries) {
  if (!record(value)) return failure('LOCAL_TOGGLE_VALUES_INVALID', 'ローカル状態は要素 ID と真偽値の対応で指定してください。');
  const keys = Object.keys(value);
  if (keys.length > maxEntries) return failure('LOCAL_TOGGLE_STATE_LIMIT', 'ローカル状態の要素数が上限を超えています。');
  const values = Object.create(null);
  for (const key of keys) {
    const item = own(value, key);
    if (!validId(key) || typeof item !== 'boolean') return failure('LOCAL_TOGGLE_VALUES_INVALID', 'ローカル状態に不正な要素 ID または真偽値以外の値があります。');
    values[key] = item;
  }
  return { ok: true, values };
}

/** JSON/API の有界検査。失敗は result として返し、入力の getter は評価しない。 */
export function normalizeLocalToggleState(value, { instanceId, maxEntries = MAX_VALUES } = {}) {
  if (!validId(instanceId, 256)) return failure('LOCAL_TOGGLE_INSTANCE_INVALID', 'UI インスタンス ID が不正です。');
  if (value == null) return { ok: true, state: { version: 1, instanceId, revision: 0, values: Object.create(null) } };
  if (!record(value) || Object.keys(value).some(key => !['version', 'instanceId', 'revision', 'values'].includes(key))) return failure('LOCAL_TOGGLE_STATE_INVALID', 'ローカル状態の形式が不正です。');
  if (own(value, 'version') !== 1 || !Number.isSafeInteger(own(value, 'revision')) || own(value, 'revision') < 0) return failure('LOCAL_TOGGLE_STATE_INVALID', 'ローカル状態の版または更新番号が不正です。');
  if (own(value, 'instanceId') !== instanceId) return failure('LOCAL_TOGGLE_INSTANCE_MISMATCH', '別の UI インスタンスの状態は適用できません。');
  const copied = copyValues(own(value, 'values'), Math.min(MAX_VALUES, Math.max(1, Number.isSafeInteger(maxEntries) ? maxEntries : MAX_VALUES)));
  return copied.ok ? { ok: true, state: { version: 1, instanceId, revision: own(value, 'revision'), values: copied.values } } : copied;
}

/** 空状態の作成。構成不正時だけ code 付き Error を投げる。 */
export function createLocalToggleState(instanceId) {
  const result = normalizeLocalToggleState(null, { instanceId });
  if (result.ok) return result.state;
  throw Object.assign(new Error(result.error.message), { code: result.error.code });
}

/** instance/revision/既知 ID をすべて検査後に適用。入力を部分変更しない。 */
export function applyLocalTogglePatch(state, effect) {
  const normalized = normalizeLocalToggleState(state, { instanceId: own(state, 'instanceId') });
  if (!normalized.ok) return normalized;
  if (!record(effect) || own(effect, 'type') !== 'localTogglePatch') return failure('LOCAL_TOGGLE_PATCH_INVALID', '状態変更の形式が不正です。');
  if (own(effect, 'instanceId') !== normalized.state.instanceId) return failure('LOCAL_TOGGLE_INSTANCE_MISMATCH', '別の UI インスタンスへの状態変更を拒否しました。');
  if (own(effect, 'revision') !== normalized.state.revision) return failure('LOCAL_TOGGLE_REVISION_STALE', '画面更新前の操作です。最新の画面でもう一度操作してください。');
  if (normalized.state.revision >= Number.MAX_SAFE_INTEGER) return failure('LOCAL_TOGGLE_REVISION_LIMIT', '状態更新番号の上限に達しました。UI を開き直してください。');
  const patch = copyValues(own(effect, 'changes'), MAX_VALUES);
  if (!patch.ok) return patch;
  if (Object.keys(patch.values).some(id => !Object.hasOwn(normalized.state.values, id))) return failure('LOCAL_TOGGLE_NODE_UNKNOWN', '現在の UI に属さない状態変更を拒否しました。');
  return { ok: true, state: { ...normalized.state, revision: normalized.state.revision + 1, values: { ...normalized.state.values, ...patch.values } } };
}

function resolve(value, props) {
  const seen = new Set();
  for (let depth = 0; typeof value === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(value) && depth < 32; depth += 1) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    value = own(props, value) ?? own(props, `${value}|default`);
  }
  return value;
}
function propsFor(node, propsById, lexicalVariablesById) {
  return { ...node?.localVariables, ...lexicalVariablesById[node?.id], ...node?.unknownProps, ...node?.props, ...propsById[node?.id] };
}
function externalStateBinding(node, props) {
  for (const binding of Array.isArray(node.bindings) ? node.bindings.slice(0, 50_001) : []) {
    if (resolve(binding?.ignored, props) === true || resolve(binding?.binding_type, props) === 'none') continue;
    const target = resolve(binding?.binding_name_override ?? binding?.target_property_name ?? binding?.binding_name, props);
    if (target === '#toggle_state' || target === 'toggle_state') return true;
  }
  return false;
}
function diagnostic(nodeId, reason, message) {
  return { code: 'LOCAL_TOGGLE_STATE_UNRESOLVED', severity: 'warning', nodeId, property: 'toggle_state', reason, message };
}

/**
 * local 状態を初期化/復元して外部bindingを上書きしない値を返す。
 * 呼出側が overrides を propsById[id].toggle_state に view 評価前に適用する。
 */
export function initializeLocalToggleState(model, { propsById = {}, lexicalVariablesById = {}, uiInstanceId = 'static-preview', localToggleState } = {}) {
  const normalized = normalizeLocalToggleState(localToggleState, { instanceId: uiInstanceId });
  const nodes = new Map(), parentById = new Map(), controls = new Map(), diagnostics = [];
  const stack = model?.root ? [{ node: model.root, parentId: null }] : [], seen = new Set();
  let complete = true;
  while (stack.length && nodes.size < MAX_NODES) {
    const { node, parentId } = stack.pop();
    if (!node || seen.has(node) || !validId(node.id) || nodes.has(node.id)) { complete = false; continue; }
    seen.add(node); nodes.set(node.id, node); parentById.set(node.id, parentId);
    if (node.type === 'toggle') {
      const props = propsFor(node, propsById, lexicalVariablesById);
      controls.set(node.id, { node, id: node.id, parentId, props, external: externalStateBinding(node, props), radio: resolve(props.radio_toggle_group, props), group: resolve(props.toggle_name, props), index: resolve(props.toggle_group_forced_index, props), selected: resolve(props.toggle_group_default_selected, props), initial: resolve(props.toggle_default_state, props) });
    }
    for (const child of node.children || []) stack.push({ node: child, parentId: node.id });
  }
  if (stack.length) complete = false;
  const values = Object.create(null), overrides = Object.create(null), groups = new Map();
  const refuse = (item, reason, text) => { overrides[item.id] = LOCAL_TOGGLE_UNKNOWN; diagnostics.push(diagnostic(item.id, reason, text)); };
  const externalGroups = new Set([...controls.values()].filter(item => item.external).map(item => JSON.stringify([item.parentId, item.group])));
  for (const item of controls.values()) {
    if (item.external) continue;
    if (!complete || controls.size > MAX_VALUES) { refuse(item, 'MODEL_SCAN_INCOMPLETE', 'ローカル状態の探索が上限または不正な構造で完了していません。'); continue; }
    if (!normalized.ok) { refuse(item, normalized.error.code, normalized.error.message); continue; }
    if (item.radio !== undefined && typeof item.radio !== 'boolean') { refuse(item, 'RADIO_MODE_UNRESOLVED', '排他切替の指定を真偽値として確認できません。'); continue; }
    if (item.radio === true) {
      if (!validId(item.group, 256) || resolve(item.props.toggle_grid_collection_name, item.props)) { refuse(item, 'RADIO_SCOPE_UNSUPPORTED', '排他グループの範囲を確認できません。同じ親を持つ明示グループだけを扱います。'); continue; }
      const key = JSON.stringify([item.parentId, item.group]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    } else {
      const value = own(normalized.state.values, item.id) ?? item.initial;
      if (typeof value !== 'boolean') refuse(item, 'DEFAULT_STATE_UNRESOLVED', '切替の初期状態を真偽値として確認できません。');
      else { values[item.id] = value; overrides[item.id] = value; }
    }
  }
  for (const [key, members] of groups) {
    const first = members[0], hasExternalPeer = externalGroups.has(key);
    const saved = members.filter(item => Object.hasOwn(normalized.state.values, item.id));
    const indices = members.map(item => item.index);
    const indexed = indices.every(index => Number.isSafeInteger(index) && index >= 0);
    const selected = first.selected;
    const defaultMember = indexed && new Set(indices).size === members.length && Number.isSafeInteger(selected)
      && members.every(item => item.selected === selected) ? members.find(item => item.index === selected) : null;
    const savedValid = saved.length === members.length && saved.filter(item => normalized.state.values[item.id]).length === 1;
    const valid = !hasExternalPeer && defaultMember && (saved.length === 0 || savedValid);
    if (!valid) { for (const item of members) refuse(item, hasExternalPeer ? 'RADIO_EXTERNAL_PEER' : saved.length ? 'RADIO_SNAPSHOT_INVALID' : 'RADIO_DEFAULT_UNRESOLVED', '排他グループの番号・既定選択・保存状態が一意に整合しないため、選択状態を推定しません。'); continue; }
    const peerIds = members.map(member => member.id);
    for (const item of members) {
      const value = savedValid ? normalized.state.values[item.id] : item.id === defaultMember.id;
      values[item.id] = value; overrides[item.id] = value; item.peerIds = peerIds;
    }
  }
  // Draft evaluation retains supported values and prunes foreign/read-only
  // entries. Pruning is an approximation, however, so it must not silently
  // certify a misspelled or cross-projection snapshot as a complete input.
  // Membership is independent of current visibility: a hidden passive node
  // or an externally bound toggle still cannot own a local saved value.
  let stateNodeDiagnostics = 0;
  if (normalized.ok) for (const id of Object.keys(normalized.state.values)) {
    const item = controls.get(id);
    if (item && !item.external) continue;
    if (stateNodeDiagnostics < MAX_STATE_NODE_DIAGNOSTICS) {
      diagnostics.push(diagnostic(id, item?.external ? 'STATE_NODE_READONLY' : 'STATE_NODE_UNKNOWN',
        item?.external ? '外部 binding が所有する切替へローカル保存状態を適用できません。'
          : 'ローカル保存状態の要素 ID が現在の切替要素にありません。要素 ID と選択した投影を確認してください。'));
    } else if (stateNodeDiagnostics === MAX_STATE_NODE_DIAGNOSTICS) {
      diagnostics.push(diagnostic(model?.root?.id || 'local-state', 'STATE_NODE_DIAGNOSTIC_LIMIT',
        `ローカル保存状態の要素 ID 診断が ${MAX_STATE_NODE_DIAGNOSTICS} 件の上限を超えたため、観測は不完全です。`));
      complete = false;
    }
    stateNodeDiagnostics++;
  }
  const state = normalized.ok ? { ...normalized.state, values } : null;
  return { state, overrides, diagnostics, controls, parentById, nodes, complete };
}

/** 現在のscopeを検査し、同一instanceだけに適用できるeffectを返す。 */
export function resolveLocalToggleInteraction(options = {}) {
  const { node, model, propsById = {}, uiInstanceId, localToggleState } = options;
  const reject = (status, code, text) => ({ status, effects: [], diagnostics: [{ code, severity: 'info', message: text }] });
  if (!validId(uiInstanceId, 256) || !model?.root || !localToggleState) return reject('unsupported', 'INTERACTION_TOGGLE_BINDING_UNRESOLVED', '切替には現在の UI インスタンスと状態が必要です。画面を再表示してください。');
  const normalized = normalizeLocalToggleState(localToggleState, { instanceId: uiInstanceId });
  if (!normalized.ok) return reject('blocked', normalized.error.code, normalized.error.message);
  const initialized = initializeLocalToggleState(model, { propsById, uiInstanceId, localToggleState });
  const item = initialized.controls.get(node?.id);
  if (!item || item.external || typeof initialized.state?.values[node.id] !== 'boolean') return reject('unsupported', 'INTERACTION_LOCAL_TOGGLE_UNRESOLVED', 'この要素のローカル状態または排他グループを確認できません。');
  let cursor = node.id;
  for (let depth = 0; cursor && depth < 128; depth += 1) {
    const props = propsFor(initialized.nodes.get(cursor), propsById, {});
    if (['visible', 'enabled'].some(key => props[key] !== undefined && ![true, 1, 'true', '1'].includes(props[key]))
      || props.ignored !== undefined && ![false, 0, 'false', '0'].includes(props.ignored)) return reject('blocked', 'INTERACTION_CONTROL_DISABLED', 'この要素または祖先は無効または非表示です。');
    cursor = initialized.parentById.get(cursor);
    if (depth === 127 && cursor) return reject('blocked', 'INTERACTION_ANCESTOR_LIMIT', '祖先の状態を確認できる上限を超えています。');
  }
  const box = options.box;
  if (box && (!(box.w > 0 && box.h > 0) || box.clipRect && (!(box.clipRect.w > 0 && box.clipRect.h > 0)
    || box.x + box.w <= box.clipRect.x || box.y + box.h <= box.clipRect.y || box.x >= box.clipRect.x + box.clipRect.w || box.y >= box.clipRect.y + box.clipRect.h))) return reject('blocked', 'INTERACTION_CONTROL_CLIPPED', 'この要素は表示範囲外です。');
  const requested = options.action === 'toggle.toggle_on' ? true : options.action === 'toggle.toggle_off' ? false : null;
  if (item.radio && requested === false) return reject('blocked', 'INTERACTION_RADIO_OFF_UNCONFIRMED', '排他グループを未選択にせず、別の項目を選択してください。');
  const before = Object.create(null), changes = Object.create(null);
  for (const id of item.peerIds || [item.id]) {
    before[id] = initialized.state.values[id];
    changes[id] = item.radio ? id === item.id : requested ?? !before[id];
  }
  return { status: 'applied', effects: [{ type: 'localTogglePatch', instanceId: uiInstanceId, revision: initialized.state.revision, changes }], diagnostics: [{ code: 'INTERACTION_LOCAL_TOGGLE_PREVIEW_ONLY', severity: 'info', message: '同じ UI インスタンスのローカル選択状態を更新しました。' }], localTransition: { instanceId: uiInstanceId, nodeId: item.id, parentId: item.parentId, group: item.radio ? item.group : null, before, after: changes } };
}
