// Window-side OS-write boundary. Injected platform APIs keep import side-effect free.
// All application writes share one broker. Native Ctrl/Cmd+C is outside this lock.
import { TEXT_COPY_LIMITS } from './ui-text-copy.js';

export function createClipboardBroker({ globalObject = globalThis, slowAfterMs = 5000, features = {} } = {}) {
  let pending = false, sequence = 0;
  const enabled = { editor: features.editor !== false, adapter: features.adapter !== false };
  const busyError = () => Object.assign(new Error('COPY_BUSY'), { code: 'COPY_BUSY' });
  function runExclusive(writer, { onSlow } = {}) {
    if (pending) return Promise.reject(busyError());
    pending = true;
    let task, timer;
    try { task = writer(); } catch (error) { task = Promise.reject(error); }
    if (typeof onSlow === 'function' && typeof globalObject.setTimeout === 'function') {
      timer = globalObject.setTimeout(() => { try { onSlow(); } catch { /* notification only */ } }, slowAfterMs);
    }
    return Promise.resolve(task).finally(() => {
      pending = false;
      if (timer !== undefined) globalObject.clearTimeout?.(timer);
    });
  }
  function writePrepared(intent, { event, isCurrent = () => true, onResult, onSlow } = {}) {
    const requestId = `copy-${++sequence}`;
    const sourceLabel = typeof intent?.sourceLabel === 'string' ? intent.sourceLabel.slice(0, 256) : '表示文字';
    const outcome = (status, code) => Object.freeze({ ok: status === 'written', status, code, requestId, sourceLabel });
    function immediate(code) {
      const result = outcome('blocked', code);
      return { ...result, promise: Promise.resolve(result) };
    }
    if (!intent || typeof intent.text !== 'string' || !intent.text.length) return immediate('COPY_TEXT_UNRESOLVED');
    if (intent.text.length > TEXT_COPY_LIMITS.codeUnits) return immediate('COPY_TEXT_LIMIT');
    if (enabled[intent.mode || 'editor'] !== true) return immediate('COPY_FEATURE_DISABLED');
    if (event?.isTrusted !== true) return immediate('COPY_GESTURE_REQUIRED');
    if (!isCurrent()) return immediate('COPY_SNAPSHOT_STALE');
    if (pending) return immediate('COPY_BUSY');
    const clipboard = globalObject.navigator?.clipboard;
    if (globalObject.isSecureContext !== true || typeof clipboard?.writeText !== 'function') return immediate('COPY_API_UNAVAILABLE');
    // No await, permission query, fetch, worker message, or queue before this write.
    const writing = runExclusive(() => clipboard.writeText(intent.text), { onSlow: () => onSlow?.(outcome('writing', 'COPY_WAITING')) });
    const promise = writing.then(
      () => outcome('written', 'COPY_WRITTEN'),
      error => outcome('failed', error?.name === 'NotAllowedError' ? 'COPY_WRITE_DENIED' : 'COPY_WRITE_FAILED'),
    ).then(result => {
      // A scope change cannot undo an already submitted write or turn fulfillment into cancellation.
      try { onResult?.(result); } catch { /* outcome remains authoritative */ }
      return result;
    });
    return { ...outcome('writing', 'COPY_WRITING'), promise };
  }
  return Object.freeze({ runExclusive, writePrepared, isBusy: () => pending,
    isEnabled: mode => Object.hasOwn(enabled, mode) && enabled[mode],
    setEnabled: (mode, value) => {
      if (!Object.hasOwn(enabled, mode)) return false;
      enabled[mode] = value === true;
      // Feature disable affects new submissions; an OS write already sent cannot be cancelled.
      return true;
    },
  });
}
