/*
  sanitize.js (S056)

  Security-oriented sanitizers for untrusted strings.

  Goals:
  - Provide small, dependency-free helpers to reduce XSS/DOM injection risk.
  - Prevent accidental creation of dangerous URL attributes (e.g. javascript:).
  - Bound extremely long strings so logs/UI cannot be DoS'd by huge payloads.

  NOTE:
  - This app primarily avoids XSS by using safe DOM sinks (text nodes, value).
  - These helpers are defense-in-depth: they do NOT replace contextual encoding.
*/

/**
 * Replace ASCII control characters (except \n, \r, \t) with U+FFFD.
 *
 * @param {string} s
 * @returns {string}
 */
export function replaceControlChars(s) {
  const str = String(s ?? '');
  let out = '';
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += str[i];
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      out += '\uFFFD';
      continue;
    }
    out += str[i];
  }
  return out;
}

/**
 * Clamp a string to a maximum length.
 *
 * @param {string} s
 * @param {number} maxLen
 * @returns {string}
 */
export function clampStringLength(s, maxLen) {
  const str = String(s ?? '');
  const n = Number(maxLen);
  const limit = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (limit <= 0) return '';
  if (str.length <= limit) return str;
  return `${str.slice(0, limit)}…[truncated]`;
}

/**
 * Sanitize untrusted values for diagnostic logs.
 *
 * - Converts to string
 * - Replaces control characters
 * - Bounds length
 *
 * @param {any} v
 * @param {{ maxLen?: number }} [opts]
 * @returns {string}
 */
export function sanitizeForLog(v, opts = {}) {
  const maxLen = typeof opts.maxLen === 'number' ? opts.maxLen : 20000;
  const str = replaceControlChars(String(v ?? ''));
  return clampStringLength(str, maxLen);
}

/**
 * Sanitize a URL-like attribute value.
 *
 * This is intentionally conservative: it blocks `javascript:` and, by default,
 * blocks `data:` URLs (which can embed HTML/JS payloads).
 *
 * Allowed by default:
 * - Hash URLs: "#/route", "#anchor"
 * - Relative URLs (no scheme): "./x", "../x", "/x", "x"
 * - http/https
 * - blob:
 *
 * Optional allow:
 * - data: (only when opts.allowData === true)
 *
 * @param {any} raw
 * @param {{ allowData?: boolean }} [opts]
 * @returns {string} "" when blocked
 */
export function sanitizeUrlForAttribute(raw, opts = {}) {
  const input = String(raw ?? '');

  // WHATWG URL parsing removes ASCII tab/newline characters from URLs. A
  // value such as "java\nscript:..." would therefore bypass a literal scheme
  // check and later be interpreted as "javascript:..." by a browser. Reject
  // every ASCII C0 control character (including TAB/LF/CR) and DEL instead of
  // trying to normalize potentially dangerous input.
  if (/[\u0000-\u001F\u007F]/.test(input)) return '';

  const s = input.trim();
  if (!s) return '';

  // Hash routes/anchors are fine.
  if (s.startsWith('#')) return s;

  const lower = s.toLowerCase();
  if (lower.startsWith('javascript:')) return '';

  if (lower.startsWith('data:')) {
    if (!opts.allowData) return '';
    // Still block the most dangerous data: forms.
    if (lower.startsWith('data:text/html') || lower.startsWith('data:text/javascript') || lower.startsWith('data:application/javascript')) {
      return '';
    }
    return s;
  }

  // Detect an explicit scheme.
  const m = lower.match(/^([a-z][a-z0-9+.-]*):/);
  if (m) {
    const scheme = `${m[1]}:`;
    if (scheme === 'http:' || scheme === 'https:' || scheme === 'blob:') return s;
    // Block other schemes (file:, ftp:, etc.) unless we explicitly need them.
    return '';
  }

  // Relative URL (no scheme) is OK.
  return s;
}
