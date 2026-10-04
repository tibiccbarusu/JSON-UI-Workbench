/** R31: 構造操作の境界と、配布時に意味を失わないための小さな回帰。 */
import test from'node:test';import assert from'node:assert/strict';
import {createWorkspacePendingEdits}from'../../editor-core/src/ui/workspace-pending-edits.js';
import {summarizeWorkspaceResult}from'../workspace-operation-summary.mjs';
import{createEditorSelection21}from'../../editor-core/src/ui/editor-selection21.js';
import{createCommandSystem}from'../../editor-core/src/commands/command-system.js';
import{registerEditorGroupCommands31}from'../../editor-core/src/commands/editor-group-commands31.js';
function pendingFixture(){const state={workspaceId:'w',revision:'r',busy:false,projectionError:false,previewAllowed:true,drafts:new Map(),pendingOperations:[],pendingRedoOperations:[],pendingVersion:0};
 const p=createWorkspacePendingEdits({state,notify(){},normalizeOperation:x=>x,commit:()=>({ok:true,revision:'after'})});return{p,state};}
const addition={type:'add',scope:'screen',targetMode:'interaction',path:'ui/a.json',pointer:'/a',parentPointer:'/a',name:'new_one',value:{type:'label',text:'新規',offset:[0,0]}};
test('R31 画面限定の構造操作の後へ別の要素操作を追加しない',()=>{
 const {p,state}=pendingFixture();p.enqueue([addition]);const before=JSON.stringify(state.pendingOperations);
 assert.throws(()=>p.enqueue([{type:'move',path:'ui/a.json',pointer:'/a/controls/0/old',delta:[1,0]}]),{code:'WORKSPACE_PENDING_STRUCTURE_BARRIER'});
 assert.equal(JSON.stringify(state.pendingOperations),before);
});
test('R31 追加予定の要素自身は構造バリアの後でも編集でき、1つのaddになる',()=>{
 const {p,state}=pendingFixture();p.enqueue([addition]);const id=state.pendingOperations[0].pendingAdditionId;
 p.editAddition(id,{type:'move',delta:[3,4]});const operations=p.compiledOperations();assert.equal(operations.length,1);assert.deepEqual(operations[0].value.offset,[3,4]);
 p.undo();assert.deepEqual(p.compiledOperations()[0].value.offset,[0,0]);p.redo();assert.deepEqual(p.compiledOperations()[0].value.offset,[3,4]);
});
test('R31 旧共有原文のadd後の通常編集は従来のpointer追跡を維持',()=>{
 const {p}=pendingFixture();const {scope,targetMode,...raw}=addition;p.enqueue([raw]);p.enqueue([{type:'set',path:'ui/a.json',pointer:'/a/alpha',value:0.5}]);assert.equal(p.compiledOperations().length,2);
});
test('R31 対象判定と構造操作の診断は容量制限のある項目だけ',()=>{
 const plan={scope:'screen',targetMode:'interaction',targetPolicyVersion:'bounded-functional-owner-31.1',targetDecision:'local-control',affectedDescendants:2,targetAnalysisComplete:true,structure:{operation:'add'},secretValue:'private-payload'};
 const result=summarizeWorkspaceResult({ok:true,editPlan:plan});assert.equal(result.edit_plan.target_decision,'local-control');assert.equal(result.edit_plan.affected_descendants,2);assert.equal(result.edit_plan.structure_operation,'add');assert(!JSON.stringify(result).includes('private-payload'));
});
test('R31 実グループメタデータを共通コマンドで作成・解除・履歴復帰',()=>{
 const nodes={root:{id:'root',isFileRoot:true,children:['a','b']},a:{id:'a',parentId:'root',children:[]},b:{id:'b',parentId:'root',children:[]}};
 const original=JSON.stringify(nodes),select=createEditorSelection21();select.useScreen('test',{rootId:'root',nodesById:nodes});select.setSelection(['a','b']);
 const system=createCommandSystem();registerEditorGroupCommands31(system,{getState:()=>({editing:true,selection:select.snapshot()}),group:()=>select.groupSelected(),ungroup:()=>select.ungroupSelected()});
 assert(system.execute('editor.group').ok);assert.equal(select.snapshot().groups.length,1);assert(system.execute('editor.ungroup').ok);assert.equal(select.snapshot().groups.length,0);
 select.undoGroup();assert.equal(select.snapshot().groups.length,1);assert.equal(JSON.stringify(nodes),original,'原文の親子関係は変更しない');
});
