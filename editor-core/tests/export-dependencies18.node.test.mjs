import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// The optional baseline is a local immutable release path used only to record
// pre-fix failures of the exact same assertions; no authored code is executed.
const { scanJsonForExportDeps, EXPORT_ANIMATION_REFERENCES } = await import(process.env.JSONUI_EXPORT_SCANNER_BASELINE
  ? pathToFileURL(process.env.JSONUI_EXPORT_SCANNER_BASELINE).href
  : '../src/pack-io/export-dependencies.js');

function scan(value, options = {}) {
  const output = { outUiJsonRefs: new Set(), outTextureRefs: new Set(), outFontRefs: new Set(),
    outLangKeys: new Set(), outUiSymbolRefs: new Set(), outNativeRenderers: [], outDiagnostics: [] };
  const result = scanJsonForExportDeps({ value, ...output, ...options });
  return { ...result, ...output };
}
function record(name, value, rawKey = name) {
  return { id: name, rawKey, qualifiedName: `sample.${name}`, namespace: 'sample', value, filePath: `ui/${name}.json` };
}
function compose(value, base, options = {}) {
  return scan(value, { rootNamespace: 'sample', rootAuthoredKey: 'screen@sample.base', rootRecordId: 'screen',
    resolveUiSymbolCandidates: name => name === 'sample.base' ? [record('base', base)] : [], ...options });
}

test('replaced inherited controls and scalar assets do not become export dependencies', () => {
  const visited = [];
  const result = compose({ texture: 'textures/ui/new', controls: [{ shown: { texture: 'textures/ui/visible' } }] },
    { texture: 'textures/ui/replaced', controls: [{ 'old@sample.missing': { texture: '$unused' } }] },
    { resolveUiSymbolCandidates: name => { visited.push(name); return name === 'sample.base' ? [record('base',
      { texture: 'textures/ui/replaced', controls: [{ 'old@sample.missing': { texture: '$unused' } }] })] : []; } });
  assert.deepEqual([...result.outTextureRefs].sort(), ['textures/ui/new', 'textures/ui/visible']);
  assert.deepEqual(visited, ['sample.base']);
  assert.equal(result.outDiagnostics.length, 0);
});

test('base default variables reach replacement controls authored on the derived control', () => {
  const result = compose({ controls: [{ label: { texture: '$icon' } }] }, { '$icon|default': 'textures/ui/base' });
  assert.deepEqual([...result.outTextureRefs], ['textures/ui/base']);
  assert.equal(result.outDiagnostics.length, 0);
});

test('inherited localize false remains literal when derived text changes', () => {
  const result = compose({ text: 'literal.with.dots' }, { type: 'label', localize: false, text: 'old.literal' });
  assert.equal(result.outLangKeys.size, 0);
  const nested = compose({ controls: { label: { text: 'literal.with.dots' } } },
    { controls: { label: { type: 'label', localize: false, text: 'old.literal' } } });
  assert.equal(nested.outLangKeys.size, 0);
});

test('an inherited child and a derived child retain separate lexical overrides', () => {
  const result = compose({ controls: { custom: { '$icon': 'textures/ui/custom', texture: '$icon' } } },
    { '$icon|default': 'textures/ui/base', controls: { inherited: { texture: '$icon' } } });
  assert.deepEqual([...result.outTextureRefs].sort(), ['textures/ui/base', 'textures/ui/custom']);
});

test('deep merged child properties retain inherited child-local declarations', () => {
  const result = compose({ controls: { child: { texture: '$icon' } } },
    { controls: { child: { '$icon|default': 'textures/ui/base_child', type: 'image', texture: 'textures/ui/old' } } });
  assert.deepEqual([...result.outTextureRefs], ['textures/ui/base_child']);
  assert.equal(result.outDiagnostics.length, 0);
});

test('derived child-local variables override an inherited child asset without retaining its replaced value', () => {
  const result = compose({ controls: { child: { '$icon': 'textures/ui/new' } } },
    { controls: { child: { '$icon': 'textures/ui/old', type: 'image', texture: '$icon' } } });
  assert.deepEqual([...result.outTextureRefs], ['textures/ui/new']);
  assert.equal(result.outDiagnostics.length, 0);
});

test('deep child variables retain caller precedence through three inheritance records', () => {
  const records = { 'sample.middle': record('middle', { controls: { child: { '$icon': 'textures/ui/middle' } } }, 'middle@sample.base'),
    'sample.base': record('base', { controls: { child: { '$icon|default': 'textures/ui/old', type: 'image', texture: '$icon' } } }) };
  const result = scan({ controls: { child: { '$icon': 'textures/ui/new' } } }, {
    rootAuthoredKey: 'screen@sample.middle', resolveUiSymbolCandidates: name => records[name] ? [records[name]] : [] });
  assert.deepEqual([...result.outTextureRefs], ['textures/ui/new']);
  assert.equal(result.outDiagnostics.length, 0);
});

test('inherited child scope transfers cannot hide an unbound variable in a sibling instance', () => {
  const records = { 'sample.base': record('base', { controls: { leaf: { texture: '$required' } } }, 'base@sample.parent'),
    'sample.parent': record('parent', { type: 'panel' }) };
  const result = scan({ controls: [
    { 'first@sample.base': { '$required': 'textures/ui/first', controls: { leaf: { offset: [1, 0] } } } },
    { 'second@sample.base': { controls: { leaf: { offset: [2, 0] } } } },
  ] }, { resolveUiSymbolCandidates: name => records[name] ? [records[name]] : [] });
  assert(result.outDiagnostics.some(item => item.reference === '$required' && item.reason === 'missing-variable'));
});

test('unused variable declarations are not treated as assets or UI controls', () => {
  const result = scan({ '$unused_texture': '#unknown', '$unused': { 'child@missing.control': { texture: '$bad' } },
    '$active': 'textures/ui/used', texture: '$active' });
  assert.deepEqual([...result.outTextureRefs], ['textures/ui/used']);
  assert.equal(result.outUiSymbolRefs.size, 0);
  assert.equal(result.outDiagnostics.length, 0);
});

test('variable-backed replacement controls are traversed where they are consumed', () => {
  const result = compose({ '$children': [{ image: { texture: '$icon' } }], controls: '$children' },
    { '$icon|default': 'textures/ui/real', controls: [{ hidden: { texture: '$bad' } }] });
  assert.deepEqual([...result.outTextureRefs], ['textures/ui/real']);
  assert.equal(result.outDiagnostics.length, 0);
});

test('finite conditional variable-backed controls include every possible asset', () => {
  const result = scan({ '$children': [{ image: { texture: 'textures/ui/a' } }],
    variables: [{ requires: '$runtime_flag', '$children': [{ image: { texture: 'textures/ui/b' } }] }], controls: '$children' });
  assert.deepEqual([...result.outTextureRefs].sort(), ['textures/ui/a', 'textures/ui/b']);
});

test('empty asset values are valid while empty UI template references remain unresolved', () => {
  const empty = scan({ '$empty': '', text: '$empty', texture: '$empty' });
  assert.equal(empty.outDiagnostics.length, 0);
  assert.equal(empty.outTextureRefs.size, 0);
  const invalid = scan({ '$empty': '', grid_item_template: '$empty' });
  assert(invalid.outDiagnostics.some(item => item.code === 'EXPORT_UI_SYMBOL_DYNAMIC' && item.reason === 'empty-value'));
});

test('persistent lexical scopes avoid work proportional to globals times local controls', () => {
  const rootVariables = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`$global_${index}`, `value_${index}`]));
  const controls = Array.from({ length: 300 }, (_, index) => ({ [`row_${index}`]: { '$image': `textures/ui/image_${index}`, texture: '$image' } }));
  const result = scan({ controls }, { rootVariables, limits: { maxEnvironmentEntries: 2_000 } });
  assert.equal(result.complete, true);
  assert.equal(result.outTextureRefs.size, 300);
  assert(result.stats.environmentEntries <= 2_000);
  const bounded = scan({ controls }, { rootVariables, limits: { maxEnvironmentEntries: 1_100 } });
  assert.equal(bounded.complete, false);
  assert(bounded.limitReasons.includes('lexical environment work'));
});

test('factory resolver context identifies exact authored engine events without affecting inheritance', () => {
  const calls = [];
  scan({ controls: [{ popup_dialog_factory: { type: 'factory', control_ids: { storage_dependency_popup: '@sample.popup' } } }] },
    { sourcePath: 'ui/common.json', rootRecordId: 'screen-panel', resolveUiSymbolCandidates: (name, context) => { calls.push({ name, context }); return []; } });
  assert.deepEqual(calls, [{ name: 'sample.popup', context: { property: 'control_ids', controlId: 'storage_dependency_popup',
    ownerKey: 'popup_dialog_factory', sourcePath: 'ui/common.json', recordId: 'screen-panel' } }]);
});

test('merged factory control_ids preserve inherited entries and replace matching entries', () => {
  const result = compose({ type: 'factory', control_ids: { replace: '@sample.new' } },
    { type: 'factory', control_ids: { keep: '@sample.keep', replace: '@sample.old' } });
  assert.deepEqual([...result.outUiSymbolRefs].sort(), ['sample.base', 'sample.keep', 'sample.new']);
});

test('native renderer dependency records retain bounded binding evidence', () => {
  const result = scan({ renderer: 'inventory_item_renderer', bindings: [{ binding_name: '#item_renderer_data',
    binding_type: 'collection', binding_collection_name: 'inventory_items', unused: 'not copied' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(result.outNativeRenderers[0].props.bindings)), [{ binding_name: '#item_renderer_data',
    binding_type: 'collection', binding_collection_name: 'inventory_items' }]);
});

test('native renderer bindings expand finite variables and reject exhausted work', () => {
  const value = { renderer: 'inventory_item_renderer', '$collection': 'inventory_items',
    variables: [{ requires: '$runtime', '$collection': 'hotbar_items' }],
    bindings: [{ binding_name: '#item_renderer_data', binding_type: 'collection', binding_collection_name: '$collection' }] };
  const result = scan(value);
  assert.deepEqual(result.outNativeRenderers[0].props.bindings.map(binding => binding.binding_collection_name).sort(), ['hotbar_items', 'inventory_items']);
  const limited = scan(value, { limits: { maxNativeBindingEntries: 1 } });
  assert.equal(limited.complete, false);
});

test('internal animation edges permit next loops while authored lookalikes cannot bypass UI-cycle checks', () => {
  const animation = record('loop', { anim_type: 'alpha' });
  animation.value.__export_animation_refs = { control_ids: { next: '@sample.loop' } };
  if (typeof EXPORT_ANIMATION_REFERENCES === 'symbol') Object.defineProperty(animation.value.__export_animation_refs, EXPORT_ANIMATION_REFERENCES, { value: true });
  const result = scan({ anim: { control_ids: { alpha: '@sample.loop' } } }, { resolveUiSymbolCandidates: () => [animation] });
  assert.equal(result.dependencyClosureComplete, true);
  const forged = record('loop', JSON.parse(JSON.stringify(animation.value)));
  const invalid = scan({ anim: { control_ids: { alpha: '@sample.loop' } } }, { resolveUiSymbolCandidates: () => [forged] });
  assert.equal(invalid.dependencyClosureComplete, false);
});

test('true required dynamic assets, aliases, and recursive composition fail closed', () => {
  const dynamic = scan({ texture: '$missing' });
  assert(dynamic.outDiagnostics.some(item => item.reason === 'missing-variable'));
  const alias = scan({ '$a': '$b', '$b': '$a', texture: '$a' });
  assert(alias.outDiagnostics.some(item => item.reason === 'variable-cycle'));
  const records = { 'sample.a': record('a', {}, 'a@sample.b'), 'sample.b': record('b', {}, 'b@sample.a') };
  const cycle = scan({}, { rootAuthoredKey: 'screen@sample.a', resolveUiSymbolCandidates: name => records[name] ? [records[name]] : [] });
  assert.equal(cycle.dependencyClosureComplete, false);
  assert(cycle.outDiagnostics.some(item => item.reason === 'composition-cycle'));
});

test('base diagnostics identify their real source file', () => {
  const result = compose({}, { texture: '$required' }, { sourcePath: 'ui/screen.json' });
  assert.equal(result.outDiagnostics.find(item => item.reference === '$required').sourcePath, 'ui/base.json');
});
