import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FrameIrProcessor, FRAME_LIMITS } from '../frame-ir.mjs';
import { Processor } from '../worker-client.mjs';
import { createLocalServer } from '../server.mjs';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { evaluateBindingsWithRepresentativeRuntime } from '../../editor-core/src/engine/preview-bindings-runtime.js';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';
import { prepareNodeFrameFile } from '../../editor-core/src/engine/node-frame-wire.js';
import { compilePreviewAnimations, samplePreviewAnimations } from '../../editor-core/src/engine/preview-animation.js';
import { resourceFixture } from './fixtures.mjs';

const preset = { width: 320, height: 180 };
function fixture() {
  const uiModel = buildUiScreenModelFromJson({ namespace: 'frame', screen: {
    type: 'screen', controls: [
      { grid: { type: 'grid', size: [54, 18], grid_dimensions: [3, 1], controls: [
        { first: { type: 'image', size: [18, 18], texture: 'textures/ui/slot', bindings: [{ binding_name: '#show', binding_name_override: '#visible' }] } },
        { second: { type: 'image', size: [18, 18], texture: 'textures/ui/slot' } },
        { third: { type: 'image', size: [18, 18], texture: 'textures/ui/slot' } },
      ] } },
      { label: { type: 'label', text: '#title', bindings: [{ binding_name: '#title', binding_name_override: '#text' }] } },
      { animated: { type: 'image', size: [10, 10], texture: 'textures/ui/arrow', anims: ['@frame.slide'] } },
    ],
  } }, { filePath: 'ui/frame.json' });
  return { ...buildTreeFromUiScreenModel(uiModel), uiModel, meta: { selectedDefinition: { qualifiedName: 'frame.screen', profile: 'classic' }, resolution: { animationDefinitions: {
    definitions: { 'frame.slide': { anim_type: 'offset', from: [0, 0], to: [20, 0], duration: 2, easing: 'linear' } },
  } } } };
}
const result = (processor, input) => JSON.parse(processor.execute({ preset, ...input }).body);
const idFor = (file, name) => Object.keys(file.nodesById).find(id => file.nodesById[id].props.name === name);

test('Node IR: shared binding/layoutと完全同値、静的props重複を送らない', () => {
  const file = fixture(), before = JSON.stringify(file), processor = new FrameIrProcessor();
  const mockData = { '#show': true, '#title': '日本語 012' };
  const evaluated = evaluateBindingsWithRepresentativeRuntime(file.uiModel, 'frame.screen', mockData);
  const expected = computeLayoutBoxesForFile(file, preset, { maxBoxes: 5000, propsByIdOverride: evaluated.propsById });
  const actual = result(processor, { file, mockData, generation: 12 });
  assert.deepEqual(actual.layout, JSON.parse(JSON.stringify(expected)));
  assert.equal(actual.generation, 12); assert.equal(actual.metrics.processing, 'node-worker');
  assert.equal(actual.propsById[idFor(file, 'label')].text, '日本語 012');
  assert(!JSON.stringify(actual.propsById).includes('textures/ui/slot'));
  assert.equal(JSON.stringify(file), before);
});

test('Node IR: 模型保持・順序非依存cache・generationは現在要求の値を返す', () => {
  const processor = new FrameIrProcessor(), file = fixture();
  const first = result(processor, { file, mockData: { '#show': true, '#title': 'A' }, generation: 1 });
  const next = result(processor, { modelId: first.modelId, mockData: { '#title': 'A', '#show': true }, generation: 91 });
  assert.equal(next.generation, 91); assert.equal(next.metrics.cacheHit, true);
  assert.deepEqual(next.layout, first.layout); assert.equal(processor.snapshot().models, 1);
  const duplicate = result(processor, { file, mockData: { '#title': 'A', '#show': true } });
  assert.equal(duplicate.modelId, first.modelId); assert.equal(processor.snapshot().registered, 1);
  file.nodesById[idFor(file, 'second')].props.size = [999, 999];
  assert.deepEqual(result(processor, { modelId: first.modelId, mockData: { '#show': true, '#title': 'A' } }).layout, first.layout);
});

test('Node IR wire: origin.rawだけを省略し実行tree/layoutを非破壊で維持', () => {
  const file = fixture(), processor = new FrameIrProcessor(), before = JSON.stringify(file);
  file.uiModel.root.origin = { kind: 'named', raw: { privateAuthoringText: 'not-runtime-data' } };
  const wire = prepareNodeFrameFile(file);
  assert(!JSON.stringify(wire.uiModel).includes('privateAuthoringText'));
  assert.equal(file.uiModel.root.origin.raw.privateAuthoringText, 'not-runtime-data');
  const original = result(processor, { file, mockData: { '#show': true } });
  const compact = result(processor, { file: wire, mockData: { '#show': true } });
  assert.deepEqual(compact.layout, original.layout); assert.deepEqual(compact.propsById, original.propsById);
  delete file.uiModel.root.origin; assert.equal(JSON.stringify(file), before);
});

test('Node IR: rootだけの空UIと未対応propsを明示のまま保持', () => {
  const processor = new FrameIrProcessor(), file = { rootId: 'root', nodesById: { root: { id: 'root', type: 'file', props: {}, children: [] } } };
  const frame = result(processor, { file }); assert.equal(frame.layout.boxes.length, 0); assert.equal(frame.layout.stats.truncated, false);
  const raw = fixture(), id = idFor(raw, 'second');
  raw.nodesById[id].props.unrecognized_property = '保持'; raw.nodesById[id].unknownProps.unrecognized_property = '保持';
  const before = JSON.stringify(raw); result(processor, { file: raw }); assert.equal(JSON.stringify(raw), before);
});

test('Node IR: metadataなしPocketのpath/namespace/定義flag/documentflagを再判定して拒否', () => {
  const documents = [
    { namespace: 'review_pocket', screen: { type: 'screen' } },
    { namespace: 'review', screen: { type: 'screen', $pocket_screen: true } },
    { namespace: 'review', $pocket_screen: true, screen: { type: 'screen' } },
  ];
  for (const document of documents) {
    const uiModel = buildUiScreenModelFromJson(document, { filePath: 'ui/review.json' });
    const file = prepareNodeFrameFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel });
    assert.throws(() => result(new FrameIrProcessor(), { file }), /POCKET_PREVIEW_BLOCKED/);
  }
  const uiModel = buildUiScreenModelFromJson({ namespace: 'review', screen: { type: 'screen' } }, { filePath: 'ui/pocket/review.json' });
  assert.throws(() => result(new FrameIrProcessor(), { file: prepareNodeFrameFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel }) }), /POCKET_PREVIEW_BLOCKED/);
});

test('Node IR: 二重modelのprops/type/unknown/正規化状態が不一致なら黙って上書きしない', () => {
  for (const change of [
    node => { node.props.size = [90, 90]; },
    node => { node.type = 'label'; },
    node => { node.propsPresent.size = false; },
    node => { node.propsValid.size = false; },
    node => { node.unknownProps.unrecognized = true; },
  ]) {
    const file = structuredClone(prepareNodeFrameFile(fixture())), id = idFor(file, 'second');
    // JSON roundtrip breaks shared references exactly like the HTTP wire.
    const separate = JSON.parse(JSON.stringify(file)); change(separate.nodesById[id]);
    assert.throws(() => result(new FrameIrProcessor(), { file: separate }), /NODE_FRAME_MODEL_INCONSISTENT/);
  }
});

test('Node IR: state・scroll・size補正・寸法・animationを別frameとして評価', () => {
  const processor = new FrameIrProcessor(), file = fixture(), label = idFor(file, 'label'), animated = idFor(file, 'animated');
  const first = result(processor, { file, mockData: { '#show': true, '#title': 'A' }, animationTime: 0 });
  const changed = result(processor, { modelId: first.modelId, mockData: { '#show': false, '#title': 'B' }, animationTime: 1, propsByIdOverride: { [label]: { size: [40, 8] } } });
  assert.equal(changed.metrics.cacheHit, false); assert.equal(changed.propsById[label].text, 'B');
  assert.equal(changed.layout.boxes.find(box => box.id === label).w, 40);
  assert.equal(changed.layout.boxes.find(box => box.id === animated).x - first.layout.boxes.find(box => box.id === animated).x, 10);
  assert(!changed.layout.boxes.some(box => box.id === idFor(file, 'first')));
  assert.equal(changed.animation.trackCount, 1);
  assert.notDeepEqual(changed.basePropsById[animated]?.offset, changed.propsById[animated]?.offset);
  const reframe = result(processor, { modelId: first.modelId, mockData: { '#show': false, '#title': 'B' }, animationTime: 1, propsByIdOverride: { [label]: { size: [40, 8] } }, scrollById: { [file.rootId]: { x: 1, y: 0 } } });
  assert.equal(reframe.metrics.cacheHit, false); assert(processor.snapshot().bindingHits >= 1);
});

test('Node IR: paint-only animationはgeometry再利用して原layoutとalpha一致、時間無し要求も復帰', () => {
  const file = fixture(), processor = new FrameIrProcessor(), animated = idFor(file, 'animated');
  file.meta.resolution.animationDefinitions.definitions['frame.slide'] = { anim_type: 'alpha', from: 0, to: 1, duration: 2, easing: 'linear' };
  const first = result(processor, { file, animationTime: 0, mockData: { '#show': true } });
  const next = result(processor, { modelId: first.modelId, animationTime: 1, mockData: { '#show': true } });
  assert.equal(next.metrics.geometryReuse, true); assert.equal(next.layout.boxes.find(box => box.id === animated).renderAlpha, 0.5);
  const evaluated = evaluateBindingsWithRepresentativeRuntime(file.uiModel, 'frame.screen', { '#show': true });
  const plan = compilePreviewAnimations(file.uiModel, { ...file.meta.resolution.animationDefinitions, basePropsById: evaluated.propsById });
  const sampled = samplePreviewAnimations(plan, 1, { basePropsById: evaluated.propsById });
  const expected = computeLayoutBoxesForFile(file, preset, { maxBoxes: 5000, propsByIdOverride: sampled.propsById });
  assert.deepEqual(next.layout, JSON.parse(JSON.stringify(expected)));
  const unanimated = result(processor, { modelId: first.modelId, mockData: { '#show': true } });
  assert.equal(unanimated.layout.boxes.find(box => box.id === animated).renderAlpha, 1);
});

test('Node IR: 不正tree・深さ・上限・Pocket・非有限入力を安全に拒否', () => {
  const processor = new FrameIrProcessor(), file = fixture();
  assert.throws(() => result(processor, { file, preset: { width: Infinity, height: 10 } }), /NODE_FRAME_PRESET_INVALID/);
  assert.throws(() => result(processor, { file, generation: -1 }), /NODE_FRAME_GENERATION_INVALID/);
  assert.throws(() => result(processor, { file, animationTime: -1 }), /NODE_FRAME_ANIMATION_TIME_INVALID/);
  assert.throws(() => result(processor, { file, mockData: { huge: 'x'.repeat(FRAME_LIMITS.stateBytes) } }), /NODE_FRAME_STATE_LIMIT/);
  const cyclic = fixture(); cyclic.nodesById[cyclic.rootId].children.push(cyclic.rootId);
  assert.throws(() => result(processor, { file: cyclic }), /NODE_FRAME_TREE_INVALID/);
  const mismatch = fixture(); mismatch.uiModel.root.children = [];
  assert.throws(() => result(processor, { file: mismatch }), /NODE_FRAME_BINDING_TREE_INVALID/);
  const pocket = fixture(); pocket.meta.selectedDefinition.profile = 'pocket';
  assert.throws(() => result(processor, { file: pocket }), /POCKET_PREVIEW_BLOCKED/);
  const deep = { rootId: 'n0', nodesById: {} };
  for (let i = 0; i < 259; i++) deep.nodesById[`n${i}`] = { id: `n${i}`, type: 'panel', props: {}, children: i < 258 ? [`n${i + 1}`] : [] };
  assert.throws(() => result(processor, { file: deep }), /NODE_FRAME_DEPTH_LIMIT/);
  const valid = result(processor, { file }); processor.clear();
  assert.throws(() => result(processor, { modelId: valid.modelId }), /NODE_FRAME_MODEL_STALE/);
});

test('Node IR: bounded model LRUを越えても保持上限内、失効idで別UIを返さない', () => {
  const processor = new FrameIrProcessor(), first = result(processor, { file: fixture() });
  for (let i = 0; i < 8; i++) { const file = fixture(); file.meta.selectedDefinition.qualifiedName = `frame.screen${i}`; result(processor, { file }); }
  assert.equal(processor.snapshot().models, 8); assert(processor.snapshot().model_bytes <= FRAME_LIMITS.modelsBytes);
  assert.throws(() => result(processor, { modelId: first.modelId }), /NODE_FRAME_MODEL_STALE/);
});

test('Node IR HTTP: token/Origin/content-type保護・worker実行・cache統計を保持', async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`, cap = await (await fetch(base + 'capabilities')).json();
  assert.equal(cap.features.frameIr, true);
  const body = JSON.stringify({ file: fixture(), preset, mockData: { '#show': true }, generation: 123 });
  const headers = { 'Content-Type': 'application/json', 'X-JSONUI-Token': cap.token };
  assert.equal((await fetch(base + 'frame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
  assert.equal((await fetch(base + 'frame', { method: 'POST', headers: { ...headers, Origin: 'https://example.invalid' }, body })).status, 403);
  assert.equal((await fetch(base + 'frame', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body })).status, 415);
  const response = await fetch(base + 'frame', { method: 'POST', headers, body }); assert.equal(response.status, 200);
  const frame = await response.json(); assert.equal(frame.generation, 123); assert(frame.layout.boxes.length > 3);
  assert.equal(app.processor.snapshot().caches.frame_ir.frames, 1);
  assert.equal((await fetch(base + 'frame', { method: 'POST', headers, body: JSON.stringify({ modelId: randomUUID(), preset }) })).status, 409);
});

test('Node IR HTTP: projection tokenによる無全量upload・identity照合・catalog失効', async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}/api/node/`, cap = await (await fetch(base + 'capabilities')).json();
  const headers = { 'Content-Type': 'application/json', 'X-JSONUI-Token': cap.token };
  const post = (route, data) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(data) });
  const id = randomUUID(), response = await fetch(base + 'packs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip', 'X-JSONUI-Upload-ID': id }, body: resourceFixture() });
  assert.equal(response.status, 200); await response.arrayBuffer();
  const sources = [{ id, kind: 'imported' }], catalog = await (await post('catalog', { sources })).json();
  const record = catalog.records.find(row => row.localName === 'screen');
  const request = { catalogId: catalog.nodeCatalogId, recordId: record.id };
  const projected = await (await post('project', request)).json(), again = await (await post('project', request)).json();
  assert.match(projected.nodeProjectionId, /^[0-9a-f]{64}$/u); assert.equal(again.nodeProjectionId, projected.nodeProjectionId);
  const frameRequest = { projectionId: projected.nodeProjectionId, filePath: record.filePath, recordId: record.id, preset };
  const frameResponse = await post('frame', frameRequest); assert.equal(frameResponse.status, 200); const frame = await frameResponse.json();
  const uiModel = buildUiScreenModelFromJson(projected.document, { filePath: record.filePath });
  const file = { ...buildTreeFromUiScreenModel(uiModel), uiModel, meta: { selectedDefinition: projected.selected, resolution: { animationDefinitions: projected.animationDefinitions } } };
  assert.deepEqual(frame.layout, result(new FrameIrProcessor(), { file }).layout);
  assert(Buffer.byteLength(JSON.stringify(frameRequest)) < Buffer.byteLength(JSON.stringify(file)) / 5);
  for (const changed of [{ filePath: 'ui/another.json' }, { recordId: 'other-record' }]) {
    const rejected = await post('frame', { ...frameRequest, ...changed }); assert.equal(rejected.status, 409); assert.equal((await rejected.json()).error, 'NODE_FRAME_PROJECTION_IDENTITY_MISMATCH');
  }
  for (let i = 0; i < 17; i++) await (await post('project', { ...request, variables: { $cache_case: i } })).arrayBuffer();
  const restored = await post('frame', frameRequest); assert.equal(restored.status, 200);
  assert.deepEqual((await restored.json()).layout, frame.layout);
  assert.equal(app.processor.snapshot().caches.projection_restores, 0, 'retained execution model survives projection reply eviction');
  assert.equal(app.processor.snapshot().caches.projection_models.builds, 1);
  assert.equal(app.processor.snapshot().caches.projection_models.hits, 1);
  await (await post('catalog', { sources: [{ ...sources[0], overrides: { 'ui/new.json': '{"namespace":"new","panel":{"type":"panel"}}' } }] })).arrayBuffer();
  const stale = await post('frame', frameRequest); assert.equal(stale.status, 409); assert.equal((await stale.json()).error, 'NODE_FRAME_PROJECTION_STALE');
  assert.equal((await post('frame', { modelId: frame.modelId, preset })).status, 409);
});

test('Node Worker: 実行開始後のframe取消は結果を捨てて読込済みpackを維持', async t => {
  const processor = new Processor(), directory = await mkdtemp(path.join(tmpdir(), 'jsonui-frame-test-'));
  t.after(async () => { await processor.close(); await rm(directory, { recursive: true, force: true }); });
  const zip = resourceFixture(), zipPath = path.join(directory, 'fixture.zip'), id = randomUUID(); await writeFile(zipPath, zip);
  await processor.call('import', { id, path: zipPath, name: 'fixture.zip', size: zip.length });
  const controller = new AbortController();
  const pending = processor.call('frame', { file: fixture(), preset }, 30000, { signal: controller.signal });
  await Promise.resolve();
  assert.equal(processor.snapshot().active_jobs[0].state, 'running'); controller.abort();
  await assert.rejects(pending, /NODE_JOB_CANCELLED/);
  assert.equal(processor.dead, false); assert.equal(processor.snapshot().cancelled_running, 1);
  const read = await processor.call('read', { id, path: 'root/ui/base.json', maxBytes: 1024 });
  assert.match(Buffer.from(read.body).toString('utf8'), /common/);
});
