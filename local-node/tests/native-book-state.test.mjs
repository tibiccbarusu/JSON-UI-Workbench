import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnchantingBookPreviewScene } from '../../editor-core/src/preview/native-model-preview.js';
import { readEnchantingBookPreviewState, resolveEnchantingBookPreviewScene } from '../../editor-core/src/preview/native-book-preview.js';
import { sampleNativePreviewMotion, inspectNativePreviewMotion } from '../../editor-core/src/preview/native-motion.js';

test('原UIのglobal #openはproperty_bag既定値より優先して開閉する', () => {
  const base = buildEnchantingBookPreviewScene({ openingDegrees: 140 });
  assert.equal(resolveEnchantingBookPreviewScene(base, {}).bookOpenAmount, 0);
  const closed = resolveEnchantingBookPreviewScene(base, { '#open': false, property_bag: { '#open': true } });
  const opened = resolveEnchantingBookPreviewScene(base, { '#open': true });
  assert.equal(closed.bookOpenAmount, 0); assert.equal(closed.openingDegrees, 0);
  assert.equal(opened.bookOpenAmount, 1); assert.equal(opened.openingDegrees, 140);
  assert.notDeepEqual(closed.faces, opened.faces);
  assert.deepEqual(closed.textureSize, base.textureSize);
  assert.equal(closed.geometrySource, base.geometrySource);
  assert.equal(closed.bookStateSource, 'RESOLVED_OPEN_BINDING');
  const defaultOpen = resolveEnchantingBookPreviewScene(base, { property_bag: { '#open': true } });
  assert.equal(defaultOpen.bookStateSource, 'AUTHORED_OPEN_DEFAULT');
});

test('数値 #open は有限の0..1で設定した最大開きまで補間する', () => {
  const base = buildEnchantingBookPreviewScene({ openingDegrees: 160 });
  for (const amount of [0, .25, .5, .75, 1]) {
    const scene = resolveEnchantingBookPreviewScene(base, { '#open': amount });
    assert.equal(scene.openingDegrees, 160 * amount);
    assert.ok(scene.faces.every(f => f.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))));
  }
});

test('開閉で物理縮尺を維持し、閉状態は横中央で表紙だけを見せる', () => {
  const base = buildEnchantingBookPreviewScene();
  const bounds = scene => {
    const points = scene.faces.flatMap(f => f.points);
    return [Math.min(...points.map(p=>p.x)), Math.max(...points.map(p=>p.x))];
  };
  for (const amount of [0, .3, .7, 1]) {
    const selected = resolveEnchantingBookPreviewScene(base, { '#open': amount });
    assert.equal(selected.motionMesh.normalization.scale, base.motionMesh.normalization.scale);
    const [x0,x1]=bounds(selected); assert.ok(Math.abs((x0+x1)/2-.5)<1e-12);
  }
  const closed=resolveEnchantingBookPreviewScene(base, {'#open':false});
  const opened=resolveEnchantingBookPreviewScene(base, {'#open':true});
  assert.ok(closed.faces.every(f=> !/_pages$|_leaf$/.test(f.boneName)));
  const c=bounds(closed),o=bounds(opened); assert.ok(c[1]-c[0] < (o[1]-o[0])*.5);
});

test('本の閉状態は時間とカーソルから独立し静止rasterを再利用できる', () => {
  const base = buildEnchantingBookPreviewScene();
  const scene = resolveEnchantingBookPreviewScene(base, { '#open': false });
  for (const timeMs of [0, 200, 10000]) {
    assert.equal(sampleNativePreviewMotion(scene, { timeMs, pointer: { active: true, x: 1, y: 1 } }), scene);
  }
  assert.equal(inspectNativePreviewMotion(scene).projections, 0);
});

test('開いた本も静止し、カーソルや経過時間で勝手に開閉しない', () => {
  const base = buildEnchantingBookPreviewScene();
  const scene = resolveEnchantingBookPreviewScene(base, { '#open': true });
  for (const timeMs of [0, 200, 2000, 99999]) {
    assert.equal(sampleNativePreviewMotion(scene, { timeMs, pointer: {active:true,x:1,y:1} }),scene);
  }
  assert.equal(inspectNativePreviewMotion(scene).projections,0);
  const leaves = scene.faces.filter(f => /_leaf$/.test(f.boneName));
  assert.ok(leaves.length >= 2);
  assert.ok(leaves.every(f => [24/64,29/64].includes(f.uv.x) && f.uv.y === 10/32));
});

test('同一状態は同じsceneを使い、最近8状態を超えた旧sceneは保持しない', () => {
  const base = buildEnchantingBookPreviewScene();
  const first = resolveEnchantingBookPreviewScene(base, { '#open': 0 });
  assert.equal(resolveEnchantingBookPreviewScene(base, { '#open': 0 }), first);
  for (let i = 1; i <= 9; i++) resolveEnchantingBookPreviewScene(base, { '#open': i / 10 });
  assert.notEqual(resolveEnchantingBookPreviewScene(base, { '#open': 0 }), first);
  assert.equal(base.bookOpenAmount, undefined);
  assert.equal(base.openingDegrees, 130);
});

test('誤った開閉値とaccessorを別の状態へ黙って置換しない', () => {
  const base = buildEnchantingBookPreviewScene();
  for (const value of [NaN, Infinity, -1, 1.1, 'true', '#open', null, [], {}]) {
    const props = { '#open': value, property_bag: { '#open': true } };
    assert.equal(readEnchantingBookPreviewState(props).status, 'invalid');
    assert.equal(resolveEnchantingBookPreviewScene(base, props), null);
  }
  let reads = 0;
  const hostile = { get '#open'() { reads++; throw new Error('getter'); } };
  assert.equal(resolveEnchantingBookPreviewScene(base, hostile), null);
  assert.equal(reads, 0);
  assert.equal(resolveEnchantingBookPreviewScene(null, { '#open': true }), null);
});

// The binding evaluator strips the leading # from resolved target properties.
test('実binding出力のopenを読むが明示#openと不正値診断は維持する',()=>{
 const base=buildEnchantingBookPreviewScene();
 assert.equal(resolveEnchantingBookPreviewScene(base,{open:true}).bookOpenAmount,1);
 assert.equal(resolveEnchantingBookPreviewScene(base,{open:false,property_bag:{'#open':true}}).bookOpenAmount,0);
 assert.equal(resolveEnchantingBookPreviewScene(base,{'#open':false,open:true}).bookOpenAmount,0);
 assert.equal(resolveEnchantingBookPreviewScene(base,{open:'invalid',property_bag:{'#open':true}}),null);
 let reads=0;assert.equal(resolveEnchantingBookPreviewScene(base,{get open(){reads++;return true}}),null);assert.equal(reads,0);
});
