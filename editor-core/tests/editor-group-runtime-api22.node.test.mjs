import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalServer } from '../../local-node/server.mjs';
import { makeZip, manifest } from '../../local-node/tests/fixtures.mjs';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';
import { createEditorSelection21 } from '../src/ui/editor-selection21.js';
import { groupPackContext21 } from '../src/ui/editor-group-runtime21.js';
import { exportCurrentScreenGroups21, mergeCurrentScreenGroups21 } from '../src/ui/editor-group-file21.js';

test('実Node再起動: 同一mcpackを再importし、別sessionへ画面グループを復元', { timeout: 55000 }, async t => {
  const path = 'ui/groups.json', qualifiedName = 'demo.main';
  const bytes = makeZip({ 'pack/manifest.json': manifest,
    'pack/ui/_ui_defs.json': JSON.stringify({ ui_defs: [path] }),
    'pack/ui/groups.json': JSON.stringify({ namespace: 'demo', main: { type: 'screen', controls: [
      { background: { type: 'panel', size: [100, 50] } }, { title: { type: 'label', text: '題名', size: [30, 10] } },
    ] } }),
  });
  async function importedSession() {
    const app = await createLocalServer({ port: 0 });
    try {
      const base = `http://127.0.0.1:${app.port}/api/node/`, id = randomUUID();
      const { token } = await (await fetch(base + 'capabilities')).json();
      const headers = { 'X-JSONUI-Token': token, 'Content-Type': 'application/json' };
      const upload = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip',
        'X-JSONUI-Upload-ID': id, 'X-JSONUI-Name': 'groups22.mcpack' }, body: bytes });
      assert.equal(upload.status, 200);
      const metadata = await upload.json();
      const post = async (route, payload) => {
        const response = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(payload) });
        const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
      };
      const catalog = await post('catalog', { sources: [{ id, kind: 'imported' }] });
      const record = catalog.records.find(row => row.qualifiedName === qualifiedName); assert(record);
      const projection = await post('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
      const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: path });
      const file = { id: `screen:${path}`, path, uiModel, ...buildTreeFromUiScreenModel(uiModel) };
      // main と同じ、Node応答 metadata + nodePackId reader の runtime 構造。
      const runtime = { ...metadata, zipReader: { nodePackId: id } };
      const identity = JSON.stringify([[['imported', id]], path, qualifiedName]);
      return { file, identity, path, qualifiedName, packContext: groupPackContext21({ imported: runtime }), maxScreens: 512 };
    } finally { await app.close(); }
  }
  const first = await importedSession();
  const selected = createEditorSelection21({ maxScreens: 512 }); selected.useScreen(first.identity, first.file);
  const members = Object.keys(first.file.nodesById).filter(id => id.endsWith('/background') || id.endsWith('/title'));
  assert.equal(members.length, 2); selected.setSelection(members); selected.groupSelected({ name: '再起動後のグループ' });
  const text = await exportCurrentScreenGroups21({ ...first, metadata: selected.exportMetadata() });
  const second = await importedSession();
  assert.notEqual(first.identity, second.identity);
  assert.deepEqual(first.packContext, second.packContext);
  assert.equal(second.packContext[0].rootPrefix, 'pack/');
  const restored = createEditorSelection21({ maxScreens: 512 }); restored.useScreen(second.identity, second.file);
  restored.importMetadata(await mergeCurrentScreenGroups21({ ...second, text, metadata: restored.exportMetadata() }));
  assert.deepEqual(restored.select(members[0]).selectedIds, members);
  assert.equal(restored.snapshot().groups[0].name, '再起動後のグループ');
  t.diagnostic(`Nodeサーバーを閉じて再作成。同一ZIP ${bytes.length} bytes、要素数 ${Object.keys(second.file.nodesById).length}、保存グループ数 ${restored.snapshot().groups.length}。`);
});
