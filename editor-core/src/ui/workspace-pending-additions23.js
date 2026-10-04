// ブラウザー ESM。追加前の原文 pointer を作らず、追加キュー内の値だけを編集する。
// 入出力は JSON 値。DOM、通信、レイアウト計算、確定原文の更新を行わない。
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const forbidden = new Set(['__proto__', 'constructor', 'prototype', 'controls', 'type']);
const clone = value => JSON.parse(JSON.stringify(value));
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function vector(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1000000)) {
    fail('WORKSPACE_PENDING_ADDITION_POSITION_INVALID', '追加予定の要素の位置は、有限な数値 2 個で指定してください。');
  }
  return [...value];
}

/** 内部の追加編集を、Node が既に検証できる通常の add に折り畳む。入力は変更しない。 */
export function compileWorkspacePending23(entries = []) {
  const output = [], additions = new Map(), deleted = new Set();
  for (const entry of entries) {
    const operation = entry.operation;
    if (!entry.pendingAdditionEdit) {
      const copied = clone(operation);
      output.push(copied);
      if (entry.pendingAdditionId && operation.type === 'add') additions.set(entry.pendingAdditionId, copied);
      continue;
    }
    const added = additions.get(entry.pendingAdditionId);
    if (!added) fail('WORKSPACE_PENDING_ADDITION_MISSING', '追加予定の要素が見つかりません。選択し直してください。');
    if (deleted.has(added)) fail('WORKSPACE_PENDING_ADDITION_DELETED', '削除予定の追加要素は編集できません。削除を元に戻してください。');
    if (operation.type === 'delete') { deleted.add(added); continue; }
    if (operation.type === 'set') {
      const property = operation.property;
      if (typeof property !== 'string' || !property || property.includes('/') || forbidden.has(property) || !own(operation, 'value')) {
        fail('WORKSPACE_PENDING_ADDITION_PROPERTY_INVALID', '追加予定の要素には、構造を置き換えない属性を指定してください。');
      }
      const caption = added.value.type === 'button' && added.value.controls?.length === 1 ? added.value.controls[0]?.caption : null;
      if (property === 'text' && caption?.type === 'label') caption.text = clone(operation.value);
      else Object.defineProperty(added.value, property, { value: clone(operation.value), enumerable: true, writable: true, configurable: true });
    } else if (operation.type === 'move') {
      if (operation.offset !== undefined) added.value.offset = vector(operation.offset);
      else {
        const before = vector(added.value.offset ?? [0, 0]), delta = vector(operation.delta);
        added.value.offset = vector(before.map((value, index) => value + delta[index]));
      }
    } else fail('WORKSPACE_PENDING_ADDITION_OPERATION_INVALID', '追加予定の要素には移動・属性変更・削除を指定してください。');
  }
  return output.filter(operation => !deleted.has(operation));
}

/** 一意な追加 ID と最終値を返す。Node に渡す操作へローカル ID は混ぜない。 */
export function workspacePendingAdditions23(entries, fileId) {
  const compiled = compileWorkspacePending23(entries);
  // 同じ親・名前で作り直した場合も、削除済みの旧追加IDを新追加へ接続しない。
  // undoでは削除entry自体がキューから外れるため、元のIDだけが正しく復活する。
  const deletedIds = new Set(entries.filter(entry => entry.pendingAdditionEdit && entry.operation.type === 'delete')
    .map(entry => entry.pendingAdditionId));
  const active = new Map(compiled.filter(operation => operation.type === 'add').map(operation => [
    JSON.stringify([operation.sourceId || '', operation.path, operation.parentPointer || '', operation.name]), operation,
  ]));
  return entries.filter(entry => entry.pendingAdditionId && !entry.pendingAdditionEdit && entry.operation.type === 'add'
    && !deletedIds.has(entry.pendingAdditionId)
    && (fileId === undefined || entry.previewSelection?.fileId === fileId)).flatMap(entry => {
    const operation = active.get(JSON.stringify([entry.operation.sourceId || '', entry.operation.path,
      entry.operation.parentPointer || '', entry.operation.name]));
    return operation ? [{ id: entry.pendingAdditionId, operation, previewSelection: entry.previewSelection ? clone(entry.previewSelection) : null }] : [];
  });
}
