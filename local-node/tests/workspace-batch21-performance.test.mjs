import test from 'node:test';
import assert from 'node:assert/strict';
import { editWorkspaceBatch } from '../workspace-batch.mjs';
import { buildScopedEditContext, editWorkspaceScoped } from '../workspace-scoped-edit.mjs';
import { workspaceRevision } from '../workspace-edit.mjs';
import { JSONC_EDIT_LIMITS } from '../workspace-jsonc.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
const docsFor = offset => ({ 'ui/a.json': JSON.stringify({ namespace: 'a', image: { type: 'image', offset },
  root: { type: 'screen', controls: [{ 'image@a.image': {} }] }, other: { type: 'screen', controls: [{ 'image@a.image': {} }] } }) });
async function operations(documents, deltas, extra = {}) {
  const context = await buildScopedEditContext({ documents });
  const record = context.catalog.recordsById[context.catalog.symbols['a.root'].winnerId];
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id });
  const effectivePointer = '/root/controls/0/image', source = projection.nodeSources[effectivePointer];
  return deltas.map(delta => ({ type: 'move', scope: 'screen', targetMode: 'visual', path: source.path, pointer: source.pointer,
    screen: { path: record.filePath, pointer: '/root' }, effectivePointer, delta, ...extra }));
}
for (const [name, offset, deltas] of [
  ['微小差分は各操作で丸める', [0, 0], [[0.0004, 0.0004], [0.0004, 0.0004], [0.0004, 0.0004]]],
  ['正負と小数', [0.123, -2.5], [[0.0006, -0.1236], [-3.0056, 5.9004], [5.9001, -8.1]]],
  ['相対単位とpxを維持', ['50% - 2px', '10px'], [[1.2345, -2.3456], [0.0004, -1.0006], [-3, 4]]],
  ['単位なし数値文字列を数値へ正規化', ['2.001', '-1'], [[0.0005, 3], [0.0004, -0.2226], [-5, 0.5]]],
]) test(`連続移動最適化は逐次経路と原文byteが一致: ${name}`, async () => {
  const documents = docsFor(offset), list = await operations(documents, deltas), expectedRevision = workspaceRevision(documents);
  const fast = await editWorkspaceBatch({ documents, expectedRevision, operation: { type: 'batch', operations: list } });
  // Distinct inert metadata prevents grouping without changing the edit semantics.
  const slow = await editWorkspaceBatch({ documents, expectedRevision, operation: { type: 'batch', operations: list.map((op, index) => ({ ...op, comparisonStep: index })) } });
  assert.equal(fast.ok, true, JSON.stringify(fast)); assert.equal(slow.ok, true, JSON.stringify(slow));
  assert.deepEqual(fast.documents, slow.documents); assert.equal(fast.revision, slow.revision);
  assert.equal(fast.editPlan.operations.length, deltas.length);
});

test('途中の不正deltaを後続で打消せずそのindexで原子的拒否', async () => {
  const documents = docsFor([0, 0]), list = await operations(documents, [[1, 2], [1000001, 0], [-1000001, 0]]);
  const result = await editWorkspaceBatch({ documents, expectedRevision: workspaceRevision(documents), operation: { type: 'batch', operations: list } });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_DELTA_INVALID'); assert.equal(result.batch.failedOperationIndex, 1);
  assert.equal(result.documents, undefined); assert.equal(result.batch.appliedCount, 0);
});

test('丸め時の有限数overflowを後続の数値で隠せず、offset計算時に原子的拒否', async () => {
  const documents = docsFor([1e308, 0]), list = await operations(documents, [[1, 0], [-1, 0]]);
  const before = JSON.stringify(documents), expectedRevision = workspaceRevision(documents);
  // 1e308は有限だが、3桁丸めの乗算でInfinityになる。後段の構造検査に渡す前に拒否する。
  const grouped = await editWorkspaceBatch({ documents, expectedRevision, operation: { type: 'batch', operations: list } });
  const sequential = await editWorkspaceBatch({ documents, expectedRevision,
    operation: { type: 'batch', operations: list.map((operation, index) => ({ ...operation, comparisonStep: index })) } });
  for (const result of [grouped, sequential]) {
    assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_DYNAMIC_OFFSET');
    assert.equal(result.batch.failedOperationIndex, 0); assert.equal(result.batch.appliedCount, 0);
    assert.equal(result.batch.atomic, true); assert.equal(result.documents, undefined);
  }
  assert.equal(JSON.stringify(documents), before); assert.equal(workspaceRevision(documents), expectedRevision);
});

test('途中の原文容量超過を逆方向の移動で隠せず逐次経路と拒否位置が一致', async () => {
  const body = JSON.stringify({ namespace: 'a', root: { type: 'screen', controls: [{ image: { type: 'image', offset: [0, 0] } }] } });
  const documents = { 'ui/a.json': '/*' + 'a'.repeat(JSONC_EDIT_LIMITS.maxBytes - Buffer.byteLength(body) - 4) + '*/' + body };
  const list = await operations(documents, [[1000000, 0], [-1000000, 0]]), expectedRevision = workspaceRevision(documents);
  const fast = await editWorkspaceBatch({ documents, expectedRevision, operation: { type: 'batch', operations: list } });
  const slow = await editWorkspaceBatch({ documents, expectedRevision, operation: { type: 'batch', operations: list.map((op, index) => ({ ...op, comparisonStep: index })) } });
  assert.equal(fast.ok, false); assert.equal(fast.code, 'EDIT_TEXT_LIMIT'); assert.equal(fast.batch.failedOperationIndex, 0);
  assert.equal(fast.documents, undefined); assert.equal(slow.code, fast.code);
  assert.equal(slow.batch.failedOperationIndex, fast.batch.failedOperationIndex);
});

test('移動の間にsetがあれば順序を保ち独立して検証', async () => {
  const documents = docsFor([0, 0]), [first, second] = await operations(documents, [[1, 0], [2, 0]]);
  const list = [first, { ...first, type: 'set', property: 'offset', value: [100, 2] }, second];
  const result = await editWorkspaceBatch({ documents, expectedRevision: workspaceRevision(documents), operation: { type: 'batch', operations: list } });
  assert.equal(result.ok, true, JSON.stringify(result));
  const context = await buildScopedEditContext({ documents: result.documents });
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: context.catalog.symbols['a.root'].winnerId });
  assert.deepEqual(projection.document.root.controls[0].image.offset, [102, 2]);
});

test('JSON由来の同名文字列プロパティから内部連続移動を注入できない', async () => {
  const documents = docsFor([0, 0]), [operation] = await operations(documents, [[1, 2]]);
  const result = await editWorkspaceScoped({ documents, expectedRevision: workspaceRevision(documents),
    operation: { ...operation, 'scoped-batch-move-sequence': [[100, 100]], 'SCOPED_BATCH_MOVE_SEQUENCE': [[200, 200]] } });
  assert.equal(result.ok, true);
  const context = await buildScopedEditContext({ documents: result.documents });
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: context.catalog.symbols['a.root'].winnerId });
  assert.deepEqual(projection.document.root.controls[0].image.offset, [1, 2]);
});
