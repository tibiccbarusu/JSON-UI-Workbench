import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewMessageResolver } from '../../editor-core/src/engine/preview-raw-message38.js';
import { normalizePreviewState } from '../../editor-core/src/engine/preview-state.js';
import { normalizeModalForm } from '../../editor-core/src/engine/preview-modal-form.js';

const state = (form, messageContext) => normalizePreviewState({ form: { ...(form.elements ? {} : { buttons: [] }), ...form }, ...(messageContext === undefined ? {} : { messageContext }) });
const resolver = context => createPreviewMessageResolver(context);
const resolve = (message, context) => resolver(context).resolve(message, '', 'form.title');

test('R38 RawMessage text/rawtextは色コード・改行・非BMPを維持', () => {
  const input = { rawtext: [{ text: '§b観測\n' }, { rawtext: [{ text: '🧭' }, { text: '開始' }] }] };
  assert.equal(resolve(input), '§b観測\n🧭開始');
  assert.equal(resolve({ rawtext: [] }), '');
});

test('R38 明示翻訳表の%s/%%番号、rawtext引数、由来を保存', () => {
  const out = state({ title: { translate: 'greet', with: { rawtext: [{ text: 'Alex' }, { translate: 'role' }] } }, body: { translate: 'swap', with: ['A', 'B'] } }, { locale: 'ja_JP', translations: { greet: '%s: %s', role: '観測員', swap: '%%2 / %%1 / %%2' } });
  assert.equal(out.mockData['#title_text'], 'Alex: 観測員');
  assert.equal(out.mockData['#form_text'], 'B / A / B');
  const diagnostic = out.diagnostics.find(item => item.code === 'PREVIEW_STATE_RAW_MESSAGE_RESOLVED');
  assert.equal(diagnostic.locale, 'ja_JP');
  assert.equal(diagnostic.translationSource, 'explicit-messageContext-only');
  assert.equal(diagnostic.resolvedFields, 2);
  assert.deepEqual(diagnostic.provenance[0].translationKeys, ['greet', 'role']);
});

test('R38 ActionForm文字欄全てへ適用しicon pathは文字列を要求', () => {
  const out = state({ title: { text: '表題' }, body: { text: '本文' }, elements: ['button', 'header', 'label'].map(type => ({ type, text: { text: type } })) });
  assert.deepEqual(out.collectionData.form_buttons.map(row => row['#form_button_text']), ['button', 'header', 'label']);
  assert.throws(() => state({ buttons: [{ icon: { text: 'textures/ui/x' } }] }), { code: 'PREVIEW_STATE_STRING_REQUIRED' });
});

test('R38 ModalFormの見出し/options/placeholder/tooltip/sliderを同一resolverで展開', () => {
  const msg = text => ({ text });
  const form = { type: 'modal', title: msg('設定'), submitText: msg('適用'), elements: [
    { type: 'input', text: msg('名前'), tooltip: msg('説明'), placeholder: msg('入力'), value: 'Alex' },
    { type: 'dropdown', text: msg('航路'), options: [msg('東'), msg('西')], selected: 1 },
    { type: 'step_slider', text: msg('段階'), options: [msg('低'), msg('高')], selected: 1 },
    { type: 'slider', text: msg('量'), range: { min: 0, max: 4, current: 2 }, valueText: msg('二'), displayText: msg('量:二') },
  ] };
  const out = normalizePreviewState({ form });
  assert.equal(out.mockData['#title_text'], '設定');
  assert.equal(out.mockData['#submit_text'], '適用');
  const rows = out.collectionData.custom_form;
  assert.equal(rows[0]['#custom_placeholder_text'], '入力');
  assert.equal(rows[0]['#custom_tooltip_text'], '説明');
  assert.equal(rows[1]['#dropdown_option_text'], '西');
  assert.equal(rows[1].__collections.custom_dropdown[0]['#custom_radio_text'], '東');
  assert.equal(rows[2]['#custom_slider_step_text_value'], '高');
  assert.equal(rows[3]['#custom_slider_text_value'], '二');
  assert.equal(rows[3]['#custom_slider_text'], '量:二');
  assert.equal(out.diagnostics.filter(item => item.code === 'PREVIEW_STATE_RAW_MESSAGE_RESOLVED').length, 1);
  assert.equal(normalizeModalForm({ type: 'modal', title: msg('直接'), elements: [{ type: 'label', text: '' }] }).mockData['#title_text'], '直接');
  assert.throws(() => normalizePreviewState({ form: { type: 'modal', elements: [{ type: 'input', value: msg('不可') }] } }), { code: 'PREVIEW_STATE_STRING_REQUIRED' });
});

test('R38 未提供翻訳・score・未知field・曖昧nodeを部分表示しない', () => {
  for (const [message, code] of [
    [{ translate: 'absent' }, 'PREVIEW_STATE_RAW_MESSAGE_TRANSLATION_MISSING'],
    [{ score: { name: '*', objective: 'score' } }, 'PREVIEW_STATE_RAW_MESSAGE_SCORE_UNSUPPORTED'],
    [{ text: 'x', extra: true }, 'PREVIEW_STATE_UNKNOWN_FIELD'],
    [{ text: 'x', translate: 'a' }, 'PREVIEW_STATE_RAW_MESSAGE_AMBIGUOUS'],
    [{ text: 'x', with: [] }, 'PREVIEW_STATE_RAW_MESSAGE_AMBIGUOUS'],
    [{}, 'PREVIEW_STATE_RAW_MESSAGE_AMBIGUOUS'],
    [{ rawtext: ['文字列nodeは禁止'] }, 'PREVIEW_STATE_RAW_MESSAGE_OBJECT'],
  ]) assert.throws(() => resolve(message), { code });
});

test('R38 翻訳placeholder不足・未知形式・非文字列引数を拒否', () => {
  assert.throws(() => resolve({ translate: 'a' }, { translations: { a: '%s' } }), { code: 'PREVIEW_STATE_RAW_MESSAGE_ARGUMENT_MISSING' });
  for (const template of ['%1$s', '%%s', '%d', '%%0']) assert.throws(() => resolve({ translate: 'a', with: ['x'] }, { translations: { a: template } }), { code: 'PREVIEW_STATE_RAW_MESSAGE_PLACEHOLDER_UNSUPPORTED' });
  assert.throws(() => resolve({ translate: 'a', with: [{ text: 'x' }] }, { translations: { a: '%s' } }), { code: 'PREVIEW_STATE_STRING_REQUIRED' });
  assert.equal(resolve({ translate: 'a' }, { translations: { a: '完了100%' } }), '完了100%');
});

test('R38 accessor・prototype・循環・sparse arrayを評価前に拒否', () => {
  let getterCalls = 0;
  const message = {}; Object.defineProperty(message, 'text', { enumerable: true, get() { getterCalls++; return 'unsafe'; } });
  assert.throws(() => resolve(message), { code: 'PREVIEW_STATE_ACCESSOR' });
  const translations = {}; Object.defineProperty(translations, 'a', { enumerable: true, get() { getterCalls++; return 'unsafe'; } });
  assert.throws(() => resolver({ translations }), { code: 'PREVIEW_STATE_ACCESSOR' });
  const entries = []; Object.defineProperty(entries, '0', { enumerable: true, get() { getterCalls++; return { text: 'unsafe' }; } });
  assert.throws(() => resolve({ rawtext: entries }), { code: 'PREVIEW_STATE_ACCESSOR' });
  assert.equal(getterCalls, 0);
  assert.throws(() => resolve(Object.create({ text: 'inherited' })), { code: 'PREVIEW_STATE_RAW_MESSAGE_OBJECT' });
  assert.throws(() => resolver(JSON.parse('{"translations":{"__proto__":"bad"}}')), { code: 'PREVIEW_STATE_UNSAFE_KEY' });
  const cyclic = { rawtext: [] }; cyclic.rawtext.push(cyclic);
  assert.throws(() => resolve(cyclic), { code: 'PREVIEW_STATE_RAW_MESSAGE_CYCLE' });
  assert.throws(() => resolve({ rawtext: Array(2) }), { code: 'PREVIEW_STATE_RAW_MESSAGE_ARRAY' });
});

test('R38 UTF8単一展開・form合計・深さ・node数を有限予算で拒否', () => {
  assert.throws(() => resolve({ translate: 'a', with: ['あ'.repeat(12000)] }, { translations: { a: '%s%s' } }), { code: 'PREVIEW_STATE_RAW_MESSAGE_ARGUMENT_MISSING' });
  assert.throws(() => resolve({ translate: 'a', with: ['あ'.repeat(12000)] }, { translations: { a: '%%1%%1' } }), { code: 'PREVIEW_STATE_RAW_MESSAGE_OUTPUT_LIMIT' });
  const aggregate = resolver({ translations: { a: 'x'.repeat(65536) } });
  for (let i = 0; i < 16; i++) assert.equal(aggregate.resolve({ translate: 'a' }, '', `field.${i}`).length, 65536);
  assert.throws(() => aggregate.resolve({ translate: 'a' }, '', 'field.16'), { code: 'PREVIEW_STATE_RAW_MESSAGE_OUTPUT_LIMIT' });
  let deep = { text: 'x' }; for (let i = 0; i < 26; i++) deep = { rawtext: [deep] };
  assert.throws(() => resolve(deep), { code: 'PREVIEW_STATE_RAW_MESSAGE_BUDGET' });
  const many = resolver(); for (let i = 0; i < 4096; i++) many.resolve({ text: '' }, '', 'field');
  assert.throws(() => many.resolve({ text: '' }, '', 'field'), { code: 'PREVIEW_STATE_RAW_MESSAGE_BUDGET' });
});

test('R38 既存文字列出力・非破壊・明示raw overrideを維持', () => {
  const title = '観'.repeat(30000);
  assert.equal(state({ title }).mockData['#title_text'], title);
  const input = { form: { title: { text: 'Typed' }, buttons: [] }, mockData: { '#title_text': 'Override' } };
  const before = JSON.stringify(input), out = normalizePreviewState(input);
  assert.equal(out.mockData['#title_text'], 'Override');
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(normalizePreviewState({ form: { buttons: [] } }).diagnostics.map(item => item.code), ['PREVIEW_STATE_FORM_DIRECT_DEFINITION']);
});

test('R38 context誤字・型・用途を明示拒否しprovenance件数を制限', () => {
  assert.throws(() => state({}, { fallback: 'en_US' }), { code: 'PREVIEW_STATE_UNKNOWN_FIELD' });
  assert.throws(() => state({}, { locale: '../ja' }), { code: 'PREVIEW_STATE_MESSAGE_LOCALE' });
  assert.throws(() => normalizePreviewState({ messageContext: {} }), { code: 'PREVIEW_STATE_MESSAGE_CONTEXT_REQUIRES_FORM' });
  const many = resolver(); for (let i = 0; i < 140; i++) many.resolve({ text: 'x' }, '', `field.${i}`);
  assert.equal(many.diagnostics[0].provenance.length, 128);
  assert.equal(many.diagnostics[0].omittedProvenance, 12);
  assert.equal(many.diagnostics[0].resolvedFields, 140);
});
