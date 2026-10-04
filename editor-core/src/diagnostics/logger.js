/*
  logger.js (S020)

  Per-module logger factory.

  - Records entries into the shared diagnostics store.
  - Optionally also mirrors to console (kept minimal).

  NOTE: This project is intentionally buildless, so this is a tiny utility,
  not a full logging framework.
*/

/**
 * @typedef {{
 *  log: (level: 'debug'|'info'|'warn'|'error', message: string, meta?: any) => string,
 *  captureError: (err: any, meta?: any) => string,
 * }} DiagnosticsLike
 */

/**
 * @param {DiagnosticsLike} diagnostics
 * @param {string} source
 * @param {{ mirrorToConsole?: boolean }} [opts]
 */
export function createLogger(diagnostics, source, opts = {}) {
  const src = String(source || 'app');
  const mirrorToConsole = Boolean(opts.mirrorToConsole);

  /**
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} message
   * @param {any} [data]
   */
  function log(level, message, data) {
    const id = diagnostics.log(level, message, { source: src, data });

    if (mirrorToConsole) {
      try {
        const prefix = `[${src}]`;
        if (level === 'debug') console.debug(prefix, message, data);
        else if (level === 'info') console.info(prefix, message, data);
        else if (level === 'warn') console.warn(prefix, message, data);
        else console.error(prefix, message, data);
      } catch {
        // ignore
      }
    }

    return id;
  }

  /**
   * @param {any} err
   * @param {string} [message]
   * @param {any} [data]
   */
  function error(err, message, data) {
    const msg = message || (err instanceof Error ? err.message : String(err || 'UNKNOWN_ERROR'));
    const id = diagnostics.captureError(err, { source: src, message: msg, data });

    if (mirrorToConsole) {
      try {
        console.error(`[${src}]`, msg, err);
      } catch {
        // ignore
      }
    }

    return id;
  }

  return {
    debug: (message, data) => log('debug', message, data),
    info: (message, data) => log('info', message, data),
    warn: (message, data) => log('warn', message, data),
    error,
  };
}
