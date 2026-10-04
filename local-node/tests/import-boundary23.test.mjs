import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createLocalServer } from '../server.mjs';
import { Processor } from '../worker-client.mjs';
import { decodeUploadName } from '../upload-name.mjs';
import { LIMITS } from '../limits.mjs';
import { makeZip, manifest, resourceFixture } from './fixtures.mjs';

async function serverFixture(t) {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const token = (await (await fetch(base + 'capabilities')).json()).token;
  const headers = { 'X-JSONUI-Token': token };
  return { app, base, headers,
    post(bytes, name = 'pack.zip', id = randomUUID()) {
      return fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id,
        ...(name === null ? {} : { 'X-JSONUI-Name': encodeURIComponent(name) }) }, body: bytes });
    },
    async remove(id) { const response = await fetch(base + 'packs/' + id, { method: 'DELETE', headers }); assert.equal(response.status, 200, await response.text()); },
    async files() { return readdir(path.join(app.root, 'packs')); },
    async snapshot() {
      const response = await fetch(base + 'debug-bundle', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"schema":"jsonui-debug-request-v1"}' });
      assert.equal(response.status, 200); return (await response.json()).server;
    },
  };
}
async function until(condition, description) {
  const deadline = Date.now() + 3000;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(`待機期限: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function pendingUpload(t, api, bytes, id = randomUUID()) {
  const req = http.request(api.base + 'packs', { method: 'POST', headers: { ...api.headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id, 'X-JSONUI-Name': 'waiting.mcpack', 'Content-Length': bytes.length } });
  const complete = new Promise(resolve => {
    req.on('error', () => resolve('closed'));
    req.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('close', () => resolve('closed'));
  });
  t.after(() => req.destroy()); req.flushHeaders(); req.write(bytes.subarray(0, 32));
  return { req, id, complete };
}
function declaredExpanded(bytes, target, expanded) {
  const changed = Buffer.from(bytes); let at = changed.readUInt32LE(changed.length - 6);
  while (changed.readUInt32LE(at) === 0x02014b50) {
    const size = changed.readUInt16LE(at + 28), name = changed.toString('utf8', at + 46, at + 46 + size);
    if (name === target) {
      changed.writeUInt32LE(expanded, at + 24);
      changed.writeUInt32LE(expanded, changed.readUInt32LE(at + 42) + 22); return changed;
    }
    at += 46 + size + changed.readUInt16LE(at + 30) + changed.readUInt16LE(at + 32);
  }
  throw new Error('検査entry不在');
}

test('取込名は Unicode と大文字拡張子を維持し MCADDONを受理しpath・不正URIを拒否する', () => {
  assert.equal(decodeUploadName(undefined), 'pack.zip');
  for (const name of ['日本語100%.MCPACK', '画面 ZIP.zip', 'my.ZIP', 'bundle.mcaddon']) assert.equal(decodeUploadName(encodeURIComponent(name)), name);
  for (const name of ['renamed.txt', 'no-extension', 'pack.zip ']) assert.throws(() => decodeUploadName(encodeURIComponent(name)), { code: 'NODE_PACK_EXTENSION_UNSUPPORTED' });
  for (const name of ['path/file.zip', 'C:\\path\\file.zip', 'control\0.zip', 'あ'.repeat(257) + '.zip']) assert.throws(() => decodeUploadName(encodeURIComponent(name)), { code: 'NODE_NAME_INVALID' });
  assert.throws(() => decodeUploadName('%E0%A4%A'), { code: 'NODE_NAME_INVALID' });
});

test('HTTP 取込は ZIP/MCPACK と省略名を受理し未対応名を disk/Worker 予約前に拒否する', async t => {
  const api = await serverFixture(t), bytes = resourceFixture();
  for (const name of ['日本語100%.MCPACK', 'pack.ZIP', null]) {
    const response = await api.post(bytes, name), result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.zipMeta.fileName, name || 'pack.zip');
    await api.remove(result.id);
  }
  const before = api.app.processor.snapshot().calls;
  for (const name of ['wrong.txt', 'dir/pack.zip']) {
    const response = await api.post(bytes, name), body = await response.json();
    assert.equal(response.status, name.includes('/') ? 400 : 415);
    assert.equal(body.error, name.includes('/') ? 'NODE_NAME_INVALID' : 'NODE_PACK_EXTENSION_UNSUPPORTED');
    assert.deepEqual(await api.files(), []);
  }
  assert.equal(api.app.processor.snapshot().calls, before);
  const invalidUri = await fetch(api.base + 'packs', { method: 'POST', headers: { ...api.headers, 'X-JSONUI-Name': '%E0%A4%A', 'Content-Type': 'application/zip' }, body: bytes });
  assert.equal(invalidUri.status, 400); assert.equal((await invalidUri.json()).error, 'NODE_NAME_INVALID');
  const state = await api.snapshot(); assert.equal(state.activity.disk_bytes, 0); assert.equal(state.packs.length, 0);
});

test('上限超過 Content-Length は本文を待たず予約前に413で拒否する', async t => {
  const api = await serverFixture(t);
  const outcome = await new Promise((resolve, reject) => {
    const request = http.request(api.base + 'packs', { method: 'POST', headers: { ...api.headers, 'Content-Type': 'application/zip',
      'X-JSONUI-Upload-ID': randomUUID(), 'Content-Length': LIMITS.zipBytes + 1 }, timeout: 2000 }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { request.destroy(); resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }); });
    });
    request.on('error', reject); request.on('timeout', () => { request.destroy(); reject(new Error('早期拒否が期限を超過')); }); request.flushHeaders();
  });
  assert.equal(outcome.status, 413); assert.equal(outcome.body.error, 'NODE_UPLOAD_LENGTH_REQUIRED');
  assert.equal(api.app.processor.snapshot().calls, 0); assert.deepEqual(await api.files(), []);
});

test('膨張サイズ・圧縮比の危険entryを展開せず遮断し通常UIと隔離する', async t => {
  const api = await serverFixture(t), base = makeZip({ 'manifest.json': manifest, 'ui/main.json': '{"namespace":"test","screen":{"type":"screen"}}', 'oversized.bin': 'x' });
  for (const [expanded, code] of [[LIMITS.ratioFloor, 'ZIP_ENTRY_COMPRESSION_RATIO'], [LIMITS.entryBytes + 1, 'ZIP_ENTRY_READ_LIMIT']]) {
    const response = await api.post(declaredExpanded(base, 'oversized.bin', expanded)), result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.entries.find(item => item.path === 'oversized.bin').blockedReason, code);
    const blocked = await fetch(api.base + `packs/${result.id}/read?path=oversized.bin`, { headers: api.headers });
    assert.equal(blocked.status, 413); assert.equal((await blocked.json()).error, code);
    const safe = await fetch(api.base + `packs/${result.id}/read?path=ui%2Fmain.json`, { headers: api.headers });
    assert.equal(safe.status, 200); assert.match(await safe.text(), /screen/); await api.remove(result.id);
  }
  const excess = await api.post(declaredExpanded(base, 'oversized.bin', LIMITS.expandedBytes + 1));
  assert.equal(excess.status, 400); assert.equal((await excess.json()).error, 'ZIP_EXPANDED_TOTAL_LIMIT');
  assert.deepEqual(await api.files(), []); assert.equal((await api.snapshot()).activity.disk_bytes, 0);
});

test('構造不正 ZIP の失敗後はファイル/登録を残さず次の MCPACK を受理する', async t => {
  const api = await serverFixture(t);
  for (const bytes of [makeZip({ '../outside': 'x', 'manifest.json': manifest }), resourceFixture().subarray(0, -1), Buffer.alloc(32)]) {
    const response = await api.post(bytes, 'broken.mcpack'); assert.equal(response.status, 400); await response.json();
    assert.deepEqual(await api.files(), []);
    const state = await api.snapshot(); assert.equal(state.activity.disk_bytes, 0); assert.equal(state.activity.uploads, 0); assert.equal(state.packs.length, 0);
  }
  const response = await api.post(resourceFixture(), 'healthy.mcpack'), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result)); await api.remove(result.id); assert.deepEqual(await api.files(), []);
});

test('途中 DELETE は受信待ち upload だけを取消し別パックを維持する', async t => {
  const api = await serverFixture(t), bytes = resourceFixture();
  const ready = await (await api.post(bytes, 'ready.mcpack')).json();
  const upload = pendingUpload(t, api, bytes);
  await until(async () => (await api.files()).includes(upload.id + '.zip'), 'upload 開始');
  await api.remove(upload.id); await upload.complete;
  assert.deepEqual(await api.files(), [ready.id + '.zip']);
  const existing = await fetch(api.base + `packs/${ready.id}/read?path=root%2Fui%2Fexample.json`, { headers: api.headers });
  assert.equal(existing.status, 200); assert.match(await existing.text(), /local text/);
  const state = await api.snapshot(); assert.equal(state.activity.uploads, 0); assert.equal(state.activity.disk_bytes, bytes.length); assert.equal(state.packs.length, 1);
});

test('接続切断で不完全uploadを回収し2件同時上限から回復する', async t => {
  const api = await serverFixture(t), bytes = resourceFixture();
  const first = pendingUpload(t, api, bytes), second = pendingUpload(t, api, bytes);
  await until(async () => (await api.files()).length === 2, '同時 upload 2 件');
  const third = await api.post(bytes, 'third.mcpack'); assert.equal(third.status, 429); assert.equal((await third.json()).error, 'NODE_PACK_LIMIT');
  first.req.destroy(); second.req.destroy(); await Promise.all([first.complete, second.complete]);
  await until(async () => (await api.files()).length === 0, '切断後の file 回収');
  const state = await api.snapshot(); assert.equal(state.activity.uploads, 0); assert.equal(state.activity.disk_bytes, 0); assert.equal(state.packs.length, 0);
  const next = await api.post(bytes, 'next.mcpack'); assert.equal(next.status, 200, await next.text());
});

test('Worker queue 上限・待機取消・実行中取消で枠を漏らさず次の処理へ進む', async t => {
  const processor = new Processor(); t.after(() => processor.close());
  const jobs = Array.from({ length: LIMITS.queue }, () => processor.call('remove', { id: randomUUID() }));
  await assert.rejects(processor.call('remove', { id: randomUUID() }), /NODE_QUEUE_FULL/);
  await Promise.all(jobs); assert.equal(processor.pending, 0);
  const signal = new AbortController();
  const head = processor.call('remove', { id: randomUUID() });
  const queued = processor.call('remove', { id: randomUUID() }, 10000, { signal: signal.signal });
  const rejected = assert.rejects(queued, /NODE_JOB_CANCELLED/); signal.abort(); await head; await rejected;
  assert.equal(processor.snapshot().cancelled_queued, 1);
  const active = new AbortController();
  const running = processor.call('remove', { id: randomUUID() }, 10000, { signal: active.signal });
  const canceled = assert.rejects(running, /NODE_JOB_CANCELLED/); await Promise.resolve(); active.abort(); await canceled;
  assert.equal(processor.snapshot().cancelled_running, 1); assert.equal(processor.dead, false);
  assert.equal((await processor.call('remove', { id: randomUUID() })).body, '{"ok":true}'); assert.equal(processor.pending, 0);
});

test('Worker の実時間上限は有限に失敗し旧 Worker へ追加処理を送らない', async () => {
  const processor = new Processor();
  const started = Date.now();
  try {
    await assert.rejects(processor.call('remove', { id: randomUUID() }, 1), /NODE_JOB_TIMEOUT|NODE_QUEUE_TIMEOUT/);
    assert(Date.now() - started < 3000);
    if (processor.dead) await assert.rejects(processor.call('remove', { id: randomUUID() }), /NODE_PROCESSOR_RESTART_REQUIRED/);
    assert.equal(processor.pending, 0);
  } finally { await processor.close(); }
});

test('Worker停止の診断を保持してから回復し旧パックとtokenを失効する', async t => {
  const api = await serverFixture(t), bytes = resourceFixture();
  const imported = await (await api.post(bytes)).json(); await api.app.processor.close();
  const failed = await api.snapshot(); assert.equal(failed.processor.dead, true); assert.equal(failed.packs.length, 1);
  const recovered = await (await fetch(api.base + 'capabilities')).json();
  assert.notEqual(recovered.token, api.headers['X-JSONUI-Token']); assert.deepEqual(await api.files(), []);
  const old = await fetch(api.base + `packs/${imported.id}/assets`, { headers: api.headers });
  assert.equal(old.status, 401); await old.text(); api.headers['X-JSONUI-Token'] = recovered.token;
  const status = await api.snapshot(); assert.equal(status.processor.dead, false); assert.equal(status.packs.length, 0); assert.equal(status.activity.disk_bytes, 0);
  const healthy = await api.post(bytes); assert.equal(healthy.status, 200, await healthy.text());
});

test('server終了は受信途中uploadとprivate directoryを回収する', async t => {
  const api = await serverFixture(t), upload = pendingUpload(t, api, resourceFixture());
  await until(async () => (await api.files()).length === 1, '終了対象のupload開始');
  await api.app.close(); await upload.complete;
  await assert.rejects(access(api.app.root), { code: 'ENOENT' });
});

for (const suppressLease of [false, true]) test(suppressLease
  ? '対照検査: 本文後leaseを無効にすると250msで切断し750msの取込を完了表示しない'
  : '本文受信後のimportは専用socketの250ms期限を延長し750msのWorker処理を完了する', { timeout: 15000 }, async t => {
  const api = await serverFixture(t);
  await api.app.processor.call('remove', { id: randomUUID() });
  api.app.server.timeout = 250;
  const events = [], began = performance.now(); let postRequest, postResponse;
  const record = (kind, detail = {}) => events.push({ kind, elapsedMs: performance.now() - began, ...detail });
  api.app.server.on('request', (request, response) => {
    if (request.url !== '/api/node/packs') return;
    postRequest = request; postResponse = response; record('headers');
    request.once('end', () => record('body-end'));
    const originalTimeout = response.setTimeout.bind(response);
    response.setTimeout = (ms, ...args) => {
      record('post-body-lease', { ms, suppressed: suppressLease });
      return suppressLease && ms === LIMITS.jobMs + 30000 ? response : originalTimeout(ms, ...args);
    };
  });
  const original = api.app.processor.call.bind(api.app.processor);
  let finishImport; const importFinished = new Promise(resolve => { finishImport = resolve; });
  api.app.processor.call = async (action, payload, ...rest) => {
    if (action !== 'import') return original(action, payload, ...rest);
    try {
      record('worker-delay');
      assert.equal(postRequest.complete, true, JSON.stringify(events));
      assert.equal(postResponse.socket.timeout, suppressLease ? 250 : LIMITS.jobMs + 30000, JSON.stringify(events));
      await new Promise(resolve => setTimeout(resolve, 750));
      record('worker-start');
      return await original(action, payload, ...rest);
    } finally { finishImport(); }
  };
  const bytes = resourceFixture();
  // A dedicated socket excludes fetch-pool reuse racing closeIdleConnections.
  // The 250ms reception deadline itself is unchanged from the original test.
  const received = await new Promise(resolve => {
    const request = http.request(api.base + 'packs', { method: 'POST', agent: false, headers: {
      ...api.headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': randomUUID(),
      'X-JSONUI-Name': 'slow-disk.mcpack', 'Content-Length': bytes.length,
    } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => { record('client-complete'); resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }); });
      response.once('error', error => { record('client-error'); resolve({ error }); });
    });
    request.once('error', error => { record('client-error'); resolve({ error }); });
    request.setTimeout(5000, () => request.destroy(new Error('IMPORT_TEST_DEADLINE')));
    request.end(bytes);
  });
  const kinds = events.map(event => event.kind);
  for (const [before, after] of [['headers', 'body-end'], ['body-end', 'post-body-lease'], ['post-body-lease', 'worker-delay']]) {
    assert(kinds.indexOf(before) >= 0 && kinds.indexOf(after) > kinds.indexOf(before), JSON.stringify(events));
  }
  if (suppressLease) {
    assert(received.error, JSON.stringify(events)); assert.equal(received.status, undefined);
    const errorAt = events.find(event => event.kind === 'client-error').elapsedMs;
    const delayAt = events.find(event => event.kind === 'worker-delay').elapsedMs;
    assert(errorAt - delayAt >= 150 && !kinds.includes('worker-start'), JSON.stringify(events));
    await importFinished;
    await until(async () => (await api.files()).length === 0, '切断後の未返却import回収');
  } else {
    assert.equal(received.error, undefined, JSON.stringify(events));
    assert.equal(received.status, 200, received.text); const result = JSON.parse(received.text); assert(result.id);
    assert(kinds.indexOf('worker-start') > kinds.indexOf('worker-delay'), JSON.stringify(events));
    assert(events.find(event => event.kind === 'client-complete').elapsedMs - events.find(event => event.kind === 'worker-delay').elapsedMs >= 750, JSON.stringify(events));
    api.app.server.timeout = 60000; await api.remove(result.id);
    assert.deepEqual(await api.files(), []);
  }
});
