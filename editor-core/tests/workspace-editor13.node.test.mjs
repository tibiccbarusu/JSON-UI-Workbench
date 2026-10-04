import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorkspaceEditor, findAuthoredNodeForPreview, offsetAfterAuthoredMove, renderWorkspaceSourceEditor, workspaceDocumentKey, workspaceRecordSourceId } from '../src/ui/workspace-editor.js';
import { createLocalServer } from '../../local-node/server.mjs';
import { makeZip, manifest } from '../../local-node/tests/fixtures.mjs';
import { buildUiScreenModelFromJson } from '../src/model/ui-screen-model.js';

const source = '{\n  "namespace": "demo",\n  // 原文のコメントを保持\n  "main": {"type":"screen","controls":[{"label":{"type":"label","text":"元の文字","offset":["50% + 2px",4]}}]},\n  "other@demo.main": {"type":"screen"}\n}\n';

test('原文editor controllerと実Node API: バニラ単体・不正原文・revision・継承削除・undo・限定export', async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const cap = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' };
  const request = async (operation, value, options = {}) => {
    const response = await fetch(base + 'workspace-' + operation, { method: 'POST', headers, body: JSON.stringify(value), signal: options.signal });
    if (!response.ok) { const issue = await response.json(); throw Object.assign(new Error(issue.error), { status: response.status }); }
    return options.blob ? response.blob() : response.json();
  };
  const packId = randomUUID();
  const upload = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': packId, 'X-JSONUI-Name': 'vanilla-test.zip' }, body: makeZip({
    'manifest.json': manifest, 'ui/_ui_defs.json': '{"ui_defs":["ui/demo.json","ui/unused.json"]}',
    'ui/demo.json': source, 'ui/unused.json': '{"namespace":"unused","root":{"type":"screen"}}',
  }) });
  assert.equal(upload.status, 200, upload.status === 200 ? '' : await upload.text()); await upload.arrayBuffer();
  const commits = [];
  const post = async (route, value) => {
    const response = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(value) });
    assert.equal(response.status, 200); return response.json();
  };
  const projections = [];
  const controller = createWorkspaceEditor({ manualApply: false, request, onCommit: async result => {
    commits.push(result);
    // main と同じ sources override を既存 catalog/project パイプラインに渡す。
    const catalog = await post('catalog', { sources: result.sources });
    const record = catalog.records.find(row => row.localName === 'main');
    if (record) {
      const projection = await post('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
      assert.equal(projection.ok, true); projections.push(projection.document);
    }
  } });
  await controller.ensure([{ id: packId, kind: 'vanilla' }], 'one');
  assert.equal(typeof controller.state.revision, 'string');
  await controller.readDocument('ui/demo.json');
  const originalRevision = controller.state.revision;
  controller.setMode('edit');
  controller.setDraft('ui/demo.json', '{ "namespace": ');
  assert(controller.previewBlocked());
  await assert.rejects(controller.applyDraft());
  assert(controller.previewBlocked());
  assert.equal(controller.getDraft().text, '{ "namespace": ');
  assert.equal(controller.state.revision, originalRevision);
  assert.equal((await request('read', { workspaceId: controller.state.workspaceId, path: 'ui/demo.json' })).text, source);
  controller.setMode('preview');
  assert(controller.previewBlocked(), 'モード変更で未検証の原文を表示しない');
  controller.discardDraft();
  assert.equal(controller.previewBlocked(), false);
  controller.setDraft('ui/demo.json', source.replace('元の文字', '編集後の文字'));
  await controller.applyDraft();
  assert.notEqual(controller.state.revision, originalRevision);
  assert.match(controller.getDocument().text, /原文のコメントを保持/u);
  assert.match(controller.getDocument().text, /編集後の文字/u);
  assert.equal(commits.length, 1);
  assert.equal(projections.at(-1).main.controls[0].label.text, '編集後の文字');
  const label = controller.state.nodes.find(node => node.localName === 'label');
  const offsets = offsetAfterAuthoredMove({ value: label.props, dx: 7, dy: -2 });
  await controller.edit({ type: 'set', path: label.path, pointer: label.pointer + '/offset', value: offsets });
  assert.deepEqual(controller.state.nodes.find(node => node.localName === 'label').props.offset, ['50% + 9px', 2]);
  await assert.rejects(request('edit', { workspaceId: controller.state.workspaceId, expectedRevision: originalRevision, operation: { type: 'set', path: label.path, pointer: label.pointer + '/text', value: '競合' } }), /REVISION_CONFLICT/u);
  const main = controller.state.nodes.find(node => node.localName === 'main');
  const plan = await controller.planDelete(main.path, main.pointer);
  assert.equal(plan.deletePlan.count, 3);
  assert.equal(controller.state.nodes.length, 4, '削除範囲の確認では削除しない');
  await controller.confirmDelete();
  assert(!controller.state.nodes.some(node => ['main', 'other', 'label'].includes(node.localName)));
  await controller.history('undo');
  assert(controller.state.nodes.some(node => node.localName === 'main'));
  assert(controller.state.nodes.some(node => node.localName === 'other'));
  controller.selectExport({ filePath: 'ui/demo.json', rawKey: 'main' });
  const exportPlan = await controller.export('plan');
  assert.equal(exportPlan.ok, true);
  const blob = await controller.export('zip');
  assert(blob.size > 100);
  assert.equal(controller.previewBlocked(), false);
});

test('相対offsetは率とanchorを保持し、動的・自動配置を拒否', () => {
  assert.deepEqual(offsetAfterAuthoredMove({ value: { offset: ['-50% - 1px', '10%x'] }, dx: 4, dy: -2 }), ['-50% + 3px', '10%x - 2px']);
  assert.deepEqual(offsetAfterAuthoredMove({ value: {}, effectiveProps: { offset: ['25%', 3] }, dx: 2, dy: 4 }), ['25% + 2px', 7]);
  assert.throws(() => offsetAfterAuthoredMove({ value: { offset: ['$position', 0] }, dx: 1, dy: 2 }), /動的/u);
  assert.throws(() => offsetAfterAuthoredMove({ value: {}, parentType: 'stack_panel', dx: 1, dy: 2 }), /自動配置/u);
  assert.throws(() => offsetAfterAuthoredMove({ value: { offset: [0, 0], bindings: [{ target_property_name: '#offset' }] }, dx: 1, dy: 2 }), /binding/u);
  assert.throws(() => offsetAfterAuthoredMove({ value: {}, effectiveProps: { offset: [0, 0], bindings: [{ target_property_name: '#anchor_to' }] }, dx: 1, dy: 2 }), /binding/u);
  assert.throws(() => offsetAfterAuthoredMove({ value: { offset: [0, 0], anims: ['@demo.move'] }, dx: 1, dy: 2 }), /アニメーション/u);
  assert.throws(() => offsetAfterAuthoredMove({ value: { offset: [0, 0] }, effectiveProps: { offset: [0, 0] }, frameProps: { offset: [12, 5] }, dx: 1, dy: 2 }), /実行時/u);
});

test('原文node対応は祖先と同名を確認し曖昧な候補を拒否', () => {
  const file = { path: 'ui/a.json', uiModel: buildUiScreenModelFromJson({ namespace: 'test', main: { type: 'screen', controls: [{ child: { type: 'label' } }] } }, { filePath: 'ui/a.json' }) };
  const child = file.uiModel.root.children[0].children[0];
  const nodes = [{ path: file.path, pointer: '/main', parentPointer: null, rawKey: 'main@base.main' }, { path: file.path, pointer: '/main/controls/0/child', parentPointer: '/main', rawKey: 'child' }];
  assert.equal(findAuthoredNodeForPreview({ file, nodeId: child.id, nodes })?.pointer, nodes[1].pointer);
  assert.equal(findAuthoredNodeForPreview({ file, nodeId: child.id, nodes: [...nodes, { ...nodes[1], pointer: '/main/controls/1/child' }] }), null);
  assert.equal(findAuthoredNodeForPreview({ file, nodeId: 'root/main/generated', nodes }), null);
});

test('確定後の再投影失敗では古いCanvasの再表示を禁止', async () => {
  const document = { path: 'ui/test.json', text: '{}' };
  const common = { ok: true, workspaceId: 'w', revision: 'a', files: [document], nodes: [], sources: [] };
  let failure = true;
  const controller = createWorkspaceEditor({ request: async op => op === 'read' ? { ...common, ...document } : common, onCommit: () => { if (failure) throw new Error('再投影失敗'); } });
  await controller.ensure([{ id: 'p', kind: 'imported' }], 'p'); await controller.readDocument(document.path);
  controller.setDraft(document.path, '{"a":1}');
  await assert.rejects(controller.applyDraft(), /再投影失敗/u);
  assert(controller.previewBlocked());
  failure = false; await controller.refresh();
  assert.equal(controller.previewBlocked(), false);
});

function element(tag, attrs = {}, children = []) {
  const node = { tag, attrs, children: children.flat(Infinity).filter(value => value !== '' && value != null), value: attrs.value ?? '', hidden: attrs.hidden ?? false };
  return node;
}
function descendants(node) { return typeof node === 'object' && node ? [node, ...(node.children || []).flatMap(descendants)] : []; }

test('import-safe描画境界: 原文入力・IME・保存・属性・継承・削除イベントを原文操作へ接続', async () => {
  const calls = [];
  const controller = { state: { activePath: 'ui/a.json', busy: false, files: [{ path: 'ui/a.json' }], drafts: new Map([['ui/a.json', { text: '{"namespace":"demo"}' }]]), nodes: [{ path: 'ui/a.json', pointer: '/a', rawKey: 'a@demo.base', props: { size: [30, 20], text: 'hello' }, baseRef: 'demo.base' }], selectedPointer: '/a' },
    setDraft: (...args) => calls.push(['draft', ...args]), applyDraft: (...args) => calls.push(['apply', ...args]),
    discardDraft: (...args) => calls.push(['discard', ...args]), edit: (...args) => calls.push(['edit', ...args]),
    planDelete: (...args) => calls.push(['delete-plan', ...args]), selectPointer: (...args) => calls.push(['select', ...args]),
  };
  const tree = renderWorkspaceSourceEditor(element, { controller, renderPicker: options => element('picker', options), onError: error => { throw error; } });
  const nodes = descendants(tree), sourceInput = nodes.find(node => node.attrs.id === 'workspace-source-text');
  sourceInput.attrs.onInput({ currentTarget: { value: '編集中の不正JSON {' } });
  assert.deepEqual(calls[0], ['draft', 'ui/a.json', '編集中の不正JSON {', '']);
  const key = { ctrlKey: true, key: 's', isComposing: true, preventDefault() {}, stopPropagation() {} };
  sourceInput.attrs.onKeydown(key); await Promise.resolve();
  assert.equal(calls.length, 1, 'IME確定前は保存しない');
  sourceInput.attrs.onKeydown({ ...key, isComposing: false }); await Promise.resolve();
  assert.deepEqual(calls.at(-1), ['apply', 'ui/a.json', '']);
  const picker = nodes.find(node => node.attrs.id === 'workspace-property-name');
  assert.equal(picker.attrs.value, 'size', '属性の選択表示と初期JSON値を一致させる');
  picker.attrs.onChange({ currentTarget: { value: 'text' } });
  const property = nodes.find(node => node.attrs.id === 'workspace-property-value');
  property.value = '"新しい文字"';
  property.attrs.onInput({ currentTarget: property });
  const redrawn = renderWorkspaceSourceEditor(element, { controller, renderPicker: options => element('picker', options) });
  assert.equal(descendants(redrawn).find(node => node.attrs.id === 'workspace-property-value').value, '"新しい文字"');
  assert.equal(descendants(redrawn).find(node => node.attrs.id === 'workspace-property-name').value, 'text');
  nodes.find(node => node.tag === 'button' && node.children[0] === '属性の変更を追加').attrs.onClick(); await Promise.resolve();
  assert.deepEqual(calls.at(-1), ['edit', { type: 'set', path: 'ui/a.json', pointer: '/a/text', value: '新しい文字' }]);
  nodes.find(node => node.attrs.id === 'workspace-inheritance').value = 'other.base';
  nodes.find(node => node.tag === 'button' && node.children[0] === '継承の変更を追加').attrs.onClick(); await Promise.resolve();
  assert.equal(calls.at(-1)[1].baseRef, 'other.base');
  nodes.find(node => node.tag === 'button' && node.children[0] === 'この要素の削除範囲を確認').attrs.onClick(); await Promise.resolve();
  assert.deepEqual(calls.at(-1), ['delete-plan', 'ui/a.json', '/a', '']);
});

test('遅れて返る原文読み込みは新しい選択・resetに割り込まない', async () => {
  const pending = new Map();
  const controller = createWorkspaceEditor({ request: async (op, data) => {
    if (op === 'open') return { ok: true, workspaceId: 'w', revision: 'hash', files: [], nodes: [] };
    return new Promise(resolve => pending.set(data.path, resolve));
  } });
  await controller.ensure([{ id: 'p', kind: 'imported' }], 'p');
  const first = controller.readDocument('ui/first.json');
  const second = controller.readDocument('ui/second.json');
  pending.get('ui/second.json')({ ok: true, path: 'ui/second.json', text: '{}', nodes: [] }); await second;
  pending.get('ui/first.json')({ ok: true, path: 'ui/first.json', text: '{}', nodes: [] });
  await assert.rejects(first, /SUPERSEDED/u);
  assert.equal(controller.state.activePath, 'ui/second.json');
  const stale = controller.readDocument('ui/stale.json'); controller.reset();
  pending.get('ui/stale.json')({ ok: true, text: '{}' }); await assert.rejects(stale, /SUPERSEDED/u);
  assert.equal(controller.state.activePath, '');
});

test('実配信HTMLから新編集UI・相対import graph・CSSへ到達できる', async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.port}`;
  const htmlResponse = await fetch(origin + '/');
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /プレビュー・原文編集・要素配置・選択書き出し/u);
  assert.match(html, /type="module" src="\.\.\/src\/main\.js"/u);
  const styles = await fetch(origin + '/app/styles.css');
  assert.equal(styles.status, 200);
  const css = await styles.text();
  for (const className of ['workspace-edit-toolbar', 'workspace-source-text', 'workspace-preview-gate', 'workspace-export-section']) assert(css.includes('.' + className));
  const queue = [origin + '/src/main.js'], visited = new Set();
  while (queue.length) {
    const batch = queue.splice(0, 8).filter(url => !visited.has(url));
    const outputs = await Promise.all(batch.map(async url => {
      visited.add(url);
      const response = await fetch(url); assert.equal(response.status, 200, url);
      assert.match(response.headers.get('content-type'), /javascript/u, url);
      return [url, await response.text()];
    }));
    for (const [url, text] of outputs) for (const match of text.matchAll(/^import\s+(?:[\s\S]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gmu)) {
      const target = new URL(match[1], url).href; if (!visited.has(target) && !queue.includes(target)) queue.push(target);
    }
    assert(visited.size < 1000, 'import graphの探索予算');
  }
  assert(visited.has(origin + '/src/ui/workspace-editor.js'));
  assert(visited.has(origin + '/src/pack-io/node-remote-client.js'));
});

test('mutation応答・status・原文read失敗は旧描画を停止し、再同期で原文も回復する', async () => {
  for (const failureAt of ['mutation-response', 'status', 'read']) {
    const path = 'ui/a.json'; let revision = 'r0', text = 'before', failOnce = false;
    const response = () => ({ ok: true, workspaceId: 'w', revision, files: [{ path }], nodes: [], sources: [] });
    const controller = createWorkspaceEditor({ manualApply: false, request: async op => {
      if (op === 'open') return response();
      if (op === 'edit') {
        revision = 'r1'; text = 'after'; failOnce = true;
        if (failureAt === 'mutation-response') { failOnce = false; throw new Error('応答が失われた'); }
        return response();
      }
      if (op === failureAt && failOnce) { failOnce = false; throw new Error('再読込に失敗'); }
      return op === 'read' ? { ...response(), path, text } : response();
    } });
    await controller.ensure([{ id: 'p', kind: 'imported' }], 'p'); await controller.readDocument(path);
    await assert.rejects(controller.edit({ type: 'set', path, pointer: '/a/text', value: 'after' }));
    assert(controller.previewBlocked(), failureAt);
    await controller.refresh();
    assert.equal(controller.previewBlocked(), false, failureAt);
    assert.equal(controller.state.revision, 'r1', failureAt);
    assert.equal(controller.state.documents.get(path).text, 'after', failureAt);
    assert.equal(controller.state.drafts.get(path).text, 'after', failureAt);
  }
});

test('旧パックの再投影完了は新パックの未同期状態を解除せず、edit・undo・redo・refreshを中止する', { timeout: 10000 }, async () => {
  for (const previousOperation of ['edit', 'undo', 'redo', 'refresh']) {
    const path = 'ui/a.json';
    let generation = 1, revision = 'old0';
    let serverText = '{"main":{"type":"screen","text":"old"}}';
    let enterOldCommit, releaseOldCommit, rejectNewEdit;
    const entered = new Promise(resolve => { enterOldCommit = resolve; });
    const pendingCommit = new Promise(resolve => { releaseOldCommit = resolve; });
    const response = () => ({ ok: true, workspaceId: `w${generation}`, revision, files: [{ path }], nodes: [], sources: [] });
    const controller = createWorkspaceEditor({ manualApply: false,
      request: async operation => {
        if (operation === 'read') return { ...response(), path, text: serverText };
        if (operation === 'edit') {
          serverText = '{"main":{"type":"screen","text":"new-committed"}}';
          revision = `committed-${generation}`;
          if (generation === 2) return new Promise((_, reject) => { rejectNewEdit = reject; });
        }
        return response();
      },
      onCommit: async () => { if (generation === 1) { enterOldCommit(); await pendingCommit; } },
    });
    await controller.ensure([{ id: 'old', kind: 'imported' }], 'old');
    await controller.readDocument(path);
    const operation = previousOperation === 'edit'
      ? controller.edit({ type: 'set', path, pointer: '/main/text', value: 'old-committed' })
      : previousOperation === 'refresh' ? controller.refresh() : controller.history(previousOperation);
    const oldOutcome = operation.then(() => 'unexpected-success', error => error.code);
    await entered;
    controller.reset(); generation = 2; revision = 'new0';
    serverText = '{"main":{"type":"screen","text":"new-before"}}';
    await controller.ensure([{ id: 'new', kind: 'imported' }], 'new');
    await controller.readDocument(path);
    const before = controller.getDocument().text;
    const newOutcome = controller.edit({ type: 'set', path, pointer: '/main/text', value: 'new-committed' })
      .then(() => 'unexpected-success', error => error.message);
    assert.equal(controller.state.projectionError, true);
    releaseOldCommit();
    assert.equal(await oldOutcome, 'WORKSPACE_SUPERSEDED', previousOperation);
    assert.equal(controller.state.projectionError, true, `${previousOperation}: 新しい変更の未同期状態を保持`);
    assert.equal(controller.state.message, '', `${previousOperation}: 旧操作の完了表示を出さない`);
    rejectNewEdit(new Error('COMMITTED_RESPONSE_LOST'));
    assert.equal(await newOutcome, 'COMMITTED_RESPONSE_LOST');
    assert.notEqual(serverText, before, 'サーバー側は変更確定済み');
    assert.equal(controller.getDocument().text, before, '応答消失時は旧原文のまま');
    assert.equal(controller.previewBlocked(), true, previousOperation);
    await controller.refresh();
    assert.equal(controller.previewBlocked(), false, `${previousOperation}: 明示的な再同期で回復`);
    assert.equal(controller.getDocument().text, serverText);
    assert.equal(controller.state.revision, revision);
  }
});

test('同一physical pathの2層: 原文・草稿・移動・追加・継承・削除・undoの所有元を保持', async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`;
  const cap = await (await fetch(base + 'capabilities')).json();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' };
  const request = async (operation, data, options = {}) => {
    const response = await fetch(base + 'workspace-' + operation, { method: 'POST', headers, body: JSON.stringify(data), signal: options.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const path = 'ui/shared.json', vanillaId = randomUUID(), importedId = randomUUID();
  const lower = JSON.stringify({ namespace: 'shared', main: { type: 'screen', controls: [{ label: { type: 'label', text: 'バニラ', offset: [0, 0] } }] }, template: { type: 'panel' } });
  const upper = lower.replace('バニラ', '通常');
  for (const [id, text] of [[vanillaId, lower], [importedId, upper]]) {
    const response = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id, 'X-JSONUI-Name': 'layer.zip' }, body: makeZip({ 'manifest.json': manifest, 'ui/_ui_defs.json': JSON.stringify({ ui_defs: [path] }), [path]: text }) });
    assert.equal(response.status, 200); await response.arrayBuffer();
  }
  const controller = createWorkspaceEditor({ manualApply: false, request });
  await controller.ensure([{ id: vanillaId, kind: 'vanilla' }, { id: importedId, kind: 'imported' }], 'both');
  assert.equal(controller.state.files.filter(file => file.path === path).length, 2);
  assert.equal(workspaceRecordSourceId({ sourceId: 'vanilla-reference' }, controller.state.sources), vanillaId);
  assert.equal(workspaceRecordSourceId({ sourceId: 'imported-pack' }, controller.state.sources), importedId);
  await controller.readDocument(path);
  assert.equal(controller.state.activeSourceId, importedId, '省略時は通常パックを選択');
  assert.equal(controller.getDocument().text, upper);
  controller.setDraft(path, upper.replace('通常', '通常の未適用変更'));
  await controller.readDocument(path, { sourceId: 'vanilla-reference' });
  assert.equal(controller.getDocument().text, lower);
  controller.setDraft(path, lower.replace('バニラ', 'バニラを編集'));
  await controller.applyDraft();
  assert.match(controller.getDocument().text, /バニラを編集/u);
  assert.match(controller.getDraft(path, importedId).text, /通常の未適用変更/u);
  assert.equal(controller.previewBlocked(), true, '別レイヤーの草稿を消さない');
  await controller.readDocument(path, { sourceId: importedId });
  assert.equal(controller.getDocument().text, upper);
  controller.discardDraft();
  const labelPointer = '/main/controls/0/label';
  controller.selectPointer(labelPointer);
  await controller.edit({ type: 'move', path, pointer: labelPointer, offset: [13, 21] });
  assert.deepEqual(controller.state.nodes.find(node => node.sourceId === importedId && node.pointer === labelPointer).props.offset, [13, 21]);
  await controller.readDocument(path, { sourceId: vanillaId });
  assert.deepEqual(controller.state.nodes.find(node => node.sourceId === vanillaId && node.pointer === labelPointer).props.offset, [0, 0]);
  await controller.edit({ type: 'add', path, parentPointer: '/main', name: 'added', value: { type: 'panel', size: [15, 20] } });
  const addedPointer = controller.state.selectedPointer;
  assert.equal(controller.state.nodes.find(node => node.pointer === addedPointer && node.sourceId === vanillaId).localName, 'added');
  await controller.edit({ type: 'inherit', path, pointer: addedPointer, baseRef: 'shared.template' });
  assert.match(controller.state.selectedPointer, /added@shared\.template$/u);
  const inheritedPointer = controller.state.selectedPointer;
  const plan = await controller.planDelete(path, inheritedPointer);
  assert(plan.deletePlan.affected.every(node => node.sourceId === vanillaId && node.path === path));
  await controller.confirmDelete();
  assert(!controller.state.nodes.some(node => node.sourceId === vanillaId && node.localName === 'added'));
  await controller.history('undo');
  assert(controller.state.nodes.some(node => node.sourceId === vanillaId && node.localName === 'added'));
  await controller.history('redo');
  assert(!controller.state.nodes.some(node => node.sourceId === vanillaId && node.localName === 'added'));
  const upperAfter = await request('read', { workspaceId: controller.state.workspaceId, path, sourceId: importedId });
  assert.equal(JSON.parse(upperAfter.text).main.controls[0].label.text, '通常');
  assert.deepEqual(JSON.parse(upperAfter.text).main.controls[0].label.offset, [13, 21]);
  assert.equal(JSON.parse(upperAfter.text).main.controls.length, 1, '別レイヤーへ追加・削除を誤適用しない');
  const state = await request('status', { workspaceId: controller.state.workspaceId });
  assert(Object.keys(state.sources.find(item => item.id === vanillaId).overrides).every(key => key === path));
  assert(Object.keys(state.sources.find(item => item.id === importedId).overrides).every(key => key === path));
});

test('2層の同じpointerは別の原文候補・編集選択肢として識別する', () => {
  const path = 'ui/a.json';
  const file = { path, uiModel: buildUiScreenModelFromJson({ namespace: 'test', main: { type: 'screen', controls: [{ child: { type: 'label' } }] } }, { filePath: path }) };
  const child = file.uiModel.root.children[0].children[0];
  const nodes = ['lower', 'upper'].flatMap(sourceId => [{ path, sourceId, sourceKind: sourceId === 'lower' ? 'vanilla' : 'imported', pointer: '/main', parentPointer: null, rawKey: 'main' }, { path, sourceId, pointer: '/main/controls/0/child', parentPointer: '/main', rawKey: 'child' }]);
  assert.equal(findAuthoredNodeForPreview({ file, nodeId: child.id, nodes, sourceId: 'lower' }).sourceId, 'lower');
  assert.equal(findAuthoredNodeForPreview({ file, nodeId: child.id, nodes, sourceId: 'upper' }).sourceId, 'upper');
  assert.equal(findAuthoredNodeForPreview({ file, nodeId: child.id, nodes }), null, 'source省略で同名候補を推測しない');
  assert.notEqual(workspaceDocumentKey(path, 'lower'), workspaceDocumentKey(path, 'upper'));
  assert.throws(() => workspaceRecordSourceId({ sourceId: 'vanilla-reference' }, [{ id: 'a', kind: 'vanilla' }, { id: 'b', kind: 'vanilla' }]), /一意/u);
  assert.throws(() => workspaceRecordSourceId({ sourceId: 'old-id', sourceKind: 'vanilla' }, [{ id: 'new-id', kind: 'vanilla' }]), /現在の作業領域/u);
  const selections = [];
  const controller = { state: { activePath: path, activeSourceId: 'lower', selectedPointer: '/main', files: nodes.filter(row => row.pointer === '/main'), nodes, drafts: new Map(), busy: false }, readDocument: (...args) => selections.push(args) };
  const tree = renderWorkspaceSourceEditor(element, { controller, renderPicker: options => element('picker', options) });
  const picker = descendants(tree).find(node => node.attrs.id === 'workspace-source-file');
  assert.equal(new Set(picker.attrs.entries.map(entry => entry.value)).size, 2);
  assert.match(picker.attrs.entries[0].label, /バニラ/u);
  assert.match(picker.attrs.entries[1].label, /通常パック/u);
});

test('UI登録JSON/JSONCは閲覧専用と表示し、原文操作と保存キーを送信しない', async () => {
  for (const path of ['ui/_ui_defs.json', 'ui/_ui_defs.jsonc', 'UI/_UI_DEFS.JSON']) {
    const requests = [];
    const text = '{"ui_defs":["ui/example.json"]}';
    const common = { ok: true, workspaceId: 'w', revision: 'r0', files: [{ path }], nodes: [], sources: [] };
    const controller = createWorkspaceEditor({ request: async operation => {
      requests.push(operation);
      return operation === 'read' ? { ...common, path, text } : common;
    } });
    await controller.ensure([{ id: 'p', kind: 'imported' }], 'p');
    await controller.readDocument(path);
    const tree = renderWorkspaceSourceEditor(element, { controller, renderPicker: options => element('picker', options) });
    const rows = descendants(tree);
    const input = rows.find(row => row.attrs.id === 'workspace-source-text');
    assert.equal(input.attrs.readonly, 'readonly');
    assert.equal(input.attrs.disabled, false, '原文の選択・コピーは可能');
    assert(rows.some(row => row.children.includes('UIファイルの登録は閲覧専用です。変更したパックを再読込してください。')));
    assert.equal(rows.find(row => row.tag === 'button' && row.children[0] === '検証して反映').attrs.disabled, true);
    input.attrs.onInput({ currentTarget: { value: '{"ui_defs":[]}' } });
    input.attrs.onKeydown({ ctrlKey: true, key: 's', preventDefault() {}, stopPropagation() {} });
    await Promise.resolve();
    assert.throws(() => controller.setDraft(path, '{"ui_defs":[]}'), { code: 'WORKSPACE_UI_REGISTRY_READ_ONLY' });
    await assert.rejects(controller.edit({ type: 'replaceText', path, text: '{"ui_defs":[]}' }), { code: 'WORKSPACE_UI_REGISTRY_READ_ONLY' });
    await assert.rejects(controller.planDelete(path, '/ui_defs'), { code: 'WORKSPACE_UI_REGISTRY_READ_ONLY' });
    assert.equal(controller.getDraft().text, text);
    assert.equal(controller.previewBlocked(), false);
    assert.deepEqual(requests, ['open', 'read']);
  }
});
