import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { activeClassicUiScale, logicalCanvasPreset, inferPackUiScaleFromBuildInfo } from '../../editor-core/src/preview/preview-viewport16.js';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const backend = loadRasterBackend(), entry = fileURLToPath(new URL('../cli.mjs', import.meta.url)), run = promisify(execFile);
const options = { skip: !backend, timeout: 90000 };
const calibration = { ratio_classes: [8, 3, 5].map(scale => ({ logical: [10, 20], observed: { pixels: [10 * scale, 20 * scale] } })) };
const red = pngjs.PNG.sync.write({ width: 2, height: 2, data: Buffer.from([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]) });
const selection = { file: 'ui/viewport16.json', definition: 'viewport16.screen' };
const pixel = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

async function workflow(t, { calibrated = false, commands, nativeHorse = false, packKind, manifestText = manifest, expectFailure = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-cli-viewport16-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const document = { namespace: 'viewport16', fade: { anim_type: 'alpha', from: 0, to: 1, duration: 1, easing: 'linear' },
    screen: { type: 'screen', size: ['100%', '100%'], controls: [
      { image: { type: 'image', texture: 'textures/ui/red', size: [16, 16],
        anchor_from: 'top_left', anchor_to: 'top_left', anims: ['@viewport16.fade'] } },
    ] } };
  if (nativeHorse) document.screen.controls = [{ horse: { type: 'custom', renderer: 'live_horse_renderer',
    size: [16, 16], offset: [24, 32], anchor_from: 'top_left', anchor_to: 'top_left' } }];
  const horseFiles = nativeHorse ? {
    'entity/horse.json': JSON.stringify({ format_version: '1.10.0', 'minecraft:client_entity': { description: {
      identifier: 'minecraft:horse', min_engine_version: [1, 26, 40], geometry: { default: 'geometry.horse' },
      textures: { default: 'textures/horse' },
    } } }),
    'models/entity/horse.json': JSON.stringify({ format_version: '1.21.0', 'minecraft:geometry': [{ description: {
      identifier: 'geometry.horse', texture_width: 64, texture_height: 64,
    }, bones: [{ name: 'root', cubes: [{ origin: [0, 0, 0], size: [2, 4, 3], uv: [0, 0] }] }] }] }),
    'textures/horse.png': pngjs.PNG.sync.write({ width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4, 255) }),
  } : {};
  const source = path.join(directory, 'pack.zip');
  await writeFile(source, makeZip({ 'manifest.json': manifestText, 'ui/_ui_defs.json': '{"ui_defs":["ui/viewport16.json"]}',
    'ui/viewport16.json': JSON.stringify(document), 'textures/ui/red.png': red,
    ...horseFiles,
    ...(calibrated ? { 'build-info.json': JSON.stringify(calibration) } : {}) }));
  const plan = { schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'import', options: packKind === 'imported' || calibrated ? { pack: 'pack.zip' } : { vanilla: 'pack.zip' } }, ...commands,
  ] };
  const filename = path.join(directory, 'workflow.json');
  await writeFile(filename, JSON.stringify(plan));
  let stdout;
  try {
    ({ stdout } = await run(process.execPath, [entry, 'workflow', '--session', path.join(directory, 'session.json'), '--file', filename],
      { timeout: 85000, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    if (!expectFailure || !error.stdout) throw error;
    stdout = error.stdout;
  }
  const result = JSON.parse(stdout);
  if (expectFailure) {
    assert.equal(result.ok, false, stdout);
    return { failure: result, readBytes: name => readFile(path.join(directory, name)) };
  }
  assert.equal(result.ok, true, stdout);
  return { results: result.result.results.slice(1).map(row => row.result),
    readPng: async name => pngjs.PNG.sync.read(await readFile(path.join(directory, name))) };
}

test('shared viewport retains physical size, logical fraction, manual scale and calibration median', () => {
  assert.equal(activeClassicUiScale(), 4);
  assert.deepEqual(logicalCanvasPreset({ width: 1920, height: 1080 }), { width: 480, height: 270, name: '1920x1080-classic-4x-logical' });
  assert.deepEqual(logicalCanvasPreset({ width: 321, height: 201 }, 4), { width: 80.25, height: 50.25, name: '321x201-classic-4x-logical' });
  assert.equal(inferPackUiScaleFromBuildInfo(calibration), 5);
  assert.equal(activeClassicUiScale({ mode: 'manual', manualUiScale: 1, observedUiScale: 5 }), 1);
  assert.equal(inferPackUiScaleFromBuildInfo(null), 4);
});

test('real CLI default PNG captures one second at 1920x1080/4x and explicit frame zero remains zero', options, async t => {
  const output = await workflow(t, { commands: [
    { command: 'preview', options: { ...selection, out: 'default.png' } },
    { command: 'preview', options: { ...selection, frame: '0', out: 'zero.png' } },
    { command: 'preview', options: { ...selection, width: '64', height: '48', 'ui-scale': '1', out: 'small.png' } },
  ] });
  const [normal, zero, small] = output.results;
  assert.deepEqual([normal.rendering.width, normal.rendering.height, normal.rendering.logical_width, normal.rendering.logical_height, normal.rendering.ui_scale], [1920, 1080, 480, 270, 4]);
  assert.equal(normal.rendering.ui_scale_source, 'classic-default');
  assert.equal(normal.frame_index, 60); assert.equal(normal.rendering.time_seconds, 1);
  assert.equal(zero.frame_index, 0); assert.equal(zero.rendering.time_seconds, 0);
  assert.equal(small.rendering.ui_scale, 1); assert.equal(small.rendering.ui_scale_source, 'manual');
  assert.deepEqual([small.rendering.logical_width, small.rendering.logical_height], [64, 48]);
  const normalPng = await output.readPng('default.png'), zeroPng = await output.readPng('zero.png'), smallPng = await output.readPng('small.png');
  assert.deepEqual([normalPng.width, normalPng.height], [1920, 1080]);
  assert.deepEqual(pixel(normalPng, 63, 20), [255, 0, 0, 255]);
  assert.notDeepEqual(pixel(normalPng, 64, 20), [255, 0, 0, 255]);
  assert.notDeepEqual(pixel(zeroPng, 20, 20), [255, 0, 0, 255], '明示 frame 0 の alpha 0 を勝手に 1 秒へ進めない');
  assert.deepEqual(pixel(smallPng, 15, 8), [255, 0, 0, 255]);
  assert.notDeepEqual(pixel(smallPng, 16, 8), [255, 0, 0, 255]);
});

test('real CLI auto scale uses imported build-info median and manual override wins in the same workflow', options, async t => {
  const output = await workflow(t, { calibrated: true, commands: [
    { command: 'preview', options: { ...selection, width: '400', height: '300', out: 'calibrated.png' } },
    { command: 'preview', options: { ...selection, width: '400', height: '300', 'ui-scale': '4', out: 'manual.png' } },
    { command: 'preview', options: { ...selection, width: '400', height: '300', out: 'structure.json' } },
  ] });
  const [calibrated, manual, structure] = output.results;
  assert.deepEqual([calibrated.rendering.logical_width, calibrated.rendering.logical_height, calibrated.rendering.ui_scale], [80, 60, 5]);
  assert.equal(calibrated.rendering.ui_scale_source, 'build-info.json');
  assert.equal(manual.rendering.ui_scale, 4); assert.equal(manual.rendering.ui_scale_source, 'manual');
  assert.equal(structure.frame_index, 0, '構造 JSON は従来の既定フレーム 0 を保つ');
  const calibratedPng = await output.readPng('calibrated.png'), manualPng = await output.readPng('manual.png');
  assert.deepEqual(pixel(calibratedPng, 79, 20), [255, 0, 0, 255]);
  assert.notDeepEqual(pixel(calibratedPng, 80, 20), [255, 0, 0, 255]);
  assert.deepEqual(pixel(manualPng, 63, 20), [255, 0, 0, 255]);
  assert.notDeepEqual(pixel(manualPng, 64, 20), [255, 0, 0, 255]);
});

test('real CLI passes the default or imported manifest engine target through to a resource-backed horse PNG', options, async t => {
  const nativeManifest = JSON.parse(manifest); nativeManifest.header.min_engine_version = [1, 26, 40];
  for (const packKind of ['vanilla', 'imported']) {
    const output = await workflow(t, { nativeHorse: true, packKind, manifestText: JSON.stringify(nativeManifest), commands: [
      { command: 'preview', options: { ...selection, width: '256', height: '192', out: 'horse.png' } },
    ] });
    const result = output.results[0];
    assert.equal(result.complete, true, JSON.stringify(result));
    assert.equal(result.rendering.native_3d_rendered, true);
    assert.equal(result.rendering.counts.nativeModels, 1);
    assert(result.provenance.some(row => row.kind === 'native-model' && row.renderer === 'live_horse_renderer'));
    assert(result.provenance.some(row => row.kind === 'texture' && row.packPath === 'textures/horse.png'));
    const image = await output.readPng('horse.png'), background = pixel(image, 0, 0);
    let nonBackground = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      if (background.some((channel, index) => channel !== image.data[at + index])) nonBackground++;
    }
    assert(nonBackground > 100, `${packKind}: 原モデルの可視画素を確認する`);
  }
});

test('real CLI rejects a missing imported manifest engine target instead of inventing a newer horse model target', options, async t => {
  const invalidManifest = JSON.parse(manifest); delete invalidManifest.header.min_engine_version;
  const output = await workflow(t, { nativeHorse: true, packKind: 'imported', manifestText: JSON.stringify(invalidManifest), expectFailure: true, commands: [
    { command: 'preview', options: { ...selection, width: '256', height: '192', out: 'horse.png' } },
  ] });
  assert.match(JSON.stringify(output.failure), /NATIVE_PREVIEW_ENGINE_VERSION_INVALID/);
  await assert.rejects(output.readBytes('horse.png'), { code: 'ENOENT' });
});
