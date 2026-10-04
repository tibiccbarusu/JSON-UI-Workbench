// Resource-backed glyph geometry. Native Unicode advance is an explicit
// approximation profile until paired device captures establish that rule.
import { SMOOTH_FONT_PROFILE37, smoothGlyphAddress37, drawSmoothGlyph37 } from './smooth-font37.js';
const COLORS = ['#000000','#0000aa','#00aa00','#00aaaa','#aa0000','#aa00aa','#ffaa00','#aaaaaa','#555555','#5555ff','#55ff55','#55ffff','#ff5555','#ff55ff','#ffff55','#ffffff'];
// Bedrock-only codes: Microsoft Raw Message JSON defines their meaning;
// RGB constants follow the published minecraft-colors reference. They are
// not Java's underline/strikethrough and must not appear as literal glyphs.
const MATERIAL_COLORS = Object.freeze({g:'#ddd605',h:'#e3d4d1',i:'#cecaca',j:'#443a3b',m:'#971607',n:'#b4684d',p:'#deb12d',q:'#47a036',s:'#2cbaa8',t:'#21497b',u:'#9a5cc6'});
export const BEDROCK_TEXT_LIMITS = Object.freeze({ codepoints: 32768, codeUnits: 65536 });
const EXTENDED = Array.from('ÀÁÂÈÊËÍÓÔÕÚßãõğİıŒœŞşŴŵžȇ§©™®');
export function isPrivateUseSheet(sheet) { return /^glyph_(?:E[0-9A-F]|F[0-8])$/u.test(sheet); }
/** Return the exact resource-backed family, or null for a different font backend. */
export function normalizeBitmapFontType(fontType = 'default') {
  const type = String(fontType || 'default').trim().toLowerCase();
  return ['default', 'unicode', 'rune', 'smooth'].includes(type) ? type : null;
}
export function glyphAddress(character,fontType='default',remapping) {
  fontType = normalizeBitmapFontType(fontType);
  if (!fontType) return null;
  if(fontType==='smooth')return smoothGlyphAddress37(character,remapping);
  const cp=String(character).codePointAt(0); if(cp===undefined||cp>65535||(cp>=0xd800&&cp<=0xdfff))return null;
  if(fontType==='rune'&&cp>=32&&cp<=126)return {sheet:'ascii_sga',cell:cp};
  if(fontType!=='unicode'){
    if(cp>=32&&cp<=126&&cp!==124)return {sheet:'default8',cell:cp};
    const i=EXTENDED.indexOf(character);if(i>=0)return {sheet:'default8',cell:i};
  }
  return {sheet:`glyph_${(cp>>>8).toString(16).padStart(2,'0').toUpperCase()}`,cell:cp&255};
}
export function parseBedrockText(text,baseColor='#ffffff') {
  const source=String(text);
  // No valid 32,768-codepoint input can exceed 65,536 UTF-16 units. Reject
  // larger inputs before allocating one array entry for every character.
  if(source.length>BEDROCK_TEXT_LIMITS.codeUnits)throw new Error('FONT_TEXT_LIMIT');
  const chars=Array.from(source);if(chars.length>BEDROCK_TEXT_LIMITS.codepoints)throw new Error('FONT_TEXT_LIMIT');
  const output=[],diagnostics=[];let color=baseColor,bold=false,italic=false;
  for(let i=0;i<chars.length;i++){
    const ch=chars[i];
    if(ch==='§'&&i+1<chars.length){const code=chars[i+1].toLowerCase();const n='0123456789abcdef'.indexOf(code);
      if(n>=0){color=COLORS[n];i++;continue;}
      if(Object.hasOwn(MATERIAL_COLORS,code)){color=MATERIAL_COLORS[code];i++;continue;}
      if('vwxyz'.includes(code)){i++;continue;}
      if(code==='k'){if(!diagnostics.includes(code))diagnostics.push(code);i++;continue;}
      if(code==='l'){bold=true;i++;continue;}if(code==='o'){italic=true;i++;continue;}
      if(code==='r'){color=baseColor;bold=false;italic=false;i++;continue;}
      if(!diagnostics.includes(code))diagnostics.push(code);
    }
    if(ch==='\r')continue;
    output.push({character:ch,color,bold,italic});
  }
  return {characters:output,diagnostics};
}
export function compileGlyphMetrics({width,height,data},sheet) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width!==height||width<128||width>1024||width%16||data.length!==width*height*4)throw new Error('FONT_SHEET_DIMENSIONS');
  const cell=width/16,logicalCell=sheet.startsWith('glyph_')?8:8,glyphs=[];
  for(let n=0;n<256;n++){
    let minX=cell,minY=cell,maxX=-1,maxY=-1;const ox=(n%16)*cell,oy=Math.floor(n/16)*cell;
    for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)if(data[((oy+y)*width+ox+x)*4+3]>0){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    const empty=maxX<0;const advance=sheet.startsWith('glyph_')?((empty?cell:maxX-minX+1)/cell*logicalCell+1):((empty?0:maxX+1)/cell*logicalCell+1);
    const trimHorizontal=sheet.startsWith('glyph_')&&!isPrivateUseSheet(sheet)&&!empty;
    glyphs.push({cell:n,sx:ox,sy:oy,sw:cell,sh:cell,advance:sheet==='default8'&&n===32?4:advance,empty,ink:empty?null:[minX,minY,maxX+1,maxY+1],drawX:trimHorizontal?minX:0,drawW:trimHorizontal?maxX-minX+1:cell});
  }
  return {width,height,glyphs,metricsProfile:sheet.startsWith('glyph_')?'unicode-ink-advance-approximation-v1':'default8-right-edge-observed-v1'};
}
// This wrapping profile uses the same glyph advances as drawing. It is a
// bounded preview rule, not a claim of native Bedrock Japanese kinsoku parity.
function wrapBitmapLines(paragraphs, maxWidth, scale) {
  const result = [];
  const advance = item => ((item.glyph ? item.glyph.advance : item.placeholderAdvance) + (item.bold ? 1 : 0)) * scale;
  const isSpace = item => item.character === ' ' || item.character === '\t';
  const isWord = item => /[\p{Script=Latin}\p{Number}\p{Mark}_'’\u00a0]/u.test(item.character);
  for (const paragraph of paragraphs) {
    let line = { width: 0, glyphs: [] };
    result.push(line);
    const nextLine = () => { line = { width: 0, glyphs: [] }; result.push(line); };
    const append = items => {
      for (const item of items) {
        const width = advance(item);
        // A single glyph wider than maxWidth stays on one line. Splitting its
        // bitmap or repeatedly starting empty lines would corrupt or hang UI.
        if (line.glyphs.length && line.width + width > maxWidth) nextLine();
        line.glyphs.push({ ...item, x: line.width }); line.width += width;
      }
    };
    let pendingSpaces = [], pendingWidth = 0;
    for (let i = 0; i < paragraph.glyphs.length;) {
      const item = paragraph.glyphs[i];
      if (isSpace(item)) { pendingSpaces.push(item); pendingWidth += advance(item); i++; continue; }
      const token = [item]; let tokenWidth = advance(item); i++;
      if (isWord(item)) while (i < paragraph.glyphs.length && isWord(paragraph.glyphs[i])) {
        tokenWidth += advance(paragraph.glyphs[i]); token.push(paragraph.glyphs[i++]);
      }
      if (line.glyphs.length && line.width + pendingWidth + tokenWidth > maxWidth) {
        nextLine(); // Break-separating ASCII spaces do not indent the next line.
      } else append(pendingSpaces);
      pendingSpaces = []; pendingWidth = 0;
      append(token);
    }
    // Preserve authored trailing spaces which fit. Overflowing trailing
    // separators cannot create a spurious extra blank line at an auto-wrap.
    for (const item of pendingSpaces) {
      const width = advance(item);
      if (line.glyphs.length && line.width + width > maxWidth) break;
      append([item]);
    }
  }
  return result;
}
export function layoutBitmapText(text,{fontType='default',fontPx=8,color='#ffffff',linePadding=0,maxWidth,getSheet,remapping,roundingScale=1}) {
  if(!Number.isFinite(fontPx)||fontPx<=0||fontPx>4096||!Number.isFinite(linePadding)||linePadding<0||linePadding>4096)throw new Error('FONT_LAYOUT_DIMENSIONS');
  if(maxWidth!==undefined&&(!Number.isFinite(maxWidth)||maxWidth<=0))throw new Error('FONT_LAYOUT_MAX_WIDTH');
  if(!Number.isFinite(roundingScale)||roundingScale<=0||roundingScale>4096)throw new Error('FONT_LAYOUT_ROUNDING_SCALE');
  // The native glyph cell is eight logical pixels. The paired horse capture
  // confirms a 16px Unicode cell at 2x when the UI scale is 4x.
  const parsed=parseBedrockText(text,color),scale=fontPx/8;
  const smooth=normalizeBitmapFontType(fontType)==='smooth',mappingReady=!smooth||remapping instanceof Map;
  let lines=[{width:0,glyphs:[]}];const missing=new Set(),issues=[];
  let missingGlyphCount=0,loadingGlyphCount=0;
  for(const ch of parsed.characters){if(ch.character==='\n'){lines.push({width:0,glyphs:[]});continue;}
    const address=mappingReady&&glyphAddress(ch.character,fontType,remapping),sheet=address&&getSheet(address.sheet),line=lines.at(-1);
    const metricsCompatible=!smooth||sheet?.metrics?.format==='msdf';
    const glyph=metricsCompatible&&sheet?.image&&sheet?.metrics?.glyphs?.[address?.cell];
    const whitespace=/\s/u.test(ch.character);
    if(!glyph || (glyph.empty&&!whitespace)){
      // Missing one glyph must never replace an entire label with a host font.
      // Keep all available resource glyphs; mark only the unavailable character.
      // The placeholder advance is explicit and approximate until its sheet arrives.
      const loading=!mappingReady||Boolean(address&&(!sheet||['queued','loading'].includes(sheet.status)));
      const code=!mappingReady?'FONT_SMOOTH_REMAPPING_REQUIRED':!address?'FONT_CODEPOINT_UNSUPPORTED':!metricsCompatible?'FONT_SMOOTH_METRICS_REQUIRED':glyph?.empty?'FONT_GLYPH_EMPTY':loading?'FONT_GLYPH_LOADING':'FONT_GLYPH_MISSING';
      missing.add(!mappingReady?'smooth_remapping':address?.sheet||'non-bmp');missingGlyphCount++;loadingGlyphCount+=Number(loading);
      if(issues.length<32)issues.push({code,sheet:address?.sheet||null,codepoint:ch.character.codePointAt(0)});
      const advance=ch.character===' '?4:8;
      line.glyphs.push({...ch,glyph:null,sheet:null,x:line.width,placeholder:!whitespace,placeholderAdvance:advance,state:loading?'loading':'missing'});
      line.width+=(advance+(ch.bold?1:0))*scale;
      continue;
    }
    line.glyphs.push({...ch,glyph,sheet,x:line.width});line.width+=(glyph.advance+(ch.bold?1:0))*scale;
  }
  if(maxWidth!==undefined)lines=wrapBitmapLines(lines,maxWidth,scale);
  // Smooth alignment is rounded after accumulating advances, at logical UI
  // pixel granularity. Physical raster callers explicitly pass their scale.
  if(smooth)for(const line of lines){line.advanceWidth=line.width;line.width=Math.ceil(line.width/roundingScale)*roundingScale;}
  const lineHeight=(smooth?fontPx*SMOOTH_FONT_PROFILE37.lineHeightPerFontPx:fontPx)+linePadding;
  const height=smooth?fontPx*SMOOTH_FONT_PROFILE37.lineBoxPerFontPx+Math.max(0,lines.length-1)*lineHeight:lines.length*fontPx+Math.max(0,lines.length-1)*linePadding;
  return {ready:missingGlyphCount===0,drawable:true,lines,width:Math.max(0,...lines.map(l=>l.width)),height,fontPx,lineHeight,scale,diagnostics:parsed.diagnostics,missing:[...missing],missingGlyphCount,loadingGlyphCount,issues,placeholderProfile:missingGlyphCount?'diagnostic-box-per-glyph-v1':null,...(smooth?{fontType:'smooth',metricsProfile:SMOOTH_FONT_PROFILE37.id,roundingScale}:{}),...(maxWidth!==undefined?{maxWidth,wrapProfile:'glyph-advance-latin-word-v1'}:{})};
}
export function drawBitmapText(ctx,layout,{x,y,w,h,align='left',vertical='center',shadow=false}) {
  // The observed smooth profile keeps the first line at the label top when
  // a fixed/max height is shorter than its natural line box (title/close).
  // Preserve bitmap and explicit top/bottom overflow alignment contracts.
  const centerOffset=(h-layout.height)/2;
  const first=vertical.includes('top')?y:vertical.includes('bottom')?y+h-layout.height:y+(layout.fontType==='smooth'?Math.max(0,centerOffset):centerOffset);
  // The editor may fit a 16px source cell into fewer physical pixels. Nearest
  // sampling then discards entire one-pixel kanji strokes. Filter only this
  // reduction; retain the original sharp bitmap at native size and above.
  // Include the backing-store transform so a HiDPI display is not mistaken
  // for a reduction merely because CSS pixels are smaller than source pixels.
  const matrix=typeof ctx.getTransform==='function'?ctx.getTransform():null;
  const physicalScale=matrix?Math.min(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d)):1;
  const deviceScale=Number.isFinite(physicalScale)&&physicalScale>0?physicalScale:1;
  for(let li=0;li<layout.lines.length;li++){
    const line=layout.lines[li],left=align==='center'?x+(w-line.width)/2:align==='right'?x+w-line.width:x;
    for(const item of line.glyphs){const g=item.glyph;
      if(!g){
        if(item.placeholder){
          // A hollow diagnostic cell is not a substitute font or native glyph.
          // fillRect avoids browser stroke antialiasing and never calls fillText.
          const px=Math.max(0.25,layout.scale),dx=left+item.x+px,dy=first+li*(layout.lineHeight??layout.fontPx)+px;
          const width=Math.max(px,(item.placeholderAdvance-2)*layout.scale),height=6*layout.scale;
          ctx.save();ctx.fillStyle=item.color;ctx.globalAlpha*=item.state==='loading'?0.3:0.65;
          ctx.fillRect(dx,dy,width,px);ctx.fillRect(dx,dy+height-px,width,px);
          ctx.fillRect(dx,dy,px,height);ctx.fillRect(dx+width-px,dy,px,height);ctx.restore();
        }
        continue;
      }
      if(g.empty)continue;
      if(layout.fontType==='smooth'){
        const size=layout.fontPx*SMOOTH_FONT_PROFILE37.cellPerFontPx;
        const dx=left+item.x,dy=first+li*(layout.lineHeight??layout.fontPx)+layout.fontPx*SMOOTH_FONT_PROFILE37.drawOffsetPerFontPx;
        ctx.save();ctx.translate(dx,dy);if(item.italic)ctx.transform(1,0,-0.2,1,size*0.2,0);
        if(shadow){ctx.save();ctx.globalAlpha*=0.4;drawSmoothGlyph37(ctx,item.sheet,g,{color:'#000000',x:layout.scale,y:layout.scale,size,deviceScale});ctx.restore();}
        drawSmoothGlyph37(ctx,item.sheet,g,{color:item.color,x:0,y:0,size,deviceScale});
        if(item.bold)drawSmoothGlyph37(ctx,item.sheet,g,{color:item.color,x:layout.scale,y:0,size,deviceScale});
        ctx.restore();continue;
      }
      // Each cache sheet exposes bounded, reusable tinted versions.
      // Skia/browser transforms can change subpixel italic/shadow coverage
      // when an atlas is cropped. Keep the existing path for italic glyphs;
      // normal glyphs use the small-cell cache without changing their pixels.
      const cellTint=typeof item.sheet.tintedGlyph==='function'&&!item.italic;
      const image=cellTint?item.sheet.tintedGlyph(item.color,g):item.sheet.tinted(item.color),dx=left+item.x,dy=first+li*(layout.lineHeight??layout.fontPx);
      const size=8*layout.scale;
      const sourceX=(cellTint?0:g.sx)+(g.drawX||0),sourceY=cellTint?0:g.sy,sourceWidth=g.drawW??g.sw,drawWidth=size*sourceWidth/g.sw;
      ctx.save();ctx.translate(dx,dy);if(item.italic){ctx.transform(1,0,-0.2,1,size*0.2,0);}
      ctx.imageSmoothingEnabled=size*deviceScale<g.sh;
      if(ctx.imageSmoothingEnabled)ctx.imageSmoothingQuality='high';
      if(shadow){ctx.save();ctx.globalAlpha*=0.4;ctx.drawImage(cellTint?item.sheet.tintedGlyph('#000000',g):item.sheet.tinted('#000000'),sourceX,sourceY,sourceWidth,g.sh,layout.scale,layout.scale,drawWidth,size);ctx.restore();}
      ctx.drawImage(image,sourceX,sourceY,sourceWidth,g.sh,0,0,drawWidth,size);
      if(item.bold)ctx.drawImage(image,sourceX,sourceY,sourceWidth,g.sh,layout.scale,0,drawWidth,size);
      ctx.restore();
    }
  }
}
