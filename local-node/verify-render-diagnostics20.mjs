/** 実HTTPと製品Canvasの未充足診断を記録する。製品・元パックは変更しない。 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CliClient } from './cli-client.mjs';
import { productDigest } from './verify-stability13.mjs';
import { renderFramePng } from './frame-raster13.mjs';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { mergeNativeRendererProps } from '../editor-core/src/preview/native-renderer-preview.js';
import { selectNativePreviewTargetEngineVersion } from '../editor-core/src/preview/native-pack-stack.js';
import { buildRepresentativeClassicResolverVariables, buildRepresentativeClassicCollections } from '../editor-core/src/engine/representative-classic-runtime.js';

const [reference, output] = process.argv.slice(2);
assert(reference && output, '入力ZIPと未使用の証拠ディレクトリを指定してください。');
await mkdir(output, { recursive: false });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, data) => writeFile(path.join(output, name), Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const input = await readFile(reference);
const report = { schema: 'jsonui-render-diagnostics20', started_at: new Date().toISOString(),
  source_start: await productDigest(), input: { name: path.basename(reference), bytes: input.length, sha256: hash(input) },
  conditions: { preset: { width: 480, height: 270 }, width: 1920, height: 1080, ui_scale: 4, locale: 'ja_JP', time_seconds: 1,
    runtime: '製品の代表Classic context。実Minecraft runtimeではない。', input_kind: '固定公式UI・素材と提供部分回復フォントを含む限定参照ZIP。完全vanillaではない。' },
  cases: [], limitations: ['診断前処理はviewport外の正寸法nodeも走査する。診断数を実表示不良数としない。',
    'initial_bounds_visibleは素材寸法による再layout前の矩形交差だけ。最終の画素可視性を意味しない。',
    'completeは資源解決の状態。Minecraft実機の画素一致を意味しない。', '元パック変更・編集・exportは実施しない。'] };
for (const qualifiedName of ['anvil.anvil_screen', 'crafting.inventory_screen', 'enchanting.enchanting_screen', 'horse.horse_screen']) {
  const result = { qualified_name: qualifiedName, started_at: new Date().toISOString(), status: 'RUNNING' };
  report.cases.push(result); let client;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error('画面監査の上限360秒')), 360000);
  try {
    client = await CliClient.start({ signal: abort.signal });
    const pack = await client.importPack(reference), sources = [{ kind: 'vanilla', id: pack.id, rootPrefix: pack.rootPrefix }];
    const catalog = await client.request('/api/node/catalog', { payload: { sources } });
    const record = catalog.records.filter(row => row.qualifiedName === qualifiedName).sort((a, b) => b.precedence - a.precedence)[0];
    assert(record, qualifiedName);
    const preview = { variables: buildRepresentativeClassicResolverVariables({ qualifiedName }), representativeCollections: buildRepresentativeClassicCollections({ qualifiedName }) };
    const projection = await client.request('/api/node/project', { payload: { catalogId: catalog.nodeCatalogId, recordId: record.id, ...preview } });
    assert(projection.ok, JSON.stringify(projection.error));
    const frameRequest = { projectionId: projection.nodeProjectionId, filePath: record.filePath, generation: 1,
      preset: report.conditions.preset, animationTime: 1, visibilityMode: 'safe' };
    const frame = await client.request('/api/node/frame', { payload: frameRequest });
    const model = buildUiScreenModelFromJson(projection.document, { filePath: record.filePath });
    const tree = buildTreeFromUiScreenModel(model);
    const boxes = new Map(frame.layout.boxes.map(box => [box.id, box]));
    const props = id => { const node = tree.nodesById[id]; return mergeNativeRendererProps(node?.unknownProps, node?.props, frame.propsById?.[id]); };
    const nativeAndText = frame.layout.boxes.filter(box => ['custom', 'label', 'edit_box'].includes(box.type)).map(box => ({ box, props: props(box.id) }));
    await save(qualifiedName + '-context.json', { record, preview, projection_summary: { diagnostics: projection.diagnostics, selected: projection.selected },
      frame_request: frameRequest, frame_hash: hash(JSON.stringify(frame)), frame_stats: frame.layout.stats,
      frame_warnings: frame.layout.warnings, native_and_text: nativeAndText });
    // CLIと同じ既定版選択を明示する。モデルAPIは省略版を受理しない。
    const targetEngineVersion = selectNativePreviewTargetEngineVersion({ hasImportedPack: false, fallback: [1, 26, 40] });
    const raster = await renderFramePng({ client, sources, projection, frame, frameRequest, width: 1920, height: 1080,
      uiScale: 4, locale: 'ja_JP', timeSeconds: 1, allowPartial: true, targetEngineVersion });
    result.raster_ok = raster.ok; result.complete = raster.complete;
    result.rendering = raster.rendering; result.provenance = raster.provenance;
    result.diagnostics = raster.diagnostics.map(diagnostic => {
      const box = boxes.get(diagnostic.nodeId), nodeProps = diagnostic.nodeId ? props(diagnostic.nodeId) : null;
      const c = box?.clipRect;
      return { ...diagnostic, ...(box ? { box, initial_bounds_visible: box.renderAlpha !== 0 && box.w > 0 && box.h > 0 && box.x < 480 && box.y < 270 && box.x + box.w > 0 && box.y + box.h > 0
        && (!c || (c.w > 0 && c.h > 0 && box.x < c.x + c.w && box.y < c.y + c.h && box.x + box.w > c.x && box.y + box.h > c.y)) } : {}),
        ...(nodeProps ? { renderer: nodeProps.renderer, text: nodeProps.text, bindings: nodeProps.bindings, property_bag: nodeProps.property_bag,
          runtime_values: Object.fromEntries(Object.entries(nodeProps).filter(([key]) => key.startsWith('#'))) } : {}) };
    });
    result.diagnostic_counts = Object.fromEntries([...new Set(result.diagnostics.map(row => row.code))].map(code => [code, result.diagnostics.filter(row => row.code === code).length]));
    if (raster.png) await save(qualifiedName + '.png', raster.png);
    assert(raster.ok, JSON.stringify(raster.diagnostics));
    result.status = raster.complete ? 'PASS' : 'WARN';
  } catch (error) { result.status = 'FAIL'; result.error = { code: error.code || error.name, message: error.message }; }
  finally { clearTimeout(timer); if (client) await client.close(); result.finished_at = new Date().toISOString(); await save(qualifiedName + '-result.json', result); }
  console.log(JSON.stringify({ name: qualifiedName, status: result.status, complete: result.complete, counts: result.diagnostic_counts, error: result.error }));
}
report.source_end = await productDigest();
report.source_state = report.source_start.sha256 === report.source_end.sha256 ? 'STABLE' : 'TRANSITION';
report.status = report.cases.some(row => row.status === 'FAIL') ? 'FAIL' : report.cases.some(row => row.status === 'WARN') ? 'WARN' : 'PASS';
report.finished_at = new Date().toISOString(); await save('report.json', report);
if (report.status === 'FAIL') process.exitCode = 1;
