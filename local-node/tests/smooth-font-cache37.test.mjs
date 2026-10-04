import test from 'node:test';
import assert from 'node:assert/strict';
import { BitmapFontCache } from '../../editor-core/src/preview/bitmap-font-cache.js';
import { FontSheetRequestCache21 } from '../../editor-core/src/preview/font-sheet-request-cache21.js';
import { BitmapTextLayoutCache } from '../../editor-core/src/preview/bitmap-text-layout-cache.js';
import { normalizePreviewState } from '../../editor-core/src/engine/preview-state.js';
import { createAppStore, actions } from '../../editor-core/src/state-store/app-store.js';

const sources = [{ kind: 'vanilla', id: 'smooth37' }], locale = 'ja_JP';
const mapping = { kind: 'smooth-remapping', pairs: [[0x3042, 0x8742]], provenance: { path: 'font/smooth_remapping' } };
const metrics = { format: 'msdf', width: 1024, height: 1024, metricsProfile: 'observed-smooth-msdf-v1', glyphs: [] };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }
function setup({ load, decodeImage, decodeSmoothPixels } = {}) {
  const calls = [], errors = [], decodes = [];
  const cache = new BitmapFontCache(async request => {
    calls.push(request.sheet);
    return load ? load(request) : request.sheet === 'smooth_remapping' ? mapping : { metrics };
  }, () => {}, (error, sheet) => errors.push([error.message, sheet]), {
    decodeImage: decodeImage || (async data => { decodes.push(data); return { width: 1024, height: 1024 }; }),
    decodeSmoothPixels: decodeSmoothPixels || ((_data, image) => ({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.width * image.height * 4) })),
  });
  return { cache, calls, errors, decodes };
}

test('R37 smooth: remapping完了後だけmapped atlasを要求しPNG decodeしない', async () => {
  const env = setup();
  try {
    env.cache.ensure('Aあ', 'smooth', sources, locale, 'observed-smooth');
    await settle(); assert.deepEqual(env.calls, ['smooth_remapping']); assert.equal(env.decodes.length, 0);
    assert.equal(env.cache.get(sources, locale, 'smooth_remapping').remapping.get(0x3042), 0x8742);
    env.cache.ensure('Aあ', 'smooth', sources, locale, 'observed-smooth'); await settle();
    assert.deepEqual(env.calls, ['smooth_remapping', 'smooth_00', 'smooth_87']);
    const row = env.cache.get(sources, locale, 'smooth_87');
    assert.equal(row.status, 'ready'); assert.equal(row.bytes, 4.5 * 1024 * 1024); assert.equal(env.decodes.length, 0);
    assert.equal(row.smoothCacheMaxBytes, 512 * 1024); assert.equal(row.tinted, undefined);
    assert.equal(env.cache.stats().maxBytes, 128 * 1024 * 1024); assert.deepEqual(env.errors, []);
  } finally { env.cache.clear(); }
});

test('R37 smooth: authored smoothは明示family、defaultの既定は旧32MiB', async () => {
  const env = setup({ load: ({ sheet }) => sheet === 'smooth_remapping' ? mapping : { metrics: sheet.startsWith('smooth_') ? metrics : {} },
    decodeImage: async data => ({ width: data.metrics.format === 'msdf' ? 1024 : 128, height: data.metrics.format === 'msdf' ? 1024 : 128 }) });
  try {
    env.cache.ensure('A', 'default', sources, locale); await settle();
    assert.deepEqual(env.calls, ['default8']); assert.equal(env.cache.stats().maxBytes, 32 * 1024 * 1024);
    env.cache.ensure('A', 'smooth', sources, locale); await settle();
    env.cache.ensure('A', 'smooth', sources, locale); await settle();
    assert.equal(env.cache.get(sources, locale, 'smooth_00').status, 'ready');
    assert.equal(env.cache.stats().fontProfile, 'bitmap'); assert.equal(env.cache.stats().maxBytes, 128 * 1024 * 1024);
  } finally { env.cache.clear(); }
});

test('R37 smooth: 無効remappingをmissingに保持し自動再試行しない', async () => {
  for (const pairs of [[], [[1, 2], [1, 3]], [[0xd800, 1]], [[1, 65536]], [[1, NaN]], [[1]], 'invalid']) {
    const env = setup({ load: () => ({ kind: 'smooth-remapping', pairs }) });
    try {
      env.cache.ensure('あ', 'smooth', sources, locale); await settle();
      for (let i = 0; i < 3; i++) env.cache.ensure('あ', 'smooth', sources, locale);
      assert.deepEqual(env.calls, ['smooth_remapping']); assert.equal(env.cache.stats().missing, 1);
      assert.deepEqual(env.errors, [['FONT_SMOOTH_REMAPPING_INVALID', 'smooth_remapping']]); assert.equal(env.decodes.length, 0);
    } finally { env.cache.clear(); }
  }
});

test('R37 smooth: profile切替はabort非対応旧remapを破棄しbitmapへ戻す', async () => {
  let finish;
  const env = setup({ load: ({ sheet }) => sheet === 'smooth_remapping' ? new Promise(resolve => { finish = resolve; }) : { metrics: {} },
    decodeImage: async () => ({ width: 128, height: 128 }) });
  try {
    env.cache.ensure('あ', 'smooth', sources, locale, 'observed-smooth'); await tick();
    env.cache.ensure('A', 'default', sources, locale, 'bitmap'); finish(mapping); await settle();
    assert.equal(env.cache.get(sources, locale, 'smooth_remapping'), undefined);
    assert.equal(env.cache.get(sources, locale, 'default8').status, 'ready'); assert.equal(env.cache.stats().maxBytes, 32 * 1024 * 1024);
    assert.deepEqual(env.errors, []);
  } finally { env.cache.clear(); }
});

test('R37 smooth: atlas予算を超えた時は明示失敗、再読取loopなし', async () => {
  const env = setup(); env.cache.smoothMaxBytes = 5 * 1024 * 1024;
  try {
    env.cache.ensure('Aあ', 'smooth', sources, locale); await settle();
    env.cache.ensure('Aあ', 'smooth', sources, locale); await settle();
    assert.equal(env.cache.stats().ready, 2); assert.equal(env.cache.stats().missing, 1);
    assert.equal(env.errors[0][0], 'FONT_CACHE_BYTE_LIMIT'); assert(env.cache.stats().bytes < env.cache.smoothMaxBytes);
    env.cache.ensure('Aあ', 'smooth', sources, locale); await settle(); assert.equal(env.calls.length, 3);
  } finally { env.cache.clear(); }
});

test('R37 smooth: MSDFでない応答・不正寸法・不正RGBAをbitmapで代用しない', async () => {
  for (const options of [
    { load: ({ sheet }) => sheet === 'smooth_remapping' ? mapping : { metrics: {} } },
    { load: ({ sheet }) => sheet === 'smooth_remapping' ? mapping : { metrics: { ...metrics, width: 128, height: 128 } } },
    { decodeSmoothPixels: () => ({ width: 1024, height: 1024, data: new Uint8ClampedArray(1) }) },
  ]) {
    const env = setup(options);
    try {
      env.cache.ensure('A', 'smooth', sources, locale); await settle();
      env.cache.ensure('A', 'smooth', sources, locale); await settle();
      const row = env.cache.get(sources, locale, 'smooth_00');
      assert.equal(row.status, 'missing'); assert.equal(row.tinted, undefined);
      assert.match(row.errorCode, /^FONT_SMOOTH_/u);
    } finally { env.cache.clear(); }
  }
});

test('R37 smooth: sheet要求cacheはremap identity変更を跨がない', () => {
  const cache = new FontSheetRequestCache21(), first = new Map([[0x3042, 0x8742]]), second = new Map([[0x3042, 0x9942]]);
  assert.deepEqual(cache.getSheets('あ', 'smooth'), []);
  const result = cache.getSheets('あ', 'smooth', first); assert.deepEqual(result, ['smooth_87']);
  assert.equal(cache.getSheets('あ', 'smooth', first), result);
  assert.deepEqual(cache.getSheets('あ', 'smooth', second), ['smooth_99']);
});

test('R37 smooth: layout cacheはprofile/rounding/remapを別に保持', () => {
  const cache = new BitmapTextLayoutCache({ revision: 0, get() {} }), context = { sources, locale };
  let count = 0; const build = () => ({ ready: true, lines: [], count: ++count });
  const map = new Map([[1, 2]]), options = { fontType: 'smooth', remapping: map };
  const first = cache.getOrCreate('A', options, context, build);
  assert.equal(cache.getOrCreate('A', options, context, build), first);
  for (const changes of [{ fontProfile: 'observed-smooth' }, { roundingScale: 4 }, { remapping: new Map([[1, 3]]) }]) {
    assert.notEqual(cache.getOrCreate('A', { ...options, ...changes }, context, build), first);
  }
});

test('R37 smooth: state入力は明示2profileのみ、旧出力shape維持', () => {
  assert.equal(Object.hasOwn(normalizePreviewState({}), 'fontProfile'), false);
  for (const profile of ['bitmap', 'observed-smooth']) assert.equal(normalizePreviewState({ font_profile: profile }).fontProfile, profile);
  assert(normalizePreviewState({ font_profile: 'observed-smooth' }).diagnostics.some(row => row.code === 'PREVIEW_STATE_OBSERVED_SMOOTH'));
  for (const profile of ['smooth', '', null, 1, false, {}]) assert.throws(() => normalizePreviewState({ font_profile: profile }), /PREVIEW_STATE_FONT_PROFILE/u);
});

test('R37 smooth: GUI storeはbitmap開始、既知profileだけ変更', () => {
  const store = createAppStore(); assert.equal(store.getState().ui.previewFontProfile, 'bitmap');
  store.dispatch(actions.setPreviewFontProfile('observed-smooth')); assert.equal(store.getState().ui.previewFontProfile, 'observed-smooth');
  const current = store.getState(); store.dispatch(actions.setPreviewFontProfile('unknown')); assert.equal(store.getState(), current);
  store.dispatch(actions.setPreviewFontProfile('bitmap')); assert.equal(store.getState().ui.previewFontProfile, 'bitmap');
});

test('R37 smooth: API原RGBAのalpha0と中間alphaのRGBを保持', async () => {
  const pixels = Buffer.alloc(1024 * 1024 * 4); pixels.set([127, 64, 33, 0, 99, 88, 77, 128]);
  const calls = [], errors = [];
  const cache = new BitmapFontCache(async request => {
    calls.push(request);
    return request.sheet === 'smooth_remapping' ? mapping : { metrics, pixels: { width: 1024, height: 1024, encoding: 'rgba8-base64', rgbaBase64: pixels.toString('base64') } };
  }, () => {}, error => errors.push(error), { decodeImage: async () => ({ width: 1024, height: 1024 }) });
  try {
    cache.ensure('A', 'smooth', sources, locale); await settle();
    cache.ensure('A', 'smooth', sources, locale); await settle();
    assert.equal(calls[0].includePixels, undefined); assert.equal(calls[1].includePixels, true);
    assert.deepEqual([...cache.get(sources, locale, 'smooth_00').pixels.data.slice(0, 8)], [...pixels.subarray(0, 8)]);
    assert.deepEqual(errors, []);
  } finally { cache.clear(); }
});

test('R37 smooth: rawRGBA欠落・不正encoding・不正base64はcanvas代用なしで拒否', async () => {
  for (const pixels of [undefined, { width: 1024, height: 1024, encoding: 'other', rgbaBase64: '' },
    { width: 1024, height: 1024, encoding: 'rgba8-base64', rgbaBase64: '!' .repeat(Math.ceil(1024 * 1024 * 4 / 3) * 4) }]) {
    const cache = new BitmapFontCache(async request => request.sheet === 'smooth_remapping' ? mapping : { metrics, pixels }, () => {}, () => {},
      { decodeImage: async () => ({ width: 1024, height: 1024 }) });
    try {
      cache.ensure('A', 'smooth', sources, locale); await settle(); cache.ensure('A', 'smooth', sources, locale); await settle();
      assert.equal(cache.get(sources, locale, 'smooth_00').errorCode, 'FONT_SMOOTH_PIXELS');
    } finally { cache.clear(); }
  }
});
