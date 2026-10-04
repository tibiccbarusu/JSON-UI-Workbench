/** 固定ZIPの画面定義を有限バッチで監査する。製品の表示や原文は変更しない。 */
import { mkdir, readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DiskZipReader } from './disk-zip.mjs';
import { FrameIrProcessor } from './frame-ir.mjs';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { collectPreviewAnimationDefinitions } from '../editor-core/src/engine/preview-animation.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { prepareNodeFrameFile } from '../editor-core/src/engine/node-frame-wire.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';

const exec = promisify(execFile), entry = fileURLToPath(import.meta.url);
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const presets = [{ width: 480, height: 270 }, { width: 400, height: 300 }, { width: 270, height: 480 }];
const countCodes = rows => (rows || []).reduce((out, row) => {
  const code = typeof row === 'string' ? row.split(':')[0] : row?.code || 'UNKNOWN';
  out[code] = (out[code] || 0) + 1; return out;
}, Object.create(null));
async function atomicJson(file, value) {
  const temp = file + '.tmp'; await writeFile(temp, JSON.stringify(value, null, 2) + '\n'); await rename(temp, file);
}
async function catalogFromZip(reference) {
  const reader = new DiskZipReader();
  try {
    await reader.openFromFile({ diskPath: reference, name: path.basename(reference) });
    await reader.listEntries();
    const catalog = await buildUiCatalog({ sources: [{ id: 'fixed-reference-v2', kind: 'vanilla', precedence: 10,
      filePaths: await reader.listAllFilePaths(), readText: (name, options) => reader.readText(name, options) }], parseJsonc });
    return catalog;
  } finally { await reader.close(); }
}
function candidates(catalog) {
  const winners = new Set(Object.values(catalog.symbols).map(symbol => symbol.winnerId));
  return catalog.records.filter(record => winners.has(record.id) &&
    (record.classification === 'SCREEN' || (record.profile === 'pocket' &&
      (record.value?.type === 'screen' || record.localName.endsWith('_screen') || record.localName === 'screen'))))
    .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName) || a.id.localeCompare(b.id));
}
async function auditBatch(reference, output, batchIndex, batchSize) {
  const catalog = await catalogFromZip(reference), selected = candidates(catalog).slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
  const animationDefinitions = collectPreviewAnimationDefinitions(catalog);
  const batchFile = path.join(output, `batch-${String(batchIndex).padStart(3, '0')}.jsonl`);
  await writeFile(batchFile, '');
  for (const record of selected) {
    const began = performance.now(), authoredHash = hash(record.value);
    const row = { timestamp: new Date().toISOString(), definition: record.qualifiedName, path: record.filePath,
      rawKey: record.rawKey, profile: record.profile, referenceScanComplete: record.referenceScanComplete,
      validation_status: 'INCONCLUSIVE', frames: [], stage: 'resolve' };
    try {
      const projection = resolveEffectiveUi({ catalog, recordId: record.id,
        variables: buildRepresentativeClassicResolverVariables({ qualifiedName: record.qualifiedName }),
        representativeCollections: buildRepresentativeClassicCollections({ qualifiedName: record.qualifiedName }) });
      row.resolve = { ok: projection.ok, error: projection.error, stats: projection.stats,
        diagnostics: countCodes(projection.diagnostics) };
      if (record.profile === 'pocket') {
        row.validation_status = projection.error?.code === 'POCKET_PREVIEW_BLOCKED' ? 'PASS_POCKET_BLOCKED' : 'FAIL_POCKET_ALLOWED';
      } else if (projection.ok) {
        row.documentSha256 = hash(projection.document); row.stage = 'model';
        const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: record.filePath });
        const file = prepareNodeFrameFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel,
          meta: { selectedDefinition: projection.selected, resolution: { animationDefinitions } } });
        const nodes = file.nodesById, modelHash = hash(file), processor = new FrameIrProcessor();
        row.modelNodes = Object.keys(nodes).length; row.stage = 'frames';
        try {
          for (const preset of presets) {
            const start = performance.now();
            const frame = JSON.parse(processor.execute({ file, preset, qualifiedName: record.qualifiedName,
              generation: 1, animationTime: 0, visibilityMode: 'safe' }).body);
            const boxes = frame.layout.boxes, ids = new Set(), issues = [];
            for (const box of boxes) {
              if (ids.has(box.id)) issues.push({ code: 'DUPLICATE_BOX_ID', id: box.id });
              ids.add(box.id);
              if (!nodes[box.id]) issues.push({ code: 'BOX_NODE_MISSING', id: box.id });
              if (!['x', 'y', 'w', 'h'].every(key => Number.isFinite(box[key]))) issues.push({ code: 'NONFINITE_BOX', id: box.id });
              if (box.w < 0 || box.h < 0) issues.push({ code: 'NEGATIVE_SIZE', id: box.id });
            }
            row.frames.push({ preset, boxes: boxes.length, durationMs: performance.now() - start,
              layoutSha256: hash(frame.layout), warnings: countCodes(frame.layout.warnings),
              bindingWarnings: countCodes(frame.bindingWarnings || frame.bindingsWarnings || []),
              issues: issues.slice(0, 20), issueCount: issues.length });
          }
        } finally { processor.clear(); }
        row.modelUnchanged = hash(file) === modelHash;
        row.validation_status = row.modelUnchanged && row.frames.length === presets.length && row.frames.every(frame => !frame.issueCount)
          ? 'PASS_LAYOUT_NUMBERS' : 'FAIL_LAYOUT_CONTRACT';
      }
    } catch (error) {
      row.error = { code: error?.code || error?.message || 'AUDIT_ERROR', message: String(error?.message || error).slice(0, 1000) };
      row.validation_status = 'INCONCLUSIVE_EXCEPTION';
    }
    row.authoredUnchanged = hash(record.value) === authoredHash;
    if (!row.authoredUnchanged) row.validation_status = 'FAIL_AUTHORED_MUTATION';
    row.durationMs = performance.now() - began; row.stage = 'finished';
    await appendFile(batchFile, JSON.stringify(row) + '\n');
  }
  return { batchIndex, records: selected.length, file: path.basename(batchFile) };
}

export async function auditClassicCorpus23(referencePath, outputDirectory, { batchSize = 12 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 32) throw new Error('AUDIT_BATCH_SIZE_INVALID');
  const reference = path.resolve(referencePath), output = path.resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const digest = createHash('sha256'); let sourceBytes = 0;
  for await (const chunk of createReadStream(reference)) { digest.update(chunk); sourceBytes += chunk.length; }
  const catalog = await catalogFromZip(reference), rows = candidates(catalog);
  if (!rows.length) throw new Error('AUDIT_SCREEN_CORPUS_EMPTY');
  const report = { schema: 'jsonui-corpus-layout-audit-v23', startedAt: new Date().toISOString(),
    source: { name: path.basename(reference), bytes: sourceBytes, sha256: digest.digest('hex') },
    catalog: catalog.summary, plannedCases: rows.length, batchSize, batches: [],
    limitation_ja: '数値配置と非破壊性の検査。文字・素材・動作・実機との完全一致は別検査。',
    definitions: rows.map(record => ({ definition: record.qualifiedName, path: record.filePath,
      rawKey: record.rawKey, profile: record.profile, referenceScanComplete: record.referenceScanComplete })) };
  await atomicJson(path.join(output, 'audit.json'), report);
  for (let index = 0; index < Math.ceil(rows.length / batchSize); index++) {
    const started = performance.now();
    const batch = { index, timestamp: new Date().toISOString(), validation_status: 'NOT_RUN' };
    try {
      const result = await exec(process.execPath, ['--max-old-space-size=512', '--stack-size=8192', entry, '--batch',
        reference, output, String(index), String(batchSize)], { timeout: 240000, maxBuffer: 2 * 1024 * 1024 });
      batch.result = JSON.parse(result.stdout); batch.validation_status = 'FINISHED';
    } catch (error) {
      batch.validation_status = 'INCONCLUSIVE'; batch.reason_code = error.killed ? 'failed_timeout' : 'child_failed';
      await writeFile(path.join(output, `batch-${String(index).padStart(3, '0')}-failure.log`), String(error.stderr || error.message).slice(-65536));
    }
    batch.durationMs = performance.now() - started; report.batches.push(batch);
    await atomicJson(path.join(output, 'audit.json'), report);
    process.stdout.write(JSON.stringify({ event: 'AUDIT_BATCH_FINISHED', batch: index + 1,
      total: Math.ceil(rows.length / batchSize), status: batch.validation_status, durationMs: batch.durationMs }) + '\n');
  }
  const evidence = [];
  for (const batch of report.batches) {
    const file = path.join(output, `batch-${String(batch.index).padStart(3, '0')}.jsonl`);
    const body = await readFile(file, 'utf8').catch(() => '');
    for (const line of body.split('\n').filter(Boolean)) evidence.push(JSON.parse(line));
  }
  report.finishedAt = new Date().toISOString(); report.completedCases = evidence.length;
  report.outcomes = countCodes(evidence.map(row => ({ code: row.validation_status })));
  report.frames = evidence.reduce((sum, row) => sum + row.frames.length, 0);
  report.validation_status = evidence.length === rows.length && !report.batches.some(row => row.validation_status !== 'FINISHED')
    ? 'AUDIT_FINISHED_WITH_PER_CASE_RESULTS' : 'INCONCLUSIVE';
  await atomicJson(path.join(output, 'audit.json'), report); return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--batch') {
      const result = await auditBatch(process.argv[3], process.argv[4], Number(process.argv[5]), Number(process.argv[6]));
      process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      if (process.argv.length !== 4) throw new Error('使い方: node local-node/corpus-layout-audit23.mjs 固定資料ZIP 出力先');
      await auditClassicCorpus23(process.argv[2], process.argv[3]);
    }
  } catch (error) { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; }
}
