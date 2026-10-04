import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';
async function project(document, qualifiedName = 'defaults37.root', options = {}) {
  const before = JSON.stringify(document);
  const catalog = await buildUiCatalog({ parseJsonc, sources: [{id:'defaults37',kind:'imported',precedence:20,filePaths:['ui/defaults.json'],readText:async()=>JSON.stringify(document)}] });
  const record = catalog.records.find(row=>row.qualifiedName===qualifiedName);
  const result = resolveEffectiveUi({catalog,recordId:record.id,...options});
  assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(JSON.stringify(document),before);
  return result.document[record.localName];
}
const child = declaration => ({type:'panel',...declaration,controls:[{'label@defaults37.label':{}}]});
const document = outer => ({namespace:'defaults37',label:{type:'label',offset:'$offset'},root:{type:'panel',...outer,controls:[
  {inner:child({'$offset|default':[34,3]})},{peer:child({})},
]}});

test('same authored control subtree selects nearest default without changing sibling fallback',async()=>{
  const result=await project(document({'$offset|default':[0,0]}));
  assert.deepEqual(result.controls[0].inner.controls[0].label.offset,[34,3]);
  assert.deepEqual(result.controls[1].peer.controls[0].label.offset,[0,0]);
});

test('explicit ancestor and explicit caller settings remain authoritative over inner default',async()=>{
  for(const value of [[10,2],false,null,0]) {
    const result=await project(document({'$offset':value}));
    assert.deepEqual(result.controls[0].inner.controls[0].label.offset,value);
  }
  const explicit=await project(document({'$offset|default':[0,0]}),'defaults37.root',{variables:{'$offset':[19,5]}});
  assert.deepEqual(explicit.controls[0].inner.controls[0].label.offset,[19,5]);
});

test('same-scope exact/default member order and matching branch order remain stable',async()=>{
  for(const declaration of [{'$offset':[8,1],'$offset|default':[1,1]},{'$offset|default':[1,1],'$offset':[8,1]}]) {
    const result=await project(document({...declaration,variables:[{requires:true,'$offset|default':[2,2]}]}));
    assert.deepEqual(result.controls[0].inner.controls[0].label.offset,[8,1]);
  }
  const result=await project({namespace:'defaults37',root:{type:'panel','$value|default':1,
    variables:[{requires:true,'$value|default':2},{requires:'($value = 1)','$chosen':3}],text:'$chosen'}});
  assert.equal(result.text,3);
});

test('another inherited record does not overwrite a more-derived fallback or branch-selected base',async()=>{
  const result=await project({namespace:'defaults37',base:{type:'panel','$offset|default':[2,2],offset:'$offset'},
    'root@defaults37.base':{'$offset|default':[7,3]}});
  assert.deepEqual(result.offset,[7,3]);
  const branch=await project({namespace:'defaults37',first:{type:'panel','$gate|default':true}, second:{type:'panel',text:'chosen'},
    root:{type:'panel',controls:[{'child@$target':{'$target|default':'defaults37.first',variables:[{requires:'$gate','$target':'defaults37.second'}]}}]}});
  assert.equal(branch.controls[0].child.text,'chosen');
});

test('runtime lexical evaluator mirrors descendant-default selection and preserves explicit parent values',()=>{
  for(const [outer,expected] of [[{'$value|default':0},34],[{'$value':0},0],[{'$value':false},false],[{'$value':null},null]]) {
    const model=buildUiScreenModelFromJson({namespace:'defaults37',root:{type:'panel',...outer,controls:[{inner:{type:'panel','$value|default':34,
      bindings:[{binding_type:'view',source_property_name:'($value)',target_property_name:'#chosen'}]}},{peer:{type:'panel',bindings:[{binding_type:'view',source_property_name:'($value)',target_property_name:'#chosen'}]}}]}},{filePath:'ui/defaults.json'});
    const result=evaluateBindingsForUiModel(model);
    assert.equal(result.propsById['root/root/inner'].chosen,expected);
    assert.equal(result.propsById['root/root/peer'].chosen,Object.values(outer)[0]);
  }
});
