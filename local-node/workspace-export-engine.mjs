/** Pinned Mojang identities and bounded evidence for delegated storage dialogs. */
import { createHash } from 'node:crypto';
import { ENGINE_FACTORY_CONTRACT } from './workspace-export-engine-contract.mjs';
export const ENGINE_FACTORY_SOURCE = Object.freeze({
  commit: '736072450c26a7c67f07b1661f29d9a5ebaa14b1',
  canonicalization: 'sorted-object-members-json-v1',
  documents: Object.freeze({
  "ui/ui_common.json": "9f002d77632efbad739184fc6a1e4fe67a992e137b54ce5c42a42ef677b19e22",
  "ui/storage_management_popup.json": "b210f06131a9aa520fd366f2fc5c316865ceaf3115f6344fd55b761232c722bd",
  "ui/storage_management.json": "3e9015dd18ceb963d008ec8804a9598ec6515107f9aa61e0449006420d9ac48d",
  "ui/popup_dialog.json": "636208e75936fa5f78dbf959caf5a49fccb9ff4de9c6657abdd6fb8005d3b715",
  "ui/_global_variables.json": "3341fee59d34988a0be8ecc2362867bd7d226785eb3ad7759442cc3c69a372e9"
}),
});

export function canonicalUiDocument(value) {
  return JSON.stringify(value, (_key, next) => next && typeof next === 'object' && !Array.isArray(next)
    ? Object.fromEntries(Object.keys(next).sort().map(key => [key, next[key]])) : next);
}

const digest = value => createHash('sha256').update(canonicalUiDocument(value)).digest('hex');

/** Opaque runtime declarations cannot be proved in a second controller context
 * merely because a different screen happened to include the same definition.
 */
export function engineDependencyFacts(value) {
  const opaque = new Set(), dynamicAssets = new Set();
  const walk = current => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      if (key.startsWith('$') || ['variables', 'bindings', 'property_bag', 'control_ids', 'factory',
        'anims', 'next', 'renderer', 'collection_name', 'grid_item_template'].includes(key)) opaque.add(digest([key, child]));
      if ((key.toLowerCase().endsWith('texture') || ['font_type', 'text', 'place_holder_text', 'placeholder_text', 'sound_name'].includes(key))
        && typeof child === 'string' && /^[#$@(]/u.test(child.trim())) dynamicAssets.add(digest([key, child]));
      walk(child);
    }
  };
  walk(value);
  return { opaque: [...opaque].sort(), dynamicAssets: [...dynamicAssets].sort() };
}

/** Conservative literal symbol candidates, including factory/variable values. */
export function engineFixedUiReferences(value, namespace, symbols) {
  const references = new Set();
  const walk = (current, ownerKey = null) => {
    if (typeof current === 'string') {
      const explicit = current.includes('@') || ['control_name', 'grid_item_template'].includes(ownerKey);
      let ref = current.includes('@') ? current.slice(current.lastIndexOf('@') + 1) : current;
      if (!/^[\w.-]+$/u.test(ref)) return;
      if (!ref.includes('.')) ref = namespace + '.' + ref;
      if (explicit || Object.hasOwn(symbols, ref)) references.add(ref);
    } else if (current && typeof current === 'object') for (const [key, child] of Object.entries(current)) { walk(key); walk(child, key); }
  };
  walk(value); return [...references].sort();
}

/** Compare only the factory and the dependency closure derived from pinned data.
 * Changed dependencies are deferred until the selected pack's strict scan has
 * demonstrated that the exact winning record is included in its output.
 */
export function inspectEngineFactoryProof({ catalog, sourceById, documentScopes }) {
  const caller = catalog.recordsById[catalog.symbols['common.screen_panel']?.winnerId];
  const callerPeers = (catalog.symbols['common.screen_panel']?.candidateIds || [])
    .map(id => catalog.recordsById[id]).filter(record => record.precedence === caller?.precedence);
  const factories = (Array.isArray(caller?.value?.controls) ? caller.value.controls : [])
    .filter(control => control && Object.hasOwn(control, 'popup_dialog_factory'));
  const matches = callerPeers.length === 1 && factories.length === 1 && digest(factories[0].popup_dialog_factory) === ENGINE_FACTORY_CONTRACT.factorySha256;
  const factory = { definition: 'common.screen_panel', path: 'ui/ui_common.json', matches,
    ...(matches ? {} : { reason: callerPeers.length > 1 ? 'FACTORY_CALLER_AMBIGUOUS' : 'FACTORY_STRUCTURE_CHANGED_OR_MISSING' }) };
  // Screen isolation may give an otherwise identical authored caller a private
  // name. Accept semantic identity, never a name prefix or a caller claim.
  // Keep the original pinned factory/dependency proof as the authority, and
  // require every lexical document declaration and the entire caller body to
  // match. Inheritance is compared independently because it is in rawKey.
  const callerRecordIds = new Set();
  if (matches && caller?.filePath === factory.path && sourceById.get(caller.sourceId)?.kind === 'vanilla') {
    const originalBody = canonicalUiDocument(caller.value);
    const originalScope = canonicalUiDocument(documentScopes.get(`${caller.sourceId}\0${caller.filePath}`) || {});
    for (const candidate of catalog.records) {
      if (candidate.namespace !== caller.namespace || candidate.filePath !== caller.filePath
        || (candidate.baseRef || '') !== (caller.baseRef || '')
        || catalog.symbols[candidate.qualifiedName]?.winnerId !== candidate.id) continue;
      const symbol = catalog.symbols[candidate.qualifiedName];
      const peers = (symbol?.candidateIds || []).map(id => catalog.recordsById[id]).filter(row => row.precedence === candidate.precedence);
      if (peers.length !== 1 || canonicalUiDocument(candidate.value) !== originalBody
        || canonicalUiDocument(documentScopes.get(`${candidate.sourceId}\0${candidate.filePath}`) || {}) !== originalScope) continue;
      callerRecordIds.add(candidate.id);
    }
  }
  factory.equivalentCallers = [...callerRecordIds].map(id => ({ definition: catalog.recordsById[id].qualifiedName,
    path: catalog.recordsById[id].filePath, sourceKind: sourceById.get(catalog.recordsById[id].sourceId)?.kind,
    reason: 'canonical-body-base-reference-and-document-scope-identical' }));
  const branches = Object.entries(ENGINE_FACTORY_CONTRACT.branches).map(([definition, contract]) => {
    const checks = [], changedRecords = [];
    let verified = matches && caller?.filePath === factory.path && sourceById.get(caller?.sourceId)?.kind === 'vanilla';
    if (!verified) checks.push({ code: 'FACTORY_SOURCE_OR_STRUCTURE_UNVERIFIED', definition: factory.definition, path: factory.path });
    for (const expected of contract.records) {
      const symbol = catalog.symbols[expected.qualifiedName];
      const record = catalog.recordsById[symbol?.winnerId];
      const samePriority = (symbol?.candidateIds || []).map(id => catalog.recordsById[id]).filter(row => row.precedence === record?.precedence);
      if (!record || samePriority.length !== 1) {
        verified = false; checks.push({ code: 'DEPENDENCY_DEFINITION_MISSING_OR_AMBIGUOUS', definition: expected.qualifiedName, path: expected.path }); continue;
      }
      const target = expected.qualifiedName === definition;
      const changed = digest({ rawKey: record.rawKey, value: record.value }) !== expected.sha256;
      if (target && (changed || record.filePath !== expected.path || sourceById.get(record.sourceId)?.kind !== 'vanilla')) {
        verified = false; checks.push({ code: 'FACTORY_TARGET_CHANGED', definition, path: record.filePath, changed });
      } else if (changed) changedRecords.push({ recordId: record.id, definition: expected.qualifiedName, path: record.filePath,
        expectedFacts: expected.facts, expectedUiReferences: expected.fixedUiReferences });
      const scope = documentScopes.get(`${record.sourceId}\0${record.filePath}`) || {};
      if (digest(scope) !== contract.documentScopes[expected.path]) {
        verified = false; checks.push({ code: 'DEPENDENCY_DOCUMENT_SCOPE_CHANGED', definition: expected.qualifiedName, path: record.filePath });
      }
    }
    for (const [reference, expected] of Object.entries(contract.globalVariables)) {
      const declarations = Object.fromEntries(Object.entries(catalog.globalVariables).filter(([key]) => key.split('|')[0] === reference));
      if (digest(declarations) !== expected) {
        verified = false; checks.push({ code: 'DEPENDENCY_GLOBAL_VARIABLE_CHANGED', reference, path: 'ui/_global_variables.json' });
      }
    }
    return { definition, considered: false, used: false, verified, checks, changedRecords, textureStems: contract.textureStems };
  });
  return { method: 'pinned-reachable-definitions-v1', sourceCommit: ENGINE_FACTORY_CONTRACT.commit,
    verified: branches.every(branch => branch.verified), factory, branches, callerRecordIds };
}

/** Internal record IDs and texture indexes are unnecessary in diagnostic bundles. */
export function publicEngineFactoryProof(proof) {
  if (!proof) return null;
  return { method: proof.method, sourceCommit: proof.sourceCommit, verified: proof.verified, factory: proof.factory,
    branches: proof.branches.map(branch => ({ definition: branch.definition, considered: branch.considered, used: branch.used, verified: branch.verified,
      checks: branch.checks.slice(0, 400), omittedChecks: Math.max(0, branch.checks.length - 400) })) };
}
