/** Real HTTP + Worker frame checks. This is not a browser or native-device test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalServer } from '../../local-node/server.mjs';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';
import { prepareNodeFrameFile } from '../src/engine/node-frame-wire.js';
import { requestNodeFramePayload } from '../src/ui/node-frame-controller.js';
import { resolveUiInteraction } from '../src/preview/ui-interaction-engine.js';
import { createLocalToggleState, applyLocalTogglePatch } from '../src/preview/local-toggle-state.js';
import { previewLayoutInputKey, isPreviewInteractionFrameCurrent } from '../src/preview/interaction-frame-readiness.js';

test('ローカルradio実操作はHTTP/Worker/frame cache往復でも同instanceと単一pageを保持する',async t=>{
 const app=await createLocalServer({port:0});t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.port}/api/node/`,cap=await(await fetch(base+'capabilities')).json(),sent=[];
 const post=async payload=>{sent.push(payload);const response=await fetch(base+'frame',{method:'POST',headers:{'X-JSONUI-Token':cap.token,'Content-Type':'application/json'},body:JSON.stringify(payload)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};
 const radio=index=>({type:'toggle',size:[20,20],radio_toggle_group:true,toggle_name:'navigation',toggle_group_forced_index:index,toggle_group_default_selected:0,toggle_default_state:false,property_bag:{'#toggle_state':true},button_mappings:[{from_button_id:'button.menu_select',to_button_id:'button.menu_select',mapping_type:'pressed'}]});
 const page=name=>({type:'panel',size:[50,30],bindings:[{binding_type:'view',source_control_name:name,source_property_name:'#toggle_state',target_property_name:'#visible'}]});
 const uiModel=buildUiScreenModelFromJson({namespace:'local_wire',screen:{type:'screen',size:[100,100],controls:[{a:radio(0)},{b:radio(1)},{page_a:page('a')},{page_b:page('b')}] }},{filePath:'ui/local_wire.json'});
 const file={id:'local-wire',uiModel,...buildTreeFromUiScreenModel(uiModel),meta:{selectedDefinition:{qualifiedName:'local_wire.screen'}}};
 const ids=Object.fromEntries(Object.entries(file.nodesById).map(([id,n])=>[n.props.name,id]));
 const effective=(frame,id)=>({...file.nodesById[id].unknownProps,...file.nodesById[id].props,...frame.propsById[id]});
 const input={file,uiInstanceId:'wire-instance-A',localToggleState:createLocalToggleState('wire-instance-A'),preset:{width:100,height:100},visibilityMode:'safe'};
 const first=await requestNodeFramePayload({...input,generation:1},{request:post,prepareFile:prepareNodeFrameFile});
 assert.equal(first.uiInstanceId,input.uiInstanceId);assert.equal(first.bindings.localToggleState.instanceId,input.uiInstanceId);
 assert.equal(first.propsById[ids.a].toggle_state,true);assert.equal(first.propsById[ids.b].toggle_state,false);
 assert.equal(effective(first,ids.page_a).visible,true);assert.equal(effective(first,ids.page_b).visible,false);
 const find=(node,id)=>node.id===id?node:(node.children||[]).map(n=>find(n,id)).find(Boolean);
 const action=resolveUiInteraction({enabled:true,model:uiModel,node:find(uiModel.root,ids.b),propsById:first.propsById,effectiveProps:effective(first,ids.b),uiInstanceId:input.uiInstanceId,localToggleState:first.bindings.localToggleState});
 assert.equal(action.status,'applied');assert.equal(action.effects.length,1);
 const changed=applyLocalTogglePatch(first.bindings.localToggleState,action.effects[0]);assert.equal(changed.ok,true);
 const second=await post({...input,file:undefined,modelId:first.modelId,generation:2,localToggleState:changed.state});
 assert.equal(sent[1].file,undefined);assert.equal(second.uiInstanceId,first.uiInstanceId);assert.equal(second.bindings.localToggleState.revision,1);
 assert.equal(effective(second,ids.page_a).visible,false);assert.equal(effective(second,ids.page_b).visible,true);
 assert.equal(second.layout.boxes.some(box=>box.id===ids.page_a),false);assert.equal(second.layout.boxes.some(box=>box.id===ids.page_b),true);
 // Equal revision alone must not permit a cached binding result from different values.
 const alternate={...changed.state,values:{...changed.state.values,[ids.a]:true,[ids.b]:false}};
 const third=await post({...input,file:undefined,modelId:first.modelId,generation:3,localToggleState:alternate});
 assert.equal(effective(third,ids.page_a).visible,true);assert.equal(effective(third,ids.page_b).visible,false);
 const reopened=await post({...input,file:undefined,modelId:first.modelId,generation:4,uiInstanceId:'wire-instance-B',localToggleState:createLocalToggleState('wire-instance-B')});
 assert.equal(reopened.bindings.localToggleState.revision,0);assert.equal(effective(reopened,ids.page_a).visible,true);
 await assert.rejects(post({...input,file:undefined,modelId:first.modelId,generation:5,uiInstanceId:'wire-instance-B',localToggleState:changed.state}),/LOCAL_TOGGLE_INSTANCE_MISMATCH/u);
});

test('frame readinessはlocal revisionとinstance変更直後に旧hit surfaceを拒否する',()=>{
 const file={id:'wire',uiModel:{},nodesById:{}},state={ui:{previewLocale:'ja_JP'},preview:{mockDataVersion:1}},preset={width:100,height:100};
 const cs={uiInstanceId:'one',localToggleState:createLocalToggleState('one'),layout:{boxes:[]},layoutInputFile:file,nodeFrameAppliedFile:file};
 const opts={state,file,canvasState:cs,preset,assetMetricsRevision:0,nodeFrameAvailability:true,animationEvent:'default'};
 cs.layoutInputKey=previewLayoutInputKey(opts);cs.nodeFrameContext=`${cs.layoutInputKey}|default`;cs.nodeFrameAppliedContext=cs.nodeFrameContext;
 assert.equal(isPreviewInteractionFrameCurrent(opts),true);
 cs.localToggleState={...cs.localToggleState,revision:1};assert.equal(isPreviewInteractionFrameCurrent(opts),false);
 cs.localToggleState=createLocalToggleState('two');cs.uiInstanceId='two';assert.equal(isPreviewInteractionFrameCurrent(opts),false);
 cs.layoutInputKey=previewLayoutInputKey(opts);cs.nodeFrameContext=`${cs.layoutInputKey}|default`;assert.equal(isPreviewInteractionFrameCurrent(opts),false);
 cs.nodeFrameAppliedContext=cs.nodeFrameContext;assert.equal(isPreviewInteractionFrameCurrent(opts),true);
});
