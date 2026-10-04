import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServerLog } from '../server-log33.mjs';
import { createEventJournal, readServerLogs } from '../debug-bundle.mjs';
import { createLocalServer } from '../server.mjs';
import { resourceFixture } from './fixtures.mjs';

async function directory(t, cleanup = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'jui-log33-'));
  t.after(async () => {
    try { for (const stop of cleanup.reverse()) await stop(); }
    finally { await rm(root, { recursive: true, force: true }); }
  }); return root;
}
const event = index => ({ timestamp: new Date().toISOString(), severity: 'INFO', event: 'NODE_TEST',
  logger: 'jsonui.test', message: '検査', run_id: 'run-33', correlation_id: `req-${index}`,
  context: { index }, outcome: 'success' });

test('R33 エラー履歴は多数のプレビュー成功に埋もれず、保存前に秘密を除去する', () => {
  const journal=createEventJournal(500,{runId:'run-33',secrets:()=>['CURRENT_CREDENTIAL']});
  for(let index=0;index<102;index++)journal.record('NODE_HTTP_FAILED',{index,note:'CURRENT_CREDENTIAL',text:'PACK_CONTENT'}, {severity:'ERROR',outcome:'failure',correlation_id:'req-'+index});
  for(let index=0;index<600;index++)journal.record('NODE_HTTP_COMPLETED',{index});
  const result=journal.snapshot();
  assert.equal(result.events.length,500);assert.equal(result.dropped,202);
  assert.equal(result.important_events.length,100);assert.equal(result.important_dropped,2);
  assert.equal(result.important_events[0].context.index,2);
  assert.equal(result.important_events.at(-1).correlation_id,'req-101');
  assert.equal(result.events.at(-1).run_id,'run-33');assert.equal(result.events.at(-1).sequence,702);
  assert.doesNotMatch(JSON.stringify(result),/CURRENT_CREDENTIAL|PACK_CONTENT/u);
});

test('R33 永続ログは上限で二世代へ回転し、秘密・本文・改行注入を保持しない', async t => {
  const root=await directory(t),sink=createServerLog(root,{secrets:()=>['CURRENT_CREDENTIAL'],limits:{fileBytes:2048,recordBytes:1024,queuedBytes:4096}});
  for(let index=0;index<20;index++) {
    sink.record({...event(index),context:{index,note:'CURRENT_CREDENTIAL',text:'PACK_CONTENT',message:'line1\nline2\u001b[0m'}});
    assert.equal((await sink.flush()).completed,true);
  }
  const snapshot=sink.snapshot();assert.equal(snapshot.written,20);assert(snapshot.rotations>0);assert.equal(snapshot.dropped,0);
  for(const name of ['server.log','server.log.1']) {
    const source=await readFile(path.join(root,name),'utf8');assert((await stat(path.join(root,name))).size<=2048);
    assert.doesNotMatch(source,/CURRENT_CREDENTIAL|PACK_CONTENT|\u001b/u);
    for(const row of source.trim().split('\n'))assert.equal(JSON.parse(row).event,'NODE_TEST');
  }
  const logs=await readServerLogs(root);assert.equal(logs.current.status,'available');assert.equal(logs.current.data.at(-1).context.index,19);
  assert.equal(logs.previous.status,'available');await sink.close();
});

test('R33 ログの書込待ちと単一レコードの上限を明示し、上限でも処理を投げない', async t => {
  const root=await directory(t),sink=createServerLog(root,{limits:{fileBytes:4096,recordBytes:512,queuedBytes:1024}});
  sink.record({...event(0),context:{details:Array.from({length:100},()=>({value:'x'.repeat(100)}))}});
  for(let index=1;index<100;index++)sink.record(event(index));
  assert(sink.snapshot().queued_bytes<=1024);assert(sink.snapshot().dropped>0);assert.equal(sink.snapshot().details_omitted,1);
  assert.equal((await sink.flush()).completed,true);assert.equal(sink.snapshot().queued_bytes,0);
  const rows=(await readServerLogs(root)).current.data;assert.equal(rows[0].context.reason_code,'NODE_LOG_RECORD_LIMIT');
  assert.equal(rows[0].correlation_id,'req-0');await sink.close();
});

test('R33 シンボリックリンクとハードリンクのログ対象へ書き込まない', async t => {
  const root=await directory(t),target=path.join(root,'unrelated');await writeFile(target,'KEEP');
  for(const create of [symlink,link]) {
    const log=path.join(root,'server.log');await create(target,log);
    const sink=createServerLog(root);assert.doesNotThrow(()=>sink.record(event(1)));
    await sink.flush();assert.equal(sink.snapshot().status,'unavailable');assert.equal(sink.snapshot().failure_code,'NODE_LOG_PATH_UNSAFE');
    assert.equal(await readFile(target,'utf8'),'KEEP');await sink.close();await rm(log);
  }
});

test('R33 上限を超える既存ログは前世代へ移さず保全し、保存不可の理由を通知する', async t => {
  const root=await directory(t);
  for (const name of ['server.log','server.log.1']) {
    await writeFile(path.join(root,name),'P'.repeat(4096));
    const sink=createServerLog(root,{limits:{fileBytes:1024,recordBytes:512,queuedBytes:1024}});
    sink.record(event(1));await sink.flush();
    assert.equal(sink.snapshot().status,'unavailable');assert.equal(sink.snapshot().failure_code,'NODE_LOG_EXISTING_FILE_LIMIT');
    assert.equal(sink.snapshot().written,0);assert.equal(sink.snapshot().rotations,0);
    assert.equal(await readFile(path.join(root,name),'utf8'),'P'.repeat(4096));
    await sink.close();await rm(path.join(root,name));
  }
});

test('R33 ログ保管先の障害はサイト起動を妨げず、bundleに制約を明記する', async t => {
  const cleanup=[],root=await directory(t,cleanup),blocked=path.join(root,'blocked');await writeFile(blocked,'KEEP');
  const app=await createLocalServer({port:0,logDirectory:blocked});cleanup.push(()=>app.close());
  const base=`http://127.0.0.1:${app.port}/api/node/`,cap=await (await fetch(base+'capabilities')).json();
  const response=await fetch(base+'debug-bundle',{method:'POST',headers:{'Content-Type':'application/json','X-JSONUI-Token':cap.token},body:JSON.stringify({schema:'jsonui-debug-request-v1'})});
  assert.equal(response.status,200);const bundle=await response.json();
  assert.equal(bundle.server.log_persistence.status,'unavailable');assert(bundle.server.log_persistence.failure_code);
  assert.equal(await readFile(blocked,'utf8'),'KEEP');
});

test('R33 HTTP/Worker/編集の相関・失敗段階・再起動前の証跡をダウンロードできる', {timeout:20000}, async t => {
  const cleanup=[],root=await directory(t,cleanup);let app=await createLocalServer({port:0,logDirectory:root});cleanup.push(()=>app.close());
  let base=`http://127.0.0.1:${app.port}/api/node/`,token=(await (await fetch(base+'capabilities')).json()).token;
  const originalToken=token;
  const request=(route,payload)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-JSONUI-Token':token},body:JSON.stringify(payload)});
  const id=randomUUID(),bytes=resourceFixture();
  const upload=await fetch(base+'packs',{method:'POST',headers:{'Content-Type':'application/zip','X-JSONUI-Token':token,'X-JSONUI-Upload-ID':id,'X-JSONUI-Name':'sample.mcpack'},body:bytes});assert.equal(upload.status,200);
  const workspace=await (await request('workspace-open',{sources:[{id,kind:'imported'}]})).json();
  const failure=await request('workspace-read',{workspaceId:workspace.workspaceId,path:'../bad.json'});
  const failedRequestId=failure.headers.get('x-jsonui-request-id'),failureBody=await failure.json();
  assert.equal(failureBody.correlation_id,failedRequestId);assert(failureBody.error);
  const invalid=await fetch(base+'workspace-read',{method:'POST',headers:{'Content-Type':'application/json','X-JSONUI-Token':token},body:'{"private":"PRIVATE_JSON_FRAGMENT"'});
  const invalidId=invalid.headers.get('x-jsonui-request-id');assert.equal((await invalid.json()).error,'NODE_JSON_INVALID');
  await (await fetch(base+'PRIVATE_ROUTE_CONTENT?token=PRIVATE_QUERY',{headers:{'X-JSONUI-Token':token}})).text();
  const before=await (await request('debug-bundle',{schema:'jsonui-debug-request-v1'})).json();
  const rows=before.server.journal.events,failed=rows.find(row=>row.correlation_id===failedRequestId&&row.event==='NODE_HTTP_FAILED');
  assert.equal(failed.context.failure_stage,'processing');assert.equal(failed.context.worker_calls,1);
  assert(failed.context.queue_ms>=0);assert(failed.context.work_ms>=0);assert(failed.context.worker_wait_ms>=0);
  assert.equal(rows.find(row=>row.correlation_id===invalidId&&row.event==='NODE_HTTP_FAILED').context.failure_stage,'receiving');
  const oldRun=before.server.run_id;
  await app.close();app=await createLocalServer({port:0,logDirectory:root});base=`http://127.0.0.1:${app.port}/api/node/`;token=(await (await fetch(base+'capabilities')).json()).token;
  const after=await (await request('debug-bundle',{schema:'jsonui-debug-request-v1'})).json();
  assert.notEqual(after.server.run_id,oldRun);assert.equal(after.server.log_persistence.completed,true);
  const persisted=after.server.persisted_logs.current.data;
  assert(persisted.some(row=>row.run_id===oldRun&&row.correlation_id===failedRequestId&&row.event==='NODE_HTTP_FAILED'));
  assert.doesNotMatch(JSON.stringify(after),new RegExp(originalToken+'|'+token+'|PRIVATE_JSON_FRAGMENT|PRIVATE_ROUTE_CONTENT|PRIVATE_QUERY','u'));
});
