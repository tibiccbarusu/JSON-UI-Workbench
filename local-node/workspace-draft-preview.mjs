/** 未確定の原文を独立したカタログとフレームへ投影する Node 専用処理。 */
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { collectPreviewAnimationDefinitions } from '../editor-core/src/engine/preview-animation.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { prepareNodeFrameFile } from '../editor-core/src/engine/node-frame-wire.js';
import { FrameIrProcessor } from './frame-ir.mjs';
import { fail, LIMITS } from './limits.mjs';
import { responseKey } from './response-cache.mjs';

export class WorkspaceDraftProjector {
  constructor() { this.retained = null; this.hits = 0; this.builds = 0; }
  clear() { this.retained = null; }
  snapshot() { return { entries: this.retained ? 1 : 0, bytes: this.retained?.bytes || 0, hits: this.hits, builds: this.builds }; }
  project(options) { return projectWorkspaceDraft({ ...options, cache: this }); }
}

/** 通常表示のカタログ・フレームキャッシュ・編集履歴は一切更新しない。 */
export async function projectWorkspaceDraft({ draft, getPack, variables, representativeCollections, eventFactorySelections, frame: inputFrame, checkpoint = () => {}, cache }) {
  const started = performance.now();
  if (!inputFrame || typeof inputFrame !== 'object' || Array.isArray(inputFrame)) fail('WORKSPACE_DRAFT_FRAME_REQUIRED', 422);
  if (['file', 'modelId', 'projectionId', 'contextId', 'previousFrameId'].some(key => Object.hasOwn(inputFrame, key))) fail('WORKSPACE_DRAFT_FRAME_INVALID', 422);
  checkpoint('draft-catalog');
  // Preserve ordered control maps carried in variables and collection values.
  const key = responseKey(JSON.stringify({ workspaceId: draft.workspaceId, revision: draft.draftRevision,
    screen: draft.screen, variables, representativeCollections, eventFactorySelections }));
  let projection, file, cacheHit = false, readFiles = 0;
  const phaseDurations = {}, phaseBegan = performance.now();
  if (cache?.retained?.key === key) {
    ({ projection, file } = cache.retained); cache.hits++; cacheHit = true;
  } else {
    if (cache) cache.builds++;
    const sources = draft.sources.map(source => {
      const item = getPack(source.id), overrides = source.overrides || {};
      const texts = draft.documentTexts?.[source.id] || {};
      return { id: source.kind === 'vanilla' ? 'vanilla-reference' : 'imported-pack', kind: source.kind,
        precedence: source.kind === 'vanilla' ? 10 : 20,
        filePaths: [...new Set([...item.packPaths, ...Object.keys(overrides)])],
        readText: async (path, options) => {
          checkpoint('draft-catalog'); readFiles++;
          return Object.hasOwn(texts, path) ? texts[path] : Object.hasOwn(overrides, path)
            ? overrides[path] : item.zipReader.readText(item.rootPrefix + path, options);
        } };
    });
    // The frame resolves authored inheritance directly and never consumes the
    // export dependency graph. Keep that expensive global scan out of drafts.
    const catalog = await buildUiCatalog({ sources, parseJsonc, referenceDiscovery: 'skip',
      onProgress: progress => checkpoint(`draft-catalog-${progress.phase}`, progress.processed, progress.total) });
    phaseDurations.catalogMs = performance.now() - phaseBegan;
    checkpoint('draft-inheritance');
    const screenSourceId = draft.screen.sourceKind === 'vanilla' ? 'vanilla-reference' : 'imported-pack';
    const candidates = catalog.records.filter(record => record.filePath === draft.screen.path
      && record.sourceId === screenSourceId && record.qualifiedName === draft.screen.qualifiedName);
    const exact = candidates.find(record => record.rawKey === draft.screen.rawKey);
    const selected = exact || (candidates.length === 1 ? candidates[0] : null);
    if (!selected) fail('WORKSPACE_DRAFT_SCREEN_UNRESOLVED', 422);
    if (selected.profile === 'pocket') fail('POCKET_PREVIEW_BLOCKED', 422);
    const projectionBegan = performance.now();
    projection = resolveEffectiveUi({ catalog, recordId: selected.id, variables, representativeCollections, eventFactorySelections });
    if (!projection.ok) return { ok: false, code: projection.error?.code || 'WORKSPACE_DRAFT_PROJECTION_FAILED',
      projection, baseRevision: draft.baseRevision, pendingVersion: draft.pendingVersion, workspaceId: draft.workspaceId };
    projection.animationDefinitions = collectPreviewAnimationDefinitions(catalog);
    phaseDurations.inheritanceMs = performance.now() - projectionBegan;
    checkpoint('draft-model');
    const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: selected.filePath });
    file = prepareNodeFrameFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel,
      meta: { selectedDefinition: projection.selected, resolution: { animationDefinitions: projection.animationDefinitions } } });
    if (cache) {
      const bytes = Buffer.byteLength(JSON.stringify({ projection, file }));
      cache.retained = bytes <= 16 * 1024 * 1024 ? { key, projection, file, bytes } : null;
    }
  }
  checkpoint('draft-layout');
  // A draft has its own short-lived cache, so neither cache eviction nor a failed
  // preview can invalidate the committed frame currently displayed by the UI.
  const frames = new FrameIrProcessor();
  let frame;
  try {
    const rendered = frames.execute({ ...inputFrame, frameTransport: undefined, file });
    frame = JSON.parse(rendered.body);
  } finally { frames.clear(); }
  const result = { schema: 'jsonui-workspace-draft-v1', ok: true, workspaceId: draft.workspaceId,
    baseRevision: draft.baseRevision, pendingVersion: draft.pendingVersion, draftRevision: draft.draftRevision,
    committed: false, projection, frame, batch: draft.batch,
    metrics: { processing: 'node-worker', durationMs: performance.now() - started, changedFiles: draft.changedFiles,
      projectionCache: cacheHit ? 'hit' : 'miss', catalogReadFiles: readFiles, phases: phaseDurations } };
  if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.replyBytes) fail('NODE_REPLY_LIMIT', 413);
  checkpoint('draft-complete', 1, 1);
  return result;
}
