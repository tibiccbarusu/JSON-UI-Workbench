import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutBitmapText, drawBitmapText } from '../../editor-core/src/preview/bitmap-font.js';

const glyph = cell => ({ cell, sx: cell % 16 * 8, sy: Math.floor(cell / 16) * 8,
  sw: 8, sh: 8, advance: cell === 32 ? 4 : 6, empty: cell === 32, drawX: 0, drawW: 8 });
const sheet = { image: {}, tinted: color => ({ color }), metrics: { glyphs: Array.from({ length: 256 }, (_, cell) => glyph(cell)) } };
const getSheet = () => sheet;
const textLines = layout => layout.lines.map(line => line.glyphs.map(g => g.character).join(''));

test('bitmap折返し: maxWidth未指定は明示改行のみ・従来幅/高さ/座標を維持', () => {
  const layout = layoutBitmapText('ABC DEF\nG', { getSheet, fontPx: 16, linePadding: 3 });
  assert.deepEqual(textLines(layout), ['ABC DEF', 'G']);
  assert.equal(layout.width, 80); assert.equal(layout.height, 35); assert.equal(layout.lineHeight, 19);
  assert.deepEqual(layout.lines[0].glyphs.map(g => g.x), [0, 12, 24, 36, 44, 56, 68]);
  assert.equal(Object.hasOwn(layout, 'wrapProfile'), false);
});

test('bitmap折返し: 英語は単語を優先し区切り空白から空行を作らない', () => {
  const layout = layoutBitmapText('hello world a', { getSheet, maxWidth: 36 });
  assert.deepEqual(textLines(layout), ['hello', 'world', 'a']);
  assert.deepEqual(layout.lines.map(line => line.width), [30, 30, 6]);
  assert.equal(layout.height, 24); assert.equal(layout.wrapProfile, 'glyph-advance-latin-word-v1');
  assert.deepEqual(textLines(layoutBitmapText('one two', { getSheet, maxWidth: 40 })), ['one two']);
  assert.deepEqual(textLines(layoutBitmapText('word    next', { getSheet, maxWidth: 24 })), ['word', 'next']);
});

test('bitmap折返し: 日本語・Latin混在は文字と単語単位で進む', () => {
  const layout = layoutBitmapText('日本語の説明です', { getSheet, maxWidth: 18 });
  assert.deepEqual(textLines(layout), ['日本語', 'の説明', 'です']);
  assert.equal(layout.width, 18); assert.equal(layout.height, 24);
  assert.deepEqual(textLines(layoutBitmapText('説明 hello 次', { getSheet, maxWidth: 30 })), ['説明', 'hello', '次']);
});

test('bitmap折返し: 長い単語・超過する単glyph・明示連続改行は有限', () => {
  assert.deepEqual(textLines(layoutBitmapText('abcdef', { getSheet, maxWidth: 18 })), ['abc', 'def']);
  const small = layoutBitmapText('Aあ', { getSheet, maxWidth: 1 });
  assert.deepEqual(textLines(small), ['A', 'あ']); assert.equal(small.width, 6);
  assert.deepEqual(textLines(layoutBitmapText('AB\n\nCD\n', { getSheet, maxWidth: 6 })), ['A', 'B', '', 'C', 'D', '']);
  assert.deepEqual(textLines(layoutBitmapText('', { getSheet, maxWidth: 6 })), ['']);
});

test('bitmap折返し: 色・太字・斜体・resetを行跨ぎで保持し描画位置も一致', () => {
  const layout = layoutBitmapText('§cA§lBC§oD§rE', { getSheet, maxWidth: 14, fontPx: 8 });
  assert.deepEqual(textLines(layout), ['AB', 'CD', 'E']);
  assert.deepEqual(layout.lines.map(line => line.width), [13, 14, 6]);
  const items = layout.lines.flatMap(line => line.glyphs);
  assert.deepEqual(items.map(g => g.color), ['#ff5555', '#ff5555', '#ff5555', '#ff5555', '#ffffff']);
  assert.deepEqual(items.map(g => g.bold), [false, true, true, true, false]);
  assert.deepEqual(items.map(g => g.italic), [false, false, false, true, false]);
  const positions = [], colors = [];
  const ctx = { globalAlpha: 1, save() {}, restore() {}, transform() {},
    translate(x, y) { positions.push([x, y]); }, drawImage(image) { colors.push(image.color); } };
  drawBitmapText(ctx, layout, { x: 10, y: 20, w: 14, h: 24, vertical: 'top' });
  assert.deepEqual(positions, [[10, 20], [16, 20], [10, 28], [17, 28], [10, 36]]);
  assert.equal(colors.length, 8);
});

test('bitmap折返し: 非整数font寸法・padding・欠字も同じadvanceで計測', () => {
  const layout = layoutBitmapText('AAAA', { getSheet, fontPx: 10, linePadding: 2.5, maxWidth: 15 });
  assert.deepEqual(textLines(layout), ['AA', 'AA']); assert.equal(layout.width, 15); assert.equal(layout.height, 22.5);
  const missing = layoutBitmapText('あいう', { getSheet: () => null, maxWidth: 16 });
  assert.deepEqual(textLines(missing), ['あい', 'う']); assert.equal(missing.missingGlyphCount, 3);
  assert.equal(missing.loadingGlyphCount, 3); assert.equal(missing.ready, false);
  assert.deepEqual(missing.lines[0].glyphs.map(g => g.x), [0, 8]);
});

test('bitmap折返し: 不正maxWidthと32768文字上限を維持', () => {
  for (const maxWidth of [0, -1, NaN, Infinity, -Infinity, null, '20']) assert.throws(() => layoutBitmapText('A', { getSheet, maxWidth }), /FONT_LAYOUT_MAX_WIDTH/);
  assert.throws(() => layoutBitmapText('A'.repeat(32769), { getSheet, maxWidth: 6 }), /FONT_TEXT_LIMIT/);
  const layout = layoutBitmapText('A'.repeat(32768), { getSheet, maxWidth: 6 });
  assert.equal(layout.lines.length, 32768); assert.equal(layout.lines.at(-1).width, 6);
  assert.equal(layout.lines.reduce((sum, line) => sum + line.glyphs.length, 0), 32768);
});
