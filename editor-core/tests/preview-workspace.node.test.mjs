import { siteText } from '../src/i18n/site-messages.js';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';
import { createPreviewDebugRequest23 } from '../src/diagnostics/preview-debug-request23.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createLocalToggleState } from '../src/preview/local-toggle-state.js';
import { summarizeBindingQuality } from '../src/engine/binding-quality40.js';
import { previewLayoutInputKey } from '../src/preview/interaction-frame-readiness.js';
import { classifyPreviewStoreChange, createFrameCoalescer, createPreviewPerformanceMetrics, createPreviewPlayback, applyPreviewPaintAnimation, renderPreviewStateControls, sanitizePreviewDebugPayload } from '../src/ui/preview-workspace.js';

function clock() {
  const callbacks = new Map(); let id = 0;
  return { request(fn) { callbacks.set(id, fn); return id++; }, cancel(key) { callbacks.delete(key); }, run(time) { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(time); }, get size() { return callbacks.size; } };
}
function state() { return { ui: { route: 'editor', panels: { rightPx: 0 } } }; }
test('要素選択は通常画面で全DOMを作り直さない', () => {
  const previous = state();
  for (const type of ['editor/selectNode', 'editor/clearSelection']) assert.equal(classifyPreviewStoreChange(state(), previous, { type }), 'canvas');
});
test('選択を表示する詳細パネルが開いているときだけDOM更新する', () => {
  const next = state(); next.ui.panels.rightPx = 300;
  assert.equal(classifyPreviewStoreChange(next, state(), { type: 'editor/selectNode' }), 'full');
  assert.equal(classifyPreviewStoreChange(state(), state(), { type: 'editor/selectNode' }, { detailed: true }), 'full');
});
test('状態データ・UI定義・ファイル切替は更新対象', () => {
  for (const type of ['preview/setMockData', 'files/openFile', 'files/setCurrentFile', 'ui/setPreviewLocale']) assert.equal(classifyPreviewStoreChange(state(), state(), { type }), 'full');
});
test('未変更と通常debug切替は描画しない', () => {
  const same = state(); assert.equal(classifyPreviewStoreChange(same, same, {}), 'none');
  assert.equal(classifyPreviewStoreChange(state(), state(), { type: 'ui/toggleDebug' }), 'none');
});
test('5000連続変更を1回へ合流し、request ID 0を正しく扱う', () => {
  const c = clock(); let calls = 0; const queued = createFrameCoalescer(c.request, c.cancel, () => { calls += 1; });
  for (let i = 0; i < 5000; i++) queued.request();
  assert.equal(c.size, 1); c.run(0); assert.equal(calls, 1); assert.equal(queued.pending, false);
  queued.request(); queued.cancel(); c.run(16); assert.equal(calls, 1);
});
test('合流コールバック中の再要求は次のフレームに送る', () => {
  const c = clock(); let calls = 0; let queued;
  queued = createFrameCoalescer(c.request, c.cancel, () => { calls++; if (calls === 1) queued.request(); });
  queued.request(); c.run(0); assert.equal(calls, 1); assert.equal(c.size, 1); c.run(16); assert.equal(calls, 2);
});
test('計測は有限の集計だけ保持し不正値は無視する', () => {
  const m = createPreviewPerformanceMetrics(); m.record('draw', 10); m.record('draw', 70); m.record('unknown', 500); m.record('draw', Infinity);
  assert.deepEqual(m.snapshot(), { draw: { count: 2, totalMs: 80, maxMs: 70, over50ms: 1, meanMs: 40 } });
  const snapshot = m.snapshot(); snapshot.draw.count = 0; assert.equal(m.snapshot().draw.count, 2);
});
test('30fps再生は144Hz画面でも時刻で進行し無駄な描画を抑える', () => {
  const c = clock(), frames = []; const player = createPreviewPlayback({ requestFrame: c.request, cancelFrame: c.cancel, onFrame: (t) => frames.push(t), canPlay: () => true });
  player.play(); for (let i = 0; i <= 144; i++) c.run(i * 1000 / 144);
  assert.ok(frames.length >= 25 && frames.length <= 31); assert.ok(frames.at(-1) >= 0.96 && frames.at(-1) <= 1);
  player.pause(); assert.equal(c.size, 0);
});
test('再生は60秒で停止し時間指定は境界へ制限される', () => {
  const c = clock(), frames = []; const player = createPreviewPlayback({ requestFrame: c.request, cancelFrame: c.cancel, onFrame: (t) => frames.push(t), canPlay: () => true });
  player.play(); c.run(0); c.run(61000); assert.equal(player.state.playing, false); assert.equal(player.state.seconds, 60); assert.equal(c.size, 0);
  player.seek(-10); assert.equal(player.state.seconds, 0); player.seek(Infinity); assert.equal(player.state.seconds, 0); player.seek(1000); assert.equal(player.state.seconds, 60);
});
test('非表示・ルート離脱条件で停止し保留RAFを除去する', () => {
  const c = clock(); let visible = true, calls = 0;
  const player = createPreviewPlayback({ requestFrame: c.request, cancelFrame: c.cancel, onFrame: () => calls++, canPlay: () => visible });
  player.play(); c.run(0); visible = false; c.run(40); assert.equal(calls, 1); assert.equal(c.size, 0); assert.equal(player.state.playing, false);
});
test('再生中の描画例外はループを停止して呼出元へ返す', () => {
  const c = clock(); const player = createPreviewPlayback({ requestFrame: c.request, cancelFrame: c.cancel, onFrame: () => { throw new Error('draw failure'); }, canPlay: () => true });
  player.play(); assert.throws(() => c.run(0), /draw failure/); assert.equal(player.state.playing, false); assert.equal(c.size, 0);
});
test('alpha伝搬は描画順不同でも親のpropagate_alphaに従う', () => {
  const layout = { boxes: [{ id: 'child', parentId: 'middle' }, { id: 'middle', parentId: 'root' }, { id: 'root', parentId: 'file' }] };
  const nodes = { root: { props: { alpha: 0.5, propagate_alpha: true } }, middle: { props: { alpha: 0.2, propagate_alpha: false } }, child: { props: { alpha: 0.5 } } };
  const output = applyPreviewPaintAnimation(layout, nodes, {});
  assert.deepEqual(output.boxes.map((box) => box.renderAlpha), [0.25, 0.1, 0.5]); assert.equal(layout.boxes[0].renderAlpha, undefined);
});
test('alpha差分変更は基底propsと元boxを変更しない', () => {
  const layout = { boxes: [{ id: 'root' }, { id: 'child', parentId: 'root' }] }, nodes = { root: { props: { alpha: 1, propagate_alpha: true } }, child: { props: { alpha: 0.5 } } };
  assert.deepEqual(applyPreviewPaintAnimation(layout, nodes, { root: { alpha: 0.2 } }).boxes.map((box) => box.renderAlpha), [0.2, 0.1]);
  assert.equal(nodes.root.props.alpha, 1); assert.equal(layout.boxes[0].renderAlpha, undefined);
});
test('不正な親循環でもalpha評価は有限', () => {
  const out = applyPreviewPaintAnimation({ boxes: [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }] }, {}, {});
  assert.equal(out.boxes.length, 2); assert.ok(out.boxes.every((b) => Number.isFinite(b.renderAlpha)));
});
test('状態JSON入力中は反映せず適用ボタンで一度だけ反映する', () => {
  const elements = [], inputState = { text: '{}' }; let applied = 0;
  const h = (tag, attrs = {}, children = []) => { const node = { tag, attrs, children }; elements.push(node); return node; };
  renderPreviewStateControls(h, { state: inputState, presets: [], onApply: () => applied++, onPreset: () => {}, onDownload: () => {}, disabled: false });
  const input = elements.find((e) => e.tag === 'textarea'); input.attrs.onInput({ currentTarget: { value: '{"furnace":{"progress":0.5}}' } });
  assert.equal(applied, 0); assert.match(inputState.text, /furnace/); assert.equal(input.attrs.maxlength, '262144');
  elements.find((e) => e.children?.includes('状態を適用')).attrs.onClick(); assert.equal(applied, 1);
});
test('状態入力と各操作にアクセシビリティの名前が存在する', () => {
  const elements = []; const h = (tag, attrs = {}, children = []) => { const node = { tag, attrs, children }; elements.push(node); return node; };
  renderPreviewStateControls(h, { state: {}, presets: [{ id: 'furnace', label: 'かまど' }], onApply() {}, onPreset() {}, onDownload() {}, disabled: true });
  for (const control of elements.filter((e) => ['textarea', 'select', 'button'].includes(e.tag))) { assert.ok(control.attrs['aria-label'] || control.children.length); assert.equal(control.attrs.disabled, true); }
});
test('デバッグ保存で機密キー・Bearer文字列をマスクしaccessorを実行しない', () => {
  let called = false; const input = { token: 'secret', nested: { password: 'secret', message: 'Bearer abc.def-xyz' } }; Object.defineProperty(input, 'evil', { enumerable: true, get() { called = true; throw new Error(); } });
  const out = sanitizePreviewDebugPayload(input); assert.equal(called, false); assert.equal(out.token, '[REDACTED]'); assert.equal(out.nested.password, '[REDACTED]'); assert.equal(out.nested.message, '[REDACTED_AUTH]'); assert.equal(out.evil, '[ACCESSOR]');
});
test('巨大/循環デバッグ入力でも1MiB未満の有限JSONになる', () => {
  const input = { schema: 'jsonui-debug-request-v1', diagnostics: Array.from({ length: 1000 }, () => ({ message: 'あ'.repeat(10000) })) }; input.cycle = input;
  const output = sanitizePreviewDebugPayload(input); const bytes = new TextEncoder().encode(JSON.stringify(output)).byteLength;
  assert.ok(bytes < 1024 * 1024, String(bytes)); assert.equal(output.schema, input.schema); assert.match(JSON.stringify(output), /\[(?:CIRCULAR|TRUNCATED)\]/u);
});

test('本番ensurePreviewLayoutは同じ入力1000回でlayoutを1回しか計算しない', async () => {
  const { readFile } = await import('node:fs/promises'); const { default: vm } = await import('node:vm');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function ensurePreviewLayout(state) {'), end = source.indexOf('\nconst previewViewport =', start);
  assert.ok(start > 0 && end > start); const definition = source.slice(start, end).replaceAll('import.meta.url', JSON.stringify(new URL('../src/main.js', import.meta.url).href));
  const file = { id: 'test', nodesById: {}, rootId: 'root' }; let computes = 0, intrinsic = 0;
  const cs = { structureMode: false, scrollById: {} }, input = { files: { currentFileId: 'test', byId: { test: file } }, ui: { previewLocale: 'en_US' }, preview: { mockDataVersion: 0 } };
  const environment = { crypto:webcrypto, createLocalToggleState, summarizeBindingQuality, previewLayoutInputKey, sourceWorkspace: createWorkspaceEditor({ request: async () => { throw new Error('UNEXPECTED_WORKSPACE_IO'); } }), nodeFrameAvailability: false, checkNodeFrameAvailability() {}, nodeFrameController: { invalidate() {} }, performance, getCanvasKey: (id) => id, getCanvasState: () => cs, getLogicalCanvasPreset: () => ({ width: 480, height: 270 }), previewAssetMetricsRevision: 0,
    getOrComputeBindingsEvalResult: () => ({ propsById: {}, stats: {}, warnings: [] }), mergeCachedTextureIntrinsicSizes: (_file, p) => { intrinsic++; return p; }, mergeTextIntrinsicSizes: (_file, p) => p,
    computeLayoutBoxesForFile: () => { computes++; return { boxes: [], stats: {} }; }, findCanvasUiFocusBounds: () => null, previewPerformance: createPreviewPerformanceMetrics(), diagnostics: { captureError() {} } };
  const sessionStart=source.indexOf('function ensureLocalToggleSession40('), sessionEnd=source.indexOf('\n}\n',sessionStart)+3;
  assert(sessionStart>=0 && sessionEnd>sessionStart);
  vm.createContext(environment); vm.runInContext(`${source.slice(sessionStart,sessionEnd)}\n${definition}\nthis.ensure = ensurePreviewLayout;`, environment);
  for (let i = 0; i < 1000; i++) environment.ensure(input);
  assert.equal(computes, 1); assert.equal(intrinsic, 1);
  input.preview.mockDataVersion++; environment.ensure(input); assert.equal(computes, 2);
  environment.previewAssetMetricsRevision++; environment.ensure(input); assert.equal(computes, 3);
  cs.scrollRevision = 1; environment.ensure(input); assert.equal(computes, 4);
  cs.structureMode = true; environment.ensure(input); assert.equal(computes, 5);
  input.ui.previewLocale = 'ja_JP'; environment.ensure(input); assert.equal(computes, 6);
  input.files.byId.test = { ...file }; environment.ensure(input); assert.equal(computes, 7);
});

async function debugDownloadHarness({ rejectNode = false, delayNode = false, input = '{}', errorMessage = 'NODE_OFFLINE' } = {}) {
  const { readFile } = await import('node:fs/promises'); const { default: vm } = await import('node:vm');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function downloadCompleteDebugBundle() {'), end = source.indexOf('\nfunction renderRuntimeStatePanel()', start);
  assert.ok(start >= 0 && end > start);
  const saved = [], statuses = [], requests = [], errors = []; let resolve;
  const pending = new Promise((yes) => { resolve = yes; });
  const context = vm.createContext({ siteText, navigator: { userAgent: 'test', platform: 'test', language: 'ja' }, runtimeStateEditor: { text: input }, actionLog: [],
    getNodeRequestLog35: () => ({ recent: [], failures: [] }), setStatus: (s) => statuses.push(s), buildCurrentPreviewDiagnosticContext: () => ({ selectedUi: { fileId: null, filePath: null, definitionId: null } }), sanitizePreviewDebugPayload, createPreviewDebugRequest23,
    store: { getState: () => ({ preview: { mockData: { '#fuel': 0.5 } } }) }, diagnostics: { getEntries: () => [], captureError: (e) => errors.push(e.message) },
    downloadNodeDebugBundle: async (payload) => { requests.push(payload); if (delayNode) await pending; if (rejectNode) throw new Error(errorMessage); return new Blob(['{}']); },
    downloadBlobFile: (value) => saved.push(value), downloadTextFile: (value) => saved.push(value), makeSafeFileTimestamp: () => 'fixed',
  });
  vm.runInContext(`let debugBundleBusy = false; ${source.slice(start, end)}; this.runDownload = downloadCompleteDebugBundle; this.busy = () => debugBundleBusy;`, context);
  return { run: context.runDownload, busy: context.busy, saved, statuses, requests, errors, resolve };
}
test('本番ログ取得関数は選択UIなし・空ログでもNode統合JSONを一度保存する', async () => {
  const h = await debugDownloadHarness(); await h.run(); assert.equal(h.requests.length, 1); assert.equal(h.saved.length, 1); assert.match(h.saved[0].filename, /debug_bundle/); assert.equal(h.requests[0].selection.screenId, null); assert.equal(h.busy(), false); assert.match(h.statuses[0], /まとめています/); assert.match(h.statuses.at(-1), /保存しました/);
});
test('本番ログ取得関数はNode失敗を明記してブラウザ記録を保存する', async () => {
  const h = await debugDownloadHarness({ rejectNode: true }); await h.run(); assert.equal(h.saved.length, 1); assert.match(h.saved[0].filename, /browser_only/); const saved = JSON.parse(h.saved[0].text); assert.equal(saved.nodeLogsUnavailable, 'NODE_OFFLINE'); assert.equal(h.errors.length, 1); assert.equal(h.busy(), false); assert.match(h.statuses.at(-1), /取得できなかった/);
});
test('本番ログ取得関数の連打は要求を重複せず完了後の再取得は可能', async () => {
  const h = await debugDownloadHarness({ delayNode: true }); const first = h.run(); await h.run(); assert.equal(h.requests.length, 1); assert.equal(h.busy(), true); h.resolve(); await first; assert.equal(h.busy(), false); await h.run(); assert.equal(h.requests.length, 2); assert.equal(h.saved.length, 2);
});
test('本番ログ取得関数は未適用JSON内の機密も構造化してマスクする', async () => {
  const h = await debugDownloadHarness({ input: '{"mockData":{"secret":"PRIVATE_TEST_VALUE"}}' }); await h.run(); const serialized = JSON.stringify(h.requests[0]); assert.ok(!serialized.includes('PRIVATE_TEST_VALUE')); assert.match(serialized, /REDACTED/);
});
test('本番ログ取得関数は編集中の不正JSONをそのままログへ保存しない', async () => {
  const h = await debugDownloadHarness({ input: 'PRIVATE_DRAFT_' }); await h.run(); assert.equal(h.requests[0].state.input.parseStatus, 'invalid'); assert.equal(h.requests[0].state.input.characters, 14); assert.ok(!JSON.stringify(h.requests[0]).includes('PRIVATE_DRAFT'));
});

test('ブラウザとNodeはURL認証・query・fragment・OSパスを同じ契約で除去する', async () => {
  const { sanitizeDiagnostic } = await import('../../local-node/debug-bundle.mjs');
  const cases = [
    'fetch https://USER_MARKER:PASS_MARKER@example.test/api?token=QUERY_MARKER#FRAGMENT_MARKER failed',
    'failed C:\\Users\\PERSON_MARKER\\Desktop\\private.log',
    'failed \\\\HOST_MARKER\\SHARE_MARKER\\private.log',
    'at /home/PERSON_MARKER/private/a.js:3',
    'at /workspace/PERSON_MARKER/private/a.js:3',
    'Authorization: Basic QVVUSF9NQVJLRVI=',
    'password=PASSWORD_MARKER token=TOKEN_MARKER api_key=API_MARKER',
    'textures/ui/slot.png ui/server_form.json',
  ];
  for (const input of cases) {
    const browser = sanitizePreviewDebugPayload({ message: input }).message;
    const node = sanitizeDiagnostic({ message: input }).data.message;
    assert.equal(browser, node, input);
    assert.ok(!/(?:USER_MARKER|PASS_MARKER|QUERY_MARKER|FRAGMENT_MARKER|PERSON_MARKER|HOST_MARKER|SHARE_MARKER|PASSWORD_MARKER|TOKEN_MARKER|API_MARKER|QVVUSF9NQVJLRVI)/u.test(browser), browser);
  }
  assert.equal(sanitizePreviewDebugPayload({ message: cases.at(-1) }).message, cases.at(-1));
});
test('本番fallback末尾の例外文字列も再投影し機密・OSパスを再露出しない', async () => {
  const h = await debugDownloadHarness({ rejectNode: true, errorMessage: 'failed https://PERSON_MARKER:PASS_MARKER@example.test/api?access_token=QUERY_MARKER#FRAGMENT_MARKER at C:\\Users\\PERSON_MARKER\\Documents\\private.log' });
  await h.run(); const saved = h.saved[0].text;
  for (const marker of ['PERSON_MARKER', 'PASS_MARKER', 'QUERY_MARKER', 'FRAGMENT_MARKER', 'private.log']) assert.ok(!saved.includes(marker), marker);
  const payload = JSON.parse(saved); assert.match(payload.nodeLogsUnavailable, /example.test/); assert.match(payload.nodeLogsUnavailable, /LOCAL_PATH/);
});
test('ブラウザfallbackはNodeと同じ機密キー・原文除外キーを扱う', () => {
  const output = sanitizePreviewDebugPayload({ passwd: 'private', credential: 'private', rawText: 'raw body', headers: { arbitrary: 'private' }, argv: ['private'], selection: { filePath: 'ui/server_form.json' } });
  assert.equal(output.passwd, '[REDACTED]'); assert.equal(output.credential, '[REDACTED]');
  assert.ok(!Object.hasOwn(output, 'rawText')); assert.ok(!Object.hasOwn(output, 'headers')); assert.ok(!Object.hasOwn(output, 'argv'));
  assert.equal(output.selection.filePath, 'ui/server_form.json');
});

test('自由文内の引用符付き機密値と既知の単独tokenも除去する', async () => {
  const { sanitizeDebugText } = await import('../src/diagnostics/debug-redaction.js');
  const input = 'password="QUOTED_MARKER" {"secret":"JSON_MARKER"} passwd: \'SINGLE_MARKER\' EXACT_MARKER';
  const output = sanitizeDebugText(input, { secrets: ['EXACT_MARKER'] });
  for (const marker of ['QUOTED_MARKER', 'JSON_MARKER', 'SINGLE_MARKER', 'EXACT_MARKER']) assert.ok(!output.includes(marker), marker);
  assert.match(output, /REDACTED/);
});
test('長いUnicodeキーを大量指定しても保存payloadの1MiB制限を超えない', () => {
  const rows = Array.from({ length: 300 }, (_, outer) => Object.fromEntries(Array.from({ length: 30 }, (_, inner) => [`長いキー${outer}_${inner}_` + 'あ'.repeat(500), inner])));
  const output = sanitizePreviewDebugPayload({ schema: 'jsonui-debug-request-v1', diagnostics: rows });
  assert.ok(new TextEncoder().encode(JSON.stringify(output)).byteLength < 1024 * 1024);
});

test('自由文の複数Cookie値は行全体を除去しsession識別子はマスクする', () => {
  const output = sanitizePreviewDebugPayload({ message: 'Cookie: first=FIRST_COOKIE; second=SECOND_COOKIE\nNODE_OFFLINE', sessionId: 'SESSION_MARKER', session_id: 'SESSION_MARKER' });
  assert.ok(!JSON.stringify(output).includes('COOKIE;')); assert.ok(!JSON.stringify(output).includes('FIRST_COOKIE')); assert.ok(!JSON.stringify(output).includes('SECOND_COOKIE')); assert.ok(!JSON.stringify(output).includes('SESSION_MARKER'));
  assert.match(output.message, /NODE_OFFLINE/);
});
test('状態データが予算を使い切ってもNode要求の最上位型とschemaを保持する', async () => {
  const { validateDebugRequest } = await import('../../local-node/debug-bundle.mjs');
  const input = { schema: 'jsonui-debug-request-v1', browser: {}, selection: {}, state: { rows: Array.from({ length: 300 }, () => 'あ'.repeat(4096)) }, diagnostics: [{ message: 'later' }], events: [{ type: 'later' }] };
  const output = sanitizePreviewDebugPayload(input);
  assert.equal(output.schema, input.schema); assert.ok(Array.isArray(output.diagnostics)); assert.ok(Array.isArray(output.events));
  assert.doesNotThrow(() => validateDebugRequest(output));
  assert.ok(new TextEncoder().encode(JSON.stringify(output)).byteLength < 1024 * 1024);
});

async function productionAnimationHarness({ looping = false, duration = 2 } = {}) {
  const { readFile } = await import('node:fs/promises'); const { default: vm } = await import('node:vm');
  const { compilePreviewAnimations, samplePreviewAnimations } = await import('../src/engine/preview-animation.js');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('  onFrame: (seconds) => {', source.indexOf('const previewPlayback = createPreviewPlayback({'));
  const end = source.indexOf('\n  },\n});', start);
  assert.ok(start >= 0 && end > start);
  const callback = source.slice(start + '  onFrame: '.length, end) + '\n  }';
  const uiModel = { namespace: 'a', root: { id: 'root', props: { anims: ['@a.fade'] }, unknownProps: {}, children: [], bindings: [] } };
  const plan = compilePreviewAnimations(uiModel, { definitions: { 'a.fade': { anim_type: 'alpha', from: 0, to: 1, duration, ...(looping ? { next: '@a.fade' } : {}) } } });
  const file = { id: 'file', uiModel, nodesById: { root: { props: { alpha: 1 } } } }, cs = { basePropsByIdOverride: {}, baseLayout: { boxes: [{ id: 'root', x: 0, y: 0, w: 20, h: 20 }] } };
  const events = [], c = clock();
  const context = vm.createContext({ siteText, sourceWorkspace: createWorkspaceEditor({ request: async () => { throw new Error('UNEXPECTED_WORKSPACE_IO'); } }), nodeFrameAvailability: false, performance, store: { getState: () => ({ files: { currentFileId: 'file', byId: { file } } }) }, ensurePreviewLayout: () => cs, getPreviewAnimationPlan: () => plan, samplePreviewAnimations, applyPreviewPaintAnimation,
    getCanvasKey: (id) => id, drawCanvasNow: () => events.push({ action: 'draw', alpha: cs.layout.boxes[0].renderAlpha }),
    computeLayoutBoxesForFile: () => { throw new Error('ALPHA_MUST_NOT_RELAYOUT'); }, previewPerformance: createPreviewPerformanceMetrics(), diagnostics: { log: () => events.push({ action: 'warning' }) } });
  // Include the actual guard body; pending edits must remain observable in this VM.
  const guardStart = source.indexOf('function studioRuntimeChangesBlocked21() {');
  const guardEnd = source.indexOf('\n}\n', guardStart);
  if (guardStart < 0 || guardEnd < guardStart) throw new Error('PRODUCTION_RUNTIME_GUARD_NOT_FOUND');
  vm.runInContext(`${source.slice(guardStart, guardEnd + 2)}\nthis.frameCallback = ${callback};`, context);
  const player = createPreviewPlayback({ requestFrame: c.request, cancelFrame: c.cancel, canPlay: () => true, onFrame: context.frameCallback, onChange: (state) => events.push({ action: state.playing ? 'playing' : 'stopped', time: state.seconds }) });
  context.previewPlayback = player;
  return { player, c, events };
}
test('本番animation接続は単発終端frameを描画してから停止し次RAFを予約しない', async () => {
  const { player, c, events } = await productionAnimationHarness(); player.play(); c.run(0); c.run(2000);
  assert.equal(player.state.playing, false); assert.equal(c.size, 0);
  const draws = events.filter((e) => e.action === 'draw'); assert.deepEqual(draws.map((d) => d.alpha), [0, 1]);
  const terminalDraw = events.findIndex((e) => e.action === 'draw' && e.alpha === 1), stop = events.findIndex((e) => e.action === 'stopped'); assert.ok(terminalDraw < stop);
  c.run(3000); assert.equal(events.filter((e) => e.action === 'draw').length, 2);
});
test('本番animation接続はloopingの終端で停止しない', async () => {
  const { player, c, events } = await productionAnimationHarness({ looping: true }); player.play(); c.run(0); c.run(2000);
  assert.equal(player.state.playing, true); assert.equal(c.size, 1); assert.equal(events.filter((e) => e.action === 'stopped').length, 0); player.pause();
});
test('本番animation接続はduration0でも終端frameを1回描いて停止する', async () => {
  const { player, c, events } = await productionAnimationHarness({ duration: 0 }); player.play(); c.run(0);
  assert.equal(player.state.playing, false); assert.equal(c.size, 0); assert.deepEqual(events.filter((e) => e.action === 'draw').map((d) => d.alpha), [1]);
});
