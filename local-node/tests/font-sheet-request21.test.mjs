import test from 'node:test';
import assert from 'node:assert/strict';
import { FontSheetRequestCache21 } from '../../editor-core/src/preview/font-sheet-request-cache21.js';
import { BitmapFontCache } from '../../editor-core/src/preview/bitmap-font-cache.js';
import { parseBedrockText } from '../../editor-core/src/preview/bitmap-font.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const sources = [{ kind: 'vanilla', id: 'font-request21' }];

test('同じ表示文字は再解析せず、不変なシート要求を返す', () => {
  const cache = new FontSheetRequestCache21();
  const first = cache.getSheets('Aあ中A');
  for (let count = 0; count < 100; count++) assert.equal(cache.getSheets('Aあ中A'), first);
  assert.deepEqual(first, ['default8', 'glyph_30', 'glyph_4E']);
  assert.equal(cache.stats().misses, 1); assert.equal(cache.stats().hits, 100);
  assert.throws(() => first.push('glyph_FF'), TypeError);
});

test('字体・改行・装飾・非BMPは既存のシート選択規則を保つ', () => {
  const cache = new FontSheetRequestCache21();
  assert.deepEqual(cache.getSheets('§aA\n§rあ😀'), ['default8', 'glyph_30']);
  assert.deepEqual(cache.getSheets('Aあ', 'unicode'), ['glyph_00', 'glyph_30']);
  assert.deepEqual(cache.getSheets('Aあ', 'rune'), ['ascii_sga', 'glyph_30']);
  assert.deepEqual(cache.getSheets('Aあ', 'smooth'), []); // remapping is required before addressing.
  assert.deepEqual(cache.getSheets('Aあ', 'smooth', new Map([[0x3042, 0x8742]])), ['smooth_00', 'smooth_87']);
  assert.deepEqual(cache.getSheets('Aあ', 'MinecraftTen'), []);
  assert.deepEqual(cache.getSheets(''), []);
});

test('LRUと文字量の両方で保持を制限し、退去した文字を再解析する', () => {
  const cache = new FontSheetRequestCache21({ maxEntries: 2, maxTextUnits: 20 });
  const first = cache.getSheets('A'); cache.getSheets('B'); cache.getSheets('A'); cache.getSheets('C');
  assert.equal(cache.getSheets('A'), first);
  assert.ok(cache.stats().textUnits <= 20); assert.equal(cache.stats().entries, 2);
  const before = cache.stats().misses; cache.getSheets('B');
  assert.equal(cache.stats().misses, before + 1);
  assert.ok(cache.stats().evictions >= 2);
});

test('予算超過文字と無効化設定は結果だけ返し、保持しない', () => {
  for (const settings of [{ maxEntries: 0 }, { maxTextUnits: 1 }]) {
    const cache = new FontSheetRequestCache21(settings);
    assert.deepEqual(cache.getSheets('A'), ['default8']);
    assert.deepEqual(cache.getSheets('A'), ['default8']);
    assert.equal(cache.stats().entries, 0); assert.equal(cache.stats().bypasses, 2);
  }
});

test('上限エラーを隠さず、解析失敗を成功として保持しない', () => {
  const cache = new FontSheetRequestCache21();
  assert.throws(() => cache.getSheets('あ'.repeat(32769)), /FONT_TEXT_LIMIT/);
  assert.equal(cache.stats().entries, 0);
  for (const settings of [{ maxEntries: -1 }, { maxTextUnits: Infinity }, { maxEntries: 1.2 }]) {
    assert.throws(() => new FontSheetRequestCache21(settings), /FONT_SHEET_REQUEST_CACHE_LIMIT_INVALID/);
  }
});

test('文字上限の事前検査はBMPとサロゲートペアの正しい境界を維持する', () => {
  assert.equal(parseBedrockText('あ'.repeat(32768)).characters.length, 32768);
  assert.equal(parseBedrockText('😀'.repeat(32768)).characters.length, 32768);
  assert.throws(() => parseBedrockText('あ'.repeat(32769)), /FONT_TEXT_LIMIT/);
  assert.throws(() => parseBedrockText('😀'.repeat(32769)), /FONT_TEXT_LIMIT/);
  assert.throws(() => new FontSheetRequestCache21().getSheets('x'.repeat(8 * 1024 * 1024)), /FONT_TEXT_LIMIT/);
});

test('クリア時に表示文字を開放し、統計には表示文字を含めない', () => {
  const cache = new FontSheetRequestCache21();
  cache.getSheets('機密の表示文字');
  assert.equal(JSON.stringify(cache.stats()).includes('機密'), false);
  cache.clear();
  assert.equal(cache.rows.size, 0); assert.equal(cache.stats().textUnits, 0);
});

test('描画用キャッシュは命中してもパック切替で必要シートを新規ロードする', async () => {
  const calls = [], errors = [];
  const cache = new BitmapFontCache(async request => {
    calls.push([request.sources[0].id, request.locale, request.sheet]); return { metrics: {} };
  }, () => {}, error => errors.push(error), { decodeImage: async () => ({ width: 128, height: 128 }) });
  try {
    cache.ensure('Aあ', 'default', sources, 'ja_JP');
    for (let index = 0; index < 8; index++) await tick();
    for (let index = 0; index < 30; index++) cache.ensure('Aあ', 'default', sources, 'ja_JP');
    assert.equal(calls.length, 2); assert.equal(cache.stats().sheetRequests.hits, 30);
    const next = [{ kind: 'imported', id: 'second-pack' }];
    cache.ensure('Aあ', 'default', next, 'ja_JP');
    for (let index = 0; index < 8; index++) await tick();
    assert.equal(calls.length, 4); assert.equal(cache.get(next, 'ja_JP', 'glyph_30').status, 'ready');
    cache.ensure('Aあ', 'default', next, 'en_US');
    for (let index = 0; index < 8; index++) await tick();
    assert.equal(calls.length, 6); assert.equal(errors.length, 0);
  } finally { cache.clear(); }
});

test('要求のキャッシュ命中で失敗シートを再試行せず、明示再試行は機能する', async () => {
  let loads = 0, recover = false;
  const cache = new BitmapFontCache(async () => {
    loads++; if (!recover) throw new Error('FONT_SOURCE_MISSING'); return { metrics: {} };
  }, () => {}, () => {}, { decodeImage: async () => ({ width: 128, height: 128 }) });
  try {
    cache.ensure('A', 'default', sources, 'en_US'); await tick(); await tick();
    cache.ensure('A', 'default', sources, 'en_US');
    assert.equal(loads, 1); assert.equal(cache.get(sources, 'en_US', 'default8').status, 'missing');
    recover = true; assert.equal(cache.retryFailures(), 1); await tick(); await tick();
    assert.equal(loads, 2); assert.equal(cache.get(sources, 'en_US', 'default8').status, 'ready');
  } finally { cache.clear(); }
});
