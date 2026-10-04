import { isPrivateUseSheet, normalizeBitmapFontType } from './bitmap-font.js';
import { FontSheetRequestCache21 } from './font-sheet-request-cache21.js';
import { createBitmapGlyphTintCache } from './bitmap-glyph-tint26.js';

async function decodeImage(data, signal) {
  if (signal.aborted) throw new Error('FONT_LOAD_CANCELLED');
  const image = new Image();
  const abort = () => image.removeAttribute('src');
  signal.addEventListener('abort', abort, { once: true });
  try {
    image.src = `data:image/png;base64,${data.png}`;
    await image.decode();
    if (signal.aborted) throw new Error('FONT_LOAD_CANCELLED');
    return image;
  } catch (error) { image.removeAttribute('src'); throw error; }
  finally { signal.removeEventListener('abort', abort); }
}

function releaseImage(image) {
  image?.close?.();
  image?.removeAttribute?.('src');
}
function readSmoothPixels(data, image) {
  // Canvas decoders premultiply transparent RGB. MSDF distance channels must
  // use the PNG decoder's original RGBA, including RGB where alpha is zero.
  const pixels = data?.pixels, expected = 1024 * 1024 * 4;
  if (image.width !== 1024 || image.height !== 1024 || pixels?.width !== 1024 || pixels?.height !== 1024
    || pixels.encoding !== 'rgba8-base64' || typeof pixels.rgbaBase64 !== 'string'
    || pixels.rgbaBase64.length !== Math.ceil(expected / 3) * 4) throw new Error('FONT_SMOOTH_PIXELS');
  let bytes;
  try { bytes = atob(pixels.rgbaBase64); } catch { throw new Error('FONT_SMOOTH_PIXELS'); }
  if (bytes.length !== expected) throw new Error('FONT_SMOOTH_PIXELS');
  const rgba = new Uint8ClampedArray(expected);
  for (let i = 0; i < expected; i++) rgba[i] = bytes.charCodeAt(i);
  return { width: 1024, height: 1024, data: rgba };
}
function checkedSmoothRemapping(data) {
  if (data?.kind !== 'smooth-remapping' || !Array.isArray(data.pairs) || !data.pairs.length || data.pairs.length > 65536) throw new Error('FONT_SMOOTH_REMAPPING_INVALID');
  const remapping = new Map(), valid = value => Number.isInteger(value) && value >= 0 && value <= 65535 && !(value >= 0xd800 && value <= 0xdfff);
  for (const pair of data.pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(valid) || remapping.has(pair[0])) throw new Error('FONT_SMOOTH_REMAPPING_INVALID');
    remapping.set(pair[0], pair[1]);
  }
  return remapping;
}

/** Bounded asynchronous sheet cache. New-epoch sheets are not blocked by old work;
 * stale requests cannot write into a new pack's cache or prevent its loading. */
export class BitmapFontCache {
  constructor(load, onReady, onError, options = {}) {
    this.load = load; this.onReady = onReady; this.onError = onError;
    this.decodeImage = options.decodeImage || decodeImage;
    this.decodeSmoothPixels = options.decodeSmoothPixels || readSmoothPixels;
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.rows = new Map(); this.queue = []; this.pending = 0; this.epoch = 0; this.revision = 0;
    this.contextKey = null;
    this.sheetRequests = new FontSheetRequestCache21();
    this.reportedLimits = new Set();
    this.maxRows = 64; this.maxBytes = 32 * 1024 * 1024;
    this.smoothMaxBytes = 128 * 1024 * 1024; this.fontProfile = 'bitmap'; this.smoothFamilyRequested = false;
  }
  clear() {
    this.epoch++; this.revision++;
    for (const row of this.rows.values()) { row.abort?.abort(); releaseImage(row.image); }
    this.rows.clear(); this.queue.length = 0; this.reportedLimits.clear(); this.contextKey = null; this.smoothFamilyRequested = false;
    this.sheetRequests.clear();
  }
  key(sources, locale, sheet) { return `${sources.map(s => `${s.kind}:${s.id}`).join(':')}:${locale}:${sheet}`; }
  get(sources, locale, sheet) {
    const key = this.key(sources, locale, sheet), row = this.rows.get(key);
    if (row) { this.rows.delete(key); this.rows.set(key, row); }
    return row;
  }
  ensure(text, fontType, sources, locale, fontProfile = 'bitmap') {
    if (!['bitmap', 'observed-smooth'].includes(fontProfile)) throw new Error('FONT_PROFILE_INVALID');
    fontType = normalizeBitmapFontType(fontType);
    if (!sources.length || !fontType) return;
    // One preview consumes one pack composition and one locale at a time.
    // Retaining every previously selected locale exhausted the byte budget
    // before the row-count eviction ran, leaving new kanji permanently missing.
    // clear() aborts old work; its epoch checks also reject late loaders which
    // ignore AbortSignal, so old results cannot re-enter this composition.
    const contextKey = JSON.stringify([sources.map(source => [source.kind, source.id]), locale, fontProfile]);
    if (this.contextKey !== contextKey) {
      this.clear(); this.contextKey = contextKey; this.fontProfile = fontProfile;
    }
    if (fontType === 'smooth') this.smoothFamilyRequested = true;
    const remapping = fontType === 'smooth' ? this.get(sources, locale, 'smooth_remapping') : null;
    const sheets = fontType === 'smooth' && remapping?.status !== 'ready'
      ? ['smooth_remapping'] : this.sheetRequests.getSheets(text, fontType, remapping?.remapping);
    for (const sheet of sheets) {
      const key = this.key(sources, locale, sheet);
      if (this.rows.has(key)) continue;
      if (this.rows.size >= this.maxRows) {
        const victim = [...this.rows].find(([, row]) => row.status !== 'loading' && row.status !== 'queued' && !sheets.includes(row.sheet) && row.sheet !== 'smooth_remapping');
        if (!victim) {
          if (!this.reportedLimits.has(key)) {
            this.reportedLimits.add(key); this.onError(new Error('FONT_CACHE_SHEET_LIMIT'), sheet);
          }
          break;
        }
        releaseImage(victim[1].image); this.rows.delete(victim[0]); this.revision++;
      }
      const row = { status: 'queued', sheet, key, epoch: this.epoch, sources: sources.map(source => ({ ...source })), locale, attempts: 0, fontProfile };
      this.rows.set(key, row); this.queue.push(row);
    }
    this.pump();
  }
  retryFailures() {
    // Recovery is explicit. Invalid resources and a stopped server must not
    // trigger a fetch/redraw loop; ready glyphs keep their image identity.
    const failures = [...this.rows.values()].filter(row => row.status === 'missing');
    if (failures.some(row => row.errorCode === 'FONT_CACHE_BYTE_LIMIT')) {
      // Browsing many screens in one locale can also retain old sheets until
      // this budget fills. An explicit retry releases them once; the caller's
      // next layout/draw requests just the current view. A view larger than the
      // entire budget still fails visibly, without an eviction/refetch loop.
      this.clear(); return failures.length;
    }
    let count = 0;
    for (const row of failures) {
      row.status = 'queued'; row.errorCode = null;
      this.queue.push(row); count++;
    }
    if (count) { this.revision++; this.reportedLimits.clear(); this.pump(); }
    return count;
  }
  pump() {
    while (this.pending < 2 && this.queue.length) {
      const row = this.queue.shift();
      if (row.epoch !== this.epoch || this.rows.get(row.key) !== row) continue;
      this.pending++; row.status = 'loading'; row.attempts++; row.abort = new AbortController();
      this.loadRow(row).finally(() => {
        this.pending--; this.pump();
        // Also refresh after an obsolete request: it may have occupied the last slot.
        this.onReady();
      });
    }
  }
  async loadRow(row) {
    const controller = row.abort; // A retry owns a different controller on the same row.
    let timer, abortListener, timedOut = false;
    try {
      const cancelled = new Promise((_, reject) => {
        abortListener = () => reject(new Error(timedOut ? 'FONT_LOAD_TIMEOUT' : 'FONT_LOAD_CANCELLED'));
        controller.signal.addEventListener('abort', abortListener, { once: true });
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      });
      const loaded = (async () => {
        const data = await this.load({ sources: row.sources, locale: row.locale, sheet: row.sheet,
          ...(/^smooth_[0-9A-F]{2}$/u.test(row.sheet) ? { includePixels: true } : {}) }, controller.signal);
        // A loader may ignore AbortSignal and finish after a pack switch.
        // Reject it before starting a now-unnecessary browser image decode.
        if (controller.signal.aborted || row.epoch !== this.epoch || this.rows.get(row.key) !== row) {
          throw new Error('FONT_LOAD_CANCELLED');
        }
        if (row.sheet === 'smooth_remapping') return { data, image: null };
        if (/^smooth_[0-9A-F]{2}$/u.test(row.sheet) && data.metrics?.format === 'msdf') {
          // Smooth drawing reads raw RGBA only. Retaining a decoded PNG atlas
          // would waste a second 4 MiB copy and corrupt transparent RGB if used.
          return { data, image: { width: data.metrics.width, height: data.metrics.height } };
        }
        const image = await this.decodeImage(data, controller.signal);
        if (controller.signal.aborted || row.epoch !== this.epoch) { releaseImage(image); throw new Error('FONT_LOAD_CANCELLED'); }
        return { data, image };
      })();
      const { data, image } = await Promise.race([loaded, cancelled]);
      if (row.epoch !== this.epoch || this.rows.get(row.key) !== row) { releaseImage(image); return; }
      if (row.sheet === 'smooth_remapping') {
        const remapping = checkedSmoothRemapping(data), bytes = remapping.size * 64 + 512;
        const total = [...this.rows.values()].reduce((sum, item) => sum + (item.bytes || 0), 0);
        if (total + bytes > this.smoothMaxBytes) throw new Error('FONT_CACHE_BYTE_LIMIT');
        Object.assign(row, { status: 'ready', bytes, remapping, provenance: data.provenance });
        this.revision++; return;
      }
      const smooth = data.metrics?.format === 'msdf';
      const smoothSheet = /^smooth_[0-9A-F]{2}$/u.test(row.sheet);
      if (smoothSheet !== smooth || (smooth && (image.width !== 1024 || image.height !== 1024))) { releaseImage(image); throw new Error('FONT_SMOOTH_PROFILE_INVALID'); }
      const bytes = smooth ? image.width * image.height * 4 + 512 * 1024 : image.width * image.height * 4 * 5;
      const total = [...this.rows.values()].reduce((sum, item) => sum + (item.bytes || 0), 0);
      // Retain an explicit failure until pack reset instead of evict/refetch loops.
      const byteLimit = this.smoothFamilyRequested ? this.smoothMaxBytes : this.maxBytes;
      if (!Number.isSafeInteger(bytes) || bytes < 0 || total + bytes > byteLimit) {
        releaseImage(image); throw new Error('FONT_CACHE_BYTE_LIMIT');
      }
      if (smooth) {
        let pixels;
        try { pixels = this.decodeSmoothPixels(data, image); }
        catch (error) { releaseImage(image); throw error; }
        if (pixels?.width !== image.width || pixels?.height !== image.height || pixels?.data?.length !== image.width * image.height * 4) { releaseImage(image); throw new Error('FONT_SMOOTH_PIXELS'); }
        Object.assign(row, { status: 'ready', bytes, metrics: data.metrics, image, pixels, provenance: data.provenance,
          smoothCacheMaxBytes: 512 * 1024,
          createCanvas: (width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; } });
        this.revision++; return;
      }
      const colors = new Map();
      const glyphTints = createBitmapGlyphTintCache(image, (width, height) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
      });
      Object.assign(row, { status: 'ready', bytes, metrics: data.metrics, image, provenance: data.provenance,
        tintedGlyph: isPrivateUseSheet(row.sheet) ? null : (color, glyph) => {
          if (colors.size >= 4) colors.delete(colors.keys().next().value);
          return glyphTints.get(color, glyph);
        },
        glyphTintStats: glyphTints.snapshot,
        tinted: color => {
          if (isPrivateUseSheet(row.sheet)) return image;
          if (colors.has(color)) return colors.get(color);
          // Share the original four-atlas reservation. Italic-only labels
          // retain all four old colour slots; mixed text makes room for cells.
          if (colors.size >= 4) colors.delete(colors.keys().next().value);
          if (colors.size === 3 && glyphTints.snapshot().entries) glyphTints.clear();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return image;
          ctx.drawImage(image, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color;
          ctx.fillRect(0, 0, canvas.width, canvas.height); colors.set(color, canvas); return canvas;
        },
      });
      this.revision++;
    } catch (error) {
      if (row.epoch === this.epoch && this.rows.get(row.key) === row) {
        row.status = 'missing'; row.errorCode = error instanceof Error ? error.message : 'FONT_LOAD_FAILED';
        this.revision++;
        this.onError(error, row.sheet);
      }
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', abortListener);
    }
  }
  stats() {
    const states = { queued: 0, loading: 0, ready: 0, missing: 0 };
    let bytes = 0;
    for (const row of this.rows.values()) { states[row.status]++; bytes += row.bytes || 0; }
    return { epoch: this.epoch, revision: this.revision, entries: this.rows.size, pending: this.pending, bytes,
      fontProfile: this.fontProfile, smoothFamilyRequested: this.smoothFamilyRequested, maxBytes: this.smoothFamilyRequested ? this.smoothMaxBytes : this.maxBytes,
      ...states, sheetRequests: this.sheetRequests.stats() };
  }
  snapshot() {
    // No label text, PNG bytes or browser image objects enter debug bundles.
    // The cache itself is bounded to 64 rows; each sheet has exactly 256 cells.
    return { ...this.stats(), sheets: [...this.rows.values()].map(row => ({
      sheet: row.sheet, locale: row.locale, status: row.status,
      attempts: row.attempts,
      errorCode: row.errorCode || null,
      width: row.metrics?.width || null, height: row.metrics?.height || null,
      metricsProfile: row.metrics?.metricsProfile || null,
      glyphTint: row.glyphTintStats?.() || null,
      emptyGlyphCells: row.metrics?.glyphs?.filter(glyph => glyph.empty).map(glyph => glyph.cell) || [],
      provenance: row.provenance || null,
    })) };
  }
}
