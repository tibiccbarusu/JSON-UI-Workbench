/** Node Worker-owned editing sessions. Original ZIP readers are never mutated. */
import { randomUUID } from 'node:crypto';
import { inspectWorkspace, editWorkspace, workspaceRevision } from './workspace-edit.mjs';
import { buildScopedEditContext, editWorkspaceScoped } from './workspace-scoped-edit.mjs';
import { planWorkspaceExport, buildWorkspaceExport } from './workspace-export.mjs';
import { normalizeZipPath } from '../editor-core/src/path/normalize-zip-path.js';
import { LIMITS, fail } from './limits.mjs';
import { selectWorkspaceUiPaths } from './workspace-paths.mjs';
import { editWorkspaceBatch, WORKSPACE_BATCH_LIMITS } from './workspace-batch.mjs';
import { summarizeWorkspaceResult } from './workspace-operation-summary.mjs';
import { responseKey } from './response-cache.mjs';
import { DELETE_REFERENCE_POLICY32 } from './workspace-delete-references32.mjs';
import { TARGET_POLICY_VERSION31 } from './workspace-target-policy31.mjs';
import { BATCH_CACHE_LIMITS29, encodeBatchCache29, decodeBatchCache29 } from './workspace-batch-cache29.mjs';

const WORKSPACE_LIMITS = Object.freeze({ sessions: 2, files: 5000, textBytes: 32 * 1024 * 1024,
  historyBytes: 16 * 1024 * 1024, historyEntries: 64, batchOperations: WORKSPACE_BATCH_LIMITS.operations });
const cloneSources = sources => sources.map(source => ({ id: source.id, kind: source.kind,
  ...(source.rootPrefix ? { rootPrefix: source.rootPrefix } : {}),
  overrides: Object.assign(Object.create(null), source.overrides || {}) }));
const bytesOfChanges = changes => changes.reduce((sum, item) => sum
  + Buffer.byteLength(item.before ?? '') + Buffer.byteLength(item.after ?? ''), 0);

/** All methods run on the existing serialized Worker queue. */
export class WorkspaceSessions {
  constructor({ getPack, checkSources, invalidate, batchExecutor = editWorkspaceBatch }) {
    this.getPack = getPack;
    this.checkSources = checkSources;
    this.invalidate = invalidate;
    this.sessions = new Map();
    this.batchExecutor = batchExecutor;
    this.batchMetrics = { builds: 0, hits: 0, retainedBytes: 0, compressedStores: 0, bypasses: 0, decodeFailures: 0, lastDecision: null };
  }
  clear() { this.sessions.clear(); this.batchMetrics.retainedBytes = 0; }
  snapshot() { return { ...this.batchMetrics, limits: BATCH_CACHE_LIMITS29, entries: [...this.sessions.values()].filter(item => item.draftBatchCache).length }; }
  forgetDraft(workspace) {
    this.batchMetrics.retainedBytes -= workspace.draftBatchCache?.bytes || 0;
    delete workspace.draftBatchCache;
  }
  async computeBatch(workspace, operation, checkpoint = () => {}) {
    // controlsを含む任意オブジェクトのキーをソートしない。モードと順序も区別する。
    const key = responseKey(JSON.stringify({ targetPolicy: TARGET_POLICY_VERSION31, structurePolicy: DELETE_REFERENCE_POLICY32, revision: workspace.revision, operation }));
    const cached = workspace.draftBatchCache;
    let missReason = cached ? 'key-changed' : 'not-retained';
    if (cached?.key === key) {
      checkpoint('batch-reuse', operation.operations.length, operation.operations.length);
      const start = performance.now(); let result;
      try { result = decodeBatchCache29(cached); }
      catch { this.batchMetrics.decodeFailures++; this.forgetDraft(workspace); missReason = 'decode-failed'; }
      if (result) {
        // 取消はキャッシュ破損として扱わず、確定元が変わっていないことも確認する。
        checkpoint('batch-reuse', operation.operations.length, operation.operations.length);
        this.assertRevision(this.get(workspace.id), workspace.revision);
        this.batchMetrics.hits++;
        const cache = { cacheReason: 'exact-match', storageReason: 'retained', storageEncoding: cached.encoding,
          expandedBytes: cached.expandedBytes, jsonUtf8Bytes: cached.jsonUtf8Bytes, retainedBytes: cached.bytes, cacheDecodeMs: performance.now() - start };
        this.batchMetrics.lastDecision = { ...cache };
        result.batch = { ...result.batch, validationCache: 'hit', validationDurationMs: 0, ...cache };
        return result;
      }
    }
    const began = performance.now(); this.batchMetrics.builds++;
    const result = await this.batchExecutor({ documents: workspace.documents, documentSources: workspace.documentSources,
      operation, expectedRevision: workspace.revision, checkpoint });
    this.assertRevision(this.get(workspace.id), workspace.revision);
    if (result.ok) {
      checkpoint('batch-cache', operation.operations.length, operation.operations.length);
      let stored;
      try { stored = encodeBatchCache29(result, key); }
      catch { stored = { entry: null, meta: { storageReason: 'encode-failed', storageEncoding: 'none', retainedBytes: 0 } }; }
      checkpoint('batch-cache', operation.operations.length, operation.operations.length);
      this.forgetDraft(workspace);
      if (stored.entry) {
        workspace.draftBatchCache = stored.entry;
        this.batchMetrics.retainedBytes += stored.entry.bytes;
        if (stored.entry.encoding === 'deflate-raw-utf16le') this.batchMetrics.compressedStores++;
      } else this.batchMetrics.bypasses++;
      const cache = { cacheReason: missReason, ...stored.meta };
      this.batchMetrics.lastDecision = { ...cache };
      result.batch = { ...result.batch, validationCache: 'miss', validationDurationMs: performance.now() - began, ...cache };
    }
    return result;
  }
  get(id) {
    if (typeof id !== 'string' || !this.sessions.has(id)) fail('WORKSPACE_NOT_FOUND', 404);
    return this.sessions.get(id);
  }
  checkedDescription(workspace, extra = {}) {
    const documents = Object.entries(workspace.documents);
    if (documents.length > WORKSPACE_LIMITS.files) fail('WORKSPACE_FILE_LIMIT', 413);
    let textBytes = 0;
    for (const [, text] of documents) {
      textBytes += Buffer.byteLength(text);
      if (textBytes > WORKSPACE_LIMITS.textBytes) fail('WORKSPACE_TEXT_LIMIT', 413);
    }
    const response = { ...this.describe(workspace), ...extra };
    // The Worker applies the same reply limit. Check before publishing state so
    // a rejected response never leaves an unseen edit or unreachable session.
    if (Buffer.byteLength(JSON.stringify(response)) > LIMITS.replyBytes) fail('NODE_REPLY_LIMIT', 413);
    return response;
  }
  async open(input) {
    // The importer owns the archive root. Never trust a caller-supplied prefix:
    // clients need the canonical prefix to retrieve original image bytes.
    const sources = cloneSources(this.checkSources(input.sources).map(source => ({
      ...source, rootPrefix: this.getPack(source.id).rootPrefix || '',
    })));
    // Reopening the same source stack reuses its current edits unless explicit
    // overrides changed. Clients close old sessions when replacing their stack.
    const key = JSON.stringify(sources);
    for (const item of this.sessions.values()) if (item.openKey === key) return this.describe(item);
    if (this.sessions.size >= WORKSPACE_LIMITS.sessions) fail('WORKSPACE_SESSION_LIMIT', 429);
    const documents = Object.create(null), origins = Object.create(null), documentSources = Object.create(null);
    const canonical = new Map(), physicalPaths = new Set(), layeredPaths = new Set();
    const pathsBySource = await selectWorkspaceUiPaths(sources, this.getPack);
    let total = 0;
    for (const source of sources.slice().sort((a, b) => (a.kind === 'vanilla' ? 0 : 1) - (b.kind === 'vanilla' ? 0 : 1))) {
      const pack = this.getPack(source.id);
      const paths = pathsBySource.get(source.id);
      for (const filePath of paths) {
        const documentPath = sources.length === 1 ? filePath : `${source.kind}/${filePath}`;
        const lower = filePath.normalize('NFC').toLowerCase(), previous = canonical.get(lower);
        if (previous && previous !== filePath) fail('WORKSPACE_PATH_COLLISION');
        const text = Object.hasOwn(source.overrides, filePath) ? source.overrides[filePath]
          : await pack.zipReader.readText(pack.rootPrefix + filePath, { maxBytes: LIMITS.textBytes });
        total += Buffer.byteLength(text);
        if (total > WORKSPACE_LIMITS.textBytes) fail('WORKSPACE_TEXT_LIMIT', 413);
        if (Object.keys(documents).length >= WORKSPACE_LIMITS.files) fail('WORKSPACE_FILE_LIMIT', 413);
        if (physicalPaths.has(filePath)) layeredPaths.add(filePath);
        documents[documentPath] = text; origins[documentPath] = source.kind;
        documentSources[documentPath] = { sourceId: source.id, kind: source.kind,
          precedence: source.kind === 'imported' ? 20 : 10, physicalPath: filePath, active: true };
        physicalPaths.add(filePath); canonical.set(lower, filePath);
      }
    }
    const inspection = inspectWorkspace({ documents, documentSources });
    const workspace = { id: randomUUID(), openKey: key, sources, documents, origins, documentSources, layeredPaths,
      revision: workspaceRevision(documents, documentSources), inspection, undo: [], redo: [], historyBytes: 0,
      createdAt: new Date().toISOString(), editCount: 0 };
    const response = this.checkedDescription(workspace);
    this.sessions.set(workspace.id, workspace);
    return response;
  }
  sourceId(workspace, value) {
    if (value === undefined) return undefined;
    const kind = value === 'imported-pack' ? 'imported' : value === 'vanilla-reference' ? 'vanilla' : value;
    const source = workspace.sources.find(item => item.id === value || item.kind === kind);
    if (!source) fail('WORKSPACE_SOURCE_NOT_FOUND', 404);
    return source.id;
  }
  documentPath(workspace, physicalPath, requestedSource) {
    if (typeof physicalPath !== 'string' || normalizeZipPath(physicalPath) !== physicalPath) fail('WORKSPACE_PATH_INVALID');
    const sourceId = this.sourceId(workspace, requestedSource);
    const candidates = Object.entries(workspace.documentSources).filter(([, item]) => item.physicalPath === physicalPath
      && (sourceId === undefined || item.sourceId === sourceId)).sort(([, a], [, b]) => b.precedence - a.precedence);
    if (!candidates.length) fail('WORKSPACE_FILE_NOT_FOUND', 404);
    if (candidates.length > 1 && candidates[0][1].precedence === candidates[1][1].precedence) fail('WORKSPACE_FILE_AMBIGUOUS', 409);
    return candidates[0][0];
  }
  publicNode(workspace, node) {
    const source = workspace.documentSources[node.path];
    return source ? { ...node, path: source.physicalPath, physicalPath: source.physicalPath,
      sourceId: source.sourceId, sourceKind: source.kind } : node;
  }
  publicDeletePlan(workspace, plan) {
    if (!plan) return plan;
    return { ...plan, root: this.publicNode(workspace, plan.root),
      affected: plan.affected.map(node => this.publicNode(workspace, node)),
      removals: plan.removals.map(node => this.publicNode(workspace, node)) };
  }
  describe(workspace, filePath, requestedSource) {
    const inspection = workspace.inspection;
    const common = { ok: true, workspaceId: workspace.id, revision: workspace.revision,
      previewAllowed: true, workspaceValid: inspection.previewAllowed ?? inspection.ok,
      diagnostics: inspection.diagnostics || [], canUndo: workspace.undo.length > 0,
      canRedo: workspace.redo.length > 0, processing: 'node-worker', editCount: workspace.editCount };
    if (filePath !== undefined) {
      const internal = this.documentPath(workspace, filePath, requestedSource), source = workspace.documentSources[internal];
      return { ...common, path: filePath, physicalPath: filePath, sourceId: source.sourceId,
        sourceKind: source.kind, text: workspace.documents[internal],
        nodes: (inspection.nodes || []).filter(node => node.path === internal).map(node => this.publicNode(workspace, node)) };
    }
    return { ...common, files: Object.entries(workspace.documents).map(([path, text]) => {
      const source = workspace.documentSources[path];
      return { path: source.physicalPath, physicalPath: source.physicalPath, sourceId: source.sourceId,
        bytes: Buffer.byteLength(text), sourceKind: source.kind };
    }), nodes: (inspection.nodes || []).filter(node => node.isDefinition).map(node => this.publicNode(workspace, node)), sources: cloneSources(workspace.sources),
      layeredPaths: [...workspace.layeredPaths], limits: WORKSPACE_LIMITS };
  }
  assertRevision(workspace, expectedRevision) {
    if (typeof expectedRevision !== 'string' || expectedRevision !== workspace.revision) fail('WORKSPACE_REVISION_CONFLICT', 409);
  }
  updateSources(workspace, changes) {
    const candidates = cloneSources(workspace.sources);
    for (const change of changes) {
      // Deleting the last definition retains a valid empty UI document. A null
      // file deletion is deliberately unsupported: dropping an override would
      // resurrect the lower layer's definitions.
      if (typeof change.after !== 'string') fail('WORKSPACE_FILE_DELETE_UNSUPPORTED');
      const owner = workspace.documentSources[change.path];
      if (!owner) fail('WORKSPACE_SOURCE_NOT_FOUND');
      const target = candidates.find(source => source.id === owner.sourceId);
      if (!target) fail('WORKSPACE_SOURCE_NOT_FOUND');
      target.overrides[owner.physicalPath] = change.after;
    }
    return cloneSources(this.checkSources(candidates));
  }
  edit(input, checkpoint) {
    const workspace = this.get(input.workspaceId);
    this.assertRevision(workspace, input.expectedRevision);
    // Multi-document replacement is an internal transaction used after scoped
    // analysis. Exposing it here would bypass the registry membership gate.
    if (input.operation?.type === 'replaceTexts') fail('WORKSPACE_OPERATION_UNSUPPORTED', 422);
    if (input.operation?.type === 'batch') return this.editBatch(workspace, input, checkpoint);
    const operation = this.normalizeOperation(workspace, input.operation, input.sourceId);
    if (operation.scope !== undefined) return this.editScoped(workspace, operation);
    const result = editWorkspace({ documents: workspace.documents, documentSources: workspace.documentSources, operation,
      expectedRevision: workspace.revision });
    return this.commitEdit(workspace, operation, result);
  }
  normalizeOperation(workspace, requested, requestedSource) {
    if (requested?.type === 'replaceTexts') fail('WORKSPACE_OPERATION_UNSUPPORTED', 422);
    const operation = { ...requested,
      path: this.documentPath(workspace, requested?.path, requested?.sourceId ?? requestedSource) };
    if (requested?.scope !== undefined) {
      operation.screen = { ...requested.screen,
        path: this.documentPath(workspace, requested.screen?.path, requested.screen?.sourceId ?? requestedSource) };
    }
    // Registry edits still require a separate document-membership transaction.
    if (/^ui\/_ui_defs\.jsonc?$/iu.test(workspace.documentSources[operation.path].physicalPath)) {
      fail('WORKSPACE_UI_REGISTRY_READ_ONLY', 422);
    }
    return operation;
  }
  normalizeBatch(workspace, input) {
    const requested = input.operation;
    if (!Array.isArray(requested.operations) || !requested.operations.length) fail('WORKSPACE_BATCH_INVALID', 422);
    if (requested.operations.length > WORKSPACE_BATCH_LIMITS.operations) fail('WORKSPACE_BATCH_LIMIT', 413);
    // Validate the public surface before resolving paths. Nested/internal
    // operations never receive the internal replaceTexts privilege.
    if (requested.operations.some(item => !item || typeof item !== 'object' || Array.isArray(item)
      || ['batch', 'replaceTexts', 'planEdit', 'planDelete'].includes(item.type))) fail('WORKSPACE_BATCH_OPERATION_INVALID', 422);
    return { type: 'batch', ...(requested.pointerBasis === undefined ? {} : { pointerBasis: requested.pointerBasis }),
      operations: requested.operations.map(item => this.normalizeOperation(workspace, item, input.sourceId)) };
  }
  async editBatch(workspace, input, checkpoint) {
    const operation = this.normalizeBatch(workspace, input);
    const revision = workspace.revision;
    const result = await this.computeBatch(workspace, operation, checkpoint);
    this.assertRevision(this.get(workspace.id), revision);
    return this.commitEdit(workspace, operation, result);
  }
  async previewDraft(input, checkpoint) {
    const workspace = this.get(input.workspaceId);
    this.assertRevision(workspace, input.expectedRevision);
    if (!Number.isSafeInteger(input.pendingVersion) || input.pendingVersion < 0) fail('WORKSPACE_DRAFT_VERSION_INVALID', 422);
    if (input.operation?.type !== 'batch') fail('WORKSPACE_BATCH_INVALID', 422);
    const path = this.documentPath(workspace, input.screen?.path, input.screen?.sourceId);
    const node = workspace.inspection.nodes.find(item => item.path === path
      && item.pointer === input.screen?.pointer && item.isDefinition);
    if (!node) fail('WORKSPACE_DRAFT_SCREEN_INVALID', 422);
    const screen = this.publicNode(workspace, node), revision = workspace.revision;
    const operation = this.normalizeBatch(workspace, input);
    const result = await this.computeBatch(workspace, operation, checkpoint);
    this.assertRevision(this.get(workspace.id), revision);
    if (!result.ok) return { ...result, workspaceId: workspace.id, baseRevision: revision, pendingVersion: input.pendingVersion };
    // Only cloned descriptors are updated; no commitEdit, history push, global
    // invalidation, or live session mutation takes place along this path.
    const sources = this.updateSources(workspace, result.changes || []);
    const documentTexts = Object.create(null);
    for (const [path, text] of Object.entries(result.documents)) {
      const owner = workspace.documentSources[path];
      if (owner) (documentTexts[owner.sourceId] ||= Object.create(null))[owner.physicalPath] = text;
    }
    return { ok: true, workspaceId: workspace.id, baseRevision: revision, draftRevision: result.revision,
      pendingVersion: input.pendingVersion, sources, screen, documentTexts, batch: result.batch, changedFiles: result.changes?.length || 0 };
  }
  async editScoped(workspace, operation) {
    if (workspace.scopedEditContext?.revision !== workspace.revision) {
      workspace.scopedEditContext = await buildScopedEditContext({ documents: workspace.documents, documentSources: workspace.documentSources });
    }
    const result = await editWorkspaceScoped({ documents: workspace.documents, documentSources: workspace.documentSources,
      operation, expectedRevision: workspace.revision, context: workspace.scopedEditContext });
    this.assertRevision(this.get(workspace.id), workspace.revision);
    return this.commitEdit(workspace, operation, result);
  }
  commitEdit(workspace, operation, result) {
    if (!result.ok) return { ...result, workspaceId: workspace.id, revision: workspace.revision };
    if (operation.type === 'planEdit') return { ...result, workspaceId: workspace.id, revision: workspace.revision };
    if (operation.type === 'planDelete' || operation.op === 'planDelete') return { ...result,
      documents: undefined, deletePlan: this.publicDeletePlan(workspace, result.deletePlan), workspaceId: workspace.id, revision: workspace.revision };
    const changes = result.changes || [];
    if (!changes.length) return { ...this.describe(workspace), changes: [], ...(result.editPlan ? { editPlan: result.editPlan } : {}), ...(result.batch ? { batch: result.batch } : {}) };
    const size = bytesOfChanges(changes);
    if (size > WORKSPACE_LIMITS.historyBytes) fail('WORKSPACE_EDIT_HISTORY_LIMIT', 413);
    const sources = this.updateSources(workspace, changes);
    const inspection = { ok: true, revision: result.revision, previewAllowed: result.previewAllowed,
      diagnostics: result.diagnostics || [], nodes: result.nodes || [] };
    const history = { changes, before: workspace.revision, after: result.revision, bytes: size,
      ...(result.editPlan ? { editPlan: result.editPlan } : {}),
      beforeSources: workspace.sources, afterSources: sources };
    const undo = [...workspace.undo, history];
    let historyBytes = undo.reduce((sum, item) => sum + item.bytes, 0);
    while (undo.length > WORKSPACE_LIMITS.historyEntries || historyBytes > WORKSPACE_LIMITS.historyBytes) {
      historyBytes -= undo.shift().bytes;
    }
    const candidate = { ...workspace, documents: result.documents, sources,
      revision: result.revision, inspection, editCount: workspace.editCount + 1,
      undo, redo: [], historyBytes };
    const response = this.checkedDescription(candidate, {
      ...(result.editPlan ? { editPlan: result.editPlan } : {}),
      ...(result.batch ? { batch: result.batch } : {}),
      changes: changes.map(({ path }) => ({ path: workspace.documentSources[path].physicalPath,
        sourceId: workspace.documentSources[path].sourceId })), deletePlan: this.publicDeletePlan(workspace, result.deletePlan) });
    this.sessions.set(workspace.id, candidate);
    this.forgetDraft(candidate);
    this.invalidate();
    return response;
  }
  history(input, direction) {
    const workspace = this.get(input.workspaceId);
    this.assertRevision(workspace, input.expectedRevision);
    const from = direction === 'undo' ? workspace.undo : workspace.redo;
    const to = direction === 'undo' ? workspace.redo : workspace.undo;
    if (!from.length) fail('WORKSPACE_HISTORY_EMPTY', 409);
    const entry = from.at(-1), documents = Object.assign(Object.create(null), workspace.documents);
    const changes = entry.changes.map(change => ({ path: change.path, before: documents[change.path],
      after: direction === 'undo' ? change.before : change.after }));
    for (const change of changes) {
      if (change.after === null || change.after === undefined) delete documents[change.path];
      else documents[change.path] = change.after;
    }
    // Restore exact layer ownership, including absence of an upper override.
    // Writing lower text back into the upper pack would change inheritance.
    const sources = cloneSources(direction === 'undo' ? entry.beforeSources : entry.afterSources);
    const inspection = inspectWorkspace({ documents, documentSources: workspace.documentSources });
    const movedFrom = from.slice(0, -1), movedTo = [...to, entry];
    const undo = direction === 'undo' ? movedFrom : movedTo;
    const redo = direction === 'undo' ? movedTo : movedFrom;
    const candidate = { ...workspace, documents, sources, inspection, undo, redo,
      historyBytes: [...undo, ...redo].reduce((sum, item) => sum + item.bytes, 0),
      revision: workspaceRevision(documents, workspace.documentSources), editCount: workspace.editCount + 1 };
    const response = this.checkedDescription(candidate, { historyAction: { direction, editPlan: entry.editPlan || null } });
    this.sessions.set(workspace.id, candidate);
    this.forgetDraft(candidate);
    this.invalidate();
    return response;
  }
  sources(id) { return cloneSources(this.get(id).sources); }
  close(id) { this.forgetDraft(this.get(id)); this.sessions.delete(id); return { ok: true }; }
  async export(input) {
    const workspace = this.get(input.workspaceId);
    if (input.expectedRevision !== undefined) this.assertRevision(workspace, input.expectedRevision);
    if (!['plan', 'zip'].includes(input.mode)) fail('WORKSPACE_EXPORT_MODE_INVALID');
    const sources = workspace.sources.map(source => {
      const item = this.getPack(source.id);
      return { ...source, paths: item.packPaths,
        readText: (filePath, maxBytes) => item.zipReader.readText(item.rootPrefix + filePath, { maxBytes }),
        readBytes: (filePath, maxBytes) => item.zipReader.bytes(item.rootPrefix + filePath, maxBytes) };
    });
    const selections = input.selections?.map(selection => ({ ...selection,
      sourceId: selection.sourceId === 'imported-pack' ? sources.find(source => source.kind === 'imported')?.id
        : selection.sourceId === 'vanilla-reference' ? sources.find(source => source.kind === 'vanilla')?.id : selection.sourceId }));
    const result = await (input.mode === 'zip' ? buildWorkspaceExport : planWorkspaceExport)({ sources, selections, name: input.name,
      packOptions: input.packOptions, iconPngBase64: input.iconPngBase64 });
    if (input.mode === 'zip' && result.ok && result.bytes) return { kind: 'bytes', body: result.bytes, mimeType: 'application/zip', summary: summarizeWorkspaceResult(result) };
    return { kind: 'json', body: JSON.stringify({ ...result, workspaceId: workspace.id, revision: workspace.revision }), summary: summarizeWorkspaceResult(result) };
  }
}
