/** Bounded asynchronous metadata queue. Raster readiness must never leave a
 * queued nine-slice permanently loading; every request settles or times out.
 * This module has no DOM or Node dependency and is shared by test harnesses. */
// 原文不正・曖昧な参照・容量超過は再試行しない。通信の一時失敗だけを区別する。
const transientCodes = new Set(['TEXTURE_SIDECAR_TIMEOUT', 'NODE_REQUEST_TIMEOUT', 'NODE_READ_BUSY',
  'NODE_READ_QUEUE_LIMIT', 'NODE_READ_QUEUE_FULL', 'NODE_READ_QUEUE_TIMEOUT']);
function transientFailure(error) {
  return transientCodes.has(String(error?.code || error?.message || ''))
    || error?.name === 'TimeoutError'
    || error?.name === 'TypeError' && ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'].includes(error.message);
}

export class TextureMetadataCache {
  constructor({ maxEntries = 8192, concurrency = 4, timeoutMs = 10000, onChange = () => {},
    retryBaseMs = 1000, retryMaxMs = 30000, maxAutomaticRetries = 2, now = () => Date.now() } = {}) {
    this.maxEntries = Math.max(1, Math.min(8192, Math.floor(maxEntries) || 8192));
    this.concurrency = Math.max(1, Math.min(16, Math.floor(concurrency) || 4));
    this.timeoutMs = Math.max(10, Math.min(30000, Number(timeoutMs) || 10000));
    this.onChange = onChange;
    this.now = now;
    this.retryBaseMs = Math.max(10, Math.min(30000, Number(retryBaseMs) || 1000));
    this.retryMaxMs = Math.max(this.retryBaseMs, Math.min(120000, Number(retryMaxMs) || 30000));
    this.maxAutomaticRetries = Math.max(0, Math.min(3, Math.floor(Number(maxAutomaticRetries)) || 0));
    this.records = new Map(); this.queue = []; this.active = 0; this.epoch = 0;
    this.controllers = new Set();
    this.retryStates = new WeakMap(); this.retryWakeups = new Map(); this.retryTimer = null;
    this.retryCounts = { transientFailures: 0, retryAttempts: 0, automaticWakeups: 0, recovered: 0 };
  }

  get(key) {
    const record = this.records.get(key);
    const retry = record && this.retryStates.get(record);
    // getも需要の一つ。描画側のget→既存ならreturnという経路で失敗を永久保持しない。
    if (record?.status === 'error' && retry?.retryable && this.now() >= retry.at) {
      this.removeRetryWakeup(key);
      this.retryCounts.retryAttempts++;
      this.enqueue(key, record, retry);
    }
    return record || null;
  }

  request(key, load) {
    const existing = this.records.get(key);
    if (existing) {
      const retry = this.retryStates.get(existing);
      if (existing.status === 'error' && retry?.retryable) retry.load = load;
      return this.get(key);
    }
    if (this.records.size >= this.maxEntries) {
      // Evict settled entries only. A pending request always retains its identity.
      const oldest = [...this.records].find(([, entry]) => entry.status !== 'loading');
      if (oldest) { this.records.delete(oldest[0]); this.removeRetryWakeup(oldest[0]); }
      else return { status: 'error', code: 'TEXTURE_SIDECAR_CACHE_LIMIT', value: null };
    }
    const record = { status: 'loading', value: null };
    this.records.set(key, record);
    const retry = { load, attempts: 0, retryable: false, at: 0 };
    this.retryStates.set(record, retry);
    this.enqueue(key, record, retry);
    return record;
  }

  enqueue(key, record, retry) {
    retry.attempts++;
    Object.assign(record, { status: 'loading', value: null });
    delete record.code;
    this.queue.push({ key, load: retry.load, record, retry, epoch: this.epoch });
    this.drain();
  }

  clear() {
    this.epoch += 1;
    this.queue.length = 0;
    this.records.clear();
    this.retryWakeups.clear(); clearTimeout(this.retryTimer); this.retryTimer = null;
    for (const controller of this.controllers) controller.abort();
    // Old requests release their own slot in finally, even if the reader ignores
    // AbortSignal. Never reset active while those finally blocks can still run.
  }

  snapshot({ diagnostics = false } = {}) {
    const base = { entries: this.records.size, active: this.active, queued: this.queue.length };
    if (!diagnostics) return base;
    let transientErrors = 0, nextRetryAtMs = null;
    for (const record of this.records.values()) {
      const retry = this.retryStates.get(record);
      if (record.status !== 'error' || !retry?.retryable) continue;
      transientErrors++;
      nextRetryAtMs = nextRetryAtMs === null ? retry.at : Math.min(nextRetryAtMs, retry.at);
    }
    return { ...base, ...this.retryCounts, transientErrors, scheduledWakeups: this.retryWakeups.size,
      nextRetryAtMs, maxAutomaticRetries: this.maxAutomaticRetries };
  }

  scheduleRetryWakeup(job) {
    // 再描画通知を最大2回（設定上限3回）だけ予約する。通知自体は読込をしない。
    // 表示外素材は再取得せず、上限後は実際のget/requestだけで低頻度に回復する。
    if (job.retry.attempts <= this.maxAutomaticRetries) this.retryWakeups.set(job.key, {
      record: job.record, epoch: job.epoch, at: job.retry.at,
    });
    this.armRetryWakeup();
  }

  removeRetryWakeup(key) {
    if (this.retryWakeups.delete(key)) this.armRetryWakeup();
  }

  armRetryWakeup() {
    clearTimeout(this.retryTimer); this.retryTimer = null;
    if (!this.retryWakeups.size) return;
    const at = Math.min(...[...this.retryWakeups.values()].map(entry => entry.at));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const due = this.now();
      for (const [key, entry] of this.retryWakeups) {
        if (entry.at > due) continue;
        this.retryWakeups.delete(key);
        if (entry.epoch !== this.epoch || this.records.get(key) !== entry.record || entry.record.status !== 'error') continue;
        this.retryCounts.automaticWakeups++;
        try { this.onChange(key, entry.record); } catch { /* UI observer cannot stop recovery. */ }
      }
      this.armRetryWakeup();
    }, Math.max(1, at - this.now()));
    this.retryTimer?.unref?.();
  }

  settleRetryState(job, error = null) {
    const retry = job.retry;
    if (job.record.status === 'error' && transientFailure(error || job.record)) {
      this.retryCounts.transientFailures++;
      retry.retryable = true;
      const delay = retry.attempts > this.maxAutomaticRetries ? this.retryMaxMs
        : Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.min(20, retry.attempts - 1));
      retry.at = this.now() + delay;
      this.scheduleRetryWakeup(job);
    } else {
      if (retry.attempts > 1 && ['ready', 'missing'].includes(job.record.status)) this.retryCounts.recovered++;
      retry.retryable = false; retry.at = 0;
      retry.load = null; // 完了・恒久失敗した読込closureは保持しない。
      this.removeRetryWakeup(job.key);
    }
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (job.epoch !== this.epoch) continue;
      this.active += 1;
      this.run(job);
    }
  }

  async run(job) {
    const controller = new AbortController();
    this.controllers.add(controller);
    let timer;
    let cancelled;
    const stopped = new Promise((_, reject) => {
      cancelled = () => reject(Object.assign(new Error('TEXTURE_SIDECAR_CANCELLED'), { code: 'TEXTURE_SIDECAR_CANCELLED' }));
      controller.signal.addEventListener('abort', cancelled, { once: true });
      timer = setTimeout(() => {
        reject(Object.assign(new Error('TEXTURE_SIDECAR_TIMEOUT'), { code: 'TEXTURE_SIDECAR_TIMEOUT' }));
        controller.abort();
      }, this.timeoutMs);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => job.load(controller.signal)), stopped]);
      if (job.epoch !== this.epoch || this.records.get(job.key) !== job.record) return;
      const valid = result && ['ready', 'missing', 'error'].includes(result.status);
      Object.assign(job.record, valid ? result : { status: 'error', value: null, code: 'TEXTURE_SIDECAR_STATE_INVALID' });
      this.settleRetryState(job);
    } catch (error) {
      if (job.epoch !== this.epoch || this.records.get(job.key) !== job.record) return;
      const code = /^TEXTURE_SIDECAR_[A-Z_]+$/u.test(String(error?.code)) ? error.code : 'TEXTURE_SIDECAR_LOAD_FAILED';
      Object.assign(job.record, { status: 'error', value: null, code });
      this.settleRetryState(job, error);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', cancelled);
      this.controllers.delete(controller);
      this.active -= 1;
      this.drain();
      if (job.epoch === this.epoch) {
        try { this.onChange(job.key, job.record); } catch { /* UI observer cannot stop the queue. */ }
      }
    }
  }
}
