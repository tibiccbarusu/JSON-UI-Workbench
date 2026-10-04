/*
  native-renderer-preview.js

  Bounded, deterministic preview surrogates for native Bedrock renderers.

  Native renderers normally need live game state and cannot be reproduced by
  a standalone JSON UI preview. Static inventory inputs can be resolved with
  an explicitly versioned raw-ID profile and the loaded resource-pack atlas.
  The current profile keeps signed block IDs; the old five-item map remains
  an explicit compatibility option. Imported definitions and sprite assets
  are preferred. Model material/UV sheets are never treated as item sprites.
  Unknown numeric IDs are never guessed from atlas order, and sprite preview
  success is not evidence of native Minecraft pixel parity.
*/

import { normalizeItemIconIdentifier } from './item-icon-index.js';
import { getVanillaItemIconAlias } from './vanilla-item-icon-aliases.js';
import { DEFAULT_ITEM_ID_PROFILE, LEGACY_ITEM_ID_PROFILE, ITEM_ID_PROFILES,
  lookupCurrentNativeItemIdentifier, isUnstableNativeItemId } from './native-item-id-profile.js';
import { parseJsonc } from '../json/jsonc.js';
import { normalizePackPath } from '../path/normalize-pack-path.js';

const INVENTORY_ITEM_TEXTURES_BY_LEGACY_ID = new Map([
  [742, Object.freeze({ atlasKey: 'netherite_ingot', fallbackRef: 'textures/items/netherite_ingot' })],
  [388, Object.freeze({ atlasKey: 'emerald', fallbackRef: 'textures/items/emerald' })],
  [264, Object.freeze({ atlasKey: 'diamond', fallbackRef: 'textures/items/diamond' })],
  [266, Object.freeze({ atlasKey: 'gold_ingot', fallbackRef: 'textures/items/gold_ingot' })],
  [265, Object.freeze({ atlasKey: 'iron_ingot', fallbackRef: 'textures/items/iron_ingot' })],
]);
const CURRENT_REPRESENTATIVE_TEXTURES = new Map([
  [624, INVENTORY_ITEM_TEXTURES_BY_LEGACY_ID.get(742)],
  [523, INVENTORY_ITEM_TEXTURES_BY_LEGACY_ID.get(388)],
  [306, INVENTORY_ITEM_TEXTURES_BY_LEGACY_ID.get(264)],
  [308, INVENTORY_ITEM_TEXTURES_BY_LEGACY_ID.get(266)],
  [307, INVENTORY_ITEM_TEXTURES_BY_LEGACY_ID.get(265)],
]);

function readItemIdProfile(props, context) {
  const explicit = readOwnDataProperty(props, '__jsonui_preview_item_id_profile');
  const configured = readOwnDataProperty(context, 'itemIdProfile');
  if (!explicit.valid || !configured.valid) return null;
  const profile = explicit.present ? explicit.value : configured.present ? configured.value : DEFAULT_ITEM_ID_PROFILE;
  return ITEM_ID_PROFILES.includes(profile) ? profile : null;
}

function itemNeedsNativeModel(identifier, rawId) {
  return rawId < 0 || rawId > 0 && rawId < 256
    || /(?:^minecraft:shield$|_(?:skull|head)$)/u.test(identifier);
}

const UINT32_MAX = 0xffff_ffff;
const INT32_MIN = -0x8000_0000;
const UINT16_MASK = 0xffff;

export const ITEM_TEXTURE_ATLAS_PACK_PATH = 'textures/item_texture.json';
export const ITEM_TEXTURE_ATLAS_MAX_TEXT_BYTES = 512 * 1024;
export const ITEM_TEXTURE_ATLAS_MAX_ENTRIES = 4096;
export const ITEM_TEXTURE_ATLAS_MAX_TEXTURES_PER_ENTRY = 256;
export const ITEM_TEXTURE_ATLAS_MAX_TOTAL_TEXTURE_REFS = 8192;
export const ITEM_TEXTURE_ATLAS_MAX_PATH_LENGTH = 512;
export const ITEM_TEXTURE_ATLAS_MAX_KEY_LENGTH = 256;
export const ITEM_TEXTURE_ATLAS_MAX_EXPORT_BYTES = 512 * 1024;
const MAX_NATIVE_RENDERER_MERGED_PROPERTIES = 2048;

/**
 * Reserve an atomic multi-layer native texture set without allowing it to
 * consume the entire shared LRU. One extra layer-equivalent is retained as
 * headroom for the rest of the active UI.
 */
export function computeNativeTextureSetLayerLimit(layerCount, cacheLimits = {}) {
  const count = Number(layerCount);
  const total = Number(cacheLimits?.maxDecodedBytesTotal);
  const perImage = Number(cacheLimits?.perImageMaxDecodedBytes);
  if (!Number.isSafeInteger(count) || count < 1 || count > 4
    || !Number.isSafeInteger(total) || total < 1
    || !Number.isSafeInteger(perImage) || perImage < 1) return 0;
  return Math.max(0, Math.min(perImage, Math.floor(total / (count + 1))));
}

// Atlas internals stay private so callers cannot forge a trusted index with a
// look-alike object or mutate the parsed entries after validation.
const atlasEntriesByHandle = new WeakMap();
const atlasMetadataByHandle = new WeakMap();

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function readOwnDataProperty(record, key) {
  if (!isPlainRecord(record)) return { present: false, valid: false, value: undefined };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return { present: false, valid: true, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return { present: true, valid: false, value: undefined };
    }
    return { present: true, valid: true, value: descriptor.value };
  } catch {
    return { present: false, valid: false, value: undefined };
  }
}

function ownDataEntries(record, maxEntries) {
  if (!isPlainRecord(record)) return null;
  try {
    const keys = Reflect.ownKeys(record);
    if (keys.length > maxEntries || keys.some((key) => typeof key !== 'string')) return null;
    const out = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      out.push([key, descriptor.value]);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Merge native-renderer properties without invoking getters. This is kept
 * separate from ordinary image-property composition because native helpers
 * intentionally accept untrusted object-shaped input in tests and tooling.
 *
 * @param {...unknown} sources
 * @returns {Record<string, unknown>|null}
 */
export function mergeNativeRendererProps(...sources) {
  const out = Object.create(null);
  let count = 0;
  for (const source of sources) {
    if (source === null || source === undefined) continue;
    const entries = ownDataEntries(source, MAX_NATIVE_RENDERER_MERGED_PROPERTIES);
    if (!entries || count + entries.length > MAX_NATIVE_RENDERER_MERGED_PROPERTIES) return null;
    for (const [key, value] of entries) {
      Object.defineProperty(out, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    count += entries.length;
  }
  return out;
}

function normalizeAtlasTextureRef(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > ITEM_TEXTURE_ATLAS_MAX_PATH_LENGTH) return null;
  try {
    const normalized = normalizePackPath(trimmed);
    return normalized.length <= ITEM_TEXTURE_ATLAS_MAX_PATH_LENGTH ? normalized : null;
  } catch {
    return null;
  }
}

function normalizeAtlasKey(value) {
  if (typeof value !== 'string') return null;
  if (
    value.length < 1
    || value.length > ITEM_TEXTURE_ATLAS_MAX_KEY_LENGTH
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) return null;
  return value;
}

function readAtlasTextureList(value) {
  const single = normalizeAtlasTextureRef(value);
  if (single) return Object.freeze({ kind: 'single', refs: Object.freeze([single]) });
  if (!Array.isArray(value)) return null;
  try {
    if (
      value.length < 1
      || value.length > ITEM_TEXTURE_ATLAS_MAX_TEXTURES_PER_ENTRY
      || Reflect.ownKeys(value).some((key) => {
        if (typeof key !== 'string') return true;
        return key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key);
      })
    ) return null;
    const out = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      const textureRef = normalizeAtlasTextureRef(descriptor.value);
      if (!textureRef) return null;
      out.push(textureRef);
    }
    return Object.freeze({ kind: 'variants', refs: Object.freeze(out) });
  } catch {
    return null;
  }
}

/**
 * Validate an already-parsed `textures/item_texture.json` value and build an
 * opaque, immutable lookup handle. Every valid entry is retained within
 * aggregate budgets so custom/namespaced keys are not silently discarded.
 *
 * @param {unknown} value
 * @param {{ maxEntries?: number }} [options]
 * @returns {{ ok: true, atlas: object, entryCount: number, recognizedEntryCount: number } | { ok: false, error: string }}
 */
export function indexItemTextureAtlas(value, options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries)
    ? Math.max(1, Math.min(ITEM_TEXTURE_ATLAS_MAX_ENTRIES, Number(options.maxEntries)))
    : ITEM_TEXTURE_ATLAS_MAX_ENTRIES;
  const rootEntries = ownDataEntries(value, 64);
  if (!rootEntries) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_ROOT_INVALID' };
  const root = new Map(rootEntries);
  if (!root.has('texture_data')) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_TEXTURE_DATA_MISSING' };

  const textureDataEntries = ownDataEntries(root.get('texture_data'), maxEntries);
  if (!textureDataEntries) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_TEXTURE_DATA_INVALID_OR_TOO_LARGE' };

  const lowerKeys = new Set();
  const retained = new Map();
  let totalTextureRefs = 0;
  for (const [rawKey, entryValue] of textureDataEntries) {
    const key = normalizeAtlasKey(rawKey);
    if (!key) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_KEY_INVALID' };
    const lower = key.toLowerCase();
    if (lowerKeys.has(lower)) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_KEY_AMBIGUOUS' };
    lowerKeys.add(lower);
    const entryFields = ownDataEntries(entryValue, 16);
    if (!entryFields) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_ENTRY_INVALID' };
    const entry = new Map(entryFields);
    if (!entry.has('textures')) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_TEXTURES_MISSING' };
    const textures = readAtlasTextureList(entry.get('textures'));
    if (!textures) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_TEXTURES_INVALID' };
    totalTextureRefs += textures.refs.length;
    if (totalTextureRefs > ITEM_TEXTURE_ATLAS_MAX_TOTAL_TEXTURE_REFS) {
      return { ok: false, error: 'ITEM_TEXTURE_ATLAS_TOTAL_TEXTURE_REFS_TOO_LARGE' };
    }
    retained.set(key, textures);
  }

  const atlas = Object.freeze(Object.create(null));
  atlasEntriesByHandle.set(atlas, retained);
  const resourcePackName = root.get('resource_pack_name');
  const textureName = root.get('texture_name');
  atlasMetadataByHandle.set(atlas, Object.freeze({
    resourcePackName: typeof resourcePackName === 'string' && resourcePackName.length <= 256
      ? resourcePackName
      : null,
    textureName: typeof textureName === 'string' && textureName.length <= 128
      ? textureName
      : null,
  }));
  return {
    ok: true,
    atlas,
    entryCount: textureDataEntries.length,
    recognizedEntryCount: retained.size,
  };
}

/** 確認済みアトラスの候補だけをUIへ渡す。内部Map/画像参照は公開しない。 */
export function listItemTextureAtlasEntries(atlas, options = {}) {
  const entries = atlas && typeof atlas === 'object' ? atlasEntriesByHandle.get(atlas) : null;
  if (!entries) return [];
  const limit = Number.isInteger(options.limit) ? Math.max(0, Math.min(ITEM_TEXTURE_ATLAS_MAX_ENTRIES, options.limit)) : ITEM_TEXTURE_ATLAS_MAX_ENTRIES;
  const result = [];
  for (const [atlasKey, value] of entries) {
    if (result.length >= limit) break;
    result.push(Object.freeze({ atlasKey, label: atlasKey, variant: 0, variantCount: value.refs.length }));
  }
  return Object.freeze(result);
}

/**
 * Build a minimal, valid item atlas containing only the imported keys required
 * by the exported native UI controls. Bedrock resource packs routinely define
 * sparse item atlases; retaining every variation of each selected entry avoids
 * creating dangling references while excluding unrelated pack content.
 *
 * @param {unknown} atlas Opaque handle returned by index/parseItemTextureAtlas.
 * @param {string[]} retainedKeys
 * @param {{ fallbackResourcePackName?: string }} [options]
 * @returns {{ ok: true, value: Record<string, any>, textureRefs: string[] } | { ok: false, error: string }}
 */
export function buildPrunedItemTextureAtlasForExport(atlas, retainedKeys, options = {}) {
  const entries = atlas && typeof atlas === 'object' ? atlasEntriesByHandle.get(atlas) : null;
  const metadata = atlas && typeof atlas === 'object' ? atlasMetadataByHandle.get(atlas) : null;
  if (!entries || !metadata) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_INVALID' };

  if (!Array.isArray(retainedKeys)
    || retainedKeys.length < 1
    || retainedKeys.length > ITEM_TEXTURE_ATLAS_MAX_ENTRIES) {
    return { ok: false, error: 'ITEM_TEXTURE_ATLAS_EXPORT_KEYS_INVALID' };
  }
  const uniqueKeys = new Set();
  for (let index = 0; index < retainedKeys.length; index += 1) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(retainedKeys, String(index));
    } catch {
      return { ok: false, error: 'ITEM_TEXTURE_ATLAS_EXPORT_KEYS_INVALID' };
    }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return { ok: false, error: 'ITEM_TEXTURE_ATLAS_EXPORT_KEYS_INVALID' };
    }
    const key = normalizeAtlasKey(descriptor.value);
    if (!key) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_EXPORT_KEYS_INVALID' };
    uniqueKeys.add(key);
  }
  const keys = [...uniqueKeys].sort();
  if (keys.length < 1 || keys.length > ITEM_TEXTURE_ATLAS_MAX_ENTRIES) {
    return { ok: false, error: 'ITEM_TEXTURE_ATLAS_EXPORT_KEYS_INVALID' };
  }

  const textureData = Object.create(null);
  const textureRefs = [];
  for (const key of keys) {
    const entry = entries.get(key);
    if (!entry || !Array.isArray(entry.refs) || entry.refs.length < 1) {
      return { ok: false, error: 'ITEM_TEXTURE_ATLAS_EXPORT_ENTRY_MISSING' };
    }
    const refs = [...entry.refs];
    textureData[key] = Object.freeze({
      textures: entry.kind === 'single' ? refs[0] : Object.freeze(refs),
    });
    textureRefs.push(...refs);
  }

  const fallbackName = typeof options.fallbackResourcePackName === 'string'
    ? options.fallbackResourcePackName.trim().slice(0, 256)
    : '';
  const value = Object.create(null);
  value.resource_pack_name = metadata.resourcePackName || fallbackName || 'JSONUI Export';
  value.texture_name = metadata.textureName || 'atlas.items';
  value.texture_data = textureData;
  let serializedBytes;
  try {
    serializedBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return { ok: false, error: 'ITEM_TEXTURE_ATLAS_EXPORT_SERIALIZE_FAILED' };
  }
  if (!Number.isSafeInteger(serializedBytes) || serializedBytes > ITEM_TEXTURE_ATLAS_MAX_EXPORT_BYTES) {
    return { ok: false, error: 'ITEM_TEXTURE_ATLAS_EXPORT_TOO_LARGE' };
  }
  return {
    ok: true,
    value,
    textureRefs: [...new Set(textureRefs)],
  };
}

/**
 * Parse and safely index a bounded JSONC item texture atlas.
 *
 * @param {unknown} text
 * @param {{ maxTextLength?: number, maxEntries?: number }} [options]
 * @returns {{ ok: true, atlas: object, entryCount: number, recognizedEntryCount: number } | { ok: false, error: string }}
 */
export function parseItemTextureAtlas(text, options = {}) {
  if (typeof text !== 'string') return { ok: false, error: 'ITEM_TEXTURE_ATLAS_TEXT_INVALID' };
  const maxTextLength = Number.isInteger(options.maxTextLength)
    ? Math.max(1, Math.min(ITEM_TEXTURE_ATLAS_MAX_TEXT_BYTES, Number(options.maxTextLength)))
    : ITEM_TEXTURE_ATLAS_MAX_TEXT_BYTES;
  // The public limit is bytes, not UTF-16 code units. The cheap code-unit
  // check rejects obvious oversize inputs before allocating an encoder buffer.
  if (text.length > maxTextLength) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_TEXT_TOO_LARGE' };
  let byteLength;
  try {
    byteLength = new TextEncoder().encode(text).byteLength;
  } catch {
    byteLength = text.length * 3;
  }
  if (!Number.isSafeInteger(byteLength) || byteLength > maxTextLength) {
    return { ok: false, error: 'ITEM_TEXTURE_ATLAS_TEXT_TOO_LARGE' };
  }
  const parsed = parseJsonc(text, {
    fileName: ITEM_TEXTURE_ATLAS_PACK_PATH,
    allowTrailingComma: true,
  });
  if (!parsed.ok) return { ok: false, error: 'ITEM_TEXTURE_ATLAS_JSON_INVALID' };
  return indexItemTextureAtlas(parsed.value, options);
}

function readPackedItemIdAux(props) {
  const readLayer = (record) => {
    const candidates = [];
    for (const key of ['#item_id_aux', 'item_id_aux']) {
      const candidate = readOwnDataProperty(record, key);
      if (!candidate.valid) return { status: 'invalid', value: null };
      if (candidate.present) candidates.push(candidate.value);
    }
    if (candidates.length === 0) return { status: 'missing', value: null };
    const packed = candidates[0];
    if (!Number.isSafeInteger(packed) || packed < INT32_MIN || packed > UINT32_MAX) {
      return { status: 'invalid', value: null };
    }
    for (let index = 1; index < candidates.length; index += 1) {
      if (!Object.is(candidates[index], packed)) return { status: 'invalid', value: null };
    }
    // Bedrock JSON UI contains both unsigned packed ids and signed int32 bit
    // patterns. Normalize the latter without reclassifying an unknown item as
    // malformed input.
    return { status: 'found', value: packed < 0 ? packed + 0x1_0000_0000 : packed };
  };

  // Resolved binding values live on the effective control itself. Prefer that
  // direct layer over the authored property_bag default, while still rejecting
  // ambiguity inside either individual layer.
  const direct = readLayer(props);
  if (direct.status === 'invalid') return direct;
  if (direct.status === 'found') return direct;

  const detailsProperty = readOwnDataProperty(props, '__jsonui_preview_collection_details');
  if (!detailsProperty.valid) return { status: 'invalid', value: null };
  if (detailsProperty.present) {
    if (!isPlainRecord(detailsProperty.value)) return { status: 'invalid', value: null };
    const details = readLayer(detailsProperty.value);
    if (details.status === 'invalid') return details;
    if (details.status === 'found') return details;
  }

  const propertyBagProperty = readOwnDataProperty(props, 'property_bag');
  if (!propertyBagProperty.valid) return { status: 'invalid', value: null };
  if (!propertyBagProperty.present) return { status: 'missing', value: null };
  if (!isPlainRecord(propertyBagProperty.value)) return { status: 'invalid', value: null };
  const propertyBag = readLayer(propertyBagProperty.value);
  return propertyBag;
}

// Debug data may identify an exact pack texture or atlas key without guessing
// a version-dependent numeric item id. These are preview inputs, not claims
// about Minecraft's native property schema. A present invalid override must
// remain visible as a diagnostic; it must never display a different item.
function readPreviewItemSelector(props) {
  const keys = ['__jsonui_preview_item_texture', '__jsonui_preview_item_atlas_key', '__jsonui_preview_item_variant'];
  const layers = [props];
  for (const container of ['__jsonui_preview_collection_details', 'property_bag']) {
    const value = readOwnDataProperty(props, container);
    if (!value.valid) return { status: 'invalid' };
    if (value.present) {
      if (!isPlainRecord(value.value)) return { status: 'invalid' };
      layers.push(value.value);
    }
  }
  for (const layer of layers) {
    const values = keys.map((key) => readOwnDataProperty(layer, key));
    if (values.some((value) => !value.valid)) return { status: 'invalid' };
    if (!values.some((value) => value.present)) continue;
    const [texture, atlasKey, variant] = values;
    if (texture.present === atlasKey.present) return { status: 'invalid' };
    const index = variant.present ? variant.value : 0;
    if (!Number.isSafeInteger(index) || index < 0 || index > UINT16_MASK) return { status: 'invalid' };
    if (texture.present) {
      const ref = normalizeAtlasTextureRef(texture.value);
      if (!ref || !ref.startsWith('textures/') || variant.present) return { status: 'invalid' };
      return { status: 'texture', textureRef: ref };
    }
    const key = normalizeAtlasKey(atlasKey.value);
    return key ? { status: 'atlas', atlasKey: key, variant: index } : { status: 'invalid' };
  }
  for (const layer of layers) {
    const value = readOwnDataProperty(layer, '__jsonui_preview_item_id');
    if (!value.valid) return { status: 'invalid' };
    if (!value.present) continue;
    const identifier = normalizeItemIconIdentifier(value.value);
    return identifier ? { status: 'identifier', identifier } : { status: 'invalid' };
  }
  return { status: 'absent' };
}

function readPreviewItemValidity(props) {
  const layers = [props];
  for (const key of ['__jsonui_preview_collection_details', 'property_bag']) {
    const layer = readOwnDataProperty(props, key);
    if (layer.valid && layer.present && isPlainRecord(layer.value)) layers.push(layer.value);
  }
  for (const layer of layers) {
    const flag = readOwnDataProperty(layer, '#item_valid');
    if (!flag.valid) return 'invalid';
    if (flag.present) return typeof flag.value === 'boolean' ? flag.value : 'invalid';
  }
  return true;
}

/**
 * Return a pack-relative texture ref for a safely recognized native renderer.
 * Unknown renderers, item ids, ambiguous values, and hostile object shapes are
 * deliberately left to the geometry-only native-renderer fallback.
 *
 * @param {unknown} props Effective node properties (unknown + resolved props).
 * @returns {{status:string,textureRef:string|null,issue:string|null,source:string|null,empty?:boolean}|null}
 */
export function resolveNativeRendererTexture(props, atlases = {}) {
  if (!isPlainRecord(props)) return null;

  const renderer = readOwnDataProperty(props, 'renderer');
  if (renderer.valid && renderer.value === 'progress_bar_renderer') {
    // このnative rendererは通常の#visibleではなく専用bindingを読む。
    // 明示falseの非描画だけを解釈し、trueや未解決のバーの画素を捏造しない。
    const states = [];
    for (const name of ['touch_progress_bar_visible', 'progress_bar_visible']) {
      let values = [`#${name}`, name].map(key => readOwnDataProperty(props, key));
      if (!values.some(value => value.present)) {
        const bag = readOwnDataProperty(props, 'property_bag');
        if (bag.present && (!bag.valid || !isPlainRecord(bag.value))) {
          return Object.freeze({ status: 'unresolved', textureRef: null, issue: 'NATIVE_PREVIEW_STATE_INVALID', source: 'runtime-visibility' });
        }
        if (bag.present) values = [`#${name}`, name].map(key => readOwnDataProperty(bag.value, key));
      }
      if (values.some(value => !value.valid || value.present && typeof value.value !== 'boolean')) {
        return Object.freeze({ status: 'unresolved', textureRef: null, issue: 'NATIVE_PREVIEW_STATE_INVALID', source: 'runtime-visibility' });
      }
      states.push(...values.filter(value => value.present).map(value => value.value));
    }
    if (states.length && states.every(value => value === false)) {
      return Object.freeze({ status: 'not-applicable', textureRef: null, issue: null, source: 'runtime-visibility', empty: true });
    }
  }
  if (!renderer.valid || !renderer.present || renderer.value !== 'inventory_item_renderer') {
    return Object.freeze({ status: 'not-applicable', textureRef: null, issue: null, source: null });
  }

  const validity = readPreviewItemValidity(props);
  if (validity === false) {
    return Object.freeze({ status: 'not-applicable', textureRef: null, issue: null, source: 'preview-state', empty: true });
  }
  if (validity === 'invalid') {
    return Object.freeze({ status: 'unresolved', textureRef: null, issue: 'NATIVE_PREVIEW_ITEM_STATE_INVALID', source: 'preview-state' });
  }

  const previewSelector = readPreviewItemSelector(props);
  if (previewSelector.status === 'invalid') {
    return Object.freeze({ status: 'unresolved', textureRef: null, issue: 'NATIVE_PREVIEW_ITEM_OVERRIDE_INVALID', source: 'preview-state' });
  }
  if (previewSelector.status === 'texture') {
    return Object.freeze({ status: 'resolved', textureRef: previewSelector.textureRef, textureRefs: Object.freeze([previewSelector.textureRef]),
      issue: null, source: 'preview-state', previewOverride: true });
  }
  if (previewSelector.status === 'identifier') return resolveIdentifierItemIcon(previewSelector.identifier, atlases);
  const packedResult = previewSelector.status === 'atlas'
    ? { status: 'found', value: previewSelector.variant }
    : readPackedItemIdAux(props);
  if (packedResult.status === 'missing') {
    // Modern #item_renderer_data is an opaque engine value. A supplied value
    // does not mean an empty slot; without representative item data it is an
    // unsupported native input and must remain visible in diagnostics.
    for (const layer of [props, readOwnDataProperty(props, '__jsonui_preview_collection_details').value,
      readOwnDataProperty(props, 'property_bag').value]) {
      if (!isPlainRecord(layer)) continue;
      const data = readOwnDataProperty(layer, '#item_renderer_data');
      if (!data.valid || data.present && data.value !== null && data.value !== undefined) {
        return Object.freeze({ status: 'unresolved', textureRef: null,
          issue: 'NATIVE_ITEM_RENDERER_DATA_UNSUPPORTED', source: 'native-runtime' });
      }
    }
    // Empty inventory renderers obtain their item dynamically in-game. The
    // lack of a representative item is not malformed pack data.
    return Object.freeze({ status: 'not-applicable', textureRef: null, issue: null, source: null });
  }
  if (packedResult.status !== 'found') {
    return Object.freeze({ status: 'unresolved', textureRef: null, issue: 'NATIVE_PREVIEW_ITEM_ID_INVALID', source: null });
  }
  const packed = packedResult.value;
  // Signed and unsigned encodings refer to the same signed 16-bit raw ID.
  // Treating the high word as unsigned turned acacia planks (-742) into 64794.
  const legacyId = packed >> 16;
  const aux = packed & UINT16_MASK;
  let item;
  if (previewSelector.status === 'atlas') item = { atlasKey: previewSelector.atlasKey, fallbackRef: null };
  else {
    const profile = readItemIdProfile(props, atlases);
    if (!profile) return Object.freeze({ status: 'unresolved', textureRef: null, issue: 'NATIVE_ITEM_ID_PROFILE_INVALID', source: null });
    if (profile === LEGACY_ITEM_ID_PROFILE) item = INVENTORY_ITEM_TEXTURES_BY_LEGACY_ID.get(legacyId);
    else {
      const identifier = lookupCurrentNativeItemIdentifier(legacyId);
      const metadata = { itemIdProfile: profile, rawItemId: legacyId, auxiliaryData: aux, nativeParityVerified: false };
      if (isUnstableNativeItemId(legacyId)) return Object.freeze({ status: 'unresolved', textureRef: null,
        issue: 'NATIVE_ITEM_ID_RUNTIME_DEPENDENT', source: null, ...metadata });
      if (!identifier) return Object.freeze({ status: 'unresolved', textureRef: null,
        issue: 'NATIVE_PREVIEW_ITEM_ID_UNSUPPORTED', source: null, ...metadata });
      // Auxiliary data is not generally an atlas variation index (it may encode
      // legacy state or damage). Current static profile intentionally covers 0.
      if (aux !== 0) return Object.freeze({ status: 'unresolved', textureRef: null,
        issue: 'NATIVE_ITEM_AUX_DATA_UNSUPPORTED', source: null, itemIdentifier: identifier, ...metadata });
      item = CURRENT_REPRESENTATIVE_TEXTURES.get(legacyId);
      if (!item) {
        const found = resolveIdentifierItemIcon(identifier, atlases);
        const requiresModel = found.status === 'unresolved' && found.issue === 'ITEM_ICON_TEXTURE_MISSING'
          && itemNeedsNativeModel(identifier, legacyId);
        return Object.freeze({ ...found, ...(requiresModel ? { issue: 'NATIVE_ITEM_MODEL_REQUIRED' } : {}), ...metadata });
      }
    }
  }
  if (!item) {
    return Object.freeze({ status: 'unresolved', textureRef: null, issue: 'NATIVE_PREVIEW_ITEM_ID_UNSUPPORTED', source: null });
  }

  const pendingProperty = isPlainRecord(atlases)
    ? readOwnDataProperty(atlases, 'pending')
    : { present: false, valid: true, value: undefined };
  const hasExplicitSourceStatus = isPlainRecord(atlases)
    && ['importedStatus', 'vanillaStatus'].some((key) => readOwnDataProperty(atlases, key).present);
  if (pendingProperty.valid && pendingProperty.present && pendingProperty.value === true && !hasExplicitSourceStatus) {
    return Object.freeze({ status: 'pending', textureRef: null, issue: null, source: null });
  }
  const atlasSources = [];
  if (isPlainRecord(atlases)) {
    for (const prefix of ['imported', 'vanilla']) {
      const atlasProperty = readOwnDataProperty(atlases, `${prefix}Atlas`);
      const statusProperty = readOwnDataProperty(atlases, `${prefix}Status`);
      const issueProperty = readOwnDataProperty(atlases, `${prefix}Issue`);
      if (!atlasProperty.valid || !statusProperty.valid || !issueProperty.valid) {
        return Object.freeze({ status: 'blocked', textureRef: null, issue: 'ITEM_TEXTURE_ATLAS_CONTEXT_INVALID', source: prefix });
      }
      const atlas = atlasProperty.present ? atlasProperty.value : null;
      const status = statusProperty.present
        ? statusProperty.value
        : atlas && atlasEntriesByHandle.has(atlas)
          ? 'ready'
          : 'unavailable';
      atlasSources.push({ source: prefix, atlas, status, issue: issueProperty.present ? issueProperty.value : null });
    }
  }
  let sawReadyAtlas = false;
  let lastReadySource = null;
  for (const { source, atlas, status, issue } of atlasSources) {
    if (status === 'loading') {
      return Object.freeze({ status: 'pending', textureRef: null, issue: null, source });
    }
    if (status === 'error') {
      return Object.freeze({
        status: 'blocked',
        textureRef: null,
        issue: typeof issue === 'string' && issue ? issue : 'ITEM_TEXTURE_ATLAS_INVALID',
        source,
      });
    }
    if (status === 'missing' || status === 'unavailable') continue;
    if (status !== 'ready') {
      return Object.freeze({ status: 'blocked', textureRef: null, issue: 'ITEM_TEXTURE_ATLAS_CONTEXT_INVALID', source });
    }
    sawReadyAtlas = true;
    lastReadySource = source;
    const entries = atlas && typeof atlas === 'object' ? atlasEntriesByHandle.get(atlas) : null;
    if (!entries) {
      return Object.freeze({ status: 'blocked', textureRef: null, issue: 'ITEM_TEXTURE_ATLAS_INVALID', source });
    }
    const textureEntry = entries ? entries.get(item.atlasKey) : null;
    if (!textureEntry) continue;
    // Bedrock texture_data permits a string or a variation array. The packed
    // renderer input carries aux in its low 16 bits. The public documentation
    // does not define an out-of-range fallback, so never guess one.
    const textureRef = textureEntry.kind === 'single'
      ? textureEntry.refs[0]
      : textureEntry.refs[aux] || null;
    return textureRef
      ? Object.freeze({
          status: 'resolved',
          textureRef,
          issue: null,
          source,
          atlasKey: item.atlasKey,
          textureRefs: Object.freeze([...textureEntry.refs]),
        })
      : Object.freeze({ status: 'unresolved', textureRef: null, issue: 'ITEM_TEXTURE_ATLAS_VARIANT_OUT_OF_RANGE', source });
  }
  if (sawReadyAtlas) {
    return Object.freeze({
      status: 'unresolved',
      textureRef: null,
      issue: 'ITEM_TEXTURE_ATLAS_ENTRY_MISSING',
      source: lastReadySource,
      atlasKey: item.atlasKey,
    });
  }
  if (!item.fallbackRef) {
    return Object.freeze({ status: 'unresolved', textureRef: null, issue: 'ITEM_TEXTURE_ATLAS_UNAVAILABLE', source: 'preview-state', atlasKey: item.atlasKey });
  }
  return Object.freeze({
    status: 'resolved',
    textureRef: item.fallbackRef,
    issue: null,
    source: 'fallback',
    atlasKey: item.atlasKey,
    textureRefs: Object.freeze([item.fallbackRef]),
  });
}

// Identifier resolution is distinct from version-dependent numeric legacy IDs.
// Definitions choose an atlas key; texture lookup still uses the normal pack stack.
function resolveIdentifierItemIcon(identifier, atlases) {
  const answer = (status, issue, source = null, more = {}) => Object.freeze({status, textureRef:null, issue, source, itemIdentifier:identifier, ...more});
  if (!isPlainRecord(atlases)) return answer('blocked','ITEM_ICON_CONTEXT_INVALID');
  const sources=[];
  let declaredKey=null;
  let declaredModel=null;
  for(const prefix of ['imported','vanilla']) {
    const state=readOwnDataProperty(atlases,prefix+'ItemsStatus');
    const data=readOwnDataProperty(atlases,prefix+'Items');
    if(!state.valid||!data.valid) return answer('blocked','ITEM_ICON_CONTEXT_INVALID',prefix);
    const status=state.present?state.value:'unavailable';
    if(status==='loading')return answer('pending',null,prefix);
    if(status==='error')return answer('blocked','ITEM_ICON_INDEX_FAILED',prefix);
    if(!['ready','missing','unavailable'].includes(status))return answer('blocked','ITEM_ICON_CONTEXT_INVALID',prefix);
    const index=data.present?data.value:null;
    if(status==='ready'&&!isPlainRecord(index))return answer('blocked','ITEM_ICON_CONTEXT_INVALID',prefix);
    sources.push({prefix,status,index});
    if(status!=='ready')continue;
    const blocked=readOwnDataProperty(index,'blocked'),icons=readOwnDataProperty(index,'icons');
    if(!blocked.valid||!icons.valid||!isPlainRecord(blocked.value)||!isPlainRecord(icons.value))return answer('blocked','ITEM_ICON_CONTEXT_INVALID',prefix);
    const block=readOwnDataProperty(blocked.value,identifier);
    if(!block.valid)return answer('blocked','ITEM_ICON_CONTEXT_INVALID',prefix);
    if(block.present)return answer('blocked','ITEM_ICON_DEFINITION_INVALID',prefix);
    const entry=readOwnDataProperty(icons.value,identifier);
    if(!entry.valid)return answer('blocked','ITEM_ICON_CONTEXT_INVALID',prefix);
    if(entry.present) {
      const key=readOwnDataProperty(entry.value,'atlasKey');
      if(!entry.valid||!key.valid||!normalizeAtlasKey(key.value))return answer('blocked','ITEM_ICON_DEFINITION_INVALID',prefix);
      declaredKey=key.value;
      break;
    }
    const models = readOwnDataProperty(index, 'models');
    if (!models.valid) return answer('blocked', 'ITEM_ICON_CONTEXT_INVALID', prefix);
    if (models.present) {
      if (!isPlainRecord(models.value)) return answer('blocked', 'ITEM_ICON_CONTEXT_INVALID', prefix);
      const model = readOwnDataProperty(models.value, identifier);
      if (!model.valid) return answer('blocked', 'ITEM_ICON_CONTEXT_INVALID', prefix);
      if (model.present) {
        declaredModel = { source: prefix };
        break;
      }
    }
  }
  // A custom block's item_visual describes geometry/materials. Its material
  // image is not a finished inventory icon. A same-ID explicit item icon above
  // may override it, but filename/atlas guesses must never flatten the model.
  if (declaredKey === null && declaredModel) return answer('unresolved', 'NATIVE_ITEM_MODEL_REQUIRED', declaredModel.source);
  const sprite = found => {
    if (declaredKey === null && /^textures\/(?:blocks|entity)\//u.test(found.textureRef || '')) {
      return answer('unresolved', 'NATIVE_ITEM_MODEL_REQUIRED', found.source, { nativeSourceTexture: found.textureRef });
    }
    return Object.freeze({ ...found, itemIdentifier: identifier, automaticItemIcon: true,
      previewFidelity: 'resource-pack-sprite', nativeParityVerified: false });
  };
  const keys=declaredKey!==null?[declaredKey]:identifier.startsWith('minecraft:')?[identifier,identifier.slice(10)]:[identifier];
  for(const prefix of ['imported','vanilla']) {
    const context=Object.create(null);
    for(const suffix of ['Atlas','Status','Issue']) {
      const value=readOwnDataProperty(atlases,prefix+suffix);
      if(!value.valid)return answer('blocked','ITEM_TEXTURE_ATLAS_CONTEXT_INVALID',prefix);
      if(value.present)context[prefix+suffix]=value.value;
    }
    for(const key of keys) {
      const found=resolveNativeRendererTexture({renderer:'inventory_item_renderer',__jsonui_preview_item_atlas_key:key},context);
      if(found.status==='resolved')return sprite(found);
      if(!['ITEM_TEXTURE_ATLAS_ENTRY_MISSING','ITEM_TEXTURE_ATLAS_UNAVAILABLE'].includes(found.issue))return found;
    }
  }
  if(declaredKey!==null)return answer('unresolved','ITEM_TEXTURE_ATLAS_ENTRY_MISSING',null,{atlasKey:declaredKey});
  const alias = getVanillaItemIconAlias(identifier);
  if (alias) {
    const found = resolveNativeRendererTexture({ renderer: 'inventory_item_renderer',
      __jsonui_preview_item_atlas_key: alias.atlasKey, __jsonui_preview_item_variant: alias.variant }, atlases);
    if (found.status === 'resolved') return sprite({ ...found, vanillaCompatibilityAlias: true });
    if (!['ITEM_TEXTURE_ATLAS_ENTRY_MISSING', 'ITEM_TEXTURE_ATLAS_UNAVAILABLE'].includes(found.issue)) return found;
  }
  for(const {prefix,status,index} of sources) {
    if(status!=='ready')continue;
    const table=readOwnDataProperty(index,'directTextures');
    if(!table.valid||!isPlainRecord(table.value))return answer('blocked','ITEM_ICON_CONTEXT_INVALID',prefix);
    const file=readOwnDataProperty(table.value,identifier);
    if(!file.valid)return answer('blocked','ITEM_ICON_CONTEXT_INVALID',prefix);
    if(file.present) {
      const ref=file.valid?normalizeAtlasTextureRef(file.value):null;
      if(!ref||!ref.startsWith('textures/'))return answer('blocked','ITEM_ICON_CONTEXT_INVALID',prefix);
      return answer('resolved',null,prefix,{textureRef:ref,textureRefs:Object.freeze([ref]),automaticItemIcon:true});
    }
  }
  if (alias?.textureRef) {
    const fileId = normalizeItemIconIdentifier(alias.textureRef.slice('textures/items/'.length));
    for (const { prefix, status, index } of sources) {
      if (status !== 'ready' || !fileId) continue;
      const blocked = readOwnDataProperty(index.blocked, fileId);
      const actual = readOwnDataProperty(index.directTextures, fileId);
      if (!blocked.valid || !actual.valid || blocked.present) return answer('blocked', 'ITEM_ICON_CONTEXT_INVALID', prefix);
      if (actual.present && actual.value === alias.textureRef) return answer('resolved', null, prefix, {
        textureRef: alias.textureRef, textureRefs: Object.freeze([alias.textureRef]), automaticItemIcon: true, vanillaCompatibilityAlias: true,
      });
    }
  }
  return answer('unresolved','ITEM_ICON_TEXTURE_MISSING');
}

/** Compatibility wrapper for callers that only need a resolved ref. */
export function getNativeRendererTextureRef(props, atlases = {}) {
  const result = resolveNativeRendererTexture(props, atlases);
  return result?.status === 'resolved' ? result.textureRef : null;
}

/**
 * Return a bounded geometry placeholder kind for a renderer whose authored
 * pixels require live game data. This is intentionally separate from texture
 * surrogates so unknown renderers remain invisible while retaining layout.
 *
 * @param {unknown} props
 * @returns {'banner-pattern'|'enchanting-book'|'horse-entity'|'player-entity'|null}
 */
export function getNativeRendererPlaceholderKind(props) {
  if (!isPlainRecord(props)) return null;
  const renderer = readOwnDataProperty(props, 'renderer');
  if (!renderer.valid || !renderer.present) return null;
  switch (renderer.value) {
    case 'banner_pattern_renderer': return 'banner-pattern';
    case 'enchanting_book_renderer': return 'enchanting-book';
    case 'live_horse_renderer': return 'horse-entity';
    case 'live_player_renderer': return 'player-entity';
    default: return null;
  }
}

function readBoundedNativeArrayIndex(props, markerName, maxValue) {
  const candidates = [];
  for (const key of [markerName, markerName.replace(/^#/u, '')]) {
    const property = readOwnDataProperty(props, key);
    if (!property.valid) return null;
    if (property.present) candidates.push(property.value);
  }
  if (candidates.length !== 1) return null;
  const list = candidates[0];
  if (!Array.isArray(list) || list.length < 1 || list.length > 64) return null;
  try {
    const ownKeys = Reflect.ownKeys(list);
    if (ownKeys.some((key) => (
      typeof key !== 'string'
      || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key))
    ))) return null;
    const first = Object.getOwnPropertyDescriptor(list, '0');
    if (!first || !Object.prototype.hasOwnProperty.call(first, 'value')) return null;
    const value = first.value;
    return Number.isSafeInteger(value) && value >= 0 && value <= maxValue ? value : null;
  } catch {
    return null;
  }
}

/**
 * Extract the bounded representative state used by the banner surrogate.
 * The returned numbers are runtime inputs, not file paths or executable
 * renderer data. Malformed, duplicate, accessor-backed, or oversized arrays
 * fail closed so arbitrary packs cannot make the preview perform unbounded
 * work.
 *
 * @param {unknown} props
 * @returns {{ patternIndex: number, colorIndex: number }|null}
 */
export function getNativeBannerPreviewState(props) {
  if (!isPlainRecord(props)) return null;
  const renderer = readOwnDataProperty(props, 'renderer');
  if (!renderer.valid || !renderer.present || renderer.value !== 'banner_pattern_renderer') return null;
  const patternIndex = readBoundedNativeArrayIndex(props, '#banner_patterns', 255);
  const colorIndex = readBoundedNativeArrayIndex(props, '#banner_colors', 15);
  if (patternIndex === null || colorIndex === null) return null;
  return Object.freeze({ patternIndex, colorIndex });
}
