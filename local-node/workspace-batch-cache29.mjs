/** Node Worker専用。検査済み結果の可逆圧縮で保持上限による再計算を減らす。 */
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const BATCH_CACHE_LIMITS29 = Object.freeze({ retainedBytes: 16 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024 });
// 小結果は従来のJSON文字列を不変保持し、不要なencode/decodeを増やさない。
const ownedPlainEntries = new WeakSet();
const digest = value => createHash('sha256').update(value).digest('hex');
const cacheError = () => Object.assign(new Error('検査済みキャッシュの完全性を確認できません。通常の再計算へ戻ります。'), { code: 'WORKSPACE_CACHE_INVALID' });

/** 上限は保存量と展開量を別に判定。失敗しても保存元データを変更しない。 */
export function encodeBatchCache29(result, key, limits = BATCH_CACHE_LIMITS29) {
  const start = performance.now(), body = JSON.stringify(result), jsonUtf8Bytes = Buffer.byteLength(body), expandedBytes = Buffer.byteLength(body, 'utf16le');
  const meta = { expandedBytes, jsonUtf8Bytes, retainedBytes: 0, storageEncoding: 'none', storageReason: 'expanded-limit', cacheEncodeMs: 0 };
  if (expandedBytes > limits.expandedBytes || jsonUtf8Bytes > limits.expandedBytes) return { entry: null, meta: { ...meta, cacheEncodeMs: performance.now() - start } };
  if (expandedBytes <= limits.retainedBytes && jsonUtf8Bytes <= limits.retainedBytes) {
    const entry = Object.freeze({ key, body, encoding: 'json-string', bytes: Math.max(expandedBytes, jsonUtf8Bytes), expandedBytes, jsonUtf8Bytes });
    ownedPlainEntries.add(entry);
    return { entry, meta: { ...meta, retainedBytes: entry.bytes, storageEncoding: entry.encoding,
      storageReason: 'retained', cacheEncodeMs: performance.now() - start } };
  }
  // UTF-16LEはJavaScript文字列を正確に復元し、多数の日本語をUTF-8から毎回変換する費用を避ける。
  const raw = Buffer.from(body, 'utf16le');
  let data = raw, encoding = 'utf16le';
  if (raw.length > limits.retainedBytes || jsonUtf8Bytes > limits.retainedBytes) {
    // 圧縮は既存の直列化Workerでのみ実行。画像・文字の品質は変えない。
    data = deflateRawSync(raw, { level: 1 }); encoding = 'deflate-raw-utf16le';
  }
  if (data.length > limits.retainedBytes) return { entry: null,
    meta: { ...meta, storageReason: 'retained-limit', cacheEncodeMs: performance.now() - start } };
  return { entry: { key, data, encoding, bytes: data.length, expandedBytes, jsonUtf8Bytes, sha256: digest(raw) },
    meta: { ...meta, retainedBytes: data.length, storageEncoding: encoding, storageReason: 'retained', cacheEncodeMs: performance.now() - start } };
}

/** 毎回独立したオブジェクトを返す。取消・revision検査は呼出元が別に行う。 */
export function decodeBatchCache29(entry, limits = BATCH_CACHE_LIMITS29) {
  if (!entry || !Number.isSafeInteger(entry.expandedBytes)
      || entry.expandedBytes < 0 || entry.expandedBytes % 2 !== 0 || entry.expandedBytes > limits.expandedBytes
      || !Number.isSafeInteger(entry.jsonUtf8Bytes) || entry.jsonUtf8Bytes < 0 || entry.jsonUtf8Bytes > limits.expandedBytes
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > limits.retainedBytes) throw cacheError();
  if (entry.encoding === 'json-string') {
    if (!ownedPlainEntries.has(entry) || !Object.isFrozen(entry) || typeof entry.body !== 'string') throw cacheError();
    return parsedCache(entry.body);
  }
  if (!Buffer.isBuffer(entry.data) || entry.bytes !== entry.data.length) throw cacheError();
  const raw = entry.encoding === 'utf16le' ? entry.data
    : entry.encoding === 'deflate-raw-utf16le' ? inflateRawSync(entry.data, { maxOutputLength: Math.max(1, entry.expandedBytes) }) : null;
  if (!raw || raw.length !== entry.expandedBytes || digest(raw) !== entry.sha256) throw cacheError();
  const text = raw.toString('utf16le');
  if (Buffer.byteLength(text, 'utf8') !== entry.jsonUtf8Bytes) throw cacheError();
  return parsedCache(text);
}
function parsedCache(text) {
  const result = JSON.parse(text);
  if (result?.ok !== true || !result.documents || typeof result.documents !== 'object' || Array.isArray(result.documents)) throw cacheError();
  result.documents = Object.assign(Object.create(null), result.documents);
  return result;
}
