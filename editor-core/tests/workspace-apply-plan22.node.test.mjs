import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const target = process.env.JSONUI_APPLY_TEST_PRODUCT;
const load = file => import(target ? pathToFileURL(path.join(target, 'editor-core/src/ui', file)).href : new URL('../src/ui/' + file, import.meta.url));
const { createWorkspaceEditIntent, renderWorkspaceEditPlan } = await load('workspace-edit-intent.js');
const { createWorkspaceEditor } = await load('workspace-editor.js');
const selected = () => ({ fileId: 'anvil', previewDefinitionId: 'anvil.main', nodeId: 'root/close/default/image',
  path: 'ui/common.json', sourceId: 'base', pointer: '/close_panel/controls/0/image',
  effectivePointer: '/main/controls/0/close/controls/0/default/controls/0/image',
  screen: { path: 'ui/anvil.json', sourceId: 'base', pointer: '/main' } });
const stateFixture = () => ({ workspaceId: 'w', revision: 'r0', busy: false, activePath: 'ui/common.json', activeSourceId: 'base',
  selectedPointer: '/close_panel/controls/0/image', previewSelection: selected(), editTargetMode: 'visual', editScope: 'screen', editGeneratedTemplate: false });
const planFixture = (extra = {}) => ({ scope: 'screen', targetMode: 'visual', target: { path: 'ui/common.json', sourceId: 'base', pointer: selected().pointer,
  effectivePointer: selected().effectivePointer, type: 'image' }, selected: { effectivePointer: selected().effectivePointer },
  affectedInstances: 3, affectedEffectivePointers: ['default', 'hover', 'pressed'], generated: null, requiresTemplateConsent: true, ...extra });
const reply = plan => ({ ok: true, revision: 'r0', editPlan: plan });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('未計画の共有画像は初回ドラッグ時に範囲を調べ、同意なし操作をキューへ入れない', async () => {
  const state = stateFixture(), reads = [], queue = [];
  const intent = createWorkspaceEditIntent({ state, request: async (...args) => { reads.push(args); return reply(planFixture()); }, notify() {} });
  await assert.rejects(intent.enqueue({ type: 'move', delta: [4, 5] }, op => queue.push(op)), { code: 'WORKSPACE_GENERATED_SCOPE_REQUIRED' });
  assert.equal(reads.length, 1); assert.equal(queue.length, 0); assert.equal(state.editPlan.affectedInstances, 3);
  intent.setGeneratedTemplate(true);
  await intent.enqueue({ type: 'move', delta: [4, 5] }, op => queue.push(op));
  assert.equal(reads.length, 1); assert.equal(queue[0].generatedScope, 'template');
});

test('計画が返る前に離したドラッグは未計画で保存せず、取得済み通信を待つ', async () => {
  const state = stateFixture(), wait = deferred(), queued = [];
  let reads = 0;
  const intent = createWorkspaceEditIntent({ state, request: () => { reads++; return wait.promise; }, notify() {} });
  const planning = intent.plan(); const enqueue = intent.enqueue({ type: 'move', delta: [2, 3] }, op => queued.push(op));
  await Promise.resolve(); assert.equal(queued.length, 0); assert.equal(reads, 1);
  wait.resolve(reply(planFixture({ generated: null, affectedInstances: 1, requiresTemplateConsent: false })));
  await planning; await enqueue; assert.equal(queued.length, 1); assert.equal(reads, 1);
});

test('移動と同じvisual対象への表示属性・連続移動は計画を再取得しない', async () => {
  const state = stateFixture(); let reads = 0;
  const intent = createWorkspaceEditIntent({ state, request: async () => { reads++; return reply(planFixture({ affectedInstances: 1, requiresTemplateConsent: false })); }, notify() {} });
  const edit = async () => ({ ok: true });
  await intent.enqueue({ type: 'move', delta: [1, 2] }, edit);
  await intent.enqueue({ type: 'set', property: 'alpha', value: 0.4 }, edit);
  await intent.enqueue({ type: 'move', delta: [3, 4] }, edit);
  assert.equal(reads, 1);
});

test('計画待ち中に別要素へ選択が変わると古い移動をキューへ保存しない', async () => {
  const state = stateFixture(), wait = deferred(), queued = [];
  const intent = createWorkspaceEditIntent({ state, request: () => wait.promise, notify() {} });
  const pending = intent.enqueue({ type: 'move', delta: [1, 2] }, op => queued.push(op));
  const rejected = assert.rejects(pending, { code: 'WORKSPACE_SELECTION_SUPERSEDED' });
  state.previewSelection = { ...state.previewSelection, nodeId: 'another' }; intent.invalidate();
  wait.resolve(reply(planFixture({ affectedInstances: 1, requiresTemplateConsent: false })));
  await rejected; assert.equal(queued.length, 0);
});

test('interactionの単体ボタン計画を画像属性へ流用せず共有画像同意を別に確認する', async () => {
  const state = { ...stateFixture(), editTargetMode: 'interaction' }, queued = []; let reads = 0;
  const intent = createWorkspaceEditIntent({ state, request: async (_route, { operation }) => {
    reads++; return reply(planFixture(operation.targetMode === 'interaction' ? { targetMode: 'interaction', generated: null, affectedInstances: 1, requiresTemplateConsent: false } : {}));
  }, notify() {} });
  await intent.enqueue({ type: 'move', delta: [1, 2] }, op => queued.push(op));
  await assert.rejects(intent.enqueue({ type: 'set', property: 'alpha', value: 0.5 }, op => queued.push(op)), { code: 'WORKSPACE_GENERATED_SCOPE_REQUIRED' });
  assert.equal(reads, 2); assert.equal(queued.length, 1);
});

test('controllerは計画の正しい変更先IDだけをpendingへ渡し、未解決対象では拒否する', async () => {
  const state = stateFixture(); let resolvable = true, receivedPlan;
  const controller = createWorkspaceEditor({ request: async () => reply(planFixture({ affectedInstances: 1, requiresTemplateConsent: false })),
    resolvePreviewEditTargets(selection, plan) { assert.equal(selection.nodeId, state.previewSelection.nodeId); receivedPlan = plan; return resolvable ? ['root/close'] : []; } });
  Object.assign(controller.state, state, { sources: [{ id: 'base', kind: 'imported' }], files: [{ path: state.activePath, sourceId: 'base', sourceKind: 'imported' }] });
  await controller.movePreviewElement([3, 4]); assert(receivedPlan); assert.deepEqual(controller.state.pendingOperations[0].previewNodeIds, ['root/close']);
  resolvable = false;
  await assert.rejects(controller.movePreviewElement([2, 1]), { code: 'WORKSPACE_PREVIEW_TARGET_UNRESOLVED' }); assert.equal(controller.pendingCount, 1);
});

test('共有画像は生成gridと区別し、単体ボタンの移動対象を説明する', () => {
  const h = (tag, attrs, children = []) => ({ tag, attrs, children });
  const text = node => typeof node === 'object' ? (node?.children || []).map(text).join(' ') : String(node);
  const rendered = renderWorkspaceEditPlan(h, { controller: { state: { ...stateFixture(), editPlan: planFixture() } } });
  assert.match(text(rendered), /通常・ホバー/); assert.match(text(rendered), /ボタン一つ/); assert.doesNotMatch(text(rendered), /この 1 枠だけ/);
});

test('計画待ち中のプレビューモード切替と編集への復帰で、古いドラッグを保存しない', async () => {
  const state = { ...stateFixture(), mode: 'edit' }, wait = deferred();
  const controller = createWorkspaceEditor({ request: () => wait.promise });
  Object.assign(controller.state, state, { sources: [{ id: 'base', kind: 'imported' }], files: [{ path: state.activePath, sourceId: 'base', sourceKind: 'imported' }] });
  const pending = controller.movePreviewElement([3, 4]);
  const rejected = assert.rejects(pending, { code: 'WORKSPACE_SELECTION_SUPERSEDED' });
  controller.setMode('preview'); controller.setMode('edit');
  wait.resolve(reply(planFixture({ affectedInstances: 1, requiresTemplateConsent: false })));
  await rejected; assert.equal(controller.pendingCount, 0); assert.equal(controller.state.editPlan, null);
});

test('同じ件数でも対象pointerが変わった共用計画には以前の同意を再利用しない', async () => {
  const state = stateFixture(); let plan = planFixture();
  const intent = createWorkspaceEditIntent({ state, request: async () => reply(plan), notify() {} });
  await intent.plan(); intent.setGeneratedTemplate(true); assert(state.editGeneratedTemplate);
  plan = { ...plan, affectedEffectivePointers: ['new-default', 'new-hover', 'new-pressed'] };
  intent.invalidate({ keepConsent: true });
  await intent.plan(); assert.equal(state.editGeneratedTemplate, false);
  await assert.rejects(intent.enqueue({ type: 'move', delta: [1, 2] }, () => assert.fail('未同意で保存しない')), { code: 'WORKSPACE_GENERATED_SCOPE_REQUIRED' });
});
