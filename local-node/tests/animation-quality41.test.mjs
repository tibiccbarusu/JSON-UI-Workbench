import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {compilePreviewAnimations,samplePreviewAnimations} from '../../editor-core/src/engine/preview-animation.js';
import {summarizeAnimationQuality} from '../../editor-core/src/engine/animation-quality41.js';
import {buildPreviewQuality} from '../cli-quality38.mjs';
import {runCli} from '../cli.mjs';
import {CliClient} from '../cli-client.mjs';
import {renderFramePng} from '../frame-raster13.mjs';
import {makeZip,manifest} from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';
const origins={anchor_from:'top_left',anchor_to:'top_left'};
const animation={anim_type:'alpha',from:0,to:1,duration:1};
const simple=()=>({namespace:'test',root:{id:'root',props:{},children:[{id:'child',props:{anims:['@test.a']},children:[]}]}});
const compile=(model=simple(),options={})=>compilePreviewAnimations(model,{definitions:{'test.a':animation},...options});
const quality=plan=>summarizeAnimationQuality({observation:plan.observation,timeSeconds:.5});
test('quality keeps native/time boundaries and legacy missing evidence explicit',()=>{
 assert.equal(summarizeAnimationQuality(null).status,'not_evaluated');
 assert.equal(summarizeAnimationQuality({trackCount:0}).status,'not_evaluated');
 const q=quality(compile());assert.equal(q.status,'passed');assert.equal(q.native_parity_verified,false);
 assert.equal(q.native_events_executed,false);assert.equal(q.clock,'absolute_preview_seconds');
 assert.equal(buildPreviewQuality({frame:{animation:{observation:compile().observation,timeSeconds:.5}}}).animation.status,'passed');
});
test('unknown binding visibility is retained despite normalized true and inactive geometry',()=>{
 const model=simple();model.root.props.visible=true;
 const plan=compile(model,{bindingDiagnostics:[{status:'unresolved',nodeId:'root',targetProperty:'visible'}]});
 assert.equal(quality(plan).status,'unknown');assert(plan.diagnostics.some(d=>d.nodeId==='child'&&d.ref==='test.a'&&d.code==='ANIMATION_VISIBILITY_UNKNOWN'));
 model.root.props.ignored=true;
 assert.equal(quality(compile(model,{bindingDiagnostics:[{status:'unresolved',nodeId:'root',targetProperty:'visible'}]})).status,'passed','definite ignored dominates independently unknown visible');
});
test('incomplete visibility evaluator evidence prevents animation-only strict pass',()=>{
 assert.equal(quality(compile(undefined,{bindingObservationCaptureComplete:false})).status,'unknown');
});
test('inactive state, unmatched event, positive next cycle and zero cycle differ',()=>{
 const model=simple();model.root.props.visible=false;
 assert.equal(quality(compile(model,{definitions:{'test.a':{...animation,end_event:'x'}}})).status,'passed');
 const mismatch=compile(undefined,{event:'other',definitions:{'test.a':{...animation,play_event:'start',end_event:'x'}}});
 assert.equal(quality(mismatch).inactive_count,1);assert.equal(quality(mismatch).status,'passed');
 assert.equal(quality(compile(undefined,{definitions:{'test.a':{...animation,next:'@test.a'}}})).status,'passed');
 assert.equal(quality(compile(undefined,{definitions:{'test.a':{...animation,duration:0,next:'@test.a'}}})).status,'unknown');
});
test('falsy malformed event fields are unknown while explicit no-op values remain supported',()=>{
 for(const patch of [{start_event:0},{reset_event:false},{end_event:null},{destroy_at_end:0}])assert.equal(quality(compile(undefined,{definitions:{'test.a':{...animation,...patch}}})).status,'unknown');
 for(const patch of [{start_event:''},{reset_event:''},{end_event:''},{destroy_at_end:false}])assert.equal(quality(compile(undefined,{definitions:{'test.a':{...animation,...patch}}})).status,'passed');
});
test('evidence bounded by actual UTF-8 bytes with long CJK identities and no false pass on truncation',()=>{
 const model=simple();model.root.children=Array.from({length:700},(_,i)=>({id:'界'.repeat(250)+i,props:{anims:['@test.a']},children:[]}));
 const plan=compile(model);assert(Buffer.byteLength(JSON.stringify(plan.observation))<=65536);
 assert(plan.observation.evidence.length<256);assert.equal(quality(plan).status,'unknown');
 assert.equal(plan.observation.reference_count,700);assert.equal(plan.observation.evidence.length+plan.observation.omitted_evidence_count,700);
});
test('many inactive references do not consume the visible track compilation budget',()=>{
 const model=simple();const active=model.root.children[0];
 model.root.children=[{id:'hidden',props:{visible:false},children:Array.from({length:3000},(_,i)=>({id:'hidden'+i,props:{anims:['@test.a']},children:[]}))},active];
 const plan=compile(model);assert.equal(plan.tracks.length,1);assert.equal(samplePreviewAnimations(plan,.5).propsById.child.alpha,.5);
 assert.equal(plan.observation.reference_count,3001);assert.equal(plan.observation.inactive_count,3000);assert.equal(quality(plan).status,'unknown');
});
test('malformed observation counters cannot convert an unknown row to a passing quality',()=>{
 const plan=compile(undefined,{definitions:{'test.a':{...animation,end_event:'x'}}});
 const forged=structuredClone(plan.observation);forged.supported_count=1;forged.unknown_count=0;
 assert.equal(summarizeAnimationQuality({observation:forged}).status,'failed');
});
test('absolute seek and instance-free sampling remains independent of previous sampling order',()=>{
 const plan=compile();for(const t of [8,.8,.1,.5,0,.5])samplePreviewAnimations(plan,t);
 assert.equal(samplePreviewAnimations(plan,.5).propsById.child.alpha,.5);
 assert.equal(quality(plan).native_clock_verified,false);
});
async function pack(t){
 const directory=await mkdtemp(path.join(tmpdir(),'jsonui-animation41-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const document={namespace:'anim41',good: {...animation},bad:{...animation,end_event:'unimplemented'},
 screen:{type:'screen',size:[64,48],...origins,controls:[{image:{type:'image',size:['default','default'],texture:'textures/ui/p',...origins,anims:['@anim41.good']}}]},
 unsupported:{type:'screen',size:[64,48],...origins,anims:['@anim41.bad']},
 hidden:{type:'screen',size:[64,48],...origins,visible:false,anims:['@anim41.bad']}};
 const archive=path.join(directory,'pack.zip');
 await writeFile(archive,makeZip({'manifest.json':manifest,'ui/_ui_defs.json':JSON.stringify({ui_defs:['ui/test.json']}),'ui/test.json':JSON.stringify(document),
 'textures/ui/p.png':pngjs.PNG.sync.write({width:2,height:2,data:Buffer.alloc(16,255)}),'textures/ui/p.json':'{"base_size":[31,17]}'}));
 return {directory,archive};
}
test('CLI strict-animation explicitly rejects unsupported JSON/SVG/PNG before file write, including allow-partial', {timeout:60000},async t=>{
 const {directory,archive}=await pack(t),session=path.join(directory,'session.json');
 await runCli(['import','--session',session,'--pack',archive]);
 const args=definition=>['preview','--session',session,'--file','ui/test.json','--definition',definition];
 const legacy=await runCli(args('anim41.unsupported'));assert.equal(legacy.ok,true);assert.equal(legacy.result.quality.animation.status,'unknown');
 for(const format of ['json','svg','png']){
   const output=path.join(directory,'blocked.'+format);
   for(const extra of format==='png'?[[],['--allow-partial']]:[[]])await assert.rejects(runCli([...args('anim41.unsupported'),'--strict-animation','--format',format,'--out',output,...extra]),error=>{
     assert.equal(error.code,'CLI_ANIMATION_GATE_FAILED');assert.equal(error.context.quality.animation.status,'unknown');
     assert.equal(error.context.stage_diagnostics.animation.enforcement,'explicit_strict_frame_animation');return true;
   });
   await assert.rejects(readFile(output),{code:'ENOENT'});
 }
 const supported=await runCli([...args('anim41.hidden'),'--strict-animation']);assert.equal(supported.result.quality.animation.status,'passed');
 await assert.rejects(runCli(['validate','--session',session,'--strict-animation']),error=>error.code.startsWith('CLI_'));
});
test('raster final resource relayout retains final animation evidence on successful and failed outputs', {timeout:60000},async t=>{
 const {archive}=await pack(t),client=await CliClient.start();t.after(()=>client.close());
 const imported=await client.importPack(archive),sources=[{id:imported.id,kind:'vanilla',rootPrefix:imported.rootPrefix}];
 const catalog=await client.request('/api/node/catalog',{payload:{sources}});
 const record=catalog.records.find(row=>row.qualifiedName==='anim41.screen');
 const projection=await client.request('/api/node/project',{payload:{catalogId:catalog.nodeCatalogId,recordId:record.id}});
 const frameRequest={projectionId:projection.nodeProjectionId,recordId:record.id,filePath:record.filePath,preset:{width:64,height:48},generation:0,visibilityMode:'safe',animationTime:.5};
 const request=client.request.bind(client);
 for(const unavailable of [false,true]){
  const frame=await request('/api/node/frame',{payload:frameRequest});assert.equal(frame.animation.quality.status,'passed');let reflows=0;
  client.request=async(route,options)=>{const value=await request(route,options);if(route==='/api/node/frame'){reflows++;value.animation.observation.observation_capture_complete=false;value.animation.observation.reason_codes=['ANIMATION_EVIDENCE_CAPTURE_INCOMPLETE'];if(unavailable)value.layout.warnings=['controlled final raster warning'];}return value;};
  const raster=await renderFramePng({client,sources,projection,frame,frameRequest,width:64,height:48});
  assert(reflows>0);assert.equal(raster.animation_quality.status,'unknown');assert.equal(raster.final_animation.observation.observation_capture_complete,false);
  assert.equal(raster.ok,!unavailable);assert.equal(buildPreviewQuality({projection,frame,frameRequest,raster}).animation.status,'unknown');
 }
});
