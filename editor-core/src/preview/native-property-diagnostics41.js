/** Recorded native incompatibilities only; this is deliberately not a schema
 * whitelist. Unknown future properties must survive import/export untouched.
 * Evidence: ASTRAL MOTION native ContentLog 2026-09-25 04:43:48 explicitly
 * rejects vertical_alignment on the am_controls caption label definition.
 * Drawned 0.1.7 native evidence separately rejects focus_enabled on its
 * passive panel/image nodes; native button/toggle input remains supported. */
export const NATIVE_PROPERTY_DIAGNOSTIC_LIMIT41 = 256;
export function knownUnsupportedPreviewProperties41(type, props) {
  const normalized = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (!props || typeof props !== 'object' || Array.isArray(props)) return [];
  if (normalized === 'label' && Object.hasOwn(props, 'vertical_alignment')) return ['vertical_alignment'];
  if (['panel', 'image'].includes(normalized) && Object.hasOwn(props, 'focus_enabled')) return ['focus_enabled'];
  return [];
}

const QUALITY_SCAN_LIMIT = 4096;
const QUALITY_EVIDENCE_LIMIT = 64;
const ownValue = (record, key) => {
  if (!record || typeof record !== 'object') return undefined;
  try {
    const entry = Object.getOwnPropertyDescriptor(record, key);
    return entry && Object.hasOwn(entry, 'value') ? entry.value : undefined;
  } catch { return undefined; }
};
const safeText = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 300) : '';

/** Recorded incompatibilities shared by validation and raster layout. This
 * intentionally does not classify unknown properties or certify a native
 * schema. A missing or incomplete observation cannot become a passed axis.
 * `validation` is a validateUiScreenModel result; `layout` is frame.layout.
 */
export function summarizeNativePropertyQuality({ validation = null, layout = null } = {}) {
  const evidence = [], codes = new Set(), seen = new Set();
  let observed = false, complete = true, malformed = false, count = 0;
  const record = (code, detail, nodeId = '', propKey = '') => {
    const id = safeText(nodeId), property = safeText(propKey);
    const key = id && property ? `${code}|${id}|${property}` : `${code}|${safeText(detail)}`;
    if (seen.has(key)) return;
    if (seen.size < QUALITY_SCAN_LIMIT * 2) seen.add(key);
    count++;
    if (codes.size < QUALITY_EVIDENCE_LIMIT) codes.add(code);
    if (evidence.length < QUALITY_EVIDENCE_LIMIT) evidence.push({ code,
      detail: safeText(detail), nodeId: id, propKey: property });
  };
  const scan = (rows, source) => {
    if (!Array.isArray(rows)) { malformed = true; return; }
    observed = true;
    if (rows.length > QUALITY_SCAN_LIMIT) complete = false;
    for (let i = 0; i < Math.min(rows.length, QUALITY_SCAN_LIMIT); i++) {
      const row = ownValue(rows, String(i));
      if (source === 'validation') {
        if (!row || typeof row !== 'object' || Array.isArray(row)) { malformed = true; continue; }
        const code = ownValue(row, 'code');
        if (typeof code !== 'string') { malformed = true; continue; }
        if (code === 'NATIVE_PROPERTY_DIAGNOSTIC_LIMIT') complete = false;
        if (code === 'NATIVE_PROPERTY_UNSUPPORTED') record(code, ownValue(row, 'message'),
          ownValue(row, 'nodeId'), ownValue(row, 'propKey'));
      } else {
        if (typeof row !== 'string') { malformed = true; continue; }
        if (row.startsWith('LAYOUT_NATIVE_PROPERTY_DIAGNOSTIC_LIMIT:')) complete = false;
        if (row.startsWith('LAYOUT_NATIVE_PROPERTY_UNSUPPORTED:')) {
          const detail = row.slice('LAYOUT_NATIVE_PROPERTY_UNSUPPORTED:'.length);
          const separator = detail.lastIndexOf(':');
          if (separator <= 0 || separator === detail.length - 1) { malformed = true; continue; }
          record('NATIVE_PROPERTY_UNSUPPORTED', row, detail.slice(0, separator), detail.slice(separator + 1));
        }
      }
    }
  };
  if (validation !== null) scan(ownValue(validation, 'issues'), 'validation');
  if (layout !== null) scan(ownValue(layout, 'warnings'), 'layout');
  if (!complete) codes.add('NATIVE_PROPERTY_OBSERVATION_INCOMPLETE');
  if (malformed) codes.add('NATIVE_PROPERTY_EVIDENCE_INVALID');
  if (!observed) codes.add('NATIVE_PROPERTY_OBSERVATION_UNAVAILABLE');
  return { schema: 'jsonui-native-property-quality-v1',
    status: malformed || count ? 'failed' : !observed ? 'not_evaluated' : !complete ? 'unknown' : 'passed',
    scope: 'recorded_native_property_incompatibilities', diagnostic_count: count,
    reason_codes: [...codes].slice(0, QUALITY_EVIDENCE_LIMIT), diagnostics: evidence,
    omitted_diagnostics: Math.max(0, count - evidence.length),
    observation_capture_complete: observed && complete && !malformed,
    native_parity_verified: false, exhaustive_native_schema_verified: false };
}
