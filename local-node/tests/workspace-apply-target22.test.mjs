import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScopedEditContext, editWorkspaceScoped } from '../workspace-scoped-edit.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { scoped20Documents, scoped20Cases } from './workspace-scoped20-fixtures.mjs';
const at = (object, pointer) => pointer.slice(1).split('/').map(x => x.replaceAll('~1','/').replaceAll('~0','~')).reduce((value, key) => value?.[key], object);
async function project(documents, name = 'fixture.screen_a') {
  const context = await buildScopedEditContext({ documents });
  const record = context.catalog.recordsById[context.catalog.symbols[name].winnerId];
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id });
  assert(projection.ok); return { context, record, projection };
}
async function input(targetMode) {
  const state = await project(scoped20Documents), selected = scoped20Cases.find(x => x.id === 'close-image');
  const source = state.projection.nodeSources[selected.effectivePointer];
  return { ...state, operation: { type: 'planEdit', intendedType: 'move', scope: 'screen', targetMode,
    path: state.context.internalPath(source), pointer: source.pointer, effectivePointer: selected.effectivePointer,
    screen: { path: state.context.internalPath(state.record), pointer: '/' + state.record.rawKey }, delta: [7, 4] } };
}

test('実ソース由来: close画像は三つの共用元を保持して選択配置だけ分離し、gridと混同しない', async () => {
  const { context, projection, operation } = await input('visual');
  const original = structuredClone(scoped20Documents);
  const result = await editWorkspaceScoped({ documents: scoped20Documents, context, operation });
  assert(result.ok); const plan = result.editPlan;
  assert.equal(plan.generated, null);
  assert.equal(plan.sharedSourceInstances, 3);
  assert.equal(plan.instanceIsolation, 'single-placement');
  assert.equal(plan.affectedInstances, 1);
  assert.equal(plan.requiresTemplateConsent, false);
  assert.deepEqual(plan.affectedEffectivePointers, [operation.effectivePointer]);
  assert.deepEqual(scoped20Documents, original, '計画だけでは元の文書を変更しない');
  const moved = await editWorkspaceScoped({ documents: scoped20Documents, context, operation: { ...operation, type: 'move' } });
  assert(moved.ok, JSON.stringify(moved));
  const after = (await project(moved.documents)).projection.document;
  const expected = structuredClone(projection.document);
  at(expected, operation.effectivePointer).offset = [7, 4];
  assert.deepEqual(JSON.parse(JSON.stringify(after)), expected, '選択状態以外の表示内容を変えない');
  assert.deepEqual(scoped20Documents, original, '編集結果は別文書として返し、入力を変更しない');
});

test('実ソース由来: 明示テンプレート計画は従来通り三つの状態への共有適用を示す', async () => {
  const { context, projection, operation } = await input('visual');
  const result = await editWorkspaceScoped({ documents: scoped20Documents, context, operation: { ...operation, generatedScope: 'template' } });
  assert(result.ok, JSON.stringify(result));
  assert.equal(result.editPlan.affectedInstances, 3);
  assert.equal(result.editPlan.generated, null);
  assert.equal(result.editPlan.affectedEffectivePointers.length, 3);
  for (const pointer of result.editPlan.affectedEffectivePointers) {
    assert.equal(projection.nodeSources[pointer].pointer, operation.pointer);
  }
});

test('実ソース由来: 操作全体のcloseボタンは同意なしで単体移動でき、別UIは保持する', async () => {
  const { context, projection, operation } = await input('interaction');
  const beforeOther = (await project(scoped20Documents, 'fixture.screen_b')).projection.document;
  const planned = await editWorkspaceScoped({ documents: scoped20Documents, context, operation });
  assert(planned.ok); const plan = planned.editPlan;
  assert.equal(plan.generated, null); assert.equal(plan.target.type, 'button'); assert.equal(plan.affectedInstances, 1); assert.equal(plan.requiresTemplateConsent, false);
  assert.deepEqual(plan.affectedEffectivePointers, [plan.target.effectivePointer]);
  const result = await editWorkspaceScoped({ documents: scoped20Documents, context, operation: { ...operation, type: 'move' } });
  assert(result.ok, JSON.stringify(result));
  const after = (await project(result.documents)).projection.document;
  const expected = structuredClone(projection.document), owner = at(expected, plan.target.effectivePointer);
  owner.offset = owner.offset.map((value, index) => value + [7, 4][index]);
  assert.deepEqual(JSON.parse(JSON.stringify(after)), expected);
  assert.deepEqual((await project(result.documents, 'fixture.screen_b')).projection.document, beforeOther);
});

test('実ソース由来: 明示同意した共有画像は説明した三つの部品だけへ移動を反映する', async () => {
  const { context, operation } = await input('visual');
  const result = await editWorkspaceScoped({ documents: scoped20Documents, context, operation: { ...operation, type: 'move', generatedScope: 'template' } });
  assert(result.ok, JSON.stringify(result));
  const after = (await project(result.documents)).projection.document;
  for (const pointer of result.editPlan.affectedEffectivePointers) assert.deepEqual(at(after, pointer).offset, [7, 4]);
  assert.equal(at(after, '/screen_a/controls/0/close').type, 'button');
  assert.deepEqual(at(after, '/screen_a/controls/0/close').offset, [-2, 2]);
});
