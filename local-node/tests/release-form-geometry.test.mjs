import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizePreviewState } from '../../editor-core/src/engine/preview-state.js';
import { normalizeModalForm } from '../../editor-core/src/engine/preview-modal-form.js';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { buildRepresentativeClassicCollections } from '../../editor-core/src/engine/representative-classic-runtime.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { buildDrawEvidence, DRAW_EVIDENCE_LIMITS } from '../frame-draw-evidence39.mjs';
import { runCli } from '../cli.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

test('explicit zero-content ModalForm is rejected before projection, absent state is not', () => {
  assert.throws(() => normalizePreviewState({ form: { type: 'modal', elements: [] } }), { code: 'PREVIEW_STATE_MODAL_EMPTY_CONTENT' });
  assert.doesNotThrow(() => normalizePreviewState({}));
  assert.doesNotThrow(() => normalizePreviewState({ collectionData: { custom_form: [] } }));
  const shell = normalizePreviewState({ form: { type: 'modal', elements: [{ type: 'label', text: 'Read-only shell' }] } });
  assert.equal(shell.mockData['#custom_form_length'], 1);
  assert.equal(shell.collectionData.custom_form[0].__jsonui_preview_factory_control_id, 'label');
  assert(shell.diagnostics.some(row => row.code === 'PREVIEW_STATE_MODAL_DIRECT_DEFINITION'));
});

test('sparse content and option arrays are rejected rather than silently skipping indices', () => {
  const elements = Array(2); elements[1] = { type: 'label', text: 'last' };
  assert.throws(() => normalizeModalForm({ type: 'modal', elements }), { code: 'PREVIEW_STATE_FORM_ELEMENT_TYPE' });
  const options = Array(3); options[2] = 'blue';
  assert.throws(() => normalizeModalForm({ type: 'modal', elements: [{ type: 'dropdown', options, selected: 2 }] }), { code: 'PREVIEW_STATE_FORM_OPTION_MISSING' });
});

test('hiding dropdown choices preserves original indices and independent selected values', async () => {
  const input = { form: { type: 'modal', elements: [
    { type: 'dropdown', options: ['0', '1', '2', '3'], selected: 3 },
    { type: 'dropdown', options: ['0', '1', '2', '3'], selected: 1 },
  ] } };
  const original = JSON.stringify(input), state = normalizePreviewState(input);
  const document = { namespace: 'contract', root: { type: 'stack_panel', collection_name: 'custom_form',
    factory: { name: 'rows', control_name: 'contract.row' } },
  row: { type: 'collection_panel', collection_name: 'custom_dropdown',
    factory: { name: 'choices', control_name: 'contract.choice' } },
  choice: { type: 'toggle', size: [16, 16], bindings: [
    { binding_type: 'collection_details', binding_collection_name: 'custom_dropdown' },
    { binding_type: 'collection', binding_collection_name: 'custom_dropdown', binding_name: '#custom_radio_text' },
    { binding_type: 'collection', binding_collection_name: 'custom_dropdown', binding_name: '#custom_radio_toggled', binding_name_override: '#toggle_state' },
    { binding_type: 'view', source_property_name: "(#custom_radio_text = '3')", target_property_name: '#visible' },
  ] } };
  const catalog = await buildUiCatalog({ sources: [{ id: 'original-fixture', kind: 'imported', precedence: 10,
    filePaths: ['ui/contract.json'], readText: async () => JSON.stringify(document) }], parseJsonc });
  const effective = resolveEffectiveUi({ catalog, recordId: catalog.symbols['contract.root'].winnerId,
    representativeCollections: buildRepresentativeClassicCollections(state) });
  assert(effective.ok);
  const model = buildUiScreenModelFromJson(effective.document, { filePath: 'ui/contract.json' });
  const evaluated = evaluateBindingsForUiModel(model, state);
  const rows = model.root.children[0].children;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.deepEqual(row.children.map(choice => choice.unknownProps.collection_index), [0, 1, 2, 3]);
    const visible = row.children.filter(choice => evaluated.propsById[choice.id].visible);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].unknownProps.collection_index, 3);
  }
  assert.deepEqual(rows.map(row => row.children.filter(choice => evaluated.propsById[choice.id].toggle_state)
    .map(choice => choice.unknownProps.collection_index)), [[3], [1]]);
  assert.equal(JSON.stringify(input), original);
});

const box = (id, type, x = 10, y = 20, w = 36, h = 36, parentId = null) => ({ id, type, x, y, w, h, parentId, renderAlpha: 1 });
const image = { state: 'ready', packPath: 'textures/original.png', width: 36, height: 36 };
function geometryEvidence(inputBox, visualBox, draw = image) {
  return buildDrawEvidence({ boxes: [inputBox, visualBox], textDrawById: {}, imageDrawById: { [visualBox.id]: draw },
    width: 100, height: 100, uiScale: 1, locale: 'en_US', fontProfile: 'bitmap' });
}
test('draw evidence distinguishes aligned, shifted and intentionally padded image/input geometry', () => {
  const input = box('hit', 'toggle');
  const aligned = geometryEvidence(input, box('paint', 'image', 10, 20, 36, 36, 'hit')).nodes[0].input_geometry;
  assert.equal(aligned.relation, 'aligned');
  assert.equal(aligned.native_input_verified, false);
  const shifted = geometryEvidence(input, box('paint', 'image', 12, 21, 36, 36, 'hit')).nodes[0].input_geometry;
  assert.deepEqual(shifted.visual_minus_input, { x: 2, y: 1, w: 0, h: 0 });
  assert.equal(shifted.relation, 'partial_overlap');
  const paddedEvidence = geometryEvidence(input, box('paint', 'image', 14, 24, 28, 28, 'hit'));
  assert.equal(paddedEvidence.nodes[0].input_geometry.relation, 'input_contains_visual');
  assert.equal(paddedEvidence.complete, true, 'padding is information, not an invalid UI verdict');
});
test('clipping and unknown image models do not become certified native hit regions', () => {
  const input = { ...box('hit', 'toggle'), clipRect: { x: 20, y: 20, w: 10, h: 36 } };
  const result = geometryEvidence(input, { ...box('paint', 'image', 10, 20, 36, 36, 'hit'), clipRect: input.clipRect });
  assert.deepEqual(result.nodes[0].input_geometry.input_clipped_rect, input.clipRect);
  assert.equal(result.nodes[0].input_geometry.visible_relation, 'aligned');
  const unknown = geometryEvidence(input, box('paint', 'image', 10, 20, 36, 36, 'hit'), { ...image, nativeScene: {} });
  assert.equal(unknown.nodes[0].input_geometry.relation, 'unavailable');
  const sibling = geometryEvidence(box('hit', 'toggle'), box('paint', 'image'));
  assert.equal(sibling.nodes[0].input_geometry, undefined, 'unrelated sibling pairings are not guessed');
});
test('long evidence IDs remain distinguishable and reversible instead of sharing a truncated prefix', () => {
  const prefix = 'ancestor/'.repeat(600);
  const first = box(`${prefix}first`, 'image', 0, 0), second = box(`${prefix}second`, 'image', 40, 0);
  const result = buildDrawEvidence({ boxes: [first, second], textDrawById: {},
    imageDrawById: { [first.id]: image, [second.id]: image }, width: 100, height: 100, uiScale: 1, locale: 'en_US', fontProfile: 'bitmap' });
  assert.equal(result.complete, true);
  assert.notEqual(result.nodes[0].node_id, result.nodes[1].node_id);
  assert.equal(result.node_id_map[result.nodes[0].node_id], first.id);
  assert.equal(result.node_id_map[result.nodes[1].node_id], second.id);
  assert.match(result.nodes[0].node_id, /^sha256:[a-f0-9]{64}$/u);
});
test('reversible IDs share the serialized evidence budget and omissions are explicit', () => {
  const longId = 'x'.repeat(DRAW_EVIDENCE_LIMITS.jsonBytes + 1);
  const input = box(longId, 'toggle'), visual = box('paint', 'image', 10, 20, 36, 36, longId);
  const result = geometryEvidence(input, visual);
  assert.equal(result.complete, false);
  assert.equal(result.omitted_nodes, 1);
  assert.equal(result.nodes.length, 0);
  assert.equal(result.node_id_map, undefined, 'omitted records leave no unusable identity entries');
  assert(result.reasons.includes('DRAW_EVIDENCE_JSON_LIMIT'));
  assert(Buffer.byteLength(JSON.stringify(result)) <= DRAW_EVIDENCE_LIMITS.jsonBytes);
});
test('CLI PNG draw-evidence exposes projected input geometry from an original resource fixture', { skip: !loadRasterBackend(), timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-form-geometry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = path.join(directory, 'session.json'), archive = path.join(directory, 'pack.zip');
  const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
  const pixel = pngjs.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([0, 127, 255, 255]) });
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/geometry.json"]}',
    'ui/geometry.json': JSON.stringify({ namespace: 'geometry', root: { type: 'panel', size: [64, 64], ...origin, controls: [
      { input: { type: 'toggle', toggle_state: false, toggle_default_state: false, size: [36, 36], ...origin, controls: [{ image: { type: 'image', texture: 'textures/original',
        size: [36, 36], offset: [2, 1], ...origin } }] } },
    ] } }), 'textures/original.png': pixel }));
  await runCli(['import', '--session', session, '--pack', archive]);
  const evidence = await runCli(['preview', '--session', session, '--file', 'ui/geometry.json', '--definition', 'geometry.root',
    '--width', '64', '--height', '64', '--ui-scale', '1', '--out', path.join(directory, 'geometry.png'), '--draw-evidence']);
  const audit = evidence.result.draw_evidence.nodes.find(row => row.input_geometry)?.input_geometry;
  assert(audit);
  assert.deepEqual(audit.visual_minus_input, { x: 2, y: 1, w: 0, h: 0 });
  assert.equal(audit.native_input_verified, false);
});
