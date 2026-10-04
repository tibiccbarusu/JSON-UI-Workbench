/** R31: 実controller → HTTP/Worker → 編集 → 履歴 → 新規MCPACK読込。実機・実DOMではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm}from'node:fs/promises';
import {tmpdir}from'node:os';import path from'node:path';
import {CliClient}from'../cli-client.mjs';import{makeZip,manifest}from'./fixtures.mjs';
import {createWorkspaceEditor}from'../../editor-core/src/ui/workspace-editor.js';
import {ResourceZipReader}from'../resource-zip.mjs';
import{pointerJoin,pointerParts}from'../workspace-jsonc.mjs';
const at=(x,p)=>pointerParts(p).reduce((x,k)=>x?.[k],x);
const data={namespace:'t',item:{type:'panel',size:[70,60],controls:[{caption:{type:'label',text:'残す'}},{deco:{type:'panel',size:[10,10]}}]},
 a:{type:'screen',controls:[{'left@t.item':{}},{'right@t.item':{offset:[100,0]}}]},b:{type:'screen',controls:[{'right@t.item':{}}]}};
for(const scenario of ['add','delete','stale-delete'])test(`R31 HTTP 画面限定${scenario}・履歴・書出再読込`,{timeout:30000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jui-structure31-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const input=path.join(dir,'input.mcpack');const bytes=makeZip({'manifest.json':manifest,'ui/_ui_defs.json':JSON.stringify({ui_defs:['ui/test.json']}),'ui/test.json':JSON.stringify(data)});await writeFile(input,bytes);
 const client=await CliClient.start();t.after(()=>client.close());const pack=await client.importPack(input);
 const request=(action,payload,options)=>client.request('/api/node/workspace-'+action,{payload,signal:options?.signal});
 const ws=createWorkspaceEditor({request});await ws.ensure([{id:pack.id,kind:'imported'}],'test');ws.setMode('edit');ws.setEditOptions({targetMode:'interaction'});
 async function project(id=ws.state.workspaceId,symbol='t.a'){
  const c=await request('catalog',{workspaceId:id}),r=c.records.find(x=>x.qualifiedName===symbol);assert(r);
  const p=await client.request('/api/node/project',{payload:{catalogId:c.nodeCatalogId,recordId:r.id}});assert(p.ok,JSON.stringify(p));return{r,p};
 }
 async function select(ptr){const {p,r}=await project(),src=p.nodeSources[ptr];assert(src);
  await ws.selectPreviewTarget({path:src.path,sourceId:pack.id,pointer:src.pointer},{fileId:'f',nodeId:ptr,previewDefinitionId:r.id,effectivePointer:ptr,
   screen:{path:r.filePath,sourceId:pack.id,pointer:pointerJoin([r.rawKey])}});
 }
 const before=await project(),other=await project(ws.state.workspaceId,'t.b'),baseRevision=ws.state.revision;
 const ptr=scenario==='add'?'/a/controls/0/left':'/a/controls/0/left/controls/1/deco';await select(ptr);
 if(scenario==='add')await ws.addScreenElement31({name:'label_added',value:{type:'label',text:'追加',size:[20,10],offset:[3,5]}});
 else{
  const planned=await ws.planScreenDelete31();assert(planned.deletePlan);assert.equal(ws.state.revision,baseRevision,'計画は確定しない');
  if(scenario==='stale-delete') {
    await select('/a/controls/1/right');await assert.rejects(ws.confirmDelete(),{code:'WORKSPACE_DELETE_PLAN_STALE'});assert.equal(ws.state.pendingOperations.length,0);return;
  }
  await ws.confirmDelete();
 }
 assert.equal(ws.state.editScope,'screen','共有へ切り替えない');assert.equal(ws.state.pendingOperations.length,1);
 assert.equal(ws.state.pendingOperations[0].operation.scope,'screen');assert.equal(ws.state.revision,baseRevision);
 const draft=await request('preview-draft',{workspaceId:ws.state.workspaceId,expectedRevision:baseRevision,pendingVersion:ws.state.pendingVersion,
  screen:{path:before.r.filePath,sourceId:pack.id,pointer:pointerJoin([before.r.rawKey])},operation:{type:'batch',pointerBasis:'base-revision',operations:ws.pendingCompiledOperations()},
  frame:{generation:ws.state.pendingVersion,preset:{width:240,height:160},qualifiedName:'t.a',visibilityMode:'safe'}});
 assert(draft.ok,JSON.stringify(draft));assert.equal(draft.committed,false);assert(draft.frame.layout.boxes.length>0);
 assert.equal(ws.state.revision,baseRevision,'草稿の表示計算では原文を確定しない');
 const commit=await ws.applyPending();assert(commit.ok,JSON.stringify(commit));assert.equal(ws.state.pendingOperations.length,0);
 assert.equal(commit.batch.validationCache,'hit','検査済みの画面限定構造操作を確定へ再利用');
 assert(ws.state.lastStructureSelection31,'構造変更後の選択先を返す');
 assert.equal(ws.state.lastStructureSelection31.sourceId,pack.id);
 if(scenario==='add')assert(ws.state.selectedPointer.endsWith('/label_added'));
 else assert(!ws.state.selectedPointer.endsWith('/deco'));
 const after=await project(),expected=structuredClone(before.p.document);
 if(scenario==='add')expected.a.controls[0].left.controls.push({label_added:{type:'label',text:'追加',size:[20,10],offset:[3,5]}});else expected.a.controls[0].left.controls.splice(1,1);
 assert.deepEqual(draft.projection.document,expected,'草稿と確定の構造が一致');assert.deepEqual(after.p.document,expected);assert.deepEqual((await project(ws.state.workspaceId,'t.b')).p.document,other.p.document);
 await ws.history('undo');assert.deepEqual((await project()).p.document,before.p.document);
 await ws.history('redo');assert.deepEqual((await project()).p.document,expected);
 const current=await project(),exp={workspaceId:ws.state.workspaceId,selections:[{filePath:current.r.filePath,sourceId:current.r.sourceId,rawKey:current.r.rawKey}],mode:'zip'};
 const outputBytes=await client.request('/api/node/workspace-export',{payload:exp,binary:true});const output=path.join(dir,'output.mcpack');await writeFile(output,outputBytes);
 const zip=new ResourceZipReader();try{await zip.openFromFile({diskPath:output,name:'out.mcpack'});await zip.listEntries();for(const p of zip.entryIndex.keys())await zip.bytes(p);}finally{await zip.close();}
 const reimport=await client.importPack(output),restored=await request('open',{sources:[{kind:'imported',id:reimport.id}]});assert.deepEqual((await project(restored.workspaceId)).p.document,expected);
 assert.deepEqual(await readFile(input),bytes,'入力ZIP不変');
});
