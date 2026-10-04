import { stableStringify } from '../json/stable-stringify.js';
import { normalizeDiagnosticError, readDiagnosticDataProperty, redactDiagnosticString, redactDiagnosticValue } from './site-diagnostic-session.js';

export const DIAGNOSTICS_EXPORT_SCHEMA = 'jsonui.application-log';
export const DIAGNOSTICS_EXPORT_SCHEMA_VERSION = 2;
export const DEFAULT_DIAGNOSTICS_EXPORT_MAX_BYTES = 512 * 1024;

function utf8Bytes(value) {
  const text = String(value ?? '');
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
  return text.length;
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.search = '';
    url.hash = '';
    return redactDiagnosticString(url.toString(), { maxLength: 512 });
  } catch {
    return '(unavailable)';
  }
}

export function sanitizeDiagnosticEntry(entry) {
  const level = ['debug', 'info', 'warn', 'error'].includes(String(entry?.level || '').toLowerCase())
    ? String(entry.level).toLowerCase()
    : 'info';
  const rawError = readDiagnosticDataProperty(entry, 'error');
  const error = rawError && typeof rawError === 'object'
    ? normalizeDiagnosticError(rawError)
    : undefined;
  return {
    id: redactDiagnosticString(entry?.id || '', { maxLength: 96 }),
    tsIso: redactDiagnosticString(entry?.tsIso || '', { maxLength: 64 }),
    level,
    source: redactDiagnosticString(entry?.source || 'app', { maxLength: 160 }),
    message: redactDiagnosticString(entry?.message || '', { maxLength: 2048 }),
    data: entry?.data === undefined
      ? undefined
      : redactDiagnosticValue(entry.data, {
          maxDepth: 6,
          maxKeys: 40,
          maxArrayLength: 30,
          maxStringLength: 1024,
        }),
    error,
  };
}

export function filterDiagnosticEntries(entries, options = {}) {
  const level = String(options.level || 'all').toLowerCase();
  const source = String(options.source || 'all');
  const query = String(options.query || '').trim().toLocaleLowerCase();
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (level !== 'all' && entry?.level !== level) return false;
    if (source !== 'all' && entry?.source !== source) return false;
    if (!query) return true;
    const haystack = `${entry?.source || ''}\n${entry?.message || ''}\n${entry?.error?.message || ''}`.toLocaleLowerCase();
    return haystack.includes(query);
  });
}

function countEntries(entries) {
  const counts = { total: 0, debug: 0, info: 0, warn: 0, error: 0 };
  for (const entry of entries) {
    counts.total += 1;
    if (Object.prototype.hasOwnProperty.call(counts, entry.level)) counts[entry.level] += 1;
  }
  return counts;
}

export function buildDiagnosticsSnapshot(options = {}) {
  const maxBytes = Math.max(16 * 1024, Math.min(4 * 1024 * 1024, Number(options.maxBytes) || DEFAULT_DIAGNOSTICS_EXPORT_MAX_BYTES));
  const originalEntries = (Array.isArray(options.entries) ? options.entries : []).map(sanitizeDiagnosticEntry);
  let includedEntries = originalEntries.slice();
  let sizeDroppedEntryCount = 0;
  const baseDroppedEntryCount = Math.max(0, Number(options.droppedEntryCount) || 0);
  const exportedAtIso = new Date().toISOString();
  let environment = options.includeEnv
    ? redactDiagnosticValue({
        userAgent: options.environment?.userAgent || '(unavailable)',
        url: cleanUrl(options.environment?.url),
        timeZone: options.environment?.timeZone || '(unknown)',
        viewport: options.environment?.viewport || null,
        devicePixelRatio: options.environment?.devicePixelRatio || null,
      }, { maxDepth: 4, maxStringLength: 512 })
    : null;
  let context = redactDiagnosticValue(options.context || null, {
    maxDepth: 6,
    maxKeys: 60,
    maxArrayLength: 30,
    maxStringLength: 1024,
  });
  let contextOmittedForSize = false;
  let environmentOmittedForSize = false;

  const makeDocument = () => ({
    schema: DIAGNOSTICS_EXPORT_SCHEMA,
    schemaVersion: DIAGNOSTICS_EXPORT_SCHEMA_VERSION,
    exportedAtIso,
    privacy: {
      environmentIncluded: environment !== null,
      projectBodiesIncluded: false,
      secretsRedacted: true,
      queryAndHashRemovedFromUrl: true,
      maxBytes,
      ...(contextOmittedForSize ? { contextOmittedForSize: true } : {}),
      ...(environmentOmittedForSize ? { environmentOmittedForSize: true } : {}),
    },
    summary: {
      capturedCounts: countEntries(originalEntries),
      includedCounts: countEntries(includedEntries),
      droppedEntryCount: baseDroppedEntryCount + sizeDroppedEntryCount,
      outputBytes: 0,
    },
    context,
    environment,
    entries: includedEntries,
  });

  let document = makeDocument();
  let text = '';
  const serialize = () => {
    document = makeDocument();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      text = stableStringify(document, { indent: 2, sortKeys: true, finalNewline: true });
      const measured = utf8Bytes(text);
      if (document.summary.outputBytes === measured) break;
      document.summary.outputBytes = measured;
    }
    text = stableStringify(document, { indent: 2, sortKeys: true, finalNewline: true });
  };
  serialize();
  // Optional state must not evict every recent operation. Drop an oversized
  // context first, then retain as many newest entries as the byte budget allows.
  if (utf8Bytes(text) > maxBytes && context !== null) {
    context = { omitted: true, reason: 'Context omitted to preserve recent log entries within the export byte limit.' };
    contextOmittedForSize = true;
    serialize();
  }
  if (utf8Bytes(text) > maxBytes && environment !== null) {
    environment = null;
    environmentOmittedForSize = true;
    serialize();
  }
  while (utf8Bytes(text) > maxBytes && includedEntries.length > 0) {
    const dropCount = Math.max(1, Math.ceil(includedEntries.length / 8));
    includedEntries = includedEntries.slice(dropCount);
    sizeDroppedEntryCount += dropCount;
    serialize();
  }
  if (utf8Bytes(text) > maxBytes) {
    context = {
      omitted: true,
      reason: 'Context omitted to fit the safe export byte limit.',
    };
    contextOmittedForSize = true;
    serialize();
  }
  return { document, text, bytes: utf8Bytes(text) };
}

export function formatDiagnosticsText(entries, options = {}) {
  const sanitized = (Array.isArray(entries) ? entries : []).map(sanitizeDiagnosticEntry);
  const lines = [
    `JSON UI Preview Studio application log`,
    `Exported: ${new Date().toISOString()}`,
    `Entries: ${sanitized.length}`,
    'Note: This is the web application log, not Minecraft Content Log.',
    '',
  ];
  for (const entry of sanitized) {
    lines.push(`[${entry.tsIso}] ${entry.level.toUpperCase()} ${entry.source} — ${entry.message}`);
    if (entry.error?.stack) lines.push(entry.error.stack);
    else if (entry.error?.message) lines.push(`${entry.error.name || 'Error'}: ${entry.error.message}`);
    if (entry.error) {
      const fields = Object.fromEntries(['code', 'category', 'retryable', 'correlation_id', 'cause']
        .filter((key) => entry.error[key] !== undefined).map((key) => [key, entry.error[key]]));
      if (Object.keys(fields).length) lines.push(stableStringify(fields, { sortKeys: true, finalNewline: false }));
    }
    if (entry.data !== undefined && options.includeData !== false) {
      lines.push(stableStringify(entry.data, { indent: 2, sortKeys: true, finalNewline: false }));
    }
    lines.push('');
  }
  const maxBytes = Math.max(16 * 1024, Math.min(4 * 1024 * 1024, Number(options.maxBytes) || DEFAULT_DIAGNOSTICS_EXPORT_MAX_BYTES));
  let text = `${lines.join('\n')}\n`;
  if (utf8Bytes(text) > maxBytes) {
    const suffix = '\n[Older/oversized details omitted to fit the safe export limit.]\n';
    while (lines.length > 6 && utf8Bytes(`${lines.join('\n')}${suffix}`) > maxBytes) lines.splice(5, 1);
    text = `${lines.join('\n')}${suffix}`;
  }
  return text;
}
