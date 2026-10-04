/*
  validator.js (S039 + S054)

  Baseline validation for JSON UI editing.

  Goals (S039):
  - JSONC syntax is handled by parseJsonc (S019). This module validates the
    semantic structure after parsing.
  - Provide a machine-friendly list of errors/warnings.
  - Keep checks conservative to avoid false positives.

  S054 additions:
  - Reference/asset checks (textures/fonts/text keys/global variables) as WARNINGS.
  - Issues produced by these checks are tagged with originKind='reference'.
  - Missing-reference issues include refValue to enable aggregated reporting.

  Still out of scope:
  - Exhaustive Bedrock engine parity.
  - Full dependency graph across all JSON files.
*/

import { resolveFontTypeRef, resolveTextureRef } from '../assets/asset-indexer.js';
import { looksLikeLangKey } from '../assets/lang-table.js';
import { normalizePackPath } from '../path/normalize-pack-path.js';
import { describeNodeTextureValue } from '../model/texture-value.js';
import { isVisibleFromProps } from '../preview/canvas-preview.js';
import { knownUnsupportedPreviewProperties41, NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41 } from '../preview/native-property-diagnostics41.js';
import { nativeCollectionIndexContextRejected } from '../bindings/collection-context.js';
import {
  getNativeRendererPlaceholderKind,
  mergeNativeRendererProps,
  resolveNativeRendererTexture,
} from '../preview/native-renderer-preview.js';

/**
 * @typedef {'error'|'warn'} ValidationLevel
 */

/**
 * @typedef {{
 *  level: ValidationLevel,
 *  code: string,
 *  message: string,
 *  filePath: string,
 *  nodeId?: string,
 *  nodeKey?: string,
 *  propKey?: string,
 *  refValue?: string,
 *  originKind?: string,
 * }} ValidationIssue
 */

/**
 * @typedef {{
 *  ok: boolean,
 *  errorCount: number,
 *  warningCount: number,
 *  errors: ValidationIssue[],
 *  warnings: ValidationIssue[],
 *  issues: ValidationIssue[],
 *  signature: string,
 *  updatedAtIso: string,
 * }} ValidationResult
 */

/**
 * Optional context to enable reference checks (S054).
 *
 * All fields are optional; when a field is missing, the corresponding checks
 * are skipped (and a single explanatory warning may be emitted).
 *
 * @typedef {{
 *  importedIndex?: any | null,
 *  vanillaIndex?: any | null,
 *  langTable?: Record<string, string> | null,
 *  globalVarNames?: Set<string> | null,
 *  runtimeVarNames?: Set<string> | null,
 *  itemTextureAtlases?: { importedAtlas?: object|null, vanillaAtlas?: object|null, importedStatus?: string, vanillaStatus?: string, importedIssue?: string|null, vanillaIssue?: string|null, pending?: boolean } | null,
 *  nativeModelPreviews?: { bookTextureRef?: string, horse?: { status?: string, textureRef?: string, textureRefs?: string[], issue?: string|null } } | null,
 *  evaluatedPropsById?: Record<string, Record<string, unknown>> | null,
 *  nativeTextureFailures?: Record<string, string> | null,
 * }} ReferenceContext
 */

/**
 * @param {any} v
 */
function safeString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return String(v);
  } catch {
    return '[unprintable]';
  }
}

/**
 * Heuristic: Bedrock JSON UI frequently uses dynamic string references for values.
 * Examples:
 * - "$var" (local/global variable)
 * - "#binding" (binding name)
 * - "@hud.anim_..." (animation/control reference)
 *
 * These are valid in vanilla files but may not be fully evaluatable/previewable
 * in this editor. The validator should avoid flagging these as hard errors.
 *
 * @param {any} v
 */
function isDynamicRefString(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  // Bedrock JSON UI frequently uses dynamic references and small expression
  // strings, e.g.:
  //   "$some_var"
  //   "#binding_key"
  //   "@namespace.anim" or "@namespace.anim(0.2)"
  //   "(not $some_flag)"
  //
  // The editor preserves these values during round-trip serialization, but
  // cannot always evaluate/validate them. Treat them as dynamic so we emit a
  // warning instead of a hard error that would block export.
  return (
    s.startsWith('$') ||
    s.startsWith('#') ||
    s.startsWith('@') ||
    s.includes('$') ||
    s.includes('#') ||
    s.includes('@')
  );
}

/**
 * @param {any} v
 * @param {number} [maxLen]
 */
function describeValue(v, maxLen = 160) {
  const t = (v === null) ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  let s = '';
  try {
    s = JSON.stringify(v);
  } catch {
    s = safeString(v);
  }
  if (typeof s !== 'string') s = safeString(s);
  if (s.length > maxLen) s = `${s.slice(0, Math.max(0, maxLen - 3))}...`;
  return `${t} ${s}`;
}

/**
 * @param {ValidationIssue[]} issues
 */
function makeSignature(issues) {
  // Keep the signature stable and small. Used for de-dupe (e.g., log-on-change).
  return issues
    .map((i) => {
      const parts = [
        i.level,
        i.code,
        i.filePath,
        i.nodeId || '',
        i.propKey || '',
        i.refValue || '',
        i.originKind || '',
      ];
      return parts.join('|');
    })
    .sort()
    .join('\n');
}

/**
 * @param {ValidationIssue[]} issues
 * @returns {ValidationResult}
 */
function finalize(issues) {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warn');
  const sig = makeSignature(issues);
  return {
    ok: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    issues,
    signature: sig,
    updatedAtIso: new Date().toISOString(),
  };
}

const GLOBAL_VAR_REF_RE = /^\$[A-Za-z0-9_.]+$/;
const MAX_NATIVE_RUNTIME_NAME_BUCKETS = 64;
const MAX_NATIVE_RUNTIME_NAMES_IN_MESSAGE = 8;
const MAX_NATIVE_RUNTIME_NAME_LENGTH = 96;

/**
 * Native renderer/factory identifiers originate in pack JSON and can be both
 * numerous and arbitrarily long. Keep diagnostic aggregation deterministic
 * and bounded without hiding the total number of affected controls.
 *
 * @param {any} value
 * @param {string} fallback
 */
function boundedRuntimeName(value, fallback) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return fallback;
  if (raw.length <= MAX_NATIVE_RUNTIME_NAME_LENGTH) return raw;
  return `${raw.slice(0, MAX_NATIVE_RUNTIME_NAME_LENGTH - 1)}\u2026`;
}

/**
 * Read an own data property without invoking accessors inherited from unusual
 * objects. Parsed JSON cannot contain accessors, but the validator is also a
 * public pure-logic API and should fail closed for hostile callers.
 *
 * @param {any} record
 * @param {string} key
 */
function readOwnDataValue(record, key) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the same shallow effective-property shape consumed by the preview's
 * native renderer adapters, while copying data properties only.
 *
 * @param {import('../model/ui-screen-model.js').UiNode} node
 */
function nativeRendererPropsForNode(node, evaluatedProps = null) {
  return mergeNativeRendererProps(node?.unknownProps, node?.props, evaluatedProps);
}

function hasRuntimePropertyOverride(value, propertyName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bindings = readOwnDataValue(value, 'bindings');
  if (!Array.isArray(bindings)) return bindings !== undefined;
  const expected = String(propertyName || '').replace(/^#/u, '').toLowerCase();
  return bindings.some((binding) => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)
      || readOwnDataValue(binding, 'ignored') === true) return false;
    return [
      readOwnDataValue(binding, 'binding_name_override'),
      readOwnDataValue(binding, 'target_property_name'),
      readOwnDataValue(binding, 'binding_name'),
    ].some((candidate) => typeof candidate === 'string'
      && candidate.trim().replace(/^#/u, '').toLowerCase() === expected);
  });
}

/**
 * Walk a JSON-like value and extract reference-like strings.
 *
 * Notes:
 * - This is a best-effort heuristic, aligned to the export dependency scanner
 *   used in main.js.
 * - It intentionally avoids binding-expression parsing (no Molang parity).
 *
 * @param {any} value
 * @param {{
 *  outTextureRefs: Set<string>,
 *  outFontRefs: Set<string>,
 *  outLangKeys: Set<string>,
 *  outVarRefs: Set<string>,
 *  outVarDeclarations: Set<string>,
 * }} out
 * @param {number} [depth]
 */
function scanJsonForReferenceDeps(value, out, depth = 0) {
  if (depth > 2000) return;
  if (typeof value === 'string') {
    // Values can be direct refs, array leaves, or Bedrock expression strings.
    // Extract tokens conservatively without claiming full expression parsing.
    for (const match of value.matchAll(/\$[A-Za-z0-9_.]+/g)) out.outVarRefs.add(match[0]);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scanJsonForReferenceDeps(item, out, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const localize = Boolean(value.localize);
  const skipInactiveControls = readOwnDataValue(value, 'ignored') === true
    && !hasRuntimePropertyOverride(value, 'ignored');
  for (const [k, child] of Object.entries(value)) {
    if (k === 'controls' && skipInactiveControls) continue;
    if (String(k).startsWith('$') && String(k) !== '$schema') {
      const declaredName = String(k).split('|')[0];
      if (GLOBAL_VAR_REF_RE.test(declaredName)) out.outVarDeclarations.add(declaredName);
    }
    if (typeof child === 'string') {
      const s = child.trim();
      if (s) {
        const keyLower = String(k).toLowerCase();
        // #binding and $variable values are not asset paths. They must be
        // resolved first; looking them up literally produces false missing
        // texture warnings for controller icons and close-button templates.
        const symbolicAsset = /^[#$@]/.test(s) || (s.startsWith('(') && s.endsWith(')'));
        if (keyLower.endsWith('texture') && !symbolicAsset) out.outTextureRefs.add(s);
        if (keyLower === 'font_type' && !symbolicAsset) out.outFontRefs.add(s);
        if (keyLower === 'text' && localize && looksLikeLangKey(s)) out.outLangKeys.add(s);
        if (s.startsWith('$') && GLOBAL_VAR_REF_RE.test(s)) out.outVarRefs.add(s);
      }
    }
    scanJsonForReferenceDeps(child, out, depth + 1);
  }
}

/**
 * Baseline UI screen file validation.
 *
 * NOTE: This validator operates on the internal UiScreenModel, not raw JSON.
 *
 * Design notes:
 * - Missing/invalid root namespace is treated as an ERROR because export would
 *   produce a likely-invalid file.
 * - Unsupported element types are WARNINGS (the editor can preserve them but
 *   may not fully preview/edit them).
 * - Invalid known property values (propsPresent && !propsValid) are ERRORS.
 *
 * @param {import('../model/ui-screen-model.js').UiScreenModel} model
 * @param {{ filePath?: string, supportedTypes?: string[], referenceContext?: ReferenceContext, sourceJson?: any }} [opts]
 * @returns {ValidationResult}
 */
export function validateUiScreenModel(model, opts = {}) {
  const filePath = safeString(opts.filePath || model?.filePath || '(unknown file)');
  const supportedTypes = Array.isArray(opts.supportedTypes) && opts.supportedTypes.length
    ? opts.supportedTypes.map((s) => safeString(s)).filter(Boolean)
    : [];

  /** @type {ValidationIssue[]} */
  const issues = [];

  /** @type {Set<string>} */
  const dedup = new Set();
  const refCtx = opts.referenceContext || null;
  const nativeTextureDepsByRef = new Map();
  const nativeTextureIsResolvable = (textureRef) => {
    if (typeof textureRef !== 'string' || !textureRef) return false;
    const importedIndex = readOwnDataValue(refCtx, 'importedIndex');
    const vanillaIndex = readOwnDataValue(refCtx, 'vanillaIndex');
    if (!importedIndex && !vanillaIndex) return false;
    try {
      const resolved = resolveTextureRef(textureRef, { importedIndex, vanillaIndex });
      if (!resolved.resolved || resolved.collision) return false;
      const failureTable = readOwnDataValue(refCtx, 'nativeTextureFailures');
      const cacheKey = `${safeString(resolved.resolved.source)}:${safeString(resolved.resolved.packPath)}`;
      return !readOwnDataValue(failureTable, cacheKey);
    } catch {
      return false;
    }
  };

  const dynamic = {
    /** @type {Map<string, {count: number, examples: Array<{nodeKey: string, value: any}>}>} */
    props: new Map(),
    /** @type {{count: number, examples: Array<{nodeKey: string, value: any}>}} */
    bindings: { count: 0, examples: [] },
    /** @type {{count: number, examples: Array<{nodeKey: string, value: any}>}} */
    controls: { count: 0, examples: [] },
  };

  const nativeRuntime = {
    customRenderers: {
      /** @type {Map<string, number>} */
      counts: new Map(),
      total: 0,
      overflowCount: 0,
    },
    surrogateRenderers: {
      /** @type {Map<string, number>} */
      counts: new Map(),
      total: 0,
      overflowCount: 0,
    },
    staticResourceRenderers: {
      /** @type {Map<string, number>} */
      counts: new Map(),
      total: 0,
      overflowCount: 0,
    },
    factories: {
      /** @type {Map<string, number>} */
      counts: new Map(),
      total: 0,
      overflowCount: 0,
    },
  };
  const nativeModelIssues = new Set();
  const nativeAtlasIssues = new Set();
  const nativeRendererIssues = new Set();
  let nativeReferenceContextPending = false;
  let nativePropertyWarnings = 0;
  const evaluatedTextureMetaByRef = new Map();
  const evaluatedFontMetaByRef = new Map();
  const evaluatedLangMetaByKey = new Map();

  function recordEvaluatedReferences(node, evaluatedProps, inactive) {
    if (inactive || !evaluatedProps || typeof evaluatedProps !== 'object' || Array.isArray(evaluatedProps)) return;
    const nodeId = safeString(node?.id || '');
    const nodeKey = safeString(node?.key && typeof node.key === 'object' ? node.key.raw : '');
    const localize = readOwnDataValue(evaluatedProps, 'localize') === true;
    let keys = [];
    try {
      keys = Object.keys(evaluatedProps).slice(0, 1024);
    } catch {
      return;
    }
    for (const key of keys) {
      const value = readOwnDataValue(evaluatedProps, key);
      if (typeof value !== 'string') continue;
      const ref = value.trim();
      if (!ref) continue;
      const symbolic = isDynamicRefString(ref) || (ref.startsWith('(') && ref.endsWith(')'));
      const lower = key.toLowerCase();
      const meta = { nodeId, nodeKey, propKey: key, originKind: 'evaluated-reference' };
      if (lower.endsWith('texture') && !symbolic && !evaluatedTextureMetaByRef.has(ref)) {
        evaluatedTextureMetaByRef.set(ref, meta);
      }
      if (lower === 'font_type' && !symbolic && !evaluatedFontMetaByRef.has(ref)) {
        evaluatedFontMetaByRef.set(ref, meta);
      }
      if (lower === 'text' && localize && looksLikeLangKey(ref) && !evaluatedLangMetaByKey.has(ref)) {
        evaluatedLangMetaByKey.set(ref, meta);
      }
    }
  }

  /**
   * @param {{counts: Map<string, number>, total: number, overflowCount: number}} bucket
   * @param {string} name
   */
  function recordNativeRuntime(bucket, name) {
    bucket.total += 1;
    if (bucket.counts.has(name)) {
      bucket.counts.set(name, (bucket.counts.get(name) || 0) + 1);
      return;
    }
    if (bucket.counts.size >= MAX_NATIVE_RUNTIME_NAME_BUCKETS) {
      bucket.overflowCount += 1;
      return;
    }
    bucket.counts.set(name, 1);
  }

  /**
   * @param {{counts: Map<string, number>, total: number, overflowCount: number}} bucket
   * @param {string} noun
   */
  function describeNativeRuntimeBucket(bucket, noun) {
    const rows = Array.from(bucket.counts.entries())
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    const shown = rows.slice(0, MAX_NATIVE_RUNTIME_NAMES_IN_MESSAGE);
    let message = `Count: ${bucket.total}. ${noun}: ${shown.map(([name, count]) => `${JSON.stringify(name)}=${count}`).join(', ')}.`;
    if (rows.length > shown.length) {
      message += ` Showing ${shown.length} of ${rows.length} recorded names.`;
    }
    if (bucket.overflowCount > 0) {
      message += ` ${bucket.overflowCount} additional control${bucket.overflowCount === 1 ? '' : 's'} exceeded the ${MAX_NATIVE_RUNTIME_NAME_BUCKETS}-name aggregation bound.`;
    }
    return message;
  }

  /**
   * @param {'props'|'bindings'|'controls'} bucket
   * @param {string} key
   * @param {string} nodeKey
   * @param {any} value
   */
  function recordDynamic(bucket, key, nodeKey, value) {
    if (!nodeKey) return;
    if (bucket === 'props') {
      const k = safeString(key);
      if (!k) return;
      if (!dynamic.props.has(k)) dynamic.props.set(k, { count: 0, examples: [] });
      const entry = dynamic.props.get(k);
      entry.count += 1;
      if (entry.examples.length < 4) entry.examples.push({ nodeKey, value });
      return;
    }

    const target = bucket === 'bindings' ? dynamic.bindings : dynamic.controls;
    target.count += 1;
    if (target.examples.length < 4) target.examples.push({ nodeKey, value });
  }

  /**
   * @param {ValidationLevel} level
   * @param {string} code
   * @param {string} message
   * @param {Partial<ValidationIssue>} [meta]
   */
  function push(level, code, message, meta = {}) {
    const nodeKey = safeString(meta.nodeKey || '');
    const propKey = safeString(meta.propKey || '');
    const refValue = safeString(meta.refValue || '');
    const originKind = safeString(meta.originKind || '');

    // De-dupe to avoid extremely noisy outputs for template-heavy vanilla UI.
    // - If we have a nodeKey or propKey, treat identical (level+code+nodeKey+propKey) as duplicates.
    // - If not, include message so distinct file-level issues are not collapsed.
    const dedupKey = originKind === 'native-property'
      ? `${level}|${code}|${safeString(meta.nodeId || '')}|${nodeKey}|${propKey}`
      : (nodeKey || propKey || refValue)
      ? `${level}|${code}|${nodeKey}|${propKey}|${refValue}|${originKind}`
      : `${level}|${code}|${safeString(message)}`;

    if (dedup.has(dedupKey)) return;
    dedup.add(dedupKey);

    issues.push({
      level,
      code,
      message,
      filePath,
      nodeId: meta.nodeId,
      nodeKey,
      propKey,
      refValue,
      originKind,
    });
  }

  if (!model || typeof model !== 'object') {
    push('error', 'MODEL_MISSING', 'No model provided (null/undefined).');
    return finalize(issues);
  }

  // Required key: namespace (based on Bedrock JSON UI screen file structure).
  const ns = safeString(model.namespace || '').trim();
  if (!ns) {
    push('error', 'SCREEN_NAMESPACE_MISSING', 'Missing or invalid root "namespace" (expected non-empty string).');
  }

  // Structural health warnings from model-building limits.
  const stats = model.stats || null;
  if (stats && stats.truncated) {
    push('warn', 'MODEL_TRUNCATED', `Model was truncated during parse (max nodes/depth). Reason: ${safeString(stats.truncateReason || 'UNKNOWN')}`);
  }
  if (stats && safeString(stats.truncateReason).toLowerCase().includes('root json is not an object')) {
    push('error', 'SCREEN_ROOT_NOT_OBJECT', 'Root JSON is not an object.');
  }

  // Unknown root fields: allow $schema/format_version; warn on others.
  const unknownFields = (model.unknownFields && typeof model.unknownFields === 'object') ? model.unknownFields : {};
  for (const k of Object.keys(unknownFields)) {
    if (k === '$schema' || k === 'format_version') continue;
    if (k === '__raw') continue;
    push('warn', 'UNKNOWN_ROOT_FIELD', `Unknown root field preserved: ${k}`);
  }

  const root = model.root || null;

  /**
   * @param {import('../model/ui-screen-model.js').UiNode} node
   */
  function validateNode(node, inactiveAncestor = false, explicitlyIgnored = false, textureVisibility = 'visible', parentType = undefined) {
    if (!node || typeof node !== 'object') return;

    const nodeId = safeString(node.id || '');
    const nodeKey = safeString(node.key && typeof node.key === 'object' ? node.key.raw : '');
    const originKind = safeString(node.origin && typeof node.origin === 'object' ? node.origin.kind : '');

    // Origin shape warnings: some shapes are preserved but not editable.
    if (originKind === 'inline') {
      push(
        'warn',
        'CONTROL_INLINE_UNEDITABLE',
        'Inline control entry detected. This editor preserves it but may not serialize edits to that control.',
        { nodeId, nodeKey, originKind }
      );
    }
    if (originKind === 'string') {
      push(
        'warn',
        'CONTROL_STRING_REFERENCE',
        'String control reference detected. This editor does not expand referenced templates yet.',
        { nodeId, nodeKey, originKind }
      );
    }
    if (originKind === 'raw') {
      push(
        'error',
        'CONTROL_RAW_ENTRY',
        'Invalid control entry shape detected (non-object/non-string).',
        { nodeId, nodeKey, originKind }
      );
    }
    if (originKind === 'truncated') {
      push(
        'warn',
        'CONTROL_TRUNCATED',
        'Control entry was truncated due to model limits; edits may not be preserved.',
        { nodeId, nodeKey, originKind }
      );
    }

    // Supported type checks.
    const type = safeString(node.type || '').trim();
    // A permissive importer retains future properties, while observed native
    // rejections must still be visible to JSON/SVG validation. Presence is the
    // incompatibility: a false value does not make an unsupported field valid.
    // Skip only structurally ignored branches, not merely hidden controls.
    if (!inactiveAncestor && !explicitlyIgnored) {
      const evaluatedProps = readOwnDataValue(readOwnDataValue(refCtx, 'evaluatedPropsById'), nodeId);
      const properties = new Set([node.unknownProps, node.props, evaluatedProps]
        .flatMap(props => knownUnsupportedPreviewProperties41(type, props)));
      // A standalone template has no concrete instantiation parent yet. For
      // actual nested controls the supplied Expedition log proves that a
      // decorative parent cannot accept an authored collection row index.
      if (typeof parentType === 'string' && parentType.trim()) {
        const indexedProps = {};
        for (const source of [node.unknownProps, node.props, evaluatedProps]) {
          for (const property of ['collection_index', '__jsonui_preview_collection_name']) {
            if (source && typeof source === 'object' && Object.hasOwn(source, property)) {
              indexedProps[property] = readOwnDataValue(source, property);
            }
          }
        }
        if (nativeCollectionIndexContextRejected({ props: indexedProps, parentType })) {
          properties.add('collection_index');
        }
      }
      for (const property of properties) {
        if (nativePropertyWarnings < NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41) {
          push('warn', 'NATIVE_PROPERTY_UNSUPPORTED',
            `The supplied native Content Log rejects ${property} on ${type}${property === 'collection_index' ? ` below ${parentType}` : ''}; the declaration is preserved and is not proof of native equivalence.`,
            { nodeId, nodeKey, propKey: property, originKind: 'native-property' });
        } else if (nativePropertyWarnings === NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41) {
          push('warn', 'NATIVE_PROPERTY_DIAGNOSTIC_LIMIT',
            `Native property diagnostics exceeded ${NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41} entries; observation is incomplete.`,
            { originKind: 'native-property' });
        }
        nativePropertyWarnings++;
      }
    }
    if (type && supportedTypes.length && !supportedTypes.includes(type)) {
      push(
        'warn',
        'TYPE_UNSUPPORTED',
        `Element type is not supported by the GUI editor yet: ${type}`,
        { nodeId, nodeKey, originKind }
      );
    }

    // `custom` and `factory` are valid Bedrock JSON UI element types, but
    // validity does not imply that their runtime pixels/instances are
    // available to this standalone preview. Suppress the old per-node
    // TYPE_UNSUPPORTED noise when callers pass the valid type set, while
    // retaining one bounded capability warning for controls we cannot adapt.
    if (type === 'custom' && !inactiveAncestor && !explicitlyIgnored) {
      const evaluatedPropsById = readOwnDataValue(refCtx, 'evaluatedPropsById');
      const evaluatedProps = readOwnDataValue(evaluatedPropsById, nodeId);
      const rendererProps = nativeRendererPropsForNode(node, evaluatedProps);
      if (!rendererProps) nativeModelIssues.add('NATIVE_PREVIEW_PROPERTY_LIMIT_EXCEEDED');
      const rendererName = boundedRuntimeName(
        readOwnDataValue(rendererProps, 'renderer'),
        '<missing or inherited renderer>'
      );
      const atlasContext = readOwnDataValue(refCtx, 'itemTextureAtlases');
      const atlasPending = readOwnDataValue(atlasContext, 'pending') === true;
      const nativeTextureResolution = resolveNativeRendererTexture(rendererProps, atlasContext || {});
      const effectiveTextureRef = nativeTextureResolution?.status === 'resolved'
        ? nativeTextureResolution.textureRef
        : null;
      // `unresolved` still means the inventory adapter recognized and safely
      // rejected a concrete renderer input. Its specific capability warning
      // is more useful than an additional generic custom-renderer warning.
      const hasTextureAdapter = ['resolved', 'pending', 'blocked', 'unresolved'].includes(nativeTextureResolution?.status);
      if (nativeTextureResolution?.status === 'pending') nativeReferenceContextPending = true;
      if (nativeTextureResolution?.status === 'blocked') {
        const issue = nativeTextureResolution.issue;
        if (typeof issue === 'string' && issue) nativeAtlasIssues.add(issue);
      } else if (nativeTextureResolution?.status === 'unresolved') {
        const issue = nativeTextureResolution.issue;
        if (typeof issue === 'string' && issue) nativeRendererIssues.add(issue);
      }
      if (effectiveTextureRef && !nativeTextureDepsByRef.has(effectiveTextureRef)) {
        nativeTextureDepsByRef.set(effectiveTextureRef, { nodeId, nodeKey });
      }
      const placeholderKind = getNativeRendererPlaceholderKind(rendererProps);
      const nativeModelContext = readOwnDataValue(refCtx, 'nativeModelPreviews');
      let hasStaticResourcePreview = false;
      if (rendererName === 'enchanting_book_renderer') {
        const bookTextureRef = readOwnDataValue(nativeModelContext, 'bookTextureRef');
        if (typeof bookTextureRef === 'string' && bookTextureRef) {
          nativeTextureDepsByRef.set(bookTextureRef, { nodeId, nodeKey });
          hasStaticResourcePreview = nativeTextureIsResolvable(bookTextureRef);
        }
      } else if (rendererName === 'live_horse_renderer' || rendererName === 'live_player_renderer') {
        const horseContext = readOwnDataValue(nativeModelContext, rendererName === 'live_player_renderer' ? 'player' : 'horse');
        const horseStatus = readOwnDataValue(horseContext, 'status');
        const horseTextureRef = readOwnDataValue(horseContext, 'textureRef');
        const horseTextureRefs = readOwnDataValue(horseContext, 'textureRefs');
        const horseIssue = readOwnDataValue(horseContext, 'issue');
        if (horseStatus === 'loading' || horseStatus === 'idle') nativeReferenceContextPending = true;
        const requiredHorseTextures = Array.isArray(horseTextureRefs) && horseTextureRefs.length
          ? horseTextureRefs.filter((ref) => typeof ref === 'string' && ref)
          : typeof horseTextureRef === 'string' && horseTextureRef ? [horseTextureRef] : [];
        if (horseStatus === 'ready' && requiredHorseTextures.length) {
          for (const requiredRef of requiredHorseTextures) {
            nativeTextureDepsByRef.set(requiredRef, { nodeId, nodeKey });
          }
          hasStaticResourcePreview = requiredHorseTextures.every(nativeTextureIsResolvable);
        } else if (horseStatus === 'missing' || horseStatus === 'invalid') {
          nativeModelIssues.add(typeof horseIssue === 'string' && horseIssue ? horseIssue : 'NATIVE_PREVIEW_MODEL_INVALID');
        }
      }
      if (hasStaticResourcePreview) {
        recordNativeRuntime(nativeRuntime.staticResourceRenderers, rendererName);
      } else if (placeholderKind === 'banner-pattern') {
        recordNativeRuntime(nativeRuntime.surrogateRenderers, rendererName);
      } else if (placeholderKind === 'enchanting-book' || placeholderKind === 'horse-entity' || placeholderKind === 'player-entity') {
        // These renderers have resource-backed model adapters. Missing or
        // pending resources are diagnosed above; never reclassify them as a
        // generic runtime renderer or claim that a silhouette was rendered.
      } else if (!hasTextureAdapter || (!atlasPending && nativeTextureResolution?.status === 'resolved' && !effectiveTextureRef)) {
        recordNativeRuntime(nativeRuntime.customRenderers, rendererName);
      }
    }

    const factoryProperty = readOwnDataValue(node.unknownProps, 'factory');
    const hasFactoryProperty = factoryProperty !== undefined && factoryProperty !== null && factoryProperty !== false;
    if ((type === 'factory' || hasFactoryProperty) && !inactiveAncestor && !explicitlyIgnored) {
      const propertyName = factoryProperty && typeof factoryProperty === 'object'
        ? readOwnDataValue(factoryProperty, 'name')
        : factoryProperty;
      const declaredName = propertyName || readOwnDataValue(node.unknownProps, 'name');
      const localName = node.key && typeof node.key === 'object'
        ? readOwnDataValue(node.key, 'local_name')
        : undefined;
      const factoryName = boundedRuntimeName(
        declaredName || localName,
        '<unnamed factory>'
      );
      recordNativeRuntime(nativeRuntime.factories, factoryName);
    }
    if (!type) {
      // Missing type is very common in vanilla files when using inheritance/templating.
      // Suppress noise when the control key indicates an inherited/template entry.
      const baseRef = safeString(node.key && typeof node.key === 'object' ? node.key.base_ref : '').trim();
      const hasInheritance = Boolean(baseRef);
      if (!hasInheritance && !explicitlyIgnored && !inactiveAncestor && originKind !== 'string' && originKind !== 'raw') {
        push(
          'warn',
          'TYPE_MISSING',
          'Element is missing a "type" property (preview/editing may be limited).',
          { nodeId, nodeKey, originKind }
        );
      }
    }

    // Controls field must be array or object-map; invalid types are errors.
    if (node.controlsPresent) {
      const unknownProps = (node.unknownProps && typeof node.unknownProps === 'object') ? node.unknownProps : {};
      if (Object.prototype.hasOwnProperty.call(unknownProps, 'controls')) {
        const raw = unknownProps.controls;
        if (isDynamicRefString(raw)) {
          recordDynamic('controls', 'controls', nodeKey, raw);
        } else {
          push(
            'error',
            'CONTROLS_INVALID',
            `Invalid "controls" value (expected array or object). Raw: ${describeValue(raw)}`,
            { nodeId, nodeKey, originKind }
          );
        }
      }
    }

    // Bindings field must be an array.
    if (node.bindingsPresent) {
      const unknownProps = (node.unknownProps && typeof node.unknownProps === 'object') ? node.unknownProps : {};
      if (Object.prototype.hasOwnProperty.call(unknownProps, 'bindings')) {
        const raw = unknownProps.bindings;
        if (isDynamicRefString(raw)) {
          recordDynamic('bindings', 'bindings', nodeKey, raw);
        } else {
          push(
            'error',
            'BINDINGS_INVALID',
            `Invalid "bindings" value (expected array). Raw: ${describeValue(raw)}`,
            { nodeId, nodeKey, originKind }
          );
        }
      }
    }

    // Known prop type checks: propsPresent && !propsValid => error.
    const propsPresent = (node.propsPresent && typeof node.propsPresent === 'object') ? node.propsPresent : {};
    const propsValid = (node.propsValid && typeof node.propsValid === 'object') ? node.propsValid : {};
    const unknownProps = (node.unknownProps && typeof node.unknownProps === 'object') ? node.unknownProps : {};
    for (const k of Object.keys(propsPresent)) {
      if (!propsPresent[k]) continue;
      if (propsValid[k] === false) {
        const raw = unknownProps[k];
        if (k === 'texture') {
          const { authored } = describeNodeTextureValue(node);
          push('error', authored.state === 'invalid-type' ? 'TEXTURE_TYPE_INVALID' : 'TEXTURE_WHITESPACE_INVALID',
            authored.state === 'invalid-type'
              ? `Texture must be a string under the renderer contract; the authored ${authored.valueType} value was preserved without coercion.`
              : 'A whitespace-only texture is not an empty texture or a named asset reference.',
            { nodeId, nodeKey, propKey: k, originKind });
          continue;
        }
        if (isDynamicRefString(raw)) {
          recordDynamic('props', k, nodeKey, raw);
          continue;
        }
        push(
          'error',
          'PROP_INVALID',
          `Invalid value for property: ${k}. Raw: ${describeValue(raw)}`,
          { nodeId, nodeKey, propKey: k, originKind }
        );
      }
    }
    // Authored and evaluated validity are independent. Runtime bindings cannot
    // make an invalid authored type valid or silently coerce a new invalid type.
    const evaluatedProps = readOwnDataValue(readOwnDataValue(refCtx, 'evaluatedPropsById'), nodeId);
    const texture = describeNodeTextureValue(node, evaluatedProps);
    if (texture.evaluation === 'runtime-override' && ['invalid-type', 'whitespace'].includes(texture.evaluated.state)) {
      push('error', texture.evaluated.state === 'invalid-type' ? 'TEXTURE_EVALUATED_TYPE_INVALID' : 'TEXTURE_EVALUATED_WHITESPACE_INVALID',
        'The evaluated texture is not a supported string asset reference; the authored value was not changed.',
        { nodeId, nodeKey, propKey: 'texture', originKind: 'evaluated-reference' });
    }
    if (type === 'image' && textureVisibility !== 'hidden'
      && !['invalid-type', 'whitespace'].includes(texture.authored.state)
      && !['invalid-type', 'whitespace'].includes(texture.evaluated.state)) {
      const code = textureVisibility === 'unknown' ? 'TEXTURE_STATE_UNVERIFIED'
        : texture.evaluated.state === 'empty' ? 'TEXTURE_EMPTY_UNVERIFIED'
          : texture.evaluated.state === 'absent' ? 'TEXTURE_ABSENT_UNVERIFIED'
            : texture.evaluated.state === 'unresolved' ? 'TEXTURE_UNRESOLVED' : null;
      if (code) push('warn', code,
        'Image state or texture is not resolved for this snapshot. Structural validity does not establish complete pixels or Minecraft parity.',
        { nodeId, nodeKey, propKey: 'texture', originKind: 'frame-requirement' });
    }
  }

  if (!root || typeof root !== 'object' || !Array.isArray(root.children)) {
    push('error', 'MODEL_ROOT_INVALID', 'Model root node is missing or invalid.');
    return finalize(issues);
  }

  /**
   * @param {import('../model/ui-screen-model.js').UiNode} node
   * @param {number} depth
   */
  function walkNode(node, depth, inactiveAncestor = false, textureAncestorVisibility = 'visible', parentType = undefined) {
    if (!node || typeof node !== 'object') return;
    if (depth > 2000) return; // hard stop for safety
    const nodeId = safeString(node.id || '');
    const evaluatedPropsById = readOwnDataValue(refCtx, 'evaluatedPropsById');
    const evaluatedProps = readOwnDataValue(evaluatedPropsById, nodeId);
    const evaluatedIgnored = readOwnDataValue(evaluatedProps, 'ignored');
    const authoredIgnored = readOwnDataValue(node.props, 'ignored');
    const hasEvaluatedIgnored = evaluatedProps && typeof evaluatedProps === 'object'
      && Object.prototype.hasOwnProperty.call(evaluatedProps, 'ignored');
    const explicitlyIgnored = hasEvaluatedIgnored ? evaluatedIgnored === true : authoredIgnored === true;
    const structurallyIgnored = inactiveAncestor || explicitlyIgnored;
    const visibilityProps = {};
    for (const property of ['visible', 'ignored']) {
      visibilityProps[property] = Object.prototype.hasOwnProperty.call(evaluatedProps || {}, property)
        ? readOwnDataValue(evaluatedProps, property)
        : node.propsValid?.[property] === false ? readOwnDataValue(node.unknownProps, property)
          : readOwnDataValue(node.props, property);
    }
    const localVisibility = isVisibleFromProps(visibilityProps, { mode: 'safe' }) ? 'visible'
      : isVisibleFromProps(visibilityProps, { mode: 'structure' }) ? 'unknown' : 'hidden';
    const textureVisibility = textureAncestorVisibility === 'hidden' || localVisibility === 'hidden' ? 'hidden'
      : textureAncestorVisibility === 'unknown' || localVisibility === 'unknown' ? 'unknown' : 'visible';
    validateNode(node, inactiveAncestor, explicitlyIgnored, textureVisibility, parentType);
    recordEvaluatedReferences(node, evaluatedProps, structurallyIgnored);
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      walkNode(child, depth + 1, structurallyIgnored, textureVisibility, node.type);
    }
  }

  for (const child of root.children) {
    walkNode(child, 1);
  }

  if (nativeRuntime.customRenderers.total > 0) {
    push(
      'warn',
      'CUSTOM_RENDERER_RUNTIME_DEPENDENT',
      `Native custom renderer output has no matching bounded preview adapter and may differ from Minecraft runtime output. ${describeNativeRuntimeBucket(nativeRuntime.customRenderers, 'Renderers')}`,
      { originKind: 'native-runtime' }
    );
  }

  if (nativeRuntime.surrogateRenderers.total > 0) {
    push(
      'warn',
      'CUSTOM_RENDERER_SURROGATE',
      `Native custom renderer output is shown as a bounded neutral surrogate, not live Minecraft runtime pixels. ${describeNativeRuntimeBucket(nativeRuntime.surrogateRenderers, 'Renderers')}`,
      { originKind: 'native-runtime' }
    );
  }

  if (nativeRuntime.staticResourceRenderers.total > 0) {
    push(
      'warn',
      'CUSTOM_RENDERER_STATIC_RESOURCE_PREVIEW',
      `Native custom renderer output uses a bounded resource-pack-backed 3D snapshot with optional preview motion; native game animation, account skins and live entity state are not reproduced. ${describeNativeRuntimeBucket(nativeRuntime.staticResourceRenderers, 'Renderers')}`,
      { originKind: 'native-runtime' }
    );
  }

  for (const issue of Array.from(nativeModelIssues).sort()) {
    push(
      'warn',
      issue,
      `The resource-backed native model preview could not be resolved safely (${issue}); no replacement model was fabricated and the renderer is shown as missing.`,
      { originKind: 'native-runtime' }
    );
  }

  for (const issue of Array.from(nativeAtlasIssues).sort()) {
    push(
      'warn',
      issue,
      `The applicable item texture atlas could not be used safely (${issue}); no lower-priority texture was substituted.`,
      { originKind: 'native-renderer-reference' }
    );
  }

  for (const issue of Array.from(nativeRendererIssues).sort()) {
    const message = issue === 'NATIVE_PREVIEW_ITEM_ID_UNSUPPORTED'
      ? 'The native inventory item id is structurally valid but is outside the bounded, versioned preview registry; it was not mislabeled as a missing texture.'
      : issue === 'NATIVE_PREVIEW_ITEM_ID_INVALID'
        ? 'The native inventory item id is malformed or ambiguous; no texture lookup was attempted.'
        : issue === 'NATIVE_ITEM_MODEL_REQUIRED'
          ? 'This inventory item requires native model rendering. A block-face or entity UV texture is not a finished item icon and was not drawn as one. An explicit item icon can supply a sprite preview; Minecraft pixel parity remains unverified.'
          : issue === 'NATIVE_ITEM_ID_RUNTIME_DEPENDENT'
            ? 'This numeric ID belongs to a behavior-defined item in the selected version profile and may shift with installed packs. Supply a symbolic item identifier or explicit preview icon instead.'
            : issue === 'NATIVE_ITEM_AUX_DATA_UNSUPPORTED'
              ? 'The selected current item-ID profile supports auxiliary data 0 only. Nonzero state/damage data was not guessed to be a texture-atlas variant.'
              : issue === 'NATIVE_ITEM_RENDERER_DATA_UNSUPPORTED'
                ? 'The control has opaque native #item_renderer_data. Supply representative item state to preview it; this unresolved native input was not treated as an empty inventory slot.'
                : issue === 'NATIVE_ITEM_ID_PROFILE_INVALID'
                  ? 'The requested native item-ID profile is invalid. Select the pinned current profile or the explicit r41 legacy-five compatibility profile.'
        : `The native renderer input could not be resolved safely (${issue}).`;
    push(
      'warn',
      issue,
      message,
      { originKind: 'native-renderer-capability' }
    );
  }

  if (nativeReferenceContextPending) {
    push(
      'warn',
      'REFERENCE_CONTEXT_PENDING',
      'Native renderer resource references are still loading; missing-reference validation is not yet settled.',
      { originKind: 'reference-pending' },
    );
  }

  if (nativeRuntime.factories.total > 0) {
    push(
      'warn',
      'FACTORY_RUNTIME_DEPENDENT',
      `Factory-generated controls require Minecraft runtime instantiation. Safe preview materializes only bounded representative instances when a collection scenario and template resolve unambiguously; live or unsupported instances may remain omitted. ${describeNativeRuntimeBucket(nativeRuntime.factories, 'Factories')}`,
      { originKind: 'native-runtime' }
    );
  }

  // Vanilla UI files often use "$var" / "#binding" / "@..." dynamic references for
  // values like size/offset/color/alpha/bindings. These are valid but not always
  // evaluatable by this editor.
  //
  // To keep validation "vanilla-friendly", treat those as valid and emit a
  // compact summary warning instead of many per-node errors.
  if (dynamic.props.size > 0) {
    const rows = Array.from(dynamic.props.entries())
      .map(([propKey, info]) => ({ propKey, count: info.count, examples: info.examples }))
      .sort((a, b) => (b.count - a.count) || a.propKey.localeCompare(b.propKey));

    const counts = rows.map((r) => `${r.propKey}=${r.count}`).join(', ');
    const examples = [];
    for (const r of rows.slice(0, 4)) {
      const e = r.examples && r.examples.length ? r.examples[0] : null;
      if (!e) continue;
      examples.push(`${r.propKey} (${e.nodeKey} => ${describeValue(e.value, 80)})`);
    }

    let msg = `Dynamic references detected for known properties; treated as valid but not expanded/validated. Counts: ${counts}.`;
    if (examples.length) msg += ` Examples: ${examples.join('; ')}.`;
    push('warn', 'PROP_DYNAMIC', msg, { originKind: 'dynamic' });
  }

  if (dynamic.controls.count > 0) {
    const e = dynamic.controls.examples && dynamic.controls.examples.length ? dynamic.controls.examples[0] : null;
    let msg = `Dynamic "controls" reference(s) detected; treated as valid but not expanded. Count: ${dynamic.controls.count}.`;
    if (e) msg += ` Example: ${e.nodeKey} => ${describeValue(e.value, 80)}.`;
    push('warn', 'CONTROLS_DYNAMIC', msg, { originKind: 'dynamic' });
  }

  if (dynamic.bindings.count > 0) {
    const e = dynamic.bindings.examples && dynamic.bindings.examples.length ? dynamic.bindings.examples[0] : null;
    let msg = `Dynamic "bindings" reference(s) detected; treated as valid but not expanded. Count: ${dynamic.bindings.count}.`;
    if (e) msg += ` Example: ${e.nodeKey} => ${describeValue(e.value, 80)}.`;
    push('warn', 'BINDINGS_DYNAMIC', msg, { originKind: 'dynamic' });
  }

  // S054: Reference checks (textures/fonts/text keys/global vars).
  // These are emitted as WARNINGS (non-blocking) and rely on optional context.
  const referenceSourceJson = opts.sourceJson ?? model.sourceJson;
  if (refCtx && (referenceSourceJson || nativeTextureDepsByRef.size)) {
    const outTextureRefs = new Set();
    const outFontRefs = new Set();
    const outLangKeys = new Set();
    const outVarRefs = new Set();
    const outVarDeclarations = new Set();

    if (referenceSourceJson) {
      scanJsonForReferenceDeps(referenceSourceJson, {
        outTextureRefs,
        outFontRefs,
        outLangKeys,
        outVarRefs,
        outVarDeclarations,
      });
    }
    for (const textureRef of evaluatedTextureMetaByRef.keys()) outTextureRefs.add(textureRef);
    for (const fontRef of evaluatedFontMetaByRef.keys()) outFontRefs.add(fontRef);
    for (const langKey of evaluatedLangMetaByKey.keys()) outLangKeys.add(langKey);
    const nativeOnlyMetaByRef = new Map();
    for (const [textureRef, meta] of nativeTextureDepsByRef) {
      const alreadyExplicit = outTextureRefs.has(textureRef);
      outTextureRefs.add(textureRef);
      if (!alreadyExplicit) nativeOnlyMetaByRef.set(textureRef, meta);
    }
    // Template parameters are lexical declarations, not global-variable
    // dependencies. A file-level set subtraction is conservative: it avoids
    // claiming that a declared template parameter is missing while keeping
    // genuinely runtime-provided variables visible in diagnostics.
    for (const declaredName of outVarDeclarations) outVarRefs.delete(declaredName);

    const MAX_REF_WARNINGS = 300;
    let refWarnings = 0;
    const pushRefWarn = (code, message, meta) => {
      if (refWarnings >= MAX_REF_WARNINGS) return;
      refWarnings += 1;
      push('warn', code, message, meta);
    };

    const importedIndex = refCtx.importedIndex || null;
    const vanillaIndex = refCtx.vanillaIndex || null;
    const checkableFontRefs = new Set(Array.from(outFontRefs).filter((fontRef) => {
      const result = resolveFontTypeRef(fontRef, {});
      return !result.ok || !result.builtIn;
    }));

    // Texture + font checks require at least one asset index.
    if ((outTextureRefs.size || checkableFontRefs.size) && !importedIndex && !vanillaIndex) {
      pushRefWarn(
        'ASSET_INDEX_UNAVAILABLE',
        'Asset index is unavailable; texture/font reference checks were skipped (import a pack and/or load a Vanilla reference).',
        { originKind: 'reference' }
      );
    } else {
      for (const texRef of outTextureRefs) {
        const r = resolveTextureRef(texRef, { importedIndex, vanillaIndex });
        const nativeMeta = nativeTextureDepsByRef.get(texRef);
        const evaluatedMeta = evaluatedTextureMetaByRef.get(texRef);
        if (nativeMeta && r.collision) {
          pushRefWarn(
            'NATIVE_PREVIEW_TEXTURE_AMBIGUOUS',
            `Texture required by the bounded native renderer preview is case-ambiguous: ${texRef}`,
            {
              nodeId: nativeMeta.nodeId, nodeKey: nativeMeta.nodeKey, propKey: 'renderer',
              refValue: texRef, originKind: 'native-renderer-reference',
            }
          );
          continue;
        }
        if (!r.resolved) {
          pushRefWarn(
            'MISSING_TEXTURE_REF',
            nativeMeta
              ? `Texture required by the bounded native renderer preview was not found: ${texRef}`
              : `Texture reference not found in imported pack or Vanilla reference: ${texRef}`,
            {
              nodeId: nativeMeta?.nodeId || evaluatedMeta?.nodeId,
              nodeKey: nativeMeta?.nodeKey || evaluatedMeta?.nodeKey,
              propKey: nativeMeta ? 'renderer' : evaluatedMeta?.propKey || 'texture',
              refValue: texRef,
              originKind: nativeMeta ? 'native-renderer-reference' : evaluatedMeta?.originKind || 'reference',
            }
          );
        } else if (nativeMeta) {
          const failureTable = readOwnDataValue(refCtx, 'nativeTextureFailures');
          const cacheKey = `${safeString(r.resolved.source)}:${safeString(r.resolved.packPath)}`;
          const failureCode = readOwnDataValue(failureTable, cacheKey);
          if (typeof failureCode === 'string' && failureCode) {
            pushRefWarn(
              'NATIVE_PREVIEW_TEXTURE_DECODE_FAILED',
              `Texture required by the bounded native renderer preview could not be decoded safely: ${texRef} (${failureCode})`,
              {
                nodeId: nativeMeta.nodeId, nodeKey: nativeMeta.nodeKey, propKey: 'renderer',
                refValue: texRef, originKind: 'native-renderer-reference',
              }
            );
          }
        }
      }
      for (const fontRef of checkableFontRefs) {
        const r = resolveFontTypeRef(fontRef, { importedIndex, vanillaIndex });
        if (!r.ok || (!r.builtIn && !r.resolved)) {
          const evaluatedMeta = evaluatedFontMetaByRef.get(fontRef);
          pushRefWarn(
            'MISSING_FONT_REF',
            `Font reference not found in imported pack or Vanilla reference: ${fontRef}`,
            {
              nodeId: evaluatedMeta?.nodeId,
              nodeKey: evaluatedMeta?.nodeKey,
              propKey: 'font_type', refValue: fontRef,
              originKind: evaluatedMeta?.originKind || 'reference',
            }
          );
        }
      }
    }

    // Text key checks require a langTable (merged imported + vanilla).
    const langTable = refCtx.langTable || null;
    if (outLangKeys.size && !langTable) {
      pushRefWarn(
        'LANG_TABLE_UNAVAILABLE',
        'Lang table is unavailable; localized text key checks were skipped (load texts/locale in preview settings).',
        { originKind: 'reference' }
      );
    } else if (langTable) {
      for (const key of outLangKeys) {
        if (!Object.prototype.hasOwnProperty.call(langTable, key)) {
          const evaluatedMeta = evaluatedLangMetaByKey.get(key);
          pushRefWarn(
            'MISSING_LANG_KEY',
            `Localized text key not found in merged lang table: ${key}`,
            {
              nodeId: evaluatedMeta?.nodeId,
              nodeKey: evaluatedMeta?.nodeKey,
              propKey: 'text', refValue: key,
              originKind: evaluatedMeta?.originKind || 'reference',
            }
          );
        }
      }
    }

    // Global variable checks require the merged globalVarNames set.
    const globalVarNames = refCtx.globalVarNames || null;
    const runtimeVarNames = refCtx.runtimeVarNames instanceof Set ? refCtx.runtimeVarNames : null;
    const checkableVarRefs = new Set(Array.from(outVarRefs).filter((name) => !(runtimeVarNames && runtimeVarNames.has(name))));
    if (checkableVarRefs.size && !(globalVarNames instanceof Set)) {
      pushRefWarn(
        'GLOBAL_VARS_UNAVAILABLE',
        'Global variables are unavailable; $variable reference checks were skipped (load global variables and/or Vanilla reference).',
        { originKind: 'reference' }
      );
    } else if (globalVarNames instanceof Set) {
      for (const v of checkableVarRefs) {
        if (!globalVarNames.has(v)) {
          pushRefWarn(
            'MISSING_GLOBAL_VAR',
            `Variable was not found in loaded global variables and may require runtime data: ${v}`,
            { refValue: v, originKind: 'reference' }
          );
        }
      }
    }

    if (refWarnings >= MAX_REF_WARNINGS) {
      push(
        'warn',
        'REFERENCE_CHECK_TRUNCATED',
        `Reference warnings were truncated at ${MAX_REF_WARNINGS} entries for performance.`,
        { originKind: 'reference' }
      );
    }
  }

  return finalize(issues);
}

/**
 * Baseline validation for _ui_defs.json editor state.
 *
 * @param {{ filePath?: string, formatVersion: number, uiDefs: string[] }} input
 * @returns {ValidationResult}
 */
export function validateUiDefsState(input) {
  const filePath = safeString(input?.filePath || 'ui/_ui_defs.json');
  /** @type {ValidationIssue[]} */
  const issues = [];
  /**
   * @param {ValidationLevel} level
   * @param {string} code
   * @param {string} message
   * @param {Partial<ValidationIssue>} [meta]
   */
  function push(level, code, message, meta = {}) {
    issues.push({
      level,
      code,
      message,
      filePath,
      nodeId: meta.nodeId,
      nodeKey: meta.nodeKey,
      propKey: meta.propKey,
      refValue: meta.refValue,
      originKind: meta.originKind,
    });
  }

  const fv = Number(input?.formatVersion);
  if (!Number.isSafeInteger(fv) || fv < 1) {
    push('error', 'UI_DEFS_FORMAT_VERSION_INVALID', 'format_version must be a positive integer.');
  }

  const uiDefs = Array.isArray(input?.uiDefs) ? input.uiDefs : [];
  if (uiDefs.length === 0) {
    push('warn', 'UI_DEFS_EMPTY', 'ui_defs list is empty. Custom UI screens may not be recognized.');
  }

  const counts = new Map();
  for (const raw of uiDefs) {
    const k = safeString(raw).trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  for (const raw of uiDefs) {
    const trimmed = safeString(raw).trim();
    if (!trimmed) continue;
    let normalized;
    try {
      normalized = normalizePackPath(trimmed);
    } catch (error) {
      push('error', 'UI_DEFS_PATH_INVALID', `Invalid ui_defs entry: ${trimmed} (${safeString(error?.message || error)})`);
      continue;
    }
    if (!normalized.endsWith('.json')) {
      push('warn', 'UI_DEFS_PATH_EXTENSION', `ui_defs entry does not end with .json: ${normalized}`);
    }
    if (!normalized.startsWith('ui/')) {
      push('warn', 'UI_DEFS_PATH_PREFIX', `ui_defs entry does not start with 'ui/': ${normalized}`);
    }
    if ((counts.get(trimmed) || 0) > 1) {
      push('warn', 'UI_DEFS_DUPLICATE', `Duplicate ui_defs entry: ${trimmed}`);
    }
  }

  return finalize(issues);
}

/**
 * Render a compact one-line summary.
 * @param {ValidationResult | null | undefined} result
 */
export function summarizeValidation(result) {
  if (!result) return 'Validation: (not available)';
  const e = Number(result.errorCount) || 0;
  const w = Number(result.warningCount) || 0;
  if (e === 0 && w === 0) return 'Validation: OK (no issues)';
  if (e === 0) return `Validation: OK (${w} warning${w === 1 ? '' : 's'})`;
  return `Validation: BLOCKED (${e} error${e === 1 ? '' : 's'}${w ? `, ${w} warning${w === 1 ? '' : 's'}` : ''})`;
}
