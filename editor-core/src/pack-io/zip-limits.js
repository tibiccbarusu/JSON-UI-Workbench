/*
  zip-limits.js

  Centralized ZIP import/read limits.

  These values are derived from PROJECT/SPEC/nonfunctional.md.
  They are enforced in the ZipReader wrapper to mitigate zip bombs and
  other resource exhaustion attacks.
*/

/** @type {{
 *  maxZipBytes: number,
 *  maxEntryCount: number,
 *  maxTotalUncompressedBytes: number,
 *  maxCompressionRatioPerEntry: number,
 *  maxEntryUncompressedBytesForRead: number,
 *  maxTextFileBytesForRead: number,
 *  allowEncryptedZip: boolean,
 *  useWebWorkers: boolean,
 * }} */
export const DEFAULT_ZIP_LIMITS = {
  // Hard cap for uploaded zip size.
  maxZipBytes: 600 * 1024 * 1024, // 600 MiB

  // Hard cap for number of entries.
  maxEntryCount: 120_000,

  // Hard cap for total uncompressed data size (sum of entry sizes).
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024, // 2 GiB

  // Heuristic zip-bomb signal: extremely high compression ratio.
  // If exceeded, reads of that entry will be blocked.
  maxCompressionRatioPerEntry: 200,

  // Read-time caps.
  maxEntryUncompressedBytesForRead: 64 * 1024 * 1024, // 64 MiB
  maxTextFileBytesForRead: 8 * 1024 * 1024, // 8 MiB

  // Policy: encrypted zips are rejected.
  allowEncryptedZip: false,

  // Keep decompression off the main thread. The pinned worker and WASM files
  // are self-hosted with the release and covered by the CSP/lock manifest.
  useWebWorkers: true,
};
