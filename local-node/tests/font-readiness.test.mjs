// 実行: node --test local-node/tests/font-readiness.test.mjs
// リソース文字の一部不足で全ラベルがOSフォントへ変わる回帰を検査する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGlyphMetrics, layoutBitmapText, drawBitmapText, glyphAddress, normalizeBitmapFontType } from '../../editor-core/src/preview/bitmap-font.js';
import { BitmapFontCache } from '../../editor-core/src/preview/bitmap-font-cache.js';
import { createFontFaceCache } from '../../editor-core/src/assets/font-face-cache.js';
import { buildAssetIndexFromPackPaths, resolveFontTypeRef } from '../../editor-core/src/assets/asset-indexer.js';
import { drawCanvasPreview } from '../../editor-core/src/preview/canvas-preview.js';

function fixtureSheet() {
  const width=128,data=Buffer.alloc(width*width*4);
  for(let y=0;y<7;y++)for(let x=0;x<5;x++)data[((32+y)*width+8+x)*4+3]=255;
  const image={};
  return {status:'ready',image,metrics:compileGlyphMetrics({width,height:width,data},'default8'),tinted:()=>image};
}
function recorder() {
  const calls={text:[],images:[],rects:[]};
  return {calls,globalAlpha:1,save(){},restore(){},translate(){},transform(){},setTransform(){},clearRect(){},strokeRect(){},setLineDash(){},beginPath(){},rect(){},clip(){},
    drawImage(...args){calls.images.push(args);},fillText(...args){calls.text.push(args);},fillRect(...args){calls.rects.push(args);}};
}
const sources=[{kind:'vanilla',id:'font-fixture'}];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function browserFixture(t){const old=globalThis.window;globalThis.window={devicePixelRatio:1};t.after(()=>{if(old===undefined)delete globalThis.window;else globalThis.window=old;});}

test('一字の未取得sheetがあっても前後のresource字形と行を保持する',()=>{
  const sheet=fixtureSheet();
  const layout=layoutBitmapText('AあA\nA',{getSheet:name=>name==='default8'?sheet:null});
  assert.equal(layout.ready,false);assert.equal(layout.drawable,true);assert.equal(layout.lines.length,2);
  assert.equal(layout.lines[0].width,20);assert.equal(layout.lines[1].width,6);
  assert.deepEqual(layout.missing,['glyph_30']);assert.equal(layout.loadingGlyphCount,1);
  const ctx=recorder();drawBitmapText(ctx,layout,{x:0,y:0,w:20,h:16,vertical:'top'});
  assert.equal(ctx.calls.images.length,3);assert.equal(ctx.calls.rects.length,4);assert.equal(ctx.calls.text.length,0);
});
test('非BMP一字だけを診断し隣接ASCIIを一般fontへ置換しない',()=>{
  const sheet=fixtureSheet(),layout=layoutBitmapText('A😀A',{getSheet:()=>sheet});
  assert.equal(layout.ready,false);assert.equal(layout.missingGlyphCount,1);assert.equal(layout.loadingGlyphCount,0);
  assert.deepEqual(layout.issues,[{code:'FONT_CODEPOINT_UNSUPPORTED',sheet:null,codepoint:0x1f600}]);
  const ctx=recorder();drawBitmapText(ctx,layout,{x:0,y:0,w:20,h:8});assert.equal(ctx.calls.images.length,2);assert.equal(ctx.calls.text.length,0);
});
test('空白glyphは診断boxを描かず、空の非空白glyphは不足として示す',()=>{
  const sheet=fixtureSheet(),layout=layoutBitmapText('A B',{getSheet:()=>sheet});
  assert.equal(layout.missingGlyphCount,1);assert.equal(layout.issues[0].code,'FONT_GLYPH_EMPTY');
  assert.equal(layout.lines[0].glyphs[1].glyph.empty,true);assert.equal(layout.lines[0].glyphs[2].placeholder,true);
});
test('読込失敗と読込中を区別し、診断内容は最大32字に制限する',()=>{
  const missing=layoutBitmapText('あ'.repeat(100),{getSheet:()=>({status:'missing'})});
  assert.equal(missing.loadingGlyphCount,0);assert.equal(missing.missingGlyphCount,100);assert.equal(missing.issues.length,32);
  assert.equal(missing.issues[0].code,'FONT_GLYPH_MISSING');
  const loading=layoutBitmapText('あ',{getSheet:()=>({status:'loading'})});assert.equal(loading.issues[0].code,'FONT_GLYPH_LOADING');
});
test('font名のcaseだけでdefaultとUnicodeとruneのsheet選択を失わない',()=>{
  assert.equal(normalizeBitmapFontType(' Unicode '),'unicode');assert.equal(normalizeBitmapFontType('unavailable-family'),null);
  assert.equal(glyphAddress('A','Unicode').sheet,'glyph_00');assert.equal(glyphAddress('A','Rune').sheet,'ascii_sga');
  assert.equal(glyphAddress('A','unavailable-family'),null);
});
test('全sheet未準備でも行高・行間・空白幅を計測できる',()=>{
  const layout=layoutBitmapText('A A\nA',{fontPx:16,linePadding:3,getSheet:()=>null});
  assert.equal(layout.width,40);assert.equal(layout.height,35);assert.equal(layout.lines[0].glyphs[1].placeholder,false);
});
test('Canvas本体も未準備font情報をOS fontとして描画しない',t=>{
  browserFixture(t);
  const ctx=recorder(),canvas={width:0,height:0,getContext:()=>ctx,getBoundingClientRect:()=>({width:100,height:50})};
  const layout={preset:{width:100,height:50},boxes:[{id:'label',type:'label',x:0,y:0,w:100,h:20,depth:0,order:0}]};
  for(const state of ['loading','missing','unsupported','ready'])drawCanvasPreview(canvas,layout,{zoom:1,viewX:0,viewY:0},{showGuides:false,showScreenBoundary:false,textDrawById:{label:{text:'A',fontFamily:'sans-serif',fontPx:8,state,fontBackend:'unavailable'}}});
  assert.equal(ctx.calls.text.length,0);
});
test('Canvas本体はpartial bitmap layoutを描きresource FontFaceだけCSSを許可する',t=>{
  browserFixture(t);
  const ctx=recorder(),canvas={width:0,height:0,getContext:()=>ctx,getBoundingClientRect:()=>({width:100,height:50})};
  const layout={preset:{width:100,height:50},boxes:[{id:'label',type:'label',x:0,y:0,w:100,h:20,depth:0,order:0}]};
  const bitmap=layoutBitmapText('A😀',{getSheet:()=>fixtureSheet()});
  drawCanvasPreview(canvas,layout,{zoom:1,viewX:0,viewY:0},{showGuides:false,showScreenBoundary:false,textDrawById:{label:{text:'A😀',fontPx:8,state:'missing',fontBackend:'resource-bitmap',bitmapLayout:bitmap}}});
  assert.equal(ctx.calls.images.length,1);assert.equal(ctx.calls.text.length,0);
  drawCanvasPreview(canvas,layout,{zoom:1,viewX:0,viewY:0},{showGuides:false,showScreenBoundary:false,textDrawById:{label:{text:'A',fontFamily:'pack-face',fontPx:8,state:'ready',fontBackend:'resource-font-face'}}});
  assert.equal(ctx.calls.text.length,1);assert.equal(ctx.font,'8px "pack-face"');
});
test('BitmapFont timeoutはcancelと区別でき負cacheを再取得しない',async()=>{
  let calls=0;const errors=[];
  const cache=new BitmapFontCache(async()=>{calls++;return new Promise(()=>{});},()=>{},e=>errors.push(e.message),{timeoutMs:10});
  cache.ensure('A','Default',sources,'en_US');await new Promise(resolve=>setTimeout(resolve,30));
  assert.deepEqual(errors,['FONT_LOAD_TIMEOUT']);assert.equal(cache.stats().missing,1);assert.equal(cache.stats().pending,0);
  cache.ensure('A','default',sources,'en_US');assert.equal(calls,1);cache.clear();assert.equal(cache.stats().entries,0);
});
test('bitmap cache満杯の同一sheet通知は一回だけで再描画を圧迫しない',()=>{
  const errors=[],cache=new BitmapFontCache(()=>new Promise(()=>{}),()=>{},e=>errors.push(e.message));cache.maxRows=1;
  cache.ensure('A','default',sources,'en_US');cache.ensure('あ','default',sources,'en_US');cache.ensure('あ','default',sources,'en_US');
  assert.deepEqual(errors,['FONT_CACHE_SHEET_LIMIT']);cache.clear();
});
test('MinecraftTenは実packのTTFを優先し存在しない時だけsemanticで残す',()=>{
  const importedIndex=buildAssetIndexFromPackPaths(['font/minecraft-ten.ttf']),vanillaIndex=buildAssetIndexFromPackPaths(['font/minecraft-ten.ttf']);
  const loaded=resolveFontTypeRef('MinecraftTen',{importedIndex,vanillaIndex});assert.equal(loaded.resolved.source,'imported');assert.equal(loaded.builtIn,false);
  const absent=resolveFontTypeRef('MinecraftTen',{});assert.equal(absent.builtIn,true);assert.equal(absent.resolved,null);
  assert.equal(resolveFontTypeRef('smooth',{}).builtIn,true);
});
test('FontFace永続待機をtimeout終了し遅延faceをdocumentから解除する',async t=>{
  const old=globalThis.document,removed=[];globalThis.document={fonts:{delete:face=>removed.push(face)}};t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old;});
  const cache=createFontFaceCache({loadTimeoutMs:10});let finish,signal;
  const promise=cache.load('late',s=>{signal=s;return new Promise(resolve=>{finish=resolve;});});
  await assert.rejects(promise,/FONT_LOAD_TIMEOUT/);assert.equal(signal.aborted,true);assert.equal(cache.stats().inflight,0);
  const face={};finish({family:'late-face',face,bytes:100});await tick();assert.deepEqual(removed,[face]);assert.equal(cache.get('late'),null);
});
test('全cache容量を超えるFontFaceをready返却せず登録済faceを解除する',async t=>{
  const old=globalThis.document,removed=[];globalThis.document={fonts:{delete:face=>removed.push(face)}};t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old;});
  const cache=createFontFaceCache({maxBytesTotal:100,perFontMaxBytes:1000}),face={};
  await assert.rejects(cache.load('large',async()=>({family:'face',face,bytes:101})),/FONT_LOAD_TOO_LARGE/);
  assert.deepEqual(removed,[face]);assert.equal(cache.get('large'),null);assert.equal(cache.stats().totalBytes,0);
});
test('FontFace同時load上限に達したら新しいloaderを開始しない',async()=>{
  const cache=createFontFaceCache({maxInflight:1,loadTimeoutMs:1000});let finish,extra=false;
  const first=cache.load('first',()=>new Promise(resolve=>{finish=resolve;}));await tick();
  await assert.rejects(cache.load('extra',async()=>{extra=true;return{};}),/FONT_LOAD_CONCURRENCY_LIMIT/);assert.equal(extra,false);
  finish({family:'face',face:{},bytes:100});await first;cache.clear();
});
