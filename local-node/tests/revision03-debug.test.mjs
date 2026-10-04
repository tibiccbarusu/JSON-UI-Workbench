import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { sanitizeDiagnostic, validateDebugRequest, createEventJournal, readLauncherLog, readBootstrapLog } from '../debug-bundle.mjs';
import { ResponseCache, responseKey } from '../response-cache.mjs';

test('診断データから資格情報・URL query・Windows/POSIX絶対パスを除去しpack相対pathを保持',()=>{
  const input={token:'a-secret',Authorization:'Bearer hidden',nested:{message:'failed /workspace/private.zip at https://u:pw@example.test/a?token=abc#abc',path:'C:\\Users\\private\\data.zip',relative:'ui/trade_screen.json',rawText:'private contents',env:{HOME:'/home/person'},note:'known-current-token'},events:[{message:'password=hidden'}]};
  const {data,summary}=sanitizeDiagnostic(input,{secrets:['known-current-token']});const output=JSON.stringify(data);
  for(const hidden of ['a-secret','Bearer hidden','private.zip','u:pw','token=abc','C:','private contents','known-current-token','password=hidden'])assert(!output.includes(hidden),hidden);
  assert.equal(data.nested.relative,'ui/trade_screen.json');assert(summary.redacted>0);
});
test('診断requestのschema/type/未知fieldは明示拒否',()=>{
  for(const value of [null,[],{}, {schema:'wrong'}, {schema:'jsonui-debug-request-v1',state:[]},{schema:'jsonui-debug-request-v1',events:{}},{schema:'jsonui-debug-request-v1',files:[]}])assert.throws(()=>validateDebugRequest(value),/NODE_DEBUG/);
  assert.equal(validateDebugRequest({schema:'jsonui-debug-request-v1',state:{progress:0.5},events:[]}).data.state.progress,0.5);
});
test('深すぎるrequestは拒否、文字列と配列は上限で省略を明示',()=>{
  const value={schema:'jsonui-debug-request-v1',state:{}};let cursor=value.state;
  for(let i=0;i<15;i++)cursor=cursor.next={};assert.throws(()=>validateDebugRequest(value),/STRUCTURE_LIMIT/);
  const result=validateDebugRequest({schema:'jsonui-debug-request-v1',state:{long:'x'.repeat(10000)},events:Array(700).fill('x')});
  assert.equal(result.data.events.length,500);assert.match(result.data.state.long,/TRUNCATED/);assert.equal(result.summary.truncated,true);
});
test('prototype keysとrawデータを診断から除外',()=>{
  const result=validateDebugRequest(JSON.parse('{"schema":"jsonui-debug-request-v1","state":{"__proto__":{"polluted":true},"constructor":"hidden","sourceCode":"private","progress":1}}'));
  assert.equal(Object.hasOwn(result.data.state,'__proto__'),false);assert.equal(result.data.state.sourceCode,undefined);assert.equal({}.polluted,undefined);
});
test('bounded journalは省略件数とrequest相関を保持',()=>{
  const journal=createEventJournal(2);for(let i=0;i<3;i++)journal.record('NODE_HTTP_COMPLETED',{i},{duration_ms:1.3,correlation_id:'id-'+i});
  const result=journal.snapshot();assert.equal(result.events.length,2);assert.equal(result.total_seen,3);assert.equal(result.dropped,1);
  assert.equal(result.events[0].duration_ms,1);assert.equal(result.events[1].correlation_id,'id-2');
  for(const field of ['timestamp','severity','event','message','logger','context'])assert(Object.hasOwn(result.events[0],field));
});
test('launcher logはtailのみ読み、symlinkへの置換を拒否',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'jsonui-debug-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const log=path.join(root,'launcher.log');await writeFile(log,JSON.stringify({event:'LAUNCH_READY',token:'hidden',message:'C:\\Users\\name\\foo'})+'\ninvalid\n');
  const result=await readLauncherLog(root);assert.equal(result.status,'available');assert.equal(result.malformed_records,1);assert(!JSON.stringify(result).includes('hidden'));
  await rm(log);await writeFile(path.join(root,'other'),'secret');await symlink(path.join(root,'other'),log);
  assert.equal((await readLauncherLog(root)).reason,'LOG_PATH_REDIRECT_REJECTED');
});
test('response cacheはentry数/byte上限・LRU順・clearを守る',()=>{
  const cache=new ResponseCache({maxBytes:10,maxEntries:2});cache.set('a',{body:'1234'});cache.set('b',{body:'1234'});assert(cache.get('a'));
  cache.set('c',{body:'12'});assert.equal(cache.get('b'),null);assert(cache.get('a'));assert(cache.snapshot().bytes<=10);
  cache.set('large',{body:'x'.repeat(11)});assert.equal(cache.get('large'),null);cache.clear();assert.equal(cache.snapshot().bytes,0);assert.equal(cache.snapshot().entries,0);
});
test('bootstrapの既存テキストログも固定ファイルから安全に読める',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'jsonui-bootstrap-log-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'bootstrap.log'),'SETUP_DOWNLOAD attempt=1 node=24.20.0\npassword=hidden\n');
  const result=await readBootstrapLog(root);assert.equal(result.status,'available');assert.equal(result.data.length,2);assert.equal(result.malformed_records,0);assert(!JSON.stringify(result).includes('password=hidden'));
});
test('response keyは変数map順不同でも一致し値変更・collection順序で異なる',()=>{
  assert.equal(responseKey({variables:{a:1,b:2},rows:[1,2]}),responseKey({rows:[1,2],variables:{b:2,a:1}}));
  assert.notEqual(responseKey({variables:{a:1}}),responseKey({variables:{a:2}}));
  assert.notEqual(responseKey([1,2]),responseKey([2,1]));
});
