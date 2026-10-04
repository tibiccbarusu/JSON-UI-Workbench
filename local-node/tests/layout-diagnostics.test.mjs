import test from 'node:test';
import assert from 'node:assert/strict';
import {computeLayoutBoxesForFile} from '../../editor-core/src/preview/canvas-preview.js';
function file(props){return{rootId:'root',nodesById:{root:{id:'root',type:'panel',props,children:[]}}};}
function diagnose(props,options){return computeLayoutBoxesForFile(file(props),{width:320,height:180},options);}
test('未対応size式は原本を保持して無診断のfallbackを防ぐ',()=>{
 const source=file({size:['calc(100% / 2)',20]});const before=JSON.stringify(source);
 const result=computeLayoutBoxesForFile(source,{width:320,height:180});
 assert.equal(JSON.stringify(source),before);
 assert.deepEqual(result.warnings.filter(x=>x.startsWith('LAYOUT_SCALAR_UNSUPPORTED')),['LAYOUT_SCALAR_UNSUPPORTED:root:size:0']);
 assert(result.boxes.every(x=>Number.isFinite(x.w)&&Number.isFinite(x.h)));
});
test('サポート済みの通常数値・割合・content・self・sibling式に誤警告しない',()=>{
 for(const scalar of [12,'12','50%','100%c','100%cm','100%sm','100%x','100%y','100% - 12','default','fill']){
  const result=diagnose({size:[scalar,20]});
  assert(!result.warnings.some(x=>x.startsWith('LAYOUT_SCALAR_UNSUPPORTED')),scalar);
 }
});
test('offset不正・constraint不正・vector不足を具体propertyで警告する',()=>{
 const result=diagnose({size:[10,10],offset:['$missing',0],max_size:['Infinity',20],min_size:[1]});
 for(const target of ['offset:0','max_size:0','min_size:vector'])assert(result.warnings.includes('LAYOUT_SCALAR_UNSUPPORTED:root:'+target),target);
});
test('bindingで値が確定したoverrideを診断し原本の未解決値を誤警告しない',()=>{
 const result=diagnose({size:['$width',20]},{propsByIdOverride:{root:{size:[100,20]}}});
 assert(!result.warnings.some(x=>x.startsWith('LAYOUT_SCALAR_UNSUPPORTED')));
});
