/*
  manifest-utils.js (S025)

  Helpers to parse and validate Minecraft Bedrock pack manifest.json.

  Notes:
  - This is intentionally a *minimal* validator for import-time checks.
  - It is tolerant to multiple manifest format versions (v1/v2 and v3 preview).
  - Later steps may extend validation and enforce stricter rules.
*/

/**
 * @typedef {{
 *  name: string|null,
 *  description: string|null,
 *  uuid: string|null,
 *  version: string|null,
 *  minEngineVersion: string|null,
 * }} ManifestHeaderSummary
 */

/**
 * @typedef {{
 *  formatVersion: string|number|null,
 *  header: ManifestHeaderSummary,
 *  moduleTypes: string[],
 *  isResourcePack: boolean,
 * }} ManifestSummary
 */

/**
 * @typedef {{
 *  ok: boolean,
 *  errors: { code: string, message: string }[],
 *  warnings: { code: string, message: string }[],
 *  isResourcePack: boolean,
 *  moduleTypes: string[],
 * }} ManifestValidation
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_ENGINE_VERSION_RE = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

/** @param {any} v */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @param {any} uuidLike
 * @returns {string|null}
 */
export function normalizeUuid(uuidLike) {
  if (typeof uuidLike === 'string') {
    const s = uuidLike.trim();
    return s ? s : null;
  }
  // Some schemas describe UUID as an object. Be tolerant if it contains a string.
  if (isPlainObject(uuidLike) && typeof uuidLike.value === 'string') {
    const s = String(uuidLike.value).trim();
    return s ? s : null;
  }
  return null;
}

/**
 * @param {any} versionLike
 * @returns {string|null}
 */
export function normalizeVersion(versionLike) {
  if (typeof versionLike === 'string') {
    const s = versionLike.trim();
    return s ? s : null;
  }
  if (Array.isArray(versionLike)) {
    const parts = versionLike.map((x) => Number(x));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return `${parts[0]}.${parts[1]}.${parts[2]}`;
    }
  }
  if (isPlainObject(versionLike)) {
    const major = Number(versionLike.major);
    const minor = Number(versionLike.minor);
    const patch = Number(versionLike.patch);
    if ([major, minor, patch].every((n) => Number.isFinite(n))) {
      return `${major}.${minor}.${patch}`;
    }
  }
  return null;
}

/**
 * `min_engine_version` controls version disambiguation, so lossy coercion is
 * unsafe here. Require exactly three canonical, nonnegative safe integers and
 * keep the more tolerant generic pack-version normalizer unchanged.
 *
 * @param {any} versionLike
 * @returns {string|null}
 */
function normalizeMinEngineVersion(versionLike) {
  if (typeof versionLike === 'string') {
    if (!CANONICAL_ENGINE_VERSION_RE.test(versionLike)) return null;
    const parts = versionLike.split('.').map(Number);
    return parts.every((part) => Number.isSafeInteger(part) && part >= 0)
      ? parts.join('.')
      : null;
  }
  if (!Array.isArray(versionLike) || versionLike.length !== 3) return null;
  const parts = [];
  try {
    const keys = Reflect.ownKeys(versionLike);
    if (keys.some((key) => typeof key !== 'string'
      || !['0', '1', '2', 'length'].includes(key))) return null;
    for (let index = 0; index < 3; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(versionLike, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      const part = descriptor.value;
      if (!Number.isSafeInteger(part) || part < 0) return null;
      parts.push(part);
    }
  } catch {
    return null;
  }
  return parts.join('.');
}

/**
 * Extract a compact summary for UI display.
 * @param {any} manifest
 * @returns {ManifestSummary}
 */
export function extractManifestSummary(manifest) {
  const m = isPlainObject(manifest) ? manifest : {};
  const header = isPlainObject(m.header) ? m.header : {};
  const modules = Array.isArray(m.modules) ? m.modules : [];

  const moduleTypes = modules
    .map((mod) => (isPlainObject(mod) ? mod.type : null))
    .filter((t) => typeof t === 'string')
    .map((t) => String(t));

  const isResourcePack = moduleTypes.some((t) => String(t).toLowerCase() === 'resources');

  return {
    formatVersion: m.format_version ?? null,
    header: {
      name: typeof header.name === 'string' ? header.name : null,
      description: typeof header.description === 'string' ? header.description : null,
      uuid: normalizeUuid(header.uuid),
      version: normalizeVersion(header.version),
      minEngineVersion: normalizeMinEngineVersion(header.min_engine_version),
    },
    moduleTypes,
    isResourcePack,
  };
}

/**
 * Minimal import-time manifest validation.
 *
 * @param {any} manifest
 * @returns {ManifestValidation}
 */
export function validateManifest(manifest) {
  /** @type {{ code: string, message: string }[]} */
  const errors = [];
  /** @type {{ code: string, message: string }[]} */
  const warnings = [];

  if (!isPlainObject(manifest)) {
    errors.push({ code: 'MANIFEST_NOT_OBJECT', message: 'manifest.json must be a JSON object.' });
    return {
      ok: false,
      errors,
      warnings,
      isResourcePack: false,
      moduleTypes: [],
    };
  }

  const header = isPlainObject(manifest.header) ? manifest.header : null;
  if (!header) {
    errors.push({ code: 'MANIFEST_MISSING_HEADER', message: 'manifest.json is missing "header".' });
  }

  const modules = Array.isArray(manifest.modules) ? manifest.modules : null;
  if (!modules || modules.length === 0) {
    errors.push({ code: 'MANIFEST_MISSING_MODULES', message: 'manifest.json is missing "modules" or it is empty.' });
  }

  if (header) {
    const uuid = normalizeUuid(header.uuid);
    if (!uuid) {
      errors.push({ code: 'MANIFEST_HEADER_UUID_MISSING', message: 'header.uuid is required.' });
    } else if (!UUID_RE.test(uuid)) {
      warnings.push({
        code: 'MANIFEST_HEADER_UUID_NOT_UUID',
        message: 'header.uuid does not look like a standard UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).',
      });
    }

    const version = normalizeVersion(header.version);
    if (!version) {
      errors.push({ code: 'MANIFEST_HEADER_VERSION_MISSING', message: 'header.version is required.' });
    }

    const minEngine = normalizeMinEngineVersion(header.min_engine_version);
    if (!minEngine) {
      // Keep import tolerance, but never let malformed version data silently
      // participate in native model version disambiguation.
      const missing = header.min_engine_version === undefined;
      warnings.push(missing
        ? { code: 'MANIFEST_MIN_ENGINE_VERSION_MISSING', message: 'header.min_engine_version is missing (recommended).' }
        : { code: 'MANIFEST_MIN_ENGINE_VERSION_INVALID', message: 'header.min_engine_version must contain exactly three nonnegative integer components.' });
    }
  }

  /** @type {string[]} */
  const moduleTypes = [];
  let resourceModuleCount = 0;

  if (modules) {
    for (let i = 0; i < modules.length; i += 1) {
      const mod = modules[i];
      if (!isPlainObject(mod)) {
        errors.push({ code: 'MANIFEST_MODULE_NOT_OBJECT', message: `modules[${i}] must be an object.` });
        continue;
      }
      const type = typeof mod.type === 'string' ? mod.type : null;
      const uuid = normalizeUuid(mod.uuid);
      const version = normalizeVersion(mod.version);

      if (!type) errors.push({ code: 'MANIFEST_MODULE_TYPE_MISSING', message: `modules[${i}].type is required.` });
      if (!uuid) errors.push({ code: 'MANIFEST_MODULE_UUID_MISSING', message: `modules[${i}].uuid is required.` });
      if (!version) errors.push({ code: 'MANIFEST_MODULE_VERSION_MISSING', message: `modules[${i}].version is required.` });

      if (type) {
        moduleTypes.push(type);
        if (String(type).toLowerCase() === 'resources') resourceModuleCount += 1;
      }

      if (uuid && !UUID_RE.test(uuid)) {
        warnings.push({
          code: 'MANIFEST_MODULE_UUID_NOT_UUID',
          message: `modules[${i}].uuid does not look like a standard UUID.`,
        });
      }
    }
  }

  if (modules && resourceModuleCount === 0) {
    errors.push({
      code: 'MANIFEST_NO_RESOURCES_MODULE',
      message: 'This manifest does not contain a "resources" module. Only Resource Packs are supported for UI editing.',
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    isResourcePack: resourceModuleCount > 0,
    moduleTypes,
  };
}
