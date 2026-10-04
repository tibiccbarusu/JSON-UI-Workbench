import test from 'node:test';import assert from 'node:assert/strict';
import {computeLayoutBoxesForFile as layout} from '../../editor-core/src/preview/canvas-preview.js';
const fixture=()=>({rootId:'grid',nodesById:{grid:{id:'grid',type:'grid',props:{size:[36,18],grid_dimensions:[2,1]},children:['a','b']},a:{id:'a',type:'input_panel',props:{size:[18,18]},children:['imageA']},b:{id:'b',type:'input_panel',props:{size:[18,18]},children:['imageB']},imageA:{id:'imageA',type:'image',props:{size:['default','default']},propsPresent:{size:false},children:[]},imageB:{id:'imageB',type:'image',props:{size:['default','default']},propsPresent:{size:false},children:[]}}});
test('同寸法の固定slot subtreeは再測定せず親18x18を維持する',()=>{
 const file=fixture(),before=JSON.stringify(file);const result=layout(file,{width:100,height:100});
 assert(result.stats.allocatedSubtreeReuseCount>=2);assert(result.stats.measurementWork>0);
 for(const id of ['a','b','imageA','imageB']){const box=result.boxes.find(x=>x.id===id);assert.equal(box.w,18);assert.equal(box.h,18);}
 assert.equal(JSON.stringify(file),before);
});
test('同じnode idでも次の呼出のbinding寸法変更は前回cacheを再利用しない',()=>{
 const file=fixture();const initial=layout(file,{width:100,height:100});
 const changed=layout(file,{width:100,height:100},{propsByIdOverride:{a:{size:[24,18]}}});
 assert.equal(initial.boxes.find(x=>x.id==='imageA').w,18);assert.equal(changed.boxes.find(x=>x.id==='imageA').w,24);
});
test('fillの割当変更はsubtree固定寸法最適化の対象外で子の割合を再評価する',()=>{
 const file={rootId:'root',nodesById:{root:{id:'root',type:'stack_panel',props:{orientation:'horizontal',size:[100,20]},children:['fixed','fill']},fixed:{id:'fixed',type:'panel',props:{size:[40,20]},children:[]},fill:{id:'fill',type:'panel',props:{size:['fill',20]},children:['child']},child:{id:'child',type:'panel',props:{size:['50%',20]},children:[]}}};
 const result=layout(file,{width:100,height:100});assert.equal(result.boxes.find(x=>x.id==='fill').w,60);assert.equal(result.boxes.find(x=>x.id==='child').w,30);assert.equal(result.stats.allocatedSubtreeReuseCount,0);
});
test('探索上限時は以前の部分的contextを使う最適化を禁止する',()=>{
 const file=fixture();const result=layout(file,{width:100,height:100},{maxBoxes:2});assert.equal(result.stats.allocatedSubtreeReuseCount,0);assert.equal(result.stats.truncated,true);
});
