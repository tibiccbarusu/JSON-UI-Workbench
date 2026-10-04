/*
  diagnostics-store.js (S020)

  A small diagnostics collector for a buildless (no-framework) web app.

  Goals:
  - Collect log entries with severity levels.
  - Capture window errors + unhandled rejections.
  - Keep a bounded in-memory buffer.
  - Provide a subscription mechanism for UI re-render.
  - Export a machine-friendly snapshot for debugging.

  Security:
  - Treat all collected messages as untrusted strings.
  - UI rendering must not use unsafe sinks (no innerHTML).
*/

import { createEventBus } from '../state-store/event-bus.js';
import { sanitizeForLog } from '../security/sanitize.js';
import { buildDiagnosticsSnapshot, sanitizeDiagnosticEntry } from './log-export.js';
import { normalizeDiagnosticError } from './site-diagnostic-session.js';

export const DIAGNOSTIC_LEVELS = /** @type {const} */ (['debug', 'info', 'warn', 'error']);

/**
 * @typedef {'debug'|'info'|'warn'|'error'} DiagnosticLevel
 */

/**
 * @typedef {{
 *  id: string,
 *  tsIso: string,
 *  level: DiagnosticLevel,
 *  source: string,
 *  message: string,
 *  data?: any,
 *  error?: {
 *    name?: string,
 *    message?: string,
 *    stack?: string,
 *    code?: string,
 *    category?: string,
 *    retryable?: boolean,
 *    correlation_id?: string,
 *    cause?: object,
 *  },
 * }} DiagnosticEntry
 */

/**
 * @typedef {{
 *  maxEntries?: number,
 * }} DiagnosticsOptions
 */

/**
 * @param {any} v
 */
function safeString(v, maxLen = 20000) {
  try {
    return sanitizeForLog(v, { maxLen });
  } catch {
    return '[unprintable]';
  }
}

/**
 * @param {any} level
 * @returns {DiagnosticLevel}
 */
function normalizeLevel(level) {
  const s = safeString(level).toLowerCase();
  if (s === 'debug' || s === 'info' || s === 'warn' || s === 'error') return /** @type {DiagnosticLevel} */ (s);
  return 'info';
}

/**
 * @param {any} err
 * @returns {object} Bounded, redacted text and optional error classification.
 */
function normalizeError(err) { return normalizeDiagnosticError(err); }

/**
 * @param {number} n
 */
function clampInt(n, min, max) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * ISO timestamp with millisecond precision.
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Create a bounded diagnostics store.
 *
 * @param {DiagnosticsOptions} [opts]
 */
export function createDiagnosticsStore(opts = {}) {
  const maxEntries = clampInt(opts.maxEntries ?? 400, 50, 5000);

  /** @type {DiagnosticEntry[]} */
  const entries = [];
  let nextId = 1;
  let droppedEntryCount = 0;

  const events = createEventBus();

  /**
   * @param {DiagnosticEntry} entry
   */
  function push(entry) {
    const safeEntry = sanitizeDiagnosticEntry(entry);
    entries.push(safeEntry);
    if (entries.length > maxEntries) {
      const dropped = entries.length - maxEntries;
      entries.splice(0, dropped);
      droppedEntryCount += dropped;
    }
    events.emit('entry', safeEntry);
    events.emit('change', { type: 'entry', entry: safeEntry });
  }

  /**
   * @param {DiagnosticLevel} level
   */
  function countByLevel(level) {
    let c = 0;
    for (const e of entries) if (e.level === level) c += 1;
    return c;
  }

  function getCounts() {
    return {
      total: entries.length,
      debug: countByLevel('debug'),
      info: countByLevel('info'),
      warn: countByLevel('warn'),
      error: countByLevel('error'),
    };
  }

  /**
   * @param {DiagnosticLevel} level
   * @param {string} message
   * @param {{ source?: string, data?: any, error?: any }} [meta]
   */
  function log(level, message, meta = {}) {
    const entry = {
      id: `d${nextId++}`,
      tsIso: nowIso(),
      level: normalizeLevel(level),
      source: safeString(meta.source || meta.module || 'app'),
      message: safeString(message),
      data: meta.where && meta.data && typeof meta.data === 'object'
        ? { where: meta.where, ...meta.data }
        : meta.where
          ? { where: meta.where, data: meta.data }
          : meta.data,
      error: meta.error ? normalizeError(meta.error) : undefined,
    };
    push(entry);
    return entry.id;
  }

  /**
   * Capture an exception with best-effort stack trace.
   *
   * @param {any} err
   * @param {{ source?: string, message?: string, data?: any }} [meta]
   */
  function captureError(err, meta = {}) {
    const e = normalizeError(err);
    const message = meta.message
      ? safeString(meta.message)
      : (e.message || 'Unknown error');

    return log('error', message, {
      source: meta.source || meta.module || 'error',
      data: meta.where && meta.data && typeof meta.data === 'object'
        ? { where: meta.where, ...meta.data }
        : meta.where
          ? { where: meta.where, data: meta.data }
          : meta.data,
      error: err,
    });
  }

  /**
   * @param {ErrorEvent} ev
   */
  function captureWindowErrorEvent(ev) {
    // ev.error may be undefined for some script errors.
    const errObj = ev.error || null;
    const locationHint = (ev.filename || ev.lineno || ev.colno)
      ? `${safeString(ev.filename)}:${safeString(ev.lineno)}:${safeString(ev.colno)}`
      : '';

    const message = locationHint
      ? `${safeString(ev.message)} (${locationHint})`
      : safeString(ev.message);

    captureError(errObj || ev.message, {
      source: 'window.error',
      message,
      data: {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      },
    });
  }

  /**
   * @param {PromiseRejectionEvent} ev
   */
  function captureUnhandledRejectionEvent(ev) {
    const reason = ev.reason;
    const normalized = normalizeError(reason);
    const msg = normalized.message || 'Unhandled promise rejection';

    captureError(reason, {
      source: 'window.unhandledrejection',
      message: msg,
    });
  }

  /**
   * Install global handlers (idempotent).
   *
   * @returns {() => void} uninstall
   */
  function installGlobalHandlers() {
    /** @type {any} */
    const g = globalThis;

    // Store a reference so lower-level modules (event-bus/store) can report
    // swallowed listener errors without importing this module.
    g.__JSONUI_DIAGNOSTICS__ = api;

    // Avoid double-install.
    if (installGlobalHandlers._installed) {
      return () => {};
    }
    installGlobalHandlers._installed = true;

    const onError = (ev) => captureWindowErrorEvent(ev);
    const onRejection = (ev) => captureUnhandledRejectionEvent(ev);

    globalThis.addEventListener('error', onError);
    globalThis.addEventListener('unhandledrejection', onRejection);

    return () => {
      installGlobalHandlers._installed = false;
      try {
        globalThis.removeEventListener('error', onError);
        globalThis.removeEventListener('unhandledrejection', onRejection);
      } catch {
        // ignore
      }
      try {
        if (g.__JSONUI_DIAGNOSTICS__ === api) delete g.__JSONUI_DIAGNOSTICS__;
      } catch {
        // ignore
      }
    };
  }
  installGlobalHandlers._installed = false;

  /**
   * @param {{ includeEnv?: boolean, extra?: any }} [options]
   */
  function exportSnapshot(options = {}) {
    const includeEnv = Boolean(options.includeEnv);
    return buildDiagnosticsSnapshot({
      entries,
      droppedEntryCount,
      includeEnv,
      context: options.extra || null,
      maxBytes: options.maxBytes,
      environment: includeEnv ? {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '(no navigator)',
        url: typeof location !== 'undefined' ? location.href : '(no location)',
        timeZone: (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
          } catch {
            return '(unknown)';
          }
        })(),
        viewport: typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight } : null,
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : null,
      } : null,
    }).document;
  }

  function clear() {
    entries.length = 0;
    droppedEntryCount = 0;
    events.emit('change', { type: 'clear' });
  }

  function getEntries() {
    return entries.slice();
  }

  const api = {
    log,
    captureError,
    captureWindowErrorEvent,
    captureUnhandledRejectionEvent,
    getEntries,
    getCounts,
    clear,
    events,
    installGlobalHandlers,
    exportSnapshot,
  };

  return api;
}
