import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const implementation=process.env.JSONUI_CORE_ROOT?pathToFileURL(`${resolve(process.env.JSONUI_CORE_ROOT)}/`):new URL('../../',import.meta.url);
const moduleOf=(name)=>import(new URL(name,implementation));
const {buildUiCatalog}=await moduleOf('editor-core/src/engine/ui-catalog.js');
const {parseJsonc}=await moduleOf('editor-core/src/json/jsonc.js');
const {collectPreviewAnimationDefinitions,compilePreviewAnimations,samplePreviewAnimations}=await moduleOf('editor-core/src/engine/preview-animation.js');
const model={namespace:'play',root:{id:'root',props:{anims:['@play.anim_realms_stories_icon'],uv_size:[22,22]},children:[]}};
const def={anim_type:'flip_book',initial_uv:[0,0],frame_count:13,fps:4,looping:false,wait_until_rendered_to_play:true};

test('Realmsと同じ明示render待機flagはcollectorで保持し未対応タイミングを日本語で診断する',async()=>{
  const input={namespace:'play',anim_realms_stories_icon:def};
  const catalog=await buildUiCatalog({sources:[{id:'public-equivalent',kind:'vanilla',precedence:0,filePaths:['ui/play_screen.json'],readText:async()=>JSON.stringify(input)}],parseJsonc});
  const definitions=collectPreviewAnimationDefinitions(catalog);
  assert.equal(definitions.definitions['play.anim_realms_stories_icon'].wait_until_rendered_to_play,true);
  const plan=compilePreviewAnimations(model,definitions);
  const diagnostic=plan.diagnostics.find(d=>d.code==='ANIMATION_RENDER_VISIBILITY_TIMING_UNSUPPORTED');
  assert(diagnostic);assert.match(diagnostic.detail,/開始時刻制御は未対応/u);
  assert.equal(plan.tracks.length,1);
  assert.deepEqual(samplePreviewAnimations(plan,.5).propsById.root.uv,[44,0]);
});

test('明示falseや省略では描画待機警告を追加しない',()=>{
  for(const override of [{wait_until_rendered_to_play:false},{wait_until_rendered_to_play:undefined}]) {
    const plan=compilePreviewAnimations(model,{definitions:{'play.anim_realms_stories_icon':{...def,...override}}});
    assert.equal(plan.diagnostics.some(d=>d.code==='ANIMATION_RENDER_VISIBILITY_TIMING_UNSUPPORTED'),false);
    assert.deepEqual(samplePreviewAnimations(plan,.5).propsById.root.uv,[44,0]);
  }
});
