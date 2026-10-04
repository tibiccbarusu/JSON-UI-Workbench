import { createLocalServer } from './server.mjs';
import { openAsBlob } from 'node:fs';
import { writeFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw new Error('usage: node local-node/benchmark.mjs input.zip output.json');
const report={run_id:`benchmark-${randomUUID()}`,started_at:new Date().toISOString(),node:process.version,input_bytes:(await stat(input)).size,checks:[],rss_before:process.memoryUsage().rss};
const app=await createLocalServer({port:0});const base=`http://127.0.0.1:${app.port}/api/node/`;
const cap=await(await fetch(base+'capabilities')).json(),headers={'X-JSONUI-Token':cap.token};
async function post(route,data){const r=await fetch(base+route,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(150000)});const b=await r.json();if(!r.ok)throw new Error(JSON.stringify(b));return b;}
try {
  let start=performance.now();const id=randomUUID();const blob=await openAsBlob(input);
  const response=await fetch(base+'packs',{method:'POST',headers:{...headers,'X-JSONUI-Upload-ID':id},body:blob,signal:AbortSignal.timeout(150000)});
  const metadata=await response.json();if(!response.ok)throw new Error(JSON.stringify(metadata));
  report.checks.push({name:'stream-upload-index',status:'PASS',duration_ms:Math.round(performance.now()-start),meta:metadata.zipMeta,entries:metadata.entries.length});
  for(const sheet of ['default8','glyph_30','glyph_E0']){
    start=performance.now();const result=await post('font',{sources:[{id,kind:'vanilla'}],locale:'ja_JP',sheet});
    report.checks.push({name:'pack-font-'+sheet,status:result.metrics?.glyphs?.length===256?'PASS':'FAIL',duration_ms:Math.round(performance.now()-start),metrics_profile:result.metrics?.metricsProfile,provenance:result.provenance});
  }
  start=performance.now();const horse=await post('horse',{sources:[{id,kind:'vanilla'}],targetEngineVersion:[1,26,45]});
  report.checks.push({name:'pack-horse-model',status:horse.status==='ready'?'PASS':'FAIL',duration_ms:Math.round(performance.now()-start),result:horse});
  start=performance.now();const catalog=await post('catalog',{sources:[{id,kind:'imported'}]});
  report.checks.push({name:'node-catalog',status:'PASS',duration_ms:Math.round(performance.now()-start),summary:catalog.summary,wire_bytes:Buffer.byteLength(JSON.stringify(catalog)),incomplete:catalog.records.filter(x=>x.referenceScanComplete===false).length});
  for(const qualifiedName of ['beacon.beacon_screen','enchanting.enchanting_screen','horse.horse_screen','loom.loom_screen','trade2.trade_screen','chat.chat_screen','book.book_screen']){
    const record=catalog.records.find(x=>x.qualifiedName===qualifiedName);start=performance.now();
    if(!record){report.checks.push({name:qualifiedName,status:'FAIL',error:'MISSING_RECORD'});continue;}
    const projection=await post('project',{catalogId:catalog.nodeCatalogId,recordId:record.id,variables:buildRepresentativeClassicResolverVariables({qualifiedName}),representativeCollections:buildRepresentativeClassicCollections({qualifiedName})});
    report.checks.push({name:qualifiedName,status:projection.ok?'PASS':'FAIL',duration_ms:Math.round(performance.now()-start),stats:projection.stats,diagnostics:projection.diagnostics?.map(x=>({code:x.code,severity:x.severity})),error:projection.error||null});
    console.log(JSON.stringify(report.checks.at(-1)));
  }
  report.status=report.checks.every(c=>c.status==='PASS')?'PASS_WITH_RECORDED_LIMITATIONS':'FAIL';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{report.finished_at=new Date().toISOString();report.rss_after=process.memoryUsage().rss;await app.close();await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,output,rss:report.rss_after}));}
