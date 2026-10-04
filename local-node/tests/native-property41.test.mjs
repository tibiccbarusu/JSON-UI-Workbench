import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliClient } from '../cli-client.mjs';
import { renderFramePng, loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';

const backend=loadRasterBackend();
test('native-invalid inherited label property survives projection but blocks strict raster; draft ignores its effect', {skip:!backend,timeout:60000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'native-property41-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const font=backend.createCanvas(128,128),ctx=font.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(8,32,5,7);
 const template={namespace:'native_template',caption:{type:'label',text:'A',localize:false,font_type:'default',size:[24,24],anchor_from:'top_left',anchor_to:'top_left',vertical_alignment:'center',color:[1,1,1]}};
 const screen={namespace:'native_fixture',screen:{type:'screen',size:[32,32],controls:[{'caption@native_template.caption':{}}]}};
 const source=path.join(dir,'input.mcpack');await writeFile(source,makeZip({'manifest.json':manifest,'ui/_ui_defs.json':JSON.stringify({ui_defs:['ui/template.json','ui/screen.json']}),'ui/template.json':JSON.stringify(template),'ui/screen.json':JSON.stringify(screen),'font/default8.png':font.toBuffer('image/png')}));
 const client=await CliClient.start();t.after(()=>client.close());
 const loaded=await client.importPack(source),sources=[{id:loaded.id,kind:'imported',rootPrefix:loaded.rootPrefix}];
 const cat=await client.request('/api/node/catalog',{payload:{sources}}),record=cat.records.find(r=>r.qualifiedName==='native_fixture.screen');
 const projection=await client.request('/api/node/project',{payload:{catalogId:cat.nodeCatalogId,recordId:record.id}});
 const frameRequest={projectionId:projection.nodeProjectionId,recordId:record.id,filePath:record.filePath,preset:{width:32,height:32},visibilityMode:'safe',generation:0};
 const frame=await client.request('/api/node/frame',{payload:frameRequest});
 assert(frame.layout.warnings.some(w=>w.includes('LAYOUT_NATIVE_PROPERTY_UNSUPPORTED:')&&w.endsWith(':vertical_alignment')));
 const args={client,sources,projection,frameRequest,frame,width:32,height:32,includeDrawEvidence:true};
 const strict=await renderFramePng(args);assert.equal(strict.ok,false);assert.equal(strict.code,'RASTER_INCOMPLETE');assert.equal(strict.png,undefined);
 const draft=await renderFramePng({...args,allowPartial:true});assert.equal(draft.ok,true);assert.equal(draft.draft,true);assert.equal(draft.preview_complete,false);
 assert(draft.diagnostics.some(d=>d.code==='RASTER_LAYOUT_WARNING'&&d.message.includes('vertical_alignment')));
 const text=draft.draw_evidence.nodes.find(n=>n.text)?.text;assert.equal(text.value,'A');assert.equal(text.vertical_alignment,'top');
});

test('native property warnings are bounded and do not mutate ignored or future declarations',()=>{
 const nodesById={root:{id:'root',type:'panel',props:{size:[100,100]},children:[]}};
 for(let i=0;i<300;i++){const id='label'+i;nodesById.root.children.push(id);nodesById[id]={id,type:'label',props:{size:[1,1],vertical_alignment:'center',future_property:'retain'},children:[]};}
 const file={rootId:'root',nodesById},before=JSON.stringify(file),result=computeLayoutBoxesForFile(file,{width:100,height:100});
 assert.equal(result.warnings.filter(w=>w.startsWith('LAYOUT_NATIVE_PROPERTY_UNSUPPORTED:')).length,256);
 assert.equal(result.warnings.filter(w=>w==='LAYOUT_NATIVE_PROPERTY_DIAGNOSTIC_LIMIT:256').length,1);
 assert.equal(JSON.stringify(file),before);
});
