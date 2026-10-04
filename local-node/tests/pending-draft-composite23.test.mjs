import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliClient } from '../cli-client.mjs';
import { makeZip, manifest } from './fixtures.mjs';
const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pending-composite-')); t.after(() => rm(directory, { force: true, recursive: true }));
  const client = await CliClient.start(); t.after(() => client.close());
  const input = path.join(directory, 'draft.mcpack');
  await writeFile(input, makeZip({ 'manifest.json': manifest,
    'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/common.json', 'ui/screens.json'] }),
    'ui/common.json': JSON.stringify({ namespace: 'common', button: { type: 'button', ...origin, offset: [10, 20], size: [50, 40],
      button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: 'button.close' }],
      controls: [{ label: { type: 'label', ...origin, size: [20, 10], text: '閉じる' } }] },
      base: { type: 'screen', ...origin, size: [200, 100], controls: [{ 'btn@common.button': {} }] } }),
    'ui/screens.json': JSON.stringify({ namespace: 'demo', 'main@common.base': {}, 'other@common.base': {} }),
  }));
  const loaded = await client.importPack(input), call = (action, payload) => client.request(`/api/node/${action}`, { payload });
  const ws = await call('workspace-open', { sources: [{ id: loaded.id, kind: 'imported' }] });
  const catalog = await call('workspace-catalog', { workspaceId: ws.workspaceId });
  const record = catalog.records.find(row => row.qualifiedName === 'demo.main');
  const projection = await call('project', { catalogId: catalog.nodeCatalogId, recordId: record.id });
  const effectivePointer = Object.entries(projection.nodeSources).find(([, source]) => source.path === 'ui/common.json' && source.pointer === '/button/controls/0/label')?.[0];
  assert(effectivePointer);
  const screen = { path: 'ui/screens.json', pointer: '/main@common.base', sourceId: loaded.id };
  const move = { type: 'move', path: 'ui/common.json', pointer: '/button/controls/0/label', sourceId: loaded.id,
    screen, scope: 'screen', targetMode: 'interaction', effectivePointer, delta: [12, -5] };
  const add = { type: 'add', path: 'ui/common.json', parentPointer: '/button', name: 'added', sourceId: loaded.id,
    value: { type: 'label', ...origin, size: [20, 10], offset: [2, 4], text: '追加' } };
  const frame = { generation: 1, preset: { width: 200, height: 100 }, visibilityMode: 'safe', animationTime: 0 };
  const draft = operations => call('workspace-preview-draft', { workspaceId: ws.workspaceId, expectedRevision: ws.revision, pendingVersion: 1,
    operation: { type: 'batch', pointerBasis: 'base-revision', operations }, screen, frame });
  return { call, ws, screen, frame, move, add, draft };
}
test('共有追加→画面限定の操作親移動は草稿と確定で一致し、button mappingsを保持する', { timeout: 60000 }, async t => {
  const { call, ws, move, add, draft, frame } = await setup(t);
  const result = await draft([add, move]); assert.equal(result.ok, true, JSON.stringify(result));
  const added = result.frame.layout.boxes.find(box => box.id.endsWith('/added'));
  assert(added); assert.deepEqual([added.x, added.y], [24, 19]);
  assert.equal((await call('workspace-status', { workspaceId: ws.workspaceId })).revision, ws.revision);
  const applied = await call('workspace-edit', { workspaceId: ws.workspaceId, expectedRevision: ws.revision,
    operation: { type: 'batch', pointerBasis: 'base-revision', operations: [add, move] } });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const catalog = await call('workspace-catalog', { workspaceId: ws.workspaceId });
  const main = catalog.records.find(row => row.qualifiedName === 'demo.main'), other = catalog.records.find(row => row.qualifiedName === 'demo.other');
  const projected = await call('project', { catalogId: catalog.nodeCatalogId, recordId: main.id });
  const finalFrame = await call('frame', { ...frame, projectionId: projected.nodeProjectionId, filePath: main.filePath });
  assert.deepEqual(finalFrame.layout.boxes.map(box => [box.id, box.x, box.y, box.w, box.h]), result.frame.layout.boxes.map(box => [box.id, box.x, box.y, box.w, box.h]));
  assert.match(JSON.stringify(projected.document), /button\.close/);
  const otherProjection = await call('project', { catalogId: catalog.nodeCatalogId, recordId: other.id });
  const otherFrame = await call('frame', { ...frame, projectionId: otherProjection.nodeProjectionId, filePath: other.filePath });
  assert.deepEqual(otherFrame.layout.boxes.filter(box => box.id.endsWith('/added')).map(box => [box.x, box.y]), [[12, 24]], '共有追加は他UIへ反映し、画面限定移動は届かない');
});

test('raw操作の共有追加は、置換済みcontrolsと継承中controlsを混同しない（scope guardの根拠）', { timeout: 60000 }, async t => {
  const { draft, move, add, ws, call } = await setup(t);
  for (const targetMode of ['interaction', 'visual']) {
    const result = await draft([{ ...move, targetMode }, add]); assert.equal(result.ok, true, JSON.stringify(result));
    const added = result.frame.layout.boxes.find(box => box.id.endsWith('/added'));
    if (targetMode === 'interaction') assert.deepEqual([added.x, added.y], [24, 19]);
    else assert.equal(added, undefined, '部分編集のため置換したcontrolsへ元共有定義の追加を勝手に接続しない');
  }
  assert.equal((await call('workspace-status', { workspaceId: ws.workspaceId })).revision, ws.revision);
});
