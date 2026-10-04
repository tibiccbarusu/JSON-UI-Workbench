import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBindingsForUiModel } from '../src/bindings/bindings-evaluator.js';
import { summarizeBindingQuality } from '../src/engine/binding-quality40.js';
import { summarizeCollectionQuality } from '../src/engine/collection-quality39.js';
import { knownUnsupportedPreviewProperties41 } from '../src/preview/native-property-diagnostics41.js';

// Original minimal fixtures: no game assets or extracted resource-pack code.
const node = (id, props = {}, children = [], bindings = [], name = id, type = 'panel') =>
  ({ id, type, props, children, bindings, key: { raw: name, local_name: name } });
const view = name => ({ binding_type: 'view', source_control_name: name,
  resolve_sibling_scope: true, source_property_name: '#seed', target_property_name: '#text' });
const evaluate = (root, options) => evaluateBindingsForUiModel({ root }, options);
const caller = () => node('caller', { text: 'authored' }, [], [view('source')]);
const source = (id, props = {}) => node(id, { property_bag: { '#seed': id }, ...props }, [], [], 'source');

test('declared inactive sibling cannot fall through to an unrelated active source', () => {
  const result = evaluate(node('root', {}, [
    node('local', {}, [source('local-source', { ignored: true }), caller()]),
    node('remote', {}, [source('remote-source')]),
  ]));
  assert.equal(result.propsById.caller.text, 'authored');
  assert(result.warnings.some(value => value.startsWith('VIEW_SOURCE_UNRESOLVED:caller:')));
  assert.equal(result.diagnostics.find(row => row.nodeId === 'caller').sourceNodeId, undefined);
});

test('declared inactive local child cannot borrow another branch', () => {
  const own = caller(); own.bindings[0].resolve_sibling_scope = false;
  own.children = [source('hidden-child', { ignored: true })];
  const result = evaluate(node('root', {}, [own, node('remote', {}, [source('remote-source')])]));
  assert.equal(result.propsById.caller.text, 'authored');
  assert(result.warnings.some(value => value.startsWith('VIEW_SOURCE_UNRESOLVED:caller:')));
});

test('global fallback is labelled, retained for preview, and never certified native scope', () => {
  const result = evaluate(node('root', {}, [node('remote', {}, [source('remote-source')]), caller()]));
  assert.equal(result.propsById.caller.text, 'remote-source');
  const descriptor = result.diagnostics.find(row => row.nodeId === 'caller');
  assert.equal(descriptor.sourceResolution, 'global_fallback');
  assert.equal(descriptor.sourceNodeId, 'remote-source');
  assert(result.warnings.includes('VIEW_SOURCE_GLOBAL_FALLBACK:count=1:native_scope_unverified=true'));
  const quality = summarizeBindingQuality(result);
  assert.equal(quality.status, 'passed', 'computed preview remains available');
  assert.equal(quality.source_scope.status, 'unknown');
  assert.equal(quality.source_scope.global_fallback_count, 1);
  assert.equal(quality.source_scope.native_scope_verified, false);
});

test('local sibling and self resolution stay distinct from global fallback', () => {
  const self = node('self', { property_bag: { '#seed': 'own' } }, [], [{ ...view(''), resolve_sibling_scope: false }]);
  const result = evaluate(node('root', {}, [source('direct-source'), caller(), self]));
  assert.equal(result.propsById.caller.text, 'direct-source');
  assert.equal(result.propsById.self.text, 'own');
  assert.equal(result.diagnostics.find(row => row.nodeId === 'caller').sourceResolution, 'sibling');
  assert.equal(result.diagnostics.find(row => row.nodeId === 'self').sourceResolution, 'self');
  assert.equal(summarizeBindingQuality(result).source_scope.global_fallback_count, 0);
});

test('unscoped caller cannot borrow a control from a generated collection instance', () => {
  const result = evaluate(node('root', {}, [caller(), node('row', {
    __jsonui_preview_collection_name: 'examples', collection_index: 0,
  }, [source('generated-source')])]));
  assert.equal(result.propsById.caller.text, 'authored');
  assert(result.warnings.some(value => value.startsWith('VIEW_SOURCE_UNRESOLVED:caller:')));
});

const radioRead = { binding_type: 'collection', binding_collection_name: 'custom_dropdown',
  binding_name: '#custom_radio_text', binding_name_override: '#text' };
const details = { binding_type: 'collection_details' };
function radioFixture(ownDetails = false, type = 'panel') {
  const parent = node('candidate', { __jsonui_preview_collection_name: 'custom_dropdown', collection_index: 0 },
    [node('child-label', {}, [], [radioRead, details], 'child-label', 'label')],
    [radioRead, ...(ownDetails ? [details] : [])], 'candidate', type);
  return evaluate(parent, { collectionData: { custom_dropdown: [{ '#custom_radio_text': '3' }] } });
}
test('candidate parent context warning distinguishes Drawned failure shape from repaired shape', () => {
  const missing = radioFixture(false), fixed = radioFixture(true);
  assert.equal(missing.propsById.candidate.text, '3', 'inspectable preview does not imply native correctness');
  assert(missing.warnings.some(value => value.startsWith('COLLECTION_DETAILS_LOCAL_CONTEXT_UNCONFIRMED:')));
  assert.equal(summarizeCollectionQuality(missing).status, 'unknown');
  assert(!fixed.warnings.some(value => value.startsWith('COLLECTION_DETAILS_LOCAL_CONTEXT_UNCONFIRMED:')));
  assert.equal(summarizeCollectionQuality(fixed).status, 'passed');
  assert(!radioFixture(false, 'button').warnings.some(value => value.startsWith('COLLECTION_DETAILS_LOCAL_CONTEXT_UNCONFIRMED:')),
    'do not impose a blanket requirement on all collection readers');
});

test('hidden dropdown options retain their original collection indices', () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({ '#custom_radio_text': String(index) }));
  const candidates = rows.map((_, index) => node(`option-${index}`, {
    __jsonui_preview_collection_name: 'custom_dropdown', collection_index: index, visible: index === 3,
  }, [], [radioRead, details]));
  const result = evaluate(node('root', {}, candidates), { collectionData: { custom_dropdown: rows } });
  assert.equal(result.propsById['option-3'].text, '3');
  assert.equal(result.propsById['option-3'].collection_index, 3);
});

test('partial node scan cannot report complete binding or collection evidence', () => {
  const root = node('root', {}, [node('first'), node('second')]);
  const partial = evaluate(root, { maxNodes: 1 });
  assert.equal(partial.observationCaptureComplete, false);
  assert(partial.warnings.some(value => value.startsWith('BINDING_NODE_SCAN_LIMIT:')));
  assert.equal(summarizeBindingQuality(partial).status, 'unknown');
  assert.equal(summarizeCollectionQuality(partial).status, 'unknown');
  const exact = evaluate(root, { maxNodes: 3 });
  assert.equal(exact.observationCaptureComplete, true);
  assert(!exact.warnings.some(value => value.startsWith('BINDING_NODE_SCAN_LIMIT:')));
});

test('observed passive focus errors are diagnosed without banning native input controls', () => {
  for (const type of ['panel', 'image']) {
    assert.deepEqual(knownUnsupportedPreviewProperties41(type, { focus_enabled: false }), ['focus_enabled']);
    assert.deepEqual(knownUnsupportedPreviewProperties41(type, {}), []);
  }
  for (const type of ['button', 'toggle', 'input_panel', 'dropdown'])
    assert.deepEqual(knownUnsupportedPreviewProperties41(type, { focus_enabled: true }), []);
});
