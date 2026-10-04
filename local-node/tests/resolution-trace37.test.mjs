import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { createResolutionTrace } from '../../editor-core/src/engine/resolution-trace37.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

async function resolve(document, name = 'root', lower = null) {
  const source = (id, kind, precedence, value) => ({ id, kind, precedence,
    filePaths: ['ui/trace.json'], readText: async () => JSON.stringify(value) });
  const catalog = await buildUiCatalog({ sources: [
    ...(lower ? [source('lower', 'vanilla', 10, lower)] : []),
    source('upper', 'imported', 20, document),
  ], parseJsonc });
  const selected = catalog.records.find(row => row.localName === name && row.sourceKind === 'imported');
  const before = JSON.stringify(document);
  const result = resolveEffectiveUi({ catalog, recordId: selected.id });
  assert.equal(JSON.stringify(document), before);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

test('selected inheritance observations distinguish missing, dynamic unknown and cycle; unselected peers are absent', async () => {
  const document = { namespace: 'trace37', root: { type: 'screen' },
    'missing@absent.base': { type: 'screen' }, 'dynamic@$unsupplied': { type: 'screen' },
    'a@trace37.b': { type: 'screen' }, 'b@trace37.a': { type: 'screen' } };
  assert.deepEqual((await resolve(document)).dependencyTrace.edges, []);
  const missing = (await resolve(document, 'missing')).dependencyTrace;
  assert.equal(missing.edges[0].resolution_state, 'missing');
  assert.equal(missing.edges[0].authored_pointer, '/missing@absent.base');
  assert.equal(missing.edges[0].to, null);
  const dynamic = (await resolve(document, 'dynamic')).dependencyTrace;
  assert.equal(dynamic.edges[0].resolution_state, 'unresolved');
  assert.deepEqual(dynamic.edges[0].reference.variable_chain, ['$unsupplied']);
  const cycle = (await resolve(document, 'a')).dependencyTrace;
  assert.equal(cycle.edges.at(-1).resolution_state, 'cycle');
  for (const trace of [missing, dynamic, cycle]) {
    assert.equal(trace.trace_complete, false);
    assert.equal(trace.enforcement, 'none');
    assert(trace.edges.every(edge => edge.required_for_frame === 'unknown'));
  }
});

test('child source pointers survive inheritance and reused template attempts remain separate', async () => {
  const result = await resolve({ namespace: 'trace37', root: { type: 'screen', controls: [
    { 'first@trace37.cell': {} }, { 'second@trace37.cell': {} }, { 'third@absent.cell': {} },
  ] }, cell: { type: 'panel' } });
  const edges = result.dependencyTrace.edges;
  assert.equal(edges.length, 3);
  assert.deepEqual(edges.map(edge => edge.authored_pointer), [
    '/root/controls/0/first@trace37.cell', '/root/controls/1/second@trace37.cell', '/root/controls/2/third@absent.cell',
  ]);
  assert.equal(new Set(edges.map(edge => edge.edge_id)).size, 3);
  assert(edges.every(edge => edge.kind === 'child_inheritance'));
});

test('discarded fixed-point attempts do not pollute final trace while observed work remains monotonic', async () => {
  const result = await resolve({ namespace: 'trace37', a: { type: 'screen', '$choose_b': true, marker: 'a' },
    b: { type: 'screen', '$choose_b': true, marker: 'b' },
    'root@$target': { '$target|default': 'trace37.a', variables: [{ requires: '$choose_b', '$target': 'trace37.b' }] } });
  assert.equal(result.document.root.marker, 'b');
  assert(result.stats.fixedPointRetries > 0);
  const trace = result.dependencyTrace;
  assert.equal(trace.edges.length, 1);
  assert.equal(trace.edges[0].to.qualified_name, 'trace37.b');
  assert(trace.observed_edges > trace.retained_edges);
  assert.equal(trace.edges[0].edge_id, 'inheritance-1');
});

test('self-qualified overlay tracks lower precedence without false cycle', async () => {
  const result = await resolve({ namespace: 'trace37', 'root@trace37.root': { marker: 'upper' } }, 'root',
    { namespace: 'trace37', root: { type: 'screen', marker: 'lower' } });
  const edge = result.dependencyTrace.edges[0];
  assert.equal(edge.kind, 'lower_layer_inheritance'); assert.equal(edge.resolution_state, 'resolved');
  assert.equal(edge.from.precedence, 20); assert.equal(edge.to.precedence, 10);
});

test('trace retention and strings are bounded and state truncation cannot imply completeness', () => {
  const trace = createResolutionTrace('root');
  for (let index = 0; index < 5000; index += 1) trace.add({ from: { id: 'root' },
    kind: 'child_inheritance', pointer: `/root/controls/${index}`, reference: 'missing', state: 'missing' });
  const result = trace.snapshot();
  assert(result.omitted_edges > 0); assert.equal(result.capture_complete, false);
  assert(result.retained_edges <= result.limits.maximum_edges);
  assert(result.retained_serialized_chars <= result.limits.maximum_serialized_chars);
  assert.equal(result.observed_edges, 5000);
  const clipped = createResolutionTrace('root');
  clipped.add({ kind: 'record_inheritance', reference: 'a'.repeat(10000), state: 'missing' });
  assert.equal(clipped.snapshot().capture_complete, false);
  assert.equal(clipped.snapshot().edges[0].reference.authored.length, 512);
});

test('final variable scan explains diagnostic count truncation without changing warning severity', async () => {
  const root = { type: 'screen' };
  for (let index = 0; index < 257; index += 1) root[`field${index}`] = `$missing${index}`;
  const result = await resolve({ namespace: 'trace37', root });
  const diagnostic = result.diagnostics.find(row => row.code === 'UI_VARIABLE_FINAL_SCAN_LIMIT');
  assert(diagnostic); assert.equal(diagnostic.severity, 'warning');
  assert.deepEqual(diagnostic.limitKinds, ['VARIABLE_DIAGNOSTIC_LIMIT']);
  assert.equal(diagnostic.variableCount, 256); assert.equal(diagnostic.pendingFrames, 0);
  assert(diagnostic.observedWork > 0); assert.equal(diagnostic.remainingValueCount, null);
});
