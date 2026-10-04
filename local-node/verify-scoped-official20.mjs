/** 実パック・実HTTPによる画面範囲、操作本体、書出し再読込の有限検査。 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CliClient } from './cli-client.mjs';
import { productDigest } from './verify-stability13.mjs';
import { renderFramePng } from './frame-raster13.mjs';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { buildWorkspacePreviewSourceMap } from '../editor-core/src/ui/workspace-editor.js';
import { hitTestUiInteraction } from '../editor-core/src/preview/ui-interaction-target.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';

const [reference, importedPath, output] = process.argv.slice(2);
if (!reference || !importedPath || !output) throw new Error('参照ZIP、通常パック、未使用の証拠ディレクトリを指定してください。');
await mkdir(output, {recursive:false});
const hash = b => createHash('sha256').update(b).digest('hex');
const save = (name, value) => writeFile(path.join(output,name), Buffer.isBuffer(value) ? value : JSON.stringify(value,null,2)+'\n', {flag:'wx'});
const report={schema:'jsonui-scoped-official20',started_at:new Date().toISOString(),status:'RUNNING',source_start:await productDigest(),inputs:[],cases:[],limitations:[
 '固定コミット公式UIと検証済み素材、提供vanillaの部分回復フォントを混合した検査入力。完全なvanilla原本ではない。',
 'Minecraft実機、Windows、実ブラウザ操作は未実施。製品の実HTTP・Node Canvas・hit関数を使用する。',
 'PNGはallowPartial=true。completeとdiagnosticsを保存し、実機画素一致を主張しない。',
 '選択書出しは金床の依存閉包である。他画面不変の検査は元パックを積んだ編集中workspaceに対して行う。'
]};
for(const p of [reference,importedPath]){const b=await readFile(p);report.inputs.push({name:path.basename(p),bytes:b.length,sha256:hash(b)});}
const cases=[
 {name:'close',type:'button',predicate:s=>s.path==='ui/ui_common.json'&&s.pointer.includes('/close_button_panel/controls/0/close_button_image@')},
 {name:'input',type:'edit_box',predicate:s=>s.path==='ui/ui_common.json'&&/^\/text_edit_box\/controls\/\d+\/default@\$text_background_default$/.test(s.pointer)},
 {name:'slot',type:'input_panel',predicate:s=>s.path==='ui/invbg_player_inventory.json'&&s.pointer.includes('/container_cell_images/controls/0/cell_base@')}
];
const otherNames=['chest.small_chest_screen','chest.large_chest_screen','crafting.inventory_screen'];
for(const target of cases) for(const scope of ['screen','shared']) {
 const item={name:target.name,scope,started_at:new Date().toISOString(),checks:[],status:'RUNNING'};
 report.cases.push(item);let client;
 const check=(name,detail={})=>{item.checks.push({name,status:'PASS',...detail});console.log(JSON.stringify({case:target.name,scope,name,...detail}));};
 try {
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(new Error('シナリオ上限600秒')),600000);
  try {
   client=await CliClient.start({signal:abort.signal});
   const sources=[];
   for(const [kind,p] of [['vanilla',reference],['imported',importedPath]]){const loaded=await client.importPack(p);sources.push({kind,id:loaded.id,rootPrefix:loaded.rootPrefix});}
   let ws=await client.request('/api/node/workspace-open',{payload:{sources}});
   const initialRevision=ws.revision;
   async function project(qualifiedName, stack=null) {
    const catalog=stack ? await client.request('/api/node/catalog',{payload:{sources:stack}}) : await client.request('/api/node/workspace-catalog',{payload:{workspaceId:ws.workspaceId}});
    const record=catalog.records.filter(r=>r.qualifiedName===qualifiedName).sort((a,b)=>b.precedence-a.precedence)[0];assert(record,qualifiedName);
    const preview={variables:buildRepresentativeClassicResolverVariables({qualifiedName}),representativeCollections:buildRepresentativeClassicCollections({qualifiedName})};
    const projection=await client.request('/api/node/project',{payload:{catalogId:catalog.nodeCatalogId,recordId:record.id,...preview}});assert(projection.ok,JSON.stringify(projection.error));
    return {record,preview,projection};
   }
   async function framed(state) {
    const frameRequest={projectionId:state.projection.nodeProjectionId,filePath:state.record.filePath,generation:1,preset:{width:480,height:270},animationTime:1,visibilityMode:'safe'};
    const frame=await client.request('/api/node/frame',{payload:frameRequest});assert(Array.isArray(frame.layout?.boxes));
    const model=buildUiScreenModelFromJson(state.projection.document,{filePath:state.record.filePath});
    const tree=buildTreeFromUiScreenModel(model);
    const mapping=buildWorkspacePreviewSourceMap({uiModel:model,meta:{resolution:state.projection}});
    return {...state,frameRequest,frame,model,tree,mapping};
   }
   const otherBefore={};for(const name of otherNames)otherBefore[name]=hash(JSON.stringify((await project(name)).projection.document));
   const before=await framed(await project('anvil.anvil_screen'));
   const found=Object.entries(before.projection.nodeSources).find(([,s])=>target.predicate(s));assert(found,'対象原文が見つからない');
   const [effectivePointer,source]=found;
   const operation={type:'planEdit',intendedType:'move',scope,targetMode:'interaction',delta:[13,7],path:source.path,sourceId:source.sourceId,pointer:source.pointer,effectivePointer,
    screen:{path:before.record.filePath,sourceId:before.record.sourceId,pointer:'/'+before.record.rawKey.replaceAll('~','~0').replaceAll('/','~1')},preview:before.preview};
   const planned=await client.request('/api/node/workspace-edit',{payload:{workspaceId:ws.workspaceId,expectedRevision:ws.revision,operation}});await save(target.name+'-'+scope+'-plan.json',planned);
   assert(planned.ok,JSON.stringify(planned.error));const plan=planned.editPlan;assert.equal(plan.target.type,target.type);assert(plan.promoted);
   const nodeId=(state,pointer)=>[...state.mapping].find(([,s])=>s.previewPointer===pointer)?.[0];
   const ownerId=nodeId(before,plan.target.effectivePointer);assert(ownerId,'操作本体の描画IDがない');
   const beforeBox=before.frame.layout.boxes.find(b=>b.id===ownerId);assert(beforeBox,'操作本体が配置されていない');
   check('画像の選択から操作本体へ昇格',{owner_type:plan.target.type,owner_id:ownerId,affected_instances:plan.affectedInstances});
   if(plan.requiresTemplateConsent){
    const refused=await client.request('/api/node/workspace-edit',{payload:{workspaceId:ws.workspaceId,expectedRevision:ws.revision,operation:{...operation,type:'move'}}});
    assert.equal(refused.ok,false);assert.equal(refused.revision,ws.revision);operation.generatedScope='template';
    check('生成セルのテンプレート同意なし変更を拒否',{code:refused.code});
   }
   const edited=await client.request('/api/node/workspace-edit',{payload:{workspaceId:ws.workspaceId,expectedRevision:ws.revision,operation:{...operation,type:'move'}}});assert(edited.ok,JSON.stringify(edited.error));ws=edited;
   const after=await framed(await project('anvil.anvil_screen'));
   const afterOwnerId=nodeId(after,edited.editPlan.committedTarget.effectivePointer);assert(afterOwnerId);
   const afterBox=after.frame.layout.boxes.find(b=>b.id===afterOwnerId);assert(afterBox);
   const near=(a,b)=>assert(Math.abs(a-b)<0.001,`${a} != ${b}`);
   near(afterBox.x-beforeBox.x,13);near(afterBox.y-beforeBox.y,7);near(afterBox.w,beforeBox.w);near(afterBox.h,beforeBox.h);
   check('操作本体の配置が移動量と一致',{before:beforeBox,after:afterBox});
   const visualId=nodeId(before,effectivePointer),afterVisualId=nodeId(after,effectivePointer);
   const vb=before.frame.layout.boxes.find(b=>b.id===visualId),va=after.frame.layout.boxes.find(b=>b.id===afterVisualId);
   assert(vb&&va,'選択した表示要素が配置されていない');near(va.x-vb.x,13);near(va.y-vb.y,7);
   const beforeContext={model:before.model,nodesById:before.tree.nodesById,boxes:before.frame.layout.boxes,propsById:{...before.frame.basePropsById,...before.frame.propsById}};
   const afterContext={model:after.model,nodesById:after.tree.nodesById,boxes:after.frame.layout.boxes,propsById:{...after.frame.basePropsById,...after.frame.propsById}};
   const oldHit=hitTestUiInteraction(beforeContext,beforeBox.x+beforeBox.w/2,beforeBox.y+beforeBox.h/2);
   const newHit=hitTestUiInteraction(afterContext,afterBox.x+afterBox.w/2,afterBox.y+afterBox.h/2);
   item.hit_observation={before:oldHit?.id||null,after:newHit?.id||null};
   if(oldHit && (oldHit.id===ownerId||oldHit.id.startsWith(ownerId+'/'))) {
    assert(newHit && (newHit.id===afterOwnerId||newHit.id.startsWith(afterOwnerId+'/')),'新位置のhitが操作本体の枝へ届かない');
    check('製品hit関数が移動後の操作領域へ到達',{before:oldHit.id,after:newHit.id});
   } else item.hit_observation.status='INCONCLUSIVE_REPRESENTATIVE_STATE';
   check('選択した画像と操作本体が同じ差分だけ移動');
   const otherAfter={};for(const name of otherNames)otherAfter[name]=hash(JSON.stringify((await project(name)).projection.document));
   if(scope==='screen'){assert.deepEqual(otherAfter,otherBefore);check('小チェスト・大チェスト・インベントリの投影を完全保持',{sha256:otherAfter});}
   else check('共有編集の他画面変化を記録',{changed_screens:otherNames.filter(n=>otherBefore[n]!==otherAfter[n]),before:otherBefore,after:otherAfter});
   // Other catalog requests may evict a retained projection; re-project before raster/export.
   const editedState=await framed(await project('anvil.anvil_screen'));
   const raster=await renderFramePng({client,sources:ws.sources,projection:editedState.projection,frame:editedState.frame,frameRequest:editedState.frameRequest,width:1920,height:1080,uiScale:4,locale:'ja_JP',timeSeconds:1,allowPartial:true});
   assert(raster.ok,JSON.stringify(raster.diagnostics));await save(target.name+'-'+scope+'-after.png',raster.png);
   item.render={sha256:hash(raster.png),complete:raster.complete,diagnostics:raster.diagnostics};
   const exportPayload={workspaceId:ws.workspaceId,expectedRevision:ws.revision,selections:[{filePath:'ui/anvil_screen.json',definition:'anvil.anvil_screen'}]};
   const exportPlan=await client.request('/api/node/workspace-export',{payload:{...exportPayload,mode:'plan'}});await save(target.name+'-'+scope+'-export-plan.json',exportPlan);assert(exportPlan.ok,JSON.stringify(exportPlan.plan?.unresolved));
   const zip=await client.request('/api/node/workspace-export',{payload:{...exportPayload,mode:'zip'},binary:true});await save(target.name+'-'+scope+'-selected.mcpack',zip);
   const undone=await client.request('/api/node/workspace-undo',{payload:{workspaceId:ws.workspaceId,expectedRevision:ws.revision}});assert(undone.ok);assert.equal(undone.revision,initialRevision);ws=undone;
   const undo=await project('anvil.anvil_screen');assert.deepEqual(undo.projection.document,before.projection.document);check('一回のundoで元revisionと金床投影を完全復元');
   // 新規パック読込は既存workspaceを終了する製品契約。undoを先に検証する。
   const restored=await client.importPack(path.join(output,target.name+'-'+scope+'-selected.mcpack'));
   const cleanSources=[{...sources[0],overrides:{}},{kind:'imported',id:restored.id,rootPrefix:restored.rootPrefix}];
   const roundtrip=await framed(await project('anvil.anvil_screen',cleanSources));
   assert.deepEqual(roundtrip.projection.document,editedState.projection.document);
   assert.deepEqual(roundtrip.frame.layout.boxes,editedState.frame.layout.boxes);
   const restoredRaster=await renderFramePng({client,sources:cleanSources,projection:roundtrip.projection,frame:roundtrip.frame,frameRequest:roundtrip.frameRequest,width:1920,height:1080,uiScale:4,locale:'ja_JP',timeSeconds:1,allowPartial:true});assert(restoredRaster.ok);assert.equal(hash(restoredRaster.png),hash(raster.png));
   check('書出しと未編集vanillaへの再読込で投影・配置・PNGを完全保持',{zip_bytes:zip.length,zip_sha256:hash(zip),png_sha256:hash(raster.png),render_complete:raster.complete});
   item.status='PASS';
  }finally{clearTimeout(timer);}
 }catch(error){item.status='FAIL';item.error={code:error.code||error.name,message:error.message,stack:error.stack};console.error(JSON.stringify({case:target.name,scope,error:item.error}));}
 finally{if(client)await client.close();item.finished_at=new Date().toISOString();await save(target.name+'-'+scope+'-result.json',item);}
}
report.source_end=await productDigest();report.source_state=report.source_start.sha256===report.source_end.sha256?'STABLE':'TRANSITION';
report.status=report.cases.every(x=>x.status==='PASS')?'PASS':'FAIL';report.finished_at=new Date().toISOString();await save('report.json',report);
if(report.status!=='PASS')process.exitCode=1;
