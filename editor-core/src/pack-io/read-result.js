/*
  read-result.js

  Small result adapters for APIs that normally return a raw string or Blob.
  Export assembly is intentionally best-effort, so it needs a non-throwing,
  explicit result contract while the editor's interactive read path keeps its
  existing throwing/raw-value contract.
*/

/**
 * Convert an unknown exception into a short, serializable diagnostic string.
 * @param {unknown} error
 */
function errorMessage(error) {
  if (error instanceof Error) return error.message || error.name || 'UNKNOWN_ERROR';
  try {
    return String(error || 'UNKNOWN_ERROR');
  } catch {
    return 'UNKNOWN_ERROR';
  }
}

/**
 * @param {() => Promise<unknown>} read
 * @returns {Promise<{ok: true, text: string}|{ok: false, error: string}>}
 */
export async function captureTextRead(read) {
  try {
    const text = await read();
    if (typeof text !== 'string') {
      return { ok: false, error: 'PACK_TEXT_READ_INVALID_RESULT' };
    }
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * @param {() => Promise<unknown>} read
 * @returns {Promise<{ok: true, blob: Blob}|{ok: false, error: string}>}
 */
export async function captureBlobRead(read) {
  try {
    const blob = await read();
    const isBlob = typeof Blob !== 'undefined'
      ? blob instanceof Blob
      : Boolean(blob && typeof blob === 'object' && typeof /** @type {any} */ (blob).arrayBuffer === 'function');
    if (!isBlob) {
      return { ok: false, error: 'PACK_BLOB_READ_INVALID_RESULT' };
    }
    return { ok: true, blob: /** @type {Blob} */ (blob) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
