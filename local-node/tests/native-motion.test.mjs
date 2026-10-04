import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnchantingBookPreviewScene, compileBedrockGeometryScene } from '../../editor-core/src/preview/native-model-preview.js';
import { sampleNativePreviewMotion, inspectNativePreviewMotion } from '../../editor-core/src/preview/native-motion.js';
import { resolveNativeScenePlacement, CLASSIC_HORSE_PLACEMENT_PROFILE } from '../../editor-core/src/preview/native-scene-placement.js';

function horse(camera = { yaw: -32, pitch: 18 }, retainMotionMesh = true) {
  const result = compileBedrockGeometryScene({ texturewidth: 64, textureheight: 64,
    bones: [{ name: 'body', cubes: [{ origin: [-4, 0, -2], size: [8, 12, 4], uv: [0, 0] }] }] },
  { camera, retainMotionMesh });
  assert.equal(result.ok, true);
  return { ...result.scene, presentationProfile: CLASSIC_HORSE_PLACEMENT_PROFILE };
}

test('本は同一時刻・異なる時刻・seedで自発運動しない', () => {
  const scene = buildEnchantingBookPreviewScene();
  for (const timeMs of [200, 239, 2040]) assert.equal(sampleNativePreviewMotion(scene, {timeMs, seed:'enchanting'}),scene);
  assert.equal(scene.approximation, 'built-in-book-shape-not-provided-by-pack');
});

test('馬のカーソル操作は投影を変えpointerleaveで原sceneに戻る', () => {
  const scene = horse();
  const a = sampleNativePreviewMotion(scene, { pointer: { active: true, x: -1, y: -.5 } });
  const b = sampleNativePreviewMotion(scene, { pointer: { active: true, x: 1, y: .5 } });
  assert.notDeepEqual(a.faces, b.faces);
  assert.deepEqual(a.camera, { yaw: -64, pitch: 27 });
  assert.deepEqual(b.camera, { yaw: 0, pitch: 9 });
  assert.equal(sampleNativePreviewMotion(scene, { pointer: { active: false, x: 1, y: 1 } }), scene);
  assert.equal(sampleNativePreviewMotion(scene, {}), scene);
});

test('OFF・非表示は再投影せず、一時停止は直前poseを保持する', () => {
  const scene = buildEnchantingBookPreviewScene();
  const a = sampleNativePreviewMotion(scene, { timeMs: 360 });
  assert.equal(sampleNativePreviewMotion(scene, { timeMs: 9999, paused: true }), a);
  assert.equal(sampleNativePreviewMotion(scene, { timeMs: 9999, enabled: false }), scene);
  assert.equal(sampleNativePreviewMotion(scene, { timeMs: 9999, visible: false }), scene);
  assert.equal(inspectNativePreviewMotion(scene).projections, 0);
});

test('カーソルとpitchをclampしyawを周期化してNaN/Infinityを伝播しない', () => {
  const scene = horse({ yaw: 175, pitch: -87 });
  const a = sampleNativePreviewMotion(scene, { pointer: { active: true, x: 9000, y: 9000 } });
  assert.deepEqual(a.camera, { yaw: -153, pitch: -89 });
  const b = sampleNativePreviewMotion(scene, { pointer: { active: true, x: Infinity, y: NaN } });
  assert.deepEqual(b.camera, { yaw: 175, pitch: -87 });
  for (const face of b.faces) for (const point of face.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test('見切り面も中間meshに保持され、edge-on方向から回すと現れる', () => {
  const scene = horse({ yaw: 0, pitch: 0 });
  assert.equal(scene.motionMesh.faces.length, 6);
  assert.equal(scene.faces.length, 2);
  const next = sampleNativePreviewMotion(scene, { pointer: { active: true, x: 1, y: -1 } });
  assert.equal(next.faces.length, 6);
});

test('静止compileの描画facesはmeshの有無で一致する', () => {
  const without = horse({ yaw: -32, pitch: 18 }, false), withMesh = horse();
  assert.deepEqual(withMesh.faces, without.faces);
  assert.equal(Object.hasOwn(without, 'motionMesh'), false);
});

test('カーソル移動で本体の縮尺と足元anchorを再フィットしない', () => {
  const scene = horse(); const d = { x: 80, y: 80, w: 30, h: 30 };
  const a = sampleNativePreviewMotion(scene, { pointer: { active: true, x: -1, y: -1 } });
  const b = sampleNativePreviewMotion(scene, { pointer: { active: true, x: 1, y: 1 } });
  assert.deepEqual(resolveNativeScenePlacement(a, d), resolveNativeScenePlacement(b, d));
  assert.ok(resolveNativeScenePlacement(a, d));
});

test('大きい時間・seedでも有限値と本の開き0〜180度を維持する', () => {
  for (const openingDegrees of [0, 180]) {
    const scene = buildEnchantingBookPreviewScene({ openingDegrees });
    for (const timeMs of [NaN, Infinity, -10000, 0, 1e30]) {
      const pose = sampleNativePreviewMotion(scene, { timeMs, seed: 'a'.repeat(10000) });
      assert.equal(pose,scene); assert.ok(pose.openingDegrees >= 0 && pose.openingDegrees <= 180);
      for (const face of pose.faces) for (const p of face.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    }
  }
});

test('多数の時刻でも本のposeを生成せずsourceは変更しない', () => {
  const scene = buildEnchantingBookPreviewScene(); const before = JSON.stringify(scene);
  for (let i = 0; i < 100; i += 1) sampleNativePreviewMotion(scene, { timeMs: i * 80 });
  const result = inspectNativePreviewMotion(scene);
  assert.equal(result.retainedPoses, 0);
  assert.equal(result.projections, 0);
  assert.equal(JSON.stringify(scene), before);
  assert.equal(result.sourceReadsPerSample, 0);
  assert.equal(result.geometryCompilesPerSample, 0);
  assert.ok(result.meshBytes <= result.maximumMeshBytes);
});

test('動態meshの上限超過は静止描画を維持し理由を明示する', () => {
  const result = compileBedrockGeometryScene({ texturewidth: 64, textureheight: 64,
    bones: [{ name: 'body', cubes: [{ origin: [-4, 0, -2], size: [8, 12, 4], uv: [0, 0] }] }] },
  { camera: { yaw: 0, pitch: 0 }, retainMotionMesh: true, limits: { maxFaces: 2 } });
  assert.equal(result.ok, true); assert.equal(result.scene.faces.length, 2);
  assert.equal(result.scene.motionIssue, 'NATIVE_PREVIEW_MOTION_MESH_LIMIT_EXCEEDED');
  assert.equal(sampleNativePreviewMotion(result.scene, { pointer: { active: true, x: 1 } }), result.scene);
});

test('破損mesh・不正index・巨大配列は静止sceneのままで例外を外へ出さない', () => {
  const original = horse();
  for (const change of [
    (s) => { s.motionMesh.vertices = Array(8193).fill([0, 0, 0]); },
    (s) => { s.motionMesh.faces[0].indices[0] = 999999; },
    (s) => { s.motionMesh.faces[0].uv.x = -5; },
    (s) => { s.motionMesh.normalization.scale = 0; },
    (s) => { s.motionMesh.vertices[0][0] = Infinity; },
  ]) {
    const scene = structuredClone(original); change(scene);
    assert.equal(sampleNativePreviewMotion(scene, { pointer: { active: true, x: 1 } }), scene);
    assert.equal(inspectNativePreviewMotion(scene).status, 'unavailable');
  }
});

test('入力のgetterを実行せずsnapshot作成後の改変を次のposeへ混入させない', () => {
  let calls = 0;
  const hostile = { kind: 'horse', get motionMesh() { calls += 1; throw new Error('getter'); } };
  assert.equal(sampleNativePreviewMotion(hostile, { pointer: { active: true } }), hostile);
  assert.equal(calls, 0);
  const scene = horse(); sampleNativePreviewMotion(scene, { pointer: { active: true, x: -1 } });
  scene.motionMesh.vertices[0][0] = NaN;
  const pose = sampleNativePreviewMotion(scene, { pointer: { active: true, x: 1 } });
  assert.notEqual(pose, scene);
  assert.ok(pose.faces.every((f) => f.points.every((p) => Number.isFinite(p.x))));
});
