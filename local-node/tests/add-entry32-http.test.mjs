/** 製品mainの実関数を同じrealmで呼び、controller・HTTP・Nodeの処理へ接続する。
 * DOM選択・マウス座標・画面再描画のみを縮約する。実ブラウザー検査とは区別。 */
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm}from'node:fs/promises';import path from'node:path';import{tmpdir}from'node:os';
import{CliClient}from'../cli-client.mjs';import{makeZip,manifest}from'./fixtures.mjs';
import{createWorkspaceEditor,findAuthoredNodeForPreview,workspacePreviewDefinitionIdentity,matchesWorkspaceDocument}from'../../editor-core/src/ui/workspace-editor.js';
import{buildUiScreenModelFromJson}from'../../editor-core/src/model/ui-screen-model.js';
import{buildTreeFromUiScreenModel}from'../../editor-core/src/editor/ui-model-tree.js';
import{computeLayoutBoxesForFile}from'../../editor-core/src/preview/canvas-preview.js';
import{captureGeometryPolicy29,assertGeometryPolicy29}from'../../editor-core/src/ui/workspace-geometry-policy29.js';
import * as add from'../../editor-core/src/ui/workspace-add-intent32.js';
import * as insertion33 from'../../editor-core/src/ui/editor-insertion33.js';
const code=await readFile(new URL('../../editor-core/src/main.js',import.meta.url),'utf8');
const fn=code.slice(code.indexOf('async function addSourceCanvasElement('),code.indexOf('async function exportCurrentSourceWorkspacePack()'));
const parentFn=code.slice(code.indexOf('function currentInsertionParent33('),code.indexOf('function describeInsertionParent32('));
const sourceData={namespace:'t',main:{type:'screen',controls:[{outer:{type:'panel',size:[120,80],offset:[10,20],anchor_from:'top_left',anchor_to:'top_left',controls:[{picture:{type:'image',size:[10,10],offset:[7,8]}}]}}]}};
for(const scenario of ['retry','auto-parent','late-cancel','late-type','double','hidden','render-failure'])test(`R35 実main→HTTP 追加 ${scenario}`,{timeout:30000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jui-add32-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const packPath=path.join(dir,'input.mcpack');await writeFile(packPath,makeZip({'manifest.json':manifest,'ui/_ui_defs.json':JSON.stringify({ui_defs:['ui/test.json']}),'ui/test.json':JSON.stringify(sourceData)}));
 const client=await CliClient.start();t.after(()=>client.close());const pack=await client.importPack(packPath);
 let release=null,gotPlan=null,planCount=0,hold=false;const planSeen=new Promise(resolve=>{gotPlan=resolve;});
 const request=async(action,payload,options)=>{
   const result=await client.request('/api/node/workspace-'+action,{payload});
   if(action==='edit'&&payload.operation?.intendedType==='add'){planCount++;gotPlan();if(hold)await new Promise(resolve=>{release=resolve;});}
   return result;
 };
 const ws=createWorkspaceEditor({request});await ws.ensure([{id:pack.id,kind:'imported'}],'fixture');ws.setMode('edit');ws.setEditOptions({targetMode:'interaction'});
 const catalog=await request('catalog',{workspaceId:ws.state.workspaceId});const record=catalog.records.find(r=>r.qualifiedName==='t.main');assert(record);
 const projection=await client.request('/api/node/project',{payload:{catalogId:catalog.nodeCatalogId,recordId:record.id}});
 const model=buildUiScreenModelFromJson(projection.document,{filePath:'ui/test.json'});
 const file={id:'f',path:'ui/test.json',uiModel:model,...buildTreeFromUiScreenModel(model),meta:{previewProjection:true,selectedDefinition:record,resolution:{nodeSources:projection.nodeSources}}};
 const nodeId=Object.keys(file.nodesById).find(k=>k.endsWith('/picture'));
 const getSource=id=>findAuthoredNodeForPreview({file,nodeId:id,nodes:ws.state.nodes,sourceId:pack.id,sources:ws.state.sources});
 const selected=getSource(nodeId);assert(selected);
 await ws.selectPreviewTarget(selected,{fileId:file.id,nodeId,previewDefinitionId:workspacePreviewDefinitionIdentity(file),effectivePointer:selected.previewPointer,screen:{path:record.filePath,pointer:'/'+record.rawKey,sourceId:pack.id}});
 const layout=computeLayoutBoxesForFile(file,{width:240,height:160});assert(layout.boxes.some(b=>b.id.endsWith('/outer')));
 const canvasState={};let renderFailed=false;
 const vars={...add,...insertion33,sourceWorkspace:ws,siteText:v=>v,captureGeometryPolicy29,assertGeometryPolicy29,
 store:{getState:()=>({files:{currentFileId:'f',byId:{f:file}}})},sourceNodeForPreview:(_file,id)=>getSource(id),
 assertStudioUnlocked26:()=>{},findUiNodeById:(root,id)=>{let found=null;const walk=n=>{if(n.id===id)found=n;for(const c of n.children||[])walk(c);};walk(root);return found;},
 matchesWorkspaceDocument,workspacePreviewDefinitionIdentity,getCanvasState:()=>canvasState,getCanvasKey:x=>x,
 safeRender:()=>{if(scenario==='render-failure'&&!renderFailed&&ws.state.pendingOperations.length){renderFailed=true;throw Error('render-failure');}}};
 // 信頼された配布ソースの関数だけを抽出。入力パックの文字列は実行しない。
 const main=Function(...Object.keys(vars),`${parentFn}\nreturn (${fn.trim()});`)(...Object.values(vars));
 add.setAddType32(ws.state,'label');const initial=ws.state.revision;
 if(scenario==='retry'){
  // 現在のUIが未準備なら別の定義へ追加せず拒否し、UI復帰後に同じ設定で再試行する。
  const children=file.uiModel.root.children;file.uiModel.root.children=[];
  try{await assert.rejects(main(file,layout,{x:50,y:60}),{code:'WORKSPACE_ADD_PARENT_REQUIRED'});}finally{file.uiModel.root.children=children;}
  assert.equal(planCount,0);assert.equal(ws.state.addType,'label');assert.equal(ws.state.pendingOperations.length,0);
 }
 if(scenario!=='auto-parent')add.setInsertionRelation32(ws.state,'sibling');
 if(scenario==='hidden'){
  await assert.rejects(main(file,{boxes:[]},{x:50,y:60}),{code:'WORKSPACE_ADD_PARENT_HIDDEN'});assert.equal(ws.state.addType,'label');assert.equal(planCount,0);return;
 }
 if(['late-cancel','late-type','double'].includes(scenario)){
  hold=true;const pending=main(file,layout,{x:50,y:60});await planSeen;
  if(scenario==='double'){await main(file,layout,{x:50,y:60});assert.equal(planCount,1);release();await pending;}
  else{add.setAddType32(ws.state,scenario==='late-cancel'?'':'button');release();await assert.rejects(pending,{code:'WORKSPACE_SELECTION_SUPERSEDED'});assert.equal(ws.state.pendingOperations.length,0);assert.equal(ws.state.addType,scenario==='late-cancel'?'':'button');return;}
 }else if(scenario==='render-failure')await assert.rejects(main(file,layout,{x:50,y:60}),/render-failure/);
 else await main(file,layout,{x:50,y:60});
 assert.equal(ws.state.addType,'');assert.equal(ws.state.pendingOperations.length,1);assert.equal(planCount,1);assert.equal(ws.state.revision,initial);
 const op=ws.state.pendingOperations[0].operation;assert(op.operationId);assert.equal(op.insertionRelation,scenario==='auto-parent'?'inside':'sibling');assert(!op.parentPointer.endsWith('/picture'));
 const parentBox=layout.boxes.find(b=>b.id.endsWith('/outer'));assert.deepEqual(op.value.offset,[50-parentBox.x,60-parentBox.y]);
 const result=await ws.applyPending();assert(result.ok,JSON.stringify(result));assert.equal(ws.state.pendingOperations.length,0);assert.notEqual(ws.state.revision,initial);
});
