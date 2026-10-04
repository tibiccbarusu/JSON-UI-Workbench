// Node の read / preview-image 共通4枠を、パックを跨いで共有する。
// 応答本文の消費まで枠を保持し、待機中の取消は通信を開始せず除去する。
export function createNodeReadQueue({ concurrency = 4, maxPending = 256 } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1
    || !Number.isSafeInteger(maxPending) || maxPending < 1) throw new Error('NODE_READ_QUEUE_CONFIG');
  let active = 0;
  const pending = [];
  function drain() {
    while (active < concurrency && pending.length) {
      const item = pending.shift();
      item.signal?.removeEventListener('abort', item.cancel);
      if (item.signal?.aborted) { item.reject(item.signal.reason); continue; }
      active++;
      Promise.resolve().then(() => {
        item.signal?.throwIfAborted();
        return item.task();
      }).then(value => {
        item.signal?.throwIfAborted();
        return value;
      }).then(item.resolve, item.reject).finally(() => { active--; drain(); });
    }
  }
  return {
    run(task, { signal } = {}) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (active >= concurrency && pending.length >= maxPending) return Promise.reject(new Error('NODE_READ_QUEUE_LIMIT'));
      return new Promise((resolve, reject) => {
        const item = { task, signal, resolve, reject, cancel: null };
        item.cancel = () => {
          const index = pending.indexOf(item);
          if (index >= 0) pending.splice(index, 1);
          reject(signal.reason);
        };
        signal?.addEventListener('abort', item.cancel, { once: true });
        pending.push(item);
        drain();
      });
    },
    snapshot() { return { active, pending: pending.length, concurrency, maxPending }; },
  };
}

export function waitForNodeReadRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
