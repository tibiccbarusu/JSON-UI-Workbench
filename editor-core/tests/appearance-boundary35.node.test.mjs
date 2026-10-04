/** 実 main の表示内容パネルを実 controller/queue に接続。DOM配置の目視検査ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createWorkspaceEditor} from '../src/ui/workspace-editor.js';
import {captureGeometryPolicy29,assertGeometryPolicy29} from '../src/ui/workspace-geometry-policy29.js';
import {workspaceEditSelectionIdentity} from '../src/ui/workspace-edit-intent.js';
import {renderStudioAppearance35,textureSuggestions35} from '../src/ui/studio-appearance35.js';
import {buildAssetIndexFromPackPaths,resolveTextureRef} from '../src/assets/asset-indexer.js';

const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
function sourceFunction(name){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}\n',start);assert(start>=0&&end>start);return source.slice(start,end+2);}
const wrapper=source.slice(source.indexOf('const studioEditPreviewProperty26 ='),source.indexOf('const studioMovePreviewElement26 ='));
const h=(tag,attrs={},children=[])=>({tag,attrs,children});
const flatten=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(flatten)]:[];
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

async function fixture(type='label'){
 const nodes=['a','b'].map(name=>({path:'ui/main.json',sourceId:'pack',pointer:`/main/controls/${name==='a'?0:1}/${name}`,rawKey:name,props:{type,[type==='label'?'text':'texture']:type==='label'?`文字${name}`:'textures/ui/existing'}}));
 const file={id:'f',path:'ui/main.json',uiModel:{},nodesById:Object.fromEntries(nodes.map(n=>[n.rawKey,{id:n.rawKey,type,props:n.props}]))};
 let selected='a',delayPlan=false,releasePlan=null,planRequests=0;
 const workspace=createWorkspaceEditor({request:async(action,payload)=>{
  if(action==='open')return{ok:true,workspaceId:'w',revision:'r',sources:[{id:'pack',kind:'imported'}],files:[{path:file.path,sourceId:'pack'}],nodes};
  if(action==='read')return{ok:true,text:'{}',sourceId:'pack',nodes};
  if(action==='edit'&&payload.operation.type==='planEdit'){
   planRequests++;if(delayPlan)await new Promise(resolve=>{releasePlan=resolve;});
   return{ok:true,editPlan:{target:{effectivePointer:payload.operation.effectivePointer},scope:'screen',targetMode:'visual',affectedInstances:1}};
  }
  throw new Error('unexpected:'+action);
 }});
 await workspace.ensure([{id:'pack',kind:'imported'}],'pack');workspace.setMode('edit');
 const select=async(_file,id)=>{const node=nodes.find(n=>n.rawKey===id);return workspace.selectPreviewTarget(node,{fileId:file.id,nodeId:id,effectivePointer:node.pointer,screen:{path:file.path,sourceId:'pack',pointer:'/main'}});};
 await select(file,'a');
 const locks=new Set(),storeState={files:{currentFileId:'f',byId:{f:file}}};
 const context=vm.createContext({h,sourceWorkspace:workspace,store:{getState:()=>storeState},
  captureGeometryPolicy29,assertGeometryPolicy29,workspaceEditSelectionIdentity,renderStudioAppearance35,textureSuggestions35,resolveTextureRef,
  importedPackRuntime:{assetIndex:buildAssetIndexFromPackPaths(['textures/ui/existing.png','textures/ui/next.png'])},vanillaReferenceRuntime:null,
  studioSelection21:()=>({snapshot:()=>({selectedIds:[selected]})}),studioLockSet26:()=>locks,lockedMovement26:ids=>ids.some(id=>locks.has(id)),
  assertStudioUnlocked26:(_file,ids)=>{if(ids.some(id=>locks.has(id)))throw Object.assign(new Error('locked'),{code:'EDITOR_ELEMENT_LOCKED'});},
  buildWorkspacePreviewSourceMap:()=>null,resolvePlannedPreviewNodeIds22:()=>[workspace.state.previewSelection.nodeId],
  selectSourceForCanvasNode:select,studioInvoke:fn=>Promise.resolve().then(fn),requestCanvasTextureRedraw(){},safeRender(){},
 });
 vm.runInContext(`const studioAppearanceDrafts35=new Map();\n${wrapper}\n${sourceFunction('renderStudioAppearancePanel35')}\nthis.panel=()=>renderStudioAppearancePanel35(store.getState().files.byId.f);`,context);
 const panel=()=>context.panel(),controls=()=>{const all=flatten(panel());return{input:all.find(n=>['input','textarea'].includes(n.tag)),button:all.find(n=>n.tag==='button'),all};};
 return{workspace,file,locks,context,controls,select:async id=>{selected=id;await select(file,id);},
  delay:()=>{delayPlan=true;},release:()=>{assert(releasePlan);releasePlan();},planRequests:()=>planRequests,storeState};
}

test('実パネル: imageの候補と適用はランタイムasset indexを参照する',async()=>{
 const f=await fixture('image'),c=f.controls();
 assert(c.all.some(n=>n.tag==='option'&&n.attrs.value==='textures/ui/existing'));
 c.input.attrs.onInput({currentTarget:{value:'textures/ui/next'}});await c.button.attrs.onClick();
 assert.equal(f.workspace.pendingCompiledOperations()[0].value,'textures/ui/next');
});
test('実パネル: 未存在画像は原文選択やqueueを変更せず拒否する',async()=>{
 const f=await fixture('image'),c=f.controls();c.input.attrs.onInput({currentTarget:{value:'textures/ui/missing'}});
 await assert.rejects(c.button.attrs.onClick(),error=>error.code==='WORKSPACE_TEXTURE_NOT_FOUND');assert.equal(f.workspace.pendingCount,0);assert.equal(f.planRequests(),0);
});
test('実パネル: 日本語・改行・HTML風文字列を文字列値のままqueueへ渡す',async()=>{
 const f=await fixture(),c=f.controls(),value='日本語 "見出し"\n<img src=x onerror=alert(1)>';
 c.input.attrs.onInput({currentTarget:{value}});assert.equal(f.workspace.pendingCount,0);await c.button.attrs.onClick();
 assert.equal(f.workspace.pendingCompiledOperations()[0].value,value);assert.equal(f.controls().input.attrs.value,value);
});
test('実パネル: 計画待機中の選択差替えで別要素へ書き込まない',async()=>{
 const f=await fixture(),c=f.controls();f.delay();c.input.attrs.onInput({currentTarget:{value:'変更'}});const apply=c.button.attrs.onClick();await tick();
 await f.select('b');f.release();await assert.rejects(apply,error=>error.code==='WORKSPACE_SELECTION_SUPERSEDED');assert.equal(f.workspace.pendingCount,0);
});
test('実パネル: 計画待機中にロックされた表示要素へ書き込まない',async()=>{
 const f=await fixture(),c=f.controls();f.delay();c.input.attrs.onInput({currentTarget:{value:'変更'}});const apply=c.button.attrs.onClick();await tick();
 f.locks.add('a');f.release();await assert.rejects(apply,error=>error.code==='EDITOR_ELEMENT_LOCKED');assert.equal(f.workspace.pendingCount,0);
});
test('実パネル: busy中は表示操作を無効化し、古いrevisionのボタンを拒否する',async()=>{
 const f=await fixture();f.workspace.state.busy=true;assert.equal(f.controls().button.attrs.disabled,true);f.workspace.state.busy=false;
 const c=f.controls();c.input.attrs.onInput({currentTarget:{value:'旧版の変更'}});f.workspace.state.revision='new';
 await assert.rejects(c.button.attrs.onClick(),error=>error.code==='WORKSPACE_SELECTION_SUPERSEDED');assert.equal(f.workspace.pendingCount,0);
});
test('実パネル: 未変更の適用は計画もqueueも作らず、元の変数・式を固定化しない',async()=>{
 const f=await fixture(),c=f.controls();assert.equal(c.button.attrs.disabled,true);await c.button.attrs.onClick();
 assert.equal(f.planRequests(),0);assert.equal(f.workspace.pendingCount,0);
 c.input.attrs.onInput({currentTarget:{value:'新しい文字'}});assert.equal(c.button.disabled,false);
 c.input.attrs.onInput({currentTarget:{value:'文字a'}});assert.equal(c.button.disabled,true);await c.button.attrs.onClick();assert.equal(f.workspace.pendingCount,0);
});
test('実パネル: 計画待機中にbusyへ移行してもqueueへ書き込まない',async()=>{
 const f=await fixture(),c=f.controls();f.delay();c.input.attrs.onInput({currentTarget:{value:'変更'}});const apply=c.button.attrs.onClick();await tick();
 f.workspace.state.busy=true;f.release();await assert.rejects(apply,error=>error.code==='WORKSPACE_BUSY');assert.equal(f.workspace.pendingCount,0);
});
test('実DOM helper: HTML風の入力値を要素として解析しない',()=>{
 class Node {constructor(){this.children=[];}append(child){this.children.push(child);}}
 const tags=[];
 const document={createElement:tag=>{tags.push(tag);const node=new Node();node.attributes={};node.listeners={};node.setAttribute=(key,value)=>{node.attributes[key]=value;};node.addEventListener=(key,value)=>{node.listeners[key]=value;};return node;},createTextNode:text=>Object.assign(new Node(),{text})};
 const context=vm.createContext({Node,document,reportWorkspaceError:error=>{throw error;}});
 vm.runInContext(`${sourceFunction('h')}\nthis.h=h;`,context);
 const text='<img src=x onerror=alert(1)>日本語',calls=[];
 const panel=renderStudioAppearance35(context.h,{type:'label',value:'前',draft:{value:text},onApply:(...args)=>calls.push(args)});
 assert.equal(panel.children[1].value,text);assert(!tags.includes('img'));assert(!tags.includes('script'));
 panel.children[3].listeners.click({});assert.deepEqual(calls,[['text',text]]);
});
