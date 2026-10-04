import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliClient } from '../cli-client.mjs';
import { renderFramePng, loadRasterBackend } from '../frame-raster13.mjs';
import { FrameRasterResources, RASTER_LIMITS } from '../frame-raster-assets13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const backend = loadRasterBackend();
function png(width, height, pixel) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return pngjs.PNG.sync.write({ width, height, data });
}
const font = png(128, 128, (x, y) => [255, 255, 255, x % 8 < 5 && y % 8 < 7 ? 255 : 0]);
const texture = png(2, 2, (x, y) => x ? [0, 0, 255, 255] : y ? [0, 255, 0, 255] : [255, 0, 0, 255]);
function documentFor(children) {
  return { namespace: 'raster', screen: { type: 'screen', size: [64, 48], anchor_from: 'top_left', anchor_to: 'top_left', controls: children } };
}
const image = { image: { type: 'image', texture: 'textures/ui/color', size: [16, 16], offset: [0, 0], anchor_from: 'top_left', anchor_to: 'top_left', keep_ratio: false } };
const label = { label: { type: 'label', text: 'test.greeting', size: [32, 12], offset: [20, 0], anchor_from: 'top_left', anchor_to: 'top_left', color: [1, 1, 1] } };
async function setup(t, { document = documentFor([image, label]), omit = [], extra = {} } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-raster13-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = { 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/raster.json"]}', 'ui/raster.json': JSON.stringify(document),
    'textures/ui/color.png': texture, 'font/default8.png': font, 'font/glyph_65.png': font, 'texts/ja_JP.lang': 'test.greeting=A日\n', ...extra };
  for (const name of omit) delete files[name];
  const source = path.join(directory, 'input.zip'); await writeFile(source, makeZip(files));
  const client = await CliClient.start(); t.after(() => client.close());
  const imported = await client.importPack(source), sources = [{ id: imported.id, kind: 'vanilla', rootPrefix: imported.rootPrefix }];
  const catalog = await client.request('/api/node/catalog', { payload: { sources } });
  const record = catalog.records.find(r => r.qualifiedName === 'raster.screen'); assert(record);
  const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } }); assert.equal(projection.ok, true);
  const frameRequest = { projectionId: projection.nodeProjectionId, recordId: record.id, filePath: record.filePath,
    preset: { width: 64, height: 48 }, generation: 0, animationTime: 0, visibilityMode: 'safe' };
  const frame = await client.request('/api/node/frame', { payload: frameRequest });
  return { client, sources, projection, frame, frameRequest, width: 64, height: 48, locale: 'ja_JP' };
}
const pixel = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const globals = () => new Map(['window', 'document', 'OffscreenCanvas', 'getComputedStyle'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));

test('PNG unavailable backend and malformed frame stop before resource calls', async () => {
  let called = false; const client = { request() { called = true; throw new Error('unexpected'); } };
  const args = { client, sources: [{ id: 'pack', kind: 'vanilla' }], projection: { ok: true, document: {}, selected: { filePath: 'ui/a.json' } },
    frame: { schema: 'jsonui-frame-v1', layout: { preset: { width: 16, height: 16 }, boxes: [] } }, width: 16, height: 16, backend: null };
  assert.equal((await renderFramePng(args)).code, 'RASTER_BACKEND_UNAVAILABLE'); assert.equal(called, false);
  assert.equal((await renderFramePng({ ...args, width: 8193 })).code, 'RASTER_OPTIONS_INVALID');
  assert.equal((await renderFramePng({ ...args, frame: { ...args.frame, layout: { ...args.frame.layout, stats: { truncated: true } } } })).code, 'RASTER_FRAME_INVALID');
  assert.equal((await renderFramePng({ ...args, projection: { ...args.projection, selected: { filePath: 'ui/pocket/a.json' } } })).code, 'RASTER_PROJECTION_INVALID');
});

test('real loopback ZIP → frame → texture and localized resource glyph PNG, deterministic pixels and clean globals', { skip: !backend, timeout: 60000 }, async t => {
  const args = await setup(t), before = globals();
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true, JSON.stringify(result.diagnostics));
  assert.equal(result.rendering.textures_rendered, true); assert.equal(result.rendering.localized_glyphs_rendered, true);
  assert.equal(result.rendering.minecraft_pixel_parity_verified, false); assert.deepEqual(globals(), before);
  const image = pngjs.PNG.sync.read(result.png); assert.equal(image.width, 64); assert.equal(image.height, 48);
  assert.deepEqual(pixel(image, 2, 2), [255, 0, 0, 255]); assert.deepEqual(pixel(image, 12, 2), [0, 0, 255, 255]);
  assert.deepEqual(pixel(image, 21, 1), [255, 255, 255, 255]); assert.deepEqual(pixel(image, 27, 1), [255, 255, 255, 255]);
  const repeat = await renderFramePng(args); assert.equal(repeat.ok, true); assert.deepEqual(repeat.png, result.png);
  assert(result.provenance.some(row => row.sheet === 'glyph_65'));
});

test('missing resource glyph or texture fails closed; explicit partial output is diagnosed', { skip: !backend, timeout: 60000 }, async t => {
  const args = await setup(t, { omit: ['font/glyph_65.png'] });
  const denied = await renderFramePng(args); assert.equal(denied.ok, false); assert.equal(denied.code, 'RASTER_INCOMPLETE'); assert.equal(denied.png, undefined);
  assert(denied.diagnostics.some(row => row.code === 'FONT_SHEET_MISSING'));
  const partial = await renderFramePng({ ...args, allowPartial: true }); assert.equal(partial.ok, true); assert.equal(partial.complete, false);
  assert.equal(partial.rendering.localized_glyphs_rendered, true); // Available A glyph survives missing 日 in explicit partial output.
  assert.deepEqual(pixel(pngjs.PNG.sync.read(partial.png), 21, 1), [255, 255, 255, 255]); assert.equal(partial.rendering.textures_rendered, true);
});

test('resource measured intrinsic label size reuses original frame request', { skip: !backend, timeout: 60000 }, async t => {
  const auto = structuredClone(label); delete auto.label.size;
  const args = await setup(t, { document: documentFor([auto]) });
  const without = await renderFramePng({ ...args, frameRequest: undefined });
  assert.equal(without.ok, false); assert(without.diagnostics.some(row => row.code === 'RASTER_INTRINSIC_LAYOUT_UNVERIFIED'));
  const result = await renderFramePng(args); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true);
  const image = pngjs.PNG.sync.read(result.png); assert.deepEqual(pixel(image, 21, 1), [255, 255, 255, 255]);
});

test('label content constraints use localized glyph metrics without changing authored size', { skip: !backend, timeout: 60000 }, async t => {
  for (const authoredSize of [undefined, ['default', 'default'], [32, 8]]) {
    const control = { ...label.label, max_size: ['100%c', 10] };
    if (authoredSize === undefined) delete control.size; else control.size = authoredSize;
    const args = await setup(t, { document: documentFor([{ label: control }]) });
    const original = JSON.stringify(args.projection.document), frames = [], requests = [];
    const request = args.client.request.bind(args.client);
    args.client.request = async (route, options) => {
      const result = await request(route, options);
      if (route === '/api/node/frame') { frames.push(result); requests.push(structuredClone(options.payload)); }
      return result;
    };
    const result = await renderFramePng(args);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true);
    const id = args.frame.layout.boxes.find(box => box.type === 'label').id;
    const final = frames.at(-1), box = final.layout.boxes.find(box => box.id === id);
    const metric = final.propsById[id].__jsonui_preview_text_intrinsic_size;
    assert.deepEqual(metric, [12, 8]); assert.equal(box.w, 12); assert.equal(box.h, 8);
    assert(frames.length <= 2, '実測が反映された制約を繰り返さない');
    if (authoredSize?.[0] === 32) assert(requests.every(row => !Object.hasOwn(row.propsByIdOverride[id], 'size')), '明示sizeは測定値へ置換しない');
    assert.deepEqual(pixel(pngjs.PNG.sync.read(result.png), 21, 1), [255, 255, 255, 255]);
    assert.equal(JSON.stringify(args.projection.document), original, '実測メタデータを原文へ書き込まない');
  }
});

test('real numeric label constraints converge while retaining their clamped bounds', { skip: !backend, timeout: 60000 }, async t => {
  for (const [limits, width] of [[{ max_size: [4, 8] }, 4], [{ max_size: [0, 8] }, 0], [{ min_size: [40, 8] }, 40]]) {
    const args = await setup(t, { document: documentFor([{ label: { ...label.label, size: ['default', 'default'], ...limits } }]) });
    const request = args.client.request.bind(args.client), frames = [];
    args.client.request = async (route, options) => {
      const result = await request(route, options); if (route === '/api/node/frame') frames.push(result); return result;
    };
    const result = await renderFramePng(args);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true);
    const final = frames.at(-1) || args.frame;
    assert.equal(final.layout.boxes.find(box => box.type === 'label').w, width);
    assert(frames.length <= 1, '同じ実測要求の再送を避ける');
  }
});

test('intrinsic texture sidecar respects maximum size without false reflow failure', { skip: !backend, timeout: 60000 }, async t => {
  const args = await setup(t, { document: documentFor([{ image: { ...image.image, size: ['default', 'default'], max_size: [8, 8] } }]),
    extra: { 'textures/ui/color.json': '{"base_size":[16,16]}' } });
  const result = await renderFramePng(args);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true);
  const decoded = pngjs.PNG.sync.read(result.png);
  assert.deepEqual(pixel(decoded, 2, 2), [255, 0, 0, 255]);
  assert.deepEqual(pixel(decoded, 9, 2), [17, 17, 17, 255]);
});

test('unapplied intrinsic requests retain bounded convergence diagnostics', { skip: !backend, timeout: 60000 }, async t => {
  const auto = structuredClone(label); delete auto.label.size;
  const args = await setup(t, { document: documentFor([auto]) });
  const request = args.client.request.bind(args.client); let attempts = 0;
  args.client.request = (route, options) => {
    if (route === '/api/node/frame') { attempts++; return structuredClone(args.frame); }
    return request(route, options);
  };
  const result = await renderFramePng(args);
  assert.equal(result.ok, false); assert.equal(result.png, undefined); assert.equal(attempts, 3);
  assert(result.diagnostics.some(row => row.code === 'RASTER_LAYOUT_DID_NOT_CONVERGE'));
});

test('native enchanting book shares product model and original frame time without DOM leakage', { skip: !backend, timeout: 60000 }, async t => {
  const book = { book: { type: 'custom', renderer: 'enchanting_book_renderer', '#open': true, size: [48, 48], anchor_from: 'top_left', anchor_to: 'top_left' } };
  const args = await setup(t, { document: documentFor([book]), extra: { 'textures/entity/enchanting_table_book.png': png(64, 32, () => [144, 40, 20, 255]) } });
  const before = globals(), a = await renderFramePng(args), b = await renderFramePng({ ...args, timeSeconds: 2.04 });
  assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(b.ok, true, JSON.stringify(b));
  // The current product intentionally keeps a book static at a fixed #open;
  // frame time must not invent free-running motion absent from the game state.
  assert.equal(a.rendering.native_3d_rendered, true); assert.equal(a.rendering.counts.nativeModels, 1); assert.deepEqual(a.png, b.png); assert.deepEqual(globals(), before);
});

test('decode header limit prevents backend decode; draw failure restores preexisting descriptors', { skip: !backend, timeout: 60000 }, async t => {
  const oversized = Buffer.from(texture); oversized.writeUInt32BE(9000, 16);
  const args = await setup(t, { document: documentFor([image]), extra: { 'textures/ui/color.png': oversized } });
  let decodes = 0;
  const denied = await renderFramePng({ ...args, backend: { ...backend, loadImage() { decodes++; throw new Error('decode forbidden'); } } });
  assert.equal(denied.ok, false); assert.equal(decodes, 0); assert(denied.diagnostics.some(row => row.code === 'RASTER_DECODE_LIMIT'));
  const empty = await setup(t, { document: documentFor([]) });
  const before = globals();
  const failed = await renderFramePng({ ...empty, backend: { ...backend, createCanvas() { throw new Error('injected drawing failure'); } } });
  assert.equal(failed.ok, false); assert.deepEqual(globals(), before);
});

test('expired resource budget refuses native decode before it starts', async () => {
  let decoded = false;
  const resources = new FrameRasterResources({ client: { request() {} }, sources: [{ id: 'pack', kind: 'vanilla' }], locale: 'ja_JP',
    backend: { loadImage() { decoded = true; } } });
  resources.started = Date.now() - RASTER_LIMITS.durationMs - 1;
  await assert.rejects(resources.decode(texture, { kind: 'texture' }), { code: 'RASTER_DECODE_TIMEOUT' }); assert.equal(decoded, false);
});

test('explicit tiled=false overrides sidecar true and base_size affects only authored default axes', { skip: !backend, timeout: 60000 }, async t => {
  const authored = structuredClone(image); authored.image.tiled = false; authored.image.size = ['default', 'default'];
  const args = await setup(t, { document: documentFor([authored]), extra: { 'textures/ui/color.json': '{"base_size":[16,16],"tiled":true}' } });
  const result = await renderFramePng(args); assert.equal(result.ok, true, JSON.stringify(result));
  const decoded = pngjs.PNG.sync.read(result.png); assert.deepEqual(pixel(decoded, 2, 2), [255, 0, 0, 255]);
  assert.deepEqual(pixel(decoded, 12, 2), [0, 0, 255, 255]); assert.deepEqual(pixel(decoded, 20, 2), [17, 17, 17, 255]);
  assert(result.provenance.some(row => row.kind === 'sidecar'));
});

test('edit_box empty and runtime-empty input paints localized original placeholder glyphs', { skip: !backend, timeout: 60000 }, async t => {
  let expected;
  const variants = [
    { place_holder_text: 'test.prompt' }, { text: '', place_holder_text: 'test.prompt' },
    { text: 'A', place_holder_text: 'missing.unused' },
    { text: '#input', '#input': '', place_holder_text: 'test.prompt' },
    { text: '', placeholder_text: 'test.prompt' },
  ];
  for (const props of variants) {
    const entry = { entry: { ...label.label, type: 'edit_box', offset: [0, 0], vertical_alignment: 'top', ...props } };
    // label.label's text is not part of an edit_box fixture unless supplied.
    if (!Object.hasOwn(props, 'text')) delete entry.entry.text;
    const args = await setup(t, { document: documentFor([entry]), extra: { 'texts/ja_JP.lang': 'test.prompt=A\n' } });
    const result = await renderFramePng(args);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true);
    assert.equal(result.rendering.counts.labels, 1); assert(result.provenance.some(row => row.kind === 'font'));
    assert.deepEqual(pixel(pngjs.PNG.sync.read(result.png), 1, 1), [255, 255, 255, 255]);
    expected ||= result.png; assert.deepEqual(result.png, expected);
    if (props.text === '#input') {
      const id = args.frame.layout.boxes.find(box => box.type === 'edit_box').id;
      const raw = await renderFramePng({ ...args, frame: { ...args.frame, propsById: { ...args.frame.propsById, [id]: { text: '#input', input: '' } } } });
      assert.equal(raw.ok, true, JSON.stringify(raw)); assert.deepEqual(raw.png, expected, 'raster runtimeToken の解決後も placeholder を選ぶ');
    }
  }
});

test('edit_box placeholder preserves strict runtime, localization and original glyph diagnostics', { skip: !backend, timeout: 60000 }, async t => {
  for (const [placeholder, omitted, code] of [
    ['#missing', [], 'RASTER_TEXT_UNRESOLVED'], ['missing.prompt', [], 'RASTER_LOCALIZATION_MISSING'], ['日', ['font/glyph_65.png'], 'FONT_SHEET_MISSING'],
  ]) {
    const args = await setup(t, { document: documentFor([{ entry: { ...label.label, type: 'edit_box', text: '', place_holder_text: placeholder } }]), omit: omitted });
    const denied = await renderFramePng(args);
    assert.equal(denied.ok, false); assert.equal(denied.complete, false); assert.equal(denied.png, undefined);
    assert(denied.diagnostics.some(row => row.code === code), JSON.stringify(denied));
    const partial = await renderFramePng({ ...args, allowPartial: true });
    assert.equal(partial.ok, true); assert.equal(partial.complete, false); assert(partial.diagnostics.some(row => row.code === code));
  }
  const args = await setup(t, { document: documentFor([{ entry: { ...label.label, type: 'edit_box', text: '', place_holder_text: '', placeholder_text: 'missing.alias' } }]) });
  const blank = await renderFramePng(args); assert.equal(blank.ok, true); assert.equal(blank.rendering.counts.labels, 0, '空の公式 placeholder を alias で上書きしない');
  const id = args.frame.layout.boxes.find(box => box.type === 'edit_box').id;
  for (const [text, code] of [[0, 'RASTER_TEXT_INVALID'], [false, 'RASTER_TEXT_INVALID'], ['#missing', 'RASTER_TEXT_UNRESOLVED']]) {
    const result = await renderFramePng({ ...args, frame: { ...args.frame, propsById: { ...args.frame.propsById, [id]: { text, place_holder_text: 'A' } } } });
    assert.equal(result.ok, false); assert(result.diagnostics.some(row => row.code === code), JSON.stringify(result));
  }
  const whitespace = await renderFramePng({ ...args, frame: { ...args.frame, propsById: { ...args.frame.propsById, [id]: { text: ' ', place_holder_text: 'missing.prompt' } } } });
  assert.equal(whitespace.ok, true); assert.equal(whitespace.rendering.counts.labels, 0, '空白入力を空文字へ丸めない');
});
