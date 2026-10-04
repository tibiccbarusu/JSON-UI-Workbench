/** 固定公開バニラの継承編集経路。原資料を変更せず、結果JSONのみ保存する。 */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { prepareNodeFrameFile } from '../editor-core/src/engine/node-frame-wire.js';
import { FrameIrProcessor } from './frame-ir.mjs';
import { inspectWorkspace, editWorkspace, workspaceRevision } from './workspace-edit.mjs';

const [sourceRoot, outputPath, baselineRoot] = process.argv.slice(2);
if (!sourceRoot || !outputPath) throw new Error('Usage: node local-node/verify-provenance16.mjs <resource-pack-root> <output.json> [baseline-root]');
const report = { schema: 'jsonui-provenance-verification16', validation_status: 'INCONCLUSIVE', started_at: new Date().toISOString(),
  runtime: process.version, checks: [], limitation: '原文・解決・フレーム座標のNode実行結果。ブラウザ操作・Minecraft実機との一致は検証範囲外。' };
const check = (name, fn) => { try { const evidence = fn(); report.checks.push({ name, validation_status: 'PASS', ...evidence }); }
  catch (error) { report.checks.push({ name, validation_status: 'FAIL', code: error.code || 'ASSERTION_FAILED', message: error.message }); throw error; } };
try {
  const documents = Object.create(null);
  async function visit(relative) {
    for (const entry of await readdir(path.join(sourceRoot, relative), { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'Source symlink forbidden');
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && /\.jsonc?$/iu.test(entry.name)) documents[child] = await readFile(path.join(sourceRoot, child), 'utf8');
    }
  }
  await visit('ui');
  const hash = text => createHash('sha256').update(text).digest('hex');
  const initialRevision = workspaceRevision(documents);
  report.source = { files: Object.keys(documents).length, revision: initialRevision,
    hashes: Object.fromEntries(Object.entries(documents).map(([name, text]) => [name, hash(text)])) };
  const catalogFor = docs => buildUiCatalog({ parseJsonc, sources: [{ id: 'official-vanilla16', kind: 'vanilla', precedence: 10,
    filePaths: Object.keys(docs), readText: async name => docs[name] }] });
  const catalog = await catalogFor(documents);
  const selected = catalog.records.find(record => record.filePath === 'ui/anvil_screen.json' && record.localName === 'anvil_screen');
  const before = resolveEffectiveUi({ catalog, recordId: selected.id });
  const inspected = inspectWorkspace({ documents });
  check('208文書の原文索引と金床の1513継承要素対応', () => {
    assert.equal(Object.keys(documents).length, 208); assert.equal(before.ok, true); assert.equal(inspected.ok, true);
    const index = new Set(inspected.nodes.map(node => `${node.path}#${node.pointer}`));
    const sources = Object.entries(before.nodeSources);
    const missing = sources.filter(([, source]) => !index.has(`${source.path}#${source.pointer}`));
    assert.equal(missing.length, 0); assert(sources.length > 1000);
    return { definitions: catalog.records.length, mapped: sources.length, unmatched: missing.length,
      cross_file: sources.filter(([, s]) => s.path !== selected.filePath).length,
      shared: sources.filter(([, s]) => s.scope === 'shared-template').length };
  });
  if (baselineRoot) {
    const baseline = await import(pathToFileURL(path.resolve(baselineRoot, 'editor-core/src/engine/effective-ui-resolver.js')));
    const previous = baseline.resolveEffectiveUi({ catalog, recordId: selected.id });
    check('0.9.2と解決後のMinecraftプロパティ・診断・統計が一致', () => {
      assert.equal(previous.ok, true); assert.deepEqual(JSON.parse(JSON.stringify(before.document)), JSON.parse(JSON.stringify(previous.document)));
      assert.deepEqual(before.diagnostics, previous.diagnostics); assert.deepEqual(before.stats, previous.stats);
      return { document_sha256: hash(JSON.stringify(before.document)), baseline_document_sha256: hash(JSON.stringify(previous.document)) };
    });
  }
  const [effectivePointer, target] = Object.entries(before.nodeSources).find(([, source]) => source.path === selected.filePath
    && source.pointer === '/anvil_icon_panel/controls/0/anvil_icon@anvil.anvil_icon');
  assert(target, 'Actual anvil icon source missing');
  report.target = { effectivePointer, ...target };
  const processor = new FrameIrProcessor();
  function frame(projection, generation) {
    const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: selected.filePath });
    const file = prepareNodeFrameFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel, meta: { selectedDefinition: projection.selected } });
    return JSON.parse(processor.execute({ file, generation, preset: { width: 640, height: 360 } }).body);
  }
  const beforeFrame = frame(before, 1);
  const operation = { type: 'move', path: target.path, pointer: target.pointer, offset: [13, 7] };
  const moved = editWorkspace({ documents, expectedRevision: initialRevision, operation });
  check('クリック対象の継承元本文へ移動を書込む・他208文書不変', () => {
    assert.equal(moved.ok, true, JSON.stringify(moved)); assert.equal(moved.changes.length, 1); assert.equal(moved.changes[0].path, target.path);
    assert.equal(workspaceRevision(documents), initialRevision);
    const original = parseJsonc(documents[target.path]).value, next = parseJsonc(moved.documents[target.path]).value;
    assert.deepEqual(next.anvil_icon, original.anvil_icon, 'Shared base icon definition must remain unchanged');
    assert.deepEqual(next.anvil_icon_panel.controls[0]['anvil_icon@anvil.anvil_icon'].offset, [13, 7]);
    for (const key of Object.keys(original).filter(key => key !== 'anvil_icon_panel')) assert.deepEqual(next[key], original[key]);
    for (const name of Object.keys(documents).filter(name => name !== target.path)) assert.equal(moved.documents[name], documents[name]);
    return { changed_files: moved.changes.map(change => change.path), offset: [13, 7], original_revision: initialRevision };
  });
  const afterCatalog = await catalogFor(moved.documents);
  const after = resolveEffectiveUi({ catalog: afterCatalog, recordId: selected.id });
  const afterFrame = frame(after, 2);
  check('Node実配置で金床アイコンが横13・縦7移動', () => {
    assert.equal(after.ok, true); const first = beforeFrame.layout.boxes.filter(box => box.id.endsWith('/anvil_icon'));
    assert.equal(first.length, 1); const previous = first[0], next = afterFrame.layout.boxes.find(box => box.id === previous.id);
    assert(next); assert.equal(next.x - previous.x, 13); assert.equal(next.y - previous.y, 7);
    return { id: previous.id, before: { x: previous.x, y: previous.y, w: previous.w, h: previous.h }, after: { x: next.x, y: next.y, w: next.w, h: next.h }, delta: [13, 7] };
  });
  const undo = editWorkspace({ documents: moved.documents, operation: { type: 'replaceText', path: target.path, text: moved.changes[0].before } });
  check('undoでコメント・BOM含む全原文・revision完全復元', () => {
    assert.equal(undo.ok, true); assert.equal(undo.revision, initialRevision);
    for (const [name, text] of Object.entries(documents)) assert.equal(undo.documents[name], text);
    return { revision: undo.revision, restored_files: Object.keys(documents).length };
  });
  report.validation_status = 'PASS';
} catch (error) { report.validation_status = 'FAIL'; report.error = { code: error.code || 'VERIFICATION_FAILED', message: error.message }; process.exitCode = 1; }
report.finished_at = new Date().toISOString();
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ validation_status: report.validation_status, checks: report.checks.map(({ name, validation_status }) => ({ name, validation_status })), error: report.error }));
