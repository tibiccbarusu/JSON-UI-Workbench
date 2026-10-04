import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRenderer } from '../api.mjs';
import { createRendererServer } from '../api-server.mjs';
import { runCli } from '../cli.mjs';
import { checkedApiRequest } from '../api-request.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const anchor = { anchor_from: 'top_left', anchor_to: 'top_left' };
const mapping = [{ from_button_id: 'button.menu_select', to_button_id: 'button.menu_select', mapping_type: 'pressed' }];
const target = { file: 'ui/test.json', definition: 'sample.screen', width: 100, height: 60, uiScale: 1, frame: 0 };
const descriptor = { title: 'Same form', body: 'No reopen', buttons: [{ text: 'Exit' }] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function setup(t, { badBinding = false, externalToggle = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-headless-input-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pack = path.join(directory, 'input.mcpack'), ogg = await readFile(new URL('./audio-fixtures/click.ogg', import.meta.url));
  const toggle = (offset, extra = {}) => ({ type: 'toggle', size: [20, 10], offset, ...anchor,
    toggle_default_state: false, radio_toggle_group: false, button_mappings: mapping, ...extra });
  const archive = makeZip({ 'manifest.json': manifest,
    'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}',
    'ui/test.json': JSON.stringify({ namespace: 'sample', screen: { type: 'screen', size: [100, 60], ...anchor, controls: [
      { ogg: toggle([0, 0], { sound_name: 'sample.ogg', sound_volume: 0.8, sound_pitch: 1.1 }) },
      { tab_a: toggle([25, 0], { radio_toggle_group: true, toggle_name: 'tabs', toggle_group_forced_index: 0, toggle_group_default_selected: 0 }) },
      { tab_b: toggle([50, 0], { radio_toggle_group: true, toggle_name: 'tabs', toggle_group_forced_index: 1, toggle_group_default_selected: 0 }) },
      { disabled: toggle([0, 15], { enabled: false, sound_name: 'sample.ogg' }) },
      { unknown_action: { type: 'button', size: [20, 10], offset: [25, 15], ...anchor, sound_name: 'sample.ogg',
        button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: 'button.sample_unknown', mapping_type: 'pressed' }] } },
      { hidden_owner: { type: 'panel', size: [20, 10], offset: [50, 15], ...anchor, visible: false, controls: [{ child: toggle([0, 0], { sound_name: 'sample.ogg' }) }] } },
      { surface: { type: 'panel', size: [20, 10], offset: [0, 30], ...anchor, bindings: [
        { binding_type: 'view', source_control_name: 'ogg', source_property_name: '#toggle_state', target_property_name: '#visible', resolve_sibling_scope: true },
      ] } },
      ...(badBinding ? [{ unresolved: { type: 'panel', size: [20, 10], offset: [25, 30], ...anchor,
        bindings: [{ binding_name: '#missing_value', binding_name_override: '#visible' }] } }] : []),
      ...(externalToggle ? [{ external: toggle([50, 30], { bindings: [{ binding_name: '#external_value', binding_name_override: '#toggle_state' }] }) }] : []),
    ] } }),
    'sounds/sound_definitions.json': JSON.stringify({ format_version: '1.20.20', sound_definitions: { 'sample.ogg': { category: 'ui', sounds: [{ name: 'sounds/sample/demo', stream: false, is3D: false }] } } }),
    'sounds/sample/demo.ogg': ogg });
  await writeFile(pack, archive);
  const renderer = await createRenderer(); t.after(() => renderer.close());
  await renderer.import({ pack });
  const state = { form: descriptor, ...(externalToggle ? { mockData: { '#external_value': false } } : {}) };
  const initial = await renderer.render({ ...target, uiInstanceId: 'same-form', state, strictSemantics: !badBinding });
  const ids = Object.fromEntries(initial.frame.layout.boxes.filter(box => ['ogg', 'tab_a', 'tab_b', 'disabled', 'unknown_action', 'surface'].includes(box.id.split('/').at(-1)))
    .map(box => [box.id.split('/').at(-1), box.id]));
  const request = { ...target, uiInstanceId: 'same-form', expectedRevision: 0, nodeId: ids.ogg, state };
  return { renderer, request, initial, ids, pack, directory, archive, ogg };
}

test('SDK projects two OGG-toggle inputs in one explicit form/instance and returns the state needed by render', async t => {
  const { renderer, request, initial, ids, pack, archive, directory } = await setup(t);
  assert(initial.frame.bindings.localToggleState.values[ids.ogg] === false);
  assert(!initial.frame.layout.boxes.some(box => box.id.endsWith('/surface')));
  const before = JSON.stringify(request), first = await renderer.interact(request);
  assert.equal(first.interaction.status, 'applied'); assert.deepEqual(first.effects_executed, ['localTogglePatch']);
  assert.equal(first.localToggleState.values[ids.ogg], true); assert.equal(first.localToggleState.revision, 1);
  assert.equal(first.audioIntent.soundName, 'sample.ogg'); assert.equal(first.audioIntent.soundVolume, 0.8); assert.equal(first.audioIntent.soundPitch, 1.1);
  assert.equal(first.audioIntent.originScreenId, 'ui/test.json@sample.screen');
  assert.equal(first.playback, 'not_executed'); assert.equal(first.native_equivalence, 'not_evaluated');
  const after = await renderer.render({ ...target, uiInstanceId: 'same-form', localToggleState: first.localToggleState, state: { form: descriptor }, strictSemantics: true });
  assert(after.frame.layout.boxes.some(box => box.id.endsWith('/surface')));
  const second = await renderer.interact({ ...request, expectedRevision: 1, localToggleState: first.localToggleState });
  assert.equal(second.localToggleState.values[ids.ogg], false); assert.equal(second.localToggleState.revision, 2);
  assert.equal(second.audioIntent.soundName, 'sample.ogg');
  assert.equal(second.projection_sha256, first.projection_sha256); assert.equal(second.form_descriptor_sha256, first.form_descriptor_sha256);
  assert.equal(first.form_descriptor_sha256, sha(JSON.stringify(descriptor)));
  assert.equal(first.ui_instance_id, second.ui_instance_id); assert.equal(JSON.stringify(request), before);
  assert.deepEqual(await readFile(pack), archive); assert.deepEqual(await readdir(directory), ['input.mcpack']);
});

test('SDK preserves radio exclusivity, refuses foreign/stale/unknown state, and remains usable after rejection', async t => {
  const { renderer, request, initial, ids } = await setup(t);
  const initialState = initial.frame.bindings.localToggleState;
  const selected = await renderer.interact({ ...request, nodeId: ids.tab_b });
  assert.equal(selected.localToggleState.values[ids.tab_a], false); assert.equal(selected.localToggleState.values[ids.tab_b], true);
  await assert.rejects(renderer.interact({ ...request, localToggleState: selected.localToggleState }), { code: 'LOCAL_TOGGLE_REVISION_STALE' });
  await assert.rejects(renderer.interact({ ...request, localToggleState: { ...initialState, instanceId: 'foreign' } }), { code: 'LOCAL_TOGGLE_INSTANCE_MISMATCH' });
  await assert.rejects(renderer.interact({ ...request, localToggleState: { ...initialState, values: { ...initialState.values, 'root/foreign': true } } }), { code: 'LOCAL_TOGGLE_NODE_UNKNOWN' });
  await assert.rejects(renderer.interact({ ...request, nodeId: 'root/missing' }), { code: 'UI_INTERACTION_NODE_UNKNOWN' });
  await assert.rejects(renderer.interact({ ...request, settings: { local_toggle_state: initialState } }), { code: 'API_STATE_CONFLICT' });
  const unchanged = await renderer.render({ ...target, uiInstanceId: 'same-form' });
  assert.deepEqual(unchanged.frame.bindings.localToggleState, initialState, 'stateless projection never changes SDK defaults');
});

test('disabled/hidden/wrong-source inputs emit no audio; unknown action audio is an independent authored intent', async t => {
  const { renderer, request, ids } = await setup(t);
  const disabled = await renderer.interact({ ...request, nodeId: ids.disabled });
  assert.equal(disabled.interaction.status, 'blocked'); assert.equal(disabled.audioIntent, null); assert.deepEqual(disabled.effects_executed, []);
  const hidden = await renderer.interact({ ...request, nodeId: 'root/screen/hidden_owner/child' });
  assert.equal(hidden.interaction.status, 'blocked'); assert.equal(hidden.audioIntent, null); assert.deepEqual(hidden.effects_executed, []);
  const keyboard = await renderer.interact({ ...request, inputSource: 'keyboard' });
  assert.equal(keyboard.interaction.status, 'unsupported'); assert.equal(keyboard.audioIntent, null);
  const escaped = await renderer.interact({ ...request, event: 'escape' });
  assert.equal(escaped.audioIntent, null);
  const unknown = await renderer.interact({ ...request, nodeId: ids.unknown_action });
  assert.equal(unknown.interaction.status, 'unsupported'); assert.equal(unknown.audioIntent.soundName, 'sample.ogg');
  assert.deepEqual(unknown.effects_executed, []);
});

test('sound API resolves the actual imported Vorbis file and refuses arbitrary paths/unknown IDs without reading unrelated files', async t => {
  const { renderer, ogg } = await setup(t);
  const result = await renderer.resolveSound({ soundId: 'sample.ogg', selectionSeed: 'fixed', contextSampleRate: 48000 });
  assert.equal(result.sound.schema, 'jsonui-sound-v2'); assert.equal(result.sound.codec, 'vorbis'); assert.equal(result.sound.container, 'ogg');
  assert.equal(result.sound.filePath, 'sounds/sample/demo.ogg'); assert.equal(result.sound.contentRevision, sha(ogg));
  assert.equal(result.sound.encodedBytes, ogg.length); assert.equal(result.playback, 'not_executed');
  await assert.rejects(renderer.resolveSound({ soundId: 'missing' }), { code: 'AUDIO_DEFINITION_MISSING' });
  await assert.rejects(renderer.resolveSound({ soundId: 'sample.ogg', filePath: '/etc/passwd' }), { code: 'API_REQUEST_INVALID' });
  await assert.rejects(renderer.resolveSound({ soundId: '$unknown' }), { code: 'AUDIO_SOUND_NAME_INVALID' });
  assert.equal((await renderer.resolveSound({ soundId: 'sample.ogg' })).sound.contentRevision, sha(ogg));
});

test('CLI request files use the same input/sound contract and preserve persisted session state', async t => {
  const { renderer, request, pack, directory } = await setup(t);
  const session = path.join(directory, 'session.json'), requestFile = path.join(directory, 'interaction.json'), soundFile = path.join(directory, 'sound.json'), output = path.join(directory, 'result.json');
  await runCli(['import', '--pack', pack, '--session', session]);
  await writeFile(requestFile, JSON.stringify(request)); await writeFile(soundFile, JSON.stringify({ soundId: 'sample.ogg' }));
  const before = await readFile(session), sdk = await renderer.interact(request);
  const result = (await runCli(['interact', '--session', session, '--request-file', requestFile, '--out', output])).result;
  assert.deepEqual(result.localToggleState, sdk.localToggleState); assert.deepEqual(result.interaction, sdk.interaction);
  assert.equal(result.audioIntent.soundName, sdk.audioIntent.soundName); assert.equal(result.projection_sha256, sdk.projection_sha256);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).localToggleState.revision, 1);
  assert.deepEqual(await readFile(session), before);
  const sound = (await runCli(['resolve-sound', '--session', session, '--request-file', soundFile])).result;
  assert.equal(sound.sound.filePath, 'sounds/sample/demo.ogg'); assert.equal(sound.sound.codec, 'vorbis');
  await assert.rejects(runCli(['interact', '--session', session, '--request-file', requestFile, '--out', requestFile, '--force']), { code: 'CLI_SOURCE_PATH_PROTECTED' });
});

test('authenticated HTTP interact/sound routes share SDK projection and keep authority/lifecycle bounded', async t => {
  const { request, pack } = await setup(t);
  const app = await createRendererServer(); t.after(() => app.close());
  const call = async (method, input, auth = true) => {
    const response = await fetch(app.connection.base_url + '/api/renderer/v1/' + method, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + app.connection.token } : {}) }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call('interact', request, false)).status, 401);
  assert.equal((await call('sound', { soundId: 'sample.ogg' }, false)).status, 401);
  assert.equal((await call('import', { pack })).status, 200);
  const first = await call('interact', request); assert.equal(first.status, 200); assert.equal(first.body.result.localToggleState.revision, 1);
  const stale = await call('interact', { ...request, localToggleState: first.body.result.localToggleState });
  assert.equal(stale.status, 400); assert.equal(stale.body.error.code, 'LOCAL_TOGGLE_REVISION_STALE');
  const sound = await call('sound', { soundId: 'sample.ogg' }); assert.equal(sound.status, 200); assert.equal(sound.body.result.sound.codec, 'vorbis');
  assert.equal(JSON.stringify(sound.body).includes(app.connection.token), false);
  assert.equal((await call('sound', { soundId: 'sample.ogg', path: '/etc/passwd' })).status, 400);
  await app.close(); await assert.rejects(fetch(app.connection.base_url + '/health'));
});

test('new request contracts reject non-JSON hooks, invalid IDs/revisions/events and oversized seeds at admission', () => {
  const base = { ...target, uiInstanceId: 'test', nodeId: 'root/screen/control', expectedRevision: 0 };
  for (const bad of [{ expectedRevision: -1 }, { expectedRevision: 1.2 }, { expectedRevision: null }, { nodeId: '' }, { uiInstanceId: 'bad\n' }, { event: 'outside' }, { inputSource: 'gamepad' }, { localTogglePatch: {} }]) {
    assert.throws(() => checkedApiRequest('interact', { ...base, ...bad }), { code: 'API_REQUEST_INVALID' });
  }
  for (const input of [{ soundId: '' }, { soundId: 'sample.ogg', selectionSeed: 'x'.repeat(257) }, { soundId: 'sample.ogg', contextSampleRate: 0 }]) assert.throws(() => checkedApiRequest('resolveSound', input));
  let called = false; const getter = { get soundId() { called = true; return 'sample.ogg'; } };
  assert.throws(() => checkedApiRequest('resolveSound', getter), { code: 'API_REQUEST_INVALID' }); assert.equal(called, false);
});

test('unknown/read-only snapshot diagnostics retain the public input error without hiding unrelated unresolved bindings', async t => {
  const external = await setup(t, { externalToggle: true });
  const localToggleState = { ...external.initial.frame.bindings.localToggleState,
    values: { ...external.initial.frame.bindings.localToggleState.values, 'root/screen/external': true } };
  await assert.rejects(external.renderer.interact({ ...external.request, localToggleState }), error => {
    assert.equal(error.code, 'LOCAL_TOGGLE_NODE_UNKNOWN');
    assert(error.context.quality.bindings.diagnostics.some(item => item.localReason === 'STATE_NODE_READONLY'));
    return true;
  });
  const uncertain = await setup(t, { badBinding: true });
  const unknownState = { ...uncertain.initial.frame.bindings.localToggleState,
    values: { ...uncertain.initial.frame.bindings.localToggleState.values, 'root/foreign': false } };
  await assert.rejects(uncertain.renderer.interact({ ...uncertain.request, localToggleState: unknownState }), error => {
    assert.equal(error.code, 'CLI_BINDING_GATE_FAILED');
    assert(error.context.quality.bindings.diagnostics.some(item => item.localReason === 'STATE_NODE_UNKNOWN'));
    assert(error.context.quality.bindings.diagnostics.some(item => item.bindingType !== 'local_toggle'));
    return true;
  });
});
