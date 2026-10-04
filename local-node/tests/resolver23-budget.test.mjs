import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUiCatalog} from '../../editor-core/src/engine/ui-catalog.js';
import {resolveEffectiveUi} from '../../editor-core/src/engine/effective-ui-resolver.js';
import {parseJsonc} from '../../editor-core/src/json/jsonc.js';
async function project(document,limits={}){
 const before=JSON.stringify(document);
 const source={id:'budget-audit',kind:'imported',precedence:20,filePaths:['ui/budget.json'],readText:async()=>before};
 const catalog=await buildUiCatalog({sources:[source],parseJsonc});
 const selected=catalog.records.find(row=>row.localName==='root');
 const result=resolveEffectiveUi({catalog,recordId:selected.id,limits});
 assert.equal(JSON.stringify(document),before,'原文不変');return result;
}
test('派生画面が置き換える基底controlsを事前に展開して予算を使わない',async()=>{
 const document={namespace:'budget',cell:{type:'label',text:'base'},base:{type:'screen',controls:Array.from({length:200},(_,i)=>({['cell_'+i+'@budget.cell']:{}}))},
   'root@budget.base':{controls:[{own:{type:'label',text:'derived'}}]}};
 const result=await project(document,{maxResolvedObjects:100});
 assert.equal(result.ok,true,JSON.stringify(result.error));
 assert.equal(result.document.root.controls.length,1);
 assert.equal(result.document.root.controls[0].own.text,'derived');
 assert.equal(result.stats.recordResolutionWork,2);
 assert.ok(result.stats.resolvedObjectWork<20);
});
test('失敗結果にも有限の消費量と上限名と定義の識別情報を残す',async()=>{
 const result=await project({namespace:'budget',root:{type:'screen','$secret':'DO_NOT_REPORT_LEXICAL_VALUES',controls:Array.from({length:30},(_,i)=>({['cell_'+i]:{type:'panel',size:[1,1]}}))}},{maxResolvedObjects:5});
 assert.equal(result.ok,false);
 assert.equal(result.error.code,'UI_RESOLVED_OBJECT_LIMIT');
 assert.deepEqual(result.error.limit,{name:'maxResolvedObjects',maximum:5,consumed:6});
 assert.equal(result.error.context.qualifiedName,'budget.root');
 assert.equal(result.selected.qualifiedName,'budget.root');
 assert.equal(result.stats.resolvedObjectWork,6);
 assert.equal(result.stats.resolvedObjects,6);
 assert.equal(result.stats.materializedGridItems,0);
 assert.equal(result.stats.fixedPointRetries,0);
 assert.equal(result.document,undefined);
 assert.ok(!JSON.stringify(result).includes('DO_NOT_REPORT_LEXICAL_VALUES'));
 assert.equal(result.diagnostics.at(-1).certainty,'policy');
});
test('継承深さの失敗は処理中の定義と実際の消費深さを示す',async()=>{
 const result=await project({namespace:'budget',base:{type:'screen'},'middle@budget.base':{},'root@budget.middle':{}},{maxInheritanceDepth:1});
 assert.equal(result.ok,false);
 assert.deepEqual(result.error.limit,{name:'maxInheritanceDepth',maximum:1,consumed:2});
 assert.equal(result.error.context.qualifiedName,'budget.base');
 assert.equal(result.selected.qualifiedName,'budget.root');
 assert.equal(result.stats.recordResolutionWork,3);
});
test('取り消した動的継承passもworkへ計上し完成統計と区別する',async()=>{
 const result=await project({namespace:'budget',a:{type:'screen','$choose_b':true,marker:'a'},b:{type:'screen','$choose_b':true,marker:'b'},
   'root@$target':{'$target|default':'budget.a',variables:[{requires:'$choose_b','$target':'budget.b'}]}});
 assert.equal(result.ok,true,JSON.stringify(result.error));
 assert.equal(result.document.root.marker,'b');
 assert.ok(result.stats.fixedPointRetries>=1);
 assert.ok(result.stats.discardedResolvedObjects>=1);
 assert.equal(result.stats.discardedResolvedObjects,result.stats.resolvedObjectWork-result.stats.resolvedObjects);
});
test('遅延した子templateの上限失敗は有限の参照経路と反復対象を示す',async()=>{
 const result=await project({namespace:'budget',root:{type:'screen',controls:[{'entry@budget.loop':{}}]},
   loop:{type:'panel','$secret':'DO_NOT_REPORT_TEMPLATE_VALUES',controls:[{'again@budget.loop':{}}]}},{maxControlDepth:20});
 assert.equal(result.ok,false);
 assert.equal(result.error.code,'UI_CONTROL_DEPTH_LIMIT');
 assert.deepEqual(result.error.limit,{name:'maxControlDepth',maximum:20,consumed:21});
 assert.equal(result.error.context.qualifiedName,'budget.loop');
 assert.equal(result.error.context.repeatedControlReference.qualifiedName,'budget.loop');
 assert.equal(result.error.context.controlReferences.length,8);
 assert.ok(result.error.context.omittedControlReferences>0);
 assert.equal(result.selected.qualifiedName,'budget.root');
 assert.ok(!JSON.stringify(result).includes('DO_NOT_REPORT_TEMPLATE_VALUES'));
});
test('同じtemplateへの有限な子参照と兄弟の再利用を循環と誤認しない',async()=>{
 const result=await project({namespace:'budget',root:{type:'screen',controls:[
   {'first@budget.cell':{controls:[{'last@budget.cell':{controls:[]}}]}},
   {'second@budget.cell':{controls:[]}}]},cell:{type:'panel',size:[2,3]}});
 assert.equal(result.ok,true,JSON.stringify(result.error));
 assert.equal(result.document.root.controls[0].first.controls[0].last.type,'panel');
 assert.deepEqual(result.document.root.controls[1].second.size,[2,3]);
 assert.ok(!result.diagnostics.some(row=>row.code==='UI_INHERITANCE_CYCLE'));
});
test('失敗contextへ前の兄弟templateの参照経路を混入させない',async()=>{
 const document={namespace:'budget',root:{type:'screen',controls:[{'first@budget.cell':{}},{'second@budget.next0':{}}]},cell:{type:'panel'}};
 for(let i=0;i<12;i++)document['next'+i]={type:'panel',...(i<11?{controls:[{['next@budget.next'+(i+1)]:{}}]}:{})};
 const result=await project(document,{maxControlDepth:8});
 assert.equal(result.ok,false);
 assert.equal(result.error.code,'UI_CONTROL_DEPTH_LIMIT');
 assert.ok(result.error.context.qualifiedName.startsWith('budget.next'));
 assert.ok(result.error.context.controlReferences.every(row=>row.qualifiedName.startsWith('budget.next')));
 assert.equal(result.error.context.repeatedControlReference,undefined);
});
