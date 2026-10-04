/**
 * Bounded preview motion over an already compiled, serializable mesh.
 * Book motion is a deterministic visual approximation, not native Bedrock
 * animation/Molang emulation. Horse motion changes the preview camera only.
 * This module has no file, network, DOM, timers or geometry-compiler calls.
 */
import { NATIVE_PREVIEW_MAX_DRAW_WORK_UNITS, NATIVE_PREVIEW_MAX_MOTION_MESH_BYTES,
  normalizeNativePreviewCamera, wrapNativePreviewYaw } from './native-model-preview.js';

const handles = new WeakMap();
const MAX_VERTICES = 8192;
const MAX_POSES = 8;
const PI2 = 2 * Math.PI;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function own(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d && Object.hasOwn(d, 'value') ? d.value : undefined;
}

function array(value, maximum, minimum = 0) {
  if (!Array.isArray(value)) return null;
  const length = own(value, 'length');
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) return null;
  const out = [];
  for (let i = 0; i < length; i += 1) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, 'value')) return null;
    out.push(d.value);
  }
  return out;
}

function vector(value, count) {
  const result = array(value, count, count);
  return result && result.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e8)
    ? Object.freeze(result) : null;
}

function project(camera) {
  const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return ([x, y, z]) => {
    const xx = x * cy + z * sy, zz = -x * sy + z * cy;
    return { x: xx, y: -(y * cp - zz * sp), depth: y * sp + zz * cp };
  };
}

function prepare(scene) {
  if (!scene || typeof scene !== 'object') return null;
  if (handles.has(scene)) return handles.get(scene);
  let handle = null;
  try {
    const kind = own(scene, 'kind'), source = own(scene, 'motionMesh');
    if (!['horse', 'player', 'book'].includes(kind) || own(source, 'version') !== 1) throw new Error('mesh');
    // The copied snapshot also prevents later mutation of a network result
    // from changing the meaning of already cached poses.
    const camera = normalizeNativePreviewCamera(own(scene, 'camera'));
    const rawVertices = array(own(source, 'vertices'), MAX_VERTICES, 3);
    const vertexBones = array(own(source, 'vertexBones'), MAX_VERTICES, 3);
    const rawFaces = array(own(source, 'faces'), NATIVE_PREVIEW_MAX_DRAW_WORK_UNITS, 1);
    if (!camera || !rawVertices || !vertexBones || !rawFaces || rawVertices.length !== vertexBones.length
      || vertexBones.some((v) => typeof v !== 'string' || v.length > 256)) throw new Error('vertices');
    const vertices = rawVertices.map((v) => vector(v, 3));
    if (vertices.some((v) => !v)) throw new Error('vector');
    const rawNorm = own(source, 'normalization');
    const norm = Object.fromEntries(['centerX', 'centerY', 'scale'].map((k) => [k, own(rawNorm, k)]));
    if (Object.values(norm).some((v) => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e8)
      || norm.scale <= 1e-9) throw new Error('normalization');
    const faces = rawFaces.map((face) => {
      const indices = array(own(face, 'indices'), 4, 4), uvIndices = array(own(face, 'uvIndices'), 4, 4);
      const shade = own(face, 'shade');
      const uvSource = own(face, 'uv');
      const uv = Object.fromEntries(['x', 'y', 'w', 'h'].map((k) => [k, own(uvSource, k)]));
      if (!indices || !uvIndices || [...indices, ...uvIndices].some((i) => !Number.isSafeInteger(i) || i < 0 || i >= vertices.length)
        || typeof shade !== 'number' || !Number.isFinite(shade) || shade < 0 || shade > 1
        || Object.values(uv).some((v) => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1)
        || Math.min(uv.x, uv.x + uv.w, uv.y, uv.y + uv.h) < 0
        || Math.max(uv.x, uv.x + uv.w, uv.y, uv.y + uv.h) > 1) throw new Error('face');
      const boneName = own(face, 'boneName'), faceName = own(face, 'faceName');
      if (typeof boneName !== 'string' || boneName.length > 256
        || typeof faceName !== 'string' || faceName.length > 16) throw new Error('face-name');
      return Object.freeze({ boneName, faceName, indices: Object.freeze(indices), uvIndices: Object.freeze(uvIndices), shade, uv: Object.freeze(uv) });
    });
    const mesh = { version: 1, vertices, vertexBones, faces, normalization: norm };
    const wireBytes = new TextEncoder().encode(JSON.stringify(mesh)).byteLength;
    if (wireBytes > NATIVE_PREVIEW_MAX_MOTION_MESH_BYTES) throw new Error('wire-budget');
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    for (const vertex of vertices) for (let i = 0; i < 3; i += 1) {
      low[i] = Math.min(low[i], vertex[i]); high[i] = Math.max(high[i], vertex[i]);
    }
    const center = low.map((v, i) => (v + high[i]) / 2);
    const baseProject = project(camera), projectedCenter = baseProject(center);
    let anchorY = -Infinity;
    for (const vertex of vertices) anchorY = Math.max(anchorY, .5 + (baseProject(vertex).y - norm.centerY) / norm.scale);
    const metadata = {};
    for (const key of ['kind', 'textureSize', 'camera', 'presentationProfile', 'approximation', 'openingDegrees', 'geometrySource', 'bookOpenAmount', 'bookStateSource']) {
      const v = own(scene, key);
      if (v !== undefined) metadata[key] = v;
    }
    handle = { kind, camera, mesh, center, projectedCenter, anchorY, metadata,
      poses: new Map(), latest: scene, stats: { vertexCount: vertices.length, faceCount: faces.length, meshBytes: wireBytes, projections: 0, cacheHits: 0 } };
  } catch { /* An invalid motion mesh retains the already rendered static scene. */ }
  handles.set(scene, handle);
  return handle;
}

function seedPhase(seed) {
  const value = typeof seed === 'string' ? seed.slice(0, 128) : String(finite(seed));
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  return hash / 0x100000000 * PI2;
}

/** Normalize one shared world-space pointer independently for each control. */
export function nativePreviewPointerForBox(pointerWorld, box, fallback = { active: false }) {
  try {
    if (!pointerWorld || typeof pointerWorld !== 'object') return fallback;
    if (own(pointerWorld, 'active') !== true) return { active: false, x: 0, y: 0 };
    const px = own(pointerWorld, 'x'), py = own(pointerWorld, 'y');
    const x = own(box, 'x'), y = own(box, 'y'), w = own(box, 'w'), h = own(box, 'h');
    if (![px, py, x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v)) || w <= 0 || h <= 0) return { active: false, x: 0, y: 0 };
    return { active: true, x: clamp((px - x - w / 2) / (w / 2), -1, 1), y: clamp((py - y - h / 2) / (h / 2), -1, 1) };
  } catch { return { active: false, x: 0, y: 0 }; }
}

/**
 * pointer is normalized relative to the native control: x/y in [-1,1],
 * positive right/down. Out-of-range finite inputs are clamped. pointerleave
 * uses {active:false} and returns the original horse scene by identity.
 * enabled=false or visible=false restores static output. paused=true retains
 * the most recently sampled pose; this module never schedules further work.
 * Call with a fixed timeMs/seed for reproducible export. With the same source,
 * time is quantized to 40ms (25fps) and the last eight poses are retained.
 */
export function sampleNativePreviewMotion(scene, options = {}) {
  try {
    const enabled = own(options, 'enabled') !== false, visible = own(options, 'visible') !== false;
    if (!enabled || !visible) return scene;
    const handle = prepare(scene);
    if (!handle) return scene;
    // UI book posture follows slot/#open state, never the free-running clock.
    // Reuse the original raster for both open and closed states.
    if (handle.kind === 'book') {
      handle.latest = scene; return scene;
    }
    const pointer = own(options, 'pointer');
    const activePointer = own(pointer, 'active') === true;
    if (handle.kind !== 'book' && !activePointer) { handle.latest = scene; return scene; }
    if (own(options, 'paused') === true) return handle.latest;
    const px = clamp(finite(own(pointer, 'x')), -1, 1), py = clamp(finite(own(pointer, 'y')), -1, 1);
    const time = Math.floor(clamp(finite(own(options, 'timeMs')), 0, Number.MAX_SAFE_INTEGER) / 40) * 40;
    const seconds = (time % 60000) / 1000;
    const phase = seedPhase(own(options, 'seed'));
    const key = handle.kind === 'book' ? `${seconds}:${phase}` : `${px.toFixed(3)}:${py.toFixed(3)}`;
    if (handle.poses.has(key)) { handle.stats.cacheHits += 1; handle.latest = handle.poses.get(key); return handle.latest; }
    const { mesh, camera, center, projectedCenter } = handle;
    const targetCamera = handle.kind !== 'book' ? {
      yaw: wrapNativePreviewYaw(camera.yaw + Math.round(px * 1000) / 1000 * 32),
      pitch: clamp(camera.pitch - Math.round(py * 1000) / 1000 * 18, -89, 89),
    } : camera;
    const projectPoint = project(targetCamera);
    const opening = finite(handle.metadata.openingDegrees, 130);
    const bookActivity = clamp(finite(handle.metadata.bookOpenAmount, 1), 0, 1);
    const openingDelta = clamp(opening + Math.sin(PI2 * seconds / 6 + phase) * 8 * bookActivity, 20, 180) - opening;
    // The UI model stays at its panel anchor. Its binding controls the leaves;
    // it does not inherit the world table's floating display or entity cursor.
    const bob = handle.kind === 'book' && handle.metadata.bookOpenAmount === undefined
      ? Math.sin(PI2 * seconds / 4 + phase) * .025 : 0;
    const projected = mesh.vertices.map((vertex, index) => {
      let [x, y, z] = vertex;
      if (handle.kind === 'book') {
        const bone = mesh.vertexBones[index];
        const sign = bone.startsWith('left_') ? 1 : bone.startsWith('right_') ? -1 : 0;
        const leafTurn = bone.endsWith('_leaf')
          ? (Math.sin(PI2 * seconds / 3 + phase + (sign < 0 ? Math.PI : 0)) + 1) * 18 * bookActivity : 0;
        const delta = sign * (openingDelta / 2 + leafTurn) * Math.PI / 180;
        if (delta) [x, z] = [x * Math.cos(delta) + z * Math.sin(delta), -x * Math.sin(delta) + z * Math.cos(delta)];
      }
      const p = handle.kind !== 'book'
        ? projectPoint([x - center[0], y - center[1], z - center[2]]) : projectPoint([x, y, z]);
      const offsetX = handle.kind !== 'book' ? projectedCenter.x : 0;
      const offsetY = handle.kind !== 'book' ? projectedCenter.y : 0;
      return { x: .5 + (p.x + offsetX - mesh.normalization.centerX) / mesh.normalization.scale,
        y: .5 + (p.y + offsetY - mesh.normalization.centerY) / mesh.normalization.scale + bob, depth: p.depth };
    });
    if (projected.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 4 || Math.abs(p.y) > 4)) return scene;
    const faces = [];
    for (const face of mesh.faces) {
      const pts = face.indices.map((index) => projected[index]);
      let area = 0;
      for (let i = 0; i < 4; i += 1) area += pts[i].x * pts[(i + 1) % 4].y - pts[(i + 1) % 4].x * pts[i].y;
      if (Math.abs(area) < 1e-10) continue;
      const point = ({ x, y }) => Object.freeze({ x, y });
      faces.push(Object.freeze({ boneName: face.boneName, faceName: face.faceName,
        points: Object.freeze(pts.map(point)), uvPoints: Object.freeze(face.uvIndices.map((i) => point(projected[i]))),
        depth: pts.reduce((sum, p) => sum + p.depth, 0) / 4, shade: face.shade, uv: face.uv, texture: true }));
    }
    if (!faces.length) return scene;
    faces.sort((a, b) => a.depth - b.depth);
    const result = Object.freeze({ ...handle.metadata, faces: Object.freeze(faces), camera: Object.freeze(targetCamera),
      motionApplied: true, motionAnchorY: handle.anchorY,
      motion: Object.freeze({ kind: handle.kind === 'book' ? 'deterministic-book-approximation' : 'bounded-cursor-camera',
        timeMs: handle.kind === 'book' ? time : null, openingDegrees: handle.kind === 'book' ? opening + openingDelta : null,
        nativeAnimationParity: 'UNVERIFIED' }) });
    handle.stats.projections += 1;
    handle.poses.set(key, result);
    while (handle.poses.size > MAX_POSES) handle.poses.delete(handle.poses.keys().next().value);
    handle.latest = result;
    return result;
  } catch { return scene; }
}

/** Small, copy-only observability for bounded-work verification. */
export function inspectNativePreviewMotion(scene) {
  const handle = prepare(scene);
  return handle ? { status: 'ready', ...handle.stats, retainedPoses: handle.poses.size, maximumPoses: MAX_POSES,
    maximumMeshBytes: NATIVE_PREVIEW_MAX_MOTION_MESH_BYTES, sourceReadsPerSample: 0, geometryCompilesPerSample: 0 }
    : { status: 'unavailable', issue: 'NATIVE_PREVIEW_MOTION_MESH_UNAVAILABLE' };
}
