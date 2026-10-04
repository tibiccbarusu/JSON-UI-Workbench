import { consoleText, normalizeLanguage } from './console-i18n.mjs';
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, open, rm, stat, realpath } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Processor } from './worker-client.mjs';
import { LIMITS, fail, boundedInteger } from './limits.mjs';
import { publicErrorCode } from './public-error.mjs';
import { DEBUG_LIMITS, createEventJournal, validateDebugRequest, sanitizeDiagnostic, readLauncherLog, readBootstrapLog, readServerLogs } from './debug-bundle.mjs';
import { createServerLog } from './server-log33.mjs';
import { AUDIO_LIMITS } from './audio-preflight.mjs';
import { summarizeWorkspaceOperation } from './workspace-operation-summary.mjs';
import { decodeUploadName } from './upload-name.mjs';
import { checkedAddonSelection, publicAddonCandidates } from './addon-resource38.mjs';
const editorRoot = fileURLToPath(new URL('../editor-core/',import.meta.url));
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2','.ttf':'font/ttf' };
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' https://raw.githubusercontent.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const observableRoutes = new Set(['capabilities','progress','sound-resolve','debug-bundle','packs','catalog','project','frame','validate','hydrate','horse','player','item-icons','font','font-coverage','lang',
  'workspace-open','workspace-read','workspace-status','workspace-edit','workspace-undo','workspace-redo','workspace-catalog','workspace-export','workspace-close','workspace-preview-draft'].map(name=>'/api/node/'+name));
function meter(limit) { let total=0; return new Transform({transform(chunk,_e,cb){total+=chunk.length;cb(total>limit?Object.assign(new Error('NODE_BODY_LIMIT'),{status:413}):null,chunk);}}); }
async function body(req, limit = LIMITS.jsonBytes) {
  if (Number(req.headers['content-length']) > limit) fail('NODE_BODY_LIMIT',413);
  const chunks=[];
  await pipeline(req,meter(limit),new Writable({write(chunk,_enc,cb){chunks.push(chunk);cb();}}),{signal:AbortSignal.timeout(30000)});
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('NODE_JSON_INVALID');}
}
function sameSecret(got,expected){ if(typeof got!=='string')return false;const a=Buffer.from(got),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b); }

export async function createLocalServer({host='127.0.0.1',port=3210,cacheParent=tmpdir(),logDirectory,serveGui=true,keepPacksAlive=false}={}) {
  if (!['127.0.0.1','::1'].includes(host)) fail('NODE_LOOPBACK_REQUIRED');
  if (!Number.isInteger(port)||port<0||port>65535) fail('NODE_PORT_INVALID');
  if (typeof serveGui !== 'boolean') fail('NODE_GUI_OPTION_INVALID');
  if (typeof keepPacksAlive !== 'boolean') fail('NODE_PACK_LIFETIME_OPTION_INVALID');
  const root = await mkdtemp(path.join(cacheParent,'jsonui-node-'));
  await mkdir(path.join(root,'packs'),{mode:0o700});
  let processor=new Processor(), token=randomBytes(32).toString('hex'), recovery=null;
  const packs=new Map();
  const bootedAt = new Date().toISOString(), runId = randomUUID();
  const serverLog = createServerLog(logDirectory, { secrets: () => [token] });
  const journalOptions = { runId, secrets: () => [token], onRecord: event => serverLog.record(event) };
  const journal = createEventJournal(500, journalOptions), workspaceJournal = createEventJournal(500, journalOptions);
  journal.record('NODE_SERVER_STARTING', { node_version: process.versions.node, platform: process.platform, arch: process.arch });
  let active=0,uploads=0,diskBytes=0,outboundBytes=0,readReservations=0,soundReservations=0,stopping=false; const sockets=new Set();
  async function recoverProcessor(){
    if(!processor.dead)return;
    if(!recovery)recovery=(async()=>{
      await processor.close();
      for(const record of packs.values())if(record.pending)record.abort.abort();
      await Promise.all([...packs.values()].filter(r=>r.pending).map(r=>r.settled));
      for(const record of packs.values())await rm(record.file,{force:true});
      packs.clear();diskBytes=0;processor=new Processor();token=randomBytes(32).toString('hex');
      journal.record('NODE_PROCESSOR_RECOVERED', {action:'パックを再読込してください。'}, {severity:'WARN',outcome:'partial'});
    })().finally(()=>{recovery=null;});
    await recovery;
  }
  const server=http.createServer({maxHeaderSize:16384,requestTimeout:LIMITS.uploadMs,headersTimeout:30000},async(req,res)=>{
    const started=performance.now(), requestId=randomUUID(); let route='unclassified', errorCode=null, workspaceContext=null;
    let requestStage='accepting', failureStage=null, responseBytes=0, workerCalls=0, workerWaitMs=0;
    const callProcessor = async (action, payload, timeout, options = {}) => {
      requestStage='processing'; workerCalls++;
      const began=performance.now();
      try { return await processor.call(action,payload,timeout,{...options,correlationId:requestId}); }
      finally { workerWaitMs+=performance.now()-began; }
    };
    const requestAbort = new AbortController();
    res.once('close',()=>{if(!res.writableFinished)requestAbort.abort();});
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',csp);
    res.setHeader('X-JSONUI-Request-ID',requestId);
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    active++;
    try {
      if(stopping||active>LIMITS.requests)fail('NODE_BUSY',429);
      const actualPort=server.address().port;
      const hosts=[`127.0.0.1:${actualPort}`,`localhost:${actualPort}`,`[::1]:${actualPort}`];
      if(!hosts.includes(req.headers.host))fail('NODE_HOST_REJECTED',403);
      const origin=`http://${req.headers.host}`;
      if(req.headers.origin && req.headers.origin!==origin)fail('NODE_ORIGIN_REJECTED',403);
      if(req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))fail('NODE_FETCH_SITE_REJECTED',403);
      const url=new URL(req.url,origin);
      // Browsers may request this even without an icon link. No icon is
      // configured; acknowledge that without reporting a product failure.
      if(url.pathname==='/favicon.ico' && ['GET','HEAD'].includes(req.method)){
        res.statusCode=204;res.end();return;
      }
      route=url.pathname.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gu,':pack');
      // Unknown user-controlled route text and all query values are not log data.
      if (!observableRoutes.has(route) && !/^\/api\/node\/packs\/:pack(?:\/(?:read|assets|preview-image))?$/u.test(route)) route=url.pathname.startsWith('/api/')?'/api/[unmatched]':'static';
      if (route.startsWith('/api/') && !['/api/node/progress','/api/node/capabilities'].includes(route)) {
        journal.record('NODE_HTTP_STARTED',{route,http_method:req.method,active_requests:active,processor_pending:processor.pending},{correlation_id:requestId});
      }
      requestStage='receiving';
      // Export remains available during worker failure and must not discard the failed state.
      if(!['/api/node/debug-bundle','/api/node/progress'].includes(url.pathname))await recoverProcessor();
      const send = async value => {
        requestStage='sending';
        // The socket may have closed while a non-interruptible import finished.
        // Its close event has already fired; attaching a new listener would
        // otherwise retain the upload until the 30-second send timer expires.
        if (res.destroyed || requestAbort.signal.aborted) throw Object.assign(new Error('NODE_RESPONSE_CLOSED'), { status: 499 });
        const size = typeof value.body === 'string' ? Buffer.byteLength(value.body) : value.body.byteLength;
        responseBytes=size;
        if (outboundBytes + size > 128 * 1024 * 1024) fail('NODE_RESPONSE_BUDGET', 429);
        outboundBytes += size;
        try {
          res.setHeader('Content-Type',value.kind==='bytes'?(['image/png','application/zip'].includes(value.mimeType)?value.mimeType:'application/octet-stream'):'application/json; charset=utf-8');
          if (value.mimeType === 'application/zip') res.setHeader('Content-Disposition', 'attachment; filename="selected-ui.mcpack"');
          await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{res.destroy();reject(Object.assign(new Error('NODE_RESPONSE_TIMEOUT'),{status:504}));},30000);
            const clean=()=>{clearTimeout(timer);res.off('finish',done);res.off('close',closed);res.off('error',error);};
            const done=()=>{clean();resolve();};
            const error=err=>{clean();reject(err);};
            const closed=()=>res.writableFinished?done():error(Object.assign(new Error('NODE_RESPONSE_CLOSED'),{status:499}));
            res.once('finish',done);res.once('close',closed);res.once('error',error);res.end(value.body);
          });
        } finally { outboundBytes -= size; }
      };
      if(url.pathname==='/api/node/capabilities' && req.method==='GET'){await send({kind:'json',body:JSON.stringify({protocol:'jsonui-node/v1',token,limits:LIMITS,features:{debugBundle:true,projectionCache:true,frameIr:true,validation:true,shortOggAudio:true,shortWavAudio:true,audioFormats:["ogg-vorbis","wav-pcm-s16le"],localToggleState:true,bindingQuality:true,workspaceEditing:true,dependencyExport:true,workspaceProgress:true}})});return;}
      if(url.pathname.startsWith('/api/')){
        if(!sameSecret(req.headers['x-jsonui-token'],token))fail('NODE_TOKEN_REJECTED',401);
        if(url.pathname==='/api/node/progress' && req.method==='GET'){
          const progressId=url.searchParams.get('progressId');
          if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(progressId||''))fail('NODE_PROGRESS_ID_INVALID',422);
          // This observation does not join the CPU queue. A live HTTP reply
          // proves the server responded; last_progress_at proves Worker work.
          const snapshot=processor.snapshot(), job=snapshot.active_jobs.find(item=>item.progress_id===progressId);
          await send({kind:'json',body:JSON.stringify({schema:'jsonui-job-progress-v1',ok:true,
            observed_at:new Date().toISOString(),processor_dead:snapshot.dead,pending:snapshot.pending,
            job:job?{action:job.action,status:job.state,correlation_id:job.correlation_id,
              elapsed_ms:job.elapsed_ms,queue_ms:job.queue_ms,work_ms:job.work_ms,
              phase:job.progress?.phase||'queued',completed:job.progress?.completed??null,
              total:job.progress?.total??null,percent:job.progress?.percent??null,
              last_progress_at:job.progress?.updated_at||null,progress_age_ms:job.progress_age_ms,
              cancel_requested:job.cancel_requested===true}:null})});return;
        }
        if(url.pathname==='/api/node/sound-resolve' && req.method==='POST'){
          if(!/^application\/json(?:\s*;|$)/iu.test(String(req.headers['content-type']||'')))fail('NODE_JSON_CONTENT_TYPE',415);
          if(soundReservations>=1||processor.pending>=2)fail('AUDIO_PREPARE_BUSY',429);
          soundReservations++;
          try{
            const input=await body(req,4096);
            if(!input||typeof input!=='object'||Array.isArray(input))fail('NODE_REQUEST_OBJECT_REQUIRED');
            if(Object.keys(input).some(key=>!['catalogId','soundId','selectionSeed','contextSampleRate'].includes(key)))fail('AUDIO_REQUEST_INVALID');
            for(const record of packs.values())if(!record.pending)record.touched=Date.now();
            await send(await callProcessor('sound-resolve',input,AUDIO_LIMITS.jobMs,{signal:requestAbort.signal,correlationId:requestId}));
          }finally{soundReservations--;}
          return;
        }
        if(url.pathname==='/api/node/debug-bundle' && req.method==='POST'){
          if(!/^application\/json(?:\s*;|$)/iu.test(String(req.headers['content-type']||'')))fail('NODE_JSON_CONTENT_TYPE',415);
          const client=validateDebugRequest(await body(req,DEBUG_LIMITS.requestBytes),{secrets:[token]});
          journal.record('NODE_DEBUG_BUNDLE_EXPORTED',{}, {correlation_id:requestId});
          const persistence=await serverLog.flush();
          const [launcher,bootstrap,serverLogs]=await Promise.all([
            readLauncherLog(logDirectory,{secrets:[token]}),readBootstrapLog(logDirectory,{secrets:[token]}),readServerLogs(logDirectory,{secrets:[token]}),
          ]);
          // Reserve independent budgets for browser and server evidence, so a verbose
          // browser payload cannot crowd the Node failure record out of the export.
          const safeServer=sanitizeDiagnostic({run_id:runId,booted_at:bootedAt,runtime:{node:process.versions.node,platform:process.platform,arch:process.arch,uptime_seconds:Math.floor(process.uptime()),memory:process.memoryUsage()},
              activity:{active_requests:active,uploads,disk_bytes:diskBytes,outbound_bytes:outboundBytes,read_reservations:readReservations},
              packs:[...packs].map(([id,r])=>({id,size_bytes:r.size,pending:r.pending,name:r.name||null,entry_count:r.entryCount??null})),
              processor:processor.snapshot(),journal:journal.snapshot(),workspace_journal:workspaceJournal.snapshot(),launcher,bootstrap,
              persisted_logs:serverLogs,log_persistence:persistence},{secrets:[token]});
          const bundle={schema:'jsonui-debug-bundle-v1',created_at:new Date().toISOString(),
            privacy:{local_download_only:true,pack_contents_included:false,native_paths_redacted:true,api_credentials_redacted:true,coverage:'bounded_recent_events'},
            client,server:safeServer.data,export_sanitization:safeServer.summary};
          res.setHeader('Content-Disposition',`attachment; filename="jsonui-debug-${new Date().toISOString().replace(/[:.]/gu,'-')}.json"`);
          const serialized=JSON.stringify(bundle,null,2);if(Buffer.byteLength(serialized)>4*1024*1024)fail('NODE_DEBUG_REPLY_LIMIT',413);
          await send({kind:'json',body:serialized});return;
        }
        if(url.pathname==='/api/node/packs' && req.method==='POST'){
          const media=String(req.headers['content-type']||'').split(';',1)[0].trim().toLowerCase();
          if(!['','application/zip','application/x-zip-compressed','application/octet-stream'].includes(media))fail('NODE_ZIP_CONTENT_TYPE',415);
          // Reject unsupported containers before reserving disk or receiving
          // a large body. The name remains display data; UUID chooses the path.
          const name=decodeUploadName(req.headers['x-jsonui-name']);
          const resourcePack=checkedAddonSelection(req.headers['x-jsonui-resource-pack']);
          if(resourcePack&&!/\.mcaddon$/iu.test(name))fail('ADDON_RESOURCE_SELECTOR_NOT_APPLICABLE');
          if(uploads>=2||packs.size>=LIMITS.packs)fail('NODE_PACK_LIMIT',429);
          const length=Number(req.headers['content-length']);
          if(!Number.isSafeInteger(length)||length<22||length>LIMITS.zipBytes)fail('NODE_UPLOAD_LENGTH_REQUIRED',413);
          if(diskBytes+length>LIMITS.diskBytes)fail('NODE_DISK_BUDGET',413);
          const id=req.headers['x-jsonui-upload-id'];
          if(typeof id!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(id)||packs.has(id))fail('NODE_UPLOAD_ID_INVALID',409);
          const file=path.join(root,'packs',id+'.zip');
          uploads++;diskBytes+=length;
          const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),LIMITS.uploadMs);
          req.once('aborted',()=>abort.abort());
          let settle;
          const record={file,size:length,touched:Date.now(),abort,pending:true,settled:new Promise(resolve=>{settle=resolve;})};
          packs.set(id,record);
          let registered=false;
          try{
            await pipeline(req,meter(length),createWriteStream(file,{flags:'wx',mode:0o600}),{signal:abort.signal});
            // Receiving remains subject to the upload/idle limits above. Once
            // the body is complete, the socket must outlive the finite Worker
            // lease and its bounded response send, including on slower disks.
            res.setTimeout(LIMITS.jobMs+30000);
            const info=await stat(file);if(info.size!==length)fail('NODE_UPLOAD_TRUNCATED');
            const result=await callProcessor('import',{id,path:file,name,size:length,resourcePack},LIMITS.jobMs,{correlationId:requestId});
            registered=true;
            record.name=name;record.entryCount=result.packSummary?.entryCount??null;
            if(abort.signal.aborted){await callProcessor('remove',{id});fail('NODE_UPLOAD_CANCELLED',409);}
            record.pending=false;await send(result);
          }catch(error){
            if(registered&&!processor.dead){try{await callProcessor('remove',{id});}catch{await processor.close();}}
            if(packs.get(id)===record){diskBytes-=length;packs.delete(id);}
            await rm(file,{force:true});throw error;
          }finally{clearTimeout(timer);uploads--;settle();}
          return;
        }
        const match=url.pathname.match(/^\/api\/node\/packs\/([0-9a-f-]{36})(?:\/(read|assets|preview-image))?$/u);
        if(match){const id=match[1],record=packs.get(id);
          if(req.method==='DELETE'&&!match[2]){
            if(record?.pending){record.abort.abort();await record.settled;}
            await callProcessor('remove',{id});
            const remaining=packs.get(id);if(remaining){await rm(remaining.file,{force:true});diskBytes-=remaining.size;packs.delete(id);}
            await send({kind:'json',body:'{"ok":true}'});return;
          }
          if(!record||record.closing)fail('NODE_PACK_NOT_FOUND',404);if(record.pending)fail('NODE_PACK_LOADING',409);record.touched=Date.now();
          if(req.method==='GET'&&['read','preview-image'].includes(match[2])){
            if(readReservations>=4)fail('NODE_READ_BUSY',429);readReservations++;
            try{await send(await callProcessor(match[2],{id,path:url.searchParams.get('path'),maxBytes:boundedInteger(url.searchParams.has('maxBytes')?url.searchParams.get('maxBytes'):undefined,LIMITS.entryBytes,LIMITS.entryBytes)},LIMITS.jobMs,{signal:requestAbort.signal,correlationId:requestId}));}
            finally{readReservations--;}return;
          }
          if(req.method==='GET'&&match[2]==='assets'){await send(await callProcessor('assets',{id}));return;}
        }
        const workspaceAction = url.pathname.match(/^\/api\/node\/(workspace-(?:open|read|status|edit|undo|redo|catalog|export|close|preview-draft))$/u)?.[1];
        const action=workspaceAction || ({ '/api/node/catalog':'catalog','/api/node/project':'project','/api/node/frame':'frame','/api/node/validate':'validate','/api/node/hydrate':'hydrate','/api/node/horse':'horse','/api/node/player':'player','/api/node/item-icons':'item-icons','/api/node/font':'font','/api/node/font-coverage':'font-coverage','/api/node/lang':'lang' })[url.pathname];
        if(action&&req.method==='POST'){
          if(!/^application\/json(?:\s*;|$)/iu.test(String(req.headers['content-type']||'')))fail('NODE_JSON_CONTENT_TYPE',415);
          const input=await body(req);
          if(!input||typeof input!=='object'||Array.isArray(input))fail('NODE_REQUEST_OBJECT_REQUIRED');
          if(input.progressId!==undefined && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(input.progressId))fail('NODE_PROGRESS_ID_INVALID',422);
          if (workspaceAction) {
            workspaceContext = { run_id: runId, action, ...summarizeWorkspaceOperation(input) };
            workspaceJournal.record('WORKSPACE_OPERATION_STARTED', workspaceContext, { correlation_id: requestId });
          }
          // A live composition keeps its active layers alive. The single
          // processor serializes deletion after admitted work.
          for(const record of packs.values())if(!record.pending)record.touched=Date.now();
          const isWorkspaceBatch = ['workspace-edit', 'workspace-preview-draft'].includes(action) && input.operation?.type === 'batch';
          // The response socket must outlive bounded Worker computation. The
          // ordinary 60-second socket timeout otherwise closes long batches
          // before their 240-second Worker lease can return a result.
          if (isWorkspaceBatch) res.setTimeout(LIMITS.batchSocketMs);
          const jobTimeout = isWorkspaceBatch ? LIMITS.batchJobMs
            : ['project','frame','validate'].includes(action) ? LIMITS.projectionMs : LIMITS.jobMs;
          const result = await callProcessor(action,input,jobTimeout,{signal:requestAbort.signal,correlationId:requestId});
          if (workspaceContext) workspaceJournal.record('WORKSPACE_OPERATION_COMPLETED', { ...workspaceContext, result: result.summary || null },
            { correlation_id: requestId, duration_ms: performance.now() - started,
              severity: result.summary?.ok === false ? 'WARN' : 'INFO', outcome: result.summary?.ok === false ? 'failure' : 'success' });
          await send(result);return;
        }
        fail('NODE_ROUTE_NOT_FOUND',404);
      }
      if(!serveGui)fail('NODE_STATIC_NOT_FOUND',404);
      if(!['GET','HEAD'].includes(req.method))fail('NODE_METHOD_NOT_ALLOWED',405);
      if(url.pathname==='/'){res.writeHead(302,{Location:'/app/index.html'});res.end();return;}
      let decoded;try{decoded=decodeURIComponent(url.pathname);}catch{fail('NODE_STATIC_PATH_INVALID');}
      const publicPath=/^\/(app|src|vendor|assets|data)\//u.test(decoded)||/^\/docs\/(?:user_guide_(?:ja|en)|DEMO_SCENARIOS|ACCEPTANCE_CHECKLIST|EDITOR-STUDIO-26-JA)\.md$/u.test(decoded);
      if(!publicPath||decoded.includes('\\')||decoded.split('/').some(p=>p==='..'||p.startsWith('.'))||decoded.includes('\0'))fail('NODE_STATIC_NOT_FOUND',404);
      const candidate=path.join(editorRoot,decoded);
      const resolved=await realpath(candidate).catch(()=>null);
      if(!resolved||!resolved.startsWith(editorRoot)||!(await stat(resolved)).isFile())fail('NODE_STATIC_NOT_FOUND',404);
      const info=await stat(resolved);res.setHeader('Content-Type',mime[path.extname(resolved)]||'application/octet-stream');res.setHeader('Content-Length',info.size);
      if(req.method==='HEAD')res.end();else await pipeline(createReadStream(resolved),res);
    }catch(error){errorCode=publicErrorCode(error);failureStage=requestStage;const cancelled=requestAbort.signal.aborted||error.status===499;
      if(workspaceContext)workspaceJournal.record(cancelled?'WORKSPACE_OPERATION_CANCELLED':'WORKSPACE_OPERATION_FAILED',{...workspaceContext,error_code:errorCode,diagnostic:error.diagnostic||null},{severity:cancelled?'INFO':'ERROR',outcome:cancelled?'cancelled':error.status===504?'timeout':'failure',duration_ms:performance.now()-started,correlation_id:requestId});
      if(!res.headersSent&&!res.destroyed){res.statusCode=error.status||500;res.setHeader('Content-Type','application/json; charset=utf-8');const errorBody=JSON.stringify({error:errorCode,correlation_id:requestId,...(error.addonCandidates?{candidates:publicAddonCandidates(error.addonCandidates)}:{})});responseBytes=Buffer.byteLength(errorBody);res.end(errorBody);}else res.destroy();}
    finally{active--;const cancelled=requestAbort.signal.aborted||res.statusCode===499;
      const jobs=workerCalls?processor.snapshot().recent.filter(job=>job.correlation_id===requestId):[];
      if((route.startsWith('/api/')&&route!=='/api/node/progress')||errorCode)journal.record(cancelled?'NODE_HTTP_CANCELLED':errorCode?'NODE_HTTP_FAILED':'NODE_HTTP_COMPLETED',{
        route,http_method:req.method,http_status:res.statusCode,response_bytes:responseBytes,response_finished:res.writableFinished,
        request_bytes:Number.isSafeInteger(Number(req.headers['content-length']))?Number(req.headers['content-length']):null,
        worker_calls:workerCalls,worker_wait_ms:Math.max(0,Math.round(workerWaitMs)),
        queue_ms:jobs.reduce((sum,job)=>sum+job.queue_ms,0),work_ms:jobs.reduce((sum,job)=>sum+job.work_ms,0),
        ...(errorCode?{error_code:errorCode,failure_stage:failureStage}:{})},
        {severity:cancelled?'INFO':errorCode?'ERROR':'INFO',outcome:cancelled?'cancelled':(res.statusCode===504?'timeout':errorCode?'failure':'success'),duration_ms:performance.now()-started,correlation_id:requestId});}
  });
  server.maxConnections=LIMITS.connections;server.maxRequestsPerSocket=64;server.timeout=60000;
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);}).catch(async error=>{journal.record('NODE_SERVER_START_FAILED',{error_code:publicErrorCode(error)},{severity:'ERROR',outcome:'failure'});await processor.close();await serverLog.close();await rm(root,{recursive:true,force:true});throw error;});
  journal.record('NODE_SERVER_READY',{port:server.address().port});
  const reapTimer=setInterval(async()=>{
    if(stopping||active||processor.pending)return;
    for(const [id,record]of packs){
      // Only an explicitly owned SDK instance pins its bounded completed packs.
      // GUI/legacy servers keep their idle policy; upload/job/disk limits remain.
      if(keepPacksAlive||record.pending||record.closing||Date.now()-record.touched<LIMITS.idleMs)continue;
      record.closing=true;
      try{await processor.call('remove',{id});await rm(record.file,{force:true});packs.delete(id);diskBytes-=record.size;}catch{break;}
    }
  },60000);reapTimer.unref();
  async function close(){if(stopping)return;stopping=true;clearInterval(reapTimer);for(const record of packs.values())record.abort?.abort();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await processor.close();await rm(root,{recursive:true,force:true});journal.record('NODE_SERVER_STOPPED',{});await serverLog.close();}
  return {server,host,port:server.address().port,close,get processor(){return processor;},root};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<14))throw new Error(consoleText('Node.js 22.14.0 以降が必要です。24 LTS 最新版を推奨します。', normalizeLanguage(process.env.JSONUI_LANGUAGE)));
  const app=await createLocalServer({port:Number(process.env.JSONUI_PORT||3210),host:process.env.JSONUI_HOST||'127.0.0.1'});
  console.log(`${'JSON UI Workbench 0.15.0 · GUI 実験版'}: http://${app.host==='::1'?'[::1]':app.host}:${app.port}/`);
  const stop=()=>app.close().catch(error=>{console.error(consoleText(error.message, normalizeLanguage(process.env.JSONUI_LANGUAGE), error.code));process.exitCode=1;});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
