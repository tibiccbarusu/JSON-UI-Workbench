// Node Workerとブラウザの境界を越えるcmap coverageの固定期待値検査。
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFontCoverage} from '../font-coverage.mjs';
import {fontCoverageContains,splitFontCoverageRuns,measureCoveredFontLine,drawCoveredFontLine} from '../../editor-core/src/preview/font-coverage-preview.js';
function sfnt(subformat,subtable,numGlyphs=500){
  const cmap=Buffer.alloc(12+subtable.length);cmap.writeUInt16BE(1,2);cmap.writeUInt16BE(3,4);cmap.writeUInt16BE(subformat===12?10:1,6);cmap.writeUInt32BE(12,8);subtable.copy(cmap,12);
  const bytes=Buffer.alloc(50+cmap.length);bytes.writeUInt32BE(0x10000);bytes.writeUInt16BE(2,4);
  bytes.write('maxp',12);bytes.writeUInt32BE(44,20);bytes.writeUInt32BE(6,24);bytes.writeUInt32BE(0x5000,44);bytes.writeUInt16BE(numGlyphs,48);
  bytes.write('cmap',28);bytes.writeUInt32BE(50,36);bytes.writeUInt32BE(cmap.length,40);cmap.copy(bytes,50);return bytes;
}
function format4(segments,glyphs=[]){
  const count=segments.length,s=Buffer.alloc(16+count*8+glyphs.length*2);s.writeUInt16BE(4);s.writeUInt16BE(s.length,2);s.writeUInt16BE(count*2,6);
  segments.forEach(([start,end,delta,offset=0],i)=>{s.writeUInt16BE(end,14+i*2);s.writeUInt16BE(start,16+count*2+i*2);s.writeInt16BE(delta,16+count*4+i*2);s.writeUInt16BE(offset,16+count*6+i*2);});glyphs.forEach((g,i)=>s.writeUInt16BE(g,16+count*8+i*2));return s;
}
function format12(groups){const s=Buffer.alloc(16+groups.length*12);s.writeUInt16BE(12);s.writeUInt32BE(s.length,4);s.writeUInt32BE(groups.length,12);groups.forEach(([start,end,glyph],i)=>{s.writeUInt32BE(start,16+i*12);s.writeUInt32BE(end,20+i*12);s.writeUInt32BE(glyph,24+i*12);});return s;}
const sentinel=[0xffff,0xffff,1];

test('Microsoft format4例の3区間をdelta moduloで読みglyph0 sentinelを除外',()=>{
  const out=parseFontCoverage(sfnt(4,format4([[10,20,-9],[30,90,-18],[153,480,-80],sentinel])));
  assert.deepEqual(out.coverageRanges,[[10,20],[30,90],[153,480]]);assert.equal(out.codepointCount,400);assert.equal(out.profile,'sfnt-unicode-cmap4-v1');
});
test('format4 idRangeOffsetをそのword位置から参照しglyph0へdeltaを加えない',()=>{
  const out=parseFontCoverage(sfnt(4,format4([[65,67,1,4],sentinel],[1,0,3])));
  assert.deepEqual(out.coverageRanges,[[65,65],[67,67]]);assert.equal(out.codepointCount,2);
});
test('format12は非BMPとglyph0開始とsurrogate除外を処理する',()=>{
  const out=parseFontCoverage(sfnt(12,format12([[0,2,0],[0xd7ff,0xe001,10],[0x1f600,0x1f602,3000]]),4000));
  assert.deepEqual(out.coverageRanges,[[1,2],[0xd7ff,0xd7ff],[0xe000,0xe001],[0x1f600,0x1f602]]);assert.equal(out.codepointCount,8);
});
test('cmap4配列外offset・逆順segment・存在しないglyphを拒否する',()=>{
  assert.throws(()=>parseFontCoverage(sfnt(4,format4([[65,67,0,65534],sentinel]))),/FONT_CMAP4_GLYPH_ARRAY_RANGE/);
  assert.throws(()=>parseFontCoverage(sfnt(4,format4([[65,67,-64],[66,68,-64],sentinel]))),/FONT_CMAP4_SEGMENT_ORDER/);
  assert.throws(()=>parseFontCoverage(sfnt(4,format4([[65,65,100],sentinel]),100)),/FONT_CMAP4_GLYPH_RANGE/);
});
test('format12のUnicode外・過大glyph・重複groupを拒否する',()=>{
  assert.throws(()=>parseFontCoverage(sfnt(12,format12([[0x110000,0x110000,1]]))),/FONT_CMAP12_GLYPH_RANGE/);
  assert.throws(()=>parseFontCoverage(sfnt(12,format12([[65,66,499]]))),/FONT_CMAP12_GLYPH_RANGE/);
  assert.throws(()=>parseFontCoverage(sfnt(12,format12([[65,66,1],[66,67,3]]))),/FONT_CMAP12_GLYPH_RANGE/);
});
test('入力型・8MiB上限・破損directoryを安定errorで拒否する',()=>{
  assert.throws(()=>parseFontCoverage({}),/FONT_COVERAGE_INPUT_INVALID/);assert.throws(()=>parseFontCoverage(Buffer.alloc(8*1024*1024+1)),/FONT_COVERAGE_BYTE_LIMIT/);
  const b=sfnt(4,format4([[65,65,-64],sentinel]));b.writeUInt32BE(0xfffffffe,36);assert.throws(()=>parseFontCoverage(b),/FONT_SFNT_TABLE_RANGE/);
});
test('未知containerと未知cmapを対応済みへ昇格しない',()=>{
  const woff=Buffer.alloc(12);woff.write('wOFF');const unsupported=parseFontCoverage(woff);assert.equal(unsupported.supported,false);assert.equal(unsupported.reasonCode,'FONT_CONTAINER_UNSUPPORTED');
  const b=sfnt(4,format4([[65,65,-64],sentinel]));b.writeUInt16BE(13,62);assert.equal(parseFontCoverage(b).reasonCode,'FONT_CMAP_FORMAT_UNSUPPORTED');
});
test('文字単位coverage検査はBMP/非BMP/境界と未検証を区別する',()=>{
  const c={supported:true,coverageRanges:[[32,126],[0x1f600,0x1f600]]};
  assert.equal(fontCoverageContains(c,31),false);assert.equal(fontCoverageContains(c,32),true);assert.equal(fontCoverageContains(c,127),false);assert.equal(fontCoverageContains(c,0x1f600),true);assert.equal(fontCoverageContains({supported:false},65),null);
});
test('一文字欠字でASCII runのfontを変えず、欠字をfillTextへ渡さない',()=>{
  const c={supported:true,coverageRanges:[[32,126]]},draws=[],rects=[];
  const ctx={save(){},restore(){},measureText:t=>({width:t.length*5}),fillText(...a){draws.push(a);},fillRect(...a){rects.push(a);}};
  const runs=splitFontCoverageRuns('ABあCD',c);assert.deepEqual(runs.runs,[{text:'AB',missing:false},{text:'あ',missing:true},{text:'CD',missing:false}]);
  assert.equal(measureCoveredFontLine(ctx,'ABあCD',c,8).width,28);
  drawCoveredFontLine(ctx,'ABあCD',c,{x:100,y:20,fontPx:8,align:'center'});
  assert.deepEqual(draws,[['AB',86,20],['CD',104,20]]);assert.equal(rects.length,4);
});
test('長い欠字runの診断は32codepointで止め32768文字超は拒否する',()=>{
  const c={supported:true,coverageRanges:[]};assert.equal(splitFontCoverageRuns(Array.from({length:100},(_,i)=>String.fromCodePoint(0x3040+i)).join(''),c).missingCodepoints.length,32);
  assert.throws(()=>splitFontCoverageRuns('A'.repeat(32769),c),/FONT_TEXT_LIMIT/);
});
