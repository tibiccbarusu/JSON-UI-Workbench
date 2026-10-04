// Nodeで解析済みのcmap範囲だけを消費する。SFNT解析はブラウザで行わない。
export function fontCoverageContains(coverage,codepoint){
  if(!coverage?.supported)return null;
  const ranges=coverage.coverageRanges;let low=0,high=ranges.length-1;
  while(low<=high){const middle=(low+high)>>>1,range=ranges[middle];if(codepoint<range[0])high=middle-1;else if(codepoint>range[1])low=middle+1;else return true;}
  return false;
}
export function splitFontCoverageRuns(text,coverage){
  const characters=Array.from(String(text));if(characters.length>32768)throw new Error('FONT_TEXT_LIMIT');
  const runs=[],missingCodepoints=new Set();let missingGlyphCount=0;
  for(const character of characters){
    const missing=fontCoverageContains(coverage,character.codePointAt(0))===false;
    if(missing){missingGlyphCount++;if(missingCodepoints.size<32)missingCodepoints.add(character.codePointAt(0));}
    const last=runs.at(-1);if(last&&last.missing===missing)last.text+=character;else runs.push({text:character,missing});
  }
  return {runs,missingGlyphCount,missingCodepoints:[...missingCodepoints],coverageVerified:coverage?.supported===true};
}
export function measureCoveredFontLine(ctx,text,coverage,fontPx){
  const result=splitFontCoverageRuns(text,coverage);let width=0;
  for(const run of result.runs){run.x=width;run.width=run.missing?Array.from(run.text).length*fontPx:ctx.measureText(run.text).width;width+=run.width;}
  return {...result,width};
}
export function drawCoveredFontLine(ctx,text,coverage,{x,y,fontPx,align='left'}){
  // Unknown containers remain explicitly unverified in caller diagnostics.
  // A verified cmap never passes an absent character to fillText.
  if(!coverage?.supported){ctx.fillText(text,x,y);return;}
  const line=measureCoveredFontLine(ctx,text,coverage,fontPx),left=align==='center'?x-line.width/2:align==='right'?x-line.width:x;
  ctx.save();ctx.textAlign='left';
  for(const run of line.runs){
    if(!run.missing){ctx.fillText(run.text,left+run.x,y);continue;}
    const px=fontPx/8,characterCount=Array.from(run.text).length;
    for(let i=0;i<characterCount;i++){
      const dx=left+run.x+i*fontPx+px,dy=y-fontPx/2+px,w=fontPx-2*px,h=fontPx-2*px;
      ctx.fillRect(dx,dy,w,px);ctx.fillRect(dx,dy+h-px,w,px);ctx.fillRect(dx,dy,px,h);ctx.fillRect(dx+w-px,dy,px,h);
    }
  }
  ctx.restore();
}
