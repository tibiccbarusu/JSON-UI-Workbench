import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createLocalToggleState, normalizeLocalToggleState } from '../src/preview/local-toggle-state.js';
import { summarizeBindingQuality } from '../src/engine/binding-quality40.js';
import { studioProgressModel26 } from '../src/ui/editor-arrangement26.js';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';
import { siteText, translateSiteMessage } from '../src/i18n/site-messages.js';
import { setImmediate } from 'node:timers/promises';
import { createNodeFrameController, intrinsicSizeOverrides, requestNodeFramePayload, describeNodeFrameError } from '../src/ui/node-frame-controller.js';
import { createLocalServer } from '../../local-node/server.mjs';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { prepareNodeFrameFile } from '../src/engine/node-frame-wire.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';
import { buildRepresentativeClassicCollections } from '../src/engine/representative-classic-runtime.js';
import { renderPreviewStateControls, createPreviewPlayback } from '../src/ui/preview-workspace.js';
import { previewLayoutInputKey } from '../src/preview/interaction-frame-readiness.js';
const settle = async (predicate) => { for (let i=0;i<1000;i++) { if(predicate()) return; await setImmediate(); } throw Error('test did not settle'); };
function queueHarness() {
  const requests=[],callbacks=[],results=[],errors=[];
  const controller=createNodeFrameController({request: input=>{requests.push(input);return new Promise((resolve,reject)=>callbacks.push({resolve,reject,input}));},onResult:(result,job)=>results.push({result,job}),onError:error=>errors.push(error)});
  function complete(index){const {resolve,input}=callbacks[index];resolve({schema:'jsonui-frame-v1',modelId:'model-a',generation:input.generation,layout:{boxes:[]}});}
  return {controller,requests,callbacks,results,errors,complete};
}
test('5000フレーム要求でも送信中1件＋最新待機1件に限定し時間が進む', async()=>{
  const h=queueHarness(),file={};
  for(let n=0;n<5000;n++)h.controller.submit({file,contextKey:'stateA',input:{animationTime:n/100}});
  assert.equal(h.requests.length,1);assert.equal(h.controller.snapshot().pending,1);
  h.complete(0);await setImmediate();
  assert.equal(h.results.length,1);assert.equal(h.requests.length,2);assert.equal(h.requests[1].animationTime,49.99);
  assert.equal(h.requests[1].modelId,'model-a');assert.equal(h.requests[1].file,undefined);
  h.complete(1);await setImmediate();assert.equal(h.results.length,2);assert.equal(h.controller.snapshot().pending,0);
});
test('状態変更・ファイル切替前の古い応答は表示しない',async()=>{
  const h=queueHarness(),file={};h.controller.submit({file,contextKey:'old',input:{}});h.controller.submit({file,contextKey:'new',input:{}});
  h.complete(0);await setImmediate();assert.equal(h.results.length,0);h.complete(1);await setImmediate();assert.equal(h.results.length,1);
  h.controller.submit({file,contextKey:'new',input:{}});h.controller.invalidate();h.complete(2);await setImmediate();assert.equal(h.results.length,1);
});
test('モデル失効はfile付き1回だけ再試行する',async()=>{
  const h=queueHarness(),file={};h.controller.submit({file,contextKey:'A',input:{}});h.complete(0);await setImmediate();
  h.controller.submit({file,contextKey:'A',input:{}});h.callbacks[1].reject(Error('NODE_FRAME_MODEL_STALE'));await setImmediate();
  assert.equal(h.requests[2].file,file);assert.equal(h.requests[2].modelId,undefined);h.callbacks[2].reject(Error('NODE_FRAME_MODEL_STALE'));await setImmediate();
  assert.equal(h.requests.length,3);assert.equal(h.errors.length,1);assert.equal(h.controller.snapshot().modelRetries,1);
});
test('応答schemaとgenerationの不一致は診断して次要求へ回復する',async()=>{
  const h=queueHarness(),file={};h.controller.submit({file,contextKey:'A',input:{}});h.callbacks[0].resolve({schema:'bad'});await setImmediate();
  assert.equal(h.errors[0].message,'NODE_FRAME_RESPONSE_INVALID');h.controller.submit({file,contextKey:'A',input:{}});h.complete(1);await setImmediate();assert.equal(h.results.length,1);
});
test('intrinsic補正は表示寸法だけでtext/visibleを旧値へ戻さない',()=>{
  const base={a:{text:'old',size:[10,10]},b:{size:[8,8]}},measured={a:{text:'old',visible:false,size:[20,10]},b:{size:[8,8]}};
  const result=intrinsicSizeOverrides(base,measured);assert.deepEqual(JSON.parse(JSON.stringify(result)),{a:{size:[20,10]}});result.a.size[0]=50;assert.equal(measured.a.size[0],20);
});
test('文字内在寸法だけの補正を送り宣言sizeやbindingを複写しない',()=>{
  const name='__jsonui_preview_text_intrinsic_size';
  const base={a:{size:[32,8],text:'new'}},measured={a:{size:[32,8],text:'old',visible:false,[name]:[12,8]}};
  const result=intrinsicSizeOverrides(base,measured);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{a:{[name]:[12,8]}});
  result.a[name][0]=99;assert.equal(measured.a[name][0],12);
  assert.equal(Object.keys(intrinsicSizeOverrides(measured,measured)).length,0);
  for(const invalid of [[NaN,8],[-1,8],[Infinity,8],[10_000_001,8],['12',8],[12],[,8],[12,,]]) {
    assert.equal(Object.keys(intrinsicSizeOverrides(base,{a:{...base.a,[name]:invalid}})).length,0);
  }
});
test('状態ファイル読込は上限と構文を確認し適用を自動実行しない',async()=>{
  const rows=[],state={text:'{}'};let applies=0;
  const h=(tag,attrs={},children=[])=>{const row={tag,attrs,children};rows.push(row);return row;};
  renderPreviewStateControls(h,{state,presets:[],onApply:()=>applies++,onPreset(){},onDownload(){}});
  const fileInput=rows.find(r=>r.attrs.type==='file'),textarea=rows.find(r=>r.tag==='textarea');
  const input={files:[{size:16,text:async()=>'{"mockData":{}}'}],value:'x'};
  await fileInput.attrs.onChange({currentTarget:input});assert.equal(state.text,'{"mockData":{}}');assert.equal(textarea.value,state.text);assert.equal(applies,0);assert.equal(input.value,'');
  input.files=[{size:1048577,text:async()=>{throw Error('must not read');}}];await fileInput.attrs.onChange({currentTarget:input});assert.match(state.message,/1 MiB/);
  input.files=[{size:1,text:async()=>'{'}];await fileInput.attrs.onChange({currentTarget:input});assert.match(state.message,/読込できません/);assert.equal(applies,0);
});
test('60秒超の有限アニメーションも定義時間までシークできる',()=>{
  let value;const p=createPreviewPlayback({requestFrame:()=>0,cancelFrame(){},canPlay:()=>true,onFrame:t=>value=t});p.setLimit(180);p.seek(150);assert.equal(value,150);p.setLimit(5000);p.seek(9999);assert.equal(value,3600);
});
test('本番structural署名は値のみ変更を除外し個数とfactory変更を保持',async()=>{
  const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');const start=source.indexOf('function pickResolverCompositionData(value)'),end=source.indexOf('\nlet projectionRefreshRequestedRevision',start);
  const context=vm.createContext({buildRepresentativeClassicCollections});vm.runInContext(source.slice(start,end)+'\nthis.pick=pickResolverCompositionData;',context);
  const pick=data=>JSON.stringify(context.pick(data));
  assert.equal(pick({__collections:{rows:[{'#text':'A'}]}}),pick({__collections:{rows:[{'#text':'B'}]}}));
  assert.notEqual(pick({__collections:{rows:[]}}),pick({__collections:{rows:[{}]}}));
  assert.notEqual(pick({__collections:{rows:[{__jsonui_preview_factory_control_id:'a'}]}}),pick({__collections:{rows:[{__jsonui_preview_factory_control_id:'b'}]}}));
  assert.notEqual(pick({$x:1}),pick({$x:2}));
});
test('本番ensurePreviewLayout→実HTTP Node Worker IR: browser layout0回・状態と時刻を反映',async t=>{
  const app=await createLocalServer({port:0});t.after(()=>app.close());const base=`http://127.0.0.1:${app.port}/api/node/`,cap=await(await fetch(base+'capabilities')).json();assert.equal(cap.features.frameIr,true);
  const uiModel=buildUiScreenModelFromJson({namespace:'wire',screen:{type:'screen',controls:[{label:{type:'label',text:'#title',bindings:[{binding_name:'#title',binding_name_override:'#text'}]}},{image:{type:'image',size:[10,10],texture:'textures/ui/slot',anims:['@wire.move']}}]}},{filePath:'ui/wire.json'});
  const file={id:'wire',...buildTreeFromUiScreenModel(uiModel),uiModel,meta:{selectedDefinition:{qualifiedName:'wire.screen'},resolution:{animationDefinitions:{definitions:{'wire.move':{anim_type:'offset',from:[0,0],to:[20,0],duration:2}}}}}};
  const label=Object.keys(file.nodesById).find(id=>file.nodesById[id].props.name==='label'),image=Object.keys(file.nodesById).find(id=>file.nodesById[id].props.name==='image');
  const cs={layout:{boxes:[],stats:{}},scrollById:{},view:{}},state={files:{currentFileId:'wire',byId:{wire:file}},ui:{previewLocale:'ja_JP'},preview:{mockDataVersion:1,mockData:{'#title':'日本語'}}};
  const errors=[],requests=[],renders=[];let measures=0;
  const context=vm.createContext({crypto:webcrypto,createLocalToggleState,normalizeLocalToggleState,summarizeBindingQuality,studioProgressModel26,sourceWorkspace:createWorkspaceEditor({request(){throw Error('unexpected workspace request');}}), siteText, translateSiteMessage, workspaceSourceFrameRequired:false, previewLayoutInputKey,performance,prepareNodeFrameFile,requestNodeFramePayload,describeNodeFrameError,createNodeFrameController,intrinsicSizeOverrides,document:{getElementById:()=>null},store:{getState:()=>state},getCanvasKey:id=>id,getCanvasState:()=>cs,getLogicalCanvasPreset:()=>({width:320,height:180}),getSelectedPreviewQualifiedName:()=> 'wire.screen',canvasUiState:{byFileKey:{wire:cs}},previewAssetMetricsRevision:0,previewAnimationEvent:'screen.entrance_push',previewPlayback:{state:{seconds:0,playing:false},pause(){}},previewPerformance:{record(){}},scheduledWorkspaceRender:{request:()=>renders.push(1)},findCanvasUiFocusBounds:()=>null,drawCanvasNow(){},diagnostics:{captureError:e=>errors.push(e)},mergeCachedTextureIntrinsicSizes:(_f,p)=>p,mergeTextIntrinsicSizes:(_f,p)=>{measures++;return {...p,[label]:{...p[label],size:[36,8]}};},supportsNodeFrameIr:async()=>true,
    renderNodeFrame:async payload=>{requests.push(payload);const response=await fetch(base+'frame',{method:'POST',headers:{'X-JSONUI-Token':cap.token,'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;},
    getOrComputeBindingsEvalResult:()=>{throw Error('browser bindings must not run');},computeLayoutBoxesForFile:()=>{throw Error('browser layout must not run');}});
  const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');const start=source.indexOf('let nodeFrameAvailability = null;'),end=source.indexOf('\nconst previewViewport =',start);
  const fn = name => { const begin=source.indexOf(`function ${name}(`), end=source.indexOf('\n}\n',begin); assert(begin>=0&&end>begin); return source.slice(begin,end+3); };
  const progressStart=source.indexOf('const studioActivities26 ='),progressEnd=source.indexOf('const sourceWorkspace = createWorkspaceEditor(',progressStart); assert(progressStart>=0&&progressEnd>progressStart);
  vm.runInContext(source.slice(progressStart,progressEnd)+'\nthis.progressActivityCount=()=>studioActivities26.size;',context);
  vm.runInContext(['studioRuntimeChangesBlocked21','workspacePreviewBlocked','syncWorkspacePreviewGate','ensureLocalToggleSession40'].map(fn).join('\n'),context);
  vm.runInContext(source.slice(start,end).replaceAll('import.meta.url','"file:///main.js"')+'\nnodeFrameAvailability=true;this.ensure=ensurePreviewLayout;this.frame=requestPreviewNodeFrame;this.queue=nodeFrameController;this.processingStatus=()=>previewProcessingStatus;',context);
  for(let i=0;i<1000;i++)context.ensure(state);
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,10));if(context.queue.snapshot().completed>=2&&!context.queue.snapshot().inFlight)break;}
  assert.deepEqual(errors,[]);assert.match(context.processingStatus(),/^Node計算 \//u);assert.equal(requests.length,2);assert.equal(typeof requests[1].modelId,'string');assert(!requests[1].file);assert.equal(cs.propsByIdOverride[label].text,'日本語');assert.equal(cs.layout.boxes.find(b=>b.id===label).w,36);assert.equal(measures,1);
  const firstX=cs.layout.boxes.find(b=>b.id===image).x;context.frame(state,file,cs,cs.layoutInputKey,1);
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,10));if(context.queue.snapshot().completed>=3)break;}
  assert.equal(cs.layout.boxes.find(b=>b.id===image).x-firstX,10);assert.equal(renders.length,1);
  state.preview={mockDataVersion:2,mockData:{'#title':'変更後'}};context.ensure(state);
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,10));if(context.queue.snapshot().completed>=5)break;}
  assert.equal(cs.propsByIdOverride[label].text,'変更後');assert.deepEqual(errors,[]);assert.equal(measures,2);assert.equal(context.progressActivityCount(),0,'実frame完了後は進捗追跡を残さない');
});

test('失効した投影は旧packモデルを送信せず再選択を促し編集モデルはfileで送る',async()=>{
  const file={readOnly:true,path:'ui/a.json',meta:{resolution:{nodeProjectionId:'a'.repeat(64)}}},sent=[];let prepares=0;
  const prepareFile=source=>{prepares++;return {source:true};};
  await assert.rejects(requestNodeFramePayload({file,generation:1},{prepareFile,request:async input=>{sent.push(input);throw Error('NODE_FRAME_PROJECTION_STALE');}}),/選び直してください/);
  assert.equal(sent.length,1);assert.equal(prepares,0);assert.equal(sent[0].file,undefined);
  file.readOnly=false;sent.length=0;await requestNodeFramePayload({file},{prepareFile,request:async input=>{sent.push(input);return {};}});assert.equal(sent[0].projectionId,undefined);assert.equal(sent[0].file.source,true);
  file.readOnly=true;await assert.rejects(requestNodeFramePayload({file},{prepareFile,request:async()=>{throw Error('NODE_FRAME_PROJECTION_IDENTITY_MISMATCH');}}),/IDENTITY_MISMATCH/);
});
test('実catalog→project→参照IDだけの初回Node frameはfile送信なしで同じtreeを描画する',async t=>{
  const {resourceFixture}=await import('../../local-node/tests/fixtures.mjs');const {randomUUID}=await import('node:crypto');
  const app=await createLocalServer({port:0});t.after(()=>app.close());const base=`http://127.0.0.1:${app.port}/api/node/`,cap=await(await fetch(base+'capabilities')).json();
  const post=async(route,data)=>{const response=await fetch(base+route,{method:'POST',headers:{'X-JSONUI-Token':cap.token,'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;};
  const id=randomUUID(),upload=await fetch(base+'packs',{method:'POST',headers:{'X-JSONUI-Token':cap.token,'X-JSONUI-Name':'fixture.zip','X-JSONUI-Upload-ID':id},body:resourceFixture()});assert.equal(upload.status,200);await upload.arrayBuffer();
  const catalog=await post('catalog',{sources:[{kind:'imported',id}]}),record=catalog.records.find(r=>r.localName==='screen'),projection=await post('project',{catalogId:catalog.nodeCatalogId,recordId:record.id});
  const uiModel=buildUiScreenModelFromJson(projection.document,{filePath:projection.selected.filePath});const file={readOnly:true,path:projection.selected.filePath,...buildTreeFromUiScreenModel(uiModel),uiModel,meta:{selectedDefinition:projection.selected,resolution:{nodeProjectionId:projection.nodeProjectionId}}};
  const sent=[];const result=await requestNodeFramePayload({file,generation:1,preset:{width:320,height:180}},{prepareFile:()=>{throw Error('normal projection must not upload file');},request:input=>{sent.push(input);return post('frame',input);}});
  assert.equal(result.schema,'jsonui-frame-v1');assert(result.layout.boxes.length>0);assert.equal(sent.length,1);assert.equal(sent[0].file,undefined);assert(Buffer.byteLength(JSON.stringify(sent[0]))<500);assert(result.layout.boxes.every(box=>file.nodesById[box.id]));
});

test('シークを先頭へ戻した後に届く過去の終端frameを表示しない',async()=>{
  const h=queueHarness(),file={};h.controller.submit({file,contextKey:'A',input:{animationTime:2}});h.controller.submit({file,contextKey:'A',input:{animationTime:0}});
  h.complete(0);await setImmediate();assert.equal(h.results.length,0);h.complete(1);await setImmediate();assert.equal(h.results.length,1);assert.equal(h.results[0].job.input.animationTime,0);
  h.controller.submit({file,contextKey:'A',input:{animationTime:3}});h.controller.submit({file,contextKey:'A',input:{animationTime:0}});h.callbacks[2].reject(Error('obsolete frame failed'));await setImmediate();assert.equal(h.errors.length,0);h.complete(3);await setImmediate();
});

test('Nodeのモデル上限・応答上限・期限・世代失効を別の日本語復旧案内にする',()=>{
  assert.match(describeNodeFrameError(Error('NODE_FRAME_MODEL_LIMIT')),/64 MiB/);assert.match(describeNodeFrameError(Error('NODE_FRAME_REPLY_LIMIT')),/24 MiB/);
  assert.match(describeNodeFrameError(Error('NODE_BODY_LIMIT')),/16 MiB/);assert.match(describeNodeFrameError({name:'TimeoutError'}),/制限時間/);
  assert.match(describeNodeFrameError(Error('NODE_FRAME_PROJECTION_STALE')),/選び直してください/);assert.match(describeNodeFrameError(Error('POCKET_PREVIEW_BLOCKED')),/Classic/);
});
