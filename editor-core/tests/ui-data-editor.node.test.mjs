import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiDataCatalog, getUiSlotDefinition, getUiSlotAddress } from '../src/ui/ui-data-catalog.js';
import { applyUiDataDraft, createUiCollectionExample, renderUiDataEditor } from '../src/ui/ui-data-editor.js';
import { normalizePreviewState, createPreviewStatePreset } from '../src/engine/preview-state.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { indexItemTextureAtlas, listItemTextureAtlasEntries } from '../src/preview/native-renderer-preview.js';

function model(){return buildUiScreenModelFromJson({namespace:'sample',screen:{type:'screen',controls:[
 {input:{type:'grid',collection_name:'furnace_ingredient_items',grid_dimensions:[1,1],bindings:[{binding_type:'collection',binding_collection_name:'furnace_ingredient_items',binding_name:'#item_valid'}]}},
 {output:{type:'grid',collection_name:'furnace_output_items',grid_dimensions:[1,1]}},
 {inventory:{type:'grid',collection_name:'inventory_items',grid_dimensions:[9,3]}},
 {title:{type:'edit_box',text_box_name:'#title',max_length:30,controls:[{display:{type:'label',bindings:[{binding_name:'#title_input',binding_name_override:'#text'}]}}]}},
 {page:{type:'edit_box',text_box_name:'#page',max_length:'$unresolved',text_edit_box_grid_collection_name:'book_pages',controls:[{display:{type:'label',bindings:[{binding_name:'#text_box_item_name',binding_name_override:'#text',binding_type:'collection',binding_collection_name:'book_pages'}]}}]}},
 ]}}, {filePath:'ui/sample.json'});}
function dom(){const rows=[];function h(tag,attrs={},children=[]){const el={tag,attrs,children,value:attrs.value??'',textContent:'',disabled:attrs.disabled||false,replaceChildren(...children){this.children=children;}};rows.push(el);return el;}return {h,rows};}
const catalog=()=>buildUiDataCatalog(model());
function flat(state){const normalized=normalizePreviewState(state);return {...normalized.mockData,__collections:normalized.collectionData};}

test('選択modelに存在するスロットと一覧だけを種類別に列挙する',()=>{
 const c=catalog();assert.equal(c.slots.length,3);assert.ok(c.collections.some(row=>row.name==='book_pages'));assert.ok(!c.slots.some(row=>row.collection==='horse_equip_items'));
 assert.equal(c.slots.find(row=>row.collection==='inventory_items').capacity,27);assert.equal(c.slots.find(row=>row.collection==='furnace_output_items').role,'output');
});
test('resultという名前でも醸造台の瓶は完成品扱いにしない',()=>{assert.equal(getUiSlotDefinition('brewing_result_items').role,'restricted');assert.equal(getUiSlotDefinition('brewing_result_items').acceptance,'bottle');});
test('共通スロットaddressは0始まり、不正indexと危険なnameを拒否する',()=>{
 assert.deepEqual(getUiSlotAddress('inventory_items',0),{collection:'inventory_items',index:0});for(const index of [-1,256,0.5,NaN])assert.throws(()=>getUiSlotAddress('inventory_items',index));assert.throws(()=>getUiSlotAddress('__proto__\n',0));
});
test('未知collectionは一覧として残し、根拠なくアイテムslotと認定しない',()=>{
 const c=buildUiDataCatalog({root:{props:{collection_name:'custom_rows'},bindings:[{binding_name:'#label',binding_type:'collection',binding_collection_name:'custom_rows'}],children:[]}});assert.equal(c.slots.length,0);assert.deepEqual(c.collections[0].bindings,['#label']);
});
test('文字入力の表示bindingとcollectionを継承済み子要素から得る',()=>{
 const c=catalog();const title=c.textFields.find(row=>row.label==='#title'),page=c.textFields.find(row=>row.label==='#page');assert.equal(title.binding,'#title_input');assert.equal(title.maxLength,30);assert.equal(page.binding,'#text_box_item_name');assert.equal(page.collection,'book_pages');assert.equal(page.maxLength,null);
});
test('文字数上限0を未指定として扱わない',()=>{const c=buildUiDataCatalog({root:{type:'edit_box',id:'x',props:{max_length:0,text_box_name:'#x'},localVariables:{$text_edit_box_content_binding_name:'#v'}}});assert.equal(c.textFields[0].maxLength,0);assert.throws(()=>applyUiDataDraft({},[{kind:'text',fieldId:'x',value:'a'}],{catalog:c}),/最大0/);});
test('20,000ノードの走査上限と循環検出で終了しmodelキャッシュを再利用する',()=>{
 const root={children:[]};for(let i=0;i<20002;i++)root.children.push({children:[]});root.children.push(root);const m={root};const c=buildUiDataCatalog(m);assert.equal(c.truncated,true);assert.ok(c.visited<=20001);assert.equal(buildUiDataCatalog(m),c);
});
test('局所変数とdefaultを解決してcollectionを抽出する',()=>{
 const c=buildUiDataCatalog({root:{localVariables:{$collection:'furnace_fuel_items'},children:[{localVariables:{'$collection|default':'other'},props:{collection_name:'$collection'},bindings:[{binding_type:'collection',binding_collection_name:'$collection',binding_name:'#item_id_aux'}]}]}});assert.ok(c.slots.some(row=>row.collection==='furnace_fuel_items'));assert.ok(!c.collections.some(row=>row.name==='other'));
});
test('描画用スロット設定は不足枠を空データで補いmetadataを保持する',()=>{
 const out=applyUiDataDraft({},[{kind:'slot',collection:'inventory_items',index:12,item:{id:'diamond',count:16}}],{catalog:catalog()});assert.equal(out.collectionData.inventory_items.length,27);assert.equal(out.collectionData.inventory_items[0]['#item_valid'],false);assert.equal(out.collectionData.inventory_items[12].__jsonui_preview_item_id,'minecraft:diamond');assert.equal(out.collectionData.inventory_items[12].__jsonui_preview_item_count,16);
});
test('完成品slotは表示用設定可能、実際の移動許可とは区別する',()=>{
 const out=applyUiDataDraft({},[{kind:'slot',collection:'furnace_output_items',index:0,item:{id:'iron_ingot'}}],{catalog:catalog()});assert.equal(out.collectionData.furnace_output_items[0]['#item_valid'],true);assert.equal(getUiSlotDefinition('furnace_output_items').role,'output');
});
test('未知idに確認済みatlasKeyを明示すると表示sourceを保持する',()=>{
 const out=normalizePreviewState({slots:{custom_slots:[{id:'minecraft:lapis_lazuli',atlasKey:'dye',variant:4,count:3}]}});assert.equal(out.diagnostics.length,0);assert.equal(out.collectionData.custom_slots[0].__jsonui_preview_item_id,'minecraft:lapis_lazuli');assert.equal(out.collectionData.custom_slots[0].__jsonui_preview_item_atlas_key,'dye');assert.equal(out.collectionData.custom_slots[0].__jsonui_preview_item_variant,4);
});
test('構文が正しい任意idを保持してパックの画像解決へ渡す',()=>{const out=normalizePreviewState({slots:{custom_slots:[{id:'example:unknown'}]}});assert.equal(out.collectionData.custom_slots[0]['#item_valid'],true);assert.equal(out.collectionData.custom_slots[0].__jsonui_preview_item_id,'example:unknown');assert.equal(out.diagnostics.length,0);});
test('スロットを空にするとitem identityを残さない',()=>{
 const current=flat({inventory:{main:[{id:'diamond'}]}}),out=applyUiDataDraft(current,[{kind:'slot',collection:'inventory_items',index:0,item:null}],{catalog:catalog()});assert.equal(out.collectionData.inventory_items[0]['#item_valid'],false);assert.ok(!Object.hasOwn(out.collectionData.inventory_items[0],'__jsonui_preview_item_id'));assert.equal(current.__collections.inventory_items[0]['#item_valid'],true);
});
test('別UIのslot・超過index・不正画像sourceの原子適用は全体拒否',()=>{
 const current=flat({inventory:{main:[{id:'diamond'}]}});for(const op of [{kind:'slot',collection:'horse_equip_items',index:0,item:null},{kind:'slot',collection:'inventory_items',index:27,item:null},{kind:'slot',collection:'inventory_items',index:0,item:{texture:'textures/a',atlasKey:'a'}}])assert.throws(()=>applyUiDataDraft(current,[{kind:'slot',collection:'inventory_items',index:0,item:null},op],{catalog:catalog()}));assert.equal(current.__collections.inventory_items[0]['#item_valid'],true);
});
test('一般値false/0/空を保ち一覧行だけ変更する',()=>{
 const current={'#false':false,'#zero':0,'#empty':'',__collections:{book_pages:[{'#text_box_item_name':'前','#page_visible':false}]}};const c=catalog(),field=c.textFields.find(row=>row.collection==='book_pages');
 const out=applyUiDataDraft(current,[{kind:'text',fieldId:field.id,index:0,value:''}],{catalog:c});assert.equal(out.mockData['#false'],false);assert.equal(out.mockData['#zero'],0);assert.equal(out.mockData['#empty'],'');assert.equal(out.collectionData.book_pages[0]['#page_visible'],false);assert.equal(out.collectionData.book_pages[0]['#text_box_item_name'],'');assert.equal(current.__collections.book_pages[0]['#text_box_item_name'],'前');
});
test('入力欄の上限は適用でも検査して超過を切り捨てない',()=>{
 const c=catalog(),field=c.textFields.find(row=>row.label==='#title');assert.throws(()=>applyUiDataDraft({},[{kind:'text',fieldId:field.id,value:'x'.repeat(31)}],{catalog:c}),/最大30/);assert.equal(applyUiDataDraft({},[{kind:'text',fieldId:field.id,value:'x'.repeat(30)}],{catalog:c}).mockData['#title_input'].length,30);
});
test('collection未作成への文字入力は空の余分な行を作らず案内する',()=>{const c=catalog(),field=c.textFields.find(row=>row.collection==='book_pages');assert.throws(()=>applyUiDataDraft({},[{kind:'text',fieldId:field.id,index:0,value:'a'}],{catalog:c}),/先に/);});
test('一覧の空指定・不正JSONオブジェクト・汚染keyの境界',()=>{
 const c=catalog();assert.deepEqual(applyUiDataDraft({__collections:{book_pages:[{}]}},[{kind:'collection',collection:'book_pages',rows:[]}],{catalog:c}).collectionData.book_pages,[]);
 assert.throws(()=>applyUiDataDraft({},[{kind:'collection',collection:'book_pages',rows:{}}],{catalog:c}));assert.throws(()=>applyUiDataDraft({},[{kind:'collection',collection:'book_pages',rows:JSON.parse('[{"__proto__":{"x":1}}]')}],{catalog:c}),/UNSAFE_KEY/);assert.equal({}.x,undefined);
});
test('金床・エンチャント・動物・本のtyped状態で値を正規化する',()=>{
 const out=normalizePreviewState({anvil:{input:{id:'diamond'},material:null,name:'',costText:'0',costRed:false},enchanting:{lapis:{id:'lapis_lazuli',atlasKey:'dye',variant:4},offers:[{runes:'文字',cost:'3',available:false}]},horse:{equipment:[null,{id:'saddle',atlasKey:'saddle'}],container:[],containerSize:15},book:{title:'題名',author:'作者',pages:['本文',''],editable:false}});
 assert.equal(out.mockData['#text_box_item_name'],'');assert.equal(out.mockData['#cost_text_red'],false);assert.equal(out.collectionData.anvil_material_items[0]['#item_valid'],false);assert.equal(out.collectionData['#enchant_buttons'][0]['#selectable_button_visibility'],false);assert.equal(out.collectionData.horse_equip_items.length,2);assert.equal(out.collectionData.container_items.length,15);assert.equal(out.collectionData.book_pages[1]['#text_box_item_name'],'');assert.equal(out.mockData['#editable'],false);
});
test('既存furnace/brewingのnull拒否を維持し、新slotsのnullで空にできる',()=>{
 for(const input of [{furnace:{input:null}},{brewing:{input:null}},{brewing:{outputs:[null]}}])assert.throws(()=>normalizePreviewState(input),{code:'PREVIEW_STATE_ITEM_REQUIRED'});
 const out=normalizePreviewState({slots:{furnace_output_items:[null],brewing_result_items:[null,null,null]}});assert.equal(out.collectionData.furnace_output_items[0]['#item_valid'],false);assert.equal(out.collectionData.brewing_result_items.length,3);assert.ok(out.collectionData.brewing_result_items.every(row=>row['#item_valid']===false));
});
test('typedエラーは根拠のないフィールドや巨大一覧を拒否する',()=>{
 for(const value of [{anvil:{hidden:'x'}},{enchanting:{offers:[{available:'false'}]}},{horse:{equipmentSize:257}},{book:{pages:[false]}},{slots:{inventory_items:Array.from({length:257},()=>null)}}])assert.throws(()=>normalizePreviewState(value));
});
test('raw collectionとmockData明示上書きはtypedより優先する',()=>{
 const out=normalizePreviewState({book:{pages:['x'],title:'x'},collectionData:{book_pages:[]},mockData:{'#title_text_box_item_name':''}});assert.deepEqual(out.collectionData.book_pages,[]);assert.equal(out.mockData['#title_text_box_item_name'],'');
});
test('閉じたdata panelはmodelを走査せず展開時に初回描画する',()=>{
 const d=dom(),state={};let reads=0;const m={get root(){reads++;return model().root;}};const ui=renderUiDataEditor(d.h,{model:m,state,onApply(){}});assert.equal(reads,0);ui.attrs.onToggle({currentTarget:{open:true}});assert.ok(reads>0);assert.ok(d.rows.some(row=>row.attrs.class==='ui-data-list'));
});
test('選択されたスロットにだけフォームを作成する',()=>{
 const d=dom(),state={open:true};renderUiDataEditor(d.h,{model:model(),state,onApply(){}});assert.equal(d.rows.filter(row=>row.attrs['aria-label']==='アイテムID').length,0);d.rows.find(row=>row.attrs.class==='btn ui-data-choice').attrs.onClick();assert.equal(d.rows.filter(row=>row.attrs['aria-label']==='アイテムID').length,1);
});
test('入力中draftを維持し、apply失敗では消さない',()=>{
 const d=dom(),state={open:true,selected:'inventory_items'};renderUiDataEditor(d.h,{model:model(),state,onApply(){throw Error('状態JSON編集中');}});const id=d.rows.find(row=>row.attrs['aria-label']==='アイテムID');id.value='minecraft:diamond';id.attrs.onInput({currentTarget:id});d.rows.find(row=>row.children.includes('このスロットへ設定')).attrs.onClick();assert.equal(state.drafts.slot.id,'minecraft:diamond');assert.match(d.rows.find(row=>row.attrs.role==='status').textContent,/状態JSON編集中/);
});
test('操作未適用の編集用例と実際のapplyを区別する',()=>{
 const d=dom(),state={open:true,mode:'collections',selected:'book_pages'};let calls=0;renderUiDataEditor(d.h,{model:model(),state,onApply(){calls++;return true;}});d.rows.find(row=>row.children.includes('編集用の例を入力')).attrs.onClick();assert.equal(calls,0);assert.match(state.drafts.collectionText,/1ページ目/);d.rows.find(row=>row.children.includes('この一覧を適用')).attrs.onClick();assert.equal(calls,1);
});
test('最新stateへ追従する更新は入力中のDOMを保持する',async()=>{
 const d=dom(),state={open:true,selected:'inventory_items'};let current=flat({inventory:{main:[{id:'diamond'}]}});const ui=renderUiDataEditor(d.h,{model:model(),state,getCurrent:()=>current,onApply(){}}),active={};ui.ownerDocument={activeElement:active};ui.contains=x=>x===active;
 const before=d.rows.filter(row=>row.attrs['aria-label']==='アイテムID').at(-1);current=flat({inventory:{main:[{id:'emerald'}]}});ui.refreshUiData();assert.equal(d.rows.filter(row=>row.attrs['aria-label']==='アイテムID').at(-1),before);ui.ownerDocument.activeElement=null;ui.attrs.onFocusout();await Promise.resolve();assert.equal(d.rows.filter(row=>row.attrs['aria-label']==='アイテムID').at(-1).value,'minecraft:emerald');
});
test('book編集例は再現用の明示データを返し呼び出し間で共有しない',()=>{const a=createUiCollectionExample('book_pages'),b=createUiCollectionExample('book_pages');a[0]['#text_box_item_name']='changed';assert.notEqual(a[0]['#text_box_item_name'],b[0]['#text_box_item_name']);});
test('確認済みatlasの候補取得は上限を守り内部Mapを公開しない',()=>{
 const parsed=indexItemTextureAtlas({texture_data:{diamond:{textures:'textures/items/diamond'},dye:{textures:['textures/items/a','textures/items/b']}}});assert.equal(parsed.ok,true);const entries=listItemTextureAtlasEntries(parsed.atlas,{limit:1});assert.equal(entries.length,1);assert.equal(entries[0].atlasKey,'diamond');assert.ok(Object.isFrozen(entries));assert.ok(Object.isFrozen(entries[0]));assert.equal(listItemTextureAtlasEntries(parsed.atlas)[1].variantCount,2);assert.deepEqual(listItemTextureAtlasEntries({},{}),[]);assert.deepEqual(listItemTextureAtlasEntries(parsed.atlas,{limit:0}),[]);
});
test('アイテムrendererだけのレシピ候補を投入可能slotへ誤分類しない',()=>{
 const c=buildUiDataCatalog({root:{localVariables:{$item_collection_name:'recipe_book'},props:{renderer:'inventory_item_renderer'}}});assert.equal(c.slots.length,0);assert.equal(c.collections[0].name,'recipe_book');
 const custom=buildUiDataCatalog({root:{localVariables:{$item_collection_name:'custom_icons'},props:{renderer:'inventory_item_renderer'}}});assert.equal(custom.slots[0].role,'unknown');assert.equal(custom.slots[0].acceptance,'unknown');
});
test('解決時のcollection_indexから動物UI等の実体化済み枠数を得る',()=>{
 const c=buildUiDataCatalog({root:{children:[0,1].map(collection_index=>({props:{__jsonui_preview_collection_name:'horse_equip_items',collection_index}}))}});assert.equal(c.slots[0].capacity,2);
});
test('atlas候補は128 DOM件まで、検索で後半にあるキーも選べる',()=>{
 const d=dom(),state={open:true,selected:'inventory_items'},itemCatalog=Array.from({length:4096},(_,i)=>({atlasKey:`key_${i}`,label:`画像${i}`}));renderUiDataEditor(d.h,{model:model(),state,itemCatalog,onApply(){}});const list=d.rows.find(row=>row.tag==='datalist');assert.equal(list.children.length,128);const input=d.rows.find(row=>row.attrs['aria-label']==='アイテム画像のatlasKey');input.value='key_4095';input.attrs.onInput({currentTarget:input});assert.equal(list.children.length,1);assert.equal(list.children[0].attrs.value,'key_4095');
});
test('交易等の入れ子collectionを外側へ誤設定せず親一覧の編集へ案内する',()=>{
 const c=buildUiDataCatalog({root:{props:{collection_name:'trades'},children:[{props:{__jsonui_preview_collection_name:'trades',collection_index:0},children:[{props:{__jsonui_preview_collection_name:'trade_item_1',collection_index:0,collection_name:'trade_item_1'}}]}]}});
 assert.equal(c.collections.find(row=>row.name==='trades').nestedOnly,false);assert.equal(c.slots.find(row=>row.collection==='trade_item_1').nestedOnly,true);
 assert.throws(()=>applyUiDataDraft({},[{kind:'slot',collection:'trade_item_1',index:0,item:{id:'diamond'}}],{catalog:c}),/親の一覧/);
 const out=applyUiDataDraft({},[{kind:'collection',collection:'trades',rows:[{__collections:{trade_item_1:[{'#item_valid':false}]}}]}],{catalog:c});assert.equal(out.collectionData.trades[0].__collections.trade_item_1[0]['#item_valid'],false);
});
test('新しい4種類の状態例は共通正規化を通過し独立に編集できる',()=>{
 for(const kind of ['anvil','enchanting','horse','book']){const a=createPreviewStatePreset(kind),b=createPreviewStatePreset(kind);const out=normalizePreviewState(a);assert.ok(out.recommendedDefinition);assert.notEqual(a[kind],b[kind]);}
});
test('本の本文挿入後もペンが表示され編集panelの初期状態を維持する',()=>{
 for(const rows of [normalizePreviewState(createPreviewStatePreset('book')).collectionData.book_pages,createUiCollectionExample('book_pages')]){
  assert.equal(rows[0]['#edit_button_active'],true);assert.equal(rows[0]['#edit_controls_active'],false);assert.equal(rows[0]['#editable'],true);assert.equal(rows[0]['#swap_left_active'],false);assert.equal(rows[0]['#swap_right_active'],true);assert.equal(rows[1]['#swap_left_active'],true);assert.equal(rows[1]['#swap_right_active'],false);
 }
});
test('読み取り専用の本は本文と番号を残し編集ボタンを無効にする',()=>{
 for(const source of [{book:{pages:['a'],editable:false}},{book:{pages:['a'],editable:true},mockData:{'#editable':false}}]){
  const row=normalizePreviewState(source).collectionData.book_pages[0];assert.equal(row['#text_box_item_name'],'a');assert.equal(row['#page_number'],'1 / 1');for(const key of ['#editable','#edit_button_active','#insert_page_active','#swap_left_active','#swap_right_active'])assert.equal(row[key],false);
 }
});
