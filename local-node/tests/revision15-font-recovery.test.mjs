import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { createLocalServer } from '../server.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { syntheticGlyphSheets } from './synthetic-font-fixtures.mjs';
import { decodeFontSheet } from '../font-sheet.mjs';
import { BitmapFontCache } from '../../editor-core/src/preview/bitmap-font-cache.js';
import { BitmapTextLayoutCache } from '../../editor-core/src/preview/bitmap-text-layout-cache.js';
import { glyphAddress, layoutBitmapText, drawBitmapText } from '../../editor-core/src/preview/bitmap-font.js';

const sources = [{ kind: 'vanilla', id: 'font-pack' }];
const text = 'あア修持日本語！？■□';
const recovery = new URL('../../docs/revision14/evidence/font-recovery/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canvas = loadRasterBackend();
const rasterSkip = canvas ? false : 'NOT_RUN: PNG backend @napi-rs/canvas is not installed; npm ci installs the optional supported backend.';
function trackedCache(load, options = {}) {
  const errors = [], waiters = [];
  const cache = new BitmapFontCache(load, () => {
    if (!cache.pending && !cache.queue.length) for (const resolve of waiters.splice(0)) resolve();
  }, (error, sheet) => errors.push({ code: error.message, sheet }), options);
  return { cache, errors, idle: () => !cache.pending && !cache.queue.length
    ? Promise.resolve() : new Promise(resolve => waiters.push(resolve)) };
}
function render(layout) {
  const image = canvas.createCanvas(Math.ceil(layout.width) + 8, Math.ceil(layout.height) + 8);
  const ctx = image.getContext('2d');
  drawBitmapText(ctx, layout, { x: 4, y: 4, w: layout.width, h: layout.height, vertical: 'top' });
  return { image, rgba: ctx.getImageData(0, 0, image.width, image.height).data };
}

for (const fixtureKind of ['synthetic', 'private']) test(
  fixtureKind === 'synthetic'
    ? '合成atlas HTTP: 複数シートの一時失敗を明示再計算で回復し、直接解析のRGBAと一致'
    : '非公開実字形HTTP: かな成功後の漢字・記号の一時失敗を明示再計算で回復し、原画素と一致',
  { timeout: 30000, skip: rasterSkip }, async t => {
  const files = { 'manifest.json': manifest }, originals = new Map();
  const synthetic = fixtureKind === 'synthetic' ? syntheticGlyphSheets(text) : null;
  for (const sheet of new Set(Array.from(text, ch => glyphAddress(ch).sheet))) {
    let bytes;
    try { bytes = synthetic ? synthetic.get(sheet) : await readFile(new URL(sheet + '.png', recovery)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      t.skip('NOT_RUN: 非同梱の実字形fixtureがありません。これは字形回復検証の成功ではありません。'); return;
    }
    files[`font/${sheet}.png`] = bytes; originals.set(sheet, bytes);
  }
  if (fixtureKind === 'private') assert.equal(hash(originals.get('glyph_4F')), '2c0c065f7fc8963875b0fb6833129291536e21d875b0f9456f09ae2949dffc00');
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const cap = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' }, id = randomUUID();
  const imported = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id }, body: makeZip(files) });
  assert.equal(imported.status, 200); await imported.arrayBuffer();
  const remoteSources = [{ kind: 'vanilla', id }], calls = new Map();
  const failedSheets = new Set(['glyph_4F', 'glyph_FF']);
  const { cache, errors, idle } = trackedCache(async (payload, signal) => {
    const count = (calls.get(payload.sheet) || 0) + 1; calls.set(payload.sheet, count);
    // Fault injection at the transport boundary, not a claim that the original
    // attached incident returned this status. Actual retry uses the product API.
    if (failedSheets.has(payload.sheet) && count === 1) throw Object.assign(new Error('NODE_HTTP_503'), { status: 503 });
    const response = await fetch(base + 'font', { method: 'POST', headers, body: JSON.stringify(payload), signal });
    assert.equal(response.status, 200); return response.json();
  }, { decodeImage: data => canvas.loadImage(Buffer.from(data.png, 'base64')) });
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: kind => { assert.equal(kind, 'canvas'); return canvas.createCanvas(1, 1); } };
  t.after(() => { cache.clear(); if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
  const layoutCache = new BitmapTextLayoutCache(cache);
  const layout = () => layoutCache.getOrCreate(text, { fontPx: 16 }, { sources: remoteSources, locale: 'ja_JP' },
    () => layoutBitmapText(text, { fontPx: 16, getSheet: sheet => cache.get(remoteSources, 'ja_JP', sheet) }));
  cache.ensure('あア', 'default', remoteSources, 'ja_JP'); await idle();
  const kana = cache.get(remoteSources, 'ja_JP', 'glyph_30');
  cache.ensure(text, 'default', remoteSources, 'ja_JP'); await idle();
  const failed = layout(), failedPixels = render(failed), initialCalls = new Map(calls);
  assert.equal(failed.ready, false); assert.equal(failed.missingGlyphCount, 3);
  assert.equal(failed.loadingGlyphCount, 0); assert.deepEqual(failed.issues.map(issue => issue.code), ['FONT_GLYPH_MISSING', 'FONT_GLYPH_MISSING', 'FONT_GLYPH_MISSING']);
  assert.equal(failed.lines[0].glyphs[0].sheet, kana);
  for (let i = 0; i < 5; i++) { cache.ensure(text, 'default', remoteSources, 'ja_JP'); layout(); }
  await idle(); assert.deepEqual(calls, initialCalls, '通常再描画では失敗通信を反復しない');
  assert.equal(cache.retryFailures(), 2); assert.equal(cache.retryFailures(), 0, '同じ明示操作の連打はinflightを重複しない');
  await idle();
  const fixed = layout(), fixedPixels = render(fixed);
  assert.equal(fixed.ready, true); assert.equal(fixed.missingGlyphCount, 0);
  assert.equal(cache.get(remoteSources, 'ja_JP', 'glyph_30'), kana, '正常字形を再取得・置換しない');
  assert.equal(fixed.lines[0].glyphs.filter(item => item.placeholder).length, 0);
  assert.deepEqual([...calls].filter(([sheet]) => failedSheets.has(sheet)).map(([, count]) => count), [2, 2]);
  assert.notEqual(hash(failedPixels.rgba), hash(fixedPixels.rgba));
  const direct = new Map();
  for (const [sheet, bytes] of originals) {
    const image = await canvas.loadImage(bytes), metrics = decodeFontSheet(bytes, sheet);
    const tinted = canvas.createCanvas(image.width, image.height), ctx = tinted.getContext('2d');
    ctx.drawImage(image, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, image.width, image.height);
    direct.set(sheet, { status: 'ready', image, metrics, tinted: () => tinted });
  }
  const expected = render(layoutBitmapText(text, { fontPx: 16, getSheet: sheet => direct.get(sheet) }));
  assert.deepEqual(fixedPixels.rgba, expected.rgba, 'HTTP再取得後は直接解析した同じfixtureのRGBAと一致');
  const result = { status: 'PASS', fixture_kind: fixtureKind, provided_asset_validation: fixtureKind === 'private', native_game_executed: false, scenario: 'explicit-retry-after-injected-transient-font-error', original_incident_reproduced: false,
    errors, before: { missing: failed.missingGlyphCount, rgba_sha256: hash(failedPixels.rgba) },
    after: { missing: fixed.missingGlyphCount, rgba_sha256: hash(fixedPixels.rgba), direct_rgba_identical: true }, cache: cache.snapshot(), calls: Object.fromEntries(calls) };
  if (process.env.JSONUI_FONT_EVIDENCE_DIR) {
    await mkdir(process.env.JSONUI_FONT_EVIDENCE_DIR, { recursive: true });
    const prefix = fixtureKind === 'synthetic' ? 'synthetic-' : '';
    await writeFile(join(process.env.JSONUI_FONT_EVIDENCE_DIR, prefix + 'font-retry-before.png'), await failedPixels.image.encode('png'));
    await writeFile(join(process.env.JSONUI_FONT_EVIDENCE_DIR, prefix + 'font-retry-after.png'), await fixedPixels.image.encode('png'));
    await writeFile(join(process.env.JSONUI_FONT_EVIDENCE_DIR, prefix + 'font-recovery-result.json'), JSON.stringify(result, null, 2) + '\n');
  }
  t.diagnostic(JSON.stringify(result));
});

test('言語反復変更が古いlocaleの予約メモリで現在の字形を欠字にしない', { timeout: 10000 }, async t => {
  const closed = [], { cache, errors, idle } = trackedCache(async payload => ({ ...payload, metrics: {} }),
    { decodeImage: async data => ({ width: 256, height: 256, close: () => closed.push(data.locale) }) });
  t.after(() => cache.clear());
  // At the old five-copy reservation, two locale copies exceed this budget.
  cache.maxBytes = 256 * 256 * 4 * 5;
  for (const locale of ['ja_JP', 'en_US', 'ja_JP', 'en_US', 'ja_JP']) {
    cache.ensure('修', 'default', sources, locale); await idle();
    assert.equal(cache.get(sources, locale, 'glyph_4F')?.status, 'ready');
    assert.equal(cache.stats().entries, 1); assert(cache.stats().bytes <= cache.maxBytes);
  }
  assert.deepEqual(errors, []); assert.equal(closed.length, 4);
});

test('同じ言語の画面履歴でbyte上限に達しても明示再計算は現在画面だけを再取得できる', { timeout: 10000 }, async t => {
  let calls = 0, closed = 0;
  const { cache, idle } = trackedCache(async () => { calls++; return { metrics: {} }; },
    { decodeImage: async () => ({ width: 256, height: 256, close: () => { closed++; } }) });
  t.after(() => cache.clear()); cache.maxBytes = 256 * 256 * 4 * 5;
  cache.ensure('あ', 'default', sources, 'ja_JP'); await idle();
  cache.ensure('修', 'default', sources, 'ja_JP'); await idle();
  assert.equal(cache.get(sources, 'ja_JP', 'glyph_4F').errorCode, 'FONT_CACHE_BYTE_LIMIT');
  assert.equal(cache.stats().entries, 2, 'row上限より先にbyte上限へ到達');
  assert.equal(cache.retryFailures(), 1); assert.equal(cache.stats().entries, 0);
  cache.ensure('修', 'default', sources, 'ja_JP'); await idle();
  assert.equal(cache.get(sources, 'ja_JP', 'glyph_4F').status, 'ready');
  assert.equal(cache.get(sources, 'ja_JP', 'glyph_30'), undefined);
  assert.equal(calls, 3); assert.equal(closed, 2, '上限超過画像と旧画面画像を解放');
});

test('単一画面自体がbyte上限を超える場合は明示的に止まり自動再取得を反復しない', { timeout: 10000 }, async t => {
  let calls = 0;
  const { cache, idle } = trackedCache(async () => { calls++; return { metrics: {} }; },
    { decodeImage: async () => ({ width: 256, height: 256 }) });
  t.after(() => cache.clear()); cache.maxBytes = 256 * 256 * 4 * 5;
  cache.ensure('あ修', 'default', sources, 'ja_JP'); await idle();
  assert.equal(cache.stats().missing, 1); assert.equal(calls, 2);
  for (let i = 0; i < 10; i++) cache.ensure('あ修', 'default', sources, 'ja_JP');
  await idle(); assert.equal(calls, 2);
  assert.equal(cache.retryFailures(), 1); cache.ensure('あ修', 'default', sources, 'ja_JP'); await idle();
  assert.equal(calls, 4); assert.equal(cache.stats().missing, 1); assert.equal(cache.stats().pending, 0);
  assert(cache.stats().bytes <= cache.maxBytes);
});

test('明示clear無しでlocaleとpackを変更しても古い通信・decodeは新世代へ戻らない', { timeout: 10000 }, async t => {
  let resolveOldLoad, resolveOldDecode, oldDecodeStarted;
  const decodeStarted = new Promise(resolve => { oldDecodeStarted = resolve; });
  const closed = [], { cache, errors, idle } = trackedCache(payload => {
    if (payload.locale === 'ja_JP' && payload.sheet === 'default8') return new Promise(resolve => { resolveOldLoad = resolve; });
    return Promise.resolve({ ...payload, metrics: {} });
  }, { decodeImage: data => {
    if (data.locale === 'ja_JP') return new Promise(resolve => { resolveOldDecode = resolve; oldDecodeStarted(); });
    return Promise.resolve({ width: 128, height: 128 });
  } });
  t.after(() => cache.clear());
  cache.ensure('A修', 'default', sources, 'ja_JP'); await decodeStarted;
  const nextSources = [{ kind: 'imported', id: 'next-pack' }];
  cache.ensure('A修', 'default', nextSources, 'en_US');
  resolveOldLoad({ locale: 'ja_JP', metrics: {} });
  resolveOldDecode({ width: 128, height: 128, close: () => closed.push('old') });
  await idle();
  assert.equal(cache.stats().ready, 2); assert.equal(cache.stats().entries, 2);
  assert.equal(cache.get(sources, 'ja_JP', 'default8'), undefined);
  assert.equal(cache.get(nextSources, 'en_US', 'glyph_4F')?.status, 'ready');
  assert.deepEqual(closed, ['old']); assert.deepEqual(errors, []);
});

test('恒久的な欠字は自動反復せず、明示再試行も1回の有限処理に留まる', { timeout: 10000 }, async t => {
  let calls = 0;
  const { cache, idle } = trackedCache(async () => { calls++; throw new Error('FONT_SHEET_MISSING'); });
  t.after(() => cache.clear());
  cache.ensure('修', 'default', sources, 'ja_JP'); await idle();
  for (let i = 0; i < 10; i++) cache.ensure('修', 'default', sources, 'ja_JP');
  assert.equal(calls, 1); assert.equal(cache.retryFailures(), 1); await idle();
  assert.equal(calls, 2); assert.equal(cache.stats().missing, 1); assert.equal(cache.stats().pending, 0);
  assert.equal(cache.snapshot().sheets[0].attempts, 2);
});

for (const stage of ['load', 'decode']) test(`timeout後の明示再試行中に旧${stage}が遅れて完了しても新試行を汚染しない`, { timeout: 10000 }, async t => {
  let resolveOld, resolveNew, loadCalls = 0, decodeCalls = 0, closed = 0;
  const { cache, idle } = trackedCache(async () => {
    const attempt = ++loadCalls;
    if (stage === 'load') return new Promise(resolve => { if (attempt === 1) resolveOld = resolve; else resolveNew = resolve; });
    return { attempt, metrics: {} };
  }, { timeoutMs: 15, decodeImage: async data => {
    decodeCalls++;
    if (stage === 'decode') return new Promise(resolve => { if (data.attempt === 1) resolveOld = resolve; else resolveNew = resolve; });
    return { width: 128, height: 128 };
  } });
  t.after(() => cache.clear());
  cache.ensure('修', 'default', sources, 'ja_JP'); await idle();
  assert.equal(cache.snapshot().sheets[0].errorCode, 'FONT_LOAD_TIMEOUT');
  cache.timeoutMs = 5000; assert.equal(cache.retryFailures(), 1);
  await new Promise(resolve => setImmediate(resolve));
  resolveOld(stage === 'load' ? { attempt: 1, metrics: {} } : { width: 128, height: 128, close: () => { closed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.snapshot().sheets[0].status, 'loading');
  if (stage === 'load') assert.equal(decodeCalls, 0, '中断済みの旧loadは新controllerへ付け替えてdecodeしない');
  else assert.equal(closed, 1, '旧decode画像を必ず解放する');
  resolveNew(stage === 'load' ? { attempt: 2, metrics: {} } : { width: 128, height: 128 });
  await idle();
  assert.equal(cache.stats().ready, 1); assert.equal(cache.stats().pending, 0);
  assert.equal(cache.snapshot().sheets[0].errorCode, null);
  assert.equal(decodeCalls, stage === 'load' ? 1 : 2);
});
