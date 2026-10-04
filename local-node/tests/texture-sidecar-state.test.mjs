import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTextureSidecarDrawState as resolve} from '../../editor-core/src/preview/texture-sidecar-contract.js';
const authored={nineSlice:null,baseSize:null,keepRatio:true,tiled:false};
test('枠素材sidecar読込待ちと並列上限待ちは縮小stretchを許可しない',()=>{
 for(const record of [null,{}, {status:'loading'}])assert.equal(resolve(authored,record).state,'loading');
});
test('sidecar読込失敗は素材readyと区別しコードを維持する',()=>{
 assert.equal(resolve(authored,{status:'error'}).issue,'TEXTURE_SIDECAR_LOAD_FAILED');
 assert.deepEqual(resolve(authored,{status:'error',code:'TEXTURE_SIDECAR_CACHE_LIMIT'}),{state:'missing',metadata:authored,issue:'TEXTURE_SIDECAR_CACHE_LIMIT'});
});
test('sidecar無しの通常画像は読込を阻害しない',()=>assert.equal(resolve(authored,{status:'missing'}).state,'ready'));
test('実pack10px素材の論理5px sidecarを描画情報へ一体化する',()=>{
 const result=resolve(authored,{status:'ready',value:{nineSlice:2,baseSize:[5,5],tiled:null}});
 assert.equal(result.state,'ready');assert.deepEqual(result.metadata.baseSize,[5,5]);assert.equal(result.metadata.nineSlice,2);
 assert.equal(authored.nineSlice,null);
});
test('JSON UI明示のnine-sliceとtiled=falseがsidecarより優先する',()=>{
 const result=resolve({...authored,nineSlice:[1,2,3,4],tiledAuthored:true},{status:'ready',value:{nineSlice:2,baseSize:[5,5],tiled:true}});
 assert.deepEqual(result.metadata.nineSlice,[1,2,3,4]);assert.equal(result.metadata.tiled,false);assert.equal(result.metadata.tiledAuthored,undefined);
});
test('不正base_sizeと負のnine-sliceを無診断で伸縮しない',()=>{
 for(const baseSize of [[0,5],[5,-1],['5',5],[Infinity,5],[5],[5,5,5]]) assert.equal(resolve(authored,{status:'ready',value:{baseSize}}).issue,'TEXTURE_SIDECAR_BASE_SIZE_INVALID');
 for(const nineSlice of [-1,[2],[1,2,3],NaN,'2']) assert.equal(resolve(authored,{status:'ready',value:{nineSlice}}).issue,'TEXTURE_SIDECAR_NINE_SLICE_INVALID');
});
