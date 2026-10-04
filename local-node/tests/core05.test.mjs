import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const implementation = process.env.JSONUI_CORE_ROOT ? pathToFileURL(`${resolve(process.env.JSONUI_CORE_ROOT)}/`) : new URL('../../', import.meta.url);
const moduleOf = (path) => import(new URL(path, implementation));
const { normalizePreviewState } = await moduleOf('editor-core/src/engine/preview-state.js');
const { compilePreviewAnimations, samplePreviewAnimations, collectPreviewAnimationDefinitions } = await moduleOf('editor-core/src/engine/preview-animation.js');
const { safeEvalExpression, evaluateBindingsForUiModel } = await moduleOf('editor-core/src/bindings/bindings-evaluator.js');
const { buildUiCatalog } = await moduleOf('editor-core/src/engine/ui-catalog.js');
const { parseJsonc } = await moduleOf('editor-core/src/json/jsonc.js');
const model = (props={}) => ({ namespace: 'a', root: { id:'root', props, unknownProps:{}, children:[] } });
const fade = {anim_type:'alpha',from:0,to:1,duration:1};
const compile = (def,props={}) => compilePreviewAnimations(model({anims:['@a.fade'],...props}),{definitions:{'a.fade':def}});
const catalogOf = (documents) => buildUiCatalog({sources:[{id:'source',kind:'imported',precedence:10,filePaths:Object.keys(documents),readText:async p=>JSON.stringify(documents[p])}],parseJsonc});

const item = (id, count=1) => ({ id: `minecraft:${id}`, count });

test('交易は選択外のsecondInputを詳細collectionへ混入しない',()=>{
 const input={trade:{selected:0,offers:[{input:item('emerald',4),output:item('diamond')},{input:item('emerald',2),secondInput:item('iron_ingot',8),output:item('gold_ingot')} ]}};
 const copy=JSON.stringify(input), state=normalizePreviewState(input);
 for(const name of ['trade_item_2','trade_item_B','trade2_ingredient2_item','trade_ingredient2_items'])assert.equal(state.collectionData[name].length,0,name);
 assert.equal(state.collectionData.trades[1].__collections.trade_item_2[0]['#inventory_stack_count'],'8');
 assert.equal(state.mockData['#show_second_trade_slot'],false);
 assert.equal(JSON.stringify(input),copy);
});
test('交易は選択offerのsecondInputを保持し別行の先頭品目へ置換しない',()=>{
 const input={trade:{selected:1,offers:[{input:item('emerald'),secondInput:item('iron_ingot',8),output:item('diamond')},{input:item('emerald'),secondInput:item('gold_ingot',3),output:item('diamond')} ]}};
 const state=normalizePreviewState(input);
 for(const name of ['trade_item_2','trade_item_B','trade2_ingredient2_item','trade_ingredient2_items'])assert.equal(state.collectionData[name][0]['#inventory_stack_count'],'3',name);
 assert.equal(state.collectionData.trades[0].__collections.trade_item_2[0]['#inventory_stack_count'],'8');
 assert.equal(state.mockData['#show_second_trade_slot'],true);
});

test('公式auto_saveの162x30横stripから9フレームのUVを読む',()=>{
 const p=compile({anim_type:'flip_book',initial_uv:[0,0],frame_count:9,frame_step:18,fps:10,reversible:true},{uv_size:[18,30]});
 for(let i=0;i<9;i++){
  const uv=samplePreviewAnimations(p,i/10+.0001).propsById.root.uv;
  assert.deepEqual(uv,[i*18,0]);
  assert(uv[0]+18<=162 && uv[1]+30<=30);
 }
 assert.deepEqual(samplePreviewAnimations(p,.9001).propsById.root.uv,[126,0]);
});
test('公式loading_barの640x8横stripから最終64x8領域を読む',()=>{
 const p=compile({anim_type:'flip_book',initial_uv:[0,0],frame_count:10,frame_step:64,fps:10,looping:false},{uv_size:[64,8]});
 assert.deepEqual(samplePreviewAnimations(p,5).propsById.root.uv,[576,0]);
 assert.equal(samplePreviewAnimations(p,5).active,false);
});
test('公式tnt省略frame_stepは明示uv_sizeの幅427を使う',()=>{
 const p=compile({anim_type:'flip_book',initial_uv:[0,0],frame_count:2,fps:1,reversible:false},{uv_size:[427,320]});
 assert.equal(p.tracks.length,1);assert.deepEqual(samplePreviewAnimations(p,1.01).propsById.root.uv,[427,0]);
 assert.deepEqual(samplePreviewAnimations(p,2.01).propsById.root.uv,[0,0]);
 const absent=compile({anim_type:'flip_book',frame_count:2,fps:1});
 assert.equal(absent.tracks.length,0);assert(absent.diagnostics.some(x=>x.code==='ANIMATION_FLIPBOOK_INVALID'));
});
test('flipbookは初期UVを保ち、明示frame_stepをuv_sizeより優先する',()=>{
 const p=compile({anim_type:'flip_book',initial_uv:[3,9],frame_count:3,frame_step:5,fps:1,looping:false},{uv_size:[100,10]});
 assert.deepEqual(samplePreviewAnimations(p,2.1).propsById.root.uv,[13,9]);
});
test('継承animationの変数nextは宣言元namespaceを保持する',async()=>{
 const docs={'ui/a.json':{namespace:'a',base:{...fade,'$tail':'@end',next:'$tail'},end:{...fade,from:1,to:.5}},'ui/b.json':{namespace:'b','derived@a.base':{},end:{...fade,from:1,to:.1}}};
 const original=JSON.stringify(docs), cat=await catalogOf(docs), definitions=collectPreviewAnimationDefinitions(cat);
 assert.equal(definitions.definitions['b.derived']['$tail'],'@a.end');
 const p=compilePreviewAnimations(model({anims:['@b.derived']}),definitions);
 assert.equal(samplePreviewAnimations(p,2).propsById.root.alpha,.5);assert.equal(JSON.stringify(docs),original);
});
test('条件分岐内のanimation相対nextも宣言元を保持する',async()=>{
 const cat=await catalogOf({'ui/a.json':{namespace:'a',base:{...fade,variables:[{requires:true,'$tail':'@end'}],next:'$tail'},end:{...fade,from:1,to:.6}},'ui/b.json':{namespace:'b','derived@a.base':{}}});
 const p=compilePreviewAnimations(model({anims:['@b.derived']}),collectPreviewAnimationDefinitions(cat));
 assert.equal(samplePreviewAnimations(p,2).propsById.root.alpha,.6);
});
test('tailの明示loopingは一度だけの導入waitを再実行しない',()=>{
 const p=compilePreviewAnimations(model({anims:['@a.intro']}),{definitions:{'a.intro':{anim_type:'wait',duration:1,next:'@a.fade'},'a.fade':{...fade,looping:true}}});
 assert.equal(p.tracks[0].loopStart,1);assert.equal(samplePreviewAnimations(p,2.5).propsById.root.alpha,.5);
 assert.equal(samplePreviewAnimations(p,2000.5).propsById.root.alpha,.5);
});
test('一般補間のreversibleを根拠のない自動往復にせず未対応と診断する',()=>{
 const p=compile({...fade,reversible:true,easing:'in_quad'});
 assert.equal(p.tracks.length,0);assert(p.diagnostics.some(x=>x.code==='ANIMATION_REVERSIBLE_TYPE_UNSUPPORTED'));
});
test('開始alpha倍率をcollectorが保持し半透明の遷移を不透明化しない',async()=>{
 const cat=await catalogOf({'ui/a.json':{namespace:'a',fade:{...fade,scale_from_starting_alpha:true}}});
 const definitions=collectPreviewAnimationDefinitions(cat);assert.equal(definitions.definitions['a.fade'].scale_from_starting_alpha,true);
 const p=compilePreviewAnimations(model({anims:['@a.fade'],alpha:.4}),definitions);
 assert.equal(samplePreviewAnimations(p,.5).propsById.root.alpha,.2);assert.equal(samplePreviewAnimations(p,1).propsById.root.alpha,.4);
 assert.equal(samplePreviewAnimations(compile({...fade,scale_from_starting_alpha:true},{alpha:0}),1).propsById.root.alpha,0);
});
test('未解決alpha倍率と不正flagは推測した不透明値へ変換しない',()=>{
 for(const alpha of ['bad','#missing']){
  const p=compile({...fade,scale_from_starting_alpha:true},{alpha});assert.equal(p.tracks.length,0);
  assert(p.diagnostics.some(x=>x.code==='ANIMATION_START_ALPHA_UNRESOLVED'));
 }
 assert.equal(compile({...fade,scale_from_starting_alpha:'false'}).tracks.length,0);
});
test('文字列減算は日本語・記号をliteral扱いし数値減算と区別する',()=>{
 for(const [l,r,want] of [['[UI]倉庫','[UI]','倉庫'],['倉庫','[UI]','倉庫'],['a.*b','.*','ab'],['日本語','日本語',''],['a','', 'a'],['212','12','2']])
  assert.equal(safeEvalExpression('#left - #right',{props:{left:l,right:r}}),want);
 assert.equal(safeEvalExpression('#left - #right',{props:{left:'ababa',right:'aba'}}),undefined);
 assert.equal(safeEvalExpression('#left - #right',{props:{left:'prefix prefix',right:'prefix'}}),undefined);
 assert.equal(safeEvalExpression('12 - 4',{}),8);
 assert.equal(safeEvalExpression('#left - 4',{props:{left:'12'}}),8);
 assert.equal(safeEvalExpression('#left - #right',{props:{left:'x'.repeat(65537),right:'x'}}),undefined);
});
test('文字列減算を使うviewの表示条件がruntimeデータ変更へ追従する',()=>{
 const ui={namespace:'a',root:{id:'root',type:'label',props:{text:'#text'},unknownProps:{},children:[],bindings:[{binding_name:'#payload'},{binding_type:'view',source_property_name:"not ((#payload - '[UI]') = #payload)",target_property_name:'#visible'}]}};
 // Authored expressions must include the JSON UI parenthesized form.
 ui.root.bindings[1].source_property_name=`(${ui.root.bindings[1].source_property_name})`;
 for(const [value,want] of [['[UI]倉庫',true],['通常テキスト',false]]){
  const out=evaluateBindingsForUiModel(ui,{mockData:{'#payload':value}});assert.equal(out.propsById.root.visible,want);
 }
});

test('nextを変数で空文字にした末尾animationは明示loopingを抑止しない',()=>{
 const p=compile({...fade,next:'$tail','$tail':'',looping:true});
 assert.equal(p.loop,true);assert.equal(samplePreviewAnimations(p,1.5).propsById.root.alpha,.5);
 const bad=compile({anim_type:'flip_book',frame_count:2,fps:1},{uv_size:[0,5]});
 assert.equal(bad.tracks.length,0);
});
