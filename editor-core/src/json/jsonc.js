/*
  JSONC parsing wrapper (S019)

  - Accepts JSON with comments and (optionally) trailing commas.
  - Returns structured parse errors that include line/column.
  - Designed for buildless usage (no bundler): depends on the UMD build of
    `jsonc-parser` being loaded in /app/index.html.
*/

/**
 * @typedef {{
 *  fileName?: string,
 *  filePath?: string, // Source-path alias used by Node asset diagnostics.
 *  allowTrailingComma?: boolean,
 *  allowEmptyContent?: boolean,
 * }} JsoncParseOptions
 */

/**
 * @typedef {{
 *  code: string,
 *  message: string,
 *  offset: number,
 *  length: number,
 *  line: number,
 *  column: number,
 * }} JsoncParseError
 */

/**
 * @typedef {{
 *  ok: true,
 *  value: any,
 *  errors: [],
 * } | {
 *  ok: false,
 *  value: any,
 *  errors: JsoncParseError[],
 * }} JsoncParseResult
 */

/**
 * Resolve the global jsonc-parser UMD object.
 *
 * @returns {any}
 */
function getJsoncLib() {
  const lib = globalThis && /** @type {any} */ (globalThis).jsoncParser;
  if (lib && typeof lib.parse === 'function') {
    return lib;
  }

  // Fallback: minimal JSONC support without external dependency.
  //
  // This allows the app to function in environments where external scripts are blocked
  // (offline/CSP/firewall). It is *not* a full jsonc-parser replacement.
  //
  // The fallback keeps the sanitized string length identical to the original input
  // (comments and trailing commas are replaced with whitespace) so that the JSON.parse
  // error "position" can be mapped back to approximate line/column.
  return {
    parse: (text, errors, options) => {
      try {
        const allowEmptyContent = !!(options && options.allowEmptyContent);
        const t = String(text || '');
        if (allowEmptyContent && t.trim() === '') return null;

        const sanitized = sanitizeJsoncPreserveOffsets(t, {
          allowTrailingComma: !(options && options.allowTrailingComma === false),
          // Comments are always allowed in this fallback.
        });
        // Comments contain no JSON value. Keep the explicit empty-content
        // option consistent after comment removal, but still reject an
        // unterminated comment in the sanitizer above.
        if (allowEmptyContent && sanitized.trim() === '') return null;
        return JSON.parse(sanitized);
      } catch (err) {
        const msg = err && typeof err.message === 'string' ? err.message : String(err);
        const m = msg.match(/position\s+(\d+)/i);
        const offset = m ? Number(m[1]) : 0;
        if (Array.isArray(errors)) {
          errors.push({ error: -1, offset: Number.isFinite(offset) ? offset : 0, length: 1 });
        }
        return null;
      }
    },
    printParseErrorCode: (code) => (code === -1 ? 'FALLBACK_PARSE_ERROR' : String(code)),
  };
}

/**
 * Strip JSONC comments and (optionally) trailing commas by *replacing* removed characters
 * with whitespace. The returned string is the same length as the input.
 *
 * This is a best-effort sanitizer intended for fallback-only parsing.
 *
 * @param {string} input
 * @param {{ allowTrailingComma: boolean }} opts
 */
function sanitizeJsoncPreserveOffsets(input, opts) {
  const allowTrailingComma = !!(opts && opts.allowTrailingComma);
  const out = input.split('');

  let inString = false;
  /** @type {'"'|"'"|null} */
  let stringQuote = null;
  let escaped = false;

  // First pass: replace comments with whitespace (preserve newlines).
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i];
    const next = i + 1 < out.length ? out[i + 1] : '';

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = /** @type {any} */ (ch);
      escaped = false;
      continue;
    }

    // Line comment
    if (ch === '/' && next === '/') {
      // Replace "//" with spaces.
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      for (; i < out.length; i += 1) {
        if (out[i] === '\n' || out[i] === '\r') break;
        out[i] = ' ';
      }
      i -= 1;
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      const start = i;
      let closed = false;
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      for (; i < out.length - 1; i += 1) {
        const c = out[i];
        const n = out[i + 1];
        if (c === '*' && n === '/') {
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 1;
          closed = true;
          break;
        }
        // Preserve newlines for line/column mapping.
        if (c !== '\n' && c !== '\r') out[i] = ' ';
      }
      if (!closed) throw new Error(`Unterminated block comment at position ${start}`);
      continue;
    }
  }

  if (!allowTrailingComma) {
    return out.join('');
  }

  // Second pass: replace trailing commas with whitespace (outside strings).
  inString = false;
  stringQuote = null;
  escaped = false;

  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = /** @type {any} */ (ch);
      escaped = false;
      continue;
    }

    if (ch !== ',') continue;

    // Look ahead to the next non-whitespace character.
    let j = i + 1;
    for (; j < out.length; j += 1) {
      const c = out[j];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') continue;
      break;
    }
    const next = j < out.length ? out[j] : '';
    if (next === '}' || next === ']') {
      out[i] = ' ';
    }
  }

  return out.join('');
}

/**
 * Precompute line start offsets for fast offset->(line,col) mapping.
 *
 * @param {string} text
 * @returns {number[]}
 */
function computeLineStarts(text) {
  /** @type {number[]} */
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10) i += 1;
      starts.push(i + 1);
    } else if (text.charCodeAt(i) === 10 /* \n */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Convert offset into 1-based line/column.
 *
 * @param {number} offset
 * @param {number[]} lineStarts
 */
function offsetToLineCol(offset, lineStarts) {
  const off = Math.max(0, Math.min(Number(offset) || 0, Number.MAX_SAFE_INTEGER));
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= off) lo = mid + 1;
    else hi = mid - 1;
  }
  const lineIdx = Math.max(0, hi);
  const lineStart = lineStarts[lineIdx] || 0;
  return {
    line: lineIdx + 1,
    column: off - lineStart + 1,
  };
}

/**
 * Parse JSON with comments.
 *
 * NOTE: The underlying parser is fault-tolerant and may return a partial value
 * even when errors exist. Always check `result.ok`.
 *
 * @param {string} text
 * @param {JsoncParseOptions} [opts]
 * @returns {JsoncParseResult}
 */
export function parseJsonc(text, opts = {}) {
  const lib = getJsoncLib();
  const original = String(text || '');
  // Mojang ships UTF-8 BOM-prefixed texture sets. Only the leading BOM is
  // transport metadata. Replace it with one space so diagnostics still use
  // original UTF-16 offsets; never strip BOM characters inside authored text.
  const parserText = original.charCodeAt(0) === 0xfeff ? ' ' + original.slice(1) : original;
  const fileName = String(opts.fileName || opts.filePath || '(input)');
  const allowTrailingComma = opts.allowTrailingComma === undefined ? true : Boolean(opts.allowTrailingComma);
  const allowEmptyContent = opts.allowEmptyContent === undefined ? false : Boolean(opts.allowEmptyContent);

  /** @type {{ error: number, offset: number, length: number }[]} */
  const errors = [];

  /** @type {any} */
  let value;
  try {
    value = lib.parse(parserText, errors, {
      disallowComments: false,
      allowTrailingComma,
      allowEmptyContent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || 'UNKNOWN');
    return {
      ok: false,
      value: null,
      errors: [
        {
          code: 'EXCEPTION',
          message: `${fileName}: ${msg}`,
          offset: 0,
          length: 0,
          line: 1,
          column: 1,
        },
      ],
    };
  }

  if (!errors.length) {
    return { ok: true, value, errors: [] };
  }

  const lineStarts = computeLineStarts(original);
  /** @type {JsoncParseError[]} */
  const out = errors.map((pe) => {
    const loc = offsetToLineCol(pe.offset, lineStarts);
    const code = (typeof lib.printParseErrorCode === 'function')
      ? String(lib.printParseErrorCode(pe.error) || 'UNKNOWN')
      : `E_${String(pe.error)}`;
    return {
      code,
      message: `${fileName}:${loc.line}:${loc.column} ${code}`,
      offset: Number(pe.offset) || 0,
      length: Number(pe.length) || 0,
      line: loc.line,
      column: loc.column,
    };
  });

  return { ok: false, value, errors: out };
}
