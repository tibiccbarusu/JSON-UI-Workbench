import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScopedEditContext, editWorkspaceScoped } from '../workspace-scoped-edit.mjs';
import { editWorkspaceBatch } from '../workspace-batch.mjs';
import { placementRoute } from '../workspace-placement-route.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { pointerParts, pointerJoin } from '../workspace-jsonc.mjs';
import { scoped20Documents, scoped20Cases } from './workspace-scoped20-fixtures.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
function normalizeRefs(value, names, key = '') {
  if (typeof value === 'string') return key.startsWith('$') && names.has(value) ? names.get(value) : value;
  if (Array.isArray(value)) return value.map(item => normalizeRefs(item, names, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeRefs(child, names, key)]));
}
const at = (value, pointer) => pointerParts(pointer).reduce((item, key) => item?.[key], value);
async function project(documents, symbol = 'fixture.screen_a') {
  const context = await buildScopedEditContext({ documents });
  const record = context.catalog.recordsById[context.catalog.symbols[symbol].winnerId];
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id });
  assert.equal(projection.ok, true, JSON.stringify(projection.error));
  return { context, record, projection };
}
function operation(before, pointer, extra = {}) {
  const source = before.projection.nodeSources[pointer];
  assert(source);
  return { type: 'move', scope: 'screen', targetMode: 'visual',
    path: before.context.internalPath(source), pointer: source.pointer, effectivePointer: pointer,
    screen: { path: before.context.internalPath(before.record), pointer: pointerJoin([before.record.rawKey]) },
    delta: [11, 7], ...extra };
}
async function apply(documents, before, pointer, extra = {}) {
  return editWorkspaceScoped({ documents, context: before.context, expectedRevision: before.context.revision,
    operation: operation(before, pointer, extra) });
}

for (const fixture of scoped20Cases) test(`R28 ${fixture.id}: visual配置を個別化し原文・別画面・兄弟を保持`, async () => {
  const documents = scoped20Documents, original = JSON.stringify(documents);
  const before = await project(documents, fixture.screen);
  const pointer = fixture.effectivePointer;
  const result = await apply(documents, before, pointer);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.editPlan.requiresTemplateConsent, false);
  assert.equal(result.editPlan.affectedInstances, 1);
  const after = await project(result.documents, fixture.screen);
  const expected = plain(before.projection.document);
  at(expected, pointer).offset = [11, 7];
  assert.deepEqual(normalizeRefs(plain(after.projection.document), new Map(result.editPlan.clonedDefinitions.map(item => [item.qualifiedName, item.original]))), expected, '選択した表示要素以外の属性・子供・兄弟を変更しない');
  assert.deepEqual(plain((await project(result.documents, 'fixture.screen_b')).projection.document),
    plain((await project(documents, 'fixture.screen_b')).projection.document));
  assert.equal(JSON.stringify(documents), original);
});

test('R28 planEdit: 個別化の影響を報告するが原文を保存しない', async () => {
  const before = await project(scoped20Documents), p = scoped20Cases[0].effectivePointer;
  const result = await apply(scoped20Documents, before, p, { type: 'planEdit', intendedType: 'move' });
  assert.equal(result.ok, true); assert.equal(result.documents, undefined);
  assert.equal(result.revision, before.context.revision);
  assert.equal(result.editPlan.instanceIsolation, 'single-placement');
  assert.equal(result.editPlan.sharedSourceInstances, 3);
  assert.deepEqual(result.editPlan.affectedEffectivePointers, [p]);
});

test('R28 template明示: 既存の共有変更契約を保持', async () => {
  const before = await project(scoped20Documents), p = scoped20Cases[0].effectivePointer;
  const result = await apply(scoped20Documents, before, p, { generatedScope: 'template' });
  assert.equal(result.ok, true); assert.equal(result.editPlan.affectedInstances, 3);
  const after = (await project(result.documents)).projection.document;
  for (const pointer of result.editPlan.affectedEffectivePointers) assert.deepEqual(at(after, pointer).offset, [11, 7]);
});

test('R28 batch: 通常・hover・再度通常を別々に移動してsource再対応付け', async () => {
  const before = await project(scoped20Documents), first = scoped20Cases[0].effectivePointer;
  const second = first.replace('/0/default/', '/1/hover/');
  const operations = [operation(before, first), operation(before, second, { delta: [20, 30] }),
    operation(before, first, { delta: [1, 2] })];
  const result = await editWorkspaceBatch({ documents: scoped20Documents, expectedRevision: before.context.revision,
    operation: { type: 'batch', operations } });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const after = (await project(result.documents)).projection.document;
  assert.deepEqual(at(after, first).offset, [12, 9]);
  assert.deepEqual(at(after, second).offset, [20, 30]);
  assert.equal(at(after, first.replace('/0/default/', '/2/pressed/')).offset, undefined);
  assert.equal(result.batch.appliedCount, 3);
});

test('R28 配置ごとに異なる親の静的offsetを一つに潰さない', async () => {
  const documents = { 'ui/a.json': JSON.stringify({ namespace: 'a',
    base: { type: 'panel', controls: [{ image: { type: 'image', offset: '$pos' } }] },
    screen: { type: 'screen', controls: [ { 'first@a.base': { '$pos': [1, 2] } }, { 'second@a.base': { '$pos': [50, 60] } } ] } }) };
  const before = await project(documents, 'a.screen'), p = '/screen/controls/0/first/controls/0/image';
  const result = await apply(documents, before, p);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const after = (await project(result.documents, 'a.screen')).projection.document;
  assert.deepEqual(at(after, p).offset, [12, 9]);
  assert.deepEqual(after.screen.controls[1].second.controls[0].image.offset, [50, 60]);
});

test('R28 無効な後続操作は個別化を含めて原子的に取り消す', async () => {
  const before = await project(scoped20Documents), p = scoped20Cases[0].effectivePointer;
  const result = await editWorkspaceBatch({ documents: scoped20Documents, expectedRevision: before.context.revision,
    operation: { type: 'batch', operations: [operation(before, p), operation(before, p, { delta: [Infinity, 2] })] } });
  assert.equal(result.ok, false); assert.equal(result.documents, undefined); assert.equal(result.batch.appliedCount, 0);
});

test('R28 生成祖先・未知選択は配置分離から除外', () => {
  const inherited = { nodeSources: { '/screen': {}, '/screen/child': { generated: 'grid' }, '/screen/child/image': {} } };
  assert.equal(placementRoute(inherited, '/screen/child/image'), null);
  assert.equal(placementRoute(inherited, '/missing'), null);
  const simple = { document: {}, nodeSources: { '/screen': {}, '/screen/a': {}, '/screen/b': {} } };
  const route = placementRoute(simple, '/screen/a');
  assert.deepEqual(Object.keys(route.nodeSources), ['/screen/a', '/screen']);
  assert.equal(route.document, simple.document); assert.notEqual(route.nodeSources, simple.nodeSources);
});
