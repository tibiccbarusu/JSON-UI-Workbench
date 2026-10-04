import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const exec = promisify(execFile), entry = fileURLToPath(new URL('../cli.mjs', import.meta.url));
test('CLI strict PNG は非表示が明示された progress bar だけを省略し可視・不明は拒否する', { timeout: 60000 }, async t => {
  if (!loadRasterBackend()) return t.skip('PNG backend が必要');
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-native23-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = path.join(directory, 'session.json');
  const screen = props => ({ type: 'screen', size: [32, 32], controls: props ? [{ bar: { type: 'custom', renderer: 'progress_bar_renderer', size: [20, 8], ...props } }] : [] });
  const document = { namespace: 'test', empty: screen(), hidden: screen({ progress_bar_visible: false }), touch: screen({ touch_progress_bar_visible: false }), visible: screen({ progress_bar_visible: true }), unknown: screen({}) };
  await writeFile(path.join(directory, 'input.mcpack'), makeZip({ 'manifest.json': manifest, 'ui/test.json': JSON.stringify(document) }));
  const options = name => ({ file: 'ui/test.json', definition: `test.${name}`, width: '32', height: '32', 'ui-scale': '1', frame: '0', format: 'png', out: `${name}.png` });
  await writeFile(path.join(directory, 'workflow.json'), JSON.stringify({ schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'import', options: { pack: 'input.mcpack' } },
    ...['empty', 'hidden', 'touch'].map(name => ({ command: 'preview', options: options(name) })),
  ] }));
  const result = await exec(process.execPath, [entry, 'workflow', '--session', session, '--file', path.join(directory, 'workflow.json')], { timeout: 30000 });
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.ok, true, result.stdout);
  for (const record of parsed.result.results.slice(1)) assert.equal(record.result.complete, true);
  const empty = await readFile(path.join(directory, 'empty.png'));
  assert.deepEqual(await readFile(path.join(directory, 'hidden.png')), empty, '非表示 bar で余計な画素を描かない');
  assert.deepEqual(await readFile(path.join(directory, 'touch.png')), empty, 'touch 非表示 bar で余計な画素を描かない');
  for (const name of ['visible', 'unknown']) {
    let failure;
    try { await exec(process.execPath, [entry, 'preview', '--session', session, '--file', 'ui/test.json', '--definition', `test.${name}`, '--format', 'png', '--width', '32', '--height', '32', '--ui-scale', '1', '--out', path.join(directory, `${name}.png`)], { timeout: 15000 }); }
    catch (error) { failure = error; }
    assert.equal(failure?.code, 1);
    const data = JSON.parse(failure.stdout);
    assert.equal(data.error.code, 'RASTER_INCOMPLETE');
    assert(data.error.context.diagnostics.some(row => row.code === 'RASTER_NATIVE_UNSUPPORTED'));
    await assert.rejects(stat(path.join(directory, `${name}.png`)), { code: 'ENOENT' });
  }
});
