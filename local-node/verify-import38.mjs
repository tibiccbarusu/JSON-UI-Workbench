/** R38 supplied-pack import verification; evidence only, no Minecraft execution. */
import { CliClient } from './cli-client.mjs';
import { writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
const [output, ...inputs] = process.argv.slice(2);
if (!output || !inputs.length) throw new Error('Usage: node verify-import38.mjs output.json input.mcaddon [large.zip]');
const report = { schema: 'jsonui-import38-verification-v1', started_at: new Date().toISOString(),
  node: process.version, inputs: [], native_execution: false, limitation: '取込・索引・catalogの検査。実機描画一致の検査ではない。' };
for (const input of inputs) {
  let client; const started = performance.now(), item = { name: path.basename(input), bytes: (await stat(input)).size };
  report.inputs.push(item);
  try {
    client = await CliClient.start({ signal: AbortSignal.timeout(180000) });
    const imported = await client.importPack(input); item.import_ms = performance.now() - started;
    item.source = imported.source; delete item.source.path;
    item.metadata = { zip: imported.metadata.zipMeta, manifest: imported.metadata.manifestSummary, paths: imported.metadata.packPaths.length };
    const catalogStart = performance.now(), catalog = await client.request('/api/node/catalog', { payload: { sources: [{ kind: 'imported', id: imported.id }] } });
    item.catalog = { duration_ms: performance.now() - catalogStart, files: catalog.files.length, definitions: catalog.records.length,
      diagnostic_counts: Object.fromEntries(['error', 'warning', 'info'].map(level => [level, (catalog.diagnostics || []).filter(d => d.severity === level).length])) };
    const evidence = await client.request('/api/node/debug-bundle', { payload: { schema: 'jsonui-debug-request-v1' } });
    item.processing = evidence.server?.processor?.caches; item.import_status = 'PASS';
    item.catalog.status = item.catalog.diagnostic_counts.error ? 'PARTIAL' : 'PASS'; item.status = item.catalog.status;
  } catch (error) { item.status = 'FAIL'; item.error = { code: error.code || error.name, message: error.message, context: error.context }; process.exitCode = 1; }
  finally { await client?.close(); item.duration_ms = performance.now() - started; item.finished_at = new Date().toISOString();
    report.finished_at = item.finished_at; report.resource_usage = process.resourceUsage(); await writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ name: item.name, bytes: item.bytes, status: item.status, duration_ms: item.duration_ms, error: item.error })); }
}
