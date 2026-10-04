/*
  overlay-pack-source.js (S023)

  PackSource implementation that overlays two underlying sources:
  - base: Vanilla reference
  - overrides: Imported pack ZIP

  Resolution rule:
  - If a file exists in overrides, it wins.
  - Otherwise fall back to base.

  This overlay is deterministic and does not attempt any merging; it is
  a simple precedence layer.
*/

import { isPackNotFoundError, makePackError } from './pack-source.js';

/**
 * @implements {import('./pack-source.js').PackSource}
 */
export class OverlayPackSource {
  /**
   * @param {{
   *  id: string,
   *  base: import('./pack-source.js').PackSource,
   *  overrides: import('./pack-source.js').PackSource,
   * }} opts
   */
  constructor(opts) {
    if (!opts || !opts.base || !opts.overrides) {
      throw makePackError('PACK_OVERLAY_MISSING_SOURCES');
    }

    this.id = String(opts.id || 'overlay');
    this.kind = 'overlay';

    this.base = opts.base;
    this.overrides = opts.overrides;

    // Listing is "supported" if at least one source can list.
    this.supportsListing = Boolean(this.base.supportsListing || this.overrides.supportsListing);
  }

  /**
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<import('./pack-source.js').PackFileList>}
   */
  async listFiles(options = {}) {
    if (options && options.signal && options.signal.aborted) {
      throw makePackError('PACK_ABORTED');
    }

    const baseList = this.base.supportsListing
      ? await this.base.listFiles(options)
      : { paths: [], complete: false };

    const overrideList = this.overrides.supportsListing
      ? await this.overrides.listFiles(options)
      : { paths: [], complete: false };

    const set = new Set();
    for (const p of baseList.paths || []) set.add(p);
    for (const p of overrideList.paths || []) set.add(p);

    return {
      paths: Array.from(set).sort(),
      complete: Boolean(baseList.complete && overrideList.complete),
    };
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
      return await this.overrides.readText(path, options);
    } catch (e) {
      if (!isPackNotFoundError(e)) throw e;
    }

    return this.base.readText(path, options);
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
      return await this.overrides.readBlob(path, options);
    } catch (e) {
      if (!isPackNotFoundError(e)) throw e;
    }

    return this.base.readBlob(path, options);
  }
}

/**
 * Convenience factory.
 *
 * @param {{
 *  id?: string,
 *  base: import('./pack-source.js').PackSource,
 *  overrides: import('./pack-source.js').PackSource,
 * }} opts
 */
export function createOverlayPackSource(opts) {
  return new OverlayPackSource({
    id: String(opts && opts.id ? opts.id : 'overlay'),
    base: opts.base,
    overrides: opts.overrides,
  });
}
