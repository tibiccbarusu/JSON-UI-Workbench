/** 0.12.1 を基準とした位置 animation ガード。静的非配置経路だけを解除する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScopedEditContext, editWorkspaceScoped } from '../workspace-scoped-edit.mjs';
import { resolveEffectiveUi } from '../../editor-core/src/engine/effective-ui-resolver.js';

async function move({ definitions = {}, props = {}, other = {}, imageKey = 'image' } = {}) {
  const path = 'ui/animation26.json';
  const documents = Object.fromEntries(Object.entries({ [path]: { namespace: 'a', ...definitions,
    screen: { type: 'screen', controls: [{ [imageKey]: { type: 'image', offset: [4, 5], anims: ['@a.fade'], ...props } }] } }, ...other })
    .map(([key, value]) => [key, JSON.stringify(value)]));
  const before = JSON.stringify(documents), context = await buildScopedEditContext({ documents });
  const record = context.catalog.recordsById[context.catalog.symbols['a.screen'].winnerId];
  const projection = resolveEffectiveUi({ catalog: context.catalog, recordId: record.id });
  assert.equal(projection.ok, true, JSON.stringify(projection));
  const effectivePointer = '/screen/controls/0/image', source = projection.nodeSources[effectivePointer];
  const result = await editWorkspaceScoped({ documents, context, expectedRevision: context.revision, operation: {
    type: 'move', scope: 'shared', targetMode: 'visual', screen: { path, pointer: '/screen' },
    path: context.internalPath(source), pointer: source.pointer, effectivePointer, delta: [2, -1],
  } });
  assert.equal(JSON.stringify(documents), before, '入力原文は変更しない');
  if (result.ok) {
    const original = JSON.parse(documents[path]), after = JSON.parse(result.documents[path]);
    original.screen.controls[0][imageKey].offset = [6, 4];
    assert.deepEqual(after, original, '位置以外の原文意味を保持');
    for (const key of Object.keys(documents).filter(key => key !== path)) assert.equal(result.documents[key], documents[key]);
  } else assert.equal(result.documents, undefined, '拒否した編集を公開しない');
  return result;
}
const alpha = { anim_type: 'alpha', from: 0, to: 1, duration: 1 };
const offset = { anim_type: 'offset', from: [0, 0], to: [1, 1], duration: 1 };

test('非配置 alpha/color/uv/flip_book/wait の静的参照はドラッグ可能', async () => {
  for (const anim_type of ['alpha', 'color', 'uv', 'flip_book', 'wait']) {
    const result = await move({ definitions: { fade: { ...alpha, anim_type } } });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});

test('別ファイル継承とnextは宣言元namespaceを保持して追跡する', async () => {
  const result = await move({ definitions: { 'fade@other.base': {} }, other: {
    'ui/other.json': { namespace: 'other', base: { ...alpha, next: '@tail' }, tail: { anim_type: 'wait', duration: 1 } },
  } });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('offset/size/未知型およびnext先の位置animationは従来通り拒否', async () => {
  for (const definitions of [{ fade: offset }, { fade: { ...offset, anim_type: 'size' } },
    { fade: { ...alpha, anim_type: 'future_type' } }, { fade: { ...alpha, next: '@slide' }, slide: offset }]) {
    const result = await move({ definitions });
    assert.equal(result.code, 'EDIT_ANIMATED_POSITION');
  }
});

test('未解決/循環/動的next/イベント副作用のある参照は拒否', async () => {
  for (const definitions of [{}, { fade: { ...alpha, next: '@fade' } }, { fade: { ...alpha, next: '$next', '$next': '@tail' }, tail: alpha },
    { fade: { ...alpha, end_event: 'screen.move' } }, { fade: { ...alpha, destroy_at_end: true } }]) {
    assert.equal((await move({ definitions })).code, 'EDIT_ANIMATED_POSITION');
  }
});

test('変数経由のanimsは現在alphaでも空でも固定せず拒否', async () => {
  for (const variable of [['@a.fade'], []]) assert.equal((await move({ definitions: { fade: alpha },
    props: { anims: '$tracks', '$tracks': variable } })).code, 'EDIT_ANIMATED_POSITION');
});

test('プロパティに直接指定したanimationも型を確認し、変数参照を固定しない', async () => {
  assert.equal((await move({ definitions: { fade: alpha }, props: { anims: [], alpha: '@a.fade' } })).ok, true);
  assert.equal((await move({ definitions: { fade: offset }, props: { anims: [], alpha: '@a.fade' } })).code, 'EDIT_ANIMATED_POSITION');
  assert.equal((await move({ definitions: { fade: alpha }, props: { anims: [], alpha: '$track', '$track': '@a.fade' } })).code, 'EDIT_ANIMATED_POSITION');
});

test('継承したanims/直接alphaの省略namespaceは選択screenの同名定義で置き換えない', async () => {
  for (const direct of [false, true]) {
    for (const baseMoves of [true, false]) {
      const result = await move({ imageKey: 'image@other.image', props: { anims: undefined },
        definitions: { fade: baseMoves ? alpha : offset }, other: {
          'ui/other.json': { namespace: 'other', image: { type: 'image',
            ...(direct ? { alpha: '@fade' } : { anims: ['@fade'] }) }, fade: baseMoves ? offset : alpha },
        } });
      if (baseMoves) assert.equal(result.code, 'EDIT_ANIMATED_POSITION', `${direct ? 'alpha' : 'anims'} の other.fade(offset) を a.fade(alpha) へ取り違えない`);
      else assert.equal(result.ok, true, JSON.stringify(result));
    }
  }
});

test('継承したnextの省略namespaceはcaller側の同名alphaで位置animationを隠さない', async () => {
  const result = await move({ definitions: { 'fade@other.base': {}, tail: alpha }, other: {
    'ui/other.json': { namespace: 'other', base: { ...alpha, next: '@tail' }, tail: offset },
  } });
  assert.equal(result.code, 'EDIT_ANIMATED_POSITION');
});
