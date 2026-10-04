/**
 * JSON UI の明示的な入力と、確認済みの有限な画面動作を結ぶ純粋アダプター。
 * ゲーム/ScriptAPIは実行しない。曖昧な画面名検索、未知actionのbinding代入を行わない。
 * 戻り値effectsを呼び出し側が一括適用する。入力objectは変更しない。
 */
import { resolveCollectionRowAddress, confirmCollectionRowAddress } from '../bindings/collection-context.js';
import { EMPTY_CLASSIC_SLOT_ROW } from '../engine/classic-empty-slots.js';
import { getUiInteractionSourceNode, getUiInteractionEffectiveProps } from './ui-interaction-target.js';
import { isStandardClassicRecipeBookScreen } from '../engine/representative-classic-runtime.js';
import { resolveNavigationMapping } from './screen-navigation.js';
import { resolveScopedUiAction, describeUnsupportedUiAction } from './ui-action-adapters.js';
import { resolveClipboardAdapter } from './ui-clipboard-adapters.js';
import { resolveLocalToggleInteraction } from './local-toggle-state.js';

const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const collectionAddressLayoutIndexes = new WeakMap();
const BINDING = /^#[A-Za-z0-9_:@.\-]{1,255}$/u;
const NAME = /^[A-Za-z0-9_:@.\-]{1,256}$/u;
const own = (value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
const safeName = value => typeof value === 'string' && NAME.test(value) && !UNSAFE.has(value);
const message = (code, text, detail = {}) => ({ code, severity: 'info', message: text, ...detail });
function result(status, effects = [], diagnostics = [], extra = {}) { return { status, effects, diagnostics, ...extra }; }
function blocked(code, text) { return result('blocked', [], [message(code, text)]); }
function unsupported(code, text, extra = {}) { return result('unsupported', [], [message(code, text)], extra); }
function propsOf(node, override = {}) { return { ...(node?.localVariables || {}), ...(node?.unknownProps || {}), ...(node?.props || {}), ...override }; }
function resolve(value, props) {
  const seen = new Set();
  for (let depth = 0; typeof value === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(value) && depth < 32; depth += 1) {
    if (seen.has(value)) return value;
    seen.add(value);
    const next = own(props, value) ?? own(props, `${value}|default`);
    if (next === undefined) return value;
    value = next;
  }
  return value;
}
function childScopeProps(parent, child) {
  const scope = Object.fromEntries(Object.entries(parent).filter(([key]) => key.startsWith('$')));
  for (const [key, value] of Object.entries(child?.localVariables || {})) {
    if (key.endsWith('|default')) { const base = key.slice(0, -8); if (!Object.hasOwn(scope, base)) scope[base] = value; }
    else scope[key] = value;
  }
  return { ...scope, ...child?.unknownProps, ...child?.props };
}
function gate({ enabled, pocket, effectiveProps = {} }) {
  if (enabled !== true) return blocked('INTERACTION_MODE_OFF', 'プレビュー操作はOFFです。');
  if (pocket === true) return blocked('INTERACTION_POCKET_BLOCKED', 'Pocket版のプレビュー操作には対応していません。');
  for (const key of ['enabled', 'visible']) {
    const value = effectiveProps[key];
    if (value !== undefined && value !== true && value !== 1 && value !== 'true' && value !== '1') return blocked('INTERACTION_CONTROL_DISABLED', 'この要素は無効または非表示です。');
  }
  if (effectiveProps.ignored !== undefined && effectiveProps.ignored !== false && effectiveProps.ignored !== 0 && effectiveProps.ignored !== 'false') return blocked('INTERACTION_CONTROL_IGNORED', 'この要素はプレビューで除外されています。');
  return null;
}

/** 左クリックのpressed mappingだけを抽出。menu_cancel/hoverのmappingは混入させない。 */
export function extractUiInteractionActions(node, effectiveProps = {}, event = 'activate', inputSource = event === 'escape' ? 'keyboard' : 'mouse') {
  const props = propsOf(node, effectiveProps);
  const mappings = resolve(props.button_mappings, props);
  if (!Array.isArray(mappings)) return [];
  if (event === 'activate' && inputSource !== 'mouse' || event === 'escape' && inputSource !== 'keyboard') return [];
  const fromIds = event === 'escape' ? ['button.menu_cancel', 'button.menu_exit'] : ['button.menu_select'];
  const out = [];
  for (const mapping of mappings.slice(0, 512)) {
    if (!mapping || typeof mapping !== 'object') continue;
    const ignored = resolve(mapping.ignored, props);
    if (ignored !== undefined && ignored !== false && ignored !== 0 && ignored !== 'false' && ignored !== '0') continue;
    // 保存原UIにあるnot_gamepadのみ、識別済みmouse/keyboard入力で成立する。
    // gamepad/gaze/touchおよび未知のenumや式は推定して発火させない。
    const mode = resolve(mapping.input_mode_condition, props);
    if (mode !== undefined && mode !== 'not_gamepad') continue;
    const from = resolve(mapping.from_button_id, props);
    const to = resolve(mapping.to_button_id, props);
    const kind = resolve(mapping.mapping_type, props);
    if (!fromIds.includes(from) || (event === 'escape' ? kind !== 'global' : kind !== 'pressed')) continue;
    if (typeof to !== 'string' || !/^[A-Za-z0-9_:@.\/-]{1,512}$/u.test(to) || to.startsWith('$')) continue;
    if (!out.includes(to)) out.push(to);
  }
  return out;
}

function boundControlState(node, props, property) {
  const candidates = new Map();
  for (const binding of (node?.bindings || []).slice(0, 512)) {
    const ignored = resolve(binding.ignored, props);
    if (ignored !== undefined && ![false,0,'false','0'].includes(ignored)) continue;
    const kind = resolve(binding.binding_type, props) || 'global';
    const name = resolve(binding.binding_name, props);
    const target = resolve(binding.binding_name_override, props) || name;
    if (!['global','collection'].includes(kind) || target !== property || !BINDING.test(name || '') || !safeName(name.slice(1))) continue;
    const collection = kind === 'collection' ? resolve(binding.binding_collection_name, props) : null;
    if (kind === 'collection' && !safeName(collection)) continue;
    candidates.set(`${collection || ''}\0${name}`, { binding: name, collection });
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

/** 実際の#toggle_stateの書き込み元へだけ反映。action名からbinding名を生成しない。 */
export function resolveToggleInteraction(options = {}) {
  const { node, effectiveProps = {}, mockData = {}, collectionData = {}, model, propsById = {} } = options;
  const props = propsOf(node, effectiveProps), stopped = gate({ ...options, effectiveProps: props });
  if (stopped) return stopped;
  if (!['toggle','dropdown'].includes(node?.type)) return unsupported('INTERACTION_NOT_TOGGLE', '切り替え要素ではありません。');
  const source = boundControlState(node, props, '#toggle_state');
  if (!source) return resolveLocalToggleInteraction(options);
  const group = resolve(props.toggle_name, props), forced = resolve(props.toggle_group_forced_index, props);
  const stockGroup = isStandardClassicRecipeBookScreen(options.screenDefinition)
    ? group === 'layout_toggle' ? ['#is_survival_layout','#is_recipe_book_layout','#is_creative_layout']
      : group === 'navigation_tab' ? ['#is_left_tab_inventory','#is_left_tab_search','#is_left_tab_construct','#is_left_tab_equipment','#is_left_tab_nature','#is_left_tab_items'] : null
    : null;
  // Stockのforced_indexはゲームenumのため数値が未提供でも、原binding群で排他を保つ。
  const knownStockGroup = stockGroup?.includes(source.binding) ? stockGroup : null;
  const radio = resolve(props.radio_toggle_group, props) === true || Number.isInteger(forced) && forced >= 0 || Boolean(knownStockGroup);
  const requested = options.action === 'toggle.toggle_on' ? true : options.action === 'toggle.toggle_off' ? false : null;
  if (radio && requested === false) return blocked('INTERACTION_RADIO_OFF_UNCONFIRMED', '排他グループを未選択にする動作は確認できないため、別の項目を選択してください。');
  if (source.collection) {
    const rows = own(collectionData, source.collection), address = options.collectionAddress;
    const index = address?.collection === source.collection ? address.index : rows?.length === 1 ? 0 : null;
    if (!Array.isArray(rows) || !Number.isInteger(index) || index < 0 || index >= rows.length || !rows[index]) return blocked('INTERACTION_COLLECTION_ADDRESS_REQUIRED', '切り替える一覧の行を確認できません。');
    const current = own(rows[index], source.binding);
    if (typeof current !== 'boolean') return unsupported('INTERACTION_TOGGLE_STATE_UNRESOLVED', '切り替え前の状態が真偽値ではありません。');
    if (radio && rows.some(row => !row || typeof row[source.binding] !== 'boolean')) return unsupported('INTERACTION_TOGGLE_GROUP_STATE_UNRESOLVED', '同じ一覧の排他選択状態をすべて確認できないため、一部だけ変更しません。');
    const patch = { [source.collection]: rows.map((row, i) => radio ? { ...row, [source.binding]: i === index } : i === index ? { ...row, [source.binding]: requested ?? !current } : row) };
    // 原beacon UIはprimary/secondaryを別のsingleton collection群で管理する。
    if (options.screenDefinition === 'beacon.beacon_screen' && source.binding === '#selected') {
      const primary = ['speed','haste','resist','jump','strength'], secondary = ['regen','extra'];
      const peers = primary.includes(source.collection) ? primary : secondary.includes(source.collection) ? secondary : [];
      for (const name of peers) if (Array.isArray(collectionData[name]) && collectionData[name].length === 1) patch[name] = [{ ...collectionData[name][0], '#selected': name === source.collection }];
    }
    return result('applied', [{ type: 'collectionPatch', patch }], [message('INTERACTION_TOGGLE_PREVIEW_ONLY', '選択状態をプレビューに反映しました。ゲーム内の効果確定は実行しません。')]);
  }
  const bare = source.binding.slice(1), current = own(mockData, source.binding) ?? own(mockData, bare);
  if (source.binding === '#toggle_state') return unsupported('INTERACTION_TOGGLE_LOCAL_STATE_UNRESOLVED', '要素固有の切り替え状態を他の要素と共有しないため、書き込みを保留します。');
  const value = radio ? true : requested ?? !(typeof current === 'boolean' ? current : resolve(props.toggle_state ?? props.toggle_default_state, props) === true);
  const patch = { [Object.hasOwn(mockData, bare) && !Object.hasOwn(mockData, source.binding) ? bare : source.binding]: value };
  if (radio && safeName(group) && model?.root) {
    const pending = [model.root], seen = new Set();
    while (pending.length && seen.size < 20000) {
      const peer = pending.pop();
      if (!peer || seen.has(peer)) continue;
      seen.add(peer);
      if (peer.type === 'toggle' && peer.id !== node.id) {
        const peerProps = propsOf(peer, propsById[peer.id] || {}), peerSource = boundControlState(peer, peerProps, '#toggle_state');
        if (resolve(peerProps.toggle_name, peerProps) === group && peerSource && !peerSource.collection && peerSource.binding !== source.binding && peerSource.binding !== '#toggle_state') {
          const key = peerSource.binding.slice(1);
          patch[Object.hasOwn(mockData,key) && !Object.hasOwn(mockData,peerSource.binding) ? key : peerSource.binding] = false;
        }
      }
      for (const child of peer.children || []) pending.push(child);
    }
    if (pending.length) return unsupported('INTERACTION_TOGGLE_SCAN_LIMIT', '切り替えグループの探索上限に達したため、一部だけの変更を取り消しました。');
  }
  if (knownStockGroup) {
    for (const binding of knownStockGroup) {
      const bareName = binding.slice(1), key = Object.hasOwn(mockData,bareName) && !Object.hasOwn(mockData,binding) ? bareName : binding;
      patch[key] = binding === source.binding;
    }
    if (group === 'layout_toggle') {
      const creative = own(mockData,'#is_creative_mode') ?? own(mockData,'is_creative_mode');
      patch['#is_creative_and_creative_layout'] = creative === true && source.binding === '#is_creative_layout';
      patch['#is_creative_and_recipe_book_layout'] = creative === true && source.binding === '#is_recipe_book_layout';
    }
  }
  return result('applied', [{ type: 'mockPatch', patch }], [message('INTERACTION_TOGGLE_PREVIEW_ONLY', '原UIの切り替えbindingへ選択状態を反映しました。')]);
}

/**
 * @param {object} options event activate/outside/escape。outsidePolicyはUI外部で明示した設定のみ。
 * bookPagesの編集はcollectionAddressを必須にし、別ページ/別画面への誤適用を防ぐ。
 */
export function resolveUiInteraction(options = {}) {
  const { node, effectiveProps = {}, event = 'activate', screenDefinition = '', mockData = {}, collectionData = {}, actionMap = {}, availableScreenPaths = [], collectionAddress = null } = options;
  const props = propsOf(node, effectiveProps);
  const stopped = gate({ ...options, effectiveProps: props });
  if (stopped) return stopped;
  if (!['activate', 'outside', 'escape'].includes(event)) return unsupported('INTERACTION_EVENT_UNSUPPORTED', 'この入力イベントには対応していません。');
  if (event === 'outside') {
    // menu_cancelや画面サイズからUI外クリックの挙動を推定しない。
    const policy = options.outsidePolicy;
    if (policy?.close === true && policy?.source === 'explicit-preview-setting' && policy?.fullscreen !== true) return result('applied', [{ type: 'close', reason: 'explicit-outside-policy' }]);
    return blocked('INTERACTION_OUTSIDE_CLOSE_UNCONFIRMED', 'この画面ではUI外クリックによる終了が定義・確認されていないため、閉じません。');
  }
  const actionIds = extractUiInteractionActions(node, effectiveProps, event, options.inputSource);
  if (!actionIds.length) return unsupported('INTERACTION_ACTION_UNRESOLVED', 'この入力に対応するbutton_mappingsを解決できません。入力元・pressed/global種別・ignored・入力モード条件を確認してください。', { actionIds });
  if (actionIds.length > 1) return unsupported('INTERACTION_MULTIPLE_ACTIONS', '複数actionの実行順序が未確認のため、一括実行しません。', { actionIds });
  const action = actionIds[0];
  const finish = (value) => ({ ...value, actionIds });
  let explicit;
  try { explicit = resolveNavigationMapping(actionMap, options.screenRef || options.sourceRef, action); }
  catch (error) { return finish(blocked(error.code || 'INTERACTION_MAPPING_INVALID', '明示した遷移対応が不正または重複しています。対応表を確認してください。')); }
  if (explicit) {
    const path = explicit.fileId.replace(/^screen:/u, '');
    if (!/^ui\/[A-Za-z0-9_./-]+\.jsonc?$/u.test(path) || path.split('/').includes('..') || !availableScreenPaths.includes(path)) return finish(blocked('INTERACTION_TARGET_UNAVAILABLE', '明示した遷移先のUIファイルが現在のパックにありません。'));
    if (/(?:^|[_/])pocket(?:[_.\/]|$)/iu.test(path)) return finish(blocked('INTERACTION_POCKET_BLOCKED', 'Pocket版へのプレビュー遷移は行いません。'));
    return finish(result('applied', [{ type: 'navigate', ...explicit, reason: 'explicit-action-map' }]));
  }
  if (['toggle','dropdown'].includes(node?.type) && event === 'activate' && ['button.menu_select','button.menu_ok','button.controller_back','toggle.toggle_on','toggle.toggle_off'].includes(action)) return finish(resolveToggleInteraction({ ...options, action }));
  if (action === 'button.menu_exit') return finish(result('applied', [{ type: 'close', reason: action }]));
  if (action === 'button.help') {
    const topicDefinitions = {
      'anvil.anvil_screen': ['anvil_section', '金床'],
      'brewing_stand.brewing_stand_screen': ['brewing_stand_section', '醸造台'],
      'enchanting.enchanting_screen': ['enchanting_table_section', 'エンチャント'],
      'furnace.furnace_screen': ['furnace_section', 'かまど'],
      'book.book_screen': ['book_and_quill_section', '本と羽根ペン'],
      'horse.horse_screen': ['mounts_section', '乗り物と動物'],
    };
    const topic = own(topicDefinitions, screenDefinition);
    const candidates = [
      { path: 'ui/how_to_play_screen.json', definition: 'how_to_play.how_to_play_screen', label: '遊び方' },
      ...(topic ? [{ path: 'ui/encyclopedia_screen.json', definition: `encyclopedia.${topic[0]}`, label: `関連する説明: ${topic[1]}（プレビュー用）`, previewTopic: true }] : []),
    ].filter(item => availableScreenPaths.includes(item.path)).map(item => ({ fileId: `screen:${item.path}`, definition: item.definition, label: item.label, ...(item.previewTopic ? { previewTopic: true } : {}) }));
    if (!candidates.length) return finish(unsupported('INTERACTION_HELP_UNAVAILABLE', '表示確認済みの遊び方UIがパックにありません。百科事典の全体表示は現在の解釈上限を超えるため、自動候補に含めません。'));
    return finish(result('applied', [{ type: 'chooseNavigate', candidates }], [message('INTERACTION_HELP_TARGET_CHOICE', 'パック内の「遊び方」または確認済みの関連項目を選択できます。関連項目はプレビュー側の対応設定で表示し、実機の自動遷移・表示状態との一致は未確認です。百科事典の全体表示は解釈上限を超えるため候補に含めません。')]));
  }
  const scoped = resolveScopedUiAction({ ...options, action });
  if (scoped) return finish(scoped);
  const clipboard = resolveClipboardAdapter({ ...options, action });
  if (clipboard) return finish(clipboard);
  const book = screenDefinition === 'book.book_screen';
  if (book && action === 'button.book_exit') {
    if (mockData['#signing'] === true) return finish(result('applied', [{ type: 'mockPatch', patch: { '#signing': false, '#viewing': true } }], [message('INTERACTION_PREVIEW_ADAPTER', '本の署名画面を取り消し、本文表示へ戻しました。ゲームへの書き込みは行いません。')]));
    return finish(result('applied', [{ type: 'close', reason: action }]));
  }
  if (book && action === 'button.sign_book') {
    if (mockData['#editable'] === false) return finish(blocked('INTERACTION_BOOK_READONLY', 'この本は読み取り専用です。'));
    return finish(result('applied', [{ type: 'mockPatch', patch: { '#viewing': false, '#signing': true, '#picking': false, '#exporting': false } }], [message('INTERACTION_PREVIEW_ADAPTER', '本の署名画面を表示しました。確定・保存はゲーム内処理のため実行しません。')]));
  }
  if (book && action === 'button.edit_page') {
    if (mockData['#editable'] === false) return finish(blocked('INTERACTION_BOOK_READONLY', 'この本は読み取り専用です。'));
    const address = collectionAddress;
    const pages = own(collectionData, 'book_pages');
    if (address?.collection !== 'book_pages' || !Number.isInteger(address.index) || address.index < 0 || !Array.isArray(pages) || !pages[address.index]) return finish(blocked('INTERACTION_COLLECTION_ADDRESS_REQUIRED', 'ページの位置が確認できないため、別ページへの変更を防いでいます。'));
    const page = pages[address.index];
    const active = page['#edit_controls_active'] !== true;
    const next = pages.slice();
    next[address.index] = { ...page, '#edit_controls_active': active, '#edit_button_active': !active };
    return finish(result('applied', [{ type: 'collectionPatch', patch: { book_pages: next } }], [message('INTERACTION_PREVIEW_ADAPTER', '選択ページの編集ボタン表示を変更しました。ページ削除やゲームへの書き込みは行いません。')]));
  }
  return finish(unsupported('INTERACTION_ACTION_UNSUPPORTED', describeUnsupportedUiAction(screenDefinition, action)));
}

/** 入力値sourceを、edit_box配下のtext bindingだけから一意に求める。 */
export function describeTextInteraction(options = {}) {
  const { node, effectiveProps = {}, collectionIndex } = options;
  const props = propsOf(node, effectiveProps);
  const stopped = gate({ ...options, effectiveProps: props });
  if (stopped) return stopped;
  if (String(node?.type || props.type) !== 'edit_box') return unsupported('INTERACTION_NOT_EDIT_BOX', '文字入力欄ではありません。');
  const candidates = new Map(), preferredCandidates = new Map();
  const textControl = resolve(props.text_control, props);
  const hasTextControl = typeof textControl === 'string' && textControl.length > 0;
  let matchedTextControl = false;
  const stack = [{ node, props, depth: 0, selected: !hasTextControl }];
  let visited = 0;
  while (stack.length && visited < 1024) {
    const current = stack.pop(); visited += 1;
    if (!current?.node || current.depth > 64) continue;
    const local = propsOf(current.node, current.props);
    const selected = current.selected || current.node.key?.local_name === textControl;
    if (hasTextControl && current.node.key?.local_name === textControl) matchedTextControl = true;
    const textToken = resolve(local.text, local);
    for (const binding of (Array.isArray(current.node.bindings) ? current.node.bindings : Array.isArray(local.bindings) ? local.bindings : []).slice(0, 512)) {
      const kind = resolve(binding.binding_type, local) || 'global';
      if (!['global', 'collection'].includes(kind) || binding.ignored === true) continue;
      const name = resolve(binding.binding_name, local);
      const target = resolve(binding.binding_name_override, local) || name;
      if (!BINDING.test(name || '') || !['#text', 'text', textToken].includes(target)) continue;
      const collection = kind === 'collection' ? resolve(binding.binding_collection_name, local) : null;
      if (kind === 'collection' && !safeName(collection)) continue;
      candidates.set(`${collection || ''}\0${name}`, { binding: name, collection });
      if (selected) preferredCandidates.set(`${collection || ''}\0${name}`, { binding: name, collection });
    }
    const children = Array.isArray(current.node.children) ? current.node.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child?.type === 'edit_box') continue;
      stack.push({ node: child, props: childScopeProps(local, child), depth: current.depth + 1, selected });
    }
  }
  if (stack.length) return unsupported('INTERACTION_TEXT_SCAN_LIMIT', '入力欄の探索上限に達したため、書き込み先を確定しません。');
  if (hasTextControl && !matchedTextControl) return unsupported('INTERACTION_TEXT_CONTROL_MISSING', '原UIが指定したtext_controlを確認できません。');
  const sources = hasTextControl ? preferredCandidates : candidates;
  if (sources.size !== 1) return unsupported('INTERACTION_TEXT_BINDING_AMBIGUOUS', '文字入力の書き込み先が一意に確認できません。');
  const target = [...sources.values()][0];
  if (target.collection && (!Number.isInteger(collectionIndex) || collectionIndex < 0 || collectionIndex >= 256)) return blocked('INTERACTION_COLLECTION_ADDRESS_REQUIRED', '入力するcollection行の位置が確認できません。');
  const rawLength = resolve(props.max_length, props);
  if (rawLength !== undefined && (!Number.isInteger(rawLength) || rawLength < 0 || rawLength > 65536)) return unsupported('INTERACTION_TEXT_LENGTH_UNRESOLVED', 'この入力欄の文字数上限を解決できないため、入力を開始しません。');
  const rawType = resolve(props.text_type, props);
  if (rawType !== undefined && !['ExtendedASCII', 'ASCII', 'Alphanumeric', 'Numeric', 'Password'].includes(rawType)) return unsupported('INTERACTION_TEXT_TYPE_UNSUPPORTED', 'この入力欄の文字種制約には対応していません。');
  const edit = { nodeId: String(node.id), ...target, index: target.collection ? collectionIndex : null, maxLength: rawLength ?? null, textType: rawType ?? 'ExtendedASCII', multiline: resolve(props.enabled_newline, props) === true || resolve(props.multiline, props) === true || resolve(props.multiline_edit_box, props) === true };
  return result('applied', [], [], { edit });
}

/** compositionend/blur後にも呼び出して、貼付け/IME経由でも文字制約を同じように検証する。 */
export function commitTextInteraction(options = {}) {
  const { edit, value, mockData = {}, collectionData = {} } = options;
  const stopped = gate(options); if (stopped) return stopped;
  if (!edit || !BINDING.test(edit.binding || '') || !safeName(edit.binding.slice(1)) || typeof value !== 'string') return blocked('INTERACTION_TEXT_INVALID', '文字入力の書き込み指定が不正です。');
  // DOM maxLengthと同じUTF-16単位。実機の補助平面文字カウント規則は未検証。
  if (edit.maxLength !== null && edit.maxLength !== undefined && (!Number.isInteger(edit.maxLength) || edit.maxLength < 0 || value.length > edit.maxLength)) return blocked('INTERACTION_TEXT_TOO_LONG', `入力文字数が上限${edit.maxLength}を超えています。`);
  if (value.length > 65536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || (edit.multiline !== true && /[\r\n]/u.test(value))) return blocked('INTERACTION_TEXT_CHARACTERS', '入力欄で扱えない制御文字または改行が含まれています。');
  const kind = edit.textType;
  if (!['ExtendedASCII', 'ASCII', 'Alphanumeric', 'Numeric', 'Password'].includes(kind)) return unsupported('INTERACTION_TEXT_TYPE_UNSUPPORTED', 'この入力欄の文字種制約には対応していません。');
  if ((kind === 'ASCII' && /[^\x20-\x7e\r\n]/u.test(value)) || (kind === 'Alphanumeric' && /[^A-Za-z0-9]/u.test(value)) || (kind === 'Numeric' && /[^0-9]/u.test(value))) return blocked('INTERACTION_TEXT_CHARACTERS', 'この入力欄の文字種制約に合いません。');
  if (edit.collection) {
    const rows = own(collectionData, edit.collection);
    if (!safeName(edit.collection) || !Array.isArray(rows) || !Number.isInteger(edit.index) || edit.index < 0 || edit.index >= rows.length || !rows[edit.index]) return blocked('INTERACTION_COLLECTION_ADDRESS_REQUIRED', '入力先のcollection行がありません。');
    const next = rows.slice(); next[edit.index] = { ...rows[edit.index], [edit.binding]: value };
    return result('applied', [{ type: 'collectionPatch', patch: { [edit.collection]: next } }]);
  }
  const bare = edit.binding.slice(1);
  const key = !Object.hasOwn(mockData, edit.binding) && Object.hasOwn(mockData, bare) ? bare : edit.binding;
  return result('applied', [{ type: 'mockPatch', patch: { [key]: value } }]);
}

function collectionAddressBoxIndex(boxes) {
  const cached = collectionAddressLayoutIndexes.get(boxes);
  if (cached?.length === boxes.length) return cached.byId;
  const byId = new Map(boxes.map(box => [String(box.id), box]));
  collectionAddressLayoutIndexes.set(boxes, { length: boxes.length, byId });
  return byId;
}

/**
 * 描画済みnodeの祖先を辿り、生成済みcollection markerと行番号を読む。
 * 公開layoutの要素差替え・ID変更は新しいboxes配列で渡す契約。
 * 通常layout/paint animation/frame deltaはこの契約を満たす。
 * identity＋lengthで索引を再利用し、props/collection値は毎回読み直す。
 */
export function findInteractionCollectionAddress({ nodeId, nodesById = {}, boxes = [], propsById = {}, collectionData = {}, model = null, collection = null } = {}) {
  const boxMap = collectionAddressBoxIndex(boxes);
  const getNode = id => getUiInteractionSourceNode({ model, nodesById, boxes }, id);
  const getProps = id => propsOf(getNode(id), { ...nodesById[id]?.props, ...propsById[id] });
  const getParentId = id => boxMap.get(id)?.parentId == null ? null : String(boxMap.get(id).parentId);
  let matchedName = collection;
  if (!matchedName) {
    const seen = new Set(); let id = nodeId == null ? null : String(nodeId);
    for (let depth = 0; id && depth < 64; depth += 1) {
      if (seen.has(id)) return null;
      seen.add(id);
      const node = getNode(id), props = getProps(id);
      const marker = resolve(props.__jsonui_preview_collection_name, props);
      const owner = resolve(props.collection_name, props);
      const detailNames = [...new Set((Array.isArray(node?.bindings) ? node.bindings : [])
        .filter(binding => resolve(binding.binding_type, props) === 'collection_details'
          && !binding.binding_collection_prefix && resolve(binding.ignored, props) !== true)
        .map(binding => resolve(binding.binding_collection_name, props)).filter(safeName))];
      if (detailNames.length > 1) return null;
      matchedName = depth > 0 && safeName(owner) ? owner
        : safeName(marker) ? marker : detailNames[0] || (safeName(owner) ? owner : null);
      if (matchedName) break;
      id = getParentId(id);
    }
  }
  if (!safeName(matchedName)) return null;
  const address = confirmCollectionRowAddress(resolveCollectionRowAddress({
    currentId: nodeId, collectionName: matchedName, getNode, getParentId, getProps,
    resolveName: (name, props) => { const value = resolve(name, props); return safeName(value) ? value : ''; },
    resolveDimensions: props => resolve(props.grid_dimensions, props),
  }), own(collectionData, matchedName));
  // Preview interactions have a separate bounded runtime-data budget. A
  // collection_details descriptor selects the namespace, never an owner type.
  return address.status === 'resolved' && address.index < 256
    ? { collection: matchedName, index: address.index } : null;
}

const PAYLOAD = new Set(['__jsonui_preview_item_id','__jsonui_preview_item_count','__jsonui_preview_item_texture','__jsonui_preview_item_atlas_key','__jsonui_preview_item_variant','#item_id_aux','#item_stack_count','#inventory_stack_count','#trade_item_count','#second_trade_item_count','#trade_price_different','#item_valid','#inactive_item','#item_grayed_out','#bundle_selected_item_visible','#empty_image_visible','#hover_text']);
const ANY_SLOTS = new Set(['inventory_items','hotbar_items','container_items','crafting_input_items']);
const OUTPUTS = new Set(['crafting_output_items','crafting_result_items','furnace_output_items','anvil_result_items','cartography_result_items','grindstone_result_items','stonecutter_result_items','smithing_table_result_items','loom_result_items','trade_result_item','trade2_result_item','sell_item']);
const FUELS = new Set(['coal','charcoal','coal_block','blaze_rod','lava_bucket','stick','bamboo','dried_kelp_block']);
const BREWING_REAGENTS = new Set(['nether_wart','redstone','glowstone_dust','fermented_spider_eye','gunpowder','dragon_breath','sugar','rabbit_foot','blaze_powder','spider_eye','ghast_tear','magma_cream','pufferfish','golden_carrot','glistering_melon_slice','turtle_helmet','phantom_membrane','stone','slime_block','cobweb','breeze_rod']);
const FOOD_INPUTS = new Set(['beef','porkchop','chicken','mutton','rabbit','cod','salmon','potato','kelp']);
const MINERAL_INPUTS = new Set(['iron_ore','deepslate_iron_ore','raw_iron','gold_ore','deepslate_gold_ore','nether_gold_ore','raw_gold','copper_ore','deepslate_copper_ore','raw_copper','ancient_debris','coal_ore','deepslate_coal_ore','diamond_ore','deepslate_diamond_ore','emerald_ore','deepslate_emerald_ore','redstone_ore','deepslate_redstone_ore','lapis_ore','deepslate_lapis_ore','quartz_ore','nether_quartz_ore']);
const FURNACE_INPUTS = new Set(['sand','red_sand','cobblestone','stone','sandstone','red_sandstone','quartz_block','clay_ball','clay','netherrack','cactus','wet_sponge','cobbled_deepslate','stonebrick','stone_bricks','polished_blackstone_bricks','deepslate_bricks','deepslate_tiles']);
const ENCHANTABLE_EXTRA = new Set(['book','bow','crossbow','fishing_rod','trident','mace']);
const REPAIRABLE_EXTRA = new Set(['bow','crossbow','fishing_rod','trident','mace','elytra','shield','shears','flint_and_steel','carrot_on_a_stick','warped_fungus_on_a_stick','brush']);
const ARMOR = /^(?:leather|chainmail|iron|golden|diamond|netherite)_(?:helmet|chestplate|leggings|boots)$/u;
const TOOLS = /^(?:wooden|stone|iron|golden|diamond|netherite)_(?:sword|pickaxe|axe|shovel|hoe)$/u;
const COLORS = '(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)';
const DYE = new RegExp(`^${COLORS}_dye$`, 'u');
const BANNER = new RegExp(`^${COLORS}_banner$`, 'u');
const SMITHING_MATERIALS = new Set(['netherite_ingot','iron_ingot','copper_ingot','gold_ingot','emerald','diamond','lapis_lazuli','amethyst_shard','redstone','quartz','resin_brick']);
function repairable(id) { return ARMOR.test(id) || TOOLS.test(id) || id === 'turtle_helmet' || REPAIRABLE_EXTRA.has(id); }
function enchantable(id) { return ARMOR.test(id) || TOOLS.test(id) || id === 'turtle_helmet' || ENCHANTABLE_EXTRA.has(id); }
function furnaceIngredient(id, screen) {
  if (screen === 'smoker.smoker_screen') return FOOD_INPUTS.has(id);
  if (screen === 'blast_furnace.blast_furnace_screen') return MINERAL_INPUTS.has(id) || /^(?:iron|golden|chainmail)_(?:helmet|chestplate|leggings|boots|sword|pickaxe|axe|shovel|hoe)$/u.test(id);
  return FOOD_INPUTS.has(id) || MINERAL_INPUTS.has(id) || FURNACE_INPUTS.has(id)
    || /^(?:stripped_)?(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(?:log|wood)$/u.test(id)
    || new RegExp(`^${COLORS}_terracotta$`, 'u').test(id)
    || /^(?:iron|golden|chainmail)_(?:helmet|chestplate|leggings|boots|sword|pickaxe|axe|shovel|hoe)$/u.test(id);
}
function stonecuttable(id) {
  return /^(?:(?:polished_)?(?:andesite|diorite|granite)|(?:smooth_)?(?:stone|sandstone|red_sandstone|quartz)|(?:cobbled|polished)_deepslate|(?:polished_)?(?:blackstone|tuff)|(?:end_stone|stone|deepslate|polished_blackstone|tuff|mud|resin)_bricks?|(?:red_)?nether_bricks?|bricks?|prismarine(?:_bricks)?|dark_prismarine|purpur_block|quartz_block|(?:waxed_)?(?:(?:exposed|weathered|oxidized)_)?(?:copper_block|cut_copper))$/u.test(id);
}
const RESTRICTED_SLOTS = new Set(['armor_items','offhand_items','furnace_ingredient_items','furnace_fuel_items','brewing_input_item','brewing_fuel_item','brewing_result_items','anvil_input_items','anvil_material_items','enchanting_input_items','enchanting_lapis_items','horse_equip_items','beacon_payment_items','grindstone_input_items','grindstone_additional_items','smithing_table_input_items','smithing_table_material_items','smithing_table_template_items','loom_input_items','loom_dye_items','loom_material_items','stonecutter_input_items','cartography_input_items','cartography_additional_items','trade2_ingredient1_item','trade2_ingredient2_item','trade_ingredient1_items','trade_ingredient2_items']);
function idOf(row) { const id = own(row, '__jsonui_preview_item_id'); return typeof id === 'string' ? id.replace(/^minecraft:/u, '') : ''; }
function populated(row) { return row?.['#item_valid'] === true || row?.__jsonui_preview_item_count > 0 || (Number(row?.['#item_id_aux']) > 0); }
function permits(collection, index, row, context = {}) {
  if (!populated(row)) return { ok: true };
  if (OUTPUTS.has(collection)) return { ok: false, code: 'INTERACTION_SLOT_OUTPUT_ONLY', message: '完成品スロットには置けません。' };
  if (ANY_SLOTS.has(collection)) return { ok: true };
  const id = idOf(row);
  if (!id) return { ok: false, code: 'INTERACTION_ITEM_ID_REQUIRED', message: '制約付きスロットの判定に必要なアイテムIDがありません。' };
  const count = own(row, '__jsonui_preview_item_count');
  const singleItem = collection === 'armor_items' || collection === 'horse_equip_items'
    || (collection === 'brewing_result_items' && id !== 'glass_bottle')
    || (collection === 'offhand_items' && ['shield', 'totem_of_undying'].includes(id))
    || (collection === 'furnace_fuel_items' && id === 'lava_bucket');
  if (singleItem && count !== 1) return { ok: false, code: 'INTERACTION_SLOT_SINGLE_ITEM', message: 'このスロットでは1個のアイテムだけを扱います。スタックの分割は未対応です。' };
  let known = false;
  if (collection === 'furnace_fuel_items') known = FUELS.has(id) || /^(?:stripped_)?(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(?:log|wood|planks|slab|stairs|fence|fence_gate|trapdoor|door|button|pressure_plate|sapling|sign|hanging_sign)$/u.test(id) || ['crafting_table','chest','trapped_chest','bookshelf','barrel','ladder','bowl','fishing_rod','bow','crossbow','deadbush','scaffolding','bamboo_block','stripped_bamboo_block','bamboo_planks'].includes(id);
  else if (collection === 'furnace_ingredient_items') known = furnaceIngredient(id, context.screenDefinition);
  else if (collection === 'brewing_input_item') known = BREWING_REAGENTS.has(id);
  else if (collection === 'brewing_fuel_item') known = id === 'blaze_powder';
  else if (collection === 'brewing_result_items') known = ['glass_bottle','potion','splash_potion','lingering_potion'].includes(id);
  else if (collection === 'enchanting_lapis_items') known = id === 'lapis_lazuli';
  else if (collection === 'enchanting_input_items') known = enchantable(id);
  else if (collection === 'anvil_input_items') known = true; // 名前変更の対象。合成/経験値判定は別境界。
  else if (collection === 'anvil_material_items') known = repairable(id) || id === 'enchanted_book' || ['iron_ingot','gold_ingot','diamond','netherite_ingot','leather','scute','turtle_scute','phantom_membrane','string'].includes(id);
  else if (['grindstone_input_items','grindstone_additional_items'].includes(collection)) known = repairable(id) || id === 'enchanted_book';
  else if (collection === 'smithing_table_input_items') known = ARMOR.test(id) || /^(?:diamond|netherite)_(?:sword|pickaxe|axe|shovel|hoe)$/u.test(id) || id === 'turtle_helmet';
  else if (collection === 'smithing_table_material_items') known = SMITHING_MATERIALS.has(id);
  else if (collection === 'smithing_table_template_items') known = id === 'netherite_upgrade_smithing_template' || /^(?:coast|dune|eye|host|raiser|rib|sentry|shaper|silence|snout|spire|tide|vex|ward|wayfinder|wild|bolt|flow)_armor_trim_smithing_template$/u.test(id);
  else if (collection === 'loom_input_items') known = id === 'banner' || BANNER.test(id);
  else if (collection === 'loom_dye_items') known = DYE.test(id) || ['dye','ink_sac','cocoa_beans','bone_meal','lapis_lazuli'].includes(id);
  else if (collection === 'loom_material_items') known = /^(?:flower|creeper|skull|mojang|globe|piglin|flow|guster|field_masoned|bordure_indented)_banner_pattern$/u.test(id) || id === 'banner_pattern';
  else if (collection === 'stonecutter_input_items') known = stonecuttable(id);
  else if (collection === 'cartography_input_items') known = id === 'filled_map';
  else if (collection === 'cartography_additional_items') known = ['paper','map','empty_map','glass_pane','compass'].includes(id);
  else if (collection === 'armor_items') {
    const suffix = ['helmet','chestplate','leggings','boots'][index];
    known = Boolean(suffix && /^(?:leather|chainmail|iron|golden|diamond|netherite)_(?:helmet|chestplate|leggings|boots)$/u.test(id) && id.endsWith(`_${suffix}`)) || (index === 0 && id === 'turtle_helmet') || (index === 1 && id === 'elytra');
  } else if (collection === 'offhand_items') known = ['shield','totem_of_undying','arrow','tipped_arrow','map','filled_map','firework_rocket'].includes(id);
  else if (collection === 'horse_equip_items') {
    // horse_screenはラマ・馬・オウムガイ等で同じcollectionを再使用する。
    // 行番号だけで動物種を決めず、原UIの装備背景に使われる状態flagを照合する。
    const flags = context.mockData || {};
    const onlyModes = ['#has_only_horse_armor_slot', '#has_only_carpet_slot', '#has_only_nautilus_armor_slot'].filter(key => flags[key] === true);
    const bothModes = ['#has_horse_armor_and_saddle_slot', '#has_carpet_and_saddle_slot', '#has_nautilus_armor_and_saddle_slot'].filter(key => flags[key] === true);
    const mode = onlyModes.length === 1 && bothModes.length === 0 ? onlyModes[0]
      : onlyModes.length === 0 && bothModes.length === 1 ? bothModes[0] : null;
    const horseArmor = ['leather_horse_armor','iron_horse_armor','golden_horse_armor','diamond_horse_armor'].includes(id);
    const carpet = /^(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_carpet$/u.test(id);
    if (index === 0 && flags['#has_saddle_slot'] === true && onlyModes.length === 0 && bothModes.length <= 1) known = id === 'saddle';
    else if ((index === 0 && mode === '#has_only_horse_armor_slot') || (index === 1 && mode === '#has_horse_armor_and_saddle_slot')) known = horseArmor;
    else if ((index === 0 && mode === '#has_only_carpet_slot') || (index === 1 && mode === '#has_carpet_and_saddle_slot')) known = carpet;
    // 未確認のオウムガイ装備IDは他の動物装備へ読み替えない。
  }
  else if (collection === 'beacon_payment_items') known = ['iron_ingot','gold_ingot','diamond','emerald','netherite_ingot'].includes(id);
  return known ? { ok: true } : { ok: false, code: 'INTERACTION_SLOT_RULE_UNCONFIRMED', message: 'この品目をこのスロットへ置けることが確認できないため、移動しません。' };
}
function replacePayload(slot, item) {
  const out = { ...slot };
  for (const key of PAYLOAD) delete out[key];
  for (const [key, value] of Object.entries(EMPTY_CLASSIC_SLOT_ROW)) if (PAYLOAD.has(key)) out[key] = value;
  for (const key of PAYLOAD) if (Object.hasOwn(item || {}, key)) out[key] = item[key];
  return out;
}
/** 全スタックの移動/交換のみ。削除、分割、合成、レシピ処理は行わない。 */
export function applySlotTransfer(options = {}) {
  const { collectionData = {}, from, to, expectedSource = null } = options;
  const stopped = gate(options); if (stopped) return stopped;
  for (const effectiveProps of [options.fromSlotProps, options.toSlotProps]) if (effectiveProps) {
    const stopped = gate({ ...options, effectiveProps }); if (stopped) return stopped;
  }
  for (const address of [from, to]) {
    const rows = own(collectionData, address?.collection);
    if (!safeName(address?.collection) || !Array.isArray(rows) || !Number.isInteger(address.index) || address.index < 0 || address.index >= rows.length || !rows[address.index] || typeof rows[address.index] !== 'object') return blocked('INTERACTION_SLOT_ADDRESS_INVALID', '移動元または移動先のスロットを確認できません。');
  }
  if ((!ANY_SLOTS.has(from.collection) && !RESTRICTED_SLOTS.has(from.collection) && !OUTPUTS.has(from.collection)) || from.collection === 'sell_item') return blocked('INTERACTION_SLOT_SOURCE_UNCONFIRMED', 'この一覧は移動可能なアイテムスロットとして確認されていません。');
  if (from.collection === to.collection && from.index === to.index) return result('noop');
  const sourceRows = collectionData[from.collection], targetRows = collectionData[to.collection];
  const source = sourceRows[from.index], target = targetRows[to.index];
  if (!populated(source)) return blocked('INTERACTION_SLOT_EMPTY', '移動元のスロットにアイテムがありません。');
  if (expectedSource && expectedSource !== source) return blocked('INTERACTION_SLOT_STALE', 'ドラッグ中に移動元のデータが変わったため、移動を取り消しました。');
  if (options.screenDefinition === 'chest.shulker_box_screen') {
    for (const [address, item] of [[to, source], [from, target]]) if (address.collection === 'container_items' && populated(item) && /(?:^|_)shulker_box$/u.test(idOf(item))) return blocked('INTERACTION_SLOT_NESTED_SHULKER', 'シュルカーボックスの中にシュルカーボックスは置けません。');
  }
  for (const check of [permits(to.collection, to.index, source, options), permits(from.collection, from.index, target, options)]) if (!check.ok) return blocked(check.code, check.message);
  const sourceCopy = sourceRows.slice();
  const targetCopy = from.collection === to.collection ? sourceCopy : targetRows.slice();
  sourceCopy[from.index] = replacePayload(source, target);
  targetCopy[to.index] = replacePayload(target, source);
  const patch = { [from.collection]: sourceCopy, [to.collection]: targetCopy };
  const effects = [{ type: 'collectionPatch', patch }];
  // Book #open is derived from the current target collection by the shared
  // binding runtime. Do not persist a stale mock value across later data edits.
  return result('applied', effects, [message('INTERACTION_SLOT_PREVIEW_ONLY', populated(target) ? 'プレビュー内でスタックを交換しました。ゲーム内のレシピ・取引は実行しません。' : 'プレビュー内でスタックを移動しました。ゲーム内のレシピ・取引は実行しません。')]);
}

/** 選択中UIの操作一覧。20,000node/96件で打切り、未知actionも理由付きで残す。 */
export function listUiInteractionCapabilities({ model, propsById = {}, maxEntries = 96, ...context } = {}) {
  const rows = [], pending = model?.root ? [model.root] : [], seen = new Set();
  const limit = Math.min(256, Math.max(1, Number(maxEntries) || 96)); let visited = 0, truncated = false;
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    if (++visited > 20000) { truncated = true; break; } seen.add(node);
    if (['button','edit_box','toggle','dropdown','slider'].includes(node.type) || ['input_panel','panel'].includes(node.type) && extractUiInteractionActions(node, propsById[node.id] || {}).length) {
      if (rows.length >= limit) { truncated = true; break; }
      const fullContext = { ...context, model, propsById };
      const effectiveProps = propsOf(node, propsById[node.id] || {});
      const inheritedState = getUiInteractionEffectiveProps(fullContext, node.id);
      for (const key of ['enabled','visible','ignored']) if (inheritedState[key] !== undefined) effectiveProps[key] = inheritedState[key];
      const collectionAddress = findInteractionCollectionAddress({ ...fullContext, nodeId: node.id });
      const descriptor = node.type === 'slider'
        ? unsupported('INTERACTION_SLIDER_UNSUPPORTED', 'スライダーの位置・範囲・刻み幅と描画更新を接続できていません。現在は状態JSONで値を指定してください。')
        : node.type === 'edit_box'
        ? describeTextInteraction({ ...fullContext, enabled: true, node, effectiveProps, collectionIndex: collectionAddress?.index })
        : resolveUiInteraction({ ...fullContext, enabled: true, node, effectiveProps, collectionAddress });
      rows.push({ nodeId: String(node.id), label: String(node.key?.local_name || node.key?.raw || node.id), type: node.type, status: descriptor.status, actionIds: descriptor.actionIds || [], effectTypes: descriptor.effects.map(effect => effect.type), reason: descriptor.diagnostics.map(entry => entry.message).join(' '), edit: descriptor.edit || null });
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  return { entries: rows, visited, truncated };
}
