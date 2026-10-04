/** 公式UI＋提供通常パックの編集計画を実HTTPで照合する開発検査。 */
import { CliClient } from './cli-client.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
const [reference, importedPath, output] = process.argv.slice(2);
await mkdir(output, {recursive:true});
const report={started_at:new Date().toISOString(),status:'RUNNING',cases:[],limitations:['実HTTP・解釈結果の検査。Minecraft実機検証ではない。']};
const client=await CliClient.start();
try {
 const sources=[];
 for(const [kind,p] of [['vanilla',reference],['imported',importedPath]]) {const loaded=await client.importPack(p);sources.push({kind,id:loaded.id,rootPrefix:loaded.rootPrefix});}
 const workspace=await client.request('/api/node/workspace-open',{payload:{sources}});
 const catalog=await client.request('/api/node/workspace-catalog',{payload:{workspaceId:workspace.workspaceId}});
 const record=catalog.records.filter(r=>r.qualifiedName==='anvil.anvil_screen').sort((a,b)=>b.precedence-a.precedence)[0];
 const preview={variables:buildRepresentativeClassicResolverVariables({qualifiedName:record.qualifiedName}),representativeCollections:buildRepresentativeClassicCollections({qualifiedName:record.qualifiedName})};
 const projection=await client.request('/api/node/project',{payload:{catalogId:catalog.nodeCatalogId,recordId:record.id,...preview}});
 await writeFile(output+'/source-map.json',JSON.stringify(projection.nodeSources));
 report.projection={ok:projection.ok,nodes:Object.keys(projection.nodeSources||{}).length};
 const targets=[['close',s=>s.path==='ui/ui_common.json'&&s.pointer.includes('/close_button_panel/controls/0/close_button_image@')],['input',s=>s.path==='ui/ui_common.json'&&/^\/text_edit_box\/controls\/\d+\/default@\$text_background_default$/.test(s.pointer)],['slot',s=>s.path==='ui/invbg_player_inventory.json'&&s.pointer.includes('/container_cell_images/controls/0/cell_base@')]];
 for(const [name,predicate] of targets){
  const found=Object.entries(projection.nodeSources||{}).find(([,s])=>predicate(s));
  if(!found){report.cases.push({name,status:'TARGET_NOT_FOUND'});continue;}
  const [effectivePointer,source]=found;
  for(const scope of ['screen','shared']) {
   const operation={type:'planEdit',intendedType:'move',scope,targetMode:'interaction',delta:[13,7],path:source.path,sourceId:source.sourceId,pointer:source.pointer,effectivePointer,screen:{path:record.filePath,sourceId:record.sourceId,pointer:'/'+record.rawKey.replaceAll('~','~0').replaceAll('/','~1')},preview};
   const start=performance.now();
   const result=await client.request('/api/node/workspace-edit',{payload:{workspaceId:workspace.workspaceId,expectedRevision:workspace.revision,operation}});
   report.cases.push({name,scope,elapsed_ms:performance.now()-start,operation,result});
   console.log(JSON.stringify({name,scope,ok:result.ok,code:result.code,plan:result.editPlan}));
  }
 }
 report.status=report.cases.every(x=>x.result?.ok)?'PASS':'FAIL';
}catch(error){report.status='FAIL';report.error={message:error.message,code:error.code,stack:error.stack};throw error;}
finally{await client.close();report.finished_at=new Date().toISOString();await writeFile(output+'/probe.json',JSON.stringify(report,null,2));}
