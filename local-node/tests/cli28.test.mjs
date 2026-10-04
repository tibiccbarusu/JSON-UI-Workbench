import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { makeZip, manifest } from './fixtures.mjs';
import { cliCapabilities28 } from '../cli-capabilities28.mjs';
import { summarizeWorkspaceResult } from '../workspace-operation-summary.mjs';
const run=promisify(execFile), entry=fileURLToPath(new URL('../cli.mjs',import.meta.url));
async function cli(args,expected=0){let result;try{result={...await run(process.execPath,[entry,...args],{timeout:60000,maxBuffer:32*1024*1024}),code:0};}catch(e){result=e;}
  assert.equal(result.code,expected,result.stdout||result.stderr);const lines=result.stdout.trim().split('\n');assert.equal(lines.length,1);return JSON.parse(lines[0]);}
async function temp(t){const d=await mkdtemp(path.join(tmpdir(),'jsonui-cli28-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
async function input(t){const d=await temp(t),src=path.join(d,'入力.mcpack'),session=path.join(d,'session.json'),operation=path.join(d,'move.json');
 const bytes=makeZip({'manifest.json':manifest,'ui/test.json':JSON.stringify({namespace:'test',screen:{type:'screen',size:[80,40],controls:[{box:{type:'panel',size:[10,8],anchor_from:'top_left',anchor_to:'top_left',offset:[1,2]}}]},second:{type:'screen'},'ui_unused':{type:'panel'}}),'ui/pocket/touch.json':'{"namespace":"touch","screen":{"type":"screen"}}'});
 await writeFile(src,bytes);await writeFile(operation,JSON.stringify({type:'move',path:'ui/test.json',pointer:'/screen/controls/0/box',offset:[22,12]}));
 await cli(['import','--pack',src,'--session',session]);return {d,src,session,operation,bytes};}

test('R28: features はセッションやロックを生成せず制限を機械可読で示す',async t=>{const d=await temp(t),session=path.join(d,'not-created.json');
 const result=await cli(['features','--session',session,'--json']);assert.equal(result.ok,true);assert.deepEqual(result.result,cliCapabilities28());
 await assert.rejects(stat(session),{code:'ENOENT'});await assert.rejects(stat(session+'.lock'),{code:'ENOENT'});});

test('R28: 実CLI draft はフレームだけ計算し、元ZIP・保存セッション・確定原文を維持', {timeout:60000},async t=>{
 const f=await input(t),before=await readFile(f.session);const result=await cli(['draft','--session',f.session,'--file','ui/test.json','--definition','test.screen','--operation',f.operation,'--width','80','--height','40','--ui-scale','1']);
 const draft=result.result;assert.equal(draft.committed,false);assert.equal(draft.session_modified,false);assert.notEqual(draft.draftRevision,draft.baseRevision);
 const box=draft.frame.layout.boxes.find(b=>b.id.endsWith('/box'));assert(box,JSON.stringify(draft.frame.layout));assert.equal(box.x,22);assert.equal(box.y,12);
 assert.deepEqual(await readFile(f.session),before);assert.deepEqual(await readFile(f.src),f.bytes);
 const current=await cli(['read','--session',f.session,'--file','ui/test.json']);assert.match(JSON.stringify(current),/1,2|1, 2|1,\\n/u);
 const output=path.join(f.d,'draft.json');await cli(['draft','--session',f.session,'--file','ui/test.json','--definition','test.screen','--operation',f.operation,'--out',output]);
 const saved=JSON.parse(await readFile(output));assert.equal(saved.committed,false);assert.deepEqual(await readFile(f.session),before);
});

test('R28: 草稿でもファイル内のUI定義選択を要求し、Pocketはプレビューしない',{timeout:60000},async t=>{
 const f=await input(t);const args=['draft','--session',f.session,'--operation',f.operation];
 const ambiguous=await cli([...args,'--file','ui/test.json'],1);assert.match(ambiguous.error.code,/AMBIGUOUS|DEFINITION_REQUIRED/u);
 const pocket=await cli([...args,'--file','ui/pocket/touch.json','--definition','touch.screen'],1);assert.match(pocket.error.code,/POCKET/u);
 const missing=await cli(['draft','--session',f.session],1);assert.equal(missing.error.code,'CLI_OPERATION_REQUIRED');
});

test('R28: 草稿JSONの上書き指定も入力操作ファイルを破壊しない',{timeout:60000},async t=>{
 const f=await input(t),before=await readFile(f.operation);const denied=await cli(['draft','--session',f.session,'--file','ui/test.json','--definition','test.screen','--operation',f.operation,'--out',f.operation,'--force'],1);
 assert.match(denied.error.code,/PROTECTED/u);assert.deepEqual(await readFile(f.operation),before);
});

test('R28: 編集完了ログに分離方針・確定先を記録し原文の値は含めない',()=>{
 const result=summarizeWorkspaceResult({ok:true,editPlan:{scope:'screen',instanceIsolation:'single-placement',affectedInstances:1,sharedSourceInstances:3,
 target:{path:'ui/common.json',pointer:'/image',props:{text:'PRIVATE_CONTENT'}},committedTarget:{pointer:'/private_image'},deviceValidation:'NOT_RUN'}});
 assert.equal(result.edit_plan.instance_isolation,'single-placement');assert.equal(result.edit_plan.shared_source_instances,3);assert.equal(result.edit_plan.committed_target.pointer,'/private_image');assert(!JSON.stringify(result).includes('PRIVATE_CONTENT'));
 const batch=summarizeWorkspaceResult({editPlan:{type:'batch',operations:Array.from({length:100},(_,index)=>({index,editPlan:{scope:'screen',target:{pointer:'x'.repeat(10000)}}}))}});
 assert.equal(batch.edit_plan.operations.length,8);assert.equal(batch.edit_plan.omitted_operations,92);assert.equal(batch.edit_plan.operations[0].target.pointer.length,1024);
});
