import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runCli } from '../cli.mjs';
import { selectedSemanticQuality, summarizeFinalFrame, buildPreviewQuality } from '../cli-quality38.mjs';
import { prepareTypedCliState } from '../cli-state38.mjs';
import { normalizePreviewState } from '../../editor-core/src/engine/preview-state.js';
import { CliClient } from '../cli-client.mjs';
import { renderFramePng, loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
async function folder(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-quality38-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('strict selected semantics rejects broken selected dependencies, ignores broken peer definitions, preserves legacy observation', { timeout: 60000 }, async t => {
  const directory = await folder(t), session = path.join(directory, 'session.json'), archive = path.join(directory, 'pack.zip');
  const document = { namespace: 'quality38', healthy: { type: 'screen', size: [32, 24] },
    'missing@no.base': { type: 'screen' }, 'cycle_a@quality38.cycle_b': { type: 'screen' },
    'cycle_b@quality38.cycle_a': { type: 'screen' }, 'dynamic@$unknown': { type: 'screen' } };
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}', 'ui/test.json': JSON.stringify(document) }));
  await runCli(['import', '--session', session, '--pack', archive]);
  const preview = definition => ['preview', '--session', session, '--file', 'ui/test.json', '--definition', `quality38.${definition}`];
  const healthy = await runCli([...preview('healthy'), '--strict-semantics']);
  assert.equal(healthy.result.quality.semantic.status, 'passed');
  assert.equal(healthy.result.quality.semantic.unrelated_catalog_diagnostics_included, false);
  assert.equal(healthy.result.quality.native_comparison.status, 'not_evaluated');
  assert.equal(healthy.result.frame_stage, 'before_resource_measurement');
  for (const name of ['missing', 'cycle_a', 'dynamic']) {
    const target = path.join(directory, `${name}.json`);
    await assert.rejects(runCli([...preview(name), '--strict-semantics', '--out', target]), error => {
      assert.equal(error.code, 'CLI_SEMANTIC_GATE_FAILED');
      assert.notEqual(error.context.quality.semantic.status, 'passed');
      assert.equal(error.context.stage_diagnostics.projection.semantic_gate.enforcement, 'explicit_strict_selected_resolution');
      return true;
    });
    await assert.rejects(readFile(target), { code: 'ENOENT' });
    const observed = await runCli(preview(name));
    assert.equal(observed.ok, true);
    assert.notEqual(observed.result.quality.semantic.status, 'passed');
  }
});

test('a truncated or absent selected trace stays unknown, never borrowing a catalog pass', () => {
  assert.equal(selectedSemanticQuality({ diagnostics: [], dependencyTrace: { capture_complete: false } }).status, 'unknown');
  assert.equal(selectedSemanticQuality({ diagnostics: [], dependencyTrace: { capture_complete: true, trace_complete: false } }).status, 'passed');
  assert.equal(selectedSemanticQuality({ diagnostics: [{ severity: 'warning', code: 'UI_VARIABLE_UNRESOLVED' }], dependencyTrace: { capture_complete: true } }).status, 'unknown');
  assert.equal(selectedSemanticQuality({}).status, 'unknown');
});

test('typed CLI state uses shared normalization, refuses implicit replacement, and invalidates evidence after raw changes', { timeout: 60000 }, async t => {
  const directory = await folder(t), session = path.join(directory, 'session.json'), statePath = path.join(directory, 'state.json');
  const input = JSON.stringify({ form: { type: 'action', title: '確認', body: '本文', buttons: [{ text: '選択' }] }, font_profile: 'observed-smooth' });
  await writeFile(statePath, input);
  const normalized = normalizePreviewState(input);
  const result = await runCli(['settings', '--session', session, '--state-file', statePath]);
  assert.deepEqual(result.result.settings.mock_data, normalized.mockData);
  assert.deepEqual(result.result.settings.collections, normalized.collectionData);
  assert.equal(result.result.state_evidence.input_sha256, sha256(input));
  assert.equal(result.result.state_evidence.normalized_sha256, sha256(JSON.stringify(normalized)));
  assert.equal(result.result.settings.font_profile, 'observed-smooth');
  const saved = await readFile(session, 'utf8');
  await assert.rejects(runCli(['settings', '--session', session, '--state-file', statePath]), { code: 'CLI_STATE_REPLACEMENT_REQUIRED' });
  assert.equal(await readFile(session, 'utf8'), saved);
  await runCli(['settings', '--session', session, '--state-file', statePath, '--replace-state']);
  const rawPath = path.join(directory, 'raw.json');
  await writeFile(rawPath, JSON.stringify({ variables: { '#form_title': '明示変更' } }));
  const raw = await runCli(['settings', '--session', session, '--file', rawPath]);
  assert.equal(raw.result.state_evidence, undefined);
  assert.equal(JSON.parse(await readFile(session, 'utf8')).preview_state, undefined);
  await assert.rejects(runCli(['settings', '--session', session, '--file', rawPath, '--state-file', statePath]), { code: 'CLI_ARGUMENT_CONFLICT' });
});

test('typed state boundary rejects the same hostile/deep/oversized rows as the browser shared validator', () => {
  for (const value of [
    { form: { type: 'action', title: {}, buttons: [] } },
    { collectionData: { rows: Array.from({ length: 257 }, () => ({})) } },
    { unknown: 1 },
    JSON.parse('{"mockData":{"__proto__":true}}'),
  ]) {
    let expected; try { normalizePreviewState(value); } catch (error) { expected = error.code; }
    assert(expected);
    assert.throws(() => prepareTypedCliState(JSON.stringify(value), {}), { code: expected });
  }
  let nested = true; for (let i = 0; i < 26; i++) nested = { next: nested };
  assert.throws(() => prepareTypedCliState(JSON.stringify({ mockData: nested }), {}), { code: 'PREVIEW_STATE_BUDGET' });
});

test('CLI resource-pack UUID persists the chosen MCADDON layer across independent commands', { timeout: 60000 }, async t => {
  const directory = await folder(t), session = path.join(directory, 'session.json'), archive = path.join(directory, 'pack.mcaddon');
  const uuids = [randomUUID(), randomUUID()];
  const packs = uuids.map((uuid, index) => {
    const value = JSON.parse(manifest); value.header.uuid = uuid; value.modules[0].uuid = randomUUID();
    return makeZip({ 'manifest.json': JSON.stringify(value), 'ui/test.json': JSON.stringify({ namespace: `pack${index}`, screen: { type: 'screen' } }) });
  });
  await writeFile(archive, makeZip({ 'one.mcpack': packs[0], 'two.mcpack': packs[1] }));
  await assert.rejects(runCli(['import', '--session', session, '--pack', archive]), { code: 'ADDON_RESOURCE_SELECTION_REQUIRED' });
  const selected = await runCli(['import', '--session', session, '--pack', archive, '--resource-pack', uuids[1]]);
  assert.equal(selected.result.sources[0].resource_pack_uuid, uuids[1]);
  const list = await runCli(['definitions', '--session', session]);
  assert.deepEqual(list.result.items.map(row => row.qualifiedName), ['pack1.screen']);
  assert.equal(JSON.parse(await readFile(session, 'utf8')).sources[0].resource_pack_uuid, uuids[1]);
});

test('typed event factory choices reach CLI projection while keeping actual ancestor constraints', { timeout: 60000 }, async t => {
  const directory = await folder(t), session = path.join(directory, 'session.json'), archive = path.join(directory, 'pack.zip'), statePath = path.join(directory, 'state.json');
  const document = { namespace: 'context38', main: { type: 'panel', size: [100, 60], ...origin, controls: [
    { events: { type: 'factory', size: ['100%', '100%'], ...origin, control_ids: { chosen: '@context38.child' } } },
  ] }, child: { type: 'panel', size: ['100%', '100%'], ...origin } };
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}', 'ui/test.json': JSON.stringify(document) }));
  await writeFile(statePath, JSON.stringify({ eventFactorySelections: { events: 'chosen' } }));
  await runCli(['import', '--session', session, '--pack', archive]);
  const state = await runCli(['settings', '--session', session, '--state-file', statePath]);
  assert.equal(state.result.settings.event_factory_selections.events, 'chosen');
  const result = await runCli(['preview', '--session', session, '--file', 'ui/test.json', '--definition', 'context38.main', '--width', '480', '--height', '270', '--ui-scale', '1']);
  assert.equal(result.result.quality.preview_context.scope, 'explicit-event-factory');
  assert.equal(result.result.quality.preview_context.nativeParityVerified, false);
  const boxes = result.result.frame.layout.boxes;
  assert.equal(boxes.length, 3);
  assert.deepEqual(boxes.map(box => [box.w, box.h]), [[100, 60], [100, 60], [100, 60]]);
  const operationPath = path.join(directory, 'move.json');
  await writeFile(operationPath, JSON.stringify({ type: 'move', path: 'ui/test.json', pointer: '/child', offset: [7, 9] }));
  const beforeDraft = await readFile(session, 'utf8');
  const draft = await runCli(['draft', '--session', session, '--file', 'ui/test.json', '--definition', 'context38.main',
    '--operation', operationPath, '--width', '480', '--height', '270', '--ui-scale', '1']);
  assert.equal(draft.result.frame.layout.boxes.length, 3, 'draft keeps the explicitly selected event branch');
  const child = draft.result.frame.layout.boxes.at(-1);
  assert.deepEqual([child.x, child.y, child.w, child.h], [7, 9, 100, 60]);
  assert.equal(await readFile(session, 'utf8'), beforeDraft, 'draft neither changes state nor commits its source operation');
});

test('final PNG summary hashes the measured frame, retains original request time, and identifies missing glyph addresses', { skip: !loadRasterBackend(), timeout: 60000 }, async t => {
  const directory = await folder(t), archive = path.join(directory, 'pack.zip');
  const fontPixels = Buffer.alloc(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) fontPixels.set([255, 255, 255, x % 8 < 5 && y % 8 < 7 ? 255 : 0], (y * 128 + x) * 4);
  const font = pngjs.PNG.sync.write({ width: 128, height: 128, data: fontPixels });
  const document = { namespace: 'quality38', screen: { type: 'screen', size: [64, 48], ...origin,
    controls: [{ text: { type: 'label', text: 'AAA', size: ['default', 'default'], ...origin, localize: false } }] } };
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}',
    'ui/test.json': JSON.stringify(document), 'font/default8.png': font }));
  const client = await CliClient.start(); t.after(() => client.close());
  const pack = await client.importPack(archive), sources = [{ id: pack.id, kind: 'vanilla' }];
  const catalog = await client.request('/api/node/catalog', { payload: { sources } });
  const record = catalog.records.find(row => row.qualifiedName === 'quality38.screen');
  const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } });
  const frameRequest = { projectionId: projection.nodeProjectionId, recordId: record.id, filePath: record.filePath,
    preset: { width: 64, height: 48 }, generation: 0, animationTime: 1, visibilityMode: 'safe' };
  const frame = await client.request('/api/node/frame', { payload: frameRequest });
  const request = client.request.bind(client), frames = [];
  client.request = async (route, options) => { const reply = await request(route, options); if (route === '/api/node/frame') frames.push(reply); return reply; };
  const result = await renderFramePng({ client, sources, projection, frame, frameRequest, width: 64, height: 48, timeSeconds: 1 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert(frames.length > 0, 'resource measurement must cause an actual second layout pass');
  const final = frames.at(-1);
  assert.deepEqual(result.final_frame_summary, summarizeFinalFrame({ frame: final, projection, frameRequest, timeSeconds: 1,
    fontProfile: 'bitmap', provenance: result.provenance, reflowPasses: frames.length }));
  assert.equal(result.final_frame_summary.frame_sha256, sha256(JSON.stringify(final)));
  assert.notEqual(result.final_frame_summary.frame_sha256, sha256(JSON.stringify(frame)));
  assert.equal(result.final_frame_summary.box_count, final.layout.boxes.length);
  assert.equal(result.final_frame_summary.full_frame_included, false);
  assert.equal(result.final_frame_summary.request_sha256, buildPreviewQuality({ projection, frameRequest, raster: result }).request_sha256);
  assert.equal(result.final_frame_summary.time_seconds, 1);
  const missingProjection = structuredClone(projection);
  missingProjection.document.screen.controls[0].text.text = '日';
  const missing = await renderFramePng({ client, sources, projection: missingProjection, frame, width: 64, height: 48 });
  assert.equal(missing.ok, false);
  const problem = missing.diagnostics.find(row => row.code === 'FONT_SHEET_MISSING');
  assert(problem, JSON.stringify(missing.diagnostics));
  assert.deepEqual(problem.details.font_coverage.expected_paths, ['font/glyph_65.png']);
  assert.equal(problem.details.font_coverage.samples[0].codepoint, 'U+65E5');
});
