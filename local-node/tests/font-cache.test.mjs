import test from 'node:test';
import assert from 'node:assert/strict';
import { BitmapFontCache } from '../../editor-core/src/preview/bitmap-font-cache.js';
const sources = [{kind:'imported',id:'pack1'}];
const decodeImage = async () => ({width:128,height:128});
const tick = () => new Promise(resolve => setImmediate(resolve));
test('2同時上限で3つ目のfontを自動キュー処理する', async () => {
 let active=0, maximum=0, done=[];
 const cache=new BitmapFontCache(async ({sheet})=>{active++;maximum=Math.max(maximum,active);await tick();active--;done.push(sheet);return {metrics:{}};},()=>{},()=>{}, {decodeImage});
 cache.ensure('Aあ中','default',sources,'ja_JP');
 for(let i=0;i<8;i++)await tick();
 assert.equal(maximum,2);assert.equal(done.length,3);assert.equal(cache.pending,0);
 assert.equal(cache.get(sources,'ja_JP','glyph_4E').status,'ready');cache.clear();
});
test('pack変更時に旧通信が停止しても新packのqueueが進む', async () => {
 const calls=[];
 const cache=new BitmapFontCache(async ({sources,sheet},signal)=>{
  calls.push(sources[0].id+sheet);
  if(sources[0].id==='pack1')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
  return {metrics:{}};
 },()=>{},()=>{}, {decodeImage});
 cache.ensure('Aあ','default',sources,'ja_JP');cache.clear();
 const next=[{kind:'imported',id:'pack2'}];cache.ensure('中','default',next,'ja_JP');
 for(let i=0;i<6;i++)await tick();
 assert.equal(cache.get(next,'ja_JP','glyph_4E').status,'ready');assert.equal(cache.pending,0);cache.clear();
});
test('一時停止したdecodeはtimeoutし同じsheetを無限再読込しない', async () => {
 let calls=0;const errors=[];
 const cache=new BitmapFontCache(async()=>{calls++;return{};},()=>{},e=>errors.push(e.message),{decodeImage:()=>new Promise(()=>{}),timeoutMs:15});
 cache.ensure('A','default',sources,'en_US');await new Promise(resolve=>setTimeout(resolve,30));
 cache.ensure('A','default',sources,'en_US');assert.equal(calls,1);assert.equal(cache.pending,0);assert.equal(errors.length,1);cache.clear();
});
test('同一pack idでも優先レイヤーが違えばfont keyを混同しない',()=>{
 const cache=new BitmapFontCache(()=>{},()=>{},()=>{});assert.notEqual(cache.key([{id:'1',kind:'vanilla'}],'en_US','default8'),cache.key([{id:'1',kind:'imported'}],'en_US','default8'));
});

test('abort非対応の旧loadが後から完了しても画像decodeを開始しない',async()=>{
 let finishOld,decodes=0;const errors=[];
 const cache=new BitmapFontCache(({sources})=>sources[0].id==='pack1'?new Promise(resolve=>{finishOld=resolve;}):Promise.resolve({metrics:{}}),
  ()=>{},error=>errors.push(error),{decodeImage:async()=>{decodes++;return {width:128,height:128};}});
 cache.ensure('A','default',sources,'ja_JP');cache.clear();
 const next=[{kind:'imported',id:'pack2'}];cache.ensure('A','default',next,'ja_JP');
 finishOld({metrics:{}});
 for(let i=0;i<6;i++)await tick();
 assert.equal(decodes,1);assert.equal(errors.length,0);assert.equal(cache.get(next,'ja_JP','default8').status,'ready');cache.clear();
});

test('旧decodeの遅延完了は画像を解放し新packを上書きしない',async()=>{
 let finishDecode,closed=0;
 const cache=new BitmapFontCache(async({sources})=>({source:sources[0].id,metrics:{}}),()=>{},()=>{},
  {decodeImage:data=>data.source==='pack1'?new Promise(resolve=>{finishDecode=resolve;}):Promise.resolve({width:128,height:128})});
 cache.ensure('A','default',sources,'ja_JP');await tick();cache.clear();
 const next=[{kind:'imported',id:'pack2'}];cache.ensure('A','default',next,'ja_JP');
 finishDecode({width:128,height:128,close(){closed++;}});
 for(let i=0;i<6;i++)await tick();
 assert.equal(closed,1);assert.equal(cache.get(next,'ja_JP','default8').status,'ready');assert.equal(cache.pending,0);cache.clear();
});

test('標準Image decoderもclearでsrcを解除する',async t=>{
 const original=globalThis.Image;let image;
 class PendingImage {
  constructor(){image=this;this.width=128;this.height=128;this.cleared=false;}
  decode(){return new Promise((_,reject)=>{this.reject=reject;});}
  removeAttribute(name){assert.equal(name,'src');this.cleared=true;this.reject?.(new Error('image cancelled'));}
 }
 globalThis.Image=PendingImage;t.after(()=>{if(original===undefined)delete globalThis.Image;else globalThis.Image=original;});
 const cache=new BitmapFontCache(async()=>({png:'fixture',metrics:{}}),()=>{},()=>{});
 cache.ensure('A','default',sources,'en_US');await tick();cache.clear();await tick();
 assert.equal(image.cleared,true);assert.equal(cache.pending,0);
});
