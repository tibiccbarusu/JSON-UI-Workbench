import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { createReferenceResultCache, ObservedReferenceEnvironment } from '../../editor-core/src/engine/reference-result-cache.js';
import { ReferenceEnvironment, sameOrderedCandidates } from '../../editor-core/src/engine/reference-environment.js';

const defaults = { maxDefinitions: 1000, maxReferenceNodesTotal: 1000, maxReferenceVariablesPerScope: 20, maxScanDepth: 20, maxReferenceAlternatives: 8 };
const entry = (overrides = {}) => ({ reads: new Map(), references: new Set(['x.a']), visited: new Set(['target']), requiredAncestors: new Set(), relativeDepth: 2, maxScopeDelta: 1, ...overrides });
const catalogFor = documents => buildUiCatalog({ parseJsonc, sources: documents.map((document, index) => ({ id: `source${index}`, kind: index ? 'custom' : 'vanilla', precedence: index,
  filePaths: ['ui/test.json'], readText: async () => JSON.stringify(document) })) });

test('catalog: a cached lower overlay requires the skipped higher ancestor', async () => {
  const catalog = await catalogFor([{ namespace: 'x', low: {}, high: {}, layer: { type: 'factory', control_name: '$low' }, template: { controls: [{ 'l@x.layer': {} }] } },
    { namespace: 'x', layer: { '$low': 'x.low', '$high': 'x.high', type: 'factory', control_name: '$high', controls: [{ 't@x.template': {} }] },
      screen: { '$low': 'x.low', '$high': 'x.high', controls: [{ 't@x.template': {} }] } }]);
  assert.deepEqual(catalog.records.find(record => record.qualifiedName === 'x.screen').references, ['x.high', 'x.layer', 'x.template']);
  assert.equal(catalog.summary.referenceIncompleteDefinitions, 0);
});

test('catalog: missing bindings and explicitly shadowed bindings are separate cache contexts', async () => {
  const catalog = await catalogFor([{ namespace: 'x', a: {}, b: {}, template: { '$pick|default': 'x.a', type: 'factory', control_name: '$pick' },
    screen: { '$noise': true, controls: [{ 'first@x.template': {} }, { 'second@x.template': { '$pick': 'x.b' } }] } }]);
  assert.deepEqual(catalog.records.find(record => record.qualifiedName === 'x.screen').references, ['x.a', 'x.b', 'x.template']);
});

test('reference cache: candidate identity and order are not coerced', () => {
  const object = { key: '@x.a' };
  assert(sameOrderedCandidates(new Set([object, 'x.b']), new Set([object, 'x.b'])));
  assert(!sameOrderedCandidates(new Set([object]), new Set([{ key: '@x.a' }])));
  assert(!sameOrderedCandidates(new Set(['x.a', 'x.b']), new Set(['x.b', 'x.a'])));
});

test('reference cache: reads observe inherited bindings but not local replacements', () => {
  const reads = new Map(), parent = new Map([['$a', new Set(['x.a'])], ['$b', new Set(['x.b'])]]);
  const observed = new ObservedReferenceEnvironment(parent, reads);
  const local = new ReferenceEnvironment(observed, new Map([['$a', new Set(['x.override'])]]));
  assert.deepEqual([...local.get('$a')], ['x.override']);
  assert.equal(reads.get('$a').read, false);
  assert.deepEqual([...local.get('$b')], ['x.b']);
  assert.equal(reads.get('$b').read, true);
  assert.equal(local.size, 2);
});

test('reference cache: ancestry, depth and variable limits reject unsafe replay', () => {
  const cache = createReferenceResultCache(defaults);
  cache.store('target', entry({ requiredAncestors: new Set(['overlay']) }));
  const environment = new Map();
  assert.equal(cache.find('target', environment, new Set(), 0), null);
  assert.equal(cache.find('target', environment, new Set(['overlay', 'target']), 0), null);
  assert.equal(cache.find('target', environment, new Set(['overlay']), 19), null);
  const full = new Map(Array.from({ length: 20 }, (_, i) => [`$${i}`, new Set([i])]));
  assert.equal(cache.find('target', full, new Set(['overlay']), 0), null);
  assert(cache.find('target', environment, new Set(['overlay']), 0));
});

test('reference cache: exhausted storage falls back without retaining an oversized entry', () => {
  const cache = createReferenceResultCache({ ...defaults, maxReferenceNodesTotal: 1 });
  cache.store('target', entry({ references: new Set(['x.a', 'x.b', 'x.c']) }));
  assert.equal(cache.stats.entries, 0);
  assert.equal(cache.stats.storageBypassed, 1);
  assert.equal(cache.find('target', new Map(), new Set(), 0), null);
  assert.equal(cache.stats.retainedMembers, 0);
});

test('reference cache: exhausted replay checks returns a cache miss', () => {
  const cache = createReferenceResultCache({ ...defaults, maxReferenceNodesTotal: 1 });
  cache.store('target', entry());
  for (let i = 0; i < 8; i += 1) cache.find('target', new Map(), new Set(), 0);
  assert.equal(cache.find('target', new Map(), new Set(), 0), null);
  assert(cache.stats.checks <= 8);
  assert(cache.stats.bypassed > 0);
});
