/** 利用者の再現MCPACKは環境変数で渡す。配布物へ原本を同梱しない。 */
import test from'node:test';import assert from'node:assert/strict';
import{mkdtemp,writeFile,readFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import path from'node:path';import{createHash}from'node:crypto';
import{CliClient}from'../cli-client.mjs';import{createWorkspaceEditor}from'../../editor-core/src/ui/workspace-editor.js';import{ResourceZipReader}from'../resource-zip.mjs';import{pointerJoin,pointerParts}from'../workspace-jsonc.mjs';
const input=process.env.JSONUI_R32_PACK;
const suffixes={close:'/invbg_close/controls/0/close/controls/0/default/controls/0/close_button_image',icon:'/anvil_icon_panel/controls/0/anvil_icon',background:'/root_panel/controls/1/invbg_background',functional:'/invbg_close/controls/0/close/controls/0/default/controls/0/close_button_image',add:'/root_panel',addCloseSibling:'/invbg_close/controls/0/close/controls/0/default/controls/0/close_button_image',addBackgroundSibling:'/root_panel/controls/1/invbg_background',slot:'inventory_grid/controls/7/preview_slot_7/controls/0/item_cell/controls/0/bg/controls/0/cell_base'};
const sha=b=>createHash('sha256').update(b).digest('hex');const at=(x,p)=>pointerParts(p).reduce((v,k)=>v?.[k],x);
// 個別化による定義名の変化だけを反転する。表示文字列や並び順は正規化で消さない。
function canonical(value,plan,key='',parentKey=''){
 const names=new Map((plan?.clonedDefinitions||[]).map(x=>[x.qualifiedName,x.original]));
 const visit=(v,k,pk)=>{
  if(typeof v==='string'&&(k.startsWith('$')||['grid_item_template','collection_item_template','control_name'].includes(k)||pk==='control_ids')){
   if(names.has(v))return names.get(v);const i=v.lastIndexOf('@');if(i>=0&&names.has(v.slice(i+1)))return v.slice(0,i+1)+names.get(v.slice(i+1));
  }
  if(Array.isArray(v))return v.map(x=>visit(x,k,pk));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([a,b])=>[a,visit(b,a,k)]));return v;
 };return visit(value,key,parentKey);
}
for(const scenario of Object.keys(suffixes))test(`R32 実添付MCPACK ${scenario} 計画・確定・履歴・出力可否照合`,{timeout:120000,skip:!input&&'JSONUI_R32_PACKで利用者のMCPACKを指定'},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jui-real32-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const inputHash=sha(await readFile(input));const client=await CliClient.start();t.after(()=>client.close());
 const pack=await client.importPack(input);const request=(action,payload)=>client.request('/api/node/workspace-'+action,{payload});const ws=createWorkspaceEditor({request});
 await ws.ensure([{id:pack.id,kind:'imported'}],'actual');ws.setMode('edit');ws.setEditOptions({targetMode:'interaction'});
 async function project(id=ws.state.workspaceId){const c=await request('catalog',{workspaceId:id}),r=c.records.find(x=>x.qualifiedName==='anvil.anvil_screen');assert(r);const p=await client.request('/api/node/project',{payload:{catalogId:c.nodeCatalogId,recordId:r.id}});assert(p.ok);return{r,p};}
 const before=await project();const matches=Object.keys(before.p.nodeSources).filter(p=>p.endsWith(suffixes[scenario]));assert.equal(matches.length,1,scenario);
 const ep=matches[0],src=before.p.nodeSources[ep];await ws.selectPreviewTarget({path:src.path,sourceId:pack.id,pointer:src.pointer},{fileId:'f',nodeId:ep,previewDefinitionId:before.r.id,effectivePointer:ep,screen:{path:before.r.filePath,sourceId:pack.id,pointer:pointerJoin([before.r.rawKey])}});
 const baselineExport=await request('export',{workspaceId:ws.state.workspaceId,selections:[{filePath:before.r.filePath,sourceId:before.r.sourceId,rawKey:before.r.rawKey}],mode:'plan'});
 const revision=ws.state.revision;const isAdd=scenario.startsWith('add');
 if(scenario==='slot'){await assert.rejects(ws.planScreenDelete31(),{code:'EDIT_STRUCTURE_GENERATED'});assert.equal(ws.state.revision,revision);assert.equal(ws.state.pendingOperations.length,0);return;}
 if(isAdd){
  let options={};
  if(scenario!=='add'){
   const parts=pointerParts(ep);let parentPath='';
   while(parts.length){parts.pop();const candidate=pointerJoin(parts);if(before.p.nodeSources[candidate]){parentPath=candidate;break;}}
   assert(parentPath);const parent=before.p.nodeSources[parentPath];
   options={targetSelection:{...ws.state.previewSelection,path:parent.path,pointer:parent.pointer,nodeId:parentPath,effectivePointer:parentPath}};
  }
  await ws.addScreenElement31({name:'r32_verified_label',value:{type:'label',text:'R32 検査用',size:[90,12],offset:[10,10]}},options);
 }
 else {if(scenario==='functional')ws.state.deleteUnit32='functional';await ws.planScreenDelete31();await ws.confirmDelete();}
 assert.equal(ws.state.pendingOperations.length,1);assert.equal(ws.state.revision,revision);
 const commit=await ws.applyPending();assert(commit.ok,JSON.stringify(commit));const editPlan=commit.editPlan?.operations?.[0]?.editPlan||commit.editPlan;
 assert(editPlan?.target);const after=await project();const expected=structuredClone(before.p.document),target=editPlan.target.effectivePointer;
 if(isAdd)at(expected,target).controls.push({r32_verified_label:{type:'label',text:'R32 検査用',size:[90,12],offset:[10,10]}});
 else {const parts=pointerParts(target);const container=at(expected,pointerJoin(parts.slice(0,-2)));assert(Array.isArray(container));container.splice(Number(parts.at(-2)),1);}
 assert.deepEqual(canonical(after.p.document,editPlan),expected,'指定した構造差分以外の表示・条件を保持');
 await ws.history('undo');assert.deepEqual((await project()).p.document,before.p.document);await ws.history('redo');assert.deepEqual((await project()).p.document,after.p.document);
 const cur=await project();const bytes=await client.request('/api/node/workspace-export',{payload:{workspaceId:ws.state.workspaceId,selections:[{filePath:cur.r.filePath,sourceId:cur.r.sourceId,rawKey:cur.r.rawKey}],mode:'zip'},binary:true});
 if(bytes.subarray(0,2).toString()!=='PK'){
   const failure=JSON.parse(bytes.toString());
   if(process.env.JSONUI_R32_EVIDENCE)await writeFile(path.join(process.env.JSONUI_R32_EVIDENCE,`export-refused-${scenario}.json`),JSON.stringify(failure,null,2));
   const missing=plan=>(plan.plan?.unresolved||plan.unresolved||[]).map(x=>[x.code,x.reference]).sort();
   assert.equal(baselineExport.ok,false,'元から不足する依存以外の失敗は許容しない');
   assert.deepEqual(missing(failure),missing(baselineExport));
   assert.deepEqual(missing(failure),[['EXPORT_UI_SYMBOL_MISSING','storage_management_popup.sharing_popup_content'],['EXPORT_UI_SYMBOL_MISSING','storage_management_popup.storage_dependency_modal']]);
   assert.equal(sha(await readFile(input)),inputHash);
   if(process.env.JSONUI_R32_EVIDENCE)await writeFile(path.join(process.env.JSONUI_R32_EVIDENCE,`pack-${scenario}.json`),JSON.stringify({scenario,inputHash,target,referenceAnalysis:editPlan.structure?.referenceAnalysis,status:'PASS_EDIT_HISTORY',exportStatus:'BLOCKED_PREEXISTING_REFERENCE_INPUT',unresolved:missing(failure),newImport:'NOT_RUN',minecraft:'NOT_RUN'},null,2));
   t.diagnostic('原本にも同じ2参照が不足。原文の編集・履歴のみ確認、書出成功と新規読込は未達。');return;
 }
 const file=path.join(dir,'result.mcpack');await writeFile(file,bytes);const zip=new ResourceZipReader();let entries=0;
 try{await zip.openFromFile({diskPath:file,name:'result.mcpack'});await zip.listEntries();for(const p of zip.entryIndex.keys()){await zip.bytes(p);entries++;}}finally{await zip.close();}
 const imported=await client.importPack(file);const restored=await request('open',{sources:[{id:imported.id,kind:'imported'}]});const roundtrip=await project(restored.workspaceId);
 assert.deepEqual(roundtrip.p.document,after.p.document,'未出力データを持たない新規セッションで再読込');assert.equal(sha(await readFile(input)),inputHash);
 if(process.env.JSONUI_R32_EVIDENCE){await writeFile(path.join(process.env.JSONUI_R32_EVIDENCE,`pack-${scenario}.json`),JSON.stringify({scenario,inputHash,exportHash:sha(bytes),exportEntries:entries,exportBytes:bytes.length,target,referenceAnalysis:editPlan.structure?.referenceAnalysis,status:'PASS_EDIT_HISTORY_EXPORT_REIMPORT',minecraft:'NOT_RUN'},null,2));}
});
