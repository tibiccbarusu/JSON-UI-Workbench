#!/usr/bin/env node
/** 固定Classic画面の実素材PNG監査。原本不変、画面単位checkpoint、有限child。 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { Processor } from './worker-client.mjs';
import { LIMITS } from './limits.mjs';
import { renderFramePng, loadRasterBackend } from './frame-raster13.mjs';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';

const ENTRY = fileURLToPath(import.meta.url), ROOT = path.resolve(path.dirname(ENTRY), '..');
const FIXED_SHA256 = 'ba8952f52da7bae073704855af37bb2c20b0b0593b1a9c275e988b5788829f2b';
const SETTINGS = Object.freeze({ width: 480, height: 270, uiScale: 1, locale: 'ja_JP',
  animationTime: 1, animationEvent: 'screen.entrance_push', visibilityMode: 'safe',
  targetEngineVersion: [1, 26, 45], allowPartial: true });
const CODE_PATHS = ['local-node/corpus-raster-audit23.mjs', 'local-node/processor.mjs',
  'local-node/frame-raster13.mjs', 'local-node/frame-raster-assets13.mjs', 'local-node/frame-ir.mjs',
  'editor-core/src/engine/effective-ui-resolver.js', 'editor-core/src/engine/ui-catalog.js',
  'editor-core/src/engine/representative-classic-runtime.js', 'editor-core/src/preview/canvas-preview.js'];
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const errorInfo = error => ({ code: String(error?.code || error?.message || 'AUDIT_FAILED').slice(0, 150),
  message: String(error?.message || error).slice(0, 1000), ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}) });
async function atomic(file, bytes) { const temp = `${file}.tmp`; await writeFile(temp, bytes); await rename(temp, file); }
const json = (file, value) => atomic(file, JSON.stringify(value, null, 2) + '\n');
async function sourceIdentity(file) {
  const checksum = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { checksum.update(chunk); bytes += chunk.length; }
  return { name: path.basename(file), bytes, sha256: checksum.digest('hex') };
}
async function codeIdentity() { return Object.fromEntries(await Promise.all(CODE_PATHS.map(async file => [file, digest(await readFile(path.join(ROOT, file)))]))); }
function codeOf(row) { return typeof row === 'string' ? row.split(':')[0] : String(row?.code || 'UNKNOWN'); }
function counts(rows) { const result = {}; for (const row of rows || []) { const key = codeOf(row); result[key] = (result[key] || 0) + 1; } return result; }
function category(code) {
  if (/UNSUPPORTED|UNAVAILABLE|NOT_IMPLEMENTED/u.test(code)) return 'unsupported';
  if (/UNRESOLVED|MISSING|NOT_FOUND|AMBIGUOUS|STALE/u.test(code)) return 'unresolved';
  if (/LIMIT|TIMEOUT|TRUNCAT|BUDGET/u.test(code)) return 'limits';
  if (/INVALID|FAILED|ERROR|CYCLE/u.test(code)) return 'errors';
  return 'other';
}
function grouped(rows) {
  const result = { unsupported: {}, unresolved: {}, limits: {}, errors: {}, other: {} };
  for (const [code, count] of Object.entries(counts(rows))) result[category(code)][code] = count;
  return result;
}
const recordKey = record => `${record.qualifiedName}\u0000${record.filePath}\u0000${record.rawKey}`;
function caseFilename(record) { return `${record.qualifiedName.replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, 110)}-${digest(recordKey(record)).slice(0, 10)}`; }
const checked = result => { if (!result || result.ok === false) throw Object.assign(new Error(result?.error?.code || result?.error || 'AUDIT_API_FAILED'), { diagnostic: result }); return result; };

/** HTTPの送受信だけを置き換える。公開action本体・projection token・source境界を維持する。 */
class AuditClient {
  constructor() { this.processor = new Processor(); }
  async request(route, { method = 'POST', payload = {}, binary = false, maximum = LIMITS.replyBytes, timeout = LIMITS.jobMs } = {}) {
    const url = new URL(route, 'http://audit.invalid');
    if (url.pathname === '/editor-core/assets/native-default-player/textures/entity/steve.png') {
      const bytes = await readFile(path.join(ROOT, 'editor-core/assets/native-default-player/textures/entity/steve.png'));
      if (bytes.length > maximum) throw new Error('AUDIT_RESPONSE_LIMIT');
      return bytes;
    }
    let action, request;
    const pack = /^\/api\/node\/packs\/([A-Za-z0-9-]+)\/(assets|read|preview-image)$/u.exec(url.pathname);
    if (method === 'GET' && pack) {
      action = pack[2]; request = { id: pack[1], ...(action === 'assets' ? {} : {
        path: url.searchParams.get('path'), maxBytes: Number(url.searchParams.get('maxBytes')) }) };
    } else if (method === 'POST' && /^\/api\/node\/(?:workspace-open|workspace-status|workspace-catalog|project|frame|lang|font|item-icons|horse|player)$/u.test(url.pathname)) {
      action = url.pathname.split('/').at(-1); request = payload;
    } else throw new Error('AUDIT_ADAPTER_ROUTE_UNSUPPORTED');
    const jobLimit = ['project', 'frame'].includes(action) ? LIMITS.projectionMs : LIMITS.jobMs;
    const result = await this.processor.call(action, request, Math.min(timeout, jobLimit));
    const bytes = typeof result.body === 'string' ? Buffer.from(result.body) : Buffer.from(result.body);
    if (bytes.length > maximum) throw new Error('AUDIT_RESPONSE_LIMIT');
    return binary ? bytes : JSON.parse(bytes.toString('utf8'));
  }
  async open(reference, expected) {
    const identity = await sourceIdentity(reference);
    if (identity.sha256 !== expected.sha256 || identity.bytes !== expected.bytes) throw new Error('AUDIT_SOURCE_CHANGED');
    const id = randomUUID();
    await this.processor.call('import', { id, path: reference, name: identity.name, size: identity.bytes });
    this.workspace = checked(await this.request('/api/node/workspace-open', { payload: { sources: [{ id, kind: 'vanilla' }] } }));
    this.catalog = checked(await this.request('/api/node/workspace-catalog', { payload: { workspaceId: this.workspace.workspaceId } }));
    return this.catalog;
  }
  async close() { await this.processor.close(); }
}
function selectedRecords(catalog) {
  const winners = new Set(Object.values(catalog.symbols).map(symbol => symbol.winnerId));
  return catalog.records.filter(record => winners.has(record.id) && record.profile !== 'pocket' && record.classification === 'SCREEN')
    .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName) || a.id.localeCompare(b.id));
}
function notify(message) { process.send?.(message); }
async function childTask(reference, output, mode, names = []) {
  const manifest = JSON.parse(await readFile(path.join(output, 'run.json'), 'utf8'));
  if (digest(await codeIdentity()) !== digest(manifest.codeHashes)) throw new Error('AUDIT_CODE_CHANGED');
  const client = new AuditClient(), setup = performance.now();
  try {
    const catalog = await client.open(reference, manifest.source), records = selectedRecords(catalog);
    if (mode === 'discover') {
      const found = { catalog: catalog.summary, classicCount: records.length,
        pocketExcluded: catalog.records.filter(record => record.profile === 'pocket').length,
        sourceRootPrefix: client.workspace.sources[0].rootPrefix || '',
        definitions: records.map(({ id, qualifiedName, filePath, rawKey, profile, referenceScanComplete }) =>
          ({ id, qualifiedName, filePath, rawKey, profile, referenceScanComplete })), setupMs: performance.now() - setup };
      await json(path.join(output, 'discovery.json'), found); notify({ event: 'discovery-finished', count: records.length }); return;
    }
    const backend = loadRasterBackend();
    if (!backend) throw new Error('RASTER_BACKEND_UNAVAILABLE');
    notify({ event: 'batch-ready', setupMs: performance.now() - setup });
    for (const key of names) {
      const record = records.find(item => recordKey(item) === key);
      if (!record || record.profile === 'pocket') throw new Error('AUDIT_DEFINITION_CHANGED');
      const filename = caseFilename(record), casePath = path.join(output, 'cases', `${filename}.json`);
      const row = { schema: 'jsonui-corpus-raster-case-v23', key, recordId: record.id, definition: record.qualifiedName,
        path: record.filePath, rawKey: record.rawKey, profile: record.profile, source: manifest.source,
        settings: SETTINGS, referenceScanComplete: record.referenceScanComplete, startedAt: new Date().toISOString(),
        workspaceRevision: client.workspace.revision, validation_status: 'IN_PROGRESS', stage: 'project', pixelParityVerified: false };
      await json(casePath, row); notify({ event: 'case-start', key, definition: record.qualifiedName });
      const start = performance.now(); let stageStart = start;
      try {
        const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id,
          variables: buildRepresentativeClassicResolverVariables({ qualifiedName: record.qualifiedName }),
          representativeCollections: buildRepresentativeClassicCollections({ qualifiedName: record.qualifiedName }) } });
        row.projection = { ok: projection.ok, error: projection.error, stats: projection.stats,
          diagnosticCounts: counts(projection.diagnostics), diagnostics: (projection.diagnostics || []).slice(0, 1000),
          omittedDiagnostics: Math.max(0, (projection.diagnostics?.length || 0) - 1000), durationMs: performance.now() - stageStart };
        if (!projection.ok) throw Object.assign(new Error(projection.error?.code || 'AUDIT_PROJECTION_FAILED'), { diagnostic: projection.error });
        row.projectedDocumentSha256 = digest(projection.document); row.stage = 'frame'; await json(casePath, row);
        stageStart = performance.now();
        const frameRequest = { projectionId: projection.nodeProjectionId, recordId: record.id, filePath: record.filePath,
          preset: { width: SETTINGS.width, height: SETTINGS.height }, generation: 0,
          animationTime: SETTINGS.animationTime, animationEvent: SETTINGS.animationEvent,
          qualifiedName: record.qualifiedName, mockData: {}, collectionData: {}, scrollById: {}, visibilityMode: SETTINGS.visibilityMode };
        const frame = await client.request('/api/node/frame', { payload: frameRequest });
        row.frame = { schema: frame.schema, boxes: frame.layout?.boxes?.length, layoutSha256: digest(frame.layout),
          warnings: frame.layout?.warnings || [], bindingWarnings: frame.bindingWarnings || frame.bindingsWarnings || [],
          durationMs: performance.now() - stageStart };
        row.stage = 'raster'; await json(casePath, row);
        const raster = await renderFramePng({ client, sources: client.workspace.sources, projection, frame, frameRequest,
          ...SETTINGS, timeSeconds: SETTINGS.animationTime, backend });
        const { png, ...metadata } = raster; row.raster = metadata;
        row.diagnostics = grouped([...(projection.diagnostics || []), ...(raster.diagnostics || []),
          ...(!record.referenceScanComplete ? [{ code: 'CATALOG_REFERENCE_SCAN_INCOMPLETE' }] : [])]);
        if (raster.ok) {
          if (!Buffer.isBuffer(png) || png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
            || png.readUInt32BE(16) !== SETTINGS.width || png.readUInt32BE(20) !== SETTINGS.height) throw new Error('AUDIT_PNG_INVALID');
          await atomic(path.join(output, 'cases', `${filename}.png`), png);
          row.png = { filename: `${filename}.png`, bytes: png.length, sha256: digest(png), width: SETTINGS.width, height: SETTINGS.height };
          row.validation_status = raster.complete ? 'SUCCESS' : 'PARTIAL';
        } else {
          const type = category(raster.code || 'RASTER_FAILED');
          row.validation_status = type === 'unsupported' ? 'UNSUPPORTED' : type === 'unresolved' ? 'UNRESOLVED' : 'INCONCLUSIVE';
          if (/TIMEOUT|TIME_LIMIT/u.test(raster.code || '')) { row.outcome = 'timeout'; row.reason_code = 'failed_timeout'; }
        }
      } catch (error) {
        row.error = errorInfo(error); row.failedStage = row.stage;
        const kind = category(row.error.code);
        row.validation_status = kind === 'unsupported' ? 'UNSUPPORTED' : kind === 'unresolved' ? 'UNRESOLVED' : 'INCONCLUSIVE';
        if (/TIMEOUT|TIME_LIMIT/u.test(row.error.code)) { row.outcome = 'timeout'; row.reason_code = 'failed_timeout'; }
        row.diagnostics = grouped([...(row.projection?.diagnostics || []), row.error]);
      }
      if (!client.processor.dead) {
        const status = await client.request('/api/node/workspace-status', { payload: { workspaceId: client.workspace.workspaceId } });
        row.workspaceUnchanged = status.revision === row.workspaceRevision;
        if (!row.workspaceUnchanged) row.validation_status = 'FAIL_WORKSPACE_CHANGED';
      }
      row.outcome ||= row.validation_status.toLowerCase();
      row.stage = 'finished'; row.finishedAt = new Date().toISOString(); row.durationMs = performance.now() - start;
      row.workerSnapshot = client.processor.snapshot().caches;
      await json(casePath, row); notify({ event: 'case-finished', key, definition: record.qualifiedName,
        validation_status: row.validation_status, durationMs: row.durationMs });
      if (client.processor.dead) break;
    }
  } finally { await client.close(); }
}

async function subprocess(reference, output, mode, keys, timeoutMs) {
  return new Promise(resolve => {
    const child = fork(ENTRY, ['--child', reference, output, mode, JSON.stringify(keys)], {
      execArgv: ['--max-old-space-size=512', '--stack-size=8192'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let timer, timedOut = false, activeKey = null, stderr = '', childError;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs); };
    arm();
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-65536); });
    child.on('message', message => {
      if (message.event === 'case-start') { activeKey = message.key; arm(); }
      if (message.event === 'case-finished') { activeKey = null; arm(); }
      process.stdout.write(JSON.stringify(message) + '\n');
    });
    child.on('error', error => { childError = errorInfo(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut, activeKey, stderr, error: childError }); });
  });
}
async function refresh(output, manifest) {
  const rows = [];
  for (const definition of manifest.definitions || []) {
    const name = caseFilename(definition);
    const row = await readFile(path.join(output, 'cases', `${name}.json`), 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return { key: recordKey(definition), definition: definition.qualifiedName, validation_status: 'NOT_RUN' };
      throw error;
    });
    if (row.png && row.validation_status !== 'IN_PROGRESS') {
      const bytes = await readFile(path.join(output, 'cases', row.png.filename)).catch(() => null);
      if (!bytes || digest(bytes) !== row.png.sha256) throw new Error('AUDIT_CHECKPOINT_PNG_MISMATCH');
    }
    rows.push(row);
  }
  manifest.completedCases = rows.filter(row => !['NOT_RUN', 'IN_PROGRESS'].includes(row.validation_status)).length;
  manifest.outcomes = counts(rows.map(row => ({ code: row.validation_status })));
  manifest.pngCount = rows.filter(row => row.png).length;
  manifest.diagnosticCounts = {};
  for (const row of rows) for (const bucket of Object.values(row.diagnostics || {})) for (const [code, amount] of Object.entries(bucket)) {
    manifest.diagnosticCounts[code] = (manifest.diagnosticCounts[code] || 0) + amount;
  }
  manifest.updatedAt = new Date().toISOString(); await json(path.join(output, 'run.json'), manifest); return rows;
}

export async function auditClassicRaster23(referencePath, outputDirectory, options = {}) {
  const reference = path.resolve(referencePath), output = path.resolve(outputDirectory);
  const { batchSize = 10, timeoutMs = 180000, limit = null, definition = null, expectedSha256 = FIXED_SHA256 } = options;
  const requestedDefinitions = definition === null ? null : Array.isArray(definition) ? definition : [definition];
  if (requestedDefinitions && (!requestedDefinitions.length || requestedDefinitions.some(value => typeof value !== 'string' || !value))) {
    throw new Error('AUDIT_DEFINITIONS_INVALID');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000
    || limit !== null && (!Number.isInteger(limit) || limit < 1) || !/^[a-f0-9]{64}$/u.test(expectedSha256)) throw new Error('AUDIT_OPTIONS_INVALID');
  const info = await stat(reference); if (!info.isFile()) throw new Error('AUDIT_SOURCE_INVALID');
  const source = await sourceIdentity(reference); if (source.sha256 !== expectedSha256) throw new Error('AUDIT_SOURCE_SHA256_MISMATCH');
  await mkdir(path.join(output, 'cases'), { recursive: true });
  const codeHashes = await codeIdentity(), signature = digest({ source, settings: SETTINGS, codeHashes, limit, definition });
  let manifest = await readFile(path.join(output, 'run.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error; return null;
  });
  if (manifest && manifest.signature !== signature) throw new Error('AUDIT_CHECKPOINT_IDENTITY_MISMATCH');
  if (!manifest) {
    manifest = { schema: 'jsonui-corpus-raster-audit-v23', source, codeHashes, signature, settings: SETTINGS,
      startedAt: new Date().toISOString(), batchSize, timeoutMs, batches: [], definitions: [],
      transport: 'public-worker-actions-adapter', language: 'ja', limitation_ja:
        '実素材・日本語字形を利用したPNG生成監査。HTTP・ブラウザー操作・Minecraftの画素一致は検査しない。SUCCESSは対応範囲の素材解決だけを示す。' };
    await json(path.join(output, 'run.json'), manifest);
  }
  if (!manifest.definitions.length) {
    const child = await subprocess(reference, output, 'discover', [], timeoutMs);
    if (child.code !== 0) { await json(path.join(output, 'discovery-failure.json'), child); throw new Error('AUDIT_DISCOVERY_FAILED'); }
    const found = JSON.parse(await readFile(path.join(output, 'discovery.json'), 'utf8'));
    manifest.catalog = found.catalog; manifest.classicCorpusCount = found.classicCount;
    manifest.pocketDefinitionsExcluded = found.pocketExcluded; manifest.sourceRootPrefix = found.sourceRootPrefix;
    let selected = found.definitions;
    if (requestedDefinitions) {
      const requested = new Set(requestedDefinitions);
      selected = selected.filter(row => requested.has(row.qualifiedName));
      const foundNames = new Set(selected.map(row => row.qualifiedName));
      if ([...requested].some(name => !foundNames.has(name))) throw new Error('AUDIT_DEFINITION_NOT_FOUND');
    }
    if (limit) selected = selected.slice(0, limit);
    if (!selected.length) throw new Error('AUDIT_SCREEN_CORPUS_EMPTY');
    manifest.definitions = selected; manifest.plannedCases = selected.length; await json(path.join(output, 'run.json'), manifest);
  }
  let rows = await refresh(output, manifest);
  while (rows.some(row => ['NOT_RUN', 'IN_PROGRESS'].includes(row.validation_status))) {
    const pending = rows.filter(row => ['NOT_RUN', 'IN_PROGRESS'].includes(row.validation_status)).slice(0, batchSize);
    const began = performance.now(), outcome = await subprocess(reference, output, 'batch', pending.map(row => row.key), timeoutMs);
    const batch = { index: manifest.batches.length, requested: pending.map(row => row.definition), durationMs: performance.now() - began, ...outcome };
    const after = await refresh(output, manifest);
    if (outcome.code !== 0 || after.filter(row => pending.some(p => p.key === row.key)).every(row => ['NOT_RUN', 'IN_PROGRESS'].includes(row.validation_status))) {
      const unfinished = after.filter(row => pending.some(p => p.key === row.key) && ['NOT_RUN', 'IN_PROGRESS'].includes(row.validation_status));
      const affected = outcome.activeKey ? unfinished.filter(row => row.key === outcome.activeKey) : unfinished;
      for (const row of affected) {
        const sourceRecord = manifest.definitions.find(record => recordKey(record) === row.key);
        await json(path.join(output, 'cases', `${caseFilename(sourceRecord)}.json`), { ...row,
          source: manifest.source, settings: SETTINGS, validation_status: 'INCONCLUSIVE',
          outcome: outcome.timedOut ? 'timeout' : 'inconclusive', reason_code: outcome.timedOut ? 'failed_timeout' : 'child_failed',
          failedStage: row.stage || 'setup',
          error: { code: outcome.timedOut ? 'AUDIT_CASE_TIMEOUT' : 'AUDIT_CHILD_FAILED', signal: outcome.signal,
            message: outcome.stderr.slice(-3000) }, stage: 'finished', finishedAt: new Date().toISOString(), pixelParityVerified: false });
      }
    }
    manifest.batches.push(batch); rows = await refresh(output, manifest);
  }
  const afterIdentity = await sourceIdentity(reference);
  manifest.sourceUnchanged = digest(afterIdentity) === digest(manifest.source);
  manifest.finishedAt = new Date().toISOString(); manifest.validation_status = manifest.sourceUnchanged ? 'AUDIT_FINISHED_WITH_PER_CASE_RESULTS' : 'FAIL_SOURCE_CHANGED';
  await json(path.join(output, 'run.json'), manifest); return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--child') await childTask(process.argv[3], process.argv[4], process.argv[5], JSON.parse(process.argv[6]));
    else {
      const [reference, output, ...args] = process.argv.slice(2), options = {};
      const mapping = { '--batch-size': 'batchSize', '--timeout-ms': 'timeoutMs', '--limit': 'limit', '--definition': 'definition', '--expected-sha256': 'expectedSha256' };
      if (!reference || !output) throw new Error('使い方: node local-node/corpus-raster-audit23.mjs 固定ZIP 出力先 [--batch-size 10] [--timeout-ms 180000] [--limit 1] [--definition anvil.anvil_screen]');
      for (let index = 0; index < args.length; index += 2) {
        const name = mapping[args[index]], value = args[index + 1];
        if (!name || value === undefined) throw new Error('AUDIT_ARGUMENT_INVALID');
        options[name] = ['definition', 'expectedSha256'].includes(name) ? value : Number(value);
      }
      const result = await auditClassicRaster23(reference, output, options);
      process.stdout.write(JSON.stringify({ event: 'raster-audit-finished', planned: result.plannedCases,
        completed: result.completedCases, pngCount: result.pngCount, outcomes: result.outcomes, output }) + '\n');
    }
  } catch (error) { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; }
}
