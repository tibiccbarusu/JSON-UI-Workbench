#!/usr/bin/env node
/** Persistent, authenticated loopback adapter for the structured renderer API.
 * No GUI routes, shell execution, output-path writes, or remote bind option. */
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRenderer, JsonUiApiError } from './api.mjs';
import { atomicWrite, checkOutputPath } from './cli-files.mjs';
import { sanitizeDiagnostic } from './debug-bundle.mjs';

export const HTTP_API_LIMITS = Object.freeze({ requestBytes: 16 * 1024 * 1024,
  responseBytes: 64 * 1024 * 1024, requests: 8, connections: 32, bodyMs: 30000 });
const schema = 'jsonui-renderer-http-v1';
const methods = new Set(['import', 'render', 'validate', 'list', 'definitions', 'status', 'interact', 'sound']);
const summaries = {
  API_HTTP_AUTH_REQUIRED: '接続ファイルの Bearer token が必要です。',
  API_HTTP_HOST_REJECTED: '接続先 Host が許可されていません。',
  API_HTTP_ORIGIN_REJECTED: 'ブラウザーからの API 呼出しは受け付けません。',
  API_HTTP_NOT_FOUND: '指定した API はありません。',
  API_HTTP_METHOD_REJECTED: 'この API は POST で呼び出してください。',
  API_HTTP_CONTENT_TYPE: 'Content-Type は application/json を指定してください。',
  API_HTTP_BODY_LIMIT: '要求 JSON が 16 MiB の上限を超えています。',
  API_HTTP_JSON_INVALID: '要求は UTF-8 の JSON オブジェクトで指定してください。',
  API_HTTP_BUSY: '処理中の要求が上限に達しました。',
  API_HTTP_TIMEOUT: '要求本文の受信が制限時間を超えました。',
  API_HTTP_RESPONSE_LIMIT: '応答が 64 MiB の上限を超えています。',
  API_HTTP_FAILED: 'API の処理を完了できませんでした。',
};
function failure(code, status = 400) {
  return Object.assign(new Error(summaries[code] || summaries.API_HTTP_FAILED),
    { code, status, category: status === 401 ? 'authentication' : status === 403 ? 'authorization' : status === 429 ? 'rate_limit' : 'validation',
      retryable: false, details: [], context: {}, cause: null });
}
function sameToken(value, expected) {
  if (typeof value !== 'string' || !/^Bearer [0-9a-f]{64}$/u.test(value)) return false;
  return timingSafeEqual(Buffer.from(value.slice(7)), Buffer.from(expected));
}
/** Bounded body consumption preserves the socket long enough to return a 4xx. */
function jsonBody(req, signal) {
  if (!/^application\/json(?:\s*;|$)/iu.test(req.headers['content-type'] || ''))
    return Promise.reject(failure('API_HTTP_CONTENT_TYPE', 415));
  if (Number(req.headers['content-length']) > HTTP_API_LIMITS.requestBytes)
    return Promise.reject(failure('API_HTTP_BODY_LIMIT', 413));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => finish(failure('API_HTTP_TIMEOUT', 408)), HTTP_API_LIMITS.bodyMs);
    function cleanup() {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', error);
      signal.removeEventListener('abort', aborted);
    }
    function finish(cause, value) { cleanup(); if (cause) { req.pause(); reject(cause); } else resolve(value); }
    function data(chunk) {
      size += chunk.length;
      if (size > HTTP_API_LIMITS.requestBytes) { finish(failure('API_HTTP_BODY_LIMIT', 413)); return; }
      chunks.push(chunk);
    }
    function end() {
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('API_HTTP_JSON_INVALID');
        finish(null, value);
      } catch { finish(failure('API_HTTP_JSON_INVALID')); }
    }
    function error() { finish(failure('API_HTTP_JSON_INVALID')); }
    function aborted() { finish(failure('API_HTTP_FAILED', 499)); }
    req.on('data', data); req.once('end', end); req.once('error', error);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
function httpStatus(error) {
  if (Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) return error.status;
  if (/CANCELLED/u.test(error.code || '')) return 499;
  if (/TIMEOUT/u.test(error.code || '')) return 504;
  if (/QUEUE_FULL/u.test(error.code || '')) return 429;
  if (/UNAVAILABLE|CLOSED/u.test(error.code || '')) return 503;
  if (/FAILED$/u.test(error.code || '')) return 422;
  return error.code ? 400 : 500;
}
function publicFailure(error, id, token) {
  const code = /^[A-Z][A-Z0-9_]{2,62}$/u.test(error.code || '') ? error.code : 'API_HTTP_FAILED';
  const status = httpStatus(error);
  const safe = sanitizeDiagnostic({ details: error.details || [], context: error.context || {} }, { secrets: [token] }).data;
  return { status, body: { schema, ok: false, error: { code,
    message: summaries[code] || '要求された描画処理を完了できません。error.code と診断を確認してください。',
    category: status === 499 ? 'cancelled' : status === 408 || status === 504 ? 'timeout'
      : status === 401 ? 'authentication' : status === 403 ? 'authorization' : status === 429 ? 'rate_limit' : status === 413 ? 'resource_exhausted'
        : status >= 500 ? 'internal' : 'validation',
    retryable: false, correlation_id: id, details: Array.isArray(safe.details) ? safe.details : [],
    ...(Object.keys(safe.context || {}).length ? { context: safe.context } : {}) } } };
}
function wireResult(result) {
  const { png, ...metadata } = result;
  if (png !== undefined) {
    if (!Buffer.isBuffer(png)) throw failure('API_HTTP_FAILED', 500);
    return { ...metadata, png: { encoding: 'base64', media_type: 'image/png',
      size_bytes: png.length, checksum_sha256: createHash('sha256').update(png).digest('hex'), data: png.toString('base64') } };
  }
  return metadata;
}

/** Returns a private connection descriptor and an idempotent async close(). */
async function startRendererServer({ port = 0, signal } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw failure('API_HTTP_PORT_INVALID');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw failure('API_HTTP_SIGNAL_INVALID');
  signal?.throwIfAborted();
  const renderer = await createRenderer({}, { signal });
  const token = randomBytes(32).toString('hex'), sockets = new Set();
  let active = 0, stopping = false, closePromise;
  const server = http.createServer({ maxHeaderSize: 16384, headersTimeout: 30000, requestTimeout: 0 }, async (req, res) => {
    const id = randomUUID(), abort = new AbortController();
    req.on('error', () => {}); // A disconnected body must not escape the HTTP boundary.
    res.once('close', () => { if (!res.writableFinished) abort.abort(); });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-JSONUI-Request-ID', id);
    // Closing each public connection also bounds clients that abandon bodies.
    res.setHeader('Connection', 'close');
    active++;
    try {
      if (stopping || active > HTTP_API_LIMITS.requests) throw failure('API_HTTP_BUSY', 429);
      if (req.headers.host !== `127.0.0.1:${server.address().port}`) throw failure('API_HTTP_HOST_REJECTED', 403);
      if (req.headers.origin !== undefined || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'none'))
        throw failure('API_HTTP_ORIGIN_REJECTED', 403);
      if (req.url === '/health' && req.method === 'GET') {
        res.end(JSON.stringify({ schema, ok: true, status: 'ready', authenticated: false })); return;
      }
      if (!sameToken(req.headers.authorization, token)) throw failure('API_HTTP_AUTH_REQUIRED', 401);
      const match = /^\/api\/renderer\/v1\/([a-z]+)$/u.exec(req.url);
      if (!match || !methods.has(match[1])) throw failure('API_HTTP_NOT_FOUND', 404);
      if (req.method !== 'POST') throw failure('API_HTTP_METHOD_REJECTED', 405);
      const input = await jsonBody(req, abort.signal);
      const result = await renderer[match[1] === 'sound' ? 'resolveSound' : match[1]](input, { signal: abort.signal });
      const output = JSON.stringify({ schema, ok: true, correlation_id: id, result: wireResult(result) });
      if (Buffer.byteLength(output) > HTTP_API_LIMITS.responseBytes) throw failure('API_HTTP_RESPONSE_LIMIT', 413);
      if (!res.destroyed) res.end(output);
    } catch (error) {
      if (!res.destroyed) {
        const response = publicFailure(error, id, token);
        res.statusCode = response.status; res.end(JSON.stringify(response.body));
      }
    } finally { active--; }
  });
  server.maxConnections = HTTP_API_LIMITS.connections;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  async function close() {
    if (closePromise) return closePromise;
    stopping = true;
    signal?.removeEventListener('abort', onAbort);
    closePromise = (async () => {
      const stopped = new Promise(resolve => server.close(resolve));
      for (const socket of sockets) socket.destroy();
      await Promise.all([stopped, renderer.close()]);
    })();
    return closePromise;
  }
  function onAbort() { close().catch(() => {}); }
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    if (signal?.aborted) { await close(); signal.throwIfAborted(); }
    signal?.addEventListener('abort', onAbort, { once: true });
  } catch (cause) { await close(); throw cause; }
  return { connection: Object.freeze({ schema: 'jsonui-api-connection-v1', base_url: `http://127.0.0.1:${server.address().port}`,
    token, pid: process.pid }), close };
}

export async function createRendererServer(options = {}) {
  let signal;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
        || Object.getOwnPropertySymbols(options).length
        || Object.getOwnPropertyNames(options).some(key => !['port', 'signal'].includes(key)
          || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value')))
      throw failure('API_HTTP_OPTIONS_INVALID');
    const inputSignal = Object.getOwnPropertyDescriptor(options, 'signal')?.value;
    const inputPort = Object.getOwnPropertyDescriptor(options, 'port')?.value;
    if (inputSignal !== undefined && !(inputSignal instanceof AbortSignal)) throw failure('API_HTTP_SIGNAL_INVALID');
    signal = inputSignal;
    return await startRendererServer({ port: inputPort === undefined ? 0 : inputPort, signal });
  } catch (cause) {
    if (cause instanceof JsonUiApiError) throw cause;
    if (signal?.aborted) {
      const timeout = signal.reason?.name === 'TimeoutError';
      throw new JsonUiApiError(timeout ? 'API_HTTP_TIMEOUT' : 'API_HTTP_CANCELLED',
        timeout ? 'HTTP API の起動が制限時間を超えました。' : 'HTTP API の起動を取り消しました。',
        { category: timeout ? 'timeout' : 'cancelled', cause });
    }
    const code = /^API_HTTP_[A-Z0-9_]{1,48}$/u.test(cause?.code || '') ? cause.code
      : cause?.code === 'EADDRINUSE' ? 'API_HTTP_PORT_IN_USE' : 'API_HTTP_FAILED';
    throw new JsonUiApiError(code, summaries[code] || 'ローカル HTTP API を起動できません。設定と接続先を確認してください。',
      { category: cause?.code === 'EADDRINUSE' ? 'conflict' : cause?.category || 'internal', cause });
  }
}

export async function runApiServer(argv) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false,
    options: { port: { type: 'string', default: '0' }, 'connection-file': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    process.stdout.write('JSON UI Workbench ローカル HTTP API (Node.js 22.14.0 以降)\nnode local-node/api-server.mjs --connection-file .jsonui-api/connection.json [--port 0]\n接続ファイルは新規作成専用です。token を Bearer 認証に使います。Ctrl+C で終了します。\n終了後も接続ファイルを残します。再起動時は新しいパスを選ぶか、自分の旧ファイルを削除してください。\n'); return;
  }
  if (!/^(0|[1-9]\d{0,4})$/u.test(values.port) || Number(values.port) > 65535) throw failure('API_HTTP_PORT_INVALID');
  if (!values['connection-file']) throw failure('API_HTTP_CONNECTION_FILE_REQUIRED');
  const filename = await checkOutputPath(values['connection-file']);
  const app = await createRendererServer({ port: Number(values.port) });
  let stopPromise;
  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      process.off('SIGINT', onStop); process.off('SIGTERM', onStop);
      // A portable check-then-unlink cannot preserve a concurrently replaced
      // file. Leave the descriptor untouched; its token dies with the listener.
      await app.close();
    })();
    return stopPromise;
  }
  function onStop() { stop().catch(() => { process.stderr.write('API_HTTP_STOP_FAILED: API の終了処理を完了できませんでした。\n'); process.exitCode = 1; }); }
  try {
    const bytes = JSON.stringify(app.connection, null, 2) + '\n';
    await atomicWrite(filename, bytes);
    process.on('SIGINT', onStop); process.on('SIGTERM', onStop);
    process.stdout.write(JSON.stringify({ schema, ok: true, status: 'ready', base_url: app.connection.base_url,
      pid: process.pid, connection_file: filename }) + '\n');
    return { close: stop };
  } catch (cause) { await stop(); throw cause; }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await runApiServer(process.argv.slice(2)); }
  catch (cause) {
    const response = publicFailure(cause, randomUUID(), '');
    process.stderr.write(JSON.stringify(response.body) + '\n'); process.exitCode = 1;
  }
}
