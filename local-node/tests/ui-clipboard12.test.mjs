import { createPreviewObservationTrace, capturePreviewInputSnapshot, isPreviewInputContextCurrent, evaluatePreviewInputRelease } from '../../editor-core/src/preview/preview-observation41.js';
// 実行: node --test local-node/tests/ui-clipboard12.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderedTextSegment as segment, buildRenderedTextSnapshot as snapshot,
  describeSelectedTextCopy as describe, sameClipboardScope } from '../../editor-core/src/preview/ui-text-copy.js';
import { createClipboardBroker } from '../../editor-core/src/preview/ui-clipboard-broker.js';
import { buildClipboardDataSources, resolveClipboardAdapter } from '../../editor-core/src/preview/ui-clipboard-adapters.js';
import { createSiteDiagnosticSession } from '../../editor-core/src/diagnostics/site-diagnostic-session.js';
import { resolveUiInteraction } from '../../editor-core/src/preview/ui-interaction-engine.js';
import { isPreviewInteractionFrameCurrent, previewLayoutInputKey } from '../../editor-core/src/preview/interaction-frame-readiness.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { siteText, translateSiteMessage } from '../../editor-core/src/i18n/site-messages.js';
import { createWorkspaceEditor } from '../../editor-core/src/ui/workspace-editor.js';

const scope = Object.freeze({ pack: 'pack-1', screen: 'screen-1', state: 1, locale: 'ja_JP', epoch: 1 });
const text = (nodeId, value, extra = {}) => segment({ nodeId, text: value, ready: true, ...extra });
const node = (id, children = [], extra = {}) => ({ id, children, visible: true, ...extra });
const snap = (nodes, segments, extra = {}) => snapshot({ nodes, segments, scope, ...extra });
const trusted = { isTrusted: true };
const intent = { text: '日本語\nA', sourceLabel: '元の画面', scope };
function platform(writer, extra = {}) {
  return { isSecureContext: true, navigator: { clipboard: { writeText: writer },
    permissions: { query() { assert.fail('Permissions query must not precede writing'); } } }, ...extra };
}

test('literal/binding/翻訳結果を表示順で集約し、重複render IDだけを除外する', () => {
  const s = snap([node('panel', ['a', 'b', 'c']), node('a'), node('b'), node('c')], [
    text('a', '§a日本語\r\n§lA§r'), text('b', '  同じ値  ', { provenance: 'fallback:en_US' }), text('c', '  同じ値  '),
  ]);
  const result = describe(s, ['panel', 'a']);
  assert.equal(result.status, 'ready');
  assert.equal(result.text, '日本語\nA\n  同じ値  \n  同じ値  ');
  assert.equal(result.count, 3);
  assert.ok(result.provenance.includes('fallback:en_US'));
  assert.equal(describe(s, 'b').text, '  同じ値  ');
});

test('Unicode、明示改行と空白を保存し、自動改行やUnicode正規化を加えない', () => {
  const value = '😀 e\u0301 日本語 العربية\n  ';
  assert.equal(describe(snap([node('a')], [text('a', value)]), 'a').text, value);
});

test('passwordはpayload getterも読まず、hiddenも元文字を保持しない', () => {
  const secret = segment({ nodeId: 's', secret: true, get text() { assert.fail('secret text read'); } });
  assert.equal(secret.code, 'COPY_SECRET_TEXT'); assert.equal(Object.hasOwn(secret, 'text'), false);
  const hidden = segment({ nodeId: 'h', visible: false, get text() { assert.fail('hidden text read'); } });
  assert.equal(hidden.status, 'excluded'); assert.equal(Object.hasOwn(hidden, 'text'), false);
  const s = snap([node('p', ['a', 's']), node('a'), node('s', [], { secret: true })], [text('a', 'safe'), secret]);
  const result = describe(s, 'p'); assert.equal(result.code, 'COPY_SECRET_TEXT'); assert.equal(result.text, undefined);
});

test('難読化・不明書式・未解決・未準備を含む範囲は全文を拒否する', () => {
  for (const [value, extra, code] of [
    ['prefix §ksecret§r', {}, 'COPY_OBFUSCATED_TEXT'], ['A§?B', {}, 'COPY_FORMAT_UNSUPPORTED'],
    ['#missing', { unresolved: true }, 'COPY_TEXT_UNRESOLVED'], ['partial', { ready: false }, 'COPY_TEXT_NOT_READY'],
  ]) {
    const failed = text('b', value, extra);
    assert.equal(failed.text, undefined);
    const result = describe(snap([node('p', ['a', 'b']), node('a'), node('b')], [text('a', 'safe'), failed]), 'p');
    assert.equal(result.code, code); assert.equal(result.text, undefined);
  }
});

test('非表示子孫を除外し、disabled表示文字・clip外親を抜けた表示子は取得できる', () => {
  const s = snap([node('p', ['a', 'h', 'outside']), node('a'), node('h', [], { visible: false, secret: true }),
    node('outside', ['escaped'], { visible: false }), node('escaped')],
  [text('a', 'disabled but displayed'), text('h', 'hidden'), text('escaped', 'visible child')]);
  assert.equal(describe(s, 'p').text, 'disabled but displayed\nvisible child');
  assert.equal(describe(s, 'h').code, 'COPY_NO_DISPLAYED_TEXT');
});

test('同一templateのcollection行はrender IDで区別し、全行の暗黙出力をしない', () => {
  const s = snap([node('list', ['row:0', 'row:1']), node('row:0'), node('row:1')], [text('row:0', 'zero'), text('row:1', 'one')]);
  assert.equal(describe(s, 'row:1').text, 'one');
  assert.equal(describe(s, 'row:1', { scope: { ...scope, state: 2 } }).code, 'COPY_SNAPSHOT_STALE');
});

test('pack/state/locale/選択世代変更とPocketを受信時に拒否する', () => {
  const s = snap([node('a')], [text('a', 'old')]);
  for (const [key, value] of [['pack', 'new'], ['state', 2], ['locale', 'en_US'], ['epoch', 2]]) {
    assert.equal(describe(s, 'a', { scope: { ...scope, [key]: value } }).code, 'COPY_SNAPSHOT_STALE');
  }
  assert.equal(describe(snap([node('a')], [text('a', 'old')], { pocket: true }), 'a').code, 'COPY_POCKET_BLOCKED');
  assert.equal(sameClipboardScope(scope, { ...scope }), true);
});

test('長さ・深さ・探索上限では無断切捨てをせず拒否する', () => {
  const s = snap([node('p', ['a', 'b', 'c']), node('a'), node('b'), node('c')],
    [text('a', 'a'.repeat(30000)), text('b', 'b'.repeat(30000)), text('c', 'c'.repeat(6000))]);
  assert.equal(describe(s, 'p').code, 'COPY_TEXT_LIMIT');
  const many = Array.from({ length: 2001 }, (_, i) => node(String(i), i < 2000 ? [String(i + 1)] : []));
  assert.equal(describe(snap(many, []), '0').code, 'COPY_SELECTION_LIMIT');
  const wide = [node('p', Array.from({ length: 2000 }, (_, i) => String(i))), ...Array.from({ length: 2000 }, (_, i) => node(String(i)))];
  assert.equal(describe(snap(wide, []), 'p').code, 'COPY_SELECTION_LIMIT');
});

test('writeTextはtrusted handler内で同期発行し、Promise前に成功通知を出さない', async () => {
  let fulfill, calls = 0; const notices = [];
  const broker = createClipboardBroker({ globalObject: platform(value => { calls++; assert.equal(value, intent.text); return new Promise(resolve => { fulfill = resolve; }); }) });
  const ticket = broker.writePrepared(intent, { event: trusted, onResult: value => notices.push(value) });
  assert.equal(calls, 1); assert.equal(ticket.status, 'writing'); assert.equal(notices.length, 0);
  fulfill(); assert.equal((await ticket.promise).status, 'written'); assert.equal(notices.length, 1);
  assert.equal(Object.hasOwn(notices[0], 'text'), false);
});

test('新copyと既存JSON/logの発行を同じ排他で止め、自動queueを作らない', async () => {
  let fulfill, count = 0;
  const broker = createClipboardBroker({ globalObject: platform(() => { count++; return new Promise(resolve => { fulfill = resolve; }); }) });
  const first = broker.writePrepared(intent, { event: trusted });
  assert.equal(broker.writePrepared(intent, { event: trusted }).code, 'COPY_BUSY');
  await assert.rejects(broker.runExclusive(() => { count++; }), /COPY_BUSY/u);
  assert.equal(count, 1); fulfill(); await first.promise; assert.equal(count, 1);
  let release;
  const legacy = broker.runExclusive(() => new Promise(resolve => { release = resolve; }));
  assert.equal(broker.writePrepared(intent, { event: trusted }).code, 'COPY_BUSY');
  release(); await legacy; assert.equal(broker.isBusy(), false);
});

test('API不在/非secure/人工event/失効は0回、拒否は失敗として返す', async () => {
  let calls = 0;
  for (const [globalObject, event, isCurrent, code] of [
    [platform(() => calls++, { isSecureContext: false }), trusted, () => true, 'COPY_API_UNAVAILABLE'],
    [{ isSecureContext: true }, trusted, () => true, 'COPY_API_UNAVAILABLE'],
    [platform(() => calls++), { isTrusted: false }, () => true, 'COPY_GESTURE_REQUIRED'],
    [platform(() => calls++), trusted, () => false, 'COPY_SNAPSHOT_STALE'],
  ]) assert.equal(createClipboardBroker({ globalObject }).writePrepared(intent, { event, isCurrent }).code, code);
  assert.equal(calls, 0);
  const broker = createClipboardBroker({ globalObject: platform(() => Promise.reject(Object.assign(new Error('do not expose payload'), { name: 'NotAllowedError' }))) });
  const denied = await broker.writePrepared(intent, { event: trusted }).promise;
  assert.equal(denied.code, 'COPY_WRITE_DENIED'); assert.equal(JSON.stringify(denied).includes('payload'), false);
});

test('長時間pendingでも枠を解放せず、送信後scope変更によって成功を取消扱いにしない', async () => {
  let fulfill, slowCallback, scopeCurrent = true; const notices = [];
  const globalObject = platform(() => new Promise(resolve => { fulfill = resolve; }), {
    setTimeout: fn => { slowCallback = fn; return 1; }, clearTimeout: () => {},
  });
  const broker = createClipboardBroker({ globalObject });
  const ticket = broker.writePrepared(intent, { event: trusted, isCurrent: () => scopeCurrent,
    onSlow: value => notices.push(value), onResult: value => notices.push(value) });
  scopeCurrent = false; slowCallback();
  assert.equal(notices[0].code, 'COPY_WAITING'); assert.equal(broker.isBusy(), true);
  fulfill(); const result = await ticket.promise;
  assert.equal(result.code, 'COPY_WRITTEN'); assert.equal(result.sourceLabel, '元の画面');
  assert.equal(broker.isBusy(), false);
});

test('編集支援とadapterを独立してOFFにでき、送信済み書込や既存Copyは取り消さない', async () => {
  let release, calls = 0;
  const broker = createClipboardBroker({ globalObject: platform(() => { calls++; return new Promise(resolve => { release = resolve; }); }) });
  broker.setEnabled('adapter', false);
  assert.equal(broker.writePrepared({ ...intent, mode: 'adapter' }, { event: trusted }).code, 'COPY_FEATURE_DISABLED');
  const started = broker.writePrepared({ ...intent, mode: 'editor' }, { event: trusted });
  assert.equal(calls, 1); broker.setEnabled('editor', false);
  release(); assert.equal((await started.promise).code, 'COPY_WRITTEN');
  assert.equal(broker.writePrepared({ ...intent, mode: 'editor' }, { event: trusted }).code, 'COPY_FEATURE_DISABLED');
  assert.equal(await broker.runExclusive(() => 'legacy-copy'), 'legacy-copy');
  assert.equal(broker.setEnabled('unknown', true), false);
});

test('Realmsは原path/実在definition/解決action/明示source契約が全一致した時だけコピーintent', () => {
  const clipboardDataSources = buildClipboardDataSources({ '#realm_invite_link_url': 'https://realms.gg/example' });
  const options = { enabled: true, screenPath: 'ui/realms_invite_link_settings_screen.json',
    screenDefinition: 'realms_invite_link_settings.general_content', action: 'button.realms_copy_invite_link', clipboardDataSources, scope };
  const result = resolveClipboardAdapter(options);
  assert.equal(result.status, 'applied'); assert.equal(result.effects[0].intent.text, 'https://realms.gg/example');
  assert.equal(result.effects[0].intent.evidence, 'preview-simulated');
  for (const changed of [{ screenPath: 'ui/other.json' }, { action: 'button.copy_link' },
    { screenDefinition: 'realms_invite_link_settings.realms_invite_link_settings_screen' }]) assert.equal(resolveClipboardAdapter({ ...options, ...changed }), null);
  assert.equal(resolveClipboardAdapter({ ...options, clipboardDataSources: {} }).status, 'unsupported');
  assert.equal(resolveClipboardAdapter({ ...options, enabled: false }).status, 'blocked');
  assert.equal(resolveClipboardAdapter({ ...options, pocket: true }).status, 'blocked');
});

test('TTS/近傍label/不正URLはsourceにせず、座標・ログのpayloadを捏造しない', () => {
  for (const mock of [{ '#realm_invite_link_url_TTS': 'https://realms.gg/example' },
    { '#realm_invite_link_url': 'javascript:alert(1)' }, { '#realm_invite_link_url': 'https://user:password@example.com/' },
    { '#realm_invite_link_url': 'https://realms.gg/a\nprivate' }, {}]) assert.deepEqual(buildClipboardDataSources(mock), {});
  for (const [screenPath, screenDefinition, action] of [
    ['ui/chat_screen.json', 'chat.chat_screen', 'copy_coordinates_button'],
    ['ui/content_log_history_screen.json', 'content_log_history.content_log_history_screen', 'button.copy_to_clipboard'],
  ]) {
    const result = resolveClipboardAdapter({ enabled: true, screenPath, screenDefinition, action, mockData: { '#coordinates_text': '1, 2, 3', log: 'invented' } });
    assert.equal(result.diagnostics[0].code, 'COPY_ADAPTER_PAYLOAD_UNVERIFIED'); assert.deepEqual(result.effects, []);
  }
});

test('既存diagnosticセッションcopyもwriter注入により同じ排他へ参加する', async () => {
  let release;
  const broker = createClipboardBroker({ globalObject: platform(() => Promise.resolve()) });
  const session = createSiteDiagnosticSession({ globalObject: {}, clipboardWriteText: value => broker.runExclusive(() => { assert.ok(value.includes('schemaVersion')); }) });
  session.start({ label: 'clipboard fixture' }); session.stop();
  const pending = broker.runExclusive(() => new Promise(resolve => { release = resolve; }));
  assert.equal((await session.copy()).code, 'SITE_DIAG_COPY_FAILED');
  release(); await pending; assert.equal((await session.copy()).code, 'SITE_DIAG_COPIED');
});

test('共通engineが有効な一意mappingからだけcopy intentを返す', () => {
  const options = { enabled: true, screenPath: 'ui/realms_invite_link_settings_screen.json',
    screenDefinition: 'realms_invite_link_settings.link_panel', scope,
    clipboardDataSources: buildClipboardDataSources({ '#realm_invite_link_url': 'https://realms.gg/example' }),
    node: { id: 'button', type: 'button', props: { button_mappings: [
      { from_button_id: 'button.menu_select', to_button_id: 'button.realms_copy_invite_link', mapping_type: 'pressed' },
    ] } },
  };
  assert.equal(resolveUiInteraction(options).effects[0].type, 'clipboardWriteText');
  for (const change of [{ enabled: false }, { pocket: true }, { effectiveProps: { visible: false } }, { effectiveProps: { enabled: false } }]) {
    assert.deepEqual(resolveUiInteraction({ ...options, ...change }).effects, []);
  }
});

test('実main snapshot準備がpassword祖先/hidden/clip/世代待ちを扱い、scopeも秘密を持たない', async () => {
  const source = await readFile(new URL('../../editor-core/src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('// Clipboard preparation belongs');
  const end = source.indexOf('/**\n * Best-effort clipboard copy', start);
  assert.ok(start > 0 && end > start);
  const boxes = [
    { id: 'root', x: 0, y: 0, w: 100, h: 100, parentId: null },
    { id: 'pw', x: 0, y: 0, w: 20, h: 20, parentId: 'root' },
    { id: 'secret', x: 0, y: 0, w: 20, h: 20, parentId: 'pw' },
    { id: 'hidden', x: 0, y: 30, w: 20, h: 20, parentId: 'root' },
    { id: 'clipped', x: 0, y: 30, w: 20, h: 20, parentId: 'root', clipRect: { x: 80, y: 80, w: 1, h: 1 } },
    { id: 'spaces', x: 0, y: 60, w: 20, h: 20, parentId: 'root' },
  ];
  const nodesById = {
    root: { type: 'panel', props: {}, children: ['pw', 'hidden', 'clipped', 'spaces'] },
    pw: { type: 'edit_box', props: { text_type: 'Password' }, children: ['secret'] },
    secret: { type: 'label', props: { text: 'password-secret-value' }, children: [] },
    hidden: { type: 'label', props: { visible: false, text: 'hidden-secret-value' }, children: [] },
    clipped: { type: 'label', props: { text: 'outside' }, children: [] },
    spaces: { type: 'label', props: { text: '  ' }, children: [] },
  };
  const file = { id: 'fixture', path: 'ui/fixture.json', nodesById, uiModel: { secret: 'model-secret-value' } };
  const state = { files: { currentFileId: file.id, byId: { [file.id]: file } }, pack: { status: 'ready', imported: {} },
    preview: { mockDataVersion: 1, mockData: { '#password': 'state-secret-value' } }, ui: { previewLocale: 'ja_JP' } };
  const cs = { layout: { boxes }, propsByIdOverride: {}, view: { zoom: 1, viewX: 0, viewY: 0 }, structureMode: false,
    layoutInputFile: file, nodeFrameAppliedFile: file };
  cs.layoutInputKey=previewLayoutInputKey({state,canvasState:cs,preset:{width:100,height:100},assetMetricsRevision:0});
  cs.nodeFrameContext=`${cs.layoutInputKey}|default`;cs.nodeFrameAppliedContext=cs.nodeFrameContext;
  const context = vm.createContext({
    store: { getState: () => state }, getCanvasState: () => cs, getCanvasKey: id => id,
    getSelectedPreviewQualifiedName: () => 'fixture.fixture', getLogicalCanvasPreset: () => ({ width: 100, height: 100 }),
    previewTextCopyEpoch: 1, importedPackRuntime: {}, vanillaReferenceRuntime: {}, langTableRuntime: { generation: 1, tablesByLocale: new Map() },
    previewClipboardIdentities: new WeakMap(), previewClipboardIdentitySequence: 0,
    screenOpenState: { status: 'ready' }, previewAssetMetricsRevision: 0, nodeFrameAvailability: true,
    previewAnimationEvent: 'default', isPreviewInteractionFrameCurrent,
    clampZoom: value => value, resolveLocalRuntimePropertyToken: value => value, createRenderedTextSegment: segment,
  });
  vm.runInContext(source.slice(start, end), context);
  const serializedScope = JSON.stringify(context.capturePreviewClipboardScope());
  assert.equal(serializedScope.includes('secret'), false);
  const canvas = { getBoundingClientRect: () => ({ width: 100, height: 100 }) };
  const capture = context.preparePreviewTextCopyCapture(file, cs, cs.layout, canvas, 'root');
  assert.equal(capture.code, undefined);
  assert.equal(capture.nodesById.secret.secret, true);
  assert.equal(capture.segments.get('secret').text, undefined);
  assert.equal(capture.nodesById.hidden.visible, false);
  assert.equal(capture.segments.has('hidden'), false);
  assert.equal(capture.nodesById.clipped.visible, false);
  assert.equal(capture.segments.get('spaces').text, '  ');
  assert.equal(JSON.stringify({ ...capture, segments: [...capture.segments.values()] }).includes('secret-value'), false);
  cs.nodeFrameAppliedContext = 'old';
  assert.equal(context.preparePreviewTextCopyCapture(file, cs, cs.layout, canvas, 'root').code, 'COPY_SNAPSHOT_STALE');
  cs.nodeFrameAppliedContext = cs.nodeFrameContext; state.preview.mockDataVersion = 2;
  assert.equal(context.preparePreviewTextCopyCapture(file, cs, cs.layout, canvas, 'root').code, 'COPY_SNAPSHOT_STALE');
});

test('実pointerup→activate→present→commit→brokerが同じeventで同期書込し、コピー状態を上書きしない', async () => {
  const source = await readFile(new URL('../../editor-core/src/main.js', import.meta.url), 'utf8');
  const pick = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const callbacks = [], statuses = [], notices = [], dispatched = [];
  let writeCount = 0, release;
  const globalObject = platform(() => { writeCount++; return new Promise(resolve => { release = resolve; }); });
  const broker = createClipboardBroker({ globalObject });
  const mappings = [
    { from_button_id: 'button.menu_select', to_button_id: 'button.realms_copy_invite_link', mapping_type: 'pressed' },
    { from_button_id: 'button.menu_cancel', to_button_id: 'button.realms_copy_invite_link', mapping_type: 'global' },
  ];
  const button = { id: 'button', type: 'button', props: { button_mappings: mappings } };
  const model = { root: button };
  const options = { enabled: true, pocket: false, model, propsById: {},
    file: { id: 'fixture', path: 'ui/realms_invite_link_settings_screen.json' },
    state: { preview: { mockData: {}, mockDataVersion: 1 } },
    screenDefinition: 'realms_invite_link_settings.link_panel', scope,
    clipboardDataSources: buildClipboardDataSources({ '#realm_invite_link_url': 'https://realms.gg/example' }),
  };
  const cs = { interaction: { active: true, pointerId: 2, mode: 'ui', targetId: 'button', model, mockVersion: 1 },
    view: {}, layout: { preset: {} } };
  cs.interaction.inputSnapshot41=capturePreviewInputSnapshot(options,2,'button');
  const runtimeStateEditor = { dirty: false };
  const context = vm.createContext({ isPreviewInputContextCurrent, evaluatePreviewInputRelease, previewInputTrace:createPreviewObservationTrace(), previewPlayback:{state:{seconds:0}},
    sourceWorkspace: createWorkspaceEditor({ request() { assert.fail('Unexpected workspace request in preview'); } }),
    siteText, translateSiteMessage, requestAnimationFrame: callback => { assert.equal(typeof callback, 'function'); return 1; }, flushDeferredWorkspaceRender: () => {},
    key: 'fixture', getInteractionPreviewContext: () => options, runtimeStateEditor,
    getCanvasState: () => cs, getCanvasKey: id => id, normalizePreviewState: value => value,
    setStatus: value => statuses.push(value), document: { getElementById: () => null },
    store: { dispatch: value => dispatched.push(value) }, actions: { setMockData: value => value },
    interactionTarget: (_context, hit, type) => type === 'edit_box' || !hit ? null : { node: button, effectiveProps: button.props },
    hidePreviewEditBoxOverlay: () => {}, previewAudioSequence: 0, buildPreviewAudioIntent: () => null,
    resolveUiInteraction, walkUiNodes: () => [button], extractUiInteractionActions: () => ['button.realms_copy_invite_link'],
    applicationClipboardBroker: broker, capturePreviewClipboardScope: () => scope, sameClipboardScope,
    displayPreviewClipboardResult: value => notices.push(value), diagnostics: { log: () => {} },
    canvasPxToWorld: () => ({ x: 1, y: 1 }), hitTestUiInteraction: () => ({ id: 'button' }),
  });
  vm.runInContext([
    pick('function assertStudioExternalChange21(', 'function assertStudioProjectionChange21('),
    pick('function commitPreviewInteractionEffects(', 'let previewNavigationEpoch'),
    pick('function presentPreviewInteractionResult(', 'function getInteractionHitProps('),
    pick('function activatePreviewHit(', 'function renderPreviewOperationCapabilities('),
    pick('function submitPreviewClipboardEffect(', 'function renderSelectedTextCopyControls('),
    pick('  const onPointerUp = (ev)', '/** @param {PointerEvent} _ev */').replace('const onPointerUp', 'globalThis.clipboardPointerUp'),
  ].join('\n'), context);
  const canvas = { releasePointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), style: {} };
  context.clipboardPointerUp({ isTrusted: true, pointerId: 2, clientX: 1, clientY: 1, currentTarget: canvas });
  assert.equal(writeCount, 1, 'write happened before pointerup returned');
  assert.equal(notices[0].status, 'writing'); assert.deepEqual(statuses, []);
  release(); await notices[0].promise;
  assert.equal(notices.at(-1).code, 'COPY_WRITTEN'); assert.deepEqual(statuses, []);
  // Run the exact Escape arrow body extracted from the DOM wiring as well.
  const canvasStart = source.indexOf("id: 'preview-canvas'");
  const handlerStart = source.indexOf('onKeydown:', canvasStart);
  const handlerEnd = source.indexOf('\n          onWheel,', handlerStart);
  assert(canvasStart >= 0 && handlerStart > canvasStart && handlerEnd > handlerStart);
  const escapeArrow = source.slice(handlerStart + 'onKeydown:'.length, handlerEnd).trim().replace(/,$/u, '');
  assert.ok(escapeArrow); vm.runInContext(`globalThis.clipboardEscape = ${escapeArrow};`, context);
  context.clipboardEscape({ isTrusted: true, key: 'Escape', preventDefault() { callbacks.push('preventDefault'); } });
  assert.equal(writeCount, 2); assert.deepEqual(callbacks, ['preventDefault']);
  release(); await notices.findLast(value => value.promise)?.promise;

  const effect = { type: 'clipboardWriteText', intent };
  for (const mutation of [() => { runtimeStateEditor.dirty = true; }, () => { options.pocket = true; }, () => { options.enabled = false; }]) {
    runtimeStateEditor.dirty = false; options.pocket = false; options.enabled = true;
    mutation(); assert.equal(context.commitPreviewInteractionEffects([effect], '', { inputEvent: trusted }), false);
    assert.equal(writeCount, 2);
  }
  runtimeStateEditor.dirty = false; options.pocket = false; options.enabled = true;
  assert.equal(context.commitPreviewInteractionEffects([{ type: 'mockPatch', patch: { large: 'a'.repeat(270000) } }, effect], '', { inputEvent: trusted }), false);
  assert.equal(writeCount, 2); assert.equal(dispatched.length, 0);
  // A clipboard-only policy failure cannot block a separate valid state effect.
  globalObject.isSecureContext = false;
  assert.equal(context.commitPreviewInteractionEffects([{ type: 'mockPatch', patch: { '#active': true } }, effect], '', { inputEvent: trusted }), true);
  assert.equal(writeCount, 2); assert.equal(dispatched.length, 1);
  assert.equal(notices.at(-1).code, 'COPY_API_UNAVAILABLE');
});
