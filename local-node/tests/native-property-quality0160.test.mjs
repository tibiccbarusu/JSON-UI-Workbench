import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { validateUiScreenModel } from '../../editor-core/src/validation/validator.js';
import { knownUnsupportedPreviewProperties41, summarizeNativePropertyQuality } from '../../editor-core/src/preview/native-property-diagnostics41.js';
import { runCli } from '../cli.mjs';
import { makeZip, manifest } from './fixtures.mjs';

const build = root => buildUiScreenModelFromJson({ namespace: 'native0160', root }, { filePath: 'ui/test.json' });
const observe = root => validateUiScreenModel(build(root));
const propertyWarnings = result => result.issues.filter(row => row.code === 'NATIVE_PROPERTY_UNSUPPORTED');

test('validation records known native rejections without treating future or interactive properties as invalid', () => {
  const source = build({ type: 'panel', controls: [
    { label: { type: 'label', vertical_alignment: 'center', future_field: 'retain' } },
    { image: { type: 'image', focus_enabled: false } },
    { button: { type: 'button', focus_enabled: true } },
    { toggle: { type: 'toggle', focus_enabled: true } },
  ] });
  const before = JSON.stringify(source), validation = validateUiScreenModel(source);
  assert.equal(validation.ok, true, 'warnings preserve draft rendering and round-trip inspection');
  assert.deepEqual(propertyWarnings(validation).map(row => row.propKey).sort(), ['focus_enabled', 'vertical_alignment']);
  const quality = summarizeNativePropertyQuality({ validation });
  assert.equal(quality.status, 'failed'); assert.equal(quality.diagnostic_count, 2);
  assert.equal(quality.native_parity_verified, false); assert.equal(quality.exhaustive_native_schema_verified, false);
  assert.equal(JSON.stringify(source), before);
});

test('exact supplied Expedition decorative-parent collection error is visible before a frame request', () => {
  const source = { type: 'collection_panel', collection_name: 'rows', controls: [
    { good: { type: 'panel', collection_index: 0 } },
    { decoration: { type: 'panel', controls: [{ bad: { type: 'panel', collection_index: 1 } }] } },
  ] };
  const warnings = propertyWarnings(observe(source));
  assert.equal(warnings.length, 1); assert.equal(warnings[0].propKey, 'collection_index');
  assert.match(warnings[0].message, /below panel/u);
  assert.equal(summarizeNativePropertyQuality({ validation: observe(source) }).status, 'failed');
  assert.equal(propertyWarnings(observe({ type: 'panel', collection_index: 0 })).length, 0,
    'a standalone template has no concrete instantiation parent');
});

test('reused native-invalid child names retain distinct concrete paths', () => {
  const branch = () => ({ type: 'panel', controls: [{ caption: {
    type: 'label', vertical_alignment: 'center',
  } }] });
  const validation = observe({ type: 'panel', controls: [{ left: branch() }, { right: branch() }] });
  const warnings = propertyWarnings(validation);
  assert.equal(warnings.length, 2);
  assert.equal(new Set(warnings.map(row => row.nodeId)).size, 2);
  assert.equal(summarizeNativePropertyQuality({ validation }).diagnostic_count, 2);
});

test('structurally ignored branches are inactive but a merely hidden bad native field remains diagnosed', () => {
  const ignored = { type: 'panel', ignored: true, focus_enabled: true,
    controls: [{ bad: { type: 'label', vertical_alignment: 'center' } }] };
  assert.equal(propertyWarnings(observe(ignored)).length, 0);
  assert.equal(summarizeNativePropertyQuality({ validation: observe(ignored) }).status, 'passed');
  const visibleFalse = { type: 'label', visible: false, vertical_alignment: 'center' };
  assert.equal(propertyWarnings(observe(visibleFalse)).length, 1);
});

test('effective property declarations are checked and source getters are never read', () => {
  const model = build({ type: 'label' });
  const label = model.root.children[0];
  let getterCalls = 0;
  Object.defineProperty(label.unknownProps, 'vertical_alignment', { enumerable: true,
    get() { getterCalls++; return 'center'; } });
  assert.equal(propertyWarnings(validateUiScreenModel(model)).length, 1);
  assert.equal(getterCalls, 0);
  const effective = validateUiScreenModel(build({ type: 'panel' }), {
    referenceContext: { evaluatedPropsById: { 'root/root': { focus_enabled: true } } },
  });
  assert.equal(propertyWarnings(effective).length, 1);
  assert.deepEqual(knownUnsupportedPreviewProperties41('button', { focus_enabled: true }), []);
});

test('native evidence is bounded and validation/layout observations deduplicate by actual node and property', () => {
  const root = { type: 'panel', controls: Array.from({ length: 300 }, (_, index) => ({ ['label_' + index]: {
    type: 'label', vertical_alignment: 'center',
  } })) };
  const validation = observe(root);
  assert.equal(propertyWarnings(validation).length, 256);
  assert.equal(validation.issues.filter(row => row.code === 'NATIVE_PROPERTY_DIAGNOSTIC_LIMIT').length, 1);
  const quality = summarizeNativePropertyQuality({ validation });
  assert.equal(quality.status, 'failed'); assert.equal(quality.diagnostics.length, 64);
  assert.equal(quality.omitted_diagnostics, 192); assert.equal(quality.observation_capture_complete, false);
  const one = observe({ type: 'label', vertical_alignment: 'center' });
  const deduped = summarizeNativePropertyQuality({ validation: one,
    layout: { warnings: ['LAYOUT_NATIVE_PROPERTY_UNSUPPORTED:root/root:vertical_alignment'] } });
  assert.equal(deduped.diagnostic_count, 1);
});

test('missing, malformed, or truncated evidence cannot be promoted to a passed native-property axis', () => {
  assert.equal(summarizeNativePropertyQuality().status, 'not_evaluated');
  assert.equal(summarizeNativePropertyQuality({ validation: { issues: [] } }).status, 'passed');
  assert.equal(summarizeNativePropertyQuality({ validation: { issues: [null] } }).status, 'failed');
  assert.equal(summarizeNativePropertyQuality({ layout: { warnings: [null] } }).status, 'failed');
  assert.equal(summarizeNativePropertyQuality({ layout: { warnings: ['LAYOUT_NATIVE_PROPERTY_UNSUPPORTED:'] } }).status, 'failed');
  const large = summarizeNativePropertyQuality({ layout: { warnings: Array(4097).fill('UNRELATED') } });
  assert.equal(large.status, 'unknown'); assert.equal(large.observation_capture_complete, false);
  const evidence = { issues: [] }; let called = 0;
  Object.defineProperty(evidence.issues, '0', { get() { called++; return {}; } });
  evidence.issues.length = 1;
  assert.equal(summarizeNativePropertyQuality({ validation: evidence }).status, 'failed');
  assert.equal(called, 0);
});

async function cliFixture(t, document, extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-property0160-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = path.join(dir, 'input.mcpack'), session = path.join(dir, 'session.json');
  await writeFile(archive, makeZip({ 'manifest.json': manifest,
    'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/test.json', ...Object.keys(extra)] }),
    'ui/test.json': JSON.stringify(document), ...extra }));
  await runCli(['import', '--session', session, '--pack', archive]);
  return { dir, args: ['--session', session, '--file', 'ui/test.json', '--definition', document.namespace + '.root'] };
}

test('strict validate and JSON/SVG/PNG preview block a native-invalid inherited property before output', async t => {
  const { dir, args } = await cliFixture(t, { namespace: 'native0160', root: { type: 'panel', size: [32, 32],
    controls: [{ 'caption@template0160.label': {} }] } }, {
    'ui/template.json': JSON.stringify({ namespace: 'template0160', label: { type: 'label', text: 'A',
      localize: false, size: [16, 16], vertical_alignment: 'center' } }),
  });
  const ordinary = await runCli(['validate', ...args]);
  assert.equal(ordinary.ok, true); assert.equal(ordinary.result.quality.native_properties.status, 'failed');
  assert(ordinary.result.validation.issues.some(row => row.code === 'NATIVE_PROPERTY_UNSUPPORTED'));
  await assert.rejects(runCli(['validate', ...args, '--strict-semantics']), { code: 'CLI_NATIVE_PROPERTY_GATE_FAILED' });
  const draft = await runCli(['preview', ...args]);
  assert.equal(draft.result.quality.native_properties.status, 'failed');
  for (const format of ['json', 'svg', 'png']) {
    const output = path.join(dir, 'blocked.' + format);
    await assert.rejects(runCli(['preview', ...args, '--strict-semantics', '--format', format, '--out', output]),
      { code: 'CLI_NATIVE_PROPERTY_GATE_FAILED' });
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});

test('strict validate catches supplied native collection error and preview retains its documented collection gate', async t => {
  const { args } = await cliFixture(t, { namespace: 'native0160', root: { type: 'panel', size: [32, 32],
    controls: [{ bad: { type: 'panel', collection_index: 0 } }] } });
  await assert.rejects(runCli(['validate', ...args, '--strict-semantics']), { code: 'CLI_NATIVE_PROPERTY_GATE_FAILED' });
  await assert.rejects(runCli(['preview', ...args, '--strict-semantics']), { code: 'CLI_COLLECTION_GATE_FAILED' });
});

test('default strict PNG rejects a known invalid property below a hidden ancestor and partial PNG never claims completion', async t => {
  const { dir, args } = await cliFixture(t, { namespace: 'native0160', root: { type: 'panel', size: [32, 32],
    controls: [{ hidden: { type: 'panel', visible: false, controls: [
      { caption: { type: 'label', vertical_alignment: 'center', text: 'A', size: [8, 8] } },
    ] } }] } });
  const output = path.join(dir, 'default-strict.png');
  await assert.rejects(runCli(['preview', ...args, '--format', 'png', '--out', output]),
    { code: 'CLI_NATIVE_PROPERTY_GATE_FAILED' });
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  const partial = await runCli(['preview', ...args, '--format', 'png', '--allow-partial',
    '--out', path.join(dir, 'partial.png')]);
  assert.equal(partial.result.quality.native_properties.status, 'failed');
  assert.equal(partial.result.complete, true, 'resource completeness remains separate');
  assert.equal(partial.result.preview_complete, false);
  assert.equal(partial.result.draft, true);
  assert.equal(partial.result.stage_diagnostics.native_properties.enforcement, 'observation_only');
});

test('unrelated native-invalid template and future properties do not contaminate a selected valid definition', async t => {
  const { args } = await cliFixture(t, { namespace: 'native0160',
    unused: { type: 'label', vertical_alignment: 'center' },
    root: { type: 'panel', size: [32, 32], future_property: 'preserved', controls: [
      { button: { type: 'button', focus_enabled: true, size: [8, 8] } },
    ] } });
  for (const command of ['validate', 'preview']) {
    const result = await runCli([command, ...args, '--strict-semantics']);
    assert.equal(result.result.quality.native_properties.status, 'passed');
  }
});
