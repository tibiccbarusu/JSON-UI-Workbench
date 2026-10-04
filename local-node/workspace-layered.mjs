/** 原文編集用のパック層メタデータと固定参照解決。I/O は行わない。 */
import { editFail } from './workspace-jsonc.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const stableCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** metadata は内部 coordinator からのみ渡す。sourceId は再インポートで変わる識別子。 */
export function prepareDocumentSources(entries, documentSources) {
  if (documentSources === undefined) return null;
  if (!plain(documentSources)) editFail('EDIT_SOURCE_METADATA_INVALID', '原文の所有層情報が不正です。');
  const keys = new Set(entries.map(([path]) => path));
  if (Object.keys(documentSources).length !== keys.size || Object.keys(documentSources).some(path => !keys.has(path))) {
    editFail('EDIT_SOURCE_METADATA_INVALID', 'すべての原文に一致する所有層情報が必要です。');
  }
  const result = new Map(), owners = new Map(), slots = new Map(), names = new Set();
  for (const [path] of entries) {
    const item = documentSources[path];
    if (!plain(item) || typeof item.sourceId !== 'string' || !item.sourceId || item.sourceId.length > 256
      || /[\u0000-\u001f\u007f]/u.test(item.sourceId) || !['vanilla', 'imported'].includes(item.kind)
      || !Number.isSafeInteger(item.precedence) || item.precedence < 0 || item.precedence > 10000
      || typeof item.physicalPath !== 'string' || !item.physicalPath || item.physicalPath.length > 512
      || !/\.jsonc?$/iu.test(item.physicalPath) || /[\\\u0000-\u001f\u007f<>:"|?*]/u.test(item.physicalPath)
      || item.physicalPath.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))
      || item.active !== undefined && typeof item.active !== 'boolean') {
      editFail('EDIT_SOURCE_METADATA_INVALID', '安全な原文パス、所有層、優先順位を指定してください。', path);
    }
    const slot = `${item.kind}:${item.precedence}`;
    if (owners.has(item.sourceId) && owners.get(item.sourceId) !== slot
      || slots.has(slot) && slots.get(slot) !== item.sourceId) {
      editFail('EDIT_SOURCE_METADATA_INVALID', 'パック層の識別情報が一貫していません。', path);
    }
    owners.set(item.sourceId, slot); slots.set(slot, item.sourceId);
    const name = `${item.sourceId}\u0000${item.physicalPath.normalize('NFC').toLowerCase()}`;
    if (names.has(name)) editFail('EDIT_SOURCE_PATH_AMBIGUOUS', '同じ所有層に重複する原文パスがあります。', path);
    names.add(name);
    result.set(path, Object.freeze({ sourceId: item.sourceId, kind: item.kind, precedence: item.precedence,
      physicalPath: item.physicalPath, active: item.active !== false }));
  }
  return result;
}

/** UUID ではなく再読込後も安定する層と原文パスを revision に含める。 */
export function stableDocumentSourceRows(sources) {
  return sources ? [...sources].sort(([a], [b]) => stableCompare(a, b)).map(([path, item]) =>
    [path, item.kind, item.precedence, item.physicalPath, item.active]) : null;
}

export function sourceFields(source) {
  return source ? { sourceId: source.sourceId, sourceKind: source.kind, physicalPath: source.physicalPath,
    precedence: source.precedence, active: source.active } : {};
}

/** 同優先順位の複数定義を、ファイル名の辞書順で勝手に選ばない。 */
export function layeredReferenceTargets(reference, qualifiedName, candidates, layered) {
  if (!layered) return candidates;
  const caller = reference.node;
  const lowerOnly = reference.kind === 'implicit-layer-base'
    || reference.kind === 'inheritance' && caller.isDefinition && caller.qualifiedName === qualifiedName;
  const eligible = candidates.filter(node => node.active !== false
    && (!lowerOnly || node.precedence < caller.precedence));
  if (!eligible.length) return [];
  const highest = Math.max(...eligible.map(node => node.precedence));
  return eligible.filter(node => node.precedence === highest);
}
