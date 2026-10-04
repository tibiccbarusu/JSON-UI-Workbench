/*
  schema-generator.js (S053)

  Generates JSON Schema + metadata outputs for external tooling.

  Design goals:
  - Provide helpful auto-complete / validation hints.
  - Be conservative and allow unknown/unsupported fields (additionalProperties=true)
    because Bedrock JSON UI varies across versions and packs.
  - Stay aligned with the editor's internal registry of editable properties.

  NOTE:
  - These schemas are NOT a complete Bedrock JSON UI specification.
  - They are designed to match what this editor can currently model/edit.
*/

import { SUPPORTED_UI_ELEMENT_TYPES } from '../model/ui-screen-model.js';
import { ANCHOR_POINT_ENUM, getEditablePropertyGroupsForType, getEditablePropertyKeysForType } from '../model/element-registry.js';

/**
 * JSON Schema dialect used for exported schemas.
 * We default to Draft-07 for broad editor/tooling compatibility.
 * @returns {string}
 */
export function getSchemaDialectUri() {
  return 'https://json-schema.org/draft-07/schema';
}

/**
 * @param {any} v
 */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {{ min?: number, max?: number }} range
 */
function makeDimValueSchema(range = {}) {
  /** @type {any} */
  const num = { type: 'number' };
  if (isFiniteNumber(range.min)) num.minimum = range.min;
  if (isFiniteNumber(range.max)) num.maximum = range.max;
  return {
    anyOf: [
      num,
      { type: 'string' },
    ],
  };
}

/**
 * @param {any} field
 */
function fieldToJsonSchema(field) {
  const kind = String(field?.kind || '');
  const label = String(field?.label || '');
  const hint = String(field?.hint || '');
  const desc = hint ? `${label} — ${hint}` : label;

  if (kind === 'dim2') {
    const min = isFiniteNumber(field?.min) ? Number(field.min) : undefined;
    const max = isFiniteNumber(field?.max) ? Number(field.max) : undefined;
    const item = makeDimValueSchema({ min, max });
    return {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: [item, item],
      additionalItems: false,
      description: desc,
      default: Array.isArray(field?.defaultValue) ? field.defaultValue : undefined,
    };
  }

  if (kind === 'enum') {
    const options = Array.isArray(field?.options) ? field.options.map((s) => String(s)) : [];
    return {
      anyOf: [
        { type: 'string', enum: options },
        {
          type: 'string',
          minLength: 1,
          description: 'Runtime expression or forward-compatible engine choice.',
        },
      ],
      description: desc,
      default: field?.defaultValue !== undefined ? String(field.defaultValue) : undefined,
    };
  }

  if (kind === 'boolean') {
    return {
      anyOf: [
        { type: 'boolean' },
        { type: 'string', description: 'Runtime variable or expression.' },
      ],
      description: desc,
      default: Boolean(field?.defaultValue),
    };
  }

  if (kind === 'string') {
    return {
      type: 'string',
      description: desc,
      default: field?.defaultValue !== undefined ? String(field.defaultValue) : undefined,
    };
  }

  // Fallback: unknown field kind.
  return {
    description: desc || 'Unknown field kind (no schema hints available).',
  };
}

/**
 * @param {string} type
 */
function buildEditablePropsSchemaForType(type) {
  const groups = getEditablePropertyGroupsForType(type);
  /** @type {Record<string, any>} */
  const props = {};

  for (const g of groups) {
    const fields = Array.isArray(g?.fields) ? g.fields : [];
    for (const f of fields) {
      const key = String(f?.key || '').trim();
      if (!key) continue;
      props[key] = fieldToJsonSchema(f);
    }
  }

  return props;
}

/**
 * @returns {any}
 */
function buildBindingSchema() {
  return {
    type: 'object',
    description: 'Bedrock JSON UI binding entry (subset; unknown fields allowed).',
    properties: {
      ignored: { type: 'boolean' },
      binding_type: { type: 'string' },
      binding_name: { type: 'string' },
      binding_name_override: { type: 'string' },
      binding_collection_name: { type: 'string' },
      binding_collection_prefix: { type: 'string' },
      binding_condition: { type: 'string' },
      source_control_name: { type: 'string' },
      source_property_name: { type: 'string' },
      target_property_name: { type: 'string' },
      resolve_sibling_scope: { type: 'boolean' },
    },
    additionalProperties: true,
  };
}

/**
 * Element schema (covers supported element types).
 *
 * @returns {any}
 */
export function generateElementSchemaDraft07() {
  const dialect = getSchemaDialectUri();
  const types = Array.from(SUPPORTED_UI_ELEMENT_TYPES);

  /** @type {Record<string, any>} */
  const defs = {
    AnchorPoint: {
      anyOf: [
        { type: 'string', enum: Array.from(ANCHOR_POINT_ENUM) },
        {
          type: 'string',
          minLength: 1,
          description: 'Runtime expression or forward-compatible anchor choice.',
        },
      ],
      description: 'Anchor point enum (editor subset).',
    },
    Binding: buildBindingSchema(),
    InheritedOverrideBody: {
      type: 'object',
      description: 'Override body whose effective type is supplied by the @base name on its containing property.',
      additionalProperties: true,
    },
  };

  // Define each supported element type schema.
  for (const type of types) {
    const editableProps = buildEditablePropsSchemaForType(type);

    // Common container fields.
    const common = {
      type: { const: type, description: 'Bedrock control type.' },
      controls: {
        description: 'Child controls (array or map).',
        anyOf: [
          {
            type: 'array',
            items: {
              anyOf: [
                { $ref: '#/definitions/NamedControlEntry' },
                { $ref: '#/definitions/UiElement' },
                { type: 'string', description: 'String control reference (template).'},
              ],
            },
          },
          {
            $ref: '#/definitions/ControlMap',
          },
        ],
      },
      bindings: {
        type: 'array',
        description: 'Bindings (subset; unknown fields allowed).',
        items: { $ref: '#/definitions/Binding' },
      },
      // Helpful common keys (not all are editable in this step).
      texture: { type: 'string', description: 'Texture key/path (commonly used by image controls).' },
      text: { type: 'string', description: 'Text (commonly used by label/button/edit_box).' },
    };

    defs[`UiElement_${type}`] = {
      type: 'object',
      title: `UI element: ${type}`,
      description: `Bedrock JSON UI element (type=${type}). Editable property hints are generated from the editor registry.`,
      required: ['type'],
      properties: {
        ...common,
        ...editableProps,
        // Anchor helpers: expose enum defs for auto-complete even if the editor
        // currently only edits a subset of properties.
        anchor_from: { $ref: '#/definitions/AnchorPoint' },
        anchor_to: { $ref: '#/definitions/AnchorPoint' },
      },
      additionalProperties: true,
    };
  }

  // Preserve valid future/native element types without pretending the editor
  // can render them. Keeping the fallback disjoint from the supported const
  // branches makes Draft-07 oneOf validation deterministic.
  defs.UiElement_unsupported = {
    type: 'object',
    title: 'UI element: unsupported or future type',
    description: 'A valid engine element type not modeled by this editor build. Unknown fields are preserved.',
    required: ['type'],
    properties: {
      type: {
        type: 'string',
        minLength: 1,
        not: { enum: types },
      },
    },
    additionalProperties: true,
  };

  // Union type for recursion.
  defs.UiElement = {
    oneOf: [
      ...types.map((t) => ({ $ref: `#/definitions/UiElement_${t}` })),
      { $ref: '#/definitions/UiElement_unsupported' },
    ],
  };
  const inheritedControlKeyPatterns = {
    '@': { $ref: '#/definitions/InheritedOverrideBody' },
    '^\\$': { $ref: '#/definitions/InheritedOverrideBody' },
  };
  defs.ControlMap = {
    type: 'object',
    description: 'Map of named child controls. Only inherited or variable-backed keys may omit a direct type.',
    patternProperties: inheritedControlKeyPatterns,
    additionalProperties: { $ref: '#/definitions/UiElement' },
  };
  defs.NamedControlEntry = {
    type: 'object',
    minProperties: 1,
    maxProperties: 1,
    propertyNames: { type: 'string', minLength: 1 },
    patternProperties: inheritedControlKeyPatterns,
    additionalProperties: { $ref: '#/definitions/UiElement' },
  };

  return {
    $schema: dialect,
    title: 'JSONUI element (Bedrock JSON UI; editor subset)',
    description: 'Union schema covering supported Bedrock JSON UI element types for this editor. Not a full engine spec.',
    $ref: '#/definitions/UiElement',
    definitions: defs,
  };
}

/**
 * Screen file schema.
 *
 * NOTE: Uses a relative $ref to the element schema file.
 *
 * @param {{ elementSchemaRef?: string, inheritedSchemaRef?: string }} [opts]
 */
export function generateScreenSchemaDraft07(opts = {}) {
  const dialect = getSchemaDialectUri();
  const elementSchemaRef = String(opts.elementSchemaRef || './jsonui-element.schema.json#/definitions/UiElement');
  const inheritedSchemaRef = String(opts.inheritedSchemaRef || './jsonui-element.schema.json#/definitions/InheritedOverrideBody');

  return {
    $schema: dialect,
    title: 'JSONUI screen file (Bedrock JSON UI; editor subset)',
    description: 'Schema for a Bedrock JSON UI screen file. This expects a root namespace and element objects keyed by control name.',
    type: 'object',
    required: ['namespace'],
    properties: {
      $schema: { type: 'string', description: 'Optional schema dialect reference.' },
      format_version: { type: ['number', 'string'], description: 'Optional format version (varies by pack).' },
      namespace: { type: 'string', description: 'Root namespace (required by editor validation).' },
    },
    patternProperties: {
      '@': { $ref: inheritedSchemaRef },
    },
    additionalProperties: { $ref: elementSchemaRef },
  };
}

/**
 * ui/_ui_defs.json schema.
 */
export function generateUiDefsSchemaDraft07() {
  const dialect = getSchemaDialectUri();
  return {
    $schema: dialect,
    title: 'ui/_ui_defs.json (Bedrock JSON UI; editor subset)',
    description: 'Schema for ui/_ui_defs.json. Controls which UI screen JSON files are loaded by the game.',
    type: 'object',
    required: ['ui_defs'],
    properties: {
      $schema: { type: 'string' },
      format_version: { type: 'number' },
      ui_defs: {
        type: 'array',
        items: {
          type: 'string',
          description: 'Path to a UI JSON file (usually under ui/).',
        },
      },
    },
    additionalProperties: true,
  };
}

/**
 * ui/_global_variables.json schema.
 */
export function generateGlobalVariablesSchemaDraft07() {
  const dialect = getSchemaDialectUri();
  return {
    $schema: dialect,
    title: 'ui/_global_variables.json (Bedrock JSON UI; editor subset)',
    description: 'Schema for ui/_global_variables.json. This editor supports both wrapped and bare formats (see definitions).',
    anyOf: [
      { $ref: '#/definitions/wrapped' },
      { $ref: '#/definitions/bare' },
    ],
    definitions: {
      varMap: {
        type: 'object',
        description: 'Variable map (keys should start with $). Values may be strings, numbers, booleans, arrays, or objects.',
        patternProperties: {
          '^\\$': {},
        },
        additionalProperties: true,
      },
      wrapped: {
        type: 'object',
        title: 'Wrapped format',
        required: ['format_version', 'variables'],
        properties: {
          $schema: { type: 'string' },
          format_version: { type: 'number' },
          variables: { $ref: '#/definitions/varMap' },
        },
        additionalProperties: true,
      },
      bare: {
        type: 'object',
        title: 'Bare format',
        description: 'Variables at the root object level (keys should start with $).',
        properties: {
          $schema: { type: 'string' },
          format_version: { type: 'number' },
        },
        patternProperties: {
          '^\\$': {},
        },
        additionalProperties: true,
      },
    },
  };
}

/**
 * Metadata (not a schema): element types + editable properties.
 */
export function generateSchemaMetadata() {
  const types = Array.from(SUPPORTED_UI_ELEMENT_TYPES);
  /** @type {Record<string, string[]>} */
  const editableByType = {};
  for (const t of types) {
    editableByType[t] = Array.from(getEditablePropertyKeysForType(t));
  }

  return {
    schema_bundle_version: 2,
    schema_dialect: 'draft-07',
    schema_dialect_uri: getSchemaDialectUri(),
    supported_element_types: types,
    editable_properties_by_type: editableByType,
    notes: [
      'Generated from src/model/element-registry.js and src/model/ui-screen-model.js.',
      'This is not a complete Bedrock JSON UI specification; it is an editor-aligned subset.',
      'Schemas allow unknown fields via additionalProperties=true to reduce false positives.',
    ],
  };
}

/**
 * Generate the full schema bundle as an array of files.
 *
 * @returns {{ path: string, kind: 'schema'|'meta', json: any }[]}
 */
export function generateSchemaFilesDraft07() {
  return [
    { path: 'jsonui-element.schema.json', kind: 'schema', json: generateElementSchemaDraft07() },
    { path: 'jsonui-screen.schema.json', kind: 'schema', json: generateScreenSchemaDraft07() },
    { path: 'jsonui-ui_defs.schema.json', kind: 'schema', json: generateUiDefsSchemaDraft07() },
    { path: 'jsonui-global_variables.schema.json', kind: 'schema', json: generateGlobalVariablesSchemaDraft07() },
    { path: 'jsonui-metadata.json', kind: 'meta', json: generateSchemaMetadata() },
  ];
}
