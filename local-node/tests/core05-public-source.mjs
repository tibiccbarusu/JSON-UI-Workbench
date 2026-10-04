/** 使用: node local-node/tests/core05-public-source.mjs <公開resource_pack> <report.json> */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const implementation = process.env.JSONUI_CORE_ROOT ? pathToFileURL(`${path.resolve(process.env.JSONUI_CORE_ROOT)}/`) : new URL('../../',import.meta.url);
const moduleOf = name => import(new URL(name,implementation));
const { buildUiCatalog } = await moduleOf('editor-core/src/engine/ui-catalog.js');
const { parseJsonc } = await moduleOf('editor-core/src/json/jsonc.js');
const { resolveEffectiveUi } = await moduleOf('editor-core/src/engine/effective-ui-resolver.js');
const { computeImageSourceRect } = await moduleOf('editor-core/src/preview/canvas-preview.js');
const { buildUiScreenModelFromJson } = await moduleOf('editor-core/src/model/ui-screen-model.js');
const { collectPreviewAnimationDefinitions, compilePreviewAnimations, samplePreviewAnimations } = await moduleOf('editor-core/src/engine/preview-animation.js');
const sourceRoot = path.resolve(process.argv[2]), output = process.argv[3];
const filePaths=[],directories=['ui'];
while(directories.length){ const directory=directories.pop();for(const item of await fs.readdir(path.join(sourceRoot,directory),{withFileTypes:true})){
 const name=`${directory}/${item.name}`;if(item.isDirectory())directories.push(name);else if(item.isFile()&&name.endsWith('.json'))filePaths.push(name);
 if(filePaths.length+directories.length>4096)throw new Error('SOURCE_FILE_BUDGET');
}}
const catalog=await buildUiCatalog({sources:[{id:'public',kind:'vanilla',precedence:0,filePaths,readText:p=>fs.readFile(path.join(sourceRoot,p),'utf8')}],parseJsonc});
const definitions=collectPreviewAnimationDefinitions(catalog);
const report={schema:'jsonui-core05-public-source-v1',commit:'736072450c26a7c67f07b1661f29d9a5ebaa14b1',time:new Date().toISOString(),node:process.version,implementation:implementation.href,ui_files:filePaths.length,scenarios:[],limitations:['可視性のゲーム状態は発火せず、原文controlのanimation参照を直接評価する。','PNGの寸法とUV境界検査であり実機の再生時刻・イベント寿命・ピクセル一致を認定しない。']};
for(const [name,texture,uvSize,times] of [
 ['auto_save_info.auto_save','auto_save',[18,30],[0,.1,.2,.8,.9]],
 ['resource_packs.progress_loading_bars','loading_bar',[64,8],[0,.1,.5,.9,1.8]],
 ['play.realms_stories_icon_animated','realmsStoriesIconAnimated',[22,22],[0,.25,3,4]],
 ['confirm_delete_account.image_panel','tnt_animated',[427,320],[0,1,2]],
]){
 const selected=catalog.recordsById[catalog.symbols[name]?.winnerId];
 if(!selected)throw new Error(`SOURCE_DEFINITION_MISSING:${name}`);
 const r=resolveEffectiveUi({catalog,recordId:selected.id});if(!r.ok)throw new Error(`RESOLVE_FAILED:${name}`);
 const ui=buildUiScreenModelFromJson(r.document,{filePath:selected.filePath});const plan=compilePreviewAnimations(ui,definitions);
 const imageBytes=await fs.readFile(path.join(sourceRoot,`textures/ui/${texture}.png`));
 if(imageBytes.subarray(1,4).toString()!=='PNG')throw new Error('SOURCE_PNG_REQUIRED');
 const width=imageBytes.readUInt32BE(16),height=imageBytes.readUInt32BE(20);
 const uiBytes=await fs.readFile(path.join(sourceRoot,selected.filePath));
 const row={name,source_file:selected.filePath,source_sha256:createHash('sha256').update(uiBytes).digest('hex'),texture:`textures/ui/${texture}.png`,sha256:createHash('sha256').update(imageBytes).digest('hex'),width,height,uv_size:uvSize,tracks:plan.tracks.length,diagnostics:plan.diagnostics,samples:[]};
 for(const time of times){const sample=samplePreviewAnimations(plan,time+.00001);for(const[id,props]of Object.entries(sample.changedPropsById))if(Array.isArray(props.uv)){
  const uv=props.uv;const within=uv[0]>=0&&uv[1]>=0&&uv[0]+uvSize[0]<=width&&uv[1]+uvSize[1]<=height;
  const sourceRect=computeImageSourceRect({width,height},uv,uvSize,'valid');
  row.samples.push({time,id,uv,within_png:within,source_rect:sourceRect});
 }}
 row.status=row.tracks>0&&row.samples.length===times.length&&row.samples.every(x=>x.within_png)?'PASS':'FAIL';report.scenarios.push(row);
}
report.status=report.scenarios.every(x=>x.status==='PASS')?'PASS':'FAIL';
if(output)await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({status:report.status,ui_files:report.ui_files,scenarios:report.scenarios.map(({name,status,tracks,samples})=>({name,status,tracks,samples}))})+'\n');
if(report.status!=='PASS')process.exitCode=1;
