import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createAppStore, actions } from '../src/state-store/app-store.js';
import { lockedMovement26 } from '../src/ui/editor-arrangement26.js';
import { createEditorSelection21 } from '../src/ui/editor-selection21.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { createWorkspaceEditor, findAuthoredNodeForPreview, workspaceRecordSourceId,
  workspacePreviewDefinitionIdentity, matchesWorkspaceDocument, escapeSourcePointer, sameWorkspacePreviewModel, shouldDeferWorkspaceCanvasRender } from '../src/ui/workspace-editor.js';
import { siteText } from '../src/i18n/site-messages.js';
import { captureWorkspaceSourceDrag, resumeWorkspacePreviewAfterDraft } from '../src/ui/workspace-gesture14.js';
import { canvasPxToWorld, computeLayoutBoxesForFile, getResizeHandlesForBox, hitTestResizeHandles } from '../src/preview/canvas-preview.js';
import { createWorkspaceDraftPreview23 } from '../src/ui/workspace-draft-preview23.js';
import { advanceWorkspaceDraftScene23, buildWorkspaceDraftScene23, moveWorkspaceDraftAddition23 } from '../src/ui/workspace-draft-scene23.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';
import { resizePendingAddition33 } from '../src/ui/editor-transform33.js';
import { setAddType32 } from '../src/ui/workspace-add-intent32.js';

// 実main helperを実store/selection/controllerへ接続する。製品へのexport/hook追加は不要。
const source = await readFile(process.env.JSONUI_POINTER_TIMING_MAIN || new URL('../src/main.js', import.meta.url), 'utf8');
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

function section(start, end, from = 0) {
  const a = source.indexOf(start, from), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, `${start} / ${end} exist`);
  return source.slice(a, b);
}
const sourceOnChange = section('  onChange: (_state, kind) => {', '\n  },\n  onCommit:', source.indexOf('const sourceWorkspace = createWorkspaceEditor('));
const pointerSource = section('  const onPointerDown = (ev) => {', '  const onPointerMove = (ev) => {', source.indexOf('function renderCanvasPanel'));
const pointerUpSource = section('  const onPointerUp = (ev) => {', '  const onPointerCancel = (_ev) => {', source.indexOf('function renderCanvasPanel'));
const cancelSource = section('  const onPointerCancel = (_ev) => {', '/** @param {MouseEvent} ev */', source.indexOf('function renderCanvasPanel'));
async function harness() {
  const { file, ids, nodes } = fixture(), store = createAppStore(), selection = createEditorSelection21();
  store.dispatch(actions.openFile(file));
  const frames = new Map(), reads = [], errors = [], notifications = [], timeline = [];
  let frameId = 0, renders = 0, context, workspace, observing = false;
  function makeCanvas() {
    return { isConnected: true, style: {}, captures: new Set(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      setPointerCapture(id) { if (!this.isConnected) throw new Error('DETACHED_CANVAS_CAPTURE'); this.captures.add(id); timeline.push('capture'); },
      releasePointerCapture(id) { this.captures.delete(id); },
      focus() {}, remove() { this.isConnected = false; this.captures.clear(); },
    };
  }
  let canvas = makeCanvas();
  const cs = { sourceEditing: true, sourcePreviewBlocked: false,
    layout: { preset: { width: 100, height: 100 }, boxes: [{ id: ids.a, x: 0, y: 0, w: 20, h: 20 }] },
    nodeFrameContext: 'frame-1', view: { initialized: true, zoom: 1, viewX: 0, viewY: 0 }, interaction: { active: false } };
  const buttons = Object.fromEntries(['studio-group','studio-ungroup','studio-group-undo','studio-group-redo'].map(id => [id, { disabled: false }]));
  const document = { activeElement: null, body: {}, getElementById: id => id === 'preview-canvas' ? canvas : buttons[id] || null };
  const requestAnimationFrame = fn => { const id = ++frameId; frames.set(id, fn); return id; };
  const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(0); return pending.length; };
  context = vm.createContext({
    store, actions, editorSelection21: selection, lockedMovement26,
    findAuthoredNodeForPreview, workspaceRecordSourceId, workspacePreviewDefinitionIdentity, matchesWorkspaceDocument, escapeSourcePointer, sameWorkspacePreviewModel, siteText,
    captureWorkspaceSourceDrag, resumeWorkspacePreviewAfterDraft, shouldDeferWorkspaceCanvasRender, canvasPxToWorld,
    advanceWorkspaceDraftScene23, moveWorkspaceDraftAddition23, getResizeHandlesForBox, hitTestResizeHandles, resizePendingAddition33, setAddType32,
    importedPackRuntime: { zipReader: { nodePackId: 'pack' }, overridesTextByPackPath: {} }, vanillaReferenceRuntime: null,
    uiCatalogState: { catalog: { recordsById: {} } }, document,
    reportWorkspaceError: error => errors.push(error), requestCanvasTextureRedraw() {},
    clearPendingMockDataApply() {}, hidePreviewEditBoxOverlay() {}, updateStudioPendingUi() {},
    studioUi: { rangeSelecting: false, contextMenu: null }, key: file.id,
    getCanvasKey: id => id, getCanvasState: () => cs,
    ensureCanvasViewInitialized() {}, DEFAULT_CANVAS_PRESET: { width: 100, height: 100 },
    getInteractionPreviewContext: () => ({ enabled: false, pocket: false }),
    // Picking pixels is outside this sequencing regression. Return the authored box under the pointer.
    hitTestSourceCanvas: () => cs.layout.boxes[0],
    requestAnimationFrame, cancelAnimationFrame: id => frames.delete(id),
    workspaceSourceFrameRequired: false, validationGeneration: 0, validationPending: null,
    canvasUiState: { byFileKey: { [file.id]: cs } }, nodeFrameController: { invalidate() {} },
    previewPlayback: { pause() {} }, scheduledWorkspaceRender: { request() {}, cancel() {} },
    isRendering: false, workspaceRenderDeferred: false, getRoute: () => 'editor',
    performance, HTMLInputElement: class HTMLInputElement {}, HTMLTextAreaElement: class HTMLTextAreaElement {},
    previewPerformance: { record() {} }, diagnostics: { captureError: error => errors.push(error) }, routeRoot: null,
    render() { renders++; timeline.push('render'); canvas.remove(); canvas = makeCanvas(); },
    syncWorkspacePreviewGate() { cs.sourcePreviewBlocked = workspace.previewBlocked(); },
  });
  const lockState = source.match(/^const studioLocks26 = new Map\(\);/m)?.[0]; assert(lockState, 'actual lock state declaration');
  vm.runInContext(`${lockState}\n${['studioLockSet26', 'assertStudioUnlocked26', 'assertStudioPendingAdditionUnlocked26', 'workspaceSources', 'workspacePreviewSourceId', 'sourceNodeForPreview', 'studioSelection21',
    'studioDraftScene23', 'isCanvasNodeResizable', 'cursorForHandle',
    'selectSourceForCanvasNode', 'syncStudioSelectionUi21', 'syncStudioSourceSelection21',
    'closeStudioContextMenu21', 'safeRender', 'flushDeferredWorkspaceRender'].map(sourceFunction).join('\n')}
    this.actualOnChange = ({${sourceOnChange}\n  }}).onChange;
    ${pointerSource}\n${pointerUpSource}\n${cancelSource}
    this.api = { down:onPointerDown, up:onPointerUp, cancel:onPointerCancel, select:studioSelection21 };`, context);
  workspace = createWorkspaceEditor({
    onChange(state, kind) {
      if (observing) {
        timeline.push(`notify:${kind}`);
        notifications.push({ kind, active: cs.interaction.active, sourceFile: cs.interaction.sourceFile,
          pointerCaptured: canvas.captures.has(1), connected: canvas.isConnected, cursor: canvas.style.cursor,
          shouldDefer: Boolean(shouldDeferWorkspaceCanvasRender({ mode: state.mode, blocked: workspace.previewBlocked(), file, interaction: cs.interaction })) });
      }
      context.actualOnChange(state, kind);
    },
    request: async (action, payload) => {
      if (action === 'open') return { ok: true, workspaceId: 'workspace', revision: 1, nodes,
        files: nodes.map(node => ({ path: node.path, sourceId: 'pack', sourceKind: 'imported' })), sources: [{ id: 'pack', kind: 'imported' }] };
      if (action === 'read') return new Promise(resolve => reads.push({ path: payload.path, resolve }));
      throw new Error('UNEXPECTED_WORKSPACE_IO:' + action);
    },
  });
  context.sourceWorkspace = workspace;
  // DOM所有権試験ではNode計算済みsceneを明示的に渡す。実通信controllerの
  // cancel/世代管理を接続するが、投影IOはHTTP境界試験の責任とする。
  context.sourceWorkspaceDraft23 = createWorkspaceDraftPreview23({ readSnapshot: () => null,
    project: async () => { throw new Error('UNEXPECTED_DRAFT_PREVIEW_IO'); } });
  await workspace.ensure([{ id: 'pack', kind: 'imported' }], 'pack'); workspace.setMode('edit');
  flushFrames(); renders = 0; notifications.length = 0; timeline.length = 0; observing = true;
  function event() { return { currentTarget: canvas, clientX: 5, clientY: 5, pointerId: 1, button: 0 }; }
  function finishRead() {
    const read = reads[0]; assert(read);
    read.resolve({ ok: true, sourceId: 'pack', text: JSON.stringify({ namespace: 'demo', a: { type: 'label' } }), nodes: nodes.filter(node => node.path === read.path) });
  }
  return { api: context.api, context, workspace, file, ids, cs, notifications, timeline, errors, reads, event, finishRead, flushFrames,
    canvas: () => canvas, renders: () => renders };
}

function assertDeferredSelection(h, originalCanvas, t) {
  const notice = h.notifications.find(row => row.kind === 'selection');
  t.diagnostic(JSON.stringify({ stage: 'after-pointerdown', activeAtNotification: notice?.active,
    sourceOwnerAtNotification: notice?.sourceFile === h.file, captureAtNotification: notice?.pointerCaptured,
    sameCanvas: h.canvas() === originalCanvas, originalConnected: originalCanvas.isConnected,
    renderCount: h.renders(), timeline: h.timeline }));
  assert(notice, 'actual controller emitted selection synchronously');
  assert.equal(notice.active, true, 'notification observes active drag');
  assert.equal(notice.sourceFile, h.file, 'notification observes source owner before it can render');
  assert.equal(notice.pointerCaptured, true, 'notification observes capture already acquired');
  assert.equal(notice.cursor, 'move');
  assert.equal(notice.shouldDefer, true, 'real defer predicate accepts this complete interaction');
  assert.equal(h.canvas(), originalCanvas, 'real safeRender deferred its replace-capable render callback');
  assert.equal(originalCanvas.isConnected, true); assert.equal(originalCanvas.captures.has(1), true);
  assert.equal(h.renders(), 0, 'selection notification must not replace Canvas during pointerdown');
  assert(h.timeline.indexOf('capture') < h.timeline.indexOf('notify:selection'));
  assert.equal(h.context.workspaceRenderDeferred, true);
}

test('単体 authored pointerdown は capture 後に実 controller 通知し、遅延 read 完了でも Canvas を維持する', async t => {
  const h = await harness(), canvas = h.canvas();
  h.api.down(h.event()); assertDeferredSelection(h, canvas, t);
  await flush(); assert.equal(h.reads.length, 1); h.finishRead(); await flush();
  assert.equal(h.workspace.state.previewSelection.nodeId, h.ids.a);
  assert.equal(h.canvas(), canvas); assert.equal(h.renders(), 0);
  assert.equal(h.notifications.filter(row => row.kind === 'selection').length >= 2, true);
  h.api.cancel(h.event()); assert.equal(h.cs.interaction.active, false); assert.equal(h.cs.interaction.sourceFile, null);
  h.flushFrames(); assert.equal(h.renders(), 1); assert.notEqual(h.canvas(), canvas);
  assert.equal(h.context.workspaceRenderDeferred, false); assert.equal(h.errors.length, 0);
});

test('明示 group の pointerdown も同期通知時に所有権を保持し、pointercancel 後だけ再構築へ戻る', async t => {
  const h = await harness(), selection = h.api.select(h.file);
  selection.setSelection([h.ids.a, h.ids.b]); selection.groupSelected({ name: '検査 group' });
  const canvas = h.canvas(); h.api.down(h.event()); assertDeferredSelection(h, canvas, t);
  assert.deepEqual(Array.from(h.cs.interaction.groupIds), [h.ids.a, h.ids.b]);
  await flush(); assert.equal(h.reads.length, 0, 'multiple source targets do not start a single-source read');
  h.api.cancel(h.event()); assert.equal(h.cs.interaction.active, false); assert.equal(h.cs.interaction.sourceFile, null);
  assert.equal(Boolean(shouldDeferWorkspaceCanvasRender({ mode: 'edit', blocked: false, file: h.file, interaction: h.cs.interaction })), false);
  assert.equal(h.canvas(), canvas, 'cancellation queues one frame rather than replacing synchronously');
  h.flushFrames(); assert.equal(h.renders(), 1); assert.notEqual(h.canvas(), canvas);
  h.flushFrames(); assert.equal(h.renders(), 1, 'the deferred render is consumed once');
  assert.equal(h.errors.length, 0);
});

async function additionHarness() {
  const h = await harness(), canvas = h.canvas(), parentId = h.file.uiModel.root.children[0].id;
  const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
  const value = { type: 'label', ...origin, offset: [0, 0], size: [20, 20], text: '追加' };
  const document = { namespace: 'demo', main: { type: 'screen', ...origin, size: [100, 100], controls: [
    { a: { type: 'label', text: 'A' } }, { b: { type: 'label', text: 'B' } }, { c: { type: 'label', text: 'C' } }, { added: value },
  ] } };
  const uiModel = buildUiScreenModelFromJson(document, { filePath: h.file.path });
  const draftFile = { uiModel, ...buildTreeFromUiScreenModel(uiModel) };
  const operation = { type: 'add', name: 'added', value, path: h.file.path, sourceId: 'pack', parentPointer: '/main' };
  h.workspace.queueOperations([operation], { previewSelections: [{ fileId: h.file.id, nodeId: parentId, path: h.file.path, sourceId: 'pack', pointer: '/main' }] });
  const addition = h.workspace.pendingAdditions(h.file.id)[0]; assert(addition);
  const result = { ok: true, committed: false, baseRevision: 1, pendingVersion: 2, projection: { document },
    frame: { schema: 'jsonui-frame-v1', propsById: {}, layout: computeLayoutBoxesForFile(draftFile, { width: 100, height: 100 }) } };
  const scene = buildWorkspaceDraftScene23({ file: h.file, result, additions: [addition] });
  h.cs.workspaceDraftScene23 = scene;
  assert.equal(h.context.studioDraftScene23(h.cs, { ...h.file, validationDiagnostics: [] }), scene,
    '無害な検証情報だけのfile差替えで追加要素を消さない');
  const addedId = [...scene.additionsByNodeId.keys()][0]; assert(addedId);
  h.context.hitTestSourceCanvas = () => scene.layout.boxes.find(box => box.id === addedId);
  return { ...h, originalCanvas: canvas, addition, addedId };
}

test('追加予定要素のpointerdownも実controller通知でCanvasを交換せず、取消後に再描画する', async () => {
  const h = await additionHarness(), canvas = h.originalCanvas, addition = h.addition;
  h.api.down(h.event());
  assert.equal(h.cs.interaction.pendingAdditionDrag23.file, h.file);
  assert.equal(h.cs.pendingAdditionSelection23, addition.id);
  assert.equal(h.cs.interaction.active, true); assert.equal(h.canvas(), canvas);
  assert.equal(canvas.isConnected, true); assert.equal(canvas.captures.has(1), true); assert.equal(h.renders(), 0);
  assert.equal(h.context.workspaceRenderDeferred, true); assert.equal(h.errors.length, 0);
  h.api.cancel(h.event()); assert.equal(h.cs.interaction.pendingAdditionDrag23, null);
  h.flushFrames(); assert.equal(h.renders(), 1); assert.equal(h.errors.length, 0);
});

test('追加予定要素の実main pointerupは原文を確定せず移動をキューへ保持し、undo/redoできる', async () => {
  const h = await additionHarness(), canvas = h.originalCanvas;
  h.api.down(h.event());
  h.cs.interaction.moved = true;
  h.cs.interaction.draftBox = { ...h.cs.interaction.startBox, x: h.cs.interaction.startBox.x + 7, y: h.cs.interaction.startBox.y - 3 };
  h.api.up(h.event());
  assert.equal(h.cs.interaction.active, false); assert.equal(canvas.captures.has(1), false);
  assert.equal(h.workspace.state.revision, 1); assert.equal(h.workspace.pendingCount, 2);
  assert.deepEqual(h.workspace.pendingAdditions(h.file.id)[0].operation.value.offset, [7, -3]);
  h.workspace.undoPending(); assert.deepEqual(h.workspace.pendingAdditions(h.file.id)[0].operation.value.offset, [0, 0]);
  h.workspace.redoPending(); assert.deepEqual(h.workspace.pendingAdditions(h.file.id)[0].operation.value.offset, [7, -3]);
  assert.equal(h.errors.length, 0); assert.equal(h.reads.length, 0);
});

test('追加予定要素をNode応答前に続けてドラッグしても現在の草稿位置から移動を保持する', async () => {
  const h = await additionHarness();
  h.context.hitTestSourceCanvas = () => h.context.studioDraftScene23(h.cs, h.file).layout.boxes.find(box => box.id === h.addedId);
  for (const [dx, dy] of [[7, -3], [2, 5], [-1, -4]]) {
    const current=h.context.studioDraftScene23(h.cs,h.file).layout.boxes.find(box=>box.id===h.addedId);
    h.api.down({...h.event(),clientX:current.x+current.w/2,clientY:current.y+current.h/2});
    assert.equal(h.cs.interaction.active, true);
    h.cs.interaction.moved = true;
    h.cs.interaction.draftBox = { ...h.cs.interaction.startBox,
      x: h.cs.interaction.startBox.x + dx, y: h.cs.interaction.startBox.y + dy };
    h.api.up(h.event());
    assert.equal(h.errors.length, 0, '最新キューを表示した草稿を古い世代と取り違えない');
  }
  assert.equal(h.workspace.state.revision, 1, '原文確定は行わない');
  assert.equal(h.workspace.pendingCount, 4, '追加と3回の移動を別操作で保持');
  assert.deepEqual(h.workspace.pendingAdditions(h.file.id)[0].operation.value.offset, [8, -2]);
  const box = h.context.studioDraftScene23(h.cs, h.file).layout.boxes.find(item => item.id === h.addedId);
  assert.deepEqual([box.x, box.y], [8, -2]);
  h.workspace.undoPending();
  assert.deepEqual(h.workspace.pendingAdditions(h.file.id)[0].operation.value.offset, [9, 2]);
  h.workspace.redoPending();
  assert.deepEqual(h.workspace.pendingAdditions(h.file.id)[0].operation.value.offset, [8, -2]);
  assert.equal(h.reads.length, 0);
});

// revision26: 保護を無効化して古いgesture検査を通さない。実lock境界も確認する。
test('実pointerdownはロックされた単体をcaptureせず、変更も追加しない', async () => {
  const h = await harness(); h.context.studioLockSet26(h.file).add(h.ids.a);
  h.api.down(h.event());
  assert.equal(h.cs.interaction.active, false); assert.equal(h.cs.interaction.sourceDrag, null);
  assert.equal(h.workspace.pendingCount, 0); assert.equal(h.errors.at(-1)?.code, 'EDITOR_ELEMENT_LOCKED');
  assert.equal(h.timeline.includes('capture'), false);
});
test('追加予定要素の親ロックでもcapture前に停止し、追加草稿を失わない', async () => {
  const h = await additionHarness(), parentId = h.file.uiModel.root.children[0].id;
  h.context.studioLockSet26(h.file).add(parentId); const before = h.workspace.pendingCount;
  h.api.down(h.event());
  assert.equal(h.cs.interaction.active, false); assert.equal(h.cs.interaction.pendingAdditionDrag23, null);
  assert.equal(h.workspace.pendingCount, before); assert.equal(h.errors.at(-1)?.code, 'EDITOR_ELEMENT_LOCKED');
  assert.equal(h.timeline.includes('capture'), false);
});


test('実pointerup: 未確定の追加要素をハンドルで伸縮し、1回のUndoで寸法と位置を戻す',async()=>{
 const h=await additionHarness();h.cs.pendingAdditionSelection23=h.addition.id;
 const box=h.context.studioDraftScene23(h.cs,h.file).layout.boxes.find(item=>item.id===h.addedId);
 const event={...h.event(),clientX:box.x,clientY:box.y};h.api.down(event);
 assert.equal(h.cs.interaction.mode,'resize');h.cs.interaction.moved=true;h.cs.interaction.draftBox={x:box.x-4,y:box.y-3,w:box.w+4,h:box.h+3};
 h.api.up(event);assert.equal(h.errors.length,0);assert.deepEqual(h.workspace.pendingAdditions()[0].operation.value.size,[24,23]);assert.deepEqual(h.workspace.pendingAdditions()[0].operation.value.offset,[-4,-3]);
 h.workspace.undoPending();assert.deepEqual(h.workspace.pendingAdditions()[0].operation.value.size,[20,20]);assert.deepEqual(h.workspace.pendingAdditions()[0].operation.value.offset,[0,0]);
});
test('実Canvas Escape: 挿入ドラッグを取消しcaptureと枠を残さない',async()=>{
 const h=await harness();setAddType32(h.workspace.state,'label');h.api.down(h.event());assert.equal(h.cs.interaction.mode,'insert');assert(h.canvas().captures.has(1));
 const begin=source.indexOf('          onKeydown:event=>{',source.indexOf("id: 'preview-canvas'"));const end=source.indexOf(',\n          onWheel',begin);assert(begin>=0&&end>begin);
 Object.assign(h.context,{cs:h.cs,file:h.file});vm.runInContext('this.keydown33 = '+source.slice(begin,end).trim().replace(/^onKeydown:/u,''),h.context);
 h.context.keydown33({...h.event(),key:'Escape',preventDefault(){}});
 assert.equal(h.cs.interaction.active,false);assert.equal(h.cs.interaction.insertionDrag33,null);assert.equal(h.workspace.state.addType,'');assert.equal(h.canvas().captures.has(1),false);
});
