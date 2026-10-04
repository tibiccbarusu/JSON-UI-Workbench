import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScopedEditContext, editWorkspaceScoped, SCOPED_RESULT_CONTEXT, SCOPED_RESULT_REBASE } from '../workspace-scoped-edit.mjs';
import { editWorkspaceBatch } from '../workspace-batch.mjs';
import { workspaceRevision, editWorkspace } from '../workspace-edit.mjs';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';

const fixture = () => ({ 'ui/a.json': JSON.stringify({ namespace: 'a',
  image: { type: 'image', size: [10, 10], offset: [0, 0] },
  panel: { type: 'panel', controls: [{ 'first@a.image': {} }, { 'second@a.image': {} }] },
  root: { type: 'screen', controls: [{ 'panel@a.panel': {} }] },
  shared_root: { type: 'screen', controls: [{ 'image@a.image': {} }] },
  other: { type: 'screen', controls: [{ 'root@a.shared_root': {} }] },
}) });
async function request(documents, name = 'root', pointer = '/root/controls/0/panel/controls/0/first', context) {
  context ||= await buildScopedEditContext({ documents });
  const record = context.catalog.recordsById[context.catalog.symbols[`a.${name}`].winnerId];
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id });
  assert.equal(projection.ok, true);
  const source = projection.nodeSources[pointer];
  return { context, documents, expectedRevision: workspaceRevision(documents), operation: {
    type: 'move', scope: 'screen', targetMode: 'visual', delta: [1, 2],
    screen: { path: record.filePath, pointer: '/' + record.rawKey },
    path: source.path, pointer: source.pointer, effectivePointer: pointer,
  } };
}

test('R36: interleaved geometry preserves full-path bytes, revision, plans and atomic input', async () => {
  const documents = fixture(), original = JSON.stringify(documents), first = (await request(documents)).operation;
  const second = (await request(documents, 'root', '/root/controls/0/panel/controls/1/second')).operation;
  const operation = { type: 'batch', operations: [first,
    { ...first, type: 'set', property: 'size', value: ['80%', 25] }, second,
    { ...second, type: 'set', property: 'anchor_to', value: 'top_left' },
    { ...first, delta: [-3, 4] }] };
  const checkpoints = [];
  const fast = await editWorkspaceBatch({ documents, expectedRevision: workspaceRevision(documents), operation,
    checkpoint: phase => checkpoints.push(phase) });
  const ordinary = await editWorkspaceBatch({ documents, expectedRevision: workspaceRevision(documents), operation, reuseReferenceProof: false });
  assert.equal(fast.ok, true, JSON.stringify(fast)); assert.equal(ordinary.ok, true, JSON.stringify(ordinary));
  assert.deepEqual(fast.documents, ordinary.documents); assert.equal(fast.revision, ordinary.revision);
  assert.deepEqual(fast.editPlan, ordinary.editPlan); assert.deepEqual(fast.diagnostics, ordinary.diagnostics);
  assert.equal(JSON.stringify(documents), original);
  assert.equal(checkpoints.filter(phase => phase === 'scoped-catalog-reference-direct').length, 2);
  assert(checkpoints.includes('scoped-catalog-reference-skipped'));
});

test('R36: skipped catalog says not-scanned and yields identical inheritance, not complete dependency QA', async () => {
  const documents = fixture(), full = await buildScopedEditContext({ documents });
  const skipped = await buildScopedEditContext({ documents, referenceDiscovery: 'skip' });
  assert.equal(skipped.catalog.summary.referenceCoverage.status, 'not-scanned');
  assert.equal(skipped.catalog.summary.referenceNodesVisited, 0);
  assert.equal(skipped.catalog.summary.referenceCompleteDefinitions, 0);
  for (const name of Object.keys(full.catalog.symbols)) {
    const normal = resolveEffectiveUi({ catalog: full.catalog, recordId: full.catalog.symbols[name].winnerId });
    const short = resolveEffectiveUi({ catalog: skipped.catalog, recordId: skipped.catalog.symbols[name].winnerId });
    // Reference-based component/root labels are deliberately not inferred in
    // resolution-only mode; the interpreted content and source proofs agree.
    assert.deepEqual(short.document, normal.document);
    assert.deepEqual(short.nodeSources, normal.nodeSources);
    assert.deepEqual(short.provenance, normal.provenance);
    assert.deepEqual(short.diagnostics, normal.diagnostics);
  }
});

test('R36: request JSON marker cannot waive an unproven skipped-context inbound safety scan', async () => {
  const documents = fixture(), context = await buildScopedEditContext({ documents, referenceDiscovery: 'skip' });
  const input = await request(documents, 'shared_root', '/shared_root/controls/0/image', context), phases = [];
  input.operation.inboundProofs36 = 'a.shared_root'; input.operation.reuseReferenceProof = true;
  const result = await editWorkspaceScoped({ ...input, checkpoint: phase => phases.push(phase) });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_SCREEN_IS_SHARED');
  assert(phases.includes('scoped-catalog-reference-direct')); assert.equal(result.documents, undefined);
});

test('R36: a proof cannot cross into a different shared screen', async () => {
  const first = await editWorkspaceScoped(await request(fixture()));
  assert.equal(first.ok, true); const context = first[SCOPED_RESULT_CONTEXT];
  assert.equal(context.catalog.summary.referenceDiscovery, 'skipped');
  const phases = [], input = await request(first.documents, 'shared_root', '/shared_root/controls/0/image', context);
  const result = await editWorkspaceScoped({ ...input, checkpoint: phase => phases.push(phase) });
  assert.equal(result.code, 'EDIT_SCREEN_IS_SHARED'); assert(phases.includes('scoped-catalog-reference-direct'));
});

test('R36: shared edit upgrades to full reference graph and returns affected-screen candidates', async () => {
  const first = await editWorkspaceScoped(await request(fixture()));
  const context = first[SCOPED_RESULT_CONTEXT], phases = [];
  const input = await request(first.documents, 'shared_root', '/shared_root/controls/0/image', context);
  input.operation.scope = 'shared';
  const result = await editWorkspaceScoped({ ...input, checkpoint: phase => phases.push(phase) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert(result.editPlan.affectedScreens.some(record => record.qualifiedName === 'a.shared_root'));
  assert.equal(result[SCOPED_RESULT_CONTEXT].catalog.summary.referenceDiscovery, 'full');
  assert(phases.includes('scoped-catalog-reference-direct'));
});

test('R36: arbitrary property cannot carry a geometry proof, and stale revision is rejected', async () => {
  const input = await request(fixture()), first = await editWorkspaceScoped(input);
  const context = first[SCOPED_RESULT_CONTEXT];
  const operation = { ...first[SCOPED_RESULT_REBASE](input.operation), type: 'set', property: '$control', value: 'a.shared_root' };
  const result = await editWorkspaceScoped({ documents: first.documents, expectedRevision: first.revision, context, operation });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result[SCOPED_RESULT_CONTEXT].catalog.summary.referenceDiscovery, 'full');
  const raw = editWorkspace({ documents: first.documents, expectedRevision: first.revision,
    operation: { type: 'set', path: 'ui/a.json', pointer: '/image/size', value: [99, 99] } });
  assert.equal(raw.ok, true);
  const stale = await editWorkspaceScoped({ documents: raw.documents, expectedRevision: raw.revision, context, operation });
  assert.equal(stale.code, 'EDIT_REVISION_CONFLICT'); assert.equal(stale.documents, undefined);
});

test('R36: catalog cancellation propagates without publishing intermediate documents', async () => {
  const documents = fixture(), input = await request(documents), original = JSON.stringify(documents);
  const error = Object.assign(new Error('cancel'), { code: 'NODE_JOB_CANCELLED' });
  await assert.rejects(editWorkspaceBatch({ documents, expectedRevision: input.expectedRevision,
    operation: { type: 'batch', operations: [input.operation] }, checkpoint: phase => {
      if (phase === 'scoped-catalog-reference-direct') throw error;
    } }), candidate => candidate === error);
  assert.equal(JSON.stringify(documents), original);
});


test('R36: registry progress cancellation retains its original identity', async () => {
  const documents = { ...fixture(), 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/a.json'] }) };
  const error = Object.assign(new Error('cancel registry'), { code: 'NODE_JOB_CANCELLED' });
  await assert.rejects(buildScopedEditContext({ documents, checkpoint: phase => {
    if (phase === 'scoped-catalog-registry') throw error;
  } }), candidate => candidate === error);
});


for (const filePath of ['ui/_ui_defs.json', 'ui/a.json']) test(`R36: source-read cancellation is not a pack error: ${filePath}`, async () => {
  const error = Object.assign(new Error('cancel read'), { code: 'NODE_JOB_CANCELLED' });
  await assert.rejects(buildUiCatalog({ parseJsonc, sources: [{ id: 'test', filePaths: [filePath],
    readText: async () => { throw error; } }] }), candidate => candidate === error);
});
