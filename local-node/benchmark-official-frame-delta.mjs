import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FrameIrProcessor } from './frame-ir.mjs';
import { createFrameDeltaClient } from '../editor-core/src/pack-io/frame-delta-client.js';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { collectPreviewAnimationDefinitions } from '../editor-core/src/engine/preview-animation.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { prepareNodeFrameFile } from '../editor-core/src/engine/node-frame-wire.js';

const [sourceRoot, baselineRoot, output] = process.argv.slice(2);
if (!sourceRoot || !baselineRoot || !output) throw new Error('usage: node benchmark-official-frame-delta.mjs resource_pack baseline-root output.json');
const { FrameIrProcessor: BaselineProcessor } = await import(pathToFileURL(path.join(path.resolve(baselineRoot), 'local-node/frame-ir.mjs')).href);
const filePaths = (await readdir(path.join(sourceRoot, 'ui'))).filter(name => name.endsWith('.json')).sort().map(name => 'ui/' + name), texts = new Map();
for (const file of filePaths) texts.set(file, await readFile(path.join(sourceRoot, file), 'utf8'));
const catalog = await buildUiCatalog({ sources: [{ id: 'official-fixed-ui-snapshot', kind: 'vanilla', precedence: 10, filePaths, readText: name => Promise.resolve(texts.get(name)) }], parseJsonc });
const definitions = collectPreviewAnimationDefinitions(catalog);
const report = { schema: 'jsonui-official-frame-delta-check-v1', created_at: new Date().toISOString(), node: process.version,
  source: { kind: '今回取得した公式公開資料のUIテキストを凍結した部分入力', path: sourceRoot, files: Object.fromEntries([...texts].map(([file, text]) => [file, createHash('sha256').update(text).digest('hex')])) },
  limitation: '元の約437MB Vanilla ZIPの読込検証ではない。IR同値・差分通信を検証し、テクスチャ画素の実機一致やCanvas描画はこの検査に含めない。', results: [] };
const semantics = ({ modelId, metrics, frameId, transport, ...frame }) => frame;
for (const qualifiedName of ['furnace.furnace_screen', 'beacon.beacon_screen', 'horse.horse_screen', 'enchanting.enchanting_screen', 'chest.small_chest_screen']) {
  const baseline = new BaselineProcessor(), candidate = new FrameIrProcessor();
  const row = { qualifiedName, frames: [] }; report.results.push(row);
  try {
    const record = catalog.recordsById[catalog.symbols[qualifiedName]?.winnerId]; if (!record) throw new Error('OFFICIAL_UI_MISSING');
    const projection = resolveEffectiveUi({ catalog, recordId: record.id, variables: buildRepresentativeClassicResolverVariables({ qualifiedName }), representativeCollections: buildRepresentativeClassicCollections({ qualifiedName }) });
    if (!projection.ok) throw new Error(projection.error?.code || 'PROJECT_FAILED');
    const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: record.filePath });
    const file = prepareNodeFrameFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel, meta: { selectedDefinition: projection.selected, resolution: { animationDefinitions: definitions } } });
    let priorBaseline, priorCandidate, requestBytes = 0, replyBytes = 0;
    const client = createFrameDeltaClient(async input => { requestBytes = Buffer.byteLength(JSON.stringify(input)); const response = candidate.execute(input); replyBytes = Buffer.byteLength(response.body); return JSON.parse(response.body); });
    for (const [index, animationTime] of [0, 0.2, 0.4].entries()) {
      const state = { preset: { width: 960, height: 540 }, qualifiedName, animationTime, generation: index, contextRevision: 'fixed-state' };
      const start = performance.now(), originalResponse = baseline.execute({ ...state, ...(priorBaseline ? { modelId: priorBaseline.modelId } : { file }) }), baselineMs = performance.now() - start;
      priorBaseline = JSON.parse(originalResponse.body);
      const nextStart = performance.now(); priorCandidate = await client.render({ ...state, ...(priorCandidate ? { modelId: priorCandidate.modelId } : { file }) });
      row.frames.push({ generation: index, equal: isDeepStrictEqual(semantics(priorBaseline), semantics(priorCandidate)), boxes: priorCandidate.layout.boxes.length, request_bytes: requestBytes,
        full_reply_bytes: Buffer.byteLength(originalResponse.body), delta_reply_bytes: replyBytes, baseline_execute_ms: baselineMs, candidate_execute_parse_restore_ms: performance.now() - nextStart });
    }
    row.status = row.frames.every(frame => frame.equal) ? 'PASS' : 'FAIL'; row.transport = candidate.snapshot().frame_transport; row.contexts = candidate.snapshot().frame_contexts;
  } catch (error) { row.status = 'FAILED'; row.error = error.message; }
  finally { baseline.clear(); candidate.clear(); }
}
report.status = report.results.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL';
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, ui_file_count: texts.size, results: report.results }));
if (report.status !== 'PASS') process.exitCode = 1;
