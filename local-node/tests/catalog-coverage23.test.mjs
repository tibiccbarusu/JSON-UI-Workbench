import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { createReferenceResultCache } from '../../editor-core/src/engine/reference-result-cache.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

test('参照cacheは異なる変数候補で祖先走査予算を使い切らず、正しい候補だけを返す', () => {
  const limits = { maxDefinitions: 100, maxReferenceNodesTotal: 20, maxReferenceVariablesPerScope: 100,
    maxScanDepth: 96, maxReferenceAlternatives: 8 };
  const cache = createReferenceResultCache(limits);
  for (let index = 0; index < 8; index += 1) cache.store('target', {
    reads: new Map([['$pick', { exists: true, read: true, value: new Set([index]) }]]),
    references: new Set([`x.item${index}`]), visited: new Set(['target']), requiredAncestors: new Set(),
    relativeDepth: 1, maxScopeDelta: 0,
  });
  const stack = new Set(Array.from({ length: 30 }, (_, index) => `ancestor${index}`));
  const environment = new Map([['$pick', new Set([7])]]);
  assert.deepEqual([...cache.find('target', environment, stack, 0).references], ['x.item7']);
  assert.equal(cache.stats.bypassed, 0);
  assert(cache.stats.checks < limits.maxReferenceNodesTotal * 8);
  stack.add('target');
  assert.equal(cache.find('target', environment, stack, 0), null);
});

const makeCatalog = async (limits = {}) => {
  const documents = {
    'ui/_global_variables.json': { '$one': 'x.a', '$two': 'x.b' },
    'ui/x.json': { namespace: 'x', a: {}, b: {}, screen: { type: 'factory', control_name: '$two' } },
  };
  return buildUiCatalog({ limits, parseJsonc, sources: [{ id: 'test', kind: 'vanilla', precedence: 1,
    filePaths: Object.keys(documents), readText: async name => JSON.stringify(documents[name]) }] });
};

test('global変数の走査が不完全なら各定義とcoverageも不完全を保持する', async () => {
  const catalog = await makeCatalog({ maxReferenceVariablesPerScope: 1 });
  assert.equal(catalog.summary.referenceCoverage.status, 'partial');
  assert.equal(catalog.summary.referenceCoverage.globalVariablesComplete, false);
  assert.equal(catalog.summary.referenceCoverage.definitionsComplete, 0);
  assert.equal(catalog.summary.referenceCoverage.definitionsIncomplete, 3);
  assert(catalog.summary.referenceCoverage.limitReasons.includes('variables-per-scope'));
  assert(catalog.records.every(record => record.referenceScanComplete === false));
  assert(catalog.diagnostics.some(row => row.definition === '$global_variables' && row.code === 'UI_REFERENCE_SCAN_LIMIT'));
});

test('上限内のcoverageは参照発見だけの完全性を表し、画面の実機一致は主張しない', async () => {
  const catalog = await makeCatalog();
  assert.deepEqual(catalog.summary.referenceCoverage, {
    status: 'complete', scope: 'catalog-reference-discovery', definitionsTotal: 3,
    definitionsComplete: 3, definitionsIncomplete: 0, globalVariablesComplete: true,
    limitReasons: [], nodesUsed: catalog.summary.referenceNodesVisited, nodesLimit: 500_000,
  });
  assert(catalog.records.find(record => record.localName === 'screen').references.includes('x.b'));
});
