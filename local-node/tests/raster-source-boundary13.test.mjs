import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CliClient } from '../cli-client.mjs';
import { renderFramePng, loadRasterBackend } from '../frame-raster13.mjs';
import { makeZip, manifest } from './fixtures.mjs';
import pngjs from '../vendor/pngjs/lib/png.js';

const backend = loadRasterBackend();

test('wrapper ZIP の実 prefix を使い、偽入力と edit/undo/redo を通じて PNG の素材を同一層から取得する', { skip: !backend, timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jsonui-raster-source13-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'wrapped.zip');
  const document = { namespace: 'wrapped', screen: { type: 'screen', size: [32, 32],
    anchor_from: 'top_left', anchor_to: 'top_left', controls: [{ image: { type: 'image',
      texture: 'textures/ui/color', size: [16, 16], anchor_from: 'top_left', anchor_to: 'top_left' } }] } };
  const texture = pngjs.PNG.sync.write({ width: 2, height: 2, data: Buffer.from([
    255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
  ]) });
  await writeFile(input, makeZip({ 'Pack/manifest.json': manifest,
    'Pack/ui/_ui_defs.json': '{"ui_defs":["ui/wrapped.json"]}',
    'Pack/ui/wrapped.json': JSON.stringify(document), 'Pack/textures/ui/color.png': texture }));
  const client = await CliClient.start();
  t.after(() => client.close());
  const imported = await client.importPack(input);
  assert.equal(imported.rootPrefix, 'Pack/');
  let workspace = await client.request('/api/node/workspace-open', { payload: {
    sources: [{ id: imported.id, kind: 'imported', rootPrefix: '../../forged/' }],
  } });
  const originalRevision = workspace.revision;
  async function assertPreview(state, pixelX) {
    assert.equal(state.sources[0].rootPrefix, 'Pack/');
    const catalog = await client.request('/api/node/workspace-catalog', { payload: { workspaceId: state.workspaceId } });
    const record = catalog.records.find(row => row.qualifiedName === 'wrapped.screen');
    const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id } });
    const frameRequest = { projectionId: projection.nodeProjectionId, recordId: record.id,
      filePath: record.filePath, preset: { width: 32, height: 32 }, generation: 0 };
    const frame = await client.request('/api/node/frame', { payload: frameRequest });
    // This is the same source surface used by cli.mjs, with no client-added prefix.
    const rendered = await renderFramePng({ client, sources: state.sources, projection, frame,
      frameRequest, width: 32, height: 32, backend });
    assert.equal(rendered.ok, true, JSON.stringify(rendered));
    assert.equal(rendered.complete, true, JSON.stringify(rendered.diagnostics));
    const pixels = pngjs.PNG.sync.read(rendered.png);
    const offset = (2 * pixels.width + pixelX) * 4;
    assert.deepEqual([...pixels.data.subarray(offset, offset + 4)], [255, 0, 0, 255]);
    assert(rendered.provenance.some(row => row.source === 'imported' && row.packPath === 'textures/ui/color.png'));
  }
  await assertPreview(workspace, 2);
  workspace = await client.request('/api/node/workspace-edit', { payload: {
    workspaceId: workspace.workspaceId, expectedRevision: workspace.revision,
    operation: { type: 'set', path: 'ui/wrapped.json', sourceId: 'imported', pointer: '/screen/controls/0/image/offset', value: [4, 0] },
  } });
  assert.equal(workspace.sources[0].rootPrefix, 'Pack/');
  const editedRevision = workspace.revision;
  await assertPreview(workspace, 6);
  workspace = await client.request('/api/node/workspace-undo', { payload: {
    workspaceId: workspace.workspaceId, expectedRevision: workspace.revision,
  } });
  assert.equal(workspace.revision, originalRevision);
  assert.equal(workspace.sources[0].rootPrefix, 'Pack/');
  assert.deepEqual(workspace.sources[0].overrides, {});
  workspace = await client.request('/api/node/workspace-redo', { payload: {
    workspaceId: workspace.workspaceId, expectedRevision: workspace.revision,
  } });
  assert.equal(workspace.revision, editedRevision);
  await assertPreview(workspace, 6);
});
