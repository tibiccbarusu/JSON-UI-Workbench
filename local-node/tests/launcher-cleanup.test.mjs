import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchLocal } from '../launcher.mjs';

async function fixture(t, protocol) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'jsonui-close-deadline-'));
  const server = http.createServer((_request, response) => {
    response.end(JSON.stringify({ protocol }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(projectRoot, { recursive: true, force: true });
  });
  return { projectRoot, preferredPort: 0, openBrowser: false, shutdownWaitMs: 30,
    createServer: async () => ({ port: server.address().port, close: () => new Promise(() => {}) }),
  };
}

async function assertBoundedRejection(operation, code) {
  let deadline;
  try {
    await assert.rejects(Promise.race([operation,
      new Promise((_resolve, reject) => {
        deadline = setTimeout(() => reject(Object.assign(new Error('検査の500ms期限を超過'), { code: 'TEST_DEADLINE' })), 500);
      }),
    ]), { code });
  } finally { clearTimeout(deadline); }
}

test('準備失敗後にserver.closeが止まっても元の失敗を有限時間で返す', async t => {
  const options = await fixture(t, 'unrelated');
  const events = [];
  await assertBoundedRejection(launchLocal({ ...options,
    log: (event, detail) => events.push({ event, detail }),
  }), 'LAUNCH_NOT_READY');
  assert.equal(events.filter(row => row.event === 'LAUNCH_CLEANUP_FAILED').length, 1);
  assert.equal(events.find(row => row.event === 'LAUNCH_CLEANUP_FAILED').detail.reasonCode, 'LAUNCH_CLOSE_TIMEOUT');
  // Startup failure must also release the instance endpoint. A later startup
  // can acquire it without terminating this fixture's unrelated HTTP listener.
  await assert.rejects(launchLocal({ ...options,
    createServer: async () => { throw Object.assign(new Error('reacquired'), { code: 'TEST_REACQUIRED' }); },
  }), { code: 'TEST_REACQUIRED' });
});

test('通常終了でもserver.closeの未完了は期限と固有コードで返す', async t => {
  const options = await fixture(t, 'jsonui-node/v1');
  const instance = await launchLocal(options);
  await assertBoundedRejection(instance.close(), 'LAUNCH_CLOSE_TIMEOUT');
  await assertBoundedRejection(instance.close(), 'LAUNCH_CLOSE_TIMEOUT');
});

test('終了期限の設定は不正値を状態作成前に拒否する', async t => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'jsonui-close-validation-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  for (const shutdownWaitMs of [Infinity, NaN, -1, 0, 120001, '10000']) {
    await assert.rejects(launchLocal({ shutdownWaitMs, projectRoot, openBrowser: false,
      createServer: async () => { throw Object.assign(new Error('serverは作成しない'), { code: 'TEST_STARTED' }); },
    }), { code: 'LAUNCH_WAIT_INVALID' });
  }
});
