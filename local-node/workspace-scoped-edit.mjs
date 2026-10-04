import { editScopedStructure31 } from './workspace-structure31.mjs';
import { chooseInteractionTarget31, TARGET_POLICY_VERSION31 } from './workspace-target-policy31.mjs';
import { placementRoute, placementRebaser } from './workspace-placement-route.mjs';
import { isUnitlessDimensionNumber, unitlessDimensionComponents } from '../editor-core/src/json/ui-dimension-contract.js';
/** Node-owned scoped editing. Only authored JSONC ranges are copied or changed. */
import { createHash } from 'node:crypto';
import { buildUiCatalog, parseDefinitionKey } from '../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { parseFixedControlSpec } from '../editor-core/src/engine/control-reference.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { editWorkspace, workspaceRevision, WORKSPACE_EDIT_LIMITS } from './workspace-edit.mjs';
import { prepareDocumentSources } from './workspace-layered.mjs';
import { WorkspaceEditError, editFail, pointerParts, pointerJoin, parseEditableJsonc,
  findEditableNode, appendEditableRawProperty, renameEditableKey, setEditableValue } from './workspace-jsonc.mjs';

// Symbols keep trusted transaction helpers out of serialized API payloads.
export const SCOPED_RESULT_REBASE = Symbol('scoped-result-rebase');
export const SCOPED_RESULT_CONTEXT = Symbol('scoped-result-context');
export const SCOPED_BATCH_OWNERSHIP = Symbol('scoped-batch-ownership');
export const SCOPED_BATCH_MOVE_SEQUENCE = Symbol('scoped-batch-move-sequence');
export const SCOPED_BATCH_MOVE_VALUES = Symbol('scoped-batch-move-values');
export const SCOPED_SEQUENCE_FAILED_INDEX = Symbol('scoped-sequence-failed-index');

export const SCOPED_EDIT_LIMITS = Object.freeze({ maxClonedDefinitions: 128, maxEdges: 20000,
  maxGraphPasses: 192, maxClonedBytes: 8 * 1024 * 1024, maxAffectedScreens: 256 });
// A proof belongs to one immutable revision/context and one selected screen.
// It is transferred only over our own private-name isolation plus geometry-only
// changes. JSON requests cannot forge it. Shared/other-screen edits rescan fully.
const inboundProofs36 = new WeakMap();
const screenIdentity36 = record => JSON.stringify([record.sourceId, record.filePath, record.qualifiedName]);
const hasInboundProof36 = (context, selected) => inboundProofs36.get(context) === screenIdentity36(selected);
const TRANSFORM_PROPERTIES = new Set(['offset', 'size', 'min_size', 'max_size', 'anchor_from', 'anchor_to']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sourceIdentity = source => JSON.stringify([source?.sourceId, source?.path, source?.pointer]);
const round = value => {
  const result = Math.round(value * 1000) / 1000;
  if (!Number.isFinite(result)) editFail('EDIT_DYNAMIC_OFFSET', '移動後のoffsetが有限な数値を超えるため保存できません。');
  return result;
};
function valueAt(value, pointer) {
  for (const key of pointerParts(pointer)) {
    if (!object(value) && !Array.isArray(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
function parentPointer(pointer, nodeSources) {
  const parts = pointerParts(pointer);
  while (parts.length) { parts.pop(); const parent = pointerJoin(parts); if (nodeSources[parent]) return parent; }
  return null;
}
function failure(error) {
  if (!(error instanceof WorkspaceEditError)) error = new WorkspaceEditError('EDIT_INTERNAL_ERROR', '範囲付き原文編集で予期しないエラーが発生しました。', [], error);
  return { ok: false, code: error.code, message: error.message, previewAllowed: false,
    diagnostics: [], error: { code: error.code, message: error.message, category: error.category,
      retryable: false, correlation_id: null, details: error.details } };
}

/** A revision-scoped reusable catalog. It contains no ZIP or browser objects. */
export async function buildScopedEditContext({ documents, documentSources, referenceDiscovery, checkpoint = () => {} }) {
  const revision = workspaceRevision(documents, documentSources);
  const metadata = prepareDocumentSources(Object.entries(documents), documentSources);
  const grouped = new Map(), internalPaths = new Map();
  for (const [path, text] of Object.entries(documents)) {
    const owner = metadata?.get(path) || { sourceId: 'workspace', kind: 'imported', precedence: 20, physicalPath: path, active: true };
    if (owner.active === false) continue;
    if (!grouped.has(owner.sourceId)) grouped.set(owner.sourceId, { id: owner.sourceId,
      kind: owner.kind, precedence: owner.precedence, texts: new Map() });
    grouped.get(owner.sourceId).texts.set(owner.physicalPath, text);
    internalPaths.set(JSON.stringify([owner.sourceId, owner.physicalPath]), path);
  }
  checkpoint('scoped-catalog-start');
  const catalog = await buildUiCatalog({ parseJsonc, referenceDiscovery,
    onProgress: progress => checkpoint(`scoped-catalog-${progress.phase}`, progress.processed, progress.total), sources: [...grouped.values()].map(source => ({
    id: source.id, kind: source.kind, precedence: source.precedence,
    filePaths: [...source.texts.keys()], readText: async path => source.texts.get(path),
  })) });
  const internalPath = source => {
    const path = internalPaths.get(JSON.stringify([source.sourceId, source.path ?? source.filePath]));
    if (!path) editFail('EDIT_SOURCE_NOT_FOUND', 'プレビューの原文に対応する編集文書がありません。');
    return path;
  };
  return { revision, catalog, internalPath, metadata };
}

function selectScreen(context, operation) {
  const screen = operation.screen;
  if (!object(screen) || typeof screen.path !== 'string' || pointerParts(screen.pointer).length !== 1) {
    editFail('EDIT_SCREEN_REQUIRED', '現在プレビューしている UI 定義のファイル・原文位置を指定してください。');
  }
  const rawKey = pointerParts(screen.pointer)[0];
  const candidates = context.catalog.records.filter(record => context.internalPath(record) === screen.path && record.rawKey === rawKey);
  if (candidates.length !== 1) editFail('EDIT_SCREEN_AMBIGUOUS', '現在の UI 定義を一意に特定できません。再プレビューしてください。');
  const selected = candidates[0];
  if (selected.profile === 'pocket') editFail('EDIT_POCKET_PREVIEW_FORBIDDEN', 'Pocket UI は原文読込だけに対応し、プレビュー経由の編集はできません。');
  if (context.catalog.symbols[selected.qualifiedName]?.winnerId !== selected.id) {
    editFail('EDIT_SCREEN_SHADOWED', '上位パックに隠れた UI 定義はプレビュー経由で編集できません。');
  }
  return selected;
}

function checkedPreview(operation) {
  if (operation.preview === undefined) return {};
  if (!object(operation.preview) || Object.keys(operation.preview).some(key => !['variables', 'representativeCollections', 'eventFactorySelections'].includes(key))) {
    editFail('EDIT_PREVIEW_INVALID', '再現条件には variables、representativeCollections、eventFactorySelections を指定してください。');
  }
  const serialized = JSON.stringify(operation.preview);
  if (Buffer.byteLength(serialized) > 256 * 1024) editFail('EDIT_PREVIEW_LIMIT', '編集用のプレビュー再現条件が容量上限を超えました。');
  const preview = parseEditableJsonc(serialized, '(preview-options)').value;
  for (const value of Object.values(preview)) if (!object(value)) editFail('EDIT_PREVIEW_INVALID', 'プレビュー再現条件は対応表で指定してください。');
  if (preview.variables?.$pocket_screen === true || preview.variables?.$desktop_screen === false) {
    editFail('EDIT_POCKET_PREVIEW_FORBIDDEN', 'Pocket UI のプレビュー条件では編集できません。');
  }
  return preview;
}

function chooseTarget(projection, operation) {
  const selected = projection.nodeSources[operation.effectivePointer];
  if (!selected) editFail('EDIT_PROJECTION_NODE_NOT_FOUND', '選択要素が現在の原文から再現できません。再プレビューしてください。');
  const intended = operation.type === 'planEdit' ? operation.intendedType : operation.type === 'planDelete' ? 'delete' : operation.type;
  const isTransform = intended === 'move' || intended === 'set' && TRANSFORM_PROPERTIES.has(operation.property);
  if(intended==='delete' && ![undefined,'selected','functional'].includes(operation.deletionUnit))editFail('EDIT_STRUCTURE_DELETE_UNIT','削除単位を選び直してください。');
  const functionalDelete=intended==='delete' && operation.deletionUnit==='functional';
  const resolved = chooseInteractionTarget31(projection, functionalDelete ? {...operation,targetMode:'interaction'} : operation, isTransform || functionalDelete);
  const effectivePointer = resolved.effectivePointer;
  return { selected, source: projection.nodeSources[effectivePointer], effectivePointer,
    value: valueAt(projection.document, effectivePointer), reason: resolved.reason, decision: resolved.decision,
    boundary: resolved.boundary || null, affectedDescendants: resolved.stats ? resolved.stats.nodes - 1 : null,
    analysisComplete: resolved.stats ? !resolved.stats.incomplete : null };
}

/** Validate selection against a fixed revision without copying or changing text. */
export function inspectScopedEditSelection(context, operation, projections = new Map()) {
  const selected = selectScreen(context, operation);
  const preview = checkedPreview(operation);
  const key = JSON.stringify([selected.id, preview]);
  if (!projections.has(key)) projections.set(key, resolveEffectiveUi({ catalog: context.catalog, recordId: selected.id, ...preview }));
  const projection = projections.get(key);
  if (!projection.ok) editFail('EDIT_PROJECTION_FAILED', '現在の UI を安全に再解釈できないため、変更を反映しません。');
  const target = chooseTarget(projection, operation);
  if (context.internalPath(target.selected) !== operation.path || target.selected.pointer !== operation.pointer) {
    editFail('EDIT_SELECTION_STALE', '選択した表示要素と原文が一致しません。再プレビューしてください。');
  }
  return { selected, preview, projection, target };
}

/** Internal batch mapping: match every authored ancestor, never display names. */
export function rebaseScopedSelectionAfterStructure(beforeContext, afterContext, operation, mapLocation, caches = {}) {
  const before = inspectScopedEditSelection(beforeContext, operation, caches.before ||= new Map());
  const location = mapLocation({ path: operation.path, pointer: operation.pointer });
  const screen = mapLocation(operation.screen);
  const selected = selectScreen(afterContext, { ...operation, screen });
  const key = JSON.stringify([selected.id, before.preview]);
  const projections = caches.after ||= new Map();
  if (!projections.has(key)) projections.set(key, resolveEffectiveUi({ catalog: afterContext.catalog, recordId: selected.id, ...before.preview }));
  const after = projections.get(key);
  if (!after.ok) editFail('EDIT_PROJECTION_FAILED', '構造変更後の UI を安全に再解釈できません。');
  const lineage = (context, projection, pointer, transform) => {
    const sources = [];
    for (let current = pointer; current; current = parentPointer(current, projection.nodeSources)) {
      const source = projection.nodeSources[current];
      if (source) sources.push(transform({ path: context.internalPath(source), pointer: source.pointer }));
    }
    return sources.reverse().map(source => [source.path, source.pointer]);
  };
  const expected = JSON.stringify(lineage(beforeContext, before.projection, operation.effectivePointer, mapLocation));
  const candidates = Object.entries(after.nodeSources).filter(([pointer, source]) =>
    afterContext.internalPath(source) === location.path && source.pointer === location.pointer
    && JSON.stringify(lineage(afterContext, after, pointer, value => value)) === expected);
  if (candidates.length !== 1) editFail('EDIT_BATCH_SELECTION_AMBIGUOUS',
    '構造変更後の表示要素を原文の祖先列から一意に特定できません。草稿を分けて確認してください。');
  return { ...operation, ...location, screen: { ...operation.screen, ...screen }, effectivePointer: candidates[0][0] };
}

/** 静的な非配置animationだけを証明する。プレビューの現在値で動的参照を固定しない。 */
function guardPositionAnimations({ documents, context, target, namespace }) {
  const animationProperties = ['alpha', 'offset', 'size', 'uv', 'color'];
  const projected = target.value.anims;
  const direct = animationProperties.filter(key => typeof target.value[key] === 'string' && target.value[key].startsWith('@'));
  if (projected === undefined && direct.length === 0) return;
  const reject = () => editFail('EDIT_ANIMATED_POSITION',
    '位置を変更しないアニメーションと確定できないため、差分移動を保存できません。offset・size・参照先・next を確認してください。');
  const authored = Object.create(null);
  for (const source of [...(target.source.inheritance || [target.source])].reverse()) {
    const path = context.internalPath(source), node = valueAt(parseEditableJsonc(documents[path], path).value, source.pointer);
    for (const key of ['anims', ...direct]) if (object(node) && Object.hasOwn(node, key) && !Object.hasOwn(authored, key)) authored[key] = node[key];
  }
  // $変数の現在値がalphaでも、別の状態でoffsetへ変わる可能性を残す。
  const fixed = ref => typeof ref === 'string' && ref.startsWith('@') && parseFixedControlSpec(ref).ok;
  if (projected !== undefined && (!Array.isArray(authored.anims) || !Array.isArray(projected) || projected.length > 64
    || authored.anims.length !== projected.length || authored.anims.some(ref => !fixed(ref)))
    || direct.some(key => !fixed(authored[key]))) reject();
  const references = [...(projected || []), ...direct.map(key => target.value[key])];
  const nonPositionTypes = new Set(['alpha', 'color', 'uv', 'flip_book', 'wait']);
  const resolved = new Map(); let work = 0;
  const recordFor = (ref, ownNamespace, skipId) => {
    const parsed = parseFixedControlSpec(ref, ownNamespace);
    if (!parsed.ok) reject();
    const symbol = context.catalog.symbols[parsed.qualifiedName];
    const candidates = (symbol?.candidateIds || []).map(id => context.catalog.recordsById[id]).filter(record => record && record.id !== skipId);
    if (!candidates.length || candidates[0].profile === 'pocket'
      || candidates.filter(record => record.precedence === candidates[0].precedence).length !== 1) reject();
    return candidates[0];
  };
  const fieldsFor = (record, active = new Set()) => {
    if (active.has(record.id) || active.size >= 64 || ++work > 512) reject();
    if (resolved.has(record.id)) return resolved.get(record.id);
    const nextActive = new Set(active).add(record.id);
    const fields = record.baseRef ? { ...fieldsFor(recordFor(record.baseRef, record.namespace, record.id), nextActive) } : {};
    for (const key of ['anim_type', 'next', 'end_event', 'reset_event', 'start_event', 'destroy_at_end']) {
      if (Object.hasOwn(record.value, key)) fields[key] = { value: record.value[key], namespace: record.namespace };
    }
    resolved.set(record.id, fields); return fields;
  };
  for (const ref of references) {
    let record = recordFor(ref, namespace); const seen = new Set();
    for (;;) {
      if (seen.has(record.id) || seen.size >= 64) reject();
      seen.add(record.id);
      const fields = fieldsFor(record);
      if (!nonPositionTypes.has(fields.anim_type?.value)
        || ['end_event', 'reset_event', 'start_event', 'destroy_at_end'].some(key => fields[key]?.value)) reject();
      if (fields.next === undefined || fields.next.value === '') break;
      if (typeof fields.next.value !== 'string' || !fields.next.value.startsWith('@')) reject();
      record = recordFor(fields.next.value, fields.next.namespace);
    }
  }
}

function offsetAfterDelta(value, delta, parentType, generated) {
  if (!Array.isArray(delta) || delta.length !== 2 || !delta.every(part => typeof part === 'number' && Number.isFinite(part) && Math.abs(part) <= 1000000)) {
    editFail('EDIT_DELTA_INVALID', '移動量は有限な数値 2 個で指定してください。');
  }
  if (parentType === 'stack_panel' || parentType === 'grid' && generated !== 'grid') {
    editFail('EDIT_FLOW_LAYOUT', '自動配置中の要素は差分ドラッグで移動できません。配置属性を編集してください。');
  }
  if (Array.isArray(value.bindings) && value.bindings.some(binding => /(?:offset|anchor|position|size|^#?[xy]$)/iu.test(String(binding?.target_property_name || binding?.binding_name_override || binding?.binding_name || '')))) {
    editFail('EDIT_DYNAMIC_POSITION', 'binding が位置やサイズを更新するため、位置の差分を安全に保存できません。');
  }
  const offset = value.offset ?? [0, 0];
  if (!Array.isArray(offset) || offset.length !== 2) editFail('EDIT_DYNAMIC_OFFSET', '動的 offset を安全に移動できません。');
  return offset.map((component, index) => {
    if (typeof component === 'number' && Number.isFinite(component)) return round(component + delta[index]);
    if (typeof component !== 'string') editFail('EDIT_DYNAMIC_OFFSET', 'offset の形式を移動差分へ変換できません。');
    const text = component.trim();
    if (isUnitlessDimensionNumber(text)) {
      const numeric = round(Number(text) + delta[index]);
      if (!Number.isFinite(numeric)) editFail('EDIT_DYNAMIC_OFFSET', 'offset の数値を有限な移動位置へ変換できません。');
      return numeric;
    }
    const pixels = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/u.exec(text);
    if (pixels) {
      const result = round(Number(pixels[1]) + delta[index]);
      if (/[eE]/u.test(String(result))) editFail('EDIT_DYNAMIC_OFFSET', '移動後のpx値を通常の10進表記で安全に保存できません。');
      return `${result}px`;
    }
    const relative = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)%[cxy]?)(?:\s*([+-])\s*(\d+(?:\.\d*)?|\.\d+)(?:px)?)?$/u.exec(text);
    if (!relative) editFail('EDIT_DYNAMIC_OFFSET', '式・アニメーション・未知の単位を含む offset は移動できません。');
    if (!Number.isFinite(parseFloat(relative[1]))) editFail('EDIT_DYNAMIC_OFFSET', 'offsetの割合が有限な数値を超えています。');
    const added = round((relative[3] ? Number(relative[3]) * (relative[2] === '-' ? -1 : 1) : 0) + delta[index]);
    if (/[eE]/u.test(String(added))) editFail('EDIT_DYNAMIC_OFFSET', '移動後のpx値を通常の10進表記で安全に保存できません。');
    return added === 0 ? relative[1] : `${relative[1]} ${added < 0 ? '-' : '+'} ${Math.abs(added)}px`;
  });
}

function guardVariableOffset({ documents, context, projection, target, preview }) {
  let rawOffset;
  for (const source of [...(target.source.inheritance || [target.source])].reverse()) {
    const path = context.internalPath(source), node = valueAt(parseEditableJsonc(documents[path], path).value, source.pointer);
    if (object(node) && Object.hasOwn(node, 'offset')) { rawOffset = node.offset; break; }
  }
  const tokens = value => typeof value === 'string' ? value.match(/\$[A-Za-z0-9_:@.\-]+/gu) || []
    : Array.isArray(value) ? value.flatMap(tokens) : [];
  const dependencies = new Set(tokens(rawOffset));
  if (!dependencies.size) return;
  const sourcePath = context.internalPath(target.source);
  const own = valueAt(parseEditableJsonc(documents[sourcePath], sourcePath).value, target.source.pointer);
  const localConditions = new Set((Array.isArray(own?.variables) ? own.variables : []).flatMap(branch =>
    object(branch) ? Object.keys(branch).filter(key => key.startsWith('$')).map(key => key.split('|')[0]) : []));
  function ownStatic(name, active = new Set()) {
    if (active.size >= 128 || active.has(name) || localConditions.has(name)
      || Object.hasOwn(preview.variables || {}, name) || !Object.hasOwn(own || {}, name)) return false;
    const next = new Set(active).add(name);
    return tokens(own[name]).every(dependency => ownStatic(dependency, next));
  }
  // Exact declarations on the actual instance override inherited conditionals.
  // Do not reject a fixed local offset merely because a parent reused its name.
  if ([...dependencies].every(name => ownStatic(name))) return;
  const scopes = [context.catalog.globalVariables];
  for (let pointer = target.effectivePointer; pointer; pointer = parentPointer(pointer, projection.nodeSources)) scopes.push(valueAt(projection.document, pointer));
  const declarations = [], conditional = new Set();
  for (const scope of scopes) if (object(scope)) {
    for (const [key, value] of Object.entries(scope)) if (key.startsWith('$')) declarations.push([key.split('|')[0], value]);
    for (const branch of Array.isArray(scope.variables) ? scope.variables : []) if (object(branch)) {
      for (const [key, value] of Object.entries(branch)) if (key.startsWith('$')) {
        conditional.add(key.split('|')[0]); declarations.push([key.split('|')[0], value]);
      }
    }
  }
  for (let pass = 0; pass < 128; pass++) {
    const size = dependencies.size;
    for (const [name, value] of declarations) if (dependencies.has(name)) for (const dependency of tokens(value)) dependencies.add(dependency);
    if (size === dependencies.size) break;
    if (pass === 127) editFail('EDIT_DYNAMIC_OFFSET', 'offset の参照変数が長すぎるため、安全に移動できません。');
  }
  if ([...dependencies].some(name => conditional.has(name) || Object.hasOwn(preview.variables || {}, name))) {
    editFail('EDIT_DYNAMIC_OFFSET', '状態やプレビュー条件で offset が切り替わるため、現在値へ固定する移動はできません。原文の変数・配置条件を編集してください。');
  }
}

/** ハンドル編集のため、解決済み値とは別に最後に宣言された寸法/基準を返す。 */
function authoredGeometry33(documents, context, target) {
  const props = {};
  for (const source of [...(target.source.inheritance || [target.source])].reverse()) {
    const path = context.internalPath(source), node = valueAt(parseEditableJsonc(documents[path], path).value, source.pointer);
    for (const key of ['size', 'anchor_to']) if (!Object.hasOwn(props, key) && object(node) && Object.hasOwn(node, key)) props[key] = node[key];
    if (Object.keys(props).length === 2) break;
  }
  return props;
}

function projectionEdges(projection, context, documents) {
  const catalog = context.catalog;
  const edges = new Map();
  const add = edge => {
    if (edge.from === edge.to) return;
    const key = JSON.stringify([edge.from, edge.owner.pointer, edge.kind, edge.property, edge.to]);
    if (edges.size >= SCOPED_EDIT_LIMITS.maxEdges) editFail('EDIT_ROUTE_LIMIT', '編集対象の継承経路数が上限を超えました。');
    edges.set(key, edge);
  };
  for (const [pointer, source] of Object.entries(projection.nodeSources)) {
    const chain = source.inheritance || [source];
    for (let i = 1; i < chain.length; i++) {
      const base = chain[i - 1], owner = chain[i];
      if (pointerParts(base.pointer).length !== 1) continue;
      add({ from: owner.recordId, to: base.recordId, owner, kind: 'inheritance' });
    }
    const parent = parentPointer(pointer, projection.nodeSources);
    if (!source.generated || !parent || projection.nodeSources[parent].generated) continue;
    const visibleOwner = projection.nodeSources[parent], value = valueAt(projection.document, parent);
    const target = catalog.recordsById[source.recordId];
    const candidates = [];
    const consider = (property, raw) => {
      const parsed = parseFixedControlSpec(raw, catalog.recordsById[visibleOwner.recordId].namespace);
      if (parsed.ok && parsed.qualifiedName === target.qualifiedName) {
        const owner = [...(visibleOwner.inheritance || [visibleOwner])].reverse().find(source => {
          const path = context.internalPath(source);
          return valueAt(parseEditableJsonc(documents[path], path).value, source.pointer + '/' + property) !== undefined;
        });
        if (owner) candidates.push({ property, spec: parsed, owner });
      }
    };
    consider('grid_item_template', value.grid_item_template);
    consider('collection_item_template', value.collection_item_template);
    consider('factory/control_name', value.factory?.control_name);
    if (value.type === 'factory') consider('control_name', value.control_name);
    for (const [name, raw] of Object.entries(value.factory?.control_ids || {})) consider(pointerJoin(['factory', 'control_ids', name]).slice(1), raw);
    if (value.type === 'factory') for (const [name, raw] of Object.entries(value.control_ids || {})) consider(pointerJoin(['control_ids', name]).slice(1), raw);
    // An unrelated factory elsewhere in the screen must not prevent a close
    // button edit. An edited generated branch still needs a proven route and
    // is rejected by reachability if this edge is not unambiguous.
    if (candidates.length !== 1) continue;
    add({ from: candidates[0].owner.recordId, to: target.id, kind: 'template', ...candidates[0] });
  }
  return [...edges.values()];
}

function affectedRecords(catalog, selected, source) {
  const target = catalog.recordsById[source.recordId];
  const matches = catalog.records.filter(record => record.id === selected.id
    || (record.classification === 'SCREEN' || record.profile === 'pocket') && record.references.includes(target.qualifiedName));
  return matches.slice(0, SCOPED_EDIT_LIMITS.maxAffectedScreens).map(record => ({
    path: record.filePath, sourceId: record.sourceId, pointer: pointerJoin([record.rawKey]),
    qualifiedName: record.qualifiedName, profile: record.profile,
  }));
}

function verifyUnchangedProjection(before, after, target, property, value, plan) {
  if (property !== null && !TRANSFORM_PROPERTIES.has(property)) return;
  const expected = JSON.parse(JSON.stringify(before.document));
  for (const [pointer, source] of Object.entries(before.nodeSources)) if (property !== null && (plan.instanceIsolation === 'single-placement'
    ? pointer === target.effectivePointer : sourceIdentity(source) === sourceIdentity(target.source))) {
    const node = valueAt(expected, pointer);
    if (object(node)) node[property] = value;
  }
  const names = new Map(plan.clonedDefinitions.map(item => [item.qualifiedName, item.original]));
  function canonical(value, depth = 0, key = '', parentKey = '') {
    if (depth > 256) editFail('EDIT_REPROJECTION_LIMIT', '再解釈の比較対象が深すぎます。');
    if (typeof value === 'string') {
      if (!key.startsWith('$') && !['grid_item_template', 'collection_item_template', 'control_name'].includes(key) && parentKey !== 'control_ids') return value;
      if (names.has(value)) return names.get(value);
      const at = value.lastIndexOf('@');
      if (at >= 0 && names.has(value.slice(at + 1))) return value.slice(0, at + 1) + names.get(value.slice(at + 1));
      return value;
    }
    if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1, key, parentKey));
    if (!object(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(childKey => [childKey, canonical(value[childKey], depth + 1, childKey, key)]));
  }
  if (JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(after.document))) {
    editFail('EDIT_REPROJECTION_SIDE_EFFECT', '再解釈で対象以外の要素や動作条件も変化したため、変更を反映しません。');
  }
}

function screenInboundReferences(catalog, selected) {
  let visits = 0;
  const inbound = new Set();
  const examine = (value, namespace, owner, reference = false) => {
    const queue = [{ value, reference }];
    for (let index = 0; index < queue.length; index++) {
      if (++visits > 1000000) editFail('EDIT_REFERENCE_SCAN_LIMIT', '画面の参照元を確認する原文走査が上限を超えました。');
      const { value: item, reference: isReference } = queue[index];
      if (typeof item === 'string' && isReference) {
        const parsed = parseFixedControlSpec(item, namespace);
        if (parsed.ok && parsed.qualifiedName === selected.qualifiedName
          || item.startsWith('(') && item.includes(selected.qualifiedName)) inbound.add(owner);
      } else if (Array.isArray(item)) queue.push(...item.map(value => ({ value, reference: isReference })));
      else if (object(item)) for (const [key, child] of Object.entries(item)) {
        if (key.includes('@')) queue.push({ value: key, reference: true });
        const structural = ['grid_item_template', 'collection_item_template', 'control_name', 'control_ids'].includes(key);
        const ordinary = ['type', 'text', 'texture', 'name', 'requires', 'font_type', 'renderer'].includes(key);
        queue.push({ value: child, reference: !ordinary && (isReference || structural || key.startsWith('$')) });
      }
    }
  };
  // Catalog reference discovery can be incomplete for large packs or many
  // alternatives. Check every authored terminal instead of trusting omissions.
  for (const record of catalog.records) if (record.id !== selected.id) {
    if (record.references.includes(selected.qualifiedName)) inbound.add(record.id);
    if (record.baseRef) examine(record.baseRef, record.namespace, record.id, true);
    examine(record.value, record.namespace, record.id);
  }
  examine(catalog.globalVariables, selected.namespace, '_global_variables');
  return [...inbound];
}

// Keep returned batch mappings independent of the isolation activation. That
// activation includes full catalogs, documents, projection trees and raw ASTs.
function makeScopedRebaser36(screenPath, screenPointer, screenLocation, selections) {
  return operation => {
    if (operation.scope !== 'screen' || operation.screen?.path !== screenPath
      || operation.screen?.pointer !== screenPointer) return operation;
    const mapping = selections.get(operation.effectivePointer);
    if (!mapping || mapping.from.path !== operation.path || mapping.from.pointer !== operation.pointer) return operation;
    return { ...operation, path: mapping.to.path, pointer: mapping.to.pointer,
      screen: { ...operation.screen, ...screenLocation } };
  };
}

function isolateSource({ documents, context, selected, projection, target, plan }) {
  const catalog = context.catalog, edges = projectionEdges(projection, context, documents);
  const reachable = new Set([selected.id]);
  for (let pass = 0; pass < SCOPED_EDIT_LIMITS.maxGraphPasses; pass++) {
    const size = reachable.size;
    for (const edge of edges) if (reachable.has(edge.from)) reachable.add(edge.to);
    if (size === reachable.size) break;
    if (pass === SCOPED_EDIT_LIMITS.maxGraphPasses - 1) editFail('EDIT_ROUTE_LIMIT', '継承経路の深さが上限を超えました。');
  }
  if (!reachable.has(target.source.recordId)) editFail('EDIT_ROUTE_UNRESOLVED', '現在の UI から選択原文へ至る参照経路を安全に再現できません。');
  // A selected definition inherited by another screen cannot be changed in
  // place while promising that screen stays unchanged.
  const inbound = hasInboundProof36(context, selected) ? [] : screenInboundReferences(catalog, selected);
  if (inbound.length) editFail('EDIT_SCREEN_IS_SHARED', '選択した UI 定義自体が別の定義から参照されています。この UI だけを変更するには独立した画面定義を選択してください。');
  inboundProofs36.set(context, screenIdentity36(selected));
  const wanted = new Set([target.source.recordId]);
  for (let pass = 0; pass < SCOPED_EDIT_LIMITS.maxGraphPasses; pass++) {
    const size = wanted.size;
    for (const edge of edges) if (reachable.has(edge.from) && wanted.has(edge.to)) wanted.add(edge.from);
    // A renamed overlay loses implicit/lower-layer lookup. Give its lower
    // definition a private explicit name even if only the upper body changes.
    for (const edge of edges) if (wanted.has(edge.from) && edge.kind === 'inheritance'
      && pointerParts(edge.owner.pointer).length === 1
      && catalog.recordsById[edge.from].qualifiedName === catalog.recordsById[edge.to].qualifiedName) wanted.add(edge.to);
    if (size === wanted.size) break;
    if (pass === SCOPED_EDIT_LIMITS.maxGraphPasses - 1) editFail('EDIT_ROUTE_LIMIT', '分離対象の参照経路が上限を超えました。');
  }
  wanted.add(selected.id);
  if (wanted.size - 1 > SCOPED_EDIT_LIMITS.maxClonedDefinitions) editFail('EDIT_CLONE_LIMIT', 'この編集で必要な定義の複製数が上限を超えました。');
  const changes = Object.create(null), copies = new Map(), renamed = new Map();
  const textAt = path => changes[path] ?? documents[path];
  const rawNode = (path, pointer) => findEditableNode(parseEditableJsonc(textAt(path), path), pointerParts(pointer)).node;
  const hash = createHash('sha256').update(selected.id).update(context.revision).digest('hex').slice(0, 12);
  const ownerKey = JSON.stringify([selected.sourceId, selected.filePath, selected.qualifiedName]);
  const privatelyOwned = plan.instanceIsolation === 'single-placement' ? null : context[SCOPED_BATCH_OWNERSHIP]?.get(ownerKey);
  let cloneBytes = 0, count = 0;
  for (const id of wanted) {
    const record = catalog.recordsById[id], path = context.internalPath(record);
    const ownedKey = JSON.stringify([record.sourceId, record.filePath, record.qualifiedName]);
    if (id === selected.id || privatelyOwned?.has(ownedKey)) {
      copies.set(id, { path, rawKey: record.rawKey, localName: record.localName, record, copied: false }); continue;
    }
    let localName;
    do { localName = `__jsonui_${hash}_${++count}`; } while (catalog.symbols[`${record.namespace}.${localName}`]);
    const rawKey = record.baseRef ? `${localName}@${record.baseRef}` : localName;
    const old = rawNode(path, pointerJoin([record.rawKey]));
    const raw = textAt(path).slice(old.start, old.end);
    cloneBytes += Buffer.byteLength(raw);
    if (cloneBytes > SCOPED_EDIT_LIMITS.maxClonedBytes) editFail('EDIT_CLONE_BYTE_LIMIT', '複製する原文容量が上限を超えました。');
    changes[path] = appendEditableRawProperty(textAt(path), parseEditableJsonc(textAt(path), path), rawKey, raw);
    copies.set(id, { path, rawKey, localName, record, copied: true });
  }
  function mapped(source) {
    const copy = copies.get(source.recordId);
    if (!copy) editFail('EDIT_ROUTE_UNRESOLVED', '複製済みの原文に編集経路を対応付けられません。');
    const original = pointerParts(source.pointer);
    let pointer = pointerJoin([copy.rawKey, ...original.slice(1)]);
    for (const [from, to] of renamed.get(copy.path) || []) if (pointer === from || pointer.startsWith(from + '/')) pointer = to + pointer.slice(from.length);
    return { path: copy.path, pointer, copy };
  }
  const relevant = edges.filter(edge => wanted.has(edge.from) && wanted.has(edge.to));
  function redirectVariable(edge, variable, original, qualifiedName) {
    const declarations = [];
    const scopes = new Map();
    for (const [pointer, source] of Object.entries(projection.nodeSources)) {
      if (!(source.inheritance || [source]).some(item => sourceIdentity(item) === sourceIdentity(edge.owner))) continue;
      for (let cursor = pointer; cursor; cursor = parentPointer(cursor, projection.nodeSources)) {
        const current = projection.nodeSources[cursor];
        for (const scope of current.inheritance || [current]) if (copies.has(scope.recordId)) scopes.set(sourceIdentity(scope), scope);
      }
    }
    for (const scope of scopes.values()) {
      const location = mapped(scope), value = rawNode(location.path, location.pointer).value;
      for (const [key, child] of Object.entries(value)) if (key.startsWith('$')) declarations.push({ copy: location.copy,
        name: key.split('|')[0], value: child, pointer: location.pointer + pointerJoin([key]) });
      for (const [index, branch] of (Array.isArray(value.variables) ? value.variables : []).entries()) if (object(branch)) {
        for (const [key, child] of Object.entries(branch)) if (key.startsWith('$')) declarations.push({ copy: location.copy,
          name: key.split('|')[0], value: child, pointer: location.pointer + pointerJoin(['variables', index, key]) });
      }
    }
    const dependencies = new Set([variable]);
    for (let pass = 0; pass < 128; pass++) {
      const size = dependencies.size;
      for (const declaration of declarations) if (dependencies.has(declaration.name)
        && typeof declaration.value === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(declaration.value)) dependencies.add(declaration.value);
      if (size === dependencies.size) break;
      if (pass === 127) editFail('EDIT_DYNAMIC_ROUTE', '参照変数の連鎖が長すぎるため、安全に分離できません。');
    }
    let rewritten = 0;
    for (const declaration of declarations) {
      if (!dependencies.has(declaration.name)) continue;
      const parsed = parseFixedControlSpec(declaration.value, declaration.copy.record.namespace);
      if (parsed.ok && parsed.qualifiedName === qualifiedName) { rewritten++; continue; }
      if (!parsed.ok || parsed.qualifiedName !== original.qualifiedName) continue;
      const replacement = parsed.localName ? `${parsed.localName}@${qualifiedName}` : qualifiedName;
      changes[declaration.copy.path] = setEditableValue(textAt(declaration.copy.path), parseEditableJsonc(textAt(declaration.copy.path), declaration.copy.path), declaration.pointer, replacement);
      rewritten++;
    }
    if (!rewritten) editFail('EDIT_DYNAMIC_ROUTE', '継承先を決める変数の原文宣言が分離範囲内にないため、変数を固定せずに編集できません。', '_request', { variable, target: original.qualifiedName });
  }
  // Deeper keys first; root key renames are reflected in copy.rawKey afterward.
  relevant.sort((a, b) => pointerParts(b.owner.pointer).length - pointerParts(a.owner.pointer).length);
  for (const edge of relevant) {
    const owner = mapped(edge.owner), base = copies.get(edge.to);
    const qualifiedName = base.record.namespace ? `${base.record.namespace}.${base.localName}` : base.localName;
    const rawKey = pointerParts(owner.pointer).at(-1), parsed = parseDefinitionKey(rawKey);
    const dynamic = edge.kind === 'inheritance' ? (parsed.baseRef?.startsWith('$') ? parsed.baseRef : !parsed.baseRef && parsed.localName.startsWith('$') ? parsed.localName : null)
      : valueAt(rawNode(owner.path, owner.pointer).value, '/' + edge.property);
    if (typeof dynamic === 'string' && /^\$[A-Za-z0-9_:@.\-]+$/u.test(dynamic)) {
      redirectVariable(edge, dynamic, base.record, qualifiedName);
      continue;
    }
    if (edge.kind === 'inheritance') {
      const newKey = `${parsed.localName}@${qualifiedName}`;
      changes[owner.path] = renameEditableKey(textAt(owner.path), parseEditableJsonc(textAt(owner.path), owner.path), owner.pointer, newKey);
      const newPointer = pointerJoin([...pointerParts(owner.pointer).slice(0, -1), newKey]);
      if (pointerParts(owner.pointer).length === 1) {
        owner.copy.rawKey = newKey;
        if (renamed.has(owner.path)) renamed.set(owner.path, renamed.get(owner.path).map(([from, to]) => [from, to].map(pointer =>
          pointer.startsWith(owner.pointer + '/') ? newPointer + pointer.slice(owner.pointer.length) : pointer)));
      }
      else {
        if (!renamed.has(owner.path)) renamed.set(owner.path, []);
        renamed.get(owner.path).push([owner.pointer, newPointer]);
      }
    } else {
      const propertyParts = pointerParts('/' + edge.property);
      let parent = owner.pointer;
      for (const [partIndex, part] of propertyParts.slice(0, -1).entries()) {
        const next = parent + pointerJoin([part]);
        if (!object(valueAt(parseEditableJsonc(textAt(owner.path), owner.path).value, next))) {
          // Copy this authored property group, not a resolved UI tree. The
          // effective group is used only to locate its source below.
          const lineage = projection.nodeSources[Object.keys(projection.nodeSources).find(key => sourceIdentity(projection.nodeSources[key]) === sourceIdentity(edge.owner))]?.inheritance || [];
          let rawGroup;
          for (const source of [...lineage].reverse()) {
            const sourcePath = context.internalPath(source), sourceValue = valueAt(parseEditableJsonc(documents[sourcePath], sourcePath).value,
              source.pointer + pointerJoin(propertyParts.slice(0, partIndex + 1)));
            if (object(sourceValue)) { rawGroup = sourceValue; break; }
          }
          if (!rawGroup) editFail('EDIT_GENERATED_ROUTE_AMBIGUOUS', '継承された factory の原文を安全に複製できません。');
          changes[owner.path] = setEditableValue(textAt(owner.path), parseEditableJsonc(textAt(owner.path), owner.path), next, rawGroup);
        }
        parent = next;
      }
      const replacement = edge.spec.localName ? `${edge.spec.localName}@${qualifiedName}` : qualifiedName;
      changes[owner.path] = setEditableValue(textAt(owner.path), parseEditableJsonc(textAt(owner.path), owner.path), owner.pointer + '/' + edge.property, replacement);
    }
  }
  const committed = mapped(target.source), screen = copies.get(selected.id);
  plan.clonedDefinitions = [...copies.values()].filter(copy => copy.copied).map(copy => ({
    path: copy.record.filePath, sourceId: copy.record.sourceId, original: copy.record.qualifiedName,
    qualifiedName: copy.record.namespace ? `${copy.record.namespace}.${copy.localName}` : copy.localName,
  }));
  const authoredCopies = [...copies.values()].filter(copy => copy.copied).map(copy => ({
    from: { path: copy.path, pointer: pointerJoin([copy.record.rawKey]) },
    to: { path: copy.path, pointer: pointerJoin([copy.rawKey]) },
  }));
  const screenLocation = { path: screen.path, pointer: pointerJoin([screen.rawKey]) };
  // Only a later screen-scoped operation for this exact screen follows these
  // authored copies. A raw/shared edit retains its explicitly requested scope.
  const selections = new Map();
  for (const [effectivePointer, source] of Object.entries(projection.nodeSources)) {
    const from = { path: context.internalPath(source), pointer: source.pointer };
    const location = copies.has(source.recordId) ? mapped(source) : from;
    selections.set(effectivePointer, { from, to: { path: location.path, pointer: location.pointer } });
  }
  const rebaseOperation = makeScopedRebaser36(context.internalPath(selected), pointerJoin([selected.rawKey]), screenLocation, selections);
  return { changes, target: committed, screen: screenLocation, authoredCopies, rebaseOperation };
}

/** Preflight and mutation share exactly the same bounded source analysis. */
export async function editWorkspaceScoped({ documents, documentSources, operation, expectedRevision, context, checkpoint = () => {}, reuseReferenceProof = true } = {}) {
  let sequenceIndex = 0;
  try {
    const revision = workspaceRevision(documents, documentSources);
    if (expectedRevision !== undefined && expectedRevision !== revision) editFail('EDIT_REVISION_CONFLICT', '編集前の状態が変わっています。再プレビューしてください。', 'expectedRevision');
    if (!object(operation) || !['screen', 'shared'].includes(operation.scope)
      || !['interaction', 'visual'].includes(operation.targetMode)) editFail('EDIT_SCOPE_INVALID', '編集範囲と移動単位を指定してください。');
    const intended = operation.type === 'planEdit' ? operation.intendedType : operation.type === 'planDelete' ? 'delete' : operation.type;
    if (!['move', 'set', 'add', 'delete'].includes(intended) || !['move', 'set', 'add', 'delete', 'planEdit', 'planDelete'].includes(operation.type)) editFail('EDIT_SCOPED_OPERATION_INVALID', '未対応の範囲付き編集です。');
    if (intended === 'set' && (typeof operation.property !== 'string' || !operation.property || operation.property.length > 128
      || /[\/\u0000-\u001f\u007f]/u.test(operation.property) || ['controls', 'modifications', 'factory', 'namespace'].includes(operation.property))) {
      editFail('EDIT_PROPERTY_INVALID', '範囲付き編集には要素直下の表示・配置属性を指定してください。');
    }
    if (intended === 'set' && unitlessDimensionComponents(operation.property, operation.value).length) {
      editFail('EDIT_UI_PROPERTY_INVALID', '寸法の数値文字列に単位がありません。数値 JSON または px / % 付きの文字列を指定してください。',
        '/operation/value', { reason: 'DIMENSION_UNITLESS_NUMBER', value_type: Array.isArray(operation.value) ? 'array' : typeof operation.value });
    }
    context ||= await buildScopedEditContext({ documents, documentSources, checkpoint });
    if (context.revision !== revision) editFail('EDIT_REVISION_CONFLICT', '編集解析の revision が一致しません。');
    if (context.catalog.summary.referenceDiscovery === 'skipped'
      && (!reuseReferenceProof || operation.scope !== 'screen' || !hasInboundProof36(context, selectScreen(context, operation)))) {
      context = await buildScopedEditContext({ documents, documentSources, checkpoint });
    }
    checkpoint('scoped-selection');
    const { selected, preview, projection, target } = inspectScopedEditSelection(context, operation);
    let affectedEffectivePointers = Object.entries(projection.nodeSources)
      .filter(([, source]) => sourceIdentity(source) === sourceIdentity(target.source)).map(([pointer]) => pointer);
    const sharedSourceInstances = affectedEffectivePointers.length;
    const route = operation.scope === 'screen' && operation.generatedScope !== 'template'
      && sharedSourceInstances > 1 ? placementRoute(projection, target.effectivePointer) : null;
    const singlePlacement = !!route;
    if (singlePlacement) affectedEffectivePointers = [target.effectivePointer];
    const instances = affectedEffectivePointers.length;
    const plan = { scope: operation.scope, targetMode: operation.targetMode, intendedType: intended,
      selected: { path: target.selected.path, sourceId: target.selected.sourceId, pointer: target.selected.pointer, effectivePointer: operation.effectivePointer },
      target: { path: target.source.path, sourceId: target.source.sourceId, pointer: target.source.pointer,
        effectivePointer: target.effectivePointer, type: target.value.type || 'unknown',
        authoredGeometry33: authoredGeometry33(documents, context, target),
        props: Object.fromEntries([...TRANSFORM_PROPERTIES].filter(key => Object.hasOwn(target.value, key)).map(key => [key, target.value[key]])) },
      promoted: target.effectivePointer !== operation.effectivePointer, reason: target.reason,
      targetPolicyVersion: TARGET_POLICY_VERSION31, targetDecision: target.decision,
      targetBoundary: target.boundary, affectedDescendants: target.affectedDescendants, targetAnalysisComplete: target.analysisComplete,
      generated: target.source.generated || null, affectedInstances: instances, affectedEffectivePointers,
      sharedSourceInstances, instanceIsolation: singlePlacement ? 'single-placement' : 'authored-branch',
      requiresTemplateConsent: instances > 1 || !!target.source.generated,
      affectedScreens: operation.scope === 'screen' ? [{ path: selected.filePath, sourceId: selected.sourceId,
        pointer: pointerJoin([selected.rawKey]), qualifiedName: selected.qualifiedName, profile: selected.profile }]
        : affectedRecords(context.catalog, selected, target.source),
      scopeCertainty: singlePlacement ? 'isolated-placement' : operation.scope === 'screen' ? 'isolated-authored-branch' : 'loaded-reference-candidates',
      deviceValidation: 'NOT_RUN', clonedDefinitions: [] };
    let next = { changes: Object.create(null), target: { path: context.internalPath(target.source), pointer: target.source.pointer },
      screen: { path: context.internalPath(selected), pointer: pointerJoin([selected.rawKey]) } };
    if (operation.scope === 'screen') next = isolateSource({ documents, context, selected, projection: route || projection, target, plan });
    plan.committedTarget = { ...plan.target, path: target.source.path, pointer: next.target.pointer };
    plan.committedScreen = { path: selected.filePath, sourceId: selected.sourceId, pointer: next.screen.pointer };
    if (['add','delete'].includes(intended)) {
      const structural = await editScopedStructure31({ documents, documentSources, revision, operation, intended,
        projection, target, plan, next, context, verify: verifyUnchangedProjection,
        reproject: async (texts, screen) => {
          const context = await buildScopedEditContext({ documents: texts, documentSources, checkpoint,
            referenceDiscovery: reuseReferenceProof ? 'skip' : undefined });
          const selected = selectScreen(context,{screen});
          const projection = resolveEffectiveUi({catalog:context.catalog,recordId:selected.id,...preview});
          if(!projection.ok)editFail('EDIT_REPROJECTION_MISMATCH','構造編集後のUIを再解釈できません。');
          return {context,projection};
        } });
      const {afterContext31,...result} = structural;
      return {...result,[SCOPED_RESULT_CONTEXT]:afterContext31};
    }
    let property = operation.property, value = operation.value;
    if (intended === 'move') {
      property = 'offset';
      if (operation.delta !== undefined) {
        const offsets = new Set(affectedEffectivePointers
          .map(pointer => JSON.stringify(valueAt(projection.document, pointer)?.offset ?? [0, 0])));
        if (offsets.size > 1) editFail('EDIT_MULTI_INSTANCE_OFFSET', '同じ原文でも配置ごとに元の位置が異なるため、共通の offset を 1 つの値へ固定する差分移動はできません。配置側の要素を選択してください。');
        guardVariableOffset({ documents, context, projection, target, preview });
        guardPositionAnimations({ documents, context, target, namespace: selected.namespace });
        value = offsetAfterDelta(target.value, operation.delta,
          valueAt(projection.document, parentPointer(target.effectivePointer, projection.nodeSources) || '')?.type, target.source.generated);
      }
    }
    if (operation.type === 'planEdit') return { ok: true, revision, beforeRevision: revision,
      changes: [], editPlan: plan, previewAllowed: true, diagnostics: [] };
    if (plan.requiresTemplateConsent && operation.generatedScope !== 'template') editFail('EDIT_GENERATED_SCOPE_REQUIRED', '同じテンプレートの反復要素にも適用されます。適用範囲を確認してテンプレート全体の編集を選択してください。');
    if (intended === 'move' && operation.delta === undefined) editFail('EDIT_DELTA_REQUIRED', '操作単位を含む移動には位置の差分を指定してください。');
    const moveValues = intended === 'move' ? [value] : [];
    const sequence = operation[SCOPED_BATCH_MOVE_SEQUENCE];
    if (sequence !== undefined) {
      // Trusted batch-only optimization: no user JSON can supply a Symbol.
      // The caller proved that only consecutive moves of the same selection,
      // scope, target mode, preview and consent occur in this sequence.
      if (operation.type !== 'move' || !Array.isArray(sequence) || sequence.length > 127) editFail('EDIT_SEQUENCE_INVALID', '内部の連続移動契約が不正です。');
      const parentType = valueAt(projection.document, parentPointer(target.effectivePointer, projection.nodeSources) || '')?.type;
      for (const [index, delta] of sequence.entries()) {
        // This is the same per-operation rounding/unit conversion as the
        // ordinary path. Deltas are deliberately never added together.
        sequenceIndex = index + 1;
        if (!Array.isArray(value) || value.some(part => typeof part === 'number' && !Number.isFinite(part))) {
          sequenceIndex = index; editFail('EDIT_UI_STRUCTURE', '無効な移動位置は反映できません。');
        }
        value = offsetAfterDelta({ ...target.value, offset: value }, delta, parentType, target.source.generated);
        moveValues.push(value);
      }
      if (value.some(part => typeof part === 'number' && !Number.isFinite(part))) editFail('EDIT_UI_STRUCTURE', '無効な移動位置は反映できません。');
    }
    if (plan.clonedDefinitions.length) {
      const isolated = await buildScopedEditContext({ documents: { ...documents, ...next.changes }, documentSources, checkpoint,
        referenceDiscovery: reuseReferenceProof ? 'skip' : undefined });
      const isolatedSelected = selectScreen(isolated, { screen: next.screen });
      const isolatedProjection = resolveEffectiveUi({ catalog: isolated.catalog, recordId: isolatedSelected.id, ...preview });
      if (!isolatedProjection.ok) editFail('EDIT_REPROJECTION_MISMATCH', '分離した UI を再解釈できないため、変更を反映しません。');
      verifyUnchangedProjection(projection, isolatedProjection, target, null, undefined, plan);
    }
    const path = next.target.path;
    let text = next.changes[path] ?? documents[path];
    const fixedBytes = sequence === undefined ? 0 : Object.entries({ ...documents, ...next.changes })
      .reduce((sum, [key, value]) => sum + (key === path ? 0 : Buffer.byteLength(value)), 0);
    // Keep every authored replacement, including the existing JSONC formatter's
    // insertion-versus-replacement indentation. Only repeated global analysis
    // is avoided; the sequence of local edits remains byte-for-byte identical.
    let tree = parseEditableJsonc(text, path);
    for (const [index, nextValue] of (sequence === undefined ? [value] : moveValues).entries()) {
      sequenceIndex = index;
      text = setEditableValue(text, tree, next.target.pointer + pointerJoin([property]), nextValue);
      if (sequence !== undefined) {
        if (fixedBytes + Buffer.byteLength(text) > WORKSPACE_EDIT_LIMITS.maxTotalBytes) editFail('EDIT_WORKSPACE_LIMIT', '編集対象の原文容量上限を超えました。');
        // Every intermediate text retains byte, nesting and node limits even
        // when a later move would make the final authored text smaller again.
        tree = parseEditableJsonc(text, path);
      }
    }
    next.changes[path] = text;
    const result = editWorkspace({ documents, documentSources, expectedRevision: revision,
      operation: { type: 'replaceTexts', texts: next.changes }, authoredCopies: next.authoredCopies || [] });
    if (!result.ok) return { ...result, editPlan: plan };
    // Re-open the changed authored records before publishing. Clone names must
    // resolve and the intended property must survive normal UI interpretation.
    const preserveInboundProof = reuseReferenceProof && operation.scope === 'screen'
      && TRANSFORM_PROPERTIES.has(property) && hasInboundProof36(context, selected);
    const afterContext = await buildScopedEditContext({ documents: result.documents, documentSources, checkpoint,
      referenceDiscovery: preserveInboundProof ? 'skip' : undefined });
    const afterSelected = selectScreen(afterContext, { screen: next.screen });
    const afterProjection = resolveEffectiveUi({ catalog: afterContext.catalog, recordId: afterSelected.id, ...preview });
    if (!afterProjection.ok || JSON.stringify(valueAt(afterProjection.document, target.effectivePointer)?.[property]) !== JSON.stringify(value)) {
      editFail('EDIT_REPROJECTION_MISMATCH', '変更後の再解釈で編集値が一致しないため、変更を反映しません。');
    }
    verifyUnchangedProjection(projection, afterProjection, target, property, value, plan);
    if (preserveInboundProof) inboundProofs36.set(afterContext, screenIdentity36(afterSelected));
    checkpoint('scoped-complete');
    return { ...result, editPlan: plan,
      [SCOPED_RESULT_REBASE]: singlePlacement ? placementRebaser({ before: projection, after: afterProjection,
        beforeContext: context, afterContext, selected, screen: next.screen }) : next.rebaseOperation,
      [SCOPED_RESULT_CONTEXT]: afterContext,
      [SCOPED_BATCH_MOVE_VALUES]: moveValues };
  } catch (error) {
    if (error?.code === 'NODE_JOB_CANCELLED') throw error;
    return { ...failure(error), [SCOPED_SEQUENCE_FAILED_INDEX]: sequenceIndex };
  }
}
