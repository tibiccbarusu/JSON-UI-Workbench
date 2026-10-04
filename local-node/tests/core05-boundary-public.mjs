/** 使用: node local-node/tests/core05-boundary-public.mjs <resource_pack> <report.json> */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const implementation=process.env.JSONUI_CORE_ROOT?pathToFileURL(`${path.resolve(process.env.JSONUI_CORE_ROOT)}/`):new URL('../../',import.meta.url);
const {loadPreviewStatePack,resolvePreviewStateScenario}=await import(new URL('scripts/verify-preview-state.mjs',implementation));
if(!process.argv[2]||!process.argv[3])throw new Error('resource_pack と report.json を指定してください');
const started=performance.now(),packRoot=path.resolve(process.argv[2]),catalog=await loadPreviewStatePack(packRoot),observations=[],checks=[];
const check=(name,actual,expected)=>checks.push({name,status:JSON.stringify(actual)===JSON.stringify(expected)?'PASS':'FAIL',actual,expected});
const item={id:'minecraft:diamond',count:2};
for(const [label,input,wantRows,wantVisible] of [
  ['typed 1品目',{brewing:{outputs:[item]}},3,3],
  ['typed 空配列',{brewing:{outputs:[]}},3,3],
  ['raw 空配列優先',{brewing:{outputs:[item]},collectionData:{brewing_result_items:[]}},0,0],
]) {
  const scenario=resolvePreviewStateScenario(catalog,input);
  const frames=Object.entries(scenario.propsById).filter(([id,p])=>id.includes('/brewing_output_slots/')&&id.endsWith('/item_cell/bg/cell_image')&&p.texture==='textures/ui/cell_image').map(([id,p])=>({id,texture:p.texture,visible:p.visible}));
  const visible=frames.filter(p=>p.visible===true).length;
  check(`${label}:3枚の原本slot背景control`,frames.length,3);
  check(`${label}:正規化collection数`,scenario.state.collectionData.brewing_result_items.length,wantRows);
  check(`${label}:背景visible`,visible,wantVisible);
  observations.push({label,nodeCount:scenario.uiModel.stats.nodeCount,frames});
}
for(const [label,input] of [
  ['inventory 全固定collection空配列',{inventory:{main:[],hotbar:[],armor:[],offhand:[]}}],
  ['inventory 各collection1品目',{inventory:{main:[item],hotbar:[item],armor:[item],offhand:[item]}}],
]) {
  const scenario=resolvePreviewStateScenario(catalog,input);
  const frames=Object.entries(scenario.propsById).filter(([id,p])=>id.endsWith('/item_cell/bg/cell_image')&&p.texture==='textures/ui/cell_image').map(([id,p])=>({id,visible:p.visible}));
  const counts=Object.fromEntries(['inventory_items','hotbar_items','armor_items','offhand_items'].map(name=>[name,scenario.state.collectionData[name].length]));
  check(`${label}:固定collection数`,counts,{inventory_items:27,hotbar_items:9,armor_items:4,offhand_items:1});
  check(`${label}:全slot背景が描画可能`,frames.length>0&&frames.every(frame=>frame.visible===true),true);
  observations.push({label,nodeCount:scenario.uiModel.stats.nodeCount,counts,frameCount:frames.length,unresolvedFrames:frames.filter(frame=>frame.visible!==true)});
}
const sources={};
for(const name of ['brewing_stand_screen.json','inventory_screen.json','ui_common.json','chest_screen.json','redstone_screen.json'])sources[`ui/${name}`]=createHash('sha256').update(await fs.readFile(path.join(packRoot,'ui',name))).digest('hex');
const report={schema:'core05-boundary-public/v1',finishedAt:new Date().toISOString(),elapsedMs:performance.now()-started,status:checks.every(c=>c.status==='PASS')?'PASS':'FAIL',sourceSha256:sources,checks,observations,limitations:['公開原本から解決したcontrolのeffective visibleまでを検証。Canvas画素・実機pixel一致の検証ではない。','raw collectionDataの不足行はユーザー明示指定を尊重し補完しない。','空瓶/燃料のoverlayやitem-lock等、今回対象外のゲーム由来bindingは未解決が残り得る。']};
await fs.writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:checks.length,failed:checks.filter(c=>c.status==='FAIL'),elapsedMs:report.elapsedMs}));
if(report.status!=='PASS')process.exitCode=1;
