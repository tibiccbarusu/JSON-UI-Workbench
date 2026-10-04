import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../cli.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import { loadRasterBackend } from '../frame-raster13.mjs';
import { createWorkspaceDraftPreview23 } from '../../editor-core/src/ui/workspace-draft-preview23.js';
import { CliClient } from '../cli-client.mjs';

test('Pocket ancestry and invalid event selectors remain blocked through every CLI projection command', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-context-audit38-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = path.join(directory, 'session.json'), archive = path.join(directory, 'pack.zip');
  const operation = path.join(directory, 'operation.json'), settings = path.join(directory, 'settings.json');
  const doc = { namespace: 'audit38', main: { type: 'panel', size: [100, 60], controls: [
    { events: { type: 'factory', control_ids: { normal: '@audit38.normal', touch: '@touch.screen', inherited: '@audit38.inherited' } } },
  ] }, normal: { type: 'panel', size: [10, 10] }, 'inherited@touch.screen': { type: 'panel' } };
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/test.json': JSON.stringify(doc),
    'ui/pocket/mobile.json': JSON.stringify({ namespace: 'touch', screen: { type: 'screen' } }) }));
  await writeFile(operation, JSON.stringify({ type: 'move', path: 'ui/test.json', pointer: '/main', offset: [1, 1] }));
  await runCli(['import', '--session', session, '--pack', archive]);
  const catalog = await runCli(['definitions', '--session', session]);
  assert(catalog.result.items.some(row => row.qualifiedName === 'touch.screen'), 'Pocket remains readable in catalog');
  for (const [selector, expected] of [
    [{ events: 'missing' }, 'UI_EVENT_FACTORY_CONTROL_ID_NOT_FOUND'],
    [{ absent: 'normal' }, 'UI_EVENT_FACTORY_SELECTOR_NOT_FOUND'],
    [{ events: 'touch' }, 'POCKET_DEPENDENCY_BLOCKED'],
    [{ events: 'inherited' }, 'POCKET_DEPENDENCY_BLOCKED'],
  ]) {
    await writeFile(settings, JSON.stringify({ event_factory_selections: selector }));
    await runCli(['settings', '--session', session, '--file', settings]);
    for (const command of ['validate', 'preview', 'draft', ...(loadRasterBackend() ? ['png'] : [])]) {
      const out = path.join(directory, `${command}.` + (command === 'png' ? 'png' : 'json'));
      const args = [command === 'png' ? 'preview' : command, '--session', session, '--file', 'ui/test.json', '--definition', 'audit38.main', '--out', out];
      if (command === 'draft') args.push('--operation', operation);
      await assert.rejects(runCli(args), { code: expected }, `${command}: ${JSON.stringify(selector)}`);
      await assert.rejects(readFile(out), { code: 'ENOENT' });
    }
  }
});

test('GUI draft scheduling keys include event branch and discard a stale previous branch', async () => {
  let snapshot = { workspaceId: 'workspace', expectedRevision: 'r1', pendingVersion: 1,
    screen: { path: 'ui/form.json' }, eventFactorySelections: { factory: 'first' } };
  const seen = [], releases = [];
  const controller = createWorkspaceDraftPreview23({ readSnapshot: () => snapshot, delayMs: 0,
    project: current => new Promise(resolve => { seen.push(current.eventFactorySelections.factory);
      releases.push(() => resolve({ ok: true, pendingVersion: 1, baseRevision: 'r1', branch: current.eventFactorySelections.factory })); }) });
  try {
    const first = controller.flush();
    await new Promise(resolve => setTimeout(resolve, 0));
    snapshot = { ...snapshot, eventFactorySelections: { factory: 'second' } };
    void controller.flush();
    releases.shift()();
    await first;
    await new Promise(resolve => setTimeout(resolve, 0));
    const second = controller.flush();
    releases.shift()();
    const result = await second;
    assert.deepEqual(seen, ['first', 'second']);
    assert.equal(result.branch, 'second');
    assert.equal(controller.getStatus().superseded, 1);
  } finally { controller.cancel(); }
});

test('Node projection recipe restores the same event branch after the 16-entry projection cache evicts it', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jsonui-recipe-audit38-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'pack.zip');
  const doc = { namespace: 'recipe38', main: { type: 'panel', size: [100, 60], controls: [
    { events: { type: 'factory', control_ids: { first: '@recipe38.first', second: '@recipe38.second' } } },
  ] }, first: { type: 'panel', size: [21, 12] }, second: { type: 'panel', size: [42, 24] } };
  await writeFile(archive, makeZip({ 'manifest.json': manifest, 'ui/test.json': JSON.stringify(doc) }));
  const client = await CliClient.start(); t.after(() => client.close());
  const pack = await client.importPack(archive);
  const catalog = await client.request('/api/node/catalog', { payload: { sources: [{ id: pack.id, kind: 'imported' }] } });
  const record = catalog.records.find(row => row.qualifiedName === 'recipe38.main');
  const firstRequest = { catalogId: catalog.nodeCatalogId, recordId: record.id, eventFactorySelections: { events: 'first' } };
  const first = await client.request('/api/node/project', { payload: firstRequest });
  assert.equal(first.ok, true);
  for (let index = 0; index < 17; index++) {
    const changed = await client.request('/api/node/project', { payload: { ...firstRequest,
      variables: { '$recipe_number': index }, eventFactorySelections: { events: 'second' } } });
    assert.equal(changed.ok, true);
    assert.notEqual(changed.nodeProjectionId, first.nodeProjectionId);
  }
  const frame = await client.request('/api/node/frame', { payload: { projectionId: first.nodeProjectionId, recordId: record.id,
    filePath: record.filePath, preset: { width: 480, height: 270 }, generation: 0, visibilityMode: 'safe' } });
  assert.equal(frame.schema, 'jsonui-frame-v1');
  assert(frame.layout.boxes.some(box => box.id.endsWith('/first') && box.w === 21));
  assert.equal(frame.layout.boxes.some(box => box.id.endsWith('/second')), false);
  const diagnostics = await client.request('/api/node/debug-bundle', { payload: { schema: 'jsonui-debug-request-v1' } });
  assert(JSON.stringify(diagnostics).includes('projection_restores'));
  // Different server adapters expose metrics in different envelope positions;
  // the frame dimensions above are the observable restoration contract.
});
