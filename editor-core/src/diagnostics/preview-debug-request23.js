import { sanitizePreviewDebugPayload } from '../ui/preview-workspace.js';

// 手動のログ保存専用。状態が大きい場合も、直近の操作記録の枠を確保する。
// 上限は文字数ではなく JSON の UTF-8 バイト数で判定する。
export const PREVIEW_DEBUG_BUDGET23 = Object.freeze({ total: 960 * 1024,
  browser: 8 * 1024, selection: 16 * 1024, state: 320 * 1024,
  diagnostics: 384 * 1024, events: 192 * 1024, row: 16 * 1024 });
const encoder = new TextEncoder();
const bytes = value => encoder.encode(JSON.stringify(value)).byteLength;

function limitNodes(value, available, counter) {
  let remaining = available;
  function copy(item) {
    remaining--;
    if (item === null || typeof item !== 'object') return item;
    const output = Array.isArray(item) ? [] : Object.create(null);
    const entries = Object.entries(item);
    for (let index = 0; index < entries.length; index++) {
      if (remaining <= 0) { counter.omittedValues += entries.length - index; counter.truncated++; break; }
      const [key, child] = entries[index]; output[key] = copy(child);
    }
    return output;
  }
  const result = copy(value);
  return { value: result, nodes: available - remaining };
}

function sanitizeSection(value, counter, maxDepth = 10) {
  return sanitizePreviewDebugPayload(value, { maxDepth, onTruncate: omitted => {
    counter.truncated++; counter.omittedValues += omitted;
  } });
}

function safeSection(value, budget, nodeBudget, counter) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { counter.truncated++; value = {}; }
  return fitValue(limitNodes(sanitizeSection(value, counter), nodeBudget, counter).value, budget, counter);
}

/** 入力は既に秘密・原文を除去した JSON 値。出力も必ず JSON 値に保つ。 */
function fitValue(value, budget, counter) {
  if (bytes(value) <= budget) return value;
  counter.truncated++;
  if (typeof value === 'string') {
    const suffix = '[TRUNCATED]';
    if (bytes(suffix) > budget) return null;
    let low = 0, high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (bytes(value.slice(0, middle) + suffix) <= budget) low = middle;
      else high = middle - 1;
    }
    // 切断位置がサロゲートの途中なら、その文字全体を省略する。
    if (low && /[\uD800-\uDBFF]/u.test(value[low - 1])) low--;
    return value.slice(0, low) + suffix;
  }
  if (value === null || typeof value !== 'object') return null;
  const output = Array.isArray(value) ? [] : Object.create(null);
  let used = 2;
  const entries = Array.isArray(value) ? value.map((child, index) => [index, child]) : Object.entries(value);
  for (const [key, child] of entries) {
    const separator = Object.keys(output).length ? 1 : 0;
    const keyBytes = Array.isArray(value) ? 0 : bytes(key) + 1;
    const available = budget - used - separator - keyBytes;
    if (available < 16) { counter.omittedValues += entries.length - Object.keys(output).length; break; }
    const fitted = fitValue(child, available, counter);
    const size = bytes(fitted);
    if (size > available) { counter.omittedValues++; break; }
    output[key] = fitted; used += separator + keyBytes + size;
  }
  return output;
}

function boundedRows(rows, budget, nodeBudget, counter, maxRows) {
  const input = Array.isArray(rows) ? rows : [], selected = [];
  let used = 2, usedNodes = 1;
  // 最新の事象を優先し、出力は元の時系列へ戻す。
  for (let index = input.length - 1; index >= Math.max(0, input.length - maxRows); index--) {
    // request と rows 配列の二階層も Node の depth=12 に含まれる。
    const limited = limitNodes(sanitizeSection(input[index], counter, 9), 2048, counter);
    if (usedNodes + limited.nodes > nodeBudget) break;
    const row = fitValue(limited.value, PREVIEW_DEBUG_BUDGET23.row, counter);
    const cost = bytes(row) + (selected.length ? 1 : 0);
    if (used + cost > budget) break;
    selected.push(row); used += cost; usedNodes += limited.nodes;
  }
  return { rows: selected.reverse(), available: input.length, included: selected.length,
    omitted: input.length - selected.length };
}

/** サーバーの 1 MiB 受付上限内で状態・診断・操作の各枠を独立して確保する。 */
export function createPreviewDebugRequest23({ browser, selection, state, diagnostics, events } = {}) {
  const counter = { truncated: 0, omittedValues: 0 }, budgets = PREVIEW_DEBUG_BUDGET23;
  const logs = boundedRows(diagnostics, budgets.diagnostics, 24000, counter, 500);
  const actions = boundedRows(events, budgets.events, 8000, counter, 200);
  const result = { schema: 'jsonui-debug-request-v1',
    browser: safeSection(browser || {}, budgets.browser, 1000, counter),
    selection: safeSection(selection || {}, budgets.selection, 1000, counter),
    state: { ...safeSection(state || {}, budgets.state, 10000, counter),
      capture: { schema: 'jsonui-debug-capture-v23', utf8Budget: budgets.total,
      diagnostics: { available: logs.available, included: logs.included, omitted: logs.omitted },
      events: { available: actions.available, included: actions.included, omitted: actions.omitted },
      truncatedSections: 0, omittedValues: 0 } },
    diagnostics: logs.rows, events: actions.rows };
  result.state.capture.truncatedSections = counter.truncated;
  result.state.capture.omittedValues = counter.omittedValues;
  // 枠の合計は total より 40 KiB 小さい。ここは将来の変更時の境界検査。
  if (bytes(result) > budgets.total) throw new Error('DEBUG_CAPTURE_BYTE_BUDGET_EXCEEDED');
  return result;
}
