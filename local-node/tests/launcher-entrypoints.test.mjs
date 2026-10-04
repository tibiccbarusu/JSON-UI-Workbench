import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'jsonui-entry 日本語 !&% '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function childProcess(t, command, args, options) {
  const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stdout = '', stderr = '';
  let timer;
  const completion = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('entrypoint deadline: ' + stderr)); }, 10000);
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await completion;
  });
  return { child, completion, stdout: () => stdout };
}

test('BATの終了値は継承ERRORLEVELの文字列で隠れないよう局所解除する（静的）', async () => {
  const bat = await readFile(path.join(packageRoot, 'start.bat'), 'ascii');
  const clear = bat.indexOf('set "ERRORLEVEL="');
  assert.ok(clear > bat.indexOf('setlocal enableextensions disabledelayedexpansion'));
  assert.ok(clear < bat.indexOf('%errorlevel%'));
  assert.equal((bat.match(/^set "ERRORLEVEL=/gmu) || []).length, 1);
});

test('GUI launcher can be imported without output, browser startup or a live server', async t => {
  const moduleURL = pathToFileURL(path.join(packageRoot, 'local-node', 'launcher.mjs')).href;
  const result = await childProcess(t, process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(moduleURL)}); process.stdout.write('imported');`], {
    cwd: tmpdir(), env: { ...process.env, JSONUI_NO_BROWSER: '1' },
  }).completion;
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'imported');
  assert.equal(result.stderr, '');
});

test('start.shの実起動は準備確認後に応答し二回目は同じサイトを再利用する', {
  skip: process.platform === 'win32' ? 'POSIX shell実行を対象とする検査' : false,
}, async t => {
  const root = await fixture(t);
  for (const item of ['start.sh', 'package.json', 'local-node', 'editor-core']) {
    await cp(path.join(packageRoot, item), path.join(root, item), { recursive: true });
  }
  const options = { cwd: tmpdir(), env: { ...process.env, JSONUI_PORT: '0', JSONUI_NO_BROWSER: '1' } };
  const first = childProcess(t, '/bin/bash', [path.join(root, 'start.sh')], options);
  const ready = await new Promise((resolve, reject) => {
    const check = () => {
      const line = first.stdout().split('\n').find(value => value.includes('"event":"LAUNCH_READY"'));
      if (line) resolve(JSON.parse(line));
    };
    first.child.stdout.on('data', check);
    first.completion.then(() => reject(new Error('launcher exited before ready')), reject);
    check();
  });
  const url = ready.context.url;
  assert.equal((await (await fetch(new URL('api/node/capabilities', url))).json()).protocol, 'jsonui-node/v1');
  const guiHTML = await (await fetch(url)).text();
  assert.match(guiHTML, /class="experimental-gui-notice" role="note"/u);
  assert.match(guiHTML, /GUI 実験版（未完成）/u);
  assert.match(guiHTML, /Experimental GUI \(unfinished\)/u);
  assert.match(first.stdout(), /GUI 実験版（未完成）/u);
  const second = await childProcess(t, '/bin/bash', [path.join(root, 'start.sh')], options).completion;
  assert.equal(second.code, 0);
  assert.match(second.stdout, /"event":"LAUNCH_REUSED"/u);
  const reused = JSON.parse(second.stdout.split('\n').find(line => line.includes('"event":"LAUNCH_REUSED"')));
  assert.equal(reused.context.url, url);
  assert.equal((await fetch(url)).status, 200);
});

test('start.shは異常終了するPATHのNodeでサイトを起動せず対応版の案内を返す', {
  skip: process.platform === 'win32' ? 'POSIX shell実行を対象とする検査' : false,
}, async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'node'), '#!/bin/sh\nexit 7\n', { mode: 0o700 });
  for (const language of ['ja', 'en']) {
    const result = await childProcess(t, '/bin/bash', [path.join(packageRoot, 'start.sh')], {
      env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, JSONUI_NO_BROWSER: '1', JSONUI_LANGUAGE: language },
    }).completion;
    assert.equal(result.code, 42);
    assert.match(result.stderr, language === 'en' ? /Node\.js could not confirm version 22\.14\.0/u : /Node\.js 22\.14\.0 以降を確認できません/u);
    assert.doesNotMatch(result.stdout, /LAUNCH_READY/u);
  }
});

test('Windows実BATはERRORLEVEL=0継承下でも版確認42を受理しない', {
  skip: process.platform !== 'win32' ? 'Windows cmd.exeが必要。静的検査の成功とは区別する' : false,
}, async t => {
  const root = await fixture(t);
  await cp(path.join(packageRoot, 'start.bat'), path.join(root, 'start.bat'));
  await mkdir(path.join(root, 'local-node'));
  await mkdir(path.join(root, 'editor-core', 'app'), { recursive: true });
  await mkdir(path.join(root, 'editor-core', 'src'));
  await cp(process.execPath, path.join(root, 'node.exe'));
  await writeFile(path.join(root, 'local-node', 'version-check.cjs'), 'process.exitCode = 42;\n');
  for (const item of ['local-node/server.mjs', 'editor-core/app/index.html', 'editor-core/src/main.js']) {
    await writeFile(path.join(root, item), '');
  }
  await writeFile(path.join(root, 'local-node', 'launcher.mjs'), 'console.log("INVALID_NODE_WAS_RUN");\n');
  // Unsupported architecture stops the private bootstrap before any download.
  const result = await childProcess(t, path.join(process.env.SystemRoot, 'System32', 'cmd.exe'), ['/d', '/c', 'start.bat'], {
    cwd: root,
    env: { ...process.env, PATH: root, ERRORLEVEL: '0', PROCESSOR_ARCHITEW6432: 'x86', PROCESSOR_ARCHITECTURE: 'x86' },
  }).completion;
  assert.equal(result.code, 20);
  assert.doesNotMatch(result.stdout, /INVALID_NODE_WAS_RUN/u);
});
