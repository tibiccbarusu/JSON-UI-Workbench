#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildUiCatalog } from '../src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../src/json/jsonc.js';

const inputDirectory = path.resolve(process.argv[2] || '');
if (!process.argv[2]) {
  console.error('Usage: node scripts/validate-ui-corpus.mjs <extracted-resource-pack-directory>');
  process.exit(2);
}

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(absolute, relative));
    else if (entry.isFile()) output.push(relative.replaceAll('\\', '/'));
  }
  return output;
}

const rootStats = await stat(inputDirectory).catch(() => null);
if (!rootStats?.isDirectory()) {
  console.error(`Input is not a directory: ${inputDirectory}`);
  process.exit(2);
}

const filePaths = await walk(inputDirectory);
const source = {
  id: 'corpus',
  kind: 'imported',
  precedence: 20,
  filePaths,
  async readText(filePath) {
    return readFile(path.join(inputDirectory, filePath), 'utf8');
  },
};

const catalog = await buildUiCatalog({
  sources: [source],
  parseJsonc: (text, options = {}) => parseJsonc(text, { fileName: options.filePath || '(corpus)' }),
  limits: {
    maxFiles: 10000,
    maxDefinitions: 150000,
    maxTextBytesPerFile: 16 * 1024 * 1024,
    maxTotalTextBytes: 128 * 1024 * 1024,
  },
});

const filesWithMultipleDefinitions = catalog.files.filter((file) => file.definitionIds.length > 1);
const staticCrossFileBases = [];
for (const record of catalog.records) {
  if (!record.baseRef || record.baseRef.startsWith('$')) continue;
  const qualified = record.baseRef.includes('.')
    ? record.baseRef
    : (record.namespace ? `${record.namespace}.${record.baseRef}` : record.baseRef);
  const winnerId = catalog.symbols[qualified]?.winnerId;
  const base = winnerId ? catalog.recordsById[winnerId] : null;
  if (base && base.filePath !== record.filePath) staticCrossFileBases.push({ record, base });
}

const candidates = [
  ...staticCrossFileBases.map(({ record }) => record).filter((record) => record.profile !== 'pocket'),
  ...catalog.records.filter((record) => record.profile !== 'pocket' && record.classification === 'SCREEN'),
  ...catalog.records.filter((record) => record.profile !== 'pocket'),
];
const dedupedCandidates = [];
const seen = new Set();
for (const record of candidates) {
  if (seen.has(record.id)) continue;
  seen.add(record.id);
  dedupedCandidates.push(record);
  if (dedupedCandidates.length >= 64) break;
}

const resolution = {
  attempted: 0,
  ok: 0,
  failed: 0,
  withCrossFileProvenance: 0,
  dynamicBaseDiagnostics: 0,
  missingBaseDiagnostics: 0,
  pocketDependencyBlocks: 0,
  failureCodes: {},
  failureSamples: [],
};
for (const record of dedupedCandidates) {
  const result = resolveEffectiveUi({
    catalog,
    recordId: record.id,
    limits: { maxResolvedObjects: 20000, maxInheritanceDepth: 96, maxControlDepth: 192 },
  });
  resolution.attempted += 1;
  if (result.ok) resolution.ok += 1;
  else {
    resolution.failed += 1;
    const code = String(result.error?.code || 'UNKNOWN');
    resolution.failureCodes[code] = (resolution.failureCodes[code] || 0) + 1;
    if (resolution.failureSamples.length < 20) {
      resolution.failureSamples.push({ id: record.id, filePath: record.filePath, definition: record.localName, code });
    }
  }
  if (result.ok && new Set(result.provenance.map((item) => item.filePath)).size > 1) {
    resolution.withCrossFileProvenance += 1;
  }
  for (const diagnostic of result.diagnostics || []) {
    if (diagnostic.code === 'UI_DYNAMIC_BASE_UNRESOLVED') resolution.dynamicBaseDiagnostics += 1;
    if (diagnostic.code === 'UI_BASE_NOT_FOUND' || diagnostic.code === 'UI_CONTROL_BASE_NOT_FOUND') resolution.missingBaseDiagnostics += 1;
    if (diagnostic.code === 'POCKET_DEPENDENCY_BLOCKED') resolution.pocketDependencyBlocks += 1;
  }
}

const parseFailures = catalog.diagnostics.filter((item) => item.code === 'UI_CATALOG_PARSE_FAILED');
const guardrails = {
  parsedAtLeast100UiFiles: catalog.summary.parsedFiles >= 100,
  indexedAtLeast1000Definitions: catalog.summary.definitions >= 1000,
  foundPocketDefinitions: catalog.summary.pocketDefinitions >= 1,
  foundMultipleDefinitionsInOneFile: filesWithMultipleDefinitions.length >= 1,
  foundStaticCrossFileInheritance: staticCrossFileBases.length >= 1,
  resolvedCrossFileProvenance: resolution.withCrossFileProvenance >= 1,
  noParseFailures: parseFailures.length === 0,
};

const report = {
  schema: 'jsonui-corpus-validation/v1',
  status: Object.values(guardrails).every(Boolean) ? 'PASS' : 'FAIL',
  input: { directory: inputDirectory, fileCount: filePaths.length },
  catalog: catalog.summary,
  evidence: {
    filesWithMultipleDefinitions: filesWithMultipleDefinitions.length,
    maximumDefinitionsInOneFile: Math.max(0, ...catalog.files.map((file) => file.definitionIds.length)),
    staticCrossFileBases: staticCrossFileBases.length,
    dynamicBaseRecords: catalog.records.filter((record) => String(record.baseRef || '').startsWith('$')).length,
    parseFailures: parseFailures.slice(0, 20),
  },
  resolution,
  guardrails,
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
