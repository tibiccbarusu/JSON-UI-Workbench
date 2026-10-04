/** 一時的な待ち時間超過でnine-sliceが永久に消えない。偽のstretch表示は許可しない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const {TextureMetadataCache}=await import(process.env.JSONUI_METADATA_REVIEW_MODULE || new URL('../../editor-core/src/assets/texture-metadata-cache.js',import.meta.url));
import {resolveTextureSidecarDrawState as drawState} from '../../editor-core/src/preview/texture-sidecar-contract.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const error=code=>Object.assign(new Error(code),{code});
const valid={status:'ready',value:{baseSize:[5,5],nineSlice:1,tiled:false}};

test('時間超過→errorを保持→期限後の需要1回で同じrecordを復旧し誤stretchしない',{timeout:1000},async t=>{
 let clock=1000,calls=0,late;let notify;const failed=new Promise(resolve=>notify=resolve);
 const cache=new TextureMetadataCache({timeoutMs:15,retryBaseMs:10,retryMaxMs:20,maxAutomaticRetries:0,now:()=>clock,onChange:notify});t.after(()=>cache.clear());
 const record=cache.request('frame',()=>++calls===1?new Promise(resolve=>late=resolve):valid);
 assert.equal(drawState({},record).state,'loading');await failed;
 assert.equal(record.code,'TEXTURE_SIDECAR_TIMEOUT');assert.equal(drawState({},record).state,'missing');
 for(let i=0;i<100;i++)assert.equal(cache.get('frame'),record);assert.equal(calls,1);
 clock+=20;assert.equal(cache.get('frame'),record);assert.equal(record.status,'loading');
 for(let i=0;i<100;i++)cache.get('frame');await tick();assert.equal(calls,2);
 assert.equal(record.status,'ready');assert.equal(record.code,undefined);assert.equal(drawState({},record).metadata.nineSlice,1);
 late({status:'ready',value:{nineSlice:999}});await tick();assert.equal(record.value.nineSlice,1);
 assert.equal(cache.snapshot({diagnostics:true}).recovered,1);
});

test('回復通知は有限で、表示外の素材を自動通信しない',{timeout:1000},async t=>{
 let calls=0,notifications=0;
 const cache=new TextureMetadataCache({retryBaseMs:15,retryMaxMs:30,onChange:()=>notifications++});t.after(()=>cache.clear());
 cache.request('offscreen',()=>{calls++;throw error('NODE_READ_BUSY');});await tick();await sleep(55);
 assert.equal(calls,1);assert.equal(notifications,2);assert.equal(cache.snapshot({diagnostics:true}).scheduledWakeups,0);
});

test('表示中の再試行通知は最大2回、以後は30秒設定相当の需要間隔を守る',{timeout:1000},async t=>{
 let calls=0,finished,rejectAttempts;const threeAttempts=new Promise((resolve,reject)=>{finished=resolve;rejectAttempts=reject;});
 // Production retry timers deliberately do not retain a Node process. This
 // observer test owns its wait and its failure deadline so Node22 must wait
 // for the real callbacks instead of cancelling the remaining file tests.
 const waitDeadline=setTimeout(()=>rejectAttempts(new Error('Automatic retry callbacks did not complete before the test deadline')),500);
 t.after(()=>clearTimeout(waitDeadline));
 const cache=new TextureMetadataCache({retryBaseMs:10,retryMaxMs:30,maxAutomaticRetries:2,
  onChange:key=>{cache.get(key);if(calls===3)finished();}});t.after(()=>cache.clear());
 cache.request('visible',()=>{calls++;throw error('NODE_READ_BUSY');});await threeAttempts;clearTimeout(waitDeadline);await sleep(45);
 assert.equal(calls,3);assert.equal(cache.snapshot({diagnostics:true}).automaticWakeups,2);assert.equal(cache.snapshot({diagnostics:true}).scheduledWakeups,0);
 cache.get('visible');await tick();assert.equal(calls,4);for(let i=0;i<50;i++)cache.get('visible');assert.equal(calls,4);
});

test('通信busy・queue満杯・fetch障害は回復対象、破損・曖昧性・上限は再試行しない',async t=>{
 for(const failure of [error('NODE_READ_BUSY'),new Error('NODE_READ_QUEUE_LIMIT'),Object.assign(new TypeError('Failed to fetch'),{name:'TypeError'}),error('TEXTURE_SIDECAR_JSON_INVALID'),error('RASTER_SIDECAR_AMBIGUOUS'),error('TEXTURE_SIDECAR_TEXT_LIMIT'),new TypeError('invalid internal value')]){
  let clock=0,calls=0;const cache=new TextureMetadataCache({now:()=>clock,retryBaseMs:10,retryMaxMs:10,maxAutomaticRetries:0});t.after(()=>cache.clear());
  cache.request('key',()=>{calls++;throw failure;});await tick();clock=100;
  const transient=['NODE_READ_BUSY','NODE_READ_QUEUE_LIMIT','Failed to fetch'].includes(failure.message);
  cache.request('key',()=>{calls++;return valid;});await tick();assert.equal(calls,transient?2:1,failure.message);
  assert.equal(cache.get('key').status,transient?'ready':'error');
 }
});

test('再試行中のclearは旧通信・回復通知を失効し新パック値を保持する',{timeout:1000},async t=>{
 let clock=0,oldRelease;const cache=new TextureMetadataCache({retryBaseMs:10,retryMaxMs:10,now:()=>clock,maxAutomaticRetries:0});t.after(()=>cache.clear());
 cache.request('frame',()=>{throw error('NODE_READ_BUSY');});await tick();clock=20;
 cache.request('frame',()=>new Promise(resolve=>oldRelease=resolve));await tick();cache.clear();
 cache.request('frame',()=>valid);await tick();oldRelease({status:'ready',value:{nineSlice:99}});await tick();
 assert.equal(cache.get('frame').value.nineSlice,1);assert.equal(cache.snapshot({diagnostics:true}).scheduledWakeups,0);
});

test('再試行待ちの退避とclearでtimerを残さず、容量・並列数を維持する',{timeout:1000},async t=>{
 let notifications=0;const cache=new TextureMetadataCache({maxEntries:1,concurrency:1,retryBaseMs:15,retryMaxMs:30,onChange:()=>notifications++});t.after(()=>cache.clear());
 cache.request('old',()=>{throw error('NODE_READ_BUSY');});await tick();cache.request('new',()=>valid);await tick();
 assert.equal(cache.retryTimer,null,'最後の再試行待ちを退避した時点でtimerを取り消す');await sleep(45);
 assert.equal(cache.get('old'),null);assert.equal(cache.snapshot().entries,1);assert.equal(notifications,2);assert.equal(cache.snapshot({diagnostics:true}).scheduledWakeups,0);
 cache.clear();assert.deepEqual(cache.snapshot(),{entries:0,active:0,queued:0});
});

test('実mainのget早期return経路もtimeout後に再取得し、metadataとdraw状態が揃う',{timeout:1000},async t=>{
 const source=await readFile(new URL('../../editor-core/src/main.js',import.meta.url),'utf8');
 const start=source.indexOf('function findTextureSidecarPackPath('),end=source.indexOf('// Additional safety:',start);assert(start>=0&&end>start);
 let clock=1000,calls=0;let done;const failed=new Promise(resolve=>done=resolve);
 const cache=new TextureMetadataCache({timeoutMs:15,retryBaseMs:10,retryMaxMs:20,maxAutomaticRetries:0,now:()=>clock,onChange:done});t.after(()=>cache.clear());
 const runtime={packPaths:['textures/ui/frame.json'],rootPrefix:'',overridesTextByPackPath:{},zipReader:{readText:()=>++calls===1?new Promise(()=>{}):Promise.resolve('{"base_size":[5,5],"nineslice_size":1}')}};
 const context=vm.createContext({textureSidecarCache:cache,textureSidecarPathIndexByRuntime:new WeakMap(),importedPackRuntime:runtime,vanillaReferenceRuntime:null,parseJsonc:text=>({ok:true,value:JSON.parse(text)})});
 vm.runInContext(source.slice(start,end),context);
 assert.equal(context.getTextureSidecarMetadata('imported','textures/ui/frame.png'),null);await failed;
 assert.equal(drawState({},context.getTextureSidecarDrawRecord('textures/ui/frame.png')).state,'missing');
 clock+=20;assert.equal(context.getTextureSidecarMetadata('imported','textures/ui/frame.png'),null);
 assert.equal(context.getTextureSidecarDrawRecord('textures/ui/frame.png').status,'loading');await tick();
 const recovered=context.getTextureSidecarMetadata('imported','textures/ui/frame.png');assert.deepEqual([...recovered.baseSize],[5,5]);assert.equal(recovered.nineSlice,1);assert.equal(calls,2);
});

test('8素材の失敗・回復が重なっても並列上限と単一timerを維持する',{timeout:1000},async t=>{
 let running=0,maximum=0,calls=0;const cache=new TextureMetadataCache({concurrency:8,retryBaseMs:1000,retryMaxMs:30000});t.after(()=>cache.clear());
 for(let index=0;index<24;index++)cache.request(`frame-${index}`,async()=>{calls++;running++;maximum=Math.max(maximum,running);await tick();running--;throw error('NODE_READ_BUSY');});
 for(let i=0;i<20&&cache.snapshot().active;i++)await tick();assert(maximum<=8);assert.equal(calls,24);assert.equal(cache.snapshot().queued,0);
 assert.equal(cache.snapshot({diagnostics:true}).scheduledWakeups,24);assert(cache.retryTimer);
 cache.clear();assert.equal(cache.retryTimer,null);assert.equal(cache.snapshot({diagnostics:true}).scheduledWakeups,0);
});

test('実mainは8件のsidecar回復通知を一つのRAF・再計算へまとめる',async()=>{
 const source=await readFile(new URL('../../editor-core/src/main.js',import.meta.url),'utf8');
 const start=source.indexOf('function requestCanvasTextureMetadataRefresh('),end=source.indexOf('\n}\n',start);assert(start>=0&&end>start);
 const frames=[];let layouts=0,redraws=0;
 const context=vm.createContext({requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},getRoute:()=> 'editor',store:{getState:()=>({})},ensurePreviewLayout:()=>layouts++,previewPlayback:{state:{seconds:0}},requestCanvasTextureRedraw:()=>redraws++});
 vm.runInContext(`let textureMetadataRefreshFrame=null,previewAssetMetricsRevision=0;\n${source.slice(start,end+2)}`,context);
 for(let i=0;i<8;i++)context.requestCanvasTextureMetadataRefresh();assert.equal(frames.length,1);frames[0]();assert.equal(layouts,1);assert.equal(redraws,1);
});
