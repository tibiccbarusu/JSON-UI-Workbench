/**
 * プレビューへ明示的に与えるゲーム状態。DOM・I/Oを持たない共有ESM。
 * JSON UI原本を変更せず、既存binding/collection境界へ値を渡す。
 */
import { normalizeItemIconIdentifier } from '../preview/item-icon-index.js';
import { lookupCurrentNativeItemRawId } from '../preview/native-item-id-profile.js';
import { normalizeModalForm } from './preview-modal-form.js';
import { createPreviewMessageResolver } from './preview-raw-message38.js';
import { EMPTY_CLASSIC_SLOT_ROW } from './classic-empty-slots.js';
import { normalizeEventFactorySelections38 } from './preview-context38.js';
const LIMITS = Object.freeze({ textBytes: 1024 * 1024, nodes: 20000, depth: 24, rows: 256, collections: 128 });
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
function fail(code, path) { const error = new Error(`${code}:${path}`); error.code = code; throw error; }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function copyInput(value, path = '$', depth = 0, budget = { count: 0, characters: 0 }, seen = new Set()) {
  if (++budget.count > LIMITS.nodes || depth > LIMITS.depth) fail('PREVIEW_STATE_BUDGET', path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('PREVIEW_STATE_NONFINITE', path); return value; }
  if (typeof value === 'string') { budget.characters += new TextEncoder().encode(value).byteLength; if (budget.characters > LIMITS.textBytes || value.length > 65536) fail('PREVIEW_STATE_TEXT_LIMIT', path); return value; }
  if (typeof value !== 'object' || seen.has(value)) fail('PREVIEW_STATE_JSON_REQUIRED', path);
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== null && proto !== Object.prototype) fail('PREVIEW_STATE_RECORD_REQUIRED', path);
  seen.add(value);
  const out = Array.isArray(value) ? [] : Object.create(null);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN.has(key)) fail('PREVIEW_STATE_UNSAFE_KEY', `${path}.${key}`);
    if (key.length > 512 || /[\u0000-\u001f]/u.test(key)) fail('PREVIEW_STATE_KEY_INVALID', path);
    budget.characters += new TextEncoder().encode(key).byteLength;
    if (budget.characters > LIMITS.textBytes) fail('PREVIEW_STATE_TEXT_LIMIT', path);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('PREVIEW_STATE_ACCESSOR', `${path}.${key}`);
    out[key] = copyInput(descriptor.value, `${path}.${key}`, depth + 1, budget, seen);
  }
  seen.delete(value);
  return out;
}
function ratio(value, fallback, path) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail('PREVIEW_STATE_RATIO_0_1', path);
  return value;
}
function text(value, fallback, path) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') fail('PREVIEW_STATE_STRING_REQUIRED', path);
  return value;
}
function bool(value, fallback, path) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail('PREVIEW_STATE_BOOLEAN_REQUIRED', path);
  return value;
}
function fields(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('PREVIEW_STATE_UNKNOWN_FIELD', `${path}.${key}`);
}
function actionFormRows(form, messageResolver) {
  fields(form, ['type','title','body','buttons','elements'], 'form');
  const hasElements = form.elements !== undefined;
  if (hasElements && form.buttons !== undefined) fail('PREVIEW_STATE_FORM_ROWS_CONFLICT', 'form');
  const field = hasElements ? 'elements' : 'buttons';
  const entries = form[field];
  if (!Array.isArray(entries) || entries.length > LIMITS.rows) fail(hasElements ? 'PREVIEW_STATE_FORM_ELEMENTS' : 'PREVIEW_STATE_FORM_BUTTONS', `form.${field}`);
  let selectionIndex = 0;
  return entries.map((entry, index) => {
    const path = `form.${field}.${index}`;
    if (!record(entry)) fail('PREVIEW_STATE_RECORD_REQUIRED', path);
    const type = hasElements ? entry.type : 'button';
    if (!['button','header','label','divider'].includes(type)) fail('PREVIEW_STATE_FORM_ELEMENT_TYPE', path);
    const allowed = type === 'button' ? ['text','icon'] : type === 'divider' ? [] : ['text'];
    fields(entry, hasElements ? ['type', ...allowed] : allowed, path);
    const row = { __jsonui_preview_factory_control_id: type };
    if (type !== 'divider') row['#form_button_text'] = messageResolver.resolve(entry.text, '', `${path}.text`);
    if (type === 'button') {
      const icon = text(entry.icon, '', `${path}.icon`);
      if (icon && (!/^textures\/[A-Za-z0-9_./-]+$/u.test(icon) || icon.split('/').includes('..'))) fail('PREVIEW_STATE_FORM_ICON_PATH', `${path}.icon`);
      Object.assign(row, { '#form_button_texture': icon, '#form_button_texture_file_system': 'InUserPackage' });
    }
    // Collection は表示行順。selection は button だけで数え、非 button は null。
    // 旧 buttons 形式の出力には追加 metadata を付けず、保存状態を維持する。
    if (hasElements) Object.assign(row, { __jsonui_preview_display_row_index: index, __jsonui_preview_action_selection_index: type === 'button' ? selectionIndex : null });
    if (type === 'button') selectionIndex += 1;
    return row;
  });
}
function itemRow(item, diagnostics, path) {
  if (!record(item)) fail('PREVIEW_STATE_ITEM_REQUIRED', path);
  fields(item, ['id','count','name','texture','atlasKey','variant','selected'], path);
  if (item.texture !== undefined && item.atlasKey !== undefined) fail('PREVIEW_STATE_ITEM_SOURCE_CONFLICT', path);
  if (item.variant !== undefined && item.atlasKey === undefined) fail('PREVIEW_STATE_ITEM_VARIANT_REQUIRES_ATLAS', path);
  const count = item.count === undefined ? 1 : item.count;
  if (!Number.isInteger(count) || count < 0 || count > 999) fail('PREVIEW_STATE_ITEM_COUNT', path);
  const identifier = text(item.id, '', `${path}.id`).replace(/^minecraft:/u, '');
  const resourceId = normalizeItemIconIdentifier(item.id);
  const legacyId = lookupCurrentNativeItemRawId(resourceId);
  const explicit = Object.create(null);
  if (item.texture !== undefined) {
    const texture = text(item.texture, '', `${path}.texture`);
    if (!/^textures\/[A-Za-z0-9_./-]+$/u.test(texture) || texture.split('/').includes('..')) fail('PREVIEW_STATE_ITEM_TEXTURE', path);
    explicit.__jsonui_preview_item_texture = texture;
  }
  if (item.atlasKey !== undefined) {
    if (typeof item.atlasKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(item.atlasKey)) fail('PREVIEW_STATE_ITEM_ATLAS_KEY', path);
    explicit.__jsonui_preview_item_atlas_key = item.atlasKey;
  }
  if (item.variant !== undefined) {
    if (!Number.isInteger(item.variant) || item.variant < 0 || item.variant > 4095) fail('PREVIEW_STATE_ITEM_VARIANT', path);
    explicit.__jsonui_preview_item_variant = item.variant;
  }
  const supported = Boolean(resourceId || legacyId || explicit.__jsonui_preview_item_texture || explicit.__jsonui_preview_item_atlas_key);
  if (!supported) diagnostics.push({ code: 'PREVIEW_STATE_ITEM_UNSUPPORTED', severity: 'warning', path, item: identifier, message: '有効なアイテムIDまたは明示的な画像指定がありません。' });
  return {
    ...explicit,
    ...(resourceId && count > 0 ? {
      __jsonui_preview_item_id: resourceId,
      __jsonui_preview_item_count: count,
    } : {}),
    '#is_selected_slot': bool(item.selected, false, `${path}.selected`),
    '#item_id_aux': legacyId !== null && count > 0 ? legacyId * 65536 : 0,
    '#item_stack_count': count > 1 ? String(count) : '', '#inventory_stack_count': count > 1 ? String(count) : '',
    '#trade_item_count': String(count), '#second_trade_item_count': '', '#trade_price_different': false,
    '#item_valid': supported && count > 0, '#inactive_item': false, '#item_grayed_out': false,
    '#bundle_selected_item_visible': false, '#empty_image_visible': false,
    '#hover_text': item.name === undefined ? text(item.id, '', path) : text(item.name, '', path),
  };
}
/**
 * @param {string|object} input JSON文字列またはJSONと等価な通常object。
 * @returns {{mockData:object,collectionData:object,diagnostics:object[],recommendedDefinition:string|null}}
 * @throws {Error} 不正入力は全体拒否。途中まで既存状態へ適用しない。
 */
export function normalizePreviewState(input) {
  if (typeof input === 'string') {
    if (input.length > LIMITS.textBytes || new TextEncoder().encode(input).byteLength > LIMITS.textBytes) fail('PREVIEW_STATE_TEXT_LIMIT', '$');
    try { input = JSON.parse(input); } catch (cause) { const error = new Error('PREVIEW_STATE_JSON_INVALID', { cause }); error.code = 'PREVIEW_STATE_JSON_INVALID'; throw error; }
  }
  const source = copyInput(input);
  if (!record(source)) fail('PREVIEW_STATE_RECORD_REQUIRED', '$');
  const allowed = new Set(['mockData', 'collectionData', 'furnace', 'brewing', 'trade', 'form', 'messageContext', 'inventory', 'slots', 'anvil', 'enchanting', 'horse', 'book', 'font_profile']);
  allowed.add('eventFactorySelections');
  for (const key of Object.keys(source)) if (!allowed.has(key)) fail('PREVIEW_STATE_UNKNOWN_FIELD', key);
  const diagnostics = [], mockData = Object.create(null), collectionData = Object.create(null);
  const messageResolver = createPreviewMessageResolver(source.messageContext);
  if (source.messageContext !== undefined && source.form === undefined) fail('PREVIEW_STATE_MESSAGE_CONTEXT_REQUIRES_FORM', 'messageContext');
  if (source.font_profile !== undefined && !['bitmap', 'observed-smooth'].includes(source.font_profile)) fail('PREVIEW_STATE_FONT_PROFILE', 'font_profile');
  if (source.font_profile === 'observed-smooth') diagnostics.push({ code: 'PREVIEW_STATE_OBSERVED_SMOOTH', severity: 'info', message: '観測smooth字体を明示選択しました。対応資産による描画は実機完全一致の認定ではありません。' });
  let recommendedDefinition = null;
  if (source.inventory !== undefined) {
    const inventory = source.inventory;
    if (!record(inventory)) fail('PREVIEW_STATE_RECORD_REQUIRED', 'inventory');
    fields(inventory, ['main', 'hotbar', 'armor', 'offhand', 'container', 'containerSize'], 'inventory');
    const containerSize = inventory.containerSize ?? 27;
    if (!Number.isInteger(containerSize) || containerSize < 1 || containerSize > 256) fail('PREVIEW_STATE_CONTAINER_SIZE', 'inventory.containerSize');
    for (const [field, name, capacity] of [['main','inventory_items',27],['hotbar','hotbar_items',9],['armor','armor_items',4],['offhand','offhand_items',1],['container','container_items',containerSize]]) {
      const items = inventory[field];
      if (items === undefined) continue;
      if (!Array.isArray(items) || items.length > capacity) fail('PREVIEW_STATE_INVENTORY_SLOTS', `inventory.${field}`);
      collectionData[name] = Array.from({ length: capacity }, (_, index) => items[index] === undefined || items[index] === null
        ? { ...EMPTY_CLASSIC_SLOT_ROW }
        : itemRow(items[index], diagnostics, `inventory.${field}.${index}`));
    }
    recommendedDefinition = inventory.container !== undefined
      ? containerSize === 54 ? 'chest.large_chest_screen' : containerSize === 27 ? 'chest.small_chest_screen' : null
      : 'crafting.inventory_screen';
  }
  if (source.furnace !== undefined) {
    if (!record(source.furnace)) fail('PREVIEW_STATE_RECORD_REQUIRED', 'furnace');
    fields(source.furnace, ['progress','fuel','input','fuelItem','output'], 'furnace');
    const progress = ratio(source.furnace.progress, 0, 'furnace.progress');
    const fuel = ratio(source.furnace.fuel, 0, 'furnace.fuel');
    // Existing image renderer defines clip_ratio as the visible fraction.
    mockData['#furnace_arrow_ratio'] = progress;
    mockData['#furnace_flame_ratio'] = fuel;
    for (const [field, name] of [['input','furnace_ingredient_items'],['fuelItem','furnace_fuel_items'],['output','furnace_output_items']]) {
      if (source.furnace[field] !== undefined) collectionData[name] = [itemRow(source.furnace[field], diagnostics, `furnace.${field}`)];
    }
    recommendedDefinition = 'furnace.furnace_screen';
  }
  if (source.brewing !== undefined) {
    if (!record(source.brewing)) fail('PREVIEW_STATE_RECORD_REQUIRED', 'brewing');
    fields(source.brewing, ['progress','fuel','bubbles','input','fuelItem','outputs'], 'brewing');
    mockData['#brewing_arrow_ratio'] = ratio(source.brewing.progress, 0, 'brewing.progress');
    mockData['#brewing_fuel_ratio'] = ratio(source.brewing.fuel, 0, 'brewing.fuel');
    mockData['#brewing_bubbles_ratio'] = ratio(source.brewing.bubbles, 0, 'brewing.bubbles');
    for (const [field, name] of [['input','brewing_input_item'],['fuelItem','brewing_fuel_item']]) {
      if (source.brewing[field] !== undefined) collectionData[name] = [itemRow(source.brewing[field], diagnostics, `brewing.${field}`)];
    }
    if (source.brewing.outputs !== undefined) {
      if (!Array.isArray(source.brewing.outputs) || source.brewing.outputs.length > 3) fail('PREVIEW_STATE_BREWING_OUTPUTS', 'brewing.outputs');
      // 公開Classic醸造台は3スロット固定。typed入力の省略末尾だけを空状態で補い、
      // 下段のraw collectionDataによる明示上書きはそのまま優先する。
      collectionData.brewing_result_items = Array.from({ length: 3 }, (_, index) => source.brewing.outputs[index] === undefined
        ? { ...EMPTY_CLASSIC_SLOT_ROW }
        : itemRow(source.brewing.outputs[index], diagnostics, `brewing.outputs.${index}`));
    }
    recommendedDefinition = 'brewing_stand.brewing_stand_screen';
  }
  // 型付き指定は描画用の状態。完成品を指定できても、操作時の投入許可にはならない。
  if (source.slots !== undefined) {
    if (!record(source.slots) || Object.keys(source.slots).length > LIMITS.collections) fail('PREVIEW_STATE_COLLECTION_LIMIT', 'slots');
    for (const [name,items] of Object.entries(source.slots)) {
      if (!/^[#A-Za-z_][A-Za-z0-9_.:/#-]{0,127}$/u.test(name) || !Array.isArray(items) || items.length > LIMITS.rows) fail('PREVIEW_STATE_COLLECTION_ROWS', `slots.${name}`);
      collectionData[name] = items.map((item,index) => item === null ? { ...EMPTY_CLASSIC_SLOT_ROW } : itemRow(item,diagnostics,`slots.${name}.${index}`));
    }
  }
  if (source.anvil !== undefined) {
    const data=source.anvil; if (!record(data)) fail('PREVIEW_STATE_RECORD_REQUIRED','anvil');
    fields(data,['input','material','output','name','costText','costRed','costGreen','invalid'],'anvil');
    for (const [field,name] of [['input','anvil_input_items'],['material','anvil_material_items'],['output','anvil_result_items']]) if(data[field] !== undefined) collectionData[name]=[data[field]===null?{...EMPTY_CLASSIC_SLOT_ROW}:itemRow(data[field],diagnostics,`anvil.${field}`)];
    for (const [field,name] of [['name','#text_box_item_name'],['costText','#cost_text']]) if(data[field] !== undefined) mockData[name]=text(data[field],'',`anvil.${field}`);
    for (const [field,name] of [['costRed','#cost_text_red'],['costGreen','#cost_text_green'],['invalid','#cross_out_icon']]) if(data[field] !== undefined) mockData[name]=bool(data[field],false,`anvil.${field}`);
    recommendedDefinition='anvil.anvil_screen';
  }
  if (source.enchanting !== undefined) {
    const data=source.enchanting; if(!record(data))fail('PREVIEW_STATE_RECORD_REQUIRED','enchanting');
    fields(data,['input','lapis','offers'],'enchanting');
    for(const [field,name] of [['input','enchanting_input_items'],['lapis','enchanting_lapis_items']])if(data[field]!==undefined)collectionData[name]=[data[field]===null?{...EMPTY_CLASSIC_SLOT_ROW}:itemRow(data[field],diagnostics,`enchanting.${field}`)];
    if(data.offers!==undefined){
      if(!Array.isArray(data.offers)||data.offers.length>3)fail('PREVIEW_STATE_ENCHANTING_OFFERS','enchanting.offers');
      collectionData['#enchant_buttons']=data.offers.map((offer,index)=>{
        const path=`enchanting.offers.${index}`;if(!record(offer))fail('PREVIEW_STATE_RECORD_REQUIRED',path);
        fields(offer,['runes','cost','hoverText','available'],path);const available=bool(offer.available,true,`${path}.available`);
        return {'#runes':text(offer.runes,'',`${path}.runes`),'#cost':text(offer.cost,'',`${path}.cost`),'#hover_text':text(offer.hoverText,'',`${path}.hoverText`),'#selectable_button_visibility':available,'#unselectable_button_visibility':!available,'#selectable_dust_is_visible':available,'#unselectable_dust_is_visible':!available};
      });
    }
    recommendedDefinition='enchanting.enchanting_screen';
  }
  if (source.horse !== undefined) {
    const data=source.horse;if(!record(data))fail('PREVIEW_STATE_RECORD_REQUIRED','horse');
    fields(data,['equipment','container','equipmentSize','containerSize'],'horse');
    for(const [field,name,sizeField,fallback] of [['equipment','horse_equip_items','equipmentSize',2],['container','container_items','containerSize',15]]){
      const capacity=data[sizeField]??fallback;if(!Number.isInteger(capacity)||capacity<1||capacity>256)fail('PREVIEW_STATE_INVENTORY_SLOTS',`horse.${sizeField}`);
      if(data[field]===undefined)continue;if(!Array.isArray(data[field])||data[field].length>capacity)fail('PREVIEW_STATE_INVENTORY_SLOTS',`horse.${field}`);
      collectionData[name]=Array.from({length:capacity},(_,index)=>data[field][index]===null||data[field][index]===undefined?{...EMPTY_CLASSIC_SLOT_ROW}:itemRow(data[field][index],diagnostics,`horse.${field}.${index}`));
    }
    recommendedDefinition='horse.horse_screen';
  }
  if (source.book !== undefined) {
    const data=source.book;if(!record(data))fail('PREVIEW_STATE_RECORD_REQUIRED','book');
    fields(data,['title','author','pages','editable'],'book');
    for(const [field,name] of [['title','#title_text_box_item_name'],['author','#author_text_box_item_name']])if(data[field]!==undefined)mockData[name]=text(data[field],'',`book.${field}`);
    if(data.editable!==undefined)mockData['#editable']=bool(data.editable,false,'book.editable');
    if(data.pages!==undefined){
      if(!Array.isArray(data.pages)||data.pages.length>LIMITS.rows)fail('PREVIEW_STATE_COLLECTION_ROWS','book.pages');
      const editable=typeof source.mockData?.['#editable']==='boolean'?source.mockData['#editable']:bool(data.editable,true,'book.editable');
      collectionData.book_pages=data.pages.map((page,index)=>({
        '#text_box_item_name':text(page,'',`book.pages.${index}`),'#page_number':`${index+1} / ${data.pages.length}`,
        '#page_visible':true,'#is_text_page':true,'#is_photo_page':false,
        '#editable':editable,'#edit_controls_active':false,'#edit_button_active':editable,
        '#insert_page_active':editable,'#insert_photo_page_active':editable,
        '#swap_left_active':editable&&index>0,'#swap_right_active':editable&&index<data.pages.length-1,
      }));
    }
    recommendedDefinition='book.book_screen';
  }
  if (source.trade !== undefined) {
    const trade = source.trade;
    if (!record(trade) || !Array.isArray(trade.offers) || trade.offers.length > LIMITS.rows) fail('PREVIEW_STATE_TRADE_OFFERS', 'trade.offers');
    fields(trade, ['title','selected','offers','tierName'], 'trade');
    const selected = trade.selected === undefined ? 0 : trade.selected;
    if (!Number.isInteger(selected) || selected < 0 || selected >= Math.max(1, trade.offers.length)) fail('PREVIEW_STATE_TRADE_SELECTION', 'trade.selected');
    const offers = trade.offers.map((offer, index) => {
      if (!record(offer)) fail('PREVIEW_STATE_RECORD_REQUIRED', `trade.offers.${index}`);
      fields(offer, ['input','secondInput','output','unlocked','available'], `trade.offers.${index}`);
      const first = itemRow(offer.input, diagnostics, `trade.offers.${index}.input`);
      const second = offer.secondInput === undefined || offer.secondInput === null
        ? null : itemRow(offer.secondInput, diagnostics, `trade.offers.${index}.secondInput`);
      const output = itemRow(offer.output, diagnostics, `trade.offers.${index}.output`);
      return { first, second, output, unlocked: bool(offer.unlocked, true, `trade.offers.${index}.unlocked`), available: bool(offer.available, true, `trade.offers.${index}.available`) };
    });
    collectionData.trades = offers.map((offer, index) => ({ '#trade_toggle_enabled': offer.unlocked, '#trade_cross_out_visible': !offer.available, '#trade_possible': offer.unlocked && offer.available, '#trade_toggle_state': index === selected, '#padding_around_sell_item': true, '#hover_text': '', __collections: { trade_item_1: [offer.first], trade_item_2: offer.second ? [offer.second] : [], sell_item: [offer.output] } }));
    collectionData.trade_tiers = [{ '#tier_visible': true, '#show_level': true, '#tier_name': text(trade.tierName, 'trade.level.1', 'trade.tierName'), '#is_tier_unlocked': true, '#trade_tier_total': offers.length }];
    // The list receives per-offer nested collections; detail collections use
    // the explicit selected offer. Singleton grid indices remain local.
    const chosen = offers[selected];
    for (const [names, field] of [[['trade_item_1','trade_item_A','trade2_ingredient1_item','trade_ingredient1_items'], 'first'], [['trade_item_2','trade_item_B','trade2_ingredient2_item','trade_ingredient2_items'], 'second'], [['sell_item','trade2_result_item','trade_result_item'], 'output']]) {
      for (const name of names) collectionData[name] = chosen?.[field] ? [chosen[field]] : [];
    }
    Object.assign(mockData, { '#trade_selector_total': 1, '#trade_tier_total': offers.length, '#trade_button_enabled': Boolean(chosen?.unlocked && chosen?.available), '#title_text': text(trade.title, '交易', 'trade.title'), '#name_label': text(trade.title, '交易', 'trade.title'), '#cross_out_icon': Boolean(chosen && !chosen.available), '#show_second_trade_slot': Boolean(chosen?.second?.['#item_valid']), '$second_item_slot_ignored': !chosen?.second });
    recommendedDefinition = 'trade2.trade_screen';
  }
  if (source.form !== undefined) {
    const form = source.form;
    if (!record(form) || (form.type !== undefined && !['action','modal'].includes(form.type))) fail('PREVIEW_STATE_FORM_TYPE_UNSUPPORTED', 'form.type');
    if (form.type === 'modal') {
      const modal = normalizeModalForm(form, messageResolver);
      Object.assign(mockData, modal.mockData); Object.assign(collectionData, modal.collectionData);
      diagnostics.push(...modal.diagnostics); recommendedDefinition = modal.recommendedDefinition;
    } else {
    const rows = actionFormRows(form, messageResolver);
    mockData['#title_text'] = messageResolver.resolve(form.title, '', 'form.title');
    mockData['#form_text'] = messageResolver.resolve(form.body, '', 'form.body');
    mockData['#form_button_contents'] = rows.length;
    collectionData.form_buttons = rows;
    recommendedDefinition = 'server_form.long_form';
    diagnostics.push(...messageResolver.diagnostics);
    diagnostics.push({ code: 'PREVIEW_STATE_FORM_DIRECT_DEFINITION', severity: 'info', message: 'server_form.long_formを選択してください。明示したActionForm表示行を描画します。ScriptAPI実行・イベントfactory自動起動・ボタン応答の送信は再現しません。' });
    }
  }
  if (source.mockData !== undefined) {
    if (!record(source.mockData)) fail('PREVIEW_STATE_RECORD_REQUIRED', 'mockData');
    if (Object.hasOwn(source.mockData, '__collections')) fail('PREVIEW_STATE_USE_COLLECTION_DATA', 'mockData.__collections');
    Object.assign(mockData, source.mockData);
  }
  if (source.collectionData !== undefined) {
    if (!record(source.collectionData)) fail('PREVIEW_STATE_RECORD_REQUIRED', 'collectionData');
    Object.assign(collectionData, source.collectionData);
  }
  let totalRows = 0;
  const maps = [collectionData];
  while (maps.length) {
    const map = maps.pop();
    if (!record(map) || Object.keys(map).length > LIMITS.collections) fail('PREVIEW_STATE_COLLECTION_LIMIT', 'collectionData');
    for (const [name, rows] of Object.entries(map)) {
      if (!name || name.length > 128 || /[\u0000-\u001f]/u.test(name) || !Array.isArray(rows) || rows.length > LIMITS.rows) fail('PREVIEW_STATE_COLLECTION_ROWS', name);
      totalRows += rows.length;
      if (totalRows > 2048 || rows.some((row) => !record(row))) fail('PREVIEW_STATE_COLLECTION_ROWS', name);
      for (const row of rows) if (row.__collections !== undefined) maps.push(row.__collections);
    }
  }
  const eventFactorySelections = normalizeEventFactorySelections38(source.eventFactorySelections ?? mockData.__event_factory_selections);
  delete mockData.__event_factory_selections;
  if (Object.keys(eventFactorySelections).length) {
    mockData.__event_factory_selections = eventFactorySelections;
    const expectedFormBranch = source.form?.type === 'modal' ? 'custom_form' : source.form ? 'long_form' : null;
    if (expectedFormBranch && eventFactorySelections.server_form_factory === expectedFormBranch) {
      recommendedDefinition = 'server_form.main_screen_content';
      for (const item of diagnostics) if (['PREVIEW_STATE_FORM_DIRECT_DEFINITION', 'PREVIEW_STATE_MODAL_DIRECT_DEFINITION'].includes(item.code)) {
        item.code = 'PREVIEW_STATE_FORM_ANCESTOR_DEFINITION';
        item.message = 'server_form.main_screen_contentを選択してください。明示したfactory分岐を祖先サイズ付きで投影します。ScriptAPI実行・応答の送信は再現しません。';
      }
    }
    diagnostics.push({ code: 'PREVIEW_STATE_EVENT_FACTORY_EXPLICIT', severity: 'info',
      message: 'イベントfactory分岐を明示しました。該当factoryを含む祖先UI定義を選択してください。実機のイベント実行ではありません。' });
  }
  return { mockData, collectionData, diagnostics, recommendedDefinition,
    ...(Object.keys(eventFactorySelections).length ? { eventFactorySelections } : {}),
    ...(source.font_profile !== undefined ? { fontProfile: source.font_profile } : {}) };
}
/** 実データではなく、編集可能と明記する再現用プリセット。 */
export function createPreviewStatePreset(kind = 'empty') {
  switch (kind) {
    case 'empty': return { mockData: {}, collectionData: {} };
    case 'furnace': return { furnace: { progress: 0.5, fuel: 0.75 } };
    case 'brewing': return { brewing: { progress: 0.5, fuel: 0.75, bubbles: 0.4 } };
    case 'trade': return { trade: { title: '交易プレビュー', selected: 0, offers: [{ input: { id: 'minecraft:emerald', count: 4 }, output: { id: 'minecraft:diamond', count: 1 }, unlocked: true, available: true }, { input: { id: 'minecraft:iron_ingot', count: 8 }, output: { id: 'minecraft:emerald', count: 1 }, unlocked: false, available: false }] } };
    case 'action_form': return { form: { type: 'action', title: 'デバッグ用フォーム', body: 'ボタン数や文章を変更して、実際のJSON UI定義の表示を確認できます。', buttons: [{ text: 'エメラルド', icon: 'textures/items/emerald' }, { text: '説明を読む' }, { text: '閉じる' }] } };
    case 'inventory': return { inventory: { main: [{ id: 'minecraft:diamond', count: 16 }, null, { id: 'minecraft:iron_ingot', count: 8 }], hotbar: [{ id: 'minecraft:emerald', selected: true }], container: [{ id: 'minecraft:gold_ingot', count: 32 }], containerSize: 27 } };
    case 'anvil': return { anvil: { input: null, material: null, output: null, name: '表示名の例', costText: '3', costRed: false, costGreen: true, invalid: false } };
    case 'enchanting': return { enchanting: { input: null, lapis: null, offers: [{ runes: '表示の例', cost: '1', available: true }, { runes: '表示の例', cost: '2', available: false }, { runes: '表示の例', cost: '3', available: false }] } };
    case 'horse': return { horse: { equipment: [null, null], container: [], equipmentSize: 2, containerSize: 15 } };
    case 'book': return { book: { title: '本のタイトル', author: '著者', pages: ['1ページ目の本文です。', '2ページ目の本文です。'], editable: true } };
    case 'modal_form': return { form: { type: 'modal', title: '設定プレビュー', submitText: '適用', elements: [{ type: 'label', text: '表示する値をJSONで変更できます。' }, { type: 'toggle', text: '通知', value: true }, { type: 'input', text: '名前', value: 'プレイヤー', placeholder: '入力してください' }, { type: 'slider', text: '音量', value: 0.5 }, { type: 'dropdown', text: '難易度', options: ['簡単', '普通', '難しい'], selected: 1 }] } };
    default: fail('PREVIEW_STATE_PRESET_UNKNOWN', String(kind));
  }
}
