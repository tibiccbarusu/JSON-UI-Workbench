// run_id: resume-20260905t175130z; stage_ref: phase-001/stage-002
export const MiB = 1024 * 1024;
export const LIMITS = Object.freeze({
  zipBytes: 768 * MiB, entries: 120000, centralBytes: 128 * MiB,
  expandedBytes: 2048 * MiB, entryBytes: 64 * MiB, compressedEntryBytes: 128 * MiB,
  textBytes: 8 * MiB, jsonBytes: 16 * MiB, replyBytes: 32 * MiB,
  ratio: 200, ratioFloor: 8 * MiB, packs: 4, diskBytes: 2304 * MiB,
  requests: 24, queue: 8, connections: 32, uploadMs: 300000,
  jobMs: 120000, projectionMs: 30000, idleMs: 30 * 60000,
  batchJobMs: 240000, batchSocketMs: 270000, batchClientMs: 300000,
});
export function fail(code, status = 400) { const e = new Error(code); e.code = code; e.status = status; throw e; }
export function boundedInteger(value, fallback, maximum) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > maximum) fail('INVALID_BYTE_LIMIT');
  return n;
}
