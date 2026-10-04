/** 書き出し診断の表示用投影。元の検査結果を保存・書換え・全列挙しない。 */
export const EXPORT_DETAIL_LIMITS = Object.freeze({ maxChars: 24000, maxBytes: 24000, maxDepth: 6, maxNodes: 192, maxArrayItems: 16, maxStringChars: 1024, maxTotalStringChars: 4096 });
export const EXPORT_DETAIL_NOTICE = '詳細結果は表示用に一部を省略しています。実機での動作を検証した結果ではありません。元の書き出し検査結果は保持されています。';
// A fixed schema allowlist avoids Object.keys/entries/for-in across a huge map.
const FIELDS = Object.freeze(['ok', 'unresolvedCount', 'warningCount', 'fileCount', 'selectedDefinitionCount', 'unresolved', 'warnings', 'omittedUnresolved', 'omittedWarnings', 'code', 'path', 'sourcePath', 'jsonPath', 'reference', 'reason', 'message', 'selectedDefinitions', 'sourceId', 'filePath', 'rawKey', 'qualifiedName', 'engineFactoryProof', 'verified', 'method', 'sourceCommit', 'factory', 'definition', 'matches', 'branches', 'used', 'considered', 'branchIndex', 'omittedChecks', 'checks', 'changed', 'included', 'omittedBranches', 'schema', 'sha256', 'size', 'mimeType', 'error', 'category', 'retryable', 'correlation_id', 'entryPointPreservation', 'authoredKey', 'exportedKey', 'deviceValidation', 'preservedProperties', 'property', 'authoredNamespace', 'omittedEntryPoints', 'runtimeTextOverrideRetention', 'policy', 'files', 'paths', 'omittedPaths']);
function own(value, key, stats) {
  if (!value || typeof value !== 'object') return undefined;
  stats.propertyReads++;
  try { const d = Object.getOwnPropertyDescriptor(value, key); return d && Object.hasOwn(d, 'value') ? d.value : undefined; } catch { stats.omitted = true; return undefined; }
}
function bytes(text) { return new TextEncoder().encode(text).byteLength; }
function boundedLimit(value, fallback, floor, ceiling) { return Number.isSafeInteger(value) ? Math.min(ceiling, Math.max(floor, value)) : fallback; }
/** Input must be passive parsed JSON/internal data; arbitrary Proxy traps cannot be made time-safe. */
export function workspaceExportDetail(result, diagnostics, options = {}) {
  const maxChars = boundedLimit(options.maxChars, 24000, 1024, 24000);
  const maxBytes = boundedLimit(options.maxBytes, 24000, 1024, 24000);
  const maxDepth = boundedLimit(options.maxDepth, 6, 1, 6);
  const maxNodes = boundedLimit(options.maxNodes, 192, 8, 192);
  const maxArrayItems = boundedLimit(options.maxArrayItems, 16, 1, 16);
  const maxStringChars = boundedLimit(options.maxStringChars, 1024, 32, 1024);
  const maxTotalStringChars = boundedLimit(options.maxTotalStringChars, 4096, 64, 4096);
  const stats = { nodes: 0, propertyReads: 0, copiedStringChars: 0, omitted: true, serializationPasses: 0 };
  const seen = new WeakSet();
  function project(value, depth = 0) {
    if (++stats.nodes > maxNodes) { stats.omitted = true; return '[項目数上限により省略]'; }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const allowed = Math.min(maxStringChars, Math.max(0, maxTotalStringChars - stats.copiedStringChars));
      const text = value.slice(0, allowed); stats.copiedStringChars += text.length;
      if (text.length !== value.length) stats.omitted = true;
      return text.length !== value.length ? text + '…[省略]' : text;
    }
    if (typeof value !== 'object') return undefined;
    if (depth >= maxDepth) { stats.omitted = true; return '[深さ上限により省略]'; }
    if (seen.has(value)) { stats.omitted = true; return '[循環・共有参照を省略]'; }
    seen.add(value);
    if (Array.isArray(value)) {
      const rawLength = own(value, 'length', stats);
      const length = Number.isSafeInteger(rawLength) && rawLength >= 0 ? rawLength : 0;
      const items = [];
      for (let i = 0; i < Math.min(length, maxArrayItems) && stats.nodes < maxNodes; i++) items.push(project(own(value, String(i), stats), depth + 1) ?? null);
      if (items.length < length) { stats.omitted = true; items.push({ omittedItems: length - items.length }); }
      return items;
    }
    const output = Object.create(null);
    for (const key of FIELDS) {
      if (stats.nodes >= maxNodes) { stats.omitted = true; break; }
      const child = own(value, key, stats);
      if (child !== undefined) { const projected = project(child, depth + 1); if (projected !== undefined) output[key] = projected; }
    }
    return output;
  }
  const displayed = { notice: EXPORT_DETAIL_NOTICE, diagnostics: project(diagnostics), resultMetadata: Object.create(null) };
  for (const key of ['ok', 'sha256', 'size', 'mimeType', 'error']) {
    if (stats.nodes >= maxNodes) break;
    const value = own(result, key, stats); if (value !== undefined) displayed.resultMetadata[key] = project(value);
  }
  let text = JSON.stringify(displayed, null, 2); stats.serializationPasses++;
  // Only the bounded projection is serialized. If escaping/UTF-8 exceeds the
  // final budget, retain scalar diagnostic totals and the first issue codes.
  if (text.length > maxChars || bytes(text) > maxBytes) {
    const summary = Object.create(null);
    for (const key of ['ok', 'unresolvedCount', 'warningCount', 'fileCount', 'selectedDefinitionCount']) {
      const value = own(diagnostics, key, stats); if (typeof value === 'boolean' || Number.isFinite(value)) summary[key] = value;
    }
    const codes = [];
    const unresolved = own(diagnostics, 'unresolved', stats);
    if (Array.isArray(unresolved)) for (let i = 0; i < 4; i++) {
      const code = own(own(unresolved, String(i), stats), 'code', stats);
      if (typeof code === 'string') codes.push(code.slice(0, 32));
    }
    text = JSON.stringify({ notice: EXPORT_DETAIL_NOTICE, diagnostics: summary, unresolvedCodes: codes, omitted: true }, null, 2); stats.serializationPasses++;
    if (text.length > maxChars || bytes(text) > maxBytes) {
      text = JSON.stringify({ notice: EXPORT_DETAIL_NOTICE, diagnostics: summary, omitted: true }, null, 2); stats.serializationPasses++;
    }
  }
  return { text, omitted: true, byteLength: bytes(text), charLength: text.length, stats };
}
