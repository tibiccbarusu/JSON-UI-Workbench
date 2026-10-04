import { siteText, getSiteLocale } from '../i18n/site-messages.js';
/** 選択中の解決済みモデルから、値・一覧・スロット・入力欄を列挙する。DOM/I/Oなし。 */
import { buildRuntimeInputCatalog } from './runtime-input-editor.js';

let cache = new WeakMap();
let cacheLocale = getSiteLocale();
const validName = /^[#A-Za-z_][A-Za-z0-9_.:/#-]{0,127}$/u;
const SLOT_ROWS = [
  ['inventory_items','持ち物',27,'any'], ['hotbar_items','ホットバー',9,'any'],
  ['armor_items','防具',4,'equipment'], ['offhand_items','オフハンド',1,'offhand'],
  ['container_items','コンテナー',null,'any'], ['crafting_input_items','クラフト素材',null,'any'],
  ['crafting_output_items','クラフト結果',1,'output'], ['crafting_result_items','クラフト結果',1,'output'],
  ['furnace_ingredient_items','かまどの素材',1,'smeltable'], ['furnace_fuel_items','かまどの燃料',1,'fuel'], ['furnace_output_items','かまどの完成品',1,'output'],
  ['brewing_input_item','醸造素材',1,'brewing_ingredient'], ['brewing_fuel_item','醸造台の燃料',1,'blaze_powder'], ['brewing_result_items','醸造台の瓶',3,'bottle'],
  ['anvil_input_items','金床の対象',1,'any'], ['anvil_material_items','金床の追加素材',1,'any'], ['anvil_result_items','金床の完成品',1,'output'],
  ['enchanting_input_items','エンチャント対象',1,'enchantable'], ['enchanting_lapis_items','ラピスラズリ',1,'lapis'],
  ['horse_equip_items','動物の装備',null,'animal_equipment'],
  ['beacon_payment_items','ビーコンの支払い',1,'beacon_payment'],
  ['grindstone_input_items','砥石の対象',1,'any'], ['grindstone_additional_items','砥石の追加素材',1,'any'], ['grindstone_result_items','砥石の完成品',1,'output'],
  ['smithing_table_input_items','鍛冶台の対象',1,'any'], ['smithing_table_material_items','鍛冶台の素材',1,'any'], ['smithing_table_template_items','鍛冶型',1,'smithing_template'], ['smithing_table_result_items','鍛冶台の完成品',1,'output'],
  ['loom_input_items','旗',1,'banner'], ['loom_dye_items','染料',1,'dye'], ['loom_material_items','旗の模様',1,'banner_pattern'], ['loom_result_items','織機の完成品',1,'output'],
  ['stonecutter_input_items','石切台の素材',1,'stonecuttable'], ['stonecutter_result_items','石切台の完成品',1,'output'],
  ['cartography_input_items','製図台の地図',1,'map'], ['cartography_additional_items','製図台の追加素材',1,'cartography_material'], ['cartography_result_items','製図台の完成品',1,'output'],
  ['trade2_ingredient1_item','交易の支払い1',1,'trade_input'], ['trade2_ingredient2_item','交易の支払い2',1,'trade_input'], ['trade2_result_item','交易の受取品',1,'output'],
  ['trade_ingredient1_items','交易の支払い1',1,'trade_input'], ['trade_ingredient2_items','交易の支払い2',1,'trade_input'], ['trade_result_item','交易の受取品',1,'output'],
  ['trade_item_1','交易候補の支払い1',1,'trade_input'], ['trade_item_2','交易候補の支払い2',1,'trade_input'], ['sell_item','交易候補の受取品',1,'output'],
];
const slots = new Map(SLOT_ROWS.map(([collection,label,capacity,acceptance]) => [collection, Object.freeze({collection,label,capacity,acceptance,role: acceptance === 'output' ? 'output' : acceptance === 'any' ? 'storage' : 'restricted'})]));
const collectionLabels = { book_pages:'本のページ', '#enchant_buttons':'エンチャント候補', trades:'交易候補', trade_tiers:'交易レベル', form_buttons:'フォームのボタン', modal_elements:'フォームの入力項目', recipe_book:'レシピ一覧', patterns:'旗の模様一覧', stones:'石切台の候補' };
export function getUiSlotDefinition(collection) {
  const definition = slots.get(collection);
  return definition ? Object.freeze({ ...definition, label: siteText(definition.label) }) : null;
}
export function getUiSlotAddress(collection, index) {
  if (!validName.test(collection) || !Number.isInteger(index) || index < 0 || index > 255) throw new Error(siteText('スロットの指定が不正です。'));
  return Object.freeze({ collection, index });
}
const inspectedProps=['collection_name','grid_dimensions','renderer','max_length','text_box_name','text_edit_box_grid_collection_name','text_type','__jsonui_preview_collection_name','collection_index'];
function props(node) {
  const result={};
  for(const key of inspectedProps)result[key]=Object.hasOwn(node.props||{},key)?node.props[key]:node.unknownProps?.[key];
  return result;
}
function resolve(value, variables) {
  const seen = new Set();
  while (typeof value === 'string' && value.startsWith('$') && Object.hasOwn(variables,value) && !seen.has(value) && seen.size < 32) { seen.add(value); value = variables[value]; }
  return value;
}
function scopeOf(parent, local) {
  const out = { ...parent };
  for (const [key,value] of Object.entries(local || {})) {
    if (key.endsWith('|default')) { const name = key.slice(0,-8); if (!Object.hasOwn(out,name)) out[name] = value; }
    else out[key] = value;
  }
  return out;
}
/** キャッシュはモデル単位。20,000ノード・2,048収集先で打ち切りを明示する。 */
export function buildUiDataCatalog(model) {
  if (cacheLocale !== getSiteLocale()) { cacheLocale = getSiteLocale(); cache = new WeakMap(); }
  if (!model || typeof model !== 'object' || !model.root) return { bindings:[], collections:[], slots:[], textFields:[], visited:0, truncated:false };
  if (cache.has(model)) return cache.get(model);
  const basic = buildRuntimeInputCatalog(model), collections = new Map(), textFields = [], seen = new Set();
  const pending = [{node:model.root,variables:{},edit:null,rowScopes:[]}]; let visited = 0, truncated = basic.truncated;
  const addCollection = (name,node,p,variables,rowScopes) => {
    name = resolve(name,variables); if (typeof name !== 'string' || !validName.test(name)) return null;
    if (!collections.has(name)) { if (collections.size >= 2048) { truncated = true; return null; } collections.set(name,{name,label:siteText(slots.get(name)?.label) || siteText(collectionLabels[name]) || name,bindings:new Set(),nodeIds:[],capacity:null,hasRootScope:false,nestedParents:new Set()}); }
    const row=collections.get(name); if (row.nodeIds.length < 64 && !row.nodeIds.includes(node.id)) row.nodeIds.push(node.id);
    const parents=rowScopes.filter(scope=>scope!==name);
    if(!parents.length)row.hasRootScope=true;else for(const parent of parents)row.nestedParents.add(parent);
    const dimensions=resolve(p.grid_dimensions,variables);
    if (resolve(p.collection_name,variables) === name && Array.isArray(dimensions) && dimensions.length === 2 && dimensions.every(x=>Number.isInteger(x)&&x>0) && dimensions[0]*dimensions[1]<=256) row.capacity=Math.max(row.capacity||0,dimensions[0]*dimensions[1]);
    if (resolve(p.__jsonui_preview_collection_name,variables) === name && Number.isInteger(p.collection_index) && p.collection_index>=0 && p.collection_index<256) row.capacity=Math.max(row.capacity||0,p.collection_index+1);
    if (resolve(p.renderer,variables) === 'inventory_item_renderer') row.itemRenderer=true;
    return row;
  };
  while(pending.length) {
    const {node,variables:parent,edit:parentEdit,rowScopes:parentScopes}=pending.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    if (++visited > 20000) { truncated=true; break; } seen.add(node);
    const variables=scopeOf(parent,node.localVariables), p=props(node);
    const ownScope=resolve(p.__jsonui_preview_collection_name,variables);
    const rowScopes=typeof ownScope==='string'&&validName.test(ownScope)&&parentScopes.at(-1)!==ownScope?[...parentScopes.slice(-23),ownScope]:parentScopes;
    let edit=parentEdit;
    if (node.type === 'edit_box') {
      const maxLength=resolve(p.max_length,variables), name=resolve(p.text_box_name,variables);
      const labels={'#author_text_box':siteText('本の著者'),'#title_text_box':siteText('本のタイトル'),'#page_text_box':node.key?.local_name?.includes('caption')?siteText('写真の説明'):siteText('本の本文')};
      const label=labels[name] || (name==='#text_box_name' && model.namespace==='anvil'?siteText('金床の名前'):name==='#text_box_name'&&['crafting','furnace','smoker','blast_furnace'].includes(model.namespace)?siteText('レシピ検索'):typeof name==='string'?name:(node.key?.local_name || siteText('文字入力')));
      edit={id:String(node.id || `input-${textFields.length}`),nodeId:node.id,label,controlName:node.key?.local_name||null,binding:null,collection:null,maxLength:Number.isInteger(maxLength)&&maxLength>=0?maxLength:null,textType:resolve(p.text_type,variables)||null};
      const content=resolve(variables.$text_edit_box_content_binding_name || variables.$text_edit_binding_name,variables);
      if(typeof content==='string'&&content.startsWith('#')&&validName.test(content)) edit.binding=content;
      const collection=resolve(p.text_edit_box_grid_collection_name || variables.$text_edit_box_grid_collection_name,variables);
      if(typeof collection==='string'&&validName.test(collection)) edit.collection=collection;
      if(textFields.length<2048) textFields.push(edit); else truncated=true;
    }
    for(const name of [p.collection_name,variables.$item_collection_name,p.text_edit_box_grid_collection_name,p.__jsonui_preview_collection_name]) addCollection(name,node,p,variables,rowScopes);
    for(const binding of node.bindings || []) {
      if(!binding||binding.ignored===true)continue;
      const type=resolve(binding.binding_type,variables), name=resolve(binding.binding_name,variables), collection=resolve(binding.binding_collection_name,variables);
      if(type==='collection'||type==='collection_details') { const row=addCollection(collection,node,p,variables,rowScopes);if(row&&typeof name==='string'&&validName.test(name))row.bindings.add(name); }
      const target=resolve(binding.binding_name_override || binding.target_property_name,variables);
      if(edit && type!=='view' && !binding.source_control_name && typeof name==='string'&&name.startsWith('#')&&validName.test(name) && (target==='#text'||target==='#text_box_content'||name==='#text_box_item_name')) {
        if(!edit.binding)edit.binding=name;
        if(type==='collection'&&typeof collection==='string'&&validName.test(collection))edit.collection=collection;
      }
    }
    if(Array.isArray(node.children))for(const child of node.children)pending.push({node:child,variables,edit,rowScopes});
  }
  const rows=[...collections.values()].map(row=>Object.freeze({...row,bindings:[...row.bindings].sort(),nestedParents:[...row.nestedParents],nestedOnly:!row.hasRootScope})).sort((a,b)=>a.label.localeCompare(b.label,getSiteLocale() === 'en_US' ? 'en' : 'ja'));
  const result=Object.freeze({bindings:basic.inputs,collections:rows,slots:rows.filter(row=>slots.has(row.name)||(row.itemRenderer&&!Object.hasOwn(collectionLabels,row.name))).map(row=>Object.freeze({...getUiSlotDefinition(row.name)||{collection:row.name,label:siteText`${row.label}（アイテム表示・用途未確認）`,capacity:row.capacity,acceptance:'unknown',role:'unknown'},capacity:row.capacity || slots.get(row.name)?.capacity || null,nodeIds:row.nodeIds,nestedOnly:row.nestedOnly,nestedParents:row.nestedParents})),textFields:textFields.map(Object.freeze),visited,truncated});
  cache.set(model,result);return result;
}
