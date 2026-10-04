import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalServer } from '../../local-node/server.mjs';
import { makeZip, manifest } from '../../local-node/tests/fixtures.mjs';
import { createWorkspaceEditor } from '../src/ui/workspace-editor.js';
import { nodeWorkspaceRequest } from '../src/pack-io/node-remote-client.js';
import { workspaceExportError, workspaceExportDiagnosticSummary, renderWorkspaceExportReport } from '../src/ui/workspace-export-report.js';
import { setSiteLocale } from '../src/i18n/site-messages.js';

test('実HTTPの拒否JSONをZIPと誤認せず理由を保持し、修正後は同じ編集revisionからZIPを返す', { timeout: 60000 }, async t => {
  const app = await createLocalServer({ port: 0 });
  const nativeFetch = globalThis.fetch, priorWindow = globalThis.window;
  t.after(async () => { globalThis.fetch = nativeFetch; if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; await app.close(); });
  const base = `http://127.0.0.1:${app.port}`;
  const cap = await (await nativeFetch(base + '/api/node/capabilities')).json();
  const headers = { 'X-JSONUI-Token': cap.token, 'Content-Type': 'application/json' };
  const packId = randomUUID();
  const upload = await nativeFetch(base + '/api/node/packs', { method: 'POST', headers: { ...headers,
    'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': packId, 'X-JSONUI-Name': 'export-test.zip' }, body: makeZip({
      'manifest.json': manifest, 'ui/main.json': '{"namespace":"test","screen":{"type":"image","texture":"textures/missing","size":[8,8]}}',
      'ui/_ui_defs.json': '{"ui_defs":["ui/main.json"]}', 'textures/present.png': Buffer.from([1, 2, 3]),
    }) });
  assert.equal(upload.status, 200, upload.status === 200 ? '' : await upload.text()); await upload.arrayBuffer();
  globalThis.window = {};
  globalThis.fetch = (url, options) => nativeFetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, options);
  const editor = createWorkspaceEditor({ request: nodeWorkspaceRequest });
  await editor.ensure([{ id: packId, kind: 'imported' }], 'one');
  await editor.readDocument('ui/main.json');
  editor.selectExport({ filePath: 'ui/main.json', rawKey: 'screen', sourceId: packId });
  const revision = editor.state.revision;
  for (const mode of ['zip', 'plan']) {
    await assert.rejects(editor.export(mode), error => {
      assert.equal(error.code, 'WORKSPACE_EXPORT_UNRESOLVED');
      assert(error.exportResult.plan.unresolved.some(row => row.code === 'EXPORT_TEXTURE_MISSING' && row.reference === 'textures/missing'));
      assert.match(error.message, /未解決/); return true;
    });
    assert.equal(editor.state.revision, revision); assert.equal(editor.state.busy, false);
    assert.equal(editor.previewBlocked(), false);
    assert.equal(editor.state.exportPlan.ok, false);
    assert(workspaceExportDiagnosticSummary(editor.state.exportPlan).unresolved.some(row => row.code === 'EXPORT_TEXTURE_MISSING'));
  }
  const text = editor.getDraft().text.replace('textures/missing', 'textures/present');
  editor.setDraft('ui/main.json', text); await editor.applyDraft();
  assert.equal(editor.state.exportPlan, null);
  const committedRevision = editor.state.revision;
  const blob = await editor.export('zip');
  assert(blob instanceof Blob); assert.equal(blob.type, 'application/zip');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer()).slice(0, 4)], [80, 75, 3, 4]);
  assert.equal(editor.state.revision, committedRevision);
});

const result = { ok: false, plan: { schema: 'jsonui-workspace-export-plan/v1', ok: false, files: [],
  selectedDefinitions: [], unresolved: [{ code: 'EXPORT_TEXTURE_MISSING', path: 'ui/main.json', reference: '<img onerror=alert(1)>' }], warnings: [] } };
const h = (tag, attrs, children) => ({ tag, attrs, children });
function allText(value) { return typeof value === 'string' ? value : (value?.children || []).map(allText).join(' '); }
test('理由を日英で表示し、原文の参照文字列をHTMLとして挿入しない', () => {
  try {
    setSiteLocale('ja_JP'); assert.match(workspaceExportError(result).message, /未解決/);
    const ja = renderWorkspaceExportReport(h, result); assert.match(allText(ja), /EXPORT_TEXTURE_MISSING/);
    assert.match(allText(ja), /<img onerror=alert\(1\)>/);
    assert(!JSON.stringify(ja).includes('innerHTML'));
    setSiteLocale('en_US'); assert.match(workspaceExportError(result).message, /Export stopped/);
    assert.match(allText(renderWorkspaceExportReport(h, result)), /Issues blocking export: 1/);
  } finally { setSiteLocale('ja_JP'); }
});

test('古い書き出しの失敗はリセット後の別workspaceに計画を戻さず、診断は件数を保って有界化', async () => {
  let rejectExport;
  const editor = createWorkspaceEditor({ request: async (op) => {
    if (op === 'open') return { ok: true, workspaceId: 'workspace', revision: 'one', files: [], nodes: [], sources: [] };
    if (op === 'export') return new Promise((_resolve, reject) => { rejectExport = reject; });
    return { ok: true };
  } });
  await editor.ensure([{ id: 'pack' }], 'one'); editor.selectExport({ filePath: 'ui/main.json', rawKey: 'screen' });
  const pending = editor.export('zip'); editor.reset(); rejectExport(workspaceExportError(result));
  await assert.rejects(pending, { code: 'WORKSPACE_SUPERSEDED' });
  assert.equal(editor.state.exportPlan, null); assert.equal(editor.state.error, '');
  const large = { ...result, plan: { ...result.plan, unresolved: Array(120).fill({ code: 'EXPORT_X', reference: 'x'.repeat(10000) }) } };
  const summary = workspaceExportDiagnosticSummary(large);
  assert.equal(summary.unresolvedCount, 120); assert.equal(summary.unresolved.length, 100);
  assert.equal(summary.omittedUnresolved, 20); assert.equal(summary.unresolved[0].reference.length, 512);
});
