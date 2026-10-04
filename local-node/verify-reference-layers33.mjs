/** 添付パックと固定公開バニラを別層として読む検査。入力ZIPは変更しない。 */
import { writeFile, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { CliClient } from './cli-client.mjs';
const [vanillaPath, importedPath, output] = process.argv.slice(2);
if (!vanillaPath || !importedPath || !output) throw new Error('vanilla.zip imported.mcpack output.json');
const report = { schema: 'jsonui-reference-layers33-v1', started_at: new Date().toISOString(),
  status: 'IN_PROGRESS', limitation: '公開v1.26.50.4はユーザー使用版と同一と確認されていない。別層の参照可否のみを検査し、元ファイルへの定義挿入は行わない。' };
const started = performance.now(); let client;
try {
  const before = await Promise.all([stat(vanillaPath), stat(importedPath)]);
  client = await CliClient.start({ signal: AbortSignal.timeout(180000) });
  const vanilla = await client.importPack(vanillaPath), imported = await client.importPack(importedPath);
  report.inputs = [vanilla.source, imported.source].map(s => ({ name: s.name, size_bytes: s.size_bytes, checksum_sha256: s.checksum_sha256 }));
  const workspace = await client.request('/api/node/workspace-open', { payload: { sources: [{ id: vanilla.id, kind: 'vanilla' }, { id: imported.id, kind: 'imported' }] } });
  const catalog = await client.request('/api/node/workspace-catalog', { payload: { workspaceId: workspace.workspaceId } });
  const matches = catalog.records.filter(r => r.qualifiedName === 'anvil.anvil_screen');
  const record = matches.find(r => r.sourceKind === 'imported') || matches.find(r => r.sourceId === imported.id);
  if (!record) throw new Error('添付層の金床定義が見つからない');
  report.selection = { source_kind: record.sourceKind, file_path: record.filePath, raw_key: record.rawKey, qualified_name: record.qualifiedName };
  const plan = await client.request('/api/node/workspace-export', { payload: { workspaceId: workspace.workspaceId, mode: 'plan',
    selections: [{ sourceId: record.sourceId, filePath: record.filePath, rawKey: record.rawKey }] } });
  report.export_ok = plan.ok; report.export_plan = plan.plan || plan;
  const after = await Promise.all([stat(vanillaPath), stat(importedPath)]);
  report.inputs_unchanged = before.every((s, i) => s.size === after[i].size && s.mtimeMs === after[i].mtimeMs);
  if (!report.inputs_unchanged) throw new Error('入力ZIPのサイズまたはmtimeが変化した');
  report.status = plan.ok ? 'PASS' : 'INCONCLUSIVE';
} catch (error) { report.status = 'FAIL'; report.error = { code: error.code, message: error.message }; process.exitCode = 1; }
finally { await client?.close(); report.finished_at = new Date().toISOString(); report.duration_ms = performance.now() - started;
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, export_ok: report.export_ok,
    unresolved: report.export_plan?.unresolved, input_unchanged: report.inputs_unchanged, error: report.error })); }
