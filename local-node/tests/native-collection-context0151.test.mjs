import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { nativeCollectionIndexContextRejected } from '../../editor-core/src/bindings/collection-context.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { summarizeCollectionQuality } from '../../editor-core/src/engine/collection-quality39.js';
import { compilePreviewAnimations, samplePreviewAnimations } from '../../editor-core/src/engine/preview-animation.js';
import { summarizeAnimationQuality } from '../../editor-core/src/engine/animation-quality41.js';
import { runCli } from '../cli.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
const binding = { binding_type: 'collection', binding_collection_name: 'rows', binding_name: '#text', binding_name_override: 'text' };
const label = { type: 'label', text: 'fallback', size: [12, 8], ...origin, bindings: [binding] };
const model = nested => buildUiScreenModelFromJson({ namespace: 'native0151', root: { type: 'collection_panel', collection_name: 'rows', controls: [
  nested ? { decorative: { type: 'panel', controls: [{ row: { type: 'panel', collection_index: 1, controls: [{ label }] } }] } }
    : { row: { type: 'panel', collection_index: 1, controls: [{ label }] } },
] } }, { filePath: 'ui/test.json' });
const evaluate = value => evaluateBindingsForUiModel(value, { collectionData: { rows: [{ '#text': 'A' }, { '#text': 'B' }] } });

test('native contextual rule preserves supported collection owners and internal generated rows', () => {
  for (const parentType of ['collection_panel', 'stack_panel', 'grid']) assert.equal(nativeCollectionIndexContextRejected({ props: { collection_index: 1 }, parentType }), false);
  for (const parentType of ['panel', 'button', undefined]) assert.equal(nativeCollectionIndexContextRejected({ props: { collection_index: 1 }, parentType }), true);
  assert.equal(nativeCollectionIndexContextRejected({ props: { collection_index: 1, __jsonui_preview_collection_name: 'rows' }, parentType: 'panel' }), false);
  assert.equal(nativeCollectionIndexContextRejected({ props: { future_engine_property: true }, parentType: 'panel' }), false);
});

test('ordinary intermediate parent cannot certify an authored collection index; legacy value remains observable', () => {
  const source = model(true), before = JSON.stringify(source), result = evaluate(source);
  assert.equal(summarizeCollectionQuality(result).status, 'failed');
  assert(result.warnings.some(row => row.startsWith('COLLECTION_INDEX_NATIVE_CONTEXT_INVALID:')));
  assert.equal(Object.values(result.propsById).find(props => props.text === 'B')?.text, 'B');
  assert.equal(JSON.stringify(source), before);
  assert.equal(summarizeCollectionQuality(evaluate(model(false))).status, 'passed');
});

test('generated grid rows and grid_position remain supported without exporting artificial indices', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-grid0151-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = path.join(dir, 'input.zip'), session = path.join(dir, 'session.json'), state = path.join(dir, 'state.json');
  const document = { namespace: 'nativegrid', row: label, root: { type: 'grid', collection_name: 'rows', grid_dimensions: [2, 1], grid_item_template: 'nativegrid.row', size: [24, 8], ...origin } };
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}', 'ui/test.json': JSON.stringify(document) }));
  await writeFile(state, JSON.stringify({ collectionData: { rows: [{ '#text': 'A' }, { '#text': 'B' }] } }));
  await runCli(['import', '--session', session, '--pack', archive]);
  await runCli(['settings', '--session', session, '--state-file', state]);
  const result = await runCli(['preview', '--session', session, '--file', 'ui/test.json', '--definition', 'nativegrid.root', '--strict-semantics']);
  assert.equal(result.result.quality.collection.status, 'passed');
  const frame = result.result.frame;
  assert.deepEqual(Object.values(frame.propsById).filter(props => props.text === 'A' || props.text === 'B').map(props => props.text).sort(), ['A', 'B']);
  assert.equal(JSON.stringify(document).includes('collection_index'), false);
});

test('strict JSON refuses invalid native index context before writing an output', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-index0151-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = path.join(dir, 'input.zip'), session = path.join(dir, 'session.json'), state = path.join(dir, 'state.json'), output = path.join(dir, 'blocked.json');
  const document = { namespace: 'badnative', root: { type: 'panel', size: [32, 16], ...origin, controls: [{ row: { type: 'panel', collection_index: 0, size: [16, 8], ...origin } }] } };
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}', 'ui/test.json': JSON.stringify(document) }));
  await writeFile(state, JSON.stringify({ collectionData: { rows: [{ '#text': 'A' }] } }));
  await runCli(['import', '--session', session, '--pack', archive]);
  await runCli(['settings', '--session', session, '--state-file', state]);
  const args = ['preview', '--session', session, '--file', 'ui/test.json', '--definition', 'badnative.root'];
  const observed = await runCli(args); assert.equal(observed.result.quality.collection.status, 'failed');
  await assert.rejects(runCli([...args, '--strict-semantics', '--out', output]), { code: 'CLI_COLLECTION_GATE_FAILED' });
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('bounded native-context warnings cannot claim complete observation', () => {
  const document = { namespace: 'bounded', root: { type: 'panel', controls: Array.from({ length: 300 }, (_, i) => ({ ['row' + i]: { type: 'panel', collection_index: i } })) } };
  const result = evaluateBindingsForUiModel(buildUiScreenModelFromJson(document, { filePath: 'ui/test.json' }));
  assert.equal(result.warnings.filter(row => row.startsWith('COLLECTION_INDEX_NATIVE_CONTEXT_INVALID:')).length, 256);
  assert.equal(result.observationCaptureComplete, false);
  assert.equal(summarizeCollectionQuality(result).status, 'failed');
});

test('offset looping rejected in actual native log is unknown; explicit next cycle remains supported', () => {
  const ui = { namespace: 'animation0151', root: { id: 'root', props: { anims: ['@animation0151.move'] }, children: [] } };
  const definition = { anim_type: 'offset', from: [0, 0], to: [10, 0], duration: 1, looping: true };
  const plan = compilePreviewAnimations(ui, { definitions: { 'animation0151.move': definition } });
  assert.equal(summarizeAnimationQuality({ observation: plan.observation }).status, 'unknown');
  assert(plan.diagnostics.some(row => row.code === 'ANIMATION_LOOPING_NATIVE_REJECTED'));
  assert.deepEqual(samplePreviewAnimations(plan, .5).propsById.root.offset, [5, 0]);
  const { looping, ...nativeDefinition } = definition;
  const fixed = compilePreviewAnimations(ui, { definitions: { 'animation0151.move': { ...nativeDefinition, next: '@animation0151.move' } } });
  assert.equal(summarizeAnimationQuality({ observation: fixed.observation }).status, 'passed');
});
