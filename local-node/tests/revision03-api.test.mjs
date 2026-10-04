import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalServer } from '../server.mjs';
import { resourceFixture } from './fixtures.mjs';
import { Processor } from '../worker-client.mjs';

test('v03 Node API: repeated composition cache・state分離・診断export・worker失敗時の採取',async t=>{
  const app=await createLocalServer({port:0});t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.port}/api/node/`,cap=await(await fetch(base+'capabilities')).json();
  const headers={'X-JSONUI-Token':cap.token,'Content-Type':'application/json'};
  const post=(route,value)=>fetch(base+route,{method:'POST',headers,body:JSON.stringify(value)});
  const request={schema:'jsonui-debug-request-v1',browser:{userAgent:'Node HTTP integration test'},selection:{filePath:'ui/example.json',definitionKey:'screen'},state:{progress:0.5},diagnostics:[],events:[]};
  await t.test('unauthenticated debug export拒否',async()=>assert.equal((await fetch(base+'debug-bundle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)})).status,401));
  await t.test('invalid debug schemaとsize制限',async()=>{
    assert.equal((await post('debug-bundle',{...request,files:[]})).status,400);
    assert.equal((await post('debug-bundle',{...request,state:{large:'a'.repeat(1024*1024)}})).status,413);
  });
  const id=randomUUID();const uploaded=await fetch(base+'packs',{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-JSONUI-Upload-ID':id,'X-JSONUI-Name':encodeURIComponent('テスト.zip')},body:resourceFixture()});
  assert.equal(uploaded.status,200);await uploaded.arrayBuffer();
  const sources=[{id,kind:'imported'}],catalog=await(await post('catalog',{sources})).json();
  await t.test('同一source catalogはIDを保持し再構築なし',async()=>{
    const again=await(await post('catalog',{sources})).json();assert.equal(again.nodeCatalogId,catalog.nodeCatalogId);assert.equal(app.processor.snapshot().caches.catalog.hits,1);
  });
  const record=catalog.records.find(r=>r.localName==='screen'),project={catalogId:catalog.nodeCatalogId,recordId:record.id,variables:{$a:1,$b:2}};
  const first=await(await post('project',project)).text();
  await t.test('projection同一内容はserialized結果そのまま再利用',async()=>{
    const again=await(await post('project',{...project,variables:{$b:2,$a:1}})).text();assert.equal(again,first);assert.equal(app.processor.snapshot().caches.projection_cache.hits,1);
  });
  await t.test('stateとcollectionの異なる要求は別cache',async()=>{
    await(await post('project',{...project,variables:{$a:2},representativeCollections:{sample:[{text:'x'}]}})).arrayBuffer();
    assert.equal(app.processor.snapshot().caches.projection_cache.misses,2);
  });
  await t.test('download attachmentへ選択・runtime・metadata・servereventをまとめ機密除去',async()=>{
    const response=await post('debug-bundle',{...request,state:{progress:0.7,token:cap.token,note:cap.token,rawText:'PRIVATE_CONTENTS',file:'C:\\Users\\private\\foo'}});
    assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/u);
    const text=await response.text(),bundle=JSON.parse(text);assert(!text.includes(cap.token));assert(!text.includes('PRIVATE_CONTENTS'));assert(!text.includes('C:\\'));
    assert.equal(bundle.schema,'jsonui-debug-bundle-v1');assert.equal(bundle.client.data.selection.definitionKey,'screen');assert.equal(bundle.client.data.state.progress,0.7);
    assert.equal(bundle.server.packs[0].name,'テスト.zip');assert.equal(typeof bundle.server.packs[0].entry_count,'number');
    assert(bundle.server.journal.events.some(e=>e.event==='NODE_DEBUG_BUNDLE_EXPORTED'));assert.equal(bundle.server.processor.caches.projection_cache.hits,1);
  });
  await t.test('catalog source override変更で旧catalogとprojectionを失効',async()=>{
    const next=await(await post('catalog',{sources:[{id,kind:'imported',overrides:{'ui/add.json':'{"namespace":"new","screen":{"type":"screen"}}'}}]})).json();
    assert.notEqual(next.nodeCatalogId,catalog.nodeCatalogId);assert.equal((await post('project',project)).status,409);
    assert.equal(app.processor.snapshot().caches.projection_cache.entries,0);
  });
  await t.test('worker停止時でも診断exportで停止とpack概要を保存',async()=>{
    await app.processor.close();const response=await post('debug-bundle',request);assert.equal(response.status,200);
    const bundle=await response.json();assert.equal(bundle.server.processor.dead,true);assert.equal(bundle.server.packs.length,1);
  });
});

test('cancelled queueはworkerへ送信せず、queue/work統計を記録',async t=>{
  const processor=new Processor();t.after(()=>processor.close());
  let release;processor.tail=new Promise(resolve=>{release=resolve;});const controller=new AbortController();
  const job=processor.call('remove',{id:randomUUID()},10000,{signal:controller.signal,correlationId:'request-fixture'});
  assert.equal(processor.snapshot().active_jobs[0].state,'queued');assert.equal(processor.snapshot().active_jobs[0].correlation_id,'request-fixture');
  controller.abort();release();
  await assert.rejects(job,/NODE_JOB_CANCELLED/);assert.equal(processor.sequence,0);assert.equal(processor.snapshot().cancelled_queued,1);assert.equal(processor.pending,0);assert.equal(processor.snapshot().active_jobs.length,0);
});

test('Worker queue上限8件を超える9件目を拒否し全取消し後に復帰',async t=>{
  const processor=new Processor();t.after(()=>processor.close());let release;processor.tail=new Promise(resolve=>{release=resolve;});
  const controllers=Array.from({length:8},()=>new AbortController());
  const jobs=controllers.map(controller=>processor.call('remove',{id:randomUUID()},10000,{signal:controller.signal}));
  assert.equal(processor.snapshot().active_jobs.length,8);await assert.rejects(processor.call('remove',{}),/NODE_QUEUE_FULL/);
  controllers.forEach(controller=>controller.abort());release();const results=await Promise.allSettled(jobs);assert(results.every(result=>result.status==='rejected'));
  assert.equal(processor.pending,0);await processor.call('remove',{id:randomUUID()});assert.equal(processor.snapshot().completed,1);
});
