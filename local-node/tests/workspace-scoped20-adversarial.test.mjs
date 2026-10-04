import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScopedEditContext, editWorkspaceScoped } from '../workspace-scoped-edit.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';

const encode = value => ({ 'ui/adversarial.json': JSON.stringify(value) });
const plain = value => JSON.parse(JSON.stringify(value));
const at = (value, pointer) => pointer.split('/').slice(1).reduce((current, part) =>
  current?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], value);

async function project(documents, symbol = 'a.screen', variables = {}) {
  const context = await buildScopedEditContext({ documents });
  const record = context.catalog.recordsById[context.catalog.symbols[symbol]?.winnerId];
  assert(record, `fixture の定義が存在する: ${symbol}`);
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id, variables });
  assert.equal(projection.ok, true, JSON.stringify(projection.error));
  return { context, record, projection };
}

async function request(documents, effectivePointer, overrides = {}) {
  const before = await project(documents, 'a.screen', overrides.preview?.variables);
  const source = before.projection.nodeSources[effectivePointer];
  assert(source, `fixture の選択要素が存在する: ${effectivePointer}`);
  const input = {
    documents, context: before.context, expectedRevision: before.context.revision,
    operation: {
      type: 'move', scope: 'screen', targetMode: 'interaction',
      screen: { path: before.context.internalPath(before.record), pointer: '/' + before.record.rawKey },
      path: before.context.internalPath(source), pointer: source.pointer, effectivePointer,
      delta: [5, 7], ...overrides,
    },
  };
  return { before, input };
}

test('SR01: catalog の候補打切り後に隠れる参照元へ screen 限定編集を波及させない', async () => {
  const value = { namespace: 'a', screen: {
    type: 'screen', controls: [{ button: { type: 'button', offset: [0, 0] } }],
  } };
  for (let i = 0; i < 70; i++) value['unused' + i] = { type: 'panel' };
  value.other = {
    type: 'screen', '$which|default': 'a.unused0',
    variables: Array.from({ length: 70 }, (_, i) => ({
      requires: '$mode' + i, '$which': i === 69 ? 'a.screen' : 'a.unused' + i,
    })),
    controls: [{ 'content@$which': {} }],
  };
  const documents = encode(value), original = JSON.stringify(documents);
  const { before, input } = await request(documents, '/screen/controls/0/button');
  const other = before.context.catalog.recordsById[before.context.catalog.symbols['a.other'].winnerId];
  assert.equal(other.referenceScanComplete, false, '上限に到達する実 catalog で検査する');
  assert.equal(other.references.includes('a.screen'), false, '打切り後に対象参照が隠れる');
  assert.deepEqual((await project(documents, 'a.other', { $mode69: true })).projection.document.other.controls[0].content.controls[0].button.offset, [0, 0]);
  const result = await editWorkspaceScoped(input);
  assert.equal(result.ok, false, '完全な参照元が不明でも screen 限定を成功扱いしない');
  assert.equal(result.code, 'EDIT_SCREEN_IS_SHARED');
  assert.equal(result.documents, undefined);
  assert.equal(JSON.stringify(documents), original);
});

test('SR02: 条件で変わる raw offset を現在のプレビュー値へ固定しない', async () => {
  const documents = encode({ namespace: 'a', screen: {
    type: 'screen', '$pos|default': [1, 2],
    variables: [{ requires: '$large', '$pos': [50, 60] }],
    controls: [{ btn: { type: 'button', offset: '$pos' } }],
  } });
  const original = JSON.stringify(documents);
  const { input } = await request(documents, '/screen/controls/0/btn', { preview: { variables: { $large: false } } });
  assert.deepEqual((await project(documents, 'a.screen', { $large: true })).projection.document.screen.controls[0].btn.offset, [50, 60]);
  const result = await editWorkspaceScoped(input);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EDIT_DYNAMIC_OFFSET');
  assert.equal(result.documents, undefined);
  assert.equal(JSON.stringify(documents), original);
});

test('SR03: 動的 grid template の状態切替と別画面を保ったまま選択基底を分離する', async () => {
  const documents = encode({ namespace: 'a',
    row1: { type: 'button', size: [10, 10] }, row2: { type: 'button', size: [20, 20] },
    grid: { type: 'grid', grid_dimensions: [1, 1], '$row|default': 'a.row1',
      variables: [{ requires: '$large', '$row': 'a.row2' }], grid_item_template: '$row' },
    screen: { type: 'screen', controls: [{ 'grid@a.grid': {} }] },
    other: { type: 'screen', controls: [{ 'grid@a.grid': {} }] },
  });
  const pointer = '/screen/controls/0/grid/controls/0/preview_slot_0';
  const { input } = await request(documents, pointer, {
    type: 'set', property: 'size', value: [30, 30], generatedScope: 'template',
    preview: { variables: { $large: false } },
  });
  const result = await editWorkspaceScoped(input);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(at((await project(result.documents)).projection.document, pointer).size, [30, 30]);
  const alternate = (await project(result.documents, 'a.screen', { $large: true })).projection.document;
  assert.deepEqual(at(alternate, pointer).size, [20, 20], '別条件の row2 を row1 へ固定しない');
  for (const $large of [false, true]) assert.deepEqual(
    plain((await project(result.documents, 'a.other', { $large })).projection.document),
    plain((await project(documents, 'a.other', { $large })).projection.document),
    '別画面の各状態を保持する',
  );
});

test('SR04: alias 経由の継承を編集しても別条件のテクスチャを失わない', async () => {
  const documents = encode({ namespace: 'a',
    one: { type: 'panel', controls: [{ img: { type: 'image', texture: 'one' } }] },
    two: { type: 'panel', controls: [{ img: { type: 'image', texture: 'two' } }] },
    wrapper: { type: 'panel', '$chosen|default': 'a.one', '$alias': '$chosen',
      variables: [{ requires: '$large', '$chosen': 'a.two' }], controls: [{ 'content@$alias': {} }] },
    screen: { type: 'screen', controls: [{ 'wrap@a.wrapper': {} }] },
    other: { type: 'screen', controls: [{ 'wrap@a.wrapper': {} }] },
  });
  const pointer = '/screen/controls/0/wrap/controls/0/content/controls/0/img';
  const { input } = await request(documents, pointer, {
    targetMode: 'visual', preview: { variables: { $large: false } },
  });
  const result = await editWorkspaceScoped(input);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(at((await project(result.documents)).projection.document, pointer).offset, [5, 7]);
  const alternate = at((await project(result.documents, 'a.screen', { $large: true })).projection.document, pointer);
  assert.equal(alternate.texture, 'two');
  assert.equal(alternate.offset, undefined);
  for (const $large of [false, true]) assert.deepEqual(
    plain((await project(result.documents, 'a.other', { $large })).projection.document),
    plain((await project(documents, 'a.other', { $large })).projection.document),
  );
});

for (const property of ['offset', 'texture']) for (const localOverride of [true, false]) test(`SR05 ${property}: ${localOverride ? '兄弟の同名局所変数' : '親の共用変数'} を使う文字列を private 名へ変えない`, async () => {
  const documents = encode({ namespace: 'a',
    base: { type: 'panel', controls: [{ image: { type: 'image', texture: 'textures/main' } }] },
    screen: { type: 'screen', '$which|default': 'a.base', controls: [
      { 'content@$which': {} },
      { label: { type: 'label', ...(localOverride ? { '$which': 'a.base' } : {}), text: '$which' } },
    ] },
  });
  const pointer = '/screen/controls/0/content/controls/0/image', original = JSON.stringify(documents);
  const { input } = await request(documents, pointer, {
    targetMode: 'visual',
    ...(property === 'texture' ? { type: 'set', property, value: 'textures/changed' } : {}),
  });
  const result = await editWorkspaceScoped(input);
  if (localOverride) assert.equal(result.ok, true, JSON.stringify(result.error));
  if (result.ok) {
    const after = (await project(result.documents)).projection.document;
    if (property === 'offset') assert.deepEqual(at(after, pointer).offset, [5, 7]);
    else assert.equal(at(after, pointer).texture, 'textures/changed');
    assert.equal(after.screen.controls[1].label.text, 'a.base', '表示文字列は clone の参照先ではない');
    if (localOverride) assert.equal(after.screen.controls[1].label.$which, 'a.base', '無関係な局所宣言を変えない');
  } else {
    assert.equal(result.documents, undefined, '共用変数への副作用を保持できない場合は無変更で拒否する');
  }
  assert.equal(JSON.stringify(documents), original, '入力原文を変更しない');
});

for (const scope of ['screen', 'shared']) test(`SR06 ${scope}: 同じ原文の静的配置違いを一つの絶対位置へつぶさない`, async () => {
  const documents = encode({ namespace: 'a',
    base: { type: 'panel', controls: [{ image: { type: 'image', offset: '$pos' } }] },
    screen: { type: 'screen', controls: [
      { 'first@a.base': { '$pos': [1, 2] } },
      { 'second@a.base': { '$pos': [50, 60] } },
    ] },
  });
  const original = JSON.stringify(documents);
  const { input } = await request(documents, '/screen/controls/0/first/controls/0/image', {
    scope, targetMode: 'visual', generatedScope: 'template',
  });
  const result = await editWorkspaceScoped(input);
  if (result.ok) {
    const after = (await project(result.documents)).projection.document.screen.controls;
    assert.deepEqual(after[0].first.controls[0].image.offset, [6, 9]);
    assert.deepEqual(after[1].second.controls[0].image.offset, [55, 67],
      'template 同意は共通 delta の適用であり、異なる元位置を同じ座標にそろえる同意ではない');
  } else {
    assert.equal(result.documents, undefined, '配置差分を保持できない場合は無変更で拒否する');
  }
  assert.equal(JSON.stringify(documents), original);
});
