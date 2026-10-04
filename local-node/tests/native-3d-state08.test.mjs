import test from 'node:test';
import {normalizePreviewState} from '../../editor-core/src/engine/preview-state.js';
import assert from 'node:assert/strict';
import {buildEffectivePreviewMockData,evaluateBindingsWithRepresentativeRuntime} from '../../editor-core/src/engine/preview-bindings-runtime.js';
import {buildUiScreenModelFromJson} from '../../editor-core/src/model/ui-screen-model.js';
import {readEnchantingBookPreviewState} from '../../editor-core/src/preview/native-book-preview.js';
import {resolveNativeScenePlacement} from '../../editor-core/src/preview/native-scene-placement.js';
const q='enchanting.enchanting_screen';
const row={'#item_valid':true,'#item_id_aux':123,__jsonui_preview_item_count:1};
const state=(collections,extra={})=>buildEffectivePreviewMockData({__collections:collections,...extra},q);

test('空の初期状態とラピスだけでは閉じ、対象物を置くと開く',()=>{
 assert.equal(state({})['#open'],false);
 assert.equal(state({enchanting_lapis_items:[row]})['#open'],false);
 assert.equal(state({enchanting_input_items:[row]})['#open'],true);
 assert.equal(state({enchanting_input_items:[{'#item_id_aux':0,'#item_valid':false}]})['#open'],false);
});
test('直接データの投入と除去、番号付きcollectionを毎回評価する',()=>{
 const collections={enchanting_input_items:[row]};assert.equal(state(collections)['#open'],true);
 collections.enchanting_input_items[0]={};assert.equal(state(collections)['#open'],false);
 assert.equal(state({enchanting_input_items:{0:row}})['#open'],true);
 assert.equal(state({enchanting_input_items:[]})['#open'],false);
});
test('利用者が明示した開閉値を優先し、customとPocketに状態を捏造しない',()=>{
 assert.equal(state({}, {'#open':true})['#open'],true);
 assert.equal(state({enchanting_input_items:[row]},{'#open':false})['#open'],false);
 for(const name of ['custom.enchanting_screen','enchanting_pocket.enchanting_screen']) assert.equal(Object.hasOwn(buildEffectivePreviewMockData({},name),'#open'),false);
});
test('global #openが実binding経路を通ってcustom rendererへ反映する',()=>{
 const model=buildUiScreenModelFromJson({namespace:'enchanting',enchanting_screen:{type:'screen',controls:[{book:{type:'custom',renderer:'enchanting_book_renderer',bindings:[{binding_name:'#open',binding_type:'global'}]}}]}},{filePath:'ui/enchanting_screen.json'});
 for(const occupied of [false,true,false]){
  const ev=evaluateBindingsWithRepresentativeRuntime(model,q,{__collections:{enchanting_input_items:occupied?[row]:[{}]}});
  const props=Object.values(ev.propsById).find(p=>p.renderer==='enchanting_book_renderer');
  assert.equal(props.open,occupied);
  assert.equal(readEnchantingBookPreviewState(props).openAmount,Number(occupied));
 }
});
test('30x30 player controlから52x70背景内に全身を配置し、ズームに追従する',()=>{
 const scene={kind:'player',presentationProfile:'classic-player-panel-v2'};
 // 52x70 background at (0,0), centered 30x30 child offset (0,-14).
 const d={x:11,y:6,w:30,h:30};const p=resolveNativeScenePlacement(scene,d);
 assert.equal(p.extent,66); assert.equal(p.y,1.5); assert.equal(p.y+p.extent,67.5);
 const z=resolveNativeScenePlacement(scene,{x:d.x*4+7,y:d.y*4-3,w:120,h:120});
 assert.deepEqual(z,{x:p.x*4+7,y:p.y*4-3,extent:p.extent*4});
});
test('旧型/未指定playerとbookの汎用配置に拡大を波及しない',()=>{
 for(const scene of [{kind:'player'},{kind:'player',presentationProfile:'bounded-player-fit-v1'},{kind:'book'}])assert.deepEqual(resolveNativeScenePlacement(scene,{x:20,y:30,w:16,h:16}),{x:20,y:30,extent:16});
});

test('型付き状態のエンチャント対象も同じ開閉経路へ入る',()=>{
 for(const [input,expected] of [[null,false],[{id:'minecraft:book',count:1},true]]){
  const normalized=normalizePreviewState({enchanting:{input}});
  assert.equal(state(normalized.collectionData,normalized.mockData)['#open'],expected);
 }
});
