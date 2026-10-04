import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNativeScenePlacement as place,resolveNativeSceneRasterBounds as bounds} from '../src/preview/native-scene-placement.js';
const scene=Object.freeze({kind:'horse',faces:Object.freeze([Object.freeze({points:Object.freeze([Object.freeze({x:0,y:0}),Object.freeze({x:1,y:0}),Object.freeze({x:1,y:1}),Object.freeze({x:0,y:1})])})])});
const destination=Object.freeze({x:0,y:0,w:20,h:30});
test('有限な巨大 w/h の倍率 overflow は既存 invalid 契約の null',()=>{
 assert.equal(place(scene,{x:0,y:0,w:Number.MAX_VALUE,h:Number.MAX_VALUE}),null);
});
test('有限な x と width の加算 overflow も null',()=>{
 assert.equal(place({kind:'book'},{x:Number.MAX_VALUE,y:0,w:Number.MAX_VALUE,h:10}),null);
});
test('通常配置の比率と負の原点を変えない',()=>{
 assert.deepEqual(place(scene,destination),{x:-22.5,y:-17.5,extent:65});
 assert.deepEqual(place({kind:'book'},destination),{x:0,y:5,extent:20});
});
test('元の正規化正方形と 1 pixel 境界を維持する',()=>{
 const book={...scene,kind:'book'};
 assert.deepEqual(bounds(book,destination),{x:-1,y:4,w:22,h:22});
});
for(const placement of [{x:NaN,y:0,extent:10},{x:0,y:Infinity,extent:10},{x:0,y:0,extent:Infinity},{x:0,y:0,extent:0},{x:0,y:0,extent:-1},{x:'0',y:0,extent:10}])test(`不正な直接 placement ${JSON.stringify(placement)} を拒否`,()=>{
 assert.equal(bounds(scene,destination,placement),null);
});
test('検証済み placement でも面の拡張計算が overflow したら null',()=>{
 const wide={kind:'horse',faces:[{points:[{x:-4,y:0},{x:4,y:0},{x:4,y:1},{x:-4,y:1}]}]};
 assert.equal(bounds(wide,destination,{x:0,y:0,extent:Number.MAX_VALUE}),null);
});
test('回転面の負座標と既存入力を保持する',()=>{
 const wide=Object.freeze({faces:Object.freeze([Object.freeze({points:Object.freeze([Object.freeze({x:-.5,y:0}),Object.freeze({x:1.5,y:0}),Object.freeze({x:1.5,y:1}),Object.freeze({x:-.5,y:1})])})])});
 assert.deepEqual(bounds(wide,destination,Object.freeze({x:0,y:0,extent:20})),{x:-11,y:-1,w:42,h:22});
 assert.deepEqual(destination,{x:0,y:0,w:20,h:30});
});
