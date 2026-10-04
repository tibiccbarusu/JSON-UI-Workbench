/** Loopback-only HTTP client. One owned server per command/workflow, no daemon. */
import path from 'node:path';
import { open, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { createLocalServer } from './server.mjs';
import { LIMITS } from './limits.mjs';
import { cliError, checkedPath } from './cli-files.mjs';
import { sanitizeDiagnostic } from './debug-bundle.mjs';

async function responseBytes(response, maximum) {
  try {
    if (Number(response.headers.get('content-length')) > maximum) throw cliError('CLI_RESPONSE_LIMIT', 'サーバー応答がサイズ上限を超えました。');
    const chunks = []; let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maximum) throw cliError('CLI_RESPONSE_LIMIT', 'サーバー応答がサイズ上限を超えました。');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    // Header rejection happens before the iterator can cancel the body. Do not
    // keep that response alive until the much longer API request deadline.
    try { Promise.resolve(response.body?.cancel()).catch(() => {}); }
    catch { /* Cancellation must not replace the response validation error. */ }
    throw error;
  }
}

export class CliClient {
  constructor(app, token, signal) { this.app = app; this.token = token; this.signal = signal; this.base = `http://127.0.0.1:${app.port}/`; }
  static async start({ signal, keepPacksAlive = false } = {}) {
    signal?.throwIfAborted();
    const app = await createLocalServer({ port: 0, serveGui: false, keepPacksAlive });
    try {
      const response = await fetch(`http://127.0.0.1:${app.port}/api/node/capabilities`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
      const capabilities = JSON.parse((await responseBytes(response, 65536)).toString('utf8'));
      if (!response.ok || capabilities.protocol !== 'jsonui-node/v1' || !/^[0-9a-f]{64}$/u.test(capabilities.token)) throw cliError('CLI_PROTOCOL_INVALID', 'ローカル API の初期化に失敗しました。');
      return new CliClient(app, capabilities.token, signal);
    } catch (error) { await app.close(); throw error; }
  }
  async close() { await this.app.close(); }

  async request(route, { method = 'POST', payload, body, headers = {}, binary = false, maximum = LIMITS.replyBytes, timeout = LIMITS.jobMs + 15000 } = {}) {
    const serialized = payload === undefined ? undefined : JSON.stringify(payload);
    if (serialized && Buffer.byteLength(serialized) > LIMITS.jsonBytes) throw cliError('CLI_REQUEST_LIMIT', '要求 JSON が API 上限を超えています。');
    let response;
    try {
      response = await fetch(new URL(route, this.base), { method, headers: { 'x-jsonui-token': this.token,
        ...(serialized === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body ?? serialized, ...(body ? { duplex: 'half' } : {}), redirect: 'error',
        signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
      const bytes = await responseBytes(response, maximum);
      if (!response.ok) {
        let failure; try { failure = JSON.parse(bytes.toString('utf8')); } catch { failure = {}; }
        const candidateCode = typeof failure.error === 'string' ? failure.error : failure.error?.code;
        const code = /^[A-Z0-9_]{1,100}$/u.test(candidateCode || '') ? candidateCode : 'CLI_HTTP_FAILED';
        const safe = sanitizeDiagnostic(failure, { secrets: [this.token] });
        const requestId = response.headers.get('x-jsonui-request-id');
        const correlationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(requestId || '') ? requestId : null;
        const error = cliError(code, 'ローカル API が要求を拒否しました。', {
          http_status: response.status, route, correlation_id: correlationId, response: safe.data, sanitization: safe.summary,
        });
        error.correlationId = correlationId;
        error.retryable = response.status === 429 || response.status === 503;
        throw error;
      }
      if (binary) return bytes;
      try { return JSON.parse(bytes.toString('utf8')); } catch { throw cliError('CLI_RESPONSE_INVALID', 'ローカル API の JSON 応答が不正です。'); }
    } catch (error) {
      if (this.signal?.aborted) throw cliError('CLI_CANCELLED', '操作を取り消しました。直前に保存済みのセッションを維持します。');
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw cliError('CLI_REQUEST_TIMEOUT', 'ローカル処理が制限時間を超えました。');
      throw error;
    }
  }

  /** Hash the actual streamed bytes, then compare the persisted identity.
   * A restore with changed input never reaches workspace-open. */
  async importPack(filename, expected = null, options = {}) {
    const source = checkedPath(filename), info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || !['.zip', '.mcpack', '.mcaddon'].includes(path.extname(source).toLowerCase())) throw cliError('CLI_PACK_FILE_INVALID', 'ZIP、MCPACK または MCADDON の通常ファイルを指定してください。');
    const resourcePack = options.resourcePack ?? expected?.resource_pack_uuid;
    if (resourcePack !== undefined && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(resourcePack)) throw cliError('ADDON_RESOURCE_SELECTOR_INVALID', 'リソースパックの header UUID を指定してください。');
    if (resourcePack !== undefined && path.extname(source).toLowerCase() !== '.mcaddon') throw cliError('ADDON_RESOURCE_SELECTOR_NOT_APPLICABLE', 'RP 選択は MCADDON にのみ指定できます。');
    if (info.size < 22 || info.size > LIMITS.zipBytes) throw cliError('CLI_PACK_SIZE_INVALID', 'パックのサイズが許容範囲外です。', { maximum_bytes: LIMITS.zipBytes });
    const handle = await open(source, 'r');
    let input, stream, uploadId;
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== info.size || before.ino !== info.ino || before.dev !== info.dev) throw cliError('CLI_SOURCE_CHANGED', '読込前に元パックが変更されました。');
      const signature = Buffer.alloc(4); await handle.read(signature, 0, 4, 0);
      if (!['504b0304', '504b0506', '504b0708'].includes(signature.toString('hex'))) throw cliError('CLI_PACK_SIGNATURE_INVALID', 'ZIP のシグネチャを確認できません。');
      const hash = createHash('sha256'); let size = 0;
      input = handle.createReadStream({ start: 0, autoClose: false });
      stream = new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > before.size) return callback(cliError('CLI_SOURCE_CHANGED', '読込中に元パックのサイズが変更されました。'));
        hash.update(chunk); callback(null, chunk);
      } });
      input.once('error', error => stream.destroy(error)); input.pipe(stream);
      // The server can own this registration before its response body reaches
      // the caller. Retain the owned ID before upload, including cancelled replies.
      uploadId = randomUUID();
      const imported = await this.request('/api/node/packs', { body: stream, headers: { 'content-type': 'application/zip',
        'content-length': String(before.size), 'x-jsonui-upload-id': uploadId, 'x-jsonui-name': encodeURIComponent(path.basename(source)),
        ...(resourcePack ? { 'x-jsonui-resource-pack': resourcePack } : {}) }, timeout: LIMITS.uploadMs + LIMITS.jobMs });
      if (imported.id !== uploadId) throw cliError('CLI_PROTOCOL_INVALID', 'パックの登録IDが要求したIDと一致しません。');
      const after = await handle.stat(), digest = hash.digest('hex');
      if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || (expected && (digest !== expected.checksum_sha256 || size !== expected.size_bytes))) throw cliError('CLI_SOURCE_CHANGED', '元パックがセッション作成時から変更されています。元のファイルを戻すか、新しいセッションへ取り込んでください。');
      return { id: imported.id, rootPrefix: imported.rootPrefix || '', metadata: imported,
        source: { path: source, name: path.basename(source), size_bytes: size, checksum_sha256: digest,
          ...(imported.zipMeta?.container ? { resource_pack_uuid: imported.zipMeta.container.resource_pack_uuid,
            resource_pack_sha256: imported.zipMeta.container.resource_pack_sha256 } : {}) } };
    } catch (error) {
      // Cancellation must not cancel ownership cleanup. DELETE also aborts and
      // settles an unfinished upload; no other registration may be removed.
      if (uploadId) {
        const cleanupClient = new CliClient(this.app, this.token);
        try { await cleanupClient.request(`/api/node/packs/${uploadId}`, { method: 'DELETE', timeout: 15000 }); }
        catch (cleanupError) {
          const alreadyAbsent = cleanupError.code === 'NODE_PACK_NOT_FOUND' || cleanupError.context?.http_status === 404;
          if (!alreadyAbsent) {
            // A reusable, pinned SDK server must not retain an untracked pack.
            // When precise cleanup fails, release the entire owned server.
            let serverClosed = false;
            try { await this.close(); serverClosed = true; } catch { /* Preserve the import failure and cleanup status. */ }
            error.context = { ...error.context, import_cleanup: { completed: false,
              code: cleanupError.code || 'CLI_IMPORT_CLEANUP_FAILED', server_closed: serverClosed,
              previous_stack_preserved: false, recreate_renderer_required: true } };
          }
        }
      }
      throw error;
    } finally { input?.destroy(); stream?.destroy(); await handle.close(); }
  }
}
