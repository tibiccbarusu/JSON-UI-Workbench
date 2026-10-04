import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiskReader, DiskZipReader } from '../disk-zip.mjs';
import { createLocalServer } from '../server.mjs';
import { checkedValidationRequest, buildValidationSourceContext, validateProjectionDocument } from '../validation.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const sourceFiles = {
  'root/manifest.json': manifest,
  'root/ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/base.json', 'ui/screen.json'] }),
  'root/ui/_global_variables.json': JSON.stringify({ '$known': true }),
  'root/ui/base.json': JSON.stringify({ namespace: 'base', panel: { type: 'panel', size: [40, 30] } }),
  'root/ui/screen.json': JSON.stringify({ namespace: 'validation06', 'screen@base.panel': { type: 'screen', controls: [
    { label: { type: 'label', text: '#title', bindings: [{ binding_name: '#title', binding_name_override: '#text' }] } },
    { image: { type: 'image', size: [10, 10], texture: '#texture', bindings: [{ binding_name: '#texture', binding_name_override: '#texture' }] } },
  ] }, pocket: { type: 'screen', '$pocket_screen': true } }),
  'root/textures/ui/pixel.png': Buffer.from([137, 80, 78, 71]),
  'root/texts/en_US.lang': 'test.valid=Known\n',
  'root/texts/ja_JP.lang': 'test.valid=既知\n',
};

test('ZIP小read: キャッシュ命中でも入力範囲・返却byte・変更分離を維持', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-disk06-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = Buffer.from(Array.from({ length: 400000 }, (_, i) => i % 251)), file = path.join(directory, 'bytes.bin');
  await writeFile(file, data); const handle = await open(file); t.after(() => handle.close());
  const reader = new DiskReader(handle, data.length);
  for (const [offset, length] of [[0, 0], [10, 30], [65530, 30], [65535, 1], [65536, 200], [399999, 1], [100, 100000]]) {
    const actual = await reader.readUint8Array(offset, length);
    assert.deepEqual(actual, data.subarray(offset, offset + length));
    assert.equal(actual.byteOffset, 0, 'zip.js backing DataView compatibility');
  }
  const first = await reader.readUint8Array(10, 30); first.fill(0);
  assert.deepEqual(await reader.readUint8Array(10, 30), data.subarray(10, 40));
  const before = reader.snapshot().physical_reads;
  for (const [offset, length] of [[-1, 1], [data.length, 1], [0, Infinity], [1.5, 1]]) await assert.rejects(reader.readUint8Array(offset, length), /ZIP_READ_RANGE/);
  assert.equal(reader.snapshot().physical_reads, before);
  for (let i = 0; i < 6; i++) await reader.readUint8Array(i * 65536, 1);
  assert(reader.snapshot().small_read_hits > 0); assert(reader.snapshot().cache_bytes <= 256 * 1024);
  reader.clear(); assert.equal(reader.snapshot().cache_bytes, 0);
});

test('ZIP小read: 短いOS readを連結しtruncated/OS例外を保持', async () => {
  const original = Buffer.from('0123456789'); let calls = 0;
  const partial = new DiskReader({ async read(buffer, offset, length, position) { calls++; const n = Math.min(length, 3, original.length - position); original.copy(buffer, offset, position, position + n); return { bytesRead: n }; } }, original.length);
  assert.equal((await partial.readUint8Array(2, 5)).toString(), '23456'); assert.equal(calls, 4);
  const truncated = new DiskReader({ read: async () => ({ bytesRead: 0 }) }, 20);
  await assert.rejects(truncated.readUint8Array(0, 1), /ZIP_TRUNCATED/); assert.equal(truncated.snapshot().cache_bytes, 0);
  const failed = new DiskReader({ read: async () => { throw new Error('OS_READ_FAILED'); } }, 20);
  await assert.rejects(failed.readUint8Array(0, 1), /OS_READ_FAILED/); assert.equal(failed.snapshot().cache_bytes, 0);
});

test('ZIP小read: 散在索引のread-aheadは16MiBで停止し要求範囲readへ戻る', async () => {
  const reads = [], reader = new DiskReader({ async read(_buffer, _offset, length, position) {
    reads.push({ length, position }); return { bytesRead: length };
  } }, 64 * 1024 * 1024);
  for (let i = 0; i < 300; i++) await reader.readUint8Array(i * 65536, 30);
  const stats = reader.snapshot();
  assert.equal(stats.read_ahead_bytes, 16 * 1024 * 1024);
  assert.equal(stats.read_ahead_exhausted, 44);
  assert.equal(reads.at(-1).length, 30);
  assert(stats.cache_bytes <= 256 * 1024);
});

test('ZIP小read: 密な2000entryのcache有無で全索引/内容が同じ、物理readを削減', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-zip06-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`textures/ui/a${i}.txt`, `value${i}`]));
  const archive = makeZip(files), file = path.join(directory, 'dense.zip'); await writeFile(file, archive);
  const readers = [new DiskZipReader({ cachePages: 0 }), new DiskZipReader()]; t.after(() => Promise.all(readers.map(r => r.close())));
  const snapshots = [];
  for (const r of readers) { await r.openFromFile({ diskPath: file, name: 'dense.zip' }); await r.listEntries(); snapshots.push(r.reader.snapshot()); }
  assert.deepEqual([...readers[0].entryIndex].map(([, v]) => v.info), [...readers[1].entryIndex].map(([, v]) => v.info));
  assert(snapshots[1].physical_reads < snapshots[0].physical_reads / 10, JSON.stringify(snapshots));
  for (const name of ['textures/ui/a0.txt', 'textures/ui/a999.txt', 'textures/ui/a1999.txt']) assert.equal((await readers[1].bytes(name)).toString(), files[name]);
  await assert.rejects(readers[1].bytes('textures/ui/a0.txt', 1), /ZIP_ENTRY_READ_LIMIT/);
});

test('Worker validate HTTP: projection-only入力、binding/state/locale差分、同一要求cache、世代失効', async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`, cap = await (await fetch(base + 'capabilities')).json();
  assert.equal(cap.features.validation, true);
  const headers = { 'Content-Type': 'application/json', 'X-JSONUI-Token': cap.token };
  const post = (route, body, more = {}) => fetch(base + route, { method: 'POST', headers: { ...headers, ...more }, body: JSON.stringify(body) });
  const packId = randomUUID(), zip = makeZip(sourceFiles);
  const upload = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': packId }, body: zip });
  assert.equal(upload.status, 200); await upload.arrayBuffer();
  const sources = [{ id: packId, kind: 'imported' }];
  const catalog = await (await post('catalog', { sources })).json(), selected = catalog.records.find(r => r.qualifiedName === 'validation06.screen');
  const projection = await (await post('project', { catalogId: catalog.nodeCatalogId, recordId: selected.id })).json();
  const request = { projectionId: projection.nodeProjectionId, filePath: selected.filePath, recordId: selected.id,
    mockData: { '#title': 'test.valid', '#texture': 'textures/ui/pixel' }, locale: 'en_US' };
  const first = await post('validate', request); assert.equal(first.status, 200); const data = await first.json();
  assert.equal(data.metrics.processing, 'node-worker'); assert.equal(data.schema, 'jsonui-validation-v1');
  const repeated = await (await post('validate', request)).json(); assert.deepEqual(repeated, data);
  assert.equal(app.processor.snapshot().caches.validation.builds, 1);
  const missing = await (await post('validate', { ...request, mockData: { '#title': 'test.absent', '#texture': 'textures/ui/absent' } })).json();
  assert(missing.validation.issues.some(i => i.refValue === 'textures/ui/absent'));
  assert.notEqual(missing.validation.signature, data.validation.signature);
  const locale = await (await post('validate', { ...request, locale: 'ja_JP' })).json(); assert.equal(locale.schema, data.schema);
  assert.equal(app.processor.snapshot().caches.validation.source_builds, 2);
  assert.equal((await post('validate', { ...request, filePath: 'ui/wrong.json' })).status, 409);
  assert.equal((await post('validate', request, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post('validate', request, { 'X-JSONUI-Token': 'wrong' })).status, 401);
  assert.equal((await post('validate', { ...request, mockData: { text: 'x'.repeat(1024 * 1024) } })).status, 413);
  const pocket = catalog.records.find(r => r.localName === 'pocket'); assert.equal((await post('project', { catalogId: catalog.nodeCatalogId, recordId: pocket.id })).status, 422);
  await (await post('catalog', { sources: [{ ...sources[0], overrides: { 'texts/en_US.lang': 'test.changed=Changed' } }] })).arrayBuffer();
  const stale = await post('validate', request); assert.equal(stale.status, 409); assert.equal((await stale.json()).error, 'NODE_FRAME_PROJECTION_STALE');
});

test('Worker validate境界: 不正context・未知入力・localeを拒否しnative状態を結果へ反映', async () => {
  for (const request of [{ unknown: 1 }, { mockData: [] }, { locale: '../ja' }, { nativeTextureFailures: { x: 5 } }, { nativeModelPreviews: [] }]) assert.throws(() => checkedValidationRequest(request), /NODE_VALIDATION_/);
  assert.throws(() => checkedValidationRequest({ nativeModelPreviews: { large: 'x'.repeat(128 * 1024) } }), /NODE_VALIDATION_NATIVE_LIMIT/);
  const projection = { selected: { qualifiedName: 'test.screen' }, document: { namespace: 'test', screen: { type: 'screen', controls: [{ book: { type: 'custom', renderer: 'enchanting_book_renderer', size: [30, 30] } }] } } };
  const item = { packPaths: ['textures/entity/enchanting_table_book.png'], rootPrefix: '', zipReader: { readText: async () => { throw new Error('UNEXPECTED_READ'); } } };
  const source = await buildValidationSourceContext([{ kind: 'imported', id: 'x' }], () => item, {}, 'en_US');
  const request = checkedValidationRequest({ filePath: 'ui/test.json' });
  const ready = validateProjectionDocument(projection, request, source.context);
  const failed = validateProjectionDocument(projection, { ...request, nativeTextureFailures: { 'imported:textures/entity/enchanting_table_book.png': 'TEXTURE_DECODE_FAILED' } }, source.context);
  assert.notEqual(ready.signature, failed.signature);
});
