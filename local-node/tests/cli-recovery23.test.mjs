import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { CliClient } from '../cli-client.mjs';
import { makeZip, manifest } from './fixtures.mjs';

test('CliClient は転送後 SHA 不一致の登録を回収し同じ接続から再取込できる', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-recovery23-'));
  const client = await CliClient.start();
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const source = path.join(directory, 'input.mcpack');
  const bytes = makeZip({ 'manifest.json': manifest, 'ui/test.json': '{"namespace":"test","screen":{"type":"screen"}}' });
  await writeFile(source, bytes);
  const previous = await client.importPack(source);
  for (let count = 0; count < 5; count++) {
    await assert.rejects(client.importPack(source, { checksum_sha256: '0'.repeat(64), size_bytes: bytes.length }),
      { code: 'CLI_SOURCE_CHANGED' });
    const bundle = await client.request('/api/node/debug-bundle', { payload: { schema: 'jsonui-debug-request-v1' } });
    assert.equal(bundle.server.packs.length, 1);
    assert.equal(bundle.server.packs[0].id, previous.id);
    assert.equal(bundle.server.activity.disk_bytes, bytes.length);
  }
  const imported = await client.importPack(source);
  assert.equal(imported.source.size_bytes, bytes.length);
  const result = await client.request(`/api/node/packs/${imported.id}`, { method: 'DELETE' });
  assert.equal(result.ok, true);
  await client.request(`/api/node/packs/${previous.id}`, { method: 'DELETE' });
  assert.deepEqual(await readFile(source), bytes);
});

test('CliClient は Content-Length 上限拒否後に未読の HTTP 本文を取り消す', { timeout: 5000 }, async t => {
  let responseClosed;
  const closed = new Promise(resolve => { responseClosed = resolve; });
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1024' });
    res.flushHeaders();
    res.once('close', responseClosed);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const client = new CliClient({ port: server.address().port }, 'a'.repeat(64));
  await assert.rejects(client.request('/api/node/test', { maximum: 8, timeout: 4000 }), { code: 'CLI_RESPONSE_LIMIT' });
  let timer;
  const finished = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 250); })]);
  clearTimeout(timer);
  assert.equal(finished, true, '要求の4秒期限を待たずにHTTP応答を回収する');
});
