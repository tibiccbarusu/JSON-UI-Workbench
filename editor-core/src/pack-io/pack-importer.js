/*
  pack-importer.js (S025)

  Import a Resource Pack ZIP:
  - open ZIP with ZipReader (limits enforced)
  - locate manifest.json (tolerate top-level folder)
  - parse manifest.json via JSONC parser (tolerant input)
  - validate minimal manifest shape and require a 'resources' module
  - build a file index summary and detect ui/ root + system files

  This module returns a structured result for UI display, and keeps the ZipReader
  open on success so later steps can read pack files lazily.
*/

import { ZipReader } from './zip-reader.js';
import { tryNodeImport } from './node-remote-client.js';
import { DEFAULT_ZIP_LIMITS } from './zip-limits.js';
import { makePackError } from './pack-source.js';
import { parseJsonc } from '../json/jsonc.js';
import { extractManifestSummary, validateManifest } from './manifest-utils.js';
import {
  buildPackFileIndexSummary,
  derivePackPaths,
  deriveRootPrefixFromManifestPath,
} from './pack-indexer.js';

const DEFAULT_MANIFEST_MAX_BYTES = 1024 * 1024; // 1 MiB (manifest should be tiny)

/**
 * @typedef {{
 *  ok: true,
 *  zipReader: ZipReader,
 *  zipMeta: any,
 *  zipWarnings: any[],
 *  manifestZipPath: string,
 *  rootPrefix: string,
 *  manifest: any,
 *  manifestSummary: import('./manifest-utils.js').ManifestSummary,
 *  manifestValidation: import('./manifest-utils.js').ManifestValidation,
 *  packPaths: string[],
 *  fileIndex: import('./pack-indexer.js').PackFileIndexSummary,
 *  warnings: { code: string, message: string }[],
 }} ImportPackSuccess
 */

/**
 * @typedef {{
 *  ok: false,
 *  error: Error,
 }} ImportPackFailure
 */

/**
 * @typedef {ImportPackSuccess|ImportPackFailure} ImportPackResult
 */

/**
 * @param {string} path
 */
function isManifestPath(path) {
  const p = String(path || '');
  const lc = p.toLowerCase();
  return lc === 'manifest.json' || lc.endsWith('/manifest.json');
}

/**
 * Depth as the number of '/' separators.
 * @param {string} path
 */
function pathDepth(path) {
  const p = String(path || '');
  if (!p) return 0;
  return p.split('/').length - 1;
}

/**
 * Import an uploaded ZIP as a Resource Pack.
 *
 * @param {File} file
 * @param {{
 *  limits?: import('./zip-limits.js').ZipLimits,
 *  previewLimit?: number,
 *  manifestMaxBytes?: number,
 *  maxManifestCandidates?: number,
 *  signal?: AbortSignal,
 *  onProgress?: (progress: { phase: string, processed?: number, total?: number|null, zipBytes?: number }) => void,
 * }} [options]
 * @returns {Promise<ImportPackResult>}
 */
export async function importResourcePackZip(file, options = {}) {
  if (typeof window !== 'undefined' && !options.zipReader) {
    try { const remote = await tryNodeImport(file, options); if (remote) return remote;
      if (/\.mcaddon$/iu.test(file?.name || '')) return { ok: false, error: makePackError('ADDON_NODE_BACKEND_REQUIRED') }; }
    catch (error) { return { ok: false, error }; }
  }
  const limits = options?.limits || DEFAULT_ZIP_LIMITS;
  const previewLimit = Number.isFinite(options?.previewLimit) ? Number(options.previewLimit) : 200;
  const manifestMaxBytes = Number.isFinite(options?.manifestMaxBytes)
    ? Number(options.manifestMaxBytes)
    : DEFAULT_MANIFEST_MAX_BYTES;
  const maxManifestCandidates = Number.isFinite(options?.maxManifestCandidates)
    ? Number(options.maxManifestCandidates)
    : 8;
  const signal = options?.signal || null;
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;

  const zipReader = options.zipReader || new ZipReader({ limits });

  try {
    if (signal?.aborted) throw makePackError('PACK_ABORTED');
    if (onProgress) onProgress({ phase: 'open', processed: 0, total: null, zipBytes: Number(file?.size || 0) });
    await zipReader.openFromFile(file);
    if (signal?.aborted) throw makePackError('PACK_ABORTED');
    const { meta: zipMeta, warnings: zipWarnings } = await zipReader.listEntries({
      previewLimit,
      signal,
      onProgress,
    });
    if (signal?.aborted) throw makePackError('PACK_ABORTED');
    if (onProgress) onProgress({ phase: 'manifest', processed: 0, total: null, zipBytes: zipMeta.zipBytes });
    const zipPaths = await zipReader.listAllFilePaths();

    const manifestCandidates = zipPaths.filter(isManifestPath);
    if (manifestCandidates.length === 0) {
      throw makePackError('PACK_IMPORT_MANIFEST_NOT_FOUND', {
        message: 'manifest.json was not found in the ZIP (expected at pack root).',
      });
    }

    /** @type {{ path: string, manifest: any, summary: any, validation: any }[]} */
    const evaluated = [];

    // Evaluate a small number of candidates (depth order). This is defensive for
    // zips that include both a resource pack and behavior pack.
    const sortedCandidates = manifestCandidates
      .slice()
      .sort((a, b) => pathDepth(a) - pathDepth(b) || String(a).localeCompare(String(b)));

    for (const path of sortedCandidates.slice(0, Math.max(1, maxManifestCandidates))) {
      if (signal?.aborted) throw makePackError('PACK_ABORTED');
      let text;
      try {
        text = await zipReader.readText(path, { maxBytes: manifestMaxBytes });
      } catch (err) {
        // If reads are blocked by ZipReader budgets, surface a stable error.
        throw makePackError('PACK_IMPORT_MANIFEST_READ_FAILED', {
          message: `Failed to read manifest.json at "${path}".`,
          cause: err,
          data: { path },
        });
      }

      const parsed = parseJsonc(text, { fileName: path, allowTrailingComma: true });
      if (!parsed.ok) {
        continue;
      }

      const validation = validateManifest(parsed.value);
      const summary = extractManifestSummary(parsed.value);
      evaluated.push({ path, manifest: parsed.value, summary, validation });
    }

    if (evaluated.length === 0) {
      throw makePackError('PACK_IMPORT_MANIFEST_PARSE_FAILED', {
        message: 'manifest.json exists, but could not be parsed as JSON.',
        data: { paths: sortedCandidates.slice(0, Math.max(1, maxManifestCandidates)) },
      });
    }

    // Prefer: a valid resource pack manifest. Otherwise, pick the first parsed.
    const best = evaluated
      .slice()
      .sort((a, b) => {
        const aScore = (a.validation?.ok && a.validation?.isResourcePack) ? 0 : 1;
        const bScore = (b.validation?.ok && b.validation?.isResourcePack) ? 0 : 1;
        return aScore - bScore || pathDepth(a.path) - pathDepth(b.path) || String(a.path).localeCompare(String(b.path));
      })[0];

    if (!best.validation.ok) {
      throw makePackError('PACK_IMPORT_MANIFEST_INVALID', {
        message: 'manifest.json is present but invalid.',
        data: { errors: best.validation.errors, warnings: best.validation.warnings, path: best.path },
      });
    }

    if (!best.validation.isResourcePack) {
      throw makePackError('PACK_IMPORT_NOT_RESOURCE_PACK', {
        message: 'The imported ZIP does not appear to be a Resource Pack (no "resources" module).',
        data: { moduleTypes: best.validation.moduleTypes, path: best.path },
      });
    }

    const rootPrefix = deriveRootPrefixFromManifestPath(best.path);
    const derived = derivePackPaths(zipPaths, rootPrefix, best.path);
    const { index: fileIndex, warnings: indexWarnings } = buildPackFileIndexSummary(derived.packPaths);

    /** @type {{ code: string, message: string }[]} */
    const warnings = [];
    warnings.push(...(zipWarnings || []));
    warnings.push(...(derived.warnings || []));
    warnings.push(...(indexWarnings || []));
    // include manifest warnings (non-fatal)
    warnings.push(...(best.validation.warnings || []));

    if (signal?.aborted) throw makePackError('PACK_ABORTED');
    if (onProgress) {
      onProgress({
        phase: 'complete',
        processed: zipMeta.entryCount,
        total: zipMeta.entryCount,
        zipBytes: zipMeta.zipBytes,
      });
    }
    return {
      ok: true,
      zipReader,
      zipMeta,
      zipWarnings: Array.isArray(zipWarnings) ? zipWarnings : [],
      manifestZipPath: best.path,
      rootPrefix,
      manifest: best.manifest,
      manifestSummary: best.summary,
      manifestValidation: best.validation,
      packPaths: derived.packPaths,
      fileIndex,
      warnings,
    };
  } catch (error) {
    try {
      await zipReader.close();
    } catch {
      // ignore
    }
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
