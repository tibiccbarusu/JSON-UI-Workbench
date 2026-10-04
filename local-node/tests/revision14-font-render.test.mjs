import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { loadRasterBackend } from '../frame-raster13.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';
import { decodeFontSheet } from '../font-sheet.mjs';
import { createLocalServer } from '../server.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { syntheticGlyphSheets } from './synthetic-font-fixtures.mjs';
import { BitmapFontCache } from '../../editor-core/src/preview/bitmap-font-cache.js';
import { compileGlyphMetrics, glyphAddress, layoutBitmapText, drawBitmapText } from '../../editor-core/src/preview/bitmap-font.js';
const recovery = new URL('../../docs/revision14/evidence/font-recovery/', import.meta.url);
const text = 'あア修持日本語！？■□';
const sheetNames = [...new Set(Array.from(text, ch => glyphAddress(ch).sheet))];
const hex = bytes => createHash('sha256').update(bytes).digest('hex');
const canvas = loadRasterBackend();
const rasterSkip = canvas ? false : 'NOT_RUN: PNG backend @napi-rs/canvas is not installed; npm ci installs the optional supported backend.';

async function sheet(bytes, name) {
  const image = await canvas.loadImage(bytes);
  return { status: 'ready', image, metrics: decodeFontSheet(bytes, name), tinted: () => image };
}
function render(layout, dpr = 1) {
  const out = canvas.createCanvas(Math.ceil(layout.width * dpr) + 4, Math.ceil(layout.height * dpr) + 4);
  const ctx = out.getContext('2d'); ctx.scale(dpr, dpr);
  drawBitmapText(ctx, layout, { x: 0, y: 0, w: layout.width, h: layout.height, vertical: 'top' });
  return { out, ctx, pixels: ctx.getImageData(0, 0, out.width, out.height).data };
}

test('縮小時も原atlasの細い線を残し、等倍・HiDPIではsamplingを変えない', { skip: rasterSkip }, async () => {
  // A source stem on an odd source column vanished entirely when 16px was
  // sampled at 8px by nearest-neighbour. This is a data-loss regression.
  const width = 256, data = Buffer.alloc(width * width * 4), cell = 0xe5;
  const ox = cell % 16 * 16, oy = Math.floor(cell / 16) * 16;
  for (let y = 1; y < 15; y++) for (const x of [1, 7]) {
    const at = ((oy + y) * width + ox + x) * 4;
    data[at] = data[at + 1] = data[at + 2] = data[at + 3] = 255;
  }
  const bytes = pngjs.PNG.sync.write({ width, height: width, data });
  const source = await sheet(bytes, 'glyph_65');
  // Preserve the full test cell so the stroke remains on the odd column.
  source.metrics.glyphs[cell].drawX = 0; source.metrics.glyphs[cell].drawW = 16;
  const small = layoutBitmapText('日', { fontPx: 8, getSheet: () => source });
  const actual = render(small);
  assert(actual.pixels.some((v, i) => i % 4 === 3 && v > 0 && v < 255), '縮小時に元の細線がcoverageとして残る');
  const nearest = canvas.createCanvas(actual.out.width, actual.out.height), n = nearest.getContext('2d');
  n.imageSmoothingEnabled = false; n.drawImage(source.image, ox, oy, 16, 16, 0, 0, 8, 8);
  const old = n.getImageData(0, 0, nearest.width, nearest.height).data;
  assert.equal(old.filter((v, i) => i % 4 === 3 && v).length, 0, '修正前samplingでは同じ線が消える');
  for (const [fontPx, dpr] of [[16, 1], [32, 1], [8, 2], [16, 2]]) {
    const layout = layoutBitmapText('日', { fontPx, getSheet: () => source });
    const result = render(layout, dpr);
    const expected = canvas.createCanvas(result.out.width, result.out.height), e = expected.getContext('2d');
    e.imageSmoothingEnabled = false; e.drawImage(source.image, ox, oy, 16, 16, 0, 0, fontPx * dpr, fontPx * dpr);
    assert.deepEqual(result.pixels, e.getImageData(0, 0, expected.width, expected.height).data, `原画素一致 ${fontPx}px / DPR ${dpr}`);
  }
});

for (const fixtureKind of ['synthetic', 'private']) test(
  fixtureKind === 'synthetic'
    ? '合成atlas: 複数UnicodeシートをHTTP font APIと非同期cacheで解決し欠字と区別する'
    : '非公開実字形: 漢字・かな・記号を同じfont APIと非同期cacheで解決し欠字と区別する',
  { timeout: 30000, skip: rasterSkip }, async t => {
  const files = { 'manifest.json': manifest };
  const synthetic = fixtureKind === 'synthetic' ? syntheticGlyphSheets(text) : null;
  for (const name of sheetNames) {
    try { files[`font/${name}.png`] = synthetic ? synthetic.get(name) : await readFile(new URL(name + '.png', recovery)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      t.skip('NOT_RUN: 非同梱の実字形fixtureがありません。これは字形検証の成功ではありません。'); return;
    }
  }
  if (fixtureKind === 'private') assert.equal(hex(files['font/glyph_4F.png']), '2c0c065f7fc8963875b0fb6833129291536e21d875b0f9456f09ae2949dffc00', '添付bundleのroot glyphとSHA一致');
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`, cap = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' }, id = randomUUID();
  const imported = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id }, body: makeZip(files) });
  assert.equal(imported.status, 200); await imported.arrayBuffer();
  const sources = [{ id, kind: 'vanilla' }], errors = [], originalDocument = globalThis.document;
  globalThis.document = { createElement: type => { assert.equal(type, 'canvas'); return canvas.createCanvas(1, 1); } };
  t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
  let notify;
  const settled = new Promise(resolve => { notify = resolve; });
  const cache = new BitmapFontCache(async (payload, signal) => {
    const response = await fetch(base + 'font', { method: 'POST', headers, body: JSON.stringify(payload), signal });
    assert.equal(response.status, 200); return response.json();
  }, () => { if (cache.stats().pending === 0 && cache.stats().queued === 0) notify(); }, error => errors.push(error.message),
  { decodeImage: data => canvas.loadImage(Buffer.from(data.png, 'base64')) });
  t.after(() => cache.clear());
  cache.ensure(text, 'default', sources, 'ja_JP'); await settled;
  assert.deepEqual(errors, []); assert.equal(cache.stats().ready, sheetNames.length);
  const layout = layoutBitmapText(text, { fontPx: 16, getSheet: name => cache.get(sources, 'ja_JP', name) });
  assert.equal(layout.ready, true); assert.equal(layout.missingGlyphCount, 0); assert.equal(layout.loadingGlyphCount, 0);
  for (const ch of text) {
    const single = layoutBitmapText(ch, { fontPx: 16, getSheet: name => cache.get(sources, 'ja_JP', name) });
    assert(render(single).pixels.some((v, i) => i % 4 === 3 && v), `${ch} に対応するfixture画素あり (${fixtureKind})`);
  }
  const snapshot = cache.snapshot(); assert.equal(snapshot.sheets.length, sheetNames.length);
  assert(snapshot.sheets.every(row => row.status === 'ready' && row.width === 256 && row.provenance.path.startsWith('font/')));
  assert(snapshot.sheets.every(row => !Object.hasOwn(row, 'png') && !Object.hasOwn(row, 'image'))); assert(!JSON.stringify(snapshot).includes('characters'));
  const missing = layoutBitmapText('漢', { fontPx: 16, getSheet: () => ({ status: 'missing' }) });
  assert.equal(missing.ready, false); assert.equal(missing.missingGlyphCount, 1); assert.equal(missing.issues[0].code, 'FONT_GLYPH_MISSING');
  const empty = layoutBitmapText('漢', { fontPx: 16, getSheet: () => ({ image: {}, metrics: compileGlyphMetrics({ width: 128, height: 128, data: Buffer.alloc(128 * 128 * 4) }, 'glyph_6F') }) });
  assert.equal(empty.issues[0].code, 'FONT_GLYPH_EMPTY');
  t.diagnostic(JSON.stringify({ fixture_kind: fixtureKind, provided_asset_validation: fixtureKind === 'private', native_game_executed: false, sheets: sheetNames.length, glyphs: Array.from(text).length, missing: layout.missingGlyphCount, origin: snapshot.sheets.map(row => row.provenance), cache: cache.stats() }));
});

test('alphaを持つ黒い字形も欠字と誤判定しない', () => {
  const width = 256, data = Buffer.alloc(width * width * 4), cell = 0xe5;
  data[((Math.floor(cell / 16) * 16 + 1) * width + cell % 16 * 16 + 1) * 4 + 3] = 255;
  const metrics = compileGlyphMetrics({ width, height: width, data }, 'glyph_65');
  assert.equal(metrics.glyphs[cell].empty, false);
  const layout = layoutBitmapText('日', { fontPx: 16, getSheet: () => ({ image: {}, metrics }) });
  assert.equal(layout.ready, true);
});
