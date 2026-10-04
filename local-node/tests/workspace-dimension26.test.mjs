/** 0.12.1 基準の unitless 寸法回帰。Node >=22.14、実機検証ではない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isUnitlessDimensionNumber, unitlessDimensionComponents } from '../../editor-core/src/json/ui-dimension-contract.js';
import { inspectWorkspace, editWorkspace, workspaceRevision } from '../workspace-edit.mjs';
import { buildScopedEditContext, editWorkspaceScoped } from '../workspace-scoped-edit.mjs';
import { offsetAfterAuthoredMove } from '../../editor-core/src/ui/workspace-editor.js';
import { buildWorkspaceExport, planWorkspaceExport } from '../workspace-export.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { DiskZipReader } from '../disk-zip.mjs';
import { manifest } from './fixtures.mjs';
import { WorkspaceSessions } from '../workspace-session.mjs';

const path = 'ui/unitfix.json';
const pointer = '/screen/controls/0/target';
function docs(props = {}, extra = {}) {
  return { [path]: JSON.stringify({ namespace: 'u', ...extra, screen: { type: 'screen', controls: [{ target: { type: 'panel', offset: [0, 0], size: [20, 20], ...props } }] } }) };
}
async function scoped(documents, change = {}, scope = 'shared') {
  const context = await buildScopedEditContext({ documents });
  return editWorkspaceScoped({ documents, context, expectedRevision: context.revision, operation: {
    type: 'move', scope, targetMode: 'visual', path, pointer, effectivePointer: pointer,
    screen: { path, pointer: '/screen' }, delta: [1.25, -2.5], ...change,
  } });
}
function rawSet(documents, name, value) {
  return editWorkspace({ documents, expectedRevision: workspaceRevision(documents), operation: { type: 'set', path, pointer: `${pointer}/${name}`, value } });
}
function body(result) { return JSON.parse(result.documents[path]).screen.controls[0].target; }
function exportOptions(documents, rawKey = 'screen') {
  const files = { 'manifest.json': manifest, ...documents };
  return { sources: [{ id: 'u', kind: 'imported', paths: Object.keys(files),
    async readText(key) { return files[key]; }, async readBytes(key) { return Buffer.from(files[key]); } }],
  selections: [{ filePath: path, rawKey }] };
}

test('固定数値文字列だけを識別し、数値 JSON・単位・変数・式・UVを混同しない', () => {
  for (const value of ['0', '-50', '+.5', ' 12.25 ', '1e2', '1e309', '9'.repeat(1024)]) assert.equal(isUnitlessDimensionNumber(value), true);
  for (const value of [0, -50, 0.25, '12px', '50%', '50%c', '$pos', '@u.move', '(10 + 2)', '100% - 2px', '', 'NaN', 'Infinity']) assert.equal(isUnitlessDimensionNumber(value), false);
  assert.deepEqual(unitlessDimensionComponents('uv', ['1', '2']), []);
  assert.deepEqual(unitlessDimensionComponents('uv_size', ['1', '2']), []);
  assert.deepEqual(unitlessDimensionComponents('text', '12'), []);
});

for (const property of ['offset', 'size', 'min_size', 'max_size']) {
  test(`${property}: 読取りで unitless を診断し、配列・成分の属性設定を原子的に拒否`, async () => {
    const documents = docs({ [property]: ['-50', '60'] }), original = JSON.stringify(documents);
    const inspected = inspectWorkspace({ documents });
    assert.equal(inspected.ok, true, '読込みを止めず修正対象を選べる');
    const diagnostic = inspected.diagnostics.find(d => d.reason === 'DIMENSION_UNITLESS_NUMBER');
    assert(diagnostic); assert.equal(diagnostic.pointer, `${pointer}/${property}`);
    assert.equal(diagnostic.component_locations.length, 2);
    for (const value of [['1', '2'], '12', ['1e309', '0']]) {
      const raw = rawSet(documents, property, value);
      assert.equal(raw.ok, false); assert.equal(raw.code, 'EDIT_UI_PROPERTY_INVALID'); assert.equal(raw.documents, undefined);
      const selected = await scoped(documents, { type: 'set', property, value });
      assert.equal(selected.ok, false); assert.equal(selected.code, 'EDIT_UI_PROPERTY_INVALID'); assert.equal(selected.documents, undefined);
    }
    const part = rawSet(documents, `${property}/0`, '12');
    assert.equal(part.ok, false);
    assert.equal(JSON.stringify(documents), original);
  });
}

test('数値 JSON の零・負値・小数・大きい有限値は保存し、相対寸法・式は文字列のまま保持', () => {
  const documents = docs();
  for (const value of [[0, 0], [-50, 60], [-0.125, 10.375], [1e100, 100], ['50%', '100%c'], ['10px', '100% - 2px'], '$dim', '@u.move', '($width + 2)']) {
    const result = rawSet(documents, 'offset', value);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(body(result).offset, value);
  }
});

test('無限・NaN は既存境界で拒否し、桁あふれするunitless移動を保存しない', async () => {
  const documents = docs();
  for (const value of [[Infinity, 0], [NaN, 0]]) assert.equal(rawSet(documents, 'offset', value).ok, false);
  for (const value of ['1e309', '9'.repeat(1024)]) {
    const before = docs({ offset: [value, '0'] });
    const result = await scoped(before);
    assert.equal(result.ok, false); assert.equal(result.documents, undefined);
    assert.throws(() => offsetAfterAuthoredMove({ value: { offset: [value, '0'] }, dx: 1, dy: 2 }), e => e.code === 'WORKSPACE_MOVE_INVALID');
  }
});

test('今回に対応するoffset数値文字列をNodeとブラウザの両方で数値へ正規化', async () => {
  const documents = docs({ offset: ['-50', '60'] });
  const result = await scoped(documents);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(body(result).offset, [-48.75, 57.5]);
  assert.equal(result.diagnostics.some(d => d.reason === 'DIMENSION_UNITLESS_NUMBER'), false);
  assert.deepEqual(offsetAfterAuthoredMove({ value: { offset: ['-50', '60'] }, dx: 1.25, dy: -2.5 }), [-48.75, 57.5]);
});

test('指数表記と小数を修復し、px/%の指定形式を移動後も保つ', async () => {
  const migrated = await scoped(docs({ offset: ['1e2', '-.25'] }));
  assert.equal(migrated.ok, true); assert.deepEqual(body(migrated).offset, [101.25, -2.75]);
  const relative = await scoped(docs({ offset: ['50% - 2px', '10px'] }));
  assert.equal(relative.ok, true); assert.deepEqual(body(relative).offset, ['50% - 0.75px', '7.5px']);
  assert.deepEqual(offsetAfterAuthoredMove({ value: { offset: ['50% - 2px', '10px'] }, dx: 1.25, dy: -2.5 }), ['50% - 0.75px', '7.5px']);
});

test('変更した固定offsetが再投影でも数値になり、size/anchor/bindingは保存される', async () => {
  const props = { offset: ['-50', '60'], anchor_from: 'top_right', anchor_to: 'top_right', bindings: [{ binding_name: '#visible', binding_name_override: '#visible' }] };
  const result = await scoped(docs(props), {}, 'screen');
  assert.equal(result.ok, true, JSON.stringify(result));
  const context = await buildScopedEditContext({ documents: result.documents });
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: context.catalog.symbols['u.screen'].winnerId });
  assert.equal(projection.ok, true);
  const target = projection.document.screen.controls[0].target;
  assert.deepEqual(target.offset, [-48.75, 57.5]);
  assert.deepEqual(target.size, [20, 20]); assert.equal(target.anchor_from, 'top_right');
  assert.deepEqual(JSON.parse(JSON.stringify(target.bindings)), props.bindings);
});

test('JSONCコメントと非対象本文を保持し、診断の行・列が問題成分を指す', () => {
  const source = `// 先頭の説明\n{\n  "namespace": "u",\n  "screen": {"type":"screen", "controls":[{"target":{\n    "type":"panel",\n    "offset": ["-50", "60"], // この説明を保持\n    "text": "18", "size": [20,20],\n  }}]},\n}\n`;
  const documents = { [path]: source }, result = inspectWorkspace({ documents });
  const issue = result.diagnostics.find(d => d.reason === 'DIMENSION_UNITLESS_NUMBER');
  assert(issue); assert.equal(issue.component_locations[0].line, 6);
  for (const location of issue.component_locations) {
    assert.equal(source[location.offset], '"');
    assert.equal(source.slice(0, location.offset).split('\n').at(-1).length + 1, location.column);
  }
  const fixed = rawSet(documents, 'offset', [-50, 60]);
  assert.equal(fixed.ok, true); assert.equal(fixed.documents[path], source.replace('["-50", "60"]', '[\n      -50,\n      60\n    ]'));
  const parsed = parseJsonc(fixed.documents[path]); assert.equal(parsed.value.screen.controls[0].target.text, '18');
});

test('原文置換で新しい不正寸法を導入すると拒否し、明示修復は許す', () => {
  const documents = docs(), next = docs({ size: ['18', '18'] });
  const bad = editWorkspace({ documents, expectedRevision: workspaceRevision(documents), operation: { type: 'replaceText', path, text: next[path] } });
  assert.equal(bad.ok, false); assert.equal(bad.documents, undefined);
  const fixed = editWorkspace({ documents: next, expectedRevision: workspaceRevision(next), operation: { type: 'replaceText', path, text: documents[path] } });
  assert.equal(fixed.ok, true);
});

test('既存の無関係な寸法不備は診断を残すが修復用編集を妨げない', () => {
  const documents = docs({ size: ['18', '18'] });
  const result = rawSet(documents, 'offset', [2, 3]);
  assert.equal(result.ok, true); assert(result.diagnostics.some(d => d.reason === 'DIMENSION_UNITLESS_NUMBER'));
});

test('未知式・可変offset・位置animationの安全拒否を緩めない', async () => {
  const expression = await scoped(docs({ offset: ['($a + 2)', '0px'] }));
  assert.equal(expression.ok, false); assert.equal(expression.code, 'EDIT_DYNAMIC_OFFSET');
  const animated = await scoped(docs({ anims: ['@u.motion'] }, { motion: { anim_type: 'offset', from: [0, 0], to: [10, 10], duration: 1 } }));
  assert.equal(animated.ok, false); assert.equal(animated.code, 'EDIT_ANIMATED_POSITION');
  const variable = docs({ offset: '$pos' });
  const root = JSON.parse(variable[path]); root.screen['$pos'] = [1, 2]; root.screen.variables = [{ requires: '$large', '$pos': [30, 40] }];
  variable[path] = JSON.stringify(root);
  const result = await scoped(variable, { preview: { variables: { $large: false } } });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_DYNAMIC_OFFSET');
});

for (const property of ['offset', 'size', 'min_size', 'max_size']) {
  test(`${property}: 選択UIのunitlessをexport計画とZIP生成の両方で停止`, async () => {
    const options = exportOptions(docs({ [property]: ['-50', '60'] }));
    const planned = await planWorkspaceExport(options), output = await buildWorkspaceExport(options);
    assert.equal(planned.ok, false); assert.equal(output.ok, false); assert.equal(output.bytes, undefined);
    assert(planned.plan.unresolved.some(d => d.code === 'EXPORT_DIMENSION_UNITLESS' && d.property === property));
  });
}

test('別ファイルから継承する不正寸法も出力閉包で検出する', async () => {
  const documents = { [path]: JSON.stringify({ namespace: 'u', 'screen@base.shared': { type: 'screen' } }), 'ui/base.json': JSON.stringify({ namespace: 'base', shared: { type: 'panel', offset: ['-50', '60'] } }) };
  const output = await buildWorkspaceExport(exportOptions(documents, 'screen@base.shared'));
  assert.equal(output.ok, false); assert(output.plan.unresolved.some(d => d.path === 'ui/base.json' && d.code === 'EXPORT_DIMENSION_UNITLESS'));
});

test('無関係な未選択UIの不備では、正常な選択UIのexportを停止しない', async () => {
  const documents = docs({}, { unused: { type: 'panel', offset: ['1', '2'] } });
  const result = await buildWorkspaceExport(exportOptions(documents));
  assert.equal(result.ok, true, JSON.stringify(result.plan.unresolved));
});

test('修復後ZIPを再読込みし、寸法の数値型と式・UV・textの原文を確認', async () => {
  const original = docs({ offset: ['-50', '60'], min_size: ['50%', '2px'], max_size: '$limits', '$limits': [100, 100], uv: ['1', '2'], uv_size: ['3', '4'], text: '18' });
  const fixed = await scoped(original);
  assert.equal(fixed.ok, true);
  const output = await buildWorkspaceExport(exportOptions(fixed.documents));
  assert.equal(output.ok, true, JSON.stringify(output.plan.unresolved));
  const directory = await mkdtemp(join(tmpdir(), 'unitfix-')), zip = join(directory, 'candidate.mcpack');
  let pack;
  try {
    await writeFile(zip, output.bytes);
    pack = new DiskZipReader();
    await pack.openFromFile({ diskPath: zip });
    await pack.listEntries();
    const bytes = await pack.readText(path, { maxBytes: 1024 * 1024 });
    const target = JSON.parse(bytes).screen.controls[0].target;
    assert.deepEqual(target.offset, [-48.75, 57.5]); assert.deepEqual(target.min_size, ['50%', '2px']);
    assert.equal(target.max_size, '$limits'); assert.deepEqual(target.uv, ['1', '2']); assert.deepEqual(target.uv_size, ['3', '4']); assert.equal(target.text, '18');
  } finally { if (pack) await pack.close(); await rm(directory, { recursive: true, force: true }); }
});


test('既存不正パックをsessionに読み込めて、プレビュー許可を維持したまま修復できる', async () => {
  const documents = docs({ offset: ['-50', '60'] }), original = JSON.stringify(documents);
  const manager = new WorkspaceSessions({ getPack: () => ({ packPaths: Object.keys(documents), rootPrefix: '',
    zipReader: { readText: async key => documents[key] } }), checkSources: sources => sources, invalidate() {} });
  const state = await manager.open({ sources: [{ id: 'fixture', kind: 'imported' }] });
  assert.equal(state.ok, true); assert.equal(state.previewAllowed, true); assert.equal(state.workspaceValid, false);
  assert(state.diagnostics.some(d => d.reason === 'DIMENSION_UNITLESS_NUMBER'));
  const result = await manager.edit({ workspaceId: state.workspaceId, expectedRevision: state.revision,
    operation: { type: 'set', path, pointer: pointer + '/offset', value: [-50, 60] } });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.previewAllowed, true);
  assert.equal(result.diagnostics.some(d => d.reason === 'DIMENSION_UNITLESS_NUMBER'), false);
  assert.equal(JSON.stringify(documents), original, '元のパック原文は書き換えない');
});


test('任意の未使用変数データのsize/offsetキーはUI寸法と誤認しない', async () => {
  const documents = docs({ '$record': { size: '12', offset: ['1', '2'], name: 'sample' } });
  assert.equal(inspectWorkspace({ documents }).diagnostics.some(d => d.reason === 'DIMENSION_UNITLESS_NUMBER'), false);
  const updatedData = rawSet(documents, '$record/size', '24');
  assert.equal(updatedData.ok, true, JSON.stringify(updatedData));
  assert.equal(body(updatedData).$record.size, '24');
  const output = await buildWorkspaceExport(exportOptions(documents));
  assert.equal(output.ok, true, JSON.stringify(output.plan.unresolved));
});

test('controls対応表とmodificationsで導入するUIの不正寸法は停止する', async () => {
  const root = { namespace: 'u', screen: { type: 'screen', controls: { child: { type: 'panel', size: ['12', '20'] } } } };
  const map = await buildWorkspaceExport(exportOptions({ [path]: JSON.stringify(root) }));
  assert.equal(map.ok, false); assert(map.plan.unresolved.some(d => d.code === 'EXPORT_DIMENSION_UNITLESS' && d.pointer === '/screen/controls/child/size'));
  for (const array of [false, true]) {
    const change = { child: { type: 'panel', offset: ['1', '2'] } };
    const root = { namespace: 'u', screen: { type: 'screen', controls: [], modifications: [{ array_name: 'controls', operation: 'insert_back', value: array ? [change] : change }] } };
    const result = await buildWorkspaceExport(exportOptions({ [path]: JSON.stringify(root) }));
    assert.equal(result.ok, false);
    assert(result.plan.unresolved.some(d => d.code === 'EXPORT_DIMENSION_UNITLESS' && d.pointer === `/screen/modifications/0/value/${array ? '0/' : ''}child/offset`));
  }
});

test('多行文書の疎な行索引でもCRLF/Unicodeを含む寸法位置を正確に示す', () => {
  const source = '\r\n'.repeat(130) + `{"namespace":"u","screen":{"type":"screen","text":"金床","offset":["-50","60"]}}`;
  const result = inspectWorkspace({ documents: { [path]: source } });
  assert.equal(result.ok, true);
  const issue = result.diagnostics.find(item => item.reason === 'DIMENSION_UNITLESS_NUMBER');
  for (const position of issue.component_locations) {
    assert.equal(position.line, 131);
    assert.equal(position.column, source.slice(0, position.offset).split('\n').at(-1).length + 1);
    assert.equal(source[position.offset], '"');
  }
});

test('使用するliteral controls変数だけを局所・親・alias・default・文書scopeで追跡して出典を診断', async () => {
  const controls = [{ child: { type: 'panel', offset: ['12', '34'], bindings: [{ binding_type: 17 }] } }];
  const base = { namespace: 'u', screen: { type: 'screen', controls: '$children', $children: controls } };
  const variants = [base,
    { namespace: 'u', screen: { type: 'screen', $children: controls, controls: [{ host: { type: 'panel', controls: '$children' } }] } },
    { namespace: 'u', screen: { type: 'screen', controls: '$alias', $alias: '$children', $children: controls } },
    { namespace: 'u', screen: { type: 'screen', controls: '$children', '$children|default': controls } },
    { namespace: 'u', $children: controls, screen: { type: 'screen', controls: '$children' } },
  ];
  for (const document of variants) {
    const result = await planWorkspaceExport(exportOptions({ [path]: JSON.stringify(document) }));
    assert.equal(result.ok, false);
    const dimensions = result.plan.unresolved.filter(item => item.code === 'EXPORT_DIMENSION_UNITLESS');
    assert.equal(dimensions.length, 1, JSON.stringify(result));
    assert.match(dimensions[0].pointer, /\/(?:\$children|\$children\|default)\/0\/child\/offset$/u);
    assert.equal(result.plan.warnings.filter(item => item.code === 'EXPORT_BINDING_TYPE_UNSUPPORTED').length, 1);
  }
});

test('未使用・局所上書きのcontrols変数を固定の寸法不正と断定しない', async () => {
  const bad = [{ child: { type: 'panel', offset: ['12', '34'] } }];
  for (const document of [
    { namespace: 'u', screen: { type: 'screen', $children: bad, controls: [] } },
    { namespace: 'u', $children: bad, screen: { type: 'screen', $children: [], controls: '$children' } },
  ]) {
    const result = await planWorkspaceExport(exportOptions({ [path]: JSON.stringify(document) }));
    assert.equal(result.plan.unresolved.some(item => item.code === 'EXPORT_DIMENSION_UNITLESS'), false, JSON.stringify(result));
  }
});

test('単位付き/相対px/巨大数の移動でInfinity・指数形式pxを新たに書き出さない', async () => {
  for (const offset of [[1e308, 0], ['9'.repeat(310) + 'px', 0], ['10% + ' + '9'.repeat(310) + 'px', 0],
    ['1000000000000000000000px', 0], ['10% + 1000000000000000000000px', 0], ['9'.repeat(310) + '%', 0]]) {
    const documents = docs({ offset }), before = JSON.stringify(documents);
    const result = await scoped(documents);
    assert.equal(result.ok, false); assert.equal(result.documents, undefined); assert.equal(result.code, 'EDIT_DYNAMIC_OFFSET');
    assert.equal(JSON.stringify(documents), before);
    assert.throws(() => offsetAfterAuthoredMove({ value: { offset }, dx: 1.25, dy: -2.5 }), { code: 'WORKSPACE_MOVE_INVALID' });
  }
});

test('継承callerによるcontrols上書きと条件の全候補を既存依存解決器へ委ねる', async () => {
  const bad = [{ child: { type: 'panel', offset: ['12', '34'] } }];
  for (const [baseValue, override, expectedInvalid] of [[bad, [], false], [[], bad, true]]) {
    const document = { namespace: 'u', base: { type: 'panel', controls: '$children', '$children|default': baseValue },
      'screen@base': { type: 'screen', $children: override } };
    const result = await planWorkspaceExport(exportOptions({ [path]: JSON.stringify(document) }, 'screen@base'));
    assert.equal(result.plan.unresolved.some(item => item.code === 'EXPORT_DIMENSION_UNITLESS'), expectedInvalid, JSON.stringify(result.plan.unresolved));
  }
  const conditional = { namespace: 'u', screen: { type: 'screen', $children: bad,
    variables: [{ requires: '$unknown', $children: [] }], controls: '$children' } };
  const result = await planWorkspaceExport(exportOptions({ [path]: JSON.stringify(conditional) }));
  assert.equal(result.plan.unresolved.some(item => item.code === 'EXPORT_DIMENSION_UNITLESS'), true, '条件を今だけfalse/trueとせず、bad候補が出力される可能性を検出');
});
