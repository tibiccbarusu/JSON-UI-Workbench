import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { launchLocal } from '../launcher.mjs';

async function fixture(t) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'jsonui 起動進捗 !&% '));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return { projectRoot, preferredPort: 0, openBrowser: false };
}

async function fakeSite(t) {
  const server = http.createServer((_request, response) => {
    response.end(JSON.stringify({ protocol: 'jsonui-node/v1' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  const app = { port: server.address().port, close: async () => {
    if (closed) return;
    closed = true;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
  t.after(app.close);
  return app;
}

async function unresponsiveOwner(t, projectRoot) {
  const canonical = await realpath(projectRoot);
  const identity = createHash('sha256').update((process.platform === 'win32' ? canonical.toLowerCase() : canonical)
    + '\0' + userInfo().username).digest('hex').slice(0, 24);
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\jsonui-${identity}`
    : { host: '127.0.0.1', port: 32768 + (parseInt(identity.slice(0, 8), 16) % 28232) };
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { server, sockets };
}

test('既存インスタンスが接続だけ受理し無応答でも残余期限内に終了する', async t => {
  const options = await fixture(t);
  const owner = await unresponsiveOwner(t, options.projectRoot);
  let created = 0;
  const started = performance.now();
  await assert.rejects(launchLocal({ ...options, startupWaitMs: 40,
    createServer: async () => { created++; throw new Error('別のサイトを開始してはいけない'); },
  }), { code: 'LAUNCH_INSTANCE_BUSY' });
  assert.ok(performance.now() - started < 500, '40ms の期限に固定 1000ms probe を追加してはいけない');
  assert.equal(created, 0);
  assert.equal(owner.server.listening, true, '別インスタンスを強制終了してはいけない');
  await delay(20);
  assert.equal(owner.sockets.size, 0, '期限切れ probe socket を残してはいけない');
});

test('段階と経過時間を継続記録し、起動完了後・終了後にはheartbeatを残さない', async t => {
  const options = await fixture(t);
  const app = await fakeSite(t);
  const events = [];
  const instance = await launchLocal({ ...options, startupWaitMs: 500, progressIntervalMs: 10,
    openBrowser: true, browser: async () => {},
    createServer: async () => { await delay(45); return app; },
    log: (code, detail) => events.push({ code, detail }),
  });
  t.after(instance.close);
  const progress = events.filter(row => row.code === 'LAUNCH_PROGRESS');
  const initializing = progress.filter(row => row.detail.stage === 'initializing_server');
  assert.ok(initializing.length >= 2, '処理中に繰り返し進捗を記録する');
  assert.ok(progress.some(row => row.detail.stage === 'checking_site'));
  assert.ok(progress.some(row => row.detail.stage === 'opening_browser'));
  assert.ok(initializing.every(row => Number.isInteger(row.detail.elapsedMs) && row.detail.elapsedMs >= 0));
  assert.ok(initializing.every(row => Number.isInteger(row.detail.remainingMs) && row.detail.remainingMs >= 0));
  assert.ok(initializing.every(row => row.detail.waitMs === 500));
  const completed = events.filter(row => row.code === 'LAUNCH_STAGE_COMPLETED');
  assert.deepEqual(completed.map(row => row.detail.stage), ['initializing_server', 'checking_site', 'opening_browser']);
  assert.ok(completed.every(row => Number.isInteger(row.detail.durationMs) && row.detail.durationMs >= 0));
  assert.equal(events.filter(row => row.code === 'LAUNCH_STAGE_FAILED').length, 0);
  const readyCount = events.length;
  await delay(30);
  assert.equal(events.length, readyCount, '通常使用中に起動heartbeatを出し続けてはいけない');
  await instance.close();
  assert.ok(events.some(row => row.code === 'LAUNCH_PROGRESS' && row.detail.stage === 'stopping'));
  const closedCount = events.length;
  await delay(30);
  assert.equal(events.length, closedCount, '終了後にtimerを残してはいけない');
});

test('初期化が完了しない場合も進捗を記録し期限後に再起動できる', async t => {
  const options = await fixture(t);
  const events = [];
  await assert.rejects(launchLocal({ ...options, startupWaitMs: 45, progressIntervalMs: 10,
    createServer: () => new Promise(() => {}),
    log: (code, detail) => events.push({ code, detail }),
  }), { code: 'LAUNCH_START_TIMEOUT' });
  assert.ok(events.filter(row => row.code === 'LAUNCH_PROGRESS' && row.detail.stage === 'initializing_server').length >= 2);
  const failed = events.find(row => row.code === 'LAUNCH_STAGE_FAILED');
  assert.equal(failed.detail.stage, 'initializing_server');
  assert.equal(failed.detail.reasonCode, 'LAUNCH_START_TIMEOUT');
  assert.equal(failed.detail.waitMs, 45);
  assert.ok(failed.detail.durationMs >= 40);
  assert.equal(events.filter(row => row.code === 'LAUNCH_STAGE_COMPLETED' && row.detail.stage === 'initializing_server').length, 0);
  const count = events.length;
  await delay(35);
  assert.equal(events.length, count);
  const app = await fakeSite(t);
  const recovered = await launchLocal({ ...options, createServer: async () => app });
  t.after(recovered.close);
  assert.equal(recovered.reused, false);
});

test('進捗間隔の不正値はファイル作成前に拒否する', async t => {
  const options = await fixture(t);
  for (const progressIntervalMs of [Infinity, NaN, 0, -1, 120001, '5000']) {
    await assert.rejects(launchLocal({ ...options, progressIntervalMs,
      createServer: async () => { throw Object.assign(new Error('作成不可'), { code: 'TEST_STARTED' }); },
    }), { code: 'LAUNCH_WAIT_INVALID' });
  }
  await assert.rejects(stat(path.join(options.projectRoot, '.jsonui')), { code: 'ENOENT' });
});

test('進捗専用コールバックの例外でサイト初期化を中断しない', async t => {
  const options = await fixture(t);
  const app = await fakeSite(t);
  const instance = await launchLocal({ ...options, progressIntervalMs: 10,
    createServer: async () => { await delay(25); return app; },
    log: code => { if (code === 'LAUNCH_PROGRESS') throw new Error('観測先の一時失敗'); },
  });
  t.after(instance.close);
  assert.equal((await fetch(instance.url)).status, 200);
  await instance.close();
});
