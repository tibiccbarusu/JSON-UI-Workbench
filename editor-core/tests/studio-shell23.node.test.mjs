import * as insert35 from '../src/ui/studio-insert35.js';
import * as layout28 from '../src/ui/studio-layout28.js';
/** 実 main の h とリボンを最小DOMモデルで結合検査する。実ブラウザ描画検査ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as shell from '../src/ui/studio-shell.js';
import { siteText } from '../src/i18n/site-messages.js';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../app/styles.css', import.meta.url), 'utf8');
function section(from, to) {
  const start = main.indexOf(from), end = main.indexOf(to, start);
  assert(start >= 0 && end > start, `main 境界が必要: ${from}`); return main.slice(start, end);
}
class DomNode {
  constructor(tag = '', text = '') { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map(); this._text = text; this.className = ''; }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  get id() { return this.attributes.id || ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatch(name, extra = {}) { return this.listeners.get(name)?.({ target: this, currentTarget: this, preventDefault() {}, ...extra }); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelector(selector) { return this.all().find(node => selector.startsWith('#') ? node.id === selector.slice(1) : selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tagName === selector.toUpperCase()) || null; }
  get classList() { return { toggle: (name, value) => { const current = new Set(this.className.split(' ').filter(Boolean)); if (value) current.add(name); else current.delete(name); this.className = [...current].join(' '); } }; }
}
function harness({ editing = false, tab = 'home', pending = 0, busy = false } = {}) {
  const actions = [], errors = [], root = new DomNode('body'), frames = [];
  const doc = { createElement: tag => new DomNode(tag), createTextNode: text => new DomNode('', text), getElementById: id => root.querySelector(`#${id}`) };
  const state = { files: { currentFileId: 'f', byId: { f: { id: 'f', path: 'ui/test.json', nodesById: { n: {} } } } } };
  const workspace = { state: { mode: editing ? 'edit' : 'preview', busy, pendingOperations: Array.from({ length: pending }, () => ({})), pendingRedoOperations: [], canUndo: false, canRedo: false, editScope: 'shared', selectedPointer: '/test', workspaceId: 'w' },
    setMode: value => actions.push(['mode', value]), history: value => actions.push(['history', value]),
    discardPending: () => actions.push(['discard']), applyPending: () => actions.push(['apply']), planDelete: () => actions.push(['delete']), refresh: () => actions.push(['refresh']),
  };
  const s = vm.createContext({ ...shell, ...layout28, ...insert35, siteText, studioDelete31:()=>actions.push(['delete']), window: { innerWidth: 1920 }, Node: DomNode, document: doc, console, sourceWorkspace: workspace,
    studioUi: { tab, leftOpen: true, rightOpen: false, rightView: 'properties', details: Object.create(null), viewControls: new DomNode('div') },
    workspaceNavigationState: { detailedEditor: false },
    sourceWorkspaceDraft23: { getStatus: () => ({ status: pending ? 'ready' : 'idle' }), flush: () => actions.push(['draft-retry']) },
    studioSelection21: () => ({ snapshot: () => ({ canGroup: true, canUngroup: true, canUndoGroup: true, canRedoGroup: false }) }),
    studioInvoke: callback => Promise.resolve().then(callback).catch(error => errors.push(error)),
    studioSetTab: value => { s.studioUi.tab = value; actions.push(['tab', value]); },
    importedPackRuntime: {}, vanillaReferenceRuntime: null, previewPlayback: { pause: () => {} }, hidePreviewEditBoxOverlay: () => {},
    ensureSourceWorkspace: () => {}, screenOpenState: {}, safeRender: () => actions.push(['render']),
    fitCanvasUiView: () => actions.push(['fit']), getCanvasKey: id => id,
    studioGroupSelection21: () => actions.push(['group']), studioUngroupSelection21: () => actions.push(['ungroup']),
    studioGroupHistory21: value => actions.push(['group-history', value]), studioSaveGroups21: () => actions.push(['group-save']), studioLoadGroups21: () => {},
    renderWorkspaceEditPolicy: h => h('fieldset', { id: 'policy-contract' }, ['実運用の編集方針を接続']),
    renderSourceWorkspaceToolbar: () => { const legacy = new DomNode('div'); const exportSection = new DomNode('details'); exportSection.className = 'workspace-export-section'; legacy.append(exportSection); return legacy; },
    downloadCompleteDebugBundle: () => actions.push(['debug']), reportWorkspaceError: error => errors.push(error), sanitizeUrlForAttribute: value => String(value),
    previewViewport: { active: false, setRibbonPinned: value => actions.push(['pin', value]), hideRibbon: options => actions.push(['hide', options]) },
    requestAnimationFrame: callback => frames.push(callback), syncStudioRuntimeControls21: () => {},
  });
  vm.runInContext(section('function h(tag,', '\n/**\n * @param {{type:') + section('function renderStudioRibbon(state)', '\nfunction renderEditor(state)'), s);
  function render() { root.children = []; const ribbon = s.renderStudioRibbon(state); root.append(ribbon); return ribbon; }
  return { s, state, workspace, root, actions, errors, frames, render, byId: id => doc.getElementById(id) };
}

test('実mainリボン: 初期ホームに短いタブと未確定状態を表示し、破棄は詳細へ保持する', () => {
  const f = harness(); const ribbon = f.render();
  assert.equal(ribbon.id, 'studio-ribbon');
  const tabs = ribbon.all().filter(node => node.attributes.role === 'tab');
  assert.equal(tabs.length, 7); assert.equal(tabs.filter(node => node.attributes['aria-selected'] === 'true').length, 1);
  assert.equal(f.byId('studio-apply-pending').disabled, true);
  assert.equal(f.byId('studio-pending-status').textContent, 'JSON UIへの未確定変更なし');
  assert.equal(f.byId('studio-undo-more').open, false);
  assert.equal(f.byId('studio-discard-pending').parentNode.parentNode.id, 'studio-undo-more');
  assert.equal(f.byId('studio-home-help').open, false);
  assert.deepEqual(f.errors, []);
});

test('実mainリボン: 未確定編集は自動applyせず明示ボタンだけでJSON UIへ確定する', async () => {
  const f = harness({ editing: true, pending: 2 }); f.render();
  assert.match(f.byId('studio-pending-status').textContent, /編集中 2件/u);
  assert.equal(f.actions.length, 0);
  assert.equal(f.byId('studio-apply-pending').textContent, 'JSON UIに確定（2件）');
  assert.equal(f.byId('studio-apply-pending').disabled, false);
  f.byId('studio-apply-pending').dispatch('click'); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.actions[0], ['apply']); assert.deepEqual(f.errors, []);
});

test('実mainリボン: 編集タブは既存group操作と追加種類/適用方針を保持する', async () => {
  const f = harness({ editing: true, tab: 'edit' }); f.render();
  assert.equal(f.byId('studio-group-more').open, false);
  assert.equal(f.byId('studio-element-more'), null, '基本の削除を折畳みに隠さない');
  for (const id of ['studio-delete','studio-insert-open35']) {let n=f.byId(id); assert(n); for(;n;n=n.parentNode)assert.notEqual(n.tagName,'DETAILS',id);}
  assert.ok(f.byId('policy-contract')); assert.equal(f.byId('workspace-add-type'), null);
  for (const id of ['studio-group', 'studio-ungroup', 'studio-group-undo', 'studio-group-redo', 'studio-save-groups', 'studio-load-groups', 'studio-group-file', 'studio-delete']) assert.ok(f.byId(id), id);
  f.byId('studio-group').dispatch('click'); await Promise.resolve();
  assert.deepEqual(f.actions[0], ['group']); assert.deepEqual(f.errors, []);
});

test('詳細開閉がDOM再生成後も維持され、開閉だけで重い再描画を起動しない', () => {
  const f = harness({ tab: 'edit' }); f.render();
  const details = f.byId('studio-group-more'); details.open = true; details.dispatch('toggle');
  assert.equal(f.actions.length, 0); f.render(); assert.equal(f.byId('studio-group-more').open, true);
});

test('左右矢印・Home・Endでタブを移動し、IME中や通常文字を奪わない', () => {
  const f = harness(); f.render();
  let prevented = 0; const press = key => f.byId('studio-tab-home').dispatch('keydown', { key, preventDefault() { prevented++; } });
  press('ArrowLeft'); assert.deepEqual(f.actions.at(-1), ['tab', 'diagnostics']);
  press('ArrowRight'); assert.deepEqual(f.actions.at(-1), ['tab', 'edit']);
  press('Home'); assert.deepEqual(f.actions.at(-1), ['tab', 'home']);
  press('End'); assert.deepEqual(f.actions.at(-1), ['tab', 'diagnostics']);
  f.byId('studio-tab-home').dispatch('keydown', { key: 'ArrowRight', isComposing: true, preventDefault() { prevented++; } }); press('a');
  assert.equal(prevented, 4); assert.equal(f.frames.length, 4);
});

test('全7タブのDOMを生成でき、exportは既存選択書き出しsectionを保持する', () => {
  for (const tab of ['home', 'edit', 'insert', 'view', 'data', 'export', 'diagnostics']) {
    const f = harness({ editing: true, tab }); const ribbon = f.render();
    assert.equal(f.byId('studio-ribbon-content').attributes['aria-labelledby'], `studio-tab-${tab}`);
    assert.equal(f.byId(`studio-tab-${tab}`).attributes['aria-selected'], 'true');
    if (tab === 'export') assert.equal(ribbon.querySelector('.workspace-export-section').open, true);
    assert.deepEqual(f.errors, []);
  }
});

test('最大化操作バーのボタンはcontrollerへ表示・固定・終了を接続する', () => {
  const f = harness(), calls = [];
  const viewport = { ribbonVisible: false, ribbonPinned: false, showRibbon: value => calls.push(['show', value.focus]), setRibbonPinned: value => calls.push(['pin', value]), exit: () => calls.push(['exit']) };
  f.root.append(shell.renderStudioExpandedBar(f.s.h, viewport));
  f.byId('studio-expanded-reveal').dispatch('click'); f.byId('studio-expanded-pin').dispatch('click'); f.byId('studio-expanded-exit').dispatch('click');
  assert.deepEqual(calls, [['show', true], ['pin', true], ['exit']]);
  assert.equal(f.byId('studio-expanded-reveal').attributes['aria-controls'], 'studio-ribbon');
});

test('CSS契約: 全画面shell/リボン/文脈メニューの前後関係と狭幅・動き軽減を保持する', () => {
  assert.match(css, /html\.preview-expanded \.studio-workspace,[\s\S]*?z-index: 9000/u);
  assert.match(css, /html\.preview-expanded \.studio-ribbon\s*\{[\s\S]*?visibility: hidden; pointer-events: none/u);
  assert.match(css, /preview-ribbon-visible \.studio-ribbon\s*\{[^}]*visibility: visible; pointer-events: auto/u);
  assert.match(css, /preview-ribbon-pinned \.studio-ribbon\s*\{[^}]*position: relative/u);
  assert.match(css, /html\.preview-expanded \.studio-context-menu[^}]*z-index: 10041/u);
  assert.match(css, /@media \(max-width: 560px\)/u); assert.match(css, /prefers-reduced-motion: reduce/u);
  assert.match(css, /\.pack-export-fields\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/u);
});

test('左ペインは状態データの重複入力を持たず、データタブに残る', () => {
  const left = section('function renderPackImportSection(', '\n/**\n * @param {import(');
  assert.doesNotMatch(left, /renderRuntimeStatePanel\(/u);
  assert.match(section('function renderEditor(state)', '\n/* --- S033:'), /if \(tabId === 'data'\) return renderRuntimeStatePanel\(\)/u);
});
