import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextureImageCache} from '../src/assets/texture-image-cache.js';
const options = { maxEntries:1, maxDecodedBytesTotal:1024, perImageMaxDecodedBytes:4 };
const pixel = (onClose=()=>{}) => async () => ({image:{close:onClose},width:1,height:1,decodedBytes:4});
test('maxEntries 1 の挿入は旧画像を解放し、常に 1 件以内',async()=>{
 const cache=createTextureImageCache(options),closed=[];
 await cache.load('a',pixel(()=>closed.push('a')));await cache.load('b',pixel(()=>closed.push('b')));
 assert.equal(cache.stats().entries,1);assert.equal(cache.get('a'),null);assert(cache.get('b'));assert.deepEqual(closed,['a']);
 cache.clear();assert.deepEqual(closed,['a','b']);
});
test('LRU の読取順を保ち、件数上限とバイト上限が同時に守られる',async()=>{
 const cache=createTextureImageCache({...options,maxEntries:2,maxDecodedBytesTotal:8}),closed=[];
 for(const key of ['a','b'])await cache.load(key,pixel(()=>closed.push(key)));
 cache.get('a');await cache.load('c',pixel(()=>closed.push('c')));
 assert(cache.get('a'));assert.equal(cache.get('b'),null);assert(cache.get('c'));
 assert.equal(cache.stats().totalDecodedBytes,8);assert.equal(cache.stats().entries,2);assert.deepEqual(closed,['b']);cache.clear();
});
test('失敗キーを繰り返し追加しても負キャッシュは指定件数以下',async()=>{
 const cache=createTextureImageCache({...options,maxNegativeEntries:2});
 for(let i=0;i<12;i++){
  await assert.rejects(cache.load(`bad${i}`,async()=>{throw new Error('IMAGE_DECODE_FAILED');}));
  assert(cache.stats().negativeEntries<=2);assert.equal(cache.stats().inflight,0);assert.equal(cache.stats().inflightReservedDecodedBytes,0);
 }
 assert.equal(cache.getFailure('bad0'),null);assert(cache.getFailure('bad11'));cache.clear();assert.equal(cache.stats().negativeEntries,0);
});
test('期限切れの負キャッシュは別キー失敗時に削除する',async()=>{
 const now=Date.now;let clock=1000;Date.now=()=>clock;
 const cache=createTextureImageCache({...options,maxNegativeEntries:3,negativeTtlMs:10});
 try{
  await assert.rejects(cache.load('old',async()=>{throw new Error('IMAGE_DECODE_FAILED');}));clock=1011;
  await assert.rejects(cache.load('new',async()=>{throw new Error('IMAGE_DECODE_FAILED');}));
  assert.equal(cache.stats().negativeEntries,1);assert.equal(cache.getFailure('old'),null);assert(cache.getFailure('new'));
 }finally{Date.now=now;cache.clear();}
});
test('TTL 0 は失敗を保持せず、同じキーを再ロードできる',async()=>{
 const cache=createTextureImageCache({...options,negativeTtlMs:0});let attempts=0;
 for(let i=0;i<2;i++)await assert.rejects(cache.load('bad',async()=>{attempts++;throw new Error('IMAGE_DECODE_FAILED');}));
 assert.equal(attempts,2);assert.equal(cache.stats().negativeEntries,0);cache.clear();
});
test('小さい予約での拒否は、より大きい予約で再試行できる',async()=>{
 const cache=createTextureImageCache({...options,perImageMaxDecodedBytes:16});
 const loader=async()=>({image:{close(){}},width:2,height:2,decodedBytes:16});
 await assert.rejects(cache.load('same',loader,{decodedByteReservation:4}));
 assert(cache.getFailure('same'));await cache.load('same',loader,{decodedByteReservation:16});
 assert.equal(cache.getFailure('same'),null);assert.equal(cache.stats().negativeEntries,0);cache.clear();
});
