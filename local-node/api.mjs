/** Public Node SDK. Import-safe; createRenderer owns one reusable loopback server/Worker.
 * JSON request objects are snapshotted at admission. No subprocess, browser, persistent
 * session, source edit or output-file write is performed by this surface.
 */
import { CliClient } from './cli-client.mjs';
import { cliCapabilities28 } from './cli-capabilities28.mjs';
import { loadRasterBackend } from './frame-raster13.mjs';
import { preparePreview } from './preview-pipeline.mjs';
import { ApiPreviewContext, pipelineOptions, stackCatalog } from './api-context.mjs';
import { API_LIMITS, JsonUiApiError, checkedApiRequest, checkedAbortOptions, apiDefaultSettings, apiPreviewSettings, apiFailure } from './api-request.mjs';
import { prepareInteraction, prepareSound } from './api-interaction.mjs';

export { JsonUiApiError } from './api-request.mjs';

function cancelled(signal, closed, closeContext = {}) {
  if (closed) throw new JsonUiApiError('API_CLOSED', 'レンダラーは既に閉じています。', { category: 'failed_precondition', context: closeContext });
  if (signal?.aborted) throw new JsonUiApiError(signal.reason?.name === 'TimeoutError' ? 'API_TIMEOUT' : 'API_CANCELLED',
    signal.reason?.name === 'TimeoutError' ? '要求の制限時間を超えました。' : '操作を取り消しました。', { category: signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' });
}
function sourceSummary(item) {
  return { kind: item.kind, name: item.source.name, size_bytes: item.source.size_bytes, checksum_sha256: item.source.checksum_sha256,
    ...(item.source.resource_pack_uuid ? { resource_pack_uuid: item.source.resource_pack_uuid } : {}) };
}

class Renderer {
  constructor(client, settings) {
    this.client = client; this.settings = settings; this.stack = null; this.closed = false; this.closeContext = {};
    this.shutdown = new AbortController(); this.tail = Promise.resolve(); this.pending = 0; this.closePromise = null;
  }
  enqueue(method, input = {}, operationOptions = {}) {
    let request, signal;
    try {
      cancelled(null, this.closed, this.closeContext);
      request = checkedApiRequest(method, input);
      const callerSignal = checkedAbortOptions(operationOptions);
      signal = callerSignal ? AbortSignal.any([callerSignal, this.shutdown.signal]) : this.shutdown.signal;
      cancelled(signal, this.closed, this.closeContext);
      if (this.pending >= API_LIMITS.queue) throw new JsonUiApiError('API_QUEUE_FULL', 'レンダラーの操作キューが上限に達しました。', { category: 'resource_exhausted', retryable: true });
    } catch (error) { return Promise.reject(apiFailure(error)); }
    this.pending++;
    const task = this.tail.then(async () => {
      cancelled(signal, this.closed, this.closeContext);
      await this.refresh(method, signal);
      cancelled(signal, this.closed, this.closeContext);
      const client = new CliClient(this.client.app, this.client.token, signal);
      try {
        const result = await this.execute(method, request, client, signal);
        cancelled(signal, this.closed, this.closeContext); return result;
      } catch (error) {
        if (['NODE_PACK_NOT_FOUND', 'NODE_CATALOG_STALE', 'NODE_PROCESSOR_RESTART_REQUIRED'].includes(error.code)) {
          this.stack = null;
          error.context = { ...error.context, reimport_required: true };
        }
        if (signal.aborted) cancelled(signal, this.closed, this.closeContext);
        throw error;
      }
    }).catch(error => { throw apiFailure(error); }).finally(() => { this.pending--; });
    this.tail = task.catch(() => {});
    // A queued request rejects promptly when cancelled; its reserved slot is
    // released when its serial task reaches the queue, where it will do no work.
    let removeListener = () => {};
    const interruption = new Promise((_, reject) => {
      const abort = () => { try { cancelled(signal, this.closed, this.closeContext); } catch (error) { reject(apiFailure(error)); } };
      signal.addEventListener('abort', abort, { once: true });
      removeListener = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) abort();
    });
    return Promise.race([task, interruption]).finally(removeListener);
  }
  async refresh(method, signal) {
    const observer = new CliClient(this.client.app, this.client.token, signal);
    const capability = await observer.request('/api/node/capabilities', { method: 'GET', maximum: 65536, timeout: 10000 });
    if (capability.protocol !== 'jsonui-node/v1' || !/^[0-9a-f]{64}$/u.test(capability.token || '')) throw new JsonUiApiError('API_OPERATION_FAILED', 'レンダラーとの接続を確認できません。', { category: 'internal' });
    if (capability.token !== this.client.token) {
      this.stack = null; this.client.token = capability.token;
      if (!['import', 'status'].includes(method)) throw new JsonUiApiError('API_REIMPORT_REQUIRED', '処理環境が復旧しました。パックを再度読み込んでください。', { category: 'failed_precondition', context: { reimport_required: true } });
    }
  }
  requireStack() {
    if (!this.stack) throw new JsonUiApiError('API_PACK_REQUIRED', '先にimportでパックを読み込んでください。');
    return this.stack;
  }
  async release(stack) {
    if (!stack) return;
    if (stack.workspace) {
      try { await this.client.request('/api/node/workspace-close', { payload: { workspaceId: stack.workspace.workspaceId }, timeout: 15000 }); }
      catch { /* Pack removal and owned-server close remain the cleanup boundaries. */ }
    }
    for (const item of stack.entries) {
      try { await this.client.request(`/api/node/packs/${item.id}`, { method: 'DELETE', timeout: 15000 }); }
      catch (error) {
        // Never keep an untracked registration in a reusable server after cleanup fails.
        await this.client.close(); this.closed = true; this.shutdown.abort(); this.stack = null;
        throw apiFailure(error);
      }
    }
    // The inherited processor invalidates all workspaces on any pack removal.
    // Registrations of the retained stack survive; lazily reopen their workspace.
    if (this.stack) { this.stack.workspace = null; this.stack.catalog = null; }
  }
  async importStack(request, client, signal) {
    const previous = this.stack, candidate = { entries: [], sources: [], importedMetadata: null, workspace: null, catalog: null };
    try {
      for (const [key, kind] of [['vanilla', 'vanilla'], ['pack', 'imported']]) {
        if (!request[key]) continue;
        cancelled(signal, this.closed);
        const imported = await client.importPack(request[key], null, kind === 'imported' && request.resourcePack ? { resourcePack: request.resourcePack } : {});
        const item = { ...imported, kind }; candidate.entries.push(item);
        candidate.sources.push({ id: item.id, kind, overrides: {} });
        if (kind === 'imported') candidate.importedMetadata = { ...item.metadata, id: item.id, overrides: {} };
      }
      const catalog = await stackCatalog(client, candidate);
      cancelled(signal, this.closed);
      const result = { schema: 'jsonui-api-import-v1', ok: true, sources: candidate.entries.map(sourceSummary),
        file_count: catalog.files?.length || 0, definition_count: catalog.records?.length || 0, diagnostics: catalog.diagnostics || [] };
      this.stack = candidate;
      await this.release(previous);
      return result;
    } catch (error) {
      if (error.context?.import_cleanup?.completed === false) {
        this.closed = true; this.stack = null;
        this.closeContext = { import_cleanup: error.context.import_cleanup, recreate_renderer_required: true, previous_stack_preserved: false };
        this.shutdown.abort();
      } else {
        if (this.stack !== candidate) this.stack = previous;
        try { await this.release(candidate); } catch (cleanupError) { error.context = { ...error.context, cleanup: { completed: false, code: cleanupError.code } }; }
        if (this.stack === candidate) this.stack = previous;
      }
      throw error;
    }
  }
  async execute(method, request, client, signal) {
    if (method === 'import') return this.importStack(request, client, signal);
    if (method === 'status') {
      const metrics = this.client.app.processor.snapshot();
      return { schema: 'jsonui-api-status-v1', ok: true, imported: Boolean(this.stack),
        sources: this.stack?.entries.map(sourceSummary) || [], pending: this.pending,
        server_reused: true, mode: 'headless', processing: 'node-worker',
        worker: { dead: metrics.dead, calls: metrics.calls, completed: metrics.completed, caches: metrics.caches },
        capabilities: cliCapabilities28(), raster_backend: loadRasterBackend() ? 'available' : 'unavailable' };
    }
    const stack = this.requireStack();
    if (method === 'list' || method === 'definitions') {
      const catalog = await stackCatalog(client, stack);
      const items = (method === 'list' ? catalog.files : catalog.records).filter(item => (!request.kind || item.sourceKind === request.kind)
        && (!request.file || item.filePath === request.file) && (!request.definition || [item.rawKey, item.qualifiedName, item.localName, item.id].includes(request.definition)));
      return { schema: `jsonui-api-${method}-v1`, ok: true, count: items.length, items, diagnostics: catalog.diagnostics || [] };
    }
    const { settings, evidence } = apiPreviewSettings(this.settings, request);
    const context = new ApiPreviewContext(client, stack, settings, evidence, settings.language);
    if (method === 'interact') return prepareInteraction(context, request);
    if (method === 'resolveSound') return prepareSound(context, request);
    const rasterBackend = method === 'render' && request.format === 'png' ? loadRasterBackend() : undefined;
    if (method === 'render' && request.format === 'png' && !rasterBackend) throw new JsonUiApiError('RASTER_BACKEND_UNAVAILABLE', 'PNG描画バックエンドを利用できません。JSONまたはSVGを使用してください。', { category: 'unavailable' });
    const prepared = await preparePreview(context, pipelineOptions(request), { validationOnly: method === 'validate', format: request.format || 'json', rasterBackend });
    if (method === 'validate') return { ...prepared.validation, schema: 'jsonui-api-validation-v1', ok: true };
    if (request.format === 'png') return { ...prepared.metadata, schema: 'jsonui-api-render-v1', ok: true, format: 'png', png: prepared.bytes };
    if (request.format === 'svg') return { ...prepared.metadata, schema: 'jsonui-api-render-v1', ok: true, format: 'svg', svg: prepared.bytes };
    return { ...prepared.snapshot, schema: 'jsonui-api-render-v1', ok: true, format: 'json' };
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true; this.shutdown.abort();
    this.closePromise = (async () => {
      try { await this.client.close(); }
      finally { await this.tail; this.stack = null; }
    })().catch(error => { throw apiFailure(error); });
    return this.closePromise;
  }
}

/** @returns {Promise<{import:Function,list:Function,definitions:Function,status:Function,validate:Function,render:Function,interact:Function,resolveSound:Function,close:Function}>} */
export async function createRenderer(options = {}, operationOptions = {}) {
  let client;
  try {
    const request = checkedApiRequest('create', options), signal = checkedAbortOptions(operationOptions);
    cancelled(signal, false);
    const settings = apiDefaultSettings(request);
    client = await CliClient.start({ signal, keepPacksAlive: true }); cancelled(signal, false);
    // Factory cancellation applies to initialization; subsequent calls supply
    // their own signal and cleanup must not inherit an already-aborted signal.
    client.signal = undefined;
    const renderer = new Renderer(client, settings), surface = {};
    for (const method of ['import', 'list', 'definitions', 'status', 'validate', 'render', 'interact', 'resolveSound']) surface[method] = (request = {}, operationOptions = {}) => renderer.enqueue(method, request, operationOptions);
    surface.close = () => renderer.close();
    return Object.freeze(surface);
  } catch (error) { if (client) await client.close(); throw apiFailure(error); }
}
