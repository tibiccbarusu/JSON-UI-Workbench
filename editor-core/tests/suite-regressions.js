import { test, assert, assertDeepEqual, assertEqual } from './test-harness.js';
import { buildAssetIndexFromPackPaths, buildAssetIndexFromPackPathsAsync, resolveFontTypeRef, resolveTextureRef, summarizeAssetIndex } from '../src/assets/asset-indexer.js';
import { createTextureImageCache, decodeImageFromBlob, decodeTgaPixels } from '../src/assets/texture-image-cache.js';
import { computeLayoutBoxesForFile, computeNineSlicePatches, findNearestLayoutNodeByType, DEFAULT_CANVAS_PRESET } from '../src/preview/canvas-preview.js';
import {
  buildUiScreenModelFromJson,
  NATIVE_RUNTIME_UI_ELEMENT_TYPES,
  SUPPORTED_UI_ELEMENT_TYPES,
  VALID_UI_ELEMENT_TYPES,
} from '../src/model/ui-screen-model.js';
import { validateUiScreenModel } from '../src/validation/validator.js';
import {
  generateElementSchemaDraft07,
  generateSchemaMetadata,
  generateScreenSchemaDraft07,
  generateUiDefsSchemaDraft07,
} from '../src/schema/schema-generator.js';
import { REPRESENTATIVE_CLASSIC_RUNTIME_VARIABLE_NAMES } from '../src/engine/representative-classic-runtime.js';
import { actions, appReducer, createInitialState } from '../src/state-store/app-store.js';

test('starting a replacement pack import clears the stale preview workspace', () => {
  let state = createInitialState();
  state = appReducer(state, actions.setProject({ id: 'old', name: 'Old', loadedAtIso: '2026-01-01T00:00:00Z' }));
  state = appReducer(state, actions.openFile({
    id: 'screen:ui/old.json',
    path: 'ui/old.json',
    kind: 'screen',
    rootId: 'root',
    nodesById: { root: { id: 'root', type: 'screen', props: {}, children: [] } },
  }));
  state = appReducer(state, actions.navReset('screen:ui/old.json'));

  const loading = appReducer(state, actions.packImportStart());
  assertEqual(loading.project, null);
  assertEqual(loading.files.currentFileId, null);
  assertEqual(loading.files.openFileIds.length, 0);
  assertEqual(loading.preview.navigation.stack.length, 0);
});

test('batch file patches update multiple validations in one reducer transition', () => {
  let state = createInitialState();
  state = appReducer(state, actions.openFile({ id: 'a', kind: 'screen', validation: null }));
  state = appReducer(state, actions.openFile({ id: 'b', kind: 'screen', validation: null }));
  const next = appReducer(state, actions.patchFiles([
    { fileId: 'a', patch: { validation: { errorCount: 0 } } },
    { fileId: 'b', patch: { validation: { errorCount: 1 } } },
  ]));
  assertEqual(next.files.byId.a.validation.errorCount, 0);
  assertEqual(next.files.byId.b.validation.errorCount, 1);
  assert(next !== state);
});

test('batch file patches compose repeated updates for one file in declaration order', () => {
  let state = createInitialState();
  state = appReducer(state, actions.openFile({ id: 'same', kind: 'screen', marker: 'original' }));
  const next = appReducer(state, actions.patchFiles([
    { fileId: 'same', patch: { validation: { errorCount: 0 } } },
    { fileId: 'same', patch: { marker: 'updated' } },
  ]));
  assertEqual(next.files.byId.same.validation.errorCount, 0);
  assertEqual(next.files.byId.same.marker, 'updated');
});

test('asset-indexer exposes async builder and matches sync summary', async () => {
  assert(typeof buildAssetIndexFromPackPathsAsync === 'function', 'Expected buildAssetIndexFromPackPathsAsync to be exported');

  const packPaths = [
    'textures/ui/button.png',
    'textures/ui/button.png',
    'textures/UI/BUTTON.png',
    'texts/en_US.lang',
    'font/default.json',
  ];

  const idxSync = buildAssetIndexFromPackPaths(packPaths);
  const idxAsync = await buildAssetIndexFromPackPathsAsync(packPaths);

  const sumSync = summarizeAssetIndex(idxSync);
  const sumAsync = summarizeAssetIndex(idxAsync);

  assertDeepEqual(sumAsync, sumSync);
});

test('texture stack prefers the preview pack and falls back to Vanilla', () => {
  const importedIndex = buildAssetIndexFromPackPaths([
    'textures/ui/player_preview_border.png',
  ]);
  const vanillaIndex = buildAssetIndexFromPackPaths([
    'textures/ui/player_preview_border.png',
    'textures/ui/confirm.png',
  ]);
  const overridden = resolveTextureRef('textures/ui/player_preview_border', { importedIndex, vanillaIndex });
  const fallback = resolveTextureRef('textures/ui/confirm', { importedIndex, vanillaIndex });
  const missing = resolveTextureRef('textures/ui/not_present', { importedIndex, vanillaIndex });
  assertEqual(overridden.resolved.source, 'imported');
  assertEqual(fallback.resolved.source, 'vanilla');
  assertEqual(missing.resolved, null);
});

test('texture resolution follows Bedrock extension priority and supports JPEG paths', () => {
  const allFormats = buildAssetIndexFromPackPaths([
    'textures/ui/sample.jpeg',
    'textures/ui/sample.jpg',
    'textures/ui/sample.png',
    'textures/ui/sample.tga',
  ]);
  const preferred = resolveTextureRef('textures/ui/sample', { importedIndex: allFormats });
  assertDeepEqual(preferred.candidates, [
    'textures/ui/sample.tga',
    'textures/ui/sample.png',
    'textures/ui/sample.jpg',
    'textures/ui/sample.jpeg',
  ]);
  assertEqual(preferred.resolved.packPath, 'textures/ui/sample.tga');

  for (const extension of ['jpg', 'jpeg']) {
    const index = buildAssetIndexFromPackPaths([`textures/ui/photo.${extension}`]);
    const result = resolveTextureRef(`textures/ui/photo.${extension}`, { importedIndex: index });
    assertEqual(result.resolved.packPath, `textures/ui/photo.${extension}`);
  }

  const imported = buildAssetIndexFromPackPaths(['textures/ui/stacked.jpg']);
  const vanilla = buildAssetIndexFromPackPaths(['textures/ui/stacked.tga']);
  assertEqual(resolveTextureRef('textures/ui/stacked', { importedIndex: imported, vanillaIndex: vanilla }).resolved.source, 'imported');
});

test('bounded TGA decoder handles orientation and rejects RLE overflow', () => {
  const raw = new Uint8Array(18 + 6);
  raw[2] = 2;
  raw[12] = 2;
  raw[14] = 1;
  raw[16] = 24;
  raw[17] = 0x20;
  raw.set([0, 0, 255, 0, 255, 0], 18);
  const decoded = decodeTgaPixels(raw, { maxPixels: 2, maxDecodedBytes: 8 });
  assertDeepEqual([decoded.width, decoded.height, decoded.decodedBytes], [2, 1, 8]);
  assertDeepEqual(Array.from(decoded.data), [255, 0, 0, 255, 0, 255, 0, 255]);

  const overflow = new Uint8Array(18 + 4);
  overflow[2] = 10;
  overflow[12] = 1;
  overflow[14] = 1;
  overflow[16] = 24;
  overflow[17] = 0x20;
  overflow.set([0x81, 0, 0, 255], 18);
  let code = '';
  try {
    decodeTgaPixels(overflow);
  } catch (error) {
    code = error instanceof Error ? error.message : String(error);
  }
  assertEqual(code, 'TGA_DECODE_PACKET_OVERFLOW');
});

test('TGA validates raw and RLE payloads before allocating their RGBA output', () => {
  const originalUint8ClampedArray = globalThis.Uint8ClampedArray;
  let largeAllocationAttempted = false;
  globalThis.Uint8ClampedArray = class TrackingUint8ClampedArray extends originalUint8ClampedArray {
    constructor(input) {
      if (typeof input === 'number' && input >= 4096 * 4096 * 4) largeAllocationAttempted = true;
      super(input);
    }
  };
  try {
    for (const imageType of [2, 10]) {
      const hostileHeader = new Uint8Array(18);
      hostileHeader[2] = imageType;
      hostileHeader[12] = 0x00;
      hostileHeader[13] = 0x10;
      hostileHeader[14] = 0x00;
      hostileHeader[15] = 0x10;
      hostileHeader[16] = 24;
      hostileHeader[17] = 0x20;
      let code = '';
      try {
        decodeTgaPixels(hostileHeader);
      } catch (error) {
        code = error instanceof Error ? error.message : String(error);
      }
      assertEqual(code, 'TGA_DECODE_TRUNCATED');
    }
    assertEqual(largeAllocationAttempted, false);
  } finally {
    globalThis.Uint8ClampedArray = originalUint8ClampedArray;
  }
});

test('TGA alpha follows declared attribute bits for true-colour and grayscale data', () => {
  const makePixel = ({ imageType, bitsPerPixel, descriptor, bytes }) => {
    const input = new Uint8Array(18 + bytes.length);
    input[2] = imageType;
    input[12] = 1;
    input[14] = 1;
    input[16] = bitsPerPixel;
    input[17] = 0x20 | descriptor;
    input.set(bytes, 18);
    return Array.from(decodeTgaPixels(input).data);
  };
  assertDeepEqual(makePixel({ imageType: 2, bitsPerPixel: 32, descriptor: 0, bytes: [30, 20, 10, 0] }), [10, 20, 30, 255]);
  assertDeepEqual(makePixel({ imageType: 2, bitsPerPixel: 32, descriptor: 8, bytes: [30, 20, 10, 7] }), [10, 20, 30, 7]);
  assertDeepEqual(makePixel({ imageType: 3, bitsPerPixel: 16, descriptor: 0, bytes: [42, 0] }), [42, 42, 42, 255]);
  assertDeepEqual(makePixel({ imageType: 3, bitsPerPixel: 16, descriptor: 8, bytes: [42, 9] }), [42, 42, 42, 9]);
});

test('TGA 2.0 Attributes Type controls straight and premultiplied alpha', () => {
  const makeTga2Pixel = (attributesType, bgra = [30, 20, 10, 7], extensionSize = 495) => {
    const extensionOffset = 22;
    const footerOffset = extensionOffset + 495;
    const input = new Uint8Array(footerOffset + 26);
    input[2] = 2;
    input[12] = 1;
    input[14] = 1;
    input[16] = 32;
    input[17] = 0x28;
    input.set(bgra, 18);
    const view = new DataView(input.buffer);
    view.setUint16(extensionOffset, extensionSize, true);
    input[extensionOffset + 494] = attributesType;
    view.setUint32(footerOffset, extensionOffset, true);
    input.set([
      0x54, 0x52, 0x55, 0x45, 0x56, 0x49, 0x53, 0x49, 0x4f,
      0x4e, 0x2d, 0x58, 0x46, 0x49, 0x4c, 0x45, 0x2e, 0x00,
    ], footerOffset + 8);
    return input;
  };
  for (const attributesType of [0, 1]) {
    assertDeepEqual(Array.from(decodeTgaPixels(makeTga2Pixel(attributesType, [30, 20, 10, 0])).data), [10, 20, 30, 255]);
  }
  for (const attributesType of [2, 3]) {
    assertDeepEqual(Array.from(decodeTgaPixels(makeTga2Pixel(attributesType)).data), [10, 20, 30, 7]);
  }
  assertDeepEqual(Array.from(decodeTgaPixels(makeTga2Pixel(4, [15, 30, 60, 85])).data), [180, 90, 45, 85]);
  for (const [attributesType, extensionSize, expected] of [[5, 495, 'TGA_DECODE_ATTRIBUTE_TYPE_UNSUPPORTED'], [3, 494, 'TGA_DECODE_INVALID_EXTENSION']]) {
    let code = '';
    try { decodeTgaPixels(makeTga2Pixel(attributesType, undefined, extensionSize)); } catch (error) { code = error instanceof Error ? error.message : String(error); }
    assertEqual(code, expected);
  }
});

test('TGA decoding normalizes bottom/right origins and bounded RLE packets', () => {
  const bottomRight = new Uint8Array(18 + 12);
  bottomRight[2] = 2;
  bottomRight[12] = 2;
  bottomRight[14] = 2;
  bottomRight[16] = 24;
  bottomRight[17] = 0x10;
  bottomRight.set([
    0, 0, 255, 0, 255, 0,
    255, 0, 0, 255, 255, 255,
  ], 18);
  assertDeepEqual(Array.from(decodeTgaPixels(bottomRight).data), [
    255, 255, 255, 255, 0, 0, 255, 255,
    0, 255, 0, 255, 255, 0, 0, 255,
  ]);

  const rle = new Uint8Array(18 + 4);
  rle[2] = 10;
  rle[12] = 2;
  rle[14] = 1;
  rle[16] = 24;
  rle[17] = 0x20;
  rle.set([0x81, 4, 5, 6], 18);
  assertDeepEqual(Array.from(decodeTgaPixels(rle).data), [
    6, 5, 4, 255, 6, 5, 4, 255,
  ]);
});

test('JPEG dimensions are bounded before browser decode', async () => {
  const jpegWithThreeByTwoSof = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00,
  ]);
  let code = '';
  try {
    await decodeImageFromBlob(new Blob([jpegWithThreeByTwoSof], { type: 'image/jpeg' }), {
      maxPixels: 5,
      maxDecodedBytes: 64,
    });
  } catch (error) {
    code = error instanceof Error ? error.message : String(error);
  }
  assertEqual(code, 'IMAGE_DECODE_TOO_MANY_PIXELS');
});

test('JPEG preflight finds a valid SOF marker beyond the first MiB with bounded segment reads', async () => {
  const parts = [new Uint8Array([0xff, 0xd8])];
  const appPayload = new Uint8Array(65_533);
  for (let index = 0; index < 17; index += 1) {
    parts.push(new Uint8Array([0xff, 0xe1, 0xff, 0xff]), appPayload);
  }
  parts.push(new Uint8Array([
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00,
  ]));
  const blob = new Blob(parts, { type: 'image/jpeg' });
  assert(blob.size > 1024 * 1024, 'Fixture SOF must be after the former one-MiB scan boundary');

  const hadCreateImageBitmap = Object.prototype.hasOwnProperty.call(globalThis, 'createImageBitmap');
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  let browserDecodeCalls = 0;
  globalThis.createImageBitmap = async () => {
    browserDecodeCalls += 1;
    return { width: 3, height: 2, close() {} };
  };
  try {
    const decoded = await decodeImageFromBlob(blob, {
      maxPixels: 6,
      maxDecodedBytes: 24,
      maxEncodedBytes: blob.size,
    });
    assertDeepEqual([decoded.width, decoded.height, decoded.decodedBytes], [3, 2, 24]);
    assertEqual(browserDecodeCalls, 1);
  } finally {
    if (hadCreateImageBitmap) globalThis.createImageBitmap = originalCreateImageBitmap;
    else delete globalThis.createImageBitmap;
  }
});

test('JPEG preflight rejects an excessive marker-fill run before browser decode', async () => {
  const fill = new Uint8Array(5_000);
  fill.fill(0xff);
  const sof = new Uint8Array([
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  ]);
  let code = '';
  try {
    await decodeImageFromBlob(new Blob([new Uint8Array([0xff, 0xd8]), fill, sof], { type: 'image/jpeg' }));
  } catch (error) {
    code = error instanceof Error ? error.message : String(error);
  }
  assertEqual(code, 'IMAGE_DECODE_DIMENSIONS_UNAVAILABLE');
});

test('PNG preflight rejects mismatched encoded data before browser decode', async () => {
  const hadCreateImageBitmap = Object.prototype.hasOwnProperty.call(globalThis, 'createImageBitmap');
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  let browserDecodeCalls = 0;
  globalThis.createImageBitmap = async () => {
    browserDecodeCalls += 1;
    return { width: 1, height: 1, close() {} };
  };
  let code = '';
  try {
    const jpegBytesBehindPngName = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    ]);
    await decodeImageFromBlob(new Blob([jpegBytesBehindPngName], { type: 'image/png' }));
  } catch (error) {
    code = error instanceof Error ? error.message : String(error);
  } finally {
    if (hadCreateImageBitmap) globalThis.createImageBitmap = originalCreateImageBitmap;
    else delete globalThis.createImageBitmap;
  }
  assertEqual(code, 'IMAGE_DECODE_DIMENSIONS_UNAVAILABLE');
  assertEqual(browserDecodeCalls, 0);
});

function makeTwoByTwoTgaBlob() {
  const input = new Uint8Array(18 + 12);
  input[2] = 2;
  input[12] = 2;
  input[14] = 2;
  input[16] = 24;
  input[17] = 0x20;
  input.set([
    0, 0, 255, 0, 255, 0,
    255, 0, 0, 255, 255, 255,
  ], 18);
  return new Blob([input], { type: 'image/x-tga' });
}

function makeTwoByTwoJpegBlob() {
  return new Blob([new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
  ])], { type: 'image/jpeg' });
}

function installFakeRasterDecodeRuntime() {
  const hadOffscreenCanvas = Object.prototype.hasOwnProperty.call(globalThis, 'OffscreenCanvas');
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const hadCreateImageBitmap = Object.prototype.hasOwnProperty.call(globalThis, 'createImageBitmap');
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.OffscreenCanvas = class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return {
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData() {},
      };
    }
  };
  globalThis.createImageBitmap = async (source) => ({
    width: Number(source && source.width) || 2,
    height: Number(source && source.height) || 2,
    close() {},
  });
  return () => {
    if (hadOffscreenCanvas) globalThis.OffscreenCanvas = originalOffscreenCanvas;
    else delete globalThis.OffscreenCanvas;
    if (hadCreateImageBitmap) globalThis.createImageBitmap = originalCreateImageBitmap;
    else delete globalThis.createImageBitmap;
  };
}

async function waitForTextureCacheState(cache, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = cache.stats();
    if (predicate(current)) return current;
    await Promise.resolve();
  }
  throw new Error(`Texture cache state did not settle: ${JSON.stringify(cache.stats())}`);
}

test('texture cache bounds concurrent TGA and JPEG decodes by decoded-byte reservations', async () => {
  const restoreRuntime = installFakeRasterDecodeRuntime();
  const cache = createTextureImageCache({
    maxEntries: 4,
    maxDecodedBytesTotal: 64,
    perImageMaxPixels: 4,
    perImageMaxDecodedBytes: 16,
    maxConcurrentDecodes: 2,
    maxInflightDecodedBytes: 16,
  });
  let releaseTga;
  const holdTga = new Promise((resolve) => { releaseTga = resolve; });
  const started = [];
  try {
    const tgaLoad = cache.load('tga', async ({ maxDecodedBytes }) => {
      started.push('tga');
      const decoded = await decodeImageFromBlob(makeTwoByTwoTgaBlob(), { maxPixels: 4, maxDecodedBytes });
      await holdTga;
      return decoded;
    });
    const jpegLoad = cache.load('jpeg', async ({ maxDecodedBytes }) => {
      started.push('jpeg');
      return decodeImageFromBlob(makeTwoByTwoJpegBlob(), { maxPixels: 4, maxDecodedBytes });
    });

    const blocked = await waitForTextureCacheState(
      cache,
      (state) => state.activeDecodes === 1 && state.queuedDecodes === 1 && started.length === 1,
    );
    assertDeepEqual(started, ['tga']);
    assertEqual(blocked.inflightReservedDecodedBytes, 16);
    releaseTga();
    await Promise.all([tgaLoad, jpegLoad]);
    assertDeepEqual(started, ['tga', 'jpeg']);
    const settled = cache.stats();
    assertEqual(settled.activeDecodes, 0);
    assertEqual(settled.queuedDecodes, 0);
    assertEqual(settled.inflightReservedDecodedBytes, 0);
  } finally {
    if (releaseTga) releaseTga();
    cache.clear();
    restoreRuntime();
  }
});

test('texture cache bounds distinct in-flight requests while preserving same-key deduplication', async () => {
  const cache = createTextureImageCache({
    maxDecodedBytesTotal: 12,
    perImageMaxPixels: 1,
    perImageMaxDecodedBytes: 4,
    maxConcurrentDecodes: 1,
    maxInflightDecodedBytes: 4,
    maxInflightRequests: 2,
    negativeTtlMs: 0,
  });
  let releaseActive;
  const holdActive = new Promise((resolve) => { releaseActive = resolve; });
  let queuedLoaderCalls = 0;
  const active = cache.load('active', async () => {
    await holdActive;
    return { image: {}, width: 1, height: 1, decodedBytes: 4 };
  });
  const queued = cache.load('queued', async () => {
    queuedLoaderCalls += 1;
    return { image: {}, width: 1, height: 1, decodedBytes: 4 };
  });
  const deduplicated = cache.load('queued', async () => {
    throw new Error('DEDUPLICATED_LOADER_MUST_NOT_RUN');
  });
  assert(deduplicated !== queued, 'Each same-key caller should receive its own cancellation wrapper');
  await waitForTextureCacheState(cache, (state) => state.activeDecodes === 1 && state.queuedDecodes === 1);
  const bounded = cache.stats();
  assertEqual(bounded.inflight, 2);
  assertEqual(bounded.maxInflightRequests, 2);

  let limitCode = '';
  try {
    await cache.load('rejected', async () => ({ image: {}, width: 1, height: 1, decodedBytes: 4 }));
  } catch (error) {
    limitCode = error instanceof Error ? error.message : String(error);
  }
  assertEqual(limitCode, 'IMAGE_CACHE_INFLIGHT_LIMIT');
  assertEqual(cache.stats().inflight, 2);
  assertEqual(cache.stats().queuedDecodes, 1);

  releaseActive();
  await Promise.all([active, queued, deduplicated]);
  assertEqual(queuedLoaderCalls, 1);
  const retried = await cache.load('rejected', async () => ({ image: {}, width: 1, height: 1, decodedBytes: 4 }));
  assertEqual(retried.decodedBytes, 4);
  assertEqual(cache.stats().inflight, 0);
  cache.clear();
});

test('clearing queued and active texture loads releases reservations without deadlock', async () => {
  const cache = createTextureImageCache({
    maxDecodedBytesTotal: 8,
    perImageMaxPixels: 1,
    perImageMaxDecodedBytes: 4,
    maxConcurrentDecodes: 1,
    maxInflightDecodedBytes: 4,
    negativeTtlMs: 0,
  });
  let releaseActive;
  const holdActive = new Promise((resolve) => { releaseActive = resolve; });
  const active = cache.load('active', async () => {
    await holdActive;
    return { image: { close() {} }, width: 1, height: 1, decodedBytes: 4 };
  });
  const queued = cache.load('queued', async () => ({ image: {}, width: 1, height: 1, decodedBytes: 4 }));
  await waitForTextureCacheState(cache, (state) => state.activeDecodes === 1 && state.queuedDecodes === 1);
  cache.clear();
  releaseActive();

  let activeCode = '';
  let queuedCode = '';
  try { await active; } catch (error) { activeCode = error instanceof Error ? error.message : String(error); }
  try { await queued; } catch (error) { queuedCode = error instanceof Error ? error.message : String(error); }
  assertEqual(activeCode, 'IMAGE_CACHE_ABORTED');
  assertEqual(queuedCode, 'IMAGE_CACHE_ABORTED');
  await waitForTextureCacheState(cache, (state) => state.activeDecodes === 0 && state.queuedDecodes === 0);

  const afterClear = await cache.load('after-clear', async () => ({ image: {}, width: 1, height: 1, decodedBytes: 4 }));
  assertEqual(afterClear.decodedBytes, 4);
  assertEqual(cache.stats().inflightReservedDecodedBytes, 0);
  cache.clear();
});

test('texture cache enforces RGBA accounting and closes rejected loader results', async () => {
  const cache = createTextureImageCache({
    maxDecodedBytesTotal: 16,
    perImageMaxPixels: 4,
    perImageMaxDecodedBytes: 16,
    maxInflightDecodedBytes: 16,
    negativeTtlMs: 0,
  });
  let closeCalls = 0;
  let code = '';
  try {
    await cache.load('under-reserved', async () => ({
      image: { close() { closeCalls += 1; } }, width: 2, height: 2, decodedBytes: 1,
    }), { decodedByteReservation: 1 });
  } catch (error) {
    code = error instanceof Error ? error.message : String(error);
  }
  assertEqual(code, 'IMAGE_CACHE_RESERVATION_EXCEEDED');
  assertEqual(closeCalls, 1);

  code = '';
  try {
    await cache.load('negative', async () => ({
      image: { close() { closeCalls += 1; } }, width: 1, height: 1, decodedBytes: -1,
    }));
  } catch (error) {
    code = error instanceof Error ? error.message : String(error);
  }
  assertEqual(code, 'IMAGE_LOADER_INVALID_RESULT');
  assertEqual(closeCalls, 2);

  const accounted = await cache.load('accounted', async () => ({ image: {}, width: 2, height: 2, decodedBytes: 1 }));
  assertEqual(accounted.decodedBytes, 16);
  assertEqual(cache.stats().totalDecodedBytes, 16);
  cache.clear();
});

test('a native-sized negative cache entry does not poison a larger legal image reservation', async () => {
  const cache = createTextureImageCache({
    maxDecodedBytesTotal: 128,
    perImageMaxPixels: 16,
    perImageMaxDecodedBytes: 64,
    maxInflightDecodedBytes: 64,
    negativeTtlMs: 60_000,
  });
  let loaderCalls = 0;
  const loader = async () => {
    loaderCalls += 1;
    return { image: {}, width: 5, height: 2, decodedBytes: 40 };
  };
  let firstCode = '';
  try {
    await cache.load('shared', loader, { decodedByteReservation: 32 });
  } catch (error) {
    firstCode = error instanceof Error ? error.message : String(error);
  }
  assertEqual(firstCode, 'IMAGE_CACHE_RESERVATION_EXCEEDED');

  let repeatedCode = '';
  try {
    await cache.load('shared', loader, { decodedByteReservation: 32 });
  } catch (error) {
    repeatedCode = error instanceof Error ? error.message : String(error);
  }
  assertEqual(repeatedCode, 'IMAGE_CACHE_RECENT_FAILURE:IMAGE_CACHE_RESERVATION_EXCEEDED');
  assertEqual(loaderCalls, 1);

  const decoded = await cache.load('shared', loader, { decodedByteReservation: 64 });
  assertEqual(decoded.decodedBytes, 40);
  assertEqual(loaderCalls, 2);
  cache.clear();
});

test('clear detaches an abort-ignoring loader and closes its stale completion', async () => {
  const cache = createTextureImageCache({
    maxDecodedBytesTotal: 4,
    perImageMaxPixels: 1,
    perImageMaxDecodedBytes: 4,
    maxConcurrentDecodes: 1,
    maxInflightDecodedBytes: 4,
    negativeTtlMs: 0,
  });
  let resolveStale;
  let staleStarted = false;
  let staleCloseCalls = 0;
  const stale = cache.load('same', async () => {
    staleStarted = true;
    return new Promise((resolve) => { resolveStale = resolve; });
  });
  await waitForTextureCacheState(cache, (state) => state.activeDecodes === 1 && staleStarted);
  cache.clear();
  let staleCode = '';
  try { await stale; } catch (error) { staleCode = error instanceof Error ? error.message : String(error); }
  assertEqual(staleCode, 'IMAGE_CACHE_ABORTED');
  assertDeepEqual([cache.stats().activeDecodes, cache.stats().inflightReservedDecodedBytes], [0, 0]);

  const fresh = await cache.load('same', async () => ({ image: {}, width: 1, height: 1, decodedBytes: 4 }));
  assertEqual(fresh.decodedBytes, 4);
  resolveStale({ image: { close() { staleCloseCalls += 1; } }, width: 1, height: 1, decodedBytes: 4 });
  for (let pass = 0; pass < 4; pass += 1) await Promise.resolve();
  assertEqual(staleCloseCalls, 1);
  assertEqual(cache.get('same'), fresh);
  cache.clear();
});

test('same-key caller abort rejects only that subscriber while another remains', async () => {
  const cache = createTextureImageCache({ perImageMaxPixels: 1, perImageMaxDecodedBytes: 4 });
  const controller = new AbortController();
  let release;
  let loaderCalls = 0;
  const held = new Promise((resolve) => { release = resolve; });
  const first = cache.load('joined', async () => {
    loaderCalls += 1;
    await held;
    return { image: {}, width: 1, height: 1, decodedBytes: 4 };
  }, { signal: controller.signal });
  const joined = cache.load('joined', async () => {
    throw new Error('DEDUPLICATED_LOADER_MUST_NOT_RUN');
  });
  controller.abort();
  let firstName = '';
  try { await first; } catch (error) { firstName = error && error.name ? error.name : ''; }
  assertEqual(firstName, 'AbortError');
  release();
  assertEqual((await joined).decodedBytes, 4);
  assertEqual(loaderCalls, 1);
  cache.clear();
});

test('an aborted active texture loader releases its reservation and does not poison the key', async () => {
  const cache = createTextureImageCache({
    maxDecodedBytesTotal: 8,
    perImageMaxPixels: 1,
    perImageMaxDecodedBytes: 4,
    maxConcurrentDecodes: 1,
    maxInflightDecodedBytes: 4,
  });
  const controller = new AbortController();
  const aborted = cache.load('abort-me', ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('loader aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  }), { signal: controller.signal });
  await waitForTextureCacheState(cache, (state) => state.activeDecodes === 1);
  controller.abort();
  let errorName = '';
  try { await aborted; } catch (error) { errorName = error && error.name ? error.name : ''; }
  assertEqual(errorName, 'AbortError');
  await waitForTextureCacheState(cache, (state) => state.activeDecodes === 0);
  assertEqual(cache.stats().inflightReservedDecodedBytes, 0);
  assertEqual(cache.getFailure('abort-me'), null);

  const retried = await cache.load('abort-me', async () => ({ image: {}, width: 1, height: 1, decodedBytes: 4 }));
  assertEqual(retried.decodedBytes, 4);
  cache.clear();
});

test('failed JPEG decode releases its reservation so a queued TGA decode can run', async () => {
  const restoreRuntime = installFakeRasterDecodeRuntime();
  const cache = createTextureImageCache({
    maxDecodedBytesTotal: 32,
    perImageMaxPixels: 4,
    perImageMaxDecodedBytes: 16,
    maxConcurrentDecodes: 1,
    maxInflightDecodedBytes: 16,
    negativeTtlMs: 0,
  });
  try {
    const invalidJpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
    const failed = cache.load('invalid-jpeg', ({ maxDecodedBytes }) => (
      decodeImageFromBlob(invalidJpeg, { maxPixels: 4, maxDecodedBytes })
    ));
    const tga = cache.load('valid-tga', ({ maxDecodedBytes }) => (
      decodeImageFromBlob(makeTwoByTwoTgaBlob(), { maxPixels: 4, maxDecodedBytes })
    ));
    let failureCode = '';
    try { await failed; } catch (error) { failureCode = error instanceof Error ? error.message : String(error); }
    assertEqual(failureCode, 'IMAGE_DECODE_DIMENSIONS_UNAVAILABLE');
    const decoded = await tga;
    assertDeepEqual([decoded.width, decoded.height, decoded.decodedBytes], [2, 2, 16]);
    assertEqual(cache.stats().inflightReservedDecodedBytes, 0);
  } finally {
    cache.clear();
    restoreRuntime();
  }
});

test('canvas layout compute does not throw when propsByIdOverride is provided', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: {}, children: ['a'] },
      a: { id: 'a', type: 'label', props: { x: 10, y: 20, w: 100, h: 30, visible: true, name: 'a' }, children: [] },
    },
  };

  const propsByIdOverride = { a: { visible: false } };

  const layout = computeLayoutBoxesForFile(file, DEFAULT_CANVAS_PRESET, { maxBoxes: 100, propsByIdOverride });
  assert(layout && Array.isArray(layout.boxes), 'Expected layout.boxes');

  const ids = layout.boxes.map((b) => b.id);
  assert(ids.includes('root'), 'Expected root box');
  assert(!ids.includes('a'), 'Expected node a to be hidden via override');
});

test('default device viewport matches a 1920x1080 game capture', () => {
  assertDeepEqual(DEFAULT_CANVAS_PRESET, { width: 1920, height: 1080 });
});

test('nine-slice separates high-density source pixels from logical destination units', () => {
  const patches = computeNineSlicePatches(
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 100, y: 200, w: 72, h: 72 },
    2,
    4,
    [5, 5],
    { width: 10, height: 10 },
  );
  assert(Array.isArray(patches));
  assertEqual(patches.length, 9);
  assertDeepEqual(patches[0], { sx: 0, sy: 0, sw: 4, sh: 4, dx: 100, dy: 200, dw: 8, dh: 8 });
  assertDeepEqual(patches[4], { sx: 4, sy: 4, sw: 2, sh: 2, dx: 108, dy: 208, dw: 56, dh: 56 });
});

test('nine-slice extrudes a source seam when stock opposing margins meet', () => {
  const patches = computeNineSlicePatches(
    { x: 0, y: 0, w: 28, h: 28 },
    { x: 80, y: 19.5, w: 320, h: 207 },
    14,
    1,
    [28, 28],
    { width: 28, height: 28 },
  );
  assert(Array.isArray(patches));
  assertEqual(patches.length, 9);
  assert(patches.every((patch) => patch.sw > 0 && patch.sh > 0));
  assertDeepEqual(patches[4], {
    sx: 14,
    sy: 14,
    sw: 1,
    sh: 1,
    dx: 94,
    dy: 33.5,
    dw: 292,
    dh: 179,
  });
  const destinationArea = patches.reduce((sum, patch) => sum + patch.dw * patch.dh, 0);
  assertEqual(destinationArea, 320 * 207);
});

test('nine-slice seam extrusion safely fills a one-pixel stock texture', () => {
  const patches = computeNineSlicePatches(
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: 10, h: 8 },
    1,
    1,
    [1, 1],
    { width: 1, height: 1 },
  );
  assert(Array.isArray(patches));
  assertEqual(patches.length, 9);
  assert(patches.every((patch) => patch.sx >= 0 && patch.sy >= 0));
  assert(patches.every((patch) => patch.sx + patch.sw <= 1 && patch.sy + patch.sh <= 1));
  assertEqual(patches.reduce((sum, patch) => sum + patch.dw * patch.dh, 0), 80);
});

test('nine-slice seam extrusion remains axis-specific for asymmetric guides', () => {
  const patches = computeNineSlicePatches(
    { x: 0, y: 0, w: 10, h: 6 },
    { x: 0, y: 0, w: 30, h: 10 },
    [5, 1, 5, 1],
    1,
    [10, 6],
    { width: 10, height: 6 },
  );
  assert(Array.isArray(patches));
  assertEqual(patches.length, 9);
  assertDeepEqual(patches[4], { sx: 5, sy: 1, sw: 1, sh: 4, dx: 5, dy: 1, dw: 20, dh: 8 });
});

test('validator treats vanilla-style dynamic references as non-blocking (summary warnings only)', () => {
  const json = {
    namespace: 'hud',
    root: {
      type: 'panel',
      // Vanilla patterns:
      size: '$root_size',
      offset: '#root_offset',
      color: '$text_color',
      alpha: '@hud.anim_text_alpha',
      visible: '#is_visible',
      // Also present in vanilla templates:
      controls: '$child_controls',
      bindings: '$bindings_array',
    },
  };

  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/__test_dynamic_refs.json' });
  const res = validateUiScreenModel(model, { filePath: 'ui/__test_dynamic_refs.json', supportedTypes: ['panel'] });

  assertEqual(res.errorCount, 0, `Expected 0 errors, got ${res.errorCount}`);

  const warningCodes = new Set(res.warnings.map((w) => w.code));
  assert(warningCodes.has('PROP_DYNAMIC'), 'Expected PROP_DYNAMIC summary warning');
  assert(warningCodes.has('CONTROLS_DYNAMIC'), 'Expected CONTROLS_DYNAMIC summary warning');
  assert(warningCodes.has('BINDINGS_DYNAMIC'), 'Expected BINDINGS_DYNAMIC summary warning');
});

test('validator accepts an empty label text that will be populated by a binding', () => {
  const json = {
    namespace: 'hud',
    echo_label: {
      type: 'label',
      text: '',
      bindings: [
        {
          binding_name: '#input_text',
          binding_name_override: '#text',
          binding_type: 'global',
        },
      ],
    },
  };

  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/__test_empty_bound_text.json' });
  const res = validateUiScreenModel(model, { filePath: 'ui/__test_empty_bound_text.json', supportedTypes: ['label'] });

  assertEqual(res.errorCount, 0, `Expected 0 errors, got ${res.errorCount}`);
  assert(!res.errors.some((issue) => issue.code === 'PROP_INVALID'), 'Expected empty text to avoid PROP_INVALID');
});

test('validator reference scan uses caller-provided source JSON', () => {
  const json = {
    namespace: 'hud',
    icon: { type: 'image', texture: 'textures/ui/known_reference_probe' },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/__test_reference_source.json' });
  const res = validateUiScreenModel(model, {
    filePath: 'ui/__test_reference_source.json',
    supportedTypes: ['image'],
    sourceJson: json,
    referenceContext: { importedIndex: null, vanillaIndex: null, langTable: null, globalVarNames: null },
  });
  assert(
    res.warnings.some((issue) => issue.code === 'ASSET_INDEX_UNAVAILABLE'),
    'Expected source JSON references to reach reference validation',
  );
});

test('validator checks binding-evaluated image, font, and localized text references', () => {
  const json = {
    namespace: 'evaluated_refs',
    screen: {
      type: 'screen',
      controls: [
        { icon: { type: 'image', texture: '#runtime_texture' } },
        { label: { type: 'label', text: '#runtime_text', localize: true, font_type: '#runtime_font' } },
      ],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/evaluated-refs.json' });
  const screen = model.root.children[0];
  const icon = screen.children.find((node) => node.key.local_name === 'icon');
  const label = screen.children.find((node) => node.key.local_name === 'label');
  const result = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    referenceContext: {
      importedIndex: buildAssetIndexFromPackPaths([]),
      vanillaIndex: buildAssetIndexFromPackPaths([]),
      langTable: {},
      globalVarNames: new Set(),
      evaluatedPropsById: {
        [icon.id]: { texture: 'textures/ui/dynamic_missing', ignored: false },
        [label.id]: {
          text: 'preview.dynamic.missing', localize: true,
          font_type: 'DynamicMissingFont', ignored: false,
        },
      },
    },
  });
  const texture = result.warnings.find((issue) => (
    issue.code === 'MISSING_TEXTURE_REF' && issue.refValue === 'textures/ui/dynamic_missing'
  ));
  const font = result.warnings.find((issue) => (
    issue.code === 'MISSING_FONT_REF' && issue.refValue === 'DynamicMissingFont'
  ));
  const text = result.warnings.find((issue) => (
    issue.code === 'MISSING_LANG_KEY' && issue.refValue === 'preview.dynamic.missing'
  ));
  assertEqual(texture.nodeId, icon.id);
  assertEqual(font.nodeId, label.id);
  assertEqual(text.nodeId, label.id);
  assertEqual(texture.originKind, 'evaluated-reference');
});

test('validator reports settled native inventory texture dependencies without transient atlas noise', () => {
  const json = {
    namespace: 'beacon_probe',
    screen: {
      type: 'screen',
      controls: [{ netherite: {
        type: 'custom', renderer: 'inventory_item_renderer',
        property_bag: { '#item_id_aux': 624 * 0x1_0000 },
      } }],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/beacon-probe.json' });
  const emptyIndex = buildAssetIndexFromPackPaths([]);
  const settled = validateUiScreenModel(model, {
    filePath: 'ui/beacon-probe.json', supportedTypes: [...VALID_UI_ELEMENT_TYPES], sourceJson: json,
    referenceContext: {
      importedIndex: emptyIndex, vanillaIndex: emptyIndex, langTable: {}, globalVarNames: new Set(),
      itemTextureAtlases: { importedAtlas: null, vanillaAtlas: null, pending: false },
    },
  });
  const missing = settled.warnings.filter((issue) => issue.code === 'MISSING_TEXTURE_REF');
  assertEqual(missing.length, 1);
  assertEqual(missing[0].refValue, 'textures/items/netherite_ingot');
  assertEqual(missing[0].propKey, 'renderer');
  assertEqual(missing[0].originKind, 'native-renderer-reference');

  const pending = validateUiScreenModel(model, {
    filePath: 'ui/beacon-probe.json', supportedTypes: [...VALID_UI_ELEMENT_TYPES], sourceJson: json,
    referenceContext: {
      importedIndex: emptyIndex, vanillaIndex: emptyIndex, langTable: {}, globalVarNames: new Set(),
      itemTextureAtlases: { pending: true },
    },
  });
  assertEqual(pending.warnings.some((issue) => issue.code === 'MISSING_TEXTURE_REF'), false);
  assertEqual(pending.warnings.some((issue) => issue.code === 'REFERENCE_CONTEXT_PENDING'), true);

  const available = validateUiScreenModel(model, {
    filePath: 'ui/beacon-probe.json', supportedTypes: [...VALID_UI_ELEMENT_TYPES], sourceJson: json,
    referenceContext: {
      importedIndex: emptyIndex,
      vanillaIndex: buildAssetIndexFromPackPaths(['textures/items/netherite_ingot.png']),
      langTable: {}, globalVarNames: new Set(),
      itemTextureAtlases: { pending: false },
    },
  });
  assertEqual(available.warnings.some((issue) => issue.code === 'MISSING_TEXTURE_REF'), false);
});

test('validator checks binding-evaluated native item ids, atlas blockers, and decode failures per screen', () => {
  const json = {
    namespace: 'evaluated_native_probe',
    screen: { type: 'screen', controls: [{ item: { type: 'custom', renderer: 'inventory_item_renderer' } }] },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/evaluated-native-probe.json' });
  const itemNode = model.root.children[0].children[0];
  const emptyIndex = buildAssetIndexFromPackPaths([]);
  const evaluatedPropsById = {
    [itemNode.id]: {
      renderer: 'inventory_item_renderer',
      __jsonui_preview_collection_details: { '#item_id_aux': 624 * 0x1_0000 },
    },
  };
  const baseContext = {
    importedIndex: emptyIndex, vanillaIndex: emptyIndex, langTable: {}, globalVarNames: new Set(),
    evaluatedPropsById,
    itemTextureAtlases: { importedStatus: 'missing', vanillaStatus: 'missing', pending: false },
  };
  const missing = validateUiScreenModel(model, {
    sourceJson: json, supportedTypes: [...VALID_UI_ELEMENT_TYPES], referenceContext: baseContext,
  });
  const missingRows = missing.warnings.filter((issue) => issue.code === 'MISSING_TEXTURE_REF');
  assertEqual(missingRows.length, 1);
  assertEqual(missingRows[0].nodeId, itemNode.id);
  assertEqual(missingRows[0].refValue, 'textures/items/netherite_ingot');

  const blocked = validateUiScreenModel(model, {
    sourceJson: json, supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    referenceContext: {
      ...baseContext,
      itemTextureAtlases: {
        importedStatus: 'error', importedIssue: 'ITEM_TEXTURE_ATLAS_INVALID',
        vanillaStatus: 'ready', pending: false,
      },
    },
  });
  assertEqual(blocked.warnings.filter((issue) => issue.code === 'ITEM_TEXTURE_ATLAS_INVALID').length, 1);
  assertEqual(blocked.warnings.some((issue) => issue.code === 'MISSING_TEXTURE_REF'), false);

  const availableIndex = buildAssetIndexFromPackPaths(['textures/items/netherite_ingot.png']);
  const decodedFailure = validateUiScreenModel(model, {
    sourceJson: json, supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    referenceContext: {
      ...baseContext,
      vanillaIndex: availableIndex,
      nativeTextureFailures: { 'vanilla:textures/items/netherite_ingot.png': 'IMAGE_SIGNATURE_INVALID' },
    },
  });
  assertEqual(decodedFailure.warnings.filter((issue) => issue.code === 'NATIVE_PREVIEW_TEXTURE_DECODE_FAILED').length, 1);
  assertEqual(decodedFailure.warnings.some((issue) => issue.code === 'CUSTOM_RENDERER_STATIC_RESOURCE_PREVIEW'), false);

  const unrelatedJson = { namespace: 'unrelated', screen: { type: 'screen' } };
  const unrelated = validateUiScreenModel(
    buildUiScreenModelFromJson(unrelatedJson, { filePath: 'ui/unrelated.json' }),
    {
      sourceJson: unrelatedJson, supportedTypes: [...VALID_UI_ELEMENT_TYPES],
      referenceContext: {
        ...baseContext,
        vanillaIndex: availableIndex,
        nativeTextureFailures: { 'vanilla:textures/items/netherite_ingot.png': 'IMAGE_SIGNATURE_INVALID' },
      },
    },
  );
  assertEqual(unrelated.warnings.some((issue) => issue.code === 'NATIVE_PREVIEW_TEXTURE_DECODE_FAILED'), false);
});

test('validator reference scan can isolate one selected definition from sibling definitions', () => {
  const projected = {
    namespace: 'projection_scope',
    selected: { type: 'panel', size: [40, 20] },
  };
  const fullDocument = {
    ...projected,
    sibling: { type: 'image', texture: 'textures/ui/sibling_only_missing' },
  };
  const model = buildUiScreenModelFromJson(projected, { filePath: 'ui/projection-scope.json' });
  const referenceContext = {
    importedIndex: buildAssetIndexFromPackPaths([]),
    vanillaIndex: buildAssetIndexFromPackPaths([]),
    langTable: new Map(),
    globalVarNames: new Set(),
  };
  const fullResult = validateUiScreenModel(model, {
    filePath: 'ui/projection-scope.json',
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    sourceJson: fullDocument,
    referenceContext,
  });
  const projectedResult = validateUiScreenModel(model, {
    filePath: 'ui/projection-scope.json',
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    sourceJson: projected,
    referenceContext,
  });

  assert(fullResult.warnings.some((issue) => (
    issue.code === 'MISSING_TEXTURE_REF' && issue.refValue === 'textures/ui/sibling_only_missing'
  )));
  assertEqual(projectedResult.warnings.some((issue) => issue.code === 'MISSING_TEXTURE_REF'), false);
});

test('validator scans global variable tokens in array leaves and expression strings', () => {
  const json = {
    namespace: 'hud',
    root: {
      type: 'panel',
      size: ['$missing_array_var', '100%'],
      alpha: '($missing_expression_var + 1)',
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/__test_reference_tokens.json' });
  const res = validateUiScreenModel(model, {
    filePath: 'ui/__test_reference_tokens.json',
    supportedTypes: ['panel'],
    sourceJson: json,
    referenceContext: {
      importedIndex: null,
      vanillaIndex: null,
      langTable: null,
      globalVarNames: new Set(),
    },
  });
  const missing = new Set(res.warnings.filter((issue) => issue.code === 'MISSING_GLOBAL_VAR').map((issue) => issue.refValue));
  assert(missing.has('$missing_array_var'));
  assert(missing.has('$missing_expression_var'));
});

test('validator accepts Vanilla empty min/max size sentinels', () => {
  const json = {
    namespace: 'common',
    loading_bars: { type: 'panel', min_size: [], max_size: [] },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/__test_empty_size_sentinel.json' });
  const res = validateUiScreenModel(model, {
    filePath: 'ui/__test_empty_size_sentinel.json',
    supportedTypes: ['panel'],
    sourceJson: json,
  });
  assertEqual(res.errorCount, 0);
  assert(!res.errors.some((issue) => issue.code === 'PROP_INVALID'));
});

test('validator does not treat lexical or binding texture tokens as asset paths', () => {
  const json = {
    namespace: 'common',
    '$close_button_default_texture': 'textures/ui/close_button_default',
    icon: { type: 'image', texture: '$close_button_default_texture' },
    controller_icon: { type: 'image', texture: '#controller_face_down_icon' },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/__test_symbolic_textures.json' });
  const res = validateUiScreenModel(model, {
    filePath: 'ui/__test_symbolic_textures.json',
    supportedTypes: ['image'],
    sourceJson: json,
    referenceContext: {
      importedIndex: buildAssetIndexFromPackPaths([]),
      vanillaIndex: buildAssetIndexFromPackPaths([]),
      langTable: {},
      globalVarNames: new Set(),
    },
  });
  const missingTextureRefs = res.warnings
    .filter((issue) => issue.code === 'MISSING_TEXTURE_REF')
    .map((issue) => issue.refValue);
  assertDeepEqual(missingTextureRefs, ['textures/ui/close_button_default']);
  assert(!missingTextureRefs.includes('$close_button_default_texture'));
  assert(!missingTextureRefs.includes('#controller_face_down_icon'));
  assert(!res.warnings.some((issue) => issue.code === 'MISSING_GLOBAL_VAR'));
});

test('symbolic-only texture values do not require an asset index', () => {
  const json = {
    namespace: 'symbolic_textures',
    variable: { type: 'image', texture: '$runtime_texture' },
    binding: { type: 'image', texture: '#runtime_texture' },
    inherited: { type: 'image', texture: '@runtime.texture' },
    expression: { type: 'image', texture: '($runtime_texture)' },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/symbolic-textures.json' });
  const result = validateUiScreenModel(model, {
    filePath: 'ui/symbolic-textures.json',
    supportedTypes: ['image'],
    sourceJson: json,
    referenceContext: {
      importedIndex: null,
      vanillaIndex: null,
      globalVarNames: new Set(['$runtime_texture']),
    },
  });
  assert(!result.warnings.some((warning) => warning.code === 'ASSET_INDEX_UNAVAILABLE'));
  assert(!result.warnings.some((warning) => warning.code === 'MISSING_TEXTURE_REF'));
});

test('Anvil-like edit and label defaults use parent and intrinsic bounds', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: {
        id: 'root', type: 'panel', props: { size: [130, 40], anchor_from: 'center', anchor_to: 'center' },
        propsPresent: { size: true }, children: ['edit', 'display', 'title'],
      },
      edit: {
        id: 'edit', type: 'edit_box',
        props: { size: ['default', 'default'], anchor_from: 'center', anchor_to: 'center' },
        propsPresent: { size: false }, children: [],
      },
      display: {
        id: 'display', type: 'label',
        props: { text: '', size: ['default', 10], min_size: ['100%', 0], anchor_from: 'center', anchor_to: 'center' },
        propsPresent: { size: true }, children: [],
      },
      title: {
        id: 'title', type: 'label',
        props: { text: '修理・名前変更', size: ['default', 'default'], anchor_from: 'center', anchor_to: 'center' },
        propsPresent: { size: false }, children: [],
      },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 480, height: 270, name: 'anvil-intrinsic' });
  const root = layout.boxes.find((box) => box.id === 'root');
  const edit = layout.boxes.find((box) => box.id === 'edit');
  const display = layout.boxes.find((box) => box.id === 'display');
  const title = layout.boxes.find((box) => box.id === 'title');
  assert(root && edit && display && title);
  assertEqual(edit.w, 130);
  assertEqual(edit.h, 40);
  assertEqual(display.w, 130);
  assertEqual(display.h, 10);
  assert(title.w > 40 && title.w < 100, `Unexpected title intrinsic width: ${title.w}`);
  assertEqual(title.h, 8);
  assert(Math.abs((title.x + title.w / 2) - (root.x + root.w / 2)) < 0.001);
});

test('safe control state selection locks unresolved enabled controls', () => {
  const unresolved = '#__jsonui_unresolved_runtime_visibility__';
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [130, 20] }, children: ['edit'] },
      edit: {
        id: 'edit', type: 'edit_box',
        props: { size: [130, 20], default_control: 'default', locked_control: 'locked' },
        children: ['default', 'locked'],
      },
      default: { id: 'default', type: 'image', props: { name: 'default', size: ['100%', '100%'] }, children: [] },
      locked: { id: 'locked', type: 'image', props: { name: 'locked', size: ['100%', '100%'] }, children: [] },
    },
  };
  const safe = computeLayoutBoxesForFile(file, { width: 480, height: 270, name: 'locked-edit' }, {
    propsByIdOverride: { edit: { ...file.nodesById.edit.props, enabled: unresolved } },
  });
  const ids = new Set(safe.boxes.map((box) => box.id));
  assert(ids.has('locked'));
  assert(!ids.has('default'));
});

test('safe preview keeps native renderer geometry but omits factories and unknown leaves', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: {}, children: ['custom', 'unknown', 'factory'] },
      custom: { id: 'custom', type: 'custom', props: {}, children: [] },
      unknown: { id: 'unknown', type: 'unknown', props: {}, children: [] },
      factory: { id: 'factory', type: 'factory', props: {}, children: [] },
    },
  };
  const safeIds = new Set(computeLayoutBoxesForFile(file, DEFAULT_CANVAS_PRESET).boxes.map((box) => box.id));
  assert(safeIds.has('custom'));
  assert(!safeIds.has('unknown'));
  assert(!safeIds.has('factory'));
  const structureIds = new Set(computeLayoutBoxesForFile(file, DEFAULT_CANVAS_PRESET, { visibilityMode: 'structure' }).boxes.map((box) => box.id));
  assert(structureIds.has('custom'));
  assert(structureIds.has('unknown'));
  assert(structureIds.has('factory'));
});

test('distilled official Anvil hierarchy preserves exact Classic logical geometry', () => {
  const file = {
    rootId: 'screen',
    nodesById: {
      screen: { id: 'screen', type: 'screen', props: {}, children: ['root'] },
      root: { id: 'root', type: 'panel', props: { size: [176, 166], anchor_from: 'center', anchor_to: 'center' }, children: ['top'] },
      top: { id: 'top', type: 'panel', props: { size: ['100% - 14px', '50% - 14px'], offset: [7, 7], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['icon_text'] },
      icon_text: { id: 'icon_text', type: 'panel', props: { size: ['100%', '40%'], offset: [0, '5%'], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['title_text'] },
      title_text: { id: 'title_text', type: 'panel', props: { size: ['80%', '100%'], offset: ['20%', 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['title_panel', 'edit_panel'] },
      title_panel: { id: 'title_panel', type: 'panel', props: { size: ['100%', '20%'], offset: [1, 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['title'] },
      title: { id: 'title', type: 'label', props: { offset: [0, 3], anchor_from: 'bottom_middle', anchor_to: 'bottom_middle', text: 'container.repair', font_size: 'normal' }, propsPresent: { size: false }, children: [] },
      edit_panel: { id: 'edit_panel', type: 'panel', props: { size: ['100%', '70%'], offset: [0, 2], anchor_from: 'bottom_left', anchor_to: 'bottom_left' }, children: ['edit'] },
      edit: { id: 'edit', type: 'edit_box', props: { anchor_from: 'top_left', anchor_to: 'top_left', default_control: 'default', locked_control: 'locked', enabled: true }, propsPresent: { size: false }, children: ['centering'] },
      centering: { id: 'centering', type: 'panel', props: { size: ['100% - 6px', '100% - 4px'], anchor_from: 'center', anchor_to: 'center' }, children: ['clip'] },
      clip: { id: 'clip', type: 'panel', props: { size: ['100%', '100%'], anchor_from: 'left_middle', anchor_to: 'left_middle', offset: [0, 0], clips_children: true }, children: ['display'] },
      display: { id: 'display', type: 'label', props: { size: ['default', 10], min_size: ['100%', 0], anchor_from: 'right_middle', anchor_to: 'right_middle', text: '#item_name', item_name: '', font_size: 'normal', text_alignment: 'left', localize: false }, propsPresent: { size: true }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 480, height: 270, name: 'fhd4' }, { visibilityMode: 'safe' });
  const byId = Object.fromEntries(layout.boxes.map((box) => [box.id, box]));
  const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
  for (const [id, expected] of Object.entries({
    root: [152, 52, 176, 166],
    top: [159, 59, 162, 69],
    title: [222.84, 62.97, 68.72, 8],
    edit: [191.4, 72.73, 129.6, 19.32],
    clip: [194.4, 74.73, 123.6, 15.32],
    display: [194.4, 77.39, 123.6, 10],
  })) {
    assert(byId[id], `Missing ${id}`);
    ['x', 'y', 'w', 'h'].forEach((key, index) => near(byId[id][key], expected[index], `${id}.${key}`));
  }
  near(byId.title.x + byId.title.w / 2, 257.2, 'title.centerX');
  const expectedClip = { x: 194.4, y: 74.73, w: 123.6, h: 15.32 };
  for (const key of ['x', 'y', 'w', 'h']) near(byId.display.clipRect[key], expectedClip[key], `display.clipRect.${key}`);
});

test('painted state descendants resolve to their edit and button owners', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: {}, children: ['edit', 'button'] },
      edit: { id: 'edit', type: 'edit_box', props: { size: [100, 20] }, children: ['edit-label'] },
      'edit-label': { id: 'edit-label', type: 'label', props: { size: ['100%', '100%'], text: 'value' }, children: [] },
      button: { id: 'button', type: 'button', props: { size: [100, 20] }, children: ['button-image'] },
      'button-image': { id: 'button-image', type: 'image', props: { size: ['100%', '100%'] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 320, height: 180, name: 'owner-hit' });
  const editOwner = findNearestLayoutNodeByType({
    nodesById: file.nodesById, boxes: layout.boxes, startId: 'edit-label', wantedType: 'edit_box',
  });
  const buttonOwner = findNearestLayoutNodeByType({
    nodesById: file.nodesById, boxes: layout.boxes, startId: 'button-image', wantedType: 'button',
  });
  assertEqual(editOwner.id, 'edit');
  assertEqual(buttonOwner.id, 'button');
});

test('image rendering properties remain valid model data instead of unknown fallbacks', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'image_props',
    image: {
      type: 'image', texture: 'textures/ui/example', fill: true, tiled: 'x', tiled_scale: [2, 3],
      clip_ratio: 0.5, clip_direction: 'down', clip_pixelperfect: false, grayscale: true,
    },
  }, { filePath: 'ui/image-props.json' });
  const image = model.root.children[0];
  for (const key of ['fill', 'tiled', 'tiled_scale', 'clip_ratio', 'clip_direction', 'clip_pixelperfect', 'grayscale']) {
    assertEqual(image.propsValid[key], true, key);
    assertEqual(Object.prototype.hasOwnProperty.call(image.unknownProps, key), false, key);
  }
});

test('schema metadata exports arrays and includes supported state and scrollbar controls', () => {
  const metadata = generateSchemaMetadata();
  for (const type of ['toggle', 'scroll_track', 'scrollbar_box']) {
    assert(metadata.supported_element_types.includes(type), type);
    assert(Array.isArray(metadata.editable_properties_by_type[type]), type);
  }
  const roundTrip = JSON.parse(JSON.stringify(metadata));
  assert(Array.isArray(roundTrip.editable_properties_by_type.image));
  assert(roundTrip.editable_properties_by_type.image.length > 0);
});

test('generated schemas accept inherited bodies and both named-control container forms', () => {
  const element = generateElementSchemaDraft07();
  const panel = element.definitions.UiElement_panel;
  const controlChoices = panel.properties.controls.anyOf;
  const arrayControls = controlChoices.find((choice) => choice.type === 'array');
  assert(arrayControls);
  assert(arrayControls.items.anyOf.some(
    (choice) => choice.$ref === '#/definitions/NamedControlEntry',
  ));
  assert(arrayControls.items.anyOf.some(
    (choice) => choice.$ref === '#/definitions/UiElement',
  ));
  assert(arrayControls.items.anyOf.some((choice) => choice.type === 'string'));
  assert(controlChoices.some((choice) => choice.$ref === '#/definitions/ControlMap'));
  assertEqual(
    element.definitions.ControlMap.patternProperties['@'].$ref,
    '#/definitions/InheritedOverrideBody',
  );
  assertEqual(
    element.definitions.ControlMap.patternProperties['^\\$'].$ref,
    '#/definitions/InheritedOverrideBody',
  );
  assertEqual(element.definitions.ControlMap.additionalProperties.$ref, '#/definitions/UiElement');
  assertEqual(
    element.definitions.NamedControlEntry.patternProperties['@'].$ref,
    '#/definitions/InheritedOverrideBody',
  );
  assertEqual(
    element.definitions.NamedControlEntry.patternProperties['^\\$'].$ref,
    '#/definitions/InheritedOverrideBody',
  );
  assertEqual(element.definitions.NamedControlEntry.additionalProperties.$ref, '#/definitions/UiElement');
  assertEqual(element.definitions.NamedControlEntry.minProperties, 1);
  assertEqual(element.definitions.NamedControlEntry.maxProperties, 1);
  assertDeepEqual(element.definitions.UiElement_panel.required, ['type']);
  assertEqual(Object.prototype.hasOwnProperty.call(element.definitions.InheritedOverrideBody, 'required'), false);
  assert(element.definitions.UiElement.oneOf.some(
    (choice) => choice.$ref === '#/definitions/UiElement_unsupported',
  ));
  assertDeepEqual(
    element.definitions.UiElement_unsupported.properties.type.not.enum,
    element.definitions.UiElement.oneOf
      .filter((choice) => choice.$ref?.startsWith('#/definitions/UiElement_')
        && choice.$ref !== '#/definitions/UiElement_unsupported')
      .map((choice) => choice.$ref.slice('#/definitions/UiElement_'.length)),
  );

  const screen = generateScreenSchemaDraft07({
    elementSchemaRef: './elements.json#/definitions/UiElement',
    inheritedSchemaRef: './elements.json#/definitions/InheritedOverrideBody',
  });
  assertEqual(screen.patternProperties['@'].$ref, './elements.json#/definitions/InheritedOverrideBody');
  assertEqual(screen.additionalProperties.$ref, './elements.json#/definitions/UiElement');

  const uiDefs = generateUiDefsSchemaDraft07();
  assertDeepEqual(uiDefs.required, ['ui_defs']);
  assertEqual(generateSchemaMetadata().schema_bundle_version, 2);
});

test('native runtime element types validate without entering the editable element palette', () => {
  assertDeepEqual(NATIVE_RUNTIME_UI_ELEMENT_TYPES, ['custom', 'factory', 'tooltip_trigger']);
  assert(!SUPPORTED_UI_ELEMENT_TYPES.includes('custom'));
  assert(!SUPPORTED_UI_ELEMENT_TYPES.includes('factory'));
  assert(!SUPPORTED_UI_ELEMENT_TYPES.includes('tooltip_trigger'));
  assert(SUPPORTED_UI_ELEMENT_TYPES.includes('dropdown'));
  assert(VALID_UI_ELEMENT_TYPES.includes('custom'));
  assert(VALID_UI_ELEMENT_TYPES.includes('factory'));
  assert(VALID_UI_ELEMENT_TYPES.includes('tooltip_trigger'));
  assert(!generateSchemaMetadata().supported_element_types.includes('custom'));

  const json = {
    namespace: 'native_runtime',
    payment: {
      type: 'custom',
      renderer: 'inventory_item_renderer',
      property_bag: { '#item_id_aux': 4_095 * 0x1_0000 },
    },
    renderer: { type: 'custom', renderer: 'banner_pattern_renderer', size: [20, 40] },
    book: { type: 'custom', renderer: 'enchanting_book_renderer', size: [40, 40] },
    horse: { type: 'custom', renderer: 'live_horse_renderer', size: [20, 20] },
    instances: { type: 'factory', name: 'runtime_rows' },
    hover: { type: 'tooltip_trigger', size: [20, 20] },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/native-runtime.json' });
  const result = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
  });
  assert(!result.warnings.some((warning) => warning.code === 'TYPE_UNSUPPORTED'));
  assert(!result.warnings.some((warning) => warning.code === 'CUSTOM_RENDERER_RUNTIME_DEPENDENT'));
  const surrogateWarnings = result.warnings.filter((warning) => warning.code === 'CUSTOM_RENDERER_SURROGATE');
  assertEqual(surrogateWarnings.length, 1);
  assert(surrogateWarnings[0].message.includes('Count: 1.'));
  assert(surrogateWarnings[0].message.includes('"banner_pattern_renderer"=1'));
  assertEqual(surrogateWarnings[0].message.includes('enchanting_book_renderer'), false);
  assertEqual(surrogateWarnings[0].message.includes('live_horse_renderer'), false);
  const factoryWarnings = result.warnings.filter((warning) => warning.code === 'FACTORY_RUNTIME_DEPENDENT');
  assertEqual(factoryWarnings.length, 1);
  assert(factoryWarnings[0].message.includes('Count: 1.'));
  assert(factoryWarnings[0].message.includes('"runtime_rows"=1'));
});

test('resource-backed book and horse previews validate their resolved native textures explicitly', () => {
  const json = {
    namespace: 'native_models',
    screen: {
      type: 'screen',
      controls: [
        { book: { type: 'custom', renderer: 'enchanting_book_renderer', size: [40, 40] } },
        { horse: { type: 'custom', renderer: 'live_horse_renderer', size: [20, 20] } },
      ],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/native-models.json' });
  const emptyIndex = buildAssetIndexFromPackPaths([]);
  const baseReferenceContext = {
    importedIndex: emptyIndex,
    vanillaIndex: emptyIndex,
    langTable: {},
    globalVarNames: new Set(),
    nativeModelPreviews: {
      bookTextureRef: 'textures/entity/enchanting_table_book',
      horse: {
        status: 'ready',
        textureRef: 'textures/entity/horse/horse_white',
        issue: null,
      },
    },
  };
  const missing = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    referenceContext: baseReferenceContext,
  });
  assertEqual(missing.warnings.some((issue) => issue.code === 'CUSTOM_RENDERER_STATIC_RESOURCE_PREVIEW'), false);
  const missingSurrogateWarnings = missing.warnings.filter((issue) => issue.code === 'CUSTOM_RENDERER_SURROGATE');
  assertEqual(missingSurrogateWarnings.length, 0);
  assertDeepEqual(
    missing.warnings
      .filter((issue) => issue.code === 'MISSING_TEXTURE_REF')
      .map((issue) => issue.refValue)
      .sort(),
    ['textures/entity/enchanting_table_book', 'textures/entity/horse/horse_white'],
  );

  const available = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    referenceContext: {
      ...baseReferenceContext,
      vanillaIndex: buildAssetIndexFromPackPaths([
        'textures/entity/enchanting_table_book.png',
        'textures/entity/horse/horse_white.png',
      ]),
    },
  });
  assertEqual(available.warnings.some((issue) => issue.code === 'MISSING_TEXTURE_REF'), false);
  const staticWarnings = available.warnings.filter((issue) => issue.code === 'CUSTOM_RENDERER_STATIC_RESOURCE_PREVIEW');
  assertEqual(staticWarnings.length, 1);
  assert(staticWarnings[0].message.includes('Count: 2.'));
  assertEqual(available.warnings.some((issue) => issue.code === 'CUSTOM_RENDERER_SURROGATE'), false);

  const unresolvedHorse = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    referenceContext: {
      ...baseReferenceContext,
      nativeModelPreviews: {
        bookTextureRef: 'textures/entity/enchanting_table_book',
        horse: { status: 'missing', textureRef: '', issue: 'NATIVE_PREVIEW_MODEL_MISSING' },
      },
    },
  });
  assert(unresolvedHorse.warnings.some((issue) => issue.code === 'NATIVE_PREVIEW_MODEL_MISSING'));
  assertEqual(unresolvedHorse.warnings.some((issue) => issue.code === 'CUSTOM_RENDERER_SURROGATE'), false);
});

test('native renderer validation fails closed on an excessive effective property map', () => {
  const excessiveProperties = Object.fromEntries(
    Array.from({ length: 2050 }, (_, index) => [`unknown_${index}`, index]),
  );
  const json = {
    namespace: 'native_property_limit',
    renderer: {
      type: 'custom',
      renderer: 'live_horse_renderer',
      ...excessiveProperties,
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/native-property-limit.json' });
  const result = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
  });
  assertEqual(
    result.warnings.some((issue) => issue.code === 'NATIVE_PREVIEW_PROPERTY_LIMIT_EXCEEDED'),
    true,
  );
});

test('validator aggregates unsupported native renderer and factory capability diagnostics', () => {
  const json = {
    namespace: 'native_runtime_diagnostics',
    root: {
      type: 'panel',
      controls: [
        { future_a: { type: 'custom', renderer: 'future_renderer' } },
        { future_b: { type: 'custom', renderer: 'future_renderer' } },
        { book: { type: 'custom', renderer: 'enchanting_book_renderer', size: [40, 40] } },
        { horse: { type: 'custom', renderer: 'live_horse_renderer', size: [20, 20] } },
        { missing: { type: 'custom' } },
        {
          unknown_item: {
            type: 'custom',
            renderer: 'inventory_item_renderer',
            property_bag: { '#item_id_aux': 999 * 0x1_0000 },
          },
        },
        { rows_a: { type: 'factory', name: 'runtime_rows' } },
        { rows_b: { type: 'factory', name: 'runtime_rows' } },
        { cards: { type: 'factory', name: 'runtime_cards' } },
        {
          generated_list: {
            type: 'stack_panel',
            factory: { name: 'runtime_list', control_name: 'native_runtime_diagnostics.row' },
          },
        },
      ],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/native-runtime-diagnostics.json' });
  const result = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
  });

  assert(!result.warnings.some((warning) => warning.code === 'TYPE_UNSUPPORTED'));
  const rendererWarnings = result.warnings.filter((warning) => warning.code === 'CUSTOM_RENDERER_RUNTIME_DEPENDENT');
  assertEqual(rendererWarnings.length, 1);
  assert(rendererWarnings[0].message.includes('Count: 3.'));
  assert(rendererWarnings[0].message.includes('"future_renderer"=2'));
  assertEqual(rendererWarnings[0].message.includes('inventory_item_renderer'), false);
  assert(rendererWarnings[0].message.includes('"<missing or inherited renderer>"=1'));
  assertEqual(rendererWarnings[0].message.includes('enchanting_book_renderer'), false);
  assertEqual(rendererWarnings[0].message.includes('live_horse_renderer'), false);

  const surrogateWarnings = result.warnings.filter((warning) => warning.code === 'CUSTOM_RENDERER_SURROGATE');
  assertEqual(surrogateWarnings.length, 0);

  const unsupportedItem = result.warnings.find((warning) => warning.code === 'NATIVE_PREVIEW_ITEM_ID_UNSUPPORTED');
  assert(unsupportedItem);
  assertEqual(unsupportedItem.originKind, 'native-renderer-capability');
  assert(unsupportedItem.message.includes('structurally valid'));

  const factoryWarnings = result.warnings.filter((warning) => warning.code === 'FACTORY_RUNTIME_DEPENDENT');
  assertEqual(factoryWarnings.length, 1);
  assert(factoryWarnings[0].message.includes('Count: 4.'));
  assert(factoryWarnings[0].message.includes('"runtime_rows"=2'));
  assert(factoryWarnings[0].message.includes('"runtime_cards"=1'));
  assert(factoryWarnings[0].message.includes('"runtime_list"=1'));
});

test('native runtime capability diagnostics bound untrusted distinct names and message examples', () => {
  const json = { namespace: 'native_runtime_diagnostic_bounds' };
  for (let index = 0; index < 100; index += 1) {
    const renderer = index === 0 ? 'future\nrenderer' : `future_renderer_${index}`;
    json[`renderer_${index}`] = { type: 'custom', renderer };
  }
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/native-runtime-bounds.json' });
  const result = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
  });
  const warnings = result.warnings.filter((warning) => warning.code === 'CUSTOM_RENDERER_RUNTIME_DEPENDENT');
  assertEqual(warnings.length, 1);
  assert(warnings[0].message.includes('Count: 100.'));
  assert(warnings[0].message.includes('Showing 8 of 64 recorded names.'));
  assert(warnings[0].message.includes('36 additional controls exceeded the 64-name aggregation bound.'));
  assert(warnings[0].message.includes('"future\\nrenderer"=1'));
  assert(!warnings[0].message.includes('future\nrenderer'));
  assert(warnings[0].message.length < 1200);
});

test('generated boolean fields also allow runtime expressions', () => {
  const element = generateElementSchemaDraft07();
  const visible = element.definitions.UiElement_panel.properties.visible;
  assert(Array.isArray(visible.anyOf));
  assert(visible.anyOf.some((choice) => choice.type === 'boolean'));
  assert(visible.anyOf.some((choice) => choice.type === 'string'));
  assertEqual(visible.default, true);
  const shadow = element.definitions.UiElement_label.properties.shadow;
  assert(shadow.anyOf.some((choice) => choice.type === 'boolean'));
  assert(shadow.anyOf.some((choice) => choice.type === 'string'));
  assertEqual(element.definitions.UiElement_label.properties.text.type, 'string');
  const anchor = element.definitions.AnchorPoint;
  assert(anchor.anyOf.some((choice) => choice.enum?.includes('center')));
  assert(anchor.anyOf.some((choice) => choice.type === 'string' && choice.minLength === 1));
});

test('inline controls containing only type remain inline elements', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'inline',
    screen: {
      type: 'screen',
      controls: [{ type: 'panel' }],
    },
  }, { filePath: 'ui/inline.json' });
  const child = model.root.children[0].children[0];
  assertEqual(child.type, 'panel');
  assertEqual(child.origin.kind, 'inline');
  assertEqual(child.key.local_name, '__inline__1');
});

test('engine-provided semantic font names do not produce missing file references', () => {
  for (const name of ['default', 'smooth', 'rune', 'unicode', 'MinecraftTen']) {
    const result = resolveFontTypeRef(name, {});
    assertEqual(result.ok, true, name);
    assertEqual(result.builtIn, true, name);
    assertEqual(result.resolved, null, name);
    assertDeepEqual(result.candidates, [], name);
  }
  const custom = resolveFontTypeRef('MyCustomFont', {});
  assertEqual(custom.ok, true);
  assertEqual(custom.builtIn, false);
  assert(custom.candidates.length > 0);
});

test('validator skips indexes for built-in and symbolic fonts but still reports custom fonts', () => {
  const builtInJson = {
    namespace: 'built_in_fonts',
    label: { type: 'label', text: 'Built in', font_type: 'rune' },
    dynamic: { type: 'label', text: 'Dynamic', font_type: '$runtime_font' },
    bound: { type: 'label', text: 'Bound', font_type: '#bound_font' },
    inherited: { type: 'label', text: 'Inherited', font_type: '@runtime.font' },
    expression: { type: 'label', text: 'Expression', font_type: '($runtime_font)' },
  };
  const builtInModel = buildUiScreenModelFromJson(builtInJson, { filePath: 'ui/built-in-fonts.json' });
  const builtInResult = validateUiScreenModel(builtInModel, {
    sourceJson: builtInJson,
    supportedTypes: ['label'],
    referenceContext: { importedIndex: null, vanillaIndex: null },
  });
  assert(!builtInResult.warnings.some((warning) => warning.code === 'ASSET_INDEX_UNAVAILABLE'));
  assert(!builtInResult.warnings.some((warning) => warning.code === 'MISSING_FONT_REF'));

  const customJson = {
    namespace: 'custom_font_without_index',
    label: { type: 'label', text: 'Custom', font_type: 'MyCustomFont' },
  };
  const customModel = buildUiScreenModelFromJson(customJson, { filePath: 'ui/custom-font-no-index.json' });
  const customResult = validateUiScreenModel(customModel, {
    sourceJson: customJson,
    supportedTypes: ['label'],
    referenceContext: { importedIndex: null, vanillaIndex: null },
  });
  assert(customResult.warnings.some((warning) => warning.code === 'ASSET_INDEX_UNAVAILABLE'));
});

test('missing custom fonts remain visible in reference diagnostics', () => {
  const json = {
    namespace: 'fonts',
    label: { type: 'label', text: 'Custom', font_type: 'MyCustomFont' },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/fonts.json' });
  const result = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: ['label'],
    referenceContext: {
      importedIndex: buildAssetIndexFromPackPaths([]),
      vanillaIndex: null,
    },
  });
  assert(result.warnings.some(
    (warning) => warning.code === 'MISSING_FONT_REF' && warning.refValue === 'MyCustomFont',
  ));
});

test('validator distinguishes engine runtime variables from genuine missing globals', () => {
  const runtimeOnly = {
    namespace: 'runtime_vars',
    screen: { type: 'screen', size: ['$left_horizontal_safezone_size', '$container_title'] },
  };
  const runtimeModel = buildUiScreenModelFromJson(runtimeOnly, { filePath: 'ui/runtime-vars.json' });
  const runtimeResult = validateUiScreenModel(runtimeModel, {
    sourceJson: runtimeOnly,
    supportedTypes: ['screen'],
    referenceContext: {
      globalVarNames: null,
      runtimeVarNames: new Set(REPRESENTATIVE_CLASSIC_RUNTIME_VARIABLE_NAMES),
    },
  });
  assert(!runtimeResult.warnings.some((issue) => issue.code === 'GLOBAL_VARS_UNAVAILABLE'));
  assert(!runtimeResult.warnings.some((issue) => issue.code === 'MISSING_GLOBAL_VAR'));

  const withTypo = { namespace: 'runtime_vars', screen: { type: 'screen', size: ['$container_title', '$pack_typo'] } };
  const typoModel = buildUiScreenModelFromJson(withTypo, { filePath: 'ui/runtime-typo.json' });
  const unavailable = validateUiScreenModel(typoModel, {
    sourceJson: withTypo,
    supportedTypes: ['screen'],
    referenceContext: {
      globalVarNames: null,
      runtimeVarNames: new Set(REPRESENTATIVE_CLASSIC_RUNTIME_VARIABLE_NAMES),
    },
  });
  assert(unavailable.warnings.some((issue) => issue.code === 'GLOBAL_VARS_UNAVAILABLE'));
  const missing = validateUiScreenModel(typoModel, {
    sourceJson: withTypo,
    supportedTypes: ['screen'],
    referenceContext: {
      globalVarNames: new Set(),
      runtimeVarNames: new Set(REPRESENTATIVE_CLASSIC_RUNTIME_VARIABLE_NAMES),
    },
  });
  assert(missing.warnings.some((issue) => issue.code === 'MISSING_GLOBAL_VAR' && issue.refValue === '$pack_typo'));
  assert(!missing.warnings.some((issue) => issue.code === 'MISSING_GLOBAL_VAR' && issue.refValue === '$container_title'));
});

test('validator suppresses missing type only for explicitly ignored typeless controls', () => {
  const json = {
    namespace: 'typeless',
    ignored_template: { ignored: true },
    active_template: { ignored: false },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/typeless.json' });
  const result = validateUiScreenModel(model, { sourceJson: json, supportedTypes: ['panel'] });
  const missingTypes = result.warnings.filter((issue) => issue.code === 'TYPE_MISSING');
  assert(!missingTypes.some((issue) => issue.nodeKey === 'ignored_template'));
  assert(missingTypes.some((issue) => issue.nodeKey === 'active_template'));
});

test('validator suppresses typeless noise below a structurally ignored branch', () => {
  const json = {
    namespace: 'inactive_typeless',
    screen: {
      type: 'panel',
      controls: [{ branch: {
        type: 'panel', ignored: true,
        controls: [{ hidden_runtime_shape: {} }],
      } }],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/inactive-typeless.json' });
  const result = validateUiScreenModel(model, { sourceJson: json, supportedTypes: ['panel'] });
  assert(!result.warnings.some((issue) => (
    issue.code === 'TYPE_MISSING' && issue.nodeKey === 'hidden_runtime_shape'
  )));
});

test('binding-evaluated ignored state overrides the authored structural default', () => {
  const json = {
    namespace: 'reactivated_typeless',
    screen: {
      type: 'panel',
      controls: [{ branch: {
        type: 'panel', ignored: true,
        bindings: [{ binding_type: 'global', binding_name: '#active', binding_name_override: '#ignored' }],
        controls: [{ active_runtime_shape: {} }],
      } }],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/reactivated-typeless.json' });
  const branch = model.root.children[0].children[0];
  const result = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: ['panel'],
    referenceContext: { evaluatedPropsById: { [branch.id]: { ignored: false } } },
  });
  assert(result.warnings.some((issue) => (
    issue.code === 'TYPE_MISSING' && issue.nodeKey === 'active_runtime_shape'
  )));
});

test('hard-ignored subtrees do not contribute renderer or asset warnings', () => {
  const json = {
    namespace: 'inactive_refs',
    screen: {
      type: 'screen',
      controls: [{ hidden: {
        type: 'panel', ignored: true,
        controls: [
          { icon: { type: 'image', texture: 'textures/ui/inactive_missing' } },
          { native: { type: 'custom', renderer: 'future_runtime_renderer' } },
        ],
      } }],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/inactive-refs.json' });
  const result = validateUiScreenModel(model, {
    sourceJson: json,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    referenceContext: {
      importedIndex: buildAssetIndexFromPackPaths([]), vanillaIndex: null,
      langTable: {}, globalVarNames: new Set(),
    },
  });
  assert(!result.warnings.some((issue) => (
    issue.code === 'MISSING_TEXTURE_REF' && issue.refValue === 'textures/ui/inactive_missing'
  )));
  assert(!result.warnings.some((issue) => issue.code === 'CUSTOM_RENDERER_RUNTIME_DEPENDENT'));
});
