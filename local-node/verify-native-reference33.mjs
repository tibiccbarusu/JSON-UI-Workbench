/** 公式RPのモデル読取とPNG生成を再現する調査用CLI。実機一致検証ではない。 */
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadRasterBackend } from './frame-raster13.mjs';
import { loadHorsePreviewFromSources, loadPlayerPreviewFromSources } from '../editor-core/src/preview/native-model-loader.js';
import { buildEnchantingBookPreviewScene } from '../editor-core/src/preview/native-model-preview.js';
import { resolveEnchantingBookPreviewScene } from '../editor-core/src/preview/native-book-preview.js';
import { drawCanvasPreview } from '../editor-core/src/preview/canvas-preview.js';

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error('使用法: node local-node/verify-native-reference33.mjs <resource_pack> <output-directory>');
const sourceRoot = resolve(sourcePath), outputRoot = resolve(outputPath);
const signal = AbortSignal.timeout(30_000);
const files = (await readdir(sourceRoot, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
const packPaths = files.map(entry => join(entry.parentPath || entry.path, entry.name).slice(sourceRoot.length + 1).replaceAll('\\', '/'));
const entries = new Map();
for (const packPath of packPaths.filter(path => /^(entity|models|render_controllers)\/.*\.json$/iu.test(path))) {
  signal.throwIfAborted();
  entries.set(packPath, { info: { uncompressedSize: (await stat(join(sourceRoot, packPath))).size } });
}
const runtime = { rootPrefix: '', packPaths, zipReader: { entryIndex: entries,
  async readText(path, options = {}) {
    signal.throwIfAborted();
    if (!entries.has(path)) throw new Error('REFERENCE_PATH_NOT_INDEXED');
    const text = await readFile(join(sourceRoot, path), { encoding: 'utf8', signal });
    if (Buffer.byteLength(text) > options.maxBytes) throw new Error('REFERENCE_READ_LIMIT');
    return text;
  },
} };
const sources = [{ source: 'official-reference', runtime }];
const options = { sources, targetEngineVersion: [1, 26, 50], signal, cacheDocuments: true };
const scenes = [];
for (const [name, previewState] of [
  ['horse-white', {}],
  ['horse-brown-saddle', { variant: 3, markVariant: 2, isSaddled: true }],
  ['horse-iron-armor', { armorVariant: 2, isSaddled: true }],
]) scenes.push({ name, result: await loadHorsePreviewFromSources({ ...options, previewState }) });
scenes.push({ name: 'player-steve', result: await loadPlayerPreviewFromSources(options) });
const book = buildEnchantingBookPreviewScene();
for (const open of [false, true]) scenes.push({ name: open ? 'book-open' : 'book-closed', result: {
  status: 'ready', scene: resolveEnchantingBookPreviewScene(book, { open }),
  textureRef: 'textures/entity/enchanting_table_book', approximation: 'BOUNDED_BOOK_MODEL',
} });
const backend = loadRasterBackend();
if (!backend) throw new Error('RASTER_BACKEND_UNAVAILABLE');
await mkdir(outputRoot, { recursive: true });
const descriptors = new Map(['window', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.defineProperty(globalThis, 'window', { value: { devicePixelRatio: 1 }, configurable: true });
Object.defineProperty(globalThis, 'OffscreenCanvas', { value: function(w, h) { return backend.createCanvas(w, h); }, configurable: true });
const report = { schema: 'jsonui-native-reference-r33', createdAt: new Date().toISOString(),
  sourceRole: 'OFFICIAL_INDEPENDENT_REFERENCE_NOT_USER_VERSION', targetEngineVersion: [1, 26, 50],
  deviceParity: 'UNVERIFIED', packFileCount: packPaths.length, scenes: [] };
try {
  for (const { name, result } of scenes) {
    signal.throwIfAborted();
    const row = { name, status: result.status, issue: result.issue || null, detail: result.detail || null,
      stats: result.stats || null, provenance: result.provenance || null, textures: [] };
    report.scenes.push(row);
    if (result.status !== 'ready' || !result.scene) continue;
    const textureRefs = result.textureRefs?.length ? result.textureRefs : [result.textureRef];
    const layers = [];
    for (const ref of textureRefs) {
      const path = `${ref}.png`;
      if (!packPaths.includes(path)) throw new Error(`REFERENCE_TEXTURE_MISSING: ${path}`);
      const bytes = await readFile(join(sourceRoot, path), { signal });
      const image = await backend.loadImage(bytes);
      layers.push({ image, width: image.width, height: image.height });
      row.textures.push({ path, width: image.width, height: image.height, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const canvas = backend.createCanvas(240, 300);
    canvas.getBoundingClientRect = () => ({ width: 240, height: 300 });
    // Control-dependent placement is retained; these are isolated specimens.
    const isHorse = result.scene.kind === 'horse', isPlayer = result.scene.kind === 'player';
    const box = isHorse ? { x: 75, y: 200, w: 90, h: 90 }
      : isPlayer ? { x: 75, y: 82, w: 90, h: 90 } : { x: 20, y: 50, w: 200, h: 200 };
    row.drawIssues = [];
    drawCanvasPreview(canvas, { preset: { width: 240, height: 300 }, boxes: [
      { id: 'model', type: 'custom', ...box, renderAlpha: 1 },
    ] }, { zoom: 1, viewX: 0, viewY: 0 }, { showGuides: false, showScreenBoundary: false,
      showResizeHandles: false, imageDrawById: { model: {
        state: 'native-scene', ...layers[0], imageLayers: layers, nativeScene: result.scene,
      } }, onNativeSceneIssue: issue => row.drawIssues.push(issue) });
    const png = canvas.toBuffer('image/png');
    row.png = `${name}.png`; row.pngSha256 = createHash('sha256').update(png).digest('hex');
    await writeFile(join(outputRoot, row.png), png);
  }
} finally {
  for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
}
await writeFile(join(outputRoot, 'native-reference33.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ scenes: report.scenes.map(row => ({ name: row.name, status: row.status, issue: row.issue,
  drawIssues: row.drawIssues })), deviceParity: report.deviceParity }));
if (report.scenes.some(row => row.status !== 'ready' || row.drawIssues?.length)) process.exitCode = 1;
