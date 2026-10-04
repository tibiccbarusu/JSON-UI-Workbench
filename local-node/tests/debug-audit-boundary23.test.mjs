import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPreviewDebugRequest23, PREVIEW_DEBUG_BUDGET23 } from '../../editor-core/src/diagnostics/preview-debug-request23.js';
import { sanitizePreviewDebugPayload } from '../../editor-core/src/ui/preview-workspace.js';
import { validateDebugRequest, sanitizeDiagnostic, createEventJournal } from '../debug-bundle.mjs';
import { summarizeWorkspaceOperation } from '../workspace-operation-summary.mjs';

test('小さい状態でも原文・画像本体を除外し、ゲーム状態の名前・相対path・診断messageは保持する', () => {
  const state = { text: 'RAW_TEXT_SENTINEL', sourceText: 'SOURCE_SENTINEL', iconPngBase64: 'PNG_SENTINEL',
    token: 'TOKEN_SENTINEL', name: '通常の名前', '#name': 'ゲーム状態の文字列', path: 'ui/金床.json', message: '原文を含めない診断' };
  for (const output of [sanitizePreviewDebugPayload(state), sanitizeDiagnostic(state).data,
    createPreviewDebugRequest23({ state }).state]) {
    const serialized = JSON.stringify(output);
    assert(!serialized.includes('SENTINEL'));
    assert.equal(output.name, state.name); assert.equal(output['#name'], state['#name']);
    assert.equal(output.path, state.path); assert.equal(output.message, state.message);
  }
});

test('深い診断・操作の外側二階層も含めてサーバーdepth制限内とし、省略を明示する', () => {
  let deep = { code: 'END' }; for (let i = 0; i < 30; i++) deep = { next: deep };
  const payload = createPreviewDebugRequest23({ diagnostics: [deep], events: [deep], state: deep });
  const checked = validateDebugRequest(payload);
  assert.equal(checked.summary.truncated, false);
  assert(payload.state.capture.truncatedSections >= 3);
  assert.match(JSON.stringify(payload.diagnostics), /TRUNCATED/u);
  assert.equal(payload.state.capture.diagnostics.included, 1);
});

test('大量の通常ログは最新500診断・200操作へ制限し、省略件数を正確に記録する', () => {
  const rows = Array.from({ length: 1200 }, (_, id) => ({ id, code: 'EVENT' }));
  const payload = createPreviewDebugRequest23({ diagnostics: rows, events: rows });
  assert.deepEqual(payload.diagnostics.map(row => row.id), rows.slice(-500).map(row => row.id));
  assert.deepEqual(payload.events.map(row => row.id), rows.slice(-200).map(row => row.id));
  assert.deepEqual(payload.state.capture.diagnostics, { available: 1200, included: 500, omitted: 700 });
  assert.deepEqual(payload.state.capture.events, { available: 1200, included: 200, omitted: 1000 });
  assert.equal(validateDebugRequest(payload).summary.truncated, false);
});

test('長い日本語/絵文字/キーと文字数側省略でもUTF-8上限と省略表示を守る', () => {
  const huge = Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['長いキー😀'.repeat(60) + i, '日本語😀'.repeat(5000)]));
  const payload = createPreviewDebugRequest23({ browser: huge, selection: huge, state: huge,
    diagnostics: Array.from({ length: 500 }, (_, id) => ({ id, nested: huge })),
    events: Array.from({ length: 200 }, (_, id) => ({ id, nested: huge })) });
  assert(Buffer.byteLength(JSON.stringify(payload)) <= PREVIEW_DEBUG_BUDGET23.total);
  assert(payload.state.capture.truncatedSections > 0);
  assert(payload.state.capture.omittedValues > 0);
  assert(validateDebugRequest(payload).summary.nodes <= 50000);
  assert.equal(payload.diagnostics.at(-1).id, 499); assert.equal(payload.events.at(-1).id, 199);
  const short = createPreviewDebugRequest23({ state: { message: 'a'.repeat(4095) + '😀'.repeat(20) } });
  assert(short.state.capture.truncatedSections > 0);
  assert(!/[\uD800-\uDBFF]$/u.test(short.state.message));
});

test('不正なsection型もNode要求のobject型を維持する', () => {
  for (const value of ['invalid', 3, true, []]) {
    const payload = createPreviewDebugRequest23({ browser: value, selection: value, state: value });
    assert.doesNotThrow(() => validateDebugRequest(payload));
    assert(payload.state.capture.truncatedSections >= 3);
  }
});

test('長いキーの短縮衝突は先の記録を上書きせず省略を通知する', () => {
  const prefix = 'あ'.repeat(256);
  const payload = createPreviewDebugRequest23({ state: { [prefix + 'first']: 1, [prefix + 'second']: 2 } });
  assert.equal(payload.state[prefix], 1);
  assert(payload.state.capture.omittedValues >= 3);
  assert.equal(validateDebugRequest(payload).summary.truncated, false);
});

const mainSource = await readFile(new URL('../../editor-core/src/main.js', import.meta.url), 'utf8');
function downloadHarness({ rejectNode = false, contextError = false, saveError = false, delayNode = false } = {}) {
  const start = mainSource.indexOf('async function downloadCompleteDebugBundle() {');
  const end = mainSource.indexOf('\nconst runtimeInputEditorStates', start);
  assert(start >= 0 && end > start);
  const diagnostics = Array.from({ length: 500 }, (_, id) => ({ id, code: 'DRAFT_READY', offset: [id, 3] }));
  const events = Array.from({ length: 200 }, (_, id) => ({ id, type: 'move' }));
  const saved = [], requests = [], failures = []; let resolve;
  const waiting = new Promise(yes => { resolve = yes; });
  const context = vm.createContext({ createPreviewDebugRequest23, sanitizePreviewDebugPayload, siteText: value => value,
    navigator: { language: 'ja', platform: 'test', userAgent: 'test' }, runtimeStateEditor: { text: '{}' }, actionLog: events,
    buildCurrentPreviewDiagnosticContext() {
      if (contextError) throw new Error('CONTEXT_FAILED');
      return { selectedUi: { filePath: 'ui/example.json' }, warnings: Array(300).fill('状態'.repeat(3000)) };
    }, store: { getState: () => ({ preview: {} }) },
    diagnostics: { getEntries: () => diagnostics, captureError: error => failures.push(error) },
    getNodeRequestLog35: () => ({ total_seen: 1, dropped: 0, events: [{ event: 'NODE_REQUEST_FAILED', correlation_id: 'r33-request' }] }),
    setStatus() {}, makeSafeFileTimestamp: () => 'fixed',
    async downloadNodeDebugBundle(payload) {
      requests.push(payload); if (delayNode) await waiting;
      if (rejectNode) throw new Error('NODE_OFFLINE token=PRIVATE_TOKEN at /home/PRIVATE_USER/file');
      return new Blob(['{}']);
    }, downloadBlobFile: value => saved.push(value),
    downloadTextFile(value) { if (saveError) throw new Error('SAVE_FAILED'); saved.push(value); },
  });
  vm.runInContext(`let debugBundleBusy = false; ${mainSource.slice(start, end)}; this.run = downloadCompleteDebugBundle; this.busy = () => debugBundleBusy;`, context);
  return { run: context.run, busy: context.busy, saved, requests, failures, resolve };
}

test('本番Node失敗fallbackは大きな状態でも500/200履歴とcapture数を保ち、秘密を再露出しない', async () => {
  const h = downloadHarness({ rejectNode: true }); await h.run();
  const saved = JSON.parse(h.saved[0].text);
  assert.equal(saved.diagnostics.length, 500); assert.equal(saved.events.length, 200);
  assert.equal(saved.diagnostics.at(-1).id, 499); assert.equal(saved.events.at(-1).id, 199);
  assert.equal(saved.state.capture.diagnostics.included, saved.diagnostics.length);
  assert.equal(saved.state.capture.events.included, saved.events.length);
  assert.equal(saved.state.transport.events[0].correlation_id, 'r33-request');
  assert(!h.saved[0].text.includes('PRIVATE_')); assert.equal(h.busy(), false);
  assert(Buffer.byteLength(h.saved[0].text) <= PREVIEW_DEBUG_BUDGET23.total);
});

test('本番context組立失敗でもログを保持し、再保存できる', async () => {
  const h = downloadHarness({ contextError: true }); await h.run(); await h.run();
  assert.equal(h.saved.length, 2); assert.equal(h.requests.length, 0);
  const saved = JSON.parse(h.saved[0].text);
  assert.equal(saved.state.captureFailed, true); assert.equal(saved.diagnostics.length, 500);
  assert.equal(saved.state.transport.events[0].correlation_id, 'r33-request');
  assert.equal(saved.events.length, 200); assert.equal(h.busy(), false);
});

test('本番fallback自体の保存失敗後もbusyを解放し、次の要求を受付ける', async () => {
  const h = downloadHarness({ rejectNode: true, saveError: true });
  await assert.rejects(h.run(), /SAVE_FAILED/u); assert.equal(h.busy(), false);
  await assert.rejects(h.run(), /SAVE_FAILED/u); assert.equal(h.requests.length, 2); assert.equal(h.busy(), false);
});

test('本番遅延中の重複保存を抑止し、非同期Node失敗後にbusyを解放する', async () => {
  const h = downloadHarness({ rejectNode: true, delayNode: true });
  const first = h.run(); await h.run(); assert.equal(h.requests.length, 1); assert.equal(h.busy(), true);
  h.resolve(); await first; assert.equal(h.busy(), false); assert.equal(h.saved.length, 1);
  await h.run(); assert.equal(h.requests.length, 2);
});

test('Node操作journal送出は最新200件・相関・座標を維持し原文/icon/絶対path/tokenを除外する', () => {
  const journal = createEventJournal(200);
  for (let id = 0; id < 250; id++) journal.record('WORKSPACE_OPERATION_STARTED', {
    ...summarizeWorkspaceOperation({ workspaceId: 'workspace', operation: { type: 'set', path: 'ui/金床.json',
      pointer: '/screen', property: 'text', value: 'PRIVATE_SOURCE', offset: [id, 7] }, iconPngBase64: 'PRIVATE_PNG' }),
    diagnostic: { file: '/home/PRIVATE_USER/file.json', note: 'CURRENT_TOKEN', text: 'PRIVATE_TEXT',
      name: 'error', message: 'token=PRIVATE_AUTH' },
  }, { correlation_id: 'request-' + id });
  const output = sanitizeDiagnostic({ workspace_journal: journal.snapshot() }, { secrets: ['CURRENT_TOKEN'] });
  assert.equal(output.summary.truncated, false);
  const events = output.data.workspace_journal.events;
  assert.equal(events.length, 200); assert.equal(output.data.workspace_journal.dropped, 50);
  assert.equal(events[0].correlation_id, 'request-50'); assert.equal(events.at(-1).correlation_id, 'request-249');
  assert.deepEqual(events.at(-1).context.operations[0].offset, [249, 7]);
  assert.equal(events.at(-1).context.operations[0].path, 'ui/金床.json');
  assert(!JSON.stringify(output).includes('PRIVATE_')); assert(!JSON.stringify(output).includes('CURRENT_TOKEN'));
});

test('本番Node診断adapterは20秒期限と呼出側abortの両方を要求へ渡す', async () => {
  const source = await readFile(new URL('../../editor-core/src/pack-io/node-remote-client.js', import.meta.url), 'utf8');
  const start = source.indexOf('export async function downloadNodeDebugBundle(');
  const end = source.indexOf('\nexport async function nodeValidatePreview', start);
  assert(start >= 0 && end > start);
  const deadlines = [], calls = [], deadline = new AbortController(), caller = new AbortController();
  const context = vm.createContext({ AbortSignal: { timeout(ms) { deadlines.push(ms); return deadline.signal; }, any: AbortSignal.any },
    async request(route, options) { calls.push({ route, options });
      return { blob: () => options.signal.aborted ? Promise.reject(options.signal.reason) : new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })) };
    } });
  vm.runInContext(source.slice(start, end).replace('export ', '') + '\nthis.run = downloadNodeDebugBundle;', context);
  const timed = context.run({ schema: 'test' }); deadline.abort(new Error('DEADLINE'));
  await assert.rejects(timed, /DEADLINE/u);
  assert.equal(calls[0].route, 'debug-bundle'); assert.equal(deadlines[0], 20000);
  // 別のdeadlineでcaller由来のキャンセルも確認する。
  context.AbortSignal.timeout = ms => { deadlines.push(ms); return new AbortController().signal; };
  const cancelled = context.run({}, caller.signal); caller.abort(new Error('CALLER_ABORT'));
  await assert.rejects(cancelled, /CALLER_ABORT/u);
  assert.equal(deadlines[1], 20000);
});
