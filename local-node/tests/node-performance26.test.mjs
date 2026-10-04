import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WorkspaceSessions } from '../workspace-session.mjs';
import { WorkspaceDraftProjector } from '../workspace-draft-preview.mjs';
import { editWorkspaceBatch } from '../workspace-batch.mjs';
import { createJobProgress } from '../job-progress.mjs';
import { Processor } from '../worker-client.mjs';
import { createLocalServer } from '../server.mjs';
import { createWorkspaceDraftPreview23 } from '../../editor-core/src/ui/workspace-draft-preview23.js';
const documents = { 'ui/test.json': JSON.stringify({ namespace: 'test', screen: { type: 'screen', size: [100, 80],
  controls: [{ child: { type: 'image', offset: [1, 2], size: [10, 10] } }] }, pocket: { type: 'screen', $pocket_screen: true } }) };
const operations = [
  { type: 'move', path: 'ui/test.json', pointer: '/screen/controls/0/child', offset: [3, 5] },
  { type: 'set', path: 'ui/test.json', pointer: '/screen/controls/0/child/alpha', value: 0.6 },
];
const frame = { preset: { width: 100, height: 80 }, generation: 1, animationTime: 0, visibilityMode: 'safe' };
async function fixture() {
  let builds = 0, reads = 0;
  const pack = { rootPrefix: '', packPaths: Object.keys(documents), zipReader: { readText: async path => { reads++; return documents[path]; } } };
  const manager = new WorkspaceSessions({ getPack: () => pack, checkSources: value => value, invalidate: () => {},
    batchExecutor: input => { builds++; return editWorkspaceBatch(input); } });
  const state = await manager.open({ sources: [{ id: 'pack', kind: 'imported' }] });
  const input = { workspaceId: state.workspaceId, expectedRevision: state.revision, pendingVersion: 1,
    screen: { path: 'ui/test.json', pointer: '/screen' }, operation: { type: 'batch', pointerBasis: 'base-revision', operations: structuredClone(operations) } };
  return { manager, state, input, pack, builds: () => builds, reads: () => reads };
}

test('成功した草稿だけを再利用し確定1履歴・原文・revisionを保存する', async () => {
  const { manager, state, input, builds } = await fixture();
  const first = await manager.previewDraft(input); assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.batch.validationCache, 'miss'); assert.equal(builds(), 1);
  // Caller mutation cannot change the serialized accepted operation result.
  first.batch.appliedCount = 999;
  const repeated = await manager.previewDraft({ ...input, pendingVersion: 2 });
  assert.equal(repeated.batch.validationCache, 'hit'); assert.equal(repeated.batch.appliedCount, 2); assert.equal(builds(), 1);
  assert.equal(manager.get(state.workspaceId).revision, state.revision);
  assert.equal(manager.get(state.workspaceId).undo.length, 0);
  const committed = await manager.edit(input);
  assert.equal(committed.batch.validationCache, 'hit'); assert.equal(builds(), 1);
  assert.equal(committed.editCount, 1); assert.equal(manager.get(state.workspaceId).undo.length, 1);
  assert.deepEqual(JSON.parse(manager.get(state.workspaceId).documents['ui/test.json']).screen.controls[0].child.offset, [3, 5]);
  assert.equal(manager.snapshot().entries, 0); assert.equal(manager.snapshot().retainedBytes, 0);
  const undone = manager.history({ workspaceId: state.workspaceId, expectedRevision: committed.revision }, 'undo');
  assert.equal(undone.revision, state.revision);
  await manager.previewDraft(input); assert.equal(builds(), 2);
});

test('操作値・順序・screen scope・revisionが異なれば結果を使い回さない', async () => {
  const { manager, input, builds } = await fixture();
  await manager.previewDraft(input);
  const changed = structuredClone(input); changed.operation.operations[0].offset = [4, 5];
  await manager.previewDraft(changed); assert.equal(builds(), 2);
  changed.operation.operations.reverse(); await manager.previewDraft(changed); assert.equal(builds(), 3);
  const invalid = structuredClone(input); invalid.operation.operations[1].pointer = '/missing/alpha';
  for (let index = 0; index < 2; index++) assert.equal((await manager.previewDraft(invalid)).ok, false);
  assert.equal(builds(), 5);
  await assert.rejects(manager.previewDraft({ ...input, expectedRevision: 'stale' }), { code: 'WORKSPACE_REVISION_CONFLICT' });
  assert.equal(builds(), 5);
  manager.close(input.workspaceId); assert.equal(manager.snapshot().retainedBytes, 0);
});

test('キャッシュはセッション間で共有せず取り込み破棄で解放する', async () => {
  const { manager, input, builds } = await fixture();
  await manager.previewDraft(input);
  const other = await manager.open({ sources: [{ id: 'other', kind: 'imported' }] });
  await manager.previewDraft({ ...input, workspaceId: other.workspaceId, expectedRevision: other.revision });
  assert.equal(builds(), 2); assert.equal(manager.snapshot().entries, 2);
  manager.clear(); assert.equal(manager.snapshot().entries, 0); assert.equal(manager.snapshot().retainedBytes, 0);
});

test('同一草稿のフレーム変更だけなら投影再利用、既読UIはZIPを再読込しない', async () => {
  const { manager, input, pack, reads } = await fixture();
  const draft = await manager.previewDraft(input), projector = new WorkspaceDraftProjector(), before = reads();
  const first = await projector.project({ draft, getPack: () => pack, frame });
  assert.equal(first.metrics.projectionCache, 'miss'); assert.equal(reads(), before);
  const next = await projector.project({ draft: { ...draft, pendingVersion: 2 }, getPack: () => pack, frame: { ...frame, generation: 2 } });
  assert.equal(next.metrics.projectionCache, 'hit'); assert.equal(next.pendingVersion, 2);
  assert.deepEqual(next.frame.layout.boxes, first.frame.layout.boxes);
  await projector.project({ draft, getPack: () => pack, frame, variables: { $flag: true } });
  assert.equal(projector.snapshot().builds, 2);
  await assert.rejects(projector.project({ draft, getPack: () => pack, frame: { ...frame, modelId: 'invalid' } }), { code: 'WORKSPACE_DRAFT_FRAME_INVALID' });
  const pocket = await manager.previewDraft({ ...input, screen: { path: 'ui/test.json', pointer: '/pocket' } });
  await assert.rejects(projector.project({ draft: pocket, getPack: () => pack, frame }), { code: 'POCKET_PREVIEW_BLOCKED' });
  projector.clear(); assert.equal(projector.snapshot().bytes, 0);
});

test('工程境界の取消は部分原文を公開せず履歴・キャッシュを変えない', async () => {
  const { manager, input, state } = await fixture();
  const cancellation = new SharedArrayBuffer(4), events = [];
  const checkpoint = createJobProgress({ cancellation, send: event => {
    events.push(event); if (event.phase === 'batch-edit' && event.completed === 1) Atomics.store(new Int32Array(cancellation), 0, 1);
  } });
  await assert.rejects(manager.previewDraft(input, checkpoint), error => error.code === 'NODE_JOB_CANCELLED' && error.category === 'cancelled' && error.retryable === false);
  assert.equal(manager.get(state.workspaceId).revision, state.revision); assert.equal(manager.get(state.workspaceId).undo.length, 0);
  assert.equal(manager.get(state.workspaceId).documents['ui/test.json'], documents['ui/test.json']);
  assert.equal(manager.snapshot().entries, 0);
  assert(events.some(event => event.phase === 'batch-edit' && event.completed === 1 && event.total === 2 && event.percent === 50));
  assert.equal((await manager.edit(input)).ok, true);
});

test('分母不明の工程は割合を捏造しない', () => {
  const events = [], checkpoint = createJobProgress({ send: event => events.push(event) });
  checkpoint('inheritance'); checkpoint('batch-edit', 3, 4); checkpoint('invalid-count', 9, 4);
  assert.equal(events[0].percent, null); assert.equal(events[1].percent, 75); assert.equal(events[2].percent, null);
});

test('草稿の最新世代へ移ると旧通信を取り消し最新進捗だけを残す', async () => {
  let snapshot = { workspaceId: 'w', expectedRevision: 'r', pendingVersion: 1, screen: {}, operation: {} };
  const seen = [], client = createWorkspaceDraftPreview23({ readSnapshot: () => snapshot, delayMs: 0,
    project: (input, { signal, onProgress }) => new Promise((resolve, reject) => {
      seen.push({ input, signal, onProgress, resolve });
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
    }) });
  const first = client.flush(); await new Promise(resolve => setTimeout(resolve, 0));
  snapshot = { ...snapshot, pendingVersion: 2 }; client.request(); await first;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(seen[0].signal.aborted, true); assert.equal(seen.length, 2);
  seen[0].onProgress({ phase: 'old', percent: 99 }); assert.equal(client.getStatus().progress, null);
  seen[1].onProgress({ phase: 'batch-edit', completed: 1, total: 2, percent: 50 });
  assert.equal(client.getStatus().progress.percent, 50);
  seen[1].resolve({ ok: true, baseRevision: 'r', pendingVersion: 2 }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(client.getResult().pendingVersion, 2); assert.equal(client.getStatus().cancelled, 1); client.cancel();
});

test('取消要求を障害件数に加えず相関ID・再試行不可を保持する', { timeout: 10000 }, async t => {
  const processor = new Processor(); t.after(() => processor.close());
  let release; processor.tail = new Promise(resolve => { release = resolve; });
  const controller = new AbortController(), request = processor.call('workspace-status', {}, 5000, { signal: controller.signal, correlationId: 'fixture' });
  controller.abort(); release();
  await assert.rejects(request, error => error.code === 'NODE_JOB_CANCELLED' && error.retryable === false && error.correlation_id === 'fixture');
  assert.equal(processor.snapshot().failed, 0); assert.equal(processor.snapshot().cancelled, 1);
});

test('進捗HTTPはCPUキューに入らず認証とID検査を維持する', { timeout: 15000 }, async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`, cap = await (await fetch(`${base}/api/node/capabilities`)).json();
  const headers = { 'x-jsonui-token': cap.token, 'content-type': 'application/json' };
  assert.equal(cap.features.workspaceProgress, true);
  const progressId = randomUUID(); let release; app.processor.tail = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const job = app.processor.call('remove', { id: 'missing', progressId }, 10000);
  const started = performance.now();
  const progress = await (await fetch(`${base}/api/node/progress?progressId=${progressId}`, { headers })).json();
  assert.equal(progress.job.status, 'queued'); assert.equal(progress.job.percent, null); assert.equal(progress.processor_dead, false);
  assert(performance.now() - started < 1000, 'blocked Worker must not block observation');
  assert.equal((await fetch(`${base}/api/node/progress?progressId=${progressId}`)).status, 401);
  assert.equal((await fetch(`${base}/api/node/progress?progressId=invalid`, { headers })).status, 422);
  release(); await job; assert.equal(app.processor.snapshot().pending, 0);
});

test('実Workerへ取消フラグを伝え途中草稿を止めても確定セッションを保持する', { timeout: 30000 }, async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const { CliClient } = await import('../cli-client.mjs'); const { makeZip, manifest } = await import('./fixtures.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'jsonui-cancel26-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const client = await CliClient.start(); t.after(() => client.close());
  const file = join(directory, 'test.mcpack');
  await writeFile(file, makeZip({ 'manifest.json': manifest, 'ui/test.json': JSON.stringify({ namespace: 'test', screen: { type: 'screen',
    controls: Array.from({ length: 200 }, (_, index) => ({ [`image${index}`]: { type: 'image', size: [2, 2], offset: [index, 0] } })) } }) }));
  const imported = await client.importPack(file);
  const state = await client.request('/api/node/workspace-open', { payload: { sources: [{ id: imported.id, kind: 'imported' }] } });
  const controller = new AbortController(), processor = client.app.processor, events = [];
  const observe = message => {
    if (message.progress) events.push(message.progress);
    if (message.progress?.phase === 'batch-edit') controller.abort();
  };
  processor.worker.on('message', observe); t.after(() => processor.worker.off('message', observe));
  const result = processor.call('workspace-preview-draft', { workspaceId: state.workspaceId, expectedRevision: state.revision,
    pendingVersion: 1, screen: { path: 'ui/test.json', pointer: '/screen' }, frame,
    operation: { type: 'batch', pointerBasis: 'base-revision', operations: Array.from({ length: 128 }, (_, index) => ({
      type: 'move', path: 'ui/test.json', pointer: `/screen/controls/${index}/image${index}`, offset: [index, 10] })) } },
    20000, { signal: controller.signal, correlationId: 'actual-worker-cancel-fixture' });
  await assert.rejects(result, { code: 'NODE_JOB_CANCELLED' });
  assert(events.some(event => event.phase === 'batch-edit')); assert.equal(processor.dead, false);
  const after = await client.request('/api/node/workspace-status', { payload: { workspaceId: state.workspaceId } });
  assert.equal(after.revision, state.revision); assert.equal(after.editCount, 0); assert.equal(after.canUndo, false);
  const cancelled = processor.snapshot().recent.find(item => item.outcome === 'cancelled');
  assert.equal(cancelled.result_discarded, undefined, 'Worker actually stopped, rather than merely discarding a full result');
  assert.equal(processor.snapshot().failed, 0);
});

test('継承を複製する実編集で草稿再利用と通常確定の原文byte・revisionが一致する', async () => {
  const { scoped20Documents, scoped20Cases } = await import('./workspace-scoped20-fixtures.mjs');
  const { buildScopedEditContext } = await import('../workspace-scoped-edit.mjs');
  const { resolveEffectiveUi } = await import('../../editor-core/src/engine/effective-ui-resolver.js');
  const create = () => new WorkspaceSessions({ getPack: () => ({ rootPrefix: '', packPaths: Object.keys(scoped20Documents),
    zipReader: { readText: async path => scoped20Documents[path] } }), checkSources: value => value, invalidate: () => {} });
  const cached = create(), direct = create();
  const a = await cached.open({ sources: [{ id: 'same-pack', kind: 'imported' }] });
  const b = await direct.open({ sources: [{ id: 'same-pack', kind: 'imported' }] });
  const original = cached.get(a.workspaceId), context = await buildScopedEditContext({ documents: original.documents, documentSources: original.documentSources });
  const list = scoped20Cases.map(({ screen: symbol, effectivePointer }, index) => {
    const record = context.catalog.recordsById[context.catalog.symbols[symbol].winnerId];
    const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id }), source = projection.nodeSources[effectivePointer];
    return { type: 'move', scope: 'screen', targetMode: 'visual', generatedScope: 'template', delta: [index + 1, 4],
      path: source.path, sourceId: source.sourceId, pointer: source.pointer, effectivePointer,
      screen: { path: record.filePath, sourceId: record.sourceId, pointer: '/' + record.rawKey } };
  });
  const operation = { type: 'batch', pointerBasis: 'base-revision', operations: list };
  const draft = await cached.previewDraft({ workspaceId: a.workspaceId, expectedRevision: a.revision, pendingVersion: 1,
    screen: list[0].screen, operation }); assert.equal(draft.ok, true, JSON.stringify(draft));
  const ca = await cached.edit({ workspaceId: a.workspaceId, expectedRevision: a.revision, operation });
  const cb = await direct.edit({ workspaceId: b.workspaceId, expectedRevision: b.revision, operation });
  assert.equal(ca.batch.validationCache, 'hit'); assert.equal(cb.batch.validationCache, 'miss');
  assert.deepEqual(cached.get(a.workspaceId).documents, direct.get(b.workspaceId).documents);
  assert.equal(ca.revision, cb.revision); assert.deepEqual(ca.editPlan, cb.editPlan);
  for (const [manager, state, result] of [[cached, a, ca], [direct, b, cb]]) {
    const undone = manager.history({ workspaceId: state.workspaceId, expectedRevision: result.revision }, 'undo');
    assert.equal(undone.revision, state.revision);
    const redone = manager.history({ workspaceId: state.workspaceId, expectedRevision: undone.revision }, 'redo');
    assert.equal(redone.revision, result.revision);
  }
});
