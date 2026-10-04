#!/usr/bin/env node
/** 同一Server/Workerで有限時間だけ実HTTPを反復する。Node.js 22.14.0以上。 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

export const PREFERRED = Object.freeze(['anvil.anvil_screen', 'chest.small_chest_screen', 'chest.large_chest_screen',
  'crafting.inventory_screen', 'crafting.crafting_screen', 'enchanting.enchanting_screen', 'horse.horse_screen',
  'furnace.furnace_screen', 'beacon.beacon_screen', 'brewing_stand.brewing_stand_screen',
  'grindstone.grindstone_screen', 'cartography.cartography_screen']);
const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
const fault = (code, message, context = {}) => Object.assign(new Error(message), { code, context });
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const integer = (value, fallback, minimum, maximum) => {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw fault('RESIDENT_ARGUMENT_INVALID', '数値引数が許容範囲外です。', { minimum, maximum });
  return result;
};
export function parseArguments(argv) {
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (Object.hasOwn(values, key)) throw fault('RESIDENT_ARGUMENT_INVALID', '同じ引数を重複指定できません。');
    if (['--smoke', '--fixture'].includes(key)) values[key] = true;
    else if (['--product-root', '--reference', '--imported', '--out', '--duration-seconds', '--cadence-seconds',
      '--smoke-heartbeat-seconds', '--smoke-audit-seconds', '--smoke-stall-seconds', '--smoke-max-cycles', '--inject-stall-after'].includes(key)
      && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) values[key] = argv[++index];
    else throw fault('RESIDENT_ARGUMENT_INVALID', '不明または値が不足した引数です。', { key });
  }
  if (!values['--product-root'] || !values['--out']) throw fault('RESIDENT_ARGUMENT_REQUIRED', '--product-root と --out を指定してください。');
  const smoke = values['--smoke'] === true;
  if (!smoke && (values['--fixture'] || Object.keys(values).some(key => key.startsWith('--smoke-') || key === '--inject-stall-after'))) {
    throw fault('RESIDENT_SMOKE_REQUIRED', '短縮周期・fixture・故障注入には --smoke の明示が必要です。');
  }
  if (!values['--fixture'] && (!values['--reference'] || !values['--imported'])) throw fault('RESIDENT_ARGUMENT_REQUIRED', '--reference と --imported を指定してください。');
  const productRoot = path.resolve(values['--product-root']), output = path.resolve(values['--out']);
  if (inside(productRoot, output)) throw fault('RESIDENT_OUTPUT_IN_SOURCE', '出力先は凍結した製品ソースの外に指定してください。');
  return { productRoot, output, smoke, fixture: values['--fixture'] === true,
    reference: values['--reference'] && path.resolve(values['--reference']), imported: values['--imported'] && path.resolve(values['--imported']),
    durationSeconds: integer(values['--duration-seconds'], smoke ? 30 : 10800, smoke ? 3 : 30, 12000),
    cadenceSeconds: integer(values['--cadence-seconds'], smoke ? 0 : 15, 0, 60),
    heartbeatSeconds: smoke ? integer(values['--smoke-heartbeat-seconds'], 2, 1, 30) : 30,
    auditSeconds: smoke ? integer(values['--smoke-audit-seconds'], 10, 2, 3600) : 3600,
    stallSeconds: smoke ? integer(values['--smoke-stall-seconds'], 180, 2, 180) : 180,
    injectStallAfter: integer(values['--inject-stall-after'], 0, 0, 1000), smokeMaxCycles: integer(values['--smoke-max-cycles'], 0, 0, 12), maxOperations: 500000 };
}
async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, filename);
}
async function fileDigest(filename) {
  const before = await stat(filename), digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  const after = await stat(filename);
  assert.equal(before.size, after.size, 'ハッシュ計算中にファイル容量が変化しました。');
  assert.equal(before.mtimeMs, after.mtimeMs, 'ハッシュ計算中にファイル更新日時が変化しました。');
  return { name: path.basename(filename), bytes: before.size, sha256: digest.digest('hex') };
}
async function loadRuntime(root) {
  const load = relative => import(pathToFileURL(path.join(root, relative)).href);
  const [client, stability, representative] = await Promise.all([load('local-node/cli-client.mjs'), load('local-node/verify-stability13.mjs'),
    load('editor-core/src/engine/representative-classic-runtime.js')]);
  return { ...client, ...stability, ...representative, load };
}
async function createInputs(config, runtime) {
  const { makeZip, manifest } = await runtime.load('local-node/tests/fixtures.mjs');
  const docs = Object.create(null), files = Object.create(null);
  for (const qualifiedName of PREFERRED) {
    const [namespace, localName] = qualifiedName.split('.'), filename = `ui/${namespace}_screen.json`;
    docs[filename] ||= { namespace };
    docs[filename][localName] = { type: 'screen', size: [320, 180], controls: [
      { 'button@resident21_common.button': { offset: [10, 15] } },
      { caption: { type: 'label', text: `常駐検査 ${qualifiedName}`, size: [120, 12] } },
    ] };
  }
  docs['ui/resident21_common.json'] = { namespace: 'resident21_common', image: { type: 'image', size: [12, 12] },
    button: { type: 'button', size: [16, 16], controls: [{ 'decoration@resident21_common.image': {} }] } };
  docs['ui/pocket/resident21.json'] = { namespace: 'resident21_pocket', screen: { type: 'screen', controls: [{ text: { type: 'label', text: '読込専用' } }] } };
  for (const [filename, document] of Object.entries(docs)) files[filename] = JSON.stringify(document);
  files['ui/_ui_defs.json'] = JSON.stringify({ ui_defs: Object.keys(docs) });
  files['manifest.json'] = manifest;
  await mkdir(path.join(config.output, 'inputs'));
  const reference = path.join(config.output, 'inputs', 'fixture-reference.zip'), imported = path.join(config.output, 'inputs', 'fixture-imported.zip');
  await writeFile(reference, makeZip(files), { flag: 'wx' });
  await writeFile(imported, makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/resident21_imported.json"]}',
    'ui/resident21_imported.json': '{"namespace":"resident21_imported","screen":{"type":"screen"}}' }), { flag: 'wx' });
  return { reference, imported };
}
function errorRecord(error) {
  return { code: error?.code || (error?.name === 'AssertionError' ? 'RESIDENT_ASSERTION_FAILED' : 'RESIDENT_UNEXPECTED'),
    message: String(error?.message || '不明な失敗').slice(0, 2000), context: error?.context || {} };
}
function stateFingerprint(state) {
  return hash(JSON.stringify({ revision: state.revision, sources: state.sources, files: state.files,
    canUndo: state.canUndo, canRedo: state.canRedo, editCount: state.editCount, workspaceValid: state.workspaceValid }));
}
const valueAt = (document, pointer) => pointer.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
  .reduce((current, part) => current?.[part], document);

export async function runResident(config) {
  await mkdir(config.output, { recursive: false });
  await mkdir(path.join(config.output, 'checkpoints'));
  const eventHandle = await open(path.join(config.output, 'events.ndjson'), 'wx', 0o600);
  const started = performance.now(), elapsed = () => (performance.now() - started) / 1000;
  const cancellation = new AbortController();
  let client, workspace, catalog, runtime, serverRef, workerRef, threadId, spool, residentStarted, active = 'INITIALIZE';
  const residentElapsed = () => residentStarted === undefined ? 0 : (performance.now() - residentStarted) / 1000;
  let completedAt = performance.now(), activeStarted = completedAt, currentOperation = null, timers = [], closed = false;
  let writeQueue = Promise.resolve(), maintenance = Promise.resolve(), persistenceError, auditIndex = 0, lastAuditOperations = 0;
  const report = { schema: 'jsonui-resident21/v1', status: 'RUNNING', started_at: now(), configuration: config,
    cycles: 0, operations: 0, completed_operations: 0, definitions: {}, failures: [], audits: [], peaks: { rss: 0, worker_heap_used: 0 },
    limitations: ['同一 Node Server / Worker の実 HTTP 検査。Windows・ブラウザ操作・Minecraft 実機は未実施。',
      '投影・配置・cache・原子的編集を検査する。文字フォントやテクスチャの完全性、実機画素一致を保証しない。',
      '同じ検査の反復は新しい PHASE 完了数へ加算しない。',
      'タイムアウトは INCONCLUSIVE / outcome=timeout として保存する。自動再試行・自動再起動は行わない。',
      '進捗ファイルは外部監督が読む。ChatGPT の右上の進捗表示そのものを更新する API ではない。',
      'ソースハッシュは既存 productDigest 対象のコード群、root起動スクリプト、package設定、検査用fixturesとdigestヘルパーを対象とし、入力ZIPは別途全体をSHA-256で確認する。'],
    synthetic_fixture: config.fixture, compressed_timers: config.smoke, validation_scope: config.smokeMaxCycles ? 'limited-cycle-smoke' : 'resident-duration-and-12-screens' };
  const enqueue = fn => { const result = writeQueue.then(fn); writeQueue = result.catch(error => { persistenceError ||= error; cancellation.abort(error); }); return result; };
  const emit = row => enqueue(() => eventHandle.write(JSON.stringify({ at: now(), elapsed_seconds: Number(elapsed().toFixed(3)), ...row }) + '\n'));
  const metrics = () => {
    const snapshot = client?.app?.processor?.snapshot(), caches = snapshot?.caches, rss = process.memoryUsage().rss;
    const heap = caches?.worker_memory?.heapUsed || 0; report.peaks.rss = Math.max(report.peaks.rss, rss); report.peaks.worker_heap_used = Math.max(report.peaks.worker_heap_used, heap);
    return { rss, worker_heap_used: heap, thread_id: client?.app?.processor?.worker?.threadId,
      worker: snapshot && { dead: snapshot.dead, pending: snapshot.pending, calls: snapshot.calls, failed: snapshot.failed,
        completed: snapshot.completed, active_jobs: snapshot.active_jobs },
      projection_cache: caches?.projection_cache, frame: caches?.frame_ir, response_cache: caches?.response_cache, zip_io: caches?.zip_io };
  };
  const progress = () => ({ ...report, at: now(), elapsed_seconds: Number(elapsed().toFixed(3)), resident_elapsed_seconds: Number(residentElapsed().toFixed(3)), active,
    operation_age_seconds: currentOperation === null ? 0 : Number(((performance.now() - activeStarted) / 1000).toFixed(3)),
    no_response_seconds: Number(((performance.now() - completedAt) / 1000).toFixed(3)), metrics: metrics() });
  const checkpoint = label => { const value = structuredClone(progress()); return enqueue(async () => {
    await atomicJson(path.join(config.output, 'progress.json'), value);
    if (label) await atomicJson(path.join(config.output, 'checkpoints', label + '.json'), value);
    await eventHandle.sync();
  }); };
  const abort = reason => { if (!cancellation.signal.aborted) cancellation.abort(reason); };
  const interrupt = () => abort(fault('RESIDENT_CANCELLED', '明示停止を受けたためチェックポイントを保存して終了します。'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const assertResident = () => {
    if (!client) return;
    assert.equal(client.app.server, serverRef, '常駐検査中に Server が置換されました。');
    assert.equal(client.app.processor.worker, workerRef, '常駐検査中に Worker が置換されました。');
    assert.equal(workerRef.threadId, threadId, '常駐 Worker の thread ID が変化しました。');
    assert.equal(client.app.processor.dead, false, '常駐 Worker が停止しました。');
  };
  async function sourceDigest() {
    const product = await runtime.productDigest();
    const extras = (await readdir(config.productRoot)).filter(name => /\.(?:bat|cmd|ps1)$/iu.test(name) || /^package(?:-lock)?\.json$/u.test(name)).sort();
    const supplemental = [];
    for (const name of extras) supplemental.push(await fileDigest(path.join(config.productRoot, name)));
    supplemental.push(await fileDigest(path.join(config.productRoot, 'local-node/tests/fixtures.mjs')));
    supplemental.push(await fileDigest(path.join(config.productRoot, 'local-node/verify-stability13.mjs')));
    return { product, supplemental, runner: await fileDigest(fileURLToPath(import.meta.url)), sha256: hash(JSON.stringify({ product, supplemental })) };
  }
  async function verifySource(label, inputs = false) {
    const source = await sourceDigest();
    assert.equal(source.sha256, report.source_start.sha256, '凍結した製品ソースが実行中に変化しました。');
    assert.equal(source.runner.sha256, report.source_start.runner.sha256, '検査プログラムが実行中に変化しました。');
    if (inputs) for (const [index, filename] of [config.reference, config.imported].entries()) {
      assert.deepEqual(await fileDigest(filename), report.inputs[index], '入力 ZIP が実行中に変化しました。');
    }
    await emit({ event: 'SOURCE_AUDIT', label, sha256: source.sha256, inputs_checked: inputs });
    return source;
  }
  async function audit() {
    const index = ++auditIndex, previous = lastAuditOperations, completed = report.completed_operations;
    const value = { index, at: now(), elapsed_seconds: elapsed(), completed_since_previous: completed - previous,
      active, metrics: metrics(), status: completed > previous ? 'PASS' : 'FAIL', source_hash_checked: false };
    lastAuditOperations = completed;
    report.audits.push(value);
    await emit({ event: 'HOURLY_AUDIT_BEGIN', ...value });
    await checkpoint(`audit-${String(index).padStart(3, '0')}-begin`);
    try {
      if (completed <= previous) throw fault('RESIDENT_AUDIT_NO_PROGRESS', '定期監査間隔に実操作の完了がありません。実行中のタスクを停止します。');
      assertResident(); await verifySource(`audit-${index}`, true); value.source_hash_checked = true;
    } catch (error) { value.status = 'FAIL'; value.error = errorRecord(error); throw error; }
    finally { await emit({ event: 'HOURLY_AUDIT_END', ...value }); await checkpoint(`audit-${String(index).padStart(3, '0')}-end`); }
  }
  async function step(name, fn, summarize = value => ({ ok: value?.ok !== false })) {
    cancellation.signal.throwIfAborted(); assertResident();
    if (report.operations >= config.maxOperations) throw fault('RESIDENT_OPERATION_LIMIT', '最大操作回数へ到達しました。');
    const index = ++report.operations; active = name; currentOperation = index; activeStarted = performance.now();
    await emit({ event: 'OP_BEGIN', index, operation: name });
    let onAbort;
    const stopped = new Promise((_, reject) => { onAbort = () => reject(cancellation.signal.reason); cancellation.signal.addEventListener('abort', onAbort, { once: true }); });
    try {
      const value = await Promise.race([Promise.resolve().then(fn), stopped]);
      assertResident(); completedAt = performance.now(); report.completed_operations++;
      await emit({ event: 'OP_END', index, operation: name, outcome: 'success', duration_ms: Math.round(performance.now() - activeStarted), ...summarize(value) });
      return value;
    } catch (error) { await emit({ event: 'OP_END', index, operation: name, outcome: cancellation.signal.reason?.code === 'RESIDENT_NO_RESPONSE' || /TIMEOUT/u.test(error.code || '') ? 'timeout' : 'failure', error: errorRecord(error) }); throw error; }
    finally { cancellation.signal.removeEventListener('abort', onAbort); currentOperation = null; }
  }
  const request = (route, payload) => client.request('/api/node/' + route, { payload, timeout: Math.min(175000, config.stallSeconds * 1000) });
  const getCatalog = () => step('CATALOG', () => request('workspace-catalog', { workspaceId: workspace.workspaceId }), value => ({ records: value.records?.length }));
  const winner = name => catalog.records.filter(record => record.qualifiedName === name && record.profile === 'classic').sort((a, b) => b.precedence - a.precedence)[0];
  const preview = record => ({ variables: runtime.buildRepresentativeClassicResolverVariables({ qualifiedName: record.qualifiedName }),
    representativeCollections: runtime.buildRepresentativeClassicCollections({ qualifiedName: record.qualifiedName }) });
  const project = (record, label) => step(label, () => request('project', { catalogId: catalog.nodeCatalogId, recordId: record.id, ...preview(record) }),
    value => ({ ok: value.ok, definition: record.qualifiedName, node_count: Object.keys(value.nodeSources || {}).length, code: value.code }));
  const status = label => step(label, () => request('workspace-status', { workspaceId: workspace.workspaceId }));
  const identity = () => ({ workspaceId: workspace.workspaceId, expectedRevision: workspace.revision });
  async function batchProbe() {
    const record = winner('anvil.anvil_screen'), before = await project(record, 'BATCH_BASE_PROJECT'); assert(before.ok);
    const candidates = Object.entries(before.nodeSources || {}).filter(([, source]) => source.pointer?.includes('/controls/'));
    candidates.sort((a, b) => Number(!a[1].pointer.includes('/close_button_panel/controls/0/close_button_image@')) - Number(!b[1].pointer.includes('/close_button_panel/controls/0/close_button_image@')));
    let operation, plan;
    for (const [effectivePointer, source] of candidates.slice(0, 32)) {
      const proposed = { type: 'planEdit', intendedType: 'move', scope: 'screen', targetMode: 'visual', delta: [1, 1],
        path: source.path, sourceId: source.sourceId, pointer: source.pointer, effectivePointer,
        screen: { path: record.filePath, sourceId: record.sourceId, pointer: '/' + record.rawKey.replaceAll('~', '~0').replaceAll('/', '~1') }, preview: preview(record) };
      const result = await step('BATCH_TARGET_PLAN', () => request('workspace-edit', { ...identity(), operation: proposed }), value => ({ ok: value.ok, code: value.code }));
      if (result.ok) { plan = result.editPlan; operation = { ...proposed, type: 'move', ...(plan.requiresTemplateConsent ? { generatedScope: 'template' } : {}) }; break; }
    }
    assert(operation, '原子的な移動を検査できる原文要素が見つかりません。');
    report.batch_target_observation ||= { selected: { path: operation.path, sourceId: operation.sourceId, pointer: operation.pointer, effectivePointer: operation.effectivePointer }, target: plan.target, requiresTemplateConsent: plan.requiresTemplateConsent };
    const initial = await status('BATCH_BEFORE_STATUS'), originalSources = hash(JSON.stringify(initial.sources)), initialRevision = initial.revision;
    workspace = await step('BATCH_TWO_MOVES', () => request('workspace-edit', { ...identity(), operation: { type: 'batch', operations: [operation, { ...operation, delta: [2, -1] }] } }),
      value => ({ ok: value.ok, code: value.code, batch: value.batch, edit_count: value.editCount }));
    assert.equal(workspace.ok, true, workspace.code); assert.equal(workspace.batch?.appliedCount, 2); assert.equal(workspace.editCount, initial.editCount + 1);
    assert.notEqual(workspace.revision, initialRevision); assert.equal(workspace.canUndo, true);
    catalog = await getCatalog(); const after = await project(winner('anvil.anvil_screen'), 'BATCH_AFTER_PROJECT'); assert(after.ok);
    const beforeValue = valueAt(before.document, plan.target.effectivePointer), afterValue = valueAt(after.document, plan.target.effectivePointer);
    assert(afterValue && beforeValue, '移動前後の対象要素がありません。');
    const initialOffset = beforeValue.offset || [0, 0];
    if (initialOffset.every(value => typeof value === 'number')) assert.deepEqual(afterValue.offset, [initialOffset[0] + 3, initialOffset[1]]);
    else assert.notDeepEqual(afterValue.offset, beforeValue.offset, '移動差分が投影へ反映されていません。');
    workspace = await step('BATCH_SINGLE_UNDO', () => request('workspace-undo', identity()));
    assert.equal(workspace.revision, initialRevision); assert.equal(hash(JSON.stringify(workspace.sources)), originalSources);
    assert.equal(workspace.editCount, initial.editCount + 2); assert.equal(workspace.canUndo, initial.canUndo);
    catalog = await getCatalog();
    const restored = await status('ROLLBACK_BEFORE_STATUS'), fingerprint = stateFingerprint(restored);
    const failed = await step('EXPECTED_BATCH_ROLLBACK', () => request('workspace-edit', { ...identity(), operation: { type: 'batch',
      operations: [operation, { ...operation, delta: [1000001, 0] }] } }), value => ({ ok: value.ok, expected_rejection: true, code: value.code, batch: value.batch }));
    assert.equal(failed.ok, false); assert.equal(failed.code, 'EDIT_DELTA_INVALID'); assert.equal(failed.batch?.appliedCount, 0); assert.equal(failed.revision, workspace.revision);
    assert.equal(failed.documents, undefined); assert.equal(failed.batch?.failedOperationIndex, 1);
    const stable = await status('ROLLBACK_AFTER_STATUS'); assert.equal(stateFingerprint(stable), fingerprint);
    workspace = stable;
  }
  try {
    runtime = await loadRuntime(config.productRoot);
    if (config.fixture) Object.assign(config, await createInputs(config, runtime));
    report.inputs = await Promise.all([config.reference, config.imported].map(fileDigest));
    report.source_start = await sourceDigest();
    await emit({ event: 'RUN_BEGIN', configuration: config, source: report.source_start, inputs: report.inputs });
    await checkpoint('initial');
    timers.push(setInterval(() => {
      if (closed) return;
      const age = (performance.now() - completedAt) / 1000;
      if (currentOperation !== null && age >= config.stallSeconds) abort(fault('RESIDENT_NO_RESPONSE', '実操作の応答が制限時間内に返りません。', { operation: active, seconds: age }));
    }, Math.min(1000, config.stallSeconds * 100)));
    timers.push(setInterval(() => { if (closed) return;
      emit({ event: 'HEARTBEAT', operation: active, completed_operations: report.completed_operations, metrics: metrics() })
        .then(() => checkpoint()).catch(abort);
    }, config.heartbeatSeconds * 1000));
    timers.push(setInterval(() => { if (closed || cancellation.signal.aborted) return;
      maintenance = maintenance.then(audit).catch(error => { report.maintenance_failure = errorRecord(error); abort(error); });
    }, config.auditSeconds * 1000));
    await step('SERVER_START', async () => {
      client = await runtime.CliClient.start({ signal: cancellation.signal });
      serverRef = client.app.server; workerRef = client.app.processor.worker; threadId = workerRef.threadId; spool = client.app.root; residentStarted = performance.now();
      report.resident_identity = { server_port: client.app.port, worker_thread_id: threadId, process_pid: process.pid };
      return { ok: true };
    });
    const sources = [];
    for (const [kind, filename] of [['vanilla', config.reference], ['imported', config.imported]]) {
      const imported = await step('IMPORT_' + kind.toUpperCase(), () => client.importPack(filename), value => ({ bytes: value.source.size_bytes, sha256: value.source.checksum_sha256 }));
      sources.push({ kind, id: imported.id, rootPrefix: imported.rootPrefix });
    }
    workspace = await step('WORKSPACE_OPEN', () => request('workspace-open', { sources })); assert.equal(workspace.ok, true);
    catalog = await getCatalog();
    assert(PREFERRED.every(name => winner(name)), '指定した Classic 12 画面の一部が入力にありません。');
    const pocketDefinitions = catalog.records.filter(record => record.profile === 'pocket');
    assert(pocketDefinitions.length > 0, 'Pocket 読込・拒否を検査する定義がありません。');
    report.pocket_definition_count = pocketDefinitions.length; report.pocket_rejections = [];
    for (const record of pocketDefinitions) {
      await step('INITIAL_POCKET_REJECTION', async () => {
        try { await request('project', { catalogId: catalog.nodeCatalogId, recordId: record.id }); }
        catch (error) {
          if (error.code === 'POCKET_PREVIEW_BLOCKED' && error.context?.http_status === 422) {
            report.pocket_rejections.push({ qualifiedName: record.qualifiedName, sourceId: record.sourceId, filePath: record.filePath, rawKey: record.rawKey });
            return { ok: true, code: error.code, definition: record.qualifiedName };
          }
          throw error;
        }
        throw fault('RESIDENT_POCKET_ACCEPTED', 'Pocket プレビューが禁止されませんでした。');
      });
    }
    report.selected_definitions = [...PREFERRED];
    await checkpoint('initialized');
    while ((config.smokeMaxCycles ? report.cycles < config.smokeMaxCycles : residentElapsed() < config.durationSeconds)) {
      cancellation.signal.throwIfAborted();
      const cycleStart = performance.now();
      await verifySource(`cycle-${report.cycles + 1}`);
      if (config.injectStallAfter && report.cycles + 1 === config.injectStallAfter) {
        report.fault_injection = { kind: 'nonresponsive_operation', cycle: report.cycles + 1, synthetic: true };
        await step('INJECTED_NO_RESPONSE', () => new Promise(() => {}));
      }
      const name = PREFERRED[report.cycles % PREFERRED.length], record = winner(name);
      const cacheBefore = metrics().projection_cache;
      const cold = await project(record, 'PROJECT_COLD'); assert.equal(cold.ok, true, '代表画面の投影を完了できません。');
      const cacheCold = metrics().projection_cache;
      assert.equal(cacheCold.misses, cacheBefore.misses + 1, 'cold 投影が cache miss になっていません。');
      const warm = await project(record, 'PROJECT_WARM'); assert.deepEqual(warm.document, cold.document, '同条件の投影内容が一致しません。');
      assert.equal(metrics().projection_cache.hits, cacheCold.hits + 1, 'warm 投影が cache hit になっていません。');
      const frameInput = { projectionId: cold.nodeProjectionId, filePath: record.filePath, preset: { width: 480, height: 270 },
        animationTime: 1, generation: report.cycles + 1, visibilityMode: 'safe' };
      const first = await step('FRAME_COLD', () => request('frame', frameInput), value => ({ boxes: value.layout?.boxes?.length, cache_hit: value.metrics?.cacheHit }));
      assert(first.layout?.boxes?.length > 0); assert.notEqual(first.layout.stats?.truncated, true); assert.equal(first.metrics.cacheHit, false);
      const second = await step('FRAME_WARM', () => request('frame', frameInput), value => ({ boxes: value.layout?.boxes?.length, cache_hit: value.metrics?.cacheHit }));
      assert.deepEqual(second.layout, first.layout); assert.equal(second.metrics.cacheHit, true);
      await batchProbe();
      const currentPocket = catalog.records.filter(item => item.profile === 'pocket');
      const pocket = currentPocket[report.cycles % currentPocket.length];
      const forbidden = await step('EXPECTED_POCKET_REJECTION', async () => {
        try { await request('project', { catalogId: catalog.nodeCatalogId, recordId: pocket.id }); }
        catch (error) { if (error.code === 'POCKET_PREVIEW_BLOCKED' && error.context?.http_status === 422) return { ok: true, expected_rejection: true, code: error.code }; throw error; }
        throw fault('RESIDENT_POCKET_ACCEPTED', 'Pocket プレビューが禁止されませんでした。');
      });
      assert.equal(forbidden.expected_rejection, true);
      report.cycles++; report.definitions[name] = (report.definitions[name] || 0) + 1;
      const current = metrics(); assertResident(); assert.equal(current.worker.pending, 0);
      for (const cache of [current.projection_cache, current.response_cache, current.frame?.frame_cache]) {
        if (cache) assert(cache.bytes <= cache.max_bytes, 'cache の容量上限を超えています。');
      }
      await emit({ event: 'CYCLE_END', cycle: report.cycles, definition: name, outcome: 'success', metrics: current });
      await checkpoint();
      if (PREFERRED.every(item => report.definitions[item] > 0) && !report.coverage_completed_at) {
        report.coverage_completed_at = now(); await checkpoint('coverage-12-screens');
      }
      active = 'CADENCE';
      const remaining = Math.min(Math.max(0, config.cadenceSeconds * 1000 - (performance.now() - cycleStart)), Math.max(0, (config.durationSeconds - residentElapsed()) * 1000));
      if (remaining) await pause(remaining, undefined, { signal: cancellation.signal });
    }
    await maintenance; cancellation.signal.throwIfAborted();
    report.source_end = await verifySource('final', true);
    if (config.smokeMaxCycles) {
      assert.equal(config.smoke, true); assert.equal(report.cycles, config.smokeMaxCycles);
      report.limitations.push('明示した短縮cycle数だけのsmokeであり、12画面の投影完走や設定常駐時間の検査ではない。');
    } else {
      assert(PREFERRED.every(name => report.definitions[name] > 0), '設定時間内に Classic 12 画面の一巡を完了できませんでした。');
      assert(residentElapsed() >= config.durationSeconds, '同一 Server / Worker の設定常駐時間より前に終了しました。');
    }
    assert.equal(report.pocket_rejections.length, report.pocket_definition_count);
    report.status = 'PASS'; report.outcome = 'success';
  } catch (caught) {
    const error = cancellation.signal.aborted ? cancellation.signal.reason : caught;
    const timeout = error?.code === 'RESIDENT_NO_RESPONSE' || /TIMEOUT/u.test(error?.code || '') || error?.name === 'TimeoutError';
    const cancelled = error?.code === 'RESIDENT_CANCELLED';
    report.status = timeout || cancelled ? 'INCONCLUSIVE' : 'FAIL'; report.outcome = timeout ? 'timeout' : cancelled ? 'cancelled' : 'failure';
    if (timeout) report.reason_code = 'failed_timeout';
    report.next_action = timeout ? '停止した操作・入力サイズ・ループ境界・Worker状態・保存済みcheckpointを調べ、原因を確認してから新しい出力先で再実行する。'
      : '失敗した検査と保存済み証跡を確認し、修正後に新しい出力先で再実行する。';
    report.failures.push({ at: now(), operation: active, ...errorRecord(error) });
    await emit({ event: 'RUN_FAILED', status: report.status, outcome: report.outcome, error: report.failures.at(-1) }).catch(() => {});
  } finally {
    closed = true; timers.forEach(clearInterval); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    await maintenance.catch(() => {}); active = 'CLOSE';
    if (report.maintenance_failure && report.status === 'PASS') { report.status = 'FAIL'; report.outcome = 'failure'; }
    const cleanup = { spool_removed: false, server_closed: false, worker_terminated: false };
    if (client) {
      try { await client.close(); cleanup.worker_terminated = workerRef.threadId === -1; }
      catch (error) { report.failures.push({ at: now(), operation: 'CLOSE', ...errorRecord(error) }); }
      try { cleanup.spool_removed = !(await stat(spool).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))); }
      catch (error) { report.failures.push({ at: now(), operation: 'CLEANUP_STAT', ...errorRecord(error) }); }
      try { await fetch(new URL('/api/node/capabilities', client.base), { signal: AbortSignal.timeout(1000) }); }
      catch { cleanup.server_closed = true; }
      if (!cleanup.spool_removed || !cleanup.server_closed || !cleanup.worker_terminated) { report.status = 'FAIL'; report.outcome = 'failure'; }
    } else Object.assign(cleanup, { spool_removed: true, server_closed: true, worker_terminated: true, not_started: true });
    report.cleanup = cleanup; report.finished_at = now(); report.elapsed_seconds = Number(elapsed().toFixed(3)); report.resident_elapsed_seconds = Number(residentElapsed().toFixed(3));
    if (persistenceError) { report.status = 'FAIL'; report.persistence_error = errorRecord(persistenceError); }
    await checkpoint('final').catch(error => { report.status = 'FAIL'; report.persistence_error = errorRecord(error); });
    await enqueue(() => atomicJson(path.join(config.output, 'report.json'), report));
    await writeQueue; await eventHandle.sync(); await eventHandle.close();
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const report = await runResident(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify({ status: report.status, outcome: report.outcome, cycles: report.cycles,
      completed_operations: report.completed_operations, elapsed_seconds: report.elapsed_seconds, cleanup: report.cleanup }));
    process.exitCode = report.status === 'PASS' ? 0 : report.status === 'INCONCLUSIVE' ? 2 : 1;
  } catch (error) { console.error(JSON.stringify(errorRecord(error))); process.exitCode = 1; }
}
