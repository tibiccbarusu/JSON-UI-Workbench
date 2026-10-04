import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pngjs from '../vendor/pngjs/lib/png.js';
import { createLocalServer } from '../server.mjs';
import { LIMITS } from '../limits.mjs';
import { makeZip, manifest } from './fixtures.mjs';

async function api(t) {
  const app=await createLocalServer({port:0});t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.port}/api/node/`;
  const capability=await(await fetch(base+'capabilities')).json();
  const headers={'X-JSONUI-Token':capability.token,'Content-Type':'application/json'};
  return {
    async upload(files) {
      const id=randomUUID();
      const response=await fetch(base+'packs',{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-JSONUI-Upload-ID':id},
        body:makeZip({'manifest.json':manifest,...files})});
      assert.equal(response.status,200,await response.text());return id;
    },
    post(route,data){return fetch(base+route,{method:'POST',headers,body:JSON.stringify(data)});},
  };
}

function horseFiles(source) {
  return {
    'entity/horse.json':JSON.stringify({format_version:'1.10.0','minecraft:client_entity':{description:{
      identifier:'minecraft:horse',geometry:{default:'geometry.fixture'},textures:{default:`textures/${source}/horse`},
    }}}),
    'models/horse.geo.json':JSON.stringify({format_version:'1.21.0','minecraft:geometry':[{description:{
      identifier:'geometry.fixture',texture_width:64,texture_height:64,
    },bones:[{name:'body',cubes:[{origin:[0,0,0],size:[2,4,3],uv:[0,0]}]}]}]}),
  };
}

test('horse HTTPはsource配列の順序によらずimportedを優先する',async t=>{
  const client=await api(t);
  const vanilla=await client.upload(horseFiles('vanilla'));
  const imported=await client.upload(horseFiles('imported'));
  const sources=[{kind:'vanilla',id:vanilla},{kind:'imported',id:imported}];
  const first=await(await client.post('horse',{sources,targetEngineVersion:[1,26,40],camera:{yaw:20,pitch:25}})).json();
  assert.equal(first.status,'ready');assert.equal(first.textureRef,'textures/imported/horse');
  assert.equal(first.provenance.entitySource,'imported');assert.deepEqual(first.camera,{yaw:20,pitch:25});
  const reversed=await(await client.post('horse',{sources:sources.toReversed(),targetEngineVersion:[1,26,40],camera:{yaw:20,pitch:25}})).json();
  assert.deepEqual(first,reversed);
});

function fontPng(inkWidth) {
  const width=128,data=Buffer.alloc(width*width*4);
  for(let y=32;y<39;y++)for(let x=8;x<8+inkWidth;x++)data[(y*width+x)*4+3]=255;
  return pngjs.PNG.sync.write({width,height:width,data});
}

test('font HTTPはpack優先・実機観測root優先・locale fallbackを保持する',async t=>{
  const client=await api(t);
  const vanilla=await client.upload({'font/default8.png':fontPng(2)});
  const imported=await client.upload({'font/default8.png':fontPng(5),'texts/ja_JP/font/default8.png':fontPng(7)});
  const sources=[{kind:'vanilla',id:vanilla},{kind:'imported',id:imported}];
  const english=await(await client.post('font',{sources,locale:'en_US',sheet:'default8'})).json();
  assert.equal(english.provenance.source,'imported');assert.equal(english.metrics.glyphs[65].advance,6);
  const japanese=await(await client.post('font',{sources,locale:'ja_JP',sheet:'default8'})).json();
  assert.equal(japanese.provenance.path,'font/default8.png');assert.equal(japanese.metrics.glyphs[65].advance,6);
  assert.equal(japanese.provenance.resolutionProfile,'observed-classic-root-first-v1');
  const cached=await(await client.post('font',{sources:sources.toReversed(),locale:'en_US',sheet:'default8'})).json();
  assert.deepEqual(cached,english);
  const localeOnly=await client.upload({'texts/ja_JP/font/default8.png':fontPng(7)});
  const fallback=await(await client.post('font',{sources:[{kind:'imported',id:localeOnly},{kind:'vanilla',id:vanilla}],locale:'ja_JP',sheet:'default8'})).json();
  assert.equal(fallback.provenance.path,'texts/ja_JP/font/default8.png');assert.equal(fallback.metrics.glyphs[65].advance,8);
});

test('langのprototype関連キーをliteralとして保持し汚染しない',async t=>{
  const client=await api(t);
  const id=await client.upload({'texts/en_US.lang':'__proto__=literal\nconstructor=文字列\nprototype=値\nhasOwnProperty=所有\ntoString=変換\n'});
  const result=await(await client.post('lang',{sources:[{kind:'imported',id}],locale:'en_US'})).json();
  assert.equal(Object.getPrototypeOf(result.table),Object.prototype);
  for(const [key,value]of [['__proto__','literal'],['constructor','文字列'],['prototype','値'],['hasOwnProperty','所有'],['toString','変換']]) {
    assert.equal(Object.hasOwn(result.table,key),true);assert.equal(result.table[key],value);
  }
  assert.equal(Object.prototype.prototype,undefined);assert.equal(Object.prototype.hasOwnProperty instanceof Function,true);
});

test('lang overrideのUTF-8バイト上限をWorkerで拒否し次の要求を処理する',async t=>{
  const client=await api(t),id=await client.upload({'texts/ja_JP.lang':'name=正常\n'});
  const sources=[{kind:'imported',id,overrides:{'texts/ja_JP.lang':'あ'.repeat(Math.floor(LIMITS.textBytes/3)+1)}}];
  const rejected=await client.post('lang',{sources,locale:'ja_JP'});
  assert.equal(rejected.status,400);assert.equal((await rejected.json()).error,'NODE_OVERRIDE_LIMIT');
  const result=await(await client.post('lang',{sources:[{kind:'imported',id}],locale:'ja_JP'})).json();
  assert.equal(result.table.name,'正常');
});
