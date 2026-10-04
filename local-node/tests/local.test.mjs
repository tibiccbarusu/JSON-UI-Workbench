import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { makeZip,resourceFixture,withZip64End,crc32 } from './fixtures.mjs';
import { DiskZipReader } from '../disk-zip.mjs';
import { createLocalServer } from '../server.mjs';
import { buildUiCatalog,selectUiDefinition } from '../../editor-core/src/engine/ui-catalog.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import {publicErrorCode} from '../public-error.mjs';

async function withZip(bytes,fn){const root=await mkdtemp(path.join(tmpdir(),'jsonui-test-'));const file=path.join(root,'input.zip');await writeFile(file,bytes);const r=new DiskZipReader();try{await r.openFromFile({diskPath:file,name:'入力.zip'});await r.listEntries();return await fn(r);}finally{await r.close();await rm(root,{recursive:true,force:true});}}
for(const [name,code]of [['../outside','ZIP_PATH_TRAVERSAL'],['/absolute','ZIP_PATH_ABSOLUTE'],['C:drive','ZIP_PATH_DRIVE_LETTER'],['file:uri','ZIP_PATH_URL_SCHEME'],['nul.txt','ZIP_PATH_WINDOWS_UNSAFE'],['a:stream','ZIP_PATH_DRIVE_LETTER'],['trailing.','ZIP_PATH_WINDOWS_UNSAFE'],['space ','ZIP_PATH_WINDOWS_UNSAFE'],['a\0b','ZIP_PATH_CONTROL_CHAR'],['bad?.png','ZIP_PATH_WINDOWS_UNSAFE']]){
  test('ZIP拒否 '+name,async()=>{await assert.rejects(withZip(makeZip({[name]:'x'}),()=>{}),new RegExp(code));});
}
test('大小文字衝突を拒否',async()=>assert.rejects(withZip(makeZip({'a':'1','A':'2'}),()=>{}),/ZIP_PATH_COLLISION/));
test('Unix権限000のsymlinkを拒否',async()=>assert.rejects(withZip(makeZip({'link':'outside'},{system:3,attributes:0xa0000000}),()=>{}),/ZIP_SPECIAL/));
test('Unix socketを拒否',async()=>assert.rejects(withZip(makeZip({'socket':''},{system:3,attributes:0xc0000000}),()=>{}),/ZIP_SPECIAL/));
test('暗号化ZIPを拒否',async()=>assert.rejects(withZip(makeZip({'x':'y'},{flags:1}),()=>{}),/ZIP_ENCRYPTED/));
test('未対応圧縮を拒否',async()=>assert.rejects(withZip(makeZip({'x':'y'},{method:99}),()=>{}),/ZIP_COMPRESSION/));
test('local compressed size不一致を拒否',async()=>{const b=makeZip({'x':'hello'});b.writeUInt32LE(4,18);await assert.rejects(withZip(b,()=>{}),/ZIP_LOCAL_SIZE/);});
test('local filename不一致を拒否',async()=>{const b=makeZip({'x':'hello'});b[30]=121;await assert.rejects(withZip(b,()=>{}),/ZIP_LOCAL_NAME/);});
test('CRC改変を読取時に拒否',async()=>{const b=makeZip({'x':'hello'});b[31]^=1;await assert.rejects(withZip(b,r=>r.readText('x')),/signature|CRC/i);});
test('末尾切断を拒否',async()=>assert.rejects(withZip(makeZip({'x':'y'}).subarray(0,-1),()=>{}),/EOCD/));
test('宣言件数不一致を拒否',async()=>{const b=makeZip({'x':'y'});b.writeUInt16LE(2,b.length-14);b.writeUInt16LE(2,b.length-12);await assert.rejects(withZip(b,()=>{}));});
test('遅延読取と小さい読取上限',async()=>withZip(makeZip({'folder/日本語.txt':'こんにちは'}),async r=>{assert.equal(await r.readText('folder/日本語.txt'),'こんにちは');await assert.rejects(r.readText('folder/日本語.txt',{maxBytes:3}),/READ_LIMIT/);}));
test('存在しないentryを報告',async()=>withZip(makeZip({'x':'y'}),r=>assert.rejects(r.readBlob('missing'),/NOT_FOUND/)));
test('署名ありdata descriptorを受理',async()=>withZip(makeZip({'x':'hello'},{descriptor:true}),async r=>assert.equal(await r.readText('x'),'hello')));
test('署名なしdata descriptorを受理',async()=>withZip(makeZip({'x':'hello'},{descriptor:true,descriptorSignature:false}),async r=>assert.equal(await r.readText('x'),'hello')));
test('data descriptorのCRC改変を拒否',async()=>{const b=makeZip({'x':'hello'},{descriptor:true});b[40]^=1;await assert.rejects(withZip(b,()=>{}),/DESCRIPTOR_CRC/);});
test('data descriptorのサイズ改変を拒否',async()=>{const b=makeZip({'x':'hello'},{descriptor:true});b[44]^=1;await assert.rejects(withZip(b,()=>{}),/DESCRIPTOR_SIZE/);});
test('CRCがdescriptor署名と同値でも省略prefixを受理',async()=>{const value=Buffer.from('ac0a7ad5','hex');assert.equal(crc32(value),0x08074b50);await withZip(makeZip({x:value},{descriptor:true,descriptorSignature:false}),async r=>assert.deepEqual(await r.bytes('x'),value));});
test('ZIP64 EOCDと拡張recordを受理',async()=>{for(const size of [44,52])await withZip(withZip64End(makeZip({x:'hello'}),size,size-44),async r=>assert.equal(await r.readText('x'),'hello'));});
test('ZIP64 EOCD宣言長の不整合を拒否',async()=>{for(const size of [0,1000000])await assert.rejects(withZip(withZip64End(makeZip({x:'hello'}),size),()=>{}),/ZIP64_EOCD_SIZE/);});
test('JSONC未閉じcommentを拒否',()=>assert.equal(parseJsonc('{"x":1}/*').ok,false));
test('公開errorはpathやstackを漏らさずcodeを保持',()=>{assert.equal(publicErrorCode(new Error('/private/input.zip failed')),'NODE_OPERATION_FAILED');assert.equal(publicErrorCode(Object.assign(new Error('/private/input.zip'),{code:'ENOENT'})),'ENOENT');assert.equal(publicErrorCode(new Error('ZIP_ENTRY_NOT_FOUND')),'ZIP_ENTRY_NOT_FOUND');});
test('JSONC通常commentsとtrailing commaを許容',()=>assert.deepEqual(parseJsonc('{/* c */"x":1,}').value,{x:1}));
test('定義選択のID優先と曖昧名拒否',()=>{const rows=[{id:'id-a',rawKey:'same@a',localName:'same'},{id:'id-b',rawKey:'same@b',localName:'same'}];assert.equal(selectUiDefinition(rows,'id-b'),rows[1]);assert.equal(selectUiDefinition(rows,'same@a'),rows[0]);assert.throws(()=>selectUiDefinition(rows,'same'),/AMBIGUOUS/);assert.throws(()=>selectUiDefinition(rows,'missing'),/NOT_FOUND/);});
test('不正ui_defsを全探索に切り替えない',async()=>{await assert.rejects(buildUiCatalog({sources:[{id:'one',kind:'imported',filePaths:['ui/_ui_defs.json','ui/draft.json'],readText:async p=>p.endsWith('_ui_defs.json')?'{"ui_defs":false}':'{"namespace":"x","screen":{"type":"screen"}}'}],parseJsonc}),/UI_DEFS_INVALID/);});
test('明示Pocket指定を索引に反映',async()=>{const c=await buildUiCatalog({sources:[{id:'one',kind:'imported',filePaths:['ui/test.json'],readText:async()=>'{"namespace":"x","screen":{"type":"screen","$pocket_screen":true}}'}],parseJsonc});assert.equal(c.records[0].profile,'pocket');});
test('全体走査上限が未完了を明示',async()=>{const c=await buildUiCatalog({sources:[{id:'one',kind:'imported',filePaths:['ui/test.json'],readText:async()=>'{"namespace":"x","screen":{"type":"screen","size":[1,2,3]}}'}],parseJsonc,limits:{maxReferenceNodesTotal:1}});assert.equal(c.records[0].referenceScanComplete,false);assert(c.diagnostics.some(x=>x.reasons?.includes('global-nodes')));});

test('ローカルAPI: 操作・境界・中断の統合',async t=>{
  const app=await createLocalServer({port:0});t.after(()=>app.close());const base=`http://127.0.0.1:${app.port}`;
  const cap=await (await fetch(base+'/api/node/capabilities')).json();const headers={'X-JSONUI-Token':cap.token,'Content-Type':'application/json'};
  async function call(route,method='GET',data){return fetch(base+'/api/node/'+route,{method,headers:{...headers,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});}
  await t.test('root redirectとCSS到達',async()=>{const r=await fetch(base+'/');assert.equal(new URL(r.url).pathname,'/app/index.html');assert.equal((await fetch(base+'/app/styles.css')).status,200);});
  await t.test('source以外非公開',async()=>{assert.equal((await fetch(base+'/package.json')).status,404);assert.equal((await fetch(base+'/.git/config')).status,404);});
  await t.test('tokenなしを拒否',async()=>assert.equal((await fetch(base+'/api/node/catalog',{method:'POST',body:'{}'})).status,401));
  await t.test('cross originを拒否',async()=>assert.equal((await fetch(base+'/api/node/capabilities',{headers:{Origin:'https://untrusted.example'}})).status,403));
  await t.test('偽Hostを拒否',async()=>{const status=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/node/capabilities',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(status,403);});
  await t.test('未知APIをJSON404',async()=>{const r=await call('absent');assert.equal(r.status,404);assert.equal((await r.json()).error,'NODE_ROUTE_NOT_FOUND');});
  await t.test('不正JSONを拒否',async()=>assert.equal((await fetch(base+'/api/node/catalog',{method:'POST',headers,body:'{'})).status,400));
  await t.test('JSON null本文を明示拒否',async()=>assert.equal((await fetch(base+'/api/node/catalog',{method:'POST',headers,body:'null'})).status,400));
  await t.test('ローカルガイド到達',async()=>assert.equal((await fetch(base+'/docs/user_guide_ja.md')).status,200));
  await t.test('JSON APIのtext/plainを拒否',async()=>assert.equal((await fetch(base+'/api/node/catalog',{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:'{}'})).status,415));
  await t.test('ZIP APIのtext/plainを拒否',async()=>assert.equal((await fetch(base+'/api/node/packs',{method:'POST',headers:{...headers,'Content-Type':'text/plain','X-JSONUI-Upload-ID':randomUUID()},body:resourceFixture()})).status,415));
  const id=randomUUID(),zip=resourceFixture();
  const uploaded=await fetch(base+'/api/node/packs',{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-JSONUI-Upload-ID':id,'X-JSONUI-Name':encodeURIComponent('テスト.zip')},body:zip});
  const metadata=await uploaded.json();assert.equal(uploaded.status,200,JSON.stringify(metadata));
  await t.test('manifestとルート正規化',()=>{assert.equal(metadata.rootPrefix,'root/');assert.equal(metadata.zipMeta.fileName,'テスト.zip');assert(metadata.packPaths.includes('ui/example.json'));});
  await t.test('overrideのtraversalとcase衝突を拒否',async()=>{
    for(const overrides of [{'../ui/outside.json':'{}'},{'ui/A.json':'{}','ui/a.json':'{}'},['{}']])assert.equal((await call('catalog','POST',{sources:[{id,kind:'imported',overrides}]})).status,400);
  });
  await t.test('horse/fontのsource境界を共通検査',async()=>{
    assert.equal((await call('horse','POST',{sources:[{id,kind:'imported',overrides:[]}]})).status,400);
    assert.equal((await call('font','POST',{sources:[{id,kind:'unknown'}],sheet:'default8'})).status,400);
  });
  await t.test('同一IDを拒否',async()=>assert.equal((await fetch(base+'/api/node/packs',{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-JSONUI-Upload-ID':id},body:zip})).status,409));
  await t.test('lazy text読取',async()=>assert.match(await (await call(`packs/${id}/read?path=root%2Fui%2Fexample.json`)).text(),/local text/));
  const catalog=await(await call('catalog','POST',{sources:[{id,kind:'imported'}]})).json();assert(catalog.nodeCatalogId,JSON.stringify(catalog));
  await t.test('compact catalogにraw値重複なし',()=>{assert.equal(catalog.recordsById,undefined);assert.equal(catalog.records[0].value,undefined);assert.equal(catalog.records.length,4);});
  const record=catalog.records.find(r=>r.localName==='screen');
  await t.test('Nodeでcross-file継承を解決',async()=>{const result=await(await call('project','POST',{catalogId:catalog.nodeCatalogId,recordId:record.id})).json();assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.document.screen.size,[40,30]);});
  await t.test('PocketをAPI側でも拒否',async()=>{const r=await call('project','POST',{catalogId:catalog.nodeCatalogId,recordId:catalog.records.find(r=>r.localName==='pocket').id});assert.equal(r.status,422);});
  await t.test('hydrateで必要なraw値を取得',async()=>{const rows=await(await call('hydrate','POST',{catalogId:catalog.nodeCatalogId,offset:0})).json();assert.equal(rows.length,4);assert(rows[0].value);});
  await t.test('assets索引をNodeで作成',async()=>{const a=await(await call(`packs/${id}/assets`)).json();assert(a.textures.byLower.some(([key])=>key==='textures/ui/pixel.png'));});
  await t.test('中断JSON24回でも受付が維持',async()=>{
    for(let n=0;n<24;n++)await new Promise(resolve=>{const req=http.request(base+'/api/node/catalog',{method:'POST',headers:{...headers,'Content-Length':'200'}});req.on('error',()=>{});req.on('close',resolve);req.flushHeaders();req.write('{');setTimeout(()=>req.destroy(),5);});
    assert.equal((await fetch(base+'/api/node/capabilities')).status,200);
  });
  await t.test('pack削除とcatalog失効',async()=>{assert.equal((await call(`packs/${id}`,'DELETE')).status,200);assert.equal((await call(`packs/${id}/assets`)).status,404);assert.equal((await call('project','POST',{catalogId:catalog.nodeCatalogId,recordId:record.id})).status,409);});
});

test('worker停止後の復旧とtoken更新',async t=>{
  const app=await createLocalServer({port:0});t.after(()=>app.close());const base=`http://127.0.0.1:${app.port}/api/node/`;
  const first=await(await fetch(base+'capabilities')).json();
  await app.processor.close();
  const next=await(await fetch(base+'capabilities')).json();assert.notEqual(next.token,first.token);
  assert.equal((await fetch(base+'packs/'+randomUUID(),{method:'DELETE',headers:{'X-JSONUI-Token':first.token}})).status,401);
  const id=randomUUID();assert.equal((await fetch(base+'packs',{method:'POST',body:resourceFixture(),headers:{'X-JSONUI-Token':next.token,'X-JSONUI-Upload-ID':id}})).status,200);
  assert.equal((await fetch(base+'packs/'+id+'/assets',{headers:{'X-JSONUI-Token':next.token}})).status,200);
});
