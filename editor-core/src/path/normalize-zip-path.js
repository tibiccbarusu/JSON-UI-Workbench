/*
  normalize-zip-path.js

  Deterministic, security-oriented path normalization for zip entry names.

  Rationale:
  - Zip archives can contain dangerous/ambiguous paths (absolute paths, ../ traversal,
    backslashes from Windows zips, repeated slashes, etc.).
  - Minecraft Bedrock resource packs expect POSIX-like paths with forward slashes.

  This function is intentionally strict. If a path cannot be normalized safely,
  it throws.
*/

/**
 * Normalize a zip entry filename into a safe, canonical path.
 *
 * Rules:
 * - Convert backslashes to forward slashes.
 * - Collapse multiple slashes.
 * - Remove leading "./" segments.
 * - Remove trailing slash.
 * - Reject absolute paths ("/foo"), drive-letter paths ("C:\\foo" / "C:foo"), URL schemes,
 *   and traversal (".." segments).
 * - Reject control characters.
 *
 * @param {string} rawName
 * @returns {string}
 */
export function normalizeZipPath(rawName) {
  if (typeof rawName !== 'string') {
    throw new Error('ZIP_PATH_INVALID_TYPE');
  }

  // Normalize separators early.
  let s = rawName.replace(/\\/g, '/');

  // Reject obvious absolute paths.
  if (s.startsWith('/')) {
    throw new Error('ZIP_PATH_ABSOLUTE');
  }

  // Reject control characters (including null byte).
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7F) {
      throw new Error('ZIP_PATH_CONTROL_CHAR');
    }
  }

  // Collapse repeated slashes.
  s = s.replace(/\/+/, '/');
  while (s.includes('//')) s = s.replace(/\/\//g, '/');

  // Remove leading './' segments.
  while (s.startsWith('./')) s = s.slice(2);

  // URL parsing strips leading ASCII spaces. Use the parser-equivalent prefix
  // for these boundary checks so " http:evil/x" cannot become an absolute URL
  // after this function has accepted it.
  const boundaryPrefix = s.replace(/^ +/, '');

  // A pack path is always relative. Reject both Windows drive-absolute and
  // drive-relative forms after removing leading "./" so variants such as
  // "./C:foo" cannot bypass the check.
  if (/^[A-Za-z]:/.test(boundaryPrefix)) {
    throw new Error('ZIP_PATH_DRIVE_LETTER');
  }

  // Reject URL-scheme-like prefixes. Besides being invalid pack paths, values
  // such as "http:evil.example/x" become absolute URLs when resolved with
  // new URL(path, baseUrl), escaping the intended pack base.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(boundaryPrefix)) {
    throw new Error('ZIP_PATH_URL_SCHEME');
  }

  // Remove trailing slash.
  while (s.endsWith('/')) s = s.slice(0, -1);

  if (!s) {
    throw new Error('ZIP_PATH_EMPTY');
  }

  const parts = s.split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      throw new Error('ZIP_PATH_TRAVERSAL');
    }
    // Reject drive-relative segments like "C:foo" as well as "C:".
    if (/^[A-Za-z]:/.test(part)) {
      throw new Error('ZIP_PATH_DRIVE_LETTER');
    }
    out.push(part);
  }

  const normalized = out.join('/');
  if (!normalized) {
    throw new Error('ZIP_PATH_EMPTY');
  }

  // Safety bound: extremely long paths are suspicious and not needed for packs.
  if (normalized.length > 1024) {
    throw new Error('ZIP_PATH_TOO_LONG');
  }

  return normalized;
}
