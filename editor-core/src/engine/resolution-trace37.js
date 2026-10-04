/** Bounded observational trace. It does not authorize preview or prove frame necessity. */
const MAX_EDGES = 2048;
const MAX_SERIALIZED_CHARS = 524288;
const MAX_FIELD_CHARS = 512;

/** Record final retained inheritance attempts while keeping actual work monotonic. */
export function createResolutionTrace(rootRecordId) {
  const edges = [];
  let limitKinds = new Set();
  let retainedChars = 0, observedEdges = 0, omittedEdges = 0, clippedFields = 0;
  const bounded = value => {
    if (value === undefined || value === null) return null;
    const text = String(value);
    if (text.length > MAX_FIELD_CHARS) { clippedFields += 1; limitKinds.add('FIELD_CHAR_LIMIT'); }
    return text.slice(0, MAX_FIELD_CHARS);
  };
  const identity = record => record ? {
    record_id: bounded(record.id ?? record.recordId), source_id: bounded(record.sourceId),
    source_kind: bounded(record.sourceKind), file_path: bounded(record.filePath ?? record.path),
    qualified_name: bounded(record.qualifiedName), precedence: Number.isFinite(record.precedence) ? record.precedence : null,
  } : null;
  return {
    add({ from, to, kind, pointer, reference, resolvedReference, variableChain = [], state }) {
      observedEdges += 1;
      if (edges.length >= MAX_EDGES) { omittedEdges += 1; limitKinds.add('EDGE_COUNT_LIMIT'); return; }
      const edge = {
        edge_id: `inheritance-${edges.length + 1}`, root_record_id: bounded(rootRecordId),
        from: identity(from), to: identity(to), kind,
        authored_pointer: bounded(pointer), effective_pointer: null,
        effective_pointer_reason: 'EFFECTIVE_OCCURRENCE_NOT_TRACKED',
        reference: { authored: bounded(reference), resolved: bounded(resolvedReference),
          variable_chain: variableChain.slice(0, 32).map(bounded) },
        resolution_state: state,
        required_for_resolution: 'unknown', required_for_frame: 'unknown',
        necessity_reason: 'OBSERVATION_ONLY',
      };
      if (variableChain.length > 32) { clippedFields += 1; limitKinds.add('VARIABLE_CHAIN_LIMIT'); }
      const chars = JSON.stringify(edge).length;
      if (retainedChars + chars > MAX_SERIALIZED_CHARS) { omittedEdges += 1; limitKinds.add('SERIALIZED_CHAR_LIMIT'); return; }
      retainedChars += chars; edges.push(edge);
    },
    capture() { return { length: edges.length, retainedChars, omittedEdges, clippedFields, limitKinds: [...limitKinds] }; },
    restore(snapshot) {
      edges.length = snapshot.length; retainedChars = snapshot.retainedChars;
      omittedEdges = snapshot.omittedEdges; clippedFields = snapshot.clippedFields;
      limitKinds = new Set(snapshot.limitKinds);
    },
    snapshot() {
      return {
        schema: 'jsonui-inheritance-observation-v1', root_record_id: String(rootRecordId),
        scope: 'record_and_child_inheritance_attempts', enforcement: 'none',
        trace_complete: false,
        capture_complete: omittedEdges === 0 && clippedFields === 0,
        limitations: ['FRAME_NECESSITY_NOT_EVALUATED', 'EFFECTIVE_OCCURRENCES_NOT_TRACKED',
          'FACTORY_GRID_BRANCHES_NOT_FULLY_TRACKED', 'DIAGNOSTIC_EDGE_IDS_NOT_ASSIGNED'],
        limits: { maximum_edges: MAX_EDGES, maximum_serialized_chars: MAX_SERIALIZED_CHARS, maximum_field_chars: MAX_FIELD_CHARS },
        observed_edges: observedEdges, retained_edges: edges.length,
        omitted_edges: omittedEdges, clipped_fields: clippedFields, retained_serialized_chars: retainedChars,
        limit_kinds: [...limitKinds].sort(),
        edges: edges.slice(),
      };
    },
  };
}
