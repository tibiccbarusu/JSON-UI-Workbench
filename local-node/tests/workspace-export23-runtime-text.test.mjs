import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildWorkspaceExport } from '../workspace-export.mjs';
import { DiskZipReader } from '../disk-zip.mjs';
import { importResourcePackZip } from '../../editor-core/src/pack-io/pack-importer.js';
import { parseLangFile } from '../../editor-core/src/assets/lang-table.js';
import { manifest } from './fixtures.mjs';

function source(files, kind = 'imported') {
  const values = Object.fromEntries(Object.entries({ 'manifest.json': manifest, ...files }).map(([name, value]) => [name,
    Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))]));
  return { id: kind, kind, paths: Object.keys(values), readText: async name => values[name].toString('utf8'), readBytes: async name => values[name] };
}
async function readOutput(result, callback) {
  assert.equal(result.ok, true, JSON.stringify(result.plan.unresolved));
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-runtime-text23-')), filename = path.join(directory, 'selected.mcpack');
  let pack;
  try {
    await writeFile(filename, result.bytes, { flag: 'wx' });
    pack = await importResourcePackZip({ diskPath: filename, name: 'selected.mcpack', size: result.bytes.length }, { zipReader: new DiskZipReader() });
    assert(pack.ok, JSON.stringify(pack.error)); await callback(pack.zipReader, pack.packPaths);
  } finally { if (pack?.ok) await pack.zipReader.close(); await rm(directory, { recursive: true, force: true }); }
}
const ui = { namespace: 'n', screen: { type: 'screen', controls: [{ runtime: { type: 'label', text: '#item_name' } },
  { known: { type: 'label', text: 'ui.known' } }] } };

test('runtime専用の未使用翻訳と全字形を実ZIP内に保持し、staticの下層翻訳も落とさない', async () => {
  const raw = '# 独自の実行時名称\nitem.custom.name=Custom item\n', font = Buffer.from([1, 2, 3, 4]);
  const imported = source({ 'ui/main.json': ui, 'texts/ja_JP.lang': raw, 'texts/fr_FR/font/glyph_FF.png': font,
    'font/custom.ttf': Buffer.from([7, 8, 9]), 'font/glyph_FE.png': Buffer.from([8, 7, 6]) });
  const vanilla = source({ 'texts/ja_JP.lang': 'ui.known=Known\n', 'texts/en_US.lang': 'ui.known=Known\n' }, 'vanilla');
  const result = await buildWorkspaceExport({ sources: [imported, vanilla], selections: [{ filePath: 'ui/main.json', definition: 'n.screen' }] });
  await readOutput(result, async (reader, paths) => {
    const text = await reader.readText('texts/ja_JP.lang');
    assert(text.startsWith(raw)); assert.equal(parseLangFile(text).table['item.custom.name'], 'Custom item');
    assert.equal(parseLangFile(text).table['ui.known'], 'Known');
    assert.deepEqual(await reader.bytes('texts/fr_FR/font/glyph_FF.png'), font);
    assert.deepEqual(await reader.bytes('font/custom.ttf'), Buffer.from([7, 8, 9]));
    assert.deepEqual(await reader.bytes('font/glyph_FE.png'), Buffer.from([8, 7, 6]));
    const locales = JSON.parse(await reader.readText('texts/languages.json'));
    assert.deepEqual(locales, ['en_US', 'fr_FR', 'ja_JP']); assert(paths.includes('texts/fr_FR.lang'));
  });
});

test('全runtime素材保持にも出力容量上限が働き、部分ZIPを成功扱いにしない', async () => {
  const imported = source({ 'ui/main.json': { namespace: 'n', screen: { type: 'label', text: '#item_name' } },
    'font/glyph_FE.png': Buffer.alloc(2048) });
  const result = await buildWorkspaceExport({ sources: [imported], selections: [{ filePath: 'ui/main.json', definition: 'n.screen' }], limits: { entryBytes: 1024 } });
  assert.equal(result.ok, false); assert.equal(result.bytes, undefined);
  assert(result.plan.unresolved.some(row => row.code === 'EXPORT_ENTRY_LIMIT'));
});

test('外部資源を参照し得る未確認font JSONは名前だけで完全認定しない', async () => {
  const imported = source({ 'ui/main.json': { namespace: 'n', screen: { type: 'label', text: '#item_name' } },
    'font/custom.json': { providers: [{ file: 'outside/custom.png' }] } });
  const result = await buildWorkspaceExport({ sources: [imported], selections: [{ filePath: 'ui/main.json', definition: 'n.screen' }] });
  assert.equal(result.ok, false); assert.equal(result.bytes, undefined);
  assert(result.plan.unresolved.some(row => row.code === 'EXPORT_ENGINE_RUNTIME_FONT_METADATA_UNRESOLVED'));
});
