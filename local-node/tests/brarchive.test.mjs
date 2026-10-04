import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrArchiveReader } from '../brarchive.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const png = pngjs.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([70, 90, 130, 255]) });
function archive(entries) {
  const result = Buffer.alloc(16 + entries.length * 256 + entries.reduce((n, e) => n + e[1].length, 0));
  result.writeBigUInt64LE(0x267052a0b125277dn, 0);
  result.writeUInt32LE(entries.length, 8);
  result.writeUInt32LE(1, 12);
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const [name, value] = entries[i], at = 16 + i * 256, nameBytes = Buffer.from(name);
    result[at] = nameBytes.length;
    nameBytes.copy(result, at + 1);
    result.writeUInt32LE(offset, at + 248);
    result.writeUInt32LE(value.length, at + 252);
    value.copy(result, 16 + entries.length * 256 + offset);
    offset += value.length;
  }
  return result;
}
const rejectsCode = (promise, code) => assert.rejects(promise, e => e.code === code);

test('PNG を原本どおりに返し、返却 buffer は source と共有しない', async () => {
  const source = archive([['iron_ingot.png', png]]);
  const reader = await BrArchiveReader.fromBytes(source);
  try {
    assert.equal((await reader.listEntries()).meta.entryCount, 1);
    const bytes = await reader.bytes('iron_ingot.png');
    assert.deepEqual(bytes, png);
    const decoded = pngjs.PNG.sync.read(bytes);
    assert.equal(decoded.width, 1);
    bytes[0] = 0;
    assert.equal((await reader.bytes('iron_ingot.png'))[0], 137);
  } finally { await reader.close(); }
});

test('ランダムアクセスはヘッダー、索引、選択した entry だけを読む', async () => {
  const source = archive([['first.json', Buffer.from('{"x":1}')], ['second.png', png]]);
  const reads = [];
  const reader = await BrArchiveReader.open({ size: source.length,
    async readUint8Array(offset, length) { reads.push([offset, length]); return source.subarray(offset, offset + length); } });
  try {
    assert.deepEqual(reads, [[0, 16], [16, 512]]);
    assert.deepEqual(await reader.bytes('second.png'), png);
    assert.deepEqual(reads.at(-1), [16 + 512 + 7, png.length]);
    assert.equal(await reader.readText('first.json'), '{"x":1}');
  } finally { await reader.close(); }
});

test('diskPath を開いて読み、close 後は拒否する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jsonui-brarchive-'));
  try {
    const path = join(dir, 'images.brarchive');
    await writeFile(path, archive([['image.png', png]]));
    const reader = await BrArchiveReader.open({ diskPath: path, name: 'images.brarchive' });
    assert.equal((await reader.listEntries()).meta.fileName, 'images.brarchive');
    assert.deepEqual(await reader.bytes('image.png'), png);
    await reader.close();
    await reader.close();
    await rejectsCode(reader.bytes('image.png'), 'BRARCHIVE_CLOSED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('共有範囲の重複排除を受理するが、部分的な範囲重複を拒否する', async () => {
  const bytes = archive([['a.json', Buffer.from('abcd')], ['b.json', Buffer.from('abcd')]]);
  bytes.writeUInt32LE(0, 16 + 256 + 248);
  const reader = await BrArchiveReader.fromBytes(bytes);
  try { assert.deepEqual(await reader.bytes('a.json'), await reader.bytes('b.json')); }
  finally { await reader.close(); }
  bytes.writeUInt32LE(1, 16 + 256 + 248);
  await rejectsCode(BrArchiveReader.fromBytes(bytes), 'BRARCHIVE_PARTIAL_OVERLAP');
});

test('ゼロ長項目は索引で示し、JSON 成功にせず stub 診断で拒否する', async () => {
  const reader = await BrArchiveReader.fromBytes(archive([['missing.json', Buffer.alloc(0)]]));
  try {
    const list = await reader.listEntries();
    assert.equal(list.meta.stubCount, 1);
    assert.equal(list.entries[0].blockedReason, 'BRARCHIVE_ENTRY_STUB');
    await rejectsCode(reader.bytes('missing.json'), 'BRARCHIVE_ENTRY_STUB');
  } finally { await reader.close(); }
});

test('未知 archive magic と version は拒否する', async () => {
  const bytes = archive([]);
  bytes[0] ^= 1;
  await rejectsCode(BrArchiveReader.fromBytes(bytes), 'BRARCHIVE_MAGIC_UNSUPPORTED');
  bytes[0] ^= 1;
  bytes.writeUInt32LE(2, 12);
  await rejectsCode(BrArchiveReader.fromBytes(bytes), 'BRARCHIVE_VERSION_UNSUPPORTED');
});

test('索引と entry の切断・範囲外を拒否する', async () => {
  await rejectsCode(BrArchiveReader.fromBytes(Buffer.alloc(15)), 'BRARCHIVE_HEADER_TRUNCATED');
  const bytes = archive([['a.json', Buffer.from('{}')]]);
  await rejectsCode(BrArchiveReader.fromBytes(bytes.subarray(0, 32)), 'BRARCHIVE_INDEX_TRUNCATED');
  bytes.writeUInt32LE(0xffffffff, 16 + 248);
  await rejectsCode(BrArchiveReader.fromBytes(bytes), 'BRARCHIVE_ENTRY_RANGE');
});

test('過大件数・索引・入力サイズを読込前に拒否する', async () => {
  const bytes = archive([['a.json', Buffer.from('{}')]]);
  await rejectsCode(BrArchiveReader.fromBytes(bytes, { entries: 0 }), 'BRARCHIVE_ENTRY_COUNT_LIMIT');
  await rejectsCode(BrArchiveReader.fromBytes(bytes, { indexBytes: 255 }), 'BRARCHIVE_INDEX_LIMIT');
  await rejectsCode(BrArchiveReader.fromBytes(bytes, { archiveBytes: 16 }), 'BRARCHIVE_SIZE_LIMIT');
});

test('単一 entry と総量上限を守り、読取上限で制限した項目は索引に残る', async () => {
  const bytes = archive([['a.json', Buffer.from('{"value":1}')]]);
  await rejectsCode(BrArchiveReader.fromBytes(bytes, { totalBytes: 2 }), 'BRARCHIVE_TOTAL_LIMIT');
  const reader = await BrArchiveReader.fromBytes(bytes, { entryBytes: 2 });
  try {
    assert.equal((await reader.listEntries()).meta.blockedReadCount, 1);
    await rejectsCode(reader.bytes('a.json'), 'BRARCHIVE_ENTRY_READ_LIMIT');
    await rejectsCode(reader.bytes('a.json', -1), 'BRARCHIVE_LIMIT_INVALID');
  } finally { await reader.close(); }
});

test('呼出側 maxBytes と存在しない entry を診断する', async () => {
  const reader = await BrArchiveReader.fromBytes(archive([['image.png', png]]));
  try {
    await rejectsCode(reader.bytes('image.png', 8), 'BRARCHIVE_ENTRY_READ_LIMIT');
    await rejectsCode(reader.bytes('missing.png'), 'BRARCHIVE_ENTRY_NOT_FOUND');
  } finally { await reader.close(); }
});

test('パストラバーサル・Windows 不正名・衝突を拒否する', async () => {
  for (const name of ['../x', 'a/../x', '/x', 'a\\x', 'C:x', 'http:x', 'a//x', './x', 'NUL.png', 'x.', 'x ', 'a\u0000b'])
    await rejectsCode(BrArchiveReader.fromBytes(archive([[name, Buffer.from('{}')]])), 'BRARCHIVE_PATH_UNSAFE');
  for (const pair of [['A.json', 'a.json'], ['é.json', 'e\u0301.json']])
    await rejectsCode(BrArchiveReader.fromBytes(archive(pair.map(n => [n, Buffer.from('{}')]))), 'BRARCHIVE_PATH_COLLISION');
});

test('不正な UTF-8 名・宣言名長を拒否する', async () => {
  const bytes = archive([['a.json', Buffer.from('{}')]]);
  bytes[17] = 0xff;
  await rejectsCode(BrArchiveReader.fromBytes(bytes), 'BRARCHIVE_NAME_ENCODING_INVALID');
  bytes[16] = 248;
  await rejectsCode(BrArchiveReader.fromBytes(bytes), 'BRARCHIVE_NAME_LENGTH_INVALID');
});

test('借用 source の短い読み取りと過大返却を拒否する', async () => {
  for (const delta of [-1, 1]) {
    await rejectsCode(BrArchiveReader.open({ size: 100,
      readUint8Array: async (_offset, length) => Buffer.alloc(length + delta) }), 'BRARCHIVE_TRUNCATED');
  }
});

test('MCB と圧縮内容を変換せず診断で拒否する', async () => {
  const cases = [
    ['a.json', Buffer.from([0x7f, 0x4d, 0x43, 0x42, 1]), 'BRARCHIVE_MCB_UNSUPPORTED'],
    ['a.json', Buffer.from([0x1f, 0x8b, 8, 0]), 'BRARCHIVE_COMPRESSED_CONTENT_UNSUPPORTED'],
    ['a.png', Buffer.from([0x78, 0x9c, 0, 0]), 'BRARCHIVE_COMPRESSED_CONTENT_UNSUPPORTED'],
    ['a.json', Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), 'BRARCHIVE_COMPRESSED_CONTENT_UNSUPPORTED'],
  ];
  for (const [name, value, code] of cases) {
    const reader = await BrArchiveReader.fromBytes(archive([[name, value]]));
    try { await rejectsCode(reader.bytes(name), code); }
    finally { await reader.close(); }
  }
});

test('PNG/JPEG 拡張子だけで非画像を成功にせず、binary text も拒否する', async () => {
  for (const [name, value, code] of [
    ['a.png', Buffer.from('not a PNG'), 'BRARCHIVE_PNG_SIGNATURE_INVALID'],
    ['a.jpg', Buffer.from('not a JPEG'), 'BRARCHIVE_JPEG_SIGNATURE_INVALID'],
    ['a.json', Buffer.from([255]), 'BRARCHIVE_TEXT_ENCODING_INVALID'],
    ['a.json', Buffer.from([0, 0, 1]), 'BRARCHIVE_TEXT_BINARY_UNSUPPORTED'],
  ]) {
    const reader = await BrArchiveReader.fromBytes(archive([[name, value]]));
    try { await rejectsCode(reader.bytes(name), code); }
    finally { await reader.close(); }
  }
});

test('close は借用 source の所有権を奪わない', async () => {
  const bytes = archive([]); let closes = 0;
  const reader = await BrArchiveReader.open({ size: bytes.length,
    readUint8Array: async (o, n) => bytes.subarray(o, o + n), close() { closes++; } });
  await reader.close();
  assert.equal(closes, 0);
});
