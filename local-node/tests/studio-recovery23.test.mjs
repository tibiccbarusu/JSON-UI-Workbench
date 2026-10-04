import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { createWorkspaceEditor } from '../../editor-core/src/ui/workspace-editor.js';
import * as shell from '../../editor-core/src/ui/studio-shell.js';
import { createLocalServer } from '../server.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const main = await readFile(new URL('../../editor-core/src/main.js', import.meta.url), 'utf8');
function part(start, end) { const a = main.indexOf(start), b = main.indexOf(end, a); assert(a >= 0 && b > a); return main.slice(a, b); }
function harness(controller) {
  const effects = [], state = { files: { currentFileId: 'f', byId: { f: { id: 'f' } } } };
  const canvasStates = new Map();
  const getCanvasState = key => {
    if (!canvasStates.has(key)) canvasStates.set(key, { pendingAdditionSelection23: null });
    return canvasStates.get(key);
  };
  const h = (tag, attrs, children = []) => ({ tag, attrs, children: children.flat().filter(Boolean),
    style: {}, getBoundingClientRect: () => ({ width: 262, height: 390 }), querySelector: () => null });
  const context = vm.createContext({ ...shell, h, sourceWorkspace: controller,
    getCanvasKey: id => String(id), getCanvasState,
    sourceWorkspaceDraft23: { getStatus: () => ({ status: 'idle' }), flush() { effects.push('draft'); } },
    studioUi: { tab: 'diagnostics', details: {} }, importedPackRuntime: {}, vanillaReferenceRuntime: null,
    siteText: value => value, safeRender() { effects.push('render'); }, downloadCompleteDebugBundle() {},
    studioInvoke: action => { context.action = Promise.resolve().then(action); },
    document: { getElementById: id => find(context.root, id), querySelectorAll: () => [] },
    store: { getState: () => state }, syncStudioRuntimeControls21() {}, studioSetTab() {},
    window: { innerWidth: 1000, innerHeight: 800 }, closeStudioContextMenu21() {},
    studioSelection21: () => ({ snapshot: () => ({ canGroup: false, canUngroup: false }) }),
    studioGroupSelection21() {}, studioUngroupSelection21() {},
  });
  context.document.body = { append: (...nodes) => { context.menu = nodes.at(-1); } };
  vm.runInContext(part('function updateStudioPendingUi()', '\nfunction renderEditor(')
    + part('function workspaceDraftSnapshot23()', '\nconst sourceWorkspaceDraft23 =')
    + part('function studioDraftScene23(', '\n// UI のファイルタブ')
    + part('function openStudioContextMenu21(', '\nfunction studioInvoke('), context);
  function find(node, id) {
    if (node?.attrs?.id === id) return node;
    for (const child of node?.children || []) { const found = find(child, id); if (found) return found; }
    return null;
  }
  const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
  return { context, state, effects, render() { context.root = context.renderStudioRibbon(state); return context.root; },
    byId: id => find(context.root, id), text: () => text(context.root),
    async click(id) { const node = find(context.root, id); assert(node); assert.equal(Boolean(node.attrs.disabled), false, id); node.attrs.onClick(); await context.action; },
  };
}

async function fixture({ committed = true, rejectRefresh = false } = {}) {
  let revision = 'before', value = 0, commits = 0, seen = [];
  const status = () => ({ ok: true, workspaceId: 'w', revision, files: [{ path: 'ui/demo.json', sourceId: 'p' }], sources: [{ id: 'p', kind: 'imported' }] });
  const controller = createWorkspaceEditor({ request: async route => {
    if (route === 'edit') { commits++; if (committed) { revision = 'after'; value = 5; } throw new Error('RESPONSE_LOST'); }
    if (route === 'status' && rejectRefresh) throw new Error('STATUS_UNAVAILABLE');
    return status();
  }, onCommit: async () => seen.push(value) });
  await controller.ensure([{ id: 'p', kind: 'imported' }], 'stack');
  controller.queueOperations([{ type: 'set', path: 'ui/demo.json', sourceId: 'p', pointer: '/screen/offset', value: [5, 0] }]);
  return { controller, seen, get commits() { return commits; }, get value() { return value; } };
}

for (const committed of [false, true]) test(`実リボン: 確定応答欠落（Node確定=${committed}）を草稿保持で確認し、再送せず明示破棄へ進める`, async () => {
  const f = await fixture({ committed }), ui = harness(f.controller); await assert.rejects(f.controller.applyPending()); ui.render();
  assert(ui.byId('studio-check-committed')); assert.equal(ui.byId('studio-refresh').attrs.disabled, false);
  for (const id of ['studio-apply-pending', 'studio-undo', 'studio-redo', 'studio-recalculate-draft']) assert.equal(ui.byId(id).attrs.disabled, true, id);
  assert.match(ui.text(), /確定済みの変更の取り消しではありません/u);
  const before = JSON.stringify(f.controller.state.pendingOperations);
  await ui.click('studio-check-committed'); ui.render();
  assert.equal(JSON.stringify(f.controller.state.pendingOperations), before); assert.equal(f.controller.state.pendingCommitUncertain, true);
  assert.deepEqual(f.seen, [committed ? 5 : 0]); assert.equal(f.commits, 1);
  assert.equal(ui.context.workspaceDraftSnapshot23(), null, '再取得した確定内容へ旧草稿を投影しない');
  assert.equal(ui.context.studioDraftScene23({ workspaceDraftScene23: {} }, ui.state.files.byId.f), null);
  assert.equal(f.controller.pendingNodeTransforms('f').size, 0);
  await assert.rejects(f.controller.applyPending(), { code: 'WORKSPACE_PENDING_COMMIT_UNCERTAIN' });
  await ui.click('studio-discard-pending'); ui.render();
  assert.equal(f.controller.pendingCount, 0); assert.equal(f.controller.previewBlocked(), false);
  assert.equal(f.value, committed ? 5 : 0); assert.equal(f.commits, 1); assert.equal(ui.byId('studio-commit-recovery'), null);
});

test('再確認失敗時も草稿と再送禁止を保持し、正常pending時は再確認を無効にする', async () => {
  const f = await fixture({ rejectRefresh: true }), ui = harness(f.controller); ui.render();
  assert.equal(ui.byId('studio-refresh').attrs.disabled, true); assert.equal(ui.byId('studio-check-committed'), null);
  await assert.rejects(f.controller.export(), error => /JSON UIに確定/u.test(error.message) && /未確定の変更を破棄/u.test(error.message));
  assert.match(f.controller.state.message, /草稿プレビューへ反映/u); assert.doesNotMatch(f.controller.state.message, /まとめて再計算/u);
  await assert.rejects(f.controller.applyPending()); ui.render();
  await assert.rejects(ui.click('studio-check-committed'), /STATUS_UNAVAILABLE/u); ui.render();
  assert.equal(f.controller.pendingCount, 1); assert.equal(f.controller.state.pendingCommitUncertain, true);
  assert.equal(ui.byId('studio-check-committed').attrs.disabled, false); assert.equal(ui.byId('studio-apply-pending').attrs.disabled, true);
  assert.equal(f.commits, 1);
});

test('確定内容の競合も再確認へ到達し、動的pending更新で再送ボタンを有効化しない', async () => {
  const f = await fixture(), ui = harness(f.controller);
  f.controller.state.pendingConflict = true; ui.render(); assert(ui.byId('studio-check-committed'));
  for (const id of ['studio-apply-pending', 'studio-undo', 'studio-redo', 'studio-discard-pending', 'studio-recalculate-draft', 'studio-pending-status']) {
    const node = ui.byId(id); if (node) { node.disabled = false; node.classList = { toggle() {} }; }
  }
  ui.context.updateStudioPendingUi();
  for (const id of ['studio-apply-pending', 'studio-undo', 'studio-redo', 'studio-recalculate-draft']) assert.equal(ui.byId(id).disabled, true);
  assert.equal(ui.byId('studio-discard-pending').disabled, false);
});

test('右クリックの確定操作も同じ名前を使い、処理中・結果不明・競合・未同期では押せない', async () => {
  const f = await fixture(), ui = harness(f.controller); f.controller.setMode('edit');
  const commitButton = () => {
    ui.context.openStudioContextMenu21({ clientX: 10, clientY: 10 }, ui.state.files.byId.f, null);
    const buttons = ui.context.menu.children.filter(node => node?.tag === 'button');
    assert.equal(buttons.some(node => node.children[0] === '変更を反映'), false);
    return buttons.find(node => node.children[0] === 'JSON UIに確定');
  };
  assert.equal(commitButton().attrs.disabled, false);
  for (const key of ['busy', 'pendingCommitUncertain', 'pendingConflict', 'projectionError']) {
    f.controller.state[key] = true; assert.equal(commitButton().attrs.disabled, true, key); f.controller.state[key] = false;
  }
  await assert.rejects(f.controller.applyPending()); assert.equal(commitButton().attrs.disabled, true);
  assert.equal(f.commits, 1);
});

test('実HTTP: 確定済み応答を失ってもリボン再確認で最新原文を取得し旧草稿の再POST/undoを行わない', { timeout: 30000 }, async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`, cap = await (await fetch(base + 'capabilities')).json(), id = randomUUID();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' };
  const document = { namespace: 'recovery', screen: { type: 'screen', size: [32, 32], offset: [0, 0] } };
  const imported = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id, 'X-JSONUI-Name': 'recovery.zip' },
    body: makeZip({ 'manifest.json': manifest, 'ui/demo.json': JSON.stringify(document), 'ui/_ui_defs.json': '{"ui_defs":["ui/demo.json"]}' }) });
  assert.equal(imported.status, 200); await imported.arrayBuffer();
  let posts = 0; const observed = [];
  const controller = createWorkspaceEditor({ request: async (route, payload, options = {}) => {
    const response = await fetch(base + 'workspace-' + route, { method: 'POST', headers, body: JSON.stringify(payload), signal: options.signal });
    const result = await response.json(); assert.equal(response.ok, true, JSON.stringify(result));
    if (route === 'edit') { posts++; throw new Error('COMMITTED_RESPONSE_LOST'); }
    return result;
  }, onCommit: async () => observed.push(JSON.parse(controller.getDocument('ui/demo.json', id).text).screen.offset) });
  await controller.ensure([{ id, kind: 'imported' }], 'stack'); await controller.readDocument('ui/demo.json', { sourceId: id });
  controller.queueOperations([{ type: 'set', path: 'ui/demo.json', sourceId: id, pointer: '/screen/offset', value: [5, 7] }]);
  const beforeRevision = controller.state.revision; await assert.rejects(controller.applyPending(), /COMMITTED_RESPONSE_LOST/u);
  const ui = harness(controller); ui.render(); await ui.click('studio-check-committed'); ui.render();
  assert.notEqual(controller.state.revision, beforeRevision); assert.deepEqual(observed, [[5, 7]]);
  assert.equal(controller.pendingCount, 1); assert.equal(controller.state.pendingCommitUncertain, true); assert.equal(ui.context.workspaceDraftSnapshot23(), null);
  await ui.click('studio-discard-pending');
  assert.deepEqual(JSON.parse(controller.getDocument('ui/demo.json', id).text).screen.offset, [5, 7]);
  assert.equal(posts, 1); assert.equal(controller.pendingCount, 0); assert.equal(controller.previewBlocked(), false);
});
