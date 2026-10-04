import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiCatalog } from '../../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../../editor-core/src/json/jsonc.js';
import { editWorkspace, inspectWorkspace, workspaceRevision } from '../workspace-edit.mjs';

const encode = values => Object.fromEntries(Object.entries(values).map(([path, document]) => [path, typeof document === 'string' ? document : JSON.stringify(document)]));
async function project(documents, symbol, options = {}, sources) {
  const catalog = await buildUiCatalog({ parseJsonc, sources: sources || [{ id: 'pack', kind: 'imported', precedence: 20,
    filePaths: Object.keys(documents), readText: async path => documents[path] }] });
  const result = resolveEffectiveUi({ catalog, recordId: catalog.symbols[symbol].winnerId, ...options });
  assert.equal(result.ok, true, JSON.stringify(result.error)); return result;
}
const child = (document, key) => document.controls.find(wrapper => Object.hasOwn(wrapper, key))[key];

// These are mutation outcomes: changing the wrong source can look correct in
// one projection while corrupting every other use of the shared template.
test('inherited named children map across files and mutation/undo preserve raw siblings and BOM', async () => {
  const documents = encode({
    'ui/base.json': '\uFEFF{\n// Original comment\n"namespace":"b","base":{"type":"screen","controls":[{"tile":{"type":"panel","offset":[1,2]}}]},"sibling":{"type":"panel"}}\n',
    'ui/main.json': { namespace: 'm', 'main@b.base': {} },
  });
  const revision = workspaceRevision(documents), before = await project(documents, 'm.main');
  const source = before.nodeSources['/main/controls/0/tile'];
  assert.equal(source.path, 'ui/base.json'); assert.equal(source.pointer, '/base/controls/0/tile');
  assert.equal(source.sourceId, 'pack'); assert.equal(source.scope, 'authored-source');
  const moved = editWorkspace({ documents, expectedRevision: revision,
    operation: { type: 'move', path: source.path, pointer: source.pointer, offset: [8, 9] } });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.deepEqual((await project(moved.documents, 'm.main')).document.main.controls[0].tile.offset, [8, 9]);
  assert.equal(moved.documents['ui/main.json'], documents['ui/main.json']);
  assert(moved.documents['ui/base.json'].startsWith('\uFEFF{\n// Original comment'));
  assert.deepEqual(parseJsonc(moved.documents['ui/base.json']).value.sibling, { type: 'panel' });
  const undo = editWorkspace({ documents: moved.documents, operation: { type: 'replaceText', path: source.path, text: moved.changes[0].before } });
  assert.equal(undo.revision, revision); assert.deepEqual(Object.entries(undo.documents), Object.entries(documents));
  assert.equal(workspaceRevision(documents), revision, 'Original inputs must be read-only');
});

test('two inherited instances choose their local bodies; nested template nodes report shared scope', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls: [{ label: { type: 'label', text: 'shared' } }] },
    screen: { type: 'screen', controls: [{ 'first@a.base': {} }, { 'second@a.base': {} }] } } });
  const before = await project(documents, 'a.screen');
  const first = before.nodeSources['/screen/controls/0/first'];
  assert.equal(first.pointer, '/screen/controls/0/first@a.base'); assert.equal(first.instances, 1);
  const template = before.nodeSources['/screen/controls/0/first/controls/0/label'];
  assert.equal(template.pointer, '/base/controls/0/label'); assert.equal(template.instances, 2); assert.equal(template.scope, 'shared-template');
  const moved = editWorkspace({ documents, operation: { type: 'move', path: first.path, pointer: first.pointer, offset: [17, 21] } });
  assert.equal(moved.ok, true); const after = (await project(moved.documents, 'a.screen')).document.screen;
  assert.deepEqual(child(after, 'first').offset, [17, 21]); assert.equal(child(after, 'second').offset, undefined);
  assert.equal(parseJsonc(moved.documents[first.path]).value.base.offset, undefined);
});

test('same-path layered self-inheritance keeps lower child identity and higher root identity', async () => {
  const path = 'ui/shared.json';
  const documents = encode({ [`vanilla/${path}`]: { namespace: 'a', base: { type: 'panel', controls: [{ tile: { type: 'panel' } }] } },
    [`imported/${path}`]: { namespace: 'a', 'base@a.base': { size: [40, 30] } } });
  const metadata = Object.fromEntries(Object.keys(documents).map(internal => {
    const kind = internal.split('/')[0]; return [internal, { sourceId: kind, kind, physicalPath: path, precedence: kind === 'vanilla' ? 10 : 20, active: true }];
  }));
  const sources = Object.entries(metadata).map(([internal, owner]) => ({ id: owner.sourceId, kind: owner.kind,
    precedence: owner.precedence, filePaths: [path], readText: async () => documents[internal] }));
  const before = await project(documents, 'a.base', {}, sources);
  assert.equal(before.nodeSources['/base'].sourceId, 'imported');
  const target = before.nodeSources['/base/controls/0/tile']; assert.equal(target.sourceId, 'vanilla'); assert.equal(target.pointer, '/base/controls/0/tile');
  const internal = `${target.sourceId}/${target.path}`;
  const moved = editWorkspace({ documents, documentSources: metadata,
    operation: { type: 'move', path: internal, pointer: target.pointer, offset: [10, 20] } });
  assert.equal(moved.ok, true); assert.equal(moved.changes.length, 1); assert.equal(moved.changes[0].path, internal);
  assert.equal(moved.documents[`imported/${path}`], documents[`imported/${path}`]);
});

test('insert-front modifications never reuse projected controls array positions as source indices', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls: [{ original: { type: 'label', text: 'original' } }] },
    'screen@a.base': { modifications: [{ array_name: 'controls', operation: 'insert_front', value: [{ inserted: { type: 'label', text: 'inserted' } }] }] } } });
  const result = await project(documents, 'a.screen');
  assert.equal(result.nodeSources['/screen/controls/0/inserted'].pointer, '/screen@a.base/modifications/0/value/0/inserted');
  assert.equal(result.nodeSources['/screen/controls/1/original'].pointer, '/base/controls/0/original');
  const inspection = inspectWorkspace({ documents }); assert.equal(inspection.ok, true);
  for (const source of Object.values(result.nodeSources)) assert(inspection.nodes.some(node => node.path === source.path && node.pointer === source.pointer));
});

test('duplicate preview names retain distinct source pointers and literal pointer escaping', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', 'screen/~': { type: 'panel', controls: [{ tile: { type: 'label', text: 'first' } }, { tile: { type: 'label', text: 'second' } }] } } });
  const result = await project(documents, 'a.screen/~');
  assert.equal(result.nodeSources['/screen~1~0/controls/0/tile'].pointer, '/screen~1~0/controls/0/tile');
  assert.equal(result.nodeSources['/screen~1~0/controls/1/tile'].pointer, '/screen~1~0/controls/1/tile');
});

test('dynamic instance inheritance preserves the authored key rather than resolved base location', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls: [{ leaf: { type: 'label', text: 'dynamic' } }] },
    screen: { type: 'panel', '$content': 'a.base', controls: [{ 'content@$content': {} }] } } });
  const result = await project(documents, 'a.screen');
  assert.equal(result.nodeSources['/screen/controls/0/content'].pointer, '/screen/controls/0/content@$content');
  assert.equal(result.nodeSources['/screen/controls/0/content/controls/0/leaf'].pointer, '/base/controls/0/leaf');
});

test('generated grid rows and all descendants expose shared template scope and repeat count', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', slot: { type: 'panel', controls: [{ icon: { type: 'image', texture: 'textures/icon' } }] },
    screen: { type: 'grid', grid_dimensions: [2, 1], grid_item_template: 'a.slot', collection_name: 'items' } } });
  const result = await project(documents, 'a.screen');
  assert.equal(result.stats.materializedGridItems, 2);
  for (let i = 0; i < 2; i++) {
    const root = result.nodeSources[`/screen/controls/${i}/preview_slot_${i}`];
    const icon = result.nodeSources[`/screen/controls/${i}/preview_slot_${i}/controls/0/icon`];
    for (const source of [root, icon]) { assert.equal(source.scope, 'shared-template'); assert.equal(source.generated, 'grid'); assert.equal(source.instances, 2); }
    assert.equal(root.pointer, '/slot'); assert.equal(icon.pointer, '/slot/controls/0/icon');
  }
});

test('named generated factory rows with duplicate names retain template provenance without generated source writes', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', row: { type: 'panel', controls: [{ label: { type: 'label', text: '#text' } }] },
    screen: { type: 'stack_panel', collection_name: 'rows', factory: { name: 'row_factory', control_name: 'message@a.row' } } } });
  const result = await project(documents, 'a.screen', { representativeCollections: { rows: { count: 2 } } });
  assert.equal(result.stats.materializedFactoryItems, 2);
  for (let i = 0; i < 2; i++) {
    const source = result.nodeSources[`/screen/controls/${i}/message/controls/0/label`];
    assert.equal(source.pointer, '/row/controls/0/label'); assert.equal(source.generated, 'factory'); assert.equal(source.instances, 2);
  }
  assert.equal(JSON.stringify(result.document).includes('authoredSource'), false);
  assert.equal(JSON.stringify(result.document).includes('nodeSources'), false);
  assert.equal(JSON.stringify(result.document).includes('sourceId'), false);
});

test('controls object maps support exact inherited edit, add and delete without array coercion', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls: { tile: { type: 'label', text: 'tile' }, keep: { type: 'label', text: 'keep' } } }, 'screen@a.base': {} } });
  const result = await project(documents, 'a.screen'), source = result.nodeSources['/screen/controls/tile'];
  assert.equal(source.pointer, '/base/controls/tile');
  assert.equal(inspectWorkspace({ documents }).ok, true);
  const moved = editWorkspace({ documents, operation: { type: 'move', path: source.path, pointer: source.pointer, offset: [1, 2] } });
  assert.equal(moved.ok, true); assert.deepEqual((await project(moved.documents, 'a.screen')).document.screen.controls.tile.offset, [1, 2]);
  const added = editWorkspace({ documents: moved.documents, operation: { type: 'add', path: source.path, parentPointer: '/base', name: 'next', value: { type: 'label', text: 'next' } } });
  assert.equal(added.ok, true); assert.equal(Array.isArray(parseJsonc(added.documents[source.path]).value.base.controls), false);
  assert.deepEqual(Object.keys((await project(added.documents, 'a.screen')).document.screen.controls), ['tile', 'keep', 'next']);
  const deleted = editWorkspace({ documents: added.documents, operation: { type: 'delete', path: source.path, pointer: source.pointer, cascade: true } });
  assert.equal(deleted.ok, true); assert.deepEqual(Object.keys((await project(deleted.documents, 'a.screen')).document.screen.controls), ['keep', 'next']);
});

test('control_name-only modifications retain their original replacement body in the edit index', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls: [{ tile: { type: 'label', text: 'old' } }] },
    'screen@a.base': { modifications: [{ control_name: 'tile', operation: 'replace', value: [{ newTile: { type: 'label', text: 'new' } }] }] } } });
  const before = await project(documents, 'a.screen'), source = before.nodeSources['/screen/controls/0/newTile'];
  assert.equal(source.pointer, '/screen@a.base/modifications/0/value/0/newTile');
  assert(inspectWorkspace({ documents }).nodes.some(node => node.pointer === source.pointer));
  const result = editWorkspace({ documents, operation: { type: 'move', path: source.path, pointer: source.pointer, offset: [4, 6] } });
  assert.equal(result.ok, true); assert.deepEqual((await project(result.documents, 'a.screen')).document.screen.controls[0].newTile.offset, [4, 6]);
});

test('literal variable-backed controls and aliases retain exact declaration locations and can be edited', async () => {
  for (const controls of [[{ tile: { type: 'label', text: 'hello' } }], { tile: { type: 'label', text: 'hello' } }]) {
    const documents = encode({ 'ui/a.json': { namespace: 'a', main: { type: 'panel', '$children': controls, '$alias': '$children', controls: '$alias' } } });
    const before = await project(documents, 'a.main');
    const effective = Array.isArray(controls) ? '/main/controls/0/tile' : '/main/controls/tile';
    const source = before.nodeSources[effective];
    assert.equal(source.pointer, Array.isArray(controls) ? '/main/$children/0/tile' : '/main/$children/tile');
    assert(inspectWorkspace({ documents }).nodes.some(node => node.pointer === source.pointer));
    const result = editWorkspace({ documents, operation: { type: 'move', path: source.path, pointer: source.pointer, offset: [5, 6] } });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = (await project(result.documents, 'a.main')).document.main.controls;
    assert.deepEqual((Array.isArray(controls) ? after[0].tile : after.tile).offset, [5, 6]);
    assert.equal(parseJsonc(result.documents[source.path]).value.main.controls, '$alias');
  }
});

test('adding a child to an inherited instance preserves inherited siblings and the shared source', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls: [{ keep: { type: 'label', text: 'keep' } }] },
    main: { type: 'screen', controls: [{ 'instance@a.base': {} }, { 'other@a.base': {} }] } } });
  const result = editWorkspace({ documents, operation: { type: 'add', path: 'ui/a.json', parentPointer: '/main/controls/0/instance@a.base', name: 'added', value: { type: 'label', text: 'added' } } });
  assert.equal(result.ok, true, JSON.stringify(result));
  const raw = parseJsonc(result.documents['ui/a.json']).value;
  assert.equal(raw.main.controls[0]['instance@a.base'].controls, undefined, 'Do not shadow inherited controls with a new array');
  const projected = (await project(result.documents, 'a.main')).document.main;
  assert.deepEqual(child(projected, 'instance').controls.map(wrapper => Object.keys(wrapper)[0]), ['keep', 'added']);
  assert.deepEqual(child(projected, 'other').controls.map(wrapper => Object.keys(wrapper)[0]), ['keep']);
  assert.deepEqual(raw.base, parseJsonc(documents['ui/a.json']).value.base);
});

test('inherited add distinguishes absent controls, object maps, collisions and unknown dynamic shapes', async () => {
  for (const controls of [undefined, { keep: { type: 'label', text: 'keep' } }]) {
    const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', ...(controls ? { controls } : {}) }, 'main@a.base': {} } });
    const added = editWorkspace({ documents, operation: { type: 'add', path: 'ui/a.json', parentPointer: '/main@a.base', name: 'child', value: { type: 'label', text: 'child' } } });
    assert.equal(added.ok, true, JSON.stringify(added));
    const projected = await project(added.documents, 'a.main');
    if (controls) assert.deepEqual(Object.keys(projected.document.main.controls), ['keep', 'child']);
    else assert.deepEqual(projected.document.main.controls.map(item => Object.keys(item)[0]), ['child']);
    assert(!projected.diagnostics.some(item => item.reason === 'TARGET_ARRAY_NOT_FOUND'));
    assert.deepEqual(parseJsonc(added.documents['ui/a.json']).value.base, parseJsonc(documents['ui/a.json']).value.base);
  }
  for (const controls of [[{ keep: { type: 'panel' } }], { keep: { type: 'panel' } }]) {
    const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls }, 'main@a.base': {} } });
    const blocked = editWorkspace({ documents, operation: { type: 'add', path: 'ui/a.json', parentPointer: '/main@a.base', name: 'keep@a.base', value: { type: 'label' } } });
    assert.equal(blocked.ok, false); assert.equal(blocked.code, 'EDIT_NAME_CONFLICT'); assert.equal(blocked.documents, undefined);
  }
  for (const controls of ['$unresolved', '(unknown_dynamic_expression)']) {
    const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls }, 'main@a.base': {} } });
    const blocked = editWorkspace({ documents, operation: { type: 'add', path: 'ui/a.json', parentPointer: '/main@a.base', name: 'child', value: { type: 'label' } } });
    assert.equal(blocked.ok, false); assert.equal(blocked.code, 'EDIT_DYNAMIC_CONTROLS'); assert.equal(blocked.documents, undefined);
  }
});

test('deep object-map inheritance rejects lower-layer name collisions when adding through CLI/API', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', controls: { keep: { type: 'label', text: 'original' } } },
    'middle@a.base': { controls: { middle: { type: 'panel' } } }, 'main@a.middle': {} } });
  const blocked = editWorkspace({ documents, operation: { type: 'add', path: 'ui/a.json', parentPointer: '/main@a.middle', name: 'keep', value: { type: 'label', text: 'overwritten' } } });
  assert.equal(blocked.ok, false); assert.equal(blocked.code, 'EDIT_NAME_CONFLICT'); assert.equal(blocked.documents, undefined);
  const directMap = editWorkspace({ documents, operation: { type: 'add', path: 'ui/a.json', parentPointer: '/middle@a.base', name: 'keep', value: { type: 'label', text: 'overwritten' } } });
  assert.equal(directMap.ok, false); assert.equal(directMap.code, 'EDIT_NAME_CONFLICT'); assert.equal(directMap.documents, undefined);
  const added = editWorkspace({ documents, operation: { type: 'add', path: 'ui/a.json', parentPointer: '/main@a.middle', name: 'new', value: { type: 'label' } } });
  assert.equal(added.ok, true); const effective = (await project(added.documents, 'a.main')).document.main.controls;
  assert.deepEqual(Object.keys(effective), ['keep', 'middle', 'new']); assert.equal(effective.keep.text, 'original');
});

test('derived literal controls overrides are indexed even when controls itself is inherited', async () => {
  const documents = encode({ 'ui/a.json': { namespace: 'a', base: { type: 'panel', '$children|default': [{ original: { type: 'label', text: 'old' } }], controls: '$children' },
    'main@a.base': { '$children': [{ replacement: { type: 'label', text: 'new' } }] } } });
  const before = await project(documents, 'a.main');
  const source = before.nodeSources['/main/controls/0/replacement'];
  assert.equal(source.pointer, '/main@a.base/$children/0/replacement');
  assert(inspectWorkspace({ documents }).nodes.some(node => node.pointer === source.pointer));
  const moved = editWorkspace({ documents, operation: { type: 'move', path: source.path, pointer: source.pointer, offset: [17, 23] } });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  const after = await project(moved.documents, 'a.main'); assert.deepEqual(after.document.main.controls[0].replacement.offset, [17, 23]);
  assert.deepEqual(parseJsonc(moved.documents[source.path]).value.base, parseJsonc(documents[source.path]).value.base);
});
