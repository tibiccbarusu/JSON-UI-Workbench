/*
  texture-image-cache.js (S041)

  Decode and cache texture images for <image> elements in the canvas preview.

  This module intentionally focuses on:
  - decoding Bedrock raster blobs safely (size guard before decode)
  - bounding decoded-pixel memory via an LRU cache
  - bounding and deduplicating in-flight/queued decode requests

  Resolution policy (imported vs vanilla) is handled by caller code.

  Limits are aligned to SPEC/nonfunctional.md.
*/

/**
 * Hard limits for a single decoded image.
 *
 * NOTE: These values mirror SPEC/nonfunctional.md (S004).
 */
export const DEFAULT_IMAGE_DECODE_LIMITS = Object.freeze({
  // 4096x4096
  maxPixels: 16_777_216,
  // ~64 MiB RGBA
  maxDecodedBytes: 67_108_864,
});

/**
 * Default cache budgets (decoded pixel bytes).
 *
 * NOTE: Mirrors SPEC/nonfunctional.md budgets.
 */
export const DEFAULT_IMAGE_CACHE_BUDGETS = Object.freeze({
  desktopMaxDecodedBytesTotal: 268_435_456, // 256 MiB
  mobileMaxDecodedBytesTotal: 134_217_728, // 128 MiB
});

/**
 * @typedef {{
 *  key: string,
 *  image: CanvasImageSource,
 *  width: number,
 *  height: number,
 *  decodedBytes: number,
 *  createdAtMs: number,
 * }} TextureImageCacheEntry
 */

/**
 * @typedef {{
 *  maxEntries?: number,
 *  maxDecodedBytesTotal?: number,
 *  negativeTtlMs?: number,
 *  maxNegativeEntries?: number,
 *  preferImageBitmap?: boolean,
 *  perImageMaxPixels?: number,
 *  perImageMaxDecodedBytes?: number,
 *  maxConcurrentDecodes?: number,
 *  maxInflightDecodedBytes?: number,
 *  maxInflightRequests?: number,
 *  loadTimeoutMs?: number,
 * }} TextureImageCacheOptions
 */

/**
 * @typedef {{
 *  code: string,
 *  message: string,
 *  atMs: number,
 *  reservationBytes?: number,
 *  reservationSensitive?: boolean,
 * }} NegativeCacheEntry
 */

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Try to read PNG IHDR width/height from the first 24 bytes of the file.
 *
 * This allows rejecting huge images before decode.
 *
 * @param {Blob} blob
 * @returns {Promise<null | { width: number, height: number }>}
 */
async function tryReadPngSize(blob) {
  const b = blob;
  if (!b || typeof b.size !== 'number') return null;
  if (b.size < 24) return null;

  let buf;
  try {
    buf = await b.slice(0, 24).arrayBuffer();
  } catch {
    return null;
  }

  const u8 = new Uint8Array(buf);
  if (u8.length < 24) return null;

  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (u8[i] !== PNG_SIGNATURE[i]) return null;
  }

  // Chunk type at 12..15 must be IHDR
  if (u8[12] !== 0x49 || u8[13] !== 0x48 || u8[14] !== 0x44 || u8[15] !== 0x52) {
    return null;
  }

  const dv = new DataView(buf);
  const width = dv.getUint32(16, false);
  const height = dv.getUint32(20, false);

  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;

  return { width, height };
}

const JPEG_PREFLIGHT_CHUNK_BYTES = 64 * 1024;
const JPEG_PREFLIGHT_MAX_SEGMENTS = 32_768;
const JPEG_PREFLIGHT_MAX_BYTE_READS = 262_144;
const JPEG_PREFLIGHT_MAX_MARKER_FILL_BYTES = 4_096;

function createImageAbortError() {
  const error = new Error('IMAGE_CACHE_ABORTED');
  error.name = 'AbortError';
  return error;
}

function throwIfImageAborted(signal) {
  if (signal && signal.aborted) throw createImageAbortError();
}

function closeImageSourceIfNeeded(image) {
  if (image && typeof image === 'object' && typeof image.close === 'function') {
    try {
      image.close();
    } catch {
      // ignore
    }
  }
}

/** Bound host promises as well as cooperative loaders; late images remain owned here. */
function runImageWorkWithDeadline(work, { signal, timeoutMs, timeoutCode }) {
  if (signal?.aborted) return Promise.reject(createImageAbortError());
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const stop = error => {
      // Settle before notifying work, so its cooperative abort cannot mask timeout.
      finish(reject, error);
      controller.abort(error);
    };
    const onAbort = () => stop(createImageAbortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    timer = setTimeout(() => stop(Object.assign(new Error(timeoutCode), {
      name: 'TimeoutError', code: timeoutCode,
    })), timeoutMs);
    // Host decoders need not implement cancellation. Keep the terminal handlers
    // after timeout/abort to close late results and consume late rejections.
    Promise.resolve().then(() => {
      throwIfImageAborted(controller.signal);
      return work(controller.signal);
    }).then(result => {
      if (settled) { closeImageSourceIfNeeded(result?.image); return; }
      finish(resolve, result);
    }, error => finish(reject, error));
  });
}

/**
 * Read JPEG marker headers in bounded windows. Segment payloads are skipped by
 * offset, so a legal SOF marker may appear anywhere in the allowed Blob without
 * copying the whole encoded file into memory.
 *
 * @param {Blob} blob
 * @param {number} maxScanBytes
 * @param {AbortSignal|undefined} signal
 */
async function tryReadJpegSize(blob, maxScanBytes, signal) {
  throwIfImageAborted(signal);
  if (!blob || typeof blob.size !== 'number' || blob.size < 4) return null;
  const scanLimit = Math.min(blob.size, Math.max(4, Math.floor(Number(maxScanBytes) || 0)));
  if (scanLimit < 4) return null;

  let windowStart = -1;
  let windowBytes = new Uint8Array(0);
  let byteReadWork = 0;
  const byteAt = async (offset) => {
    throwIfImageAborted(signal);
    byteReadWork += 1;
    if (byteReadWork > JPEG_PREFLIGHT_MAX_BYTE_READS) return null;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= scanLimit) return null;
    if (offset < windowStart || offset >= windowStart + windowBytes.length) {
      windowStart = offset;
      try {
        windowBytes = new Uint8Array(await blob
          .slice(windowStart, Math.min(scanLimit, windowStart + JPEG_PREFLIGHT_CHUNK_BYTES))
          .arrayBuffer());
      } catch {
        windowBytes = new Uint8Array(0);
      }
    }
    const index = offset - windowStart;
    return index >= 0 && index < windowBytes.length ? windowBytes[index] : null;
  };

  if (await byteAt(0) !== 0xff || await byteAt(1) !== 0xd8) return null;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  let segmentCount = 0;
  while (offset + 3 < scanLimit && segmentCount < JPEG_PREFLIGHT_MAX_SEGMENTS) {
    // Outside entropy-coded scan data, a JPEG segment must begin at the
    // current offset. Reject junk immediately instead of linearly scanning an
    // attacker-controlled Blob byte by byte.
    if (await byteAt(offset) !== 0xff) return null;
    let markerFillBytes = 0;
    while (offset < scanLimit && await byteAt(offset) === 0xff) {
      offset += 1;
      markerFillBytes += 1;
      if (markerFillBytes > JPEG_PREFLIGHT_MAX_MARKER_FILL_BYTES) return null;
    }
    if (offset >= scanLimit) return null;
    const marker = await byteAt(offset++);
    segmentCount += 1;
    if (marker === null || marker === 0x00 || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    const lengthHigh = await byteAt(offset);
    const lengthLow = await byteAt(offset + 1);
    if (lengthHigh === null || lengthLow === null) return null;
    const segmentLength = (lengthHigh << 8) | lengthLow;
    if (segmentLength < 2 || offset + segmentLength > scanLimit) return null;
    if (sofMarkers.has(marker)) {
      if (segmentLength < 11) return null;
      const componentCount = await byteAt(offset + 7);
      if (!componentCount || segmentLength !== 8 + 3 * componentCount) return null;
      const heightHigh = await byteAt(offset + 3);
      const heightLow = await byteAt(offset + 4);
      const widthHigh = await byteAt(offset + 5);
      const widthLow = await byteAt(offset + 6);
      if ([heightHigh, heightLow, widthHigh, widthLow].some((value) => value === null)) return null;
      const height = (heightHigh << 8) | heightLow;
      const width = (widthHigh << 8) | widthLow;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

const TGA_2_FOOTER_BYTES = 26;
const TGA_2_EXTENSION_BYTES = 495;
const TGA_2_FOOTER_SIGNATURE = Object.freeze([
  0x54, 0x52, 0x55, 0x45, 0x56, 0x49, 0x53, 0x49,
  0x4f, 0x4e, 0x2d, 0x58, 0x46, 0x49, 0x4c, 0x45,
  0x2e, 0x00,
]);

function readTga2Metadata(bytes) {
  if (bytes.length < TGA_2_FOOTER_BYTES) {
    return { isTga2: false, dataLimit: bytes.length, extensionOffset: 0, developerOffset: 0, attributesType: null };
  }
  const footerStart = bytes.length - TGA_2_FOOTER_BYTES;
  for (let index = 0; index < 16; index += 1) {
    if (bytes[footerStart + 8 + index] !== TGA_2_FOOTER_SIGNATURE[index]) {
      return { isTga2: false, dataLimit: bytes.length, extensionOffset: 0, developerOffset: 0, attributesType: null };
    }
  }
  if (bytes[footerStart + 24] !== TGA_2_FOOTER_SIGNATURE[16]
    || bytes[footerStart + 25] !== TGA_2_FOOTER_SIGNATURE[17]) {
    throw new Error('TGA_DECODE_INVALID_FOOTER');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const extensionOffset = view.getUint32(footerStart, true);
  const developerOffset = view.getUint32(footerStart + 4, true);
  if (developerOffset !== 0 && (developerOffset < 18 || developerOffset >= footerStart)) {
    throw new Error('TGA_DECODE_INVALID_EXTENSION');
  }
  if (extensionOffset === 0) {
    return { isTga2: true, dataLimit: footerStart, extensionOffset, developerOffset, attributesType: null };
  }
  if (extensionOffset < 18 || extensionOffset + 2 > footerStart) {
    throw new Error('TGA_DECODE_INVALID_EXTENSION');
  }
  const extensionSize = view.getUint16(extensionOffset, true);
  if (extensionSize !== TGA_2_EXTENSION_BYTES || extensionOffset + extensionSize > footerStart) {
    throw new Error('TGA_DECODE_INVALID_EXTENSION');
  }
  const attributesType = bytes[extensionOffset + TGA_2_EXTENSION_BYTES - 1];
  if (attributesType > 4) throw new Error('TGA_DECODE_ATTRIBUTE_TYPE_UNSUPPORTED');
  return { isTga2: true, dataLimit: footerStart, extensionOffset, developerOffset, attributesType };
}

/**
 * Decode the bounded TGA subset used by Bedrock resource packs. Palette and
 * interleaved files are rejected explicitly; true-colour/grayscale raw and
 * RLE images are decoded with exact packet and output bounds.
 *
 * @param {ArrayBuffer|Uint8Array} input
 * @param {{ maxPixels?:number, maxDecodedBytes?:number }} [options]
 */
export function decodeTgaPixels(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.byteLength < 18) throw new Error('TGA_DECODE_INVALID_HEADER');
  const tga2 = readTga2Metadata(bytes);
  const maxPixels = Number.isFinite(options.maxPixels)
    ? Math.max(1, Number(options.maxPixels))
    : DEFAULT_IMAGE_DECODE_LIMITS.maxPixels;
  const maxDecodedBytes = Number.isFinite(options.maxDecodedBytes)
    ? Math.max(1, Number(options.maxDecodedBytes))
    : DEFAULT_IMAGE_DECODE_LIMITS.maxDecodedBytes;
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const imageType = bytes[2];
  if (colorMapType !== 0) throw new Error('TGA_DECODE_COLOR_MAP_UNSUPPORTED');
  const trueColor = imageType === 2 || imageType === 10;
  const grayscale = imageType === 3 || imageType === 11;
  const rle = imageType === 10 || imageType === 11;
  if (!trueColor && !grayscale) throw new Error('TGA_DECODE_IMAGE_TYPE_UNSUPPORTED');
  const width = bytes[12] | (bytes[13] << 8);
  const height = bytes[14] | (bytes[15] << 8);
  const bitsPerPixel = bytes[16];
  const descriptor = bytes[17];
  if (!width || !height) throw new Error('TGA_DECODE_INVALID_DIMENSIONS');
  const pixels = width * height;
  const decodedBytes = pixels * 4;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) throw new Error('IMAGE_DECODE_TOO_MANY_PIXELS');
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > maxDecodedBytes) throw new Error('IMAGE_DECODE_TOO_LARGE');
  if (descriptor & 0xc0) throw new Error('TGA_DECODE_INTERLEAVE_UNSUPPORTED');
  if (trueColor && ![16, 24, 32].includes(bitsPerPixel)) throw new Error('TGA_DECODE_PIXEL_DEPTH_UNSUPPORTED');
  if (grayscale && ![8, 16].includes(bitsPerPixel)) throw new Error('TGA_DECODE_PIXEL_DEPTH_UNSUPPORTED');
  const bytesPerPixel = bitsPerPixel / 8;
  let offset = 18 + idLength;
  if (offset > tga2.dataLimit) throw new Error('TGA_DECODE_TRUNCATED');

  // Validate the complete encoded payload before allocating the RGBA output.
  // A hostile 18-byte header must not be able to force a 64 MiB allocation.
  let imageDataEnd = offset;
  if (!rle) {
    const payloadBytes = pixels * bytesPerPixel;
    if (!Number.isSafeInteger(payloadBytes) || offset + payloadBytes > tga2.dataLimit) {
      throw new Error('TGA_DECODE_TRUNCATED');
    }
    imageDataEnd = offset + payloadBytes;
  } else {
    let scanOffset = offset;
    let scanWritten = 0;
    while (scanWritten < pixels) {
      if (scanOffset >= tga2.dataLimit) throw new Error('TGA_DECODE_TRUNCATED');
      const packet = bytes[scanOffset++];
      const count = (packet & 0x7f) + 1;
      if (scanWritten + count > pixels) throw new Error('TGA_DECODE_PACKET_OVERFLOW');
      const encodedPixelCount = packet & 0x80 ? 1 : count;
      const packetBytes = encodedPixelCount * bytesPerPixel;
      if (!Number.isSafeInteger(packetBytes) || scanOffset + packetBytes > tga2.dataLimit) {
        throw new Error('TGA_DECODE_TRUNCATED');
      }
      scanOffset += packetBytes;
      scanWritten += count;
    }
    imageDataEnd = scanOffset;
  }
  if ((tga2.extensionOffset && tga2.extensionOffset < imageDataEnd)
    || (tga2.developerOffset && tga2.developerOffset < imageDataEnd)) {
    throw new Error('TGA_DECODE_INVALID_EXTENSION');
  }

  const topOrigin = Boolean(descriptor & 0x20);
  const rightOrigin = Boolean(descriptor & 0x10);
  const alphaBits = descriptor & 0x0f;
  const hasStoredAlpha = (trueColor && (bitsPerPixel === 16 || bitsPerPixel === 32))
    || (grayscale && bitsPerPixel === 16);
  const expectedAlphaBits = trueColor && bitsPerPixel === 16 ? 1 : hasStoredAlpha ? 8 : 0;
  if (tga2.attributesType !== null
    && tga2.attributesType >= 2
    && (!hasStoredAlpha || alphaBits !== expectedAlphaBits)) {
    throw new Error('TGA_DECODE_INVALID_EXTENSION');
  }
  const useStoredAlpha = tga2.attributesType === null
    ? alphaBits > 0
    : tga2.attributesType >= 2;
  const premultipliedAlpha = tga2.attributesType === 4;
  const output = new Uint8ClampedArray(decodedBytes);
  // Reused for every source pixel. Allocating a JS array for each of up to
  // 16.7 million pixels causes avoidable GC pressure and long UI stalls.
  const rgba = new Uint8ClampedArray(4);

  const readPixel = () => {
    if (offset + bytesPerPixel > tga2.dataLimit) throw new Error('TGA_DECODE_TRUNCATED');
    if (grayscale) {
      rgba[0] = bytes[offset];
      rgba[1] = bytes[offset];
      rgba[2] = bytes[offset];
      rgba[3] = bitsPerPixel === 16 && useStoredAlpha ? bytes[offset + 1] : 255;
    } else if (bitsPerPixel === 16) {
      const value = bytes[offset] | (bytes[offset + 1] << 8);
      rgba[0] = Math.round(((value >> 10) & 0x1f) * 255 / 31);
      rgba[1] = Math.round(((value >> 5) & 0x1f) * 255 / 31);
      rgba[2] = Math.round((value & 0x1f) * 255 / 31);
      rgba[3] = useStoredAlpha ? ((value & 0x8000) ? 255 : 0) : 255;
    } else {
      rgba[0] = bytes[offset + 2];
      rgba[1] = bytes[offset + 1];
      rgba[2] = bytes[offset];
      rgba[3] = bitsPerPixel === 32 && useStoredAlpha ? bytes[offset + 3] : 255;
    }
    if (premultipliedAlpha && rgba[3] < 255) {
      if (rgba[3] === 0) {
        rgba[0] = 0;
        rgba[1] = 0;
        rgba[2] = 0;
      } else {
        rgba[0] = Math.min(255, Math.round(rgba[0] * 255 / rgba[3]));
        rgba[1] = Math.min(255, Math.round(rgba[1] * 255 / rgba[3]));
        rgba[2] = Math.min(255, Math.round(rgba[2] * 255 / rgba[3]));
      }
    }
    offset += bytesPerPixel;
    return rgba;
  };
  const writePixel = (sourceIndex, rgba) => {
    const sourceY = Math.floor(sourceIndex / width);
    const sourceX = sourceIndex % width;
    const x = rightOrigin ? width - 1 - sourceX : sourceX;
    const y = topOrigin ? sourceY : height - 1 - sourceY;
    const destination = (y * width + x) * 4;
    output[destination] = rgba[0];
    output[destination + 1] = rgba[1];
    output[destination + 2] = rgba[2];
    output[destination + 3] = rgba[3];
  };

  let written = 0;
  if (!rle) {
    while (written < pixels) writePixel(written++, readPixel());
  } else {
    while (written < pixels) {
      if (offset >= tga2.dataLimit) throw new Error('TGA_DECODE_TRUNCATED');
      const packet = bytes[offset++];
      const count = (packet & 0x7f) + 1;
      if (written + count > pixels) throw new Error('TGA_DECODE_PACKET_OVERFLOW');
      if (packet & 0x80) {
        const rgba = readPixel();
        for (let index = 0; index < count; index += 1) writePixel(written++, rgba);
      } else {
        for (let index = 0; index < count; index += 1) writePixel(written++, readPixel());
      }
    }
  }
  return { data: output, width, height, decodedBytes };
}

async function createRgbaCanvasImageSource(decoded, preferImageBitmap, signal) {
  throwIfImageAborted(signal);
  let canvas = null;
  if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(decoded.width, decoded.height);
  else if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
    canvas = document.createElement('canvas');
    canvas.width = decoded.width;
    canvas.height = decoded.height;
  }
  if (!canvas) throw new Error('TGA_DECODE_CANVAS_UNAVAILABLE');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('TGA_DECODE_CANVAS_UNAVAILABLE');
  const imageData = context.createImageData(decoded.width, decoded.height);
  imageData.data.set(decoded.data);
  context.putImageData(imageData, 0, 0);
  throwIfImageAborted(signal);
  if (preferImageBitmap && typeof createImageBitmap === 'function') {
    const image = await createImageBitmap(canvas);
    if (signal && signal.aborted) {
      closeImageSourceIfNeeded(image);
      throw createImageAbortError();
    }
    return image;
  }
  return canvas;
}

/**
 * @param {number} width
 * @param {number} height
 */
function estimateDecodedBytes(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 0;
  // RGBA8
  return Math.round(w * h * 4);
}

/**
 * Decode an image Blob into an ImageBitmap (preferred) or HTMLImageElement.
 *
 * The caller must ensure the Blob is from a safe source (ZIP read / allowlist).
 *
 * @param {Blob} blob
 * @param {{ maxPixels?: number, maxDecodedBytes?: number, maxEncodedBytes?: number, preferImageBitmap?: boolean, signal?:AbortSignal, decodeTimeoutMs?:number }} [options]
 * @returns {Promise<{ image: CanvasImageSource, width: number, height: number, decodedBytes: number }>}
 */
export async function readRasterImageDimensions(blob, { maxEncodedBytes = 16 * 1024 * 1024, signal } = {}) {
  if (!blob || !Number.isFinite(blob.size) || blob.size > maxEncodedBytes) return null;
  const mimeType = String(blob.type || '').toLowerCase();
  return mimeType === 'image/jpeg' || mimeType === 'image/jpg'
    ? tryReadJpegSize(blob, maxEncodedBytes, signal)
    : mimeType === 'image/png' ? tryReadPngSize(blob) : null;
}

export async function decodeImageFromBlob(blob, options = {}) {
  const timeoutMs = Number.isFinite(options.decodeTimeoutMs)
    ? Math.max(1, Math.min(30_000, Math.floor(options.decodeTimeoutMs))) : 30_000;
  return runImageWorkWithDeadline(signal => decodeImageFromBlobWithinDeadline(blob, { ...options, signal }), {
    signal: options.signal, timeoutMs, timeoutCode: 'IMAGE_DECODE_TIMEOUT',
  });
}

async function decodeImageFromBlobWithinDeadline(blob, options) {
  const signal = options.signal;
  throwIfImageAborted(signal);
  const maxPixels = Number.isFinite(options.maxPixels)
    ? Math.max(1, Number(options.maxPixels))
    : DEFAULT_IMAGE_DECODE_LIMITS.maxPixels;
  const maxDecodedBytes = Number.isFinite(options.maxDecodedBytes)
    ? Math.max(1, Number(options.maxDecodedBytes))
    : DEFAULT_IMAGE_DECODE_LIMITS.maxDecodedBytes;
  const maxEncodedBytes = Number.isFinite(options.maxEncodedBytes)
    ? Math.max(1, Number(options.maxEncodedBytes))
    : maxDecodedBytes + 1024 * 1024;
  const preferImageBitmap = options.preferImageBitmap !== false;

  const b = blob;
  if (!b) throw new Error('IMAGE_DECODE_MISSING_BLOB');
  if (typeof b.size === 'number' && b.size > maxEncodedBytes) throw new Error('IMAGE_DECODE_TOO_LARGE');

  const mimeType = typeof b.type === 'string' ? b.type.toLowerCase() : '';
  if (mimeType === 'image/x-tga' || mimeType === 'image/tga') {
    const input = await b.arrayBuffer();
    throwIfImageAborted(signal);
    const decoded = decodeTgaPixels(input, { maxPixels, maxDecodedBytes });
    throwIfImageAborted(signal);
    const image = await createRgbaCanvasImageSource(decoded, preferImageBitmap, signal);
    return { image, width: decoded.width, height: decoded.height, decodedBytes: decoded.decodedBytes };
  }

  // Pre-check raster dimensions before browser decode whenever supported.
  const isJpeg = mimeType === 'image/jpeg' || mimeType === 'image/jpg';
  const isPng = mimeType === 'image/png';
  const size = (isJpeg || isPng)
    ? await readRasterImageDimensions(b, { maxEncodedBytes, signal })
    : await tryReadPngSize(b);
  throwIfImageAborted(signal);
  // The production caller assigns MIME from the pack-path extension. Requiring
  // a valid header prevents a differently encoded, oversized image hidden
  // behind .png/.jpg from reaching a browser decoder without preflight.
  if ((isJpeg || isPng) && !size) {
    throw new Error('IMAGE_DECODE_DIMENSIONS_UNAVAILABLE');
  }
  if (size) {
    const pixels = Number(size.width) * Number(size.height);
    const decodedBytes = estimateDecodedBytes(size.width, size.height);

    if (!Number.isFinite(pixels) || pixels <= 0) {
      throw new Error('IMAGE_DECODE_INVALID_DIMENSIONS');
    }
    if (pixels > maxPixels) {
      throw new Error('IMAGE_DECODE_TOO_MANY_PIXELS');
    }
    if (decodedBytes > maxDecodedBytes) {
      throw new Error('IMAGE_DECODE_TOO_LARGE');
    }
  }

  // Decode: ImageBitmap first.
  if (preferImageBitmap && typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(b);
    if (signal && signal.aborted) {
      closeImageSourceIfNeeded(bmp);
      throw createImageAbortError();
    }
    const width = Number(bmp.width) || 0;
    const height = Number(bmp.height) || 0;
    const decodedBytes = estimateDecodedBytes(width, height);

    if (!width || !height) {
      try {
        bmp.close();
      } catch {
        // ignore
      }
      throw new Error('IMAGE_DECODE_INVALID_DIMENSIONS');
    }
    if (width * height > maxPixels) {
      try {
        bmp.close();
      } catch {
        // ignore
      }
      throw new Error('IMAGE_DECODE_TOO_MANY_PIXELS');
    }
    if (decodedBytes > maxDecodedBytes) {
      try {
        bmp.close();
      } catch {
        // ignore
      }
      throw new Error('IMAGE_DECODE_TOO_LARGE');
    }

    return { image: bmp, width, height, decodedBytes };
  }

  // Fallback: HTMLImageElement.
  const url = URL.createObjectURL(b);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      let settled = false;
      const cleanup = () => {
        el.onload = null;
        el.onerror = null;
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onAbort = () => {
        finish(reject, createImageAbortError());
        try {
          el.src = '';
        } catch {
          // ignore
        }
      };
      try {
        el.decoding = 'async';
      } catch {
        // ignore
      }

      el.onload = () => finish(resolve, el);
      el.onerror = () => finish(reject, new Error('IMAGE_DECODE_FAILED'));
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      if (signal && signal.aborted) {
        onAbort();
        return;
      }
      el.src = url;
    });
    throwIfImageAborted(signal);

    const width = Number(img.naturalWidth) || 0;
    const height = Number(img.naturalHeight) || 0;
    const decodedBytes = estimateDecodedBytes(width, height);

    if (!width || !height) throw new Error('IMAGE_DECODE_INVALID_DIMENSIONS');
    if (width * height > maxPixels) throw new Error('IMAGE_DECODE_TOO_MANY_PIXELS');
    if (decodedBytes > maxDecodedBytes) throw new Error('IMAGE_DECODE_TOO_LARGE');

    return { image: img, width, height, decodedBytes };
  } finally {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}

/**
 * Create a bounded LRU cache for decoded images.
 *
 * The cache stores decoded images (ImageBitmap/HTMLImageElement), not raw blobs.
 * It is the caller's responsibility to feed it safe Blobs.
 *
 * @param {TextureImageCacheOptions} [options]
 */
export function createTextureImageCache(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, Math.floor(Number(options.maxEntries))) : 512;
  const maxDecodedBytesTotal = Number.isFinite(options.maxDecodedBytesTotal)
    ? Math.max(1, Number(options.maxDecodedBytesTotal))
    : DEFAULT_IMAGE_CACHE_BUDGETS.desktopMaxDecodedBytesTotal;
  const negativeTtlMs = Number.isFinite(options.negativeTtlMs) ? Math.max(0, Number(options.negativeTtlMs)) : 30_000;
  const maxNegativeEntries = Number.isFinite(options.maxNegativeEntries)
    ? Math.max(1, Math.floor(Number(options.maxNegativeEntries))) : maxEntries;
  const preferImageBitmap = options.preferImageBitmap !== false;
  const perImageMaxPixels = Number.isFinite(options.perImageMaxPixels)
    ? Math.max(1, Number(options.perImageMaxPixels))
    : DEFAULT_IMAGE_DECODE_LIMITS.maxPixels;
  const perImageMaxDecodedBytes = Number.isFinite(options.perImageMaxDecodedBytes)
    ? Math.max(1, Number(options.perImageMaxDecodedBytes))
    : DEFAULT_IMAGE_DECODE_LIMITS.maxDecodedBytes;
  const maxConcurrentDecodes = Number.isFinite(options.maxConcurrentDecodes)
    ? Math.max(1, Math.floor(Number(options.maxConcurrentDecodes)))
    : 4;
  const loadTimeoutMs = Number.isFinite(options.loadTimeoutMs)
    ? Math.max(1, Math.min(60_000, Math.floor(options.loadTimeoutMs))) : 60_000;
  const maxInflightRequests = Number.isFinite(options.maxInflightRequests)
    ? Math.max(1, Math.floor(Number(options.maxInflightRequests)))
    : maxConcurrentDecodes + 64;
  const defaultInflightDecodedBytes = Math.max(
    perImageMaxDecodedBytes,
    Math.min(maxDecodedBytesTotal, perImageMaxDecodedBytes * 2),
  );
  // Always leave room for one legal per-image decode. This avoids a semaphore
  // configuration that can never make progress.
  const maxInflightDecodedBytes = Math.max(
    perImageMaxDecodedBytes,
    Number.isFinite(options.maxInflightDecodedBytes)
      ? Math.max(1, Math.floor(Number(options.maxInflightDecodedBytes)))
      : defaultInflightDecodedBytes,
  );

  /** @type {Map<string, TextureImageCacheEntry>} */
  const lru = new Map();
  /** @type {Map<string, any>} */
  const inflight = new Map();
  /** @type {Map<string, NegativeCacheEntry>} */
  const negative = new Map();

  let totalDecodedBytes = 0;
  let generation = 0;
  let activeDecodeCount = 0;
  let inflightReservedDecodedBytes = 0;
  /** @type {Array<any>} */
  const decodeReservationQueue = [];
  /** @type {Set<any>} */
  const liveOperations = new Set();

  const createAbortError = () => createImageAbortError();
  const isAbortError = (error) => (
    (error && typeof error === 'object' && error.name === 'AbortError')
    || (error instanceof Error && error.message === 'IMAGE_CACHE_ABORTED')
  );

  const pumpDecodeReservations = () => {
    while (decodeReservationQueue.length > 0 && activeDecodeCount < maxConcurrentDecodes) {
      const waiter = decodeReservationQueue[0];
      if (waiter.generation !== generation || (waiter.signal && waiter.signal.aborted)) {
        decodeReservationQueue.shift();
        waiter.cleanup();
        waiter.reject(createAbortError());
        continue;
      }
      if (inflightReservedDecodedBytes + waiter.bytes > maxInflightDecodedBytes) return;

      decodeReservationQueue.shift();
      waiter.cleanup();
      activeDecodeCount += 1;
      inflightReservedDecodedBytes += waiter.bytes;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        activeDecodeCount -= 1;
        inflightReservedDecodedBytes -= waiter.bytes;
        pumpDecodeReservations();
      };
      // Publish the idempotent lease before resolving the Promise. clear()
      // may run after counters increment but before the await continuation.
      waiter.operation.releaseReservation = release;
      waiter.resolve(release);
    }
  };

  /**
   * Reserve the worst-case decoded bytes before the loader is called.
   * @param {number} bytes
   * @param {number} genAtStart
   * @param {AbortSignal|undefined} signal
   * @param {any} operation
   * @returns {Promise<() => void>}
   */
  const acquireDecodeReservation = (bytes, genAtStart, signal, operation) => {
    if (genAtStart !== generation || (signal && signal.aborted)) return Promise.reject(createAbortError());
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > maxInflightDecodedBytes) {
      return Promise.reject(new Error('IMAGE_CACHE_RESERVATION_TOO_LARGE'));
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        bytes,
        generation: genAtStart,
        signal,
        operation,
        resolve,
        reject,
        cleanup: () => {},
      };
      const onAbort = () => {
        const index = decodeReservationQueue.indexOf(waiter);
        if (index < 0) return;
        decodeReservationQueue.splice(index, 1);
        waiter.cleanup();
        reject(createAbortError());
        pumpDecodeReservations();
      };
      waiter.cleanup = () => {
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
      };
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      decodeReservationQueue.push(waiter);
      pumpDecodeReservations();
    });
  };

  const abortQueuedDecodeReservations = () => {
    const queued = decodeReservationQueue.splice(0);
    for (const waiter of queued) {
      waiter.cleanup();
      waiter.reject(createAbortError());
    }
  };

  /** @param {TextureImageCacheEntry} entry */
  const closeEntryIfNeeded = (entry) => {
    closeImageSourceIfNeeded(entry && entry.image);
  };

  /**
   * @param {string} key
   * @param {TextureImageCacheEntry} entry
   */
  const touch = (key, entry) => {
    lru.delete(key);
    lru.set(key, entry);
  };

  /**
   * Evict oldest entries until within budget.
   * @param {number} extraBytes
   */
  const evictAsNeeded = (extraBytes = 0, incomingEntries = 0) => {
    let guard = 0;
    while ((lru.size + incomingEntries > maxEntries || totalDecodedBytes + extraBytes > maxDecodedBytesTotal) && lru.size > 0) {
      guard += 1;
      if (guard > 10_000) break;
      const oldestKey = lru.keys().next().value;
      const ent = lru.get(oldestKey);
      lru.delete(oldestKey);
      if (ent) {
        totalDecodedBytes -= Number(ent.decodedBytes) || 0;
        closeEntryIfNeeded(ent);
      }
    }
    if (totalDecodedBytes < 0) totalDecodedBytes = 0;
  };

  /**
   * @param {string} key
   * @param {TextureImageCacheEntry} entry
   */
  const set = (key, entry) => {
    const k = String(key);
    if (!k) return false;

    const decodedBytes = Number(entry && entry.decodedBytes) || 0;
    if (decodedBytes <= 0 || decodedBytes > maxDecodedBytesTotal) return false;

    // Replace existing.
    const prev = lru.get(k);
    if (prev) {
      totalDecodedBytes -= Number(prev.decodedBytes) || 0;
      closeEntryIfNeeded(prev);
      lru.delete(k);
    }

    // Ensure capacity.
    evictAsNeeded(decodedBytes, 1);
    lru.set(k, entry);
    totalDecodedBytes += decodedBytes;
    return true;
  };

  /**
   * @param {string} key
   */
  const get = (key) => {
    const k = String(key);
    const ent = lru.get(k) || null;
    if (!ent) return null;
    touch(k, ent);
    return ent;
  };

  // TTL は同じキーの再参照を待たずに掃除する。異なる壊れた素材が続いても
  // 失敗情報の件数を上限以下に保ち、画像の失敗で予約枠を占有しない。
  const pruneNegative = (now = Date.now()) => {
    for (const [key, entry] of negative) {
      if (negativeTtlMs <= 0 || now - entry.atMs > negativeTtlMs) negative.delete(key);
    }
    while (negative.size > maxNegativeEntries) negative.delete(negative.keys().next().value);
  };

  /** @param {string} key */
  const getFailure = (key, requestedReservationBytes = null) => {
    const k = String(key);
    const neg = negative.get(k) || null;
    if (!neg) return null;
    if (negativeTtlMs <= 0) {
      negative.delete(k);
      return null;
    }
    if (Date.now() - neg.atMs > negativeTtlMs) {
      negative.delete(k);
      return null;
    }
    // A native multi-layer preview intentionally uses a smaller per-layer
    // reservation than ordinary images. Its budget-only failure must not
    // poison the same texture for a later caller that is allowed more memory.
    if (neg.reservationSensitive === true
      && Number.isFinite(requestedReservationBytes)
      && Number(requestedReservationBytes) > Number(neg.reservationBytes || 0)) {
      negative.delete(k);
      return null;
    }
    return neg;
  };

  /**
   * @param {string} key
   */
  const isLoading = (key) => inflight.has(String(key));

  const subscribeToPromise = (promise, signal, operation = null) => {
    if (signal && signal.aborted) return Promise.reject(createAbortError());
    if (operation) operation.subscriberCount += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const releaseSubscriber = (aborted) => {
        if (!operation) return;
        operation.subscriberCount = Math.max(0, operation.subscriberCount - 1);
        if (aborted && operation.subscriberCount === 0 && !operation.finished) {
          operation.controller.abort();
        }
      };
      const cleanup = () => {
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
      };
      const finish = (callback, value, aborted = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        releaseSubscriber(aborted);
        callback(value);
      };
      const onAbort = () => finish(reject, createAbortError(), true);
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      if (signal && signal.aborted) {
        onAbort();
        return;
      }
      promise.then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
  };

  const runLoaderWithCacheAbort = (operation, loader, context) => {
    // Begin this deadline only after acquiring the reservation: queued images
    // get their own full processing window, and timeout releases the slot.
    return runImageWorkWithDeadline(signal => loader({ ...context, signal }), {
      signal: operation.controller.signal, timeoutMs: loadTimeoutMs,
      timeoutCode: 'IMAGE_CACHE_LOAD_TIMEOUT',
    });
  };

  /**
   * @param {string} key
   * @param {(context?: { signal?: AbortSignal, maxDecodedBytes: number }) => Promise<{ image: CanvasImageSource, width: number, height: number, decodedBytes: number }>} loader
   * @param {{ signal?: AbortSignal, decodedByteReservation?: number }} [loadOptions]
   * @returns {Promise<TextureImageCacheEntry>}
   */
  const load = (key, loader, loadOptions = {}) => {
    const k = String(key);
    if (!k) return Promise.reject(new Error('IMAGE_CACHE_KEY_EMPTY'));
    const callerSignal = loadOptions && loadOptions.signal;
    if (callerSignal && callerSignal.aborted) return Promise.reject(createAbortError());
    const reservationBytes = Number.isFinite(loadOptions && loadOptions.decodedByteReservation)
      ? Math.min(perImageMaxDecodedBytes, Math.max(1, Math.ceil(Number(loadOptions.decodedByteReservation))))
      : perImageMaxDecodedBytes;

    const cached = get(k);
    if (cached) return subscribeToPromise(Promise.resolve(cached), callerSignal);

    const recentFail = getFailure(k, reservationBytes);
    if (recentFail) {
      return Promise.reject(new Error(`IMAGE_CACHE_RECENT_FAILURE:${recentFail.code}`));
    }

    const existing = inflight.get(k);
    if (existing) return subscribeToPromise(existing.promise, callerSignal, existing);
    // Check after same-key deduplication: existing callers may always join, but
    // distinct work is rejected before another Promise or queue node is made.
    if (inflight.size >= maxInflightRequests) {
      return Promise.reject(new Error('IMAGE_CACHE_INFLIGHT_LIMIT'));
    }

    const genAtStart = generation;
    const operation = {
      key: k,
      generation: genAtStart,
      controller: new AbortController(),
      releaseReservation: null,
      promise: null,
      subscriberCount: 0,
      finished: false,
    };
    liveOperations.add(operation);
    let p;
    p = (async () => {
      let releaseReservation = null;
      let ownedImage = null;
      try {
        releaseReservation = await acquireDecodeReservation(
          reservationBytes,
          genAtStart,
          operation.controller.signal,
          operation,
        );
        if (genAtStart !== generation || operation.controller.signal.aborted) throw createAbortError();
        const decoded = await runLoaderWithCacheAbort(operation, loader, {
          signal: operation.controller.signal,
          maxDecodedBytes: reservationBytes,
        });
        if (!decoded || !decoded.image) throw new Error('IMAGE_LOADER_INVALID_RESULT');
        ownedImage = decoded.image;

        // Validate per-image limits (defense in depth).
        const width = Number(decoded.width);
        const height = Number(decoded.height);
        if (!Number.isSafeInteger(width) || width <= 0
          || !Number.isSafeInteger(height) || height <= 0) {
          throw new Error('IMAGE_DECODE_INVALID_DIMENSIONS');
        }
        const pixels = width * height;
        if (!Number.isSafeInteger(pixels) || pixels <= 0) {
          throw new Error('IMAGE_DECODE_INVALID_DIMENSIONS');
        }
        if (pixels > perImageMaxPixels) throw new Error('IMAGE_DECODE_TOO_MANY_PIXELS');
        const minimumDecodedBytes = pixels * 4;
        if (!Number.isSafeInteger(minimumDecodedBytes)) throw new Error('IMAGE_DECODE_TOO_LARGE');
        const reportedDecodedBytes = decoded.decodedBytes === undefined
          ? minimumDecodedBytes
          : Number(decoded.decodedBytes);
        if (!Number.isFinite(reportedDecodedBytes) || reportedDecodedBytes <= 0) {
          throw new Error('IMAGE_LOADER_INVALID_RESULT');
        }
        const decodedBytes = Math.max(minimumDecodedBytes, Math.ceil(reportedDecodedBytes));
        if (decodedBytes > perImageMaxDecodedBytes) throw new Error('IMAGE_DECODE_TOO_LARGE');
        if (decodedBytes > reservationBytes) throw new Error('IMAGE_CACHE_RESERVATION_EXCEEDED');

        /** @type {TextureImageCacheEntry} */
        const entry = {
          key: k,
          image: decoded.image,
          width,
          height,
          decodedBytes,
          createdAtMs: Date.now(),
        };

        // If the cache was cleared while we decoded, drop this result.
        if (genAtStart !== generation || operation.controller.signal.aborted) throw createAbortError();

        if (!set(k, entry)) throw new Error('IMAGE_CACHE_ENTRY_EXCEEDS_BUDGET');
        ownedImage = null;
        return entry;
      } catch (err) {
        if (ownedImage) closeEntryIfNeeded({ image: ownedImage });
        const code = err instanceof Error ? err.message : String(err || 'UNKNOWN');
        if (negativeTtlMs > 0 && genAtStart === generation && !operation.controller.signal.aborted && !isAbortError(err)) {
          const reservationSensitive = code === 'IMAGE_CACHE_RESERVATION_EXCEEDED'
            || code === 'IMAGE_DECODE_TOO_LARGE';
          negative.set(k, {
            code,
            message: code,
            atMs: Date.now(),
            reservationBytes,
            reservationSensitive,
          });
          pruneNegative();
        }
        throw err;
      } finally {
        if (typeof releaseReservation === 'function') releaseReservation();
        operation.finished = true;
        liveOperations.delete(operation);
        if (inflight.get(k) === operation) inflight.delete(k);
      }
    })();

    operation.promise = p;
    inflight.set(k, operation);
    return subscribeToPromise(p, callerSignal, operation);
  };

  const clear = () => {
    generation += 1;
    const staleOperations = [...liveOperations];
    liveOperations.clear();
    for (const operation of staleOperations) {
      operation.controller.abort();
      if (typeof operation.releaseReservation === 'function') operation.releaseReservation();
    }
    abortQueuedDecodeReservations();

    // Close any decoded ImageBitmaps.
    for (const ent of lru.values()) closeEntryIfNeeded(ent);

    lru.clear();
    inflight.clear();
    negative.clear();
    totalDecodedBytes = 0;
    pumpDecodeReservations();
  };

  const stats = () => ({
    entries: lru.size,
    negativeEntries: negative.size,
    inflight: inflight.size,
    activeDecodes: activeDecodeCount,
    queuedDecodes: decodeReservationQueue.length,
    inflightReservedDecodedBytes,
    totalDecodedBytes,
    maxDecodedBytesTotal,
    maxEntries,
    maxNegativeEntries,
    maxConcurrentDecodes,
    maxInflightDecodedBytes,
    maxInflightRequests,
    loadTimeoutMs,
  });

  return {
    get,
    load,
    clear,
    isLoading,
    getFailure,
    stats,
    // Expose limits for callers that want to align decode settings.
    limits: {
      maxDecodedBytesTotal,
      maxEntries,
      perImageMaxPixels,
      perImageMaxDecodedBytes,
      maxConcurrentDecodes,
      maxInflightDecodedBytes,
      maxInflightRequests,
      loadTimeoutMs,
      preferImageBitmap,
      negativeTtlMs,
      maxNegativeEntries,
    },
  };
}
