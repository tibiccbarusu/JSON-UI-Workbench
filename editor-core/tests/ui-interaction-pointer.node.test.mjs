import { createPreviewObservationTrace, capturePreviewInputSnapshot, isPreviewInputContextCurrent, evaluatePreviewInputRelease } from '../src/preview/preview-observation41.js';
/** mainの実pointer handlerを抽出したNodeイベント検査。ブラウザ実機検査ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { installStudioMainBoundaries22 } from './helpers/studio-main-boundaries22.mjs';
import { hitTestUiInteraction, getUiInteractionEffectiveProps } from '../src/preview/ui-interaction-target.js';
import { applySlotTransfer, findInteractionCollectionAddress } from '../src/preview/ui-interaction-engine.js';
import { hitTestBoxes, canvasPxToWorld, findNearestLayoutNodeByType } from '../src/preview/canvas-preview.js';
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('const onPointerDown =', source.indexOf('function renderCanvasPanel'));
const end = source.indexOf('/** @param {MouseEvent}', start);
const helperStart = source.indexOf('function getInteractionHitProps('), helperEnd = source.indexOf('function interactionTarget(', helperStart);
assert(start >= 0 && end > start && helperStart > 0);
const region = source.slice(start, end), helpers = source.slice(helperStart, helperEnd);
function setup({ enabled = true } = {}) {
  const item = { '#item_valid': true, __jsonui_preview_item_id: 'minecraft:diamond', __jsonui_preview_item_count: 1, '#is_selected_slot': false };
  const empty = { '#item_valid': false, '#is_selected_slot': false };
  const propsA = { collection_index: 0, __jsonui_preview_collection_name: 'inventory_items' }, propsB = { collection_index: 1, __jsonui_preview_collection_name: 'inventory_items' };
  const nodesById = { a: { id: 'a', type: 'button', props: propsA }, b: { id: 'b', type: 'button', props: propsB } };
  const model = {}, file = { id: 'screen:ui/test.json', readOnly: true, nodesById, uiModel: model };
  const state = { files: { currentFileId: file.id, byId: { [file.id]: file } }, editor: { selection: null }, preview: { mockDataVersion: 0 } };
  const boxes = [{ id: 'a', type: 'button', x: 0, y: 0, w: 10, h: 10, order: 0 }, { id: 'b', type: 'button', x: 20, y: 0, w: 10, h: 10, order: 1 }];
  const cs = { layout: { boxes, preset: { width: 100, height: 100 } }, view: { initialized: true, zoom: 1, viewX: 0, viewY: 0 }, interaction: {} };
  const context = { enabled, pocket: false, model, nodesById, boxes, propsById: {}, state, file, collectionData: { inventory_items: [item, empty] } };
  const ghost = { hidden: true, style: {}, textContent: '' }, captures = new Set(), releases = [], activated = [], results = [], dispatches = [];
  const canvas = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), focus() {}, setPointerCapture(id) { captures.add(id); }, releasePointerCapture(id) { captures.delete(id); releases.push(id); } };
  const sandbox = { createPreviewObservationTrace, capturePreviewInputSnapshot, isPreviewInputContextCurrent, evaluatePreviewInputRelease, hitTestUiInteraction, getUiInteractionEffectiveProps, key: 'key', getCanvasState: () => cs, ensureCanvasViewInitialized() {}, DEFAULT_CANVAS_PRESET: { width: 100, height: 100 }, canvasPxToWorld, hitTestBoxes, findNearestLayoutNodeByType, findInteractionCollectionAddress, applySlotTransfer, getInteractionPreviewContext: () => context, store: { getState: () => state, dispatch: action => dispatches.push(action) }, actions: { selectNode: id => ({ type: 'SELECT', id }), clearSelection: () => ({ type: 'CLEAR' }) }, document: { getElementById: id => id === 'preview-slot-drag' ? ghost : id === 'preview-canvas' ? canvas : null }, CANVAS_INTERACTION_THRESHOLD_PX: 4, requestCanvasTextureRedraw() {}, startNativeMotionPreview() {}, activatePreviewHit: (...args) => activated.push(args), presentPreviewInteractionResult(result) { results.push(result); if (result.status === 'applied') for (const effect of result.effects) if (effect.type === 'collectionPatch') Object.assign(context.collectionData, effect.patch); }, drawCanvasNow() {}, isCanvasNodeTransformable: () => false, isCanvasNodeResizable: () => false, getResizeHandlesForBox: () => [], hitTestResizeHandles: () => null };
  // 音声は専用統合試験で扱い、既存drag/capture回帰ではOFFへ固定する。
  sandbox.previewInputTrace = createPreviewObservationTrace();
  sandbox.previewPlayback = {state:{seconds:0}};
  sandbox.previewAudioEnabled = false;
  sandbox.buildPreviewAudioIntent = () => null;
  vm.createContext(sandbox); installStudioMainBoundaries22(sandbox, source); vm.runInContext(helpers + region + '\nglobalThis.api={down:onPointerDown,move:onPointerMove,up:onPointerUp,cancel:onPointerCancel,cancelCommon:cancelPreviewPointerInteraction};', sandbox);
  const event = (x = 5, more = {}) => ({ currentTarget: canvas, clientX: x, clientY: 5, pointerId: 1, button: 0, ...more });
  return { context, cs, ghost, captures, releases, activated, results, dispatches, canvas, api: sandbox.api, event };
}
test('primary ON click triggers activation once and releases pointer capture', () => {
  const h = setup(); h.api.down(h.event()); h.api.up(h.event()); assert.equal(h.activated.length, 1); assert.equal(h.captures.size, 0);
});
test('OFF click selects only and never activates gameplay preview', () => {
  const h = setup({ enabled: false }); h.api.down(h.event()); h.api.up(h.event()); assert.equal(h.activated.length, 0); assert.equal(h.results.length, 0); assert.equal(h.dispatches[0].type, 'SELECT');
});
test('slot drag invokes atomic engine move without activating button', () => {
  const h = setup(); h.api.down(h.event()); h.api.move(h.event(25)); assert.equal(h.ghost.hidden, false); h.api.up(h.event(25)); assert.equal(h.results[0].status, 'applied'); assert.equal(h.activated.length, 0); assert.equal(h.context.collectionData.inventory_items[1].__jsonui_preview_item_id, 'minecraft:diamond'); assert.equal(h.ghost.hidden, true);
});
test('cancelled drag cannot move or activate on subsequent pointerup', () => {
  const h = setup(); h.api.down(h.event()); h.api.move(h.event(25)); h.api.cancel(h.event(25)); h.api.up(h.event(25)); assert.equal(h.results.length, 0); assert.equal(h.activated.length, 0); assert.equal(h.ghost.hidden, true);
});
test('mid-drag data version or model changes release capture and hide ghost', () => {
  for (const mutate of [h => h.context.state.preview.mockDataVersion++, h => h.context.model = {}, h => h.context.enabled = false]) {
    const h = setup(); h.api.down(h.event()); h.api.move(h.event(25)); mutate(h); h.api.move(h.event(26)); assert.equal(h.cs.interaction.active, false); assert.equal(h.ghost.hidden, true); assert.equal(h.captures.size, 0); h.api.up(h.event(26)); assert.equal(h.results.length, 0);
  }
});
test('disabled destination cannot receive drag payload', () => {
  const h = setup(); h.context.propsById.b = { enabled: false }; h.api.down(h.event()); h.api.move(h.event(25)); h.api.up(h.event(25)); assert.equal(h.results[0].status, 'blocked'); assert.equal(h.context.collectionData.inventory_items[0].__jsonui_preview_item_id, 'minecraft:diamond');
});
test('release outside any slot never deletes item', () => {
  const h = setup(); h.api.down(h.event()); h.api.move(h.event(80)); h.api.up(h.event(80)); assert.equal(h.results[0].status, 'blocked'); assert.equal(h.context.collectionData.inventory_items[0].__jsonui_preview_item_id, 'minecraft:diamond');
});
test('common close/mode-change cancellation drops ghost and capture', () => {
  const h = setup(); h.api.down(h.event()); h.api.move(h.event(25)); h.api.cancelCommon('key', h.canvas); assert.equal(h.ghost.hidden, true); assert.equal(h.captures.size, 0); assert.equal(h.cs.interaction.active, false);
});
test('Pocket cannot start interaction mode even when requested ON', () => {
  const h = setup(); h.context.pocket = true; h.api.down(h.event()); h.api.up(h.event()); assert.equal(h.activated.length, 0); assert.equal(h.results.length, 0);
});

test('R41 fresh frame after semantic local toggle or screen change cannot authorize held release', () => {
  for(const change of [h=>h.context.localToggleState={revision:2},h=>h.context.uiInstanceId='other',h=>h.context.screenDefinition='other',h=>h.context.file={id:'other'}]){
    const h=setup();h.context.localToggleState={revision:1};h.api.down(h.event());change(h);h.api.up(h.event());assert.equal(h.activated.length,0);assert.equal(h.captures.size,0);
  }
});
test('R41 unrelated pointer release preserves the captured interaction',()=>{
  const h=setup();h.api.down(h.event());h.api.up(h.event(5,{pointerId:2}));assert.equal(h.cs.interaction.active,true);assert.equal(h.captures.size,1);
  h.api.up(h.event());assert.equal(h.activated.length,1);assert.equal(h.captures.size,0);
});
