import test from 'node:test';
import assert from 'node:assert/strict';
import { BitmapTextLayoutCache } from '../../editor-core/src/preview/bitmap-text-layout-cache.js';
import { BitmapFontCache } from '../../editor-core/src/preview/bitmap-font-cache.js';
import { layoutBitmapText, drawBitmapText } from '../../editor-core/src/preview/bitmap-font.js';

const sources = [{ kind: 'vanilla', id: 'bitmap-fixture' }], context = { sources, locale: 'ja_JP' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const glyphs = Array.from({ length: 256 }, (_, cell) => ({ cell, sx: cell % 16 * 8, sy: Math.floor(cell / 16) * 8,
  sw: 8, sh: 8, advance: cell === 32 ? 4 : 6, empty: cell === 32, drawX: 0, drawW: 8 }));
function setup(limits) {
  const font = new BitmapFontCache(async () => ({ metrics: { glyphs } }), () => {}, () => {}, { decodeImage: async () => ({ width: 128, height: 128 }) });
  const cache = new BitmapTextLayoutCache(font, limits); let builds = 0;
  function ready(sheet, source = sources, locale = context.locale) {
    const row = { sheet, key: font.key(source, locale, sheet), status: 'ready', image: {}, metrics: { glyphs }, tinted: color => ({ color }) };
    font.rows.set(row.key, row); font.revision++; return row;
  }
  function run(text, options = {}, ctx = context) {
    return cache.getOrCreate(text, options, ctx, () => { builds++; return layoutBitmapText(text, { ...options, getSheet: name => font.get(ctx.sources, ctx.locale, name) }); });
  }
  return { font, cache, ready, run, get builds() { return builds; } };
}
function record(layout) {
  const operations = [];
  const ctx = { globalAlpha: 1, save() { operations.push(['save']); }, restore() { operations.push(['restore']); },
    translate(...args) { operations.push(['translate', ...args]); }, transform(...args) { operations.push(['transform', ...args]); },
    drawImage(image, ...args) { operations.push(['image', image.color, ...args]); }, fillRect(...args) { operations.push(['rect', ...args]); } };
  drawBitmapText(ctx, layout, { x: 4, y: 3, w: 80, h: 80, align: 'center', vertical: 'top', shadow: true }); return operations;
}

test('文字layout保持: 日本語/折返し/色/太字/斜体の描画を不変に保ち同じlayoutを再利用', () => {
  const env = setup(); for (const sheet of ['default8', 'glyph_65', 'glyph_67', 'glyph_8A']) env.ready(sheet);
  const text = '§cAB§lCD§oEF§r 日本語\nABC', options = { fontPx: 10, maxWidth: 45, linePadding: 2 };
  const initial = env.run(text, options), geometry = JSON.stringify(initial);
  const cached = env.run(text, options);
  assert.equal(initial.ready, true); assert.equal(cached, initial); assert.equal(env.builds, 1);
  assert.deepEqual(record(cached), record(layoutBitmapText(text, { ...options, getSheet: name => env.font.get(sources, context.locale, name) })));
  assert.equal(JSON.stringify(initial), geometry); assert.equal(env.cache.stats().hits, 1); env.font.clear();
});

test('文字layout保持: font/色/寸法/折返し/locale/原packと優先順をkeyで分離', () => {
  const env = setup(); env.ready('default8'); env.ready('ascii_sga'); env.ready('glyph_00');
  const first = env.run('ABC');
  for (const options of [{ fontType: 'rune' }, { fontType: 'unicode' }, { color: '#ff0000' }, { fontPx: 16 }, { maxWidth: 12 }, { linePadding: 4 }]) assert.notEqual(env.run('ABC', options), first);
  env.ready('default8', sources, 'en_US'); assert.notEqual(env.run('ABC', {}, { sources, locale: 'en_US' }), first);
  const imported = [{ kind: 'imported', id: 'pack' }, ...sources]; env.ready('default8', imported);
  assert.notEqual(env.run('ABC', {}, { ...context, sources: imported }), first);
  const reversed = imported.toReversed(); env.ready('default8', reversed);
  assert.notEqual(env.run('ABC', {}, { ...context, sources: reversed }), first);
  for (const maxWidth of [null, NaN, Infinity, 0, '20']) assert.throws(() => env.run('ABC', { maxWidth }), /FONT_LAYOUT_MAX_WIDTH/);
  env.font.clear();
});

test('文字layout保持: 未取得→ready→clear→同名sheet再読込を失効、missing layoutは保持しない', async () => {
  const env = setup();
  assert.equal(env.run('ABC').ready, false); assert.equal(env.cache.stats().entries, 0);
  const before = env.font.revision; env.font.ensure('ABC', 'default', sources, context.locale);
  for (let i = 0; i < 5; i++) await tick();
  assert(env.font.revision > before); const ready = env.run('ABC'); assert.equal(ready.ready, true); assert.equal(env.run('ABC'), ready);
  env.font.clear(); assert.equal(env.run('ABC').ready, false); assert.equal(env.cache.stats().entries, 0);
  env.ready('default8'); assert.notEqual(env.run('ABC'), ready); env.font.clear();
});

test('文字layout保持: sheet eviction/置換を見落とさずhitでsheet LRUも更新', () => {
  const env = setup(); const a = env.ready('default8'); const b = env.ready('glyph_30');
  const first = env.run('ABC'); env.font.get(sources, context.locale, 'glyph_30'); env.run('ABC');
  assert.equal([...env.font.rows.values()].at(-1), a);
  env.font.rows.delete(a.key); // custom owner missed a revision: identity gate remains protective.
  assert.equal(env.run('ABC').ready, false);
  env.ready('default8'); const replaced = env.run('ABC'); assert.notEqual(replaced, first);
  env.font.maxRows = 2; env.font.ensure('中', 'default', sources, context.locale);
  assert.equal(env.font.rows.has(b.key), false); assert(env.cache.stats().invalidations >= 2); env.font.clear();
});

test('文字layout保持: glyph総数/文字量/entry数を独立に制限し巨大layoutを保持しない', () => {
  for (const limits of [{ maxEntries: 2 }, { maxGlyphs: 6 }, { maxTextUnits: 110 }]) {
    const env = setup(limits); env.ready('default8'); env.run('AAA'); env.run('BBB'); env.run('CCC');
    const stats = env.cache.stats(); assert(stats.entries <= stats.maxEntries); assert(stats.glyphs <= stats.maxGlyphs); assert(stats.textUnits <= stats.maxTextUnits);
    env.cache.clear(); assert.equal(env.cache.stats().glyphs, 0); assert.equal(env.cache.stats().textUnits, 0); env.font.clear();
  }
  const env = setup({ maxGlyphs: 2 }); env.ready('default8'); assert.equal(env.run('ABC').ready, true); assert.equal(env.cache.stats().entries, 0); env.font.clear();
});

test('font revision: 失敗はmissing世代に進み再要求で無限loadingに戻らない', async () => {
  const font = new BitmapFontCache(async () => { throw new Error('FONT_SHEET_MISSING'); }, () => {}, () => {});
  const before = font.revision; font.ensure('A', 'default', sources, context.locale);
  for (let i = 0; i < 4; i++) await tick();
  assert(font.revision > before); assert.equal(font.stats().missing, 1); const missing = font.revision;
  font.ensure('A', 'default', sources, context.locale); assert.equal(font.revision, missing); font.clear(); assert(font.revision > missing);
});
