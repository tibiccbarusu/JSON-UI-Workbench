/** Actual HTTP regression: edit shared vanilla child, export selected anvil, reimport. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CliClient } from './cli-client.mjs';
import { loadRasterBackend, renderFramePng } from './frame-raster13.mjs';
import { createWorkspaceEditor } from '../editor-core/src/ui/workspace-editor.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';
import pngjs from './vendor/pngjs/lib/png.js';

const [vanillaPath, inventoryPath, outputDir] = process.argv.slice(2);
if (!vanillaPath || !inventoryPath || !outputDir) throw new Error('Usage: node local-node/verify-common-export19.mjs <public-vanilla.zip> <inventory-background.zip> <new-evidence-directory>');
await mkdir(outputDir, { recursive: false });
assert(loadRasterBackend(), 'Native Canvas backend unavailable');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parentPointer = '/close_button_panel/controls/0/close_button_image@close_button_image';
const childPointer = parentPointer + '/controls/0/new_button_1';
const commonPath = 'ui/ui_common.json';
const report = { schema: 'jsonui-common-http-export19', status: 'INCONCLUSIVE', started_at: new Date().toISOString(),
  runtime: process.version, inputs: [], scenarios: [], limitations: [
    '提供vanilla原本ではなく固定コミットの公開Mojang資料を使用した。両者は同一と扱わない。',
    '実HTTPと製品Node描画関数を使用した。ブラウザ操作、Windows実操作、Minecraft実機画素一致は未検査。',
    'allowPartial=trueで画像を生成する。各画像のcompleteと全diagnosticsを保存し、不完全な画像を完全一致の証拠にはしない。',
    '添付ログには追加子の原文がないため、親pointerと子名を一致させ、子のtext/offset/sizeは検査用の値を使用した。'
  ] };
const save = (name, value) => writeFile(path.join(outputDir, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
for (const [kind, filename] of [['vanilla', vanillaPath], ['imported', inventoryPath]]) {
  const bytes = await readFile(filename); report.inputs.push({ kind, name: path.basename(filename), bytes: bytes.length, sha256: hash(bytes) });
}
function decoded(text) { const parsed = parseJsonc(text); assert(parsed.ok, JSON.stringify(parsed.diagnostics)); return parsed.value; }
function target(document) { return document.close_button_panel.controls[0]['close_button_image@close_button_image'].controls[0].new_button_1; }
let client;
try {
  for (const layered of [true, false]) {
    const name = layered ? 'layered' : 'vanilla-only', scenario = { name, status: 'INCONCLUSIVE', checks: [] };
    report.scenarios.push(scenario);
    const check = (title, detail = {}) => { const item = { name: title, status: 'PASS', ...detail }; scenario.checks.push(item); console.log(JSON.stringify({ scenario: name, ...item })); };
    client = await CliClient.start();
    let sources = [], projection, frame, frameRequest, generation = 0;
    const originalRequest = client.request.bind(client);
    client.request = async (route, options) => { const result = await originalRequest(route, options); if (route === '/api/node/frame') frame = result; return result; };
    for (const [kind, filename] of [['vanilla', vanillaPath], ...(layered ? [['imported', inventoryPath]] : [])]) {
      const loaded = await client.importPack(filename); sources.push({ kind, id: loaded.id, rootPrefix: loaded.rootPrefix });
    }
    const cleanVanilla = { ...sources.find(source => source.kind === 'vanilla'), overrides: {} };
    async function project(nextSources = sources) {
      sources = nextSources;
      const catalog = await client.request('/api/node/catalog', { payload: { sources } });
      const record = catalog.records.filter(row => row.qualifiedName === 'anvil.anvil_screen').sort((a, b) => b.precedence - a.precedence)[0];
      assert(record, 'Anvil definition absent');
      projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id,
        variables: buildRepresentativeClassicResolverVariables({ qualifiedName: record.qualifiedName }),
        representativeCollections: buildRepresentativeClassicCollections({ qualifiedName: record.qualifiedName }) } });
      assert(projection.ok, JSON.stringify(projection.error));
      frameRequest = { projectionId: projection.nodeProjectionId, filePath: record.filePath, generation: ++generation,
        preset: { width: 480, height: 270 }, animationTime: 1, visibilityMode: 'safe' };
      frame = await client.request('/api/node/frame', { payload: frameRequest }); assert(Array.isArray(frame.layout?.boxes), JSON.stringify(frame.error));
    }
    async function raster(suffix) {
      const result = await renderFramePng({ client, sources, projection, frame, frameRequest,
        width: 1920, height: 1080, uiScale: 4, locale: 'ja_JP', timeSeconds: 1, allowPartial: true });
      assert(result.ok, JSON.stringify({ code: result.code, diagnostics: result.diagnostics }));
      await save(name + '-' + suffix + '.png', result.png);
      scenario[suffix] = { png_sha256: hash(result.png), complete: result.complete, diagnostics: result.diagnostics,
        rendering: result.rendering, provenance: result.provenance };
      return result.png;
    }
    const editor = createWorkspaceEditor({ request: (op, payload) => client.request('/api/node/workspace-' + op, { payload }), onCommit: state => project(state.sources) });
    await editor.ensure(sources, 'common-http19-' + name); editor.setMode('edit'); await project();
    const originalRevision = editor.state.revision, originalProjection = structuredClone(projection.document);
    await editor.readDocument(commonPath, { sourceId: cleanVanilla.id });
    const originalText = editor.getDocument(commonPath, cleanVanilla.id).text;
    const before = await raster('before');
    await editor.edit({ type: 'add', path: commonPath, sourceId: cleanVanilla.id, parentPointer,
      name: 'new_button_1', preserveInheritedControls: true,
      value: { type: 'button', size: [20, 12], offset: [0, 0], text: '追加ボタン', localize: false } });
    assert.equal(editor.state.selectedPointer, childPointer);
    const added = editor.state.nodes.find(row => row.path === commonPath && row.sourceId === cleanVanilla.id && row.pointer === childPointer);
    assert(added, 'Added child missing from authored node index');
    await editor.edit({ type: 'set', path: commonPath, sourceId: cleanVanilla.id, pointer: childPointer + '/offset', value: [13, 7] });
    await editor.edit({ type: 'set', path: commonPath, sourceId: cleanVanilla.id, pointer: childPointer + '/size', value: [28, 16] });
    const editedText = editor.getDocument(commonPath, cleanVanilla.id).text, expectedChild = target(decoded(editedText));
    assert.deepEqual(expectedChild.offset, [13, 7]); assert.deepEqual(expectedChild.size, [28, 16]);
    assert.notEqual(editedText, originalText); assert.notEqual(editor.state.revision, originalRevision);
    check('実HTTPで共通原文へ子追加・offset・size編集が確定', { parentPointer, childPointer, child: expectedChild, revision: editor.state.revision,
      original_raw_sha256: hash(originalText), edited_raw_sha256: hash(editedText) });
    const after = await raster('after');
    const editedProjection = structuredClone(projection.document);
    const boxes = frame.layout.boxes.filter(box => box.id.endsWith('/new_button_1'));
    assert(boxes.length > 0, 'Added child absent from anvil layout');
    assert(boxes.some(box => box.w === 28 && box.h === 16), 'Edited size absent from layout');
    assert.notDeepEqual(editedProjection, originalProjection);
    assert.notEqual(hash(before), hash(after), 'Added button did not change rendered PNG');
    const a = pngjs.PNG.sync.read(before), b = pngjs.PNG.sync.read(after); let changedPixels = 0;
    for (let at = 0; at < a.data.length; at += 4) if (!a.data.subarray(at, at + 4).equals(b.data.subarray(at, at + 4))) changedPixels++;
    check('共通原文の追加子が金床の投影・配置・PNGに反映', { boxes, changed_pixels: changedPixels });
    await save(name + '-edited-ui_common.jsonc', editedText);
    await save(name + '-edited-projection.json', editedProjection);
    const payload = { workspaceId: editor.state.workspaceId, expectedRevision: editor.state.revision,
      mode: 'plan', selections: [{ filePath: 'ui/anvil_screen.json', definition: 'anvil.anvil_screen' }] };
    const planned = await client.request('/api/node/workspace-export', { payload }); await save(name + '-export-plan.json', planned);
    assert(planned.ok, JSON.stringify(planned.plan?.unresolved));
    check('共通原文編集後の金床選択書出し計画が成功', { files: planned.plan.files.length, unresolved: planned.plan.unresolved.length, warnings: planned.plan.warnings.length });
    const revisionBeforeExport = editor.state.revision;
    const zip = await client.request('/api/node/workspace-export', { payload: { ...payload, mode: 'zip' }, binary: true });
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const zipPath = path.join(outputDir, name + '-selected.zip'); await save(name + '-selected.zip', zip);
    const status = await client.request('/api/node/workspace-status', { payload: { workspaceId: editor.state.workspaceId } });
    assert.equal(status.revision, revisionBeforeExport);
    check('ZIP生成後も編集revisionを維持', { zip_bytes: zip.length, zip_sha256: hash(zip), revision: status.revision });
    for (let i = 0; i < 3; i++) await editor.history('undo');
    assert.equal(editor.state.revision, originalRevision);
    await editor.readDocument(commonPath, { sourceId: cleanVanilla.id });
    assert.equal(editor.getDocument(commonPath, cleanVanilla.id).text, originalText);
    const undo = await raster('undo'); assert.equal(hash(undo), hash(before));
    check('3操作のundoで共通原文・revision・PNGを完全復元', { revision: originalRevision, png_sha256: hash(undo) });
    const restored = await client.importPack(zipPath);
    const restoredSources = [cleanVanilla, { kind: 'imported', id: restored.id, rootPrefix: restored.rootPrefix }];
    await project(restoredSources);
    assert.deepEqual(projection.document, editedProjection, 'Reimport changed anvil projection');
    const roundtrip = await raster('roundtrip'); assert.equal(hash(roundtrip), hash(after), 'Reimport changed rendered pixels');
    const restoredBoxes = frame.layout.boxes.filter(box => box.id.endsWith('/new_button_1'));
    assert.deepEqual(restoredBoxes, boxes);
    const restoredEditor = createWorkspaceEditor({ request: (op, data) => client.request('/api/node/workspace-' + op, { payload: data }) });
    await restoredEditor.ensure(restoredSources, 'restored-' + name);
    await restoredEditor.readDocument(commonPath, { sourceId: restored.id });
    const restoredRaw = restoredEditor.getDocument(commonPath, restored.id).text;
    assert.deepEqual(target(decoded(restoredRaw)), expectedChild);
    await save(name + '-restored-ui_common.jsonc', restoredRaw);
    await save(name + '-restored-projection.json', projection.document);
    check('未編集vanillaとZIP再読込で追加子原文・投影・配置・PNGを保持', { png_sha256: hash(roundtrip),
      edited_vanilla_overrides_reused: false, complete: scenario.roundtrip.complete, diagnostics: scenario.roundtrip.diagnostics.length,
      restored_source_files: restored.metadata.packPaths?.length || null });
    scenario.status = 'PASS'; await client.close(); client = null;
  }
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = { code: error.code || error.name, message: error.message, stack: error.stack };
  if (report.scenarios.length) report.scenarios.at(-1).status = 'FAIL'; console.error(error); process.exitCode = 1;
} finally { if (client) await client.close(); }
report.finished_at = new Date().toISOString();
await save('common-http-export19.json', report);
