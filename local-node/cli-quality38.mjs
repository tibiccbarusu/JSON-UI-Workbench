/** R38 Node-only, bounded preview evidence. A passed axis never certifies Minecraft parity. */
import { createHash } from 'node:crypto';
import { summarizeEvaluationQuality } from '../editor-core/src/engine/evaluation-quality.js';
import { summarizeCollectionQuality } from '../editor-core/src/engine/collection-quality39.js';
import { summarizeAnimationQuality } from '../editor-core/src/engine/animation-quality41.js';
import { summarizeBindingQuality } from '../editor-core/src/engine/binding-quality40.js';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { summarizeNativePropertyQuality } from '../editor-core/src/preview/native-property-diagnostics41.js';

const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_CODES = 64;
const boundedSelected = selected => selected ? Object.fromEntries(Object.entries(selected)
  .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
  .slice(0, 16).map(([key, value]) => [key.slice(0, 128), typeof value === 'string' ? value.slice(0, 512) : value])) : null;

const requestFingerprint = (projection, frameRequest, fontProfile = 'bitmap') => sha256({ selected: projection?.selected ?? null,
  document: projection?.document ?? null, request: frameRequest ?? null, font_profile: fontProfile });

/** This gate covers retained selected-projection resolution, not runtime reachability. */
export function selectedSemanticQuality(projection) {
  const diagnostics = Array.isArray(projection?.diagnostics) ? projection.diagnostics : null;
  const errors = (diagnostics || []).filter(row => row.severity === 'error' || /(?:BASE.*NOT_FOUND|TEMPLATE_NOT_FOUND|INHERITANCE_CYCLE)/u.test(row.code || ''));
  const uncertain = (diagnostics || []).filter(row => /(?:UNRESOLVED|LIMIT|TRUNCAT|BUDGET|INCOMPLETE)/u.test(row.code || ''));
  const trace = projection?.dependencyTrace;
  const captureComplete = trace?.capture_complete === true;
  const status = errors.length ? 'failed' : !diagnostics || uncertain.length || !captureComplete ? 'unknown' : 'passed';
  return { status, scope: 'selected_projection_resolution', error_count: errors.length,
    uncertainty_count: uncertain.length, reason_codes: [...new Set([...errors, ...uncertain].map(row => row.code))].slice(0, MAX_CODES),
    observation_capture_complete: captureComplete,
    runtime_dependency_necessity: 'not_evaluated',
    conservative_policy: 'selected resolution errors are retained even when frame reachability is unknown',
    unrelated_catalog_diagnostics_included: false };
}

/** Independent axes share the exact request fingerprint; no aggregate native success. */
export function buildPreviewQuality({ projection, validation = null, frame = null, frameRequest = null, settings, stateEvidence = null, raster = null } = {}) {
  const fingerprint = requestFingerprint(projection, frameRequest, settings?.font_profile ?? raster?.rendering?.font_profile ?? 'bitmap');
  const semantic = selectedSemanticQuality(projection);
  return { schema: 'jsonui-preview-quality-v1', request_sha256: fingerprint,
    semantic,
    native_properties: summarizeNativePropertyQuality({ validation, layout: frame?.layout ?? null }),
    evaluation: summarizeEvaluationQuality({ projection, frame }),
    collection: raster?.collection_quality || summarizeCollectionQuality(frame?.bindings),
    bindings: raster?.binding_quality || summarizeBindingQuality(frame?.bindings, {
      model: frame && projection?.document ? buildUiScreenModelFromJson(projection.document, { filePath: projection.selected?.filePath || '' }) : null,
      propsById: frame?.propsById, visibilityMode: frameRequest?.visibilityMode ?? 'safe' }),
    animation: raster?.animation_quality || summarizeAnimationQuality(frame?.animation),
    state: { status: stateEvidence ? 'passed' : 'not_evaluated', scope: 'explicit_input_normalization',
      runtime_completeness: 'not_evaluated', ...(stateEvidence ? { input_sha256: stateEvidence.input_sha256,
        normalized_sha256: stateEvidence.normalized_sha256 } : {}) },
    assets: { status: raster ? raster.complete ? 'passed' : 'failed' : 'not_evaluated', scope: 'raster_prepared_resources',
      ...(raster ? { diagnostic_count: raster.diagnostics?.length || 0, asset_fingerprint_sha256: raster.final_frame_summary?.asset_fingerprint_sha256 || null } : {}) },
    interaction: { status: 'not_evaluated', reason_code: 'SCRIPT_API_AND_GAME_INPUT_NOT_EXECUTED' },
    native_comparison: { status: 'not_evaluated', reason_code: 'MINECRAFT_PIXEL_PARITY_NOT_VERIFIED' },
    preview_context: projection?.previewContext || { scope: 'component', nativeParityVerified: false },
    complete_meaning: 'complete: resource raster only; preview_complete: resources, complete bounded evaluation, collection, visual/input bindings and recorded native properties; native_properties checks only recorded incompatibilities; animation is a separate opt-in strict-animation axis; sound playback and native equivalence require separate evidence' };
}

/** Hash the actual final draw input without cloning an unbounded frame into every reply. */
export function summarizeFinalFrame({ frame, projection, frameRequest, timeSeconds, fontProfile, provenance = [], reflowPasses = 0 } = {}) {
  const boxes = frame.layout.boxes;
  const boxHash = createHash('sha256');
  boxHash.update('jsonui-final-boxes-v1\n');
  for (const box of boxes) boxHash.update(JSON.stringify(box)).update('\n');
  const frameHash = createHash('sha256').update(JSON.stringify(frame)).digest('hex');
  return { schema: 'jsonui-final-frame-summary-v1', stage: 'after_resource_measurement',
    selected: boundedSelected(projection?.selected), selected_identity_truncated: JSON.stringify(boundedSelected(projection?.selected)) !== JSON.stringify(projection?.selected ?? null),
    frame_id: frame.frameId ?? frame.nodeFrameId ?? null,
    request_sha256: requestFingerprint(projection, frameRequest, fontProfile),
    frame_sha256: frameHash, box_digest_sha256: boxHash.digest('hex'),
    box_digest_encoding: 'sha256(UTF8(jsonui-final-boxes-v1\\n + each JSON.stringify(box) + \\n))',
    box_count: boxes.length, preset: frame.layout.preset, time_seconds: timeSeconds,
    font_profile: fontProfile, reflow_passes: reflowPasses,
    warning_count: frame.layout.warnings?.length || 0,
    asset_fingerprint_sha256: sha256(provenance), asset_evidence_count: provenance.length,
    full_frame_included: false, full_frame_reason: 'BOUNDED_SUMMARY_DEFAULT',
    minecraft_pixel_parity_verified: false };
}
