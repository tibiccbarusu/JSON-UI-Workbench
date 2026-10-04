import test from 'node:test';
import assert from 'node:assert/strict';
import { safeEvalExpression } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { compilePreviewAnimations, samplePreviewAnimations, collectPreviewAnimationDefinitions } from '../../editor-core/src/engine/preview-animation.js';
import { PREVIEW_ANIMATION_EASING_NAMES } from '../../editor-core/src/engine/animation-easing.js';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { buildRepresentativeClassicCollections } from '../../editor-core/src/engine/representative-classic-runtime.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
const fade={anim_type:'alpha',from:0,to:1,duration:1};
const model=(props={})=>({namespace:'a',root:{id:'root',props,unknownProps:{},children:[]}});
const plan=(definition,props={})=>compilePreviewAnimations(model({anims:['@a.fade'],...props}),{definitions:{'a.fade':definition}});
const catalogOf=(documents)=>buildUiCatalog({sources:[{id:'fixture',kind:'imported',precedence:10,filePaths:Object.keys(documents),readText:async p=>JSON.stringify(documents[p])}],parseJsonc});
test('式構文キャッシュは同じ式の状態更新・異なる行・未知値を固定しない',()=>{
 const expression='(#count * 2 + $offset)';
 for(let n=0;n<100;n++)assert.equal(safeEvalExpression(expression,{props:{count:n,'$offset':3},mockData:{}}),n*2+3);
 assert.equal(safeEvalExpression(expression,{props:{},mockData:{}}),undefined);
 assert.equal(safeEvalExpression(expression,{props:{count:4,'$offset':7},mockData:{}}),15);
 for(let n=0;n<600;n++)assert.equal(safeEvalExpression(`${n} + 1`,{}),n+1);
 assert.equal(safeEvalExpression(expression,{props:{count:1,'$offset':0}}),2);
 assert.equal(safeEvalExpression('globalThis.process.exit()',{}),undefined);
});
test('バニラで使用する指数・quint・back曲線は線形に置き換えない',()=>{
 for(const [easing,expected] of [['in_expo',1/32],['out_expo',31/32],['in_quint',1/32],['out_back',1.0876975]]){
  const p=plan({...fade,easing});assert.equal(p.tracks.length,1);assert(Math.abs(samplePreviewAnimations(p,.5).propsById.root.alpha-expected)<1e-10,easing);
 }
});
test('31補間曲線は開始/終端を厳密保持し有限値だけを出す',()=>{
 assert.equal(PREVIEW_ANIMATION_EASING_NAMES.length,31);
 for(const easing of PREVIEW_ANIMATION_EASING_NAMES){
  const p=plan({...fade,easing});assert.equal(samplePreviewAnimations(p,0).propsById.root.alpha,0);assert.equal(samplePreviewAnimations(p,1).propsById.root.alpha,1);
  for(let n=1;n<20;n++)assert(Number.isFinite(samplePreviewAnimations(p,n/20).propsById.root.alpha),easing);
 }
});
test('animationは条件付き変数のplay_eventを列挙し選択したeventだけを開始',()=>{
 const ui=model({anims:['@a.fade'],'$exit':true});
 const definition={...fade,play_event:'$event',variables:[{requires:'($exit)', '$event':'screen.exit_pop','$length':3}],duration:'$length'};
 const data={definitions:{'a.fade':definition}};
 const entrance=compilePreviewAnimations(ui,data);assert.deepEqual(entrance.availableEvents,['screen.exit_pop']);assert.equal(entrance.tracks.length,0);
 const exit=compilePreviewAnimations(ui,{...data,event:'screen.exit_pop'});assert.equal(exit.duration,3);assert.equal(samplePreviewAnimations(exit,1.5).propsById.root.alpha,.5);
});
test('animation direct参照は継承元namespaceを保持し他画面の同名定義を読まない',async()=>{
 const documents={'ui/base.json':{namespace:'base',fade,part:{type:'image',alpha:'@fade',anims:['@fade']}},'ui/screen.json':{namespace:'screen',fade:{...fade,to:.2},'root@base.part':{}}};
 const original=JSON.stringify(documents),cat=await catalogOf(documents);
 const result=resolveEffectiveUi({catalog:cat,recordId:cat.symbols['screen.root'].winnerId});assert(result.ok);
 const ui=buildUiScreenModelFromJson(result.document,{filePath:'ui/screen.json'});const p=compilePreviewAnimations(ui,collectPreviewAnimationDefinitions(cat));
 assert.equal(p.tracks.length,1);const end=samplePreviewAnimations(p,1);assert.equal(Object.values(end.propsById).find(x=>x.alpha!==undefined).alpha,1);assert.equal(JSON.stringify(documents),original);
});
test('animation delay付き無効区間は待機だけの成功trackを作らない',()=>{
 const p=plan({...fade,delay:1,from:'invalid'});assert.equal(p.tracks.length,0);assert(p.diagnostics.some(x=>x.code==='ANIMATION_VALUE_UNSUPPORTED'));
});
test('animation loop冒頭waitは直前cycle終値を維持しseek履歴に依存しない',()=>{
 const p=compilePreviewAnimations(model({anims:['@a.wait']}),{definitions:{'a.wait':{anim_type:'wait',duration:1,next:'@a.fade'},'a.fade':{...fade,next:'@a.wait'}}});
 assert.equal(samplePreviewAnimations(p,.5).propsById.root,undefined);
 assert.equal(samplePreviewAnimations(p,2.5).propsById.root.alpha,1);
 assert.equal(samplePreviewAnimations(p,2000.5).propsById.root.alpha,1);
});
test('flipbookは変数flagと開始delayを解決しdelayをループさせない',()=>{
 const p=plan({anim_type:'flip_book',frame_count:2,frame_step:4,initial_uv:[0,0],fps:2,delay:1,looping:'$loop',reversible:'$reverse'},{'$loop':true,'$reverse':false});
 assert.equal(p.tracks.length,1);assert.equal(samplePreviewAnimations(p,.5).propsById.root,undefined);assert.deepEqual(samplePreviewAnimations(p,2.5).propsById.root.uv,[4,0]);
});
test('空スロット代表状態は既知画面だけに提供し明示空collectionを保持',()=>{
 const chest=buildRepresentativeClassicCollections({qualifiedName:'chest.small_chest_screen'});assert.equal(chest.container_items.count,27);assert.equal(chest.hotbar_items.rowTemplate['#is_selected_slot'],false);
 const custom=buildRepresentativeClassicCollections({qualifiedName:'custom.small_chest_screen'});assert.equal(custom.container_items,undefined);
 const explicit=buildRepresentativeClassicCollections({qualifiedName:'chest.small_chest_screen',collectionData:{container_items:[]}});assert.equal(explicit.container_items.count,0);assert.equal(explicit.container_items.rowTemplate,undefined);
});
test('collection構造projectionはitem値を保持せずnested件数/selectorを保持',()=>{
 const source={offers:[{'#text':'秘密の実行状態',__collections:{items:[{__jsonui_preview_factory_control_id:'label','#name':'A'},{'#name':'B'}]}}]};
 const before=buildRepresentativeClassicCollections({collectionData:source});assert.equal(before.offers.rows[0].__collections.items.count,2);assert.equal(before.offers.rows[0].__collections.items.rows[0].__jsonui_preview_factory_control_id,'label');assert(!JSON.stringify(before).includes('秘密'));
 source.offers[0].__collections.items[1]['#name']='変更';assert.deepEqual(buildRepresentativeClassicCollections({collectionData:source}),before);
 source.offers[0].__collections.items=[];assert.notDeepEqual(buildRepresentativeClassicCollections({collectionData:source}),before);
});
test('nested factoryは各親rowの件数を独立生成し空行に外側dataを漏らさない',async()=>{
 const cat=await catalogOf({'ui/a.json':{namespace:'a',root:{type:'stack_panel',collection_name:'offers',factory:{name:'offers',control_name:'a.offer'}},offer:{type:'stack_panel',collection_name:'items',factory:{name:'items',control_name:'a.item'}},item:{type:'label',text:'#name'}}});
 const collections={items:[{}, {}, {}, {}],offers:[{__collections:{items:[{},{}]}},{__collections:{items:[]}}, {__collections:{items:[{}]}}]};
 const result=resolveEffectiveUi({catalog:cat,recordId:cat.symbols['a.root'].winnerId,representativeCollections:buildRepresentativeClassicCollections({collectionData:collections})});assert(result.ok);
 const rows=result.document.root.controls.map(x=>Object.values(x)[0]);assert.equal(rows.length,3);
 assert.deepEqual(rows.map(x=>x.controls?.length||0),[2,0,1]);
});

import { normalizePreviewState, createPreviewStatePreset } from '../../editor-core/src/engine/preview-state.js';
test('ModalFormは複数種類・日本語・各dropdownの状態を分離する',()=>{
 const state=normalizePreviewState({form:{type:'modal',title:'設定',elements:[{type:'toggle',text:'有効',value:false},{type:'input',text:'名前',value:'日本語',placeholder:'名前'},{type:'slider',text:'音量',value:.75},{type:'dropdown',text:'A',options:['一','二'],selected:1},{type:'dropdown',text:'B',options:['別'],selected:0},{type:'step_slider',text:'段階',options:['低','中','高'],selected:1}]}});
 assert.equal(state.recommendedDefinition,'server_form.custom_form');assert.equal(state.mockData['#custom_form_length'],6);
 const rows=state.collectionData.custom_form;assert.equal(rows[0]['#custom_toggle_state'],false);assert.equal(rows[1]['#custom_input_text'],'日本語');assert.equal(rows[2]['#custom_slider_value'],.75);
 assert.equal(rows[3].__collections.custom_dropdown.length,2);assert.equal(rows[4].__collections.custom_dropdown.length,1);assert.equal(rows[3].__collections.custom_dropdown[1]['#custom_radio_toggled'],true);assert.equal(rows[5]['#custom_slider_steps'],2);
});
test('ModalForm不正selection・値・要素型・余分な字段は全体拒否',()=>{
 for(const element of [{type:'toggle',value:'false'},{type:'slider',value:2},{type:'dropdown',options:[],selected:0},{type:'dropdown',options:['a'],selected:1},{type:'input',tex:'x'},{type:'script',text:'x'}])assert.throws(()=>normalizePreviewState({form:{type:'modal',elements:[element]}}));
 assert.doesNotThrow(()=>normalizePreviewState(createPreviewStatePreset('modal_form')));
});
test('inventory指定は固定slot数・明示null空欄・選択状態・任意item IDを保持',()=>{
 const state=normalizePreviewState({inventory:{main:[null,{id:'minecraft:diamond',count:4}],hotbar:[{id:'minecraft:emerald',selected:true}],container:[{id:'minecraft:unknown'}],containerSize:54}});
 assert.equal(state.collectionData.inventory_items.length,27);assert.equal(state.collectionData.inventory_items[0]['#item_valid'],false);assert.equal(state.collectionData.inventory_items[1]['#inventory_stack_count'],'4');
 assert.equal(state.collectionData.hotbar_items[0]['#is_selected_slot'],true);assert.equal(state.collectionData.hotbar_items[1]['#is_selected_slot'],false);assert.equal(state.collectionData.container_items.length,54);assert.equal(state.recommendedDefinition,'chest.large_chest_screen');assert.equal(state.diagnostics.length,0);assert.equal(state.collectionData.container_items[0].__jsonui_preview_item_id,'minecraft:unknown');assert.equal(state.collectionData.container_items[0]['#item_valid'],true);
 assert.throws(()=>normalizePreviewState({inventory:{hotbar:Array(10).fill(null)}}));assert.throws(()=>normalizePreviewState({inventory:{containerSize:0}}));
});
test('animationは型を派生側で定義した抽象baseの数値も継承',async()=>{
 const cat=await catalogOf({'ui/a.json':{namespace:'a',base:{from:0,to:1,duration:2},'fade@base':{anim_type:'alpha'}}});
 const definitions=collectPreviewAnimationDefinitions(cat);assert.equal(definitions.definitions['a.base'],undefined);assert.equal(definitions.definitions['a.fade'].duration,2);assert.equal(plan(definitions.definitions['a.fade']).tracks.length,1);
});
test('animation継承元の変数で渡す相対@参照にもnamespaceを適用',async()=>{
 const cat=await catalogOf({'ui/a.json':{namespace:'a',fade,part:{type:'image','$animation':'@fade',alpha:'$animation'}},'ui/b.json':{namespace:'b','root@a.part':{}}});
 const r=resolveEffectiveUi({catalog:cat,recordId:cat.symbols['b.root'].winnerId});assert(r.ok);assert.equal(r.document.root.alpha,'@a.fade');
});
test('非表示subtreeのanimationはtrack生成せず隠れたloadingを無限再生しない',()=>{
 const p=plan({...fade,looping:true},{visible:false});assert.equal(p.tracks.length,0);assert.equal(p.loop,false);
});
