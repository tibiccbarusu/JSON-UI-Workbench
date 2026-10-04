import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ResourceZipReader } from '../resource-zip.mjs';
import { createLocalServer } from '../server.mjs';
import { NodeRemoteReader } from '../../editor-core/src/pack-io/node-remote-client.js';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const png = color => pngjs.PNG.sync.write({width: 1, height: 1, data: Buffer.from([...color, 255])});
const archivePng = png([34, 80, 160]), loosePng = png([190, 90, 40]);
function brarchive(entries) {
  const size = entries.reduce((n, [,v]) => n + v.length, 0), data = Buffer.alloc(16 + entries.length * 256 + size);
  data.writeBigUInt64LE(0x267052a0b125277dn, 0); data.writeUInt32LE(entries.length, 8); data.writeUInt32LE(1, 12);
  let offset = 0;
  entries.forEach(([name,value], i) => {
    const at = 16 + i * 256, nameBytes = Buffer.from(name);
    data[at] = nameBytes.length; nameBytes.copy(data, at+1);
    data.writeUInt32LE(offset, at+248);data.writeUInt32LE(value.length, at+252);
    value.copy(data,16+entries.length*256+offset);offset+=value.length;
  });
  return data;
}
async function withResource(files, run) {
  const dir = await mkdtemp(join(tmpdir(),'jsonui-resource-zip-')), diskPath = join(dir,'fixture.zip');
  const reader = new ResourceZipReader();
  try {
    await writeFile(diskPath, makeZip(files));
    await reader.openFromFile({diskPath,name:'archive-fixture.zip'});
    const result = await reader.listEntries();
    return await run(reader,result);
  } finally { await reader.close(); await rm(dir,{recursive:true,force:true}); }
}

test('virtual PNG の原本・索引・物理ZIP統計を分離する',async()=>withResource({
  'pack/manifest.json':manifest,
  'pack/__brarchive/textures/ui.brarchive':brarchive([['pixel.png',archivePng]]),
},async(reader,result)=>{
  assert.equal(result.meta.entryCount,2);
  assert.equal(result.meta.brarchive.virtualEntries,1);
  assert.equal(result.meta.brarchive.mounted,1);
  const info=reader.entryIndex.get('pack/textures/ui/pixel.png').info;
  assert.equal(info.virtual,true);
  assert.equal(info.archivePath,'pack/__brarchive/textures/ui.brarchive');
  assert.equal(info.archiveEntry,'pixel.png');
  assert.equal(info.uncompressedSize,archivePng.length);
  assert.deepEqual(await reader.bytes(info.path),archivePng);
  assert.deepEqual((await reader.listEntries()).meta,result.meta);
}));

test('virtual read はlooseと同じパス正規化を使い、traversalは拒否する',async()=>withResource({
  'pack/__brarchive/textures/ui.brarchive':brarchive([['pixel.png',archivePng]]),
},async reader=>{
  assert.deepEqual(await reader.bytes('./pack/textures//ui/pixel.png'),archivePng);
  await assert.rejects(reader.bytes('pack/textures/../ui/pixel.png'),/TRAVERSAL/);
  await assert.rejects(reader.bytes('pack/textures/ui/pixel.png',8),/READ_LIMIT/);
}));

test('loose 同一パスはarchiveを上書きし、別名のvirtualは保持する',async()=>withResource({
  'pack/textures/ui/pixel.png':loosePng,
  'pack/__brarchive/textures/ui.brarchive':brarchive([['pixel.png',archivePng],['other.png',archivePng]]),
},async(reader,result)=>{
  assert.equal(result.meta.brarchive.looseFileOverrides,1);
  assert.equal(result.meta.brarchive.virtualEntries,1);
  assert.equal(reader.entryIndex.get('pack/textures/ui/pixel.png').info.virtual,undefined);
  assert.deepEqual(await reader.bytes('pack/textures/ui/pixel.png'),loosePng);
  assert.deepEqual(await reader.bytes('pack/textures/ui/other.png'),archivePng);
}));

test('archive間衝突時は失敗archiveの先頭項目も統計も採用しない',async()=>withResource({
  'pack/textures/ui/loose.png':loosePng,
  'pack/__brarchive/textures.brarchive':brarchive([['ui/shared.png',archivePng]]),
  'pack/__brarchive/textures/ui.brarchive':brarchive([['loose.png',archivePng],['unique.png',archivePng],['shared.png',loosePng]]),
},async(reader,result)=>{
  assert(result.warnings.some(w=>w.code==='BRARCHIVE_RESOURCE_COLLISION'));
  assert.equal(result.meta.brarchive.mounted,1);
  assert.equal(result.meta.brarchive.virtualEntries,1);
  assert.equal(result.meta.brarchive.looseFileOverrides,0);
  assert(!reader.entryIndex.has('pack/textures/ui/unique.png'));
  assert.deepEqual(await reader.bytes('pack/textures/ui/shared.png'),archivePng);
}));

test('壊れた archive は警告を残し、loose と正常archiveを読み続ける',async()=>withResource({
  'pack/manifest.json':manifest,
  'pack/textures/ui/loose.png':loosePng,
  'pack/__brarchive/ui.brarchive':Buffer.from('invalid archive'),
  'pack/__brarchive/textures/ui.brarchive':brarchive([['pixel.png',archivePng]]),
},async(reader,result)=>{
  assert(result.warnings.some(w=>w.code==='BRARCHIVE_HEADER_TRUNCATED'));
  assert.equal(result.meta.brarchive.seen,2);
  assert.equal(result.meta.brarchive.mounted,1);
  assert.deepEqual(await reader.bytes('pack/textures/ui/loose.png'),loosePng);
  assert.deepEqual(await reader.bytes('pack/textures/ui/pixel.png'),archivePng);
}));

test('archive entryの不正パスは部分採用せず警告となる',async()=>withResource({
  'pack/__brarchive/textures/ui.brarchive':brarchive([['safe.png',archivePng],['../outside.png',archivePng]]),
},async(reader,result)=>{
  assert(result.warnings.some(w=>w.code==='BRARCHIVE_PATH_UNSAFE'));
  assert.equal(result.meta.brarchive.virtualEntries,0);
  assert(!reader.entryIndex.has('pack/textures/ui/safe.png'));
}));

test('正常にmountされなくてもarchive試行件数を制限する',async()=>{
  const files={};for(let i=0;i<129;i++)files[`pack/__brarchive/textures/part${i}.brarchive`]=Buffer.alloc(16);
  await withResource(files,async(_reader,result)=>{
    assert.equal(result.meta.brarchive.mounted,0);
    assert.equal(result.meta.brarchive.attempted,128);
    assert.equal(result.meta.brarchive.skipped,1);
    assert(result.warnings.some(w=>w.code==='BRARCHIVE_COUNT_LIMIT'));
  });
});

test('同時索引要求は同じ完成済みmetadataを返す',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jsonui-resource-concurrent-')),diskPath=join(dir,'input.zip');
  const reader=new ResourceZipReader();
  try{
    await writeFile(diskPath,makeZip({'pack/__brarchive/textures/ui.brarchive':brarchive([['pixel.png',archivePng]])}));
    await reader.openFromFile({diskPath,name:'concurrent.zip'});
    const [first,second]=await Promise.all([reader.listEntries(),reader.listEntries()]);
    assert.equal(first.meta.brarchive.virtualEntries,1);
    assert.deepEqual(first.meta,second.meta);
    assert.equal(reader.brReaders.length,1);
  }finally{await reader.close();await rm(dir,{recursive:true,force:true});}
});

test('APIとNodeRemoteReaderでvirtual PNG・loose優先・警告・metadataを維持する',async t=>{
  const app=await createLocalServer({port:0});
  const nativeFetch=globalThis.fetch, oldWindow=globalThis.window;
  const base=`http://127.0.0.1:${app.port}`;
  const fetchAbsolute=(input,options)=>nativeFetch(typeof input==='string'&&input.startsWith('/')?base+input:input,options);
  globalThis.window={};globalThis.fetch=fetchAbsolute;
  t.after(async()=>{globalThis.fetch=nativeFetch;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;await app.close();});
  const capabilities=await(await nativeFetch(base+'/api/node/capabilities')).json();
  const id=randomUUID(), files={
    'root/manifest.json':manifest,
    'root/textures/ui/pixel.png':loosePng,
    'root/__brarchive/textures/ui.brarchive':brarchive([['pixel.png',archivePng],['virtual.png',archivePng],['stub.png',Buffer.alloc(0)]]),
    'root/__brarchive/ui.brarchive':Buffer.from('invalid archive'),
  };
  const uploaded=await nativeFetch(base+'/api/node/packs',{method:'POST',headers:{'X-JSONUI-Token':capabilities.token,
    'Content-Type':'application/zip','X-JSONUI-Upload-ID':id,'X-JSONUI-Name':encodeURIComponent('仮想素材.zip')},body:makeZip(files)});
  const metadata=await uploaded.json();assert.equal(uploaded.status,200,JSON.stringify(metadata));
  assert.equal(metadata.rootPrefix,'root/');
  assert.equal(metadata.zipMeta.entryCount,Object.keys(files).length);
  assert.equal(metadata.zipMeta.brarchive.virtualEntries,2);
  assert.equal(metadata.zipMeta.brarchive.looseFileOverrides,1);
  assert(metadata.warnings.some(w=>w.code==='BRARCHIVE_HEADER_TRUNCATED'));
  const virtual=metadata.entries.find(e=>e.path==='root/textures/ui/virtual.png');
  assert.equal(virtual.virtual,true);assert.equal(virtual.archiveEntry,'virtual.png');
  assert.equal(metadata.entries.find(e=>e.path==='root/textures/ui/stub.png').blockedReason,'BRARCHIVE_ENTRY_STUB');
  const remote=new NodeRemoteReader(metadata);
  try {
    assert((await remote.listAllFilePaths()).includes('root/textures/ui/virtual.png'));
    assert.equal(remote.entryIndex.get(virtual.path).info.archivePath,virtual.archivePath);
    const image=await remote.readBlob(virtual.path,{mimeType:'image/png'});
    assert.equal(image.type,'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),archivePng);
    assert.deepEqual(Buffer.from(await(await remote.readBlob('root/textures/ui/pixel.png')).arrayBuffer()),loosePng);
    await assert.rejects(remote.readBlob('root/textures/ui/stub.png'),/BRARCHIVE_ENTRY_STUB/);
    const assets=await(await nativeFetch(base+`/api/node/packs/${id}/assets`,{headers:{'X-JSONUI-Token':capabilities.token}})).json();
    assert(assets.textures.byLower.some(([key])=>key==='textures/ui/virtual.png'));
  } finally { await remote.close(); }
});

// The original user-provided asset is not redistributed with the test suite.
// Opt in with JSONUI_REAL_ITEMS_ARCHIVE pointing to the unchanged v26.45 member.
test('v26.45実items archiveのみのZIPから全466PNGをAPI読込し原本SHA/CRCと照合する',{
  skip:!process.env.JSONUI_REAL_ITEMS_ARCHIVE,
  timeout:30_000,
},async t=>{
  const source=await readFile(process.env.JSONUI_REAL_ITEMS_ARCHIVE);
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const archiveSha256=sha(source);
  assert.equal(archiveSha256,'8d68d6828cc8d5e534f106faf452296db541a9f52c0c3ebb66b4d6a385910f24');
  // Read the pinned original's descriptors independently of BrArchiveReader;
  // deriving expectations through the production parser could mask a bug.
  const count=source.readUInt32LE(8),baseOffset=16+count*256,expected=[];
  assert.equal(count,472);
  for(let i=0;i<count;i++){
    const at=16+i*256,name=source.subarray(at+1,at+1+source[at]).toString('utf8');
    const offset=source.readUInt32LE(at+248),size=source.readUInt32LE(at+252);
    if(name.endsWith('.png'))expected.push({name,bytes:source.subarray(baseOffset+offset,baseOffset+offset+size)});
  }
  assert.equal(expected.length,466);
  const app=await createLocalServer({port:0});
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.port}`;
  const {token}=await(await fetch(base+'/api/node/capabilities')).json();
  const headers={'X-JSONUI-Token':token},id=randomUUID();
  const uploaded=await fetch(base+'/api/node/packs',{method:'POST',headers:{...headers,
    'Content-Type':'application/zip','X-JSONUI-Upload-ID':id,'X-JSONUI-Name':'actual-items-only.zip'},
    body:makeZip({'root/manifest.json':manifest,'root/__brarchive/textures/items.brarchive':source}),
  });
  const metadata=await uploaded.json();assert.equal(uploaded.status,200,JSON.stringify(metadata));
  assert.equal(metadata.zipMeta.entryCount,2);
  assert.equal(metadata.zipMeta.brarchive.mounted,1);
  assert.equal(metadata.zipMeta.brarchive.virtualEntries,472);
  assert.equal(metadata.zipMeta.brarchive.looseFileOverrides,0);
  assert.equal(metadata.entries.filter(e=>e.blockedReason==='BRARCHIVE_ENTRY_STUB').length,1);
  const dimensions={},digest=createHash('sha256');
  for(const {name,bytes}of expected){
    const path='root/textures/items/'+name;
    const entry=metadata.entries.find(e=>e.path===path);
    assert(entry?.virtual,`${name}: virtual metadata`);
    assert.equal(entry.archiveEntry,name);
    const response=await fetch(base+`/api/node/packs/${id}/read?path=${encodeURIComponent(path)}`,{headers});
    assert.equal(response.status,200,`${name}: HTTP status`);
    const actual=Buffer.from(await response.arrayBuffer());
    assert.equal(sha(actual),sha(bytes),`${name}: SHA-256`);
    assert.deepEqual(actual,bytes,`${name}: exact bytes`);
    const image=pngjs.PNG.sync.read(actual,{checkCRC:true}),key=`${image.width}x${image.height}`;
    dimensions[key]=(dimensions[key]||0)+1;
    digest.update(name+'\0'+sha(actual)+'\n');
  }
  assert.deepEqual(dimensions,{'16x16':448,'32x32':16,'16x512':1,'16x1024':1});
  const stub=await fetch(base+`/api/node/packs/${id}/read?path=root%2Ftextures%2Fitems%2Fegg_template.pdn`,{headers});
  assert.equal(stub.status,422);
  assert.match(JSON.stringify(await stub.json()),/BRARCHIVE_ENTRY_STUB/);
  t.diagnostic(JSON.stringify({archiveSha256,physicalZipEntries:metadata.zipMeta.entryCount,
    brarchive:metadata.zipMeta.brarchive,checkedPng:expected.length,dimensions,
    orderedNameAndSha256Digest:digest.digest('hex')}));
});
