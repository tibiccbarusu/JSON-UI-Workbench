/** Match an interactive hit surface to the current model and semantic state.
 * Animation time is intentionally excluded: a completed time-only frame stays
 * interactive while the next animation frame is queued. */
export function previewLayoutInputKey({ state, canvasState, preset, assetMetricsRevision }) {
  return [preset?.width, preset?.height, state?.ui?.previewLocale || 'en_US', canvasState?.structureMode,
    assetMetricsRevision, Number(state?.preview?.mockDataVersion) || 0,
    canvasState?.scrollRevision || 0, canvasState?.previewTopicRootId || '',
    canvasState?.uiInstanceId || '', canvasState?.localToggleState?.revision || 0].join('|');
}

function sameFrameFile(rendered, current) {
  return Boolean(rendered && current && rendered.id === current.id
    && rendered.uiModel === current.uiModel && rendered.nodesById === current.nodesById);
}

/**
 * Pure readiness check; callers retain their mode, Pocket, closed, and loading
 * gates. `nodeFrameAppliedFile` must be recorded only when onResult accepts a
 * frame, never when a request is queued or a new file is selected.
 * @returns {boolean} Whether layout and effective props belong to this state.
 */
export function isPreviewInteractionFrameCurrent({ state, file, canvasState, preset, assetMetricsRevision, nodeFrameAvailability, animationEvent }) {
  const cs = canvasState;
  if (!file || !cs || !Array.isArray(cs.layout?.boxes) || cs.layoutError
    || !sameFrameFile(cs.layoutInputFile, file)
    || (nodeFrameAvailability !== true && nodeFrameAvailability !== false)) return false;
  const expectedKey = previewLayoutInputKey({ state, canvasState:cs, preset, assetMetricsRevision });
  if (cs.layoutInputKey !== expectedKey) return false;
  if (nodeFrameAvailability === false) return true;
  const expectedContext = `${expectedKey}|${animationEvent}`;
  return sameFrameFile(cs.nodeFrameAppliedFile, file)
    && cs.nodeFrameContext === expectedContext
    && cs.nodeFrameAppliedContext === expectedContext;
}
