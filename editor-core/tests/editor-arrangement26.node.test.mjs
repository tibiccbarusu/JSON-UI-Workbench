import test from 'node:test';
import assert from 'node:assert/strict';
import { lockedMovement26, planLayerMove26, studioProgressModel26 } from '../src/ui/editor-arrangement26.js';
import { applyPendingLayout21 } from '../src/ui/editor-draft-layout21.js';
const nodes = { root: { children: ['panel'] }, panel: { props: {layer: 50}, children: ['background','button','other'] }, background: { props:{layer:0}, children: [] }, button: { props:{layer:3}, children:['glyph'] }, glyph: { props:{layer:7}, children:[] }, other:{props:{layer:4},children:[]} };
const boxes = [
 {id:'root',parentId:null,layer:0,effectiveLayer:0,x:0,y:0,w:100,h:100},
 {id:'panel',parentId:'root',layer:50,effectiveLayer:50,x:0,y:0,w:100,h:100},
 {id:'background',parentId:'panel',layer:0,effectiveLayer:50,x:0,y:0,w:100,h:100},
 {id:'button',parentId:'panel',layer:3,effectiveLayer:53,x:0,y:0,w:10,h:10},
 {id:'glyph',parentId:'button',layer:7,effectiveLayer:60,x:0,y:0,w:10,h:10},
 {id:'other',parentId:'panel',layer:4,effectiveLayer:54,x:0,y:0,w:10,h:10},
];
test('自分・親・子孫のロックで移動を保護し、無関係な兄弟のロックは妨げない', () => {
 assert.deepEqual(lockedMovement26(['background'],nodes,new Set(['background'])),{id:'background',relation:'self'});
 assert.deepEqual(lockedMovement26(['background'],nodes,new Set(['panel'])),{id:'panel',relation:'ancestor'});
 assert.deepEqual(lockedMovement26(['panel'],nodes,new Set(['glyph'])),{id:'glyph',relation:'descendant'});
 assert.equal(lockedMovement26(['background'],nodes,new Set(['glyph'])),null);
});
test('選択群は1要素だけロックされていても移動しない', () => {
 assert.equal(lockedMovement26(['background','button'],nodes,new Set(['glyph'])).id,'glyph');
});
test('循環した祖先で無限に探索しない', () => {
 assert.throws(()=>lockedMovement26(['a'],{a:{parentId:'b'},b:{parentId:'a'}},new Set(['outside'])),{code:'EDITOR_TREE_CYCLE'});
});
test('最前面: 親の50を保持し、ボタン内部の累積layer60より背景を前へ出す', () => {
 const plan=planLayerMove26({nodeId:'background',nodesById:nodes,boxes,direction:'front'});
 assert.equal(plan.value,11); assert.equal(plan.parentId,'panel');
 const draft=applyPendingLayout21({boxes},new Map([['background',{properties:{layer:plan.value}}]]),{nodesById:nodes});
 assert.equal(draft.boxes.find(b=>b.id==='background').effectiveLayer,61);
 assert.equal(draft.boxes.find(b=>b.id==='panel').effectiveLayer,50);
 assert.equal(boxes[2].effectiveLayer,50);
});
test('最背面: 子孫を持つボタン全体が背景より後ろになり、親子関係と数値以外は保持する', () => {
 const plan=planLayerMove26({nodeId:'button',nodesById:nodes,boxes,direction:'back'});
 assert.equal(plan.value,-8);
 const draft=applyPendingLayout21({boxes},new Map([['button',{properties:{layer:plan.value}}]]),{nodesById:nodes});
 assert.equal(draft.boxes.find(b=>b.id==='glyph').effectiveLayer,49);
 assert.equal(draft.boxes.find(b=>b.id==='glyph').layer,7);
 assert.equal(draft.boxes.find(b=>b.id==='glyph').parentId,'button');
});
test('既に最前面の枝、単独要素は再操作を追加しない',()=>{
 const smallNodes={r:{children:['a','b']},a:{props:{layer:0}},b:{props:{layer:5}}};
 const smallBoxes=[{id:'a',layer:0,effectiveLayer:0},{id:'b',layer:5,effectiveLayer:5}];
 assert.equal(planLayerMove26({nodeId:'b',nodesById:smallNodes,boxes:smallBoxes,direction:'front'}),null);
 assert.equal(planLayerMove26({nodeId:'a',nodesById:{r:{children:['a']},a:{}},boxes:smallBoxes,direction:'back'}),null);
});
test('動的layer・非有限値・巨大値・画面rootを無理に書き換えない',()=>{
 assert.throws(()=>planLayerMove26({nodeId:'background',nodesById:nodes,boxes,direction:'front',properties:{layer:'$layer'}}),{code:'EDITOR_LAYER_DYNAMIC'});
 assert.throws(()=>planLayerMove26({nodeId:'background',nodesById:nodes,boxes,direction:'front',properties:{layer:Infinity}}),{code:'EDITOR_LAYER_DYNAMIC'});
 assert.throws(()=>planLayerMove26({nodeId:'background',nodesById:nodes,boxes,direction:'front',properties:{layer:1000000}}),{code:'EDITOR_LAYER_RANGE'});
 assert.throws(()=>planLayerMove26({nodeId:'root',nodesById:nodes,boxes,direction:'front'}),{code:'EDITOR_LAYER_ROOT'});
});
test('草稿layerは複数祖先の差分を一度ずつ合算し、取り消し時は原layoutを返す',()=>{
 const pending=new Map([['panel',{properties:{layer:55}}],['button',{properties:{layer:10}}]]);
 const draft=applyPendingLayout21({boxes},pending,{nodesById:nodes});
 assert.equal(draft.boxes.find(b=>b.id==='glyph').effectiveLayer,72);
 const original={boxes}; assert.equal(applyPendingLayout21(original,new Map(),{nodesById:nodes}),original);
});
test('既知の件数のみ切捨て%を出し、未知・0・負数・超過・数値文字列で割合を偽造しない',()=>{
 const model=progress=>studioProgressModel26({label:'処理中',progress,startedAt:1000,now:35000});
 assert.equal(model({completed:202,total:299}).percent,67);
 assert.equal(model({processed:299,total:299}).percent,100);
 for(const progress of [{},{completed:1,total:0},{completed:-1,total:10},{completed:11,total:10},{completed:'1',total:10}]) assert.equal(model(progress).percent,null);
 assert.match(model({status:'queued'}).text,/前の処理を待っています/); assert.equal(model({}).elapsed,34); assert.equal(model({}).slow,true);
});
