import { looksLikeLangKey } from '../assets/lang-table.js';
import { parseFixedControlSpec } from '../engine/control-reference.js';
import { normalizePackPath } from '../path/normalize-pack-path.js';

const EXACT_VARIABLE_RE = /^\$[A-Za-z0-9_.-]{1,128}$/u;
// Internal adapter metadata is not forgeable through an uploaded JSON key.
export const EXPORT_ANIMATION_REFERENCES = Symbol('jsonui.export.animation-references');

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 256,
  maxNodes: 100_000,
  maxVariableDepth: 32,
  maxVariableSteps: 2_048,
  maxVariableResolutionSteps: 250_000,
  maxAlternatives: 64,
  maxConditionalBranches: 256,
  maxVariablesPerScope: 2_048,
  maxEnvironmentEntries: 250_000,
  maxCompositionRecordVisits: 2_048,
  maxNativeRenderers: 2_048,
  maxNativeBindingEntries: 16_384,
  maxUiSymbolRefs: 100_000,
  maxDiagnostics: 64,
});

// A scope stores only its new bindings. Copying every global variable into
// every control made ordinary vanilla screens exhaust the work budget before
// reaching their last children. Parent scopes are immutable after construction.
class LexicalEnvironment extends Map {
  constructor(parent) { super(); this.parent = parent; this.entryCount = parent.size; }
  get size() { return this.entryCount; }
  has(key) { return super.has(key) || this.parent.has(key); }
  get(key) { return super.has(key) ? super.get(key) : this.parent.get(key); }
  set(key, value) {
    if (!this.has(key)) this.entryCount += 1;
    return super.set(key, value);
  }
  *entries() {
    yield* super.entries();
    for (const entry of this.parent) if (!super.has(entry[0])) yield entry;
  }
  [Symbol.iterator]() { return this.entries(); }
}

class LexicalBindingSet extends Set {
  constructor(parent) { super(); this.parent = parent; this.entryCount = parent.size; }
  get size() { return this.entryCount; }
  has(value) { return super.has(value) || this.parent.has(value); }
  add(value) {
    if (!this.has(value)) this.entryCount += 1;
    return super.add(value);
  }
  *values() {
    yield* super.values();
    for (const value of this.parent) if (!super.has(value)) yield value;
  }
  [Symbol.iterator]() { return this.values(); }
}

/** @param {any} value */
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} value */
function isExactVariable(value) {
  return EXACT_VARIABLE_RE.test(String(value || '').trim());
}

/** @param {string} value */
function isDynamicAssetReference(value) {
  const text = String(value || '').trim();
  return /^[#$@]/u.test(text) || (text.startsWith('(') && text.endsWith(')'));
}

/** @param {string} key */
function parseVariableDeclarationKey(key) {
  const raw = String(key || '');
  if (!raw.startsWith('$') || raw === '$schema') return null;
  const [name, modifier = ''] = raw.split('|');
  if (!isExactVariable(name)) return null;
  return { name, isDefault: modifier.toLowerCase() === 'default' };
}

/**
 * Bedrock UI JSON permits local `$variable` declarations on a control and in
 * conditional `variables` branches. Export cannot evaluate runtime
 * requirements, so branch values are retained as alternatives. A nested
 * object receives a copy of its ancestor environment; changes never leak to a
 * sibling scope.
 *
 * @param {Map<string, Set<any>>} inherited
 * @param {any} value
 * @param {any} state
 * @param {string} path
 */
function buildLexicalEnvironment(inherited, value, state, path, options = {}) {
  if (!isObject(value)) return inherited;

  // Controls without declarations share their immutable parent environment.
  // This avoids cloning a large global map for every ordinary JSON node.
  const defaults = new Map();
  const exact = new Map();
  let declarationWork = 0;
  for (const [key, child] of Object.entries(value)) {
    const declaration = parseVariableDeclarationKey(key);
    if (!declaration) continue;
    declarationWork += 1;
    const target = declaration.isDefault ? defaults : exact;
    if (!target.has(declaration.name)) target.set(declaration.name, []);
    target.get(declaration.name).push(child);
  }

  const conditionalDeclarations = [];
  if (Array.isArray(value.variables)) {
    const branches = value.variables.slice(0, state.limits.maxConditionalBranches);
    if (value.variables.length > branches.length) {
      pushLimitDiagnostic(state, 'conditional variable branches', `${path}.variables`);
    }
    for (const branch of branches) {
      if (!isObject(branch)) continue;
      const branchDefaults = new Map();
      const branchExact = new Map();
      for (const [key, child] of Object.entries(branch)) {
        const declaration = parseVariableDeclarationKey(key);
        if (!declaration) continue;
        declarationWork += 1;
        const target = declaration.isDefault ? branchDefaults : branchExact;
        if (!target.has(declaration.name)) target.set(declaration.name, []);
        target.get(declaration.name).push(child);
      }
      if (branchDefaults.size > 0 || branchExact.size > 0) {
        conditionalDeclarations.push({ defaults: branchDefaults, exact: branchExact });
      }
    }
  }

  if (defaults.size === 0 && exact.size === 0 && conditionalDeclarations.length === 0) {
    return inherited;
  }
  const environmentWork = declarationWork;
  if (state.environmentEntries + environmentWork > state.limits.maxEnvironmentEntries) {
    pushLimitDiagnostic(state, 'lexical environment work', path);
    return inherited;
  }
  state.environmentEntries += environmentWork;
  const environment = new LexicalEnvironment(inherited);

  /** @param {string} name @param {any[]} candidates @param {boolean} replace */
  function applyCandidates(name, candidates, replace) {
    if (!environment.has(name) && environment.size >= state.limits.maxVariablesPerScope) {
      pushLimitDiagnostic(state, 'variable declarations', path);
      return;
    }

    const prior = environment.get(name);
    const next = replace ? new Set() : new Set(prior || []);
    for (const candidate of candidates) {
      if (next.size >= state.limits.maxAlternatives) {
        pushLimitDiagnostic(state, `variable alternatives`, path);
        break;
      }
      // `$name: "$name"` forwards an inherited value in shipped Bedrock UI.
      // Preserve that value instead of replacing it with an artificial cycle.
      if (typeof candidate === 'string' && candidate.trim() === name && prior && prior.size > 0) {
        for (const inheritedCandidate of prior) next.add(inheritedCandidate);
      } else {
        next.add(candidate);
      }
    }
    environment.set(name, next);
  }

  const protectedExact = options.protectedExact instanceof Set
    ? options.protectedExact
    : null;
  const protectedConditionalExact = options.protectedConditionalExact instanceof Set
    ? options.protectedConditionalExact
    : null;
  const inheritedGuaranteed = state.guaranteedBindingsByEnvironment instanceof WeakMap
    ? state.guaranteedBindingsByEnvironment.get(inherited) || new Set()
    : new Set();
  // Defaults are fallbacks. A caller's conditional exact value exists only
  // while its requirement is true, so a base default remains reachable on the
  // false branch. Do not retain that default when this same base scope has an
  // exact declaration: the exact value wins regardless of JSON member order.
  for (const [name, candidates] of defaults) {
    if (!inheritedGuaranteed.has(name) && !exact.has(name)) {
      applyCandidates(name, candidates, false);
    }
  }
  for (const [name, candidates] of exact) {
    if (!protectedExact?.has(name)) {
      // A caller's conditional override wins only when its requirement is
      // true. Retain both it and the base's exact value so export covers the
      // false branch as well.
      applyCandidates(name, candidates, !protectedConditionalExact?.has(name));
    }
  }

  // Requirements are runtime expressions. Each branch may or may not apply,
  // so union its possible assignments with the current value rather than
  // choosing an arbitrary branch and risking an omitted dependency.
  for (const branch of conditionalDeclarations) {
    for (const [name, candidates] of branch.defaults) {
      const scopeHasUnconditionalValue = defaults.has(name) || exact.has(name);
      if (!inheritedGuaranteed.has(name)
        && !scopeHasUnconditionalValue
        && !branch.exact.has(name)) {
        applyCandidates(name, candidates, false);
      }
    }
    for (const [name, candidates] of branch.exact) {
      if (!protectedExact?.has(name)) applyCandidates(name, candidates, false);
    }
  }

  if (options.trackExactOverrides !== false
    && state.inheritanceExactOverridesByEnvironment instanceof WeakMap) {
    const inheritedExact = state.inheritanceExactOverridesByEnvironment.get(inherited);
    const inheritedConditional = state.inheritanceConditionalOverridesByEnvironment.get(inherited);
    const nextExact = new Set(inheritedExact || []);
    const nextConditional = new Set(inheritedConditional || []);
    for (const name of exact.keys()) {
      nextExact.add(name);
      nextConditional.delete(name);
    }
    for (const branch of conditionalDeclarations) {
      for (const name of branch.exact.keys()) {
        if (!nextExact.has(name)) nextConditional.add(name);
      }
    }
    state.inheritanceExactOverridesByEnvironment.set(environment, nextExact);
    state.inheritanceConditionalOverridesByEnvironment.set(environment, nextConditional);
  }

  if (state.guaranteedBindingsByEnvironment instanceof WeakMap) {
    const nextGuaranteed = new LexicalBindingSet(inheritedGuaranteed);
    for (const name of defaults.keys()) nextGuaranteed.add(name);
    for (const name of exact.keys()) nextGuaranteed.add(name);
    state.guaranteedBindingsByEnvironment.set(environment, nextGuaranteed);
  }

  return environment;
}

/** @param {{ value: string }} params */
function looksLikeUiJsonRef({ value }) {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  if (!(lower.endsWith('.json') || lower.endsWith('.jsonc'))) return false;
  return lower.includes('ui/');
}

/** @param {{ key: string }} params */
function isLikelyTexturePropKey({ key }) {
  // Avoid keys such as texture_file_system while retaining texture,
  // default_texture, hover_texture, and similar Bedrock properties.
  return String(key || '').toLowerCase().endsWith('texture');
}

/** @param {any} diagnostic */
function diagnosticKey(diagnostic) {
  return [
    diagnostic?.code,
    diagnostic?.assetKind,
    diagnostic?.reference,
    diagnostic?.sourcePath,
    diagnostic?.jsonPath,
    diagnostic?.reason,
  ].map((part) => String(part || '')).join('\u0000');
}

/** @param {any} state @param {any} diagnostic */
function pushDiagnostic(state, diagnostic) {
  const key = diagnosticKey(diagnostic);
  if (state.diagnosticKeys.has(key)) return;

  if (state.outDiagnostics.length >= state.limits.maxDiagnostics) {
    pushDiagnosticLimitMarker(state);
    return;
  }

  state.diagnosticKeys.add(key);
  state.outDiagnostics.push(diagnostic);
}

/** @param {any} state */
function pushDiagnosticLimitMarker(state) {
  state.limitReasons.add('diagnostics');
  if (state.outDiagnostics.some((item) => item?.code === 'EXPORT_DEPENDENCY_SCAN_LIMIT' && item?.reason === 'diagnostics')) {
    return;
  }
  const key = 'EXPORT_DEPENDENCY_SCAN_LIMIT\u0000diagnostics';
  if (state.diagnosticKeys.has(key)) return;
  state.diagnosticKeys.add(key);
  state.outDiagnostics.push({
    code: 'EXPORT_DEPENDENCY_SCAN_LIMIT',
    severity: 'warning',
    sourcePath: state.sourcePath || null,
    jsonPath: '$',
    reason: 'diagnostics',
    message: `Export dependency scanning reached its diagnostics safety limit${formatLocation(state.sourcePath, '$')}; additional unresolved dependencies were suppressed.`,
  });
}

/** @param {any} state @param {string} subject @param {string} path */
function pushLimitDiagnostic(state, subject, path) {
  state.limitReasons.add(subject);
  const code = 'EXPORT_DEPENDENCY_SCAN_LIMIT';
  const key = `${code}\u0000${subject}\u0000${state.sourcePath}`;
  if (state.diagnosticKeys.has(key)) return;
  if (state.outDiagnostics.length >= state.limits.maxDiagnostics) {
    pushDiagnosticLimitMarker(state);
    return;
  }

  state.diagnosticKeys.add(key);
  state.outDiagnostics.push({
    code,
    severity: 'warning',
    sourcePath: state.sourcePath || null,
    jsonPath: path,
    reason: subject,
    message: `Export dependency scanning reached its ${subject} safety limit${formatLocation(state.sourcePath, path)}; some dynamic dependencies may be omitted.`,
  });
}

/** @param {string} sourcePath @param {string} jsonPath */
function formatLocation(sourcePath, jsonPath) {
  const file = String(sourcePath || '').trim();
  const path = String(jsonPath || '').trim();
  if (file && path) return ` in ${file} at ${path}`;
  if (file) return ` in ${file}`;
  if (path) return ` at ${path}`;
  return '';
}

/** @param {string} parent @param {string|number} part @param {boolean} index */
function appendJsonPath(parent, part, index) {
  const base = String(parent || '$');
  if (index) return `${base}[${part}]`.slice(0, 320);
  const key = String(part || '');
  const suffix = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/u.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key.slice(0, 80))}]`;
  return `${base}${suffix}`.slice(0, 320);
}

/**
 * Record a fixed `@namespace.control` dependency without attempting to merge
 * it in the raw scanner. The caller can resolve the resulting graph against
 * the already bounded UI catalog, including lower resource-pack layers.
 *
 * @param {unknown} raw
 * @param {any} state
 * @param {string} path
 * @param {string} property
 * @param {{ environment?: Map<string, Set<any>>, depth?: number }} [options]
 */
function collectUiSymbolReference(raw, state, path, property, options = {}) {
  const environment = options.environment instanceof Map ? options.environment : new Map();
  const parsed = parseFixedControlSpec(raw, state.rootNamespace);
  if (!parsed.ok && parsed.reason === 'variable' && parsed.variable) {
    const resolved = resolveVariableAlternatives(parsed.variable, environment, state);
    for (const reason of resolved.issues) {
      state.unresolvedUiSymbolReasons.add(reason);
      pushDiagnostic(state, {
        code: 'EXPORT_UI_SYMBOL_DYNAMIC',
        severity: 'warning',
        assetKind: 'ui-symbol',
        property,
        reference: parsed.raw.slice(0, 160),
        sourcePath: state.sourcePath || null,
        jsonPath: path,
        reason,
        message: `Export could not statically resolve UI symbol ${parsed.raw.slice(0, 160)}${formatLocation(state.sourcePath, path)} (${reason}); dependencies inherited through it may be omitted.`,
      });
    }
    const environments = [];
    if (resolved.values.size > 1 && options.scopeTransfers) options.scopeTransfers.dynamicBaseAlternatives = true;
    for (const candidate of resolved.values) {
      const candidateEnvironment = collectUiSymbolReference(candidate, state, path, property, {
        environment,
        depth: options.depth,
        shadow: options.shadow,
        controlId: options.controlId,
        ownerKey: options.ownerKey,
        referenceKind: options.referenceKind,
        scopeTransfers: options.scopeTransfers,
      });
      if (candidateEnvironment instanceof Map) {
        environments.push(candidateEnvironment);
      }
    }
    return state.joinEnvironments?.(environment, environments);
  }
  if (!parsed.ok) {
    state.unresolvedUiSymbolReasons.add(parsed.reason);
    pushDiagnostic(state, {
      code: 'EXPORT_UI_SYMBOL_DYNAMIC',
      severity: 'warning',
      assetKind: 'ui-symbol',
      property,
      reference: parsed.raw.slice(0, 160),
      sourcePath: state.sourcePath || null,
      jsonPath: path,
      reason: parsed.reason,
      message: `Export could not statically resolve UI symbol ${parsed.raw.slice(0, 160)}${formatLocation(state.sourcePath, path)} (${parsed.reason}); dependencies inherited through it may be omitted.`,
    });
    return;
  }
  if (!state.outUiSymbolRefs.has(parsed.qualifiedName)) {
    if (state.outUiSymbolRefs.size >= state.limits.maxUiSymbolRefs) {
      pushLimitDiagnostic(state, 'UI symbol references', path);
      return;
    }
    state.outUiSymbolRefs.add(parsed.qualifiedName);
  }
  if (typeof state.followUiSymbolReference === 'function') {
    return state.followUiSymbolReference(
      parsed.qualifiedName,
      environment,
      Number(options.depth) || 0,
      path,
      options.shadow,
      { property, controlId: options.controlId, ownerKey: options.ownerKey,
        sourcePath: state.sourcePath, recordId: state.currentRecordId, ...(options.referenceKind ? { referenceKind: options.referenceKind } : {}) },
      options.scopeTransfers,
    );
  }
}

/**
 * Resolve a factory `control_ids` map, including the official form where the
 * entire object is supplied through an exact lexical `$variable`.
 *
 * @param {unknown} raw
 * @param {Map<string, Set<any>>} environment
 * @param {any} state
 * @param {string} path
 */
function collectControlIdReferences(raw, environment, state, path, depth = 0, ownerKey = null, referenceKind = null) {
  let candidates = new Set([raw]);
  const issues = new Set();
  if (typeof raw === 'string' && isExactVariable(raw.trim())) {
    const resolved = resolveVariableAlternatives(raw.trim(), environment, state, {
      allowNonStringTerminals: true,
    });
    candidates = resolved.values;
    for (const issue of resolved.issues) issues.add(issue);
  }

  for (const reason of issues) {
    state.unresolvedUiSymbolReasons.add(reason);
    pushDiagnostic(state, {
      code: 'EXPORT_UI_SYMBOL_DYNAMIC',
      severity: 'warning',
      assetKind: 'ui-symbol',
      property: 'control_ids',
      reference: String(raw).slice(0, 160),
      sourcePath: state.sourcePath || null,
      jsonPath: path,
      reason,
      message: `Export could not statically resolve factory control_ids${formatLocation(state.sourcePath, path)} (${reason}); dependencies inherited through it may be omitted.`,
    });
  }

  for (const candidate of candidates) {
    if (!isObject(candidate)) {
      if (issues.size === 0) {
        state.unresolvedUiSymbolReasons.add('control-ids-not-static-object');
        pushDiagnostic(state, {
          code: 'EXPORT_UI_SYMBOL_DYNAMIC',
          severity: 'warning',
          assetKind: 'ui-symbol',
          property: 'control_ids',
          reference: String(candidate).slice(0, 160),
          sourcePath: state.sourcePath || null,
          jsonPath: path,
          reason: 'control-ids-not-static-object',
          message: `Export could not statically resolve factory control_ids${formatLocation(state.sourcePath, path)} (control-ids-not-static-object); dependencies inherited through it may be omitted.`,
        });
      }
      continue;
    }
    for (const [controlId, controlSpec] of Object.entries(candidate)) {
      if (state.controlIdEntries >= state.limits.maxUiSymbolRefs) {
        pushLimitDiagnostic(state, 'factory control id entries', path);
        return;
      }
      state.controlIdEntries += 1;
      collectUiSymbolReference(
        controlSpec,
        state,
        appendJsonPath(path, controlId, false),
        'control_ids',
        { environment, depth, controlId, ownerKey, referenceKind },
      );
    }
  }
}

/**
 * Retain only the small authored property surface needed to determine native
 * preview dependencies. Export scans parsed JSON rather than executing a UI,
 * so collection/binding-provided item ids remain explicitly runtime-dependent.
 *
 * @param {Record<string, any>} current
 * @param {string} renderer
 */
function buildNativeRendererDependencyProps(current, renderer, environment, state) {
  const props = Object.create(null);
  props.renderer = renderer;
  const bindingArrays = typeof current.bindings === 'string' && isExactVariable(current.bindings)
    ? resolveVariableAlternatives(current.bindings, environment, state, { allowNonStringTerminals: true }).values
    : [current.bindings];
  for (const bindings of bindingArrays) if (Array.isArray(bindings)) {
    props.bindings ||= [];
    for (const binding of bindings) {
      if (!isObject(binding)) continue;
      let alternatives = [Object.create(null)];
      for (const key of ['binding_name', 'binding_name_override', 'binding_type', 'binding_collection_name']) {
        const raw = binding[key];
        if (typeof raw !== 'string' || raw.length > 256) continue;
        let values = [raw];
        if (isExactVariable(raw)) {
          const resolved = resolveVariableAlternatives(raw, environment, state);
          // Keep unresolved evidence so the caller cannot accidentally certify
          // only the known branch of a partly dynamic native binding.
          values = [...resolved.values, ...(resolved.issues.size ? [raw] : [])];
        }
        const expanded = [];
        for (const alternative of alternatives) for (const value of values) {
          if (expanded.length >= state.limits.maxAlternatives) { pushLimitDiagnostic(state, 'native binding alternatives', '$'); break; }
          expanded.push(Object.assign(Object.create(null), alternative, { [key]: value }));
        }
        alternatives = expanded;
      }
      for (const alternative of alternatives) {
        if (++state.nativeBindingEntries > state.limits.maxNativeBindingEntries) {
          pushLimitDiagnostic(state, 'native binding entries', '$'); return props;
        }
        props.bindings.push(alternative);
      }
    }
  }
  for (const key of ['#item_id_aux', 'item_id_aux']) {
    if (Object.prototype.hasOwnProperty.call(current, key)) props[key] = current[key];
  }
  if (isObject(current.property_bag)) {
    const propertyBag = Object.create(null);
    for (const key of ['#item_id_aux', 'item_id_aux']) {
      if (Object.prototype.hasOwnProperty.call(current.property_bag, key)) {
        propertyBag[key] = current.property_bag[key];
      }
    }
    if (Reflect.ownKeys(propertyBag).length > 0) props.property_bag = propertyBag;
  }
  return props;
}

/**
 * @param {Record<string, any>} current
 * @param {Map<string, Set<any>>} environment
 * @param {string} path
 * @param {any} state
 */
function collectNativeRendererDependencies(current, environment, path, state) {
  if (!Object.prototype.hasOwnProperty.call(current, 'renderer')) return;
  const raw = current.renderer;
  const rendererPath = appendJsonPath(path, 'renderer', false);
  let candidates = new Set();
  const issues = new Set();

  if (typeof raw !== 'string') {
    issues.add('non-string-renderer');
  } else {
    const reference = raw.trim();
    if (!reference) {
      issues.add('empty-renderer');
    } else if (isExactVariable(reference)) {
      const resolved = resolveVariableAlternatives(reference, environment, state);
      candidates = resolved.values;
      for (const issue of resolved.issues) issues.add(issue);
    } else if (isDynamicAssetReference(reference)) {
      issues.add('dynamic-reference');
    } else {
      candidates.add(reference);
    }
  }

  for (const reason of issues) {
    pushDiagnostic(state, {
      code: 'EXPORT_NATIVE_RENDERER_DYNAMIC',
      severity: 'warning',
      assetKind: 'native-renderer',
      property: 'renderer',
      reference: typeof raw === 'string' ? raw.trim().slice(0, 160) : String(raw).slice(0, 160),
      sourcePath: state.sourcePath || null,
      jsonPath: rendererPath,
      reason,
      message: `Export could not statically resolve a native renderer${formatLocation(state.sourcePath, rendererPath)} (${reason}); its implicit runtime assets may be omitted.`,
    });
  }

  for (const candidate of candidates) {
    const renderer = String(candidate || '').trim();
    if (!renderer || renderer.length > 160 || isDynamicAssetReference(renderer)) {
      pushDiagnostic(state, {
        code: 'EXPORT_NATIVE_RENDERER_DYNAMIC',
        severity: 'warning',
        assetKind: 'native-renderer',
        property: 'renderer',
        reference: renderer.slice(0, 160),
        sourcePath: state.sourcePath || null,
        jsonPath: rendererPath,
        reason: 'invalid-renderer-name',
        message: `Export could not statically resolve a native renderer${formatLocation(state.sourcePath, rendererPath)} (invalid-renderer-name); its implicit runtime assets may be omitted.`,
      });
      continue;
    }
    if (state.outNativeRenderers.length >= state.limits.maxNativeRenderers) {
      pushLimitDiagnostic(state, 'native renderer controls', rendererPath);
      return;
    }
    state.outNativeRenderers.push({
      props: buildNativeRendererDependencyProps(current, renderer, environment, state),
      sourcePath: state.sourcePath || null,
      jsonPath: path,
    });
  }
}

/**
 * Native renderer templates and their item-id specializations commonly live
 * in separate `@namespace.control` records. Retain fixed packed ids
 * independently so the export closure can conservatively pair them with any
 * inventory renderer in the same bounded UI closure.
 *
 * @param {Record<string, any>} current
 * @param {string} path
 * @param {any} state
 */
function collectNativeItemIdDependencies(current, environment, path, state) {
  const containers = [
    { value: current, path, propertyBag: false },
    ...(isObject(current.property_bag)
      ? [{ value: current.property_bag, path: appendJsonPath(path, 'property_bag', false), propertyBag: true }]
      : []),
  ];

  for (const container of containers) {
    for (const key of ['#item_id_aux', 'item_id_aux']) {
      if (!Object.prototype.hasOwnProperty.call(container.value, key)) continue;
      const raw = container.value[key];
      const jsonPath = appendJsonPath(container.path, key, false);
      let candidates = new Set([raw]);
      const issues = new Set();
      if (typeof raw === 'string' && isExactVariable(raw.trim())) {
        const resolved = resolveVariableAlternatives(raw.trim(), environment, state, {
          allowNonStringTerminals: true,
        });
        candidates = resolved.values;
        for (const issue of resolved.issues) issues.add(issue);
      } else if (typeof raw !== 'number') {
        issues.add('non-fixed-packed-item-id');
      }

      for (const issue of issues) {
        pushDiagnostic(state, {
          code: 'EXPORT_NATIVE_ITEM_ID_DYNAMIC',
          severity: 'warning',
          assetKind: 'native-renderer',
          property: key,
          reference: String(raw).slice(0, 160),
          sourcePath: state.sourcePath || null,
          jsonPath,
          reason: issue,
          message: `Export could not statically resolve native packed item id ${key}${formatLocation(state.sourcePath, jsonPath)} (${issue}); its implicit runtime texture may be omitted.`,
        });
      }

      for (const candidate of candidates) {
        if (!Number.isSafeInteger(candidate) || candidate < -0x8000_0000 || candidate > 0xffff_ffff) {
          pushDiagnostic(state, {
            code: 'EXPORT_NATIVE_ITEM_ID_DYNAMIC',
            severity: 'warning',
            assetKind: 'native-renderer',
            property: key,
            reference: String(candidate).slice(0, 160),
            sourcePath: state.sourcePath || null,
            jsonPath,
            reason: 'non-fixed-packed-item-id',
            message: `Export could not statically resolve native packed item id ${key}${formatLocation(state.sourcePath, jsonPath)}; its implicit runtime texture may be omitted.`,
          });
          continue;
        }
        const dependencyKey = `${state.sourcePath}\u0000${jsonPath}\u0000${String(candidate)}`;
        // A property_bag is visited both as its owner's bounded native-input
        // container and as an ordinary child object. Keep one dependency fact
        // for that single authored JSON path.
        if (state.nativeItemDependencyKeys.has(dependencyKey)) continue;
        state.nativeItemDependencyKeys.add(dependencyKey);
        if (state.outNativeItemIds.length >= state.limits.maxNativeRenderers) {
          pushLimitDiagnostic(state, 'native item id controls', path);
          return;
        }
        const props = Object.create(null);
        props.renderer = 'inventory_item_renderer';
        props[key] = candidate;
        state.outNativeItemIds.push({
          props,
          sourcePath: state.sourcePath || null,
          jsonPath: path,
        });
      }
    }
  }
}

/**
 * Resolve all statically possible terminal values for one exact `$variable`.
 *
 * @param {string} variable
 * @param {Map<string, Set<any>>} environment
 * @param {any} state
 */
function resolveVariableAlternatives(variable, environment, state, options = {}) {
  const values = new Set();
  const issues = new Set();
  let steps = 0;

  /** @param {string} name @param {string[]} stack @param {number} depth */
  function visit(name, stack, depth) {
    if (state.variableResolutionExhausted) {
      issues.add('variable-step-limit');
      return;
    }
    steps += 1;
    state.variableResolutionSteps += 1;
    if (steps > state.limits.maxVariableSteps
      || state.variableResolutionSteps > state.limits.maxVariableResolutionSteps) {
      state.variableResolutionExhausted = true;
      state.limitReasons.add('variable resolution steps');
      issues.add('variable-step-limit');
      return;
    }
    if (depth > state.limits.maxVariableDepth) {
      state.limitReasons.add('variable resolution depth');
      issues.add('variable-depth-limit');
      return;
    }
    if (stack.includes(name)) {
      issues.add('variable-cycle');
      return;
    }
    const candidates = environment.get(name);
    if (!candidates || candidates.size === 0) {
      issues.add('missing-variable');
      return;
    }

    for (const candidate of candidates) {
      if (values.size >= state.limits.maxAlternatives) {
        state.limitReasons.add('variable alternatives');
        issues.add('alternative-limit');
        return;
      }
      if (typeof candidate !== 'string') {
        if (options.allowNonStringTerminals === true) values.add(candidate);
        else issues.add('non-string-value');
        continue;
      }
      const text = candidate.trim();
      if (!text) {
        if (options.allowEmpty !== true) issues.add('empty-value');
        continue;
      }
      if (isExactVariable(text)) {
        visit(text, [...stack, name], depth + 1);
      } else {
        values.add(text);
      }
    }
  }

  visit(variable, [], 0);
  return { values, issues };
}

/**
 * @param {{
 *  raw: string,
 *  assetKind: 'texture'|'font'|'localization',
 *  property: string,
 *  jsonPath: string,
 *  environment: Map<string, Set<any>>,
 *  output: Set<string>,
 *  accept: (value: string) => boolean,
 *  state: any,
 * }} params
 */
function collectAssetReference({ raw, assetKind, property, jsonPath, environment, output, accept, state }) {
  const reference = String(raw || '').trim();
  if (!reference) return;

  let candidates = new Set([reference]);
  if (isExactVariable(reference)) {
    const resolved = resolveVariableAlternatives(reference, environment, state, { allowEmpty: true });
    candidates = resolved.values;
    for (const reason of resolved.issues) {
      pushDiagnostic(state, {
        code: 'EXPORT_ASSET_VARIABLE_UNRESOLVED',
        severity: 'warning',
        assetKind,
        property,
        reference,
        sourcePath: state.sourcePath || null,
        jsonPath,
        reason,
        message: `Export could not fully resolve ${assetKind} variable ${reference}${formatLocation(state.sourcePath, jsonPath)} (${reason}); its runtime dependency may be omitted.`,
      });
    }
  }

  if (candidates.size === 0 && !isExactVariable(reference)) candidates.add(reference);

  for (const candidate of candidates) {
    if (isDynamicAssetReference(candidate)) {
      pushDiagnostic(state, {
        code: 'EXPORT_ASSET_DYNAMIC_REFERENCE',
        severity: 'warning',
        assetKind,
        property,
        reference: candidate,
        sourcePath: state.sourcePath || null,
        jsonPath,
        reason: 'dynamic-reference',
        message: `Export cannot statically resolve dynamic ${assetKind} reference ${candidate}${formatLocation(state.sourcePath, jsonPath)}; its runtime dependency may be omitted.`,
      });
      continue;
    }
    if (accept(candidate)) output.add(candidate);
  }
}

/**
 * Extract the imported global-variable values that seed every UI file's
 * lexical export scan. Both observed file formats are supported:
 * `{ "$name": value }` and `{ "variables": { "name": value } }`.
 *
 * @param {any} value
 * @returns {Record<string, any>}
 */
export function extractExportRootVariables(value) {
  const output = Object.create(null);
  if (!isObject(value)) return output;
  const wrapped = isObject(value.variables);
  const declarations = wrapped ? value.variables : value;

  for (const [rawKey, child] of Object.entries(declarations)) {
    if (!rawKey || rawKey === '$schema') continue;
    const key = rawKey.startsWith('$') ? rawKey : (wrapped ? `$${rawKey}` : rawKey);
    if (!parseVariableDeclarationKey(key)) continue;
    output[key] = child;
  }
  return output;
}

/**
 * Collect UI JSON and asset dependencies from parsed Bedrock UI JSON.
 *
 * Exact `$variable` values used by texture, font, or localized-text properties
 * are resolved through bounded lexical environments. Runtime expressions and
 * unresolved alternatives are reported instead of being silently discarded.
 *
 * @param {{
 *  value: any,
 *  outUiJsonRefs: Set<string>,
 *  outTextureRefs: Set<string>,
 *  outFontRefs: Set<string>,
 *  outLangKeys: Set<string>,
 *  outUiSymbolRefs?: Set<string>,
 *  outNativeRenderers?: { props: Record<string, any>, sourcePath: string|null, jsonPath: string }[],
 *  outNativeItemIds?: { props: Record<string, any>, sourcePath: string|null, jsonPath: string }[],
 *  outDiagnostics?: any[],
 *  sourcePath?: string,
 *  rootVariables?: Record<string, any>|null,
 *  rootNamespace?: string,
 *  rootAuthoredKey?: string|null,
 *  rootRecordId?: string|null,
 *  resolveUiSymbolCandidates?: ((qualifiedName: string) => any[])|null,
 *  onResolvedControls?: ((value: any, context: { sourcePath: string, jsonPath: string, recordId: string|null }) => void)|null,
 *  limits?: Partial<typeof DEFAULT_LIMITS>,
 * }} params
 */
export function scanJsonForExportDeps({
  value,
  outUiJsonRefs,
  outTextureRefs,
  outFontRefs,
  outLangKeys,
  outUiSymbolRefs = new Set(),
  outNativeRenderers = [],
  outNativeItemIds = [],
  outDiagnostics = [],
  sourcePath = '',
  rootVariables = null,
  rootNamespace = '',
  rootAuthoredKey = null,
  rootRecordId = null,
  resolveUiSymbolCandidates = null,
  onResolvedControls = null,
  limits = {},
}) {
  const boundedLimits = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const requested = Number(limits?.[key]);
    boundedLimits[key] = Number.isFinite(requested) && requested >= 0
      ? Math.floor(requested)
      : fallback;
  }

  const state = {
    sourcePath: String(sourcePath || ''),
    outDiagnostics,
    outNativeRenderers,
    outNativeItemIds,
    outUiSymbolRefs,
    diagnosticKeys: new Set(outDiagnostics.map(diagnosticKey)),
    nativeItemDependencyKeys: new Set(),
    limitReasons: new Set(),
    limits: boundedLimits,
    nodes: 0,
    environmentEntries: 0,
    variableResolutionSteps: 0,
    variableResolutionExhausted: false,
    controlIdEntries: 0,
    nativeBindingEntries: 0,
    unresolvedUiSymbolReasons: new Set(),
    ancestors: new Set(),
    inheritanceExactOverridesByEnvironment: new WeakMap(),
    inheritanceConditionalOverridesByEnvironment: new WeakMap(),
    guaranteedBindingsByEnvironment: new WeakMap(),
    maskOwners: new WeakMap(),
    currentRecordId: rootRecordId || null,
    compositionRecordStack: new Set(rootRecordId ? [String(rootRecordId)] : []),
    compositionRecordVisits: 0,
    resolveUiSymbolCandidates: typeof resolveUiSymbolCandidates === 'function'
      ? resolveUiSymbolCandidates
      : null,
    followUiSymbolReference: null,
    rootNamespace: typeof rootNamespace === 'string' && rootNamespace.trim()
      ? rootNamespace.trim()
      : isObject(value) && typeof value.namespace === 'string'
        ? value.namespace.trim()
        : '',
  };

  const root = isObject(rootVariables)
    ? buildLexicalEnvironment(new Map(), rootVariables, state, '$rootVariables', {
        trackExactOverrides: false,
      })
    : new Map();
  state.rootEnvironment = root;

  /** Resolve only the type needed to interpret a control_name property. */
  function factoryControlType(current, authoredKey, environment, namespace, path, depth = 0, chain = new Set()) {
    const incomplete = reason => {
      state.unresolvedUiSymbolReasons.add(reason);
      pushDiagnostic(state, { code: 'EXPORT_FACTORY_TYPE_UNRESOLVED', severity: 'warning', assetKind: 'ui-symbol',
        property: 'control_name', reference: String(authoredKey || '').slice(0, 160), sourcePath: state.sourcePath || null,
        jsonPath: path, reason, message: `Export could not determine the inherited control type${formatLocation(state.sourcePath, path)} (${reason}).` });
      return null;
    };
    if (depth > state.limits.maxDepth) { pushLimitDiagnostic(state, 'factory type inheritance depth', path); return null; }
    if (Object.prototype.hasOwnProperty.call(current, 'type')) {
      if (typeof current.type !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(current.type.trim())) return incomplete('dynamic-control-type');
      return current.type.trim().toLowerCase();
    }
    if (typeof authoredKey !== 'string' || !authoredKey.includes('@')) return null;
    const parsed = parseFixedControlSpec(authoredKey, namespace);
    let references = [parsed];
    if (!parsed.ok && parsed.reason === 'variable' && parsed.variable) {
      const resolved = resolveVariableAlternatives(parsed.variable, environment, state);
      if (resolved.issues.size || !resolved.values.size) return incomplete('dynamic-inherited-control-type');
      references = [...resolved.values].map(value => parseFixedControlSpec(value, namespace));
    }
    if (references.some(reference => !reference.ok) || !state.resolveUiSymbolCandidates) return incomplete('inherited-control-type-unavailable');
    const types = new Set();
    for (const reference of references) {
      let candidates;
      try { candidates = state.resolveUiSymbolCandidates(reference.qualifiedName); }
      catch { pushLimitDiagnostic(state, 'UI symbol resolver', path); return null; }
      if (!Array.isArray(candidates) || candidates.length > state.limits.maxAlternatives) { pushLimitDiagnostic(state, 'UI symbol candidates', path); return null; }
      const target = candidates.find(candidate => typeof candidate?.id === 'string' && !chain.has(candidate.id));
      if (!target || !isObject(target.value)) return incomplete('inherited-control-type-unavailable');
      if (++state.compositionRecordVisits > state.limits.maxCompositionRecordVisits) { pushLimitDiagnostic(state, 'UI composition record visits', path); return null; }
      const nextChain = new Set(chain); nextChain.add(target.id);
      const nextEnvironment = buildLexicalEnvironment(environment, target.value, state, path, {
        protectedExact: state.inheritanceExactOverridesByEnvironment.get(environment) || null,
        protectedConditionalExact: state.inheritanceConditionalOverridesByEnvironment.get(environment) || null,
      });
      const type = factoryControlType(target.value, target.rawKey, nextEnvironment, target.namespace || '', path, depth + 1, nextChain);
      if (type === null) return incomplete('inherited-control-type-unavailable');
      types.add(type);
    }
    if (types.size !== 1) return incomplete('conditional-control-type');
    return [...types][0];
  }

  /** @param {any} current @param {Map<string, Set<any>>} inherited @param {number} depth @param {string} path @param {string|null} authoredKey @param {Set<string>|null} protectedExact @param {Set<string>|null} protectedConditionalExact */
  function walk(
    current,
    inherited,
    depth,
    path,
    authoredKey = null,
    protectedExact = null,
    protectedConditionalExact = null,
    shadow = null,
    incomingTransfers = null,
  ) {
    if (depth > state.limits.maxDepth) {
      pushLimitDiagnostic(state, 'JSON depth', path);
      return;
    }
    state.nodes += 1;
    if (state.nodes > state.limits.maxNodes) {
      pushLimitDiagnostic(state, 'JSON nodes', path);
      return;
    }

    if (Array.isArray(current)) {
      if (state.ancestors.has(current)) {
        pushLimitDiagnostic(state, 'cyclic JSON input', path);
        return;
      }
      state.ancestors.add(current);
      for (let index = 0; index < current.length; index += 1) {
        walk(current[index], inherited, depth + 1, appendJsonPath(path, index, true));
        if (state.nodes > state.limits.maxNodes) break;
      }
      state.ancestors.delete(current);
      return;
    }
    if (!isObject(current)) return;
    if (state.ancestors.has(current)) {
      pushLimitDiagnostic(state, 'cyclic JSON input', path);
      return;
    }

    state.ancestors.add(current);
    const transferred = isObject(shadow) ? null : incomingTransfers?.get(current);
    const scopeTransfers = incomingTransfers || new WeakMap();
    scopeTransfers.localizeByControl ||= new WeakMap();
    let incomingEnvironment = transferred || inherited;
    if (isObject(shadow)) {
      incomingEnvironment = buildLexicalEnvironment(incomingEnvironment, shadow, state, path);
      const exactNames = new Set(protectedExact || []);
      const conditionalNames = new Set(protectedConditionalExact || []);
      for (const key of Object.keys(shadow)) {
        const declaration = parseVariableDeclarationKey(key);
        if (declaration && !declaration.isDefault) exactNames.add(declaration.name);
      }
      for (const branch of Array.isArray(shadow.variables) ? shadow.variables.slice(0, state.limits.maxConditionalBranches) : []) {
        if (!isObject(branch)) continue;
        for (const key of Object.keys(branch)) {
          const declaration = parseVariableDeclarationKey(key);
          if (declaration && !declaration.isDefault) conditionalNames.add(declaration.name);
        }
      }
      protectedExact = exactNames;
      protectedConditionalExact = conditionalNames;
    }
    let environment = buildLexicalEnvironment(incomingEnvironment, current, state, path, {
      protectedExact,
      protectedConditionalExact,
    });
    if (typeof authoredKey === 'string' && authoredKey.includes('@')) {
      const inheritedEnvironment = collectUiSymbolReference(authoredKey, state, path, authoredKey, {
        environment, depth, shadow: mergeShadow(current, shadow), scopeTransfers,
      });
      if (inheritedEnvironment instanceof Map) environment = inheritedEnvironment;
    }
    const effectiveProperty = key => !(isObject(shadow) && Object.prototype.hasOwnProperty.call(shadow, key));
    // Bedrock labels localize by default. Only an explicit false is literal.
    const localize = (isObject(shadow) && Object.prototype.hasOwnProperty.call(shadow, 'localize')
      ? shadow.localize : Object.prototype.hasOwnProperty.call(current, 'localize')
        ? current.localize : scopeTransfers.dynamicBaseAlternatives ? true : scopeTransfers.localizeByControl.get(current)) !== false;
    if (effectiveProperty('renderer')) collectNativeRendererDependencies(
      isObject(shadow) ? { ...current, ...shadow } : current, environment, path, state,
    );
    collectNativeItemIdDependencies(maskShadow(current, shadow), environment, path, state);
    const hasControlName = effectiveProperty('control_name') && Object.prototype.hasOwnProperty.call(current, 'control_name');
    const isStandaloneFactory = hasControlName && authoredKey !== 'factory'
      && factoryControlType(current, authoredKey, environment, state.rootNamespace, path) === 'factory';
    if ((authoredKey === 'factory' || isStandaloneFactory)
      && hasControlName) {
      collectUiSymbolReference(
        current.control_name,
        state,
        appendJsonPath(path, 'control_name', false),
        'factory.control_name',
        { environment, depth },
      );
    }
    if (Object.prototype.hasOwnProperty.call(current, 'control_ids')
      && (effectiveProperty('control_ids') || isObject(current.control_ids) && isObject(shadow?.control_ids))) {
      collectControlIdReferences(
        maskShadow(current.control_ids, shadow?.control_ids),
        environment,
        state,
        appendJsonPath(path, 'control_ids', false),
        depth,
        authoredKey,
        current[EXPORT_ANIMATION_REFERENCES] === true ? 'animation' : null,
      );
    }

    for (const [key, child] of Object.entries(current)) {
      // Declarations are data until a dependency-bearing property consumes
      // them. Scanning unused defaults as controls/assets invents dependencies.
      if (parseVariableDeclarationKey(key) || key === 'variables') continue;
      const childShadow = isObject(shadow) && Object.prototype.hasOwnProperty.call(shadow, key) ? shadow[key] : undefined;
      if (childShadow !== undefined && !(isObject(childShadow) && isObject(child))) continue;
      const childPath = appendJsonPath(path, key, false);
      if ((key === 'grid_item_template' || key === 'collection_item_template') && typeof child === 'string') {
        collectUiSymbolReference(child, state, childPath, key, { environment, depth });
      }
      if (typeof child === 'string') {
        if (looksLikeUiJsonRef({ value: child })) {
          try {
            outUiJsonRefs.add(normalizePackPath(child));
          } catch {
            const reference = child.trim().slice(0, 160);
            pushDiagnostic(state, {
              code: 'EXPORT_UI_REFERENCE_INVALID',
              severity: 'warning',
              assetKind: 'ui-json',
              property: key,
              reference,
              sourcePath: state.sourcePath || null,
              jsonPath: childPath,
              reason: 'invalid-pack-path',
              message: `Export ignored unsafe UI JSON reference ${reference}${formatLocation(state.sourcePath, childPath)}; the dependency path must be pack-relative and traversal-free.`,
            });
          }
        }

        if (isLikelyTexturePropKey({ key })) {
          collectAssetReference({
            raw: child,
            assetKind: 'texture',
            property: key,
            jsonPath: childPath,
            environment,
            output: outTextureRefs,
            accept: () => true,
            state,
          });
        }

        if (key === 'font_type') {
          collectAssetReference({
            raw: child,
            assetKind: 'font',
            property: key,
            jsonPath: childPath,
            environment,
            output: outFontRefs,
            accept: () => true,
            state,
          });
        }

        if (['text', 'place_holder_text', 'placeholder_text'].includes(key) && localize) {
          collectAssetReference({
            raw: child,
            assetKind: 'localization',
            property: key,
            jsonPath: childPath,
            environment,
            output: outLangKeys,
            accept: looksLikeLangKey,
            state,
          });
        }
      }

      if (['controls', 'factory'].includes(key) && typeof child === 'string' && isExactVariable(child)) {
        const resolved = resolveVariableAlternatives(child, environment, state, { allowNonStringTerminals: true });
        for (const reason of resolved.issues) {
          state.unresolvedUiSymbolReasons.add(reason);
          pushDiagnostic(state, { code: 'EXPORT_UI_SYMBOL_DYNAMIC', severity: 'warning', assetKind: 'ui-symbol',
            property: key, reference: child, sourcePath: state.sourcePath, jsonPath: childPath, reason,
            message: `Export could not resolve ${key}${formatLocation(state.sourcePath, childPath)} (${reason}).` });
        }
        for (const value of resolved.values) {
          if (!isObject(value) && !Array.isArray(value)) {
            state.unresolvedUiSymbolReasons.add('control-object-invalid');
            pushDiagnostic(state, { code: 'EXPORT_UI_SYMBOL_DYNAMIC', severity: 'warning', assetKind: 'ui-symbol',
              property: key, reference: child, sourcePath: state.sourcePath, jsonPath: childPath,
              reason: 'control-object-invalid', message: `Export requires static ${key} objects${formatLocation(state.sourcePath, childPath)}.` });
          } else {
            // 既存の継承caller・条件候補・shadow解決を利用し、原文検査側で別のscopeを推測しない。
            if (key === 'controls' && typeof onResolvedControls === 'function') onResolvedControls(value,
              { sourcePath: state.sourcePath, jsonPath: childPath, recordId: state.currentRecordId });
            walk(value, environment, depth + 1, childPath, key, null, null, childShadow, scopeTransfers);
          }
        }
      } else walk(child, environment, depth + 1, childPath, key, null, null, childShadow, scopeTransfers);
      if (state.nodes > state.limits.maxNodes) break;
    }
    state.ancestors.delete(current);
    if (isObject(shadow)) for (const owner of state.maskOwners.get(shadow) || [shadow]) {
      const previous = scopeTransfers.get(owner);
      scopeTransfers.set(owner, previous && previous !== environment
        ? state.joinEnvironments(inherited, [previous, environment]) : environment);
      scopeTransfers.localizeByControl.set(owner, localize);
    }
    return environment;
  }

  // The preview composition profile replaces arrays and scalars and merges
  // objects. Retain a mask rather than scanning a base property which the
  // selected derived control has replaced; declarations still build its scope.
  function mergeShadow(current, later, depth = 0) {
    if (depth > state.limits.maxDepth) { pushLimitDiagnostic(state, 'composition mask depth', '$'); return current; }
    const result = Object.create(null);
    state.maskOwners.set(result, [current, ...(isObject(later) ? state.maskOwners.get(later) || [later] : [])]);
    for (const [key, value] of Object.entries(current)) {
      if (++state.nodes > state.limits.maxNodes) { pushLimitDiagnostic(state, 'JSON nodes', '$'); break; }
      result[key] = value;
    }
    if (isObject(later)) for (const [key, value] of Object.entries(later)) {
      result[key] = isObject(result[key]) && isObject(value) ? mergeShadow(result[key], value, depth + 1) : value;
    }
    return result;
  }

  state.joinEnvironments = (parent, alternatives) => {
    if (!alternatives.length) return parent;
    if (alternatives.length === 1) return alternatives[0];
    const joined = new LexicalEnvironment(parent);
    const names = new Set(alternatives.flatMap(environment => Array.from(environment, ([name]) => name)));
    for (const name of names) {
      if (++state.environmentEntries > state.limits.maxEnvironmentEntries) {
        pushLimitDiagnostic(state, 'lexical environment work', '$'); break;
      }
      const candidates = new Set();
      for (const environment of alternatives) {
        // A missing value on one feasible branch remains an unresolved value;
        // merging branch scopes must never hide that missing dependency.
        for (const value of environment.get(name) || [undefined]) {
          if (candidates.size >= state.limits.maxAlternatives) { pushLimitDiagnostic(state, 'variable alternatives', '$'); break; }
          candidates.add(value);
        }
      }
      joined.set(name, candidates);
    }
    for (const property of ['inheritanceExactOverridesByEnvironment', 'inheritanceConditionalOverridesByEnvironment', 'guaranteedBindingsByEnvironment']) {
      const first = state[property].get(alternatives[0]) || new Set();
      state[property].set(joined, new Set([...first].filter(name => alternatives.every(environment => state[property].get(environment)?.has(name)))));
    }
    return joined;
  };

  function maskShadow(current, shadow) {
    if (!isObject(shadow) || !isObject(current)) return current;
    const result = Object.create(null);
    for (const [key, value] of Object.entries(current)) {
      if (!Object.prototype.hasOwnProperty.call(shadow, key)) result[key] = value;
    }
    return result;
  }

  state.followUiSymbolReference = (qualifiedName, environment, depth, path, shadow = null, context = {}, scopeTransfers = null) => {
    // Context-free records are already scanned independently by export. Only
    // re-enter a referenced record when the caller introduced lexical values
    // that can change its inherited asset dependencies.
    if (!state.resolveUiSymbolCandidates) return;

    let candidates;
    try {
      candidates = state.resolveUiSymbolCandidates(qualifiedName, context);
    } catch {
      pushLimitDiagnostic(state, 'UI symbol resolver', path);
      return;
    }
    if (!Array.isArray(candidates)) {
      pushLimitDiagnostic(state, 'UI symbol resolver', path);
      return;
    }
    if (candidates.length > state.limits.maxAlternatives) {
      pushLimitDiagnostic(state, 'UI symbol candidates', path);
      return;
    }
    const target = candidates.find((candidate) => {
      const id = typeof candidate?.id === 'string' ? candidate.id : '';
      return id && id.length <= 1_024 && !state.compositionRecordStack.has(id);
    });
    if (!target || !isObject(target.value)) {
      if (!target && candidates.some(candidate => state.compositionRecordStack.has(candidate?.id))
        && context.referenceKind !== 'animation') {
        state.unresolvedUiSymbolReasons.add('composition-cycle');
        pushDiagnostic(state, { code: 'EXPORT_UI_SYMBOL_CYCLE', severity: 'warning', assetKind: 'ui-symbol',
          property: context.property, reference: qualifiedName, sourcePath: state.sourcePath,
          jsonPath: path, reason: 'composition-cycle',
          message: `Export found a recursive UI composition${formatLocation(state.sourcePath, path)}.` });
      }
      return;
    }

    state.compositionRecordVisits += 1;
    if (state.compositionRecordVisits > state.limits.maxCompositionRecordVisits) {
      pushLimitDiagnostic(state, 'UI composition record visits', path);
      return;
    }

    const priorNamespace = state.rootNamespace;
    const priorSourcePath = state.sourcePath;
    const priorRecordId = state.currentRecordId;
    const targetNamespace = typeof target.namespace === 'string'
      ? target.namespace.trim()
      : '';
    const callerExact = state.inheritanceExactOverridesByEnvironment.get(environment) || null;
    const callerConditionalExact = state.inheritanceConditionalOverridesByEnvironment.get(environment) || null;
    state.compositionRecordStack.add(target.id);
    state.rootNamespace = targetNamespace;
    if (typeof target.filePath === 'string') state.sourcePath = target.filePath;
    state.currentRecordId = target.id;
    try {
      return walk(
        target.value,
        environment,
        depth + 1,
        `${path}@${qualifiedName}`.slice(0, 320),
        typeof target.rawKey === 'string' ? target.rawKey : null,
        callerExact,
        callerConditionalExact,
        shadow,
        scopeTransfers,
      );
    } finally {
      state.rootNamespace = priorNamespace;
      state.sourcePath = priorSourcePath;
      state.currentRecordId = priorRecordId;
      state.compositionRecordStack.delete(target.id);
    }
  };

  walk(value, root, 0, '$', typeof rootAuthoredKey === 'string' ? rootAuthoredKey : null);
  return {
    outUiJsonRefs,
    outTextureRefs,
    outFontRefs,
    outLangKeys,
    outUiSymbolRefs,
    outNativeRenderers,
    outNativeItemIds,
    diagnostics: outDiagnostics,
    complete: state.limitReasons.size === 0,
    limitReasons: Array.from(state.limitReasons).sort(),
    dependencyClosureComplete: state.limitReasons.size === 0
      && state.unresolvedUiSymbolReasons.size === 0,
    unresolvedUiSymbolReasons: Array.from(state.unresolvedUiSymbolReasons).sort(),
    stats: {
      nodes: state.nodes,
      environmentEntries: state.environmentEntries,
      compositionRecordVisits: state.compositionRecordVisits,
    },
  };
}
