import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { parseArguments } from '../cli.mjs';
import { atomicWrite, checkOutputPath, readJson, readRegularText, lockSession } from '../cli-files.mjs';
import { CliClient } from '../cli-client.mjs';
import { buildStructureSvg } from '../cli-preview.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { ResourceZipReader } from '../resource-zip.mjs';

const run = promisify(execFile), entry = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function temporary(t) { const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-cli13-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
async function cli(args, { expectedCode = 0, timeout = 60000 } = {}) {
  let result;
  try { result = await run(process.execPath, [entry, ...args], { timeout, maxBuffer: 32 * 1024 * 1024 }); result.code = 0; }
  catch (error) { if (typeof error.code !== 'number') throw error; result = error; }
  assert.equal(result.code, expectedCode, result.stdout || result.stderr);
  const lines = result.stdout.trim().split('\n'); assert.equal(lines.length, 1, 'stdout は JSON 1 件');
  const data = JSON.parse(lines[0]); assert.equal(data.schema, 'jsonui-cli-result-v1'); assert.equal(data.ok, expectedCode === 0);
  return data;
}

test('CLI argument boundaries reject unknown/duplicate/missing and preserve Japanese paths', () => {
  assert.deepEqual(parseArguments(['import', '--pack', '日本語 space.zip', '--json']).options, { pack: '日本語 space.zip', json: true });
  for (const argv of [['x'], ['status', '--session'], ['status', '--session', 'one.json', '--session', 'two.json'], ['status', '--execute', 'rm'], ['status', 'extra'], ['status', '--json=false'], ['status', '--__proto__', '{}']]) assert.throws(() => parseArguments(argv));
});

test('CLI real process emits machine error and refuses package.json session before mutation', async () => {
  const help = await cli(['help', '--json']); assert.match(help.result.help, /コマンドモード/u);
  const unknown = await cli(['unknown'], { expectedCode: 1 }); assert.equal(unknown.error.code, 'CLI_COMMAND_UNKNOWN');
  const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url)), before = await readFile(packagePath);
  const denied = await cli(['status', '--session', packagePath], { expectedCode: 1 });
  assert.equal(denied.error.code, 'CLI_APPLICATION_PATH_PROTECTED'); assert.deepEqual(await readFile(packagePath), before);
  await assert.rejects(checkOutputPath(fileURLToPath(new URL('../../.jsonui/runtime/package.json', import.meta.url)), { replace: true }), { code: 'CLI_APPLICATION_PATH_PROTECTED' });
});

test('atomic artifacts refuse implicit overwrite, symlink, source hardlink and leave no temporary file', async t => {
  const directory = await temporary(t), output = path.join(directory, 'frame.json'), source = path.join(directory, 'source.json');
  await writeFile(source, 'original');
  const artifact = await atomicWrite(output, '{"a":1}\n'); assert.equal(artifact.checksum_sha256, sha('{"a":1}\n'));
  await assert.rejects(atomicWrite(output, 'changed'), { code: 'CLI_OUTPUT_EXISTS' });
  await assert.rejects(atomicWrite(source, 'changed', { replace: true, protectedPaths: [source] }), { code: 'CLI_SOURCE_PATH_PROTECTED' });
  const alias = path.join(directory, 'hard.json'); await link(source, alias);
  await assert.rejects(atomicWrite(alias, 'changed', { replace: true, protectedPaths: [source] }), { code: 'CLI_SOURCE_PATH_PROTECTED' });
  const symbolic = path.join(directory, 'symbolic.json'); await symlink(source, symbolic);
  await assert.rejects(checkOutputPath(symbolic, { replace: true }), { code: 'CLI_OUTPUT_NOT_REGULAR' });
  await atomicWrite(output, '{"a":2}\n', { replace: true }); assert.equal((await readJson(output)).a, 2);
  assert.equal(await readFile(source, 'utf8'), 'original');
});

test('session lock is exclusive and releases only its owned lock', async t => {
  const directory = await temporary(t), session = path.join(directory, 'session.json');
  const release = await lockSession(session);
  await assert.rejects(lockSession(session), { code: 'CLI_SESSION_LOCKED' });
  await release(); const releaseAgain = await lockSession(session); await releaseAgain();
  await assert.rejects(stat(`${session}.lock`), { code: 'ENOENT' });
});

test('releasing an older CLI does not remove a replacement session lock', async t => {
  const directory = await temporary(t), session = path.join(directory, 'session.json');
  const older = await lockSession(session); await rm(`${session}.lock`);
  const replacement = await lockSession(session);
  await older(); await older();
  await assert.rejects(lockSession(session), { code: 'CLI_SESSION_LOCKED' });
  await replacement(); await assert.rejects(stat(`${session}.lock`), { code: 'ENOENT' });
});

test('Windows UTF-8 BOM settings are accepted while authored-text BOM is preserved', async t => {
  const directory = await temporary(t), file = path.join(directory, 'bom.json');
  await writeFile(file, '\ufeff{"width":640}\r\n');
  assert.equal((await readRegularText(file)).charCodeAt(0), 0xfeff);
  assert.deepEqual(await readJson(file), { width: 640 });
});

test('SVG diagnostics escape untrusted labels and explicitly deny pixel parity', () => {
  const svg = buildStructureSvg({ layout: { boxes: [{ id: '"><script>alert(1)</script>', type: 'image', x: 0, y: 1, w: 50, h: 20, renderAlpha: 1 }] } },
    { width: 160, height: 90, qualifiedName: '<svg onload="alert(1)">', frameIndex: 30, fps: 60 });
  assert(!svg.includes('<script>')); assert(!svg.includes('<svg onload=')); assert.match(svg, /product_raster/u); assert.match(svg, /&quot;product_raster&quot;:false/u);
  assert.match(svg, /実機画像ではありません/u);
});

test('HTTP client imports actual streamed archive, verifies SHA and closes owned server', { timeout: 60000 }, async t => {
  const directory = await temporary(t), source = path.join(directory, '日本語 pack.zip');
  const bytes = makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}', 'ui/test.json': '{"namespace":"test","screen":{"type":"screen","size":[80,40]}}' });
  await writeFile(source, bytes);
  const client = await CliClient.start(), base = client.base;
  try {
    const imported = await client.importPack(source); assert.equal(imported.source.checksum_sha256, sha(bytes)); assert.equal(imported.source.size_bytes, bytes.length);
    const catalog = await client.request('/api/node/catalog', { payload: { sources: [{ id: imported.id, kind: 'vanilla' }] } });
    assert(catalog.records.some(record => record.qualifiedName === 'test.screen'));
    await assert.rejects(client.importPack(source, { ...imported.source, checksum_sha256: '0'.repeat(64) }), { code: 'CLI_SOURCE_CHANGED' });
    assert.deepEqual(await readFile(source), bytes);
  } finally { await client.close(); }
  await assert.rejects(fetch(new URL('/api/node/capabilities', base), { signal: AbortSignal.timeout(2000) }));
});

test('workflow validation rejects invalid future command before settings change', async t => {
  const directory = await temporary(t), session = path.join(directory, 'session.json'), workflow = path.join(directory, 'workflow.json');
  await writeFile(path.join(directory, 'settings.json'), '{"width":640}');
  await writeFile(workflow, JSON.stringify({ schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'settings', options: { file: 'settings.json' } }, { command: 'shell', options: {} },
  ] }));
  const result = await cli(['workflow', '--session', session, '--file', workflow], { expectedCode: 1 });
  assert.equal(result.error.code, 'CLI_COMMAND_UNKNOWN'); await assert.rejects(stat(session), { code: 'ENOENT' });
});

test('CLI replacement import preserves saved edits and history when catalog validation fails', { timeout: 120000 }, async t => {
  const directory = await temporary(t), session = path.join(directory, 'session.json');
  const source = path.join(directory, 'original.zip'), replacement = path.join(directory, 'replacement.zip');
  const originalText = '\ufeff{\r\n // 原文を保持\r\n "namespace":"demo","screen":{"type":"screen","size":[100,60]}\r\n}\r\n';
  const originalBytes = makeZip({ 'manifest.json': manifest, 'ui/demo.json': originalText });
  const replacementBytes = makeZip({ 'manifest.json': manifest, 'ui/demo.json': originalText,
    'nested/ui/_ui_defs.json': '{' });
  await writeFile(source, originalBytes); await writeFile(replacement, replacementBytes);
  await writeFile(path.join(directory, 'settings.json'), JSON.stringify({ width: 320, height: 180, fps: 30, locale: 'en_US' }));
  const workflow = path.join(directory, 'workflow.json');
  await writeFile(workflow, JSON.stringify({ schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'import', options: { pack: 'original.zip' } },
    { command: 'settings', options: { file: 'settings.json' } },
    { command: 'edit', options: { action: 'set', file: 'ui/demo.json', pointer: '/screen/size', value: '[200,120]' } },
    { command: 'edit', options: { action: 'set', file: 'ui/demo.json', pointer: '/screen/size', value: '[300,180]' } },
    { command: 'undo' },
  ] }));
  await cli(['workflow', '--session', session, '--file', workflow]);
  const beforeBytes = await readFile(session), before = JSON.parse(beforeBytes);
  assert.equal(before.history.undo.length, 1); assert.equal(before.history.redo.length, 1);
  const failure = await cli(['import', '--session', session, '--pack', replacement], { expectedCode: 1 });
  assert.equal(failure.error.context.route, '/api/node/workspace-catalog');
  assert((await readFile(session)).equals(beforeBytes), 'failed catalog validation must preserve the exact saved session');
  assert.deepEqual(await readFile(source), originalBytes); assert.deepEqual(await readFile(replacement), replacementBytes);
  const status = await cli(['status', '--session', session]);
  assert.deepEqual(status.result.settings, before.settings);
  assert.equal(status.result.history.undo_count, 1); assert.equal(status.result.history.redo_count, 1);
  assert.equal((await cli(['read', '--session', session, '--file', 'ui/demo.json'])).result.text, before.sources[0].overrides['ui/demo.json']);
  await cli(['redo', '--session', session]);
  const redone = (await cli(['read', '--session', session, '--file', 'ui/demo.json'])).result.text;
  assert.equal(redone, before.history.redo[0].after[0].overrides['ui/demo.json']);
});

test('PNG without a backend or pack fails clearly without writing an image', async t => {
  const directory = await temporary(t), output = path.join(directory, 'frame.png');
  const result = await cli(['preview', '--session', path.join(directory, 'session.json'), '--format', 'png', '--out', output], { expectedCode: 1 });
  assert.equal(result.error.code, loadRasterBackend() ? 'CLI_PACK_REQUIRED' : 'RASTER_BACKEND_UNAVAILABLE');
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('real CLI workflow imports vanilla-only, chooses multiple definitions, edits, previews and exports minimal dependencies', { timeout: 120000 }, async t => {
  const directory = await temporary(t), source = path.join(directory, 'vanilla.zip'), session = path.join(directory, 'session.json');
  const files = {
    'manifest.json': manifest,
    'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/base.json', 'ui/example.json', 'ui/unused.json', 'ui/pocket/blocked.json'] }),
    'ui/base.json': JSON.stringify({ namespace: 'common', base: { type: 'panel', size: [80, 40] }, unused: { type: 'image', texture: 'textures/unused' } }),
    'ui/example.json': JSON.stringify({ namespace: 'demo', 'screen@common.base': { type: 'screen', controls: [{ title: { type: 'label', text: '最初のテキスト', size: [60, 12] } }] }, second: { type: 'screen', size: [40, 20] } }),
    'ui/unused.json': '{"namespace":"unused","screen":{"type":"screen"}}',
    'ui/pocket/blocked.json': '{"namespace":"pocket","screen":{"type":"screen"}}',
    'textures/unused.png': Buffer.from([137, 80, 78, 71]),
    'sounds/unused.ogg': 'unused',
  };
  const bytes = makeZip(files); await writeFile(source, bytes);
  await writeFile(path.join(directory, 'operation.json'), JSON.stringify({ type: 'set', path: 'ui/example.json', pointer: '/screen@common.base/controls/0/title/text', value: '変更済みテキスト' }));
  await writeFile(path.join(directory, 'settings.json'), JSON.stringify({ width: 320, height: 180, fps: 30, locale: 'ja_JP' }));
  const workflow = { schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'import', options: { vanilla: 'vanilla.zip' } },
    { command: 'list' },
    { command: 'definitions', options: { file: 'ui/example.json' } },
    { command: 'settings', options: { file: 'settings.json' } },
    { command: 'edit', options: { operation: 'operation.json' } },
    { command: 'edit', options: { action: 'move', file: 'ui/example.json', pointer: '/screen@common.base/controls/0/title', value: '[8,4]' } },
    { command: 'edit', options: { action: 'add', file: 'ui/example.json', 'parent-pointer': '/screen@common.base', name: 'added_panel', value: '{"type":"panel","size":[12,12]}' } },
    { command: 'edit', options: { action: 'inherit', file: 'ui/example.json', pointer: '/screen@common.base/controls/1/added_panel', 'base-ref': 'common.base' } },
    { command: 'validate', options: { file: 'ui/example.json', definition: 'demo.screen' } },
    { command: 'preview', options: { file: 'ui/example.json', definition: 'demo.screen', frame: '15', fps: '30', out: 'frame.json' } },
    { command: 'preview', options: { file: 'ui/example.json', definition: 'demo.screen', frame: '15', fps: '30', out: 'frame.svg' } },
    { command: 'export', options: { file: 'ui/example.json', definition: 'demo.screen', out: 'selected.mcpack' } },
  ] };
  const workflowPath = path.join(directory, 'workflow.json'); await writeFile(workflowPath, JSON.stringify(workflow));
  const result = await cli(['workflow', '--file', workflowPath, '--session', session], { timeout: 100000 });
  assert.equal(result.result.completed_count, workflow.commands.length);
  assert.equal(result.result.results[2].result.count, 2);
  const frame = JSON.parse(await readFile(path.join(directory, 'frame.json'), 'utf8'));
  assert.equal(frame.time_seconds, 0.5); assert.equal(frame.frame.layout.preset.width, 80); assert.equal(frame.viewport.width, 320); assert.equal(frame.viewport.ui_scale, 4);
  assert.match(JSON.stringify(frame.document), /変更済みテキスト/u); assert.equal(frame.rendering.product_raster, false);
  assert.match(await readFile(path.join(directory, 'frame.svg'), 'utf8'), /構造診断/u);
  const saved = JSON.parse(await readFile(session, 'utf8')); assert.equal(saved.sources[0].kind, 'vanilla');
  assert.match(saved.sources[0].overrides['ui/example.json'], /変更済みテキスト/u); assert(!('token' in saved));
  const restored = await cli(['read', '--session', session, '--file', 'ui/example.json']); assert.match(restored.result.text, /変更済みテキスト/u);
  const restoredDocument = JSON.parse(restored.result.text);
  assert.deepEqual(restoredDocument['screen@common.base'].controls[0].title.offset, [8, 4]);
  assert(restoredDocument['screen@common.base'].controls[1]['added_panel@common.base']);
  const beforeInvalid = await readFile(session);
  await writeFile(path.join(directory, 'invalid.json'), '{');
  const invalid = await cli(['edit', '--session', session, '--file', 'ui/example.json', '--text-file', path.join(directory, 'invalid.json')], { expectedCode: 1 });
  assert.match(invalid.error.code, /^EDIT_/u); assert.deepEqual(await readFile(session), beforeInvalid);
  const ambiguous = await cli(['preview', '--session', session, '--file', 'ui/example.json'], { expectedCode: 1 }); assert.equal(ambiguous.error.code, 'CLI_DEFINITION_AMBIGUOUS');
  const blocked = await cli(['preview', '--session', session, '--file', 'ui/pocket/blocked.json', '--definition', 'pocket.screen'], { expectedCode: 1 }); assert.equal(blocked.error.code, 'POCKET_PREVIEW_BLOCKED');
  const reader = new ResourceZipReader();
  try {
    await reader.openFromFile({ diskPath: path.join(directory, 'selected.mcpack') }); await reader.listEntries();
    assert(reader.entryIndex.has('ui/base.json')); assert(reader.entryIndex.has('ui/example.json'));
    assert(!reader.entryIndex.has('ui/unused.json')); assert(!reader.entryIndex.has('textures/unused.png')); assert(!reader.entryIndex.has('sounds/unused.ogg'));
    const exported = JSON.parse(await reader.readText('ui/example.json'));
    assert.equal(exported.second, undefined); assert.match(JSON.stringify(exported), /変更済みテキスト/u);
  } finally { await reader.close(); }
  const cascadeSession = path.join(directory, 'cascade-session.json'); await writeFile(cascadeSession, beforeInvalid);
  const plan = await cli(['edit', '--session', cascadeSession, '--action', 'planDelete', '--file', 'ui/base.json', '--pointer', '/base']);
  assert(plan.result.deletePlan.affected.some(node => node.path === 'ui/example.json'));
  const cascadeRequired = await cli(['edit', '--session', cascadeSession, '--action', 'delete', '--file', 'ui/base.json', '--pointer', '/base'], { expectedCode: 1 });
  assert.equal(cascadeRequired.error.code, 'EDIT_CASCADE_REQUIRED');
  await cli(['edit', '--session', cascadeSession, '--action', 'delete', '--file', 'ui/base.json', '--pointer', '/base', '--cascade']);
  const afterCascade = await cli(['read', '--session', cascadeSession, '--file', 'ui/example.json']);
  assert.equal(JSON.parse(afterCascade.result.text)['screen@common.base'], undefined); assert(JSON.parse(afterCascade.result.text).second);
  assert.deepEqual(await readFile(source), bytes);
  await writeFile(source, makeZip({ ...files, 'textures/new.txt': 'changed source' }));
  const changed = await cli(['list', '--session', session], { expectedCode: 1 }); assert.equal(changed.error.code, 'CLI_SOURCE_CHANGED');
  assert.deepEqual(await readFile(session), Buffer.from(JSON.stringify(saved, null, 2) + '\n'));
});

test('SIGTERM cancels a CLI-owned operation and releases its session lock', { timeout: 30000 }, async t => {
  if (process.platform === 'win32') return t.skip('Windows の実 SIGTERM 配送は別環境で検査する。');
  const directory = await temporary(t), session = path.join(directory, 'session.json');
  const source = path.join(directory, 'large.zip');
  await writeFile(source, makeZip({ 'manifest.json': manifest, 'ui/test.json': '{"namespace":"test","screen":{"type":"screen"}}', 'data/large.bin': Buffer.alloc(24 * 1024 * 1024, 17) }));
  const child = spawn(process.execPath, [entry, 'import', '--vanilla', source, '--session', session], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', part => { stdout += part; });
  const finished = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await stat(`${session}.lock`).catch(() => null)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  // Let the lock writer finish registering its cleanup before the user signal.
  await new Promise(resolve => setTimeout(resolve, 20)); child.kill('SIGTERM');
  const outcome = await finished; assert.equal(outcome.signal, null); assert.equal(outcome.code, 1, stdout);
  assert.equal(JSON.parse(stdout.trim()).error.code, 'CLI_CANCELLED');
  await assert.rejects(stat(`${session}.lock`), { code: 'ENOENT' });
});

test('two-layer CLI editing preserves per-layer changes and restores cross-file inheritance', { timeout: 90000 }, async t => {
  const directory = await temporary(t), session = path.join(directory, 'session.json');
  const vanilla = makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/base.json"]}',
    'ui/base.json': '{"namespace":"common","base":{"type":"panel","size":[120,80]}}' });
  const addon = makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/addon.json"]}',
    'ui/addon.json': '{"namespace":"addon","screen@common.base":{"type":"screen","controls":[{"title":{"type":"label","text":"継承画面","size":[60,12]}}]}}' });
  await writeFile(path.join(directory, 'vanilla.zip'), vanilla); await writeFile(path.join(directory, 'addon.zip'), addon);
  const workflow = { schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'import', options: { pack: 'addon.zip', vanilla: 'vanilla.zip' } },
    { command: 'edit', options: { action: 'set', file: 'ui/base.json', pointer: '/base/size', value: '[144,88]' } },
    { command: 'preview', options: { file: 'ui/addon.json', definition: 'addon.screen', out: 'frame.json' } },
    { command: 'export', options: { file: 'ui/addon.json', definition: 'addon.screen', out: 'selected.zip' } },
  ] };
  const file = path.join(directory, 'workflow.json'); await writeFile(file, JSON.stringify(workflow));
  await cli(['workflow', '--session', session, '--file', file]);
  const saved = JSON.parse(await readFile(session, 'utf8'));
  assert(saved.sources.find(source => source.kind === 'vanilla').overrides['ui/base.json']);
  assert.deepEqual(saved.sources.find(source => source.kind === 'imported').overrides, {});
  const projected = JSON.parse(await readFile(path.join(directory, 'frame.json'), 'utf8'));
  assert.deepEqual(projected.document.screen.size, [144, 88]);
  const restored = await cli(['preview', '--session', session, '--file', 'ui/addon.json', '--definition', 'addon.screen']);
  assert.deepEqual(restored.result.document.screen.size, [144, 88]);
  assert.deepEqual(await readFile(path.join(directory, 'vanilla.zip')), vanilla);
  assert.deepEqual(await readFile(path.join(directory, 'addon.zip')), addon);
});
