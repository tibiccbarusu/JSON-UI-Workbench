import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FrameIrProcessor, FRAME_LIMITS } from '../frame-ir.mjs';
import { runCli } from '../cli.mjs';
import { CliClient } from '../cli-client.mjs';
import { resourceFixture, makeZip, manifest } from './fixtures.mjs';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { summarizeEvaluationQuality, surveyExecutionWorkload } from '../../editor-core/src/engine/evaluation-quality.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { prepareNodeFrameFile } from '../../editor-core/src/engine/node-frame-wire.js';
import { renderFramePng } from '../frame-raster13.mjs';

test('bounded nested factories retain requested/generated counts without promoting omitted rows to pass', async () => {
  const doc = { namespace: 'load', screen: { type: 'screen', controls: [{ rows: { type: 'stack_panel', collection_name: 'outer', factory: { name: 'f', control_name: 'load.row' } } }] },
    row: { type: 'panel', controls: [{ nested: { type: 'stack_panel', collection_name: 'inner', factory: { name: 'g', control_name: 'load.leaf' } } }] },
    leaf: { type: 'label', text: 'x' } };
  const source = { id: 'synthetic', kind: 'imported', precedence: 20, filePaths: ['ui/load.json'], readText: async () => JSON.stringify(doc) };
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: text => ({ ok: true, value: JSON.parse(text), errors: [] }) });
  const recordId = catalog.records.find(row => row.qualifiedName === 'load.screen').id;
  const options = { catalog, recordId, representativeCollections: { outer: { count: 2 }, inner: { count: 3 } } };
  const complete = resolveEffectiveUi(options);
  assert.equal(complete.stats.requestedFactoryItems, 8);
  assert.equal(complete.stats.materializedFactoryItems, 8);
  assert.equal(summarizeEvaluationQuality({ projection: complete }).status, 'passed');
  const partial = resolveEffectiveUi({ ...options, limits: { maxMaterializedFactoryItems: 2 } });
  assert.equal(partial.stats.requestedFactoryItems, 8);
  assert.equal(partial.stats.materializedFactoryItems, 6);
  const quality = summarizeEvaluationQuality({ projection: partial });
  assert.equal(quality.complete, false);
  assert(quality.reason_codes.includes('EVALUATION_FACTORY_ITEMS_OMITTED'));
  assert.equal(quality.native_performance_measured, false);
});

test('model and layout truncation survive execution wire and stay incomplete', () => {
  const uiModel = buildUiScreenModelFromJson({ namespace: 'bound', screen: { type: 'screen', controls: [
    { first: { type: 'image', bindings: [{ binding_name: '#show', binding_name_override: '#visible' }] } },
  ] } }, { filePath: 'ui/bound.json' });
  uiModel.stats.truncated = true;
  const file = prepareNodeFrameFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel });
  assert.equal(file.uiModel.stats.truncated, true);
  const frame = JSON.parse(new FrameIrProcessor().execute({ file, preset: { width: 32, height: 32 } }).body);
  assert.equal(frame.evaluation.complete, false);
  assert(frame.evaluation.reason_codes.includes('EVALUATION_MODEL_TRUNCATED'));
  assert.equal(surveyExecutionWorkload(file.nodesById, file.uiModel).bindings, 1);
  assert.equal(summarizeEvaluationQuality({ frame: { layout: { stats: { truncated: true } } } }).complete, false);
});

test('summary transport stays bounded for a frame exceeding 24 MiB; never returns a renderable success', () => {
  const processor = new FrameIrProcessor();
  const result = { schema: 'jsonui-frame-v1', modelId: 'a', layout: { boxes: [], stats: { truncated: false }, warnings: [] },
    propsById: { heavy: 'x'.repeat(FRAME_LIMITS.replyBytes) }, bindings: { warnings: [] },
    evaluation: { status: 'unknown', complete: false, reason_codes: ['EXAMPLE_LIMIT'] } };
  assert.throws(() => processor.response(result, 0, { totalMs: 0 }, {}), /NODE_FRAME_REPLY_LIMIT/);
  const wire = processor.response(result, 0, { totalMs: 0 }, { frameTransport: 'summary-v1' });
  assert(Buffer.byteLength(wire.body) < 4096);
  const summary = JSON.parse(wire.body);
  assert.equal(summary.renderable, false);
  assert.equal(summary.frame_included, false);
  assert.equal(summary.evaluation.complete, false);
  assert.equal(summary.native_parity_verified, false);
});

test('PNG rejects projection truncation before resource loading, independently of clean boxes', async () => {
  const projection = { ok: true, document: { namespace: 'load', screen: { type: 'screen' } }, selected: { filePath: 'ui/load.json' },
    diagnostics: [{ code: 'UI_FACTORY_MATERIALIZATION_LIMIT', severity: 'warning' }] };
  const frame = { schema: 'jsonui-frame-v1', layout: { boxes: [], preset: { width: 32, height: 32 }, stats: { truncated: false } }, bindings: { warnings: [] } };
  const result = await renderFramePng({ projection, frame, width: 32, height: 32,
    backend: { createCanvas() { throw new Error('should not draw partial scene'); }, loadImage() {} } });
  assert.equal(result.code, 'RASTER_EVALUATION_INCOMPLETE');
  assert.equal(result.preview_complete, false);
});

test('CLI frame-summary writes useful workload evidence and keeps native tests unexecuted', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-limits-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'pack.zip'), session = path.join(directory, 'session.json'), out = path.join(directory, 'summary.json');
  await writeFile(archive, resourceFixture());
  await runCli(['import', '--pack', archive, '--session', session]);
  const reply = await runCli(['preview', '--file', 'ui/example.json', '--definition', 'test.screen', '--session', session, '--frame-summary', '--out', out]);
  assert.equal(reply.result.renderable, false);
  assert.equal(reply.result.frame.schema, 'jsonui-frame-summary-v1');
  assert(reply.result.frame.workload.controls > 0);
  assert.equal(reply.result.quality.native_comparison.status, 'not_evaluated');
  assert.equal(JSON.parse(await readFile(out, 'utf8')).frame.frame_included, false);
});

test('warm projection frames reuse the execution model while changed binding values still update', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-reuse-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'pack.zip');
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/load.json': JSON.stringify({ namespace: 'reuse',
    screen: { type: 'screen', controls: [{ value: { type: 'label', text: '#text',
      bindings: [{ binding_name: '#text', binding_name_override: '#text' }] } }] } }) }));
  const client = await CliClient.start(); t.after(() => client.close());
  const pack = await client.importPack(archive);
  const catalog = await client.request('/api/node/catalog', { payload: { sources: [{ id: pack.id, kind: 'imported' }] } });
  const record = catalog.records.find(row => row.qualifiedName === 'reuse.screen');
  const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } });
  const request = { projectionId: projection.nodeProjectionId, filePath: record.filePath, recordId: record.id, preset: { width: 64, height: 64 } };
  const first = await client.request('/api/node/frame', { payload: { ...request, generation: 1, mockData: { '#text': 'one' } } });
  const second = await client.request('/api/node/frame', { payload: { ...request, generation: 2, mockData: { '#text': 'two' } } });
  const third = await client.request('/api/node/frame', { payload: { ...request, generation: 3, mockData: { '#text': 'two' } } });
  assert.equal(first.modelId, second.modelId);
  assert.equal(second.modelId, third.modelId);
  assert(Object.values(first.propsById).some(props => props.text === 'one'));
  assert(Object.values(second.propsById).some(props => props.text === 'two'));
  assert.equal(third.generation, 3);
  assert.equal(third.metrics.cacheHit, true);
  assert.deepEqual(client.app.processor.snapshot().caches.projection_models, { builds: 1, hits: 2, entries: 1 });
});
