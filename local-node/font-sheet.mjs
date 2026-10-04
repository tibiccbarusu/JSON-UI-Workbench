import pngjs from './vendor/pngjs/lib/png.js';
import { compileGlyphMetrics } from '../editor-core/src/preview/bitmap-font.js';
import { LIMITS,fail } from './limits.mjs';
/** Validate bounded PNG structure and decode original resource pixels. */
export function decodeFontSheetPixels(bytes){
  if(bytes.length<33||bytes.length>4*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')fail('FONT_PNG_INVALID');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width!==height||width<128||width>1024||width%16)fail('FONT_SHEET_DIMENSIONS');
  let offset=8,headers=0,ended=false;
  while(offset<bytes.length){
    if(offset+12>bytes.length)fail('FONT_PNG_CHUNK_INVALID');
    const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
    if(length>bytes.length-offset-12)fail('FONT_PNG_CHUNK_INVALID');
    if(type==='IHDR'&&(++headers!==1||offset!==8||length!==13))fail('FONT_PNG_HEADER_INVALID');
    offset+=length+12;
    if(type==='IEND'){if(length!==0||offset!==bytes.length)fail('FONT_PNG_CHUNK_INVALID');ended=true;break;}
  }
  if(headers!==1||!ended)fail('FONT_PNG_CHUNK_INVALID');
  const image=pngjs.PNG.sync.read(bytes,{checkCRC:true});
  if(image.width!==width||image.height!==height)fail('FONT_PNG_HEADER_MISMATCH');
  return image;
}
export function decodeFontSheet(bytes,sheet){return compileGlyphMetrics(decodeFontSheetPixels(bytes),sheet);}
