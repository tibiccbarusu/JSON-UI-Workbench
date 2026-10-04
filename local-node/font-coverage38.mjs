/** Node/Browser-compatible bounded glyph-address evidence; does not load or replace fonts. */
import { glyphAddress } from '../editor-core/src/preview/bitmap-font.js';

export const FONT_COVERAGE_LIMITS38 = Object.freeze({ characters: 131072, samplesPerSheet: 16 });
const hex = value => `U+${value.toString(16).toUpperCase().padStart(4, '0')}`;

/** Input is the already validated result of parseBedrockText. No full label text is retained. */
export function buildFontCoverage38(characters, fontType, remapping) {
  if (!Array.isArray(characters) || characters.length > FONT_COVERAGE_LIMITS38.characters) {
    throw Object.assign(new Error('FONT_COVERAGE_INPUT_LIMIT'), { code: 'FONT_COVERAGE_INPUT_LIMIT' });
  }
  const groups = new Map();
  for (const entry of characters) {
    const character = entry?.character;
    if (typeof character !== 'string' || Array.from(character).length !== 1) {
      throw Object.assign(new Error('FONT_COVERAGE_CHARACTER_INVALID'), { code: 'FONT_COVERAGE_CHARACTER_INVALID' });
    }
    if (character === '\n' || character === '\r') continue;
    const codepoint = character.codePointAt(0), address = glyphAddress(character, fontType, remapping);
    const sheet = address?.sheet ?? null;
    if (!groups.has(sheet)) groups.set(sheet, { count: 0, codepoints: new Set(), samples: [] });
    const group = groups.get(sheet); group.count++;
    if (group.codepoints.has(codepoint)) continue;
    group.codepoints.add(codepoint);
    if (group.samples.length < FONT_COVERAGE_LIMITS38.samplesPerSheet) {
      group.samples.push({ codepoint: hex(codepoint), ...(address ? { cell: address.cell } : {}),
        ...(fontType === 'smooth' && remapping?.has(codepoint) ? { mapped_codepoint: hex(remapping.get(codepoint)) } : {}) });
    }
  }
  return new Map([...groups].map(([sheet, group]) => [sheet, {
    font_type: fontType, sheet, occurrences: group.count, unique_codepoints: group.codepoints.size,
    samples: group.samples, samples_truncated: group.codepoints.size > group.samples.length,
    expected_paths: !sheet ? [] : sheet.startsWith('smooth_')
      ? [`font/smooth/${sheet}.png`, `font/smooth/${sheet}.fontdata`]
      : [`font/${sheet}.png`],
    ...(fontType === 'smooth' ? { remapping_path: 'font/smooth/remapping.dat', metadata_path: 'font/font_metadata.json' } : {}),
    scope: 'selected-text-addresses', minecraft_pixel_parity_verified: false,
  }]));
}
