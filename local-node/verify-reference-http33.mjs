/** 固定した実パックを使う HTTP / Node worker 検査。ブラウザー・実機の検査とは別。 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { CliClient } from './cli-client.mjs';
import { ResourceZipReader } from './resource-zip.mjs';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';

const [input, output, kind = 'imported'] = process.argv.slice(2);
if (!input || !output || !['imported', 'vanilla'].includes(kind)) throw new Error('node local-node/verify-reference-http33.mjs input.zip output.json imported|vanilla');
const report = { schema: 'jsonui-reference-http33-v1', started_at: new Date().toISOString(), node: process.version,
  platform: process.platform, kind, checks: [], stages: [], limitations: [
    '実在する入力ZIPに対する今回の一回の計測。全てのバニラ版の対応保証ではない。',
    'ブラウザーを経由せず本物のloopback HTTPとNode workerを実行する。画面の目視検査ではない。',
    '代表ランタイム値によるレイアウトであり、Minecraft実機の状態・画素一致の証拠ではない。',
    'RSSは同一Nodeプロセスのworkerを含む。50ms間隔の標本最大値とOSの高水位を別々に記録。',
  ] };
const started = performance.now(), initial = process.memoryUsage();
let client, reader, peakRss = initial.rss, peakHeap = initial.heapUsed, samples = 0;
const sample = () => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); samples++; };
const sampler = setInterval(sample, 50); sampler.unref();
async function stage(name, task) {
  const before = performance.now(); sample();
  try { const value = await task(); report.stages.push({ name, status: 'PASS', duration_ms: performance.now() - before }); sample(); return value; }
  catch (error) { report.stages.push({ name, status: 'FAIL', duration_ms: performance.now() - before, code: error.code || null, message: error.message }); throw error; }
}
const summarizeWarnings = values => {
  const counts = {};
  for (const value of values || []) counts[value?.code || 'UNKNOWN'] = (counts[value?.code || 'UNKNOWN'] || 0) + 1;
  return counts;
};

try {
  await mkdir(path.dirname(output), { recursive: true });
  const info = await stat(input); report.input = { name: path.basename(input), bytes: info.size };
  await stage('ZIP索引と必要JSONの遅延読み込み', async () => {
    reader = new ResourceZipReader(); await reader.openFromFile({ diskPath: input, name: path.basename(input) });
    const index = await reader.listEntries();
    const uiPath = [...reader.entryIndex.keys()].find(key => key.endsWith('ui/anvil_screen.json'));
    assert(uiPath, 'anvil UI が索引にある'); await reader.bytes(uiPath);
    report.lazy = { entries: reader.entryIndex.size, root_prefix: reader.rootPrefix || '', meta: index.meta,
      physical_io: reader.reader.snapshot(), memory: process.memoryUsage() };
    assert(report.lazy.physical_io.cache_bytes <= 256 * 1024);
    assert(report.lazy.physical_io.physical_bytes < info.size, '索引＋1 JSONの読込で全ZIPを読まない');
    await reader.close(); reader = null;
  });
  client = await CliClient.start({ signal: AbortSignal.timeout(12 * 60 * 1000) });
  report.static_resources = [];
  for (const route of ['/', '/src/main.js', '/src/ui/workspace-editor.js']) {
    await stage(`HTTP静的配信 ${route}`, async () => {
      const response = await fetch(new URL(route, client.base), { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer());
      report.static_resources.push({ route, status: response.status, bytes: bytes.length,
        content_type: response.headers.get('content-type'), sha256: createHash('sha256').update(bytes).digest('hex') });
    });
  }
  const imported = await stage('ストリームHTTP取込', () => client.importPack(input));
  report.input.sha256 = imported.source.checksum_sha256;
  report.import = { root_prefix: imported.rootPrefix, metadata: imported.metadata };
  // pack ID は処理内でのみ用いる。認証tokenと識別子を成果物へ出さない。
  delete report.import.metadata.id;
  const sources = [{ id: imported.id, kind }];
  const workspace = await stage('Node workspace構築', () => client.request('/api/node/workspace-open', { payload: { sources } }));
  assert.equal(workspace.ok, true);
  report.workspace = { file_count: workspace.files?.length, diagnostics: summarizeWarnings(workspace.diagnostics) };
  const catalog = await stage('Node UIカタログ構築', () => client.request('/api/node/workspace-catalog', { payload: { workspaceId: workspace.workspaceId } }));
  report.catalog = { records: catalog.records.length, screens: catalog.records.filter(r => r.classification === 'SCREEN').length,
    pocket: catalog.records.filter(r => r.profile === 'pocket').length, file_count: new Set(catalog.records.map(r => r.filePath)).size };
  report.previews = [];
  const representatives = ['anvil.anvil_screen', 'crafting.inventory_screen', 'enchanting.enchanting_screen', 'horse.horse_screen', 'beacon.beacon_screen', 'loom.loom_screen', 'trade.trade_screen'];
  for (const symbol of representatives) {
    const record = catalog.records.find(r => r.qualifiedName === symbol && r.profile !== 'pocket');
    if (!record) { report.previews.push({ symbol, status: 'NOT_APPLICABLE', reason: 'この単独入力に対象定義がない。' }); continue; }
    const item = { symbol, path: record.filePath, status: 'IN_PROGRESS' }; report.previews.push(item);
    try {
      const variables = buildRepresentativeClassicResolverVariables({ qualifiedName: symbol, userVariables: {} });
      const representativeCollections = buildRepresentativeClassicCollections({ qualifiedName: symbol, collectionData: {} });
      const projected = await stage(`Node解決 ${symbol}`, () => client.request('/api/node/project', {
        payload: { catalogId: catalog.nodeCatalogId, recordId: record.id, variables, representativeCollections } }));
      assert(projected.ok, JSON.stringify(projected.diagnostics?.slice(0, 3)));
      const frame = await stage(`Nodeフレーム ${symbol}`, () => client.request('/api/node/frame', {
        payload: { projectionId: projected.nodeProjectionId, recordId: record.id, filePath: record.filePath,
          qualifiedName: symbol, generation: 0, preset: { width: 480, height: 270 }, visibilityMode: 'safe',
          animationTime: 1, animationEvent: 'screen.entrance_push', variables, representativeCollections } }));
      assert(frame.ok !== false); assert(Array.isArray(frame.layout?.boxes));
      item.status = 'PASS'; item.boxes = frame.layout.boxes.length; item.layout_stats = frame.layout.stats;
      item.metrics = frame.metrics; item.resolver_warnings = summarizeWarnings(projected.diagnostics);
      item.frame_warnings = summarizeWarnings(frame.layout.warnings);
      item.frame_warning_details = frame.layout.warnings || [];
      assert.equal(frame.metrics?.processing, 'node-worker', '重いフレーム処理はNode workerが実行');
    } catch (error) { item.status = 'FAIL'; item.code = error.code || null; item.message = error.message; }
  }
  const pocket = catalog.records.find(r => r.profile === 'pocket' && r.qualifiedName.includes('anvil'));
  if (pocket) {
    try {
      const projected = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: pocket.id } });
      report.pocket = { symbol: pocket.qualifiedName, catalog_readable: true, projection_allowed: projected.ok === true, diagnostics: summarizeWarnings(projected.diagnostics) };
      if (projected.ok) {
        try { await client.request('/api/node/frame', { payload: { projectionId: projected.nodeProjectionId, recordId: pocket.id, filePath: pocket.filePath, preset: { width: 480, height: 270 } } }); report.pocket.frame_blocked = false; }
        catch (error) { report.pocket.frame_blocked = error.code === 'POCKET_PREVIEW_BLOCKED'; report.pocket.code = error.code; }
      }
    } catch (error) { report.pocket = { symbol: pocket.qualifiedName, catalog_readable: true, projection_allowed: false, code: error.code, frame_blocked: error.code === 'POCKET_PREVIEW_BLOCKED' }; }
  }
  const anvil = catalog.records.find(r => r.qualifiedName === 'anvil.anvil_screen' && r.profile !== 'pocket');
  if (anvil) {
    try {
      const payload = { workspaceId: workspace.workspaceId, expectedRevision: workspace.revision, mode: 'plan',
        selections: [{ sourceId: anvil.sourceId, filePath: anvil.filePath, rawKey: anvil.rawKey }] };
      const plan = await stage('anvil選択エクスポート計画', () => client.request('/api/node/workspace-export', { payload }));
      report.export = { ok: plan.ok, plan: plan.plan || plan };
      if (plan.ok) {
        const zip = await stage('anvil選択ZIP生成', () => client.request('/api/node/workspace-export', { payload: { ...payload, mode: 'zip' }, binary: true }));
        const packPath = path.join(path.dirname(output), `${path.parse(output).name}-anvil-roundtrip.mcpack`);
        await writeFile(packPath, zip, { flag: 'wx' });
        report.export.artifact = { name: path.basename(packPath), bytes: zip.length, sha256: createHash('sha256').update(zip).digest('hex') };
        const reread = await stage('選択ZIP再取込', () => client.importPack(packPath));
        const rereadCatalog = await client.request('/api/node/catalog', { payload: { sources: [{ id: reread.id, kind: 'imported' }] } });
        report.export.reimport = { records: rereadCatalog.records?.length, anvil_present: rereadCatalog.records?.some(r => r.qualifiedName === 'anvil.anvil_screen') };
      }
    } catch (error) { report.export = { ok: false, code: error.code, message: error.message, detail: error.context?.response }; }
  }
  report.processing = client.app.processor.snapshot();
  report.status = report.previews.some(p => p.status === 'FAIL') ? 'FAIL' : report.export?.ok === false ? 'INCONCLUSIVE' : 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = { code: error.code || null, message: error.message }; process.exitCode = 1;
} finally {
  await reader?.close(); await client?.close(); clearInterval(sampler); sample();
  report.memory = { initial, final: process.memoryUsage(), sample_interval_ms: 50, sample_count: samples,
    sampled_peak_rss_bytes: peakRss, sampled_peak_main_heap_bytes: peakHeap, os_max_rss_kib: process.resourceUsage().maxRSS };
  report.duration_ms = performance.now() - started; report.finished_at = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, input: report.input, previews: report.previews,
    export_ok: report.export?.ok, error: report.error, duration_ms: report.duration_ms, memory: report.memory }));
}
