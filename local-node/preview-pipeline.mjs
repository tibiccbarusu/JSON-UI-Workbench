/** Shared CLI/SDK preview pipeline. Owns network/render work, never session or output writes.
 * Context adapters provide project(), previewViewport(), client, workspace and in-memory settings.
 */
import { cliError } from './cli-files.mjs';
import { buildStructureSvg } from './cli-preview.mjs';
import { renderFramePng } from './frame-raster13.mjs';
import { buildPreviewQuality, selectedSemanticQuality } from './cli-quality38.mjs';
import { finiteNumber } from './preview-settings.mjs';
import { selectNativePreviewTargetEngineVersion } from '../editor-core/src/preview/native-pack-stack.js';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function assertResult(result, fallback = 'CLI_OPERATION_FAILED') {
  if (!object(result) || result.ok === false) {
    const code = typeof result?.error === 'string' ? result.error : result?.error?.code || fallback;
    throw cliError(/^[A-Z0-9_]{1,100}$/u.test(code) ? code : fallback, '要求された操作を完了できません。', { result });
  }
  return result;
}
// Additive, observational envelope. This is not a semantic acceptance gate.
export function projectionStageDiagnostics(projection, strictSemantics = false) {
  return { projection: {
    schema: 'jsonui-projection-diagnostics-v1',
    scope: 'selected_projection',
    availability: Array.isArray(projection.diagnostics) ? 'reported' : 'unavailable',
    selected: projection.selected || null,
    semantics_profile: projection.semanticsProfile || null,
    provenance: Array.isArray(projection.provenance) ? projection.provenance : [],
    // Inheritance observations are bounded and do not prove frame necessity.
    dependency_trace: projection.dependencyTrace || null,
    semantic_gate: strictSemantics
      ? { ...selectedSemanticQuality(projection), enforcement: 'explicit_strict_selected_resolution' }
      : { status: 'not_evaluated', enforcement: 'none', reason_code: 'STRICT_SEMANTICS_NOT_REQUESTED' },
    diagnostics: Array.isArray(projection.diagnostics) ? projection.diagnostics : [],
  } };
}


export async function preparePreview(context, options, { validationOnly = false, format = 'json', rasterBackend } = {}) {
  const command = validationOnly ? 'validate' : 'preview';
  const { record, projection, settings } = await context.project(options);
  const stageDiagnostics = projectionStageDiagnostics(projection, Boolean(options['strict-semantics']));
  try {
    let quality = buildPreviewQuality({ projection, settings, stateEvidence: context.session.preview_state });
    if (options['strict-semantics'] && quality.semantic.status !== 'passed') {
      throw cliError('CLI_SEMANTIC_GATE_FAILED', '選択した投影の意味論を確定できません。strict-semantics により出力を停止しました。', { quality });
    }
    const identity = { projectionId: projection.nodeProjectionId, recordId: record.id, filePath: record.filePath };
    const validation = { ...assertResult(await context.client.request('/api/node/validate', { payload: { ...identity, locale: settings.locale, mockData: settings.mock_data } })), stage_diagnostics: stageDiagnostics, quality };
    if (validation.validation?.ok === false) throw cliError('CLI_VALIDATION_FAILED', '選択した UI に検査エラーがあります。プレビューは生成しません。', { validation: validation.validation });
    quality = buildPreviewQuality({ projection, validation: validation.validation, settings, stateEvidence: context.session.preview_state });
    stageDiagnostics.native_properties = { ...quality.native_properties, enforcement: options['strict-semantics']
      ? 'explicit_strict_recorded_native_properties' : 'observation_only' };
    validation.quality = quality;
    if ((validationOnly || options['frame-summary']) && options['strict-semantics'] && quality.native_properties.status !== 'passed') {
      throw cliError('CLI_NATIVE_PROPERTY_GATE_FAILED', '確認済みの非対応プロパティ、または不完全な互換性診断があります。strict-semantics により出力を停止しました。', { quality });
    }
    if (command === 'validate') {
      return { validation, record, stageDiagnostics };
    }
    const fps = finiteNumber(options.fps, settings.fps, { minimum: 1, maximum: 240 });
    const frameIndex = finiteNumber(options.frame, format === 'png' ? Math.round(fps) : 0, { maximum: fps * 3600, integer: true });
    const width = finiteNumber(options.width, settings.width, { minimum: 1, integer: true });
    const height = finiteNumber(options.height, settings.height, { minimum: 1, integer: true });
    const viewport = await context.previewViewport(settings, options, width, height);
    const frameRequest = { ...identity,
      preset: viewport.preset, generation: 0, animationTime: frameIndex / fps, animationEvent: settings.animation_event,
      qualifiedName: record.qualifiedName, mockData: settings.mock_data, collectionData: settings.collections,
      scrollById: settings.scroll, visibilityMode: settings.visibility,
      uiInstanceId: settings.ui_instance_id, localToggleState: settings.local_toggle_state,
      ...(options['frame-summary'] ? { frameTransport: 'summary-v1' } : {}) };
    const frame = assertResult(await context.client.request('/api/node/frame', { payload: frameRequest }));
    quality = buildPreviewQuality({ projection, validation: validation.validation, frame, frameRequest, settings, stateEvidence: context.session.preview_state });
    stageDiagnostics.native_properties = { ...quality.native_properties, enforcement: options['strict-semantics']
      ? 'explicit_strict_recorded_native_properties' : 'observation_only' };
    if (options['frame-summary']) {
      const summary = { schema: 'jsonui-cli-frame-summary-v1', selected: projection.selected, frame, quality,
        renderable: false, native_equivalence: 'not_evaluated' };
      return { snapshot: summary, metadata: summary, record, stageDiagnostics, summary: true };
    }
    stageDiagnostics.evaluation = quality.evaluation;
    if (options['strict-semantics'] && quality.evaluation.status !== 'passed') throw cliError('CLI_EVALUATION_INCOMPLETE', '展開・走査・描画が上限により不完全です。部分検査を全体の合格として出力しません。', { quality });
    stageDiagnostics.collection = { ...quality.collection, enforcement: options['strict-semantics']
      ? 'explicit_strict_frame_collection' : 'observation_only' };
    if (options['strict-semantics'] && quality.collection.status !== 'passed') {
      throw cliError('CLI_COLLECTION_GATE_FAILED', 'コレクションの参照先を確定できません。親要素の型・collection_name・行番号を確認してください。', { quality });
    }
    if (options['strict-semantics'] && quality.native_properties.status !== 'passed') {
      throw cliError('CLI_NATIVE_PROPERTY_GATE_FAILED', '確認済みの非対応プロパティ、または不完全な互換性診断があります。strict-semantics により出力を停止しました。', { quality });
    }
    stageDiagnostics.bindings = { ...quality.bindings, enforcement: options['strict-semantics']
      ? 'explicit_strict_frame_bindings' : 'observation_only' };
    if (options['strict-semantics'] && quality.bindings.status !== 'passed') {
      throw cliError('CLI_BINDING_GATE_FAILED', '表示・入力状態を確定できません。未解決の binding とローカル状態を確認してください。', { quality });
    }
    stageDiagnostics.animation = { ...quality.animation, enforcement: options['strict-animation'] ? 'explicit_strict_frame_animation' : 'observation_only' };
    if (options['strict-animation'] && quality.animation.status !== 'passed') {
      throw cliError('CLI_ANIMATION_GATE_FAILED', 'アニメーションの対応範囲を確定できません。strict-animation により出力を停止しました。', { quality });
    }
    const snapshot = { schema: 'jsonui-cli-preview-v1', viewport: { width, height, ui_scale: viewport.uiScale, logical_width: viewport.preset.width, logical_height: viewport.preset.height, scale_source: viewport.scaleSource }, frame_index: frameIndex, fps, time_seconds: frameIndex / fps,
      rendering: { backend: 'node-worker-frame-ir', product_raster: false, textures_rendered: false, localized_glyphs_rendered: false, native_3d_rendered: false },
      selected: projection.selected, document: projection.document, validation: validation.validation, frame, stage_diagnostics: stageDiagnostics,
      frame_stage: 'before_resource_measurement', quality };
    let raster = null;
    if (format === 'png') {
      raster = await renderFramePng({ client: context.client, sources: context.workspace.sources, projection, frame,
        width, height, uiScale: viewport.uiScale, locale: settings.locale, fontProfile: settings.font_profile, backend: rasterBackend, allowPartial: Boolean(options['allow-partial']),
        includeDrawEvidence: Boolean(options['draw-evidence']),
        timeSeconds: frameIndex / fps, frameRequest, targetEngineVersion: selectNativePreviewTargetEngineVersion({
          hasImportedPack: Boolean(context.importedPackMetadata), importedMinEngineVersion: context.importedPackMetadata?.manifestSummary?.header?.minEngineVersion,
          expectedBedrockVersion: settings.target_engine_version, fallback: [1, 26, 40],
        }) });
      quality = buildPreviewQuality({ projection, validation: validation.validation, frame, frameRequest, settings, stateEvidence: context.session.preview_state, raster });
      stageDiagnostics.collection = { ...quality.collection, enforcement: options['strict-semantics']
        ? 'explicit_strict_frame_collection' : 'observation_only' };
      if (options['strict-semantics'] && quality.collection.status !== 'passed') {
        throw cliError('CLI_COLLECTION_GATE_FAILED', 'コレクションの参照先を確定できません。親要素の型・collection_name・行番号を確認してください。', { quality });
      }
      stageDiagnostics.native_properties = { ...quality.native_properties, enforcement: options['strict-semantics']
        ? 'explicit_strict_recorded_native_properties' : options['allow-partial']
          ? 'observation_only' : 'default_strict_png_recorded_native_properties' };
      if (options['strict-semantics'] && quality.native_properties.status !== 'passed') {
        throw cliError('CLI_NATIVE_PROPERTY_GATE_FAILED', '確認済みの非対応プロパティ、または不完全な互換性診断があります。strict-semantics により出力を停止しました。', { quality });
      }
      stageDiagnostics.bindings = { ...quality.bindings, enforcement: options['strict-semantics']
        ? 'explicit_strict_final_frame_bindings' : 'observation_only' };
      if (options['strict-semantics'] && quality.bindings.status !== 'passed') {
        throw cliError('CLI_BINDING_GATE_FAILED', '再配置後の表示・入力状態を確定できません。未解決の binding とローカル状態を確認してください。', { quality });
      }
      stageDiagnostics.animation = { ...quality.animation, enforcement: options['strict-animation'] ? 'explicit_strict_final_frame_animation' : 'observation_only' };
      if (options['strict-animation'] && quality.animation.status !== 'passed') {
        throw cliError('CLI_ANIMATION_GATE_FAILED', '再配置後のアニメーションの対応範囲を確定できません。strict-animation により出力を停止しました。', { quality });
      }
      if (!raster.ok) throw cliError(raster.code || 'CLI_RASTER_FAILED', '必要な描画情報を確定できないため PNG 出力を停止しました。', { diagnostics: raster.diagnostics || [], quality, final_frame_summary: raster.final_frame_summary || null });
      // A hidden ancestor can omit descendants from layout while Minecraft
      // still parses their declarations. Resource completeness alone must not
      // erase the selected projection's recorded native-property failures.
      if (!options['allow-partial'] && quality.native_properties.status !== 'passed') {
        throw cliError('CLI_NATIVE_PROPERTY_GATE_FAILED', '確認済みの非対応プロパティ、または不完全な互換性診断があります。既定の厳格PNG出力を停止しました。', { quality });
      }
      raster = { ...raster,
        preview_complete: Boolean(raster.preview_complete && quality.native_properties.status === 'passed'),
        draft: Boolean(raster.draft || quality.native_properties.status !== 'passed') };
      snapshot.rendering = { ...raster.rendering, ui_scale_source: viewport.scaleSource };
      snapshot.quality = quality;
      Object.assign(snapshot, { complete: raster.complete, preview_complete: raster.preview_complete,
        animation_quality: raster.animation_quality, binding_quality: raster.binding_quality, collection_quality: raster.collection_quality, draft: raster.draft,
        native_equivalence: raster.native_equivalence, diagnostics: raster.diagnostics, final_frame_summary: raster.final_frame_summary,
        frame_stage: 'after_resource_measurement' });
    }
    const bytes = format === 'png' ? raster.png : format === 'svg' ? buildStructureSvg(frame, { width, height, qualifiedName: record.qualifiedName, frameIndex, fps, logicalWidth: viewport.preset.width, logicalHeight: viewport.preset.height, language: context.language }) : null;
    const metadata = { selected: projection.selected, frame_index: frameIndex, fps, box_count: raster?.final_frame_summary?.box_count ?? frame.layout?.boxes?.length ?? 0,
      rendering: snapshot.rendering, validation: validation.validation, animation: raster?.final_animation ?? frame.animation, stage_diagnostics: stageDiagnostics,
      quality: snapshot.quality, frame_stage: raster ? 'after_resource_measurement' : 'before_resource_measurement',
      ...(raster ? { complete: raster.complete, preview_complete: raster.preview_complete, diagnostics: raster.diagnostics,
        animation_quality: raster.animation_quality, collection_quality: raster.collection_quality, binding_quality: raster.binding_quality, draft: raster.draft,
        native_equivalence: raster.native_equivalence, provenance: raster.provenance, final_frame_summary: raster.final_frame_summary,
        ...(raster.draw_evidence ? { draw_evidence: raster.draw_evidence } : {}) } : {}) };
    return { snapshot, metadata, bytes, record, stageDiagnostics };
  } catch (error) {
    // Keep the existing error code/context, and retain diagnostics if a later
    // validation, frame, raster, output, or session-save operation fails.
    if (error && typeof error === 'object') {
      error.context = { ...error.context, stage_diagnostics: stageDiagnostics };
      if (error.code === 'NODE_FRAME_REPLY_LIMIT') {
        error.message = 'フレーム転送が24 MiB上限を超えました。同じ preview に --frame-summary --format json を指定すると件数と打切り理由を取得できます。';
        error.context.next_action = { command: 'preview', options: ['--frame-summary', '--format', 'json'],
          output: 'bounded_diagnostic_summary_only', full_scene_verified: false };
      }
    }
    throw error;
  }
}
