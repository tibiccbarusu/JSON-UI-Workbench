import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntimeInputCatalog, parseRuntimeInputValue, applyRuntimeInputDraft, renderRuntimeInputEditor } from '../src/ui/runtime-input-editor.js';
import { normalizePreviewState } from '../src/engine/preview-state.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
function model() { return buildUiScreenModelFromJson({namespace:'test',screen:{type:'screen',controls:[
 {show:{type:'image',bindings:[{binding_name:'#show',binding_name_override:'#visible'}]}},
 {label:{type:'label',bindings:[{binding_name:'#title',binding_name_override:'#text'}]}},
 {bar:{type:'image',bindings:[{binding_name:'#ratio',binding_name_override:'#alpha'}]}},
 {row:{type:'label',bindings:[{binding_type:'collection',binding_name:'#row',binding_collection_name:'rows'}]}},
 {view:{type:'image',bindings:[{binding_type:'view',binding_name:'#output',source_control_name:'label',target_property_name:'#visible'}]}},
]}}, {filePath:'ui/test.json'}); }
function dom(){const rows=[];function h(tag,attrs={},children=[]){const el={tag,attrs,children,value:attrs.value??'',textContent:'',disabled:attrs.disabled||false,replaceChildren(...children){this.children=children;}};rows.push(el);return el;}return {h,rows};}
test('実modelの外部入力だけ列挙しview出力とcollection行を混同しない',()=>{
 const m=model(), c=buildRuntimeInputCatalog(m);assert.deepEqual(c.inputs.map(r=>r.name),['#ratio','#show','#title']);assert.deepEqual(c.collections,['rows']);
 assert.equal(c.inputs.find(r=>r.name==='#show').type,'boolean');assert.equal(c.inputs.find(r=>r.name==='#ratio').type,'number');assert.equal(buildRuntimeInputCatalog(m),c);
});
test('重複bindingは項目を増やさず参照数を記録、循環modelで終了する',()=>{
 const node={bindings:[{binding_name:'#x'}],children:[]};node.children=[node,{bindings:[{binding_name:'#x'}]}];const c=buildRuntimeInputCatalog({root:node});assert.equal(c.inputs.length,1);assert.equal(c.inputs[0].count,2);
});
test('false・0・空文字・nullを未指定にせず別々に適用する',()=>{
 const current={'#keep':'そのまま',__collections:{rows:[{'#v':3}]}};
 const draft={'#bool':{type:'boolean',text:'false'},'#num':{type:'number',text:'0'},'#text':{type:'string',text:''},'#json':{type:'json',text:'null'}};
 const out=normalizePreviewState(applyRuntimeInputDraft(current,draft));assert.equal(out.mockData['#bool'],false);assert.equal(out.mockData['#num'],0);assert.equal(out.mockData['#text'],'');assert.equal(out.mockData['#json'],null);assert.equal(out.mockData['#keep'],'そのまま');assert.equal(out.collectionData.rows[0]['#v'],3);assert.equal(current['#num'],undefined);
});
test('解除だけキーを取り除き元のstateやcollectionを変更しない',()=>{
 const current={'#remove':false,'#empty':'',__collections:{rows:[]}};const out=applyRuntimeInputDraft(current,{'#remove':{remove:true}});
 assert.ok(!Object.hasOwn(out.mockData,'#remove'));assert.equal(out.mockData['#empty'],'');assert.equal(current['#remove'],false);assert.deepEqual(out.collectionData,{rows:[]});
});
test('不正な入力の一括適用は失敗し元stateを部分更新しない',()=>{
 const current={'#keep':'a'};assert.throws(()=>applyRuntimeInputDraft(current,{'#keep':{type:'string',text:'b'},'#bad':{type:'number',text:'NaN'}}),/有限/);assert.equal(current['#keep'],'a');
 assert.throws(()=>parseRuntimeInputValue('','number'),/空/);assert.throws(()=>parseRuntimeInputValue('yes','boolean'),/true/);assert.throws(()=>parseRuntimeInputValue('{','json'),/JSON/);
});
test('危険なJSON・異常なbinding名は既存正規化境界で拒否する',()=>{
 assert.throws(()=>normalizePreviewState(applyRuntimeInputDraft({}, {'#x':{type:'json',text:'{"__proto__":{"polluted":true}}'}})),/UNSAFE_KEY/);
 assert.throws(()=>applyRuntimeInputDraft({}, {'bad':{type:'string',text:'x'}}),/不正/);assert.equal({}.polluted,undefined);
});
test('2000入力でも描画する編集欄は24件、検索と改ページを局所更新する',()=>{
 const m={root:{bindings:Array.from({length:2000},(_,i)=>({binding_name:'#value_'+i})),children:[]}},d=dom(),state={open:true};renderRuntimeInputEditor(d.h,{model:m,current:{},state,onApply:()=>true,onOpenJson(){}});
 const list=d.rows.find(r=>r.attrs.class==='runtime-input-list');assert.equal(list.children.length,24);
 const search=d.rows.find(r=>r.attrs.type==='search');search.attrs.onInput({currentTarget:{value:'#value_1999'}});assert.equal(list.children.length,1);assert.equal(state.query,'#value_1999');
});
test('入力中は適用せず、型付き入力を適用した後の表示を更新する',()=>{
 const d=dom(),state={open:true};let applied=0;renderRuntimeInputEditor(d.h,{model:model(),current:{'#title':'前'},state,onApply:drafts=>{applied++;return applyRuntimeInputDraft({'#title':'前'},drafts).mockData;},onOpenJson(){}});
 const input=d.rows.find(r=>r.attrs['aria-label']==='#title の値');input.attrs.onInput({currentTarget:{value:'新しい文字'}});assert.equal(applied,0);
 d.rows.find(r=>r.children.includes('入力値を適用')).attrs.onClick();assert.equal(applied,1);assert.equal(Object.keys(state.drafts).length,0);
 assert.equal(d.rows.filter(r=>r.attrs['aria-label']==='#title の値').at(-1).attrs.value,'新しい文字');
});
test('適用失敗は編集中データを保ち原因を表示する',()=>{
 const d=dom(),state={open:true,drafts:{'#title':{type:'string',text:'未適用'}}};renderRuntimeInputEditor(d.h,{model:model(),state,onApply:()=>{throw Error('状態JSONに未適用');},onOpenJson(){}});
 d.rows.find(r=>r.children.includes('入力値を適用')).attrs.onClick();assert.equal(state.drafts['#title'].text,'未適用');assert.match(d.rows.find(r=>r.attrs.role==='status').textContent,/状態JSONに未適用/);
});

test('閉じた一覧はmodelを走査せず初回展開時だけ最新stateを読む',()=>{
 const d=dom(),state={};let reads=0,current={'#title':'前'};const root=model().root;const m={get root(){reads++;return root;}};
 const ui=renderRuntimeInputEditor(d.h,{model:m,state,getCurrent:()=>current,onApply(){},onOpenJson(){}});
 assert.equal(reads,0);assert.equal(d.rows.filter(r=>r.tag==='textarea').length,0);
 current={'#title':'後\n複数行'};ui.attrs.onToggle({currentTarget:{open:true}});
 assert.ok(reads>0);assert.equal(d.rows.find(r=>r.attrs['aria-label']==='#title の値').value,'後\n複数行');assert.equal(d.rows.find(r=>r.attrs['aria-label']==='#title の値').tag,'textarea');
 const firstReads=reads;ui.attrs.onToggle({currentTarget:{open:false}});ui.attrs.onToggle({currentTarget:{open:true}});assert.equal(reads,firstReads);
});
test('局所更新は最新false/0/空文字を読み、編集中draftを保持する',()=>{
 const d=dom(),state={open:true,drafts:{'#title':{type:'string',text:'編集中\n文字'}}};let current={'#show':true,'#ratio':1,'#title':'前'};
 const ui=renderRuntimeInputEditor(d.h,{model:model(),state,getCurrent:()=>current,onApply(){},onOpenJson(){}});
 current={'#show':false,'#ratio':0,'#title':''};ui.refreshRuntimeInputs();
 const value=name=>d.rows.filter(r=>r.attrs['aria-label']===name+' の値').at(-1).value;
 assert.equal(value('#show'),'false');assert.equal(value('#ratio'),'0');assert.equal(value('#title'),'編集中\n文字');
});
test('一覧内フォーカス中の局所更新はDOMを保持し外へ移動後に反映する',async()=>{
 const d=dom(),state={open:true};let current={'#title':'前'};const ui=renderRuntimeInputEditor(d.h,{model:model(),state,getCurrent:()=>current,onApply(){},onOpenJson(){}});
 const active={};ui.ownerDocument={activeElement:active};ui.contains=x=>x===active;
 const old=d.rows.filter(r=>r.attrs['aria-label']==='#title の値').at(-1);current={'#title':'後'};ui.refreshRuntimeInputs();
 assert.equal(d.rows.filter(r=>r.attrs['aria-label']==='#title の値').at(-1),old);
 ui.ownerDocument.activeElement=null;ui.attrs.onFocusout();await Promise.resolve();assert.equal(d.rows.filter(r=>r.attrs['aria-label']==='#title の値').at(-1).value,'後');
});
test('同UIの純粋データ変更は全workspace DOMを再構築せず新model/詳細panelは再構築する',async()=>{
 const {classifyPreviewStoreChange}=await import('../src/ui/preview-workspace.js');const file={};const state={ui:{route:'editor',panels:{rightPx:0}},files:{currentFileId:'a',byId:{a:file}}};
 assert.equal(classifyPreviewStoreChange({...state,preview:{mockDataVersion:2}},state,{type:'preview/setMockData'}),'data');
 assert.equal(classifyPreviewStoreChange({...state,files:{currentFileId:'a',byId:{a:{}}}},state,{type:'preview/setMockData'}),'full');
 assert.equal(classifyPreviewStoreChange(state,state.files?{...state}:state,{type:'preview/setMockData'},{detailed:true}),'full');
});
