/*
  zip-pack-source.js (S023)

  PackSource implementation backed by ZipReader (S018).

  This represents the user's imported Resource Pack ZIP.
*/

import { PACK_NOT_FOUND, makePackError } from './pack-source.js';

/**
 * @implements {import('./pack-source.js').PackSource}
 */
export class ZipPackSource {
  /**
   * @param {{
   *  id: string,
   *  zipReader: import('./zip-reader.js').ZipReader,
   * }} opts
   */
  constructor(opts) {
    if (!opts || !opts.zipReader) {
      throw makePackError('PACK_ZIP_MISSING_READER');
    }

    this.id = String(opts.id || 'imported');
    this.kind = 'zip';
    this.supportsListing = true;

    this.zipReader = opts.zipReader;
  }

  /**
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<import('./pack-source.js').PackFileList>}
   */
  async listFiles(options = {}) {
    if (options && options.signal && options.signal.aborted) {
      throw makePackError('PACK_ABORTED');
    }

    const paths = await this.zipReader.listAllFilePaths();
    return { paths, complete: true };
  }

  /**
   * @param {string} path
   * @param {{ encoding?: string, signal?: AbortSignal, maxBytes?: number }} [options]
   */
  async readText(path, options = {}) {
    if (options && options.signal && options.signal.aborted) {
      throw makePackError('PACK_ABORTED');
    }

    try {
      return await this.zipReader.readText(path, options);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || 'UNKNOWN');
      if (msg === 'ZIP_ENTRY_NOT_FOUND') {
        throw makePackError(PACK_NOT_FOUND, { data: { sourceId: this.id, path } });
      }
      throw e;
    }
  }

  /**
   * @param {string} path
   * @param {{ mimeType?: string, signal?: AbortSignal, maxBytes?: number }} [options]
   */
  async readBlob(path, options = {}) {
    if (options && options.signal && options.signal.aborted) {
      throw makePackError('PACK_ABORTED');
    }

    try {
      return await this.zipReader.readBlob(path, options);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || 'UNKNOWN');
      if (msg === 'ZIP_ENTRY_NOT_FOUND') {
        throw makePackError(PACK_NOT_FOUND, { data: { sourceId: this.id, path } });
      }
      throw e;
    }
  }
}
