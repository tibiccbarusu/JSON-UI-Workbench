import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceZipReader } from '../resource-zip.mjs';
import { BrArchiveReader } from '../brarchive.mjs';
import { DiskZipReader } from '../disk-zip.mjs';
import { LIMITS } from '../limits.mjs';
import { makeZip } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const MiB = 1024 * 1024;
const png = pngjs.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([26, 120, 200, 255]) });
function brarchive(entries, byteLength = 0) {
  const required = 16 + 256 * entries.length + entries.reduce((total, [, bytes]) => total + bytes.length, 0);
  const data = Buffer.alloc(Math.max(required, byteLength));
  data.writeBigUInt64LE(0x267052a0b125277dn); data.writeUInt32LE(entries.length, 8); data.writeUInt32LE(1, 12);
  let offset = 0;
  for (const [index, [name, bytes]] of entries.entries()) {
    const at = 16 + index * 256;
    data[at] = Buffer.byteLength(name); data.write(name, at + 1);
    data.writeUInt32LE(offset, at + 248); data.writeUInt32LE(bytes.length, at + 252);
    bytes.copy(data, 16 + entries.length * 256 + offset); offset += bytes.length;
  }
  return data;
}
async function withReader(files, run, { index = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jsonui-retention37-'));
  const diskPath = join(directory, 'fixture.zip'), reader = new ResourceZipReader();
  try {
    await writeFile(diskPath, makeZip(files));
    await reader.openFromFile({ diskPath, name: 'retention37.zip' });
    await run(reader, index ? await reader.listEntries() : null);
  } finally {
    await reader.close(); await reader.close();
    assert.equal(reader.brReaders.length, 0);
    assert.equal(reader.virtualEntries.size, 0);
    await rm(directory, { recursive: true, force: true });
  }
}

test('R37: 全 shadowed 20 MiB が先でも後続 16 MiB の必要画像を読める', async () => {
  const archives = {
    A: ['pack/__brarchive/textures/a.brarchive', brarchive([['shadow.bin', Buffer.from('archived')]], 20 * MiB)],
    B: ['pack/__brarchive/textures/b.brarchive', brarchive([['needed.png', png]], 16 * MiB)],
  };
  for (const order of ['AB', 'BA']) {
    const files = Object.fromEntries([['pack/textures/a/shadow.bin', Buffer.from('loose')],
      ...Array.from(order, key => archives[key])]);
    await withReader(files, async (reader, result) => {
      assert.deepEqual(await reader.bytes('pack/textures/b/needed.png'), png, order);
      assert.deepEqual([...pngjs.PNG.sync.read(await reader.bytes('pack/textures/b/needed.png')).data], [26, 120, 200, 255]);
      assert.equal((await reader.bytes('pack/textures/a/shadow.bin')).toString(), 'loose');
      assert.equal(result.meta.brarchive.cacheBytes, 16 * MiB);
      assert.equal(result.meta.brarchive.retainedArchives, 1);
      assert.equal(reader.brReaders.length, 1);
      assert.equal(result.meta.brarchive.fullyShadowedArchives, order === 'AB' ? 1 : 0);
      assert.equal(result.meta.brarchive.mounted, order === 'AB' ? 2 : 1);
      assert.equal(result.meta.brarchive.attempted, order === 'AB' ? 2 : 1);
      assert.equal(result.meta.brarchive.readBudgetBytes, (order === 'AB' ? 36 : 16) * MiB);
    });
  }
});

test('R37: 全 shadowed 解放後も 64 MiB 読取予算を巻き戻さない', async () => {
  const files = {};
  for (let index = 0; index < 4; index += 1) {
    files[`pack/textures/p${index}/shadow.bin`] = Buffer.from('loose');
    files[`pack/__brarchive/textures/p${index}.brarchive`] = brarchive([['shadow.bin', Buffer.from('x')]], 20 * MiB);
  }
  await withReader(files, async (_reader, result) => {
    assert.equal(result.meta.brarchive.cacheBytes, 0);
    assert.equal(result.meta.brarchive.retainedArchives, 0);
    assert.equal(result.meta.brarchive.fullyShadowedArchives, 3);
    assert.equal(result.meta.brarchive.attempted, 3);
    assert.equal(result.meta.brarchive.readBudgetBytes, 60 * MiB);
    const warning = result.warnings.find(item => item.code === 'BRARCHIVE_READ_BUDGET_LIMIT');
    assert(warning);
    assert(warning.reasons.includes('read-budget'));
    assert.equal(warning.readLimitBytes, 64 * MiB);
  });
});

test('R37: 全 shadowed 解放後も 128 回試行上限を維持し、空 archive と区別する', async () => {
  const files = { 'pack/__brarchive/textures/empty.brarchive': brarchive([]) };
  for (let index = 0; index < 128; index += 1) {
    files[`pack/textures/p${index}/shadow.bin`] = Buffer.from('loose');
    files[`pack/__brarchive/textures/p${index}.brarchive`] = brarchive([['shadow.bin', Buffer.from('x')]]);
  }
  await withReader(files, async (_reader, result) => {
    assert.equal(result.meta.brarchive.mounted, 128);
    assert.equal(result.meta.brarchive.attempted, 128);
    assert.equal(result.meta.brarchive.fullyShadowedArchives, 127);
    assert.equal(result.meta.brarchive.emptyArchives, 1);
    assert.equal(result.meta.brarchive.releasedArchives, 128);
    assert.equal(result.meta.brarchive.cacheBytes, 0);
    assert(result.warnings.some(item => item.code === 'BRARCHIVE_COUNT_LIMIT'));
  });
});

test('R37: blockedReason と残 cache 不足を別々の診断値として保持する', async () => {
  await withReader({ 'pack/__brarchive/font/huge.brarchive': Buffer.from('placeholder') }, async reader => {
    // Exercise the already-validated DiskZipReader metadata contract without
    // writing a 65 MiB entry; its blocked reader must never be invoked.
    await DiskZipReader.prototype.listEntries.call(reader);
    const info = reader.entryIndex.get('pack/__brarchive/font/huge.brarchive').info;
    info.uncompressedSize = 65 * MiB; info.blockedReason = 'ZIP_ENTRY_READ_LIMIT';
    const result = await reader.listEntries(), warning = result.warnings.find(item => item.code === 'BRARCHIVE_CACHE_LIMIT');
    assert.equal(warning.blockedReason, 'ZIP_ENTRY_READ_LIMIT');
    assert.deepEqual(warning.reasons, ['blocked-entry', 'cache-capacity', 'read-budget']);
    assert.equal(warning.archiveBytes, 65 * MiB);
    assert.equal(result.meta.brarchive.attempted, 0);
  }, { index: false });
});

test('R37: 仮想 entry 件数上限の直前でも archive を部分登録しない', async () => {
  await withReader({ 'pack/__brarchive/textures/ui.brarchive': brarchive([
    ['first.png', png], ['last.png', png],
  ]) }, async reader => {
    await DiskZipReader.prototype.listEntries.call(reader);
    // Inject a near-limit physical index at its established reader boundary;
    // the actual two-entry brarchive is still read and validated from disk.
    for (let index = reader.entryIndex.size; index < LIMITS.entries - 1; index += 1) {
      const path = `pack/other/${index}.bin`;
      reader.entryIndex.set(path, { info: { path, directory: false, uncompressedSize: 0 } });
    }
    const result = await reader.listEntries();
    assert(result.warnings.some(item => item.code === 'BRARCHIVE_RESOURCE_COUNT_LIMIT'));
    assert.equal(result.meta.brarchive.failed, 1);
    assert.equal(result.meta.brarchive.virtualEntries, 0);
    assert.equal(result.meta.brarchive.retainedArchives, 0);
    assert.equal(reader.entryIndex.has('pack/textures/ui/first.png'), false);
    assert.equal(reader.entryIndex.has('pack/textures/ui/last.png'), false);
  }, { index: false });
});

test('R37: 索引化中の close は reader を再保持せず、同時 close も終了する', async () => {
  await withReader({ 'pack/__brarchive/textures/ui.brarchive': brarchive([['needed.png', png]]) }, async reader => {
    const original = BrArchiveReader.fromBytes;
    let unblock, started;
    const gate = new Promise(resolve => { unblock = resolve; });
    const reached = new Promise(resolve => { started = resolve; });
    BrArchiveReader.fromBytes = async (...args) => { started(); await gate; return original.apply(BrArchiveReader, args); };
    try {
      const indexing = reader.listEntries();
      const rejected = assert.rejects(indexing, /ZIP_CLOSED/);
      await reached;
      const closing = reader.close(), repeated = reader.close();
      unblock();
      await Promise.all([rejected, closing, repeated]);
      assert.equal(reader.closed, true);
      assert.equal(reader.entryIndex.size, 0);
      assert.equal(reader.brReaders.length, 0);
      await assert.rejects(reader.listEntries(), /ZIP_CLOSED/);
      await assert.rejects(reader.bytes('pack/textures/ui/needed.png'), /ZIP_CLOSED/);
    } finally { unblock(); BrArchiveReader.fromBytes = original; }
  }, { index: false });
});
