import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorSelection21 } from '../src/ui/editor-selection21.js';
import { exportCurrentScreenGroups21, mergeCurrentScreenGroups21, GROUP_FILE_MAX_BYTES21 } from '../src/ui/editor-group-file21.js';

const UUID = 'aa000000-1111-2222-3333-444444444444';
const copy = value => JSON.parse(JSON.stringify(value));
function file() {
  return { rootId: 'root', nodesById: {
    root: { id: 'root', isFileRoot: true, type: 'screen', props: { name: 'ui/test.json' }, children: ['panel', 'c'] },
    panel: { id: 'panel', type: 'panel', props: { name: 'parent' }, children: ['a', 'b'] },
    a: { id: 'a', type: 'image', props: { name: 'background' }, children: [] },
    b: { id: 'b', type: 'label', props: { name: 'label' }, children: [] },
    c: { id: 'c', type: 'button', props: { name: 'button' }, children: [] },
  } };
}
function context(identity = 'current-session-id') {
  return { identity, packContext: [{ kind: 'imported', uuid: UUID, version: [1, 2, 3], rootPrefix: '', entryCount: 24 }],
    path: 'ui/test.json', qualifiedName: 'test.main', file: file() };
}
function controller(identity = 'current-session-id') {
  const out = createEditorSelection21();
  out.useScreen(identity, file()); out.setSelection(['a', 'b']); out.groupSelected({ name: '背景と文字' });
  return out;
}
async function saved() {
  return exportCurrentScreenGroups21({ ...context(), metadata: controller().exportMetadata() });
}
const hasCode = code => error => error?.code === code;

test('JSON保存は現在画面一件のみ、session ID・他画面を含めない', async () => {
  const editor = controller();
  editor.useScreen('other-session-screen', file()); editor.setSelection(['b', 'c']); editor.groupSelected();
  const before = editor.exportMetadata();
  const text = await exportCurrentScreenGroups21({ ...context(), metadata: before });
  assert.equal(text.includes('current-session-id'), false);
  assert.equal(text.includes('other-session-screen'), false);
  const data = JSON.parse(text);
  assert.equal(data.schema, 'jsonui-editor-current-screen-groups');
  assert.equal(data.groups.length, 1); assert.deepEqual(data.groups[0].members, ['a', 'b']);
  assert.match(data.nodeFingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(editor.exportMetadata(), before);
});

test('再起動の異なるsession IDへ割当直し、controllerへ正常に読込できる', async () => {
  const editor = createEditorSelection21(); editor.useScreen('restarted-session', file());
  const output = await mergeCurrentScreenGroups21({ ...context('restarted-session'), text: await saved(), metadata: editor.exportMetadata() });
  editor.importMetadata(output);
  assert.equal(editor.snapshot().identity, 'restarted-session');
  assert.deepEqual(editor.snapshot().groups[0].members, ['a', 'b']);
  assert.deepEqual(editor.select('a').selectedIds, ['a', 'b']);
});

test('読込は現在画面だけ置換し、他画面の選択とグループを保持する', async () => {
  const editor = controller('other-screen');
  editor.useScreen('current-session-id', file()); editor.setSelection(['b', 'c']); editor.groupSelected();
  const before = editor.exportMetadata();
  const output = await mergeCurrentScreenGroups21({ ...context(), text: await saved(), metadata: before });
  assert.deepEqual(output.screens[0], before.screens[0]);
  assert.deepEqual(output.screens[1].groups[0].members, ['a', 'b']);
  assert.deepEqual(editor.exportMetadata(), before);
  output.screens[0].groups[0].members.push('c');
  assert.deepEqual(editor.exportMetadata(), before);
});

test('空グループ設定は現在画面だけ解除し、他画面は残す', async () => {
  const empty = createEditorSelection21(); empty.useScreen('current-session-id', file());
  const text = await exportCurrentScreenGroups21({ ...context(), metadata: empty.exportMetadata() });
  const editor = controller('other-screen'); editor.useScreen('current-session-id', file()); editor.setSelection(['a', 'b']); editor.groupSelected();
  const output = await mergeCurrentScreenGroups21({ ...context(), text, metadata: editor.exportMetadata() });
  assert.equal(output.screens[0].groups.length, 1); assert.equal(output.screens[1].groups.length, 0);
});

test('異なるパス・定義名は構造が同じでも拒否する', async () => {
  const text = await saved(), metadata = controller().exportMetadata();
  for (const changes of [{ path: 'ui/another.json' }, { qualifiedName: 'test.other' }]) {
    await assert.rejects(mergeCurrentScreenGroups21({ ...context(), ...changes, text, metadata }), hasCode('GROUP_FILE_SCREEN_MISMATCH'));
  }
});

test('異なるパックUUID・version・rootPrefix・entryCount・重ね順を拒否する', async () => {
  const text = await saved(), metadata = controller().exportMetadata();
  for (const changes of [{ uuid: 'bb000000-1111-2222-3333-444444444444' }, { version: [1, 2, 4] }, { rootPrefix: 'resources/' }, { entryCount: 25 }]) {
    const current = context(); Object.assign(current.packContext[0], changes);
    await assert.rejects(mergeCurrentScreenGroups21({ ...current, text, metadata }), hasCode('GROUP_FILE_PACK_MISMATCH'));
  }
  const current = context(); current.packContext.unshift({ ...current.packContext[0], kind: 'vanilla' });
  const both = await exportCurrentScreenGroups21({ ...current, metadata }); current.packContext.reverse();
  await assert.rejects(mergeCurrentScreenGroups21({ ...current, text: both, metadata }), hasCode('GROUP_FILE_PACK_MISMATCH'));
});

test('UUIDの大文字小文字は正規化して同一と認める', async () => {
  const current = context(); current.packContext[0].uuid = UUID.toUpperCase();
  await mergeCurrentScreenGroups21({ ...current, text: await saved(), metadata: controller().exportMetadata() });
});

test('UUIDなし・不正descriptor・同種重複は保存時に拒否する', async () => {
  for (const uuid of ['', 'legacy-pack-id', null]) {
    const current = context(); current.packContext[0].uuid = uuid;
    await assert.rejects(exportCurrentScreenGroups21({ ...current, metadata: controller().exportMetadata() }), hasCode('GROUP_FILE_PACK_ID_REQUIRED'));
  }
  for (const mutate of [c => c.packContext.push(copy(c.packContext[0])), c => { c.packContext[0].nodePackId = 'session'; }, c => { c.packContext[0].version = [1, 2]; }]) {
    const current = context(); mutate(current);
    await assert.rejects(exportCurrentScreenGroups21({ ...current, metadata: controller().exportMetadata() }));
  }
});

test('読込サイズは文字数でなくUTF-8バイト数を検査する', async () => {
  const metadata = controller().exportMetadata();
  assert.equal(GROUP_FILE_MAX_BYTES21, 1048576);
  await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text: ' '.repeat(GROUP_FILE_MAX_BYTES21 + 1), metadata }), hasCode('GROUP_FILE_LIMIT'));
  const data = JSON.parse(await saved()); data.groups[0].name = 'あ'.repeat(360000);
  const text = JSON.stringify(data); assert.ok(text.length < GROUP_FILE_MAX_BYTES21);
  await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text, metadata }), hasCode('GROUP_FILE_LIMIT'));
});

test('壊れたJSON・未知schema/version・未知項目・不正fingerprintを拒否する', async () => {
  const original = JSON.parse(await saved()), metadata = controller().exportMetadata();
  await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text: '{', metadata }), hasCode('GROUP_FILE_INVALID'));
  for (const mutate of [d => { d.schema = 'other'; }, d => { d.version = 2; }, d => { d.execute = 'bad'; }, d => { d.screen.extra = true; }, d => { d.nodeFingerprint = 'sha256:xx'; }]) {
    const data = copy(original); mutate(data);
    await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text: JSON.stringify(data), metadata }), hasCode('GROUP_FILE_INVALID'));
  }
});

test('不正・未知group項目、重複group/member/selection、群間共有を拒否する', async () => {
  const original = JSON.parse(await saved()), metadata = controller().exportMetadata();
  for (const mutate of [
    d => { d.groups[0].unknown = true; }, d => { d.groups[0].members = ['a', 'a']; },
    d => { d.groups.push(copy(d.groups[0])); }, d => { d.selectedIds = ['a', 'a']; },
    d => { d.groups.push({ id: 'group-2', name: 'other', members: ['b', 'c'] }); },
    d => { d.groups[0].members = ['a']; }, d => { d.groups[0].name = 'x'.repeat(257); },
  ]) {
    const data = copy(original); mutate(data);
    await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text: JSON.stringify(data), metadata }));
  }
});

test('prototypeに見える未知項目も拒否し、汚染しない', async () => {
  const text = (await saved()).replace('"version": 1', '"version": 1, "__proto__": {"polluted":true}');
  await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text, metadata: controller().exportMetadata() }), hasCode('GROUP_FILE_INVALID'));
  assert.equal({}.polluted, undefined);
});

test('未知ノード・root選択・祖先子孫同群は黙って除外せず拒否する', async () => {
  const original = JSON.parse(await saved()), metadata = controller().exportMetadata();
  for (const members of [['missing', 'a'], ['root', 'a'], ['panel', 'a']]) {
    const data = copy(original); data.groups[0].members = members;
    await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text: JSON.stringify(data), metadata }), hasCode('GROUP_FILE_NODE_MISMATCH'));
  }
  const data = copy(original); data.selectedIds = ['missing'];
  await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text: JSON.stringify(data), metadata }), hasCode('GROUP_FILE_NODE_MISMATCH'));
});

test('ノード名・型・順序・構造の変更をfingerprintで拒否する', async () => {
  const text = await saved(), metadata = controller().exportMetadata();
  for (const mutate of [f => { f.nodesById.a.props.name = 'other'; }, f => { f.nodesById.a.type = 'panel'; }, f => { f.nodesById.panel.children.reverse(); },
    f => { f.nodesById.panel.children = ['a']; f.nodesById.root.children.push('b'); }]) {
    const current = context(); mutate(current.file);
    await assert.rejects(mergeCurrentScreenGroups21({ ...current, text, metadata }), hasCode('GROUP_FILE_NODE_MISMATCH'));
  }
});

test('プロパティ値だけの編集と辞書挿入順は構造fingerprintを変えない', async () => {
  const current = context(); current.file.nodesById.a.props.offset = [10, 20]; current.file.nodesById.b.props.text = '編集';
  current.file.nodesById = Object.fromEntries(Object.entries(current.file.nodesById).reverse());
  await mergeCurrentScreenGroups21({ ...current, text: await saved(), metadata: controller().exportMetadata() });
});

test('不明子要素・複数親・孤立・循環・親参照不一致・辞書ID不一致を拒否する', async () => {
  for (const mutate of [f => { f.nodesById.root.children.push('missing'); }, f => { f.nodesById.root.children.push('a'); },
    f => { f.nodesById.root.children = ['panel']; }, f => { f.nodesById.a.children = ['root']; },
    f => { f.nodesById.a.parentId = 'root'; }, f => { f.nodesById.a.id = 'different'; },
    f => { f.nodesById.panel.children.push('a'); }]) {
    const current = context(); mutate(current.file);
    await assert.rejects(exportCurrentScreenGroups21({ ...current, metadata: controller().exportMetadata() }));
  }
});

test('50000ノード上限と8MiB構造上限を検査する', async () => {
  const current = context();
  current.file.nodesById = Object.fromEntries(Array.from({ length: 50001 }, (_, i) => [`n${i}`, { id: `n${i}` }]));
  await assert.rejects(exportCurrentScreenGroups21({ ...current, metadata: controller().exportMetadata() }), hasCode('GROUP_FILE_LIMIT'));
  const many = context(); many.file.nodesById.root.children = [];
  many.file.nodesById = { root: many.file.nodesById.root };
  for (let i = 0; i < 2100; i += 1) {
    const id = `n${i}`; many.file.nodesById.root.children.push(id);
    many.file.nodesById[id] = { id, props: { name: 'x'.repeat(4096) }, children: [] };
  }
  await assert.rejects(exportCurrentScreenGroups21({ ...many, metadata: controller().exportMetadata() }), hasCode('GROUP_FILE_LIMIT'));
});

test('64画面保持時の現在画面更新は許可し、65番目の追加は拒否する', async () => {
  const text = await saved();
  const metadata = { schema: 'jsonui-editor-groups-v1', screens: Array.from({ length: 64 }, (_, i) => ({ identity: `screen-${i}`, groups: [], selectedIds: [] })) };
  const result = await mergeCurrentScreenGroups21({ ...context('screen-20'), text, metadata });
  assert.equal(result.screens.length, 64); assert.equal(result.screens[20].groups.length, 1);
  await assert.rejects(mergeCurrentScreenGroups21({ ...context('screen-65'), text, metadata }), hasCode('GROUP_FILE_LIMIT'));
  assert.equal(metadata.screens[20].groups.length, 0);
});

test('未登録現在画面は読込時だけ追加し、保存時には明示的に拒否する', async () => {
  const metadata = { schema: 'jsonui-editor-groups-v1', screens: [] };
  await assert.rejects(exportCurrentScreenGroups21({ ...context(), metadata }), hasCode('GROUP_FILE_SCREEN_MISSING'));
  const result = await mergeCurrentScreenGroups21({ ...context(), text: await saved(), metadata });
  assert.equal(result.screens.length, 1); assert.equal(result.screens[0].identity, context().identity);
});

test('不正既存metadataはimport前に拒否し、入力を変更しない', async () => {
  const metadata = controller().exportMetadata(); metadata.screens.push(copy(metadata.screens[0]));
  const before = copy(metadata);
  await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text: await saved(), metadata }), hasCode('GROUP_FILE_INVALID'));
  assert.deepEqual(metadata, before);
});

test('rootPrefixとpathの絶対パス・逆走・区切り違いを拒否する', async () => {
  for (const path of ['/ui/test.json', '../ui/test.json', 'ui/../test.json', 'ui\\test.json', 'C:/ui/test.json', 'ui//test.json']) {
    await assert.rejects(exportCurrentScreenGroups21({ ...context(), path, metadata: controller().exportMetadata() }), hasCode('GROUP_FILE_INVALID'));
  }
});

test('深い12000階層でも再帰overflowなく保存と読込を行う', async () => {
  const current = context(), nodes = Object.create(null);
  nodes.root = { id: 'root', isFileRoot: true, children: ['n0', 'sibling'] };
  nodes.sibling = { id: 'sibling', children: [] };
  for (let i = 0; i < 12000; i += 1) nodes[`n${i}`] = { id: `n${i}`, children: i < 11999 ? [`n${i + 1}`] : [] };
  current.file = { rootId: 'root', nodesById: nodes };
  const editor = createEditorSelection21(); editor.useScreen(current.identity, current.file);
  editor.setSelection(['n11999', 'sibling']); editor.groupSelected();
  const metadata = editor.exportMetadata();
  const text = await exportCurrentScreenGroups21({ ...current, metadata });
  const result = await mergeCurrentScreenGroups21({ ...current, text, metadata });
  assert.deepEqual(result.screens[0].groups[0].members, ['n11999', 'sibling']);
});

test('呼出後のmetadata mutationは非同期digest中の保存結果を変えない', async () => {
  const metadata = controller().exportMetadata();
  const pending = exportCurrentScreenGroups21({ ...context(), metadata });
  metadata.screens[0].groups[0].name = 'changed';
  const data = JSON.parse(await pending);
  assert.equal(data.groups[0].name, '背景と文字');
});

test('5000グループ・50000選択ID上限を件数検証で拒否する', async () => {
  const original = JSON.parse(await saved()), metadata = controller().exportMetadata();
  const groups = copy(original);
  groups.groups = Array.from({ length: 5001 }, (_, index) => ({ id: `g${index}`, name: '', members: [`a${index}`, `b${index}`] }));
  await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text: JSON.stringify(groups), metadata }), hasCode('GROUP_FILE_LIMIT'));
  const selection = copy(original); selection.selectedIds = Array.from({ length: 50001 }, (_, index) => `n${index}`);
  await assert.rejects(mergeCurrentScreenGroups21({ ...context(), text: JSON.stringify(selection), metadata }), hasCode('GROUP_FILE_LIMIT'));
});

test('UTF-8でちょうど1MiBのJSONは入力境界を通過する', async () => {
  const text = await saved();
  const padded = text + ' '.repeat(GROUP_FILE_MAX_BYTES21 - new TextEncoder().encode(text).byteLength);
  const output = await mergeCurrentScreenGroups21({ ...context(), text: padded, metadata: controller().exportMetadata() });
  assert.equal(output.screens[0].groups.length, 1);
});

test('有効な画面でも書出結果が1MiBを超えれば保存を拒否する', async () => {
  const current = context(), nodes = { root: { id: 'root', children: [] } };
  for (let index = 0; index < 300; index += 1) {
    const id = `n${index}-${'x'.repeat(3800)}`;
    nodes.root.children.push(id); nodes[id] = { id, children: [] };
  }
  current.file = { rootId: 'root', nodesById: nodes };
  const metadata = { schema: 'jsonui-editor-groups-v1', screens: [{ identity: current.identity, groups: [], selectedIds: [...nodes.root.children] }] };
  await assert.rejects(exportCurrentScreenGroups21({ ...current, metadata }), hasCode('GROUP_FILE_LIMIT'));
});
