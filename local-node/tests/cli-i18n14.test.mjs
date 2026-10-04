import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { makeZip, manifest } from './fixtures.mjs';
import { localizeConsoleResult, consoleText, resolveLanguage } from '../console-i18n.mjs';
import { launcherLogRecord } from '../launcher.mjs';
import { buildStructureSvg } from '../cli-preview.mjs';

const execute = promisify(execFile);
const entry = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u;
async function temporary(t) { const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-lang14-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
async function cli(args, { language, expected = 0 } = {}) {
  const env = { ...process.env }; delete env.JSONUI_LANGUAGE;
  if (language !== undefined) env.JSONUI_LANGUAGE = language;
  let output;
  try { output = await execute(process.execPath, [entry, ...args], { env, timeout: 60000, maxBuffer: 32 * 1024 * 1024 }); output.code = 0; }
  catch (error) { if (typeof error.code !== 'number') throw error; output = error; }
  assert.equal(output.code, expected, output.stdout + output.stderr);
  assert.equal(output.stdout.trim().split('\n').length, 1, 'one JSON result only');
  assert.equal(output.stderr, '', 'no extra console prose leaks onto stderr');
  return JSON.parse(output.stdout);
}

test('real CLI help defaults to Japanese and explicitly supports English with option precedence', async () => {
  assert.match((await cli(['help', '--json'])).result.help, /コマンドモード/u);
  assert.equal(japanese.test((await cli(['help', '--json'], { language: 'en' })).result.help), false);
  assert.equal(japanese.test((await cli(['help', '--json', '--language=en'])).result.help), false);
  assert.match((await cli(['help', '--json', '--language', 'ja'], { language: 'en' })).result.help, /コマンドモード/u);
  assert.equal(resolveLanguage(undefined, undefined, 'en'), 'en');
});

test('parse and language errors are localized before a session can be opened', async () => {
  const unknown = await cli(['unsupported', '--language', 'en'], { expected: 1 });
  assert.equal(unknown.error.code, 'CLI_COMMAND_UNKNOWN');
  assert.equal(unknown.error.message, 'Unknown command. Run help for usage.');
  const missing = await cli(['status', '--session', '--language=en'], { expected: 1 });
  assert.equal(missing.error.code, 'CLI_ARGUMENT_VALUE_REQUIRED');
  assert.equal(japanese.test(missing.error.message), false);
  const invalid = await cli(['help', '--language', 'fr'], { expected: 1, language: 'en' });
  assert.equal(invalid.error.code, 'CLI_LANGUAGE_INVALID'); assert.equal(japanese.test(invalid.error.message), false);
});

test('saved console language is independent of pack locale and failed settings preserve the session', async t => {
  const directory = await temporary(t), session = path.join(directory, 'session.json');
  const settings = path.join(directory, 'settings.json');
  await writeFile(settings, JSON.stringify({ language: 'en', locale: 'ja_JP' }));
  const saved = await cli(['settings', '--session', session, '--file', settings]);
  assert.equal(saved.result.settings.language, 'en'); assert.equal(saved.result.settings.locale, 'ja_JP');
  const before = await readFile(session);
  assert.equal(japanese.test((await cli(['help', '--json', '--session', session])).result.help), false);
  assert.deepEqual(await readFile(session), before);
  const missing = await cli(['list', '--session', session], { expected: 1 });
  assert.equal(missing.error.code, 'CLI_PACK_REQUIRED'); assert.equal(japanese.test(missing.error.message), false);
  const japaneseOverride = await cli(['list', '--session', session, '--language', 'ja'], { expected: 1 });
  assert.equal(japanese.test(japaneseOverride.error.message), true);
  await writeFile(settings, JSON.stringify({ language: 'fr' }));
  const invalid = await cli(['settings', '--session', session, '--file', settings], { expected: 1 });
  assert.equal(invalid.error.code, 'CLI_LANGUAGE_INVALID'); assert.equal(japanese.test(invalid.error.message), false);
  assert.deepEqual(await readFile(session), before);
  await writeFile(settings, JSON.stringify({ language: null }));
  const invalidNull = await cli(['settings', '--session', session, '--file', settings], { expected: 1 });
  assert.equal(invalidNull.error.code, 'CLI_LANGUAGE_INVALID');
  assert.deepEqual(await readFile(session), before);
});

test('workflow validates per-command language before any mutation and settings changes select subsequent error language', async t => {
  const directory = await temporary(t), session = path.join(directory, 'session.json');
  const workflow = path.join(directory, 'workflow.json');
  await writeFile(path.join(directory, 'settings.json'), '{"language":"en"}');
  await writeFile(workflow, JSON.stringify({ schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'settings', options: { file: 'settings.json' } }, { command: 'status', options: { language: 'en' } },
  ] }));
  const refused = await cli(['workflow', '--session', session, '--file', workflow, '--language', 'en'], { expected: 1 });
  assert.equal(refused.error.code, 'CLI_WORKFLOW_LANGUAGE_FORBIDDEN');
  await assert.rejects(stat(session), { code: 'ENOENT' });
  await writeFile(workflow, JSON.stringify({ schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'settings', options: { file: 'settings.json' } }, { command: 'list' },
  ] }));
  const failure = await cli(['workflow', '--session', session, '--file', workflow], { expected: 1 });
  assert.equal(failure.error.context.workflow.completed_count, 1);
  assert.equal(japanese.test(failure.error.message), false);
  assert.equal(JSON.parse(await readFile(session)).settings.language, 'en');
});

test('diagnostic translation uses envelope allowlists and preserves arbitrary authored code/message objects', () => {
  const authored = { code: 'USER_CODE', message: '作品の日本語', diagnostics: [{ code: 'USER_CODE', message: '作品の日本語' }] };
  for (const opaque of ['document', 'items', 'nodes', 'props', 'settings', 'metadata', 'layout', 'definition', 'text', 'source']) {
    const input = { result: { [opaque]: authored, diagnostics: [{ code: 'EDIT_OFFSET_INVALID', message: '移動位置は有限な数値 2 個で指定してください。' }] } };
    const output = localizeConsoleResult(input, 'en');
    assert.equal(output.result[opaque], authored, opaque);
    assert.equal(output.result.diagnostics[0].code, 'EDIT_OFFSET_INVALID');
    assert.equal(japanese.test(output.result.diagnostics[0].message), false);
  }
  const unknown = localizeConsoleResult({ error: { code: 'FUTURE_ERROR', message: '未登録の診断', context: { arbitrary: authored } } }, 'en');
  assert.equal(japanese.test(unknown.error.message), false);
  assert.equal(unknown.error.original_message, '未登録の診断');
  assert.equal(unknown.error.context.arbitrary, authored);
});

test('real import/edit/read uses English diagnostics while Japanese source and source ZIP bytes are preserved', { timeout: 120000 }, async t => {
  const directory = await temporary(t), session = path.join(directory, 'session.json');
  const archive = path.join(directory, '日本語.zip');
  const authored = '\ufeff{\n "namespace":"demo", "screen":{"type":"panel","size":[100,50],"custom_data":{"code":"USER_CODE","message":"作品の日本語"},"controls":[{"title":{"type":"label","text":"漢字と記号★"}}]}\n}\n';
  const bytes = makeZip({ 'manifest.json': manifest, 'ui/demo.json': authored });
  await writeFile(archive, bytes);
  await cli(['import', '--session', session, '--pack', archive, '--language', 'en']);
  const first = await cli(['read', '--session', session, '--file', 'ui/demo.json', '--language', 'en']);
  assert.equal(first.result.text, authored);
  const before = await readFile(session);
  const failure = await cli(['edit', '--session', session, '--file', 'ui/demo.json', '--action', 'move', '--pointer', '/screen', '--value', '["bad",0]', '--language', 'en'], { expected: 1 });
  assert.equal(failure.error.code, 'EDIT_OFFSET_INVALID');
  assert.equal(japanese.test(failure.error.message), false);
  assert.equal(japanese.test(failure.error.context.result.error.message), false);
  assert.deepEqual(await readFile(session), before);
  await cli(['edit', '--session', session, '--file', 'ui/demo.json', '--action', 'set', '--pointer', '/screen/size', '--value', '[120,60]', '--language', 'en']);
  const edited = await cli(['read', '--session', session, '--file', 'ui/demo.json', '--language', 'en']);
  assert.equal(edited.result.text.charCodeAt(0), 0xfeff);
  const document = JSON.parse(edited.result.text.replace(/^\ufeff/u, ''));
  assert.equal(document.screen.custom_data.message, '作品の日本語');
  assert.equal(document.screen.controls[0].title.text, '漢字と記号★');
  await cli(['undo', '--session', session, '--language', 'en']);
  assert.equal((await cli(['read', '--session', session, '--file', 'ui/demo.json', '--language', 'en'])).result.text, authored);
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
});

test('launcher messages and diagnostic SVG switch language without changing identifiers', () => {
  const record = launcherLogRecord('LAUNCH_PORT_INVALID', { message: 'JSONUI_PORT は 0〜65535 の整数で指定してください。', requestedPort: 99999 }, 'en');
  assert.equal(record.event, 'LAUNCH_PORT_INVALID'); assert.equal(record.severity, 'ERROR');
  assert.equal(record.context.message, 'JSONUI_PORT must be an integer from 0 to 65535.');
  assert.equal(record.context.requested_port, 99999);
  assert.equal(consoleText('JSON UI ローカル版', 'en'), 'JSON UI Local');
  const svg = buildStructureSvg({ layout: { boxes: [] } }, { width: 10, height: 10, qualifiedName: '日本語.screen', frameIndex: 0, fps: 60, language: 'en' });
  assert.match(svg, /Structural diagnostics/u); assert.match(svg, /Layout diagram/u);
  assert.match(svg, /日本語.screen/u); assert.doesNotMatch(svg, /実機画像/u);
});

test('BAT/CMD keep ASCII CRLF, fixed message codes, bounded setup and code-page restoration', async () => {
  const root = new URL('../../', import.meta.url);
  const bat = await readFile(new URL('start.bat', root)), cmd = await readFile(new URL('start.cmd', root));
  assert.deepEqual(bat, cmd); assert.equal(bat.every(byte => byte < 128), true);
  const source = bat.toString('ascii'); assert.equal(source.replaceAll('\r\n', '').includes('\n'), false);
  assert.ok(source.includes('chcp.com" 65001 >nul'));
  assert.ok(source.includes('if defined JSONUI_CHANGED_CP "%SystemRoot%\\System32\\chcp.com" %JSONUI_SAVED_CP% >nul'));
  assert.doesNotMatch(source, /setx|ExecutionPolicy Bypass|--insecure/iu);
  for (const language of ['ja', 'en']) {
    const messages = await readFile(new URL(`local-node/bootstrap-messages-${language}.txt`, root), 'utf8');
    for (const [, code] of source.matchAll(/^call :status (SETUP_[A-Z_]+)$/gmu)) assert.match(messages, new RegExp(`^${code}: `, 'mu'));
    assert.equal(japanese.test(messages), language === 'ja');
  }
});
