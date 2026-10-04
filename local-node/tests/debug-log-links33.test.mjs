import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, link, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readServerLogs, readLauncherLog, readBootstrapLog } from '../debug-bundle.mjs';
import { createLocalServer } from '../server.mjs';

async function directory(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'jui-log-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const readers = [
  ['server.log', async root => (await readServerLogs(root)).current],
  ['server.log.1', async root => (await readServerLogs(root)).previous],
  ['launcher.log', readLauncherLog],
  ['bootstrap.log', readBootstrapLog],
];

test('全ログ読取境界でhardlink由来の無関係な内容をexportしない', async t => {
  const root = await directory(t), target = path.join(root, 'private-note.jsonl');
  const text = JSON.stringify({ note: 'UNRELATED_CONTENT_MUST_NOT_BE_EXPORTED' }) + '\n';
  await writeFile(target, text);
  for (const [name, read] of readers) {
    const file = path.join(root, name);
    await link(target, file);
    const result = await read(root);
    assert.equal(result.status, 'unavailable', name);
    assert.equal(result.reason, 'LOG_HARDLINK_REJECTED', name);
    assert.doesNotMatch(JSON.stringify(result), /UNRELATED_CONTENT/u);
    assert.equal(await readFile(target, 'utf8'), text);
    await rm(file);
  }
});

test('全ログ読取境界でsymlink由来の無関係な内容をexportしない', async t => {
  const root = await directory(t), target = path.join(root, 'private-note.jsonl');
  await writeFile(target, JSON.stringify({ note: 'UNRELATED_CONTENT_MUST_NOT_BE_EXPORTED' }) + '\n');
  for (const [name, read] of readers) {
    const file = path.join(root, name);
    await symlink(target, file);
    const result = await read(root);
    assert.equal(result.status, 'unavailable', name);
    assert.equal(result.reason, 'LOG_PATH_REDIRECT_REJECTED', name);
    await rm(file);
  }
});

test('通常ログは読めて秘密・パスを隠し、malformed件数も保持する', async t => {
  const root = await directory(t);
  await writeFile(path.join(root, 'server.log'), JSON.stringify({ event: 'READ_TEST', token: 'SECRET_VALUE',
    context: { route: '/api/node/frame', note: 'Bearer RAW_CREDENTIAL', path: '/home/user/private',
      pack: 'textures/ui/slot' } }) + '\ninvalid\n');
  const result = (await readServerLogs(root)).current;
  assert.equal(result.status, 'available');
  assert.equal(result.malformed_records, 1);
  assert.equal(result.data[0].context.pack, 'textures/ui/slot');
  assert.doesNotMatch(JSON.stringify(result), /SECRET_VALUE|RAW_CREDENTIAL|\/home\/user/u);
});

test('worker終了後も回復を発動せずdebug-bundleを取得できる', { timeout: 15000 }, async t => {
  const root = await directory(t), app = await createLocalServer({ port: 0, logDirectory: root });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const capability = await (await fetch(base + 'capabilities')).json();
  await app.processor.close();
  const response = await fetch(base + 'debug-bundle', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-JSONUI-Token': capability.token,
  }, body: JSON.stringify({ schema: 'jsonui-debug-request-v1' }) });
  assert.equal(response.status, 200);
  const bundle = await response.json();
  assert.equal(bundle.server.processor.dead, true);
  assert(!bundle.server.journal.events.some(row => row.event === 'NODE_PROCESSOR_RECOVERED'));
  assert.equal(bundle.server.log_persistence.completed, true);
  assert(!JSON.stringify(bundle).includes(capability.token));
});
