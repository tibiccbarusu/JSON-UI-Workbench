import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const backend = loadRasterBackend(), entry = fileURLToPath(new URL('../cli.mjs', import.meta.url)), run = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function png(width, height, pixel) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return pngjs.PNG.sync.write({ width, height, data });
}
test('real CLI PNG includes resource pixels and Japanese localized glyphs at a specified frame', { skip: !backend, timeout: 90000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-cli-raster13-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const font = png(128, 128, (x, y) => [255, 255, 255, x % 8 < 5 && y % 8 < 7 ? 255 : 0]);
  const archive = makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}',
    'ui/test.json': JSON.stringify({ namespace: 'test', screen: { type: 'screen', size: [64, 48], anchor_from: 'top_left', anchor_to: 'top_left', controls: [
      { image: { type: 'image', texture: 'textures/ui/red', size: [16, 16], anchor_from: 'top_left', anchor_to: 'top_left' } },
      { label: { type: 'label', text: 'test.greeting', size: [32, 12], offset: [20, 0], anchor_from: 'top_left', anchor_to: 'top_left', color: [1, 1, 1] } },
    ] } }),
    'textures/ui/red.png': png(2, 2, () => [255, 0, 0, 255]), 'font/default8.png': font, 'font/glyph_65.png': font,
    'texts/ja_JP.lang': 'test.greeting=A日\n' });
  const source = path.join(directory, 'vanilla.zip'); await writeFile(source, archive);
  const workflow = { schema: 'jsonui-cli-workflow-v1', commands: [
    { command: 'import', options: { vanilla: 'vanilla.zip' } },
    { command: 'preview', options: { file: 'ui/test.json', definition: 'test.screen', width: '64', height: '48', 'ui-scale': '1', frame: '15', fps: '30', format: 'png', out: 'frame.png' } },
    { command: 'preview', options: { file: 'ui/test.json', definition: 'test.screen', width: '64', height: '48', 'ui-scale': '1', frame: '15', fps: '30', out: 'repeat.png' } },
  ] };
  const workflowPath = path.join(directory, 'workflow.json'); await writeFile(workflowPath, JSON.stringify(workflow));
  const { stdout } = await run(process.execPath, [entry, 'workflow', '--session', path.join(directory, 'session.json'), '--file', workflowPath], { timeout: 85000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(stdout.trim().split('\n').length, 1);
  const result = JSON.parse(stdout); assert.equal(result.ok, true, stdout);
  const preview = result.result.results[1].result, bytes = await readFile(path.join(directory, 'frame.png'));
  assert.equal(preview.complete, true); assert.equal(preview.rendering.time_seconds, 0.5);
  assert.equal(preview.rendering.textures_rendered, true); assert.equal(preview.rendering.localized_glyphs_rendered, true);
  assert.equal(preview.rendering.minecraft_pixel_parity_verified, false);
  assert.equal(preview.artifact.media_type, 'image/png'); assert.equal(preview.artifact.encoding, undefined);
  assert.equal(preview.artifact.format, 'binary');
  assert.equal(preview.artifact.checksum_sha256, sha(bytes)); assert.equal(preview.rendering.sha256, sha(bytes));
  assert(preview.provenance.some(item => item.sheet === 'glyph_65'));
  const image = pngjs.PNG.sync.read(bytes); assert.equal(image.width, 64); assert.equal(image.height, 48);
  const pixel = (x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  assert.deepEqual(pixel(2, 2), [255, 0, 0, 255]); assert.deepEqual(pixel(27, 1), [255, 255, 255, 255]);
  assert.deepEqual(await readFile(path.join(directory, 'repeat.png')), bytes); assert.deepEqual(await readFile(source), archive);
});
