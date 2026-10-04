import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { siteText } from '../src/i18n/site-messages.js';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';
import { buildEnchantingBookPreviewScene } from '../src/preview/native-model-preview.js';
import {
  DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS, horsePreviewOptionsKey,
  nativeModelPreviewFields, parseNativeModelPreviewFields, renderNativeModelSettings,
} from '../src/ui/native-model-settings.js';

// 実mainの境界・適用・cache破棄・通知を抽出する。DOM/描画/通信だけを観測用に置換する。
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function sourceFunction(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} exists`);
  const lineEnd = source.indexOf('\n', start);
  const line = source.slice(start, lineEnd);
  if (line.endsWith(' }')) return line;
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} has a top-level boundary`);
  return source.slice(start, end + 2);
}
const settingsStart = source.indexOf('  const nativeModelSettings = renderNativeModelSettings(h, {');
const settingsEnd = source.indexOf('\n  });', settingsStart);
assert.ok(settingsStart > 0 && settingsEnd > settingsStart, 'actual onApply registration exists');
const settingsRegistration = source.slice(settingsStart, settingsEnd + '\n  });'.length);
const blockedCases = [
  ['未反映', state => { state.pendingOperations = [{ operation: { type: 'move' } }]; }],
  ['処理中', state => { state.busy = true; }],
  ['結果不明', state => { state.pendingCommitUncertain = true; }],
  ['原文dirty', state => { state.drafts.set('ui/a.json', { dirty: true, invalid: false }); }],
  ['原文invalid', state => { state.drafts.set('ui/a.json', { dirty: false, invalid: true }); }],
];
const nextOptions = patch => {
  const result = parseNativeModelPreviewFields({ ...nativeModelPreviewFields(), variant: 2, yaw: 148, bookOpeningDegrees: 90, ...patch });
  assert.equal(result.ok, true);
  return result.options;
};

function harness() {
  const counters = { render: 0, redraw: 0, bookBuild: 0 };
  const errors = [], statuses = [], rows = [];
  const workspace = createWorkspaceEditor({ request: async () => { throw new Error('UNEXPECTED_WORKSPACE_IO'); } });
  const font = new Map([['font', { cached: true }]]), text = new Map([['text', { cached: true }]]);
  const horseController = new AbortController(), playerController = new AbortController();
  const initialBook = buildEnchantingBookPreviewScene({ openingDegrees: 130 });
  assert(initialBook, 'real book scene initialized');
  const h = (tag, attrs = {}, children = []) => {
    const node = { tag, attrs, children, textContent: '', isConnected: true };
    rows.push(node); return node;
  };
  const context = vm.createContext({
    AbortController, siteText, sourceWorkspace: workspace,
    DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS, horsePreviewOptionsKey,
    renderNativeModelSettings, nativeRendererUsage: { renderers: new Set(['live_horse_renderer', 'enchanting_book_renderer']) }, h,
    bitmapFontCache: font, bitmapTextLayoutCache: text,
    bitmapFontNotices: new Set(['font notice']), warnedFontLoadKeys: new Set(['font warning']),
    initialBook, horseController, playerController,
    buildEnchantingBookPreviewScene: options => { counters.bookBuild++; return buildEnchantingBookPreviewScene(options); },
    safeRender: () => { counters.render++; }, requestCanvasTextureRedraw: () => { counters.redraw++; },
    setStatus: value => statuses.push(value), diagnostics: { captureError: error => errors.push(error) },
  });
  vm.runInContext(`
    let nativeModelPreviewOptions = DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS;
    const nativeModelPreviewUiState = { open: false, draft: null, error: '' };
    let enchantingBookPreviewScene = initialBook;
    let nativeHorsePreviewEpoch = 11, nativePlayerPreviewEpoch = 17, previewContextMutationEpoch = 23;
    let nativeHorsePreviewAbortController = horseController, nativePlayerPreviewController = playerController;
    let nativeHorsePreviewState = { status: 'ready', scene: { id: 'retained-horse' } };
    let nativePlayerPreviewState = { status: 'ready', scene: { id: 'retained-player' } };
    ${['assertStudioExternalChange21', 'markPreviewContextMutation', 'clearNativePlayerPreviewCache', 'clearNativeHorsePreviewCache',
      'applyNativeModelPreviewOptions', 'reportWorkspaceError', 'studioInvoke'].map(sourceFunction).join('\n')}
    this.api = {
      apply: applyNativeModelPreviewOptions,
      settings() { ${settingsRegistration}; return nativeModelSettings; },
      ui: nativeModelPreviewUiState,
      snapshot() { return { options: nativeModelPreviewOptions, book: enchantingBookPreviewScene,
        horse: nativeHorsePreviewState, player: nativePlayerPreviewState,
        horseController: nativeHorsePreviewAbortController, playerController: nativePlayerPreviewController,
        horseEpoch: nativeHorsePreviewEpoch, playerEpoch: nativePlayerPreviewEpoch, contextEpoch: previewContextMutationEpoch }; }
    };
  `, context);
  return { api: context.api, workspace, counters, errors, statuses, rows, font, text, horseController, playerController };
}
function unchanged(h, before) {
  const after = h.api.snapshot();
  for (const key of ['options', 'book', 'horse', 'player', 'horseController', 'playerController', 'horseEpoch', 'playerEpoch', 'contextEpoch']) {
    assert.equal(after[key], before[key], `${key} must not change`);
  }
  assert.equal(h.horseController.signal.aborted, false);
  assert.equal(h.playerController.signal.aborted, false);
  assert.equal(h.font.size, 1); assert.equal(h.text.size, 1);
  assert.equal(h.counters.bookBuild, 0); assert.equal(h.counters.redraw, 0);
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

for (const [name, block] of blockedCases) test(`3D直接適用: ${name}ではoptions・model・cache・abortを変更しない`, () => {
  const h = harness(), before = h.api.snapshot(); block(h.workspace.state);
  assert.throws(() => h.api.apply(nextOptions()), error => error.code === 'WORKSPACE_EXTERNAL_CHANGE_BLOCKED');
  unchanged(h, before); assert.equal(h.counters.render, 0); assert.equal(h.errors.length, 0);
});

test('3D直接適用: 通常状態は実book生成・options更新・horse/player cache世代更新を行う', () => {
  const h = harness(), before = h.api.snapshot(), options = nextOptions();
  h.api.apply(options); const after = h.api.snapshot();
  assert.equal(after.options, options); assert.notEqual(after.book, before.book);
  assert.equal(after.book.openingDegrees, 90); assert.equal(after.book.kind, 'book');
  assert.equal(after.horseEpoch, before.horseEpoch + 1); assert.equal(after.playerEpoch, before.playerEpoch + 1);
  assert.equal(after.contextEpoch, before.contextEpoch + 1);
  assert.equal(after.horse.status, 'idle'); assert.equal(after.player.status, 'idle');
  assert.equal(after.horse.scene, null); assert.equal(after.player.scene, null);
  assert.equal(h.horseController.signal.aborted, true); assert.equal(h.playerController.signal.aborted, true);
  assert.equal(h.font.size, 1); assert.equal(h.text.size, 1);
  assert.deepEqual(h.counters, { render: 1, redraw: 1, bookBuild: 1 }); assert.equal(h.errors.length, 0);
});

test('3D直接適用: 本だけの変更はhorse/player modelとcacheを保持する', () => {
  const h = harness(), before = h.api.snapshot();
  const parsed = parseNativeModelPreviewFields({ ...nativeModelPreviewFields(), bookOpeningDegrees: 90 });
  assert.equal(parsed.ok, true); h.api.apply(parsed.options); const after = h.api.snapshot();
  assert.equal(after.options, parsed.options); assert.equal(after.book.openingDegrees, 90);
  for (const key of ['horse', 'player', 'horseEpoch', 'playerEpoch', 'horseController', 'playerController']) assert.equal(after[key], before[key]);
  assert.equal(h.horseController.signal.aborted, false); assert.equal(h.playerController.signal.aborted, false);
  assert.equal(after.contextEpoch, before.contextEpoch + 1); assert.equal(h.counters.redraw, 1);
});

for (const [name, block] of blockedCases) test(`3D実form接続: ${name}の拒否は通知され同期例外・モデル変更を起こさない`, async () => {
  const h = harness(); h.api.settings(); h.api.ui.draft = nativeModelPreviewFields(nextOptions());
  const before = h.api.snapshot(); block(h.workspace.state);
  const form = h.rows.find(row => row.tag === 'form'); assert(form);
  let prevented = false;
  assert.doesNotThrow(() => form.attrs.onSubmit({ preventDefault() { prevented = true; } }));
  await flush(); assert.equal(prevented, true); unchanged(h, before);
  assert.equal(h.errors.length, 1); assert.equal(h.errors[0].code, 'WORKSPACE_EXTERNAL_CHANGE_BLOCKED');
  assert.equal(h.statuses.length, 1); assert.equal(h.statuses[0].level, 'error');
  assert.match(h.workspace.state.error, /3D の表示条件の変更/);
  assert.equal(h.counters.render, 1, '拒否通知を表示するrenderだけ');
});

test('3D実form接続: 通常状態のsubmitは実onApplyを通り適用する', async () => {
  const h = harness(); h.api.settings(); h.api.ui.draft = nativeModelPreviewFields(nextOptions());
  const before = h.api.snapshot(), form = h.rows.find(row => row.tag === 'form');
  form.attrs.onSubmit({ preventDefault() {} }); await flush(); const after = h.api.snapshot();
  assert.equal(after.options.previewState.variant, 2); assert.equal(after.options.camera.yaw, 148);
  assert.equal(after.book.openingDegrees, 90); assert.equal(after.contextEpoch, before.contextEpoch + 1);
  assert.equal(h.errors.length, 0); assert.deepEqual(h.counters, { render: 1, redraw: 1, bookBuild: 1 });
});
