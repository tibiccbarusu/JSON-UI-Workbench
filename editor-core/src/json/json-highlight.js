/*
  json-highlight.js (S031)

  Lightweight tokenizer for strict JSON text so we can apply client-side
  syntax highlighting without using innerHTML.

  Notes:
  - This is not a JSON validator. It assumes input is already strict JSON
    (or at least JSON-like) and tries to produce best-effort tokens.
  - It is designed for readability and safety, not perfect spec coverage.
*/

/**
 * @typedef {'whitespace'|'punct'|'key'|'string'|'number'|'boolean'|'null'|'invalid'} JsonTokenType
 */

/**
 * @typedef {{ type: JsonTokenType, value: string }} JsonToken
 */

/**
 * Tokenize JSON text into simple token types.
 *
 * This is intended for syntax highlighting only.
 *
 * @param {string} text
 * @returns {JsonToken[]}
 */
export function tokenizeJsonForHighlight(text) {
  const s = String(text ?? '');
  /** @type {JsonToken[]} */
  const tokens = [];

  let i = 0;

  /** @param {JsonTokenType} type @param {number} start @param {number} end */
  function push(type, start, end) {
    if (end <= start) return;
    tokens.push({ type, value: s.slice(start, end) });
  }

  /** @param {number} idx @returns {string} */
  function ch(idx) {
    return s[idx] || '';
  }

  /** @param {string} c @returns {boolean} */
  function isWs(c) {
    return c === ' ' || c === '\n' || c === '\r' || c === '\t';
  }

  /** @param {string} c @returns {boolean} */
  function isDigit(c) {
    return c >= '0' && c <= '9';
  }

  /** @param {number} start @returns {number} end index (exclusive) */
  function readWhitespace(start) {
    let j = start;
    while (j < s.length && isWs(ch(j))) j += 1;
    return j;
  }

  /** @param {number} start @returns {{ end: number, type: 'key'|'string' }} */
  function readString(start) {
    let j = start + 1; // skip opening "
    while (j < s.length) {
      const c = ch(j);
      if (c === '\\') {
        // Skip escaped char (including \uXXXX).
        j += 1;
        const next = ch(j);
        if (next === 'u') {
          // 'u' + 4 hex chars (best-effort)
          j += 1 + 4;
        } else {
          j += 1;
        }
        continue;
      }
      if (c === '"') {
        j += 1; // include closing "
        break;
      }
      j += 1;
    }

    // Determine if this string is a "key" by looking ahead for a colon.
    let k = j;
    while (k < s.length && isWs(ch(k))) k += 1;
    const type = ch(k) === ':' ? 'key' : 'string';
    return { end: j, type };
  }

  /** @param {number} start @returns {number} */
  function readNumber(start) {
    let j = start;

    if (ch(j) === '-') j += 1;

    // int
    while (j < s.length && isDigit(ch(j))) j += 1;

    // frac
    if (ch(j) === '.') {
      j += 1;
      while (j < s.length && isDigit(ch(j))) j += 1;
    }

    // exp
    const e = ch(j);
    if (e === 'e' || e === 'E') {
      j += 1;
      const sign = ch(j);
      if (sign === '+' || sign === '-') j += 1;
      while (j < s.length && isDigit(ch(j))) j += 1;
    }

    return j;
  }

  while (i < s.length) {
    const c0 = ch(i);

    if (isWs(c0)) {
      const j = readWhitespace(i);
      push('whitespace', i, j);
      i = j;
      continue;
    }

    // Punctuation
    if (c0 === '{' || c0 === '}' || c0 === '[' || c0 === ']' || c0 === ':' || c0 === ',') {
      push('punct', i, i + 1);
      i += 1;
      continue;
    }

    // Strings
    if (c0 === '"') {
      const { end, type } = readString(i);
      push(type, i, end);
      i = end;
      continue;
    }

    // Literals
    if (c0 === 't' && s.startsWith('true', i)) {
      push('boolean', i, i + 4);
      i += 4;
      continue;
    }
    if (c0 === 'f' && s.startsWith('false', i)) {
      push('boolean', i, i + 5);
      i += 5;
      continue;
    }
    if (c0 === 'n' && s.startsWith('null', i)) {
      push('null', i, i + 4);
      i += 4;
      continue;
    }

    // Numbers
    if (c0 === '-' || isDigit(c0)) {
      const j = readNumber(i);
      push('number', i, j);
      i = j;
      continue;
    }

    // Unknown / invalid
    push('invalid', i, i + 1);
    i += 1;
  }

  return tokens;
}
