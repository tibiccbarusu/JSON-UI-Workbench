import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUiCatalog} from '../../editor-core/src/engine/ui-catalog.js';
import {parseJsonc} from '../../editor-core/src/json/jsonc.js';

function nested(value,count){for(let i=0;i<count;i++)value={inside:value};return value;}
async function catalogFor(documents,limits={}){
 const before=JSON.stringify(documents);
 const catalog=await buildUiCatalog({parseJsonc,limits,sources:[{id:'frame-cache-test',kind:'vanilla',precedence:1,
   filePaths:Object.keys(documents),readText:async name=>JSON.stringify(documents[name])}]});
 assert.equal(JSON.stringify(documents),before,'参照原文は不変');return catalog;
}
test('独立した深い枝が不完全でも正常な反復templateは共有走査予算へ収まる',async()=>{
 const catalog=await catalogFor({'ui/a.json':{namespace:'a',
   root:{type:'screen','$context':true,controls:Array.from({length:24},(_,i)=>({['copy_'+i+'@a.template']:{}})),
     deep:nested({'last@a.leaf':{}},12)},
   template:{type:'factory','$pick|default':'a.leaf',control_name:'$pick'},leaf:{type:'panel'}}},
   {maxScanDepth:10,maxReferenceNodesTotal:70});
 const root=catalog.records.find(row=>row.localName==='root');
 assert.equal(root.referenceScanComplete,false);
 assert.deepEqual(root.references,['a.leaf','a.template']);
 assert(catalog.summary.referenceCoverage.limitReasons.includes('depth'));
 assert(!catalog.summary.referenceCoverage.limitReasons.includes('global-nodes'));
 assert(catalog.summary.referenceNodesVisited<70);
});
test('同じ理由の上限失敗が再発したsubtreeを完全cacheとして再利用しない',async()=>{
 const catalog=await catalogFor({'ui/a.json':{namespace:'a',
   bad:{type:'screen','$context':true,first_failure:nested({'leaf@a.leaf':{}},12),
     second_failure:nested({'template@a.template':{}},5)},
   good:{type:'screen','$context':true,controls:[{'template@a.template':{}}]},
   template:{type:'factory','$pick|default':'a.leaf',control_name:'$pick',late_reference:nested({'hidden@a.hidden':{}},2)},
   leaf:{type:'panel'},hidden:{type:'panel'}}},{maxScanDepth:10});
 assert.equal(catalog.records.find(row=>row.localName==='bad').referenceScanComplete,false);
 const good=catalog.records.find(row=>row.localName==='good');
 assert.equal(good.referenceScanComplete,true);
 assert(good.references.includes('a.hidden'));
});
test('不完全なglobal変数に依存するsubtreeをcache保存しない',async()=>{
 const catalog=await catalogFor({'ui/_global_variables.json':{'$one':'a.leaf','$two':'a.hidden'},
   'ui/a.json':{namespace:'a',root:{'$context':true,controls:[{'one@a.template':{}},{'two@a.template':{}}]},
     template:{type:'factory',control_name:'$one'},leaf:{},hidden:{}}},{maxReferenceVariablesPerScope:1});
 assert.equal(catalog.summary.referenceCoverage.globalVariablesComplete,false);
 assert.equal(catalog.summary.referenceCompleteDefinitions,0);
 assert.equal(catalog.summary.referenceResultCacheEntries,0);
});
test('既にnode予算へ達した空のsubtree走査を完全cacheとして保存しない',async()=>{
 const catalog=await catalogFor({'ui/a.json':{namespace:'a',root:{type:'factory','$pick':'a.template',control_name:'$pick'},
   template:{type:'factory','$pick':'a.leaf',control_name:'$pick'},leaf:{}}},{maxReferenceNodesTotal:1});
 assert.equal(catalog.summary.referenceNodesVisited,1);
 assert.equal(catalog.summary.referenceResultCacheEntries,0);
 assert(catalog.summary.referenceCoverage.limitReasons.includes('global-nodes'));
});
