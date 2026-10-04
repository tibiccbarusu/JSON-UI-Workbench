/** 独立レビュー用。作者のテストを複写せず、キャッシュ衝突と確定境界の反例を作る。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceSessions } from '../workspace-session.mjs';
import { WorkspaceDraftProjector } from '../workspace-draft-preview.mjs';

const path = 'ui/cache-independent.json';
async function fixture(document = { namespace: 'a', screen: { type: 'screen', size: [100, 100], controls: [] } }) {
  const original = JSON.stringify(document), pack = { rootPrefix: '', packPaths: [path], zipReader: { readText: async () => original } };
  const manager = new WorkspaceSessions({ getPack: () => pack, checkSources: sources => sources, invalidate: () => {} });
  const state = await manager.open({ sources: [{ id: 'pack', kind: 'imported' }] });
  const input = operation => ({ workspaceId: state.workspaceId, expectedRevision: state.revision, pendingVersion: 1,
    screen: { path, pointer: '/screen' }, operation: { type: 'batch', operations: [operation] } });
  return { manager, state, original, pack, input };
}

test('原文value内のcontrols対応表の順序をキー正規化で同一視しない', async () => {
  const { manager, state, input, original } = await fixture();
  const first = { one: { type: 'panel', size: [10, 10] }, two: { type: 'panel', size: [10, 10] } };
  const second = { two: first.two, one: first.one };
  const operation = value => ({ type: 'set', path, pointer: '/screen/controls', value });
  const initial = await manager.previewDraft(input(operation(first)));
  assert.equal(initial.ok, true, JSON.stringify(initial));
  const changed = await manager.previewDraft({ ...input(operation(second)), pendingVersion: 2 });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.equal(changed.batch.validationCache, 'miss');
  assert.deepEqual(Object.keys(JSON.parse(changed.documentTexts.pack[path]).screen.controls), ['two', 'one']);
  assert.equal(manager.get(state.workspaceId).documents[path], original);
  const committed = await manager.edit(input(operation(second)));
  assert.equal(committed.batch.validationCache, 'hit');
  assert.deepEqual(Object.keys(JSON.parse(manager.get(state.workspaceId).documents[path]).screen.controls), ['two', 'one']);
});

const frame = { preset: { width: 100, height: 100 }, generation: 1, animationTime: 0, visibilityMode: 'safe' };
test('投影変数内のcontrols対応表の順序変更は新たな投影を作る', async () => {
  const { manager, input, pack } = await fixture({ namespace: 'a', screen: { type: 'screen', size: [100, 100], controls: '$children' } });
  const draft = await manager.previewDraft(input({ type: 'set', path, pointer: '/screen/alpha', value: 1 }));
  assert.equal(draft.ok, true, JSON.stringify(draft));
  const projector = new WorkspaceDraftProjector();
  const first = { one: { type: 'panel', size: [10, 10] }, two: { type: 'panel', size: [10, 10] } };
  const second = { two: first.two, one: first.one };
  const initial = await projector.project({ draft, getPack: () => pack, variables: { $children: first }, frame });
  const changed = await projector.project({ draft, getPack: () => pack, variables: { $children: second }, frame });
  assert.equal(changed.metrics.projectionCache, 'miss');
  const names = output => { const controls = output.projection.document.screen.controls; return Array.isArray(controls) ? controls.map(wrapper => Object.keys(wrapper)[0]) : Object.keys(controls); };
  assert.deepEqual(names(initial), ['one', 'two']); assert.deepEqual(names(changed), ['two', 'one']);
});

test('cache hit確定でも応答上限検査を通り、拒否時の原文・履歴を保存する', async () => {
  const { LIMITS } = await import('../limits.mjs');
  const { manager, state, input, original } = await fixture();
  const request = input({ type: 'set', path, pointer: '/screen/offset', value: [20, 10] });
  await manager.previewDraft(request);
  const before = manager.snapshot(), describe = manager.describe.bind(manager);
  manager.describe = workspace => ({ ...describe(workspace), independentPadding: 'x'.repeat(LIMITS.replyBytes) });
  await assert.rejects(manager.edit(request), { code: 'NODE_REPLY_LIMIT' });
  assert.equal(manager.snapshot().hits, before.hits + 1, '検査済みdraftのcache hitを実際に通る');
  assert.equal(manager.get(state.workspaceId).documents[path], original);
  assert.equal(manager.get(state.workspaceId).revision, state.revision);
  assert.equal(manager.get(state.workspaceId).undo.length, 0); assert.equal(manager.get(state.workspaceId).redo.length, 0);
  manager.describe = describe;
  const committed = await manager.edit(request), committedText = manager.get(state.workspaceId).documents[path];
  assert.equal(committed.batch.validationCache, 'hit');
  const undone = manager.history({ workspaceId: state.workspaceId, expectedRevision: committed.revision }, 'undo');
  assert.equal(manager.get(state.workspaceId).documents[path], original);
  const redone = manager.history({ workspaceId: state.workspaceId, expectedRevision: undone.revision }, 'redo');
  assert.equal(manager.get(state.workspaceId).documents[path], committedText); assert.equal(redone.revision, committed.revision);
  assert.throws(() => manager.edit(request), { code: 'WORKSPACE_REVISION_CONFLICT' });
});

test('frameの時刻/寸法/状態が変わるたび、投影hitでも新フレームを計算する', async () => {
  const { manager, input, pack } = await fixture({ namespace: 'a', slide: { anim_type: 'offset', from: [0, 0], to: [20, 0], duration: 1 },
    screen: { type: 'screen', size: ['100%', '100%'], controls: [{ box: { type: 'panel', size: [10, 10], anims: ['@a.slide'],
      bindings: [{ binding_name: '#shown', binding_name_override: '#visible' }] } }] } });
  const draft = await manager.previewDraft(input({ type: 'set', path, pointer: '/screen/alpha', value: 1 }));
  const projector = new WorkspaceDraftProjector();
  const initial = await projector.project({ draft, getPack: () => pack, frame: { ...frame, mockData: { '#shown': true } } });
  for (const scenario of [{ ...frame, animationTime: 0.75, mockData: { '#shown': true } },
    { ...frame, preset: { width: 200, height: 150 }, mockData: { '#shown': true } },
    { ...frame, mockData: { '#shown': false } }]) {
    const reused = await projector.project({ draft, getPack: () => pack, frame: scenario });
    const fresh = await new WorkspaceDraftProjector().project({ draft, getPack: () => pack, frame: scenario });
    assert.equal(reused.metrics.projectionCache, 'hit');
    assert.deepEqual(reused.frame.layout.boxes, fresh.frame.layout.boxes, '未使用cacheの同じフレームと比較');
    assert.notDeepEqual(reused.frame.layout.boxes, initial.frame.layout.boxes, '初回フレームを再送していない');
  }
});

test('同じ物理path/pointerでもパック所有者の異なる編集を使い回さない', async () => {
  const lower = JSON.stringify({ namespace: 'a', screen: { type: 'screen', alpha: 0.2 } });
  const upper = JSON.stringify({ namespace: 'a', screen: { type: 'screen', alpha: 0.8 } });
  const packs = { lower: { rootPrefix: '', packPaths: [path], zipReader: { readText: async () => lower } },
    upper: { rootPrefix: '', packPaths: [path], zipReader: { readText: async () => upper } } };
  const manager = new WorkspaceSessions({ getPack: id => packs[id], checkSources: value => value, invalidate: () => {} });
  const state = await manager.open({ sources: [{ id: 'lower', kind: 'vanilla' }, { id: 'upper', kind: 'imported' }] });
  const input = sourceId => ({ workspaceId: state.workspaceId, expectedRevision: state.revision, pendingVersion: 1,
    screen: { path, pointer: '/screen', sourceId: 'upper' }, operation: { type: 'batch', operations: [
      { type: 'set', path, pointer: '/screen/alpha', sourceId, value: 0.5 },
    ] } });
  assert.equal((await manager.previewDraft(input('lower'))).batch.validationCache, 'miss');
  const next = await manager.previewDraft(input('upper'));
  assert.equal(next.batch.validationCache, 'miss');
  assert.equal(JSON.parse(next.documentTexts.lower[path]).screen.alpha, 0.2);
  assert.equal(JSON.parse(next.documentTexts.upper[path]).screen.alpha, 0.5);
});
