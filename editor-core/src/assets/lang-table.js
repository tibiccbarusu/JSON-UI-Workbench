/*
 * lang-table.js (S043)
 *
 * Bedrock .lang parsing and localization-key heuristics.
 */

/**
 * @typedef {{
 *  table: Record<string,string>,
 *  stats: {
 *    totalLines: number,
 *    entries: number,
 *    duplicates: number,
 *    ignoredLines: number,
 *    truncated: boolean,
 *  }
 * }} ParsedLangFile
 */

const DEFAULT_MAX_ENTRIES = 120_000;

/** @param {string} s */
function stripUtf8Bom(s) {
  const text = String(s ?? '');
  return text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * @param {string} text
 * @param {{ maxEntries?: number }} [opts]
 * @returns {ParsedLangFile}
 */
export function parseLangFile(text, opts = {}) {
  const maxEntries = Number.isFinite(opts.maxEntries)
    ? Math.max(0, Number(opts.maxEntries))
    : DEFAULT_MAX_ENTRIES;

  /** @type {Record<string,string>} */
  const out = Object.create(null);
  let totalLines = 0;
  let entries = 0;
  let duplicates = 0;
  let ignoredLines = 0;
  let truncated = false;

  const src = stripUtf8Bom(String(text ?? ''));
  const lines = src.split(/\n/);

  for (let i = 0; i < lines.length; i += 1) {
    totalLines += 1;
    let line = lines[i] ?? '';
    if (typeof line !== 'string') line = String(line);
    line = line.replace(/\r$/, '');

    const trimmed = line.trim();
    if (!trimmed) {
      ignoredLines += 1;
      continue;
    }
    if (trimmed.startsWith('#')) {
      ignoredLines += 1;
      continue;
    }

    const eq = line.indexOf('=');
    if (eq <= 0) {
      ignoredLines += 1;
      continue;
    }

    const key = line.slice(0, eq).trim();
    if (!key) {
      ignoredLines += 1;
      continue;
    }

    // 空行・コメント・不正行は entries 予算を消費しない。
    // 上限直後の改行だけで、完全な言語表を未完了と誤判定しない。
    if (entries >= maxEntries) {
      truncated = true;
      break;
    }

    let value = line.slice(eq + 1);
    const commentIdx = value.indexOf('###');
    if (commentIdx >= 0) value = value.slice(0, commentIdx);
    value = value.replace(/\r$/, '').trimEnd();

    if (Object.prototype.hasOwnProperty.call(out, key)) duplicates += 1;
    out[key] = value;
    entries += 1;
  }

  return {
    table: out,
    stats: { totalLines, entries, duplicates, ignoredLines, truncated },
  };
}

/**
 * @param {string} str
 * @returns {boolean}
 */
export function looksLikeLangKey(str) {
  const s = String(str ?? '').trim();
  if (!s) return false;
  if (s.startsWith('#') || s.startsWith('$')) return false;

  if (s.includes('.') || s.includes(':')) {
    if (s.length > 120) return false;
    const segs = s.split(/[.:]/).filter(Boolean);
    if (segs.length < 2) return false;
    let ok = 0;
    for (const seg of segs) {
      if (/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(seg)) ok += 1;
    }
    return ok >= 2;
  }

  // Plain words such as "AUTO", "Play", or "OK" are valid literal labels.
  // Treating every identifier as a localization key creates false missing-key
  // markers in otherwise valid JSON UI. Bedrock's shipped language keys use a
  // namespaced/dotted shape, so only that conservative shape is inferred here.
  return false;
}
