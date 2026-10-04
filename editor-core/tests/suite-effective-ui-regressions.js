import { assert, assertDeepEqual, assertEqual, test } from './test-harness.js';
import { buildUiCatalog } from '../src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../src/json/jsonc.js';

test('catalog syntax diagnostics retain available source positions and isolate malformed files', async () => {
  const source = makeSource({
    'ui/broken.json': null,
    'ui/healthy.json': { namespace: 'healthy', root: { type: 'screen' } },
  });
  const readText = source.readText;
  source.readText = (path) => path === 'ui/broken.json'
    ? Promise.resolve('{"namespace":"broken",\n"root": ]}') : readText(path);
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc });
  const diagnostic = catalog.diagnostics.find((item) => item.code === 'UI_CATALOG_PARSE_FAILED');
  assert(diagnostic);
  assertEqual(diagnostic.filePath, 'ui/broken.json');
  assert(diagnostic.message.includes('ui/broken.json'));
  const parserError = parseJsonc(await source.readText('ui/broken.json'), { fileName: 'ui/broken.json' }).errors[0];
  assertEqual(diagnostic.parseErrors[0].line, parserError.line);
  assertEqual(diagnostic.parseErrors[0].column, parserError.column);
  assertEqual(diagnostic.parseErrors[0].offset, parserError.offset);
  assert(Number.isSafeInteger(diagnostic.parseErrors[0].offset));
  assertEqual(diagnostic.omittedParseErrors, 0);
  assert(catalog.records.some((item) => item.qualifiedName === 'healthy.root'));
});

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text), errors: [] };
  } catch (error) {
    return { ok: false, value: null, errors: [{ message: String(error.message || error) }] };
  }
}

function makeSource(docs) {
  return {
    id: 'effective-regressions',
    kind: 'imported',
    precedence: 20,
    filePaths: Object.keys(docs),
    async readText(path) {
      if (!Object.prototype.hasOwnProperty.call(docs, path)) throw new Error('PACK_NOT_FOUND');
      return JSON.stringify(docs[path]);
    },
  };
}

async function resolveNamed(document, localName, options = {}) {
  const catalog = await buildUiCatalog({
    sources: [makeSource({ 'ui/effective-regressions.json': document })],
    parseJsonc: parseJson,
  });
  const record = catalog.records.find((item) => item.localName === localName);
  assert(record, `Expected record ${localName}`);
  const result = resolveEffectiveUi({ catalog, recordId: record.id, ...options });
  assert(result.ok, result.error ? result.error.code : `Expected ${localName} to resolve`);
  return { result, value: result.document[localName] };
}

function makeAliasChain(prefix, referenceCount, terminal) {
  const variables = Object.create(null);
  for (let index = 0; index < referenceCount; index += 1) {
    variables[`$${prefix}_${index}`] = index === referenceCount - 1
      ? terminal
      : `$${prefix}_${index + 1}`;
  }
  return variables;
}

test('static requirements resolve deep aliases to the bounded legacy limit and fail closed', async () => {
  const screen = {
    type: 'panel',
    ...makeAliasChain('seven', 7, true),
    ...makeAliasChain('eight', 8, true),
    ...makeAliasChain('thirty_one', 31, true),
    ...makeAliasChain('thirty_two', 32, true),
    ...makeAliasChain('false_thirty_two', 32, false),
    ...makeAliasChain('too_deep', 33, true),
    '$cycle_a': '$cycle_b',
    '$cycle_b': '$cycle_a',
    '$namespaced:alias': '$forwarded@alias',
    '$forwarded@alias': true,
    '$seven_result|default': 'fallback',
    '$eight_result|default': 'fallback',
    '$thirty_one_result|default': 'fallback',
    '$orientation|default': 'fallback',
    '$size|default': [1, 1],
    '$offset|default': [0, 0],
    '$screen_content|default': 'fallback',
    '$negative_result|default': 'fallback',
    '$false_result|default': 'fallback',
    '$missing_result|default': 'fallback',
    '$cycle_result|default': 'fallback',
    '$too_deep_result|default': 'bounded',
    '$extended_name_result|default': 'fallback',
    '$hash_result|default': 'fallback',
    variables: [
      { requires: '$seven_0', '$seven_result': 'matched' },
      { requires: '$eight_0', '$eight_result': 'matched' },
      { requires: '$thirty_one_0', '$thirty_one_result': 'matched' },
      {
        requires: '($thirty_two_0 and (not $false_thirty_two_0))',
        '$orientation': 'horizontal',
        '$size': [32, 16],
        '$offset': [4, 8],
        '$screen_content': 'deep-content',
      },
      { requires: 'not $false_thirty_two_0', '$negative_result': 'matched' },
      { requires: '$false_thirty_two_0', '$false_result': 'incorrect' },
      { requires: '$missing', '$missing_result': 'incorrect' },
      { requires: '$cycle_a', '$cycle_result': 'incorrect' },
      { requires: '$too_deep_0', '$too_deep_result': 'incorrect' },
      { requires: '$namespaced:alias', '$extended_name_result': 'matched' },
      { requires: '#static_flag', '$hash_result': 'matched' },
    ],
    seven_result: '$seven_result',
    eight_result: '$eight_result',
    thirty_one_result: '$thirty_one_result',
    orientation: '$orientation',
    size: '$size',
    offset: '$offset',
    screen_content: '$screen_content',
    negative_result: '$negative_result',
    false_result: '$false_result',
    missing_result: '$missing_result',
    cycle_result: '$cycle_result',
    too_deep_result: '$too_deep_result',
    extended_name_result: '$extended_name_result',
    hash_result: '$hash_result',
    visible: 'not $false_thirty_two_0',
  };
  const { value } = await resolveNamed({ namespace: 'static_alias', screen }, 'screen', {
    variables: { '#static_flag': true },
  });

  assertEqual(value.seven_result, 'matched');
  assertEqual(value.eight_result, 'matched');
  assertEqual(value.thirty_one_result, 'matched');
  assertEqual(value.orientation, 'horizontal');
  assertDeepEqual(value.size, [32, 16]);
  assertDeepEqual(value.offset, [4, 8]);
  assertEqual(value.screen_content, 'deep-content');
  assertEqual(value.negative_result, 'matched');
  assertEqual(value.visible, true);
  assertEqual(value.false_result, 'fallback');
  assertEqual(value.missing_result, 'fallback');
  assertEqual(value.cycle_result, 'fallback');
  assertEqual(value.too_deep_result, 'bounded');
  assertEqual(value.extended_name_result, 'matched');
  assertEqual(value.hash_result, 'matched');
});

test('static alias evaluation remains bounded with a large unrelated variable scope', async () => {
  const unrelatedVariables = Object.fromEntries(Array.from(
    { length: 20_000 },
    (_, index) => [`$unrelated_${index}`, index],
  ));
  const screen = {
    type: 'panel',
    ...unrelatedVariables,
    ...makeAliasChain('stress', 32, true),
    '$matched|default': -1,
    variables: Array.from({ length: 256 }, (_, index) => ({
      requires: '$stress_0',
      '$matched': index,
    })),
    matched: '$matched',
  };
  const startedAt = performance.now();
  const { value } = await resolveNamed({ namespace: 'static_alias_stress', screen }, 'screen');
  const elapsedMs = performance.now() - startedAt;

  assertEqual(value.matched, 255);
  // This is intentionally generous for shared CI runners while still catching
  // the former per-requirement cloning of all 20,000 lexical variables.
  assert(elapsedMs < 5_000, `Large lexical scope took ${String(Math.round(elapsedMs))}ms`);
});

test('derived exact variables select a dynamic record base and drive its conditional values', async () => {
  const document = {
    namespace: 'dynamic_exact',
    a: {
      type: 'panel', marker: 'A', size: [10, 11], offset: [1, 2], orientation: 'vertical',
    },
    b: {
      type: 'stack_panel', marker: 'B', size: [20, 21], offset: [3, 4], orientation: 'horizontal',
    },
    'wrapper@$target': {
      '$target': 'dynamic_exact.a',
      '$conditional|default': 'fallback',
      variables: [{ requires: '$target = "dynamic_exact.b"', '$conditional': 'derived-match' }],
      selected_target: '$target',
      conditional: '$conditional',
    },
    'screen@dynamic_exact.wrapper': { '$target': 'dynamic_exact.b' },
  };
  const { result, value } = await resolveNamed(document, 'screen');

  assertEqual(value.type, 'stack_panel');
  assertEqual(value.marker, 'B');
  assertDeepEqual(value.size, [20, 21]);
  assertDeepEqual(value.offset, [3, 4]);
  assertEqual(value.orientation, 'horizontal');
  assertEqual(value.selected_target, 'dynamic_exact.b');
  assertEqual(value.conditional, 'derived-match');
  assertEqual(value.$target, 'dynamic_exact.b');
  assert(!result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND'));
});

test('derived conditional overrides can depend on variables declared by their resolved base', async () => {
  const document = {
    namespace: 'dynamic_base_context',
    a: {
      type: 'panel', marker: 'A', size: [10, 11], offset: [1, 2], orientation: 'vertical',
    },
    b: {
      type: 'stack_panel', marker: 'B', size: [20, 21], offset: [3, 4], orientation: 'horizontal',
    },
    'wrapper@$target': {
      '$target': 'dynamic_base_context.a',
      '$use_b': true,
      selected_target: '$target',
    },
    'screen@dynamic_base_context.wrapper': {
      '$conditional|default': 'fallback',
      variables: [{
        requires: '$use_b',
        '$target': 'dynamic_base_context.b',
        '$conditional': 'base-context-match',
      }],
      conditional: '$conditional',
    },
  };
  const { result, value } = await resolveNamed(document, 'screen');

  assertEqual(value.type, 'stack_panel');
  assertEqual(value.marker, 'B');
  assertDeepEqual(value.size, [20, 21]);
  assertDeepEqual(value.offset, [3, 4]);
  assertEqual(value.orientation, 'horizontal');
  assertEqual(value.selected_target, 'dynamic_base_context.b');
  assertEqual(value.conditional, 'base-context-match');
  assert(!result.diagnostics.some((item) => item.code === 'UI_VARIABLE_BASE_FIXPOINT_LIMIT'));
});

test('conditional requirements do not feed their previous branch output back into themselves', async () => {
  const document = {
    namespace: 'branch_feedback',
    core: {
      type: 'panel',
      '$enabled|default': true,
      '$binding_name|default': '',
      '$binding_type|default': 'global',
      variables: [{
        requires: '(not $enabled or not $binding_name)',
        '$binding_name': '#not_data_bound',
        '$binding_type': 'none',
      }],
      binding_name: '$binding_name',
      binding_type: '$binding_type',
    },
    'screen@branch_feedback.core': {},
  };
  const { result, value } = await resolveNamed(document, 'screen');
  assertEqual(value.binding_name, '#not_data_bound');
  assertEqual(value.binding_type, 'none');
  assert(!result.diagnostics.some((item) => item.code === 'UI_VARIABLE_BASE_FIXPOINT_LIMIT'));
});

test('unresolved variables below a statically inactive control are outside current-view diagnostics', async () => {
  const document = {
    namespace: 'inactive_diagnostics',
    screen: {
      type: 'screen',
      text: '$active_missing',
      controls: [{ hidden: {
        type: 'panel', ignored: true,
        controls: [{ leaf: { type: 'label', text: '$inactive_missing' } }],
      } }],
    },
  };
  const { result } = await resolveNamed(document, 'screen');
  const unresolved = result.diagnostics.filter((item) => item.code === 'UI_VARIABLE_UNRESOLVED');
  assertDeepEqual(unresolved.map((item) => item.variable), ['$active_missing']);
});

test('base-dependent conditional oscillation is bounded and keeps only the final speculative path', async () => {
  const document = {
    namespace: 'dynamic_fixpoint_bound',
    a: { type: 'panel', marker: 'A', '$use_b': true },
    b: { type: 'stack_panel', marker: 'B', '$use_b': false },
    'screen@$target': {
      '$target|default': 'dynamic_fixpoint_bound.a',
      variables: [{ requires: '$use_b', '$target': 'dynamic_fixpoint_bound.b' }],
    },
  };
  const { result, value } = await resolveNamed(document, 'screen');

  assertEqual(value.marker, 'B');
  assert(result.diagnostics.some((item) => (
    item.code === 'UI_VARIABLE_BASE_FIXPOINT_LIMIT' && item.maximum === 8
  )));
  assert(result.provenance.some((item) => item.qualifiedName === 'dynamic_fixpoint_bound.b'));
  assert(!result.provenance.some((item) => item.qualifiedName === 'dynamic_fixpoint_bound.a'));
});

test('dynamic record priority distinguishes exact, default, conditional, and self-forwarded values', async () => {
  const document = {
    namespace: 'dynamic_priority',
    a: { type: 'panel', marker: 'A', size: [10, 10] },
    b: { type: 'panel', marker: 'B', size: [20, 20] },
    c: { type: 'panel', marker: 'C', size: [30, 30] },
    'default_wrapper@$target': { '$target|default': 'dynamic_priority.a' },
    'default_screen@dynamic_priority.default_wrapper': {},
    'exact_wrapper@$target': { '$target': 'dynamic_priority.a', selected_target: '$target' },
    'default_caller@dynamic_priority.exact_wrapper': { '$target|default': 'dynamic_priority.b' },
    'middle@dynamic_priority.exact_wrapper': { '$target': 'dynamic_priority.b' },
    'derived@dynamic_priority.middle': { '$target': 'dynamic_priority.c' },
    'forwarder@dynamic_priority.exact_wrapper': { '$target': '$target' },
    'conditional@dynamic_priority.exact_wrapper': {
      '$use_b': true,
      variables: [{ requires: '$use_b', '$target': 'dynamic_priority.b' }],
    },
    'local_exact@dynamic_priority.exact_wrapper': { '$target': 'dynamic_priority.c' },
  };

  assertEqual((await resolveNamed(document, 'default_screen')).value.marker, 'A');
  assertEqual((await resolveNamed(document, 'default_caller')).value.marker, 'A');

  const derived = (await resolveNamed(document, 'derived')).value;
  assertEqual(derived.marker, 'C');
  assertDeepEqual(derived.size, [30, 30]);
  assertEqual(derived.selected_target, 'dynamic_priority.c');

  const forwarded = (await resolveNamed(document, 'forwarder', {
    variables: { '$target': 'dynamic_priority.b' },
  })).value;
  assertEqual(forwarded.marker, 'B');
  assertEqual(forwarded.selected_target, 'dynamic_priority.b');

  const unresolvedForward = await resolveNamed(document, 'forwarder');
  assertEqual(unresolvedForward.value.marker, undefined);
  assert(unresolvedForward.result.diagnostics.some((item) => (
    item.code === 'UI_DYNAMIC_BASE_UNRESOLVED' && item.reason === 'VARIABLE_CYCLE'
  )));

  assertEqual((await resolveNamed(document, 'conditional')).value.marker, 'B');
  assertEqual((await resolveNamed(document, 'local_exact', {
    variables: { '$target': 'dynamic_priority.b' },
  })).value.marker, 'C');
});

test('dynamic child bases receive only exact and explicitly forwarded child overrides', async () => {
  const document = {
    namespace: 'dynamic_child',
    a: { type: 'panel', marker: 'A', size: [10, 10] },
    b: { type: 'panel', marker: 'B', size: [20, 20] },
    'wrapper@$target': { '$target': 'dynamic_child.a', selected_target: '$target' },
    screen: {
      type: 'screen',
      '$target': 'dynamic_child.b',
      controls: [
        { 'exact@dynamic_child.wrapper': { '$target': 'dynamic_child.b' } },
        { 'forwarded@dynamic_child.wrapper': { '$target': '$target' } },
        { 'defaulted@dynamic_child.wrapper': { '$target|default': 'dynamic_child.b' } },
      ],
    },
  };
  const { value } = await resolveNamed(document, 'screen');
  const [exact, forwarded, defaulted] = value.controls;

  assertEqual(exact.exact.marker, 'B');
  assertEqual(exact.exact.selected_target, 'dynamic_child.b');
  assertEqual(forwarded.forwarded.marker, 'B');
  assertEqual(forwarded.forwarded.selected_target, 'dynamic_child.b');
  assertEqual(defaulted.defaulted.marker, 'A');
  assertEqual(defaulted.defaulted.selected_target, 'dynamic_child.a');
});

test('provably inactive derived children do not resolve dynamic bases or descendants', async () => {
  const document = {
    namespace: 'inactive_dynamic',
    base: { type: 'panel', size: [10, 10] },
    screen: {
      type: 'screen',
      '$inactive': true,
      controls: [
        { 'hidden@inactive_dynamic.base': {
          ignored: '$inactive',
          controls: [{ 'nested@$missing_base': {} }],
        } },
        { 'binding_capable@inactive_dynamic.base': {
          ignored: true,
          bindings: [{ binding_type: 'global', binding_name: '#runtime', binding_name_override: '#ignored' }],
          controls: [{ 'nested@$missing_base': {} }],
        } },
      ],
    },
  };
  const { result, value } = await resolveNamed(document, 'screen');
  assertEqual(value.controls[0].hidden.ignored, true);
  const unresolved = result.diagnostics.filter((item) => item.code === 'UI_DYNAMIC_BASE_UNRESOLVED');
  assertEqual(unresolved.length, 1);
  assertEqual(unresolved[0].baseRef, '$missing_base');
});

test('child conditional overrides can depend on variables declared by their resolved base', async () => {
  const document = {
    namespace: 'dynamic_child_base_context',
    a: { type: 'panel', marker: 'A', size: [10, 10] },
    b: { type: 'stack_panel', marker: 'B', size: [20, 20] },
    'wrapper@$target': {
      '$target': 'dynamic_child_base_context.a',
      '$use_b': true,
      selected_target: '$target',
    },
    screen: {
      type: 'screen',
      controls: [{
        'child@dynamic_child_base_context.wrapper': {
          variables: [{ requires: '$use_b', '$target': 'dynamic_child_base_context.b' }],
        },
      }],
    },
  };
  const { result, value } = await resolveNamed(document, 'screen');
  const child = value.controls[0].child;

  assertEqual(child.type, 'stack_panel');
  assertEqual(child.marker, 'B');
  assertDeepEqual(child.size, [20, 20]);
  assertEqual(child.selected_target, 'dynamic_child_base_context.b');
  assert(!result.diagnostics.some((item) => item.code === 'UI_VARIABLE_BASE_FIXPOINT_LIMIT'));
});

test('dynamic child exact overrides survive merged base conditional declarations', async () => {
  const document = {
    namespace: 'dynamic_child_conditional',
    a: { type: 'panel', marker: 'A', size: [10, 10] },
    b: { type: 'panel', marker: 'B', size: [20, 20] },
    wrapper: {
      type: 'panel',
      '$target|default': 'dynamic_child_conditional.a',
      variables: [{ requires: true, '$target': 'dynamic_child_conditional.a' }],
      base_seen: '$target',
    },
    screen: {
      type: 'screen',
      controls: [{
        'child@dynamic_child_conditional.wrapper': {
          '$target': 'dynamic_child_conditional.b',
          controls: [{ 'nested@$target': {} }],
        },
      }],
    },
  };
  const { value } = await resolveNamed(document, 'screen');
  const child = value.controls[0].child;

  assertEqual(child.base_seen, 'dynamic_child_conditional.b');
  assertEqual(child.controls[0].nested.marker, 'B');
  assertDeepEqual(child.controls[0].nested.size, [20, 20]);
});

test('array modifications compose binding patches across pack layers and preserve authored sources', async () => {
  const baseDocument = {
    namespace: 'binding_patch',
    screen: { type: 'label', text: '#text', bindings: [{ binding_name: '#original', binding_name_override: '#text' }] },
  };
  const patchDocument = {
    namespace: 'binding_patch',
    screen: { modifications: [
      { array_name: 'bindings', operation: 'insert_after', where: { binding_name: '#original' }, value: { binding_name: '#replacement', binding_name_override: '#text' } },
      { array_name: 'bindings', operation: 'insert_back', value: { binding_type: 'view', source_property_name: "(#text = '日本語')", target_property_name: '#visible' } },
    ] },
  };
  const before = JSON.stringify(baseDocument);
  const catalog = await buildUiCatalog({ sources: [
    { ...makeSource({ 'ui/patch.json': baseDocument }), id: 'base', precedence: 10 },
    { ...makeSource({ 'ui/patch.json': patchDocument }), id: 'patch', precedence: 20 },
  ], parseJsonc: parseJson });
  const record = catalog.records.find(item => item.sourceId === 'patch' && item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok);
  assertEqual(result.document.screen.bindings.length, 3);
  assertEqual(result.stats.appliedModifications, 2);
  const { buildUiScreenModelFromJson } = await import('../src/model/ui-screen-model.js');
  const { evaluateBindingsForUiModel } = await import('../src/bindings/bindings-evaluator.js');
  const model = buildUiScreenModelFromJson(result.document, { filePath: 'ui/patch.json' });
  const bindings = evaluateBindingsForUiModel(model, { mockData: { '#original': 'old', '#replacement': '日本語' } });
  const screen = model.root.children.find(node => node.key.local_name === 'screen');
  assertEqual(bindings.propsById[screen.id].text, '日本語');
  assertEqual(bindings.propsById[screen.id].visible, true);
  assertEqual(JSON.stringify(baseDocument), before);
});

test('relative insert and stable move modifications preserve sequence and inherited controls', async () => {
  const { result, value } = await resolveNamed({ namespace: 'array_order', screen: {
    type: 'panel', controls: [{ a: { type: 'label', text: 'A' } }, { b: { type: 'label', text: 'B' } }],
    modifications: [
      { operation: 'insert_before', control_name: 'b', value: { x: { type: 'label', text: 'X' } } },
      { array_name: 'controls', operation: 'insert_after', where: { control_name: 'a' }, value: { y: { type: 'label', text: 'Y' } } },
      { array_name: 'controls', operation: 'move_front', value: { b: {} } },
      { array_name: 'controls', operation: 'move_back', control_name: 'a' },
    ],
  } }, 'screen');
  assertDeepEqual(value.controls.map(item => Object.keys(item)[0]), ['b', 'y', 'x', 'a']);
  assertEqual(value.controls[0].b.text, 'B');
  assertEqual(value.controls[3].a.text, 'A');
  assertEqual(result.stats.appliedModifications, 4);
});

test('binding and button mapping selectors require explicit scalar equality and reject broad selectors', async () => {
  const { result, value } = await resolveNamed({ namespace: 'selector_guard', screen: {
    type: 'button', bindings: [{ binding_name: '#a', ignored: false }, { binding_name: '#b', ignored: true }],
    button_mappings: [{ from_button_id: 'button.a', to_button_id: 'button.b', mapping_type: 'pressed' }],
    modifications: [
      { array_name: 'bindings', operation: 'move_front', where: { binding_name: '#b', ignored: true } },
      { array_name: 'bindings', operation: 'remove', where: { ignored: false } },
      { array_name: 'bindings', operation: 'remove', where: {} },
      { array_name: 'bindings', operation: 'remove', where: { binding_name: ['#b'] } },
      { array_name: 'button_mappings', operation: 'replace', where: { from_button_id: 'button.a' }, value: { from_button_id: 'button.x', to_button_id: 'button.y' } },
      { array_name: '__proto__', operation: 'insert_back', value: { polluted: true } },
    ],
  } }, 'screen');
  assertDeepEqual(value.bindings, [{ binding_name: '#b', ignored: true }]);
  assertEqual(value.button_mappings[0].to_button_id, 'button.y');
  assertEqual(result.stats.appliedModifications, 3);
  assertEqual(result.stats.unsupportedModifications, 3);
  assertEqual({}.polluted, undefined);
});

test('modification work budget stops before an operation and leaves source arrays intact', async () => {
  const { result, value } = await resolveNamed({ namespace: 'mod_budget', screen: {
    type: 'panel', bindings: [{ binding_name: '#a' }, { binding_name: '#b' }, { binding_name: '#c' }],
    modifications: [
      { array_name: 'bindings', operation: 'move_back', where: { binding_name: '#a' } },
      { array_name: 'bindings', operation: 'remove', where: { binding_name: '#b' } },
    ],
  } }, 'screen', { limits: { maxModificationMatchOperations: 3 } });
  assertDeepEqual(value.bindings.map(item => item.binding_name), ['#b', '#c', '#a']);
  assertEqual(result.stats.appliedModifications, 1);
  assert(result.diagnostics.some(item => item.code === 'UI_MODIFICATION_SKIPPED' && item.reason === 'MATCH_OPERATION_LIMIT'));
});

test('modification insertion preserves authored namespaces through multiple files', async () => {
  const catalog = await buildUiCatalog({ sources: [makeSource({
    'ui/base.json': { namespace: 'mod_base', label: { type: 'label', text: 'base' }, screen: { type: 'panel', controls: [{ original: { type: 'panel' } }] } },
    'ui/derived.json': { namespace: 'mod_derived', label: { type: 'label', text: 'derived' }, 'screen@mod_base.screen': { modifications: [
      { array_name: 'controls', operation: 'insert_after', control_name: 'original', value: { 'inserted@label': {} } },
    ] } },
  })], parseJsonc: parseJson });
  const record = catalog.records.find(item => item.qualifiedName === 'mod_derived.screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok);
  assertEqual(result.document.screen.controls[1].inserted.text, 'derived');
});

test('catalog follows namespaced variables used in inherited templates', async () => {
  const catalog = await buildUiCatalog({ sources: [makeSource({ 'ui/reference_vars.json': {
    namespace: 'var_names', a: { type: 'panel' }, b: { type: 'panel' },
    wrapper: { '$mod:target|default': 'var_names.a', controls: [{ 'inner@$mod:target': {} }] },
    'screen@var_names.wrapper': { '$mod:target': 'var_names.b' },
  } })], parseJsonc: parseJson });
  const screen = catalog.records.find(item => item.localName === 'screen');
  assert(screen.references.includes('var_names.b'));
  const result = resolveEffectiveUi({ catalog, recordId: screen.id });
  assert(result.ok);
  assertEqual(result.document.screen.controls[0].inner.type, 'panel');
});

test('registered UI files outside ui directories and custom extensions remain selectable', async () => {
  const catalog = await buildUiCatalog({ sources: [makeSource({
    'ui/_ui_defs.json': { ui_defs: ['screens/custom.data', 'screens/components.json', 'ui/regular.json'] },
    'screens/custom.data': { namespace: 'registered_external', 'screen@registered_components.base': { text: '外部登録' }, alternate: { type: 'panel' } },
    'screens/components.json': { namespace: 'registered_components', base: { type: 'label', text: 'base' } },
    'ui/regular.json': { namespace: 'regular', screen: { type: 'panel' } },
    'screens/unregistered.json': { namespace: 'registered_external', screen: { type: 'panel', text: 'wrong' } },
  })], parseJsonc: parseJson });
  const screen = catalog.records.find(item => item.qualifiedName === 'registered_external.screen');
  assert(screen);
  assertEqual(catalog.records.filter(item => item.filePath === 'screens/custom.data').length, 2);
  assert(!catalog.records.some(item => item.filePath === 'screens/unregistered.json'));
  const result = resolveEffectiveUi({ catalog, recordId: screen.id });
  assert(result.ok);
  assertEqual(result.document.screen.type, 'label');
  assertEqual(result.document.screen.text, '外部登録');
});

test('syntax-only reference pruning retains variable factory alternatives and inherited edges', async () => {
  const catalog = await buildUiCatalog({ sources: [makeSource({ 'ui/reference_pruning.json': {
    namespace: 'pruned_refs', a: { type: 'panel', texture: 'not.a.reference' }, b: { type: 'panel' }, c: { type: 'panel' },
    wrapper: { '$target|default': 'pruned_refs.a', '$ids|default': { only: '@pruned_refs.b' },
      controls: [{ 'child@$target': {} }, { factory_holder: { type: 'panel', factory: { name: 'dynamic', control_ids: '$ids' } } }],
    },
    'screen@pruned_refs.wrapper': { '$target': 'pruned_refs.c', '$ids': { only: '@pruned_refs.c' } },
  } })], parseJsonc: parseJson });
  const screen = catalog.records.find(item => item.localName === 'screen');
  assert(screen.referenceScanComplete);
  assert(screen.references.includes('pruned_refs.wrapper'));
  assert(screen.references.includes('pruned_refs.c'));
  assert(!screen.references.includes('not.a.reference'));
});

test('reference scanning records direct dependencies in later files before inherited expansion consumes its budget', async () => {
  const controls = Array.from({ length: 25 }, (_, index) => ({ [`instance_${index}@fair_context.wrapper`]: { '$target': 'fair_context.a' } }));
  const catalog = await buildUiCatalog({ sources: [makeSource({
    'ui/a_heavy.json': { namespace: 'fair_context', a: { type: 'panel' }, wrapper: { controls: [{ 'child@$target': {} }] }, screen: { type: 'panel', controls } },
    'ui/z_simple.json': { namespace: 'fair_later', 'screen@fair_context.a': { type: 'panel' } },
  })], parseJsonc: parseJson, limits: { maxReferenceNodesTotal: 200 } });
  const later = catalog.records.find(item => item.qualifiedName === 'fair_later.screen');
  assert(later.references.includes('fair_context.a'));
  assert(later.referenceScanComplete, 'An unrelated direct reference should not be starved by an earlier expansion');
});

test('Vanilla arithmetic layer expressions resolve through nested expression variables before layout', async () => {
  const { result, value } = await resolveNamed({ namespace: 'vanilla_layer', screen: {
    type: 'panel', size: [40, 40], '$sidebar_layer': 300, '$baseLayer': '($sidebar_layer + 100)',
    controls: [
      { progress: { type: 'panel', size: [20, 20], layer: '($baseLayer + 1)' } },
      { overlay: { type: 'panel', size: [20, 20], layer: '($sidebar_layer + 10)' } },
    ],
  } }, 'screen');
  assertEqual(value.controls[0].progress.layer, 401);
  assertEqual(value.controls[1].overlay.layer, 310);
  const {buildUiScreenModelFromJson}=await import('../src/model/ui-screen-model.js');
  const {buildTreeFromUiScreenModel}=await import('../src/editor/ui-model-tree.js');
  const {computeLayoutBoxesForFile,compareCanvasPaintOrder}=await import('../src/preview/canvas-preview.js');
  const layout=computeLayoutBoxesForFile(buildTreeFromUiScreenModel(buildUiScreenModelFromJson(result.document,{filePath:'ui/vanilla_layer.json'})),{width:40,height:40});
  const progress=layout.boxes.find(box=>box.id.endsWith('/progress'));
  const overlay=layout.boxes.find(box=>box.id.endsWith('/overlay'));
  assert(progress&&overlay);
  assert(compareCanvasPaintOrder(progress,overlay)>0);
});

test('unresolved runtime cyclic and nonnumeric layer expressions preserve input and emit bounded diagnostics', async () => {
  const { result, value } = await resolveNamed({ namespace: 'layer_guards', screen: {
    type: 'panel', '$a': '($b + 1)', '$b': '($a + 1)',
    controls: [
      { runtime: { type: 'panel', layer: '(#native_layer + 1)' } },
      { cycle: { type: 'panel', layer: '($a + 1)' } },
      { text: { type: 'panel', layer: "('layer' + 1)" } },
      { executable: { type: 'panel', layer: '(globalThis.bad = 1)' } },
      { malformed: { type: 'panel', layer: '($missing + 1' } },
    ],
  } }, 'screen');
  assertEqual(value.controls[0].runtime.layer, '(#native_layer + 1)');
  assertEqual(value.controls[1].cycle.layer, '($a + 1)');
  assertEqual(value.controls[2].text.layer, "('layer' + 1)");
  assertEqual(value.controls[3].executable.layer, '(globalThis.bad = 1)');
  assertEqual(globalThis.bad, undefined);
  assertEqual(value.controls[4].malformed.layer, '($missing + 1');
  assertEqual(result.diagnostics.filter(item=>item.code==='UI_PROPERTY_EXPRESSION_UNRESOLVED').length,5);
});


test('inherited arithmetic layers use derived exact variables and preserve source templates', async () => {
  const catalog = await buildUiCatalog({ sources: [makeSource({
    'ui/layers_base.json': { namespace: 'layer_base', template: { type: 'panel', '$baseLayer|default': 2, layer: '($baseLayer + 1)' } },
    'ui/layers_custom.json': { namespace: 'layer_custom', 'screen@layer_base.template': { '$baseLayer': 20 } },
  })], parseJsonc: parseJson });
  const base = catalog.records.find(item => item.qualifiedName === 'layer_base.template');
  const selected = catalog.records.find(item => item.qualifiedName === 'layer_custom.screen');
  const before = JSON.stringify(base.value);
  const result = resolveEffectiveUi({ catalog, recordId: selected.id });
  assert(result.ok);
  assertEqual(result.document.screen.layer, 21);
  assertEqual(JSON.stringify(base.value), before);
  const resolvedBase = resolveEffectiveUi({ catalog, recordId: base.id });
  assertEqual(resolvedBase.document.template.layer, 3);
});
