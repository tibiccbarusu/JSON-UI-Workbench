import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWorkspace, editWorkspace, workspaceRevision, WORKSPACE_EDIT_LIMITS } from '../workspace-edit.mjs';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

const documentsOf = (definitions, extra = {}) => ({ 'ui/factory.json': JSON.stringify({ namespace: 'x', ...definitions }), ...extra });
const operation = { type: 'delete', path: 'ui/factory.json', pointer: '/base', cascade: true };
const remove = documents => editWorkspace({ documents, expectedRevision: workspaceRevision(documents), operation });
const plan = documents => editWorkspace({ documents, operation: { ...operation, type: 'planDelete' } });
function expectStopped(documents) {
  const original = JSON.stringify(documents), inspection = inspectWorkspace({ documents });
  assert.equal(inspection.ok, true, JSON.stringify(inspection));
  assert(inspection.diagnostics.some(item => item.code === 'EDIT_REFERENCE_DYNAMIC'));
  const result = remove(documents);
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_DELETE_IMPACT_UNKNOWN');
  assert.equal(result.documents, undefined); assert.equal(JSON.stringify(documents), original);
}

test('factory map: 局所object変数と別名を解決し全候補の参照元を連鎖削除する', () => {
  for (const factory of [{ factory: { name: 'spawn', control_ids: '$alias' } }, { type: 'factory', control_ids: '$alias' }]) {
    const documents = documentsOf({ base: {}, other: {}, keep: {}, host: {
      $alias: '$ids', $ids: { first: '@x.base', second: 'local@x.other' }, ...factory } });
    const preview = plan(documents); assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.deepEqual(preview.deletePlan.affected.map(node => node.qualifiedName), ['x.base', 'x.host']);
    const result = remove(documents); assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(JSON.parse(result.documents['ui/factory.json'])), ['namespace', 'other', 'keep']);
  }
});

test('factory map: global・親scope・局所値の優先関係が確定する場合だけ追跡する', () => {
  const global = { 'ui/_global_variables.json': JSON.stringify({ $ids: { one: '@x.other' } }) };
  const documents = documentsOf({ base: {}, other: {}, panel: {
    $ids: { one: '@x.base' }, controls: [{ child: { type: 'factory', control_ids: '$ids' } }] } }, global);
  const result = plan(documents); assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.deletePlan.affected.map(node => node.qualifiedName), ['x.base', 'x.panel/child']);
  const local = documentsOf({ base: {}, other: {}, host: { type: 'factory', $ids: { one: '@x.base' }, control_ids: '$ids' } }, global);
  assert.deepEqual(plan(local).deletePlan.affected.map(node => node.qualifiedName), ['x.base', 'x.host']);
  const onlyGlobal = documentsOf({ base: {}, host: { type: 'factory', control_ids: '$ids' } },
    { 'ui/_global_variables.json': JSON.stringify({ $ids: { one: '@x.base' } }) });
  assert.equal(plan(onlyGlobal).deletePlan.count, 2);
});

test('factory map: 固定mapの値の変数も局所scopeから追跡する', () => {
  const documents = documentsOf({ base: {}, keep: {}, host: { type: 'factory', $target: '@x.base', control_ids: { spawn: '$target' } } });
  assert.equal(plan(documents).deletePlan.count, 2);
});

test('factory map: 非object・未定義・式・不正候補を無診断で無視しない', () => {
  for (const value of ['$missing', '(#runtime_map)', 'x.literal_is_not_a_map', null, [], 10, false, { spawn: [] }, { spawn: '$missing' }]) {
    for (const factory of [{ factory: { control_ids: value } }, { type: 'factory', control_ids: value }]) {
      expectStopped(documentsOf({ base: {}, host: factory }));
    }
  }
});

test('factory map: 条件付き宣言・変数循環・過深い別名を固定objectと誤認しない', () => {
  expectStopped(documentsOf({ base: {}, host: { type: 'factory', $ids: { one: '@x.base' },
    variables: [{ requires: '$runtime', $ids: { one: '@x.other' } }], control_ids: '$ids' } }));
  expectStopped(documentsOf({ base: {}, host: { type: 'factory', $ids: '$again', $again: '$ids', control_ids: '$ids' } }));
  const host = { type: 'factory', control_ids: '$v0' };
  for (let index = 0; index < WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth + 1; index++) host[`$v${index}`] = `$v${index+1}`;
  host[`$v${WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth+1}`] = { one: '@x.base' };
  expectStopped(documentsOf({ base: {}, host }));
});

test('factory map: 継承された変数scopeを推測せず削除を止める', () => {
  expectStopped(documentsOf({ base: {}, parent: {}, 'host@x.parent': { type: 'factory', $ids: { one: '@x.base' }, control_ids: '$ids' } }));
  expectStopped(documentsOf({ base: {}, parent: {}, 'host@x.parent': { $ids: { one: '@x.base' },
    controls: [{ child: { type: 'factory', control_ids: '$ids' } }] } }));
});

test('factory map: 派生やtemplateからの利用で上書きされる候補を局所値に固定しない', () => {
  for (const consumer of [{ 'consumer@x.host': { $ids: { one: '@x.base' } } },
    { consumer: { type: 'grid', grid_item_template: 'x.host', $ids: { one: '@x.base' } } },
    { consumer: { type: 'factory', control_ids: { spawn: '@x.host' }, $ids: { one: '@x.base' } } }]) {
    expectStopped(documentsOf({ base: {}, other: {}, host: { type: 'factory', $ids: { one: '@x.other' }, control_ids: '$ids' }, ...consumer }));
  }
});

test('factory map: 局所mapによる自己展開循環をscope診断で隠さない', () => {
  const documents = documentsOf({ base: {}, host: { type: 'factory', $ids: { one: '@x.host' }, control_ids: '$ids' } });
  const result = inspectWorkspace({ documents });
  assert.equal(result.ok, true); assert.equal(result.previewAllowed, false);
  assert(result.diagnostics.some(item => item.code === 'EDIT_INHERITANCE_CYCLE'));
});

test('factory map: 原文への有効な置換が新規循環を導入したら反映しない', () => {
  const documents = documentsOf({ base: {}, host: { type: 'factory', $ids: { one: '@x.base' }, control_ids: '$ids' } });
  const result = editWorkspace({ documents, operation: { type: 'set', path: 'ui/factory.json', pointer: '/host/$ids/one', value: '@x.host' } });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_INHERITANCE_CYCLE');
  assert.equal(result.documents, undefined);
});

test('factory map: 公式sliderと同じ4候補のobject変数形状を追跡する', () => {
  // 固定commit ui/ui_common.json /slider の宣言構造を縮小したfixture。原ゲームの起動試験ではない。
  const documents = { 'ui/slider.json': JSON.stringify({ namespace: 'common', slider_step: {}, slider_step_hover: {},
    slider_step_progress: {}, slider_step_progress_hover: {}, slider: {
      $slider_step_factory_control_ids: { slider_step: '@common.slider_step', slider_step_hover: '@common.slider_step_hover',
        slider_step_progress: '@common.slider_step_progress', slider_step_progress_hover: '@common.slider_step_progress_hover' },
      factory: { name: 'slider_step_factory', control_ids: '$slider_step_factory_control_ids' } } }) };
  const result = editWorkspace({ documents, operation: { type: 'planDelete', path: 'ui/slider.json', pointer: '/slider_step' } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.deletePlan.affected.map(node => node.qualifiedName), ['common.slider_step', 'common.slider']);
});

test('factory map: 大きなmapは参照解決前の専用総量予算で停止する', () => {
  const ids = Object.fromEntries(Array.from({ length: WORKSPACE_EDIT_LIMITS.maxFactoryReferences + 1 }, (_, index) => [`spawn${index}`, '@x.base']));
  const documents = documentsOf({ base: {}, host: { type: 'factory', control_ids: ids } });
  const result = inspectWorkspace({ documents });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_FACTORY_REFERENCE_LIMIT');
  assert.equal(result.previewAllowed, false);
});

async function compareGlobalSelection(lowerGlobals, upperGlobals, expectedTarget, reverseSources = false) {
  const ui = JSON.stringify({ namespace: 'x', base: { type: 'panel' }, other: { type: 'panel' }, host: { type: 'factory', control_ids: '$ids' } });
  const sourceList = [{ id: 'vanilla-source', kind: 'vanilla', precedence: 10,
    documents: { 'ui/_global_variables.json': JSON.stringify(lowerGlobals), 'ui/a.json': ui } }];
  if (upperGlobals !== undefined) sourceList.push({ id: 'imported-source', kind: 'imported', precedence: 20,
    documents: { 'ui/_global_variables.json': JSON.stringify(upperGlobals) } });
  if (reverseSources) sourceList.reverse();
  const documents = {}, documentSources = {};
  for (const source of sourceList) for (const [physicalPath, text] of Object.entries(source.documents)) {
    const virtualPath = `${source.kind}/${physicalPath}`;
    documents[virtualPath] = text;
    documentSources[virtualPath] = { sourceId: source.id, kind: source.kind, precedence: source.precedence, physicalPath, active: true };
  }
  const catalog = await buildUiCatalog({ parseJsonc, sources: sourceList.map(source => ({ ...source,
    filePaths: Object.keys(source.documents), readText: async path => source.documents[path] })) });
  const host = catalog.records.find(record => record.qualifiedName === 'x.host');
  assert.deepEqual(host.references, [`x.${expectedTarget}`]);
  const projection = resolveEffectiveUi({ catalog, recordId: host.id });
  assert.equal(projection.ok, true);
  // JSON の内容を比較する。解決系は辞書汚染を避ける null-prototype object を返す。
  assert.deepEqual(JSON.parse(JSON.stringify(projection.document.host.control_ids)), { spawn: `@x.${expectedTarget}` });
  for (const target of ['base', 'other']) {
    const result = editWorkspace({ documents, documentSources, operation: { type: 'planDelete', path: 'vanilla/ui/a.json', pointer: `/${target}` } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.deletePlan.affected.some(node => node.qualifiedName === 'x.host'), target === expectedTarget);
  }
}

test('factory global default: 同一ファイルの記載順によらずexactをcatalog/projectと一致させる', async () => {
  const exact = { spawn: '@x.base' }, fallback = { spawn: '@x.other' };
  await compareGlobalSelection({ $ids: exact, '$ids|default': fallback }, undefined, 'base');
  await compareGlobalSelection({ '$ids|default': fallback, $ids: exact }, undefined, 'base');
  await compareGlobalSelection({ variables: { ids: exact, 'ids|default': fallback } }, undefined, 'base');
});

test('factory global default: defaultのみの宣言をcatalog/projectと同じ候補へ解決する', async () => {
  await compareGlobalSelection({ '$ids|default': { spawn: '@x.base' } }, undefined, 'base');
});

test('factory global default: 二層のraw宣言合成後にexact/defaultを選び順序を逆転しても一致する', async () => {
  const base = { spawn: '@x.base' }, other = { spawn: '@x.other' };
  for (const reversed of [false, true]) {
    await compareGlobalSelection({ $ids: base }, { '$ids|default': other }, 'base', reversed);
    await compareGlobalSelection({ '$ids|default': other }, { $ids: base }, 'base', reversed);
    await compareGlobalSelection({ '$ids|default': other }, { '$ids|default': base }, 'base', reversed);
    await compareGlobalSelection({ $ids: other }, { $ids: base }, 'base', reversed);
  }
});

async function compareFactoryType(definitions, expectedType, expectedReference) {
  const documents = documentsOf({ base: { type: 'panel' }, ...definitions });
  const catalog = await buildUiCatalog({ parseJsonc, sources: [{ id: 'pack', kind: 'imported', precedence: 20,
    filePaths: Object.keys(documents), readText: async path => documents[path] }] });
  const host = catalog.records.find(record => record.qualifiedName === 'x.host');
  const projection = resolveEffectiveUi({ catalog, recordId: host.id });
  assert.equal(projection.ok, true, JSON.stringify(projection.diagnostics));
  assert.equal(projection.document.host.type.trim().toLowerCase(), expectedType);
  // catalog は control_ids を型に無関係に集め、control_name は原文型で集める。
  // 共通して確定できる factory の control_ids だけ、参照表とも照合する。
  if (expectedReference && Object.hasOwn(projection.document.host, 'control_ids')) {
    assert.equal(host.references.includes('x.base'), true);
    assert.equal(projection.document.host.control_ids.spawn, '@x.base');
  }
  if (expectedReference && Object.hasOwn(projection.document.host, 'control_name')) {
    assert.equal(projection.document.host.control_name, '@x.base');
  }
  const result = remove(documents);
  assert.equal(result.ok, true, JSON.stringify(result));
  const remaining = JSON.parse(result.documents['ui/factory.json']);
  assert.equal(Object.keys(remaining).some(key => key === 'host' || key.startsWith('host@')), !expectedReference);
  assert.equal(remaining.base, undefined);
}

test('factory type: 固定の継承typeと空白・大文字のtypeを投影されたfactoryと同じ候補として削除する', async () => {
  for (const candidates of [{ control_ids: { spawn: '@x.base' } }, { control_name: '@x.base' }]) {
    await compareFactoryType({ factory_base: { type: 'factory' }, 'host@x.factory_base': candidates }, 'factory', true);
    await compareFactoryType({ factory_base: { type: 'factory' }, 'intermediate@x.factory_base': {},
      'host@x.intermediate': candidates }, 'factory', true);
    await compareFactoryType({ host: { type: ' Factory ', ...candidates } }, 'factory', true);
  }
});

test('factory type: 明示した非factory型の同名プロパティを削除参照にしない', async () => {
  await compareFactoryType({ factory_base: { type: 'factory' },
    'host@x.factory_base': { type: 'panel', control_ids: { spawn: '@x.base' } } }, 'panel', false);
});

test('factory type: 動的型または未確定継承のcontrol_idsを無視せず削除を止める', () => {
  for (const definition of [{ host: { type: '$runtime_type', control_ids: { spawn: '@x.base' } } },
    { 'host@x.missing': { control_ids: { spawn: '@x.base' } } },
    { host: { type: '(#runtime_type)', control_name: '@x.base' } }]) {
    expectStopped(documentsOf({ base: {}, ...definition }));
  }
});

function withFactoryAliases(aliasCount, target) {
  const host = { type: 'factory', control_ids: target === 'map' ? '$v0' : { spawn: '$v0' } };
  for (let index = 0; index < aliasCount; index++) {
    host[`$v${index}`] = index + 1 === aliasCount ? target === 'map' ? { spawn: '@x.base' } : '@x.base' : `$v${index + 1}`;
  }
  return documentsOf({ base: {}, host });
}

test('factory depth: map本体とmap値の双方が128段を受理し129段を原文確定前に拒否する', () => {
  for (const target of ['map', 'value']) {
    const boundary = withFactoryAliases(WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth, target);
    assert.equal(plan(boundary).deletePlan.count, 2);
    assert.equal(remove(boundary).ok, true);
    expectStopped(withFactoryAliases(WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth + 1, target));
  }
});

test('factory depth: map値の循環と131段の独立再現例も無診断で削除しない', () => {
  expectStopped(documentsOf({ base: {}, host: { type: 'factory', control_ids: { spawn: '$a' }, $a: '$b', $b: '$a' } }));
  expectStopped(withFactoryAliases(131, 'value'));
});

test('factory type: 型継承の128要素境界を受理し129要素では推測せず停止する', () => {
  for (const count of [WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth, WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth + 1]) {
    const definitions = { base: {}, factory_base: { type: 'factory' } };
    let previous = 'factory_base';
    for (let index = 0; index < count - 2; index++) {
      definitions[`middle${index}@x.${previous}`] = {};
      previous = `middle${index}`;
    }
    definitions[`host@x.${previous}`] = { control_ids: { spawn: '@x.base' } };
    const documents = documentsOf(definitions);
    if (count === WORKSPACE_EDIT_LIMITS.maxFactoryVariableDepth) assert.equal(plan(documents).deletePlan.count, 2);
    else expectStopped(documents);
  }
});

test('factory type: modificationsの暗黙下位基底から型を取得する', () => {
  const documents = {
    'vanilla/ui/a.json': JSON.stringify({ namespace: 'x', base: {}, host: { type: 'factory' } }),
    'imported/ui/a.json': JSON.stringify({ namespace: 'x', host: { control_ids: { spawn: '@x.base' },
      modifications: [{ array_name: 'controls', operation: 'insert_back', value: { spacer: { type: 'panel' } } }] } }),
  };
  const documentSources = Object.fromEntries(Object.keys(documents).map(path => {
    const kind = path.split('/')[0];
    return [path, { sourceId: kind, kind, precedence: kind === 'vanilla' ? 10 : 20, physicalPath: 'ui/a.json', active: true }];
  }));
  const result = editWorkspace({ documents, documentSources, operation: { type: 'delete',
    path: 'vanilla/ui/a.json', pointer: '/base', cascade: true } });
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const text of Object.values(result.documents)) assert.equal(Object.hasOwn(JSON.parse(text), 'host'), false);
});
