import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { CliClient } from '../cli-client.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { AddonResourceReader } from '../addon-resource38.mjs';
import { importResourcePackZip } from '../../editor-core/src/pack-io/pack-importer.js';
import { LIMITS } from '../limits.mjs';

function files(type = 'resources', options = {}) {
  const value = JSON.parse(manifest); value.header.uuid = options.uuid || randomUUID(); value.modules[0].uuid = randomUUID(); value.modules[0].type = type;
  return { 'manifest.json': JSON.stringify(value), ...(type === 'resources'
    ? { 'ui/test.json': '{"namespace":"test","first":{"type":"panel"},"second":{"type":"screen"}}' }
    : { 'scripts/main.js': 'throw new Error("MUST NEVER EXECUTE");' }), ...options.files };
}
async function fixture(t, bytes, resourcePack) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-addon38-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'input.mcaddon'); await writeFile(filename, bytes);
  const reader = new AddonResourceReader({ resourcePack }); t.after(() => reader.close());
  return { filename, bytes, reader, file: { diskPath: filename, name: 'input.mcaddon', size: bytes.length } };
}
async function imported(t, bytes, selection) {
  const value = await fixture(t, bytes, selection), result = await importResourcePackZip(value.file, { zipReader: value.reader });
  return { ...value, result };
}
function declaredExpanded(bytes, key, expanded) {
  const copy = Buffer.from(bytes); let at = copy.readUInt32LE(copy.length - 6);
  while (copy.readUInt32LE(at) === 0x02014b50) {
    const length = copy.readUInt16LE(at + 28), name = copy.toString('utf8', at + 46, at + 46 + length);
    if (name === key) { copy.writeUInt32LE(expanded, at + 24); copy.writeUInt32LE(expanded, copy.readUInt32LE(at + 42) + 22); return copy; }
    at += 46 + length + copy.readUInt16LE(at + 30) + copy.readUInt16LE(at + 32);
  }
  throw new Error('fixture path absent');
}

test('MCADDONはRPを選択しBP scriptを非実行・非公開に保ち二重階層予算/hashを記録', async t => {
  const rp = makeZip(files()), bp = makeZip(files('data'));
  const { result, bytes, reader } = await imported(t, makeZip({ 'rp.mcpack': rp, 'bp.mcpack': bp }));
  assert.equal(result.ok, true, result.error?.message); assert.deepEqual(result.packPaths.sort(), ['manifest.json', 'ui/test.json']);
  const provenance = result.zipMeta.container;
  assert.equal(provenance.container_sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(provenance.resource_pack_sha256, createHash('sha256').update(rp).digest('hex'));
  assert.equal(provenance.behavior_scripts_executed, false); assert.equal(provenance.budgets.entries, 6);
  assert.equal(provenance.budgets.nestedArchives, 2); assert.equal(provenance.budgets.nestedReadBytes, 2 * rp.length + bp.length);
  await assert.rejects(reader.bytes('scripts/main.js'), { code: 'ZIP_ENTRY_NOT_FOUND' });
});

test('複数RPは黙って一つを選ばず候補を返しUUID選択のみを受理', async t => {
  const one = files(), two = files(), uuid = JSON.parse(two['manifest.json']).header.uuid;
  const bytes = makeZip({ 'a.mcpack': makeZip(one), 'b.mcpack': makeZip(two) });
  const ambiguous = await imported(t, bytes); assert.equal(ambiguous.result.ok, false);
  assert.equal(ambiguous.result.error.code, 'ADDON_RESOURCE_SELECTION_REQUIRED'); assert.equal(ambiguous.result.error.addonCandidates.length, 2);
  const selected = await imported(t, bytes, uuid); assert.equal(selected.result.ok, true); assert.equal(selected.result.zipMeta.container.resource_pack_uuid, uuid);
  const missing = await imported(t, bytes, randomUUID()); assert.equal(missing.result.error.code, 'ADDON_RESOURCE_SELECTION_NOT_FOUND');
});

test('長いRP pathでも候補UUIDは省略せず表示pathだけ有限長へ切り詰める', async t => {
  const prefix = Array.from({ length: 13 }, () => 'a'.repeat(40)).join('/') + '/', combined = {};
  for (const [key, value] of Object.entries(files())) combined[prefix + 'one/' + key] = value;
  const selected = files(), uuid = JSON.parse(selected['manifest.json']).header.uuid;
  for (const [key, value] of Object.entries(selected)) combined[prefix + 'two/' + key] = value;
  const bytes = makeZip(combined), ambiguous = await imported(t, bytes);
  assert.equal(ambiguous.result.error.code, 'ADDON_RESOURCE_SELECTION_REQUIRED');
  assert.equal(ambiguous.result.error.addonCandidates.length, 2);
  assert(ambiguous.result.error.addonCandidates.every(item => item.path.length === 512 && item.path_truncated));
  const chosen = await imported(t, bytes, uuid); assert.equal(chosen.result.ok, true, chosen.result.error?.message);
  assert.equal(chosen.result.zipMeta.container.resource_pack_uuid, uuid);
});

test('directory型MCADDONでも選択RP以外のpathsを公開しない', async t => {
  const rp = files(), bp = files('data'), combined = {};
  for (const [key, value] of Object.entries(rp)) combined['rp/' + key] = value;
  for (const [key, value] of Object.entries(bp)) combined['bp/' + key] = value;
  const { result, reader } = await imported(t, makeZip(combined));
  assert.equal(result.ok, true, result.error?.message); assert.equal(result.rootPrefix, 'rp/'); assert.equal(reader.entryIndex.size, 2);
  await assert.rejects(reader.bytes('bp/scripts/main.js'), { code: 'ZIP_ENTRY_NOT_FOUND' });
  assert.equal(result.zipMeta.container.resource_hash_scope, 'directory-manifest-only');
});

test('directory型の選択外BP assetsはRPのbrarchive予算と診断を消費しない', async t => {
  const combined = {}, payload = Buffer.from('{"namespace":"scoped","screen":{"type":"panel"}}');
  for (const [key, value] of Object.entries(files('data'))) combined['bp/' + key] = value;
  for (let index = 0; index < 128; index++) combined[`bp/__brarchive/ui/invalid${index}.brarchive`] = 'invalid archive';
  combined['bp/large.bin'] = 'x';
  for (const [key, value] of Object.entries(files())) combined['rp/' + key] = value;
  const archive = Buffer.alloc(272 + payload.length), name = Buffer.from('virtual.json');
  archive.writeBigUInt64LE(0x267052a0b125277dn, 0); archive.writeUInt32LE(1, 8); archive.writeUInt32LE(1, 12);
  archive[16] = name.length; name.copy(archive, 17); archive.writeUInt32LE(payload.length, 268); payload.copy(archive, 272);
  combined['rp/__brarchive/ui.brarchive'] = archive;
  const { result, reader } = await imported(t, declaredExpanded(makeZip(combined), 'bp/large.bin', LIMITS.entryBytes + 1));
  assert.equal(result.ok, true, result.error?.message); assert.deepEqual(result.zipWarnings, []);
  assert.equal(result.zipMeta.brarchive.seen, 1); assert.equal(result.zipMeta.brarchive.attempted, 1);
  assert.equal(await reader.readText('rp/ui/virtual.json'), payload.toString());
  assert.equal(result.zipMeta.container.budgets.entries, Object.keys(combined).length + 1);
  assert(result.zipMeta.container.budgets.expandedBytes > LIMITS.entryBytes);
  await assert.rejects(reader.bytes('bp/large.bin'), { code: 'ZIP_ENTRY_NOT_FOUND' });
});

for (const [name, bytes, code] of [
  ['RPなし', () => makeZip({ 'bp.mcpack': makeZip(files('data')) }), 'ADDON_RESOURCE_PACK_NOT_FOUND'],
  ['manifest破損', () => makeZip({ 'rp.mcpack': makeZip({ 'manifest.json': '{broken' }) }), 'ADDON_MANIFEST_PARSE_FAILED'],
  ['manifest欠落', () => makeZip({ 'rp.mcpack': makeZip({ 'ui/test.json': '{}' }) }), 'ADDON_MANIFEST_MISSING'],
  ['UUID衝突', () => { const duplicate = makeZip(files()); return makeZip({ 'a.mcpack': duplicate, 'b.mcpack': duplicate }); }, 'ADDON_UUID_COLLISION'],
  ['path traversal', () => makeZip({ '../rp.mcpack': makeZip(files()) }), 'ZIP_PATH_TRAVERSAL'],
  ['名前衝突', () => makeZip({ 'RP.mcpack': makeZip(files()), 'rp.mcpack': makeZip(files()) }), 'ZIP_PATH_COLLISION'],
  ['nested名前衝突', () => makeZip({ 'rp.mcpack': makeZip({ ...files(), 'UI/A.json': '{}', 'ui/a.json': '{}' }) }), 'ZIP_PATH_COLLISION'],
  ['symbolic link', () => makeZip({ 'rp.mcpack': makeZip(files()) }, { attributes: 0xa1ff0000, system: 3 }), 'ZIP_SPECIAL_FILE_UNSUPPORTED'],
  ['nested symbolic link', () => makeZip({ 'rp.mcpack': makeZip(files(), { attributes: 0xa1ff0000, system: 3 }) }), 'ZIP_SPECIAL_FILE_UNSUPPORTED'],
  ['depth超過', () => makeZip({ 'outer.mcpack': makeZip({ ...files(), 'inner.mcpack': makeZip(files()) }) }), 'ADDON_NESTING_DEPTH_LIMIT'],
  ['nested64MiB超過', () => declaredExpanded(makeZip({ 'rp.mcpack': 'x' }), 'rp.mcpack', LIMITS.entryBytes + 1), 'ADDON_NESTED_SIZE_LIMIT'],
  ['nested圧縮率超過', () => declaredExpanded(makeZip({ 'rp.mcpack': 'x' }), 'rp.mcpack', LIMITS.ratioFloor), 'ZIP_ENTRY_COMPRESSION_RATIO'],
  ['階層合算2GiB超過', () => makeZip({ 'a.mcpack': declaredExpanded(makeZip(files('resources', { files: { 'large.bin': 'x' } })), 'large.bin', 1024 ** 3),
    'b.mcpack': declaredExpanded(makeZip(files('data', { files: { 'large.bin': 'x' } })), 'large.bin', 1024 ** 3) }), 'ADDON_EXPANDED_TOTAL_LIMIT'],
]) test(`MCADDON ${name}は有限検査で拒否`, async t => {
  const { result } = await imported(t, bytes()); assert.equal(result.ok, false); assert.equal(result.error.code || result.error.message, code);
});

test('HTTP/CLI共通入口の選択候補・失敗cleanup・再開時同一RPを検証', { timeout: 20000 }, async t => {
  const one = files(), two = files(), uuid = JSON.parse(two['manifest.json']).header.uuid;
  const { filename } = await fixture(t, makeZip({ 'a.mcpack': makeZip(one), 'b.mcpack': makeZip(two) }));
  const client = await CliClient.start(); t.after(() => client.close());
  await assert.rejects(client.importPack(filename), error => error.code === 'ADDON_RESOURCE_SELECTION_REQUIRED' && error.context.response.candidates.length === 2);
  const selected = await client.importPack(filename, null, { resourcePack: uuid });
  assert.equal(selected.source.resource_pack_uuid, uuid);
  const restored = await client.importPack(filename, selected.source); assert.equal(restored.source.resource_pack_uuid, uuid);
  assert.equal(restored.source.resource_pack_sha256, selected.source.resource_pack_sha256);
  const catalog = await client.request('/api/node/catalog', { payload: { sources: [{ id: restored.id, kind: 'imported' }] } });
  assert.equal(catalog.records.length, 2);
  const evidence = await client.request('/api/node/debug-bundle', { payload: { schema: 'jsonui-debug-request-v1' } });
  assert.equal(evidence.server.packs.length, 2);
});
