// Node Worker用。SFNT文字対応表を有界に読み、存在しない文字のOS代替を防ぐ。
// 実行時にフォントを登録・生成・変更しない。cmapのUnicode format 4/12のみ。
import { createHash } from 'node:crypto';
const MAX_BYTES=8*1024*1024,MAX_RANGES=8192;
function fail(code){throw new Error(code);}

export function parseFontCoverage(input){
  if(!(input instanceof Uint8Array))fail('FONT_COVERAGE_INPUT_INVALID');
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
  if(bytes.length>MAX_BYTES)fail('FONT_COVERAGE_BYTE_LIMIT');
  if(bytes.length<12)fail('FONT_SFNT_TRUNCATED');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const magic=bytes.toString('ascii',0,4),signature=bytes.readUInt32BE(0);
  const format=signature===0x10000?'truetype':magic==='OTTO'?'opentype':magic==='wOFF'?'woff':magic==='wOF2'?'woff2':magic==='ttcf'?'collection':'unknown';
  if(!['truetype','opentype'].includes(format))return {supported:false,format,coverageRanges:[],codepointCount:0,reasonCode:'FONT_CONTAINER_UNSUPPORTED',sha256};
  const inRange=(offset,length,limit=bytes.length)=>Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>=0&&offset<=limit&&length<=limit-offset;
  const numTables=bytes.readUInt16BE(4);
  if(numTables===0||numTables>256||!inRange(12,numTables*16))fail('FONT_SFNT_TABLE_DIRECTORY');
  const tables=new Map();
  for(let i=0;i<numTables;i++){
    const at=12+i*16,tag=bytes.toString('ascii',at,at+4),offset=bytes.readUInt32BE(at+8),length=bytes.readUInt32BE(at+12);
    if(tables.has(tag)||offset<12+numTables*16||!inRange(offset,length))fail('FONT_SFNT_TABLE_RANGE');
    tables.set(tag,{offset,length});
  }
  const cmap=tables.get('cmap'),maxp=tables.get('maxp');
  if(!cmap||!maxp||cmap.length<4||maxp.length<6)return {supported:false,format,coverageRanges:[],codepointCount:0,reasonCode:'FONT_CMAP_REQUIRED_TABLE_MISSING',sha256};
  const numGlyphs=bytes.readUInt16BE(maxp.offset+4);
  if(numGlyphs===0)fail('FONT_CMAP_GLYPH_COUNT');
  const c=bytes.subarray(cmap.offset,cmap.offset+cmap.length),count=c.readUInt16BE(2);
  if(c.readUInt16BE(0)!==0||count===0||count>256||!inRange(4,count*8,c.length))fail('FONT_CMAP_DIRECTORY');
  const candidates=[];
  for(let i=0;i<count;i++){
    const at=4+i*8,platform=c.readUInt16BE(at),encoding=c.readUInt16BE(at+2),offset=c.readUInt32BE(at+4);
    if(!inRange(offset,2,c.length))fail('FONT_CMAP_SUBTABLE_RANGE');
    const subformat=c.readUInt16BE(offset),unicode=platform===0||(platform===3&&[1,10].includes(encoding));
    if(!unicode||![4,12].includes(subformat))continue;
    candidates.push({offset,subformat,platform,encoding,priority:(subformat===12?100:0)+(platform===3?10:0)+(encoding===10?1:0)});
  }
  candidates.sort((a,b)=>b.priority-a.priority);
  const chosen=candidates[0];
  if(!chosen)return {supported:false,format,coverageRanges:[],codepointCount:0,reasonCode:'FONT_CMAP_FORMAT_UNSUPPORTED',sha256};
  const ranges=[];let codepointCount=0;
  const add=(start,end)=>{
    if(start>end)return;
    if(start<0xd800&&end>=0xd800){add(start,0xd7ff);add(0xe000,end);return;}
    if(start>=0xd800&&start<=0xdfff){add(0xe000,end);return;}
    const last=ranges.at(-1);
    if(last&&start<=last[1])fail('FONT_CMAP_OVERLAPPING_COVERAGE');
    codepointCount+=end-start+1;
    if(last&&start===last[1]+1)last[1]=end;else ranges.push([start,end]);
    if(ranges.length>MAX_RANGES)fail('FONT_CMAP_RANGE_LIMIT');
  };
  const base=chosen.offset;
  if(chosen.subformat===12){
    if(!inRange(base,16,c.length))fail('FONT_CMAP12_TRUNCATED');
    const length=c.readUInt32BE(base+4),groups=c.readUInt32BE(base+12);
    if(c.readUInt16BE(base+2)!==0||length<16||groups>65536||!inRange(base,length,c.length)||16+groups*12>length)fail('FONT_CMAP12_GROUP_RANGE');
    let previous=-1;
    for(let i=0;i<groups;i++){
      const at=base+16+i*12,start=c.readUInt32BE(at),end=c.readUInt32BE(at+4),glyph=c.readUInt32BE(at+8);
      if(start>end||end>0x10ffff||start<=previous||glyph+end-start>=numGlyphs)fail('FONT_CMAP12_GLYPH_RANGE');
      add(start+(glyph===0?1:0),end);previous=end;
    }
  }else{
    if(!inRange(base,16,c.length))fail('FONT_CMAP4_TRUNCATED');
    const length=c.readUInt16BE(base+2),segCountX2=c.readUInt16BE(base+6),segments=segCountX2/2;
    if(!segments||segCountX2%2||length<16+segments*8||!inRange(base,length,c.length))fail('FONT_CMAP4_SEGMENT_RANGE');
    const s=c.subarray(base,base+length),endAt=14,startAt=16+segments*2,deltaAt=16+segments*4,rangeAt=16+segments*6;
    if(s.readUInt16BE(14+segments*2)!==0||s.readUInt16BE(endAt+(segments-1)*2)!==0xffff)fail('FONT_CMAP4_SENTINEL');
    let previous=-1;
    for(let i=0;i<segments;i++){
      const start=s.readUInt16BE(startAt+i*2),end=s.readUInt16BE(endAt+i*2),delta=s.readInt16BE(deltaAt+i*2),offset=s.readUInt16BE(rangeAt+i*2);
      if(start>end||start<=previous||offset%2)fail('FONT_CMAP4_SEGMENT_ORDER');
      for(let cp=start;cp<=end;cp++){
        let glyph;
        if(!offset)glyph=(cp+delta)&0xffff;
        else{
          const glyphAt=rangeAt+i*2+offset+2*(cp-start);
          if(glyphAt<rangeAt+segments*2||!inRange(glyphAt,2,s.length))fail('FONT_CMAP4_GLYPH_ARRAY_RANGE');
          glyph=s.readUInt16BE(glyphAt);if(glyph)glyph=(glyph+delta)&0xffff;
        }
        if(glyph>=numGlyphs)fail('FONT_CMAP4_GLYPH_RANGE');
        if(glyph)add(cp,cp);
      }
      previous=end;
    }
  }
  return {supported:true,format,coverageRanges:ranges,codepointCount,sha256,numGlyphs,profile:`sfnt-unicode-cmap${chosen.subformat}-v1`,platformId:chosen.platform,encodingId:chosen.encoding,
    limitation:'cmapの文字存在検査。字形の実機一致・合字・字詰め・font metadata aliasの評価ではない。'};
}
