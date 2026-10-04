/*
  i18n (S021)

  Goals:
  - Load flat JSON string tables from /app/locales/<locale>.json
  - Provide t(key, params) with fallback:
      active -> configured default (Japanese) -> "⟦MISSING:<key>⟧"
  - Allow runtime locale switching + persistence (best-effort localStorage)

  Security:
  - Translation values are treated as untrusted strings.
  - This module returns plain strings only (render into safe sinks).
*/

/**
 * @typedef {Object} I18nOptions
 * @property {string} defaultLocale
 * @property {string[]} supportedLocales
 * @property {URL|string} localeBaseUrl Base URL where <locale>.json lives.
 * @property {string} [storageKey]
 * @property {number} [loadTimeoutMs] Total fetch and body deadline; defaults to 15000 ms.
 * @property {(key: string, locale: string) => void} [onMissingKey]
 * @property {(err: any, context: { locale?: string, url?: string, phase: string }) => void} [onLoadError]
 */

/**
 * @typedef {Object} I18nApi
 * @property {() => string} getLocale
 * @property {() => string[]} getSupportedLocales
 * @property {() => boolean} isReady
 * @property {(listener: () => void) => () => void} subscribe
 * @property {(key: string, params?: Record<string, any>) => string} t
 * @property {(locale: string) => Promise<void>} setLocale
 * @property {(initialLocale?: string|null) => Promise<void>} init
 */

/**
 * Convert underscore locale IDs (Minecraft-style) to BCP47-ish tag.
 * Example: en_US -> en-US
 * @param {string} locale
 */
export function toBcp47(locale) {
  return String(locale || '').replace(/_/g, '-');
}

/**
 * @param {I18nOptions} options
 * @returns {I18nApi}
 */
export function createI18n(options) {
  const defaultLocale = String(options?.defaultLocale || 'ja_JP');
  const supportedLocales = Array.isArray(options?.supportedLocales)
    ? options.supportedLocales.map(String)
    : [defaultLocale];

  const localeBaseUrl = options?.localeBaseUrl instanceof URL
    ? options.localeBaseUrl
    : new URL(String(options?.localeBaseUrl || ''), window.location.href);

  const storageKey = String(options?.storageKey || 'jsonui.locale');
  const onMissingKey = typeof options?.onMissingKey === 'function' ? options.onMissingKey : null;
  const onLoadError = typeof options?.onLoadError === 'function' ? options.onLoadError : null;
  const loadTimeoutMs = Number.isFinite(options?.loadTimeoutMs) && options.loadTimeoutMs > 0
    ? Math.min(60000, options.loadTimeoutMs) : 15000;

  /** @type {Map<string, Record<string, string>>} */
  const tables = new Map();
  const pendingTables = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {Set<string>} */
  const warnedMissing = new Set();

  let currentLocale = defaultLocale;
  let ready = false;
  let selectionGeneration = 0;

  /**
   * @param {string} locale
   */
  function isSupported(locale) {
    return supportedLocales.includes(locale);
  }

  /**
   * @returns {string|null}
   */
  function safeReadStoredLocale() {
    try {
      const v = window.localStorage?.getItem(storageKey);
      return v ? String(v) : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} locale
   */
  function safeWriteStoredLocale(locale) {
    try {
      window.localStorage?.setItem(storageKey, String(locale));
    } catch {
      // ignore (storage may be blocked)
    }
  }

  /**
   * @param {string} locale
   */
  async function loadTable(locale) {
    if (tables.has(locale)) return;
    if (pendingTables.has(locale)) return pendingTables.get(locale);

    const pending = fetchTable(locale);
    pendingTables.set(locale, pending);
    try { await pending; } finally { pendingTables.delete(locale); }
  }

  async function fetchTable(locale) {
    const url = new URL(`${locale}.json`, localeBaseUrl);
    const controller = new AbortController();
    let timer;
    try {
      // The total deadline includes reading/parsing the response body. Race the
      // work as well as aborting it, so an adapter that ignores AbortSignal
      // cannot retain pendingTables forever or install a late stale table.
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('I18N_TABLE_TIMEOUT');
          reject(error);
          controller.abort(error);
        }, loadTimeoutMs);
      });
      const request = (async () => {
        const res = await fetch(url.toString(), { cache: 'no-cache', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        return res.json();
      })();
      const json = await Promise.race([request, deadline]);

      // Validate: flat object of string->string.
      /** @type {Record<string, string>} */
      const table = Object.create(null);
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new TypeError('I18N_TABLE_INVALID: expected a flat object of strings');
      }
      for (const [k, v] of Object.entries(json)) {
        if (typeof v !== 'string') throw new TypeError('I18N_TABLE_INVALID: expected string values');
        table[k] = v;
      }
      tables.set(locale, table);
    } catch (err) {
      if (onLoadError) {
        try {
          onLoadError(err, { locale, url: url.toString(), phase: 'fetch/parse' });
        } catch {
          // ignore
        }
      }
      // A failed load is not cached as a successful empty translation. The
      // current selection falls back to Japanese; an explicit later selection
      // may retry. No automatic retry loop or retry timer is created.
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {string} template
   * @param {Record<string, any>} params
   */
  function format(template, params) {
    const s = String(template || '');
    if (!params || typeof params !== 'object') return s;
    return s.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
      if (!Object.prototype.hasOwnProperty.call(params, name)) return `{${name}}`;
      const v = params[name];
      return v === null || v === undefined ? '' : String(v);
    });
  }

  /**
   * @param {string} key
   * @param {Record<string, any>} [params]
   */
  function t(key, params) {
    const k = String(key || '');
    const active = tables.get(currentLocale) || {};
    const base = tables.get(defaultLocale) || {};

    if (Object.prototype.hasOwnProperty.call(active, k)) {
      return format(active[k], params || {});
    }

    if (Object.prototype.hasOwnProperty.call(base, k)) {
      return format(base[k], params || {});
    }

    const warnId = `${currentLocale}:${k}`;
    if (!warnedMissing.has(warnId)) {
      warnedMissing.add(warnId);
      if (onMissingKey) {
        try {
          onMissingKey(k, currentLocale);
        } catch {
          // ignore
        }
      }
    }

    return `⟦MISSING:${k}⟧`;
  }

  function emit() {
    for (const fn of Array.from(listeners)) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  }

  /**
   * @param {string} locale
   */
  async function setLocale(locale) {
    const generation = ++selectionGeneration;
    const next = isSupported(locale) ? locale : defaultLocale;
    await loadTable(defaultLocale);
    if (next !== defaultLocale) await loadTable(next);
    if (generation !== selectionGeneration) return;
    // Do not persist a locale whose table failed to load. All display helpers
    // must observe the same working language until an explicit retry succeeds.
    currentLocale = tables.has(next) ? next : tables.has(currentLocale) ? currentLocale : defaultLocale;
    if (tables.has(currentLocale)) safeWriteStoredLocale(currentLocale);
    ready = tables.has(currentLocale);
    emit();
  }

  /**
   * Initialize by loading the default table and applying stored/initial locale.
   * @param {string|null|undefined} [initialLocale]
   */
  async function init(initialLocale) {
    const stored = safeReadStoredLocale();
    const requested = (initialLocale && typeof initialLocale === 'string')
      ? initialLocale
      : stored;

    const locale = requested && isSupported(requested) ? requested : defaultLocale;
    await setLocale(locale);
  }

  /** @param {() => void} listener */
  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getLocale: () => currentLocale,
    getSupportedLocales: () => supportedLocales.slice(),
    isReady: () => ready,
    subscribe,
    t,
    setLocale,
    init,
  };
}
