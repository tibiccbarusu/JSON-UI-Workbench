// Optional pixel verifier; @napi-rs/canvas belongs to the verification host and
// is not an application dependency. Usage: node this-file.mjs font-dir out-dir.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { BitmapFontCache } from '../editor-core/src/preview/bitmap-font-cache.js';
import { BitmapTextLayoutCache } from '../editor-core/src/preview/bitmap-text-layout-cache.js';
import { compileGlyphMetrics, layoutBitmapText, drawBitmapText } from '../editor-core/src/preview/bitmap-font.js';

const [fontDirectory, output] = process.argv.slice(2);
if (!fontDirectory || !output || !process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('PIXEL_VERIFIER_ARGUMENTS_REQUIRED');
const require = createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'));
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const previousDocument = globalThis.document;
globalThis.document = { createElement: type => { if (type !== 'canvas') throw new Error('CANVAS_ONLY'); return createCanvas(1, 1); } };
const sources = [{ kind: 'vanilla', id: 'official-japanese-fonts' }], context = { sources, locale: 'ja_JP' };
const provenance = {}, errors = [];
const fonts = new BitmapFontCache(async ({ sheet }) => {
  const bytes = await readFile(path.join(fontDirectory, `${sheet}.png`));
  const image = await loadImage(bytes), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  provenance[sheet] = createHash('sha256').update(bytes).digest('hex');
  return { png: bytes.toString('base64'), metrics: compileGlyphMetrics(ctx.getImageData(0, 0, image.width, image.height), sheet) };
}, () => {}, error => errors.push(error.message), { decodeImage: data => loadImage(Buffer.from(data.png, 'base64')) });
const cache = new BitmapTextLayoutCache(fonts);
await mkdir(output, { recursive: true });
const report = { run_id: 'jsonui07-20260907', stage_ref: 'bitmap-layout-cache-pixels', validation_status: 'NOT_RUN',
  created_at: new Date().toISOString(), source_sha256: provenance, results: [],
  limitation: '公式日本語 glyph 画像を使用した @napi-rs/canvas の比較。ブラウザ全体 FPS、Minecraft 実機の画素一致、Windows 描画の検査ではない。' };
try {
  fonts.ensure('日本語', 'unicode', sources, context.locale);
  const deadline = performance.now() + 15000;
  while ((fonts.pending || fonts.queue.length) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  if (fonts.pending || fonts.queue.length || errors.length) throw new Error(errors.join(',') || 'FONT_VERIFICATION_TIMEOUT');
  for (const [index, scenario] of [
    { text: '日本語日本語', fontPx: 16 },
    { text: '§c日§l本語§o日本§r語\n日本語', fontPx: 16, maxWidth: 90, linePadding: 3 },
    { text: '日本語日本語日本語日本語', fontPx: 12, maxWidth: 70, linePadding: 2 },
  ].entries()) {
    const { text, ...style } = scenario, options = { fontType: 'unicode', color: '#ffffff', ...style };
    const build = () => layoutBitmapText(text, { ...options, getSheet: name => fonts.get(sources, context.locale, name) });
    const before = build(), first = cache.getOrCreate(text, options, context, build), retained = cache.getOrCreate(text, options, context, build);
    const images = [];
    for (const layout of [before, retained]) {
      const canvas = createCanvas(256, 160), ctx = canvas.getContext('2d'); ctx.fillStyle = '#26303c'; ctx.fillRect(0, 0, 256, 160);
      drawBitmapText(ctx, layout, { x: 10, y: 10, w: 236, h: 140, align: 'center', vertical: 'center', shadow: true });
      images.push({ png: canvas.toBuffer('image/png'), rgba: ctx.getImageData(0, 0, 256, 160).data });
    }
    const hashes = images.map(image => createHash('sha256').update(image.rgba).digest('hex'));
    const startedFull = performance.now(); for (let i = 0; i < 3000; i++) build(); const fullMs = performance.now() - startedFull;
    const startedCache = performance.now(); for (let i = 0; i < 3000; i++) cache.getOrCreate(text, options, context, build); const cachedMs = performance.now() - startedCache;
    report.results.push({ index, text, ready: before.ready, reference_reused: first === retained, rgba_sha256: hashes,
      validation_status: before.ready && hashes[0] === hashes[1] && first === retained ? 'PASS' : 'FAIL',
      repeated_layouts: 3000, uncached_ms: fullMs, cached_ms: cachedMs });
    await writeFile(path.join(output, `bitmap-cache-${index}.png`), images[1].png);
  }
  report.cache = cache.stats(); report.validation_status = report.results.every(row => row.validation_status === 'PASS') ? 'PASS' : 'FAIL';
} finally { cache.clear(); fonts.clear(); if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report)); if (report.validation_status !== 'PASS') process.exitCode = 1;
