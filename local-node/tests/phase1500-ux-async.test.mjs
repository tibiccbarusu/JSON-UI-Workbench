/** 新たに見つかったデモ非同期所有権・参照診断・データ読込上限の回帰。 */
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile}from'node:fs/promises';
const main=await readFile(process.env.JSONUI_UX_REVIEW_SOURCE||new URL('../../editor-core/src/main.js',import.meta.url),'utf8');
function fn(name){const hit=main.match(new RegExp(`(?:async )?function ${name}\\(`));assert(hit);const a=hit.index,b=main.indexOf('\n}',a);assert(b>a);return main.slice(a,b+2);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function demo(){const readers=[];class Reader{constructor(){this.closed=0;readers.push(this);}async openFromFile(file){this.file=file;await file.open?.promise;}async listEntries(){return this.file.list?await this.file.list.promise:{meta:{fileName:this.file.name,entryCount:1},entries:[],warnings:[],truncated:false};}async readText(path){return this.reads.get(path).promise;}async close(){this.closed++;}}
 const current=new Reader(),state={status:'ready'},events=[];const c=vm.createContext({ZipReader:Reader,zipDemoReader:current,zipDemoLoadGeneration:0,zipDemoPreviewGeneration:0,zipDemoState:state,setStatus:x=>events.push(x),render(){},zipDemoErrorToMessage:e=>e.message,DEFAULT_ZIP_LIMITS:{maxTextFileBytesForRead:1024},editorResourceUrl:x=>x,File,fetch:()=>{throw new Error('not set');}});
 vm.runInContext(['loadZipDemoFile','loadZipDemoFixture','previewZipDemoText'].map(fn).join('\n'),c);return{c,state,readers,current,events};}
test('デモの同一path連続読取は最後の要求を採用し遅い旧エラーも無視する',async()=>{
 const x=demo(),first=deferred(),last=deferred();let calls=0;x.current.readText=()=>++calls===1?first.promise:last.promise;
 const a=x.c.previewZipDemoText('same.json'),b=x.c.previewZipDemoText('same.json');last.resolve('最新');await b;first.reject(new Error('旧エラー'));await a;assert.equal(x.state.previewText,'最新');assert.equal(x.state.previewError,null);
});
test('デモの遅延openと遅延listは新readerを奪わず旧candidateをcloseする',async()=>{
 for(const phase of ['open','list']){const x=demo(),gate=deferred();const old=x.c.loadZipDemoFile({name:'old.zip',[phase]:gate});await Promise.resolve();await x.c.loadZipDemoFile({name:'latest.zip'});const adopted=x.c.zipDemoReader;
 gate.resolve(phase==='list'?{meta:{fileName:'old.zip'},entries:[],warnings:[]}:undefined);await old;assert.equal(x.state.meta.fileName,'latest.zip');assert.equal(x.c.zipDemoReader,adopted);assert.equal(x.readers[1].closed,1);assert.equal(adopted.closed,0);assert.equal(x.current.closed,1);}
});
test('デモ旧open失敗は最新readyをerrorへ戻さず旧テキストも新パックへ混入させない',async()=>{
 const x=demo(),text=deferred(),gate=deferred();x.current.readText=()=>text.promise;
 const preview=x.c.previewZipDemoText('old.json');const old=x.c.loadZipDemoFile({name:'old.zip',open:gate});await x.c.loadZipDemoFile({name:'new.zip'});gate.reject(new Error('旧open失敗'));text.resolve('旧テキスト');await Promise.all([old,preview]);
 assert.equal(x.state.status,'ready');assert.equal(x.state.meta.fileName,'new.zip');assert.equal(x.state.previewText,null);assert.equal(x.state.error,null);
});
test('遅い内蔵fixture fetchは後続manual選択を置換しない',async()=>{
 const x=demo(),gate=deferred();x.c.fetch=()=>gate.promise;const loading=x.c.loadZipDemoFixture();await x.c.loadZipDemoFile({name:'chosen.zip'});
 gate.resolve({ok:true,blob:async()=>new Blob(['zip'])});await loading;assert.equal(x.state.meta.fileName,'chosen.zip');assert.equal(x.state.status,'ready');assert.equal(x.readers.length,2);
});
test('参照collector失敗は欠落なし表示を出さずexportへINCONCLUSIVEとerrorを残す',()=>{
 let output;const h=(tag,attrs={},children=[])=>({tag,attrs,children:children.flat().filter(x=>x!==null&&x!==undefined)});
 const c=vm.createContext({h,SUPPORTED_PREVIEW_LOCALES:['en_US'],collectMissingReferencesFromState(){throw new Error('REFERENCE_SCAN_FAILED');},diagnostics:{captureError(){}},langTableRuntime:{tablesByLocale:new Map(),inflightByLocale:new Map()},globalVarNamesRuntime:{status:'idle',names:new Set()},importedPackRuntime:null,vanillaReferenceRuntime:null,t:key=>key,stableStringify:JSON.stringify,downloadTextFile:x=>{output=JSON.parse(x.text);},revalidateCurrentScreenFile(){}});
 vm.runInContext(main.slice(main.indexOf('function renderReferencesPanel('),main.indexOf('function renderDebugPanel(')),c);const tree=c.renderReferencesPanel({ui:{previewLocale:'en_US'},files:{openFileIds:[]}});const flat=n=>typeof n==='object'?[n,...(n.children||[]).flatMap(flat)]:[n];const nodes=flat(tree);assert.equal(nodes.includes('references.noMissing'),false);const button=nodes.find(n=>n?.tag==='button'&&n.children.includes('references.export'));button.attrs.onClick();assert.equal(output.validationStatus,'INCONCLUSIVE');assert.equal(output.error,'REFERENCE_SCAN_FAILED');
});
test('旧mock inputは256KiB超をtext読取前に拒否し小さいJSONは適用できる',async()=>{
 let reads=0,applied=null;const errors=[],state={};const current={files:{currentFileId:null,byId:{}},preview:{mockDataVersion:0}};const c=vm.createContext({store:{getState:()=>current},importedPackRuntime:null,vanillaReferenceRuntime:null,resourcePackMutationEpoch:0,assertStudioExternalChange21(){},mockDataUiState:state,reportWorkspaceError:e=>errors.push(e),safeRender(){},boundedUtf8Length:s=>Buffer.byteLength(s),parseJsonc:s=>({ok:true,value:JSON.parse(s)}),applyKnownObject:x=>{applied=x;}});
 const a=main.indexOf('      const onImport = async (e) => {'),b=main.indexOf('\n      const summaryText',a);assert(a>=0&&b>a);vm.runInContext(main.slice(a,b)+'\nthis.runImport=onImport;',c);
 await c.runImport({target:{files:[{name:'huge.json',size:262145,text:async()=>{reads++;return '{}';}}]}});assert.equal(reads,0);assert.equal(applied,null);assert.match(state.lastImportError,/256 KiB/);
 await c.runImport({target:{files:[{name:'small.json',size:13,text:async()=>{reads++;return '{"#flag":true}';}}]}});assert.equal(reads,1);assert.equal(applied['#flag'],true);assert.equal(state.lastImportError,null);assert.equal(errors.length,1);
});
