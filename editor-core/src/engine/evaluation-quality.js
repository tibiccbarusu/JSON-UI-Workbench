/** Completeness is independent of pixel resources and native compatibility.
 * Counts describe this bounded preview, not Minecraft's internal object count. */
const LIMIT_CODE = /(?:LIMIT|TRUNCAT|BUDGET|INCOMPLETE|MAX_NODES)/u;
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function summarizeEvaluationQuality({ projection, frame, modelStats } = {}) {
  const retained = frame?.evaluation;
  const codes = new Set(retained?.reason_codes || []);
  const diagnostics = Array.isArray(projection?.diagnostics) ? projection.diagnostics : [];
  for (const row of diagnostics.slice(0, 4096)) if (LIMIT_CODE.test(String(row?.code || ''))) codes.add(row.code);
  if (diagnostics.length > 4096) codes.add('EVALUATION_DIAGNOSTIC_SCAN_LIMIT');
  if (projection?.ok === false) codes.add('EVALUATION_PROJECTION_FAILED');
  if (modelStats?.truncated === true) codes.add('EVALUATION_MODEL_TRUNCATED');
  if (frame?.layout?.stats?.truncated === true) codes.add('EVALUATION_LAYOUT_TRUNCATED');
  if (frame?.bindings?.observationCaptureComplete === false) codes.add('EVALUATION_BINDINGS_INCOMPLETE');
  for (const warning of (frame?.layout?.warnings || []).slice(0, 4096)) {
    const code = typeof warning === 'string' ? warning.split(':', 1)[0] : warning?.code;
    if (LIMIT_CODE.test(String(code || ''))) codes.add(code);
  }
  const stats = projection?.stats;
  const counts = stats ? {
    requested_grid_items: number(stats.requestedGridItems), generated_grid_items: number(stats.materializedGridItems),
    requested_factory_items: number(stats.requestedFactoryItems), generated_factory_items: number(stats.materializedFactoryItems),
    materialized_json_objects: number(stats.materializedObjects),
  } : retained?.counts || null;
  if (counts) for (const kind of ['grid', 'factory']) {
    const expected = counts[`requested_${kind}_items`], actual = counts[`generated_${kind}_items`];
    if (expected !== null && actual !== null && expected > actual) codes.add(`EVALUATION_${kind.toUpperCase()}_ITEMS_OMITTED`);
  }
  const observed = Boolean(projection || frame || modelStats);
  return { status: codes.size ? 'unknown' : observed ? 'passed' : 'not_evaluated',
    scope: 'bounded_preview_evaluation', complete: observed && codes.size === 0,
    reason_codes: [...codes].slice(0, 64), reason_codes_omitted: Math.max(0, codes.size - 64), counts,
    count_scope: 'visited_generators_only; unvisited nested branches may require more items',
    native_parity_verified: false, native_performance_measured: false };
}

/** Cheap linear survey of an already expanded immutable execution tree.
 * This does not walk all referenced candidate templates again or clone props. */
export function surveyExecutionWorkload(nodesById, uiModel) {
  let controls = 0, bindings = 0, images = 0, customRenderers = 0;
  for (const node of Object.values(nodesById || {})) {
    controls++;
    bindings += Array.isArray(node.bindings) ? node.bindings.length : Array.isArray(node.props?.bindings) ? node.props.bindings.length : 0;
    if (node.type === 'image') images++;
    if (node.type === 'custom') customRenderers++;
  }
  if (uiModel?.root) {
    bindings = 0;
    const pending = [uiModel.root];
    while (pending.length) {
      const node = pending.pop();
      bindings += Array.isArray(node.bindings) ? node.bindings.length : 0;
      for (const child of node.children || []) pending.push(child);
    }
  }
  return { scope: 'expanded_preview_tree', controls, bindings, images, custom_renderers: customRenderers,
    native_object_count: 'not_measured', native_fps: 'not_measured' };
}
