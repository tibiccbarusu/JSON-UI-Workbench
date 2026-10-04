import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreviewState } from '../../editor-core/src/engine/preview-state.js';
import { compilePreviewAnimations, samplePreviewAnimations } from '../../editor-core/src/engine/preview-animation.js';
import { evaluateBindingsForUiModel, safeEvalExpression } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { buildRepresentativeClassicRuntimeVariableNames } from '../../editor-core/src/engine/representative-classic-runtime.js';
import { buildUiCatalog, listDefinitionsForFile } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

test('JSONC fallback は空内容を明示許可した場合だけコメントだけの文書を受理する', () => {
  const previous = globalThis.jsoncParser;
  try {
    delete globalThis.jsoncParser;
    for (const text of ['// comment', '/* comment */', '\ufeff// a\r\n/* b */\n']) {
      assert.deepEqual(parseJsonc(text, { allowEmptyContent: true }), { ok: true, value: null, errors: [] });
      assert.equal(parseJsonc(text).ok, false);
    }
    assert.equal(parseJsonc('/*', { allowEmptyContent: true }).ok, false);
    assert.equal(parseJsonc('// a\nfalse', { allowEmptyContent: true }).value, false);
  } finally {
    if (previous === undefined) delete globalThis.jsoncParser;
    else globalThis.jsoncParser = previous;
  }
});

test('交易の任意第2品目は null・省略だけを未指定とし、誤った偽値を拒否する', () => {
  const offer = { input: { id: 'minecraft:emerald' }, output: { id: 'minecraft:diamond' } };
  for (const secondInput of [false, 0, '']) {
    assert.throws(() => normalizePreviewState({ trade: { offers: [{ ...offer, secondInput }] } }), { code: 'PREVIEW_STATE_ITEM_REQUIRED' });
  }
  for (const value of [offer, { ...offer, secondInput: null }]) {
    assert.deepEqual(normalizePreviewState({ trade: { offers: [value] } }).collectionData.trades[0].__collections.trade_item_2, []);
  }
  const secondInput = { id: 'minecraft:iron_ingot', count: 2 };
  const result = normalizePreviewState({ trade: { offers: [{ ...offer, secondInput }] } });
  assert.equal(result.collectionData.trades[0].__collections.trade_item_2[0]['#trade_item_count'], '2');
});

test('catalog は不正typeを強制文字列化せず、prototype名をIDとして選ばない', async () => {
  const catalog = await buildUiCatalog({ parseJsonc, sources: [{ id: 'input', filePaths: ['ui/a.json'],
    readText: async () => JSON.stringify({ namespace: 'a', broken: { type: { toString: 0 } }, screen: { type: 'panel' } }) }] });
  assert.equal(catalog.records.length, 2);
  for (const recordId of ['constructor', '__proto__', 'toString']) {
    assert.deepEqual(listDefinitionsForFile(catalog, recordId), []);
    assert.equal(resolveEffectiveUi({ catalog, recordId }).error.code, 'UI_DEFINITION_NOT_FOUND');
  }
  const selected = catalog.records.find(value => value.localName === 'screen');
  assert.equal(resolveEffectiveUi({ catalog, recordId: selected.id }).ok, true);
});

test('未知の画面名は prototype property を実行時変数リストとして扱わない', () => {
  for (const qualifiedName of ['constructor', '__proto__', 'toString', '@constructor']) {
    const names = buildRepresentativeClassicRuntimeVariableNames({ qualifiedName });
    assert(names.has('$desktop_screen'));
    assert(!names.has('$chat_font_type'));
  }
  assert(buildRepresentativeClassicRuntimeVariableNames({ qualifiedName: 'chat.chat_screen' }).has('$chat_font_type'));
});

test('global mock は getter を呼ばず、無効なown値で別名へのfallbackを止める', () => {
  let reads = 0;
  const mockData = { gate: true };
  Object.defineProperty(mockData, '#gate', { enumerable: true, get() { reads++; throw new Error('getter must not execute'); } });
  const model = { root: { id: 'root', props: { visible: true }, children: [], bindings: [{ binding_name: '#gate', binding_name_override: '#visible' }] } };
  const result = evaluateBindingsForUiModel(model, { mockData });
  assert.equal(result.propsById.root.visible, '#__jsonui_unresolved_runtime_visibility__');
  assert.equal(safeEvalExpression('#gate', { props: {}, mockData }), undefined);
  assert.equal(reads, 0);
  assert.equal(evaluateBindingsForUiModel(model, { mockData: { gate: false } }).propsById.root.visible, false);
  assert.equal(evaluateBindingsForUiModel(model, { mockData: { '#gate': false, gate: true } }).propsById.root.visible, false);
});

test('animation の next 解決失敗は診断し、有効な現在区間の終端を保持する', () => {
  const model = { namespace: 'a', root: { id: 'root', props: { anims: ['@a.fade'] }, children: [] } };
  const fade = { anim_type: 'alpha', from: 0, to: 1, duration: 1 };
  for (const next of ['$missing', 0, false, null]) {
    const plan = compilePreviewAnimations(model, { definitions: { 'a.fade': { ...fade, next } } });
    assert(plan.diagnostics.some(value => value.code === 'ANIMATION_NEXT_UNRESOLVED'));
    assert.equal(samplePreviewAnimations(plan, 2).propsById.root.alpha, 1);
    assert.equal(plan.loop, false);
  }
  for (const value of [fade, { ...fade, next: '' }]) {
    const plan = compilePreviewAnimations(model, { definitions: { 'a.fade': value } });
    assert.equal(plan.diagnostics.length, 0);
  }
});
