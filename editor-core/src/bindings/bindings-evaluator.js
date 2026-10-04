import { resolveCollectionRowAddress, confirmCollectionRowAddress, nativeCollectionIndexContextRejected } from './collection-context.js';
import { classifyUiBindingType, describeUiBindingType } from '../json/ui-binding-contract.js';
import { copyVariableDefaultOrigins37, markVariableDefault37, markVariableExact37, shadowsAncestorDefault37 } from '../engine/lexical-defaults37.js';
import { initializeLocalToggleState } from '../preview/local-toggle-state.js';
/*
  Step S044: Bindings evaluator (expression subset)

  Goal:
  - Compute preview-time "effective" properties for UI nodes based on their `bindings`.
  - Use *mock data* as the data source for bindings.
  - Evaluate a small, safe expression subset (no `eval`).

  Supported binding subset (best-effort):
  - binding_type: "global" (missing/empty retains the existing global default)
    - binding_name: key to look up in mockData (e.g. "#mock_visible")
    - binding_name_override OR target_property_name: target property (e.g. "#visible")
  - binding_type: "view"
    - source_control_name: name of a referenced control
    - source_property_name: either a property name (e.g. "#texture") or
      an expression in parentheses (e.g. "(#texture = 'loading')")
    - target_property_name OR binding_name_override: target property (e.g. "#visible")

  - binding_type: "none" is inactive; unsupported types are warned and skipped.

  Expression subset (safe):
  - literals: numbers, strings ('...' or "..."), true/false/null
  - references:
    - #prop -> resolve from sourceProps[prop] (view binding), otherwise mockData
    - $var  -> resolve from mockData
  - operators: !, &&, ||, =, ==, !=, <, <=, >, >=
  - parentheses for grouping
*/

/**
 * @typedef {import('../model/ui-screen-model.js').UiScreenModel} UiScreenModel
 * @typedef {import('../model/ui-screen-model.js').UiNode} UiNode
 * @typedef {import('../model/ui-screen-model.js').UiBinding} UiBinding
 */

/**
 * @typedef {{
 *   mockData?: Record<string, any>,
 *   collectionData?: Record<string, Array<Record<string, any>>|Record<string, Record<string, any>>>,
 *   maxNodes?: number,
 *   maxTotalBindings?: number,
 *   maxViewBindings?: number,
 *   maxViewBindingOperations?: number,
 * }} BindingsEvalOptions
 */

/**
 * @typedef {{
 *   propsById: Record<string, Record<string, any>>,
 *   stats: {
 *     nodeCount: number,
 *     bindingsSeen: number,
 *     bindingsApplied: number,
 *     bindingsSkipped: number,
 *   },
 *   warnings: string[],
 * }} BindingsEvalResult
 */

// These fields describe the JSON UI graph or collection identity. A leading
// `#` is valid literal syntax for some of them (for example the shipped
// `#enchant_buttons` collection), so treating it as row data can silently
// redirect bindings or templates. Runtime bindings still resolve their
// explicitly declared targets through the normal binding pass below.
const GENERATED_ROW_STRUCTURAL_PROPERTIES = new Set([
  'bindings',
  'collection_index',
  'collection_item_template',
  'collection_name',
  'control_ids',
  'control_name',
  'controls',
  'factory',
  'grid_dimension_binding',
  'grid_item_template',
  'modifications',
  'property_bag',
  'type',
  'variables',
]);

function isGeneratedRowStructuralProperty(property) {
  const name = String(property || '');
  return name.startsWith('__jsonui_preview_')
    || name.startsWith('binding_')
    || GENERATED_ROW_STRUCTURAL_PROPERTIES.has(name);
}

/**
 * Evaluate bindings for an in-memory UiScreenModel and return effective props by node id.
 *
 * IMPORTANT: This is preview-only. Do not serialize these computed props back to JSON.
 *
 * @param {UiScreenModel|null|undefined} uiModel
 * @param {BindingsEvalOptions} [options]
 * @returns {BindingsEvalResult}
 */
export function evaluateBindingsForUiModel(uiModel, options = {}) {
  const mockData = (options.mockData && typeof options.mockData === 'object') ? options.mockData : {};
  const collectionData = options.collectionData && typeof options.collectionData === 'object' && !Array.isArray(options.collectionData)
    ? options.collectionData
    : {};
  const maxNodes = Number.isFinite(options.maxNodes) ? Math.max(1, Number(options.maxNodes)) : 50_000;
  const maxTotalBindings = Number.isFinite(options.maxTotalBindings) ? Math.max(1, Number(options.maxTotalBindings)) : 50_000;
  const maxViewBindings = Number.isFinite(options.maxViewBindings) ? Math.max(1, Number(options.maxViewBindings)) : 50_000;
  const maxViewBindingOperations = Number.isFinite(options.maxViewBindingOperations)
    ? Math.max(1, Number(options.maxViewBindingOperations))
    : 200_000;

  /** @type {Record<string, Record<string, any>>} */
  const propsById = Object.create(null);
  /** @type {string[]} */
  const warnings = [];
  const bindingOutcomes = new Map();
  let bindingTypeWarningCount = 0;
  const maxBindingTypeWarnings = 64;

  const stats = {
    nodeCount: 0,
    bindingsSeen: 0,
    bindingsApplied: 0,
    bindingsSkipped: 0,
  };

  if (!uiModel || !uiModel.root) {
    return { propsById, stats, warnings, diagnostics: [], localToggleDiagnostics: [], observationCaptureComplete: true };
  }

  // Index nodes by id + build parent/sibling info for basic view-binding resolution.
  /** @type {Record<string, UiNode>} */
  const nodeById = Object.create(null);
  /** @type {Record<string, string|null>} */
  const parentById = Object.create(null);
  /** @type {Record<string, string[]>} */
  const childrenById = Object.create(null);
  /** @type {Record<string, string>} */
  const localNameById = Object.create(null);
  /** @type {Record<string, string[]>} */
  const idsByLocalName = Object.create(null);
  /** @type {Record<string, Record<string, any>>} */
  const lexicalVariablesById = Object.create(null);
  /** @type {Record<string, { name: string, index: number, row: Record<string, any> }|null>} */
  const generatedRowScopeById = Object.create(null);
  const collectionDataById = Object.create(null);
  let nestedCollectionMaps = 0;

  const mergeLexicalVariables = (inherited, node, nodeId) => {
    const maxLexicalVariables = 2048;
    const maxLexicalBranches = 256;
    const local = node && node.localVariables && typeof node.localVariables === 'object'
      ? node.localVariables
      : {};
    const variableBranches = node && node.unknownProps && Array.isArray(node.unknownProps.variables)
      ? node.unknownProps.variables
      : [];
    // Every inherited scope is owned by this evaluation and already bounded.
    // Read-only nodes do not need another copy; descendants that declare a
    // variable still allocate a fresh scope below, preserving sibling isolation.
    if (!variableBranches.length && !Object.keys(local).some(key => key.startsWith('$') && key !== '$schema')) return inherited;
    const merged = Object.create(null);
    let copied = 0;
    for (const [key, value] of Object.entries(inherited || {})) {
      if (copied >= maxLexicalVariables) break;
      merged[key] = value;
      copied += 1;
    }
    copyVariableDefaultOrigins37(inherited, merged);
    const defaultOrigin = { kind: 'model', domain: 'evaluated-model-tree', pointer: String(nodeId) };
    let declaredEntries = 0;
    const applyDeclaration = (declaration) => {
      const entries = Object.entries(declaration || {})
        .filter(([key]) => key.startsWith('$') && key !== '$schema');
      declaredEntries += entries.length;
      for (const [rawKey, value] of entries) {
        const [key, modifier = ''] = rawKey.split('|');
        if (!key || modifier.toLowerCase() !== 'default'
          || (Object.prototype.hasOwnProperty.call(merged, key) && !shadowsAncestorDefault37(merged, key, defaultOrigin))) continue;
        if (!Object.prototype.hasOwnProperty.call(merged, key) && copied >= maxLexicalVariables) break;
        if (!Object.prototype.hasOwnProperty.call(merged, key)) copied += 1;
        merged[key] = value;
        markVariableDefault37(merged, key, defaultOrigin);
      }
      for (const [rawKey, value] of entries) {
        const [key, modifier = ''] = rawKey.split('|');
        if (!key || modifier.toLowerCase() === 'default') continue;
        const selfForward = typeof value === 'string' && value.trim() === key;
        if (selfForward && Object.prototype.hasOwnProperty.call(merged, key)) {
          markVariableExact37(merged, key);
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(merged, key)) {
          if (copied >= maxLexicalVariables) break;
          copied += 1;
        }
        merged[key] = value;
        markVariableExact37(merged, key);
      }
    };

    applyDeclaration(local);
    const branchCount = Math.min(variableBranches.length, maxLexicalBranches);
    for (let index = 0; index < branchCount; index += 1) {
      const branch = variableBranches[index];
      if (!branch || typeof branch !== 'object' || Array.isArray(branch)) continue;
      const requirement = branch.requires;
      const matches = requirement === undefined || requirement === null || requirement === ''
        ? true
        : typeof requirement === 'boolean'
          ? requirement
          : toBoolean(safeEvalExpression(String(requirement), {
              mockData,
              props: {
                ...(node && node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {}),
                ...(node && node.props && typeof node.props === 'object' ? node.props : {}),
                ...merged,
              },
            }));
      if (matches) applyDeclaration(branch);
    }
    if (variableBranches.length > maxLexicalBranches) {
      warnings.push(`LEXICAL_VARIABLE_BRANCH_BUDGET_EXCEEDED:${String(nodeId)}:max=${maxLexicalBranches}`);
    }
    if (declaredEntries + Object.keys(inherited || {}).length > maxLexicalVariables) {
      warnings.push(`LEXICAL_VARIABLE_BUDGET_EXCEEDED:${String(nodeId)}:max=${maxLexicalVariables}`);
    }
    return merged;
  };

  /** @type {{ id: string, node: UiNode, parentId: string|null, inheritedVariables: Record<string, any>, inheritedGeneratedRowScope: { name: string, index: number, row: Record<string, any> }|null }[]} */
  const stack = [{
    id: String(uiModel.root.id),
    node: uiModel.root,
    parentId: null,
    inheritedVariables: Object.create(null),
    inheritedGeneratedRowScope: null,
    inheritedCollectionData: collectionData,
  }];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) break;
    const id = String(cur.id);
    if (nodeById[id]) continue;
    nodeById[id] = cur.node;
    parentById[id] = cur.parentId;
    const lexicalVariables = mergeLexicalVariables(cur.inheritedVariables, cur.node, id);
    lexicalVariablesById[id] = lexicalVariables;
    const authoredProps = {
      ...(cur.node && cur.node.unknownProps && typeof cur.node.unknownProps === 'object' ? cur.node.unknownProps : {}),
      ...(cur.node && cur.node.props && typeof cur.node.props === 'object' ? cur.node.props : {}),
    };
    const generatedCollectionName = typeof authoredProps.__jsonui_preview_collection_name === 'string'
      ? authoredProps.__jsonui_preview_collection_name.trim()
      : '';
    const generatedCollectionIndex = authoredProps.collection_index;
    let scopedCollectionData = cur.inheritedCollectionData || collectionData;
    const hasAuthoredCollectionProperty = Object.prototype.hasOwnProperty.call(
      authoredProps,
      'collection_name',
    );
    const propertyBag = authoredProps.property_bag;
    const hasPropertyBagCollectionBoundary = [
      'collection_name',
      '#collection_name',
      '$collection_name',
    ].some((key) => {
      const entry = resolveExactOwnDataEntry(propertyBag, key);
      return entry.found || entry.invalid;
    });
    const hasRuntimeCollectionBoundary = (Array.isArray(cur.node?.bindings) ? cur.node.bindings : [])
      .some((binding) => {
        if (!shouldApplyBinding(binding)) return false;
        const sourceKey = typeof binding.binding_name === 'string'
          ? binding.binding_name.trim()
          : '';
        const implicitTarget = /^[#$][A-Za-z0-9_:@.\-]+$/u.test(sourceKey) ? sourceKey : '';
        return normalizeTargetProp(
          binding.binding_name_override || binding.target_property_name || implicitTarget,
        ) === 'collection_name';
      });
    const hasAuthoredCollectionBoundary = hasAuthoredCollectionProperty
      && !(typeof authoredProps.collection_name === 'string'
        && authoredProps.collection_name.trim() === '');
    // Collection identity may be supplied by a property bag or a runtime
    // binding. Its value is not available during this indexing pass, but it is
    // still a scope boundary: letting an outer factory row flow through would
    // bind descendants to the wrong collection without any diagnostic.
    const hasCollectionBoundary = hasAuthoredCollectionBoundary
      || hasPropertyBagCollectionBoundary
      || hasRuntimeCollectionBoundary;
    let generatedRowScope = cur.inheritedGeneratedRowScope || null;
    if (generatedCollectionName) {
      const rowResult = Number.isInteger(generatedCollectionIndex)
        && generatedCollectionIndex >= 0
        && generatedCollectionIndex <= 1_000_000
        ? readCollectionRow(scopedCollectionData, generatedCollectionName, generatedCollectionIndex)
        : { row: null };
      // A generated collection marker is a scope boundary. Missing or
      // malformed representative data must not leak an outer row.
      generatedRowScope = rowResult.row
        ? { name: generatedCollectionName, index: generatedCollectionIndex, row: rowResult.row }
        : null;
    }
    generatedRowScopeById[id] = generatedRowScope;
    // An explicit preview row may provide nested collection data (for example
    // different ingredient/result items for each trade). Copy only own data
    // properties and retain the parent map for siblings and unknown names.
    const nestedCollections = readOwnDataValue(generatedRowScope?.row, '__collections');
    if (nestedCollections && nestedCollections !== cur.inheritedNestedCollectionsSource && typeof nestedCollections === 'object' && !Array.isArray(nestedCollections)) {
      if (nestedCollectionMaps < 2048) {
        const nextCollections = Object.create(null);
        // Do not invoke getters on an arbitrary data map while introducing
        // a nested scope. All inherited entries retain own-data semantics.
        for (const outerKey of Object.keys(scopedCollectionData)) {
          const outerEntry = resolveExactOwnDataEntry(scopedCollectionData, outerKey);
          if (!outerEntry.invalid && outerEntry.found) nextCollections[outerKey] = outerEntry.value;
        }
        let copied = 0;
        for (const key of Object.keys(nestedCollections)) {
          if (++copied > 128) { warnings.push('NESTED_COLLECTION_NAME_LIMIT'); break; }
          if (!key || key.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(key)) continue;
          const entry = resolveExactOwnDataEntry(nestedCollections, key);
          if (entry.invalid || !entry.found) continue;
          // Empty arrays are authoritative and must suppress parent data.
          if (Array.isArray(entry.value) || (entry.value && typeof entry.value === 'object')) nextCollections[key] = entry.value;
        }
        scopedCollectionData = nextCollections;
        nestedCollectionMaps += 1;
      } else if (!warnings.includes('NESTED_COLLECTION_MAP_LIMIT')) warnings.push('NESTED_COLLECTION_MAP_LIMIT');
    }
    collectionDataById[id] = scopedCollectionData;
    // The collection-owning control itself can consume its parent's row, but
    // descendants belong to the nested collection. If that collection was not
    // materialized (and therefore has no generated marker), fail closed rather
    // than leaking the outer row namespace through it.
    const defaultChildGeneratedRowScope = hasCollectionBoundary ? null : generatedRowScope;
    const authoredCollectionResolution = hasAuthoredCollectionBoundary
      ? resolveCollectionName(
          authoredProps.collection_name,
          { ...lexicalVariables, ...authoredProps },
          mockData,
        )
      : { name: '', status: 'absent' };
    const localName = cur.node?.key?.local_name ? String(cur.node.key.local_name) : String(cur.node?.key?.raw || id);
    localNameById[id] = localName;
    if (!idsByLocalName[localName]) idsByLocalName[localName] = [];
    idsByLocalName[localName].push(id);

    const childIds = [];
    for (const ch of (cur.node.children || [])) {
      const cid = String(ch.id);
      childIds.push(cid);
      let inheritedGeneratedRowScope = defaultChildGeneratedRowScope;
      if (
        hasAuthoredCollectionBoundary
        && authoredCollectionResolution.status === 'ok'
        && String(cur.node?.type || '').trim().toLowerCase() === 'grid'
      ) {
        const childProps = {
          ...(ch && ch.unknownProps && typeof ch.unknownProps === 'object' ? ch.unknownProps : {}),
          ...(ch && ch.props && typeof ch.props === 'object' ? ch.props : {}),
        };
        const position = Array.isArray(childProps.grid_position) ? childProps.grid_position : null;
        const dimensions = resolveGridDimensions(
          { ...lexicalVariables, ...authoredProps },
          mockData,
          generatedRowScope?.row || null,
        );
        const column = position?.[0];
        const row = position?.[1];
        const columns = dimensions?.[0];
        const rows = dimensions?.[1];
        if (
          Number.isSafeInteger(column)
          && Number.isSafeInteger(row)
          && Number.isSafeInteger(columns)
          && Number.isSafeInteger(rows)
          && columns > 0
          && rows > 0
          && columns <= 2048
          && rows <= 2048
          && column >= 0
          && row >= 0
          && column < columns
          && row < rows
        ) {
          const fillDirection = String(authoredProps.grid_fill_direction || 'horizontal')
            .trim()
            .toLowerCase();
          const index = fillDirection === 'vertical'
            ? column * rows + row
            : row * columns + column;
          const rowResult = readCollectionRow(
            scopedCollectionData,
            authoredCollectionResolution.name,
            index,
          );
          inheritedGeneratedRowScope = rowResult.row
            ? { name: authoredCollectionResolution.name, index, row: rowResult.row }
            : null;
        }
      }
      stack.push({
        id: cid,
        node: ch,
        parentId: id,
        inheritedVariables: lexicalVariables,
        inheritedGeneratedRowScope,
        inheritedCollectionData: scopedCollectionData,
        inheritedNestedCollectionsSource: nestedCollections || cur.inheritedNestedCollectionsSource,
      });
    }
    childrenById[id] = childIds;

    stats.nodeCount += 1;
    if (stats.nodeCount >= maxNodes && stack.length) {
      warnings.push(`BINDING_NODE_SCAN_LIMIT:maxNodes=${String(maxNodes)}:pending=${stack.length}`);
      break;
    }
  }

  // Native immediate-parent constraints are separate from the historical
  // best-effort row-address evaluator. In particular, an outer collection
  // must not make an authored index on an ordinary panel descendant legal.
  let nativeIndexWarnings = 0;
  for (const [id, node] of Object.entries(nodeById)) {
    const props = { ...(node?.unknownProps || {}), ...(node?.props || {}) };
    const parentType = nodeById[parentById[id]]?.type;
    if (!nativeCollectionIndexContextRejected({ props, parentType })) continue;
    if (nativeIndexWarnings < 256) warnings.push(`COLLECTION_INDEX_NATIVE_CONTEXT_INVALID:${id}:${String(parentType || 'unscoped')}`);
    else if (nativeIndexWarnings === 256) warnings.push('COLLECTION_NATIVE_CONTEXT_DIAGNOSTIC_LIMIT:256');
    nativeIndexWarnings++;
  }

  const collectionNamesBySourceKey = new Map();
  // Some Vanilla screens use a fixed, decorative grid whose cells bind to
  // different singleton collections (legacy trade), while other screens use
  // an otherwise-identical unscoped grid as the row index for one collection.
  // Record the bounded set of explicit collection names observed below each
  // unscoped grid so grid_position is used only for the latter shape.
  const unscopedGridCollectionNamesById = Object.create(null);
  const potentialViewBindingTargetsById = Object.create(null);
  const bindingMetadataCompleteById = Object.create(null);
  let collectionScopeScanRemaining = maxTotalBindings;
  let collectionScopeScanTruncated = false;
  const isUnderStaticIgnoredBranch = (nodeId) => {
    let cursor = String(nodeId || '');
    for (let depth = 0; cursor && depth < 64; depth += 1) {
      const candidate = nodeById[cursor];
      const props = { ...(candidate?.unknownProps || {}), ...(candidate?.props || {}) };
      const canChangeIgnored = (Array.isArray(candidate?.bindings) ? candidate.bindings : []).some((binding) => {
        if (!shouldApplyBinding(binding)) return false;
        const target = normalizeTargetProp(
          binding?.target_property_name || binding?.binding_name_override || binding?.binding_name,
        );
        return target === 'ignored';
      });
      if (!canChangeIgnored && Object.prototype.hasOwnProperty.call(props, 'ignored')
        && toBoolean(props.ignored) === true) return true;
      cursor = parentById[cursor] || '';
    }
    return false;
  };
  const recordUnscopedGridCollectionUse = (nodeId, collectionName, uncertain = false) => {
    let cursor = String(nodeId || '');
    for (let depth = 0; cursor && depth < 64; depth += 1) {
      const candidate = nodeById[cursor];
      const candidateProps = {
        ...(lexicalVariablesById[cursor] || {}),
        ...(candidate?.unknownProps || {}),
        ...(candidate?.props || {}),
      };
      const rawBoundaryName = typeof candidateProps.collection_name === 'string'
        ? candidateProps.collection_name.trim()
        : '';
      const marker = typeof candidateProps.__jsonui_preview_collection_name === 'string'
        ? candidateProps.__jsonui_preview_collection_name.trim()
        : '';
      if (rawBoundaryName || marker) break;
      if (String(candidate?.type || '').toLowerCase() === 'grid') {
        const info = unscopedGridCollectionNamesById[cursor]
          || (unscopedGridCollectionNamesById[cursor] = { names: new Set(), uncertain: false });
        if (collectionName) info.names.add(collectionName);
        if (uncertain) info.uncertain = true;
      }
      cursor = parentById[cursor] || '';
    }
  };
  for (const node of Object.values(nodeById)) {
    const viewMetadataTargets = new Set();
    let metadataComplete = true;
    const nodeProps = {
      ...(lexicalVariablesById[String(node.id)] || {}),
      ...(node && node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {}),
      ...(node && node.props && typeof node.props === 'object' ? node.props : {}),
    };
    for (const binding of (Array.isArray(node && node.bindings) ? node.bindings : [])) {
      if (collectionScopeScanRemaining <= 0) {
        collectionScopeScanTruncated = true;
        metadataComplete = false;
        break;
      }
      collectionScopeScanRemaining -= 1;
      const metadataTarget = normalizeTargetProp(
        binding?.target_property_name || binding?.binding_name_override || binding?.binding_name,
      );
      if (metadataTarget && normalizeBindingType(binding) === 'view' && shouldApplyBinding(binding)) {
        viewMetadataTargets.add(metadataTarget);
      }
      if (isUnderStaticIgnoredBranch(node.id)) continue;
      const bindingType = normalizeBindingType(binding);
      if (!['collection', 'collection_details'].includes(bindingType) || !shouldApplyBinding(binding)) continue;
      const sourceKey = typeof binding.binding_name === 'string' ? binding.binding_name.trim() : '';
      const rawCollectionName = typeof binding.binding_collection_name === 'string'
        ? binding.binding_collection_name.trim()
        : '';
      const collectionResolution = resolveCollectionName(
        binding.binding_collection_name,
        nodeProps,
        mockData,
      );
      if (rawCollectionName) {
        recordUnscopedGridCollectionUse(
          node.id,
          collectionResolution.status === 'ok' ? collectionResolution.name : '',
          collectionResolution.status !== 'ok',
        );
      }
      if (bindingType !== 'collection') continue;
      const collectionName = collectionResolution.name;
      if (!sourceKey || !collectionName) continue;
      const normalizedSourceKey = normalizeCollectionSourceKey(sourceKey);
      if (!collectionNamesBySourceKey.has(normalizedSourceKey)) collectionNamesBySourceKey.set(normalizedSourceKey, new Set());
      collectionNamesBySourceKey.get(normalizedSourceKey).add(collectionName);
    }
    potentialViewBindingTargetsById[String(node.id)] = viewMetadataTargets;
    bindingMetadataCompleteById[String(node.id)] = metadataComplete;
    if (collectionScopeScanTruncated) break;
  }
  const warnedCollectionAmbiguity = new Set();
  let collectionDetailsPreScanRemaining = maxTotalBindings;
  const prefixedCollectionDetailsByNodeId = new Map();
  const localCollectionContextWarningsByNodeId = new Map();
  const collectionDetailsContextByNodeId = new Map();
  const collectionDetailsAuthoredPropsByNodeId = new Map();
  const collectionDetailsGlobalTargetsByNodeId = new Map();
  const unprefixedCollectionDetailsWarningsByNodeId = new Map();
  const factoryRowTokenScanBudget = {
    objects: 100_000,
    values: 500_000,
    tokens: 100_000,
  };
  let factoryRowExpressionReferenceBudget = 100_000;
  const collectionExpressionReferenceBudget = { remaining: 100_000 };
  let factoryRowTokenScanWarningEmitted = false;
  let factoryRowTokenResolutionWarningEmitted = false;
  let factoryRowExpressionReferenceWarningEmitted = false;

  const resolveGeneratedRowValue = (
    value,
    generatedRow,
    lexicalVariables,
    state,
    depth = 0,
  ) => {
    if (typeof value === 'string') {
      const original = value;
      let current = value;
      let resolved = false;
      const seenTokens = new Set();
      for (let tokenDepth = 0; tokenDepth < 8; tokenDepth += 1) {
        if (typeof current !== 'string') break;
        const token = current.trim();
        if (!/^[#$][A-Za-z0-9_:@.\-]+$/u.test(token)) {
          return { value: current, changed: resolved, complete: true };
        }
        if (seenTokens.has(token)) {
          state.incomplete = true;
          return { value: original, changed: false, complete: false };
        }
        if (state.tokens >= 256 || factoryRowTokenScanBudget.tokens <= 0) {
          state.limited = true;
          return { value: original, changed: false, complete: false };
        }
        state.tokens += 1;
        factoryRowTokenScanBudget.tokens -= 1;
        seenTokens.add(token);
        const lexicalEntry = token.startsWith('$')
          ? resolveOwnBindingEntry(lexicalVariables, token)
          : { found: false, value: undefined };
        const entry = lexicalEntry.found
          ? lexicalEntry
          : resolveOwnBindingEntry(generatedRow, token);
        if (lexicalEntry.invalid || entry.invalid) {
          state.incomplete = true;
          return { value: original, changed: false, complete: false };
        }
        if (!entry.found) {
          if (resolved) state.incomplete = true;
          return { value: original, changed: false, complete: !resolved };
        }
        current = entry.value;
        resolved = true;
      }
      if (typeof current !== 'string'
        || !/^[#$][A-Za-z0-9_:@.\-]+$/u.test(current.trim())) {
        return { value: current, changed: resolved, complete: true };
      }
      state.limited = true;
      return { value: original, changed: false, complete: false };
    }
    if (!value || typeof value !== 'object') return { value, changed: false, complete: true };
    if (!Array.isArray(value)) {
      let prototype;
      try {
        prototype = Object.getPrototypeOf(value);
      } catch {
        state.limited = true;
        return { value, changed: false, complete: false };
      }
      if (prototype !== Object.prototype && prototype !== null) {
        return { value, changed: false, complete: true };
      }
    }
    if (
      depth >= 32
      || state.objects >= 512
      || state.values >= 2048
      || factoryRowTokenScanBudget.objects <= 0
      || factoryRowTokenScanBudget.values <= 0
    ) {
      state.limited = true;
      return { value, changed: false, complete: false };
    }
    if (state.seen.has(value)) {
      state.limited = true;
      return { value, changed: false, complete: false };
    }
    state.seen.add(value);
    state.objects += 1;
    factoryRowTokenScanBudget.objects -= 1;
    let keys;
    try {
      keys = Object.keys(value);
    } catch {
      state.limited = true;
      return { value, changed: false, complete: false };
    }
    const entries = [];
    let changed = false;
    let complete = true;
    for (const key of keys) {
      if (state.values >= 2048 || factoryRowTokenScanBudget.values <= 0) {
        state.limited = true;
        complete = false;
        break;
      }
      state.values += 1;
      factoryRowTokenScanBudget.values -= 1;
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        state.limited = true;
        complete = false;
        continue;
      }
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        state.limited = true;
        complete = false;
        continue;
      }
      const resolved = resolveGeneratedRowValue(
        descriptor.value,
        generatedRow,
        lexicalVariables,
        state,
        depth + 1,
      );
      entries.push([key, descriptor.value, resolved.value]);
      if (resolved.changed) changed = true;
      if (resolved.complete === false) complete = false;
    }
    if (!complete || !changed || entries.length !== keys.length) {
      return { value, changed: false, complete };
    }
    let output;
    if (Array.isArray(value)) {
      let lengthDescriptor;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      } catch {
        state.limited = true;
        return { value, changed: false, complete: false };
      }
      const length = lengthDescriptor && Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        ? lengthDescriptor.value
        : Number.NaN;
      if (!Number.isSafeInteger(length) || length < 0 || length > 1_000_000) {
        state.limited = true;
        return { value, changed: false, complete: false };
      }
      output = new Array(length);
    } else {
      output = Object.create(null);
    }
    for (const [key, original, resolved] of entries) {
      try {
        Object.defineProperty(output, key, {
          value: Object.is(original, resolved) ? original : resolved,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      } catch {
        state.limited = true;
        return { value, changed: false, complete: false };
      }
    }
    return { value: output, changed: true, complete: true };
  };

  // Pass 1: base props + global bindings.
  for (const id of Object.keys(nodeById)) {
    const node = nodeById[id];
    const base = (node && node.props && typeof node.props === 'object') ? node.props : {};
    const unknownProps = (node && node.unknownProps && typeof node.unknownProps === 'object') ? node.unknownProps : {};
    const propsValid = (node && node.propsValid && typeof node.propsValid === 'object') ? node.propsValid : {};
    const propertyBag = base.property_bag && typeof base.property_bag === 'object' && !Array.isArray(base.property_bag)
      ? base.property_bag
      : unknownProps.property_bag && typeof unknownProps.property_bag === 'object' && !Array.isArray(unknownProps.property_bag)
        ? unknownProps.property_bag
        : null;
    const propertyBagDefaults = {};
    if (propertyBag) {
      let copied = 0;
      for (const [rawKey, value] of Object.entries(propertyBag)) {
        if (copied >= 256) {
          warnings.push(`PROPERTY_BAG_BUDGET_EXCEEDED:${id}:max=256`);
          break;
        }
        const key = normalizeTargetProp(rawKey);
        if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
        propertyBagDefaults[key] = value;
        copied += 1;
      }
    }
    /** @type {Record<string, any>} */
    const out = { ...propertyBagDefaults, ...unknownProps, ...base };
    for (const [key, valid] of Object.entries(propsValid)) {
      if (valid === false && Object.prototype.hasOwnProperty.call(unknownProps, key)) {
        out[key] = unknownProps[key];
      }
    }

    // A generated grid/factory instance supplies one runtime row namespace to
    // its control tree. Resolve exact `#/$token` values, including bounded
    // array/object members such as size and offset axes. Accessors, cycles and
    // values beyond the shared budget stay authored and therefore fail closed.
    const generatedRow = generatedRowScopeById[id]?.row || null;
    if (generatedRow) {
      const scanState = {
        objects: 0,
        values: 0,
        tokens: 0,
        seen: new Set(),
        limited: false,
        incomplete: false,
      };
      let inspectedProperties = 0;
      for (const property of Object.keys(out)) {
        if (isGeneratedRowStructuralProperty(property)) continue;
        inspectedProperties += 1;
        if (inspectedProperties > 512) {
          scanState.limited = true;
          break;
        }
        const resolved = resolveGeneratedRowValue(
          out[property],
          generatedRow,
          lexicalVariablesById[id],
          scanState,
        );
        if (resolved.changed) out[property] = resolved.value;
      }
      if (scanState.limited && !factoryRowTokenScanWarningEmitted) {
        factoryRowTokenScanWarningEmitted = true;
        warnings.push('FACTORY_ROW_TOKEN_SCAN_LIMIT:values remain unresolved');
      }
      if (scanState.incomplete && !factoryRowTokenResolutionWarningEmitted) {
        factoryRowTokenResolutionWarningEmitted = true;
        warnings.push('FACTORY_ROW_TOKEN_RESOLUTION_INCOMPLETE:values remain authored');
      }
    }

    // Vanilla ActionForm title/body use a direct #token without a bindings
    // array. Resolve only an exact, explicitly present global text value;
    // unresolved tokens retain the existing diagnostic/fallback behavior.
    if (!generatedRow && typeof out.text === 'string' && /^[#$][A-Za-z0-9_:@.\-]+$/u.test(out.text)) {
      const resolvedText = resolveRuntimeTokenValue(out.text, { ...lexicalVariablesById[id], ...out }, mockData);
      if (typeof resolvedText === 'string' || typeof resolvedText === 'number') out.text = String(resolvedText);
    }
    const bindings = Array.isArray(node.bindings) ? node.bindings : [];
    // `collection_details` is metadata for the binding array, not an
    // imperative step. Resolve the one unprefixed context independently of
    // declaration order. Multiple/prefixed contexts combine engine-owned row
    // namespaces whose public semantics are insufficient for a safe guess.
    let collectionDetailsProps = Object.create(null);
    let detailBinding = null;
    let unprefixedDetailCount = 0;
    let prefixedDetailCount = 0;
    for (let index = 0; index < bindings.length && collectionDetailsPreScanRemaining > 0; index += 1) {
      collectionDetailsPreScanRemaining -= 1;
      const candidate = bindings[index];
      if (normalizeBindingType(candidate) !== 'collection_details' || !shouldApplyBinding(candidate)) continue;
      const prefix = typeof candidate.binding_collection_prefix === 'string'
        ? candidate.binding_collection_prefix.trim()
        : '';
      if (prefix) {
        prefixedDetailCount += 1;
      } else {
        unprefixedDetailCount += 1;
        if (!detailBinding) detailBinding = candidate;
      }
    }
    let collectionDetailsWarning = null;
    if (prefixedDetailCount > 0) prefixedCollectionDetailsByNodeId.set(id, prefixedDetailCount);
    if (unprefixedDetailCount === 1 && detailBinding) {
      collectionDetailsAuthoredPropsByNodeId.set(id, { ...out });
      const details = resolveCollectionDetailsContext({
        lexicalVariablesById,
        currentId: id,
        binding: detailBinding,
        currentProps: { ...(lexicalVariablesById[id] || {}), ...out },
        collectionData: collectionDataById[id] || collectionData,
        nodeById,
        parentById,
        propsById,
        mockData,
        unscopedGridCollectionNamesById,
        collectionScopeScanTruncated,
      });
      collectionDetailsContextByNodeId.set(id, details.context || null);
      if (details.props) {
        collectionDetailsProps = details.props;
        // Minecraft passes collection-details row metadata to native
        // renderers even when the authored binding exposes only an opaque
        // renderer handle. Keep that bounded row namespace separate from
        // authored properties so adapters can inspect it without affecting
        // serialization or ordinary property precedence.
        out.__jsonui_preview_collection_details = collectionDetailsProps;
      }
      collectionDetailsWarning = details.warning;
    } else if (unprefixedDetailCount > 1) {
      collectionDetailsWarning = `COLLECTION_DETAILS_CONTEXT_UNSUPPORTED:count=${unprefixedDetailCount}`;
    }
    if (collectionDetailsWarning && !warnedCollectionAmbiguity.has(collectionDetailsWarning)) {
      warnedCollectionAmbiguity.add(collectionDetailsWarning);
      unprefixedCollectionDetailsWarningsByNodeId.set(id, collectionDetailsWarning);
    }
    // Native Drawned INPUT/FILTER evidence concerns an added read on the
    // candidate's parent panel, not every collection binding. Keep rendering
    // the supplied row for inspection, but do not mistake inherited preview
    // context for proof that this component has native context of its own.
    if (String(node.type || '').toLowerCase() === 'panel'
      && unprefixedDetailCount === 0 && prefixedDetailCount === 0
      && bindings.some(candidate => normalizeBindingType(candidate) === 'collection'
        && shouldApplyBinding(candidate)
        && resolveCollectionName(candidate.binding_collection_name,
          { ...(lexicalVariablesById[id] || {}), ...out }, mockData).name === 'custom_dropdown'
        && String(candidate.binding_name || '').trim() === '#custom_radio_text')) {
      localCollectionContextWarningsByNodeId.set(id,
        `COLLECTION_DETAILS_LOCAL_CONTEXT_UNCONFIRMED:${id}:custom_dropdown:#custom_radio_text`);
    }
    for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
      if (stats.bindingsSeen >= maxTotalBindings) {
        const skippedRemainder = bindings.length - bindingIndex;
        stats.bindingsSeen += skippedRemainder;
        stats.bindingsSkipped += skippedRemainder;
        propsById[id] = out;
        const rootId = String(uiModel.root.id);
        if (!propsById[rootId]) {
          const rootNode = nodeById[rootId];
          propsById[rootId] = { ...(rootNode?.unknownProps || {}), ...(rootNode?.props || {}) };
        }
        propsById[rootId].visible = UNRESOLVED_RUNTIME_VISIBILITY;
        propsById[rootId].enabled = UNRESOLVED_RUNTIME_VISIBILITY;
        warnings.push(`BINDING_BUDGET_EXCEEDED:maxTotalBindings=${maxTotalBindings}`);
        return { propsById, stats, warnings, diagnostics: [{ nodeId: rootId, bindingIndex: -1, bindingType: 'budget', status: 'unresolved', reason: 'BUDGET', targetProperty: 'visible' }], localToggleDiagnostics: [], observationCaptureComplete: false };
      }
      const b = bindings[bindingIndex];
      const outcomeKey = `${id}:${bindingIndex}`;
      const outcome = { nodeId: id, bindingIndex, bindingType: normalizeBindingType(b), status: 'unresolved', reason: 'PROPERTY_UNRESOLVED', targetProperty: normalizeTargetProp(b?.binding_name_override || b?.target_property_name || b?.binding_name) || '', sourceProperty: String(b?.source_property_name || b?.binding_name || '') };
      bindingOutcomes.set(outcomeKey, outcome);
      stats.bindingsSeen += 1;
      if (!shouldApplyBinding(b)) {
        Object.assign(outcome, { status: 'inactive', reason: 'IGNORED' });
        stats.bindingsSkipped += 1;
        continue;
      }

      const bType = normalizeBindingType(b);
      if (bType === 'none' || bType === 'other' || bType === 'dynamic') {
        Object.assign(outcome, { status: bType === 'none' ? 'inactive' : 'unresolved', reason: bType === 'none' ? 'NONE' : 'TYPE_UNSUPPORTED' });
        stats.bindingsSkipped += 1;
        if (bType !== 'none') {
          bindingTypeWarningCount += 1;
          if (bindingTypeWarningCount <= maxBindingTypeWarnings) {
            const code = bType === 'dynamic' ? 'BINDING_TYPE_UNRESOLVED' : 'BINDING_TYPE_UNSUPPORTED';
            warnings.push(`${code}:${JSON.stringify({
              file_path: String(uiModel.filePath || '').slice(0, 1024),
              node_id: String(id).slice(0, 512),
              binding_index: bindingIndex,
              ...describeUnsupportedBindingType(b),
            })}`);
          } else if (bindingTypeWarningCount === maxBindingTypeWarnings + 1) {
            warnings.push(`BINDING_TYPE_WARNING_LIMIT:maxDetails=${maxBindingTypeWarnings};additionalWarningsOmitted=true`);
          }
        }
        continue;
      }
      if (bType === 'collection_details') {
        if (b !== detailBinding || Object.keys(collectionDetailsProps).length === 0) {
          outcome.reason = 'COLLECTION_CONTEXT_UNRESOLVED';
          stats.bindingsSkipped += 1;
          continue;
        }
        stats.bindingsApplied += 1;
        Object.assign(outcome, { status: 'applied', reason: 'APPLIED' });
        continue;
      }
      if (bType !== 'global' && bType !== 'collection') {
        // view bindings handled in pass 2
        continue;
      }

      const sourceKey = typeof b.binding_name === 'string' ? b.binding_name.trim() : '';
      const implicitTarget = /^[#$][A-Za-z0-9_:@.\-]+$/.test(sourceKey) ? sourceKey : '';
      const targetProp = normalizeTargetProp(b.binding_name_override || b.target_property_name || implicitTarget);
      if (!targetProp) {
        outcome.reason = 'TARGET_MISSING';
        stats.bindingsSkipped += 1;
        continue;
      }
      // Vanilla uses this exact sentinel when an optional binding is disabled.
      // It means "retain the authored/default property", not "look up missing
      // runtime data and replace visibility with an unresolved marker".
      if (bType === 'global' && sourceKey === '#not_data_bound') {
        Object.assign(outcome, { status: 'inactive', reason: 'NOT_DATA_BOUND' });
        stats.bindingsSkipped += 1;
        continue;
      }
      let value;
      // In Bedrock's authored UI, `collection_details` supplies the row
      // namespace for the whole binding array. This includes descriptors that
      // explicitly spell `binding_type: "global"` (for example the Vanilla
      // trade toggle state/enabled bindings). Resolve an own row value first,
      // then fall back to the ordinary global namespace when that key is not
      // present. A present null/false/zero value must remain authoritative.
      const usesCollectionDetails = bType === 'global'
        && Object.keys(collectionDetailsProps).length > 0;
      if (usesCollectionDetails) {
        if (!collectionDetailsGlobalTargetsByNodeId.has(id)) {
          collectionDetailsGlobalTargetsByNodeId.set(id, new Set());
        }
        collectionDetailsGlobalTargetsByNodeId.get(id).add(targetProp);
      }
      const baseExpressionProps = usesCollectionDetails
        ? { ...(lexicalVariablesById[id] || {}), ...out, ...collectionDetailsProps }
        : { ...(lexicalVariablesById[id] || {}), ...out };
      const sourceIsExpression = sourceKey.startsWith('(') && sourceKey.endsWith(')');
      const sourceUsesGeneratedRowExpression = sourceIsExpression && bType !== 'collection';
      const collectionNameIsExpression = bType === 'collection'
        && typeof b.binding_collection_name === 'string'
        && b.binding_collection_name.trim().startsWith('(')
        && b.binding_collection_name.trim().endsWith(')');
      // A wide runtime row must not be copied once per ordinary binding.
      // Project it only for expressions, whose evaluator needs a flat symbol
      // namespace; direct bindings use the O(1) own-data lookup below.
      let expressionProps = baseExpressionProps;
      let generatedRowExpressionProjectionLimited = false;
      if (generatedRow && (sourceUsesGeneratedRowExpression || collectionNameIsExpression)) {
        const projection = projectGeneratedRowExpressionProps(
          baseExpressionProps,
          generatedRow,
          [
            ...(sourceUsesGeneratedRowExpression ? [sourceKey] : []),
            ...(collectionNameIsExpression ? [b.binding_collection_name] : []),
          ],
          factoryRowExpressionReferenceBudget,
        );
        factoryRowExpressionReferenceBudget = Math.max(
          0,
          factoryRowExpressionReferenceBudget - projection.rowReads,
        );
        if (projection.limited && !factoryRowExpressionReferenceWarningEmitted) {
          factoryRowExpressionReferenceWarningEmitted = true;
          warnings.push('FACTORY_ROW_EXPRESSION_REF_LIMIT:values remain unresolved');
        }
        generatedRowExpressionProjectionLimited = projection.limited;
        expressionProps = { ...baseExpressionProps, ...projection.props };
      }
      if (bType === 'collection') {
        const collectionResult = generatedRowExpressionProjectionLimited
          ? { value: undefined, warning: null }
          : resolveCollectionBindingValue({
              lexicalVariablesById,
              currentId: id,
              binding: b,
              sourceKey,
              currentProps: expressionProps,
              collectionData: collectionDataById[id] || collectionData,
              collectionNamesBySourceKey,
              collectionScopeScanTruncated,
              nodeById,
              parentById,
              propsById,
              mockData,
              unscopedGridCollectionNamesById,
              expressionReferenceBudget: collectionExpressionReferenceBudget,
            });
        value = collectionResult.value;
        if (collectionResult.warning && !warnedCollectionAmbiguity.has(collectionResult.warning)) {
          warnedCollectionAmbiguity.add(collectionResult.warning);
          warnings.push(collectionResult.warning);
        }
      } else {
        const generatedRowValue = resolveOwnBindingEntry(generatedRow, sourceKey);
        const generatedRowLookupInvalid = generatedRowValue.invalid === true;
        value = sourceIsExpression && generatedRowExpressionProjectionLimited
          ? undefined
          : sourceIsExpression
          ? resolveRuntimeTokenValue(
              safeEvalExpression(sourceKey.slice(1, -1), { mockData, props: expressionProps }),
              expressionProps,
              mockData,
            )
          : usesCollectionDetails
            ? (() => {
                const detailValue = resolveOwnBindingEntry(collectionDetailsProps, sourceKey);
                if (detailValue.found) return detailValue.value;
                if (generatedRowLookupInvalid) return undefined;
                return generatedRowValue.found ? generatedRowValue.value : resolveMockValue(sourceKey, mockData);
              })()
            : generatedRowLookupInvalid
              ? undefined
              : generatedRowValue.found
                ? generatedRowValue.value
                : resolveMockValue(sourceKey, mockData);
      }
      if (value === undefined) {
        // Missing runtime data must not leave visibility at an optimistic schema
        // default or a progress image fully drawn. Preserve an unresolved
        // marker for visibility gates and collapse unresolved clip ratios to
        // zero; unrelated properties retain their authored value.
        markUnresolvedRuntimeProperty(out, targetProp);
        stats.bindingsSkipped += 1;
        continue;
      }
      out[targetProp] = coerceValueForProp(targetProp, value);
      Object.assign(outcome, { status: 'applied', reason: 'APPLIED' });
      stats.bindingsApplied += 1;
    }

    propsById[id] = out;
  }

  // Resolve authored runtime gates too. In particular ignored:'#missing'
  // must not be truthy and erase descendant diagnostics as a hidden branch.
  for (const [id, props] of Object.entries(propsById)) {
    const scope = { ...lexicalVariablesById[id], ...props };
    for (const target of ['visible', 'enabled', 'focus_enabled', 'ignored', 'toggle_state']) {
      const value = props[target];
      if (typeof value !== 'string' || value === UNRESOLVED_RUNTIME_VISIBILITY) continue;
      const token = value.trim();
      if (!/^[#$][A-Za-z0-9_:@.\-]+$/u.test(token) && !(token.startsWith('(') && token.endsWith(')'))) continue;
      const resolved = token.startsWith('(')
        ? safeEvalExpression(token.slice(1, -1), { props: scope, mockData })
        : resolveRuntimeTokenValue(token, scope, mockData);
      props[target] = resolved === undefined ? UNRESOLVED_RUNTIME_VISIBILITY : coerceValueForProp(target, resolved);
    }
  }

  // Native local state is computed once per instance before view propagation.
  // A base property_bag true is not the checked state of every radio.
  const localToggle = initializeLocalToggleState(uiModel, {
    propsById, lexicalVariablesById,
    uiInstanceId: options.uiInstanceId || 'static-preview',
    localToggleState: options.localToggleState,
  });
  for (const [id, value] of Object.entries(localToggle.overrides)) {
    if (propsById[id]) propsById[id].toggle_state = value;
  }

  // Pass 2: view bindings. A single tree-order pass is not sufficient for
  // Vanilla chains (A reads B, B reads C), and made the result depend on JSON
  // insertion order. Evaluate a bounded, snapshot-based fixed point instead.
  const viewEntries = [];
  let truncatedViewBindings = 0;
  for (const id of Object.keys(nodeById).sort()) {
    const node = nodeById[id];
    const bindings = Array.isArray(node.bindings) ? node.bindings : [];
    for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
      const binding = bindings[bindingIndex];
      if (normalizeBindingType(binding) !== 'view' || !shouldApplyBinding(binding)) continue;
      if (viewEntries.length >= maxViewBindings) {
        const outcome = bindingOutcomes.get(`${id}:${bindingIndex}`);
        if (outcome) outcome.reason = 'BUDGET';
        truncatedViewBindings += 1;
        const targetProp = normalizeTargetProp(binding.target_property_name || binding.binding_name_override);
        markUnresolvedRuntimeProperty(propsById[id], targetProp);
        continue;
      }
      viewEntries.push({ id, binding, bindingIndex, key: `${id}:${bindingIndex}` });
    }
  }
  if (truncatedViewBindings > 0) {
    warnings.push(`VIEW_BINDING_BUDGET_EXCEEDED:maxViewBindings=${maxViewBindings}:truncated=${truncatedViewBindings}`);
    stats.bindingsSkipped += truncatedViewBindings;
  }

  const warned = new Set();
  const warnOnce = (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(message);
  };
  const appliedViewKeys = new Set();
  const skippedViewKeys = new Set();
  const resolvedViewTargetKeys = new Set();
  const sourceFailuresByBindingKey = new Map();
  const sourceNodeIdsByBindingKey = new Map();
  const finalSourceNodeIdByBindingKey = new Map();
  const finalSourceResolutionByBindingKey = new Map();
  // Snapshot evaluation needs one propagation pass per edge in the longest
  // acyclic chain, plus one pass to observe convergence. Bound that by the
  // existing operation budget instead of an unrelated 16-pass ceiling.
  const maxViewPasses = Math.max(1, Math.min(
    viewEntries.length + 1,
    Math.floor(maxViewBindingOperations / Math.max(1, viewEntries.length)),
  ));
  const preViewTargets = new Map();
  const preViewTargetsByNodeId = new Map();
  for (const { id, binding } of viewEntries) {
    const targetProp = normalizeTargetProp(binding.target_property_name || binding.binding_name_override);
    if (!targetProp) continue;
    const targetKey = `${id}\u0000${targetProp}`;
    if (preViewTargets.has(targetKey)) continue;
    const props = propsById[id] || {};
    const target = {
      id,
      targetProp,
      present: Object.prototype.hasOwnProperty.call(props, targetProp),
      value: props[targetProp],
    };
    preViewTargets.set(targetKey, target);
    if (!preViewTargetsByNodeId.has(id)) preViewTargetsByNodeId.set(id, []);
    preViewTargetsByNodeId.get(id).push(target);
  }
  let converged = viewEntries.length === 0;
  let cycleDetected = false;
  let bindingOperations = 0;

  for (let pass = 0; pass < maxViewPasses && viewEntries.length; pass += 1) {
    const pending = [];

    for (const entry of viewEntries) {
      bindingOperations += 1;
      if (bindingOperations > maxViewBindingOperations) {
        cycleDetected = true;
        warnOnce(
          'view-operation-budget',
          `VIEW_BINDING_BUDGET_EXCEEDED:maxViewBindingOperations=${maxViewBindingOperations}`,
        );
        break;
      }
      const { id, binding: b, key } = entry;
      const targetProp = normalizeTargetProp(b.target_property_name || b.binding_name_override);
      if (!isNodeDefinitelyActive(
        id,
        propsById,
        parentById,
        potentialViewBindingTargetsById,
        bindingMetadataCompleteById,
        resolvedViewTargetKeys,
        { allowSelfIgnoredTarget: targetProp === 'ignored' },
      )) {
        sourceFailuresByBindingKey.delete(key);
        skippedViewKeys.add(key);
        continue;
      }
      if (!targetProp) {
        warnOnce(`target:${key}`, `VIEW_BINDING_TARGET_MISSING:${id}:${entry.bindingIndex}`);
        skippedViewKeys.add(key);
        continue;
      }

      const rawSourceName = typeof b.source_control_name === 'string' ? b.source_control_name.trim() : '';
      const sourceName = resolveViewSourceControlName(
        rawSourceName,
        { ...(propsById[id] || {}), ...(lexicalVariablesById[id] || {}) },
        mockData,
      );
      // A view binding without source_control_name reads the current control.
      // Vanilla uses this form for local property-bag expressions. Treating it
      // as a missing source hides valid inventory/server-form state branches.
      const source = rawSourceName && sourceName
        ? resolveSourceNodeId({
            currentId: id,
            sourceLocalName: sourceName,
            resolveSiblingScope: Boolean(b.resolve_sibling_scope),
            childrenById,
            parentById,
            localNameById,
            idsByLocalName,
            propsById,
            isCandidateActive: (candidateId) => isNodeDefinitelyActive(
              candidateId,
              propsById,
              parentById,
              potentialViewBindingTargetsById,
              bindingMetadataCompleteById,
              resolvedViewTargetKeys,
              { sourceCallerId: id, sourceCallerTarget: targetProp },
            ),
          })
        : rawSourceName
          ? { id: null, ambiguous: false, candidates: [] }
          : { id, ambiguous: false, candidates: [id], resolution: 'self' };
      if (!source.id) {
        finalSourceNodeIdByBindingKey.delete(key);
        finalSourceResolutionByBindingKey.delete(key);
        const code = source.ambiguous ? 'VIEW_SOURCE_AMBIGUOUS' : 'VIEW_SOURCE_UNRESOLVED';
        sourceFailuresByBindingKey.set(key, {
          code,
          message: `${code}:${id}:${sourceName || rawSourceName}${source.candidates.length ? `:${source.candidates.join(',')}` : ''}`,
        });
        pending.push({ id, targetProp, value: unresolvedRuntimeFallback(targetProp), unresolved: true, key });
        continue;
      }
      sourceFailuresByBindingKey.delete(key);
      finalSourceNodeIdByBindingKey.set(key, source.id);
      finalSourceResolutionByBindingKey.set(key, source.resolution);
      if (!sourceNodeIdsByBindingKey.has(key)) sourceNodeIdsByBindingKey.set(key, new Set());
      sourceNodeIdsByBindingKey.get(key).add(source.id);

      // Updates are applied only after every entry in this pass has been read,
      // so propsById itself is a stable snapshot without cloning the full tree.
      const sourceProps = propsById[source.id] || {};
      const viewExpressionProps = { ...sourceProps, ...(lexicalVariablesById[id] || {}) };
      const rawSourceProp = typeof b.source_property_name === 'string' ? b.source_property_name.trim() : '';
      if (!rawSourceProp) {
        warnOnce(`source-prop:${key}`, `VIEW_BINDING_SOURCE_PROPERTY_MISSING:${id}:${entry.bindingIndex}`);
        pending.push({ id, targetProp, value: unresolvedRuntimeFallback(targetProp), unresolved: true, key });
        continue;
      }

      let value;
      if (rawSourceProp.startsWith('(') && rawSourceProp.endsWith(')')) {
        value = resolveRuntimeTokenValue(
          safeEvalExpression(rawSourceProp.slice(1, -1), {
            mockData,
            props: viewExpressionProps,
            allowMockFallback: false,
          }),
          viewExpressionProps,
          mockData,
          8,
          false,
        );
      } else {
        const propKey = normalizeTargetProp(rawSourceProp) || rawSourceProp;
        const normalizedEntry = resolveExactOwnDataEntry(sourceProps, propKey);
        const rawEntry = normalizedEntry.found || normalizedEntry.invalid
          ? { found: false, value: undefined, invalid: false }
          : resolveExactOwnDataEntry(sourceProps, rawSourceProp);
        const sourceEntry = normalizedEntry.found || normalizedEntry.invalid
          ? normalizedEntry
          : rawEntry;
        value = sourceEntry.invalid
          ? undefined
          : resolveRuntimeTokenValue(sourceEntry.value, sourceProps, mockData, 8, false);
      }

      if (value === undefined) {
        pending.push({ id, targetProp, value: unresolvedRuntimeFallback(targetProp), unresolved: true, key });
      } else {
        pending.push({ id, targetProp, value: coerceValueForProp(targetProp, value), unresolved: false, key });
      }
    }

    if (bindingOperations > maxViewBindingOperations) break;

    const finalUpdateByTarget = new Map();
    for (const update of pending) {
      if (update.unresolved && !hasUnresolvedRuntimeFallback(update.targetProp)) {
        skippedViewKeys.add(update.key);
      } else if (update.unresolved) {
        appliedViewKeys.delete(update.key);
        skippedViewKeys.add(update.key);
      } else {
        appliedViewKeys.add(update.key);
        skippedViewKeys.delete(update.key);
      }
      // Bedrock resolves duplicate targets in declaration order. Collapse to
      // the last descriptor before comparing pass start/end state so an
      // overwritten intermediate value cannot fake a cycle.
      finalUpdateByTarget.set(`${update.id}\u0000${update.targetProp}`, update);
    }

    let changed = false;
    for (const update of finalUpdateByTarget.values()) {
      const resolvedTargetKey = `${update.id}\u0000${update.targetProp}`;
      const wasResolved = resolvedViewTargetKeys.has(resolvedTargetKey);
      if (update.unresolved) resolvedViewTargetKeys.delete(resolvedTargetKey);
      else resolvedViewTargetKeys.add(resolvedTargetKey);
      if (wasResolved !== !update.unresolved) changed = true;
      if (update.unresolved && !hasUnresolvedRuntimeFallback(update.targetProp)) continue;
      propsById[update.id] = propsById[update.id] || {};
      const current = propsById[update.id][update.targetProp];
      if (!valuesEqual(current, update.value)) {
        propsById[update.id][update.targetProp] = update.value;
        changed = true;
      }
    }

    if (!changed) {
      converged = true;
      break;
    }
  }

  if (converged) {
    stats.bindingsApplied += appliedViewKeys.size;
    stats.bindingsSkipped += Math.max(0, viewEntries.length - appliedViewKeys.size);
  } else {
    // Never expose an arbitrary last iteration. Visibility-affecting targets
    // fail closed; other properties return to their exact pre-view value.
    for (const target of preViewTargets.values()) {
      propsById[target.id] = propsById[target.id] || {};
      if (isRuntimeVisibilityProperty(target.targetProp) || isRuntimeStateProperty(target.targetProp)) {
        propsById[target.id][target.targetProp] = UNRESOLVED_RUNTIME_VISIBILITY;
      } else if (isRuntimeClipRatioProperty(target.targetProp)) {
        propsById[target.id][target.targetProp] = 0;
      } else if (target.present) {
        propsById[target.id][target.targetProp] = target.value;
      } else {
        delete propsById[target.id][target.targetProp];
      }
    }
    stats.bindingsSkipped += viewEntries.length;
    warnings.push(cycleDetected
      ? 'VIEW_BINDING_CYCLE_OR_NONCONVERGENT:cycle_or_budget'
      : `VIEW_BINDING_CYCLE_OR_NONCONVERGENT:limit=${maxViewPasses}`);
  }

  // `collection_details` selects a row before global/view bindings are
  // evaluated. If one of those bindings changes an owning collection name or
  // index, retaining values copied from the old row is silently incorrect.
  // Re-evaluating only once is also unsafe because row data can switch the
  // context back and forth. Until that engine-owned outer fixed point can be
  // reproduced, fail closed: restore all view targets and affected authored
  // properties, remove the stale row namespace, and emit one bounded warning.
  const changedCollectionContextIds = [];
  for (const [id, initialContext] of collectionDetailsContextByNodeId) {
    const detailBinding = (Array.isArray(nodeById[id]?.bindings) ? nodeById[id].bindings : [])
      .find((binding) => normalizeBindingType(binding) === 'collection_details'
        && shouldApplyBinding(binding)
        && !(typeof binding.binding_collection_prefix === 'string' && binding.binding_collection_prefix.trim()));
    if (!detailBinding) continue;
    const currentContext = resolveCollectionDetailsContext({
      lexicalVariablesById,
      currentId: id,
      binding: detailBinding,
      currentProps: { ...(lexicalVariablesById[id] || {}), ...(propsById[id] || {}) },
      collectionData: collectionDataById[id] || collectionData,
      nodeById,
      parentById,
      propsById,
      mockData,
      unscopedGridCollectionNamesById,
      collectionScopeScanTruncated,
      contextOnly: true,
    }).context || null;
    const initialName = initialContext && typeof initialContext.name === 'string' ? initialContext.name : '';
    const currentName = currentContext && typeof currentContext.name === 'string' ? currentContext.name : '';
    const initialIndex = initialContext && Number.isInteger(initialContext.index) ? initialContext.index : -1;
    const currentIndex = currentContext && Number.isInteger(currentContext.index) ? currentContext.index : -1;
    if (initialName !== currentName || initialIndex !== currentIndex) changedCollectionContextIds.push(id);
  }
  if (changedCollectionContextIds.length > 0) {
    // Only values in the changed collection branch, and view bindings that
    // transitively read that branch, are stale. Rolling back every view target
    // on the screen erased unrelated resolved state (for example chat/book
    // controls living beside a dynamic collection).
    const affectedNodeIds = new Set(changedCollectionContextIds);
    for (const changedId of changedCollectionContextIds) {
      let cursor = parentById[changedId] || '';
      for (let depth = 0; cursor && depth < 64; depth += 1) {
        const currentProps = propsById[cursor] || {};
        const changedTarget = (preViewTargetsByNodeId.get(cursor) || []).some((target) => {
          const present = Object.prototype.hasOwnProperty.call(currentProps, target.targetProp);
          return present !== target.present || (present && !valuesEqual(currentProps[target.targetProp], target.value));
        });
        if (changedTarget) affectedNodeIds.add(cursor);
        cursor = parentById[cursor] || '';
      }
    }
    let expanded = true;
    for (let pass = 0; expanded && pass <= viewEntries.length; pass += 1) {
      expanded = false;
      for (const entry of viewEntries) {
        const sources = sourceNodeIdsByBindingKey.get(entry.key);
        if (!sources || affectedNodeIds.has(entry.id)) continue;
        if ([...sources].some((sourceId) => affectedNodeIds.has(sourceId))) {
          affectedNodeIds.add(entry.id);
          expanded = true;
        }
      }
    }

    for (const target of preViewTargets.values()) {
      if (!affectedNodeIds.has(target.id)) continue;
      propsById[target.id] = propsById[target.id] || {};
      if (isRuntimeVisibilityProperty(target.targetProp) || isRuntimeStateProperty(target.targetProp)) {
        propsById[target.id][target.targetProp] = UNRESOLVED_RUNTIME_VISIBILITY;
      } else if (isRuntimeClipRatioProperty(target.targetProp)) {
        propsById[target.id][target.targetProp] = 0;
      } else if (target.present) {
        propsById[target.id][target.targetProp] = target.value;
      } else {
        delete propsById[target.id][target.targetProp];
      }
    }
    for (const id of changedCollectionContextIds) {
      const props = propsById[id] || (propsById[id] = {});
      const authored = collectionDetailsAuthoredPropsByNodeId.get(id) || {};
      for (const targetProp of collectionDetailsGlobalTargetsByNodeId.get(id) || []) {
        if (Object.prototype.hasOwnProperty.call(authored, targetProp)) props[targetProp] = authored[targetProp];
        else delete props[targetProp];
      }
      delete props.__jsonui_preview_collection_details;
    }
    if (converged) {
      let rolledBackViewBindings = 0;
      for (const entry of viewEntries) {
        if (affectedNodeIds.has(entry.id) && appliedViewKeys.has(entry.key)) rolledBackViewBindings += 1;
      }
      stats.bindingsApplied = Math.max(0, stats.bindingsApplied - rolledBackViewBindings);
      stats.bindingsSkipped += rolledBackViewBindings;
    }
    for (const targetKey of [...resolvedViewTargetKeys]) {
      const separator = targetKey.indexOf('\u0000');
      const targetId = separator >= 0 ? targetKey.slice(0, separator) : targetKey;
      if (affectedNodeIds.has(targetId)) resolvedViewTargetKeys.delete(targetKey);
    }
    warnings.push(`COLLECTION_CONTEXT_RUNTIME_DEPENDENT:count=${changedCollectionContextIds.length}`);
  }

  // Candidate activity itself can be view-bound. Delay source diagnostics
  // until the fixed point is known so an inactive duplicate branch seen in an
  // early pass does not leave a stale ambiguity warning after it collapses.
  for (const [key, failure] of sourceFailuresByBindingKey) {
    warnOnce(`${failure.code}:${key}`, failure.message);
  }

  for (const [id, warning] of unprefixedCollectionDetailsWarningsByNodeId) {
    if (!isNodeDefinitelyInactiveForDiagnostics(
      id,
      propsById,
      parentById,
      potentialViewBindingTargetsById,
      bindingMetadataCompleteById,
      resolvedViewTargetKeys,
    )) warnings.push(warning);
  }
  for (const [id, warning] of localCollectionContextWarningsByNodeId) {
    if (!isNodeDefinitelyInactiveForDiagnostics(id, propsById, parentById,
      potentialViewBindingTargetsById, bindingMetadataCompleteById,
      resolvedViewTargetKeys)) warnings.push(warning);
  }

  let activePrefixedCollectionDetails = 0;
  for (const [id, count] of prefixedCollectionDetailsByNodeId) {
    if (!isNodeDefinitelyInactiveForDiagnostics(
      id,
      propsById,
      parentById,
      potentialViewBindingTargetsById,
      bindingMetadataCompleteById,
      resolvedViewTargetKeys,
    )) activePrefixedCollectionDetails += count;
  }
  if (activePrefixedCollectionDetails > 0) {
    warnings.push(`COLLECTION_DETAILS_PREFIX_RUNTIME_DEPENDENT:count=${activePrefixedCollectionDetails}`);
  }

  // Preserve descriptor outcomes independently from aggregate skip counts.
  // A hidden ancestor is excluded only after the final fixed point is known.
  for (const entry of viewEntries) {
    const outcome = bindingOutcomes.get(entry.key);
    if (!outcome) continue;
    const failure = sourceFailuresByBindingKey.get(entry.key);
    const sourceNodeId = finalSourceNodeIdByBindingKey.get(entry.key);
    if (sourceNodeId) outcome.sourceNodeId = sourceNodeId;
    const sourceResolution = finalSourceResolutionByBindingKey.get(entry.key);
    if (sourceResolution) outcome.sourceResolution = sourceResolution;
    outcome.targetProperty = normalizeTargetProp(entry.binding.target_property_name || entry.binding.binding_name_override) || '';
    if (!converged) Object.assign(outcome, { status: 'unresolved', reason: bindingOperations > maxViewBindingOperations ? 'BUDGET' : 'CYCLE_OR_NONCONVERGENT' });
    else if (failure) Object.assign(outcome, { status: 'unresolved', reason: failure.code === 'VIEW_SOURCE_AMBIGUOUS' ? 'SOURCE_AMBIGUOUS' : 'SOURCE_UNRESOLVED' });
    else if (appliedViewKeys.has(entry.key)) Object.assign(outcome, { status: 'applied', reason: 'APPLIED' });
    else Object.assign(outcome, { status: 'unresolved', reason: outcome.targetProperty ? 'PROPERTY_UNRESOLVED' : 'TARGET_MISSING' });
  }
  const diagnostics = [];
  // Reaching an evaluation limit is not a complete observation, even when
  // every binding in the subset we visited happened to resolve.
  let observationCaptureComplete = localToggle.complete && stack.length === 0 && nativeIndexWarnings <= 256
    && !collectionScopeScanTruncated && truncatedViewBindings === 0
    && bindingOperations <= maxViewBindingOperations
    && !warnings.some(value => /^(?:LEXICAL_VARIABLE(?:_BRANCH)?_BUDGET_EXCEEDED|PROPERTY_BAG_BUDGET_EXCEEDED|NESTED_COLLECTION_(?:NAME|MAP)_LIMIT|FACTORY_ROW_(?:TOKEN_SCAN|EXPRESSION_REF)_LIMIT):?/.test(value));
  const inactive = id => isNodeDefinitelyInactiveForDiagnostics(id, propsById, parentById, potentialViewBindingTargetsById, bindingMetadataCompleteById, resolvedViewTargetKeys);
  for (const outcome of bindingOutcomes.values()) {
    if (diagnostics.length >= 50_000) { observationCaptureComplete = false; break; }
    diagnostics.push(outcome.status === 'unresolved' && inactive(outcome.nodeId)
      ? { ...outcome, status: 'inactive', reason: 'DEFINITE_HIDDEN', originalReason: outcome.reason } : outcome);
  }
  const localToggleDiagnostics = localToggle.diagnostics.map(item => ({ ...item,
    status: !['STATE_NODE_UNKNOWN', 'STATE_NODE_READONLY', 'STATE_NODE_DIAGNOSTIC_LIMIT'].includes(item.reason)
      && inactive(item.nodeId) ? 'inactive' : 'unresolved' }));
  for (const item of localToggleDiagnostics) {
    if (diagnostics.length >= 50_000) { observationCaptureComplete = false; break; }
    diagnostics.push({ nodeId: item.nodeId, bindingIndex: -1, bindingType: 'local_toggle', targetProperty: 'toggle_state', status: item.status, reason: item.status === 'inactive' ? 'DEFINITE_HIDDEN' : 'LOCAL_STATE_UNRESOLVED', localReason: item.reason });
  }
  const diagnosedTargets = new Set(diagnostics.filter(item => item.status !== 'applied').map(item => `${item.nodeId}\u0000${item.targetProperty}`));
  implicitProperties: for (const [id, props] of Object.entries(propsById)) {
    for (const targetProperty of ['visible', 'enabled', 'focus_enabled', 'ignored', 'toggle_state']) {
      if (props[targetProperty] !== UNRESOLVED_RUNTIME_VISIBILITY || diagnosedTargets.has(`${id}\u0000${targetProperty}`)) continue;
      if (diagnostics.length >= 50_000) { observationCaptureComplete = false; break implicitProperties; }
      const hidden = inactive(id);
      diagnostics.push({ nodeId: id, bindingIndex: -1, bindingType: 'implicit_property', targetProperty, status: hidden ? 'inactive' : 'unresolved', reason: hidden ? 'DEFINITE_HIDDEN' : 'PROPERTY_UNRESOLVED' });
    }
  }
  const globalFallbacks = diagnostics.filter(row => row.status === 'applied'
    && row.sourceResolution === 'global_fallback' && !inactive(row.nodeId));
  if (globalFallbacks.length) warnings.push(`VIEW_SOURCE_GLOBAL_FALLBACK:count=${globalFallbacks.length}:native_scope_unverified=true`);
  return { propsById, stats, warnings, diagnostics, localToggleState: localToggle.state, localToggleDiagnostics, observationCaptureComplete };
}

const UNRESOLVED_RUNTIME_VISIBILITY = '#__jsonui_unresolved_runtime_visibility__';

function isRuntimeVisibilityProperty(targetProp) {
  const key = String(targetProp || '').trim().toLowerCase();
  return key === 'visible' || key === 'enabled' || key === 'ignored' || key === 'focus_enabled';
}

function isRuntimeClipRatioProperty(targetProp) {
  return String(targetProp || '').trim().toLowerCase() === 'clip_ratio';
}

function isRuntimeStateProperty(targetProp) {
  return String(targetProp || '').trim().toLowerCase() === 'toggle_state';
}

function hasUnresolvedRuntimeFallback(targetProp) {
  return isRuntimeVisibilityProperty(targetProp) || isRuntimeClipRatioProperty(targetProp) || isRuntimeStateProperty(targetProp);
}

function unresolvedRuntimeFallback(targetProp) {
  if (isRuntimeVisibilityProperty(targetProp)) return UNRESOLVED_RUNTIME_VISIBILITY;
  if (isRuntimeClipRatioProperty(targetProp)) return 0;
  if (isRuntimeStateProperty(targetProp)) return UNRESOLVED_RUNTIME_VISIBILITY;
  return undefined;
}

/**
 * Mark visibility/state gates and progress clipping. Other unresolved bindings
 * retain their authored/default value because substituting a synthetic
 * texture/text value would be more misleading than leaving it unchanged.
 * @param {Record<string, any>} out
 * @param {string|null} targetProp
 */
function markUnresolvedRuntimeProperty(out, targetProp) {
  if (!out || typeof out !== 'object') return;
  const key = String(targetProp || '').trim().toLowerCase();
  if (!hasUnresolvedRuntimeFallback(key)) return;
  out[key] = unresolvedRuntimeFallback(key);
}

/**
 * @param {UiBinding} b
 */
function shouldApplyBinding(b) {
  if (!b || typeof b !== 'object') return false;
  if (b.ignored === true) return false;
  // `binding_condition` controls when Minecraft refreshes a binding. A static
  // preview evaluates every supported cadence once, including `none`; it is
  // not a switch that disables the descriptor. `binding_type:"none"` remains
  // inactive through normalizeBindingType().
  return true;
}

function resolveViewSourceControlName(rawValue, props, mockData) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw) return '';
  let resolved = raw;
  if (raw.startsWith('(') && raw.endsWith(')')) {
    resolved = safeEvalExpression(raw.slice(1, -1), {
      mockData,
      props,
      allowMockFallback: false,
    });
  } else if (raw.startsWith('(') || raw.endsWith(')')) {
    return '';
  } else {
    resolved = resolveRuntimeTokenValue(raw, props, mockData);
  }
  if (typeof resolved !== 'string') return '';
  const name = resolved.trim();
  if (!name || name.length > 256 || !/^[A-Za-z0-9_:@.\-]+$/u.test(name)) return '';
  if (['__proto__', 'prototype', 'constructor'].includes(name.toLowerCase())) return '';
  return name;
}

function isNodeDefinitelyActive(
  nodeId,
  propsById,
  parentById,
  potentialViewBindingTargetsById,
  bindingMetadataCompleteById,
  resolvedViewTargetKeys,
  { allowSelfIgnoredTarget = false, sourceCallerId = '', sourceCallerTarget = '' } = {},
) {
  let cursor = String(nodeId || '');
  for (let depth = 0; cursor && depth < 64; depth += 1) {
    const props = propsById[cursor] || {};
    const metadataComplete = bindingMetadataCompleteById[cursor] === true;
    const potentialViewTargets = potentialViewBindingTargetsById[cursor];
    const hasPotentialViewOverride = (target) => !metadataComplete
      || (potentialViewTargets instanceof Set
        && potentialViewTargets.has(target)
        && !(resolvedViewTargetKeys instanceof Set && resolvedViewTargetKeys.has(`${cursor}\u0000${target}`)));
    if (!(allowSelfIgnoredTarget && depth === 0)
      && !hasPotentialViewOverride('ignored') && Object.prototype.hasOwnProperty.call(props, 'ignored')
      && toBoolean(props.ignored) === true) return false;
    // A source control may intentionally expose its own false visibility as
    // state, so only an inactive ancestor removes the candidate. `ignored`
    // is structural and can exclude the source itself.
    // The caller may read a child's state to compute its own visibility.
    // Its previous visibility must not remove that very source and make the
    // source alternate between present and absent. Other inactive ancestors
    // and structural ignored controls still exclude the candidate.
    const callerControlsVisibility = cursor === sourceCallerId && sourceCallerTarget === 'visible';
    if (depth > 0 && !callerControlsVisibility && !hasPotentialViewOverride('visible') && Object.prototype.hasOwnProperty.call(props, 'visible')
      && props.visible !== UNRESOLVED_RUNTIME_VISIBILITY && toBoolean(props.visible) === false) return false;
    cursor = parentById[cursor] || '';
  }
  return true;
}

function isNodeDefinitelyInactiveForDiagnostics(
  nodeId,
  propsById,
  parentById,
  potentialViewBindingTargetsById,
  bindingMetadataCompleteById,
  resolvedViewTargetKeys,
) {
  let cursor = String(nodeId || '');
  for (let depth = 0; cursor && depth < 64; depth += 1) {
    const props = propsById[cursor] || {};
    const metadataComplete = bindingMetadataCompleteById[cursor] === true;
    const potentialViewTargets = potentialViewBindingTargetsById[cursor];
    const hasUnresolvedViewOverride = (target) => !metadataComplete
      || (potentialViewTargets instanceof Set
        && potentialViewTargets.has(target)
        && !(resolvedViewTargetKeys instanceof Set && resolvedViewTargetKeys.has(`${cursor}\u0000${target}`)));
    if (!hasUnresolvedViewOverride('ignored')
      && Object.prototype.hasOwnProperty.call(props, 'ignored')
      && props.ignored !== UNRESOLVED_RUNTIME_VISIBILITY
      && toBoolean(props.ignored) === true) return true;
    // A control with its own visible=false may still expose state to an active
    // sibling view binding. Only an inactive ancestor proves this diagnostic
    // branch unreachable.
    if (depth > 0 && !hasUnresolvedViewOverride('visible')
      && Object.prototype.hasOwnProperty.call(props, 'visible')
      && props.visible !== UNRESOLVED_RUNTIME_VISIBILITY
      && toBoolean(props.visible) === false) return true;
    cursor = parentById[cursor] || '';
  }
  return false;
}

/**
 * @param {UiBinding} b
 * @returns {'global'|'view'|'collection'|'collection_details'|'none'|'dynamic'|'other'}
 */
function normalizeBindingType(b) {
  if (!b || typeof b !== 'object') return 'other';
  const ownType = Object.prototype.hasOwnProperty.call(b, 'binding_type');
  const rawType = Object.prototype.hasOwnProperty.call(b.unknown_fields || {}, 'binding_type');
  const value = ownType ? b.binding_type : (rawType ? b.unknown_fields.binding_type : undefined);
  return classifyUiBindingType(value, ownType || rawType);
}

/** 評価モデル内の出所を有界で記録し、任意のオブジェクトは展開しない。 */
function describeUnsupportedBindingType(b) {
  const value = Object.prototype.hasOwnProperty.call(b, 'binding_type')
    ? b.binding_type : b.unknown_fields?.binding_type;
  return describeUiBindingType(value);
}

/**
 * Normalize a binding target property string (often prefixed with '#').
 * @param {string|undefined|null} s
 * @returns {string|null}
 */
function normalizeTargetProp(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  // Typical Bedrock UI uses '#visible', '#text', '#texture', ...
  const normalized = t.startsWith('#') || t.startsWith('$') ? t.slice(1) : t;
  if (['__proto__', 'prototype', 'constructor'].includes(normalized.toLowerCase())) return null;
  return normalized || null;
}

/**
 * Resolve a mock value by trying a few flexible key patterns.
 * @param {string} key
 * @param {Record<string, any>} mockData
 */
function resolveMockValue(key, mockData) {
  if (!key) return undefined;
  if (!mockData || typeof mockData !== 'object') return undefined;

  const candidates = [key];
  if (key.startsWith('#') || key.startsWith('$')) candidates.push(key.slice(1));
  if (!key.startsWith('#')) candidates.push(`#${key}`);
  // Global mock data follows the same own-data rule as collection rows.
  // An accessor or an explicit undefined shadows aliases without executing it.
  for (const candidate of candidates) {
    const entry = resolveExactOwnDataEntry(mockData, candidate);
    if (entry.invalid) return undefined;
    if (entry.found) return entry.value;
  }

  return undefined;
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

function resolveOwnBindingValue(record, sourceKey) {
  const result = resolveOwnBindingEntry(record, sourceKey);
  return result.found ? result.value : undefined;
}

function resolveOwnBindingEntry(record, sourceKey) {
  const raw = String(sourceKey || '').trim();
  if (!raw) return { found: false, value: undefined, invalid: false };
  if (!record || typeof record !== 'object') {
    return { found: false, value: undefined, invalid: false };
  }
  for (const key of [raw, raw.replace(/^[#$]/u, '')]) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (descriptor && !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return { found: false, value: undefined, invalid: true };
      }
      if (descriptor) {
        return { found: true, value: descriptor.value };
      }
    } catch {
      return { found: false, value: undefined, invalid: true };
    }
  }
  return { found: false, value: undefined, invalid: false };
}

function resolveExactOwnDataEntry(record, key) {
  if (!record || typeof record !== 'object') {
    return { found: false, value: undefined, invalid: false };
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return { found: false, value: undefined, invalid: false };
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return { found: false, value: undefined, invalid: true };
    }
    return { found: true, value: descriptor.value, invalid: false };
  } catch {
    return { found: false, value: undefined, invalid: true };
  }
}

function resolveGridDimensions(props, mockData, generatedRow = null) {
  const authoredDimensions = readOwnDataValue(props, 'grid_dimensions');
  if (Array.isArray(authoredDimensions)) return authoredDimensions;

  const rawBinding = readOwnDataValue(props, 'grid_dimension_binding');
  const dimensionBinding = typeof rawBinding === 'string' ? rawBinding.trim() : '';
  if (!dimensionBinding) return null;

  const resolved = resolveScopedRuntimeTokenValue(
    dimensionBinding,
    props,
    generatedRow,
    mockData,
  );
  return Array.isArray(resolved) ? resolved : null;
}

function readCollectionRow(collectionData, collectionName, collectionIndex) {
  const scoped = readOwnDataValue(collectionData, collectionName);
  if (!Array.isArray(scoped) && (!scoped || typeof scoped !== 'object')) {
    return { row: null, warning: scoped === undefined ? null : `COLLECTION_DATA_INVALID:${collectionName}` };
  }
  const row = readOwnDataValue(scoped, String(collectionIndex));
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { row: null, warning: null };
  return { row, warning: null };
}

function projectGeneratedRowExpressionProps(
  currentProps,
  row,
  expressions,
  maximumRowReads,
) {
  const props = Object.create(null);
  const references = [];
  const seenReferences = new Set();
  const maximumReferences = 256;
  let limited = false;

  for (const rawExpression of expressions) {
    const expression = typeof rawExpression === 'string' ? rawExpression : '';
    if (!expression) continue;
    if (expression.length > 4096) {
      limited = true;
      continue;
    }
    let tokens;
    try {
      tokens = tokenizeExpr(expression);
    } catch {
      // safeEvalExpression will reject the same malformed expression. It must
      // not cause a broad row projection here.
      continue;
    }
    if (tokens.length > 1024) {
      limited = true;
      continue;
    }
    for (const token of tokens) {
      if (token.type !== 'ref') continue;
      const reference = String(token.value || '');
      if (!reference || seenReferences.has(reference)) continue;
      if (references.length >= maximumReferences) {
        limited = true;
        break;
      }
      seenReferences.add(reference);
      references.push(reference);
    }
  }

  const allowedReads = Number.isFinite(maximumRowReads)
    ? Math.max(0, Math.floor(maximumRowReads))
    : 0;
  let rowReads = 0;
  for (const reference of references) {
    let current = reference;
    const seenTokens = new Set();
    let usedRowEntry = false;
    const invalidateIncompleteRowAlias = () => {
      if (!usedRowEntry) return;
      props[reference] = undefined;
      if (reference.startsWith('#')) props[reference.slice(1)] = undefined;
    };
    for (let depth = 0; depth < 8; depth += 1) {
      if (typeof current !== 'string') break;
      const token = current.trim();
      if (!/^[#$][A-Za-z0-9_:@.\-]+$/u.test(token)) break;
      if (seenTokens.has(token)) {
        invalidateIncompleteRowAlias();
        break;
      }
      seenTokens.add(token);

      const rowFirst = token.startsWith('#');
      let local = { found: false, value: undefined, invalid: false };
      let rowEntry = { found: false, value: undefined, invalid: false };
      if (!rowFirst) local = resolveOwnBindingEntry(currentProps, token);
      if (rowFirst || (!local.found && !local.invalid)) {
        if (rowReads >= allowedReads) {
          limited = true;
          invalidateIncompleteRowAlias();
          break;
        }
        rowReads += 1;
        rowEntry = resolveOwnBindingEntry(row, token);
      }
      if (rowFirst && !rowEntry.found && !rowEntry.invalid) {
        local = resolveOwnBindingEntry(currentProps, token);
      }
      const preferredEntry = rowFirst ? rowEntry : local;
      const fallbackEntry = rowFirst ? local : rowEntry;
      if (preferredEntry.invalid || (!preferredEntry.found && fallbackEntry.invalid)) {
        limited = true;
        invalidateIncompleteRowAlias();
        break;
      }
      const entry = preferredEntry.found ? preferredEntry : fallbackEntry;
      if (entry.found) {
        if (entry === rowEntry) {
          usedRowEntry = true;
          props[token] = entry.value;
          if (token.startsWith('#')) props[token.slice(1)] = entry.value;
        }
        current = entry.value;
        if (
          depth === 7
          && typeof current === 'string'
          && /^[#$][A-Za-z0-9_:@.\-]+$/u.test(current.trim())
        ) {
          limited = true;
          invalidateIncompleteRowAlias();
        }
        continue;
      }
      invalidateIncompleteRowAlias();
      break;
    }
  }
  return { props, limited, rowReads };
}

function findCollectionIndex({
  lexicalVariablesById,
  currentId, collectionName, currentProps, nodeById, parentById, propsById,
  mockData, unscopedGridCollectionNamesById, collectionScopeScanTruncated = false,
  collectionData,
}) {
  const address = resolveCollectionRowAddress({
    currentId, collectionName,
    getNode: id => nodeById[id],
    getParentId: id => parentById[id],
    getProps: id => id === String(currentId) ? currentProps
      : { ...(lexicalVariablesById?.[id] || {}), ...(nodeById[id]?.unknownProps || {}), ...(nodeById[id]?.props || {}), ...(propsById[id] || {}) },
    resolveName: (name, props) => resolveCollectionName(name, props, mockData).name,
    resolveDimensions: props => resolveGridDimensions(props, mockData),
    unscopedGridInfo: id => readOwnDataValue(unscopedGridCollectionNamesById, id),
    collectionScopeScanTruncated,
  });
  return confirmCollectionRowAddress(address, readOwnDataValue(collectionData, collectionName));
}

function resolveCollectionDetailsContext({
  lexicalVariablesById,
  currentId,
  binding,
  currentProps,
  collectionData,
  nodeById,
  parentById,
  propsById,
  mockData,
  unscopedGridCollectionNamesById,
  collectionScopeScanTruncated,
  contextOnly = false,
}) {
  const rawName = typeof binding.binding_collection_name === 'string'
    ? binding.binding_collection_name.trim()
    : '';
  const inferredResolution = rawName ? null : findNearestCollectionContextName({
    currentId,
    currentProps,
    nodeById,
    parentById,
    propsById,
    mockData,
    unscopedGridCollectionNamesById,
    collectionScopeScanTruncated,
  });
  const resolution = rawName
    ? resolveCollectionName(rawName, currentProps, mockData)
    : inferredResolution || { name: '', status: 'unresolved' };
  if (resolution.status !== 'ok') {
    // Generic controls may include an optional collection-details descriptor
    // with no authored collection and no enclosing collection row. In that
    // exact shape there is nothing to bind; a non-empty, malformed, or
    // unresolved authored name remains diagnostic.
    if (!rawName && resolution.status === 'unresolved') return { props: null, warning: null, context: null };
    return {
      props: null,
      warning: `${resolution.status === 'invalid' ? 'COLLECTION_NAME_INVALID' : 'COLLECTION_NAME_UNRESOLVED'}:${String(currentId)}`,
      context: null,
    };
  }
  const collectionAddress = findCollectionIndex({
    lexicalVariablesById,
    currentId,
    collectionName: resolution.name,
    currentProps,
    nodeById,
    parentById,
    propsById,
    mockData,
    unscopedGridCollectionNamesById,
    collectionScopeScanTruncated,
    collectionData,
  });
  if (collectionAddress.status !== 'resolved') {
    return { props: null, warning: collectionAddress.warning, context: null };
  }
  const collectionIndex = collectionAddress.index;
  const context = Object.freeze({ name: resolution.name, index: collectionIndex });
  if (contextOnly) return { props: null, warning: null, context };
  const result = readCollectionRow(collectionData, resolution.name, collectionIndex);
  if (!result.row) return { props: null, warning: result.warning, context };

  const prefix = typeof binding.binding_collection_prefix === 'string'
    ? binding.binding_collection_prefix.trim()
    : '';
  if (prefix.length > 256 || /[\u0000-\u001f\u007f]/u.test(prefix)) {
    return { props: null, warning: `COLLECTION_PREFIX_INVALID:${String(currentId)}`, context };
  }
  const props = Object.create(null);
  let copied = 0;
  let inspected = 0;
  try {
    for (const rawKey in result.row) {
      inspected += 1;
      if (inspected > 512) {
        return { props: null, warning: `COLLECTION_DETAILS_BUDGET_EXCEEDED:${resolution.name}:max=512`, context };
      }
      if (!Object.prototype.hasOwnProperty.call(result.row, rawKey)) continue;
      if (copied >= 256) return { props: null, warning: `COLLECTION_DETAILS_BUDGET_EXCEEDED:${resolution.name}:max=256`, context };
      const descriptor = Object.getOwnPropertyDescriptor(result.row, rawKey);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
      const bare = rawKey.replace(/^[#$]/u, '');
      const target = normalizeTargetProp(prefix ? `${prefix}_${bare}` : bare);
      if (!target) continue;
      props[target] = descriptor.value;
      if (!prefix) props[`#${target}`] = descriptor.value;
      copied += 1;
    }
  } catch {
    return { props: null, warning: `COLLECTION_DATA_INVALID:${resolution.name}`, context };
  }
  return { props, warning: result.warning, context };
}

function findNearestCollectionContextName({
  currentId,
  currentProps,
  nodeById,
  parentById,
  propsById,
  mockData,
}) {
  let cursor = String(currentId || '');
  for (let depth = 0; cursor && depth < 64; depth += 1) {
    const node = nodeById[cursor];
    const props = cursor === String(currentId)
      ? currentProps
      : { ...(node?.unknownProps || {}), ...(node?.props || {}), ...(propsById[cursor] || {}) };
    const marker = typeof props?.__jsonui_preview_collection_name === 'string'
      ? props.__jsonui_preview_collection_name.trim()
      : '';
    const authored = typeof props?.collection_name === 'string' ? props.collection_name.trim() : '';
    if (depth > 0 && authored) {
      const resolved = resolveCollectionName(authored, props, mockData);
      return resolved;
    }
    if (marker && marker.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(marker)) {
      return { name: marker, status: 'ok' };
    }
    if (depth === 0 && authored) {
      const resolved = resolveCollectionName(authored, props, mockData);
      return resolved;
    }
    cursor = parentById[cursor] || '';
  }
  return { name: '', status: 'unresolved' };
}

function resolveCollectionBindingValue({
  lexicalVariablesById,
  currentId,
  binding,
  sourceKey,
  currentProps,
  collectionData,
  collectionNamesBySourceKey,
  collectionScopeScanTruncated,
  unscopedGridCollectionNamesById,
  nodeById,
  parentById,
  propsById,
  mockData,
  expressionReferenceBudget,
}) {
  const rawCollectionName = typeof binding.binding_collection_name === 'string'
    ? binding.binding_collection_name.trim()
    : '';
  const collectionResolution = resolveCollectionName(rawCollectionName, currentProps, mockData);
  if (rawCollectionName && collectionResolution.status !== 'ok') {
    return {
      value: undefined,
      warning: `${collectionResolution.status === 'invalid' ? 'COLLECTION_NAME_INVALID' : 'COLLECTION_NAME_UNRESOLVED'}:${String(currentId)}`,
    };
  }
  const collectionName = collectionResolution.name;

  if (collectionName && readOwnDataValue(collectionData, collectionName) !== undefined) {
    const collectionAddress = findCollectionIndex({
      lexicalVariablesById,
      currentId,
      collectionName,
      currentProps,
      nodeById,
      parentById,
      propsById,
      mockData,
      unscopedGridCollectionNamesById,
      collectionScopeScanTruncated,
      collectionData,
    });
    if (collectionAddress.status !== 'resolved') return { value: undefined, warning: collectionAddress.warning };
    const result = readCollectionRow(collectionData, collectionName, collectionAddress.index);
    if (!result.row) return { value: undefined, warning: result.warning };
    if (sourceKey.startsWith('(') && sourceKey.endsWith(')')) {
      const projection = projectGeneratedRowExpressionProps(
        currentProps,
        result.row,
        [sourceKey],
        expressionReferenceBudget?.remaining,
      );
      if (expressionReferenceBudget && typeof expressionReferenceBudget === 'object') {
        expressionReferenceBudget.remaining = Math.max(
          0,
          Number(expressionReferenceBudget.remaining || 0) - projection.rowReads,
        );
      }
      if (projection.limited) {
        return {
          value: undefined,
          warning: `COLLECTION_EXPRESSION_REF_LIMIT:${collectionName}`,
        };
      }
      const expressionProps = { ...currentProps, ...projection.props };
      const expressionValue = safeEvalExpression(sourceKey.slice(1, -1), {
        mockData,
        props: expressionProps,
        allowMockFallback: false,
      });
      // A collection expression can construct its binding name, as Vanilla
      // dropdowns do with ('#' + $dropdown_name). That token is absent from the
      // original expression's lexical references. Project only this exact
      // result token using the same own-data, alias-depth and shared read
      // budget; never flatten the row or fall back to global mock state.
      if (typeof expressionValue === 'string' && /^[#$][A-Za-z0-9_:@.\-]+$/u.test(expressionValue.trim())) {
        const resultProjection = projectGeneratedRowExpressionProps(
          expressionProps,
          result.row,
          [expressionValue.trim()],
          expressionReferenceBudget?.remaining,
        );
        if (expressionReferenceBudget && typeof expressionReferenceBudget === 'object') {
          expressionReferenceBudget.remaining = Math.max(
            0,
            Number(expressionReferenceBudget.remaining || 0) - resultProjection.rowReads,
          );
        }
        if (resultProjection.limited) {
          return { value: undefined, warning: `COLLECTION_EXPRESSION_REF_LIMIT:${collectionName}` };
        }
        return {
          value: resolveRuntimeTokenValue(expressionValue, { ...expressionProps, ...resultProjection.props }, mockData, 8, false),
          warning: result.warning,
        };
      }
      return {
        value: resolveRuntimeTokenValue(expressionValue, expressionProps, mockData, 8, false),
        warning: result.warning,
      };
    }
    return { value: resolveOwnBindingValue(result.row, sourceKey), warning: result.warning };
  }

  if (collectionScopeScanTruncated) {
    return { value: undefined, warning: 'COLLECTION_SCOPE_SCAN_BUDGET_EXCEEDED' };
  }

  const names = collectionNamesBySourceKey.get(normalizeCollectionSourceKey(sourceKey));
  const flatValue = resolveMockValue(sourceKey, mockData);
  if (flatValue !== undefined && names && names.size > 1) {
    return {
      value: undefined,
      warning: `COLLECTION_SCOPE_AMBIGUOUS:${sourceKey}:${Array.from(names).sort().join(',')}`,
    };
  }
  return { value: flatValue, warning: null };
}

function resolveCollectionName(rawValue, props, mockData) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw) return { name: '', status: 'absent' };

  // A leading `#` is part of several engine-owned collection names (for
  // example `#enchant_buttons`); it is not a property indirection. Reusable
  // templates also author bounded concatenation expressions such as
  // `($panel_prefix + _panel)`.
  let resolved;
  if (raw.startsWith('#')) {
    resolved = raw;
  } else if (raw.startsWith('(') && raw.endsWith(')')) {
    resolved = safeEvalExpression(raw.slice(1, -1), { mockData, props });
  } else if (raw.startsWith('(') || raw.endsWith(')')) {
    return { name: '', status: 'invalid' };
  } else {
    resolved = resolveRuntimeTokenValue(raw, props, mockData);
  }

  if (resolved === undefined) return { name: '', status: 'unresolved' };
  if (typeof resolved !== 'string') return { name: '', status: 'invalid' };
  const name = resolved.trim();
  if (!name || name.length > 512 || /[\u0000-\u001f\u007f]/u.test(name)) {
    return { name: '', status: 'invalid' };
  }
  return { name, status: 'ok' };
}

function normalizeCollectionSourceKey(value) {
  return String(value || '').trim().replace(/^[#$]/u, '');
}

/**
 * Apply light coercions for common props.
 * @param {string} prop
 * @param {any} value
 */
function coerceValueForProp(prop, value) {
  const p = String(prop || '').toLowerCase();
  if (p === 'visible' || p === 'enabled' || p === 'ignored') return toBoolean(value);
  return value;
}

function valuesEqual(a, b) {
  return Object.is(a, b);
}

/** @param {any} v */
function toBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (!s) return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return true;
  }
  return Boolean(v);
}

/**
 * Resolve the node id for a view-binding source_control_name.
 *
 * This is a best-effort resolver:
 * - If resolve_sibling_scope: look for a sibling under the same parent.
 * - Else: look for a direct child of the current node.
 * - Fallback: global lookup by local_name, explicitly labelled as a preview
 *   approximation. A declared local match prevents borrowing another branch.
 */
function resolveSourceNodeId({
  currentId,
  sourceLocalName,
  resolveSiblingScope,
  childrenById,
  parentById,
  localNameById,
  idsByLocalName,
  propsById,
  isCandidateActive,
}) {
  const want = String(sourceLocalName || '');
  if (!want) return { id: null, ambiguous: false, candidates: [] };

  const matchInList = (ids, resolution) => {
    const declared = (ids || []).filter((id) => localNameById[id] === want);
    const candidates = declared.filter(id => typeof isCandidateActive !== 'function' || isCandidateActive(id));
    if (candidates.length === 1) return { id: candidates[0], ambiguous: false, candidates, resolution };
    if (candidates.length > 1) return { id: null, ambiguous: true, candidates: candidates.slice().sort(), resolution };
    return { id: null, ambiguous: false, candidates: [], declared: declared.length > 0, resolution };
  };

  // An explicitly requested scope has priority over lexical fallback.
  if (resolveSiblingScope) {
    const parentId = parentById[currentId];
    if (parentId) {
      const sibling = matchInList(childrenById[parentId], 'sibling');
      if (sibling.id || sibling.ambiguous || sibling.declared) return sibling;
    }
    // Vanilla server_form.dynamic_button's panel_name binds to its own image
    // child while requesting sibling scope. Keep the requested sibling first,
    // then use only the direct local child before any ancestor/global fallback.
    // In a factory this preserves the occurrence and cannot borrow another row.
    const localChild = matchInList(childrenById[currentId], 'local_child');
    if (localChild.id || localChild.ambiguous || localChild.declared) return localChild;
  } else {
    const child = matchInList(childrenById[currentId], 'local_child');
    if (child.id || child.ambiguous || child.declared) return child;
  }

  // Vanilla also binds nested state controls to their named owner. Only use
  // this nearest lexical fallback when the requested scope had no match.
  if (localNameById[currentId] === want
    && (typeof isCandidateActive !== 'function' || isCandidateActive(currentId))) {
    return { id: currentId, ambiguous: false, candidates: [currentId], resolution: 'self' };
  }
  let ancestorId = parentById[currentId];
  for (let depth = 0; ancestorId && depth < 64; depth += 1) {
    if (localNameById[ancestorId] === want
      && (typeof isCandidateActive !== 'function' || isCandidateActive(ancestorId))) {
      return { id: ancestorId, ambiguous: false, candidates: [ancestorId], resolution: 'ancestor' };
    }
    ancestorId = parentById[ancestorId];
  }

  const generatedOccurrence = (nodeId) => {
    let cursor = nodeId;
    for (let depth = 0; cursor && depth < 64; depth += 1) {
      const props = propsById?.[cursor];
      if (typeof props?.__jsonui_preview_collection_name === 'string'
        && props.__jsonui_preview_collection_name.trim() && Number.isInteger(props.collection_index)) return cursor;
      cursor = parentById[cursor];
    }
    return null;
  };
  const currentOccurrence = generatedOccurrence(currentId);
  const global = Array.isArray(idsByLocalName[want])
    ? idsByLocalName[want].filter((id) => {
        const candidateOccurrence = generatedOccurrence(id);
        return (!candidateOccurrence || candidateOccurrence === currentOccurrence)
          && (typeof isCandidateActive !== 'function' || isCandidateActive(id));
      })
    : idsByLocalName[want];
  if (Array.isArray(global) && global.length === 1) {
    return { id: global[0], ambiguous: false, candidates: global.slice(), resolution: 'global_fallback' };
  }
  if (Array.isArray(global) && global.length > 1) {
    return { id: null, ambiguous: true, candidates: global.slice().sort() };
  }
  return { id: null, ambiguous: false, candidates: [] };
}

/* -------------------------------------------------------------------------- */
/* Expression evaluator (safe subset)                                          */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {{
 *   mockData: Record<string, any>,
 *   props: Record<string, any>,
 *   allowMockFallback?: boolean,
 * }} ExprContext
 */

/**
 * Evaluate an expression using a safe, tiny grammar.
 * Returns `undefined` on parse/eval error.
 *
 * @param {string} expr
 * @param {ExprContext} ctx
 */
// 同じ式は継承・factoryの各行・view bindingの収束確認で繰り返される。
// キャッシュするのは構文木だけ。状態値/評価結果を保存すると、指定データの
// 更新や異なるcollection行へ前の値が漏れるため絶対に保存しない。
const EXPRESSION_AST_CACHE = new Map();
const MAX_CACHED_EXPRESSION_ASTS = 512;
function cachedExpressionAst(source) {
  if (EXPRESSION_AST_CACHE.has(source)) return EXPRESSION_AST_CACHE.get(source);
  let ast = null;
  try {
    const tokens = tokenizeExpr(source);
    if (tokens.length > 1024) return null;
    const parser = createParser(tokens);
    ast = parser.parseExpression();
    if (!parser.isAtEnd()) ast = null;
  } catch { ast = null; }
  if (EXPRESSION_AST_CACHE.size >= MAX_CACHED_EXPRESSION_ASTS) {
    EXPRESSION_AST_CACHE.delete(EXPRESSION_AST_CACHE.keys().next().value);
  }
  EXPRESSION_AST_CACHE.set(source, ast);
  return ast;
}

/**
 * Return only reference tokens parsed by the evaluator's bounded grammar.
 * Static projection must use the same token boundaries as evaluation:
 * `$left-$right` contains two references and quoted `$text` is a literal.
 * The cached AST remains private and callers receive a fresh value array.
 * @param {string} expression
 * @returns {string[]}
 */
export function expressionReferenceTokens(expression) {
  const source = String(expression || '');
  if (source.length > 4096) return [];
  const root = cachedExpressionAst(source);
  if (!root) return [];
  const references = new Set();
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (node.kind === 'ref') references.add(node.name);
    else if (node.kind === 'unary') pending.push(node.expr);
    else if (node.kind === 'bin') pending.push(node.right, node.left);
  }
  return Array.from(references);
}

export function safeEvalExpression(expr, ctx) {
  try {
    const source = String(expr || '');
    if (source.length > 4096) return undefined;
    const ast = cachedExpressionAst(source);
    if (!ast) return undefined;
    return evalAst(ast, ctx);
  } catch {
    return undefined;
  }
}

/**
 * @typedef {{ type: 'number'|'string'|'bool'|'null'|'ref'|'op'|'lparen'|'rparen', value?: any }} Token
 */

/**
 * @param {string} src
 * @returns {Token[]}
 */
function tokenizeExpr(src) {
  const s = String(src || '');
  /** @type {Token[]} */
  const out = [];
  let i = 0;

  const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  const isIdent = (c) => /[A-Za-z0-9_:@.\-]/.test(c);

  while (i < s.length) {
    const c = s[i];
    if (isWs(c)) {
      i += 1;
      continue;
    }
    if (c === '(') {
      out.push({ type: 'lparen' });
      i += 1;
      continue;
    }
    if (c === ')') {
      out.push({ type: 'rparen' });
      i += 1;
      continue;
    }

    // Multi-char operators
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '==' || two === '!=' || two === '<=' || two === '>=') {
      out.push({ type: 'op', value: two });
      i += 2;
      continue;
    }

    // Single-char operators
    if (c === '!' || c === '<' || c === '>' || c === '=' || c === '-'
      || c === '+' || c === '*' || c === '/' || c === '%') {
      out.push({ type: 'op', value: c });
      i += 1;
      continue;
    }

    // String literal
    if (c === '\'' || c === '"') {
      const quote = c;
      i += 1;
      let val = '';
      let closed = false;
      while (i < s.length) {
        const ch = s[i];
        if (ch === '\\') {
          const nxt = s[i + 1];
          if (nxt) {
            if (nxt === 'n') val += '\n';
            else if (nxt === 'r') val += '\r';
            else if (nxt === 't') val += '\t';
            else val += nxt;
            i += 2;
            continue;
          }
        }
        if (ch === quote) {
          i += 1;
          closed = true;
          break;
        }
        val += ch;
        i += 1;
      }
      if (!closed) throw new Error('Unterminated string literal');
      out.push({ type: 'string', value: val });
      continue;
    }

    // Number
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const numberMatch = s.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/u);
      if (!numberMatch) throw new Error('Invalid number literal');
      const raw = numberMatch[0];
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new Error('Invalid number literal');
      out.push({ type: 'number', value: num });
      i += raw.length;
      continue;
    }

    // Ref token (#foo or $bar)
    if (c === '#' || c === '$') {
      let j = i + 1;
      while (j < s.length && isIdent(s[j])) {
        // Preserve hyphenated names, but do not absorb subtraction in the
        // unambiguous `$left-$right` / `#left-#right` form.
        if (s[j] === '-' && (s[j + 1] === '#' || s[j + 1] === '$'
          || /[0-9.]/u.test(s[j + 1] || ''))) break;
        j += 1;
      }
      const ref = s.slice(i, j);
      out.push({ type: 'ref', value: ref });
      i = j;
      continue;
    }

    // Identifier: true/false/null + word-operators (and/or/not)
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && isIdent(s[j])) j += 1;
      const id = s.slice(i, j);
      const low = id.toLowerCase();

      if (low === 'and') {
        out.push({ type: 'op', value: '&&' });
      } else if (low === 'or') {
        out.push({ type: 'op', value: '||' });
      } else if (low === 'not') {
        out.push({ type: 'op', value: '!' });
      } else if (low === 'true' || low === 'false') {
        out.push({ type: 'bool', value: low === 'true' });
      } else if (low === 'null') {
        out.push({ type: 'null', value: null });
      } else {
        // Runtime references are explicitly prefixed with # or $. Bare names
        // are enum literals in Bedrock expressions (`$button_state = hover`).
        out.push({ type: 'string', value: id });
      }
      i = j;
      continue;
    }

    // Unknown token
    throw new Error(`Unexpected character: ${c}`);
  }

  return out;
}

/* AST node types */
/**
 * @typedef {{ kind: 'lit', value: any }
 *  | { kind: 'ref', name: string }
 *  | { kind: 'unary', op: string, expr: any }
 *  | { kind: 'bin', op: string, left: any, right: any }
 * } Ast
 */

function createParser(tokens) {
  let pos = 0;
  let nestingDepth = 0;
  const peek = () => tokens[pos];
  const advance = () => tokens[pos++];
  const matchOp = (ops) => {
    const t = peek();
    if (t && t.type === 'op' && ops.includes(String(t.value))) {
      advance();
      return String(t.value);
    }
    return null;
  };
  const expect = (type) => {
    const t = advance();
    if (!t || t.type !== type) throw new Error(`Expected ${type}`);
    return t;
  };

  const parsePrimary = () => {
    const t = peek();
    if (!t) throw new Error('Unexpected end');
    if (t.type === 'number' || t.type === 'string' || t.type === 'bool' || t.type === 'null') {
      advance();
      return /** @type {Ast} */ ({ kind: 'lit', value: t.value });
    }
    if (t.type === 'ref') {
      advance();
      return /** @type {Ast} */ ({ kind: 'ref', name: String(t.value) });
    }
    if (t.type === 'lparen') {
      advance();
      nestingDepth += 1;
      if (nestingDepth > 64) throw new Error('Expression nesting limit exceeded');
      try {
        const e = parseExpression();
        expect('rparen');
        return e;
      } finally {
        nestingDepth -= 1;
      }
    }
    throw new Error('Unexpected token');
  };

  const parseUnary = () => {
    const op = matchOp(['!', '-']);
    if (op) {
      const expr = parseUnary();
      return /** @type {Ast} */ ({ kind: 'unary', op, expr });
    }
    return parsePrimary();
  };

  const parseMultiplicative = () => {
    let left = parseUnary();
    while (true) {
      const op = matchOp(['*', '/', '%']);
      if (!op) break;
      const right = parseUnary();
      left = /** @type {Ast} */ ({ kind: 'bin', op, left, right });
    }
    return left;
  };

  const parseAdditive = () => {
    let left = parseMultiplicative();
    while (true) {
      const op = matchOp(['+', '-']);
      if (!op) break;
      const right = parseMultiplicative();
      left = /** @type {Ast} */ ({ kind: 'bin', op, left, right });
    }
    return left;
  };

  const parseComparison = () => {
    let left = parseAdditive();
    while (true) {
      const op = matchOp(['<', '<=', '>', '>=']);
      if (!op) break;
      const right = parseAdditive();
      left = /** @type {Ast} */ ({ kind: 'bin', op, left, right });
    }
    return left;
  };

  const parseEquality = () => {
    let left = parseComparison();
    while (true) {
      const op = matchOp(['==', '=', '!=']);
      if (!op) break;
      const right = parseComparison();
      left = /** @type {Ast} */ ({ kind: 'bin', op, left, right });
    }
    return left;
  };

  const parseAnd = () => {
    let left = parseEquality();
    while (true) {
      const op = matchOp(['&&']);
      if (!op) break;
      const right = parseEquality();
      left = /** @type {Ast} */ ({ kind: 'bin', op, left, right });
    }
    return left;
  };

  const parseOr = () => {
    let left = parseAnd();
    while (true) {
      const op = matchOp(['||']);
      if (!op) break;
      const right = parseAnd();
      left = /** @type {Ast} */ ({ kind: 'bin', op, left, right });
    }
    return left;
  };

  const parseExpression = () => parseOr();

  return {
    parseExpression,
    isAtEnd: () => pos >= tokens.length,
  };
}

/**
 * @param {Ast} ast
 * @param {ExprContext} ctx
 */
function evalAst(ast, ctx, depth = 0) {
  if (depth > 128) throw new Error('Expression evaluation depth limit exceeded');
  if (ast.kind === 'lit') return ast.value;
  if (ast.kind === 'ref') return resolveRefValue(ast.name, ctx);
  if (ast.kind === 'unary') {
    const v = evalAst(ast.expr, ctx, depth + 1);
    if (v === undefined) return undefined;
    if (ast.op === '!') return !toBoolean(v);
    if (ast.op === '-') return finiteArithmetic(-Number(v));
    return undefined;
  }
  if (ast.kind === 'bin') {
    if (ast.op === '&&') {
      const left = evalAst(ast.left, ctx, depth + 1);
      if (left !== undefined && !toBoolean(left)) return false;
      const right = evalAst(ast.right, ctx, depth + 1);
      if (right !== undefined && !toBoolean(right)) return false;
      if (left === undefined || right === undefined) return undefined;
      return true;
    }
    if (ast.op === '||') {
      const left = evalAst(ast.left, ctx, depth + 1);
      if (left !== undefined && toBoolean(left)) return true;
      const right = evalAst(ast.right, ctx, depth + 1);
      if (right !== undefined && toBoolean(right)) return true;
      if (left === undefined || right === undefined) return undefined;
      return false;
    }

    const l = evalAst(ast.left, ctx, depth + 1);
    const r = evalAst(ast.right, ctx, depth + 1);
    if (l === undefined || r === undefined) return undefined;
    switch (ast.op) {
      case '+':
        if (typeof l === 'string' || typeof r === 'string') {
          const leftText = String(l), rightText = String(r);
          // View-binding fixed points can repeatedly double the last result.
          // Reject before allocating an unbounded concatenation, matching the
          // existing string-subtraction runtime limit.
          if (leftText.length + rightText.length > 65536) return undefined;
          return leftText + rightText;
        }
        return finiteArithmetic(Number(l) + Number(r));
      case '-':
        // JSON UI overloads subtraction for strings (keyword removal).
        // Use a literal needle: user input is never a RegExp or executable
        // replacement string. Bound runtime values as well as the source AST.
        if (typeof l === 'string' && typeof r === 'string') {
          if (l.length > 65536 || r.length > 65536) return undefined;
          if (r === '') return l;
          const position = l.indexOf(r);
          if (position < 0) return l;
          // Public author examples establish keyword removal, but do not
          // establish repeated/overlapping-match semantics. Keep those
          // unsupported instead of silently inventing a replacement policy.
          if (l.indexOf(r, position + 1) >= 0) return undefined;
          return l.slice(0, position) + l.slice(position + r.length);
        }
        return finiteArithmetic(Number(l) - Number(r));
      case '*':
        return finiteArithmetic(Number(l) * Number(r));
      case '/':
        return Number(r) === 0 ? undefined : finiteArithmetic(Number(l) / Number(r));
      case '%':
        return Number(r) === 0 ? undefined : finiteArithmetic(Number(l) % Number(r));
      case '=':
      case '==':
        return looselyEqual(l, r);
      case '!=':
        return !looselyEqual(l, r);
      case '<':
        return Number(l) < Number(r);
      case '<=':
        return Number(l) <= Number(r);
      case '>':
        return Number(l) > Number(r);
      case '>=':
        return Number(l) >= Number(r);
      default:
        return undefined;
    }
  }
  return undefined;
}

function finiteArithmetic(value) {
  return Number.isFinite(value) ? value : undefined;
}

function looselyEqual(a, b) {
  if (a === b) return true;
  // Try numeric compare.
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a) === String(b);
}

/**
 * Resolve a reference token in the expression.
 * @param {string} name
 * @param {ExprContext} ctx
 */
function resolveRefValue(name, ctx) {
  const n = String(name || '');
  if (!n) return undefined;

  // #prop -> source control property when available
  if (n.startsWith('#')) {
    const prop = n.slice(1);
    if (ctx && ctx.props) {
      const bareEntry = resolveExactOwnDataEntry(ctx.props, prop);
      const markedEntry = bareEntry.found || bareEntry.invalid
        ? { found: false, value: undefined, invalid: false }
        : resolveExactOwnDataEntry(ctx.props, n);
      const localEntry = bareEntry.found || bareEntry.invalid ? bareEntry : markedEntry;
      if (localEntry.invalid || (localEntry.found && localEntry.value === undefined)) return undefined;
      if (localEntry.found) {
        return resolveRuntimeTokenValue(
          localEntry.value,
          ctx.props,
          ctx.mockData,
          8,
          ctx.allowMockFallback !== false,
        );
      }
    }
    const v = ctx && ctx.allowMockFallback === false ? undefined : resolveMockValue(n, ctx.mockData);
    if (v !== undefined) return v;
    return undefined;
  }
  // $var -> lexical/local property first, then mock data
  if (n.startsWith('$')) {
    if (ctx && ctx.props) {
      const localEntry = resolveExactOwnDataEntry(ctx.props, n);
      if (localEntry.invalid || (localEntry.found && localEntry.value === undefined)) return undefined;
      if (localEntry.found) {
        return resolveRuntimeTokenValue(
          localEntry.value,
          ctx.props,
          ctx.mockData,
          8,
          ctx.allowMockFallback !== false,
        );
      }
    }
    const value = resolveMockValue(n, ctx.mockData);
    return value === undefined
      ? undefined
      : resolveRuntimeTokenValue(value, {}, ctx.mockData);
  }

  // fallback: mock data first, then props
  const v = ctx && ctx.allowMockFallback === false ? undefined : resolveMockValue(n, ctx.mockData);
  if (v !== undefined) return v;
  if (ctx && ctx.props && Object.prototype.hasOwnProperty.call(ctx.props, n)) return ctx.props[n];
  return undefined;
}

/**
 * Follow only exact local #/$ property tokens. This is bounded and performs no
 * code evaluation, so cycles and missing runtime values deterministically
 * become undefined.
 */
function resolveRuntimeTokenValue(value, props, mockData, maxDepth = 8, allowMockFallback = true) {
  let current = value;
  const seen = new Set();
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (current === UNRESOLVED_RUNTIME_VISIBILITY) return undefined;
    if (typeof current !== 'string') return current;
    const token = current.trim();
    if (!/^[#$][A-Za-z0-9_:@.\-]+$/.test(token)) return current;
    if (seen.has(token)) return undefined;
    seen.add(token);
    const bare = token.slice(1);
    if (token.startsWith('#')) {
      const bareEntry = resolveExactOwnDataEntry(props, bare);
      if (bareEntry.invalid || (bareEntry.found && bareEntry.value === undefined)) return undefined;
      if (bareEntry.found) {
        current = bareEntry.value;
        continue;
      }
      const markedEntry = resolveExactOwnDataEntry(props, token);
      if (markedEntry.invalid || (markedEntry.found && markedEntry.value === undefined)) return undefined;
      if (markedEntry.found) {
        current = markedEntry.value;
        continue;
      }
    }
    if (token.startsWith('$')) {
      const localEntry = resolveExactOwnDataEntry(props, token);
      if (localEntry.invalid || (localEntry.found && localEntry.value === undefined)) return undefined;
      if (localEntry.found) {
        current = localEntry.value;
        continue;
      }
    }
    // `$` names are global/runtime variables, so they remain valid even when
    // the caller disables the broad mock fallback used for local `#` names.
    const mocked = token.startsWith('$') || allowMockFallback
      ? resolveMockValue(token, mockData)
      : undefined;
    if (mocked !== undefined) {
      current = mocked;
      continue;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Resolve a token against the two namespaces visible to an authored
 * collection cell. Bedrock row data owns `#` names, while lexical/authored
 * properties own `$` names. An invalid or explicit-undefined value in the
 * preferred namespace is authoritative and cannot fall through to a less
 * trusted namespace.
 */
function resolveScopedRuntimeTokenValue(
  value,
  props,
  generatedRow,
  mockData,
  maxDepth = 8,
  allowMockFallback = true,
) {
  let current = value;
  const seen = new Set();
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (current === UNRESOLVED_RUNTIME_VISIBILITY) return undefined;
    if (typeof current !== 'string') return current;
    const token = current.trim();
    if (!/^[#$][A-Za-z0-9_:@.\-]+$/u.test(token)) return current;
    if (seen.has(token)) return undefined;
    seen.add(token);

    const rowFirst = token.startsWith('#');
    const preferred = rowFirst
      ? resolveOwnBindingEntry(generatedRow, token)
      : resolveOwnBindingEntry(props, token);
    if (preferred.invalid || (preferred.found && preferred.value === undefined)) return undefined;
    if (preferred.found) {
      current = preferred.value;
      continue;
    }

    const fallback = rowFirst
      ? resolveOwnBindingEntry(props, token)
      : resolveOwnBindingEntry(generatedRow, token);
    if (fallback.invalid || (fallback.found && fallback.value === undefined)) return undefined;
    if (fallback.found) {
      current = fallback.value;
      continue;
    }

    const mocked = allowMockFallback ? resolveMockValue(token, mockData) : undefined;
    if (mocked === undefined) return undefined;
    current = mocked;
  }
  return undefined;
}
