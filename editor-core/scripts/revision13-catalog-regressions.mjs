import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildUiCatalog } from '../src/engine/ui-catalog.js';
import { parseJsonc } from '../src/json/jsonc.js';

const [baselineArg, reportArg] = process.argv.slice(2);
const baseline = baselineArg ? (await import(pathToFileURL(path.join(path.resolve(baselineArg), 'editor-core/src/engine/ui-catalog.js')))).buildUiCatalog : null;
const cases = [];
const options = documents => ({ sources: documents.map((document, index) => ({ id: `source${index}`, kind: index ? 'custom' : 'vanilla', precedence: index,
  filePaths: ['ui/test.json'], readText: async () => JSON.stringify(document) })), parseJsonc });
const refs = (catalog, name) => catalog.records.find(record => record.qualifiedName === name).references;
const run = async (name, check) => { const started = performance.now(); try { await check(); cases.push({ name, status: 'PASS', ms: performance.now() - started }); }
  catch (error) { cases.push({ name, status: 'FAIL', error: error.stack, ms: performance.now() - started }); } };

await run('同じ継承先を異なる局所変数で使う兄弟を分離する', async () => {
  const document = { namespace: 'x', a: {}, b: {}, template: { type: 'factory', control_name: '$target' },
    screen: { controls: [{ 'first@x.template': { '$target': 'x.a' } }, { 'second@x.template': { '$target': 'x.b' } }] } };
  const catalog = await buildUiCatalog(options([document]));
  assert.deepEqual(refs(catalog, 'x.screen'), ['x.a', 'x.b', 'x.template']);
});
await run('自己転送・既定値・条件候補・control_idsを保持する', async () => {
  const document = { namespace: 'x', a: {}, b: {}, c: {}, template: { '$target|default': 'x.a', type: 'factory', control_name: '$target' },
    'wrapper@x.template': { '$target': '$target', variables: [{ requires: '$condition', '$target': 'x.b' }] },
    screen: { '$target': 'x.c', controls: [{ 'one@x.wrapper': {} }, { factory: { control_ids: { fixed: '@x.a', dynamic: '$target' } } }] } };
  const catalog = await buildUiCatalog(options([document]));
  assert.deepEqual(refs(catalog, 'x.screen'), ['x.a', 'x.b', 'x.c', 'x.template', 'x.wrapper']);
});
await run('構造ではないtextureとtextを偽参照にしない', async () => {
  const catalog = await buildUiCatalog(options([{ namespace: 'x', a: {}, screen: { '$unused': 'x.nonexistent', texture: 'fake@x.texture', text: '@x.label', controls: [{ 'child@x.a': {} }] } }]));
  assert.deepEqual(refs(catalog, 'x.screen'), ['x.a']);
});
await run('キャッシュ後も小さい局所変数上限を検査する', async () => {
  const document = { namespace: 'x', a: {}, template: { '$created': true, type: 'factory', control_name: '$target' },
    first: { '$target': 'x.a', controls: [{ 'child@x.template': {} }] },
    second: { '$target': 'x.a', '$extra': true, controls: [{ 'child@x.template': {} }] } };
  const catalog = await buildUiCatalog({ ...options([document]), limits: { maxReferenceVariablesPerScope: 2 } });
  assert(catalog.records.find(record => record.qualifiedName === 'x.first').referenceScanComplete);
  assert(!catalog.records.find(record => record.qualifiedName === 'x.second').referenceScanComplete);
  assert(catalog.diagnostics.some(diagnostic => diagnostic.definition === 'second' && diagnostic.reasons?.includes('variables-per-scope')));
});
await run('深さ上限と共有ノード上限を完了扱いにしない', async () => {
  const document = { namespace: 'x', a: {}, screen: { '$target': 'x.a', controls: [{ factory: { control_name: '$target' } }] } };
  for (const limits of [{ maxScanDepth: 1 }, { maxReferenceNodesTotal: 1 }]) {
    const catalog = await buildUiCatalog({ ...options([document]), limits });
    assert(catalog.summary.referenceIncompleteDefinitions > 0);
    assert(catalog.diagnostics.some(diagnostic => diagnostic.code === 'UI_REFERENCE_SCAN_LIMIT'));
  }
});

let seed = 1300908;
const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
if (baseline) {
  await run('上位祖先を飛ばして選んだ下位overlayのキャッシュを別祖先に流用しない', async () => {
    const documents = [{ namespace: 'x', low: {}, high: {},
      layer: { type: 'factory', control_name: '$low' },
      template: { controls: [{ 'l@x.layer': {} }] } },
    { namespace: 'x',
      layer: { '$low': 'x.low', '$high': 'x.high', type: 'factory', control_name: '$high', controls: [{ 't@x.template': {} }] },
      screen: { '$low': 'x.low', '$high': 'x.high', controls: [{ 't@x.template': {} }] } }];
    const old = await baseline(options(documents)), current = await buildUiCatalog(options(documents));
    assert.deepEqual(refs(current, 'x.screen'), ['x.high', 'x.layer', 'x.template']);
    for (const record of old.records) assert.deepEqual(current.records.find(value => value.id === record.id).references, record.references, record.id);
  });
  await run('下位レイヤーの自己継承と循環停止を凍結版と照合する', async () => {
    const documents = [{ namespace: 'x', a: {}, b: {}, base: { type: 'factory', control_name: '$target' },
      'loop@x.peer': { '$target|default': 'x.a' }, 'peer@x.loop': { controls: [{ 'part@x.base': {} }] } },
    { namespace: 'x', 'loop@x.loop': { '$target': 'x.b' }, screen: { '$target': 'x.a', controls: [{ 'one@x.loop': {} }, { 'two@x.peer': {} }] } }];
    const old = await baseline(options(documents)), current = await buildUiCatalog(options(documents));
    for (const record of old.records) assert.deepEqual(current.records.find(value => value.id === record.id).references, record.references, record.id);
  });
  for (let index = 0; index < 160; index += 1) await run(`固定seedの継承・変数グラフ ${index + 1}`, async () => {
    const document = { namespace: 'f', leaf0: {}, leaf1: {}, leaf2: {}, template: { type: 'factory', control_name: '$target' } };
    for (let item = 0; item < 12; item += 1) {
      const value = { '$target|default': `f.leaf${random(3)}`, controls: [{ 'dynamic@f.template': { '$target': `$target` } }] };
      if (random(3) === 0) value.variables = [{ requires: '$condition', '$target': `f.leaf${random(3)}` }];
      if (item && random(2)) value.controls.push({ [`branch@f.node${random(item)}`]: { '$noise': random(8) } });
      if (item && random(3) === 0) value.controls.push({ [`other@f.node${random(item)}`]: { '$target': `f.leaf${random(3)}` } });
      document[`node${item}`] = value;
    }
    const old = await baseline(options([document])), current = await buildUiCatalog(options([document]));
    for (const record of old.records) {
      assert(record.referenceScanComplete, `fixture baseline incomplete: ${record.id}`);
      const actual = current.records.find(value => value.id === record.id);
      assert(actual.referenceScanComplete, `fixture candidate incomplete: ${record.id}`);
      assert.deepEqual(actual.references, record.references, `seed case ${index}, ${record.id}`);
    }
  });
  for (let index = 0; index < 48; index += 1) await run(`固定seedの3レイヤー・循環・局所値 ${index + 1}`, async () => {
    const documents = [];
    for (let layer = 0; layer < 3; layer += 1) {
      const document = { namespace: 'cy', leaf0: {}, leaf1: {}, leaf2: {} };
      for (let node = 0; node < 6; node += 1) {
        const value = { type: 'factory', control_name: '$pick', controls: [{ [`edge@cy.node${random(6)}`]: {} }] };
        value[random(2) ? '$pick' : '$pick|default'] = `cy.leaf${random(3)}`;
        document[`node${node}`] = value;
      }
      document.screen = { '$pick': `cy.leaf${random(3)}`, controls: [{ 'first@cy.node0': {} }, { 'second@cy.node3': {} }] };
      documents.push(document);
    }
    const old = await baseline(options(documents)), current = await buildUiCatalog(options(documents));
    for (const record of old.records) {
      assert(record.referenceScanComplete, `fixture baseline incomplete: ${record.id}`);
      const actual = current.records.find(value => value.id === record.id);
      assert(actual.referenceScanComplete, `fixture candidate incomplete: ${record.id}`);
      assert.deepEqual(actual.references, record.references, `cyclic case ${index}, ${record.id}`);
    }
  });
}
const report = { schema: 'jsonui-catalog-regressions-v1', timestamp: new Date().toISOString(), seed: 1300908,
  baseline: baselineArg || null, status: cases.every(value => value.status === 'PASS') ? 'PASS' : 'FAIL',
  passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length, cases };
if (reportArg) await fs.writeFile(reportArg, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, passed: report.passed, failed: report.failed, failures: cases.filter(value => value.status === 'FAIL') }));
if (report.failed) process.exitCode = 1;
