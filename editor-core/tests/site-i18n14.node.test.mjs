import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { filterDiagnosticEntries } from '../src/diagnostics/log-export.js';
import { createI18n } from '../src/i18n/i18n.js';
import { siteText, getSiteLocale, setSiteLocale, translateSiteMessage, navigationChoiceLabel, clipboardSourceLabel, filterLocalizedDiagnostics, SITE_MESSAGES } from '../src/i18n/site-messages.js';
import { buildUiDataCatalog, getUiSlotDefinition } from '../src/ui/ui-data-catalog.js';
import { renderWorkspaceSourceEditor, workspaceDocumentKey } from '../src/ui/workspace-editor.js';
import { createUiCollectionExample, applyUiDataDraft } from '../src/ui/ui-data-editor.js';

const japanese = /[ぁ-んァ-ン一-龯]/u;
const globals = { window: globalThis.window, fetch: globalThis.fetch };
function browserStub(stored = null) {
  const storage = new Map(stored ? [['jsonui.locale', stored]] : []);
  globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) } };
  return storage;
}
function restore() { globalThis.window = globals.window; globalThis.fetch = globals.fetch; setSiteLocale('ja_JP'); }
const response = table => ({ ok: true, json: async () => table });
const deferred = () => { let resolve; const promise = new Promise(res => { resolve = res; }); return { promise, resolve }; };
function fakeH(tag, attrs = {}, children = []) {
  return { tag, attrs, ...attrs, children: [children].flat(Infinity), setAttribute(name,value) { this.attrs[name] = value; }, addEventListener() {} };
}
function allNodes(node) { return [node, ...(node.children || []).filter(x => x && typeof x === 'object').flatMap(allNodes)]; }
function allText(node) { return (node.children || []).map(child => typeof child === 'object' ? allText(child) : String(child)).join(' '); }

test('Japanese is the default; an explicit English choice persists across initialization', async () => {
  try {
    const storage = browserStub();
    globalThis.fetch = async url => response(String(url).endsWith('en_US.json') ? { title: 'Workspace' } : { title: '作業画面' });
    const options = { supportedLocales: ['ja_JP','en_US'], localeBaseUrl: new URL('http://localhost/locales/') };
    const first = createI18n(options); await first.init(); assert.equal(first.getLocale(),'ja_JP'); assert.equal(first.t('title'),'作業画面');
    await first.setLocale('en_US'); assert.equal(storage.get('jsonui.locale'),'en_US');
    const reloaded = createI18n(options); await reloaded.init(); assert.equal(reloaded.getLocale(),'en_US'); assert.equal(reloaded.t('title'),'Workspace');
  } finally { restore(); }
});

test('an older delayed English fetch cannot override a later Japanese choice', async () => {
  try {
    const storage = browserStub(), pending = deferred(); let count = 0;
    globalThis.fetch = async url => String(url).endsWith('en_US.json') ? (++count, pending.promise) : response({ title: '作業画面' });
    const i18n = createI18n({ supportedLocales: ['ja_JP','en_US'], localeBaseUrl: new URL('http://localhost/locales/') });
    await i18n.init(); const english = i18n.setLocale('en_US'); await Promise.resolve();
    await i18n.setLocale('ja_JP'); pending.resolve(response({ title: 'Workspace' })); await english;
    assert.equal(count,1); assert.equal(i18n.getLocale(),'ja_JP'); assert.equal(storage.get('jsonui.locale'),'ja_JP');
  } finally { restore(); }
});

test('a failed language fetch reports the failure and retries only on a later explicit choice', async () => {
  try {
    browserStub(); let requests = 0; const errors = [];
    globalThis.fetch = async url => !String(url).endsWith('en_US.json') ? response({ title:'作業画面' }) : ++requests === 1 ? { ok: false, status: 503 } : response({ title:'Workspace' });
    const i18n = createI18n({ supportedLocales:['ja_JP','en_US'],localeBaseUrl:new URL('http://localhost/locales/'),onLoadError: (error,context) => errors.push({error,context}) });
    await i18n.init(); await i18n.setLocale('en_US'); assert.equal(i18n.t('title'),'作業画面'); assert.equal(requests,1); assert.equal(errors.length,1);
    await i18n.setLocale('en_US'); assert.equal(i18n.t('title'),'Workspace'); assert.equal(requests,2);
  } finally { restore(); }
});

test('site literal and template translation preserve embedded Japanese input, paths and HTML as plain text', () => {
  try {
    setSiteLocale('en_US'); assert.equal(siteText('編集モード'),'Edit mode');
    assert.equal(siteText`値: ${null} / ${undefined}`, '値: null / undefined');
    for (const key of ['__proto__','constructor','toString']) assert.equal(siteText(key), key);
    assert.equal(siteText`constructor`, 'constructor');
    const input = '編集モード/<script>日本語 & {0}</script>';
    assert.equal(siteText`原文を保存しました: ${input}`,`Saved the source: ${input}`);
    assert.equal(translateSiteMessage(`原文を保存しました: ${input}`),`Saved the source: ${input}`);
    assert.equal(translateSiteMessage(input),input);
    setSiteLocale('ja_JP'); assert.equal(translateSiteMessage(`Saved the source: ${input}`),`原文を保存しました: ${input}`);
    assert.equal(siteText('編集モード'),'編集モード');
  } finally { restore(); }
});

test('imported slot metadata and an already cached catalog follow Japanese → English → Japanese', () => {
  try {
    const model = { namespace:'inventory',root:{id:'root',type:'panel',props:{collection_name:'inventory_items'},children:[]} };
    setSiteLocale('ja_JP'); const ja = buildUiDataCatalog(model); assert.equal(ja.slots[0].label,'持ち物');
    setSiteLocale('en_US'); const en = buildUiDataCatalog(model); assert.notEqual(en,ja); assert.equal(en.slots[0].label,'Inventory'); assert.equal(getUiSlotDefinition('inventory_items').label,'Inventory');
    setSiteLocale('ja_JP'); assert.equal(buildUiDataCatalog(model).slots[0].label,'持ち物');
  } finally { restore(); }
});

test('the actual source editor renders English controls while source, property value and user element names stay exact', () => {
  try {
    const path='ui/test.json', sourceId='pack-1', source='{"namespace":"sample","編集モード":{"type":"label","text":"原文と要素の編集"}}';
    const key=workspaceDocumentKey(path,sourceId), state={files:[{path,sourceId,sourceKind:'imported'}],nodes:[{path,sourceId,pointer:'/編集モード',rawKey:'編集モード',isDefinition:true,props:{type:'label',text:'原文と要素の編集'}}],activePath:path,activeSourceId:sourceId,selectedPointer:'/編集モード',drafts:new Map([[key,{text:source}]]),revision:1,busy:false,error:'',message:''};
    const render=()=>renderWorkspaceSourceEditor(fakeH,{controller:{state},renderPicker: ({label,entries})=>fakeH('div',{},[label,...entries.map(x=>x.label)])});
    setSiteLocale('en_US'); const output=render(), nodes=allNodes(output);
    assert.match(allText(output),/Validate and apply/u); assert.match(allText(output),/Queue property change/u);
    assert.equal(nodes.find(x=>x.id==='workspace-source-text').value,source);
    assert.ok(nodes.some(x=>x.tag==='strong'&&allText(x)==='編集モード'));
    assert.ok(nodes.some(x=>x.tag==='option'&&allText(x)==='Texture (texture)'));
    setSiteLocale('ja_JP'); assert.match(allText(render()),/検証して反映/u);
  } finally { restore(); }
});

test('preview sample content and applied user data are independent of the site language', () => {
  try {
    setSiteLocale('ja_JP'); const ja=createUiCollectionExample('book_pages');
    setSiteLocale('en_US'); assert.deepEqual(createUiCollectionExample('book_pages'),ja);
    const value='編集モード 原文と要素の編集 日本語 <script>';
    const result=applyUiDataDraft({},[{kind:'text',fieldId:'x',value}],{catalog:{textFields:[{id:'x',binding:'#text',maxLength:1000}],collections:[]}});
    assert.equal(result.mockData['#text'],value);
  } finally { restore(); }
});

test('both translation tables have matching keys and preserve every template parameter', async () => {
  const ja=JSON.parse(await fs.readFile(new URL('../app/locales/ja_JP.json',import.meta.url),'utf8'));
  const en=JSON.parse(await fs.readFile(new URL('../app/locales/en_US.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(ja).sort(),Object.keys(en).sort());
  const placeholders=text=>[...text.matchAll(/\{([A-Za-z0-9_]+)\}/gu)].map(x=>x[1]).sort();
  for(const key of Object.keys(ja))assert.deepEqual(placeholders(ja[key]),placeholders(en[key]),key);
  for(const [key,value]of Object.entries(SITE_MESSAGES)){assert.ok(value.length>0,key);assert.equal(japanese.test(value),false,key);assert.deepEqual(placeholders(key),placeholders(value),key);}
});


test('built-in help and clipboard labels translate without changing custom labels or payloads', () => {
  try {
    setSiteLocale('en_US');
    assert.equal(navigationChoiceLabel({fileId:'screen:ui/encyclopedia_screen.json',definition:'encyclopedia.anvil_section',previewTopic:true,label:'関連する説明: 金床（プレビュー用）'}),'Related help: Anvil (preview)');
    assert.equal(navigationChoiceLabel({fileId:'screen:ui/custom.json',definition:'custom.root',label:'閉じる'}),'閉じる');
    assert.equal(clipboardSourceLabel('Realms招待URL（プレビュー用）',{mode:'adapter',evidence:'preview-simulated',dataSourceContract:'realms-invite-link-mock-v1',sourceLabel:'Realms招待URL（プレビュー用）'}),'Realms invitation URL (preview)');
    assert.equal(clipboardSourceLabel('閉じる',{sourceLabel:'閉じる'}),'閉じる');
    assert.equal(clipboardSourceLabel('表示文字',{}),'Displayed text');
  } finally { restore(); }
});


test('English diagnostic search returns unchanged original records for export', () => {
  try {
    setSiteLocale('en_US'); const entry=Object.freeze({id:'1',level:'warn',source:'preview',message:'プレビューの状態を更新しました。'});
    const result=filterLocalizedDiagnostics([entry],{query:'preview state',level:'warn'},filterDiagnosticEntries);
    assert.equal(result.length,1);assert.equal(result[0],entry);assert.equal(result[0].message,'プレビューの状態を更新しました。');
    assert.equal(filterLocalizedDiagnostics([entry],{query:'preview state',level:'error'},filterDiagnosticEntries).length,0);
  } finally { restore(); }
});
