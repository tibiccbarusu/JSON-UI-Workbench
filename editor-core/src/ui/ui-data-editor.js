import { siteText, translateSiteMessage } from '../i18n/site-messages.js';
/** UI固有の挿入箇所を案内し、適用時だけ状態を変更する。 */
import { buildUiDataCatalog, getUiSlotAddress } from './ui-data-catalog.js';
import { normalizePreviewState } from '../engine/preview-state.js';
import { EMPTY_CLASSIC_SLOT_ROW } from '../engine/classic-empty-slots.js';

function fail(message){throw new Error(message);}
function stateParts(current){const {__collections={},...mockData}=current||{};return {mockData,collectionData:__collections};}
function fieldById(catalog,id){const field=catalog?.textFields.find(row=>row.id===id);if(!field?.binding)fail(siteText('この入力欄の表示先を確定できません。状態JSONで指定してください。'));return field;}
/** すべての操作を検証してから新状態を返す。途中で失敗してもcurrentは不変。 */
export function applyUiDataDraft(current,operations,{catalog}={}){
  if(!Array.isArray(operations)||operations.length>256)fail(siteText('一度に適用できる変更は256件までです。'));
  // 防御と深いコピーは既存の共通正規化へ集約する。
  const normalized=normalizePreviewState(stateParts(current));
  const mockData={...normalized.mockData},collectionData={...normalized.collectionData};
  for(const op of operations){
    if(!op||typeof op!=='object')fail(siteText('データ操作が不正です。'));
    if(op.kind==='slot'){
      const address=getUiSlotAddress(op.collection,op.index),slot=catalog?.slots.find(row=>row.collection===address.collection);
      if(!slot)fail(siteText('選択したUIにこのスロットは見つかりません。'));
      if(slot.nestedOnly)fail(siteText('このスロットは別の一覧の中にあります。親の一覧データから編集してください。'));
      if(slot.capacity!==null&&address.index>=slot.capacity)fail(siteText`この項目は${slot.capacity}スロットです。`);
      const row=normalizePreviewState({slots:{[address.collection]:[op.item]}}).collectionData[address.collection][0];
      const rows=[...(collectionData[address.collection]||[])];
      const capacity=Math.max(rows.length,slot.capacity||0,address.index+1);
      while(rows.length<capacity)rows.push({...EMPTY_CLASSIC_SLOT_ROW});
      rows[address.index]=row;collectionData[address.collection]=rows;
    }else if(op.kind==='collection'){
      const target=catalog?.collections.find(row=>row.name===op.collection);if(!target)fail(siteText('選択したUIにこの一覧は見つかりません。'));
      if(target.nestedOnly)fail(siteText('この一覧は別の一覧の中にあります。親の一覧データから編集してください。'));
      const out=normalizePreviewState({collectionData:{[op.collection]:op.rows}});collectionData[op.collection]=out.collectionData[op.collection];
    }else if(op.kind==='text'){
      const field=fieldById(catalog,op.fieldId);
      if(typeof op.value!=='string')fail(siteText('入力欄には文字列を指定してください。'));
      if(op.value.length>65536)fail(siteText('文字列は65,536文字以下にしてください。'));
      // 公式の「文字数」はUnicode単位を規定していない。ブラウザmaxlengthと同じUTF-16で保守的に制限。
      if(field.maxLength!==null&&op.value.length>field.maxLength)fail(siteText`この入力欄は最大${field.maxLength}文字です。`);
      if(field.collection){
        if(catalog.collections.find(row=>row.name===field.collection)?.nestedOnly)fail(siteText('この入力欄は入れ子の一覧にあります。親の一覧データから編集してください。'));
        const {index}=getUiSlotAddress(field.collection,op.index);
        const rows=[...(collectionData[field.collection]||[])];
        if(index>=rows.length)fail(siteText('先に「一覧データ」でこの行を作成してください。'));
        rows[index]={...rows[index],[field.binding]:op.value};collectionData[field.collection]=rows;
      }else mockData[field.binding]=op.value;
    }else fail(siteText('未対応のデータ操作です。'));
  }
  const out=normalizePreviewState({mockData,collectionData});
  return {mockData:out.mockData,collectionData:out.collectionData};
}

export function createUiCollectionExample(collection){
  switch(collection){
    case 'book_pages':return normalizePreviewState({book:{pages:['1ページ目の本文','2ページ目の本文'],editable:true}}).collectionData.book_pages;
    case '#enchant_buttons':return [1,2,3].map(cost=>({'#runes':'サンプル','#cost':String(cost),'#hover_text':'描画確認用の候補','#selectable_button_visibility':true,'#unselectable_button_visibility':false,'#selectable_dust_is_visible':true,'#unselectable_dust_is_visible':false}));
    case 'form_buttons':return [{'#form_button_text':'サンプルボタン','__jsonui_preview_factory_control_id':'button'}];
    default:return [{}];
  }
}
function getItem(row){
  return {id:row?.__jsonui_preview_item_id||'',count:row?.__jsonui_preview_item_count??1,name:row?.['#hover_text']??'',atlasKey:row?.__jsonui_preview_item_atlas_key||'',texture:row?.__jsonui_preview_item_texture||'',variant:row?.__jsonui_preview_item_variant};
}
function input(h,label,attrs){return h('label',{class:'ui-data-field'},[h('span',{},[label]),h('input',attrs)]);}

/** stateは選択UIごとにrootが保持する。itemCatalogは確認済みatlasKey候補のみ。 */
export function renderUiDataEditor(h,options){
  const state=options.state||{},summary=h('summary',{},[siteText('このUIに挿入できるデータ')]),content=h('div',{class:'ui-data-content'},[]);
  let body=null,pending=false;
  function mount(){if(body)return;body=renderBody(h,{...options,state});content.replaceChildren(body);const c=buildUiDataCatalog(options.model);summary.textContent=siteText`このUIに挿入できるデータ（スロット ${c.slots.length} 種類・入力欄 ${c.textFields.length} 件・一覧 ${c.collections.length} 種類）`;}
  const details=h('details',{class:'ui-data-editor',open:state.open||null,onToggle:e=>{state.open=e.currentTarget.open;if(state.open)mount();},onFocusout:()=>queueMicrotask(()=>{if(pending)details.refreshUiData();})},[summary,content]);
  details.refreshUiData=()=>{if(!body)return;const active=details.ownerDocument?.activeElement;if(active&&details.contains?.(active)){pending=true;return;}pending=false;body.refreshUiData();};
  if(state.open)mount();return details;
}
function renderBody(h,{model,state,current={},getCurrent,disabled=false,onApply,onOpenJson,itemCatalog=[]}){
  const catalog=buildUiDataCatalog(model);state.mode||='slots';state.query||='';state.page||=0;state.drafts||={};
  const notice=h('p',{class:'hint',role:'status'},[]),area=h('div',{class:'ui-data-form'},[]),list=h('div',{class:'ui-data-list'},[]);
  const report=text=>{notice.textContent=text;};
  const latest=()=>getCurrent?.()||current;
  const submit=op=>{try{const notices=op.kind==='slot'?normalizePreviewState({slots:{[op.collection]:[op.item]}}).diagnostics:[];const result=onApply([op]);if(result===false)return;if(result&&typeof result==='object')current=result;state.drafts={};drawForm();report(siteText`データを適用しました。${notices.length?siteText('このアイテムIDの画像は未確認です。表示するにはパック内の画像キーまたはテクスチャを指定してください。'):''}`);}catch(error){report(siteText`適用できません: ${translateSiteMessage(error.message||error)}`);}};
  const collectionByName=name=>catalog.collections.find(row=>row.name===name);
  function select(name){state.selected=name;state.drafts={};drawForm();}
  function drawList(){
    const rows=(state.mode==='slots'?catalog.slots:state.mode==='text'?catalog.textFields:catalog.collections).filter(row=>(`${row.label} ${row.collection||row.name||row.binding||''}`).toLowerCase().includes(state.query.toLowerCase()));
    const pages=Math.max(1,Math.ceil(rows.length/24));state.page=Math.max(0,Math.min(state.page,pages-1));pageInfo.textContent=siteText`${rows.length}件・${state.page+1}/${pages}ページ`;
    previous.disabled=disabled||state.page===0;next.disabled=disabled||state.page>=pages-1;
    list.replaceChildren(...rows.slice(state.page*24,state.page*24+24).map(row=>{
      const key=state.mode==='slots'?row.collection:state.mode==='text'?row.id:row.name;
      const suffix=state.mode==='slots'?siteText`${row.capacity??siteText('定義・状態に応じた数')}枠${row.role==='output'?siteText('／結果スロット（表示用の値は指定可、ドラッグ投入は不可）'):''}`:state.mode==='text'?`${row.maxLength===null?siteText('文字数上限は未解決'):siteText`最大${row.maxLength}文字`}${row.collection?siteText`／${row.collection} の各行`:''}`:siteText`行の値: ${row.bindings.slice(0,8).join(', ')||siteText('明示的な値')}`;
      return h('button',{class:'btn ui-data-choice',type:'button',disabled,'aria-pressed':String(state.selected===key),onClick:()=>{select(key);drawList();}},[h('strong',{},[row.label]),h('small',{},[suffix])]);
    }));
    if(!rows.length)list.replaceChildren(h('p',{class:'hint'},[siteText('このUI定義に該当する挿入先は見つかりません。別の定義を選択すると一覧も変わります。')]));
  }
  function drawForm(){
    area.replaceChildren();const values=latest(),collections=values.__collections||{};
    if(state.mode==='slots'){
      const slot=catalog.slots.find(row=>row.collection===state.selected);if(!slot)return;
      if(slot.nestedOnly){area.replaceChildren(h('p',{class:'hint'},[siteText`このスロットは ${slot.nestedParents.join(', ')} の各行の中にあります。「一覧データ」で親の一覧を選び、その行の __collections を編集してください。`]));return;}
      const draft=state.drafts.slot||{},index=draft.index??0,row=collections[slot.collection]?.[index],base=getItem(row),saved={...base,...draft};
      const patch=(key,value)=>{state.drafts.slot={...(state.drafts.slot||{}),[key]:value};};
      const indexInput=h('input',{type:'number',min:'1',max:String(slot.capacity||256),value:String(index+1),disabled,'aria-label':siteText('スロット番号'),onChange:e=>{const n=Number(e.currentTarget.value);if(!Number.isInteger(n)||n<1||n>(slot.capacity||256)){report(siteText('スロット番号を確認してください。'));return;}state.drafts.slot={index:n-1};drawForm();}});
      const idInput=h('input',{type:'text',value:saved.id,disabled,maxlength:'256',placeholder:'minecraft:diamond','aria-label':siteText('アイテムID'),onInput:e=>patch('id',e.currentTarget.value)});
      const countInput=h('input',{type:'number',min:'0',max:'999',value:String(saved.count),disabled,'aria-label':siteText('アイテム個数'),onInput:e=>patch('count',e.currentTarget.value)});
      const nameInput=h('input',{type:'text',value:saved.name,disabled,maxlength:'65536','aria-label':siteText('アイテムの表示名'),onInput:e=>patch('name',e.currentTarget.value)});
      const atlasList=h('datalist',{id:'ui-data-atlas-options'},[]);
      const updateAtlas=query=>{const key=query.toLowerCase();atlasList.replaceChildren(...itemCatalog.slice(0,8192).filter(row=>typeof row.atlasKey==='string'&&row.atlasKey.toLowerCase().includes(key)).slice(0,128).map(row=>h('option',{value:row.atlasKey},[row.label||row.atlasKey])));};
      updateAtlas(saved.atlasKey);
      const atlasInput=h('input',{type:'text',value:saved.atlasKey,disabled,maxlength:'128',list:'ui-data-atlas-options',placeholder:'diamond','aria-label':siteText('アイテム画像のatlasKey'),onInput:e=>{patch('atlasKey',e.currentTarget.value);updateAtlas(e.currentTarget.value);}});
      const textureInput=h('input',{type:'text',value:saved.texture,disabled,maxlength:'512',placeholder:'textures/items/diamond','aria-label':siteText('アイテム画像のtexture'),onInput:e=>patch('texture',e.currentTarget.value)});
      const variantInput=h('input',{type:'number',min:'0',max:'4095',value:saved.variant===undefined?'':String(saved.variant),disabled,'aria-label':siteText('アイテム画像のバリエーション番号'),onInput:e=>patch('variant',e.currentTarget.value)});
      const labelled=(label,control)=>h('label',{class:'ui-data-field'},[h('span',{},[label]),control]);
      const action=h('button',{class:'btn btn-primary',type:'button',disabled,onClick:()=>{
        const item={id:idInput.value.trim(),count:Number(countInput.value),name:nameInput.value};
        if(atlasInput.value.trim())item.atlasKey=atlasInput.value.trim();if(textureInput.value.trim())item.texture=textureInput.value.trim();
        if(variantInput.value!=='')item.variant=Number(variantInput.value);
        if(!countInput.value.trim()){report(siteText('個数が空です。0または個数を指定してください。'));return;}
        submit({kind:'slot',collection:slot.collection,index,item});
      }},[siteText('このスロットへ設定')]);
      area.replaceChildren(h('h4',{},[slot.label]),h('p',{class:'hint'},[siteText('番号は左上から1番です。アイテムIDに対応する画像を確認できない場合は、パックの画像キーまたはテクスチャを指定してください。画像キーとテクスチャは片方だけ指定します。')]),labelled(siteText('スロット番号'),indexInput),labelled(siteText('アイテムID'),idInput),labelled(siteText('個数'),countInput),labelled(siteText('表示名'),nameInput),labelled(siteText('画像キー（atlasKey）'),atlasInput),atlasList,labelled(siteText('テクスチャのパス'),textureInput),labelled(siteText('画像のバリエーション（省略可）'),variantInput),h('div',{class:'ui-data-actions'},[action,h('button',{class:'btn',type:'button',disabled,onClick:()=>submit({kind:'slot',collection:slot.collection,index,item:null})},[siteText('このスロットを空にする')])]));
    }else if(state.mode==='collections'){
      const row=collectionByName(state.selected);if(!row)return;
      if(row.nestedOnly){area.replaceChildren(h('p',{class:'hint'},[siteText`この一覧は ${row.nestedParents.join(', ')} の各行の中にあります。親の一覧を選び、その行の __collections を編集してください。`]));return;}
      const text=state.drafts.collectionText??JSON.stringify(collections[row.name]||[],null,2);
      const input=h('textarea',{rows:'8',maxlength:'65536',value:text,disabled,spellcheck:false,'aria-label':siteText`${row.label}の一覧データ`,onInput:e=>{state.drafts.collectionText=e.currentTarget.value;report(siteText('一覧データを編集中です。適用するまでプレビューは変わりません。'));}});
      area.replaceChildren(h('h4',{},[row.label]),h('p',{class:'hint'},[siteText`1つの { } が1行です。UIが参照する値: ${row.bindings.slice(0,32).join(', ')||siteText('状態JSONを参照')}。空の [] を適用するとこの一覧を空にします。`]),input,h('div',{class:'ui-data-actions'},[h('button',{type:'button',class:'btn',disabled,onClick:()=>{state.drafts.collectionText=JSON.stringify(createUiCollectionExample(row.name),null,2);input.value=state.drafts.collectionText;report(siteText('編集用の例を入力しました。適用するまで変わりません。'));}},[siteText('編集用の例を入力')]),h('button',{type:'button',class:'btn btn-primary',disabled,onClick:()=>{try{if(input.value.length>65536)fail(siteText('一覧データは65,536文字以下にしてください。'));submit({kind:'collection',collection:row.name,rows:JSON.parse(input.value)});}catch(error){report(siteText`適用できません: ${translateSiteMessage(error.message||error)}`);}}},[siteText('この一覧を適用')])]));
    }else if(state.mode==='text'){
      const field=catalog.textFields.find(row=>row.id===state.selected);if(!field)return;
      if(field.collection&&collectionByName(field.collection)?.nestedOnly){area.replaceChildren(h('p',{class:'hint'},[siteText('この入力欄は入れ子の一覧にあります。「一覧データ」で親の一覧を編集してください。')]));return;}
      if(!field.binding){area.replaceChildren(h('p',{class:'hint'},[siteText('この入力欄のデータの受け渡し先が未解決です。状態JSONとUI定義を確認してください。')]));return;}
      const index=state.drafts.textIndex??0,rows=field.collection?collections[field.collection]||[]:null;
      const value=state.drafts.textValue??(rows?rows[index]?.[field.binding]:values[field.binding])??'';
      const text=h('textarea',{rows:'4',maxlength:String(Math.min(field.maxLength??65536,65536)),value:String(value),disabled,spellcheck:false,'aria-label':siteText`${field.label}の文字列`,onInput:e=>{state.drafts.textValue=e.currentTarget.value;}});
      const elements=[h('h4',{},[field.label]),h('p',{class:'hint'},[field.maxLength===null?siteText('定義の文字数上限が未解決です。安全上限65,536文字で受け付けます。'):siteText`この定義の上限は${field.maxLength}文字です。絵文字などはブラウザ上で2文字分として数える場合があります。`])];
      if(rows)elements.push(input(h,siteText('行番号'),{type:'number',min:'1',max:String(Math.max(1,rows.length)),value:String(index+1),disabled,'aria-label':siteText('文字入力の行番号'),onChange:e=>{const n=Number(e.currentTarget.value);if(Number.isInteger(n)&&n>=1&&n<=rows.length){state.drafts={textIndex:n-1};drawForm();}else report(siteText('先に一覧データを作成するか、有効な行番号を選択してください。'));}}));
      elements.push(text,h('button',{class:'btn btn-primary',type:'button',disabled:disabled||Boolean(rows&&!rows.length),onClick:()=>submit({kind:'text',fieldId:field.id,index,value:text.value})},[siteText('この文字列を適用')]));area.replaceChildren(...elements);
    }
  }
  const pageInfo=h('span',{class:'hint'},[]),previous=h('button',{type:'button',class:'btn',disabled,onClick:()=>{state.page--;drawList();}},[siteText('前へ')]),next=h('button',{type:'button',class:'btn',disabled,onClick:()=>{state.page++;drawList();}},[siteText('次へ')]);
  const mode=h('select',{'aria-label':siteText('挿入するデータの種類'),value:state.mode,disabled,onChange:e=>{state.mode=e.currentTarget.value;state.selected=null;state.page=0;state.drafts={};drawList();drawForm();}},[['slots',siteText('アイテムを入れるスロット')],['text',siteText('文字入力欄')],['collections',siteText('一覧データ（ページ・候補・ボタンなど）')]].map(([value,label])=>h('option',{value},[label])));
  drawList();drawForm();
  const section=h('section',{'aria-label':siteText('UI固有のデータ挿入')},[h('p',{class:'hint'},[siteText('選択中のUI定義が使うデータを一覧にしています。挿入先を選び、値を入力して適用します。表示用のデータ設定なので、クラフトや交易の結果を自動計算する機能はありません。')]),mode,h('input',{type:'search',value:state.query,disabled,placeholder:siteText('挿入先の名前で検索'),'aria-label':siteText('挿入先を検索'),onInput:e=>{state.query=e.currentTarget.value;state.page=0;drawList();}}),list,h('div',{class:'runtime-input-pagination'},[previous,pageInfo,next]),area,catalog.truncated?h('p',{class:'hint text-warn'},[siteText('大きなUI定義のため一覧を制限しています。状態JSONも利用できます。')]):'',notice,h('button',{class:'btn',type:'button',disabled,onClick:onOpenJson},[siteText('状態JSONへ')])]);
  section.refreshUiData=()=>drawForm();return section;
}
