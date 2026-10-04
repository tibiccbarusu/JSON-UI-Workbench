/**
 * ブラウザ ESM。現在画面のグループ設定と controller metadata を純粋変換する。
 * DOM・ストレージ・通信・controller を変更しない。SHA-256 は標準 Web Crypto を利用。
 */
export const GROUP_FILE_MAX_BYTES21 = 1024 * 1024;
const FILE_SCHEMA = 'jsonui-editor-current-screen-groups';
const METADATA_SCHEMA = 'jsonui-editor-groups-v1';
const MAX_NODES = 50000;
const MAX_GROUPS = 5000;
const MAX_STRUCTURE_BYTES = 8 * 1024 * 1024;
const MAX_ID_LENGTH = 4096;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function objectKeys(value, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('GROUP_FILE_INVALID', `${label} はオブジェクトが必要です。`);
  }
  const keys = Object.keys(value);
  if (keys.length !== required.length || keys.some(key => !required.includes(key))) {
    fail('GROUP_FILE_INVALID', `${label} に不足または未知の項目があります。`);
  }
}

function textId(value, label, max = MAX_ID_LENGTH, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.length) || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail('GROUP_FILE_INVALID', `${label} は制御文字を含まない ${max} 文字以内の文字列が必要です。`);
  }
  return value;
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('GROUP_FILE_LIMIT', `${label} が許容範囲外です。`);
  }
  return value;
}

function relativePath(value, label, allowEmpty = false) {
  textId(value, label, MAX_ID_LENGTH, allowEmpty);
  if (!value && allowEmpty) return value;
  const withoutTrailing = allowEmpty && value.endsWith('/') ? value.slice(0, -1) : value;
  if (!withoutTrailing || /[\\:]/u.test(value)
    || withoutTrailing.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('GROUP_FILE_INVALID', `${label} は正規化済みの相対パスが必要です。`);
  }
  return value;
}

function normalizePacks(packContext) {
  if (!Array.isArray(packContext) || !packContext.length || packContext.length > 2) {
    fail('GROUP_FILE_INVALID', 'パック情報は 1 件または 2 件必要です。');
  }
  const kinds = new Set();
  return packContext.map(pack => {
    objectKeys(pack, ['kind', 'uuid', 'version', 'rootPrefix', 'entryCount'], 'パック情報');
    if (!['vanilla', 'imported'].includes(pack.kind) || kinds.has(pack.kind)) {
      fail('GROUP_FILE_INVALID', 'パックの種類が不正または重複しています。');
    }
    kinds.add(pack.kind);
    if (typeof pack.uuid !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(pack.uuid)) {
      fail('GROUP_FILE_PACK_ID_REQUIRED', 'グループ設定の照合にはパック manifest の有効な UUID が必要です。');
    }
    if (!Array.isArray(pack.version) || pack.version.length !== 3) {
      fail('GROUP_FILE_INVALID', 'パック version は 3 個の整数が必要です。');
    }
    return { kind: pack.kind, uuid: pack.uuid.toLowerCase(),
      version: pack.version.map(value => integer(value, 0, 2147483647, 'パック version')),
      rootPrefix: relativePath(pack.rootPrefix, 'パック rootPrefix', true),
      entryCount: integer(pack.entryCount, 1, 1000000, 'パック entryCount') };
  });
}

function normalizeContext({ identity, packContext, path, qualifiedName }) {
  return { identity: textId(identity, '現在画面 identity'), packContext: normalizePacks(packContext),
    path: relativePath(path, '画面 path'), qualifiedName: textId(qualifiedName, '画面 qualifiedName') };
}

function uniqueIds(values, label, { minimum = 0, maximum = MAX_NODES } = {}) {
  if (!Array.isArray(values) || values.length < minimum || values.length > maximum) {
    fail('GROUP_FILE_LIMIT', `${label} の配列または件数が不正です。`);
  }
  const ids = values.map(value => textId(value, label));
  if (new Set(ids).size !== ids.length) fail('GROUP_FILE_INVALID', `${label} に重複があります。`);
  return ids;
}

function normalizeRow(row) {
  objectKeys(row, ['identity', 'selectedIds', 'groups'], '画面 metadata');
  const selectedIds = uniqueIds(row.selectedIds, '選択 ID');
  if (!Array.isArray(row.groups) || row.groups.length > MAX_GROUPS) {
    fail('GROUP_FILE_LIMIT', 'グループ数の上限を超えています。');
  }
  const ids = new Set(), occupied = new Set();
  const groups = row.groups.map(group => {
    objectKeys(group, ['id', 'name', 'members'], 'グループ');
    const id = textId(group.id, 'グループ ID');
    if (ids.has(id)) fail('GROUP_FILE_INVALID', 'グループ ID に重複があります。');
    ids.add(id);
    const name = textId(group.name, 'グループ名', 256, true);
    const members = uniqueIds(group.members, '構成要素 ID', { minimum: 2 });
    for (const member of members) {
      if (occupied.has(member)) fail('GROUP_FILE_INVALID', '複数グループの構成要素が重複しています。');
      occupied.add(member);
    }
    if (occupied.size > MAX_NODES) fail('GROUP_FILE_LIMIT', '構成要素の総数が上限を超えています。');
    return { id, name, members };
  });
  return { identity: textId(row.identity, '画面 identity'), selectedIds, groups };
}

function normalizeMetadata(metadata, maxScreens) {
  integer(maxScreens, 1, 512, 'maxScreens');
  objectKeys(metadata, ['schema', 'screens'], 'controller metadata');
  if (metadata.schema !== METADATA_SCHEMA || !Array.isArray(metadata.screens)
    || metadata.screens.length > maxScreens) fail('GROUP_FILE_LIMIT', '画面 metadata の形式または画面数が不正です。');
  const identities = new Set();
  const screens = metadata.screens.map(row => {
    const copy = normalizeRow(row);
    if (identities.has(copy.identity)) fail('GROUP_FILE_INVALID', '画面 identity に重複があります。');
    identities.add(copy.identity);
    return copy;
  });
  return { schema: METADATA_SCHEMA, screens };
}

function buildStructure(file) {
  const nodes = file?.nodesById;
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) {
    fail('GROUP_FILE_NODE_INVALID', '画面 nodesById が必要です。');
  }
  const ids = Object.keys(nodes).sort();
  if (!ids.length || ids.length > MAX_NODES) fail('GROUP_FILE_LIMIT', '画面要素数が許容範囲外です。');
  const rootId = textId(file.rootId ?? file.uiModel?.root?.id, 'ルート要素 ID');
  const idSet = new Set(ids);
  if (!idSet.has(rootId)) fail('GROUP_FILE_NODE_INVALID', 'ルート要素が存在しません。');
  const parent = new Map(), edges = new Map(), rows = [];
  let edgeCount = 0, encodedBytes = 0;
  const encoder = new TextEncoder();
  for (const id of ids) {
    textId(id, '要素 ID');
    const node = nodes[id];
    if (!node || typeof node !== 'object' || Array.isArray(node) || node.id !== id
      || (node.isFileRoot === true && id !== rootId)) fail('GROUP_FILE_NODE_INVALID', `要素 ${id} の構造が不正です。`);
    if (node.children != null && !Array.isArray(node.children)) fail('GROUP_FILE_NODE_INVALID', `要素 ${id} の children は配列が必要です。`);
    const children = uniqueIds((node.children ?? []).map(child => typeof child === 'string' ? child : child?.id), '子要素 ID');
    edgeCount += children.length;
    if (edgeCount > MAX_NODES * 2) fail('GROUP_FILE_LIMIT', '親子参照数の上限を超えています。');
    for (const child of children) {
      if (!idSet.has(child) || child === rootId || parent.has(child)) {
        fail('GROUP_FILE_NODE_INVALID', `子要素 ${child} が不明、ルート参照、または複数親です。`);
      }
      parent.set(child, id);
    }
    edges.set(id, children);
    const type = textId(node.type ?? 'unknown', '要素 type', 256);
    const name = textId(node.props?.name ?? node.key?.raw ?? id, '要素名');
    const row = [id, type, name, id === rootId, children];
    encodedBytes += encoder.encode(JSON.stringify(row)).byteLength + 1;
    if (encodedBytes > MAX_STRUCTURE_BYTES) fail('GROUP_FILE_LIMIT', '画面構造の照合データが 8 MiB を超えています。');
    rows.push(row);
  }
  // 再帰を使わず、未到達要素・循環・孤立ノード・親の不一致を拒否する。
  const visited = new Set(), pending = [{ id: rootId, exit: false }];
  const entry = new Map(), end = new Map();
  let order = 0;
  while (pending.length) {
    const { id, exit } = pending.pop();
    if (exit) { end.set(id, order); continue; }
    if (visited.has(id)) fail('GROUP_FILE_NODE_INVALID', '親子参照が循環しています。');
    visited.add(id);
    entry.set(id, order++);
    const node = nodes[id];
    if (node.parentId != null && node.parentId !== parent.get(id)) {
      fail('GROUP_FILE_NODE_INVALID', `要素 ${id} の親参照が一致しません。`);
    }
    pending.push({ id, exit: true });
    const children = edges.get(id);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push({ id: children[index], exit: false });
  }
  if (visited.size !== ids.length) fail('GROUP_FILE_NODE_INVALID', 'ルートから到達できない要素があります。');
  const canonical = JSON.stringify(['jsonui-group-structure-v1', rootId, rows]);
  if (encoder.encode(canonical).byteLength > MAX_STRUCTURE_BYTES) fail('GROUP_FILE_LIMIT', '画面構造の照合データが 8 MiB を超えています。');
  return { rootId, ids: idSet, entry, end, canonical };
}

function verifyCurrentRow(row, structure) {
  const valid = id => structure.ids.has(id) && id !== structure.rootId;
  for (const id of [...row.selectedIds, ...row.groups.flatMap(group => group.members)]) {
    if (!valid(id)) fail('GROUP_FILE_NODE_MISMATCH', `設定の要素 ${id} が現在画面に存在しないか、選択不可です。`);
  }
  // DFS 区間で親子を検査し、多数グループで深い祖先を何度も辿る処理を避ける。
  // controller の reconcileState が親子を黙って縮約しないよう、ここで拒否する。
  for (const group of row.groups) {
    const members = [...group.members].sort((a, b) => structure.entry.get(a) - structure.entry.get(b));
    for (let index = 1; index < members.length; index += 1) {
      if (structure.entry.get(members[index]) < structure.end.get(members[index - 1])) {
        fail('GROUP_FILE_NODE_MISMATCH', '同じグループに祖先と子孫の要素が含まれています。');
      }
    }
  }
}

async function fingerprint(structure) {
  if (!globalThis.crypto?.subtle) fail('GROUP_FILE_CRYPTO_UNAVAILABLE', '構造照合に必要な Web Crypto API が利用できません。');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(structure.canonical));
  return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function readFileText(text) {
  if (typeof text !== 'string') fail('GROUP_FILE_INVALID', '設定ファイルは JSON 文字列で渡してください。');
  if (text.length > GROUP_FILE_MAX_BYTES21 || new TextEncoder().encode(text).byteLength > GROUP_FILE_MAX_BYTES21) {
    fail('GROUP_FILE_LIMIT', 'グループ設定ファイルは 1 MiB 以内にしてください。');
  }
  let data;
  try { data = JSON.parse(text); } catch { fail('GROUP_FILE_INVALID', 'グループ設定の JSON を解析できません。'); }
  objectKeys(data, ['schema', 'version', 'packContext', 'screen', 'nodeFingerprint', 'selectedIds', 'groups'], '設定ファイル');
  if (data.schema !== FILE_SCHEMA || data.version !== 1) fail('GROUP_FILE_INVALID', '未対応のグループ設定形式または version です。');
  objectKeys(data.screen, ['path', 'qualifiedName'], '設定ファイル画面');
  if (typeof data.nodeFingerprint !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(data.nodeFingerprint)) {
    fail('GROUP_FILE_INVALID', '画面構造 fingerprint の形式が不正です。');
  }
  return data;
}

/**
 * 現在画面一件を JSON 文字列へ変換。session identity は出力しない。
 * packContext: [{kind, uuid, version:[major,minor,patch], rootPrefix, entryCount}]。
 * パック記述情報と構造を照合する。パック全体のバイト一致を保証するものではない。
 * @param {{metadata:object, identity:string, packContext:object[], path:string, qualifiedName:string, file:object, maxScreens?:number}} options
 * @returns {Promise<string>}
 */
export async function exportCurrentScreenGroups21(options) {
  const context = normalizeContext(options);
  const metadata = normalizeMetadata(options.metadata, options.maxScreens ?? 64);
  const row = metadata.screens.find(screen => screen.identity === context.identity);
  if (!row) fail('GROUP_FILE_SCREEN_MISSING', '現在画面のグループ情報を初期化してから保存してください。');
  const structure = buildStructure(options.file);
  verifyCurrentRow(row, structure);
  const data = { schema: FILE_SCHEMA, version: 1, packContext: context.packContext,
    screen: { path: context.path, qualifiedName: context.qualifiedName },
    nodeFingerprint: await fingerprint(structure), selectedIds: row.selectedIds, groups: row.groups };
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (new TextEncoder().encode(text).byteLength > GROUP_FILE_MAX_BYTES21) fail('GROUP_FILE_LIMIT', 'グループ設定が 1 MiB を超えているため保存できません。');
  return text;
}

/**
 * 読込内容を全件検証し、現在 identity にだけ割り当て直した metadata を返す。
 * 入力 metadata/controller は変更しない。呼出側が返値を importMetadata へ渡す。
 * @param {{text:string, metadata:object, identity:string, packContext:object[], path:string, qualifiedName:string, file:object, maxScreens?:number}} options
 * @returns {Promise<object>}
 */
export async function mergeCurrentScreenGroups21(options) {
  const data = readFileText(options.text);
  const context = normalizeContext(options);
  const packContext = normalizePacks(data.packContext);
  if (JSON.stringify(packContext) !== JSON.stringify(context.packContext)) {
    fail('GROUP_FILE_PACK_MISMATCH', '設定ファイルのパック情報が現在のパック構成と一致しません。');
  }
  if (relativePath(data.screen.path, '設定ファイル path') !== context.path
    || textId(data.screen.qualifiedName, '設定ファイル qualifiedName') !== context.qualifiedName) {
    fail('GROUP_FILE_SCREEN_MISMATCH', '設定ファイルの UI パスまたは定義名が現在画面と一致しません。');
  }
  const metadata = normalizeMetadata(options.metadata, options.maxScreens ?? 64);
  const row = normalizeRow({ identity: context.identity, selectedIds: data.selectedIds, groups: data.groups });
  const structure = buildStructure(options.file);
  verifyCurrentRow(row, structure);
  if (data.nodeFingerprint !== await fingerprint(structure)) {
    fail('GROUP_FILE_NODE_MISMATCH', '設定保存時と現在の画面要素構造が一致しません。');
  }
  const index = metadata.screens.findIndex(screen => screen.identity === context.identity);
  if (index < 0) {
    if (metadata.screens.length >= (options.maxScreens ?? 64)) fail('GROUP_FILE_LIMIT', '保持できる画面数の上限です。');
    metadata.screens.push(row);
  } else metadata.screens[index] = row;
  return metadata;
}
