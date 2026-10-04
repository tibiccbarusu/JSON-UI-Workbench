import { createLocalServer } from './server.mjs';
import { openAsBlob } from 'node:fs';
import { stat, writeFile, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';

const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw new Error('usage: node local-node/benchmark-revision03.mjs input.zip output.json');
const sourcePaths=['server.mjs','processor.mjs','worker-client.mjs','debug-bundle.mjs','response-cache.mjs','font-coverage.mjs','../editor-core/src/engine/effective-ui-resolver.js','../editor-core/src/engine/ui-catalog.js','../editor-core/src/engine/preview-animation.js'];
async function sourceHashes(){return Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(new URL(path,import.meta.url))).digest('hex')])));}
const report={schema:'jsonui-node-revision03-benchmark-v1',started_at:new Date().toISOString(),node:process.version,platform:process.platform,input_bytes:(await stat(input)).size,checks:[],rss_before:process.memoryUsage().rss,limits:'HTTP/Node検証。ブラウザDOM操作とWindows実機性能は未検証。'};
report.source_sha256_before=await sourceHashes();
const app=await createLocalServer({port:0});const base=`http://127.0.0.1:${app.port}/api/node/`;
let headers = {};
const pulse=[];let pulseBusy=false;
const timer=setInterval(async()=>{if(pulseBusy)return;pulseBusy=true;const start=performance.now();try{const response=await fetch(base+'capabilities',{signal:AbortSignal.timeout(5000)});await response.arrayBuffer();pulse.push({ms:performance.now()-start,status:response.status});}catch{pulse.push({ms:performance.now()-start,status:0});}finally{pulseBusy=false;}},100);
async function post(route,data){const start=performance.now();const r=await fetch(base+route,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(150000)});const text=await r.text();if(!r.ok)throw new Error(text);return{value:JSON.parse(text),duration_ms:Math.round(performance.now()-start),wire_bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')};}
try{
  const capabilityResponse=await fetch(base+'capabilities',{signal:AbortSignal.timeout(5000)});
  if(!capabilityResponse.ok)throw new Error('CAPABILITIES_HTTP_'+capabilityResponse.status);
  const cap=await capabilityResponse.json();
  if(typeof cap.token !== 'string' || !cap.token)throw new Error('CAPABILITIES_TOKEN_INVALID');
  headers={'X-JSONUI-Token':cap.token};
  const id=randomUUID(),start=performance.now();const upload=await fetch(base+'packs',{method:'POST',headers:{...headers,'X-JSONUI-Upload-ID':id,'X-JSONUI-Name':'recovered-v26.45.zip'},body:await openAsBlob(input),signal:AbortSignal.timeout(150000)});
  const metadata=await upload.json();if(!upload.ok)throw new Error(JSON.stringify(metadata));
  report.checks.push({name:'large-pack-upload',status:'PASS',duration_ms:Math.round(performance.now()-start),entries:metadata.entries.length,meta:metadata.zipMeta});
  const sources=[{id,kind:'vanilla'}],catalog=await post('catalog',{sources}),warmCatalog=await post('catalog',{sources});
  report.checks.push({name:'catalog-cold-warm',status:catalog.sha256===warmCatalog.sha256?'PASS':'FAIL',cold_ms:catalog.duration_ms,warm_ms:warmCatalog.duration_ms,wire_bytes:catalog.wire_bytes,byte_identical:catalog.sha256===warmCatalog.sha256,records:catalog.value.records.length});
  for(const qualifiedName of ['beacon.beacon_screen','horse.horse_screen','furnace.furnace_screen','trade2.trade_screen']){
    const record=catalog.value.records.find(x=>x.qualifiedName===qualifiedName);if(!record){report.checks.push({name:qualifiedName,status:'FAIL',reason:'RECORD_MISSING'});continue;}
    const data={catalogId:catalog.value.nodeCatalogId,recordId:record.id,variables:buildRepresentativeClassicResolverVariables({qualifiedName}),representativeCollections:buildRepresentativeClassicCollections({qualifiedName})};
    const cold=await post('project',data),warm=await post('project',data);
    const check={name:qualifiedName,status:cold.value.ok&&cold.sha256===warm.sha256?'PASS':'FAIL',cold_ms:cold.duration_ms,warm_ms:warm.duration_ms,wire_bytes:cold.wire_bytes,byte_identical:cold.sha256===warm.sha256,animations:Object.keys(cold.value.animationDefinitions?.definitions||{}).length};
    report.checks.push(check);console.log(JSON.stringify(check));
  }
  const bundle=await post('debug-bundle',{schema:'jsonui-debug-request-v1',selection:{definitionKey:'trade2.trade_screen'},state:{},diagnostics:[],events:[]});
  report.checks.push({name:'debug-bundle-with-loaded-large-pack',status:bundle.value.server.packs.length===1?'PASS':'FAIL',duration_ms:bundle.duration_ms,wire_bytes:bundle.wire_bytes,worker:bundle.value.server.processor});
  report.status=report.checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
  if(report.status!=='PASS')process.exitCode=1;
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{clearInterval(timer);report.finished_at=new Date().toISOString();report.rss_after=process.memoryUsage().rss;report.source_sha256_after=await sourceHashes();report.source_unchanged=JSON.stringify(report.source_sha256_before)===JSON.stringify(report.source_sha256_after);if(!report.source_unchanged){report.status='INCONCLUSIVE';report.reason='測定中に対象ソースが変更されたため版固定の性能値とは扱えない';}const durations=pulse.map(p=>p.ms).sort((a,b)=>a-b);report.http_responsiveness={samples:pulse.length,failed:pulse.filter(p=>p.status!==200).length,p50_ms:durations[Math.floor(durations.length*.5)]??null,p95_ms:durations[Math.floor(durations.length*.95)]??null,max_ms:durations.at(-1)??null};await app.close();await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,output,rss:report.rss_after,http_responsiveness:report.http_responsiveness,source_unchanged:report.source_unchanged}));}
