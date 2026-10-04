import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceEditor, renderWorkspaceSourceEditor } from '../src/ui/workspace-editor.js';
import { createWorkspaceEditIntent, workspacePreviewEditOperation, renderWorkspaceEditPolicy, renderWorkspaceEditPlan } from '../src/ui/workspace-edit-intent.js';
import { setSiteLocale } from '../src/i18n/site-messages.js';

const element = (tag, attrs = {}, children = []) => ({ tag, attrs, children: children.flat(Infinity).filter(value => value !== '' && value != null), value: attrs.value ?? '' });
const descendants = node => typeof node === 'object' && node ? [node, ...(node.children || []).flatMap(descendants)] : [];
const visibleText = node => typeof node === 'object' ? (node?.children || []).map(visibleText).join(' ') : String(node);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function stateFixture() {
  return { workspaceId: 'workspace', revision: 'rev1', activePath: 'ui/common.json', activeSourceId: 'base', selectedPointer: '/button/controls/0/image',
    editScope: 'screen', editTargetMode: 'interaction', editGeneratedTemplate: false, busy: false,
    previewSelection: { fileId: 'preview:anvil', previewDefinitionId: 'anvil.main', nodeId: 'root/main/button/image', path: 'ui/common.json', sourceId: 'base', pointer: '/button/controls/0/image',
      effectivePointer: '/main/controls/0/button/controls/0/image', screen: { path: 'ui/anvil.json', pointer: '/main', sourceId: 'custom' } } };
}
function resultFixture(overrides = {}) {
  return { ok: true, revision: 'rev1', editPlan: { scope: 'screen', targetMode: 'interaction', promoted: true, generated: false, affectedInstances: 1,
    selected: { path: 'ui/common.json', pointer: '/button/controls/0/image', type: 'image', rawKey: 'image' },
    target: { path: 'ui/common.json', pointer: '/button', type: 'button', rawKey: 'button' },
    affectedScreens: [{ path: 'ui/anvil.json', pointer: '/main' }], ...overrides } };
}

test('既定値はこのUIと見た目の部品で、明示interactionとvisualのidentityを区別', () => {
  const controller = createWorkspaceEditor({ request: async () => ({ ok: true }) });
  assert.equal(controller.state.editScope, 'screen'); assert.equal(controller.state.editTargetMode, 'visual');
  const state = stateFixture();
  const operation = workspacePreviewEditOperation(state, { type: 'move', delta: [5, -4] });
  assert.deepEqual(operation.screen, { path: 'ui/anvil.json', pointer: '/main', sourceId: 'custom' });
  assert.equal(operation.path, 'ui/common.json'); assert.equal(operation.pointer, '/button/controls/0/image');
  assert.equal(operation.scope, 'screen'); assert.equal(operation.targetMode, 'interaction');
  assert.deepEqual(operation.delta, [5, -4]); assert(!Object.hasOwn(operation, 'value')); assert(!Object.hasOwn(operation, 'generatedScope'));
});

test('文字・texture属性は選んだ部品、位置・サイズは操作要素へ適用する', () => {
  const state = stateFixture();
  for (const property of ['offset', 'size', 'min_size', 'max_size', 'anchor_from', 'anchor_to']) assert.equal(workspacePreviewEditOperation(state, { type: 'set', property, value: [1, 2] }).targetMode, 'interaction');
  for (const property of ['text', 'texture', 'color', 'visible', '$raw']) {
    const operation = workspacePreviewEditOperation(state, { type: 'set', property, value: '日本語 <raw>' });
    assert.equal(operation.targetMode, 'visual'); assert.equal(operation.value, '日本語 <raw>'); assert.equal(operation.property, property);
    assert.equal(operation.pointer, '/button/controls/0/image');
  }
  state.editTargetMode = 'visual'; assert.equal(workspacePreviewEditOperation(state).targetMode, 'visual');
});

test('screenや選択原文が古い場合は共有原文setへフォールバックしない', () => {
  for (const corrupt of [state => { state.previewSelection.screen = null; }, state => { state.activePath = 'ui/other.json'; },
    state => { state.activeSourceId = 'different-pack'; }, state => { state.selectedPointer = '/other'; }, state => { state.previewSelection.effectivePointer = ''; }]) {
    const state = stateFixture(); corrupt(state);
    assert.throws(() => workspacePreviewEditOperation(state), { code: 'WORKSPACE_PREVIEW_EDIT_SELECTION_REQUIRED' });
  }
});

test('事前計画は通信のみで、revision・busy・原文を変更せず同じ要求を共有する', async () => {
  const state = stateFixture(), waiting = deferred(), requests = [], changes = [];
  const intent = createWorkspaceEditIntent({ state, request: (...args) => { requests.push(args); return waiting.promise; }, notify: kind => changes.push(kind) });
  const first = intent.plan(), second = intent.plan();
  assert.equal(requests.length, 1); assert.equal(state.busy, false); assert.equal(state.revision, 'rev1'); assert.equal(state.editPlanBusy, true);
  assert.equal(requests[0][0], 'edit'); assert.equal(requests[0][1].operation.type, 'planEdit');
  assert.equal(requests[0][1].operation.intendedType, 'move'); assert.equal(requests[0][1].expectedRevision, 'rev1');
  waiting.resolve(resultFixture());
  assert.deepEqual(await first, await second); assert.equal(state.editPlanBusy, false);
  await intent.plan(); assert.equal(requests.length, 1); assert(!changes.includes('busy'));
});

test('前のUIの遅延応答が、新しい選択の計画を上書きしない', async () => {
  const state = stateFixture(), waits = [], signals = [];
  const intent = createWorkspaceEditIntent({ state, request: (_route, _payload, options) => { const waiting = deferred(); waits.push(waiting); signals.push(options.signal); return waiting.promise; }, notify() {} });
  const first = intent.plan(); const firstRejected = assert.rejects(first, { code: 'WORKSPACE_SELECTION_SUPERSEDED' });
  state.previewSelection.nodeId = 'new'; state.previewSelection.screen.pointer = '/second'; intent.invalidate();
  const second = intent.plan(); waits[1].resolve(resultFixture({ target: { pointer: '/new', type: 'edit_box' } }));
  await second; waits[0].resolve(resultFixture()); await firstRejected;
  assert.equal(signals[0].aborted, true); assert.equal(state.editPlan.target.pointer, '/new');
});

test('scope切替・target切替は古い計画とテンプレート同意を取り消す', async () => {
  const state = stateFixture();
  const intent = createWorkspaceEditIntent({ state, request: async () => resultFixture(), notify() {} });
  await intent.plan(); intent.setGeneratedTemplate(true);
  intent.setOptions({ scope: 'shared' });
  assert.equal(state.editScope, 'shared'); assert.equal(state.editPlan, null); assert.equal(state.editGeneratedTemplate, false);
  intent.setOptions({ targetMode: 'visual' }); assert.equal(state.editTargetMode, 'visual');
  assert.throws(() => intent.setOptions({ scope: 'guess' }), { code: 'WORKSPACE_EDIT_SCOPE_INVALID' });
  assert.throws(() => intent.setOptions({ targetMode: 'nearest-image' }), { code: 'WORKSPACE_EDIT_TARGET_INVALID' });
});

test('生成テンプレートは明示チェック前にmutationを一切送らない', async () => {
  const state = stateFixture(), mutations = [];
  const intent = createWorkspaceEditIntent({ state, request: async () => resultFixture({ generated: true, affectedInstances: 27 }), notify() {} });
  const edit = async operation => { mutations.push(operation); return { ok: true }; };
  await assert.rejects(intent.apply({ type: 'move', delta: [1, 2] }, edit), { code: 'WORKSPACE_GENERATED_SCOPE_REQUIRED' });
  assert.equal(mutations.length, 0); assert.equal(state.editPlan.affectedInstances, 27);
  intent.setGeneratedTemplate(true); await intent.apply({ type: 'move', delta: [1, 2] }, edit);
  assert.equal(mutations.length, 1); assert.equal(mutations[0].generatedScope, 'template');
  assert.equal(state.editGeneratedTemplate, false); assert.equal(state.lastEditPlan.affectedInstances, 27);
});

test('非generatedでも共有ソースを使う複数インスタンスは明示同意が必要', async () => {
  const state = stateFixture();
  const intent = createWorkspaceEditIntent({ state, request: async () => resultFixture({ generated: false, affectedInstances: 2 }), notify() {} });
  await assert.rejects(intent.apply({ type: 'move', delta: [2, 3] }, () => { throw Error('送信してはいけない'); }), { code: 'WORKSPACE_GENERATED_SCOPE_REQUIRED' });
});

test('失敗・形式不正の計画で保存せず、理由を保持して再確認できる', async () => {
  const state = stateFixture(); let attempt = 0;
  const intent = createWorkspaceEditIntent({ state, request: async () => ++attempt === 1
    ? { ok: false, error: { code: 'EDIT_TARGET_MISMATCH', message: '選択が一致しません' } } : resultFixture(), notify() {} });
  await assert.rejects(intent.apply({ type: 'move', delta: [1, 2] }, () => { throw Error('保存禁止'); }), { code: 'EDIT_TARGET_MISMATCH' });
  assert.equal(state.editPlanError, '選択が一致しません'); assert.equal(state.editPlanBusy, false);
  await intent.plan(); assert.equal(state.editPlanError, '');
});

test('選択部品と実際の操作owner・同一画面内の反復を区別して表示する', () => {
  const state = { ...stateFixture(), editPlan: resultFixture({ generated: true, affectedInstances: 27 }).editPlan };
  const controller = { state, setEditGeneratedTemplate(value) { state.editGeneratedTemplate = value; }, planPreviewEdit: async () => state.editPlan };
  const rendered = renderWorkspaceEditPlan(element, { controller });
  const text = visibleText(rendered);
  assert.match(text, /image \(image\)/); assert.match(text, /button \(button\)/); assert.match(text, /27/); assert.match(text, /この 1 枠だけ/);
  const checkbox = descendants(rendered).find(node => node.attrs.id === 'workspace-generated-template');
  assert.equal(checkbox.attrs.checked, false); checkbox.attrs.onChange({ currentTarget: { checked: true } }); assert.equal(state.editGeneratedTemplate, true);
});

test('英語UIでもパックの原文名・pointer・値は翻訳しない', () => {
  const state = { ...stateFixture(), editPlan: resultFixture({ selected: { rawKey: '閉じる <button>', pointer: '/操作' } }).editPlan };
  const controller = { state, planPreviewEdit: async () => state.editPlan };
  setSiteLocale('en_US');
  try {
    const policy = visibleText(renderWorkspaceEditPolicy(element, { controller }));
    assert.match(policy, /Only this UI/); assert.match(policy, /Whole control/); assert.doesNotMatch(policy, /この UI/);
    const plan = visibleText(renderWorkspaceEditPlan(element, { controller }));
    assert.match(plan, /Actual editing target/); assert.match(plan, /閉じる <button>/);
  } finally { setSiteLocale('ja_JP'); }
});

test('このUI限定の選択中に直接JSON・継承・削除を共有編集として誤実行させない', () => {
  const state = { ...stateFixture(), nodes: [{ path: 'ui/common.json', sourceId: 'base', pointer: '/button/controls/0/image', rawKey: 'image', props: {} }],
    files: [], drafts: new Map([[JSON.stringify(['base', 'ui/common.json']), { text: '{}' }]]) };
  const rendered = renderWorkspaceSourceEditor(element, { controller: { state }, renderPicker: options => element('picker', options) });
  const nodes = descendants(rendered);
  assert.equal(nodes.find(node => node.attrs.id === 'workspace-source-text').attrs.readonly, 'readonly');
  for (const label of ['検証して反映', '継承の変更を追加', 'この要素の削除範囲を確認']) {
    assert.equal(nodes.find(node => node.tag === 'button' && visibleText(node) === label).attrs.disabled, true, label);
  }
  assert.match(visibleText(rendered), /共有元を編集/);
});

test('位置サイズの属性欄は選択画像の値をownerへ流用せず、確認後にownerの値を出す', () => {
  const state = { ...stateFixture(), nodes: [{ path: 'ui/common.json', sourceId: 'base', pointer: '/button/controls/0/image', rawKey: 'image', props: { size: [18, 18], offset: [2, 3] } }],
    files: [], drafts: new Map([[JSON.stringify(['base', 'ui/common.json']), { text: '{}' }]]) };
  const controller = { state, planPreviewEdit: async () => state.editPlan };
  const render = () => descendants(renderWorkspaceSourceEditor(element, { controller, renderPicker: options => element('picker', options) }));
  let input = render().find(node => node.attrs.id === 'workspace-property-value');
  assert.equal(input.value, ''); assert.equal(input.attrs.disabled, true);
  state.editPlan = resultFixture({ target: { type: 'button', pointer: '/button', props: { size: [21, 21] } } }).editPlan;
  input = render().find(node => node.attrs.id === 'workspace-property-value');
  assert.deepEqual(JSON.parse(input.value), [21, 21]); assert.equal(input.attrs.disabled, false);
  state.editPlan.target.props = {}; input = render().find(node => node.attrs.id === 'workspace-property-value');
  assert.equal(input.value, '', 'ownerに未指定なら子画像の18×18を表示しない');
});

test('factory代表データは選択時の投影に使った同一条件でNodeへ渡す', () => {
  const state = stateFixture();
  const preview = { variables: { '$title': '日本語' }, representativeCollections: { rows: [{ label: '保持' }] } };
  state.previewSelection.preview = preview;
  assert.deepEqual(workspacePreviewEditOperation(state).preview, preview);
});

test('同一UI・同一テンプレートでも代表件数が変われば前のテンプレート同意を解除する', async () => {
  const state = stateFixture(); state.previewSelection.preview = { representativeCollections: { rows: [{}, {}] } };
  const intent = createWorkspaceEditIntent({ state, request: async () => resultFixture({ generated: 'factory', affectedInstances: state.previewSelection.preview.representativeCollections.rows.length }), notify() {} });
  await intent.plan(); intent.setGeneratedTemplate(true); assert.equal(state.editGeneratedTemplate, true);
  state.previewSelection.preview = { representativeCollections: { rows: Array.from({ length: 10 }, () => ({})) } };
  await intent.plan(); assert.equal(state.editPlan.affectedInstances, 10); assert.equal(state.editGeneratedTemplate, false);
  await assert.rejects(intent.apply({ type: 'move', delta: [1, 2] }, () => { throw Error('古い範囲への同意で保存禁止'); }), { code: 'WORKSPACE_GENERATED_SCOPE_REQUIRED' });
});

test('controller再選択はpreview条件とscreen・effectivePointerも比較して計画を破棄する', async () => {
  const controller = createWorkspaceEditor({ request: async () => resultFixture({ generated: 'factory', affectedInstances: 2 }) });
  Object.assign(controller.state, stateFixture());
  const selected = controller.state.previewSelection;
  controller.state.nodes = [{ path: selected.path, sourceId: selected.sourceId, pointer: selected.pointer, rawKey: 'image' }];
  controller.state.documents.set(JSON.stringify([selected.sourceId, selected.path]), { text: '{}' });
  for (const mutate of [next => { next.preview = { representativeCollections: { rows: [{}, {}, {}] } }; },
    next => { next.effectivePointer += '/changed'; }, next => { next.screen = { ...next.screen, pointer: '/second' }; }, next => { next.fileId = 'another'; }]) {
    await controller.planPreviewEdit(); controller.setEditGeneratedTemplate(true);
    const next = structuredClone(controller.state.previewSelection); mutate(next);
    await controller.selectPreviewTarget({ path: selected.path, sourceId: selected.sourceId, pointer: selected.pointer }, next);
    assert.equal(controller.state.editPlan, null); assert.equal(controller.state.editGeneratedTemplate, false);
  }
});
