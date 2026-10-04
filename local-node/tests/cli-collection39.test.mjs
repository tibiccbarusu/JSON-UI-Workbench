import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../cli.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { buildPreviewQuality } from '../cli-quality38.mjs';
import { summarizeCollectionQuality } from '../../editor-core/src/engine/collection-quality39.js';
import { SUPPORTED_UI_ELEMENT_TYPES, buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { generateSchemaMetadata, generateElementSchemaDraft07 } from '../../editor-core/src/schema/schema-generator.js';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
function definition(type) {
  return { type, collection_name: 'form_buttons', size: [64, 32], ...origin,
    controls: [0, 1].map(index => ({ [`row${index}`]: { type: 'panel', collection_index: index,
      size: [24, 24], offset: [index * 30, 0], ...origin,
      controls: [{ text: { type: 'label', text: 'fallback', size: [24, 10], ...origin,
        bindings: [{ binding_type: 'collection', binding_collection_name: 'form_buttons', binding_name: '#form_button_text', binding_name_override: 'text' }] } },
      { icon: { type: 'image', texture: 'textures/ui/one', size: [8, 8], offset: [0, 12], ...origin,
        bindings: [{ binding_type: 'collection', binding_collection_name: 'form_buttons', binding_name: '#form_button_texture', binding_name_override: 'texture' }] } }] } })) };
}

test('collection_panel belongs to model and generated/static schema type lists', async () => {
  assert(SUPPORTED_UI_ELEMENT_TYPES.includes('collection_panel'));
  assert(generateSchemaMetadata().supported_element_types.includes('collection_panel'));
  assert(JSON.stringify(generateElementSchemaDraft07()).includes('collection_panel'));
  const staticMetadata = JSON.parse(await readFile(new URL('../../editor-core/app/schemas/jsonui-metadata.json', import.meta.url)));
  assert(staticMetadata.supported_element_types.includes('collection_panel'));
});

test('shared collection quality never upgrades unknown, malformed or bounded evidence to native success', () => {
  assert.equal(summarizeCollectionQuality().status, 'not_evaluated');
  assert.equal(summarizeCollectionQuality({ warnings: [] }).status, 'passed');
  assert.equal(summarizeCollectionQuality({ warnings: [null] }).status, 'unknown');
  for (const code of ['COLLECTION_OWNER_INVALID', 'COLLECTION_INDEX_INVALID', 'COLLECTION_SCOPE_AMBIGUOUS']) {
    const quality = summarizeCollectionQuality({ warnings: [`${code}:node\nunsafe`] });
    assert.equal(quality.status, 'failed');
    assert.equal(quality.native_parity_verified, false);
    assert(!quality.diagnostics[0].detail.includes('\n'));
  }
  for (const code of ['COLLECTION_INDEX_UNRESOLVED', 'COLLECTION_CONTEXT_RUNTIME_DEPENDENT', 'NESTED_COLLECTION_MAP_LIMIT', 'COLLECTION_SCOPE_DEPTH_LIMIT']) {
    assert.equal(summarizeCollectionQuality({ warnings: [code] }).status, 'unknown');
  }
  const capped = summarizeCollectionQuality({ warnings: Array(5000).fill('OTHER_WARNING') });
  assert.equal(capped.status, 'unknown');
  assert.equal(capped.observation_capture_complete, false);
  const details = summarizeCollectionQuality({ warnings: Array(100).fill('COLLECTION_OWNER_INVALID:node:panel') });
  assert.equal(details.diagnostics.length, 64);
  assert.equal(details.omitted_diagnostics, 36);
  const quality = buildPreviewQuality({ projection: { diagnostics: [], dependencyTrace: { capture_complete: true } },
    frame: { bindings: { warnings: ['COLLECTION_OWNER_INVALID:node:panel'] } } });
  assert.equal(quality.semantic.status, 'passed');
  assert.equal(quality.collection.status, 'failed');
  assert.equal(quality.assets.status, 'not_evaluated');
  assert.equal(quality.native_comparison.status, 'not_evaluated');
});

test('old panel is observable but cannot pass strict JSON/PNG; valid rows and allow-partial remain explicit', { timeout: 120000, skip: !loadRasterBackend() }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-collection39-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = path.join(directory, 'session.json'), archive = path.join(directory, 'pack.zip'), state = path.join(directory, 'state.json');
  const font = pngjs.PNG.sync.write({ width: 128, height: 128, data: Buffer.alloc(128 * 128 * 4, 255) });
  const image = pngjs.PNG.sync.write({ width: 2, height: 2, data: Buffer.alloc(16, 255) });
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}',
    'ui/test.json': JSON.stringify({ namespace: 'quality39', old: definition('panel'), fixed: definition('collection_panel') }),
    'font/default8.png': font, 'textures/ui/one.png': image, 'textures/ui/two.png': image }));
  await writeFile(state, JSON.stringify({ form: { type: 'action', title: 'test', buttons: [
    { text: 'A', icon: 'textures/ui/one' }, { text: 'B', icon: 'textures/ui/two' }] } }));
  await runCli(['import', '--session', session, '--pack', archive]);
  await runCli(['settings', '--session', session, '--state-file', state]);
  const preview = name => ['preview', '--session', session, '--file', 'ui/test.json', '--definition', `quality39.${name}`, '--width', '64', '--height', '32', '--ui-scale', '1'];
  await assert.rejects(runCli([...preview('fixed'), '--draw-evidence']), { code: 'CLI_ARGUMENT_CONFLICT' });
  const observed = await runCli(preview('old'));
  assert.equal(observed.result.quality.collection.status, 'failed');
  assert(observed.result.quality.collection.reason_codes.includes('COLLECTION_OWNER_INVALID'));
  assert.equal(observed.result.stage_diagnostics.collection.enforcement, 'observation_only');
  const strictJson = path.join(directory, 'strict.json');
  await assert.rejects(runCli([...preview('old'), '--strict-semantics', '--out', strictJson]), error => {
    assert.equal(error.code, 'CLI_COLLECTION_GATE_FAILED');
    assert.equal(error.context.quality.collection.status, 'failed');
    assert.equal(error.context.stage_diagnostics.collection.enforcement, 'explicit_strict_frame_collection');
    return true;
  });
  await assert.rejects(readFile(strictJson), { code: 'ENOENT' });
  const strictPng = path.join(directory, 'strict.png');
  await assert.rejects(runCli([...preview('old'), '--out', strictPng]), error => {
    assert.equal(error.code, 'RASTER_COLLECTION_INCOMPLETE');
    assert.equal(error.context.quality.assets.status, 'passed');
    assert.equal(error.context.quality.collection.status, 'failed');
    return true;
  });
  await assert.rejects(readFile(strictPng), { code: 'ENOENT' });
  await assert.rejects(runCli([...preview('old'), '--out', strictPng, '--strict-semantics', '--allow-partial']), { code: 'CLI_COLLECTION_GATE_FAILED' });
  await assert.rejects(readFile(strictPng), { code: 'ENOENT' });
  const partial = await runCli([...preview('old'), '--out', path.join(directory, 'diagnostic.png'), '--allow-partial']);
  assert.equal(partial.result.complete, true, 'complete keeps the resource-only compatibility meaning');
  assert.equal(partial.result.preview_complete, false);
  assert.equal(partial.result.collection_quality.status, 'failed');
  const fixed = await runCli([...preview('fixed'), '--strict-semantics']);
  assert.equal(fixed.result.quality.collection.status, 'passed');
  const file = buildTreeFromUiScreenModel(buildUiScreenModelFromJson(fixed.result.document, { filePath: 'ui/test.json' }));
  const props = Object.entries(file.nodesById).map(([id, node]) => ({ ...node.props, ...fixed.result.frame.propsById[id] }));
  assert(props.some(value => value.text === 'A'));
  assert(props.some(value => value.text === 'B'));
  assert(props.some(value => value.texture === 'textures/ui/one'));
  assert(props.some(value => value.texture === 'textures/ui/two'));
  const raster = await runCli([...preview('fixed'), '--out', path.join(directory, 'fixed.png')]);
  assert.equal(raster.result.preview_complete, true);
  assert.equal(raster.result.quality.collection.status, 'passed');
  assert.equal(raster.result.quality.native_comparison.status, 'not_evaluated');
  assert.equal(raster.result.draw_evidence, undefined);
  const evidence = await runCli([...preview('fixed'), '--out', path.join(directory, 'evidence.png'), '--draw-evidence']);
  assert.equal(evidence.result.draw_evidence.schema, 'jsonui-draw-evidence-v1');
  assert.equal(evidence.result.draw_evidence.native_verified, false);
  assert.equal(evidence.result.draw_evidence.frame_fingerprint_sha256, evidence.result.final_frame_summary.frame_sha256);
  assert.equal(evidence.result.draw_evidence.request_sha256, evidence.result.final_frame_summary.request_sha256);
  assert(evidence.result.draw_evidence.nodes.some(row => row.text?.value === 'A'));
  assert(evidence.result.draw_evidence.nodes.some(row => row.text?.value === 'B'));
  assert(evidence.result.draw_evidence.nodes.some(row => row.image?.layers.some(layer => layer.path === 'textures/ui/one.png')));
  assert(evidence.result.draw_evidence.nodes.some(row => row.image?.layers.some(layer => layer.path === 'textures/ui/two.png')));
  const validate = ['validate', '--session', session, '--file', 'ui/test.json', '--definition', 'quality39.old'];
  const validation = await runCli(validate);
  assert.equal(validation.result.quality.collection.status, 'not_evaluated');
  assert.equal(validation.result.quality.native_properties.status, 'failed');
  assert(validation.result.validation.issues.some(issue => issue.code === 'NATIVE_PROPERTY_UNSUPPORTED'
    && issue.propKey === 'collection_index'));
  await assert.rejects(runCli([...validate, '--strict-semantics']), error => {
    assert.equal(error.code, 'CLI_NATIVE_PROPERTY_GATE_FAILED');
    assert.equal(error.context.quality.native_properties.status, 'failed');
    assert.equal(error.context.quality.collection.status, 'not_evaluated', 'validation does not execute frame bindings');
    return true;
  });
});
