import test from 'node:test';
import assert from 'node:assert/strict';
import '../../editor-core/tests/suite-packsource.js';
import '../../editor-core/tests/suite-path.js';
import '../../editor-core/tests/suite-security.js';
import '../../editor-core/tests/suite-export-contract.js';
import { getRegisteredTests } from '../../editor-core/tests/test-harness.js';
import { importResourcePackZip } from '../../editor-core/src/pack-io/pack-importer.js';
import { extractManifestSummary, validateManifest } from '../../editor-core/src/pack-io/manifest-utils.js';
import { buildPackFileIndexSummary, derivePackPaths } from '../../editor-core/src/pack-io/pack-indexer.js';
import { FallbackPackSource } from '../../editor-core/src/pack-io/fallback-pack-source.js';
import { makePackError } from '../../editor-core/src/pack-io/pack-source.js';
for (const item of getRegisteredTests()) test(item.name, { timeout: 5000 }, item.fn);
const manifest = type => ({ format_version: 2, header: { name: 'Root', description: 'Fixture', uuid: '1'.repeat(8)+'-1111-1111-1111-111111111111', version: [1, 2, 3] }, modules: [{ type, uuid: '2'.repeat(8)+'-2222-2222-2222-222222222222', version: [1, 0, 0] }] });
function zipFixture(files) {
  let closed = false;
  return { openFromFile: async () => {}, listEntries: async () => ({ meta: { entryCount: Object.keys(files).length, zipBytes: 100 }, warnings: [] }), listAllFilePaths: async () => Object.keys(files), readText: async p => files[p], close: async () => { closed = true; }, closed: () => closed };
}
test('取込み候補はresourcesを選び、root/外のファイルを分離する', async () => {
  const reader = zipFixture({ 'behavior/manifest.json': JSON.stringify(manifest('data')), 'root/manifest.json': JSON.stringify(manifest('resources')), 'root/ui/_ui_defs.json': '{"ui_defs":[]}', 'root/UI/unused.json': '{}', 'outside.txt': 'x' });
  const result = await importResourcePackZip({ name: 'fixture.mcpack' }, { zipReader: reader });
  assert.equal(result.ok, true); assert.equal(result.rootPrefix, 'root/'); assert.equal(result.manifestSummary.header.version, '1.2.3');
  assert.deepEqual(result.packPaths, ['manifest.json', 'ui/_ui_defs.json', 'UI/unused.json']);
  assert(result.warnings.some(x => x.code === 'PACK_ZIP_HAS_FILES_OUTSIDE_ROOT'));
  assert(result.warnings.some(x => x.code === 'PACK_UI_FOLDER_CASE_AMBIGUOUS')); assert.equal(reader.closed(), false);
});
test('不正manifestと取消は成功readerを残さず閉じる', async () => {
  for (const files of [{ 'manifest.json': '{bad' }, { 'manifest.json': JSON.stringify(manifest('data')) }, {}]) {
    const reader = zipFixture(files); const result = await importResourcePackZip({ name: 'bad.zip' }, { zipReader: reader });
    assert.equal(result.ok, false); assert.equal(reader.closed(), true);
  }
  const reader = zipFixture({ 'manifest.json': JSON.stringify(manifest('resources')) });
  const result = await importResourcePackZip({}, { zipReader: reader, signal: AbortSignal.abort() });
  assert.equal(result.error.message, 'PACK_ABORTED'); assert.equal(reader.closed(), true);
});
test('manifest最小検査は構造と必須値を拒否しUUID互換値を表示する', () => {
  for (const value of [null, [], { header: {}, modules: [] }, { header: { uuid: 'x', version: [1, 0, 0] }, modules: [null] }]) assert.equal(validateManifest(value).ok, false);
  const good = manifest('resources'); good.header.uuid = { value: '  test-uuid  ' }; good.header.version = { major: 1, minor: 2, patch: 3 };
  const summary = extractManifestSummary(good); assert.equal(summary.header.uuid, 'test-uuid'); assert.equal(summary.header.version, '1.2.3');
  assert.equal(validateManifest(good).ok, true); assert(validateManifest(good).warnings.some(x => x.code === 'MANIFEST_HEADER_UUID_NOT_UUID'));
});
test('索引は正確な大文字パスを保持しscreen/system件数を分ける', () => {
  const paths = ['root/UI/_UI_DEFS.json', 'root/UI/_global_variables.json', 'root/UI/a.jsonc', 'root/textures/x.png', 'other/y.json'];
  const derived = derivePackPaths(paths, 'root/', 'root/manifest.json');
  assert.equal(derived.outsideRootCount, 1);
  const { index } = buildPackFileIndexSummary(derived.packPaths, { previewLimit: 2, uiScreenPreviewLimit: 1 });
  assert.equal(index.ui.rootFolder, 'UI'); assert.equal(index.ui.systemFiles.uiDefs, 'UI/_UI_DEFS.json');
  assert.equal(index.ui.screenFilesCount, 1); assert.deepEqual(index.ui.screenFilesPreview, ['UI/a.jsonc']); assert.equal(index.pathsPreview.length, 2);
});
test('fallbackは成功値を保持し欠落だけ救済、取消と非対象失敗を伝搬する', async () => {
  let fallbackCalls = 0; const fallback = { id: 'fallback', readText: async () => { fallbackCalls++; return 'fallback'; } };
  for (const [code, expected] of [['PACK_NOT_FOUND', 'fallback'], ['PACK_HTTP_TIMEOUT', 'fallback']]) {
    const source = new FallbackPackSource({ primary: { id: 'primary', readText: async () => { throw makePackError(code); } }, fallback });
    assert.equal(await source.readText('x'), expected);
  }
  for (const code of ['PACK_ABORTED', 'PACK_HTTP_TOO_LARGE']) {
    const source = new FallbackPackSource({ primary: { id: 'primary', readText: async () => { throw makePackError(code); } }, fallback });
    await assert.rejects(source.readText('x'), { message: code });
  }
  const source = new FallbackPackSource({ primary: { readText: async () => 'primary' }, fallback });
  assert.equal(await source.readText('x'), 'primary'); assert.equal(fallbackCalls, 2);
});
