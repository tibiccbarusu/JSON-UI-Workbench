import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli, HELP_JA, HELP_EN } from '../cli.mjs';
import { prepareTypedCliState, settingsChangeInvalidatesState } from '../cli-state38.mjs';
import { cliCapabilities28 } from '../cli-capabilities28.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
const evidenceDirectory = process.env.QUALITY40_EVIDENCE_DIR;
async function evidence(name, data) {
  if (!evidenceDirectory) return;
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(path.join(evidenceDirectory, name), JSON.stringify(data, null, 2) + '\n');
}
async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cli-binding40-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = path.join(directory, 'session.json'), archive = path.join(directory, 'pack.mcpack');
  const toggle = index => ({ type: 'toggle', size: [8, 8], ...origin,
    toggle_name: 'tabs', radio_toggle_group: true, toggle_group_forced_index: index,
    toggle_group_default_selected: 0, toggle_default_state: index === 0 });
  const page = source => ({ type: 'panel', size: [16, 16], ...origin, bindings: [{ binding_type: 'view',
    source_control_name: source, source_property_name: '#toggle_state', target_property_name: '#visible' }] });
  const document = { namespace: 'cli40', screen: { type: 'screen', size: [64, 48], ...origin, controls: [
    { first: toggle(0) }, { second: toggle(1) }, { first_page: page('first') }, { second_page: page('second') },
  ] }, unknown: { type: 'screen', size: [64, 48], ...origin, controls: [
    { gate: { type: 'panel', size: [16, 16], ...origin, bindings: [{ binding_type: 'view',
      source_property_name: '#missing', target_property_name: '#visible' }] } },
  ] } };
  await writeFile(archive, makeZip({ 'manifest.json': manifest,
    'ui/_ui_defs.json': '{"ui_defs":["ui/cli40.json"]}', 'ui/cli40.json': JSON.stringify(document) }));
  await runCli(['import', '--session', session, '--pack', archive]);
  const preview = name => ['preview', '--session', session, '--file', 'ui/cli40.json', '--definition', `cli40.${name}`,
    '--width', '64', '--height', '48', '--ui-scale', '1'];
  return { directory, session, preview };
}

test('CLI initializes one local radio page and accepts only an explicit matching-instance state snapshot', { timeout: 60000 }, async t => {
  const { directory, session, preview } = await setup(t);
  const initial = await runCli([...preview('screen'), '--strict-semantics']);
  assert.equal(initial.result.quality.bindings.status, 'passed');
  const state = initial.result.frame.bindings.localToggleState;
  assert.equal(state.instanceId, 'jsonui-cli');
  const first = Object.keys(state.values).find(key => key.endsWith('/first'));
  const second = Object.keys(state.values).find(key => key.endsWith('/second'));
  assert.deepEqual([state.values[first], state.values[second]], [true, false]);
  assert(initial.result.frame.layout.boxes.some(box => box.id.endsWith('/first_page')));
  assert(!initial.result.frame.layout.boxes.some(box => box.id.endsWith('/second_page')));
  const snapshot = { ...state, revision: state.revision + 1, values: { ...state.values, [first]: false, [second]: true } };
  const settingsPath = path.join(directory, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ local_toggle_state: snapshot }));
  await runCli(['settings', '--session', session, '--file', settingsPath]);
  const changed = await runCli([...preview('screen'), '--strict-semantics']);
  assert.equal(changed.result.frame.bindings.localToggleState.instanceId, 'jsonui-cli');
  assert.equal(changed.result.frame.bindings.localToggleState.revision, 1);
  assert(!changed.result.frame.layout.boxes.some(box => box.id.endsWith('/first_page')));
  assert(changed.result.frame.layout.boxes.some(box => box.id.endsWith('/second_page')));
  assert.equal(changed.result.quality.interaction.status, 'not_evaluated', 'snapshot injection does not prove a pointer click');
  const saved = await readFile(session, 'utf8');
  const operationPath = path.join(directory, 'move.json');
  await writeFile(operationPath, JSON.stringify({ type: 'move', path: 'ui/cli40.json', pointer: '/screen/controls/3/second_page', offset: [3, 4] }));
  const draft = await runCli(['draft', '--session', session, '--file', 'ui/cli40.json', '--definition', 'cli40.screen',
    '--operation', operationPath, '--width', '64', '--height', '48', '--ui-scale', '1']);
  assert.deepEqual(draft.result.frame.bindings.localToggleState, changed.result.frame.bindings.localToggleState);
  assert(draft.result.frame.layout.boxes.some(box => box.id.endsWith('/second_page')));
  assert(!draft.result.frame.layout.boxes.some(box => box.id.endsWith('/first_page')));
  assert.equal(await readFile(session, 'utf8'), saved, 'draft keeps local snapshot and session unchanged');
  await writeFile(settingsPath, JSON.stringify({ ui_instance_id: 'other' }));
  await assert.rejects(runCli(['settings', '--session', session, '--file', settingsPath]), { code: 'LOCAL_TOGGLE_INSTANCE_MISMATCH' });
  assert.equal(await readFile(session, 'utf8'), saved);
  await writeFile(settingsPath, JSON.stringify({ ui_instance_id: 'other', local_toggle_state: null }));
  await runCli(['settings', '--session', session, '--file', settingsPath]);
  const reset = await runCli([...preview('screen'), '--strict-semantics']);
  assert.equal(reset.result.frame.bindings.localToggleState.instanceId, 'other');
  assert.deepEqual([reset.result.frame.bindings.localToggleState.values[first], reset.result.frame.bindings.localToggleState.values[second]], [true, false]);
  await evidence('cli-state-results.json', { initial_state: state, injected_state: snapshot,
    changed_state: changed.result.frame.bindings.localToggleState, reset_state: reset.result.frame.bindings.localToggleState,
    changed_quality: changed.result.quality, instance_mismatch_preserved_session: true });
});

test('CLI local state rejects hostile shape, nonboolean values and invalid instances without saving', { timeout: 60000 }, async t => {
  const { directory, session } = await setup(t), settingsPath = path.join(directory, 'settings.json');
  const original = await readFile(session, 'utf8');
  const state = { version: 1, instanceId: 'jsonui-cli', revision: 0, values: {} };
  const invalid = [
    [{ local_toggle_state: { ...state, values: { id: 'true' } } }, 'LOCAL_TOGGLE_VALUES_INVALID'],
    [{ local_toggle_state: { ...state, revision: -1 } }, 'LOCAL_TOGGLE_STATE_INVALID'],
    [{ local_toggle_state: { ...state, instanceId: 'foreign' } }, 'LOCAL_TOGGLE_INSTANCE_MISMATCH'],
    [{ local_toggle_state: { ...state, values: JSON.parse('{"__proto__":true}') } }, 'LOCAL_TOGGLE_VALUES_INVALID'],
    [{ ui_instance_id: 'bad\ninstance' }, 'LOCAL_TOGGLE_INSTANCE_INVALID'],
  ];
  for (const [settings, code] of invalid) {
    await writeFile(settingsPath, JSON.stringify(settings));
    await assert.rejects(runCli(['settings', '--session', session, '--file', settingsPath]), { code });
    assert.equal(await readFile(session, 'utf8'), original);
  }
});

test('typed replacement detects local-only state, clears it explicitly and invalidates old normalized evidence', { timeout: 60000 }, async t => {
  const { directory, session } = await setup(t), settingsPath = path.join(directory, 'settings.json'), typedPath = path.join(directory, 'typed.json');
  const local = { version: 1, instanceId: 'jsonui-cli', revision: 4, values: { 'root/s/x': true } };
  await writeFile(settingsPath, JSON.stringify({ local_toggle_state: local }));
  await runCli(['settings', '--session', session, '--file', settingsPath]);
  await writeFile(typedPath, JSON.stringify({ form: { type: 'action', title: 'A', buttons: [] } }));
  await assert.rejects(runCli(['settings', '--session', session, '--state-file', typedPath]), { code: 'CLI_STATE_REPLACEMENT_REQUIRED' });
  const replaced = await runCli(['settings', '--session', session, '--state-file', typedPath, '--replace-state']);
  assert.equal(replaced.result.settings.local_toggle_state, null);
  assert.equal(replaced.result.settings.ui_instance_id, 'jsonui-cli');
  assert(replaced.result.state_evidence.replaces.includes('local_toggle_state'));
  await writeFile(settingsPath, JSON.stringify({ ui_instance_id: 'fresh' }));
  const changed = await runCli(['settings', '--session', session, '--file', settingsPath]);
  assert.equal(changed.result.state_evidence, undefined);
  assert.equal(JSON.parse(await readFile(session, 'utf8')).preview_state, undefined);
});

test('unknown CLI bindings block strict JSON and PNG, with strict taking priority over explicit partial output', { timeout: 60000, skip: !loadRasterBackend() }, async t => {
  const { directory, session, preview } = await setup(t), blocked = path.join(directory, 'blocked.png');
  const observed = await runCli(preview('unknown'));
  assert.equal(observed.result.quality.bindings.status, 'unknown');
  assert.equal(observed.result.stage_diagnostics.bindings.enforcement, 'observation_only');
  await assert.rejects(runCli([...preview('unknown'), '--strict-semantics']), { code: 'CLI_BINDING_GATE_FAILED' });
  await assert.rejects(runCli([...preview('unknown'), '--out', blocked]), { code: 'RASTER_BINDING_INCOMPLETE' });
  await assert.rejects(readFile(blocked), { code: 'ENOENT' });
  await assert.rejects(runCli([...preview('unknown'), '--out', blocked, '--strict-semantics', '--allow-partial']), { code: 'CLI_BINDING_GATE_FAILED' });
  await assert.rejects(readFile(blocked), { code: 'ENOENT' });
  const output = path.join(directory, 'draft.png');
  const partial = await runCli([...preview('unknown'), '--out', output, '--allow-partial']);
  assert.equal(partial.result.draft, true); assert.equal(partial.result.preview_complete, false);
  assert.equal(partial.result.complete, true); assert.equal(partial.result.binding_quality.status, 'unknown');
  assert.equal(partial.result.native_equivalence.status, 'not_evaluated');
  assert((await readFile(output)).length > 0);
  await assert.rejects(runCli([...preview('unknown'), '--format', 'png', '--allow-partial']), { code: 'CLI_OUTPUT_REQUIRED' });
  assert.equal(partial.result.frame_stage, 'after_resource_measurement');
  const validation = await runCli(['validate', '--session', session, '--file', 'ui/cli40.json', '--definition', 'cli40.unknown', '--strict-semantics']);
  assert.equal(validation.result.quality.bindings.status, 'not_evaluated', 'validate does not execute runtime frame');
  await evidence('cli-binding-gate-results.json', { observed_quality: observed.result.quality,
    strict_json: 'CLI_BINDING_GATE_FAILED', normal_png: 'RASTER_BINDING_INCOMPLETE',
    strict_and_partial: 'CLI_BINDING_GATE_FAILED', no_blocked_artifact: true,
    partial: { complete: partial.result.complete, preview_complete: partial.result.preview_complete,
      draft: partial.result.draft, binding_quality: partial.result.binding_quality, native_equivalence: partial.result.native_equivalence },
    validation_binding_quality: validation.result.quality.bindings });
});

test('state helper and capabilities distinguish static snapshots from pointer/audio execution', () => {
  assert.equal(settingsChangeInvalidatesState({ local_toggle_state: null }), true);
  assert.equal(settingsChangeInvalidatesState({ ui_instance_id: 'changed' }), true);
  const prepared = prepareTypedCliState('{"form":{"type":"action","title":"A","buttons":[]}}', {
    ui_instance_id: 'preserved', local_toggle_state: { version: 1, instanceId: 'preserved', revision: 0, values: {} },
  }, true);
  assert.equal(prepared.settings.local_toggle_state, null); assert.equal(prepared.settings.ui_instance_id, 'preserved');
  const features = cliCapabilities28().features;
  assert.equal(features.find(row => row.id === 'local-toggle-state').state, 'conditional');
  assert.equal(features.find(row => row.id === 'binding-quality').state, 'supported');
  assert.equal(features.find(row => row.id === 'pointer-audio-clipboard').state, 'not-exposed');
  assert(HELP_JA.includes('local_toggle_state')); assert(HELP_EN.includes('local_toggle_state'));
  assert(HELP_EN.includes('strict takes precedence'));
});
