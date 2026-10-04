/** A deliberately small inspection response when full frame transport is too
 * large. No omitted frame can be mistaken for a renderable or verified frame. */
export function summarizeFrameForTransport(frame, limitBytes) {
  const groups = new Map();
  let total = 0;
  const add = row => {
    total++;
    const code = String(typeof row === 'string' ? row.split(':', 1)[0] : row?.code || 'UNCLASSIFIED').slice(0, 120);
    if (groups.has(code)) groups.get(code).count++;
    else if (groups.size < 64) groups.set(code, { code, count: 1 });
  };
  for (const row of frame.bindings?.warnings || []) add(row);
  for (const row of frame.layout?.warnings || []) add(row);
  for (const row of frame.animation?.diagnostics || []) add(row);
  return { schema: 'jsonui-frame-summary-v1', modelId: frame.modelId,
    generation: frame.generation, workload: frame.workload, evaluation: frame.evaluation,
    box_count: frame.layout?.boxes?.length || 0, layout_stats: frame.layout?.stats,
    diagnostics: { total, groups: [...groups.values()], grouped_count: [...groups.values()].reduce((sum, row) => sum + row.count, 0),
      detail_records_included: false },
    frame_included: false, renderable: false, native_parity_verified: false,
    transport: { mode: 'summary-v1', normal_reply_limit_bytes: limitBytes,
      action: 'Inspect evaluation and workload, then select a smaller definition or state. Separate component checks are not a full-scene pass.' } };
}
