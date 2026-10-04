/*
  ui-screen-model.js (S029)

  Internal UI model for Minecraft Bedrock JSON UI screen files.

  Goals (S029):
  - Represent supported element types with a deterministic, normalized in-memory model.
  - Preserve unknown JSON fields at the screen / element / binding level.
  - Parse child controls ("controls") and binding arrays ("bindings").
  - Apply conservative normalization (defaults + basic type checks) without losing raw values.

  Notes:
  - This module does NOT perform full schema validation. Validation is handled in later steps.
  - Comments are not preserved (JSONC is parsed into JSON).
  - This module is intended to be "pure logic" (no DOM) to enable unit testing later.
*/

import { stableStringify } from '../json/stable-stringify.js';
import { classifyTextureValue } from './texture-value.js';

/**
 * Supported UI element types for this editor (per project requirements).
 *
 * @type {readonly string[]}
 */
export const SUPPORTED_UI_ELEMENT_TYPES = Object.freeze([
  'screen',
  'panel',
  'collection_panel',
  'label',
  'button',
  'dropdown',
  'image',
  'input_panel',
  'stack_panel',
  'grid',
  'scroll_view',
  'edit_box',
  'toggle',
  'scroll_track',
  'scrollbar_box',
]);

/**
 * Native Bedrock control kinds that this editor preserves and validates but
 * cannot generically paint without game runtime state. They are deliberately
 * separate from the editable/renderable palette above so diagnostics can
 * recognize valid JSON UI without overstating preview capability.
 */
export const NATIVE_RUNTIME_UI_ELEMENT_TYPES = Object.freeze([
  'custom',
  'factory',
  'tooltip_trigger',
]);

export const VALID_UI_ELEMENT_TYPES = Object.freeze([
  ...SUPPORTED_UI_ELEMENT_TYPES,
  ...NATIVE_RUNTIME_UI_ELEMENT_TYPES,
]);

/**
 * @typedef {number|string} UiDimension
 */

/**
 * 2-item dimension vector.
 * @typedef {[UiDimension, UiDimension]} UiDim2
 */

/**
 * @typedef {{
 *  raw: string,
 *  local_name: string,
 *  base_ref_raw: string|null,
 *  base_ref: string|null,
 * }} UiElementKey
 */

/**
 * @typedef {{
 *  ignored?: boolean,
 *  binding_type?: string,
 *  binding_name?: string,
 *  binding_name_override?: string,
 *  binding_collection_name?: string,
 *  binding_collection_prefix?: string,
 *  binding_condition?: string,
 *  source_control_name?: string,
 *  source_property_name?: string,
 *  target_property_name?: string,
 *  resolve_sibling_scope?: boolean,
 *  unknown_fields: Record<string, any>,
 * }} UiBinding
 */

/**
 * Additional metadata for nodes created from unusual "controls" shapes.
 *
 * @typedef {{
 *  kind: 'named'|'inline'|'string'|'raw'|'truncated',
 *  raw?: any,
 *  index?: number,
 * }} UiNodeOrigin
 */

/**
 * @typedef {{
 *  id: string,
 *  key: UiElementKey,
 *  type?: string,
 *  props: Record<string, any>,
 *  propsPresent: Record<string, boolean>,
 *  propsValid: Record<string, boolean>,
 *  localVariables: Record<string, any>,
 *  bindings: UiBinding[],
 *  bindingsPresent: boolean,
 *  children: UiNode[],
 *  controlsPresent: boolean,
 *  unknownProps: Record<string, any>,
 *  origin?: UiNodeOrigin,
 * }} UiNode
 */

/**
 * @typedef {{
 *  filePath: string,
 *  namespace: string,
 *  root: UiNode,
 *  unknownFields: Record<string, any>,
 *  stats: {
 *    nodeCount: number,
 *    maxDepth: number,
 *    truncated: boolean,
 *    truncateReason?: string,
 *  },
 * }} UiScreenModel
 */

/**
 * @typedef {{
 *  filePath: string,
 *  maxNodes?: number,
 *  maxDepth?: number,
 * }} BuildUiScreenModelOptions
 */

const DEFAULT_LIMITS = Object.freeze({
  maxNodes: 20000,
  maxDepth: 200,
});

const KNOWN_PROP_DEFAULTS = Object.freeze({
  // Common: core
  visible: true,
  enabled: true,
  layer: 0,
  alpha: 1,
  propagate_alpha: false,
  clips_children: false,
  allow_clipping: true,
  ignored: false,

  // Common: layout
  size: /** @type {UiDim2} */ (['default', 'default']),
  min_size: /** @type {UiDim2} */ (['default', 'default']),
  max_size: /** @type {UiDim2} */ (['default', 'default']),
  offset: /** @type {UiDim2} */ ([0, 0]),
  // Vanilla JSON UI treats omitted anchors as centered.  Top-left defaults
  // make otherwise valid inventory screens drift into the viewport corner.
  anchor_from: 'center',
  anchor_to: 'center',

  // Common: text-ish
  text: '',
  texture: '',

  // stack_panel
  orientation: 'vertical',
});

const KNOWN_PROP_KEYS = Object.freeze([
  // Common: core
  'visible',
  'enabled',
  'layer',
  'alpha',
  'propagate_alpha',
  'clips_children',
  'allow_clipping',
  'ignored',

  // Common: layout
  'size',
  'min_size',
  'max_size',
  'offset',
  'anchor_from',
  'anchor_to',

  // Common: frequently used
  'text',
  'texture',
  'texture_file_system',
  'keep_ratio',
  'bilinear',
  'uv',
  'uv_size',
  'fill',
  'tiled',
  'tiled_scale',
  'clip_ratio',
  'clip_direction',
  'clip_pixelperfect',
  'grayscale',
  'nineslice_size',
  'nine_slice_left',
  'nine_slice_right',
  'nine_slice_top',
  'nine_slice_bottom',
  'nine_slice_buttom',
  'font_type',
  'font_size',
  'font_scale_factor',
  'text_alignment',
  'vertical_alignment',
  'color',
  'shadow',
  'localize',
  'max_length',

  // Layout types
  'orientation',
  'grid_dimensions',
  'grid_item_template',
  'maximum_grid_items',
  'grid_dimension_binding',
]);

const KNOWN_BINDING_KEYS = Object.freeze([
  'ignored',
  'binding_type',
  'binding_name',
  'binding_name_override',
  'binding_collection_name',
  'binding_collection_prefix',
  'binding_condition',
  'source_control_name',
  'source_property_name',
  'target_property_name',
  'resolve_sibling_scope',
]);

/**
 * @param {any} v
 * @returns {v is Record<string, any>}
 */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @param {any} v
 */
function safeString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return String(v);
  } catch {
    return '';
  }
}

/**
 * @param {any} v
 */
function safeBoolean(v) {
  if (typeof v === 'boolean') return v;
  return null;
}

/**
 * @param {any} v
 */
function safeNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * @param {any} v
 * @returns {UiDimension|null}
 */
function normalizeDimension(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  return null;
}

/**
 * @param {any} v
 * @returns {UiDim2|null}
 */
function normalizeDim2(v) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const a = normalizeDimension(v[0]);
  const b = normalizeDimension(v[1]);
  if (a === null || b === null) return null;
  return /** @type {UiDim2} */ ([a, b]);
}

/**
 * @param {string} s
 */
function sanitizeIdPart(s) {
  const trimmed = safeString(s).trim();
  if (!trimmed) return 'node';
  // Keep alnum and a small safe set. Replace everything else with '_'.
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return sanitized || 'node';
}

/**
 * @param {string} parentId
 * @param {string} hint
 * @param {Set<string>} used
 */
function makeUniqueChildId(parentId, hint, used) {
  const base = `${parentId}/${sanitizeIdPart(hint)}`;
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}~${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

/**
 * Parse an element key (supports inheritance using '@').
 * Examples:
 *  - "my_button" -> local_name="my_button"
 *  - "my_button@common.button" -> local_name="my_button", base_ref="common.button"
 *
 * @param {any} raw
 * @returns {UiElementKey}
 */
export function parseUiElementKey(raw) {
  const s = safeString(raw);
  const at = s.indexOf('@');
  if (at < 0) {
    return { raw: s, local_name: s, base_ref_raw: null, base_ref: null };
  }
  const local = s.slice(0, at) || s;
  const baseRaw = s.slice(at + 1) || '';
  const base = baseRaw ? baseRaw : null;
  return { raw: s, local_name: local, base_ref_raw: baseRaw || null, base_ref: base };
}

/**
 * @param {string} key
 * @returns {key is string}
 */
function isLocalVariableKey(key) {
  return key.startsWith('$') && key !== '$schema';
}

/**
 * @param {Record<string, any>} obj
 */
function splitLocalVariables(obj) {
  /** @type {Record<string, any>} */
  const localVariables = Object.create(null);
  /** @type {string[]} */
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (isLocalVariableKey(k)) {
      localVariables[k] = obj[k];
    }
  }
  return localVariables;
}

/**
 * @param {Record<string, any>} obj
 */
function buildBindings(obj) {
  const hasBindings = Object.prototype.hasOwnProperty.call(obj, 'bindings');
  const v = obj.bindings;
  if (!hasBindings) {
    return { bindingsPresent: false, bindings: /** @type {UiBinding[]} */ ([]) };
  }
  if (!Array.isArray(v)) {
    // Preserve the raw value under unknownProps in the caller.
    return { bindingsPresent: true, bindings: /** @type {UiBinding[]} */ ([]) };
  }
  /** @type {UiBinding[]} */
  const out = [];
  for (const item of v) {
    if (!isPlainObject(item)) {
      out.push({ unknown_fields: { __raw: item } });
      continue;
    }
    /** @type {Record<string, any>} */
    const unknown = Object.create(null);
    for (const [k, val] of Object.entries(item)) {
      if (!KNOWN_BINDING_KEYS.includes(k)) {
        unknown[k] = val;
      }
    }
    /** @type {UiBinding} */
    const b = {
      unknown_fields: unknown,
    };
    for (const k of KNOWN_BINDING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(item, k)) continue;
      const val = item[k];
      if (k === 'ignored' || k === 'resolve_sibling_scope') {
        const bv = safeBoolean(val);
        if (bv !== null) b[k] = bv;
        else b.unknown_fields[k] = val;
        continue;
      }
      // 種類が非文字列なら文字列化で元型を失わず、未知フィールドに保持する。
      // 評価側は「省略」と区別して警告し、推測した種類では実行しない。
      if (k === 'binding_type' && typeof val !== 'string') {
        b.unknown_fields[k] = val;
        continue;
      }
      if (k === 'binding_type' || k === 'binding_condition') {
        const sv = safeString(val);
        if (sv) b[k] = sv;
        else b.unknown_fields[k] = val;
        continue;
      }
      // Remaining keys are strings in common cases.
      const sv = safeString(val);
      if (sv) b[k] = sv;
      else b.unknown_fields[k] = val;
    }
    out.push(b);
  }
  return { bindingsPresent: true, bindings: out };
}

/**
 * Normalize known props. If a value cannot be normalized safely, it is NOT returned
 * (caller should retain raw value in unknownProps).
 *
 * @param {string} key
 * @param {any} raw
 * @returns {{ ok: true, value: any } | { ok: false }}
 */
function normalizeKnownPropValue(key, raw) {
  const runtimeToken = typeof raw === 'string' && /^[#$][A-Za-z0-9_:@.\-]+$/u.test(raw.trim());
  if (key === 'visible' || key === 'enabled' || key === 'propagate_alpha' || key === 'clips_children' || key === 'allow_clipping' || key === 'ignored' || key === 'shadow' || key === 'localize' || key === 'keep_ratio' || key === 'bilinear' || key === 'fill' || key === 'clip_pixelperfect' || key === 'grayscale') {
    const bv = safeBoolean(raw);
    return bv === null ? runtimeToken ? { ok: true, value: raw } : { ok: false } : { ok: true, value: bv };
  }

  if (key === 'layer' || key === 'max_length' || key === 'maximum_grid_items') {
    const nv = safeNumber(raw);
    return nv === null ? { ok: false } : { ok: true, value: Math.floor(nv) };
  }

  if (key === 'alpha' || key === 'font_scale_factor' || key === 'nine_slice_left' || key === 'nine_slice_right' || key === 'nine_slice_top' || key === 'nine_slice_bottom' || key === 'nine_slice_buttom' || key === 'clip_ratio') {
    const nv = safeNumber(raw);
    return nv === null ? runtimeToken ? { ok: true, value: raw } : { ok: false } : { ok: true, value: nv };
  }

  // Vanilla uses an empty min/max vector as an explicit "no constraint"
  // sentinel in a few shared templates (for example loading_bars). Preserve
  // that authored value instead of turning an engine-valid screen into a
  // blocking validation error. Other vector properties still require two
  // axes.
  if ((key === 'min_size' || key === 'max_size') && Array.isArray(raw) && raw.length === 0) {
    return { ok: true, value: [] };
  }

  if (key === 'size' || key === 'min_size' || key === 'max_size' || key === 'offset' || key === 'uv' || key === 'uv_size') {
    const v = normalizeDim2(raw);
    return v === null ? { ok: false } : { ok: true, value: v };
  }

  if (key === 'anchor_from' || key === 'anchor_to' || key === 'orientation' || key === 'grid_dimension_binding' || key === 'texture_file_system' || key === 'vertical_alignment') {
    const sv = safeString(raw);
    return sv ? { ok: true, value: sv } : { ok: false };
  }

  if (key === 'clip_direction') {
    const sv = safeString(raw).trim().toLowerCase();
    return runtimeToken || ['left', 'right', 'up', 'down', 'center'].includes(sv)
      ? { ok: true, value: runtimeToken ? raw : sv }
      : { ok: false };
  }

  if (key === 'tiled') {
    const bv = safeBoolean(raw);
    if (bv !== null) return { ok: true, value: bv };
    const sv = safeString(raw).trim().toLowerCase();
    return runtimeToken || sv === 'x' || sv === 'y'
      ? { ok: true, value: runtimeToken ? raw : sv }
      : { ok: false };
  }

  if (key === 'tiled_scale') {
    const scalar = safeNumber(raw);
    if (scalar !== null && scalar > 0) return { ok: true, value: scalar };
    const vector = normalizeDim2(raw);
    if (vector && vector.every((value) => typeof value === 'string' || Number(value) > 0)) return { ok: true, value: vector };
    return runtimeToken ? { ok: true, value: raw } : { ok: false };
  }

  // Empty text and texture can be authored defaults populated by a binding.
  // Texture type safety is separate from whether the evaluated image needs
  // pixels: an ignored official highlight may intentionally have an empty value.
  if (key === 'text') {
    const sv = safeString(raw);
    return raw === '' || sv ? { ok: true, value: sv } : { ok: false };
  }

  if (key === 'texture') {
    const state = classifyTextureValue(raw).state;
    return state !== 'invalid-type' && state !== 'whitespace'
      ? { ok: true, value: raw } : { ok: false };
  }

  if (key === 'font_type' || key === 'font_size' || key === 'text_alignment' || key === 'grid_item_template') {
    const sv = safeString(raw);
    return sv ? { ok: true, value: sv } : { ok: false };
  }

  if (key === 'color') {
    if (!Array.isArray(raw) || (raw.length !== 3 && raw.length !== 4)) return { ok: false };
    const nums = raw.map((x) => safeNumber(x));
    if (nums.some((x) => x === null)) return { ok: false };
    return { ok: true, value: nums };
  }

  if (key === 'nineslice_size') {
    const scalar = safeNumber(raw);
    if (scalar !== null) return { ok: true, value: scalar };
    if (!Array.isArray(raw) || (raw.length !== 2 && raw.length !== 4)) return { ok: false };
    const values = raw.map((item) => safeNumber(item));
    if (values.some((item) => item === null)) return { ok: false };
    return { ok: true, value: values };
  }

  if (key === 'grid_dimensions') {
    if (!Array.isArray(raw) || raw.length !== 2) return { ok: false };
    const a = safeNumber(raw[0]);
    const b = safeNumber(raw[1]);
    if (a === null || b === null) return { ok: false };
    return { ok: true, value: [Math.floor(a), Math.floor(b)] };
  }

  return { ok: false };
}

/**
 * Build an element node from a JSON object.
 *
 * @param {{
 *  parentId: string,
 *  keyRaw: string,
 *  elementJson: any,
 *  depth: number,
 *  usedIds: Set<string>,
 *  stats: { nodeCount: number, maxDepth: number, truncated: boolean, truncateReason?: string },
 *  limits: { maxNodes: number, maxDepth: number },
 *  origin?: UiNodeOrigin,
 * }} params
 * @returns {UiNode}
 */
function buildNode(params) {
  const { parentId, keyRaw, elementJson, depth, usedIds, stats, limits, origin } = params;

  stats.maxDepth = Math.max(stats.maxDepth, depth);

  const key = parseUiElementKey(keyRaw);
  const id = makeUniqueChildId(parentId, key.local_name || key.raw || 'node', usedIds);

  if (stats.nodeCount >= limits.maxNodes || depth >= limits.maxDepth) {
    stats.truncated = true;
    stats.truncateReason = stats.truncateReason || `Hit limit (maxNodes=${limits.maxNodes}, maxDepth=${limits.maxDepth}).`;
    return {
      id,
      key,
      type: undefined,
      props: {},
      propsPresent: {},
      propsValid: {},
      localVariables: {},
      bindings: [],
      bindingsPresent: false,
      children: [],
      controlsPresent: false,
      unknownProps: {},
      origin: { kind: 'truncated', raw: elementJson },
    };
  }

  stats.nodeCount += 1;

  // Non-object controls are preserved as raw nodes.
  if (!isPlainObject(elementJson)) {
    return {
      id,
      key,
      type: undefined,
      props: {},
      propsPresent: {},
      propsValid: {},
      localVariables: {},
      bindings: [],
      bindingsPresent: false,
      children: [],
      controlsPresent: false,
      unknownProps: { __raw: elementJson },
      origin: origin || { kind: 'raw', raw: elementJson },
    };
  }

  const obj = /** @type {Record<string, any>} */ (elementJson);

  const typeRaw = Object.prototype.hasOwnProperty.call(obj, 'type') ? obj.type : undefined;
  const type = typeof typeRaw === 'string' && typeRaw ? typeRaw : undefined;

  const localVariables = splitLocalVariables(obj);

  /** @type {Record<string, any>} */
  const props = Object.create(null);
  /** @type {Record<string, boolean>} */
  const propsPresent = Object.create(null);
  /** @type {Record<string, boolean>} */
  const propsValid = Object.create(null);

  /** @type {Record<string, any>} */
  const unknownProps = Object.create(null);

  // Bindings first (so we can treat invalid shapes as unknownProps.bindings).
  const { bindingsPresent, bindings } = buildBindings(obj);
  if (bindingsPresent && !Array.isArray(obj.bindings)) {
    unknownProps.bindings = obj.bindings;
  }

  // Normalize a curated set of known properties.
  for (const k of KNOWN_PROP_KEYS) {
    const has = Object.prototype.hasOwnProperty.call(obj, k);
    propsPresent[k] = has;
    if (!has) {
      if (Object.prototype.hasOwnProperty.call(KNOWN_PROP_DEFAULTS, k)) {
        props[k] = /** @type {any} */ (KNOWN_PROP_DEFAULTS[k]);
        propsValid[k] = true;
      }
      continue;
    }
    const norm = normalizeKnownPropValue(k, obj[k]);
    if (norm.ok) {
      props[k] = norm.value;
      propsValid[k] = true;
    } else {
      propsValid[k] = false;
      // Preserve the raw value for lossless round-tripping.
      unknownProps[k] = obj[k];
      if (Object.prototype.hasOwnProperty.call(KNOWN_PROP_DEFAULTS, k)) {
        props[k] = /** @type {any} */ (KNOWN_PROP_DEFAULTS[k]);
      }
    }
  }

  // Copy the remaining fields as unknownProps (excluding reserved keys).
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' || k === 'controls' || k === 'bindings') continue;
    if (isLocalVariableKey(k)) continue;
    if (KNOWN_PROP_KEYS.includes(k)) {
      // If we failed to normalize it we already preserved it above.
      if (Object.prototype.hasOwnProperty.call(unknownProps, k)) continue;
      // Otherwise it was normalized into props.
      continue;
    }
    unknownProps[k] = v;
  }

  // Controls
  const controlsPresent = Object.prototype.hasOwnProperty.call(obj, 'controls');
  /** @type {UiNode[]} */
  const children = [];

  if (controlsPresent) {
    const ctrls = obj.controls;
    if (Array.isArray(ctrls)) {
      for (let i = 0; i < ctrls.length; i += 1) {
        const entry = ctrls[i];
        if (isPlainObject(entry)) {
          const keys = Object.keys(entry);
          // A direct element can legally contain only `type`. Detect it before
          // the one-key named-wrapper form so `{ type: 'panel' }` is not
          // misread as a control named `type` whose body is the string panel.
          if (typeof entry.type === 'string') {
            children.push(
              buildNode({
                parentId: id,
                keyRaw: `__inline__${i + 1}`,
                elementJson: entry,
                depth: depth + 1,
                usedIds,
                stats,
                limits,
                origin: { kind: 'inline', raw: entry, index: i },
              })
            );
            continue;
          }
          if (keys.length === 1) {
            const childKeyRaw = keys[0];
            const childDef = entry[childKeyRaw];
            children.push(
              buildNode({
                parentId: id,
                keyRaw: childKeyRaw,
                elementJson: childDef,
                depth: depth + 1,
                usedIds,
                stats,
                limits,
                origin: { kind: 'named', raw: entry, index: i },
              })
            );
            continue;
          }

          // Inline object form (uncommon). Preserve the entire entry as raw.
          children.push(
            buildNode({
              parentId: id,
              keyRaw: `__inline__${i + 1}`,
              elementJson: entry,
              depth: depth + 1,
              usedIds,
              stats,
              limits,
              origin: { kind: 'inline', raw: entry, index: i },
            })
          );
          continue;
        }
        if (typeof entry === 'string') {
          children.push(
            buildNode({
              parentId: id,
              keyRaw: entry,
              elementJson: entry,
              depth: depth + 1,
              usedIds,
              stats,
              limits,
              origin: { kind: 'string', raw: entry, index: i },
            })
          );
          continue;
        }
        // Unknown entry shape
        children.push(
          buildNode({
            parentId: id,
            keyRaw: `__raw__${i + 1}`,
            elementJson: entry,
            depth: depth + 1,
            usedIds,
            stats,
            limits,
            origin: { kind: 'raw', raw: entry, index: i },
          })
        );
      }
    } else if (isPlainObject(ctrls)) {
      // Legacy / alternative shape: object map. Preserve insertion order of keys.
      const keys = Object.keys(ctrls);
      for (let i = 0; i < keys.length; i += 1) {
        const childKeyRaw = keys[i];
        children.push(
          buildNode({
            parentId: id,
            keyRaw: childKeyRaw,
            elementJson: ctrls[childKeyRaw],
            depth: depth + 1,
            usedIds,
            stats,
            limits,
            origin: { kind: 'named', raw: { [childKeyRaw]: ctrls[childKeyRaw] }, index: i },
          })
        );
      }
      // Keep the original raw controls object for later lossless re-serialization.
      unknownProps.__controls_object_shape = ctrls;
    } else {
      // Invalid controls type; preserve raw for round-trip.
      unknownProps.controls = ctrls;
    }
  }

  return {
    id,
    key,
    type,
    props,
    propsPresent,
    propsValid,
    localVariables,
    bindings,
    bindingsPresent,
    children,
    controlsPresent,
    unknownProps,
    origin,
  };
}

/**
 * Build an internal UiScreenModel from a parsed JSON object.
 *
 * @param {any} json
 * @param {BuildUiScreenModelOptions} options
 * @returns {UiScreenModel}
 */
export function buildUiScreenModelFromJson(json, options) {
  const filePath = safeString(options.filePath);
  const limits = {
    maxNodes: Math.max(100, Math.floor(Number(options.maxNodes ?? DEFAULT_LIMITS.maxNodes))),
    maxDepth: Math.max(10, Math.floor(Number(options.maxDepth ?? DEFAULT_LIMITS.maxDepth))),
  };

  /** @type {Record<string, any>} */
  const unknownFields = Object.create(null);

  const stats = {
    nodeCount: 0,
    maxDepth: 0,
    truncated: false,
    truncateReason: undefined,
  };

  const usedIds = new Set(['root']);

  // Root is a synthetic node representing the file.
  /** @type {UiNode} */
  const root = {
    id: 'root',
    key: { raw: '__file__', local_name: '__file__', base_ref_raw: null, base_ref: null },
    type: 'file',
    props: { name: filePath || '(unknown file)' },
    propsPresent: { name: true },
    propsValid: { name: true },
    localVariables: {},
    bindings: [],
    bindingsPresent: false,
    children: [],
    controlsPresent: true,
    unknownProps: {},
  };

  let namespace = '';

  if (!isPlainObject(json)) {
    unknownFields.__raw = json;
    return {
      filePath,
      namespace,
      root,
      unknownFields,
      stats: {
        nodeCount: 0,
        maxDepth: 0,
        truncated: false,
        truncateReason: 'Root JSON is not an object.',
      },
    };
  }

  const obj = /** @type {Record<string, any>} */ (json);
  if (typeof obj.namespace === 'string') namespace = obj.namespace;

  // Screen files use: { namespace: string, <elementKey>: <elementObject>, ... }
  // Preserve any non-element fields (or invalid element entries) in unknownFields.
  for (const k of Object.keys(obj)) {
    if (k === 'namespace') continue;
    const v = obj[k];
    if (isPlainObject(v)) {
      root.children.push(
        buildNode({
          parentId: root.id,
          keyRaw: k,
          elementJson: v,
          depth: 1,
          usedIds,
          stats,
          limits,
          origin: { kind: 'named', raw: { [k]: v } },
        })
      );
    } else {
      unknownFields[k] = v;
    }
  }

  return {
    filePath,
    namespace,
    root,
    unknownFields,
    stats: {
      nodeCount: stats.nodeCount,
      maxDepth: stats.maxDepth,
      truncated: stats.truncated,
      truncateReason: stats.truncateReason,
    },
  };
}

/**
 * Create a compact, machine-friendly summary of a UiScreenModel.
 * Intended for diagnostics/debug panels (avoid dumping the full tree).
 *
 * @param {UiScreenModel|null|undefined} model
 */
export function summarizeUiScreenModel(model) {
  if (!model) return null;
  return {
    filePath: model.filePath,
    namespace: model.namespace,
    nodeCount: model.stats.nodeCount,
    maxDepth: model.stats.maxDepth,
    truncated: model.stats.truncated,
    truncateReason: model.stats.truncateReason || null,
    rootChildren: model.root.children.map((c) => ({
      id: c.id,
      key: c.key.raw,
      type: c.type || null,
      childCount: c.children.length,
    })),
    unknownTopLevelKeys: Object.keys(model.unknownFields),
  };
}

/* -------------------------------------------------------------------------- */
/* S030: Model -> JSON serialization                                           */
/* -------------------------------------------------------------------------- */

/**
 * Options for deterministic JSON output text.
 *
 * @typedef {{
 *  indent?: number,
 *  finalNewline?: boolean,
 * }} UiJsonTextOptions
 */

/**
 * @param {any} v
 * @returns {Record<string, any>|null}
 */
function asPlainObjectOrNull(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const proto = Object.getPrototypeOf(v);
  const isPlain = proto === Object.prototype || proto === null;
  return isPlain ? /** @type {Record<string, any>} */ (v) : null;
}

/**
 * @param {Record<string, any>} obj
 */
function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

/**
 * Serialize a UiBinding back into a JSON value (object or raw).
 *
 * @param {UiBinding} b
 * @returns {any}
 */
export function uiBindingToJsonValue(b) {
  const unknown = asPlainObjectOrNull(b?.unknown_fields) || {};

  // Raw entry passthrough
  if (Object.prototype.hasOwnProperty.call(unknown, '__raw')) {
    return unknown.__raw;
  }

  /** @type {Record<string, any>} */
  const out = Object.create(null);

  // Known keys in a canonical order.
  for (const k of KNOWN_BINDING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(b, k)) {
      out[k] = /** @type {any} */ (b[k]);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(unknown, k)) {
      out[k] = unknown[k];
    }
  }

  // Unknown keys (stable sort).
  for (const k of sortedKeys(unknown)) {
    if (k === '__raw') continue;
    if (KNOWN_BINDING_KEYS.includes(k)) continue;
    out[k] = unknown[k];
  }

  return out;
}

/**
 * Serialize a UiNode back into a JSON value.
 *
 * IMPORTANT:
 * - If the node was created from a non-object control entry, we preserve the raw.
 * - We omit defaulted known props if they were not present in the input.
 * - We keep unknownProps fields (lossless round-trip intent).
 *
 * @param {UiNode} node
 * @returns {any}
 */
export function uiNodeToJsonValue(node) {
  const unknown = asPlainObjectOrNull(node?.unknownProps) || {};

  // Raw node passthrough (e.g., non-object control definition)
  if (Object.prototype.hasOwnProperty.call(unknown, '__raw')) {
    return unknown.__raw;
  }

  /** @type {Record<string, any>} */
  const out = Object.create(null);

  // type
  if (typeof node?.type === 'string' && node.type) {
    out.type = node.type;
  }

  const present = asPlainObjectOrNull(node?.propsPresent) || {};
  const valid = asPlainObjectOrNull(node?.propsValid) || {};
  const props = asPlainObjectOrNull(node?.props) || {};

  // Known props in a canonical order (only if present in original input)
  for (const k of KNOWN_PROP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(present, k) || present[k] !== true) continue;

    // If normalization failed, prefer raw in unknownProps.
    if (Object.prototype.hasOwnProperty.call(unknown, k)) {
      out[k] = unknown[k];
      continue;
    }

    if (
      Object.prototype.hasOwnProperty.call(valid, k) &&
      valid[k] === true &&
      Object.prototype.hasOwnProperty.call(props, k)
    ) {
      out[k] = props[k];
      continue;
    }

    // Fall back to whatever is in props if present.
    if (Object.prototype.hasOwnProperty.call(props, k)) {
      out[k] = props[k];
    }
  }

  // Local variables (stable sort)
  const localVars = asPlainObjectOrNull(node?.localVariables) || {};
  for (const k of sortedKeys(localVars)) {
    out[k] = localVars[k];
  }

  // Unknown props (stable sort), excluding reserved and helper keys.
  for (const k of sortedKeys(unknown)) {
    if (k === '__raw') continue;
    if (k === '__controls_object_shape') continue;
    if (k === 'bindings' || k === 'controls') continue;
    if (KNOWN_PROP_KEYS.includes(k)) {
      // If it was present, it would have been emitted above (raw or normalized).
      // If it was not present, keep it omitted.
      continue;
    }
    out[k] = unknown[k];
  }

  // bindings
  if (node?.bindingsPresent) {
    if (Object.prototype.hasOwnProperty.call(unknown, 'bindings')) {
      out.bindings = unknown.bindings;
    } else {
      const arr = Array.isArray(node?.bindings) ? node.bindings : [];
      out.bindings = arr.map(uiBindingToJsonValue);
    }
  }

  // controls
  if (node?.controlsPresent) {
    if (Object.prototype.hasOwnProperty.call(unknown, 'controls')) {
      out.controls = unknown.controls;
    } else if (Object.prototype.hasOwnProperty.call(unknown, '__controls_object_shape')) {
      // Preserve legacy/object-map controls shape by re-emitting an object map.
      /** @type {Record<string, any>} */
      const ctrlMap = Object.create(null);
      const kids = Array.isArray(node?.children) ? node.children : [];
      for (const child of kids) {
        ctrlMap[child.key.raw] = uiNodeToJsonValue(child);
      }
      out.controls = ctrlMap;
    } else {
      const kids = Array.isArray(node?.children) ? node.children : [];
      out.controls = kids.map((child) => {
        const origin = child?.origin;
        const kind = origin && typeof origin.kind === 'string' ? origin.kind : null;
        if (kind === 'string' && origin && typeof origin.raw === 'string') return origin.raw;
        if ((kind === 'inline' || kind === 'raw' || kind === 'truncated') && origin && 'raw' in origin) {
          return origin.raw;
        }
        // Default: canonical single-key object
        return { [child.key.raw]: uiNodeToJsonValue(child) };
      });
    }
  }

  return out;
}

/**
 * Serialize a UiScreenModel into a JSON object.
 *
 * Bedrock UI screen files are namespace-based objects where each JSON key
 * (except 'namespace') defines a UI element. Elements may use '@' inheritance.
 *
 * @param {UiScreenModel} model
 */
export function uiScreenModelToJson(model) {
  /** @type {Record<string, any>} */
  const out = Object.create(null);

  const unknown = asPlainObjectOrNull(model?.unknownFields) || {};

  // Common Bedrock file patterns: $schema and/or format_version near the top.
  if (Object.prototype.hasOwnProperty.call(unknown, '$schema')) {
    out.$schema = unknown.$schema;
  }
  if (Object.prototype.hasOwnProperty.call(unknown, 'format_version')) {
    out.format_version = unknown.format_version;
  }

  if (typeof model?.namespace === 'string') {
    out.namespace = model.namespace;
  } else {
    out.namespace = '';
  }

  // Remaining unknown root keys (stable sort), excluding handled keys.
  for (const k of sortedKeys(unknown)) {
    if (k === '$schema' || k === 'format_version' || k === 'namespace') continue;
    out[k] = unknown[k];
  }

  const kids = model?.root && Array.isArray(model.root.children) ? model.root.children : [];
  for (const child of kids) {
    out[child.key.raw] = uiNodeToJsonValue(child);
  }

  return out;
}

/**
 * Serialize a UiScreenModel into strict JSON text with deterministic formatting.
 *
 * @param {UiScreenModel} model
 * @param {UiJsonTextOptions} [opts]
 */
export function uiScreenModelToJsonText(model, opts = {}) {
  const indent = Number.isFinite(opts.indent) ? Number(opts.indent) : 2;
  const finalNewline = opts.finalNewline === undefined ? true : Boolean(opts.finalNewline);
  const obj = uiScreenModelToJson(model);
  // We intentionally avoid deep key sorting; determinism is achieved by
  // building objects in a canonical order in uiScreenModelToJson/uiNodeToJsonValue.
  return stableStringify(obj, { indent, sortKeys: false, finalNewline });
}
