/**
 * Cache the Classic UI path list for the current imported/reference arrays.
 * This module owns no I/O or app state. Input arrays belong to the caller.
 * Replacing an array, changing its length, or changing mutationEpoch rebuilds
 * the list. In-place edits that preserve length MUST change mutationEpoch or
 * call clear(); inspecting every element on a hit would repeat the hot scan.
 *
 * Only the latest composition is retained. The frozen result can be shared by
 * pointer/interaction requests without allocating another list on each hit.
 */
const EMPTY_PATHS = Object.freeze([]);

/**
 * @returns {{
 *   get:(importedPaths?:ReadonlyArray<unknown>|null, referencePaths?:ReadonlyArray<unknown>|null, mutationEpoch?:unknown)=>ReadonlyArray<string>,
 *   clear:()=>void,
 *   snapshot:()=>{hits:number,misses:number,scannedPaths:number,cachedPaths:number,retainedArrays:number}
 * }}
 */
export function createUiScreenPathCache() {
  let current = null;
  let hits = 0, misses = 0, scannedPaths = 0;
  return Object.freeze({
    get(importedPaths, referencePaths, mutationEpoch = 0) {
      const imported = Array.isArray(importedPaths) ? importedPaths : EMPTY_PATHS;
      const reference = Array.isArray(referencePaths) ? referencePaths : EMPTY_PATHS;
      const importedLength = imported.length, referenceLength = reference.length;
      if (current && current.imported === imported && current.reference === reference
        && current.importedLength === importedLength && current.referenceLength === referenceLength
        && Object.is(current.mutationEpoch, mutationEpoch)) {
        hits++;
        return current.result;
      }
      misses++;
      const paths = new Set();
      for (const source of [imported, reference]) {
        for (const raw of source) {
          scannedPaths++;
          // Keep the previous path filtering, exact-case deduplication and
          // code-unit sort. This list is a navigation hint, not path authority.
          const packPath = String(raw || '');
          if (/^ui\/.+\.jsonc?$/iu.test(packPath) && !/(?:^|\/)_|pocket/iu.test(packPath)) paths.add(packPath);
        }
      }
      const result = Object.freeze([...paths].sort());
      // Publish only a complete scan; a throwing input cannot poison a hit.
      current = { imported, reference, importedLength, referenceLength, mutationEpoch, result };
      return result;
    },
    clear() { current = null; },
    snapshot() {
      return { hits, misses, scannedPaths, cachedPaths: current?.result.length || 0,
        retainedArrays: current ? new Set([current.imported, current.reference].filter(value => value !== EMPTY_PATHS)).size : 0 };
    },
  });
}
