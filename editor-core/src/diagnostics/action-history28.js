import { sanitizeDebugText } from './debug-redaction.js';

/** 有限長の操作履歴。連続した同一選択だけを集約し、保存・移動等は省略しない。 */
export function createActionHistory28({ limit = 500, coalesceWindowMs = 750, now = () => Date.now() } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new RangeError('ACTION_HISTORY_LIMIT_INVALID');
  if (!Number.isFinite(coalesceWindowMs) || coalesceWindowMs < 0 || coalesceWindowMs > 5000) throw new RangeError('ACTION_HISTORY_WINDOW_INVALID');
  const entries = [];
  let total = 0, coalesced = 0, dropped = 0, lastTime = -Infinity;
  const safe = (value, length) => sanitizeDebugText(typeof value === 'string' ? value.slice(0, length) : '');
  return {
    entries,
    record({ type, summary } = {}) {
      const ms = now();
      if (!Number.isFinite(ms)) throw new RangeError('ACTION_HISTORY_TIME_INVALID');
      const tsIso = new Date(ms).toISOString();
      const row = { tsIso, last_ts_iso: tsIso, type: safe(type, 128), summary: safe(summary, 2048), count: 1 };
      const last = entries.at(-1);
      total++;
      if (row.type === 'editor/selectNode' && last?.type === row.type && last.summary === row.summary
        && ms >= lastTime && ms - lastTime <= coalesceWindowMs && last.count < 1000000) {
        last.count++; last.last_ts_iso = tsIso; coalesced++;
      } else {
        entries.push(row);
        if (entries.length > limit) dropped += entries.shift().count;
      }
      lastTime = ms;
    },
    stats() { return { total_events: total, retained_records: entries.length, coalesced_events: coalesced,
      dropped_events: dropped, limit, coalesce_window_ms: coalesceWindowMs }; },
  };
}
