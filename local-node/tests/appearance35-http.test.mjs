/** text/texture の実controller→HTTP→Worker草稿→確定→ZIP再読込。実機表示一致は対象外。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalServer} from '../server.mjs';
import {makeZip,manifest} from './fixtures.mjs';
import {createWorkspaceEditor} from '../../editor-core/src/ui/workspace-editor.js';
import {pointerParts} from '../workspace-jsonc.mjs';
const at=(doc,pointer)=>pointerParts(pointer).reduce((value,key)=>value?.[key],doc);
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJlcAAAAASUVORK5CYII=','base64');

test('表示属性: 継承したlabel/imageを選択画面だけ変更し、草稿frameと保存後の再取込へ届く',{timeout:45000},async t=>{
 const app=await createLocalServer({port:0});t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.port}/api/node/`,{token}=await(await fetch(base+'capabilities')).json();
 const headers={'X-JSONUI-Token':token,'Content-Type':'application/json'};
 const post=async(route,payload,options={})=>{
  const response=await fetch(base+route,{method:'POST',headers,body:JSON.stringify(payload),signal:options.signal||AbortSignal.timeout(20000)});
  if(options.blob){assert.equal(response.status,200);return response.blob();}
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
 };
 const upload=async bytes=>{const id=randomUUID(),r=await fetch(base+'packs',{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-JSONUI-Upload-ID':id,'X-JSONUI-Name':'appearance35.mcpack'},body:bytes,signal:AbortSignal.timeout(20000)});assert.equal(r.status,200,await r.text());return id;};
 const screen={type:'screen',controls:[{'title@common.title':{}},{'image@common.image':{}}]};
 const files={'manifest.json':manifest,'ui/_ui_defs.json':JSON.stringify({ui_defs:['ui/common.json','ui/main.json']}),
  'ui/common.json':JSON.stringify({namespace:'common',title:{type:'label',text:'$title','$title':'元の文字',size:[100,20]},image:{type:'image',texture:'textures/ui/old',size:[20,20]}}),
  'ui/main.json':JSON.stringify({namespace:'appearance',main:screen,other:screen}),'textures/ui/old.png':pixel,'textures/ui/new.png':pixel};
 const packId=await upload(makeZip(files)),ws=createWorkspaceEditor({request:(route,payload,options)=>post('workspace-'+route,payload,options)});
 await ws.ensure([{id:packId,kind:'imported'}],'appearance35');ws.setMode('edit');
 async function project(workspaceId=ws.state.workspaceId,symbol='appearance.main'){
  const catalog=await post('workspace-catalog',{workspaceId}),record=catalog.records.find(row=>row.qualifiedName===symbol);assert(record);
  const projection=await post('project',{catalogId:catalog.nodeCatalogId,recordId:record.id});assert(projection.ok);return{record,projection};
 }
 async function select(pointer){const {record,projection}=await project(),node=projection.nodeSources[pointer];assert(node);await ws.selectPreviewTarget({path:node.path,pointer:node.pointer,sourceId:packId},{fileId:'f',nodeId:pointer,effectivePointer:pointer,screen:{path:record.filePath,pointer:'/main',sourceId:packId}});}
 const title='/main/controls/0/title',texture='/main/controls/1/image',originalOther=(await project(undefined,'appearance.other')).projection.document;
 await select(title);const text='日本語 "見出し"\n<img src=x onerror=alert(1)>';await ws.editPreviewProperty('text',text);
 await select(texture);await ws.editPreviewProperty('texture','textures/ui/new');assert.equal(ws.pendingCount,2);
 const draft=await post('workspace-preview-draft',{workspaceId:ws.state.workspaceId,expectedRevision:ws.state.revision,pendingVersion:ws.state.pendingVersion,
  screen:ws.state.previewSelection.screen,operation:{type:'batch',pointerBasis:'base-revision',operations:ws.pendingCompiledOperations()},frame:{generation:1,preset:{width:300,height:200},qualifiedName:'appearance.main'}});
 assert(draft.ok,JSON.stringify(draft));assert.equal(at(draft.projection.document,title).text,text);assert.equal(at(draft.projection.document,texture).texture,'textures/ui/new');
 assert(draft.frame.layout.boxes.some(box=>box.type==='label'));assert(draft.frame.layout.boxes.some(box=>box.type==='image'));
 assert.equal(at((await project()).projection.document,title).text,'元の文字','草稿を確定前の原文に混ぜない');
 await ws.applyPending();const saved=(await project()).projection.document;assert.equal(at(saved,title).text,text);assert.equal(at(saved,texture).texture,'textures/ui/new');
 assert.deepEqual((await project(undefined,'appearance.other')).projection.document,originalOther,'別画面の共通継承は変更しない');
 const original=await post('workspace-read',{workspaceId:ws.state.workspaceId,path:'ui/common.json',sourceId:packId});assert.equal(original.text,files['ui/common.json'],'共有元の変数と原文は保持する');
 ws.selectExport({filePath:'ui/main.json',rawKey:'main',sourceId:packId});const exported=await ws.export('zip');assert(exported.size>100);
 const restoredId=await upload(exported),restored=await post('workspace-open',{sources:[{id:restoredId,kind:'imported'}]});
 const reread=(await project(restored.workspaceId)).projection.document;assert.equal(at(reread,title).text,text);assert.equal(at(reread,texture).texture,'textures/ui/new');
});
