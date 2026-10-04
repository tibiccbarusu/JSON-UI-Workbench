import { normalizePackPath } from '../path/normalize-pack-path.js';
import { compareEngineVersions, parseEngineVersion } from './native-model-preview.js';

const DEFAULT_MAX_VISIBLE_PATHS = 2048;
const DEFAULT_MAX_RAW_PATHS_PER_LAYER = 50_000;

/**
 * Select the client-entity version target. Bedrock compares entity-definition
 * versions against the engine line for which the top resource pack was built;
 * the top pack's normalized manifest floor is therefore authoritative here.
 */
export function selectNativePreviewTargetEngineVersion(input = {}) {
  // A malformed or missing required version on an imported top layer must not
  // silently fall through to newer Vanilla metadata and invent a model choice.
  if (input.hasImportedPack === true) {
    return parseEngineVersion(input.importedMinEngineVersion);
  }
  for (const raw of [input.expectedBedrockVersion, input.sourceRelease]) {
    const match = String(raw || '').match(/(?:^|[^0-9])([0-9]+(?:\.[0-9]+){1,3})(?:$|[^0-9])/u);
    const parsed = match ? parseEngineVersion(match[1]) : null;
    if (parsed) return parsed;
  }
  return parseEngineVersion(input.fallback);
}

function ownStringKeys(value, maximum) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length > maximum || keys.some((key) => typeof key !== 'string')) return null;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
    }
    return keys;
  } catch {
    return null;
  }
}

function ownDataValue(record, key) {
  if (!record || typeof record !== 'object') return { ok: false, value: undefined };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return { ok: true, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return { ok: false, value: undefined };
    return { ok: true, value: descriptor.value };
  } catch {
    return { ok: false, value: undefined };
  }
}

function ownArrayLength(value) {
  if (!Array.isArray(value)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      && Number.isSafeInteger(descriptor.value) && descriptor.value >= 0
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function normalizeCandidatePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return null;
  try {
    return normalizePackPath(value.replace(/\\/gu, '/'));
  } catch {
    return null;
  }
}

/**
 * Compose a bounded, path-by-path resource-pack view. Earlier sources have
 * higher priority. A path in an upper layer shadows the same case-folded path
 * below it even when the upper document later proves invalid; falling through
 * would disagree with the effective pack and conceal the broken override.
 *
 * @param {Array<{source:string,runtime:any}>} sources Highest priority first.
 * @param {RegExp} pattern Pack-path filter without global/sticky state.
 * @param {{maximum?:number,maxRawPathsPerLayer?:number}} [options]
 * @returns {{entries:Array<{source:string,runtime:any,packPath:string}>,truncated:boolean,collision:boolean,invalid:boolean}}
 */
export function composeNativePreviewPackPaths(sources, pattern, options = {}) {
  const maximum = Number.isSafeInteger(options.maximum)
    ? Math.max(1, Math.min(DEFAULT_MAX_VISIBLE_PATHS, options.maximum))
    : DEFAULT_MAX_VISIBLE_PATHS;
  const maxRawPathsPerLayer = Number.isSafeInteger(options.maxRawPathsPerLayer)
    ? Math.max(1, Math.min(DEFAULT_MAX_RAW_PATHS_PER_LAYER, options.maxRawPathsPerLayer))
    : DEFAULT_MAX_RAW_PATHS_PER_LAYER;
  if (!Array.isArray(sources) || !(pattern instanceof RegExp) || pattern.global || pattern.sticky) {
    return { entries: [], truncated: false, collision: false, invalid: true };
  }

  const claimedFoldedPaths = new Set();
  const entries = [];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const sourceEntry = sources[sourceIndex];
    if (!sourceEntry || typeof sourceEntry !== 'object') continue;
    const source = typeof sourceEntry.source === 'string' ? sourceEntry.source : '';
    const runtime = sourceEntry.runtime;
    if (!source || !runtime || typeof runtime !== 'object') continue;

    const packPathsProperty = ownDataValue(runtime, 'packPaths');
    const overridesProperty = ownDataValue(runtime, 'overridesTextByPackPath');
    if (!packPathsProperty.ok || !overridesProperty.ok) {
      return { entries: [], truncated: false, collision: false, invalid: true };
    }
    const packPaths = packPathsProperty.value === undefined ? [] : packPathsProperty.value;
    const packPathCount = ownArrayLength(packPaths);
    if (packPathCount === null) return { entries: [], truncated: false, collision: false, invalid: true };
    const overrideKeys = ownStringKeys(overridesProperty.value, maxRawPathsPerLayer);
    if (overrideKeys === null) return { entries: [], truncated: false, collision: false, invalid: true };
    if (packPathCount + overrideKeys.length > maxRawPathsPerLayer) {
      return { entries: [], truncated: true, collision: false, invalid: false };
    }

    const visibleInLayer = new Map();
    const considerPath = (descriptorValue) => {
      const packPath = normalizeCandidatePath(descriptorValue);
      if (!packPath || !pattern.test(packPath)) return null;
      const folded = packPath.toLowerCase();
      if (claimedFoldedPaths.has(folded)) return null;
      const previous = visibleInLayer.get(folded);
      if (previous && previous !== packPath) return 'collision';
      if (!previous) visibleInLayer.set(folded, packPath);
      return null;
    };
    for (let rawIndex = 0; rawIndex < packPathCount; rawIndex += 1) {
      let descriptorValue;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(packPaths, String(rawIndex));
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          return { entries: [], truncated: false, collision: false, invalid: true };
        }
        descriptorValue = descriptor.value;
      } catch {
        return { entries: [], truncated: false, collision: false, invalid: true };
      }
      if (considerPath(descriptorValue) === 'collision') {
        return { entries: [], truncated: false, collision: true, invalid: false };
      }
    }
    for (const overridePath of overrideKeys) {
      if (considerPath(overridePath) === 'collision') {
        return { entries: [], truncated: false, collision: true, invalid: false };
      }
    }

    const visiblePaths = [...visibleInLayer.values()].sort();
    if (entries.length + visiblePaths.length > maximum) {
      return { entries: [], truncated: true, collision: false, invalid: false };
    }
    for (const packPath of visiblePaths) {
      claimedFoldedPaths.add(packPath.toLowerCase());
      entries.push(Object.freeze({ source, runtime, packPath }));
    }
  }
  return { entries: Object.freeze(entries), truncated: false, collision: false, invalid: false };
}

/**
 * Select candidates by resource-pack priority. Cross-layer duplicates are
 * normal overrides; ambiguity exists only among matches in the first layer
 * that supplies the requested identifier.
 *
 * @param {Array<{source:string}>} candidates
 * @param {string[]} sourceOrder Highest priority first.
 * @returns {{status:'found', candidates:any[], source:string}|{status:'missing'}|{status:'invalid'}}
 */
export function selectNativePreviewCandidateLayer(candidates, sourceOrder) {
  if (!Array.isArray(candidates) || !Array.isArray(sourceOrder)
    || candidates.length > DEFAULT_MAX_VISIBLE_PATHS
    || sourceOrder.length > 64) {
    return { status: 'invalid' };
  }
  const ranks = new Map();
  for (let index = 0; index < sourceOrder.length; index += 1) {
    const source = sourceOrder[index];
    if (typeof source !== 'string' || !source || ranks.has(source)) return { status: 'invalid' };
    ranks.set(source, index);
  }
  let selectedRank = Number.POSITIVE_INFINITY;
  let selectedSource = '';
  const selected = [];
  for (const candidate of candidates) {
    const source = typeof candidate?.source === 'string' ? candidate.source : '';
    const rank = ranks.get(source);
    if (rank === undefined) return { status: 'invalid' };
    if (rank > selectedRank) continue;
    if (rank < selectedRank) {
      selectedRank = rank;
      selectedSource = source;
      selected.length = 0;
    }
    selected.push(candidate);
  }
  return selected.length
    ? { status: 'found', candidates: selected, source: selectedSource }
    : { status: 'missing' };
}

/**
 * Inspect every visible definition of a versioned identifier, then apply the
 * client-entity version rule before resource-pack priority. Exact-path pack
 * overrides have already been removed by composeNativePreviewPackPaths(); for
 * the remaining distinct files Bedrock selects the closest
 * min_engine_version that does not exceed the top pack's engine line. Pack
 * priority is only the tie-break when that version occurs in multiple layers.
 *
 * @template TEntry
 * @template {{minEngineVersion:unknown}} TCandidate
 * @param {TEntry[]} entries
 * @param {string[]} sourceOrder Highest priority first.
 * @param {unknown} targetEngineVersion
 * @param {(entry:TEntry) => Promise<{status:'missing'}|{status:'candidate',candidate:TCandidate}>} inspect
 * @returns {Promise<
 *   {status:'found',source:string,minEngineVersion:readonly number[],candidates:readonly TCandidate[]}
 *   |{status:'missing'}
 *   |{status:'incompatible'}
 *   |{status:'invalid',reason:'input'|'protocol'|'candidate-version',candidate?:TCandidate}
 * >}
 */
export async function inspectBestNativePreviewVersionLayer(
  entries,
  sourceOrder,
  targetEngineVersion,
  inspect,
) {
  const target = parseEngineVersion(targetEngineVersion);
  if (!Array.isArray(entries) || !Array.isArray(sourceOrder) || typeof inspect !== 'function'
    || !target || entries.length > DEFAULT_MAX_VISIBLE_PATHS || sourceOrder.length > 64) {
    return { status: 'invalid', reason: 'input' };
  }
  const entriesBySource = new Map();
  for (const source of sourceOrder) {
    if (typeof source !== 'string' || !source || entriesBySource.has(source)) {
      return { status: 'invalid', reason: 'input' };
    }
    entriesBySource.set(source, []);
  }
  for (const entry of entries) {
    const source = typeof entry?.source === 'string' ? entry.source : '';
    const layer = entriesBySource.get(source);
    if (!layer) return { status: 'invalid', reason: 'input' };
    layer.push(entry);
  }

  let bestVersion = null;
  let bestSource = '';
  let bestSourceRank = Number.POSITIVE_INFINITY;
  let bestCandidates = [];
  let sawFutureCandidate = false;
  for (let sourceRank = 0; sourceRank < sourceOrder.length; sourceRank += 1) {
    const source = sourceOrder[sourceRank];
    for (const entry of entriesBySource.get(source)) {
      const result = await inspect(entry);
      if (result?.status === 'missing') continue;
      if (result?.status !== 'candidate'
        || !Object.prototype.hasOwnProperty.call(result, 'candidate')) {
        return { status: 'invalid', reason: 'protocol' };
      }
      const candidate = result.candidate;
      const candidateVersion = parseEngineVersion(candidate?.minEngineVersion);
      if (!candidateVersion) {
        return { status: 'invalid', reason: 'candidate-version', candidate };
      }
      if (compareEngineVersions(candidateVersion, target) > 0) {
        sawFutureCandidate = true;
        continue;
      }
      const versionOrder = bestVersion
        ? compareEngineVersions(candidateVersion, bestVersion)
        : 1;
      if (versionOrder > 0 || (versionOrder === 0 && sourceRank < bestSourceRank)) {
        bestVersion = candidateVersion;
        bestSource = source;
        bestSourceRank = sourceRank;
        bestCandidates = [candidate];
      } else if (versionOrder === 0 && sourceRank === bestSourceRank) {
        bestCandidates.push(candidate);
      }
    }
  }
  if (bestCandidates.length) {
    return {
      status: 'found',
      source: bestSource,
      minEngineVersion: bestVersion,
      candidates: Object.freeze(bestCandidates),
    };
  }
  return sawFutureCandidate ? { status: 'incompatible' } : { status: 'missing' };
}

/**
 * Inspect identifier-bearing documents one resource-pack layer at a time.
 * Once a layer supplies the identifier, lower layers are not read: a valid
 * upper override cannot be poisoned by an unsupported lower definition, and
 * an unsupported upper definition cannot silently fall through to Vanilla.
 * Every entry in the winning layer is still inspected so same-layer duplicate
 * identifiers remain detectable by the caller.
 *
 * @template TEntry
 * @template TCandidate
 * @param {TEntry[]} entries
 * @param {string[]} sourceOrder Highest priority first.
 * @param {(entry:TEntry) => Promise<{status:'missing'}|{status:'candidate',candidate:TCandidate}>} inspect
 * @returns {Promise<{status:'found',source:string,candidates:readonly TCandidate[]}|{status:'missing'}|{status:'invalid'}>}
 */
export async function inspectFirstNativePreviewCandidateLayer(entries, sourceOrder, inspect) {
  if (!Array.isArray(entries) || !Array.isArray(sourceOrder) || typeof inspect !== 'function'
    || entries.length > DEFAULT_MAX_VISIBLE_PATHS || sourceOrder.length > 64) {
    return { status: 'invalid' };
  }
  const entriesBySource = new Map();
  for (const source of sourceOrder) {
    if (typeof source !== 'string' || !source || entriesBySource.has(source)) {
      return { status: 'invalid' };
    }
    entriesBySource.set(source, []);
  }
  for (const entry of entries) {
    const source = typeof entry?.source === 'string' ? entry.source : '';
    const layer = entriesBySource.get(source);
    if (!layer) return { status: 'invalid' };
    layer.push(entry);
  }

  for (const source of sourceOrder) {
    const candidates = [];
    for (const entry of entriesBySource.get(source)) {
      const result = await inspect(entry);
      if (result?.status === 'missing') continue;
      if (result?.status !== 'candidate'
        || !Object.prototype.hasOwnProperty.call(result, 'candidate')) {
        return { status: 'invalid' };
      }
      candidates.push(result.candidate);
    }
    if (candidates.length > 0) {
      return {
        status: 'found',
        source,
        candidates: Object.freeze(candidates),
      };
    }
  }
  return { status: 'missing' };
}
