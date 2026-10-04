/** CLI file boundaries: UTF-8 JSON, bounded regular files, atomic replacement.
 * Source archives and installed application files are never writable outputs. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, lstat, stat, realpath, mkdir, rename, link, rm } from 'node:fs/promises';

export const CLI_JSON_LIMIT = 16 * 1024 * 1024;
const INSTALL_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const RESERVED = new Set(['local-node', 'editor-core', 'tools', 'docs', 'vendor', 'registry', '.git', '.openai', '.jsonui']);
const ROOT_FILES = new Set(['package.json', 'package-lock.json', 'start.bat', 'start.cmd', 'readme.md', 'license']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function cliError(code, message, context = {}) {
  return Object.assign(new Error(message), { code, context, category: 'validation', retryable: false, details: [], cause: null });
}

export function checkedPath(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\u0000-\u001f]/u.test(value)) {
    throw cliError('CLI_PATH_INVALID', 'ファイルパスが不正です。');
  }
  return path.resolve(value);
}

async function existingInfo(filename) {
  try { return await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function physicalDestination(filename) {
  let directory = path.dirname(filename);
  const suffix = [path.basename(filename)];
  while (!(await existingInfo(directory))) {
    suffix.unshift(path.basename(directory));
    const parent = path.dirname(directory);
    if (parent === directory) throw cliError('CLI_PARENT_INVALID', '出力先の親ディレクトリを確認できません。');
    directory = parent;
  }
  if (!(await stat(directory)).isDirectory()) throw cliError('CLI_PARENT_INVALID', '出力先の親がディレクトリではありません。');
  return path.join(await realpath(directory), ...suffix);
}

/** Validate a destination before creating any directory or temporary file. */
export async function checkOutputPath(filename, { extensions = ['.json'], protectedPaths = [], replace = false } = {}) {
  const destination = checkedPath(filename);
  if (!extensions.includes(path.extname(destination).toLowerCase())) throw cliError('CLI_OUTPUT_EXTENSION', '出力形式に対応した拡張子を指定してください。', { extensions });
  const physical = await physicalDestination(destination);
  const relative = path.relative(await realpath(INSTALL_ROOT), physical);
  if (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
    const components = relative.split(path.sep);
    if (RESERVED.has(components[0].toLowerCase()) || (components.length === 1 && ROOT_FILES.has(components[0].toLowerCase()))) {
      throw cliError('CLI_APPLICATION_PATH_PROTECTED', 'アプリ本体のファイルは出力先に指定できません。');
    }
  }
  const info = await existingInfo(destination);
  if (info && (!info.isFile() || info.isSymbolicLink())) throw cliError('CLI_OUTPUT_NOT_REGULAR', '出力先は通常ファイルである必要があります。');
  for (const source of protectedPaths) {
    const sourcePath = checkedPath(source);
    const sourceReal = await realpath(sourcePath).catch(() => sourcePath);
    if (sourceReal === physical) throw cliError('CLI_SOURCE_PATH_PROTECTED', '元パックや入力ファイルを出力で上書きすることはできません。');
    const sourceInfo = info ? await stat(sourcePath).catch(() => null) : null;
    if (info && sourceInfo && info.dev === sourceInfo.dev && info.ino === sourceInfo.ino) throw cliError('CLI_SOURCE_PATH_PROTECTED', '元ファイルと同一の出力先は指定できません。');
  }
  if (info && !replace) throw cliError('CLI_OUTPUT_EXISTS', '出力先が既に存在します。別名を指定するか、成果物に限り --force を指定してください。');
  return destination;
}

/** Write through a sibling temporary file; new outputs use a no-clobber link.
 * File bytes are synced before exposure. Parent-directory durability is not claimed. */
export async function atomicWrite(filename, bytes, options = {}) {
  const destination = await checkOutputPath(filename, options);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(destination), `.jsonui-write-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    if (options.replace) await rename(temporary, destination);
    else {
      // link() fails if another writer created destination after validation.
      try { await link(temporary, destination); } catch (error) {
        if (error.code === 'EEXIST') throw cliError('CLI_OUTPUT_EXISTS', '別の処理が先に出力先を作成しました。');
        throw error;
      }
      await rm(temporary);
    }
    const extension = path.extname(destination).toLowerCase(), archive = ['.zip', '.mcpack'].includes(extension), svg = extension === '.svg', png = extension === '.png';
    return { direction: 'output', operation: 'WRITE_CLI_ARTIFACT', endpoint_type: 'file_path', locator: destination,
      format: archive ? 'archive' : png ? 'binary' : svg ? 'xml' : extension === '.jsonc' ? 'custom' : 'json',
      content_kind: archive ? 'resource_pack' : png ? 'jsonui_preview_frame' : svg ? 'jsonui_structure_diagnostic' : 'jsonui_cli_document', cardinality: 'exactly_one', context: {},
      path: destination, size_bytes: Buffer.byteLength(bytes), checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
      media_type: archive ? 'application/zip' : png ? 'image/png' : svg ? 'image/svg+xml' : extension === '.jsonc' ? 'text/plain' : 'application/json',
      ...(archive || png ? {} : { encoding: 'UTF-8' }), exists_policy: options.replace ? 'replace' : 'create_new',
      parent_directory_policy: 'create_if_missing', write_model: 'staged_replace',
      completion_condition: 'final_name_exposed', durability_level: 'sync_requested' };
  } finally { await handle?.close().catch(() => {}); await rm(temporary, { force: true }).catch(() => {}); }
}

/** Read a regular file without allocating more than the declared byte budget.
 * The extra byte detects growth past the boundary before full-file allocation. */
export async function readRegularBytes(filename, maximum = CLI_JSON_LIMIT) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > CLI_JSON_LIMIT) {
    throw cliError('CLI_INPUT_LIMIT_INVALID', '入力サイズの上限指定が不正です。');
  }
  const source = checkedPath(filename), info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw cliError('CLI_INPUT_NOT_REGULAR', '入力には通常ファイルを指定してください。');
  if (info.size > maximum) throw cliError('CLI_INPUT_LIMIT', '入力ファイルがサイズ上限を超えています。', { maximum_bytes: maximum });
  const handle = await open(source, 'r');
  try {
    const opened = await handle.stat();
    if (opened.size > maximum || !opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw cliError('CLI_INPUT_CHANGED', '入力ファイルが読込中に変更されました。');
    const data = Buffer.alloc(Math.min(maximum + 1, opened.size + 1));
    let total = 0;
    while (total < data.length) {
      const { bytesRead } = await handle.read(data, total, data.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maximum) throw cliError('CLI_INPUT_LIMIT', '入力ファイルがサイズ上限を超えています。');
    const after = await handle.stat();
    if (total !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      throw cliError('CLI_INPUT_CHANGED', '入力ファイルが読込中に変更されました。');
    }
    return data.subarray(0, total);
  } finally { await handle.close(); }
}

export async function readRegularText(filename, maximum = CLI_JSON_LIMIT) {
  const data = await readRegularBytes(filename, maximum);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
  catch { throw cliError('CLI_UTF8_INVALID', '入力テキストは UTF-8 で保存してください。'); }
}

export async function readJson(filename, maximum = CLI_JSON_LIMIT) {
  let value;
  try { value = JSON.parse((await readRegularText(filename, maximum)).replace(/^\ufeff/u, '')); } catch (error) {
    if (error instanceof SyntaxError) throw cliError('CLI_JSON_INVALID', '入力 JSON を解析できません。');
    throw error;
  }
  if (!object(value)) throw cliError('CLI_JSON_OBJECT_REQUIRED', '入力 JSON の最上位はオブジェクトにしてください。');
  return value;
}

/** Lock a session for the entire read/restore/edit/save transaction. */
export async function lockSession(filename) {
  const destination = await checkOutputPath(filename, { replace: true });
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const lockPath = `${destination}.lock`;
  let handle;
  try { handle = await open(lockPath, 'wx', 0o600); } catch (error) {
    if (error.code === 'EEXIST') throw cliError('CLI_SESSION_LOCKED', '同じセッションを別の処理が使用中です。異常終了後の場合は、その処理が終了したことを確認して .lock を削除してください。');
    throw error;
  }
  const identity = await handle.stat();
  // File identifiers may change on a synchronized/virtual filesystem while
  // a long command is running. A random per-acquisition token identifies
  // ownership independently of PID reuse and filesystem identity changes.
  const payload = JSON.stringify({ schema: 'jsonui-cli-lock-v1', owner_token: randomUUID(), pid: process.pid, created_at: new Date().toISOString() }) + '\n';
  try { await handle.writeFile(payload); await handle.sync(); }
  catch (error) {
    await handle.close();
    const current = await existingInfo(lockPath);
    if (current?.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) await rm(lockPath, { force: true });
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return; released = true;
    await handle.close();
    const current = await existingInfo(lockPath);
    if (!current?.isFile() || current.isSymbolicLink() || current.size !== Buffer.byteLength(payload)) return;
    let reader;
    try {
      reader = await open(lockPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      const opened = await reader.stat();
      if (!opened.isFile() || opened.size !== Buffer.byteLength(payload)) return;
      const bytes = Buffer.alloc(Buffer.byteLength(payload) + 1);
      const { bytesRead } = await reader.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== Buffer.byteLength(payload) || bytes.subarray(0, bytesRead).toString('utf8') !== payload) return;
      const final = await existingInfo(lockPath);
      // Do not unlink a replacement name installed during the ownership read.
      if (!final?.isFile() || final.isSymbolicLink() || final.dev !== opened.dev || final.ino !== opened.ino) return;
      await rm(lockPath, { force: true });
    } catch (error) {
      if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error;
    } finally { await reader?.close(); }
  };
}

export async function readSession(filename) {
  const info = await existingInfo(filename);
  if (!info) return { schema: 'jsonui-cli-session-v1', created_at: new Date().toISOString(), sources: [], settings: {}, selected: null };
  const session = await readJson(filename);
  if (session.schema !== 'jsonui-cli-session-v1' || !Array.isArray(session.sources) || session.sources.length > 2 || !object(session.settings)) {
    throw cliError('CLI_SESSION_INVALID', 'セッションファイルの形式が不正です。');
  }
  const kinds = new Set();
  for (const source of session.sources) {
    if (!object(source) || !['imported', 'vanilla'].includes(source.kind) || kinds.has(source.kind)
      || typeof source.path !== 'string' || !path.isAbsolute(source.path) || !/^[0-9a-f]{64}$/u.test(source.checksum_sha256)
      || !Number.isSafeInteger(source.size_bytes) || source.size_bytes < 22 || !object(source.overrides)) throw cliError('CLI_SESSION_INVALID', 'セッション内のパック記録が不正です。');
    kinds.add(source.kind);
  }
  return session;
}

export async function saveSession(filename, session, protectedPaths = []) {
  const text = JSON.stringify({ ...session, updated_at: new Date().toISOString() }, null, 2) + '\n';
  if (Buffer.byteLength(text) > CLI_JSON_LIMIT) throw cliError('CLI_SESSION_LIMIT', 'セッションの編集内容が保存上限を超えました。');
  return atomicWrite(filename, text, { replace: true, protectedPaths });
}
