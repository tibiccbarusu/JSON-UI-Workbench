/** パック情報とアイコンの共通境界。HTTP と CLI は同じ検証を使う。 */
import pngjs from './vendor/pngjs/lib/png.js';
import { fail } from './limits.mjs';

export const PACK_OPTIONS_LIMITS = Object.freeze({ name: 120, description: 1024, authors: 16,
  author: 80, iconBytes: 1024 * 1024, iconDimension: 2048, outputDimension: 256 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, field, maximum, multiline = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum
    || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)) {
    fail(`EXPORT_${field}_INVALID`, 422);
  }
  return value.trim();
}
export function normalizePackOptions(input = {}) {
  if (!object(input) || Object.keys(input).some(key => !['name', 'description', 'version', 'authors'].includes(key))) fail('EXPORT_PACK_OPTIONS_INVALID', 422);
  const result = {};
  if (input.name !== undefined) result.name = text(input.name, 'NAME', PACK_OPTIONS_LIMITS.name);
  if (input.description !== undefined) result.description = text(input.description, 'DESCRIPTION', PACK_OPTIONS_LIMITS.description, true);
  if (input.version !== undefined) {
    if (!Array.isArray(input.version) || input.version.length !== 3
      || !input.version.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 65535)) fail('EXPORT_VERSION_INVALID', 422);
    result.version = [...input.version];
  }
  if (input.authors !== undefined) {
    if (!Array.isArray(input.authors) || input.authors.length > PACK_OPTIONS_LIMITS.authors) fail('EXPORT_AUTHORS_INVALID', 422);
    result.authors = input.authors.map(value => text(value, 'AUTHOR', PACK_OPTIONS_LIMITS.author));
  }
  return result;
}
export function applyPackOptions(manifest, input) {
  const options = normalizePackOptions(input);
  const output = { ...manifest, header: { ...manifest.header }, modules: manifest.modules.map(module => ({ ...module })) };
  for (const field of ['name', 'description', 'version']) if (options[field] !== undefined) output.header[field] = options[field];
  if (options.version) for (const module of output.modules) module.version = [...options.version];
  if (options.authors) output.metadata = { ...output.metadata, authors: options.authors };
  return output;
}
/** PNG の寸法を復号前に制限し、CRC検査後、透明余白付き256角へ変換する。 */
export function normalizePackIcon(base64) {
  if (base64 === undefined) return null;
  if (typeof base64 !== 'string' || base64.length > Math.ceil(PACK_OPTIONS_LIMITS.iconBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64)) fail('EXPORT_ICON_BASE64_INVALID', 422);
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 33 || bytes.length > PACK_OPTIONS_LIMITS.iconBytes
    || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('EXPORT_ICON_PNG_INVALID', 422);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > PACK_OPTIONS_LIMITS.iconDimension || height > PACK_OPTIONS_LIMITS.iconDimension) fail('EXPORT_ICON_DIMENSIONS_INVALID', 422);
  let decoded;
  try { decoded = pngjs.PNG.sync.read(bytes, { checkCRC: true }); }
  catch { fail('EXPORT_ICON_PNG_INVALID', 422); }
  const size = PACK_OPTIONS_LIMITS.outputDimension, data = Buffer.alloc(size * size * 4);
  const scale = Math.min(size / width, size / height);
  const scaledWidth = Math.max(1, Math.round(width * scale)), scaledHeight = Math.max(1, Math.round(height * scale));
  const left = Math.floor((size - scaledWidth) / 2), top = Math.floor((size - scaledHeight) / 2);
  for (let y = 0; y < scaledHeight; y++) for (let x = 0; x < scaledWidth; x++) {
    const from = (Math.min(height - 1, Math.floor(y / scale)) * width + Math.min(width - 1, Math.floor(x / scale))) * 4;
    decoded.data.copy(data, ((y + top) * size + x + left) * 4, from, from + 4);
  }
  return { bytes: pngjs.PNG.sync.write({ width: size, height: size, data }),
    sourceWidth: width, sourceHeight: height, width: size, height: size };
}
