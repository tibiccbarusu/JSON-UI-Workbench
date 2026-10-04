import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTextureShader } from '../../editor-core/src/preview/native-texture-shading26.js';

test('R28: 予算0で2万種の3D陰影失敗を繰返しても通常キャッシュ0・失敗メモ1件以下を守る', () => {
  let allocations=0;const shader=createNativeTextureShader({maxPixels:0,maxVariants:0,createSurface:()=>{allocations++;}});
  for(let i=0;i<20000;i++)assert.equal(shader.get({},2,2,i/20001).issue,'NATIVE_PREVIEW_SHADE_BUDGET_EXCEEDED');
  const stats=shader.snapshot();assert.equal(allocations,0);assert.equal(stats.retainedSources,0);
  assert.equal(stats.retainedVariants,0);assert.equal(stats.uncachedFailures,20000);assert.equal(stats.retainedBudgetFailures,1);
});
test('R28: 作成失敗は試行予算内だけ保持し、同一キーで再作成しない', () => {
  let allocations=0;const shader=createNativeTextureShader({maxVariants:2,createSurface:()=>{allocations++;throw new Error('no-canvas');}});
  const image={};const first=shader.get(image,2,2,.5);assert.equal(first.issue,'NATIVE_PREVIEW_SHADE_UNAVAILABLE');
  assert.equal(shader.get(image,2,2,.5),first);shader.get({},2,2,.5);
  for(let i=0;i<100;i++)shader.get({},2,2,.5);
  assert.equal(allocations,2);assert.equal(shader.snapshot().retainedSources,2);assert.equal(shader.snapshot().retainedVariants,2);
  assert.equal(shader.get(image,2,2,1).image,image);
});

test('R28: 同じ予算超過の連続照会は診断を重複させず失敗メモも1件', () => {
  const shader=createNativeTextureShader({maxVariants:0,createSurface:()=>null}), image={};
  const first=shader.get(image,2,2,.5);
  for(let i=0;i<100;i++)assert.equal(shader.get(image,2,2,.5),first);
  assert.equal(shader.snapshot().failures,1);
  shader.get({},2,2,.5);
  assert.equal(shader.snapshot().retainedBudgetFailures,1);
});
