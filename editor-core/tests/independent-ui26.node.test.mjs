import { workspaceEditSelectionIdentity } from '../src/ui/workspace-edit-intent.js';
import { captureGeometryPolicy29, assertGeometryPolicy29 } from '../src/ui/workspace-geometry-policy29.js';
import { siteText } from '../src/i18n/site-messages.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createEditorSelection21 } from '../src/ui/editor-selection21.js';
import { lockedMovement26, planLayerMove26, studioProgressModel26 } from '../src/ui/editor-arrangement26.js';
import { applyPendingLayout21 } from '../src/ui/editor-draft-layout21.js';
import { compareCanvasPaintOrder } from '../src/preview/canvas-preview.js';
import { createNodeFrameController } from '../src/ui/node-frame-controller.js';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
console.log('independent_main_sha256=' + createHash('sha256').update(source).digest('hex'));
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, '実mainから検査区間を特定する: ' + start);
  return source.slice(a, b);
}
const selectionSource = section('const editorSelection21 =', 'function syncStudioSourceSelection21(');
const lockSource = section('const studioLocks26 =', 'async function studioArrange26(');
const propertySource = section('function studioNodeLabel26(', 'function renderStudioNavigation26(')
  + section('function renderStudioProperties26(', 'function renderSourceWorkspaceInspector(');
function file(id = 'A', definition = 'screenA') {
  return { id, path: 'ui/multiple.json', meta: { selectedDefinition: { qualifiedName: 'test.' + definition } },
    uiModel: { root: { id: 'root' } }, nodesById: {
      root: { children: ['panel'] }, panel: { children: ['a', 'b'] },
      a: { props: { offset: [-50, 60], size: ['10px', '20px'], controls: [{ kept: {} }] } },
      b: { props: { offset: [0, 0], size: [20, 20] } },
    } };
}
const flatten = value => value && typeof value === 'object' ? [value, ...(value.children || []).flatMap(flatten)] : [];
function harness() {
  const A = file(), state = { files: { currentFileId: A.id, byId: { A } }, pack: { status: 'ready' } };
  const edits = [], errors = [];
  const workspace = { state: { mode: 'edit', revision: 'r1', pendingVersion: 0, busy: false, editTargetMode: 'visual' },
    pendingNodeTransforms: () => new Map(), setEditOptions() {},
    editPreviewProperty: async (property, value) => edits.push({ property, value }),
  };
  const context = vm.createContext({ workspaceEditSelectionIdentity, captureGeometryPolicy29, assertGeometryPolicy29, siteText, console, Map, Set, Date, Promise, createEditorSelection21, lockedMovement26,
    sourceWorkspace: workspace, store: { getState: () => state }, workspaceSources: () => [{ kind: 'imported', id: 'pack1' }],
    requestCanvasTextureRedraw() {}, safeRender() {}, setStatus() {},
    studioInvoke: action => action(), selectSourceForCanvasNode: async () => {},
    h: (tag, attrs = {}, children = []) => ({ tag, attrs, children }),
  });
  vm.runInContext(selectionSource + lockSource + propertySource, context);
  return { context, A, state, workspace, edits, errors };
}

test('実mainのロックは同一ファイル内の別定義を分離し、画面往復・再投影後も維持する', () => {
  const { context: c, A, state } = harness();
  c.studioSelection21(A).select('a', { single: true });
  c.studioToggleLock26('a');
  const B = file('B', 'screenB'); state.files.byId.B = B; state.files.currentFileId = 'B';
  assert.equal(c.studioLockSet26(B).size, 0, '同名要素IDでも別定義へロックを流用しない');
  state.files.currentFileId = 'A';
  const projected = { ...A, uiModel: { root: { id: 'root' } }, nodesById: structuredClone(A.nodesById) };
  state.files.byId.A = projected;
  assert.equal(c.studioLockSet26(projected).has('a'), true, 'revision/オブジェクト再生成では解除しない');
  assert.throws(() => c.assertStudioUnlocked26(projected, ['panel']), { code: 'EDITOR_ELEMENT_LOCKED' });
  assert.doesNotThrow(() => c.assertStudioUnlocked26(projected, ['b']));
});

test('親子の両選択からmovementRootsを計算してもロックした子孫を親移動で迂回しない', () => {
  const { context: c, A } = harness();
  c.studioSelection21(A).setSelection(['panel', 'a']);
  c.studioToggleLock26('a');
  const roots = c.studioSelection21(A).movementRoots();
  assert.deepEqual([...roots], ['panel']);
  assert.throws(() => c.assertStudioUnlocked26(A, roots), { code: 'EDITOR_ELEMENT_LOCKED' });
});

test('実mainの数値入力はJSON numberで属性境界へ渡し、子controlsを置換しない', async () => {
  const { context: c, A, edits } = harness();
  c.studioSelection21(A).select('a', { single: true });
  const before = JSON.stringify(A.nodesById.a.props.controls);
  const view = c.renderStudioProperties26(A), elements = flatten(view);
  const x = elements.find(node => node.attrs?.['aria-label'] === '横位置');
  assert.ok(x.attrs.id, 'safeRenderが復帰対象を特定できるIDが必要');
  x.attrs.onInput({ currentTarget: { value: '-51.25' } });
  await elements.find(node => node.tag === 'button' && node.children[0] === '位置を変更').attrs.onClick();
  assert.equal(edits.length, 1); assert.equal(edits[0].property, 'offset');
  assert.deepEqual([...edits[0].value], [-51.25, 60]);
  assert.ok(edits[0].value.every(value => typeof value === 'number'));
  assert.equal(JSON.stringify(A.nodesById.a.props.controls), before);
});

test('割合/変数寸法を数値パネルで上書きせず、空値・負サイズを確定しない', async () => {
  const { context: c, A, edits } = harness();
  c.studioSelection21(A).select('a', { single: true });
  A.nodesById.a.props.size = ['100%', '$height'];
  assert.equal(flatten(c.renderStudioProperties26(A)).filter(node => ['幅', '高さ'].includes(node.attrs?.['aria-label'])).length, 0);
  A.nodesById.a.props.size = [10, 20];
  const nodes = flatten(c.renderStudioProperties26(A));
  nodes.find(node => node.attrs?.['aria-label'] === '幅').attrs.onInput({ currentTarget: { value: '-1' } });
  await assert.rejects(nodes.find(node => node.children?.[0] === 'サイズを変更').attrs.onClick(), /0以上/);
  nodes.find(node => node.attrs?.['aria-label'] === '横位置').attrs.onInput({ currentTarget: { value: '' } });
  await assert.rejects(nodes.find(node => node.children?.[0] === '位置を変更').attrs.onClick(), /数値/);
  assert.equal(edits.length, 0);
});

test('実main共通属性境界はplan待機中に追加されたロックも確定直前に検査する', async () => {
  const { context: c, A, workspace, edits } = harness();
  c.studioSelection21(A).select('a', { single: true });
  let release;
  workspace.planPreviewEdit = () => new Promise(resolve => { release = resolve; });
  c.buildWorkspacePreviewSourceMap = () => ({});
  c.resolvePlannedPreviewNodeIds22 = (_map, plan) => plan.ids;
  vm.runInContext(section('const studioEditPreviewProperty26 =', 'const studioMovePreviewElement26 ='), c);
  const request = workspace.editPreviewProperty('size', [20, 40]);
  c.studioToggleLock26('a');
  release({ ids: ['a'] });
  await assert.rejects(request, { code: 'EDITOR_ELEMENT_LOCKED' });
  assert.equal(edits.length, 0);
});

test('実safeRenderは新しい数値欄へfocusを戻し未適用の入力値を保持する（DOM mock）', () => {
  const { context: c, A } = harness();
  c.studioSelection21(A).select('a', { single: true });
  const original = flatten(c.renderStudioProperties26(A)).find(node => node.attrs?.['aria-label'] === '横位置');
  original.attrs.onInput({ currentTarget: { value: '-51.25' } });
  const body = {}, document = { body, activeElement: null };
  class Input {
    constructor(attrs) { Object.assign(this, attrs); this.isConnected = true; this.selectionStart = null; this.selectionEnd = null; }
    focus() { document.activeElement = this; }
    setSelectionRange() { throw new Error('number inputはcaret APIを提供しない'); }
  }
  const previous = new Input(original.attrs); document.activeElement = previous;
  let replacements = [];
  document.getElementById = id => replacements.find(input => input.id === id);
  Object.assign(c, { document, HTMLInputElement: Input, HTMLTextAreaElement: class {},
    getCanvasState: () => ({}), getCanvasKey: id => id, getRoute: () => 'editor',
    shouldDeferWorkspaceCanvasRender: () => false, scheduledWorkspaceRender: { cancel() {} },
    performance: { now: () => 10 }, previewPerformance: { record() {} },
    diagnostics: { captureError(error) { throw error; } },
    render() {
      replacements = flatten(c.renderStudioProperties26(A)).filter(node => node.tag === 'input').map(node => new Input(node.attrs));
      previous.isConnected = false; document.activeElement = body;
    },
  });
  c.sourceWorkspace.previewBlocked = () => false;
  vm.runInContext('let isRendering = false, workspaceRenderDeferred = false;\n' + section('function safeRender() {', 'function setupLanguageToggle('), c);
  c.safeRender();
  assert.notEqual(document.activeElement, previous);
  assert.equal(document.activeElement.id, original.attrs.id);
  assert.equal(document.activeElement.value, '-51.25');
});

test('異なる正負layerの枝全体を移した草稿を本番paint comparatorで整列する', () => {
  const nodes = { root: { children: ['a', 'b'] }, a: { children: ['a1'], props: { layer: 2 } },
    a1: { props: { layer: -8 } }, b: { children: ['b1'], props: { layer: 4 } }, b1: { props: { layer: 9 } } };
  const boxes = [['root', null, 40, 40], ['a', 'root', 2, 42], ['a1', 'a', -8, 34], ['b', 'root', 4, 44], ['b1', 'b', 9, 53]]
    .map(([id, parentId, layer, effectiveLayer], order) => ({ id, parentId, layer, effectiveLayer, order, x: 0, y: 0, w: 10, h: 10 }));
  const baseline = JSON.stringify({ nodes, boxes });
  for (const [direction, expected] of [['front', ['b', 'b1', 'a1', 'a']], ['back', ['a1', 'a', 'b', 'b1']]]) {
    const plan = planLayerMove26({ nodeId: 'a', nodesById: nodes, boxes, direction });
    const draft = plan ? applyPendingLayout21({ boxes }, new Map([['a', { properties: { layer: plan.value } }]]), { nodesById: nodes }) : { boxes };
    const order = draft.boxes.filter(box => box.id !== 'root').sort(compareCanvasPaintOrder).map(box => box.id);
    assert.deepEqual(order, expected, direction);
    assert.equal(draft.boxes.find(box => box.id === 'root').effectiveLayer, 40);
    assert.equal(draft.boxes.find(box => box.id === 'a1').layer, -8);
  }
  assert.equal(JSON.stringify({ nodes, boxes }), baseline);
});

test('実mainのfooter監視は成功・失敗・取消のsettle時に消え、古いprogressで復活しない', async () => {
  const span = { textContent: '' }, meter = { removeAttribute() {}, setAttribute() {} };
  const host = { hidden: true, dataset: {}, removeAttribute() {}, querySelector: key => key === 'span' ? span : meter };
  let complete, fail, latestOptions;
  const c = vm.createContext({ Map, Promise, Date, studioProgressModel26,
    document: { getElementById: () => host }, store: { getState: () => ({ pack: { status: 'ready' } }) },
    vanillaReferenceUiState: { status: 'ready' }, uiCatalogState: { status: 'ready' },
    nodeWorkspaceRequest: (_operation, _data, options) => { latestOptions = options; return new Promise((resolve, reject) => { complete = resolve; fail = reject; }); },
  });
  vm.runInContext(section('const studioActivities26 =', 'const sourceWorkspace ='), c);
  for (const outcome of ['success', 'failure', 'cancelled']) {
    const promise = c.studioWorkspaceRequest26('edit', {});
    assert.equal(host.hidden, false);
    latestOptions.onProgress({ processed: 1, total: 2 }); assert.match(span.textContent, /50%/);
    const late = latestOptions.onProgress;
    if (outcome === 'success') { complete({ ok: true }); await promise; }
    else { fail(Object.assign(new Error(outcome), { code: outcome === 'cancelled' ? 'NODE_JOB_CANCELLED' : 'EDIT_FAILED' })); await assert.rejects(promise); }
    assert.equal(host.hidden, true);
    late({ processed: 2, total: 2 }); assert.equal(host.hidden, true);
  }
});

test('実frame controllerの長い描画は未知量の進捗を示し、invalidate後の完了で消える', async () => {
  const span = { textContent: '' }, meter = { value: null, removeAttribute(key) { if (key === 'value') this.value = null; }, setAttribute() {} };
  const host = { hidden: true, dataset: {}, removeAttribute() {}, querySelector: key => key === 'span' ? span : meter };
  let now = 1000, resolveRequest, payload;
  const c = vm.createContext({ Map, Promise, Date: { now: () => now }, studioProgressModel26,
    document: { getElementById: () => host }, store: { getState: () => ({ pack: { status: 'ready' } }) },
    vanillaReferenceUiState: { status: 'ready' }, uiCatalogState: { status: 'ready' },
  });
  vm.runInContext(section('const studioActivities26 =', 'const sourceWorkspace ='), c);
  const begin = source.indexOf('const nodeFrameController = createNodeFrameController({');
  const status = source.slice(source.indexOf('  onStatus(status) {', begin), source.indexOf('  request: payload', begin));
  assert.ok(status.includes('studioActivities26'), '本番の接続を取得する');
  const onStatus = vm.runInContext('({' + status + '}).onStatus', c);
  const frames = createNodeFrameController({ onStatus, request: input => {
    payload = input; return new Promise(resolve => { resolveRequest = resolve; });
  }, onResult() { throw new Error('invalidate済み結果を適用してはいけない'); } });
  frames.submit({ file: {}, contextKey: 'test', input: {} });
  now = 1200; c.syncStudioProgress26(); assert.equal(host.hidden, true, '短い通常描画で点滅させない');
  now = 31000; c.syncStudioProgress26(); assert.equal(host.hidden, false);
  assert.match(span.textContent, /表示を計算中/); assert.match(span.textContent, /30秒/); assert.equal(meter.value, null);
  frames.invalidate(); assert.equal(frames.snapshot().inFlight, 1);
  resolveRequest({ schema: 'jsonui-frame-v1', generation: payload.generation, modelId: 'test', layout: { boxes: [] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.hidden, true); assert.equal(frames.snapshot().inFlight, 0);
});

test('狭幅で右表示中もホームの要素ツリーを開く実handlerが左を開ける', () => {
  const start = source.indexOf("button('studio-open-tree'");
  const button = source.slice(start, source.indexOf("button('studio-search-elements'", start));
  const handler = button.slice(button.indexOf('() => {'), button.lastIndexOf('}') + 1);
  assert.ok(handler.startsWith('() => {'), '実handlerを取り出す');
  const guard = section('function renderEditor(state) {', '  const leftPxRaw =') + '}';
  for (const width of [600, 900, 1920]) {
    const c = vm.createContext({ window: { innerWidth: width }, studioUi: { leftOpen: false, rightOpen: true },
      workspaceNavigationState: { detailedEditor: false } });
    vm.runInContext(guard + '\nfunction safeRender() { renderEditor({}); }', c);
    vm.runInContext('(' + handler + ')()', c);
    assert.equal(c.studioUi.leftOpen, true, `${width}pxで開く操作を共通ガードが取り消さない`);
    assert.equal(c.studioUi.leftView26, 'advanced');
    if (width <= 900) assert.equal(c.studioUi.rightOpen, false);
  }
});
