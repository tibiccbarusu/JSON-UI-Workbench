/** R32: 削除範囲へ入る参照だけを、種類・配置・静的変数候補ごとに検査する。
 * プレビューのmock値を安全性の証明にしない。未知の関連参照は拒否し、原文は変更しない。
 */
import { editFail, pointerJoin, pointerParts } from './workspace-jsonc.mjs';
import { ReferenceEnvironment } from '../editor-core/src/engine/reference-environment.js';
import { expressionReferenceTokens, safeEvalExpression } from '../editor-core/src/bindings/bindings-evaluator.js';
export const DELETE_REFERENCE_POLICY32 = 'placement-typed-static-candidates-32.1';
const MAX_WORK = 250000, MAX_VALUES = 32, MAX_DEPTH = 32;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const at = (v,p) => pointerParts(p).reduce((o,k) => o?.[k],v);
const within = (p,root) => p === root || p.startsWith(root + '/');
const normalize = k => String(k || '').replace(/^#/u, '');
const STATE = /^(?:(?:default|hover|pressed|locked|checked|unchecked|disabled|focused)(?:_hover|_locked|_pressed)*_control)$/u;
const FOCUS = /^focus_(?:change|override)_(?:left|right|up|down)$/u;
const OWNED = new Set(['scroll_content','scroll_view_port','scrollbar_box','scrollbar_track','scroll_box_and_track_panel',
  'slider_button','slider_background','slider_progress','slider_hover','slider_hover_button','slider_step','slider_step_hover']);
const CONTROL = new Set(['source_control_name','target_control_name','control_name']);
const cache = new WeakMap();
const result = (values = [], unknown = false, reason = '') => ({ values: new Set(values), unknown, reason });
function merge(a,b) { const values=new Set([...a.values,...b.values]); if(values.size>MAX_VALUES)return result([],true,'candidate-limit'); return {values,unknown:a.unknown||b.unknown,reason:a.reason||b.reason}; }
function parent(p,sources) {const a=pointerParts(p);while(a.length){a.pop();const q=pointerJoin(a);if(sources[q])return q;}return null;}
function referenceKind(key) {return STATE.test(key)||OWNED.has(key)?'owned-control':FOCUS.test(key)?'focus-target':CONTROL.has(key)?'control-target':null;}

function makeIndex(projection,context) {
  let work=0;
  const tick=()=>{if(++work>MAX_WORK)editFail('EDIT_STRUCTURE_REFERENCE_LIMIT','削除参照の解析上限に達しました。未変更のまま停止しました。','_request',{policy:DELETE_REFERENCE_POLICY32,work,limit:MAX_WORK});};
  function valuesOf(value,env,seen=new Set(),depth=0,literalHash=false) {
    tick(); if(depth>MAX_DEPTH)return result([],true,'alias-depth');
    if(typeof value!=='string') return ['boolean','number'].includes(typeof value)?result([value]):result([],true,'non-scalar');
    if(/^\$[\w:@.\-]+$/u.test(value)) {
      if(seen.has(value))return result([],true,'variable-cycle');
      const candidates=env.get(value);if(!candidates)return result([],true,'variable-missing');
      let out=result([],candidates.unknown,candidates.reason); const next=new Set(seen);next.add(value);
      for(const item of candidates.values)out=merge(out,valuesOf(item,env,next,depth+1,literalHash));return out;
    }
    if(value.startsWith('#'))return literalHash?result([value]):result([],true,'runtime-binding');
    if(value.trim().startsWith('(')) {
      if(value.length>4096)return result([],true,'expression-limit');
      const tokens=expressionReferenceTokens(value); if(tokens.some(t=>t.startsWith('#')))return result([],true,'runtime-expression');
      let combinations=[Object.create(null)], unknown=false;
      for(const token of tokens) {
        const candidates=valuesOf(token,env,seen,depth+1);unknown ||= candidates.unknown;
        if(!candidates.values.size)return result([],true,candidates.reason||'expression-unresolved');
        if(combinations.length*candidates.values.size>MAX_VALUES)return result([],true,'expression-candidate-limit');
        combinations=combinations.flatMap(c=>[...candidates.values].map(v=>({...c,[token]:v})));
      }
      let out=result([],unknown,unknown?'expression-unresolved':'');
      for(const mockData of combinations) {
        const answer=safeEvalExpression(value,{mockData,props:{},allowMockFallback:false});
        out=merge(out,answer===undefined?result([],true,'expression-unsupported'):result([answer]));
      }return out;
    }
    return result([value]);
  }
  function declare(source,inherited) {
    const changes=new Map();
    const env={get:k=>changes.has(k)?changes.get(k):inherited.get(k),has:k=>changes.has(k)||inherited.has(k),set:(k,v)=>changes.set(k,v)};
    const apply=(declaration,optional=false)=>{
      for(const defaults of [true,false])for(const [k,v]of Object.entries(declaration||{})) {
        tick();if(!k.startsWith('$')||k==='$schema')continue;
        const [name,modifier='']=k.split('|');if((modifier==='default')!==defaults)continue;
        if(defaults&&env.has(name))continue;
        if(v===name&&env.has(name))continue; // callerの同名変数を自己循環にしない
        const candidate=result([v]);env.set(name,optional?merge(env.get(name)||result([],true,'conditional-only'),candidate):candidate);
      }
    };
    apply(source);
    if(Array.isArray(source?.variables))for(const branch of source.variables) {
      tick();if(!object(branch))continue;
      const condition=branch.requires===undefined||branch.requires===null||branch.requires===''?result([true]):valuesOf(branch.requires,env);
      const canTrue=condition.unknown||[...condition.values].some(v=>v===true||v===1);
      const onlyTrue=!condition.unknown&&condition.values.size>0&&[...condition.values].every(v=>v===true||v===1);
      if(canTrue)apply(branch,!onlyTrue);
    }
    return changes.size?new ReferenceEnvironment(inherited,changes):inherited;
  }
  const globalBase=declare(context.catalog.globalVariables||{},new Map());
  // この経路の対象はClassic。任意のpreview変数は安全判定に流用しない。
  const globals=new ReferenceEnvironment(globalBase,new Map([['$desktop_screen',result([true])],['$pocket_screen',result([false])]]));
  const rows=new Map(),names=new Map();
  for(const [p,source]of Object.entries(projection.nodeSources).sort(([a],[b])=>pointerParts(a).length-pointerParts(b).length)) {
    tick();const value=at(projection.document,p);if(!object(value))continue;
    const parentPath=parent(p,projection.nodeSources), ancestor=rows.get(parentPath);
    const env=declare(value,ancestor?.env||globals);
    const layers=[];
    for(const origin of source.inheritance||[source]) {
      tick();const record=context.catalog.recordsById[origin.recordId];
      const raw=record?at(record.value,pointerJoin(pointerParts(origin.pointer).slice(1))):null;
      if(object(raw))layers.push(raw);
    }
    if(!layers.length)editFail('EDIT_STRUCTURE_REFERENCE_UNKNOWN','削除参照を確認する原文の出典がありません。',p,{policy:DELETE_REFERENCE_POLICY32});
    const raw=Object.assign(Object.create(null),...layers), name=pointerParts(p).at(-1)?.split('@')[0];
    const row={p,name,parent:parentPath,value,raw,env,children:[],source,layers};rows.set(p,row);
    if(ancestor)ancestor.children.push(row);
    if(!names.has(name))names.set(name,[]);names.get(name).push(row);
  }
  function property(row,key) {
    // rawの式を利用することで、代表プレビューで消えた条件候補も検査する。
    const v=Object.hasOwn(row.raw,key)?row.raw[key]:row.value[key];
    if(v===undefined)return result([]);
    return valuesOf(v,row.env);
  }
  function bindingRows(row) {
    if(row.bindingCache)return row.bindingCache;
    const effective=Array.isArray(row.value.bindings)?row.value.bindings:[];
    const raw=Array.isArray(row.raw.bindings)?row.raw.bindings:[];
    // 同じ長さでもmodificationsで参照先が変わり得る。未置換と実効配列の両方を検査する。
    const unique=new Map();for(const binding of [...raw,...effective]){tick();unique.set(JSON.stringify(binding),binding);}
    row.bindingCache=[...unique.values()];return row.bindingCache;
  }
  function bindingActive(b,row) {
    if(!object(b))return false;
    const ignored=valuesOf(b.ignored??false,row.env);
    if(!ignored.unknown&&ignored.values.size===1&&ignored.values.has(true))return false;
    const kind=valuesOf(b.binding_type??'global',row.env);
    if(!kind.unknown&&kind.values.size===1&&kind.values.has('none'))return false;
    const source=valuesOf(b.binding_name??b.source_property_name??'',row.env);
    return source.unknown||[...source.values].some(v=>v!=='');
  }
  function writes(row,key) {
    return bindingRows(row).some(b=>{
      tick();if(!bindingActive(b,row))return false;
      const prop=valuesOf(b.target_property_name??b.binding_name_override??b.binding_name??'',row.env,new Set(),0,true);
      return prop.unknown||[...prop.values].some(v=>normalize(v)===key);
    });
  }
  for(const row of rows.values()) {
    row.focus=property(row,'focus_identifier');
    if(writes(row,'focus_identifier'))row.focus=merge(row.focus,result([],true,'runtime-focus-identifier'));
  }
  const buildWork=work;
  return {rows,names,valuesOf,property,bindingRows,bindingActive,writes,tick,getWork:()=>work,resetWork:()=>{work=buildWork;}};
}

/** 読み取り専用の検査。対象そのものの削除／機能本体の選択は呼出し側で確定する。 */
export function checkDeleteReferences32(projection,target,context) {
  let indexed=cache.get(projection);
  if(!indexed||indexed.context!==context) { indexed={context,index:makeIndex(projection,context)};cache.set(projection,indexed); }
  indexed.index.resetWork();
  const {rows,names,valuesOf,property,bindingRows,bindingActive,writes,tick,getWork}=indexed.index;
  // 未描画の継承を「空の要素」とみなさない。固定で不参加と確認できる枝だけ除外する。
  const definitelyInactive=row=>{
    for(let current=row;current;current=rows.get(current.parent)) {
      for(const [key,disabled] of [['ignored',true],['visible',false]]) {
        const p=property(current,key);
        if(!p.unknown&&p.values.size===1&&p.values.has(disabled)&&!writes(current,key))return true;
      }
    }return false;
  };
  let inactiveUnexpanded=0;
  for(const row of rows.values()) {
    if(typeof row.value.type==='string'&&!/^[#$()]/u.test(row.value.type))continue;
    if(!pointerParts(row.p).at(-1)?.includes('@') && typeof row.raw.type!=='string')continue;
    if(definitelyInactive(row)){inactiveUnexpanded++;continue;}
    editFail('EDIT_STRUCTURE_REFERENCE_UNKNOWN','条件により有効になり得る未展開の継承があります。削除対象への参照を調べ切れないため原文は変更しません。',row.p,
      {sourcePath:row.source.path,sourcePointer:row.source.pointer,sourceProperty:'controls',referenceKind:'unexpanded-template',candidateTarget:target.effectivePointer,
        reason:'potentially-active-unexpanded-template',policy:DELETE_REFERENCE_POLICY32});
  }
  const deleted=[...rows.values()].filter(r=>within(r.p,target.effectivePointer));
  const targetFocus=deleted.reduce((a,r)=>merge(a,r.focus),result([]));
  const hasDeletedFocus=targetFocus.unknown||[...targetFocus.values].some(v=>v!=='');
  let references=0,unrelated=0;
  const fail=(row,key,kind,candidates,reason,unknown=false)=>editFail(
    unknown?'EDIT_STRUCTURE_REFERENCE_UNKNOWN':'EDIT_STRUCTURE_REFERENCED',
    unknown?'削除範囲へ届き得る参照を確定できません。参照元と変数を確認してください。原文は変更していません。'
      :'残る要素が削除対象を参照しています。参照元を整理するか、削除する範囲を選び直してください。',
    row.p,{sourceProperty:key,referenceKind:kind,sourcePath:row.source.path,sourcePointer:row.source.pointer,
      candidateTarget:target.effectivePointer,reason,policy:DELETE_REFERENCE_POLICY32,
      candidates:candidates.slice(0,16).map(r=>r.p)});
  function resolveControl(row,name,sibling=false,owned=false) {
    tick();if(typeof name!=='string'||!name)return [];
    if(name.startsWith('/')||name.includes('/')) {
      const base=name.startsWith('/')?'':row.p;
      const exact=rows.get(base+(name.startsWith('/')?name:'/'+name));
      if(exact)return [exact];
      // 未対応のpath表現は短い名前へ縮めて断定せず、対象との関係を保守的に扱う。
      return null;
    }
    const list=(sibling?rows.get(row.parent)?.children:row.children)||[];
    const direct=list.filter(r=>{tick();return r.name===name;});if(direct.length)return direct;
    if(owned)return (names.get(name)||[]).filter(r=>{tick();return r.p!==row.p&&within(r.p,row.p);});
    for(let ancestor=row;ancestor;ancestor=rows.get(ancestor.parent))if(ancestor.name===name)return [ancestor];
    return names.get(name)||[];
  }
  function inspect(row,key,candidate,kind,sibling=false) {
    references++;tick();
    if(kind==='focus-target') {
      if(!hasDeletedFocus){unrelated++;return;}
      if(candidate.unknown)fail(row,key,kind,deleted,'runtime-or-unresolved-focus-target',true);
      for(const name of candidate.values)if(name && name!=='FOCUS_OVERRIDE_STOP') {
        if(targetFocus.values.has(name))fail(row,key,kind,deleted,'focus-target-enters-deletion');
        if(targetFocus.unknown)fail(row,key,kind,deleted,'deleted-focus-identity-unknown',true);
      }return;
    }
    const owned=kind==='owned-control';
    if(owned&&!within(target.effectivePointer,row.p)){unrelated++;return;}
    if(candidate.unknown)fail(row,key,kind,deleted,'runtime-or-unresolved-control-target',true);
    for(const name of candidate.values) {
      if(!name)continue;
      const found=resolveControl(row,name,sibling,owned);
      if(found===null)fail(row,key,kind,deleted,'unsupported-control-path',true);
      if(found.some(r=>{tick();return within(r.p,target.effectivePointer);}))fail(row,key,kind,found,'control-target-enters-deletion');
    }
  }
  for(const row of rows.values()) {
    tick();if(within(row.p,target.effectivePointer))continue; // 内部参照は一緒に消える
    const keys=new Set([...Object.keys(row.raw),...Object.keys(row.value)]);
    for(const key of keys) {
      const kind=referenceKind(key);if(!kind)continue;
      let candidates=property(row,key);
      if(writes(row,key))candidates=merge(candidates,result([],true,'runtime-property-write'));
      inspect(row,key,candidates,kind);
    }
    for(const [i,b]of bindingRows(row).entries()) {
      if(!bindingActive(b,row))continue;
      for(const key of ['source_control_name','target_control_name'])if(b[key]!==undefined) {
        const siblingValues=valuesOf(b.resolve_sibling_scope??false,row.env);
        const sibling=siblingValues.values.has(true);
        const values=valuesOf(b[key],row.env);
        inspect(row,`bindings/${i}/${key}`,values,'control-target',sibling);
        if(siblingValues.unknown||(sibling&&siblingValues.values.has(false)))inspect(row,`bindings/${i}/${key}`,values,'control-target',!sibling);
      }
      // focus_change_*等がbindingのみで定義される場合も確認する。
      const written=valuesOf(b.target_property_name??b.binding_name_override??b.binding_name??'',row.env,new Set(),0,true);
      if(written.unknown)fail(row,`bindings/${i}/target_property_name`,'unknown-property-write',deleted,'binding-property-name-unresolved',true);
      for(const value of written.values) {
        const key=normalize(value),kind=referenceKind(key);
        if(kind&&!keys.has(key))inspect(row,`bindings/${i}/${key}`,result([],true,'runtime-property-write'),kind);
      }
    }
  }
  return {policy:DELETE_REFERENCE_POLICY32,checkedNodes:rows.size,deletedNodes:deleted.length,references,
    unrelatedReferences:unrelated,inactiveUnexpanded,work:getWork(),limit:MAX_WORK,coverage:'bounded-authored-placement-candidates',deviceValidation:'NOT_RUN'};
}
