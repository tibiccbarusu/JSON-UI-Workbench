import { createHash } from 'node:crypto';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { normalizePackPath } from '../editor-core/src/path/normalize-pack-path.js';
import { buildItemIconIndex, buildBlockItemVisualIndex, normalizeItemIconIdentifier, ITEM_ICON_INDEX_MAX_DEFINITIONS } from '../editor-core/src/preview/item-icon-index.js';

const MAX_DOCUMENT_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const cache = new WeakMap();
const itemPath = path => typeof path === 'string' && /^(?:items|blocks)\/.+\.json$/iu.test(path);
function fail(code) { throw Object.assign(new Error(code), { code, status: 400 }); }
function own(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('ITEM_ICON_OVERRIDE_INVALID');
  return descriptor.value;
}
function checkedPath(path) {
  try { if (normalizePackPath(path) !== path) fail('ITEM_ICON_PATH_INVALID'); }
  catch { fail('ITEM_ICON_PATH_INVALID'); }
  return path;
}
function overridesSnapshot(overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('ITEM_ICON_OVERRIDE_INVALID');
  const prototype = Object.getPrototypeOf(overrides);
  if (prototype !== null && prototype !== Object.prototype) fail('ITEM_ICON_OVERRIDE_INVALID');
  const selected = Object.create(null);
  const hash = createHash('sha256');
  let bytes = 0;
  const paths = Object.keys(overrides).filter(itemPath).sort();
  if (paths.length > ITEM_ICON_INDEX_MAX_DEFINITIONS) fail('ITEM_ICON_DEFINITION_LIMIT');
  for (const path of paths) {
    checkedPath(path);
    const text = own(overrides, path);
    if (typeof text !== 'string') fail('ITEM_ICON_OVERRIDE_INVALID');
    const size = Buffer.byteLength(text);
    if (size > MAX_DOCUMENT_BYTES) fail('ITEM_ICON_DOCUMENT_LIMIT');
    bytes += size;
    if (bytes > MAX_TOTAL_BYTES) fail('ITEM_ICON_TOTAL_LIMIT');
    selected[path] = text;
    hash.update(JSON.stringify([path, text]));
  }
  return { selected, key: hash.digest('hex') };
}

async function build(item, overrides) {
  if (!Array.isArray(item.packPaths)) fail('ITEM_ICON_PATHS_INVALID');
  const definitions = [...new Set([...item.packPaths.filter(itemPath), ...Object.keys(overrides)])].sort();
  if (definitions.length > ITEM_ICON_INDEX_MAX_DEFINITIONS) fail('ITEM_ICON_DEFINITION_LIMIT');
  const lowerPaths = new Set();
  for (const path of definitions) {
    checkedPath(path);
    const lower = path.normalize('NFC').toLowerCase();
    if (lowerPaths.has(lower)) fail('ITEM_ICON_PATH_AMBIGUOUS');
    lowerPaths.add(lower);
  }
  const itemDefinitions = [];
  const blockDefinitions = [];
  let totalBytes = 0;
  for (const path of definitions) {
    let text;
    try {
      text = Object.hasOwn(overrides, path) ? overrides[path]
        : await item.zipReader.readText(item.rootPrefix + path, { maxBytes: MAX_DOCUMENT_BYTES });
    } catch (error) {
      if (String(error?.code || error?.message || '').includes('LIMIT')) fail('ITEM_ICON_DOCUMENT_LIMIT');
      fail('ITEM_ICON_READ_FAILED');
    }
    if (typeof text !== 'string') fail('ITEM_ICON_READ_FAILED');
    const size = Buffer.byteLength(text);
    if (size > MAX_DOCUMENT_BYTES) fail('ITEM_ICON_DOCUMENT_LIMIT');
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) fail('ITEM_ICON_TOTAL_LIMIT');
    const parsed = parseJsonc(text, { fileName: path });
    if (!parsed.ok) fail('ITEM_ICON_PARSE_FAILED');
    (path.toLowerCase().startsWith('blocks/') ? blockDefinitions : itemDefinitions).push({ path, document: parsed.value });
  }
  const result = buildItemIconIndex({ itemDefinitions });
  const blockVisuals = buildBlockItemVisualIndex(blockDefinitions);
  result.models = blockVisuals.models;
  result.diagnostics.push(...blockVisuals.diagnostics);
  result.stats.blockModels = blockDefinitions.length;
  const directTextures = Object.create(null);
  const imagePaths = new Map();
  for (const path of item.packPaths) {
    const match = typeof path === 'string' ? /^(textures\/items\/)([a-z0-9_.-]+)\.(png|tga|jpe?g)$/iu.exec(path) : null;
    if (!match) continue;
    checkedPath(path);
    const identifier = normalizeItemIconIdentifier(match[2].toLowerCase());
    if (!identifier) continue;
    const ref = path.slice(0, -(match[3].length + 1));
    const lower = path.normalize('NFC').toLowerCase();
    const previousPath = imagePaths.get(lower);
    const previousRef = directTextures[identifier];
    imagePaths.set(lower, path);
    if (imagePaths.size > ITEM_ICON_INDEX_MAX_DEFINITIONS) fail('ITEM_ICON_DIRECT_TEXTURE_LIMIT');
    if (previousPath && previousPath !== path || previousRef && previousRef !== ref) {
      delete directTextures[identifier];
      result.blocked[identifier] = 'ambiguous_direct_texture';
      result.diagnostics.push({ code: 'ambiguous_direct_texture', path, identifier });
    } else if (!Object.hasOwn(result.blocked, identifier)) directTextures[identifier] = ref;
  }
  result.stats.blocked = Object.keys(result.blocked).length;
  result.stats.directTextures = Object.keys(directTextures).length;
  result.stats.documentBytes = totalBytes;
  return { ...result, directTextures, processing: 'node-worker' };
}

/** Pack identity is immutable; edits use the explicitly supplied overrides. */
export async function loadPackItemIconIndex(item, overrides = {}) {
  if (!item || typeof item !== 'object') fail('ITEM_ICON_PACK_INVALID');
  const snapshot = overridesSnapshot(overrides);
  let generations = cache.get(item);
  if (!generations) { generations = new Map(); cache.set(item, generations); }
  const existing = generations.get(snapshot.key);
  if (existing) {
    generations.delete(snapshot.key);
    generations.set(snapshot.key, existing);
    return existing.promise;
  }
  const record = { bytes: 0, promise: null };
  record.promise = Promise.resolve().then(() => build(item, snapshot.selected)).then(result => {
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes > MAX_CACHE_BYTES) fail('ITEM_ICON_OUTPUT_LIMIT');
    record.bytes = bytes;
    let total = [...generations.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (total > MAX_CACHE_BYTES && generations.size) {
      const oldest = generations.keys().next().value;
      total -= generations.get(oldest).bytes;
      generations.delete(oldest);
    }
    return result;
  }).catch(error => { if (generations.get(snapshot.key) === record) generations.delete(snapshot.key); throw error; });
  generations.set(snapshot.key, record);
  while (generations.size > 2) generations.delete(generations.keys().next().value);
  return record.promise;
}
