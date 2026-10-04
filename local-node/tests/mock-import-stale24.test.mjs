/** PHASE762: 旧debug状態読込の遅延応答は新しい入力を上書きしない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const main = await readFile(process.env.JSONUI_MOCK_REVIEW_SOURCE || new URL('../../editor-core/src/main.js', import.meta.url), 'utf8');
const a = main.indexOf('      const onImport = async (e) => {');
const b = main.indexOf('\n      const summaryText', a); assert(a >= 0 && b > a);
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; }
function setup() {
 const f = {id:'f',uiModel:{}};
 const state = {files:{currentFileId:'f',byId:{f}},preview:{mockDataVersion:1},pack:{imported:{}}};
 const ui = {rows:[{keyText:'#name',type:'string',valueText:'initial'}],lastImportError:null}; const applied=[], errors=[];
 const c=vm.createContext({store:{getState:()=>state},importedPackRuntime:{},vanillaReferenceRuntime:null,resourcePackMutationEpoch:0,
  mockDataUiState:ui,assertStudioExternalChange21(){},reportWorkspaceError:e=>errors.push(e.message),safeRender(){},boundedUtf8Length:s=>Buffer.byteLength(s),
  parseJsonc:s=>({ok:true,value:JSON.parse(s)}),applyKnownObject:value=>{applied.push(value);state.preview.mockDataVersion++;}});
 vm.runInContext(main.slice(a,b)+'\nthis.runImport=onImport;',c);
 const run = gate => c.runImport({target:{files:[{name:'state.json',size:18,text:()=>gate.promise}]}});
 return {c,state,ui,applied,errors,run};
}
test('後から選んだ状態fileの成功後に旧成功・旧失敗が戻っても最新値を保持する',async()=>{
 for(const oldFailure of [false,true]){const x=setup(),old=deferred(),latest=deferred();const first=x.run(old),last=x.run(latest);
 latest.resolve('{"#name":"latest"}');await last;oldFailure?old.reject(new Error('old error')):old.resolve('{"#name":"old"}');await first;
 assert.deepEqual(x.applied.map(v=>v['#name']),['latest']);assert.equal(x.ui.lastImportError,null);assert.deepEqual(x.errors,[]);}
});
test('debounce前の行草稿変更も古い状態fileの確定を防ぐ',async()=>{
 const x=setup(),gate=deferred(),read=x.run(gate);x.ui.rows[0].valueText='edited before blur';gate.resolve('{"#name":"old"}');await read;
 assert.equal(x.applied.length,0);assert.equal(x.ui.rows[0].valueText,'edited before blur');
});
test('UI切替・適用状態更新・パック構成変更後の遅延読込は破棄する',async()=>{
 for(const change of [x=>{x.state.files.currentFileId='other';x.state.files.byId.other={id:'other'};},x=>x.state.preview.mockDataVersion++,x=>x.c.resourcePackMutationEpoch++]){
 const x=setup(),gate=deferred(),read=x.run(gate);change(x);gate.resolve('{"#name":"old"}');await read;assert.equal(x.applied.length,0);}
});
test('現在要求の小さなJSONは一度適用し、現在要求の読込失敗は記録する',async()=>{
 const x=setup(),good=deferred(),read=x.run(good);good.resolve('{"#name":"current"}');await read;assert.equal(x.applied.length,1);
 const bad=deferred(),error=x.run(bad);bad.reject(new Error('current read error'));await error;assert.equal(x.ui.lastImportError,'current read error');assert.deepEqual(x.errors,['current read error']);
});
