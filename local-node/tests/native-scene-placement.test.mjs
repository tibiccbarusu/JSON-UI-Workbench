import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSIC_HORSE_PLACEMENT_PROFILE, resolveNativeScenePlacement } from '../../editor-core/src/preview/native-scene-placement.js';
const quad = (maxY=1) => ({ points: [{x:0.2,y:0},{x:0.8,y:0},{x:0.8,y:maxY},{x:0.2,y:maxY}] });
const horse = {kind:'horse', presentationProfile:CLASSIC_HORSE_PLACEMENT_PROFILE,faces:[quad()]};

test('実機観測のhorse control中心を足元に配置し、約2 control高を保つ', () => {
 const d={x:195.9*4,y:105.1*4,w:16.2*4,h:16.2*4};
 const p=resolveNativeScenePlacement(horse,d);
 assert.ok(Math.abs(p.extent-129.6)<1e-9);
 assert.ok(Math.abs(p.y+p.extent-452.8)<1e-9);
 assert.ok(Math.abs(p.x+p.extent/2-816)<1e-9);
});
test('移動/拡大を行っても足元pivotと寸法は共変する', () => {
 const d={x:20,y:30,w:16,h:16}; const a=resolveNativeScenePlacement(horse,d);
 const b=resolveNativeScenePlacement(horse,{x:d.x*3+7,y:d.y*3-19,w:d.w*3,h:d.h*3});
 assert.deepEqual(b,{x:a.x*3+7,y:a.y*3-19,extent:a.extent*3});
});
test('投影paddingがある姿勢でも実face下端を足元に置く',()=>{
 const p=resolveNativeScenePlacement({...horse,faces:[quad(0.8)]},{x:20,y:30,w:16,h:16});
 assert.ok(Math.abs(p.y+p.extent*0.8-38)<1e-9);
});
test('bookと未校正の汎用horse sceneの既存配置を変更しない',()=>{
 assert.deepEqual(resolveNativeScenePlacement({kind:'book'},{x:20,y:30,w:16,h:16}),{x:20,y:30,extent:16});
 assert.deepEqual(resolveNativeScenePlacement({kind:'horse'},{x:20,y:30,w:16,h:16}),{x:2,y:12,extent:52});
});
test('不正寸法/巨大face列/不正投影座標は配置を拒否する',()=>{
 assert.equal(resolveNativeScenePlacement(horse,{x:0,y:0,w:NaN,h:10}),null);
 assert.equal(resolveNativeScenePlacement(horse,{x:0,y:0,w:-1,h:10}),null);
 assert.equal(resolveNativeScenePlacement({...horse,faces:[]},{x:0,y:0,w:10,h:10}),null);
 assert.equal(resolveNativeScenePlacement({...horse,faces:Array(8193).fill(quad())},{x:0,y:0,w:10,h:10}),null);
 assert.equal(resolveNativeScenePlacement({...horse,faces:[quad(Infinity)]},{x:0,y:0,w:10,h:10}),null);
 assert.equal(resolveNativeScenePlacement({...horse,faces:[quad(1.1)]},{x:0,y:0,w:10,h:10}),null);
});
