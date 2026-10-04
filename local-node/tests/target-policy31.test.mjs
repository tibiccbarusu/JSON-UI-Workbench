/** 再実装R31：共通入力親への誤移動と、正常な機能位置移動を同時に固定する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScopedEditContext,editWorkspaceScoped} from '../workspace-scoped-edit.mjs';
import {resolveEffectiveUi} from '../../editor-core/src/engine/effective-ui-resolver.js';
import {pointerParts,pointerJoin} from '../workspace-jsonc.mjs';
const at=(v,p)=>pointerParts(p).reduce((v,k)=>v?.[k],v);
const encode=x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,JSON.stringify(v,null,2)]));
const roots=['root_panel','renamed_container'];
function fixture(rootName='root_panel',extra={}){return encode({'ui/test.json':{namespace:'t',
 base:{type:'input_panel',size:[176,166],offset:[10,20],button_mappings:[{from_button_id:'button.menu_select',to_button_id:'button.container_reset_held',mapping_type:'pressed'},{from_button_id:'button.return',to_button_id:'button.return',mapping_type:'global'}],controls:[
  {background:{type:'image',texture:'textures/background'}},{decoration:{type:'image',texture:'textures/anvil'}},
  {close:{type:'button',button_mappings:[{from_button_id:'button.menu_select',to_button_id:'button.menu_exit',mapping_type:'pressed'}],controls:[{default:{type:'image'}},{hover:{type:'image'}}]}},
  {slot:{type:'input_panel','$item_collection_name':'anvil_result_items',controls:[{image:{type:'image'}},{action:{type:'button',button_mappings:[{from_button_id:'button.menu_select',to_button_id:'button.anvil_take_all_place_all',mapping_type:'pressed'}]}}]}},
 ],...extra},a:{type:'screen',controls:[{[rootName+'@t.base']:{}}]},b:{type:'screen',controls:[{[rootName+'@t.base']:{}}]}}});}
async function project(d,s='t.a'){
 const c=await buildScopedEditContext({documents:d}),r=c.catalog.recordsById[c.catalog.symbols[s].winnerId];
 const p=resolveEffectiveUi({catalog:c.catalog,recordId:r.id});assert(p.ok);return{c,r,p};
}
async function move(d,ptr,mode='interaction'){
 const {c,r,p}=await project(d),src=p.nodeSources[ptr];assert(src,ptr);
 const op={type:'move',scope:'screen',targetMode:mode,path:c.internalPath(src),pointer:src.pointer,effectivePointer:ptr,screen:{path:c.internalPath(r),pointer:pointerJoin([r.rawKey])},delta:[11,7]};
 return {before:p.document,result:await editWorkspaceScoped({documents:d,operation:op,expectedRevision:c.revision})};
}
for(const root of roots)for(const selected of ['background','decoration'])test(`R31 ${root}/${selected}：機能込みでも共通親へ上がらず他部品不変`,async()=>{
 const d=fixture(root),ptr=`/a/controls/0/${root}/controls/${selected==='background'?0:1}/${selected}`;
 const {before,result}=await move(d,ptr);assert(result.ok,JSON.stringify(result));assert.equal(result.editPlan.target.effectivePointer,ptr);
 const expected=structuredClone(before);at(expected,ptr).offset=[11,7];
 assert.deepEqual(JSON.parse(JSON.stringify((await project(result.documents)).p.document)),expected);
 assert.deepEqual((await project(result.documents,'t.b')).p.document,(await project(d,'t.b')).p.document);
 assert.equal(result.editPlan.targetMode,'interaction');
});
for(const [name,tail,owner]of [
 ['close','2/close/controls/0/default','2/close'],['slot','3/slot/controls/0/image','3/slot']])test(`R31 ${name}：個別の機能本体と入力割当てを保持`,async()=>{
 const d=fixture(),ptr='/a/controls/0/root_panel/controls/'+tail,target='/a/controls/0/root_panel/controls/'+owner;
 const {before,result}=await move(d,ptr);assert(result.ok,JSON.stringify(result));assert.equal(result.editPlan.target.effectivePointer,target);
 const expected=structuredClone(before);at(expected,target).offset=[11,7];assert.deepEqual(JSON.parse(JSON.stringify((await project(result.documents)).p.document)),expected);
});
test('R31 共通親を直接選んだ明示操作は維持',async()=>{
 const d=fixture(),ptr='/a/controls/0/root_panel';const {before,result}=await move(d,ptr);assert(result.ok);const expected=structuredClone(before);at(expected,ptr).offset=[21,27];assert.deepEqual(JSON.parse(JSON.stringify((await project(result.documents)).p.document)),expected);
});
test('R31 未知の局所input_panelは画面親へ代替せず明示選択を要求',async()=>{
 const d=fixture('root_panel',{controls:[{unknown:{type:'input_panel',controls:[{art:{type:'image'}}]}}]});
 const {result}=await move(d,'/a/controls/0/root_panel/controls/0/unknown/controls/0/art');assert.equal(result.code,'EDIT_INTERACTION_TARGET_AMBIGUOUS');assert.equal(result.documents,undefined);
});
test('R31 input_panel自身に局所の操作割当てがあるときはその機能を移動',async()=>{
 const d=fixture('root_panel',{button_mappings:[{from_button_id:'button.menu_select',to_button_id:'button.test_action',mapping_type:'pressed'}],controls:[{art:{type:'image'}}]});
 const {result}=await move(d,'/a/controls/0/root_panel/controls/0/art');assert(result.ok,JSON.stringify(result));assert.equal(result.editPlan.target.type,'input_panel');
});
test('R31 深く入れ子のボタン装飾は段数で拒否しない',async()=>{
 let leaf={type:'image'};let path='';for(let i=0;i<20;i++){leaf={type:'panel',controls:[{inner:leaf}]};path+='/controls/0/inner';}
 const d=fixture('root_panel',{controls:[{deep:{type:'button',controls:[{art:leaf}]}}]});
 const {result}=await move(d,'/a/controls/0/root_panel/controls/0/deep/controls/0/art'+path);assert(result.ok,JSON.stringify(result));assert.equal(result.editPlan.target.effectivePointer,'/a/controls/0/root_panel/controls/0/deep');
});

// 解釈に残る動的な子を、空の装飾だと仮定しない。
import {chooseInteractionTarget31} from '../workspace-target-policy31.mjs';
for (const props of [{controls:'$runtime_controls'},{factory:{name:'runtime_factory'}}]) test('R31 動的な表示子は無機能と推測せず停止 '+Object.keys(props)[0],()=>{
 const p={document:{screen:{type:'screen',controls:[{art:{type:'panel',...props}}]}},nodeSources:{'/screen':{},'/screen/controls/0/art':{}}};
 assert.throws(()=>chooseInteractionTarget31(p,{effectivePointer:'/screen/controls/0/art',targetMode:'interaction'},true),{code:'EDIT_INTERACTION_TARGET_AMBIGUOUS'});
});
