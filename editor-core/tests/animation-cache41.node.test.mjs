/** 製品main関数のcache境界。DOM/nativeイベントの実行ではない。 */
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const a=source.indexOf('const animationPlans = new WeakMap();'),b=source.indexOf('let animationIdentity',a);
assert(a>=0&&b>a);
function fixture(node=false){let count=0;const cs={basePropsByIdOverride:{},localToggleState:{revision:1},uiInstanceId:'one',nodeAnimationSummary:{from:'node'}};
const state={preview:{mockDataVersion:1}},file={id:'f',uiModel:{},meta:{}};
const box={nodeFrameAvailability:node,store:{getState:()=>state},getCanvasKey:id=>id,getCanvasState:()=>cs,compilePreviewAnimations:(_model,options)=>({count:++count,options,diagnostics:[]}),diagnostics:{log(){}}};
vm.createContext(box);vm.runInContext(source.slice(a,b)+'\nglobalThis.getPlan=getPreviewAnimationPlan;',box);return{cs,state,file,get:()=>box.getPlan(file),count:()=>count};}
test('R41 fallback plan invalidates each semantic state but reuses identical frame',()=>{
const h=fixture();let prev=h.get();assert.equal(h.get(),prev);assert.equal(h.count(),1);
for(const mutate of [()=>h.cs.localToggleState.revision++,()=>h.cs.uiInstanceId='two',()=>h.cs.basePropsByIdOverride={},()=>h.state.preview.mockDataVersion++]){mutate();let p=h.get();assert.notEqual(p,prev);assert.equal(h.get(),p);prev=p;}
assert.equal(h.count(),5);
});
test('R41 Node plan remains authoritative without browser recompilation',()=>{const h=fixture(true);assert.equal(h.get(),h.cs.nodeAnimationSummary);assert.equal(h.count(),0);});
