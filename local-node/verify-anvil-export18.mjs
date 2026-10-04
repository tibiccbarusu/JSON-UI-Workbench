/** Actual supplied inventory pack + fixed public vanilla: HTTP edit and original PNG pixels. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CliClient } from './cli-client.mjs';
import { loadRasterBackend, renderFramePng } from './frame-raster13.mjs';
import { FrameRasterResources } from './frame-raster-assets13.mjs';
import pngjs from './vendor/pngjs/lib/png.js';
import { createCanvasEditPicker } from '../editor-core/src/preview/canvas-edit-picking17.js';
import { hitTestBoxes, buildImageDrawMetadataFromProps } from '../editor-core/src/preview/canvas-preview.js';
import { mergeNativeRendererProps, resolveNativeRendererTexture } from '../editor-core/src/preview/native-renderer-preview.js';
import { selectPreviewText } from '../editor-core/src/preview/preview-text.js';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { createWorkspaceEditor, findAuthoredNodeForPreview, offsetAfterAuthoredMove, workspacePreviewDefinitionIdentity } from '../editor-core/src/ui/workspace-editor.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';

const [vanillaPath, inventoryPath, outputDir] = process.argv.slice(2);
if (!vanillaPath || !inventoryPath || !outputDir) throw new Error('Usage: node local-node/verify-anvil-export18.mjs <public-vanilla.zip> <inventory-background.zip> <new-evidence-directory>');
await mkdir(outputDir, { recursive: false });
const backend = loadRasterBackend(); assert(backend, 'Native Canvas backend unavailable');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { schema: 'jsonui-anvil-export18', status: 'INCONCLUSIVE', started_at: new Date().toISOString(),
  runtime: process.version, checks: [], limitations: ['提供vanillaは取得失敗のため固定コミットの公開Mojang資料を代用。両者は同一とは扱わない。',
    'Nodeの製品描画関数と実HTTPを検査。ブラウザ操作・実機画素一致は検査していない。',
    '選択の検査は原画像の描画情報を構築して行い、選択点に非空テキストが重ならないことも検査する。'] };
const check = (name, detail) => { report.checks.push({ name, status: 'PASS', ...detail }); console.log(JSON.stringify({ name, ...detail })); };
let client;
try {
  report.inputs = [];
  for (const [kind, filename] of [['vanilla', vanillaPath], ['imported', inventoryPath]]) {
    const bytes = await readFile(filename); report.inputs.push({ kind, name: path.basename(filename), bytes: bytes.length, sha256: hash(bytes) });
  }
  client = await CliClient.start(); let frame, projection, file, frameRequest, sources = [], generation = 0;
  const request = client.request.bind(client);
  // Observe the final real frame after resource-driven intrinsic-size reflow.
  client.request = async (route, options) => { const result = await request(route, options); if (route === '/api/node/frame') frame = result; return result; };
  for (const [kind, filename] of [['vanilla', vanillaPath], ['imported', inventoryPath]]) {
    const loaded = await client.importPack(filename); sources.push({ kind, id: loaded.id, rootPrefix: loaded.rootPrefix });
  }
  const catalogReport = [];
  async function project(nextSources = sources) {
    sources = nextSources;
    const catalog = await client.request('/api/node/catalog', { payload: { sources } });
    const record = catalog.records.filter(row => row.qualifiedName === 'anvil.anvil_screen').sort((a, b) => b.precedence - a.precedence)[0]; assert(record, 'Anvil definition absent');
    projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id,
      variables: buildRepresentativeClassicResolverVariables({ qualifiedName: record.qualifiedName }),
      representativeCollections: buildRepresentativeClassicCollections({ qualifiedName: record.qualifiedName }) } }); assert(projection.ok, JSON.stringify(projection.error));
    frameRequest = { projectionId: projection.nodeProjectionId, filePath: record.filePath, generation: ++generation,
      preset: { width: 480, height: 270 }, animationTime: 1, visibilityMode: 'safe' };
    frame = await client.request('/api/node/frame', { payload: frameRequest });
    const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: record.filePath });
    file = { id: 'preview:ui/anvil_screen.json', path: record.filePath, uiModel, ...buildTreeFromUiScreenModel(uiModel),
      meta: { previewProjection: true, selectedDefinition: projection.selected, resolution: projection } };
    catalogReport.push({ definitions: catalog.records.length, nodes: Object.keys(file.nodesById).length, source_nodes: Object.keys(projection.nodeSources).length });
  }
  const editor = createWorkspaceEditor({ request: (op, payload) => client.request('/api/node/workspace-' + op, { payload }), onCommit: state => project(state.sources) });
  await editor.ensure(sources, 'actual-anvil18'); editor.setMode('edit'); await project();
  async function raster(name) {
    const result = await renderFramePng({ client, sources, projection, frame, frameRequest,
      width: 1920, height: 1080, uiScale: 4, locale: 'ja_JP', timeSeconds: 1, allowPartial: true });
    assert(result.ok, JSON.stringify({ code: result.code, diagnostics: result.diagnostics }));
    await writeFile(path.join(outputDir, name + '.png'), result.png, { flag: 'wx' });
    report[name] = { png_sha256: hash(result.png), complete: result.complete, diagnostics: result.diagnostics,
      rendering: result.rendering, provenance: result.provenance };
    return result.png;
  }
  const initialRevision = editor.state.revision;
  const before = await raster('anvil-before');
  const icon = frame.layout.boxes.find(box => box.id.endsWith('/anvil_icon')); assert(icon, 'Visible anvil icon absent');
  const propsFor = id => mergeNativeRendererProps(file.nodesById[id]?.unknownProps, file.nodesById[id]?.props, frame.propsById?.[id]);
  const resources = new FrameRasterResources({ client, sources, backend, locale: 'ja_JP' }); await resources.initialize();
  const imageDrawById = {}, imageIssues = [];
  const token = (value, props) => {
    const visited = new Set();
    while (typeof value === 'string' && /^[#$][\w@:.\-]+$/u.test(value) && !visited.has(value)) {
      visited.add(value); const next = props[value] ?? props[value.slice(1)]; if (next === undefined) break; value = next;
    }
    return value;
  };
  for (const box of frame.layout.boxes.filter(box => ['image', 'custom'].includes(box.type) && box.w > 0 && box.h > 0 && box.renderAlpha !== 0)) {
    try {
      const props = propsFor(box.id); let ref = token(props.texture, props);
      if (box.type === 'custom') {
        const initial = resolveNativeRendererTexture(props);
        if (initial?.status === 'not-applicable') continue;
        const resolved = props.renderer === 'inventory_item_renderer' ? resolveNativeRendererTexture(props, await resources.itemContext()) : initial;
        if (resolved?.status !== 'resolved') { imageDrawById[box.id] = { state: 'unsupported' }; continue; }
        ref = resolved.textureRef;
      }
      if (!ref) continue;
      const image = await resources.texture(ref), metadata = await resources.sidecar(image.packPath, {
        ...buildImageDrawMetadataFromProps(props), tiledAuthored: Object.hasOwn(props, 'tiled') });
      imageDrawById[box.id] = { ...metadata, ...image, imageLayers: [image], alpha: box.renderAlpha, state: 'ready' };
    } catch (error) { imageIssues.push({ id: box.id, code: error.code || error.message }); }
  }
  assert(imageDrawById[icon.id]?.image, 'Icon original texture unavailable');
  function withCanvas(fn) {
    const values = { window: { devicePixelRatio: 1 }, OffscreenCanvas: function(w, h) { return backend.createCanvas(w, h); },
      document: { documentElement: {}, createElement: () => backend.createCanvas(1, 1) }, getComputedStyle: () => ({ getPropertyValue: () => '' }) };
    const previous = new Map();
    try { for (const [key, value] of Object.entries(values)) { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true }); } return fn(); }
    finally { for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } }
  }
  const picker = createCanvasEditPicker(); let point, picked, oldHit;
  for (let y = 0.5; y < icon.h && !picked; y += 1) for (let x = 0.5; x < icon.w && !picked; x += 1) {
    const worldX = icon.x + x, worldY = icon.y + y;
    const textOverlaps = frame.layout.boxes.filter(box => ['label', 'button', 'dropdown', 'edit_box'].includes(box.type)
      && hitTestBoxes([box], worldX, worldY, frame.layout.preset)
      && String(selectPreviewText(box.type, propsFor(box.id), token) || '').trim());
    if (textOverlaps.length) continue;
    const hit = withCanvas(() => picker.hitTest({ layout: frame.layout, selection: { imageDrawById }, view: { zoom: 4 }, worldX, worldY }));
    if (hit?.id === icon.id) { picked = hit; point = { worldX, worldY }; oldHit = hitTestBoxes(frame.layout.boxes, worldX, worldY, frame.layout.preset); }
  }
  assert(picked, 'No unambiguous painted anvil pixel could be selected');
  check('公開vanillaと提供inventoryの金床で実画像をpixel選択', { point, old_selected: oldHit?.id, new_selected: picked.id,
    image_metadata_count: Object.keys(imageDrawById).length, image_issues: imageIssues, nonempty_text_overlap: 0 });
  const source = findAuthoredNodeForPreview({ file, nodeId: picked.id, nodes: editor.state.nodes, sources }); assert(source?.pointer);
  const node = await editor.selectPreviewTarget(source, { fileId: file.id, nodeId: picked.id, previewDefinitionId: workspacePreviewDefinitionIdentity(file) });
  const originalText = editor.getDocument(node.path, node.sourceId).text;
  const oldBox = { ...picked };
  const offset = offsetAfterAuthoredMove({ value: node.props, effectiveProps: file.nodesById[picked.id].props, frameProps: frame.propsById?.[picked.id], dx: 13, dy: 7 });
  await editor.edit({ type: 'set', path: node.path, sourceId: node.sourceId, pointer: node.pointer + '/offset', value: offset });
  const after = await raster('anvil-after');
  const newBox = frame.layout.boxes.find(box => box.id === oldBox.id); assert(newBox);
  assert.equal(newBox.x - oldBox.x, 13); assert.equal(newBox.y - oldBox.y, 7);
  assert.notEqual(hash(before), hash(after));
  const a = pngjs.PNG.sync.read(before), b = pngjs.PNG.sync.read(after); let changedPixels = 0;
  for (let at = 0; at < a.data.length; at += 4) if (!a.data.subarray(at, at + 4).equals(b.data.subarray(at, at + 4))) changedPixels++;
  assert(changedPixels > 0); assert.equal(file.path, 'ui/anvil_screen.json');
  check('実金床アイコンを移動し原文・矩形・PNGが変化', { source: { path: node.path, pointer: node.pointer, sourceId: source.sourceKind },
    offset, before_box: oldBox, after_box: newBox, changed_pixels: changedPixels });
  const editedProjection = structuredClone(projection.document), editedSources = sources;
  const payload = { workspaceId: editor.state.workspaceId, expectedRevision: editor.state.revision,
    mode: 'plan', selections: [{ filePath: 'ui/anvil_screen.json', definition: 'anvil.anvil_screen' }] };
  const planned = await client.request('/api/node/workspace-export', { payload });
  await writeFile(path.join(outputDir, 'export-plan.json'), JSON.stringify(planned, null, 2) + '\n', { flag: 'wx' });
  assert(planned.ok, JSON.stringify(planned.plan?.unresolved));
  check('編集済み実金床のexport計画が成功', { files: planned.plan.files.length, warnings: planned.plan.warnings.length,
    external_ui: planned.plan.externalUiDefinitions || [], unresolved: planned.plan.unresolved.length });
  const zip = await client.request('/api/node/workspace-export', { payload: { ...payload, mode: 'zip' }, binary: true });
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const zipPath = path.join(outputDir, 'anvil-selected.zip'); await writeFile(zipPath, zip, { flag: 'wx' });
  await editor.history('undo'); const undone = await raster('anvil-undo');
  assert.equal(hash(undone), hash(before)); assert.equal(editor.state.revision, initialRevision);
  assert.equal(editor.getDocument(node.path, node.sourceId).text, originalText);
  check('undoで原文・revision・全PNG画素が復元', { png_sha256: hash(undone), raw_restored: true, revision_restored: true });
  const loaded = await client.importPack(zipPath), restoredSources = [
    ...editedSources.filter(input => input.kind === 'vanilla').map(input => ({ ...input, overrides: {} })),
    { id: loaded.id, kind: 'imported', rootPrefix: loaded.rootPrefix }];
  await project(restoredSources);
  assert.deepEqual(projection.document, editedProjection);
  const roundtrip = await raster('anvil-roundtrip');
  assert.equal(hash(roundtrip), hash(after));
  const roundtripIcon = frame.layout.boxes.find(box => box.id === oldBox.id);
  assert.deepEqual([roundtripIcon.x, roundtripIcon.y, roundtripIcon.w, roundtripIcon.h], [newBox.x, newBox.y, newBox.w, newBox.h]);
  check('ZIP再importと元vanillaの組合せで編集済み投影とPNG全画素一致', { png_sha256: hash(roundtrip),
    zip_sha256: hash(zip), zip_bytes: zip.length, edited_vanilla_overrides_reused: false,
    selected_file: 'ui/anvil_screen.json', restored_source_files: loaded.metadata.packPaths?.length || null });
  report.catalogs = catalogReport; report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = { code: error.code || error.name, message: error.message, stack: error.stack }; console.error(error); process.exitCode = 1; }
finally { if (client) await client.close(); }
report.finished_at = new Date().toISOString();
await writeFile(path.join(outputDir, 'anvil-export18.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
