/*
  element-registry.js (S035)

  Minimal, in-code element registry schema.

  Purpose (this step):
  - Drive the Properties panel form generation for a small set of common
    Bedrock JSON UI properties.

  Non-goals:
  - Full Bedrock JSON UI schema coverage.
  - Advanced validation beyond basic type/range guards.
*/

/**
 * Anchor enum values for Bedrock JSON UI.
 *
 * Note: Canvas preview also accepts additional aliases (e.g. middle_left).
 */
export const ANCHOR_POINT_ENUM = Object.freeze([
  'top_left',
  'top_middle',
  'top_right',
  'left_middle',
  'center',
  'right_middle',
  'bottom_left',
  'bottom_middle',
  'bottom_right',
]);

/**
 * @typedef {'boolean'|'string'|'enum'|'dim2'} PropertyFieldKind
 */

/**
 * @typedef {object} PropertyFieldDef
 * @property {string} key
 * @property {string} label
 * @property {PropertyFieldKind} kind
 * @property {any} defaultValue
 * @property {string[]} [options]
 * @property {number} [min]  // numeric clamp (when parsed as number)
 * @property {number} [max]  // numeric clamp (when parsed as number)
 * @property {string[]} [axisLabels] // for dim2
 */

/**
 * @typedef {object} PropertyGroupDef
 * @property {string} id
 * @property {string} title
 * @property {PropertyFieldDef[]} fields
 */

const NUM_LIMIT_POS = 10000;

/** @type {PropertyGroupDef} */
const GROUP_LAYOUT = {
  id: 'layout',
  title: 'Layout',
  fields: [
    {
      key: 'offset',
      label: 'Position (offset)',
      kind: 'dim2',
      defaultValue: [0, 0],
      axisLabels: ['X', 'Y'],
      min: -NUM_LIMIT_POS,
      max: NUM_LIMIT_POS,
    },
    {
      key: 'size',
      label: 'Size',
      kind: 'dim2',
      defaultValue: ['default', 'default'],
      axisLabels: ['W', 'H'],
      min: 0,
      max: NUM_LIMIT_POS,
    },
  ],
};

/** @type {PropertyGroupDef} */
const GROUP_ANCHORS = {
  id: 'anchors',
  title: 'Anchors',
  fields: [
    {
      key: 'anchor_from',
      label: 'Anchor From',
      kind: 'enum',
      options: ANCHOR_POINT_ENUM.slice(),
      defaultValue: 'center',
    },
    {
      key: 'anchor_to',
      label: 'Anchor To',
      kind: 'enum',
      options: ANCHOR_POINT_ENUM.slice(),
      defaultValue: 'center',
    },
  ],
};

/** @type {PropertyGroupDef} */
const GROUP_VISIBILITY = {
  id: 'visibility',
  title: 'Visibility',
  fields: [
    {
      key: 'visible',
      label: 'Visible',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
};

/** @type {PropertyGroupDef} */
const GROUP_TEXT = {
  id: 'text',
  title: 'Text',
  fields: [
    {
      key: 'text',
      label: 'Text',
      kind: 'string',
      defaultValue: '',
    },
    {
      key: 'font_type',
      label: 'Font Type',
      kind: 'enum',
      options: ['default', 'unicode', 'rune', 'smooth', 'MinecraftTen'],
      defaultValue: 'default',
    },
    {
      key: 'font_size',
      label: 'Font Size',
      kind: 'enum',
      options: ['small', 'normal', 'large', 'extra_large'],
      defaultValue: 'normal',
    },
    {
      key: 'text_alignment',
      label: 'Text Align',
      kind: 'enum',
      options: ['left', 'center', 'right'],
      defaultValue: 'left',
    },
    {
      key: 'shadow',
      label: 'Shadow',
      kind: 'boolean',
      defaultValue: false,
    },
  ],
};

/**
 * Return the property groups that should be editable for a given element type.
 *
 * This is intentionally incomplete. In S035 we only cover the most common
 * layout/anchor/visibility/text properties.
 *
 * @param {string} type
 * @returns {PropertyGroupDef[]}
 */
export function getEditablePropertyGroupsForType(type) {
  const t = String(type || '').trim().toLowerCase();
  const groups = [GROUP_LAYOUT, GROUP_ANCHORS, GROUP_VISIBILITY];

  // Text is typically relevant for these.
  if (t === 'label' || t === 'button' || t === 'dropdown' || t === 'edit_box') {
    groups.push(GROUP_TEXT);
  }

  return groups;
}

/**
 * Get a stable set of all editable property keys for a given type.
 * @param {string} type
 */
export function getEditablePropertyKeysForType(type) {
  const groups = getEditablePropertyGroupsForType(type);
  const keys = new Set();
  for (const g of groups) {
    for (const f of g.fields) keys.add(String(f.key));
  }
  return keys;
}
