/**
 * Enchanting UI state over the bounded book model. This is separate from live
 * entity cameras: the native UI binds global #open, not a player/entity id.
 * Scene construction happens only when that state changes, never per sample.
 */
import { buildEnchantingBookPreviewScene, wrapNativePreviewYaw } from './native-model-preview.js';

const scenesByBase = new WeakMap();
const MAX_BOOK_STATES = 8;

function ownData(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { present: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return { present: false };
    return Object.hasOwn(descriptor, 'value')
      ? { present: true, valid: true, value: descriptor.value }
      : { present: true, valid: false };
  } catch { return { present: true, valid: false }; }
}

/**
 * Read resolved #open before authored defaults. Booleans and finite 0..1
 * interpolation values are accepted. An explicit invalid value is diagnosed
 * instead of silently replacing it with a different open/closed state.
 * @param {unknown} props Effective renderer properties.
 * @returns {{status:'ready',openAmount:number,source:string}|{status:'invalid',issue:string}}
 */
export function readEnchantingBookPreviewState(props) {
  const explicit = ownData(props, '#open');
  const direct = explicit.present ? explicit : ownData(props, 'open');
  const bag = direct.present ? { present: false } : ownData(props, 'property_bag');
  if (bag.present && (!bag.valid || !bag.value || typeof bag.value !== 'object' || Array.isArray(bag.value))) {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_STATE_INVALID' };
  }
  const selected = direct.present ? direct : ownData(bag.value, '#open');
  if (!selected.present) return { status: 'ready', openAmount: 0, source: 'EMPTY_INPUT_DEFAULT' };
  const amount = typeof selected.value === 'boolean' ? Number(selected.value) : selected.value;
  if (!selected.valid || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1) {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_STATE_INVALID' };
  }
  return { status: 'ready', openAmount: amount, source: direct.present ? 'RESOLVED_OPEN_BINDING' : 'AUTHORED_OPEN_DEFAULT' };
}

// Each standalone compile fits its bounds. A book closing must keep the
// physical spine size and panel anchor, so use the base book's normalization
// for every state instead of enlarging a narrow closed book to fill the box.
// A cover-revealing closed camera keeps the projected model horizontally centered.
function preserveBookPanelProjection(baseScene, scene) {
  const target = ownData(ownData(baseScene, 'motionMesh').value, 'normalization').value;
  const source = scene.motionMesh?.normalization;
  if (!target || !source || ![target.scale, target.centerX, target.centerY].every(Number.isFinite)
    || target.scale <= 0) return null;
  const point = (p) => Object.freeze({
    x: .5 + ((p.x - .5) * source.scale) / target.scale,
    y: .5 + ((p.y - .5) * source.scale + source.centerY - target.centerY) / target.scale,
  });
  return Object.freeze({ ...scene,
    faces: Object.freeze(scene.faces.map(face => Object.freeze({ ...face,
      points: Object.freeze(face.points.map(point)), uvPoints: Object.freeze(face.uvPoints.map(point)),
    }))),
    motionMesh: Object.freeze({ ...scene.motionMesh,
      normalization: Object.freeze({ centerX: source.centerX, centerY: target.centerY, scale: target.scale }),
    }),
  });
}

/**
 * Select an open/closed book without changing its pack texture, model source,
 * or user-selected maximum opening. Retain at most eight states per base
 * scene; replacing the base (settings change) releases its cache naturally.
 * @param {object|null} baseScene Result of buildEnchantingBookPreviewScene.
 * @param {unknown} props Effective renderer properties.
 * @returns {object|null} Null means invalid state or unavailable base model.
 */
export function resolveEnchantingBookPreviewScene(baseScene, props) {
  try {
    if (ownData(baseScene, 'kind').value !== 'book') return null;
    const state = readEnchantingBookPreviewState(props);
    if (state.status !== 'ready') return null;
    const opening = ownData(baseScene, 'openingDegrees').value;
    if (typeof opening !== 'number' || !Number.isFinite(opening) || opening < 0 || opening > 180) return null;
    let cache = scenesByBase.get(baseScene);
    if (!cache) { cache = new Map(); scenesByBase.set(baseScene, cache); }
    const key = `${state.source}:${state.openAmount}`;
    if (cache.has(key)) {
      const hit = cache.get(key); cache.delete(key); cache.set(key, hit);
      return hit;
    }
    const compiled = buildEnchantingBookPreviewScene({
      openingDegrees: opening * state.openAmount,
      // The closed device book presents its cover, rather than an edge-on V.
      camera: { ...ownData(baseScene, 'camera').value,
        yaw: wrapNativePreviewYaw((ownData(baseScene, 'camera').value?.yaw || 0) + 40 * (1 - state.openAmount)) },
    });
    if (!compiled) return null;
    const scene = preserveBookPanelProjection(baseScene, compiled);
    if (!scene) return null;
    const selected = Object.freeze({ ...scene, bookOpenAmount: state.openAmount,
      bookStateSource: state.source, presentationProfile: 'bounded-enchanting-book-ui-v2', bookIdleMotion: false });
    cache.set(key, selected);
    while (cache.size > MAX_BOOK_STATES) cache.delete(cache.keys().next().value);
    return selected;
  } catch { return null; }
}
