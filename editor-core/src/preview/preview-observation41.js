/** 有限の観測履歴。可聴出力/native成功をsource.startや数値補間から推定しない。 */
const TEXT_KEYS = new Set(['kind','code','stage','interactionId','soundId','nodeId','fileId','definition','uiInstanceId','contextState','reason','filePath','codec','container']);
const NUMBER_KEYS = new Set(['elapsedMs','animationTime','frameSequence','localRevision','mockRevision','pointerId','x','y','outputGain','outputPitch','encodedBytes','decodedSampleRate','decodedDurationSeconds']);
const BOOL_KEYS = new Set(['accepted','trusted','sourceStarted','prefetch']);
export function createPreviewObservationTrace({ capacity = 128, now = () => performance.now() } = {}) {
  const limit=Number.isFinite(capacity)?Math.max(1,Math.min(128,Math.floor(capacity))):128;
  let sequence=0,dropped=0;const events=[];
  function append(input={}) {
    const stamp=now();const row={sequence:++sequence,atMs:Number.isFinite(stamp)?stamp:0};
    for(const [key,value] of Object.entries(input||{})) {
      if(TEXT_KEYS.has(key)&&typeof value==='string')row[key]=value.slice(0,key==='filePath'?512:256);
      else if(NUMBER_KEYS.has(key)&&typeof value==='number'&&Number.isFinite(value))row[key]=value;
      else if(BOOL_KEYS.has(key)&&typeof value==='boolean')row[key]=value;
    }
    events.push(row);if(events.length>limit){events.shift();dropped++;}return {...row};
  }
  function snapshot(){return {schema:'jsonui-preview-observation-v1',capacity:limit,sequence,dropped,clock:'performance_relative_ms',audibleVerified:false,nativeVerified:false,events:events.map(x=>({...x}))};}
  return {append,snapshot,clear(){events.length=0;dropped=0;}};
}

/** 押下の意味的状態を固定。animation timeのみの進行は状態変更としない。 */
export function capturePreviewInputSnapshot(context={},pointerId,targetId) {
  return Object.freeze({model:context.model,fileId:context.file?.id??'',definition:context.screenDefinition??'',uiInstanceId:context.uiInstanceId??'',mockRevision:context.state?.preview?.mockDataVersion??0,localRevision:context.localToggleState?.revision??0,pointerId,targetId:targetId==null?null:String(targetId)});
}
export function isPreviewInputContextCurrent(snapshot,context={}) {
  if(!snapshot||!context.enabled||context.pocket)return false;
  return snapshot.model===context.model && snapshot.fileId===(context.file?.id??'') && snapshot.definition===(context.screenDefinition??'') && snapshot.uiInstanceId===(context.uiInstanceId??'') && snapshot.mockRevision===(context.state?.preview?.mockDataVersion??0) && snapshot.localRevision===(context.localToggleState?.revision??0);
}
export function evaluatePreviewInputRelease(snapshot,context={},event={}) {
  let code='INPUT_RELEASE_ACCEPTED';
  if(event.cancelled)code='POINTER_CANCELLED';
  else if(!snapshot||event.pointerId!==snapshot.pointerId)code='POINTER_ID_MISMATCH';
  else if(event.moved)code='POINTER_DRAG';
  else if(!context.enabled)code='FRAME_NOT_READY';
  else if(context.pocket)code='POCKET_PREVIEW_DISABLED';
  else if(!isPreviewInputContextCurrent(snapshot,context))code='INPUT_CONTEXT_CHANGED';
  else if(snapshot.targetId==null || String(event.hitId??'')!==snapshot.targetId)code='POINTER_TARGET_CHANGED';
  return {accepted:code==='INPUT_RELEASE_ACCEPTED',code};
}
