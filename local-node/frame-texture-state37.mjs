/** Bounded texture observations for one supplied projection/frame snapshot.
 * This is not a full selected-dependency trace or a Minecraft parity oracle. */
import { classifyTextureValue, describeNodeTextureValue } from '../editor-core/src/model/texture-value.js';
import { isVisibleFromProps } from '../editor-core/src/preview/canvas-preview.js';
import { readSliderEnabledState37, selectSliderStateChildren37, resolveSliderControls37 } from '../editor-core/src/preview/slider-runtime37.js';

const escapePointer = value => String(value).replace(/~/gu, '~0').replace(/\//gu, '~1');
const boundedValue = row => ({ ...row, ...(typeof row.value === 'string'
  ? { value: row.value.slice(0, 1024), ...(row.value.length > 1024 ? { valueTruncated: true } : {}) } : {}) });

/** Inspect all image nodes, including ones omitted by safe visibility mode.
 * Exact input values are retained by model serialization. Evidence contains
 * bounded observations and source identity, never inferred native legality. */
export function inspectFrameTextureValues({ model, frame, projection, propsFor, resolveToken, visibilityMode = null, maxEvidence = 512 }) {
  const plans = new Map(), diagnostics = [], evidence = [], counts = Object.create(null), sliderOwners = new Map();
  const boxes = new Map(frame.layout.boxes.map(box => [box.id, box]));
  let omittedEvidence = 0;
  const add = (code, message, nodeId, details = {}) => {
    if (diagnostics.length < 512) diagnostics.push({ code, message, nodeId, details });
  };
  function visit(node, pointer, ancestorVisibility = 'visible', inactiveControlState = false) {
    const props = propsFor(node.id);
    const safe = isVisibleFromProps(props, { mode: 'safe' });
    const structure = isVisibleFromProps(props, { mode: 'structure' });
    const localVisibility = safe ? 'visible' : structure ? 'unknown' : 'hidden';
    const visibility = ancestorVisibility === 'hidden' || localVisibility === 'hidden' ? 'hidden'
      : ancestorVisibility === 'unknown' || localVisibility === 'unknown' ? 'unknown' : 'visible';
    if (node.type === 'image') {
      const state = describeNodeTextureValue(node, frame.propsById?.[node.id]);
      // The compact frame contains only differences. Resolve remaining tokens
      // using the same bounded token lookup as the actual raster path.
      const value = resolveToken(props.texture, props);
      if (state.evaluated.present || value !== '' && value !== undefined) state.evaluated = classifyTextureValue(value);
      const box = boxes.get(node.id);
      // Zero geometry can become positive after intrinsic-size reflow; only
      // the evaluated alpha is a stable no-pixels reason in this raster pass.
      const noPixels = box && box.renderAlpha === 0;
      let acquisition = visibility === 'hidden' || noPixels ? 'not-required' : 'required';
      if (state.authored.state === 'invalid-type' || state.evaluated.state === 'invalid-type') {
        add('RASTER_TEXTURE_TYPE_INVALID', 'テクスチャは文字列型が必要です。原値を暗黙変換せず保持しています。', node.id,
          { authoredType: state.authored.valueType, evaluatedType: state.evaluated.valueType });
        acquisition = 'invalid';
      } else if (state.authored.state === 'whitespace' || state.evaluated.state === 'whitespace') {
        add('RASTER_TEXTURE_WHITESPACE_INVALID', '空白だけのテクスチャは空値・画像パスと区別して扱います。', node.id);
        acquisition = 'invalid';
      } else if (visibility === 'unknown') {
        add('RASTER_TEXTURE_STATE_UNVERIFIED', '画像の表示条件が未確定です。安全表示で省かれたことを描画不要の証拠にはしません。', node.id);
        acquisition = 'unverified';
      } else if (acquisition === 'required' && ['empty', 'absent'].includes(state.evaluated.state)) {
        add(state.evaluated.state === 'empty' ? 'RASTER_TEXTURE_EMPTY_UNVERIFIED' : 'RASTER_TEXTURE_ABSENT_UNVERIFIED',
          '表示対象の画像に確定したテクスチャがありません。透明画像として完全合格にはしません。', node.id);
        acquisition = 'unverified';
      } else if (acquisition === 'required' && state.evaluated.state === 'unresolved') {
        add('RASTER_TEXTURE_UNRESOLVED', 'テクスチャの実行時参照が未解決です。', node.id);
        acquisition = 'unverified';
      }
      const observation = { kind: 'texture-value', nodeId: node.id, modelPointer: pointer,
        authored: boundedValue(state.authored), evaluated: boundedValue(state.evaluated), evaluation: state.evaluation,
        visibility, acquisition, ...(inactiveControlState ? { stateSelection: 'confirmed-inactive-slider-state' } : {}),
        source: projection.nodeSources?.[pointer] || null };
      plans.set(node.id, { acquisition, value });
      const countKey = `${state.evaluated.state}:${acquisition}`;
      counts[countKey] = (counts[countKey] || 0) + 1;
      if (evidence.length < maxEvidence) evidence.push(observation); else omittedEvidence++;
    }
    let selectedStates = null;
    if (visibilityMode === 'safe' && ['slider', 'slider_box'].includes(node.type)) {
      const children = (node.children || []).map(child => ({ id: child.id, name: child.key.raw }));
      let enabled = readSliderEnabledState37(props);
      if (node.type === 'slider') {
        const controls = resolveSliderControls37({ props, children });
        if (controls.boxId) sliderOwners.set(controls.boxId, enabled);
      } else if (sliderOwners.has(node.id)) {
        const parentEnabled = sliderOwners.get(node.id);
        enabled = enabled === false || parentEnabled === false ? false
          : enabled === true && parentEnabled === true ? true : null;
      }
      if (enabled !== null) {
        const selection = selectSliderStateChildren37({ type: node.type, props, enabled, children });
        if (!selection.diagnostics.length) selectedStates = new Set(selection.ids);
      }
    }
    for (const child of node.children || []) {
      const childPointer = node.type === 'file' ? `/${escapePointer(child.key.raw)}`
        : node.unknownProps?.__controls_object_shape ? `${pointer}/controls/${escapePointer(child.key.raw)}`
          : `${pointer}/controls/${child.origin?.index ?? 0}${child.origin?.kind === 'inline' ? '' : `/${escapePointer(child.key.raw)}`}`;
      const excluded = selectedStates && !selectedStates.has(child.id);
      visit(child, childPointer, excluded ? 'hidden' : visibility, inactiveControlState || Boolean(excluded));
    }
  }
  visit(model.root, '');
  return { plans, diagnostics, evidence, summary: { kind: 'texture-value-summary',
    policy: 'authored-type-and-frame-requirement-v1', images: plans.size, counts,
    evidenceEntries: evidence.length, omittedEvidence, minecraftPixelParityVerified: false } };
}
