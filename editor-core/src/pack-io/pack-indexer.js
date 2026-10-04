/*
  pack-indexer.js (S025)

  Build a lightweight, import-time file index for an imported pack ZIP.

  Responsibilities:
  - Determine the pack root prefix (when a ZIP contains a top-level folder)
  - Build a list of pack-relative file paths
  - Detect an "ui" folder (case-insensitive match) and known system files

  This index is *not* the full asset resolver; it is only a summary used by
  the import wizard UI and later steps.
*/

/**
 * @typedef {{
 *  rootPrefix: string,
 *  manifestZipPath: string,
 *  packPaths: string[],
 *  outsideRootCount: number,
 *  warnings: { code: string, message: string }[],
 * }} PackPathDerivation
 */

/**
 * @typedef {{
 *  rootFolder: string|null,
 *  fileCount: number,
 *  jsonCount: number,
 *  systemFiles: {
 *    uiDefs: string|null,
 *    globalVariables: string|null,
 *  },
 *  screenFilesCount: number,
 *  screenFilesPreview: string[],
 * }} UiIndexSummary
 */

/**
 * @typedef {{
 *  fileCount: number,
 *  pathsPreview: string[],
 *  ui: UiIndexSummary,
 * }} PackFileIndexSummary
 */

/**
 * @param {string} manifestZipPath
 * @returns {string}
 */
export function deriveRootPrefixFromManifestPath(manifestZipPath) {
  const p = String(manifestZipPath || '');
  const i = p.lastIndexOf('/');
  if (i < 0) return '';
  return p.slice(0, i + 1);
}

/**
 * Derive pack-relative paths by stripping the root prefix.
 *
 * @param {string[]} zipFilePaths All file paths in the ZIP (normalized).
 * @param {string} rootPrefix Root prefix to strip ("" or "SomeFolder/")
 * @param {string} manifestZipPath The manifest path chosen as root anchor.
 * @returns {PackPathDerivation}
 */
export function derivePackPaths(zipFilePaths, rootPrefix, manifestZipPath) {
  /** @type {{ code: string, message: string }[]} */
  const warnings = [];

  const root = String(rootPrefix || '');
  const manifest = String(manifestZipPath || '');

  const packPaths = [];
  let outsideRootCount = 0;

  for (const p of Array.isArray(zipFilePaths) ? zipFilePaths : []) {
    const path = String(p || '');
    if (!root || path.startsWith(root)) {
      const rel = root ? path.slice(root.length) : path;
      if (rel) packPaths.push(rel);
    } else {
      outsideRootCount += 1;
    }
  }

  if (root && outsideRootCount > 0) {
    warnings.push({
      code: 'PACK_ZIP_HAS_FILES_OUTSIDE_ROOT',
      message: `ZIP contains ${outsideRootCount} file(s) outside the detected root prefix "${root}" (manifest at "${manifest}").`,
    });
  }

  return {
    rootPrefix: root,
    manifestZipPath: manifest,
    packPaths,
    outsideRootCount,
    warnings,
  };
}

/**
 * Find a path in a case-insensitive way. Returns the exact path if found.
 * @param {string[]} packPaths
 * @param {string} wantedLower
 * @returns {string|null}
 */
function findPathCaseInsensitive(packPaths, wantedLower) {
  const wanted = String(wantedLower || '').toLowerCase();
  for (const p of Array.isArray(packPaths) ? packPaths : []) {
    const s = String(p || '');
    if (s.toLowerCase() === wanted) return s;
  }
  return null;
}

/**
 * Detect the pack's UI folder name (case-insensitive match on the first segment).
 *
 * @param {string[]} packPaths
 * @returns {{ uiRootFolder: string|null, warnings: { code: string, message: string }[] }}
 */
export function detectUiRootFolder(packPaths) {
  /** @type {Set<string>} */
  const candidates = new Set();

  for (const p of Array.isArray(packPaths) ? packPaths : []) {
    const s = String(p || '');
    const first = s.split('/')[0];
    if (first && first.toLowerCase() === 'ui') candidates.add(first);
  }

  /** @type {{ code: string, message: string }[]} */
  const warnings = [];

  if (candidates.size === 0) {
    return { uiRootFolder: null, warnings };
  }

  // Prefer the canonical casing "ui" if present.
  const list = Array.from(candidates).sort();
  const uiRootFolder = candidates.has('ui') ? 'ui' : list[0];

  if (candidates.size > 1) {
    warnings.push({
      code: 'PACK_UI_FOLDER_CASE_AMBIGUOUS',
      message: `Multiple ui-like top-level folders found (${list.join(', ')}). Using "${uiRootFolder}".`,
    });
  }

  if (uiRootFolder !== 'ui') {
    warnings.push({
      code: 'PACK_UI_FOLDER_NONCANONICAL_CASE',
      message: `UI folder is "${uiRootFolder}" (non-canonical casing). Bedrock packs typically use "ui".`,
    });
  }

  return { uiRootFolder, warnings };
}

/**
 * Build a summary index for import UI.
 * @param {string[]} packPaths
 * @param {{ previewLimit?: number, uiScreenPreviewLimit?: number }} [options]
 * @returns {{ index: PackFileIndexSummary, warnings: { code: string, message: string }[] }}
 */
export function buildPackFileIndexSummary(packPaths, options = {}) {
  const previewLimit = Number.isFinite(options.previewLimit) ? Number(options.previewLimit) : 200;
  const uiScreenPreviewLimit = Number.isFinite(options.uiScreenPreviewLimit) ? Number(options.uiScreenPreviewLimit) : 50;

  const all = Array.isArray(packPaths) ? packPaths.map((p) => String(p || '')) : [];
  /** @type {{ code: string, message: string }[]} */
  const warnings = [];

  const { uiRootFolder, warnings: uiWarnings } = detectUiRootFolder(all);
  warnings.push(...uiWarnings);

  const uiPrefix = uiRootFolder ? `${uiRootFolder}/` : null;
  const uiFiles = uiPrefix ? all.filter((p) => p.startsWith(uiPrefix)) : [];
  const uiJsonFiles = uiPrefix
    ? uiFiles.filter((p) => p.toLowerCase().endsWith('.json') || p.toLowerCase().endsWith('.jsonc'))
    : [];

  const uiDefs = uiPrefix ? findPathCaseInsensitive(all, `${uiPrefix}_ui_defs.json`) : null;
  const globalVars = uiPrefix ? findPathCaseInsensitive(all, `${uiPrefix}_global_variables.json`) : null;

  // Treat json files whose basename starts with '_' as "system" and not a screen.
  const screenFiles = uiJsonFiles.filter((p) => {
    const base = p.split('/').pop() || '';
    return !base.startsWith('_');
  });

  /** @type {UiIndexSummary} */
  const ui = {
    rootFolder: uiRootFolder,
    fileCount: uiFiles.length,
    jsonCount: uiJsonFiles.length,
    systemFiles: {
      uiDefs,
      globalVariables: globalVars,
    },
    screenFilesCount: screenFiles.length,
    screenFilesPreview: screenFiles.slice(0, Math.max(0, uiScreenPreviewLimit)),
  };

  if (uiRootFolder && !uiDefs) {
    warnings.push({
      code: 'PACK_UI_DEFS_MISSING',
      message: 'ui/_ui_defs.json was not found (system screen registry).',
    });
  }
  if (uiRootFolder && !globalVars) {
    warnings.push({
      code: 'PACK_GLOBAL_VARIABLES_MISSING',
      message: 'ui/_global_variables.json was not found (global variables).',
    });
  }

  return {
    index: {
      fileCount: all.length,
      pathsPreview: all.slice(0, Math.max(0, previewLimit)),
      ui,
    },
    warnings,
  };
}
