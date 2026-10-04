import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { restoreFrameDelta } from '../editor-core/src/pack-io/frame-delta-client.js';

const [sourceRoot, mode, output] = process.argv.slice(2);
if (!sourceRoot || !['full', 'delta'].includes(mode) || !output) throw new Error('usage: node benchmark-frame-delta.mjs source-root full|delta output.json');
const source = path.resolve(sourceRoot), load = name => import(pathToFileURL(path.join(source, name)).href);
const { FrameIrProcessor } = await load('local-node/frame-ir.mjs');
const { buildUiScreenModelFromJson } = await load('editor-core/src/model/ui-screen-model.js');
const { buildTreeFromUiScreenModel } = await load('editor-core/src/editor/ui-model-tree.js');
const fingerprintPaths = ['local-node/frame-ir.mjs', 'editor-core/src/preview/canvas-preview.js', 'editor-core/src/engine/preview-animation.js'];
const fingerprints = async () => Object.fromEntries(await Promise.all(fingerprintPaths.map(async name => [name, createHash('sha256').update(await readFile(path.join(source, name))).digest('hex')])));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = createHash('sha256'), percentile = (values, ratio) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * ratio)];
const report = { schema: 'jsonui-frame-delta-benchmark-v1', mode, source, started_at: new Date().toISOString(), node: process.version, platform: process.platform, scenarios: [], source_sha256_before: await fingerprints(),
  limitation: '合成2000slotのNode同一プロセス実行とJSON parse/差分復元の計測。ブラウザCanvas描画fps、Windows性能、実機一致は測定していない。' };
const scenarios = process.argv[5] ? [process.argv[5]] : ['sparse-alpha', 'propagated-alpha', 'layout-motion', 'large-state'];
for (const scenario of scenarios) {
  globalThis.gc?.();
  const count = scenario === 'large-state' ? 300 : 2000, processor = new FrameIrProcessor();
  const children = Array.from({ length: count }, (_, i) => ({ [`slot${i}`]: { type: 'image', size: [18, 18], offset: [i % 50 * 18, Math.floor(i / 50) * 18], texture: 'textures/ui/item_cell', layer: i % 3,
    ...(scenario === 'sparse-alpha' && i < 8 ? { anims: ['@bench.alpha'] } : {}) } }));
  const document = { namespace: 'bench', screen: { type: 'screen', controls: [{ grid: { type: 'panel', size: [900, 720], controls: children,
    ...(scenario === 'propagated-alpha' ? { propagate_alpha: true, anims: ['@bench.alpha'] } : scenario === 'layout-motion' ? { anims: ['@bench.move'] } : {}) } }] } };
  const uiModel = buildUiScreenModelFromJson(document, { filePath: 'ui/bench.json' });
  const file = { ...buildTreeFromUiScreenModel(uiModel), uiModel, meta: { selectedDefinition: { qualifiedName: 'bench.screen', profile: 'classic' }, resolution: { animationDefinitions: { definitions: {
    'bench.alpha': { anim_type: 'alpha', from: 0, to: 1, duration: 10 }, 'bench.move': { anim_type: 'offset', from: [0, 0], to: [100, 0], duration: 10 },
  } } } } };
  let before = null; const samples = [], rssStart = process.memoryUsage().rss; let rssPeak = rssStart;
  for (let i = 0; i < 34; i++) {
    const input = { ...(before ? { modelId: before.modelId } : { file }), preset: { width: 960, height: 760 }, animationTime: i / 30, generation: i,
      ...(scenario === 'large-state' ? { mockData: { unused: '日'.repeat(200000) } } : {}),
      ...(mode === 'delta' ? { frameTransport: 'delta-v1', ...(before?.frameId ? { previousFrameId: before.frameId } : {}) } : {}) };
    if (mode === 'delta' && before?.transport?.contextId) {
      for (const key of Object.keys(input)) if (!['modelId', 'animationTime', 'generation', 'frameTransport', 'previousFrameId'].includes(key)) delete input[key];
      input.contextId = before.transport.contextId;
    }
    const started = performance.now(), result = processor.execute(input), executed = performance.now();
    const wire = JSON.parse(result.body), frame = restoreFrameDelta(before, wire), finished = performance.now();
    hash.update(JSON.stringify(canonical({ scenario, i, layout: frame.layout, propsById: frame.propsById, basePropsById: frame.basePropsById, animation: frame.animation })));
    before = frame; rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    if (i >= 4) samples.push({ execute_ms: executed - started, parse_restore_ms: finished - executed, total_ms: finished - started, wire_bytes: Buffer.byteLength(result.body), schema: wire.schema, request_bytes: Buffer.byteLength(JSON.stringify(input)) });
  }
  report.scenarios.push({ scenario, node_count: Object.keys(file.nodesById).length, boxes: before.layout.boxes.length, measured_frames: samples.length,
    p50_total_ms: percentile(samples.map(x => x.total_ms), .5), p95_total_ms: percentile(samples.map(x => x.total_ms), .95),
    p50_execute_ms: percentile(samples.map(x => x.execute_ms), .5), p50_parse_restore_ms: percentile(samples.map(x => x.parse_restore_ms), .5),
    request_bytes_total: samples.reduce((n, row) => n + row.request_bytes, 0), wire_bytes_total: samples.reduce((n, row) => n + row.wire_bytes, 0), delta_frames: samples.filter(x => x.schema === 'jsonui-frame-delta-v1').length,
    rss_start: rssStart, rss_peak: rssPeak, samples, processor: processor.snapshot() });
}
report.semantic_sha256 = hash.digest('hex'); report.source_sha256_after = await fingerprints();
report.source_unchanged = JSON.stringify(report.source_sha256_before) === JSON.stringify(report.source_sha256_after);
report.finished_at = new Date().toISOString();
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ mode, semantic_sha256: report.semantic_sha256, source_unchanged: report.source_unchanged, scenarios: report.scenarios.map(({ samples, processor, ...value }) => value) }));
