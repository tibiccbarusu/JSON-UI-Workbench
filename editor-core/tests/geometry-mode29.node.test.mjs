/** 各版の実main入口を同一の模擬選択/計画で比較する。実機検査ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { captureGeometryPolicy29, assertGeometryPolicy29, distinctPlannedMoves29 } from '../src/ui/workspace-geometry-policy29.js';
import { createWorkspaceEditIntent, workspacePreviewEditOperation, workspaceEditSelectionIdentity } from '../src/ui/workspace-edit-intent.js';
import { createEditorSelection21 } from '../src/ui/editor-selection21.js';
import { lockedMovement26, planLayerMove26, studioProgressModel26 } from '../src/ui/editor-arrangement26.js';
import { siteText } from '../src/i18n/site-messages.js';
const url=process.env.JSONUI_REGRESSION_PRODUCT ? pathToFileURL(process.env.JSONUI_REGRESSION_PRODUCT+'/editor-core/src/main.js') : new URL('../src/main.js',import.meta.url);
const main=await readFile(url,'utf8');
const part=(a,b)=>{const start=main.indexOf(a),end=main.indexOf(b,start);assert(start>=0&&end>start);return main.slice(start,end);};
const flat=v=>typeof v==='object'&&v!==null?[v,...(v.children||[]).flatMap(flat)]:[];
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function harness(mode='interaction',ids=['image']) {
 const nodes={root:{children:['button','other']},button:{type:'button',props:{offset:[40,50],size:[20,20]},children:['image','label']},
  image:{type:'image',props:{offset:[2,3],size:[10,10]},children:[]},label:{type:'label',props:{offset:[4,5],size:[8,8]},children:[]},
  other:{type:'button',props:{offset:[80,20],size:[20,20]},children:['otherImage']},otherImage:{type:'image',props:{offset:[0,0],size:[10,10]},children:[]}};
 const paths={button:'/screen/controls/0/button',image:'/screen/controls/0/button/controls/0/image',label:'/screen/controls/0/button/controls/1/label',other:'/screen/controls/1/other',otherImage:'/screen/controls/1/other/controls/0/image'};
 const file={id:'f',path:'ui/a.json',nodesById:nodes,uiModel:{root:{id:'root'}},meta:{selectedDefinition:{rawKey:'screen'}}};
 const selection=createEditorSelection21(); selection.useScreen('a',{...file,rootId:'root'});selection.setSelection(ids);
 const state={workspaceId:'w',sourceKey:'stack',mode:'edit',revision:'r',pendingVersion:0,editScope:'screen',editTargetMode:mode,busy:false,
  pendingOperations:[],pendingCommitUncertain:false,editGeneratedTemplate:false};
 const operations=[],calls=[]; let waitSelection=null,waitPlan=null;
 const select=id=>({fileId:'f',nodeId:id,path:'ui/a.json',pointer:'/definition_'+id,sourceId:'pack',previewDefinitionId:'a.screen',effectivePointer:paths[id],screen:{path:'ui/a.json',pointer:'/screen',sourceId:'pack'}});
 const sync=id=>{const s=select(id);Object.assign(state,{previewSelection:s,selectedPointer:s.pointer,activePath:s.path,activeSourceId:s.sourceId});return s;};
 sync(ids[0]);
 const intent=createWorkspaceEditIntent({state,notify(){},request:async(_,{operation})=>{
  calls.push(operation);if(waitPlan)await waitPlan.promise;
  const id=state.previewSelection.nodeId, owner=operation.targetMode==='interaction'?(['image','label'].includes(id)?'button':id==='otherImage'?'other':id):id;
  return{ok:true,editPlan:{targetMode:operation.targetMode,scope:'screen',target:{effectivePointer:paths[owner],type:nodes[owner].type,props:nodes[owner].props},
   affectedInstances:1,requiresTemplateConsent:false,generated:null,ids:[owner]}};
 }});
 const ws={state,setEditOptions:intent.setOptions,planPreviewEdit:intent.plan,pendingNodeTransforms:()=>new Map(),
  movePreviewElement:delta=>intent.enqueue({type:'move',delta},(op)=>{operations.push(op);return{ok:true};}),
  editPreviewProperty:(property,value)=>intent.enqueue({type:'set',property,value},(op)=>{operations.push(op);return{ok:true};}),
  editPendingAddition(){},queueOperations:(ops,opts)=>{operations.push(...ops);calls.push({queue:opts});}};
 const c=vm.createContext({console,Map,Set,Date,JSON,Number,Object,String,Promise,Error,siteText,
  captureGeometryPolicy29,assertGeometryPolicy29,distinctPlannedMoves29,workspacePreviewEditOperation,workspaceEditSelectionIdentity,
  lockedMovement26,planLayerMove26,studioProgressModel26,sourceWorkspace:ws,
  store:{getState:()=>({files:{currentFileId:'f',byId:{f:file}}}),dispatch(){}},
  studioSelection21:()=>selection,workspaceSourceKey:()=>'stack',studioPreviewSelection21:(_,id)=>select(id),
  selectSourceForCanvasNode:async(_,id)=>{if(waitSelection)await waitSelection.promise;intent.invalidate({keepConsent:true});return sync(id);},
  movementDelta21:(a,b)=>[b.x-a.x,b.y-a.y],buildWorkspacePreviewSourceMap:()=>({}),resolvePlannedPreviewNodeIds22:(_,plan)=>plan.ids,
  requestCanvasTextureRedraw(){},safeRender(){},setStatus(){},studioInvoke:fn=>fn(),
  h:(tag,attrs={},children=[])=>({tag,attrs,children}),
 });
 vm.runInContext(part('const studioLocks26 =','async function studioArrange26(')+part('function studioNodeLabel26(','function renderStudioNavigation26('),c);
 vm.runInContext(part('async function commitSourceCanvasMove(','async function addSourceCanvasElement(')+part('function renderStudioProperties26(','function renderSourceWorkspaceInspector('),c);
 // ロックを調べる実mainラッパーも検査する。
 vm.runInContext(part('const studioEditPreviewProperty26 =','const studioEditPendingAddition26 ='),c);
 return{c,state,file,operations,calls,ws,selection,select:sync,intent,paths,
  waitSelection:()=>waitSelection=defer(),waitPlan:()=>waitPlan=defer(),
  drag:()=>c.commitSourceCanvasMove(file,ids[0],{}, {x:11,y:7},{x:0,y:0})};
}
for(const mode of ['interaction','visual'])for(const ids of [['image'],['image','otherImage']])test(`R29 実main: ${mode} / ${ids.length}要素の要求を保持`,async()=>{
 const f=harness(mode,ids);await f.drag();assert.equal(f.state.editTargetMode,mode);assert.equal(f.operations.length,ids.length);
 for(const op of f.operations)assert.equal(op.targetMode,mode);assert.deepEqual(Array.from(f.operations[0].delta),[11,7]);
});
for(const change of [s=>s.editTargetMode='visual',s=>s.revision='different',s=>s.pendingVersion++])test('R29 実main: 選択待機中の設定/版/草稿変更は保存しない',async()=>{
 const f=harness(),wait=f.waitSelection();const job=f.drag();change(f.state);wait.resolve();await assert.rejects(job,{code:'WORKSPACE_SELECTION_SUPERSEDED'});assert.equal(f.operations.length,0);
});
test('R29 実main: 機能親のロックは子画像から迂回できない',async()=>{const f=harness();f.c.studioToggleLock26('button');await assert.rejects(f.drag(),{code:'EDITOR_ELEMENT_LOCKED'});assert.equal(f.operations.length,0);});
test('R29 実main: 機能親内の別の子孫ロックも迂回できない',async()=>{const f=harness();f.c.studioToggleLock26('label');await assert.rejects(f.drag(),{code:'EDITOR_ELEMENT_LOCKED'});assert.equal(f.operations.length,0);});
test('R29 実main: 明示visualなら無関係な兄弟ロックは妨げない',async()=>{const f=harness('visual');f.c.studioToggleLock26('label');await f.drag();assert.equal(f.operations[0].targetMode,'visual');});
test('R29 実main: 事前計画の待機中に対象モードが変わった要求を保存しない',async()=>{
 const f=harness(),w=f.waitPlan();const job=f.drag();await new Promise(r=>setTimeout(r,0));f.state.editTargetMode='visual';w.resolve();await assert.rejects(job,{code:'WORKSPACE_SELECTION_SUPERSEDED'});assert.equal(f.operations.length,0);
});
test('R29 実main: 同じボタンの画像/文字を複数選択しても親の移動は1回',async()=>{
 const f=harness('interaction',['image','label']);await f.drag();assert.equal(f.operations.length,1);assert.deepEqual(Array.from(f.calls.find(x=>x.queue).queue.previewNodeIds[0]),['button']);
});
test('R29 実main: 機能込みの基本数値欄は画像ではなく親の値を表示する',async()=>{
 const f=harness();await f.ws.planPreviewEdit();const view=f.c.renderStudioProperties26(f.file),all=flat(view);
 assert.equal(all.find(n=>n.attrs.id==='studio-geometry26-offset-0').attrs.value,'40');
 assert.equal(all.find(n=>n.attrs.id==='studio-geometry26-size-0').attrs.value,'20');
 all.find(n=>n.attrs.id==='studio-geometry26-offset-0').attrs.onInput({currentTarget:{value:'60'}});
 await all.find(n=>n.tag==='button'&&n.children.includes('位置を変更')).attrs.onClick();
 assert.equal(f.operations[0].targetMode,'interaction');assert.deepEqual(Array.from(f.operations[0].value),[60,50]);
});
test('R29 実main: 機能親未確認では子画像基準の数値を入力させない',()=>{const f=harness();const all=flat(f.c.renderStudioProperties26(f.file));assert(!all.some(n=>n.attrs.id==='studio-geometry26-offset-0'));assert(all.some(n=>n.tag==='button'&&n.children.includes('操作本体を確認')));});
test('R29 実main: 古い数値欄を別モードの対象へ保存しない',async()=>{
 const f=harness();await f.ws.planPreviewEdit();const all=flat(f.c.renderStudioProperties26(f.file));f.state.editTargetMode='visual';
 await assert.rejects(all.find(n=>n.tag==='button'&&n.children.includes('位置を変更')).attrs.onClick(),{code:'WORKSPACE_SELECTION_SUPERSEDED'});assert.equal(f.operations.length,0);
});
for(const patch of [{generated:'grid'},{requiresTemplateConsent:true},{affectedInstances:2}])test('R29 複数計画: 共有/生成範囲へ暗黙の同意を与えない',()=>{
 assert.throws(()=>distinctPlannedMoves29([{plan:{target:{effectivePointer:'/a'},...patch},targetIds:['a'],operation:{screen:{}}}]),{code:'WORKSPACE_GROUP_SHARED_TARGET'});
});
test('R29 複数計画: 親子を二重移動せず、別画面は混同しない',()=>{
 const e=(p,screen)=>({plan:{target:{effectivePointer:p}},targetIds:[p],operation:{screen}});
 assert.deepEqual(distinctPlannedMoves29([e('/a',{id:1}),e('/a/b',{id:1}),e('/a/b',{id:2})]).map(x=>x.pointer),['/a','/a/b']);
});
test('R29 実main: サイズの数値変更も機能本体のモードを保持',async()=>{
 const f=harness();await f.ws.planPreviewEdit();const all=flat(f.c.renderStudioProperties26(f.file));
 all.find(n=>n.attrs.id==='studio-geometry26-size-0').attrs.onInput({currentTarget:{value:'30'}});
 await all.find(n=>n.tag==='button'&&n.children.includes('サイズを変更')).attrs.onClick();
 assert.equal(f.operations[0].targetMode,'interaction');assert.equal(f.operations[0].property,'size');assert.equal(f.operations[0].value[0],30);
});
for(const [property,value] of [['offset',''],['offset','Infinity'],['offset','abc'],['size','-1']])
 test(`R29 実main: ${property} の不正数値 ${JSON.stringify(value)} を保存しない`,async()=>{
 const f=harness('visual');const all=flat(f.c.renderStudioProperties26(f.file));
 all.find(n=>n.attrs.id===`studio-geometry26-${property}-0`).attrs.onInput({currentTarget:{value}});
 await assert.rejects(all.find(n=>n.tag==='button'&&n.children.includes(property==='offset'?'位置を変更':'サイズを変更')).attrs.onClick());
 assert.equal(f.operations.length,0);
});
