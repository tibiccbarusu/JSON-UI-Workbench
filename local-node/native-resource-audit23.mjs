/** 固定リソースのJSON UI・3D選択・Canvas画素の再現可能な監査。実機認定はしない。 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DiskZipReader } from './disk-zip.mjs';
import { loadRasterBackend } from './frame-raster13.mjs';
import { getDefaultPlayerRuntime } from './native-player-default.mjs';
import { drawCanvasPreview } from '../editor-core/src/preview/canvas-preview.js';
import { loadHorsePreviewFromSources, loadPlayerPreviewFromSources } from '../editor-core/src/preview/native-model-loader.js';
import { buildEnchantingBookPreviewScene } from '../editor-core/src/preview/native-model-preview.js';
import { resolveEnchantingBookPreviewScene } from '../editor-core/src/preview/native-book-preview.js';
import { sampleNativePreviewMotion } from '../editor-core/src/preview/native-motion.js';
import { buildUiCatalog, listEffectiveDefinitionsForPath } from '../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const countCodes = rows => rows.reduce((out, row) => { out[row.code] = (out[row.code] || 0) + 1; return out; }, {});

/** 指定ZIPを読取専用で監査し、レポートと比較用PNGをoutputDirectoryへ保存する。 */
export async function auditNativeResourcePack23(referenceZip, outputDirectory) {
  const output = path.resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const reader = new DiskZipReader();
  const report = { schema: 'jsonui-render-audit-v23', startedAt: new Date().toISOString(), runtime: process.version,
    validation_status: 'NOT_RUN', limitation_ja: '固定再構成fixtureの解決・投影・画素検査。元vanilla全体でも実機一致認定でもない。',
    validation_scope_ja: '指定3モデル・9画面の有限解決・Pocket遮断・7画像の画素。カタログ全件の完全性はcatalog.summary.referenceCoverageを参照。',
    sourceName: path.basename(referenceZip), models: [], catalog: null, ui: [], images: [] };
  const checkpoint = () => writeFile(path.join(output, 'resource-audit.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    await reader.openFromFile({ diskPath: path.resolve(referenceZip), name: path.basename(referenceZip) });
    report.zip = (await reader.listEntries()).meta;
    const packPaths = await reader.listAllFilePaths();
    const runtime = { rootPrefix: '', zipReader: reader, packPaths };
    const sources = [{ source: 'reference', runtime }];
    const scenes = [];
    for (const version of [[1, 16, 0], [1, 26, 45]]) {
      const result = await loadHorsePreviewFromSources({ sources, targetEngineVersion: version, cacheDocuments: true });
      report.models.push({ kind: 'horse', version, status: result.status, issue: result.issue, detail: result.detail,
        stats: result.stats, textureRefs: result.textureRefs, provenance: result.provenance });
      if (result.status === 'ready') scenes.push({ name: `horse-${version.join('-')}`, scene: result.scene, refs: result.textureRefs });
      await checkpoint();
    }
    const player = await loadPlayerPreviewFromSources({ sources: [...sources, { source: 'default-player', runtime: getDefaultPlayerRuntime() }],
      targetEngineVersion: [1, 26, 45], cacheDocuments: true });
    report.models.push({ kind: 'player', status: player.status, issue: player.issue, stats: player.stats,
      textureRefs: player.textureRefs, provenance: player.provenance });
    if (player.status === 'ready') scenes.push({ name: 'player-resource', scene: player.scene, refs: player.textureRefs });
    const baseBook = buildEnchantingBookPreviewScene();
    for (const open of [false, true]) scenes.push({ name: `book-${open ? 'open' : 'closed'}`,
      scene: resolveEnchantingBookPreviewScene(baseBook, { '#open': open }), refs: ['textures/entity/enchanting_table_book'] });
    const turningBook = buildEnchantingBookPreviewScene({ camera: { yaw: 160, pitch: 20 } });
    scenes.push({ name: 'book-closed-yaw-160', scene: resolveEnchantingBookPreviewScene(turningBook, { '#open': false }),
      refs: ['textures/entity/enchanting_table_book'] });
    if (scenes[1]?.scene.kind === 'horse') scenes.push({ name: 'horse-pointer-turn',
      scene: sampleNativePreviewMotion(scenes[1].scene, { pointer: { active: true, x: 1, y: .5 } }), refs: scenes[1].refs });
    await checkpoint();

    const catalog = await buildUiCatalog({ sources: [{ id: 'reference-v2', kind: 'vanilla', precedence: 10,
      filePaths: packPaths, readText: (name, options) => reader.readText(name, options) }], parseJsonc });
    report.catalog = { summary: catalog.summary, diagnostics: countCodes(catalog.diagnostics),
      chestChoices: listEffectiveDefinitionsForPath(catalog, 'ui/chest_screen.json').map(row => ({ qualifiedName: row.qualifiedName, classification: row.classification })) };
    for (const qualifiedName of ['anvil.anvil_screen', 'beacon.beacon_screen', 'enchanting.enchanting_screen', 'horse.horse_screen',
      'chest.small_chest_screen', 'chest.large_chest_screen', 'crafting.inventory_screen', 'crafting.crafting_screen', 'book.book_screen']) {
      const recordId = catalog.symbols[qualifiedName]?.winnerId;
      const result = resolveEffectiveUi({ catalog, recordId, variables: buildRepresentativeClassicResolverVariables({ qualifiedName }),
        representativeCollections: buildRepresentativeClassicCollections({ qualifiedName }) });
      report.ui.push({ qualifiedName, engineResultOk: result.ok, error: result.error, stats: result.stats,
        diagnostics: countCodes(result.diagnostics || []), resolvedDocumentSha256: result.ok ? hash(JSON.stringify(result.document)) : null });
      await checkpoint();
    }
    const pocket = catalog.records.find(row => row.profile === 'pocket');
    const pocketResult = pocket && resolveEffectiveUi({ catalog, recordId: pocket.id });
    report.pocket = { loaded: Boolean(pocket), blocked: pocketResult?.error?.code === 'POCKET_PREVIEW_BLOCKED' };

    const backend = loadRasterBackend();
    report.canvasAvailable = Boolean(backend);
    if (backend) {
      const previous = ['window', 'OffscreenCanvas'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
      Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: function(w, h) { return backend.createCanvas(w, h); } });
      try {
        const sheet = backend.createCanvas(1280, 640), sheetContext = sheet.getContext('2d');
        sheetContext.fillStyle = '#e8eaf0'; sheetContext.fillRect(0, 0, 1280, 640);
        for (const [index, item] of scenes.entries()) {
          const layers = [];
          for (const ref of item.refs) {
            const packPath = `${ref}.png`, bytes = await reader.bytes(packPath, 32 * 1024 * 1024);
            const image = await backend.loadImage(bytes);
            layers.push({ image, width: image.width, height: image.height, packPath, sha256: hash(bytes) });
          }
          const canvas = backend.createCanvas(300, 270), issues = [];
          canvas.getBoundingClientRect = () => ({ width: 300, height: 270 });
          const isHorse = item.scene.kind === 'horse';
          const box = { id: 'model', type: 'custom', x: isHorse ? 100 : 75, y: isHorse ? 170 : 100,
            w: isHorse ? 90 : 150, h: isHorse ? 90 : 150, renderAlpha: 1 };
          const scene = item.scene.kind === 'player' ? { ...item.scene, presentationProfile: 'bounded-player-fit-v1' } : item.scene;
          drawCanvasPreview(canvas, { preset: { width: 300, height: 270 }, boxes: [box] }, { zoom: 1, viewX: 0, viewY: 0 }, {
            transparentBackground: true, showGuides: false, showScreenBoundary: false, showResizeHandles: false,
            imageDrawById: { model: { state: 'native-scene', ...layers[0], imageLayers: layers, nativeScene: scene, alpha: 1 } },
            onNativeSceneIssue: issue => issues.push(issue),
          });
          const pixels = canvas.getContext('2d').getImageData(0, 0, 300, 270).data;
          let nontransparentPixels = 0;
          for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset]) nontransparentPixels += 1;
          const png = canvas.toBuffer('image/png');
          await writeFile(path.join(output, `${item.name}.png`), png);
          report.images.push({ name: item.name, sha256: hash(png), nontransparentPixels, issues,
            textureAssets: layers.map(({ packPath, sha256, width, height }) => ({ packPath, sha256, width, height })) });
          const x = index % 4 * 320, y = Math.floor(index / 4) * 320;
          sheetContext.drawImage(canvas, x + 10, y + 10);
          sheetContext.fillStyle = '#172033'; sheetContext.font = '16px sans-serif';
          sheetContext.fillText(item.name, x + 10, y + 300);
          await checkpoint();
        }
        await writeFile(path.join(output, 'native-contact-sheet.png'), sheet.toBuffer('image/png'));
      } finally {
        for (const [name, descriptor] of previous) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
        }
      }
    }
    report.validation_status = report.models.every(row => row.status === 'ready') && report.ui.every(row => row.engineResultOk)
      && report.pocket.loaded && report.pocket.blocked && report.images.length === scenes.length
      && report.images.every(row => row.nontransparentPixels > 0 && row.issues.length === 0) ? 'PASS' : 'INCONCLUSIVE';
    report.finishedAt = new Date().toISOString();
    await checkpoint(); return report;
  } finally { await reader.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [reference, output] = process.argv.slice(2);
    if (!reference || !output) throw new Error('使い方: node local-node/native-resource-audit23.mjs reference.zip 出力ディレクトリ');
    const result = await auditNativeResourcePack23(reference, output);
    process.stdout.write(JSON.stringify({ validation_status: result.validation_status, models: result.models.length,
      ui: result.ui.length, images: result.images.length }) + '\n');
    if (result.validation_status !== 'PASS') process.exitCode = 1;
  } catch (error) { process.stderr.write(`${error?.message || '監査処理に失敗しました。'}\n`); process.exitCode = 1; }
}
