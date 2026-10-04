import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createLocalServer } from '../server.mjs';
import { makeZip } from './fixtures.mjs';

test('実minecraft-ten.ttf coverageをNodeWorker APIで解析し不足文字を推測で埋めない',{
  skip:!process.env.JSONUI_REAL_TTF,timeout:30000,
},async t=>{
  const font=await readFile(process.env.JSONUI_REAL_TTF);assert.equal(createHash('sha256').update(font).digest('hex'),'fc34c190dbfae5fe2f27adb45a93425f502388191854a6a0c2ac2f7c594a688f');
  const app=await createLocalServer({port:0});t.after(()=>app.close());const base=`http://127.0.0.1:${app.port}/api/node/`;
  const cap=await(await fetch(base+'capabilities')).json(),headers={'X-JSONUI-Token':cap.token,'Content-Type':'application/json'};
  const id=randomUUID(),upload=await fetch(base+'packs',{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-JSONUI-Upload-ID':id},body:makeZip({'font/minecraft-ten.ttf':font,'font/broken.ttf':'broken sfnt','font/unsupported.woff':'wOFF00000000','manifest.json':'{"format_version":2,"header":{"name":"coverage test","description":"","uuid":"3b6198c3-a3ea-4fdd-bc3a-4a4b87930df2","version":[1,0,0],"min_engine_version":[1,20,0]},"modules":[{"type":"resources","uuid":"67381a3d-aa00-4f58-b89a-c0da830c55f4","version":[1,0,0]}]}'})});
  assert.equal(upload.status,200);await upload.arrayBuffer();
  const source={id,kind:'vanilla'},post=data=>fetch(base+'font-coverage',{method:'POST',headers,body:JSON.stringify(data)});
  const response=await post({source,path:'font/minecraft-ten.ttf'});assert.equal(response.status,200);const coverage=await response.json();
  assert.equal(coverage.supported,true);assert.equal(coverage.processing,'node-worker');assert.equal(coverage.sha256,createHash('sha256').update(font).digest('hex'));
  const supports=cp=>coverage.coverageRanges.some(([first,last])=>first<=cp&&cp<=last);
  assert(supports(65),'実フォントのLatin A');assert(!supports(0x3042),'日本語あを実フォントcoverageに偽装しない');
  const again=await(await post({source,path:'FONT/MINECRAFT-TEN.TTF'})).json();assert.deepEqual(again,coverage);assert.equal(app.processor.snapshot().caches.response_cache.hits,1);
  const imported=await(await post({source:{id,kind:'imported'},path:'font/minecraft-ten.ttf'})).json();assert.equal(imported.provenance.source,'imported');assert.deepEqual(imported.coverageRanges,coverage.coverageRanges);
  for(const data of [{source,path:'../secret.ttf'},{source:{id,kind:'invalid'},path:'font/minecraft-ten.ttf'},{source,path:'font/broken.ttf'},{source,path:'font/x.png'}])assert((await post(data)).status>=400);
  const unsupported=await post({source,path:'font/unsupported.woff'});assert.equal(unsupported.status,200);assert.equal((await unsupported.json()).supported,false);
  t.diagnostic(JSON.stringify({font_sha256:coverage.sha256,codepoint_count:coverage.codepointCount,ranges:coverage.coverageRanges.length,profile:coverage.profile,latin_a:true,hiragana_a:false}));
});
