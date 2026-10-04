/** R31: 画面限定の通常配置だけを構造編集する。候補状態は検査完了まで公開しない。 */
import { checkDeleteReferences32, DELETE_REFERENCE_POLICY32 } from './workspace-delete-references32.mjs';
import { editWorkspace, workspaceRevision } from './workspace-edit.mjs';
import { editFail, pointerParts, pointerJoin } from './workspace-jsonc.mjs';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const at = (v,p) => pointerParts(p).reduce((v,k)=>v?.[k],v);
const clone = v => JSON.parse(JSON.stringify(v));
const within = (p,root) => p === root || p.startsWith(root + '/');
function children(value) {
  const result=[];
  if (Array.isArray(value?.controls)) { for(const entry of value.controls) {if(!object(entry))return null; result.push(...Object.entries(entry));} }
  else if (object(value?.controls)) result.push(...Object.entries(value.controls));
  else if (value?.controls !== undefined) return null;
  return result;
}
function checkStructure(projection, target, intended) {
  if(target.source.generated) editFail('EDIT_STRUCTURE_GENERATED', '自動生成された1枠の追加・削除には対応していません。元の生成設定は変更しません。');
  for (const [p,source] of Object.entries(projection.nodeSources)) if(within(target.effectivePointer,p)) {
    const v=at(projection.document,p);
    if(source.generated || v?.factory || ['factory','grid'].includes(v?.type)) editFail('EDIT_STRUCTURE_GENERATED','生成グリッド・factoryの配下は、画面限定の構造編集に未対応です。');
  }
  if(intended==='add' && !['panel','input_panel','stack_panel','button','screen'].includes(target.value.type)) editFail('EDIT_STRUCTURE_PARENT','追加先には通常の親パネルまたはボタンを選択してください。');
  if(intended==='delete') {
    if(pointerParts(target.effectivePointer).length < 3) editFail('EDIT_STRUCTURE_ROOT_DELETE','画面定義そのものは「このUIだけ」の削除対象にできません。');
    let count=0;
    for(const [p,source]of Object.entries(projection.nodeSources)) if(within(p,target.effectivePointer)) {
      if(++count>4096) editFail('EDIT_STRUCTURE_LIMIT','削除する配置の範囲が上限を超えました。');
      const v=at(projection.document,p);
      if(source.generated || v?.factory || ['factory','grid'].includes(v?.type)) editFail('EDIT_STRUCTURE_GENERATED','生成要素を含む配置の削除は未対応です。');
    }
  }
}

function expectedAfter(projection,target,operation,intended) {
  const expected=clone(projection.document),parts=pointerParts(target.effectivePointer);
  if(intended==='add') {
    const parent=at(expected,target.effectivePointer),entries=children(parent);
    if(entries===null)editFail('EDIT_DYNAMIC_CONTROLS','動的controlsには追加できません。');
    if(entries.some(([k])=>k.split('@')[0]===operation.name))editFail('EDIT_NAME_CONFLICT','同じ配置に同名の子要素があります。');
    if(parent.controls===undefined)parent.controls=[];
    if(Array.isArray(parent.controls))parent.controls.push({[operation.name]:clone(operation.value)});
    else if(object(parent.controls))parent.controls[operation.name]=clone(operation.value);
    else editFail('EDIT_DYNAMIC_CONTROLS','追加先のcontrols形式を確認できません。');
  }else{
    const parent=at(expected,pointerJoin(parts.slice(0,-1)));
    if(!object(parent)||!Object.hasOwn(parent,parts.at(-1)))editFail('EDIT_STRUCTURE_POINTER','削除する配置を確認できません。');
    // Effective array entries are one-name objects; preserve siblings if a noncanonical entry contains more.
    const container=at(expected,pointerJoin(parts.slice(0,-2)));
    if(Array.isArray(container)) {
      if(Object.keys(parent).length!==1)editFail('EDIT_STRUCTURE_SHAPE','複数名を持つcontrols項目の削除は未対応です。');
      container.splice(Number(parts.at(-2)),1);
    }else delete parent[parts.at(-1)];
  }
  return expected;
}
export async function editScopedStructure31({documents,documentSources,revision,operation,intended,projection,target,plan,next,reproject,verify,context}) {
  if(operation.scope!=='screen')editFail('EDIT_STRUCTURE_SCOPE','範囲付きの追加・削除はscreen指定を使用してください。共有編集は従来の原文編集を使用します。');
  checkStructure(projection,target,intended);
  if(plan.affectedInstances!==1||plan.requiresTemplateConsent)editFail('EDIT_STRUCTURE_SHARED','この配置だけの変更を一意に分離できません。共有テンプレート全体へ自動適用しません。');
  let referenceAnalysis32 = null;
  if(intended==='add') {
    if(typeof operation.name!=='string'||!/^[_\p{L}][\p{L}\p{N}_-]{0,127}$/u.test(operation.name)||!object(operation.value)||!['panel','label','image','button'].includes(operation.value.type))editFail('EDIT_ADD_INVALID','追加には通常のpanel・label・image・buttonと固定の新しい名前を指定してください。');
    const controls = operation.value.controls;
    // 挿入ボタンの表示用labelだけを許可する。動的な子/継承/バインディングは許可しない。
    const staticCaption = operation.value.type === 'button' && Array.isArray(controls) && controls.length === 1
      && object(controls[0]) && Object.keys(controls[0]).length === 1 && Object.keys(controls[0])[0] === 'caption'
      && object(controls[0].caption) && controls[0].caption.type === 'label'
      && Object.keys(controls[0].caption).every(key => ['type','text','anchor_from','anchor_to','size','color'].includes(key));
    if(operation.index!==undefined||Object.keys(operation.value).some(k=>k.startsWith('$')||['modifications','factory','grid_item_template'].includes(k))
      || controls !== undefined && !staticCaption)editFail('EDIT_STRUCTURE_ADD_COMPLEX','このUIだけの追加は通常要素とボタンの静的ラベルに対応します。動的な子の挿入は未対応です。');
  } else referenceAnalysis32 = checkDeleteReferences32(projection,target,context);
  const isolatedDocuments={...documents,...next.changes};
  let isolated=await reproject(isolatedDocuments,next.screen);
  verify(projection,isolated.projection,target,null,undefined,plan);
  isolated = null; // The isolation proof is complete; release its catalog/tree before raw validation.
  const raw={type:intended,path:next.target.path,pointer:next.target.pointer,
    ...(intended==='add'?{parentPointer:next.target.pointer,name:operation.name,value:operation.value}:{cascade:true})};
  let deletion;
  if(intended==='delete') {
    const check=editWorkspace({documents:isolatedDocuments,documentSources,operation:{...raw,type:'planDelete'}});
    if(!check.ok)return check;
    deletion=check.deletePlan;
    if(deletion.removals.some(n=>n.path!==raw.path||!within(n.pointer,raw.pointer)))editFail('EDIT_STRUCTURE_CASCADE','削除が選択配置の外へ広がるため反映しません。');
  }
  let edited=editWorkspace({documents:isolatedDocuments,documentSources,operation:raw,expectedRevision:workspaceRevision(isolatedDocuments,documentSources)});
  if(!edited.ok)return edited;
  const editedDocuments = edited.documents;
  edited = null; // The final authored transaction will produce its own public node list.
  const after=await reproject(editedDocuments,next.screen);
  verify({...projection,document:expectedAfter(projection,target,operation,intended)},after.projection,target,null,undefined,plan);
  plan.structure={operation:intended,selectionOnly:operation.deletionUnit!=='functional',deletionUnit:operation.deletionUnit||'selected',
    notice:intended==='delete'?(operation.deletionUnit==='functional'?'確認された機能本体と配下を削除します。その操作も失われます。':'選択した部品だけを削除します。ボタン本体や別状態は残る場合があります。子に依存する親サイズや入力範囲も変わり得るため、草稿を確認してください。'):'追加は通常の配置に限定します。',generatedSupported:false,referenceCheck:DELETE_REFERENCE_POLICY32,referenceAnalysis:referenceAnalysis32,deviceValidation:'NOT_RUN'};
  if(operation.type==='planEdit'||operation.type==='planDelete')return {ok:true,revision,beforeRevision:revision,changes:[],editPlan:plan,deletePlan:deletion,previewAllowed:true,diagnostics:[]};
  if(intended==='delete'&&operation.cascade!==true)editFail('EDIT_CASCADE_REQUIRED','子要素を含む削除の確認が必要です。');
  const texts=Object.fromEntries(Object.entries(editedDocuments).filter(([p,t])=>documents[p]!==t));
  const result=editWorkspace({documents,documentSources,expectedRevision:revision,operation:{type:'replaceTexts',texts},authoredCopies:next.authoredCopies||[]});
  return {...result,editPlan:plan,...(deletion?{deletePlan:deletion}:{}),afterContext31:result.ok?after.context:undefined};
}
