import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { drawCanvasPreview } from '../../editor-core/src/preview/canvas-preview.js';

const backend = loadRasterBackend();
function paint(t, { mode, zoom = 1, dpr = 1, crop = true, tiled = 'both', rectangle = {}, noPattern = false, cropMetadata = {} } = {}) {
  const previous = new Map(['window', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: dpr } });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: function(w, h) { return backend.createCanvas(w, h); } });
  t.after(() => { for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  const source = backend.createCanvas(16, 8), context = source.getContext('2d');
  context.fillStyle = 'green'; context.fillRect(0, 0, 16, 8);
  // Physical crop [4..8) is the logical 2-pixel sprite in an 8x4 atlas.
  context.fillStyle = 'red'; context.fillRect(4, 0, 2, 8);
  context.fillStyle = 'blue'; context.fillRect(6, 0, 2, 8);
  const canvas = backend.createCanvas(8 * zoom, 4 * zoom);
  canvas.getBoundingClientRect = () => ({ width: 8 * zoom, height: 4 * zoom });
  if (noPattern) canvas.getContext('2d').createPattern = undefined;
  drawCanvasPreview(canvas, { preset: { width: 8, height: 4 }, boxes: [{ id: 'tile', type: 'image', x: 0, y: 0, w: 8, h: 4, ...rectangle }] },
    { zoom, viewX: 0, viewY: 0 }, { showGuides: false, showScreenBoundary: false, showResizeHandles: false,
      forceTiledMode: mode, imageDrawById: { tile: { state: 'ready', image: source, width: 16, height: 8,
        alpha: 1, tiled, tiledScale: [1, 1], baseSize: [8, 4],
        ...(crop ? { uv: [2, 0], uvSize: [2, 4], uvSizeState: 'valid', ...cropMetadata } : {}) } } });
  return canvas;
}

for (const mode of [undefined, 'pattern']) for (const tiled of ['both', 'x']) {
  test(`2倍解像度アトラスの切抜きは切抜き論理寸法で繰り返す (${mode || 'patch'} / ${tiled})`, { skip: !backend }, t => {
    for (const zoom of [1, 2, 4]) {
      const canvas = paint(t, { mode, tiled, zoom });
      const row = canvas.getContext('2d').getImageData(0, zoom, 8 * zoom, 1).data;
      for (let x = 0; x < 8 * zoom; x++) {
        const expected = Math.floor(x / zoom) % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255];
        assert.deepEqual(Array.from(row.subarray(x * 4, x * 4 + 4)), expected, `x=${x} scale=${zoom}`);
      }
    }
  });
}

test('切抜きなしのbase_sizeによる密度と通常/代替経路の画素を保持する', { skip: !backend }, t => {
  for (const crop of [false, true]) {
    const a = paint(t, { crop }), b = paint(t, { crop, mode: 'pattern' });
    const aa = a.getContext('2d').getImageData(0, 0, 8, 4).data;
    const bb = b.getContext('2d').getImageData(0, 0, 8, 4).data;
    assert.deepEqual(aa, bb);
    if (!crop) {
      assert.deepEqual(Array.from(aa.subarray(2 * 4, 3 * 4)), [255, 0, 0, 255]);
      assert.deepEqual(Array.from(aa.subarray(3 * 4, 4 * 4)), [0, 0, 255, 255]);
    }
  }
});

test('画面外を含む大量タイルでも表示部分を正しい位相で描き、HiDPIで保持する', { skip: !backend }, t => {
  for (const dpr of [1, 2]) for (const noPattern of [false, true]) {
    // More than 1,024 patches forces the bounded fallback automatically.
    const canvas = paint(t, { dpr, noPattern, rectangle: { x: -3, y: -1, w: 512, h: 512 } });
    const row = canvas.getContext('2d').getImageData(0, dpr, 8 * dpr, 1).data;
    for (let x = 0; x < 8 * dpr; x++) {
      const expected = (Math.floor(x / dpr) + 3) % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255];
      assert.deepEqual(Array.from(row.subarray(x * 4, x * 4 + 4)), expected);
    }
  }
});

test('小数UVを整数表示周期へ写す場合も通常patchと同じ一回の標本化で描く', { skip: !backend }, t => {
  const options = { zoom: 2, cropMetadata: { uv: [2.25, 0], uvSize: [1.5, 4] } };
  const a = paint(t, options), b = paint(t, { ...options, mode: 'pattern' });
  assert.deepEqual(a.getContext('2d').getImageData(0, 0, 16, 8).data,
    b.getContext('2d').getImageData(0, 0, 16, 8).data);
});
