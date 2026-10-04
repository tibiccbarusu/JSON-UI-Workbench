import { createPreviewObservationTrace, capturePreviewInputSnapshot, isPreviewInputContextCurrent, evaluatePreviewInputRelease } from '../../src/preview/preview-observation41.js';
/** Extract actual main audio/effect/input glue. DOM, Node I/O and speaker output are deterministic fakes. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installStudioMainBoundaries22 } from './studio-main-boundaries22.mjs';
import { readFile } from 'node:fs/promises';
import { createUiAudioPlayer } from '../../src/preview/ui-audio-player.js';
import { buildUiAudioIntent } from '../../src/preview/ui-audio-intent.js';
import { findUiInteractionTarget, getUiInteractionEffectiveProps, hitTestUiInteraction } from '../../src/preview/ui-interaction-target.js';
import { resolveUiInteraction, extractUiInteractionActions, findInteractionCollectionAddress } from '../../src/preview/ui-interaction-engine.js';
import { normalizePreviewState } from '../../src/engine/preview-state.js';
import { previewLayoutInputKey, isPreviewInteractionFrameCurrent } from '../../src/preview/interaction-frame-readiness.js';

const source = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
function section(start, end) { const a = source.indexOf(start), b = source.indexOf(end, a); assert(a >= 0 && b > a, start); return source.slice(a, b); }
const code = section('let previewAudioPlayer = null;', 'let previewNavigationEpoch = 0;')
  + section('function presentPreviewInteractionResult(', 'function renderPreviewOperationCapabilities(')
  + section('  const onPointerDown = (ev) => {', '  const onPointerMove = (ev) => {')
  + section('  const onPointerUp = (ev) => {', '  const onPointerCancel = (_ev) => {')
  + section('  // Selection and debug toggles do not rebuild', '  // Debug logging (toggleable');
const node = (id, props = {}, type = 'button') => ({ id, type, props, children: [] });
const mapping = to => ({ from_button_id: 'button.menu_select', to_button_id: to, mapping_type: 'pressed' });

export function setupAudioMain({ sounds = [{ name: 'random.click', action: 'test.unknown' }], resolveGate = null, createContext = true, loggerThrows = false } = {}) {
  const children = sounds.map((sound, index) => node(`b${index}`, { sound_name: sound.name, sound_volume: sound.volume, sound_pitch: sound.pitch,
    ...(sound.action ? { button_mappings: [mapping(sound.action)] } : {}), ...sound.props }, sound.type || 'button'));
  const file = { id: 'screen:ui/test.json', path: 'ui/test.json', readOnly: true, uiModel: { root: node('root', {}, 'screen') }, nodesById: {} };
  file.uiModel.root.children = children; file.nodesById = Object.fromEntries([file.uiModel.root, ...children].map(row => [row.id, row]));
  let state = { files: { currentFileId: file.id, byId: { [file.id]: file } }, preview: { navigation: { enabled: true, actionMap: {} }, mockData: {}, mockDataVersion: 0 }, pack: { status: 'ready' }, ui: { tabs: { center: 'canvas' } }, editor: {} };
  const cs = { previewClosed: false, propsByIdOverride: {}, view: {}, interaction: {},
    layout: { boxes: children.map((row, index) => ({ id: row.id, x: index * 30, y: 0, w: 20, h: 20, parentId: 'root' })), preset: { width: 150000, height: 100 } } };
  const calls = [], diagnostics = [], subscribers = [], handlers = {}, statuses = [], sources = [];
  const canvas = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), focus() {}, setPointerCapture() {}, releasePointerCapture() {} };
  const audioContext = { state: 'suspended', sampleRate: 48000, destination: {},
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource: () => ({ playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() { calls.push(['start']); sources.push(this); }, stop() { calls.push(['stop']); this.onended?.(); } }),
    resume() { calls.push(['resume']); this.state = 'running'; return Promise.resolve(); }, close() { return Promise.resolve(); },
    decodeAudioData: async () => { calls.push(['decode']); return { length: 5760, numberOfChannels: 1, sampleRate: 48000, duration: 0.12 }; } };
  const apiPlayer = [];
  const sandbox = { buildUiAudioIntent, createPreviewObservationTrace, capturePreviewInputSnapshot, isPreviewInputContextCurrent, evaluatePreviewInputRelease, key: file.id, setTimeout, clearTimeout, AbortController, ArrayBuffer, findUiInteractionTarget, getUiInteractionEffectiveProps, hitTestUiInteraction,
    resolveUiInteraction, extractUiInteractionActions, normalizePreviewState, isPreviewInteractionFrameCurrent,
    getLogicalCanvasPreset: canvasState => canvasState.layout.preset,
    previewAssetMetricsRevision: 0, nodeFrameAvailability: true, previewAnimationEvent: 'screen.entrance_push',
    findInteractionCollectionAddress: options => { calls.push(['collectionAddress']); return findInteractionCollectionAddress(options); },
    uiCatalogState: { catalog: { nodeCatalogId: 'catalog' } }, importedPackRuntime: {}, vanillaReferenceRuntime: {}, resourcePackMutationEpoch: 0,
    runtimeStateEditor: { dirty: false }, screenOpenState: { status: 'ready' },
    createUiAudioPlayer: options => {
      const player = createUiAudioPlayer({ ...options, createContext: () => createContext ? audioContext : null, getSessionEpoch: () => 1,
        onDiagnostic: row => { diagnostics.push(row); options.onDiagnostic(row); },
        resolveSound: async data => {
          calls.push(['resolve', data]); if (resolveGate) await resolveGate;
          return { schema: 'jsonui-sound-v1', codec: 'vorbis', channels: 1, contextSampleRate: 48000, durationSeconds: 0.12,
            encodedBytes: 100, pcmReservationBytes: 40000, filePackId: 'pack', contentRevision: data.soundId, filePath: `sounds/${data.soundId}.ogg`,
            policyVersion: 'test', candidateVolume: 1, candidatePitch: 1, candidateCount: 1, candidateIndex: 0 };
        }, readBytes: async () => { calls.push(['read']); return new ArrayBuffer(100); } });
      for (const method of ['unlock', 'request', 'prepare', 'invalidate', 'setPackEpoch', 'setEnabled']) { const fn = player[method]; player[method] = (...args) => { calls.push([method, ...args]); return fn(...args); }; }
      apiPlayer.push(player); return player;
    },
    store: { getState: () => state, subscribe: listener => subscribers.push(listener), dispatch: action => {
      calls.push(['dispatch', action]); if (action.type === 'preview/setMockData') update({ ...state, preview: { ...state.preview, mockData: action.value } }, action);
    } }, actions: { setMockData: value => ({ type: 'preview/setMockData', value }), selectNode: id => ({ type: 'select', id }), clearSelection: () => ({ type: 'clearSelection' }) },
    document: { hidden: false, getElementById: () => null, addEventListener: (name, fn) => { handlers[name] = fn; } },
    window: { addEventListener: (name, fn) => { handlers[name] = fn; } },
    diagnostics: { log(...args) { calls.push(['log', ...args]); if (loggerThrows) throw new Error('LOGGER_FAILED'); } },
    getCanvasKey: id => id, getCanvasState: () => cs, getSelectedPreviewQualifiedName: () => 'test.screen', screenRefFromFile: () => ({}),
    buildClipboardDataSources: () => ({}), capturePreviewClipboardScope: () => ({}),
    buildRepresentativeClassicCollections: () => ({}), buildEffectivePreviewMockData: raw => raw, buildRepresentativeClassicCollectionData: (_rep, raw) => raw,
    listAvailableScreenPackPaths: () => [], hidePreviewEditBoxOverlay() {}, previewPlayback: { state:{seconds:0}, pause() {} }, stopNativeMotionPreview() {},
    safeRender() {}, setStatus: value => statuses.push(value), submitPreviewClipboardEffect: () => ({ status: 'blocked' }),
    navigatePreviewEffect: async effect => { calls.push(['navigate', effect]); sandbox.api.invalidatePreviewAudioForNavigation(effect.interactionId); },
    classifyPreviewStoreChange: () => 'none', workspaceNavigationState: {}, requestCanvasTextureRedraw() {}, scheduledPreviewDataRender: { request() {} }, scheduledWorkspaceRender: { request() {} },
    ensureCanvasViewInitialized() {}, DEFAULT_CANVAS_PRESET: { width: 200, height: 100 }, canvasPxToWorld: (x, y) => ({ x, y }), hitTestBoxes: () => null,
  };
  function update(next, action = { type: 'test/update' }) { const previous = state; state = next; for (const fn of subscribers) fn(next, previous, action); }
  // Model a completed Node frame, with the real production readiness helper.
  // State changes deliberately do not refresh these markers until applyFrame is called.
  function applyFrame({ propsByIdOverride = cs.propsByIdOverride } = {}) {
    const currentFile = state.files.byId[state.files.currentFileId];
    const input = { state, file: currentFile, canvasState: cs, preset: sandbox.getLogicalCanvasPreset(cs),
      assetMetricsRevision: sandbox.previewAssetMetricsRevision, nodeFrameAvailability: sandbox.nodeFrameAvailability,
      animationEvent: sandbox.previewAnimationEvent };
    cs.layoutInputFile = currentFile;
    cs.layoutInputKey = previewLayoutInputKey(input);
    cs.nodeFrameContext = cs.nodeFrameAppliedContext = `${cs.layoutInputKey}|${input.animationEvent}`;
    cs.nodeFrameAppliedFile = currentFile;
    cs.propsByIdOverride = propsByIdOverride;
    assert.equal(isPreviewInteractionFrameCurrent(input), true, 'completed audio fixture frame must be current');
  }
  applyFrame();
  vm.createContext(sandbox);
  installStudioMainBoundaries22(sandbox, source);
  vm.runInContext(code + '\nglobalThis.api={buildPreviewAudioIntent,getPreviewAudioPlayer,prepareCurrentPreviewAudio,commitPreviewInteractionEffects,activatePreviewHit,getInteractionPreviewContext,interactionTarget,invalidatePreviewAudioForNavigation,onPointerDown,onPointerUp,setAudioEnabled(value){previewAudioEnabled=value;previewAudioPreparation=null;getPreviewAudioPlayer();}};', sandbox);
  const event = (index = 0, extra = {}) => ({ isTrusted: true, pointerId: 1, button: 0, clientX: index * 30 + 10, clientY: 10, currentTarget: canvas, ...extra });
  return { sandbox, api: sandbox.api, calls, diagnostics, statuses, audioContext, file, cs, children, apiPlayer, handlers, update, applyFrame, event, get state() { return state; } };
}
