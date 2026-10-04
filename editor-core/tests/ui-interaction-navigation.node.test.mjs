/** 非同期UI open/遷移の実main関数を抽出し、I/Oの完了順をNodeで制御する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalToggleState } from '../src/preview/local-toggle-state.js';
import { setup } from './helpers/navigation-main-harness.mjs';
const openEvents=h=>h.events.filter(x=>x.type==='preview/navCommit');
const historyEvents=h=>h.events.filter(x=>x.type==='preview/navCommit');
test('通常の遅延openは一度だけcommitし、監視を解除する',async()=>{
 const h=setup();const pending=h.start();h.release();assert.equal(await pending,true);assert.equal(openEvents(h).length,1);assert.equal(historyEvents(h).length,1);assert.equal(h.listeners.size,0);assert.equal(h.sandbox.screenOpenState.status,'ready');
});
test('既存タブの高速遷移も正常に履歴へ記録しreadOnlyを維持する',async()=>{
 const h=setup({fast:true});assert.equal(await h.start(),true);assert.equal(openEvents(h).length,1);assert.equal(historyEvents(h).length,1);assert.equal(h.state.files.byId[h.target.id],h.target);assert.equal(h.state.files.byId[h.target.id].readOnly,true);assert.equal(h.listeners.size,0);
});
for(const [label,mutate] of [
 ['操作OFF',h=>h.dispatch({type:'preview/setNavEnabled',enabled:false})],
 ['OFFからONへ戻す',h=>{h.dispatch({type:'preview/setNavEnabled',enabled:false});h.dispatch({type:'preview/setNavEnabled',enabled:true});}],
 ['別タブへ移動',h=>h.dispatch({type:'files/setCurrentFile',fileId:'other'})],
 ['別タブから元へ戻す',h=>{h.dispatch({type:'files/setCurrentFile',fileId:'other'});h.dispatch({type:'files/setCurrentFile',fileId:h.origin.id});}],
 ['遷移元タブを閉じる',h=>h.dispatch({type:'files/closeFile',fileId:h.origin.id})],
 ['元モデルを差し替える',h=>h.dispatch({type:'files/replaceModel'})],
 ['パックを差し替える',h=>h.dispatch({type:'pack/replace'})],
 ['runtimeを差し替える',h=>{h.sandbox.importedPackRuntime={};}],
 ])test(`loading中に${label}と古い遷移をcommitしない`,async()=>{
 const h=setup();const pending=h.start();assert.equal(h.sandbox.screenOpenState.status,'loading');mutate(h);h.release();assert.equal(await pending,false);assert.equal(openEvents(h).length,0);assert.equal(historyEvents(h).length,0);assert.notEqual(h.sandbox.screenOpenState.status,'loading');assert.equal(h.listeners.size,0);
 });
test('同じ未完了要求を集約し一度だけcommitする',async()=>{
 const h=setup();const old=h.start(),newer=h.start();h.release();assert.equal(await old,true);assert.equal(await newer,true);assert.equal(openEvents(h).length,1);assert.equal(historyEvents(h).length,1);assert.equal(h.listeners.size,0);
});
test('同じファイル内で別の定義へ遷移できる',async()=>{
 const h=setup({targetId:'screen:ui/origin.json',targetDefinition:'test.second'});const pending=h.start();h.release();assert.equal(await pending,true);assert.equal(h.state.files.currentFileId,h.origin.id);assert.equal(historyEvents(h).length,1);
});
test('高速既存open前でもcanCommitがfalseなら選択を変更しない',async()=>{
 const h=setup({fast:true});assert.equal(await h.sandbox.api.ensureScreenFileOpen(h.target.id,'test.target',{canCommit:()=>false}),false);assert.equal(h.state.files.currentFileId,h.origin.id);
});
test('処理終了後の購読者は残らず、以後のタブ選択を妨げない',async()=>{
 const h=setup();const pending=h.start();h.release();await pending;assert.equal(h.listeners.size,0);h.dispatch({type:'files/setCurrentFile',fileId:h.origin.id});assert.equal(h.state.files.currentFileId,h.origin.id);
});
for(const gateStage of ['resolve','validate','frame'])test(`${gateStage}の完了待ちでも取消後にopenFileしない`,async()=>{
 const h=setup({gateStage});const pending=h.start();await h.gateReached;h.dispatch({type:'preview/setNavEnabled',enabled:false});h.release();assert.equal(await pending,false);assert.equal(openEvents(h).length,0);assert.equal(historyEvents(h).length,0);assert.notEqual(h.sandbox.screenOpenState.status,'loading');assert.equal(h.listeners.size,0);
});
test('既存の遷移先を閉じると別定義への読み直しも復活させない',async()=>{
 const h=setup({fast:true});h.state.files.byId[h.target.id].meta.selectedDefinition.qualifiedName='test.previous';const pending=h.start();await h.gateReached;h.dispatch({type:'files/closeFile',fileId:h.target.id});h.release();assert.equal(await pending,false);assert.equal(openEvents(h).length,0);assert.equal(historyEvents(h).length,0);assert.notEqual(h.sandbox.screenOpenState.status,'loading');
});
test('toolbarは操作OFFでも共通取引を通り、dirtyでは開始しない',async()=>{
 const h=setup();h.dispatch({type:'preview/setNavEnabled',enabled:false});
 const pending=h.sandbox.api.navigateToScreenFile({packPath:'ui/target.json',qualifiedName:'test.target'},'push');h.release();
 assert.equal(await pending,true);assert.equal(historyEvents(h).length,1);
 const dirty=setup();dirty.sandbox.runtimeStateEditor.dirty=true;assert.equal(await dirty.sandbox.api.navigateToScreenFile(dirty.target.id,'push',undefined,'test.target'),false);assert.equal(historyEvents(dirty).length,0);
});
test('toolbar要求中のOFF→ON→OFFも古い要求を復活させない',async()=>{
 const h=setup();h.dispatch({type:'preview/setNavEnabled',enabled:false});const pending=h.sandbox.api.navigateToScreenFile(h.target.id,'push',undefined,'test.target');
 h.dispatch({type:'preview/setNavEnabled',enabled:true});h.dispatch({type:'preview/setNavEnabled',enabled:false});
 assert.equal(await pending,false);h.release();assert.equal(historyEvents(h).length,0);
});
test('取消された同一要求の直後のクリックは新しい取引として扱う',async()=>{
 const h=setup();const old=h.start();h.dispatch({type:'preview/setNavEnabled',enabled:false});h.dispatch({type:'preview/setNavEnabled',enabled:true});const next=h.start();h.release();
 assert.equal(await old,false);assert.equal(await next,true);assert.equal(historyEvents(h).length,1);
});
test('catalog世代が変わると既存のprepared projectionをcommitしない',async()=>{
 const h=setup();const pending=h.start();h.sandbox.uiCatalogState.generation++;h.release();assert.equal(await pending,false);assert.equal(historyEvents(h).length,0);
});
test('期限で呼出元を解放し、後から完了するI/Oもcommitしない',async()=>{
 const h=setup();h.sandbox.setTimeout=(fn,ms)=>setTimeout(fn,ms===30000?5:ms);const pending=h.start();
 assert.equal(await pending,false);assert.equal(h.listeners.size,0);assert.equal(h.sandbox.navigationUiState.lastResolution.code,'UI_NAVIGATION_TIMEOUT');
 h.release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(historyEvents(h).length,0);
});
test('別centerタブへ移動して戻っても取消済みの要求は採用しない',async()=>{
 const h=setup();const pending=h.start();h.dispatch({type:'ui/setEditorTab',area:'center',tabId:'json'});h.dispatch({type:'ui/setEditorTab',area:'center',tabId:'canvas'});
 h.release();assert.equal(await pending,false);assert.equal(historyEvents(h).length,0);
});
test('同じ既存targetでも不正な履歴indexを成功扱いせず表示状態を維持する',async()=>{
 const h=setup({fast:true});assert.equal(await h.start(),true);const before=h.state.preview.navigation,canvas=h.canvas.get(h.target.id);
 canvas.scrollById={viewport:{x:0,y:25}};
 assert.equal(await h.sandbox.api.navigateToScreenFile({packPath:'ui/target.json',qualifiedName:'test.target'},'setIndex',99),false);
 assert.equal(h.state.preview.navigation,before);assert.equal(canvas.scrollById.viewport.y,25);assert.equal(historyEvents(h).length,1);
});
test('準備中に履歴が差し替わったら元indexを使ってcommitしない',async()=>{
 const h=setup();const pending=h.start();h.dispatch(h.sandbox.actions.navReset({packPath:'ui/origin.json',qualifiedName:'test.origin'}));
 h.release();assert.equal(await pending,false);assert.equal(historyEvents(h).length,0);assert.equal(h.state.preview.navigation.index,0);
});
test('準備中のmockData適用で古い入力のframeをcommitしない',async()=>{
 const h=setup({gateStage:'frame'});const pending=h.start();await h.gateReached;
 h.dispatch(h.sandbox.actions.setMockData({'#new_state':true}));h.release();assert.equal(await pending,false);assert.equal(historyEvents(h).length,0);
});
test('mockData参照が同一でもversion変更で古い要求を失効する',async()=>{
 const h=setup();const pending=h.start();h.state.preview.mockDataVersion=1;h.dispatch({type:'preview/noop'});h.release();
 assert.equal(await pending,false);assert.equal(historyEvents(h).length,0);
});
test('同じruntimeのin-place RP変更世代も古い要求を失効する',async()=>{
 const h=setup();const pending=h.start();h.sandbox.resourcePackMutationEpoch++;h.dispatch({type:'preview/noop'});h.release();
 assert.equal(await pending,false);assert.equal(historyEvents(h).length,0);
});
test('commit後の表示処理がstore更新しても成功を取消へ誤分類しない',async()=>{
 const h=setup({fast:true});h.sandbox.safeRender=()=>{if(h.state.files.currentFileId===h.target.id)h.dispatch(h.sandbox.actions.setMockData({'#after_commit':true}));};
 assert.equal(await h.start(),true);assert.equal(h.sandbox.navigationUiState.lastResolution.status,'committed');assert.equal(historyEvents(h).length,1);assert.equal(h.listeners.size,0);
});

for(const mutate of ['local-state','reopen'])test(`frame準備中の${mutate}変更はstore通知なしでも古い遷移を破棄する`,async()=>{
 const h=setup({gateStage:'frame'}),cs=h.sandbox.getCanvasState(h.origin.id);
 h.sandbox.api.ensureLocalToggleSession40(cs,h.origin);
 const pending=h.start();await h.gateReached;
 if(mutate==='local-state')cs.localToggleState={...cs.localToggleState,revision:1,values:{old:true}};
 else h.sandbox.api.ensureLocalToggleSession40(cs,h.origin,true);
 const stateAfter=cs.localToggleState,instanceAfter=cs.uiInstanceId;h.release();
 assert.equal(await pending,false);assert.equal(openEvents(h).length,0);assert.equal(h.state.files.currentFileId,h.origin.id);
 assert.equal(cs.localToggleState,stateAfter);assert.equal(cs.uiInstanceId,instanceAfter);
});
test('実main session関数は同UI状態を保持し再表示とモデル変更で別instanceへ初期化する',()=>{
 const h=setup(),cs=h.sandbox.getCanvasState(h.origin.id),session=h.sandbox.api.ensureLocalToggleSession40;
 session(cs,h.origin);const first=cs.uiInstanceId;
 cs.localToggleState={...createLocalToggleState(first),revision:2,values:{old:true}};const changed=cs.localToggleState;
 session(cs,h.origin);assert.equal(cs.uiInstanceId,first);assert.equal(cs.localToggleState,changed);
 session(cs,{...h.origin});assert.equal(cs.uiInstanceId,first,'同一model参照のfile wrapper更新は保持');
 session(cs,h.origin,true);assert.notEqual(cs.uiInstanceId,first);assert.equal(cs.localToggleState.revision,0);assert.equal(Object.keys(cs.localToggleState.values).length,0);
 const reopened=cs.uiInstanceId;cs.nodeFrameContext='old';session(cs,{...h.origin,uiModel:{root:{}}});
 assert.notEqual(cs.uiInstanceId,reopened);assert.equal(cs.nodeFrameContext,null);assert.equal(cs.localToggleState.instanceId,cs.uiInstanceId);
});
test('閉じた既存screenの高速openはローカル状態を初期化して再表示する',async()=>{
 const h=setup({fast:true}),cs=h.sandbox.getCanvasState(h.target.id);h.sandbox.api.ensureLocalToggleSession40(cs,h.target);
 const first=cs.uiInstanceId;cs.localToggleState={...cs.localToggleState,revision:1,values:{target:true}};cs.previewClosed=true;
 assert.equal(await h.sandbox.api.ensureScreenFileOpen(h.target.id,'test.target'),true);
 assert.equal(cs.previewClosed,false);assert.notEqual(cs.uiInstanceId,first);assert.equal(cs.localToggleState.revision,0);assert.equal(Object.keys(cs.localToggleState.values).length,0);
});
test('Node frameが失敗した同ファイル別定義の遷移は元のinstanceと状態を保持する',async()=>{
 const h=setup({targetId:'screen:ui/origin.json',targetDefinition:'test.second'}),cs=h.sandbox.getCanvasState(h.origin.id);h.sandbox.api.ensureLocalToggleSession40(cs,h.origin);
 const before=cs.localToggleState,instance=cs.uiInstanceId;h.sandbox.requestNodeFramePayload=async()=>{throw Error('SIMULATED_FRAME_FAILURE');};
 const pending=h.start();h.release();assert.equal(await pending,false);assert.equal(cs.localToggleState,before);assert.equal(cs.uiInstanceId,instance);assert.equal(h.state.files.byId[h.origin.id],h.origin);assert.equal(openEvents(h).length,0);
});
for(const failure of ['foreign-frame-instance','foreign-state-instance','missing-state','commit-rejected'])test(`遷移先の${failure}は同ファイルの元ローカル状態を破壊しない`,async()=>{
 const h=setup({targetId:'screen:ui/origin.json',targetDefinition:'test.second'}),cs=h.sandbox.getCanvasState(h.origin.id);h.sandbox.api.ensureLocalToggleSession40(cs,h.origin);
 cs.localToggleState={...cs.localToggleState,revision:3,values:{old:true}};const before=cs.localToggleState,instance=cs.uiInstanceId;
 const request=h.sandbox.requestNodeFramePayload;
 h.sandbox.requestNodeFramePayload=async input=>{const frame=await request(input);
   if(failure==='foreign-frame-instance')frame.uiInstanceId='different-instance';
   if(failure==='foreign-state-instance')frame.bindings.localToggleState=createLocalToggleState('different-instance');
   if(failure==='missing-state')delete frame.bindings.localToggleState;
   return frame;};
 if(failure==='commit-rejected'){const dispatch=h.sandbox.store.dispatch;h.sandbox.store.dispatch=action=>{if(action.type!=='preview/navCommit')dispatch(action);};}
 const pending=h.start();h.release();assert.equal(await pending,false);assert.equal(cs.localToggleState,before);assert.equal(cs.uiInstanceId,instance);
 assert.equal(h.state.files.byId[h.origin.id],h.origin);assert.equal(h.state.files.currentFileId,h.origin.id);
});
