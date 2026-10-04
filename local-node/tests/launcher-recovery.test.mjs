import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { launchLocal, launcherLogRecord, prepareLauncherState } from '../launcher.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'jsonui 起動 !&% '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function copyEntrypoint(root) {
  await cp(path.join(packageRoot, 'local-node'), path.join(root, 'local-node'), { recursive: true });
  await cp(path.join(packageRoot, 'editor-core'), path.join(root, 'editor-core'), { recursive: true });
  await cp(path.join(packageRoot, 'package.json'), path.join(root, 'package.json'));
}

async function runEntrypoint(root, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'local-node', 'launcher.mjs')], {
      shell: false, env: { ...process.env, JSONUI_NO_BROWSER: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('起動試験が10秒で完了しませんでした。')); }, 10000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', cause => { clearTimeout(timer); reject(cause); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

test('状態フォルダーの衝突は具体的な復旧案内となり既存ファイルを変えない', async t => {
  const root = await fixture(t);
  const state = path.join(root, '.jsonui');
  await writeFile(state, 'preserve original bytes');
  await assert.rejects(prepareLauncherState(state), cause => {
    assert.equal(cause.code, 'LAUNCH_STATE_UNAVAILABLE');
    assert.match(cause.message, /書き込み可能/u);
    assert.match(cause.message, /start\.bat/u);
    assert.ok(cause.cause);
    return true;
  });
  assert.equal(await readFile(state, 'utf8'), 'preserve original bytes');
});

test('状態フォルダー準備失敗ではHTTPサーバーを作成しない', async t => {
  const root = await fixture(t);
  const state = path.join(root, '.jsonui');
  await writeFile(state, 'keep');
  let created = 0;
  await assert.rejects(launchLocal({ projectRoot: root, stateDirectory: state,
    preferredPort: 0, openBrowser: false, createServer() { created++; throw new Error('must not start'); },
  }), { code: 'LAUNCH_STATE_UNAVAILABLE' });
  assert.equal(created, 0);
});

test('実際のエントリーポイントはログ準備前の失敗もstderrと非ゼロ終了で説明する', async t => {
  const root = await fixture(t);
  await copyEntrypoint(root);
  await writeFile(path.join(root, '.jsonui'), 'keep');
  const result = await runEntrypoint(root);
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  const record = JSON.parse(result.stderr.trim());
  assert.equal(record.event, 'LAUNCH_STATE_UNAVAILABLE');
  assert.equal(record.severity, 'ERROR');
  assert.match(record.context.message, /書き込み可能/u);
  assert.doesNotMatch(result.stderr, /at main|node:internal|preserve original/u);
});

test('ログ書込み失敗を黙って捨てず1回だけstderrへ報告する', async t => {
  const root = await fixture(t);
  await copyEntrypoint(root);
  await mkdir(path.join(root, '.jsonui', 'launcher.log'), { recursive: true });
  const result = await runEntrypoint(root, { JSONUI_PORT: 'invalid' });
  assert.equal(result.code, 1);
  const records = result.stderr.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records.filter(row => row.event === 'LAUNCH_PORT_INVALID').length, 1);
  assert.equal(records.filter(row => row.event === 'LAUNCH_LOG_UNAVAILABLE').length, 1);
  assert.ok(records.every(row => row.severity === 'ERROR'));
  assert.equal(result.stdout, '');
});

test('timeoutと準備未完了をINFO扱いせず、ログ内の秘密と絶対パスを秘匿する', () => {
  for (const code of ['LAUNCH_START_TIMEOUT', 'LAUNCH_INSTANCE_BUSY', 'LAUNCH_NOT_READY', 'LAUNCH_STATE_UNAVAILABLE']) {
    const record = launcherLogRecord(code, { apiToken: 'hidden-launcher-secret', errorPath: 'C:\\Users\\person\\private.txt' });
    assert.equal(record.severity, 'ERROR');
    assert.doesNotMatch(JSON.stringify(record), /hidden-launcher-secret|person/u);
  }
  assert.equal(launcherLogRecord('LAUNCH_BROWSER_MANUAL').severity, 'WARN');
  assert.equal(launcherLogRecord('LAUNCH_PORT_FALLBACK').severity, 'WARN');
  assert.equal(launcherLogRecord('LAUNCH_READY').severity, 'INFO');
});

test('対応Node下限22.14.0はそのまま受理し旧版だけ準備経路へ返す', async () => {
  const source = await readFile(path.join(packageRoot, 'local-node', 'version-check.cjs'), 'utf8');
  for (const version of ['18.20.0', '20.19.0', '22.13.9', '22.14.0', '22.14.1', '24.20.0']) {
    const context = { process: { versions: { node: version }, exitCode: null } };
    vm.runInNewContext(source, context);
    const supported = ['22.14.0', '22.14.1', '24.20.0'].includes(version);
    assert.equal(context.process.exitCode, supported ? 0 : 42, version);
  }
});
