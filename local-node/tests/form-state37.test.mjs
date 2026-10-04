import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreviewState, createPreviewStatePreset } from '../../editor-core/src/engine/preview-state.js';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { buildRepresentativeClassicCollections } from '../../editor-core/src/engine/representative-classic-runtime.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

const modal = (entry) => normalizePreviewState({ form: { type: 'modal', elements: [entry] } });
const slider = (range, extra = {}) => modal({ type: 'slider', text: '信号レベル', range, ...extra });
const action = (elements, extra = {}) => normalizePreviewState({ form: { type: 'action', elements, ...extra } });
const row = (state) => state.collectionData.custom_form[0];
const range = { min: 0, max: 10, current: 7, step: 1 };

test('R37 P05 legacy の 0/.7/1 は位置・表示・metadata無しを維持', () => {
  for (const value of [0, .7, 1]) {
    const actual = row(modal({ type: 'slider', text: '信号レベル', value }));
    assert.deepEqual(actual, { __jsonui_preview_factory_control_id: 'slider', '#custom_text': '信号レベル', '#custom_tooltip_text': '', '#custom_slider_text': '信号レベル', '#custom_slider_value': value, '#custom_slider_text_value': String(value), '#custom_slider_enabled': true, '#custom_slider_timeout': 0 });
  }
  assert.equal(row(modal({ type: 'slider' }))['#custom_slider_value'], 0);
});
test('R37 P05 0..10 の 7 は位置 .7・数値 7・見出しを別に保持', () => {
  const actual = row(slider(range, { displayText: '信号レベル: 7' }));
  assert.equal(actual['#custom_slider_value'], .7);
  assert.equal(actual['#custom_slider_text_value'], '7');
  assert.equal(actual['#custom_slider_text'], '信号レベル: 7');
  assert.equal(actual.__jsonui_preview_slider_range.current, 7);
  assert.equal(actual.__jsonui_preview_slider_range.label, '信号レベル');
});
test('R37 P05 表示値のローカライズは明示文字列だけを使う', () => {
  const actual = row(slider(range, { valueText: '７', displayText: '信号レベル：７' }));
  assert.equal(actual['#custom_slider_value'], .7);
  assert.equal(actual['#custom_slider_text_value'], '７');
  assert.equal(actual['#custom_slider_text'], '信号レベル：７');
  assert.equal(row(slider(range))['#custom_slider_text'], '信号レベル');
});
test('R37 P05 負数範囲・両端・step既定値を計算', () => {
  for (const [current, expected] of [[-10, 0], [-5, .25], [0, .5], [10, 1]]) {
    const actual = row(slider({ min: -10, max: 10, current }));
    assert.equal(actual['#custom_slider_value'], expected);
    assert.equal(actual.__jsonui_preview_slider_range.step, 1);
  }
});
test('R37 P05 小数 .1 の表現誤差を誤警告しない', () => {
  const state = slider({ min: 0, max: 1, current: .3, step: .1 });
  assert.equal(row(state)['#custom_slider_value'], .3);
  assert(!state.diagnostics.some((d) => d.code === 'PREVIEW_STATE_SLIDER_STEP_UNCONFIRMED'));
});
test('R37 P05 off-grid と端点不整列を区別し丸めない', () => {
  for (const [input, currentAligned, endpointAligned] of [
    [{ min: 0, max: 10, current: 7, step: 2 }, false, true],
    [{ min: 0, max: 10, current: 6, step: 3 }, true, false],
    [{ min: 0, max: 10, current: 7, step: 3 }, false, false],
  ]) {
    const state = slider(input);
    assert.equal(row(state)['#custom_slider_value'], input.current / 10);
    assert.equal(row(state).__jsonui_preview_slider_range.current, input.current);
    const diagnostic = state.diagnostics.find((d) => d.code === 'PREVIEW_STATE_SLIDER_STEP_UNCONFIRMED');
    assert.equal(diagnostic.currentAligned, currentAligned);
    assert.equal(diagnostic.endpointAligned, endpointAligned);
  }
});
test('R37 P05 legacy value と range の競合を拒否', () => {
  assert.throws(() => slider(range, { value: .7 }), { code: 'PREVIEW_STATE_SLIDER_VALUE_CONFLICT' });
  for (const field of ['valueText', 'displayText']) assert.throws(() => modal({ type: 'slider', value: .7, [field]: '7' }), { code: 'PREVIEW_STATE_SLIDER_RANGE_REQUIRED' });
});
test('R37 P05 必須 range 項目・逆範囲・同一端点・未知fieldを拒否', () => {
  for (const field of ['min', 'max', 'current']) {
    const input = { ...range }; delete input[field];
    assert.throws(() => slider(input), { code: 'PREVIEW_STATE_SLIDER_RANGE_FIELD_REQUIRED' });
  }
  for (const input of [null, [], '0..10', { min: 2, max: 2, current: 2 }, { min: 10, max: 0, current: 7 }]) assert.throws(() => slider(input), { code: 'PREVIEW_STATE_SLIDER_RANGE' });
  assert.throws(() => slider({ ...range, maximum: 10 }), { code: 'PREVIEW_STATE_UNKNOWN_FIELD' });
});
test('R37 P05 非有限・数値以外・範囲外・step不正を拒否', () => {
  for (const field of ['min', 'max', 'current', 'step']) {
    for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => slider({ ...range, [field]: value }), { code: 'PREVIEW_STATE_NONFINITE' });
    for (const value of ['7', null, false, {}]) assert.throws(() => slider({ ...range, [field]: value }), { code: 'PREVIEW_STATE_NUMBER_REQUIRED' });
  }
  for (const current of [-1, 11]) assert.throws(() => slider({ ...range, current }), { code: 'PREVIEW_STATE_SLIDER_CURRENT' });
  for (const step of [0, -1]) assert.throws(() => slider({ ...range, step }), { code: 'PREVIEW_STATE_SLIDER_STEP' });
});
test('R37 P05 有限入力でも差・step数が表現不能なら拒否', () => {
  assert.throws(() => slider({ min: -Number.MAX_VALUE, max: Number.MAX_VALUE, current: 0 }), { code: 'PREVIEW_STATE_SLIDER_RANGE' });
  assert.throws(() => slider({ ...range, step: Number.MIN_VALUE }), { code: 'PREVIEW_STATE_SLIDER_STEP_PRECISION' });
  assert.throws(() => slider({ ...range, step: 1e-20 }), { code: 'PREVIEW_STATE_SLIDER_STEP_PRECISION' });
  assert.throws(() => slider({ min: 0, max: Number.MIN_VALUE, current: 0, step: Number.MAX_VALUE }), { code: 'PREVIEW_STATE_SLIDER_STEP_PRECISION' });
});
test('R37 P05 表示文字列の不正型・他controlへのrange漏れを拒否', () => {
  for (const field of ['valueText', 'displayText']) assert.throws(() => slider(range, { [field]: 7 }), { code: 'PREVIEW_STATE_STRING_REQUIRED' });
  for (const type of ['toggle', 'input', 'dropdown', 'step_slider']) assert.throws(() => modal({ type, range }), { code: 'PREVIEW_STATE_UNKNOWN_FIELD' });
});
test('R37 P05 値とlabelのbindingが別々のnodeへ届く', () => {
  const state = slider(range, { displayText: '信号レベル: 7' });
  const model = { root: { id: 'row', props: { __jsonui_preview_collection_name: 'custom_form', collection_index: 0 }, children: [
    { id: 'track', props: {}, bindings: [{ binding_type: 'collection', binding_collection_name: 'custom_form', binding_name: '#custom_slider_value', binding_name_override: '#slider_value' }], children: [] },
    { id: 'label', props: { text: '#custom_slider_text' }, bindings: [], children: [] },
  ] } };
  const evaluated = evaluateBindingsForUiModel(model, state);
  assert.equal(evaluated.propsById.track.slider_value, .7);
  assert.equal(evaluated.propsById.label.text, '信号レベル: 7');
});
test('R37 P06 legacy buttons は元collectionと完全一致', () => {
  const state = normalizePreviewState({ form: { buttons: [{ text: '画像', icon: 'textures/items/diamond' }, { text: '戻る' }] } });
  assert.deepEqual(state.collectionData.form_buttons, [
    { __jsonui_preview_factory_control_id: 'button', '#form_button_text': '画像', '#form_button_texture': 'textures/items/diamond', '#form_button_texture_file_system': 'InUserPackage' },
    { __jsonui_preview_factory_control_id: 'button', '#form_button_text': '戻る', '#form_button_texture': '', '#form_button_texture_file_system': 'InUserPackage' },
  ]);
  assert.equal(state.mockData['#form_button_contents'], 2);
});
test('R37 P06 表示行番号とbuttonだけのselection番号を分離', () => {
  const types = ['header', 'button', 'label', 'divider', 'divider', 'button'];
  const state = action(types.map((type) => type === 'divider' ? { type } : { type, text: type }));
  const rows = state.collectionData.form_buttons;
  assert.deepEqual(rows.map((r) => r.__jsonui_preview_factory_control_id), types);
  assert.deepEqual(rows.map((r) => r.__jsonui_preview_display_row_index), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(rows.map((r) => r.__jsonui_preview_action_selection_index), [null, 0, null, null, null, 1]);
  assert.equal(state.mockData['#form_button_contents'], 6);
  assert(!Object.hasOwn(rows[3], '#form_button_text'));
});
test('R37 P06 空・button無し・256行を受理し257行を拒否', () => {
  for (const elements of [[], [{ type: 'header', text: '見出し' }], Array.from({ length: 256 }, () => ({ type: 'divider' }))]) assert.equal(action(elements).collectionData.form_buttons.length, elements.length);
  assert.throws(() => action(Array.from({ length: 257 }, () => ({ type: 'divider' }))), { code: 'PREVIEW_STATE_FORM_ELEMENTS' });
  const rows = action(Array.from({ length: 256 }, () => ({ type: 'button' }))).collectionData.form_buttons;
  assert.equal(rows[255].__jsonui_preview_action_selection_index, 255);
});
test('R37 P06 行配列の競合・未知type・field違反を拒否', () => {
  assert.throws(() => action([], { buttons: [] }), { code: 'PREVIEW_STATE_FORM_ROWS_CONFLICT' });
  for (const elements of [null, {}, 'button']) assert.throws(() => action(elements), { code: 'PREVIEW_STATE_FORM_ELEMENTS' });
  for (const entry of [{}, { type: 'unknown' }, { type: 'toggle' }]) assert.throws(() => action([entry]), { code: 'PREVIEW_STATE_FORM_ELEMENT_TYPE' });
  for (const entry of [{ type: 'divider', text: '' }, { type: 'header', icon: '' }, { type: 'label', enabled: false }, { type: 'button', template: 'a.b' }]) assert.throws(() => action([entry]), { code: 'PREVIEW_STATE_UNKNOWN_FIELD' });
});
test('R37 P06 icon制約を新旧形式に共通適用し空iconを維持', () => {
  for (const icon of ['https://example.test/a', '../a', 'textures/../a', 'textures/a\\b']) {
    assert.throws(() => action([{ type: 'button', icon }]), { code: 'PREVIEW_STATE_FORM_ICON_PATH' });
    assert.throws(() => normalizePreviewState({ form: { buttons: [{ icon }] } }), { code: 'PREVIEW_STATE_FORM_ICON_PATH' });
  }
  assert.equal(action([{ type: 'button', icon: '' }]).collectionData.form_buttons[0]['#form_button_texture'], '');
});
test('R38 R06 textのRawMessage対応と翻訳表未提供の明示拒否', () => {
  for (const type of ['button', 'header', 'label']) assert.equal(action([{ type, text: { text: '内容' } }]).collectionData.form_buttons[0]['#form_button_text'], '内容');
  assert.throws(() => action([], { title: { translate: 'key' } }), { code: 'PREVIEW_STATE_RAW_MESSAGE_TRANSLATION_MISSING' });
});
test('R37 P05/P06 入力非破壊・raw状態へのroundtrip・overrideを維持', () => {
  const input = { form: { type: 'modal', elements: [{ type: 'slider', range: { ...range } }] } };
  const before = JSON.stringify(input), state = normalizePreviewState(input);
  const roundtrip = normalizePreviewState({ mockData: state.mockData, collectionData: state.collectionData });
  assert.deepEqual(JSON.parse(JSON.stringify(roundtrip.collectionData)), JSON.parse(JSON.stringify(state.collectionData)));
  row(state).__jsonui_preview_slider_range.current = 9;
  assert.equal(JSON.stringify(input), before);
  const overridden = normalizePreviewState({ form: { type: 'action', elements: [{ type: 'button' }] }, collectionData: { form_buttons: [] } });
  assert.deepEqual(overridden.collectionData.form_buttons, []);
});
test('R37 P05/P06 prototype・getter・深さ・文字予算を拡大しない', () => {
  let called = false;
  const hostile = { min: 0, max: 10 };
  Object.defineProperty(hostile, 'current', { enumerable: true, get() { called = true; return 7; } });
  assert.throws(() => slider(hostile), { code: 'PREVIEW_STATE_ACCESSOR' });
  assert.equal(called, false);
  assert.throws(() => normalizePreviewState('{"form":{"type":"action","elements":[{"type":"button","constructor":{}}]}}'), { code: 'PREVIEW_STATE_UNSAFE_KEY' });
  assert.throws(() => action([{ type: 'label', text: 'a'.repeat(65537) }]), { code: 'PREVIEW_STATE_TEXT_LIMIT' });
  const nested = {}; let cursor = nested;
  for (let i = 0; i < 30; i++) { cursor.x = {}; cursor = cursor.x; }
  assert.throws(() => slider(nested), { code: 'PREVIEW_STATE_BUDGET' });
});
test('R37 P06 factory は表示type順に展開し文字・button番号を保持', async () => {
  const state = action([{ type: 'header', text: '見出し' }, { type: 'button', text: '進む' }, { type: 'label', text: '説明' }, { type: 'divider' }, { type: 'button', text: '戻る' }]);
  const document = { namespace: 'test_form', root: { type: 'stack_panel', collection_name: 'form_buttons', factory: { name: 'buttons', control_ids: { header: '@test_form.header', button: 'test_form.button', label: '@test_form.label', divider: '@test_form.divider' } } }, header: { type: 'label', text: '#form_button_text', size: [100, 16] }, label: { type: 'label', text: '#form_button_text', size: [100, 10] }, button: { type: 'button', size: [100, 32] }, divider: { type: 'panel', size: [100, 2] } };
  const catalog = await buildUiCatalog({ sources: [{ id: 'test', kind: 'imported', precedence: 10, filePaths: ['ui/test.json'], readText: async () => JSON.stringify(document) }], parseJsonc });
  const effective = resolveEffectiveUi({ catalog, recordId: catalog.symbols['test_form.root'].winnerId, representativeCollections: buildRepresentativeClassicCollections(state) });
  assert(effective.ok);
  const model = buildUiScreenModelFromJson(effective.document, { filePath: 'ui/test.json' });
  const evaluated = evaluateBindingsForUiModel(model, state);
  const factory = model.root.children[0];
  assert.deepEqual(factory.children.map((node) => node.type), ['label', 'button', 'label', 'panel', 'button']);
  assert.equal(evaluated.propsById[factory.children[0].id].text, '見出し');
  assert.equal(evaluated.propsById[factory.children[2].id].text, '説明');
  assert.equal(state.collectionData.form_buttons[4].__jsonui_preview_action_selection_index, 1);
});
test('R37 P05/P06 既存presetと静止表示の制約診断を保持', () => {
  for (const preset of ['empty', 'furnace', 'brewing', 'trade', 'action_form', 'inventory', 'anvil', 'enchanting', 'horse', 'book', 'modal_form']) assert.doesNotThrow(() => normalizePreviewState(createPreviewStatePreset(preset)));
  assert(action([]).diagnostics.some((d) => d.code === 'PREVIEW_STATE_FORM_DIRECT_DEFINITION'));
  assert(slider(range).diagnostics.some((d) => d.code === 'PREVIEW_STATE_MODAL_DIRECT_DEFINITION'));
});
