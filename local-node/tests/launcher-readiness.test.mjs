import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchLocal } from '../launcher.mjs';

async function fixture(t) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'jsonui-health-'));
  const cleanup = [];
  t.after(async () => {
    try { for (const stop of cleanup.reverse()) await stop(); }
    finally { await rm(projectRoot, { recursive: true, force: true }); }
  });
  return { projectRoot, preferredPort: 0, openBrowser: false, cleanup };
}

async function fakeSite(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const app = { port: server.address().port, close: async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
  t.after(app.close);
  return app;
}

async function rejectsLaunch(t, options, code) {
  await assert.rejects(async () => {
    const unexpected = await launchLocal(options);
    // A regression must fail the assertion without leaving its server alive.
    options.cleanup.push(unexpected.close);
  }, { code });
}

test('起動済みIPCだけが残りHTTPが停止した場合は再利用成功と扱わない', async t => {
  const options = await fixture(t);
  const app = await fakeSite(t, (_req, res) => res.end(JSON.stringify({ protocol: 'jsonui-node/v1' })));
  const owner = await launchLocal({ ...options, createServer: async () => app });
  options.cleanup.push(owner.close);
  await app.close();
  let browserCalls = 0;
  await rejectsLaunch(t, { ...options, openBrowser: true,
    browser: async () => { browserCalls++; },
  }, 'LAUNCH_INSTANCE_UNAVAILABLE');
  assert.equal(browserCalls, 0);
});

test('準備応答がプロトコルを失った場合は二重起動でも異常を報告する', async t => {
  const options = await fixture(t);
  let healthy = true;
  const app = await fakeSite(t, (_req, res) => res.end(JSON.stringify({ protocol: healthy ? 'jsonui-node/v1' : 'unrelated' })));
  const owner = await launchLocal({ ...options, createServer: async () => app });
  options.cleanup.push(owner.close);
  healthy = false;
  await rejectsLaunch(t, options, 'LAUNCH_INSTANCE_UNAVAILABLE');
  healthy = true;
  assert.equal((await launchLocal(options)).reused, true);
});

test('準備応答が巨大な場合は上限で打ち切り、所有権を解放する', async t => {
  const options = await fixture(t);
  const app = await fakeSite(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ protocol: 'jsonui-node/v1', extra: 'x'.repeat(70000) }));
  });
  await rejectsLaunch(t, { ...options, createServer: async () => app }, 'LAUNCH_NOT_READY');
  const recovered = await launchLocal(options);
  options.cleanup.push(recovered.close);
  assert.equal(recovered.reused, false);
});

test('準備応答が終わらない場合も有限期限で停止し次回起動を妨げない', async t => {
  const options = await fixture(t);
  const app = await fakeSite(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"protocol":');
  });
  await rejectsLaunch(t, { ...options, readinessWaitMs: 30,
    createServer: async () => app,
  }, 'LAUNCH_HEALTH_TIMEOUT');
  const recovered = await launchLocal(options);
  options.cleanup.push(recovered.close);
  assert.equal(recovered.reused, false);
});

test('初期化・準備完了の待機設定は無限大や不正値を状態作成前に拒否する', async t => {
  const options = await fixture(t);
  for (const name of ['startupWaitMs', 'readinessWaitMs']) {
    for (const value of [Infinity, NaN, -1, 0, 120001, '15000']) {
      await rejectsLaunch(t, { ...options, [name]: value }, 'LAUNCH_WAIT_INVALID');
    }
  }
  await assert.rejects(stat(path.join(options.projectRoot, '.jsonui')), { code: 'ENOENT' });
});

test('起動モジュールを直接呼ぶ場合も不正なポートで書込みや待受けを始めない', async t => {
  const options = await fixture(t);
  for (const value of [Infinity, NaN, -1, 65536, '3210']) {
    await rejectsLaunch(t, { ...options, preferredPort: value }, 'LAUNCH_PORT_INVALID');
  }
  await assert.rejects(stat(path.join(options.projectRoot, '.jsonui')), { code: 'ENOENT' });
});
