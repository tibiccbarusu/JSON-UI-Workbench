import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, readFile, rm, symlink, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArguments, errorResult } from '../cli.mjs';
import { readRegularBytes } from '../cli-files.mjs';
import { CliClient } from '../cli-client.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { ResourceZipReader } from '../resource-zip.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';

const exec = promisify(execFile);
const entry = fileURLToPath(new URL('../cli.mjs', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-cli23-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function cli(args, expected = 0) {
  let output;
  try { output = await exec(process.execPath, [entry, ...args], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }); output.code = 0; }
  catch (error) { output = error; }
  assert.equal(output.code, expected, output.stdout || output.stderr);
  const lines = output.stdout.trim().split('\n'); assert.equal(lines.length, 1);
  return JSON.parse(lines[0]);
}

test('CLI パック情報・アイコン・診断オプションを正しいコマンドだけに許可する', () => {
  assert.deepEqual(parseArguments(['export', '--pack-options', '情報.json', '--pack-icon', '画像.png']).options,
    { 'pack-options': '情報.json', 'pack-icon': '画像.png' });
  assert.deepEqual(parseArguments(['diagnostics', '--out', '記録.json', '--force']).options, { out: '記録.json', force: true });
  assert.throws(() => parseArguments(['import', '--pack-icon', '画像.png']), { code: 'CLI_ARGUMENT_UNKNOWN' });
});

test('バイナリ入力は byte 境界・通常ファイル・原文 byte を維持する', async t => {
  const directory = await fixture(t), file = path.join(directory, 'bytes.png');
  const bytes = Buffer.from([0, 255, 128, 13, 10]); await writeFile(file, bytes);
  assert.deepEqual(await readRegularBytes(file, 5), bytes);
  await assert.rejects(readRegularBytes(file, 4), { code: 'CLI_INPUT_LIMIT' });
  await assert.rejects(readRegularBytes(file, 0), { code: 'CLI_INPUT_LIMIT_INVALID' });
  const alias = path.join(directory, 'alias.png'); await symlink(file, alias);
  await assert.rejects(readRegularBytes(alias), { code: 'CLI_INPUT_NOT_REGULAR' });
  assert.deepEqual(await readFile(file), bytes);
});

test('CLI HTTP 失敗は API の詳細と再試行可否を残し認証値を伏せる', async t => {
  const token = 'a'.repeat(64);
  const correlationId = '04d953ef-17c6-4865-a012-608267d062c1';
  const server = http.createServer((_req, res) => {
    res.statusCode = 503;
    res.setHeader('X-JSONUI-Request-ID', correlationId);
    res.end(JSON.stringify({ error: { code: 'TEST_ENGINE_BUSY' }, details: [{ code: 'TEST_DEPENDENCY', filePath: 'ui/anvil.json' }], token, message: `secret ${token}` }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const client = new CliClient({ port: server.address().port }, token);
  await assert.rejects(client.request('/api/node/test'), error => {
    assert.equal(error.code, 'TEST_ENGINE_BUSY'); assert.equal(error.retryable, true);
    assert.equal(error.context.response.details[0].filePath, 'ui/anvil.json');
    assert.equal(error.context.http_status, 503);
    assert.equal(errorResult(error).error.correlation_id, correlationId);
    assert(!JSON.stringify(error.context).includes(token));
    assert(error.context.sanitization.redacted >= 1);
    return true;
  });
});

test('実 CLI 診断は import.mcpack と編集履歴を同じ workflow から保存する', { timeout: 60000 }, async t => {
  const directory = await fixture(t), source = path.join(directory, 'input.mcpack');
  const bytes = makeZip({ 'manifest.json': manifest, 'ui/test.json': JSON.stringify({ namespace: 'test', screen: { type: 'screen', size: [80, 40] }, second: { type: 'screen' } }) });
  await writeFile(source, bytes);
  const workflow = path.join(directory, 'workflow.json');
  await writeFile(workflow, JSON.stringify({ schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'import', options: { pack: 'input.mcpack' } },
    { command: 'definitions', options: { file: 'ui/test.json' } },
    { command: 'edit', options: { action: 'move', file: 'ui/test.json', pointer: '/screen', value: '[8,4]' } },
    { command: 'diagnostics', options: { out: 'diagnostics.json' } },
  ] }));
  const result = await cli(['workflow', '--file', workflow, '--session', path.join(directory, 'session.json')]);
  assert.equal(result.result.completed_count, 4);
  assert.equal(result.result.results[1].result.count, 2);
  const bundle = JSON.parse(await readFile(path.join(directory, 'diagnostics.json'), 'utf8'));
  assert.equal(bundle.schema, 'jsonui-debug-bundle-v1');
  assert.equal(bundle.client.data.state.surface, 'cli');
  assert.equal(bundle.client.data.state.history.undo_count, 1);
  assert.equal(bundle.client.data.state.sources[0].edited_files, 1);
  assert.equal(bundle.client.data.state.coverage, 'current_cli_invocation');
  assert(bundle.server.journal.total_seen >= 1);
  assert.equal(bundle.privacy.api_credentials_redacted, true);
  assert.deepEqual(await readFile(source), bytes);
});

test('実 CLI 選択 export は manifest 情報と PNG アイコンを共通 API で反映する', { timeout: 60000 }, async t => {
  const backend = loadRasterBackend(); if (!backend) return t.skip('PNG backend が必要');
  const directory = await fixture(t), source = path.join(directory, 'input.mcpack');
  const bytes = makeZip({ 'manifest.json': manifest, 'ui/test.json': JSON.stringify({ namespace: 'test', screen: { type: 'screen', size: [80, 40] }, second: { type: 'screen' } }) });
  await writeFile(source, bytes);
  await writeFile(path.join(directory, 'pack-options.json'), JSON.stringify({ name: '操作試験パック', description: 'CLI から設定', version: [2, 3, 4], authors: ['検証担当'] }));
  const canvas = backend.createCanvas(32, 32); const ctx = canvas.getContext('2d'); ctx.fillStyle = '#3b82f6'; ctx.fillRect(0, 0, 32, 32);
  const iconBytes = canvas.toBuffer('image/png'); await writeFile(path.join(directory, 'icon.png'), iconBytes);
  const workflow = path.join(directory, 'workflow.json');
  await writeFile(workflow, JSON.stringify({ schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'import', options: { pack: 'input.mcpack' } },
    { command: 'export', options: { file: 'ui/test.json', definition: 'test.screen', 'pack-options': 'pack-options.json', 'pack-icon': 'icon.png', out: 'selected.mcpack' } },
  ] }));
  await cli(['workflow', '--file', workflow, '--session', path.join(directory, 'session.json')]);
  const reader = new ResourceZipReader();
  try {
    await reader.openFromFile({ diskPath: path.join(directory, 'selected.mcpack') }); await reader.listEntries();
    const outputManifest = JSON.parse(await reader.readText('manifest.json'));
    assert.equal(outputManifest.header.name, '操作試験パック');
    assert.equal(outputManifest.header.description, 'CLI から設定');
    assert.deepEqual(outputManifest.header.version, [2, 3, 4]);
    assert.deepEqual(outputManifest.metadata.authors, ['検証担当']);
    assert(reader.entryIndex.has('pack_icon.png'));
    const doc = JSON.parse(await reader.readText('ui/test.json'));
    assert(doc.screen); assert.equal(doc.second, undefined);
  } finally { await reader.close(); }
  assert.deepEqual(await readFile(source), bytes);
  assert.deepEqual(await readFile(path.join(directory, 'icon.png')), iconBytes);
});

test('CLI 不正なアイコンと未対応 packOptions は成果物を作らない', { timeout: 60000 }, async t => {
  const directory = await fixture(t), source = path.join(directory, 'input.mcpack'), session = path.join(directory, 'session.json');
  await writeFile(source, makeZip({ 'manifest.json': manifest, 'ui/test.json': '{"namespace":"test","screen":{"type":"screen"}}' }));
  await cli(['import', '--pack', source, '--session', session]);
  await writeFile(path.join(directory, 'icon.png'), 'not a PNG');
  const output = path.join(directory, 'selected.mcpack');
  const args = ['export', '--session', session, '--file', 'ui/test.json', '--definition', 'test.screen', '--out', output];
  const invalidIcon = await cli([...args, '--pack-icon', path.join(directory, 'icon.png')], 1);
  assert.equal(invalidIcon.error.code, 'CLI_PACK_ICON_INVALID');
  await writeFile(path.join(directory, 'options.json'), '{"min_engine_version":[1,0,0]}');
  const invalidOptions = await cli([...args, '--pack-options', path.join(directory, 'options.json')], 1);
  assert.equal(invalidOptions.error.code, 'CLI_PACK_OPTIONS_INVALID');
  await assert.rejects(stat(output), { code: 'ENOENT' });
});
