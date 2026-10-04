import { createNodeRequestLog35 } from '../diagnostics/node-request-log35.js';
const requestLog35 = createNodeRequestLog35();
export const getNodeRequestLog35 = () => requestLog35.snapshot();
import { createFrameDeltaClient } from './frame-delta-client.js';
import { workspaceExportError } from '../ui/workspace-export-report.js';
import { createNodeReadQueue, waitForNodeReadRetry } from './node-read-queue.js';
// Browser adapter. ZIP bytes are streamed by fetch; parsing, decompression and
// composition run in the local Node process. Static hosting keeps its old path.
let capabilityPromise = null;
let capabilityEpoch = 0;
const cleanupIds = new Set();
const activeIds = new Set();
let currentToken = null;
const nodeReadQueue = createNodeReadQueue();
if(typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('pagehide',event=>{
  // BFCache retains this document and its pack readers for pageshow.
  if(event?.persisted||!currentToken)return;
  for(const id of new Set([...activeIds,...cleanupIds]))fetch('/api/node/packs/'+id,{method:'DELETE',keepalive:true,headers:{'X-JSONUI-Token':currentToken}}).catch(()=>{});
});
async function capabilities() {
  if (typeof window === 'undefined') return null;
  if (!capabilityPromise) {
    const epoch=++capabilityEpoch;
    capabilityPromise = (async () => {
    const response = await fetch('/api/node/capabilities', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      if (response.ok || [404,405].includes(response.status)) return null;
      throw new Error(`NODE_CAPABILITY_HTTP_${response.status}`);
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `NODE_CAPABILITY_HTTP_${response.status}`);
    if (data.protocol !== 'jsonui-node/v1' || typeof data.token !== 'string') throw new Error('NODE_CAPABILITY_INVALID');
    if(epoch===capabilityEpoch)currentToken=data.token;
    return data;
    })().catch(error => { if(epoch===capabilityEpoch)capabilityPromise = null; throw error; });
  }
  return capabilityPromise;
}
async function request(route, { method='GET', data, signal, blob, headers={} } = {}, retry=true) {
  const cap=await capabilities();if(!cap)throw new Error('NODE_BACKEND_UNAVAILABLE');
  const observation = requestLog35.begin(route, method);
  let response;
  try {
    response=await fetch('/api/node/'+route,{method,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000),
      cache:'no-store',headers:{'X-JSONUI-Token':cap.token,...(data!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:blob??(data!==undefined?JSON.stringify(data):undefined)});
    if(!response.ok){const error=await response.json().catch(()=>({error:`NODE_HTTP_${response.status}`}));
      requestLog35.end(observation, { status: response.status, correlationId: response.headers?.get?.('x-jsonui-request-id') || '', code: error.error || `NODE_HTTP_${response.status}` });
      if(response.status===401&&error.error==='NODE_TOKEN_REJECTED'&&retry){if(cap.token===currentToken){capabilityEpoch++;capabilityPromise=null;}return request(route,{method,data,signal,blob,headers},false);}
      throw Object.assign(new Error(error.error||`NODE_HTTP_${response.status}`),{status:response.status,code:error.error,
        ...(Array.isArray(error.candidates) ? { addonCandidates: error.candidates.slice(0,32) } : {}),
        correlation_id:response.headers?.get?.('x-jsonui-request-id')||undefined});
    }
    requestLog35.end(observation, { status: response.status, correlationId: response.headers?.get?.('x-jsonui-request-id') || '' });
  } catch (error) {
    requestLog35.end(observation, { status: response?.status || 0, code: error?.name === 'TimeoutError' ? 'NODE_REQUEST_TIMEOUT' : error?.code || 'NODE_REQUEST_FAILED', cancelled: Boolean(signal?.aborted) });
    throw error;
  }
  return response;
}
async function json(route,options){return (await request(route,options)).json();}
async function cleanup(){for(const id of [...cleanupIds]){await json('packs/'+id,{method:'DELETE'});cleanupIds.delete(id);}}
export class NodeRemoteReader {
  constructor(metadata){this.nodePackId=metadata.id;activeIds.add(metadata.id);this.fileName=metadata.zipMeta.fileName;this.closed=false;this.readAbort=new AbortController();this.entryIndex=new Map(metadata.entries.map(info=>[info.path,{info}]));}
  async readBlob(path,options={}){
    if(this.closed)throw new Error('ZIP_CLOSED');
    const cap=options.maxBytes??64*1024*1024;
    const entry=this.entryIndex.get(path)?.info;
    if(!entry)throw new Error('ZIP_ENTRY_NOT_FOUND');
    if(entry.uncompressedSize>cap)throw new Error('ZIP_ENTRY_READ_LIMIT');
    return this.readRemoteBlob('read',path,cap,options);
  }
  async readPreviewImageBlob(path,options={}){
    if(!/\.tga$/iu.test(path))return this.readBlob(path,options);
    if(this.closed)throw new Error('ZIP_CLOSED');
    const cap=options.maxBytes??64*1024*1024,entry=this.entryIndex.get(path)?.info;
    if(!entry)throw new Error('ZIP_ENTRY_NOT_FOUND');
    if(entry.uncompressedSize>cap)throw new Error('ZIP_ENTRY_READ_LIMIT');
    return this.readRemoteBlob('preview-image',path,cap,{...options,mimeType:'image/png'});
  }
  async readRemoteBlob(route,path,cap,options){
    const signal=AbortSignal.any([this.readAbort.signal,AbortSignal.timeout(300000),...(options.signal?[options.signal]:[])]);
    return nodeReadQueue.run(async()=>{
      for(let attempt=0;;attempt++){
        signal.throwIfAborted();
        try{
          const response=await request(`packs/${this.nodePackId}/${route}?${new URLSearchParams({path,maxBytes:String(cap)})}`,{signal});
          const bytes=await response.arrayBuffer();
          signal.throwIfAborted();
          return new Blob([bytes],{type:options.mimeType||''});
        }catch(error){
          signal.throwIfAborted();
          // 他タブとの競合のみ短い有限再試行。破損・容量超過等は再試行しない。
          if(error.status!==429||error.code!=='NODE_READ_BUSY'||attempt>=2)throw error;
          await waitForNodeReadRetry(attempt===0?100:250,signal);
        }
      }
    },{signal});
  }
  async readText(path,options={}){const blob=await this.readBlob(path,{...options,maxBytes:options.maxBytes??8*1024*1024});return new TextDecoder(options.encoding||'utf-8',{fatal:true,ignoreBOM:true}).decode(await blob.arrayBuffer());}
  async listAllFilePaths(){return [...this.entryIndex].filter(([,v])=>!v.info.directory).map(([p])=>p);}
  async close(){if(this.closed)return;this.closed=true;this.readAbort.abort(new Error('ZIP_CLOSED'));activeIds.delete(this.nodePackId);cleanupIds.add(this.nodePackId);this.entryIndex.clear();await cleanup();}
}
export async function tryNodeImport(file,options={}) {
  if(!(await capabilities()))return null;
  await cleanup();
  const id=crypto.randomUUID();
  try{
    options.onProgress?.({phase:'node-upload',processed:0,total:file.size,zipBytes:file.size});
    const metadata=await json('packs',{method:'POST',blob:file,signal:options.signal,headers:{'X-JSONUI-Name':encodeURIComponent(file.name),'X-JSONUI-Upload-ID':id,
      ...(options.resourcePack ? {'X-JSONUI-Resource-Pack':options.resourcePack} : {})}});
    if(options.signal?.aborted)throw new Error('PACK_ABORTED');
    const zipReader=new NodeRemoteReader(metadata);delete metadata.entries;
    options.onProgress?.({phase:'complete',processed:metadata.zipMeta.entryCount,total:metadata.zipMeta.entryCount,zipBytes:file.size});
    return {...metadata,zipReader};
  }catch(error){cleanupIds.add(id);try{await cleanup();}catch{}throw error;}
}
export async function buildNodeCatalog(imported,vanilla,signal){
  const sources=[];
  for(const [kind,runtime] of [['vanilla',vanilla],['imported',imported]]){
    if(!runtime)continue;
    if(!runtime.zipReader?.nodePackId)return null;
    sources.push({kind,id:runtime.zipReader.nodePackId,overrides:runtime.overridesTextByPackPath||{}});
  }
  if(!sources.length)return null;
  const result=await json('catalog',{method:'POST',data:{sources},signal});
  result.recordsById=Object.fromEntries(result.records.map(r=>[r.id,r]));
  result.filesById=Object.fromEntries(result.files.map(r=>[r.id,r]));
  return result;
}
export async function resolveNodeUi(options,signal){return json('project',{method:'POST',data:{catalogId:options.catalog.nodeCatalogId,recordId:options.recordId,variables:options.variables,representativeCollections:options.representativeCollections,eventFactorySelections:options.eventFactorySelections},signal});}
export async function hydrateNodeCatalog(catalog,signal){
  if(!catalog.nodeCatalogId||catalog.nodeHydrated)return;
  const values=[];
  for(let offset=0;offset<catalog.records.length;offset+=32)values.push(...await json('hydrate',{method:'POST',data:{catalogId:catalog.nodeCatalogId,offset},signal}));
  for(const row of values){if(catalog.recordsById[row.id])catalog.recordsById[row.id].value=row.value;}
  catalog.nodeHydrated=true;
}
export async function nodeAssetIndex(reader,signal){const wire=await json(`packs/${reader.nodePackId}/assets`,{signal});return Object.fromEntries(Object.entries(wire).map(([k,v])=>[k,{...v,byLower:new Map(v.byLower)}]));}
export async function nodeItemIconIndex(source, signal) {
  const deadline = AbortSignal.timeout(20_000);
  return json('item-icons', { method: 'POST', data: { source }, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
}
export async function nodeHorsePreview(sources,targetEngineVersion,signal,options={}){return json('horse',{method:'POST',signal,data:{targetEngineVersion,previewState:options.previewState,camera:options.camera,sources:sources.map(x=>({kind:x.source,id:x.runtime.zipReader.nodePackId,overrides:x.runtime.overridesTextByPackPath||{}}))}});}
export async function nodeFontSheet(data,signal){
  const response=await request('font',{method:'POST',data,signal}),limit=12*1024*1024;
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new Error('FONT_RESPONSE_BYTE_LIMIT');}
  if(!response.body)throw new Error('FONT_RESPONSE_BODY_REQUIRED');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
  try{
    for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
      if(bytes>limit){await reader.cancel();throw new Error('FONT_RESPONSE_BYTE_LIMIT');}
      text+=decoder.decode(part.value,{stream:true});
    }
    text+=decoder.decode();return JSON.parse(text);
  }catch(error){await reader.cancel().catch(()=>{});throw error;
  }finally{reader.releaseLock();}
}
export async function nodeFontCoverage(data,signal){return json('font-coverage',{method:'POST',data,signal});}
export async function nodeLangTable(data,signal){return json('lang',{method:'POST',data,signal});}
export async function supportsNodeFrameIr(){return Boolean((await capabilities())?.features?.frameIr);}
const frameDeltaClient = createFrameDeltaClient((data, signal) => json('frame', { method: 'POST', data, signal }));
export function nodeFrameTransportStats() { return frameDeltaClient.snapshot(); }
export async function renderNodeFrame(data,signal){
  const deadline=AbortSignal.timeout(30000);
  return frameDeltaClient.render(data,signal?AbortSignal.any([signal,deadline]):deadline);
}
/** One local download contains browser context plus bounded Node/launcher diagnostics. */
export async function downloadNodeDebugBundle(payload, signal) {
  const deadline=AbortSignal.timeout(20000);
  const response=await request('debug-bundle',{method:'POST',data:payload,signal:signal?AbortSignal.any([signal,deadline]):deadline});
  return response.blob();
}

export async function nodeValidatePreview(data, signal) { return json('validate', { method: 'POST', data, signal }); }
export async function nodePlayerPreview(sources, targetEngineVersion, signal, options = {}) {
  return json('player', {method:'POST', signal, data:{targetEngineVersion, camera:options.camera,
    sources:sources.map(x=>({kind:x.source,id:x.runtime.zipReader.nodePackId,overrides:x.runtime.overridesTextByPackPath||{}}))}});
}

// Sound metadata and bytes share the existing header authentication. No media credentials in URLs.
export function nodeAudioSessionEpoch() { return capabilityEpoch; }
export async function resolveNodeSound(data, signal) {
  const deadline = AbortSignal.timeout(5000);
  return json('sound-resolve', { method: 'POST', data, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
}
export async function readNodeSoundBytes(sound, signal) {
  if (!['jsonui-sound-v1', 'jsonui-sound-v2'].includes(sound?.schema) || !/^[0-9a-f-]{36}$/u.test(sound.filePackId)
    || typeof sound.readPath !== 'string' || !Number.isSafeInteger(sound.encodedBytes) || sound.encodedBytes < 1 || sound.encodedBytes > 4 * 1024 * 1024) throw new Error('AUDIO_METADATA_INVALID');
  const deadline = AbortSignal.timeout(5000), combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  return nodeReadQueue.run(async () => {
    const response = await request(`packs/${sound.filePackId}/read?${new URLSearchParams({ path: sound.readPath, maxBytes: String(sound.encodedBytes) })}`, { signal: combined });
    const bytes = await response.arrayBuffer();
    combined.throwIfAborted();
    if (bytes.byteLength !== sound.encodedBytes) throw new Error('AUDIO_BYTES_MISMATCH');
    return bytes;
  }, { signal: combined });
}

/** 原文編集と依存書出しは既存の同一オリジン認証を共有する。 */
export async function nodeWorkspaceRequest(operation, data, options = {}) {
  if (!['open', 'close', 'read', 'edit', 'undo', 'redo', 'status', 'catalog', 'export', 'preview-draft'].includes(operation)) throw new Error('WORKSPACE_OPERATION_INVALID');
  // Batch computation has a separate finite Worker/socket lease. Keep the
  // browser deadline outside both, while caller cancellation still wins.
  const isBatch = ['edit', 'preview-draft'].includes(operation) && data?.operation?.type === 'batch';
  const deadline = AbortSignal.timeout(isBatch ? 300000 : 60000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const started = Date.now(), observe = typeof options.onProgress === 'function' ? options.onProgress : null;
  const progressId = observe ? crypto.randomUUID() : undefined;
  const observer = new AbortController();
  let timer = null, observed = null;
  const emit = value => { try { observe?.(value); } catch { /* Presentation cannot invalidate a committed request. */ } };
  async function poll() {
    if (observer.signal.aborted || signal.aborted) return;
    try {
      const progress = await json(`progress?${new URLSearchParams({ progressId })}`, {
        signal: AbortSignal.any([observer.signal, signal, AbortSignal.timeout(3000)]) });
      if (observer.signal.aborted) return;
      if (progress.job) observed = progress.job;
      emit({ ...(observed || { status: 'queued', phase: 'queued', percent: null }),
        observed_at: progress.observed_at, processor_dead: progress.processor_dead,
        elapsed_ms: Date.now() - started });
    } catch (error) {
      if (!observer.signal.aborted && !signal.aborted) emit({ ...(observed || { status: 'queued', phase: 'queued', percent: null }),
        observationError: String(error?.code || error?.message || 'NODE_PROGRESS_FAILED').slice(0, 120), elapsed_ms: Date.now() - started });
    } finally { if (!observer.signal.aborted && !signal.aborted) timer = setTimeout(() => void poll(), 500); }
  }
  if (observe) {
    emit({ status: 'queued', phase: 'queued', completed: null, total: null, percent: null, elapsed_ms: 0 });
    timer = setTimeout(() => void poll(), 250);
  }
  let response;
  try {
    response = await request(`workspace-${operation}`, { method: 'POST', data: progressId ? { ...data, progressId } : data, signal });
    emit({ status: 'receiving', phase: 'response-received', completed: null, total: null, percent: null,
      elapsed_ms: Date.now() - started, correlation_id: response.headers?.get?.('x-jsonui-request-id') });
  } finally { observer.abort(); clearTimeout(timer); }

  if (options.blob) {
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      const result = await response.json();
      throw workspaceExportError(result, response.headers?.get?.('x-jsonui-request-id'));
    }
    const blob = await response.blob();
    emit({ status: 'complete', phase: 'complete', completed: 1, total: 1, percent: 100, elapsed_ms: Date.now() - started });
    return blob;
  }
  const result = await response.json();
  emit({ status: result?.ok === false ? 'error' : 'complete', phase: 'complete',
    completed: result?.ok === false ? null : 1, total: result?.ok === false ? null : 1,
    percent: result?.ok === false ? null : 100, elapsed_ms: Date.now() - started });
  return result;
}
