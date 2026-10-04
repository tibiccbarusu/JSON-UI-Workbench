/*
  fallback-pack-source.js (S024)

  PackSource wrapper that tries the primary source first, then falls back to a
  secondary source for selected failure codes.

  Intended use:
  - Vanilla reference: try GitHub raw (HttpPackSource) but allow a user-uploaded
    Vanilla RP ZIP fallback when the network is slow/unavailable.
*/

import { PACK_NOT_FOUND, makePackError } from './pack-source.js';

/**
 * @param {any} err
 */
function getErrCode(err) {
  if (err && typeof err === 'object' && typeof err.message === 'string') {
    return err.message;
  }
  return 'UNKNOWN';
}

/**
 * @implements {import('./pack-source.js').PackSource}
 */
export class FallbackPackSource {
  /**
   * @param {{
   *  id: string,
   *  primary: import('./pack-source.js').PackSource,
   *  fallback: import('./pack-source.js').PackSource,
   *  fallbackOnCodes?: string[],
   * }} opts
   */
  constructor(opts) {
    if (!opts?.primary || !opts?.fallback) {
      throw makePackError('PACK_FALLBACK_MISSING_SOURCE');
    }

    this.id = String(opts.id || 'fallback');
    this.kind = 'fallback';

    this.primary = opts.primary;
    this.fallback = opts.fallback;

    const defaultCodes = [
      PACK_NOT_FOUND,
      'PACK_HTTP_FETCH_FAILED',
      'PACK_HTTP_BAD_STATUS',
      'PACK_HTTP_TIMEOUT',
      'PACK_HTTP_MISSING_BASE_URL',
      'PACK_HTTP_INVALID_PROTOCOL',
    ];
    const codes = Array.isArray(opts.fallbackOnCodes) ? opts.fallbackOnCodes : defaultCodes;
    this._fallbackOn = new Set(codes.map((s) => String(s)));

    this.supportsListing = Boolean(this.primary.supportsListing || this.fallback.supportsListing);
  }

  /**
   * @param {{ signal?: AbortSignal }} [options]
   */
  async listFiles(options = {}) {
    if (!this.supportsListing) return { paths: [], complete: false };

    const a = this.primary.supportsListing
      ? await this.primary.listFiles(options)
      : { paths: [], complete: false };
    const b = this.fallback.supportsListing
      ? await this.fallback.listFiles(options)
      : { paths: [], complete: false };

    const set = new Set([...(a.paths || []), ...(b.paths || [])]);
    const paths = Array.from(set);
    paths.sort();

    return { paths, complete: Boolean(a.complete && b.complete) };
  }

  /**
   * @param {string} path
   * @param {any} [options]
   */
  async readText(path, options) {
    try {
      return await this.primary.readText(path, options);
    } catch (e) {
      const code = getErrCode(e);
      if (!this._fallbackOn.has(code) || code === 'PACK_ABORTED') throw e;

      try {
        return await this.fallback.readText(path, options);
      } catch (e2) {
        throw makePackError('PACK_FALLBACK_FAILED', {
          cause: e,
          data: {
            path,
            primaryId: this.primary.id,
            fallbackId: this.fallback.id,
            primaryCode: code,
            fallbackCode: getErrCode(e2),
          },
        });
      }
    }
  }

  /**
   * @param {string} path
   * @param {any} [options]
   */
  async readBlob(path, options) {
    try {
      return await this.primary.readBlob(path, options);
    } catch (e) {
      const code = getErrCode(e);
      if (!this._fallbackOn.has(code) || code === 'PACK_ABORTED') throw e;

      try {
        return await this.fallback.readBlob(path, options);
      } catch (e2) {
        throw makePackError('PACK_FALLBACK_FAILED', {
          cause: e,
          data: {
            path,
            primaryId: this.primary.id,
            fallbackId: this.fallback.id,
            primaryCode: code,
            fallbackCode: getErrCode(e2),
          },
        });
      }
    }
  }
}
