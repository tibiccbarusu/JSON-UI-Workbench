/** 大容量ZIPの遅延読込とストリーム取込を実測。合成データを実バニラと呼ばない。 */
import assert from 'node:assert/strict';
import { stat,writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { ResourceZipReader } from './resource-zip.mjs';
import { CliClient } from './cli-client.mjs';
const [input,output]=process.argv.slice(2);if(!input||!output)throw new Error('input.zip output.json');
const report={schema:'jsonui-large28-verification-v1',started_at:new Date().toISOString(),node:process.version,platform:process.platform,checks:[],limitation:'448MiB STORE合成入力。実バニラの機能網羅・ピークメモリ上限の保証ではない。'};
let client,reader;const initial=process.memoryUsage(),started=performance.now();
try{
 const info=await stat(input);assert(info.size>448*1024*1024);report.input={name:path.basename(input),bytes:info.size};
 reader=new ResourceZipReader();await reader.openFromFile({diskPath:input,name:path.basename(input)});const index=await reader.listEntries();assert.equal(reader.entryIndex.size,11200);
 for(const file of ['manifest.json','ui/_ui_defs.json','ui/main.json'])JSON.parse((await reader.bytes(file)).toString('utf8'));
 report.lazy={duration_ms:performance.now()-started,index_entries:reader.entryIndex.size,meta:index.meta,io:reader.reader.snapshot(),memory:process.memoryUsage()};
 assert(report.lazy.io.physical_bytes<info.size/8,'索引と小JSONの読込にZIP全体を展開・読込しない');
 assert(report.lazy.io.cache_bytes<=256*1024);report.checks.push({name:'11,200エントリの索引・小JSONの遅延取得',status:'PASS'});await reader.close();reader=null;
 client=await CliClient.start();const importStart=performance.now(),pack=await client.importPack(input);
 report.import={duration_ms:performance.now()-importStart,sha256:pack.sha256,metadata:pack.meta,memory:process.memoryUsage()};
 const workspace=await client.request('/api/node/workspace-open',{payload:{sources:[{kind:'imported',id:pack.id}]}});assert(workspace.ok);
 const catalog=await client.request('/api/node/workspace-catalog',{payload:{workspaceId:workspace.workspaceId}});const record=catalog.records.find(r=>r.qualifiedName==='large28.screen');assert(record);
 const projected=await client.request('/api/node/project',{payload:{catalogId:catalog.nodeCatalogId,recordId:record.id}});assert(projected.ok);
 const frame=await client.request('/api/node/frame',{payload:{projectionId:projected.nodeProjectionId,filePath:record.filePath,generation:0,preset:{width:480,height:270}}});assert(frame.ok!==false);assert(frame.layout.boxes.length>=2);
 report.checks.push({name:'ストリームHTTP取込→workspace→カタログ→投影→フレーム',status:'PASS',boxes:frame.layout.boxes.length});
 const bundle=await client.request('/api/node/debug-bundle',{payload:{schema:'jsonui-debug-request-v1',state:{surface:'large28'},diagnostics:[],events:[]}});
 report.processing=bundle.server?.processor?.caches;report.status='PASS';
}catch(error){report.status='FAIL';report.error={code:error.code,message:error.message,stack:error.stack};process.exitCode=1;}
finally{await reader?.close();await client?.close();report.initial_memory=initial;report.final_memory=process.memoryUsage();report.resource_usage=process.resourceUsage();report.duration_ms=performance.now()-started;report.finished_at=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({status:report.status,input:report.input,checks:report.checks,error:report.error}));}
