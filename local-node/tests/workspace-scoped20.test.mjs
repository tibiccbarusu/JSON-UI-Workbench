import test from 'node:test';
import assert from 'node:assert/strict';
import { editWorkspaceScoped, buildScopedEditContext } from '../workspace-scoped-edit.mjs';
import { editWorkspace, workspaceRevision } from '../workspace-edit.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseEditableJsonc, pointerParts, pointerJoin } from '../workspace-jsonc.mjs';
import { scoped20Documents, scoped20UploadedDocuments, scoped20Cases, scoped20BoundaryFixtures } from './workspace-scoped20-fixtures.mjs';

const encode = values => Object.fromEntries(Object.entries(values).map(([path, value]) => [path, JSON.stringify(value)]));
const at = (value, pointer) => pointerParts(pointer).reduce((current, key) => current?.[key], value);
async function project(documents, symbol, documentSources, preview = {}) {
  const context = await buildScopedEditContext({ documents, documentSources });
  const record = context.catalog.recordsById[context.catalog.symbols[symbol].winnerId];
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id, ...preview });
  assert.equal(projection.ok, true, JSON.stringify(projection));
  return { context, record, projection };
}
async function request(documents, symbol, effectivePointer, extra = {}, documentSources) {
  const { context, record, projection } = await project(documents, symbol, documentSources, extra.preview);
  const source = projection.nodeSources[effectivePointer];
  assert(source, `missing ${effectivePointer}`);
  return { documents, documentSources, expectedRevision: context.revision, context,
    operation: { type: 'move', scope: 'screen', targetMode: 'interaction',
      screen: { path: context.internalPath(record), pointer: pointerJoin([record.rawKey]) },
      path: context.internalPath(source), pointer: source.pointer, effectivePointer, delta: [11, 7], ...extra } };
}
function rawRecordsPreserved(before, after, except = []) {
  for (const [path, text] of Object.entries(before)) {
    const first = parseEditableJsonc(text), last = parseEditableJsonc(after[path]);
    for (const entry of first.entries) {
      if (except.includes(`${path}#${entry.key}`)) continue;
      const match = last.entries.find(item => item.key === entry.key);
      assert(match, `original key disappeared: ${path}#${entry.key}`);
      assert.equal(after[path].slice(match.node.start, match.node.end), text.slice(entry.node.start, entry.node.end), `original record changed: ${path}#${entry.key}`);
    }
  }
}

for (const fixture of scoped20Cases) test(`実ソース: ${fixture.id} は操作本体へ昇格し、兄弟状態と他画面を保持`, async () => {
  const input = await request(scoped20Documents, fixture.screen, fixture.effectivePointer);
  const before = (await project(scoped20Documents, fixture.screen)).projection.document;
  const other = (await project(scoped20Documents, 'fixture.screen_b')).projection.document;
  const result = await editWorkspaceScoped(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.editPlan.target.type, fixture.expectedInteractiveType);
  assert.equal(result.editPlan.target.effectivePointer, fixture.expectedInteractivePointer);
  assert.equal(result.editPlan.promoted, true);
  const after = (await project(result.documents, fixture.screen)).projection.document;
  const expected = structuredClone(before), control = at(expected, fixture.expectedInteractivePointer);
  control.offset = (control.offset || [0, 0]).map((number, index) => number + [11, 7][index]);
  assert.deepEqual(JSON.parse(JSON.stringify(after)), expected, 'all child state, text, mappings and slot siblings remain unchanged');
  assert.deepEqual((await project(result.documents, 'fixture.screen_b')).projection.document, other);
  assert.equal(result.documents['ui/ui_common.json'], scoped20Documents['ui/ui_common.json']);
  assert.equal(result.documents['ui/pocket/fixture_pocket.json'], scoped20Documents['ui/pocket/fixture_pocket.json']);
});

for (const fixture of scoped20Cases) test(`明示visual: ${fixture.id} の共有原文をコピーし、現在画面だけ変更`, async () => {
  const input = await request(scoped20Documents, fixture.screen, fixture.effectivePointer, { targetMode: 'visual', generatedScope: 'template' });
  const other = (await project(scoped20Documents, 'fixture.screen_b')).projection.document;
  const result = await editWorkspaceScoped(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert(result.editPlan.clonedDefinitions.length > 0);
  rawRecordsPreserved(scoped20Documents, result.documents, ['ui/fixture_screens.json#screen_a']);
  assert.deepEqual((await project(result.documents, 'fixture.screen_b')).projection.document, other);
  assert.deepEqual(at((await project(result.documents, fixture.screen)).projection.document, fixture.effectivePointer).offset, [11, 7]);
  for (const text of Object.values(result.documents)) assert(!text.includes('preview_slot_') && !text.includes('inheritanceSources'));
});

test('shared は共有原文を明示変更し、screen_b にも反映する', async () => {
  const fixture = scoped20Cases[0];
  const input = await request(scoped20Documents, fixture.screen, fixture.effectivePointer,
    { scope: 'shared', targetMode: 'visual', generatedScope: 'template' });
  const result = await editWorkspaceScoped(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.editPlan.clonedDefinitions.length, 0);
  assert(result.editPlan.affectedScreens.some(screen => screen.qualifiedName === 'fixture.screen_b'));
  const other = (await project(result.documents, 'fixture.screen_b')).projection.document;
  assert.deepEqual(at(other, fixture.effectivePointer.replace('/screen_a/', '/screen_b/')).offset, [11, 7]);
});

test('planEdit は原文・revisionを変更せず、所有者の寸法と範囲を返す', async () => {
  const fixture = scoped20Cases[0], revision = workspaceRevision(scoped20Documents);
  const input = await request(scoped20Documents, fixture.screen, fixture.effectivePointer, { type: 'planEdit', intendedType: 'move', delta: undefined });
  const result = await editWorkspaceScoped(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.changes, []); assert.equal(result.documents, undefined); assert.equal(result.revision, revision);
  assert.deepEqual(result.editPlan.target.props.size, [21, 21]);
  assert.deepEqual(result.editPlan.target.props.offset, [-2, 2]);
  assert.equal(workspaceRevision(scoped20Documents), revision);
});

test('既存の誤った装飾 offset を推測で削除せず、今後の所有者移動と分ける', async () => {
  const fixture = scoped20Cases[0];
  const result = await editWorkspaceScoped(await request(scoped20UploadedDocuments, fixture.screen, fixture.effectivePointer));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(at((await project(result.documents, fixture.screen)).projection.document, fixture.effectivePointer).offset, [-77.959, 25]);
});

for (const fixture of scoped20BoundaryFixtures.filter(item => !item.generated)) test(`境界: ${fixture.id} の継承と対照画面を維持`, async () => {
  const other = (await project(fixture.documents, fixture.comparisonScreen, fixture.documentSources)).projection.document;
  const result = await editWorkspaceScoped(await request(fixture.documents, fixture.screen, fixture.effectivePointer, {}, fixture.documentSources));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual((await project(result.documents, fixture.comparisonScreen, fixture.documentSources)).projection.document, other);
  if (fixture.id === 'implicit-layer-base') {
    assert.equal(result.editPlan.clonedDefinitions.length, 2);
    const after = (await project(result.documents, fixture.screen, fixture.documentSources)).projection.document;
    assert.equal(after.screen_a.controls[1].extra.text, '追加');
  }
});

const repeated = encode({ 'ui/repeat.json': { namespace: 'r', row: { type: 'input_panel', offset: [1, 2], size: [18, 18],
  controls: [{ bg: { type: 'image' } }, { action: { type: 'button' } }] },
  grid: { type: 'grid', grid_dimensions: [2, 1], grid_item_template: 'r.row' },
  a: { type: 'screen', controls: [{ 'cells@r.grid': {} }] }, b: { type: 'screen', controls: [{ 'cells@r.grid': {} }] } } });
const repeatedPointer = '/a/controls/0/cells/controls/1/preview_slot_1/controls/0/bg';
test('生成grid: template同意前は失敗・同意後は同UI全セルと兄弟操作を一緒に移動', async () => {
  const input = await request(repeated, 'r.a', repeatedPointer);
  const preview = await editWorkspaceScoped({ ...input, operation: { ...input.operation, type: 'planEdit', intendedType: 'move' } });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.editPlan.generated, 'grid'); assert.equal(preview.editPlan.affectedInstances, 2);
  const rejected = await editWorkspaceScoped(input);
  assert.equal(rejected.code, 'EDIT_GENERATED_SCOPE_REQUIRED'); assert.equal(rejected.documents, undefined);
  const result = await editWorkspaceScoped({ ...input, operation: { ...input.operation, generatedScope: 'template' } });
  assert.equal(result.ok, true, JSON.stringify(result));
  const cells = (await project(result.documents, 'r.a')).projection.document.a.controls[0].cells.controls;
  for (const wrapper of cells) {
    const row = Object.values(wrapper)[0]; assert.deepEqual(row.offset, [12, 9]);
    assert.equal(row.controls[1].action.type, 'button'); assert.equal(row.controls[0].bg.offset, undefined);
  }
  assert.deepEqual((await project(result.documents, 'r.b')).projection.document, (await project(repeated, 'r.b')).projection.document);
  assert(!Object.values(result.documents).join('').includes('preview_slot_'));
});

test('factory: 代表行とtemplate同意を使い、原文factoryを残して寸法変更', async () => {
  const fixture = scoped20BoundaryFixtures.find(item => item.generated);
  const preview = { representativeCollections: fixture.representativeCollections };
  const extra = { type: 'set', property: 'size', value: [91, 18], generatedScope: 'template', preview };
  const result = await editWorkspaceScoped(await request(fixture.documents, fixture.screen, fixture.effectivePointer, extra));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.editPlan.affectedInstances, 2);
  const after = (await project(result.documents, fixture.screen, undefined, preview)).projection.document;
  assert.equal(after.screen_a.controls.length, 2);
  for (const wrapper of after.screen_a.controls) assert.deepEqual(wrapper.entry.size, [91, 18]);
  assert.deepEqual((await project(result.documents, fixture.comparisonScreen, undefined, preview)).projection.document,
    (await project(fixture.documents, fixture.comparisonScreen, undefined, preview)).projection.document);
  assert(Object.values(result.documents).join('').includes('row_factory'));
});

test('重複local名は配列の元位置で区別し、もう一方を保持', async () => {
  const docs = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'screen', controls: [{ same: { type: 'button', offset: [1, 1] } }, { same: { type: 'button', offset: [2, 2] } }] }, 'a@a.base': {}, 'b@a.base': {} } });
  const result = await editWorkspaceScoped(await request(docs, 'a.a', '/a/controls/1/same'));
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = (await project(result.documents, 'a.a')).projection.document.a.controls;
  assert.deepEqual(after[0].same.offset, [1, 1]); assert.deepEqual(after[1].same.offset, [13, 9]);
});

test('動的変数が別利用者で別基底へ分岐しても変数参照を維持して分離', async () => {
  const docs = encode({ 'ui/a.json': { namespace: 'a', one: { type: 'panel', controls: [{ img: { type: 'image' } }] }, two: { type: 'panel' },
    wrapper: { type: 'panel', controls: [{ 'content@$which': {} }] }, root: { type: 'screen', controls: [
      { 'first@a.wrapper': { '$which': 'a.one' } }, { 'second@a.wrapper': { '$which': 'a.two' } }] } } });
  const input = await request(docs, 'a.root', '/root/controls/0/first/controls/0/content/controls/0/img', { targetMode: 'visual' });
  const result = await editWorkspaceScoped(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = (await project(result.documents, 'a.root')).projection.document.root;
  assert.deepEqual(after.controls[0].first.controls[0].content.controls[0].img.offset, [11, 7]);
  assert.equal(after.controls[1].second.controls[0].content.controls, undefined);
  assert(Object.values(result.documents).join('').includes('content@$which'));
});

test('選択UI自体が他UIの基底ならscreen限定の保証不能を明示する', async () => {
  const docs = encode({ 'ui/a.json': { namespace: 'a', screen: { type: 'screen', controls: [{ img: { type: 'image' } }] }, 'derived@a.screen': {} } });
  const result = await editWorkspaceScoped(await request(docs, 'a.screen', '/screen/controls/0/img'));
  assert.equal(result.code, 'EDIT_SCREEN_IS_SHARED'); assert.equal(result.documents, undefined);
});

test('offset の相対式を残して差分を加え、binding/animationの位置は拒否', async () => {
  const docs = encode({ 'ui/a.json': { namespace: 'a', screen: { type: 'screen', controls: [{ image: { type: 'image', offset: ['50% - 2px', '10px'] } }] } } });
  const result = await editWorkspaceScoped(await request(docs, 'a.screen', '/screen/controls/0/image'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual((await project(result.documents, 'a.screen')).projection.document.screen.controls[0].image.offset, ['50% + 9px', '17px']);
  const animated = encode({ 'ui/a.json': { namespace: 'a', screen: { type: 'screen', controls: [{ image: { type: 'image', anims: ['@a.slide'] } }] }, slide: { anim_type: 'offset', from: [0, 0], to: [10, 10], duration: 1 } } });
  const blocked = await editWorkspaceScoped(await request(animated, 'a.screen', '/screen/controls/0/image'));
  assert.equal(blocked.code, 'EDIT_ANIMATED_POSITION'); assert.equal(blocked.documents, undefined);
});

test('無効値・古いselection/revision・未知scopeは原文無変更で拒否', async () => {
  const fixture = scoped20Cases[0], input = await request(scoped20Documents, fixture.screen, fixture.effectivePointer);
  for (const [patch, code] of [[{ pointer: '/close_button' }, 'EDIT_SELECTION_STALE'], [{ delta: [Infinity, 1] }, 'EDIT_DELTA_INVALID'], [{ scope: 'instance' }, 'EDIT_SCOPE_INVALID']]) {
    const result = await editWorkspaceScoped({ ...input, operation: { ...input.operation, ...patch } });
    assert.equal(result.code, code); assert.equal(result.documents, undefined);
  }
  const conflict = await editWorkspaceScoped({ ...input, expectedRevision: 'old' });
  assert.equal(conflict.code, 'EDIT_REVISION_CONFLICT');
  const invalid = await editWorkspaceScoped({ ...input, operation: { ...input.operation, type: 'set', property: 'size', value: [1] } });
  assert.equal(invalid.ok, false); assert.equal(invalid.documents, undefined);
});

test('原文 JSONC のコメント/BOM/CRLF と一括取り消しを保持', async () => {
  const docs = { 'ui/base.json': '\uFEFF{\r\n// 原文コメント\r\n"namespace":"a","base":{"type":"panel",/* 内側 */"controls":[{"img":{"type":"image"}}]}}\r\n',
    'ui/a.json': '{"namespace":"a","screen@a.base":{}}' };
  const result = await editWorkspaceScoped(await request(docs, 'a.screen', '/screen/controls/0/img'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert(result.documents['ui/base.json'].startsWith('\uFEFF{\r\n// 原文コメント\r\n'));
  assert.equal(result.documents['ui/base.json'].split('/* 内側 */').length, 3, 'raw clone keeps inner comment');
  const undo = editWorkspace({ documents: result.documents, operation: { type: 'replaceTexts', texts: Object.fromEntries(result.changes.map(change => [change.path, change.before])) } });
  assert.equal(undo.ok, true); assert.equal(undo.revision, workspaceRevision(docs)); assert.deepEqual({ ...undo.documents }, docs);
});

test('原文由来の別枝の不正max_sizeを複製しても移動可能、新しい不正値は拒否', async () => {
  const docs = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls: [
    { image: { type: 'image' } }, { original_invalid: { type: 'panel', max_size: [] } }] },
    'screen@a.base': {}, 'other@a.base': {} } });
  const input = await request(docs, 'a.screen', '/screen/controls/0/image');
  const moved = await editWorkspaceScoped(input);
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(moved.diagnostics.filter(item => item.code === 'EDIT_UI_PROPERTY_INVALID').length, 2);
  const bad = await editWorkspaceScoped({ ...input, operation: { ...input.operation, type: 'set', property: 'max_size', value: [] } });
  assert.equal(bad.ok, false); assert.equal(bad.code, 'EDIT_UI_STRUCTURE'); assert.equal(bad.documents, undefined);
  assert.deepEqual((await project(moved.documents, 'a.other')).projection.document, (await project(docs, 'a.other')).projection.document);
});

test('局所の固定offset変数は同名の祖先条件を上書きできる', async () => {
  const docs = encode({ 'ui/a.json': { namespace: 'a', screen: { type: 'screen', '$pos|default': [0, 0],
    variables: [{ requires: '$large', '$pos': [50, 60] }], controls: [{ button: { type: 'button', '$pos': [3, 4], offset: '$pos' } }] } } });
  const result = await editWorkspaceScoped(await request(docs, 'a.screen', '/screen/controls/0/button'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual((await project(result.documents, 'a.screen', undefined, { variables: { '$large': true } })).projection.document.screen.controls[0].button.offset, [14, 11]);
});
