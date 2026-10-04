import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBedrockGeometryScene as compile } from '../src/preview/native-model-preview.js';
import { compileBedrockGeometryScene as before } from './fixtures/native-model-baseline20.js';

const options = { geometryFormatVersion: '1.21.0', retainMotionMesh: true };
function model() {
  return { description: { texture_width: 64, texture_height: 64 }, bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'child', parent: 'root', cubes: [{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }] },
  ] };
}

test('cubeless parent mirror is validated before rendering descendants', () => {
  const geometry = model(); geometry.bones[0].mirror = 'false';
  assert.equal(before(geometry, options).ok, true, 'baseline must reproduce the accepted malformed input');
  assert.deepEqual(compile(geometry, options), { ok: false, error: 'NATIVE_PREVIEW_MODEL_INVALID',
    detail: { field: 'mirror', reason: 'expected-boolean', boneName: 'root', cubeIndex: null, faceName: null } });
});

test('hidden cubeless parent does not bypass mirror validation', () => {
  const geometry = model(); geometry.bones[0].mirror = 0; geometry.bones[0].neverRender = true;
  assert.equal(before(geometry, options).ok, true);
  const result = compile(geometry, { ...options, hiddenBonePatterns: ['root'] });
  assert.equal(result.ok, false); assert.equal(result.detail.boneName, 'root');
});

for (const [label, mutate, field, reason, boneName, cubeIndex] of [
  ['bone parent', g => g.bones[0].parent = 4, 'parent', 'expected-bone-name', 'root', null],
  ['bone pivot', g => g.bones[0].pivot = [0, 0], 'pivot', 'expected-finite-vector-3', 'root', null],
  ['bone rotation', g => g.bones[0].rotation = [0, Infinity, 0], 'rotation', 'expected-finite-vector-3', 'root', null],
  ['bone inflate', g => g.bones[0].inflate = '0', 'inflate', 'expected-finite-number', 'root', null],
  ['bone visibility', g => g.bones[0].neverRender = 'false', 'neverRender', 'expected-boolean', 'root', null],
  ['cube origin', g => g.bones[1].cubes[0].origin = [0, null, 0], 'origin', 'expected-finite-vector-3', 'child', 0],
  ['cube size', g => g.bones[1].cubes[0].size = [1, 2], 'size', 'expected-finite-vector-3', 'child', 0],
  ['negative cube size', g => g.bones[1].cubes[0].size = [-1, 2, 3], 'size', 'negative-extent', 'child', 0],
  ['cube pivot', g => g.bones[1].cubes[0].pivot = '0', 'pivot', 'expected-finite-vector-3', 'child', 0],
  ['cube rotation', g => g.bones[1].cubes[0].rotation = [0, NaN, 0], 'rotation', 'expected-finite-vector-3', 'child', 0],
  ['cube inflate', g => g.bones[1].cubes[0].inflate = Infinity, 'inflate', 'expected-finite-number', 'child', 0],
  ['collapsed inflated cube', g => g.bones[1].cubes[0].inflate = -3, 'inflate', 'negative-inflated-extent', 'child', 0],
]) test(`structural diagnostic: ${label}`, () => {
  const geometry = model(); mutate(geometry);
  const baseline = before(geometry, options), result = compile(geometry, options);
  assert.equal(baseline.error, 'NATIVE_PREVIEW_MODEL_INVALID');
  assert.equal(result.error, baseline.error);
  assert.deepEqual(result.detail, { field, reason, boneName, cubeIndex, faceName: null });
  assert.ok(JSON.stringify(result.detail).length < 512);
});

for (const [label, uv, field, reason] of [
  ['nonobject face', { west: 0 }, 'uv', 'expected-face-object'],
  ['missing face origin', { west: {} }, 'uv', 'expected-finite-vector-2'],
  ['invalid UV dimensions', { west: { uv: [0, 0], uv_size: [1] } }, 'uv_size', 'expected-finite-vector-2'],
  ['unsupported angle value', { west: { uv: [0, 0], uv_rotation: 45 } }, 'uv_rotation', 'expected-quarter-turn'],
  ['outside texture', { west: { uv: [63, 0], uv_size: [4, 4] } }, 'uv', 'outside-texture'],
  ['scalar UV', '0', 'uv', 'expected-array-or-face-map'],
  ['malformed array UV', [0], 'uv', 'expected-finite-vector-2'],
  ['box UV outside texture', [63, 63], 'uv', 'outside-texture'],
]) test(`UV diagnostic: ${label}`, () => {
  const geometry = model(); geometry.bones[1].cubes[0].uv = uv;
  assert.equal(before(geometry, options).error, 'NATIVE_PREVIEW_MODEL_INVALID');
  const result = compile(geometry, options);
  assert.deepEqual(result.detail, { field, reason, boneName: 'child', cubeIndex: 0, faceName: 'west' });
});

test('valid mirror overrides, inflate and transforms retain exact output', () => {
  for (const mirror of [undefined, false, true]) for (const cubeMirror of [undefined, false, true]) {
    const geometry = model();
    geometry.bones[1].mirror = mirror; geometry.bones[1].rotation = [10, 20, 30];
    Object.assign(geometry.bones[1].cubes[0], { mirror: cubeMirror, inflate: 0.25, rotation: [15, 25, 35] });
    const expected = before(geometry, options);
    assert.equal(expected.ok, true); assert.deepEqual(compile(geometry, options), expected);
  }
});

test('signed per-face UVs and all quarter turns retain exact output', () => {
  for (const uv_rotation of [0, 90, 180, 270]) {
    const geometry = model();
    geometry.bones[1].cubes[0].uv = { west: { uv: [8, 8], uv_size: [-4, -4], uv_rotation } };
    const expected = before(geometry, options);
    assert.equal(expected.ok, true); assert.deepEqual(compile(geometry, options), expected);
  }
});

test('hidden and edge-on faces still receive UV validation', () => {
  const geometry = model();
  geometry.bones.push({ name: 'visible', cubes: [{ origin: [6, 0, 0], size: [2, 2, 2], uv: [0, 0] }] });
  geometry.bones[1].cubes[0].uv = { north: { uv: [64, 64], uv_size: [4, 4] } };
  for (const camera of [{ yaw: 0, pitch: 0 }, { yaw: 90, pitch: 0 }]) {
    const result = compile(geometry, { ...options, camera, hiddenBonePatterns: ['child'] });
    assert.equal(result.error, 'NATIVE_PREVIEW_MODEL_INVALID');
    assert.equal(result.detail.faceName, 'north');
  }
});

test('unsupported material retains existing feature diagnostic', () => {
  const geometry = model(); geometry.bones[1].cubes[0].uv = { west: { uv: [0, 0], material_instance: 'custom' } };
  assert.deepEqual(compile(geometry, options), before(geometry, options));
});

test('legacy explicit cube pivot failure identifies the unsupported transform', () => {
  const geometry = model();
  Object.assign(geometry.bones[1].cubes[0], { pivot: [1, 2, 3], rotation: [15, 0, 0] });
  const legacyOptions = { ...options, geometryFormatVersion: '1.12.0' };
  assert.equal(before(geometry, legacyOptions).error, 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED');
  assert.deepEqual(compile(geometry, legacyOptions), { ok: false, error: 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED',
    detail: { feature: 'legacy_rotated_cube_pivot', boneName: 'child', cubeIndex: 0, faceName: null } });
});
