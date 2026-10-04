import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { runCli } from '../cli.mjs';
import { makeZip, manifest } from './fixtures.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-input23-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = makeZip({ 'manifest.json': manifest,
    'ui/test.json': '{"namespace":"test","screen":{"type":"screen","size":[80,40]}}' });
  await writeFile(path.join(directory, 'input.mcpack'), bytes);
  return { directory, bytes };
}

async function workflow(directory, commands) {
  const filename = path.join(directory, 'workflow.json');
  await writeFile(filename, JSON.stringify({ schema: 'jsonui-cli-workflow-v1', commands }));
  return runCli(['workflow', '--file', filename, '--session', path.join(directory, 'session.json')]);
}

const exportPack = out => ({ command: 'export', options: {
  file: 'ui/test.json', definition: 'test.screen', out, force: true,
} });

test('workflow は後続 settings の既存入力を先行診断で上書きしない', { timeout: 30000 }, async t => {
  const { directory } = await fixture(t), settings = path.join(directory, 'settings.json');
  const original = '{"width":640}\n'; await writeFile(settings, original);
  await assert.rejects(workflow(directory, [
    { command: 'diagnostics', options: { out: 'settings.json', force: true } },
    { command: 'settings', options: { file: 'settings.json' } },
  ]), { code: 'CLI_SOURCE_PATH_PROTECTED' });
  assert.equal(await readFile(settings, 'utf8'), original);
});

test('workflow は後続 import の既存 MCPACK を先行 export で上書きしない', { timeout: 30000 }, async t => {
  const { directory } = await fixture(t), future = path.join(directory, 'future.mcpack');
  const original = makeZip({ 'manifest.json': manifest,
    'ui/future.json': '{"namespace":"future","screen":{"type":"screen"}}' });
  await writeFile(future, original);
  await assert.rejects(workflow(directory, [
    { command: 'import', options: { pack: 'input.mcpack' } },
    exportPack('future.mcpack'),
    { command: 'import', options: { pack: 'future.mcpack' } },
  ]), { code: 'CLI_SOURCE_PATH_PROTECTED' });
  assert.deepEqual(await readFile(future), original);
});

test('workflow は交換済みの元パックも呼出終了まで上書き禁止を維持する', { timeout: 30000 }, async t => {
  const { directory, bytes } = await fixture(t);
  await writeFile(path.join(directory, 'replacement.mcpack'), bytes);
  await runCli(['import', '--pack', path.join(directory, 'input.mcpack'), '--session', path.join(directory, 'session.json')]);
  await assert.rejects(workflow(directory, [
    { command: 'import', options: { pack: 'replacement.mcpack' } },
    exportPack('input.mcpack'),
  ]), { code: 'CLI_SOURCE_PATH_PROTECTED' });
  assert.deepEqual(await readFile(path.join(directory, 'input.mcpack')), bytes);
});

test('workflow は新規書出しパックの後続 import を引き続き許可する', { timeout: 30000 }, async t => {
  const { directory, bytes } = await fixture(t);
  const result = await workflow(directory, [
    { command: 'import', options: { pack: 'input.mcpack' } },
    exportPack('generated.mcpack'),
    { command: 'import', options: { pack: 'generated.mcpack' } },
    { command: 'definitions', options: { file: 'ui/test.json' } },
  ]);
  assert.equal(result.result.completed_count, 4);
  assert.equal(result.result.results[3].result.count, 1);
  assert.deepEqual(await readFile(path.join(directory, 'input.mcpack')), bytes);
});
