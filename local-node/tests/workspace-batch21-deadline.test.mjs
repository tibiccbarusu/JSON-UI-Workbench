import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { createLocalServer } from '../server.mjs';
import { LIMITS } from '../limits.mjs';
import { makeZip, manifest } from './fixtures.mjs';

async function opened(task) {
  const app = await createLocalServer({ port: 0 });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const { token } = await (await fetch(`${base}/api/node/capabilities`)).json();
    const id = randomUUID(), bytes = makeZip({ 'manifest.json': manifest,
      'ui/test.json': '{"namespace":"sample","root":{"type":"panel","offset":[0,0]}}' });
    const upload = await fetch(`${base}/api/node/packs`, { method: 'POST', headers: {
      'content-type': 'application/zip', 'x-jsonui-upload-id': id, 'x-jsonui-token': token }, body: bytes });
    assert.equal(upload.status, 200, await upload.text());
    const post = async (route, payload) => {
      const response = await fetch(`${base}/api/node/${route}`, { method: 'POST', headers: {
        'content-type': 'application/json', 'x-jsonui-token': token }, body: JSON.stringify(payload) });
      return { status: response.status, data: await response.json() };
    };
    const state = (await post('workspace-open', { sources: [{ id, kind: 'imported' }] })).data;
    assert.equal(state.ok, true);
    await task({ app, base, token, post, state });
  } finally { await app.close(); }
}
const edit = value => ({ type: 'set', path: 'ui/test.json', pointer: '/root/offset', value });
const batch = () => ({ type: 'batch', operations: [edit([1, 2]), edit([3, 4])] });
const identity = state => ({ workspaceId: state.workspaceId, expectedRevision: state.revision });

function freshRequest(app, token, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(app.port, '127.0.0.1'); let response = '';
    socket.on('connect', () => {
      const body = JSON.stringify(payload);
      socket.write(`POST /api/node/workspace-edit HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\nConnection: close\r\nX-JSONUI-Token: ${token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    });
    socket.on('data', data => { response += data.toString(); });
    socket.on('close', () => resolve(response)); socket.on('error', reject);
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('検査用 HTTP 応答期限')); });
  });
}

test('実 HTTP: batch 応答だけが通常 socket 期限を越え、Worker 期限内で一度確定する', async () => opened(async ({ app, token, post, state }) => {
  const originalCall = app.processor.call.bind(app.processor), observed = [];
  app.processor.call = async (...args) => {
    if (args[0] === 'workspace-edit') { observed.push(args[2]); await pause(100); }
    return originalCall(...args);
  };
  app.server.timeout = 30;
  const ordinary = await freshRequest(app, token, { ...identity(state), operation: edit([9, 9]) });
  assert.equal(ordinary, '');
  await pause(120);
  app.server.timeout = 60000;
  const afterCancelled = (await post('workspace-status', { workspaceId: state.workspaceId })).data;
  assert.equal(afterCancelled.revision, state.revision);
  assert.equal(afterCancelled.editCount, 0);
  app.server.timeout = 30;
  const response = await freshRequest(app, token, { ...identity(state), operation: batch() });
  assert.match(response, /^HTTP\/1\.1 200 /);
  app.server.timeout = 60000;
  const after = (await post('workspace-status', { workspaceId: state.workspaceId })).data;
  assert.equal(after.editCount, 1); assert.equal(after.canUndo, true);
  assert.deepEqual(observed, [LIMITS.jobMs, LIMITS.batchJobMs]);
  const undo = (await post('workspace-undo', identity(after))).data;
  assert.equal(undo.revision, state.revision);
}));

test('ブラウザ adapter: batch は有限 300 秒、通常は 60 秒、呼出側 abort が優先する', async () => opened(async ({ app, base, post, state }) => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const originalTimeout = AbortSignal.timeout, durations = [];
  globalThis.window = { addEventListener() {} };
  globalThis.fetch = (url, options) => originalFetch(new URL(url, base), options);
  AbortSignal.timeout = milliseconds => { durations.push(milliseconds); return originalTimeout(milliseconds); };
  try {
    const { nodeWorkspaceRequest } = await import(`../../editor-core/src/pack-io/node-remote-client.js?deadline=${randomUUID()}`);
    const changed = await nodeWorkspaceRequest('edit', { ...identity(state), operation: edit([1, 1]) });
    assert.equal(changed.ok, true); assert(durations.includes(60000));
    durations.length = 0;
    const changedBatch = await nodeWorkspaceRequest('edit', { ...identity(changed), operation: batch() });
    assert.equal(changedBatch.ok, true);
    // 同じ Node プロセス上の server.body も 30 秒期限を生成する。
    assert.deepEqual(durations.filter(value => value >= 60000), [LIMITS.batchClientMs, LIMITS.batchClientMs]);
    const controller = new AbortController(); controller.abort(new Error('検査用の利用者中止'));
    const callsBefore = app.processor.metrics.calls;
    await assert.rejects(nodeWorkspaceRequest('edit', { ...identity(changedBatch), operation: batch() }, { signal: controller.signal }), /検査用の利用者中止/);
    assert.equal(app.processor.metrics.calls, callsBefore);
    assert.equal((await post('workspace-status', { workspaceId: state.workspaceId })).data.revision, changedBatch.revision);
  } finally {
    globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  }
}));
