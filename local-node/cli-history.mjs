/** Bounded, source-preserving history for commands that run in separate processes. */
import { cliError, CLI_JSON_LIMIT } from './cli-files.mjs';

const SCHEMA = 'jsonui-cli-history-v1';
export const CLI_HISTORY_LIMIT = 8 * 1024 * 1024;
export const CLI_HISTORY_ENTRIES = 64;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);

export function sourceSnapshot(sources) {
  return sources.map(source => ({ kind: source.kind, overrides: structuredClone(source.overrides) }));
}

function validSnapshot(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 2
    && new Set(value.map(source => source?.kind)).size === value.length
    && value.every(source => object(source) && ['imported', 'vanilla'].includes(source.kind)
      && object(source.overrides) && Object.entries(source.overrides).every(([name, text]) =>
        typeof text === 'string' && name.length > 0 && name.length <= 8192 && !/[\u0000-\u001f]/u.test(name)));
}

export function readHistory(session) {
  const value = session.history;
  if (value === undefined) return { schema: SCHEMA, undo: [], redo: [], dropped: 0 };
  if (!object(value) || value.schema !== SCHEMA || !Array.isArray(value.undo) || !Array.isArray(value.redo)
    || value.undo.length + value.redo.length > CLI_HISTORY_ENTRIES || !Number.isSafeInteger(value.dropped) || value.dropped < 0
    || Buffer.byteLength(JSON.stringify(value)) > CLI_HISTORY_LIMIT
    || [...value.undo, ...value.redo].some(entry => !object(entry) || !revision(entry.before_revision) || !revision(entry.after_revision)
      || !validSnapshot(entry.before) || !validSnapshot(entry.after))) {
    throw cliError('CLI_HISTORY_INVALID', '保存された編集履歴の形式または上限が不正です。');
  }
  return structuredClone(value);
}

export function historySummary(session) {
  const history = readHistory(session);
  return { can_undo: history.undo.length > 0, can_redo: history.redo.length > 0,
    undo_count: history.undo.length, redo_count: history.redo.length, dropped_entries: history.dropped,
    maximum_entries: CLI_HISTORY_ENTRIES, maximum_bytes: CLI_HISTORY_LIMIT };
}

/** Account for both history and the whole persisted session before exposing it. */
export function boundHistory(session, history) {
  while (history.undo.length + history.redo.length > CLI_HISTORY_ENTRIES
    || Buffer.byteLength(JSON.stringify(history)) > CLI_HISTORY_LIMIT
    || Buffer.byteLength(JSON.stringify({ ...session, history }, null, 2)) + 256 > CLI_JSON_LIMIT) {
    if (history.undo.length) history.undo.shift();
    else if (history.redo.length) history.redo.shift();
    else break;
    history.dropped += 1;
  }
  return history;
}

export function appendHistory(session, before, beforeRevision, afterRevision) {
  const history = readHistory(session);
  if (beforeRevision === afterRevision) return history;
  if (!revision(beforeRevision) || !revision(afterRevision)) throw cliError('CLI_HISTORY_REVISION_INVALID', '編集履歴の改訂 ID を確認できません。');
  history.undo.push({ before_revision: beforeRevision, after_revision: afterRevision,
    before, after: sourceSnapshot(session.sources) });
  history.redo = [];
  return boundHistory(session, history);
}

export function restoreSnapshot(sources, snapshot) {
  if (!validSnapshot(snapshot) || snapshot.length !== sources.length
    || sources.some(source => !snapshot.some(item => item.kind === source.kind))) {
    throw cliError('CLI_HISTORY_SOURCES_CHANGED', '編集履歴のパック構成が現在と一致しません。');
  }
  return sources.map(source => ({ ...source, overrides: structuredClone(snapshot.find(item => item.kind === source.kind).overrides) }));
}
