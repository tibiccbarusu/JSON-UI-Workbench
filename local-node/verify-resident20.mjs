/** 同一のNodeサーバー/Workerを保持する有限長時間検査。実機検査ではない。 */
import assert from 'node:assert/strict';
import { mkdir, open, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { CliClient } from './cli-client.mjs';
import { productDigest } from './verify-stability13.mjs';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';

const [reference, imported, output, rawDuration='9000', rawCadence='15'] = process.argv.slice(2);
const duration=Number(rawDuration),cadence=Number(rawCadence);
if(!reference||!imported||!output||!Number.isInteger(duration)||duration<30||duration>10800||!Number.isInteger(cadence)||cadence<1||cadence>60)throw new Error('参照ZIP、通常パック、新しい出力先、30〜10800秒、1〜60秒cadenceを指定してください。');
await mkdir(output,{recursive:false});
const events=await open(path.join(output,'events.jsonl'),'wx');
const now=()=>new Date().toISOString(),start=performance.now();
const elapsed=()=>Math.round((performance.now()-start)/1000);
const stop=new AbortController();
const report={schema:'jsonui-resident20',status:'RUNNING',started_at:now(),duration_seconds:duration,cadence_seconds:cadence,source_start:await productDigest(),cycles:0,operations:0,failures:[],domain_blocked:[],definitions:{},peaks:{rss:0,worker_heap_used:0},limitations:[
 '同一Nodeサーバー/Workerで実HTTPを反復する検査。ブラウザ、Windows、Minecraft実機は未実施。',
 '代表runtimeでの投影・配置・cache・編集undoを検査する。PNG完全性や実機画素一致を示さない。',
 '入力素材を保持してwarm/cold表示を反復する。同じPASSの反復をPHASE新規完了数へ加算しない。',
 'ソースが実行中に変わったら停止する。固定ソースの長時間検査へ混ぜない。'
]};
let client,workspace,catalog,active='INITIALIZE',lastOperationAt=Date.now();
const emit=async row=>{await events.write(JSON.stringify({at:now(),elapsed_seconds:elapsed(),...row})+'\n');};
const snapshot=()=>{
 const s=client?.app?.processor?.snapshot(), c=s?.caches;
 const rss=process.memoryUsage().rss,workerHeap=c?.worker_memory?.heapUsed||0;
 report.peaks.rss=Math.max(report.peaks.rss,rss);report.peaks.worker_heap_used=Math.max(report.peaks.worker_heap_used,workerHeap);
 return {rss,worker_heap_used:workerHeap,worker:s?{dead:s.dead,pending:s.pending,calls:s.calls,failed:s.failed,completed:s.completed,active_jobs:s.active_jobs}:null,
  frame:c?.frame_ir,projection_cache:c?.projection_cache,response_cache:c?.response_cache,zip_io:c?.zip_io};
};
async function checkpoint(){await writeFile(path.join(output,'progress.json'),JSON.stringify({...report,at:now(),elapsed_seconds:elapsed(),active,last_operation_age_seconds:Math.round((Date.now()-lastOperationAt)/1000),metrics:snapshot()},null,2)+'\n');}
async function step(name,fn,summarize=x=>({ok:x?.ok!==false})){
 active=name;report.operations++;await emit({event:'OP_BEGIN',operation:name,index:report.operations});const begin=performance.now();
 const value=await fn();lastOperationAt=Date.now();await emit({event:'OP_END',operation:name,index:report.operations,duration_ms:Math.round(performance.now()-begin),...summarize(value)});return value;
}
const guard=setInterval(()=>{
 if(Date.now()-lastOperationAt>180000)stop.abort(new Error('180秒の実操作停止を検知'));
 checkpoint().catch(e=>stop.abort(e));
},30000);
process.once('SIGINT',()=>stop.abort(new Error('明示停止')));process.once('SIGTERM',()=>stop.abort(new Error('明示停止')));
let rootPath,base;
try{
 client=await CliClient.start({signal:stop.signal});rootPath=client.app.root;base=client.base;
 const sources=[];
 for(const [kind,p] of [['vanilla',reference],['imported',imported]]){
  const pack=await step('IMPORT_'+kind.toUpperCase(),()=>client.importPack(p),v=>({id:v.id,bytes:v.source.size_bytes,sha256:v.source.checksum_sha256}));sources.push({id:pack.id,kind,rootPrefix:pack.rootPrefix});
 }
 workspace=await step('WORKSPACE_OPEN',()=>client.request('/api/node/workspace-open',{payload:{sources},timeout:60000}));
 catalog=await step('CATALOG',()=>client.request('/api/node/workspace-catalog',{payload:{workspaceId:workspace.workspaceId},timeout:60000}),v=>({records:v.records?.length}));
 const preferred=['anvil.anvil_screen','chest.small_chest_screen','chest.large_chest_screen','crafting.inventory_screen','crafting.crafting_screen','enchanting.enchanting_screen','horse.horse_screen','furnace.furnace_screen','beacon.beacon_screen','brewing_stand.brewing_stand_screen','grindstone.grindstone_screen','cartography.cartography_screen'];
 const records=preferred.map(name=>catalog.records.filter(r=>r.qualifiedName===name&&r.profile==='classic').sort((a,b)=>b.precedence-a.precedence)[0]).filter(Boolean);
 assert(records.length>=8,'必要な代表画面が不足');report.selected_definitions=records.map(r=>r.qualifiedName);
 while(elapsed()<duration && report.operations<40000){
  stop.signal.throwIfAborted();const cycleStart=performance.now();
  const digest=await productDigest();assert.equal(digest.sha256,report.source_start.sha256,'実行中に製品ソースが変更されたため固定ソース検査を停止');
  const originalRecord=records[report.cycles%records.length];
  const record=catalog.records.filter(r=>r.qualifiedName===originalRecord.qualifiedName).sort((a,b)=>b.precedence-a.precedence)[0];assert(record);
  const preview={variables:buildRepresentativeClassicResolverVariables({qualifiedName:record.qualifiedName}),representativeCollections:buildRepresentativeClassicCollections({qualifiedName:record.qualifiedName})};
  const project=await step('PROJECT',()=>client.request('/api/node/project',{payload:{catalogId:catalog.nodeCatalogId,recordId:record.id,...preview},timeout:60000}),v=>({ok:v.ok,definition:record.qualifiedName,nodes:Object.keys(v.nodeSources||{}).length,diagnostics:v.diagnostics?.length}));
  if(!project.ok){report.domain_blocked.push({cycle:report.cycles,definition:record.qualifiedName,code:project.code,diagnostics:project.diagnostics});}
  else {
   const frameRequest={projectionId:project.nodeProjectionId,filePath:record.filePath,preset:{width:480,height:270},animationTime:1,generation:report.cycles+1,visibilityMode:'safe'};
   const first=await step('FRAME_COLD',()=>client.request('/api/node/frame',{payload:frameRequest,timeout:60000}),v=>({boxes:v.layout?.boxes?.length,truncated:v.layout?.stats?.truncated,cache_hit:v.metrics?.cacheHit}));
   assert(first.layout?.boxes?.length>0);assert.notEqual(first.layout.stats?.truncated,true);
   const warm=await step('FRAME_WARM',()=>client.request('/api/node/frame',{payload:frameRequest,timeout:60000}),v=>({boxes:v.layout?.boxes?.length,cache_hit:v.metrics?.cacheHit}));
   assert.deepEqual(warm.layout,first.layout,'同条件の再描画で配置が変化');
   if(record.qualifiedName==='anvil.anvil_screen'){
    const found=Object.entries(project.nodeSources).find(([,s])=>s.path==='ui/ui_common.json'&&s.pointer.includes('/close_button_panel/controls/0/close_button_image@'));assert(found);
    const [effectivePointer,source]=found;const originalRevision=workspace.revision;
    const operation={type:'move',scope:Math.floor(report.cycles/records.length)%2?'shared':'screen',targetMode:'interaction',delta:[1,1],path:source.path,sourceId:source.sourceId,pointer:source.pointer,effectivePointer,
     screen:{path:record.filePath,sourceId:record.sourceId,pointer:'/'+record.rawKey.replaceAll('~','~0').replaceAll('/','~1')},preview};
    workspace=await step('SCOPED_MOVE',()=>client.request('/api/node/workspace-edit',{payload:{workspaceId:workspace.workspaceId,expectedRevision:workspace.revision,operation},timeout:60000}),v=>({ok:v.ok,code:v.code,revision:v.revision,clones:v.editPlan?.clonedDefinitions?.length}));assert(workspace.ok,workspace.code);assert.notEqual(workspace.revision,originalRevision);
    workspace=await step('UNDO',()=>client.request('/api/node/workspace-undo',{payload:{workspaceId:workspace.workspaceId,expectedRevision:workspace.revision},timeout:60000}));assert(workspace.ok);assert.equal(workspace.revision,originalRevision);
    catalog=await step('CATALOG_AFTER_UNDO',()=>client.request('/api/node/workspace-catalog',{payload:{workspaceId:workspace.workspaceId},timeout:60000}),v=>({records:v.records.length}));
   }
  }
  report.cycles++;report.definitions[record.qualifiedName]=(report.definitions[record.qualifiedName]||0)+1;
  const metrics=snapshot();assert.equal(metrics.worker.dead,false);assert.equal(metrics.worker.pending,0);
  if(metrics.frame?.frame_cache)assert(metrics.frame.frame_cache.bytes<=metrics.frame.frame_cache.max_bytes,'frame cache容量超過');
  await emit({event:'CYCLE_END',cycle:report.cycles,definition:record.qualifiedName,status:project.ok?'PASS':'DOMAIN_BLOCKED',metrics});await checkpoint();
  active='CADENCE';const remaining=Math.max(0,cadence*1000-(performance.now()-cycleStart));if(remaining)await pause(remaining,undefined,{signal:stop.signal});
 }
 report.source_end=await productDigest();assert.equal(report.source_end.sha256,report.source_start.sha256);
 assert(elapsed()>=duration,'設定時間に達する前に操作上限へ到達');report.status=report.domain_blocked.length?'WARN':'PASS';
}catch(error){report.status='FAIL';report.failures.push({at:now(),operation:active,code:error.code||error.name,message:error.message,stack:error.stack});await emit({event:'FAIL',error:report.failures.at(-1)});process.exitCode=1;}
finally{
 clearInterval(guard);active='CLOSE';if(client)await client.close();
 const exists=rootPath?!!await stat(rootPath).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)):false;
 let responding=false;if(base)try{await fetch(new URL('/api/node/capabilities',base),{signal:AbortSignal.timeout(1000)});responding=true;}catch{}
 report.cleanup={spool_exists:exists,server_responding:responding};if(exists||responding){report.status='FAIL';process.exitCode=1;}
 report.finished_at=now();report.elapsed_seconds=elapsed();await events.sync();await events.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cycles:report.cycles,operations:report.operations,elapsed_seconds:report.elapsed_seconds,cleanup:report.cleanup}));
}
