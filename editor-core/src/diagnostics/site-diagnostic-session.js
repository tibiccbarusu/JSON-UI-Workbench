/*
  site-diagnostic-session.js (S066)

  Explicit, bounded diagnostic sessions for semi-automated site verification.

  Privacy and safety invariants:
  - Nothing is collected before start() or after stop().
  - User-Agent collection and console interception are explicit opt-ins.
  - Pack/file bodies, generic payloads, credentials, cookies, and tokens are
    replaced before an event enters the in-memory buffer.
  - Console objects are represented by their type and key names only. Their
    values are never traversed or serialized.
  - The final UTF-8 JSON document is fitted to maxBytes, not merely limited by
    an event-count estimate.
*/

import { stableStringify } from '../json/stable-stringify.js';
import { downloadBlobSafely23 } from '../ui/blob-download.js';

export const SITE_DIAGNOSTIC_SCHEMA = 'jsonui.site-diagnostic-session';
export const SITE_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const DEFAULT_SITE_DIAGNOSTIC_MAX_BYTES = 512 * 1024;

const MIN_MAX_BYTES = 16 * 1024;
const MAX_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_EVENTS = 2000;
const MAX_SCREENSHOT_REFERENCES = 20;
const CONSOLE_LEVELS = /** @type {const} */ (['debug', 'log', 'info', 'warn', 'error']);

// Key names are matched after punctuation is removed and the key is lowercased.
const SECRET_KEY_RE = /(?:password|passwd|authorization|auth|token|secret|apikey|credential|cookie|setcookie|sessionkey|privatekey)/;
const BODY_KEY_RE = /^(?:body|content|text|sourcetext|rawtext|json|jsontext|payload|pack|packbody|packcontent|filecontent|filedata|blob|arraybuffer|binary|responsebody|requestbody|manifest)$/;

/** @param {any} value @param {number} min @param {number} max @param {number} fallback */
function clampInt(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

/** @param {any} value @param {number} maxLength */
function safeString(value, maxLength = 512) {
  const raw = String(value ?? '');
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code === 0x09 || code === 0x0a || code === 0x0d) out += raw[index];
    else if (code < 0x20 || code === 0x7f) out += '\uFFFD';
    else out += raw[index];
    if (out.length >= maxLength) break;
  }
  return raw.length > maxLength ? `${out}\u2026[truncated]` : out;
}

/** @param {string} key */
function normalizedKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** @param {string} text */
function looksLikeJsonDocument(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.length < 2) return false;
  const bracketed =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!bracketed) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return Boolean(parsed && typeof parsed === 'object');
  } catch {
    return false;
  }
}

/**
 * Redact secrets embedded in an otherwise diagnostic-safe short string.
 *
 * @param {any} value
 * @param {{ maxLength?: number, onRedaction?: (reason: string) => void }} [options]
 */
export function redactDiagnosticString(value, options = {}) {
  const maxLength = clampInt(options.maxLength, 32, 4096, 512);
  const onRedaction = typeof options.onRedaction === 'function' ? options.onRedaction : () => {};
  const original = String(value ?? '');

  if (/^data:/i.test(original.trim())) {
    onRedaction('data-url');
    return `[REDACTED_DATA_URL length=${original.length}]`;
  }
  if (looksLikeJsonDocument(original)) {
    onRedaction('json-document');
    return `[REDACTED_JSON_DOCUMENT length=${original.length}]`;
  }

  let out = safeString(original, maxLength);
  const replacements = [
    [/\b((?:Set-Cookie|Cookie)\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]'],
    [/\b((?:Authorization|Proxy-Authorization|X-API-Key|API-Key|Token|Secret|Password|Passwd)\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]'],
    [/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]'],
    [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, '[REDACTED_JWT]'],
    [/((?:token|secret|password|passwd|api[_-]?key|signature|sig|credential|authorization|auth|cookie|session(?:id|key)?)=)[^&\s#;]+/gi, '$1[REDACTED]'],
    [/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1[REDACTED_USERINFO]@'],
  ];
  for (const [pattern, replacement] of replacements) {
    const next = out.replace(/** @type {RegExp} */ (pattern), String(replacement));
    if (next !== out) onRedaction('embedded-secret');
    out = next;
  }
  return out;
}

/** Read diagnostic fields without invoking accessors or coercing objects. */
export function readDiagnosticDataProperty(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

// V8 can expose its own lazy stack as an accessor. Preserve that known getter
// without invoking arbitrary authored accessors on Error-like values.
const nativeStackGetter = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get;
const initialStackFormatter = readDiagnosticDataProperty(Error, 'prepareStackTrace');
const nativeDomExceptionGetters = typeof DOMException === 'function'
  ? Object.fromEntries(['name', 'message'].map((key) => [key, Object.getOwnPropertyDescriptor(DOMException.prototype, key)?.get]))
  : {};

function readDiagnosticErrorText(error, key) {
  try {
    let current = error;
    for (let depth = 0; current && depth < 4; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) return descriptor.value;
        const nativeGetter = nativeDomExceptionGetters[key];
        // Native DOMException accessors brand-check their receiver. An own
        // user getter or a look-alike Error object is never called as a getter.
        if (nativeGetter && descriptor.get === nativeGetter) return Reflect.apply(nativeGetter, error, []);
        return undefined;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    // Revoked proxies and incompatible intrinsic getter receivers are omitted.
  }
  return undefined;
}

function readDiagnosticErrorStack(error) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'stack');
    if (!descriptor) return undefined;
    if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) return descriptor.value;
    if (!nativeStackGetter || descriptor.get !== nativeStackGetter) return undefined;
    for (const key of ['name', 'message']) if (typeof readDiagnosticErrorText(error, key) !== 'string') return undefined;
    // Keep the host formatter that was already in place; do not execute a
    // replacement formatter installed by an inspected value or later caller.
    const formatter = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
    if (formatter && (!Object.prototype.hasOwnProperty.call(formatter, 'value')
      || formatter.value !== initialStackFormatter)) return undefined;
    return Reflect.apply(nativeStackGetter, error, []);
  } catch {
    return undefined;
  }
}

/**
 * Keep only the established error text and an allowlist of classification fields.
 * Causes contain classification only: no new message/stack/body disclosure.
 * Getter fields are omitted; cycles and more than three causes are bounded.
 */
export function normalizeDiagnosticError(error, options = {}) {
  const onRedaction = typeof options.onRedaction === 'function' ? options.onRedaction : () => {};
  const maxMessageLength = clampInt(options.maxMessageLength, 32, 4096, 1024);
  const maxStackLength = clampInt(options.maxStackLength, 32, 4096, 4096);
  const seen = new WeakSet();
  const clean = (value, maxLength) => {
    if (typeof value !== 'string') return undefined;
    // Bound work before the generic redactor attempts JSON parsing/regexes.
    if (value.length > 16384) {
      onRedaction('oversized-error-field');
      return `[OMITTED_OVERSIZED_ERROR_FIELD length=${value.length}]`;
    }
    return redactDiagnosticString(value, { maxLength, onRedaction });
  };
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object') {
      const scalar = ['number', 'boolean', 'bigint', 'symbol'].includes(typeof value) ? String(value) : value;
      const message = depth === 0 ? clean(scalar, maxMessageLength) : undefined;
      return message === undefined ? {} : { message };
    }
    if (seen.has(value)) {
      onRedaction('error-cause-circular');
      return { omitted: 'CIRCULAR_ERROR_CAUSE' };
    }
    if (depth > 3) {
      onRedaction('error-cause-depth');
      return { omitted: 'ERROR_CAUSE_DEPTH_LIMIT' };
    }
    seen.add(value);
    const omitted = readDiagnosticDataProperty(value, 'omitted');
    if (depth > 0 && ['CIRCULAR_ERROR_CAUSE', 'ERROR_CAUSE_DEPTH_LIMIT'].includes(omitted)) {
      return { omitted };
    }
    const out = {};
    const name = readDiagnosticErrorText(value, 'name');
    if (typeof name === 'string') out.name = clean(name, 128);
    if (depth === 0) {
      const message = clean(readDiagnosticErrorText(value, 'message'), maxMessageLength);
      const stack = clean(readDiagnosticErrorStack(value), maxStackLength);
      if (message !== undefined) out.message = message;
      if (stack !== undefined) out.stack = stack;
    }
    for (const key of ['code', 'category', 'correlation_id']) {
      const field = clean(readDiagnosticDataProperty(value, key), 128);
      if (field !== undefined) out[key] = field;
    }
    const retryable = readDiagnosticDataProperty(value, 'retryable');
    if (typeof retryable === 'boolean') out.retryable = retryable;
    const cause = readDiagnosticDataProperty(value, 'cause');
    if (cause && typeof cause === 'object') out.cause = visit(cause, depth + 1);
    return out;
  };
  return visit(error, 0);
}

/**
 * Recursively produce a JSON-safe diagnostic value. This function is
 * deliberately lossy; it is for triage metadata, never project persistence.
 *
 * @param {any} value
 * @param {{
 *   key?: string,
 *   depth?: number,
 *   maxDepth?: number,
 *   maxKeys?: number,
 *   maxArrayLength?: number,
 *   maxStringLength?: number,
 *   seen?: WeakSet<object>,
 *   onRedaction?: (reason: string) => void,
 * }} [options]
 * @returns {any}
 */
export function redactDiagnosticValue(value, options = {}) {
  const key = String(options.key || '');
  const depth = Number(options.depth || 0);
  const maxDepth = clampInt(options.maxDepth, 1, 12, 5);
  const maxKeys = clampInt(options.maxKeys, 1, 100, 30);
  const maxArrayLength = clampInt(options.maxArrayLength, 1, 100, 20);
  const maxStringLength = clampInt(options.maxStringLength, 32, 4096, 512);
  const seen = options.seen || new WeakSet();
  const onRedaction = typeof options.onRedaction === 'function' ? options.onRedaction : () => {};
  const normalized = normalizedKey(key);

  if (normalized && SECRET_KEY_RE.test(normalized)) {
    onRedaction('secret-key');
    return '[REDACTED_SECRET]';
  }
  if (normalized && BODY_KEY_RE.test(normalized) && typeof value !== 'number' && typeof value !== 'boolean') {
    onRedaction('body-key');
    return '[REDACTED_BODY]';
  }

  if (value === null || value === undefined) return value === undefined ? null : value;
  if (typeof value === 'string') {
    return redactDiagnosticString(value, { maxLength: maxStringLength, onRedaction });
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${String(value)}n`;
  if (typeof value === 'symbol') return safeString(String(value), 128);
  if (typeof value === 'function') return `[Function ${safeString(value.name || 'anonymous', 80)}]`;

  let nativeError = false;
  try { nativeError = value instanceof Error || (typeof DOMException === 'function' && value instanceof DOMException); }
  catch { return '[UNREADABLE_OBJECT]'; }
  if (nativeError) {
    return normalizeDiagnosticError(value, {
      maxMessageLength: maxStringLength, maxStackLength: 2048, onRedaction,
    });
  }

  if (depth >= maxDepth) {
    onRedaction('max-depth');
    return '[REDACTED_MAX_DEPTH]';
  }
  if (typeof value !== 'object') return safeString(value, maxStringLength);
  if (seen.has(value)) {
    onRedaction('circular');
    return '[CIRCULAR]';
  }
  seen.add(value);

  // Preserve file/blob metadata while never reading or serializing its bytes.
  const objectTag = Object.prototype.toString.call(value);
  if (objectTag === '[object Blob]' || objectTag === '[object File]') {
    const result = {
      kind: objectTag === '[object File]' ? 'File' : 'Blob',
      size: Number.isFinite(Number(value.size)) ? Number(value.size) : null,
      type: safeString(value.type || '', 128),
    };
    if (objectTag === '[object File]') result.name = safeBaseName(value.name || '', onRedaction);
    return result;
  }

  if (Array.isArray(value)) {
    const out = value.slice(0, maxArrayLength).map((item) => redactDiagnosticValue(item, {
      ...options,
      key: '',
      depth: depth + 1,
      seen,
      onRedaction,
    }));
    if (value.length > maxArrayLength) {
      onRedaction('array-limit');
      out.push(`[${value.length - maxArrayLength} more item(s) omitted]`);
    }
    return out;
  }

  const keys = Object.keys(value).sort();
  /** @type {Record<string, any>} */
  const out = Object.create(null);
  for (const childKey of keys.slice(0, maxKeys)) {
    let childValue;
    try {
      childValue = value[childKey];
    } catch {
      childValue = '[PROPERTY_READ_FAILED]';
    }
    const outputKey = redactDiagnosticString(childKey, { maxLength: 128, onRedaction });
    out[outputKey] = redactDiagnosticValue(childValue, {
      ...options,
      key: childKey,
      depth: depth + 1,
      seen,
      onRedaction,
    });
  }
  if (keys.length > maxKeys) {
    onRedaction('key-limit');
    out.__omittedKeyCount = keys.length - maxKeys;
  }
  return { ...out };
}

/** @param {any} value */
function safeBaseName(value, onRedaction = () => {}) {
  const parts = String(value || '').split(/[\\/]+/);
  return redactDiagnosticString(parts[parts.length - 1] || 'screenshot.png', { maxLength: 160, onRedaction });
}

/**
 * Console capture intentionally omits object values. Application actions can
 * contain complete editor documents, so a generic deep serializer is unsafe.
 *
 * @param {any[]} args
 * @param {{ onRedaction?: (reason: string) => void }} [options]
 */
export function summarizeConsoleArguments(args, options = {}) {
  const onRedaction = typeof options.onRedaction === 'function' ? options.onRedaction : () => {};
  return Array.from(args || []).slice(0, 12).map((value) => {
    if (value instanceof Error) {
      return redactDiagnosticValue(value, { onRedaction, maxStringLength: 384 });
    }
    if (value === null || typeof value !== 'object') {
      return redactDiagnosticValue(value, { onRedaction, maxStringLength: 384 });
    }
    const tag = Object.prototype.toString.call(value).slice(8, -1) || 'Object';
    let keys = [];
    try {
      keys = Object.keys(value).sort().slice(0, 20).map((key) => redactDiagnosticString(key, { maxLength: 80, onRedaction }));
    } catch {
      // A hostile proxy may reject key enumeration.
    }
    onRedaction('console-object-values');
    return {
      kind: safeString(tag, 80),
      keys,
      values: '[OMITTED_BY_POLICY]',
    };
  });
}

/** @param {any} value */
function looksLikePackDocumentObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let keys;
  try {
    keys = new Set(Object.keys(value).map(normalizedKey));
  } catch {
    return true;
  }
  if (keys.has('formatversion') || keys.has('namespace') || keys.has('controls') || keys.has('uidefs')) return true;
  if (keys.has('header') && keys.has('modules')) return true;
  if (keys.has('variables') && (keys.has('formatversion') || keys.has('globals'))) return true;
  return false;
}

/**
 * Preserve useful shallow counters/codes while omitting nested arbitrary
 * object values. This is used at public metadata boundaries so a caller cannot
 * bypass body-key redaction by placing a document below an unknown key.
 *
 * @param {any} value
 * @param {{ onRedaction?: (reason: string) => void, depth?: number }} [options]
 * @returns {any}
 */
export function summarizeDiagnosticMetadata(value, options = {}) {
  const onRedaction = typeof options.onRedaction === 'function' ? options.onRedaction : () => {};
  const depth = Number(options.depth || 0);

  if (value === null || value === undefined || typeof value !== 'object' || value instanceof Error) {
    return redactDiagnosticValue(value, { onRedaction, maxStringLength: 512 });
  }
  const objectTag = Object.prototype.toString.call(value);
  if (objectTag === '[object Blob]' || objectTag === '[object File]') {
    return redactDiagnosticValue(value, { onRedaction, maxStringLength: 512 });
  }
  if (looksLikePackDocumentObject(value)) {
    onRedaction('pack-document-object');
    return '[REDACTED_PACK_DOCUMENT]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => {
      if (item === null || typeof item !== 'object' || item instanceof Error) {
        return summarizeDiagnosticMetadata(item, { onRedaction, depth: depth + 1 });
      }
      onRedaction('metadata-array-object-values');
      return {
        kind: safeString(Object.prototype.toString.call(item).slice(8, -1) || 'Object', 80),
        keys: (() => {
          try {
            return Object.keys(item).sort().slice(0, 20).map((key) => redactDiagnosticString(key, { maxLength: 80, onRedaction }));
          } catch {
            return [];
          }
        })(),
        values: '[OMITTED_BY_POLICY]',
      };
    });
  }

  if (depth >= 1) {
    onRedaction('metadata-nested-object-values');
    return {
      kind: safeString(Object.prototype.toString.call(value).slice(8, -1) || 'Object', 80),
      keys: (() => {
        try {
          return Object.keys(value).sort().slice(0, 20).map((key) => redactDiagnosticString(key, { maxLength: 80, onRedaction }));
        } catch {
          return [];
        }
      })(),
      values: '[OMITTED_BY_POLICY]',
    };
  }

  let keys = [];
  try {
    keys = Object.keys(value).sort().slice(0, 30);
  } catch {
    onRedaction('metadata-object-read');
    return '[UNREADABLE_OBJECT]';
  }
  /** @type {Record<string, any>} */
  const out = Object.create(null);
  for (const key of keys) {
    let child;
    try {
      child = value[key];
    } catch {
      child = '[PROPERTY_READ_FAILED]';
    }
    const normalized = normalizedKey(key);
    if (SECRET_KEY_RE.test(normalized) || (BODY_KEY_RE.test(normalized) && typeof child !== 'number' && typeof child !== 'boolean')) {
      out[redactDiagnosticString(key, { maxLength: 128, onRedaction })] = redactDiagnosticValue(child, { key, onRedaction });
      continue;
    }
    if (child === null || typeof child !== 'object' || child instanceof Error) {
      out[redactDiagnosticString(key, { maxLength: 128, onRedaction })] = summarizeDiagnosticMetadata(child, { onRedaction, depth: depth + 1 });
      continue;
    }
    out[redactDiagnosticString(key, { maxLength: 128, onRedaction })] = summarizeDiagnosticMetadata(child, { onRedaction, depth: depth + 1 });
  }
  return { ...out };
}

/** @param {string} text */
function utf8ByteLength(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text)).byteLength;
  // Browser fallback that also handles surrogate pairs and lone surrogates.
  let bytes = 0;
  const value = String(text);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** @param {any} clock */
function readNowIso(clock) {
  try {
    const value = typeof clock === 'function' ? clock() : new Date();
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  } catch {
    // Fall through to the real clock.
  }
  return new Date().toISOString();
}

/** @param {any} globalObject */
function makeSessionId(globalObject) {
  try {
    if (globalObject?.crypto && typeof globalObject.crypto.randomUUID === 'function') {
      return `site-${globalObject.crypto.randomUUID()}`;
    }
  } catch {
    // Use a non-cryptographic correlation fallback below. This is not a token.
  }
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 14);
  return `site-${time}-${random}`;
}

/** @param {any} value */
function normalizeOperation(value) {
  const operation = String(value || '').toLowerCase();
  if (['import', 'export', 'preview', 'edit', 'commit', 'inspect', 'startup'].includes(operation)) return operation;
  return 'site';
}

const cancelledDiagnosticCodes = new Set(['NODE_JOB_CANCELLED', 'NODE_REQUEST_CANCELLED']);

// An AbortError can also represent a timeout. Use explicit cancellation
// metadata, never words in messages or the generic exception name alone.
function isCancelledDiagnostic(value, resultCode) {
  const category = readDiagnosticDataProperty(value, 'category');
  if (category === 'timeout') return false;
  return category === 'cancelled'
    || cancelledDiagnosticCodes.has(readDiagnosticDataProperty(value, 'code'))
    || cancelledDiagnosticCodes.has(resultCode);
}

/** @param {any} value */
function normalizeLevel(value) {
  const level = String(value || '').toLowerCase();
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') return level;
  return 'info';
}

/** @param {string} source @param {string} message */
function classifyDiagnostic(source, message) {
  const haystack = `${source} ${message}`.toLowerCase();
  if (haystack.includes('unhandledrejection') || haystack.includes('unhandled rejection')) {
    return { kind: 'unhandled_rejection', operation: 'site' };
  }
  if (haystack.includes('workspace-edit') || haystack.includes('editor.gesture')) {
    return { kind: 'operation', operation: 'edit' };
  }
  if (haystack.includes('pack-import') || haystack.includes('vanilla-reference') || haystack.includes('asset-index') || haystack.includes('import')) {
    return { kind: 'operation', operation: 'import' };
  }
  if (haystack.includes('schema-export') || haystack.includes('export')) {
    return { kind: 'operation', operation: 'export' };
  }
  if (haystack.includes('preview') || haystack.includes('canvas') || haystack.includes('texture') || haystack.includes('font') || haystack.includes('render')) {
    return { kind: 'operation', operation: 'preview' };
  }
  if (haystack.includes('window.error')) return { kind: 'error', operation: 'site' };
  return { kind: 'diagnostic', operation: 'site' };
}

/** @param {string} actionType */
function classifyAction(actionType) {
  const type = String(actionType || '').toLowerCase();
  const operation = type.startsWith('pack/') ? 'import' : type.startsWith('preview/') ? 'preview' : 'site';
  const phase = type.includes('start') ? 'start' : type.includes('success') ? 'success' : type.includes('error') ? 'failure' : 'action';
  return { operation, phase };
}

/**
 * @typedef {{
 *  appVersion?: string,
 *  maxBytes?: number,
 *  maxEvents?: number,
 *  clock?: () => (Date|string|number),
 *  idFactory?: () => string,
 *  globalObject?: any,
 *  diagnosticsStore?: any,
 *  store?: any,
 *  clipboardWriteText?: (text: string) => Promise<void>|void,
 *  downloadText?: (params: { filename: string, text: string, mime: string }) => Promise<void>|void,
 * }} SiteDiagnosticOptions
 */

/**
 * Create a reusable site diagnostic recorder.
 *
 * @param {SiteDiagnosticOptions} [options]
 */
export function createSiteDiagnosticSession(options = {}) {
  const globalObject = options.globalObject || globalThis;
  const appVersion = safeString(options.appVersion || 'unknown', 128);
  const maxBytes = clampInt(options.maxBytes, MIN_MAX_BYTES, MAX_MAX_BYTES, DEFAULT_SITE_DIAGNOSTIC_MAX_BYTES);
  const maxEvents = clampInt(options.maxEvents, 20, 10000, DEFAULT_MAX_EVENTS);
  const clock = options.clock;
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => makeSessionId(globalObject);

  let active = false;
  let sessionId = null;
  let startedAtIso = null;
  let stoppedAtIso = null;
  let includeUserAgent = false;
  let capturedUserAgent = null;
  let consoleCaptureEnabled = false;
  let explicitResultCode = null;
  let resultSummary = null;
  let nextSequence = 1;
  let droppedEventCount = 0;
  let redactionCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  let cancelledCount = 0;
  let consoleEventCount = 0;
  /** @type {any[]} */
  let events = [];
  /** @type {any[]} */
  let screenshotReferences = [];
  /** @type {(() => void)[]} */
  const sourceUnsubscribers = [];
  /** @type {Map<string, Function>} */
  const originalConsoleMethods = new Map();
  let globalHelperUninstall = null;

  function noteRedaction() {
    redactionCount += 1;
  }

  function resetSessionState() {
    try {
      sessionId = redactDiagnosticString(idFactory(), { maxLength: 128, onRedaction: noteRedaction }) || makeSessionId(globalObject);
    } catch {
      sessionId = makeSessionId(globalObject);
    }
    startedAtIso = readNowIso(clock);
    stoppedAtIso = null;
    explicitResultCode = null;
    resultSummary = null;
    nextSequence = 1;
    droppedEventCount = 0;
    redactionCount = 0;
    errorCount = 0;
    warningCount = 0;
    cancelledCount = 0;
    consoleEventCount = 0;
    events = [];
    screenshotReferences = [];
  }

  /** @param {any} event */
  function appendEvent(event) {
    if (!active) return { ok: false, code: 'SITE_DIAG_NOT_ACTIVE' };
    const level = normalizeLevel(event.level);
    const normalized = {
      sequence: nextSequence++,
      atIso: readNowIso(clock),
      kind: redactDiagnosticString(event.kind || 'marker', { maxLength: 64, onRedaction: noteRedaction }),
      operation: normalizeOperation(event.operation),
      phase: redactDiagnosticString(event.phase || 'event', { maxLength: 64, onRedaction: noteRedaction }),
      level,
      resultCode: redactDiagnosticString(event.resultCode || 'SITE_EVENT_RECORDED', { maxLength: 96, onRedaction: noteRedaction }),
      message: redactDiagnosticString(event.message || '', { maxLength: 512, onRedaction: noteRedaction }),
      details: redactDiagnosticValue(event.details ?? null, {
        onRedaction: noteRedaction,
        maxStringLength: 512,
      }),
    };
    if (level === 'error') errorCount += 1;
    if (level === 'warn') warningCount += 1;
    if (normalized.phase === 'cancelled') cancelledCount += 1;
    events.push(normalized);
    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
      droppedEventCount += 1;
    }
    return { ok: true, code: 'SITE_DIAG_EVENT_RECORDED', sequence: normalized.sequence };
  }

  function installConsoleCapture() {
    const consoleObject = globalObject?.console;
    if (!consoleObject || originalConsoleMethods.size > 0) return;
    for (const level of CONSOLE_LEVELS) {
      const original = typeof consoleObject[level] === 'function' ? consoleObject[level] : null;
      if (!original) continue;
      originalConsoleMethods.set(level, original);
      const wrapped = function siteDiagnosticConsoleWrapper(...args) {
        try {
          if (active) {
            consoleEventCount += 1;
            appendEvent({
              kind: 'console',
              operation: 'site',
              phase: 'console',
              level: level === 'log' ? 'info' : level,
              resultCode: `CONSOLE_${level.toUpperCase()}`,
              message: `console.${level}`,
              details: { args: summarizeConsoleArguments(args, { onRedaction: noteRedaction }) },
            });
          }
        } catch {
          // Logging must never break the application being diagnosed.
        }
        return original.apply(consoleObject, args);
      };
      try {
        consoleObject[level] = wrapped;
      } catch {
        originalConsoleMethods.delete(level);
      }
    }
  }

  function uninstallConsoleCapture() {
    const consoleObject = globalObject?.console;
    for (const [level, original] of originalConsoleMethods.entries()) {
      try {
        consoleObject[level] = original;
      } catch {
        // Best effort; the console may be read-only in a hardened context.
      }
    }
    originalConsoleMethods.clear();
  }

  /**
   * @param {{ includeUserAgent?: boolean, captureConsole?: boolean }} [startOptions]
   */
  function start(startOptions = {}) {
    if (active) return { ok: false, code: 'SITE_DIAG_ALREADY_ACTIVE', sessionId };
    resetSessionState();
    includeUserAgent = Boolean(startOptions.includeUserAgent);
    capturedUserAgent = null;
    if (includeUserAgent) {
      try {
        capturedUserAgent = redactDiagnosticString(globalObject?.navigator?.userAgent || '(unavailable)', {
          maxLength: 512,
          onRedaction: noteRedaction,
        });
      } catch {
        capturedUserAgent = '(unavailable)';
      }
    }
    consoleCaptureEnabled = Boolean(startOptions.captureConsole);
    active = true;
    if (consoleCaptureEnabled) installConsoleCapture();
    appendEvent({
      kind: 'session',
      operation: 'site',
      phase: 'start',
      level: 'info',
      resultCode: 'SITE_DIAG_STARTED',
      message: 'Site diagnostic session started',
      details: { includeUserAgent, consoleCaptureEnabled },
    });
    return { ok: true, code: 'SITE_DIAG_STARTED', sessionId, startedAtIso };
  }

  /**
   * @param {any} operation
   * @param {any} phase
   * @param {any} resultCode
   * @param {any} [details]
   */
  function recordOperation(operation, phase, resultCode, details = null) {
    const rawPhase = String(phase || 'event').trim().toLowerCase();
    const cancelled = /^(cancel|cancelled|canceled)$/.test(rawPhase) || isCancelledDiagnostic(details, resultCode);
    const normalizedPhase = cancelled ? 'cancelled' : /^(error|fail|failed|failure|reject|rejected)$/.test(rawPhase)
      ? 'failure'
      : /^warn(?:ing|ed)?$/.test(rawPhase)
        ? 'warning'
        : safeString(rawPhase || 'event', 64);
    return appendEvent({
      kind: 'operation',
      operation,
      phase: normalizedPhase,
      level: normalizedPhase === 'failure' ? 'error' : normalizedPhase === 'warning' ? 'warn' : 'info',
      resultCode: resultCode || 'OPERATION_RECORDED',
      message: `${normalizeOperation(operation)}:${normalizedPhase}`,
      details: summarizeDiagnosticMetadata(details, { onRedaction: noteRedaction }),
    });
  }

  /** @param {any} action */
  function recordStoreAction(action) {
    if (!active) return { ok: false, code: 'SITE_DIAG_NOT_ACTIVE' };
    const type = safeString(action?.type || 'unknown', 160);
    const classification = classifyAction(type);
    return appendEvent({
      kind: 'operation',
      operation: classification.operation,
      phase: classification.phase,
      level: classification.phase === 'failure' ? 'error' : 'debug',
      resultCode: 'STORE_ACTION',
      message: type,
      // Never pass the action object: it may contain an entire opened file.
      details: { actionType: type, actionPayload: '[OMITTED_BY_POLICY]' },
    });
  }

  /** @param {any} entry */
  function captureDiagnosticEntry(entry) {
    if (!active) return { ok: false, code: 'SITE_DIAG_NOT_ACTIVE' };
    const rawError = readDiagnosticDataProperty(entry, 'error');
    const source = safeString(entry?.source || 'diagnostics', 160);
    const message = safeString(entry?.message || '', 512);
    const classification = classifyDiagnostic(source, message);
    const cancelled = isCancelledDiagnostic(rawError);
    const level = cancelled ? 'info' : normalizeLevel(entry?.level || (rawError ? 'error' : 'info'));
    const kind = classification.kind === 'unhandled_rejection'
      ? classification.kind
      : level === 'error'
        ? 'error'
        : classification.kind;
    return appendEvent({
      kind,
      operation: classification.operation,
      phase: cancelled ? 'cancelled' : level === 'error' ? 'failure' : 'diagnostic',
      level,
      resultCode:
        cancelled ? 'APP_OPERATION_CANCELLED' : kind === 'unhandled_rejection'
          ? 'UNHANDLED_REJECTION_CAPTURED'
          : level === 'error'
            ? 'APP_ERROR_CAPTURED'
            : 'APP_DIAGNOSTIC_CAPTURED',
      message,
      details: {
        diagnosticId: entry?.id || null,
        source,
        data: summarizeDiagnosticMetadata(entry?.data ?? null, { onRedaction: noteRedaction }),
        error: rawError ? normalizeDiagnosticError(rawError, {
          onRedaction: noteRedaction, maxMessageLength: 512, maxStackLength: 2048,
        }) : null,
      },
    });
  }

  /**
   * @param {{ fileName: string, capturedAtIso?: string, view?: string, note?: string }} reference
   */
  function addScreenshotReference(reference) {
    if (!active) return { ok: false, code: 'SITE_DIAG_NOT_ACTIVE' };
    if (screenshotReferences.length >= MAX_SCREENSHOT_REFERENCES) {
      return { ok: false, code: 'SITE_DIAG_SCREENSHOT_LIMIT' };
    }
    const item = {
      sequence: screenshotReferences.length + 1,
      fileName: safeBaseName(reference?.fileName || `screenshot-${screenshotReferences.length + 1}.png`, noteRedaction),
      capturedAtIso: reference?.capturedAtIso
        ? readNowIso(() => reference.capturedAtIso)
        : readNowIso(clock),
      view: redactDiagnosticString(reference?.view || 'unspecified', { maxLength: 128, onRedaction: noteRedaction }),
      note: redactDiagnosticString(reference?.note || '', { maxLength: 256, onRedaction: noteRedaction }),
    };
    screenshotReferences.push(item);
    appendEvent({
      kind: 'screenshot_reference',
      operation: item.view.toLowerCase().includes('preview') ? 'preview' : 'site',
      phase: 'captured',
      level: 'info',
      resultCode: 'SCREENSHOT_REFERENCE_ADDED',
      message: item.fileName,
      details: { screenshotSequence: item.sequence, view: item.view },
    });
    return { ok: true, code: 'SITE_DIAG_SCREENSHOT_ADDED', screenshot: { ...item } };
  }

  function deriveResultCode(additionalDroppedEvents = 0, trimmedMetadataCount = 0) {
    if (!sessionId || !startedAtIso) return 'SITE_DIAGNOSTIC_NOT_STARTED';
    if (active) return 'SITE_DIAGNOSTIC_IN_PROGRESS';
    if (!stoppedAtIso) return 'SITE_DIAGNOSTIC_NOT_STOPPED';
    if (errorCount > 0) return 'SITE_DIAGNOSTIC_ERRORS_CAPTURED';
    if (warningCount > 0 || droppedEventCount + additionalDroppedEvents > 0 || trimmedMetadataCount > 0) {
      return 'SITE_DIAGNOSTIC_WARNINGS_CAPTURED';
    }
    if (explicitResultCode) return explicitResultCode;
    return 'SITE_DIAGNOSTIC_PASS';
  }

  function makeSnapshotObject() {
    return {
      schema: SITE_DIAGNOSTIC_SCHEMA,
      schemaVersion: SITE_DIAGNOSTIC_SCHEMA_VERSION,
      session: {
        id: sessionId,
        startedAtIso,
        stoppedAtIso,
        appVersion,
        userAgentIncluded: includeUserAgent,
        userAgent: capturedUserAgent,
      },
      policy: {
        explicitStartStop: true,
        consoleCaptureOptIn: true,
        consoleCaptureEnabled,
        packAndFileBodiesCollected: false,
        objectValuesFromConsoleCollected: false,
        maxBytes,
        maxEvents,
        maxScreenshotReferences: MAX_SCREENSHOT_REFERENCES,
      },
      outcome: {
        resultCode: deriveResultCode(),
        operatorResultCode: explicitResultCode,
        summary: resultSummary,
      },
      summary: {
        eventCount: events.length,
        droppedEventCount,
        redactionCount,
        errorCount,
        warningCount,
        cancelledCount,
        consoleEventCount,
        screenshotReferenceCount: screenshotReferences.length,
        outputBytes: 0,
      },
      screenshotReferences: screenshotReferences.map((item) => ({ ...item })),
      events: events.map((event) => ({ ...event })),
    };
  }

  /**
   * Serialize, then trim oldest events and screenshot notes until the exact
   * UTF-8 document size is at or below maxBytes.
   */
  function buildFittedDocument() {
    const document = makeSnapshotObject();
    const originalEvents = document.events;
    let sizeTrimmedEvents = 0;
    let trimmedMetadataCount = 0;
    let text = '';

    function serializeCurrent() {
      document.summary.eventCount = document.events.length;
      document.summary.droppedEventCount = droppedEventCount + sizeTrimmedEvents;
      document.summary.trimmedMetadataCount = trimmedMetadataCount;
      document.outcome.resultCode = deriveResultCode(sizeTrimmedEvents, trimmedMetadataCount);
      document.summary.outputBytes = 0;
      text = stableStringify(document, { indent: 2, sortKeys: true, finalNewline: true });
      for (let iteration = 0; iteration < 5; iteration += 1) {
        const bytes = utf8ByteLength(text);
        if (document.summary.outputBytes === bytes) break;
        document.summary.outputBytes = bytes;
        text = stableStringify(document, { indent: 2, sortKeys: true, finalNewline: true });
      }
      return utf8ByteLength(text);
    }

    if (serializeCurrent() > maxBytes && originalEvents.length > 1) {
      // Find the smallest number of oldest events that must be omitted. This
      // keeps fitting O(log n) instead of serializing once per dropped event.
      let low = 1;
      let high = originalEvents.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        sizeTrimmedEvents = middle;
        document.events = originalEvents.slice(middle);
        if (serializeCurrent() <= maxBytes) high = middle;
        else low = middle + 1;
      }
      sizeTrimmedEvents = low;
      document.events = originalEvents.slice(low);
      serializeCurrent();
    }

    while (utf8ByteLength(text) > maxBytes) {
      const note = document.screenshotReferences.find((item) => item.note);
      if (note) {
        note.note = '';
        trimmedMetadataCount += 1;
        serializeCurrent();
        continue;
      }
      // This is unreachable with the enforced 16 KiB minimum, but retain an
      // explicit safe failure marker if the schema grows in the future.
      sizeTrimmedEvents += document.events.length + 1;
      document.events = [];
      document.screenshotReferences = [];
      document.outcome.summary = '[OMITTED_TO_FIT_SIZE_LIMIT]';
      document.summary.eventCount = 0;
      document.summary.screenshotReferenceCount = 0;
      serializeCurrent();
      break;
    }
    return { document, text, bytes: utf8ByteLength(text) };
  }

  function snapshot() {
    return buildFittedDocument().document;
  }

  function toJson() {
    return buildFittedDocument().text;
  }

  /**
   * @param {{ resultCode?: string, summary?: any }} [stopOptions]
   */
  function stop(stopOptions = {}) {
    if (!active) {
      return { ok: false, code: sessionId ? 'SITE_DIAG_ALREADY_STOPPED' : 'SITE_DIAG_NOT_STARTED', sessionId };
    }
    explicitResultCode = stopOptions.resultCode
      ? redactDiagnosticString(stopOptions.resultCode, { maxLength: 96, onRedaction: noteRedaction })
      : null;
    resultSummary = summarizeDiagnosticMetadata(stopOptions.summary ?? null, {
      onRedaction: noteRedaction,
    });
    appendEvent({
      kind: 'session',
      operation: 'site',
      phase: 'stop',
      level: 'info',
      resultCode: explicitResultCode || 'SITE_DIAG_STOPPED',
      message: 'Site diagnostic session stopped',
      details: { callerSuppliedResult: Boolean(explicitResultCode) },
    });
    stoppedAtIso = readNowIso(clock);
    active = false;
    uninstallConsoleCapture();
    const fitted = buildFittedDocument();
    return {
      ok: true,
      code: 'SITE_DIAG_STOPPED',
      sessionId,
      resultCode: fitted.document.outcome.resultCode,
      bytes: fitted.bytes,
      snapshot: fitted.document,
    };
  }

  async function copy() {
    if (!sessionId || !startedAtIso) return { ok: false, code: 'SITE_DIAG_NOT_STARTED' };
    if (active || !stoppedAtIso) return { ok: false, code: 'SITE_DIAG_NOT_STOPPED', sessionId };
    const text = toJson();
    let writer = options.clipboardWriteText;
    if (typeof writer !== 'function') {
      const clipboard = globalObject?.navigator?.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') writer = (value) => clipboard.writeText(value);
    }
    if (typeof writer !== 'function') return { ok: false, code: 'SITE_DIAG_CLIPBOARD_UNAVAILABLE' };
    try {
      await writer(text);
      return { ok: true, code: 'SITE_DIAG_COPIED', bytes: utf8ByteLength(text) };
    } catch (error) {
      return {
        ok: false,
        code: 'SITE_DIAG_COPY_FAILED',
        error: redactDiagnosticString(error instanceof Error ? error.message : error, { maxLength: 256 }),
      };
    }
  }

  async function download() {
    if (!sessionId || !startedAtIso) return { ok: false, code: 'SITE_DIAG_NOT_STARTED' };
    if (active || !stoppedAtIso) return { ok: false, code: 'SITE_DIAG_NOT_STOPPED', sessionId };
    const text = toJson();
    const stamp = (stoppedAtIso || startedAtIso || readNowIso(clock)).replace(/[:.]/g, '-');
    const suffix = safeString(sessionId || 'unknown', 128).replace(/[^a-zA-Z0-9_-]/g, '_').slice(-24);
    const filename = `jsonui_site_diagnostic_${stamp}_${suffix}.json`;
    try {
      if (typeof options.downloadText === 'function') {
        await options.downloadText({ filename, text, mime: 'application/json' });
      } else {
        const documentObject = globalObject?.document;
        const Url = globalObject?.URL;
        const BlobConstructor = globalObject?.Blob;
        if (!documentObject || !Url || typeof Url.createObjectURL !== 'function' || typeof BlobConstructor !== 'function') {
          return { ok: false, code: 'SITE_DIAG_DOWNLOAD_UNAVAILABLE' };
        }
        const blob = new BlobConstructor([text], { type: 'application/json' });
        downloadBlobSafely23({ filename, blob }, globalObject);
      }
      return { ok: true, code: 'SITE_DIAG_DOWNLOADED', filename, bytes: utf8ByteLength(text) };
    } catch (error) {
      return {
        ok: false,
        code: 'SITE_DIAG_DOWNLOAD_FAILED',
        error: redactDiagnosticString(error instanceof Error ? error.message : error, { maxLength: 256 }),
      };
    }
  }

  function status() {
    return {
      active,
      sessionId,
      startedAtIso,
      stoppedAtIso,
      eventCount: events.length,
      screenshotReferenceCount: screenshotReferences.length,
      droppedEventCount,
      redactionCount,
      maxBytes,
      consoleCaptureEnabled: active && consoleCaptureEnabled,
      resultCode: deriveResultCode(),
    };
  }

  function installGlobalHelper(name = '__JSONUI_SITE_DIAGNOSTICS__') {
    const key = safeString(name, 128) || '__JSONUI_SITE_DIAGNOSTICS__';
    const previous = globalObject[key];
    globalObject[key] = api;
    const uninstall = () => {
      try {
        if (globalObject[key] === api) {
          if (previous === undefined) delete globalObject[key];
          else globalObject[key] = previous;
        }
      } catch {
        // ignore
      }
    };
    globalHelperUninstall = uninstall;
    return uninstall;
  }

  function dispose() {
    if (active) stop({ resultCode: 'SITE_DIAGNOSTIC_DISPOSED' });
    uninstallConsoleCapture();
    while (sourceUnsubscribers.length > 0) {
      try {
        sourceUnsubscribers.pop()();
      } catch {
        // ignore
      }
    }
    if (globalHelperUninstall) globalHelperUninstall();
    globalHelperUninstall = null;
  }

  const api = {
    start,
    stop,
    status,
    recordOperation,
    recordStoreAction,
    captureDiagnosticEntry,
    addScreenshotReference,
    snapshot,
    toJson,
    copy,
    download,
    installGlobalHelper,
    dispose,
  };

  // Subscribe immediately, but handlers are inert until explicit start().
  try {
    if (options.diagnosticsStore?.events && typeof options.diagnosticsStore.events.on === 'function') {
      sourceUnsubscribers.push(options.diagnosticsStore.events.on('entry', captureDiagnosticEntry));
    }
  } catch {
    // The headless API remains usable even without the app diagnostics store.
  }
  try {
    if (options.store?.events && typeof options.store.events.on === 'function') {
      sourceUnsubscribers.push(options.store.events.on('action', ({ action }) => recordStoreAction(action)));
    }
  } catch {
    // The headless API remains usable even without the app store.
  }

  return api;
}
