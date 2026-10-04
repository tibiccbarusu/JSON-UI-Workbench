import test from 'node:test';
import assert from 'node:assert/strict';
import pngjs from '../vendor/pngjs/lib/png.js';
import { normalizePackIcon, normalizePackOptions, applyPackOptions } from '../pack-export-options.mjs';

test('metadata validation preserves engine floor and UUID while synchronizing header/module versions', () => {
  const source = { header: { uuid: 'header', min_engine_version: [1, 26, 40], version: [1, 0, 0] }, modules: [{ uuid: 'module', type: 'resources', version: [1, 0, 0] }] };
  const result = applyPackOptions(source, { name: '新しいパック', description: '説明\n二行目', authors: ['作者'], version: [2, 3, 4] });
  assert.deepEqual(result.header.min_engine_version, source.header.min_engine_version); assert.equal(result.header.uuid, 'header');
  assert.deepEqual(result.header.version, [2, 3, 4]); assert.deepEqual(result.modules[0].version, [2, 3, 4]);
  assert.deepEqual(source.header.version, [1, 0, 0]); assert.deepEqual(result.metadata.authors, ['作者']);
  for (const input of [{ name: '' }, { version: [1, 2] }, { version: [1, -1, 0] }, { version: [65536, 0, 0] }, { min_engine_version: [1, 0, 0] }, { authors: [''] }]) assert.throws(() => normalizePackOptions(input));
});

test('pack icon contains non-square PNG without distortion, validates CRC and bounds dimensions before decode', () => {
  const bytes = pngjs.PNG.sync.write({ width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]) });
  const output = normalizePackIcon(bytes.toString('base64')), image = pngjs.PNG.sync.read(output.bytes);
  assert.deepEqual([image.width, image.height], [256, 256]);
  const pixel = (x, y) => [...image.data.subarray((y * 256 + x) * 4, (y * 256 + x + 1) * 4)];
  assert.deepEqual(pixel(0, 0), [0, 0, 0, 0]); assert.deepEqual(pixel(20, 100), [255, 0, 0, 255]); assert.deepEqual(pixel(240, 100), [0, 0, 255, 255]);
  assert.equal(normalizePackIcon(undefined), null);
  assert.throws(() => normalizePackIcon('data:image/png;base64,' + bytes.toString('base64')));
  const oversized = Buffer.from(bytes); oversized.writeUInt32BE(100000, 16);
  assert.throws(() => normalizePackIcon(oversized.toString('base64')), error => error.code === 'EXPORT_ICON_DIMENSIONS_INVALID');
  const corrupted = Buffer.from(bytes); corrupted[29] ^= 1;
  assert.throws(() => normalizePackIcon(corrupted.toString('base64')), error => error.code === 'EXPORT_ICON_PNG_INVALID');
});
