/*
  Minimal event bus (pub/sub) utility.

  - Framework-agnostic
  - Safe listener isolation (one listener error won't break others)
  - Intended for cross-module events (e.g., store action/change notifications)
*/

/**
 * @template T
 * @typedef {(payload: T) => void} Listener
 */

/**
 * @returns {{
 *  on: (eventName: string, fn: Listener<any>) => () => void,
 *  emit: (eventName: string, payload: any) => void,
 *  clear: (eventName?: string) => void,
 * }}
 */
export function createEventBus() {
  /** @type {Map<string, Set<Listener<any>>>} */
  const listenersByEvent = new Map();

  /**
   * @param {string} eventName
   * @param {Listener<any>} fn
   */
  function on(eventName, fn) {
    const set = listenersByEvent.get(eventName) || new Set();
    set.add(fn);
    listenersByEvent.set(eventName, set);
    return () => {
      const current = listenersByEvent.get(eventName);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) listenersByEvent.delete(eventName);
    };
  }

  /**
   * @param {string} eventName
   * @param {any} payload
   */
  function emit(eventName, payload) {
    const set = listenersByEvent.get(eventName);
    if (!set || set.size === 0) return;

    // Snapshot to avoid issues if a listener unsubscribes itself.
    const snapshot = Array.from(set);
    for (const fn of snapshot) {
      try {
        fn(payload);
      } catch (err) {
        // Listener errors should not break the bus.
        // eslint-disable-next-line no-console
        console.error('[event-bus] listener error', err);

        // Best-effort report to global diagnostics if installed.
        let wasReporting = false;
        try {
          /** @type {any} */
          const g = globalThis;
          wasReporting = Boolean(g.__JSONUI_DIAGNOSTICS_REPORTING__);
          if (!wasReporting) g.__JSONUI_DIAGNOSTICS_REPORTING__ = true;

          if (!wasReporting) {
            const diag = g.__JSONUI_DIAGNOSTICS__;
            if (diag && typeof diag.captureError === 'function') {
              diag.captureError(err, {
                source: 'event-bus',
                message: 'event-bus listener error',
                data: { eventName },
              });
            }
          }
        } catch {
          // ignore
        } finally {
          try {
            /** @type {any} */
            const g = globalThis;
            if (!wasReporting) g.__JSONUI_DIAGNOSTICS_REPORTING__ = false;
          } catch {
            // ignore
          }
        }
      }
    }
  }

  /**
   * @param {string=} eventName
   */
  function clear(eventName) {
    if (!eventName) {
      listenersByEvent.clear();
      return;
    }
    listenersByEvent.delete(eventName);
  }

  return {
    on,
    emit,
    clear,
  };
}
