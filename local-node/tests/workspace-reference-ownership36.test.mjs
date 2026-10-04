import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScopedEditContext, editWorkspaceScoped, SCOPED_RESULT_CONTEXT, SCOPED_RESULT_REBASE } from '../workspace-scoped-edit.mjs';
import { editWorkspaceBatch } from '../workspace-batch.mjs';
import { workspaceRevision } from '../workspace-edit.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';

async function project(documents, name) {
  const context = await buildScopedEditContext({ documents });
  const record = context.catalog.recordsById[context.catalog.symbols[name].winnerId];
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id });
  assert.equal(projection.ok, true);
  return { projection, record };
}

test('配置変更の証明があっても後続削除で残存ボタンからの参照を省略しない', { timeout: 5000 }, async () => {
  const documents = { 'ui/a.json': JSON.stringify({ namespace: 'a', part: { type: 'image', offset: [0, 0] },
    button: { type: 'button', default_control: 'part', controls: [{ 'part@a.part': {} }] },
    root: { type: 'screen', controls: [{ 'button@a.button': {} }] } }) };
  const { projection } = await project(documents, 'a.root');
  const effectivePointer = '/root/controls/0/button/controls/0/part', source = projection.nodeSources[effectivePointer];
  const move = { type: 'move', scope: 'screen', targetMode: 'visual', path: source.path, pointer: source.pointer,
    screen: { path: 'ui/a.json', pointer: '/root' }, effectivePointer, delta: [1, 0] };
  const first = await editWorkspaceScoped({ documents, expectedRevision: workspaceRevision(documents), operation: move });
  assert.equal(first.ok, true, JSON.stringify(first));
  const context = first[SCOPED_RESULT_CONTEXT];
  assert.equal(context.catalog.summary.referenceDiscovery, 'skipped');
  const before = JSON.stringify(first.documents);
  const result = await editWorkspaceScoped({ documents: first.documents, expectedRevision: first.revision, context,
    operation: { ...first[SCOPED_RESULT_REBASE](move), type: 'delete', deletionUnit: 'selected' } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EDIT_STRUCTURE_REFERENCED');
  assert.equal(result.documents, undefined);
  assert.equal(JSON.stringify(first.documents), before);
});

for (const reuseReferenceProof of [true, false]) {
  test(`分離後の任意追加で別画面から参照された定義を専用とみなさない（proof=${reuseReferenceProof}）`, { timeout: 5000 }, async () => {
    const documents = { 'ui/a.json': JSON.stringify({ namespace: 'a', image: { type: 'image', offset: [0, 0] },
      template: { type: 'panel', controls: [{ 'image@a.image': {} }] },
      'root@a.template': { type: 'screen' }, other: { type: 'screen', controls: [] } }) };
    const expectedRevision = workspaceRevision(documents);
    const { projection, record } = await project(documents, 'a.root');
    const effectivePointer = '/root/controls/0/image', source = projection.nodeSources[effectivePointer];
    const move = { type: 'move', scope: 'screen', targetMode: 'visual', path: source.path, pointer: source.pointer,
      screen: { path: record.filePath, pointer: '/root@a.template' }, effectivePointer, delta: [1, 0] };
    // 生成名は乱数ではない。正規の原文/版番号から分離結果を予測した入力も信頼しない。
    const first = await editWorkspaceScoped({ documents, expectedRevision, operation: move, reuseReferenceProof });
    assert.equal(first.ok, true);
    const privateName = first.editPlan.clonedDefinitions.find(copy => copy.original === 'a.template').qualifiedName;
    const addSharedReference = { type: 'add', path: 'ui/a.json', parentPointer: '/other',
      name: `extra@${privateName}`, value: {} };
    const execute = operations => editWorkspaceBatch({ documents, expectedRevision, reuseReferenceProof,
      operation: { type: 'batch', pointerBasis: 'base-revision', operations } });
    const beforeFinalMove = await execute([move, addSharedReference]);
    const result = await execute([move, addSharedReference, move]);
    assert.equal(beforeFinalMove.ok, true, JSON.stringify(beforeFinalMove));
    assert.equal(result.ok, true, JSON.stringify(result));
    const beforeOther = (await project(beforeFinalMove.documents, 'a.other')).projection.document;
    const afterOther = (await project(result.documents, 'a.other')).projection.document;
    assert.deepEqual(afterOther, beforeOther, '最後の画面限定移動で別画面の追加要素まで移動させない');
    assert.deepEqual(afterOther.other.controls[0].extra.controls[0].image.offset, [1, 0]);
    assert.deepEqual((await project(result.documents, 'a.root')).projection.document.root.controls[0].image.offset, [2, 0]);
    assert.equal(workspaceRevision(documents), expectedRevision, '入力原文の変更をしない');
  });
}
