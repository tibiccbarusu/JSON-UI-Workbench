/*
  memory-pack-source.js (S023)

  In-memory PackSource implementation.

  Primary use:
  - Unit fixtures and deterministic tests for overlay behavior.

  This is NOT intended for large packs.
*/

import { normalizePackPath } from '../path/normalize-pack-path.js';
import { PACK_NOT_FOUND, makePackError } from './pack-source.js';

/**
 * @typedef {{
 *  text?: string,
 *  blob?: Blob,
 * }} MemoryPackRecord
 */

/**
 * @implements {import('./pack-source.js').PackSource}
 */
export class MemoryPackSource {
  /**
   * @param {{
   *  id: string,
   *  files?: Record<string, MemoryPackRecord>,
   * }} opts
   */
  constructor(opts) {
    this.id = String(opts && opts.id ? opts.id : 'memory');
    this.kind = 'memory';
    this.supportsListing = true;

    /** @type {Map<string, MemoryPackRecord>} */
    this._records = new Map();

    const files = (opts && opts.files) || {};
    for (const [rawPath, rec] of Object.entries(files)) {
      const path = normalizePackPath(rawPath);
      this._records.set(path, {
        ...(rec && rec.text !== undefined ? { text: String(rec.text) } : {}),
        ...(rec && rec.blob instanceof Blob ? { blob: rec.blob } : {}),
      });
    }
  }

  /**
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<import('./pack-source.js').PackFileList>}
   */
  async listFiles(options = {}) {
    if (options && options.signal && options.signal.aborted) {
      throw makePackError('PACK_ABORTED');
    }

    const paths = Array.from(this._records.keys()).sort();
    return { paths, complete: true };
  }

  /**
   * @param {string} rawPath
   * @param {{ encoding?: string, signal?: AbortSignal }} [options]
   */
  async readText(rawPath, options = {}) {
    if (options && options.signal && options.signal.aborted) {
      throw makePackError('PACK_ABORTED');
    }

    const path = normalizePackPath(rawPath);
    const rec = this._records.get(path);
    if (!rec) {
      throw makePackError(PACK_NOT_FOUND, { data: { sourceId: this.id, path } });
    }

    if (rec.text !== undefined) {
      return String(rec.text);
    }

    if (rec.blob instanceof Blob) {
      // Encoding parameter is ignored; Blob.text() is UTF-8.
      return rec.blob.text();
    }

    throw makePackError('PACK_RECORD_NOT_TEXT', { data: { sourceId: this.id, path } });
  }

  /**
   * @param {string} rawPath
   * @param {{ mimeType?: string, signal?: AbortSignal }} [options]
   */
  async readBlob(rawPath, options = {}) {
    if (options && options.signal && options.signal.aborted) {
      throw makePackError('PACK_ABORTED');
    }

    const path = normalizePackPath(rawPath);
    const rec = this._records.get(path);
    if (!rec) {
      throw makePackError(PACK_NOT_FOUND, { data: { sourceId: this.id, path } });
    }

    if (rec.blob instanceof Blob) {
      return rec.blob;
    }

    if (rec.text !== undefined) {
      const mimeType = options && options.mimeType ? String(options.mimeType) : 'text/plain';
      return new Blob([String(rec.text)], { type: mimeType });
    }

    throw makePackError('PACK_RECORD_NOT_BLOB', { data: { sourceId: this.id, path } });
  }
}
