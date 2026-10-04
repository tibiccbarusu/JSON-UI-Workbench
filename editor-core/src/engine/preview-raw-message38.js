/**
 * 明示状態だけを使うRawMessage部分対応。I/O、言語自動選択、score照会は行わない。
 * 入力state全体のcopyInput制限に加え、翻訳の繰り返しによる展開量も制限する。
 */
const LIMITS = Object.freeze({ depth: 24, nodes: 4096, messageBytes: 65536, outputBytes: 1024 * 1024, contextBytes: 1024 * 1024, provenance: 128 });
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const encoder = new TextEncoder();
function fail(code, path) { const error = new Error(`${code}:${path}`); error.code = code; throw error; }
function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) fail('PREVIEW_STATE_RAW_MESSAGE_OBJECT', path);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || UNSAFE.has(key)) fail('PREVIEW_STATE_UNSAFE_KEY', path);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('PREVIEW_STATE_ACCESSOR', `${path}.${key}`);
    if (!descriptor.enumerable) fail('PREVIEW_STATE_RAW_MESSAGE_FIELD', `${path}.${key}`);
  }
  return Object.keys(value);
}
function fields(keys, allowed, path) { for (const key of keys) if (!allowed.includes(key)) fail('PREVIEW_STATE_UNKNOWN_FIELD', `${path}.${key}`); }
function string(value, path) { if (typeof value !== 'string') fail('PREVIEW_STATE_STRING_REQUIRED', path); return value; }
function bounded(value, path) { if (encoder.encode(value).byteLength > LIMITS.messageBytes) fail('PREVIEW_STATE_RAW_MESSAGE_OUTPUT_LIMIT', path); return value; }
function arrayEntries(value, path) {
  if (!Array.isArray(value) || value.length > 256) fail('PREVIEW_STATE_RAW_MESSAGE_ARRAY', path);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) fail('PREVIEW_STATE_RAW_MESSAGE_ARRAY', path);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('PREVIEW_STATE_ACCESSOR', `${path}.${index}`);
  }
  return value;
}
function concatenate(values, path, renderPart) {
  let bytes = 0;
  const parts = [];
  for (let index = 0; index < values.length; index++) {
    const part = renderPart(values[index], index);
    if ((bytes += encoder.encode(part).byteLength) > LIMITS.messageBytes) fail('PREVIEW_STATE_RAW_MESSAGE_OUTPUT_LIMIT', path);
    parts.push(part);
  }
  return parts.join('');
}
/** 返値は1個のformに共有する。contextは明示翻訳表とそのlocale識別子だけ。 */
export function createPreviewMessageResolver(context) {
  let locale = null;
  const translations = Object.create(null);
  if (context !== undefined) {
    fields(record(context, 'messageContext'), ['locale', 'translations'], 'messageContext');
    if (context.locale !== undefined) {
      locale = string(context.locale, 'messageContext.locale');
      if (!/^[A-Za-z0-9_-]{1,64}$/u.test(locale)) fail('PREVIEW_STATE_MESSAGE_LOCALE', 'messageContext.locale');
    }
    if (context.translations !== undefined) {
      const keys = record(context.translations, 'messageContext.translations');
      if (keys.length > 4096) fail('PREVIEW_STATE_RAW_MESSAGE_BUDGET', 'messageContext.translations');
      let bytes = 0;
      for (const key of keys) {
        if (!key || key.length > 512 || /[\u0000-\u001f]/u.test(key)) fail('PREVIEW_STATE_KEY_INVALID', 'messageContext.translations');
        const value = bounded(string(context.translations[key], `messageContext.translations.${key}`), `messageContext.translations.${key}`);
        bytes += encoder.encode(key).byteLength + encoder.encode(value).byteLength;
        if (bytes > LIMITS.contextBytes) fail('PREVIEW_STATE_TEXT_LIMIT', 'messageContext.translations');
        translations[key] = value;
      }
    }
  }
  const diagnostics = [];
  let nodes = 0, outputBytes = 0, summary;
  const active = new Set();
  function render(value, path, depth, provenance) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail('PREVIEW_STATE_RAW_MESSAGE_BUDGET', path);
    const keys = record(value, path);
    if (active.has(value)) fail('PREVIEW_STATE_RAW_MESSAGE_CYCLE', path);
    fields(keys, ['text', 'rawtext', 'translate', 'with', 'score'], path);
    const kinds = ['text', 'rawtext', 'translate', 'score'].filter(key => Object.hasOwn(value, key));
    if (kinds.length !== 1 || (Object.hasOwn(value, 'with') && kinds[0] !== 'translate')) fail('PREVIEW_STATE_RAW_MESSAGE_AMBIGUOUS', path);
    const kind = kinds[0];
    if (kind === 'score') fail('PREVIEW_STATE_RAW_MESSAGE_SCORE_UNSUPPORTED', path);
    provenance.kinds.add(kind);
    active.add(value);
    try {
      if (kind === 'text') return bounded(string(value.text, `${path}.text`), path);
      if (kind === 'rawtext') return concatenate(arrayEntries(value.rawtext, `${path}.rawtext`), path, (entry, index) => render(entry, `${path}.rawtext.${index}`, depth + 1, provenance));
      const key = string(value.translate, `${path}.translate`);
      if (!Object.hasOwn(translations, key)) fail('PREVIEW_STATE_RAW_MESSAGE_TRANSLATION_MISSING', `${path}.translate`);
      provenance.translations.add(key);
      let args = [];
      if (Object.hasOwn(value, 'with')) {
        if (Array.isArray(value.with)) args = arrayEntries(value.with, `${path}.with`).map((entry, index) => bounded(string(entry, `${path}.with.${index}`), path));
        else {
          const withKeys = record(value.with, `${path}.with`);
          fields(withKeys, ['rawtext'], `${path}.with`);
          if (!Object.hasOwn(value.with, 'rawtext')) fail('PREVIEW_STATE_RAW_MESSAGE_ARRAY', `${path}.with`);
          args = arrayEntries(value.with.rawtext, `${path}.with.rawtext`).map((entry, index) => render(entry, `${path}.with.rawtext.${index}`, depth + 1, provenance));
        }
      }
      const template = translations[key];
      const parts = [];
      let start = 0, sequential = 0, bytes = 0;
      // Microsoft Raw Message JSONに記載された%sと%%1形式に限定する。
      // 不明なplaceholder構文や不足引数は、推測表示せず拒否する。
      const append = part => { bytes += encoder.encode(part).byteLength; if (bytes > LIMITS.messageBytes) fail('PREVIEW_STATE_RAW_MESSAGE_OUTPUT_LIMIT', path); parts.push(part); };
      const pattern = /%s|%%[1-9][0-9]*|%[%A-Za-z0-9$]+/gu;
      for (const match of template.matchAll(pattern)) {
        append(template.slice(start, match.index));
        const token = match[0];
        let index;
        if (token === '%s') index = sequential++;
        else if (/^%%[1-9][0-9]*$/u.test(token)) index = Number(token.slice(2)) - 1;
        else fail('PREVIEW_STATE_RAW_MESSAGE_PLACEHOLDER_UNSUPPORTED', path);
        if (!Number.isSafeInteger(index) || index >= args.length) fail('PREVIEW_STATE_RAW_MESSAGE_ARGUMENT_MISSING', path);
        append(args[index]); start = match.index + token.length;
      }
      append(template.slice(start));
      return parts.join('');
    } finally { active.delete(value); }
  }
  return {
    diagnostics,
    resolve(value, fallback, path) {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' && (!value || typeof value !== 'object')) fail('PREVIEW_STATE_STRING_REQUIRED', path);
      const provenance = { kinds: new Set(), translations: new Set() };
      // 従来の文字列はstate全体の1MiB/65536文字制限を維持し、
      // RawMessage用の単一展開64KiB制限で追加制約しない。
      const output = typeof value === 'string' ? value : render(value, path, 0, provenance);
      outputBytes += encoder.encode(output).byteLength;
      if (outputBytes > LIMITS.outputBytes) fail('PREVIEW_STATE_RAW_MESSAGE_OUTPUT_LIMIT', path);
      if (typeof value !== 'string') {
        if (!summary) {
          summary = { code: 'PREVIEW_STATE_RAW_MESSAGE_RESOLVED', severity: 'info', locale, translationSource: 'explicit-messageContext-only', resolvedFields: 0, provenance: [], omittedProvenance: 0, message: 'RawMessageの対応部分を明示翻訳表だけで展開しました。言語fallback・score・実機一致の認定は行いません。' };
          diagnostics.push(summary);
        }
        summary.resolvedFields++;
        if (summary.provenance.length < LIMITS.provenance) summary.provenance.push({ path, kinds: [...provenance.kinds], translationKeys: [...provenance.translations].slice(0, 32), omittedTranslationKeys: Math.max(0, provenance.translations.size - 32) });
        else summary.omittedProvenance++;
      }
      return output;
    },
  };
}
