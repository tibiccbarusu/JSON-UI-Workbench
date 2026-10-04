export function crc32(bytes) { let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
export function makeZip(files, { attributes=0, system=0, flags=0x800, method=0, descriptor=false, descriptorSignature=true }={}) {
  if(descriptor)flags|=8;
  const local=[],central=[];let offset=0;
  for(const [name,value]of Object.entries(files)){
    const n=Buffer.from(name),v=Buffer.isBuffer(value)?value:Buffer.from(value),crc=crc32(v);
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(flags,6);l.writeUInt16LE(method,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(v.length,18);l.writeUInt32LE(v.length,22);l.writeUInt16LE(n.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE((system<<8)|20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(flags,8);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(v.length,20);c.writeUInt32LE(v.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(attributes>>>0,38);c.writeUInt32LE(offset,42);
    let d=Buffer.alloc(0);
    if(descriptor){d=Buffer.alloc(descriptorSignature?16:12);const at=descriptorSignature?4:0;if(at)d.writeUInt32LE(0x08074b50);d.writeUInt32LE(crc,at);d.writeUInt32LE(v.length,at+4);d.writeUInt32LE(v.length,at+8);l.fill(0,14,26);}
    local.push(Buffer.concat([l,n,v,d]));central.push(c,n);offset+=l.length+n.length+v.length+d.length;
  }
  const d=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(local.length,8);end.writeUInt16LE(local.length,10);end.writeUInt32LE(d.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,d,end]);
}
export const manifest=JSON.stringify({format_version:2,header:{name:'テスト',description:'ローカル検証',uuid:'b4a776e1-9e54-4c09-b12e-f9c1ad896218',version:[1,0,0],min_engine_version:[1,21,0]},modules:[{type:'resources',uuid:'d6cc30c3-647d-4808-afc5-e46280911ddf',version:[1,0,0]}]});
export function withZip64End(bytes,declaredSize=44,extension=0){
  const b=Buffer.from(bytes),at=b.length-22,end=b.subarray(at),large=Buffer.alloc(56+extension);
  large.writeUInt32LE(0x06064b50);large.writeBigUInt64LE(BigInt(declaredSize),4);large.writeUInt16LE(45,12);large.writeUInt16LE(45,14);
  large.writeBigUInt64LE(BigInt(end.readUInt16LE(8)),24);large.writeBigUInt64LE(BigInt(end.readUInt16LE(10)),32);large.writeBigUInt64LE(BigInt(end.readUInt32LE(12)),40);large.writeBigUInt64LE(BigInt(end.readUInt32LE(16)),48);
  const locator=Buffer.alloc(20);locator.writeUInt32LE(0x07064b50);locator.writeBigUInt64LE(BigInt(at),8);locator.writeUInt32LE(1,16);
  end.writeUInt16LE(0xffff,8);end.writeUInt16LE(0xffff,10);end.writeUInt32LE(0xffffffff,12);end.writeUInt32LE(0xffffffff,16);
  return Buffer.concat([b.subarray(0,at),large,locator,end]);
}
export function resourceFixture(){return makeZip({'root/manifest.json':manifest,'root/ui/_ui_defs.json':'{"ui_defs":["ui/base.json","ui/example.json"]}',
  'root/ui/base.json':'{"namespace":"common","base":{"type":"panel","size":[40,30]}}',
  'root/ui/example.json':JSON.stringify({namespace:'test','screen@common.base':{type:'screen',controls:[{label:{type:'label',text:'local text'}}]},other:{type:'screen',size:[20,10]},pocket:{type:'screen',$pocket_screen:true}}),
  'root/textures/ui/pixel.png':Buffer.from([137,80,78,71])});}
