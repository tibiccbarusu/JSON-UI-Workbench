import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createRendererServer, runApiServer, HTTP_API_LIMITS } from '../api-server.mjs';
import { CliClient } from '../cli-client.mjs';
import { createLocalServer } from '../server.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
const execute = promisify(execFile);
const sha = data => createHash('sha256').update(data).digest('hex');
async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-api-server-'));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
async function request(app, method, input = {}, { headers = {}, body, verb = 'POST' } = {}) {
  const bytes = verb === 'GET' ? '' : body ?? JSON.stringify(input);
  return new Promise((resolve, reject) => {
    const req = http.request(app.connection.base_url + '/api/renderer/v1/' + method,
      { method: verb, headers: { authorization: `Bearer ${app.connection.token}`, 'content-type': 'application/json',
        'content-length': Buffer.byteLength(bytes), ...headers } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () => {
          try { resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            headers: { get: name => response.headers[name.toLowerCase()] } }); } catch (cause) { reject(cause); }
        });
      });
    req.setTimeout(30000, () => req.destroy(new Error('request timed out')));
    req.once('error', reject); req.end(bytes);
  });
}
test('HTTP facade enforces authentication/Host/Origin/method/body and has no GUI routes', async t => {
  for (const input of [null, [], { host: '0.0.0.0' }, { port: -1 }, { port: null }, { port: '0' }, { signal: {} }]) {
    await assert.rejects(createRendererServer(input), error => {
      assert.match(error.code, /^API_HTTP_/u); assert.ok(Array.isArray(error.details));
      assert.equal(typeof error.toJSON, 'function'); return true;
    });
  }
  const app = await createRendererServer(); t.after(() => app.close());
  await assert.rejects(createRendererServer({ port: Number(new URL(app.connection.base_url).port) }), { code: 'API_HTTP_PORT_IN_USE' });
  const health = await fetch(app.connection.base_url + '/health');
  assert.deepEqual(await health.json(), { schema: 'jsonui-renderer-http-v1', ok: true, status: 'ready', authenticated: false });
  for (const [options, status, code] of [
    [{ headers: { authorization: '' } }, 401, 'API_HTTP_AUTH_REQUIRED'],
    [{ headers: { authorization: 'Bearer ' + '0'.repeat(64) } }, 401, 'API_HTTP_AUTH_REQUIRED'],
    [{ headers: { host: 'evil.example' } }, 403, 'API_HTTP_HOST_REJECTED'],
    [{ headers: { origin: 'https://evil.example' } }, 403, 'API_HTTP_ORIGIN_REJECTED'],
    [{ headers: { 'sec-fetch-site': 'same-origin' } }, 403, 'API_HTTP_ORIGIN_REJECTED'],
    [{ verb: 'GET' }, 405, 'API_HTTP_METHOD_REJECTED'],
    [{ headers: { 'content-type': 'text/plain' } }, 415, 'API_HTTP_CONTENT_TYPE'],
    [{ body: 'not-json' }, 400, 'API_HTTP_JSON_INVALID'],
    [{ body: '[]' }, 400, 'API_HTTP_JSON_INVALID'],
    [{ body: '{"data":"' + 'x'.repeat(HTTP_API_LIMITS.requestBytes) + '"}' }, 413, 'API_HTTP_BODY_LIMIT'],
  ]) {
    const result = await request(app, 'status', {}, options);
    assert.equal(result.status, status, JSON.stringify(options.headers || { verb: options.verb, body_length: options.body?.length })); assert.equal(result.data.error.code, code);
    assert.equal(result.data.error.retryable, false);
    assert.equal(result.data.error.correlation_id, result.headers.get('x-jsonui-request-id'));
    assert.equal(JSON.stringify(result.data).includes(app.connection.token), false);
  }
  for (const route of ['/', '/app/index.html', '/api/node/capabilities']) {
    const response = await fetch(app.connection.base_url + route, { headers: { authorization: `Bearer ${app.connection.token}` } });
    assert.equal(response.status, 404);
  }
  await app.close(); await app.close();
  await assert.rejects(fetch(app.connection.base_url + '/health'));
});
test('HTTP import/render reuse state and original input, PNG has bounded base64 contract', async t => {
  const directory = await temporary(t), pack = path.join(directory, '日本語 pack.zip');
  const source = await makeZip({ 'manifest.json': manifest,
    'ui/test.json': JSON.stringify({ namespace: 'test', screen: { type: 'panel', size: [100, 60],
      controls: [{ item: { type: 'panel', size: [12, 14], offset: [7, 9], anchor_from: 'top_left', anchor_to: 'top_left' } }] } }) });
  await writeFile(pack, source);
  const app = await createRendererServer(); t.after(() => app.close());
  assert.equal((await request(app, 'import', { pack })).status, 200);
  const options = { file: 'ui/test.json', definition: 'test.screen', width: 100, height: 60, uiScale: 1, frame: 0, format: 'json' };
  const result = await request(app, 'render', options);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.result.schema, 'jsonui-api-render-v1');
  assert.ok(result.data.result.frame.layout.boxes.length >= 2);
  assert.equal((await request(app, 'validate', { file: options.file, definition: options.definition })).status, 200);
  assert.equal((await request(app, 'definitions')).status, 200);
  assert.equal((await request(app, 'list')).status, 200);
  if (loadRasterBackend()) {
    const image = await request(app, 'render', { ...options, format: 'png' });
    assert.equal(image.status, 200, JSON.stringify(image.data));
    const png = image.data.result.png, bytes = Buffer.from(png.data, 'base64');
    assert.equal(png.media_type, 'image/png'); assert.equal(png.encoding, 'base64');
    assert.equal(png.size_bytes, bytes.length); assert.equal(png.checksum_sha256, sha(bytes));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.data.result.native_equivalence.status, 'not_evaluated');
  } else t.diagnostic('PNG sub-check NOT_RUN: optional raster backend unavailable.');
  const invalid = await request(app, 'render', { ...options, width: -1 });
  assert.equal(invalid.status, 400); assert.equal(invalid.data.ok, false);
  assert.equal((await request(app, 'render', options)).status, 200, 'bad input does not poison the renderer');
  assert.equal(sha(await readFile(pack)), sha(source));
});
test('CLI-owned server hides GUI while explicit GUI server remains compatible', async t => {
  const client = await CliClient.start(); t.after(() => client.close());
  assert.equal((await fetch(client.base)).status, 404);
  assert.equal((await fetch(new URL('app/index.html', client.base))).status, 404);
  assert.equal((await fetch(new URL('api/node/capabilities', client.base))).status, 200);
  const gui = await createLocalServer({ port: 0 }); t.after(() => gui.close());
  const response = await fetch(`http://127.0.0.1:${gui.port}/app/index.html`);
  assert.equal(response.status, 200); assert.match(await response.text(), /GUI 実験版/u);
});
test('descriptor is private, no-clobber and shutdown never removes or changes its path', async t => {
  const directory = await temporary(t), filename = path.join(directory, 'connection.json');
  const output = [];
  const original = process.stdout.write;
  process.stdout.write = function (chunk, ...args) { output.push(String(chunk)); return original.call(this, chunk, ...args); };
  let app;
  try { app = await runApiServer(['--connection-file', filename]); }
  finally { process.stdout.write = original; }
  t.after(() => app.close());
  const descriptor = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(output.join('').includes(descriptor.token), false);
  assert.match(descriptor.token, /^[0-9a-f]{64}$/u);
  if (process.platform !== 'win32') assert.equal((await lstat(filename)).mode & 0o777, 0o600);
  await assert.rejects(runApiServer(['--connection-file', filename]), { code: 'CLI_OUTPUT_EXISTS' });
  const originalBytes = await readFile(filename);
  await app.close(); assert.deepEqual(await readFile(filename), originalBytes);
  await assert.rejects(runApiServer(['--connection-file', filename]), { code: 'CLI_OUTPUT_EXISTS' });
  await assert.rejects(fetch(descriptor.base_url + '/health'));
  const nextFilename = path.join(directory, 'next-connection.json');
  const again = await runApiServer(['--connection-file', nextFilename]);
  await writeFile(nextFilename, '{"replacement":true}');
  await again.close(); assert.equal(await readFile(nextFilename, 'utf8'), '{"replacement":true}');
});
test('package default starts CLI help and public SDK export resolves without startup', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.start, 'node local-node/cli.mjs');
  assert.equal(packageJson.scripts.gui, 'node local-node/launcher.mjs');
  const cli = await execute(process.execPath, ['local-node/cli.mjs'], { cwd: root, timeout: 10000 });
  assert.match(cli.stdout, /コマンドモード/u); assert.equal(cli.stderr, '');
  const sdk = await execute(process.execPath, ['--input-type=module', '-e', "import {createRenderer} from 'jsonui-workbench'; if(typeof createRenderer!=='function')process.exitCode=1"], { cwd: root, timeout: 10000 });
  assert.equal(sdk.stdout, ''); assert.equal(sdk.stderr, '');
});
test('real daemon SIGINT closes listener and retains its inert credential file', { skip: process.platform === 'win32' }, async t => {
  const directory = await temporary(t), filename = path.join(directory, 'connection.json');
  const entry = fileURLToPath(new URL('../api-server.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry, '--connection-file', filename], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(20000) });
  lines.close(); const ready = JSON.parse(line);
  assert.equal(ready.status, 'ready'); assert.equal(stderr, '');
  const descriptor = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(line.includes(descriptor.token), false);
  child.kill('SIGINT'); const [code, signal] = await exited;
  assert.equal(code, 0, stderr); assert.equal(signal, null);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), descriptor);
  await assert.rejects(fetch(ready.base_url + '/health'));
});
