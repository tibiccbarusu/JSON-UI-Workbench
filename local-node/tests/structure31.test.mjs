import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScopedEditContext,editWorkspaceScoped } from '../workspace-scoped-edit.mjs';
import { editWorkspaceBatch } from '../workspace-batch.mjs';
import { workspaceRevision } from '../workspace-edit.mjs';
import {resolveEffectiveUi} from '../../editor-core/src/engine/effective-ui-resolver.js';
import {pointerJoin,pointerParts} from '../workspace-jsonc.mjs';
const at=(v,p)=>pointerParts(p).reduce((v,k)=>v?.[k],v);
const normalized=x=>JSON.parse(JSON.stringify(x));
const doc = (override={})=>({'ui/a.json':JSON.stringify({namespace:'t',component:{type:'panel',size:[80,80],controls:[{one:{type:'label',text:'維持'}},{two:{type:'image',texture:'x'}}]},a:{type:'screen',controls:[{'left@t.component':{}},{'right@t.component':{}}]},b:{type:'screen',controls:[{'left@t.component':{}}]},...override})});
async function project(d,screen='t.a') {const c=await buildScopedEditContext({documents:d});const r=c.catalog.recordsById[c.catalog.symbols[screen].winnerId];const p=resolveEffectiveUi({catalog:c.catalog,recordId:r.id});assert(p.ok);return{c,r,p};}
async function operation(d,ptr,extra) {const {c,r,p}=await project(d);const source=p.nodeSources[ptr];assert(source,ptr);return{scope:'screen',targetMode:'interaction',path:c.internalPath(source),pointer:source.pointer,effectivePointer:ptr,screen:{path:c.internalPath(r),pointer:pointerJoin([r.rawKey])},...extra};}
async function act(d,ptr,extra){const op=await operation(d,ptr,extra);return editWorkspaceScoped({documents:d,operation:op,expectedRevision:workspaceRevision(d)});}
for(const type of ['label','image','panel','button'])test(`R31 screen add ${type} 同一画面の別配置と別画面を保持`,async()=>{
 const d=doc(),before=await project(d),p='/a/controls/0/left';
 const value={type,size:[20,10],offset:[3,4],...(type==='label'?{text:'追加'}:{})};
 const r=await act(d,p,{type:'add',name:'new_item',value});assert(r.ok,JSON.stringify(r));
 const after=await project(r.documents),expected=normalized(before.p.document);at(expected,p).controls.push({new_item:value});
 assert.deepEqual(normalized(after.p.document),expected);
 assert.deepEqual(normalized((await project(r.documents,'t.b')).p.document),normalized((await project(d,'t.b')).p.document));
 assert.deepEqual(JSON.parse(r.documents['ui/a.json']).component,JSON.parse(d['ui/a.json']).component);
});
test('R31 screen delete 配置だけ削除し共有定義と別配置を保持',async()=>{
 const d=doc(),p='/a/controls/0/left/controls/1/two';const r=await act(d,p,{type:'delete',cascade:true});assert(r.ok,JSON.stringify(r));
 const expected=normalized((await project(d)).p.document);expected.a.controls[0].left.controls.splice(1,1);
 assert.deepEqual(normalized((await project(r.documents)).p.document),expected);
 assert.deepEqual(normalized((await project(r.documents,'t.b')).p.document),normalized((await project(d,'t.b')).p.document));
});
test('R31 screen planDelete は原文もrevisionも変更しない',async()=>{
 const d=doc(),rev=workspaceRevision(d);const r=await act(d,'/a/controls/0/left/controls/1/two',{type:'planDelete'});assert(r.ok,JSON.stringify(r));assert.equal(r.revision,rev);assert.deepEqual(r.changes,[]);assert.equal(r.documents,undefined);assert(r.deletePlan.count>=1);
});
test('R31 screen planAdd と確定の対象が一致',async()=>{
 const d=doc(),p='/a/controls/0/left',args={name:'new_label',value:{type:'label',text:'新規'}};
 const plan=await act(d,p,{type:'planEdit',intendedType:'add',...args});assert(plan.ok,JSON.stringify(plan));assert.equal(plan.documents,undefined);
 const committed=await act(d,p,{type:'add',...args});assert(committed.ok);assert.deepEqual(plan.editPlan,committed.editPlan);
});
test('R31 参照される状態表示を削除しない',async()=>{
 const d=doc({component:{type:'button',default_control:'two',controls:[{two:{type:'image'}}]}});
 const r=await act(d,'/a/controls/0/left/controls/0/two',{type:'delete',cascade:true});assert.equal(r.code,'EDIT_STRUCTURE_REFERENCED');assert.equal(r.documents,undefined);
});
test('R31 グリッドの追加・削除を保護する',async()=>{
 const d=doc({component:{type:'grid',grid_dimensions:[1,1],controls:[{one:{type:'panel',grid_position:[0,0]}}]}});
 for(const [p,extra]of [['/a/controls/0/left',{type:'add',name:'x',value:{type:'label'}}],['/a/controls/0/left/controls/0/one',{type:'delete',cascade:true}]]){
  const r=await act(d,p,extra);assert.equal(r.code,'EDIT_STRUCTURE_GENERATED');assert.equal(r.documents,undefined);
 }
});
test('R31 画面定義自身の削除を拒否',async()=>{const d=doc();const r=await act(d,'/a',{type:'delete',cascade:true});assert.equal(r.code,'EDIT_STRUCTURE_ROOT_DELETE');});
test('R31 同名追加を拒否し原文不変',async()=>{const d=doc();const r=await act(d,'/a/controls/0/left',{type:'add',name:'one',value:{type:'panel'}});assert.equal(r.code,'EDIT_NAME_CONFLICT');assert.equal(r.documents,undefined);});
test('R31 機能本体の削除は確認前に実行しない',async()=>{
 const d=doc();const r=await act(d,'/a/controls/0/left',{type:'delete'});assert.equal(r.code,'EDIT_CASCADE_REQUIRED');assert.equal(r.documents,undefined);
});
test('R31 batch 画面限定構造変更を最後に行い、後続があれば原子的に拒否',async()=>{
 const d=doc(),op=await operation(d,'/a/controls/0/left',{type:'add',name:'tail',value:{type:'label'}});
 const single=await editWorkspaceBatch({documents:d,expectedRevision:workspaceRevision(d),operation:{type:'batch',operations:[op]}});assert(single.ok,JSON.stringify(single));
 const rejected=await editWorkspaceBatch({documents:d,expectedRevision:workspaceRevision(d),operation:{type:'batch',pointerBasis:'base-revision',operations:[op,op]}});assert.equal(rejected.code,'EDIT_BATCH_STRUCTURE_LAST');assert.equal(rejected.documents,undefined);
});

test('R31 現在表示されない原文の条件分岐からのフォーカス参照も削除を保留',async()=>{
 const d=doc({component:{type:'panel',focus_override_right:'$focus_override_right', '$focus_override_right|default':'',variables:[{requires:'($never_enabled)', '$focus_override_right':'two'}], controls:[{two:{type:'image',focus_identifier:'two'}}]}});
 const r=await act(d,'/a/controls/0/left/controls/0/two',{type:'delete',cascade:true});assert(['EDIT_STRUCTURE_REFERENCED','EDIT_STRUCTURE_REFERENCE_UNKNOWN'].includes(r.code), JSON.stringify(r));assert.equal(r.documents,undefined);
});
