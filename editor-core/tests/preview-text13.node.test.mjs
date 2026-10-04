import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectPreviewText } from '../src/preview/preview-text.js';
import { countDrawableCanvasBoxes, findDrawableCanvasBounds } from '../src/preview/canvas-preview.js';

const resolve = (value, props) => Object.hasOwn(props, value) ? props[value] : value;
test('empty edit_box text selects and resolves its placeholder, including runtime empty values', () => {
  for (const empty of [undefined, null, '']) {
    assert.equal(selectPreviewText('edit_box', { text: empty, place_holder_text: '#prompt', '#prompt': 'A' }, resolve), 'A');
    assert.equal(selectPreviewText('edit_box', { text: '#input', '#input': empty, place_holder_text: 'A' }, resolve), 'A');
  }
  assert.equal(selectPreviewText('label', { text: '', place_holder_text: 'A' }, resolve), '');
  assert.equal(selectPreviewText('button', { text: '#input', '#input': null, place_holder_text: 'A' }, resolve), null);
});
test('nonempty, whitespace, unresolved and non-string input never selects a placeholder', () => {
  for (const value of ['A', ' ', '\t\n', '#missing', '$missing', '(#runtime)', 0, false, true, 42, [], {}]) {
    const props = { text: '#input', '#input': value, place_holder_text: '#prompt' }, calls = [];
    const text = selectPreviewText('edit_box', props, (input, context) => { calls.push(input); return resolve(input, context); });
    assert.equal(text, value); assert.deepEqual(calls, ['#input']);
  }
});
test('official placeholder wins, including its explicit empty value; alias fills only nullish absence', () => {
  for (const official of [undefined, null]) assert.equal(selectPreviewText('edit_box', { text: '', place_holder_text: official, placeholder_text: 'alias' }, resolve), 'alias');
  for (const official of ['', 0, false, '#missing', 'official']) assert.equal(selectPreviewText('edit_box', { text: '', place_holder_text: official, placeholder_text: 'alias' }, resolve), official);
  assert.equal(selectPreviewText('edit_box', { text: '', place_holder_text: '#prompt', '#prompt': '', placeholder_text: 'alias' }, resolve), '');
});
test('drawable count and bounds agree after runtime resolution without treating missing tokens as empty', () => {
  const box = { id: 'entry', type: 'edit_box', x: 4, y: 5, w: 32, h: 12, renderAlpha: 1 };
  const layout = { preset: { width: 100, height: 100 }, boxes: [box] };
  const cases = [
    [{ place_holder_text: 'A' }, true], [{ text: '', place_holder_text: 'A' }, true],
    [{ text: '#input', '#input': '', place_holder_text: 'A' }, true],
    [{ text: '', placeholder_text: 'A' }, true], [{ text: 'A', place_holder_text: '#missing' }, true],
    [{ text: '', place_holder_text: '', placeholder_text: 'A' }, false],
    [{ text: ' ', place_holder_text: 'A' }, false], [{ text: '#missing', place_holder_text: 'A' }, false],
    [{ text: '#loop', '#loop': '#loop', place_holder_text: 'A' }, false],
  ];
  for (const [props, visible] of cases) {
    const nodesById = { entry: { type: 'edit_box', props } };
    assert.equal(countDrawableCanvasBoxes({ boxes: layout.boxes, nodesById }), visible ? 1 : 0, JSON.stringify(props));
    assert.deepEqual(findDrawableCanvasBounds({ layout, nodesById }), visible ? { x: 4, y: 5, w: 32, h: 12 } : null, JSON.stringify(props));
  }
});
test('GUI and PNG text preparation use the same selector; literal wiring only, no DOM execution', async () => {
  const [main, raster, canvas] = await Promise.all([
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../local-node/frame-raster13.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/preview/canvas-preview.js', import.meta.url), 'utf8'),
  ]);
  assert.match(main, /const textValue = selectPreviewText\(type, props, resolveLocalRuntimePropertyToken\)/u);
  assert.match(raster, /let text = selectPreviewText\(box\.type, props, runtimeToken\)/u);
  assert.equal([...canvas.matchAll(/selectPreviewText\(type, props,/gu)].length, 2);
});
