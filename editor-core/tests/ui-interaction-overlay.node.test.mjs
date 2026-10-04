/** mainの実overlay領域を抽出しDOM境界を模したイベントで検査する。ブラウザ実行ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { siteText, translateSiteMessage } from '../src/i18n/site-messages.js';
import { getUiInteractionSourceNode } from '../src/preview/ui-interaction-target.js';
import { describeTextInteraction, commitTextInteraction } from '../src/preview/ui-interaction-engine.js';
const text = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const start = text.indexOf('// 入力overlayはroute DOMの再生成から独立して保持する。');
const end = text.indexOf('function inferEditBoxBoundMockKeyFromUiNode', start);
assert(start >= 0 && end > start);
const positionStart = text.indexOf('function syncPreviewEditBoxOverlayPosition('), positionEnd = text.indexOf('function clampUnit(', positionStart);
const code = text.slice(start, end) + text.slice(positionStart, positionEnd);
function setup({ multiline = false, maxLength = 30, collection = null } = {}) {
  const inputNode = { id: 'input', type: 'edit_box', props: { enabled_newline: multiline, max_length: maxLength }, children: [{ id: 'label', type: 'label', props: { text: '#value' }, bindings: [{ binding_name: '#value', binding_name_override: '#text', binding_type: collection ? 'collection' : 'global', ...(collection ? { binding_collection_name: collection } : {}) }] }] };
  const model = { root: inputNode }, state = { files: { currentFileId: 'screen:ui/test.json' } }, applied = [], notices = [], timers = new Map(), cs = { previewClosed: false, view: { zoom: 2, viewX: 10, viewY: 5 }, layout: { boxes: [{ id: 'input', x: 30, y: 20, w: 70, h: 12 }] } };
  const context = { state, enabled: true, pocket: false, model, screenDefinition: 'test.screen', mockData: { '#value': '' }, collectionData: collection ? { [collection]: [{ '#value': '' }, { '#value': 'other' }] } : {}, propsById: {} };
  const elements = [];
  const document = { getElementById(id) { return id === 'preview-canvas' ? { getBoundingClientRect() { return { left: 100, top: 200 }; } } : null; }, createElement(tag) {
    const handlers = new Map();
    const element = { tagName: tag.toUpperCase(), style: {}, isConnected: false, value: '', validityMessage: '', handlers, addEventListener(name, fn) { handlers.set(name, fn); }, setAttribute() {}, removeAttribute(name) { if (name === 'maxlength') delete this.maxLength; }, setCustomValidity(value) { this.validityMessage = value; }, focus() {}, blur() { handlers.get('blur')?.({}); }, remove() { this.isConnected = false; } };
    elements.push(element); return element;
  }, body: { appendChild(element) { element.isConnected = true; } } };
  const sandbox = { siteText, translateSiteMessage, document, getUiInteractionSourceNode, toFiniteNumber: value => Number(value) || 0, clampNumber: (value, min, max) => Math.max(min, Math.min(max, value)), getBedrockLogicalFontPx: () => 10, describeTextInteraction, commitTextInteraction, getInteractionPreviewContext: () => context, getInteractionHitProps: (_,id) => context.propsById[id] || {}, getCanvasState: () => cs, findUiNodeById: (_, id) => id === 'input' ? inputNode : null, setStatus: message => notices.push(message), setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), commitPreviewInteractionEffects(effects) { applied.push(effects); for (const effect of effects) if (effect.type === 'mockPatch') Object.assign(context.mockData, effect.patch); else if (effect.type === 'collectionPatch') Object.assign(context.collectionData, effect.patch); } };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nglobalThis.api = { focusPreviewEditBoxOverlay, commitPreviewEditBoxMockDataNow, hidePreviewEditBoxOverlay, state: previewEditBoxOverlayState };', sandbox);
  const descriptor = describeTextInteraction({ enabled: true, node: inputNode, collectionIndex: collection ? 0 : undefined }); assert(descriptor.edit);
  const focus = () => sandbox.api.focusPreviewEditBoxOverlay({ fileKey: 'file-key', nodeId: 'input', edit: descriptor.edit, value: '' });
  focus();
  const fire = (name, event = {}) => sandbox.api.state.inputEl.handlers.get(name)?.(event);
  const flush = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  return { api: sandbox.api, context, model, inputNode, elements, input: () => sandbox.api.state.inputEl, applied, notices, cs, focus, fire, flush };
}
test('textarea used for multiline and maxLength zero retained', () => {
  const multi = setup({ multiline: true }); assert.equal(multi.input().tagName, 'TEXTAREA');
  const zero = setup({ maxLength: 0 }); assert.equal(zero.input().maxLength, 0);
});
test('IME intermediate strings do not commit; composition end commits once', () => {
  const h = setup(); h.fire('compositionstart'); h.input().value = 'に'; h.fire('input', { isComposing: true }); h.flush(); assert.equal(h.applied.length, 0);
  h.input().value = '日本語'; h.fire('compositionend'); h.flush(); assert.equal(h.applied.length, 1); assert.equal(h.context.mockData['#value'], '日本語');
});
test('turning mode OFF cancels pending typed changes', () => {
  const h = setup(); h.input().value = 'changed'; h.fire('input'); h.context.enabled = false; h.flush(); assert.equal(h.applied.length, 0); assert.equal(h.api.state.active, null);
});
test('file, model, definition, close and Pocket changes reject stale events', () => {
  const mutations = [h => h.context.state.files.currentFileId = 'another', h => h.context.model = {}, h => h.context.screenDefinition = 'another', h => h.cs.previewClosed = true, h => h.context.pocket = true];
  for (const mutate of mutations) { const h = setup(); h.input().value = 'bad'; h.fire('input'); mutate(h); h.flush(); assert.equal(h.applied.length, 0); }
});
test('typing never overwrites external update of same data', () => {
  const h = setup(); h.input().value = 'new input'; h.fire('input'); h.context.mockData['#value'] = 'external'; h.flush(); assert.equal(h.applied.length, 0); assert.equal(h.context.mockData['#value'], 'external'); assert.match(h.notices[0], /上書き/u);
});
test('Escape cancels pending draft; Enter commits single line', () => {
  const h = setup(); h.input().value = 'cancel'; h.fire('input'); h.fire('keydown', { key: 'Escape', preventDefault() {} }); h.flush(); assert.equal(h.applied.length, 0);
  h.focus(); h.input().value = 'done'; h.fire('keydown', { key: 'Enter', preventDefault() {} }); assert.equal(h.applied.length, 1);
});
test('ordinary Enter does not terminate multiline input; Ctrl+Enter commits', () => {
  const h = setup({ multiline: true }); h.input().value = 'a\nb'; h.fire('keydown', { key: 'Enter', preventDefault() { throw new Error('newline prevented'); } }); assert(h.api.state.active);
  h.fire('keydown', { key: 'Enter', ctrlKey: true, preventDefault() {} }); assert.equal(h.applied.length, 1); assert.equal(h.context.mockData['#value'], 'a\nb');
});
test('oversized paste fails and can be corrected without partial write', () => {
  const h = setup({ maxLength: 3 }); h.input().value = 'longer'; h.fire('input'); h.flush(); assert.equal(h.applied.length, 0); assert(h.input().validityMessage);
  h.input().value = 'ok'; h.fire('input'); h.flush(); assert.equal(h.applied.length, 1); assert.equal(h.input().validityMessage, '');
});
test('collection edit writes only its addressed row', () => {
  const h = setup({ collection: 'book_pages' }); h.input().value = 'page0'; h.fire('input'); h.flush(); assert.equal(h.context.collectionData.book_pages[0]['#value'], 'page0'); assert.equal(h.context.collectionData.book_pages[1]['#value'], 'other'); assert.equal(h.context.mockData['#value'], '');
});
test('descriptor limit changes are revalidated at commit', () => {
  const h = setup(); h.input().value = 'longer'; h.fire('input'); h.context.propsById.input = { max_length: 2 }; h.flush(); assert.equal(h.applied.length, 0);
});

test('focus immediately positions overlay at canvas CSS coordinates before rendering another frame', () => {
  const h = setup(); assert.equal(h.input().style.left, '140px'); assert.equal(h.input().style.top, '230px'); assert.equal(h.input().style.width, '140px'); assert.equal(h.input().style.height, '24px');
});
