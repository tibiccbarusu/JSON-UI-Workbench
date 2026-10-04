/*
  pack-source.js (S023)

  Defines a minimal abstraction for reading files from two resource pack sources:
  - Imported pack ZIP
  - Vanilla reference pack (remote)

  Implementations must treat paths and file content as untrusted input.

  The interface is intentionally small:
  - listFiles() -> enumerate known file paths (may be incomplete for remote sources)
  - readText(path)
  - readBlob(path)

  Later steps build import/index/validation/export flows on top of this.
*/

/**
 * @typedef {{
 *  paths: string[],
 *  complete: boolean,
 * }} PackFileList
 */

/**
 * @typedef {{
 *  id: string,
 *  kind: 'zip'|'http'|'memory'|'overlay'|'fallback',
 *  supportsListing: boolean,
 *  listFiles: (options?: { signal?: AbortSignal }) => Promise<PackFileList>,
 *  readText: (path: string, options?: { encoding?: string, signal?: AbortSignal, maxBytes?: number }) => Promise<string>,
 *  readBlob: (path: string, options?: { mimeType?: string, signal?: AbortSignal, maxBytes?: number }) => Promise<Blob>,
 * }} PackSource
 */

export const PACK_NOT_FOUND = 'PACK_NOT_FOUND';

/**
 * Create an Error with a stable code in `.message` and `.code`.
 *
 * The project often switches on `err.message`, so we keep the code there.
 *
 * @param {string} code
 * @param {{ message?: string, cause?: any, data?: any }} [opts]
 */
export function makePackError(code, opts = {}) {
  const err = new Error(String(code || 'PACK_ERROR'));
  // Attach structured fields for future diagnostics.
  // (Existing UI mostly reads err.message; these are additive.)
  // @ts-ignore
  err.code = String(code || 'PACK_ERROR');
  // @ts-ignore
  if (opts && opts.message) err.userMessage = String(opts.message);
  // @ts-ignore
  if (opts && opts.data !== undefined) err.data = opts.data;
  // @ts-ignore
  if (opts && opts.cause !== undefined) err.cause = opts.cause;
  return err;
}

/**
 * True if the error represents a missing file.
 *
 * @param {any} err
 * @returns {boolean}
 */
export function isPackNotFoundError(err) {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  // @ts-ignore
  const code = err && typeof err === 'object' ? err.code : null;
  return msg === PACK_NOT_FOUND || code === PACK_NOT_FOUND;
}
