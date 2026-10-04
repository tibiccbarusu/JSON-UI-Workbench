/** Rebuild the small demo with Node only. Fixed ZIP order/timestamps, no network. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { glyphPatterns } from './glyph-patterns.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const pack = path.join(directory, 'pack');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length); name.copy(result, 4); bytes.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, bytes])), bytes.length + 8); return result;
}
function png(width, height, rgba) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level:9 })), chunk('IEND', Buffer.alloc(0))]);
}
async function writeAsset(relative, bytes) {
  const filename = path.join(pack, relative); await mkdir(path.dirname(filename), { recursive:true }); await writeFile(filename, bytes);
}
async function buildAssets() {
  const sheets = new Map([['00', Buffer.alloc(128 * 128 * 4)], ['30', Buffer.alloc(128 * 128 * 4)]]);
  for (const [character, pattern] of Object.entries(glyphPatterns)) {
    const cp = character.codePointAt(0), sheet = sheets.get((cp >>> 8).toString(16).padStart(2, '0').toUpperCase());
    if (!sheet) throw new Error('Unexpected demo glyph sheet');
    const rows = pattern.split('/');
    if (rows.length > 8 || rows.some(row => row.length > 8 || /[^.X]/u.test(row))) throw new Error('Invalid authored glyph');
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === 'X') {
      const at = (((cp & 255) >>> 4) * 8 + y) * 128 * 4 + (((cp & 15) * 8 + x) * 4); sheet.fill(255, at, at + 4);
    }
  }
  for (const [name, bytes] of sheets) await writeAsset(`font/glyph_${name}.png`, png(128, 128, bytes));
  for (const [name, inside, edge] of [['panel', [23,35,50,255], [64,94,122,255]], ['button', [30,83,105,255], [92,173,193,255]], ['input', [13,22,34,255], [97,122,145,255]]]) {
    const data = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) data.set(x === 0 || y === 0 || x === 15 || y === 15 ? edge : inside, (y * 16 + x) * 4);
    await writeAsset(`textures/demo/${name}.png`, png(16,16,data));
  }
}
async function pathsIn(directory, prefix = '') {
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) rows.push(...await pathsIn(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) rows.push(relative);
    else throw new Error('Demo archive must contain ordinary files only');
  }
  return rows.sort();
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [filename, bytes] of entries) {
    const name = Buffer.from(filename), crc = crc32(bytes), header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6); header.writeUInt16LE(33,12);
    header.writeUInt32LE(crc,14); header.writeUInt32LE(bytes.length,18); header.writeUInt32LE(bytes.length,22); header.writeUInt16LE(name.length,26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20,4); record.writeUInt16LE(20,6); record.writeUInt16LE(0x800,8); record.writeUInt16LE(33,14);
    record.writeUInt32LE(crc,16); record.writeUInt32LE(bytes.length,20); record.writeUInt32LE(bytes.length,24); record.writeUInt16LE(name.length,28); record.writeUInt32LE(offset,42);
    local.push(header,name,bytes); central.push(record,name); offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

await buildAssets();
const audio = await readFile(path.join(pack, 'sounds/demo/click.ogg'));
if (createHash('sha256').update(audio).digest('hex') !== 'b7d74fa60fc9799f0ab352a7c47acc5bbda2d6697f922254ac105eba10d228e6') throw new Error('Artificial fixture audio changed; review attribution before rebuilding');
const entries = await Promise.all((await pathsIn(pack)).map(async filename => [filename, await readFile(path.join(pack, filename))]));
const archive = zip(entries), output = path.join(directory, 'jsonui-revision12-demo.zip'); await writeFile(output, archive);
const digest = createHash('sha256').update(archive).digest('hex');
await writeFile(path.join(directory, 'jsonui-revision12-demo.zip.sha256'), `${digest}  jsonui-revision12-demo.zip\n`);
process.stdout.write(`${path.basename(output)}: ${archive.length} bytes, SHA-256 ${digest}\n`);
