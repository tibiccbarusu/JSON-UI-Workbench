/** Stateless preview-input projection shared by SDK, HTTP and CLI.
 * Effects describe the supported preview adapter; no Script API, clipboard,
 * native form response, navigation session or audible playback is executed.
 */
import { createHash } from 'node:crypto';
import { preparePreview } from './preview-pipeline.mjs';
import { pipelineOptions } from './api-context.mjs';
import { JsonUiApiError } from './api-request.mjs';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { getUiInteractionSourceNode, getUiInteractionEffectiveProps } from '../editor-core/src/preview/ui-interaction-target.js';
import { resolveUiInteraction, findInteractionCollectionAddress } from '../editor-core/src/preview/ui-interaction-engine.js';
import { applyLocalTogglePatch } from '../editor-core/src/preview/local-toggle-state.js';
import { buildUiAudioIntent } from '../editor-core/src/preview/ui-audio-intent.js';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reject = (code, message, context = {}) => { throw new JsonUiApiError(code, message, { context }); };

export async function prepareInteraction(context, request) {
  // Input is a semantic operation. A partial/uncertain scene must never produce
  // an accepted state transition, even when a non-strict render was requested.
  let prepared;
  try { prepared = await preparePreview(context, { ...pipelineOptions(request), 'strict-semantics': true }, { format: 'json' }); }
  catch (error) {
    // Shared frame validation also rejects snapshot values outside local
    // writable controls. Preserve the public input error only when captured
    // evidence proves that this is the entire critical binding failure.
    // Missing/unrelated runtime bindings keep their original strict-gate code.
    const bindings = error.context?.quality?.bindings;
    const critical = (bindings?.diagnostics || []).filter(item => item.affects_preview);
    if (error.code === 'CLI_BINDING_GATE_FAILED' && bindings?.observation_capture_complete
        && critical.length > 0 && critical.length === bindings.critical_count
        && critical.every(item => item.bindingType === 'local_toggle' && item.targetProperty === 'toggle_state'
          && item.reason === 'LOCAL_STATE_UNRESOLVED' && ['STATE_NODE_UNKNOWN', 'STATE_NODE_READONLY'].includes(item.localReason))) {
      reject('LOCAL_TOGGLE_NODE_UNKNOWN', '現在のUIに属さない、または外部bindingが管理するローカル状態を拒否しました。', error.context);
    }
    throw error;
  }
  const snapshot = prepared.snapshot, frame = snapshot.frame;
  let localState = frame.bindings?.localToggleState;
  if (!localState || localState.instanceId !== request.uiInstanceId) reject('LOCAL_TOGGLE_INSTANCE_MISMATCH', '現在のUIインスタンスの状態を確認できません。');
  if (localState.revision !== request.expectedRevision) reject('LOCAL_TOGGLE_REVISION_STALE', 'expectedRevisionが現在のローカル状態と一致しません。', { expected_revision: request.expectedRevision, current_revision: localState.revision });
  if (Object.keys(request.localToggleState?.values || {}).some(id => !Object.hasOwn(localState.values, id))) reject('LOCAL_TOGGLE_NODE_UNKNOWN', '現在のUIに属さないローカル状態を拒否しました。');
  const model = buildUiScreenModelFromJson(snapshot.document, { filePath: prepared.record.filePath });
  if (model.stats?.truncated) reject('CLI_EVALUATION_INCOMPLETE', '操作対象のモデル走査が完了していません。');
  const propsById = Object.fromEntries([...new Set([...Object.keys(frame.basePropsById || {}), ...Object.keys(frame.propsById || {})])]
    .map(id => [id, { ...frame.basePropsById?.[id], ...frame.propsById?.[id] }]));
  const settings = context.session.settings;
  const inputContext = { enabled: true, pocket: false, model, propsById, boxes: frame.layout.boxes,
    file: { path: prepared.record.filePath },
    screenDefinition: prepared.record.qualifiedName, screenRef: { fileId: `screen:${prepared.record.filePath}`, definition: prepared.record.qualifiedName },
    mockData: settings.mock_data, collectionData: { ...(settings.mock_data.__collections || {}), ...settings.collections },
    bindingDiagnostics: frame.bindings?.diagnostics || [],
    bindingObservationComplete: frame.bindings?.observationCaptureComplete,
    uiInstanceId: request.uiInstanceId, localToggleState: localState };
  const node = getUiInteractionSourceNode(inputContext, request.nodeId);
  if (!node) reject('UI_INTERACTION_NODE_UNKNOWN', '指定されたnodeIdは現在のUIにありません。');
  const box = frame.layout.boxes.find(item => item.id === request.nodeId);
  const effectiveProps = getUiInteractionEffectiveProps(inputContext, request.nodeId);
  const target = { node, effectiveProps, box };
  const collectionAddress = findInteractionCollectionAddress({ ...inputContext, nodeId: node.id });
  const interaction = box
    ? resolveUiInteraction({ ...inputContext, ...target, collectionAddress, event: request.event, inputSource: request.inputSource })
    : { status: 'blocked', effects: [], diagnostics: [{ code: 'INTERACTION_CONTROL_NOT_RENDERED', severity: 'info', message: '操作対象が現在の描画範囲にないため、操作しません。' }] };
  for (const effect of interaction.effects || []) if (effect.type === 'localTogglePatch') {
    const applied = applyLocalTogglePatch(localState, effect);
    if (!applied.ok) reject(applied.error.code, applied.error.message);
    localState = applied.state;
  }
  const audioIntent = box && request.event === 'activate' && request.inputSource === 'mouse'
    ? buildUiAudioIntent({ context: inputContext, target, interactionId: `${request.uiInstanceId}:${request.expectedRevision}:${request.nodeId}` }) : null;
  return { schema: 'jsonui-api-interaction-v1', ok: true, execution: 'stateless_preview_projection',
    selected: snapshot.selected, requested_node_id: request.nodeId, node_id: node.id,
    ui_instance_id: request.uiInstanceId, previous_revision: request.expectedRevision,
    projection_sha256: sha(snapshot.document), form_descriptor_sha256: request.state?.form === undefined ? null : sha(request.state.form),
    interaction, localToggleState: localState, audioIntent,
    quality: snapshot.quality, stage_diagnostics: snapshot.stage_diagnostics,
    effects_executed: [...new Set((interaction.effects || []).filter(effect => effect.type === 'localTogglePatch').map(effect => effect.type))],
    playback: 'not_executed',
    native_equivalence: 'not_evaluated' };
}

/** Resolves only registered sound IDs; it exposes no arbitrary file-read route. */
export async function prepareSound(context, request) {
  const catalog = await context.getCatalog();
  const sound = await context.client.request('/api/node/sound-resolve', { payload: { catalogId: catalog.nodeCatalogId, ...request }, maximum: 16384, timeout: 15000 });
  if (sound?.ok === false) reject(sound.error?.code || sound.error || 'AUDIO_RESOLVE_FAILED', 'サウンド定義または音源を解決できません。');
  return { schema: 'jsonui-api-sound-v1', ok: true, sound,
    playback: 'not_executed', native_equivalence: 'not_evaluated' };
}
