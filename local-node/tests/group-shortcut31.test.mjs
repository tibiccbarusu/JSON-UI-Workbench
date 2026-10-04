import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandSystem} from '../../editor-core/src/commands/command-system.js';
import {registerEditorGroupCommands31,groupUnavailableReason31} from '../../editor-core/src/commands/editor-group-commands31.js';
class Element {
 constructor(region='canvas',text=false){this.region=region;this.text=text;this.tagName=text?'INPUT':'BUTTON';this.isContentEditable=false;}
 getAttribute(n){return n==='type'&&this.text?'text':'';}
 closest(selector){if(selector.startsWith('input,'))return this.text?this:null;return ['canvas','tree','ribbon','menu'].includes(this.region)?this:null;}
}
globalThis.HTMLElement=Element;
function setup(){
 const state={editing:true,busy:false,modalOpen:false,selection:{canGroup:true,canUngroup:true,selectedIds:['a','b'],movementRootIds:['a','b']}};
 const calls={group:0,ungroup:0,reasons:[]};const system=createCommandSystem({onError:e=>{throw e;}});
 registerEditorGroupCommands31(system,{getState:()=>state,group:()=>calls.group++,ungroup:()=>calls.ungroup++,notify:x=>calls.reasons.push(x)});
 return{state,calls,system};
}
function key({region='canvas',text=false,alt=true,shift=false,...extra}={}){
 return{key:shift?'G':'g',code:'KeyG',ctrlKey:true,metaKey:false,altKey:alt,shiftKey:shift,repeat:false,isComposing:false,keyCode:71,target:new Element(region,text),defaultPrevented:false,
 preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};
}
for(const region of ['canvas','tree','ribbon','menu'])test(`R31 グループキー ${region} は同じ登録を使用`,()=>{const {system,calls}=setup(),ev=key({region});assert(system.handleKeydown(ev,{}));assert.equal(calls.group,1);assert(ev.defaultPrevented);assert.equal(system.handleKeydown(ev,{}),false);assert.equal(calls.group,1);});
test('R31 Ctrl+Gはブラウザーへ渡し解除キーは別登録',()=>{const {system,calls}=setup();const old=key({alt:false});assert.equal(system.handleKeydown(old,{}),false);assert.equal(old.defaultPrevented,false);system.handleKeydown(key({shift:true}),{});assert.equal(calls.ungroup,1);});
for(const [name,patch]of [['text',{text:true}],['IME',{isComposing:true}],['IME229',{keyCode:229}],['AltGraph',{getModifierState:k=>k==='AltGraph'}],['body',{region:'body'}]])test(`R31 ${name}の入力を奪わない`,()=>{const {system,calls}=setup(),ev=key(patch);assert.equal(system.handleKeydown(ev,{}),false);assert.equal(ev.defaultPrevented,false);assert.equal(calls.group,0);});
test('R31 dialog・閲覧モードは受理しない',()=>{const {system,state,calls}=setup();state.modalOpen=true;const e=key();system.handleKeydown(e,{});assert.equal(e.defaultPrevented,false);state.modalOpen=false;state.editing=false;system.handleKeydown(key(),{});assert.equal(calls.group,0);});
test('R31 repeatを再実行せず編集領域でだけ消費',()=>{const {system,calls}=setup();system.handleKeydown(key(),{});for(let i=0;i<4;i++){const e=key({repeat:true});system.handleKeydown(e,{});assert(e.defaultPrevented);}assert.equal(calls.group,1);const outside=key({repeat:true,region:'body'});system.handleKeydown(outside,{});assert.equal(outside.defaultPrevented,false);});
test('R31 独立対象不足は1回案内し、repeatで例外を増やさない',()=>{const {system,state,calls}=setup();state.selection={canGroup:false,selectedIds:['parent','child'],movementRootIds:['parent']};system.handleKeydown(key(),{});system.handleKeydown(key({repeat:true}),{});assert.equal(calls.group,0);assert.equal(calls.reasons.length,1);assert.match(calls.reasons[0],/独立した対象は1個/);});
test('R31 ボタンのexecuteも同じ実行可否で処理',()=>{const {system,state,calls}=setup();system.execute('editor.group',{});assert.equal(calls.group,1);state.busy=true;assert.equal(system.execute('editor.group',{}).reason,'CMD_DISABLED');assert.equal(calls.group,1);assert.match(calls.reasons[0],/完了/);});
