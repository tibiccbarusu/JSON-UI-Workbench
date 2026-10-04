import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeReadQueue } from '../../editor-core/src/pack-io/node-read-queue.js';
import { inspectVanillaReferenceCounts } from '../../editor-core/src/vanilla/vanilla-reference-inspection.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const bytes=value=>new TextEncoder().encode(value).buffer;
test('本文完了まで枠を保持しFIFOで次を開始する',async()=>{
 const q=createNodeReadQueue({concurrency:2,maxPending:2}),g=Array.from({length:4},deferred),seen=[];
 const runs=g.map((gate,i)=>q.run(async()=>{seen.push(i);return gate.promise;}));
 await tick();assert.deepEqual(seen,[0,1]);assert.equal(q.snapshot().pending,2);
 g[1].resolve(1);await tick();assert.deepEqual(seen,[0,1,2]);
 g[0].resolve(0);g[2].resolve(2);await tick();assert.deepEqual(seen,[0,1,2,3]);g[3].resolve(3);
 assert.deepEqual(await Promise.all(runs),[0,1,2,3]);await tick();assert.equal(q.snapshot().active,0);
});
test('待機取消は実行せず除去し満杯は有限失敗、その後も進行する',async()=>{
 const q=createNodeReadQueue({concurrency:1,maxPending:1}),g=deferred(),a=new AbortController();let ran=false;
 const first=q.run(()=>g.promise),cancelled=q.run(()=>{ran=true;},{signal:a.signal}),check=assert.rejects(cancelled,/CANCELLED/);
 await assert.rejects(q.run(()=>0),/NODE_READ_QUEUE_LIMIT/);a.abort(new Error('CANCELLED'));await check;
 assert.equal(q.snapshot().pending,0);g.resolve(1);assert.equal(await first,1);await tick();assert.equal(ran,false);assert.equal(await q.run(()=>2),2);
});
test('同期例外・非同期失敗・実行中取消で枠を漏らさない',async()=>{
 const q=createNodeReadQueue({concurrency:1}),g=deferred(),a=new AbortController();
 await assert.rejects(q.run(()=>{throw new Error('SYNC');}),/SYNC/);await assert.rejects(q.run(async()=>{throw new Error('ASYNC');}),/ASYNC/);
 const pending=q.run(()=>g.promise,{signal:a.signal}),check=assert.rejects(pending,/CANCELLED/);
 await tick();a.abort(new Error('CANCELLED'));g.resolve('late');await check;assert.equal(await q.run(()=>3),3);
 await tick();assert.equal(q.snapshot().active,0);
});
async function adapter(t,handler){
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;globalThis.window={addEventListener(){}};
 globalThis.fetch=async(url,options={})=>{
  if(String(url).endsWith('/capabilities'))return new Response(JSON.stringify({protocol:'jsonui-node/v1',token:'test'}),{headers:{'content-type':'application/json'}});
  if(options.method==='DELETE')return new Response('{"ok":true}',{headers:{'content-type':'application/json'}});
  return handler(String(url),options);
 };
 t.after(()=>{globalThis.fetch=originalFetch;if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;});
 const {NodeRemoteReader}=await import(`../../editor-core/src/pack-io/node-remote-client.js?test=${crypto.randomUUID()}`);
 return id=>new NodeRemoteReader({id,zipMeta:{fileName:'fixture.zip'},entries:['a.txt','b.tga'].map(path=>({path,uncompressedSize:3}))});
}
test('2パックの通常/TGA計8要求も最大4通信、本文まで待機',async t=>{
 let active=0,peak=0,calls=0;const gates=[];
 const reader=await adapter(t,async()=>{calls++;active++;peak=Math.max(peak,active);const g=deferred();gates.push(g);return {ok:true,arrayBuffer:async()=>{await g.promise;active--;return bytes('ok');}};});
 const a=reader('a'),b=reader('b'),tasks=Array.from({length:8},(_,i)=>i%2?a.readText('a.txt'):b.readPreviewImageBlob('b.tga'));
 await tick();assert.equal(calls,4);gates.slice().forEach(g=>g.resolve());await tick();assert.equal(calls,8);
 gates.forEach(g=>g.resolve());const values=await Promise.all(tasks);assert.equal(peak,4);assert.equal(values[1],'ok');assert.equal(values[0].type,'image/png');await a.close();await b.close();
});
test('closeで自分の待機/実行中を取消し遅い本文を捨て他パックは継続',async t=>{
 const g=deferred();let calls=0;const reader=await adapter(t,async()=>{calls++;return {ok:true,arrayBuffer:async()=>{await g.promise;return bytes('late');}};});
 const a=reader('a'),b=reader('b'),tasks=Array.from({length:6},()=>a.readText('a.txt')),all=Promise.allSettled(tasks);
 await tick();assert.equal(calls,4);await a.close();g.resolve();const results=await all;assert.equal(calls,4);
 assert.ok(results.every(x=>x.status==='rejected'&&x.reason.message==='ZIP_CLOSED'));
 assert.equal(await b.readText('a.txt'),'late');await assert.rejects(a.readText('a.txt'),/ZIP_CLOSED/);await b.close();
});
test('事前abortは送信0、本文途中のabortは遅い応答を返さない',async t=>{
 const g=deferred();let calls=0;const reader=await adapter(t,async()=>{calls++;return {ok:true,arrayBuffer:()=>g.promise};}),a=reader('a');
 const stop=new AbortController();stop.abort(new Error('STOP'));await assert.rejects(a.readText('a.txt',{signal:stop.signal}),/STOP/);assert.equal(calls,0);
 const current=new AbortController(),pending=a.readText('a.txt',{signal:current.signal}),check=assert.rejects(pending,/STOP/);
 await tick();current.abort(new Error('STOP'));g.resolve(bytes('late'));await check;await a.close();
});
test('NODE_READ_BUSYは最大2回再試行して回復',async t=>{
 let calls=0;const reader=await adapter(t,async()=>++calls<3?new Response('{"error":"NODE_READ_BUSY"}',{status:429}):new Response('ok'));
 const a=reader('a');assert.equal(await a.readText('a.txt'),'ok');assert.equal(calls,3);await a.close();
});
test('混雑が続けば計3回で停止し原因とrequest IDを保持',async t=>{
 let calls=0;const reader=await adapter(t,async()=>{calls++;return new Response('{"error":"NODE_READ_BUSY"}',{status:429,headers:{'x-jsonui-request-id':'known-request'}});});
 const a=reader('a');await assert.rejects(a.readText('a.txt'),e=>e.code==='NODE_READ_BUSY'&&e.status===429&&e.correlation_id==='known-request');assert.equal(calls,3);await a.close();
});
test('破損/別429/本文例外は再試行せず容量制限も保持',async t=>{
 let calls=0;const responses=[()=>new Response('{"error":"ZIP_CRC_MISMATCH"}',{status:400}),()=>new Response('{"error":"NODE_BUSY"}',{status:429}),()=>({ok:true,arrayBuffer:async()=>{throw new Error('BODY_BROKEN');}}),()=>new Response('ok')];
 const reader=await adapter(t,async()=>responses[calls++]()),a=reader('a');
 await assert.rejects(a.readBlob('a.txt',{maxBytes:2}),/ZIP_ENTRY_READ_LIMIT/);assert.equal(calls,0);
 await assert.rejects(a.readText('a.txt'),/ZIP_CRC_MISMATCH/);await assert.rejects(a.readText('a.txt'),/NODE_BUSY/);await assert.rejects(a.readText('a.txt'),/BODY_BROKEN/);
 assert.equal(await a.readText('a.txt'),'ok');assert.equal(calls,4);await a.close();
});
test('5文書へsignal/8MiB上限を伝達しrootPrefix/大小文字を保持',async()=>{
 const packPaths=['UI/_UI_DEFS.JSON','ui/_global_variables.json','ui/hud_screen.json','ui/ui_common.json','texts/en_US.lang'],texts=['{"ui_defs":["ui/a.json"]}','{"variables":{"$x":1}}','{"namespace":"hud"}','{"namespace":"common"}','## comment\nname=value\nother=x=y\n'];const signal=new AbortController().signal;let count=0;
 const result=await inspectVanillaReferenceCounts({packPaths,rootPrefix:'root/',zipReader:{readText:async(path,options)=>{count++;assert.equal(options.signal,signal);assert.equal(options.maxBytes,8*1024*1024);return texts[packPaths.indexOf(path.slice(5))];}}},{signal});
 assert.equal(count,5);assert.deepEqual(result,{uiDefsEntryCount:1,globalVariableCount:1,hudScreenParsed:true,uiCommonParsed:true,languageEntryCount:2});
});
test('読取例外/事前abortを保持し欠落/JSON不正と区別',async()=>{
 await assert.rejects(inspectVanillaReferenceCounts({packPaths:['ui/_ui_defs.json'],rootPrefix:'',zipReader:{readText:async()=>{throw new Error('READ_FAILURE');}}}),/READ_FAILURE/);
 const invalid=await inspectVanillaReferenceCounts({packPaths:['ui/_ui_defs.json'],rootPrefix:'',zipReader:{readText:async()=>'{bad'}});assert.equal(invalid.uiDefsEntryCount,null);assert.equal(invalid.hudScreenParsed,false);
 const aborted=new AbortController();aborted.abort(new Error('STOP'));await assert.rejects(inspectVanillaReferenceCounts({}, {signal:aborted.signal}),/STOP/);
});
