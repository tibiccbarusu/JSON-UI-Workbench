import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { summarizeBindingQuality } from '../../editor-core/src/engine/binding-quality40.js';
import { initializeLocalToggleState, applyLocalTogglePatch } from '../../editor-core/src/preview/local-toggle-state.js';
import { createRenderer } from '../api.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const model = () => buildUiScreenModelFromJson({ namespace: 'membership0160', root: { type: 'panel', size: [64, 32], controls: [
  { local: { type: 'toggle', size: [16, 16], toggle_default_state: false, radio_toggle_group: false,
    button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: 'button.menu_select', mapping_type: 'pressed' }] } },
  { external: { type: 'toggle', size: [16, 16], bindings: [{ binding_name: '#flag', binding_name_override: '#toggle_state' }] } },
  { hidden: { type: 'panel', visible: false, controls: [{ passive: { type: 'panel' } }] } },
] } }, { filePath: 'ui/test.json' });
const snapshot = values => ({ version: 1, instanceId: 'same-ui', revision: 7, values });
const evaluate = values => evaluateBindingsForUiModel(model(), { uiInstanceId: 'same-ui', localToggleState: snapshot(values), mockData: { '#flag': true } });

// A snapshot is allowed to carry supported hidden local controls, but passive
// or externally bound controls do not acquire local ownership from an ID.
test('unknown incoming snapshot IDs are diagnosed while supported values and source snapshot remain intact', () => {
  const source = model(), input = snapshot({ 'root/root/local': true, 'root/root/typo': false }), before = JSON.stringify(input);
  const result = initializeLocalToggleState(source, { uiInstanceId: 'same-ui', localToggleState: input });
  assert.deepEqual({ ...result.state.values }, { 'root/root/local': true });
  assert.equal(result.state.revision, 7); assert.equal(result.overrides['root/root/local'], true);
  assert.equal(Object.hasOwn(result.overrides, 'root/root/typo'), false);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, 'LOCAL_TOGGLE_STATE_UNRESOLVED');
  assert.equal(result.diagnostics[0].reason, 'STATE_NODE_UNKNOWN');
  assert.equal(JSON.stringify(input), before);
  const evaluated = evaluate(input.values);
  assert.equal(summarizeBindingQuality(evaluated).status, 'unknown');
  assert(evaluated.diagnostics.some(row => row.targetProperty === 'toggle_state' && row.localReason === 'STATE_NODE_UNKNOWN'));
});

test('externally bound toggles keep external ownership and passive hidden controls cannot suppress snapshot membership errors', () => {
  const result = evaluate({ 'root/root/local': false, 'root/root/external': false, 'root/root/hidden/passive': true });
  assert.deepEqual({ ...result.localToggleState.values }, { 'root/root/local': false });
  assert.equal(result.propsById['root/root/external'].toggle_state, true, 'input does not override global binding');
  const membership = result.localToggleDiagnostics.filter(row => row.reason.startsWith('STATE_NODE_'));
  assert.deepEqual(membership.map(row => row.reason).sort(), ['STATE_NODE_READONLY', 'STATE_NODE_UNKNOWN']);
  assert(membership.every(row => row.status === 'unresolved'));
  assert.equal(summarizeBindingQuality(result).critical_count, 2);
});

test('snapshot membership observation is bounded and truncation cannot certify complete bindings', () => {
  const unknown = Object.fromEntries(Array.from({ length: 300 }, (_, index) => ['foreign-' + index, true]));
  const result = evaluate({ 'root/root/local': true, ...unknown });
  assert.equal(result.localToggleDiagnostics.filter(row => row.reason === 'STATE_NODE_UNKNOWN').length, 256);
  assert.equal(result.localToggleDiagnostics.filter(row => row.reason === 'STATE_NODE_DIAGNOSTIC_LIMIT').length, 1);
  assert.equal(result.observationCaptureComplete, false);
  const quality = summarizeBindingQuality(result);
  assert.equal(quality.status, 'unknown'); assert.equal(quality.observation_capture_complete, false);
  assert.equal(quality.diagnostics.length, 64);
  assert.deepEqual({ ...result.localToggleState.values }, { 'root/root/local': true });
});

test('valid snapshots stay passed and patch membership rejection remains atomic', () => {
  const result = evaluate({ 'root/root/local': true });
  assert.equal(summarizeBindingQuality(result).status, 'passed');
  assert.equal(result.localToggleDiagnostics.length, 0);
  const before = JSON.stringify(result.localToggleState);
  const patch = applyLocalTogglePatch(result.localToggleState, { type: 'localTogglePatch', instanceId: 'same-ui', revision: 7,
    changes: { 'root/root/local': false, 'root/root/foreign': true } });
  assert.equal(patch.ok, false); assert.equal(patch.error.code, 'LOCAL_TOGGLE_NODE_UNKNOWN');
  assert.equal(JSON.stringify(result.localToggleState), before);
});

test('SDK draft JSON diagnoses a snapshot typo and strict JSON/PNG refuses it without changing known values', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'snapshot-membership0160-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const pack = path.join(dir, 'input.mcpack');
  const document = { namespace: 'membership0160', root: { type: 'panel', size: [64, 32], controls: [
    { local: { type: 'toggle', size: [16, 16], toggle_default_state: false, radio_toggle_group: false } },
  ] } };
  await writeFile(pack, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}', 'ui/test.json': JSON.stringify(document) }));
  const renderer = await createRenderer(); t.after(() => renderer.close()); await renderer.import({ pack });
  const request = { file: 'ui/test.json', definition: 'membership0160.root', uiInstanceId: 'same-ui',
    localToggleState: snapshot({ 'root/root/local': true, 'root/root/typo': false }), width: 64, height: 32, uiScale: 1, frame: 0 };
  const draft = await renderer.render(request);
  assert.equal(draft.quality.bindings.status, 'unknown');
  assert.deepEqual({ ...draft.frame.bindings.localToggleState.values }, { 'root/root/local': true });
  for (const format of ['json', 'png']) await assert.rejects(renderer.render({ ...request, format, strictSemantics: true }), { code: 'CLI_BINDING_GATE_FAILED' });
  const valid = await renderer.render({ ...request, localToggleState: snapshot({ 'root/root/local': true }), strictSemantics: true });
  assert.equal(valid.quality.bindings.status, 'passed');
});
