/** Texture value states only: this module neither resolves paths nor assumes
 * Minecraft's coercion rules. Raw values remain in the authored model. */
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const dataValue = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value || {}, key);
  return descriptor && own(descriptor, 'value') ? descriptor.value : undefined;
};

/** Classify without String() coercion, trimming or altering the input. */
export function classifyTextureValue(value, present = true) {
  if (!present) return { present: false, state: 'absent', valueType: 'absent' };
  const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (valueType !== 'string') return { present: true, state: 'invalid-type', valueType };
  const state = value === '' ? 'empty' : !value.trim() ? 'whitespace'
    : /^[#$@]/u.test(value.trim()) || /^\(.*\)$/u.test(value.trim()) ? 'unresolved' : 'named';
  return { present: true, state, valueType, value };
}

/** Compute an observation from current model values, so edits cannot leave a
 * stale sidecar. `evaluatedProps` may contain only runtime differences. The
 * distinction describes the supplied model (a projection may already have
 * substituted inherited variables); it does not invent original source data. */
export function describeNodeTextureValue(node, evaluatedProps) {
  const present = node?.propsPresent?.texture === true;
  const raw = own(node?.unknownProps, 'texture') ? dataValue(node.unknownProps, 'texture') : dataValue(node?.props, 'texture');
  const authored = classifyTextureValue(raw, present);
  const overridden = own(evaluatedProps, 'texture');
  return {
    authored,
    evaluated: overridden ? classifyTextureValue(dataValue(evaluatedProps, 'texture')) : { ...authored },
    evaluation: overridden ? 'runtime-override' : 'model-value',
  };
}
