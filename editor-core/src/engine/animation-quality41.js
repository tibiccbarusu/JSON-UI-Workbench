/** 有界な animation sample 品質。数値再現の合格を実機一致へ昇格させない。 */
export const ANIMATION_OBSERVATION_LIMITS = Object.freeze({ nodes: 50000, compileReferences: 2048,
  animsPerNode: 64, directPropertyReferencesPerNode: 5, chain: 64, evidenceRows: 256, evidenceBytes: 65536,
  identifierCharacters: 256, reasonsPerRow: 16, reasonCodes: 64 });
const states = ['supported', 'inactive', 'unknown'];
const safeText = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 256) : '';
const validCode = value => typeof value === 'string' && /^ANIMATION_[A-Z0-9_]{1,90}$/u.test(value);
const encoder = new TextEncoder();
export function createAnimationObservation(event) {
  const limits = ANIMATION_OBSERVATION_LIMITS;
  const evidence = [], reasons = new Set();
  const result = { schema: 'jsonui-animation-observation-v1', clock: 'absolute_preview_seconds',
    event: safeText(event), native_clock_verified: false, native_events_executed: false,
    nodes_observed: 0, reference_count: 0, supported_count: 0, inactive_count: 0, unknown_count: 0,
    evidence, omitted_evidence_count: 0, observation_capture_complete: true, reason_codes: [], limits };
  let bytes = 2048;
  const incomplete = code => { result.observation_capture_complete = false; if (reasons.size < limits.reasonCodes) reasons.add(code); };
  if (typeof event !== 'string' || event.length > limits.identifierCharacters) incomplete('ANIMATION_EVIDENCE_ID_TRUNCATED');
  const record = ({ nodeId, ref, status, visibility, codes = [], segmentCount = 0 }) => {
    result.reference_count++;
    result[`${status}_count`]++;
    if (evidence.length >= limits.evidenceRows) {
      result.omitted_evidence_count++; incomplete('ANIMATION_EVIDENCE_CAPTURE_INCOMPLETE');
      if (status === 'unknown') for (const code of codes) { if (validCode(code) && reasons.size < limits.reasonCodes) reasons.add(code); }
      return;
    }
    const row = { nodeId: safeText(nodeId), ref: safeText(ref), status, visibility,
      reason_codes: [...new Set(codes)].filter(validCode).slice(0, limits.reasonsPerRow), segment_count: segmentCount };
    if (nodeId !== row.nodeId || ref !== row.ref) incomplete('ANIMATION_EVIDENCE_ID_TRUNCATED');
    if (new Set(codes).size > limits.reasonsPerRow) incomplete('ANIMATION_EVIDENCE_REASON_TRUNCATED');
    if (status === 'unknown') for (const code of row.reason_codes) { if (reasons.size < limits.reasonCodes) reasons.add(code); }
    const size = encoder.encode(JSON.stringify(row)).byteLength + 1;
    if (evidence.length < limits.evidenceRows && bytes + size <= limits.evidenceBytes - 12288) { evidence.push(row); bytes += size; }
    else { result.omitted_evidence_count++; incomplete('ANIMATION_EVIDENCE_CAPTURE_INCOMPLETE'); }
  };
  const finish = () => { result.reason_codes = [...reasons]; return result; };
  return { result, record, incomplete, finish };
}

/** 旧frameやsample未実施は not_evaluated。不正証拠を通過へ補完しない。 */
export function summarizeAnimationQuality(animation) {
  const observation = animation?.observation;
  const common = { schema: 'jsonui-animation-quality-v1', scope: 'selected_frame_absolute_animation_sample',
    clock: 'absolute_preview_seconds', native_parity_verified: false, native_clock_verified: false,
    native_events_executed: false, time_seconds: Number.isFinite(animation?.timeSeconds) ? animation.timeSeconds : null };
  if (!animation || !observation) return { ...common, status: 'not_evaluated',
    reason_codes: ['ANIMATION_OBSERVATION_UNAVAILABLE'], observation_capture_complete: false };
  const rows = observation.evidence;
  const valid = observation.schema === 'jsonui-animation-observation-v1' && Array.isArray(rows)
    && rows.length <= ANIMATION_OBSERVATION_LIMITS.evidenceRows
    && typeof observation.observation_capture_complete === 'boolean'
    && ['reference_count', 'supported_count', 'inactive_count', 'unknown_count', 'omitted_evidence_count', 'nodes_observed'].every(key => Number.isInteger(observation[key]) && observation[key] >= 0)
    && observation.reference_count === observation.supported_count + observation.inactive_count + observation.unknown_count
    && observation.reference_count === rows.length + observation.omitted_evidence_count
    && (!observation.observation_capture_complete || observation.omitted_evidence_count === 0)
    && states.every(state => observation[`${state}_count`] >= rows.filter(row => row?.status === state).length)
    && rows.every(row => row && states.includes(row.status) && typeof row.nodeId === 'string' && typeof row.ref === 'string'
      && row.nodeId.length <= 256 && row.ref.length <= 256 && Array.isArray(row.reason_codes) && row.reason_codes.length <= 16 && row.reason_codes.every(validCode))
    && Array.isArray(observation.reason_codes) && observation.reason_codes.length <= 64 && observation.reason_codes.every(validCode)
    && encoder.encode(JSON.stringify(observation)).byteLength <= ANIMATION_OBSERVATION_LIMITS.evidenceBytes;
  if (!valid) return { ...common, status: 'failed', reason_codes: ['ANIMATION_QUALITY_EVIDENCE_INVALID'], observation_capture_complete: false };
  const complete = observation.observation_capture_complete;
  const codes = [...observation.reason_codes];
  if (!complete && !codes.includes('ANIMATION_EVIDENCE_CAPTURE_INCOMPLETE')) codes.push('ANIMATION_EVIDENCE_CAPTURE_INCOMPLETE');
  return { ...common, status: observation.unknown_count || !complete ? 'unknown' : 'passed',
    event: observation.event, reference_count: observation.reference_count,
    supported_count: observation.supported_count, inactive_count: observation.inactive_count,
    unknown_count: observation.unknown_count, evidence_count: rows.length,
    omitted_evidence_count: observation.omitted_evidence_count, observation_capture_complete: complete,
    reason_codes: codes.slice(0, 64), limits: ANIMATION_OBSERVATION_LIMITS };
}
