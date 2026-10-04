import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli, errorResult } from '../cli.mjs';
import { localizeConsoleResult } from '../console-i18n.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
const document = { namespace: 'diag37',
  healthy: { type: 'screen', size: [32, 24], ...origin },
  'missing@absent.root': { type: 'screen', size: [32, 24], ...origin },
  'cycle_a@diag37.cycle_b': { type: 'screen', size: [32, 24], ...origin },
  'cycle_b@diag37.cycle_a': { type: 'screen', size: [32, 24], ...origin },
  'dynamic@$target': { type: 'screen', size: [32, 24], ...origin },
  invalid: { type: 'screen', size: [32, 24], controls: [{ bad: { type: 'image', size: [4, 4], texture: {} } }] },
  missing_texture: { type: 'screen', size: [32, 24], controls: [{ bad: { type: 'image', size: [4, 4], texture: 'textures/missing' } }] },
  pocket: { type: 'screen', '$pocket_screen': true },
  'uses_pocket@diag37.pocket': { type: 'screen' },
};

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-diag37-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = path.join(directory, 'session.json');
  const archive = path.join(directory, 'pack.zip');
  await writeFile(archive, makeZip({ 'manifest.json': manifest,
    'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/test.json', 'ui/broken.json'] }),
    'ui/test.json': JSON.stringify(document),
    'ui/broken.json': JSON.stringify({ namespace: 'other37', 'broken@no.template': { type: 'screen' } }),
  }));
  await runCli(['import', '--session', session, '--pack', archive]);
  return { directory, session, async execute(command, definition, options = []) {
    try { return await runCli([command, '--session', session, '--file', 'ui/test.json', '--definition', `diag37.${definition}`, ...options]); }
    catch (error) { return errorResult(error); }
  } };
}

function projectionStage(output, failed = false) {
  const stage = failed ? output.error?.context?.stage_diagnostics?.projection : output.result?.stage_diagnostics?.projection;
  assert(stage, JSON.stringify(output));
  assert.equal(stage.schema, 'jsonui-projection-diagnostics-v1');
  assert.equal(stage.scope, 'selected_projection');
  assert.equal(stage.availability, 'reported');
  assert.equal(stage.dependency_trace.trace_complete, false);
  assert.equal(stage.semantic_gate.status, 'not_evaluated');
  assert.equal(stage.semantic_gate.enforcement, 'none');
  return stage;
}

test('selected projection diagnostics survive validate, JSON preview and saved artifacts without unrelated peers', { timeout: 60000 }, async t => {
  const fixture = await setup(t);
  for (const definition of ['healthy', 'missing', 'cycle_a', 'dynamic']) {
    for (const command of ['validate', 'preview']) {
      const target = path.join(fixture.directory, `${definition}-${command}.json`);
      const output = await fixture.execute(command, definition, ['--out', target]);
      assert.equal(output.ok, true, JSON.stringify(output));
      const stage = projectionStage(output);
      assert.equal(stage.selected.qualifiedName, `diag37.${definition}`);
      const saved = JSON.parse(await readFile(target, 'utf8'));
      assert.deepEqual(saved.stage_diagnostics, output.result.stage_diagnostics);
      const codes = stage.diagnostics.map(row => row.code);
      if (definition === 'healthy') assert.deepEqual(codes, ['UI_MERGE_PROFILE_APPROXIMATE']);
      if (definition === 'missing') assert(codes.includes('UI_BASE_NOT_FOUND'));
      if (definition === 'cycle_a') assert(codes.includes('UI_INHERITANCE_CYCLE'));
      if (definition === 'dynamic') assert(codes.includes('UI_DYNAMIC_BASE_UNRESOLVED'));
    }
  }
});

test('post-projection artifact failure retains cause and diagnostics and leaves old output intact', { timeout: 60000 }, async t => {
  const fixture = await setup(t), target = path.join(fixture.directory, 'existing.json');
  await writeFile(target, 'unchanged\n');
  const output = await fixture.execute('preview', 'missing', ['--out', target]);
  assert.equal(output.ok, false);
  assert(projectionStage(output, true).diagnostics.some(row => row.code === 'UI_BASE_NOT_FOUND'));
  assert.equal(await readFile(target, 'utf8'), 'unchanged\n');
  assert.notEqual(output.error.code, 'CLI_FAILED');
});

test('structural validation failure retains both original validation and projection diagnostics', { timeout: 60000 }, async t => {
  const fixture = await setup(t), target = path.join(fixture.directory, 'invalid.json');
  const output = await fixture.execute('validate', 'invalid', ['--out', target]);
  assert.equal(output.ok, false, JSON.stringify(output));
  assert.equal(output.error.code, 'CLI_VALIDATION_FAILED');
  assert.equal(output.error.context.validation.ok, false);
  projectionStage(output, true);
  await assert.rejects(readFile(target), { code: 'ENOENT' });
});

test('PNG complete stays asset-only and raster failures retain projection diagnostics', { timeout: 60000, skip: !loadRasterBackend() }, async t => {
  const fixture = await setup(t);
  const output = await fixture.execute('preview', 'missing', ['--out', path.join(fixture.directory, 'missing.png'), '--width', '32', '--height', '24', '--ui-scale', '1']);
  assert.equal(output.ok, true, JSON.stringify(output));
  assert.equal(output.result.complete, true);
  assert(projectionStage(output).diagnostics.some(row => row.code === 'UI_BASE_NOT_FOUND'));
  const failed = await fixture.execute('preview', 'missing_texture', ['--out', path.join(fixture.directory, 'blocked.png')]);
  assert.equal(failed.error.code, 'RASTER_INCOMPLETE');
  assert(failed.error.context.diagnostics.some(row => row.code === 'RASTER_TEXTURE_MISSING'));
  projectionStage(failed, true);
  await assert.rejects(readFile(path.join(fixture.directory, 'blocked.png')), { code: 'ENOENT' });
});

test('Pocket direct and dependency rejection cannot be bypassed by the diagnostics envelope', { timeout: 60000 }, async t => {
  const fixture = await setup(t);
  for (const [definition, code] of [['pocket', 'POCKET_PREVIEW_BLOCKED'], ['uses_pocket', 'POCKET_DEPENDENCY_BLOCKED']]) {
    const output = await fixture.execute('preview', definition);
    assert.equal(output.ok, false); assert.equal(output.error.code, code);
  }
});

test('new envelope localization does not descend into authored document properties', () => {
  const value = { result: { stage_diagnostics: { projection: { diagnostics: [{ code: 'CLI_LANGUAGE_INVALID', message: '表示言語は ja または en を指定してください。' }] } },
    document: { projection: { diagnostics: [{ message: 'ユーザー原文' }] } } } };
  const localized = localizeConsoleResult(value, 'en');
  assert.equal(localized.result.stage_diagnostics.projection.diagnostics[0].message, 'Display language must be ja or en.');
  assert.equal(localized.result.document.projection.diagnostics[0].message, 'ユーザー原文');
});
