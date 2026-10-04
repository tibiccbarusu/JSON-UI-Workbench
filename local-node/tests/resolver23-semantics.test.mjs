import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUiCatalog} from '../../editor-core/src/engine/ui-catalog.js';
import {resolveEffectiveUi} from '../../editor-core/src/engine/effective-ui-resolver.js';
import {evaluateBindingsForUiModel, expressionReferenceTokens, safeEvalExpression} from '../../editor-core/src/bindings/bindings-evaluator.js';
import {buildUiScreenModelFromJson} from '../../editor-core/src/model/ui-screen-model.js';
import {parseJsonc} from '../../editor-core/src/json/jsonc.js';

async function resolve(docs, qualifiedName='audit.root', options={}) {
  const source={id:'semantic-audit',kind:'imported',precedence:20,filePaths:Object.keys(docs),readText:async path=>JSON.stringify(docs[path])};
  const before=JSON.stringify(docs);
  const catalog=await buildUiCatalog({sources:[source],parseJsonc});
  const selected=catalog.records.find(record=>record.qualifiedName===qualifiedName);
  assert.ok(selected,qualifiedName);
  const result=resolveEffectiveUi({catalog,recordId:selected.id,...options});
  assert.equal(result.ok,true,JSON.stringify(result.error));
  assert.equal(JSON.stringify(docs),before,'原文を変更しない');
  return JSON.parse(JSON.stringify(result.document[selected.localName]));
}
function findNode(model, name) {
  const stack=[model.root];
  while(stack.length) {const node=stack.pop();if(node.key?.local_name===name)return node;stack.push(...(node.children||[]));}
  assert.fail(`node not found: ${name}`);
}

test('静的requiresとlayerがbindingと同じ空白なし減算を解釈する',async()=>{
  const root={type:'screen','$left':7,'$right':2,'$result|default':'miss',
    variables:[{requires:'($left-$right = 5)','$result':'match'}],result:'$result',layer:'($left-$right)'};
  const result=await resolve({'ui/audit.json':{namespace:'audit',root}});
  assert.equal(safeEvalExpression('($left-$right = 5)',{props:{},mockData:{'$left':7,'$right':2}}),true);
  assert.equal(result.result,'match');
  assert.equal(result.layer,5);
});

test('式参照抽出は文字列内の記号を除外しASTキャッシュを外部へ漏らさない',()=>{
  const expr="($left-$right + #count-2 + '$quoted-$literal')";
  assert.deepEqual(expressionReferenceTokens(expr),['$left','$right','#count']);
  const first=expressionReferenceTokens(expr);first.push('$injected');
  assert.deepEqual(expressionReferenceTokens(expr),['$left','$right','#count']);
  assert.deepEqual(expressionReferenceTokens('($missing + )'),[]);
  assert.deepEqual(expressionReferenceTokens('x'.repeat(4097)),[]);
  assert.deepEqual(expressionReferenceTokens('('.repeat(65)+'$a'+')'.repeat(65)),[]);
  assert.equal(safeEvalExpression('($left-$right)',{props:{'$left':9,'$right':1},mockData:{}}),8);
  assert.equal(safeEvalExpression('($left-$right)',{props:{'$left':3,'$right':2},mockData:{}}),1);
});

test('間接layer式でも同一token境界を使い循環を未解決に保つ',async()=>{
  const result=await resolve({'ui/audit.json':{namespace:'audit',root:{type:'screen',
    '$left':7,'$right':2,'$layer':'($left-$right)','$final':'($layer+1)',layer:'$final',
    controls:[{cyclic:{type:'panel','$a':'($b+1)','$b':'($a+1)',layer:'($a+1)'}}]}}});
  assert.equal(result.layer,6);
  assert.equal(result.controls[0].cyclic.layer,'($a+1)');
});

test('false/null/0の明示値はdefaultやmockへ置き換わらない',async()=>{
  const raw={namespace:'audit',base:{type:'screen','$flag|default':true,'$empty|default':'default','$zero|default':9},
    'root@audit.base':{'$flag':false,'$empty':null,'$zero':0,flag:'$flag',empty:'$empty',zero:'$zero'}};
  const result=await resolve({'ui/audit.json':raw});
  assert.equal(result.flag,false);assert.equal(result.empty,null);assert.equal(result.zero,0);
  for(const [name,value] of [['$flag',false],['$empty',null],['$zero',0]]) {
    assert.equal(safeEvalExpression(name,{props:{[name]:value},mockData:{[name]:'SHOULD_NOT_APPLY'}}),value);
  }
  assert.equal(safeEvalExpression('$missing',{props:{},mockData:{}}),undefined);
});

test('条件分岐は前の一致値を参照し兄弟controlの宣言を混ぜない',()=>{
  const model=buildUiScreenModelFromJson({namespace:'audit',root:{type:'screen','$gate':false,controls:[
    {first:{type:'panel','$gate':true,variables:[{requires:'$gate','$part':'a'},{requires:"($part = 'a')",'$result':0}],
      bindings:[{binding_type:'view',source_property_name:'($result)',target_property_name:'#result'}]}},
    {second:{type:'panel','$result|default':null,variables:[{requires:'$gate','$result':9}],
      bindings:[{binding_type:'view',source_property_name:'($result)',target_property_name:'#result'}]}}
  ]}},{filePath:'ui/audit.json'});
  const result=evaluateBindingsForUiModel(model,{mockData:{'$gate':true,'$result':99}});
  assert.equal(result.propsById[findNode(model,'first').id].result,0);
  assert.equal(result.propsById[findNode(model,'second').id].result,null);
});

test('controlsとbindings配列の置換および修飾selectorが値型を保持する',async()=>{
  const result=await resolve({'ui/audit.json':{namespace:'audit',base:{type:'screen',
    controls:[{base:{type:'panel'}}],bindings:[{binding_name:'#old'}],
    button_mappings:[{from_button_id:'false',to_button_id:'x',scope:false},{from_button_id:'zero',to_button_id:'x',scope:0},{from_button_id:'null',to_button_id:'x',scope:null}]},
    'root@audit.base':{controls:[{derived:{type:'panel'}}],bindings:[{binding_name:'#new'}],
      modifications:[{array_name:'controls',operation:'insert_back',value:[{added:{type:'panel'}}]},
        {array_name:'button_mappings',operation:'remove',where:{scope:false}}]}}});
  assert.deepEqual(result.controls.map(item=>Object.keys(item)[0]),['derived','added']);
  assert.deepEqual(result.bindings,[{binding_name:'#new'}]);
  assert.deepEqual(result.button_mappings.map(row=>row.scope),[0,null]);
});

test('継承されたcontrolsは移植元namespaceを使い明示置換は派生namespaceを使う',async()=>{
  const docs={'ui/common.json':{namespace:'common',template:{type:'label',text:'common'},base:{type:'screen',controls:[{'child@template':{}}]}},
    'ui/audit.json':{namespace:'audit',template:{type:'label',text:'audit'},'root@common.base':{},'replaced@common.base':{controls:[{'child@template':{}}]}}};
  assert.equal((await resolve(docs)).controls[0].child.text,'common');
  assert.equal((await resolve(docs,'audit.replaced')).controls[0].child.text,'audit');
});
