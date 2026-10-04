/*
  normalize-pack-path.js

  Generic, deterministic path normalization for Minecraft Bedrock pack file paths.

  This builds on the strict ZIP entry normalization rules from normalize-zip-path.js,
  but exposes a pack-oriented error code prefix.

  Pack paths and ZIP entry names share the same safety constraints:
  - POSIX-like forward slashes
  - no absolute paths
  - no traversal segments
  - no control characters

  NOTE:
  - Do NOT treat pack paths as trusted input.
  - Always normalize before indexing, resolving, or fetching.
*/

import { normalizeZipPath } from './normalize-zip-path.js';

/**
 * Normalize a pack-relative path into a safe canonical form.
 *
 * On failure, throws an Error with message prefix `PACK_PATH_INVALID:`.
 *
 * @param {string} rawPath
 * @returns {string}
 */
export function normalizePackPath(rawPath) {
  try {
    return normalizeZipPath(rawPath);
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN';
    throw new Error(`PACK_PATH_INVALID:${code}`);
  }
}
