/** R32: 追加先と単発追加の状態。DOM・原文・通信へ副作用を持たない。 */
export const ADD_TYPES32 = Object.freeze(['panel','label','image','button']);
const containers = new Set(['panel','input_panel','button','screen']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

export function insertionParent32({nodesById, selectedId, relation='inside'}) {
  const selected=nodesById?.[selectedId];
  if(!selected)fail('WORKSPACE_ADD_PARENT_REQUIRED','要素一覧から追加先を選択してください。別のUI定義へ自動追加しません。');
  if(!['inside','sibling'].includes(relation))fail('WORKSPACE_ADD_RELATION_INVALID','追加先の方式を選び直してください。');
  const parentId=selected.parentId||Object.keys(nodesById).find(id=>(nodesById[id]?.children||[]).some(child=>(typeof child==='string'?child:child?.id)===selectedId));
  const node=relation==='sibling'?nodesById[parentId]:selected;
  if(!node)fail('WORKSPACE_ADD_PARENT_REQUIRED','同じ階層の親を特定できません。通常の親パネルを明示選択してください。');
  if(['stack_panel','grid','factory'].includes(node.type))fail('WORKSPACE_ADD_FLOW_LAYOUT','この親は自動配置です。自由配置できる通常の親を選んでください。追加設定は保持しています。');
  if(!containers.has(node.type))fail('WORKSPACE_ADD_PARENT_REQUIRED','選択要素の中には追加できません。「同じ階層へ」を選ぶか、要素一覧で親パネルを選んでください。追加設定は保持しています。');
  return node;
}
export function setAddType32(state,type) {
  if(type!==''&&!ADD_TYPES32.includes(type))fail('WORKSPACE_ADD_TYPE_INVALID','追加する種類が未対応です。');
  state.addGeneration32=(state.addGeneration32||0)+1;
  state.addType=type;
  state.addStatus32={status:type?'ready':'cancelled',message:type?'追加先と位置を確認してください。':'追加を中止しました。'};
}
export function setInsertionRelation32(state,relation) {
  if(!['inside','sibling'].includes(relation))fail('WORKSPACE_ADD_RELATION_INVALID','追加先の方式が不正です。');
  state.insertionRelation32=relation;state.addGeneration32=(state.addGeneration32||0)+1;
}
export function beginAdd32(state) {
  if(!ADD_TYPES32.includes(state.addType)||state.addFlight32)return null;
  const token=Object.freeze({id:globalThis.crypto.randomUUID(),generation:state.addGeneration32||0,
    type:state.addType,relation:state.insertionRelation32||'inside',workspaceId:state.workspaceId,revision:state.revision});
  state.addFlight32=token;state.addStatus32={status:'planning',operationId:token.id,message:'追加計画を確認しています。'};
  return token;
}
export function currentAdd32(state,token) {
  return state.addFlight32===token&&(state.addGeneration32||0)===token.generation&&state.addType===token.type
    &&state.workspaceId===token.workspaceId&&state.revision===token.revision;
}
export function finishAdd32(state,token,{accepted=false,error=null}={}) {
  if(state.addFlight32!==token)return;
  const current=(state.addGeneration32||0)===token.generation&&state.addType===token.type
    &&state.workspaceId===token.workspaceId;
  state.addFlight32=null;
  if(!current)return; // 中止／新規設定を古い結果で上書きしない
  if(accepted){state.addType='';state.addGeneration32=(state.addGeneration32||0)+1;}
  state.addStatus32={status:accepted?'accepted':'rejected',operationId:token.id,
    message:accepted?'追加を受理しました。草稿を確認してJSON UIに確定してください。':String(error?.message||'追加は未受理です。追加先を確認して再試行してください。').slice(0,1024),
    code:error?.code||null,modeRetained:!accepted};
}
