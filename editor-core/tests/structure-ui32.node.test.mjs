import * as insert35 from '../src/ui/studio-insert35.js';
/** 実リボン生成と実追加状態関数の結合。DOMモデル検査であり実サイト全体ではない。 */
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs/promises';
import * as shell from '../src/ui/studio-shell.js';import * as layout28 from '../src/ui/studio-layout28.js';import * as add32 from '../src/ui/workspace-add-intent32.js';import * as insertion33 from '../src/ui/editor-insertion33.js';import {siteText} from '../src/i18n/site-messages.js';
const main=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8'),css=await fs.readFile(new URL('../app/styles.css',import.meta.url),'utf8');
const existing=await fs.readFile(new URL('studio-shell23.node.test.mjs',import.meta.url),'utf8');
function fixture(tab='insert'){const ctx=vm.createContext({vm,assert,main,css,shell,layout28,insert35,siteText,console});vm.runInContext(existing.slice(existing.indexOf('function section('),existing.indexOf('\ntest(')),ctx);
 const f=ctx.harness({editing:true,tab});Object.assign(f.s,add32,insertion33);
 f.state.files.byId.f.nodesById={root:{id:'root',type:'screen',children:['root/panel']},'root/panel':{id:'root/panel',type:'panel',children:['root/panel/texture']},'root/panel/texture':{id:'root/panel/texture',type:'image',children:[]}};
 f.state.files.byId.f.uiModel={root:{children:[{id:'root'}]}};
 Object.assign(f.workspace.state,{editScope:'screen',previewSelection:{fileId:'f',nodeId:'root/panel/texture',screen:{path:'ui/test.json'}},addType:'',deleteUnit32:'selected',insertionRelation32:'inside'});
 vm.runInContext(main.slice(main.indexOf('function currentInsertionParent33('),main.indexOf('async function addSourceCanvasElement(')),f.s);return f;
}
test('R32 実リボンで追加種類と追加先の方式が連動し、画像から同階層を明示できる',()=>{const f=fixture();f.render();const select=f.byId('workspace-add-type');select.value='label';select.dispatch('change');assert.equal(f.workspace.state.addType,'label');f.render();assert.match(f.root.textContent,/同じ階層へ/u);const relation=f.byId('workspace-add-relation32');relation.value='sibling';relation.dispatch('change');f.render();assert.match(f.root.textContent,/追加先: root → panel \(panel\)/u);assert.equal(f.workspace.state.previewSelection.nodeId,'root/panel/texture');});
test('R32 追加中止は実ボタンから現在の追加だけを終了する',async()=>{const f=fixture();add32.setAddType32(f.workspace.state,'image');f.render();f.byId('workspace-add-cancel32').dispatch('click');await Promise.resolve();await Promise.resolve();assert.equal(f.workspace.state.addType,'');assert.equal(f.workspace.state.previewSelection.nodeId,'root/panel/texture');});
test('R32 削除単位の変更は既存の削除計画を無効化する',()=>{const f=fixture('edit');f.workspace.state.deletePlan={old:true};f.render();const unit=f.byId('workspace-delete-unit32');unit.value='functional';unit.dispatch('change');assert.equal(f.workspace.state.deleteUnit32,'functional');assert.equal(f.workspace.state.deletePlan,null);});
test('R32 拒否済みとpending0を保存完了として混同しない',()=>{const f=fixture();f.workspace.state.lastStructureAttempt32={type:'delete',status:'rejected',message:'参照元の確認が必要'};f.render();assert.match(f.root.textContent,/直前の削除は未受理で、出力に含まれません/u);assert.match(f.root.textContent,/参照元の確認が必要/u);assert.equal(f.byId('studio-apply-pending').disabled,true);});
test('R32 画像・ボタンを追加する際に未設定の内容を明示する',()=>{for(const [type,expected] of [['image',/テクスチャ/u],['button',/動作は原文で割り当て/u]]){const f=fixture();add32.setAddType32(f.workspace.state,type);f.render();assert.match(f.root.textContent,expected);}});
