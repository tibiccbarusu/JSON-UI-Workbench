/** 添付パックの入口保持・実ZIP再読込・操作原文契約を検査する有限CLI。 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DiskZipReader } from './disk-zip.mjs';
import { importResourcePackZip } from '../editor-core/src/pack-io/pack-importer.js';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { buildWorkspaceExport } from './workspace-export.mjs';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';

const [referencePath, selectedPath, output] = process.argv.slice(2);
if (!referencePath || !selectedPath || !output) throw new Error('参照ZIP、入力mcpack、新しい出力ディレクトリを指定してください。');
await mkdir(output, { recursive: false });
const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 300000), opened = [];
const digest = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => writeFile(path.join(output, name), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const report = { schema: 'jsonui-entry-preservation23', status: 'RUNNING', started_at: new Date().toISOString(), inputs: [], checks: [],
  limitations_ja: ['固定公式UIと部分回復素材を使う検査入力であり、実機vanilla原本との版一致は認定しない。',
    'Minecraft実機は動かしていない。実機のズレの原因を断定せず、入口・原文契約と再読込後の描画解釈を検証する。',
    'Pocket分岐は原文保存を検査し、Pocketプレビューは実行しない。'] };
const check = (name, detail = {}) => { const row = { name, status: 'PASS', ...detail }; report.checks.push(row); console.log(JSON.stringify(row)); };
async function source(filename, kind) {
  const bytes = await readFile(filename), loaded = await importResourcePackZip({ diskPath: filename, name: path.basename(filename), size: bytes.length }, { zipReader: new DiskZipReader() });
  assert(loaded.ok, JSON.stringify(loaded.error)); opened.push(loaded.zipReader);
  report.inputs.push({ file: path.basename(filename), kind, bytes: bytes.length, sha256: digest(bytes) });
  return { id: kind, kind, paths: loaded.packPaths,
    readText: (filePath, maxBytes) => loaded.zipReader.readText(loaded.rootPrefix + filePath, { maxBytes }),
    readBytes: (filePath, maxBytes) => loaded.zipReader.bytes(loaded.rootPrefix + filePath, maxBytes) };
}
async function project(sources) {
  const catalog = await buildUiCatalog({ parseJsonc, signal: abort.signal, sources: sources.map(item => ({ ...item,
    precedence: item.kind === 'imported' ? 1 : 0, filePaths: item.paths,
    readText: (name, options) => item.readText(name, options.maxBytes) })) });
  const name = 'anvil.anvil_screen', record = catalog.recordsById[catalog.symbols[name].winnerId];
  const projection = resolveEffectiveUi({ catalog, recordId: record.id,
    variables: buildRepresentativeClassicResolverVariables({ qualifiedName: name }),
    representativeCollections: buildRepresentativeClassicCollections({ qualifiedName: name }) });
  assert(projection.ok, JSON.stringify(projection.diagnostics)); return { catalog, record, projection };
}
function behaviorFacts(value) {
  const result = [];
  const fields = new Set(['bindings', 'button_mappings', 'collection_name', 'property_bag', 'focus_identifier', 'focus_change_right', 'focus_change_left']);
  function walk(current, pointer = '') {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      const next = pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
      if (fields.has(key)) result.push({ pointer: next, value: child });
      walk(child, next);
    }
  }
  walk(value); return result;
}
try {
  const reference = await source(referencePath, 'vanilla'), selected = await source(selectedPath, 'imported');
  const before = await project([reference, selected]);
  const result = await buildWorkspaceExport({ sources: [reference, selected], signal: abort.signal,
    selections: [{ filePath: 'ui/anvil_screen.json', definition: 'anvil.anvil_screen' }] });
  await save('export-plan.json', result.plan); assert(result.ok, JSON.stringify(result.plan.unresolved));
  assert.equal(result.plan.entryPointPreservation.length, 1);
  assert.equal(result.plan.selectedDefinitions[0].rawKey, 'anvil_screen@common.inventory_screen_common');
  await save('anvil-entry-preserved.mcpack', result.bytes);
  check('元の外部screen継承キーを維持して実mcpackを生成', { bytes: result.bytes.length, sha256: result.sha256,
    transformation: result.plan.entryPointPreservation });
  const restored = await source(path.join(output, 'anvil-entry-preserved.mcpack'), 'imported');
  const after = await project([reference, restored]);
  assert.deepEqual(after.projection.document, before.projection.document);
  check('未変更の参照パックへ再importしてClassicの全投影内容が一致', { sha256: digest(JSON.stringify(after.projection.document)) });
  const rawBefore = parseJsonc(await selected.readText('ui/anvil_screen.json', 8388608)).value;
  const rawAfter = parseJsonc(await restored.readText('ui/anvil_screen.json', 8388608)).value;
  assert.deepEqual(rawAfter[after.record.rawKey].variables, rawBefore[before.record.rawKey].variables);
  check('Desktop/Pocket条件分岐・screen_content変数を原文のまま保持');
  const firstFacts = behaviorFacts(before.projection.document), lastFacts = behaviorFacts(after.projection.document);
  assert.deepEqual(lastFacts, firstFacts);
  check('bindings・button_mappings・collection・property_bag・focus契約を保持', { facts: lastFacts.length, sha256: digest(JSON.stringify(lastFacts)) });
  await save('behavior-facts.json', lastFacts);
  const referenceCommon = parseJsonc(await reference.readText('ui/ui_common.json', 8388608)).value;
  const emittedCommon = parseJsonc(await restored.readText('ui/ui_common.json', 8388608)).value;
  for (const name of ['base_screen', 'inventory_screen_common@common.base_screen']) assert.deepEqual(emittedCommon[name], referenceCommon[name]);
  check('外部入口から参照する共有screen基底の原文を公式参照と同一に保持');
  const otherScreens = [];
  for (const name of ['chest.small_chest_screen', 'chest.large_chest_screen', 'crafting.inventory_screen']) {
    const resolve = cat => resolveEffectiveUi({ catalog: cat, recordId: cat.symbols[name].winnerId,
      variables: buildRepresentativeClassicResolverVariables({ qualifiedName: name }),
      representativeCollections: buildRepresentativeClassicCollections({ qualifiedName: name }) });
    const first = resolve(before.catalog), last = resolve(after.catalog);
    assert(first.ok && last.ok); assert.deepEqual(last.document, first.document);
    otherScreens.push({ definition: name, sha256: digest(JSON.stringify(last.document)) });
  }
  check('小チェスト・大チェスト・インベントリの他画面投影が完全一致', { screens: otherScreens });
  report.status = 'PASS';
} catch (error) {
  report.status = abort.signal.aborted ? 'INCONCLUSIVE' : 'FAIL';
  report.error = { code: abort.signal.aborted ? 'EXPORT_ABORTED' : error.code || error.name, message: error.message };
  console.error(JSON.stringify(report.error)); process.exitCode = 1;
} finally {
  clearTimeout(timer);
  const closed = await Promise.allSettled(opened.map(reader => reader.close()));
  if (closed.some(item => item.status === 'rejected')) { report.cleanup = 'FAIL'; process.exitCode = 1; }
  report.finished_at = new Date().toISOString(); await save('report.json', report);
}
