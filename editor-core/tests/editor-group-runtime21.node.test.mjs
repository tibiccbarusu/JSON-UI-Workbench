import test from 'node:test';
import assert from 'node:assert/strict';
import { extractManifestSummary } from '../src/pack-io/manifest-utils.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';
import { createEditorSelection21 } from '../src/ui/editor-selection21.js';
import { groupPackContext21 } from '../src/ui/editor-group-runtime21.js';
import { exportCurrentScreenGroups21, mergeCurrentScreenGroups21 } from '../src/ui/editor-group-file21.js';

const uuid = '1f64c300-214f-4ff8-a46e-d54296718af6';
const packPaths = ['manifest.json', 'ui/_ui_defs.json', 'ui/main.json'];
const manifest = { format_version: 2, header: { name: '実構造グループ検査', uuid, version: [1, 2, 3], min_engine_version: [1, 21, 0] }, modules: [{ type: 'resources', uuid: '2f64c300-214f-4ff8-a46e-d54296718af6', version: [1, 2, 3] }] };
const runtime = id => ({ zipReader: { nodePackId: id }, manifestSummary: extractManifestSummary(manifest), rootPrefix: '', packPaths: [...packPaths] });
function file() {
  const path = 'ui/main.json';
  const uiModel = buildUiScreenModelFromJson({ namespace: 'demo', main: { type: 'screen', controls: [
    { background: { type: 'image', size: [100, 50], texture: 'textures/ui/blank' } },
    { title: { type: 'label', text: '題名', size: [50, 10] } },
  ] } }, { filePath: path });
  return { id: `screen:${path}`, path, uiModel, ...buildTreeFromUiScreenModel(uiModel), meta: { selectedDefinition: { qualifiedName: 'demo.main' } } };
}

test('実manifest summaryの文字列versionを変換し、重ね順とセッション非依存を保持する', () => {
  const imported = runtime('session-a'), vanilla = runtime('vanilla-session-a');
  assert.equal(imported.manifestSummary.header.version, '1.2.3');
  const original = structuredClone(imported);
  const context = groupPackContext21({ imported, vanilla });
  assert.deepEqual(context.map(row => row.kind), ['vanilla', 'imported']);
  assert.deepEqual(context[1], { kind: 'imported', uuid, version: [1, 2, 3], rootPrefix: '', entryCount: 3 });
  assert.equal(JSON.stringify(context).includes('session-a'), false);
  assert.deepEqual(groupPackContext21({ imported: runtime('session-b') }), [context[1]]);
  assert.deepEqual(imported, original);
});

test('同じパックと実modelを新しいsessionで作り直し、保存グループを復元する', async () => {
  const originalFile = file(), oldRuntime = runtime('session-before'), restoredFile = file(), newRuntime = runtime('session-after');
  const oldIdentity = JSON.stringify([[['imported', oldRuntime.zipReader.nodePackId]], originalFile.path, 'demo.main']);
  const newIdentity = JSON.stringify([[['imported', newRuntime.zipReader.nodePackId]], restoredFile.path, 'demo.main']);
  assert.notEqual(oldIdentity, newIdentity);
  const before = createEditorSelection21({ maxScreens: 512 });
  before.useScreen(oldIdentity, originalFile);
  const members = Object.keys(originalFile.nodesById).filter(id => id.endsWith('/background') || id.endsWith('/title'));
  assert.equal(members.length, 2);
  before.setSelection(members); before.groupSelected({ name: '背景と題名' });
  const text = await exportCurrentScreenGroups21({ file: originalFile, path: originalFile.path, qualifiedName: 'demo.main',
    packContext: groupPackContext21({ imported: oldRuntime }), identity: oldIdentity, metadata: before.exportMetadata(), maxScreens: 512 });
  const restored = createEditorSelection21({ maxScreens: 512 }); restored.useScreen(newIdentity, restoredFile);
  const metadata = await mergeCurrentScreenGroups21({ text, file: restoredFile, path: restoredFile.path, qualifiedName: 'demo.main',
    packContext: groupPackContext21({ imported: newRuntime }), identity: newIdentity, metadata: restored.exportMetadata(), maxScreens: 512 });
  restored.importMetadata(metadata);
  assert.deepEqual(restored.select(members[0]).selectedIds, members);
  assert.equal(restored.snapshot().groups[0].name, '背景と題名');
  assert.equal(text.includes('session-before'), false);
  assert.equal(text.includes('session-after'), false);
});

test('曖昧なversion文字列は推測・丸め・不足埋めせず拒否する', () => {
  for (const version of [null, [1, 2, 3], '1.2', '1.2.3-preview', '01.2.3', '-1.2.3', '1.2.3.4', '2147483648.0.0']) {
    const imported = runtime('session'); imported.manifestSummary.header.version = version;
    assert.throws(() => groupPackContext21({ imported }), { code: 'GROUP_FILE_PACK_VERSION_REQUIRED' });
  }
});
