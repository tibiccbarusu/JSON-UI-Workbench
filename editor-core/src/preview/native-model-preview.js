/*
  Bounded resource-backed previews for native JSON UI renderers.

  This module intentionally implements neither Molang nor the Bedrock render
  pipeline. It accepts only finite resource-pack data, compiles a deterministic
  orthographic snapshot, and fails closed when the input exceeds fixed limits.
*/

export const NATIVE_PREVIEW_MAX_DRAW_WORK_UNITS = 2048;
export const NATIVE_PREVIEW_MAX_MOTION_MESH_BYTES = 2 * 1024 * 1024;

const DEFAULT_LIMITS = Object.freeze({
  maxBones: 256,
  maxCubes: 2048,
  maxFaces: NATIVE_PREVIEW_MAX_DRAW_WORK_UNITS,
  maxBoneDepth: 64,
  maxCoordinate: 1_000_000,
});

const PROTECTED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function own(record, key) {
  if (!record || typeof record !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unsupportedGeometryFeature(feature, boneName = null, cubeIndex = null, faceName = null) {
  return { ok: false, error: 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED',
    detail: { feature, boneName, cubeIndex, faceName } };
}

function safeName(value, maximum = 512) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (!name || name.length > maximum || /[\u0000-\u001f\u007f]/u.test(name)) return '';
  if (PROTECTED_KEYS.has(name.toLowerCase())) return '';
  return name;
}

function finiteVec3(value, fallback = null, maximum = DEFAULT_LIMITS.maxCoordinate) {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const result = value.slice(0, 3);
  if (result.some((item) => typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > maximum)) return fallback;
  return result;
}

function finiteVec2(value, fallback = null, maximum = DEFAULT_LIMITS.maxCoordinate) {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const result = value.slice(0, 2);
  if (result.some((item) => typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > maximum)) return fallback;
  return result;
}

function strictVersionParts(value) {
  if (typeof value === 'string') {
    if (!/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/u.test(value)) return null;
    const parts = value.split('.').map(Number);
    return parts.every((part) => Number.isSafeInteger(part) && part >= 0) ? parts : null;
  }
  if (Array.isArray(value)) {
    if (value.length < 1 || value.length > 4) return null;
    try {
      if (Reflect.ownKeys(value).some((key) => (
        typeof key !== 'string'
        || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key))
      ))) return null;
    } catch {
      return null;
    }
    const parts = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      const part = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? descriptor.value
        : null;
      if (!Number.isSafeInteger(part) || part < 0) return null;
      parts.push(part);
    }
    return parts;
  }
  return null;
}

export function parseEngineVersion(value) {
  const parts = strictVersionParts(value);
  return parts ? Object.freeze([...parts]) : null;
}

function isKnownBoundedDocumentVersion(value) {
  const parsed = strictVersionParts(value);
  return Boolean(parsed
    && compareEngineVersions(parsed, [1, 8, 0]) >= 0
    && compareEngineVersions(parsed, [1, 26, 10]) <= 0);
}

export function compareEngineVersions(left, right) {
  const a = strictVersionParts(left) || [0];
  const b = strictVersionParts(right) || [0];
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta) return delta;
  }
  return 0;
}

function safeTextureRef(value) {
  const ref = safeName(value);
  if (!ref || /^[#$@(/]/u.test(ref) || ref.includes('..') || /[\\:?#%]/u.test(ref)) return '';
  return ref.replace(/\.(?:png|tga|jpe?g)$/giu, '');
}

/** Explicit static preview inputs. These values are not live entity queries. */
export function normalizeHorsePreviewState(value = {}) {
  if (!record(value)) return null;
  const defaults = { variant: 0, markVariant: 0, armorVariant: 0, isSaddled: false, hasRider: false };
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { return null; }
  if (keys.some((key) => typeof key !== 'string' || !Object.hasOwn(defaults, key))) return null;
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && !Object.hasOwn(descriptor, 'value')) return null;
    const actual = descriptor ? descriptor.value : fallback;
    if (typeof fallback === 'boolean' ? typeof actual !== 'boolean'
      : !Number.isInteger(actual) || actual < 0 || actual > 31) return null;
    result[key] = actual;
  }
  return Object.freeze(result);
}

/** Bounded orthographic camera; the default preserves the previous preview. */
export function normalizeNativePreviewCamera(value = {}) {
  if (!record(value)) return null;
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { return null; }
  if (keys.some((key) => !['yaw', 'pitch'].includes(key))) return null;
  const result = {};
  for (const [key, fallback, maximum] of [['yaw', -32, 180], ['pitch', 18, 89]]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && !Object.hasOwn(descriptor, 'value')) return null;
    const actual = descriptor ? descriptor.value : fallback;
    if (typeof actual !== 'number' || !Number.isFinite(actual) || Math.abs(actual) > maximum) return null;
    result[key] = actual;
  }
  return Object.freeze(result);
}

/** 内部で加算した水平角だけを同じ向きの [-180,180] 度へ戻す。外部入力の検証は緩めない。 */
export function wrapNativePreviewYaw(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= -180 && value <= 180) return value;
  return ((value + 180) % 360 + 360) % 360 - 180;
}

/** Return true only for an own-data Bedrock client entity describing a horse. */
export function isHorseClientEntityDocument(document) {
  const clientEntity = own(document, 'minecraft:client_entity');
  const description = own(clientEntity, 'description');
  return record(description) && own(description, 'identifier') === 'minecraft:horse';
}

/**
 * Extract the finite data needed for a normal adult horse snapshot while
 * preserving why a matching client entity cannot be previewed.
 */
export function extractHorseClientEntityResult(document) {
  const clientEntity = own(document, 'minecraft:client_entity');
  const description = own(clientEntity, 'description');
  if (!record(description) || own(description, 'identifier') !== 'minecraft:horse') {
    return Object.freeze({ status: 'not-horse', descriptor: null, minEngineVersion: null, issue: null });
  }
  const rawMinEngineVersion = own(description, 'min_engine_version');
  const minEngineVersion = rawMinEngineVersion === undefined
    ? [0]
    : strictVersionParts(rawMinEngineVersion);
  if (!minEngineVersion) {
    return Object.freeze({ status: 'invalid', descriptor: null, minEngineVersion: null, issue: 'NATIVE_PREVIEW_ENGINE_VERSION_INVALID' });
  }
  // Only a document that actually defines the requested entity participates
  // in compatibility checks. Retain its min version even when the document
  // syntax is newer than this preview, so a future incompatible candidate can
  // be ignored before the winning compatible definition is inspected.
  const documentFormat = own(document, 'format_version');
  if (documentFormat === undefined || !isKnownBoundedDocumentVersion(documentFormat)) {
    return Object.freeze({ status: 'invalid', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_ENTITY_FORMAT_UNSUPPORTED' });
  }

  const geometries = own(description, 'geometry');
  const textures = own(description, 'textures');
  if (!record(geometries) || !record(textures)) {
    return Object.freeze({ status: 'invalid', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_MODEL_INVALID' });
  }
  let textureKeys;
  try { textureKeys = Reflect.ownKeys(textures); } catch {
    return Object.freeze({ status: 'invalid', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_TEXTURE_ALIAS_INVALID' });
  }
  if (textureKeys.length > 128) {
    return Object.freeze({ status: 'invalid', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_LIMIT_EXCEEDED' });
  }
  if (textureKeys.some((key) => typeof key !== 'string')) {
    return Object.freeze({ status: 'invalid', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_TEXTURE_ALIAS_INVALID' });
  }
  const geometryIdentifier = safeName(own(geometries, 'default'));
  if (!geometryIdentifier) {
    return Object.freeze({ status: 'invalid', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_MODEL_INVALID' });
  }

  const renderControllers = own(description, 'render_controllers');
  const controllerCandidates = Array.isArray(renderControllers)
    && renderControllers.length === 1
    && Object.keys(renderControllers).every((key) => key === '0')
    && typeof renderControllers[0] === 'string'
    ? [renderControllers[0]]
    : [];
  let textureAlias = '';
  let textureRef = '';
  let textureLayers = [];
  let controllerId = '';
  if (controllerCandidates.includes('controller.render.horse.v4')
    || controllerCandidates.includes('controller.render.horse.v3')
    || controllerCandidates.includes('controller.render.horse.v1.and.v2')) {
    const materials = own(description, 'materials');
    if (!record(materials) || own(materials, 'default') !== 'horse_leather_armor') {
      return Object.freeze({ status: 'controller-unsupported', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_MATERIAL_UNSUPPORTED' });
    }
    textureAlias = 'base_white';
    textureRef = safeTextureRef(own(textures, textureAlias));
    const markingsRef = safeTextureRef(own(textures, 'markings_none'));
    const armorRef = safeTextureRef(own(textures, 'armor_none'));
    if (!textureRef || !markingsRef || !armorRef) {
      return Object.freeze({ status: 'invalid', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_TEXTURE_ALIAS_INVALID' });
    }
    textureLayers = [textureRef, markingsRef, armorRef];
    controllerId = controllerCandidates[0];
  } else if (renderControllers === undefined) {
    textureAlias = 'default';
    textureRef = safeTextureRef(own(textures, textureAlias));
    if (!textureRef) {
      return Object.freeze({ status: 'invalid', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_TEXTURE_ALIAS_INVALID' });
    }
    textureLayers = [textureRef];
  } else {
    // Do not infer what a custom Molang render controller selects.
    return Object.freeze({ status: 'controller-unsupported', descriptor: null, minEngineVersion, issue: 'NATIVE_PREVIEW_CONTROLLER_UNSUPPORTED' });
  }

  const descriptor = Object.freeze({
    identifier: 'minecraft:horse',
    minEngineVersion,
    geometryIdentifier,
    textureAlias,
    textureRef,
    textureLayers: Object.freeze(textureLayers),
    controllerId,
    textureAliases: Object.freeze(Object.fromEntries(textureKeys
      .map((key) => [key, safeTextureRef(own(textures, key))])
      .filter(([key, ref]) => safeName(key, 128) && ref))),
  });
  return Object.freeze({ status: 'found', descriptor, minEngineVersion, issue: null });
}

/** Compatibility wrapper for callers that only need a supported descriptor. */
export function extractHorseClientEntity(document) {
  const result = extractHorseClientEntityResult(document);
  return result.status === 'found' ? result.descriptor : null;
}

function normalizedControllerExpression(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, '') : '';
}

/** Verify the narrow Vanilla adult-variant controller contract used here. */
export function inspectHorseRenderControllerDocument(document, controllerId = 'controller.render.horse.v4') {
  const controllers = own(document, 'render_controllers');
  if (!record(controllers)) return { status: 'missing' };
  const controller = own(controllers, controllerId);
  if (controller === undefined) return { status: 'missing' };
  // Gate the syntax version only after the requested controller was found.
  // Otherwise any unrelated future controller file could disable this model.
  const documentFormat = own(document, 'format_version');
  if (documentFormat === undefined || !isKnownBoundedDocumentVersion(documentFormat)) {
    return { status: 'unsupported' };
  }
  if (!record(controller)) return { status: 'unsupported' };
  const arrays = own(controller, 'arrays');
  const textureArrays = own(arrays, 'textures');
  const baseArray = own(textureArrays, 'Array.base');
  const markingsArray = own(textureArrays, 'Array.markings');
  const armorArray = own(textureArrays, 'Array.armor');
  const babyBaseArray = own(textureArrays, 'Array.baby_base');
  const babyMarkingsArray = own(textureArrays, 'Array.baby_markings');
  const textures = own(controller, 'textures');
  const partVisibility = own(controller, 'part_visibility');
  const materials = own(controller, 'materials');
  const color = own(controller, 'color');
  let controllerKeys;
  let arrayKeys;
  let colorKeys;
  try {
    controllerKeys = Object.keys(controller).sort();
    arrayKeys = Object.keys(textureArrays).sort();
    colorKeys = Object.keys(color).sort();
  } catch {
    return { status: 'unsupported' };
  }
  let materialKeys;
  try {
    materialKeys = Array.isArray(materials) && record(own(materials, '0')) ? Object.keys(own(materials, '0')) : [];
  } catch {
    return { status: 'unsupported' };
  }
  const v1OrV2Controller = controllerId === 'controller.render.horse.v1.and.v2';
  const preV4Controller = v1OrV2Controller || controllerId === 'controller.render.horse.v3';
  if (!preV4Controller && controllerId !== 'controller.render.horse.v4') return { status: 'unsupported' };
  const boundedArrayStartsWith = (value, expected) => Array.isArray(value)
    && value.length >= 1
    && value.length <= 32
    && own(value, '0') === expected;
  const expectedArrayKeys = preV4Controller
    ? ['Array.armor', 'Array.base', 'Array.markings']
    : ['Array.armor', 'Array.baby_base', 'Array.baby_markings', 'Array.base', 'Array.markings'];
  const expectedTextures = preV4Controller
    ? [
        'Array.base[query.variant]',
        'Array.markings[query.mark_variant]',
        'Array.armor[variable.armor_texture_slot]',
      ]
    : [
        'query.is_baby?Array.baby_base[query.variant]:Array.base[query.variant]',
        'query.is_baby?Array.baby_markings[query.mark_variant]:Array.markings[query.mark_variant]',
        'query.is_baby?Texture.armor_none:Array.armor[variable.armor_texture_slot]',
      ];
  const expectedGeometry = preV4Controller
    ? 'Geometry.default'
    : 'query.is_baby?Geometry.baby:Geometry.default';
  // Both slot 1 (audited v3 pack) and slot 4 (later public controller) are
  // observed. Armor selection is an explicit static input; require a
  // consistent known slot across all channels rather than running queries.
  const armorColorSlot=/^variable\.armor_texture_slot\?query\.armor_color_slot\(([14]),0\):this$/u.exec(normalizedControllerExpression(own(color,'r')))?.[1];
  if (controllerKeys.join('|') !== ['arrays', 'color', 'geometry', 'materials', 'part_visibility', 'textures'].join('|')
    || arrayKeys.join('|') !== expectedArrayKeys.sort().join('|')
    || colorKeys.join('|') !== ['a', 'b', 'g', 'r'].join('|')
    || !boundedArrayStartsWith(baseArray, 'Texture.base_white')
    || !boundedArrayStartsWith(markingsArray, 'Texture.markings_none')
    || !boundedArrayStartsWith(armorArray, 'Texture.armor_none')
    || (!preV4Controller && !boundedArrayStartsWith(babyBaseArray, 'Texture.baby_base_white'))
    || (!preV4Controller && !boundedArrayStartsWith(babyMarkingsArray, 'Texture.markings_none'))
    || !Array.isArray(textures) || textures.length !== 3
    || expectedTextures.some((expected, index) => normalizedControllerExpression(own(textures, String(index))) !== expected)
    || normalizedControllerExpression(own(controller, 'geometry')) !== expectedGeometry
    || !Array.isArray(materials) || materials.length !== 1 || !record(own(materials, '0'))
    || materialKeys.length !== 1 || materialKeys[0] !== '*' || own(own(materials, '0'), '*') !== 'Material.default'
    || !armorColorSlot
    || normalizedControllerExpression(own(color, 'g')) !== `variable.armor_texture_slot?query.armor_color_slot(${armorColorSlot},1):this`
    || normalizedControllerExpression(own(color, 'b')) !== `variable.armor_texture_slot?query.armor_color_slot(${armorColorSlot},2):this`
    || normalizedControllerExpression(own(color, 'a')) !== `variable.armor_texture_slot?query.armor_color_slot(${armorColorSlot},3):this`
    || !Array.isArray(partVisibility) || partVisibility.length !== (v1OrV2Controller ? 5 : 6)) {
    return { status: 'unsupported' };
  }
  const required = new Map(v1OrV2Controller ? [
    ['*saddle*', 'query.is_saddled'],
    ['SaddleMouthLine', 'query.is_saddled&&query.has_rider'],
    ['SaddleMouthLineR', 'query.is_saddled&&query.has_rider'],
    ['MuleEar*', false],
    ['Bag*', false],
  ] : [
    ['Saddle', 'query.is_saddled'],
    ['Bit*', 'query.is_saddled'],
    ['Bridle', 'query.is_saddled'],
    ['Reins*', 'query.is_saddled&&query.has_rider'],
    ['Bag*', false],
    ['MuleEar*', false],
  ]);
  for (const row of partVisibility) {
    if (!record(row)) return { status: 'unsupported' };
    let rowKeys;
    try { rowKeys = Object.keys(row); } catch { return { status: 'unsupported' }; }
    if (rowKeys.length !== 1 || !required.has(rowKeys[0])) return { status: 'unsupported' };
    for (const [name, expected] of required) {
      const actual = own(row, name);
      if (actual === undefined) continue;
      const matches = expected === false
        ? actual === false
        : normalizedControllerExpression(actual) === expected;
      if (!matches) return { status: 'unsupported' };
      required.delete(name);
    }
  }
  if (required.size) return { status: 'unsupported' };
  return {
    status: 'supported',
    textureAlias: 'base_white',
    // Preserve actual authored array order; variant is an index, never a
    // hard-coded color-to-number lookup inferred from the vanilla filename.
    baseTextureAliases: Object.freeze(Array.from({ length: baseArray.length }, (_, index) => {
      const value = own(baseArray, String(index));
      return typeof value === 'string' && /^Texture\.[A-Za-z0-9_]+$/u.test(value) ? value.slice(8) : null;
    })),
    markingTextureAliases: Object.freeze(Array.from({ length: markingsArray.length }, (_, index) => {
      const value = own(markingsArray, String(index));
      return typeof value === 'string' && /^Texture\.[A-Za-z0-9_]+$/u.test(value) ? value.slice(8) : null;
    })),
    armorTextureAliases: Object.freeze(Array.from({ length: armorArray.length }, (_, index) => {
      const value = own(armorArray, String(index));
      return typeof value === 'string' && /^Texture\.[A-Za-z0-9_]+$/u.test(value) ? value.slice(8) : null;
    })),
    controllerId,
    hiddenBonePatterns: Object.freeze(v1OrV2Controller
      ? ['*saddle*', 'SaddleMouthLine', 'SaddleMouthLineR', 'Bag*', 'MuleEar*']
      : ['Saddle', 'Bit*', 'Bridle', 'Reins*', 'Bag*', 'MuleEar*']),
  };
}

/** Resolve one audited controller state without evaluating arbitrary Molang. */
export function selectHorsePreviewState(descriptor, contract, rawState = {}) {
  const state = normalizeHorsePreviewState(rawState);
  if (!state) return { ok: false, issue: 'NATIVE_PREVIEW_STATE_INVALID' };
  if (!descriptor?.controllerId) {
    if (state.variant || state.markVariant || state.armorVariant || state.isSaddled || state.hasRider) {
      return { ok: false, issue: 'NATIVE_PREVIEW_STATE_UNSUPPORTED' };
    }
    return { ok: true, descriptor, state, hiddenBonePatterns: [] };
  }
  if (contract?.status !== 'supported') return { ok: false, issue: 'NATIVE_PREVIEW_CONTROLLER_UNSUPPORTED' };
  const base = contract.baseTextureAliases?.[state.variant];
  const markings = contract.markingTextureAliases?.[state.markVariant];
  const armor = contract.armorTextureAliases?.[state.armorVariant];
  if (base === undefined || markings === undefined) return { ok: false, issue: 'NATIVE_PREVIEW_VARIANT_OUT_OF_RANGE' };
  if (armor === undefined) return { ok: false, issue: 'NATIVE_PREVIEW_ARMOR_OUT_OF_RANGE' };
  if (!base || !markings || !armor) return { ok: false, issue: 'NATIVE_PREVIEW_CONTROLLER_UNSUPPORTED' };
  // Leather uses an entity color query and a native shader. Only the known
  // untinted armor aliases can be composed correctly from these pack layers.
  // Custom aliases remain diagnosed instead of guessing a dye/material rule.
  if (!['armor_none', 'armor_iron', 'armor_gold', 'armor_diamond', 'armor_copper', 'armor_netherite'].includes(armor)) {
    return { ok: false, issue: 'NATIVE_PREVIEW_ARMOR_MATERIAL_UNSUPPORTED' };
  }
  const refs = [base, markings, armor].map((key) => own(descriptor.textureAliases, key));
  if (refs.some((ref) => !ref)) return { ok: false, issue: 'NATIVE_PREVIEW_TEXTURE_ALIAS_INVALID' };
  const legacy = descriptor.controllerId === 'controller.render.horse.v1.and.v2';
  const hidden = ['Bag*', 'MuleEar*'];
  if (!state.isSaddled) hidden.push(...(legacy ? ['*saddle*'] : ['Saddle', 'Bit*', 'Bridle']));
  if (!state.isSaddled || !state.hasRider) hidden.push(...(legacy ? ['SaddleMouthLine', 'SaddleMouthLineR'] : ['Reins*']));
  return {
    ok: true, state, hiddenBonePatterns: hidden,
    descriptor: Object.freeze({ ...descriptor, textureAlias: base, armorTextureAlias: armor,
      textureRef: refs[0], textureLayers: Object.freeze(refs) }),
  };
}

function modernGeometryCandidates(document) {
  const list = own(document, 'minecraft:geometry');
  return Array.isArray(list) ? list : [];
}

/** Resolve a modern or legacy geometry record by identifier without guessing. */
export function findGeometryRecordResult(document, identifier, options = {}) {
  const wanted = safeName(identifier);
  if (!wanted || !record(document)) return { status: 'invalid', geometry: null };
  const maximum = Number.isSafeInteger(options.maxCandidates)
    ? Math.max(1, Math.min(4096, options.maxCandidates))
    : 256;
  const candidates = modernGeometryCandidates(document);
  if (candidates.length > maximum) return { status: 'limit', geometry: null };
  let found = null;
  for (const candidate of candidates) {
    if (!record(candidate)) return { status: 'invalid', geometry: null };
    const description = own(candidate, 'description');
    if (record(description) && own(description, 'identifier') === wanted) {
      if (found) return { status: 'ambiguous', geometry: null };
      found = candidate;
    }
  }
  const legacy = own(document, wanted);
  if (legacy !== undefined && !record(legacy)) return { status: 'invalid', geometry: null };
  if (record(legacy)) {
    if (found) return { status: 'ambiguous', geometry: null };
    found = legacy;
  }
  if (!found) return { status: 'missing', geometry: null };
  // A future format on an unrelated model must not poison target lookup.
  // Gate only the document that actually defines the requested identifier.
  const rawFormatVersion = own(document, 'format_version');
  if (rawFormatVersion === undefined || !strictVersionParts(rawFormatVersion)) {
    return { status: 'invalid', geometry: null };
  }
  if (!isKnownBoundedDocumentVersion(rawFormatVersion)) return { status: 'unsupported', geometry: null };
  return {
    status: 'found',
    geometry: found,
    formatVersion: Object.freeze(strictVersionParts(rawFormatVersion)),
  };
}

/** Compatibility wrapper for pure callers that only need an unambiguous hit. */
export function findGeometryRecord(document, identifier) {
  const result = findGeometryRecordResult(document, identifier);
  return result.status === 'found' ? result.geometry : null;
}

function degToRad(value) {
  return Number(value) * Math.PI / 180;
}

function rotatePoint(point, pivot, rotation) {
  let [x, y, z] = point;
  const [px, py, pz] = pivot;
  x -= px;
  y -= py;
  z -= pz;
  const [rx, ry, rz] = rotation.map(degToRad);
  if (rx) {
    const cos = Math.cos(rx);
    const sin = Math.sin(rx);
    [y, z] = [y * cos - z * sin, y * sin + z * cos];
  }
  if (ry) {
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    [x, z] = [x * cos + z * sin, -x * sin + z * cos];
  }
  if (rz) {
    const cos = Math.cos(rz);
    const sin = Math.sin(rz);
    [x, y] = [x * cos - y * sin, x * sin + y * cos];
  }
  return [x + px, y + py, z + pz];
}

// A geometry snapshot may contain thousands of vertices sharing one bone.
// Compile its finite rotation once; keep the same arithmetic order as the
// public point transform so cached transforms preserve existing UV placement.
function compileBedrockRotation(pivot, rotation) {
  const [rx, ry, rz] = [-rotation[0], rotation[1], -rotation[2]].map(degToRad);
  if (!rx && !ry && !rz) return null;
  const [px, py, pz] = pivot;
  const cx = Math.cos(rx); const sx = Math.sin(rx);
  const cy = Math.cos(ry); const sy = Math.sin(ry);
  const cz = Math.cos(rz); const sz = Math.sin(rz);
  return (point) => {
    let x = point[0] - px; let y = point[1] - py; let z = point[2] - pz;
    if (rx) [y, z] = [y * cx - z * sx, y * sx + z * cx];
    if (ry) [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    if (rz) [x, y] = [x * cz - y * sz, x * sz + y * cz];
    return [x + px, y + py, z + pz];
  };
}

/** Convert Bedrock-authored Euler signs into this unmirrored coordinate space. */
export function rotateBedrockPoint(point, pivot, rotation) {
  const authored = finiteVec3(rotation);
  const center = finiteVec3(pivot);
  const source = finiteVec3(point);
  if (!source || !center || !authored) return null;
  return rotatePoint(source, center, [-authored[0], authored[1], -authored[2]]);
}

function compileProjection(camera) {
  const yaw = degToRad(camera.yaw);
  const pitch = degToRad(camera.pitch);
  const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  const cp = Math.cos(pitch); const sp = Math.sin(pitch);
  return ([x, y, z]) => {
    const yawX = x * cy + z * sy;
    const yawZ = -x * sy + z * cy;
    return {
      x: yawX,
      y: -(y * cp - yawZ * sp),
      depth: y * sp + yawZ * cp,
    };
  };
}

function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    sum += points[index].x * next.y - next.x * points[index].y;
  }
  return sum / 2;
}

function flipUvRectX(rect) {
  return { ...rect, x: rect.x + rect.w, w: -rect.w };
}

function validUvRect(rect, textureWidth, textureHeight) {
  const values = [rect.x, rect.y, rect.w, rect.h];
  if (values.some((value) => !Number.isFinite(value))) return false;
  const minX = Math.min(rect.x, rect.x + rect.w);
  const maxX = Math.max(rect.x, rect.x + rect.w);
  const minY = Math.min(rect.y, rect.y + rect.h);
  const maxY = Math.max(rect.y, rect.y + rect.h);
  return minX >= 0 && minY >= 0 && maxX <= textureWidth && maxY <= textureHeight;
}

function finiteUvRect(rect) {
  return [rect.x, rect.y, rect.w, rect.h].every((value) => Number.isFinite(value));
}

// Keep diagnostics bounded and structural: never retain arbitrary model values.
function invalidGeometryField(field, reason, boneName = null, cubeIndex = null, faceName = null) {
  return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID',
    detail: { field, reason, boneName, cubeIndex, faceName } };
}

function invalidUv(field, reason) {
  return { invalid: true, field, reason, uv: null };
}

function cubeFaceUv(cube, bone, faceName, textureWidth, textureHeight, size, geometryFormatVersion, zeroAreaFace = false) {
  const uv = own(cube, 'uv');
  const cubeMirror = own(cube, 'mirror');
  const boneMirror = own(bone, 'mirror');
  if (cubeMirror !== undefined && typeof cubeMirror !== 'boolean') return invalidUv('mirror', 'expected-boolean');
  if (boneMirror !== undefined && typeof boneMirror !== 'boolean') return invalidUv('mirror', 'expected-boolean');
  const mirror = typeof cubeMirror === 'boolean' ? cubeMirror : boneMirror === true;
  const [width, height, depth] = size;
  const faceSize = faceName === 'east' || faceName === 'west'
    ? [depth, height]
    : faceName === 'up' || faceName === 'down'
      ? [width, depth]
      : [width, height];

  if (record(uv)) {
    const face = own(uv, faceName);
    // The Bedrock geometry schema explicitly defines an omitted per-face entry
    // as an omitted rendered face; never invent [0,0] pixels for it.
    if (face === undefined) return { omitted: true, uv: null };
    if (!record(face)) return invalidUv('uv', 'expected-face-object');
    const start = finiteVec2(own(face, 'uv'));
    const rawSize = own(face, 'uv_size');
    const uvSize = rawSize === undefined ? faceSize : finiteVec2(rawSize);
    if (!start) return invalidUv('uv', 'expected-finite-vector-2');
    if (!uvSize) return invalidUv('uv_size', 'expected-finite-vector-2');
    let rect = { x: start[0], y: start[1], w: uvSize[0], h: uvSize[1] };
    // Bedrock's per-face U/D mapping has both authored axes reversed relative
    // to the internal quad corner order. Per-face UVs are not box-mirrored.
    if (faceName === 'up' || faceName === 'down') {
      rect = { x: rect.x + rect.w, y: rect.y + rect.h, w: -rect.w, h: -rect.h };
    }
    const rawRotation = own(face, 'uv_rotation');
    if (rawRotation !== undefined
      && geometryFormatVersion
      && compareEngineVersions(geometryFormatVersion, [1, 21, 0]) < 0) {
      // `uv_rotation` is not part of the bounded legacy contract. Applying
      // modern semantics to an older file would silently produce wrong pixels.
      return { unsupported: true, uv: null };
    }
    const rotation = rawRotation === undefined ? 0 : rawRotation;
    if (!Number.isInteger(rotation) || ![0, 90, 180, 270].includes(rotation)) {
      return invalidUv('uv_rotation', 'expected-quarter-turn');
    }
    if (own(face, 'material_instance') !== undefined) return { unsupported: true, feature: 'material_instance', uv: null };
    if (!finiteUvRect(rect)) return invalidUv('uv', 'expected-finite-rectangle');
    const outsideTexture = !validUvRect(rect, textureWidth, textureHeight);
    if (outsideTexture && !zeroAreaFace) return invalidUv('uv', 'outside-texture');
    return {
      omitted: false,
      ...(outsideTexture ? { zeroAreaUvBoundsSkipped: true } : {}),
      rotationSteps: rotation / 90,
      uv: {
        x: rect.x / textureWidth,
        y: rect.y / textureHeight,
        w: rect.w / textureWidth,
        h: rect.h / textureHeight,
      },
    };
  }
  if (uv !== undefined && !Array.isArray(uv)) return invalidUv('uv', 'expected-array-or-face-map');
  const start = uv === undefined ? [0, 0] : finiteVec2(uv);
  if (!start) return invalidUv('uv', 'expected-finite-vector-2');
  const [u, v] = start;
  const boxRects = {
    up: { x: u + depth + width, y: v + depth, w: -width, h: -depth },
    down: { x: u + depth + (2 * width), y: v, w: -width, h: depth },
    east: { x: u, y: v + depth, w: depth, h: height },
    north: { x: u + depth, y: v + depth, w: width, h: height },
    west: { x: u + depth + width, y: v + depth, w: depth, h: height },
    south: { x: u + (2 * depth) + width, y: v + depth, w: width, h: height },
  };
  const sourceFaceName = mirror && faceName === 'east'
    ? 'west'
    : mirror && faceName === 'west'
      ? 'east'
      : faceName;
  let rect = boxRects[sourceFaceName];
  if (mirror) rect = flipUvRectX(rect);
  if (!rect) return invalidUv('uv', 'outside-texture');
  if (!finiteUvRect(rect)) return invalidUv('uv', 'expected-finite-rectangle');
  const outsideTexture = !validUvRect(rect, textureWidth, textureHeight);
  if (outsideTexture && !zeroAreaFace) return invalidUv('uv', 'outside-texture');
  return {
    omitted: false,
    ...(outsideTexture ? { zeroAreaUvBoundsSkipped: true } : {}),
    rotationSteps: 0,
    uv: {
      x: rect.x / textureWidth,
      y: rect.y / textureHeight,
      w: rect.w / textureWidth,
      h: rect.h / textureHeight,
    },
  };
}

/** Compile finite cube geometry into normalized, orthographically projected quads. */
export function compileBedrockGeometryScene(geometry, options = {}) {
  if (!record(geometry)) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
  const camera = normalizeNativePreviewCamera(options.camera);
  if (!camera) return { ok: false, error: 'NATIVE_PREVIEW_CAMERA_INVALID' };
  const geometryFormatVersion = options.geometryFormatVersion === null
    || options.geometryFormatVersion === undefined
    ? null
    : strictVersionParts(options.geometryFormatVersion);
  if (options.geometryFormatVersion !== null
    && options.geometryFormatVersion !== undefined
    && !geometryFormatVersion) {
    return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
  }
  if (geometryFormatVersion && !isKnownBoundedDocumentVersion(geometryFormatVersion)) {
    return { ok: false, error: 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED' };
  }
  const requestedLimits = record(options.limits) ? options.limits : {};
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, hardMaximum]) => {
    const requested = Number(own(requestedLimits, key));
    return [key, Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, hardMaximum) : hardMaximum];
  }));
  const description = record(own(geometry, 'description')) ? own(geometry, 'description') : geometry;
  for (const source of [geometry, description]) {
    const unsupported = ['poly_mesh', 'texture_meshes', 'material_instances'].find((key) => own(source, key) !== undefined);
    if (unsupported) return unsupportedGeometryFeature(unsupported);
  }
  const modernTextureWidth = own(description, 'texture_width');
  const legacyTextureWidth = own(geometry, 'texturewidth');
  const modernTextureHeight = own(description, 'texture_height');
  const legacyTextureHeight = own(geometry, 'textureheight');
  const textureWidth = modernTextureWidth !== undefined
    ? modernTextureWidth
    : legacyTextureWidth !== undefined ? legacyTextureWidth : 64;
  const textureHeight = modernTextureHeight !== undefined
    ? modernTextureHeight
    : legacyTextureHeight !== undefined ? legacyTextureHeight : 64;
  if (!Number.isInteger(textureWidth) || !Number.isInteger(textureHeight)
    || textureWidth <= 0 || textureHeight <= 0 || textureWidth > 16384 || textureHeight > 16384) {
    return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
  }
  const bones = own(geometry, 'bones');
  if (!Array.isArray(bones) || bones.length > limits.maxBones) {
    return { ok: false, error: bones?.length > limits.maxBones ? 'NATIVE_PREVIEW_LIMIT_EXCEEDED' : 'NATIVE_PREVIEW_MODEL_INVALID' };
  }

  const boneByName = new Map();
  const effectiveBoneInflate = new Map();
  const boneRotations = new Map();
  for (const bone of bones) {
    if (!record(bone)) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
    const name = safeName(own(bone, 'name'), 256);
    const foldedName = name.toLowerCase();
    // Official legacy horse geometry itself contains `Head` with children that
    // refer to `head`. Bedrock resolves these case-insensitively; two authored
    // bones that collide after folding remain ambiguous and fail closed.
    if (!name || boneByName.has(foldedName)) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
    const rawParent = own(bone, 'parent');
    if (rawParent !== undefined && !safeName(rawParent, 256)) {
      return invalidGeometryField('parent', 'expected-bone-name', name);
    }
    // Validate even cubeless and hidden bones. Such bones still participate in
    // the hierarchy; checking this only while resolving their cube UVs misses
    // malformed parent/root records entirely.
    if (own(bone, 'mirror') !== undefined && typeof own(bone, 'mirror') !== 'boolean') {
      return invalidGeometryField('mirror', 'expected-boolean', name);
    }
    for (const key of ['pivot', 'rotation']) {
      if (own(bone, key) !== undefined && !finiteVec3(own(bone, key))) {
        return invalidGeometryField(key, 'expected-finite-vector-3', name);
      }
    }
    boneRotations.set(bone, compileBedrockRotation(
      own(bone, 'pivot') === undefined ? [0, 0, 0] : finiteVec3(own(bone, 'pivot')),
      own(bone, 'rotation') === undefined ? [0, 0, 0] : finiteVec3(own(bone, 'rotation')),
    ));
    const boneInflate = own(bone, 'inflate');
    if (boneInflate !== undefined) {
      if (typeof boneInflate !== 'number'
        || !Number.isFinite(boneInflate)
        || Math.abs(boneInflate) > limits.maxCoordinate) {
        return invalidGeometryField('inflate', 'expected-finite-number', name);
      }
      if (!geometryFormatVersion || !isKnownBoundedDocumentVersion(geometryFormatVersion)) {
        return { ok: false, error: 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED' };
      }
      const legacyBoneInflate = compareEngineVersions(geometryFormatVersion, [1, 8, 0]) >= 0
        && compareEngineVersions(geometryFormatVersion, [1, 15, 0]) < 0;
      const modernIgnoredBoneInflate = compareEngineVersions(geometryFormatVersion, [1, 16, 0]) >= 0;
      // Microsoft documents bone-level inflate only for geometry 1.8 through
      // 1.14. Modern geometry ignores it; do not make a custom model larger
      // merely because it retains this deprecated property. The undocumented
      // 1.15 gap remains fail-closed instead of guessing either behavior.
      if (!legacyBoneInflate && !modernIgnoredBoneInflate) {
        return { ok: false, error: 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED' };
      }
      effectiveBoneInflate.set(bone, legacyBoneInflate ? boneInflate : 0);
    }
    boneByName.set(foldedName, bone);
  }

  const boneChains = new Map();
  const chainForBone = (bone) => {
    if (boneChains.has(bone)) return boneChains.get(bone);
    const chain = [];
    const seen = new Set();
    let cursor = bone;
    while (cursor) {
      const name = safeName(own(cursor, 'name'), 256);
      const foldedName = name.toLowerCase();
      if (!name || seen.has(foldedName) || chain.length >= limits.maxBoneDepth) return null;
      seen.add(foldedName);
      chain.push(cursor);
      const parentName = safeName(own(cursor, 'parent'), 256);
      cursor = parentName ? boneByName.get(parentName.toLowerCase()) : null;
      if (parentName && !cursor) return null;
    }
    boneChains.set(bone, chain);
    return chain;
  };

  const rawHiddenPatterns = Array.isArray(options.hiddenBonePatterns) ? options.hiddenBonePatterns : [];
  if (rawHiddenPatterns.length > 32) return { ok: false, error: 'NATIVE_PREVIEW_LIMIT_EXCEEDED' };
  const hiddenPatterns = [];
  for (const value of rawHiddenPatterns) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
      return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
    }
    const leadingWildcard = value.startsWith('*');
    const trailingWildcard = value.endsWith('*');
    const body = value.slice(leadingWildcard ? 1 : 0, trailingWildcard ? -1 : undefined);
    const stem = safeName(body, 255);
    if (!stem || body.includes('*')) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
    hiddenPatterns.push({ stem: stem.toLowerCase(), leadingWildcard, trailingWildcard });
  }
  const isHiddenBone = (name) => {
    const lower = String(name || '').toLowerCase();
    return hiddenPatterns.some((pattern) => (
      pattern.leadingWildcard && pattern.trailingWildcard
        ? lower.includes(pattern.stem)
        : pattern.leadingWildcard
          ? lower.endsWith(pattern.stem)
          : pattern.trailingWildcard
            ? lower.startsWith(pattern.stem)
            : lower === pattern.stem
    ));
  };

  const faces = [];
  // Optional finite intermediate mesh. The worker performs source validation,
  // UV resolution and hierarchical bone transforms once. A later cursor move
  // only reprojects these vertices; it never reparses source geometry.
  const motionVertices = [];
  const motionVertexBones = [];
  const motionFaces = [];
  let motionWithinBudget = options.retainMotionMesh === true;
  const project = compileProjection(camera);
  let cubeCount = 0;
  let planarCubeCount = 0;
  let zeroAreaUvBoundsSkipped = 0;
  const faceDefs = [
    ['west', [0, 4, 7, 3], [3, 7, 4, 0], 0],
    ['east', [1, 2, 6, 5], [6, 2, 1, 5], 1],
    ['down', [0, 1, 5, 4], [4, 5, 1, 0], 2],
    ['up', [3, 7, 6, 2], [3, 2, 6, 7], 3],
    ['north', [0, 3, 2, 1], [2, 3, 0, 1], 4],
    ['south', [4, 5, 6, 7], [7, 6, 5, 4], 5],
  ];

  // Count every authored cube before representative-state visibility is
  // applied. Hidden equipment must not become a way around structural limits.
  for (const bone of bones) {
    if (!chainForBone(bone)) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
    const unsupported = ['poly_mesh', 'texture_meshes', 'material_instances', 'bind_pose_rotation', 'binding', 'render_group_id'].find((key) => own(bone, key) !== undefined);
    if (unsupported) return unsupportedGeometryFeature(unsupported, own(bone, 'name'));
    if (own(bone, 'neverRender') !== undefined && typeof own(bone, 'neverRender') !== 'boolean') {
      return invalidGeometryField('neverRender', 'expected-boolean', own(bone, 'name'));
    }
    const cubes = own(bone, 'cubes');
    if (cubes === undefined) continue;
    if (!Array.isArray(cubes)) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
    cubeCount += cubes.length;
    if (cubeCount > limits.maxCubes) return { ok: false, error: 'NATIVE_PREVIEW_LIMIT_EXCEEDED' };
    if (cubes.some((cube) => !record(cube))) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
  }

  for (const bone of bones) {
    const boneName = safeName(own(bone, 'name'), 256);
    // A non-rendering bone remains in the transform hierarchy; child geometry
    // and attachment points must retain their parent rotation and pivot.
    const hiddenBone = isHiddenBone(boneName) || own(bone, 'neverRender') === true;
    const chain = chainForBone(bone);
    if (!chain) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
    const cubes = own(bone, 'cubes');
    if (cubes === undefined) continue;
    if (!Array.isArray(cubes)) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
    for (const [cubeIndex, cube] of cubes.entries()) {
      const unsupported = ['material_instance', 'material_instances', 'poly_mesh', 'texture_meshes'].find((key) => own(cube, key) !== undefined);
      if (unsupported) return unsupportedGeometryFeature(unsupported, boneName, cubeIndex);
      const cubeUv = own(cube, 'uv');
      const usesModernCubeFeature = record(cubeUv)
        || own(cube, 'rotation') !== undefined
        || own(cube, 'pivot') !== undefined;
      if (usesModernCubeFeature
        && (!geometryFormatVersion || compareEngineVersions(geometryFormatVersion, [1, 12, 0]) < 0)) {
        // Geometry 1.8 cubes only define origin, size, mirror, and array UVs.
        // Per-face UVs and cube transforms belong to the 1.12+ schema. Applying
        // their modern meaning to legacy or detached data would make a malformed
        // pack appear valid and render incorrectly. Cube inflate remains
        // accepted because Mojang's valid Vanilla 1.8 horse geometry uses it.
        return { ok: false, error: 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED' };
      }
      const origin = finiteVec3(own(cube, 'origin'));
      const size = finiteVec3(own(cube, 'size'));
      if (!origin) return invalidGeometryField('origin', 'expected-finite-vector-3', boneName, cubeIndex);
      if (!size) return invalidGeometryField('size', 'expected-finite-vector-3', boneName, cubeIndex);
      if (size.some((value) => value < 0)) return invalidGeometryField('size', 'negative-extent', boneName, cubeIndex);
      const zeroAxes = size.filter((value) => value === 0).length;
      if (zeroAxes === 1) planarCubeCount += 1;
      for (const key of ['pivot', 'rotation']) {
        if (own(cube, key) !== undefined && !finiteVec3(own(cube, key))) {
          return invalidGeometryField(key, 'expected-finite-vector-3', boneName, cubeIndex);
        }
      }
      const cubeInflate = own(cube, 'inflate');
      if (cubeInflate !== undefined
        && (typeof cubeInflate !== 'number'
          || !Number.isFinite(cubeInflate)
          || Math.abs(cubeInflate) > limits.maxCoordinate)) {
        return invalidGeometryField('inflate', 'expected-finite-number', boneName, cubeIndex);
      }
      const inflate = cubeInflate !== undefined ? cubeInflate : (effectiveBoneInflate.get(bone) ?? 0);
      const inflatedSize = size.map((value) => value + (2 * inflate));
      if (inflatedSize.some((value) => value < 0)) {
        return invalidGeometryField('inflate', 'negative-inflated-extent', boneName, cubeIndex);
      }
      // 実際に描く寸法で退化を判定する。線・点状の元cubeでもinflateで
      // 体積が生じるため、元のsizeだけで捨てると有効なモデルが消える。
      const inflatedZeroAxes = inflatedSize.filter((value) => value === 0).length;
      const min = origin.map((value) => value - inflate);
      const max = origin.map((value, index) => value + size[index] + inflate);
      let vertices = [
        [min[0], min[1], min[2]], [max[0], min[1], min[2]],
        [max[0], max[1], min[2]], [min[0], max[1], min[2]],
        [min[0], min[1], max[2]], [max[0], min[1], max[2]],
        [max[0], max[1], max[2]], [min[0], max[1], max[2]],
      ];
      const cubePivot = own(cube, 'pivot') === undefined
        // Bedrock geometry schemas specify the uninflated box center when a
        // cube pivot is omitted. Inflate expands symmetrically, so the center
        // is unchanged. This applies to both 1.12 and current formats; only an
        // explicitly-authored pre-1.14 pivot has the documented Y-flip caveat
        // handled below.
        ? origin.map((value, index) => value + size[index] / 2)
        : finiteVec3(own(cube, 'pivot'));
      const cubeRotation = own(cube, 'rotation') === undefined ? [0, 0, 0] : finiteVec3(own(cube, 'rotation'));
      if (!cubePivot || !cubeRotation) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
      if (geometryFormatVersion
        && compareEngineVersions(geometryFormatVersion, [1, 14, 0]) < 0
        && own(cube, 'pivot') !== undefined
        && cubeRotation.some(Boolean)) {
        // The official 1.12 schema documents a vertically-flipped explicit
        // cube pivot, but does not define a sufficiently precise transform to
        // reproduce it here. A neutral diagnosed fallback is safer than using
        // 1.14+ math and claiming a faithful preview.
        return unsupportedGeometryFeature('legacy_rotated_cube_pivot', boneName, cubeIndex);
      }
      const rotateCube = compileBedrockRotation(cubePivot, cubeRotation);
      if (rotateCube) vertices = vertices.map(rotateCube);
      for (const transformBone of chain) {
        const rotateBone = boneRotations.get(transformBone);
        if (rotateBone) vertices = vertices.map(rotateBone);
      }
      const projected = vertices.map(project);
      let motionVertexOffset = null;
      for (const [faceName, indices, uvIndices, shadeIndex] of faceDefs) {
        const points = indices.map((index) => projected[index]);
        // An exactly zero dimension after inflate makes this model-space face
        // unrenderable under every rigid cube/bone/camera rotation. Compare the
        // dimensions themselves, not their product (which could underflow).
        // An edge-on projected face or a zero-width UV on real geometry does
        // not qualify. All authored value/type/feature checks still run.
        const faceAxes = faceName === 'east' || faceName === 'west' ? [1, 2]
          : faceName === 'up' || faceName === 'down' ? [0, 2] : [0, 1];
        const zeroAreaFace = faceAxes.some((axis) => inflatedSize[axis] === 0);
        const resolvedUv = cubeFaceUv(
          cube,
          bone,
          faceName,
          textureWidth,
          textureHeight,
          size,
          geometryFormatVersion,
          zeroAreaFace,
        );
        if (resolvedUv.unsupported) return unsupportedGeometryFeature(resolvedUv.feature || 'uv_rotation', boneName, cubeIndex, faceName);
        if (resolvedUv.invalid) return invalidGeometryField(resolvedUv.field, resolvedUv.reason, boneName, cubeIndex, faceName);
        if (resolvedUv.zeroAreaUvBoundsSkipped) zeroAreaUvBoundsSkipped += 1;
        if (resolvedUv.omitted) continue;
        const rotationSteps = Number(resolvedUv.rotationSteps) || 0;
        const authoredUvIndices = rotationSteps
          ? [...uvIndices.slice(rotationSteps), ...uvIndices.slice(0, rotationSteps)]
          : uvIndices;
        if (motionWithinBudget && !hiddenBone && inflatedZeroAxes < 2) {
          // Keep edge-on faces so turning the model can reveal them. Omit only
          // faces that are degenerate in model space, regardless of camera.
          const a = vertices[indices[0]], b = vertices[indices[1]], c = vertices[indices[2]];
          const ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]);
          const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
          if (area > 1e-7) {
            if (motionFaces.length >= limits.maxFaces || (motionVertexOffset === null && motionVertices.length + vertices.length > 8192)) {
              // Motion must not turn a formerly valid static model into a
              // failed import. Retain the static scene with an explicit issue.
              motionWithinBudget = false;
              motionFaces.length = 0; motionVertices.length = 0; motionVertexBones.length = 0;
            } else {
              if (motionVertexOffset === null) {
                motionVertexOffset = motionVertices.length;
                motionVertices.push(...vertices);
                motionVertexBones.push(...vertices.map(() => boneName));
              }
              motionFaces.push({ boneName, faceName,
                indices: indices.map((index) => index + motionVertexOffset),
                uvIndices: authoredUvIndices.map((index) => index + motionVertexOffset),
                shade: [0.72, 0.82, 0.94, 1, 0.78, 0.88][shadeIndex], uv: resolvedUv.uv });
            }
          }
        }
        // Validate source UVs even when this view makes the face edge-on, or
        // when its bone is hidden. Camera movement must not change validity.
        if (inflatedZeroAxes >= 2 || Math.abs(polygonArea(points)) < 1e-7) continue;
        if (hiddenBone) continue;
        if (faces.length >= limits.maxFaces) return { ok: false, error: 'NATIVE_PREVIEW_LIMIT_EXCEEDED' };
        faces.push({
          boneName,
          faceName,
          points: points.map(({ x, y }) => ({ x, y })),
          uvPoints: authoredUvIndices.map((index) => ({ x: projected[index].x, y: projected[index].y })),
          depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length,
          shade: [0.72, 0.82, 0.94, 1, 0.78, 0.88][shadeIndex],
          uv: resolvedUv.uv,
          texture: true,
        });
      }
    }
  }
  if (!faces.length) return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };

  const allPoints = faces.flatMap((face) => face.points);
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID' };
  }
  const scale = Math.max(width, height);
  const padX = (scale - width) / (2 * scale);
  const padY = (scale - height) / (2 * scale);
  const normalizePoint = (point) => ({
    x: padX + (point.x - minX) / scale,
    y: padY + (point.y - minY) / scale,
  });
  for (const face of faces) {
    face.points = face.points.map(normalizePoint);
    face.uvPoints = face.uvPoints.map(normalizePoint);
  }
  faces.sort((left, right) => left.depth - right.depth);
  let motionMesh = null;
  if (motionWithinBudget && motionFaces.length) {
    motionMesh = { version: 1, vertices: motionVertices, vertexBones: motionVertexBones, faces: motionFaces,
      normalization: { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, scale } };
    if (new TextEncoder().encode(JSON.stringify(motionMesh)).byteLength > NATIVE_PREVIEW_MAX_MOTION_MESH_BYTES) motionMesh = null;
  }
  return {
    ok: true,
    scene: Object.freeze({ kind: 'horse', faces, textureSize: [textureWidth, textureHeight], camera,
      ...(options.retainMotionMesh === true ? motionMesh ? {
        motionMesh,
      } : { motionIssue: 'NATIVE_PREVIEW_MOTION_MESH_LIMIT_EXCEEDED' } : {}),
    }),
    stats: {
      boneCount: bones.length,
      cubeCount,
      faceCount: faces.length,
      planarCubeCount,
      ...(zeroAreaUvBoundsSkipped ? { zeroAreaUvBoundsSkipped } : {}),
      hiddenBoneCount: bones.filter((bone) => isHiddenBone(safeName(own(bone, 'name'), 256)) || own(bone, 'neverRender') === true).length,
    },
  };
}

/**
 * Bounded volumetric book approximation with imported pack pixels. The audited
 * Bedrock pack has no book geometry JSON: thickness, opening and camera are
 * explicitly preview choices, not reconstructed native renderer parameters.
 */
export function buildEnchantingBookPreviewScene(options = {}) {
  if (!record(options)) return null;
  const opening = options.openingDegrees === undefined ? 130 : options.openingDegrees;
  if (typeof opening !== 'number' || !Number.isFinite(opening) || opening < 0 || opening > 180) {
    return null;
  }
  const wing = (180 - opening) / 2;
  const surfaceUv = (x, y, width, height) => ({
    north: { uv: [x, y], uv_size: [width, height] },
    south: { uv: [x, y], uv_size: [width, height] },
    east: { uv: [x, y], uv_size: [0.5, height] },
    west: { uv: [x + width - 0.5, y], uv_size: [0.5, height] },
    up: { uv: [x, y], uv_size: [width, 0.5] },
    down: { uv: [x, y + height - 0.5], uv_size: [width, 0.5] },
  });
  // The inspected 64x32 pack atlas has page faces at u+1,11 and u+7,11;
  // u,10 and u+11,10 are unused black texels. Keep box-UV edge strips out of
  // the broad page faces instead of stretching those corners over the book.
  const pageUv = (u) => ({
    north: { uv: [u + 1, 11], uv_size: [5, 8] },
    south: { uv: [u + 7, 11], uv_size: [5, 8] },
    east: { uv: [u, 11], uv_size: [1, 8] },
    west: { uv: [u + 6, 11], uv_size: [1, 8] },
    up: { uv: [u + 1, 10], uv_size: [5, 1] },
    down: { uv: [u + 6, 10], uv_size: [5, 1] },
  });
  const part = (name, origin, size, rotation, uv, pivot = [0, 0, 0]) => ({
    name, pivot, rotation, cubes: [{ origin, size, uv }],
  });
  const geometry = {
    description: { texture_width: 64, texture_height: 32 },
    bones: [
      part('left_cover', [-6.1, -5, -0.35], [6, 10, 0.35], [0, -wing, 0], surfaceUv(0, 0, 6, 10)),
      part('right_cover', [0.1, -5, -0.35], [6, 10, 0.35], [0, wing, 0], surfaceUv(16, 0, 6, 10)),
      part('left_pages', [-5, -4, 0], [5, 8, 0.7], [0, -wing, 0], pageUv(0)),
      part('right_pages', [0, -4, 0], [5, 8, 0.7], [0, wing, 0], pageUv(12)),
      part('spine', [-0.3, -5, -0.65], [0.6, 10, 0.65], [0, 0, 0], surfaceUv(12, 0, 2, 10)),
      // Flat leaf faces occupy (24,10)/(29,10), not the page-block box UVs.
      // Those separate atlas regions preserve the original horizontal writing.
      // Two independent zero-thickness leaves use the original page atlas.
      // Moving these keeps the solid page bundles intact during page turns.
      part('left_leaf', [-5, -4, 0.82], [5, 8, 0], [0, -wing, 0], {
        north: { uv: [24, 10], uv_size: [5, 8] }, south: { uv: [29, 10], uv_size: [5, 8] },
      }),
      part('right_leaf', [0, -4, 0.82], [5, 8, 0], [0, wing, 0], {
        north: { uv: [24, 10], uv_size: [5, 8] }, south: { uv: [29, 10], uv_size: [5, 8] },
      }),
    ],
  };
  // At full closure the exterior covers occlude every page surface.
  // Omit hidden internals instead of allowing intersecting thin cubes to
  // paint a page outside the closed covers in the painter's algorithm.
  if (opening === 0) geometry.bones = geometry.bones.filter(bone => !/_pages$|_leaf$/.test(bone.name));
  const result = compileBedrockGeometryScene(geometry, {
    geometryFormatVersion: [1, 21, 0],
    camera: options.camera || { yaw: 0, pitch: 20 },
    retainMotionMesh: true,
    limits: { maxFaces: 36 },
  });
  if (!result.ok) return null;
  return Object.freeze({ ...result.scene, kind: 'book',
    approximation: 'built-in-book-shape-not-provided-by-pack',
    openingDegrees: opening,
    geometrySource: 'bounded-procedural-preview',
  });
}
