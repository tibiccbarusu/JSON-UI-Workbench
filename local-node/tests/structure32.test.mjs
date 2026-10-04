/** R32: 実原文を編集する参照検査。未解決参照を成功扱いにせず、誤拒否の反例も固定する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScopedEditContext,editWorkspaceScoped} from '../workspace-scoped-edit.mjs';
import {workspaceRevision} from '../workspace-edit.mjs';
import {resolveEffectiveUi} from '../../editor-core/src/engine/effective-ui-resolver.js';
import {pointerJoin,pointerParts} from '../workspace-jsonc.mjs';
const doc=(controls,defs={},props={})=>({'ui/test.json':JSON.stringify({namespace:'t',...defs,a:{type:'screen',...props,controls}})});
const at=(d,p)=>pointerParts(p).reduce((v,k)=>v?.[k],d);
async function prepare(d,suffix,extra={}){
 const ctx=await buildScopedEditContext({documents:d});const record=ctx.catalog.recordsById[ctx.catalog.symbols['t.a'].winnerId];
 const p=resolveEffectiveUi({catalog:ctx.catalog,recordId:record.id});assert(p.ok);
 const paths=Object.keys(p.nodeSources).filter(k=>k.endsWith(suffix));assert.equal(paths.length,1,suffix);const ep=paths[0],src=p.nodeSources[ep];
 return{ctx,p,op:{type:'delete',scope:'screen',targetMode:'interaction',cascade:true,path:ctx.internalPath(src),pointer:src.pointer,effectivePointer:ep,
 screen:{path:ctx.internalPath(record),pointer:pointerJoin([record.rawKey])},...extra}};
}
async function run(d,suffix,extra={}){const q=await prepare(d,suffix,extra);const hash=workspaceRevision(d);const r=await editWorkspaceScoped({documents:d,operation:q.op});assert.equal(workspaceRevision(d),hash,'入力は不変');return {...q,r};}
function ok(r){assert.equal(r.ok,true,JSON.stringify(r));assert(r.documents);}
function blocked(r){assert.equal(r.ok,false);assert(['EDIT_STRUCTURE_REFERENCED','EDIT_STRUCTURE_REFERENCE_UNKNOWN'].includes(r.code),JSON.stringify(r));assert.equal(r.documents,undefined);}
for(const value of ['', 'unrelated_entry'])for(const variable of [false,true])test(`R32 無関係なfocus宣言 ${JSON.stringify(value)} variable=${variable}`,async()=>{
 const d=doc([{picture:{type:'image'}},{entry:{type:'edit_box',...(variable?{'$focus_id|default':value,focus_identifier:'$focus_id'}:{focus_identifier:value})}}]);
 const {r}=await run(d,'/picture');ok(r);
 const {p}=await prepare(r.documents,'/entry');assert.equal(at(p.document,'/a/controls/0/entry').focus_identifier,value);
});
for(const variable of [false,true])test(`R32 真のfocus行先 variable=${variable}`,async()=>{
 const d=doc([{target:{type:'button',focus_identifier:'destination'}},{origin:{type:'button',...(variable?{'$next':'destination',focus_change_right:'$next'}:{focus_change_right:'destination'})}}]);
 const {r}=await run(d,'/target');blocked(r);assert.equal(r.code,'EDIT_STRUCTURE_REFERENCED');
 assert.equal(r.details?.[0]?.referenceKind||r.error?.details?.[0]?.referenceKind,'focus-target');
});
test('R32 条件分岐で到達し得るfocus値を現在の空文字で許可しない',async()=>{
 const d=doc([{target:{type:'button',focus_identifier:'destination'}},{origin:{type:'button','$next|default':'',focus_change_right:'$next',variables:[{requires:'($runtime_condition)','$next':'destination'}]}}]);
 blocked((await run(d,'/target')).r);
});
test('R32 bindingで上書きされるfocus行先を検査',async()=>{
 const d=doc([{target:{type:'button',focus_identifier:'destination'}},{origin:{type:'button',focus_change_right:'',bindings:[{binding_name:'#next',binding_name_override:'#focus_change_right'}]}}]);
 blocked((await run(d,'/target')).r);
});
test('R32 削除側のfocus IDが動的でも行先との関係を不明として保持',async()=>{
 const d=doc([{target:{type:'button',focus_identifier:'',bindings:[{binding_name:'#identity',binding_name_override:'#focus_identifier'}]}},{origin:{type:'button',focus_change_right:'destination'}}]);
 blocked((await run(d,'/target')).r);
});
test('R32 focus識別子のない独立装飾は無関係な動的focusに妨げられない',async()=>{
 const d=doc([{picture:{type:'image'}},{origin:{type:'button',focus_change_right:'#runtime_destination'}}]);ok((await run(d,'/picture')).r);
});
const button=(extra={})=>({type:'button',default_control:'default',controls:[{default:{type:'image'}}],...extra});
test('R32 別ボタンが自分の同名defaultを参照しても左全体を削除できる',async()=>{
 const d=doc([{left:button()},{right:button()}]);const {r}=await run(d,'/left');ok(r);const {p}=await prepare(r.documents,'/right');assert.deepEqual(JSON.parse(JSON.stringify(p.document.a.controls)),[{right:button()}]);
});
test('R32 本当に参照されるdefaultだけの削除は拒否',async()=>{blocked((await run(doc([{left:button()}]),'/default')).r);});
test('R32 共有定義の内部参照は別配置への削除参照ではない',async()=>{
 const d=doc([{'left@t.b':{}},{'right@t.b':{}}],{b:button()});const {r}=await run(d,'/left');ok(r);assert.deepEqual(JSON.parse(r.documents['ui/test.json']).b,button());
});
test('R32 未使用の条件変数宣言は参照ではない（R31過剰ガードの反例）',async()=>{
 const d=doc([{picture:{type:'image'}}],{}, {variables:[{requires:'($never_enabled)','$focus_override_right':'picture'}]});ok((await run(d,'/picture')).r);
});
test('R32 内部の相互focus参照は機能単位と一緒に消える',async()=>{
 const d=doc([{panel:{type:'panel',controls:[{a:{type:'button',focus_identifier:'A',focus_change_down:'B'}},{b:{type:'button',focus_identifier:'B',focus_change_up:'A'}}]}}]);ok((await run(d,'/panel')).r);
});
test('R32 外部から機能内部のfocusへ入る参照を保持',async()=>{
 const d=doc([{panel:{type:'panel',controls:[{a:{type:'button',focus_identifier:'A'}}]}},{outer:{type:'button',focus_change_right:'A'}}]);blocked((await run(d,'/panel')).r);
});
for(const variable of [false,true])test(`R32 別パネルからのview binding参照 variable=${variable}`,async()=>{
 const d=doc([{target:{type:'label'}},{container:{type:'panel',controls:[{observer:{type:'label',...(variable?{'$source':'target'}:{}),bindings:[{binding_type:'view',source_control_name:variable?'$source':'target',source_property_name:'#visible',target_property_name:'#visible'}]}}]}}]);blocked((await run(d,'/target')).r);
});
test('R32 同名子のview bindingはその所有先へ解決する',async()=>{
 const unit={type:'panel',controls:[{value:{type:'label'}},{observer:{type:'label',bindings:[{binding_type:'view',source_control_name:'value',resolve_sibling_scope:true,source_property_name:'#visible',target_property_name:'#visible'}]}}]};
 const d=doc([{left:unit},{right:unit}]);ok((await run(d,'/left')).r);
});
test('R32 関連する循環変数は未解決として停止',async()=>{
 const d=doc([{target:{type:'button',focus_identifier:'x'}},{origin:{type:'button','$a':'$b','$b':'$a',focus_change_right:'$a'}}]);blocked((await run(d,'/target')).r);
});
test('R32 深い変数参照も無制限に実行しない',async()=>{
 const vars={};for(let i=0;i<40;i++)vars['$v'+i]=i===39?'x':'$v'+(i+1);
 const d=doc([{target:{type:'button',focus_identifier:'x'}},{origin:{type:'button',...vars,focus_change_right:'$v0'}}]);blocked((await run(d,'/target')).r);
});
test('R32 明示した機能削除は子画像からボタン全体を削除する',async()=>{
 const d=doc([{left:button()},{right:button()}]);const {r}=await run(d,'/left/controls/0/default',{deletionUnit:'functional'});ok(r);assert.equal(r.editPlan.target.type,'button');assert.equal(r.editPlan.structure.deletionUnit,'functional');
});
test('R32 selected削除単位では機能の親へ勝手に切り替えない',async()=>{
 const d=doc([{left:{type:'button',controls:[{image:{type:'image'}}]}}]);const {r}=await run(d,'/image',{deletionUnit:'selected'});ok(r);assert.equal(r.editPlan.target.type,'image');
});
test('R32 未定義の削除単位を拒否',async()=>{
 const {r}=await run(doc([{target:{type:'label'}}]),'/target',{deletionUnit:'anything'});assert.equal(r.code,'EDIT_STRUCTURE_DELETE_UNIT');assert.equal(r.documents,undefined);
});
test('R32 planと確定の参照集計を同じ条件で保持',async()=>{
 const d=doc([{picture:{type:'image'}},{entry:{type:'edit_box','$focus_id':'',focus_identifier:'$focus_id'}}]);const q=await prepare(d,'/picture');
 const plan=await editWorkspaceScoped({documents:d,context:q.ctx,operation:{...q.op,type:'planDelete'}});const commit=await editWorkspaceScoped({documents:d,context:q.ctx,operation:q.op});
 assert(plan.ok&&commit.ok);assert.deepEqual(plan.editPlan,commit.editPlan);
});

test('R32 現在非表示でも条件で有効な未展開継承は黙って空として扱わない',async()=>{
 const d=doc([{picture:{type:'image'}},{hidden:{type:'panel','$hide|default':true,variables:[{requires:'($runtime_change)','$hide':false}],ignored:'$hide',controls:[{'observer@t.observer':{}}]}}],
 {observer:{type:'label',bindings:[{binding_type:'view',source_control_name:'picture',source_property_name:'#visible',target_property_name:'#visible'}]}});
 const {r}=await run(d,'/picture');assert.equal(r.code,'EDIT_STRUCTURE_REFERENCE_UNKNOWN');assert.equal(r.documents,undefined);
});
test('R32 固定で非参加の未展開枝は無関係な装飾削除を阻害しない',async()=>{
 const d=doc([{picture:{type:'image'}},{hidden:{type:'panel',ignored:true,controls:[{'observer@t.observer':{}}]}}],
 {observer:{type:'label',bindings:[{binding_type:'view',source_control_name:'picture',source_property_name:'#visible',target_property_name:'#visible'}]}});
 ok((await run(d,'/picture')).r);
});

test('R32 同じ定義でも配置ごとのfocus変数の上書きを混同しない',async()=>{
 const d=doc([{'left@t.entry':{'$id':'left'}},{'right@t.entry':{'$id':'right'}},{origin:{type:'button',focus_change_down:'right'}}],
 {entry:{type:'button','$id|default':'',focus_identifier:'$id'}});
 ok((await run(d,'/left')).r);blocked((await run(d,'/right')).r);
});
test('R32 動的なbinding書込プロパティ名は無検査で通さない',async()=>{
 const d=doc([{target:{type:'button',focus_identifier:'destination'}},{origin:{type:'button',bindings:[{binding_name:'#runtime_value',binding_name_override:'$unknown_property'}]}}]);
 const {r}=await run(d,'/target');assert.equal(r.code,'EDIT_STRUCTURE_REFERENCE_UNKNOWN');
});
test('R32 静的に不参加のbindingは外部参照ではない',async()=>{
 const d=doc([{picture:{type:'image'}},{watch:{type:'label',bindings:[{ignored:true,binding_type:'view',source_control_name:'picture',source_property_name:'#visible',target_property_name:'#visible'}]}}]);
 ok((await run(d,'/picture')).r);
});
test('R32 数値の式が常にfalseになる条件では隠れたfocus候補を採用しない',async()=>{
 const d=doc([{target:{type:'button',focus_identifier:'destination'}},{origin:{type:'button','$next|default':'',focus_change_down:'$next',variables:[{requires:'(1 = 2)','$next':'destination'}]}}]);
 ok((await run(d,'/target')).r);
});

test('R32 個別配置の通常のネストを名前だけで別ボタンへ誤結合しない',async()=>{
 for(let depth=0;depth<8;depth++){
  let left=button(),right=button();
  for(let i=0;i<depth;i++){left={type:'panel',controls:[{nested:left}]};right={type:'panel',controls:[{nested:right}]};}
  ok((await run(doc([{left},{right}]),'/left')).r);
 }
});
