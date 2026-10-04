import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FrameDeltaEncoder } from '../frame-delta.mjs';
import { FrameIrProcessor } from '../frame-ir.mjs';
import { createLocalServer } from '../server.mjs';
import { createFrameDeltaClient, restoreFrameDelta } from '../../editor-core/src/pack-io/frame-delta-client.js';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';

function fixture(count = 100) {
  const uiModel = buildUiScreenModelFromJson({ namespace: 'delta', screen: { type: 'screen', controls: [
    ...Array.from({ length: count }, (_, i) => ({ [`slot${i}`]: { type: 'image', size: [18, 18], offset: [i % 10 * 18, Math.floor(i / 10) * 18], texture: 'textures/ui/slot' } })),
    { label: { type: 'label', text: '#title', bindings: [{ binding_name: '#title', binding_name_override: '#text' }] } },
    { fade: { type: 'image', size: [18, 18], anims: ['@delta.fade'] } },
    { hidden: { type: 'image', size: [18, 18], bindings: [{ binding_name: '#show', binding_name_override: '#visible' }] } },
  ] } }, { filePath: 'ui/delta.json' });
  return { ...buildTreeFromUiScreenModel(uiModel), uiModel, meta: { selectedDefinition: { qualifiedName: 'delta.screen', profile: 'classic' }, resolution: { animationDefinitions: {
    definitions: { 'delta.fade': { anim_type: 'alpha', from: 0, to: 1, duration: 2 } },
  } } } };
}
const preset = { width: 320, height: 180 };
const comparable = ({ metrics, frameId, transport, ...value }) => value;

test('差分IR: 時間・日本語・texture・data・topology変更を全量frameと完全一致で復元', async () => {
  const processor = new FrameIrProcessor(), wires = [];
  const client = createFrameDeltaClient(async input => { const wire = JSON.parse(processor.execute(input).body); wires.push(wire); return wire; });
  const first = await client.render({ file: fixture(), preset, animationTime: 0, generation: 1, mockData: { '#title': '最初', '#show': true } });
  for (const [index, change] of [
    { animationTime: 0.5 }, { animationTime: 1, mockData: { '#title': '変更した日本語', '#show': true } },
    { animationTime: 2, mockData: { '#title': '非表示', '#show': false } },
    { animationTime: 1.5, mockData: { '#title': '再表示', '#show': true } },
  ].entries()) {
    const input = { modelId: first.modelId, preset, mockData: { '#title': '最初', '#show': true }, generation: index + 2, ...change };
    const restored = await client.render(input), full = JSON.parse(processor.execute(input).body);
    assert.deepEqual(comparable(restored), comparable(full));
  }
  assert.equal(wires[0].schema, 'jsonui-frame-v1'); assert(wires.some(wire => wire.schema === 'jsonui-frame-delta-v1'));
  assert.equal(client.snapshot().retries, 0);
});

test('差分IR: 基底を不変に保ち、値の削除・null・undefined・prototype文字列を復元', () => {
  const encoder = new FrameDeltaEncoder();
  const base = { schema: 'jsonui-frame-v1', modelId: randomUUID(), generation: 1,
    layout: { boxes: [{ id: 'a', x: 1, y: 0, w: 18, h: 18, nullable: null, dropped: 2 }], stats: { a: 1 }, warnings: [] },
    propsById: JSON.parse('{"a":{"text":"文字","color":[1,0,0]},"__proto__":{"text":"literal"}}'), basePropsById: { a: { text: '文字' } } };
  // Add static padding so the encoder selects delta for this tiny fixture.
  base.layout.boxes[0].padding = 'x'.repeat(5000);
  const first = JSON.parse(encoder.encode(base, undefined, Buffer.byteLength(JSON.stringify(base))));
  const next = structuredClone(base); next.generation++; next.layout.boxes[0].x = 2; next.layout.boxes[0].dropped = undefined;
  delete next.propsById.a; next.propsById.__proto__ = { text: '変更' }; next.basePropsById = {};
  const before = JSON.stringify(first), wire = JSON.parse(encoder.encode(next, first.frameId, Buffer.byteLength(JSON.stringify(next))));
  assert.equal(wire.schema, 'jsonui-frame-delta-v1');
  assert.deepEqual(comparable(restoreFrameDelta(first, wire)), comparable(JSON.parse(JSON.stringify(next))));
  assert.equal(JSON.stringify(first), before); assert.equal(Object.prototype.text, undefined);
});

test('差分IR: token失効・別model・clearでfullに復帰し保持量を超過しない', () => {
  const encoder = new FrameDeltaEncoder({ maxEntries: 2, maxBytes: 16000 });
  const make = id => ({ schema: 'jsonui-frame-v1', modelId: id, layout: { boxes: [{ id: 'a', padding: 'x'.repeat(2000) }] }, propsById: {}, basePropsById: {} });
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const first = JSON.parse(encoder.encode(make(ids[0]), undefined, 3000));
  for (const id of ids.slice(1)) assert.equal(JSON.parse(encoder.encode(make(id), first.frameId, 3000)).schema, 'jsonui-frame-v1');
  assert.equal(encoder.snapshot().entries, 2); assert(encoder.snapshot().bytes <= 16000);
  assert.equal(JSON.parse(encoder.encode(make(ids[0]), first.frameId, 3000)).schema, 'jsonui-frame-v1');
  encoder.clear(); assert.equal(encoder.snapshot().bytes, 0);
});

test('差分IR: 不正patchと基底不一致を拒否し1回だけ全量再要求', async () => {
  const base = { schema: 'jsonui-frame-v1', modelId: randomUUID(), frameId: randomUUID(), transport: { fullBytes: 1024 }, layout: { boxes: [{ id: 'a', x: 1, y: 0, w: 18, h: 18 }] }, propsById: {}, basePropsById: {} };
  const patch = { schema: 'jsonui-frame-delta-v1', modelId: base.modelId, frameId: randomUUID(), baseFrameId: base.frameId,
    layoutDelta: { meta: { set: {}, remove: [] }, boxCount: 1, boxes: [[99, { set: { x: 2 }, remove: [] }]] }, propsDelta: { set: {}, remove: [] }, basePropsDelta: { set: {}, remove: [] } };
  assert.throws(() => restoreFrameDelta(base, patch), /NODE_FRAME_DELTA_INVALID/);
  const inputs = [];
  const client = createFrameDeltaClient(async input => { inputs.push(input); return inputs.length === 2 ? patch : base; });
  await client.render({ modelId: base.modelId }); await client.render({ modelId: base.modelId });
  assert.equal(inputs.length, 3); assert.equal(inputs[1].previousFrameId, base.frameId); assert.equal(inputs[2].previousFrameId, undefined);
  assert.equal(client.snapshot().retries, 1);
});

test('差分IR: 小さいbrowser LRU・旧Node応答への互換・中止を保持', async () => {
  const client = createFrameDeltaClient(async input => ({ schema: 'jsonui-frame-v1', modelId: input.modelId, frameId: randomUUID(), transport: { fullBytes: 1000 }, layout: { boxes: [] }, propsById: {}, basePropsById: {} }), { maxEntries: 1, maxBytes: 1500 });
  await client.render({ modelId: randomUUID() }); await client.render({ modelId: randomUUID() });
  assert.equal(client.snapshot().entries, 1); assert(client.snapshot().bytes <= 1500); client.clear(); assert.equal(client.snapshot().entries, 0);
  const legacy = createFrameDeltaClient(async () => ({ schema: 'jsonui-frame-v1', modelId: randomUUID(), layout: { boxes: [] } }));
  assert.equal((await legacy.render({})).schema, 'jsonui-frame-v1'); assert.equal(legacy.snapshot().entries, 0);
  const aborted = createFrameDeltaClient(async (_data, signal) => { signal.throwIfAborted(); });
  await assert.rejects(aborted.render({}, AbortSignal.abort()), { name: 'AbortError' });
});

test('差分IR: 同modelの並行context・応答逆転・別model切替は異なるsnapshotを混合しない', async () => {
  const processor = new FrameIrProcessor(), delayed = [];
  const client = createFrameDeltaClient(input => {
    const value = JSON.parse(processor.execute(input).body);
    if (input.generation === 2 || input.generation === 3) return new Promise(resolve => delayed.push(() => resolve(value)));
    return Promise.resolve(value);
  });
  const initial = await client.render({ file: fixture(), preset, animationTime: 0, generation: 1, mockData: { '#title': '基底', '#show': true } });
  const inputs = [2, 3].map(generation => ({ modelId: initial.modelId, preset, animationTime: generation / 10, generation, mockData: { '#title': `context${generation}`, '#show': true } }));
  const first = client.render(inputs[0]), second = client.render(inputs[1]);
  delayed[1](); const newer = await second; delayed[0](); const older = await first;
  for (const [frame, input] of [[older, inputs[0]], [newer, inputs[1]]]) assert.deepEqual(comparable(frame), comparable(JSON.parse(processor.execute(input).body)));
  const switchedFile = fixture(20); switchedFile.meta.selectedDefinition.qualifiedName = 'delta.another';
  const switched = await client.render({ file: switchedFile, preset, generation: 4 }); assert.notEqual(switched.modelId, initial.modelId);
  const returnInput = { ...inputs[1], generation: 5, animationTime: 1 };
  const returned = await client.render(returnInput); assert.deepEqual(comparable(returned), comparable(JSON.parse(processor.execute(returnInput).body)));
  assert(processor.snapshot().frame_transport.fallback >= 2);
});

test('保持state: 時刻要求を圧縮しmock版・intrinsic補正・scroll・eventの変更を取りこぼさない', async () => {
  const processor = new FrameIrProcessor(), inputs = [];
  const client = createFrameDeltaClient(async input => { inputs.push(input); return JSON.parse(processor.execute(input).body); });
  const file = fixture(), mockData = { '#title': '保持文字', '#show': true, unused: '日'.repeat(100000) };
  const firstInput = { file, preset, mockData, animationTime: 0, generation: 1, contextRevision: 'v1' };
  const first = await client.render(firstInput);
  const input = { ...firstInput, file: undefined, modelId: first.modelId, generation: 2, animationTime: 0.2 }; delete input.file;
  const next = await client.render(input);
  assert(inputs[1].contextId); assert.equal(inputs[1].mockData, undefined);
  assert(Buffer.byteLength(JSON.stringify(inputs[1])) < 500); assert(Buffer.byteLength(JSON.stringify(firstInput)) > 300000);
  assert.deepEqual(comparable(next), comparable(JSON.parse(processor.execute({ ...input, contextRevision: undefined }).body)));
  const label = Object.keys(file.nodesById).find(id => file.nodesById[id].props.name === 'label');
  for (const [index, change] of [
    { propsByIdOverride: { [label]: { size: [80, 16] } } }, { scrollById: { [file.rootId]: { x: 1, y: 0 } } },
    { animationEvent: 'screen.exit_pop' }, { mockData: { '#title': '新しい文字' }, contextRevision: 'v2' },
  ].entries()) {
    const changed = { ...input, ...change, generation: index + 3 };
    const frame = await client.render(changed); assert.equal(inputs.at(-1).contextId, undefined);
    assert.deepEqual(comparable(frame), comparable(JSON.parse(processor.execute(changed).body)));
  }
});

test('保持state: 明示版なしin-place変更・token失効fallback・不正上書き拒否・snapshot不変', async () => {
  const processor = new FrameIrProcessor(), inputs = [], mockData = { '#title': 'original', '#show': true };
  const client = createFrameDeltaClient(async input => { inputs.push(input); return JSON.parse(processor.execute(input).body); });
  const first = await client.render({ file: fixture(), preset, mockData, generation: 1 });
  const input = { modelId: first.modelId, preset, mockData, generation: 2 };
  await client.render(input); assert(inputs.at(-1).contextId);
  mockData['#title'] = 'in-place changed'; const mutated = await client.render({ ...input, generation: 3 }); assert.equal(inputs.at(-1).contextId, undefined);
  assert.deepEqual(comparable(mutated), comparable(JSON.parse(processor.execute({ ...input, generation: 3 }).body)));
  processor.contexts.clear(); const restored = await client.render({ ...input, generation: 4 });
  assert.equal(client.snapshot().context_retries, 1); assert.deepEqual(comparable(restored), comparable(JSON.parse(processor.execute({ ...input, generation: 4 }).body)));
  const token = restored.transport.contextId;
  assert.throws(() => processor.execute({ modelId: first.modelId, contextId: token, mockData: {} }), /NODE_FRAME_CONTEXT_INVALID/);
  assert.throws(() => processor.execute({ modelId: randomUUID(), contextId: token }), /NODE_FRAME_CONTEXT_STALE/);
  assert.throws(() => processor.execute({ modelId: first.modelId, contextId: token, animationTime: Infinity }), /NODE_FRAME_ANIMATION_TIME_INVALID/);
  mockData['#title'] = 'caller changed again';
  const snapshot = JSON.parse(processor.execute({ modelId: first.modelId, contextId: token, generation: 4 }).body);
  assert.deepEqual(comparable(snapshot), comparable(restored));
});

test('応答境界: clear後と取消後の遅延応答を返さず再保持しない', async () => {
  for (const action of ['clear', 'abort']) {
    let finish;
    const id = randomUUID(), controller = new AbortController();
    const client = createFrameDeltaClient(() => new Promise(resolve => { finish = resolve; }));
    const pending = client.render({ modelId: id, generation: 1 }, controller.signal);
    if (action === 'clear') client.clear(); else controller.abort();
    finish({ schema: 'jsonui-frame-v1', modelId: id, generation: 1, frameId: randomUUID(), transport: { fullBytes: 1024 }, layout: { boxes: [] } });
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(client.snapshot().entries, 0);
  }
});

test('応答境界: 全量応答のmodel/generation/token不一致と不正boxを保持前に拒否', async () => {
  const id = randomUUID(), frame = { schema: 'jsonui-frame-v1', modelId: id, generation: 3, frameId: randomUUID(), transport: { fullBytes: 1024 }, layout: { boxes: [] } };
  for (const changed of [
    { modelId: randomUUID() }, { modelId: 'invalid' }, { generation: 4 }, { frameId: 'invalid' },
    { layout: { boxes: [null] } }, { layout: { boxes: [{ id: 'a', x: NaN, y: 0, w: 1, h: 1 }] } },
    { layout: { boxes: [{ id: 'a', x: 0, y: 0, w: -1, h: 1 }] } },
    { layout: { boxes: Array.from({ length: 2 }, () => ({ id: 'duplicate', x: 0, y: 0, w: 1, h: 1 })) } },
  ]) {
    const client = createFrameDeltaClient(async () => ({ ...frame, ...changed }));
    await assert.rejects(client.render({ modelId: id, generation: 3 }), /NODE_FRAME_DELTA_INVALID/);
    assert.equal(client.snapshot().entries, 0);
  }
});

test('応答境界: 不正box置換・geometry削除patchは1回全量再取得し正常layoutへ復帰', async () => {
  const base = { schema: 'jsonui-frame-v1', modelId: randomUUID(), generation: 1, frameId: randomUUID(), transport: { fullBytes: 1024 },
    layout: { boxes: [{ id: 'a', x: 0, y: 0, w: 18, h: 18 }] }, propsById: {}, basePropsById: {} };
  for (const layoutDelta of [
    { replace: { boxes: [null] } },
    { boxCount: 1, meta: { set: {}, remove: [] }, boxes: [[0, { set: {}, remove: ['w'] }]] },
  ]) {
    const delta = { schema: 'jsonui-frame-delta-v1', modelId: base.modelId, generation: 2, frameId: randomUUID(), baseFrameId: base.frameId,
      layoutDelta, propsDelta: { set: {}, remove: [] }, basePropsDelta: { set: {}, remove: [] } };
    assert.throws(() => restoreFrameDelta(base, delta), /NODE_FRAME_DELTA_INVALID/);
    let calls = 0;
    const client = createFrameDeltaClient(async input => (++calls === 2 ? delta : { ...base, generation: input.generation }));
    await client.render({ modelId: base.modelId, generation: 1 });
    const returned = await client.render({ modelId: base.modelId, generation: 2 });
    assert.deepEqual(returned.layout, base.layout); assert.equal(calls, 3); assert.equal(client.snapshot().retries, 1);
  }
});

test('差分IR HTTP: 実Worker/server経由でfull/patch/state切替が一致し入力契約を検証', async t => {
  const app = await createLocalServer({ port: 0 }); t.after(() => app.close());
  const root = `http://127.0.0.1:${app.port}/api/node/`, cap = await (await fetch(root + 'capabilities')).json();
  const post = async data => {
    const response = await fetch(root + 'frame', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JSONUI-Token': cap.token }, body: JSON.stringify(data) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
  };
  const client = createFrameDeltaClient(post), first = await client.render({ file: fixture(), preset, animationTime: 0, generation: 1, mockData: { '#title': 'HTTP 最初', '#show': true } });
  const input = { modelId: first.modelId, preset, animationTime: 1, mockData: { '#title': 'HTTP 日本語', '#show': true }, generation: 2 };
  const next = await client.render(input), expected = await post(input); assert.deepEqual(comparable(next), comparable(expected));
  assert.equal(app.processor.snapshot().caches.frame_ir.frame_transport.delta, 1);
  await assert.rejects(post({ ...input, frameTransport: 'unknown' }), /NODE_FRAME_TRANSPORT_INVALID/);
  await assert.rejects(post({ ...input, frameTransport: 'delta-v1', previousFrameId: 'bad' }), /NODE_FRAME_TRANSPORT_INVALID/);
});
