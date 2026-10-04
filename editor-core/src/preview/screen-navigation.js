/** Stable UI references. Record IDs belong to a single catalog lifetime. */
import { normalizePackPath } from '../path/normalize-pack-path.js';
import { isPocketUiPath, selectUiDefinition } from '../engine/ui-catalog.js';

export const MAX_NAVIGATION_ENTRIES = 100;
export const TOPIC_DEFINITION = /^encyclopedia\.(anvil|brewing_stand|enchanting_table|furnace|book_and_quill|mounts)_section$/u;

export function describeScreenNavigationError(error) {
  const code = String(error?.code || error?.message || error || '');
  return {
    UI_NAVIGATION_DEFINITION_REQUIRED:'遷移先ファイルに複数のUIがあります。画面遷移の設定で定義を選択してください。',
    UI_DEFINITION_AMBIGUOUS:'同じ名前に複数の定義が一致しています。元のUI定義の重複を確認してください。',
    UI_DEFINITION_NOT_FOUND:'指定したUI定義が見つかりません。遷移先を選び直してください。',
    UI_NAVIGATION_PATH_MISMATCH:'このUIは別ファイルの定義で上書きされています。遷移先を選び直してください。',
    UI_NAVIGATION_TARGET_INVALID:'遷移先のファイル指定が正しくありません。',
    UI_NAVIGATION_PRESENTATION_INVALID:'選択したUIはこの表示方法に対応していません。',
    UI_NAVIGATION_HISTORY_INVALID:'履歴の移動先を確認できません。現在の画面から履歴を開始し直してください。',
    UI_CATALOG_UNAVAILABLE:'UI一覧を読み込めませんでした。パックの読み込み状態を確認してください。',
    POCKET_PREVIEW_BLOCKED:'Pocket UIは索引のみ対応しています。Classic UIを選択してください。',
  }[code] || 'UIの読み込みまたは最初の表示準備を完了できませんでした。状態を確認して再試行してください。';
}

export function normalizeScreenRef(value, definition = '') {
  const input = typeof value === 'string' ? { packPath: value.replace(/^screen:/u, ''), qualifiedName: definition } : value;
  if (!input || typeof input !== 'object') throw new Error('UI_NAVIGATION_TARGET_INVALID');
  const packPath = normalizePackPath(input.packPath || String(input.fileId || '').replace(/^screen:/u, ''));
  if (!/^ui\/.+\.jsonc?$/iu.test(packPath) || /(?:^|\/)_[^/]*$/u.test(packPath)) throw new Error('UI_NAVIGATION_TARGET_INVALID');
  const qualifiedName = String(input.qualifiedName || input.definition || definition || '').trim();
  if (qualifiedName.length > 1024 || /[\u0000-\u001f\u007f]/u.test(qualifiedName)) throw new Error('UI_NAVIGATION_TARGET_INVALID');
  const presentation = input.presentation || (input.previewTopic ? 'topic' : 'screen');
  if (!['screen', 'topic'].includes(presentation) || presentation === 'topic' && !TOPIC_DEFINITION.test(qualifiedName)) throw new Error('UI_NAVIGATION_PRESENTATION_INVALID');
  return { packPath, qualifiedName, presentation };
}

export function screenRefFromFile(file, presentation = 'screen') {
  if (!file || file.kind !== 'screen') return null;
  const selected = file.meta?.selectedDefinition;
  try { return normalizeScreenRef({ packPath: file.path, qualifiedName: selected?.qualifiedName || '', presentation }); }
  catch { return null; }
}

export function sameScreenRef(left, right) {
  try {
    const a = normalizeScreenRef(left), b = normalizeScreenRef(right);
    return a.packPath.toLowerCase() === b.packPath.toLowerCase() && a.qualifiedName === b.qualifiedName && a.presentation === b.presentation;
  } catch { return false; }
}

function sameNavigationSource(left, right) {
  try {
    const a = normalizeScreenRef(left), b = normalizeScreenRef(right);
    return a.packPath.toLowerCase() === b.packPath.toLowerCase() && a.qualifiedName === b.qualifiedName;
  } catch { return false; }
}

export function normalizeNavigationEntry(value) {
  const entry = normalizeScreenRef(value);
  if (entry.presentation === 'topic' && value?.returnTo) entry.returnTo = normalizeScreenRef(value.returnTo);
  const scrollById = Object.fromEntries(Object.entries(value?.view?.scrollById || {}).slice(0, 256)
    .filter(([key, offset]) => key.length <= 512 && Number.isFinite(offset?.x) && Number.isFinite(offset?.y))
    .map(([key, offset]) => [key, { x:Math.max(0, Math.min(1e7, offset.x)), y:Math.max(0, Math.min(1e7, offset.y)) }]));
  if (Object.keys(scrollById).length && JSON.stringify(scrollById).length <= 8192) entry.view = { scrollById };
  return entry;
}

/** Resolve file-only legacy settings only when the eligible definition is unique. */
export function resolveScreenRef(value, definitions, catalogGeneration = 0) {
  const ref = normalizeScreenRef(value);
  const eligible = definitions.filter(record => record.profile !== 'pocket');
  if (isPocketUiPath(ref.packPath, ref.qualifiedName)) throw new Error('POCKET_PREVIEW_BLOCKED');
  if (!ref.qualifiedName && eligible.length !== 1) throw new Error(eligible.length ? 'UI_NAVIGATION_DEFINITION_REQUIRED' : 'UI_DEFINITION_NOT_FOUND');
  const selected = selectUiDefinition(definitions, ref.qualifiedName || eligible[0].id);
  if (!selected) throw new Error('UI_DEFINITION_NOT_FOUND');
  if (selected.profile === 'pocket') throw new Error('POCKET_PREVIEW_BLOCKED');
  if (String(selected.filePath || ref.packPath).toLowerCase() !== ref.packPath.toLowerCase()) throw new Error('UI_NAVIGATION_PATH_MISMATCH');
  // qualifiedName must itself be stable and unambiguous, even for a legacy ID.
  if (definitions.filter(record => record.qualifiedName === selected.qualifiedName).length !== 1) throw new Error('UI_DEFINITION_AMBIGUOUS');
  return { ...ref, qualifiedName: selected.qualifiedName, recordId: selected.id, sourceKind: selected.sourceKind, catalogGeneration };
}

export function readNavigationMappings(actionMap = {}) {
  if (actionMap?.version === 2) return { version: 2, entries: Array.isArray(actionMap.entries) ? actionMap.entries : [], legacy: { ...(actionMap.legacy || {}) } };
  return { version: 2, entries: [], legacy: Object.fromEntries(Object.entries(actionMap || {}).filter(([, value]) => typeof value === 'string')) };
}

export function setNavigationMapping(actionMap, { actionId, source = null, target, fileId }) {
  const map = readNavigationMappings(actionMap);
  const id = String(actionId || '').trim();
  if (!id || id.length > 512) throw new Error('UI_NAVIGATION_ACTION_INVALID');
  const normalizedSource = source ? normalizeScreenRef(source) : null;
  const normalizedTarget = normalizeScreenRef(target || fileId);
  const entries = map.entries.filter(entry => !(entry.actionId === id && (normalizedSource ? sameNavigationSource(entry.source, normalizedSource) : entry.source === null)));
  entries.push({ actionId: id, source: normalizedSource, target: normalizedTarget });
  return { ...map, entries };
}

export function removeNavigationMapping(actionMap, actionId, source = null, legacy = false) {
  const map = readNavigationMappings(actionMap);
  if (legacy || actionMap?.version !== 2) { delete map.legacy[actionId]; return map; }
  return { ...map, entries: map.entries.filter(entry => !(entry.actionId === actionId && (source ? sameNavigationSource(entry.source, source) : entry.source === null))) };
}

export function resolveNavigationMapping(actionMap, sourceRef, actionId) {
  const map = readNavigationMappings(actionMap);
  const scoped = sourceRef ? map.entries.filter(entry => entry.actionId === actionId && entry.source && sameNavigationSource(entry.source, sourceRef)) : [];
  const global = map.entries.filter(entry => entry.actionId === actionId && !entry.source);
  const matches = scoped.length ? scoped : global;
  if (matches.length > 1) throw new Error('UI_NAVIGATION_MAPPING_AMBIGUOUS');
  const legacy = matches.length === 0 && Object.hasOwn(map.legacy, actionId);
  const value = matches[0]?.target || (legacy ? map.legacy[actionId] : null);
  if (!value) return null;
  const screenRef = normalizeScreenRef(value);
  return { screenRef, fileId: `screen:${screenRef.packPath}`, definition: screenRef.qualifiedName || null, previewTopic: screenRef.presentation === 'topic', legacy };
}

export function updateNavigationHistory(previous, target, mode = 'push', index, origin) {
  const nav = previous || { enabled: false, stack: [], index: -1, actionMap: {} };
  const ref = normalizeNavigationEntry(target);
  const stack = (nav.stack || []).slice();
  if (mode === 'reset') return { ...nav, stack: [ref], index: 0 };
  if (mode === 'setIndex') {
    if (!Number.isInteger(index) || index < 0 || index >= stack.length) throw new Error('UI_NAVIGATION_HISTORY_INVALID');
    if (origin && sameScreenRef(stack[nav.index], origin)) stack[nav.index] = normalizeNavigationEntry(origin);
    stack[index] = ref;
    return { ...nav, stack, index };
  }
  const cut = stack.slice(0, Math.max(0, (Number.isInteger(nav.index) ? nav.index : -1) + 1));
  if (cut.length && origin && sameScreenRef(cut[cut.length - 1], origin)) cut[cut.length - 1] = normalizeNavigationEntry(origin);
  if (!cut.length && origin) cut.push(normalizeNavigationEntry(origin));
  if (!sameScreenRef(cut[cut.length - 1], ref)) cut.push(ref);
  const bounded = cut.slice(-MAX_NAVIGATION_ENTRIES);
  return { ...nav, stack: bounded, index: bounded.length - 1 };
}
