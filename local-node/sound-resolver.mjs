import { createHash } from 'node:crypto';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { fail } from './limits.mjs';
import { AUDIO_LIMITS, preflightOggVorbis } from './audio-preflight.mjs';
import { preflightWavPcm16 } from './wav-preflight40.mjs';

const DEFINITIONS_PATH = 'sounds/sound_definitions.json';
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
export function normalizeSoundPath(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\\\x00-\x1f\x7f:?#%]/u.test(value) || value.startsWith('/')) fail('AUDIO_PATH_UNSAFE');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>"|*]/u.test(part) || /[. ]$/u.test(part))) fail('AUDIO_PATH_UNSAFE');
  const extension = parts.at(-1).match(/\.([^.]*)$/u)?.[1];
  if (extension && !['ogg', 'wav'].includes(extension.toLowerCase())) fail('AUDIO_FORMAT_UNSUPPORTED', 415);
  return value + (extension ? '' : '.ogg');
}
function number(value, fallback, code, minimum, maximum) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < minimum || n > maximum) fail(code);
  return n;
}
export function selectSoundCandidate(definition, seed = '') {
  if (!object(definition) || !Array.isArray(definition.sounds) || !definition.sounds.length || definition.sounds.length > AUDIO_LIMITS.candidates) fail('AUDIO_DEFINITION_INVALID');
  if (definition.volume !== undefined || definition.pitch !== undefined) fail('AUDIO_DEFINITION_PROPERTY_UNSUPPORTED', 415);
  const choices = definition.sounds.map((raw, index) => {
    const row = typeof raw === 'string' ? { name: raw } : raw;
    if (!object(row)) fail('AUDIO_CANDIDATE_INVALID');
    if (row.stream !== undefined && row.stream !== false) fail('AUDIO_STREAM_UNSUPPORTED', 415);
    if (row.type !== undefined && row.type !== 'file') fail('AUDIO_CANDIDATE_TYPE_UNSUPPORTED', 415);
    if (row.is3D !== undefined && typeof row.is3D !== 'boolean') fail('AUDIO_CANDIDATE_INVALID');
    const path = normalizeSoundPath(row.name), weight = number(row.weight, 1, 'AUDIO_WEIGHT_INVALID', 1, 1000000);
    if (!Number.isSafeInteger(weight)) fail('AUDIO_WEIGHT_INVALID');
    return { index, path, formatExplicit: /\.[^.]+$/u.test(row.name.split('/').at(-1)), weight,
      volume: number(row.volume, 1, 'AUDIO_VOLUME_INVALID', 0, Number.MAX_VALUE), pitch: number(row.pitch, 1, 'AUDIO_PITCH_UNSUPPORTED', 0.5, 2),
      is3D: row.is3D ?? null };
  });
  // Stable weighted choice. This is the documented preview policy, not Bedrock RNG parity.
  const digest = createHash('sha256').update(String(seed)).digest(), unit = digest.readUInt32BE(0) / 0x100000000;
  let point = unit * choices.reduce((sum, row) => sum + row.weight, 0), selected = choices.at(-1);
  for (const row of choices) { point -= row.weight; if (point < 0) { selected = row; break; } }
  return { ...selected, candidateCount: choices.length, selectionPolicy: 'sha256-weighted-v1' };
}
function indexPaths(paths) {
  const exact = new Set(paths), lower = new Map();
  for (const path of exact) { const key = path.normalize('NFC').toLowerCase(); if (!lower.has(key)) lower.set(key, []); lower.get(key).push(path); }
  return { exact, lower };
}
function match(index, wanted) {
  if (index.exact.has(wanted)) return wanted;
  const rows = index.lower.get(wanted.normalize('NFC').toLowerCase()) || [];
  if (rows.length > 1) fail('AUDIO_PATH_AMBIGUOUS');
  return rows[0] || null;
}

function candidateFile(index, candidate) {
  const stem = candidate.path.slice(0, -4);
  if (candidate.formatExplicit) {
    const exactFormat = match(index, candidate.path);
    if (exactFormat) return exactFormat;
    // A higher owning layer is never bypassed just because it uses another format.
    if (['.ogg', '.wav'].some(extension => match(index, stem + extension))) fail('AUDIO_FORMAT_MISMATCH', 415);
  } else {
    const supported = ['.ogg', '.wav'].map(extension => match(index, stem + extension)).filter(Boolean);
    if (supported.length > 1) fail('AUDIO_FORMAT_AMBIGUOUS', 415);
    if (supported.length === 1) return supported[0];
  }
  if (['.fsb', '.opus', '.mp3'].some(extension => match(index, stem + extension))) fail('AUDIO_FORMAT_UNSUPPORTED', 415);
  return null;
}

/** A resolver belongs to one catalog generation. No RP data crosses to the browser. */
export function createSoundResolver(sources, lookupPack) {
  let layersPromise = null;
  const preflights = new Map();
  async function layers() {
    if (!layersPromise) layersPromise = (async () => {
      const rows = [];
      for (const source of [...sources].sort((a, b) => (a.kind === 'imported' ? 0 : 1) - (b.kind === 'imported' ? 0 : 1))) {
        const pack = lookupPack(source.id), overrides = source.overrides || {};
        const files = indexPaths(pack.packPaths), texts = indexPaths([...pack.packPaths, ...Object.keys(overrides)]);
        rows.push({ source, pack, files, texts, overrides, definitionPath: null, definitionsPromise: null });
      }
      return rows;
    })();
    return layersPromise;
  }
  function definitionsFor(layer) {
    if (!layer.definitionsPromise) layer.definitionsPromise = (async () => {
      // Lower definitions have no authority once a higher layer owns the requested ID.
      // Defer both path matching and parsing so an unrelated lower error cannot veto it.
      const path = match(layer.texts, DEFINITIONS_PATH); layer.definitionPath = path;
      if (!path) return null;
      const text = Object.hasOwn(layer.overrides, path) ? layer.overrides[path] : await layer.pack.zipReader.readText(layer.pack.rootPrefix + path, { maxBytes: AUDIO_LIMITS.definitionBytes });
      if (Buffer.byteLength(text) > AUDIO_LIMITS.definitionBytes) fail('AUDIO_DEFINITION_BUDGET', 413);
      const parsed = parseJsonc(text);
      if (!parsed.ok || !object(parsed.value)) fail('AUDIO_DEFINITION_INVALID');
      const definitions = Object.hasOwn(parsed.value, 'sound_definitions') ? parsed.value.sound_definitions : parsed.value;
      if (!object(definitions) || Object.keys(definitions).length > AUDIO_LIMITS.definitions) fail('AUDIO_DEFINITION_INVALID');
      return definitions;
    })();
    return layer.definitionsPromise;
  }
  return { async resolve({ soundId, selectionSeed = '', contextSampleRate = 48000 }) {
    if (typeof soundId !== 'string' || !soundId.trim() || soundId.length > 256 || /[\x00-\x1f\x7f$#]/u.test(soundId)) fail('AUDIO_SOUND_NAME_INVALID');
    if (typeof selectionSeed !== 'string' || selectionSeed.length > 256) fail('AUDIO_SELECTION_INVALID');
    if (!Number.isInteger(contextSampleRate) || contextSampleRate < 8000 || contextSampleRate > 192000) fail('AUDIO_SAMPLE_RATE_INVALID');
    const ordered = await layers(); let definitionLayer = null, definition = null;
    for (const layer of ordered) {
      const definitions = await definitionsFor(layer);
      if (definitions && Object.hasOwn(definitions, soundId)) { definitionLayer = layer; definition = definitions[soundId]; break; }
    }
    if (!definitionLayer) fail('AUDIO_DEFINITION_MISSING', 404);
    const candidate = selectSoundCandidate(definition, soundId + ':' + selectionSeed);
    const warnings = candidate.candidateCount > 1 ? ['AUDIO_PREVIEW_WEIGHTED_SELECTION'] : [];
    // Browser preview has its own gain control, not the game's category
    // sliders or listener position. Preserve these distinctions even when
    // the selected bytes can be decoded successfully.
    if (definition.category !== undefined) warnings.push('AUDIO_PREVIEW_CATEGORY_MIXER_NOT_APPLIED');
    if (candidate.is3D === true || definition.min_distance !== undefined || definition.max_distance !== undefined) {
      warnings.push('AUDIO_PREVIEW_POSITIONAL_NOT_APPLIED');
    }
    for (const layer of ordered) {
      const filePath = candidateFile(layer.files, candidate);
      if (!filePath) continue;
      const readPath = layer.pack.rootPrefix + filePath;
      if (!layer.pack.zipReader.entryIndex.has(readPath)) fail('AUDIO_FILE_MISSING', 404);
      const cacheKey = layer.source.id + ':' + filePath + ':' + contextSampleRate;
      let inspected = preflights.get(cacheKey);
      if (!inspected) {
        const bytes = await layer.pack.zipReader.bytes(readPath, AUDIO_LIMITS.encodedBytes);
        const metadata = filePath.toLowerCase().endsWith('.wav') ? preflightWavPcm16(bytes, { contextSampleRate })
          : { container: 'ogg', ...preflightOggVorbis(bytes, { contextSampleRate }) };
        inspected = { ...metadata, contentRevision: createHash('sha256').update(bytes).digest('hex') };
        while (preflights.size >= 128) preflights.delete(preflights.keys().next().value);
        preflights.set(cacheKey, inspected);
      }
      return { schema: 'jsonui-sound-v2', soundId, definitionPackId: definitionLayer.source.id, definitionSource: definitionLayer.source.kind,
        definitionPath: definitionLayer.definitionPath, filePackId: layer.source.id, fileSource: layer.source.kind,
        filePath, readPath, ...inspected, candidateVolume: candidate.volume, candidatePitch: candidate.pitch,
        candidateIndex: candidate.index, candidateCount: candidate.candidateCount, selectionPolicy: candidate.selectionPolicy,
        formatSelectionPolicy: candidate.formatExplicit ? 'explicit-owning-layer-v1' : 'unique-format-owning-layer-v1',
        definitionCategory: typeof definition.category === 'string' ? definition.category.slice(0, 64) : null,
        candidateIs3D: candidate.is3D, spatialAudioMode: 'nonpositional_preview',
        gameMixerVerified: false, audibleVerified: false, nativeVerified: false,
        warnings, processing: 'node-worker' };
    }
    fail('AUDIO_FILE_MISSING', 404);
  } };
}
