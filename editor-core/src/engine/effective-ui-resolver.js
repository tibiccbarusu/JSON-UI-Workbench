/*
  Preview-only effective JSON UI resolver.

  Official documentation confirms @ inheritance but does not fully specify
  deep merge, arrays, or child override order. This resolver therefore uses a
  named, visible approximation profile and emits diagnostics for that boundary.
*/

import { parseDefinitionKey } from './ui-catalog.js';
import { parseFixedControlSpec } from './control-reference.js';
import { expressionReferenceTokens, safeEvalExpression } from '../bindings/bindings-evaluator.js';
import { createResolutionTrace } from './resolution-trace37.js';
import { copyVariableDefaultOrigins37, markVariableDefault37, markVariableExact37, shadowsAncestorDefault37 } from './lexical-defaults37.js';
import { normalizeEventFactorySelections38 } from './preview-context38.js';

const PROPERTY_NAMESPACES = Symbol('jsonui.preview.propertyNamespaces');
// Private provenance never becomes a Minecraft property or changes authored JSON.
const AUTHORED_SOURCE = Symbol('jsonui.preview.authoredSource');
const INHERITANCE_SOURCES = Symbol('jsonui.preview.inheritanceSources');
const GENERATED_SOURCE = Symbol('jsonui.preview.generatedSource');
const VARIABLE_DECLARATION_ORIGINS = Symbol('jsonui.preview.variableDeclarationOrigins37');
const pointerEscape = value => String(value).replace(/~/gu, '~0').replace(/\//gu, '~1');
function carryAuthoredSource(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return target;
  for (const symbol of [AUTHORED_SOURCE, GENERATED_SOURCE, INHERITANCE_SOURCES, VARIABLE_DECLARATION_ORIGINS]) if (source[symbol]) {
    Object.defineProperty(target, symbol, { value: source[symbol], enumerable: false, configurable: true });
  }
  return target;
}
function markGeneratedSource(target, kind) {
  if (isPlainObject(target)) Object.defineProperty(target, GENERATED_SOURCE, { value: kind, enumerable: false, configurable: true });
  return target;
}
const SEMANTICS_PROFILE = 'deep-object-array-replace-array-modifications-v3';
const MODIFIABLE_ARRAY_NAMES = new Set(['controls', 'bindings', 'button_mappings']);
const MAX_LOCAL_VARIABLE_BRANCHES = 256;
const MAX_VARIABLE_BASE_PASSES = 8;
// Keep the resolver's historical static-alias budget without relaxing the
// bindings evaluator's smaller runtime-reference safety limit.
const MAX_STATIC_VARIABLE_REFERENCES = 32;
const MAX_STATIC_EXPRESSION_LENGTH = 4096;
const MAX_FINAL_VARIABLE_DIAGNOSTICS = 256;
const MAX_FINAL_VARIABLE_SCAN_OBJECTS = 100000;
const MAX_FINAL_VARIABLE_PATH_EXAMPLES = 3;
const VARIABLE_TOKEN_PATTERN = /^\$[A-Za-z0-9_:@.\-]+$/;
const STATIC_REFERENCE_TOKEN_PATTERN = /^[#$][A-Za-z0-9_:@.\-]+$/;
const ANIMATION_REFERENCE_PROPERTIES = new Set(['anims', 'alpha', 'offset', 'size', 'uv', 'color']);
const STATIC_STRING_EXPRESSION_PROPERTIES = new Set(['text', 'texture']);

function qualifyAuthoredAnimationReference(value, namespace) {
  if (Array.isArray(value)) return value.map((entry) => qualifyAuthoredAnimationReference(entry, namespace));
  if (typeof value !== 'string' || !/^@[A-Za-z0-9_:\-]+$/u.test(value) || !namespace) return value;
  return `@${namespace}.${value.slice(1)}`;
}

const DEFAULT_LIMITS = Object.freeze({
  maxInheritanceDepth: 96,
  maxControlDepth: 192,
  maxResolvedObjects: 50000,
  maxModificationOperations: 4096,
  maxModificationMatchOperations: 250000,
  maxModifiedArrayItems: 10000,
  maxMaterializedGridItems: 256,
  maxMaterializedGridItemsTotal: 2500,
  maxMaterializedFactoryItems: 256,
  maxMaterializedCollectionItemsTotal: 2500,
  maxMaterializedObjects: 50000,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readOwnDataValue(record, key) {
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

function isSafeRuntimeName(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value.toLowerCase());
}

function isSafeGeneratedControlName(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_.:\-]+$/u.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value.toLowerCase());
}

function isSafeFixedCollectionScenarioName(value) {
  return isSafeRuntimeName(value) && !value.startsWith('$');
}

function attachPropertyNamespaces(target, namespaces) {
  if (!isPlainObject(target) || !namespaces || typeof namespaces !== 'object') return target;
  Object.defineProperty(target, PROPERTY_NAMESPACES, {
    value: { ...namespaces },
    enumerable: false,
    configurable: true,
  });
  return target;
}

function propertyNamespace(value, key) {
  const map = isPlainObject(value) ? value[PROPERTY_NAMESPACES] : null;
  return map && typeof map[key] === 'string' ? map[key] : '';
}

function cloneAuthoredValue(value, namespace, depth = 0, source = null, pointer = '') {
  if (depth > 256) throw new Error('UI_RESOLVE_CLONE_DEPTH');
  if (Array.isArray(value)) return value.map((item, index) => cloneAuthoredValue(item, namespace, depth + 1, source, `${pointer}/${index}`));
  if (!isPlainObject(value)) return value;
  const output = Object.create(null);
  const origins = Object.create(null);
  const declarationOrigins = Object.create(null);
  const declarationOwner = source ? { ...source, pointer } : null;
  for (const [key, child] of Object.entries(value)) {
    // Animation names belong to the file that authored the property. A
    // control inherited into another namespace must not redirect @fade to
    // that selected screen's unrelated @fade. Qualify only animation fields;
    // retain the original catalog/source JSON unchanged.
    const authored = ANIMATION_REFERENCE_PROPERTIES.has(key)
      ? qualifyAuthoredAnimationReference(child, namespace)
      : child;
    output[key] = cloneAuthoredValue(authored, namespace, depth + 1, source, `${pointer}/${pointerEscape(key)}`);
    origins[key] = namespace;
    if (declarationOwner && key.startsWith('$') && key !== '$schema') declarationOrigins[key] = declarationOwner;
  }
  if (source) Object.defineProperty(output, AUTHORED_SOURCE, {
    value: { ...source, pointer, rawKey: pointer.split('/').at(-1).replace(/~1/gu, '/').replace(/~0/gu, '~') },
    enumerable: false, configurable: true,
  });
  if (Object.keys(declarationOrigins).length) Object.defineProperty(output, VARIABLE_DECLARATION_ORIGINS, {
    value: declarationOrigins, enumerable: false, configurable: true,
  });
  return attachPropertyNamespaces(output, origins);
}

function cloneValue(value, depth = 0) {
  if (depth > 256) throw new Error('UI_RESOLVE_CLONE_DEPTH');
  if (Array.isArray(value)) return value.map((item) => cloneValue(item, depth + 1));
  if (isPlainObject(value)) {
    const output = Object.create(null);
    for (const [key, child] of Object.entries(value)) output[key] = cloneValue(child, depth + 1);
    return carryAuthoredSource(attachPropertyNamespaces(output, value[PROPERTY_NAMESPACES]), value);
  }
  return value;
}

function countMaterializationObjects(value, maximum) {
  const limit = Number.isFinite(Number(maximum))
    ? Math.max(0, Math.floor(Number(maximum)))
    : DEFAULT_LIMITS.maxMaterializedObjects;
  const stack = [value];
  const seen = new Set();
  let count = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) return limit + 1;
    seen.add(current);
    count += 1;
    if (count > limit) return count;
    let keys;
    try {
      keys = Object.keys(current);
    } catch {
      return limit + 1;
    }
    for (const key of keys) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch {
        return limit + 1;
      }
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return limit + 1;
      stack.push(descriptor.value);
    }
  }
  return count;
}

function replaceProvisionalVariableDiagnostics(diagnostics, resolvedRoot) {
  const retained = diagnostics.filter((item) => item?.code !== 'UI_VARIABLE_UNRESOLVED');
  const unresolved = new Map();
  const unresolvedPropertyExpressions = new Map();
  const stack = [{ value: resolvedRoot, path: '$', index: -1, keys: null }];
  const seen = new Set();
  let inspectedObjects = 0, work = 0;
  let truncated = false;
  const truncationReasons = new Set();
  const maximumWork = 250000;
  while (stack.length) {
    if (++work > maximumWork) { truncated = true; truncationReasons.add('WORK_LIMIT'); break; }
    const frame = stack[stack.length - 1], current = frame.value;
    if (frame.index < 0) {
      if (typeof current === 'string') {
        const property = frame.path.split('.').at(-1);
        const propertyExpression = property === 'layer'
          ? current.trim().startsWith('(') || current.trim().endsWith(')')
          : STATIC_STRING_EXPRESSION_PROPERTIES.has(property) && isParenthesizedStaticExpression(current);
        if (propertyExpression) {
          const expressionKey = `${property}\u0000${current}`;
          let row = unresolvedPropertyExpressions.get(expressionKey);
          if (!row && unresolvedPropertyExpressions.size < MAX_FINAL_VARIABLE_DIAGNOSTICS) {
            row = { property, expression: current, occurrences: 0, examples: [] };
            unresolvedPropertyExpressions.set(expressionKey, row);
          }
          if (row) { row.occurrences++; if (row.examples.length < MAX_FINAL_VARIABLE_PATH_EXAMPLES) row.examples.push(frame.path); }
          else { truncated = true; truncationReasons.add('EXPRESSION_DIAGNOSTIC_LIMIT'); }
        }
        if (VARIABLE_TOKEN_PATTERN.test(current)) {
          let row = unresolved.get(current);
          if (!row && unresolved.size < MAX_FINAL_VARIABLE_DIAGNOSTICS) {
            row = { occurrences: 0, examples: [] }; unresolved.set(current, row);
          }
          if (row) { row.occurrences++; if (row.examples.length < MAX_FINAL_VARIABLE_PATH_EXAMPLES) row.examples.push(frame.path); }
          else { truncated = true; truncationReasons.add('VARIABLE_DIAGNOSTIC_LIMIT'); }
        }
        stack.pop(); continue;
      }
      if (!current || typeof current !== 'object') { stack.pop(); continue; }
      if (seen.has(current)) { truncated = true; truncationReasons.add('REPEATED_OBJECT'); stack.pop(); continue; }
      seen.add(current);
      if (++inspectedObjects > MAX_FINAL_VARIABLE_SCAN_OBJECTS) { truncated = true; truncationReasons.add('OBJECT_LIMIT'); break; }
      // Numeric array frames keep retained work proportional to depth, not width.
      frame.keys = Array.isArray(current) ? null : Object.keys(current);
      frame.count = frame.keys ? frame.keys.length : current.length;
      frame.index = 0;
      frame.skipInactiveControls = (current.ignored === true && !hasPotentialBindingOverride(current, 'ignored'))
        || (current.visible === false && !hasPotentialBindingOverride(current, 'visible'));
    }
    if (frame.index >= frame.count) { stack.pop(); continue; }
    const key = frame.keys ? frame.keys[frame.index++] : String(frame.index++);
    if (key.startsWith('$') || key === 'variables' || (key === 'controls' && frame.skipInactiveControls)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) { truncated = true; truncationReasons.add('NON_DATA_PROPERTY'); continue; }
    stack.push({ value: descriptor.value, path: `${frame.path}.${String(key).slice(0, 128)}`.slice(0, 512), index: -1, keys: null });
  }
  diagnostics.length = 0;
  diagnostics.push(...retained);
  for (const [variable, row] of Array.from(unresolved.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    diagnostics.push({
      code: 'UI_VARIABLE_UNRESOLVED',
      severity: 'warning',
      certainty: 'approximation',
      variable,
      occurrences: row.occurrences,
      examples: row.examples,
    });
  }
  for (const row of unresolvedPropertyExpressions.values()) {
    diagnostics.push({
      code: 'UI_PROPERTY_EXPRESSION_UNRESOLVED', severity: 'warning', certainty: 'approximation',
      property: row.property, expression: row.expression.slice(0, 1024), occurrences: row.occurrences, examples: row.examples,
    });
  }
  if (truncated) {
    diagnostics.push({
      code: 'UI_VARIABLE_FINAL_SCAN_LIMIT',
      severity: 'warning',
      certainty: 'policy',
      maximumObjects: MAX_FINAL_VARIABLE_SCAN_OBJECTS,
      maximumVariables: MAX_FINAL_VARIABLE_DIAGNOSTICS,
      maximumWork,
      limitKinds: [...truncationReasons].sort(),
      observedWork: work,
      observedObjects: inspectedObjects,
      pendingFrames: stack.length,
      variableCount: unresolved.size,
      expressionCount: unresolvedPropertyExpressions.size,
      remainingValueCount: null,
    });
  }
}

function mergeApproximate(base, derived, depth = 0) {
  if (depth > 256) throw new Error('UI_RESOLVE_MERGE_DEPTH');
  if (!isPlainObject(base) || !isPlainObject(derived)) return cloneValue(derived, depth + 1);
  const output = cloneValue(base, depth + 1);
  const origins = { ...(output[PROPERTY_NAMESPACES] || {}) };
  const derivedOrigins = derived[PROPERTY_NAMESPACES] || {};
  const declarationOrigins = { ...(base[VARIABLE_DECLARATION_ORIGINS] || {}), ...(derived[VARIABLE_DECLARATION_ORIGINS] || {}) };
  for (const [key, value] of Object.entries(derived)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeApproximate(output[key], value, depth + 1);
    } else {
      // Arrays are replaced. This is an explicit approximation profile.
      output[key] = cloneValue(value, depth + 1);
    }
    if (typeof derivedOrigins[key] === 'string') origins[key] = derivedOrigins[key];
  }
  carryAuthoredSource(output, derived);
  if (Object.keys(declarationOrigins).length) Object.defineProperty(output, VARIABLE_DECLARATION_ORIGINS, {
    value: declarationOrigins, enumerable: false, configurable: true,
  });
  // The edit service needs the actual call edge, including inherited roots
  // that disappear after merging. Keep it private and bounded; never serialize
  // this metadata into a Minecraft definition.
  const inheritanceSources = [];
  const sourceKeys = new Set();
  for (const value of [base, derived]) for (const source of value[INHERITANCE_SOURCES] || (value[AUTHORED_SOURCE] ? [value[AUTHORED_SOURCE]] : [])) {
    const key = JSON.stringify([source.sourceId, source.path, source.pointer]);
    if (sourceKeys.has(key)) continue;
    if (inheritanceSources.length >= DEFAULT_LIMITS.maxInheritanceDepth + 1) throw new Error('UI_INHERITANCE_DEPTH_LIMIT');
    sourceKeys.add(key); inheritanceSources.push(source);
  }
  if (inheritanceSources.length) Object.defineProperty(output, INHERITANCE_SOURCES, {
    value: inheritanceSources, enumerable: false, configurable: true,
  });
  return attachPropertyNamespaces(output, origins);
}

function qualifyReference(reference, namespace) {
  const ref = String(reference || '').trim();
  if (!ref) return null;
  if (ref.includes('.')) return ref;
  const ns = String(namespace || '').trim();
  return ns ? `${ns}.${ref}` : ref;
}

function staticReferenceValue(token, variables) {
  if (Object.prototype.hasOwnProperty.call(variables, token)) return { found: true, value: variables[token] };
  const stripped = token.slice(1);
  if (Object.prototype.hasOwnProperty.call(variables, stripped)) return { found: true, value: variables[stripped] };
  if (!token.startsWith('#')) {
    const withHash = `#${token}`;
    if (Object.prototype.hasOwnProperty.call(variables, withHash)) return { found: true, value: variables[withHash] };
  }
  return { found: false, value: undefined };
}

function resolveBoundedStaticReference(token, variables) {
  if (!isPlainObject(variables)) return { ok: false, value: undefined };
  const seen = new Set();
  let current = String(token || '').trim();
  for (let depth = 0; depth < MAX_STATIC_VARIABLE_REFERENCES; depth += 1) {
    if (!STATIC_REFERENCE_TOKEN_PATTERN.test(current) || seen.has(current)) {
      return { ok: false, value: undefined };
    }
    seen.add(current);
    const candidate = staticReferenceValue(current, variables);
    if (!candidate.found) return { ok: false, value: undefined };
    if (typeof candidate.value !== 'string' || !STATIC_REFERENCE_TOKEN_PATTERN.test(candidate.value.trim())) {
      return { ok: true, value: candidate.value };
    }
    current = candidate.value.trim();
  }
  return { ok: false, value: undefined };
}

function variablesForStaticExpression(expression, variables) {
  const output = Object.create(null);
  if (!isPlainObject(variables)) return output;
  const source = String(expression || '');
  // Mirror safeEvalExpression's input bound before tokenization. Only expose
  // variables referenced by this expression; cloning a large lexical scope for
  // every conditional branch turns otherwise bounded UI files into an O(n*m)
  // main-thread workload.
  if (source.length > MAX_STATIC_EXPRESSION_LENGTH) return output;
  for (const token of expressionReferenceTokens(source)) {
    const resolved = resolveBoundedStaticReference(token, variables);
    if (resolved.ok) output[token] = resolved.value;
  }
  return output;
}

function evaluateStaticExpression(expression, variables) {
  return safeEvalExpression(expression, {
    mockData: variablesForStaticExpression(expression, variables),
    props: {},
  });
}

function isParenthesizedStaticExpression(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.startsWith('(') && text.endsWith(')');
}

function resolveStaticPropertyExpression(value, variables) {
  // A property can be an expression-valued variable forwarded across multiple
  // templates. Callers restrict both eligible property names and result types;
  // declarations, bindings and arbitrary authored strings remain untouched.
  const budget = { references: 0, sourceUnits: 0 };
  const evaluate = (expression, stack = []) => {
    const source = String(expression || '').trim();
    budget.sourceUnits += source.length;
    if (source.length > MAX_STATIC_EXPRESSION_LENGTH || budget.sourceUnits > 16384 || stack.length > 32) return undefined;
    const projected = Object.create(null);
    for (const token of expressionReferenceTokens(source)) {
      if (++budget.references > 256) return undefined;
      if (stack.includes(token)) continue;
      const resolved = resolveBoundedStaticReference(token, variables);
      if (!resolved.ok) continue;
      const terminal = isParenthesizedStaticExpression(resolved.value)
        ? evaluate(resolved.value, [...stack, token])
        : resolved.value;
      if (terminal !== undefined) projected[token] = terminal;
    }
    return safeEvalExpression(source, { mockData: projected, props: {} });
  };
  return evaluate(value);
}

function requirementMatches(requirement, variables) {
  if (requirement === undefined || requirement === null || requirement === '') return true;
  if (typeof requirement === 'boolean') return requirement;
  const text = typeof requirement === 'string' ? requirement.trim() : '';
  if (!text) return false;
  const result = evaluateStaticExpression(text, variables);
  return result === undefined ? false : staticTruthiness(result);
}

function resolveStaticPreviewBoolean(value, variables) {
  if (typeof value === 'boolean') return value;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  const result = evaluateStaticExpression(text, variables);
  return result === undefined ? null : staticTruthiness(result);
}

function staticTruthiness(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'no', 'off', 'hidden', ''].includes(normalized)) return false;
    if (['true', '1', 'yes', 'on', 'visible'].includes(normalized)) return true;
  }
  return Boolean(value);
}

function hasPotentialBindingOverride(value, propertyName) {
  if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, 'bindings')) return false;
  if (!Array.isArray(value.bindings)) return true;
  const expected = String(propertyName || '').replace(/^#/, '').toLowerCase();
  return value.bindings.some((binding) => {
    if (!isPlainObject(binding) || binding.ignored === true) return false;
    return [binding.binding_name_override, binding.target_property_name, binding.binding_name]
      .some((candidate) => typeof candidate === 'string'
        && candidate.trim().replace(/^#/, '').toLowerCase() === expected);
  });
}

function applyProtectedVariableOverrides(target, protectedOverrides, declaration = null) {
  if (!isPlainObject(target) || !isPlainObject(protectedOverrides)) return target;
  if (isPlainObject(declaration)) {
    // Only declarations can have displaced a protected value. Intersecting
    // with that small declaration avoids rescanning a large caller scope after
    // every matching conditional branch.
    for (const rawKey of Object.keys(declaration)) {
      if (!rawKey.startsWith('$') || rawKey === '$schema') continue;
      const [key] = rawKey.split('|');
      if (VARIABLE_TOKEN_PATTERN.test(key)
        && Object.prototype.hasOwnProperty.call(protectedOverrides, key)) {
        target[key] = protectedOverrides[key];
        markVariableExact37(target, key);
      }
    }
    return target;
  }
  for (const [key, child] of Object.entries(protectedOverrides)) {
    if (VARIABLE_TOKEN_PATTERN.test(key) && key !== '$schema') { target[key] = child; markVariableExact37(target, key); }
  }
  return target;
}

function collectExactVariableOverrides(variableState) {
  const output = Object.create(null);
  if (!variableState || !(variableState.exactKeys instanceof Set)) return output;
  for (const key of variableState.exactKeys) {
    if (VARIABLE_TOKEN_PATTERN.test(key)
      && Object.prototype.hasOwnProperty.call(variableState.variables, key)) {
      output[key] = variableState.variables[key];
    }
  }
  return output;
}

function mergeExactVariableOverrides(ownOverrides, callerOverrides) {
  const output = Object.create(null);
  if (isPlainObject(ownOverrides)) {
    for (const [key, child] of Object.entries(ownOverrides)) output[key] = child;
  }
  // A declaration on a more-derived caller wins over the same declaration on
  // every base record, while unrelated lexical variables retain normal scope.
  if (isPlainObject(callerOverrides)) {
    for (const [key, child] of Object.entries(callerOverrides)) output[key] = child;
  }
  return output;
}

function variableMapsEqual(left, right) {
  if (left === right) return true;
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
    && Object.is(left[key], right[key]));
}

function collectLocalVariableState(
  value,
  inherited = {},
  protectedOverrides = null,
  requirementContext = null,
) {
  // Lexical scopes are read-only after construction. Ordinary geometry,
  // binding and control wrappers declare no variables, so they can share the
  // parent's scope instead of copying hundreds of values during every pass.
  // With no declaration keys, applyProtectedVariableOverrides(declaration)
  // cannot alter anything either. Conditional/default/exact declarations all
  // retain the complete existing evaluation path below.
  if (isPlainObject(value) && isPlainObject(inherited)
    && !(Array.isArray(value.variables) && value.variables.length)
    && !Object.keys(value).some(key => key.startsWith('$') && key !== '$schema')) {
    return { variables: inherited, exactKeys: new Set(), truncatedBranches: 0 };
  }
  const output = Object.create(null);
  if (isPlainObject(inherited)) {
    for (const [key, child] of Object.entries(inherited)) output[key] = child;
  }
  copyVariableDefaultOrigins37(inherited, output);
  const requirementVariables = isPlainObject(requirementContext)
    ? copyVariableDefaultOrigins37(requirementContext, Object.assign(Object.create(null), requirementContext))
    : output;
  const exactKeys = new Set();
  if (!isPlainObject(value)) {
    applyProtectedVariableOverrides(output, protectedOverrides);
    if (requirementVariables !== output) applyProtectedVariableOverrides(requirementVariables, protectedOverrides);
    return { variables: output, exactKeys, truncatedBranches: 0 };
  }

  const applyDeclarationTo = (target, declaration, trackExactKeys) => {
    // A `|default` declaration is a fallback, not a later override. Resolve it
    // first so exact declarations win regardless of JSON member order
    // (Vanilla files commonly place the exact value before its fallback).
    for (const [key, child] of Object.entries(declaration)) {
      if (!key.startsWith('$') || key === '$schema') continue;
      const [normalized, modifier = ''] = key.split('|');
      const source = declaration[VARIABLE_DECLARATION_ORIGINS]?.[key] || declaration[AUTHORED_SOURCE];
      const defaultOrigin = source ? { kind: 'authored', domain: `${source.sourceId}\u0000${source.path}\u0000${source.recordId}`,
        pointer: source.pointer } : null;
      if (modifier.toLowerCase() === 'default' && normalized
        && (!Object.prototype.hasOwnProperty.call(target, normalized) || shadowsAncestorDefault37(target, normalized, defaultOrigin))) {
        target[normalized] = child;
        markVariableDefault37(target, normalized, defaultOrigin);
      }
    }
    for (const [key, child] of Object.entries(declaration)) {
      if (!key.startsWith('$') || key === '$schema') continue;
      const [normalized, modifier = ''] = key.split('|');
      if (normalized && modifier.toLowerCase() !== 'default') {
        if (trackExactKeys) exactKeys.add(normalized);
        // Vanilla commonly forwards a caller-scoped variable through an
        // intermediate control with `$name: "$name"`. Preserve the concrete
        // inherited/default value instead of replacing it with a self-cycle.
        const selfForward = typeof child === 'string' && child.trim() === normalized;
        if (!(selfForward && Object.prototype.hasOwnProperty.call(target, normalized))) {
          target[normalized] = child;
          markVariableExact37(target, normalized);
        }
      }
    }
  };
  const applyDeclaration = (declaration) => {
    applyDeclarationTo(output, declaration, true);
    if (requirementVariables !== output) applyDeclarationTo(requirementVariables, declaration, false);
  };

  applyDeclaration(value);
  applyProtectedVariableOverrides(output, protectedOverrides, value);
  if (requirementVariables !== output) applyProtectedVariableOverrides(requirementVariables, protectedOverrides, value);
  // Conditional variable branches are evaluated in declaration order. This
  // allows a later branch to depend on a variable established by the control
  // or by an earlier matching branch, while malformed/unknown requirements
  // remain fail-closed.
  if (Array.isArray(value.variables)) {
    for (const branch of value.variables.slice(0, MAX_LOCAL_VARIABLE_BRANCHES)) {
      if (isPlainObject(branch) && requirementMatches(branch.requires, requirementVariables)) {
        applyDeclaration(branch);
        applyProtectedVariableOverrides(output, protectedOverrides, branch);
        if (requirementVariables !== output) applyProtectedVariableOverrides(requirementVariables, protectedOverrides, branch);
      }
    }
  }
  return {
    variables: output,
    exactKeys,
    truncatedBranches: Math.max(0, (Array.isArray(value.variables) ? value.variables.length : 0) - MAX_LOCAL_VARIABLE_BRANCHES),
  };
}

function collectLocalVariables(value, inherited = {}, protectedOverrides = null) {
  return collectLocalVariableState(value, inherited, protectedOverrides).variables;
}

function substituteVariables(value, variables, diagnostics, variableStack = [], depth = 0, protectedOverrides = null) {
  if (depth > 256) throw new Error('UI_VARIABLE_DEPTH');
  if (typeof value === 'string' && VARIABLE_TOKEN_PATTERN.test(value)) {
    if (!Object.prototype.hasOwnProperty.call(variables, value)) {
      diagnostics.push({ code: 'UI_VARIABLE_UNRESOLVED', severity: 'warning', certainty: 'approximation', variable: value });
      return value;
    }
    if (variableStack.includes(value)) {
      diagnostics.push({ code: 'UI_VARIABLE_CYCLE', severity: 'error', certainty: 'observed', cycle: [...variableStack, value] });
      return value;
    }
    return substituteVariables(variables[value], variables, diagnostics, [...variableStack, value], depth + 1);
  }
  if (Array.isArray(value)) return value.map((item) => substituteVariables(item, variables, diagnostics, variableStack, depth + 1));
  if (!isPlainObject(value)) return value;
  const variableState = collectLocalVariableState(value, variables, protectedOverrides);
  const scopedVariables = variableState.variables;
  const skipInactiveControls = (
    (resolveStaticPreviewBoolean(value.ignored, scopedVariables) === true
      && !hasPotentialBindingOverride(value, 'ignored'))
    || (resolveStaticPreviewBoolean(value.visible, scopedVariables) === false
      && !hasPotentialBindingOverride(value, 'visible'))
  );
  if (variableState.truncatedBranches > 0) {
    diagnostics.push({
      code: 'UI_VARIABLE_BRANCH_LIMIT',
      severity: 'warning',
      certainty: 'policy',
      maximum: MAX_LOCAL_VARIABLE_BRANCHES,
      truncated: variableState.truncatedBranches,
    });
  }
  const output = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    // `variables` contains declarations, not a nested control scope. Its
    // requirements were already evaluated above; walking every branch would
    // repeatedly clone the complete lexical map and would also freeze authored
    // runtime requirements to this one representative preview state.
    const substituted = key.startsWith('$') || (key === 'variables' && Array.isArray(child))
      || (key === 'controls' && skipInactiveControls)
      ? cloneValue(child)
      : substituteVariables(child, scopedVariables, diagnostics, variableStack, depth + 1);
    if (key === 'visible' || key === 'enabled' || key === 'ignored') {
      const staticBoolean = resolveStaticPreviewBoolean(substituted, scopedVariables);
      output[key] = staticBoolean === null ? substituted : staticBoolean;
    } else if (key === 'layer' && isParenthesizedStaticExpression(substituted)) {
      const staticLayer = resolveStaticPropertyExpression(substituted, scopedVariables);
      output[key] = typeof staticLayer === 'number' && Number.isFinite(staticLayer) ? staticLayer : substituted;
    } else if (STATIC_STRING_EXPRESSION_PROPERTIES.has(key) && isParenthesizedStaticExpression(substituted)) {
      // The shipped how_to_play controls construct localization keys this way.
      // Keep resulting #tokens intact for the later runtime binding pass.
      const staticString = resolveStaticPropertyExpression(substituted, scopedVariables);
      output[key] = typeof staticString === 'string' && staticString.length <= 65536 ? staticString : substituted;
    } else {
      const declarationNamespace = typeof child === 'string' && VARIABLE_TOKEN_PATTERN.test(child)
        ? propertyNamespace(value, child) || propertyNamespace(value, `${child}|default`)
        : '';
      output[key] = ANIMATION_REFERENCE_PROPERTIES.has(key)
        ? qualifyAuthoredAnimationReference(substituted, declarationNamespace || propertyNamespace(value, key))
        : substituted;
    }
  }
  return carryAuthoredSource(attachPropertyNamespaces(output, value[PROPERTY_NAMESPACES]), value);
}

/**
 * Merge explicitly declared design-time collection binding values. User mock
 * data is applied last so the representative skeleton never locks the preview
 * into one scenario.
 */
export function mergeRepresentativeCollectionMockData(representativeCollections, userMockData = {}) {
  const merged = Object.create(null);
  if (isPlainObject(representativeCollections)) {
    for (const entry of Object.values(representativeCollections)) {
      if (!isPlainObject(entry) || !isPlainObject(entry.bindingValues)) continue;
      Object.assign(merged, entry.bindingValues);
    }
  }
  if (isPlainObject(userMockData)) Object.assign(merged, userMockData);
  return merged;
}

export function resolveEffectiveUi(options) {
  const catalog = options && options.catalog;
  const recordId = String(options && options.recordId ? options.recordId : '');
  const limits = { ...DEFAULT_LIMITS, ...((options && options.limits) || {}) };
  const representativeCollections = isPlainObject(options && options.representativeCollections)
    ? options.representativeCollections
    : {};
  if (!catalog || !catalog.recordsById || !catalog.symbols) {
    return { ok: false, error: { code: 'UI_CATALOG_REQUIRED' }, diagnostics: [] };
  }

  const selected = Object.hasOwn(catalog.recordsById, recordId) ? catalog.recordsById[recordId] : null;
  if (!selected) return { ok: false, error: { code: 'UI_DEFINITION_NOT_FOUND', recordId }, diagnostics: [] };
  if (selected.profile === 'pocket') {
    return {
      ok: false,
      error: { code: 'POCKET_PREVIEW_BLOCKED', filePath: selected.filePath, definition: selected.localName },
      diagnostics: [{ code: 'POCKET_PREVIEW_BLOCKED', severity: 'error', certainty: 'policy', recordId }],
    };
  }

  const diagnostics = [{
    code: 'UI_MERGE_PROFILE_APPROXIMATE',
    severity: 'info',
    certainty: 'approximation',
    profile: SEMANTICS_PROFILE,
  }];
  const factoryMaterializationLimitDiagnostics = new Map();
  const factoryControlIdDiagnostics = new Map();
  const factoryTemplateCycleDiagnostics = new Map();
  const provenanceIds = new Set();
  const dependencyTrace = createResolutionTrace(selected.id);
  const authoredRecordValues = new Map();
  const reportedVariableBranchLimits = new Set();
  // Child bases are expanded after merging, separately from the record-level
  // inheritance stack. Keep that active path only for failure diagnostics;
  // a repeated template can terminate through an authored child override.
  const activeControlReferences = [];
  let resolvedObjects = 0;
  let modificationsSeen = 0;
  let appliedModifications = 0;
  let unsupportedModifications = 0;
  let modificationValueObjects = 0;
  // Speculative fixed-point passes roll back final-result stats, but their
  // actual work must continue to consume the safety budgets.
  let resolvedObjectWork = 0;
  let modificationOperationWork = 0;
  let modificationMatchWork = 0;
  let modificationValueObjectWork = 0;
  let materializedObjects = 0;
  let materializedGridItems = 0;
  let materializedFactoryItems = 0;
  let requestedGridItems = 0;
  let requestedFactoryItems = 0;
  let recordResolutionWork = 0;
  let fixedPointRetries = 0;

  const selectedSummary = {
    recordId: selected.id, filePath: selected.filePath, namespace: selected.namespace,
    definition: selected.localName, qualifiedName: selected.qualifiedName,
    classification: selected.classification, profile: selected.profile,
  };
  const eventFactorySelections = Object.create(null);
  const eventFactoryVisits = new Map();
  const materializedEventFactories = [];
  function progressStats() {
    return {
      resolvedObjects, resolvedObjectWork, recordResolutionWork, fixedPointRetries,
      discardedResolvedObjects: Math.max(0, resolvedObjectWork - resolvedObjects),
      provenanceRecords: provenanceIds.size,
      materializedGridItems, materializedFactoryItems, materializedObjects,
      requestedGridItems, requestedFactoryItems,
      modificationsSeen, appliedModifications, unsupportedModifications,
      modificationOperationWork, modificationMatchWork, modificationValueObjectWork,
    };
  }
  function failResolutionLimit(code, name, consumed, contextRecordId, controlDepth = null) {
    const error = new Error(code);
    error.resolutionLimit = { name, maximum: limits[name], consumed };
    const activeRecordId = controlDepth === null ? contextRecordId : activeControlReferences.at(-1) || contextRecordId;
    const record = catalog.recordsById[activeRecordId] || selected;
    // Failure reports contain identity and counters only, never authored trees,
    // lexical values or a potentially unbounded inheritance stack.
    error.resolutionContext = {
      recordId: String(record.id).slice(0, 512),
      qualifiedName: String(record.qualifiedName).slice(0, 512),
      filePath: String(record.filePath).slice(0, 512),
      ...(controlDepth === null ? {} : { controlDepth }),
    };
    if (activeControlReferences.length) {
      const identify = id => ({
        recordId: String(id).slice(0, 512),
        qualifiedName: String(catalog.recordsById[id]?.qualifiedName || '').slice(0, 512),
      });
      error.resolutionContext.controlReferences = activeControlReferences.slice(-8).map(identify);
      error.resolutionContext.omittedControlReferences = Math.max(0, activeControlReferences.length - 8);
      const repeated = activeControlReferences.find((id, index) => activeControlReferences.indexOf(id) !== index);
      if (repeated) error.resolutionContext.repeatedControlReference = identify(repeated);
    }
    throw error;
  }

  function recordFactoryMaterializationLimit(template, collectionName, requested, materialized) {
    const key = `${String(template || '')}\u0000${String(collectionName || '')}`;
    const existing = factoryMaterializationLimitDiagnostics.get(key);
    if (existing) {
      existing.occurrences += 1;
      existing.requestedTotal += requested;
      existing.materializedTotal += materialized;
      return;
    }
    const diagnostic = {
      code: 'UI_FACTORY_MATERIALIZATION_LIMIT',
      severity: 'warning',
      certainty: 'policy',
      template,
      collectionName,
      requested,
      materialized,
      occurrences: 1,
      requestedTotal: requested,
      materializedTotal: materialized,
    };
    diagnostics.push(diagnostic);
    factoryMaterializationLimitDiagnostics.set(key, diagnostic);
  }

  function recordFactoryControlIdDiagnostic(factoryName, scenarioName, reason, controlId = '') {
    const key = `${String(factoryName || '')}\u0000${String(scenarioName || '')}\u0000${String(reason || '')}\u0000${String(controlId || '')}`;
    const existing = factoryControlIdDiagnostics.get(key);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    const diagnostic = {
      code: 'UI_FACTORY_CONTROL_ID_UNRESOLVED',
      severity: 'warning',
      certainty: 'approximation',
      factoryName,
      scenarioName,
      reason,
      occurrences: 1,
      ...(controlId ? { controlId } : {}),
    };
    diagnostics.push(diagnostic);
    factoryControlIdDiagnostics.set(key, diagnostic);
  }

  function recordFactoryTemplateCycle(template, collectionName) {
    const key = `${String(template || '')}\u0000${String(collectionName || '')}`;
    const existing = factoryTemplateCycleDiagnostics.get(key);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    const diagnostic = {
      code: 'UI_FACTORY_TEMPLATE_CYCLE',
      severity: 'warning',
      certainty: 'observed',
      template,
      collectionName,
      occurrences: 1,
    };
    diagnostics.push(diagnostic);
    factoryTemplateCycleDiagnostics.set(key, diagnostic);
  }

  function remainingMaterializedObjectBudget() {
    const maximum = Number.isFinite(Number(limits.maxMaterializedObjects))
      ? Math.max(0, Math.floor(Number(limits.maxMaterializedObjects)))
      : DEFAULT_LIMITS.maxMaterializedObjects;
    return Math.max(0, maximum - materializedObjects);
  }

  function lookupReference(reference, namespace, options = {}) {
    const qualifiedName = qualifyReference(reference, namespace);
    const symbol = qualifiedName ? catalog.symbols[qualifiedName] : null;
    if (!symbol) return null;
    const excluded = options.excludeRecordId ? String(options.excludeRecordId) : null;
    const maxPrecedenceExclusive = Number.isFinite(options.maxPrecedenceExclusive)
      ? Number(options.maxPrecedenceExclusive)
      : null;
    const candidateIds = Array.isArray(symbol.candidateIds) ? symbol.candidateIds : [symbol.winnerId];
    for (const candidateId of candidateIds) {
      if (excluded && String(candidateId) === excluded) continue;
      const record = catalog.recordsById[candidateId];
      if (record && maxPrecedenceExclusive !== null && Number(record.precedence) >= maxPrecedenceExclusive) continue;
      if (record) return record;
    }
    return null;
  }

  function diagnoseDynamicBase(baseRef, context) {
    diagnostics.push({
      code: 'UI_DYNAMIC_BASE_UNRESOLVED',
      severity: 'warning',
      certainty: 'approximation',
      baseRef,
      ...context,
    });
  }

  /**
   * Follow a dynamic `@` base through aliases such as
   * `$toggle_image -> $unchecked_image -> common.empty_panel`.
   * This is intentionally narrower than general expression evaluation: every
   * intermediate value must be a plain string variable reference and the
   * terminal value must be a non-empty symbol name.
   */
  function resolveDynamicBaseReference(baseRef, variables) {
    const maxDepth = Math.max(0, Math.floor(Number(limits.maxInheritanceDepth) || 0));
    const seen = new Set();
    const variableChain = [];
    let current = String(baseRef || '').trim();

    for (let depth = 0; ; depth += 1) {
      const terminalBaseOnly = current.startsWith('@');
      current = current.replace(/^@/, '').trim();
      if (!current.startsWith('$')) {
        return current
          ? { ok: true, resolvedReference: current, terminalBaseOnly, variableChain }
          : { ok: false, resolvedReference: '', reason: 'EMPTY_TARGET', variableChain };
      }
      if (seen.has(current)) {
        return {
          ok: false,
          resolvedReference: '',
          reason: 'VARIABLE_CYCLE',
          variableChain: [...variableChain, current],
        };
      }
      if (depth >= maxDepth) {
        return {
          ok: false,
          resolvedReference: '',
          reason: 'VARIABLE_DEPTH_LIMIT',
          variableChain: [...variableChain, current],
        };
      }
      seen.add(current);
      variableChain.push(current);
      if (!isPlainObject(variables) || !Object.prototype.hasOwnProperty.call(variables, current)) {
        return { ok: false, resolvedReference: '', reason: 'VARIABLE_UNDEFINED', variableChain };
      }
      const next = variables[current];
      if (typeof next !== 'string') {
        return { ok: false, resolvedReference: '', reason: 'VARIABLE_NON_STRING', variableChain };
      }
      current = next.trim();
    }
  }

  function skipModification(reason, context = {}) {
    unsupportedModifications += 1;
    diagnostics.push({
      code: 'UI_MODIFICATION_SKIPPED',
      severity: 'warning',
      certainty: 'approximation',
      reason,
      ...context,
    });
  }

  function normalizeModificationValues(value) {
    const values = Array.isArray(value) ? value : [value];
    if (!values.length || values.some((item) => !isPlainObject(item))) return null;
    return values;
  }

  function reserveModificationValues(values, copies, context) {
    const stack = values.map((value) => ({ value, depth: 0 }));
    let nodes = 0;
    while (stack.length) {
      const current = stack.pop();
      if (!current) break;
      if (current.depth > limits.maxControlDepth) {
        skipModification('VALUE_DEPTH_LIMIT', context);
        return false;
      }
      const child = current.value;
      if (!Array.isArray(child) && !isPlainObject(child)) continue;
      nodes += 1;
      if (nodes > limits.maxResolvedObjects) {
        skipModification('VALUE_OBJECT_LIMIT', context);
        return false;
      }
      for (const nested of Array.isArray(child) ? child : Object.values(child)) {
        stack.push({ value: nested, depth: current.depth + 1 });
      }
    }

    const generated = nodes * Math.max(1, copies);
    if (!Number.isSafeInteger(generated)
      || modificationValueObjectWork + generated > limits.maxResolvedObjects
      || resolvedObjectWork + generated > limits.maxResolvedObjects) {
      skipModification('VALUE_OBJECT_LIMIT', context);
      return false;
    }
    modificationValueObjects += generated;
    modificationValueObjectWork += generated;
    return true;
  }

  function readControlSelector(modification) {
    if (typeof modification.control_name === 'string' && modification.control_name.trim()) {
      return { ok: true, value: modification.control_name.trim() };
    }
    if (typeof modification.where === 'string' && modification.where.trim()) {
      return { ok: true, value: modification.where.trim() };
    }
    if (isPlainObject(modification.where)
      && typeof modification.where.control_name === 'string'
      && modification.where.control_name.trim()) {
      return { ok: true, value: modification.where.control_name.trim() };
    }
    return { ok: false, value: '' };
  }

  function controlMatchesSelector(control, selector) {
    if (!isPlainObject(control)) return false;
    return Object.keys(control).some((rawKey) => {
      const parsed = parseDefinitionKey(rawKey);
      return rawKey === selector || parsed.localName === selector;
    });
  }

  function modificationMatcher(modification, arrayName, operation) {
    // Controls use their authored instance name; bindings and mappings use a
    // shallow equality predicate. Never evaluate a selector as JavaScript or
    // accept an empty predicate that would silently match every entry.
    if (arrayName === 'controls') {
      const selector = readControlSelector(modification);
      if (selector.ok) {
        if (isPlainObject(modification.where)
          && Object.keys(modification.where).some((key) => key !== 'control_name')) return null;
        return { description: selector.value, matches: (item) => controlMatchesSelector(item, selector.value) };
      }
      if (operation === 'move_front' || operation === 'move_back') {
        const values = normalizeModificationValues(modification.value);
        if (!values || values.length !== 1 || Object.keys(values[0]).length !== 1) return null;
        const name = Object.keys(values[0])[0];
        return { description: name, matches: (item) => controlMatchesSelector(item, name) };
      }
      return null;
    }
    const where = modification.where;
    if (!isPlainObject(where)) return null;
    const entries = Object.entries(where);
    if (!entries.length || entries.length > 16 || entries.some(([key, value]) => (
      !isSafeRuntimeName(key) || (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
    ))) return null;
    return {
      description: Object.fromEntries(entries),
      matches: (item) => isPlainObject(item) && entries.every(([key, value]) => (
        Object.prototype.hasOwnProperty.call(item, key) && Object.is(readOwnDataValue(item, key), value)
      )),
    };
  }

  function applyObjectModifications(output, modifications, context) {
    const operationLimit = Math.max(0, Math.floor(Number(limits.maxModificationOperations) || 0));
    const matchLimit = Number.isFinite(Number(limits.maxModificationMatchOperations))
      ? Math.max(0, Math.floor(Number(limits.maxModificationMatchOperations)))
      : DEFAULT_LIMITS.maxModificationMatchOperations;
    const remaining = Math.max(0, operationLimit - modificationOperationWork);
    const processCount = Math.min(modifications.length, remaining);

    for (let index = 0; index < processCount; index += 1) {
      modificationsSeen += 1;
      modificationOperationWork += 1;
      const modification = modifications[index];
      const operationContext = { ...context, index };
      if (!isPlainObject(modification)) {
        skipModification('INVALID_ENTRY', operationContext);
        continue;
      }
      const arrayName = String(modification.array_name
        || (typeof modification.control_name === 'string' ? 'controls' : '')).trim();
      const operation = String(modification.operation || '').trim().toLowerCase();
      Object.assign(operationContext, { arrayName, operation });
      if (!MODIFIABLE_ARRAY_NAMES.has(arrayName)) {
        skipModification('ARRAY_UNSUPPORTED', operationContext);
        continue;
      }
      if (!['insert_front', 'insert_back', 'insert_before', 'insert_after',
        'move_front', 'move_back', 'remove', 'replace'].includes(operation)) {
        skipModification('OPERATION_UNSUPPORTED', operationContext);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(output, arrayName) || !Array.isArray(output[arrayName])) {
        skipModification('TARGET_ARRAY_NOT_FOUND', operationContext);
        continue;
      }
      const target = output[arrayName];
      const arrayLimit = Math.max(0, Math.floor(Number(limits.maxModifiedArrayItems) || 0));
      // Count array traversal as real work, including speculative inheritance
      // passes. No selector may partially mutate an array when this runs out.
      if (modificationMatchWork + target.length > matchLimit) {
        skipModification('MATCH_OPERATION_LIMIT', { ...operationContext, limit: matchLimit });
        continue;
      }
      modificationMatchWork += target.length;
      if (operation === 'insert_front' || operation === 'insert_back') {
        const values = normalizeModificationValues(modification.value);
        if (!values) { skipModification('INVALID_VALUE', operationContext); continue; }
        if (target.length + values.length > arrayLimit) {
          skipModification('ARRAY_ITEM_LIMIT', operationContext); continue;
        }
        if (!reserveModificationValues(values, 1, operationContext)) continue;
        const inserted = values.map((value) => cloneValue(value));
        output[arrayName] = operation === 'insert_front' ? [...inserted, ...target] : [...target, ...inserted];
        appliedModifications += 1;
        continue;
      }
      const selector = modificationMatcher(modification, arrayName, operation);
      if (!selector) {
        skipModification(arrayName === 'controls' ? 'CONTROL_SELECTOR_REQUIRED' : 'PROPERTY_SELECTOR_REQUIRED', operationContext);
        continue;
      }
      const matchingIndexes = [];
      for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
        if (selector.matches(target[targetIndex])) matchingIndexes.push(targetIndex);
      }
      if (!matchingIndexes.length) {
        skipModification(arrayName === 'controls' ? 'CONTROL_NOT_FOUND' : 'ARRAY_ITEM_NOT_FOUND', {
          ...operationContext, selector: selector.description,
        });
        continue;
      }
      const matches = new Set(matchingIndexes);
      if (operation === 'remove' || operation === 'move_front' || operation === 'move_back') {
        const retained = target.filter((_item, targetIndex) => !matches.has(targetIndex));
        const moved = operation === 'remove' ? [] : matchingIndexes.map((targetIndex) => target[targetIndex]);
        output[arrayName] = operation === 'move_front' ? [...moved, ...retained] : [...retained, ...moved];
        appliedModifications += 1;
        continue;
      }
      const values = normalizeModificationValues(modification.value);
      if (!values) { skipModification('INVALID_VALUE', operationContext); continue; }
      const resultLength = target.length + values.length * matchingIndexes.length
        - (operation === 'replace' ? matchingIndexes.length : 0);
      if (!Number.isSafeInteger(resultLength) || resultLength > arrayLimit) {
        skipModification('ARRAY_ITEM_LIMIT', operationContext); continue;
      }
      if (!reserveModificationValues(values, matchingIndexes.length, operationContext)) continue;
      const replaced = [];
      for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
        if (!matches.has(targetIndex)) { replaced.push(target[targetIndex]); continue; }
        if (operation === 'insert_after') replaced.push(target[targetIndex]);
        for (const value of values) replaced.push(cloneValue(value));
        if (operation === 'insert_before') replaced.push(target[targetIndex]);
      }
      output[arrayName] = replaced;
      appliedModifications += 1;
    }
    const skippedByLimit = modifications.length - processCount;
    if (skippedByLimit > 0) {
      modificationsSeen += skippedByLimit;
      unsupportedModifications += skippedByLimit;
      diagnostics.push({
        code: 'UI_MODIFICATION_OPERATION_LIMIT', severity: 'warning', certainty: 'policy',
        count: skippedByLimit, limit: operationLimit, ...context,
      });
    }
  }

  function applyModificationsDeep(value, context = {}, depth = 0) {
    if (depth > limits.maxControlDepth) throw new Error('UI_CONTROL_DEPTH_LIMIT');
    if (Array.isArray(value)) {
      return value.map((item) => applyModificationsDeep(item, context, depth + 1));
    }
    if (!isPlainObject(value)) return value;

    const output = Object.create(null);
    const origins = { ...(value[PROPERTY_NAMESPACES] || {}) };
    delete origins.modifications;
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'modifications') output[key] = cloneValue(child);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'modifications')) {
      if (Array.isArray(value.modifications)) {
        applyObjectModifications(output, value.modifications, context);
      } else {
        modificationsSeen += 1;
        skipModification('INVALID_MODIFICATIONS_ARRAY', context);
      }
    }
    const needsChildInheritance = rawKey => Boolean(parseDefinitionKey(rawKey).baseRef) || rawKey.startsWith('$');
    for (const [key, child] of Object.entries(output)) {
      if (key === 'controls' && Array.isArray(child)) {
        output[key] = child.map(wrapper => {
          const keys = isPlainObject(wrapper) ? Object.keys(wrapper) : [];
          // Child modifications need the child's inherited array. Applying
          // them now would discard a valid insertion before @base is merged.
          return keys.length === 1 && isPlainObject(wrapper[keys[0]]) && needsChildInheritance(keys[0])
            ? cloneValue(wrapper) : applyModificationsDeep(wrapper, context, depth + 1);
        });
      } else if (key === 'controls' && isPlainObject(child)) {
        const controls = Object.create(null);
        for (const [name, body] of Object.entries(child)) controls[name] = needsChildInheritance(name)
          ? cloneValue(body) : applyModificationsDeep(body, context, depth + 1);
        output[key] = carryAuthoredSource(attachPropertyNamespaces(controls, child[PROPERTY_NAMESPACES]), child);
      } else output[key] = applyModificationsDeep(child, context, depth + 1);
    }
    return carryAuthoredSource(attachPropertyNamespaces(output, origins), value);
  }

  function captureResolutionAttemptState() {
    return {
      diagnosticsLength: diagnostics.length,
      dependencyTrace: dependencyTrace.capture(),
      provenanceIdsSize: provenanceIds.size,
      reportedVariableBranchLimitsSize: reportedVariableBranchLimits.size,
      resolvedObjects,
      modificationsSeen,
      appliedModifications,
      unsupportedModifications,
      modificationValueObjects,
    };
  }

  function restoreResolutionAttemptState(snapshot) {
    fixedPointRetries += 1;
    diagnostics.length = snapshot.diagnosticsLength;
    dependencyTrace.restore(snapshot.dependencyTrace);
    let retainedProvenanceIds = 0;
    for (const id of provenanceIds) {
      if (retainedProvenanceIds >= snapshot.provenanceIdsSize) provenanceIds.delete(id);
      retainedProvenanceIds += 1;
    }
    let retainedVariableBranchLimits = 0;
    for (const key of reportedVariableBranchLimits) {
      if (retainedVariableBranchLimits >= snapshot.reportedVariableBranchLimitsSize) {
        reportedVariableBranchLimits.delete(key);
      }
      retainedVariableBranchLimits += 1;
    }
    resolvedObjects = snapshot.resolvedObjects;
    modificationsSeen = snapshot.modificationsSeen;
    appliedModifications = snapshot.appliedModifications;
    unsupportedModifications = snapshot.unsupportedModifications;
    modificationValueObjects = snapshot.modificationValueObjects;
  }

  function resolveRecord(
    record,
    stack,
    inheritedVariables = {},
    deferDynamic = false,
    callerExactOverrides = null,
  ) {
    recordResolutionWork += 1;
    let authoredValue = authoredRecordValues.get(record.id);
    if (!authoredValue) {
      authoredValue = cloneAuthoredValue(record.value, record.namespace, 0, {
        path: record.filePath, sourceId: record.sourceId, sourceKind: record.sourceKind, recordId: record.id,
      }, `/${pointerEscape(record.rawKey)}`);
      authoredRecordValues.set(record.id, authoredValue);
    }
    if (stack.length > limits.maxInheritanceDepth) failResolutionLimit('UI_INHERITANCE_DEPTH_LIMIT', 'maxInheritanceDepth', stack.length, record.id);
    if (stack.includes(record.id)) {
      diagnostics.push({ code: 'UI_INHERITANCE_CYCLE', severity: 'error', certainty: 'observed', cycle: [...stack, record.id] });
      return cloneValue(authoredValue);
    }
    if (record.profile === 'pocket') throw new Error('POCKET_DEPENDENCY_BLOCKED');
    provenanceIds.add(record.id);
    resolvedObjects += 1;
    resolvedObjectWork += 1;
    if (resolvedObjectWork > limits.maxResolvedObjects) failResolutionLimit('UI_RESOLVED_OBJECT_LIMIT', 'maxResolvedObjects', resolvedObjectWork, record.id);

    // Resolve record-level variables before following @ inheritance.  A
    // dynamic base may be selected by a default declared on this record, and
    // a derived record may pass an override down to an intermediate dynamic
    // base.  Deferring the whole record used to discard that intermediate
    // record's own ancestors.
    const recordVariableState = collectLocalVariableState(
      authoredValue,
      inheritedVariables,
      callerExactOverrides,
    );
    let recordVariables = recordVariableState.variables;
    let recordExactOverrides = mergeExactVariableOverrides(
      collectExactVariableOverrides(recordVariableState),
      callerExactOverrides,
    );
    if (recordVariableState.truncatedBranches > 0 && !reportedVariableBranchLimits.has(record.id)) {
      reportedVariableBranchLimits.add(record.id);
      diagnostics.push({
        code: 'UI_VARIABLE_BRANCH_LIMIT',
        severity: 'warning',
        certainty: 'policy',
        recordId: record.id,
        maximum: MAX_LOCAL_VARIABLE_BRANCHES,
        truncated: recordVariableState.truncatedBranches,
      });
    }

    const resolveBase = () => {
      let baseValue = {};
      if (record.baseRef) {
        const dynamicBase = String(record.baseRef).startsWith('$');
        const dynamicResolution = dynamicBase
          ? resolveDynamicBaseReference(record.baseRef, recordVariables)
          : { ok: true, resolvedReference: String(record.baseRef).replace(/^@/, '').trim(), variableChain: [] };
        const resolvedReference = dynamicResolution.resolvedReference;
        // `foo@namespace.foo` in an overlay means "derive from the lower pack's
        // foo", not "inherit from myself".  Choose the next precedence
        // candidate only for this explicit self-qualified case; ordinary cycles
        // remain observable and bounded.
        const selfQualifiedBase = resolvedReference && qualifyReference(resolvedReference, record.namespace) === record.qualifiedName;
        const base = resolvedReference
          ? lookupReference(resolvedReference, record.namespace, selfQualifiedBase
            ? { maxPrecedenceExclusive: Number(record.precedence) }
            : {})
          : null;
        dependencyTrace.add({ from: record, to: base,
          kind: selfQualifiedBase ? 'lower_layer_inheritance' : dynamicBase ? 'dynamic_record_inheritance' : 'record_inheritance',
          pointer: `/${pointerEscape(record.rawKey)}`, reference: record.baseRef, resolvedReference,
          variableChain: dynamicResolution.variableChain,
          state: !dynamicResolution.ok ? 'unresolved' : !base ? 'missing' : [...stack, record.id].includes(base.id) ? 'cycle' : 'resolved' });
        if (dynamicBase && !dynamicResolution.ok) diagnoseDynamicBase(record.baseRef, {
          recordId: record.id,
          reason: dynamicResolution.reason,
          variableChain: dynamicResolution.variableChain,
        });
        else if (base) {
          baseValue = resolveRecord(
            base,
            [...stack, record.id],
            recordVariables,
            true,
            recordExactOverrides,
          );
        }
        else diagnostics.push({
          code: dynamicBase ? 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND' : 'UI_BASE_NOT_FOUND',
          severity: 'warning',
          certainty: 'observed',
          recordId: record.id,
          baseRef: record.baseRef,
          ...(dynamicBase ? { resolvedReference } : {}),
        });
      } else if (Array.isArray(authoredValue?.modifications) && authoredValue.modifications.length) {
        // A resource-pack overlay commonly republishes a Vanilla symbol with
        // only `modifications`. In that form the lower physical pack record is
        // the implicit object being modified even though no `@base` is authored.
        const lower = lookupReference(record.qualifiedName, record.namespace, {
          maxPrecedenceExclusive: Number(record.precedence),
        });
        if (lower) {
          dependencyTrace.add({ from: record, to: lower, kind: 'implicit_lower_layer',
            pointer: `/${pointerEscape(record.rawKey)}/modifications`, reference: record.qualifiedName,
            resolvedReference: lower.qualifiedName, state: [...stack, record.id].includes(lower.id) ? 'cycle' : 'resolved' });
          baseValue = resolveRecord(
            lower,
            [...stack, record.id],
            recordVariables,
            true,
            recordExactOverrides,
          );
          diagnostics.push({
            code: 'UI_MODIFICATIONS_IMPLICIT_BASE',
            severity: 'info',
            certainty: 'approximation',
            recordId: record.id,
            baseRecordId: lower.id,
          });
        }
      }
      return baseValue;
    };

    let effective = {};
    const hasConditionalVariables = Array.isArray(authoredValue?.variables) && authoredValue.variables.length > 0;
    for (let pass = 0; pass < MAX_VARIABLE_BASE_PASSES; pass += 1) {
      const attemptState = hasConditionalVariables ? captureResolutionAttemptState() : null;
      effective = resolveBase();
      if (!hasConditionalVariables) break;

      // A derived conditional may depend on a declaration introduced by its
      // resolved base. Re-evaluate the derived declarations against that
      // context, but return only caller + derived variables to the next pass so
      // variables private to a discarded dynamic base cannot leak sideways.
      const requirementContext = collectLocalVariables(
        effective,
        inheritedVariables,
        callerExactOverrides,
      );
      const reevaluatedState = collectLocalVariableState(
        authoredValue,
        inheritedVariables,
        callerExactOverrides,
        requirementContext,
      );
      const reevaluatedVariables = reevaluatedState.variables;
      const reevaluatedOverrides = mergeExactVariableOverrides(
        collectExactVariableOverrides(reevaluatedState),
        callerExactOverrides,
      );
      if (variableMapsEqual(recordVariables, reevaluatedVariables)
        && variableMapsEqual(recordExactOverrides, reevaluatedOverrides)) break;

      if (pass + 1 >= MAX_VARIABLE_BASE_PASSES) {
        diagnostics.push({
          code: 'UI_VARIABLE_BASE_FIXPOINT_LIMIT',
          severity: 'warning',
          certainty: 'policy',
          recordId: record.id,
          maximum: MAX_VARIABLE_BASE_PASSES,
        });
        break;
      }
      restoreResolutionAttemptState(attemptState);
      recordVariables = reevaluatedVariables;
      recordExactOverrides = reevaluatedOverrides;
    }
    effective = applyModificationsDeep(
      mergeApproximate(effective, cloneValue(authoredValue)),
      { recordId: record.id },
    );
    const scopedVariables = collectLocalVariables(effective, recordVariables, recordExactOverrides);
    // Variable-backed `controls` values must become their authored array/map
    // before child inheritance is traversed.  Substitution only after the
    // traversal leaves such controls as unexpanded data and silently omits
    // their @ bases.
    const substitutedEffective = substituteVariables(
      effective,
      scopedVariables,
      diagnostics,
      [],
      0,
      recordExactOverrides,
    );
    // A base record is still merged into a caller, which may replace controls
    // or mark them ignored. Preserve authored namespaces and substituted values
    // here; resolve the child graph once from the final merged control. Walking
    // every base's children first repeatedly expands the same subtree and can
    // exhaust the unchanged work budget for ordinary Vanilla screens.
    if (deferDynamic) return substitutedEffective;
    return resolveControls(
      substitutedEffective,
      record.namespace,
      [...stack, record.id],
      0,
      scopedVariables,
      deferDynamic,
      recordExactOverrides,
    );
  }

  function resolveChild(rawKey, childValue, namespace, stack, controlDepth, variables, deferDynamic) {
    const parsedKey = parseDefinitionKey(rawKey);
    const derived = isPlainObject(childValue) ? childValue : {};
    const childVariableState = collectLocalVariableState(derived, variables);
    let scopedVariables = childVariableState.variables;
    let childExactOverrides = collectExactVariableOverrides(childVariableState);
    if (childVariableState.truncatedBranches > 0) {
      const warningKey = `child:${String(rawKey)}:${String(stack[stack.length - 1] || '')}`;
      if (!reportedVariableBranchLimits.has(warningKey)) {
        reportedVariableBranchLimits.add(warningKey);
        diagnostics.push({
          code: 'UI_VARIABLE_BRANCH_LIMIT',
          severity: 'warning',
          certainty: 'policy',
          rawKey,
          maximum: MAX_LOCAL_VARIABLE_BRANCHES,
          truncated: childVariableState.truncatedBranches,
        });
      }
    }
    const resolveBase = () => {
      let resolvedLocalName = parsedKey.localName;
      let effectiveBaseRef = parsedKey.baseRef;
      let baseRecordId = null;
      const dynamicLocalName = String(parsedKey.localName || '').startsWith('$');
      if (dynamicLocalName) {
        const localResolution = resolveDynamicBaseReference(parsedKey.localName, scopedVariables);
        if (localResolution.ok) {
          // Variables used as the whole control key may resolve to a complete
          // `local@namespace.base` reference. Preserve an explicitly-authored
          // `@base`, otherwise adopt the terminal variable's base as Bedrock
          // does. Dropping it turns inherited image/slot controls into typeless
          // panels across many resource packs.
          const terminalKey = parseDefinitionKey(localResolution.resolvedReference);
          if (localResolution.terminalBaseOnly) {
            const qualifiedParts = String(localResolution.resolvedReference).split('.').filter(Boolean);
            resolvedLocalName = qualifiedParts[qualifiedParts.length - 1] || parsedKey.localName;
            if (!effectiveBaseRef) effectiveBaseRef = localResolution.resolvedReference;
          } else {
            resolvedLocalName = terminalKey.localName;
            if (!effectiveBaseRef && terminalKey.baseRef) effectiveBaseRef = terminalKey.baseRef;
          }
        } else if (!deferDynamic) {
          diagnostics.push({
            code: 'UI_DYNAMIC_CONTROL_NAME_UNRESOLVED',
            severity: 'warning',
            certainty: 'approximation',
            rawKey,
            reason: localResolution.reason,
            variableChain: localResolution.variableChain,
          });
        }
      }
      let baseValue = Object.create(null);
      if (effectiveBaseRef) {
        const dynamicBase = String(effectiveBaseRef).startsWith('$');
        if (dynamicBase && deferDynamic) {
          return { deferred: true, resolvedLocalName, baseValue };
        }
        const dynamicResolution = dynamicBase
          ? resolveDynamicBaseReference(effectiveBaseRef, scopedVariables)
          : { ok: true, resolvedReference: String(effectiveBaseRef).replace(/^@/, '').trim(), variableChain: [] };
        const resolvedReference = dynamicResolution.resolvedReference;
        const base = resolvedReference ? lookupReference(resolvedReference, namespace) : null;
        dependencyTrace.add({ from: derived[AUTHORED_SOURCE] || catalog.recordsById[stack.at(-1)], to: base,
          kind: dynamicBase ? 'dynamic_child_inheritance' : 'child_inheritance',
          pointer: derived[AUTHORED_SOURCE]?.pointer || null, reference: effectiveBaseRef, resolvedReference,
          variableChain: dynamicResolution.variableChain,
          state: !dynamicResolution.ok ? 'unresolved' : !base ? 'missing' : stack.includes(base.id) ? 'cycle' : 'resolved' });
        if (dynamicBase && !dynamicResolution.ok) diagnoseDynamicBase(effectiveBaseRef, {
          rawKey,
          reason: dynamicResolution.reason,
          variableChain: dynamicResolution.variableChain,
        });
        else if (base) {
          baseRecordId = base.id;
          baseValue = resolveRecord(base, stack, scopedVariables, true, childExactOverrides);
        }
        else diagnostics.push({
          code: dynamicBase ? 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND' : 'UI_CONTROL_BASE_NOT_FOUND',
          severity: 'warning',
          certainty: 'observed',
          rawKey,
          baseRef: effectiveBaseRef,
          ...(dynamicBase ? { resolvedReference } : {}),
        });
      }
      return { deferred: false, resolvedLocalName, baseValue, baseRecordId };
    };

    let childResolution = null;
    const hasConditionalVariables = Array.isArray(derived.variables) && derived.variables.length > 0;
    for (let pass = 0; pass < MAX_VARIABLE_BASE_PASSES; pass += 1) {
      const attemptState = hasConditionalVariables ? captureResolutionAttemptState() : null;
      childResolution = resolveBase();
      if (childResolution.deferred) {
        return attachPropertyNamespaces({ [rawKey]: cloneValue(childValue) }, { [rawKey]: namespace });
      }
      if (!hasConditionalVariables) break;

      const requirementContext = collectLocalVariables(
        childResolution.baseValue,
        variables,
      );
      const reevaluatedState = collectLocalVariableState(derived, variables, null, requirementContext);
      const reevaluatedVariables = reevaluatedState.variables;
      const reevaluatedOverrides = collectExactVariableOverrides(reevaluatedState);
      if (variableMapsEqual(scopedVariables, reevaluatedVariables)
        && variableMapsEqual(childExactOverrides, reevaluatedOverrides)) break;

      if (pass + 1 >= MAX_VARIABLE_BASE_PASSES) {
        diagnostics.push({
          code: 'UI_VARIABLE_BASE_FIXPOINT_LIMIT',
          severity: 'warning',
          certainty: 'policy',
          rawKey,
          maximum: MAX_VARIABLE_BASE_PASSES,
        });
        break;
      }
      restoreResolutionAttemptState(attemptState);
      scopedVariables = reevaluatedVariables;
      childExactOverrides = reevaluatedOverrides;
    }
    const { resolvedLocalName, baseValue, baseRecordId } = childResolution;
    const merged = applyModificationsDeep(
      mergeApproximate(baseValue, derived),
      { rawKey },
    );
    const mergedVariables = collectLocalVariables(merged, scopedVariables, childExactOverrides);
    const staticallyIgnored = resolveStaticPreviewBoolean(merged.ignored, mergedVariables);
    const ignoredCanChange = hasPotentialBindingOverride(merged, 'ignored');
    if (staticallyIgnored === true && !ignoredCanChange) {
      // Resolve the base first so inherited bindings and state are observable.
      // Once the final merged control is provably ignored, retain its complete
      // authored shape but do not resolve descendants that cannot participate
      // in this representative view.
      const inactiveValue = substituteVariables(
        merged,
        mergedVariables,
        diagnostics,
        [],
        0,
        childExactOverrides,
      );
      return attachPropertyNamespaces({
        [resolvedLocalName]: inactiveValue,
      }, { [resolvedLocalName]: namespace });
    }
    if (baseRecordId) activeControlReferences.push(baseRecordId);
    try {
      return attachPropertyNamespaces({
        [resolvedLocalName]: resolveControls(
          merged,
          namespace,
          stack,
          controlDepth + 1,
          mergedVariables,
          deferDynamic,
          childExactOverrides,
        ),
      }, { [resolvedLocalName]: namespace });
    } finally {
      if (baseRecordId) activeControlReferences.pop();
    }
  }

  function resolveControls(
    value,
    namespace,
    stack,
    controlDepth,
    variables = {},
    deferDynamic = false,
    protectedOverrides = null,
  ) {
    if (controlDepth > limits.maxControlDepth) failResolutionLimit('UI_CONTROL_DEPTH_LIMIT', 'maxControlDepth', controlDepth, stack.at(-1), controlDepth);
    if (Array.isArray(value)) {
      resolvedObjects += 1;
      resolvedObjectWork += 1;
      if (resolvedObjectWork > limits.maxResolvedObjects) failResolutionLimit('UI_RESOLVED_OBJECT_LIMIT', 'maxResolvedObjects', resolvedObjectWork, stack.at(-1), controlDepth);
      return value.map((item) => resolveControls(item, namespace, stack, controlDepth + 1, variables, deferDynamic));
    }
    if (!isPlainObject(value)) return value;

    resolvedObjects += 1;
    resolvedObjectWork += 1;
    if (resolvedObjectWork > limits.maxResolvedObjects) failResolutionLimit('UI_RESOLVED_OBJECT_LIMIT', 'maxResolvedObjects', resolvedObjectWork, stack.at(-1), controlDepth);
    const scopedVariables = collectLocalVariables(value, variables, protectedOverrides);
    const output = Object.create(null);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'variables' && Array.isArray(child)) {
        output[key] = cloneValue(child);
      } else if (key === 'controls' && Array.isArray(child)) {
        const resolvedControls = [];
        for (const control of child) {
          if (!isPlainObject(control)) {
            resolvedControls.push(cloneValue(control));
            continue;
          }
          // Although named one-key wrappers are the common Classic form,
          // Bedrock also accepts an inline control object in a controls array.
          // Treat only a string `type` as that discriminator so a legitimate
          // named child whose key is literally `type` remains a wrapper.
          if (typeof control.type === 'string' || Object.keys(control).length !== 1) {
            resolvedControls.push(resolveControls(
              control,
              namespace,
              stack,
              controlDepth + 1,
              scopedVariables,
              deferDynamic,
            ));
            continue;
          }
          const parts = [];
          for (const [rawKey, childValue] of Object.entries(control)) {
            const authoredNamespace = propertyNamespace(control, rawKey) || namespace;
            parts.push(resolveChild(rawKey, childValue, authoredNamespace, stack, controlDepth, scopedVariables, deferDynamic));
          }
          resolvedControls.push(...parts);
        }
        output[key] = resolvedControls;
      } else if (key === 'controls' && isPlainObject(child)) {
        // Bedrock accepts both the usual array of named entries and an object
        // map. Route both forms through resolveChild so @ inheritance,
        // lexical variables, provenance and safety limits stay identical.
        const resolvedControls = Object.create(null);
        const resolvedControlNamespaces = Object.create(null);
        for (const [rawKey, childValue] of Object.entries(child)) {
          const authoredNamespace = propertyNamespace(child, rawKey) || namespace;
          const part = resolveChild(
            rawKey,
            childValue,
            authoredNamespace,
            stack,
            controlDepth,
            scopedVariables,
            deferDynamic,
          );
          for (const [resolvedKey, resolvedValue] of Object.entries(part)) {
            resolvedControls[resolvedKey] = resolvedValue;
            resolvedControlNamespaces[resolvedKey] = propertyNamespace(part, resolvedKey) || authoredNamespace;
          }
        }
        output[key] = attachPropertyNamespaces(resolvedControls, resolvedControlNamespaces);
      } else {
        output[key] = resolveControls(child, namespace, stack, controlDepth + 1, scopedVariables, deferDynamic);
      }
    }
    return carryAuthoredSource(attachPropertyNamespaces(output, value[PROPERTY_NAMESPACES]), value);
  }

  try {
    Object.assign(eventFactorySelections, normalizeEventFactorySelections38(options?.eventFactorySelections));
    // The catalog preserves authored declaration keys, including |default.
    // Resolve that declaration layer once before using it as an inherited
    // scope; spreading raw keys left fallback-only variables unresolved.
    const globalVariables = collectLocalVariables(catalog.globalVariables);
    const initialVariables = copyVariableDefaultOrigins37(globalVariables, {
      ...globalVariables,
      '$desktop_screen': true,
      '$pocket_screen': false,
      ...(isPlainObject(options && options.variables) ? options.variables : {}),
    });
    for (const key of ['$desktop_screen', '$pocket_screen', ...Object.keys(options?.variables || {})]) markVariableExact37(initialVariables, key);
    const inherited = resolveRecord(selected, [], initialVariables, false);
    const inheritedVariableScope = collectLocalVariables(inherited, initialVariables);
    const variables = copyVariableDefaultOrigins37(inheritedVariableScope, {
      ...inheritedVariableScope,
      ...(isPlainObject(options && options.variables) ? options.variables : {}),
    });
    for (const key of Object.keys(options?.variables || {})) markVariableExact37(variables, key);
    const substitutedRoot = substituteVariables(inherited, variables, diagnostics);
    function remainingCollectionMaterializationBudget() {
      const sharedLimit = Number.isFinite(Number(limits.maxMaterializedCollectionItemsTotal))
        ? Math.max(0, Math.floor(Number(limits.maxMaterializedCollectionItemsTotal)))
        : DEFAULT_LIMITS.maxMaterializedCollectionItemsTotal;
      return Math.max(0, sharedLimit - materializedGridItems - materializedFactoryItems);
    }

    if (unsupportedModifications > 0) {
      diagnostics.push({
        code: 'UI_MODIFICATIONS_UNSUPPORTED',
        severity: 'warning',
        certainty: 'approximation',
        count: unsupportedModifications,
      });
    }

    /**
     * Materialize bounded design-time children for collection-backed grids.
     * Bedrock creates these controls from runtime collection data.  Without a
     * representative instance per declared cell, inventory/hotbar/chest grids
     * become empty even though their Vanilla slot frames are statically known.
     */
    function nestedCollectionScope(scope, collectionName, index) {
      const collection = readOwnDataValue(scope, collectionName);
      const row = readOwnDataValue(readOwnDataValue(collection, 'rows'), String(index))
        || readOwnDataValue(collection, 'rowTemplate');
      const nested = readOwnDataValue(row, '__collections');
      if (!isPlainObject(nested)) return scope;
      const next = { ...scope };
      for (const key of Object.keys(nested).slice(0, 128)) {
        if (!isSafeRuntimeName(key)) continue;
        const value = readOwnDataValue(nested, key);
        if (isPlainObject(value)) next[key] = value;
      }
      return next;
    }

    function materializeGridTemplates(value, namespace, depth = 0, templateStack = [], inheritedVariables = variables, collectionScope = representativeCollections, controlName = '') {
      if (depth > limits.maxControlDepth) return cloneValue(value);
      if (Array.isArray(value)) {
        return value.map((item) => materializeGridTemplates(item, namespace, depth + 1, templateStack, inheritedVariables, collectionScope, controlName));
      }
      if (!isPlainObject(value)) return value;

      const scopedVariables = collectLocalVariables(value, inheritedVariables);
      const staticallyIgnored = resolveStaticPreviewBoolean(value.ignored, scopedVariables);
      const staticallyVisible = resolveStaticPreviewBoolean(value.visible, scopedVariables);
      const ignoredCanChange = hasPotentialBindingOverride(value, 'ignored');
      const visibleCanChange = hasPotentialBindingOverride(value, 'visible');
      if ((staticallyIgnored === true && !ignoredCanChange) || (staticallyVisible === false && !visibleCanChange)) {
        // Preserve the authored inactive branch, but do not spend collection
        // or node budgets materializing runtime instances that cannot appear
        // in this explicit representative scenario.
        return cloneValue(value);
      }
      const output = carryAuthoredSource(attachPropertyNamespaces(Object.create(null), value[PROPERTY_NAMESPACES]), value);
      for (const [key, child] of Object.entries(value)) {
        output[key] = key === 'variables' && Array.isArray(child)
          ? cloneValue(child)
          : materializeGridTemplates(child, namespace, depth + 1, templateStack, scopedVariables, collectionScope, key);
      }

      // A named control may legitimately be called `type` (for example,
      // `type@play.world_list_text`).  Its wrapper therefore has an object at
      // `output.type`; only a string-valued property identifies an inline JSON
      // UI element.  Coercing the wrapper object both misclassifies it and
      // throws for our null-prototype records.
      const outputType = typeof output.type === 'string' ? output.type.trim().toLowerCase() : '';

      // R38: instantiate one explicitly named event branch while retaining the
      // selected ancestor and the factory's authored size/anchors. No event is
      // inferred from a form title, and no executable BP code is loaded here.
      if (outputType === 'factory') {
        delete output.__jsonui_preview_event_factory_materialized;
        const eventName = parseDefinitionKey(controlName).localName || controlName;
        if (!Object.hasOwn(eventFactorySelections, eventName)) return output;
        const visits = (eventFactoryVisits.get(eventName) || 0) + 1;
        eventFactoryVisits.set(eventName, visits);
        if (visits > 1) throw new Error('UI_EVENT_FACTORY_SELECTOR_AMBIGUOUS');
        const controlId = eventFactorySelections[eventName];
        const rawTarget = readOwnDataValue(output.control_ids, controlId);
        if (rawTarget === undefined) throw new Error('UI_EVENT_FACTORY_CONTROL_ID_NOT_FOUND');
        const targetNamespace = propertyNamespace(value.control_ids, controlId)
          || propertyNamespace(value, 'control_ids') || namespace;
        const target = parseFixedControlSpec(rawTarget, targetNamespace);
        if (!target.ok) throw new Error('UI_EVENT_FACTORY_TARGET_INVALID');
        const record = lookupReference(target.qualifiedName, '');
        dependencyTrace.add({ from: value[AUTHORED_SOURCE] || selected, to: record,
          kind: 'explicit_event_factory', pointer: `${value[AUTHORED_SOURCE]?.pointer || ''}/control_ids/${pointerEscape(controlId)}`,
          reference: rawTarget, resolvedReference: target.qualifiedName,
          state: !record ? 'missing' : templateStack.includes(record.id) ? 'cycle' : 'resolved' });
        if (!record) throw new Error('UI_EVENT_FACTORY_TARGET_NOT_FOUND');
        if (templateStack.includes(record.id)) throw new Error('UI_EVENT_FACTORY_CYCLE');
        requestedFactoryItems += 1;
        if (remainingCollectionMaterializationBudget() < 1) throw new Error('UI_EVENT_FACTORY_ITEM_LIMIT');
        if (Number(limits.maxMaterializedFactoryItems) < 1) throw new Error('UI_EVENT_FACTORY_ITEM_LIMIT');
        const inheritedTemplate = resolveRecord(record, [], scopedVariables, false);
        const templateVariables = collectLocalVariables(inheritedTemplate, scopedVariables);
        const templateValue = substituteVariables(inheritedTemplate, templateVariables, diagnostics);
        const objectCost = countMaterializationObjects(templateValue, remainingMaterializedObjectBudget()) + 2;
        if (objectCost > remainingMaterializedObjectBudget()) throw new Error('UI_EVENT_FACTORY_OBJECT_LIMIT');
        materializedObjects += objectCost;
        materializedFactoryItems += 1;
        const generatedName = target.localName || controlId;
        if (!isSafeGeneratedControlName(generatedName)) throw new Error('UI_EVENT_FACTORY_TARGET_INVALID');
        const generated = materializeGridTemplates(templateValue, record.namespace || namespace,
          depth + 1, [...templateStack, record.id], templateVariables, collectionScope, generatedName);
        output.controls = [{ [generatedName]: markGeneratedSource(generated, 'event-factory') }];
        output.__jsonui_preview_event_factory_materialized = true;
        materializedEventFactories.push({ factory: eventName, controlId, template: record.qualifiedName });
        diagnostics.push({ code: 'UI_EVENT_FACTORY_EXPLICIT_INSTANCE', severity: 'info', certainty: 'approximation',
          factory: eventName, controlId, template: record.qualifiedName,
          message: '明示したイベント分岐だけを、選択定義からの祖先制約を保持して投影しました。Minecraft実行ではありません。' });
        return output;
      }

      // Bedrock also uses a factory property on structural panels to create a
      // collection row from a concrete control template (notably the nested
      // trade tier/offer lists). Instantiate only this narrow, data-backed
      // shape; event/popup factories and standalone `type:"factory"` controls
      // remain runtime-only.
      const factory = isPlainObject(output.factory) ? output.factory : null;
      const hasOwnControls = Object.prototype.hasOwnProperty.call(output, 'controls');
      const controlsAreExplicitlyEmpty = (Array.isArray(output.controls) && output.controls.length === 0)
        || (isPlainObject(output.controls) && Object.keys(output.controls).length === 0);
      const controlsCanBeMaterialized = !hasOwnControls || controlsAreExplicitlyEmpty;
      const rawFactoryName = typeof factory?.name === 'string' ? factory.name.trim() : '';
      const evaluatedFactoryName = rawFactoryName.startsWith('(') && rawFactoryName.endsWith(')')
        ? safeEvalExpression(rawFactoryName.slice(1, -1), {
            mockData: scopedVariables,
            props: { ...scopedVariables, ...output },
          })
        : rawFactoryName;
      const factoryName = typeof evaluatedFactoryName === 'string' ? evaluatedFactoryName.trim() : '';
      const factoryPropertyNamespace = propertyNamespace(value, 'factory') || namespace;
      const controlNameNamespace = propertyNamespace(value.factory, 'control_name')
        || factoryPropertyNamespace;
      const rawParsedFactoryControlName = parseFixedControlSpec(factory?.control_name, controlNameNamespace);
      const factoryControlNameHasUnsafeLocalName = rawParsedFactoryControlName.ok
        && rawParsedFactoryControlName.localName !== null
        && !isSafeGeneratedControlName(rawParsedFactoryControlName.localName);
      const parsedFactoryControlName = factoryControlNameHasUnsafeLocalName
        ? { ...rawParsedFactoryControlName, localName: null }
        : rawParsedFactoryControlName;
      const factoryControlIds = isPlainObject(factory?.control_ids) ? factory.control_ids : null;
      const authoredMaxChildren = readOwnDataValue(factory, 'max_children_size');
      const hasAuthoredMaxChildren = authoredMaxChildren !== undefined;
      const validAuthoredMaxChildren = !hasAuthoredMaxChildren
        || (Number.isSafeInteger(authoredMaxChildren) && authoredMaxChildren >= 0);
      const rawFactoryCollectionName = typeof output.collection_name === 'string'
        ? output.collection_name.trim()
        : '';
      const hasCollectionExpressionDelimiter = rawFactoryCollectionName.startsWith('(')
        || rawFactoryCollectionName.endsWith(')');
      const evaluatedFactoryCollectionName = hasCollectionExpressionDelimiter
        ? rawFactoryCollectionName.startsWith('(') && rawFactoryCollectionName.endsWith(')')
          ? safeEvalExpression(rawFactoryCollectionName.slice(1, -1), {
              mockData: scopedVariables,
              props: { ...scopedVariables, ...output },
            })
          : undefined
        : rawFactoryCollectionName;
      const factoryCollectionName = typeof evaluatedFactoryCollectionName === 'string'
        ? evaluatedFactoryCollectionName.trim()
        : '';
      const collectionRepresentativeCandidate = isSafeFixedCollectionScenarioName(factoryCollectionName)
        ? readOwnDataValue(collectionScope, factoryCollectionName)
        : null;
      const factoryNameRepresentativeCandidate = !rawFactoryCollectionName && isSafeRuntimeName(factoryName)
        ? readOwnDataValue(collectionScope, factoryName)
        : null;
      const factoryRepresentative = isPlainObject(collectionRepresentativeCandidate)
        ? collectionRepresentativeCandidate
        : isPlainObject(factoryNameRepresentativeCandidate)
          ? factoryNameRepresentativeCandidate
          : null;
      const factoryScenarioName = isPlainObject(collectionRepresentativeCandidate)
        ? factoryCollectionName
        : isPlainObject(factoryNameRepresentativeCandidate)
          ? factoryName
          : '';
      if (factoryControlNameHasUnsafeLocalName && outputType !== 'factory') {
        recordFactoryControlIdDiagnostic(
          factoryName,
          factoryScenarioName,
          'CONTROL_NAME_LOCAL_NAME_INVALID_FALLBACK',
        );
      }
      const representativeCountValue = factoryRepresentative
        ? readOwnDataValue(factoryRepresentative, 'count')
        : undefined;
      const factoryTemplateCanBeChecked = Boolean(
        factory
        && outputType !== 'factory'
        && controlsCanBeMaterialized
        && (
          isPlainObject(collectionRepresentativeCandidate)
          || (isSafeRuntimeName(factoryName) && !/^[#$@(]/u.test(factoryName))
        )
        && (parsedFactoryControlName.ok || factoryControlIds)
        && validAuthoredMaxChildren
      );
      if (factory && !validAuthoredMaxChildren && outputType !== 'factory') {
        diagnostics.push({
          code: 'UI_FACTORY_MAX_CHILDREN_INVALID',
          severity: 'warning',
          certainty: 'observed',
          factoryName,
        });
      }

      const readFactoryRepresentativeRow = (index) => {
        if (!factoryRepresentative) return null;
        const rows = readOwnDataValue(factoryRepresentative, 'rows');
        if (Array.isArray(rows) || isPlainObject(rows)) {
          const row = readOwnDataValue(rows, String(index));
          if (isPlainObject(row)) return row;
        }
        const rowTemplate = readOwnDataValue(factoryRepresentative, 'rowTemplate');
        return isPlainObject(rowTemplate) ? rowTemplate : null;
      };

      const parseFactoryControlIdSpec = (controlId, rawSpec) => {
        const controlIdNamespace = propertyNamespace(value.factory?.control_ids, controlId)
          || propertyNamespace(factoryControlIds, controlId)
          || propertyNamespace(value.factory, 'control_ids')
          || factoryPropertyNamespace;
        const parsed = parseFixedControlSpec(rawSpec, controlIdNamespace);
        if (!parsed.ok) {
          recordFactoryControlIdDiagnostic(factoryName, factoryScenarioName, `TARGET_${parsed.reason.toUpperCase()}`, controlId);
          return null;
        }
        if (parsed.localName !== null && !isSafeGeneratedControlName(parsed.localName)) {
          recordFactoryControlIdDiagnostic(
            factoryName,
            factoryScenarioName,
            'TARGET_LOCAL_NAME_INVALID_FALLBACK',
            controlId,
          );
          return { parsed: { ...parsed, localName: null }, controlId };
        }
        return { parsed, controlId };
      };

      const selectFactoryTemplate = (index) => {
        if (parsedFactoryControlName.ok) {
          return { parsed: parsedFactoryControlName, controlId: '' };
        }
        if (!factoryControlIds) return null;

        const row = readFactoryRepresentativeRow(index);
        // The selected engine event is not exposed by public JSON UI. Only the
        // preview's reserved scenario marker may choose a control_ids branch;
        // ordinary row fields such as `#control_id` must never be repurposed.
        const authoredSelector = readOwnDataValue(row, '__jsonui_preview_factory_control_id');
        if (authoredSelector !== undefined) {
          const controlId = typeof authoredSelector === 'string' || typeof authoredSelector === 'number'
            ? String(authoredSelector).trim()
            : '';
          if (!isSafeRuntimeName(controlId) || /^[#$@(]/u.test(controlId)) {
            recordFactoryControlIdDiagnostic(factoryName, factoryScenarioName, 'SELECTOR_INVALID');
            return null;
          }
          const rawSpec = readOwnDataValue(factoryControlIds, controlId);
          if (rawSpec === undefined) {
            recordFactoryControlIdDiagnostic(factoryName, factoryScenarioName, 'SELECTOR_NOT_FOUND', controlId);
            return null;
          }
          return parseFactoryControlIdSpec(controlId, rawSpec);
        }

        // Without a per-row selector, a map is deterministic only when it has
        // exactly one own data entry. Stop after the second key so even a very
        // large untrusted map does not need to be copied or fully inspected.
        let soleControlId = '';
        let ownEntries = 0;
        for (const controlId in factoryControlIds) {
          if (!Object.prototype.hasOwnProperty.call(factoryControlIds, controlId)) continue;
          ownEntries += 1;
          if (ownEntries === 1) soleControlId = controlId;
          if (ownEntries > 1) break;
        }
        if (ownEntries !== 1 || !isSafeRuntimeName(soleControlId) || /^[#$@(]/u.test(soleControlId)) {
          recordFactoryControlIdDiagnostic(
            factoryName,
            factoryScenarioName,
            ownEntries > 1 ? 'SELECTOR_REQUIRED' : 'CONTROL_IDS_EMPTY',
          );
          return null;
        }
        return parseFactoryControlIdSpec(
          soleControlId,
          readOwnDataValue(factoryControlIds, soleControlId),
        );
      };

      const templateLookupCache = new Map();
      const lookupFactoryTemplate = (selection) => {
        const factoryTemplateRef = selection.parsed.qualifiedName;
        if (templateLookupCache.has(factoryTemplateRef)) return templateLookupCache.get(factoryTemplateRef);
        let templateRecord = lookupReference(factoryTemplateRef, '');
        let templateLookupAmbiguous = false;
        if (!templateRecord && !factoryTemplateRef.includes('.')) {
          const suffix = `.${factoryTemplateRef}`;
          const inferred = Object.values(catalog.symbols || {})
            .map((symbol) => catalog.recordsById[symbol.winnerId])
            .filter((record) => record && String(record.qualifiedName || '').endsWith(suffix));
          if (inferred.length === 1) {
            [templateRecord] = inferred;
            diagnostics.push({
              code: 'UI_FACTORY_TEMPLATE_NAMESPACE_INFERRED',
              severity: 'info',
              certainty: 'approximation',
              template: factoryTemplateRef,
              qualifiedName: templateRecord.qualifiedName,
            });
          } else if (inferred.length > 1) {
            templateLookupAmbiguous = true;
            diagnostics.push({
              code: 'UI_FACTORY_TEMPLATE_NAMESPACE_AMBIGUOUS',
              severity: 'warning',
              certainty: 'approximation',
              template: factoryTemplateRef,
              candidates: inferred.map((record) => record.qualifiedName).sort(),
            });
          }
        }
        if (!templateRecord) {
          if (!templateLookupAmbiguous) {
            diagnostics.push({
              code: 'UI_FACTORY_TEMPLATE_NOT_FOUND',
              severity: 'warning',
              certainty: 'observed',
              template: factoryTemplateRef,
              collectionName: factoryScenarioName,
            });
          }
          const missing = { record: null, templateRef: factoryTemplateRef };
          templateLookupCache.set(factoryTemplateRef, missing);
          return missing;
        }
        const found = { record: templateRecord, templateRef: factoryTemplateRef };
        templateLookupCache.set(factoryTemplateRef, found);
        return found;
      };

      const factoryTemplateCache = new Map();
      const prepareFactoryTemplate = (selection) => {
        const lookup = lookupFactoryTemplate(selection);
        const templateRecord = lookup.record;
        if (!templateRecord) return null;
        if (factoryTemplateCache.has(templateRecord.id)) return factoryTemplateCache.get(templateRecord.id);
        if (templateStack.includes(templateRecord.id)) {
          recordFactoryTemplateCycle(lookup.templateRef, factoryScenarioName);
          factoryTemplateCache.set(templateRecord.id, null);
          return null;
        }
        const templateValue = resolveRecord(templateRecord, [], scopedVariables, false);
        const templateVariables = collectLocalVariables(templateValue, scopedVariables);
        const substitutedTemplateValue = substituteVariables(templateValue, templateVariables, diagnostics);
        const prepared = { templateRecord, templateVariables, substitutedTemplateValue };
        factoryTemplateCache.set(templateRecord.id, prepared);
        return prepared;
      };

      if (
        factoryTemplateCanBeChecked
        && isSafeRuntimeName(factoryScenarioName)
        && factoryRepresentative
      ) {
        const requested = typeof representativeCountValue === 'number' ? representativeCountValue : Number.NaN;
        if (Number.isSafeInteger(requested) && requested >= 0) {
          requestedFactoryItems += requested;
          if (requested === 0) {
            // Retain the existing useful preflight for one fixed control_name.
            // A control_ids map has no selected branch when the scenario has
            // zero rows, so inspecting one arbitrarily would be misleading.
            if (parsedFactoryControlName.ok && !prepareFactoryTemplate({
              parsed: parsedFactoryControlName,
              controlId: '',
            })) return output;
            if (remainingMaterializedObjectBudget() < 1) {
              recordFactoryMaterializationLimit(
                parsedFactoryControlName.ok ? parsedFactoryControlName.qualifiedName : '<control_ids>',
                factoryScenarioName,
                0,
                0,
              );
              return output;
            }
            materializedObjects += 1;
            output.controls = [];
            output.__jsonui_preview_factory_materialized = true;
            return output;
          }
          const remainingBudget = remainingCollectionMaterializationBudget();
          if (remainingBudget <= 0) {
            recordFactoryMaterializationLimit(
              parsedFactoryControlName.ok ? parsedFactoryControlName.qualifiedName : '<control_ids>',
              factoryScenarioName,
              requested,
              0,
            );
            return output;
          }
          const configuredPerFactoryLimit = Number.isFinite(Number(limits.maxMaterializedFactoryItems))
            ? Math.max(0, Math.floor(Number(limits.maxMaterializedFactoryItems)))
            : DEFAULT_LIMITS.maxMaterializedFactoryItems;
          const perFactoryLimit = hasAuthoredMaxChildren
            ? Math.min(configuredPerFactoryLimit, authoredMaxChildren)
            : configuredPerFactoryLimit;
          if (perFactoryLimit === 0) {
            if (remainingMaterializedObjectBudget() < 1) {
              recordFactoryMaterializationLimit(
                parsedFactoryControlName.ok ? parsedFactoryControlName.qualifiedName : '<control_ids>',
                factoryScenarioName,
                requested,
                0,
              );
              return output;
            }
            materializedObjects += 1;
            output.controls = [];
            output.__jsonui_preview_factory_materialized = true;
            if (requested > 0) {
              recordFactoryMaterializationLimit(
                parsedFactoryControlName.ok ? parsedFactoryControlName.qualifiedName : '<control_ids>',
                factoryScenarioName,
                requested,
                0,
              );
            }
            return output;
          }
          const rowLimit = Math.min(requested, perFactoryLimit, remainingBudget);
          const plannedItems = [];
          const materializedTemplateRefs = new Set();
          let objectLimitReached = false;
          let plannedObjectCost = 0;
          for (let index = 0; index < rowLimit; index += 1) {
            const selection = selectFactoryTemplate(index);
            if (!selection) continue;
            const prepared = prepareFactoryTemplate(selection);
            if (!prepared) continue;
            const objectBudget = Math.max(
              0,
              remainingMaterializedObjectBudget() - plannedObjectCost,
            );
            const templateObjectCost = Math.max(1, countMaterializationObjects(
              prepared.substitutedTemplateValue,
              objectBudget,
            ));
            const generatedObjectsPerItem = templateObjectCost + 1;
            const controlsArrayCost = plannedItems.length === 0 ? 1 : 0;
            if (generatedObjectsPerItem + controlsArrayCost > objectBudget) {
              objectLimitReached = true;
              break;
            }
            plannedObjectCost += controlsArrayCost + generatedObjectsPerItem;
            plannedItems.push({ index, selection, prepared });
          }

          // Reserve every selected row before descending: one generated
          // template may contain another grid/factory, which must see the
          // reduced shared item/object budgets without starving later sibling
          // rows that this parent factory already selected.
          materializedFactoryItems += plannedItems.length;
          materializedObjects += plannedObjectCost;
          const controls = [];
          for (const { index, selection, prepared } of plannedItems) {
            const previewProperties = {
              collection_index: index,
              __jsonui_preview_collection_name: factoryScenarioName,
              __jsonui_preview_factory_materialized: true,
              ...(selection.controlId
                ? { __jsonui_preview_factory_control_id: selection.controlId }
                : {}),
            };
            const item = materializeGridTemplates(
              mergeApproximate(prepared.substitutedTemplateValue, previewProperties),
              prepared.templateRecord.namespace || namespace,
              depth + 1,
              [...templateStack, prepared.templateRecord.id],
              prepared.templateVariables,
              nestedCollectionScope(collectionScope, factoryScenarioName, index),
            );
            const generatedNameCandidate = selection.parsed.localName || selection.controlId;
            const generatedName = isSafeGeneratedControlName(generatedNameCandidate)
              ? generatedNameCandidate
              : `preview_factory_${index}`;
            controls.push({ [generatedName]: markGeneratedSource(item, 'factory') });
            materializedTemplateRefs.add(selection.parsed.qualifiedName);
          }
          if (controls.length > 0) {
            output.controls = controls;
            output.__jsonui_preview_factory_materialized = true;
            diagnostics.push({
              code: 'UI_FACTORY_TEMPLATE_MATERIALIZED',
              severity: 'info',
              certainty: 'approximation',
              factoryName,
              template: materializedTemplateRefs.size === 1
                ? Array.from(materializedTemplateRefs)[0]
                : '<control_ids>',
              templates: Array.from(materializedTemplateRefs),
              collectionName: factoryScenarioName,
              count: controls.length,
            });
          }
          if (objectLimitReached || rowLimit < requested) {
            recordFactoryMaterializationLimit(
              parsedFactoryControlName.ok ? parsedFactoryControlName.qualifiedName : '<control_ids>',
              factoryScenarioName,
              requested,
              controls.length,
            );
          }
        }
      }
      if (outputType !== 'grid') return output;
      if (!controlsCanBeMaterialized) return output;
      const dimensions = Array.isArray(output.grid_dimensions) ? output.grid_dimensions : null;
      const columns = Number(dimensions && dimensions[0]);
      const rows = Number(dimensions && dimensions[1]);
      const hasAuthoredDimensions = Number.isFinite(columns) && Number.isFinite(rows) && columns > 0 && rows > 0;
      const collectionName = typeof output.collection_name === 'string' ? output.collection_name.trim() : '';
      const representativeCandidate = isSafeRuntimeName(collectionName)
        ? readOwnDataValue(collectionScope, collectionName)
        : null;
      const representative = isPlainObject(representativeCandidate)
        ? representativeCandidate
        : null;
      const gridRepresentativeCountValue = representative ? readOwnDataValue(representative, 'count') : undefined;
      const representativeCount = typeof gridRepresentativeCountValue === 'number'
        ? gridRepresentativeCountValue
        : Number.NaN;
      if (!hasAuthoredDimensions && !(representative && Number.isSafeInteger(representativeCount) && representativeCount > 0)) {
        return output;
      }

      const rawTemplate = typeof output.grid_item_template === 'string'
        ? output.grid_item_template.replace(/^@/, '').trim()
        : '';
      if (!rawTemplate || rawTemplate.startsWith('$')) return output;
      const templateNamespace = propertyNamespace(value, 'grid_item_template') || namespace;
      let templateRecord = lookupReference(rawTemplate, templateNamespace);
      let templateLookupAmbiguous = false;
      if (!templateRecord && !rawTemplate.includes('.')) {
        const suffix = `.${rawTemplate}`;
        const inferred = Object.values(catalog.symbols || {})
          .map((symbol) => catalog.recordsById[symbol.winnerId])
          .filter((record) => record && String(record.qualifiedName || '').endsWith(suffix));
        if (inferred.length === 1) {
          [templateRecord] = inferred;
          diagnostics.push({
            code: 'UI_GRID_TEMPLATE_NAMESPACE_INFERRED',
            severity: 'info',
            certainty: 'approximation',
            template: rawTemplate,
            qualifiedName: templateRecord.qualifiedName,
          });
        } else if (inferred.length > 1) {
          templateLookupAmbiguous = true;
          diagnostics.push({
            code: 'UI_GRID_TEMPLATE_NAMESPACE_AMBIGUOUS',
            severity: 'warning',
            certainty: 'approximation',
            template: rawTemplate,
            candidates: inferred.map((record) => record.qualifiedName).sort(),
          });
        }
      }
      if (!templateRecord && !templateLookupAmbiguous) {
        diagnostics.push({
          code: 'UI_GRID_TEMPLATE_NOT_FOUND',
          severity: 'warning',
          certainty: 'observed',
          template: rawTemplate,
        });
        return output;
      }
      if (!templateRecord) return output;
      if (templateStack.includes(templateRecord.id)) {
        diagnostics.push({
          code: 'UI_GRID_TEMPLATE_CYCLE',
          severity: 'warning',
          certainty: 'observed',
          template: rawTemplate,
        });
        return output;
      }

      const declaredCount = hasAuthoredDimensions
        ? Math.floor(columns) * Math.floor(rows)
        : Math.floor(representativeCount);
      const maximum = Number(output.maximum_grid_items);
      const cappedByProperty = Number.isFinite(maximum) && maximum >= 0
        ? Math.min(declaredCount, Math.max(0, Math.floor(maximum)))
        : declaredCount;
      requestedGridItems += cappedByProperty;
      const remainingGridTotal = Number.isFinite(Number(limits.maxMaterializedGridItemsTotal))
        ? Math.max(0, Math.floor(Number(limits.maxMaterializedGridItemsTotal))) - materializedGridItems
        : DEFAULT_LIMITS.maxMaterializedGridItemsTotal - materializedGridItems;
      const remainingTotal = Math.max(0, Math.min(remainingGridTotal, remainingCollectionMaterializationBudget()));
      const countByItemBudget = Math.min(cappedByProperty, limits.maxMaterializedGridItems, remainingTotal);
      if (countByItemBudget <= 0) {
        if (cappedByProperty > 0) {
          diagnostics.push({
            code: 'UI_GRID_MATERIALIZATION_LIMIT',
            severity: 'warning',
            certainty: 'policy',
            template: rawTemplate,
            requested: cappedByProperty,
            materialized: 0,
          });
        }
        return output;
      }
      const templateValue = resolveRecord(templateRecord, [], scopedVariables, false);
      const templateVariables = collectLocalVariables(templateValue, scopedVariables);
      const substitutedTemplateValue = substituteVariables(templateValue, templateVariables, diagnostics);
      const objectBudget = remainingMaterializedObjectBudget();
      const templateObjectCost = Math.max(1, countMaterializationObjects(
        substitutedTemplateValue,
        objectBudget,
      ));
      // Each generated item has its keyed control wrapper, and an authored
      // grid dimension adds one concrete `grid_position` array. Count that
      // array before reserving so the shared object budget matches the actual
      // materialized tree exactly.
      const generatedObjectsPerItem = templateObjectCost + 1 + (hasAuthoredDimensions ? 1 : 0);
      const countByObjectBudget = generatedObjectsPerItem < objectBudget
        ? Math.floor((objectBudget - 1) / generatedObjectsPerItem)
        : 0;
      const count = Math.min(countByItemBudget, countByObjectBudget);
      if (count <= 0) {
        diagnostics.push({
          code: 'UI_GRID_MATERIALIZATION_LIMIT',
          severity: 'warning',
          certainty: 'policy',
          template: rawTemplate,
          collectionName: collectionName || null,
          requested: cappedByProperty,
          materialized: 0,
        });
        return output;
      }
      if (count < cappedByProperty) {
        diagnostics.push({
          code: 'UI_GRID_MATERIALIZATION_LIMIT',
          severity: 'warning',
          certainty: 'policy',
          template: rawTemplate,
          collectionName: collectionName || null,
          requested: cappedByProperty,
          materialized: count,
        });
      }
      const controls = [];
      // Reserve before recursively materializing each grid item so nested
      // collections share the same global cap.
      materializedGridItems += count;
      materializedObjects += 1 + count * generatedObjectsPerItem;
      for (let index = 0; index < count; index += 1) {
        const previewProperties = {
          collection_index: index,
          ...(collectionName ? { __jsonui_preview_collection_name: collectionName } : {}),
        };
        if (hasAuthoredDimensions) {
          const safeColumns = Math.floor(columns);
          const safeRows = Math.floor(rows);
          const verticalFill = String(output.grid_fill_direction || '').trim().toLowerCase() === 'vertical';
          previewProperties.grid_position = [
            verticalFill ? Math.floor(index / safeRows) : index % safeColumns,
            verticalFill ? index % safeRows : Math.floor(index / safeColumns),
          ];
        }
        const item = materializeGridTemplates(
          mergeApproximate(substitutedTemplateValue, previewProperties),
          templateRecord.namespace || namespace,
          depth + 1,
          [...templateStack, templateRecord.id],
          templateVariables,
          nestedCollectionScope(collectionScope, collectionName, index),
        );
        controls.push({ [`preview_slot_${index}`]: markGeneratedSource(item, 'grid') });
      }
      output.controls = controls;
      diagnostics.push({
        code: 'UI_GRID_TEMPLATE_MATERIALIZED',
        severity: 'info',
        certainty: 'approximation',
        template: rawTemplate,
        collectionName: collectionName || null,
        countSource: hasAuthoredDimensions ? 'authored-grid-dimensions' : 'representative-collection',
        count,
      });
      return output;
    }

    const resolvedRoot = materializeGridTemplates(
      substitutedRoot,
      selected.namespace,
      0,
      [selected.id],
      variables,
      representativeCollections,
      selected.localName,
    );
    for (const name of Object.keys(eventFactorySelections)) {
      if (!eventFactoryVisits.has(name)) throw new Error('UI_EVENT_FACTORY_SELECTOR_NOT_FOUND');
    }
    const previewContext = {
      scope: materializedEventFactories.length ? 'explicit-event-factory' : resolvedRoot.type === 'screen' ? 'selected-screen' : 'component',
      selectedDefinition: selected.qualifiedName,
      ancestorConstraints: 'selected-definition-only',
      eventFactories: materializedEventFactories,
      nativeParityVerified: false,
      scriptApiExecuted: false,
    };
    if (previewContext.scope === 'component') diagnostics.push({
      code: 'UI_PREVIEW_ANCESTOR_CONTEXT_UNVERIFIED', severity: 'warning', certainty: 'policy',
      message: '部品定義を単独で投影しています。呼出元の親サイズやイベントfactory制約は含まれず、実機での配置を保証しません。',
    });
    replaceProvisionalVariableDiagnostics(diagnostics, resolvedRoot);
    // Report exact source identity by effective JSON Pointer. Do not infer source
    // array indices from projected indices: inheritance, modifications and
    // generated collection rows may reorder or replace them completely.
    const nodeSources = Object.create(null), sourceInstances = new Map();
    function collectNodeSources(node, pointer, generated = null, depth = 0) {
      if (!isPlainObject(node) || depth > limits.maxControlDepth) return;
      generated = node[GENERATED_SOURCE] || generated;
      const source = node[AUTHORED_SOURCE];
      if (source) {
        const entry = { ...source, scope: generated ? 'shared-template' : 'authored-source',
          inheritance: (node[INHERITANCE_SOURCES] || [source]).map(item => ({ ...item })),
          ...(generated ? { generated } : {}) };
        nodeSources[pointer] = entry;
        const identity = JSON.stringify([source.sourceId, source.path, source.pointer]);
        const instances = sourceInstances.get(identity) || [];
        instances.push(entry); sourceInstances.set(identity, instances);
      }
      const controls = node.controls;
      if (Array.isArray(controls)) controls.forEach((wrapper, index) => {
        if (!isPlainObject(wrapper)) return;
        const prefix = `${pointer}/controls/${index}`;
        if (typeof wrapper.type === 'string' || Object.keys(wrapper).length !== 1) {
          collectNodeSources(wrapper, prefix, generated, depth + 1);
        } else for (const [name, child] of Object.entries(wrapper)) {
          collectNodeSources(child, `${prefix}/${pointerEscape(name)}`, generated, depth + 1);
        }
      });
      else if (isPlainObject(controls)) for (const [name, child] of Object.entries(controls)) {
        collectNodeSources(child, `${pointer}/controls/${pointerEscape(name)}`, generated, depth + 1);
      }
    }
    collectNodeSources(resolvedRoot, `/${pointerEscape(selected.localName)}`);
    for (const entries of sourceInstances.values()) for (const entry of entries) {
      entry.instances = entries.length;
      if (entries.length > 1) entry.scope = 'shared-template';
    }
    return {
      ok: true,
      document: { namespace: selected.namespace, [selected.localName]: resolvedRoot },
      nodeSources,
      selected: selectedSummary,
      previewContext,
      provenance: Array.from(provenanceIds).map((id) => {
        const record = catalog.recordsById[id];
        return { id, sourceKind: record.sourceKind, filePath: record.filePath, qualifiedName: record.qualifiedName };
      }),
      diagnostics,
      dependencyTrace: dependencyTrace.snapshot(),
      semanticsProfile: SEMANTICS_PROFILE,
      stats: progressStats(),
    };
  } catch (error) {
    const code = String(error && error.message ? error.message : error || 'UI_RESOLVE_FAILED');
    const detail = error?.resolutionLimit
      ? { limit: error.resolutionLimit, context: error.resolutionContext }
      : {};
    diagnostics.push({ code, severity: 'error', certainty: code.includes('POCKET') || error?.resolutionLimit ? 'policy' : 'observed', ...detail });
    return { ok: false, error: { code, ...detail }, selected: selectedSummary,
      semanticsProfile: SEMANTICS_PROFILE, diagnostics, dependencyTrace: dependencyTrace.snapshot(), stats: progressStats() };
  }
}
