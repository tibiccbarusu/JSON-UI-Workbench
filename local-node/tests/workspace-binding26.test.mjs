import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiScreenModelFromJson, uiScreenModelToJson } from '../../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsForUiModel } from '../../editor-core/src/bindings/bindings-evaluator.js';

const path = 'ui/bindingfix.json';
const holderId = 'root/screen/holder';
const mockData = { '#gate': false };
const base = { binding_name: '#gate', binding_name_override: '#visible' };
const documentOf = (bindings) => ({ namespace: 'bindingfix', screen: { type: 'screen', controls: [
  { holder: { type: 'panel', visible: true, bindings } },
] } });
const modelOf = (bindings) => buildUiScreenModelFromJson(documentOf(bindings), { filePath: path });
const evaluate = (bindings) => evaluateBindingsForUiModel(modelOf(bindings), { mockData });
const diagnostics = (result) => result.warnings.filter((x) => x.startsWith('BINDING_TYPE_UNSUPPORTED:'))
  .map((x) => JSON.parse(x.slice('BINDING_TYPE_UNSUPPORTED:'.length)));
const counts = (result) => [result.stats.bindingsSeen, result.stats.bindingsApplied, result.stats.bindingsSkipped];

test('BF-01: 未知文字列と数値型は原型を保持し、推測実行せず警告付きで1件skipする', () => {
  for (const binding_type of ['globla', 17]) {
    const model = modelOf([{ ...base, binding_type }]);
    const result = evaluateBindingsForUiModel(model, { mockData });
    assert.equal(result.propsById[holderId].visible, true);
    assert.deepEqual(counts(result), [1, 0, 1]);
    assert.deepEqual(diagnostics(result), [{ file_path: path, node_id: holderId, binding_index: 0,
      value_type: typeof binding_type, value: binding_type, value_truncated: false }]);
    assert.equal(uiScreenModelToJson(model).screen.controls[0].holder.bindings[0].binding_type, binding_type);
  }
});

test('BF-02: 省略・global・従来の大小文字/空白・空文字列の既定動作を維持する', () => {
  for (const extension of [{}, { binding_type: 'global' }, { binding_type: ' GLOBAL ' }, { binding_type: '' }]) {
    const result = evaluate([{ ...base, ...extension }]);
    assert.equal(result.propsById[holderId].visible, false);
    assert.deepEqual(counts(result), [1, 1, 0]);
    assert.deepEqual(result.warnings, []);
  }
});

test('BF-03: noneとignoredは無警告でskipし、binding_condition noneはglobalを停止しない', () => {
  const inactive = evaluate([{ ...base, binding_type: 'none' }, { ...base, binding_type: 'globla', ignored: true }]);
  assert.equal(inactive.propsById[holderId].visible, true);
  assert.deepEqual(counts(inactive), [2, 0, 2]);
  assert.deepEqual(inactive.warnings, []);
  const cadence = evaluate([{ ...base, binding_type: 'global', binding_condition: 'none' }]);
  assert.equal(cadence.propsById[holderId].visible, false);
  assert.deepEqual(counts(cadence), [1, 1, 0]);
});

test('BF-04: 直接モデルの非文字列とJSON由来null/配列/オブジェクトを省略型と混同しない', () => {
  for (const binding_type of [17, null, [], {}]) {
    const directModel = modelOf([{ ...base }]);
    directModel.root.children[0].children[0].bindings[0].binding_type = binding_type;
    const direct = evaluateBindingsForUiModel(directModel, { mockData });
    const built = evaluate([{ ...base, binding_type }]);
    for (const result of [direct, built]) {
      assert.equal(result.propsById[holderId].visible, true);
      assert.deepEqual(counts(result), [1, 0, 1]);
      assert.equal(diagnostics(result).length, 1);
    }
    assert.equal(diagnostics(direct)[0].value_type, diagnostics(built)[0].value_type);
  }
});

test('BF-05: 大量の未知型は警告詳細64件+打切り1件に制限し全70件をskip計数する', () => {
  const value = 'unknown\n'.repeat(200);
  const result = evaluate(Array.from({ length: 70 }, () => ({ ...base, binding_type: value })));
  assert.equal(result.propsById[holderId].visible, true);
  assert.deepEqual(counts(result), [70, 0, 70]);
  assert.equal(diagnostics(result).length, 64);
  assert.equal(result.warnings.filter((x) => x.startsWith('BINDING_TYPE_WARNING_LIMIT:')).length, 1);
  assert(result.warnings.every((x) => x.length < 1000 && !x.includes('\n')));
  assert.equal(diagnostics(result)[0].value.length, 160);
  assert.equal(diagnostics(result)[0].value_truncated, true);
});

// 読込と書出しも同じ判定を使い、評価時だけの警告に閉じ込めない。
const { inspectWorkspace } = await import('../workspace-edit.mjs');
const { planWorkspaceExport } = await import('../workspace-export.mjs');
const { manifest } = await import('./fixtures.mjs');
function exportOptions(document, rawKey = 'screen') {
  const files = { 'manifest.json': manifest, [path]: JSON.stringify(document, null, 2) };
  return { sources: [{ id: 'b', kind: 'imported', paths: Object.keys(files),
    async readText(key) { return files[key]; }, async readBytes(key) { return Buffer.from(files[key]); } }],
  selections: [{ filePath: path, rawKey }] };
}

test('BF-06: 読込検査が未知型の原文位置/型を記録し、修正可能な読込とプレビューを保持', () => {
  const document = documentOf([{ ...base, binding_type: 17 }]);
  const source = JSON.stringify(document, null, 2), result = inspectWorkspace({ documents: { [path]: source } });
  assert.equal(result.ok, true); assert.equal(result.previewAllowed, true);
  const warning = result.diagnostics.find(item => item.code === 'EDIT_BINDING_TYPE_UNSUPPORTED');
  assert.equal(warning.severity, 'warning'); assert.equal(warning.value, 17); assert.equal(warning.value_type, 'number');
  assert.equal(warning.pointer, '/screen/controls/0/holder/bindings/0/binding_type');
  assert.equal(source.slice(warning.location.offset, warning.location.offset + 2), '17');
  assert.equal(warning.location.line, source.slice(0, warning.location.offset).split('\n').length);
});

test('BF-07: 選択したUI閉包だけに書出し警告を記録し、原文値を保持して書出し可能', async () => {
  const document = { ...documentOf([{ binding_type: 'globla' }]),
    unused: { type: 'panel', bindings: [{ binding_type: 17 }] } };
  const options = exportOptions(document), before = JSON.stringify(document);
  const result = await planWorkspaceExport(options);
  assert.equal(result.ok, true, JSON.stringify(result));
  const warnings = result.plan.warnings.filter(item => item.code === 'EXPORT_BINDING_TYPE_UNSUPPORTED');
  assert.equal(warnings.length, 1); assert.equal(warnings[0].value, 'globla');
  assert.equal(warnings[0].jsonPath, '/screen/controls/0/holder/bindings/0/binding_type');
  assert.equal(JSON.stringify(document), before);
});

test('BF-08: 既知型/省略/ignoredと未使用の変数データを新たに警告しない', async () => {
  const document = documentOf([{ binding_type: 'none' }, {}, { binding_type: 17, ignored: true }]);
  document.screen.$record = { bindings: [{ binding_type: 'globla' }] };
  const result = inspectWorkspace({ documents: { [path]: JSON.stringify(document) } });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.some(item => item.code === 'EDIT_BINDING_TYPE_UNSUPPORTED'), false);
  const exported = await planWorkspaceExport(exportOptions(document));
  assert.equal(exported.ok, true, JSON.stringify(exported));
  assert.equal(exported.plan.warnings.some(item => item.code === 'EXPORT_BINDING_TYPE_UNSUPPORTED'), false);
});

test('BF-09: 2,100件の未知bindingでも追加診断を64件+打切り1件へ制限し読込を停止しない', async () => {
  const document = documentOf(Array.from({ length: 2100 }, () => ({ binding_type: 17 })));
  const imported = inspectWorkspace({ documents: { [path]: JSON.stringify(document) } });
  assert.equal(imported.ok, true, JSON.stringify(imported)); assert.equal(imported.previewAllowed, true);
  assert.equal(imported.diagnostics.filter(item => item.code === 'EDIT_BINDING_TYPE_UNSUPPORTED').length, 64);
  assert.equal(imported.diagnostics.filter(item => item.code === 'EDIT_BINDING_TYPE_WARNING_LIMIT').length, 1);
  const exported = await planWorkspaceExport(exportOptions(document));
  assert.equal(exported.ok, true, JSON.stringify(exported));
  assert.equal(exported.plan.warnings.filter(item => item.code === 'EXPORT_BINDING_TYPE_UNSUPPORTED').length, 64);
  assert.equal(exported.plan.warnings.filter(item => item.code === 'EXPORT_BINDING_TYPE_WARNING_LIMIT').length, 1);
});

test('BF-10: 原文のbinding_type変数/式は未知固定型と誤認せず、評価時未解決だけ別診断にする', async () => {
  for (const binding_type of ['$close_button_visible_collection_details', '#runtime_kind', "($binding_kind)"]) {
    const document = documentOf([{ ...base, binding_type }]);
    const inspected = inspectWorkspace({ documents: { [path]: JSON.stringify(document) } });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.diagnostics.some(item => item.code === 'EDIT_BINDING_TYPE_UNSUPPORTED'), false);
    const exported = await planWorkspaceExport(exportOptions(document));
    assert.equal(exported.plan.warnings.some(item => item.code === 'EXPORT_BINDING_TYPE_UNSUPPORTED'), false);
    const result = evaluate([{ ...base, binding_type }]);
    assert.equal(result.warnings.some(item => item.startsWith('BINDING_TYPE_UNSUPPORTED:')), false);
    assert.equal(result.warnings.filter(item => item.startsWith('BINDING_TYPE_UNRESOLVED:')).length, 1);
    assert.deepEqual(counts(result), [1, 0, 1]);
  }
});
