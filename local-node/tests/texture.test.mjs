import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalServer } from '../server.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';
import { decodeTgaPixels } from '../../editor-core/src/assets/texture-image-cache.js';
import { NodeRemoteReader } from '../../editor-core/src/pack-io/node-remote-client.js';
import { makeZip, manifest } from './fixtures.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function tga({ width = 2, height = 2, depth = 32, type = 2, descriptor = 0x28, data = null } = {}) {
  const header = Buffer.alloc(18);
  header[2] = type; header.writeUInt16LE(width, 12); header.writeUInt16LE(height, 14);
  header[16] = depth; header[17] = descriptor;
  // BGRA stream: opaque red, green, blue and transparent white.
  return Buffer.concat([header, data || Buffer.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 0])]);
}
const good = tga();
const loosePng = pngjs.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([20, 40, 60, 255]) });
function archive(entries) {
  const bytes = Buffer.alloc(16 + entries.length * 256 + entries.reduce((sum, [, value]) => sum + value.length, 0));
  bytes.writeBigUInt64LE(0x267052a0b125277dn); bytes.writeUInt32LE(entries.length, 8); bytes.writeUInt32LE(1, 12);
  let offset = 0;
  for (const [index, [name, value]] of entries.entries()) {
    const at = 16 + index * 256, nameBytes = Buffer.from(name);
    bytes[at] = nameBytes.length; nameBytes.copy(bytes, at + 1);
    bytes.writeUInt32LE(offset, at + 248); bytes.writeUInt32LE(value.length, at + 252);
    value.copy(bytes, 16 + entries.length * 256 + offset); offset += value.length;
  }
  return bytes;
}
async function server(t) {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`, fetchAbsolute = globalThis.fetch;
  const { token } = await (await fetchAbsolute(base + '/api/node/capabilities')).json();
  const headers = { 'X-JSONUI-Token': token };
  async function request(id, path, options = {}) {
    const { route = 'preview-image', maxBytes, ...rest } = options;
    const query = new URLSearchParams({ path, ...(maxBytes === undefined ? {} : { maxBytes: String(maxBytes) }) });
    return fetchAbsolute(`${base}/api/node/packs/${id}/${route}?${query}`, { headers, ...rest });
  }
  async function upload(files) {
    const id = randomUUID();
    const response = await fetchAbsolute(base + '/api/node/packs', { method: 'POST', headers: {
      ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id, 'X-JSONUI-Name': 'texture-fixture.zip',
    }, body: makeZip({ 'root/manifest.json': manifest, ...files }) });
    const metadata = await response.json();
    assert.equal(response.status, 200, JSON.stringify(metadata));
    return { id, metadata };
  }
  return { app, base, headers, request, upload, fetchAbsolute };
}
async function equalConverted(response, original, label) {
  assert.equal(response.status, 200, label + ': HTTP status');
  assert.match(response.headers.get('content-type'), /^image\/png/u);
  const encoded = Buffer.from(await response.arrayBuffer());
  const actual = pngjs.PNG.sync.read(encoded, { checkCRC: true });
  const expected = decodeTgaPixels(original, { maxPixels: 16 * 1024 * 1024, maxDecodedBytes: 64 * 1024 * 1024 });
  assert.equal(actual.width, expected.width, label + ': width');
  assert.equal(actual.height, expected.height, label + ': height');
  assert.deepEqual(actual.data, Buffer.from(expected.data), label + ': exact RGBA');
  return { name: label, width: actual.width, height: actual.height, tgaSha256: sha(original), pngSha256: sha(encoded), rgbaSha256: sha(actual.data) };
}

test('TGA HTTP変換とNodeRemoteReaderの境界を一体で検査', { timeout: 30_000 }, async (t) => {
  const service = await server(t);
  const positive = {
    'rgba.tga': good,
    'right-origin.TGA': tga({ descriptor: 0x38 }),
    'bottom-origin.tga': tga({ descriptor: 8 }),
    'rgb24.tga': tga({ depth: 24, descriptor: 0x20, data: Buffer.from([0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255]) }),
    'rle.tga': tga({ type: 10, data: Buffer.from([0x81, 0, 0, 255, 255, 0x81, 0, 255, 0, 128]) }),
    'gray.tga': tga({ type: 3, depth: 8, descriptor: 0x20, data: Buffer.from([0, 64, 128, 255]) }),
    'gray-alpha.tga': tga({ type: 3, depth: 16, data: Buffer.from([0, 255, 64, 128, 128, 64, 255, 0]) }),
  };
  const files = Object.fromEntries(Object.entries(positive).map(([name, value]) => ['root/textures/' + name, value]));
  Object.assign(files, {
    'root/textures/pixel.png': loosePng,
    'root/textures/short.tga': Buffer.alloc(8),
    'root/textures/huge.tga': tga({ width: 65535, height: 65535 }),
    'root/textures/zero.tga': tga({ width: 0 }),
    'root/textures/truncated.tga': tga({ width: 4096, height: 4096 }),
    'root/textures/packet-overflow.tga': tga({ width: 1, height: 1, type: 10, data: Buffer.from([0x81, 0, 0, 255, 255]) }),
    'root/__brarchive/textures/items.brarchive': archive([['virtual.tga', good]]),
  });
  const { id, metadata } = await service.upload(files);
  for (const [name, original] of Object.entries(positive)) await t.test(name + 'を旧decoderのRGBAと完全照合', async () => {
    await equalConverted(await service.request(id, 'root/textures/' + name), original, name);
  });
  await t.test('RGBA既知値と透明alphaを保持する', async () => {
    const response = await service.request(id, 'root/textures/rgba.tga');
    const decoded = pngjs.PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual([...decoded.data], [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0]);
  });
  await t.test('仮想brarchive TGAもNodeからPNGへ変換する', async () => {
    assert(metadata.entries.some((entry) => entry.path === 'root/textures/items/virtual.tga' && entry.virtual));
    await equalConverted(await service.request(id, 'root/textures/items/virtual.tga'), good, 'virtual');
  });
  await t.test('変換後もread APIのTGA原本が不変', async () => {
    const original = Buffer.from(await (await service.request(id, 'root/textures/rgba.tga', { route: 'read' })).arrayBuffer());
    assert.deepEqual(original, good);
  });
  for (const [name, code] of [['short', 'TGA_DECODE_INVALID_HEADER'], ['huge', 'IMAGE_DECODE_TOO_MANY_PIXELS'],
    ['zero', 'TGA_DECODE_INVALID_DIMENSIONS'], ['truncated', 'TGA_DECODE_TRUNCATED'], ['packet-overflow', 'TGA_DECODE_PACKET_OVERFLOW']]) {
    await t.test(name + 'は公開診断付きで拒否し次requestが正常', async () => {
      const response = await service.request(id, 'root/textures/' + name + '.tga');
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error, code);
      assert.match(body.correlation_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
      assert.deepEqual(Object.keys(body).sort(), ['correlation_id', 'error']);
      assert.equal((await service.request(id, 'root/textures/rgba.tga')).status, 200);
    });
  }
  await t.test('TGA入力maxBytesを読取前に守る', async () => {
    const response = await service.request(id, 'root/textures/rgba.tga', { maxBytes: 18 });
    assert.equal(response.status, 413); assert.match((await response.json()).error, /READ_LIMIT/u);
  });
  await t.test('変換APIはPNGを形式不一致として拒否する', async () => {
    const response = await service.request(id, 'root/textures/pixel.png');
    assert.equal(response.status, 415);
    const body = await response.json();
    assert.equal(body.error, 'NODE_TEXTURE_FORMAT_UNSUPPORTED');
    assert.match(body.correlation_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    assert.deepEqual(Object.keys(body).sort(), ['correlation_id', 'error']);
  });
  await t.test('tokenなし・偽token・異なるOriginを拒否', async () => {
    assert.equal((await service.request(id, 'root/textures/rgba.tga', { headers: {} })).status, 401);
    assert.equal((await service.request(id, 'root/textures/rgba.tga', { headers: { 'X-JSONUI-Token': 'wrong' } })).status, 401);
    assert.equal((await service.request(id, 'root/textures/rgba.tga', { headers: { ...service.headers, Origin: 'https://foreign.example' } })).status, 403);
  });
  await t.test('範囲外maxBytesとtraversalを拒否', async () => {
    for (const maxBytes of [-1, 64 * 1024 * 1024 + 1, 'Infinity']) {
      const response = await service.request(id, 'root/textures/rgba.tga', { maxBytes });
      assert.equal(response.status, 400); assert.equal((await response.json()).error, 'INVALID_BYTE_LIMIT');
    }
    const traversal = await service.request(id, '../outside.tga');
    assert.equal(traversal.status, 400); assert.match((await traversal.json()).error, /PATH_TRAVERSAL/u);
  });
  await t.test('NodeRemoteReaderではTGAだけpreview経路、readBlob原本とPNG経路は不変', async () => {
    const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
    const calls = [];
    globalThis.window = {};
    globalThis.fetch = (input, options) => {
      const url = typeof input === 'string' && input.startsWith('/') ? service.base + input : input;
      calls.push(String(url)); return service.fetchAbsolute(url, options);
    };
    const remote = new NodeRemoteReader(metadata);
    try {
      const blob = await remote.readPreviewImageBlob('root/textures/rgba.tga');
      assert.equal(blob.type, 'image/png');
      assert.deepEqual(pngjs.PNG.sync.read(Buffer.from(await blob.arrayBuffer())).data, Buffer.from(decodeTgaPixels(good).data));
      assert(calls.some((url) => url.includes('/preview-image?')));
      assert.deepEqual(Buffer.from(await (await remote.readBlob('root/textures/rgba.tga')).arrayBuffer()), good);
      calls.length = 0;
      assert.deepEqual(Buffer.from(await (await remote.readPreviewImageBlob('root/textures/pixel.png')).arrayBuffer()), loosePng);
      assert(calls.every((url) => !url.includes('/preview-image?')));
      await assert.rejects(remote.readPreviewImageBlob('root/textures/rgba.tga', { maxBytes: 1 }), /ZIP_ENTRY_READ_LIMIT/u);
      await assert.rejects(remote.readPreviewImageBlob('root/textures/missing.tga'), /ZIP_ENTRY_NOT_FOUND/u);
      const controller = new AbortController(); controller.abort();
      await assert.rejects(remote.readPreviewImageBlob('root/textures/rgba.tga', { signal: controller.signal }), { name: 'AbortError' });
      assert.equal((await service.fetchAbsolute(service.base + '/api/node/packs/' + id, { method: 'DELETE', headers: service.headers })).status, 200);
      assert.equal((await service.request(id, 'root/textures/rgba.tga')).status, 404);
      await assert.rejects(remote.readPreviewImageBlob('root/textures/rgba.tga'), /NODE_PACK_NOT_FOUND/u);
    } finally {
      await remote.close(); globalThis.fetch = oldFetch;
      if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    }
    await assert.rejects(remote.readPreviewImageBlob('root/textures/rgba.tga'), /ZIP_CLOSED/u);
  });
});

test('実items.brarchive内の5TGAを旧RGBAとAPI変換後RGBAで完全照合', {
  skip: !process.env.JSONUI_REAL_ITEMS_ARCHIVE, timeout: 30_000,
}, async (t) => {
  const source = await readFile(process.env.JSONUI_REAL_ITEMS_ARCHIVE);
  assert.equal(sha(source), '8d68d6828cc8d5e534f106faf452296db541a9f52c0c3ebb66b4d6a385910f24');
  const count = source.readUInt32LE(8), start = 16 + count * 256, originals = [];
  for (let i = 0; i < count; i++) {
    const at = 16 + i * 256, name = source.subarray(at + 1, at + 1 + source[at]).toString('utf8');
    if (!name.endsWith('.tga')) continue;
    const offset = source.readUInt32LE(at + 248), size = source.readUInt32LE(at + 252);
    originals.push({ name, bytes: source.subarray(start + offset, start + offset + size) });
  }
  assert.equal(originals.length, 5);
  const service = await server(t), { id } = await service.upload({ 'root/__brarchive/textures/items.brarchive': source });
  const results = [];
  for (const original of originals) {
    const path = 'root/textures/items/' + original.name;
    results.push(await equalConverted(await service.request(id, path), original.bytes, original.name));
    assert.deepEqual(Buffer.from(await (await service.request(id, path, { route: 'read' })).arrayBuffer()), original.bytes);
  }
  t.diagnostic(JSON.stringify({ archiveSha256: sha(source), checkedTga: originals.length, results }));
});

test('回収v26.45の通常109TGAを旧RGBAとAPI変換後RGBAで完全照合', {
  skip: !process.env.JSONUI_REAL_TGA_DIRECTORY, timeout: 30_000,
}, async (t) => {
  const directory = process.env.JSONUI_REAL_TGA_DIRECTORY;
  const names = (await readdir(directory, { recursive: true })).filter((name) => /\.tga$/iu.test(name)).sort();
  assert.equal(names.length, 109);
  const files = {};
  for (const name of names) files['root/' + name] = await readFile(join(directory, name));
  const service = await server(t), { id } = await service.upload(files);
  const results = [];
  for (const [path, bytes] of Object.entries(files)) {
    results.push(await equalConverted(await service.request(id, path), bytes, path.slice(5)));
    assert.deepEqual(Buffer.from(await (await service.request(id, path, { route: 'read' })).arrayBuffer()), bytes);
  }
  t.diagnostic(JSON.stringify({ checkedTga: names.length, checkedPixels: results.reduce((sum, item) => sum + item.width * item.height, 0),
    originalNameAndSha256Digest: sha(Buffer.from(results.map((item) => item.name + '\0' + item.tgaSha256 + '\n').join(''))), results }));
});
