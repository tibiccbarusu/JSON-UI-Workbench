import pngjs from '../vendor/pngjs/lib/png.js';
import { glyphAddress } from '../../editor-core/src/preview/bitmap-font.js';

/** Original geometric marks for exercising atlas transport and glyph recovery.
 * These are synthetic test shapes, not Japanese glyphs or Minecraft assets.
 * Keep the same Unicode sheet/cell addresses as the tested input so missing
 * sheet failures still exercise real multi-sheet cache and layout behavior.
 */
export function syntheticGlyphSheets(text) {
  const sheets = new Map(), width = 256;
  for (const character of text) {
    const { sheet, cell } = glyphAddress(character);
    if (!sheets.has(sheet)) sheets.set(sheet, Buffer.alloc(width * width * 4));
    const data = sheets.get(sheet), ox = (cell % 16) * 16, oy = Math.floor(cell / 16) * 16;
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
      if (x !== 2 && x !== 13 && y !== 2 && y !== 13 && x !== 4 + cell % 7) continue;
      const at = ((oy + y) * width + ox + x) * 4;
      data[at] = data[at + 1] = data[at + 2] = data[at + 3] = 255;
    }
  }
  return new Map([...sheets].map(([name, data]) => [name, pngjs.PNG.sync.write({ width, height: width, data })]));
}
