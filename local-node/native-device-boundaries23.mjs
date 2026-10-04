/** 実機対照を補助する原素材alpha/UV/足元・clip境界の有限検査。実機一致判定はしない。 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DiskZipReader } from './disk-zip.mjs';
import { loadRasterBackend } from './frame-raster13.mjs';
import { loadHorsePreviewFromSources, loadPlayerPreviewFromSources } from '../editor-core/src/preview/native-model-loader.js';
import { drawCanvasPreview } from '../editor-core/src/preview/canvas-preview.js';
import { resolveNativeScenePlacement } from '../editor-core/src/preview/native-scene-placement.js';
import { sampleNativePreviewMotion } from '../editor-core/src/preview/native-motion.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const overlayBones = new Set(['hat', 'jacket', 'leftSleeve', 'rightSleeve', 'leftPants', 'rightPants']);

export async function auditNativeDeviceBoundaries23(reference, outputDirectory) {
  const backend = loadRasterBackend();
  if (!backend) throw new Error('NATIVE_AUDIT_CANVAS_UNAVAILABLE');
  const output = path.resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const reader = new DiskZipReader();
  const previous = ['window', 'OffscreenCanvas'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const report = { schema: 'jsonui-native-device-boundary23', startedAt: new Date().toISOString(),
    scope_ja: '固定fixtureの原PNGと現行Canvasの有限契約。実機skin・撮影条件・全画素の一致ではない。', tests: [] };
  const checkpoint = () => writeFile(path.join(output, 'boundaries.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    await reader.openFromFile({ diskPath: path.resolve(reference), name: path.basename(reference) });
    await reader.listEntries();
    const sources = [{ source: 'reference', runtime: { rootPrefix: '', zipReader: reader, packPaths: await reader.listAllFilePaths() } }];
    const player = await loadPlayerPreviewFromSources({ sources, targetEngineVersion: [1, 26, 45] });
    const horse = await loadHorsePreviewFromSources({ sources, targetEngineVersion: [1, 26, 45] });
    if (player.status !== 'ready' || horse.status !== 'ready') throw new Error('NATIVE_AUDIT_RESOURCE_NOT_READY');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: function(w, h) { return backend.createCanvas(w, h); } });
    const layersFor = async refs => {
      const layers = [];
      for (const ref of refs) {
        const bytes = await reader.bytes(`${ref}.png`, 32 * 1024 * 1024), image = await backend.loadImage(bytes);
        layers.push({ image, width: image.width, height: image.height, sourceSha256: sha(bytes) });
      }
      return layers;
    };
    const destination = { id: 'native', type: 'custom', x: 196, y: 220, w: 120, h: 120, renderAlpha: 1 };
    const draw = (scene, layers, clip = null) => {
      const canvas = backend.createCanvas(512, 512), issues = [];
      canvas.getBoundingClientRect = () => ({ width: 512, height: 512 });
      drawCanvasPreview(canvas, { preset: { width: 512, height: 512 }, boxes: [{ ...destination, clipRect: clip }] },
        { zoom: 1, viewX: 0, viewY: 0 }, { transparentBackground: true, showGuides: false, showScreenBoundary: false,
          showResizeHandles: false, imageDrawById: { native: { state: 'native-scene', ...layers[0], imageLayers: layers, nativeScene: scene, alpha: 1 } },
          onNativeSceneIssue: issue => issues.push(issue) });
      return { canvas, bytes: canvas.toBuffer('image/png'), pixels: canvas.getContext('2d').getImageData(0, 0, 512, 512).data, issues };
    };
    const playerLayers = await layersFor(player.textureRefs), horseLayers = await layersFor(horse.textureRefs);
    const completePlayer = draw(player.scene, playerLayers);
    const basePlayer = draw({ ...player.scene, faces: player.scene.faces.filter(face => !overlayBones.has(face.boneName)) }, playerLayers);
    report.tests.push({ name_ja: '原Steveの透明な衣服・帽子面が基礎bodyを塗りつぶさない',
      pass: completePlayer.issues.length === 0 && basePlayer.issues.length === 0 && completePlayer.bytes.equals(basePlayer.bytes),
      fullSha256: sha(completePlayer.bytes), baseOnlySha256: sha(basePlayer.bytes),
      sourceTextureSha256: playerLayers[0].sourceSha256, removedTransparentFaces: player.scene.faces.length - basePlayerFaceCount(player.scene) });
    await writeFile(path.join(output, 'player-original-alpha.png'), completePlayer.bytes);
    const layeredHorse = draw(horse.scene, horseLayers), baseHorse = draw(horse.scene, horseLayers.slice(0, 1));
    report.tests.push({ name_ja: '原馬の模様なし・鎧なし透明PNGが馬体を塗りつぶさない',
      pass: layeredHorse.issues.length === 0 && baseHorse.issues.length === 0 && layeredHorse.bytes.equals(baseHorse.bytes),
      layeredSha256: sha(layeredHorse.bytes), baseOnlySha256: sha(baseHorse.bytes),
      sourceTextureSha256: horseLayers.map(layer => layer.sourceSha256) });
    await writeFile(path.join(output, 'horse-original-alpha.png'), layeredHorse.bytes);
    await checkpoint();
    const clip = { x: 245, y: 100, w: 55, h: 310 };
    const clipped = draw(player.scene, playerLayers, clip);
    let outsidePixels = 0, insidePixels = 0;
    for (let y = 0; y < 512; y += 1) for (let x = 0; x < 512; x += 1) {
      if (!clipped.pixels[(y * 512 + x) * 4 + 3]) continue;
      if (x < clip.x || x >= clip.x + clip.w || y < clip.y || y >= clip.y + clip.h) outsidePixels += 1;
      else insidePixels += 1;
    }
    report.tests.push({ name_ja: '原Steveでも祖先clip外へ描画しない', pass: !outsidePixels && insidePixels > 0 && clipped.issues.length === 0,
      outsidePixels, insidePixels, clip });
    await writeFile(path.join(output, 'player-original-clip.png'), clipped.bytes);
    const observedDestination = { x: 195.9 * 4, y: 105.1 * 4, w: 16.2 * 4, h: 16.2 * 4 };
    const basePlacement = resolveNativeScenePlacement(horse.scene, observedDestination);
    const turnedScene = sampleNativePreviewMotion(horse.scene, { pointer: { active: true, x: 1, y: .5 } });
    const turnedPlacement = resolveNativeScenePlacement(turnedScene, observedDestination);
    const baseBottom = Math.max(...horse.scene.faces.flatMap(face => face.points.map(point => point.y)));
    const footY = basePlacement.y + basePlacement.extent * baseBottom;
    const retainedAnchorY = turnedPlacement.y + turnedPlacement.extent * turnedScene.motionAnchorY;
    report.tests.push({ name_ja: '旧実機control座標の足元452.8と回転中anchor・scaleを保持',
      pass: Math.abs(footY - 452.8) < 1e-8 && Math.abs(retainedAnchorY - footY) < 1e-8 && basePlacement.extent === turnedPlacement.extent,
      footY, retainedAnchorY, extent: basePlacement.extent, historicalDeviceFootY: 453, cameraUnverified: true });
    report.playerUv = player.scene.faces.filter(face => ['head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'].includes(face.boneName)
      && face.faceName === 'north').map(face => ({ bone: face.boneName, side: face.faceName,
        texelRect: Object.fromEntries(Object.entries(face.uv).map(([key, value]) => [key, value * 64])) }));
    report.validation_status = report.tests.every(row => row.pass) ? 'PASS' : 'FAIL';
    report.finishedAt = new Date().toISOString();
    await checkpoint(); return report;
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    await reader.close();
  }
}

function basePlayerFaceCount(scene) { return scene.faces.filter(face => !overlayBones.has(face.boneName)).length; }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [reference, output] = process.argv.slice(2);
    if (!reference || !output) throw new Error('使い方: node local-node/native-device-boundaries23.mjs reference.zip 出力先');
    const result = await auditNativeDeviceBoundaries23(reference, output);
    process.stdout.write(JSON.stringify({ status: result.validation_status, tests: result.tests }) + '\n');
    if (result.validation_status !== 'PASS') process.exitCode = 1;
  } catch (error) { process.stderr.write(`${error?.message || '境界検査失敗'}\n`); process.exitCode = 1; }
}
