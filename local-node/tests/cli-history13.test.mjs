import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { makeZip, manifest } from './fixtures.mjs';
import { readHistory, appendHistory, sourceSnapshot, historySummary, CLI_HISTORY_LIMIT, restoreSnapshot } from '../cli-history.mjs';

const entry = fileURLToPath(new URL('../cli.mjs', import.meta.url)), run = promisify(execFile);
async function command(session, args, exit = 0) {
  let output;
  try { output = { ...await run(process.execPath, [entry, ...args, '--session', session], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }), code: 0 }; }
  catch (error) { output = error; }
  assert.equal(output.code, exit, output.stdout || output.stderr);
  const result = JSON.parse(output.stdout.trim()); assert.equal(result.ok, exit === 0); return result.result || result.error;
}
test('persistent CLI history is bounded and malformed entries cannot be replayed', () => {
  const session = { sources: [{ kind: 'vanilla', overrides: { 'ui/a.json': '{}' } }] };
  for (let index = 0; index < 70; index++) {
    const before = sourceSnapshot(session.sources);
    session.sources[0].overrides['ui/a.json'] = JSON.stringify({ value: index });
    session.history = appendHistory(session, before, index.toString(16).padStart(64, '0'), (index + 1).toString(16).padStart(64, '0'));
  }
  assert.equal(historySummary(session).undo_count, 64); assert.equal(historySummary(session).dropped_entries, 6);
  const broken = structuredClone(session); broken.history.undo[0].before_revision = 'invalid';
  assert.throws(() => readHistory(broken), { code: 'CLI_HISTORY_INVALID' });
  assert.throws(() => restoreSnapshot(session.sources, [{ kind: 'imported', overrides: {} }]), { code: 'CLI_HISTORY_SOURCES_CHANGED' });
  const before = sourceSnapshot(session.sources); session.sources[0].overrides['ui/a.json'] = 'x'.repeat(CLI_HISTORY_LIMIT);
  session.history = appendHistory(session, before, 'a'.repeat(64), 'b'.repeat(64));
  assert.equal(historySummary(session).can_undo, false); assert.equal(historySummary(session).dropped_entries, 71);
});
test('separate CLI processes undo and redo exact JSONC, preserve originals and clear redo after a new edit', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-history13-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'vanilla.zip'), session = path.join(directory, 'session.json');
  const original = '\ufeff{\r\n // 保持するコメント\r\n "namespace":"demo", "screen":{"type":"screen","size":[160,90],"controls":[{"title":{"type":"label","text":"元の文字","size":[80,12]}}]}}\r\n';
  const archive = makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/demo.json"]}', 'ui/demo.json': original });
  await writeFile(source, archive); await command(session, ['import', '--vanilla', source]);
  await command(session, ['edit', '--action', 'set', '--file', 'ui/demo.json', '--pointer', '/screen/controls/0/title/text', '--value', '"変更後"']);
  const edited = (await command(session, ['read', '--file', 'ui/demo.json'])).text; assert.match(edited, /変更後/u);
  await command(session, ['undo']); assert.equal((await command(session, ['read', '--file', 'ui/demo.json'])).text, original);
  assert.deepEqual(JSON.parse(await readFile(session, 'utf8')).sources[0].overrides, {});
  await command(session, ['redo']); assert.equal((await command(session, ['read', '--file', 'ui/demo.json'])).text, edited);
  await command(session, ['undo']);
  await command(session, ['edit', '--action', 'set', '--file', 'ui/demo.json', '--pointer', '/screen/size', '--value', '[200,100]']);
  const saved = await readFile(session); assert.equal((await command(session, ['redo'], 1)).code, 'CLI_REDO_EMPTY'); assert.deepEqual(await readFile(session), saved);
  await command(session, ['import', '--vanilla', source]); assert.equal((await command(session, ['status'])).history.can_undo, false);
  assert.deepEqual(await readFile(source), archive);
});
test('CLI refuses a history revision mismatch without changing the saved session', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-history-mismatch13-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'pack.zip'), session = path.join(directory, 'session.json');
  await writeFile(source, makeZip({ 'manifest.json': manifest, 'ui/demo.json': '{"namespace":"demo","screen":{"type":"screen","size":[100,100]}}' }));
  await command(session, ['import', '--pack', source]);
  await command(session, ['edit', '--action', 'set', '--file', 'ui/demo.json', '--pointer', '/screen/size', '--value', '[200,200]']);
  const value = JSON.parse(await readFile(session, 'utf8')); value.history.undo[0].after_revision = '0'.repeat(64); await writeFile(session, JSON.stringify(value));
  const before = await readFile(session); assert.equal((await command(session, ['undo'], 1)).code, 'CLI_HISTORY_REVISION_MISMATCH'); assert.deepEqual(await readFile(session), before);
});
test('CLI selects a lower layer at the same path and persistent undo restores both layers', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-history-layers13-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const vanilla = path.join(directory, 'vanilla.zip'), imported = path.join(directory, 'imported.zip'), session = path.join(directory, 'session.json');
  const lower = '{"namespace":"demo","base":{"type":"panel","size":[80,40]},"screen":{"type":"screen","size":[100,60]}}';
  const upper = '{"namespace":"demo","screen@demo.screen":{"type":"screen","size":[200,120]}}';
  await writeFile(vanilla, makeZip({ 'manifest.json': manifest, 'ui/demo.json': lower }));
  await writeFile(imported, makeZip({ 'manifest.json': manifest, 'ui/demo.json': upper }));
  await command(session, ['import', '--pack', imported, '--vanilla', vanilla]);
  assert.equal((await command(session, ['read', '--file', 'ui/demo.json', '--kind', 'vanilla'])).text, lower);
  assert.equal((await command(session, ['read', '--file', 'ui/demo.json', '--kind', 'imported'])).text, upper);
  await command(session, ['edit', '--action', 'set', '--file', 'ui/demo.json', '--kind', 'vanilla', '--pointer', '/base/size', '--value', '[90,50]']);
  const saved = JSON.parse(await readFile(session, 'utf8'));
  assert.match(saved.sources.find(item => item.kind === 'vanilla').overrides['ui/demo.json'], /90/u);
  assert.deepEqual(saved.sources.find(item => item.kind === 'imported').overrides, {});
  await command(session, ['undo']); assert.equal((await command(session, ['read', '--file', 'ui/demo.json', '--kind', 'vanilla'])).text, lower);
  assert.equal((await command(session, ['read', '--file', 'ui/demo.json', '--kind', 'imported'])).text, upper);
  await command(session, ['redo']); assert.match((await command(session, ['read', '--file', 'ui/demo.json', '--kind', 'vanilla'])).text, /90/u);
  const operation = path.join(directory, 'operation.json');
  await writeFile(operation, JSON.stringify({ type: 'set', path: 'ui/demo.json', sourceId: 'vanilla-reference', pointer: '/base/size', value: [95, 55] }));
  await command(session, ['edit', '--operation', operation]); assert.match((await command(session, ['read', '--file', 'ui/demo.json', '--kind', 'vanilla'])).text, /95/u);
});
