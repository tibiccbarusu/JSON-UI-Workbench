/** 3Dモデル用JSON読取の有限予算・キャッシュ・失敗境界。DOMとNode固有APIに依存しない。 */
import { parseJsonc } from '../json/jsonc.js';
import { NativePreviewDocumentCache } from './native-document-cache.js';
export const NATIVE_PREVIEW_TOTAL_TEXT_BYTES = 32 * 1024 * 1024;

const nativeDocumentCache = new NativePreviewDocumentCache();

/** モデル走査前にレイヤー入力を検証する。無効なレイヤーを黙って飛ばさない。 */
export function validateNativePreviewSources(sources) {
  try { return inspectNativePreviewSources(sources); }
  catch { return 'NATIVE_PREVIEW_PACK_INDEX_INVALID'; }
}

function inspectNativePreviewSources(sources) {
  if (!Array.isArray(sources)) return 'NATIVE_PREVIEW_PACK_INDEX_INVALID';
  if (sources.length > 64) return 'NATIVE_PREVIEW_LIMIT_EXCEEDED';
  const names = new Set();
  for (let index = 0; index < sources.length; index += 1) {
    const item = Object.getOwnPropertyDescriptor(sources, String(index));
    if (!item || !Object.hasOwn(item, 'value') || !item.value || typeof item.value !== 'object') {
      return 'NATIVE_PREVIEW_PACK_INDEX_INVALID';
    }
    const source = Object.getOwnPropertyDescriptor(item.value, 'source');
    const runtime = Object.getOwnPropertyDescriptor(item.value, 'runtime');
    if (!source || !Object.hasOwn(source, 'value') || typeof source.value !== 'string'
      || !source.value || source.value.length > 128 || /[\u0000-\u001f\u007f]/u.test(source.value)
      || names.has(source.value) || !runtime || !Object.hasOwn(runtime, 'value')
      || !runtime.value || typeof runtime.value !== 'object' || Array.isArray(runtime.value)) {
      return 'NATIVE_PREVIEW_PACK_INDEX_INVALID';
    }
    names.add(source.value);
  }
  return null;
}

/** 馬またはプレイヤーの一回の走査に専用の予算を作る。 */
export function createNativePreviewReadContext({ cacheDocuments = false } = {}) {
  return { remainingBytes: NATIVE_PREVIEW_TOTAL_TEXT_BYTES, cacheDocuments: cacheDocuments === true,
    documentCount: 0, completedDocumentCount: 0, stages: { entity: 0, controller: 0, geometry: 0 } };
}

/** 本文・OSパスを含まず、キャッシュ使用有無で変わらない走査根拠を返す。 */
export function inspectNativePreviewReadContext(context) {
  return Object.freeze({ documentCount: context.documentCount, completedDocumentCount: context.completedDocumentCount,
    reservedTextBytes: NATIVE_PREVIEW_TOTAL_TEXT_BYTES - context.remainingBytes,
    maxTextBytes: NATIVE_PREVIEW_TOTAL_TEXT_BYTES, stages: Object.freeze({ ...context.stages }) });
}

function nativePreviewLimitError() {
  const error = new Error('NATIVE_PREVIEW_LIMIT_EXCEEDED');
  error.code = 'NATIVE_PREVIEW_LIMIT_EXCEEDED';
  return error;
}

export function nativePreviewReadFailure(error, signal) {
  if (signal?.aborted || error?.message === 'NATIVE_PREVIEW_ABORTED' || error?.message === 'ZIP_READ_ABORTED') {
    return { status: 'cancelled' };
  }
  if (error?.code === 'NATIVE_PREVIEW_LIMIT_EXCEEDED') {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_LIMIT_EXCEEDED', ...(error.previewReadDetail ? { detail: error.previewReadDetail } : {}) };
  }
  return { status: 'invalid', issue: 'NATIVE_PREVIEW_SCAN_INCOMPLETE', ...(error?.previewReadDetail ? { detail: error.previewReadDetail } : {}) };
}

/** JSON読取と予算を一つの失敗境界へまとめ、原因を保持したまま安全な位置情報を添える。 */
export async function readNativePreviewJson(runtime, packPath, maxBytes, totalBudget, signal, source = null) {
  const foldedPath = packPath.toLowerCase();
  const stage = foldedPath.startsWith('entity/') ? 'entity'
    : foldedPath.startsWith('render_controllers/') ? 'controller' : 'geometry';
  totalBudget.documentCount += 1;
  totalBudget.stages[stage] += 1;
  try {
    const document = await readNativePreviewJsonValue(runtime, packPath, maxBytes, totalBudget, signal);
    totalBudget.completedDocumentCount += 1;
    return document;
  } catch (cause) {
    const cancelled = signal?.aborted || ['NATIVE_PREVIEW_ABORTED', 'ZIP_READ_ABORTED'].includes(cause?.message);
    const code = cancelled ? 'NATIVE_PREVIEW_ABORTED' : cause?.code === 'NATIVE_PREVIEW_LIMIT_EXCEEDED'
      ? 'NATIVE_PREVIEW_LIMIT_EXCEEDED' : 'NATIVE_PREVIEW_SCAN_INCOMPLETE';
    const error = new Error(code, { cause });
    error.code = code;
    error.previewReadDetail = Object.freeze({ source, packPath, stage,
      reason: cancelled ? 'cancelled' : cause?.code === 'NATIVE_PREVIEW_JSON_INVALID' ? 'json-invalid'
        : code === 'NATIVE_PREVIEW_LIMIT_EXCEEDED' ? 'text-budget-exceeded' : 'read-failed',
      ...(cause?.parseLocation ? { parseLocation: cause.parseLocation } : {}),
      scan: inspectNativePreviewReadContext(totalBudget) });
    throw error;
  }
}

function boundedUtf8Length(text) {
  if (typeof text !== 'string') return Number.POSITIVE_INFINITY;
  try {
    return new TextEncoder().encode(text).byteLength;
  } catch {
    // Three bytes per UTF-16 code unit is a conservative UTF-8 upper bound
    // (surrogate pairs consume four bytes across two units).
    return text.length * 3;
  }
}

async function readNativePreviewJsonValue(runtime, packPath, maxBytes, totalBudget, signal) {
  if (signal?.aborted) throw new Error('NATIVE_PREVIEW_ABORTED');
  if (!totalBudget || !Number.isSafeInteger(totalBudget.remainingBytes) || totalBudget.remainingBytes <= 0) {
    throw nativePreviewLimitError();
  }
  const override = runtime?.overridesTextByPackPath?.[packPath];
  let reservedBytes;
  if (typeof override === 'string') {
    reservedBytes = boundedUtf8Length(override);
  } else {
    const zipPath = `${runtime.rootPrefix || ''}${packPath}`;
    const entryRecord = runtime?.zipReader?.entryIndex instanceof Map
      ? runtime.zipReader.entryIndex.get(zipPath)
      : null;
    const declared = Number(entryRecord?.info?.uncompressedSize);
    // Imported runtimes have already been indexed. If a nonstandard caller
    // omits metadata, reserve the complete per-file allowance before decoding
    // so repeated failed decompressions cannot bypass the aggregate budget.
    reservedBytes = Number.isSafeInteger(declared) && declared > 0 ? declared : maxBytes;
  }
  if (!Number.isSafeInteger(reservedBytes)
    || reservedBytes <= 0
    || reservedBytes > maxBytes
    || reservedBytes > totalBudget.remainingBytes) {
    throw nativePreviewLimitError();
  }
  // Reserve before extraction/parsing. Failed CRC, decoding, and JSON parsing
  // attempts deliberately retain their charge in this one bounded scan.
  totalBudget.remainingBytes -= reservedBytes;
  // Preserve the same per-file and per-scan limits even on cache hits. The
  // reader identity plus full ZIP path keeps separate packs independent;
  // edited text participates in identity before a cached result is returned.
  const cacheKey = totalBudget.cacheDocuments
    ? nativeDocumentCache.key(runtime.zipReader || runtime, `${runtime.rootPrefix || ''}${packPath}`)
    : null;
  const cached = cacheKey ? nativeDocumentCache.get(cacheKey, override, Math.min(maxBytes, reservedBytes)) : null;
  if (cached) return cached;
  const text = typeof override === 'string'
    ? override
    : await runtime.zipReader.readText(`${runtime.rootPrefix || ''}${packPath}`, {
        maxBytes,
        encoding: 'utf-8',
        signal,
      });
  if (signal?.aborted) throw new Error('NATIVE_PREVIEW_ABORTED');
  const byteLength = boundedUtf8Length(text);
  if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes || byteLength > reservedBytes) {
    throw nativePreviewLimitError();
  }
  const parsed = parseJsonc(text, { fileName: packPath, allowTrailingComma: true, allowEmptyContent: false });
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    const error = new Error('NATIVE_PREVIEW_JSON_INVALID');
    error.code = 'NATIVE_PREVIEW_JSON_INVALID';
    const first = parsed.errors?.[0];
    if (first && Number.isSafeInteger(first.line) && Number.isSafeInteger(first.column)) {
      error.parseLocation = Object.freeze({ line: first.line, column: first.column,
        ...(first.code === 'FALLBACK_PARSE_ERROR' ? { approximate: true } : {}) });
    }
    throw error;
  }
  if (cacheKey) nativeDocumentCache.set(cacheKey, override, parsed.value, byteLength);
  return parsed.value;
}
