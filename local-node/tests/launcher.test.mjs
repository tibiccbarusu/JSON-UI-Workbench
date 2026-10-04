import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchLocal, parsePort, openLocalBrowser } from '../launcher.mjs';

async function fixture(t) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'jsonui 日本語! &% '));
  const cleanup = [];
  // Stop owners before removing their live log directory. A failed early rm
  // previously skipped later hooks and left an HTTP server keeping tests alive.
  t.after(async () => {
    try { for (const stop of cleanup.reverse()) await stop(); }
    finally { await rm(projectRoot, { recursive: true, force: true }); }
  });
  return { projectRoot, preferredPort: 0, openBrowser: false, cleanup };
}

test('port input rejects malformed values and accepts OS allocation', () => {
  assert.equal(parsePort(), 3210);
  assert.equal(parsePort('0'), 0);
  assert.equal(parsePort('65535'), 65535);
  for (const value of ['', ' 3210', '3e3', '0x100', '-1', '65536', '0001', 3210]) {
    assert.throws(() => parsePort(value), { code: 'LAUNCH_PORT_INVALID' });
  }
});

test('browser never receives external, injected, or malformed URLs', async () => {
  for (const url of ['https://example.com/', 'http://127.0.0.1:0/', 'http://127.0.0.1:70000/', 'http://127.0.0.1:3210/&calc', 'file:///C:/Windows']) {
    await assert.rejects(openLocalBrowser(url), { code: 'LAUNCH_URL_INVALID' });
  }
});

test('real HTTP readiness precedes browser launch and duplicate reuses same app', async t => {
  const options = await fixture(t);
  const browserCalls = [];
  const browser = async url => {
    const response = await fetch(new URL('api/node/capabilities', url));
    assert.equal((await response.json()).protocol, 'jsonui-node/v1');
    browserCalls.push(url);
  };
  const first = await launchLocal({ ...options, openBrowser: true, browser });
  options.cleanup.push(first.close);
  const second = await launchLocal({ ...options, openBrowser: true, browser });
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(first.url, second.url);
  assert.deepEqual(browserCalls, [first.url, first.url]);
  await second.close();
  assert.equal((await fetch(first.url)).status, 200);
  await first.close();
  await assert.rejects(fetch(first.url));
});

test('simultaneous launches create exactly one HTTP renderer', async t => {
  const options = await fixture(t);
  const instances = await Promise.all(Array.from({ length: 4 }, () => launchLocal(options)));
  const owners = instances.filter(instance => !instance.reused);
  options.cleanup.push(() => Promise.all(owners.map(instance => instance.close())));
  assert.equal(owners.length, 1);
  assert.equal(new Set(instances.map(instance => instance.url)).size, 1);
});

test('occupied preferred port is preserved and an available port is selected', async t => {
  const options = await fixture(t);
  const unrelated = http.createServer((_req, res) => res.end('unrelated'));
  await new Promise(resolve => unrelated.listen(0, '127.0.0.1', resolve));
  options.cleanup.push(() => new Promise(resolve => unrelated.close(resolve)));
  const port = unrelated.address().port;
  const events = [];
  const instance = await launchLocal({ ...options, preferredPort: port, log: code => events.push(code) });
  options.cleanup.push(instance.close);
  assert.notEqual(new URL(instance.url).port, String(port));
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'unrelated');
  assert.ok(events.includes('LAUNCH_PORT_FALLBACK'));
});

test('failed startup releases instance ownership so a later launch can recover', async t => {
  const options = await fixture(t);
  await assert.rejects(launchLocal({ ...options, createServer: async () => {
    throw Object.assign(new Error('startup failure fixture'), { code: 'TEST_FAILURE' });
  } }), { code: 'TEST_FAILURE' });
  const instance = await launchLocal(options);
  options.cleanup.push(instance.close);
  assert.equal(instance.reused, false);
});

test('browser failure leaves running renderer usable and reports manual URL', async t => {
  const options = await fixture(t);
  const events = [];
  const instance = await launchLocal({ ...options, openBrowser: true, browser: async () => { throw new Error('browser unavailable'); },
    log: (code, detail) => events.push({ code, detail }) });
  options.cleanup.push(instance.close);
  assert.equal((await fetch(instance.url)).status, 200);
  assert.ok(events.some(event => event.code === 'LAUNCH_BROWSER_MANUAL' && event.detail.url === instance.url));
});

test('process interruption releases ownership and a new process can start', async t => {
  const options = await fixture(t);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./launcher-child.mjs', import.meta.url)), options.projectRoot], {
    shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, JSONUI_LAUNCHER_CHILD: '1' },
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  options.cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  const ready = await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => reject(new Error('child readiness timeout: ' + errors)), 10000);
    child.stderr.on('data', data => { errors += data; });
    child.once('error', cause => { clearTimeout(timer); reject(cause); });
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0])); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('child exited before readiness: ' + errors)); });
  });
  assert.equal(ready.reused, false);
  const reused = await launchLocal(options);
  assert.equal(reused.reused, true);
  assert.equal(reused.url, ready.url);
  child.kill('SIGKILL');
  await exited;
  const recovered = await launchLocal(options);
  options.cleanup.push(recovered.close);
  assert.equal(recovered.reused, false);
  assert.equal((await fetch(recovered.url)).status, 200);
});

test('初期化timeout後は所有権を解放し遅れて完成したserverを残さない', async t => {
  const options = await fixture(t);
  let finish, closed = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  await assert.rejects(launchLocal({ ...options, startupWaitMs: 20, createServer: () => pending }), { code: 'LAUNCH_START_TIMEOUT' });
  finish({ close: async () => { closed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1);
  const recovered = await launchLocal(options); options.cleanup.push(() => recovered.close());
  assert.equal(recovered.reused, false);
  assert.match(recovered.url, /^http:\/\/127\.0\.0\.1:/u);
});
