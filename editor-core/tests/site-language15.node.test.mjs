import test from 'node:test';
import assert from 'node:assert/strict';
import { createI18n } from '../src/i18n/i18n.js';
import { translateSiteMessage, setSiteLocale } from '../src/i18n/site-messages.js';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';
import { parseEditableJsonc } from '../../local-node/workspace-jsonc.mjs';
import { inspectWorkspace } from '../../local-node/workspace-edit.mjs';
import { localizeConsoleResult } from '../../local-node/console-i18n.mjs';

const options={supportedLocales:['ja_JP','en_US'],localeBaseUrl:new URL('http://localhost/locales/')};
const response=table=>({ok:true,json:async()=>table});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {resolve,promise};};
function stub(t,fetcher){const originalWindow=globalThis.window,originalFetch=globalThis.fetch;const storage=new Map();globalThis.window={localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}};globalThis.fetch=fetcher;t.after(()=>{globalThis.window=originalWindow;globalThis.fetch=originalFetch;setSiteLocale('ja_JP');});return storage;}

test('a later language choice wins even while initial Japanese loading is pending',async t=>{
 const pending=deferred();const storage=stub(t,async url=>String(url).endsWith('ja_JP.json')?pending.promise:response({title:'Workspace'}));
 const i18n=createI18n(options);const init=i18n.init('ja_JP');const english=i18n.setLocale('en_US');pending.resolve(response({title:'作業画面'}));await Promise.all([init,english]);
 assert.equal(i18n.getLocale(),'en_US');assert.equal(storage.get('jsonui.locale'),'en_US');assert.equal(i18n.t('title'),'Workspace');
});

test('a failed language load retains a coherent selection and retries on explicit selection',async t=>{
 let requests=0;const storage=stub(t,async url=>String(url).endsWith('en_US.json')?(++requests===1?{ok:false,status:503}:response({title:'Workspace'})):response({title:'作業画面'}));
 const i18n=createI18n(options);await i18n.init();await i18n.setLocale('en_US');assert.equal(i18n.getLocale(),'ja_JP');assert.equal(storage.get('jsonui.locale'),'ja_JP');assert.equal(i18n.t('title'),'作業画面');
 await i18n.setLocale('en_US');assert.equal(i18n.getLocale(),'en_US');assert.equal(requests,2);
});

test('an invalid table is reported and can be fetched again without a reload',async t=>{
 let requests=0;const errors=[];stub(t,async url=>String(url).endsWith('en_US.json')?response(++requests===1?[]:{title:'Workspace'}):response({title:'作業画面'}));
 const i18n=createI18n({...options,onLoadError:(error,context)=>errors.push({error,context})});await i18n.init();await i18n.setLocale('en_US');assert.equal(errors.length,1);assert.equal(i18n.getLocale(),'ja_JP');
 await i18n.setLocale('en_US');assert.equal(requests,2);assert.equal(i18n.t('title'),'Workspace');
});

test('dictionary keys are data, including a literal __proto__ translation',async t=>{
 stub(t,async()=>response(JSON.parse('{"title":"作業画面","__proto__":"原型","constructor":"構築"}')));const i18n=createI18n(options);await i18n.init();assert.equal(i18n.t('__proto__'),'原型');assert.equal(i18n.t('constructor'),'構築');assert.equal({}.title,undefined);
});

test('actual JSONC syntax errors retain precise instructions in both site and CLI English',()=>{
 const cases=[['{"title" "value"}','A colon is required after the key.'],['{"title":"value" "next":1}','A comma is required between elements.'],['{"title":"value','The string is not closed.'],['{"title":1,"title":2}','The object contains duplicate keys.']];
 for(const [source,english]of cases){let issue;try{parseEditableJsonc(source,'ui/日本語.json');}catch(error){issue=error;}assert.ok(issue);const envelope={error:{code:issue.code,message:issue.message,details:issue.details},result:{text:source}};const translated=localizeConsoleResult(envelope,'en');assert.equal(translateSiteMessage(issue.message,'en_US'),english);assert.equal(translated.error.message,english);assert.equal(translated.error.details[0].message,english);assert.equal(translated.error.details[0].path,'ui/日本語.json');assert.equal(translated.result.text,source);assert.equal(translated.error.code,issue.code);}
});

test('property diagnostics translate their type requirements while retaining source identity',()=>{
 const result=inspectWorkspace({documents:{'ui/日本語.json':'{"namespace":"demo","screen":{"type":"panel","size":[1],"visible":1,"text":2,"alpha":{}}}'}});
 assert.equal(result.previewAllowed,false);assert.ok(result.diagnostics.length>=4);
 const localized=localizeConsoleResult({result},'en').result;
 for(const diagnostic of localized.diagnostics){assert.equal(/[ぁ-んァ-ン一-龯]/u.test(diagnostic.message),false);assert.ok(!diagnostic.message.startsWith('Diagnostic '),diagnostic.message);assert.equal(diagnostic.path,'ui/日本語.json');assert.equal(diagnostic.code,'EDIT_UI_PROPERTY_INVALID');}
 assert.equal(translateSiteMessage('size は 2 要素の座標・寸法配列、または式の文字列で指定してください。','en_US'),'Specify size as a two-element coordinate or dimension array, or an expression string.');
});

test('the editor controller exposes a translated server error without changing its source draft',async()=>{
 const source='{"namespace":"demo","screen":{"type":"panel"}}';let controller;
 controller=createWorkspaceEditor({ manualApply: false,request:async action=>action==='open'?{ok:true,workspaceId:'w',revision:1,files:[{path:'ui/a.json',sourceId:'p',sourceKind:'imported'}],sources:[{id:'p',kind:'imported'}]}:action==='read'?{ok:true,text:source,sourceId:'p',nodes:[]}: {ok:false,error:{code:'EDIT_JSONC_SYNTAX',message:'キーの後にコロンが必要です。'}}});
 await controller.ensure([{id:'p',kind:'imported'}],'p');await controller.readDocument('ui/a.json',{sourceId:'p'});setSiteLocale('en_US');await assert.rejects(controller.edit({type:'set',path:'ui/a.json',pointer:'/screen/size',value:[1,2]}));assert.equal(translateSiteMessage(controller.state.error),'A colon is required after the key.');assert.equal([...controller.state.drafts.values()][0].text,source);setSiteLocale('ja_JP');
});

test('a failed default table makes one request and is not persisted as a ready language',async t=>{
 let requests=0;const storage=stub(t,async()=>{requests++;return {ok:false,status:503};});const i18n=createI18n(options);await i18n.init();assert.equal(requests,1);assert.equal(i18n.isReady(),false);assert.equal(storage.size,0);
});

test('localized field violations retain machine-readable reason codes',()=>{
 const result=inspectWorkspace({documents:{'ui/a.json':3}});assert.equal(result.ok,false);assert.equal(result.error.code,'EDIT_TEXT_INVALID');const english=localizeConsoleResult({error:result.error},'en');assert.equal(english.error.details[0].reason,'EDIT_TEXT_INVALID');assert.equal(english.error.details[0].message,'The JSONC source must be a string.');assert.equal(english.error.details[0].field,'/documents/ui~1a.json');const sameEnvelope=localizeConsoleResult({error:{code:'EDIT_TEXT_INVALID',reason:'EDIT_TEXT_INVALID',message:result.error.message}},'en');assert.equal(sameEnvelope.error.reason,'EDIT_TEXT_INVALID');
});

test('fetch and body stalls expire, release pending loads, and cannot install late tables',async t=>{
 for(const phase of ['fetch','body']){
  const pending=deferred();let requests=0,signal;const errors=[];
  const originalWindow=globalThis.window,originalFetch=globalThis.fetch;const storage=new Map();
  globalThis.window={localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}};
  globalThis.fetch=async(url,init)=>{if(!String(url).endsWith('en_US.json'))return response({title:'作業画面'});requests++;signal=init.signal;if(requests>1)return response({title:'Workspace'});return phase==='fetch'?pending.promise:{ok:true,json:()=>pending.promise};};
  try{
   const i18n=createI18n({...options,loadTimeoutMs:20,onLoadError:error=>errors.push(error)});await i18n.init();await i18n.setLocale('en_US');
   assert.equal(i18n.getLocale(),'ja_JP',phase);assert.equal(storage.get('jsonui.locale'),'ja_JP',phase);assert.equal(signal.aborted,true,phase);assert.equal(errors[0]?.message,'I18N_TABLE_TIMEOUT',phase);
   await i18n.setLocale('en_US');assert.equal(requests,2,phase);assert.equal(i18n.t('title'),'Workspace',phase);
   pending.resolve(phase==='fetch'?response({title:'STALE'}):{title:'STALE'});await new Promise(done=>setTimeout(done,0));
   assert.equal(i18n.getLocale(),'en_US',phase);assert.equal(i18n.t('title'),'Workspace',phase);assert.equal(errors.length,1,phase);
  }finally{globalThis.window=originalWindow;globalThis.fetch=originalFetch;}
 }
});
