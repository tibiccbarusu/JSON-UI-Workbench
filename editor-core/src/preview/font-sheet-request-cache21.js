/** Cache only the resource-sheet names required by authored display text.
 * This import-safe cache owns no images, resources, runtime values or DOM.
 * It cannot make a missing glyph ready or bypass the sheet loader's limits.
 */
import { glyphAddress, parseBedrockText, normalizeBitmapFontType, BEDROCK_TEXT_LIMITS } from './bitmap-font.js';

const NO_SHEETS = Object.freeze([]);

export class FontSheetRequestCache21 {
  /** @param {{maxEntries?:number,maxTextUnits?:number}} [options] */
  constructor({ maxEntries = 128, maxTextUnits = 262144 } = {}) {
    if (![maxEntries, maxTextUnits].every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error('FONT_SHEET_REQUEST_CACHE_LIMIT_INVALID');
    }
    this.maxEntries = maxEntries; this.maxTextUnits = maxTextUnits;
    this.rows = new Map(); this.textUnits = 0;
    this.metrics = { hits: 0, misses: 0, bypasses: 0, evictions: 0 };
  }

  /** Return immutable unique sheet names, using the existing text semantics.
   * A font/format/text change gets a separate key. Parse errors are not cached.
   * @param {unknown} text
   * @param {string} [fontType]
   * @returns {ReadonlyArray<string>}
   */
  getSheets(text, fontType = 'default', remapping = undefined) {
    const family = normalizeBitmapFontType(fontType);
    // Smooth addresses are unknown until the source's remapping is available.
    if (!family || (family === 'smooth' && !(remapping instanceof Map))) return NO_SHEETS;
    if (family === 'smooth' && this.remapping !== remapping) {
      this.clear(); this.remapping = remapping;
    }
    const source = String(text);
    if (source.length > BEDROCK_TEXT_LIMITS.codeUnits) throw new Error('FONT_TEXT_LIMIT');
    // The family is one of four fixed values, so ':' cannot alias a key.
    const key = `${family}:${source}`;
    const hit = this.rows.get(key);
    if (hit) {
      this.rows.delete(key); this.rows.set(key, hit); this.metrics.hits++;
      return hit;
    }
    this.metrics.misses++;
    const sheets = Object.freeze([...new Set(parseBedrockText(source).characters
      .filter(character => character.character !== '\n')
      .map(character => glyphAddress(character.character, family, remapping)?.sheet)
      .filter(Boolean))]);
    if (!this.maxEntries || key.length > this.maxTextUnits) {
      this.metrics.bypasses++; return sheets;
    }
    while (this.rows.size && (this.rows.size >= this.maxEntries || this.textUnits + key.length > this.maxTextUnits)) {
      const oldest = this.rows.keys().next().value;
      this.rows.delete(oldest); this.textUnits -= oldest.length; this.metrics.evictions++;
    }
    this.rows.set(key, sheets); this.textUnits += key.length;
    return sheets;
  }

  /** Remove retained label text on a composition/locale reset. */
  clear() { this.rows.clear(); this.textUnits = 0; this.remapping = undefined; }

  /** Debug output is aggregate-only; authored text is never included. */
  stats() {
    return { ...this.metrics, entries: this.rows.size, textUnits: this.textUnits,
      maxEntries: this.maxEntries, maxTextUnits: this.maxTextUnits };
  }
}
