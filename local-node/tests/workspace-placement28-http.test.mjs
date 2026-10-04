import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { CliClient } from '../cli-client.mjs';
import { ResourceZipReader } from '../resource-zip.mjs';
import { makeZip,manifest } from './fixtures.mjs';
const at=(obj,p)=>p.split('/').slice(1).map(x=>x.replaceAll('~1','/').replaceAll('~0','~')).reduce((v,k)=>v?.[k],obj);
const documents={
 'manifest.json':manifest,'ui/_ui_defs.json':JSON.stringify({ui_defs:['ui/common.json','ui/main.json']}),
 'ui/common.json':JSON.stringify({namespace:'common',visual:{type:'panel',controls:[{icon:{type:'panel',size:[10,10]}}]},button:{type:'button',controls:[{'default@common.visual':{}},{'hover@common.visual':{}},{'pressed@common.visual':{}}]}}),
 'ui/main.json':JSON.stringify({namespace:'example',screen_a:{type:'screen',controls:[{'button@common.button':{}}]},screen_b:{type:'screen',controls:[{'button@common.button':{}}]}})
};

test('R28 HTTP: 個別配置→限定ZIP書出→全CRC→再取込で移動保持、兄弟と別画面不変', {timeout:30000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jsonui-placement28-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const input=path.join(dir,'input.mcpack'),original=makeZip(documents);await writeFile(input,original);
 const client=await CliClient.start();t.after(()=>client.close());const imported=await client.importPack(input);
 let ws=await client.request('/api/node/workspace-open',{payload:{sources:[{kind:'imported',id:imported.id}]}});assert(ws.ok);
 async function project(workspaceId,symbol){const cat=await client.request('/api/node/workspace-catalog',{payload:{workspaceId}});const record=cat.records.find(r=>r.qualifiedName===symbol);assert(record);const p=await client.request('/api/node/project',{payload:{catalogId:cat.nodeCatalogId,recordId:record.id}});assert(p.ok);return{record,p};}
 const before=await project(ws.workspaceId,'example.screen_a'),other=await project(ws.workspaceId,'example.screen_b');
 const cursor='/screen_a/controls/0/button/controls/0/default/controls/0/icon',source=before.p.nodeSources[cursor];assert(source);
 const operation={type:'move',scope:'screen',targetMode:'visual',path:source.path,sourceId:source.sourceKind,pointer:source.pointer,effectivePointer:cursor,delta:[11,7],screen:{path:before.record.filePath,sourceId:before.record.sourceKind,pointer:'/screen_a'}};
 const edited=await client.request('/api/node/workspace-edit',{payload:{workspaceId:ws.workspaceId,expectedRevision:ws.revision,operation}});assert(edited.ok,JSON.stringify(edited));assert.equal(edited.editPlan.requiresTemplateConsent,false);
 const after=await project(ws.workspaceId,'example.screen_a');assert.deepEqual(at(after.p.document,cursor).offset,[11,7]);assert.deepEqual((await project(ws.workspaceId,'example.screen_b')).p.document,other.p.document);
 assert.equal(at(after.p.document,cursor.replace('/0/default/','/1/hover/')).offset,undefined);
 const payload={workspaceId:ws.workspaceId,mode:'plan',selections:[{sourceId:after.record.sourceId,filePath:after.record.filePath,rawKey:after.record.rawKey}]};
 const plan=await client.request('/api/node/workspace-export',{payload});assert(plan.ok,JSON.stringify(plan));
 const zip=await client.request('/api/node/workspace-export',{payload:{...payload,mode:'zip'},binary:true});assert.equal(zip.readUInt32LE(0),0x04034b50);
 const output=path.join(dir,'edited.mcpack');await writeFile(output,zip);const reader=new ResourceZipReader();try{await reader.openFromFile({diskPath:output,name:'edited.mcpack'});await reader.listEntries();for(const key of reader.entryIndex.keys())await reader.bytes(key);}finally{await reader.close();}
 const reread=await client.importPack(output);const restored=await client.request('/api/node/workspace-open',{payload:{sources:[{kind:'imported',id:reread.id}]}});assert(restored.ok);
 const projectedAgain=await project(restored.workspaceId,'example.screen_a');assert.deepEqual(at(projectedAgain.p.document,cursor).offset,[11,7]);assert.equal(at(projectedAgain.p.document,cursor.replace('/0/default/','/1/hover/')).offset,undefined);
 assert.deepEqual(await readFile(input),original);
});
