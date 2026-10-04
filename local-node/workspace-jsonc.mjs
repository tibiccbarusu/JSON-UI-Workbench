/** Node 専用。JSONC の元文字範囲を保持し、編集箇所以外を書き換えない。 */
export const JSONC_EDIT_LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxDepth: 128, maxNodes: 250000 });

export class WorkspaceEditError extends Error {
  constructor(code, message, details = [], cause = null) {
    super(message, { cause });
    this.name = 'WorkspaceEditError';
    this.code = code;
    this.category = code.includes('LIMIT') ? 'resource_exhausted'
      : code.includes('CONFLICT') ? 'conflict' : code.includes('INTERNAL') ? 'internal' : 'validation';
    this.retryable = false;
    this.details = details;
    this.context = {};
    this.cause = cause;
  }
}

export function editFail(code, message, field = '_request', extra = {}) {
  let requestField = field;
  if (field !== '_request') {
    if (field === 'expectedRevision') requestField = '/expectedRevision';
    else if (field === 'operation.type') requestField = '/operation/type';
    else if (field === 'path' || field === 'pointer') requestField = `/operation/${field}`;
    else if (!field.startsWith('/')) {
      const separator = field.indexOf('#/');
      const documentPath = separator < 0 ? field : field.slice(0, separator);
      requestField = `/documents/${documentPath.replace(/~/gu, '~0').replace(/\//gu, '~1')}`;
      if (separator >= 0) extra = { sourcePointer: field.slice(separator + 1), ...extra };
    }
  }
  throw new WorkspaceEditError(code, message, [{ kind: 'field_violation', field: requestField, reason: code, message, ...extra }]);
}

export function pointerParts(pointer) {
  if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/')) || /~[^01]|~$/u.test(pointer)) {
    editFail('EDIT_POINTER_INVALID', 'JSON Pointer の形式が不正です。', 'pointer');
  }
  return pointer === '' ? [] : pointer.slice(1).split('/').map(part => part.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

export function pointerJoin(parts) {
  return parts.length ? '/' + parts.map(part => String(part).replace(/~/gu, '~0').replace(/\//gu, '~1')).join('/') : '';
}

/** コメント、末尾カンマ、先頭 BOM を許可。重複キーは曖昧な編集を防ぐため拒否。 */
export function parseEditableJsonc(text, path = '(document)') {
  if (typeof text !== 'string') editFail('EDIT_TEXT_INVALID', 'JSON UI 原文は文字列で指定してください。', path);
  if (Buffer.byteLength(text) > JSONC_EDIT_LIMITS.maxBytes) editFail('EDIT_TEXT_LIMIT', 'JSON UI 原文の容量上限を超えました。', path);
  let offset = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let nodes = 0;
  function problem(code, message, at = offset) {
    const prefix = text.slice(0, at);
    const line = (prefix.match(/\n/gu) || []).length + 1;
    const column = at - prefix.lastIndexOf('\n');
    editFail(code, message, path, { path, offset: at, line, column });
  }
  function skip() {
    while (offset < text.length) {
      if (/[ \t\r\n]/u.test(text[offset])) { offset++; continue; }
      if (text[offset] === '/' && text[offset + 1] === '/') {
        offset += 2;
        while (offset < text.length && text[offset] !== '\n' && text[offset] !== '\r') offset++;
        continue;
      }
      if (text[offset] === '/' && text[offset + 1] === '*') {
        const end = text.indexOf('*/', offset + 2);
        if (end < 0) problem('EDIT_JSONC_SYNTAX', 'ブロックコメントが閉じられていません。');
        offset = end + 2;
        continue;
      }
      break;
    }
  }
  function string() {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '"') {
        const raw = text.slice(start, offset);
        try { return { start, end: offset, value: JSON.parse(raw) }; }
        catch (cause) { problem('EDIT_JSONC_SYNTAX', '文字列のエスケープが不正です。', start); }
      }
      if (char === '\\') offset++;
      else if (char.charCodeAt(0) < 32) problem('EDIT_JSONC_SYNTAX', '文字列中の制御文字が不正です。', offset - 1);
    }
    problem('EDIT_JSONC_SYNTAX', '文字列が閉じられていません。', start);
  }
  function value(depth) {
    if (depth > JSONC_EDIT_LIMITS.maxDepth) problem('EDIT_DEPTH_LIMIT', 'JSON の入れ子上限を超えました。');
    if (++nodes > JSONC_EDIT_LIMITS.maxNodes) problem('EDIT_NODE_LIMIT', 'JSON の要素数上限を超えました。');
    skip();
    const start = offset;
    const char = text[offset];
    if (char === '{' || char === '[') {
      const object = char === '{';
      const close = object ? '}' : ']';
      const result = { type: object ? 'object' : 'array', start, end: 0, value: object ? Object.create(null) : [], entries: [] };
      offset++;
      skip();
      while (text[offset] !== close) {
        if (offset >= text.length) problem('EDIT_JSONC_SYNTAX', 'JSON の括弧が閉じられていません。', start);
        let key;
        if (object) {
          if (text[offset] !== '"') problem('EDIT_JSONC_SYNTAX', 'オブジェクトのキーには二重引用符が必要です。');
          key = string();
          if (Object.hasOwn(result.value, key.value)) problem('EDIT_DUPLICATE_KEY', '同じオブジェクトに重複キーがあります。', key.start);
          skip();
          if (text[offset++] !== ':') problem('EDIT_JSONC_SYNTAX', 'キーの後にコロンが必要です。', offset - 1);
        }
        const child = value(depth + 1);
        const entry = { key: object ? key.value : result.entries.length, start: object ? key.start : child.start, end: child.end, keyStart: key?.start, keyEnd: key?.end, node: child, comma: null };
        result.entries.push(entry);
        if (object) result.value[key.value] = child.value;
        else result.value.push(child.value);
        skip();
        if (text[offset] === ',') { entry.comma = offset++; skip(); }
        else if (text[offset] !== close) problem('EDIT_JSONC_SYNTAX', '要素の間にカンマが必要です。');
      }
      result.end = ++offset;
      return result;
    }
    if (char === '"') return { type: 'string', ...string() };
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(offset));
    if (!token) problem('EDIT_JSONC_SYNTAX', 'JSON の値が不正です。');
    offset += token[0].length;
    const parsed = JSON.parse(token[0]);
    if (typeof parsed === 'number' && !Number.isFinite(parsed)) problem('EDIT_NUMBER_INVALID', '有限でない数値は使用できません。', start);
    return { type: parsed === null ? 'null' : typeof parsed, start, end: offset, value: parsed };
  }
  const tree = value(0);
  skip();
  if (offset !== text.length) problem('EDIT_JSONC_SYNTAX', 'JSON 本体の後に余分な文字があります。');
  return tree;
}

export function findEditableNode(tree, parts) {
  let node = tree;
  let parent = null;
  let entry = null;
  for (const part of parts) {
    parent = node;
    if (node.type !== 'object' && node.type !== 'array') editFail('EDIT_POINTER_NOT_FOUND', '指定された原文位置が存在しません。', pointerJoin(parts));
    if (node.type === 'array' && !/^(0|[1-9]\d*)$/u.test(String(part))) editFail('EDIT_POINTER_INVALID', '配列の位置は 0 以上の整数で指定してください。');
    entry = node.entries.find(item => String(item.key) === String(part));
    if (!entry) editFail('EDIT_POINTER_NOT_FOUND', '指定された原文位置が存在しません。', pointerJoin(parts));
    node = entry.node;
  }
  return { node, parent, entry };
}

export function applyTextRanges(text, ranges) {
  const ordered = [...ranges].sort((a, b) => b.start - a.start);
  let boundary = text.length;
  let output = text;
  for (const range of ordered) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end > boundary) {
      editFail('EDIT_RANGE_INVALID', '編集対象の文字範囲が競合しています。');
    }
    output = output.slice(0, range.start) + range.text + output.slice(range.end);
    boundary = range.start;
  }
  return output;
}

function jsonValue(value) {
  const active = new Set();
  let visited = 0;
  function check(item, depth) {
    if (++visited > JSONC_EDIT_LIMITS.maxNodes || depth > JSONC_EDIT_LIMITS.maxDepth) editFail('EDIT_VALUE_LIMIT', '編集値の大きさまたは深さが上限を超えました。');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || active.has(item) || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) {
      editFail('EDIT_VALUE_INVALID', '編集値は循環しない通常の JSON データで指定してください。');
    }
    active.add(item);
    for (const child of Object.values(item)) check(child, depth + 1);
    if (Array.isArray(item) && Object.keys(item).length !== item.length) editFail('EDIT_VALUE_INVALID', '空要素を持つ配列は指定できません。');
    active.delete(item);
  }
  check(value, 0);
  const serialized = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(serialized) > JSONC_EDIT_LIMITS.maxBytes) editFail('EDIT_VALUE_LIMIT', '編集値の容量上限を超えました。');
  return serialized;
}

function formattedValue(text, at, value) {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const indentation = /^[ \t]*/u.exec(text.slice(start, at))[0];
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return jsonValue(value).replace(/\n/gu, newline + indentation);
}

/** 既存値の置換、または既存オブジェクト直下への新規プロパティ追加。 */
export function setEditableValue(text, tree, pointer, value) {
  const parts = pointerParts(pointer);
  if (!parts.length) return applyTextRanges(text, [{ start: tree.start, end: tree.end, text: formattedValue(text, tree.start, value) }]);
  const { node: parent } = findEditableNode(tree, parts.slice(0, -1));
  const key = parts.at(-1);
  if (parent.type !== 'object' && parent.type !== 'array') editFail('EDIT_PARENT_INVALID', '編集対象の親がオブジェクトまたは配列ではありません。');
  const existing = parent.entries.find(entry => String(entry.key) === key);
  if (existing) return applyTextRanges(text, [{ start: existing.node.start, end: existing.node.end, text: formattedValue(text, existing.node.start, value) }]);
  if (parent.type !== 'object') editFail('EDIT_POINTER_NOT_FOUND', '指定された配列要素は存在しません。');
  const last = parent.entries.at(-1);
  const comma = last && last.comma === null ? ',' : '';
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const raw = `${comma}${newline}  ${JSON.stringify(key)}: ${formattedValue(text, parent.end - 1, value)}${newline}`;
  return applyTextRanges(text, [{ start: parent.end - 1, end: parent.end - 1, text: raw }]);
}

/** 元の子要素の番号を使う。複数削除では呼び出し側が降順に並べる。 */
export function removeEditableValue(text, tree, pointer) {
  const { parent, entry } = findEditableNode(tree, pointerParts(pointer));
  if (!parent) editFail('EDIT_ROOT_DELETE_FORBIDDEN', 'JSON 文書全体の削除には対応していません。');
  const index = parent.entries.indexOf(entry);
  const ranges = [{ start: entry.start, end: entry.end, text: '' }];
  const comma = entry.comma ?? parent.entries[index - 1]?.comma;
  if (comma !== null && comma !== undefined) ranges.push({ start: comma, end: comma + 1, text: '' });
  return applyTextRanges(text, ranges);
}

export function insertEditableArrayValue(text, tree, pointer, index, value) {
  const { node } = findEditableNode(tree, pointerParts(pointer));
  if (node.type !== 'array' || !Number.isInteger(index) || index < 0 || index > node.entries.length) editFail('EDIT_ARRAY_INSERT_INVALID', '追加先配列または追加位置が不正です。');
  const target = node.entries[index];
  const at = target ? target.start : node.end - 1;
  const serialized = formattedValue(text, at, value);
  if (target) return applyTextRanges(text, [{ start: at, end: at, text: `${serialized},` }]);
  const last = node.entries.at(-1);
  return applyTextRanges(text, [{ start: at, end: at, text: `${last && last.comma === null ? ',' : ''}${serialized}` }]);
}

export function renameEditableKey(text, tree, pointer, name) {
  const { parent, entry } = findEditableNode(tree, pointerParts(pointer));
  if (parent?.type !== 'object' || !entry) editFail('EDIT_KEY_RENAME_INVALID', '要素名を変更するにはオブジェクトのキーを指定してください。');
  if (parent.entries.some(item => item !== entry && item.key === name)) editFail('EDIT_NAME_CONFLICT', '変更先の要素名がすでに存在します。');
  return applyTextRanges(text, [{ start: entry.keyStart, end: entry.keyEnd, text: JSON.stringify(name) }]);
}

/** Copy an authored JSONC range without discarding its comments or expressions. */
export function appendEditableRawProperty(text, tree, name, rawValue) {
  if (tree.type !== 'object' || typeof name !== 'string' || tree.entries.some(entry => entry.key === name)) {
    editFail('EDIT_NAME_CONFLICT', '複製先の定義名を一意に決定できません。');
  }
  parseEditableJsonc(rawValue, '(authored-clone)');
  const last = tree.entries.at(-1), newline = text.includes('\r\n') ? '\r\n' : '\n';
  return applyTextRanges(text, [{ start: tree.end - 1, end: tree.end - 1,
    text: `${last && last.comma === null ? ',' : ''}${newline}${JSON.stringify(name)}: ${rawValue}${newline}` }]);
}
