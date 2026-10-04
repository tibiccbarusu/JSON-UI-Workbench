/** Browser/Node shared, bounded assessment of observed collection diagnostics.
 * A pass means no collection-resolution issue was reported for this frame.
 * It never certifies Script API execution, resource pixels, or native parity. */
const MAX_WARNINGS = 4096;
const MAX_DIAGNOSTICS = 64;

export function summarizeCollectionQuality(bindings) {
  const warnings = Array.isArray(bindings?.warnings) ? bindings.warnings : null;
  const diagnostics = [];
  const codes = new Set();
  let count = 0, failures = 0, malformed = false;
  for (const value of (warnings || []).slice(0, MAX_WARNINGS)) {
    if (typeof value !== 'string') { malformed = true; continue; }
    const code = value.split(':', 1)[0];
    if (!/^(?:NESTED_)?COLLECTION_[A-Z0-9_]+$/u.test(code)) continue;
    count++;
    if (/(?:INVALID|MISSING|OUT_OF_RANGE|AMBIGUOUS)/u.test(code)) failures++;
    if (codes.size < MAX_DIAGNOSTICS) codes.add(code);
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({ code,
      detail: value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 300) });
  }
  const truncated = Boolean(warnings && warnings.length > MAX_WARNINGS);
  const captureIncomplete = bindings?.observationCaptureComplete === false;
  if (truncated) codes.add('COLLECTION_QUALITY_SCAN_LIMIT');
  if (captureIncomplete) codes.add('COLLECTION_QUALITY_CAPTURE_INCOMPLETE');
  if (malformed) codes.add('COLLECTION_QUALITY_EVIDENCE_INVALID');
  return { status: !warnings ? 'not_evaluated' : failures ? 'failed' : count || truncated || malformed || captureIncomplete ? 'unknown' : 'passed',
    scope: 'selected_frame_collection_resolution', diagnostic_count: count,
    reason_codes: [...codes], diagnostics, omitted_diagnostics: Math.max(0, count - diagnostics.length),
    observation_capture_complete: Boolean(warnings) && !truncated && !malformed && !captureIncomplete,
    native_parity_verified: false };
}
