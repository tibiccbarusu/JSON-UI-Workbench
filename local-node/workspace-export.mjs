import { classifyUiBindingType, describeUiBindingType } from '../editor-core/src/json/ui-binding-contract.js';
import { unitlessDimensionComponents } from '../editor-core/src/json/ui-dimension-contract.js';
/** Node.js 22.14+ の選択 UI 依存閉包サービス。入力パックへ書き込まない。 */
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { parseFixedControlSpec } from '../editor-core/src/engine/control-reference.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { parseLangFile, looksLikeLangKey } from '../editor-core/src/assets/lang-table.js';
import { scanJsonForExportDeps, extractExportRootVariables, EXPORT_ANIMATION_REFERENCES } from '../editor-core/src/pack-io/export-dependencies.js';
import { collectKnownNativeExportDependencies } from './workspace-export-native.mjs';
import { findOriginalExportEntry, preserveExportEntryPoint } from './workspace-export-entry.mjs';
import { normalizePackOptions, applyPackOptions, normalizePackIcon } from './pack-export-options.mjs';
import { canonicalUiDocument, inspectEngineFactoryProof, publicEngineFactoryProof, engineDependencyFacts,
  engineFixedUiReferences } from './workspace-export-engine.mjs';

export const WORKSPACE_EXPORT_LIMITS = Object.freeze({
  sources: 2, paths: 120000, files: 10000, definitions: 100000, selections: 256,
  textBytes: 8 * 1024 * 1024, totalTextBytes: 96 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024, expandedBytes: 192 * 1024 * 1024,
  zipBytes: 96 * 1024 * 1024, nodes: 1000000, depth: 128, diagnostics: 512,
});
const INTERNAL_SCOPE = '$__jsonui_export_scope_13';
const BUILTIN_FONTS = new Set(['default', 'unicode', 'smooth', 'minecraftten', 'rune']);
const TEXTURE_EXTENSIONS = ['.png', '.tga', '.jpg', '.jpeg'];
const SOUND_EXTENSIONS = ['.ogg', '.wav', '.fsb'];
const FIXED_ZIP_DATE = 33; // 1980-01-01, DOS time 00:00:00
// Names emitted by the game's inventory/screen controllers. Only terminal
// runtime values use this contract: arbitrary "$variables" and texture paths
// remain subject to the strict dependency proof.
const ENGINE_TEXT_BINDINGS = new Set([
  '#button_x_description', '#button_a_description', '#button_y_description', '#button_b_description',
  '#selected_hover_text', '#notification_text', '#item_name', '#inventory_stack_count', '#text',
  '#inventory_selected_item_stack_count', '#progressive_select_text', '#modal_left_button_text',
  '#modal_middle_button_text', '#modal_right_button_text', '#progress_label', '#selected_bundle_item_text', '#bundle_name',
  '#modal_rightcancel_button_text', '#dependency_label_text', '#more_hidden_items_text',
]);
const CONTROLLER_TEXTURE_BINDINGS = /^#controller_face_(left|right|up|down)_icon(?:_14)?$/u;
const ENGINE_FACTORY_CONTROLS = Object.freeze({
  storage_dependency_popup: 'storage_management_popup.storage_dependency_modal',
  storage_sharing_popup: 'storage_management_popup.sharing_popup_content',
});
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function folded(value) { return value.normalize('NFC').toLowerCase(); }
function sorted(values) { return [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0); }
function failure(code, detail = {}) { const error = new Error(code); error.code = code; error.detail = detail; throw error; }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'); }

/** ZIP 相対パス。OS の絶対パスや展開先として使用しない。 */
export function checkedWorkspaceExportPath(path) {
  if (typeof path !== 'string' || !path || path.length > 1024 || path !== path.normalize('NFC')
    || /[\\\u0000-\u001f\u007f<>:"|?*%]/u.test(path) || path.startsWith('/')) failure('EXPORT_PATH_UNSAFE');
  if (path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) failure('EXPORT_PATH_UNSAFE');
  return path;
}

function checkedLimits(raw = {}) {
  const result = { ...WORKSPACE_EXPORT_LIMITS };
  if (!object(raw)) failure('EXPORT_LIMITS_INVALID');
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(result, key) || !Number.isSafeInteger(value) || value < 1 || value > result[key]) failure('EXPORT_LIMITS_INVALID', { key });
    result[key] = value;
  }
  return result;
}

function checkedSources(input, limits) {
  if (!Array.isArray(input) || !input.length || input.length > limits.sources) failure('EXPORT_SOURCES_INVALID');
  const ids = new Set(), kinds = new Set();
  return input.map((source) => {
    if (!object(source) || typeof source.id !== 'string' || !source.id || source.id.length > 256
      || !['imported', 'vanilla'].includes(source.kind) || ids.has(source.id) || kinds.has(source.kind)
      || typeof source.readBytes !== 'function' || typeof source.readText !== 'function') failure('EXPORT_SOURCE_INVALID');
    ids.add(source.id); kinds.add(source.kind);
    const paths = source.paths ?? source.filePaths;
    if (!Array.isArray(paths) || paths.length > limits.paths) failure('EXPORT_PATH_COUNT_LIMIT');
    const index = new Map(), overrides = source.overrides ?? {};
    if (!object(overrides)) failure('EXPORT_OVERRIDES_INVALID');
    for (const path of paths) {
      checkedWorkspaceExportPath(path);
      if (index.has(folded(path))) failure('EXPORT_PATH_COLLISION', { sourceId: source.id, path });
      index.set(folded(path), path);
    }
    let overrideBytes = 0;
    for (const [path, value] of Object.entries(overrides)) {
      checkedWorkspaceExportPath(path);
      const actual = index.get(folded(path));
      if (actual && actual !== path) failure('EXPORT_PATH_COLLISION', { sourceId: source.id, path });
      if (typeof value !== 'string' || Buffer.byteLength(value) > limits.textBytes) failure('EXPORT_OVERRIDE_INVALID', { path });
      overrideBytes += Buffer.byteLength(value);
      if (overrideBytes > limits.totalTextBytes) failure('EXPORT_TEXT_TOTAL_LIMIT');
      index.set(folded(path), path);
    }
    if (index.size > limits.paths) failure('EXPORT_PATH_COUNT_LIMIT');
    return { ...source, index, overrides: { ...overrides }, precedence: source.kind === 'imported' ? 1 : 0 };
  }).sort((a, b) => b.precedence - a.precedence);
}

/** scanner の有限な字句スコープ解決を音声、全文字列、animation にも共用する。 */
function scanView(value, mode, state, depth = 0, origin = null) {
  if (depth > state.limits.depth || ++state.transformNodes > state.limits.nodes * 4) failure('EXPORT_SCAN_LIMIT');
  const childOrigin = key => origin ? { record: origin.record, pointer: origin.pointer + '/' + String(key).replace(/~/gu, '~0').replace(/\//gu, '~1') } : null;
  if (Array.isArray(value)) {
    const result = value.map((child, index) => scanView(child, mode, state, depth + 1, childOrigin(index)));
    if (origin) state.contractOrigins.set(result, origin);
    return result;
  }
  if (!object(value)) return value;
  const result = Object.create(null), animationRefs = Object.create(null);
  if (origin) state.contractOrigins.set(result, origin);
  for (const [key, child] of Object.entries(value)) {
    // Variable declarations must retain their original terminal values.
    if (key.startsWith('$')) { result[key] = object(child) || Array.isArray(child) ? scanView(child, mode, state, depth + 1, childOrigin(key)) : child; continue; }
    const displayText = ['text', 'place_holder_text', 'placeholder_text'].includes(key);
    if (mode === 'supplement' && (key.toLowerCase().endsWith('texture') || key === 'font_type' || displayText)) {
      if (displayText && typeof child === 'string') result[`__export_${key}_texture`] = child;
      continue;
    }
    if (mode === 'supplement' && key === 'sound_name') { result.font_type = child; continue; }
    result[key] = scanView(child, mode, state, depth + 1, childOrigin(key));
    if (key === 'anims' && Array.isArray(child)) child.forEach((ref, index) => { if (typeof ref === 'string') animationRefs[`a${index}`] = ref; });
    if (key === 'next' && value.anim_type && typeof child === 'string' && child) animationRefs.next = child;
    if (['alpha', 'offset', 'size', 'uv', 'color'].includes(key) && typeof child === 'string' && child.startsWith('@')) animationRefs[key] = child;
  }
  if (Object.keys(animationRefs).length) {
    result.__export_animation_refs = { control_ids: animationRefs };
    Object.defineProperty(result.__export_animation_refs, EXPORT_ANIMATION_REFERENCES, { value: true });
  }
  return result;
}

function boundedWalk(value, callback, state, depth = 0, path = '$') {
  if (depth > state.limits.depth || ++state.extraNodes > state.limits.nodes) failure('EXPORT_SCAN_LIMIT');
  callback(value, path);
  if (Array.isArray(value)) value.forEach((child, index) => boundedWalk(child, callback, state, depth + 1, `${path}[${index}]`));
  else if (object(value)) for (const [key, child] of Object.entries(value)) boundedWalk(child, callback, state, depth + 1, `${path}.${key}`);
}

function makeState(options) {
  const limits = checkedLimits(options.limits), sources = checkedSources(options.sources, limits);
  return { limits, sources, options, sourceById: new Map(sources.map(source => [source.id, source])),
    files: new Map(), texts: new Map(), json: new Map(), unresolved: [], warnings: [], diagnosticKeys: new Set(),
    textBytes: 0, outputBytes: 0, scanNodes: 0, transformNodes: 0, extraNodes: 0, reads: 0, unsupportedBindingTypeCount: 0,
    contractOrigins: new WeakMap(), contractBindingKeys: new Set(),
    records: new Map(), externalUiDefinitions: new Map(), selected: [], uiFileRefs: new Set(), textureRefs: new Set(), fontRefs: new Set(),
    textsUsed: new Set(), langKeys: new Set(), soundRefs: new Set(), nativeRenderers: [], nativeItemIds: [], nativeEvidence: [], explicit3d: new Set(), usedSourceIds: new Set(),
  };
}
function diagnose(state, code, detail = {}, warning = false) {
  const row = { code, severity: warning ? 'warning' : 'error', ...detail }, key = JSON.stringify(row);
  if (state.diagnosticKeys.has(key)) return;
  if (state.diagnosticKeys.size >= state.limits.diagnostics) failure('EXPORT_DIAGNOSTIC_LIMIT');
  state.diagnosticKeys.add(key); (warning ? state.warnings : state.unresolved).push(row);
}
function checkAbort(state) { if (state.options.signal?.aborted) failure('EXPORT_ABORTED'); }
function collectScannerDiagnostic(state, item, mode) {
  const isText = item.assetKind === 'localization' || mode === 'supplement' && /^__export_(?:text|place_holder_text|placeholder_text)_texture$/u.test(item.property || '');
  const assetKind = isText ? 'localization' : mode === 'supplement' && item.assetKind === 'font' ? 'sound' : item.assetKind;
  const detail = { assetKind, reference: item.reference, path: item.sourcePath, jsonPath: item.jsonPath,
    property: item.property, reason: item.reason };
  if (item.code === 'EXPORT_ASSET_DYNAMIC_REFERENCE' && isText && ENGINE_TEXT_BINDINGS.has(item.reference)) {
    state.engineRuntimeTextUsed = true;
    diagnose(state, 'EXPORT_ENGINE_TEXT_BINDING_DEPENDENCY', detail, true); return;
  }
  const controller = item.code === 'EXPORT_ASSET_DYNAMIC_REFERENCE' && assetKind === 'texture' && CONTROLLER_TEXTURE_BINDINGS.exec(item.reference);
  if (controller) {
    (state.engineControllerBindingsUsed ||= new Set()).add(item.reference);
    // The device selects one of these shipped platform glyphs. Retain every
    // present candidate, including upper-pack replacements, and preserve the
    // binding so Minecraft still chooses its own active controller at runtime.
    const direction = controller[1];
    const stems = ['xbox', 'ps4', 'ps5', 'switch', 'generic', 'generic_14x14'].map(platform => `textures/ui/${platform}_face_button_${direction}`);
    for (const stem of stems) if (state.sources.some(source => TEXTURE_EXTENSIONS.some(ext => source.index.has(folded(stem + ext))))) state.textureRefs.add(stem);
    diagnose(state, 'EXPORT_ENGINE_CONTROLLER_TEXTURE_DEPENDENCY', { ...detail, candidateStems: stems }, true); return;
  }
  diagnose(state, item.code, detail);
}
function engineFactoryDependency(state, name, target, context) {
  if (context?.property !== 'control_ids' || context.ownerKey !== 'popup_dialog_factory'
    || ENGINE_FACTORY_CONTROLS[context.controlId] !== name) return false;
  const caller = state.catalog.recordsById[context.recordId];
  if (!state.engineFactoryProof?.callerRecordIds?.has(caller?.id) || caller.filePath !== 'ui/ui_common.json') return false;
  const branch = state.engineFactoryProof?.branches.find(item => item.definition === name);
  if (branch) branch.considered = true;
  if (!target || target.namespace !== 'storage_management_popup' || target.filePath !== 'ui/storage_management_popup.json') return false;
  if (!branch?.verified || state.selected.some(record => record.qualifiedName === name)) return false;
  branch.used = true;
  for (const stem of branch.textureStems) state.engineFactoryTextureStems.add(folded(stem));
  return true;
}
function findFile(state, wanted) {
  checkedWorkspaceExportPath(wanted);
  for (const source of state.sources) {
    const path = source.index.get(folded(wanted));
    if (path) return { source, path };
  }
  return null;
}
async function readText(state, source, path) {
  checkAbort(state);
  const key = `${source.id}\0${path}`;
  if (state.texts.has(key)) return state.texts.get(key);
  const text = Object.hasOwn(source.overrides, path) ? source.overrides[path] : await source.readText(path, state.limits.textBytes);
  if (typeof text !== 'string') failure('EXPORT_READ_TEXT_INVALID', { sourceId: source.id, path });
  const size = Buffer.byteLength(text);
  if (size > state.limits.textBytes) failure('EXPORT_TEXT_ENTRY_LIMIT', { path });
  state.textBytes += size; state.reads++;
  if (state.textBytes > state.limits.totalTextBytes) failure('EXPORT_TEXT_TOTAL_LIMIT');
  state.texts.set(key, text); return text;
}
async function readJson(state, source, path) {
  const key = `${source.id}\0${path}`;
  if (state.json.has(key)) return state.json.get(key);
  const parsed = parseJsonc((await readText(state, source, path)).replace(/^\uFEFF/u, ''), { fileName: path });
  if (!parsed.ok) failure('EXPORT_JSON_INVALID', { sourceId: source.id, path, errors: parsed.errors?.slice(0, 8) });
  state.json.set(key, parsed.value); return parsed.value;
}
function addGenerated(state, path, bytes, reason, sourceId = null) {
  checkedWorkspaceExportPath(path);
  if (path.length > 160) failure('EXPORT_OUTPUT_PATH_LENGTH_LIMIT', { path });
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), key = folded(path), prior = state.files.get(key);
  if (prior) {
    if (prior.path !== path || !prior.bytes.equals(buffer)) failure('EXPORT_OUTPUT_COLLISION', { path });
    prior.reasons.add(reason); return prior;
  }
  if (buffer.length > state.limits.entryBytes) failure('EXPORT_ENTRY_LIMIT', { path });
  if (state.files.size >= state.limits.files || state.outputBytes + buffer.length > state.limits.expandedBytes) failure('EXPORT_OUTPUT_LIMIT');
  state.outputBytes += buffer.length;
  if (sourceId) state.usedSourceIds.add(sourceId);
  const row = { path, bytes: buffer, sourceId, reasons: new Set([reason]) };
  state.files.set(key, row); return row;
}
async function addFile(state, wanted, reason, { optional = false } = {}) {
  checkAbort(state);
  let ref;
  try { ref = findFile(state, wanted); }
  catch (error) { diagnose(state, error.code || 'EXPORT_PATH_UNSAFE', { reference: wanted, reason }); return null; }
  if (!ref) { if (!optional) diagnose(state, 'EXPORT_FILE_MISSING', { reference: wanted, reason }); return null; }
  const prior = state.files.get(folded(ref.path));
  if (prior) { prior.reasons.add(reason); return ref; }
  const bytes = Object.hasOwn(ref.source.overrides, ref.path) ? Buffer.from(ref.source.overrides[ref.path])
    : await ref.source.readBytes(ref.path, state.limits.entryBytes);
  if (!(bytes instanceof Uint8Array)) failure('EXPORT_READ_BYTES_INVALID', { path: ref.path });
  state.reads++;
  addGenerated(state, ref.path, bytes, reason, ref.source.id); return ref;
}

async function collectUi(state) {
  const catalog = await buildUiCatalog({ parseJsonc, signal: state.options.signal,
    sources: state.sources.map(source => ({ id: source.id, kind: source.kind, precedence: source.precedence,
      filePaths: sorted(source.index.values()), readText: async (path) => (await readText(state, source, path)).replace(/^\uFEFF/u, '') })),
    limits: { maxFiles: state.limits.files, maxDefinitions: state.limits.definitions, maxTextBytesPerFile: state.limits.textBytes,
      maxTotalTextBytes: state.limits.totalTextBytes, maxReferenceNodesTotal: 1, maxReferenceNodesPerDefinition: 1 },
  });
  state.catalog = catalog;
  for (const item of catalog.diagnostics) {
    // Catalog's whole-pack reference pass is not the export dependency proof.
    // Every selected composition is independently scanned below; unrelated
    // screens must not exhaust the selected screen's dependency budget.
    if (item.severity === 'error' && item.code !== 'UI_REFERENCE_SCAN_LIMIT') diagnose(state, item.code, { sourceId: item.sourceId, path: item.filePath });
  }
  state.catalogReferencePass = { policy: 'replaced-by-selected-composition-scan',
    catalogLimitDiagnostics: catalog.diagnostics.filter(item => item.code === 'UI_REFERENCE_SCAN_LIMIT').length };
  const documentScopes = new Map();
  for (const record of catalog.records) {
    const key = `${record.sourceId}\0${record.filePath}`;
    if (!documentScopes.has(key)) documentScopes.set(key, extractExportRootVariables(await readJson(state, state.sourceById.get(record.sourceId), record.filePath)));
  }
  state.engineFactoryProof = inspectEngineFactoryProof({ catalog, sourceById: state.sourceById, documentScopes });
  state.engineFactoryTextureStems = new Set();
  const selections = state.options.selections;
  if (!Array.isArray(selections) || !selections.length || selections.length > state.limits.selections) failure('EXPORT_SELECTIONS_INVALID');
  for (const selection of selections) {
    if (!object(selection) || typeof selection.filePath !== 'string') failure('EXPORT_SELECTION_INVALID');
    checkedWorkspaceExportPath(selection.filePath);
    let candidates = catalog.records.filter(record => folded(record.filePath) === folded(selection.filePath)
      && (!selection.sourceId || record.sourceId === selection.sourceId));
    const selector = selection.rawKey ?? selection.definition ?? selection.recordId;
    if (selector !== undefined) candidates = candidates.filter(record => [record.rawKey, record.localName, record.qualifiedName, record.id].includes(selector));
    if (!selection.sourceId && candidates.length) candidates = candidates.filter(record => record.precedence === Math.max(...candidates.map(item => item.precedence)));
    if (candidates.length !== 1) { diagnose(state, candidates.length ? 'EXPORT_SELECTION_AMBIGUOUS' : 'EXPORT_SELECTION_NOT_FOUND', { selection }); continue; }
    const record = candidates[0], symbol = catalog.symbols[record.qualifiedName];
    if (symbol?.winnerId !== record.id) { diagnose(state, 'EXPORT_SELECTED_DEFINITION_SHADOWED', { definition: record.qualifiedName }); continue; }
    state.selected.push(record); state.records.set(record.id, record);
  }
  // Private branch isolation changes @ ancestry in the editor. Keep the original
  // externally registered screen entry in the emitted pack, without flattening
  // runtime variables into one preview state. Original bytes are read separately
  // from overrides and remain untouched.
  const originalDocuments = new Map();
  for (let index = 0; index < state.selected.length; index++) {
    const selected = state.selected[index], ownSource = state.sourceById.get(selected.sourceId);
    const candidates = [];
    if (Object.hasOwn(ownSource.overrides, selected.filePath)) candidates.push(ownSource);
    if (/(?:^|\.)__jsonui_[a-f0-9]{12}_\d+$/u.test(selected.baseRef || '')) {
      for (const source of state.sources) if (source.kind === 'vanilla' && !candidates.includes(source)) candidates.push(source);
    }
    let original;
    for (const source of candidates) {
      const path = source.index.get(folded(selected.filePath));
      if (!path) continue;
      const key = `${source.id}\0${path}`;
      if (!originalDocuments.has(key)) {
        checkAbort(state);
        const text = await source.readText(path, state.limits.textBytes);
        if (typeof text !== 'string' || Buffer.byteLength(text) > state.limits.textBytes) failure('EXPORT_READ_TEXT_INVALID', { path });
        state.textBytes += Buffer.byteLength(text); state.reads++;
        if (state.textBytes > state.limits.totalTextBytes) failure('EXPORT_TEXT_TOTAL_LIMIT');
        const parsed = parseJsonc(text.replace(/^\uFEFF/u, ''), { fileName: path });
        if (!parsed.ok) failure('EXPORT_JSON_INVALID', { path, reason: 'original-entry-document' });
        originalDocuments.set(key, parsed.value);
      }
      const candidate = findOriginalExportEntry(originalDocuments.get(key), selected);
      if (candidate && candidate.rawKey !== selected.rawKey) { original = candidate; break; }
    }
    if (!original && /(?:^|\.)__jsonui_[a-f0-9]{12}_\d+$/u.test(selected.baseRef || '')) diagnose(state,
      'EXPORT_ENTRY_ORIGINAL_UNAVAILABLE', { path: selected.filePath, reference: selected.qualifiedName,
        reason: '元のscreen入口を確認できる参照パックがありません。現在の継承原文を保持します。元入口への互換変換には対応するバニラ参照または編集前の原文が必要です。' }, true);
    const preserved = preserveExportEntryPoint({ catalog, selected, original });
    if (!preserved) continue;
    // Record IDs remain stable within this export analysis; the serialized key
    // and explicit base reference are replaced together.
    catalog.recordsById[selected.id] = preserved.record;
    catalog.records[catalog.records.findIndex(record => record.id === selected.id)] = preserved.record;
    state.selected[index] = preserved.record; state.records.set(selected.id, preserved.record);
    (state.entryPointPreservation ||= []).push(preserved.report);
  }
  const viewCache = new Map();
  const view = (record, mode) => {
    const key = `${record.id}\0${mode}`;
    if (!viewCache.has(key)) viewCache.set(key, { ...record, value: scanView(record.value, mode, state, 0,
      { record, pointer: '/' + record.rawKey.replace(/~/gu, '~0').replace(/\//gu, '~1') }) });
    return viewCache.get(key);
  };
  const pending = [...state.selected], scannedRoots = new Set();
  for (let cursor = 0; cursor < pending.length; cursor++) {
    checkAbort(state);
    const record = pending[cursor];
    if (scannedRoots.has(record.id)) continue;
    scannedRoots.add(record.id);
    if (scannedRoots.size > state.limits.definitions) failure('EXPORT_DEFINITION_LIMIT');
    const source = state.sourceById.get(record.sourceId), document = await readJson(state, source, record.filePath);
    const rootVariables = { ...catalog.globalVariables, ...extractExportRootVariables(document) };
    for (const mode of ['assets', 'supplement']) {
      const symbols = new Set(), diagnostics = [], native = [], itemIds = [], textures = new Set(), fonts = new Set();
      const resolvedNames = new Set();
      const resolve = (name, context) => {
        const symbol = catalog.symbols[name];
        if (!symbol) { engineFactoryDependency(state, name, null, context);
          diagnose(state, 'EXPORT_UI_SYMBOL_MISSING', { reference: name, path: record.filePath }); return []; }
        const candidates = symbol.candidateIds.map(id => catalog.recordsById[id]);
        const samePriority = candidates.filter(candidate => candidate.precedence === candidates[0].precedence);
        if (samePriority.length > 1) diagnose(state, 'EXPORT_UI_SYMBOL_AMBIGUOUS', { reference: name });
        const target = candidates[0]; resolvedNames.add(name);
        const targetScope = documentScopes.get(`${target.sourceId}\0${target.filePath}`) || {};
        const callerScope = documentScopes.get(`${record.sourceId}\0${record.filePath}`) || {};
        if (target.sourceId !== record.sourceId || target.filePath !== record.filePath) {
          const mismatched = Object.keys(targetScope).filter(key => Object.hasOwn(callerScope, key)
            && canonicalUiDocument(targetScope[key]) !== canonicalUiDocument(callerScope[key]));
          if (mismatched.length) diagnose(state, 'EXPORT_UI_DOCUMENT_VARIABLE_SCOPE_UNSUPPORTED', {
            reference: name, path: target.filePath, sourceId: target.sourceId, variables: mismatched });
        }
        if (engineFactoryDependency(state, name, target, context)) {
          const detail = { qualifiedName: name, caller: catalog.recordsById[context.recordId]?.qualifiedName, controlId: context.controlId,
            provider: 'minecraft-game-engine', sourcePath: target.filePath,
            sourceCommit: state.engineFactoryProof.sourceCommit, proofMethod: state.engineFactoryProof.method,
            reason: '固定 Mojang 資料の到達定義・変数・factoryを照合した標準ストレージダイアログ。共通定義の変更は選択パックへの収録を別途確認します。' };
          state.externalUiDefinitions.set(name, detail);
          diagnose(state, 'EXPORT_ENGINE_UI_FACTORY_DEPENDENCY', detail, true); return [];
        }
        state.records.set(target.id, target);
        // A same-symbol inheritance requires two pack layers; preserving both
        // under one namespace in one pack would silently change its meaning.
        if (target.baseRef && parseFixedControlSpec(target.baseRef, target.namespace).qualifiedName === name) {
          diagnose(state, 'EXPORT_UI_LAYER_COMPOSITION_UNSUPPORTED', { reference: name });
        }
        return candidates.map(candidate => view(candidate, mode));
      };
      const scan = scanJsonForExportDeps({
        value: { [INTERNAL_SCOPE]: true, [record.rawKey]: view(record, mode).value }, rootVariables,
        rootNamespace: record.namespace, rootRecordId: record.id, resolveUiSymbolCandidates: resolve,
        sourcePath: record.filePath, outUiJsonRefs: state.uiFileRefs, outUiSymbolRefs: symbols,
        outTextureRefs: textures, outFontRefs: fonts, outLangKeys: state.langKeys,
        outNativeRenderers: native, outNativeItemIds: itemIds, outDiagnostics: diagnostics,
        onResolvedControls: (value, context) => {
          let origin = state.contractOrigins.get(value);
          const owner = origin?.record || catalog.recordsById[context.recordId] || record;
          if (!origin) {
            const declarations = documentScopes.get(`${owner.sourceId}\0${owner.filePath}`) || {};
            const name = Object.keys(declarations).find(name => declarations[name] === value);
            if (name) origin = { record: owner, pointer: '/' + name.replace(/~/gu, '~0').replace(/\//gu, '~1') };
          }
          // 元の宣言が分かる場合は厳密な原文pointerを使用し、それ以外は消費位置を明記する。
          validateLiteralUiContracts(state, owner, { value,
            pointer: origin?.pointer || context.jsonPath, originKnown: !!origin });
        },
        limits: { maxNodes: Math.max(1, state.limits.nodes - state.scanNodes), maxDepth: state.limits.depth, maxDiagnostics: state.limits.diagnostics },
      });
      state.scanNodes += scan.stats.nodes;
      if (!scan.complete || state.scanNodes > state.limits.nodes) diagnose(state, 'EXPORT_SCAN_LIMIT');
      for (const item of diagnostics) collectScannerDiagnostic(state, item, mode);
      for (const name of symbols) if (!resolvedNames.has(name)) resolve(name);
      for (const ref of textures) (mode === 'assets' ? state.textureRefs : state.textsUsed).add(ref);
      for (const ref of fonts) (mode === 'assets' ? state.fontRefs : state.soundRefs).add(ref);
      if (mode === 'assets') { state.nativeRenderers.push(...native); state.nativeItemIds.push(...itemIds); }
    }
    // An explicit whole UI-file reference has no definition selector. Every
    // definition in that explicitly referenced file is therefore required.
    for (const path of state.uiFileRefs) {
      const candidates = catalog.records.filter(item => folded(item.filePath) === folded(path));
      if (!candidates.length) { diagnose(state, 'EXPORT_UI_FILE_MISSING', { reference: path }); continue; }
      for (const candidate of candidates) if (catalog.symbols[candidate.qualifiedName]?.winnerId === candidate.id && !state.records.has(candidate.id)) {
        state.records.set(candidate.id, candidate); pending.push(candidate);
      }
    }
  }
  const grouped = new Map();
  for (const record of state.records.values()) {
    if (!grouped.has(folded(record.filePath))) grouped.set(folded(record.filePath), []);
    grouped.get(folded(record.filePath)).push(record);
  }
  validateFixedInheritance(state);
  const outputUiPaths = [];
  for (const records of grouped.values()) {
    // Different definitions in the same path can legitimately originate from
    // different pack layers. Combine matching document scopes; keep conflicting
    // root scopes in distinct registered files under their original namespace.
    const scopes = new Map();
    for (const record of records) {
      const source = state.sourceById.get(record.sourceId), document = await readJson(state, source, record.filePath), header = Object.create(null);
      for (const key of sorted(Object.keys(document))) if (key === 'namespace' || key === 'variables' || key.startsWith('$') || !object(document[key]) && !Array.isArray(document[key])) header[key] = document[key];
      const key = JSON.stringify(header);
      if (!scopes.has(key)) scopes.set(key, { header, records: [] });
      scopes.get(key).records.push(record);
    }
    let scopeIndex = 0;
    for (const { header, records: scoped } of scopes.values()) {
      const source = state.sourceById.get(scoped[0].sourceId), originalPath = scoped[0].filePath;
      const path = scopeIndex++ === 0 ? originalPath : `ui/__jsonui_export/${digest(JSON.stringify([originalPath, header])).slice(0, 24)}.json`;
      if (path !== originalPath && state.sources.some(input => input.index.has(folded(path)))) { diagnose(state, 'EXPORT_OUTPUT_COLLISION', { path }); continue; }
      const output = { ...header };
      for (const record of scoped.sort((a, b) => a.rawKey < b.rawKey ? -1 : 1)) {
      if (Object.hasOwn(output, record.rawKey)) { diagnose(state, 'EXPORT_UI_FILE_LAYER_CONFLICT', { path, definition: record.qualifiedName }); continue; }
      Object.defineProperty(output, record.rawKey, { value: record.value, enumerable: true, configurable: true, writable: true });
      state.usedSourceIds.add(record.sourceId);
      validateLiteralUiContracts(state, record);
      boundedWalk(record.value, (current) => {
        if (!object(current)) return;
        for (const key of ['geometry', 'geometry_file', 'model', 'model_file', 'entity', 'entity_file', 'render_controller', 'render_controller_file', 'material', 'material_file']) {
          const ref = current[key];
          if (typeof ref === 'string' && ref) state.explicit3d.add(ref);
        }
      }, state);
      }
      addGenerated(state, path, jsonBytes(output), 'ui-definition-closure', source.id); outputUiPaths.push(path);
    }
  }
  if (outputUiPaths.length) addGenerated(state, 'ui/_ui_defs.json', jsonBytes({ ui_defs: sorted(outputUiPaths) }), 'selected-ui-registration');
  await collectGlobals(state);
}

/** UI 定義と静的 controls/modifications だけを走査し、任意の変数データを寸法と誤認しない。 */
function validateLiteralUiContracts(state, record, resolvedControls = null) {
  const join = (pointer, key) => `${pointer}/${String(key).replace(/~/gu, '~0').replace(/\//gu, '~1')}`;
  function visit(value, pointer, depth = 0) {
    checkAbort(state);
    if (depth > state.limits.depth || ++state.extraNodes > state.limits.nodes) failure('EXPORT_SCAN_LIMIT');
    if (!object(value)) return;
    for (const property of ['offset', 'size', 'min_size', 'max_size']) {
      const components = unitlessDimensionComponents(property, value[property]);
      if (components.length) diagnose(state, 'EXPORT_DIMENSION_UNITLESS', {
        path: record.filePath, sourceId: record.sourceId, definition: record.qualifiedName,
        pointer: resolvedControls?.originKnown === false ? null : join(pointer, property), jsonPath: join(pointer, property),
        location_kind: resolvedControls?.originKnown === false ? 'resolved-controls-consumer' : 'authored-source', property,
        value_type: Array.isArray(value[property]) ? 'array' : typeof value[property],
        component_value_type: 'string', component_indices: components,
        reason: '寸法の固定数値文字列に単位がありません。数値 JSON または px / % 付きの文字列へ修正してください。',
      });
    }
    for (const [index, binding] of (Array.isArray(value.bindings) ? value.bindings : []).entries()) {
      if (!object(binding) || binding.ignored === true || classifyUiBindingType(binding.binding_type, Object.hasOwn(binding, 'binding_type')) !== 'other') continue;
      const bindingPointer = join(join(join(pointer, 'bindings'), index), 'binding_type');
      const diagnosticKey = JSON.stringify([record.sourceId, record.filePath, bindingPointer]);
      if (state.contractBindingKeys.has(diagnosticKey)) continue;
      state.contractBindingKeys.add(diagnosticKey);
      state.unsupportedBindingTypeCount += 1;
      if (state.unsupportedBindingTypeCount > 64) {
        if (state.unsupportedBindingTypeCount === 65) diagnose(state, 'EXPORT_BINDING_TYPE_WARNING_LIMIT', {
          maxDetails: 64, additionalWarningsOmitted: true, reason: '未対応bindingの詳細は先頭64件です。残りの詳細は省略します。' }, true);
        continue;
      }
      diagnose(state, 'EXPORT_BINDING_TYPE_UNSUPPORTED', { path: record.filePath, sourceId: record.sourceId,
        definition: record.qualifiedName, pointer: resolvedControls?.originKnown === false ? null : bindingPointer, jsonPath: bindingPointer,
        location_kind: resolvedControls?.originKnown === false ? 'resolved-controls-consumer' : 'authored-source',
        binding_index: index, ...describeUiBindingType(binding.binding_type),
        reason: '未対応のbindingはプレビューで省略されます。書き出す原文を保持するため、実機での挙動を別途確認してください。' }, true);
    }
    const wrappers = (items, prefix) => {
      for (const [index, wrapper] of items.entries()) {
        if (!object(wrapper) || Object.keys(wrapper).length !== 1) continue;
        const [name, child] = Object.entries(wrapper)[0];
        visit(child, join(join(prefix, index), name), depth + 1);
      }
    };
    if (Array.isArray(value.controls)) wrappers(value.controls, join(pointer, 'controls'));
    else if (object(value.controls)) for (const [name, child] of Object.entries(value.controls)) {
      visit(child, join(join(pointer, 'controls'), name), depth + 1);
    }
    for (const [index, modification] of (Array.isArray(value.modifications) ? value.modifications : []).entries()) {
      if (!object(modification)) continue;
      const arrayName = String(modification.array_name || (typeof modification.control_name === 'string' ? 'controls' : '')).trim();
      if (arrayName !== 'controls' || !Object.hasOwn(modification, 'value')) continue;
      const prefix = join(join(join(pointer, 'modifications'), index), 'value');
      if (Array.isArray(modification.value)) wrappers(modification.value, prefix);
      else if (object(modification.value) && Object.keys(modification.value).length === 1) {
        const [name, child] = Object.entries(modification.value)[0];
        visit(child, join(prefix, name), depth + 1);
      }
    }
  }
  if (resolvedControls) {
    if (Array.isArray(resolvedControls.value)) {
      for (const [index, wrapper] of resolvedControls.value.entries()) {
        if (!object(wrapper) || Object.keys(wrapper).length !== 1) continue;
        const [name, child] = Object.entries(wrapper)[0];
        visit(child, join(join(resolvedControls.pointer, index), name));
      }
    } else for (const [name, child] of Object.entries(resolvedControls.value)) visit(child, join(resolvedControls.pointer, name));
  } else visit(record.value, join('', record.rawKey));
}

function validateFixedInheritance(state) {
  const complete = new Set();
  for (const record of state.records.values()) {
    let current = record; const chain = new Set();
    while (current?.baseRef && !complete.has(current.id)) {
      if (chain.has(current.id)) { diagnose(state, 'EXPORT_UI_INHERITANCE_CYCLE', { reference: current.qualifiedName }); break; }
      if (chain.size > state.limits.depth) { diagnose(state, 'EXPORT_UI_INHERITANCE_LIMIT', { reference: record.qualifiedName }); break; }
      chain.add(current.id);
      const parsed = parseFixedControlSpec(current.baseRef, current.namespace);
      if (!parsed.ok) break; // The bounded lexical scanner owns dynamic bases.
      const symbol = state.catalog.symbols[parsed.qualifiedName];
      current = symbol ? state.catalog.recordsById[symbol.winnerId] : null;
    }
    for (const id of chain) complete.add(id);
  }
}

async function collectGlobals(state) {
  const globals = state.catalog.globalVariables, needed = new Set(), queue = [];
  const visit = value => {
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(/\$[A-Za-z0-9_.-]{1,128}/gu)) if (!needed.has(match[0])) { needed.add(match[0]); queue.push(match[0]); }
  };
  for (const record of state.records.values()) { visit(record.rawKey); boundedWalk(record.value, visit, state); }
  const output = Object.create(null);
  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    for (const key of [name, `${name}|default`]) if (Object.hasOwn(globals, key)) {
      output[key] = globals[key]; boundedWalk(globals[key], visit, state);
    }
  }
  if (Object.keys(output).length) {
    addGenerated(state, 'ui/_global_variables.json', jsonBytes(output), 'reachable-global-variables');
    for (const source of state.sources) {
      const path = source.index.get('ui/_global_variables.json') || source.index.get('ui/_global_variables.jsonc');
      if (!path) continue;
      const variables = extractExportRootVariables(await readJson(state, source, path));
      if (Object.keys(output).some(key => Object.hasOwn(variables, key))) state.usedSourceIds.add(source.id);
    }
  }
}

async function collectTextures(state) {
  const queue = sorted(state.textureRefs), seen = new Set();
  for (let index = 0; index < queue.length; index++) {
    const ref = queue[index];
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    let found = null;
    try {
      checkedWorkspaceExportPath(ref);
      const names = /\.(?:png|tga|jpe?g)$/iu.test(ref) ? [ref] : TEXTURE_EXTENSIONS.map(ext => ref + ext);
      for (const source of state.sources) {
        const candidates = names.map(name => source.index.get(folded(name))).filter(Boolean);
        if (candidates.length > 1) { diagnose(state, 'EXPORT_TEXTURE_FORMAT_AMBIGUOUS', { reference: ref, paths: candidates }); break; }
        if (candidates.length) { found = candidates[0]; break; }
      }
    } catch (error) { diagnose(state, error.code || 'EXPORT_TEXTURE_REFERENCE_INVALID', { reference: ref }); continue; }
    if (!found) { diagnose(state, 'EXPORT_TEXTURE_MISSING', { reference: ref }); continue; }
    await addFile(state, found, `texture:${ref}`);
    const stem = found.replace(/\.(?:png|tga|jpe?g)$/iu, '');
    for (const sidecar of [stem + '.json', found + '.mcmeta', stem + '.texture_set.json']) {
      const file = await addFile(state, sidecar, `texture-sidecar:${found}`, { optional: true });
      if (!file) continue;
      const value = await readJson(state, file.source, file.path);
      boundedWalk(value, current => {
        if (!object(current)) return;
        for (const [key, child] of Object.entries(current)) {
          if (typeof child !== 'string' || !['color', 'normal', 'heightmap', 'metalness_emissive_roughness',
            'metalness_emissive_roughness_subsurface', 'texture', 'texture_path'].includes(key)) continue;
          queue.push(child.includes('/') ? child : stem.slice(0, stem.lastIndexOf('/') + 1) + child);
        }
      }, state);
    }
  }
}

async function collectSounds(state) {
  if (!state.soundRefs.size) return;
  const definitions = Object.create(null), seen = new Set(), queue = sorted(state.soundRefs), layers = [], eventEdges = new Map();
  for (const source of state.sources) {
    const path = source.index.get('sounds/sound_definitions.json');
    if (!path) continue;
    const document = await readJson(state, source, path), root = document?.sound_definitions ?? document;
    if (!object(root)) { diagnose(state, 'EXPORT_SOUND_DEFINITIONS_INVALID', { path }); continue; }
    layers.push({ source, path, root });
  }
  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    if (seen.has(name)) continue;
    if (seen.size >= state.limits.definitions) failure('EXPORT_SOUND_DEFINITION_LIMIT');
    seen.add(name);
    const layer = layers.find(item => Object.hasOwn(item.root, name));
    if (!layer) { diagnose(state, 'EXPORT_SOUND_DEFINITION_MISSING', { reference: name }); continue; }
    const definition = layer.root[name];
    if (!object(definition) || !Array.isArray(definition.sounds) || !definition.sounds.length || definition.sounds.length > 4096) {
      diagnose(state, 'EXPORT_SOUND_DEFINITION_INVALID', { reference: name }); continue;
    }
    definitions[name] = definition;
    state.usedSourceIds.add(layer.source.id);
    for (const raw of definition.sounds) {
      const row = typeof raw === 'string' ? { name: raw } : raw;
      if (!object(row) || typeof row.name !== 'string' || !row.name) { diagnose(state, 'EXPORT_SOUND_CANDIDATE_INVALID', { reference: name }); continue; }
      if (row.type === 'event') {
        queue.push(row.name);
        const refs = eventEdges.get(name) || []; refs.push(row.name); eventEdges.set(name, refs);
        continue;
      }
      if (row.type !== undefined && row.type !== 'file') { diagnose(state, 'EXPORT_SOUND_CANDIDATE_TYPE_UNSUPPORTED', { reference: row.name }); continue; }
      let names;
      try { checkedWorkspaceExportPath(row.name); names = /\.(?:ogg|wav|fsb)$/iu.test(row.name) ? [row.name] : SOUND_EXTENSIONS.map(ext => row.name + ext); }
      catch (error) { diagnose(state, error.code || 'EXPORT_SOUND_PATH_INVALID', { reference: row.name }); continue; }
      let found = null;
      for (const source of state.sources) {
        const candidates = names.map(path => source.index.get(folded(path))).filter(Boolean);
        if (candidates.length > 1) { diagnose(state, 'EXPORT_SOUND_FORMAT_AMBIGUOUS', { reference: row.name }); break; }
        if (candidates.length) { found = candidates[0]; break; }
      }
      if (found) await addFile(state, found, `sound-candidate:${name}`);
      else diagnose(state, 'EXPORT_SOUND_FILE_MISSING', { reference: row.name });
    }
  }
  const complete = new Set(), chain = new Set();
  function checkEvents(name, depth = 0) {
    if (chain.has(name)) { diagnose(state, 'EXPORT_SOUND_EVENT_CYCLE', { reference: name }); return; }
    if (complete.has(name)) return;
    if (depth > state.limits.depth) { diagnose(state, 'EXPORT_SOUND_EVENT_DEPTH_LIMIT', { reference: name }); return; }
    chain.add(name);
    for (const next of eventEdges.get(name) || []) checkEvents(next, depth + 1);
    chain.delete(name); complete.add(name);
  }
  for (const name of eventEdges.keys()) checkEvents(name);
  if (Object.keys(definitions).length) addGenerated(state, 'sounds/sound_definitions.json', jsonBytes({ format_version: '1.14.0', sound_definitions: definitions }), 'reachable-sound-definitions');
}

async function collectLanguagesAndFonts(state) {
  const tables = new Map(), translated = new Set(), characters = new Set(), localeFontCandidates = new Map();
  const addCharacters = text => { for (const char of String(text)) characters.add(char.codePointAt(0)); };
  const rawTexts = new Set([...state.textsUsed, ...state.langKeys]);
  for (const source of [...state.sources].reverse()) {
    for (const path of sorted(source.index.values())) {
      // Locale glyph overrides are dependencies even when this selection has
      // no translation keys. Enumerate actual paths once, within source limits.
      const font = rawTexts.size && /^texts\/([A-Za-z]{2,3}_[A-Za-z0-9_]+)\/(font\/(?:default8|ascii_sga|glyph_[0-9a-f]{2})\.png)$/iu.exec(path);
      if (font) localeFontCandidates.set(folded(path), { path, locale: font[1], sheet: folded(font[2]) });
      if (!state.langKeys.size || !/^texts\/[A-Za-z]{2,3}_[A-Za-z0-9_]+\.lang$/u.test(path)) continue;
      const parsed = parseLangFile(await readText(state, source, path));
      if (parsed.stats.truncated) { diagnose(state, 'EXPORT_LANG_SCAN_LIMIT', { path }); continue; }
      const locale = path.slice(6, -5), table = tables.get(locale) || Object.create(null);
      for (const key of Object.keys(parsed.table)) if (state.langKeys.has(key)) {
        table[key] = parsed.table[key]; translated.add(key); state.usedSourceIds.add(source.id);
      }
      tables.set(locale, table);
    }
  }
  const locales = new Set();
  for (const [locale, table] of [...tables].sort(([a], [b]) => a < b ? -1 : 1)) {
    const keys = sorted(Object.keys(table));
    if (!keys.length) continue;
    locales.add(locale);
    const lines = keys.map(key => { addCharacters(table[key]); return `${key}=${table[key]}`; });
    addGenerated(state, `texts/${locale}.lang`, Buffer.from(lines.join('\n') + '\n'), 'reachable-localization-keys');
  }
  for (const text of rawTexts) {
    // Literal text can spell a translation key, but only langKeys authorize
    // translation lookup. Its own glyphs remain required in that case.
    addCharacters(text);
    if (!translated.has(text)) {
      if (state.langKeys.has(text) && looksLikeLangKey(text)) diagnose(state, 'EXPORT_LOCALIZATION_KEY_MISSING', { reference: text });
      else addCharacters(text);
    }
  }
  for (const font of state.fontRefs) {
    const normalized = font.trim().toLowerCase();
    if (BUILTIN_FONTS.has(normalized) && normalized !== 'minecraftten') continue;
    const stem = font.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase();
    const names = font.includes('/') ? [font] : sorted(new Set([font, stem, stem.replace(/-/gu, '_')])).flatMap(name =>
      ['.json', '.ttf', '.otf', '.woff2', '.woff'].map(extension => `font/${name}${extension}`));
    let found = null;
    for (const name of names) { try { found = findFile(state, name); } catch { /* reported below */ } if (found) break; }
    if (!found) {
      if (BUILTIN_FONTS.has(normalized)) diagnose(state, 'EXPORT_BUILTIN_FONT_ENGINE_DEPENDENCY', { reference: font }, true);
      else diagnose(state, 'EXPORT_FONT_MISSING', { reference: font });
      continue;
    }
    await addFile(state, found.path, `font:${font}`);
    if (/\.jsonc?$/iu.test(found.path)) {
      const document = await readJson(state, found.source, found.path);
      boundedWalk(document, current => {
        if (!object(current)) return;
        for (const key of ['file', 'texture', 'font_file']) if (typeof current[key] === 'string') state.explicitFontFiles ||= new Set(), state.explicitFontFiles.add(current[key]);
      }, state);
    }
  }
  for (const path of state.explicitFontFiles || []) await addFile(state, path.includes('/') ? path : 'font/' + path, 'font-document-dependency');
  if (rawTexts.size) {
    const sheets = new Set(['font/default8.png']);
    if (state.fontRefs.has('rune')) sheets.add('font/ascii_sga.png');
    for (const point of characters) {
      if (point > 0xffff) { diagnose(state, 'EXPORT_NON_BMP_FONT_RUNTIME', { codePoint: point }, true); continue; }
      sheets.add(`font/glyph_${(point >>> 8).toString(16).toUpperCase().padStart(2, '0')}.png`);
    }
    for (const path of sheets) {
      await addFile(state, path, 'text-glyph-page', { optional: true });
    }
    const requiredSheets = new Set([...sheets].map(folded));
    for (const candidate of [...localeFontCandidates.values()].sort((a, b) => a.path < b.path ? -1 : 1)) {
      if (!requiredSheets.has(candidate.sheet)) continue;
      if (await addFile(state, candidate.path, 'locale-text-glyph-page', { optional: true })) locales.add(candidate.locale);
    }
    // Pack font files are optional engine overrides; their absence means the
    // game supplies that built-in font, not a missing pack-owned dependency.
    diagnose(state, 'EXPORT_BUILTIN_FONT_ENGINE_DEPENDENCY', { reason: 'パックに存在する使用文字ページを同梱し、存在しない組込フォントは実機側に依存します。' }, true);
  }
  // Generated catalogs satisfy LANGFILES102/104 with an English fallback and
  // a corresponding .lang for each locale. Empty metadata adds no translation.
  if (locales.size) {
    locales.add('en_US');
    for (const locale of sorted(locales)) {
      const path = `texts/${locale}.lang`;
      if (!state.files.has(folded(path))) addGenerated(state, path, Buffer.from('\n'), 'generated-empty-localization-metadata');
    }
    addGenerated(state, 'texts/languages.json', jsonBytes(sorted(locales)), 'exported-language-registration');
  }
}

async function collectExplicit3d(state) {
  const queue = sorted(state.explicit3d), seen = new Set();
  for (let index = 0; index < queue.length; index++) {
    const reference = queue[index];
    if (seen.has(reference)) continue;
    seen.add(reference);
    if (seen.size > state.limits.files) failure('EXPORT_3D_DOCUMENT_LIMIT');
    if (/^(?:models|entity|render_controllers|materials)\/.+\.(?:json|jsonc|material)$/u.test(reference)) {
      const file = await addFile(state, reference, 'explicit-3d-document');
      if (file) {
        const document = await readJson(state, file.source, file.path);
        boundedWalk(document, value => {
          if (typeof value !== 'string') return;
          if (/^textures\//u.test(value)) state.textureRefs.add(value);
          else if (/^(?:models|entity|render_controllers|materials)\//u.test(value) && value !== reference) queue.push(value);
          else if (/^(?:Geometry\.|Material\.|Texture\.|Array\.)/u.test(value)) {
            diagnose(state, 'EXPORT_3D_SYMBOL_UNRESOLVED', { reference: value, path: reference });
          }
        }, state);
        boundedWalk(document, (value, jsonPath) => {
          if (typeof value === 'string' && /^(?:geometry\.|controller\.render\.)/u.test(value) && !jsonPath.endsWith('.identifier')) {
            diagnose(state, 'EXPORT_3D_SYMBOL_UNRESOLVED', { reference: value, path: reference, jsonPath });
          }
          if (object(value)) for (const key of ['textures', 'geometry', 'materials', 'render_controllers']) {
            if (typeof value[key] === 'string' && /^[#$@(]/u.test(value[key])) diagnose(state, 'EXPORT_3D_DYNAMIC_REFERENCE', { reference: value[key], path: reference });
          }
        }, state);
      }
    } else diagnose(state, 'EXPORT_3D_SYMBOL_UNRESOLVED', { reference });
  }
  await collectKnownNativeExportDependencies({ sources: state.sources, usages: state.nativeRenderers, itemIds: state.nativeItemIds,
    evidence: state.nativeEvidence, signal: state.options.signal,
    readJson: (source, path) => readJson(state, source, path),
    addFile: (path, reason, options) => addFile(state, path, reason, options),
    addJson: (path, value, reason, sourceId) => addGenerated(state, path, jsonBytes(value), reason, sourceId),
    addTexture: ref => state.textureRefs.add(ref),
    diagnose: (code, detail, warning) => diagnose(state, code, detail, warning),
  });
}

function stableUuid(seed) {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50; bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function collectManifest(state) {
  const sourceIds = new Set([...state.usedSourceIds, ...[...state.records.values()].map(record => record.sourceId)]);
  for (const file of state.files.values()) if (file.sourceId) sourceIds.add(file.sourceId);
  const manifests = [];
  for (const source of state.sources.filter(item => sourceIds.has(item.id))) {
    const path = source.index.get('manifest.json');
    if (!path) { diagnose(state, 'EXPORT_MANIFEST_MISSING', { sourceId: source.id }); continue; }
    const manifest = await readJson(state, source, path); manifests.push({ source, manifest });
    if (!object(manifest) || !object(manifest.header) || !Array.isArray(manifest.modules)) { diagnose(state, 'EXPORT_MANIFEST_INVALID', { sourceId: source.id }); continue; }
    const otherModules = manifest.modules.filter(module => module?.type !== 'resources');
    if (otherModules.length) diagnose(state, 'EXPORT_EXTERNAL_MODULE_DEPENDENCY', { sourceId: source.id, moduleTypes: otherModules.map(module => module?.type) });
    if (Array.isArray(manifest.dependencies) && manifest.dependencies.length) diagnose(state, 'EXPORT_EXTERNAL_PACK_DEPENDENCY', { sourceId: source.id, dependencies: manifest.dependencies });
    if (manifest.subpacks?.length) diagnose(state, 'EXPORT_SUBPACK_SELECTION_UNRESOLVED', { sourceId: source.id });
    if (manifest.capabilities?.length) diagnose(state, 'EXPORT_MANIFEST_CAPABILITIES', { sourceId: source.id, capabilities: manifest.capabilities }, true);
  }
  if (!manifests.length) return;
  const inputName = state.options.name;
  if (inputName !== undefined && (typeof inputName !== 'string' || !inputName.trim() || inputName.length > 120 || /[\u0000-\u001f]/u.test(inputName))) failure('EXPORT_NAME_INVALID');
  const seed = sorted([...state.files.values()].map(file => `${file.path}\0${digest(file.bytes)}`)).join('\n');
  const versions = manifests.map(({ manifest }) => manifest.header?.min_engine_version).filter(value => Array.isArray(value) && value.length === 3 && value.every(Number.isSafeInteger));
  // The selected versioned native descriptor must never be exported under a
  // manifest minimum older than the descriptor's own declared engine floor.
  for (const item of state.nativeEvidence) {
    const value = typeof item.minEngineVersion === 'string' ? item.minEngineVersion.split('.').map(Number) : item.minEngineVersion;
    if (Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every(number => Number.isSafeInteger(number) && number >= 0)) {
      versions.push([value[0], value[1] || 0, value[2] || 0]);
    }
  }
  versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const base = manifests[0].manifest;
  const output = { format_version: 2, header: { name: inputName || 'JSON UI 選択エクスポート',
    description: '選択した JSON UI と静的に確定した依存素材を含むリソースパック。',
    uuid: stableUuid('header\0' + seed), version: [1, 0, 0], min_engine_version: versions.at(-1) || [1, 21, 0] },
    modules: [{ type: 'resources', uuid: stableUuid('module\0' + seed), version: [1, 0, 0] }],
  };
  if (object(base.metadata)) output.metadata = base.metadata;
  const capabilities = sorted(new Set(manifests.flatMap(({ manifest }) => Array.isArray(manifest.capabilities) ? manifest.capabilities : [])));
  if (capabilities.length) output.capabilities = capabilities;
  addGenerated(state, 'manifest.json', jsonBytes(applyPackOptions(output, state.packOptions)), 'new-resource-pack-manifest');
  if (state.packIcon) addGenerated(state, 'pack_icon.png', state.packIcon.bytes, 'custom-pack-icon');
}

/** Runtime text is unknown, but the finite set of pack-owned overrides is known. */
async function retainRuntimeTextOverrides(state) {
  const usesText = state.engineRuntimeTextUsed || state.externalUiDefinitions.size
    || state.nativeRenderers.some(usage => ['hover_text_renderer', 'bundle_tooltip_renderer'].includes(usage.props?.renderer));
  if (!usesText) return;
  const locales = new Set(), retained = [];
  const replaceGenerated = (path, bytes, sourceId) => {
    const previous = state.files.get(folded(path));
    if (previous) { state.outputBytes -= previous.bytes.length; state.files.delete(folded(path)); }
    addGenerated(state, path, bytes, 'runtime-text-override-complete', sourceId);
  };
  for (const source of state.sources.filter(input => input.kind === 'imported')) {
    for (const path of sorted(source.index.values()).filter(path => /^(?:font\/.+|texts\/.+\.(?:lang|png|ttf|otf|woff2?|json))$/iu.test(path))) {
      checkAbort(state);
      // Bitmap pages and font binaries are self-contained. Arbitrary font JSON
      // can refer to outside resources and needs a separate dependency proof.
      if (/^(?:font\/|texts\/.+\/font\/).+\.jsonc?$/iu.test(path)) {
        diagnose(state, 'EXPORT_ENGINE_RUNTIME_FONT_METADATA_UNRESOLVED', { sourceId: source.id, reference: path }); continue;
      }
      const locale = /^texts\/([A-Za-z]{2,3}_[A-Za-z0-9_]+)\.lang$/u.exec(path);
      const fontLocale = /^texts\/([A-Za-z]{2,3}_[A-Za-z0-9_]+)\/font\//u.exec(path);
      if (fontLocale) locales.add(fontLocale[1]);
      if (locale) {
        locales.add(locale[1]);
        const text = await readText(state, source, path), sourceTable = parseLangFile(text);
        if (sourceTable.stats.truncated) { diagnose(state, 'EXPORT_LANG_SCAN_LIMIT', { path }); continue; }
        const existing = state.files.get(folded(path)), generated = existing ? parseLangFile(existing.bytes.toString('utf8')).table : {};
        const missing = Object.keys(generated).filter(key => !Object.hasOwn(sourceTable.table, key)).sort();
        const bytes = Buffer.from(text + (missing.length ? (text.endsWith('\n') ? '' : '\n')
          + missing.map(key => `${key}=${generated[key]}`).join('\n') + '\n' : ''));
        replaceGenerated(path, bytes, source.id);
      } else if (folded(path) === 'texts/languages.json') {
        const list = await readJson(state, source, path);
        if (!Array.isArray(list) || list.length > 256 || !list.every(locale => typeof locale === 'string' && /^[A-Za-z]{2,3}_[A-Za-z0-9_]+$/u.test(locale))) {
          diagnose(state, 'EXPORT_LANGUAGE_REGISTRY_INVALID', { path }); continue;
        }
        for (const locale of list) locales.add(locale);
        // Rebuilt below after every input locale and static fallback is known.
      } else {
        await addFile(state, path, 'runtime-text-override-complete');
      }
      retained.push(path);
    }
  }
  if (locales.size) {
    const existing = state.files.get('texts/languages.json');
    if (existing) for (const locale of JSON.parse(existing.bytes.toString('utf8'))) locales.add(locale);
    locales.add('en_US');
    for (const locale of locales) {
      const path = `texts/${locale}.lang`;
      if (!state.files.has(folded(path))) addGenerated(state, path, Buffer.from('\n'), 'generated-empty-localization-metadata');
    }
    replaceGenerated('texts/languages.json', jsonBytes(sorted(locales)), state.sources.find(source => source.kind === 'imported')?.id);
  }
  if (retained.length) state.runtimeTextOverrideRetention = { policy: 'retain-all-pack-owned-runtime-text-overrides',
    files: retained.length, paths: retained, boundedBy: ['files', 'entryBytes', 'expandedBytes', 'zipBytes'] };
}

function validateEngineRuntimeOverrides(state) {
  const usesText = state.engineRuntimeTextUsed || state.externalUiDefinitions.size
    || state.nativeRenderers.some(usage => ['hover_text_renderer', 'bundle_tooltip_renderer'].includes(usage.props?.renderer));
  const vanilla = state.sources.find(input => input.kind === 'vanilla');
  if (state.engineControllerBindingsUsed?.size) for (const record of state.records.values()) {
    boundedWalk(record.value, value => {
      if (!object(value)) return;
      for (const [key] of Object.entries(value)) if (state.engineControllerBindingsUsed.has(key)) diagnose(state,
        'EXPORT_ENGINE_BINDING_OVERRIDE_UNRESOLVED', { reference: key, path: record.filePath, sourceId: record.sourceId,
          reason: '実機由来と認定するbindingが原文で上書きされています。独自素材を省かないため出力を停止します。' });
      for (const binding of Array.isArray(value.bindings) ? value.bindings : []) {
        const target = binding?.target_property_name ?? binding?.binding_name_override;
        if (state.engineControllerBindingsUsed.has(target) && binding.binding_name !== target) diagnose(state,
          'EXPORT_ENGINE_BINDING_OVERRIDE_UNRESOLVED', { reference: target, path: record.filePath, sourceId: record.sourceId,
            reason: '実機由来と認定するbindingの値が別のbinding・view式で置き換えられています。' });
      }
    }, state);
  }
  for (const source of state.sources.filter(input => input.kind === 'imported')) {
    const textOverrides = [...source.index.values()].filter(path => /^(?:font\/.+|texts\/.+\.(?:lang|png|ttf|otf|woff2?|json))$/iu.test(path));
    const missingTextOverrides = textOverrides.filter(path => !state.files.has(folded(path)));
    if (usesText && missingTextOverrides.length) diagnose(state, 'EXPORT_ENGINE_RUNTIME_TEXT_OVERRIDES_UNRESOLVED', {
      sourceId: source.id, references: missingTextOverrides.slice(0, 16), count: missingTextOverrides.length,
      reason: '実行時文字列に必要な独自翻訳・字形の全候補を確定できません。独自素材を省いて成功にはしません。' });
    if (!state.externalUiDefinitions.size) continue;
    for (const path of source.index.values()) {
      if (!vanilla?.index.has(folded(path)) || !path.startsWith('textures/')) continue;
      const stem = folded(path.replace(/(?:\.texture_set)?\.json$|\.(?:png|tga|jpe?g)$/iu, ''));
      if (state.engineFactoryTextureStems.has(stem) && !state.files.has(folded(path))) diagnose(state,
        'EXPORT_ENGINE_UI_ASSET_OVERRIDE_UNRESOLVED', { sourceId: source.id, reference: path,
          reason: '実機に委譲する標準ダイアログで使う素材が通常パックで変更されています。閉包を確定できないため出力を停止します。' });
    }
  }
}

function validateEngineFactoryChanges(state) {
  const proof = state.engineFactoryProof;
  if (!proof) return;
  for (const branch of proof.branches) {
    if (!branch.used) continue;
    for (const changed of branch.changedRecords) {
      const included = state.records.has(changed.recordId);
      const detail = { code: included ? 'CHANGED_DEPENDENCY_INCLUDED' : 'CHANGED_DEPENDENCY_NOT_INCLUDED',
        definition: changed.definition, path: changed.path, changed: true, included };
      branch.checks.push(detail);
      if (!included) {
        branch.verified = false;
        diagnose(state, 'EXPORT_ENGINE_UI_CHANGED_DEPENDENCY_UNRESOLVED', { reference: changed.definition, path: changed.path,
          reason: '標準ダイアログの依存定義が変更されていますが、その定義は選択パックに収録されません。変更を欠落させないため停止します。' });
        continue;
      }
      const record = state.records.get(changed.recordId), facts = engineDependencyFacts(record.value);
      const unprovedInputs = ['opaque', 'dynamicAssets'].some(kind => facts[kind].some(value => !changed.expectedFacts?.[kind]?.includes(value)));
      if (unprovedInputs) {
        branch.verified = false;
        branch.checks.push({ code: 'CHANGED_DEPENDENCY_RUNTIME_INPUT_UNPROVEN', definition: changed.definition, path: changed.path, changed: true, included });
        diagnose(state, 'EXPORT_ENGINE_UI_CHANGED_RUNTIME_INPUT_UNRESOLVED', { reference: changed.definition, path: changed.path,
          reason: '共通定義に新しい変数・binding・動的素材などがあります。別の実機ダイアログで必要となる素材を確定できないため停止します。' });
      }
      for (const reference of engineFixedUiReferences({ [record.rawKey]: record.value }, record.namespace, state.catalog.symbols)) {
        if (changed.expectedUiReferences?.includes(reference) || state.records.has(state.catalog.symbols[reference]?.winnerId)) continue;
        branch.verified = false;
        branch.checks.push({ code: 'CHANGED_DEPENDENCY_NEW_REFERENCE_NOT_INCLUDED', definition: changed.definition, path: changed.path, reference, changed: true, included: false });
        diagnose(state, 'EXPORT_ENGINE_UI_CHANGED_REFERENCE_UNRESOLVED', { reference, path: changed.path,
          reason: '変更した共通定義の新しい参照先が選択パックに収録されません。別の実機ダイアログで変更が欠落するため停止します。' });
      }
      // An inherited controls replacement may hide a changed definition's
      // literal assets on the currently selected screen. The stock dialog can
      // still use them: retain every explicit candidate from this changed raw
      // definition, rather than relying on selected-screen traversal alone.
      boundedWalk(record.value, value => {
        if (typeof value === 'string' && value.startsWith('textures/')) state.textureRefs.add(value);
        if (!object(value)) return;
        for (const [key, child] of Object.entries(value)) {
          if (typeof child !== 'string' || /^[#$@(]/u.test(child.trim())) continue;
          if (key.toLowerCase().endsWith('texture') && child) state.textureRefs.add(child);
          if (key === 'font_type' && child) state.fontRefs.add(child);
          if (key === 'sound_name' && child) state.soundRefs.add(child);
          if (['text', 'place_holder_text', 'placeholder_text'].includes(key)) {
            state.textsUsed.add(child); if (looksLikeLangKey(child)) state.langKeys.add(child);
          }
        }
      }, state);
    }
  }
  proof.verified = proof.branches.every(branch => branch.verified);
}

function publicPlan(state) {
  const files = [...state.files.values()].sort((a, b) => a.path < b.path ? -1 : 1).map(file => ({
    path: file.path, bytes: file.bytes.length, sha256: digest(file.bytes), sourceId: file.sourceId, reasons: sorted(file.reasons),
  }));
  return { schema: 'jsonui-workspace-export-plan/v1', ok: state.unresolved.length === 0 && state.selected.length > 0,
    selectedDefinitions: state.selected.map(({ sourceId, filePath, rawKey, qualifiedName }) => ({ sourceId, filePath, rawKey, qualifiedName })),
    includedDefinitions: sorted([...state.records.values()].map(record => record.qualifiedName)), files,
    externalUiDefinitions: [...state.externalUiDefinitions.values()].filter(item => ![...state.records.values()].some(record => record.qualifiedName === item.qualifiedName))
      .sort((a, b) => a.qualifiedName < b.qualifiedName ? -1 : 1),
    unresolved: state.unresolved, warnings: state.warnings, limits: state.limits, nativeEvidence: state.nativeEvidence,
    engineFactoryProof: publicEngineFactoryProof(state.engineFactoryProof),
    entryPointPreservation: state.entryPointPreservation || [],
    runtimeTextOverrideRetention: state.runtimeTextOverrideRetention || null,
    metrics: { processing: 'node-worker', files: files.length, expandedBytes: state.outputBytes, textBytesRead: state.textBytes,
      sourceReads: state.reads, scannedNodes: state.scanNodes, includedDefinitions: state.records.size, catalogReferencePass: state.catalogReferencePass },
    fileBoundary: { operation: 'BUILD_SELECTED_UI_PACK', direction: 'output', content_kind: 'minecraft_resource_pack',
      format: 'archive', endpoint_type: 'generated', cardinality: 'zero_or_one', media_type: 'application/zip',
      completion_condition: 'stream_closed', durability_level: 'none', context: { exposure: 'complete_buffer_returned' } },
  };
}
async function prepare(options) {
  const state = makeState(options);
  try {
    state.packOptions = normalizePackOptions(state.options.packOptions);
    state.packIcon = normalizePackIcon(state.options.iconPngBase64);
    await collectUi(state);
    validateEngineFactoryChanges(state);
    await collectExplicit3d(state);
    await collectTextures(state);
    await collectSounds(state);
    await collectLanguagesAndFonts(state);
    await retainRuntimeTextOverrides(state);
    validateEngineRuntimeOverrides(state);
    await collectManifest(state);
  } catch (error) { diagnose(state, /^EXPORT_[A-Z0-9_]+$/u.test(error.code || '') ? error.code : 'EXPORT_READ_OR_BUILD_FAILED', error.detail || {}); }
  return { state, plan: publicPlan(state) };
}

/**
 * @param {{sources: {id:string,kind:'imported'|'vanilla',paths:string[],overrides?:Record<string,string>,readText:Function,readBytes:Function}[],
 * selections:{sourceId?:string,filePath:string,rawKey?:string,definition?:string,recordId?:string}[],limits?:object,name?:string,signal?:AbortSignal}} options
 * @returns {Promise<{ok:boolean,plan:object}>} 必須未解決を含む計画は ok:false。
 */
export async function planWorkspaceExport(options) {
  const { plan } = await prepare(options); return { ok: plan.ok, plan };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); return crc >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; }
function buildZip(state) {
  const locals = [], central = []; let offset = 0, centralSize = 0;
  for (const file of [...state.files.values()].sort((a, b) => a.path < b.path ? -1 : 1)) {
    checkAbort(state);
    const name = Buffer.from(file.path), compressed = deflateRawSync(file.bytes, { level: 6 });
    // Generated packs must remain readable by the same importer's ratio guard.
    const ratioSafe = file.bytes.length <= 8 * 1024 * 1024 || file.bytes.length <= compressed.length * 200;
    const body = compressed.length < file.bytes.length && ratioSafe ? compressed : file.bytes, method = body === compressed ? 8 : 0;
    const local = Buffer.alloc(30), directory = Buffer.alloc(46), crc = crc32(file.bytes);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8); local.writeUInt16LE(FIXED_ZIP_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(file.bytes.length, 22); local.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(method, 10); directory.writeUInt16LE(FIXED_ZIP_DATE, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(file.bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, name, body); central.push(directory, name); offset += local.length + name.length + body.length; centralSize += directory.length + name.length;
    if (offset + centralSize + 22 > state.limits.zipBytes) failure('EXPORT_ZIP_LIMIT');
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(state.files.size, 8); end.writeUInt16LE(state.files.size, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end], offset + centralSize + 22);
}

/** 決定的 ZIP bytes を返す。未解決・読み取り失敗時は bytes を返さない。保存・公開は呼び出し側が所有する。 */
export async function buildWorkspaceExport(options) {
  const { state, plan } = await prepare(options);
  if (!plan.ok) return { ok: false, plan };
  try {
    const bytes = buildZip(state);
    return { ok: true, plan, bytes, sha256: digest(bytes), size: bytes.length, mimeType: 'application/zip' };
  } catch (error) {
    diagnose(state, error.code || 'EXPORT_ZIP_BUILD_FAILED'); return { ok: false, plan: publicPlan(state) };
  }
}
