import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFontCoverage38 } from '../font-coverage38.mjs';
import { parseBedrockText } from '../../editor-core/src/preview/bitmap-font.js';

test('missing mapped glyph evidence identifies original codepoint, mapped cell and both required files', () => {
  const result = buildFontCoverage38(parseBedrockText('掲掲A\n').characters, 'smooth', new Map([[0x63b2, 0x3402]]));
  const row = result.get('smooth_34');
  assert.equal(row.occurrences, 2);
  assert.deepEqual(row.samples, [{ codepoint: 'U+63B2', cell: 2, mapped_codepoint: 'U+3402' }]);
  assert.deepEqual(row.expected_paths, ['font/smooth/smooth_34.png', 'font/smooth/smooth_34.fontdata']);
  assert.equal(result.get('smooth_00').samples[0].codepoint, 'U+0041');
  assert.equal(row.minecraft_pixel_parity_verified, false);
});
test('bitmap/private glyph, non-BMP and formatting preserve actual address rules', () => {
  const result = buildFontCoverage38(parseBedrockText('§aA日😀').characters, 'default');
  assert.equal(result.size, 3);
  assert.equal(result.get('glyph_65').samples[0].codepoint, 'U+65E5');
  assert.deepEqual(result.get(null).expected_paths, []);
  assert.equal(result.get(null).samples[0].codepoint, 'U+1F600');
});
test('sample records are bounded without understating total distinct glyph demand', () => {
  const result = buildFontCoverage38(Array.from({ length: 100 }, (_, i) => ({ character: String.fromCodePoint(0x6500 + i) })), 'unicode');
  const row = result.get('glyph_65');
  assert.equal(row.unique_codepoints, 100); assert.equal(row.samples.length, 16); assert.equal(row.samples_truncated, true);
  assert.throws(() => buildFontCoverage38(new Array(131073), 'default'), /FONT_COVERAGE_INPUT_LIMIT/);
  assert.throws(() => buildFontCoverage38([{character:'abc'}], 'default'), /FONT_COVERAGE_CHARACTER_INVALID/);
});
