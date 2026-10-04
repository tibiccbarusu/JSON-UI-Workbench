/** Bounded loopback resource adapter for optional command-line rasterization. */
import { createHash } from 'node:crypto';
import { readRasterImageDimensions } from '../editor-core/src/assets/texture-image-cache.js';
import { resolveTextureRef, lookupPackPath } from '../editor-core/src/assets/asset-indexer.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { resolveTextureSidecarDrawState } from '../editor-core/src/preview/texture-sidecar-contract.js';
import { parseItemTextureAtlas, ITEM_TEXTURE_ATLAS_PACK_PATH, ITEM_TEXTURE_ATLAS_MAX_TEXT_BYTES } from '../editor-core/src/preview/native-renderer-preview.js';
import { resolveDefaultPlayerTexture } from '../editor-core/src/preview/native-player-default.js';
import pngjs from './vendor/pngjs/lib/png.js';
import { SMOOTH_FONT_PROFILE37 } from '../editor-core/src/preview/smooth-font37.js';

export const RASTER_LIMITS = Object.freeze({ pixels: 16 * 1024 * 1024, dimension: 8192,
  decodedBytes: 128 * 1024 * 1024, encodedBytes: 16 * 1024 * 1024,
  assets: 512, sheets: 64, boxes: 5000, textCharacters: 131072, diagnostics: 512,
  requests: 1600, durationMs: 120000 });
export function rasterError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}
const safePath = value => typeof value === 'string' && value.length <= 1024
  && !value.startsWith('/') && !value.includes('\\') && !/[\u0000-\u001f:?*<>|]/u.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');

export class FrameRasterResources {
  constructor({ client, sources, backend, locale, onProgress }) {
    if (!client || typeof client.request !== 'function' || !Array.isArray(sources)
      || sources.length < 1 || sources.length > 2 || new Set(sources.map(s => s?.kind)).size !== sources.length
      || sources.some(s => !['vanilla', 'imported'].includes(s?.kind) || !/^[a-zA-Z0-9-]{1,100}$/u.test(s.id)
        || (s.rootPrefix && (!s.rootPrefix.endsWith('/') || !safePath(s.rootPrefix.slice(0, -1)))))) {
      throw rasterError('RASTER_SOURCE_INVALID', '描画元のパック識別情報が不正です。');
    }
    this.client = client; this.sources = [...sources].sort((a, b) => (a.kind === 'imported' ? 0 : 1) - (b.kind === 'imported' ? 0 : 1));
    this.backend = backend; this.locale = locale; this.onProgress = onProgress;
    this.started = Date.now(); this.requests = 0; this.decodedBytes = 0;
    this.images = new Map(); this.sheets = new Map(); this.sidecars = new Map(); this.provenance = [];
  }
  wireSources() { return this.sources.map(({ id, kind, overrides }) => ({ id, kind, ...(overrides ? { overrides } : {}) })); }
  async request(route, options = {}) {
    const remaining = RASTER_LIMITS.durationMs - (Date.now() - this.started);
    if (remaining <= 0 || ++this.requests > RASTER_LIMITS.requests) throw rasterError('RASTER_REQUEST_LIMIT', '画像素材の取得時間または要求数が上限を超えました。');
    // The callback is observational: it cannot replace resource data or stop cleanup.
    try { this.onProgress?.({ stage: 'resource', requests: this.requests, elapsedMs: Date.now() - this.started }); } catch { /* isolated observer */ }
    return this.client.request(route, { ...options, timeout: Math.min(remaining, 30000) });
  }
  async initialize() {
    this.indexes = {};
    for (const source of this.sources) {
      const wire = await this.request(`/api/node/packs/${source.id}/assets`, { method: 'GET' });
      this.indexes[`${source.kind}Index`] = Object.fromEntries(Object.entries(wire).map(([key, value]) => [key, { ...value, byLower: new Map(value.byLower) }]));
    }
    const loadLang = async locale => {
      const data = await this.request('/api/node/lang', { payload: { sources: this.wireSources(), locale } });
      this.provenance.push({ kind: 'localization', locale, sources: data.sources,
        parsedTableSha256: createHash('sha256').update(JSON.stringify(data.table)).digest('hex') });
      return data.table;
    };
    this.lang = await loadLang(this.locale);
    this.fallbackLang = this.locale === 'en_US' ? this.lang : await loadLang('en_US');
  }
  async itemContext() {
    if (this.nativeItemContext) return this.nativeItemContext;
    const context = {};
    for (const source of this.sources) {
      const { kind } = source;
      const match = lookupPackPath(this.indexes[`${kind}Index`]?.textures, ITEM_TEXTURE_ATLAS_PACK_PATH);
      const overrides = Object.keys(source.overrides || {}).filter(p => p.toLowerCase() === ITEM_TEXTURE_ATLAS_PACK_PATH);
      if (match.collision || overrides.length > 1) throw rasterError('ITEM_TEXTURE_ATLAS_AMBIGUOUS', 'アイテムアトラスが競合しています。');
      const actual = overrides[0] || (match.found ? match.packPath : null);
      context[`${kind}Status`] = actual ? 'ready' : 'unavailable';
      if (actual) {
        const text = overrides.length ? source.overrides[actual] : (await this.read(source, actual, ITEM_TEXTURE_ATLAS_MAX_TEXT_BYTES)).toString('utf8');
        const parsed = parseItemTextureAtlas(text);
        if (!parsed.ok) throw rasterError('ITEM_TEXTURE_ATLAS_INVALID', 'アイテムアトラスを読み込めません。', { packPath: actual, code: parsed.error });
        context[`${kind}Atlas`] = parsed.atlas;
        this.provenance.push({ kind: 'item-texture-atlas', source: kind, packPath: actual, sha256: createHash('sha256').update(text).digest('hex') });
      }
      context[`${kind}Items`] = await this.request('/api/node/item-icons', { payload: { source: { id: source.id, kind, overrides: source.overrides || {} } } });
      context[`${kind}ItemsStatus`] = 'ready';
    }
    this.nativeItemContext = context;
    return context;
  }
  async read(source, packPath, maximum, converted = false) {
    if (!safePath(packPath)) throw rasterError('RASTER_ASSET_PATH_INVALID', '素材の相対パスが不正です。');
    const rawPath = `${source.rootPrefix || ''}${packPath}`;
    return this.request(`/api/node/packs/${source.id}/${converted ? 'preview-image' : 'read'}?path=${encodeURIComponent(rawPath)}&maxBytes=${maximum}`,
      { method: 'GET', binary: true, maximum });
  }
  async decode(bytes, origin) {
    // Share the browser's bounded dimension preflight before native decode.
    const mimeType = origin.mimeType || 'image/png';
    if (!Buffer.isBuffer(bytes) || bytes.length > RASTER_LIMITS.encodedBytes) throw rasterError('RASTER_IMAGE_HEADER_INVALID', '画像のサイズを検証できません。', origin);
    const dimensions = await readRasterImageDimensions(new Blob([bytes], { type: mimeType }), { maxEncodedBytes: RASTER_LIMITS.encodedBytes });
    if (!dimensions) throw rasterError(mimeType === 'image/png' ? 'RASTER_PNG_HEADER_INVALID' : 'RASTER_JPEG_HEADER_INVALID', '画像のヘッダーを検証できません。', origin);
    const { width, height } = dimensions, size = width * height * 4;
    if (!width || !height || width > RASTER_LIMITS.dimension || height > RASTER_LIMITS.dimension
      || width * height > RASTER_LIMITS.pixels || this.decodedBytes + size > RASTER_LIMITS.decodedBytes) {
      throw rasterError('RASTER_DECODE_LIMIT', '画像の展開サイズが上限を超えました。', origin);
    }
    const remaining = RASTER_LIMITS.durationMs - (Date.now() - this.started);
    if (remaining <= 0) throw rasterError('RASTER_DECODE_TIMEOUT', '画像展開前に描画の制限時間を超えました。', origin);
    this.decodedBytes += size;
    let timer;
    let image;
    try {
      image = await Promise.race([
        Promise.resolve().then(() => this.backend.loadImage(bytes)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(rasterError('RASTER_DECODE_TIMEOUT', '画像の展開が制限時間を超えました。', origin)), Math.min(30000, remaining)); }),
      ]);
    } finally { clearTimeout(timer); }
    if (image.width !== width || image.height !== height) throw rasterError('RASTER_DECODE_DIMENSIONS_CHANGED', '画像の展開寸法がヘッダーと一致しません。', origin);
    this.provenance.push({ ...origin, width, height, encodedBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    return { image, width, height };
  }
  async texture(ref, nativeSnapshot) {
    let resolved = resolveTextureRef(ref, this.indexes);
    if (nativeSnapshot) resolved = resolveDefaultPlayerTexture(resolved, ref, nativeSnapshot);
    if (!resolved?.ok || !resolved.resolved || resolved.collision) throw rasterError(resolved?.collision ? 'RASTER_TEXTURE_AMBIGUOUS' : 'RASTER_TEXTURE_MISSING', 'テクスチャを一意に解決できません。', { ref });
    const { source: kind, packPath } = resolved.resolved, key = `${kind}:${packPath}`;
    if (this.images.has(key)) return this.images.get(key);
    if (this.images.size >= RASTER_LIMITS.assets) throw rasterError('RASTER_ASSET_LIMIT', '描画素材数の上限に達しました。');
    const source = this.sources.find(s => s.kind === kind);
    const bytes = kind === 'default-player'
      ? await this.request('/editor-core/assets/native-default-player/textures/entity/steve.png', { method: 'GET', binary: true, maximum: 1379 })
      : await this.read(source, packPath, RASTER_LIMITS.encodedBytes, /\.tga$/iu.test(packPath));
    const decoded = { ...(await this.decode(bytes, { kind: 'texture', source: kind, packPath, mimeType: /\.jpe?g$/iu.test(packPath) ? 'image/jpeg' : 'image/png' })), packPath };
    this.images.set(key, decoded); return decoded;
  }
  async sidecar(packPath, metadata) {
    const wanted = packPath.replace(/\.(?:tga|png|jpe?g)$/iu, '.json');
    if (!this.sidecars.has(wanted)) {
      let record = { status: 'missing' };
      for (const source of this.sources) {
        const overrides = Object.keys(source.overrides || {}).filter(p => p.toLowerCase() === wanted.toLowerCase());
        const match = lookupPackPath(this.indexes[`${source.kind}Index`]?.textures, wanted);
        if (overrides.length > 1 || match.collision) throw rasterError('RASTER_SIDECAR_AMBIGUOUS', 'テクスチャ付属 JSON が競合しています。', { packPath: wanted });
        const actual = overrides[0] || (match.found ? match.packPath : null);
        if (!actual) continue;
        const text = overrides.length ? source.overrides[actual]
          : (await this.read(source, actual, 256 * 1024)).toString('utf8');
        if (Buffer.byteLength(text) > 256 * 1024) throw rasterError('RASTER_SIDECAR_LIMIT', 'テクスチャ付属 JSON がサイズ上限を超えました。');
        const parsed = parseJsonc(text, { filePath: actual, allowTrailingComma: true });
        if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) throw rasterError('RASTER_SIDECAR_INVALID', 'テクスチャ付属 JSON が不正です。', { packPath: actual });
        const raw = parsed.value;
        record = { status: 'ready', value: { nineSlice: raw.nineslice_size ?? null, baseSize: raw.base_size ?? null, tiled: raw.tiled ?? null } };
        this.provenance.push({ kind: 'sidecar', source: source.kind, packPath: actual, sha256: createHash('sha256').update(text).digest('hex') });
        break;
      }
      this.sidecars.set(wanted, record);
    }
    const result = resolveTextureSidecarDrawState(metadata, this.sidecars.get(wanted));
    if (result.state !== 'ready') throw rasterError(result.issue || 'RASTER_SIDECAR_INVALID', 'テクスチャ付属 JSON を適用できません。', { packPath });
    return result.metadata;
  }
  async font(sheet) {
    if (this.sheets.has(sheet)) return this.sheets.get(sheet);
    if (this.sheets.size >= RASTER_LIMITS.sheets) throw rasterError('RASTER_FONT_SHEET_LIMIT', '必要なフォントシート数が上限を超えました。');
    // Reserve failed names too, so many unavailable sheets cannot bypass limits.
    this.sheets.set(sheet, { status: 'missing' });
    let data;
    try { data = await this.request('/api/node/font', { payload: { sources: this.wireSources(), locale: this.locale, sheet }, maximum: 8 * 1024 * 1024 }); }
    catch (error) { throw rasterError(error?.code || 'RASTER_FONT_FAILED', '必要な字体シートを取得できません。', { sheet }); }
    const encoded = Buffer.from(data.png, 'base64');
    let value;
    if (/^smooth_[0-9A-F]{2}$/u.test(sheet)) {
      const dimensions = await readRasterImageDimensions(new Blob([encoded], { type: 'image/png' }), { maxEncodedBytes: RASTER_LIMITS.encodedBytes });
      if (data.metrics?.format !== 'msdf' || dimensions?.width !== 1024 || dimensions?.height !== 1024) {
        throw rasterError('FONT_SMOOTH_METRICS_INVALID', '観測された smooth 字体の寸法・形式と一致しません。', { sheet });
      }
      const { width, height } = dimensions;
      const rawBytes = width * height * 4 + SMOOTH_FONT_PROFILE37.maxCacheBytes;
      if (this.decodedBytes + rawBytes > RASTER_LIMITS.decodedBytes) throw rasterError('RASTER_FONT_PIXEL_LIMIT', '距離場の元画素が画像メモリ上限を超えました。');
      if (Date.now() - this.started >= RASTER_LIMITS.durationMs) throw rasterError('RASTER_DECODE_TIMEOUT', '距離場の展開前に制限時間を超えました。');
      this.decodedBytes += rawBytes;
      // MSDF uses RGB even at alpha zero. Avoid a premultiplied Canvas image:
      // the shared glyph painter uses original RGBA, while layout only needs
      // an image presence/dimension descriptor. No unused 4 MiB copy is kept.
      const pixels = pngjs.PNG.sync.read(encoded, { checkCRC: true });
      if (pixels.width !== width || pixels.height !== height) throw rasterError('FONT_SMOOTH_PIXELS_INVALID', '距離場の元画素寸法が一致しません。');
      value = { status: 'ready', width, height, image: { width, height }, metrics: data.metrics, pixels,
        smoothCacheMaxBytes: SMOOTH_FONT_PROFILE37.maxCacheBytes,
        createCanvas: (canvasWidth, canvasHeight) => this.backend.createCanvas(canvasWidth, canvasHeight) };
      this.provenance.push({ kind: 'font', sheet, ...data.provenance, width, height, encodedBytes: encoded.length,
        sha256: createHash('sha256').update(encoded).digest('hex'), retainedPixelBytes: rawBytes });
    } else value = { status: 'ready', ...(await this.decode(encoded, { kind: 'font', sheet, ...data.provenance })), metrics: data.metrics };
    this.sheets.set(sheet, value); return value;
  }
  async remapping() {
    if (this.smoothRemapping) return this.smoothRemapping;
    if (this.smoothRemappingError) throw this.smoothRemappingError;
    try {
      const data = await this.request('/api/node/font', { payload: { sources: this.wireSources(), locale: this.locale, sheet: 'smooth_remapping' }, maximum: 2 * 1024 * 1024 });
      if (data.kind !== 'smooth-remapping' || !Array.isArray(data.pairs) || !data.pairs.length || data.pairs.length > 65536) throw rasterError('FONT_SMOOTH_REMAPPING_INVALID', '字体の文字対応表が不正です。');
      const reservedBytes = data.pairs.length * 64 + 512;
      if (this.decodedBytes + reservedBytes > RASTER_LIMITS.decodedBytes) throw rasterError('RASTER_FONT_REMAPPING_LIMIT', '字体の文字対応表が画像メモリ上限を超えました。');
      const map = new Map();
      for (const row of data.pairs) {
        if (!Array.isArray(row) || row.length !== 2 || row.some(value => !Number.isInteger(value) || value < 0 || value > 65535 || value >= 0xd800 && value <= 0xdfff) || map.has(row[0])) {
          throw rasterError('FONT_SMOOTH_REMAPPING_INVALID', '字体の文字対応表に不正値または重複があります。');
        }
        map.set(row[0], row[1]);
      }
      this.decodedBytes += reservedBytes;
      this.provenance.push({ kind: 'font-remapping', entries: map.size, ...data.provenance, reservedBytes });
      this.smoothRemapping = map; return map;
    } catch (error) {
      this.smoothRemappingError = rasterError(error?.code || 'FONT_SMOOTH_REMAPPING_FAILED', 'smooth 字体の文字対応表を取得できません。');
      throw this.smoothRemappingError;
    }
  }
}
