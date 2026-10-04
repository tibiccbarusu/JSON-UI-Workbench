import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fail } from './limits.mjs';
import { sanitizeDebugText, DEBUG_SECRET_KEY, DEBUG_OMITTED_KEY } from '../editor-core/src/diagnostics/debug-redaction.js';

export const DEBUG_LIMITS = Object.freeze({ requestBytes: 1024 * 1024, depth: 12, nodes: 50000, array: 500, string: 8192, logBytes: 256 * 1024 });
const secretKey = DEBUG_SECRET_KEY;
const omittedKey = DEBUG_OMITTED_KEY;
const safeFields = new Set(['schema', 'browser', 'selection', 'state', 'diagnostics', 'events']);

/** JSON-safe diagnostic projection. Pack-relative paths remain useful; native paths are hidden. */
export function sanitizeDiagnostic(value, { secrets = [], strict = false } = {}) {
  let nodes = 0, truncated = false, redacted = 0;
  const text = input => {
    let output = sanitizeDebugText(input, {secrets});
    if (output !== input) redacted++;
    if (output.length > DEBUG_LIMITS.string) { truncated = true; output = output.slice(0, DEBUG_LIMITS.string) + '[TRUNCATED]'; }
    return output;
  };
  const visit = (item, depth) => {
    if (++nodes > DEBUG_LIMITS.nodes || depth > DEBUG_LIMITS.depth) { truncated = true; if (strict) fail('NODE_DEBUG_STRUCTURE_LIMIT', 413); return '[TRUNCATED]'; }
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : null;
    if (typeof item === 'string') return text(item);
    if (Array.isArray(item)) {
      if (item.length > DEBUG_LIMITS.array) truncated = true;
      return item.slice(0, DEBUG_LIMITS.array).map(x => visit(x, depth + 1));
    }
    if (!item || typeof item !== 'object') return null;
    const output = Object.create(null), entries = Object.entries(item);
    if (entries.length > DEBUG_LIMITS.array) truncated = true;
    for (const [key, child] of entries.slice(0, DEBUG_LIMITS.array)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || omittedKey.test(key)) { redacted++; continue; }
      if (secretKey.test(key)) { output[text(key)] = '[REDACTED]'; redacted++; }
      else output[text(key)] = visit(child, depth + 1);
    }
    return output;
  };
  const data = visit(value, 0);
  return { data, summary: { nodes, truncated, redacted } };
}

export function validateDebugRequest(value, options) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 'jsonui-debug-request-v1') fail('NODE_DEBUG_SCHEMA_INVALID');
  for (const key of Object.keys(value)) if (!safeFields.has(key)) fail('NODE_DEBUG_FIELD_INVALID');
  for (const key of ['browser', 'selection', 'state']) if (value[key] !== undefined && (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))) fail('NODE_DEBUG_FIELD_TYPE');
  for (const key of ['diagnostics', 'events']) if (value[key] !== undefined && !Array.isArray(value[key])) fail('NODE_DEBUG_FIELD_TYPE');
  return sanitizeDiagnostic(value, { ...options, strict: true });
}

/** Bounded in-memory ring. Truncation is explicit rather than implying a complete log. */
export function createEventJournal(limit = 500, { runId, onRecord, secrets = () => [] } = {}) {
  const rows = [], important = []; let total = 0, importantTotal = 0;
  return {
    record(event, context = {}, { severity = 'INFO', outcome = 'success', duration_ms, correlation_id } = {}) {
      // Redact before retention, so an exported snapshot is not the first privacy boundary.
      const row = { timestamp: new Date().toISOString(), severity, event, message: event, logger: 'jsonui.local',
        ...(runId ? { run_id: runId } : {}), sequence: total + 1,
        context: sanitizeDiagnostic(context, { secrets: secrets() }).data, outcome };
      if (duration_ms !== undefined) row.duration_ms = Math.max(0, Math.round(duration_ms));
      if (correlation_id) row.correlation_id = correlation_id;
      rows.push(row); total++; if (rows.length > limit) rows.shift();
      if (['WARN', 'ERROR', 'FATAL'].includes(severity) || ['failure', 'timeout'].includes(outcome)) {
        important.push(row); importantTotal++; if (important.length > Math.min(limit, 100)) important.shift();
      }
      // Optional observability must never turn a completed edit into a failed edit.
      try { onRecord?.(row); } catch {}
    },
    snapshot() { return { events: rows.slice(), total_seen: total, dropped: Math.max(0, total - rows.length), limit,
      important_events: important.slice(), important_total_seen: importantTotal,
      important_dropped: Math.max(0, importantTotal - important.length) }; },
  };
}

const exactLogIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;

function pathMatchesLogHandle(pathInfo, handleInfo) {
  if (exactLogIdentity(pathInfo, handleInfo)) return true;
  // Node 22.14 の Windows libuv では path stat が volume の 64bit 値、
  // fstat が ULONG の 32bit 値を返す場合がある。現行 libuv の LowPart
  // 正規化と同じ比較を、この API 間かつ FD が 32bit の場合に限定する。
  // inode は常に完全一致。前後の path 同士・FD 同士は以下で完全比較する。
  return process.platform === 'win32' && pathInfo.ino === handleInfo.ino
    && pathInfo.dev >= 0n && handleInfo.dev >= 0n && handleInfo.dev <= 0xffffffffn
    && BigInt.asUintN(32, pathInfo.dev) === handleInfo.dev;
}

async function readFixedLog(logDirectory, fileName, options, allowText = false) {
  if (!logDirectory) return { status: 'unavailable', reason: 'SERVER_STARTED_WITHOUT_LAUNCHER' };
  const expected = path.resolve(logDirectory, fileName);
  let handle;
  try {
    const before = await lstat(expected, { bigint: true });
    if (before.isSymbolicLink()) return { status: 'unavailable', reason: 'LOG_PATH_REDIRECT_REJECTED' };
    if (!before.isFile()) return { status: 'unavailable', reason: 'LOG_NOT_REGULAR_FILE' };
    if (before.nlink !== 1n) return { status: 'unavailable', reason: 'LOG_HARDLINK_REJECTED' };
    const resolved = await realpath(expected);
    if (resolved !== expected) return { status: 'unavailable', reason: 'LOG_PATH_REDIRECT_REJECTED' };
    // Match the writer's link boundary before exporting persisted data.
    // O_NOFOLLOW rejects final-component swaps where available; FD identity
    // checks also cover platforms without it and ancestor-directory swaps.
    handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await handle.stat({ bigint: true });
    if (!info.isFile()) return { status: 'unavailable', reason: 'LOG_NOT_REGULAR_FILE' };
    if (info.nlink !== 1n) return { status: 'unavailable', reason: 'LOG_HARDLINK_REJECTED' };
    if (!pathMatchesLogHandle(before, info)) return { status: 'unavailable', reason: 'LOG_PATH_CHANGED' };
    if (info.size > BigInt(Number.MAX_SAFE_INTEGER)) return { status: 'unavailable', reason: 'LOG_SIZE_UNSUPPORTED' };
    const size = Number(info.size), length = Math.min(size, DEBUG_LIMITS.logBytes), buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, size - length));
    const after = await handle.stat({ bigint: true }), current = await lstat(expected, { bigint: true });
    if (after.nlink !== 1n || current.nlink !== 1n) return { status: 'unavailable', reason: 'LOG_HARDLINK_REJECTED' };
    if (!after.isFile() || !current.isFile() || current.isSymbolicLink()
      || !exactLogIdentity(before, current) || !exactLogIdentity(info, after)
      || !pathMatchesLogHandle(current, after)
      || await realpath(expected) !== expected) return { status: 'unavailable', reason: 'LOG_PATH_CHANGED' };
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (size > length) lines.shift();
    const parsed = []; let malformed = 0;
    for (const line of lines) { if (!line.trim()) continue; try { parsed.push(JSON.parse(line)); } catch { if(allowText)parsed.push({legacy_text:line});else malformed++; } }
    const safe = sanitizeDiagnostic(parsed.slice(-500), options);
    return { status: 'available', bytes_read: bytesRead, truncated: size > length || parsed.length > 500, malformed_records: malformed, ...safe };
  } catch { return { status: 'unavailable', reason: 'LOG_NOT_READABLE' }; }
  finally { await handle?.close(); }
}

export function readLauncherLog(logDirectory, options) { return readFixedLog(logDirectory, 'launcher.log', options); }
export function readBootstrapLog(logDirectory, options) { return readFixedLog(logDirectory, 'bootstrap.log', options, true); }
export async function readServerLogs(logDirectory, options) {
  const [current, previous] = await Promise.all([
    readFixedLog(logDirectory, 'server.log', options), readFixedLog(logDirectory, 'server.log.1', options),
  ]);
  return { current, previous };
}
