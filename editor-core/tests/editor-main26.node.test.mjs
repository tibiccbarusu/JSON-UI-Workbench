import { captureGeometryPolicy29, assertGeometryPolicy29 } from '../src/ui/workspace-geometry-policy29.js';
import { siteText } from '../src/i18n/site-messages.js';
/** 実mainの操作関数をNode VMへ載せて検証。ブラウザー目視検査ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { lockedMovement26, planLayerMove26, studioProgressModel26 } from '../src/ui/editor-arrangement26.js';
import { createEditorSelection21 } from '../src/ui/editor-selection21.js';
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const section=(a,b)=>{const start=main.indexOf(a),end=main.indexOf(b,start);assert(start>=0&&end>start);return main.slice(start,end);};
const nodes = {root:{isFileRoot:true,children:['parent']},parent:{props:{layer:5,size:[100,100]},children:['photo','close']},photo:{props:{layer:0,size:[20,20],offset:[0,0]},children:[]},close:{props:{layer:1,size:[4,4]},children:[]}};
function harness() {
 const selection=createEditorSelection21();
 const file={id:'f',path:'ui/anvil.json',nodesById:nodes,uiModel:{root:{id:'root'}},meta:{selectedDefinition:{definition:'anvil'}}};
 selection.useScreen('screen-a',{...file,rootId:'root'});selection.select('photo');
 const events=[], boxes=[{id:'parent',layer:5,effectiveLayer:5},{id:'photo',layer:0,effectiveLayer:5},{id:'close',layer:1,effectiveLayer:6}];
 const state={files:{currentFileId:'f',byId:{f:file}}};
 const h=(tag,attrs={},children=[])=>({tag,attrs,children:[...children],append(...more){this.children.push(...more);}});
 const context=vm.createContext({ captureGeometryPolicy29, assertGeometryPolicy29, siteText,lockedMovement26,planLayerMove26,studioProgressModel26,h,Map,Set,JSON,Number,Object,String,Date,Promise,
   studioSelection21:()=>selection,store:{getState:()=>state,dispatch:event=>events.push(event)},actions:{selectNode:id=>({type:'select',id})},
   safeRender:()=>events.push('render'),requestCanvasTextureRedraw:()=>events.push('draw'),setStatus:message=>events.push(message),
   studioUi:{leftView26:'elements',elementQuery26:'',elementPage26:0,rightOpen:true},
   sourceWorkspace:{state:{mode:'edit',busy:false,pendingOperations:[],revision:'r',pendingVersion:0},pendingNodeTransforms:()=>new Map(),editPreviewProperty:async(property,value)=>events.push({property,value})},
   getCanvasKey:id=>id,getCanvasState:()=>({}),studioPaintLayout21:()=>({boxes}),selectSourceForCanvasNode:async()=>events.push('select-source'),
   syncStudioSourceSelection21:()=>events.push('sync-selection'),studioInvoke:fn=>fn(),setTimeout,clearTimeout,
 });
 vm.runInContext(section('const studioLocks26 =','function renderSourceWorkspaceInspector()'),context);
 return {context,file,selection,events,walk:node=>node&&typeof node==='object'?[node,...node.children.flatMap(child=>child&&typeof child==='object'?[child,...walkChildren(child)]:[])]:[]};
}
const walkChildren=node=>node.children.flatMap(child=>child&&typeof child==='object'?[child,...walkChildren(child)]:[]);
const all=node=>[node,...walkChildren(node)];
test('実main: 左要素一覧で写真をロックし、親移動も止め、再描画後も解除可能',()=>{
 const {context:c,file,selection}=harness();
 c.studioToggleLock26('photo');assert.throws(()=>c.assertStudioUnlocked26(file,['parent']),{code:'EDITOR_ELEMENT_LOCKED'});
 const nav=c.renderStudioNavigation26(c.store.getState());
 const photo=all(nav).find(n=>n.attrs.id==='studio-element-lock26-photo');assert.equal(photo.attrs['aria-pressed'],'true');
 photo.attrs.onClick();assert.doesNotThrow(()=>c.assertStudioUnlocked26(file,['parent']));
 assert.deepEqual(selection.snapshot().selectedIds,['photo']);
});
test('実main: element行は子を単体選択し、明示グループへ自動昇格しない',()=>{
 const {context:c,selection}=harness();selection.setSelection(['photo','close']);selection.groupSelected();
 const nav=c.renderStudioNavigation26(c.store.getState());all(nav).find(n=>n.attrs.id==='studio-element-select26-photo').attrs.onClick({});
 assert.deepEqual(selection.snapshot().selectedIds,['photo']);
});
test('実main: 前面操作はlayer JSON数値を共通編集APIへ送り、親を選択し直さない',async()=>{
 const {context:c,selection,events}=harness();await c.studioArrange26('front');
 assert.equal(events.find(e=>e?.property==='layer').value,2);assert.deepEqual(selection.snapshot().selectedIds,['photo']);
});
test('実main: 前面操作の選択待機中にロックしてもmutationへ進まない',async()=>{
 const {context:c,events}=harness();let resume;c.selectSourceForCanvasNode=()=>new Promise(resolve=>{resume=resolve;});
 const pending=c.studioArrange26('front');c.studioToggleLock26('photo');resume();
 await assert.rejects(pending,{code:'EDITOR_ELEMENT_LOCKED'});assert.equal(events.filter(e=>e?.property==='layer').length,0);
});
test('実main: 位置・サイズをJSON文字列にせず、入力にはfocus復帰用のIDを持つ',async()=>{
 const {context:c,file,events}=harness();
 c.sourceWorkspace.state.editTargetMode='visual';
 const panel=c.renderStudioProperties26(file);const elements=all(panel);
 const x=elements.find(n=>n.attrs.id==='studio-geometry26-offset-0');assert(x);
 x.attrs.onInput({currentTarget:{value:'-50'}});
 const y=elements.find(n=>n.attrs.id==='studio-geometry26-offset-1');y.attrs.onInput({currentTarget:{value:'60'}});
 const button=elements.find(n=>n.tag==='button'&&n.children.includes('位置を変更'));await button.attrs.onClick();
 const changed=events.find(e=>e?.property==='offset');assert.deepEqual(Array.from(changed.value),[-50,60]);
});
test('実main: 相対サイズの基本数値入力を出さず、詳細編集への説明を残す',()=>{
 const {context:c,file}=harness();const backup=nodes.photo.props.size;nodes.photo.props.size=['100%',20];
 try{const panel=c.renderStudioProperties26(file);assert.equal(all(panel).some(n=>n.attrs.id==='studio-geometry26-size-0'),false);assert.match(JSON.stringify(panel),/比率・変数・計算式/u);}finally{nodes.photo.props.size=backup;}
});
test('実main: 追加予定要素の親ロックも保護し、無関係な既存兄弟ロックは妨げない',()=>{
 const {context:c}=harness();
 c.sourceWorkspace.pendingAdditions=()=>[{id:'added',previewSelection:{fileId:'f',nodeId:'parent'}}];
 c.studioToggleLock26('photo');assert.doesNotThrow(()=>c.assertStudioPendingAdditionUnlocked26('added'));
 c.studioToggleLock26('parent');assert.throws(()=>c.assertStudioPendingAdditionUnlocked26('added'),{code:'EDITOR_ELEMENT_LOCKED'});
});
