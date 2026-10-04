import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeDiagnostic } from './debug-bundle.mjs';

const defaults = Object.freeze({ fileBytes: 1024 * 1024, queuedBytes: 256 * 1024, recordBytes: 32 * 1024 });
const invalid = () => Object.assign(new Error('NODE_LOG_PATH_UNSAFE'), { code: 'NODE_LOG_PATH_UNSAFE' });

/**
 * ローカル診断 JSONL。1 MiB × 2 世代、保留 256 KiB、単一 writer。
 * 書込み障害・上限省略は snapshot に残し、業務要求は失敗させない。
 * fsync による電源断耐性は保証しない。同期完了は flush の結果で区別する。
 */
export function createServerLog(logDirectory, { secrets = () => [], limits = defaults } = {}) {
  const budget = { ...defaults, ...limits };
  for (const key of Object.keys(defaults)) if (!Number.isSafeInteger(budget[key]) || budget[key] < 256) throw new TypeError('NODE_LOG_LIMIT_INVALID');
  let tail = Promise.resolve(), queuedBytes = 0, written = 0, dropped = 0, omitted = 0, rotations = 0;
  let failed = false, failureCode = null, closed = false, initialized = false, directory;

  async function regularFile(file, optional = true) {
    const info = await lstat(file).catch(cause => { if (optional && cause.code === 'ENOENT') return null; throw cause; });
    if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) throw invalid();
    return info;
  }
  async function writeLine(line) {
    if (!initialized) {
      await mkdir(logDirectory, { recursive: true, mode: 0o700 });
      const directoryInfo = await lstat(logDirectory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw invalid();
      directory = await realpath(logDirectory);
      if (process.platform === 'win32' && path.join(directory, 'server.log.1').length + 1 > 240) throw invalid();
      initialized = true;
    }
    const file = path.join(directory, 'server.log'), previous = file + '.1';
    const info = await regularFile(file);
    const previousInfo = await regularFile(previous);
    // Preserve an unexpectedly oversized existing log instead of moving it into
    // a generation that would silently violate the declared storage budget.
    if ([info, previousInfo].some(item => item && item.size > budget.fileBytes)) {
      throw Object.assign(new Error('NODE_LOG_EXISTING_FILE_LIMIT'), { code: 'NODE_LOG_EXISTING_FILE_LIMIT' });
    }
    if (info && info.size + Buffer.byteLength(line) > budget.fileBytes) {
      if (previousInfo) await unlink(previous);
      await rename(file, previous); rotations++;
    }
    // O_NOFOLLOW also closes the final-component race on platforms that support it.
    const handle = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW || 0), 0o600);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1) throw invalid();
      await handle.writeFile(line, 'utf8'); written++;
    } finally { await handle.close(); }
  }

  return {
    record(event) {
      if (!logDirectory || closed || failed) { dropped++; return; }
      const safe = sanitizeDiagnostic(event, { secrets: secrets() }).data;
      let line = JSON.stringify(safe) + '\n';
      if (Buffer.byteLength(line) > Math.min(budget.recordBytes, budget.fileBytes)) {
        omitted++;
        line = JSON.stringify({ timestamp: safe.timestamp, severity: safe.severity, event: safe.event,
          message: safe.event, logger: 'jsonui.local', run_id: safe.run_id, correlation_id: safe.correlation_id,
          outcome: safe.outcome, duration_ms: safe.duration_ms, sequence: safe.sequence,
          context: { details_omitted: true, reason_code: 'NODE_LOG_RECORD_LIMIT' } }) + '\n';
      }
      const size = Buffer.byteLength(line);
      if (size > budget.fileBytes || queuedBytes + size > budget.queuedBytes) { dropped++; return; }
      queuedBytes += size;
      tail = tail.then(async () => {
        if (failed) { dropped++; return; }
        await writeLine(line);
      }).catch(cause => {
        failed = true; dropped++;
        failureCode = /^[A-Z][A-Z0-9_]{2,100}$/u.test(cause?.code || '') ? cause.code : 'NODE_LOG_WRITE_FAILED';
      }).finally(() => { queuedBytes -= size; });
    },
    snapshot() { return { enabled: Boolean(logDirectory), status: !logDirectory ? 'disabled' : failed ? 'unavailable' : 'available',
      written, dropped, details_omitted: omitted, rotations, queued_bytes: queuedBytes,
      failure_code: failureCode, limits: { ...budget }, durability: 'os_buffered_append' }; },
    async flush(waitMs = 1000) {
      if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 5000) throw new TypeError('NODE_LOG_WAIT_INVALID');
      let timer;
      try {
        return await Promise.race([tail.then(() => ({ completed: true, ...this.snapshot() })),
          new Promise(resolve => { timer = setTimeout(() => resolve({ completed: false, reason_code: 'NODE_LOG_FLUSH_TIMEOUT', ...this.snapshot() }), waitMs); })]);
      } finally { clearTimeout(timer); }
    },
    async close() { closed = true; return this.flush(2000); },
  };
}
