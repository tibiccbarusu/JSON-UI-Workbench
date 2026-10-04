/** 固定した公式 pack の依存閉包監査。Node.js 22.14+、ネットワークアクセスなし。 */
import { readFile, readdir, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { planWorkspaceExport, buildWorkspaceExport } from './workspace-export.mjs';
import { DiskZipReader } from './disk-zip.mjs';
import { importResourcePackZip } from '../editor-core/src/pack-io/pack-importer.js';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';

const { values } = parseArgs({ options: { pack: { type: 'string' }, out: { type: 'string' } } });
if (!values.pack || !values.out) throw new Error('Usage: node local-node/audit-export13.mjs --pack <extracted-pack> --out <report-directory>');
const root = resolve(values.pack), outputDirectory = resolve(values.out);
await mkdir(outputDirectory, { recursive: true });
const paths = (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
  .map(entry => join(entry.parentPath ?? entry.path, entry.name).slice(root.length + 1).replaceAll('\\', '/'));
const source = { id: 'vanilla', kind: 'vanilla', paths,
  readText: path => readFile(join(root, path), 'utf8'), readBytes: path => readFile(join(root, path)) };
const cases = [
  ['ui/ui_common.json', 'empty_panel'], ['ui/beacon_screen.json', 'usable_items_panel'],
  ['ui/beacon_screen.json', 'beacon_screen@common.inventory_screen_common'],
  ['ui/enchanting_screen.json', 'enchanting_panel_top_half'],
  ['ui/enchanting_screen.json', 'enchanting_screen@common.inventory_screen_common'],
  ['ui/horse_screen.json', 'horse_renderer'], ['ui/horse_screen.json', 'horse_screen@common.inventory_screen_common'],
  ['ui/chest_screen.json', 'small_chest_screen@common.inventory_screen_common'],
];
const original = await buildUiCatalog({ parseJsonc, sources: [{ ...source, filePaths: paths,
  readText: (path, _options) => source.readText(path) }], limits: { maxReferenceNodesTotal: 1, maxReferenceNodesPerDefinition: 1 } });
const summaries = [];
for (const [filePath, rawKey] of cases) {
  const started = performance.now(), options = { sources: [source], selections: [{ filePath, rawKey }] };
  const result = await planWorkspaceExport(options);
  const row = { filePath, rawKey, durationMs: performance.now() - started, ...result, roundTrip: 'NOT_RUN_BLOCKED' };
  if (result.ok) {
    const built = await buildWorkspaceExport(options), directory = await mkdtemp(join(tmpdir(), 'jsonui-export13-official-'));
    let imported;
    try {
      assert(built.ok, JSON.stringify(built.plan.unresolved));
      const diskPath = join(directory, 'selected.mcpack'); await writeFile(diskPath, built.bytes);
      imported = await importResourcePackZip({ diskPath, name: 'selected.mcpack', size: built.bytes.length }, { zipReader: new DiskZipReader() });
      assert(imported.ok, imported.error?.message);
      const restored = await buildUiCatalog({ parseJsonc, sources: [{ id: 'restored', kind: 'imported', filePaths: imported.packPaths,
        readText: (path, { maxBytes }) => imported.zipReader.readText(imported.rootPrefix + path, { maxBytes }) }] });
      const originalRecord = original.records.find(record => record.filePath === filePath && record.rawKey === rawKey);
      const restoredRecord = restored.records.find(record => record.filePath === filePath && record.rawKey === rawKey);
      assert(originalRecord); assert(restoredRecord);
      const before = resolveEffectiveUi({ catalog: original, recordId: originalRecord.id });
      const after = resolveEffectiveUi({ catalog: restored, recordId: restoredRecord.id });
      assert(before.ok); assert(after.ok); assert.deepEqual(after.document, before.document);
      row.roundTrip = 'PASS_PROJECT_DOCUMENT_EQUAL'; row.zipBytes = built.bytes.length; row.zipSha256 = built.sha256;
    } finally { if (imported?.ok) await imported.zipReader.close(); await rm(directory, { recursive: true, force: true }); }
  }
  await writeFile(join(outputDirectory, `export-official-${rawKey.split('@')[0]}.json`), JSON.stringify(row, null, 2) + '\n');
  const summary = { filePath, rawKey, ok: row.ok, roundTrip: row.roundTrip, files: row.plan.files.length,
    unresolved: row.plan.unresolved.length, codes: [...new Set(row.plan.unresolved.map(item => item.code))],
    nativeEvidence: row.plan.nativeEvidence, durationMs: row.durationMs, zipBytes: row.zipBytes || null };
  summaries.push(summary); process.stdout.write(JSON.stringify({ rawKey, ok: row.ok, roundTrip: row.roundTrip, files: summary.files, unresolved: summary.unresolved }) + '\n');
}
await writeFile(join(outputDirectory, 'export-official-summary.json'), JSON.stringify({ schema: 'jsonui-official-export-audit-v1',
  createdAt: new Date().toISOString(), sourceFileCount: paths.length, cases: summaries }, null, 2) + '\n');
