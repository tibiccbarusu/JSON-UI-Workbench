// 実取得した2層をHTTP経由で検証する。成功は画素一致を意味しない。
import { createLocalServer } from './server.mjs';
import { openAsBlob } from 'node:fs';
import { writeFile, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolveTextureRef } from '../editor-core/src/assets/asset-indexer.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
const [lower, upper, output] = process.argv.slice(2);
if (!lower || !upper || !output) throw Error('usage: node local-node/verify-two-layer.mjs lower.zip upper.zip output.json');
const report = { run_id:'resume-20260905t175130z', started_at:new Date().toISOString(), node:process.version, checks:[] };
const app = await createLocalServer({ port:0 });
const base = `http://127.0.0.1:${app.port}/api/node/`;
const cap = await (await fetch(base+'capabilities')).json();
const headers = { 'X-JSONUI-Token':cap.token };
async function json(route, data) {
  const r = await fetch(base+route, data === undefined ? {headers,signal:AbortSignal.timeout(120000)} : {method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(120000)});
  const b=await r.json();if(!r.ok)throw Error(JSON.stringify(b));return b;
}
try {
  const sources=[];const info={};const indexes={};
  for(const [kind,path] of [['vanilla',lower],['imported',upper]]) {
    const id=randomUUID();const r=await fetch(base+'packs',{method:'POST',headers:{...headers,'X-JSONUI-Upload-ID':id},body:await openAsBlob(path),signal:AbortSignal.timeout(150000)});
    const metadata=await r.json();if(!r.ok)throw Error(JSON.stringify(metadata));
    info[kind]=metadata;sources.push({id,kind});
    const wire=await json(`packs/${id}/assets`);indexes[kind]=Object.fromEntries(Object.entries(wire).map(([k,v])=>[k,{...v,byLower:new Map(v.byLower)}]));
    report.checks.push({name:'upload-'+kind,status:'PASS',input_bytes:(await stat(path)).size,entries:metadata.entries.length});
  }
  for (const mode of ['lower-only','two-layer']) {
    const result=resolveTextureRef('textures/ui/White',{vanillaIndex:indexes.vanilla,importedIndex:mode==='two-layer'?indexes.imported:null});
    if(!result.resolved||result.collision)throw Error('WHITE_UNRESOLVED_OR_AMBIGUOUS');
    const source=sources.find(s=>s.kind===result.resolved.source);
    const r=await fetch(base+`packs/${source.id}/read?path=${encodeURIComponent(info[source.kind].rootPrefix+result.resolved.packPath)}&maxBytes=1048576`,{headers,signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Error('WHITE_READ_FAILED');const bytes=Buffer.from(await r.arrayBuffer());
    report.checks.push({name:'white-'+mode,status:'PASS',result,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),note:'case-foldと層優先の現実装を記録。実機case感度は未判定。'});
  }
  const catalog=await json('catalog',{sources});
  report.checks.push({name:'catalog-two-layer',status:'PASS',summary:catalog.summary,incomplete:catalog.records.filter(r=>r.referenceScanComplete===false).length});
  for(const qualifiedName of ['chat.chat_screen','book.book_screen']) {
    const r=catalog.records.find(r=>r.qualifiedName===qualifiedName);if(!r)throw Error('RECORD_MISSING');
    const result=await json('project',{catalogId:catalog.nodeCatalogId,recordId:r.id,variables:buildRepresentativeClassicResolverVariables({qualifiedName}),representativeCollections:buildRepresentativeClassicCollections({qualifiedName})});
    report.checks.push({name:qualifiedName,status:result.ok?'PASS':'FAIL',stats:result.stats,diagnostics:result.diagnostics,error:result.error??null});
  }
  report.status=report.checks.every(r=>r.status==='PASS')?'PASS_WITH_RECORDED_LIMITATIONS':'FAIL';
} catch(error) {report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally {await app.close();report.ended_at=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,output}));}
