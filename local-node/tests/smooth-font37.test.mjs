import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadSmoothFontResource, SMOOTH_FONT_LIMITS } from '../smooth-font37.mjs';
import { FrameRasterResources, RASTER_LIMITS } from '../frame-raster-assets13.mjs';
import { CliClient } from '../cli-client.mjs';
import { renderFramePng, loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const backend = loadRasterBackend();
const metadata = JSON.stringify({ fonts: [{ font_name: 'OldSmoothFont', font_format: 'msdf', font_file: 'font/smooth/smooth_' }] });
const mapping = Buffer.from([0xe5, 0x65, 0x00, 0x21]); // 日 -> smooth_21 cell 0
const fontdata = Buffer.alloc(1028);
for (let index = 0; index < 256; index++) fontdata.writeFloatLE(0.75, 4 + index * 4);
const distance = Buffer.alloc(1024 * 1024 * 4);
for (let offset = 0; offset < distance.length; offset += 4) {
  distance[offset] = 255; distance[offset + 1] = 255; distance[offset + 2] = 255;
  // Deliberately zero alpha: MSDF RGB still contains the shape. Drawing the
  // atlas as an ordinary tinted PNG would incorrectly yield no visible text.
}
const msdf = pngjs.PNG.sync.write({ width: 1024, height: 1024, data: distance });
const bitmap = pngjs.PNG.sync.write({ width: 128, height: 128, data: Buffer.alloc(128 * 128 * 4, 255) });
const assets = { 'font/font_metadata.json': metadata, 'font/smooth/remapping.dat': mapping,
  'font/smooth/smooth_00.png': msdf, 'font/smooth/smooth_00.fontdata': fontdata,
  'font/smooth/smooth_21.png': msdf, 'font/smooth/smooth_21.fontdata': fontdata,
  'font/default8.png': bitmap, 'font/glyph_65.png': bitmap };

function packageReader(files) {
  return { rootPrefix: '', packPaths: Object.keys(files), zipReader: { async bytes(name, maximum) {
    const bytes = Buffer.from(files[name]); assert(bytes.length <= maximum, `${name} exceeded caller's read bound`); return bytes;
  } } };
}
const source = { id: 'vanilla', kind: 'vanilla', overrides: {} };

test('smooth service returns exact remapping/atlas/float metrics with separate original resource provenance', async () => {
  const options = { sources: [source], getPack: () => packageReader(assets) };
  const remapping = await loadSmoothFontResource({ ...options, sheet: 'smooth_remapping' });
  assert.deepEqual(remapping.pairs, [[0x65e5, 0x2100]]);
  assert.equal(remapping.provenance.path, 'font/smooth/remapping.dat');
  assert.match(remapping.provenance.sha256, /^[a-f0-9]{64}$/u);
  const sheet = await loadSmoothFontResource({ ...options, sheet: 'smooth_21' });
  assert.equal(sheet.metrics.format, 'msdf'); assert.equal(sheet.metrics.glyphs[0].advance, 8);
  assert.deepEqual(Buffer.from(sheet.png, 'base64'), msdf);
  assert.equal(sheet.provenance.fontdataPath, 'font/smooth/smooth_21.fontdata');
  assert.equal(sheet.provenance.minecraftPixelParityVerified, false);
  assert.equal(sheet.pixels, undefined);
  const withPixels = await loadSmoothFontResource({ ...options, sheet: 'smooth_21', includePixels: true });
  assert.equal(withPixels.pixels.encoding, 'rgba8-base64');
  assert.deepEqual(Buffer.from(withPixels.pixels.rgbaBase64, 'base64'), distance, 'alpha-zero RGB remains unpremultiplied');
  assert.equal(SMOOTH_FONT_LIMITS.remappingBytes, 262144);
});

test('higher-priority broken metadata/pairs never fall back; ambiguous and unsupported resources are rejected', async () => {
  const bad = { ...assets, 'font/font_metadata.json': '{invalid' };
  const half = { ...assets }; delete half['font/smooth/smooth_21.fontdata'];
  const sources = [{ id: 'imported', kind: 'imported' }, source];
  for (const [files, sheet, code] of [[bad, 'smooth_remapping', 'FONT_SMOOTH_METADATA_INVALID'],
    [half, 'smooth_21', 'FONT_SMOOTH_PAIR_MISSING']]) {
    await assert.rejects(loadSmoothFontResource({ sources, getPack: id => packageReader(id === 'imported' ? files : assets), sheet }), { code });
  }
  const unsupported = { ...assets, 'font/font_metadata.json': JSON.stringify({ fonts: [{ font_name: 'OldSmoothFont', font_format: 'ttf' }] }) };
  await assert.rejects(loadSmoothFontResource({ sources: [source], getPack: () => packageReader(unsupported), sheet: 'smooth_00' }), { code: 'FONT_SMOOTH_METADATA_UNSUPPORTED' });
  const collision = { ...assets, 'font/smooth/SMOOTH_21.PNG': msdf };
  await assert.rejects(loadSmoothFontResource({ sources: [source], getPack: () => packageReader(collision), sheet: 'smooth_21' }), { code: 'FONT_SMOOTH_RESOURCE_AMBIGUOUS' });
  const wrongHeader = Buffer.from(fontdata); wrongHeader.writeUInt32LE(1, 0);
  await assert.rejects(loadSmoothFontResource({ sources: [source], getPack: () => packageReader({ ...assets, 'font/smooth/smooth_21.fontdata': wrongHeader }), sheet: 'smooth_21' }), /FONT_SMOOTH_FONTDATA_HEADER/u);
});

async function setup(t, omitted = [], documentOverride = null, extraFiles = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'smooth-font37-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const document = documentOverride || { namespace: 'smooth', screen: { type: 'screen', size: [40, 24], controls: [{ title: {
    type: 'label', text: '日A', size: [32, 20], localize: false, color: [1, 1, 1],
    anchor_from: 'top_left', anchor_to: 'top_left',
  } }] } };
  const files = { 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/smooth.json"]}', 'ui/smooth.json': JSON.stringify(document), ...assets, ...extraFiles };
  for (const name of omitted) delete files[name];
  const input = path.join(directory, 'fixture.zip'); await writeFile(input, makeZip(files));
  const client = await CliClient.start(); t.after(() => client.close());
  const imported = await client.importPack(input), sources = [{ id: imported.id, kind: 'vanilla', rootPrefix: imported.rootPrefix }];
  const catalog = await client.request('/api/node/catalog', { payload: { sources } });
  const record = catalog.records.find(row => row.qualifiedName === 'smooth.screen');
  const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } });
  const frameRequest = { projectionId: projection.nodeProjectionId, recordId: record.id, filePath: record.filePath,
    preset: { width: 40, height: 24 }, generation: 0, visibilityMode: 'safe' };
  const frame = await client.request('/api/node/frame', { payload: frameRequest });
  return { client, sources, projection, frameRequest, frame, width: 40, height: 24 };
}

test('ZIP -> font API -> remapping -> MSDF PNG is explicit, source-backed and leaves bitmap default intact', { skip: !backend, timeout: 60000 }, async t => {
  const args = await setup(t);
  const remapping = await args.client.request('/api/node/font', { payload: { sources: args.sources, sheet: 'smooth_remapping' } });
  assert.deepEqual(remapping.pairs, [[0x65e5, 0x2100]]);
  const raw = await args.client.request('/api/node/font', { payload: { sources: args.sources, sheet: 'smooth_21', includePixels: true } });
  assert.deepEqual(Buffer.from(raw.pixels.rgbaBase64, 'base64'), distance);
  const ordinary = await args.client.request('/api/node/font', { payload: { sources: args.sources, sheet: 'smooth_21' } });
  assert.equal(ordinary.pixels, undefined, 'cache keys keep the optional raw-pixel transport separate');
  await assert.rejects(args.client.request('/api/node/font', { payload: { sources: args.sources, sheet: 'default8', includePixels: true } }), { code: 'FONT_REQUEST_INVALID' });
  const result = await renderFramePng({ ...args, fontProfile: 'observed-smooth' });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true);
  assert.equal(result.rendering.font_profile, 'observed-smooth'); assert.equal(result.rendering.minecraft_pixel_parity_verified, false);
  assert(result.provenance.some(row => row.kind === 'font-remapping'));
  assert.deepEqual(result.provenance.filter(row => row.kind === 'font').map(row => row.sheet).sort(), ['smooth_00', 'smooth_21']);
  const decoded = pngjs.PNG.sync.read(result.png);
  assert(decoded.data.some((value, index) => index % 4 === 0 && value === 255), 'zero-alpha native atlas RGB produces visible distance-field glyphs');
  const old = await renderFramePng(args);
  assert.equal(old.ok, true, JSON.stringify(old)); assert.equal(old.rendering.font_profile, 'bitmap');
  assert(!old.provenance.some(row => row.kind === 'font-remapping'));
  assert(old.provenance.some(row => row.kind === 'font' && row.sheet === 'glyph_65'));
  const scaled = await renderFramePng({ ...args, width: 160, height: 96, uiScale: 4, fontProfile: 'observed-smooth' });
  assert.equal(scaled.ok, true, JSON.stringify(scaled)); assert.equal(scaled.rendering.ui_scale, 4);
});

test('missing remapping/paired metrics remain strict failures; resource memory includes original RGBA and cell cache', { skip: !backend, timeout: 60000 }, async t => {
  for (const omitted of [['font/smooth/remapping.dat'], ['font/smooth/smooth_21.fontdata']]) {
    const args = await setup(t, omitted), result = await renderFramePng({ ...args, fontProfile: 'observed-smooth' });
    assert.equal(result.ok, false); assert.equal(result.png, undefined); assert.equal(result.complete, false);
    assert(result.diagnostics.some(row => row.code.startsWith('FONT_SMOOTH_')), JSON.stringify(result));
  }
  const args = await setup(t), resources = new FrameRasterResources({ client: args.client, sources: args.sources, backend, locale: 'en_US' });
  await resources.initialize(); const map = await resources.remapping(); assert.equal(map.get(0x65e5), 0x2100);
  const sheet = await resources.font('smooth_21');
  assert.equal(sheet.pixels.data.length, 4 * 1024 * 1024);
  assert.deepEqual(sheet.image, { width: 1024, height: 1024 }, 'smooth stores a layout descriptor, never a premultiplied atlas image');
  assert.equal(resources.decodedBytes, 4.5 * 1024 * 1024 + 64 + 512);
  resources.decodedBytes = RASTER_LIMITS.decodedBytes - 4 * 1024 * 1024;
  await assert.rejects(resources.font('smooth_00'), { code: 'RASTER_FONT_PIXEL_LIMIT' });
});

test('smooth intrinsic reflow exposes a rail: acquire its images/new glyph sheet and reject a newly required missing texture', { skip: !backend, timeout: 60000 }, async t => {
  const node = (type, size, controls = [], more = {}) => ({ type, ...(size ? { size } : {}), controls,
    anchor_from: 'top_left', anchor_to: 'top_left', ...more });
  const document = { namespace: 'smooth', screen: node('screen', [40, 24], [
    { scroll: node('scroll_view', [40, 24], [
      { wrapper: node('stack_panel', ['100%', '100%'], [
        { holder: node('panel', ['fill', '100%'], [{ viewport: node('panel', ['100%', '100%'], [
          { content: node('stack_panel', ['100%', '100%c'], [
            { body: node('label', [20, 'default'], [], { text: 'A\nA', localize: false }) },
          ], { orientation: 'vertical' }) },
        ]) }]) },
        { bar: node('panel', [8, '100%'], [
          { track: node('scroll_track', null, [{ rail: node('image', ['100%', '100%'], [], { texture: 'textures/ui/rail', keep_ratio: false, layer: 1 }) }]) },
          { box: node('scrollbar_box', null, [{ handle: node('image', [3, '100%'], [], { texture: 'textures/ui/handle', keep_ratio: false, layer: 2 }) }]) },
          { annotation: node('label', [8, 8], [], { text: '日', localize: false, layer: 3 }) },
        ]) },
      ], { orientation: 'horizontal' }) },
    ], { scroll_content: 'content', scroll_view_port: 'viewport', scrollbar_track: 'track', scrollbar_box: 'box', scroll_box_and_track_panel: 'bar' }) },
  ]) };
  const solid = color => pngjs.PNG.sync.write({ width: 1, height: 1, data: Buffer.from(color) });
  const rail = solid([255, 0, 0, 255]), handle = solid([0, 255, 0, 255]);
  const extra = { 'textures/ui/rail.png': rail, 'textures/ui/handle.png': handle };
  for (const missing of [false, true]) {
    const args = await setup(t, missing ? ['textures/ui/rail.png'] : [], document, extra);
    assert(!args.frame.layout.boxes.some(box => box.name === 'rail' || /rail/u.test(box.id)), 'initial approximate font fits; bar is not in the frame');
    assert.equal(Object.values(args.frame.layout.scrollMetaById)[0].maxScrollY, 0);
    let lastFrame = args.frame, reflows = 0;
    const realClient = args.client;
    args.client = { request: async (route, options) => {
      const result = await realClient.request(route, options);
      if (route === '/api/node/frame') { reflows++; lastFrame = result; }
      return result;
    } };
    const result = await renderFramePng({ ...args, fontProfile: 'observed-smooth' });
    assert(reflows > 0 && reflows <= 3, `bounded reflows: ${reflows}`);
    assert(Object.values(lastFrame.layout.scrollMetaById)[0].maxScrollY > 0, 'native smooth metrics make body overflow');
    if (missing) {
      assert.equal(result.ok, false); assert.equal(result.complete, false); assert.equal(result.png, undefined);
      assert(result.diagnostics.some(row => row.code === 'RASTER_TEXTURE_MISSING'), JSON.stringify(result));
    } else {
      assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true);
      assert(result.provenance.some(row => row.kind === 'font' && row.sheet === 'smooth_21'), 'a label first exposed during reflow loads its glyph sheet');
      const evidence = result.provenance.find(row => row.kind === 'texture' && row.packPath === 'textures/ui/rail.png');
      assert.equal(evidence?.sha256, createHash('sha256').update(rail).digest('hex'));
      const png = pngjs.PNG.sync.read(result.png), at = (x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
      assert.deepEqual(at(39, 23), [255, 0, 0, 255], 'newly visible rail paints exact source red');
      assert.deepEqual(at(32, 20), [0, 255, 0, 255], 'newly visible thumb paints exact source green');
    }
  }
});
