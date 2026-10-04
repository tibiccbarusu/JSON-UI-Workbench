import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateBindingsForUiModel } from '../src/bindings/bindings-evaluator.js';
import { resolveUiInteraction } from '../src/preview/ui-interaction-engine.js';
import { createLocalToggleState, normalizeLocalToggleState, applyLocalTogglePatch, LOCAL_TOGGLE_UNKNOWN } from '../src/preview/local-toggle-state.js';

const output = [];
const scenarios = ['toggle-flip','toggle-on','toggle-off','radio-peer','radio-reselect','separate-groups','separate-parents','generated-row','instance-mismatch','hidden-ancestor','disabled-control','external-global'];
const seeds = [{name:'false-or-index0',value:false,index:0},{name:'true-or-index1',value:true,index:1},{name:'property-bag-true',value:false,index:0}];
const modes = [{name:'mouse',event:'activate',inputSource:'mouse',pocket:false},{name:'wrong-keyboard',event:'activate',inputSource:'keyboard',pocket:false},{name:'escape',event:'escape',inputSource:'keyboard',pocket:false},{name:'pocket',event:'activate',inputSource:'mouse',pocket:true}];
function element(id, type = 'panel', unknownProps = {}, children = [], bindings = []) {
  return { id, type, key:{local_name:id.split('/').at(-1)}, props:{visible:true,enabled:true}, unknownProps, children, bindings, localVariables:{} };
}
function toggle(id, seed, extra = {}, action = 'button.menu_select') {
  return element(id,'toggle',{toggle_default_state:seed.value,radio_toggle_group:false,...(seed.name==='property-bag-true'?{property_bag:{'#toggle_state':true}}:{}),...extra,button_mappings:[{from_button_id:'button.menu_select',to_button_id:action,mapping_type:'pressed'}]});
}
function fixture(scenario, seed) {
  const radio = ['radio-peer','radio-reselect','separate-groups','separate-parents','generated-row'].includes(scenario);
  const action = scenario==='toggle-on'?'toggle.toggle_on':scenario==='toggle-off'?'toggle.toggle_off':'button.menu_select';
  const props = radio ? {radio_toggle_group:true,toggle_name:'tabs',toggle_group_default_selected:seed.index} : {};
  const a=toggle('root/owner/a',seed,{...props,...(radio?{toggle_group_forced_index:0}:{})},action);
  const b=toggle('root/owner/b',seed,{...props,...(radio?{toggle_group_forced_index:1}:{})});
  const owner=element('root/owner','panel',{},[a,b]);
  const other=element('root/other','panel',{},[]);
  const model={filePath:'ui/local-state40.json',root:element('root','panel',{},[owner,other])};
  let selected=a;
  if (radio) selected=(scenario==='radio-reselect'?seed.index===0:seed.index!==0)?a:b;
  if (scenario==='separate-groups') owner.children.push(toggle('root/owner/c',seed,{...props,toggle_name:'other',toggle_group_forced_index:0}),toggle('root/owner/d',seed,{...props,toggle_name:'other',toggle_group_forced_index:1}));
  if (scenario==='separate-parents'||scenario==='generated-row') {
    other.children.push(toggle('root/other/a',seed,{...props,toggle_group_forced_index:0}),toggle('root/other/b',seed,{...props,toggle_group_forced_index:1}));
    if(scenario==='generated-row'){owner.unknownProps={__jsonui_preview_collection_name:'rows',collection_index:0};other.unknownProps={__jsonui_preview_collection_name:'rows',collection_index:1};}
  }
  if(scenario==='hidden-ancestor')owner.props.visible=false;
  if(scenario==='disabled-control')a.props.enabled=false;
  if(scenario==='external-global')a.bindings=[{binding_name:'#flag',binding_name_override:'#toggle_state'}];
  return {model,selected,radio, mockData:{'#flag':seed.value}, collectionData:{rows:[{},{}]}};
}
let count=0;
for(const scenario of scenarios)for(const seed of seeds)for(const mode of modes){
  const caseId=`transition-${String(++count).padStart(3,'0')}`;
  test(`${caseId} ${scenario}/${seed.name}/${mode.name}`,()=>{
    const f=fixture(scenario,seed),instanceId=`case-${caseId}`;
    const initial=evaluateBindingsForUiModel(f.model,{uiInstanceId:instanceId,mockData:f.mockData,collectionData:f.collectionData});
    const original=JSON.stringify(initial.localToggleState),mockOriginal=JSON.stringify(f.mockData);
    const expectedStatus=mode.pocket||scenario==='disabled-control'?'blocked':mode.name!=='mouse'?'unsupported':['instance-mismatch','hidden-ancestor'].includes(scenario)?'blocked':'applied';
    const expectedValues={...initial.localToggleState.values};
    if(expectedStatus==='applied'&&scenario!=='external-global'){
      if(f.radio){expectedValues['root/owner/a']=f.selected.id.endsWith('/a');expectedValues['root/owner/b']=f.selected.id.endsWith('/b');}
      else expectedValues[f.selected.id]=scenario==='toggle-on'?true:scenario==='toggle-off'?false:!seed.value;
    }
    let result,updated,actual;
    try{
      result=resolveUiInteraction({enabled:true,model:f.model,node:f.selected,effectiveProps:initial.propsById[f.selected.id],propsById:initial.propsById,mockData:f.mockData,collectionData:f.collectionData,uiInstanceId:scenario==='instance-mismatch'?instanceId+'-different':instanceId,localToggleState:initial.localToggleState,...mode});
      assert.equal(result.status,expectedStatus);
      let state=initial.localToggleState;
      if(expectedStatus==='applied'){
        assert.equal(result.effects.length,1);
        if(scenario==='external-global'){assert.equal(result.effects[0].type,'mockPatch');assert.equal(result.effects[0].patch['#flag'],!seed.value);}
        else {assert.equal(result.effects[0].type,'localTogglePatch');const applied=applyLocalTogglePatch(state,result.effects[0]);assert.equal(applied.ok,true);state=applied.state;assert.equal(state.revision,1);}
      }else assert.deepEqual(result.effects,[]);
      updated=evaluateBindingsForUiModel(f.model,{uiInstanceId:instanceId,localToggleState:state,mockData:f.mockData,collectionData:f.collectionData});
      assert.equal(updated.localToggleState.instanceId,instanceId);
      assert.deepEqual({...updated.localToggleState.values},expectedValues);
      for(const [id,value]of Object.entries(expectedValues))assert.equal(updated.propsById[id].toggle_state,value);
      assert.equal(JSON.stringify(initial.localToggleState),original);assert.equal(JSON.stringify(f.mockData),mockOriginal);
      actual={status:result.status,before:initial.localToggleState,after:updated.localToggleState,effects:result.effects,transition:result.localTransition||null};
      output.push({case_id:caseId,scenario,initial:seed,event:mode,expected:{status:expectedStatus,values:expectedValues,instanceId},effective_expected:{status:expectedStatus,values:expectedValues,instanceId},...(scenario==='disabled-control'&&['wrong-keyboard','escape'].includes(mode.name)?{plan_amendment:'case-plan-amendments.json: 既存 enabled gate の先行判定'}:{}),actual,passed:true});
    }catch(error){output.push({case_id:caseId,scenario,initial:seed,event:mode,expected:{status:expectedStatus,values:expectedValues,instanceId},actual:actual||{result,updated},passed:false,error:{name:error.name,message:error.message}});throw error;}
  });
}

test('snapshot validation rejects getters, malformed values, unsafe IDs, oversized state, and foreign instance',()=>{
 const base=createLocalToggleState('A');assert.equal(normalizeLocalToggleState(base,{instanceId:'B'}).ok,false);
 for(const values of [[],{'a':1},JSON.parse('{"__proto__":true}'),{'a\n':true},Object.fromEntries(Array.from({length:20001},(_,i)=>[`n${i}`,false]))])assert.equal(normalizeLocalToggleState({...base,values},{instanceId:'A'}).ok,false);
 let calls=0;const values={};Object.defineProperty(values,'a',{enumerable:true,get(){calls++;return true;}});assert.equal(normalizeLocalToggleState({...base,values},{instanceId:'A'}).ok,false);assert.equal(calls,0);
});
test('patch is atomic; stale revision and unknown node reject without mutation',()=>{
 const state={...createLocalToggleState('A'),values:{a:false,b:true}},before=JSON.stringify(state);
 for(const effect of [{type:'localTogglePatch',instanceId:'B',revision:0,changes:{a:true}},{type:'localTogglePatch',instanceId:'A',revision:1,changes:{a:true}},{type:'localTogglePatch',instanceId:'A',revision:0,changes:{a:true,c:false}}])assert.equal(applyLocalTogglePatch(state,effect).ok,false);
 assert.equal(JSON.stringify(state),before);
});
test('radio number collision and invalid saved exclusivity remain unknown',()=>{
 const f=fixture('radio-peer',seeds[0]);f.model.root.children[0].children[1].unknownProps.toggle_group_forced_index=0;
 let e=evaluateBindingsForUiModel(f.model,{uiInstanceId:'A'});assert.equal(e.propsById['root/owner/a'].toggle_state,LOCAL_TOGGLE_UNKNOWN);assert.ok(e.diagnostics.some(d=>d.reason==='LOCAL_STATE_UNRESOLVED'));
 const valid=fixture('radio-peer',seeds[0]);e=evaluateBindingsForUiModel(valid.model,{uiInstanceId:'A',localToggleState:{...createLocalToggleState('A'),values:{'root/owner/a':true,'root/owner/b':true}}});assert.equal(e.propsById['root/owner/a'].toggle_state,LOCAL_TOGGLE_UNKNOWN);
});
test('implicit radio indices remain unsupported instead of guessing engine order',()=>{
 const f=fixture('radio-peer',seeds[0]);for(const n of f.model.root.children[0].children){delete n.unknownProps.toggle_group_forced_index;n.unknownProps.toggle_default_state=n.id.endsWith('/a');}
 const e=evaluateBindingsForUiModel(f.model,{uiInstanceId:'A'});assert.equal(e.propsById['root/owner/a'].toggle_state,LOCAL_TOGGLE_UNKNOWN);assert.equal(e.propsById['root/owner/b'].toggle_state,LOCAL_TOGGLE_UNKNOWN);assert.ok(e.localToggleDiagnostics.every(d=>d.reason==='RADIO_DEFAULT_UNRESOLVED'));
});
test('view self and sibling read the same local state before and after an interaction',()=>{
 const f=fixture('toggle-flip',seeds[2]),a=f.selected;
 a.bindings=[{binding_type:'view',source_property_name:'#toggle_state',target_property_name:'#enabled'}];
 const p=element('root/owner/p','panel',{},[],[{binding_type:'view',source_control_name:'a',source_property_name:'#toggle_state',target_property_name:'#visible'}]);f.model.root.children[0].children.push(p);
 let e=evaluateBindingsForUiModel(f.model,{uiInstanceId:'A'});assert.equal(e.propsById[a.id].enabled,false);assert.equal(e.propsById[p.id].visible,false);
 a.bindings=[];e=evaluateBindingsForUiModel(f.model,{uiInstanceId:'A'});
 const r=resolveUiInteraction({enabled:true,model:f.model,node:a,propsById:e.propsById,effectiveProps:e.propsById[a.id],uiInstanceId:'A',localToggleState:e.localToggleState});
 a.bindings=[{binding_type:'view',source_property_name:'#toggle_state',target_property_name:'#enabled'}];
 e=evaluateBindingsForUiModel(f.model,{uiInstanceId:'A',localToggleState:applyLocalTogglePatch(e.localToggleState,r.effects[0]).state});assert.equal(e.propsById[a.id].enabled,true);assert.equal(e.propsById[p.id].visible,true);
});
test('reopen uses defaults and never leaks state between instances',()=>{
 const f=fixture('toggle-flip',seeds[0]);const a=evaluateBindingsForUiModel(f.model,{uiInstanceId:'A'});const r=resolveUiInteraction({enabled:true,model:f.model,node:f.selected,propsById:a.propsById,uiInstanceId:'A',localToggleState:a.localToggleState});const changed=applyLocalTogglePatch(a.localToggleState,r.effects[0]).state;
 assert.equal(evaluateBindingsForUiModel(f.model,{uiInstanceId:'A',localToggleState:changed}).propsById[f.selected.id].toggle_state,true);
 assert.equal(evaluateBindingsForUiModel(f.model,{uiInstanceId:'B'}).propsById[f.selected.id].toggle_state,false);
});
test('external view and collection bindings retain ownership of toggle state',()=>{
 const f=fixture('toggle-flip',seeds[0]),a=f.selected;
 a.unknownProps.property_bag={'#input':true};a.bindings=[{binding_type:'view',source_property_name:'#input',target_property_name:'#toggle_state'}];let e=evaluateBindingsForUiModel(f.model,{uiInstanceId:'A'});assert.equal(e.propsById[a.id].toggle_state,true);assert.equal(Object.hasOwn(e.localToggleState.values,a.id),false);
 a.bindings=[{binding_type:'collection',binding_collection_name:'rows',binding_name:'#selected',binding_name_override:'#toggle_state'}];a.unknownProps.collection_index=0;e=evaluateBindingsForUiModel(f.model,{uiInstanceId:'A',collectionData:{rows:[{'#selected':true}]}});assert.equal(e.propsById[a.id].toggle_state,true);assert.equal(Object.hasOwn(e.localToggleState.values,a.id),false);
});
test('unknown authored ignored does not suppress descendant unresolved diagnostics',()=>{
 const child=element('root/owner/c','panel',{},[],[{binding_type:'view',source_property_name:'#missing',target_property_name:'#visible'}]);const owner=element('root/owner','panel',{ignored:'#unknown'},[child]);const model={root:element('root','panel',{},[owner])};const e=evaluateBindingsForUiModel(model);assert.equal(e.propsById[owner.id].ignored,LOCAL_TOGGLE_UNKNOWN);assert.ok(e.diagnostics.some(d=>d.nodeId===child.id&&d.status==='unresolved'));assert.ok(e.diagnostics.some(d=>d.nodeId===owner.id&&d.bindingType==='implicit_property'));
});
test('clip outside refuses local changes',()=>{
 const f=fixture('toggle-flip',seeds[0]),e=evaluateBindingsForUiModel(f.model,{uiInstanceId:'A'});const r=resolveUiInteraction({enabled:true,model:f.model,node:f.selected,propsById:e.propsById,uiInstanceId:'A',localToggleState:e.localToggleState,box:{x:50,y:50,w:10,h:10,clipRect:{x:0,y:0,w:10,h:10}}});assert.equal(r.status,'blocked');assert.equal(r.diagnostics[0].code,'INTERACTION_CONTROL_CLIPPED');
});
after(()=>{if(process.env.STATE40_EVIDENCE_DIR){mkdirSync(process.env.STATE40_EVIDENCE_DIR,{recursive:true});writeFileSync(path.join(process.env.STATE40_EVIDENCE_DIR,'transition-results.json'),JSON.stringify({version:1,meaning:'144は入力条件の組合せ数であり独立機能数ではない。期待値精緻化は case-plan-amendments.json に記録。',case_count:output.length,passed:output.filter(r=>r.passed).length,cases:output},null,2)+'\n');}});
