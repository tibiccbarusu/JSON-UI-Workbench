/** Node-only authored-pointer mapping for opt-in base-revision transactions. */
import { editFail, pointerParts, pointerJoin, parseEditableJsonc, findEditableNode } from './workspace-jsonc.mjs';
const numeric = value => /^(0|[1-9]\d*)$/u.test(String(value));
const prefix = (whole, part) => part.length <= whole.length && part.every((value, i) => whole[i] === value);

export function preflightBaseTargets(documents, operation, trees = new Map()) {
  if (operation.type === 'replaceText') return;
  if (!trees.has(operation.path)) trees.set(operation.path, parseEditableJsonc(documents[operation.path], operation.path));
  const tree = trees.get(operation.path);
  let pointer = operation.type === 'add' ? operation.parentPointer ?? operation.pointer ?? '' : operation.pointer ?? '';
  if (operation.type === 'set' && operation.scope === undefined) pointer = pointerJoin(pointerParts(pointer).slice(0, -1));
  try { findEditableNode(tree, pointerParts(pointer)); }
  catch { editFail('EDIT_BATCH_BASE_TARGET_REQUIRED', '選択対象は一括編集開始時の原文に存在する必要があります。新規要素は反映後に編集してください。'); }
}

export function structuralLocationMapper(documents, operation, result) {
  const trees = new Map();
  const treeAt = path => { if (!trees.has(path)) trees.set(path, parseEditableJsonc(documents[path], path)); return trees.get(path); };
  const events = [];
  if (operation.type === 'delete') {
    for (const node of result.deletePlan.removals) {
      const tree = treeAt(node.path), parts = pointerParts(node.pointer);
      let removal = parts;
      // Exactly the authored ranges removed by editWorkspace; no guessed name matching.
      if (parts.length >= 3 && numeric(parts.at(-2))) removal = parts.slice(0, -1);
      else if (parts.at(-2) === 'value' && parts.at(-4) === 'modifications' && numeric(parts.at(-3))) removal = parts.slice(0, -2);
      const found = findEditableNode(tree, removal);
      events.push({ path: node.path, parts: removal, start: found.node.start, kind: 'delete', array: found.parent?.type === 'array' });
    }
    events.sort((a, b) => b.start - a.start);
  } else if (operation.type === 'add') {
    const parent = operation.parentPointer ?? operation.pointer ?? '';
    if (parent !== '') {
      const tree = treeAt(operation.path), parentNode = findEditableNode(tree, pointerParts(parent)).node;
      if (Array.isArray(parentNode.value.controls)) {
        const index = operation.index ?? parentNode.value.controls.length;
        events.push({ path: operation.path, parts: [...pointerParts(parent), 'controls', String(index)], kind: 'insert', array: true });
      }
    }
  }
  return (location, { gap = false } = {}) => {
    let parts = pointerParts(location.pointer);
    for (const event of events) {
      if (event.path !== location.path) continue;
      if (event.kind === 'delete' && prefix(parts, event.parts) && !(gap && parts.length === event.parts.length)) {
        editFail('EDIT_BATCH_TARGET_REMOVED', '先行操作で選択要素またはその祖先が削除されるため、変更全体を反映していません。');
      }
      if (!event.array) continue;
      const parent = event.parts.slice(0, -1), indexAt = parent.length;
      if (!prefix(parts, parent) || parts.length <= indexAt || !numeric(parts[indexAt])) continue;
      const index = Number(parts[indexAt]), pivot = Number(event.parts.at(-1));
      if (event.kind === 'insert' && index >= pivot) parts[indexAt] = String(index + 1);
      else if (event.kind === 'delete' && index > pivot) parts[indexAt] = String(index - 1);
    }
    return { ...location, pointer: pointerJoin(parts) };
  };
}

export function rebaseRawOperation(documents, operation, mapLocation) {
  const result = { ...operation };
  if (operation.pointer !== undefined) result.pointer = mapLocation({ path: operation.path, pointer: operation.pointer }).pointer;
  if (operation.parentPointer !== undefined) result.parentPointer = mapLocation({ path: operation.path, pointer: operation.parentPointer }).pointer;
  if (operation.type === 'add' && operation.index !== undefined) {
    const parent = operation.parentPointer ?? operation.pointer ?? '';
    if (parent) {
      const tree = parseEditableJsonc(documents[operation.path], operation.path);
      if (Array.isArray(findEditableNode(tree, pointerParts(parent)).node.value.controls)) {
        const mapped = mapLocation({ path: operation.path, pointer: pointerJoin([...pointerParts(parent), 'controls', String(operation.index)]) }, { gap: true });
        result.index = Number(pointerParts(mapped.pointer).at(-1));
      }
    }
  }
  return result;
}
