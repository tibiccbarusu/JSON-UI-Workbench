import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';
import { summarizeBindingQuality } from '../../editor-core/src/engine/binding-quality40.js';
import { buildPreviewQuality } from '../cli-quality38.mjs';
import { renderFramePng, loadRasterBackend } from '../frame-raster13.mjs';
import { CliClient } from '../cli-client.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const origins = { anchor_from: 'top_left', anchor_to: 'top_left' };
const reasons = ['view-property-absent', 'view-control-missing', 'view-control-ambiguous', 'global-missing',
  'expression-unknown', 'view-cycle', 'total-binding-budget', 'view-count-budget', 'view-operation-budget',
  'ignored-binding', 'binding-none', 'resolved-binding'];
const targets = ['visible', 'enabled', 'focus_enabled'];
const ancestors = ['visible', 'hidden', 'unknown'];
const backend = loadRasterBackend();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const evidenceDirectory = process.env.QUALITY40_EVIDENCE_DIR;
const emptyResourceClient = { async request(route) {
  if (route.endsWith('/assets')) return {};
  if (route === '/api/node/lang') return { table: {}, sources: [] };
  throw new Error(`Unexpected resource request: ${route}`);
} };

function fixture(reason, target, ancestor) {
  const binding = { binding_type: 'view', source_property_name: '#missing', target_property_name: `#${target}` };
  // focus_enabled belongs to native input controls; passive panel/image
  // rejection is covered by the separate native-property regression.
  const control = { type: target === 'focus_enabled' ? 'button' : 'panel', size: [16, 16], ...origins, [target]: true,
    property_bag: { '#seed': false }, bindings: [binding] };
  const extra = [], options = {};
  if (reason === 'view-control-missing') binding.source_control_name = 'missing';
  if (reason === 'view-control-ambiguous') {
    binding.source_control_name = 'duplicate'; binding.source_property_name = '#seed';
    for (const name of ['left', 'right']) extra.push({ [name]: { type: 'panel', controls: [
      { duplicate: { type: 'panel', property_bag: { '#seed': true } } },
    ] } });
  }
  if (reason === 'global-missing') control.bindings = [{ binding_type: 'global', binding_name: '#missing', binding_name_override: `#${target}` }];
  if (reason === 'expression-unknown') binding.source_property_name = '(#missing = 1)';
  if (reason === 'view-cycle') binding.source_property_name = `(!#${target})`;
  if (reason === 'ignored-binding') binding.ignored = true;
  if (reason === 'binding-none') binding.binding_type = 'none';
  if (reason === 'resolved-binding') binding.source_property_name = '#seed';
  if (reason.endsWith('-budget')) {
    binding.source_property_name = '#seed';
    control.bindings.unshift({ binding_type: 'view', source_property_name: '#seed', target_property_name: '#aux' });
    options[reason === 'total-binding-budget' ? 'maxTotalBindings'
      : reason === 'view-count-budget' ? 'maxViewBindings' : 'maxViewBindingOperations'] = 1;
  }
  const parent = { type: 'panel', size: [32, 32], ...origins, controls: [{ target: control }] };
  if (ancestor === 'hidden') parent.visible = false;
  if (ancestor === 'unknown') parent.bindings = [{ binding_type: 'global', binding_name: '#unknown_ancestor', binding_name_override: '#visible' }];
  return { document: { namespace: 'quality40', screen: { type: 'screen', size: [64, 48], ...origins,
    controls: [...extra, { branch: parent }] } }, options };
}

function frameFor(document, options = {}) {
  const model = buildUiScreenModelFromJson(document, { filePath: 'ui/quality40.json' });
  const file = buildTreeFromUiScreenModel(model), evaluated = evaluateBindingsForUiModel(model, options);
  const frame = { schema: 'jsonui-frame-v1', propsById: evaluated.propsById,
    layout: computeLayoutBoxesForFile(file, { width: 64, height: 48 }, { propsByIdOverride: evaluated.propsById, visibilityMode: 'safe' }),
    bindings: { stats: evaluated.stats, warnings: evaluated.warnings, diagnostics: evaluated.diagnostics,
      localToggleDiagnostics: evaluated.localToggleDiagnostics, observationCaptureComplete: evaluated.observationCaptureComplete } };
  return { frame, evaluated };
}
function rasterArguments(document, frame) {
  return { client: emptyResourceClient, sources: [{ id: 'quality40', kind: 'vanilla' }],
    projection: { ok: true, document, selected: { filePath: 'ui/quality40.json', profile: 'classic' } },
    frame, width: 64, height: 48, backend };
}
function observedRaster(result) {
  return { ok: result.ok, code: result.code ?? null, complete: result.complete, preview_complete: result.preview_complete,
    draft: result.draft, png_bytes: result.png?.length ?? 0, png_sha256: result.png ? sha256(result.png) : null,
    binding_quality: result.binding_quality, collection_quality: result.collection_quality,
    diagnostics: result.diagnostics, native_equivalence: result.native_equivalence };
}

test('108 semantic combinations execute evaluator, safe layout, strict raster and explicit draft raster', { skip: !backend, timeout: 120000 }, async t => {
  const results = [];
  for (const reason of reasons) for (const target of targets) for (const ancestor of ancestors) {
    const index = results.length + 1, caseId = `quality-${String(index).padStart(3, '0')}`;
    const issue = ancestor === 'unknown' || reason.endsWith('-budget')
      || (ancestor === 'visible' && !['ignored-binding', 'binding-none', 'resolved-binding'].includes(reason));
    const expected = { binding_quality: issue ? 'unknown' : 'passed', strict_png: !issue, preview_complete: !issue,
      draft_png: true, draft_marker: issue, native_equivalence: 'not_evaluated' };
    const input = fixture(reason, target, ancestor), started = new Date().toISOString();
    const { frame, evaluated } = frameFor(input.document, input.options), args = rasterArguments(input.document, frame);
    const strict = await renderFramePng(args), draft = await renderFramePng({ ...args, allowPartial: true });
    const actual = { binding_quality: strict.binding_quality?.status, strict_png: Boolean(strict.ok && strict.png),
      preview_complete: strict.preview_complete, draft_png: Boolean(draft.ok && draft.png), draft_marker: draft.draft,
      native_equivalence: draft.native_equivalence?.status };
    const result = { case_id: caseId, phase_id: `phase-${1392 + index}`, input: { reason, target, ancestor, ...input }, expected, actual,
      passed: JSON.stringify(actual) === JSON.stringify(expected), started_utc: started, ended_utc: new Date().toISOString(),
      execution: '製品評価器とlayoutを直接実行。予算は評価器公開optionsへ指定。PNGは製品Canvas。素材通信のみ空index/langのin-memory adapter。',
      evaluated, layout: frame.layout, strict: observedRaster(strict), draft: observedRaster(draft) };
    results.push(result);
    if (evidenceDirectory) {
      await mkdir(path.join(evidenceDirectory, 'cases'), { recursive: true });
      await writeFile(path.join(evidenceDirectory, 'cases', `${caseId}.json`), JSON.stringify(result, null, 2) + '\n');
    }
    await t.test(`${caseId}: ${reason}, ${target}, ${ancestor}`, () => assert.deepEqual(actual, expected));
  }
  if (evidenceDirectory) await writeFile(path.join(evidenceDirectory, 'matrix-results.json'), JSON.stringify({
    schema: 'r40-quality-matrix-v1', count: results.length, passed: results.filter(row => row.passed).length,
    failed: results.filter(row => !row.passed).length, raster_invocations: results.length * 2,
    cases: results.map(({ case_id, phase_id, input, expected, actual, passed }) => ({ case_id, phase_id,
      input: { reason: input.reason, target: input.target, ancestor: input.ancestor }, expected, actual, passed })),
  }, null, 2) + '\n');
});

const diagnostic = (extra = {}) => ({ nodeId: 'node', bindingIndex: 0, bindingType: 'view', status: 'unresolved',
  reason: 'PROPERTY_UNRESOLVED', targetProperty: 'visible', ...extra });
test('inactive evidence is distinct from missing evidence, and unknown captures never pass', () => {
  assert.equal(summarizeBindingQuality(null).status, 'not_evaluated');
  assert.equal(summarizeBindingQuality({ diagnostics: [] }).status, 'passed');
  assert.equal(summarizeBindingQuality({ stats: { bindingsSeen: 0 } }).status, 'passed');
  assert.equal(summarizeBindingQuality({ stats: { bindingsSeen: 1 }, warnings: [] }).status, 'unknown');
  assert.equal(summarizeBindingQuality({ diagnostics: [], observationCaptureComplete: false }).status, 'unknown');
  assert.equal(summarizeBindingQuality({ diagnostics: [diagnostic({ status: 'inactive', reason: 'DEFINITE_HIDDEN' })] }).status, 'passed');
});
test('noncritical metadata stays inspectable without blocking valid visual/input prerequisites', () => {
  const metadata = summarizeBindingQuality({ diagnostics: [diagnostic({ targetProperty: 'unused_metadata' }),
    diagnostic({ bindingType: 'collection_details', targetProperty: '', reason: 'COLLECTION_CONTEXT_UNRESOLVED' })] });
  assert.equal(metadata.status, 'passed'); assert.equal(metadata.noncritical_count, 2);
  assert.equal(metadata.diagnostic_count, 2); assert.equal(metadata.critical_count, 0);
  assert.equal(summarizeBindingQuality({ diagnostics: [diagnostic({ targetProperty: 'text' })] }).status, 'unknown');
  assert.equal(summarizeBindingQuality({ diagnostics: [diagnostic({ targetProperty: 'texture' })] }).status, 'unknown');
});
test('malformed evidence, truncation, and local native uncertainty remain explicit and bounded', () => {
  assert.equal(summarizeBindingQuality({ diagnostics: [null] }).status, 'failed');
  const many = summarizeBindingQuality({ diagnostics: Array.from({ length: 50001 }, () => diagnostic()) });
  assert.equal(many.status, 'unknown'); assert.equal(many.observation_capture_complete, false);
  assert.equal(many.diagnostics.length, 64); assert.equal(many.critical_count, 50000);
  assert(many.reason_codes.includes('BINDING_QUALITY_CAPTURE_INCOMPLETE'));
  const local = summarizeBindingQuality({ diagnostics: [diagnostic({ bindingIndex: -1, bindingType: 'local_toggle',
    reason: 'LOCAL_STATE_UNRESOLVED', targetProperty: 'toggle_state' })], localToggleDiagnostics: [{ nodeId: 'node' }] });
  assert.equal(local.critical_count, 1, 'same local cause is not counted twice');
});
test('CLI quality keeps resources, bindings and native evidence as independent axes', () => {
  const bindingQuality = summarizeBindingQuality({ diagnostics: [diagnostic()] });
  const quality = buildPreviewQuality({ raster: { complete: true, diagnostics: [], binding_quality: bindingQuality } });
  assert.equal(quality.assets.status, 'passed'); assert.equal(quality.bindings.status, 'unknown');
  assert.equal(quality.interaction.status, 'not_evaluated'); assert.equal(quality.native_comparison.status, 'not_evaluated');
});

test('only a confirmed inactive slider branch is pruned, using final state and safe mode', () => {
  const document = { namespace: 'quality40', slider: { type: 'slider_box', size: [16, 16], enabled: true,
    default_control: 'normal', locked_control: 'locked', controls: [
      { normal: { type: 'panel', size: [16, 16] } },
      { locked: { type: 'panel', size: [16, 16], controls: [{ uncertain: { type: 'panel', ignored: '#missing' } }] } },
    ] } };
  const model = buildUiScreenModelFromJson(document, { filePath: 'ui/quality40.json' });
  const { frame } = frameFor(document);
  const context = { model, propsById: frame.propsById, visibilityMode: 'safe' };
  const selected = summarizeBindingQuality(frame.bindings, context);
  assert.equal(selected.status, 'passed'); assert.equal(selected.confirmed_inactive_state_count, 1);
  assert.equal(summarizeBindingQuality(frame.bindings).status, 'unknown', 'missing context is not proof of inactivity');
  assert.equal(summarizeBindingQuality(frame.bindings, { ...context, visibilityMode: 'structure' }).status, 'unknown');
  for (const enabled of [false, '#unknown']) {
    const propsById = { ...frame.propsById, 'root/slider': { ...frame.propsById['root/slider'], enabled } };
    assert.equal(summarizeBindingQuality(frame.bindings, { ...context, propsById }).status, 'unknown');
  }
});

test('authored unknown gates stay unknown even without binding descriptors, including ignored ancestors', { skip: !backend }, async () => {
  for (const target of ['visible', 'ignored', 'enabled', 'focus_enabled']) {
    const document = { namespace: 'quality40', screen: { type: 'screen', size: [64, 48], ...origins,
      controls: [{ branch: { type: 'panel', size: [32, 32], ...origins, [target]: '#missing',
        controls: [{ child: { type: 'panel', size: [16, 16], ...origins } }] } }] } };
    const { frame } = frameFor(document), result = await renderFramePng(rasterArguments(document, frame));
    assert.equal(result.ok, false, `${target}: unknown authored gate must not be complete`);
    assert.equal(result.binding_quality.status, 'unknown', JSON.stringify(result.binding_quality));
    assert.equal(result.preview_complete, false); assert.equal(result.png, undefined);
  }
});

test('real ZIP inheritance and relayout use the last frame binding diagnosis in both directions', { skip: !backend, timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quality40-reflow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'input.mcpack');
  const inherited = { namespace: 'quality40', base: { type: 'panel', size: [8, 8], ...origins,
    bindings: [{ binding_type: 'global', binding_name: '#gate', binding_name_override: '#visible' }] } };
  const document = { namespace: 'quality40', screen: { type: 'screen', size: [64, 48], ...origins, controls: [
    { image: { type: 'image', texture: 'textures/ui/probe', size: ['default', 'default'], ...origins } },
    { 'guard@quality40.base': {} },
  ] } };
  const image = pngjs.PNG.sync.write({ width: 2, height: 2, data: Buffer.alloc(16, 255) });
  await writeFile(archive, makeZip({ 'manifest.json': manifest,
    'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/base.json', 'ui/quality40.json'] }),
    'ui/base.json': JSON.stringify(inherited), 'ui/quality40.json': JSON.stringify(document),
    'textures/ui/probe.png': image, 'textures/ui/probe.json': '{"base_size":[31,17]}' }));
  const client = await CliClient.start(); t.after(() => client.close());
  const imported = await client.importPack(archive), sources = [{ id: imported.id, kind: 'vanilla', rootPrefix: imported.rootPrefix }];
  const catalog = await client.request('/api/node/catalog', { payload: { sources } });
  const record = catalog.records.find(row => row.qualifiedName === 'quality40.screen');
  const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } });
  assert.equal(projection.ok, true);
  const request = client.request.bind(client), results = [];
  for (const finalKnown of [true, false]) {
    const initialKnown = !finalKnown;
    const frameRequest = { projectionId: projection.nodeProjectionId, recordId: record.id, filePath: record.filePath,
      preset: { width: 64, height: 48 }, generation: 0, visibilityMode: 'safe', mockData: initialKnown ? { '#gate': true } : {} };
    const frame = await request('/api/node/frame', { payload: frameRequest });
    let reflows = 0, latest;
    // Controlled response transition: the product worker still evaluates the
    // inherited source, while its later state input is deliberately changed.
    client.request = async (route, options) => {
      if (route !== '/api/node/frame') return request(route, options);
      reflows++;
      latest = await request(route, { ...options, payload: { ...options.payload, mockData: finalKnown ? { '#gate': true } : {} } });
      return latest;
    };
    const result = await renderFramePng({ client, sources, projection, frame, frameRequest, width: 64, height: 48 });
    assert(reflows > 0, 'resource sidecar must produce actual worker relayout');
    assert.equal(result.ok, finalKnown, JSON.stringify(observedRaster(result)));
    assert.equal(result.binding_quality.status, finalKnown ? 'passed' : 'unknown');
    assert.equal(result.final_frame_summary.frame_sha256, sha256(JSON.stringify(latest)));
    assert.notEqual(result.final_frame_summary.frame_sha256, sha256(JSON.stringify(frame)));
    assert.equal(result.preview_complete, finalKnown);
    results.push({ initialKnown, finalKnown, reflows, initial_bindings: frame.bindings, final_bindings: latest.bindings,
      raster: observedRaster(result), execution: '実ZIP継承、実worker frame再配置。検査adapterで再要求のmockDataだけを意図的に切替。' });
  }
  if (evidenceDirectory) await writeFile(path.join(evidenceDirectory, 'reflow-results.json'), JSON.stringify(results, null, 2) + '\n');
});
