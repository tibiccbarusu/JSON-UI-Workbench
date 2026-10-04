import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { launchLocal } from '../launcher.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

test('実launchLocalのWindows予算は可視239を許し240をNUL込みで拒否する', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'jsonui-nul-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  // Linuxではプラットフォーム分岐だけを模擬する。native Windows試験ではない。
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  try {
    for (const visibleLength of [238, 239, 240, 241]) {
      const fixedLength = path.join(root, 'x', 'launcher.log.1').length;
      const state = path.join(root, 'x'.repeat(1 + visibleLength - fixedLength));
      assert.equal(path.join(state, 'launcher.log.1').length, visibleLength);
      await writeFile(state, '既存項目を保存する');
      // 239以下はpath guardを通過し、その次の状態folder準備で既存fileを検知する。
      const expectedCode = visibleLength + 1 > 240 ? 'LAUNCH_PATH_LONG' : 'LAUNCH_STATE_UNAVAILABLE';
      let created = 0;
      await assert.rejects(launchLocal({ projectRoot: root, stateDirectory: state,
        preferredPort: 0, openBrowser: false,
        createServer() { created++; throw new Error('serverは作成しない'); },
      }), { code: expectedCode });
      assert.equal(created, 0);
      assert.equal(await readFile(state, 'utf8'), '既存項目を保存する');
    }
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});

test('実mainも可視240を状態folder作成前に拒否する（Linuxでwin32分岐を模擬）', {
  skip: process.platform === 'win32' ? 'この試験はLinuxの隔離コピーでWindows分岐を模擬する専用試験' : false,
}, async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'jsonui-main-nul-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const fixedLength = path.join(base, 'x', '.jsonui', 'launcher.log.1').length;
  const root = path.join(base, 'x'.repeat(1 + 240 - fixedLength));
  assert.equal(path.join(root, '.jsonui', 'launcher.log.1').length, 240);
  await mkdir(root);
  await cp(path.join(packageRoot, 'local-node'), path.join(root, 'local-node'), { recursive: true });
  await cp(path.join(packageRoot, 'editor-core'), path.join(root, 'editor-core'), { recursive: true });
  await cp(path.join(packageRoot, 'package.json'), path.join(root, 'package.json'));
  const preload = path.join(base, 'simulate-platform.mjs');
  await writeFile(preload, "Object.defineProperty(process, 'platform', { value: 'win32' });\n");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', preload, path.join(root, 'local-node', 'launcher.mjs')], {
      shell: false, env: { ...process.env, JSONUI_NO_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('境界試験が10秒で終了しない')); }, 10000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', cause => { clearTimeout(timer); reject(cause); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /LAUNCH_PATH_LONG/u);
  await assert.rejects(readFile(path.join(root, '.jsonui', 'launcher.log')), { code: 'ENOENT' });
});

test('BAT/CMD/PowerShellの静的境界とbyte形式を同じNUL込み240に揃える', async () => {
  const bat = await readFile(path.join(packageRoot, 'start.bat'));
  const cmd = await readFile(path.join(packageRoot, 'start.cmd'));
  const ps = await readFile(path.join(packageRoot, 'local-node', 'bootstrap.ps1'));
  assert.deepEqual(bat, cmd);
  assert.ok(bat.every(byte => byte < 128));
  assert.equal(bat.toString('ascii').replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(ps.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.equal(ps.toString('utf8').replaceAll('\r\n', '').includes('\n'), false);
  assert.match(bat.toString('ascii'), /if not "%JSONUI_PATH_PROBE:~239,1%"=="" goto path_long/u);
  assert.match(ps.toString('utf8'), /if \(\(\$LiteralPath\.Length \+ 1\) -gt 240\)/u);
});
