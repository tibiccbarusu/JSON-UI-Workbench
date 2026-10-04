import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

async function catalogFor(documents, limits) {
  return buildUiCatalog({ parseJsonc, ...(limits ? { limits } : {}), sources: documents.map((document, index) => ({
    id: `source${index}`, kind: index ? 'imported' : 'vanilla', precedence: index,
    filePaths: ['ui/a.json'], readText: async () => JSON.stringify(document),
  })) });
}
const base = { namespace: 'x', target: { type: 'panel' }, factory_base: { type: 'factory' } };
const recordOf = (catalog, name = 'x.host') => catalog.records.find(record => record.qualifiedName === name);
function incomplete(catalog, name = 'x.host') {
  assert.equal(recordOf(catalog, name).referenceScanComplete, false);
  assert(catalog.diagnostics.some(item => item.definition === recordOf(catalog, name).rawKey
    && item.reasons.some(reason => reason.startsWith('factory-type-'))));
}

test('catalog factory: 型を単段・多段・子要素で継承するcontrol_nameを参照へ含める', async () => {
  const cases = [
    { 'host@x.factory_base': { control_name: '@x.target' } },
    { 'middle@x.factory_base': {}, 'host@x.middle': { control_name: '@x.target' } },
    { host: { type: 'panel', controls: [{ 'spawn@x.factory_base': { control_name: '@x.target' } }] } },
  ];
  for (const body of cases) {
    const catalog = await catalogFor([{ ...base, ...body }]);
    assert(recordOf(catalog).references.includes('x.target'), JSON.stringify(body));
    assert.equal(recordOf(catalog).referenceScanComplete, true);
    const projection = resolveEffectiveUi({ catalog, recordId: recordOf(catalog).id });
    assert.equal(projection.ok, true);
    const factory = projection.document.host.controls?.[0]?.spawn || projection.document.host;
    assert.equal(factory.type, 'factory');
    assert.equal(factory.control_name, '@x.target');
  }
});

test('catalog factory: 明示非factory・binding・modifications選択子のcontrol_nameは参照へ含めない', async () => {
  const cases = [
    { 'host@x.factory_base': { type: 'panel', control_name: '@x.target' } },
    { host: { type: 'panel', bindings: [{ binding_type: 'view', control_name: '@x.target' }] } },
    { host: { type: 'panel', modifications: [{ array_name: 'controls', operation: 'remove', control_name: '@x.target' }] } },
  ];
  for (const body of cases) {
    const catalog = await catalogFor([{ ...base, ...body }]);
    assert.equal(recordOf(catalog).references.includes('x.target'), false);
    assert.equal(recordOf(catalog).referenceScanComplete, true);
  }
});

test('catalog factory: 実際に追加されるmodifications内の継承要素は追跡する', async () => {
  const catalog = await catalogFor([{ ...base, host: { type: 'panel', modifications: [{ array_name: 'controls',
    operation: 'insert_back', value: { 'spawn@x.factory_base': { control_name: '@x.target' } } }] } }]);
  assert(recordOf(catalog).references.includes('x.target'));
  assert.equal(recordOf(catalog).referenceScanComplete, true);
});

test('catalog factory: 動的type・動的継承・欠落基底は候補確定せず不完全を診断する', async () => {
  for (const body of [
    { host: { type: '$runtime_type', control_name: '@x.target' } },
    { host: { type: '(#runtime_type)', control_name: '@x.target' } },
    { 'host@$runtime_base': { control_name: '@x.target' } },
    { 'host@x.missing': { control_name: '@x.target' } },
    { factory_base: { type: '$runtime_type' }, 'host@x.factory_base': { control_name: '@x.target' } },
  ]) {
    const catalog = await catalogFor([{ ...base, ...body }]);
    incomplete(catalog);
    assert.equal(recordOf(catalog).references.includes('x.target'), false);
  }
});

test('catalog factory: 字句scopeはcontrol_nameの変数に適用する', async () => {
  const catalog = await catalogFor([{ ...base, other: { type: 'panel' }, host: { type: 'panel', $pick: '@x.target',
    controls: [{ 'spawn@x.factory_base': { '$pick|default': '@x.other', control_name: '$pick' } }] } }]);
  assert(recordOf(catalog).references.includes('x.target'));
  assert.equal(recordOf(catalog).references.includes('x.other'), false);
});

test('catalog factory: 異なる呼出しscopeの候補をキャッシュで取り違えない', async () => {
  const catalog = await catalogFor([{ ...base, other: { type: 'panel' },
    'template@x.factory_base': { control_name: '$pick' }, host: { type: 'panel', controls: [
      { 'one@x.template': { $pick: '@x.target' } }, { 'two@x.template': { $pick: '@x.other' } },
    ] } }]);
  assert(recordOf(catalog).references.includes('x.target'));
  assert(recordOf(catalog).references.includes('x.other'));
  assert.equal(recordOf(catalog).referenceScanComplete, true);
});

test('catalog factory: 同名の下位自己継承から固定型を得る', async () => {
  const catalog = await catalogFor([{ ...base, host: { type: 'factory' } },
    { namespace: 'x', 'host@x.host': { control_name: '@x.target' } }]);
  const top = catalog.records.find(record => record.sourceId === 'source1');
  assert(top.references.includes('x.target'));
  assert.equal(top.referenceScanComplete, true);
});

test('catalog factory: 型継承の循環・深さ超過は不完全として停止する', async () => {
  const cycle = await catalogFor([{ ...base, 'host@x.middle': { control_name: '@x.target' }, 'middle@x.host': {} }]);
  incomplete(cycle);
  const body = { ...base, 'host@x.a': { control_name: '@x.target' }, 'a@x.b': {}, 'b@x.c': {}, 'c@x.factory_base': {} };
  const deep = await catalogFor([body], { maxScanDepth: 2 });
  incomplete(deep);
});
