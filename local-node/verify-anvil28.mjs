/** 提供mcpack単体を共通HTTP APIで編集する。実機検証・完全バニラ検証ではない。 */
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CliClient } from './cli-client.mjs';
import { ResourceZipReader } from './resource-zip.mjs';
import { renderFramePng } from './frame-raster13.mjs';
import { buildRepresentativeClassicResolverVariables,buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('node local-node/verify-anvil28.mjs input.mcpack new-output-directory');
await mkdir(output,{recursive:false});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=await readFile(input),report={schema:'jsonui-anvil28-verification-v1',started_at:new Date().toISOString(),input:{name:path.basename(input),bytes:bytes.length,sha256:hash(bytes)},checks:[],limitations:['提供anvil-fixed単体。元ログのinventory-background + vanillaの組合せとは異なる。','実HTTP/Node Canvas。ブラウザーのドラッグ操作・Minecraft実機一致は未検証。']};
const at=(object,pointer)=>pointer.split('/').slice(1).map(x=>x.replaceAll('~1','/').replaceAll('~0','~')).reduce((v,k)=>v?.[k],object);
const pointer=key=>'/'+key.replaceAll('~','~0').replaceAll('/','~1');
let client;
try{
 client=await CliClient.start();const loaded=await client.importPack(input),sources=[{kind:'imported',id:loaded.id}];
 const ws=await client.request('/api/node/workspace-open',{payload:{sources}});assert(ws.ok,JSON.stringify(ws));const workspaceId=ws.workspaceId;
 const variables=buildRepresentativeClassicResolverVariables({qualifiedName:'anvil.anvil_screen'}),representativeCollections=buildRepresentativeClassicCollections({qualifiedName:'anvil.anvil_screen'});
 async function project(){const catalog=await client.request('/api/node/workspace-catalog',{payload:{workspaceId}});const record=catalog.records.find(r=>r.qualifiedName==='anvil.anvil_screen');assert(record);const projection=await client.request('/api/node/project',{payload:{catalogId:catalog.nodeCatalogId,recordId:record.id,variables,representativeCollections}});assert(projection.ok,JSON.stringify(projection.error));return{record,projection};}
 let before=await project();report.catalog={record:before.record.qualifiedName,source_nodes:Object.keys(before.projection.nodeSources).length};
 const candidates=Object.entries(before.projection.nodeSources).filter(([p,s])=>p.endsWith('/close_button_image')&&p.includes('/default/'));
 assert(candidates.length,'close image not found');const [effectivePointer,source]=candidates.find(([p])=>p.includes('/invbg_close/'))||candidates[0];
 const same=Object.entries(before.projection.nodeSources).filter(([,s])=>s.path===source.path&&s.sourceId===source.sourceId&&s.pointer===source.pointer);
 report.selection={effective_pointer:effectivePointer,source,shared_sources:same.length};
 const beforeOffsets=Object.fromEntries(same.map(([p])=>[p,at(before.projection.document,p)?.offset||[0,0]]));
 async function raster(name,current){const frameRequest={projectionId:current.projection.nodeProjectionId,filePath:current.record.filePath,generation:1,preset:{width:480,height:270},animationTime:1,visibilityMode:'safe'};
 const frame=await client.request('/api/node/frame',{payload:frameRequest});assert(frame.ok!==false);
 const status=await client.request('/api/node/workspace-status',{payload:{workspaceId}});
 const result=await renderFramePng({client,sources:status.sources,projection:current.projection,frame,frameRequest,width:1920,height:1080,uiScale:4,locale:'ja_JP',timeSeconds:1,allowPartial:true});
 if(name==='before'){const strict=await renderFramePng({client,sources:status.sources,projection:current.projection,frame,frameRequest,width:1920,height:1080,uiScale:4,locale:'ja_JP',timeSeconds:1,allowPartial:false});report.strict_png={ok:strict.ok,complete:strict.complete,code:strict.code,diagnostics:strict.diagnostics};assert.equal(strict.ok,false,'未対応rendererを含む金床の厳密PNGは成功にしない');assert(strict.diagnostics?.some(d=>d.code==='RASTER_NATIVE_UNSUPPORTED'));}
 report[name]={ok:result.ok,complete:result.complete,code:result.code,diagnostics:result.diagnostics,rendering:result.rendering,provenance:result.provenance};
 if(result.ok){await writeFile(path.join(output,name+'.png'),result.png,{flag:'wx'});report[name].sha256=hash(result.png);}
 }
 await raster('before',before);
 const operation={type:'move',scope:'screen',targetMode:'visual',path:source.path,sourceId:source.sourceKind,pointer:source.pointer,effectivePointer,
 screen:{path:before.record.filePath,pointer:pointer(before.record.rawKey),sourceId:before.record.sourceKind},delta:[11,7],preview:{variables,representativeCollections}};
 const plan=await client.request('/api/node/workspace-edit',{payload:{workspaceId,expectedRevision:ws.revision,operation:{...operation,type:'planEdit',intendedType:'move'}}});
 assert(plan.ok,JSON.stringify(plan));report.edit_plan=plan.editPlan;
 const edited=await client.request('/api/node/workspace-edit',{payload:{workspaceId,expectedRevision:ws.revision,operation}});
 assert(edited.ok,JSON.stringify(edited));report.edit_result={revision:edited.revision,editPlan:edited.editPlan,changes:edited.changes?.map(c=>({path:c.path}))};
 const after=await project();const expected=beforeOffsets[effectivePointer].map((x,i)=>Number(x)+[11,7][i]);
 assert.deepEqual(at(after.projection.document,effectivePointer).offset,expected);
 for(const [p] of same)if(p!==effectivePointer)assert.deepEqual(at(after.projection.document,p)?.offset||[0,0],beforeOffsets[p]);
 report.checks.push({name:'選択した閉じる画像のoffsetのみ移動',status:'PASS',offset:expected,unchanged_other_instances:same.length-1});
 await raster('after',after);
 // Exercise the same undo/redo endpoints as the website, retaining original revisions.
 for(const direction of ['undo','redo']){
 const status=await client.request('/api/node/workspace-status',{payload:{workspaceId}});
 const result=await client.request('/api/node/workspace-'+direction,{payload:{workspaceId,expectedRevision:status.revision}});assert(result.ok,JSON.stringify(result));
 const p=await project();assert.deepEqual(at(p.projection.document,effectivePointer).offset||[0,0],direction==='undo'?beforeOffsets[effectivePointer]:expected);
 report.checks.push({name:direction,status:'PASS',revision:result.revision});
 }
 assert.equal(hash(await readFile(input)),report.input.sha256);report.checks.push({name:'入力ZIPを変更しない',status:'PASS'});
 // Export uses the same dependency validation as the website. A rejection is recorded,
 // not replaced with a guessed dependency or misreported as a successful export.
 const final=await project();
 const exportPayload={workspaceId,selections:[{sourceId:final.record.sourceId,filePath:final.record.filePath,rawKey:final.record.rawKey}],mode:'plan'};
 try {
  const plan=await client.request('/api/node/workspace-export',{payload:exportPayload});
  report.export={status:plan.ok?'PLAN_PASS':'BLOCKED',plan};
  if(plan.ok){
   const archive=await client.request('/api/node/workspace-export',{payload:{...exportPayload,mode:'zip'},binary:true,maximum:256*1024*1024});
   assert.equal(archive.readUInt32LE(0),0x04034b50,'書出結果ZIPシグネチャ');
   const exported=path.join(output,'edited.mcpack');await writeFile(exported,archive,{flag:'wx'});
   const reader=new ResourceZipReader();try{await reader.openFromFile({diskPath:exported,name:'edited.mcpack'});await reader.listEntries();for(const entry of reader.entryIndex.keys())await reader.bytes(entry);report.export.crc_files=reader.entryIndex.size;}finally{await reader.close();}
   const loadedAgain=await client.importPack(exported);
   const wsAgain=await client.request('/api/node/workspace-open',{payload:{sources:[{kind:'imported',id:loadedAgain.id}]}});assert(wsAgain.ok);
   const catAgain=await client.request('/api/node/workspace-catalog',{payload:{workspaceId:wsAgain.workspaceId}});
   const recordAgain=catAgain.records.find(r=>r.qualifiedName==='anvil.anvil_screen');assert(recordAgain);
   const projAgain=await client.request('/api/node/project',{payload:{catalogId:catAgain.nodeCatalogId,recordId:recordAgain.id,variables,representativeCollections}});assert(projAgain.ok);
   assert.deepEqual(at(projAgain.document,effectivePointer)?.offset,expected);
   report.export.status='PASS';report.export.bytes=archive.length;report.export.sha256=hash(archive);
   report.checks.push({name:'選択書出→全CRC→再取込→移動値保持',status:'PASS'});
  }
 }catch(error){report.export={status:'BLOCKED',code:error.code,message:error.message,detail:error.detail};}
 // Read current operation summaries through the real diagnostics endpoint.
 const bundle=await client.request('/api/node/debug-bundle',{payload:{schema:'jsonui-debug-request-v1',state:{surface:'verification-r28'},diagnostics:[],events:[]}});
 await writeFile(path.join(output,'debug.json'),JSON.stringify(bundle,null,2));
 report.status='PASS';
}catch(error){report.status='FAIL';report.error={code:error.code,message:error.message,stack:error.stack};process.exitCode=1;}
finally{await client?.close();report.finished_at=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error}));}
