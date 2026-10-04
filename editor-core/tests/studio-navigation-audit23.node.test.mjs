import {registerEditorGroupCommands31}from'../src/commands/editor-group-commands31.js';
import * as layout28 from '../src/ui/studio-layout28.js';
/** 操作導線の独立監査。本番関数 + 最小 DOM。CSS 描画や実ブラウザの代替とは主張しない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as shell from '../src/ui/studio-shell.js';
import { renderWorkspacePicker } from '../src/ui/workspace-navigation.js';
import { createPreviewViewportController } from '../src/ui/preview-viewport.js';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function part(start, end) { const a = main.indexOf(start), b = main.indexOf(end, a); assert(a >= 0 && b > a, start); return main.slice(a, b); }
class Element {
  constructor(tag = '', text = '') { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = new Map(); this._text = text; this.className = ''; this.style = {}; this.scrollTop = 0; this.scrollHeight = 500; this.clientHeight = 300; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; node.doc = this.doc; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  get id() { return this.attrs.id || ''; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get isConnected() { return Boolean(this.parentNode); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  dispatch(name, event = {}) { this.listeners.get(name)?.({ target: this, currentTarget: this, preventDefault() {}, ...event }); }
  all() { return this.children.flatMap(node => [node, ...node.all()]); }
  querySelector(selector) { return this.all().find(node => selector.startsWith('#') ? node.id === selector.slice(1) : selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : selector.startsWith('[') ? Object.hasOwn(node.attrs, selector.slice(1, -1)) : node.tagName === selector.toUpperCase()) || null; }
  querySelectorAll(selector) { return this.all().filter(node => selector.startsWith('[') ? Object.hasOwn(node.attrs, selector.slice(1, -1)) : selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tagName === selector.toUpperCase()); }
  focus() { this.doc.activeElement = this; }
  select() { this.selectedText = true; }
  scrollIntoView() { this.scrolled = true; }
  get classList() { return { toggle: (name, enabled) => { const classes = new Set(this.className.split(' ').filter(Boolean)); if (enabled) classes.add(name); else classes.delete(name); this.className = [...classes].join(' '); } }; }
}
function harness() {
  const frames = [], effects = [], errors = [], commands = new Map(), body = new Element('body');
  const doc = { body, createElement(tag) { const node = new Element(tag); node.doc = doc; return node; }, createTextNode: text => new Element('', text), getElementById: id => body.querySelector('#' + id), querySelectorAll: selector => body.querySelectorAll(selector) }; body.doc = doc;
  const state = { ui: { route: 'editor', panels: { leftPx: 360, rightPx: 340 }, tabs: { center: 'canvas' } }, pack: {},
    files: { currentFileId: 'f', byId: { f: { id: 'f', path: 'ui/example.json', nodesById: { n: {} }, meta: { previewProjection: true } } } }, editor: { selection: { nodeId: 'n' } } };
  const ws = { mode: 'preview', busy: false, drafts: new Map(), pendingOperations: [], pendingRedoOperations: [], canUndo: false, canRedo: false, editScope: 'shared', selectedPointer: '/root', workspaceId: 'w' };
  const context = vm.createContext({ ...shell, ...layout28, renderWorkspacePicker, registerEditorGroupCommands31, performStudioGroup31(){}, performStudioUngroup31(){}, studioDelete31(){}, Node: Element, HTMLElement: Element, HTMLInputElement: Element, HTMLButtonElement: Element,
    window: { innerWidth: 1920 }, document: doc, requestAnimationFrame: fn => frames.push(fn), t: key => key, siteText: (value, ...args) => Array.isArray(value) ? String.raw({ raw: value }, ...args) : value,
    reportWorkspaceError: error => errors.push(error), sanitizeUrlForAttribute: value => value,
    commandSystem: { register: value => commands.set(value.id, value) },
    store: { getState: () => state, dispatch: action => effects.push(['dispatch', action]) }, actions: {},
    studioUi: { tab: 'home', leftOpen: true, rightOpen: false, rightView: 'properties', details: {}, viewControls: null },
    workspaceNavigationState: { detailedEditor: false, file: {}, definition: {} }, leftPaneScrollState: { scrollTop: 0 },
    PANEL_DEFAULT_LEFT_PX: 360, PANEL_DEFAULT_RIGHT_PX: 360, PANEL_MIN_LEFT: 240, PANEL_MIN_RIGHT: 240,
    sourceWorkspace: { state: ws, setMode: mode => { ws.mode = mode; }, history: () => {}, discardPending: () => {}, applyPending: () => {}, planDelete: () => {}, refresh: () => {} },
    sourceWorkspaceDraft23: { getStatus: () => ({ status: 'idle' }), flush: () => {} },
    studioSelection21: () => ({ snapshot: () => ({ canGroup: true }) }), importedPackRuntime: {}, vanillaReferenceRuntime: null,
    ensureSourceWorkspace: async () => {}, previewPlayback: { pause() {} }, hidePreviewEditBoxOverlay() {}, screenOpenState: {},
    studioInvoke: fn => Promise.resolve().then(fn).catch(error => errors.push(error)),
    getCanvasKey: id => id, getCanvasState: () => ({ view: { zoom: 1, viewX: 0, viewY: 0 } }), fitCanvasUiView: () => {},
    previewViewport: { active: false, ribbonVisible: false, ribbonPinned: false, showRibbon: () => effects.push(['ribbon']), exit() {}, setRibbonPinned() {}, hideRibbon() {} },
    studioGroupSelection21() {}, studioUngroupSelection21() {}, studioGroupHistory21() {}, studioSaveGroups21() {}, studioLoadGroups21() {},
    renderWorkspaceEditPolicy: h => h('fieldset', { id: 'edit-policy' }), downloadCompleteDebugBundle: () => effects.push(['debug']),
    adjustPanelWidth() {}, resetPanelWidth() {}, renderSplitter: () => doc.createElement('div'),
    assertStudioExternalChange21() { if (context.studioRuntimeChangesBlocked21()) throw new Error('RUNTIME_LOCKED'); },
    getCommandContext: () => ({ store: context.store, actions: context.actions }),
  });
  vm.runInContext(part('function h(tag,', '\n/**\n * @param {{type:')
    + part('function registerDefaultCommands()', '// Register once at module init.')
    + part('function focusTreeSearchInput(', '\nfunction zoomCanvasFromCommand(')
    + part('function toggleLeftPanel(', '\n/**\n * Update static DOM')
    + part('function renderTabbedPanel(', '\n/**\n * @param {import(\'./state-store/app-store.js\').AppState} state\n */\nconst runtimeStateEditor')
    + part('function studioSetTab(', '\nfunction updateStudioPendingUi(')
    + part('function renderStudioNavigation26(', '\nfunction renderStudioProperties26(')
    + part('function renderStudioRibbon(', '\n/* --- S033:')
    + part('function openVanillaVersionSettings()', '\n/**\n * @param {import(\'./state-store/app-store.js\').PackState}')
    + part('function formatDefinitionClassification(', '\nfunction renderPackExportSection(')
    + part('function renderHelp()', '\nfunction renderNotFound('), context);
  const marker = id => context.h('div', { id });
  context.renderPanel = (_title, children, options = {}) => context.h('section', { class: 'panel' }, [context.h('div', { class: 'panel-header' }, options.headerActions || []), context.h('div', { class: 'panel-body', ...options.bodyAttrs }, children)]);
  context.renderPackImportSection = () => context.h('div', {}, [context.h('input', { id: 'workspace-file-picker-search' }), context.h('button', { id: 'resource-pack-file-button' })]);
  context.renderEditorTreePanel = () => context.h('div', {}, [context.renderPackImportSection(), context.h('input', { id: 'tree-search-input' })]);
  context.renderCanvasPanel = () => { context.studioUi.viewControls = marker('view-toolbar'); return context.h('canvas', { id: 'preview-canvas' }); };
  context.renderEditorPropertiesPanel = () => marker('read-properties'); context.renderRawJsonPanel = () => marker('read-source');
  context.renderSourceWorkspaceInspector = () => marker(ws.sourceDetailsOpen ? 'edit-source' : 'edit-properties');
  context.renderRuntimeStatePanel = () => marker('runtime-panel'); context.renderReferencesPanel = () => marker('references-panel');
  context.renderDebugPanel = () => context.h('div', {}, [marker('diagnostics-panel'), context.h('input', { id: 'vanilla-reference-settings' })]);
  context.renderSourceWorkspaceToolbar = () => context.h('div', {}, [context.h('details', { class: 'workspace-export-section' }, ['EXPORT'])]);
  context.safeRender = () => { body.replaceChildren(context.renderEditor(state)); effects.push(['render']); };
  context.i18n = { getLocale: () => 'ja_JP' }; context.editorResourceUrl = value => value;
  context.registerDefaultCommands();
  return { context, state, ws, doc, body, effects, errors, commands, render: context.safeRender,
    flushFrames() { let guard = 0; while (frames.length && guard++ < 10) frames.splice(0).forEach(fn => fn()); assert(frames.length === 0); },
    byId: id => doc.getElementById(id) };
}

test('実コマンド: Ctrl+K は閉じた左を開き、幅を変えず新DOMの検索へ移る', () => {
  const f = harness(); f.context.studioUi.leftOpen = false; f.render();
  f.commands.get('focus.workspaceFileSearch').run({ store: f.context.store }); f.flushFrames();
  assert.equal(f.context.studioUi.leftOpen, true); assert.equal(f.state.ui.panels.leftPx, 360);
  assert.equal(f.doc.activeElement.id, 'workspace-file-picker-search'); assert.equal(f.doc.activeElement.selectedText, true);
  assert.deepEqual(f.errors, []);
});

test('実コマンド: Ctrl+F が詳細ツリーを開き検索へ移動し、通常ホームでは詳細は閉じている', () => {
  const f = harness(); f.render(); assert.equal(f.byId('studio-home-advanced').open, false); assert.equal(f.byId('tree-search-input'), null);
  f.context.studioUi.leftOpen = false;
  f.commands.get('focus.treeSearch').run(); f.flushFrames();
  assert.equal(f.context.workspaceNavigationState.detailedEditor, true);
  assert.equal(f.doc.activeElement.id, 'tree-search-input');
  assert.equal(f.doc.activeElement.selectedText, true);
});

test('実ホーム詳細入口は要素ツリーを開閉でき、検索入口も維持する', async () => {
  const f = harness(); f.render(); f.byId('studio-open-tree').dispatch('click'); await Promise.resolve();
  assert.equal(f.context.workspaceNavigationState.detailedEditor, true); assert(f.byId('tree-search-input'));
  f.byId('studio-open-tree').dispatch('click'); await Promise.resolve();
  assert.equal(f.context.workspaceNavigationState.detailedEditor, false); assert.equal(f.byId('tree-search-input'), null);
  assert(f.byId('workspace-file-picker-search')); assert.deepEqual(f.errors, []);
});

test('実ショートカット: 左右開閉を新shellへ反映し幅・右タブ・未確定状態を保持する', () => {
  const f = harness(); f.context.studioUi.rightView = 'source'; f.ws.pendingOperations.push({ type: 'move' }); f.render();
  for (const [command, flag] of [['ui.toggleLeftPanel', 'leftOpen'], ['ui.toggleRightPanel', 'rightOpen']]) {
    const initial = f.context.studioUi[flag]; f.commands.get(command).run({ store: f.context.store }); assert.equal(f.context.studioUi[flag], !initial);
    f.commands.get(command).run({ store: f.context.store }); assert.equal(f.context.studioUi[flag], initial);
  }
  assert.equal(f.context.studioUi.rightView, 'source'); assert.equal(f.ws.pendingOperations.length, 1);
  assert.deepEqual(f.state.ui.panels, { leftPx: 360, rightPx: 340 });
});

test('本番6タブと右5タブは現パネルへ到達し、原文は編集/閲覧を切り替える', () => {
  const f = harness();
  for (const tab of ['home', 'edit', 'view', 'data', 'export', 'diagnostics']) {
    f.context.studioSetTab(tab); assert(f.byId('studio-tab-' + tab));
    if (tab === 'view') assert(f.byId('view-toolbar'));
    if (tab === 'data') assert(f.byId('runtime-panel'));
    if (tab === 'diagnostics') assert(f.byId('diagnostics-panel'));
  }
  for (const [tab, id] of [['properties', 'read-properties'], ['source', 'read-source'], ['data', 'runtime-panel'], ['references', 'references-panel'], ['diagnostics', 'diagnostics-panel']]) {
    f.byId('right-tab-' + tab).dispatch('click'); assert(f.byId(id), tab);
  }
  f.ws.mode = 'edit'; f.byId('right-tab-source').dispatch('click'); assert(f.byId('edit-source'));
  f.byId('right-tab-properties').dispatch('click'); assert(f.byId('edit-properties'));
  assert.deepEqual(f.errors, []);
});

test('右パネルの矢印移動は再描画後にフォーカスを戻し、IME入力を奪わない', () => {
  const f = harness(); f.context.studioUi.rightOpen = true; f.render();
  f.byId('right-tab-properties').dispatch('keydown', { key: 'ArrowRight', isComposing: true });
  assert.equal(f.context.studioUi.rightView, 'properties');
  f.byId('right-tab-properties').dispatch('keydown', { key: 'ArrowRight' }); f.flushFrames();
  assert.equal(f.context.studioUi.rightView, 'source'); assert.equal(f.doc.activeElement.id, 'right-tab-source');
});

test('バニラ版設定は新しい右診断を開き、描画後の設定へフォーカスを移す', () => {
  const f = harness(); f.render(); f.context.openVanillaVersionSettings(); f.flushFrames();
  assert.equal(f.context.studioUi.rightOpen, true); assert.equal(f.context.studioUi.rightView, 'diagnostics');
  assert(f.byId('vanilla-reference-settings').scrolled); assert.deepEqual(f.errors, []);
});

test('実shellのパネル表示幅は保存値と一致し、編集モードでも右幅を固定値に変えない', () => {
  const f = harness(); f.state.ui.panels = { leftPx: 420, rightPx: 460 }; f.ws.mode = 'edit'; f.render();
  assert.equal(f.byId('editor-layout').attrs.style, '--left-w:420px;--right-w:460px;');
  f.context.studioUi.leftOpen = false; f.context.studioUi.rightOpen = true; f.render();
  assert.equal(f.byId('editor-layout').attrs.style, '--left-w:420px;--right-w:460px;');
});

test('本番最大化接続は開始時のUI視点とパネル開閉を復元し、編集中の内容・右タブを保持する', async () => {
  const f = harness(), listeners = new Map(), view = { zoom: 2, viewX: 12, viewY: 14 };
  Object.assign(f.doc, { documentElement: f.doc.createElement('html'), fullscreenEnabled: false,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) });
  f.context.createPreviewViewportController = createPreviewViewportController;
  f.context.getCanvasState = () => ({ view }); f.context.fitCanvasUiView = () => { view.zoom = 5; view.viewX = 0; };
  f.context.drawCanvasNow = () => {}; f.context.setStatus = () => {};
  vm.runInContext(part('const previewViewport = createPreviewViewportController(', '\nfunction renderCanvasPanel(') + '\nthis.activeViewport = previewViewport;', f.context);
  f.context.studioUi.leftOpen = true; f.context.studioUi.rightOpen = true;
  f.ws.pendingOperations.push({ type: 'move', delta: [3, 7] });
  await f.context.toggleStudioViewport23('f'); f.flushFrames();
  assert.equal(f.context.studioUi.leftOpen, false); assert.equal(f.context.studioUi.rightOpen, false); assert.equal(view.zoom, 5);
  f.context.studioUi.rightView = 'diagnostics';
  await f.context.activeViewport.exit(); f.flushFrames();
  assert.deepEqual(view, { zoom: 2, viewX: 12, viewY: 14 });
  assert.equal(f.context.studioUi.leftOpen, true); assert.equal(f.context.studioUi.rightOpen, true);
  assert.equal(f.context.studioUi.rightView, 'diagnostics'); assert.equal(f.ws.pendingOperations.length, 1);
  f.context.activeViewport.dispose(); assert.deepEqual(f.errors, []);
});

test('最大化中のEscは要素メニューの終了を先に扱い、次のCanvas Escで最大化を終了する', async () => {
  const listeners = new Map(), doc = { documentElement: { classList: { toggle() {} } }, getElementById: () => null,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const controller = createPreviewViewportController({ document: doc }); await controller.enter(); let prevented = 0;
  const event = target => ({ key: 'Escape', target, preventDefault() { prevented++; }, stopPropagation() {} });
  listeners.get('keydown')(event({ closest: selector => selector === '#studio-context-menu' ? {} : null }));
  assert.equal(controller.active, true); assert.equal(prevented, 0);
  listeners.get('keydown')(event({ id: 'preview-canvas', closest: () => null }));
  assert.equal(controller.active, false); assert.equal(prevented, 1); controller.dispose();
});

test('Pocket定義の実pickerは解析専用表示とプレビュー停止を持ち、Classicへの切替で解除する', () => {
  const f = harness(), definitions = [{ id: 'p', profile: 'pocket', localName: 'pocket', classification: 'POCKET_ONLY', qualifiedName: 'test.pocket', sourceKind: 'imported', filePath: 'ui/example.json' },
    { id: 'c', profile: 'classic', localName: 'classic', classification: 'SCREEN', qualifiedName: 'test.classic', sourceKind: 'imported', filePath: 'ui/example.json' }];
  Object.assign(f.context, { uiDefsEditorState: {}, uiCatalogState: { status: 'ready', catalog: { files: [{ filePath: 'ui/example.json', sourceKind: 'imported', definitionIds: ['p', 'c'] }], summary: { definitions: 2, symbols: 2, pocketDefinitions: 1 } } },
    listEffectiveDefinitionsForPath: () => definitions, formatDefinitionClassification: value => value,
    openUiScreenFromImportedPack: async () => {}, resetUiCatalogState() {}, requestUiCatalogBuild() {} });
  Object.assign(f.context.screenOpenState, { selectedPath: 'ui/example.json', selectedDefinition: 'p', manualPath: '', status: 'idle' });
  const render = () => f.body.replaceChildren(f.context.renderScreenOpenSection({ fileIndex: {} })); f.context.safeRender = render;
  render(); assert.equal(f.byId('workspace-open-preview').disabled, true); assert.match(f.body.textContent, /Pocket UIはプレビュー対象外/u);
  const picker = f.byId('workspace-definition-picker'); picker.value = 'c'; picker.dispatch('change');
  assert.equal(f.context.screenOpenState.selectedDefinition, 'c'); assert.equal(f.byId('workspace-open-preview').disabled, false);
  assert.match(f.body.textContent, /Classic \/ プレビュー対象/u); assert.deepEqual(f.errors, []);
});

test('本番表示toolbarの字体・アイテムIDを含む7入力は未確定時disabledでzoom操作は残る', () => {
  const f = harness(); f.ws.pendingOperations.push({ type: 'move' });
  const noop = () => {}; Object.assign(f.context, {
    state: f.state, file: f.state.files.byId.f, key: 'f', cs: { structureMode: false, view: { zoom: 1 }, uiScaleMode: 'auto', devicePresetKey: 'desktop' },
    canvasUiScale: 2, DEVICE_CANVAS_PRESETS: { desktop: { name: 'Desktop' } }, DEFAULT_DEVICE_PRESET_KEY: 'desktop',
    navEnabled: false, navClickModeLabel: '動作確認', nativeMotionEnabled: false, canNavBack: false, canNavForward: false, canNavReset: false,
    isInventoryLayoutPreview: true, inventoryScenario: 'survival', isHudPreview: true, previewLocale: 'ja_JP', previewFontProfile: 'bitmap', previewItemIdProfile: 'bedrock-v1.26.50.4', presetLabel: 'preset',
    renderedBoxes: 0, totalNodes: 0, navStack: [], navIndex: -1, truncated: false,
    formatZoomLabel: value => value, onChangeCanvasUiScale: noop, onChangeDevicePreset: noop, onChangePreviewLocale: noop, onChangePreviewFontProfile: noop,
    onToggleStructureMode: noop, onToggleNavClickMode: noop, onNavBack: noop, onNavForward: noop, onNavReset: noop,
    fitCanvasView: noop, zoomCanvasAtPivotPx: noop, startNativeMotionPreview: noop, stopNativeMotionPreview: noop,
  });
  const source = part("  const toolbar = h('div', {\n    class: 'canvas-toolbar'", '\n  const fidelityNotice =');
  vm.runInContext(source + '\nthis.toolbar = toolbar;', f.context); f.body.replaceChildren(f.context.toolbar);
  // R37: toolbar 部分だけを評価するため、renderCanvasPanel の字体値・callback を明示的に供給する。
  const runtimeInputs = ['preview-ui-scale', 'preview-device-preset', 'preview-inventory-scenario', 'preview-hud-preset', 'preview-locale', 'preview-font-profile', 'preview-item-id-profile'];
  assert.equal(f.byId('preview-font-profile').value, 'bitmap');
  assert.equal(f.byId('preview-item-id-profile').value, 'bedrock-v1.26.50.4');
  assert.deepEqual(f.byId('preview-item-id-profile').children.map(node => node.value), ['bedrock-v1.26.50.4', 'r41-legacy-five']);
  assert.deepEqual(f.byId('preview-font-profile').children.map(node => node.value), ['bitmap', 'observed-smooth']);
  for (const id of runtimeInputs) assert.equal(f.byId(id).disabled, true, id);
  assert.equal(f.byId('preview-expand').disabled, false);
  f.ws.pendingOperations = []; f.context.syncStudioRuntimeControls21();
  for (const id of runtimeInputs) assert.equal(f.byId(id).disabled, false, id);
});

test('本番ヘルプは現ボタン名・詳細入口・最大化・CLIを案内し、旧静的サーバー案内を持たない', async () => {
  const f = harness(); const help = f.context.renderHelp();
  for (const text of ['JSON UIに確定', 'MCPACK', '詳細ツール', 'F6', 'local-node/CLI-ja.md', 'node .\\local-node\\cli.mjs help']) assert(help.textContent.includes(text), text);
  const guide = await readFile(new URL('../docs/user_guide_ja.md', import.meta.url), 'utf8');
  assert(!guide.includes('python -m http.server')); assert(!guide.includes('Undo/Redo なし'));
  assert(guide.includes('`diagnostics`')); assert(guide.includes('同じファイルの定義') || guide.includes('1 ファイルに複数定義'));
});

// revision26: 引出しは全入口から片側ずつ開ける。
test('狭幅で右表示中もホーム詳細から要素ツリーを開き、右を閉じて検索へ到達する', async () => {
  const f = harness(); f.context.window.innerWidth = 600; f.context.studioUi.rightOpen = true; f.render();
  assert.equal(f.context.studioUi.leftOpen, false);
  f.byId('studio-open-tree').dispatch('click'); await Promise.resolve();
  assert.equal(f.context.studioUi.leftOpen, true); assert.equal(f.context.studioUi.rightOpen, false);
  assert(f.byId('tree-search-input')); assert.deepEqual(f.errors, []);
});
