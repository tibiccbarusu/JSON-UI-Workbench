import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { planWorkspaceExport } from '../workspace-export.mjs';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

const fixtureUi=process.env.JSONUI_VANILLA_FIXTURE_DIR;
const cases={skip:!fixtureUi&&'固定コミットの公式ui fixtureが必要'};
let loaded;
async function fixture(){
 if(!loaded)loaded=(async()=>{
  const root=dirname(resolve(fixtureUi));
  const paths=(await readdir(root,{recursive:true,withFileTypes:true})).filter(r=>r.isFile()).map(r=>join(r.parentPath??r.path,r.name).slice(root.length+1).replaceAll('\\','/'));
  const common=parseJsonc(await readFile(join(root,'ui/ui_common.json'),'utf8')).value;
  return {root,paths,common};
 })();return loaded;
}
async function options(mutate=()=>{}){
 const {root,paths,common}=await fixture();const doc=structuredClone(common);
 doc.__jsonui_export20=structuredClone(doc.screen_panel);
 // Keep the local control name while routing the existing screen through the
 // isolated definition. The raw caller's entire body is unchanged.
 const text=JSON.stringify(doc).replaceAll('@common.screen_panel"','@common.__jsonui_export20"');
 const changed=JSON.parse(text);mutate(changed);
 return {sources:[{id:'vanilla',kind:'vanilla',paths,overrides:{'ui/ui_common.json':JSON.stringify(changed)},
  readText:p=>readFile(join(root,p),'utf8'),readBytes:p=>readFile(join(root,p))}],
  selections:[{filePath:'ui/anvil_screen.json',definition:'anvil.anvil_screen'}]};
}
test('完全に同等なprivate callerは公式popup依存の証明を保つ',cases,async()=>{
 const result=await planWorkspaceExport(await options());
 assert(result.ok,JSON.stringify(result.plan.unresolved));
 assert(result.plan.engineFactoryProof.factory.equivalentCallers.some(r=>r.definition==='common.__jsonui_export20'));
 assert(result.plan.engineFactoryProof.branches.every(r=>r.considered&&r.used&&r.verified));
 assert(result.plan.externalUiDefinitions.every(r=>r.caller==='common.__jsonui_export20'));
});
test('private名が同じでもfactory内に新controlがあれば同等callerに認定しない',cases,async()=>{
 const result=await planWorkspaceExport(await options(doc=>{
  const f=doc.__jsonui_export20.controls.find(x=>x.popup_dialog_factory).popup_dialog_factory;
  f.control_ids.unproven='missing.runtime_ui';
 }));
 assert(!result.ok);assert(!result.plan.engineFactoryProof.factory.equivalentCallers.some(r=>r.definition==='common.__jsonui_export20'));
 assert(result.plan.unresolved.some(r=>r.reference==='missing.runtime_ui'));
});
test('factory外のbindingや変数も異なれば同等caller認定を拒否する',cases,async()=>{
 for(const mutate of [doc=>{doc.__jsonui_export20.$panel_prefix='custom';},doc=>{doc.__jsonui_export20.bindings=[{binding_name:'#unexpected'}];}]){
  const result=await planWorkspaceExport(await options(mutate));
  assert(!result.plan.engineFactoryProof.factory.equivalentCallers.some(r=>r.definition==='common.__jsonui_export20'));
  assert(!result.plan.engineFactoryProof.branches.some(r=>r.used));
 }
});
test('同じbodyでも基底参照が異なれば同等caller認定を拒否する',cases,async()=>{
 const result=await planWorkspaceExport(await options(doc=>{
  doc['__jsonui_export20@common.panel']=doc.__jsonui_export20;delete doc.__jsonui_export20;
 }));
 assert(!result.plan.engineFactoryProof.factory.equivalentCallers.some(r=>r.definition==='common.__jsonui_export20'));
 assert(!result.plan.engineFactoryProof.branches.some(r=>r.used));
});
