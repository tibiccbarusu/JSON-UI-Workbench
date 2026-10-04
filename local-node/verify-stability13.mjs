#!/usr/bin/env node
/** Finite stability runner. Separate child/server per cycle, real HTTP/Worker.
 * Not a benchmark of Minecraft pixel equivalence. Node.js >=22.14.0. */
import { fork, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, writeFile, rename, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENTRY = fileURLToPath(import.meta.url);
const now = () => new Date().toISOString();
const fault = (code, message, context = {}) => Object.assign(new Error(message), { code, context });
const hash = value => createHash('sha256').update(value).digest('hex');
const finite = (value, fallback, min, max) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw fault('STABILITY_ARGUMENT_INVALID', '数値引数が許容範囲外です。', { min, max });
  return n;
};

export function parseStabilityArguments(argv) {
  const options = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--pack', '--out', '--duration-seconds', '--max-ops', '--cycle-seconds', '--call-seconds', '--ui-per-cycle'].includes(key)
      || options[key] !== undefined || argv[index + 1] === undefined) throw fault('STABILITY_ARGUMENT_INVALID', '不明・重複・不足の引数があります。');
    options[key] = argv[index + 1];
  }
  if (!options['--pack'] || !options['--out']) throw fault('STABILITY_ARGUMENT_REQUIRED', '--pack と --out を指定してください。');
  return { pack: path.resolve(options['--pack']), outputParent: path.resolve(options['--out']),
    durationSeconds: finite(options['--duration-seconds'], 120, 10, 10800), maxOps: finite(options['--max-ops'], 100, 1, 100000),
    cycleSeconds: finite(options['--cycle-seconds'], 600, 30, 600), callSeconds: finite(options['--call-seconds'], 60, 5, 180),
    uiPerCycle: finite(options['--ui-per-cycle'], 36, 1, 100) };
}

/** Hash product code around each cycle; documentation and runner logs excluded. */
export async function productDigest() {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'tests' || entry.name.startsWith('.')) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && /\.(?:mjs|cjs|js|json|html|css|wasm)$/u.test(entry.name)
        && !/^(?:verify-|benchmark-)/u.test(entry.name)) files.push(filename);
    }
  }
  for (const relative of ['local-node', 'editor-core/src', 'editor-core/app']) await walk(path.join(ROOT, relative));
  files.push(path.join(ROOT, 'package.json')); files.sort();
  const digest = createHash('sha256'); let bytes = 0;
  for (const filename of files) {
    const relative = path.relative(ROOT, filename).split(path.sep).join('/'); digest.update(relative + '\0');
    for await (const chunk of createReadStream(filename)) { digest.update(chunk); bytes += chunk.length; }
    digest.update('\0');
  }
  return { sha256: digest.digest('hex'), file_count: files.length, size_bytes: bytes };
}

async function saveJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, filename);
}

function errorSummary(error) {
  return { code: /^[A-Z0-9_]+$/u.test(error?.code || '') ? error.code : 'STABILITY_UNEXPECTED',
    message: /^[A-Z0-9_]+$/u.test(error?.code || '') ? String(error.message).slice(0, 1000) : '予期しない例外を捕捉しました。', context: error?.context || {} };
}

function compactMetrics(client) {
  const snapshot = client?.app?.processor?.snapshot(), caches = snapshot?.caches;
  return { process_memory: process.memoryUsage(), worker: snapshot ? { dead: snapshot.dead, pending: snapshot.pending,
    calls: snapshot.calls, failed: snapshot.failed, completed: snapshot.completed, active_jobs: snapshot.active_jobs,
    worker_memory: caches?.worker_memory, frame_ir: caches?.frame_ir, projection_cache: caches?.projection_cache,
    response_cache: caches?.response_cache, validation: caches?.validation, font_cache: caches?.font_cache,
    zip_io: caches?.zip_io } : null };
}

async function spoolState(root) {
  const exists = await stat(root).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!exists) return { exists: false, bytes: 0, files: 0 };
  let bytes = 0, files = 0;
  for (const entry of await readdir(path.join(root, 'packs'), { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile()) { bytes += (await stat(path.join(root, 'packs', entry.name))).size; files++; }
  }
  return { exists: true, bytes, files };
}

export function selectStabilityDefinitions(records, count, cycle) {
  const byPath = new Map();
  for (const record of records.filter(item => item.profile === 'classic' && item.classification === 'SCREEN' && item.sourceKind === 'vanilla')
    .sort((a, b) => a.filePath.localeCompare(b.filePath) || Number(!a.localName.endsWith('screen')) - Number(!b.localName.endsWith('screen')) || a.rawKey.localeCompare(b.rawKey))) {
    if (!byPath.has(record.filePath)) byPath.set(record.filePath, record);
  }
  const candidates = [...byPath.values()], selected = [];
  if (!candidates.length) return selected;
  for (let index = 0; index < Math.min(count, candidates.length); index++) selected.push(candidates[((cycle - 1) * count + index) % candidates.length]);
  return selected;
}

async function runChild(config) {
  let sequence = 0, client, workspace, operations = 0, interrupted = false, base;
  const pending = new Map(), cancellation = new AbortController(), started = Date.now();
  process.on('message', message => { if (message?.ack && pending.has(message.ack)) { pending.get(message.ack)(message); pending.delete(message.ack); } });
  const emit = row => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, reply => reply.stop ? reject(fault(reply.stop, '設定した実行上限に達しました。')) : resolve());
    process.send({ id, row: { schema: 'jsonui-stability-event-v1', timestamp: now(), cycle: config.cycle, ...row } }, error => { if (error) { pending.delete(id); reject(error); } });
  });
  const stop = () => { interrupted = true; cancellation.abort(fault('STABILITY_CANCELLED', '実行停止要求を受けました。')); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const startDigest = await productDigest();
  await emit({ event: 'CYCLE_BEGIN', source_digest: startDigest, child_pid: process.pid });
  let result = { status: 'PASS', operations: 0 };
  async function step(label, operation, summarize = value => value) {
    if (interrupted) throw fault('STABILITY_CANCELLED', '実行停止要求を受けました。');
    if (operations >= config.remainingOps) throw fault('STABILITY_MAX_OPS', '最大操作回数に達しました。');
    const number = ++operations, start = Date.now(); let timedOut = false;
    await emit({ event: 'OP_BEGIN', operation: label, operation_index: number });
    const timer = setTimeout(() => { timedOut = true; cancellation.abort(fault('STABILITY_CALL_TIMEOUT', 'API 外側の制限時間を超えました。')); }, config.callSeconds * 1000);
    try {
      const value = await operation();
      const summary = summarize(value);
      await emit({ event: 'OP_END', operation: label, operation_index: number, status: summary?.domain_blocked ? 'DOMAIN_BLOCKED' : 'PASS',
        duration_ms: Date.now() - start, result: summary, metrics: compactMetrics(client) });
      return value;
    } catch (error) {
      if (timedOut) error = fault('STABILITY_CALL_TIMEOUT', 'API 外側の制限時間を超えました。', { operation: label });
      await emit({ event: 'OP_END', operation: label, operation_index: number, status: interrupted ? 'CANCELLED' : 'FAIL', duration_ms: Date.now() - start,
        error: errorSummary(error), metrics: compactMetrics(client) }); throw error;
    } finally { clearTimeout(timer); }
  }
  try {
    const { CliClient } = await import('./cli-client.mjs');
    const { makeZip, manifest } = await import('./tests/fixtures.mjs');
    client = await CliClient.start({ signal: cancellation.signal }); base = client.base;
    const fixture = makeZip({ 'manifest.json': manifest,
      'ui/_ui_defs.json': '{"ui_defs":["ui/stability13.json"]}',
      'ui/stability13.json': JSON.stringify({ namespace: 'stability13', screen: { type: 'screen', size: [160, 90],
        controls: [{ label: { type: 'label', text: '安定性観測', size: [100, 12] } }] }, unused: { type: 'panel' } }) });
    const fixturePath = path.join(config.runDirectory, `cycle-${config.cycle}-input.zip`);
    await writeFile(fixturePath, fixture, { flag: 'wx', mode: 0o600 });
    const vanilla = await step('IMPORT_OFFICIAL', () => client.importPack(config.pack), value => ({ size_bytes: value.source.size_bytes, sha256: value.source.checksum_sha256, entries: value.metadata.entries?.length }));
    const imported = await step('IMPORT_FIXTURE', () => client.importPack(fixturePath), value => ({ size_bytes: value.source.size_bytes, sha256: value.source.checksum_sha256 }));
    workspace = await step('WORKSPACE_OPEN', () => client.request('/api/node/workspace-open', { payload: { sources: [{ id: vanilla.id, kind: 'vanilla' }, { id: imported.id, kind: 'imported' }] } }),
      value => ({ revision: value.revision, files: value.files?.length, nodes: value.nodes?.length, diagnostics: value.diagnostics?.length, preview_allowed: value.previewAllowed }));
    const catalog = await step('CATALOG', () => client.request('/api/node/workspace-catalog', { payload: { workspaceId: workspace.workspaceId } }), value => ({ records: value.records?.length, files: value.files?.length }));
    const selected = selectStabilityDefinitions(catalog.records || [], config.uiPerCycle, config.cycle);
    if (!selected.length) throw fault('STABILITY_NO_CLASSIC_SCREEN', 'Classic の画面定義を取得できませんでした。');
    for (const [index, record] of selected.entries()) {
      const projection = await step('PROJECT_OFFICIAL', () => client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } }),
        value => ({ file_path: record.filePath, raw_key: record.rawKey, domain_blocked: value.ok === false, diagnostics: value.diagnostics?.slice(0, 8), projection_id: value.nodeProjectionId }));
      if (projection.ok && index % 8 === 0) {
        await step('FRAME_OFFICIAL', () => client.request('/api/node/frame', { payload: { projectionId: projection.nodeProjectionId, filePath: record.filePath, recordId: record.id,
          preset: { width: 1280, height: 720 }, animationTime: (config.cycle % 120) / 60, generation: config.cycle, qualifiedName: record.qualifiedName } }),
        value => ({ file_path: record.filePath, boxes: value.layout?.boxes?.length, truncated: value.layout?.stats?.truncated, animation: value.animation?.trackCount, metrics: value.metrics }));
      }
    }
    const identity = () => ({ workspaceId: workspace.workspaceId, expectedRevision: workspace.revision });
    const originalRevision = workspace.revision;
    const edited = await step('EDIT_FIXTURE', () => client.request('/api/node/workspace-edit', { payload: { ...identity(), operation: { type: 'set', path: 'ui/stability13.json', pointer: '/screen/controls/0/label/text', value: `観測 ${config.cycle}` } } }),
      value => ({ ok: value.ok, revision: value.revision, changed_files: value.changes?.length }));
    if (!edited.ok) throw fault('STABILITY_EDIT_FAILED', '制御用 fixture の編集が失敗しました。', { result: edited });
    workspace.revision = edited.revision; const editedRevision = edited.revision;
    const undone = await step('UNDO_FIXTURE', () => client.request('/api/node/workspace-undo', { payload: identity() }), value => ({ ok: value.ok, revision: value.revision }));
    if (!undone.ok || undone.revision !== originalRevision) throw fault('STABILITY_UNDO_MISMATCH', 'Undo 後の原文 revision が一致しません。');
    workspace.revision = undone.revision;
    const redone = await step('REDO_FIXTURE', () => client.request('/api/node/workspace-redo', { payload: identity() }), value => ({ ok: value.ok, revision: value.revision }));
    if (!redone.ok || redone.revision !== editedRevision) throw fault('STABILITY_REDO_MISMATCH', 'Redo 後の原文 revision が一致しません。');
    workspace.revision = redone.revision;
    const restored = await step('RESTORE_FIXTURE', () => client.request('/api/node/workspace-undo', { payload: identity() }), value => ({ ok: value.ok, revision: value.revision }));
    if (!restored.ok || restored.revision !== originalRevision) throw fault('STABILITY_RESTORE_MISMATCH', '検証後の原文 revision が一致しません。');
    workspace.revision = restored.revision;
    const selections = [{ sourceId: 'imported-pack', filePath: 'ui/stability13.json', rawKey: 'screen' }];
    const plan = await step('EXPORT_FIXTURE_PLAN', () => client.request('/api/node/workspace-export', { payload: { ...identity(), selections, mode: 'plan' } }), value => ({ ok: value.ok, files: value.plan?.files?.length, unresolved: value.plan?.unresolved?.length }));
    if (!plan.ok) throw fault('STABILITY_FIXTURE_EXPORT_FAILED', '制御用 fixture の依存閉包を確定できません。', { plan });
    const zip = await step('EXPORT_FIXTURE_ZIP', () => client.request('/api/node/workspace-export', { payload: { ...identity(), selections, mode: 'zip' }, binary: true }), value => ({ size_bytes: value.length, sha256: hash(value) }));
    if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) throw fault('STABILITY_EXPORT_NOT_ZIP', 'ZIP 以外のデータが返りました。');
    const exportedPath = path.join(config.runDirectory, `cycle-${config.cycle}-selected.zip`); await writeFile(exportedPath, zip, { flag: 'wx', mode: 0o600 });
    const again = await step('REIMPORT_EXPORTED', () => client.importPack(exportedPath), value => ({ size_bytes: value.source.size_bytes, entries: value.metadata.entries?.length }));
    const reimportCatalog = await step('CATALOG_REIMPORTED', () => client.request('/api/node/catalog', { payload: { sources: [{ id: again.id, kind: 'imported' }] } }), value => ({ records: value.records?.length, files: value.files?.length }));
    if (!(reimportCatalog.records || []).some(record => record.qualifiedName === 'stability13.screen') || reimportCatalog.records.some(record => record.qualifiedName === 'stability13.unused')) throw fault('STABILITY_REIMPORT_MISMATCH', '限定書出しの再読込結果が一致しません。');
    await step('REMOVE_REIMPORTED', () => client.request(`/api/node/packs/${again.id}`, { method: 'DELETE' }), value => ({ ok: value.ok }));
    const { lockSession } = await import('./cli-files.mjs');
    const cliDirectory = await mkdtemp(path.join(tmpdir(), 'jsonui-stability-cli-'));
    const sessionPath = path.join(cliDirectory, 'session.json'); let release;
    const cliStatus = () => new Promise((resolve, reject) => execFile(process.execPath, [path.join(ROOT, 'local-node/cli.mjs'), 'status', '--session', sessionPath],
      { maxBuffer: 1024 * 1024, signal: cancellation.signal }, (error, stdout) => {
        let response; try { response = JSON.parse(stdout); } catch { reject(error || fault('STABILITY_CLI_RESPONSE_INVALID', 'CLI の JSON 応答を解析できません。')); return; }
        resolve({ exit_code: error?.code || 0, response });
      }));
    try {
      release = await lockSession(sessionPath);
      const blocked = await step('CLI_LOCK_CONFLICT', cliStatus, value => ({ exit_code: value.exit_code, code: value.response.error?.code }));
      if (blocked.response.error?.code !== 'CLI_SESSION_LOCKED') throw fault('STABILITY_CLI_LOCK_BYPASSED', '保持中のセッションロックが拒否されませんでした。');
      await release(); release = null;
      const reopened = await step('CLI_LOCK_RECOVERY', cliStatus, value => ({ exit_code: value.exit_code, ok: value.response.ok }));
      if (reopened.exit_code !== 0 || !reopened.response.ok || await stat(`${sessionPath}.lock`).catch(() => null)) throw fault('STABILITY_CLI_LOCK_CLEANUP', '所有ロックの解放後に CLI を再実行できませんでした。');
    } finally { await release?.(); await rm(cliDirectory, { recursive: true, force: true }); }
    await emit({ event: 'SPOOL_BEFORE_CLOSE', spool: await spoolState(client.app.root), metrics: compactMetrics(client) });
  } catch (error) {
    const expectedStop = interrupted || ['STABILITY_MAX_OPS', 'STABILITY_CANCELLED'].includes(error.code);
    result = { status: expectedStop ? 'STOP_LIMIT' : 'FAIL', error: errorSummary(error) };
    if (client && !expectedStop) {
      try {
        const response = await fetch(new URL('/api/node/debug-bundle', client.base), { method: 'POST',
          headers: { 'x-jsonui-token': client.token, 'content-type': 'application/json' },
          body: JSON.stringify({ schema: 'jsonui-debug-request-v1', state: { runner: 'stability13', cycle: config.cycle }, diagnostics: [errorSummary(error)] }), signal: AbortSignal.timeout(3000) });
        if (response.ok) await saveJson(path.join(config.runDirectory, `cycle-${config.cycle}-failure-debug.json`), await response.json());
      } catch { result.debug_capture = 'UNAVAILABLE'; }
    }
    await saveJson(path.join(config.runDirectory, `cycle-${config.cycle}-failure.json`), { ...result, metrics: compactMetrics(client), timestamp: now() });
  } finally {
    const spoolRoot = client?.app.root;
    if (client) await client.close();
    const after = spoolRoot ? await spoolState(spoolRoot) : { exists: false };
    let responding = false;
    if (base) try { await fetch(new URL('/api/node/capabilities', base), { signal: AbortSignal.timeout(1000) }); responding = true; } catch { /* Refused connection is the expected close result. */ }
    if (after.exists || responding) result = { status: 'FAIL', error: { code: 'STABILITY_CLEANUP_FAILED', message: '所有サーバーの後始末を確認できません。', context: { spool: after, responding } } };
    const endDigest = await productDigest();
    result = { ...result, schema: 'jsonui-stability-cycle-v1', cycle: config.cycle, operations, elapsed_ms: Date.now() - started,
      source_digest_start: startDigest, source_digest_end: endDigest, source_state: startDigest.sha256 === endDigest.sha256 ? 'STABLE' : 'TRANSITION',
      cleanup: { spool: after, responding }, timestamp: now() };
    await saveJson(path.join(config.runDirectory, `cycle-${config.cycle}-result.json`), result);
    await emit({ event: 'CYCLE_END', ...result });
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
  process.exitCode = result.status === 'FAIL' ? 1 : 0;
  process.disconnect();
}

async function runParent(config) {
  const source = await stat(config.pack);
  if (!source.isFile() || !/\.(?:zip|mcpack)$/iu.test(config.pack)) throw fault('STABILITY_PACK_INVALID', '通常の ZIP/MCPACK を指定してください。');
  await mkdir(config.outputParent, { recursive: true, mode: 0o700 });
  const runDirectory = path.join(config.outputParent, `run-${now().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(runDirectory, { mode: 0o700 }); config.runDirectory = runDirectory;
  await saveJson(path.join(runDirectory, 'run-config.json'), { schema: 'jsonui-stability-config-v1', ...config, node_version: process.versions.node, platform: process.platform });
  const journal = await open(path.join(runDirectory, 'checkpoints.jsonl'), 'wx', 0o600);
  const started = Date.now(), deadline = started + config.durationSeconds * 1000, failures = {}, cycles = [];
  let operations = 0, current, stopped = null, writing = Promise.resolve(), userKillTimer;
  const append = row => {
    writing = writing.then(async () => { await journal.writeFile(JSON.stringify({ schema: 'jsonui-stability-event-v1', timestamp: now(), ...row }) + '\n'); await journal.sync(); });
    return writing;
  };
  const stop = () => { stopped = 'USER_STOP'; const child = current; child?.kill('SIGTERM'); if (child) userKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const heartbeat = setInterval(() => {
    const row = { event: 'HEARTBEAT', elapsed_seconds: Math.round((Date.now() - started) / 1000), operations, cycles_completed: cycles.length, child_pid: current?.pid || null };
    void append(row); process.stdout.write(JSON.stringify(row) + '\n');
  }, 30000);
  await append({ event: 'RUN_BEGIN', limits: { duration_seconds: config.durationSeconds, max_ops: config.maxOps, cycle_seconds: config.cycleSeconds }, parent_pid: process.pid });
  process.stdout.write(JSON.stringify({ event: 'RUN_BEGIN', run_directory: runDirectory, parent_pid: process.pid, deadline: new Date(deadline).toISOString() }) + '\n');
  try {
    while (!stopped && Date.now() < deadline && operations < config.maxOps) {
      const cycle = cycles.length + 1, childConfig = { ...config, cycle, remainingOps: config.maxOps - operations };
      const configurationPath = path.join(runDirectory, `cycle-${cycle}-config.json`); await saveJson(configurationPath, childConfig);
      let result = null, watchdog = false, tail = '', killTimer;
      current = fork(ENTRY, ['--child', configurationPath], { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      for (const stream of [current.stdout, current.stderr]) stream.on('data', chunk => { tail = (tail + chunk.toString('utf8')).slice(-65536); });
      current.on('message', message => {
        if (!message?.id || !message.row) return;
        if (message.row.event === 'OP_BEGIN') operations++;
        if (message.row.event === 'CYCLE_END') result = message.row;
        void append(message.row).then(() => { if (current?.connected) current.send({ ack: message.id }); });
      });
      const child = current, durationRemaining = deadline - Date.now();
      const timer = setTimeout(() => {
        watchdog = true; if (durationRemaining <= config.cycleSeconds * 1000) stopped = 'DURATION_LIMIT';
        child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      }, Math.max(1, Math.min(config.cycleSeconds * 1000, durationRemaining)));
      const outcome = await new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
      clearTimeout(timer); clearTimeout(killTimer); current = null; await writing;
      if (tail) await writeFile(path.join(runDirectory, `cycle-${cycle}-process.log`), tail, { flag: 'wx', mode: 0o600 });
      result ||= { cycle, status: stopped ? 'STOP_LIMIT' : 'FAIL', source_state: 'INCONCLUSIVE',
        error: { code: watchdog ? 'STABILITY_CYCLE_TIMEOUT' : 'STABILITY_CHILD_FAILED', message: '子処理が結果を返さず終了しました。', context: outcome } };
      cycles.push(result);
      if (result.status === 'FAIL') {
        const code = result.error?.code || 'STABILITY_UNEXPECTED'; failures[code] = (failures[code] || 0) + 1;
        if (failures[code] >= 3) stopped = 'REPEATED_FAILURE';
      }
      await saveJson(path.join(runDirectory, 'progress.json'), { schema: 'jsonui-stability-progress-v1', timestamp: now(), operations, cycles: cycles.length,
        elapsed_seconds: (Date.now() - started) / 1000, last_cycle: result, failures, stopped });
      process.stdout.write(JSON.stringify({ event: 'CYCLE_OBSERVED', cycle, status: result.status, source_state: result.source_state, operations, failures }) + '\n');
    }
    stopped ||= operations >= config.maxOps ? 'MAX_OPS' : 'DURATION_LIMIT';
  } finally {
    clearInterval(heartbeat); clearTimeout(userKillTimer); current?.kill('SIGTERM'); process.off('SIGINT', stop); process.off('SIGTERM', stop);
    await append({ event: 'RUN_END', stopped, operations, cycles: cycles.length, failures }); await journal.close();
  }
  const summary = { schema: 'jsonui-stability-summary-v1', timestamp: now(), started_at: new Date(started).toISOString(), elapsed_seconds: (Date.now() - started) / 1000,
    stopped, operations, cycles: cycles.length, passed_stable_cycles: cycles.filter(item => item.status === 'PASS' && item.source_state === 'STABLE').length,
    transition_cycles: cycles.filter(item => item.source_state === 'TRANSITION').length, failures,
    final_source_digest: await productDigest(), device_test: 'NOT_RUN', pixel_equivalence: 'NOT_TESTED', run_directory: runDirectory };
  await saveJson(path.join(runDirectory, 'summary.json'), summary);
  process.stdout.write(JSON.stringify(summary) + '\n'); process.exitCode = Object.keys(failures).length ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === '--child') await runChild(JSON.parse(await readFile(process.argv[3], 'utf8')));
    else await runParent(parseStabilityArguments(process.argv.slice(2)));
  } catch (error) { process.stderr.write(JSON.stringify({ schema: 'jsonui-stability-error-v1', error: errorSummary(error), timestamp: now() }) + '\n'); process.exitCode = 1; }
}
