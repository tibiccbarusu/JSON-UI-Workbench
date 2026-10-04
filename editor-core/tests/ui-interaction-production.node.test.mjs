/** 製品のモデル・binding・layoutを使用する操作境界の回帰検査。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUiScreenModelFromJson} from '../src/model/ui-screen-model.js';
import {buildTreeFromUiScreenModel} from '../src/editor/ui-model-tree.js';
import {evaluateBindingsForUiModel} from '../src/bindings/bindings-evaluator.js';
import {buildRepresentativeClassicResolverVariables,buildRepresentativeClassicCollections,buildRepresentativeClassicCollectionData} from '../src/engine/representative-classic-runtime.js';
import {buildEffectivePreviewMockData} from '../src/engine/preview-bindings-runtime.js';
import {computeLayoutBoxesForFile,canvasPxToWorld} from '../src/preview/canvas-preview.js';
import {hitTestUiInteraction,findUiInteractionTarget,getUiInteractionEffectiveProps} from '../src/preview/ui-interaction-target.js';
import {findInteractionCollectionAddress,applySlotTransfer,resolveUiInteraction,describeTextInteraction,commitTextInteraction} from '../src/preview/ui-interaction-engine.js';
function makeContext(controls,mockData={},collectionData={}) {
  const model=buildUiScreenModelFromJson({namespace:'fixture',screen:{type:'panel',size:[200,100],anchor_from:'top_left',anchor_to:'top_left',controls}},{filePath:'ui/test.json'});
  const file=buildTreeFromUiScreenModel(model),ev=evaluateBindingsForUiModel(model,{mockData,collectionData});
  const layout=computeLayoutBoxesForFile(file,{width:200,height:100},{propsByIdOverride:ev.propsById});
  return {enabled:true,model,nodesById:file.nodesById,propsById:ev.propsById,boxes:layout.boxes,mockData,collectionData};
}
const item=id=>({'#item_valid':true,__jsonui_preview_item_id:'minecraft:'+id,__jsonui_preview_item_count:1});
const empty=()=>({'#item_valid':false,__jsonui_preview_item_count:0});
const mapping=action=>[{from_button_id:'button.menu_select',to_button_id:action,mapping_type:'pressed'}];
function rectControl(name,type,extra={}) {return {[name]:{type,size:[18,18],anchor_from:'top_left',anchor_to:'top_left',...extra}};}
test('painted item above sibling button cannot steal the slot hit and singleton detail binding is preserved',()=>{
 const c=makeContext([rectControl('slot','input_panel',{controls:[rectControl('button','button',{layer:5,button_mappings:mapping('button.container_take_all_place_all'),bindings:[{binding_type:'collection_details',binding_collection_name:'anvil_input_items'}]}),rectControl('item','custom',{layer:7,renderer:'inventory_item_renderer'}),rectControl('count','label',{layer:27,text:'64'})]})],{}, {anvil_input_items:[empty()]});
 const hit=hitTestUiInteraction(c,9,9,{width:200,height:100}),target=findUiInteractionTarget(c,hit);
 assert.equal(target.node.type,'button');assert.match(hit.id,/button$/u);
 assert.deepEqual(findInteractionCollectionAddress({...c,nodeId:hit.id}),{collection:'anvil_input_items',index:0});
});
test('zero-size controls remain unclickable and disabled front controls block click-through',()=>{
 const c=makeContext([rectControl('back','button',{layer:1}),rectControl('front','button',{layer:2,enabled:false}),rectControl('zero','button',{layer:3,size:[0,0]})]);
 const hit=hitTestUiInteraction(c,9,9);assert.match(hit.id,/front$/u);assert.equal(getUiInteractionEffectiveProps(c,hit.id).enabled,false);
});
test('clipped control cannot receive an out-of-clip hit and CSS zoom/pan does not use DPR',()=>{
 const c=makeContext([rectControl('clip','panel',{size:[8,8],clips_children:true,controls:[rectControl('button','button')]})]);
 assert.equal(hitTestUiInteraction(c,12,4),null);
 const world=canvasPxToWorld(40,20,{zoom:2,viewX:-16,viewY:-6});assert.deepEqual(world,{x:4,y:4});assert(hitTestUiInteraction(c,world.x,world.y));
});
test('multi-row collection_details needs a concrete row and cannot default to row zero',()=>{
 const c=makeContext([rectControl('button','button',{bindings:[{binding_type:'collection_details',binding_collection_name:'rows'}]})],{},{rows:[{},{}]});
 const hit=hitTestUiInteraction(c,5,5);assert.equal(findInteractionCollectionAddress({...c,nodeId:hit.id}),null);
});
test('edit_box text_control chooses the real input label and ignores a bound placeholder',()=>{
 const c=makeContext([rectControl('input','edit_box',{size:[80,20],text_control:'value',max_length:30,enabled:'#enabled',bindings:[{binding_name:'#input_enabled',binding_name_override:'#enabled'}],controls:[rectControl('value','label',{text:'#content',bindings:[{binding_name:'#name',binding_name_override:'#content'}]}),rectControl('placeholder','label',{text:'#placeholder',bindings:[{binding_name:'#hint',binding_name_override:'#text'}]})]})],{'#input_enabled':true,'#name':'before','#hint':'hint'});
 const hit=hitTestUiInteraction(c,5,5),target=findUiInteractionTarget(c,hit,'edit_box');
 const desc=describeTextInteraction({...c,...target});assert.equal(desc.status,'applied');assert.equal(desc.edit.binding,'#name');
 const commit=commitTextInteraction({...c,edit:desc.edit,value:'日本語の名前'});assert.equal(commit.status,'applied');
 const next=evaluateBindingsForUiModel(c.model,{mockData:{...c.mockData,...commit.effects[0].patch}});
 assert(Object.values(next.propsById).some(p=>p.text==='日本語の名前'||(p.text==='#content'&&p.content==='日本語の名前')));assert.equal(c.mockData['#name'],'before');
});
test('toggle radio group follows authored binding source and changes only sibling group states',()=>{
 const toggle=(name,binding,index)=>rectControl(name,'toggle',{offset:[index*20,0],toggle_name:'tabs',toggle_group_forced_index:index,button_mappings:mapping('button.menu_select'),bindings:[{binding_name:binding,binding_name_override:'#toggle_state'}]});
 const c=makeContext([toggle('left','#left',0),toggle('right','#right',1)],{'#left':true,'#right':false,'#unrelated':true});
 const hit=hitTestUiInteraction(c,25,5),target=findUiInteractionTarget(c,hit);
 const answer=resolveUiInteraction({...c,...target});assert.equal(answer.status,'applied');assert.deepEqual(answer.effects[0].patch,{'#right':true,'#left':false});assert.equal(c.mockData['#left'],true);
});
test('beacon selection preserves separate primary and secondary groups',()=>{
 const c=makeContext([rectControl('speed','toggle',{button_mappings:mapping('button.menu_ok'),bindings:[{binding_type:'collection_details',binding_collection_name:'speed'},{binding_type:'collection',binding_collection_name:'speed',binding_name:'#selected',binding_name_override:'#toggle_state'}]})],{}, {speed:[{'#selected':false}],haste:[{'#selected':true}],regen:[{'#selected':true}]});
 const hit=hitTestUiInteraction(c,5,5),target=findUiInteractionTarget(c,hit);
 const answer=resolveUiInteraction({...c,...target,screenDefinition:'beacon.beacon_screen',collectionAddress:findInteractionCollectionAddress({...c,nodeId:hit.id})});
 assert.equal(answer.status,'applied');assert.equal(answer.effects[0].patch.speed[0]['#selected'],true);assert.equal(answer.effects[0].patch.haste[0]['#selected'],false);assert.equal(answer.effects[0].patch.regen,undefined);
});
test('UI input slots accept representative valid items and reject unrelated items',()=>{
 for(const [collection,id]of Object.entries({furnace_ingredient_items:'raw_iron',brewing_input_item:'nether_wart',enchanting_input_items:'diamond_sword',anvil_material_items:'diamond',grindstone_input_items:'diamond_sword',smithing_table_input_items:'diamond_sword',smithing_table_material_items:'netherite_ingot',smithing_table_template_items:'netherite_upgrade_smithing_template',loom_input_items:'white_banner',loom_dye_items:'red_dye',loom_material_items:'flower_banner_pattern',stonecutter_input_items:'stone',cartography_input_items:'filled_map',cartography_additional_items:'paper'})){
  const options={enabled:true,from:{collection:'inventory_items',index:0},to:{collection,index:0},collectionData:{inventory_items:[item(id)],[collection]:[empty()]}};
  assert.equal(applySlotTransfer(options).status,'applied',collection);
  options.collectionData.inventory_items=[item('dirt')];assert.equal(applySlotTransfer(options).status,'blocked',collection);
 }
});
test('smoker and blast furnace do not share all furnace ingredient rules',()=>{
 const place=(id,screenDefinition)=>applySlotTransfer({enabled:true,screenDefinition,from:{collection:'inventory_items',index:0},to:{collection:'furnace_ingredient_items',index:0},collectionData:{inventory_items:[item(id)],furnace_ingredient_items:[empty()]}}).status;
 assert.equal(place('beef','smoker.smoker_screen'),'applied');assert.equal(place('raw_iron','smoker.smoker_screen'),'blocked');assert.equal(place('raw_iron','blast_furnace.blast_furnace_screen'),'applied');assert.equal(place('beef','blast_furnace.blast_furnace_screen'),'blocked');
});
test('enchanting target move drives dedicated book open binding and removing it closes the book',()=>{
 const data={inventory_items:[item('diamond_sword')],enchanting_input_items:[empty()]};
 const first=applySlotTransfer({enabled:true,screenDefinition:'enchanting.enchanting_screen',collectionData:data,from:{collection:'inventory_items',index:0},to:{collection:'enchanting_input_items',index:0}});assert.equal(buildEffectivePreviewMockData({__collections:{...data,...first.effects[0].patch}},'enchanting.enchanting_screen')['#open'],true); assert.equal(first.effects.some(e=>e.type==='mockPatch'),false);
 const second=applySlotTransfer({enabled:true,screenDefinition:'enchanting.enchanting_screen',collectionData:{...data,...first.effects[0].patch},from:{collection:'enchanting_input_items',index:0},to:{collection:'inventory_items',index:0}});assert.equal(buildEffectivePreviewMockData({__collections:{...data,...second.effects[0].patch}},'enchanting.enchanting_screen')['#open'],false);
});

test('authored omitted-size slot button fills its parent but explicitly zero-size button does not',()=>{
 const c=makeContext([rectControl('slot','input_panel',{controls:[{button:{type:'button',layer:5,button_mappings:mapping('button.container_take_all_place_all'),bindings:[{binding_type:'collection_details',binding_collection_name:'anvil_input_items'}]}},rectControl('renderer','custom',{renderer:'inventory_item_renderer',layer:7}),rectControl('zero','button',{size:[0,0],layer:10})]})],{}, {anvil_input_items:[empty()]});
 const button=c.boxes.find(b=>b.id.endsWith('/button')),zero=c.boxes.find(b=>b.id.endsWith('/zero'));
 assert.equal(button.w,18);assert.equal(button.h,18);assert.equal(zero.w,0);assert.equal(zero.h,0);assert.equal(hitTestUiInteraction(c,9,9).id,button.id);
});

test('smithing current layout is a scoped default with explicit legacy override and no Pocket leakage',()=>{
 const q='smithing_table.smithing_table_screen';
 assert.equal(buildRepresentativeClassicResolverVariables({qualifiedName:q}).$use_smithing_table_2_ui,true);
 assert.equal(buildRepresentativeClassicResolverVariables({qualifiedName:q,baseVariables:{$use_smithing_table_2_ui:false}}).$use_smithing_table_2_ui,false);
 assert.equal(buildRepresentativeClassicResolverVariables({qualifiedName:q,userVariables:{$use_smithing_table_2_ui:false}}).$use_smithing_table_2_ui,false);
 for(const qualifiedName of ['smithing_table_pocket.smithing_table_screen','custom.smithing_table_screen'])assert.equal(buildRepresentativeClassicResolverVariables({qualifiedName}).$use_smithing_table_2_ui,undefined);
});
test('beacon has one empty payment slot and user supplied payment state wins',()=>{
 const representative=buildRepresentativeClassicCollections({qualifiedName:'beacon.beacon_screen'});
 assert.equal(buildRepresentativeClassicCollectionData(representative,{}).beacon_payment_items.length,1);
 assert.equal(buildRepresentativeClassicCollectionData(representative,{}).beacon_payment_items[0]['#item_valid'],false);
 const payment=[item('netherite_ingot')];assert.deepEqual(buildRepresentativeClassicCollectionData(representative,{beacon_payment_items:payment}).beacon_payment_items,payment);
});
test('stock layout enum can remain unresolved while authored binding group stays exclusive',()=>{
 const c=makeContext([rectControl('layout','toggle',{toggle_name:'layout_toggle',toggle_group_forced_index:'$recipe_book_layout_index',button_mappings:mapping('button.menu_select'),bindings:[{binding_name:'#is_recipe_book_layout',binding_name_override:'#toggle_state'}]})],{'#is_survival_layout':true,'#is_creative_mode':true,'#is_recipe_book_layout':false});
 const hit=hitTestUiInteraction(c,5,5),target=findUiInteractionTarget(c,hit);
 const answer=resolveUiInteraction({...c,...target,screenDefinition:'crafting.inventory_screen'}),p=answer.effects[0].patch;
 assert.equal(p['#is_survival_layout'],false);assert.equal(p['#is_recipe_book_layout'],true);assert.equal(p['#is_creative_layout'],false);assert.equal(p['#is_creative_and_recipe_book_layout'],true);assert.equal(p['#is_creative_and_creative_layout'],false);
 const custom=resolveUiInteraction({...c,...target,screenDefinition:'custom.inventory_screen'});assert.equal(custom.effects[0].patch['#is_survival_layout'],undefined);
});


test('Classic crafting row backgrounds reach sibling visibility bindings and explicit user values win',()=>{
 for(const qualifiedName of ['crafting.inventory_screen','crafting.crafting_screen']) {
  const representative=buildRepresentativeClassicCollections({qualifiedName});
  const data=buildRepresentativeClassicCollectionData(representative,{});
  const controls=[rectControl('row','panel',{collection_index:0,__jsonui_preview_collection_name:'inventory_items',controls:[
   rectControl('bg','panel',{bindings:[{binding_type:'collection',binding_collection_name:'inventory_items',binding_name:'#container_item_background'}]}),
   rectControl('classic','image',{texture:'textures/ui/cell_image',bindings:[{binding_type:'view',source_control_name:'bg',resolve_sibling_scope:true,source_property_name:'(#container_item_background = 0)',target_property_name:'#visible'}]})
  ]})];
  const c=makeContext(controls,{},data);const bg=Object.entries(c.propsById).find(([id])=>id.endsWith('/classic'));
  assert.equal(bg[1].visible,true);assert(c.boxes.some(b=>b.id===bg[0]&&b.w===18));
  const explicit=[{'#container_item_background':3,'#container_item_modifier':0}];
  const userData=buildRepresentativeClassicCollectionData(representative,{inventory_items:explicit});
  const d=makeContext(controls,{},userData);assert.equal(d.propsById[bg[0]].visible,false);assert.deepEqual(userData.inventory_items,explicit);
  const mock=buildEffectivePreviewMockData({},qualifiedName);assert.equal(mock['#needs_crafting_table'],false);assert.equal(mock['#crafting_label_text'],'container.crafting');
  const override=buildEffectivePreviewMockData({'#needs_crafting_table':true,'#crafting_label_text':''},qualifiedName);assert.equal(override['#needs_crafting_table'],true);assert.equal(override['#crafting_label_text'],'');
 }
 for(const qualifiedName of ['crafting_pocket.inventory_screen','custom.inventory_screen','anvil.anvil_screen']) {
  const representative=buildRepresentativeClassicCollections({qualifiedName});const data=buildRepresentativeClassicCollectionData(representative,{});
  assert.equal(data.inventory_items?.[0]?.['#container_item_background'],undefined);
  assert.equal(buildEffectivePreviewMockData({},qualifiedName)['#needs_crafting_table'],undefined);
 }
});
