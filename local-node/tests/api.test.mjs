import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRenderer, JsonUiApiError } from '../api.mjs';
import { runCli } from '../cli.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
const target = { file: 'ui/test.json', definition: 'sample.screen', width: 64, height: 48, uiScale: 1, frame: 15, fps: 30 };
const backend = loadRasterBackend();
function png(width, height, color) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) data.set(color, index * 4);
  return pngjs.PNG.sync.write({ width, height, data });
}
function fixture({ color = [255, 0, 0, 255], badPeer = false, namespace = 'sample', missingTexture = false } = {}) {
  const font = png(128, 128, [255, 255, 255, 255]);
  return makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}',
    'ui/test.json': JSON.stringify({ namespace, screen: { type: 'screen', size: [64, 48], ...origin, controls: [
      { image: { type: 'image', texture: 'textures/ui/test', size: [16, 16], ...origin } },
      { label: { type: 'label', text: 'sample.greeting', size: [32, 12], offset: [20, 0], ...origin } },
      { gate: { type: 'panel', size: [8, 8], offset: [0, 20], ...origin, bindings: [{ binding_name: '#show_gate', binding_name_override: '#visible' }] } },
    ] }, ...(badPeer ? { 'broken@missing.base': { type: 'screen' } } : {}) }),
    ...(missingTexture ? {} : { 'textures/ui/test.png': png(2, 2, color) }), 'font/default8.png': font, 'font/glyph_65.png': font,
    'texts/en_US.lang': 'sample.greeting=HI\n', 'texts/ja_JP.lang': 'sample.greeting=A日\n' });
}
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-sdk-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, '入力.mcpack'), bytes = fixture(options);
  await writeFile(source, bytes);
  const renderer = await createRenderer({ settings: { mock_data: { '#show_gate': true } } });
  t.after(() => renderer.close());
  await renderer.import({ pack: source });
  return { directory, source, bytes, renderer };
}

test('SDK reuses one Worker for import, catalog, validation and repeated structured renders', async t => {
  const { renderer, source, bytes, directory } = await setup(t);
  const definitions = await renderer.definitions({ file: 'ui/test.json' });
  assert.equal(definitions.count, 1); assert.equal(definitions.items[0].qualifiedName, 'sample.screen');
  assert.equal((await renderer.list()).count, 1);
  const validation = await renderer.validate({ file: target.file, definition: target.definition, strictSemantics: true });
  assert.equal(validation.validation.ok, true); assert.equal(validation.quality.native_comparison.status, 'not_evaluated');
  const first = await renderer.render({ ...target, format: 'json', strictSemantics: true });
  const second = await renderer.render({ ...target, format: 'json', strictSemantics: true });
  assert.deepEqual(second.frame.layout.boxes, first.frame.layout.boxes);
  const status = await renderer.status();
  assert.equal(status.imported, true); assert.equal(status.sources.length, 1);
  assert.equal(status.server_reused, true); assert.equal(status.mode, 'headless'); assert(status.worker.calls > 8);
  assert(status.worker.caches.projection_models.hits >= 1, JSON.stringify(status.worker.caches));
  assert.deepEqual(await readFile(source), bytes);
  assert.deepEqual(await readdir(directory), ['入力.mcpack'], 'SDK writes neither session nor output files');
});

test('SDK and CLI share JSON layout, strict quality axes and exact resource PNG bytes', { skip: !backend, timeout: 60000 }, async t => {
  const { renderer, source, directory } = await setup(t, { badPeer: true });
  const session = path.join(directory, 'session.json'), settings = path.join(directory, 'settings.json'), output = path.join(directory, 'cli.png');
  await runCli(['import', '--session', session, '--pack', source]);
  await writeFile(settings, JSON.stringify({ mock_data: { '#show_gate': true } }));
  await runCli(['settings', '--session', session, '--file', settings]);
  const args = ['preview', '--session', session, '--file', target.file, '--definition', target.definition, '--width', '64', '--height', '48', '--ui-scale', '1', '--frame', '15', '--fps', '30', '--strict-semantics'];
  const cliJson = (await runCli(args)).result;
  const apiJson = await renderer.render({ ...target, strictSemantics: true });
  assert.deepEqual(apiJson.frame.layout.boxes, cliJson.frame.layout.boxes);
  for (const axis of ['semantic', 'evaluation', 'collection', 'bindings', 'animation', 'state', 'assets', 'interaction', 'native_comparison']) assert.deepEqual(apiJson.quality[axis], cliJson.quality[axis], axis);
  const cliPng = (await runCli([...args, '--format', 'png', '--draw-evidence', '--out', output])).result;
  const apiPng = await renderer.render({ ...target, format: 'png', strictSemantics: true, drawEvidence: true });
  assert(Buffer.isBuffer(apiPng.png)); assert.deepEqual(apiPng.png, await readFile(output));
  // Separate servers legitimately have different lineage IDs and request/frame fingerprints.
  const comparableDraw = ({ request_sha256: _request, frame_fingerprint_sha256: _frame, ...evidence }) => evidence;
  assert.deepEqual(comparableDraw(apiPng.draw_evidence), comparableDraw(cliPng.draw_evidence));
  assert.equal(apiPng.rendering.sha256, cliPng.rendering.sha256);
  assert(apiPng.provenance.some(item => item.sheet === 'glyph_65'), 'localized Japanese text loads the synthetic Unicode sheet');
  assert.equal(apiPng.preview_complete, cliPng.preview_complete);
  for (const axis of ['semantic', 'evaluation', 'collection', 'bindings', 'animation', 'assets', 'interaction', 'native_comparison']) assert.deepEqual(apiPng.quality[axis], cliPng.quality[axis], axis);
  const image = pngjs.PNG.sync.read(apiPng.png);
  assert.deepEqual([...image.data.subarray((2 * 64 + 2) * 4, (2 * 64 + 2) * 4 + 4)], [255, 0, 0, 255]);
  const state = { mockData: { '#show_gate': false } }, stateFile = path.join(directory, 'state.json');
  await writeFile(stateFile, JSON.stringify(state));
  await runCli(['settings', '--session', session, '--state-file', stateFile, '--replace-state']);
  const cliState = (await runCli(args)).result, apiState = await renderer.render({ ...target, state, strictSemantics: true });
  assert.deepEqual(apiState.frame.layout.boxes, cliState.frame.layout.boxes);
  assert.deepEqual(apiState.quality.state, cliState.quality.state);
});

test('SDK default PNG refuses missing assets; explicit partial output is marked incomplete and has no native pass', { skip: !backend }, async t => {
  const { renderer } = await setup(t, { missingTexture: true });
  await assert.rejects(renderer.render({ ...target, format: 'png' }), error => {
    assert.equal(error.context.quality.assets.status, 'failed'); return true;
  });
  const partial = await renderer.render({ ...target, format: 'png', allowPartial: true });
  assert(Buffer.isBuffer(partial.png)); assert.equal(partial.draft, true); assert.equal(partial.preview_complete, false);
  assert.equal(partial.quality.native_comparison.status, 'not_evaluated');
});

test('SDK queued input is snapshotted; per-call settings and typed state never mutate defaults', async t => {
  const { renderer } = await setup(t);
  const mutable = { ...target, settings: { mock_data: { '#show_gate': false } } };
  const pending = renderer.render(mutable); mutable.settings.mock_data['#show_gate'] = true; mutable.definition = 'missing.screen';
  const hidden = await pending;
  assert(!hidden.frame.layout.boxes.some(box => box.id.endsWith('/gate')));
  const shown = await renderer.render(target);
  assert(shown.frame.layout.boxes.some(box => box.id.endsWith('/gate')));
  const typed = await renderer.render({ ...target, state: { mockData: { '#show_gate': false } } });
  assert.equal(typed.quality.state.status, 'passed'); assert(!typed.frame.layout.boxes.some(box => box.id.endsWith('/gate')));
  assert((await renderer.render(target)).frame.layout.boxes.some(box => box.id.endsWith('/gate')));
  await assert.rejects(renderer.render({ ...target, state: {}, settings: { mock_data: {} } }), { code: 'API_STATE_CONFLICT' });
  await assert.rejects(renderer.render({ ...target, state: { unknown: 1 } }), { code: 'PREVIEW_STATE_UNKNOWN_FIELD' });
});

test('SDK SVG is a layout diagnostic; summary JSON explicitly does not contain a renderable scene', async t => {
  const { renderer } = await setup(t);
  const svg = await renderer.render({ ...target, format: 'svg' });
  assert.match(svg.svg, /<svg/u); assert.equal(svg.rendering.product_raster, false);
  const summary = await renderer.render({ ...target, frameSummary: true });
  assert.equal(summary.renderable, false); assert.equal(summary.frame.frame_included, false);
  await assert.rejects(renderer.render({ ...target, format: 'svg', allowPartial: true }), { code: 'API_REQUEST_INVALID' });
  await assert.rejects(renderer.render({ ...target, frameSummary: true, strictAnimation: true }), { code: 'API_REQUEST_INVALID' });
});

test('SDK two-layer import replacement and failed replacement preserve retained data without exhausting registrations', async t => {
  const { renderer, source, directory, bytes } = await setup(t);
  const vanilla = path.join(directory, 'vanilla.zip'), replacement = path.join(directory, 'replacement.mcpack'), bad = path.join(directory, 'bad.zip');
  await writeFile(vanilla, makeZip({ 'manifest.json': manifest, 'ui/base.json': '{"namespace":"base","panel":{"type":"panel"}}' }));
  await writeFile(replacement, fixture({ namespace: 'replacement' }));
  await writeFile(bad, Buffer.from('this is not a zip file archive at all'));
  for (let index = 0; index < 3; index++) {
    const imported = await renderer.import({ pack: source, vanilla });
    assert.equal(imported.sources.length, 2);
    assert.equal((await renderer.render(target)).ok, true);
  }
  await assert.rejects(renderer.import({ pack: bad, vanilla }), { code: 'CLI_PACK_SIGNATURE_INVALID' });
  assert.equal((await renderer.render(target)).ok, true, 'failed import keeps previous stack');
  const imported = await renderer.import({ pack: replacement });
  assert.equal(imported.sources.length, 1, 'SDK import replaces the full stack');
  assert.equal((await renderer.render({ ...target, definition: 'replacement.screen' })).ok, true);
  await assert.rejects(renderer.render(target), { code: 'UI_DEFINITION_NOT_FOUND' });
  assert.deepEqual(await readFile(source), bytes);
});

test('SDK strict failures preserve the same CLI code and actionable quality context', async t => {
  const { renderer } = await setup(t, { badPeer: true });
  await assert.rejects(renderer.render({ ...target, definition: 'sample.broken', strictSemantics: true }), error => {
    assert(error instanceof JsonUiApiError); assert.equal(error.code, 'CLI_SEMANTIC_GATE_FAILED');
    assert.notEqual(error.context.quality.semantic.status, 'passed');
    assert.equal(error.context.stage_diagnostics.projection.semantic_gate.enforcement, 'explicit_strict_selected_resolution');
    return true;
  });
  await assert.rejects(renderer.render({ ...target, settings: { mock_data: {} }, strictSemantics: true }), { code: 'CLI_BINDING_GATE_FAILED' });
  await assert.rejects(renderer.render({ file: 'ui/pocket/test.json', definition: 'none' }), { code: 'UI_DEFINITION_NOT_FOUND' });
  assert.equal((await renderer.render(target)).ok, true);
});

test('SDK rejects invalid fields/types before work and has a bounded serial queue', async t => {
  const renderer = await createRenderer(); t.after(() => renderer.close());
  await assert.rejects(renderer.import({ pack: 'relative.mcpack' }), { code: 'API_REQUEST_INVALID' });
  for (const request of [{ width: '64' }, { frame: -1 }, { fps: 241 }, { uiScale: 0 }, { strictSemantics: 1 }, { format: 'jpg' }, { out: 'forbidden.png' }]) {
    await assert.rejects(renderer.render(request), { code: 'API_REQUEST_INVALID' });
  }
  await assert.rejects(renderer.render(target), { code: 'API_PACK_REQUIRED' });
  const calls = Array.from({ length: 8 }, () => renderer.status());
  await assert.rejects(renderer.status(), error => error.code === 'API_QUEUE_FULL' && error.retryable);
  assert.equal((await Promise.all(calls)).length, 8);
  assert.equal((await renderer.status()).ok, true);
});

test('SDK cancellation distinguishes timeout, preserves a usable instance and makes close idempotent', async t => {
  const { renderer } = await setup(t);
  const cancelled = new AbortController(); cancelled.abort(new Error('private reason'));
  await assert.rejects(renderer.render(target, { signal: cancelled.signal }), { code: 'API_CANCELLED', category: 'cancelled' });
  const timeout = new AbortController(); timeout.abort(new DOMException('private deadline', 'TimeoutError'));
  await assert.rejects(renderer.render(target, { signal: timeout.signal }), { code: 'API_TIMEOUT', category: 'timeout' });
  assert.equal((await renderer.render(target)).ok, true);
  const first = renderer.close(); assert.equal(renderer.close(), first); await first;
  await assert.rejects(renderer.status(), { code: 'API_CLOSED', category: 'failed_precondition' });
});
