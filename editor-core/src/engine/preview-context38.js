/**
 * Explicit design-time event selection. Shared browser/Node ESM, no I/O.
 * This is not Minecraft event execution and never supplies ancestor geometry.
 */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const NAME = /^[A-Za-z0-9_.:\-]{1,128}$/u;
export const EVENT_FACTORY_SELECTION_LIMIT38 = 32;
export function normalizeEventFactorySelections38(value) {
  if (value === undefined) return Object.create(null);
  const fail = code => { const error = new Error(code); error.code = code; throw error; };
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) fail('UI_EVENT_FACTORY_SELECTIONS_INVALID');
  const keys = Object.keys(value);
  if (keys.length > EVENT_FACTORY_SELECTION_LIMIT38) fail('UI_EVENT_FACTORY_SELECTION_LIMIT');
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!NAME.test(key) || FORBIDDEN.has(key.toLowerCase()) || !descriptor || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'string' || !NAME.test(descriptor.value)
        || FORBIDDEN.has(descriptor.value.toLowerCase())) fail('UI_EVENT_FACTORY_SELECTION_INVALID');
    result[key] = descriptor.value;
  }
  return result;
}

export function isExplicitEventFactory38(node) {
  return node?.props?.__jsonui_preview_event_factory_materialized === true
    || node?.unknownProps?.__jsonui_preview_event_factory_materialized === true;
}
