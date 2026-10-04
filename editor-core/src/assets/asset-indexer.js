/*
  asset-indexer.js (S040)

  Build lightweight indexes for resource pack assets used by the editor/preview.

  Goals
  - Index by *paths only* (no file content reads): textures/, font/, texts/.
  - Provide fast case-insensitive existence checks.
  - Provide deterministic collision reporting (case-fold collisions).
  - Provide basic resolution helpers for common reference forms.

  Non-goals
  - Parsing .lang files, font JSON, or texture atlases.
  - Rendering.
*/

import { normalizePackPath } from '../path/normalize-pack-path.js';

/** @typedef {'textures'|'font'|'texts'} AssetCategory */

/**
 * @typedef {{
 *  category: AssetCategory,
 *  totalPaths: number,
 *  uniqueLowerKeys: number,
 *  collisionLowerKeys: number,
 *  invalidPaths: number,
 *  byLower: Map<string, string[]>,
 }} PackPathCaseIndex
 */

/**
 * @typedef {{
 *  textures: PackPathCaseIndex,
 *  font: PackPathCaseIndex,
 *  texts: PackPathCaseIndex,
 }} AssetIndex
 */

/**
 * @typedef {{
 *  ok: true,
 *  kind: 'texture',
 *  input: string,
 *  normalizedRef: string,
 *  candidates: string[],
 *  resolved: null | {
 *    source: 'imported'|'vanilla',
 *    packPath: string,
 *    matchedCandidate: string,
 *  },
 *  collision: null | {
 *    source: 'imported'|'vanilla',
 *    lowerKey: string,
 *    candidates: string[],
 *  },
 } | {
 *  ok: false,
 *  kind: 'texture',
 *  input: string,
 *  error: string,
 * }} TextureResolveResult
 */

/**
 * @typedef {{
 *  ok: true,
 *  kind: 'font',
 *  input: string,
 *  normalizedRef: string,
 *  builtIn: boolean,
 *  candidates: string[],
 *  resolved: null | {
 *    source: 'imported'|'vanilla',
 *    packPath: string,
 *    matchedCandidate: string,
 *  },
 *  collision: null | {
 *    source: 'imported'|'vanilla',
 *    lowerKey: string,
 *    candidates: string[],
 *  },
 * } | {
 *  ok: false,
 *  kind: 'font',
 *  input: string,
 *  error: string,
 * }} FontResolveResult
 */

/**
 * Best-effort safe normalization for a pack-relative path.
 *
 * IMPORTANT: This is used on *file lists* and must not throw.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function safeNormalizePackPath(raw) {
  try {
    return normalizePackPath(String(raw || ''));
  } catch {
    return null;
  }
}

/**
 * @param {string} a
 * @param {string} b
 */
function sortStable(a, b) {
  return String(a).localeCompare(String(b));
}

function nowMs() {
  try {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    // ignore
  }
  return Date.now();
}

/** @returns {Promise<void>} */
function yieldToMain() {
  return new Promise((resolve) => {
    try {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
        return;
      }
    } catch {
      // ignore
    }
    setTimeout(resolve, 0);
  });
}

const DEFAULT_YIELD_EVERY_MS = 12;

/**
 * @typedef {{
 *  yieldEveryMs?: number,
 *  onProgress?: (info: { phase: 'scan'|'finalize', processed: number, total: number, category?: AssetCategory }) => void,
 *  signal?: AbortSignal,
 * }} AssetIndexBuildOptions
 */

/**
 * Build a case-insensitive lookup structure for a set of pack-relative paths.
 *
 * - Keys are lower-cased full pack paths.
 * - Values retain canonical casing as found in the pack.
 *
 * @param {AssetCategory} category
 * @param {string[]} rawPaths
 * @returns {PackPathCaseIndex}
 */
function buildCaseIndex(category, rawPaths) {
  /** @type {Map<string, Set<string>>} */
  const byLowerSet = new Map();
  let totalPaths = 0;
  let invalidPaths = 0;

  for (const raw of Array.isArray(rawPaths) ? rawPaths : []) {
    const normalized = safeNormalizePackPath(raw);
    if (!normalized) {
      invalidPaths += 1;
      continue;
    }

    totalPaths += 1;
    const lower = normalized.toLowerCase();
    const existing = byLowerSet.get(lower);
    if (existing) {
      existing.add(normalized);
    } else {
      byLowerSet.set(lower, new Set([normalized]));
    }
  }

  /** @type {Map<string, string[]>} */
  const byLower = new Map();
  let collisionLowerKeys = 0;

  for (const [lower, set] of byLowerSet.entries()) {
    const list = Array.from(set).sort(sortStable);
    if (list.length > 1) collisionLowerKeys += 1;
    byLower.set(lower, list);
  }

  return {
    category,
    totalPaths,
    uniqueLowerKeys: byLower.size,
    collisionLowerKeys,
    invalidPaths,
    byLower,
  };
}

/**
 * Filter and normalize pack-relative file paths for a specific top-level folder.
 *
 * @param {string[]} packPaths
 * @param {string} prefixLower e.g. "textures/"
 */
function filterByTopFolder(packPaths, prefixLower) {
  const prefix = String(prefixLower || '').toLowerCase();
  /** @type {string[]} */
  const out = [];

  for (const raw of Array.isArray(packPaths) ? packPaths : []) {
    const normalized = safeNormalizePackPath(raw);
    if (!normalized) continue;
    if (normalized.toLowerCase().startsWith(prefix)) out.push(normalized);
  }

  return out;
}

/**
 * Build asset indexes for a pack (paths only).
 *
 * @param {string[]} packPaths Pack-relative file paths (NOT zip entry paths).
 * @returns {AssetIndex}
 */
export function buildAssetIndexFromPackPaths(packPaths) {
  const texturesPaths = filterByTopFolder(packPaths, 'textures/');
  const fontPaths = filterByTopFolder(packPaths, 'font/');
  const textsPaths = filterByTopFolder(packPaths, 'texts/');

  return {
    textures: buildCaseIndex('textures', texturesPaths),
    font: buildCaseIndex('font', fontPaths),
    texts: buildCaseIndex('texts', textsPaths),
  };
}
/**
 * Async variant of buildAssetIndexFromPackPaths() that yields to the main thread
 * during long scans to keep the UI responsive on very large packs.
 *
 * NOTE: This still only indexes *paths* (no file reads).
 *
 * @param {string[]} packPaths Pack-relative file paths (NOT zip entry paths).
 * @param {AssetIndexBuildOptions} [options]
 * @returns {Promise<AssetIndex>}
 */
export async function buildAssetIndexFromPackPathsAsync(packPaths, options = {}) {
  const yieldEveryMs = Number.isFinite(options.yieldEveryMs)
    ? Math.max(0, Number(options.yieldEveryMs))
    : DEFAULT_YIELD_EVERY_MS;

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const signal = options.signal || null;
  if (signal?.aborted) throw new Error('ASSET_INDEX_ABORTED');

  /** @type {{ category: AssetCategory, byLowerSet: Map<string, Set<string>>, totalPaths: number, invalidPaths: number }} */
  const buckets = {
    textures: { category: 'textures', byLowerSet: new Map(), totalPaths: 0, invalidPaths: 0 },
    font: { category: 'font', byLowerSet: new Map(), totalPaths: 0, invalidPaths: 0 },
    texts: { category: 'texts', byLowerSet: new Map(), totalPaths: 0, invalidPaths: 0 },
  };

  const total = Array.isArray(packPaths) ? packPaths.length : 0;
  let lastYieldMs = nowMs();

  for (let i = 0; i < total; i += 1) {
    if (signal?.aborted) throw new Error('ASSET_INDEX_ABORTED');
    const raw = packPaths[i];
    const normalized = safeNormalizePackPath(raw);
    if (!normalized) {
      // Keep behavior aligned with the sync implementation:
      // invalid paths are effectively ignored (filter phase drops them).
      continue;
    }

    const lower = normalized.toLowerCase();

    /** @type {keyof typeof buckets | null} */
    let key = null;
    if (lower.startsWith('textures/')) key = 'textures';
    else if (lower.startsWith('font/')) key = 'font';
    else if (lower.startsWith('texts/')) key = 'texts';

    if (key) {
      const bucket = buckets[key];
      bucket.totalPaths += 1;

      const set = bucket.byLowerSet.get(lower);
      if (set) set.add(normalized);
      else bucket.byLowerSet.set(lower, new Set([normalized]));
    }

    const now = nowMs();
    if (yieldEveryMs > 0 && now - lastYieldMs >= yieldEveryMs) {
      if (onProgress) onProgress({ phase: 'scan', processed: i + 1, total });
      await yieldToMain();
      lastYieldMs = nowMs();
    }
  }

  // Finalize into the same structure as buildCaseIndex().
  /** @param {typeof buckets[keyof typeof buckets]} bucket */
  async function finalizeBucket(bucket) {
    /** @type {Map<string, string[]>} */
    const byLower = new Map();
    let collisionLowerKeys = 0;

    const entries = Array.from(bucket.byLowerSet.entries());
    let lastYield = nowMs();

    for (let i = 0; i < entries.length; i += 1) {
      if (signal?.aborted) throw new Error('ASSET_INDEX_ABORTED');
      const [lower, set] = entries[i];
      const list = Array.from(set).sort(sortStable);
      if (list.length > 1) collisionLowerKeys += 1;
      byLower.set(lower, list);

      const now = nowMs();
      if (yieldEveryMs > 0 && now - lastYield >= yieldEveryMs) {
        if (onProgress) onProgress({ phase: 'finalize', category: bucket.category, processed: i + 1, total: entries.length });
        await yieldToMain();
        lastYield = nowMs();
      }
    }

    return /** @type {PackPathCaseIndex} */ ({
      category: bucket.category,
      totalPaths: bucket.totalPaths,
      uniqueLowerKeys: byLower.size,
      collisionLowerKeys,
      invalidPaths: bucket.invalidPaths,
      byLower,
    });
  }

  const textures = await finalizeBucket(buckets.textures);
  const font = await finalizeBucket(buckets.font);
  const texts = await finalizeBucket(buckets.texts);

  return { textures, font, texts };
}


/**
 * Convert an AssetIndex into a JSON-safe summary object (counts only).
 * @param {AssetIndex|null|undefined} assetIndex
 */
export function summarizeAssetIndex(assetIndex) {
  if (!assetIndex) return null;
  return {
    textures: {
      totalPaths: assetIndex.textures.totalPaths,
      uniqueLowerKeys: assetIndex.textures.uniqueLowerKeys,
      collisionLowerKeys: assetIndex.textures.collisionLowerKeys,
      invalidPaths: assetIndex.textures.invalidPaths,
    },
    font: {
      totalPaths: assetIndex.font.totalPaths,
      uniqueLowerKeys: assetIndex.font.uniqueLowerKeys,
      collisionLowerKeys: assetIndex.font.collisionLowerKeys,
      invalidPaths: assetIndex.font.invalidPaths,
    },
    texts: {
      totalPaths: assetIndex.texts.totalPaths,
      uniqueLowerKeys: assetIndex.texts.uniqueLowerKeys,
      collisionLowerKeys: assetIndex.texts.collisionLowerKeys,
      invalidPaths: assetIndex.texts.invalidPaths,
    },
  };
}

/**
 * Case-insensitive lookup for a pack-relative path.
 *
 * Collision policy:
 * - If an exact-case match exists in the pack, prefer it.
 * - Otherwise pick the lexicographically smallest canonical path.
 *
 * @param {PackPathCaseIndex} index
 * @param {string} candidate
 * @returns {{ found: false } | { found: true, packPath: string, lowerKey: string, collision: boolean, collisionCandidates: string[] }}
 */
export function lookupPackPath(index, candidate) {
  const normalized = safeNormalizePackPath(candidate);
  if (!normalized) return { found: false };

  const lowerKey = normalized.toLowerCase();
  const list = index.byLower.get(lowerKey);
  if (!list || list.length === 0) return { found: false };

  const exact = list.find((p) => p === normalized);
  const chosen = exact || list[0];

  return {
    found: true,
    packPath: chosen,
    lowerKey,
    collision: list.length > 1,
    collisionCandidates: list.length > 1 ? list.slice() : [],
  };
}

/**
 * Normalize a raw texture reference into a key without the `textures/` prefix
 * and without a supported raster extension.
 *
 * This follows SPEC/asset_resolution.md (Texture resolution) in a simplified way.
 *
 * @param {string} rawRef
 * @returns {{ ok: true, normalizedKey: string } | { ok: false, error: string }}
 */
function normalizeTextureRefToKey(rawRef) {
  const input = String(rawRef || '').trim();
  if (!input) return { ok: false, error: 'TEXTURE_REF_EMPTY' };

  // Be forgiving about leading slashes/backslashes.
  let s = input.replace(/^[/\\]+/, '');

  // Remove optional "textures/" prefix (case-insensitive).
  if (s.toLowerCase().startsWith('textures/')) {
    s = s.slice('textures/'.length);
  }

  // Remove optional extension.
  s = s.replace(/\.(tga|png|jpg|jpeg)$/i, '');

  const normalized = safeNormalizePackPath(s);
  if (!normalized) return { ok: false, error: 'TEXTURE_REF_INVALID_PATH' };

  // Defensive: if the user typed "textures/" again in weird casing.
  const key = normalized.toLowerCase().startsWith('textures/') ? normalized.slice('textures/'.length) : normalized;
  if (!key) return { ok: false, error: 'TEXTURE_REF_EMPTY_AFTER_NORMALIZE' };

  return { ok: true, normalizedKey: key };
}

/**
 * Resolve a texture reference against imported and vanilla asset indexes.
 *
 * Resolution order:
 * 1) imported pack textures
 * 2) vanilla reference textures
 *
 * @param {string} rawRef
 * @param {{ importedIndex?: AssetIndex|null, vanillaIndex?: AssetIndex|null }} sources
 * @returns {TextureResolveResult}
 */
export function resolveTextureRef(rawRef, sources = {}) {
  const input = String(rawRef || '');
  const normalized = normalizeTextureRefToKey(input);
  if (!normalized.ok) {
    return { ok: false, kind: 'texture', input, error: normalized.error };
  }

  const candidates = [
    `textures/${normalized.normalizedKey}.tga`,
    `textures/${normalized.normalizedKey}.png`,
    `textures/${normalized.normalizedKey}.jpg`,
    `textures/${normalized.normalizedKey}.jpeg`,
  ].map((p) => safeNormalizePackPath(p)).filter(Boolean);

  /** @type {AssetIndex|null} */
  const importedIndex = sources.importedIndex || null;
  /** @type {AssetIndex|null} */
  const vanillaIndex = sources.vanillaIndex || null;

  /** @type {TextureResolveResult['collision']} */
  let collision = null;

  const trySource = (label, idx) => {
    if (!idx) return null;
    for (const cand of candidates) {
      const r = lookupPackPath(idx.textures, cand);
      if (!r.found) continue;
      if (r.collision && !collision) {
        collision = {
          source: label,
          lowerKey: r.lowerKey,
          candidates: r.collisionCandidates,
        };
      }
      return { source: label, packPath: r.packPath, matchedCandidate: cand };
    }
    return null;
  };

  const resolved =
    trySource('imported', importedIndex) ||
    trySource('vanilla', vanillaIndex) ||
    null;

  return {
    ok: true,
    kind: 'texture',
    input,
    normalizedRef: normalized.normalizedKey,
    candidates,
    resolved,
    collision,
  };
}

/**
 * Convert a user-facing font_type string into a normalized path stem.
 *
 * Examples:
 * - "MinecraftTen" -> "minecraft-ten" (best-effort)
 * - "font/minecraft-ten.ttf" -> "minecraft-ten"
 *
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeFontStem(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;

  // Forgive leading slashes/backslashes and normalize separators.
  s = s.replace(/^[/\\]+/, '').replace(/\\/g, '/');

  // Drop optional font/ prefix.
  if (s.toLowerCase().startsWith('font/')) s = s.slice('font/'.length);

  // Drop common extensions.
  s = s.replace(/\.(ttf|otf|woff2|woff|ttc)$/i, '');

  const normalized = safeNormalizePackPath(s);
  if (!normalized) return null;
  const out = normalized.toLowerCase().startsWith('font/') ? normalized.slice('font/'.length) : normalized;
  return out || null;
}

/**
 * @param {string} raw
 */
function toKebabPath(raw) {
  const s = String(raw || '').trim().replace(/\\/g, '/');
  if (!s) return s;
  return s
    .split('/')
    .map((seg) =>
      seg
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[ _]+/g, '-')
    )
    .join('/')
    .toLowerCase();
}

/**
 * Resolve a Bedrock JSON UI `font_type` (or a pack-relative font path) against
 * imported + vanilla font indexes.
 *
 * Resolution order:
 * 1) imported pack fonts
 * 2) vanilla reference fonts
 *
 * @param {string} rawFontType
 * @param {{ importedIndex?: AssetIndex|null, vanillaIndex?: AssetIndex|null }} sources
 * @returns {FontResolveResult}
 */
export function resolveFontTypeRef(rawFontType, sources = {}) {
  const input = String(rawFontType || '');
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, kind: 'font', input, error: 'FONT_TYPE_EMPTY' };

  // Bedrock's semantic font families are supplied by the engine and do not
  // map to pack files. Only custom/path-like names should enter asset lookup.
  const builtInFontType = trimmed.toLowerCase();
  const builtIn = ['default', 'smooth', 'rune', 'unicode', 'minecraftten'].includes(builtInFontType);
  // MinecraftTen is named in vanilla font_metadata.json with a real TTF path.
  // Prefer that authored resource when indexed; its semantic fallback still
  // exists when no pack file is present, but is not a host-serif substitute.
  if (builtIn && builtInFontType !== 'minecraftten') {
    return {
      ok: true,
      kind: 'font',
      input,
      normalizedRef: builtInFontType,
      builtIn: true,
      candidates: [],
      resolved: null,
      collision: null,
    };
  }

  const stems = [
    normalizeFontStem(trimmed),
    normalizeFontStem(toKebabPath(trimmed)),
    normalizeFontStem(trimmed.toLowerCase()),
  ].filter(Boolean);

  // Also consider underscore variants for common naming patterns.
  for (const s of stems.slice()) {
    if (s.includes('-')) stems.push(s.replace(/-/g, '_'));
  }

  const uniqueStems = Array.from(new Set(stems.map(String)));
  if (uniqueStems.length === 0) return { ok: false, kind: 'font', input, error: 'FONT_TYPE_INVALID' };

  const exts = ['ttf', 'otf', 'woff2', 'woff'];
  const candidates = [];
  for (const stem of uniqueStems) {
    for (const ext of exts) {
      const p = safeNormalizePackPath(`font/${stem}.${ext}`);
      if (p) candidates.push(p);
    }
  }

  /** @type {AssetIndex|null} */
  const importedIndex = sources.importedIndex || null;
  /** @type {AssetIndex|null} */
  const vanillaIndex = sources.vanillaIndex || null;

  /** @type {FontResolveResult['collision']} */
  let collision = null;

  const trySource = (label, idx) => {
    if (!idx) return null;
    for (const cand of candidates) {
      const r = lookupPackPath(idx.font, cand);
      if (!r.found) continue;
      if (r.collision && !collision) {
        collision = {
          source: label,
          lowerKey: r.lowerKey,
          candidates: r.collisionCandidates,
        };
      }
      return { source: label, packPath: r.packPath, matchedCandidate: cand };
    }
    return null;
  };

  const resolved =
    trySource('imported', importedIndex) ||
    trySource('vanilla', vanillaIndex) ||
    null;

  return {
    ok: true,
    kind: 'font',
    input,
    normalizedRef: uniqueStems[0],
    builtIn: builtIn && !resolved,
    candidates: builtIn && !resolved ? [] : candidates,
    resolved,
    collision,
  };
}
