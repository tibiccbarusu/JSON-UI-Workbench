/** Exact item identifier → item_texture.json key mappings. No I/O or guessing. */
export const ITEM_ICON_INDEX_MAX_DEFINITIONS = 10_000;
const MAX_KEY_LENGTH = 256;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
}

function own(record, key) {
  if (!isRecord(record)) return { valid: false, present: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return { valid: true, present: false };
    return Object.hasOwn(descriptor, 'value')
      ? { valid: true, present: true, value: descriptor.value }
      : { valid: false, present: true };
  } catch { return { valid: false, present: false }; }
}

function safeKey(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_KEY_LENGTH
      || value !== value.trim() || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  if (value.split(/[:/]/u).some(part => !part || part === '.' || part === '..' || FORBIDDEN.has(part))) return null;
  return value;
}

/** Unqualified vanilla IDs are normalized; custom namespaces are never removed. */
export function normalizeItemIconIdentifier(value) {
  if (!safeKey(value) || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/u.test(value)) return null;
  return value.includes(':') ? value : `minecraft:${value}`;
}

function readIcon(icon) {
  if (typeof icon === 'string') {
    const atlasKey = safeKey(icon);
    return atlasKey ? { atlasKey } : { error: 'invalid_icon_key' };
  }
  if (!isRecord(icon)) return { error: 'invalid_icon' };
  const texture = own(icon, 'texture');
  const textures = own(icon, 'textures');
  if (!texture.valid || !textures.valid) return { error: 'invalid_icon' };
  const candidates = [];
  if (texture.present) {
    const key = safeKey(texture.value);
    if (!key) return { error: 'invalid_icon_key' };
    candidates.push(key);
  }
  if (textures.present) {
    const entry = own(textures.value, 'default');
    const key = entry.valid && entry.present ? safeKey(entry.value) : null;
    if (!key) return { error: 'invalid_icon_default' };
    candidates.push(key);
  }
  if (!candidates.length) return { error: 'missing_icon_key' };
  if (candidates.some(key => key !== candidates[0])) return { error: 'ambiguous_icon_keys' };
  return { atlasKey: candidates[0] };
}

/**
 * itemDefinitions: [{ path, document }] from one already-selected resource pack.
 * The caller enforces input-byte limits before parsing. This function bounds the
 * number of definitions and never enumerates unrelated document properties.
 * Duplicate identifiers block resolution even when the declared icons match.
 * packPaths is accepted for API compatibility but intentionally not inspected.
 */
export function buildItemIconIndex(options = {}) {
  const icons = Object.create(null);
  const blocked = Object.create(null);
  const diagnostics = [];
  const stats = { scanned: 0, mapped: 0, blocked: 0, limited: false };
  const result = { icons, blocked, diagnostics, stats };
  const input = own(options, 'itemDefinitions');
  if (input.valid && !input.present) return result;
  if (!input.valid || !Array.isArray(input.value)) {
    diagnostics.push({ code: 'invalid_definitions', path: null });
    return result;
  }
  let length;
  try { length = Object.getOwnPropertyDescriptor(input.value, 'length')?.value; } catch { /* rejected below */ }
  if (!Number.isSafeInteger(length) || length < 0 || length > ITEM_ICON_INDEX_MAX_DEFINITIONS) {
    stats.limited = true;
    diagnostics.push({ code: 'definitions_limit', path: null });
    return result;
  }
  const seen = new Set();
  for (let index = 0; index < length; index += 1) {
    stats.scanned += 1;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(input.value, String(index)); } catch { /* rejected below */ }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      diagnostics.push({ code: 'invalid_definition', path: null });
      continue;
    }
    const entry = descriptor.value;
    const source = own(entry, 'path');
    const path = source.valid && typeof source.value === 'string' && source.value.length <= 1024
      ? source.value : null;
    const document = own(entry, 'document');
    const item = own(document.value, 'minecraft:item');
    const description = own(item.value, 'description');
    const rawIdentifier = own(description.value, 'identifier');
    const identifier = rawIdentifier.valid ? normalizeItemIconIdentifier(rawIdentifier.value) : null;
    if (!document.valid || !item.valid || !description.valid || !identifier) {
      diagnostics.push({ code: 'invalid_identifier', path });
      continue;
    }
    if (seen.has(identifier)) {
      delete icons[identifier];
      blocked[identifier] = 'ambiguous_duplicate';
      diagnostics.push({ code: 'ambiguous_duplicate', path, identifier });
      continue;
    }
    seen.add(identifier);
    const components = own(item.value, 'components');
    const component = own(components.value, 'minecraft:icon');
    if (components.valid && !components.present || component.valid && !component.present) {
      diagnostics.push({ code: 'missing_icon', path, identifier });
      continue;
    }
    const icon = components.valid && component.valid ? readIcon(component.value) : { error: 'invalid_icon' };
    if (icon.error) {
      blocked[identifier] = icon.error;
      diagnostics.push({ code: icon.error, path, identifier });
      continue;
    }
    icons[identifier] = { atlasKey: icon.atlasKey };
  }
  stats.mapped = Object.keys(icons).length;
  stats.blocked = Object.keys(blocked).length;
  return result;
}

/**
 * Classify block item visuals without turning their material textures into
 * inventory sprites. Geometry is recorded as a capability boundary only.
 * Bounded descriptors avoid executing pack/tooling supplied object getters.
 */
export function buildBlockItemVisualIndex(blockDefinitions = []) {
  const models = Object.create(null), diagnostics = [];
  let length;
  try { length = Array.isArray(blockDefinitions) ? Object.getOwnPropertyDescriptor(blockDefinitions, 'length')?.value : null; }
  catch { length = null; }
  if (!Number.isSafeInteger(length) || length < 0 || length > ITEM_ICON_INDEX_MAX_DEFINITIONS) {
    return { models, diagnostics: [{ code: 'block_definitions_limit_or_invalid', path: null }] };
  }
  for (let index = 0; index < length; index += 1) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(blockDefinitions, String(index)); } catch { /* diagnosed below */ }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      diagnostics.push({ code: 'invalid_block_definition', path: null });
      continue;
    }
    const entry = descriptor.value, pathValue = own(entry, 'path');
    const path = pathValue.valid && typeof pathValue.value === 'string' ? pathValue.value.slice(0, 1024) : null;
    const document = own(entry, 'document'), block = own(document.value, 'minecraft:block');
    const description = own(block.value, 'description'), rawId = own(description.value, 'identifier');
    const identifier = rawId.valid ? normalizeItemIconIdentifier(rawId.value) : null;
    if (!document.valid || !block.valid || !description.valid || !identifier) {
      diagnostics.push({ code: 'invalid_block_identifier', path });
      continue;
    }
    // A block without item_visual still renders as a model by default. Do not
    // guess a face from material_instances, terrain_texture, or blocks.json.
    models[identifier] = { kind: 'block-item-model' };
  }
  return { models, diagnostics };
}
