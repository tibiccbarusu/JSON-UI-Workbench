import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalServer } from '../../local-node/server.mjs';
import { makeZip, manifest } from '../../local-node/tests/fixtures.mjs';
import { buildUiCatalog } from '../src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../src/engine/effective-ui-resolver.js';
import { parseJsonc } from '../src/json/jsonc.js';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../src/editor/ui-model-tree.js';
import { setSiteLocale, siteText } from '../src/i18n/site-messages.js';
import { createWorkspaceEditor, buildWorkspacePreviewSourceMap, findAuthoredNodeForPreview,
  offsetAfterAuthoredMove, selectWorkspacePreviewDefinition, keepWorkspacePreviewSourceSelection, workspacePreviewDefinitionIdentity, renderWorkspaceSourceEditor } from '../src/ui/workspace-editor.js';

const fileFor = (projection, path = 'ui/main.json') => {
  const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: path });
  return { id: `preview:${path}`, path, uiModel, ...buildTreeFromUiScreenModel(uiModel),
    meta: { previewProjection: true, selectedDefinition: projection.selected, resolution: projection } };
};
const element = (tag, attrs = {}, children = []) => ({ tag, attrs, children: children.flat(Infinity).filter(value => value !== '' && value != null), value: attrs.value ?? '' });
const descendants = node => typeof node === 'object' && node ? [node, ...(node.children || []).flatMap(descendants)] : [];
const contents = node => typeof node === 'object' && node ? (node.children || []).map(contents).join(' ') : String(node ?? '');

test('実HTTP: 継承子クリックで別ファイルを自動選択し、同じプレビューで移動・属性・追加・削除・undoする', { timeout: 30000 }, async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const cap = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' }, packId = randomUUID();
  const source = '\uFEFF{\n// template comment\n"namespace":"base","frame":{"type":"panel","size":[180,120],"controls":[{"caption":{"type":"label","text":"変更前","size":[60,20],"offset":[5,6]}}]},"sibling":{"type":"panel","alpha":0.7}}';
  const screen = '{"namespace":"a","screen@base.frame":{"type":"screen"}}';
  const upload = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': packId, 'X-JSONUI-Name': 'inherited16.zip' }, body: makeZip({
    'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/base.json","ui/main.json"]}', 'ui/base.json': source, 'ui/main.json': screen,
  }) });
  assert.equal(upload.status, 200); await upload.arrayBuffer();
  const post = async (route, data, options = {}) => {
    const response = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(data), signal: options.signal });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  let file, frame, commits = 0;
  const project = async sources => {
    const catalog = await post('catalog', { sources });
    const record = catalog.records.find(row => row.qualifiedName === 'a.screen'); assert(record);
    const projection = await post('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
    file = fileFor(projection);
    frame = await post('frame', { projectionId: projection.nodeProjectionId, filePath: file.path, preset: { width: 480, height: 270 }, generation: ++commits });
  };
  const controller = createWorkspaceEditor({ manualApply: false, request: (op, data, options) => post('workspace-' + op, data, options), onCommit: committed => project(committed.sources) });
  await controller.ensure([{ id: packId, kind: 'vanilla' }], 'inherited16');
  await controller.readDocument('ui/main.json', { sourceId: packId }); await project(controller.state.sources); controller.setMode('edit');
  const captionId = [...buildWorkspacePreviewSourceMap(file)].find(([, row]) => row.rawKey === 'caption')?.[0]; assert(captionId);
  const selectedBefore = file, boxBefore = frame.layout.boxes.find(box => box.id === captionId); assert(boxBefore);
  const target = findAuthoredNodeForPreview({ file, nodeId: captionId, nodes: controller.state.nodes, sourceId: packId, sources: controller.state.sources });
  assert.equal(target.path, 'ui/base.json'); assert.equal(target.pointer, '/frame/controls/0/caption');
  assert.equal(target.props, undefined, 'クリック前は別ファイルの原文をまだ読んでいない');
  const node = await controller.selectPreviewTarget(target, { fileId: file.id, nodeId: captionId, previewDefinitionId: workspacePreviewDefinitionIdentity(file) });
  assert.equal(file, selectedBefore, '原文選択だけではプレビューを交換しない');
  assert.equal(controller.state.activePath, 'ui/base.json'); assert.equal(controller.state.selectedPointer, node.pointer);
  assert.equal(keepWorkspacePreviewSourceSelection(controller.state, file), true, 'ensureSourceWorkspaceのread前ガード');
  const otherLayer = { ...file, meta: { ...file.meta, selectedDefinition: { ...file.meta.selectedDefinition, recordId: 'another-layer:ui/main.json#screen' } } };
  assert.equal(keepWorkspacePreviewSourceSelection(controller.state, otherLayer), false, '同パス・同名・同nodeIDでも別層のUIへ切替えたら旧層の選択を保持しない');
  selectWorkspacePreviewDefinition(controller, file, packId);
  assert.equal(controller.state.activePath, 'ui/base.json', '再表示通知が継承元の選択を奪わない');
  assert.equal(controller.previewBlocked(), false);
  const offset = offsetAfterAuthoredMove({ value: node.props, effectiveProps: file.nodesById[captionId].props, dx: 11, dy: -4 });
  await controller.edit({ type: 'set', path: node.path, sourceId: packId, pointer: `${node.pointer}/offset`, value: offset });
  const boxAfter = frame.layout.boxes.find(box => box.id === captionId); assert.equal(boxAfter.x - boxBefore.x, 11); assert.equal(boxAfter.y - boxBefore.y, -4);
  assert.equal(file.path, 'ui/main.json'); assert.equal(file.meta.selectedDefinition.qualifiedName, 'a.screen');
  assert.equal(controller.state.activePath, 'ui/base.json'); assert.equal(controller.previewBlocked(), false);
  assert.equal(keepWorkspacePreviewSourceSelection(controller.state, file), true, '再投影後も原文再読込による選択破棄を防ぐ');
  await controller.edit({ type: 'set', path: node.path, sourceId: packId, pointer: `${node.pointer}/text`, value: '変更後' });
  assert.equal(file.nodesById[captionId].props.text, '変更後');
  await controller.edit({ type: 'add', path: node.path, sourceId: packId, parentPointer: '/frame', name: 'new_label_1', value: { type: 'label', text: '追加', offset: [20, 30], size: [30, 20] } });
  assert(Object.keys(file.nodesById).some(id => id.endsWith('/new_label_1')));
  const addedPointer = controller.state.selectedPointer;
  assert.equal(controller.state.previewSelection, null, '追加された別要素に親の編集表示を持ち越さない');
  await controller.planDelete(node.path, addedPointer, packId); await controller.confirmDelete();
  assert(!Object.keys(file.nodesById).some(id => id.endsWith('/new_label_1')));
  await controller.history('undo'); assert(Object.keys(file.nodesById).some(id => id.endsWith('/new_label_1')));
  for (let count = 0; count < 3; count++) await controller.history('undo');
  assert.equal(controller.getDocument('ui/base.json', packId).text, source, 'BOM・コメント・他定義をバイト単位で復元');
  await controller.readDocument('ui/main.json', { sourceId: packId }); assert.equal(controller.getDocument().text, screen, '表示中の継承文書は書き換えない');
  await controller.edit({ type: 'add', path: 'ui/main.json', sourceId: packId, parentPointer: '/screen@base.frame', preserveInheritedControls: true,
    name: 'instance_child', value: { type: 'label', text: 'このUIへ追加', size: [70, 20], offset: [25, 30] } });
  assert(file.nodesById[captionId], '継承した既存controlsを置換せず、表示中のUIだけに追加する');
  assert(Object.keys(file.nodesById).some(id => id.endsWith('/instance_child')));
  assert.match(controller.state.selectedPointer, /\/modifications\/0\/value\/0\/instance_child$/u);
  await controller.planDelete('ui/main.json', controller.state.selectedPointer, packId); await controller.confirmDelete();
  assert(file.nodesById[captionId]); assert(!Object.keys(file.nodesById).some(id => id.endsWith('/instance_child')));
});

test('遅れた原文応答は後から選んだ同ファイル要素・原文一覧の選択を奪わない', async () => {
  for (const method of ['preview', 'pointer']) {
    const nodes = ['a', 'b'].map(name => ({ path: `ui/${name}.json`, sourceId: 'pack', pointer: `/${name}`, props: { type: 'panel' } }));
    let release;
    const controller = createWorkspaceEditor({ request: async (operation, data) => {
      if (operation === 'open') return { ok: true, workspaceId: 'w', revision: 'r', files: nodes, nodes };
      assert.equal(operation, 'read');
      const node = nodes.find(row => row.path === data.path);
      if (node.path === 'ui/a.json') await new Promise(resolve => { release = resolve; });
      return { ok: true, sourceId: 'pack', text: '{}', nodes: [node] };
    } });
    await controller.ensure([{ id: 'pack', kind: 'imported' }], 'k'); await controller.readDocument('ui/b.json', { sourceId: 'pack' });
    const pending = controller.selectPreviewTarget(nodes[0], { fileId: 'screen', nodeId: 'a' }).catch(error => error.code);
    if (method === 'preview') await controller.selectPreviewTarget(nodes[1], { fileId: 'screen', nodeId: 'b' });
    else controller.selectPointer('/b', 'ui/b.json', 'pack');
    release(); assert.equal(await pending, 'WORKSPACE_READ_SUPERSEDED');
    assert.equal(controller.state.activePath, 'ui/b.json'); assert.equal(controller.state.selectedPointer, '/b');
    assert.equal(controller.state.previewSelection?.nodeId || null, method === 'preview' ? 'b' : null);
  }
});

test('共有テンプレートの原文と反映範囲を表示し、重複名・controlsオブジェクトを添字で誤対応しない', async () => {
  const document = { namespace: 'a', tile: { type: 'panel', controls: { 'text/~': { type: 'label', text: '共有' } } }, screen: { type: 'screen', controls: [{ 'same@a.tile': {} }, { 'same@a.tile': {} }] } };
  const catalog = await buildUiCatalog({ parseJsonc, sources: [{ id: 'pack', kind: 'imported', filePaths: ['ui/main.json'], readText: async () => JSON.stringify(document) }] });
  const projection = resolveEffectiveUi({ catalog, recordId: catalog.symbols['a.screen'].winnerId }); assert(projection.ok);
  const file = fileFor(projection), mapping = buildWorkspacePreviewSourceMap(file);
  assert.equal(mapping.size, file.uiModel.stats.nodeCount);
  const leaves = [...mapping].filter(([, row]) => row.rawKey === 'text/~'); assert.equal(leaves.length, 2);
  assert.notEqual(leaves[0][0], leaves[1][0]); assert.equal(leaves[0][1].pointer, '/tile/controls/text~1~0');
  assert.equal(leaves[0][1].scope, 'shared-template'); assert.equal(leaves[0][1].instances, 2);
  const target = leaves[0][1], controller = { state: { activePath: target.path, activeSourceId: 'pack', selectedPointer: target.pointer,
    previewSelection: target, files: [], nodes: [{ ...target, props: { text: '共有' } }], drafts: new Map() } };
  const ui = renderWorkspaceSourceEditor(element, { controller, renderPicker: options => element('picker', options) });
  const badge = descendants(ui).find(row => row.attrs.class === 'workspace-selection-source'); assert(badge);
  assert.match(contents(badge), /ui\/main\.json/u); assert.match(contents(badge), /共有/u); assert.match(contents(badge), /2 要素/u);
  setSiteLocale('en_US');
  try {
    const english = renderWorkspaceSourceEditor(element, { controller, renderPicker: options => element('picker', options) });
    const englishBadge = descendants(english).find(row => row.attrs.class === 'workspace-selection-source');
    assert.match(contents(englishBadge), /Source being edited/u); assert.match(contents(englishBadge), /2 elements in the current preview/u);
    assert.equal(siteText('この要素に対応する原文を特定できません。プレビューを再計算してください。'), 'The source for this element could not be identified. Recalculate the preview.');
  } finally { setSiteLocale('ja_JP'); }
  const missing = { ...file, uiModel: { ...file.uiModel }, meta: { ...file.meta, resolution: { ...projection, nodeSources: {} } } };
  assert.equal(findAuthoredNodeForPreview({ file: missing, nodeId: leaves[0][0], nodes: [{ path: 'ui/main.json', pointer: '/screen', rawKey: 'screen' }] }), null, '出典不足を祖先へ黙って置き換えない');
});

test('公式バニラanvil: 実効1513要素のfrontend対応表と全原文を照合', { skip: !process.env.JSONUI_VANILLA_FIXTURE_DIR, timeout: 30000 }, async () => {
  const dir = process.env.JSONUI_VANILLA_FIXTURE_DIR;
  async function walk(relative = '') {
    const entries = await readdir(join(dir, relative), { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(relative, entry.name))
      : entry.name.endsWith('.json') ? [join(relative, entry.name).replaceAll('\\', '/')] : []))).flat();
  }
  const names = (await walk()).sort();
  const documents = Object.fromEntries(await Promise.all(names.map(async name => [`ui/${name}`, await readFile(join(dir, name), 'utf8')])));
  const catalog = await buildUiCatalog({ parseJsonc, sources: [{ id: 'pack', kind: 'vanilla', filePaths: Object.keys(documents), readText: async path => documents[path] }] });
  const projection = resolveEffectiveUi({ catalog, recordId: catalog.symbols['anvil.anvil_screen'].winnerId }); assert(projection.ok);
  const file = fileFor(projection, 'ui/anvil_screen.json'), mapping = buildWorkspacePreviewSourceMap(file);
  assert.equal(mapping.size, file.uiModel.stats.nodeCount); assert(mapping.size > 1000);
  const parsedDocuments = new Map();
  for (const [, target] of mapping) {
    if (!parsedDocuments.has(target.path)) parsedDocuments.set(target.path, parseJsonc(documents[target.path]).value);
    let current = parsedDocuments.get(target.path);
    for (const part of target.pointer.slice(1).split('/').map(part => part.replace(/~1/gu, '/').replace(/~0/gu, '~'))) current = current?.[part];
    assert(current && typeof current === 'object', `${target.path}#${target.pointer}`);
  }
  const artifact = { schema: 'jsonui-frontend-provenance16', documents: names.length, modelNodes: file.uiModel.stats.nodeCount,
    mappedNodes: mapping.size, crossFileNodes: [...mapping.values()].filter(row => row.path !== file.path).length,
    sharedTemplateNodes: [...mapping.values()].filter(row => row.scope === 'shared-template').length, missing: 0 };
  if (process.env.JSONUI_EDITOR16_EVIDENCE) await writeFile(process.env.JSONUI_EDITOR16_EVIDENCE, JSON.stringify(artifact, null, 2) + '\n');
});
