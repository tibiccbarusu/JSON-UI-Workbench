/** 0.12.1 基準。実際の編集controllerを含む分類保持境界を観測する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { editWorkspace, workspaceRevision } from '../../local-node/workspace-edit.mjs';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';
import { createDiagnosticsStore } from '../src/diagnostics/diagnostics-store.js';
import { createSiteDiagnosticSession } from '../src/diagnostics/site-diagnostic-session.js';

function observedFields(value) {
  return Object.fromEntries(['code', 'category', 'retryable', 'correlation_id'].map(key => [key,
    Object.hasOwn(value || {}, key) ? { present: true, value: value[key] } : { present: false },
  ]));
}

test('寸法set拒否→実controller→診断store/export/sessionでNode由来の既知分類を保持する', async () => {
  const path = 'ui/integration.json';
  const documents = { [path]: JSON.stringify({ namespace: 'integration', screen: { type: 'screen', controls: [{
    close: { type: 'button', offset: [0, 0], size: [18, 18] },
  }] } }) };
  const before = JSON.stringify(documents), revision = workspaceRevision(documents);
  let serviceReply;
  const controller = createWorkspaceEditor({ manualApply: false, request: async (action, payload) => {
    if (action === 'open') return { ok: true, workspaceId: 'integration-fixture', revision, files: [], nodes: [], sources: [], previewAllowed: true };
    if (action === 'edit') {
      serviceReply = editWorkspace({ documents, expectedRevision: payload.expectedRevision, operation: payload.operation });
      return serviceReply;
    }
    throw Error(`Unexpected fixture request: ${action}`);
  } });
  await controller.ensure([{ id: 'fixture-source', kind: 'imported' }], 'fixture-source');
  let rejected;
  try {
    await controller.edit({ type: 'set', path, pointer: '/screen/controls/0/close/offset', value: ['-50', '60'] });
  } catch (error) { rejected = error; }
  assert.ok(rejected, '不正寸法を保存しない');
  assert.equal(serviceReply.ok, false);
  assert.equal(serviceReply.error.code, 'EDIT_UI_PROPERTY_INVALID');
  assert.equal(serviceReply.error.category, 'validation');
  assert.equal(serviceReply.error.retryable, false);
  assert.equal(serviceReply.error.correlation_id, null);
  assert.equal(serviceReply.error.details[0].reason, 'DIMENSION_UNITLESS_NUMBER');
  assert.equal(JSON.stringify(documents), before);
  const store = createDiagnosticsStore();
  const session = createSiteDiagnosticSession({ diagnosticsStore: store }); session.start();
  store.captureError(rejected, { source: 'workspace-edit' });
  const entry = store.getEntries()[0], exported = store.exportSnapshot().entries[0];
  session.stop();
  const event = session.snapshot().events.find(item => item.details?.error?.code === 'EDIT_UI_PROPERTY_INVALID');
  assert.ok(event);
  for (const error of [rejected, entry.error, exported.error, event.details.error]) {
    assert.equal(error.code, 'EDIT_UI_PROPERTY_INVALID');
    assert.equal(error.category, 'validation');
    assert.equal(error.retryable, false);
    assert.equal(Object.hasOwn(error, 'correlation_id'), false);
    assert.equal(Object.hasOwn(error, 'details'), false);
  }
  const observation = {
    schema: 'unit-log-integration-v2', baseline_version: '0.12.1', latest_version_applied: true,
    validation_status: 'PASS_KNOWN_CLASSIFICATION_PRESERVED',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    transport: 'in-process request adapter; HTTP and browser DOM not exercised',
    invalid_edit_published: false, source_documents_unchanged: true,
    service_error: observedFields(serviceReply.error),
    controller_error: observedFields(rejected),
    store_error: observedFields(entry.error),
    exported_error: observedFields(exported.error),
    site_session_error: observedFields(event.details.error),
    preserved_fields: ['code', 'category', 'retryable'],
    correlation_note: 'Service returns null, representing no ID. Null is omitted by the canonical string-ID contract; no ID was invented.',
    details_note: 'Full details/cause are not forwarded. The generic code survives; no new reason classification is invented.',
  };
  session.dispose();
  if (process.env.JSONUI_INTEGRATION_EVIDENCE) await writeFile(process.env.JSONUI_INTEGRATION_EVIDENCE, JSON.stringify(observation, null, 2) + '\n');
});

async function rejectedReply(reply) {
  const controller = createWorkspaceEditor({ request: async () => reply });
  let error;
  try { await controller.ensure([{ id: 'fixture', kind: 'imported' }], 'fixture'); }
  catch (cause) { error = cause; }
  assert.ok(error);
  return error;
}

test('raw Errorの既知分類と文字列IDをfalseのまま保持し、details/causeは増やさない', async () => {
  const source = Object.assign(new Error('scope changed'), {
    code: 'EDIT_SCOPE_CHANGED', category: 'conflict', retryable: false, correlation_id: 'operation-73',
    details: { private_body: 'never-copy-body' }, cause: new Error('never-copy-cause'),
  });
  const error = await rejectedReply({ ok: false, error: source });
  assert.equal(error.code, source.code); assert.equal(error.message, source.message);
  assert.equal(error.category, source.category); assert.equal(error.retryable, false);
  assert.equal(error.correlation_id, 'operation-73');
  assert.equal(Object.hasOwn(error, 'details'), false); assert.equal(Object.hasOwn(error, 'cause'), false);
  const store = createDiagnosticsStore(); store.captureError(error);
  assert.equal(store.exportSnapshot().entries[0].error.correlation_id, 'operation-73');
  assert.ok(!JSON.stringify(store.exportSnapshot()).includes('never-copy'));
});

test('未提供/null/不正型/継承metadataは推測で補わず、data getterとProxy例外を実行経路へ漏らさない', async () => {
  const inherited = Object.assign(Object.create({ category: 'inherited', correlation_id: 'inherited-id' }), {
    code: 'EDIT_INVALID', message: 'invalid', retryable: 'false',
  });
  const nullable = { code: 'EDIT_INVALID', message: 'invalid', category: 42, retryable: null, correlation_id: null };
  let calls = 0;
  const accessor = { message: 'safe' };
  for (const key of ['code', 'category', 'retryable', 'correlation_id', 'details', 'cause']) {
    Object.defineProperty(accessor, key, { get() { calls++; throw Error('must-not-run'); } });
  }
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('descriptor-failed'); } });
  for (const source of [inherited, nullable, accessor, hostile]) {
    const error = await rejectedReply({ ok: false, code: 'EDIT_INVALID', error: source });
    assert.equal(error.code, 'EDIT_INVALID');
    for (const key of ['category', 'retryable', 'correlation_id']) assert.equal(Object.hasOwn(error, key), false);
  }
  assert.equal(calls, 0);
});

test('文字列エラーと情報なし拒否では既存のcode/message fallbackを維持する', async () => {
  const string = await rejectedReply({ ok: false, error: 'LEGACY_FAILURE' });
  assert.equal(string.code, 'LEGACY_FAILURE'); assert.equal(string.message, 'LEGACY_FAILURE');
  const empty = await rejectedReply({ ok: false, error: null });
  assert.equal(empty.code, 'WORKSPACE_REQUEST_FAILED');
  for (const error of [string, empty]) for (const key of ['category', 'retryable', 'correlation_id']) assert.equal(Object.hasOwn(error, key), false);
});

test('成功応答を変更せず受理し、不要なerror getterを読まない', async () => {
  let calls = 0;
  const reply = { ok: true, workspaceId: 'success-fixture', revision: 'revision-1', files: [], nodes: [], sources: [], previewAllowed: true };
  Object.defineProperty(reply, 'error', { get() { calls++; throw Error('success-error-must-not-run'); } });
  const before = JSON.stringify(reply);
  const controller = createWorkspaceEditor({ request: async () => reply });
  const state = await controller.ensure([{ id: 'fixture', kind: 'imported' }], 'fixture');
  assert.equal(state.workspaceId, reply.workspaceId); assert.equal(state.revision, reply.revision);
  assert.equal(state.files, reply.files); assert.equal(JSON.stringify(reply), before);
  assert.equal(calls, 0);
});
