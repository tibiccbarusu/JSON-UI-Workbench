import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBedrockGeometryScene as compile } from '../src/preview/native-model-preview.js';
import { compileBedrockGeometryScene as before } from './fixtures/native-model-baseline20.js';

const options = { geometryFormatVersion:'1.21.0', retainMotionMesh:true };
function planar() {
  return { description:{texture_width:64,texture_height:64}, bones:[{name:'flat',
    cubes:[{origin:[0,0,0],size:[4,0,4],uv:[-4,4]}]}] };
}
function uvWithinTexture(uv) {
  return Math.min(uv.x,uv.x+uv.w) >= 0 && Math.max(uv.x,uv.x+uv.w) <= 1
    && Math.min(uv.y,uv.y+uv.h) >= 0 && Math.max(uv.y,uv.y+uv.h) <= 1;
}
test('only physical zero-area faces can bypass UV bounds', () => {
  const geometry=planar();
  assert.equal(before(geometry,options).error,'NATIVE_PREVIEW_MODEL_INVALID');
  const result=compile(geometry,options);
  assert.equal(result.ok,true);assert.equal(result.stats.zeroAreaUvBoundsSkipped,1);
  assert.deepEqual(result.scene.motionMesh.faces.map(f=>f.faceName).sort(),['down','up']);
  assert.equal(result.scene.motionMesh.vertices.length,8);
  assert.ok(result.scene.motionMesh.faces.every(f=>uvWithinTexture(f.uv)));
});
test('cube, bone and camera rigid rotations do not turn zero-area into area', () => {
  for(const camera of [{yaw:0,pitch:20},{yaw:60,pitch:40},{yaw:-90,pitch:-30}]) {
    const geometry=planar();geometry.bones[0].pivot=[0,0,0];geometry.bones[0].rotation=[10,20,30];
    Object.assign(geometry.bones[0].cubes[0],{pivot:[2,0,2],rotation:[30,40,50]});
    const result=compile(geometry,{...options,camera});
    assert.equal(result.ok,true);assert.equal(result.stats.zeroAreaUvBoundsSkipped,1);
    assert.deepEqual(result.scene.motionMesh.faces.map(f=>f.faceName).sort(),['down','up']);
  }
});
test('positive cube inflate requires UV bounds on formerly zero-area faces', () => {
  const geometry=planar();geometry.bones[0].cubes[0].inflate=0.5;
  assert.equal(compile(geometry,options).detail.reason,'outside-texture');
});
test('legacy bone inflate and explicit zero cube inflate remain distinct', () => {
  const geometry=planar();geometry.bones[0].inflate=0.5;
  const legacy={...options,geometryFormatVersion:'1.8.0'};
  assert.equal(compile(geometry,legacy).detail.reason,'outside-texture');
  geometry.bones[0].cubes[0].inflate=0;
  assert.equal(compile(geometry,legacy).ok,true);
});
test('modern ignored bone inflate keeps the existing version contract', () => {
  const geometry=planar();geometry.bones[0].inflate=0.5;
  assert.equal(compile(geometry,options).ok,true);
});
test('negative inflate may produce an exact plane without accepting negative extents', () => {
  const geometry=planar();Object.assign(geometry.bones[0].cubes[0],{size:[6,2,6],uv:[-6,6],inflate:-1});
  const result=compile(geometry,options);
  assert.equal(result.ok,true);assert.deepEqual(result.scene.motionMesh.faces.map(f=>f.faceName).sort(),['down','up']);
  geometry.bones[0].cubes[0].inflate=-1.01;
  assert.equal(compile(geometry,options).detail.reason,'negative-inflated-extent');
});
test('tiny nonzero dimensions are not zero by multiplication underflow', () => {
  const geometry=planar();Object.assign(geometry.bones[0].cubes[0],{size:[4,Number.MIN_VALUE,Number.MIN_VALUE],uv:[-4,4]});
  assert.equal(compile(geometry,options).detail.reason,'outside-texture');
});
test('zero-area UV rectangle does not excuse nonzero physical geometry', () => {
  const geometry=planar();geometry.bones[0].cubes[0].size=[4,4,4];
  geometry.bones[0].cubes[0].uv={west:{uv:[100,100],uv_size:[0,0]}};
  assert.equal(compile(geometry,options).detail.reason,'outside-texture');
});
test('out-of-range nonzero physical face is rejected even when projected edge-on', () => {
  const geometry=planar();geometry.bones[0].cubes[0].size=[4,4,4];
  geometry.bones[0].cubes[0].uv={west:{uv:[100,100]},south:{uv:[0,0]}};
  assert.equal(compile(geometry,{...options,camera:{yaw:0,pitch:0}}).detail.reason,'outside-texture');
});
for(const [label,face] of [
  ['null face',null], ['missing UV',{}], ['string UV',{uv:'bad'}],
  ['nonfinite UV',{uv:[Infinity,0]}], ['wrong UV size',{uv:[0,0],uv_size:[1]}],
  ['nonfinite UV size',{uv:[0,0],uv_size:[1,NaN]}],
  ['invalid angle',{uv:[0,0],uv_rotation:45}],
  ['sparse UV',{uv:new Array(2)}],
]) test(`zero-area face retains validation: ${label}`,()=>{
  const geometry=planar();geometry.bones[0].cubes[0].uv={west:face,up:{uv:[0,0]}};
  assert.equal(compile(geometry,options).error,'NATIVE_PREVIEW_MODEL_INVALID');
});
test('zero-area face retains unsupported material validation',()=>{
  const geometry=planar();geometry.bones[0].cubes[0].uv={west:{uv:[0,0],material_instance:'custom'},up:{uv:[0,0]}};
  assert.equal(compile(geometry,options).detail.feature,'material_instance');
});
test('omitted per-face entries remain absent without invented UVs',()=>{
  const geometry=planar();geometry.bones[0].cubes[0].uv={up:{uv:[0,0]}};
  const result=compile(geometry,options);
  assert.equal(result.ok,true);assert.equal(result.stats.zeroAreaUvBoundsSkipped,undefined);
  assert.deepEqual(result.scene.motionMesh.faces.map(f=>f.faceName),['up']);
});
test('per-face signed UV and quarter turns remain valid while only zero-area bounds are skipped',()=>{
  const geometry=planar();geometry.bones[0].cubes[0].uv={west:{uv:[100,100],uv_size:[-4,-4]},up:{uv:[4,4],uv_size:[-4,-4],uv_rotation:90}};
  const result=compile(geometry,options);
  assert.equal(result.ok,true);assert.equal(result.stats.zeroAreaUvBoundsSkipped,1);
  assert.deepEqual(result.scene.motionMesh.faces.map(f=>f.faceName),['up']);
});
test('mirror type and cube transform validation are not bypassed by zero-area faces',()=>{
  for(const property of [{mirror:'true'},{rotation:[0,null,0]},{pivot:[0,0]}]) {
    const geometry=planar();Object.assign(geometry.bones[0].cubes[0],property);
    assert.equal(compile(geometry,options).error,'NATIVE_PREVIEW_MODEL_INVALID');
  }
});
