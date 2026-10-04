import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { prepareNodeFrameFile } from '../editor-core/src/engine/node-frame-wire.js';
import { FrameIrProcessor } from './frame-ir.mjs';

const [sourceRoot, baselineRoot, output] = process.argv.slice(2);
if (!sourceRoot || !baselineRoot || !output) throw new Error('usage: node verify-official-core.mjs resource_pack baseline-root output.json');
const { resolveEffectiveUi: resolveBaseline } = await import(pathToFileURL(path.join(path.resolve(baselineRoot), 'editor-core/src/engine/effective-ui-resolver.js')).href);
const texts = new Map(), hashes = {};
async function visit(relative) {
  for (const entry of await readdir(path.join(sourceRoot, relative), { withFileTypes: true })) {
    const file = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await visit(file);
    else if (entry.isFile() && /\.json$/iu.test(file)) {
      const text = await readFile(path.join(sourceRoot, file), 'utf8');
      texts.set(file, text); hashes[file] = createHash('sha256').update(text).digest('hex');
    }
  }
}
await visit('ui');
const catalog = await buildUiCatalog({ sources: [{ id: 'official-fixed-snapshot', kind: 'vanilla', precedence: 10,
  filePaths: [...texts.keys()].sort(), readText: name => Promise.resolve(texts.get(name)) }], parseJsonc });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const report = { run_id: 'jsonui07-20260907', stage_ref: 'core-official-comparison', validation_status: 'NOT_RUN',
  started_at: new Date().toISOString(), runtime: process.version,
  source: { kind: '固定公式 UI スナップショット', files: hashes, count: texts.size }, catalog: catalog.summary,
  limitation: '比較対象は解決済み JSON UI と Node のレイアウト中間表現。実機の画素・Windows での時間・元の大型 ZIP の読込検証ではない。', results: [] };
for (const qualifiedName of ['beacon.beacon_screen', 'enchanting.enchanting_screen', 'horse.horse_screen',
  'chest.small_chest_screen', 'chest.large_chest_screen', 'crafting.inventory_screen', 'crafting.crafting_screen',
  'book.book_screen', 'loom.loom_screen', 'trade2.trade_screen']) {
  const row = { qualifiedName }; report.results.push(row);
  try {
    const recordId = catalog.symbols[qualifiedName]?.winnerId;
    if (!recordId) throw new Error('OFFICIAL_UI_MISSING');
    const options = { catalog, recordId, variables: buildRepresentativeClassicResolverVariables({ qualifiedName }),
      representativeCollections: buildRepresentativeClassicCollections({ qualifiedName }) };
    let started = performance.now(); const before = resolveBaseline(options); row.baseline_ms = performance.now() - started;
    started = performance.now(); const after = resolveEffectiveUi(options); row.candidate_ms = performance.now() - started;
    row.baseline_sha256 = hash(before); row.candidate_sha256 = hash(after);
    row.validation_status = before.ok && after.ok && row.baseline_sha256 === row.candidate_sha256 ? 'PASS' : 'FAIL';
    row.stats = after.stats;
    row.diagnostics = Object.fromEntries([...new Set(after.diagnostics.map(d => d.code))].map(code => [code, after.diagnostics.filter(d => d.code === code).length]));
    if (after.ok && qualifiedName === 'crafting.inventory_screen') {
      const uiModel = buildUiScreenModelFromJson(after.document, { filePath: after.selected.filePath });
      const file = prepareNodeFrameFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel, meta: { selectedDefinition: after.selected } });
      const processor = new FrameIrProcessor();
      const frame = JSON.parse(processor.execute({ file, qualifiedName, preset: { width: 480, height: 270 } }).body);
      row.custom_nodes = Object.values(file.nodesById).filter(node => node.type === 'custom').map(node => {
        const props = { ...node.unknownProps, ...node.props, ...frame.propsById[node.id] };
        return { id: node.id, renderer: props.renderer, visible: props.visible, ignored: props.ignored,
          size: props.size, box: frame.layout.boxes.find(box => box.id === node.id) || null };
      });
      row.frame = { nodes: Object.keys(file.nodesById).length, boxes: frame.layout.boxes.length, metrics: frame.metrics };
      processor.clear();
    }
  } catch (error) { row.validation_status = 'FAIL'; row.error = error.message; }
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ run_id: report.run_id, stage_ref: report.stage_ref, ...row, custom_nodes: undefined }));
}
const pocket = catalog.records.find(record => record.profile === 'pocket');
const blocked = pocket && resolveEffectiveUi({ catalog, recordId: pocket.id });
report.pocket = { loaded_definitions: catalog.summary.pocketDefinitions,
  validation_status: blocked?.error?.code === 'POCKET_PREVIEW_BLOCKED' ? 'PASS' : 'FAIL', error: blocked?.error };
report.validation_status = report.results.every(row => row.validation_status === 'PASS') && report.pocket.validation_status === 'PASS' ? 'PASS' : 'FAIL';
report.finished_at = new Date().toISOString();
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
if (report.validation_status !== 'PASS') process.exitCode = 1;
