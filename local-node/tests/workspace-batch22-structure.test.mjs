import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WorkspaceSessions } from '../workspace-session.mjs';
import { buildScopedEditContext } from '../workspace-scoped-edit.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { pointerJoin, pointerParts } from '../workspace-jsonc.mjs';
import { createLocalServer } from '../server.mjs';
import { LIMITS } from '../limits.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { scoped20Documents, scoped20Cases } from './workspace-scoped20-fixtures.mjs';
const encode = values => Object.fromEntries(Object.entries(values).map(([path, value]) => [path, JSON.stringify(value)]));
const simple = () => encode({ 'ui/test.json': { namespace: 'a', root: { type: 'screen', controls: [
  { first: { type: 'image', offset: [1, 2] } }, { second: { type: 'label', text: '二番', offset: [4, 5] } },
] } } });
const identity = state => ({ workspaceId: state.workspaceId, expectedRevision: state.revision });
const at = (value, pointer) => pointerParts(pointer).reduce((current, key) => current?.[key], value);
const batch = operations => ({ type: 'batch', pointerBasis: 'base-revision', operations });
async function opened(documents = simple()) {
  let invalidations = 0;
  const manager = new WorkspaceSessions({ getPack: () => ({ packPaths: Object.keys(documents), rootPrefix: '',
    zipReader: { readText: async path => documents[path] } }), checkSources: sources => sources,
    invalidate: () => { invalidations++; } });
  const state = await manager.open({ sources: [{ id: 'pack', kind: 'imported' }] });
  return { manager, state, documents, invalidations: () => invalidations };
}
async function project(manager, id, symbol, preview = {}) {
  const workspace = manager.get(id);
  const context = await buildScopedEditContext({ documents: workspace.documents, documentSources: workspace.documentSources });
  const record = context.catalog.recordsById[context.catalog.symbols[symbol].winnerId];
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id, ...preview });
  assert.equal(projection.ok, true);
  return { context, record, projection };
}
async function move(manager, state, symbol, pointer, delta = [10, 20], extra = {}) {
  const { record, projection } = await project(manager, state.workspaceId, symbol, extra.preview);
  const source = projection.nodeSources[pointer]; assert(source, pointer);
  return { type: 'move', scope: 'screen', targetMode: 'visual', delta,
    screen: { path: record.filePath, sourceId: record.sourceId, pointer: pointerJoin([record.rawKey]) },
    path: source.path, sourceId: source.sourceId, pointer: source.pointer, effectivePointer: pointer, ...extra };
}
const snapshot = (manager, id) => { const item = manager.get(id); return JSON.stringify({ documents: item.documents,
  sources: item.sources, revision: item.revision, undo: item.undo, redo: item.redo, editCount: item.editCount, historyBytes: item.historyBytes }); };

const three = () => encode({ 'ui/test.json': { namespace: 'a', root: { type: 'screen', controls: [
  { first: { type: 'image', offset: [1, 2] } }, { second: { type: 'label', text: '二番', offset: [4, 5] } },
  { third: { type: 'image', offset: [8, 9] } },
] } } });
const del = (name, index) => ({ type: 'delete', path: 'ui/test.json', pointer: `/root/controls/${index}/${name}`, cascade: true });
const add = (name, extra = {}) => ({ type: 'add', path: 'ui/test.json', parentPointer: '/root', name, value: { type: 'label', text: '追加' }, ...extra });
const doc = async (manager, state) => (await project(manager, state.workspaceId, 'a.root')).projection.document.root;

for (const positions of [[0,2], [2,0], [0,1]]) test(`元添字の兄弟削除 ${positions} を1回確定・undo`, async () => {
  const {manager,state,documents,invalidations}=await opened(three());
  const names=['first','second','third'];
  const result=await manager.edit({...identity(state),operation:batch(positions.map(i=>del(names[i],i)))});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual((await doc(manager,state)).controls.map(v=>Object.keys(v)[0]),names.filter((_,i)=>!positions.includes(i)));
  assert.equal(result.editCount,1);assert.equal(invalidations(),1);
  const undone=manager.history(identity(result),'undo');assert.equal(undone.revision,state.revision);
  assert.deepEqual(manager.get(state.workspaceId).documents,Object.assign(Object.create(null),documents));
});

test('move→delete→moveは同一開始選択の残存要素を移動',async()=>{
  const {manager,state}=await opened(three());
  const m=await move(manager,state,'a.root','/root/controls/1/second',[2,3]);
  const result=await manager.edit({...identity(state),operation:batch([m,del('first',0),m])});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual((await doc(manager,state)).controls[0].second.offset,[8,11]);
});

test('delete→元添字raw set→scoped move',async()=>{
  const {manager,state}=await opened(three());
  const m=await move(manager,state,'a.root','/root/controls/2/third',[2,3]);
  const result=await manager.edit({...identity(state),operation:batch([del('first',0),
    {type:'set',path:'ui/test.json',pointer:'/root/controls/1/second/text',value:'変更'},m])});
  assert.equal(result.ok,true,JSON.stringify(result));const root=await doc(manager,state);
  assert.equal(root.controls[0].second.text,'変更');assert.deepEqual(root.controls[1].third.offset,[10,12]);
});

test('先頭add→既存scoped move→addは元要素を維持',async()=>{
  const {manager,state}=await opened();const m=await move(manager,state,'a.root','/root/controls/1/second',[2,3]);
  const result=await manager.edit({...identity(state),operation:batch([add('newA',{index:0}),m,add('newB',{index:0})])});
  assert.equal(result.ok,true,JSON.stringify(result));const root=await doc(manager,state);
  assert.deepEqual(root.controls.map(v=>Object.keys(v)[0]),['newA','newB','first','second']);
  assert.deepEqual(root.controls[3].second.offset,[6,8]);
});

test('同じ親へ複数append add',async()=>{
  const {manager,state}=await opened();const result=await manager.edit({...identity(state),operation:batch([add('newA'),add('newB')])});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal((await doc(manager,state)).controls.length,4);
});

for(const later of [del('first',0),{type:'move',path:'ui/test.json',pointer:'/root/controls/0/first',offset:[7,7]},
  {type:'add',path:'ui/test.json',parentPointer:'/root/controls/0/first',name:'child',value:{type:'label'}}])
 test(`削除済選択への後続 ${later.type} は全ロールバック`,async()=>{
  const {manager,state,invalidations}=await opened();const before=snapshot(manager,state.workspaceId);
  const result=await manager.edit({...identity(state),operation:batch([del('first',0),later])});
  assert.equal(result.code,'EDIT_BATCH_TARGET_REMOVED',JSON.stringify(result));assert.equal(result.batch.failedOperationIndex,1);
  assert.equal(result.batch.appliedCount,0);assert.equal(snapshot(manager,state.workspaceId),before);assert.equal(invalidations(),0);
 });

test('削除祖先の後続scoped選択は全拒否',async()=>{
  const {manager,state,invalidations}=await opened();const m=await move(manager,state,'a.root','/root/controls/1/second');
  const before=snapshot(manager,state.workspaceId);const result=await manager.edit({...identity(state),operation:batch([
    {type:'delete',path:'ui/test.json',pointer:'/root',cascade:true},m])});
  assert.equal(result.code,'EDIT_BATCH_TARGET_REMOVED',JSON.stringify(result));assert.equal(snapshot(manager,state.workspaceId),before);assert.equal(invalidations(),0);
});

test('新規追加要素をbaseとして指定できない',async()=>{
 const {manager,state,invalidations}=await opened();const before=snapshot(manager,state.workspaceId);
 const result=await manager.edit({...identity(state),operation:batch([add('newA'),{type:'move',path:'ui/test.json',pointer:'/root/controls/2/newA',offset:[7,7]}])});
 assert.equal(result.code,'EDIT_BATCH_BASE_TARGET_REQUIRED');assert.equal(result.batch.failedOperationIndex,1);assert.equal(snapshot(manager,state.workspaceId),before);assert.equal(invalidations(),0);
});

test('複数addの名前衝突は先行成功を取り消す',async()=>{
 const {manager,state,invalidations}=await opened();const before=snapshot(manager,state.workspaceId);
 const result=await manager.edit({...identity(state),operation:batch([add('newA'),add('newA')])});
 assert.equal(result.code,'EDIT_NAME_CONFLICT');assert.equal(result.batch.failedOperationIndex,1);assert.equal(snapshot(manager,state.workspaceId),before);assert.equal(invalidations(),0);
});

test('全体置換/継承/構造setは途中禁止を維持',async()=>{
 const {manager,state}=await opened();for(const first of [
  {type:'replaceText',path:'ui/test.json',text:simple()['ui/test.json']},
  {type:'inherit',path:'ui/test.json',pointer:'/root/controls/1/second',baseRef:null},
  {type:'set',path:'ui/test.json',pointer:'/root/controls',value:[]}
 ]){const r=await manager.edit({...identity(state),operation:batch([first,add('newA')])});assert.equal(r.code,'EDIT_BATCH_STRUCTURE_LAST');}
});

test('pointer基準の未知値は拒否',async()=>{
 const {manager,state}=await opened();const r=await manager.edit({...identity(state),operation:{...batch([add('newA')]),pointerBasis:'current'}});
 assert.equal(r.code,'EDIT_BATCH_POINTER_BASIS_INVALID');
});

test('HTTP: 連続構造操作は1要求で確定しundoで復元・旧revision再送拒否', {timeout:55000},async()=>{
 const app=await createLocalServer({port:0});try{
  const base=`http://127.0.0.1:${app.port}/api/node/`,{token}=await(await fetch(base+'capabilities')).json();
  const post=async(route,payload)=>{const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json','x-jsonui-token':token},body:JSON.stringify(payload)});return{status:r.status,data:await r.json()};};
  const id=randomUUID(),bytes=makeZip({'manifest.json':manifest,...three()});
  assert.equal((await fetch(base+'packs',{method:'POST',headers:{'content-type':'application/zip','content-length':String(bytes.length),'x-jsonui-upload-id':id,'x-jsonui-token':token},body:bytes})).status,200);
  const {data:state}=await post('workspace-open',{sources:[{id,kind:'imported'}]});
  const request={...identity(state),operation:batch([del('first',0),del('third',2),add('newA')])};
  const applied=await post('workspace-edit',request);assert.equal(applied.status,200);assert.equal(applied.data.ok,true,JSON.stringify(applied.data));assert.equal(applied.data.editCount,1);
  assert.equal((await post('workspace-edit',request)).status,409);assert.equal((await post('workspace-undo',identity(applied.data))).data.revision,state.revision);
 }finally{await app.close();}
});

test('共有継承のdelete→scoped moveは別画面を変更しない',async()=>{
 const {manager,state}=await opened(scoped20Documents), fixture=scoped20Cases[1];
 const other=(await project(manager,state.workspaceId,'fixture.screen_b')).projection.document;
 const m=await move(manager,state,fixture.screen,fixture.effectivePointer,[3,4],{generatedScope:'template'});
 const result=await manager.edit({...identity(state),operation:batch([
  {type:'delete',path:'ui/fixture_screens.json',pointer:'/screen_a/controls/0/close@common.close_button',cascade:true},m])});
 assert.equal(result.ok,true,JSON.stringify(result));
 const changed=(await project(manager,state.workspaceId,fixture.screen)).projection.document;
 const ep=fixture.effectivePointer.replace('/controls/1/text/','/controls/0/text/');
 assert.deepEqual(at(changed,ep).offset,[3,4]);
 assert.deepEqual((await project(manager,state.workspaceId,'fixture.screen_b')).projection.document,other);
});

test('共有clone移動→別要素削除→同clone移動を対応付ける',async()=>{
 const {manager,state}=await opened(scoped20Documents), fixture=scoped20Cases[0];
 const other=(await project(manager,state.workspaceId,'fixture.screen_b')).projection.document;
 const m=await move(manager,state,fixture.screen,fixture.effectivePointer,[3,4],{generatedScope:'template'});
 const result=await manager.edit({...identity(state),operation:batch([m,
  {type:'delete',path:'ui/fixture_screens.json',pointer:'/screen_a/controls/1/text@common.text_edit_box',cascade:true},m])});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.deepEqual(at((await project(manager,state.workspaceId,fixture.screen)).projection.document,fixture.effectivePointer).offset,[6,8]);
 assert.deepEqual((await project(manager,state.workspaceId,'fixture.screen_b')).projection.document,other);
});

test('継承配列へadd→既存scoped moveは既存要素を消さない',async()=>{
 const values={'ui/test.json':{namespace:'a',base:{type:'panel',controls:[{child:{type:'label',text:'元',offset:[1,2]}}]},
  root:{type:'screen',controls:[{'branch@a.base':{}}]}}};
 const {manager,state}=await opened(encode(values));
 const m=await move(manager,state,'a.root','/root/controls/0/branch/controls/0/child',[2,3]);
 const result=await manager.edit({...identity(state),operation:batch([
  {type:'add',path:'ui/test.json',parentPointer:'/root/controls/0/branch@a.base',name:'next',value:{type:'label',text:'追加'}},m])});
 assert.equal(result.ok,true,JSON.stringify(result));
 const root=await doc(manager,state);assert.equal(root.controls[0].branch.controls.length,2);
 assert.deepEqual(root.controls[0].branch.controls[0].child.offset,[3,5]);
});

test('controls対応表の兄弟削除とmove',async()=>{
 const values={'ui/test.json':{namespace:'a',root:{type:'screen',controls:{first:{type:'label'},second:{type:'label',offset:[1,2]}}}}};
 const {manager,state}=await opened(encode(values));
 const {projection}=await project(manager,state.workspaceId,'a.root');
 const ep=Object.entries(projection.nodeSources).find(([,s])=>s.pointer==='/root/controls/second')[0];
 const m=await move(manager,state,'a.root',ep,[2,3]);
 const result=await manager.edit({...identity(state),operation:batch([{type:'delete',path:'ui/test.json',pointer:'/root/controls/first',cascade:true},m])});
 assert.equal(result.ok,true,JSON.stringify(result));
 const after=await project(manager,state.workspaceId,'a.root');const target=Object.entries(after.projection.nodeSources).find(([,s])=>s.pointer.endsWith('/controls/second'));
 assert.deepEqual(at(after.projection.document,target[0]).offset,[3,5]);
});

for(const shared of [false,true])test(`scope条件が異なる操作を維持（後続shared=${shared}）`,async()=>{
 const {manager,state}=await opened(three());const m=await move(manager,state,'a.root','/root/controls/1/second',[2,3]);
 const later={...m,scope:shared?'shared':'screen',targetMode:'visual'};
 const result=await manager.edit({...identity(state),operation:batch([m,del('first',0),later])});
 assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual((await doc(manager,state)).controls[0].second.offset,[8,11]);
});

test('継承参照を含む複数原文cascade削除でも残存兄弟を誤移動しない',async()=>{
 const values={
  'ui/base.json':{namespace:'b',unused:{type:'label',text:'削除'}},
  'ui/test.json':{namespace:'a',root:{type:'screen',controls:[{'first@b.unused':{}},{second:{type:'label',offset:[4,5]}},{'third@b.unused':{}}]}}};
 const {manager,state}=await opened(encode(values));const m=await move(manager,state,'a.root','/root/controls/1/second',[2,3]);
 const result=await manager.edit({...identity(state),operation:batch([{type:'delete',path:'ui/base.json',pointer:'/unused',cascade:true},m])});
 assert.equal(result.ok,true,JSON.stringify(result));const root=await doc(manager,state);
 assert.equal(root.controls.length,1);assert.deepEqual(root.controls[0].second.offset,[6,8]);
});

test('削除位置のbase gapへの追加は削除済要素参照と区別',async()=>{
 const {manager,state}=await opened(three());
 const result=await manager.edit({...identity(state),operation:batch([del('first',0),add('newA',{index:0}),add('newB',{index:1})])});
 assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual((await doc(manager,state)).controls.map(v=>Object.keys(v)[0]),['newA','newB','second','third']);
});

test('後続不正moveは構造成功分と履歴も全て取り消す',async()=>{
 const {manager,state,invalidations}=await opened(three());const before=snapshot(manager,state.workspaceId);
 const m=await move(manager,state,'a.root','/root/controls/2/third',[Infinity,0]);
 const result=await manager.edit({...identity(state),operation:batch([del('first',0),add('newA'),m])});
 assert.equal(result.code,'EDIT_DELTA_INVALID',JSON.stringify(result));assert.equal(result.batch.failedOperationIndex,2);
 assert.equal(result.batch.appliedCount,0);assert.equal(snapshot(manager,state.workspaceId),before);assert.equal(invalidations(),0);
});

test('複数構造batchでもexpectedRevision競合は確定禁止',async()=>{
 const {manager,state}=await opened(three());const m=await move(manager,state,'a.root','/root/controls/2/third',[2,3]);
 const pending=manager.edit({...identity(state),operation:batch([del('first',0),m])});
 const other=manager.edit({...identity(state),operation:{type:'set',path:'ui/test.json',pointer:'/root/offset',value:[7,8]}});
 await assert.rejects(pending,{code:'WORKSPACE_REVISION_CONFLICT'});assert.equal(manager.get(state.workspaceId).revision,other.revision);
 assert.equal(manager.get(state.workspaceId).undo.length,1);
});
