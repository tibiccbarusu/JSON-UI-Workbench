import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliClient } from '../cli-client.mjs';
import { summarizeWorkspaceOperation } from '../workspace-operation-summary.mjs';
import { sanitizeDiagnostic } from '../debug-bundle.mjs';
import { resourceFixture } from './fixtures.mjs';

test('operation summaries retain coordinates and source identity without recording text, JSON bodies or icon bytes', () => {
  const input = { workspaceId: 'workspace', expectedRevision: 'revision', pendingVersion: 4,
    operation: { type: 'batch', operations: Array.from({ length: 20 }, () => ({ type: 'set',
      path: 'ui/screen.json', pointer: '/screen/controls/0/label', property: 'text', value: 'CONFIDENTIAL_SENTINEL', delta: [2, 3] })) },
    iconPngBase64: 'IMAGE_SENTINEL', packOptions: { name: 'PRIVATE_PACK' } };
  const result = summarizeWorkspaceOperation(input), serialized = JSON.stringify(result);
  assert.equal(result.operationCount, 20); assert.equal(result.omittedOperations, 4);
  assert.equal(result.operations.length, 16); assert.deepEqual(result.operations[0].delta, [2, 3]);
  for (const secret of ['CONFIDENTIAL_SENTINEL', 'IMAGE_SENTINEL', 'PRIVATE_PACK']) assert(!serialized.includes(secret));
  assert(!JSON.stringify(sanitizeDiagnostic({ trace: result, error: 'token=secret-value' })).includes('secret-value'));
});

test('HTTP diagnostics include independent operation history with start/result identity after noisy asset requests', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jui-debug23-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const client = await CliClient.start(); t.after(() => client.close());
  const file = path.join(directory, 'sample.mcpack'); await writeFile(file, resourceFixture());
  const imported = await client.importPack(file);
  const call = (action, payload) => client.request(`/api/node/${action}`, { payload });
  const workspace = await call('workspace-open', { sources: [{ id: imported.id, kind: 'imported' }] });
  const edited = await call('workspace-edit', { workspaceId: workspace.workspaceId, expectedRevision: workspace.revision,
    operation: { type: 'move', path: 'ui/example.json', pointer: '/screen@common.base', offset: [13, 17] } });
  assert.equal(edited.ok, true);
  await assert.rejects(() => call('workspace-read', { workspaceId: workspace.workspaceId, path: '../forbidden.json' }));
  const bundle = await call('debug-bundle', { schema: 'jsonui-debug-request-v1', browser: {}, state: {}, events: [], diagnostics: [] });
  assert.match(bundle.server.run_id, /^[a-f0-9-]{36}$/u);
  const events = bundle.server.workspace_journal.events;
  const started = events.find(event => event.event === 'WORKSPACE_OPERATION_STARTED' && event.context.action === 'workspace-edit');
  const ended = events.find(event => event.event === 'WORKSPACE_OPERATION_COMPLETED' && event.context.action === 'workspace-edit');
  assert.equal(started.correlation_id, ended.correlation_id); assert.equal(ended.context.result.ok, true);
  assert.deepEqual(started.context.operations[0].offset, [13, 17]);
  const failure = events.find(event => event.event === 'WORKSPACE_OPERATION_FAILED');
  assert(failure.context.error_code); assert(failure.context.diagnostic);
  assert(bundle.server.processor.last_failure);
  assert(!JSON.stringify(bundle).includes(client.token));
  assert.equal(bundle.privacy.pack_contents_included, false);
});
