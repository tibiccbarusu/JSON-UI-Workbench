import { classifyUiBindingType, describeUiBindingType } from '../editor-core/src/json/ui-binding-contract.js';
import { unitlessDimensionComponents } from '../editor-core/src/json/ui-dimension-contract.js';
/**
 * Node.js 22.14+ の純粋な JSON UI 原文編集サービス。
 * I/O・ZIP・解決済みプレビューの書き戻しは行わない。
 */
import { createHash } from 'node:crypto';
import { parseDefinitionKey } from '../editor-core/src/engine/ui-catalog.js';
import { parseFixedControlSpec } from '../editor-core/src/engine/control-reference.js';
import { prepareDocumentSources, stableDocumentSourceRows, sourceFields, layeredReferenceTargets } from './workspace-layered.mjs';
import {
  WorkspaceEditError, editFail, parseEditableJsonc, pointerParts, pointerJoin,
  findEditableNode, setEditableValue, removeEditableValue,
  insertEditableArrayValue, renameEditableKey,
} from './workspace-jsonc.mjs';

export const WORKSPACE_EDIT_LIMITS = Object.freeze({ maxFiles: 5000, maxTotalBytes: 64 * 1024 * 1024, maxElements: 100000, maxDiagnostics: 2048,
  maxFactoryReferences: 100000, maxFactoryVariableDepth: 128 });
const METADATA = new Set(['namespace', '$schema', 'format_version']);
const VECTOR_PROPERTIES = new Set(['size', 'offset', 'min_size', 'max_size', 'uv', 'uv_size']);
const STRING_PROPERTIES = new Set(['text', 'texture', 'anchor_from', 'anchor_to', 'renderer', 'font_type', 'text_alignment', 'orientation', 'clip_direction']);
const BOOLEAN_PROPERTIES = new Set(['visible', 'enabled', 'ignored', 'clips_children', 'allow_clipping', 'keep_ratio', 'tiled']);
const NUMBER_PROPERTIES = new Set(['alpha', 'layer', 'font_scale_factor', 'max_length']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (path, pointer) => `${path}#${pointer}`;
// Only our successful, fully inspected result dictionaries can own a compact
// baseline. A full content revision and exact layer metadata are checked again
// on every use. No AST, source props or caller-mutable diagnostic is retained.
const baselineProofs36 = new WeakMap();
const baselineStats36 = { hits: 0, misses: 0, stores: 0, bypasses: 0 };
export function workspaceBaselineCacheStats36() { return { ...baselineStats36 }; }
function ownDataEntries36(value) {
  if (!isObject(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return keys.map(key => [key, descriptors[key].value]);
}
function baselineMetadataKey36(documents, documentSources) {
  const texts = ownDataEntries36(documents);
  if (!texts || texts.some(([, value]) => typeof value !== 'string')) return null;
  if (documentSources === undefined) return '';
  const sources = ownDataEntries36(documentSources);
  if (!sources) return null;
  const rows = [];
  for (const [path, source] of sources) {
    const entries = ownDataEntries36(source);
    if (!entries || entries.some(([, value]) => !['string', 'number', 'boolean'].includes(typeof value))) return null;
    rows.push([path, entries.sort(([a], [b]) => a.localeCompare(b))]);
  }
  return JSON.stringify(rows.sort(([a], [b]) => a.localeCompare(b)));
}
function storeBaseline36(documents, documentSources, inspection) {
  const metadata = baselineMetadataKey36(documents, documentSources);
  if (metadata === null) { baselineStats36.bypasses++; return; }
  baselineProofs36.set(documents, { revision: inspection.revision, metadata,
    // UTF-8 hashes replace lone UTF-16 surrogates. Keep immutable string
    // references as well, so distinct JS texts/keys cannot share this proof.
    texts: Object.entries(documents),
    diagnostics: structuredClone(inspection.diagnostics), nodeIds: new Set(inspection.nodes.map(node => node.id)) });
  baselineStats36.stores++;
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.parent) if (current.values.has(name)) return { found: true, value: current.values.get(name), origin: current.origins?.get(name) };
  return { found: false };
}

function validPath(path) {
  if (typeof path !== 'string' || path.length < 1 || path.length > 512 || !/\.jsonc?$/iu.test(path)
    || /[\\\u0000-\u001f\u007f<>:"|?*]/u.test(path) || path.startsWith('/')
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    editFail('EDIT_PATH_INVALID', '作業領域内の安全な JSON 相対パスを指定してください。', 'path');
  }
}

function checkedDocuments(documents) {
  if (!isObject(documents) || ![Object.prototype, null].includes(Object.getPrototypeOf(documents))) editFail('EDIT_DOCUMENTS_INVALID', 'documents は相対パスと JSONC 原文の対応表で指定してください。');
  const entries = Object.entries(documents);
  if (entries.length > WORKSPACE_EDIT_LIMITS.maxFiles) editFail('EDIT_FILE_LIMIT', '編集対象のファイル数上限を超えました。');
  const names = new Set();
  let bytes = 0;
  for (const [path, text] of entries) {
    validPath(path);
    if (names.has(path.toLowerCase())) editFail('EDIT_PATH_AMBIGUOUS', '大文字・小文字だけが異なるファイル名は編集できません。', path);
    names.add(path.toLowerCase());
    if (typeof text !== 'string') editFail('EDIT_TEXT_INVALID', 'JSONC 原文は文字列で指定してください。', path);
    bytes += Buffer.byteLength(text);
    if (bytes > WORKSPACE_EDIT_LIMITS.maxTotalBytes) editFail('EDIT_WORKSPACE_LIMIT', '編集対象の原文容量上限を超えました。');
  }
  return entries;
}

function revisionOf(entries, documentSources = null) {
  const hash = createHash('sha256');
  for (const [path, text] of [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    hash.update(`${Buffer.byteLength(path)}:`).update(path).update(`${Buffer.byteLength(text)}:`).update(text);
  }
  if (documentSources) hash.update('\u0000workspace-layers-v1:').update(JSON.stringify(stableDocumentSourceRows(documentSources)));
  return hash.digest('hex');
}

/** 原文の全内容から決まる SHA-256。呼出側の辞書を変更しない。 */
export function workspaceRevision(documents, documentSources) {
  const entries = checkedDocuments(documents);
  return revisionOf(entries, prepareDocumentSources(entries, documentSources));
}

function failure(error, diagnostics = []) {
  if (!(error instanceof WorkspaceEditError)) error = new WorkspaceEditError('EDIT_INTERNAL_ERROR', '原文編集処理で予期しないエラーが発生しました。', [], error);
  return { ok: false, code: error.code, message: error.message, previewAllowed: false, diagnostics,
    error: { code: error.code, message: error.message, category: error.category, retryable: false, correlation_id: null, details: error.details } };
}

function inspect(documents, documentSources) {
  const entries = checkedDocuments(documents);
  const sources = prepareDocumentSources(entries, documentSources);
  const revision = revisionOf(entries, sources);
  const trees = new Map();
  const nodes = [];
  const nodeMap = new Map();
  const symbols = new Map();
  const diagnostics = [];
  const references = [];
  const factoryMaps = [];
  const factoryNames = [];
  const globalVariables = new Map();
  const globalDeclarations = new Map();
  const indexedStaticControls = new Set();
  let unsupportedBindingTypeCount = 0;
  const lineStartsByPath = new Map();
  function sourceLocation(path, pointer) {
    const offset = findEditableNode(trees.get(path), pointerParts(pointer)).node.start;
    if (!lineStartsByPath.has(path)) {
      const starts = [0], text = documents[path]; let lines = 0;
      // 改行だけの大きい文書でも索引を膨らませない。64行ごとの開始位置を保持する。
      for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) if (++lines % 64 === 0) starts.push(index + 1);
      lineStartsByPath.set(path, starts);
    }
    const starts = lineStartsByPath.get(path), text = documents[path]; let low = 0, high = starts.length;
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle; else high = middle; }
    let start = starts[low], line = low * 64 + 1;
    for (let next = text.indexOf('\n', start); next >= 0 && next < offset; next = text.indexOf('\n', start)) { start = next + 1; line++; }
    return { pointer, offset, line, column: offset - start + 1 };
  }
  function diagnose(code, message, node, severity = 'warning', extra = {}) {
    if (diagnostics.length >= WORKSPACE_EDIT_LIMITS.maxDiagnostics) editFail('EDIT_DIAGNOSTIC_LIMIT', '診断件数の上限を超えました。対象を絞って再検査してください。');
    diagnostics.push({ code, message, severity, path: node.path, pointer: node.pointer,
      ...sourceFields(sources?.get(node.path)), ...extra });
  }
  const orderedEntries = sources ? [...entries].sort(([a], [b]) => sources.get(a).precedence - sources.get(b).precedence
    || (a < b ? -1 : a > b ? 1 : 0)) : entries;
  for (const [path, text] of orderedEntries) {
    const tree = parseEditableJsonc(text, path);
    if (tree.type !== 'object') editFail('EDIT_UI_STRUCTURE', 'JSON UI 文書の最上位にはオブジェクトが必要です。', path);
    trees.set(path, tree);
    if (sources?.get(path)?.active !== false && /(?:^|\/)_global_variables\.jsonc?$/iu.test(path)) {
      const wrapped = isObject(tree.value.variables);
      const variables = wrapped ? tree.value.variables : tree.value;
      // catalog と同じく raw 宣言キーごとに下位→上位を合成する。
      // 正規化を先にすると、上位の default が下位の exact を破壊する。
      for (const [key, value] of Object.entries(variables)) {
        const normalizedKey = key.startsWith('$') ? key : wrapped ? `$${key}` : key;
        if (normalizedKey.startsWith('$') && normalizedKey !== '$schema') globalDeclarations.set(normalizedKey, value);
      }
    }
  }
  // メンバー記載順に依存せず、合成後の default を exact より先に採用する。
  for (const isDefault of [true, false]) for (const [key, value] of globalDeclarations) {
    const [name, modifier = ''] = key.split('|');
    if ((modifier.toLowerCase() === 'default') === isDefault
      && (!isDefault || !globalVariables.has(name))) globalVariables.set(name, value);
  }
  function indexLiteralControlSource(value, origin) {
    if (!origin || !(Array.isArray(value) || isObject(value))) return;
    const controlsIdentity = identity(origin.path, pointerJoin(origin.parts));
    if (indexedStaticControls.has(controlsIdentity)) return;
    indexedStaticControls.add(controlsIdentity);
    const owner = origin.owner;
    if (Array.isArray(value)) value.forEach((wrapper, index) => {
      if (!isObject(wrapper) || Object.keys(wrapper).length !== 1) return;
      const [name, child] = Object.entries(wrapper)[0];
      if (isObject(child)) element(origin.path, [...origin.parts, index, name], name, child, owner.namespace, owner, false, owner.variables);
    });
    else for (const [name, child] of Object.entries(value)) if (isObject(child)) {
      element(origin.path, [...origin.parts, name], name, child, owner.namespace, owner, false, owner.variables);
    }
  }
  function element(path, parts, rawKey, value, namespace, parent, top, inheritedVariables) {
    if (!isObject(value)) editFail('EDIT_UI_STRUCTURE', 'UI 要素の定義にはオブジェクトが必要です。', `${path}#${pointerJoin(parts)}`);
    if (nodes.length >= WORKSPACE_EDIT_LIMITS.maxElements) editFail('EDIT_ELEMENT_LIMIT', 'UI 要素数の上限を超えました。');
    const parsed = parseDefinitionKey(rawKey);
    if (!rawKey || /[\u0000-\u001f\u007f]/u.test(rawKey) || rawKey.includes('@') && (!parsed.baseRef || rawKey.startsWith('@'))) {
      editFail('EDIT_UI_NAME_INVALID', 'UI 要素名または継承指定が不正です。', `${path}#${pointerJoin(parts)}`);
    }
    const pointer = pointerJoin(parts);
    const ownName = namespace ? `${namespace}.${parsed.localName}` : parsed.localName;
    const node = { id: identity(path, pointer), path, pointer, ...sourceFields(sources?.get(path)), parentPointer: parent?.pointer ?? null, rawKey, localName: parsed.localName,
      qualifiedName: top ? ownName : `${parent.qualifiedName}/${parsed.localName}`, namespace, isDefinition: top,
      baseRef: parsed.baseRef, type: typeof value.type === 'string' ? value.type : null, props: Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'controls')),
      parentId: parent?.id ?? null, childIds: [], inheritedIds: [], value, variables: inheritedVariables };
    const declarations = new Map(), declarationOrigins = new Map();
    for (const [key, item] of Object.entries(value)) if (key.startsWith('$')) {
      const [name, modifier] = key.split('|');
      if (modifier !== 'default' || !findVariable(inheritedVariables, name).found && !declarations.has(name)) {
        declarations.set(name, item); declarationOrigins.set(name, { path, parts: [...parts, key], owner: node });
      }
    }
    // 条件分岐を実行時評価してはならない。候補を断定できない変数は未解決として残す。
    if (Array.isArray(value.variables)) for (const branch of value.variables) if (isObject(branch)) {
      for (const key of Object.keys(branch)) if (key.startsWith('$')) {
        declarations.set(key.split('|')[0], null); declarationOrigins.delete(key.split('|')[0]);
      }
    }
    // 全グローバル変数を全2万要素へ複製しない。局所差分だけの不変スコープを連結する。
    if (declarations.size) node.variables = { values: declarations, origins: declarationOrigins, parent: inheritedVariables };
    nodes.push(node);
    nodeMap.set(node.id, node);
    parent?.childIds.push(node.id);
    if (top && node.active !== false) {
      if (!symbols.has(ownName)) symbols.set(ownName, []);
      symbols.get(ownName).push(node.id);
    }
    if (parsed.baseRef) references.push({ node, raw: parsed.baseRef, kind: 'inheritance' });
    if (rawKey.startsWith('$')) references.push({ node, raw: rawKey, kind: 'dynamic-name' });
    for (const [key, item] of Object.entries(value)) {
      if (key === 'type' && (typeof item !== 'string' || !item.trim())) editFail('EDIT_UI_STRUCTURE', 'type は空でない文字列で指定してください。', `${path}#${pointer}/${key}`);
      const unitless = unitlessDimensionComponents(key, item);
      if (unitless.length) {
        const propertyPointer = `${pointer}/${key}`;
        const locations = unitless.map(index => {
          const componentPointer = propertyPointer + (index === null ? '' : `/${index}`);
          return sourceLocation(path, componentPointer);
        });
        diagnose('EDIT_UI_PROPERTY_INVALID', `${key} の数値文字列に単位がありません。数値 JSON または px / % 付きの文字列を指定してください。`, node, 'error',
          { pointer: propertyPointer, locationKey: `${node.qualifiedName}/${key}`,
            valueFingerprint: createHash('sha256').update(JSON.stringify(item)).digest('hex'),
            reason: 'DIMENSION_UNITLESS_NUMBER', value_type: Array.isArray(item) ? 'array' : typeof item, component_value_type: 'string', component_locations: locations });
      }
      const vectorValid = typeof item === 'string' || Array.isArray(item) && item.length === 2 && item.every(part => typeof part === 'string' || typeof part === 'number' && Number.isFinite(part));
      const invalidKind = VECTOR_PROPERTIES.has(key) && !vectorValid ? '2 要素の座標・寸法配列、または式の文字列'
        : STRING_PROPERTIES.has(key) && typeof item !== 'string' ? '文字列'
        : BOOLEAN_PROPERTIES.has(key) && !['boolean', 'string'].includes(typeof item) ? '真偽値または式の文字列'
        : NUMBER_PROPERTIES.has(key) && !['number', 'string'].includes(typeof item) ? '数値または式の文字列' : null;
      if (invalidKind) {
        diagnose('EDIT_UI_PROPERTY_INVALID', `${key} は ${invalidKind}で指定してください。`, node, 'error',
          { pointer: `${pointer}/${key}`, locationKey: `${node.qualifiedName}/${key}`, valueFingerprint: createHash('sha256').update(JSON.stringify(item)).digest('hex') });
      }
      if (['bindings', 'modifications'].includes(key) && !(Array.isArray(item) || typeof item === 'string')) editFail('EDIT_UI_STRUCTURE', `${key} は配列または式の文字列で指定してください。`, `${path}#${pointer}/${key}`);
      if (key === 'bindings' && Array.isArray(item)) for (const [index, binding] of item.entries()) {
        if (!isObject(binding) || binding.ignored === true || classifyUiBindingType(binding.binding_type, Object.hasOwn(binding, 'binding_type')) !== 'other') continue;
        unsupportedBindingTypeCount += 1;
        if (unsupportedBindingTypeCount > 64) {
          if (unsupportedBindingTypeCount === 65) diagnose('EDIT_BINDING_TYPE_WARNING_LIMIT', '未対応bindingの詳細は先頭64件です。残りの詳細は省略します。', node, 'warning',
            { maxDetails: 64, additionalWarningsOmitted: true });
          continue;
        }
        const bindingPointer = `${pointer}/bindings/${index}/binding_type`;
        diagnose('EDIT_BINDING_TYPE_UNSUPPORTED', '未対応の binding_type です。プレビューではこのbindingを実行せず、原文の型と値を保持します。', node, 'warning',
          { pointer: bindingPointer, jsonPath: bindingPointer, binding_index: index,
            ...describeUiBindingType(binding.binding_type), location: sourceLocation(path, bindingPointer) });
      }
      if (key === 'controls') {
        if (typeof item === 'string') {
          // Keep a conservative reference for deletion: another derived caller
          // may override the variable. Index only the exact literal source we
          // can locate for source selection/property editing in this scope.
          references.push({ node, raw: item, kind: 'dynamic-controls' });
          let value = item, origin = null;
          const seen = new Set();
          while (typeof value === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(value)
            && !seen.has(value) && seen.size < WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth) {
            seen.add(value); const found = findVariable(node.variables, value);
            if (!found.found) break;
            value = found.value; origin = found.origin;
          }
          indexLiteralControlSource(value, origin);
          continue;
        }
        if (isObject(item)) {
          for (const [childName, childValue] of Object.entries(item)) {
            element(path, [...parts, 'controls', childName], childName, childValue, namespace, node, false, node.variables);
          }
          continue;
        }
        if (!Array.isArray(item)) editFail('EDIT_UI_STRUCTURE', 'controls は配列・要素の対応表・式の文字列で指定してください。', `${path}#${pointer}/controls`);
        item.forEach((child, index) => {
          if (!isObject(child) || Object.keys(child).length !== 1) editFail('EDIT_UI_STRUCTURE', 'controls の各項目には 1 つの UI 要素を指定してください。', `${path}#${pointer}/controls/${index}`);
          const [childName, childValue] = Object.entries(child)[0];
          element(path, [...parts, 'controls', index, childName], childName, childValue, namespace, node, false, node.variables);
        });
      }
      if (['grid_item_template', 'collection_item_template'].includes(key)) references.push({ node, raw: item, kind: 'template' });
      if (key === 'factory' && isObject(item)) {
        if (Object.hasOwn(item, 'control_name')) references.push({ node, raw: item.control_name, kind: 'factory' });
        if (Object.hasOwn(item, 'control_ids')) factoryMaps.push({ node, raw: item.control_ids });
      }
      if (key === 'control_name') factoryNames.push({ node, raw: item });
      if (key === 'control_ids') factoryMaps.push({ node, raw: item, needsFactoryType: true });
      if (key === 'modifications' && Array.isArray(item)) {
        item.forEach((modification, modificationIndex) => {
          if (!isObject(modification)) editFail('EDIT_UI_STRUCTURE', 'modifications の各項目にはオブジェクトが必要です。', `${path}#${pointer}/modifications/${modificationIndex}`);
          // Match the resolver's implicit controls selector; do not lose the
          // authored body of a control_name-only replacement.
          const arrayName = String(modification.array_name || (typeof modification.control_name === 'string' ? 'controls' : '')).trim();
          if (arrayName !== 'controls' || !Object.hasOwn(modification, 'value')) return;
          const additions = Array.isArray(modification.value) ? modification.value : [modification.value];
          additions.forEach((addition, additionIndex) => {
            if (!isObject(addition) || Object.keys(addition).length !== 1) {
              references.push({ node, raw: modification.value, kind: 'dynamic-modification' }); return;
            }
            const [name, props] = Object.entries(addition)[0];
            const prefix = [...parts, 'modifications', modificationIndex, 'value'];
            if (Array.isArray(modification.value)) prefix.push(additionIndex);
            element(path, [...prefix, name], name, props, namespace, node, false, node.variables);
          });
        });
      }
    }
  }
  for (const [path, tree] of trees) {
    if (/(?:^|\/)_[^/]+\.jsonc?$/iu.test(path)) {
      if (/(?:^|\/)_ui_defs\.jsonc?$/iu.test(path) && (!Array.isArray(tree.value.ui_defs) || tree.value.ui_defs.some(value => typeof value !== 'string'))) editFail('EDIT_UI_STRUCTURE', '_ui_defs の ui_defs にはパス文字列の配列が必要です。', path);
      continue;
    }
    if (Object.hasOwn(tree.value, 'namespace') && typeof tree.value.namespace !== 'string') editFail('EDIT_UI_STRUCTURE', 'namespace は文字列で指定してください。', path);
    const namespace = tree.value.namespace?.trim() ?? '';
    for (const [rawKey, value] of Object.entries(tree.value)) {
      if (METADATA.has(rawKey) || rawKey.startsWith('$')) continue;
      element(path, [rawKey], rawKey, value, namespace, null, true, { values: globalVariables, parent: null });
    }
  }
  // A derived definition may supply only $children while inheriting the
  // actual controls:"$children" field. Index its literal declaration as well;
  // selecting the resolved child must not be limited to variables declared on
  // the same object as the controls field. Source indexing does not claim this
  // candidate is active in every runtime/caller context.
  for (const start of nodes) {
    if (!start.baseRef || Object.hasOwn(start.value, 'controls')) continue;
    const seen = new Set(), scopes = [];
    let current = start;
    const resolveVariable = raw => {
      const aliases = new Set(); let value = raw, origin = null;
      while (typeof value === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(value)
        && !aliases.has(value) && aliases.size < WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth) {
        aliases.add(value);
        const found = scopes.map(scope => findVariable(scope, value)).find(result => result.found);
        if (!found) break;
        value = found.value; origin = found.origin;
      }
      return { value, origin };
    };
    while (current && !seen.has(current.id) && seen.size < WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth) {
      seen.add(current.id); scopes.push(current.variables);
      if (Object.hasOwn(current.value, 'controls')) {
        if (typeof current.value.controls === 'string') {
          const resolved = resolveVariable(current.value.controls);
          indexLiteralControlSource(resolved.value, resolved.origin);
        }
        break;
      }
      if (!current.baseRef) break;
      const resolved = resolveVariable(current.baseRef);
      const parsed = typeof resolved.value === 'string' ? parseFixedControlSpec(resolved.value, current.namespace) : { ok: false };
      if (!parsed.ok) break;
      const targets = layeredReferenceTargets({ node: current, raw: current.baseRef, kind: 'inheritance' }, parsed.qualifiedName,
        (symbols.get(parsed.qualifiedName) || []).map(id => nodeMap.get(id)), sources !== null);
      if (targets.length !== 1) break;
      current = targets[0];
    }
  }
  const unresolved = [];
  // raw type がない派生要素でも、固定の継承経路から factory と確定できる場合を扱う。
  // 明示した非factory型の同名プロパティは有効なfactory参照とみなさない。
  function factoryType(node, visited = new Set()) {
    if (visited.has(node.id) || visited.size >= WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth) return 'unknown';
    visited.add(node.id);
    if (typeof node.value.type === 'string') {
      const type = node.value.type.trim().toLowerCase();
      return type === 'factory' ? 'factory' : type.startsWith('$') || type.startsWith('(') ? 'unknown' : 'other';
    }
    let kind = 'inheritance', raw = node.baseRef;
    if (!raw && sources && node.isDefinition && Array.isArray(node.value.modifications) && node.value.modifications.length) {
      raw = node.qualifiedName; kind = 'implicit-layer-base';
    }
    if (!raw) return 'other';
    if (raw.startsWith('$')) return 'unknown';
    const parsed = parseFixedControlSpec(raw, node.namespace);
    if (!parsed.ok) return 'unknown';
    const targets = layeredReferenceTargets({ node, kind }, parsed.qualifiedName,
      (symbols.get(parsed.qualifiedName) || []).map(id => nodeMap.get(id)), sources !== null);
    return targets.length === 1 ? factoryType(targets[0], visited) : 'unknown';
  }
  for (const reference of factoryNames) {
    if (reference.node.active === false) continue;
    const type = factoryType(reference.node);
    if (type !== 'other') references.push({ ...reference, kind: type === 'factory' ? 'factory' : 'dynamic-factory-type' });
  }
  // control_ids 自体が $変数で供給される公式定義もある。非objectを無視すると削除後に参照が残る。
  let factoryReferenceCount = 0;
  for (const map of factoryMaps) {
    if (map.node.active === false) continue;
    map.references = [];
    const addReference = (raw, kind) => {
      const reference = { node: map.node, raw, kind, factoryMap: map };
      map.references.push(reference); references.push(reference);
    };
    if (map.needsFactoryType) {
      const type = factoryType(map.node);
      if (type === 'other') continue;
      if (type === 'unknown') { addReference(map.raw, 'dynamic-factory-type'); continue; }
    }
    let raw = map.raw;
    const visited = new Set();
    while (typeof raw === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(raw)) {
      if (visited.has(raw) || visited.size >= WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth) break;
      visited.add(raw);
      const variable = findVariable(map.node.variables, raw);
      if (!variable.found) break;
      raw = variable.value;
    }
    map.scopeDependent = visited.size > 0;
    if (!isObject(raw)) {
      addReference(map.raw, 'dynamic-factory-map');
      continue;
    }
    const values = Object.values(raw);
    factoryReferenceCount += values.length;
    if (factoryReferenceCount > WORKSPACE_EDIT_LIMITS.maxFactoryReferences) editFail('EDIT_FACTORY_REFERENCE_LIMIT', 'factory の参照候補数上限を超えました。');
    map.scopeDependent ||= values.some(value => typeof value === 'string' && value.startsWith('$'));
    for (const value of values) addReference(value, 'factory');
  }
  // modifications だけを載せる上位定義の暗黙基底も既存プレビュー解決系と対応させる。
  if (sources) for (const node of nodes) {
    if (node.active === false || !node.isDefinition || node.baseRef || !Array.isArray(node.value.modifications) || !node.value.modifications.length) continue;
    const candidates = (symbols.get(node.qualifiedName) || []).map(id => nodeMap.get(id));
    if (candidates.some(candidate => candidate.precedence < node.precedence)) {
      references.push({ node, raw: node.qualifiedName, kind: 'implicit-layer-base' });
    }
  }
  for (const reference of references) {
    if (reference.node.active === false) continue;
    let raw = reference.raw;
    const visited = new Set();
    while (!reference.kind.startsWith('dynamic-') && typeof raw === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(raw)
      && findVariable(reference.node.variables, raw).found && !visited.has(raw)
      && (!reference.factoryMap || visited.size < WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth)) {
      visited.add(raw);
      raw = findVariable(reference.node.variables, raw).value;
    }
    const parsed = typeof raw === 'string' ? parseFixedControlSpec(raw, reference.node.namespace) : { ok: false };
    if (!parsed.ok || reference.kind.startsWith('dynamic-')) {
      const item = { ...reference, reason: 'dynamic' };
      unresolved.push(item);
      diagnose('EDIT_REFERENCE_DYNAMIC', '動的な要素参照の影響範囲は、この原文検査だけでは確定できません。', reference.node);
      continue;
    }
    const targets = layeredReferenceTargets(reference, parsed.qualifiedName,
      (symbols.get(parsed.qualifiedName) || []).map(id => nodeMap.get(id)), sources !== null);
    if (targets.length !== 1) {
      unresolved.push({ ...reference, reason: targets.length ? 'ambiguous' : 'missing', target: parsed.qualifiedName });
      diagnose(targets.length ? 'EDIT_REFERENCE_AMBIGUOUS' : 'EDIT_REFERENCE_MISSING', targets.length ? '要素参照に複数の定義候補があります。' : '要素参照の定義が作業領域内に見つかりません。', reference.node);
      continue;
    }
    reference.targetId = targets[0].id;
    reference.node.inheritedIds.push(targets[0].id);
  }
  // 原文索引では、基底の変数や呼出し元からの引数を全インスタンスについて解決していない。
  // 継承・利用文脈で上書きされ得るmapを、局所値だけから確定したことにしない。
  const containingDefinition = new Map();
  for (const node of nodes) containingDefinition.set(node.id, node.isDefinition ? node.id : containingDefinition.get(node.parentId));
  const referencedDefinitions = new Set(references.filter(reference => reference.targetId
    && containingDefinition.get(reference.node.id) !== reference.targetId).map(reference => reference.targetId));
  let removedFactoryEdges = false;
  for (const map of factoryMaps) {
    if (!map.scopeDependent || map.node.active === false) continue;
    let node = map.node, unknownScope = false;
    while (node) {
      if (node.baseRef || node.isDefinition && referencedDefinitions.has(node.id)) unknownScope = true;
      node = node.parentId ? nodeMap.get(node.parentId) : null;
    }
    if (!unknownScope) continue;
    const reference = { node: map.node, raw: map.raw, kind: 'dynamic-factory-map-scope', reason: 'dynamic' };
    unresolved.push(reference);
    diagnose('EDIT_REFERENCE_DYNAMIC', '継承または利用元による factory 変数の上書きを確定できないため、削除影響を断定しません。', map.node);
    for (const item of map.references) if (item.targetId) { delete item.targetId; removedFactoryEdges = true; }
  }
  if (removedFactoryEdges) {
    for (const node of nodes) node.inheritedIds = [];
    for (const reference of references) if (reference.targetId) reference.node.inheritedIds.push(reference.targetId);
  }
  const colors = new Map();
  for (const node of nodes) {
    if (colors.has(node.id)) continue;
    const stack = [{ id: node.id, leave: false }];
    while (stack.length) {
      const item = stack.pop();
      if (item.leave) { colors.set(item.id, 2); continue; }
      if (colors.get(item.id) === 2) continue;
      if (colors.get(item.id) === 1) {
        const cyclic = nodeMap.get(item.id);
        diagnose('EDIT_INHERITANCE_CYCLE', '継承または子要素展開に循環があります。', cyclic, 'error');
        continue;
      }
      colors.set(item.id, 1);
      stack.push({ id: item.id, leave: true });
      const current = nodeMap.get(item.id);
      for (const next of [...current.childIds, ...current.inheritedIds]) stack.push({ id: next, leave: false });
    }
  }
  return { revision, sources, trees, nodes, nodeMap, symbols, diagnostics, references, unresolved, previewAllowed: !diagnostics.some(item => item.severity === 'error') };
}

function publicNode(node) {
  const { id, path, pointer, parentPointer, rawKey, localName, qualifiedName, namespace, isDefinition, baseRef, type, props } = node;
  return { id, path, pointer, parentPointer, rawKey, localName, qualifiedName, namespace, isDefinition, baseRef, type, props,
    ...(node.sourceId ? { sourceId: node.sourceId, sourceKind: node.sourceKind, physicalPath: node.physicalPath,
      precedence: node.precedence, active: node.active } : {}) };
}

/** 構文・基本 UI 構造・確定展開循環を検査し、原文位置の一覧を返す。 */
export function inspectWorkspace({ documents, documentSources } = {}) {
  try {
    const data = inspect(documents, documentSources);
    return { ok: true, revision: data.revision, previewAllowed: data.previewAllowed, diagnostics: data.diagnostics, nodes: data.nodes.map(publicNode) };
  } catch (error) { return failure(error); }
}

function requireNode(data, path, pointer) {
  const node = data.nodeMap.get(identity(path, pointer));
  if (!node) editFail('EDIT_ELEMENT_NOT_FOUND', '指定位置には編集可能な UI 要素がありません。', `${path}#${pointer}`);
  return node;
}

function deletionPlan(data, path, pointer) {
  const root = requireNode(data, path, pointer);
  const affected = new Set();
  const reverse = new Map();
  for (const ref of data.references) if (ref.targetId) {
    if (!reverse.has(ref.targetId)) reverse.set(ref.targetId, []);
    reverse.get(ref.targetId).push(ref.node.id);
  }
  const queue = [root.id];
  const reasons = new Map([[root.id, 'selected']]);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (affected.has(id)) continue;
    affected.add(id);
    const node = data.nodeMap.get(id);
    const enqueue = (ids, reason) => { for (const next of ids) { if (!reasons.has(next)) reasons.set(next, reason); queue.push(next); } };
    enqueue(node.childIds, 'descendant');
    enqueue(reverse.get(id) || [], 'reference');
    // 空の上位文書だけでは tombstone にならない。同 symbol の全候補を同時削除する。
    if (data.sources && node.isDefinition) enqueue(data.symbols.get(node.qualifiedName) || [], 'fallback-candidate');
  }
  // 不明な参照が削除対象の子に閉じていれば問題ない。外側の不明参照は推測しない。
  const deletingDefinition = [...affected].some(id => data.nodeMap.get(id).isDefinition);
  // 継承参照はカタログのトップレベル定義を対象とする。子だけの削除では定義表を変えない。
  const uncertain = deletingDefinition ? data.unresolved.filter(ref => !affected.has(ref.node.id) && ref.reason !== 'missing') : [];
  if (uncertain.length) editFail('EDIT_DELETE_IMPACT_UNKNOWN', '影響範囲を確定できない動的または曖昧な参照があります。削除は実行していません。', `${path}#${pointer}`,
    { references: uncertain.slice(0, 64).map(ref => ({ path: ref.node.path, pointer: ref.node.pointer,
      ...sourceFields(data.sources?.get(ref.node.path)), reason: ref.reason })) });
  const all = data.nodes.filter(node => affected.has(node.id));
  const removals = all.filter(node => !node.parentId || !affected.has(node.parentId));
  const plannedNode = node => ({ ...publicNode(node), ...(data.sources ? { reason: reasons.get(node.id) } : {}) });
  return { root: plannedNode(root), affected: all.map(plannedNode), removals: removals.map(plannedNode), count: all.length, fileCount: new Set(removals.map(node => node.path)).size };
}

function controlsShapeForAddition(data, start) {
  const seen = new Set();
  function visit(node, callerScopes = []) {
    if (!node || seen.has(node.id) || seen.size >= WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth) return { kind: 'unknown', names: new Set() };
    seen.add(node.id);
    const callScopes = [...callerScopes, node.variables];
    const ownNames = new Set(node.childIds.map(id => data.nodeMap.get(id).localName));
    let own = null;
    if (Object.hasOwn(node.value, 'controls')) {
      let value = node.value.controls;
      const aliases = new Set();
      while (typeof value === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(value)
        && !aliases.has(value) && aliases.size < WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth) {
        aliases.add(value);
        const found = callScopes.map(scope => findVariable(scope, value)).find(result => result.found);
        if (!found) break;
        value = found.value;
      }
      if (Array.isArray(value)) {
        for (const wrapper of value) if (isObject(wrapper)) for (const name of Object.keys(wrapper)) ownNames.add(parseDefinitionKey(name).localName);
        // A derived array replaces its base array/map entirely.
        return { kind: 'array', names: ownNames };
      }
      if (!isObject(value)) return { kind: 'unknown', names: ownNames };
      for (const name of Object.keys(value)) ownNames.add(parseDefinitionKey(name).localName);
      own = 'map';
    }
    const bases = data.references.filter(reference => reference.node.id === node.id
      && ['inheritance', 'implicit-layer-base'].includes(reference.kind));
    if (!bases.length) return { kind: own || 'none', names: ownNames };
    if (bases.length !== 1 || !bases[0].targetId) return { kind: 'unknown', names: ownNames };
    const base = visit(data.nodeMap.get(bases[0].targetId), callScopes);
    if (base.kind === 'unknown') return base;
    // Object-map controls merge through every object-map base. Stop inheriting
    // children if that map replaces an array; otherwise deep names survive.
    if (!own || base.kind === 'map') for (const name of base.names) ownNames.add(name);
    return { kind: own || base.kind, names: ownNames };
  }
  return visit(start);
}

function operationText(data, documents, operation) {
  const { type, path } = operation;
  validPath(path);
  if (!Object.hasOwn(documents, path)) editFail('EDIT_DOCUMENT_NOT_FOUND', '指定されたファイルが作業領域にありません。', path);
  const text = documents[path];
  const tree = data.trees.get(path);
  const pointer = operation.pointer ?? '';
  pointerParts(pointer);
  if (type === 'set') {
    const parts = pointerParts(pointer);
    const component = /^(?:0|1)$/u.test(parts.at(-1) || '');
    const property = component ? parts.at(-2) : parts.at(-1);
    const ownerPointer = pointerJoin(parts.slice(0, component ? -2 : -1));
    if (data.nodeMap.has(identity(path, ownerPointer)) && unitlessDimensionComponents(property, operation.value).length) {
      editFail('EDIT_UI_PROPERTY_INVALID', '寸法の数値文字列に単位がありません。数値 JSON または px / % 付きの文字列を指定してください。',
        `${path}#${pointer}`, { reason: 'DIMENSION_UNITLESS_NUMBER', value_type: Array.isArray(operation.value) ? 'array' : typeof operation.value });
    }
    return { [path]: setEditableValue(text, tree, pointer, operation.value) };
  }
  if (type === 'move') {
    requireNode(data, path, pointer);
    if (!Array.isArray(operation.offset) || operation.offset.length !== 2 || !operation.offset.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000)) editFail('EDIT_OFFSET_INVALID', '移動位置は有限な数値 2 個で指定してください。');
    return { [path]: setEditableValue(text, tree, `${pointer}/offset`, operation.offset) };
  }
  if (type === 'inherit') {
    const node = requireNode(data, path, pointer);
    if (operation.baseRef !== null && (typeof operation.baseRef !== 'string' || !parseFixedControlSpec(operation.baseRef, node.namespace).ok || operation.baseRef.includes('@'))) editFail('EDIT_INHERITANCE_INVALID', '継承元は固定の定義名、解除時は null を指定してください。');
    const name = operation.baseRef === null ? node.localName : `${node.localName}@${operation.baseRef}`;
    return { [path]: renameEditableKey(text, tree, pointer, name) };
  }
  if (type === 'add') {
    const parentPointer = operation.parentPointer ?? pointer;
    pointerParts(parentPointer);
    if (typeof operation.name !== 'string' || !operation.name.trim() || operation.name.length > 512 || !isObject(operation.value)) editFail('EDIT_ADD_INVALID', '追加する要素の名前と定義オブジェクトを指定してください。');
    if (parentPointer === '') {
      if (METADATA.has(operation.name) || operation.name.startsWith('$')) editFail('EDIT_ADD_INVALID', '追加する UI 定義にはメタデータや変数と異なる要素名を指定してください。');
      if (tree.entries.some(entry => entry.key === operation.name)) editFail('EDIT_NAME_CONFLICT', '同じ名前の定義がすでに存在します。');
      return { [path]: setEditableValue(text, tree, pointerJoin([operation.name]), operation.value) };
    }
    const parent = requireNode(data, path, parentPointer);
    if (parent.childIds.some(id => data.nodeMap.get(id).localName === parseDefinitionKey(operation.name).localName)) editFail('EDIT_NAME_CONFLICT', '同じ親の中に同じ名前の要素が存在します。');
    const controls = `${parentPointer}/controls`;
    const insertion = { [operation.name]: operation.value };
    if (!Object.hasOwn(parent.value, 'controls')) {
      // Preserve inherited children, matching the resolver's array-replace / 
      // object-merge behavior. A modification cannot insert into a missing
      // array or an object map, so establish the actual static shape first.
      const inherited = controlsShapeForAddition(data, parent);
      if (inherited.kind === 'unknown') editFail('EDIT_DYNAMIC_CONTROLS', '継承された controls の形式を確定できないため、既存要素を保持した追加を実行できません。');
      if (inherited.names.has(parseDefinitionKey(operation.name).localName)) editFail('EDIT_NAME_CONFLICT', '継承された要素と同じ名前の要素がすでに存在します。');
      if (inherited.kind === 'map') return { [path]: setEditableValue(text, tree, controls, insertion) };
      if (inherited.kind === 'array') {
        const modification = { array_name: 'controls', operation: 'insert_back', value: [insertion] };
        const modificationsPointer = `${parentPointer}/modifications`;
        if (!Object.hasOwn(parent.value, 'modifications')) {
          return { [path]: setEditableValue(text, tree, modificationsPointer, [modification]) };
        }
        if (!Array.isArray(parent.value.modifications)) editFail('EDIT_DYNAMIC_CONTROLS', '動的 modifications の内容を上書きせず追加することはできません。');
        return { [path]: insertEditableArrayValue(text, tree, modificationsPointer, parent.value.modifications.length, modification) };
      }
      return { [path]: setEditableValue(text, tree, controls, [insertion]) };
    }
    if (isObject(parent.value.controls)) {
      const inherited = controlsShapeForAddition(data, parent);
      if (inherited.kind === 'unknown') editFail('EDIT_DYNAMIC_CONTROLS', '継承された controls の形式を確定できないため、既存要素を保持した追加を実行できません。');
      if (inherited.names.has(parseDefinitionKey(operation.name).localName)) editFail('EDIT_NAME_CONFLICT', '継承された要素と同じ名前の要素がすでに存在します。');
      return { [path]: setEditableValue(text, tree, `${controls}/${pointerJoin([operation.name]).slice(1)}`, operation.value) };
    }
    if (!Array.isArray(parent.value.controls)) editFail('EDIT_DYNAMIC_CONTROLS', '動的 controls の内容を上書きせず追加することはできません。');
    return { [path]: insertEditableArrayValue(text, tree, controls, operation.index ?? parent.value.controls.length, insertion) };
  }
  editFail('EDIT_OPERATION_INVALID', '未対応の編集操作です。', 'operation.type');
}

/**
 * @param {{documents: Record<string,string>, operation: object, expectedRevision?: string}} request
 * @returns {object} 成功時の documents / changes は原文。無効な変更は返さず原本を保持。
 */
export function editWorkspace({ documents, documentSources, operation, expectedRevision, authoredCopies = [] } = {}) {
  try {
    const beforeRevision = workspaceRevision(documents, documentSources);
    if (expectedRevision !== undefined && expectedRevision !== beforeRevision) editFail('EDIT_REVISION_CONFLICT', '編集前の状態が更新されています。最新の原文を取得してください。', 'expectedRevision');
    if (!isObject(operation) || typeof operation.type !== 'string') editFail('EDIT_OPERATION_INVALID', '編集操作と操作種別を指定してください。');
    // 構文を壊した草稿の修復も可能にするため、直接置換は旧本文の解析より先に適用。
    let changes;
    let deletePlan;
    let before;
    if (operation.type === 'replaceTexts') {
      const entries = checkedDocuments(operation.texts);
      changes = Object.create(null);
      for (const [path, text] of entries) {
        if (!Object.hasOwn(documents, path)) editFail('EDIT_DOCUMENT_NOT_FOUND', '一括編集は既存の文書だけを対象にできます。', path);
        changes[path] = text;
      }
    } else if (operation.type === 'replaceText') {
      validPath(operation.path);
      if (!Object.hasOwn(documents, operation.path)) editFail('EDIT_DOCUMENT_NOT_FOUND', '指定されたファイルが作業領域にありません。', operation.path);
      if (typeof operation.text !== 'string') editFail('EDIT_TEXT_INVALID', '置換する JSONC 原文は文字列で指定してください。');
      changes = { [operation.path]: operation.text };
    } else {
      before = inspect(documents, documentSources);
      if (operation.type === 'planDelete' || operation.type === 'delete') {
        deletePlan = deletionPlan(before, operation.path, operation.pointer);
        if (operation.type === 'planDelete') return { ok: true, revision: beforeRevision, beforeRevision, documents, changes: [], deletePlan, diagnostics: before.diagnostics, previewAllowed: before.previewAllowed };
        if (operation.cascade !== true && deletePlan.count > 1) editFail('EDIT_CASCADE_REQUIRED', '継承先と子要素を含む削除には cascade:true を指定してください。');
        changes = Object.create(null);
        // 配列内の兄弟は後ろから削除する。元の AST 上の順序を使い、番号ずれを避ける。
        const removals = [...deletePlan.removals].map(node => ({ ...node, start: findEditableNode(before.trees.get(node.path), pointerParts(node.pointer)).node.start })).sort((a, b) => b.start - a.start);
        for (const node of removals) {
          const old = changes[node.path] ?? documents[node.path];
          const parts = pointerParts(node.pointer);
          let removal = node.pointer;
          if (parts.length >= 3 && /^(0|[1-9]\d*)$/u.test(String(parts.at(-2)))) removal = pointerJoin(parts.slice(0, -1));
          else if (parts.at(-2) === 'value' && parts.at(-4) === 'modifications' && /^(0|[1-9]\d*)$/u.test(String(parts.at(-3)))) removal = pointerJoin(parts.slice(0, -2));
          changes[node.path] = removeEditableValue(old, parseEditableJsonc(old, node.path), removal);
        }
      } else changes = operationText(before, documents, operation);
    }
    const updated = Object.assign(Object.create(null), documents, changes);
    // 旧原文の全ASTと全索引を、新原文の解析中まで保持しない。旧側から後続の
    // 比較に必要なのは診断と複製元の存在だけで、元ノードやpropsは保持しない。
    // 直接置換による構文修復では、従来通り旧側の解析失敗を許容する。
    let cachedBaseline;
    if (!before && operation.type === 'replaceTexts') {
      const metadata = baselineMetadataKey36(documents, documentSources);
      const candidate = metadata === null ? null : baselineProofs36.get(documents);
      if (candidate?.revision === beforeRevision && candidate.metadata === metadata
        && candidate.texts.length === Object.keys(documents).length
        && candidate.texts.every(([path, text]) => Object.hasOwn(documents, path) && documents[path] === text)) {
        cachedBaseline = candidate; baselineStats36.hits++;
      } else { baselineStats36.misses++; if (metadata === null) baselineStats36.bypasses++; }
    }
    if (!before && !cachedBaseline) { try { before = inspect(documents, documentSources); } catch (error) { if (!(error instanceof WorkspaceEditError)) throw error; } }
    const beforeDiagnostics = cachedBaseline?.diagnostics ?? before?.diagnostics ?? [];
    // Scoped edits copy original definitions verbatim before changing a leaf.
    // An unchanged malformed property in such a copy is the same pre-existing
    // input defect, not a defect introduced by moving an unrelated button.
    // Only exact source-pointer + value-fingerprint matches qualify; cycles,
    // new invalid values and every other error remain rejection conditions.
    if (!Array.isArray(authoredCopies) || authoredCopies.length > 128) editFail('EDIT_COPY_PROOF_INVALID', '原文複製の照合情報が不正です。');
    for (const copy of authoredCopies) {
      validPath(copy.from?.path); validPath(copy.to?.path);
      pointerParts(copy.from?.pointer); pointerParts(copy.to?.pointer);
      if (pointerParts(copy.from.pointer).length !== 1 || pointerParts(copy.to.pointer).length !== 1) editFail('EDIT_COPY_PROOF_INVALID', '原文複製の照合は最上位定義だけを対象にできます。');
      if (cachedBaseline) {
        if (!cachedBaseline.nodeIds.has(identity(copy.from.path, copy.from.pointer))) editFail('EDIT_ELEMENT_NOT_FOUND',
          '指定位置には編集可能な UI 要素がありません。', `${copy.from.path}#${copy.from.pointer}`);
      } else requireNode(before, copy.from.path, copy.from.pointer);
    }
    before = null;
    const after = inspect(updated, documentSources);
    for (const copy of authoredCopies) requireNode(after, copy.to.path, copy.to.pointer);
    // 公式原文にも局所的な不正値がある。無関係の既存問題で全編集を止めず、新規の不正を拒否。
    const signature = diagnostic => JSON.stringify([diagnostic.code, diagnostic.path, diagnostic.locationKey ?? diagnostic.pointer, diagnostic.valueFingerprint ?? '']);
    const previousErrors = new Map();
    for (const item of beforeDiagnostics) if (item.severity === 'error') previousErrors.set(signature(item), (previousErrors.get(signature(item)) ?? 0) + 1);
    const baselinePropertyErrors = new Set(beforeDiagnostics.filter(item => item.code === 'EDIT_UI_PROPERTY_INVALID')
      .map(item => JSON.stringify([item.path, item.pointer, item.valueFingerprint])));
    const introduced = after.diagnostics.filter(item => {
      if (item.severity !== 'error') return false;
      if (item.code === 'EDIT_UI_PROPERTY_INVALID' && authoredCopies.some(copy => item.path === copy.to.path
        && item.pointer.startsWith(copy.to.pointer + '/') && baselinePropertyErrors.has(JSON.stringify([
          copy.from.path, copy.from.pointer + item.pointer.slice(copy.to.pointer.length), item.valueFingerprint])))) return false;
      const key = signature(item), remaining = previousErrors.get(key) ?? 0;
      if (!remaining) return true;
      previousErrors.set(key, remaining - 1);
      return false;
    });
    if (introduced.length) {
      const code = introduced.some(item => item.code === 'EDIT_INHERITANCE_CYCLE') ? 'EDIT_INHERITANCE_CYCLE' : 'EDIT_UI_STRUCTURE';
      return { ...failure(new WorkspaceEditError(code, '無効な UI 構造または循環を含む編集は反映できません。'), introduced), beforeRevision };
    }
    const changedFiles = Object.entries(changes).filter(([path, text]) => documents[path] !== text).map(([path, text]) => ({ path,
      ...sourceFields(after.sources?.get(path)), before: documents[path], after: text }));
    storeBaseline36(updated, documentSources, after);
    return { ok: true, documents: updated, revision: after.revision, beforeRevision, changes: changedFiles, previewAllowed: after.previewAllowed,
      diagnostics: after.diagnostics, nodes: after.nodes.map(publicNode), ...(deletePlan ? { deletePlan } : {}) };
  } catch (error) { return failure(error); }
}
