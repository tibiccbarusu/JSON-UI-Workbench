/** 使用: node scripts/verify-preview-state.mjs <resource_packディレクトリ> <report.json> */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { normalizePreviewState, createPreviewStatePreset } from '../editor-core/src/engine/preview-state.js';
import { collectPreviewAnimationDefinitions, compilePreviewAnimations, samplePreviewAnimations } from '../editor-core/src/engine/preview-animation.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { buildRepresentativeClassicCollections, buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollectionData, buildRepresentativeClassicBindingMockData } from '../editor-core/src/engine/representative-classic-runtime.js';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { evaluateBindingsForUiModel } from '../editor-core/src/bindings/bindings-evaluator.js';
import { computeLayoutBoxesForFile } from '../editor-core/src/preview/canvas-preview.js';
const CLASSIC = Object.freeze({'#is_survival_layout':true,'#is_creative_layout':false,'#is_recipe_book_layout':false,'#is_left_tab_inventory':true,'#using_touch':false,'#using_gamepad':false,'#gamepad_helper_visible':false,'#is_mouse':true});
export async function loadPreviewStatePack(packRoot) {
  const files = [], directories = ['ui'];
  while (directories.length) {
    const directory = directories.pop();
    for (const entry of await fs.readdir(path.join(packRoot, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) directories.push(relative);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(relative);
      if (files.length + directories.length > 4096) throw new Error('REAL_STATE_UI_FILE_BUDGET');
    }
  }
  files.sort();
  return buildUiCatalog({sources:[{id:'state-real-pack',kind:'vanilla',precedence:0,filePaths:files,readText:(file)=>fs.readFile(path.join(packRoot,file),'utf8')}],parseJsonc});
}
/** root描画検証からもimport可能。実packのtree/effective propsを返す。 */
export function resolvePreviewStateScenario(catalog, input, qualifiedName = null) {
  const state = normalizePreviewState(input), name = qualifiedName || state.recommendedDefinition;
  const variables = buildRepresentativeClassicResolverVariables({qualifiedName:name,userVariables:state.mockData});
  const representativeCollections = buildRepresentativeClassicCollections({qualifiedName:name,collectionData:state.collectionData});
  const resolution = resolveEffectiveUi({catalog,recordId:catalog.symbols[name]?.winnerId,variables,representativeCollections});
  if (!resolution.ok) throw new Error(`REAL_STATE_RESOLVE_FAILED:${name}:${resolution.error?.code}`);
  const uiModel = buildUiScreenModelFromJson(resolution.document,{filePath:`state:${name}`});
  const result = evaluateBindingsForUiModel(uiModel,{mockData:{...CLASSIC,...buildRepresentativeClassicBindingMockData({qualifiedName:name,userMockData:state.mockData}),...state.mockData},collectionData:buildRepresentativeClassicCollectionData(representativeCollections,state.collectionData)});
  const file = {...buildTreeFromUiScreenModel(uiModel),uiModel};
  return {state,name,resolution,uiModel,file,propsById:result.propsById,bindingWarnings:result.warnings};
}
async function verify(packRoot, output) {
  const started = performance.now(), catalog = await loadPreviewStatePack(packRoot), observations = [];
  function check(name, expected, actual) { assert.deepEqual(actual,expected,name); observations.push({name,status:'PASS',expected,actual}); }
  const definitions = collectPreviewAnimationDefinitions(catalog);
  check('実pack animation定義を抽出',true,Object.keys(definitions.definitions).length>0);
  for(const kind of ['furnace','brewing']) {
    const scenario=resolvePreviewStateScenario(catalog,createPreviewStatePreset(kind));
    const matches=Object.entries(scenario.propsById).filter(([id,props])=>kind==='furnace'?props.texture==='textures/ui/arrow_active':props.texture==='textures/ui/brewing_arrow_full');
    check(`${kind}:原packの進捗画像が存在`,true,matches.length>0);
    check(`${kind}:原pack bindingへ0.5を反映`,true,matches.some(([,props])=>props.clip_ratio===0.5));
    const plan=compilePreviewAnimations(scenario.uiModel,{...definitions,basePropsById:scenario.propsById});
    check(`${kind}:実定義のanimation track`,true,plan.tracks.length>0);
    const original=JSON.stringify(scenario.propsById), before=performance.now();
    for(let i=0;i<120;i++)samplePreviewAnimations(plan,i/30,{basePropsById:scenario.propsById});
    observations.push({name:`${kind}:120時刻sampling`,status:'PASS',trackCount:plan.tracks.length,nodeCount:scenario.uiModel.stats.nodeCount,milliseconds:performance.now()-before,scope:'sampleのみ。Canvas/DOM性能ではない'});
    check(`${kind}:sampleが原propsを変更しない`,original,JSON.stringify(scenario.propsById));
    // Avoid placing the full props snapshot into a report.
    observations[observations.length-1].expected='原本SHA一致';observations[observations.length-1].actual=createHash('sha256').update(original).digest('hex');
  }
  const trade=resolvePreviewStateScenario(catalog,createPreviewStatePreset('trade'));
  const itemRows=Object.entries(trade.propsById).filter(([id,p])=>id.includes('/trade_toggle_stack_panel/')&&id.includes('/trade_item_1/')&&p.renderer==='inventory_item_renderer');
  for(const [index, expected] of [[0,388*65536],[1,265*65536]]) {
    const rows=itemRows.filter(([id])=>id.includes(`/trade_toggle_stack_panel/preview_factory_${index}/`));
    check(`交易行${index}:native itemrenderer存在`,true,rows.length>0);
    check(`交易行${index}:品目がその行に一致`,true,rows.every(([,p])=>(p.item_id_aux ?? p.__jsonui_preview_collection_details?.item_id_aux)===expected));
  }
  const heights=[];
  for(const count of [0,2,20]) {
    const input={form:{type:'action',title:'検証用タイトル',body:'指定本文',buttons:Array.from({length:count},(_,i)=>({text:`ボタン${i+1}`}))}};
    const form=resolvePreviewStateScenario(catalog,input);
    check(`Form${count}:実factory生成件数`,count,form.resolution.stats.materializedFactoryItems);
    const props=Object.values(form.propsById);
    check(`Form${count}:タイトル`,true,props.some((p)=>p.text==='検証用タイトル'));
    check(`Form${count}:本文`,true,props.some((p)=>p.text==='指定本文'));
    if(count)check(`Form${count}:最後のbutton文字`,true,props.some((p)=>p.text===`ボタン${count}`));
    const layout=computeLayoutBoxesForFile(form.file,{width:1280,height:720},{propsByIdOverride:form.propsById,uiScale:4});
    const content=layout.boxes.find((box)=>box.id.endsWith('/long_form_dynamic_buttons_panel'));
    heights.push({count,height:content?.h ?? null});
  }
  check('Form2→20:動的内容高さ増加',true,heights[2].height>heights[1].height);
  observations.push({name:'Form内容高さ実測',status:'PASS',heights,scope:'layout計算。スクロール操作/実機外枠高さの一致は別検証'});
  const sources={};
  for(const file of ['furnace_screen.json','brewing_stand_screen.json','trade_2_screen.json','server_form.json','ui_common.json'])sources[`ui/${file}`]=createHash('sha256').update(await fs.readFile(path.join(packRoot,'ui',file))).digest('hex');
  const report={schema:'preview-state-real/v1',finishedAt:new Date().toISOString(),status:'PASS',checks:observations.length,elapsedMs:performance.now()-started,definitions:Object.keys(definitions.definitions).length,sourceSha256:sources,observations,limitations:['ScriptAPIの実行、任意イベントfactory、Minecraft全画面pixel一致は未検証','数値状態入力は静止状態。ゲーム時間進行による炉/醸造状態の自動遷移は再現しない']};
  await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks,elapsedMs:report.elapsedMs,heights}));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try { if(!process.argv[2]||!process.argv[3])throw new Error('使用法: node scripts/verify-preview-state.mjs <resource_pack> <report.json>'); await verify(path.resolve(process.argv[2]),path.resolve(process.argv[3])); }
  catch(error){console.error(error.stack);process.exitCode=1;}
}
