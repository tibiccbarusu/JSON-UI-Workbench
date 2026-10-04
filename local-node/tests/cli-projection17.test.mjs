import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { makeZip, manifest } from './fixtures.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const entry = fileURLToPath(new URL('../cli.mjs', import.meta.url)), run = promisify(execFile);
const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
const red = pngjs.PNG.sync.write({ width: 2, height: 2, data: Buffer.from(Array(4).fill([255, 0, 0, 255]).flat()) });
const options = { skip: !loadRasterBackend(), timeout: 90000 };
const defaultDocument = { namespace: 'context17', screen: { type: 'screen', size: [64, 48], ...origin, controls: [
  { image: { type: 'image', texture: 'textures/red', size: [8, 8], offset: '$left_horizontal_safezone_size', visible: '$desktop_screen', ...origin } },
] } };
async function workflow(t, { document = defaultDocument, settings, commands } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jsonui-cli-context17-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'pack.zip'), makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/test.json"]}',
    'ui/test.json': JSON.stringify(document), 'textures/red.png': red }));
  if (settings) await writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings));
  const instructions = { schema: 'jsonui-cli-workflow-v1', commands: [{ command: 'import', options: { vanilla: 'pack.zip' } },
    ...(settings ? [{ command: 'settings', options: { file: 'settings.json' } }] : []), ...commands] };
  await writeFile(path.join(dir, 'workflow.json'), JSON.stringify(instructions));
  let stdout; try { ({ stdout } = await run(process.execPath, [entry, 'workflow', '--session', path.join(dir, 'session.json'), '--file', path.join(dir, 'workflow.json')], { timeout: 85000, maxBuffer: 16 * 1024 * 1024 })); }
  catch (error) { if (!error.stdout) throw error; stdout = error.stdout; }
  return { result: JSON.parse(stdout), read: name => readFile(path.join(dir, name)), readJson: async name => JSON.parse(await readFile(path.join(dir, name), 'utf8')) };
}
const preview = out => ({ command: 'preview', options: { file: 'ui/test.json', definition: 'context17.screen', width: '64', height: '48', 'ui-scale': '1', out } });
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test('real CLI supplies the site Classic desktop/safezone defaults before resolving UI and paints visible source pixels', options, async t => {
  const output = await workflow(t, { commands: [preview('frame.png'), preview('frame.json')] });
  assert.equal(output.result.ok, true, JSON.stringify(output.result));
  const image = pngjs.PNG.sync.read(await output.read('frame.png'));
  assert.deepEqual(pixel(image, 1, 1), [255, 0, 0, 255]);
  const snapshot = await output.readJson('frame.json');
  assert.deepEqual(snapshot.document.screen.controls[0].image.offset, [0, 0]);
  assert.equal(snapshot.document.screen.controls[0].image.visible, true);
  assert.equal(snapshot.frame.layout.warnings.length, 0);
});

test('real CLI explicit variables win, named collection rows keep their data and settings remain unmodified', options, async t => {
  const document = structuredClone(defaultDocument);
  document.row = { type: 'image', texture: 'textures/red', size: [4, 4], ...origin };
  document.screen.controls.push({ stack: { type: 'stack_panel', size: [8, 24], offset: [32, 0], ...origin,
    collection_name: 'rows', factory: { name: 'rows_factory', control_name: 'row@context17.row' } } });
  document.screen.controls.push({ preserved: { type: 'stack_panel', size: [8, 24], offset: [44, 0], ...origin,
    collection_name: 'untouched', factory: { name: 'untouched_factory', control_name: 'row@context17.row' } } });
  const settings = { variables: { '$left_horizontal_safezone_size': [12, 8] },
    mock_data: { '$left_horizontal_safezone_size': [2, 3], __collections: { untouched: [{ '#id': 'kept' }], rows: [{ '#id': 'lower-priority' }] } },
    collections: { rows: [{ '#id': 'first' }, { '#id': 'second' }] } };
  const output = await workflow(t, { document, settings, commands: [preview('frame.png'), preview('frame.json')] });
  assert.equal(output.result.ok, true, JSON.stringify(output.result));
  const image = pngjs.PNG.sync.read(await output.read('frame.png'));
  assert.deepEqual(pixel(image, 13, 9), [255, 0, 0, 255]); assert.notDeepEqual(pixel(image, 1, 1), [255, 0, 0, 255]);
  const snapshot = await output.readJson('frame.json');
  assert.deepEqual(snapshot.document.screen.controls[0].image.offset, [12, 8]);
  assert.equal(snapshot.document.screen.controls[1].stack.controls?.length ?? 0, 2);
  assert.equal(snapshot.document.screen.controls[2].preserved.controls?.length ?? 0, 1);
  const saved = (await output.readJson('session.json')).settings;
  for (const key of Object.keys(settings)) assert.deepEqual(saved[key], settings[key]);
});

test('Classic default context does not authorize Pocket preview or fill arbitrary missing resource variables', options, async t => {
  for (const [definition, expected] of [
    [{ type: 'screen', '$pocket_screen': true }, 'POCKET_PREVIEW_BLOCKED'],
    [{ type: 'screen', controls: [{ image: { type: 'image', texture: '$unknown_texture17', size: [8, 8] } }] }, 'RASTER_INCOMPLETE'],
  ]) {
    const output = await workflow(t, { document: { namespace: 'context17', screen: definition }, commands: [preview('frame.png')] });
    assert.equal(output.result.ok, false); assert.equal(output.result.error.code, expected, JSON.stringify(output.result));
    if (expected === 'RASTER_INCOMPLETE') assert(output.result.error.context.diagnostics.some(row => row.code === 'RASTER_TEXTURE_UNRESOLVED'));
    await assert.rejects(() => output.read('frame.png'), { code: 'ENOENT' });
  }
});
