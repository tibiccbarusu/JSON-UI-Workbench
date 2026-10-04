/** Resource I/O for the explicitly selected observed smooth-font profile.
 * The binary format/profile is bounded to the captured OldSmoothFont family. */
import { createHash } from 'node:crypto';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { parseSmoothRemapping37, compileSmoothGlyphMetrics37, SMOOTH_FONT_PROFILE37 } from '../editor-core/src/preview/smooth-font37.js';
import { decodeFontSheetPixels } from './font-sheet.mjs';
import { fail } from './limits.mjs';

const METADATA_PATH = 'font/font_metadata.json';
const REMAPPING_PATH = 'font/smooth/remapping.dat';
export const SMOOTH_FONT_LIMITS = Object.freeze({ metadataBytes: 64 * 1024, remappingBytes: 65536 * 4,
  fontdataBytes: 1028, pngBytes: 4 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function matchingPath(item, wanted) {
  const matches = item.packPaths.filter(value => value.toLowerCase() === wanted.toLowerCase());
  if (matches.length > 1) fail('FONT_SMOOTH_RESOURCE_AMBIGUOUS');
  return matches[0] || null;
}

async function metadataFor(sources, getPack) {
  for (const source of sources) {
    const item = getPack(source.id), actual = matchingPath(item, METADATA_PATH);
    const overrideNames = Object.keys(source.overrides || {}).filter(value => value.toLowerCase() === METADATA_PATH);
    if (overrideNames.length > 1) fail('FONT_SMOOTH_RESOURCE_AMBIGUOUS');
    if (!actual && !overrideNames.length) continue;
    const bytes = overrideNames.length ? Buffer.from(source.overrides[overrideNames[0]])
      : await item.zipReader.bytes(item.rootPrefix + actual, SMOOTH_FONT_LIMITS.metadataBytes);
    if (bytes.length > SMOOTH_FONT_LIMITS.metadataBytes) fail('FONT_SMOOTH_METADATA_LIMIT', 413);
    const parsed = parseJsonc(bytes.toString('utf8'));
    if (!parsed.ok || !Array.isArray(parsed.value?.fonts)) fail('FONT_SMOOTH_METADATA_INVALID');
    const families = parsed.value.fonts.filter(row => row?.font_name === 'OldSmoothFont');
    if (families.length !== 1 || families[0].font_format !== 'msdf'
      || families[0].font_file !== 'font/smooth/smooth_') fail('FONT_SMOOTH_METADATA_UNSUPPORTED');
    return { metadataSource: source.kind, metadataPath: overrideNames[0] || actual,
      metadataSha256: hash(bytes), metadataProfile: 'captured-old-smooth-font-v1' };
  }
  fail('FONT_SMOOTH_METADATA_MISSING', 404);
}

/** Sources must already be validated and ordered (imported before vanilla).
 * A present higher-priority malformed resource is never hidden by fallback. */
export async function loadSmoothFontResource({ sources, getPack, sheet, includePixels = false }) {
  if (!/^smooth_(?:remapping|[0-9A-F]{2})$/u.test(sheet || '')) fail('FONT_REQUEST_INVALID');
  if (typeof includePixels !== 'boolean' || includePixels && sheet === 'smooth_remapping') fail('FONT_REQUEST_INVALID');
  const metadata = await metadataFor(sources, getPack);
  if (sheet === 'smooth_remapping') {
    for (const source of sources) {
      const item = getPack(source.id), actual = matchingPath(item, REMAPPING_PATH);
      if (!actual) continue;
      const bytes = await item.zipReader.bytes(item.rootPrefix + actual, SMOOTH_FONT_LIMITS.remappingBytes);
      const pairs = [...parseSmoothRemapping37(bytes)];
      return { kind: 'smooth-remapping', pairs, provenance: { source: source.kind, path: actual,
        sha256: hash(bytes), ...metadata, resolutionProfile: SMOOTH_FONT_PROFILE37.id, minecraftPixelParityVerified: false } };
    }
    fail('FONT_SMOOTH_REMAPPING_MISSING', 404);
  }
  for (const source of sources) {
    const item = getPack(source.id), prefix = `font/smooth/${sheet}`;
    const imagePath = matchingPath(item, `${prefix}.png`), dataPath = matchingPath(item, `${prefix}.fontdata`);
    if (!imagePath && !dataPath) continue;
    // An atlas and its metrics are one observed profile unit. Do not combine a
    // broken higher-priority half-pair with lower-priority widths or pixels.
    if (!imagePath || !dataPath) fail('FONT_SMOOTH_PAIR_MISSING', 404);
    const fontdata = await item.zipReader.bytes(item.rootPrefix + dataPath, SMOOTH_FONT_LIMITS.fontdataBytes);
    const bytes = await item.zipReader.bytes(item.rootPrefix + imagePath, SMOOTH_FONT_LIMITS.pngBytes);
    const pixels = decodeFontSheetPixels(bytes);
    const metrics = compileSmoothGlyphMetrics37(fontdata, { sheet, width: pixels.width, height: pixels.height });
    return { metrics, png: bytes.toString('base64'), ...(includePixels ? { pixels: {
      width: pixels.width, height: pixels.height, encoding: 'rgba8-base64',
      rgbaBase64: Buffer.from(pixels.data).toString('base64'), sha256: hash(pixels.data),
    } } : {}), provenance: { source: source.kind, path: imagePath,
      sha256: hash(bytes), fontdataPath: dataPath, fontdataSha256: hash(fontdata), ...metadata,
      resolutionProfile: SMOOTH_FONT_PROFILE37.id, minecraftPixelParityVerified: false } };
  }
  fail('FONT_SHEET_MISSING', 404);
}
