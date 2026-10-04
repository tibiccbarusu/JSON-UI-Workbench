import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

test('実launcher mainの起動→HTTP→終了で実行ID・連番・Node環境・段階結果を保存する', { timeout: 20000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'jui26-launch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('../../', import.meta.url));
  await Promise.all(['local-node', 'editor-core', 'package.json'].map(name =>
    cp(path.join(source, name), path.join(root, name), { recursive: true })));
  const child = spawn(process.execPath, [path.join(root, 'local-node', 'launcher.mjs')], {
    shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JSONUI_PORT: '0', JSONUI_HOST: '127.0.0.1', JSONUI_NO_BROWSER: '1' },
  });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const ready = await new Promise((resolve, reject) => {
    let pending = '';
    const timer = setTimeout(() => reject(new Error('起動診断試験が10秒以内に準備完了しませんでした')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('準備前に終了: ' + stderr.slice(0, 2048))); });
    child.stdout.on('data', chunk => {
      pending += chunk.toString();
      if (pending.length > 1024 * 1024) { clearTimeout(timer); reject(new Error('起動出力上限')); return; }
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        const item = JSON.parse(line);
        if (item.event === 'LAUNCH_READY') { clearTimeout(timer); resolve(item); }
      }
    });
  });
  assert.equal((await fetch(ready.context.url)).status, 200);
  child.kill('SIGTERM');
  assert.equal((await exited).code, 0);
  const text = await readFile(path.join(root, '.jsonui', 'launcher.log'), 'utf8');
  const rows = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].event, 'LAUNCH_RUNTIME');
  assert.equal(rows[0].context.node_version, process.version);
  assert.equal(rows[0].context.platform, process.platform);
  assert.equal(rows[0].context.architecture, process.arch);
  assert.equal(rows[0].context.browser_requested, false);
  const runId = rows[0].context.launch_run_id;
  assert.match(runId, /^[a-f0-9-]{36}$/u);
  assert.ok(rows.every((row, index) => row.context.launch_run_id === runId
    && row.context.sequence === index + 1 && row.context.process_id === child.pid));
  assert.ok(rows.every((row, index) => Number.isInteger(row.context.elapsed_ms)
    && row.context.elapsed_ms >= (rows[index - 1]?.context.elapsed_ms || 0)));
  assert.ok(rows.some(row => row.event === 'LAUNCH_STAGE_COMPLETED' && row.context.stage === 'checking_site'));
  assert.ok(rows.some(row => row.event === 'LAUNCH_STAGE_COMPLETED' && row.context.stage === 'stopping'));
  assert.ok(rows.some(row => row.event === 'LAUNCH_STOPPED'));
  assert.doesNotMatch(text, /capability_token|api_token|authorization/u);
});
