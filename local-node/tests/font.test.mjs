import test from 'node:test';
import assert from 'node:assert/strict';
import pngjs from '../vendor/pngjs/lib/png.js';
import {decodeFontSheet}from'../font-sheet.mjs';
import {compileGlyphMetrics,glyphAddress,parseBedrockText,layoutBitmapText,drawBitmapText}from'../../editor-core/src/preview/bitmap-font.js';
import {estimateTextIntrinsicSize}from'../../editor-core/src/preview/canvas-preview.js';
function image(scale=1){const width=128*scale,data=Buffer.alloc(width*width*4);for(let y=0;y<7*scale;y++)for(let x=0;x<5*scale;x++)data[((32*scale+y)*width+8*scale+x)*4+3]=255;return{width,height:width,data};}
test('default8 Aのadvanceは6、spaceは4',()=>{const m=compileGlyphMetrics(image(),'default8');assert.equal(m.glyphs[65].advance,6);assert.equal(m.glyphs[32].advance,4);});
test('HD倍密度でもadvanceを維持',()=>assert.equal(compileGlyphMetrics(image(2),'default8').glyphs[65].advance,6));
test('Unicodeのsheet/cellをcodepointから選択',()=>{assert.deepEqual(glyphAddress('あ'),{sheet:'glyph_30',cell:0x42});assert.deepEqual(glyphAddress('\uE010'),{sheet:'glyph_E0',cell:0x10});assert.equal(glyphAddress('😀'),null);});
test('SGAはrune用sheetを使う',()=>assert.deepEqual(glyphAddress('A','rune'),{sheet:'ascii_sga',cell:65}));
test('section色とresetを文字を失わず解釈',()=>{const p=parseBedrockText('§cA§rB','#00ff00');assert.deepEqual(p.characters.map(x=>[x.character,x.color]),[['A','#ff5555'],['B','#00ff00']]);});
test('Bedrock m/nは公式に定義された色コードとして解釈する',()=>{const p=parseBedrockText('§mA§nB');assert.deepEqual(p.diagnostics,[]);assert.deepEqual(p.characters.map(x=>[x.character,x.color]),[['A','#971607'],['B','#b4684d']]);});
test('boldとitalicとresetの状態を分離',()=>{const p=parseBedrockText('§lA§oB§rC');assert.deepEqual(p.characters.map(x=>[x.bold,x.italic]),[[true,false],[true,true],[false,false]]);});
test('文字数上限を拒否',()=>assert.throws(()=>parseBedrockText('A'.repeat(32769)),/FONT_TEXT_LIMIT/));
test('縦横不一致のfont画像を拒否',()=>assert.throws(()=>compileGlyphMetrics({width:128,height:256,data:Buffer.alloc(128*256*4)},'default8'),/DIMENSIONS/));
test('PNG headerの過大寸法をdecode前に拒否',()=>{const b=pngjs.PNG.sync.write(image());b.writeUInt32BE(65535,16);assert.throws(()=>decodeFontSheet(b,'default8'),/DIMENSIONS/);});
test('PNG CRC破損を拒否',()=>{const b=pngjs.PNG.sync.write(image());b[b.length-1]^=1;assert.throws(()=>decodeFontSheet(b,'default8'),/CRC|Crc|crc/);});
test('重複IHDRをdecode前に拒否',()=>{const b=pngjs.PNG.sync.write(image());const duplicate=Buffer.concat([b.subarray(0,33),b.subarray(8)]);assert.throws(()=>decodeFontSheet(duplicate,'default8'),/HEADER_INVALID/);});
test('完全なPNGのmetricsを生成',()=>assert.equal(decodeFontSheet(pngjs.PNG.sync.write(image()),'default8').glyphs[65].advance,6));
test('同じlayoutで測定幅12と2glyph描画を使用',()=>{
  const sheet={image:{},metrics:compileGlyphMetrics(image(),'default8'),tinted:()=>({})};
  const layout=layoutBitmapText('AA',{fontPx:8,getSheet:()=>sheet});assert.equal(layout.width,12);assert.equal(layout.height,8);
  const draws=[],ctx={save(){},restore(){},translate(){},transform(){},drawImage(...a){draws.push(a);}};
  drawBitmapText(ctx,layout,{x:0,y:0,w:12,h:10});assert.equal(draws.length,2);assert.equal(draws[0].at(-1),8);
});
test('未取得glyphをreadyにしない',()=>assert.equal(layoutBitmapText('あ',{getSheet:()=>null}).ready,false));
test('Bedrock素材色はboldを維持しresetで解除する',()=>{const p=parseBedrockText('§l§gA§qB§rC');assert.deepEqual(p.characters.map(x=>[x.color,x.bold]),[['#ddd605',true],['#47a036',true],['#ffffff',false]]);});
test('無効果コードは幅を取らず未対応obfuscationは診断する',()=>{const p=parseBedrockText('§vA§kB§rC');assert.equal(p.characters.map(x=>x.character).join(''),'ABC');assert.deepEqual(p.diagnostics,['k']);});
test('空文字・壊れたサロゲートをglyphへ変換しない',()=>{assert.equal(glyphAddress(''),null);assert.equal(glyphAddress('\ud800'),null);});
test('line_paddingは行間だけに加算し測定と描画を一致させる',()=>{
 const sheet={image:{},metrics:compileGlyphMetrics(image(),'default8'),tinted:()=>({})};
 const layout=layoutBitmapText('A\nA',{fontPx:8,linePadding:3,getSheet:()=>sheet});
 assert.equal(layout.height,19);assert.equal(layout.lineHeight,11);
 const positions=[],ctx={save(){},restore(){},translate(x,y){positions.push([x,y]);},transform(){},drawImage(){}};
 drawBitmapText(ctx,layout,{x:0,y:0,w:6,h:19,vertical:'top'});assert.deepEqual(positions,[[0,0],[0,11]]);
});
test('実機根拠の8論理pixel glyphをUI倍率4で32pixel cellへ描画',()=>{
 const sheet={image:{},metrics:compileGlyphMetrics(image(),'default8'),tinted:()=>({})};
 const layout=layoutBitmapText('A',{fontPx:32,getSheet:()=>sheet});
 assert.equal(layout.scale,4);assert.equal(layout.width,24);
 const draws=[],ctx={save(){},restore(){},translate(){},transform(){},drawImage(...args){draws.push(args);}};
 drawBitmapText(ctx,layout,{x:0,y:0,w:24,h:32,vertical:'top'});
 assert.deepEqual(draws[0].slice(-2),[32,32]);
});
test('font未ロード時の高さ推定も同じ行間を使用',()=>{
 assert.equal(estimateTextIntrinsicSize({font_size:'normal',line_padding:3},'A\nB').h,19);
 assert.equal(estimateTextIntrinsicSize({font_size:'normal',line_padding:3},'A').h,8);
});
test('Unicodeの横余白は詰めるがPUA全範囲E0–F8は原本セルを保つ',()=>{
 const width=128,data=Buffer.alloc(width*width*4);data[((32+2)*width+8+3)*4+3]=255;
 const source={width,height:width,data};
 for(const name of ['glyph_30','glyph_F9']){const g=compileGlyphMetrics(source,name).glyphs[65];assert.equal(g.drawX,3);assert.equal(g.drawW,1);assert.equal(g.sy,32);}
 for(const name of ['glyph_E0','glyph_EF','glyph_F0','glyph_F8']){const g=compileGlyphMetrics(source,name).glyphs[65];assert.equal(g.drawX,0);assert.equal(g.drawW,8);}
});
test('font寸法のNaN・Infinity・負値を拒否',()=>{for(const fontPx of [0,-1,NaN,Infinity,4097])assert.throws(()=>layoutBitmapText('',{fontPx,getSheet:()=>null}),/FONT_LAYOUT_DIMENSIONS/);});
