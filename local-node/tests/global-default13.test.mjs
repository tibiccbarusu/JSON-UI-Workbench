import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

// Run: node --test local-node/tests/global-default13.test.mjs
async function project(globals, variables = {}) {
  const documents = {
    'ui/_global_variables.json': JSON.stringify(globals),
    'ui/example.json': JSON.stringify({ namespace: 'example', base: { type: 'panel' }, root: {
      type: 'factory', control_ids: '$ids', size: ['$width', 10],
      controls: [{ label: { type: 'label', text: '$caption' } }],
    } }),
  };
  const catalog = await buildUiCatalog({ parseJsonc, sources: [{ id: 'pack', kind: 'imported', precedence: 20,
    filePaths: Object.keys(documents), readText: async path => documents[path] }] });
  const before = JSON.stringify(catalog.globalVariables);
  const record = catalog.records.find(item => item.qualifiedName === 'example.root');
  const result = resolveEffectiveUi({ catalog, recordId: record.id, variables });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(JSON.stringify(catalog.globalVariables), before, 'global原文由来の値を変更しない');
  return { catalog, record, result, root: JSON.parse(JSON.stringify(result.document.root)) };
}

test('global default: 既定値のみのobject・数値・文字列を表示と参照走査で同じように解釈する', async () => {
  const { root, record, result } = await project({ '$ids|default': { spawn: '@example.base' },
    '$width|default': 40, '$caption|default': '既定の表示' });
  assert.deepEqual(record.references, ['example.base']);
  assert.deepEqual(root.control_ids, { spawn: '@example.base' });
  assert.deepEqual(root.size, [40, 10]);
  assert.equal(root.controls[0].label.text, '既定の表示');
  assert.equal(result.diagnostics.some(item => item.code === 'UI_VARIABLE_UNRESOLVED'), false);
});

test('global default: exactは記載順によらずdefaultより優先する', async () => {
  for (const globals of [
    { '$width': 80, '$width|default': 40 },
    { '$width|default': 40, '$width': 80 },
  ]) {
    const { root } = await project({ '$ids': { spawn: '@example.base' }, '$caption': '表示', ...globals });
    assert.deepEqual(root.size, [80, 10]);
  }
});

test('global default: 呼出側指定を保ちglobalの別名と偽値を欠落扱いしない', async () => {
  const { root } = await project({ '$ids|default': '$alias', '$alias|default': { spawn: '@example.base' },
    '$width|default': 40, '$caption|default': false }, { '$width': 0 });
  assert.deepEqual(root.control_ids, { spawn: '@example.base' });
  assert.deepEqual(root.size, [0, 10]);
  assert.equal(root.controls[0].label.text, false);
});
