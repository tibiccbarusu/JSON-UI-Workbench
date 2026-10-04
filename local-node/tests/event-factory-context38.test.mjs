import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { normalizePreviewState } from '../../editor-core/src/engine/preview-state.js';
import { normalizeEventFactorySelections38 } from '../../editor-core/src/engine/preview-context38.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';

const scene = size => ({ namespace: 'context38', main: { type: 'panel', size,
  controls: [{ server_form_factory: { type: 'factory', control_ids: { long_form: '@context38.long_form', custom_form: '@other.modal' } } }] },
  long_form: { type: 'panel', size: ['100%', '100%'], controls: [{ content: { type: 'panel', size: ['100% - 8px', '100% - 8px'], max_size: [340,220] } }] } });
const selection = { server_form_factory: 'long_form' };
async function project(doc = scene(['100%', '100%']), options = {}, selected = 'context38.main', extra = {}) {
  const docs = { 'ui/context.json': doc, ...extra };
  const before = JSON.stringify(docs);
  const catalog = await buildUiCatalog({ parseJsonc, sources: [{ id:'context38', kind:'imported', precedence:20,
    filePaths:Object.keys(docs), readText:async path=>JSON.stringify(docs[path]) }] });
  const record = catalog.records.find(row=>row.qualifiedName===selected);
  assert(record);
  const result = resolveEffectiveUi({ catalog, recordId:record.id, ...options });
  assert.equal(JSON.stringify(docs),before,'authored inputs remain unchanged');
  return result;
}
function layout(result) {
  assert.equal(result.ok,true,JSON.stringify(result));
  const uiModel = buildUiScreenModelFromJson(result.document, { filePath:'ui/context.json' });
  return computeLayoutBoxesForFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel }, { width:480,height:270 }, { visibilityMode:'safe' });
}

test('explicit event materialization retains real ancestor and factory zero sizes', async()=>{
  const result = await project(scene([0,0]), {eventFactorySelections:selection});
  const frame=layout(result), boxes=frame.boxes;
  assert.equal(boxes.find(row=>row.id.endsWith('/main')).w,0);
  assert.equal(boxes.find(row=>row.id.endsWith('/server_form_factory')).w,0);
  assert.equal(boxes.find(row=>row.id.endsWith('/long_form')).w,0);
  assert.equal(boxes.find(row=>row.id.endsWith('/content')).w,0,'existing safe layout clamps negative size');
  assert(frame.warnings.some(warning=>warning.startsWith('LAYOUT_EVENT_FACTORY_PARENT_SIZE_UNUSABLE:')));
  assert.equal(result.previewContext.scope,'explicit-event-factory');
  assert.equal(result.previewContext.nativeParityVerified,false);
});

test('repaired ancestor sizing yields centered 340 by 220 bounded content',async()=>{
  const result=await project(undefined,{eventFactorySelections:selection});
  const content=layout(result).boxes.find(row=>row.id.endsWith('/content'));
  assert.deepEqual([content.x,content.y,content.w,content.h],[70,25,340,220]);
  assert.deepEqual(result.previewContext.eventFactories,[{factory:'server_form_factory',controlId:'long_form',template:'context38.long_form'}]);
  assert.equal(result.previewContext.scriptApiExecuted,false);
  assert.equal(result.nodeSources['/main/controls/0/server_form_factory/controls/0/long_form'].generated,'event-factory');
});

test('unselected event factories remain runtime-only and direct component warns about ancestors',async()=>{
  const result=await project();
  assert.equal(layout(result).boxes.some(row=>row.id.includes('server_form_factory')),false);
  assert(result.diagnostics.some(row=>row.code==='UI_PREVIEW_ANCESTOR_CONTEXT_UNVERIFIED'));
  const direct=await project(undefined,{},'context38.long_form');
  assert.equal(direct.previewContext.scope,'component');
  assert(direct.diagnostics.some(row=>row.code==='UI_PREVIEW_ANCESTOR_CONTEXT_UNVERIFIED'));
});

test('explicit factory target resolves across files and selects only the requested branch',async()=>{
  const result=await project(undefined,{eventFactorySelections:{server_form_factory:'custom_form'}},'context38.main',{
    'ui/other.json':{namespace:'other',modal:{type:'panel',size:[123,45]}}});
  const boxes=layout(result).boxes;
  assert(boxes.some(row=>row.id.endsWith('/custom_form')&&row.w===123));
  assert.equal(boxes.some(row=>row.id.endsWith('/long_form')),false);
});

test('selection failures are explicit for absent selector, absent branch and absent target',async()=>{
  for(const [selectors,code] of [[{missing:'long_form'},'UI_EVENT_FACTORY_SELECTOR_NOT_FOUND'],
    [{server_form_factory:'missing'},'UI_EVENT_FACTORY_CONTROL_ID_NOT_FOUND'],
    [{server_form_factory:'custom_form'},'UI_EVENT_FACTORY_TARGET_NOT_FOUND']]) {
    const result=await project(undefined,{eventFactorySelections:selectors});
    assert.equal(result.ok,false); assert.equal(result.error.code,code);
  }
});

test('duplicate factory local names cannot silently select more than one instance',async()=>{
  const doc=scene(['100%','100%']);
  doc.main.controls.push({ container:{type:'panel',controls:[structuredClone(doc.main.controls[0])]}});
  const result=await project(doc,{eventFactorySelections:selection});
  assert.equal(result.error.code,'UI_EVENT_FACTORY_SELECTOR_AMBIGUOUS');
});

test('event recursion and Pocket dependency remain blocked',async()=>{
  const doc=scene(['100%','100%']);
  doc.main.controls[0].server_form_factory.control_ids.long_form='@context38.main';
  assert.equal((await project(doc,{eventFactorySelections:selection})).error.code,'UI_EVENT_FACTORY_CYCLE');
  doc.main.controls[0].server_form_factory.control_ids.long_form='@mobile.screen';
  const result=await project(doc,{eventFactorySelections:selection},'context38.main',{
    'ui/pocket/mobile.json':{namespace:'mobile',screen:{type:'panel'}}});
  assert.equal(result.error.code,'POCKET_DEPENDENCY_BLOCKED');
});

test('event generation shares global object/item safety budgets',async()=>{
  for(const [limits,code] of [[{maxMaterializedCollectionItemsTotal:0},'UI_EVENT_FACTORY_ITEM_LIMIT'],
    [{maxMaterializedObjects:1},'UI_EVENT_FACTORY_OBJECT_LIMIT']]) {
    assert.equal((await project(undefined,{eventFactorySelections:selection,limits})).error.code,code);
  }
});

test('event selectors reject excess, unsafe names, getters and nonobjects',()=>{
  for(const value of [null,[],{factory:1},{factory:'$dynamic'},JSON.parse('{"__proto__":"long_form"}'),
    Object.fromEntries(Array.from({length:33},(_,i)=>['factory'+i,'long_form'])),
    Object.defineProperty({},'factory',{enumerable:true,get(){throw Error('getter must not run');}})]) {
    assert.throws(()=>normalizeEventFactorySelections38(value), /UI_EVENT_FACTORY_/u);
  }
});

test('typed state preserves explicit selector through GUI mock state round trips',()=>{
  const result=normalizePreviewState({eventFactorySelections:selection,form:{type:'action',title:'観測',body:'',buttons:[]}});
  assert.deepEqual({...result.eventFactorySelections},selection);
  assert.equal(result.recommendedDefinition,'server_form.main_screen_content');
  assert.deepEqual({...result.mockData.__event_factory_selections},selection);
  const roundtrip=normalizePreviewState({mockData:result.mockData,collectionData:result.collectionData});
  assert.deepEqual(roundtrip.eventFactorySelections,result.eventFactorySelections);
  const cleared=normalizePreviewState({mockData:result.mockData,eventFactorySelections:{}});
  assert.equal(cleared.mockData.__event_factory_selections,undefined);
});

test('zero-sized factory does not warn when its selected child has fixed dimensions',async()=>{
  const doc=scene([0,0]); doc.long_form.size=[225,200];
  const result=layout(await project(doc,{eventFactorySelections:selection}));
  assert.equal(result.warnings.some(warning=>warning.startsWith('LAYOUT_EVENT_FACTORY_PARENT_SIZE_UNUSABLE:')),false);
  assert.equal(result.boxes.find(row=>row.id.endsWith('/long_form')).w,225);
});

test('authored event materialization marker cannot bypass explicit branch selection',async()=>{
  const doc=scene(['100%','100%']);
  const factory=doc.main.controls[0].server_form_factory;
  factory.__jsonui_preview_event_factory_materialized=true;
  factory.controls=[{forged:{type:'panel',size:[50,50]}}];
  const result=layout(await project(doc));
  assert.equal(result.boxes.some(row=>row.id.includes('server_form_factory')),false);
});

test('unresolved slider overlay visibility is a layout warning without hiding or changing it',()=>{
  const document={namespace:'context38',slider:{type:'slider',size:[120,16],slider_value:.5,controls:[
    {overlay:{type:'image',size:['100%','100%'],texture:'textures/ui/grey',visible:true}}
  ]}};
  const uiModel=buildUiScreenModelFromJson(document,{filePath:'ui/slider.json'});
  const file={...buildTreeFromUiScreenModel(uiModel),uiModel};
  const input={visible:'#__jsonui_unresolved_runtime_visibility__'};
  const result=computeLayoutBoxesForFile(file,{width:480,height:270},{propsByIdOverride:{'root/slider/overlay':input}});
  assert(result.warnings.some(warning=>warning.startsWith('SLIDER_STATE_VISIBILITY_UNRESOLVED:')));
  assert.equal(input.visible,'#__jsonui_unresolved_runtime_visibility__');
  const known=computeLayoutBoxesForFile(file,{width:480,height:270},{propsByIdOverride:{'root/slider/overlay':{visible:false}}});
  assert.equal(known.warnings.some(warning=>warning.startsWith('SLIDER_STATE_VISIBILITY_UNRESOLVED:')),false);
});
