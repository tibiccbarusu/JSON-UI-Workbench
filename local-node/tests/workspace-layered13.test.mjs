import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWorkspace, editWorkspace, workspaceRevision } from '../workspace-edit.mjs';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';

const physicalPath = 'ui/shared.json';
function fixture(lower, upper) {
  const documents = {
    [`vanilla/${physicalPath}`]: JSON.stringify({ namespace: 'x', ...lower }),
    [`imported/${physicalPath}`]: JSON.stringify({ namespace: 'x', ...upper }),
  };
  const documentSources = Object.fromEntries(Object.keys(documents).map(path => {
    const kind = path.split('/')[0];
    return [path, { sourceId: `${kind}-first-upload`, kind, precedence: kind === 'vanilla' ? 10 : 20, physicalPath, active: true }];
  }));
  return { documents, documentSources };
}
const inspect = input => inspectWorkspace(input);
const edit = (input, operation) => editWorkspace({ ...input, expectedRevision: workspaceRevision(input.documents, input.documentSources), operation });
async function catalogOf(input) {
  const bySource = new Map();
  for (const [path, metadata] of Object.entries(input.documentSources)) {
    if (!metadata.active) continue;
    if (!bySource.has(metadata.sourceId)) bySource.set(metadata.sourceId, { id: metadata.sourceId, kind: metadata.kind,
      precedence: metadata.precedence, documents: {} });
    bySource.get(metadata.sourceId).documents[metadata.physicalPath] = input.documents[path];
  }
  return buildUiCatalog({ parseJsonc, sources: [...bySource.values()].map(source => ({ ...source,
    filePaths: Object.keys(source.documents), readText: async path => source.documents[path] })) });
}
async function project(input, symbol) {
  const catalog = await catalogOf(input);
  const result = resolveEffectiveUi({ catalog, recordId: catalog.symbols[symbol].winnerId });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
}

test('層情報: 同じ物理パスの双方の原文位置と所有元を公開する', () => {
  const input = fixture({ base: { type: 'panel' } }, { 'base@x.base': { offset: [3, 4] } });
  const result = inspect(input);
  assert.equal(result.ok, true); assert.equal(result.previewAllowed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.nodes.map(node => [node.path, node.physicalPath, node.sourceKind, node.sourceId, node.precedence]), [
    ['vanilla/ui/shared.json', physicalPath, 'vanilla', 'vanilla-first-upload', 10],
    ['imported/ui/shared.json', physicalPath, 'imported', 'imported-first-upload', 20],
  ]);
});

test('revision: 再インポートの UUID と辞書順に依存せず、層・原文・優先順位変更を検出する', () => {
  const input = fixture({ base: {} }, { screen: {} });
  const baseline = workspaceRevision(input.documents, input.documentSources);
  const metadata = Object.fromEntries(Object.entries(input.documentSources).reverse().map(([path, item]) => [path, { ...item, sourceId: `new-${item.kind}` }]));
  assert.equal(workspaceRevision(Object.fromEntries(Object.entries(input.documents).reverse()), metadata), baseline);
  const path = 'imported/ui/shared.json';
  for (const patch of [{ precedence: 21 }, { physicalPath: 'ui/renamed.json' }, { active: false }, { kind: 'vanilla' }]) {
    assert.notEqual(workspaceRevision(input.documents, { ...metadata, [path]: { ...metadata[path], ...patch } }), baseline);
  }
  assert.notEqual(workspaceRevision({ ...input.documents, [path]: input.documents[path] + '\n' }, metadata), baseline);
});

test('層情報: 欠落・別文書・所有層不整合・危険な物理パスを受け入れない', () => {
  const input = fixture({ base: {} }, { screen: {} });
  const path = 'imported/ui/shared.json';
  const missing = { ...input.documentSources }; delete missing[path];
  assert.equal(inspect({ ...input, documentSources: missing }).code, 'EDIT_SOURCE_METADATA_INVALID');
  assert.equal(inspect({ ...input, documentSources: { ...input.documentSources, 'ui/extra.json': input.documentSources[path] } }).code, 'EDIT_SOURCE_METADATA_INVALID');
  for (const patch of [{ sourceId: 'vanilla-first-upload' }, { precedence: -1 }, { physicalPath: '../escape.json' },
    { physicalPath: '/absolute.json' }, { physicalPath: 'ui/CON.json' }, { physicalPath: 'ui/x.json ' }, { active: 'yes' }]) {
    assert.equal(inspect({ ...input, documentSources: { ...input.documentSources, [path]: { ...input.documentSources[path], ...patch } } }).code,
      'EDIT_SOURCE_METADATA_INVALID', JSON.stringify(patch));
  }
});

test('層情報: 同一所有層の NFC と大小文字だけが違う物理パスを拒否する', () => {
  const documents = { 'one.json': '{}', 'two.json': '{}' };
  for (const paths of [['ui/É.json', 'ui/E\u0301.json'], ['ui/A.json', 'ui/a.json']]) {
    const documentSources = Object.fromEntries(Object.keys(documents).map((path, index) => [path,
      { sourceId: 'same', kind: 'imported', precedence: 20, physicalPath: paths[index], active: true }]));
    assert.equal(inspect({ documents, documentSources }).code, 'EDIT_SOURCE_PATH_AMBIGUOUS');
  }
});

test('実 catalog 照合: 下位 self-overlay のサイズを引き継ぎ、下位原文だけ編集できる', async () => {
  const input = fixture({ base: { type: 'panel', size: [120, 60] } }, { 'base@x.base': { offset: [3, 4] } });
  const projected = await project(input, 'x.base');
  assert.deepEqual(projected.document.base.size, [120, 60]);
  assert.deepEqual(projected.document.base.offset, [3, 4]);
  const result = edit(input, { type: 'set', path: 'vanilla/ui/shared.json', pointer: '/base/size', value: [140, 70] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.changes.length, 1); assert.equal(result.changes[0].sourceKind, 'vanilla');
  assert.equal(result.documents['imported/ui/shared.json'], input.documents['imported/ui/shared.json']);
  assert.deepEqual((await project({ ...input, documents: result.documents }, 'x.base')).document.base.size, [140, 70]);
});

test('実 catalog 照合: 暗黙 modifications 継承とその下位子要素の削除を保持する', async () => {
  const input = fixture({ base: { type: 'panel', size: [120, 60], controls: [{ old: { type: 'panel' } }] } },
    { base: { modifications: [{ array_name: 'controls', operation: 'insert_back', value: [{ added: { type: 'panel' } }] }] } });
  const initial = inspect(input); assert.equal(initial.previewAllowed, true, JSON.stringify(initial.diagnostics));
  const before = await project(input, 'x.base');
  assert.deepEqual(before.document.base.controls.map(child => Object.keys(child)[0]), ['old', 'added']);
  assert(before.diagnostics.some(item => item.code === 'UI_MODIFICATIONS_IMPLICIT_BASE'));
  const result = edit(input, { type: 'delete', path: 'vanilla/ui/shared.json', pointer: '/base/controls/0/old', cascade: true });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.deletePlan.count, 1);
  const after = await project({ ...input, documents: result.documents }, 'x.base');
  assert.deepEqual(after.document.base.size, [120, 60]);
  assert.deepEqual(after.document.base.controls.map(child => Object.keys(child)[0]), ['added']);
});

test('削除: 上位を選んでも下位を選んでも全 fallback と継承・template・factory を削除する', async () => {
  const input = fixture({ base: { type: 'panel', controls: [{ child: {} }] }, 'lower_leaf@x.base': {}, keep: {} },
    { 'base@x.base': { offset: [2, 3] }, 'upper_leaf@x.base': {},
      template: { type: 'grid', grid_item_template: 'x.base' }, factory: { type: 'factory', control_name: 'x.base' } });
  for (const [path, pointer] of [['imported/ui/shared.json', '/base@x.base'], ['vanilla/ui/shared.json', '/base']]) {
    const planned = edit(input, { type: 'planDelete', path, pointer });
    assert.equal(planned.ok, true, JSON.stringify(planned)); assert.equal(planned.deletePlan.count, 7);
    assert.equal(planned.deletePlan.fileCount, 2);
    // 下位選択では上位 self-overlay に reference として先に到達する。
    if (path.startsWith('imported/')) assert(planned.deletePlan.affected.some(node => node.reason === 'fallback-candidate'));
    assert.equal(planned.revision, workspaceRevision(input.documents, input.documentSources));
    const result = edit(input, { type: 'delete', path, pointer, cascade: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    const catalog = await catalogOf({ ...input, documents: result.documents });
    assert.deepEqual(catalog.records.map(record => record.qualifiedName), ['x.keep']);
    assert(result.changes.every(change => change.physicalPath === physicalPath && change.sourceId));
  }
});

test('削除: 明示継承のない同名上書きも下位候補ごと除去し、復活を防ぐ', async () => {
  const input = fixture({ base: { type: 'panel', size: [5, 5] }, keep: {} }, { base: { type: 'panel', size: [10, 10] } });
  const result = edit(input, { type: 'delete', path: 'imported/ui/shared.json', pointer: '/base', cascade: true });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.deletePlan.count, 2);
  assert(result.deletePlan.affected.some(node => node.sourceKind === 'vanilla' && node.reason === 'fallback-candidate'));
  assert.deepEqual((await catalogOf({ ...input, documents: result.documents })).records.map(record => record.qualifiedName), ['x.keep']);
});

test('層のグローバル変数: source 配列順によらず上位値で静的継承を解決する', () => {
  const input = fixture({ lower: {} }, { upper: {}, 'screen@$chosen': {} });
  for (const kind of ['imported', 'vanilla']) {
    const path = `${kind}/ui/_global_variables.json`;
    input.documents[path] = JSON.stringify({ $chosen: kind === 'vanilla' ? 'x.lower' : 'x.upper' });
    input.documentSources[path] = { ...input.documentSources[`${kind}/ui/shared.json`], physicalPath: 'ui/_global_variables.json' };
  }
  const result = edit(input, { type: 'planDelete', path: 'imported/ui/shared.json', pointer: '/upper' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.deletePlan.affected.map(node => node.qualifiedName).sort(), ['x.screen', 'x.upper']);
});

test('削除: 暗黙 modifications の下位基底削除で上位定義と追加子要素も連鎖する', async () => {
  const input = fixture({ base: { type: 'panel' }, keep: {} },
    { base: { modifications: [{ array_name: 'controls', operation: 'insert_back', value: { added: {} } }] }, 'leaf@x.base': {} });
  const result = edit(input, { type: 'delete', path: 'vanilla/ui/shared.json', pointer: '/base', cascade: true });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.deletePlan.count, 4);
  assert.deepEqual((await catalogOf({ ...input, documents: result.documents })).records.map(record => record.qualifiedName), ['x.keep']);
});

test('undo 入力: changes の before を元の所有層へ復元すると原文・revision・projection が完全復帰する', async () => {
  const input = fixture({ base: { type: 'panel', size: [120, 60] }, 'leaf@x.base': {} },
    { 'base@x.base': { offset: [3, 4] }, keep: {} });
  input.documents['vanilla/ui/shared.json'] = '// 下位の原文\r\n' + input.documents['vanilla/ui/shared.json'] + '\r\n';
  const before = await project(input, 'x.base');
  const result = edit(input, { type: 'delete', path: 'imported/ui/shared.json', pointer: '/base@x.base', cascade: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  const restored = { ...result.documents };
  for (const change of result.changes) restored[change.path] = change.before;
  assert.deepEqual(restored, input.documents);
  assert.equal(workspaceRevision(restored, input.documentSources), result.beforeRevision);
  assert.deepEqual((await project({ ...input, documents: restored }, 'x.base')).document, before.document);
});

test('安全境界: 層をまたぐ通常の循環は拒否し、self-overlay とは区別する', () => {
  const input = fixture({ base: { type: 'panel' } }, { 'base@x.base': {}, 'leaf@x.base': {} });
  const original = JSON.stringify(input);
  const result = edit(input, { type: 'inherit', path: 'vanilla/ui/shared.json', pointer: '/base', baseRef: 'x.leaf' });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_INHERITANCE_CYCLE');
  assert.equal(JSON.stringify(input), original);
});

test('安全境界: 同順位の候補を勝手に一つ選ばず、関連外の曖昧参照があれば削除を停止する', () => {
  const input = fixture({ target: {}, duplicate: {} }, { duplicate: {}, 'reader@x.duplicate': {} });
  input.documentSources['imported/ui/shared.json'].precedence = 10;
  const result = edit(input, { type: 'delete', path: 'vanilla/ui/shared.json', pointer: '/target', cascade: true });
  assert.equal(result.ok, false); assert.equal(result.code, 'EDIT_DELETE_IMPACT_UNKNOWN');
});

test('安全境界: 古い revision と不正プロパティを原文へ反映しない', () => {
  const input = fixture({ base: { type: 'panel' } }, { 'base@x.base': {} });
  const original = JSON.stringify(input);
  const stale = editWorkspace({ ...input, expectedRevision: 'old', operation: { type: 'move', path: 'vanilla/ui/shared.json', pointer: '/base', offset: [4, 5] } });
  assert.equal(stale.code, 'EDIT_REVISION_CONFLICT');
  const invalid = edit(input, { type: 'set', path: 'imported/ui/shared.json', pointer: '/base@x.base/size', value: [1] });
  assert.equal(invalid.ok, false); assert.equal(invalid.code, 'EDIT_UI_STRUCTURE');
  assert.equal(JSON.stringify(input), original);
});
