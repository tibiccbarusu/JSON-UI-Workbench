/** 公開パックを全定義走査し、凍結版との参照集合を再現可能に比較する。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [sourceArg, implementationArg, reportArg, snapshotArg, limitsArg] = process.argv.slice(2);
if (!sourceArg || !implementationArg || !reportArg || !snapshotArg) throw new Error('arguments: resource-pack implementation-root report.json snapshot.json [limits-json]');
const sourceRoot = path.resolve(sourceArg), implementationRoot = path.resolve(implementationArg);
const filePaths = [], directories = [''];
while (directories.length) {
  const relative = directories.pop();
  for (const entry of await fs.readdir(path.join(sourceRoot, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) directories.push(name);
    else if (entry.isFile()) filePaths.push(name);
  }
  if (filePaths.length + directories.length > 100_000) throw new Error('SOURCE_FILE_BUDGET');
}
filePaths.sort();
const { buildUiCatalog } = await import(pathToFileURL(path.join(implementationRoot, 'editor-core/src/engine/ui-catalog.js')));
const { parseJsonc } = await import(pathToFileURL(path.join(implementationRoot, 'editor-core/src/json/jsonc.js')));
const readFiles = new Map();
const startedAt = new Date().toISOString(), started = performance.now();
const catalog = await buildUiCatalog({
  sources: [{ id: 'public', kind: 'vanilla', precedence: 0, filePaths,
    readText: async name => { const text = await fs.readFile(path.join(sourceRoot, name), 'utf8'); readFiles.set(name, createHash('sha256').update(text).digest('hex')); return text; } }],
  parseJsonc,
  ...(limitsArg ? { limits: JSON.parse(limitsArg) } : {}),
});
const durationMs = performance.now() - started;
const snapshot = catalog.records.map(record => ({ id: record.id, name: record.qualifiedName, file: record.filePath,
  complete: record.referenceScanComplete, references: record.references }));
const codes = {}, reasons = {};
for (const diagnostic of catalog.diagnostics) {
  codes[diagnostic.code] = (codes[diagnostic.code] || 0) + 1;
  for (const reason of diagnostic.reasons || []) reasons[reason] = (reasons[reason] || 0) + 1;
}
const report = { schema: 'jsonui-catalog-comparison-v1', startedAt, finishedAt: new Date().toISOString(), node: process.version,
  implementationRoot, sourceRoot, limits: limitsArg ? JSON.parse(limitsArg) : 'production-defaults', durationMs,
  inputOrder: { algorithm: 'all regular paths, UTF-16 code unit ascending Array.prototype.sort; catalog registration order then applies',
    fileCount: filePaths.length, orderedPathsSha256: createHash('sha256').update(JSON.stringify(filePaths)).digest('hex'),
    textReadOrderSha256: createHash('sha256').update(JSON.stringify([...readFiles.keys()])).digest('hex') },
  summary: catalog.summary, diagnosticCodes: codes, limitReasons: reasons,
  sourceFiles: [...readFiles].map(([file, sha256]) => ({ file, sha256 })),
  implementationSha256: createHash('sha256').update(await fs.readFile(path.join(implementationRoot, 'editor-core/src/engine/ui-catalog.js'))).digest('hex'),
  snapshotSha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
  memory: process.memoryUsage(),
};
report.implementationFiles = [];
for (const relative of ['editor-core/src/engine/ui-catalog.js', 'editor-core/src/engine/reference-environment.js',
  'editor-core/src/engine/reference-result-cache.js', 'editor-core/src/engine/control-reference.js', 'editor-core/src/json/jsonc.js']) {
  try { report.implementationFiles.push({ path: relative, sha256: createHash('sha256').update(await fs.readFile(path.join(implementationRoot, relative))).digest('hex') }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; report.implementationFiles.push({ path: relative, absent: true }); }
}
await fs.writeFile(reportArg, JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(snapshotArg, JSON.stringify(snapshot) + '\n');
console.log(JSON.stringify({ durationMs, summary: catalog.summary, limitReasons: reasons, memory: report.memory }));
