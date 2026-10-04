import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiAudioIntent } from '../src/preview/ui-audio-intent.js';
import { evaluateBindingsForUiModel } from '../src/bindings/bindings-evaluator.js';
import { getUiInteractionEffectiveProps } from '../src/preview/ui-interaction-target.js';
import { summarizeBindingQuality } from '../src/engine/binding-quality40.js';
import { setupAudioMain } from './helpers/ui-audio-main-harness.mjs';
import { createUiAudioPlayer } from '../src/preview/ui-audio-player.js';

// Original controls; no extracted native game definitions or audio assets.
const node = (id, props = {}, children = [], bindings = [], type = 'button') =>
  ({ id, type, props, children, bindings });
const baseContext = { enabled: true, file: { path: 'ui/demo.json' }, screenDefinition: 'demo.root' };
const authored = node('audio', { sound_name: 'demo.melody', sound_volume: .7, sound_pitch: 1.2 });
const request = (target, context = baseContext, extra = {}) => buildUiAudioIntent({
  context, target, interactionId: 'press-1', catalogId: 'catalog-1', packEpoch: 2, ...extra,
});
function evaluatedTarget(control, mockData = {}) {
  const model = { root: control }, bindings = evaluateBindingsForUiModel(model, { mockData });
  const context = { ...baseContext, model, propsById: bindings.propsById, bindings };
  return { context, bindings, target: { node: control, effectiveProps: getUiInteractionEffectiveProps(context, control.id) } };
}

test('audio intent uses selected evaluated scalar values and does not mutate the UI or report playback', () => {
  const control = node('audio', { ...authored.props }, [], ['sound_name', 'sound_volume', 'sound_pitch'].map(property => ({
    binding_type: 'global', binding_name: `#runtime_${property}`, binding_name_override: `#${property}`,
  })));
  const f = evaluatedTarget(control, { '#runtime_sound_name': 'demo.other', '#runtime_sound_volume': .4, '#runtime_sound_pitch': 1.5 });
  const before = JSON.stringify(f.context), intent = request(f.target, f.context);
  assert.deepEqual(intent, { soundName: 'demo.other', soundVolume: .4, soundPitch: 1.5,
    catalogId: 'catalog-1', packEpoch: 2, originScreenId: 'ui/demo.json@demo.root', interactionId: 'press-1' });
  assert.equal(JSON.stringify(f.context), before);
  assert(!Object.hasOwn(intent, 'audibleVerified')); assert(!Object.hasOwn(intent, 'status'));
});

test('unresolved sound name, volume or pitch never requests the retained authored clip', () => {
  for (const property of ['sound_name', 'sound_volume', 'sound_pitch']) {
    const control = node('audio', { ...authored.props }, [], [{ binding_type: 'global',
      binding_name: '#missing_audio_property', binding_name_override: `#${property}` }]);
    const f = evaluatedTarget(control);
    assert.equal(f.target.effectiveProps[property], authored.props[property], 'evaluator retains authored value for inspection');
    assert.equal(f.bindings.diagnostics.find(row => row.targetProperty === property)?.status, 'unresolved');
    assert.equal(summarizeBindingQuality(f.bindings).status, 'unknown');
    assert.equal(request(f.target, f.context), null, `suppress unconfirmed ${property}`);
  }
});

test('audio suppression is scoped to the control and active audio diagnostics', () => {
  const target = { node: authored, effectiveProps: authored.props };
  for (const row of [
    { nodeId: 'other', targetProperty: 'sound_name', status: 'unresolved' },
    { nodeId: 'audio', targetProperty: 'text', status: 'unresolved' },
    { nodeId: 'audio', targetProperty: 'sound_name', status: 'inactive' },
  ]) assert.equal(request(target, { ...baseContext, bindingDiagnostics: [row] }).soundName, 'demo.melody');
  assert.equal(request(target, { ...baseContext, bindingDiagnostics: [], bindingObservationComplete: false }), null);
  assert.equal(request(target, { ...baseContext, bindingObservationComplete: false }), null);
  assert.equal(request(target, { ...baseContext, bindingDiagnostics: Array(50001).fill(null) }), null);
});

test('hidden, ignored or disabled ancestors suppress a child audio control', () => {
  for (const props of [{ enabled: false }, { visible: false }, { ignored: true }]) {
    const root = node('root', props, [authored], [], 'panel');
    const context = { ...baseContext, model: { root }, boxes: [{ id: 'audio', parentId: 'root' }] };
    const target = { node: authored, effectiveProps: getUiInteractionEffectiveProps(context, 'audio') };
    assert.equal(request(target, context), null);
  }
});

test('escape, outside, pending edits and unavailable contexts cannot emit audio intents', () => {
  const target = { node: authored, effectiveProps: authored.props };
  for (const context of [{ enabled: false }, { enabled: true, pocket: true }]) assert.equal(request(target, context), null);
  assert.equal(request(target, baseContext, { runtimeDirty: true }), null);
  for (const event of ['escape', 'outside', 'hover']) assert.equal(request(target, baseContext, { event }), null);
  assert.equal(request(null), null);
});

test('audio remains independent of action mappings and checkbox state; mute and invalid numbers reach reason-coded player validation', () => {
  for (const checked of [true, false]) {
    const control = node('audio', { ...authored.props, toggle_state: checked,
      button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: 'custom.unknown', mapping_type: 'pressed' }] }, [], [], 'toggle');
    assert.equal(request({ node: control, effectiveProps: control.props }).soundName, 'demo.melody');
  }
  for (const sound_volume of [0, -1, '$unresolved_volume']) {
    assert.equal(request({ node: authored, effectiveProps: { ...authored.props, sound_volume } }).soundVolume, sound_volume);
  }
});

test('GUI production wrapper delegates to the same helper and forwards final binding evidence', () => {
  const f = setupAudioMain({ sounds: [{ name: 'demo.melody', volume: .4, pitch: 1.5 }] });
  const context = f.api.getInteractionPreviewContext(f.file.id);
  const target = { node: f.children[0], effectiveProps: getUiInteractionEffectiveProps(context, 'b0') };
  const gui = f.api.buildPreviewAudioIntent(context, target, 'same-press');
  const shared = buildUiAudioIntent({ context, target, interactionId: 'same-press',
    catalogId: 'catalog', packEpoch: gui.packEpoch });
  assert.equal(JSON.stringify(gui), JSON.stringify(shared));
  f.cs.bindingDiagnostics = [{ nodeId: 'b0', targetProperty: 'sound_name', status: 'unresolved' }];
  const unresolved = f.api.getInteractionPreviewContext(f.file.id);
  assert.equal(f.api.buildPreviewAudioIntent(unresolved, target, 'blocked-press'), null);
  for (const player of f.apiPlayer) player.dispose();
});

test('player preparation and mocked source-start retain resolver limitations and never certify speaker or native output', async () => {
  const context = { state: 'running', sampleRate: 48000, destination: {},
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource: () => ({ playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() {}, stop() { this.onended?.(); } }),
    decodeAudioData: async () => ({ length: 5760, numberOfChannels: 1, sampleRate: 48000, duration: .12 }),
  };
  const metadata = { schema: 'jsonui-sound-v1', codec: 'vorbis', channels: 1, contextSampleRate: 48000,
    durationSeconds: .12, encodedBytes: 100, pcmReservationBytes: 40000, filePackId: 'pack',
    contentRevision: 'fixture', filePath: 'sounds/demo.ogg', candidateVolume: 1, candidatePitch: 1, candidateCount: 1,
    definitionCategory: 'ui', candidateIs3D: false, warnings: ['AUDIO_PREVIEW_CATEGORY_MIXER_NOT_APPLIED'] };
  const player = createUiAudioPlayer({ createContext: () => context, getSessionEpoch: () => 1,
    resolveSound: async () => metadata, readBytes: async () => new ArrayBuffer(100) });
  try {
    const intent = request({ node: authored, effectiveProps: authored.props });
    const [prepared] = await player.prepare(intent), started = await player.request({ ...intent, interactionId: 'press-2' });
    assert.equal(prepared.code, 'AUDIO_PREPARED'); assert.equal(started.code, 'AUDIO_STARTED');
    for (const result of [prepared, started]) {
      assert.deepEqual(result.warnings, ['AUDIO_PREVIEW_CATEGORY_MIXER_NOT_APPLIED']);
      assert.equal(result.definitionCategory, 'ui'); assert.equal(result.candidateIs3D, false);
      assert.equal(result.gameMixerVerified, false); assert.equal(result.audibleVerified, false); assert.equal(result.nativeVerified, false);
    }
  } finally { player.dispose(); }
});
