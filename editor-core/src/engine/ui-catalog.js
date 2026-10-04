/*
  UI catalog for Minecraft Bedrock JSON UI documents.

  This module is deliberately DOM/ZIP independent. Callers provide bounded
  file lists, a text reader, and a JSONC parser. It records provenance and
  uncertainty instead of treating undocumented engine behavior as official.
*/

import { parseFixedControlSpec } from './control-reference.js';
import { createReferenceEnvironmentCache } from './reference-environment.js';
import { createReferenceResultCache, ObservedReferenceEnvironment } from './reference-result-cache.js';

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 5000,
  maxDefinitions: 100000,
  maxTextBytesPerFile: 8 * 1024 * 1024,
  maxTotalTextBytes: 64 * 1024 * 1024,
  maxScanDepth: 96,
  maxReferencesPerDefinition: 100_000,
  maxReferenceVariablesPerScope: 4_096,
  maxReferenceAlternatives: 64,
  maxReferenceConditionalBranches: 256,
  maxReferenceVariableDepth: 32,
  maxReferenceVariableSteps: 16_384,
  maxReferenceEnvironmentWork: 1_000_000,
  maxReferenceRecordVisits: 2_048,
  maxReferenceNodesPerDefinition: 100_000,
  maxReferenceNodesTotal: 500_000,
  maxTypeLookupOperations: 1_000_000,
});

const EXACT_REFERENCE_VARIABLE_RE = /^\$[A-Za-z0-9_:@.\-]{1,128}$/u;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function utf8ByteLength(value) {
  const text = String(value || '');
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
  return text.length * 2;
}

export function parseDefinitionKey(value) {
  const raw = String(value || '');
  const at = raw.indexOf('@');
  if (at < 0) return { raw, localName: raw, baseRef: null };
  return {
    raw,
    localName: raw.slice(0, at) || raw,
    baseRef: raw.slice(at + 1) || null,
  };
}

export function selectUiDefinition(definitions, requested = '') {
  const name = String(requested || '').trim();
  if (name) {
    // Legacy selectors share one namespace. Never let comparison order hide
    // an alias that points at a different definition.
    const matches = [...new Set(definitions.filter(item =>
      ['id', 'rawKey', 'localName', 'qualifiedName'].some(key => item[key] === name)))];
    if (matches.length > 1) throw new Error('UI_DEFINITION_AMBIGUOUS');
    if (matches.length === 1) return matches[0];
    throw new Error('UI_DEFINITION_NOT_FOUND');
  }
  return definitions.find(item => item.profile !== 'pocket' && item.classification === 'SCREEN')
    || definitions.find(item => item.profile !== 'pocket' && item.classification !== 'ANIMATION_OR_DATA')
    || definitions.find(item => item.profile !== 'pocket') || definitions[0] || null;
}

export function isPocketUiPath(filePath, namespace = '') {
  const path = String(filePath || '').toLowerCase();
  const ns = String(namespace || '').toLowerCase();
  return /(^|[\/_-])pocket([\/_.-]|$)/.test(path) || /(^|[_.-])pocket([_.-]|$)/.test(ns);
}

function isUiDocumentPath(filePath) {
  const path = String(filePath || '');
  const lower = path.toLowerCase();
  if (!(lower.endsWith('.json') || lower.endsWith('.jsonc'))) return false;
  const segments = lower.split('/');
  if (!segments.includes('ui')) return false;
  const base = segments[segments.length - 1] || '';
  return !base.startsWith('_');
}

function isGlobalVariablesPath(filePath) {
  return /(^|\/)ui\/_global_variables\.jsonc?$/i.test(String(filePath || ''));
}

function isUiDefsPath(filePath) {
  return /(^|\/)ui\/_ui_defs\.jsonc?$/i.test(String(filePath || ''));
}

function normalizePackPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

function parseReferenceVariableDeclaration(rawKey) {
  const raw = String(rawKey || '');
  if (!raw.startsWith('$') || raw === '$schema') return null;
  const [name, modifier = ''] = raw.split('|');
  if (!EXACT_REFERENCE_VARIABLE_RE.test(name)) return null;
  return { name, isDefault: modifier.toLowerCase() === 'default' };
}

function getReferenceDeclarations(value, state) {
  const cached = state.declarationCache.get(value);
  if (cached) return cached;
  const defaults = new Map();
  const exact = new Map();
  let declarationWork = 0;
  for (const [key, child] of Object.entries(value)) {
    const declaration = parseReferenceVariableDeclaration(key);
    if (!declaration) continue;
    declarationWork += 1;
    const target = declaration.isDefault ? defaults : exact;
    if (!target.has(declaration.name)) target.set(declaration.name, []);
    target.get(declaration.name).push(child);
  }

  const conditionalDeclarations = [];
  let conditionalTruncated = false;
  if (Array.isArray(value.variables)) {
    const branches = value.variables.slice(0, state.limits.maxReferenceConditionalBranches);
    if (value.variables.length > branches.length) {
      conditionalTruncated = true;
    }
    for (const branch of branches) {
      if (!isPlainObject(branch)) continue;
      const branchDefaults = new Map();
      const branchExact = new Map();
      for (const [key, child] of Object.entries(branch)) {
        const declaration = parseReferenceVariableDeclaration(key);
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

  const declarations = { defaults, exact, conditionalDeclarations, declarationWork, conditionalTruncated };
  state.declarationCache.set(value, declarations);
  return declarations;
}

// Incomplete coverage is sticky for a whole definition, but it must only
// invalidate cache frames active at the failure. Later independent subtrees
// can still produce reusable results under their exactly observed environment.
function invalidateReferenceFrames(state) {
  state.complete = false;
  for (const frame of state.cacheFrames || []) frame.cacheable = false;
}

function buildReferenceEnvironment(inherited, value, state) {
  if (!isPlainObject(value)) return inherited;
  const { defaults, exact, conditionalDeclarations, declarationWork, conditionalTruncated } = getReferenceDeclarations(value, state);
  if (conditionalTruncated) {
    invalidateReferenceFrames(state);
    state.limitReasons.add('conditional-branches');
  }

  if (defaults.size === 0 && exact.size === 0 && conditionalDeclarations.length === 0) {
    return inherited;
  }
  const environmentWork = inherited.size + declarationWork;
  state.environmentWork += environmentWork;
  if (state.environmentWork > state.limits.maxReferenceEnvironmentWork) {
    invalidateReferenceFrames(state);
    state.limitReasons.add('environment-work');
    return inherited;
  }
  // Only changed bindings need storage. Copying every inherited variable at
  // every nested control made large catalogs spend most time cloning Maps.
  const changes = new Map();
  const environment = {
    size: inherited.size,
    has: name => changes.has(name) || inherited.has(name),
    get: name => changes.has(name) ? changes.get(name) : inherited.get(name),
    set(name, candidates) {
      if (!this.has(name)) this.size += 1;
      changes.set(name, candidates);
    },
  };

  function apply(name, candidates, replace) {
    if (!environment.has(name) && environment.size >= state.limits.maxReferenceVariablesPerScope) {
      invalidateReferenceFrames(state);
      state.limitReasons.add('variables-per-scope');
      return;
    }
    // Exact replacement needs the inherited value only for self-forwarding.
    // Avoid reading unrelated previous values into a cache dependency.
    const needsPrior = !replace || candidates.some(candidate => typeof candidate === 'string' && candidate.trim() === name);
    const prior = needsPrior ? environment.get(name) : undefined;
    const next = replace ? new Set() : new Set(prior || []);
    for (const candidate of candidates) {
      if (next.size >= state.limits.maxReferenceAlternatives) {
        invalidateReferenceFrames(state);
        state.limitReasons.add('variable-alternatives');
        break;
      }
      if (typeof candidate === 'string' && candidate.trim() === name && prior?.size) {
        for (const inheritedCandidate of prior) next.add(inheritedCandidate);
      } else {
        next.add(candidate);
      }
    }
    environment.set(name, next);
  }

  for (const [name, candidates] of defaults) {
    if (!inherited.has(name)) apply(name, candidates, false);
  }
  for (const [name, candidates] of exact) apply(name, candidates, true);

  for (const branch of conditionalDeclarations) {
    for (const [name, candidates] of branch.defaults) {
      if (!environment.has(name)) apply(name, candidates, false);
    }
    for (const [name, candidates] of branch.exact) apply(name, candidates, false);
  }
  const frame = state.cacheFrames?.at(-1);
  if (frame) frame.maxScopeDelta = Math.max(frame.maxScopeDelta, environment.size - frame.scopeSize);
  return state.environmentCache.intern(inherited, changes, state.rootEnvironment);
}

function resolveReferenceVariable(variable, environment, state, allowNonStringTerminals = false) {
  const values = new Set();
  const stack = [];

  function visit(name, depth) {
    state.variableSteps += 1;
    if (state.variableSteps > state.limits.maxReferenceVariableSteps) {
      invalidateReferenceFrames(state);
      state.limitReasons.add('variable-steps');
      return;
    }
    if (depth > state.limits.maxReferenceVariableDepth) {
      invalidateReferenceFrames(state);
      state.limitReasons.add('variable-depth');
      return;
    }
    if (stack.includes(name)) return;
    const candidates = environment.get(name);
    if (!candidates) return;
    stack.push(name);
    for (const candidate of candidates) {
      if (values.size >= state.limits.maxReferenceAlternatives) {
        invalidateReferenceFrames(state);
        state.limitReasons.add('variable-alternatives');
        break;
      }
      if (typeof candidate === 'string' && EXACT_REFERENCE_VARIABLE_RE.test(candidate.trim())) {
        visit(candidate.trim(), depth + 1);
      } else if (typeof candidate === 'string' || allowNonStringTerminals) {
        values.add(candidate);
      }
    }
    stack.pop();
  }

  visit(variable, 0);
  return values;
}

function recordReference(qualifiedName, output, state) {
  if (!output.has(qualifiedName) && output.size >= state.limits.maxReferencesPerDefinition) {
    invalidateReferenceFrames(state);
    state.limitReasons.add('references');
    return false;
  }
  output.add(qualifiedName);
  state.cacheFrames?.at(-1)?.references.add(qualifiedName);
  return true;
}

function observeReferenceDepth(state, depth) {
  state.maxObservedDepth = Math.max(state.maxObservedDepth || 0, depth);
  const frame = state.cacheFrames?.at(-1);
  if (frame) frame.maxDepth = Math.max(frame.maxDepth, depth);
}

// Keep actionable depth evidence bounded even for wide hostile definitions.
// The effective walk depth remains cumulative across reference edges.
function recordReferenceDepthLimit(state, depth, cause, authoredKey = null, reason = 'depth') {
  observeReferenceDepth(state, depth);
  invalidateReferenceFrames(state);
  state.limitReasons.add(reason);
  state.depthStops[cause] = (state.depthStops[cause] || 0) + 1;
  if (state.depthSamples.length >= 8) return;
  state.depthSamples.push({ cause, depth, authoredKey: typeof authoredKey === 'string'
    ? authoredKey.slice(0, 256) : null,
  definitionTrail: Array.from(state.recordStack || []).slice(-8).map(id => id.slice(0, 512)) });
}

function mergeReferenceFrame(parent, child, scopeSize, maxDepth) {
  if (!parent) return;
  for (const id of child.visited) parent.visited.add(id);
  for (const id of child.requiredAncestors) if (parent.initialAncestors.has(id)) parent.requiredAncestors.add(id);
  parent.maxDepth = Math.max(parent.maxDepth, maxDepth);
  parent.maxScopeDelta = Math.max(parent.maxScopeDelta, scopeSize - parent.scopeSize + child.maxScopeDelta);
}

function addReference(raw, namespace, environment, output, state, depth = 0, followContext = false) {
  const parsed = parseFixedControlSpec(raw, namespace);
  if (parsed.ok) {
    if (!recordReference(parsed.qualifiedName, output, state)) return;
    if (followContext && typeof state.followInheritanceReference === 'function') {
      state.followInheritanceReference(parsed.qualifiedName, environment, depth + 1);
    }
    return;
  }
  if (parsed.reason !== 'variable' || !parsed.variable) return;
  for (const candidate of resolveReferenceVariable(parsed.variable, environment, state)) {
    addReference(candidate, namespace, environment, output, state, depth, followContext);
  }
}

function addControlIdReferences(raw, namespace, environment, output, state, depth = 0) {
  let candidates = new Set([raw]);
  if (typeof raw === 'string' && EXACT_REFERENCE_VARIABLE_RE.test(raw.trim())) {
    candidates = resolveReferenceVariable(raw.trim(), environment, state, true);
  }
  for (const candidate of candidates) {
    if (!isPlainObject(candidate)) continue;
    for (const controlSpec of Object.values(candidate)) {
      state.controlIdEntries += 1;
      if (state.controlIdEntries > state.limits.maxReferencesPerDefinition) {
        invalidateReferenceFrames(state);
        state.limitReasons.add('control-id-entries');
        return;
      }
      addReference(controlSpec, namespace, environment, output, state, depth, true);
    }
  }
}

function referenceChildRole(role, key, value) {
  if (role === 'control-entry' || role === 'modification-value') return 'element';
  if (role === 'element' && key === 'controls') return 'controls';
  if (role === 'element' && key === 'factory') return 'factory';
  if (role === 'element' && key === 'modifications') return 'modifications';
  if (role === 'modification' && key === 'value' && value.array_name === 'controls') return 'modification-value';
  return 'other';
}

function referenceArrayRole(role) {
  if (role === 'controls' || role === 'modification-value') return 'control-entry';
  return role === 'modifications' ? 'modification' : 'other';
}

function factoryDeclarationKind(value, authoredKey, role, record = null) {
  if (role === 'factory' || role === 'element' && authoredKey === 'factory') return 'factory';
  if (role !== 'element') return 'other';
  if (Object.hasOwn(value, 'type')) {
    if (typeof value.type !== 'string') return 'unknown';
    const type = value.type.trim().toLowerCase();
    if (!type || type.startsWith('$') || type.startsWith('(')) return 'unknown';
    return type === 'factory' ? 'factory' : 'other';
  }
  if (parseDefinitionKey(authoredKey).baseRef
    || record && Array.isArray(value.modifications) && value.modifications.length) return 'inherited';
  return 'other';
}

// This lookup intentionally accepts fixed literal type chains only. Repeating
// the resolver's protected caller/base variable precedence here would silently
// invent a type for some dynamic definitions, so unresolved types stay visible.
function fixedFactoryType(value, namespace, authoredKey, role, record, state, depth) {
  let kind = factoryDeclarationKind(value, authoredKey, role, record);
  const unknown = reason => {
    invalidateReferenceFrames(state);
    state.limitReasons.add(reason);
    return 'unknown';
  };
  if (kind === 'unknown') return unknown('factory-type-unresolved');
  if (kind !== 'inherited') return kind;
  // Candidate choice depends on the active overlay ancestry. Do not replay a
  // surrounding result cache frame that did not observe this type lookup.
  for (const frame of state.cacheFrames || []) frame.cacheable = false;
  const visited = new Set(state.recordStack);
  while (kind === 'inherited') {
    if (++depth > state.limits.maxScanDepth) {
      recordReferenceDepthLimit(state, depth, 'factory-type', authoredKey, 'factory-type-depth');
      return 'unknown';
    }
    if (++state.recordVisits > state.limits.maxReferenceRecordVisits) return unknown('factory-type-visits');
    const rawBase = parseDefinitionKey(authoredKey).baseRef || record?.qualifiedName;
    const parsed = parseFixedControlSpec(rawBase, namespace);
    if (!parsed.ok) return unknown('factory-type-unresolved');
    const lowerOnly = record?.qualifiedName === parsed.qualifiedName;
    const eligible = (state.referenceRecordGroups.get(parsed.qualifiedName) || []).filter(candidate =>
      !visited.has(candidate.id) && (!lowerOnly || candidate.precedence < record.precedence));
    if (!eligible.length) return unknown('factory-type-unresolved');
    const target = eligible[0];
    if (eligible.length > 1 && eligible[1].precedence === target.precedence) return unknown('factory-type-ambiguous');
    visited.add(target.id);
    value = target.value;
    namespace = target.namespace;
    authoredKey = target.rawKey;
    record = target;
    kind = factoryDeclarationKind(value, authoredKey, 'element', record);
  }
  return kind === 'unknown' ? unknown('factory-type-unresolved') : kind;
}

function collectReferences(value, namespace, output, depth, state, inherited = new Map(), authoredKey = null,
  role = 'other', authoredRecord = null) {
  if (state.nodeBudgetExceeded) return;
  // References on scalar properties are inspected at their parent. Count
  // only objects/arrays that can introduce a new lexical or control scope.
  // Exclude these before the depth check: a parent at the boundary already
  // collected its string template, and inspecting that string adds no work.
  if (value === null || typeof value !== 'object') return;
  // A cached syntax-only negative is independent of lexical values. Scalar
  // fields such as size/texture/color cannot introduce an @ dependency, and
  // declarations needed by siblings are already read at their parent scope.
  if (state.referenceSubtrees && value && typeof value === 'object'
    && state.referenceSubtrees.get(value) === false) return;
  observeReferenceDepth(state, depth);
  if (depth > state.limits.maxScanDepth) {
    recordReferenceDepthLimit(state, depth, 'syntax-child', authoredKey);
    return;
  }
  state.nodes += 1;
  if (state.globalReferenceBudget) {
    if (state.globalReferenceBudget.nodes >= state.limits.maxReferenceNodesTotal) {
      invalidateReferenceFrames(state);
      state.nodeBudgetExceeded = true;
      state.limitReasons.add('global-nodes');
      return;
    }
    state.globalReferenceBudget.nodes += 1;
  }
  if (state.nodes > state.limits.maxReferenceNodesPerDefinition) {
    invalidateReferenceFrames(state);
    state.nodeBudgetExceeded = true;
    state.limitReasons.add('nodes');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferences(item, namespace, output, depth + 1, state, inherited, null, referenceArrayRole(role));
      if (state.nodeBudgetExceeded) break;
    }
    return;
  }
  if (!isPlainObject(value)) return;

  const environment = buildReferenceEnvironment(inherited, value, state);
  if (typeof authoredKey === 'string' && authoredKey.includes('@')) {
    addReference(authoredKey, namespace, environment, output, state, depth, true);
  }

  // A structural factory's fixed control template is a real UI dependency
  // even when its representative collection is empty. Recording it here
  // keeps the template classified as a component and lets the resolver report
  // a missing reference without fabricating an instance. Dynamic names remain
  // runtime-owned and are deliberately excluded.
  if (Object.hasOwn(value, 'control_name')
    && fixedFactoryType(value, namespace, authoredKey, role, authoredRecord, state, depth) === 'factory') {
    addReference(value.control_name, namespace, environment, output, state, depth, true);
  }

  for (const [key, child] of Object.entries(value)) {
    if ((key === 'grid_item_template' || key === 'collection_item_template') && typeof child === 'string') {
      addReference(child, namespace, environment, output, state, depth, true);
    }
    if (key === 'control_ids') {
      addControlIdReferences(child, namespace, environment, output, state, depth);
    }

    collectReferences(child, namespace, output, depth + 1, state, environment, key, referenceChildRole(role, key, value));
    if (state.nodeBudgetExceeded) break;
  }
}

/** Build a bounded dependency-shape index without cloning variable scopes.
 * A context-independent template needs only graph-edge traversal during a
 * caller's scan; visiting every label/property again cannot reveal new edges.
 * If the preflight budget is exceeded, omit this optimization altogether.
 */
function buildReferenceShapeIndex(records, groups, limits) {
  const shapes = new Map();
  const subtrees = new WeakMap();
  const reverse = new Map();
  let visited = 0;
  for (const record of records) {
    const shape = { dynamic: false, references: new Set() };
    let recordNodes = 0;
    const stack = [{ value: record.value, key: record.rawKey, depth: 0, active: false, parent: null, role: 'element' }];
    const inspect = (spec) => {
      const parsed = parseFixedControlSpec(spec, record.namespace);
      if (parsed.ok) shape.references.add(parsed.qualifiedName);
      else if (typeof spec === 'string' && spec.trim()) shape.dynamic = true;
    };
    while (stack.length) {
      const frame = stack.pop();
      const { value, key, depth, role } = frame;
      if (frame.exit) {
        subtrees.set(value, frame.active);
        if (frame.active && frame.parent) frame.parent.active = true;
        continue;
      }
      if (++visited > limits.maxReferenceNodesTotal
        || ++recordNodes > limits.maxReferenceNodesPerDefinition) return null;
      if (!value || typeof value !== 'object') continue;
      if (depth > limits.maxScanDepth) {
        shape.dynamic = true;
        subtrees.set(value, true);
        if (frame.parent) frame.parent.active = true;
        continue;
      }
      frame.exit = true;
      stack.push(frame);
      if (Array.isArray(value)) {
        for (const child of value) {
          if (visited + stack.length >= limits.maxReferenceNodesTotal
            || recordNodes + stack.length >= limits.maxReferenceNodesPerDefinition) return null;
          stack.push({ value: child, key: null, depth: depth + 1, active: false, parent: frame, role: referenceArrayRole(role) });
        }
        continue;
      }
      if (typeof key === 'string' && key.includes('@')) { inspect(key); frame.active = true; }
      if (Object.hasOwn(value, 'control_name')) {
        const kind = factoryDeclarationKind(value, key, role, depth === 0 ? record : null);
        if (kind === 'factory') { inspect(value.control_name); frame.active = true; }
        else if (kind === 'inherited' || kind === 'unknown') {
          // Type-dependent control names need the full bounded scan; a syntax
          // negative here would bypass the new inherited-type lookup entirely.
          shape.dynamic = true; frame.active = true;
        }
      }
      for (const [childKey, child] of Object.entries(value)) {
        if (childKey === 'grid_item_template' || childKey === 'collection_item_template') {
          inspect(child); frame.active = true;
        }
        if (childKey === 'control_ids') {
          frame.active = true;
          if (isPlainObject(child)) for (const spec of Object.values(child)) inspect(spec);
          else shape.dynamic = true;
        }
        if (childKey === 'controls' && typeof child === 'string') { shape.dynamic = true; frame.active = true; }
        if (visited + stack.length >= limits.maxReferenceNodesTotal
          || recordNodes + stack.length >= limits.maxReferenceNodesPerDefinition) return null;
        stack.push({ value: child, key: childKey, depth: depth + 1, active: false, parent: frame,
          role: referenceChildRole(role, childKey, value) });
      }
    }
    shapes.set(record.id, shape);
    for (const reference of shape.references) {
      // Any physical candidate may be selected by a lower-layer self overlay.
      for (const target of groups.get(reference) || []) {
        if (!reverse.has(target.id)) reverse.set(target.id, new Set());
        reverse.get(target.id).add(record.id);
      }
    }
  }
  const queue = [...shapes.entries()].filter(([, shape]) => shape.dynamic).map(([id]) => id);
  for (let index = 0; index < queue.length; index += 1) {
    for (const callerId of reverse.get(queue[index]) || []) {
      const caller = shapes.get(callerId);
      if (!caller.dynamic) { caller.dynamic = true; queue.push(callerId); }
    }
  }
  return { shapes, subtrees };
}

// Resolve only literal type inheritance. Dynamic variables and ambiguous
// candidates require the full resolver and must not be presented as proven
// screen types in the selection list. Iteration bounds both cycles and depth.
function resolveDefinitionType(record, groups, maximumDepth, budget) {
  const seen = new Set();
  let current = record;
  let inheritedDepth = 0;
  const result = (status, type = null) => ({ status, type, inheritedDepth });
  const limit = Number.isFinite(maximumDepth) ? Math.max(0, Math.min(192, Math.floor(maximumDepth))) : 96;
  while (current) {
    if (seen.has(current.id)) return result('cycle');
    if (inheritedDepth > limit) return result('depth-limit');
    if (current.profile === 'pocket' && current.id !== record.id) return result('pocket-base');
    seen.add(current.id);
    const value = current.value;
    if (!isPlainObject(value)) return result('unspecified');
    if (Object.hasOwn(value, 'type')) {
      if (typeof value.type !== 'string') return result('invalid-type');
      const type = value.type.trim().toLowerCase();
      if (!type || type.startsWith('$') || type.startsWith('(')) return result('dynamic');
      return result('fixed', type);
    }
    // Vanilla animations declare anim_type without type: "animation".
    // They are data definitions even when referenced by other definitions.
    if (Object.hasOwn(value, 'anim_type')) return result('fixed', 'animation');
    const implicitBase = !current.baseRef && Array.isArray(value.modifications) && value.modifications.length > 0;
    if (!current.baseRef && !implicitBase) return result('unspecified');
    const parsed = parseFixedControlSpec(current.baseRef || current.qualifiedName, current.namespace);
    if (!parsed.ok) return result(parsed.reason === 'variable' || parsed.reason === 'expression' ? 'dynamic' : 'invalid-base');
    const lowerOnly = implicitBase || parsed.qualifiedName === current.qualifiedName;
    const candidates = [];
    // Symbol groups are already sorted by precedence. Only the first two
    // eligible entries matter; cap cumulative work when many overlays share
    // the same symbol so classification cannot become quadratic without limit.
    for (const candidate of groups.get(parsed.qualifiedName) || []) {
      if (budget.used >= budget.maximum) return result('work-limit');
      budget.used += 1;
      if (lowerOnly && candidate.precedence >= current.precedence) continue;
      candidates.push(candidate);
      if (candidates.length === 2) break;
    }
    if (!candidates.length) return result('missing-base');
    if (candidates.length > 1 && candidates[0].precedence === candidates[1].precedence) return result('ambiguous-base');
    current = candidates[0];
    inheritedDepth += 1;
  }
  return result('unspecified');
}

function classifyDefinition(record, referencedQualifiedNames) {
  if (record.profile === 'pocket') return { classification: 'POCKET_ONLY', classificationBasis: 'profile-policy' };
  const type = record.typeResolution.type;
  const local = String(record.localName || '').toLowerCase();
  const base = String(record.baseRef || '').toLowerCase();
  const typeBasis = record.typeResolution.inheritedDepth ? 'inherited-type' : 'declared-type';
  if (type === 'screen') return { classification: 'SCREEN', classificationBasis: typeBasis };
  if (type === 'animation') return { classification: 'ANIMATION_OR_DATA', classificationBasis: typeBasis };
  // Explicit panel/label/etc. overrides beat suggestive names and base names.
  if (!type && !Object.hasOwn(record.value, 'type')
    && (local.endsWith('_screen') || local === 'screen' || base.endsWith('.base_screen'))) {
    return { classification: 'SCREEN', classificationBasis: 'name-heuristic' };
  }
  if (referencedQualifiedNames.has(record.qualifiedName)) return { classification: 'COMPONENT', classificationBasis: 'reference' };
  if (!type && !Object.hasOwn(record.value, 'type') && local.includes('animation')) {
    return { classification: 'ANIMATION_OR_DATA', classificationBasis: 'name-heuristic' };
  }
  return { classification: 'UNREFERENCED_ROOT', classificationBasis: 'unreferenced' };
}

function normalizeSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => source && typeof source.readText === 'function')
    .map((source, index) => ({
      id: String(source.id || `source-${index + 1}`),
      kind: String(source.kind || 'imported'),
      precedence: Number.isFinite(source.precedence) ? Number(source.precedence) : index,
      filePaths: Array.isArray(source.filePaths) ? source.filePaths.map((path) => String(path || '')) : [],
      readText: source.readText,
    }))
    // Global variables and duplicate symbols must not depend on the caller's
    // array order.  Read lower-priority packs first, then overlay higher
    // priority packs deterministically.
    .sort((a, b) => a.precedence - b.precedence || a.id.localeCompare(b.id));
}

export async function buildUiCatalog(options) {
  if (!options || typeof options.parseJsonc !== 'function') {
    throw new Error('UI_CATALOG_PARSER_REQUIRED');
  }

  // Resolution-only consumers need authored records/symbols, not the global
  // dependency graph. This mode must never imply complete export/reference QA.
  const skipReferenceDiscovery = options.referenceDiscovery === 'skip';
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const sources = normalizeSources(options.sources);
  const signal = options.signal || null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  // Reading files already yields. Reference discovery and classification can
  // dominate large catalogs afterwards, so those phases also report progress
  // and give AbortSignal/timer callbacks a bounded opportunity to run.
  async function reportAnalysisProgress(phase, processed, total, force = false) {
    if (signal?.aborted) throw new Error('UI_CATALOG_ABORTED');
    if (!force && processed % 32 !== 0 && processed !== total) return;
    onProgress({ phase, processed, total });
    if (signal?.aborted) throw new Error('UI_CATALOG_ABORTED');
    await new Promise(resolve => setTimeout(resolve, 0));
    if (signal?.aborted) throw new Error('UI_CATALOG_ABORTED');
  }
  const diagnostics = [];
  const files = [];
  const records = [];
  const globalVariables = Object.create(null);
  let totalTextBytes = 0;
  let processedFiles = 0;

  // `_ui_defs.json` is the engine's UI catalog allowlist. Honour it when it
  // parses successfully so stray backups or drafts under `ui/` cannot shadow
  // registered definitions. Packs without a registry retain the existing
  // bounded discovery fallback and receive no false completeness claim.
  const registeredPathsBySource = new Map();
  for (const source of sources) {
    if (signal && signal.aborted) throw new Error('UI_CATALOG_ABORTED');
    const registryPath = source.filePaths.find((filePath) => isUiDefsPath(filePath));
    if (!registryPath) continue;
    try {
      const text = await source.readText(registryPath, { maxBytes: limits.maxTextBytesPerFile, signal });
      const bytes = utf8ByteLength(text);
      totalTextBytes += bytes;
      if (bytes > limits.maxTextBytesPerFile || totalTextBytes > limits.maxTotalTextBytes) {
        throw new Error('UI_CATALOG_TEXT_BUDGET_EXCEEDED');
      }
      const parsed = options.parseJsonc(text, { filePath: registryPath, fileName: registryPath });
      if (!parsed?.ok || !isPlainObject(parsed.value) || !Array.isArray(parsed.value.ui_defs)) {
        throw new Error('UI_DEFS_PARSE_FAILED');
      }
      if (parsed.value.ui_defs.length > limits.maxFiles) {
        throw new Error('UI_CATALOG_FILE_LIMIT');
      }
      if (parsed.value.ui_defs.some((entry) => typeof entry !== 'string' || entry.length > 1_024)) {
        throw new Error('UI_DEFS_PARSE_FAILED');
      }
      const registryDir = normalizePackPath(registryPath).split('/').slice(0, -1).join('/');
      const registered = new Set(parsed.value.ui_defs
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => {
          const normalized = normalizePackPath(entry);
          return normalized.includes('/') || !registryDir ? normalized : `${registryDir}/${normalized}`;
        }));
      registeredPathsBySource.set(source.id, registered);
      const available = new Set(source.filePaths.map(normalizePackPath));
      const missing = Array.from(registered).filter((path) => !available.has(path));
      if (missing.length) {
        diagnostics.push({
          code: 'UI_DEFS_ENTRY_MISSING',
          severity: 'warning',
          certainty: 'observed',
          sourceId: source.id,
          count: missing.length,
          sample: missing.slice(0, 20),
        });
      }
    } catch (error) {
      if (error?.code === 'NODE_JOB_CANCELLED') throw error;
      if (signal && signal.aborted) throw new Error('UI_CATALOG_ABORTED');
      throw new Error(`UI_DEFS_INVALID: ${source.id}:${registryPath}: ${String(error.message || error)}`);
    }
    // A consumer's cancellation exception must remain a cancellation rather
    // than being misreported as a malformed pack registry.
    onProgress({ phase: 'registry', processed: 0, total: 0, filePath: registryPath });
  }

  const candidates = [];
  const effectiveRegisteredPaths = new Set();
  for (const registered of registeredPathsBySource.values()) {
    for (const path of registered) effectiveRegisteredPaths.add(path);
  }
  for (const source of sources) {
    const hasParsedRegistry = registeredPathsBySource.has(source.id);
    let ignoredUnregistered = 0;
    for (const filePath of source.filePaths) {
      const uiDocument = isUiDocumentPath(filePath);
      // Minecraft composes the logical UI registry across the pack stack. If
      // any active registry loads a path, retain that physical file from every
      // layer so a sparse overlay can replace Vanilla without re-listing the
      // already registered path in its own `_ui_defs.json`.
      const registeredInStack = effectiveRegisteredPaths.has(normalizePackPath(filePath));
      if (isGlobalVariablesPath(filePath)
        || (registeredInStack && !isUiDefsPath(filePath))
        || (uiDocument && !hasParsedRegistry)) {
        candidates.push({ source, filePath });
      } else if (uiDocument && hasParsedRegistry) {
        ignoredUnregistered += 1;
      }
    }
    if (ignoredUnregistered > 0) {
      diagnostics.push({
        code: 'UI_UNREGISTERED_FILES_SKIPPED',
        severity: 'info',
        certainty: 'observed',
        sourceId: source.id,
        count: ignoredUnregistered,
      });
    }
  }

  if (candidates.length > limits.maxFiles) {
    diagnostics.push({
      code: 'UI_CATALOG_FILE_LIMIT',
      severity: 'error',
      certainty: 'policy',
      data: { found: candidates.length, limit: limits.maxFiles },
    });
  }

  const boundedCandidates = candidates.slice(0, Math.max(0, limits.maxFiles));
  for (const candidate of boundedCandidates) {
    if (signal && signal.aborted) throw new Error('UI_CATALOG_ABORTED');
    const { source, filePath } = candidate;
    let text;
    try {
      text = await source.readText(filePath, { maxBytes: limits.maxTextBytesPerFile, signal });
    } catch (error) {
      if (error?.code === 'NODE_JOB_CANCELLED') throw error;
      diagnostics.push({
        code: 'UI_CATALOG_READ_FAILED',
        severity: 'warning',
        certainty: 'observed',
        sourceId: source.id,
        filePath,
        message: String(error && error.message ? error.message : error),
      });
      processedFiles += 1;
      onProgress({ phase: 'read', processed: processedFiles, total: boundedCandidates.length, filePath });
      continue;
    }
    if (signal && signal.aborted) throw new Error('UI_CATALOG_ABORTED');

    const textBytes = utf8ByteLength(text);
    totalTextBytes += textBytes;
    if (textBytes > limits.maxTextBytesPerFile || totalTextBytes > limits.maxTotalTextBytes) {
      diagnostics.push({
        code: 'UI_CATALOG_TEXT_BUDGET_EXCEEDED',
        severity: 'error',
        certainty: 'policy',
        sourceId: source.id,
        filePath,
        data: { textBytes, totalTextBytes, limits },
      });
      break;
    }

    const parsed = options.parseJsonc(text, { filePath, fileName: filePath });
    if (!parsed || !parsed.ok || !isPlainObject(parsed.value)) {
      diagnostics.push({
        code: 'UI_CATALOG_PARSE_FAILED',
        severity: 'warning',
        certainty: 'observed',
        sourceId: source.id,
        filePath,
        message: parsed && Array.isArray(parsed.errors) && parsed.errors[0]
          ? String(parsed.errors[0].message || 'JSONC_PARSE_FAILED')
          : 'JSONC_PARSE_FAILED',
        parseErrors: (Array.isArray(parsed?.errors) ? parsed.errors : []).slice(0, 16).map((error) => ({
          code: String(error?.code || 'JSONC_PARSE_FAILED').slice(0, 128),
          ...Object.fromEntries(['offset', 'length', 'line', 'column']
            .filter((key) => Number.isSafeInteger(error?.[key]) && error[key] >= 0)
            .map((key) => [key, error[key]])),
        })),
        omittedParseErrors: Math.max(0, (Array.isArray(parsed?.errors) ? parsed.errors.length : 0) - 16),
      });
      processedFiles += 1;
      onProgress({ phase: 'parse', processed: processedFiles, total: boundedCandidates.length, filePath });
      continue;
    }

    const document = parsed.value;
    if (isGlobalVariablesPath(filePath)) {
      const variableRoot = isPlainObject(document.variables) ? document.variables : document;
      for (const [key, value] of Object.entries(variableRoot)) {
        const normalizedKey = key.startsWith('$') ? key : (isPlainObject(document.variables) ? `$${key}` : key);
        if (normalizedKey.startsWith('$') && normalizedKey !== '$schema') globalVariables[normalizedKey] = value;
      }
      processedFiles += 1;
      onProgress({ phase: 'globals', processed: processedFiles, total: boundedCandidates.length, filePath });
      continue;
    }

    const namespace = typeof document.namespace === 'string' ? document.namespace.trim() : '';
    const profile = isPocketUiPath(filePath, namespace) ? 'pocket' : 'classic';
    const fileRecord = {
      id: `${source.id}:${filePath}`,
      sourceId: source.id,
      sourceKind: source.kind,
      precedence: source.precedence,
      filePath,
      namespace,
      profile,
      definitionIds: [],
      parseStatus: 'PASS',
      textBytes,
    };

    if (!namespace) {
      diagnostics.push({
        code: 'UI_NAMESPACE_MISSING',
        severity: 'warning',
        certainty: 'official-confirmed',
        sourceId: source.id,
        filePath,
      });
    }

    for (const [rawKey, value] of Object.entries(document)) {
      if (rawKey === 'namespace' || !isPlainObject(value)) continue;
      if (records.length >= limits.maxDefinitions) {
        diagnostics.push({ code: 'UI_DEFINITION_LIMIT', severity: 'error', certainty: 'policy', data: { limit: limits.maxDefinitions } });
        break;
      }
      const parsedKey = parseDefinitionKey(rawKey);
      const qualifiedName = namespace ? `${namespace}.${parsedKey.localName}` : parsedKey.localName;
      // The local name alone is not unique: `same@base_a` and `same@base_b`
      // are distinct authored definitions. Keep the raw key in this opaque id
      // so neither record silently replaces the other in recordsById.
      const id = `${source.id}:${filePath}#${encodeURIComponent(rawKey)}`;
      const record = {
        id,
        sourceId: source.id,
        sourceKind: source.kind,
        precedence: source.precedence,
        filePath,
        namespace,
        profile: profile === 'pocket' || value.$pocket_screen === true || document.$pocket_screen === true ? 'pocket' : 'classic',
        rawKey,
        localName: parsedKey.localName,
        baseRef: parsedKey.baseRef,
        qualifiedName,
        value,
        references: [],
        classification: 'UNKNOWN',
      };
      records.push(record);
      fileRecord.definitionIds.push(id);
    }

    files.push(fileRecord);
    processedFiles += 1;
    onProgress({ phase: 'parse', processed: processedFiles, total: boundedCandidates.length, filePath, definitions: records.length });
    if (processedFiles % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Resolve structural references only after every source's global variables
  // has been overlaid. ZIP entry order must not decide whether a static
  // `$variable` control target is discoverable.
  const environmentCache = createReferenceEnvironmentCache();
  const declarationCache = new WeakMap();
  const rootReferenceState = {
    environmentCache,
    declarationCache,
    limits,
    complete: true,
    limitReasons: new Set(),
    variableSteps: 0,
    controlIdEntries: 0,
    environmentWork: 0,
  };
  const rootEnvironment = buildReferenceEnvironment(new Map(), globalVariables, rootReferenceState);
  if (!rootReferenceState.complete) {
    diagnostics.push({
      code: 'UI_REFERENCE_SCAN_LIMIT',
      severity: 'error',
      certainty: 'policy',
      sourceId: null,
      filePath: null,
      definition: '$global_variables',
      reasons: Array.from(rootReferenceState.limitReasons).sort(),
    });
  }

  // Build the same precedence order later exposed by `catalog.symbols` before
  // dependency scanning. A derived/instantiated control can provide lexical
  // variables consumed inside its inherited base or factory template, so a
  // per-record scan alone is insufficient. Follow fixed control edges under
  // the caller's bounded environment and union every dependency discovered in
  // that concrete composition context.
  const referenceRecordGroups = new Map();
  for (const record of records) {
    const group = referenceRecordGroups.get(record.qualifiedName) || [];
    group.push(record);
    referenceRecordGroups.set(record.qualifiedName, group);
  }
  for (const group of referenceRecordGroups.values()) {
    group.sort((a, b) => (
      b.precedence - a.precedence
      || a.filePath.localeCompare(b.filePath)
      || a.id.localeCompare(b.id)
    ));
  }

  let referenceShapes = null;
  const resultCache = createReferenceResultCache(limits);
  let staticReferenceGraphVisits = 0;
  const globalReferenceBudget = { nodes: 0 };
  const referenceTasks = [];
  if (!skipReferenceDiscovery) {
  await reportAnalysisProgress('reference-direct', 0, records.length, true);
  referenceShapes = buildReferenceShapeIndex(records, referenceRecordGroups, limits);
  // Give every definition a bounded direct scan before spending the shared
  // budget on inherited contexts from the earliest files. Otherwise one large
  // screen can starve unrelated, simple definitions later in the catalog.
  for (const record of records) {
    const referenceState = {
      globalReferenceBudget,
      environmentCache,
      declarationCache,
      rootEnvironment,
      referenceSubtrees: referenceShapes?.subtrees || null,
      referenceRecordGroups,
      limits,
      complete: rootReferenceState.complete,
      limitReasons: new Set(rootReferenceState.limitReasons),
      variableSteps: 0,
      controlIdEntries: 0,
      environmentWork: 0,
      recordVisits: 0,
      nodes: 0,
      nodeBudgetExceeded: false,
      recordStack: new Set([record.id]),
      followInheritanceReference: null,
      deferContext: true,
      needsContext: false,
      pendingContexts: [],
      cacheFrames: [],
      maxObservedDepth: 0,
      depthStops: {},
      depthSamples: [],
    };
    const references = new Set();
    referenceState.followInheritanceReference = (qualifiedName, environment, depth) => {
      // A context-free edge is already represented by the target record's own
      // bounded scan. Re-enter it only when an enclosing control introduced a
      // lexical environment that can change variable-backed dependencies.
      if (!(environment instanceof Map) || environment === rootEnvironment) return;
      observeReferenceDepth(referenceState, depth);
      if (depth > limits.maxScanDepth) {
        recordReferenceDepthLimit(referenceState, depth, 'reference-edge', qualifiedName);
        return;
      }
      const group = referenceRecordGroups.get(qualifiedName) || [];
      // Self-qualified overlay inheritance resolves to the next lower
      // candidate. Ordinary graph cycles have no unvisited candidate and stop.
      const frameForChoice = referenceState.cacheFrames.at(-1);
      const target = group.find((candidate) => {
        if (!referenceState.recordStack.has(candidate.id)) return true;
        // A lower-layer choice depends on every skipped higher ancestor, not
        // only on a cycle that has no candidate left. Otherwise a result from
        // inside an overlay could be replayed outside that overlay and select
        // the wrong physical definition while appearing complete.
        if (frameForChoice?.initialAncestors.has(candidate.id)) {
          frameForChoice.requiredAncestors.add(candidate.id);
        }
        return false;
      });
      if (!target) {
        // Internal cycle stops are reproducible. A stop against an ancestor
        // outside this cached subtree additionally requires that ancestor on
        // reuse; otherwise another lower-layer candidate might become visible.
        const frame = referenceState.cacheFrames.at(-1);
        if (group.length && frame) {
          for (const candidate of group) if (frame.initialAncestors.has(candidate.id)) frame.requiredAncestors.add(candidate.id);
        }
        return;
      }
      const shape = referenceShapes?.shapes.get(target.id);
      if (referenceState.deferContext && (!shape || shape.dynamic)) {
        referenceState.needsContext = true;
        referenceState.pendingContexts.push({ qualifiedName, environment, depth,
          recordStack: new Set(referenceState.recordStack) });
        return;
      }

      const cached = resultCache.find(target.id, environment, referenceState.recordStack, depth);
      if (cached) {
        mergeReferenceFrame(referenceState.cacheFrames.at(-1), cached, environment.size, depth + cached.relativeDepth);
        for (const reference of cached.references) recordReference(reference, references, referenceState);
        return;
      }
      referenceState.recordVisits += 1;
      if (referenceState.recordVisits > limits.maxReferenceRecordVisits) {
        invalidateReferenceFrames(referenceState);
        referenceState.limitReasons.add('record-visits');
        return;
      }

      const frame = { reads: new Map(), references: new Set(), visited: new Set([target.id]),
        requiredAncestors: new Set(), initialAncestors: new Set(referenceState.recordStack),
        maxDepth: depth, cacheable: rootReferenceState.complete && !referenceState.nodeBudgetExceeded, scopeSize: environment.size, maxScopeDelta: 0 };
      referenceState.cacheFrames.push(frame);
      const observedEnvironment = new ObservedReferenceEnvironment(environment, frame.reads);
      referenceState.recordStack.add(target.id);
      if (shape && !shape.dynamic) {
        staticReferenceGraphVisits += 1;
        for (const reference of shape.references) {
          addReference(reference, target.namespace, observedEnvironment, references, referenceState, depth, true);
        }
      } else {
        collectReferences(
          target.value,
          target.namespace,
          references,
          depth,
          referenceState,
          observedEnvironment,
          target.rawKey,
          'element',
          target,
        );
      }
      referenceState.recordStack.delete(target.id);
      referenceState.cacheFrames.pop();
      const parentFrame = referenceState.cacheFrames.at(-1);
      if (parentFrame) for (const reference of frame.references) parentFrame.references.add(reference);
      mergeReferenceFrame(parentFrame, frame, frame.scopeSize, frame.maxDepth);
      if (frame.cacheable) {
        resultCache.store(target.id, { ...frame, relativeDepth: frame.maxDepth - depth });
      }
    };
    collectReferences(
      record.value,
      record.namespace,
      references,
      0,
      referenceState,
      rootEnvironment,
      record.rawKey,
      'element',
      record,
    );
    referenceTasks.push({ record, referenceState, references });
    await reportAnalysisProgress('reference-direct', referenceTasks.length, records.length);
  }
  await reportAnalysisProgress('reference-context', 0, records.length, true);
  let completedReferenceContexts = 0;
  for (const { record, referenceState, references } of referenceTasks) {
    if (referenceState.needsContext && !referenceState.nodeBudgetExceeded) {
      referenceState.deferContext = false;
      // Resume exactly the deferred edge, with its original lexical scope and
      // ancestry, instead of scanning the root and cloning its scopes again.
      for (const pending of referenceState.pendingContexts) {
        referenceState.recordStack = pending.recordStack;
        referenceState.followInheritanceReference(pending.qualifiedName, pending.environment, pending.depth);
        if (referenceState.nodeBudgetExceeded) break;
      }
    }
    referenceState.pendingContexts.length = 0;
    record.references = Array.from(references).sort();
    record.referenceScanComplete = referenceState.complete;
    if (!referenceState.complete) {
      diagnostics.push({
        code: 'UI_REFERENCE_SCAN_LIMIT',
        severity: 'error',
        certainty: 'policy',
        sourceId: record.sourceId,
        filePath: record.filePath,
        definition: record.rawKey,
        reasons: Array.from(referenceState.limitReasons).sort(),
        metrics: {
          depthLimit: limits.maxScanDepth,
          maxObservedDepth: referenceState.maxObservedDepth,
          depthStops: referenceState.depthStops,
          depthSamples: referenceState.depthSamples,
          nodes: referenceState.nodes,
          globalNodes: globalReferenceBudget.nodes,
          recordVisits: referenceState.recordVisits,
          environmentWork: referenceState.environmentWork,
          variableSteps: referenceState.variableSteps,
        },
      });
    }
    completedReferenceContexts += 1;
    await reportAnalysisProgress('reference-context', completedReferenceContexts, records.length);
  }

  } else {
    for (const record of records) record.referenceScanComplete = false;
    await reportAnalysisProgress('reference-skipped', records.length, records.length, true);
  }

  const recordsById = Object.fromEntries(records.map((record) => [record.id, record]));
  const filesById = Object.fromEntries(files.map((file) => [file.id, file]));
  const symbolGroups = new Map();
  const referencedQualifiedNames = new Set();
  for (const record of records) {
    for (const reference of record.references) referencedQualifiedNames.add(reference);
    const list = symbolGroups.get(record.qualifiedName) || [];
    list.push(record);
    symbolGroups.set(record.qualifiedName, list);
  }

  // Definition names are untrusted pack input. A normal object would treat
  // names such as `__proto__` as prototype mutation instead of data, so keep
  // this index explicitly prototype-free like the other catalog maps.
  const symbols = Object.create(null);
  for (const [qualifiedName, group] of symbolGroups.entries()) {
    group.sort((a, b) => b.precedence - a.precedence || a.filePath.localeCompare(b.filePath) || a.id.localeCompare(b.id));
    symbols[qualifiedName] = { qualifiedName, winnerId: group[0].id, candidateIds: group.map((record) => record.id) };
    if (group.length > 1) {
      diagnostics.push({
        code: 'UI_SYMBOL_SHADOWED',
        severity: 'info',
        certainty: 'approximation',
        qualifiedName,
        winnerId: group[0].id,
        candidateIds: group.map((record) => record.id),
      });
    }
  }

  await reportAnalysisProgress('classify', 0, records.length, true);
  let classifiedDefinitions = 0;
  const typeLookupBudget = { used: 0, maximum: Number.isFinite(limits.maxTypeLookupOperations)
    ? Math.max(0, Math.floor(limits.maxTypeLookupOperations)) : DEFAULT_LIMITS.maxTypeLookupOperations };
  for (const record of records) {
    record.typeResolution = resolveDefinitionType(record, symbolGroups, limits.maxScanDepth, typeLookupBudget);
    Object.assign(record, classifyDefinition(record, referencedQualifiedNames));
    if (skipReferenceDiscovery && record.classificationBasis === 'unreferenced') {
      record.classification = 'UNKNOWN';
      record.classificationBasis = 'references-not-scanned';
    }
    classifiedDefinitions += 1;
    await reportAnalysisProgress('classify', classifiedDefinitions, records.length);
  }

  const referenceCompleteDefinitions = records.filter((record) => record.referenceScanComplete).length;
  const referenceIncompleteDefinitions = records.length - referenceCompleteDefinitions;
  const referenceLimitReasons = new Set(rootReferenceState.limitReasons);
  for (const task of referenceTasks) for (const reason of task.referenceState.limitReasons) referenceLimitReasons.add(reason);
  const summary = {
    sources: sources.length,
    candidateFiles: candidates.length,
    registeredSources: registeredPathsBySource.size,
    processedFiles,
    parsedFiles: files.length,
    definitions: records.length,
    symbols: Object.keys(symbols).length,
    pocketDefinitions: records.filter((record) => record.profile === 'pocket').length,
    selectableClassicDefinitions: records.filter((record) => record.profile !== 'pocket').length,
    diagnostics: diagnostics.length,
    totalTextBytes,
    typeLookupOperations: typeLookupBudget.used,
    typeLookupOperationLimit: typeLookupBudget.maximum,
    typeLookupLimitedDefinitions: records.filter(record => record.typeResolution.status === 'work-limit').length,
    referenceDiscovery: skipReferenceDiscovery ? 'skipped' : 'full',
    referenceNodesVisited: globalReferenceBudget.nodes,
    staticReferenceGraphVisits,
    referenceEnvironmentScopesCreated: environmentCache.stats.created,
    referenceEnvironmentScopesReused: environmentCache.stats.reused,
    referenceEnvironmentScopesUnchanged: environmentCache.stats.unchanged,
    referenceResultCacheEntries: resultCache.stats.entries,
    referenceResultCacheHits: resultCache.stats.hits,
    referenceResultCacheChecks: resultCache.stats.checks,
    referenceResultCacheBypassed: resultCache.stats.bypassed,
    referenceResultCacheRetainedMembers: resultCache.stats.retainedMembers,
    referenceResultCacheStorageBypassed: resultCache.stats.storageBypassed,
    referenceShapeIndexComplete: referenceShapes !== null,
    referenceCompleteDefinitions,
    referenceIncompleteDefinitions,
    referenceCoverage: {
      status: skipReferenceDiscovery ? 'not-scanned' : rootReferenceState.complete && referenceIncompleteDefinitions === 0 ? 'complete' : 'partial',
      scope: 'catalog-reference-discovery',
      definitionsTotal: records.length,
      definitionsComplete: referenceCompleteDefinitions,
      definitionsIncomplete: referenceIncompleteDefinitions,
      globalVariablesComplete: rootReferenceState.complete,
      limitReasons: skipReferenceDiscovery ? ['not-requested'] : Array.from(referenceLimitReasons).sort(),
      nodesUsed: globalReferenceBudget.nodes,
      nodesLimit: limits.maxReferenceNodesTotal,
    },
  };

  return {
    schema: 'jsonui-catalog/v1',
    sources: sources.map(({ readText: _readText, ...source }) => ({ ...source, filePaths: undefined })),
    files,
    filesById,
    records,
    recordsById,
    symbols,
    globalVariables,
    diagnostics,
    summary,
  };
}

export function findCatalogFile(catalog, sourceKind, filePath) {
  if (!catalog || !Array.isArray(catalog.files)) return null;
  const path = String(filePath || '').toLowerCase();
  return catalog.files.find((file) => file.sourceKind === sourceKind && String(file.filePath || '').toLowerCase() === path) || null;
}

/** Find a physical catalog file by path regardless of source. */
export function findAnyCatalogFile(catalog, filePath) {
  if (!catalog || !Array.isArray(catalog.files)) return null;
  const path = String(filePath || '').toLowerCase();
  return catalog.files.find((file) => String(file.filePath || '').toLowerCase() === path) || null;
}

export function listDefinitionsForFile(catalog, fileId) {
  const key = String(fileId || '');
  const file = catalog?.filesById && Object.hasOwn(catalog.filesById, key) ? catalog.filesById[key] : null;
  if (!file) return [];
  return file.definitionIds.map((id) => catalog.recordsById[id]).filter(Boolean);
}

/**
 * Return the effective symbol winners whose authored candidates occur at a
 * logical pack path.  This keeps lower Vanilla definitions available when an
 * overlay intentionally ships only a subset of a same-path UI catalog file.
 *
 * It does not deep-merge duplicate definitions.  Each qualified symbol still
 * has exactly one precedence winner; authored inheritance is handled by the
 * effective resolver.
 */
export function listEffectiveDefinitionsForPath(catalog, filePath) {
  if (!catalog || !Array.isArray(catalog.files) || !catalog.recordsById) return [];
  const path = String(filePath || '').toLowerCase();
  const physicalFiles = catalog.files
    .filter((file) => String(file.filePath || '').toLowerCase() === path)
    .sort((a, b) => b.precedence - a.precedence || String(a.sourceId || '').localeCompare(String(b.sourceId || '')) || String(a.id || '').localeCompare(String(b.id || '')));
  const records = [];
  const claimedNames = new Set();
  for (const file of physicalFiles) {
    const authored = (Array.isArray(file.definitionIds) ? file.definitionIds : [])
      .map((id) => catalog.recordsById[id])
      .filter(Boolean);
    const namesAtLayer = new Set(authored.map((record) => String(record.qualifiedName || '')).filter(Boolean));
    for (const record of authored) {
      // Keep every authored raw-key variant at the winning physical layer.
      // `same@base_a` and `same@base_b` are distinct selectable definitions
      // even though both publish the same effective symbol name.
      if (!claimedNames.has(record.qualifiedName)) records.push(record);
    }
    for (const name of namesAtLayer) claimedNames.add(name);
  }
  const classRank = (record) => record.classification === 'SCREEN' ? 0 : record.classification === 'COMPONENT' ? 1 : 2;
  return records.sort((a, b) => (
    classRank(a) - classRank(b)
    || b.precedence - a.precedence
    || String(a.localName || '').localeCompare(String(b.localName || ''))
    || String(a.rawKey || '').localeCompare(String(b.rawKey || ''))
    || String(a.id || '').localeCompare(String(b.id || ''))
  ));
}
