import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createAppStore, actions } from '../src/state-store/app-store.js';
import { createEditorSelection21 } from '../src/ui/editor-selection21.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { createWorkspaceEditor, findAuthoredNodeForPreview, workspaceRecordSourceId,
  workspacePreviewDefinitionIdentity, matchesWorkspaceDocument, escapeSourcePointer } from '../src/ui/workspace-editor.js';
import { siteText } from '../src/i18n/site-messages.js';

// 実main helperを実store/selection/controllerへ接続する。製品へのexport/hook追加は不要。
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function sourceFunction(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} exists`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} has a top-level boundary`);
  return source.slice(start, end + 2);
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture() {
  const raw = { namespace: 'demo', main: { type: 'screen', controls: [
    { a: { type: 'label', text: 'A' } }, { b: { type: 'label', text: 'B' } }, { c: { type: 'label', text: 'C' } },
  ] } };
  const uiModel = buildUiScreenModelFromJson(raw, { filePath: 'ui/main.json' });
  const nodesById = {}, queue = [uiModel.root];
  for (let i = 0; i < queue.length; i++) { const node = queue[i]; nodesById[node.id] = node; queue.push(...(node.children || [])); }
  const leaves = uiModel.root.children[0].children;
  const ids = Object.fromEntries(leaves.map(node => [node.key.raw, node.id]));
  const nodes = ['a', 'b', 'c'].map(name => ({ path: `ui/${name}.json`, sourceId: 'pack', sourceKind: 'imported', pointer: `/${name}`, parentPointer: '', rawKey: name, props: { type: 'label' } }));
  const nodeSources = Object.fromEntries(nodes.map((node, index) => [`/main/controls/${index}/${node.rawKey}`, { path: node.path, pointer: node.pointer, sourceId: 'pack', sourceKind: 'imported' }]));
  const file = { id: 'preview', path: 'ui/main.json', uiModel, nodesById, rootId: uiModel.root.id,
    meta: { previewProjection: true, selectedDefinition: { rawKey: 'main', definition: 'main', qualifiedName: 'demo.main', sourceId: 'pack', sourceKind: 'imported' }, resolution: { nodeSources } } };
  return { file, ids, nodes };
}
async function harness() {
  const { file, ids, nodes } = fixture(), store = createAppStore(), selection = createEditorSelection21();
  store.dispatch(actions.openFile(file));
  const requests = [], reads = [], errors = [], changes = [];
  const canvasStates = new Map();
  const getCanvasState = key => {
    if (!canvasStates.has(key)) canvasStates.set(key, { pendingAdditionSelection23: null });
    return canvasStates.get(key);
  };
  let redraws = 0;
  const workspace = createWorkspaceEditor({
    onChange: (_state, kind) => changes.push(kind),
    request: async (action, payload) => {
      requests.push({ action, payload });
      if (action === 'open') return { ok: true, workspaceId: 'workspace', revision: 1, nodes,
        files: nodes.map(node => ({ path: node.path, sourceId: 'pack', sourceKind: 'imported' })), sources: [{ id: 'pack', kind: 'imported' }] };
      if (action === 'read') return new Promise(resolve => reads.push({ path: payload.path, resolve }));
      if (action === 'edit' && payload.operation.type === 'planDelete') return { ok: true, impact: [{ pointer: payload.operation.pointer }] };
      throw new Error('UNEXPECTED_WORKSPACE_IO:' + action);
    },
  });
  await workspace.ensure([{ id: 'pack', kind: 'imported' }], 'pack'); workspace.setMode('edit');
  const buttons = Object.fromEntries(['studio-group','studio-ungroup','studio-group-undo','studio-group-redo'].map(id => [id, { disabled: false }]));
  const context = vm.createContext({
    store, actions, editorSelection21: selection, sourceWorkspace: workspace,
    getCanvasKey: id => String(id), getCanvasState,
    findAuthoredNodeForPreview, workspaceRecordSourceId, workspacePreviewDefinitionIdentity, matchesWorkspaceDocument, escapeSourcePointer, siteText,
    importedPackRuntime: { zipReader: { nodePackId: 'pack' }, overridesTextByPackPath: {} }, vanillaReferenceRuntime: null,
    uiCatalogState: { catalog: { recordsById: {} } },
    document: { getElementById: id => buttons[id] || null },
    reportWorkspaceError: error => errors.push(error), requestCanvasTextureRedraw: () => { redraws++; },
  });
  vm.runInContext(`${['workspaceSources', 'workspacePreviewSourceId', 'sourceNodeForPreview', 'studioSelection21',
    'selectSourceForCanvasNode', 'syncStudioSelectionUi21', 'syncStudioSourceSelection21', 'clearStudioSelection21', 'selectPreviewForSource'].map(sourceFunction).join('\n')}
    this.api = { sync: syncStudioSourceSelection21, clear: clearStudioSelection21, reverse: selectPreviewForSource, select: studioSelection21 };`, context);
  const api = context.api;
  const selectedIds = () => api.select(file).snapshot().selectedIds;
  function resolveRead(index) {
    const read = reads[index]; assert(read, `read ${index} exists`);
    read.resolve({ ok: true, sourceId: 'pack', text: JSON.stringify({ namespace: 'demo', [read.path.slice(3, -5)]: { type: 'label' } }), nodes: nodes.filter(node => node.path === read.path) });
  }
  async function choose(name) { api.select(file).select(ids[name], { single: true }); api.sync(file, ids[name]); await flush(); }
  async function finishChoice(name) { const count = reads.length; await choose(name); if (reads.length > count) resolveRead(reads.length - 1); await flush(); }
  return { file, ids, nodes, store, selection, workspace, requests, reads, errors, changes, buttons, api, selectedIds, resolveRead, choose, finishChoice, getCanvasState, redraws: () => redraws };
}
function emptySource(h) {
  assert.equal(h.workspace.state.selectedPointer, ''); assert.equal(h.workspace.state.previewSelection, null); assert.equal(h.workspace.state.deletePlan, null);
}

test('空集合同期は以前のstore・原文・削除予定を消去する', async () => {
  const h = await harness(); await h.finishChoice('a'); await h.workspace.planDelete(); assert(h.workspace.state.deletePlan);
  const reads = h.reads.length; h.api.select(h.file).setSelection([]); h.api.sync(h.file, h.ids.a); await flush();
  assert.deepEqual(h.selectedIds(), []); assert.equal(h.store.getState().editor.selection.nodeId, null); emptySource(h);
  assert.equal(h.reads.length, reads); assert.equal(h.errors.length, 0); assert.equal(h.buttons['studio-group'].disabled, true);
});

test('解除helperは選択集合・store・原文を消去し、遅延readの完了でも復活させない', async () => {
  const h = await harness(); await h.choose('a'); assert.equal(h.reads.length, 1);
  h.api.clear(h.file); h.resolveRead(0); await flush();
  assert.deepEqual(h.selectedIds(), []); assert.equal(h.store.getState().editor.selection.nodeId, null); emptySource(h);
  assert.equal(h.workspace.getDocument('ui/a.json', 'pack'), undefined); assert.equal(h.errors.length, 0);
});

test('単体選択はstoreを直ちに更新し、非同期原文read後に同じ対象を確定する', async () => {
  const h = await harness(); await h.choose('a');
  assert.equal(h.store.getState().editor.selection.nodeId, h.ids.a); assert.equal(h.workspace.state.previewSelection, null);
  assert.equal(h.reads[0].path, 'ui/a.json'); h.resolveRead(0); await flush();
  assert.equal(h.workspace.state.selectedPointer, '/a'); assert.equal(h.workspace.state.previewSelection.nodeId, h.ids.a);
  assert.equal(h.workspace.state.previewSelection.fileId, h.file.id); assert.equal(h.workspace.state.previewSelection.screen.pointer, '/main');
  assert.equal(h.requests.some(row => row.action === 'edit'), false, '選択だけで属性planを要求しない'); assert.equal(h.errors.length, 0);
});

test('既存要素への選択切替は旧追加要素の削除対象を即時に解除する', async () => {
  const h = await harness(), canvas = h.getCanvasState(h.file.id);
  canvas.pendingAdditionSelection23 = 'pending-add-old';
  await h.choose('b');
  assert.equal(canvas.pendingAdditionSelection23, null, '原文readが未完了でも旧追加要素を削除対象に残さない');
  assert.equal(h.store.getState().editor.selection.nodeId, h.ids.b);
  h.resolveRead(0); await flush();
  assert.equal(h.workspace.state.previewSelection.nodeId, h.ids.b);
  assert.equal(h.errors.length, 0);
});

test('複数選択はCanvas集合を保持して旧単一原文と削除予定を破棄し、readを追加しない', async () => {
  const h = await harness(); await h.finishChoice('a'); await h.workspace.planDelete();
  const readCount = h.reads.length, requestCount = h.requests.length;
  h.api.select(h.file).select(h.ids.b, { toggle: true }); h.api.sync(h.file, h.ids.b); await flush();
  assert.deepEqual(h.selectedIds(), [h.ids.a, h.ids.b]); assert.equal(h.store.getState().editor.selection.nodeId, h.ids.b); emptySource(h);
  assert.equal(h.reads.length, readCount); assert.equal(h.requests.length, requestCount);
  await assert.rejects(h.workspace.confirmDelete(), error => error.code === 'WORKSPACE_DELETE_PLAN_STALE');
  assert.equal(h.requests.length, requestCount); assert.equal(h.buttons['studio-group'].disabled, false); assert.equal(h.errors.length, 0);
});

test('Shiftでpreferredを外すと残った単体をprimaryと原文対象にする', async () => {
  const h = await harness(); h.api.select(h.file).setSelection([h.ids.a, h.ids.b]);
  h.api.select(h.file).select(h.ids.b, { toggle: true }); h.api.sync(h.file, h.ids.b); await flush();
  assert.deepEqual(h.selectedIds(), [h.ids.a]); assert.equal(h.store.getState().editor.selection.nodeId, h.ids.a);
  assert.equal(h.reads.length, 1); assert.equal(h.reads[0].path, 'ui/a.json'); h.resolveRead(0); await flush();
  assert.equal(h.workspace.state.previewSelection.nodeId, h.ids.a); assert.equal(h.errors.length, 0);
});

test('古いAのreadが新しいBのreadより後に到着してもBを保持しエラー通知しない', async () => {
  const h = await harness(); await h.choose('a'); await h.choose('b');
  assert.deepEqual(h.reads.map(read => read.path), ['ui/a.json', 'ui/b.json']);
  h.resolveRead(1); await flush(); const current = h.workspace.state.previewSelection;
  assert.equal(current.nodeId, h.ids.b); h.resolveRead(0); await flush();
  assert.equal(h.workspace.state.previewSelection, current); assert.equal(h.workspace.state.activePath, 'ui/b.json');
  assert.equal(h.store.getState().editor.selection.nodeId, h.ids.b); assert.equal(h.workspace.getDocument('ui/a.json', 'pack'), undefined);
  assert.deepEqual(h.selectedIds(), [h.ids.b]); assert.equal(h.errors.length, 0);
});

test('単体read中に複数へ変更すると旧readは原文・storeを復活させない', async () => {
  const h = await harness(); await h.choose('a');
  h.api.select(h.file).select(h.ids.b, { toggle: true }); h.api.sync(h.file, h.ids.b); h.resolveRead(0); await flush();
  assert.deepEqual(h.selectedIds(), [h.ids.a, h.ids.b]); assert.equal(h.store.getState().editor.selection.nodeId, h.ids.b); emptySource(h);
  assert.equal(h.reads.length, 1); assert.equal(h.errors.length, 0);
});

test('原文からCanvasへの逆方向は選択集合も単体化し、原文readを再要求しない', async () => {
  const h = await harness(); await h.finishChoice('a');
  h.api.select(h.file).setSelection([h.ids.a, h.ids.b]); h.api.sync(h.file, h.ids.b); await flush();
  const readCount = h.reads.length, requests = h.requests.length;
  h.workspace.selectPointer('/a', 'ui/a.json', 'pack'); h.api.reverse('/a', 'ui/a.json', 'pack'); await flush();
  assert.deepEqual(h.selectedIds(), [h.ids.a]); assert.equal(h.store.getState().editor.selection.nodeId, h.ids.a);
  assert.equal(h.workspace.state.selectedPointer, '/a'); assert.equal(h.reads.length, readCount); assert.equal(h.requests.length, requests);
  assert.equal(h.redraws(), 1); assert.equal(h.errors.length, 0);
});

test('Canvas対応のない原文を選んだ場合は原文を保持し、以前の可視選択だけを消す', async () => {
  const h = await harness(); await h.finishChoice('a');
  const requestCount = h.requests.length;
  h.workspace.selectPointer('/unmapped', 'ui/other.json', 'pack');
  h.api.reverse('/unmapped', 'ui/other.json', 'pack'); await flush();
  assert.deepEqual(h.selectedIds(), []);
  assert.equal(h.store.getState().editor.selection.nodeId, null);
  assert.equal(h.workspace.state.selectedPointer, '/unmapped');
  assert.equal(h.workspace.state.activePath, 'ui/other.json');
  assert.equal(h.requests.length, requestCount);
  assert.equal(h.redraws(), 1); assert.equal(h.errors.length, 0);
});
