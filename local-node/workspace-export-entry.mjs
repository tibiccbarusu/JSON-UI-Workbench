/** Node-owned authored entry-point preservation; no preview values are serialized. */
import { parseDefinitionKey } from '../editor-core/src/engine/ui-catalog.js';
import { parseFixedControlSpec } from '../editor-core/src/engine/control-reference.js';
import { canonicalUiDocument } from './workspace-export-engine.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const STRUCTURAL = new Set(['grid_item_template', 'collection_item_template', 'control_name']);
const ANIMATED = new Set(['alpha', 'offset', 'size', 'uv', 'color', 'next']);
const VARIABLE = /^\$[A-Za-z0-9_:@.\-]+$/u;
const REASONS = Object.freeze({
  EXPORT_ENTRY_INHERITANCE_LIMIT: '画面入口の継承が循環しているか、深さ上限を超えています。',
  EXPORT_ENTRY_DYNAMIC_INHERITANCE: '画面入口の基底が変数や式で切り替わるため、元の入口を保持する変換を確定できません。',
  EXPORT_ENTRY_MODIFICATIONS_UNPROVEN: '継承中の modifications を重複適用しないことを確認できないため、入口変換を停止しました。',
  EXPORT_ENTRY_VARIABLE_SCOPE_UNPROVEN: '継承先変更で画面直下の変数条件も変わるため、条件を固定せずに入口を保持できません。',
  EXPORT_ENTRY_NAMESPACE_MERGE_UNPROVEN: '異なる名前空間のプロパティが合成されているため、参照名の変換を確定できません。',
  EXPORT_ENTRY_NAMESPACE_VARIABLE_UNPROVEN: 'UI参照変数に名前空間を省略した値か未確定の値があります。変数は表示式や条件でも使われ得るため書き換えません。',
  EXPORT_ENTRY_NAMESPACE_EXTERNAL_VARIABLE_UNPROVEN: '移植範囲外の参照変数に、名前空間を省略した値か未確定の値があります。元の変数宣言を確認してください。',
  EXPORT_ENTRY_NAMESPACE_DYNAMIC_REFERENCE_UNPROVEN: '名前空間を跨ぐ動的なUI参照またはアニメーション参照を確定できないため、入口変換を停止しました。',
  EXPORT_ENTRY_NAMESPACE_LIMIT: '画面入口の参照変数または原文走査が上限を超えています。',
  EXPORT_ENTRY_REMOVAL_UNPROVEN: '元の継承先にしか存在しないプロパティを安全に除去できないため、入口変換を停止しました。',
});
function fail(code, detail = {}) {
  throw Object.assign(new Error(code), { code, detail: { ...(REASONS[code] ? { reason: REASONS[code] } : {}),
    ...detail, ...(detail.definition && !detail.reference ? { reference: detail.definition } : {}) } });
}
const equal = (a, b) => canonicalUiDocument(a) === canonicalUiDocument(b);

function mergeRaw(base, own, depth = 0) {
  if (depth > 128) fail('EXPORT_ENTRY_INHERITANCE_LIMIT');
  if (!object(base) || !object(own)) return structuredClone(own);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(own)) Object.defineProperty(result, key, {
    value: object(value) && Object.hasOwn(result, key) && object(result[key])
      ? mergeRaw(result[key], value, depth + 1) : structuredClone(value),
    enumerable: true, configurable: true, writable: true,
  });
  return result;
}

/** Fixed authored ancestry only. Arrays/conditions stay raw and are never expanded. */
function authoredProperties(catalog, selected) {
  const chain = [], seen = new Set();
  let current = selected;
  while (current) {
    if (seen.has(current.id) || chain.length >= 128) fail('EXPORT_ENTRY_INHERITANCE_LIMIT', { definition: selected.qualifiedName });
    seen.add(current.id); chain.push(current);
    if (!current.baseRef) break;
    const parsed = parseFixedControlSpec(current.baseRef, current.namespace);
    if (!parsed.ok) fail('EXPORT_ENTRY_DYNAMIC_INHERITANCE', { definition: current.qualifiedName, reference: current.baseRef });
    const symbol = catalog.symbols[parsed.qualifiedName];
    if (!symbol) fail('EXPORT_UI_SYMBOL_MISSING', { reference: parsed.qualifiedName });
    current = catalog.recordsById[symbol.winnerId];
    if (symbol.candidateIds.filter(id => catalog.recordsById[id].precedence === current.precedence).length !== 1) {
      fail('EXPORT_UI_SYMBOL_AMBIGUOUS', { reference: parsed.qualifiedName });
    }
  }
  const properties = new Map();
  for (const record of chain.reverse()) {
    if (Object.hasOwn(record.value, 'modifications')) fail('EXPORT_ENTRY_MODIFICATIONS_UNPROVEN', { definition: record.qualifiedName });
    for (const [key, value] of Object.entries(record.value)) {
      const previous = properties.get(key), merges = object(previous?.value) && object(value);
      properties.set(key, { value: merges ? mergeRaw(previous.value, value) : structuredClone(value),
        namespaces: merges ? new Set([...previous.namespaces, record.namespace]) : new Set([record.namespace]) });
    }
  }
  return properties;
}

/** Preserve the authored namespace of copied references, never control-instance IDs. */
function qualifyCopiedProperty(value, property, namespace, destination, ambientValues) {
  if (namespace === destination) return structuredClone(value);
  let visits = 0;
  const referenceVariables = new Set(), declarations = [];
  const reference = (key, parent, child) => key === '__control_key__' || STRUCTURAL.has(key) || parent === 'control_ids'
    || key === 'anims' || parent === 'anims' || ANIMATED.has(key) && typeof child === 'string' && child.startsWith('@');
  function inspect(child, key, parent, declaration = false, depth = 0) {
    if (++visits > 200000 || depth > 128) fail('EXPORT_ENTRY_NAMESPACE_LIMIT');
    if (typeof child === 'string') {
      const parsed = reference(key, parent, child) ? parseFixedControlSpec(child, namespace) : null;
      if (parsed?.reason === 'variable') referenceVariables.add(parsed.variable);
      else if (parsed && !parsed.ok) fail('EXPORT_ENTRY_NAMESPACE_DYNAMIC_REFERENCE_UNPROVEN', { reference: child });
      return;
    }
    if (Array.isArray(child)) { for (const item of child) inspect(item, key, parent, declaration, depth + 1); return; }
    if (!object(child)) return;
    for (const [name, item] of Object.entries(child)) {
      if (key === 'controls' && name.includes('@') && !name.startsWith('$')) inspect(name, '__control_key__', '', false, depth + 1);
      if (name.startsWith('$')) declarations.push({ name: name.split('|')[0], value: item });
      inspect(item, name, key, name.startsWith('$'), depth + 1);
    }
  }
  inspect(value, property, '');
  for (let pass = 0; pass < 128; pass++) {
    const before = referenceVariables.size;
    for (const declaration of declarations) if (referenceVariables.has(declaration.name)
      && typeof declaration.value === 'string' && VARIABLE.test(declaration.value)) referenceVariables.add(declaration.value);
    if (before === referenceVariables.size) break;
    if (pass === 127) fail('EXPORT_ENTRY_NAMESPACE_LIMIT');
  }
  // A variable declared outside the copied property keeps its caller precedence.
  // Do not shadow or rewrite that declaration merely to qualify a local name.
  // Every possible terminal must already identify its namespace explicitly.
  function checkExternal(name, active = new Set()) {
    if (active.has(name) || active.size >= 128) fail('EXPORT_ENTRY_NAMESPACE_EXTERNAL_VARIABLE_UNPROVEN', { reference: name });
    // Include external candidates even when a sibling has a same-named local
    // declaration. A subtree-wide name set is not a lexical shadowing proof.
    const local = declarations.filter(item => item.name === name).map(item => item.value);
    const values = [...local, ...(ambientValues.get(name) || [])];
    if (!values.length) fail('EXPORT_ENTRY_NAMESPACE_EXTERNAL_VARIABLE_UNPROVEN', { reference: name });
    const next = new Set(active).add(name);
    const checkValue = child => {
      if (Array.isArray(child)) { for (const item of child) checkValue(item); return; }
      if (typeof child === 'string' && VARIABLE.test(child)) { checkExternal(child, next); return; }
      const parsed = parseFixedControlSpec(child, namespace);
      if (!parsed.ok || !parsed.target.includes('.')) fail(local.includes(child)
        ? 'EXPORT_ENTRY_NAMESPACE_VARIABLE_UNPROVEN' : 'EXPORT_ENTRY_NAMESPACE_EXTERNAL_VARIABLE_UNPROVEN', { reference: name });
    };
    for (const child of values) checkValue(child);
  }
  for (const name of referenceVariables) checkExternal(name);
  const qualified = raw => {
    const parsed = parseFixedControlSpec(raw, namespace);
    if (parsed.reason === 'variable') return raw;
    if (!parsed.ok) fail('EXPORT_ENTRY_NAMESPACE_DYNAMIC_REFERENCE_UNPROVEN', { reference: raw });
    if (parsed.target.includes('.')) return raw;
    return raw.includes('@') ? `${raw.slice(0, raw.indexOf('@') + 1)}${parsed.qualifiedName}` : parsed.qualifiedName;
  };
  visits = 0;
  function copy(child, key, parent, depth = 0) {
    if (++visits > 200000 || depth > 128) fail('EXPORT_ENTRY_NAMESPACE_LIMIT');
    if (key.startsWith('$')) return structuredClone(child);
    if (typeof child === 'string') {
      if (reference(key, parent, child)) return qualified(child);
      // Declarations can also participate in expressions, requires clauses or
      // sibling scopes. Their original text is always retained.
      return child;
    }
    if (Array.isArray(child)) return child.map(item => copy(item, key, parent, depth + 1));
    if (!object(child)) return child;
    return Object.fromEntries(Object.entries(child).map(([name, item]) => [key === 'controls' && name.includes('@') && !name.startsWith('$') ? qualified(name) : name,
      copy(item, name, key, depth + 1)]));
  }
  return copy(value, property, '');
}

/** Find exactly one original entry with the same local name, without changing the input. */
export function findOriginalExportEntry(document, selected) {
  if (!object(document) || document.namespace !== selected.namespace) return null;
  const candidates = Object.entries(document).filter(([key, value]) => object(value)
    && parseDefinitionKey(key).localName === selected.localName);
  if (candidates.length !== 1) return null;
  const [rawKey, value] = candidates[0];
  return { rawKey, value, ...parseDefinitionKey(rawKey) };
}

/**
 * Retain the original externally registered screen key after private branch cloning.
 * Only properties changed by the redirected ancestry are copied. Variables,
 * bindings, conditions and button mappings remain authored JSON, not resolved UI.
 * An unsupported ancestry fails closed so a plausible-looking pack is not emitted.
 */
export function preserveExportEntryPoint({ catalog, selected, original }) {
  if (!original || original.rawKey === selected.rawKey || !selected.baseRef) return null;
  const restored = { ...selected, rawKey: original.rawKey, baseRef: original.baseRef || null };
  const current = authoredProperties(catalog, selected);
  if (current.get('type')?.value !== 'screen') return null;
  const inherited = authoredProperties(catalog, restored), value = structuredClone(selected.value), copied = [];
  const ambientValues = new Map();
  const addScope = scope => {
    for (const [key, child] of Object.entries(scope || {})) if (key.startsWith('$')) {
      const name = key.split('|')[0];
      if (!ambientValues.has(name)) ambientValues.set(name, []);
      ambientValues.get(name).push(child);
    }
    for (const branch of Array.isArray(scope?.variables) ? scope.variables : []) addScope(branch);
  };
  addScope(catalog.globalVariables);
  addScope(Object.fromEntries([...current].map(([key, source]) => [key, source.value])));
  for (const [property, source] of current) {
    if (equal(source.value, inherited.get(property)?.value)) continue;
    // Conditional root declarations have scope/precedence beyond raw object merge.
    if (property === 'variables' || property.startsWith('$')) fail('EXPORT_ENTRY_VARIABLE_SCOPE_UNPROVEN', { definition: selected.qualifiedName, property });
    if (source.namespaces.size !== 1) fail('EXPORT_ENTRY_NAMESPACE_MERGE_UNPROVEN', { definition: selected.qualifiedName, property });
    const namespace = [...source.namespaces][0];
    Object.defineProperty(value, property, { value: qualifyCopiedProperty(source.value, property, namespace, selected.namespace, ambientValues),
      enumerable: true, configurable: true, writable: true });
    copied.push({ property, authoredNamespace: namespace });
  }
  for (const property of inherited.keys()) if (!current.has(property)) fail('EXPORT_ENTRY_REMOVAL_UNPROVEN', { definition: selected.qualifiedName, property });
  return { record: { ...restored, value }, report: { definition: selected.qualifiedName,
    path: selected.filePath, authoredKey: selected.rawKey, exportedKey: original.rawKey,
    preservedProperties: copied, method: 'authored-property-overlay-with-original-screen-entry-v1', deviceValidation: 'NOT_RUN' } };
}
