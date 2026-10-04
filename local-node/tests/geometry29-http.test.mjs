/** 実main入口→実編集controller→HTTP/Worker→MCPACK→新規読込。
 * DOMイベントとMinecraftエンジンは検査対象に含めない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { CliClient } from '../cli-client.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { ResourceZipReader } from '../resource-zip.mjs';
import { createWorkspaceEditor, buildWorkspacePreviewSourceMap, findAuthoredNodeForPreview, escapeSourcePointer, workspacePreviewDefinitionIdentity } from '../../editor-core/src/ui/workspace-editor.js';
import { resolvePlannedPreviewNodeIds22 } from '../../editor-core/src/ui/workspace-preview-feedback22.js';
import { workspacePreviewEditOperation, workspaceEditSelectionIdentity } from '../../editor-core/src/ui/workspace-edit-intent.js';
import { captureGeometryPolicy29, assertGeometryPolicy29, distinctPlannedMoves29 } from '../../editor-core/src/ui/workspace-geometry-policy29.js';
import { createEditorSelection21 } from '../../editor-core/src/ui/editor-selection21.js';
import { lockedMovement26 } from '../../editor-core/src/ui/editor-arrangement26.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { siteText } from '../../editor-core/src/i18n/site-messages.js';

const mainUrl = process.env.JSONUI_REGRESSION_PRODUCT ? pathToFileURL(process.env.JSONUI_REGRESSION_PRODUCT+'/editor-core/src/main.js') : new URL('../../editor-core/src/main.js', import.meta.url);
const main = await readFile(mainUrl,'utf8');
const section=(a,b)=>{const i=main.indexOf(a),j=main.indexOf(b,i);assert(i>=0&&j>i);return main.slice(i,j);};
const at=(obj,p)=>p.split('/').slice(1).map(k=>k.replaceAll('~1','/').replaceAll('~0','~')).reduce((v,k)=>v?.[k],obj);
const documents={
 'manifest.json':manifest,'ui/_ui_defs.json':JSON.stringify({ui_defs:['ui/common.json','ui/screens.json']}),
 'ui/common.json':JSON.stringify({namespace:'common',look:{type:'panel',size:[12,12],controls:[{icon:{type:'label',text:'閉じる',size:[12,12]}}]},
  close:{type:'button',size:[20,20],offset:[5,6],default_control:'default',hover_control:'hover',pressed_control:'pressed',
   button_mappings:[{from_button_id:'button.menu_select',to_button_id:'button.menu_exit',mapping_type:'pressed'}],
   controls:[{'default@common.look':{}},{'hover@common.look':{}},{'pressed@common.look':{}}]},
  slot:{type:'input_panel',size:[18,18],offset:[40,10],$item_collection_name:'anvil_result_items',controls:[
   {cell:{type:'panel',size:[18,18]}},{item:{type:'label',text:'#inventory_stack_count',bindings:[{binding_type:'collection',binding_collection_name:'$item_collection_name',binding_name:'#inventory_stack_count'}]}},
   {action:{type:'button',size:['100%','100%'],button_mappings:[{from_button_id:'button.menu_select',to_button_id:'button.anvil_take_all_place_all',mapping_type:'pressed'}]}}]}}),
 'ui/screens.json':JSON.stringify({namespace:'fixture',screen_a:{type:'screen',size:[200,100],controls:[{'close@common.close':{}},{'slot@common.slot':{}}]},screen_b:{type:'screen',size:[200,100],controls:[{'close@common.close':{}},{'slot@common.slot':{}}]}}),
};
const cases=[{name:'閉じるボタン',pointer:'/screen_a/controls/0/close/controls/0/default/controls/0/icon',owner:'/screen_a/controls/0/close',type:'button'},
 {name:'結果スロット',pointer:'/screen_a/controls/1/slot/controls/0/cell',owner:'/screen_a/controls/1/slot',type:'input_panel'}];
const matrix=['interaction','visual'].flatMap(mode=>cases.map(target=>({mode,target})));
matrix.push({mode:'interaction',target:{name:'閉じる＋結果の複数選択',pointer:cases[0].pointer,selected:[cases[0].pointer,cases[1].pointer],owners:cases}},
 {mode:'interaction',target:{name:'同じボタンの通常＋ホバー',pointer:cases[0].pointer,selected:[cases[0].pointer,cases[0].pointer.replace('/0/default/','/1/hover/')],owners:[cases[0]]}});
const navigationComparison = new Map();
for (const mode of ['interaction','visual']) matrix.push({mode,target:{...cases[0],name:'プレビューON/OFFとMinecraft出力の独立性',navigationEnabled:true}});
for(const {mode,target} of matrix) test(`R29 実main→HTTP→書出: ${target.name} / ${mode}`,{timeout:30000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jui-geometry29-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const input=path.join(dir,'input.mcpack'),original=makeZip(documents);await writeFile(input,original);
 const client=await CliClient.start();t.after(()=>client.close());const pack=await client.importPack(input),sources=[{kind:'imported',id:pack.id}];
 let file;
 const request=(action,payload)=>client.request('/api/node/workspace-'+action,{payload});
 const ws=createWorkspaceEditor({request,resolvePreviewEditTargets:(_,plan)=>resolvePlannedPreviewNodeIds22(buildWorkspacePreviewSourceMap(file),plan)});
 await ws.ensure(sources,'stack');ws.setMode('edit');ws.setEditOptions({targetMode:mode});
 async function project(workspaceId,symbol='fixture.screen_a'){
  const catalog=await request('catalog',{workspaceId}),record=catalog.records.find(x=>x.qualifiedName===symbol);assert(record);
  const p=await client.request('/api/node/project',{payload:{catalogId:catalog.nodeCatalogId,recordId:record.id}});assert(p.ok,JSON.stringify(p));return{catalog,record,p};
 }
 const before=await project(ws.state.workspaceId),other=await project(ws.state.workspaceId,'fixture.screen_b');
 const uiModel=buildUiScreenModelFromJson(before.p.document,{filePath:before.record.filePath});
 file={id:'f',path:before.record.filePath,uiModel,...buildTreeFromUiScreenModel(uiModel),meta:{previewProjection:true,selectedDefinition:{...before.record,recordId:before.record.id},resolution:{nodeSources:before.p.nodeSources}}};
 const mapping=buildWorkspacePreviewSourceMap(file),id=[...mapping].find(([,s])=>s.previewPointer===target.pointer)?.[0];assert(id);
 const selection=createEditorSelection21();selection.useScreen('a',{...file,rootId:uiModel.root.id});selection.setSelection((target.selected||[target.pointer]).map(pointer=>{const match=[...mapping].find(([,s])=>s.previewPointer===pointer)?.[0];assert(match);return match;}));
 const c=vm.createContext({console,Map,Set,Date,JSON,Number,Object,String,Promise,Error,siteText,
  sourceWorkspace:ws,workspaceSources:()=>sources,workspaceSourceKey:()=>'stack',workspacePreviewSourceId:()=>pack.id,
  findAuthoredNodeForPreview,escapeSourcePointer,workspacePreviewDefinitionIdentity,buildWorkspacePreviewSourceMap,resolvePlannedPreviewNodeIds22,
  workspacePreviewEditOperation,workspaceEditSelectionIdentity,captureGeometryPolicy29,assertGeometryPolicy29,distinctPlannedMoves29,lockedMovement26,
  studioSelection21:()=>selection,store:{getState:()=>({files:{currentFileId:'f',byId:{f:file}},preview:{navigation:{enabled:Boolean(target.navigationEnabled)}}}),dispatch(){}},actions:{selectNode:id=>({id})},
  movementDelta21:(a,b)=>[b.x-a.x,b.y-a.y],requestCanvasTextureRedraw(){},safeRender(){},setStatus(){},reportWorkspaceError:e=>{throw e;}});
 vm.runInContext(section('function sourceNodeForPreview(','function selectPreviewForSource(')+section('async function selectSourceForCanvasNode(','async function addSourceCanvasElement(')+
  section('function studioPreviewSelection21(','function closeStudioContextMenu21('),c);
 if(main.includes('const studioLocks26 =')) vm.runInContext(section('const studioLocks26 =','async function studioArrange26(')+section('const studioEditPreviewProperty26 =','const studioEditPendingAddition26 ='),c);
 else c.assertStudioUnlocked26=()=>{}; // 比較対象0.12.1には、後のロック機能がまだない。
 await c.commitSourceCanvasMove(file,id,{}, {x:11,y:7},{x:0,y:0});
 assert.equal(ws.state.pendingOperations.length,(target.owners||[target]).length);assert.equal(ws.state.pendingOperations[0].operation.targetMode,mode,'入口が利用者指定を変更しない');
 const response=await ws.applyPending();assert(response.ok,JSON.stringify(response));assert.equal(ws.state.pendingOperations.length,0);
 const after=await project(ws.state.workspaceId),expected=structuredClone(before.p.document);
 for(const owner of target.owners||[target]){const modified=at(expected,mode==='interaction'?owner.owner:owner.pointer);
  modified.offset=(modified.offset||[0,0]).map((x,i)=>x+[11,7][i]);} 
 if (target.name === '閉じるボタン') navigationComparison.set(mode, JSON.stringify(after.p.document));
 if (target.navigationEnabled) assert.equal(JSON.stringify(after.p.document), navigationComparison.get(mode), 'ブラウザーの動作確認ON/OFFでMinecraft用原文の意味が変わらない');
 assert.deepEqual(after.p.document,expected,'位置以外の全実効属性（入力割当/binding/状態/兄弟）を保存');
 assert.deepEqual((await project(ws.state.workspaceId,'fixture.screen_b')).p.document,other.p.document);
 const exp={workspaceId:ws.state.workspaceId,mode:'plan',selections:[{filePath:after.record.filePath,rawKey:after.record.rawKey,sourceId:after.record.sourceId}]};
 const plan=await request('export',exp);assert(plan.ok,JSON.stringify(plan));
 const bytes=await client.request('/api/node/workspace-export',{payload:{...exp,mode:'zip'},binary:true}),output=path.join(dir,'output.mcpack');await writeFile(output,bytes);
 const zip=new ResourceZipReader();try{await zip.openFromFile({diskPath:output,name:'output.mcpack'});await zip.listEntries();for(const key of zip.entryIndex.keys())await zip.bytes(key);}finally{await zip.close();}
 const restoredPack=await client.importPack(output),restored=await request('open',{sources:[{kind:'imported',id:restoredPack.id}]});
 const again=await project(restored.workspaceId);assert.deepEqual(again.p.document,after.p.document,'編集状態に頼らない新規MCPACK読込');
 for(const owner of target.owners||[target])assert.equal(at(again.p.document,owner.owner).type,owner.type);assert.deepEqual(await readFile(input),original);
});
