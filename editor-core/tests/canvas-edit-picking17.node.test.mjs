import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadRasterBackend } from '../../local-node/frame-raster13.mjs';
import { hitTestBoxes, drawCanvasPreview, getCanvasPreviewPaintSnapshot } from '../src/preview/canvas-preview.js';
import { createCanvasEditPicker } from '../src/preview/canvas-edit-picking17.js';

const backend = loadRasterBackend();
function runtime(run, dpr = 1) {
  const values = { window: { devicePixelRatio: dpr }, OffscreenCanvas: function(w, h) { return backend.createCanvas(w, h); },
    document: { documentElement: {}, createElement: () => backend.createCanvas(1, 1) }, getComputedStyle: () => ({ getPropertyValue: () => '' }) };
  const descriptors = new Map();
  try {
    for (const [key, value] of Object.entries(values)) { descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
    return run();
  } finally { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
}
function solid(color, width = 4, height = 4) { const canvas = backend.createCanvas(width, height); const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); return canvas; }
const box = (id, layer, type = 'image', extra = {}) => ({ id, type, layer, order: layer, x: 0, y: 0, w: 40, h: 40, renderAlpha: 1, ...extra });
const layout = boxes => ({ preset: { width: 80, height: 60 }, boxes });
const info = image => ({ state: 'ready', image, width: image.width, height: image.height, alpha: 1, keepRatio: false });
const options = { skip: !backend };
function pick(boxes, imageDrawById, extra = {}) {
  return createCanvasEditPicker().hitTest({ layout: layout(boxes), selection: { imageDrawById, ...extra.selection },
    view: { zoom: 1 }, worldX: 10, worldY: 10, ...extra, selection: { imageDrawById, ...extra.selection } });
}

test('旧選択は全画面flying renderer、新選択は実際に描画された画像', options, () => runtime(() => {
  const icon = box('icon', 1), panel = box('bundle_slot_panel', 10, 'panel'), flying = box('flying_item_renderer', 100, 'custom');
  const boxes = [icon, panel, flying];
  assert.equal(hitTestBoxes(boxes, 10, 10).id, flying.id);
  const images = { icon: info(solid('blue')), flying_item_renderer: { state: 'unsupported' } };
  assert.equal(pick(boxes, images)?.id, 'icon');
  assert.equal(pick(boxes, images, { structureMode: true })?.id, flying.id, '構造表示は空要素を明示選択できる');
}));

test('透明texel・透明画像・alpha/tintゼロ・空文字は手前の当たり判定を占有しない', options, () => runtime(() => {
  const under = solid('red'), transparent = backend.createCanvas(4, 4);
  transparent.getContext('2d').fillStyle = 'blue'; transparent.getContext('2d').fillRect(2, 0, 2, 4);
  const boxes = [box('under', 0), box('front', 1), box('zero', 2), box('tint', 3), box('empty', 4, 'label')];
  const images = { under: info(under), front: info(transparent), zero: { ...info(under), alpha: 0 }, tint: { ...info(under), tint: [1, 1, 1, 0] } };
  const selection = { textDrawById: { empty: { text: '', state: 'ready', fontBackend: 'resource-font-face' } } };
  assert.equal(pick(boxes, images, { selection })?.id, 'under');
  assert.equal(pick(boxes, images, { selection, worldX: 30 })?.id, 'front');
}));

test('画像のclip_ratio・祖先clip・keepRatio余白・無効UVは描画と同じ箇所を選ぶ', options, () => runtime(() => {
  const under = box('under', 0), front = box('front', 1);
  const images = { under: info(solid('red')), front: { ...info(solid('blue', 4, 2)), keepRatio: true } };
  assert.equal(pick([under, front], images, { worldY: 3 })?.id, 'under');
  assert.equal(pick([under, front], images, { worldY: 20 })?.id, 'front');
  images.front = { ...info(solid('blue')), clipRatio: .25, clipDirection: 'left' };
  assert.equal(pick([under, front], images, { worldX: 30 })?.id, 'under');
  assert.equal(pick([under, front], images, { worldX: 3 })?.id, 'front');
  assert.equal(pick([under, { ...front, clipRect: { x: 0, y: 0, w: 4, h: 40 } }], images)?.id, 'under');
  images.front.uvSizeState = 'invalid';
  assert.equal(pick([under, front], images)?.id, 'under');
}));

test('表示倍率と高DPRでも透明部分を通し、bitmap文字のない余白を選択しない', options, () => {
  for (const dpr of [1, 2, 4]) runtime(() => {
    const image = solid('blue'), boxes = [box('under', 0), box('label', 2, 'label')];
    const selection = { imageDrawById: { under: info(image) }, textDrawById: { label: { text: 'A', state: 'ready', fontBackend: 'resource-font-face', fontFamily: 'sans-serif', fontPx: 12, alpha: 1, align: 'left' } } };
    const picker = createCanvasEditPicker();
    assert.equal(picker.hitTest({ layout: layout(boxes), selection, view: { zoom: 2 }, worldX: 30, worldY: 20 })?.id, 'under');
    assert.equal(picker.hitTest({ layout: layout(boxes), selection, view: { zoom: 2 }, worldX: -1, worldY: 20 }), null);
  }, dpr);
});

test('40枚の透明画像の奥まで選択でき、同一描画の再判定を省略し、読取不能で誤選択しない', options, () => runtime(() => {
  let reads = 0;
  const fakeCanvas = backend.createCanvas(1, 1), ctx = fakeCanvas.getContext('2d'), realGet = ctx.getImageData.bind(ctx);
  ctx.getImageData = (...args) => { reads++; return realGet(...args); };
  const transparent = backend.createCanvas(2, 2), boxes = Array.from({ length: 40 }, (_, i) => box(String(i), i + 1));
  boxes.unshift(box('under', 0));
  const selection = { showGuides: false, showScreenBoundary: false,
    imageDrawById: Object.fromEntries(boxes.map(b => [b.id, info(b.id === 'under' ? solid('blue') : transparent)])) };
  const sourceCanvas = backend.createCanvas(80, 60); sourceCanvas.getBoundingClientRect = () => ({ width: 80, height: 60 });
  const l = layout(boxes); drawCanvasPreview(sourceCanvas, l, { zoom: 1 }, selection);
  const picker = createCanvasEditPicker({ createCanvas: () => fakeCanvas });
  const args = { layout: l, selection, view: { zoom: 1 }, worldX: 10, worldY: 10, sourceCanvas };
  assert.equal(picker.hitTest(args)?.id, 'under'); assert.equal(reads, 41);
  assert.equal(picker.hitTest(args)?.id, 'under'); assert.equal(reads, 41, '同じ描画済みフレーム・位置を重複検査しない');
  ctx.getImageData = () => { throw new Error('unavailable'); };
  assert.equal(picker.hitTest({ ...args, worldX: 11 }), null);
}));

test('通常のCanvas背景は維持し、検査用透明背景だけalphaを保存する', options, () => runtime(() => {
  const canvas = backend.createCanvas(10, 10); canvas.getBoundingClientRect = () => ({ width: 10, height: 10 });
  const args = { showGuides: false, showScreenBoundary: false };
  drawCanvasPreview(canvas, layout([]), { zoom: 1 }, args);
  assert.equal(canvas.getContext('2d').getImageData(2, 2, 1, 1).data[3], 255);
  drawCanvasPreview(canvas, layout([]), { zoom: 1 }, { ...args, transparentBackground: true });
  assert.equal(canvas.getContext('2d').getImageData(2, 2, 1, 1).data[3], 0);
}));

test('サイトのpress/hover/click全経路が編集専用選択を使用する', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /const hit = sourceEditing \? hitTestSourceCanvas\(key, f, world\)/u);
  assert.match(source, /const hit = cs2\.sourceEditing && f\?\.meta\?\.previewProjection \? hitTestSourceCanvas\(key, f, world\)/u);
  assert.match(source, /const hit = cs2\.sourceEditing && currentFile\?\.meta\?\.previewProjection \? hitTestSourceCanvas\(key, currentFile, world\)/u);
  assert.match(source, /snapshot\?\.file === file && snapshot\.layout === cs\.layout && snapshot\.pendingVersion === sourceWorkspace\.state\.pendingVersion && snapshot\.zoom === cs\.view\.zoom/u);
});

test('native描画世代・画面全体予算・control外のモデル範囲を実表示から引き継ぐ', options, () => runtime(() => {
  const red = solid('red'), blue = solid('blue');
  const face = (left = 0, right = 1) => ({ points: [{ x: left, y: 0 }, { x: right, y: 0 }, { x: right, y: 1 }, { x: left, y: 1 }], uv: { x: 0, y: 0, w: 1, h: 1 }, shade: 1, texture: true });
  const native = scene => ({ state: 'native-scene', image: red, width: 4, height: 4, alpha: 1, nativeScene: scene });
  const settings = images => ({ imageDrawById: images, cacheStableSources: true, rasterCacheEpoch: 1, showGuides: false, showScreenBoundary: false });
  const draw = (l, s) => { const c = backend.createCanvas(180, 120); c.getBoundingClientRect = () => ({ width: 180, height: 120 }); drawCanvasPreview(c, l, { zoom: 1 }, s); return c; };
  const fullLayout = boxes => ({ preset: { width: 180, height: 120 }, boxes });
  const args = (l, s, c, x, y) => ({ layout: l, selection: s, sourceCanvas: c, view: { zoom: 1 }, worldX: x, worldY: y });
  const under = box('under', 0, 'image', { w: 180, h: 120 });
  const moving = box('moving', 1, 'custom');
  const l = fullLayout([under, moving]), s = settings({ under: info(blue), moving: native({ kind: 'book', faces: [face(0, .4)] }) });
  const c = draw(l, s), picker = createCanvasEditPicker(), a = args(l, s, c, 5, 20);
  assert.equal(picker.hitTest(a)?.id, 'moving');
  s.imageDrawById.moving.nativeScene = { kind: 'book', faces: [face(.6, 1)] };
  drawCanvasPreview(c, l, { zoom: 1 }, s);
  assert.equal(picker.hitTest(a)?.id, 'under', '同じselection参照でも再描画されたなら旧pixel結果を使わない');
  const player = box('player', 1, 'custom', { x: 40, y: 40, w: 20, h: 20 });
  const lp = fullLayout([under, player]), sp = settings({ under: info(blue), player: native({ kind: 'player', presentationProfile: 'classic-player-panel-v2', faces: [face()] }) });
  const cp = draw(lp, sp);
  assert.equal(createCanvasEditPicker().hitTest(args(lp, sp, cp, 30, 50))?.id, 'player', 'モデルのcontrol外の可視部分も掴める');
  const wide = { ...player, x: 60, y: 20, w: 100, h: 100 }, lw = fullLayout([under, wide]), cw = draw(lw, sp);
  assert.deepEqual([...cw.getContext('2d').getImageData(5, 60, 1, 1).data], [255, 0, 0, 255]);
  assert.equal(createCanvasEditPicker().hitTest(args(lw, sp, cw, 5, 60))?.id, 'player', 'controlから50CSSpixel以上離れた可視部分もprobeでcullしない');
  const preceding = Array.from({ length: 32 }, (_, i) => box(`p${i}`, i + 1, 'custom', { x: 100, y: 10, w: 4, h: 4 }));
  const target = box('target', 34, 'custom'), lb = fullLayout([under, ...preceding, target]);
  const sb = settings({ under: info(blue), ...Object.fromEntries(preceding.map(b => [b.id, native({ kind: 'book', faces: [face()] })])), target: native({ kind: 'book', faces: [face(0, .1)] }) });
  const cb = draw(lb, sb);
  assert.deepEqual([...cb.getContext('2d').getImageData(2, 20, 1, 1).data], [0, 0, 255, 255]);
  assert.equal(createCanvasEditPicker().hitTest(args(lb, sb, cb, 2, 20))?.id, 'under', '33番目のnativeを単独検査して画面にない面を作らない');
}));

test('alpha検査で大型textureのRGB加工面を再作成せず、入力metadataを保存する', options, () => runtime(() => {
  const source = solid('rgba(0,0,0,0)', 2000, 2000), original = { ...info(source), tint: [.3, .4, .5, 1], grayscale: true };
  const boxes = [box('under', 0), box('large', 1)], images = { under: info(solid('blue')), large: original };
  const old = globalThis.OffscreenCanvas; let allocated = 0;
  globalThis.OffscreenCanvas = function(w, h) { allocated += w * h; return backend.createCanvas(w, h); };
  try { assert.equal(pick(boxes, images)?.id, 'under'); assert.equal(allocated, 0); }
  finally { globalThis.OffscreenCanvas = old; }
  assert.deepEqual(original.tint, [.3, .4, .5, 1]); assert.equal(original.grayscale, true);
}));

test('pixel読取不能は診断一度だけで原文・構造選択経路を維持し、日英文言がある', options, async () => {
  runtime(() => {
    const reports = [];
    const picker = createCanvasEditPicker({ createCanvas() { throw new Error('blocked'); }, onIssue: issue => reports.push(issue) });
    const args = { layout: layout([box('image', 1)]), selection: { imageDrawById: { image: info(solid('blue')) } }, view: { zoom: 1 }, worldX: 10, worldY: 10 };
    assert.equal(picker.hitTest(args), null); assert.equal(picker.hitTest({ ...args, worldX: 11 }), null);
    assert.deepEqual(reports, [{ code: 'CANVAS_EDIT_PIXEL_READ_FAILED' }]);
    assert.equal(picker.hitTest({ ...args, structureMode: true })?.id, 'image');
  });
  const { siteText, setSiteLocale } = await import('../src/i18n/site-messages.js');
  const message = '描画された画素を読み取れないため、この位置を選択できません。原文一覧または構造表示から要素を選択してください。';
  assert.equal(siteText(message), message); setSiteLocale('en_US');
  try { assert.match(siteText(message), /^This position cannot be selected/u); } finally { setSiteLocale('ja_JP'); }
});

test('tile全体予算によるstretchと既生成pattern面を引き継ぎ、probeで巨大面を作り直さない', options, () => runtime(() => {
  const under = box('under', 0), before = [box('pre1', 1, 'image', { x: 100 }), box('pre2', 2, 'image', { x: 100 })], target = box('target', 3);
  const imageDrawById = { under: info(solid('blue')) };
  for (const b of [...before, target]) {
    const texture = backend.createCanvas(2000, 2000); texture.getContext('2d').fillStyle = 'red'; texture.getContext('2d').fillRect(0, 0, 1000, 2000);
    // Bilinear explicitly retains the CanvasPattern path: the integer nearest
    // renderer only needs the visible 40x40 region and cannot exhaust 8M here.
    imageDrawById[b.id] = { ...info(texture), tiled: 'both', baseSize: [1, 1], bilinear: true };
  }
  const l = { preset: { width: 180, height: 120 }, boxes: [under, ...before, target] };
  const selection = { imageDrawById, showGuides: false, showScreenBoundary: false };
  const sourceCanvas = backend.createCanvas(180, 120); sourceCanvas.getBoundingClientRect = () => ({ width: 180, height: 120 });
  drawCanvasPreview(sourceCanvas, l, { zoom: 1 }, selection);
  assert.deepEqual([...sourceCanvas.getContext('2d').getImageData(30, 10, 1, 1).data], [0, 0, 255, 255]);
  const old = globalThis.OffscreenCanvas; let allocated = 0;
  globalThis.OffscreenCanvas = function(w, h) { allocated += w * h; return backend.createCanvas(w, h); };
  try {
    const picker = createCanvasEditPicker();
    assert.equal(picker.hitTest({ layout: l, selection, sourceCanvas, view: { zoom: 1 }, worldX: 30, worldY: 10 })?.id, 'under');
    assert.equal(picker.hitTest({ layout: l, selection, sourceCanvas, view: { zoom: 1 }, worldX: 100.2, worldY: 10 })?.id, 'pre2');
    assert.equal(allocated, 0, '既生成pattern面は参照再利用する');
  } finally { globalThis.OffscreenCanvas = old; }
}));

test('整数tileの可視面を再利用しfractional probeの画素・透明部分・DPR・zoom・panを表示と一致させる', options, () => {
  for (const dpr of [1, 1.25, 2, 4]) for (const zoom of [1, 2]) runtime(() => {
    const texture = backend.createCanvas(2000, 2000);
    texture.getContext('2d').fillStyle = 'red'; texture.getContext('2d').fillRect(0, 0, 1000, 2000);
    // More than 1024 patches selects the bounded integer raster. Two device
    // pixels per tile retain an opaque and a transparent stripe at every DPR.
    const under = box('under', 0, 'image', { w: 80, h: 80 });
    const target = box('target', 1, 'image', { w: 80, h: 80 });
    const l = { preset: { width: 100, height: 100 }, boxes: [under, target] };
    const selection = { imageDrawById: { under: info(solid('blue')),
      target: { ...info(texture), tiled: 'both', baseSize: [2 / (dpr * zoom), 1 / (dpr * zoom)] } },
      showGuides: false, showScreenBoundary: false };
    const sourceCanvas = backend.createCanvas(50, 50); sourceCanvas.getBoundingClientRect = () => ({ width: 50, height: 50 });
    const view = { zoom, viewX: 8, viewY: 8 };
    drawCanvasPreview(sourceCanvas, l, view, selection);
    const tiled = getCanvasPreviewPaintSnapshot(sourceCanvas).tiledDrawById.get('target');
    assert.equal(tiled.mode, 'integer-raster');
    assert.ok(tiled.raster.image.width <= Math.round(50 * dpr) && tiled.raster.image.height <= Math.round(50 * dpr));
    const old = globalThis.OffscreenCanvas; let allocated = 0;
    globalThis.OffscreenCanvas = function(w, h) { allocated += w * h; return backend.createCanvas(w, h); };
    try {
      const picker = createCanvasEditPicker();
      for (const fraction of [.1, .25, .5, .75, .9]) {
        for (const deviceX of [20, 21]) {
          const x = view.viewX + (deviceX + fraction) / (dpr * zoom);
          const y = view.viewY + 20.5 / (dpr * zoom);
          const pixel = [...sourceCanvas.getContext('2d').getImageData(deviceX, 20, 1, 1).data];
          const expected = deviceX % 2 === 0 ? 'target' : 'under';
          assert.deepEqual(pixel, expected === 'target' ? [255, 0, 0, 255] : [0, 0, 255, 255]);
          assert.equal(picker.hitTest({ layout: l, selection, sourceCanvas, view, worldX: x, worldY: y })?.id,
            expected, `dpr=${dpr}, zoom=${zoom}, fraction=${fraction}, deviceX=${deviceX}`);
        }
      }
      assert.equal(allocated, 0, 'probeは生成済み可視面を使い巨大sourceも小面も再allocateしない');
    } finally { globalThis.OffscreenCanvas = old; }
  }, dpr);
});
