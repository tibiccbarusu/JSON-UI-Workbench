import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { BATCH_CACHE_LIMITS29, encodeBatchCache29, decodeBatchCache29 } from '../workspace-batch-cache29.mjs';
import { WorkspaceSessions } from '../workspace-session.mjs';
import { editWorkspaceBatch } from '../workspace-batch.mjs';
import { summarizeWorkspaceResult } from '../workspace-operation-summary.mjs';
const sample = { ok:true, documents:{'ui/test.json':'{}'}, nodes:[], changes:[], revision:'after' };

test('R29 小結果は無圧縮で保持、取り出した文書を変更しても次回へ影響しない',()=>{
 const encoded=encodeBatchCache29(sample,'key');assert.equal(encoded.meta.storageEncoding,'json-string');
 const copy=decodeBatchCache29(encoded.entry);copy.documents['ui/test.json']='changed';
 assert.equal(decodeBatchCache29(encoded.entry).documents['ui/test.json'],'{}');assert.equal(Object.getPrototypeOf(copy.documents),null);
});
test('R29 大結果は可逆圧縮、Unicode/数値型/controls順序を完全に保持',()=>{
 const data={...sample,documents:{'ui/test.json':JSON.stringify({namespace:'test',controls:{b:{text:'日本語 𝄞'.repeat(5000)},a:{offset:['100% - 2px',3]}}})}};
 const limits={retainedBytes:4096,expandedBytes:1024*1024},encoded=encodeBatchCache29(data,'key',limits);
 assert.equal(encoded.meta.storageEncoding,'deflate-raw-utf16le');assert.ok(encoded.entry.bytes<=4096);
 assert.equal(JSON.stringify(decodeBatchCache29(encoded.entry,limits)),JSON.stringify(data));
});
test('R29 展開上限・保存上限を別々に検査し無制限に蓄積しない',()=>{
 const big={...sample,noise:'x'.repeat(1024)};
 assert.equal(encodeBatchCache29(big,'x',{retainedBytes:128,expandedBytes:256}).meta.storageReason,'expanded-limit');
 const random={...sample,noise:randomBytes(4096).toString('hex')};
 assert.equal(encodeBatchCache29(random,'x',{retainedBytes:128,expandedBytes:20000}).meta.storageReason,'retained-limit');
});
for(const action of [entry=>{entry.data[5]^=255;},entry=>{entry.expandedBytes=1;},entry=>{entry.encoding='unknown';},entry=>{entry.bytes++;}])
 test('R29 壊れた保持内容を検査済み成功として復元しない',()=>{
  const {entry}=encodeBatchCache29({...sample,noise:'日本語'.repeat(5000)},'x',{retainedBytes:2048,expandedBytes:200000});
  action(entry);assert.throws(()=>decodeBatchCache29(entry));
 });
async function fixture(text='small'){
 let builds=0;const documents={'ui/test.json':JSON.stringify({namespace:'test',screen:{type:'screen',size:[100,80],controls:[{label:{type:'label',size:[20,20],text}}]}})};
 const pack={rootPrefix:'',packPaths:Object.keys(documents),zipReader:{readText:async key=>documents[key]}};
 const sessions=new WorkspaceSessions({getPack:()=>pack,checkSources:x=>x,invalidate(){},batchExecutor:args=>{builds++;return editWorkspaceBatch(args);}});
 const state=await sessions.open({sources:[{id:'pack',kind:'imported'}]});
 const input={workspaceId:state.workspaceId,expectedRevision:state.revision,pendingVersion:1,screen:{path:'ui/test.json',pointer:'/screen'},
  operation:{type:'batch',pointerBasis:'base-revision',operations:[{type:'set',path:'ui/test.json',pointer:'/screen/controls/0/label/alpha',value:0.5}]}};
 return{sessions,state,input,builds:()=>builds,documents};
}
test('R29 16MiBを超える実編集結果を草稿→確定へ再利用し履歴・原文一致', {timeout:60000},async()=>{
 // 単一巨大文字列は容量圧力の合成入力。Minecraft描画速度の測定ではない。
 const f=await fixture('測定メモ'.repeat(400000));const before=f.sessions.get(f.state.workspaceId).documents['ui/test.json'];
 const draft=await f.sessions.previewDraft(f.input);assert.equal(draft.ok,true,JSON.stringify(draft.diagnostics));
 assert(draft.batch.jsonUtf8Bytes>BATCH_CACHE_LIMITS29.retainedBytes);assert.equal(draft.batch.storageEncoding,'deflate-raw-utf16le');assert.equal(f.builds(),1);
 const committed=await f.sessions.edit(f.input);assert.equal(committed.batch.validationCache,'hit');assert.equal(f.builds(),1);
 const doc=JSON.parse(f.sessions.get(f.state.workspaceId).documents['ui/test.json']);assert.equal(doc.screen.controls[0].label.alpha,0.5);assert.equal(doc.screen.controls[0].label.text.length,'測定メモ'.repeat(400000).length);
 const undone=f.sessions.history({workspaceId:f.state.workspaceId,expectedRevision:committed.revision},'undo');assert.equal(undone.revision,f.state.revision);
 assert.equal(f.sessions.get(f.state.workspaceId).documents['ui/test.json'],before);assert.equal(f.sessions.snapshot().retainedBytes,0);
});
test('R29 保持結果が破損した場合は通常再計算し破損結果を確定しない',async()=>{
 const f=await fixture();await f.sessions.previewDraft(f.input);const session=f.sessions.get(f.state.workspaceId);session.draftBatchCache={...session.draftBatchCache,body:'改変'};
 const result=await f.sessions.edit(f.input);assert.equal(result.batch.validationCache,'miss');assert.equal(result.batch.cacheReason,'decode-failed');
 assert.equal(f.builds(),2);assert.equal(f.sessions.snapshot().decodeFailures,1);assert.equal(result.ok,true);
});
test('R29 取消された再利用は確定・履歴を作らない',async()=>{
 const f=await fixture();await f.sessions.previewDraft(f.input);
 await assert.rejects(f.sessions.edit(f.input,()=>{throw Object.assign(new Error('cancel'),{code:'NODE_JOB_CANCELLED'});}),{code:'NODE_JOB_CANCELLED'});
 assert.equal(f.sessions.get(f.state.workspaceId).revision,f.state.revision);assert.equal(f.sessions.get(f.state.workspaceId).undo.length,0);assert.equal(f.builds(),1);
});
test('R29 診断要約はキャッシュ理由/容量/方式だけを収録する',()=>{
 const s=summarizeWorkspaceResult({ok:true,batch:{validationCache:'hit',cacheReason:'exact-match',storageReason:'retained',storageEncoding:'deflate-raw-utf16le',expandedBytes:22,retainedBytes:11,cacheDecodeMs:1.2,body:'secret'}});
 assert.equal(s.batch.storageEncoding,'deflate-raw-utf16le');assert.equal(s.batch.cacheReason,'exact-match');assert.equal(s.batch.expandedBytes,22);assert(!JSON.stringify(s).includes('secret'));
});

test('R29 同じ値でもtargetModeが違う結果を再利用しない',async()=>{
 const f=await fixture();
 const simple=f.input.operation.operations[0];
 await f.sessions.previewDraft(f.input);
 const withMode={...f.input,operation:{...f.input.operation,operations:[{...simple,targetMode:'visual'}]}};
 const second=await f.sessions.previewDraft(withMode);assert.equal(second.batch.validationCache,'miss');assert.equal(f.builds(),2);
 const interaction={...f.input,operation:{...f.input.operation,operations:[{...simple,targetMode:'interaction'}]}};
 const third=await f.sessions.previewDraft(interaction);assert.equal(third.batch.validationCache,'miss');assert.equal(f.builds(),3);
 assert.equal((await f.sessions.previewDraft(interaction)).batch.validationCache,'hit');assert.equal(f.builds(),3);
 assert.equal(f.sessions.get(f.state.workspaceId).revision,f.state.revision);
 f.sessions.clear();assert.equal(f.sessions.snapshot().retainedBytes,0);
});

test('R29 小結果の不変キャッシュは偽造コピー・書換えを拒否する',()=>{
 const {entry}=encodeBatchCache29(sample,'key');assert.equal(entry.encoding,'json-string');assert(Object.isFrozen(entry));
 assert.throws(()=>{entry.body='改変';},TypeError);assert.throws(()=>decodeBatchCache29({...entry}));
 assert.equal(decodeBatchCache29(entry).documents['ui/test.json'],'{}');
});
