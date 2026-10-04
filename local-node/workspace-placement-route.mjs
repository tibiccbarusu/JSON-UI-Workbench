/**
 * 選択した表示配置の祖先だけを辿る。原文や解釈済みツリーは変更しない。
 * 生成セルは独立した原文がないため、個別配置への自動変換を禁止する。
 */
export function placementRoute(projection, effectivePointer) {
  const sources = projection?.nodeSources;
  if (!sources || typeof effectivePointer !== 'string' || !Object.hasOwn(sources, effectivePointer)) {
    return null;
  }
  const nodeSources = Object.create(null);
  let cursor = effectivePointer, depth = 0;
  while (cursor) {
    if (++depth > 256) return null;
    if (Object.hasOwn(sources, cursor)) {
      const source = sources[cursor];
      if (source.generated || source.inheritance?.some(item => item.generated)) return null;
      nodeSources[cursor] = source;
    }
    const separator = cursor.lastIndexOf('/');
    if (separator < 0) break;
    cursor = cursor.slice(0, separator);
  }
  return { ...projection, nodeSources };
}

/**
 * 個別複製では「同じ原文なら全部同じ複製先」とは限らない。
 * 変更後に検証された表示配置の source を使い、後続バッチ操作を対応付ける。
 */
export function placementRebaser({ before, after, beforeContext, afterContext, selected, screen }) {
  const screenPath = beforeContext.internalPath(selected);
  const screenPointer = '/' + selected.rawKey.replaceAll('~', '~0').replaceAll('/', '~1');
  const selections = new Map();
  for (const [effectivePointer, oldSource] of Object.entries(before.nodeSources)) {
    const newSource = after.nodeSources[effectivePointer];
    if (!newSource) continue;
    selections.set(effectivePointer, { path: beforeContext.internalPath(oldSource), pointer: oldSource.pointer,
      nextPath: afterContext.internalPath(newSource), nextPointer: newSource.pointer });
  }
  return makePlacementRebaser36(screenPath, screenPointer, screen, selections);
}

// A returned closure retains only proven pointer mappings, never old catalogs
// or both resolved trees across the next atomic operation.
function makePlacementRebaser36(screenPath, screenPointer, screen, selections) {
  return operation => {
    if (operation.scope !== 'screen' || operation.screen?.path !== screenPath
      || operation.screen?.pointer !== screenPointer) return operation;
    const mapping = selections.get(operation.effectivePointer);
    if (!mapping || mapping.path !== operation.path || mapping.pointer !== operation.pointer) return operation;
    return { ...operation, path: mapping.nextPath, pointer: mapping.nextPointer,
      screen: { ...operation.screen, ...screen } };
  };
}
