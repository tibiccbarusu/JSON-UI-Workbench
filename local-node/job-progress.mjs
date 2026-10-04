/** Worker内の読取専用草稿を工程境界で取り消す。確定書込みは途中取消しない。 */
export function createJobProgress({ cancellation, send = () => {} } = {}) {
  const flag = cancellation instanceof SharedArrayBuffer ? new Int32Array(cancellation) : null;
  return function checkpoint(phase, completed = null, total = null) {
    if (flag && Atomics.load(flag, 0) !== 0) {
      throw Object.assign(new Error('NODE_JOB_CANCELLED'), {
        code: 'NODE_JOB_CANCELLED', status: 499, category: 'cancelled', retryable: false,
      });
    }
    if (typeof phase !== 'string' || phase.length > 80) return;
    const counted = Number.isSafeInteger(completed) && Number.isSafeInteger(total)
      && total > 0 && completed >= 0 && completed <= total;
    send({ phase, completed: counted ? completed : null, total: counted ? total : null,
      percent: counted ? Math.floor(completed * 100 / total) : null,
      updated_at: new Date().toISOString() });
  };
}
