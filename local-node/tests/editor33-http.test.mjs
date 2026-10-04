/** 実HTTP/Workerの編集→草稿frame→確定→Undo/Redo。Minecraft実機検証ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalServer} from '../server.mjs';
import {makeZip,manifest} from './fixtures.mjs';
import {createWorkspaceEditor} from '../../editor-core/src/ui/workspace-editor.js';
import {resizeChanges33} from '../../editor-core/src/ui/editor-transform33.js';
import {newElementValue33} from '../../editor-core/src/ui/editor-insertion33.js';
import {pointerParts,pointerJoin} from '../workspace-jsonc.mjs';
const at=(doc,pointer)=>pointerParts(pointer).reduce((v,k)=>v?.[k],doc);
test('実HTTP: 既存resizeと追加buttonの草稿resize/削除・一括取消・再解釈', {timeout:45000}, async t=>{
 const app=await createLocalServer({port:0});t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.port}/api/node/`,{token}=await(await fetch(base+'capabilities')).json();
 const headers={'X-JSONUI-Token':token,'Content-Type':'application/json'},packId=randomUUID(),path='ui/editor33.json';
 const input=JSON.stringify({namespace:'t',main:{type:'screen',controls:[{tile:{type:'panel',anchor_from:'top_left',anchor_to:'top_left',offset:['10px','20px'],size:[80,40]}}]},other:{type:'screen',controls:[{keep:{type:'label',text:'残す'}}]}});
 const upload=await fetch(base+'packs',{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-JSONUI-Upload-ID':packId,'X-JSONUI-Name':'editor33.mcpack'},body:makeZip({'manifest.json':manifest,'ui/_ui_defs.json':JSON.stringify({ui_defs:[path]}),[path]:input})});assert.equal(upload.status,200);await upload.arrayBuffer();
 const post=async(route,payload,options={})=>{const reply=await fetch(base+route,{method:'POST',headers,body:JSON.stringify(payload),signal:options.signal||AbortSignal.timeout(20000)});const result=await reply.json();assert.equal(reply.status,200,JSON.stringify(result));return result;};
 const ws=createWorkspaceEditor({request:(r,p,o)=>post('workspace-'+r,p,o)});await ws.ensure([{id:packId,kind:'imported'}],'test33');ws.setMode('edit');
 async function project(){const c=await post('workspace-catalog',{workspaceId:ws.state.workspaceId}),r=c.records.find(x=>x.qualifiedName==='t.main');const p=await post('project',{catalogId:c.nodeCatalogId,recordId:r.id});return{p,r};}
 async function select(pointer){const {p,r}=await project(),src=p.nodeSources[pointer];assert(src);await ws.selectPreviewTarget({path:src.path,sourceId:packId,pointer:src.pointer},{fileId:'f',nodeId:pointer,effectivePointer:pointer,previewDefinitionId:r.id,screen:{path:r.filePath,sourceId:packId,pointer:pointerJoin([r.rawKey])}});}
 await select('/main/controls/0/tile');const initial=ws.state.revision;
 await ws.transformPreviewElement(resizeChanges33({x:10,y:20,w:80,h:40},{x:5,y:17,w:85,h:43},{anchor_to:'top_left'}));
 assert.equal(ws.pendingCount,2);assert.equal(ws.state.pendingOperations[0].groupId,ws.state.pendingOperations[1].groupId);ws.undoPending();assert.equal(ws.pendingCount,0);ws.redoPending();assert.equal(ws.pendingCount,2);
 await ws.applyPending();assert.notEqual(ws.state.revision,initial);let {p}=await project();assert.deepEqual(at(p.document,'/main/controls/0/tile').offset,['5px','17px']);assert.deepEqual(at(p.document,'/main/controls/0/tile').size,[85,43]);
 await ws.history('undo');assert.deepEqual(at((await project()).p.document,'/main/controls/0/tile').size,[80,40]);await ws.history('redo');
 await select('/main');await ws.addScreenElement31({name:'new_button_1',value:newElementValue33('button',[30,40])});
 const id=ws.pendingAdditions()[0].id;ws.editPendingAddition(id,{type:'set',property:'text',value:'変更ボタン'});ws.editPendingAddition(id,[{type:'move',delta:[-5,-10]},{type:'set',property:'size',value:[130,50]}]);
 assert.deepEqual(ws.pendingAdditions()[0].operation.value.size,[130,50]);ws.undoPending();assert.deepEqual(ws.pendingAdditions()[0].operation.value.size,[100,40]);ws.redoPending();
 const screen=ws.state.previewSelection.screen, draft=await post('workspace-preview-draft',{workspaceId:ws.state.workspaceId,expectedRevision:ws.state.revision,pendingVersion:ws.state.pendingVersion,screen,operation:{type:'batch',pointerBasis:'base-revision',operations:ws.pendingCompiledOperations()},frame:{generation:1,preset:{width:300,height:200},qualifiedName:'t.main'}});
 assert(draft.ok,JSON.stringify(draft));const button=draft.projection.document.main.controls.at(-1).new_button_1;assert.deepEqual(button.size,[130,50]);assert.equal(button.controls[0].caption.text,'変更ボタン');assert(draft.frame.layout.boxes.some(b=>b.id.endsWith('/new_button_1/caption')));
 ws.editPendingAddition(id,{type:'delete'});assert.equal(ws.pendingCompiledOperations().length,0);ws.undoPending();await ws.applyPending();
 assert.equal((await project()).p.document.main.controls.at(-1).new_button_1.controls[0].caption.text,'変更ボタン');
 // 通常の削除は計画の後すぐ実行でき、事前のresizeも同じ安全なbatchへ積める。
 await select('/main/controls/0/tile');await ws.transformPreviewElement([{type:'set',property:'size',value:[90,50]}]);await ws.planScreenDelete31();await ws.confirmDelete();assert.equal(ws.pendingCount,2);await ws.applyPending();
 assert.equal((await project()).p.document.main.controls.length,1);await ws.history('undo');assert.equal((await project()).p.document.main.controls.length,2);
});

test('Node計画は継承元の未解決サイズを保持し変数を固定化しない',async()=>{
 const {buildScopedEditContext,editWorkspaceScoped}=await import('../workspace-scoped-edit.mjs');
 const {resolveEffectiveUi}=await import('../../editor-core/src/engine/effective-ui-resolver.js');
 for(const size of ['$dims',[80,'$height'],[80,'100%c']]){
  const documents={'ui/raw.json':JSON.stringify({namespace:'raw',base:{type:'panel','$dims':[80,40],'$height':40,size,anchor_to:'top_left'},main:{type:'screen',controls:[{'tile@raw.base':{}}]}})};
  const context=await buildScopedEditContext({documents}),record=context.catalog.recordsById[context.catalog.symbols['raw.main'].winnerId],projection=resolveEffectiveUi({catalog:context.catalog,recordId:record.id});
  const pointer='/main/controls/0/tile',source=projection.nodeSources[pointer];
  const plan=await editWorkspaceScoped({documents,operation:{type:'planEdit',intendedType:'set',property:'size',scope:'screen',targetMode:'visual',path:context.internalPath(source),pointer:source.pointer,effectivePointer:pointer,screen:{path:context.internalPath(record),pointer:'/main'}}});
  assert(plan.ok,JSON.stringify(plan));assert.deepEqual(plan.editPlan.target.authoredGeometry33.size,size);
  if(size==='\u0024dims'||size[1]==='\u0024height')assert.throws(()=>resizeChanges33({x:0,y:0,w:80,h:40},{x:0,y:0,w:90,h:40},{...plan.editPlan.target.props,...plan.editPlan.target.authoredGeometry33}),{code:'WORKSPACE_RESIZE_SIZE_DYNAMIC'});
 }
});
