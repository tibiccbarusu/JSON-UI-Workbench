import { renderStudioAppearance35, textureSuggestions35 } from './ui/studio-appearance35.js';
import { getNodeRequestLog35 } from './pack-io/node-remote-client.js';
import { insertionParent33, newElementValue33 } from './ui/editor-insertion33.js';
import { resizeBox33, resizeChanges33, resizePendingAddition33 } from './ui/editor-transform33.js';
import { insertionParent32, setAddType32, setInsertionRelation32, beginAdd32, currentAdd32, finishAdd32 } from './ui/workspace-add-intent32.js';
import { registerEditorGroupCommands31 } from './commands/editor-group-commands31.js';
import { applyStudioLayout28, renderStudioLayoutTools28 } from './ui/studio-layout28.js';
import { createActionHistory28 } from './diagnostics/action-history28.js';
import { exportCurrentScreenGroups21, mergeCurrentScreenGroups21, GROUP_FILE_MAX_BYTES21 } from './ui/editor-group-file21.js';
import { groupPackContext21 } from './ui/editor-group-runtime21.js';
import { createEditorSelection21, marqueeViewport21 } from './ui/editor-selection21.js';
import { applyPendingLayout21, mergePendingProperties21, movementDelta21 } from './ui/editor-draft-layout21.js';
import { applyPendingGeometry21 } from './ui/editor-draft-geometry21.js';
import { createWorkspaceDraftPreview23 } from './ui/workspace-draft-preview23.js';
import { buildWorkspaceDraftScene23, advanceWorkspaceDraftScene23, moveWorkspaceDraftAddition23 } from './ui/workspace-draft-scene23.js';
import { renderWorkspaceDraftControls23 } from './ui/workspace-draft-controls23.js';
import { resumeWorkspacePreviewAfterDraft, captureWorkspaceSourceDrag, isWorkspaceSourceDragCurrent, captureWorkspaceSourceCommitDraft, workspaceSourceCommitDraftInteraction } from './ui/workspace-gesture14.js';
import { renderWorkspaceEditPolicy, workspacePreviewEditOperation, workspaceEditSelectionIdentity } from './ui/workspace-edit-intent.js';
import { captureGeometryPolicy29, assertGeometryPolicy29, distinctPlannedMoves29 } from './ui/workspace-geometry-policy29.js';
import { DEFAULT_CLASSIC_UI_SCALE, activeClassicUiScale, logicalCanvasPreset, inferPackUiScaleFromBuildInfo } from './preview/preview-viewport16.js';
import { siteText, translateSiteMessage, setSiteLocale, navigationChoiceLabel, clipboardSourceLabel, filterLocalizedDiagnostics } from './i18n/site-messages.js';
import { summarizeCollectionQuality } from './engine/collection-quality39.js';
/*
  JSONUI Web Editor
  Step S019: JSONC parser + deterministic JSON stringify

  - Entry module loaded from /app/index.html via <script type="module">
  - Minimal client-side routing using the URL hash (single-page)
  - Renders a 3-panel editor layout (tree / preview-canvas / inspector)
  - Adds resizable split panels (left/right)
  - Adds editor tabs:
    - Center: Preview / Canvas
    - Right: Properties / Raw JSON / Debug
  - Uses the minimal app state store from S016 to keep UI state (tabs, panel sizes)
  - No undo/redo support (policy UNDO_REDO_POLICY=NONE)

  S018 additions:
  - Load zip.js (pinned) via app/index.html and expose a ZipReader wrapper
  - Provide a small ZIP demo on the About page: open a zip and list entries

  S019 additions:
  - Load jsonc-parser (pinned) via app/index.html
  - Provide a JSONC parsing demo on the About page: parse JSON-with-comments,
    show line/column errors, and output deterministic JSON
*/

import { createPreviewDebugRequest23 } from './diagnostics/preview-debug-request23.js';
import { downloadBlobSafely23 } from './ui/blob-download.js';
import { sanitizePreviewDebugPayload, applyPreviewPaintAnimation, classifyPreviewStoreChange, createFrameCoalescer, createPreviewPerformanceMetrics, createPreviewPlayback, renderPreviewStateControls } from './ui/preview-workspace.js';
import { createPreviewViewportController } from './ui/preview-viewport.js';
import { lockedMovement26, planLayerMove26, studioProgressModel26 } from './ui/editor-arrangement26.js';
import { studioCommandGroup, studioDetails, renderStudioTabs, renderStudioExpandedBar, pendingPreviewText, pendingApplyText } from './ui/studio-shell.js';
import { renderStudioInsert35 } from './ui/studio-insert35.js';
import { createUiAudioPlayer } from './preview/ui-audio-player.js';
import { buildUiAudioIntent } from './preview/ui-audio-intent.js';
import { selectPreviewText, resolvePreviewVerticalAlignment } from './preview/preview-text.js';
import { createPreviewObservationTrace, capturePreviewInputSnapshot, isPreviewInputContextCurrent, evaluatePreviewInputRelease } from './preview/preview-observation41.js';
import { summarizeAnimationQuality } from './engine/animation-quality41.js';
import { createUiScreenPathCache } from './preview/ui-screen-path-cache.js';
import { isPreviewInteractionFrameCurrent, previewLayoutInputKey } from './preview/interaction-frame-readiness.js';
import { resolveEnchantingBookPreviewScene } from './preview/native-book-preview.js';
import { renderUiDataEditor, applyUiDataDraft } from './ui/ui-data-editor.js';
import { buildUiDataCatalog } from './ui/ui-data-catalog.js';
import { extractUiInteractionActions, resolveUiInteraction, describeTextInteraction, commitTextInteraction, applySlotTransfer, findInteractionCollectionAddress, listUiInteractionCapabilities } from './preview/ui-interaction-engine.js';
import { hitTestUiInteraction, findUiInteractionTarget, getUiInteractionEffectiveProps, getUiInteractionSourceNode } from './preview/ui-interaction-target.js';
import { sampleNativePreviewMotion, inspectNativePreviewMotion, nativePreviewPointerForBox } from './preview/native-motion.js';
let nativeMotionEnabled = true;
import { renderRuntimeInputEditor, applyRuntimeInputDraft } from './ui/runtime-input-editor.js';
import { prepareNodeFrameFile } from './engine/node-frame-wire.js';
import { createNodeFrameController, intrinsicSizeOverrides, requestNodeFramePayload, describeNodeFrameError } from './ui/node-frame-controller.js';
import { buildEffectivePreviewMockData, evaluateBindingsWithRepresentativeRuntime } from './engine/preview-bindings-runtime.js';
import { normalizePreviewState, createPreviewStatePreset } from './engine/preview-state.js';
import { compilePreviewAnimations, samplePreviewAnimations } from './engine/preview-animation.js';
import { actions, createAppStore } from './state-store/app-store.js';
import { renderWorkspacePicker, renderLazyWorkspaceDetails, formatWorkspaceImportPhase } from './ui/workspace-navigation.js';
import { DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS, horsePreviewOptionsKey, nativeModelPreviewStatusText, renderNativeModelSettings } from './ui/native-model-settings.js';
import { ZipReader } from './pack-io/zip-reader.js';
import { DEFAULT_ZIP_LIMITS } from './pack-io/zip-limits.js';
import { importResourcePackZip } from './pack-io/pack-importer.js';
import { parseJsonc } from './json/jsonc.js';
import { stableStringify } from './json/stable-stringify.js';
import { tokenizeJsonForHighlight } from './json/json-highlight.js';
import { createDiagnosticsStore } from './diagnostics/diagnostics-store.js';
import {
  collectMissingReferences,
  collectMissingReferencesFromScreenFiles,
  getMissingReferenceDisplayValue,
} from './diagnostics/missing-references.js';
import { createSiteDiagnosticSession } from './diagnostics/site-diagnostic-session.js';
import { filterDiagnosticEntries, formatDiagnosticsText } from './diagnostics/log-export.js';
import { createLogger } from './diagnostics/logger.js';
import { createCommandSystem, formatChordForDisplay, normalizeChordFromEvent } from './commands/command-system.js';
import { createI18n, toBcp47 } from './i18n/i18n.js';
import { normalizePackPath } from './path/normalize-pack-path.js';
import { normalizeZipPath } from './path/normalize-zip-path.js';
import { sanitizeUrlForAttribute } from './security/sanitize.js';
import { captureBlobRead, captureTextRead } from './pack-io/read-result.js';
import { extractExportRootVariables, scanJsonForExportDeps } from './pack-io/export-dependencies.js';
import { buildTreeFromUiScreenModel, shouldDefaultCollapseGeneratedCollectionNode } from './editor/ui-model-tree.js';
import { reorderUiModelChild, addUiModelChild, duplicateUiModelNode, deleteUiModelNode, updateUiModelNodeProps } from './editor/ui-model-ops.js';
import { findParentId, reorderChildInNodeMap, addChildInNodeMap, duplicateSubtreeInNodeMap, deleteSubtreeInNodeMap } from './editor/tree-node-ops.js';
import { generateSchemaFilesDraft07 } from './schema/schema-generator.js';
import { buildUiScreenModelFromJson, summarizeUiScreenModel, uiScreenModelToJson, uiScreenModelToJsonText, SUPPORTED_UI_ELEMENT_TYPES, VALID_UI_ELEMENT_TYPES } from './model/ui-screen-model.js';
import { getEditablePropertyGroupsForType, getEditablePropertyKeysForType } from './model/element-registry.js';
import { resolveTextureSidecarDrawState } from './preview/texture-sidecar-contract.js';
import { buildRenderedTextSnapshot, createRenderedTextSegment, describeSelectedTextCopy, sameClipboardScope, clipboardStatusMessage } from './preview/ui-text-copy.js';
import { createClipboardBroker } from './preview/ui-clipboard-broker.js';
import { buildClipboardDataSources } from './preview/ui-clipboard-adapters.js';
import { TextureMetadataCache } from './assets/texture-metadata-cache.js';
import { DEFAULT_CANVAS_PRESET, computeLayoutBoxesForFile, fitViewToPreset, fitViewToBounds, getBedrockLogicalFontPx, estimateTextIntrinsicSize, clampZoom, canvasPxToWorld, hitTestBoxes, findNearestLayoutNodeByType, getResizeHandlesForBox, hitTestResizeHandles, drawCanvasPreview, countDrawableCanvasBoxes, findDrawableCanvasBounds, shouldShowCanvasEmptyState, buildImageDrawMetadataFromProps, mergeExplicitTextureBaseSize } from './preview/canvas-preview.js';
import { createCanvasEditPicker } from './preview/canvas-edit-picking17.js';
import {
  ITEM_TEXTURE_ATLAS_MAX_TEXT_BYTES,
  ITEM_TEXTURE_ATLAS_PACK_PATH,
  buildPrunedItemTextureAtlasForExport,
  computeNativeTextureSetLayerLimit,
  getNativeRendererPlaceholderKind,
  getNativeBannerPreviewState,
  resolveNativeRendererTexture,
  mergeNativeRendererProps,
  parseItemTextureAtlas,
  listItemTextureAtlasEntries,
} from './preview/native-renderer-preview.js';
import {
  buildEnchantingBookPreviewScene,
  compileBedrockGeometryScene,
  extractHorseClientEntityResult,
  findGeometryRecordResult,
  inspectHorseRenderControllerDocument,
  NATIVE_PREVIEW_MAX_DRAW_WORK_UNITS,
} from './preview/native-model-preview.js';
import {
  composeNativePreviewPackPaths,
  inspectBestNativePreviewVersionLayer,
  inspectFirstNativePreviewCandidateLayer,
  selectNativePreviewTargetEngineVersion,
} from './preview/native-pack-stack.js';
import { evaluateBindingsForUiModel } from './bindings/bindings-evaluator.js';
import { createLocalToggleState, applyLocalTogglePatch, normalizeLocalToggleState } from './preview/local-toggle-state.js';
import { summarizeBindingQuality } from './engine/binding-quality40.js';
import { validateUiScreenModel, validateUiDefsState, summarizeValidation } from './validation/validator.js';
import { auditVanillaReference } from './vanilla/vanilla-reference-audit.js';
import { inspectVanillaReferenceCounts } from './vanilla/vanilla-reference-inspection.js';
import * as AssetIndexer from './assets/asset-indexer.js';
import { nodeWorkspaceRequest, buildNodeCatalog, resolveNodeUi, hydrateNodeCatalog, nodeAssetIndex, nodeItemIconIndex, nodeHorsePreview, nodePlayerPreview, nodeValidatePreview, nodeFontSheet, nodeLangTable, downloadNodeDebugBundle, supportsNodeFrameIr, renderNodeFrame } from './pack-io/node-remote-client.js';
import { loadHorsePreviewFromSources } from './preview/native-model-loader.js';
import { BitmapFontCache } from './preview/bitmap-font-cache.js';
import { BitmapTextLayoutCache } from './preview/bitmap-text-layout-cache.js';
import { createBrowserDefaultPlayerRuntime, loadBrowserPlayerPreview } from './preview/native-player-browser.js';
import { DEFAULT_PLAYER_SOURCE, resolveDefaultPlayerTexture } from './preview/native-player-default.js';
import { layoutBitmapText } from './preview/bitmap-font.js';
import { nodeFontCoverage } from './pack-io/node-remote-client.js';
import { splitFontCoverageRuns, measureCoveredFontLine } from './preview/font-coverage-preview.js';
import { selectUiDefinition } from './engine/ui-catalog.js';
import { normalizeScreenRef, normalizeNavigationEntry, screenRefFromFile, resolveScreenRef, readNavigationMappings, describeScreenNavigationError, TOPIC_DEFINITION } from './preview/screen-navigation.js';

// NOTE: Use a namespace import + a compat wrapper to avoid hard crashes when
// module exports drift during iterative development or a partial deploy.
const {
  buildAssetIndexFromPackPaths,
  resolveTextureRef,
  resolveFontTypeRef,
  summarizeAssetIndex,
  lookupPackPath,
} = AssetIndexer;

/**
 * Compatibility wrapper:
 * - Prefer buildAssetIndexFromPackPathsAsync when exported.
 * - Fallback to buildAssetIndexFromPackPaths (sync) when async export is missing.
 *
 * @param {string[]} packPaths
 * @param {import('./assets/asset-indexer.js').AssetIndexBuildOptions} [options]
 */
async function buildAssetIndexFromPackPathsAsync(packPaths, options) {
  if (typeof AssetIndexer.buildAssetIndexFromPackPathsAsync === 'function') {
    return AssetIndexer.buildAssetIndexFromPackPathsAsync(packPaths, options);
  }

  try {
    const exportedKeys = (() => {
      try {
        return Object.keys(AssetIndexer || {}).sort();
      } catch {
        return [];
      }
    })();

    diagnostics.log('warn', 'asset-indexer missing buildAssetIndexFromPackPathsAsync export; falling back to sync builder', {
      source: 'asset-index',
      data: {
        packPaths: Array.isArray(packPaths) ? packPaths.length : 0,
        hasAsyncBuilder: typeof AssetIndexer.buildAssetIndexFromPackPathsAsync,
        exportedKeys,
        assetIndexerModuleUrl: (() => {
          try {
            return new URL('./assets/asset-indexer.js', import.meta.url).toString();
          } catch {
            return null;
          }
        })(),
        hint: 'Likely stale-cache / partial deploy. Ensure src/main.js and src/assets/asset-indexer.js are deployed from the same snapshot.',
      },
    });
  } catch {
    // diagnostics may not be initialized yet (rare)
  }

  return buildAssetIndexFromPackPaths(packPaths);
}

import { createTextureImageCache, decodeImageFromBlob } from './assets/texture-image-cache.js';
import { createFontFaceCache } from './assets/font-face-cache.js';
import { parseLangFile, looksLikeLangKey } from './assets/lang-table.js';
import { createWorkspaceEditor, buildWorkspacePreviewSourceMap, findAuthoredNodeForPreview, escapeSourcePointer, renderWorkspaceSourceEditor, workspaceRecordSourceId, matchesWorkspaceDocument, sameWorkspacePreviewModel, shouldDeferWorkspaceCanvasRender, selectWorkspacePreviewDefinition, keepWorkspacePreviewSourceSelection, workspacePreviewDefinitionIdentity } from './ui/workspace-editor.js';
import { resolvePlannedPreviewNodeIds22, pendingEditDiagnosticSummary22 } from './ui/workspace-preview-feedback22.js';
import { createPackExportSettings } from './ui/pack-export-settings.js';
import { workspaceExportDiagnosticSummary, renderWorkspaceExportReport } from './ui/workspace-export-report.js';
import { buildUiCatalog, findCatalogFile, findAnyCatalogFile, listDefinitionsForFile, listEffectiveDefinitionsForPath } from './engine/ui-catalog.js';
import { mergeRepresentativeCollectionMockData, resolveEffectiveUi } from './engine/effective-ui-resolver.js';
import {
  buildRepresentativeClassicBindingMockData,
  buildRepresentativeClassicCollectionData,
  buildRepresentativeClassicCollections,
  buildRepresentativeClassicResolverVariables,
  buildRepresentativeClassicRuntimeVariableNames,
} from './engine/representative-classic-runtime.js';
import {
  isOpenPreviewProjectionIdentity,
  readPreviewProjectionIdentity,
} from './engine/projection-lifecycle.js';

const routeRoot = document.getElementById("route-root");
const statusText = document.getElementById("status-text");

const store = createAppStore({ debug: false });
// 内部の確定後再投影だけに渡す。UIイベントからの例外許可には使わない。
const STUDIO_INTERNAL_REFRESH21 = Symbol('studio-internal-refresh21');
const applicationClipboardBroker = createClipboardBroker();
let previewTextCopyEpoch = 0;
let previewTextCopySnapshot = null;
let previewTextCopyPrepared = null;
let previewTextCopyFallback = null;
let previewTextCopyRenderRevision = 0;
const previewClipboardIdentities = new WeakMap();
let previewClipboardIdentitySequence = 0;
// Discard preparation immediately, including a change away and back before rendering.
store.subscribe((next, previous) => {
  const id = next.files?.currentFileId, previousId = previous.files?.currentFileId;
  if (id !== previousId || next.files?.byId?.[id] !== previous.files?.byId?.[previousId]
    || next.pack !== previous.pack || next.preview?.mockData !== previous.preview?.mockData
    || next.ui?.previewLocale !== previous.ui?.previewLocale
    || next.ui?.previewFontProfile !== previous.ui?.previewFontProfile
    || next.editor?.selection?.nodeId !== previous.editor?.selection?.nodeId
    || next.ui?.tabs?.center !== previous.ui?.tabs?.center) {
    previewTextCopyEpoch += 1;
    previewTextCopySnapshot = null; previewTextCopyPrepared = null; previewTextCopyFallback = null;
    refreshPreviewTextCopyControls();
  }
});

/* --- S020: global diagnostics collector -------------------------------- */

const diagnostics = createDiagnosticsStore({ maxEntries: 800 });
// Install window error/unhandledrejection hooks and expose a global bridge
// used by lower-level utilities (event-bus/store) to report swallowed errors.
diagnostics.installGlobalHandlers();

// S066: opt-in, bounded collection for site real-device verification.
// Merely installing the helper collects nothing. The operator must explicitly
// call start(), then stop() and copy()/download() after the scripted scenario.
const siteDiagnosticSession = createSiteDiagnosticSession({
  appVersion: 'unversioned',
  maxBytes: 512 * 1024,
  diagnosticsStore: diagnostics,
  store,
  clipboardWriteText: text => applicationClipboardBroker.runExclusive(() => {
    if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('SITE_DIAG_CLIPBOARD_UNAVAILABLE');
    return navigator.clipboard.writeText(text);
  }),
});
siteDiagnosticSession.installGlobalHelper();

const log = createLogger(diagnostics, 'main');
log.info('Diagnostics initialized', { step: 'S020', maxEntries: 800 });

/* --- S021: i18n (JP/EN) ------------------------------------------------ */

const i18n = createI18n({
  defaultLocale: 'ja_JP',
  supportedLocales: ['en_US', 'ja_JP'],
  // main.js is served from /src/. Resolve locales from there to /app/locales/.
  localeBaseUrl: new URL('../app/locales/', import.meta.url),
  storageKey: 'jsonui.locale',
  onMissingKey: (key, locale) => {
    diagnostics.log('warn', `Missing translation key: ${String(key)}`, {
      source: 'i18n',
      data: { key, locale },
    });
  },
  onLoadError: (err, ctx) => {
    diagnostics.captureError(err, {
      source: 'i18n',
      message: 'Failed to load locale table',
      data: ctx,
    });
  },
});

/**
 * Resolve editor-owned static resources against this module, not the document.
 * The editor can be mounted at the site root while its immutable assets remain
 * below `/studio/`; document-relative URLs would silently escape that subtree.
 *
 * @param {string} relativePath
 */
function editorResourceUrl(relativePath) {
  return new URL(relativePath, import.meta.url).toString();
}

/**
 * Translation helper used throughout UI rendering.
 * @param {string} key
 * @param {Record<string, any>} [params]
 */
function t(key, params) {
  return i18n.t(key, params);
}

/* --- S038: command system + global keyboard shortcuts ------------------ */

const commandSystem = createCommandSystem({
  onError: (err, info) => {
    try {
      diagnostics.captureError(err, {
        source: 'commands',
        message: `Command failed: ${String(info?.commandId || 'UNKNOWN')}`,
        data: info || null,
      });
    } catch {
      // ignore
    }
  },
});

const PANEL_DEFAULT_LEFT_PX = 288;
const PANEL_DEFAULT_RIGHT_PX = 308;

const panelToggleState = {
  lastLeftPx: PANEL_DEFAULT_LEFT_PX,
  lastRightPx: PANEL_DEFAULT_RIGHT_PX,
};

// The left pane is intentionally a single scroll region. Preserve its
// position across the app's full DOM re-renders so expanding a section or
// changing panel width does not throw the user back to the top.
const leftPaneScrollState = {
  scrollTop: 0,
};

// Transient navigation preferences; pack contents are never stored here.
const workspaceNavigationState = {
  file: { query: '', page: 0 },
  definition: { query: '', page: 0 },
  advanced: { open: false },
  detailedEditor: false,
};

function registerDefaultCommands() {
  commandSystem.register({
    id: 'focus.workspaceFileSearch',
    titleKey: 'cmd.focus.treeSearch.title',
    descriptionKey: 'cmd.focus.treeSearch.desc',
    shortcuts: ['Mod+K'], allowRepeat: false, allowInTextInput: true,
    isEnabled: (ctx) => ctx?.store?.getState?.().ui?.route === 'editor',
    run: () => focusStudioNavigation23({ select: true }),
  });
  // Focus: Tree search
  commandSystem.register({
    id: 'focus.treeSearch',
    titleKey: 'cmd.focus.treeSearch.title',
    descriptionKey: 'cmd.focus.treeSearch.desc',
    shortcuts: ['Mod+F'],
    allowRepeat: false,
    allowInTextInput: true,
    isEnabled: (ctx) => {
      const r = ctx?.store?.getState?.().ui?.route || '';
      return String(r) === 'editor';
    },
    run: (_ctx) => {
      focusTreeSearchInput({ select: true });
    },
  });

  // Edit: delete selected node
  commandSystem.register({
    id: 'edit.deleteSelection',
    titleKey: 'cmd.edit.delete.title',
    descriptionKey: 'cmd.edit.delete.desc',
    shortcuts: ['Delete', 'Backspace'],
    allowRepeat: false,
    allowInTextInput: false,
    isEnabled: (ctx) => {
      const s = ctx?.store?.getState?.();
      if (!s) return false;
      if (String(s.ui?.route || '') !== 'editor') return false;
      const fileId = s.files?.currentFileId;
      const nodeId = s.editor?.selection?.nodeId;
      const file = s.files.byId[fileId];
      if (file?.meta?.previewProjection) return sourceWorkspace.state.mode === 'edit' && !sourceWorkspace.state.busy
        && Boolean(nodeId || getCanvasState(getCanvasKey(fileId)).pendingAdditionSelection23);
      return Boolean(fileId && nodeId);
    },
    run: (ctx) => {
      const s = ctx.store.getState();
      const fileId = s.files.currentFileId;
      const nodeId = s.editor?.selection?.nodeId;
      if (!fileId) return;
      const file = s.files.byId[fileId];
      if (file?.meta?.previewProjection) return studioDelete31();
      applyTreeDelete(String(fileId), String(nodeId));
    },
  });

  for (const [direction, shortcuts] of [['undo', ['Mod+Z']], ['redo', ['Mod+Y', 'Mod+Shift+Z']]]) {
    commandSystem.register({ id: `edit.workspace.${direction}`, titleKey: 'cmd.edit.delete.title', shortcuts, allowRepeat: false, allowInTextInput: false,
      isEnabled: () => { const ws=sourceWorkspace.state; return store.getState().ui.route==='editor' && ws.mode==='edit' && !ws.busy
        && Boolean(direction==='undo' ? ws.pendingOperations.length || ws.canUndo : ws.pendingRedoOperations.length || ws.canRedo); },
      run: () => sourceWorkspace.history(direction) });
  }

  // Edit: duplicate selected node
  commandSystem.register({
    id: 'edit.duplicateSelection',
    titleKey: 'cmd.edit.duplicate.title',
    descriptionKey: 'cmd.edit.duplicate.desc',
    shortcuts: ['Mod+Alt+D'],
    allowRepeat: false,
    allowInTextInput: false,
    isEnabled: (ctx) => {
      const s = ctx?.store?.getState?.();
      if (!s) return false;
      if (String(s.ui?.route || '') !== 'editor') return false;
      const fileId = s.files?.currentFileId;
      const nodeId = s.editor?.selection?.nodeId;
      return Boolean(fileId && nodeId);
    },
    run: (ctx) => {
      const s = ctx.store.getState();
      const fileId = s.files.currentFileId;
      const nodeId = s.editor?.selection?.nodeId;
      if (!fileId || !nodeId) return;
      applyTreeDuplicate(String(fileId), String(nodeId));
    },
  });

  // Canvas: zoom in/out
  commandSystem.register({
    id: 'canvas.zoomIn',
    titleKey: 'cmd.canvas.zoomIn.title',
    descriptionKey: 'cmd.canvas.zoomIn.desc',
    shortcuts: ['Mod+Alt+=', 'Mod+Alt+NumpadAdd'],
    allowRepeat: true,
    allowInTextInput: false,
    isEnabled: (ctx) => {
      const s = ctx?.store?.getState?.();
      if (!s) return false;
      if (String(s.ui?.route || '') !== 'editor') return false;
      return Boolean(s.files?.currentFileId);
    },
    run: (ctx) => {
      zoomCanvasFromCommand(ctx, 1.15);
    },
  });

  commandSystem.register({
    id: 'canvas.zoomOut',
    titleKey: 'cmd.canvas.zoomOut.title',
    descriptionKey: 'cmd.canvas.zoomOut.desc',
    shortcuts: ['Mod+Alt+-', 'Mod+Alt+NumpadSubtract'],
    allowRepeat: true,
    allowInTextInput: false,
    isEnabled: (ctx) => {
      const s = ctx?.store?.getState?.();
      if (!s) return false;
      if (String(s.ui?.route || '') !== 'editor') return false;
      return Boolean(s.files?.currentFileId);
    },
    run: (ctx) => {
      zoomCanvasFromCommand(ctx, 1 / 1.15);
    },
  });

  // UI: toggle panels
  commandSystem.register({
    id: 'ui.toggleLeftPanel',
    titleKey: 'cmd.ui.toggleLeftPanel.title',
    descriptionKey: 'cmd.ui.toggleLeftPanel.desc',
    shortcuts: ['Mod+Alt+1'],
    allowRepeat: false,
    allowInTextInput: false,
    isEnabled: (ctx) => {
      const r = ctx?.store?.getState?.().ui?.route || '';
      return String(r) === 'editor';
    },
    run: (ctx) => {
      toggleLeftPanel(ctx);
    },
  });

  commandSystem.register({
    id: 'ui.toggleRightPanel',
    titleKey: 'cmd.ui.toggleRightPanel.title',
    descriptionKey: 'cmd.ui.toggleRightPanel.desc',
    shortcuts: ['Mod+Alt+2'],
    allowRepeat: false,
    allowInTextInput: false,
    isEnabled: (ctx) => {
      const r = ctx?.store?.getState?.().ui?.route || '';
      return String(r) === 'editor';
    },
    run: (ctx) => {
      toggleRightPanel(ctx);
    },
  });
  registerEditorGroupCommands31(commandSystem, {
    getState: () => ({
      editing: store.getState().ui?.route === 'editor' && sourceWorkspace.state.mode === 'edit' && !!store.getState().files.currentFileId,
      busy: sourceWorkspace.state.busy || sourceWorkspace.state.pendingCommitUncertain || sourceWorkspace.state.pendingConflict,
      modalOpen: !!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'),
      selection: studioSelection21().snapshot(),
    }),
    group: performStudioGroup31, ungroup: performStudioUngroup31,
    notify: message => setStatus(siteText(message)),
  });

}

// Register once at module init.
registerDefaultCommands();

let keyboardShortcutsInstalled = false;

function getCommandContext() {
  return {
    store,
    actions,
    diagnostics,
    t,
  };
}

function installGlobalKeyboardShortcuts() {
  if (keyboardShortcutsInstalled) return;
  keyboardShortcutsInstalled = true;

  window.addEventListener(
    'keydown',
    (ev) => {
      const ctx = getCommandContext();
      const executed = commandSystem.handleKeydown(ev, ctx);
      if (!executed) return;
      // Keep the status bar informative for novice users.
      try {
        const chord = normalizeChordFromEvent(ev);
        const label = chord ? formatChordForDisplay(chord, { style: 'generic' }) : '';
        setStatus(t('status.commandExecuted', { chord: label }));
      } catch {
        // ignore
      }
    },
    { capture: true }
  );
}

function focusTreeSearchInput(opts = {}) {
  focusStudioNavigation23({ tree: true, select: Boolean(opts.select) });
}

/** 検索の入口は表示状態を開き、DOM生成後に現在の入力へ移動する。 */
function focusStudioNavigation23({ tree = false, select = false } = {}) {
  studioUi.leftOpen = true;
  studioUi.leftView26 = tree ? 'advanced' : 'screens';
  if (window.innerWidth <= 900) studioUi.rightOpen = false;
  if (tree) workspaceNavigationState.detailedEditor = true;
  safeRender();
  requestAnimationFrame(() => {
    const input = (tree ? document.getElementById('tree-search-input') : document.getElementById('workspace-file-picker-search'))
      || document.getElementById('resource-pack-file-button');
    input?.focus({ preventScroll: true });
    if (select && typeof input?.select === 'function') input.select();
    input?.scrollIntoView?.({ block: 'nearest' });
  });
}

function zoomCanvasFromCommand(ctx, factor) {
  const s = ctx.store.getState();
  const fileId = s.files?.currentFileId;
  if (!fileId) return;

  const key = getCanvasKey(fileId);
  const activeCenter = String(s.ui?.tabs?.center || 'canvas');

  const doZoom = () => {
    zoomCanvasAtPivotPx(key, factor);
  };

  if (activeCenter !== 'canvas') {
    ctx.store.dispatch(ctx.actions.setEditorTab({ area: 'center', tabId: 'canvas' }));
    // Wait for the canvas element to exist.
    requestAnimationFrame(() => requestAnimationFrame(() => doZoom()));
    return;
  }

  doZoom();
}

function toggleLeftPanel(ctx) {
  studioUi.leftOpen = !studioUi.leftOpen;
  if (studioUi.leftOpen && window.innerWidth <= 900) studioUi.rightOpen = false;
  safeRender();
}

function toggleRightPanel(ctx) {
  studioUi.rightOpen = !studioUi.rightOpen;
  safeRender();
}

/**
 * Update static DOM elements outside route-root (top bar + document title).
 * These are not part of the main render() tree.
 */
function applyI18nToStaticDom() {
  setSiteLocale(i18n.getLocale());
  try {
    const title = t('app.title');
    for (const [selector, key, attribute] of [
      ['.skip-link', 'app.skipToWorkspace', null],
      ['.topnav', 'app.mainMenu', 'aria-label'],
      ['main.main', 'app.workspace', 'aria-label'],
      ['footer.statusbar', 'app.processingStatus', 'aria-label'],
      ['meta[name=description]', 'app.description', 'content'],
    ]) {
      const element = document.querySelector(selector);
      if (element) { if (attribute) element.setAttribute(attribute, t(key)); else element.textContent = t(key); }
    }
    if (statusText) statusText.textContent = translateSiteMessage(statusText.textContent);
    document.title = title;

    const brandTitle = document.querySelector('.brand-title');
    if (brandTitle) brandTitle.setAttribute('aria-label', title);

    const brandSubtitle = document.querySelector('.brand-subtitle');
    if (brandSubtitle) brandSubtitle.textContent = t('app.subtitle');

    const navEditor = document.querySelector('.topnav a[data-route="editor"]');
    if (navEditor) navEditor.textContent = t('nav.editor');

    const navHelp = document.querySelector('.topnav a[data-route="help"]');
    if (navHelp) navHelp.textContent = t('nav.help');

    const navLogs = document.querySelector('.topnav a[data-route="logs"]');
    if (navLogs) navLogs.textContent = t('nav.logs');

    const btn = document.getElementById('btn-lang');
    if (btn) {
      const loc = i18n.getLocale();
      btn.textContent = loc === 'ja_JP' ? '日本語' : 'English';
      const hint = `${t('app.language')}: ${loc}`;
      btn.title = hint;
      btn.setAttribute('aria-label', hint);
    }

    if (document.documentElement) {
      document.documentElement.lang = toBcp47(i18n.getLocale()).toLowerCase();
    }
  } catch {
    // i18n must never crash the app.
  }
}

/**
 * Keep a small in-memory action log for the Debug tab.
 * (Do not store full payloads to avoid holding large objects in memory.)
 * @type {{ tsIso: string, type: string, summary: string }[]}
 */
const actionHistory28 = createActionHistory28();
const actionLog = actionHistory28.entries;

/**
 * Local UI state for the Diagnostics route (S020).
 * (Kept outside the central store for now; later steps may move into the store.)
 */
const diagnosticsUiState = {
  levelFilter: 'all', // 'all'|'debug'|'info'|'warn'|'error'
  sourceFilter: 'all',
  searchQuery: '',
  selectedEntryId: null,
  includeEnvOnExport: false,
  sessionIncludeUserAgent: false,
  sessionCaptureConsole: false,
  sessionStatusMessage: '',
};

/* --- S018: ZIP demo state (About page) ---------------------------------- */

let zipDemoReader = new ZipReader();
let zipDemoLoadGeneration = 0;
let zipDemoPreviewGeneration = 0;

/**
 * @type {{
 *   status: 'idle'|'loading'|'ready'|'error',
 *   error: string|null,
 *   meta: import('./pack-io/zip-reader.js').ZipListingMeta|null,
 *   entries: import('./pack-io/zip-reader.js').ZipEntryInfo[],
 *   warnings: import('./pack-io/zip-reader.js').ZipWarning[],
 *   truncated: boolean,
 *   selectedPath: string|null,
 *   previewText: string|null,
 *   previewError: string|null,
 * }}
 */
const zipDemoState = {
  status: 'idle',
  error: null,
  meta: null,
  entries: [],
  warnings: [],
  truncated: false,
  selectedPath: null,
  previewText: null,
  previewError: null,
};

/* --- S025: Imported pack runtime (kept outside store) ------------------- */

/**
 * Runtime-only handle to the currently imported ZIP.
 * (Keep the ZipReader instance out of the serializable store state.)
 *
 * @type {null|{
 *  zipReader: ZipReader,
 *  rootPrefix: string,
 *  packPaths: string[],
 *  manifestZipPath: string,
 *  overridesTextByPackPath: Record<string, string>,
 *  assetIndex?: import('./assets/asset-indexer.js').AssetIndex,
 *  assetIndexSummary?: any,
 *  observedUiScale?: number,
 *  uiScaleCalibrationSource?: string,
 * }}
 */
let importedPackRuntime = null;
const DEFAULT_DEVICE_PRESET_KEY = '1920x1080';
const DEVICE_CANVAS_PRESETS = Object.freeze({
  '1280x720': Object.freeze({ width: 1280, height: 720, name: 'HD 1280×720' }),
  '1920x1080': Object.freeze({ width: 1920, height: 1080, name: 'Full HD 1920×1080' }),
  '2560x1440': Object.freeze({ width: 2560, height: 1440, name: 'QHD 2560×1440' }),
  '3840x2160': Object.freeze({ width: 3840, height: 2160, name: '4K 3840×2160' }),
});

let importedPackLoadGeneration = 0;
let importedPackLoadAbortController = null;
let pendingAddonSelection38 = null;
const importedPackLoadProgress = {
  phase: 'idle',
  processed: 0,
  total: null,
};

/* --- S040/S066: Vanilla reference ZIP + asset lookup/readiness audit ---- */

/**
 * Runtime-only handle to a Vanilla reference ZIP uploaded by the user.
 *
 * This enables Vanilla-first asset resolution without network access.
 *
 * @type {null|{
 *  zipReader: ZipReader,
 *  rootPrefix: string,
 *  packPaths: string[],
 *  manifestZipPath: string,
 *  fileName: string,
 *  warnings: { code: string, message: string }[],
 *  assetIndex?: import('./assets/asset-indexer.js').AssetIndex,
 *  assetIndexSummary?: any,
 *  audit?: any,
 * }}
 */
let vanillaReferenceRuntime = null;
let vanillaReferenceLoadGeneration = 0;
let vanillaReferenceLoadAbortController = null;

/**
 * UI state for the Vanilla reference ZIP uploader. A structurally usable pack
 * with unknown/mismatched provenance remains `warning`, not `ready`.
 * @type {{ status: 'idle'|'loading'|'ready'|'warning'|'error', error: string|null, audit: any, expectedBedrockVersion: string, sourceRelease: string, expectedChannel: 'stable'|'preview', sourceChannel: 'stable'|'preview' }}
 */
const vanillaReferenceUiState = {
  status: 'idle',
  error: null,
  audit: null,
  expectedBedrockVersion: '',
  sourceRelease: '',
  expectedChannel: 'stable',
  sourceChannel: 'stable',
};

/**
 * Debug-only state for asset lookup (S040).
 * @type {{ textureRefInput: string, lastTextureResult: any }}
 */
const assetLookupState = {
  textureRefInput: 'ui/test',
  lastTextureResult: null,
};

/**
 * Mock-data editor UI state (S045).
 * Kept outside the app store to avoid full-app rerenders on every keystroke.
 *
 * Notes:
 * - No persistence beyond session (in-memory only).
 * - Debounced apply updates the store, which triggers a preview re-render.
 */

/**
 * @typedef {'boolean'|'number'|'string'|'json'} MockDataValueType
 */

/**
 * @typedef {{
 *   id: string,
 *   keyText: string,
 *   type: MockDataValueType,
 *   boolValue?: boolean,
 *   valueText?: string,
 *   error?: string|null,
 * }} MockDataRow
 */

let mockDataRowIdSeq = 1;
function makeMockDataRowId() {
  return `md_${mockDataRowIdSeq++}`;
}

/** @param {any} value @returns {MockDataValueType} */
function inferMockDataValueType(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'json';
}

/** @param {string} key @param {any} value @returns {MockDataRow} */
function makeMockDataRowFromKV(key, value) {
  const type = inferMockDataValueType(value);

  if (type === 'boolean') {
    return { id: makeMockDataRowId(), keyText: String(key), type, boolValue: Boolean(value), error: null };
  }

  if (type === 'number') {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
    const txt = Number.isFinite(n) ? String(n) : String(value ?? '');
    return { id: makeMockDataRowId(), keyText: String(key), type, valueText: txt, error: null };
  }

  if (type === 'string') {
    return { id: makeMockDataRowId(), keyText: String(key), type, valueText: String(value ?? ''), error: null };
  }

  // json (object/array/null)
  let jsonText = '';
  try {
    jsonText = stableStringify(value, { indent: 2, sortKeys: true, finalNewline: false });
  } catch {
    jsonText = String(value ?? '');
  }
  return { id: makeMockDataRowId(), keyText: String(key), type: 'json', valueText: jsonText, error: null };
}

/** @param {Record<string, any>} obj @returns {MockDataRow[]} */
function makeMockDataRowsFromObject(obj) {
  const o = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  const keys = Object.keys(o).sort((a, b) => String(a).localeCompare(String(b)));
  return keys.map((k) => makeMockDataRowFromKV(k, o[k]));
}

function serializeMockDataForCompare(obj) {
  try {
    return stableStringify(obj || {}, { indent: 0, sortKeys: true, finalNewline: false });
  } catch {
    try {
      return JSON.stringify(obj || {});
    } catch {
      return String(obj || '');
    }
  }
}

function pickResolverCompositionData(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    variables: Object.fromEntries(Object.entries(input).filter(([key]) => key.startsWith('$')).sort(([a], [b]) => a.localeCompare(b))),
    // The resolver reads collection count and factory selectors only. Values
    // such as item textures, labels and progress are evaluated by Node bindings.
    collections: buildRepresentativeClassicCollections({ collectionData: input.__collections || {} }),
    eventFactorySelections: input.__event_factory_selections || {},
  };
}

let projectionRefreshRequestedRevision = 0;
let projectionRefreshAppliedRevision = 0;
let projectionRefreshRunning = false;
const projectionRefreshWaiters = [];

function settleProjectionRefreshWaiters(appliedRevision, result) {
  for (let index = projectionRefreshWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = projectionRefreshWaiters[index];
    if (waiter.revision > appliedRevision) continue;
    projectionRefreshWaiters.splice(index, 1);
    waiter.resolve(result);
  }
}

function requestProjectionRefreshAfterCompositionChange() {
  projectionRefreshRequestedRevision += 1;
  const revision = projectionRefreshRequestedRevision;
  const promise = new Promise((resolve) => {
    projectionRefreshWaiters.push({ revision, resolve });
  });
  drainProjectionRefreshQueue();
  return promise;
}

function scheduleProjectionRefreshAfterMockChange() {
  void requestProjectionRefreshAfterCompositionChange();
}

function drainProjectionRefreshQueue() {
  if (projectionRefreshRunning
    || projectionRefreshAppliedRevision >= projectionRefreshRequestedRevision
    || screenOpenState?.status === 'loading') return;
  projectionRefreshRunning = true;
  queueMicrotask(async () => {
    let attemptedRevision = projectionRefreshAppliedRevision;
    try {
      while (projectionRefreshAppliedRevision < projectionRefreshRequestedRevision) {
        if (screenOpenState?.status === 'loading') break;
        const targetRevision = projectionRefreshRequestedRevision;
        attemptedRevision = targetRevision;
        const result = importedPackRuntime
          ? await rebuildOpenPreviewProjections()
          : null;
        if (result?.code === 'UI_OPEN_SUPERSEDED') break;
        projectionRefreshAppliedRevision = targetRevision;
        settleProjectionRefreshWaiters(targetRevision, result);
      }
    } catch (error) {
      // Mark only the failed snapshot as handled. A newer revision remains
      // queued and is retried after this turn instead of being discarded.
      projectionRefreshAppliedRevision = Math.max(projectionRefreshAppliedRevision, attemptedRevision);
      settleProjectionRefreshWaiters(projectionRefreshAppliedRevision, {
        ok: false,
        code: 'UI_PROJECTION_REFRESH_FAILED',
        error: error instanceof Error ? error.message : String(error || 'UI_PROJECTION_REFRESH_FAILED'),
      });
      diagnostics.captureError(error, {
        source: 'ui-catalog',
        message: 'Preview resolver refresh after mock-data composition change failed',
      });
    } finally {
      projectionRefreshRunning = false;
      if (projectionRefreshAppliedRevision < projectionRefreshRequestedRevision
        && screenOpenState?.status !== 'loading') {
        queueMicrotask(drainProjectionRefreshQueue);
      }
    }
  });
}

/**
 * Local UI state for the mock-data editor panel (no persistence; in-memory only).
 */
const mockDataUiState = {
  /** @type {MockDataRow[]} */
  rows: makeMockDataRowsFromObject({ "#example_visible": true }),
  /** @type {string|null} */
  error: null,
  lastSyncedVersion: -1,
  /** @type {any} */
  pendingApplyTimer: null,
  debounceMs: 350,
  lastAppliedSerialized: '',
  /** @type {string|null} */
  lastImportError: null,
};

function syncMockDataUiFromStore(mockData, version) {
  const v = Number(version) || 0;
  if (mockDataUiState.lastSyncedVersion === v) return;
  mockDataUiState.rows = makeMockDataRowsFromObject(mockData);
  mockDataUiState.error = null;
  mockDataUiState.lastImportError = null;
  mockDataUiState.lastSyncedVersion = v;
  mockDataUiState.lastAppliedSerialized = serializeMockDataForCompare(mockData);
}

function clearPendingMockDataApply() {
  if (!mockDataUiState.pendingApplyTimer) return;
  try { clearTimeout(mockDataUiState.pendingApplyTimer); } catch { /* ignore */ }
  mockDataUiState.pendingApplyTimer = null;
}

function scheduleMockDataApply(opts = {}) {
  assertStudioExternalChange21('プレビュー状態の変更');
  const immediate = Boolean(opts.immediate);
  clearPendingMockDataApply();

  if (immediate) {
    applyMockDataNow();
    return;
  }

  const msRaw = Number(mockDataUiState.debounceMs) || 0;
  const ms = Math.min(2000, Math.max(80, msRaw));

  mockDataUiState.pendingApplyTimer = setTimeout(() => {
    mockDataUiState.pendingApplyTimer = null;
    try { applyMockDataNow(); } catch (error) { reportWorkspaceError(error); }
  }, ms);
}

/**
 * Apply current UI rows to the app store (debounced).
 * Partial validity is allowed: invalid rows keep their last applied values.
 */
function applyMockDataNow() {
  assertStudioExternalChange21('プレビュー状態の適用');
  const s = store.getState();
  const baseVersion = s.preview ? Number(s.preview.mockDataVersion) || 0 : 0;
  const base = s.preview && s.preview.mockData && typeof s.preview.mockData === 'object' && !Array.isArray(s.preview.mockData)
    ? s.preview.mockData
    : {};

  /** @type {Record<string, any>} */
  const next = {};
  const seen = new Set();
  let errorCount = 0;

  for (const row of mockDataUiState.rows) {
    if (row) row.error = null;
  }

  for (const row of mockDataUiState.rows) {
    const key = String(row.keyText ?? '').trim();
    if (!key) continue;

    if (seen.has(key)) {
      row.error = 'Duplicate key';
      errorCount++;
      continue;
    }
    seen.add(key);

    if (row.type === 'boolean') {
      next[key] = Boolean(row.boolValue);
      continue;
    }

    if (row.type === 'number') {
      const n = Number(String(row.valueText ?? '').trim());
      if (!Number.isFinite(n)) {
        row.error = 'Invalid number';
        errorCount++;
        if (Object.prototype.hasOwnProperty.call(base, key)) next[key] = base[key];
        continue;
      }
      next[key] = n;
      continue;
    }

    if (row.type === 'string') {
      next[key] = String(row.valueText ?? '');
      continue;
    }

    // json
    const txt = String(row.valueText ?? '');
    const res = parseJsonc(txt, { fileName: `mockData:${key}`, allowTrailingComma: true, allowEmptyContent: true });
    if (!res.ok) {
      row.error = res.errors && res.errors.length ? String(res.errors[0].message || 'Invalid JSON') : 'Invalid JSON';
      errorCount++;
      if (Object.prototype.hasOwnProperty.call(base, key)) next[key] = base[key];
      continue;
    }
    next[key] = res.value;
  }

  mockDataUiState.error = errorCount > 0
    ? `Some rows have errors. Invalid rows keep their last applied values. (${errorCount})`
    : null;

  const baseSer = mockDataUiState.lastAppliedSerialized || serializeMockDataForCompare(base);
  const nextSer = serializeMockDataForCompare(next);
  const changed = baseSer !== nextSer;
  if (!changed) {
    // No store update means no store-driven render. Re-render to show validation errors, if any.
    safeRender();
    return;
  }

  // Preemptively set lastSyncedVersion to avoid resync overwriting user edits during the store-driven render.
  mockDataUiState.lastSyncedVersion = baseVersion + 1;
  mockDataUiState.lastAppliedSerialized = nextSer;
  store.dispatch(actions.setMockData(next));
  // store.subscribe triggers safeRender()
}

/**
 * Commit debounced preview inputs before an export snapshot is captured.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function flushPendingPreviewInputsForExport() {
  try {
    if (mockDataUiState.pendingApplyTimer) {
      clearPendingMockDataApply();
      applyMockDataNow();
    }
    const activeOverlay = previewEditBoxOverlayState.active;
    if (activeOverlay?.pendingTimer) commitPreviewEditBoxMockDataNow();
  } catch (error) {
    return { ok: false, error: `Pending preview input could not be committed: ${String(error?.message || error)}` };
  }
  if (mockDataUiState.error) {
    return { ok: false, error: `Preview mock data contains invalid pending input: ${mockDataUiState.error}` };
  }
  return { ok: true };
}



/* --- S046: Screen navigation simulator (stack + action mapping) --------- */

/**
 * UI state for navigation mapping controls (kept outside store).
 * @type {{
 *   newActionId: string,
 *   newTargetPackPath: string,
 *   lastResolution: any,
 * }}
 */
const navigationUiState = {
  newActionId: '',
  newTargetPackPath: '',
  newTargetDefinition: '',
  newSourceScope: 'current',
  newPresentation: 'screen',
  lastResolution: null,
};

/**
 * Read navigation state from the app store, with safe defaults.
 * @param {import('./state-store/app-store.js').AppState} state
 * @returns {{ enabled: boolean, stack: string[], index: number, actionMap: Record<string, string> }}
 */
function getPreviewNavigationStateFrom(state) {
  const nav = state.preview && state.preview.navigation && typeof state.preview.navigation === 'object'
    ? state.preview.navigation
    : null;

  return {
    enabled: Boolean(nav && nav.enabled),
    stack: Array.isArray(nav && nav.stack) ? nav.stack : [],
    index: Number.isFinite(nav && nav.index) ? Number(nav.index) : -1,
    actionMap: nav && nav.actionMap && typeof nav.actionMap === 'object' ? nav.actionMap : {},
  };
}

/** @param {string} fileId @returns {string|null} */
function screenFileIdToPackPath(fileId) {
  if (typeof fileId !== 'string') return null;
  if (!fileId.startsWith('screen:')) return null;
  return fileId.slice('screen:'.length);
}

/** @param {string} packPath @returns {string} */
function makeScreenFileId(packPath) {
  return `screen:${packPath}`;
}

/**
 * @param {import('./state-store/app-store.js').AppState} state
 * @returns {string[]}
 */
const availableScreenPathCache = createUiScreenPathCache();
function listAvailableScreenPackPaths(state) {
  return availableScreenPathCache.get(state.pack?.imported?.packPaths, vanillaReferenceRuntime?.packPaths, resourcePackMutationEpoch);
}

/** @param {any} uiNode */
function* walkUiNodes(uiNode) {
  if (!uiNode || typeof uiNode !== 'object') return;
  yield uiNode;
  const children = Array.isArray(uiNode.children) ? uiNode.children : [];
  for (const c of children) {
    yield* walkUiNodes(c);
  }
}

/** @param {any} uiNode @returns {string[]} */
function extractButtonActionIds(uiNode) {
  /** @type {string[]} */
  const out = [];
  if (!uiNode || typeof uiNode !== 'object') return out;

  const unknown = uiNode.unknownProps && typeof uiNode.unknownProps === 'object' ? uiNode.unknownProps : {};

  // Primary: button_mappings[].to_button_id (Bedrock JSON UI)
  const mappings = Array.isArray(unknown.button_mappings) ? unknown.button_mappings : [];
  for (const m of mappings) {
    if (!m || typeof m !== 'object') continue;
    const toId = m.to_button_id ?? m.to_buttonId ?? m.to_button ?? m.to ?? null;
    if (typeof toId === 'string' && toId.trim()) out.push(toId.trim());
  }

  // Secondary: some packs place action-like identifiers on the node itself.
  const directKeys = ['button_id', 'buttonId', 'button_name', 'buttonName', 'action', 'actionId', 'navigate_to', 'navigateTo'];
  for (const k of directKeys) {
    const v = unknown[k];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }

  // De-dup while preserving order.
  const seen = new Set();
  /** @type {string[]} */
  const deduped = [];
  for (const a of out) {
    const key = String(a);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(key);
  }
  return deduped;
}

/** @param {any} uiRoot @param {string} nodeId @returns {any|null} */
function findUiNodeById(uiRoot, nodeId) {
  const target = String(nodeId);
  for (const n of walkUiNodes(uiRoot)) {
    if (!n || typeof n !== 'object') continue;
    if (String(n.id) === target) return n;
  }
  return null;
}

function normalizeActionIdForMatching(actionId) {
  const a = String(actionId || '').trim();
  if (!a) return '';
  if (a.startsWith('button.')) return a.slice('button.'.length);
  return a;
}

function isLikelyScreenPath(text) {
  const t = String(text || '');
  return t.includes('/') && (t.toLowerCase().endsWith('.json') || t.toLowerCase().endsWith('.jsonc'));
}

/**
 * Best-effort mapping from button action ids -> screen file id.
 * Priority:
 *  1) Explicit mapping in store (preview.navigation.actionMap)
 *  2) Direct "screen:ui/..." or "ui/...json" style hints
 *  3) Match against already-open screen root keys
 *  4) Filename-based match against available ui/*.json screens
 *
 * @param {string[]} actionIds
 * @param {import('./state-store/app-store.js').AppState} state
 * @returns {{ fileId: string, reason: string, matchedActionId?: string }|null}
 */
function resolveScreenNavigationTarget(actionIds, state) {
  const nav = state.preview && state.preview.navigation && typeof state.preview.navigation === 'object'
    ? state.preview.navigation
    : null;

  const actionMap = nav && nav.actionMap && typeof nav.actionMap === 'object' ? nav.actionMap : {};

  // 1) Explicit action mapping
  for (const a of actionIds) {
    const mapped = actionMap[String(a)];
    if (typeof mapped === 'string' && mapped.trim()) {
      return { fileId: mapped.trim(), reason: 'explicit-mapping', matchedActionId: String(a) };
    }
  }

  // Prepare indices for heuristic matching
  const availableScreens = listAvailableScreenPackPaths(state);
  const availableByBase = new Map();
  for (const p of availableScreens) {
    const base = (p.split('/').pop() || '').replace(/\.jsonc?$/i, '');
    availableByBase.set(base.toLowerCase(), p);
  }

  /** @type {Record<string, string>} */
  const openScreenKeyToFileId = {};
  const openIds = state.files && Array.isArray(state.files.openFileIds) ? state.files.openFileIds : [];
  for (const fid of openIds) {
    const f = state.files && state.files.byId ? state.files.byId[fid] : null;
    if (!f || f.kind !== 'screen') continue;
    const roots = f.meta && f.meta.uiModelSummary && Array.isArray(f.meta.uiModelSummary.rootChildren)
      ? f.meta.uiModelSummary.rootChildren
      : [];
    for (const r of roots) {
      if (!r || typeof r !== 'object') continue;
      const k = String(r.key || '').trim();
      if (!k) continue;
      openScreenKeyToFileId[k] = f.id;
    }
  }

  // 2) Direct screen file id/path hints
  for (const a of actionIds) {
    const raw = String(a || '').trim();
    if (!raw) continue;

    if (raw.startsWith('screen:')) {
      const p = raw.slice('screen:'.length);
      if (availableScreens.includes(p)) return { fileId: makeScreenFileId(p), reason: 'direct-screen-fileid', matchedActionId: raw };
    }

    if (isLikelyScreenPath(raw) && availableScreens.includes(raw)) {
      return { fileId: makeScreenFileId(raw), reason: 'direct-path', matchedActionId: raw };
    }
  }

  // 3) Match open screen root key
  for (const a of actionIds) {
    const key = normalizeActionIdForMatching(a);
    if (!key) continue;
    const hit = openScreenKeyToFileId[key];
    if (hit) return { fileId: hit, reason: 'open-root-key-match', matchedActionId: String(a) };
  }

  // 4) Filename-based match
  for (const a of actionIds) {
    const base = normalizeActionIdForMatching(a).toLowerCase();
    if (!base) continue;

    const exact = availableByBase.get(base);
    if (exact) return { fileId: makeScreenFileId(exact), reason: 'filename-exact', matchedActionId: String(a) };

    // fuzzy: find first screen basename containing the action id
    const fuzzy = availableScreens.find((p) => (p.split('/').pop() || '').toLowerCase().includes(base));
    if (fuzzy) return { fileId: makeScreenFileId(fuzzy), reason: 'filename-fuzzy', matchedActionId: String(a) };
  }

  return null;
}

/**
 * Ensure the target screen file is opened (loading it from pack if needed),
 * then set it as current file.
 *
 * @param {string} fileId
 * @returns {Promise<boolean>}
 */
async function ensureScreenFileOpen(fileId, definition = null, options = {}) {
  assertStudioProjectionChange21(options);
  const requested = normalizeScreenRef(fileId, definition || '');
  const fid = makeScreenFileId(requested.packPath);
  if (typeof options.canCommit === 'function' && !options.canCommit()) return false;
  const catalog = uiCatalogState.status === 'ready' ? uiCatalogState.catalog : await requestUiCatalogBuild('navigation');
  if (typeof options.canCommit === 'function' && !options.canCommit()) return false;
  if (!catalog || catalog !== uiCatalogState.catalog) throw new Error('UI_CATALOG_UNAVAILABLE');
  const resolved = resolveScreenRef(requested, listEffectiveDefinitionsForPath(catalog, requested.packPath), uiCatalogState.generation);
  const winnerId = catalog.symbols?.[resolved.qualifiedName]?.winnerId;
  if (winnerId && winnerId !== resolved.recordId) throw new Error('UI_NAVIGATION_PATH_MISMATCH');
  options.onResolved?.(resolved);
  const state = store.getState();
  const existing = state.files && state.files.byId ? state.files.byId[fid] : null;
  if (existing && state.files.openFileIds.includes(fid)
    && existing.meta?.navigationCatalogGeneration === resolved.catalogGeneration
    && existing.meta?.selectedDefinition?.recordId === resolved.recordId
    && getSelectedPreviewQualifiedName(existing) === resolved.qualifiedName) {
    if (options.prepareOnly) return { ok: true, file: existing, screenRef: normalizeScreenRef(resolved), resolved };
    if (typeof options.onBeforeCommit === 'function') options.onBeforeCommit();
    const reopenedCanvas = getCanvasState(getCanvasKey(fid));
    if (reopenedCanvas.previewClosed) ensureLocalToggleSession40(reopenedCanvas, existing, true);
    reopenedCanvas.previewClosed = false;
    dispatchStudioProjection21(actions.setCurrentFile(fid), options);

    const packPath = existing.kind === 'screen' ? existing.path : screenFileIdToPackPath(fid);
    if (packPath) {
      // Keep the screen picker in sync even if the file was already open.
      screenOpenState.selectedPath = packPath;
      screenOpenState.lastOpenedPath = packPath;
      screenOpenState.lastOpenedAtIso = new Date().toISOString();
      screenOpenState.status = 'ready';
      screenOpenState.error = null;
    }

    return true;
  }

  const res = await openUiScreenFromImportedPack(resolved.packPath, resolved.recordId, options);
  if (options.prepareOnly) return res?.ok ? { ...res, screenRef: normalizeScreenRef(resolved), resolved } : res;
  return Boolean(res && res.ok);
}

/**
 * Navigate to a screen and update the navigation history stack.
 *
 * @param {string} fileId
 * @param {'reset'|'push'|'setIndex'} mode
 * @param {number=} index
 */
async function navigateToScreenFile(fileId, mode, index, definition = null) {
  const state = store.getState(), origin = state.files.byId[state.files.currentFileId];
  try {
    return await navigatePreviewEffect({ screenRef: typeof fileId === 'object' ? normalizeNavigationEntry(fileId) : normalizeScreenRef(fileId, definition || ''), historyMode: mode, historyIndex: index, toolbar: true }, origin);
  } catch (error) { setStatus(siteText`遷移できません: ${translateSiteMessage(describeScreenNavigationError(error))}`); return false; }
}
// 0.6: 操作の状態更新は描画・入力・ドラッグから共通経路へ集約する。
let previewAudioPlayer = null;
const previewInputTrace = createPreviewObservationTrace();
let previewAudioEnabled = true;
let previewAudioLastResult = null;
let previewAudioPackIdentity = null;
let previewAudioPackEpoch = 0;
let previewAudioSequence = 0;
let previewAudioPreparation = null;
function syncPreviewAudioPack() {
  const id = uiCatalogState.catalog?.nodeCatalogId || null;
  const prior = previewAudioPackIdentity;
  if (!prior || prior.imported !== importedPackRuntime || prior.vanilla !== vanillaReferenceRuntime
    || prior.catalogId !== id || prior.mutation !== resourcePackMutationEpoch) {
    previewAudioPackIdentity = { imported: importedPackRuntime, vanilla: vanillaReferenceRuntime, catalogId: id, mutation: resourcePackMutationEpoch };
    previewAudioPackEpoch += 1;
    previewAudioPreparation = null;
    previewAudioPlayer?.setPackEpoch(previewAudioPackEpoch);
  }
  return previewAudioPackEpoch;
}
function getPreviewAudioPlayer() {
  if (!previewAudioPlayer) {
    previewAudioPlayer = createUiAudioPlayer({ onDiagnostic: result => {
      // Preparation is silent background work, not an action result.
      if (result.code === 'AUDIO_PREPARED' || result.code === 'AUDIO_NOT_REQUESTED') return;
      previewAudioLastResult = result;
      const element = document.getElementById('preview-audio-status');
      if (element) element.textContent = result.message;
      if (result.status === 'failed') diagnostics.log('info', result.message, { source: 'preview-audio', data: {
        code: result.code, stage: result.stage, soundId: result.soundId, interactionId: result.interactionId,
      } });
    } });
  }
  previewAudioPlayer.setEnabled(previewAudioEnabled && store.getState().preview?.navigation?.enabled === true);
  previewAudioPlayer.setPackEpoch(syncPreviewAudioPack());
  return previewAudioPlayer;
}
function invalidatePreviewAudioForNavigation(interactionId) {
  previewAudioPreparation = null;
  previewAudioPlayer?.invalidate({ reason: 'navigation', interactionId });
}
function buildPreviewAudioIntent(context, target, interactionId) {
  const intent = buildUiAudioIntent({ context, target, interactionId, runtimeDirty: runtimeStateEditor.dirty,
    catalogId: uiCatalogState.catalog?.nodeCatalogId });
  return intent ? { ...intent, packEpoch: syncPreviewAudioPack() } : null;
}
function prepareCurrentPreviewAudio(key) {
  if (!previewAudioEnabled || !uiCatalogState.catalog?.nodeCatalogId) return;
  const context = getInteractionPreviewContext(key), cs = getCanvasState(key);
  if (!context.enabled || context.pocket || runtimeStateEditor.dirty) return;
  const epoch = syncPreviewAudioPack();
  const marker = [context.model, context.state.preview?.mockData, cs.nodeFrameAppliedContext, epoch];
  if (previewAudioPreparation && marker.every((value, index) => value === previewAudioPreparation[index])) return;
  previewAudioPreparation = marker;
  const intents = [], seen = new Set();
  // No pack scan or decode on animation/pointer frames. Only current, bounded frame controls are inspected.
  for (const box of context.boxes.slice(0, 4096)) {
    const target = findUiInteractionTarget(context, box);
    const intent = buildPreviewAudioIntent(context, target, `prepare:${epoch}`);
    if (!intent || seen.has(intent.soundName)) continue;
    if (intent.soundVolume !== undefined && (typeof intent.soundVolume !== 'number' || !Number.isFinite(intent.soundVolume) || intent.soundVolume <= 0)
      || intent.soundPitch !== undefined && (typeof intent.soundPitch !== 'number' || !Number.isFinite(intent.soundPitch) || intent.soundPitch < 0.5 || intent.soundPitch > 2)) continue;
    seen.add(intent.soundName); intents.push(intent);
    if (intents.length >= 8) break;
  }
  if (intents.length) void getPreviewAudioPlayer().prepare(intents);
}
function renderPreviewAudioControls() {
  return h('div', { class: 'preview-audio-controls' }, [
    h('button', { type: 'button', class: 'btn', 'aria-pressed': String(previewAudioEnabled), onClick: event => {
      previewAudioEnabled = !previewAudioEnabled;
      previewAudioPreparation = null;
      previewAudioLastResult = null;
      const player = getPreviewAudioPlayer();
      if (previewAudioEnabled && store.getState().preview?.navigation?.enabled === true) void player.unlock(event);
      safeRender();
    } }, [siteText`効果音: ${previewAudioEnabled ? 'ON' : 'OFF'}`]),
    h('span', { id: 'preview-audio-status', role: 'status', class: 'hint' }, [
      previewAudioEnabled ? previewAudioLastResult?.message || siteText('パック内で指定された短いOGG・PCM16 WAV音声を再生します。') : siteText('プレビュー音声はOFFです。'),
    ]),
  ]);
}
let interactionContextCache = null;
function getInteractionPreviewContext(key = getCanvasKey(store.getState().files.currentFileId)) {
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  const cs = getCanvasState(key), raw = state.preview?.mockData || {};
  const screenDefinition = getSelectedPreviewQualifiedName(file);
  const frameReady = isPreviewInteractionFrameCurrent({ state, file, canvasState: cs, preset: getLogicalCanvasPreset(cs),
    assetMetricsRevision: previewAssetMetricsRevision, nodeFrameAvailability, animationEvent: previewAnimationEvent });
  if (!interactionContextCache || interactionContextCache.model !== file?.uiModel || interactionContextCache.raw !== raw || interactionContextCache.screenDefinition !== screenDefinition) {
    const representative = buildRepresentativeClassicCollections({ qualifiedName: screenDefinition, collectionData: raw.__collections || {} });
    interactionContextCache = { model: file?.uiModel, raw, screenDefinition, clipboardDataSources: buildClipboardDataSources(raw),
      mockData: buildEffectivePreviewMockData(raw, screenDefinition, representative),
      collectionData: buildRepresentativeClassicCollectionData(representative, raw.__collections || {}) };
  }
  return { state, file, model: file?.uiModel, screenDefinition, screenRef: screenRefFromFile(file, cs.previewTopicRootId ? 'topic' : 'screen'),
    clipboardDataSources: interactionContextCache.clipboardDataSources, scope: capturePreviewClipboardScope(),
    enabled: Boolean(!studioRuntimeChangesBlocked21() && !cs.sourceEditing && !cs.sourcePreviewBlocked && frameReady && state.preview?.navigation?.enabled && file && key === getCanvasKey(file.id) && !cs.previewClosed && state.pack?.status !== 'loading' && screenOpenState.status !== 'loading'),
    pocket: /pocket/iu.test(`${file?.path || ''} ${screenDefinition || ''}`) || file?.uiModel?.unknownFields?.$pocket_screen === true,
    mockData: interactionContextCache.mockData, collectionData: interactionContextCache.collectionData,
    uiInstanceId: cs.uiInstanceId, localToggleState: cs.localToggleState,
    bindingDiagnostics: cs.bindingDiagnostics, bindingObservationComplete: cs.bindingObservationComplete,
    propsById: cs.propsByIdOverride || {}, nodesById: file?.nodesById || {}, boxes: cs.layout?.boxes || [],
    actionMap: state.preview?.navigation?.actionMap || {}, availableScreenPaths: listAvailableScreenPackPaths(state) };
}
function commitPreviewInteractionEffects(effects, message = siteText('プレビューの状態を更新しました。'), execution = {}) {
  if ((effects || []).some(effect => ['mockPatch', 'collectionPatch', 'localTogglePatch', 'close', 'navigate'].includes(effect?.type))) assertStudioExternalChange21('プレビュー操作による状態変更');
  const context = getInteractionPreviewContext();
  if (!context.enabled || context.pocket) return false;
  if (runtimeStateEditor.dirty) { setStatus(siteText('状態JSONに未適用の変更があります。適用または破棄してから操作してください。')); return false; }
  const raw = context.state.preview?.mockData || {}, { __collections = {}, ...mockData } = raw;
  const collectionData = { ...__collections };
  const localCanvas = getCanvasState(getCanvasKey(context.file.id));
  let nextLocalState = localCanvas.localToggleState, localChanged = false;
  let changed = false;
  for (const effect of effects || []) {
    if (effect.type === 'mockPatch') { Object.assign(mockData, effect.patch); changed = true; }
    if (effect.type === 'collectionPatch') { Object.assign(collectionData, effect.patch); changed = true; }
    if (effect.type === 'localTogglePatch') {
      const applied = applyLocalTogglePatch(nextLocalState, effect);
      if (!applied.ok) { setStatus(siteText`画面内の状態を更新できません: ${applied.error.code}`); return false; }
      nextLocalState = applied.state; localChanged = true;
    }
  }
  const result = changed ? normalizePreviewState({ mockData, collectionData }) : null;
  const text = changed ? JSON.stringify({ mockData: result.mockData, collectionData: result.collectionData }, null, 2) : null;
  if (text && text.length > 262144) { setStatus(siteText('状態JSONの上限を超えるため、この操作を取り消しました。')); return false; }
  // Validate state before any external effect. Clipboard activation must remain in this trusted event turn.
  if (execution.audioIntent && execution.inputEvent?.isTrusted === true) {
    const player = getPreviewAudioPlayer();
    void player.unlock(execution.inputEvent);
    void player.request(execution.audioIntent);
  }
  for (const effect of effects || []) {
    if (effect.type !== 'clipboardWriteText') continue;
    const ticket = submitPreviewClipboardEffect(effect, execution.inputEvent);
    execution.clipboardStatus = ticket?.status || 'blocked';
  }
  if (changed) {
    runtimeStateEditor.text = text; runtimeStateEditor.dirty = false; runtimeStateEditor.message = message;
    const input = document.getElementById('preview-state-json'); if (input) input.value = text;
    store.dispatch(actions.setMockData({ ...result.mockData, __collections: result.collectionData }));
  }
  if (localChanged) {
    localCanvas.localToggleState = nextLocalState;
    localCanvas.layoutInputKey = null;
    previewAudioPreparation = null;
    ensurePreviewLayout(store.getState());
    scheduledWorkspaceRender.request();
  }
  const key = getCanvasKey(context.file.id), cs = getCanvasState(key);
  for (const effect of effects || []) {
    if (effect.type === 'close') {
      previewAudioPlayer?.invalidate({ reason: 'close', interactionId: execution.interactionId });
      previewAudioPreparation = null;
      cs.previewClosed = true; cancelPreviewPointerInteraction(key);
      hidePreviewEditBoxOverlay('preview-close'); previewPlayback.pause(); stopNativeMotionPreview(); safeRender();
    } else if (effect.type === 'navigate') {
      hidePreviewEditBoxOverlay('navigation');
      void navigatePreviewEffect({ ...effect, interactionId: execution.interactionId }, context.file).catch(error => setStatus(siteText`遷移できません: ${error.message}`));
    } else if (effect.type === 'chooseNavigate') { cs.navigationChoices = effect.candidates; safeRender(); }
  }
  return true;
}
let previewNavigationEpoch = 0;
let pendingPreviewNavigation = null;
async function prepareNavigationFrame(file, ref, state, epoch, signal) {
  const cs = getCanvasState(getCanvasKey(file.id));
  const root = file.uiModel?.root?.children?.[0];
  const topic = ref.presentation === 'topic';
  if (topic && (!TOPIC_DEFINITION.test(ref.qualifiedName) || !root || file.uiModel.root.children.length !== 1)) throw new Error('UI_NAVIGATION_TOPIC_INVALID');
  if (file.uiModel?.unknownFields?.$pocket_screen === true) throw new Error('POCKET_PREVIEW_BLOCKED');
  const uiInstanceId = globalThis.crypto.randomUUID();
  const localToggleState = createLocalToggleState(uiInstanceId);
  const input = { file, generation: epoch, contextRevision: `navigation:${epoch}`, uiInstanceId, localToggleState,
    preset: getLogicalCanvasPreset(cs), qualifiedName: ref.qualifiedName,
    mockData: state.preview?.mockData || {}, collectionData: state.preview?.mockData?.__collections || {},
    propsByIdOverride: topic ? { [root.id]: { visible: true } } : {}, scrollById: { ...(ref.view?.scrollById || {}) },
    visibilityMode: cs.structureMode ? 'structure' : 'safe', animationTime: 0 };
  if (file.meta?.resolution?.nodeProjectionId) {
    const frame = await requestNodeFramePayload(input, { request: payload => renderNodeFrame(payload, signal), prepareFile: prepareNodeFrameFile });
    if (frame?.schema !== 'jsonui-frame-v1' || frame.generation !== epoch || !Array.isArray(frame.layout?.boxes)) throw new Error('UI_NAVIGATION_FRAME_INVALID');
    const checkedState = normalizeLocalToggleState(frame.bindings?.localToggleState, { instanceId: uiInstanceId });
    if (frame.uiInstanceId !== uiInstanceId || !frame.bindings?.localToggleState || !checkedState.ok) throw new Error('UI_NAVIGATION_FRAME_IDENTITY_INVALID');
    return frame;
  }
  const evaluated = evaluateBindingsForUiModel(file.uiModel, { mockData: input.mockData, collectionData: input.collectionData, uiInstanceId, localToggleState });
  const propsById = { ...evaluated.propsById, ...input.propsByIdOverride };
  const layout = computeLayoutBoxesForFile(file, input.preset, { propsByIdOverride: propsById, visibilityMode: input.visibilityMode });
  if (!Array.isArray(layout?.boxes) || layout.warnings?.includes('CANVAS_LAYOUT_ERROR')) throw new Error('UI_NAVIGATION_FRAME_INVALID');
  return { layout, propsById, uiInstanceId, bindings: evaluated };
}
async function navigatePreviewEffect(effect, origin) {
  assertStudioExternalChange21('プレビュー内の UI 遷移');
  if (!origin || runtimeStateEditor.dirty) {
    setStatus(siteText('状態JSONに未適用の変更があるか、遷移元UIがありません。'));
    return false;
  }
  let requested;
  try { requested = normalizeScreenRef(effect.screenRef || { fileId: effect.fileId, definition: effect.definition, previewTopic: effect.previewTopic }); }
  catch (error) { setStatus(siteText`遷移できません: ${translateSiteMessage(describeScreenNavigationError(error))}`); return false; }
  const requestKey = JSON.stringify([origin.id, getSelectedPreviewQualifiedName(origin), requested, effect.historyMode || 'push', effect.historyIndex]);
  if (pendingPreviewNavigation?.key === requestKey && pendingPreviewNavigation.isCurrent()) return pendingPreviewNavigation.promise;
  const epoch = ++previewNavigationEpoch;
  pendingPreviewNavigation?.cancel();
  const originalState = store.getState();
  const originalHistoryStack = originalState.preview?.navigation?.stack;
  const originalHistoryIndex = originalState.preview?.navigation?.index;
  const originalMockData = originalState.preview?.mockData;
  const originalMockDataVersion = originalState.preview?.mockDataVersion;
  const originalPackMutationEpoch = resourcePackMutationEpoch;
  if (effect.historyMode === 'setIndex' && (!Number.isInteger(effect.historyIndex) || effect.historyIndex < 0
    || effect.historyIndex >= (originalHistoryStack?.length || 0))) {
    setStatus(siteText('指定された履歴位置へは移動できません。'));
    return false;
  }
  const originalModel = origin.uiModel, originalInstance = origin.meta?.previewProjectionInstanceId;
  const originalImported = originalState.pack?.imported;
  const originalEnabled = originalState.preview?.navigation?.enabled === true;
  if (!effect.toolbar && !originalEnabled) return false;
  const importedRuntime = importedPackRuntime, vanillaRuntime = vanillaReferenceRuntime;
  const originalTab = originalState.ui?.tabs?.center;
  const keyBefore = getCanvasKey(origin.id), originCanvas = getCanvasState(keyBefore);
  const originalLocalInstance = originCanvas.uiInstanceId, originalLocalState = originCanvas.localToggleState;
  const originRef = normalizeNavigationEntry({ ...screenRefFromFile(origin, originCanvas.previewTopicRootId ? 'topic' : 'screen'),
    returnTo: originCanvas.previewTopicReturn, view: { scrollById: originCanvas.scrollById } });
  let cancelled = false, ownedCommitPending = false, stage = 'resolve', resolvedGeneration = null, cancellationCode = null;
  const abortController = new AbortController();
  let rejectInterrupted;
  const interrupted = new Promise((resolve, reject) => { rejectInterrupted = reject; });
  const cancel = (code = 'UI_NAVIGATION_CANCELLED') => {
    if (cancelled) return;
    cancelled = true; cancellationCode = code; abortController.abort(); rejectInterrupted(new Error(code));
  };
  const isModeAndPackCurrent = () => epoch === previewNavigationEpoch && !cancelled
    && (store.getState().preview?.navigation?.enabled === true) === originalEnabled
    && store.getState().pack?.imported === originalImported
    && importedPackRuntime === importedRuntime && vanillaReferenceRuntime === vanillaRuntime
    && (resolvedGeneration === null || resolvedGeneration === uiCatalogState.generation);
  const canCommit = () => {
    const state = store.getState(), currentOrigin = state.files?.byId?.[origin.id];
    return isModeAndPackCurrent() && state.files?.currentFileId === origin.id
      && state.preview?.navigation?.stack === originalHistoryStack
      && state.preview?.navigation?.index === originalHistoryIndex
      && state.preview?.mockData === originalMockData && state.preview?.mockDataVersion === originalMockDataVersion
      && resourcePackMutationEpoch === originalPackMutationEpoch
      && getCanvasState(keyBefore).uiInstanceId === originalLocalInstance
      && getCanvasState(keyBefore).localToggleState === originalLocalState
      && state.ui?.tabs?.center === originalTab && !runtimeStateEditor.dirty
      && currentOrigin?.uiModel === originalModel
      && currentOrigin?.meta?.previewProjectionInstanceId === originalInstance
      && (effect.toolbar || !getCanvasState(keyBefore).previewClosed);
  };
  if (!canCommit()) return false;
  const unsubscribe = store.subscribe((next, previous, action) => {
    if (ownedCommitPending && action?.type === 'preview/navCommit') { ownedCommitPending = false; return; }
    // A transient mode/tab switch permanently invalidates this request.
    if (!canCommit()) cancel();
  });
  const timeout = setTimeout(() => cancel('UI_NAVIGATION_TIMEOUT'), 30000);
  const promise = (async () => {
    try {
      const prepared = await Promise.race([ensureScreenFileOpen(requested, null, {
        canCommit, prepareOnly: true, signal: abortController.signal,
        onResolved: resolved => { resolvedGeneration = resolved.catalogGeneration; },
      }), interrupted]);
      if (!prepared?.ok || !canCommit()) {
        if (canCommit()) throw new Error(prepared?.code || prepared?.error || 'UI_NAVIGATION_PREPARE_FAILED');
        return false;
      }
      const target = prepared.file, ref = normalizeNavigationEntry({ ...prepared.screenRef,
        returnTo: effect.screenRef?.returnTo || originRef, view: effect.screenRef?.view });
      if (target?.meta?.selectedDefinition?.recordId !== prepared.resolved.recordId
        || getSelectedPreviewQualifiedName(target) !== ref.qualifiedName) throw new Error('UI_NAVIGATION_IDENTITY_MISMATCH');
      stage = 'first-frame';
      const frame = await Promise.race([prepareNavigationFrame(target, ref, store.getState(), epoch, abortController.signal), interrupted]);
      if (!canCommit()) return false;
      assertStudioExternalChange21('プレビュー内の UI 遷移');
      stage = 'commit';
      ownedCommitPending = true;
      invalidatePreviewAudioForNavigation(effect.interactionId);
      unsubscribe();
      store.dispatch(actions.navCommit({ file: target, screenRef: ref, origin: originRef,
        mode: effect.historyMode || 'push', index: effect.historyIndex }));
      const current = store.getState().files?.byId?.[store.getState().files.currentFileId];
      if (current !== target) throw new Error('UI_NAVIGATION_COMMIT_FAILED');
      const cs = getCanvasState(getCanvasKey(target.id));
      cs.previewTopicRootId = ref.presentation === 'topic' ? target.uiModel.root.children[0].id : null;
      cs.previewTopicReturn = ref.presentation === 'topic' ? ref.returnTo : null;
      cs.previewClosed = false;
      cs.localStateModel = target.uiModel;
      cs.uiInstanceId = frame.uiInstanceId;
      cs.localToggleState = frame.bindings?.localToggleState || createLocalToggleState(frame.uiInstanceId);
      cs.navigationChoices = null;
      cs.scrollById = { ...(ref.view?.scrollById || {}) };
      cs.scrollRevision = (cs.scrollRevision || 0) + 1;
      cs.layoutInputKey = null; cs.nodeFrameRequestKey = null; cs.nodeFrameContext = null;
      cs.layout = frame.layout; cs.propsByIdOverride = frame.propsById || {}; cs.layoutError = null;
      screenOpenState.status = 'ready'; screenOpenState.error = null;
      screenOpenState.selectedPath = ref.packPath; screenOpenState.lastOpenedPath = ref.packPath;
      screenOpenState.selectedDefinition = prepared.resolved.recordId;
      screenOpenState.lastOpenedDefinition = prepared.resolved.recordId;
      screenOpenState.lastOpenedAtIso = new Date().toISOString();
      navigationUiState.lastResolution = { status: 'committed', stage, screenRef: ref, epoch };
      safeRender();
      setStatus(siteText`移動しました: ${ref.qualifiedName}`);
      return true;
    } catch (error) {
      if (error?.code === 'WORKSPACE_EXTERNAL_CHANGE_BLOCKED') reportWorkspaceError(error);
      if (!cancelled && epoch === previewNavigationEpoch) {
        screenOpenState.status = 'error'; screenOpenState.error = error.message;
        navigationUiState.lastResolution = { status: 'failed', stage, screenRef: requested, code: error.message, epoch };
        setStatus(siteText`遷移できません: ${translateSiteMessage(describeScreenNavigationError(error))}`);
      }
      return false;
    } finally {
      clearTimeout(timeout); unsubscribe();
      if (epoch === previewNavigationEpoch) {
        pendingPreviewNavigation = null;
        if (cancelled || screenOpenState.status === 'loading') screenOpenState.status = 'ready';
        if (cancelled) navigationUiState.lastResolution = { status:'cancelled', stage, screenRef:requested, code:cancellationCode, epoch };
        if (cancellationCode === 'UI_NAVIGATION_TIMEOUT') setStatus(siteText('遷移準備が30秒以内に完了しなかったため取り消しました。元の画面から再試行できます。'));
        safeRender();
      }
    }
  })();
  pendingPreviewNavigation = { key: requestKey, promise, cancel, isCurrent: canCommit };
  return promise;
}
function presentPreviewInteractionResult(result, execution = {}) {
  const message = result?.diagnostics?.map(item => translateSiteMessage(item.message)).filter(Boolean).join(' ') || (result?.status === 'applied' ? siteText('プレビュー操作を反映しました。') : siteText('この操作は現在の状態では実行できません。'));
  const committed = (result?.status === 'applied' || execution.audioIntent)
    && commitPreviewInteractionEffects(result?.status === 'applied' ? result.effects : [], message, execution);
  const applied = result?.status === 'applied' && committed;
  if (result?.status === 'applied' && !applied) return;
  if (applied && result.effects?.some(effect => effect.type === 'clipboardWriteText')) return;
  const display = applied && result.effects?.some(effect => effect.type === 'navigate') ? siteText('移動先のUIと最初の描画を準備しています。') : message;
  setStatus(display);
  const element = document.getElementById('preview-operation-status'); if (element) element.textContent = translateSiteMessage(display);
  if (!applied && result?.status !== 'noop') diagnostics.log('info', message, { source: 'preview-interaction', data: { status: result?.status, actionIds: result?.actionIds, diagnostics: result?.diagnostics } });
}
function getInteractionHitProps(context, hitId) {
  return getUiInteractionEffectiveProps(context, hitId);
}

function cancelPreviewPointerInteraction(key, canvas = document.getElementById('preview-canvas')) {
  const cs = getCanvasState(key), pointer = cs.interaction?.pointerId;
  if (cs.interaction?.inputSnapshot41) previewInputTrace.append({kind:'pointer-cancel',code:'POINTER_CANCELLED',pointerId:pointer,nodeId:cs.interaction.inputSnapshot41.targetId,accepted:false});
  Object.assign(cs.interaction, { inputSnapshot41: null, active: false, drag: null, sourceFile: null, sourceDrag: null, pendingAdditionDrag23: null, pointerId: null, mode: 'none', moved: false });
  const ghost = document.getElementById('preview-slot-drag'); if (ghost) ghost.hidden = true;
  if (pointer !== null && pointer !== undefined) { try { canvas?.releasePointerCapture(pointer); } catch {} }
}
function interactionTarget(context, hit, wantedType = null) {
  const target = findUiInteractionTarget(context, hit, wantedType);
  if (!target) return null;
  return { ...target, collectionAddress: findInteractionCollectionAddress({ ...context, nodeId: target.node.id }) };
}

function activatePreviewHit(key, hit, event = 'activate', inputEvent = null) {
  const context = getInteractionPreviewContext(key);
  if (!context.enabled || context.pocket) return;
  const editTarget = event === 'activate' ? interactionTarget(context, hit, 'edit_box') : null;
  if (editTarget) {
    const descriptor = describeTextInteraction({ ...context, ...editTarget, collectionIndex: editTarget.collectionAddress?.index });
    if (descriptor.status !== 'applied') return presentPreviewInteractionResult(descriptor);
    const edit = descriptor.edit;
    const row = edit.collection ? context.collectionData[edit.collection]?.[edit.index] : context.mockData;
    const value = row?.[edit.binding] ?? row?.[edit.binding.replace(/^[#$]/u, '')] ?? '';
    store.dispatch(actions.selectNode(String(editTarget.node.id)));
    focusPreviewEditBoxOverlay({ fileKey: key, nodeId: editTarget.node.id, edit, value, placeholder: editTarget.effectiveProps.place_holder_text || '' });
    return;
  }
  hidePreviewEditBoxOverlay('canvas-click');
  const escapeNode = event === 'escape' ? [...walkUiNodes(context.model?.root)].find(node => extractUiInteractionActions(node, context.propsById[node.id] || {}, 'escape').length > 0) : null;
  const target = event === 'escape' && escapeNode ? { node: escapeNode, effectiveProps: context.propsById[escapeNode.id] || {} }
    : interactionTarget(context, hit);
  if (target) {
    const interactionId = `ui-${++previewAudioSequence}`;
    const audioIntent = event === 'activate' ? buildPreviewAudioIntent(context, target, interactionId) : null;
    return presentPreviewInteractionResult(resolveUiInteraction({ ...context, ...target, event }), { inputEvent, interactionId, audioIntent });
  }
  if (!hit) presentPreviewInteractionResult(resolveUiInteraction({ ...context, event: 'outside' }));
}
function renderPreviewOperationCapabilities(key) {
  const body = h('div', { class: 'preview-operation-list' }, []);
  const details = h('details', { class: 'preview-operation-capabilities' }, [h('summary', {}, [siteText('このUIの操作と対応状況')]), body]);
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    const context = getInteractionPreviewContext(key), catalog = listUiInteractionCapabilities(context);
    body.replaceChildren(...catalog.entries.map(item => h('div', { class: 'preview-operation-row' }, [
      h('strong', {}, [item.label]), h('span', {}, [item.actionIds.join(', ') || siteText('テキスト入力')]),
      h('span', {}, [item.status === 'applied' ? (context.enabled ? siteText('対応（現在の状態で操作可能）') : siteText('対応（操作をONにすると利用可能）')) : translateSiteMessage(item.reason) || siteText('未対応・無効')]),
    ])));
    if (catalog.truncated) body.append(h('p', {}, [siteText('表示上限に達しました。個別の操作結果は下のメッセージで確認できます。')]));
  });
  return details;
}

/* --- S041: Texture decode cache (image elements) ------------------------ */

function isLikelyMobileViewport() {
  try {
    // Coarse pointer / small viewport is a reasonable proxy for mobile.
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    if (window.matchMedia && window.matchMedia('(max-width: 700px)').matches) return true;
  } catch {
    // ignore
  }
  return false;
}

// Cache decoded images by "source:packPath". Bounded by decoded-pixel bytes.
const textureImageCache = createTextureImageCache({
  maxDecodedBytesTotal: isLikelyMobileViewport() ? 134_217_728 : 268_435_456, // 128MiB mobile / 256MiB desktop
});
const nativeTextureFailureCodes = new Map();
const MAX_NATIVE_TEXTURE_FAILURE_CODES = 1024;
const loggedTextureFailureKeys = new Set();
const loggedNativeSceneIssueKeys = new Set();
let textureCompositionEpoch = 0;
let resourcePackMutationEpoch = 0;
let previewContextMutationEpoch = 0;

function markResourcePackMutation() {
  resourcePackMutationEpoch = Number.isSafeInteger(resourcePackMutationEpoch + 1)
    ? resourcePackMutationEpoch + 1
    : 1;
  previewAudioPreparation = null;
  if (previewAudioPlayer) syncPreviewAudioPack();
}

function markPreviewContextMutation() {
  previewContextMutationEpoch = Number.isSafeInteger(previewContextMutationEpoch + 1)
    ? previewContextMutationEpoch + 1
    : 1;
}

function recordNativeTextureFailure(cacheKey, rawCode) {
  const key = String(cacheKey || '').slice(0, 1024);
  const code = String(rawCode || 'TEXTURE_DECODE_FAILED').slice(0, 160);
  if (!key) return false;
  const previous = nativeTextureFailureCodes.get(key);
  if (previous === code) return false;
  if (nativeTextureFailureCodes.has(key)) nativeTextureFailureCodes.delete(key);
  while (nativeTextureFailureCodes.size >= MAX_NATIVE_TEXTURE_FAILURE_CODES) {
    const oldest = nativeTextureFailureCodes.keys().next().value;
    if (oldest === undefined) break;
    nativeTextureFailureCodes.delete(oldest);
  }
  nativeTextureFailureCodes.set(key, code);
  scheduleReferenceContextRevalidation();
  return true;
}

function forgetNativeTextureFailure(cacheKey) {
  const changed = nativeTextureFailureCodes.delete(String(cacheKey || ''));
  if (changed) scheduleReferenceContextRevalidation();
  return changed;
}

function resetNativeTexturePreviewComposition() {
  textureCompositionEpoch += 1;
  textureImageCache.clear();
  nativeTextureFailureCodes.clear();
  loggedTextureFailureKeys.clear();
  loggedNativeSceneIssueKeys.clear();
}

function logTextureFailureOnce(cacheKey, callback) {
  const key = String(cacheKey || '').slice(0, 1024);
  if (!key || loggedTextureFailureKeys.has(key)) return;
  while (loggedTextureFailureKeys.size >= MAX_NATIVE_TEXTURE_FAILURE_CODES) {
    const oldest = loggedTextureFailureKeys.values().next().value;
    if (oldest === undefined) break;
    loggedTextureFailureKeys.delete(oldest);
  }
  loggedTextureFailureKeys.add(key);
  callback();
}

const textureSidecarCache = new TextureMetadataCache({
  concurrency: 8, timeoutMs: 10000,
  onChange: () => requestCanvasTextureMetadataRefresh(),
});
const textureSidecarPathIndexByRuntime = new WeakMap();
let textureMetadataRefreshFrame = null;

let itemTextureAtlasCacheByRuntime = new WeakMap();
let itemIconIndexCacheByRuntime = new WeakMap();
const itemTextureAtlasAbortControllers = new Set();
let itemTextureAtlasEpoch = 0;
// Session-only render option; never written into an imported pack.
let previewItemIdProfile = 'bedrock-v1.26.50.4';
let nativeHorsePreviewEpoch = 0;
let nativeHorsePreviewAbortController = null;
let nativeHorsePreviewState = { status: 'idle', scene: null, textureRef: '', textureRefs: [], issue: null, stats: null };
let nativeModelPreviewOptions = DEFAULT_NATIVE_MODEL_PREVIEW_OPTIONS;
const nativeModelPreviewUiState = { open: false, draft: null, error: '' };
let enchantingBookPreviewScene = buildEnchantingBookPreviewScene({ openingDegrees: nativeModelPreviewOptions.bookOpeningDegrees });
const NATIVE_PREVIEW_TOTAL_TEXT_BYTES = 32 * 1024 * 1024;
const NATIVE_PREVIEW_MAX_CANDIDATE_PATHS = 2048;
const NATIVE_PREVIEW_MAX_PACK_PATHS_INSPECTED = 50_000;
const NATIVE_PREVIEW_DEFAULT_TARGET_ENGINE_VERSION = Object.freeze([1, 26, 40]);

function nativePreviewTargetEngineVersion() {
  return selectNativePreviewTargetEngineVersion({
    hasImportedPack: Boolean(importedPackRuntime),
    importedMinEngineVersion: importedPackRuntime?.manifestSummary?.header?.minEngineVersion,
    expectedBedrockVersion: vanillaReferenceUiState.expectedBedrockVersion,
    sourceRelease: vanillaReferenceUiState.sourceRelease,
    fallback: NATIVE_PREVIEW_DEFAULT_TARGET_ENGINE_VERSION,
  });
}

function clearItemTextureAtlasCache() {
  itemTextureAtlasEpoch += 1;
  for (const controller of itemTextureAtlasAbortControllers) {
    try { controller.abort(); } catch { /* best effort */ }
  }
  itemTextureAtlasAbortControllers.clear();
  itemTextureAtlasCacheByRuntime = new WeakMap();
  itemIconIndexCacheByRuntime = new WeakMap();
}

function clearNativeHorsePreviewCache({ clearFont = true } = {}) {
  if (clearFont) { bitmapFontCache.clear(); bitmapTextLayoutCache.clear(); bitmapFontNotices.clear(); warnedFontLoadKeys.clear(); }
  nativeHorsePreviewEpoch += 1;
  if (nativeHorsePreviewAbortController) nativeHorsePreviewAbortController.abort();
  nativeHorsePreviewAbortController = null;
  nativeHorsePreviewState = { status: 'idle', scene: null, textureRef: '', textureRefs: [], issue: null, stats: null };
  if (typeof clearNativePlayerPreviewCache === 'function') clearNativePlayerPreviewCache();
}

const defaultPlayerRuntime = createBrowserDefaultPlayerRuntime();
function nativeTextureRuntime(source) {
  return source === 'imported' ? importedPackRuntime
    : source === DEFAULT_PLAYER_SOURCE ? defaultPlayerRuntime : vanillaReferenceRuntime;
}

let nativePlayerPreviewEpoch = 0;
let nativePlayerPreviewController = null;
let nativePlayerPreviewState = { status: 'idle', scene: null };

function clearNativePlayerPreviewCache() {
  nativePlayerPreviewEpoch += 1;
  nativePlayerPreviewController?.abort();
  nativePlayerPreviewController = null;
  nativePlayerPreviewState = { status: 'idle', scene: null };
}

function requestNativePlayerPreview() {
  if (nativePlayerPreviewState.status !== 'idle') return nativePlayerPreviewState;
  const epoch = nativePlayerPreviewEpoch, controller = new AbortController();
  const sources = [{ source: 'imported', runtime: importedPackRuntime }, { source: 'vanilla', runtime: vanillaReferenceRuntime }].filter((x) => x.runtime);
  const targetEngineVersion = nativePreviewTargetEngineVersion();
  const camera = { yaw: 160, pitch: 5 };
  nativePlayerPreviewController = controller;
  nativePlayerPreviewState = { status: 'loading', scene: null };
  const task = sources.length && sources.every((x) => x.runtime.zipReader?.nodePackId)
    ? nodePlayerPreview(sources, targetEngineVersion, controller.signal, { camera })
    : loadBrowserPlayerPreview({ sources, defaultRuntime: defaultPlayerRuntime, targetEngineVersion, signal: controller.signal, camera, cacheDocuments: true });
  const promise = Promise.resolve(task).then((result) => {
    if (epoch !== nativePlayerPreviewEpoch || controller.signal.aborted || result.status === 'cancelled') return;
    nativePlayerPreviewState = result;
    try {
      diagnostics.log(result.status === 'ready' ? 'info' : 'warn', result.status === 'ready'
        ? (result.provenance?.defaultPlayerStatus === 'BUNDLED_ORIGINAL_STEVE_REFERENCE'
          ? siteText('不足する既定プレイヤー資料を同梱の公式Steve原本で補完して表示します。本人のスキン・装備・Personaは含みません。')
          : siteText('パック既定のプレイヤーモデルを表示します。本人のスキン・装備・Personaは含みません。'))
        : siteText('パック既定のプレイヤーモデルを解決できませんでした。'), {
        source: 'native-model-preview', data: { code: result.issue || null, detail: result.detail || null, provenance: result.provenance || null },
      });
    } catch { /* Logging must not discard a successfully loaded model. */ }
  }).catch((error) => {
    if (epoch !== nativePlayerPreviewEpoch || controller.signal.aborted) return;
    nativePlayerPreviewState = { status: 'invalid', issue: 'NATIVE_PREVIEW_MODEL_INVALID', scene: null };
    diagnostics.captureError(error, { source: 'native-model-preview', message: siteText('プレイヤー原モデルの読込に失敗しました。') });
  }).finally(() => {
    if (epoch !== nativePlayerPreviewEpoch) return;
    nativePlayerPreviewController = null;
    requestCanvasTextureMetadataRefresh();
    scheduleReferenceContextRevalidation();
  });
  nativePlayerPreviewState.promise = promise;
  return nativePlayerPreviewState;
}

function boundedUtf8Length(text) {
  if (typeof text !== 'string') return Number.POSITIVE_INFINITY;
  try {
    return new TextEncoder().encode(text).byteLength;
  } catch {
    // Three bytes per UTF-16 code unit is a conservative UTF-8 upper bound
    // (surrogate pairs consume four bytes across two units).
    return text.length * 3;
  }
}


async function loadHorsePreviewFromPackStack(epoch, signal, options = nativeModelPreviewOptions) {
  const sources = [{ source: 'imported', runtime: importedPackRuntime }, { source: 'vanilla', runtime: vanillaReferenceRuntime }].filter(x=>x.runtime);
  const targetEngineVersion = nativePreviewTargetEngineVersion();
  const result = sources.length && sources.every(x=>x.runtime.zipReader?.nodePackId)
    ? await nodeHorsePreview(sources, targetEngineVersion, signal, options)
    : await loadHorsePreviewFromSources({ sources, targetEngineVersion, signal, previewState: options.previewState, camera: options.camera, cacheDocuments: true });
  return epoch === nativeHorsePreviewEpoch && !signal?.aborted ? result : { status: 'cancelled' };
}

function requestNativeHorsePreview() {
  const options = nativeModelPreviewOptions;
  const requestKey = horsePreviewOptionsKey(options);
  if (nativeHorsePreviewState.status !== 'idle' && nativeHorsePreviewState.requestKey !== requestKey) {
    clearNativeHorsePreviewCache({ clearFont: false });
  }
  if (nativeHorsePreviewState.status !== 'idle') return nativeHorsePreviewState;
  const epoch = nativeHorsePreviewEpoch;
  const controller = new AbortController();
  nativeHorsePreviewAbortController = controller;
  nativeHorsePreviewState = { status: 'loading', scene: null, textureRef: '', textureRefs: [], issue: null, stats: null, promise: null, requestKey };
  const promise = loadHorsePreviewFromPackStack(epoch, controller.signal, options)
    .then((result) => {
      if (epoch !== nativeHorsePreviewEpoch || requestKey !== horsePreviewOptionsKey(nativeModelPreviewOptions) || result.status === 'cancelled') return;
      nativeHorsePreviewState = {
        requestKey,
        status: result.status,
        scene: result.scene || null,
        textureRef: result.textureRef || '',
        textureRefs: Array.isArray(result.textureRefs) ? result.textureRefs : result.textureRef ? [result.textureRef] : [],
        issue: result.issue || null,
        detail: result.detail || null,
        stats: result.stats || null,
        provenance: result.provenance || null,
        previewState: result.previewState || options.previewState,
        camera: result.camera || options.camera,
      };
      if (result.issue) {
        try {
          diagnostics.log('warn', siteText('馬の静止プレビューを解決できませんでした。'), {
            source: 'native-model-preview',
            data: { code: result.issue, detail: result.detail || null, previewState: options.previewState, camera: options.camera },
          });
        } catch {
          // A logging failure must not discard the loader's original result.
        }
      }
    })
    .catch((error) => {
      if (epoch !== nativeHorsePreviewEpoch || requestKey !== horsePreviewOptionsKey(nativeModelPreviewOptions)) return;
      nativeHorsePreviewState = { status: 'invalid', scene: null, textureRef: '', textureRefs: [], issue: 'NATIVE_PREVIEW_MODEL_INVALID', detail: { message: error instanceof Error ? error.message : String(error) }, stats: null, requestKey };
      try { diagnostics.captureError(error, { source: 'native-model-preview', message: siteText('馬の静止プレビューの読込に失敗しました。') }); } catch { /* keep original failure */ }
    })
    .finally(() => {
      if (epoch !== nativeHorsePreviewEpoch) return;
      if (nativeHorsePreviewAbortController === controller) nativeHorsePreviewAbortController = null;
      const status = document.getElementById('native-model-load-status');
      if (status) status.textContent = nativeModelPreviewStatusText(nativeHorsePreviewState);
      requestCanvasTextureMetadataRefresh();
      scheduleReferenceContextRevalidation();
    });
  if (nativeHorsePreviewState.status === 'loading') nativeHorsePreviewState.promise = promise;
  return nativeHorsePreviewState;
}

function applyNativeModelPreviewOptions(options) {
  assertStudioExternalChange21('3D の表示条件の変更');
  const horseChanged = horsePreviewOptionsKey(options) !== horsePreviewOptionsKey(nativeModelPreviewOptions);
  const bookChanged = options.bookOpeningDegrees !== nativeModelPreviewOptions.bookOpeningDegrees;
  const nextBookScene = bookChanged
    ? buildEnchantingBookPreviewScene({ openingDegrees: options.bookOpeningDegrees })
    : enchantingBookPreviewScene;
  if (!nextBookScene) {
    nativeModelPreviewUiState.error = siteText('本の簡易モデルを作成できませんでした。');
    safeRender();
    return;
  }
  nativeModelPreviewOptions = options;
  enchantingBookPreviewScene = nextBookScene;
  if (horseChanged || bookChanged) markPreviewContextMutation();
  // Clearing advances the generation and aborts earlier work before a new
  // request can publish. The immutable options and requestKey are a second
  // boundary against a late result from an earlier form submission.
  if (horseChanged) clearNativeHorsePreviewCache({ clearFont: false });
  safeRender();
  requestCanvasTextureRedraw();
}

/**
 * Lazily read one bounded item atlas. The opaque parsed handle retains every
 * validated key; native inventory adapters still resolve only item identities
 * whose numeric runtime mapping is known rather than guessing atlas order.
 *
 * @param {'imported'|'vanilla'} sourceKind
 * @param {any} runtime
 * @returns {object|null}
 */
function getItemTextureAtlas(sourceKind, runtime) {
  if (!runtime || typeof runtime !== 'object') return null;
  const cached = itemTextureAtlasCacheByRuntime.get(runtime);
  if (cached) return cached.status === 'ready' ? cached.atlas : null;

  let actualPath = null;
  try {
    const pathLookup = runtime.assetIndex?.textures && typeof lookupPackPath === 'function'
      ? lookupPackPath(runtime.assetIndex.textures, ITEM_TEXTURE_ATLAS_PACK_PATH)
      : null;
    if (pathLookup?.found && pathLookup.collision) {
      itemTextureAtlasCacheByRuntime.set(runtime, {
        status: 'error', atlas: null, issue: 'ITEM_TEXTURE_ATLAS_AMBIGUOUS',
      });
      diagnostics.log('warn', 'Item texture atlas path is ambiguous', {
        source: 'preview/item-texture-atlas',
        data: { sourceKind, candidates: pathLookup.collisionCandidates },
      });
      return null;
    }
    actualPath = pathLookup?.found
      ? pathLookup.packPath
      : null;
    if (!actualPath) {
      const candidates = [];
      let inspected = 0;
      for (const rawPath of Array.isArray(runtime.packPaths) ? runtime.packPaths : []) {
        inspected += 1;
        if (inspected > NATIVE_PREVIEW_MAX_PACK_PATHS_INSPECTED) {
          itemTextureAtlasCacheByRuntime.set(runtime, {
            status: 'error', atlas: null, issue: 'ITEM_TEXTURE_ATLAS_LOOKUP_LIMIT_EXCEEDED',
          });
          return null;
        }
        const packPath = String(rawPath || '').replace(/\\/gu, '/');
        if (packPath.toLowerCase() === ITEM_TEXTURE_ATLAS_PACK_PATH) candidates.push(String(rawPath));
        if (candidates.length > 1) break;
      }
      if (candidates.length > 1) {
        itemTextureAtlasCacheByRuntime.set(runtime, {
          status: 'error', atlas: null, issue: 'ITEM_TEXTURE_ATLAS_AMBIGUOUS',
        });
        diagnostics.log('warn', 'Item texture atlas path is ambiguous', {
          source: 'preview/item-texture-atlas', data: { sourceKind, candidates },
        });
        return null;
      }
      [actualPath] = candidates;
    }
  } catch (error) {
    itemTextureAtlasCacheByRuntime.set(runtime, {
      status: 'error', atlas: null, issue: 'ITEM_TEXTURE_ATLAS_LOOKUP_FAILED',
      detailCode: String(error && error.message ? error.message : error),
    });
    return null;
  }
  if (!actualPath) {
    itemTextureAtlasCacheByRuntime.set(runtime, { status: 'missing', atlas: null });
    return null;
  }

  const controller = new AbortController();
  itemTextureAtlasAbortControllers.add(controller);
  itemTextureAtlasCacheByRuntime.set(runtime, { status: 'loading', atlas: null, controller });
  const requestEpoch = itemTextureAtlasEpoch;
  const override = sourceKind === 'imported'
    ? runtime.overridesTextByPackPath?.[actualPath]
    : undefined;
  const readPromise = typeof override === 'string'
    ? Promise.resolve(override)
    : runtime.zipReader.readText(`${runtime.rootPrefix}${actualPath}`, {
        maxBytes: ITEM_TEXTURE_ATLAS_MAX_TEXT_BYTES,
        encoding: 'utf-8',
        signal: controller.signal,
      });

  const loadPromise = readPromise
    .then((text) => {
      if (requestEpoch !== itemTextureAtlasEpoch) return;
      const parsed = parseItemTextureAtlas(text);
      if (!parsed.ok) {
        itemTextureAtlasCacheByRuntime.set(runtime, {
          status: 'error', atlas: null, issue: 'ITEM_TEXTURE_ATLAS_INVALID',
          detailCode: parsed.error, packPath: actualPath,
        });
        diagnostics.log('warn', 'Item texture atlas is invalid', {
          source: 'preview/item-texture-atlas',
          data: { sourceKind, actualPath, code: parsed.error },
        });
        return;
      }
      itemTextureAtlasCacheByRuntime.set(runtime, {
        status: 'ready',
        atlas: parsed.atlas,
        entryCount: parsed.entryCount,
        recognizedEntryCount: parsed.recognizedEntryCount,
        sourceKind,
        packPath: actualPath,
      });
    })
    .catch((error) => {
      if (requestEpoch !== itemTextureAtlasEpoch) return;
      if (controller.signal.aborted || requestEpoch !== itemTextureAtlasEpoch) return;
      itemTextureAtlasCacheByRuntime.set(runtime, {
        status: 'error', atlas: null, issue: 'ITEM_TEXTURE_ATLAS_READ_FAILED',
        detailCode: String(error && error.message ? error.message : error), packPath: actualPath,
      });
      diagnostics.log('warn', 'Item texture atlas could not be read', {
        source: 'preview/item-texture-atlas',
        data: {
          sourceKind,
          actualPath,
          code: String(error && error.message ? error.message : error),
        },
      });
    })
    .finally(() => {
      itemTextureAtlasAbortControllers.delete(controller);
      // Atlas readiness can change both painted pixels and the canvas empty/
      // fit bounds, so refresh the surrounding preview state as well as the
      // bitmap instead of issuing a draw-only update.
      if (requestEpoch === itemTextureAtlasEpoch) {
        requestCanvasTextureMetadataRefresh();
        scheduleReferenceContextRevalidation();
      }
    });
  const loadingState = itemTextureAtlasCacheByRuntime.get(runtime);
  if (loadingState?.status === 'loading') loadingState.promise = loadPromise;
  return null;
}

function getItemIconIndex(sourceKind, runtime) {
  if (!runtime) return { status: 'unavailable', index: null };
  const cached = itemIconIndexCacheByRuntime.get(runtime);
  if (cached) return cached;
  if (!runtime.zipReader?.nodePackId) {
    const state = { status: 'unavailable', index: null };
    itemIconIndexCacheByRuntime.set(runtime, state);
    return state;
  }
  const epoch = itemTextureAtlasEpoch;
  const controller = new AbortController();
  itemTextureAtlasAbortControllers.add(controller);
  const state = { status: 'loading', index: null, promise: null };
  itemIconIndexCacheByRuntime.set(runtime, state);
  state.promise = nodeItemIconIndex({
    kind: sourceKind, id: runtime.zipReader.nodePackId,
    overrides: sourceKind === 'imported' ? runtime.overridesTextByPackPath || {} : {},
  }, controller.signal).then((index) => {
    if (epoch === itemTextureAtlasEpoch && !controller.signal.aborted) {
      itemIconIndexCacheByRuntime.set(runtime, { status: 'ready', index });
    }
  }).catch(() => {
    if (epoch === itemTextureAtlasEpoch && !controller.signal.aborted) {
      itemIconIndexCacheByRuntime.set(runtime, { status: 'error', index: null });
    }
  }).finally(() => {
    itemTextureAtlasAbortControllers.delete(controller);
    if (epoch === itemTextureAtlasEpoch) {
      requestCanvasTextureMetadataRefresh();
      scheduleReferenceContextRevalidation();
    }
  });
  return state;
}

function buildItemTextureAtlasReferenceContext() {
  const importedAtlas = getItemTextureAtlas('imported', importedPackRuntime);
  const vanillaAtlas = getItemTextureAtlas('vanilla', vanillaReferenceRuntime);
  const importedItems = getItemIconIndex('imported', importedPackRuntime);
  const vanillaItems = getItemIconIndex('vanilla', vanillaReferenceRuntime);
  const importedStatus = importedPackRuntime
    ? itemTextureAtlasCacheByRuntime.get(importedPackRuntime)?.status || 'loading'
    : 'unavailable';
  const vanillaStatus = vanillaReferenceRuntime
    ? itemTextureAtlasCacheByRuntime.get(vanillaReferenceRuntime)?.status || 'loading'
    : 'unavailable';
  const importedState = importedPackRuntime ? itemTextureAtlasCacheByRuntime.get(importedPackRuntime) : null;
  const vanillaState = vanillaReferenceRuntime ? itemTextureAtlasCacheByRuntime.get(vanillaReferenceRuntime) : null;
  return {
    itemIdProfile: previewItemIdProfile,
    importedAtlas,
    vanillaAtlas,
    importedStatus,
    importedIssue: importedState?.issue || null,
    importedItems: importedItems.index,
    importedItemsStatus: importedItems.status,
    vanillaItems: vanillaItems.index,
    vanillaItemsStatus: vanillaItems.status,
    vanillaStatus,
    vanillaIssue: vanillaState?.issue || null,
    pending: importedStatus === 'loading' || vanillaStatus === 'loading',
  };
}

async function settleNativeReferenceContextForExport({ includeHorse = false, includePlayer = false, timeoutMs = 8_000 } = {}) {
  const snapshot = {
    importedRuntime: importedPackRuntime,
    vanillaRuntime: vanillaReferenceRuntime,
    atlasEpoch: itemTextureAtlasEpoch,
    horseEpoch: nativeHorsePreviewEpoch,
    playerEpoch: nativePlayerPreviewEpoch,
    compositionEpoch: textureCompositionEpoch,
  };
  const snapshotStillCurrent = () => (
    importedPackRuntime === snapshot.importedRuntime
    && vanillaReferenceRuntime === snapshot.vanillaRuntime
    && itemTextureAtlasEpoch === snapshot.atlasEpoch
    && nativeHorsePreviewEpoch === snapshot.horseEpoch
    && nativePlayerPreviewEpoch === snapshot.playerEpoch
    && textureCompositionEpoch === snapshot.compositionEpoch
  );
  const referencesAreSettled = () => {
    if (!snapshotStillCurrent()) return false;
    const atlasStates = [snapshot.importedRuntime, snapshot.vanillaRuntime]
      .filter(Boolean)
      .flatMap((runtime) => [itemTextureAtlasCacheByRuntime.get(runtime), itemIconIndexCacheByRuntime.get(runtime)]);
    if (atlasStates.some((state) => !state || state.status === 'loading')) return false;
    return (!includeHorse || (
      nativeHorsePreviewState.status !== 'idle'
      && nativeHorsePreviewState.status !== 'loading'
    )) && (!includePlayer || (nativePlayerPreviewState.status !== 'idle' && nativePlayerPreviewState.status !== 'loading'));
  };
  // Starting the synchronous context request schedules any missing bounded
  // atlas reads. Export must not treat that transient state as a clean result.
  buildItemTextureAtlasReferenceContext();
  if (includeHorse) requestNativeHorsePreview();
  if (includePlayer) requestNativePlayerPreview();
  if (!snapshotStillCurrent()) return false;
  const pending = [];
  for (const runtime of [snapshot.importedRuntime, snapshot.vanillaRuntime]) {
    for (const cache of [itemTextureAtlasCacheByRuntime, itemIconIndexCacheByRuntime]) {
      const state = runtime ? cache.get(runtime) : null;
      if (state?.status === 'loading' && state.promise && typeof state.promise.then === 'function') {
        pending.push(state.promise);
      }
    }
  }
  if (includeHorse && nativeHorsePreviewState.status === 'loading'
    && nativeHorsePreviewState.promise && typeof nativeHorsePreviewState.promise.then === 'function') {
    pending.push(nativeHorsePreviewState.promise);
  }
  if (includePlayer && nativePlayerPreviewState.status === 'loading' && nativePlayerPreviewState.promise) pending.push(nativePlayerPreviewState.promise);
  if (!pending.length) return referencesAreSettled();

  let timeoutId = null;
  const settled = await Promise.race([
    Promise.allSettled(pending).then(() => true),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(false), Math.max(250, Math.min(30_000, Number(timeoutMs) || 8_000)));
    }),
  ]);
  if (timeoutId !== null) clearTimeout(timeoutId);
  if (!settled) return false;
  return referencesAreSettled();
}

const warnedTextureSidecarDrawIssues = new Set();

function clearTextureSidecarCache() {
  textureSidecarCache.clear();
  warnedTextureSidecarDrawIssues.clear();
  clearItemTextureAtlasCache();
  clearNativeHorsePreviewCache();
}

function requestCanvasTextureMetadataRefresh() {
  if (textureMetadataRefreshFrame !== null) return;
  textureMetadataRefreshFrame = requestAnimationFrame(() => {
    textureMetadataRefreshFrame = null;
    previewAssetMetricsRevision += 1;
    if (getRoute() !== 'editor') return;
    ensurePreviewLayout(store.getState());
    if (previewPlayback.state.seconds > 0) previewPlayback.seek(previewPlayback.state.seconds);
    else requestCanvasTextureRedraw();
  });
}

function findTextureSidecarPackPath(runtime, wantedLowerPath) {
  if (!runtime) return { packPath: null, collision: false };
  let pathIndex = textureSidecarPathIndexByRuntime.get(runtime);
  if (!pathIndex) {
    pathIndex = new Map();
    for (const path of Array.isArray(runtime.packPaths) ? runtime.packPaths : []) {
      const normalized = String(path || '').toLowerCase();
      if (!normalized) continue;
      const paths = pathIndex.get(normalized) || [];
      if (!paths.includes(path)) paths.push(path);
      pathIndex.set(normalized, paths);
    }
    textureSidecarPathIndexByRuntime.set(runtime, pathIndex);
  }
  const paths = pathIndex.get(wantedLowerPath) || [];
  const overrides = Object.keys(runtime.overridesTextByPackPath || {})
    .filter((name) => name.toLowerCase() === wantedLowerPath);
  return { packPath: overrides[0] || paths[0] || null,
    collision: paths.length > 1 || overrides.length > 1 };
}

function getTextureSidecarDrawRecord(packPath) {
  const wanted = String(packPath).replace(/\.(?:tga|png|jpe?g)$/i, '.json').toLowerCase();
  const existing = textureSidecarCache.get(`logical:${wanted}`);
  if (existing) return existing;
  let authoredExists = false;
  for (const runtime of [importedPackRuntime, vanillaReferenceRuntime]) {
    const match = findTextureSidecarPackPath(runtime, wanted);
    // Match Node rasterization: an ambiguous upper source never falls through.
    if (match.collision) return { status: 'error', code: 'RASTER_SIDECAR_AMBIGUOUS', value: null };
    if (match.packPath) { authoredExists = true; break; }
  }
  // Nonexistent sidecars do not occupy cache entries. A large ordinary texture
  // library must not exhaust the capacity reserved for authored frame metadata.
  return authoredExists
    ? { status: 'error', code: 'TEXTURE_SIDECAR_CACHE_LIMIT', value: null }
    : { status: 'missing', value: null };
}

function getTextureSidecarMetadata(_source, packPath) {
  if (!/\.(?:tga|png|jpe?g)$/i.test(String(packPath))) return null;
  const wanted = String(packPath).replace(/\.(?:tga|png|jpe?g)$/i, '.json').toLowerCase();
  const key = `logical:${wanted}`;
  const existing = textureSidecarCache.get(key);
  if (existing) return existing.status === 'ready' ? existing.value : null;
  const candidates = [
    { sourceKind: 'imported', runtime: importedPackRuntime },
    { sourceKind: 'vanilla', runtime: vanillaReferenceRuntime },
  ];
  let selected = null;
  for (const candidate of candidates) {
    const match = findTextureSidecarPackPath(candidate.runtime, wanted);
    if (match.collision) {
      textureSidecarCache.request(key, async () => ({ status: 'error', value: null, code: 'RASTER_SIDECAR_AMBIGUOUS' }));
      return null;
    }
    const actualPath = match.packPath;
    if (actualPath) { selected = { ...candidate, actualPath }; break; }
  }
  if (!selected) return null;
  const { runtime, sourceKind, actualPath } = selected;
  const record = textureSidecarCache.request(key, async (signal) => {
    const override = runtime.overridesTextByPackPath?.[actualPath];
    const text = typeof override === 'string' ? override
      : await runtime.zipReader.readText(`${runtime.rootPrefix}${actualPath}`, {
        maxBytes: 256 * 1024, encoding: 'utf-8', signal,
      });
    if (text.length > 256 * 1024) return { status: 'error', value: null, code: 'TEXTURE_SIDECAR_TEXT_LIMIT' };
    const parsed = parseJsonc(text, { filePath: actualPath, allowTrailingComma: true });
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return { status: 'error', value: null, code: 'TEXTURE_SIDECAR_JSON_INVALID' };
    }
    const raw = parsed.value;
    const value = {
      nineSlice: raw.nineslice_size ?? null,
      baseSize: raw.base_size ?? null,
      tiled: raw.tiled ?? null,
      sourcePath: actualPath, sourceKind,
    };
    return value.nineSlice !== null || value.baseSize !== null || value.tiled !== null
      ? { status: 'ready', value } : { status: 'missing', value: null };
  });
  return record.status === 'ready' ? record.value : null;
}

// Additional safety: don't read extremely large texture blobs for preview.
const MAX_CANVAS_TEXTURE_BLOB_BYTES = 16 * 1024 * 1024; // 16 MiB

let pendingCanvasTextureRedraw = false;
let pendingCanvasTextureNativeOnly = false;
function requestCanvasTextureRedraw(options = {}) {
  if (pendingCanvasTextureRedraw) {
    if (options.nativeOnly !== true) pendingCanvasTextureNativeOnly = false;
    return;
  }
  pendingCanvasTextureRedraw = true;
  pendingCanvasTextureNativeOnly = options.nativeOnly === true;
  requestAnimationFrame(() => {
    const nativeOnly = pendingCanvasTextureNativeOnly;
    pendingCanvasTextureRedraw = false;
    pendingCanvasTextureNativeOnly = false;
    const s = store.getState();
    const activeCenterTab = s.ui?.tabs?.center || 'preview';
    if (activeCenterTab !== 'canvas') return;
    const fileId = s.files.currentFileId;
    const key = getCanvasKey(fileId);
    drawCanvasNow(key, { nativeOnly });
  });
}

/* --- S042: Font loading cache (label/button text) ----------------------- */

// Cache loaded FontFace objects by "source:packPath". Budgeted by compressed bytes.
const fontFaceCache = createFontFaceCache({
  maxBytesTotal: isLikelyMobileViewport() ? 16_777_216 : 33_554_432, // 16MiB mobile / 32MiB desktop
});

// Additional safety: do not read extremely large font blobs for preview.
const MAX_CANVAS_FONT_BLOB_BYTES = 8 * 1024 * 1024; // 8 MiB

// Avoid spamming diagnostics with repeated font load errors.
const warnedFontLoadKeys = new Set();

/**
 * @param {string} fontType
 */
function mapFontTypeToFallbackFamily(_fontType) {
  // Host fonts cannot represent a Bedrock family. Only a loaded pack FontFace
  // may opt into CSS text; bitmap resources use their own metrics and draw path.
  return '';
}

function fnv1a32(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // h *= 16777619 (FNV-1a) with 32-bit overflow.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Generate a stable CSS font family name for a given font file.
 *
 * @param {'imported'|'vanilla'} source
 * @param {string} packPath
 */
function makeFontFamilyName(source, packPath) {
  const stem = String(packPath || '').split('/').pop() || 'font';
  const base = stem.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
  const h = fnv1a32(`${source}:${packPath}`).toString(16).padStart(8, '0');
  return `jsonui_${base}_${h}`;
}

/* --- S043: Text localization (texts/*.lang) ---------------------------- */

const PREVIEW_LOCALE_STORAGE_KEY = 'jsonui.previewLocale';
const SUPPORTED_PREVIEW_LOCALES = ['en_US', 'ja_JP'];

/** @type {{
 *  tablesByLocale: Map<string, { status: 'idle'|'loading'|'ready'|'error', table: Record<string,string>, stats: any, error: string|null }>,
 *  inflightByLocale: Map<string, Promise<void>>, 
 *  warnedMissingKeys: Set<string>,
 *  warnedMissingLangFiles: Set<string>,
 * }} */
const langTableRuntime = {
  generation: 0,
  tablesByLocale: new Map(),
  inflightByLocale: new Map(),
  warnedMissingKeys: new Set(),
  warnedMissingLangFiles: new Set(),
};

function safeReadStoredPreviewLocale() {
  try {
    const v = String(localStorage.getItem(PREVIEW_LOCALE_STORAGE_KEY) || '').trim();
    return SUPPORTED_PREVIEW_LOCALES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

/** @param {string} locale */
function safeWriteStoredPreviewLocale(locale) {
  try {
    if (!SUPPORTED_PREVIEW_LOCALES.includes(locale)) return;
    localStorage.setItem(PREVIEW_LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

function resetLangTableRuntime() {
  langTableRuntime.generation += 1;
  langTableRuntime.tablesByLocale.clear();
  langTableRuntime.inflightByLocale.clear();
  langTableRuntime.warnedMissingKeys.clear();
  langTableRuntime.warnedMissingLangFiles.clear();
}

/** @param {string} packPath */
async function readVanillaReferenceText(packPath) {
  if (!vanillaReferenceRuntime) throw new Error('VANILLA_REFERENCE_NOT_LOADED');
  const override = vanillaReferenceRuntime.overridesTextByPackPath?.[packPath];
  if (typeof override === 'string') return override;
  const zipPath = `${vanillaReferenceRuntime.rootPrefix}${packPath}`;
  return vanillaReferenceRuntime.zipReader.readText(zipPath, {
    maxBytes: DEFAULT_ZIP_LIMITS.maxTextFileBytesForRead,
    encoding: 'utf-8',
  });
}

/**
 * @param {{ texts: Map<string,string> }|null} index
 * @param {string} locale
 * @returns {string|null}
 */
function findLangFilePath(index, locale) {
  if (!index) return null;
  const desired = `texts/${locale}.lang`;
  const res = lookupPackPath(index.texts, desired);
  return res && res.found ? res.packPath : null;
}

/**
 * Load and merge lang tables for a locale:
 * - vanilla reference is the base
 * - imported pack overrides on key collisions
 *
 * @param {string} locale
 * @returns {Promise<{ table: Record<string,string>, stats: any, sources: string[] }>} 
 */
async function loadMergedLangTable(locale) {
  const nodeSources=[['vanilla',vanillaReferenceRuntime],['imported',importedPackRuntime]].filter(([,runtime])=>runtime);
  if(nodeSources.length&&nodeSources.every(([,runtime])=>runtime.zipReader?.nodePackId)){
    return nodeLangTable({locale,sources:nodeSources.map(([kind,runtime])=>({kind,id:runtime.zipReader.nodePackId,overrides:kind==='imported'?runtime.overridesTextByPackPath||{}:{}}))});
  }
  /** @type {Record<string,string>} */
  const merged = Object.create(null);
  const sources = [];
  const stats = { vanilla: null, imported: null };

  // Base: vanilla reference
  if (vanillaReferenceRuntime) {
    const vanillaPath = findLangFilePath(vanillaReferenceRuntime.assetIndex, locale);
    if (vanillaPath) {
      try {
        const txt = await readVanillaReferenceText(vanillaPath);
        const parsed = parseLangFile(txt);
        Object.assign(merged, parsed.table);
        stats.vanilla = parsed.stats;
        sources.push(`vanilla:${vanillaPath}`);
      } catch (err) {
        stats.vanilla = { error: String(err && err.message ? err.message : err) };
      }
    }
  }

  // Override: imported pack
  if (importedPackRuntime) {
    const importedPath = findLangFilePath(importedPackRuntime.assetIndex, locale);
    if (importedPath) {
      try {
        const txt = await readImportedPackText(importedPath);
        const parsed = parseLangFile(txt);
        Object.assign(merged, parsed.table);
        stats.imported = parsed.stats;
        sources.push(`imported:${importedPath}`);
      } catch (err) {
        stats.imported = { error: String(err && err.message ? err.message : err) };
      }
    }
  }

  return { table: merged, stats, sources };
}

let referenceRevalidationScheduled = false;
let referenceRevalidationTimer = null;
let referenceRevalidationSuspended = false;
function scheduleReferenceContextRevalidation() {
  if (referenceRevalidationSuspended || referenceRevalidationScheduled) return;
  referenceRevalidationScheduled = true;
  referenceRevalidationTimer = setTimeout(() => {
    referenceRevalidationTimer = null;
    referenceRevalidationScheduled = false;
    if (!referenceRevalidationSuspended) revalidateOpenScreenFiles();
  }, 250);
}
function suspendReferenceContextRevalidation() {
  referenceRevalidationSuspended = true;
  if (referenceRevalidationTimer !== null) clearTimeout(referenceRevalidationTimer);
  referenceRevalidationTimer = null;
  referenceRevalidationScheduled = false;
  validationGeneration += 1;
  validationPending = null;
  referenceValidationAbort?.abort();
}
function resumeReferenceContextRevalidation() {
  if (!referenceRevalidationSuspended) return;
  referenceRevalidationSuspended = false;
  scheduleReferenceContextRevalidation();
}

/** @param {string} locale */
function requestLangTableLoad(locale) {
  const normalized = SUPPORTED_PREVIEW_LOCALES.includes(locale) ? locale : 'en_US';

  const existing = langTableRuntime.tablesByLocale.get(normalized);
  if (existing && (existing.status === 'ready' || existing.status === 'loading')) return;
  if (langTableRuntime.inflightByLocale.has(normalized)) return;

  langTableRuntime.tablesByLocale.set(normalized, {
    status: 'loading',
    table: Object.create(null),
    stats: null,
    error: null,
  });

  const generation = langTableRuntime.generation;
  let p;
  p = (async () => {
    try {
      const { table, stats, sources } = await loadMergedLangTable(normalized);
      if (generation !== langTableRuntime.generation) return;
      langTableRuntime.tablesByLocale.set(normalized, {
        status: 'ready',
        table,
        stats: { ...stats, sources },
        error: null,
      });
      scheduleReferenceContextRevalidation();

      if (!sources.length) {
        const warnId = `langfile:${normalized}`;
        if (!langTableRuntime.warnedMissingLangFiles.has(warnId)) {
          langTableRuntime.warnedMissingLangFiles.add(warnId);
          diagnostics.log('warn', `No texts/${normalized}.lang found in imported pack or vanilla reference`, {
            source: 'localization',
            data: { code: 'LANG_FILE_NOT_FOUND', locale: normalized },
          });
        }
      }
    } catch (err) {
      if (generation !== langTableRuntime.generation) return;
      langTableRuntime.tablesByLocale.set(normalized, {
        status: 'error',
        table: Object.create(null),
        stats: null,
        error: String(err && err.message ? err.message : err),
      });
    } finally {
      if (generation === langTableRuntime.generation
        && langTableRuntime.inflightByLocale.get(normalized) === p) {
        langTableRuntime.inflightByLocale.delete(normalized);
        // Localized glyph advances can change intrinsic label bounds. Rebuild
        // layout once after the table becomes ready instead of redrawing stale
        // boxes that were measured from the raw localization key.
        requestCanvasTextureMetadataRefresh();
      }
    }
  })();

  langTableRuntime.inflightByLocale.set(normalized, p);
}

/** @param {string} locale */
function getLangTableSync(locale) {
  const normalized = SUPPORTED_PREVIEW_LOCALES.includes(locale) ? locale : 'en_US';
  const rec = langTableRuntime.tablesByLocale.get(normalized);
  if (rec && rec.status === 'ready') return rec.table;
  requestLangTableLoad(normalized);
  return null;
}

function warnMissingLangKeyOnce(locale, key) {
  const id = `${locale}:${key}`;
  if (langTableRuntime.warnedMissingKeys.has(id)) return;
  langTableRuntime.warnedMissingKeys.add(id);
  diagnostics.log('warn', `Missing translation key in texts/${locale}.lang (and en_US fallback): ${key}`, {
    source: 'localization',
    data: { code: 'MISSING_LANG_KEY', locale, key },
  });
}

/**
 * Resolve a preview string using texts/*.lang tables with en_US fallback.
 * Missing keys that "look like" localization keys are flagged.
 *
 * @param {string} raw
 * @param {string} activeLocale
 */
function resolvePreviewLocalizedText(raw, activeLocale) {
  const key = String(raw ?? '');
  if (!key) return '';
  const trimmed = key.trim();
  if (!trimmed) return key;
  if (trimmed.startsWith('#') || trimmed.startsWith('$')) return key;

  const active = getLangTableSync(activeLocale);
  const fallback = activeLocale === 'en_US' ? active : getLangTableSync('en_US');

  if (active && Object.prototype.hasOwnProperty.call(active, trimmed)) {
    return active[trimmed];
  }
  if (fallback && Object.prototype.hasOwnProperty.call(fallback, trimmed)) {
    return fallback[trimmed];
  }

  // Only flag missing keys when tables are loaded.
  if (active && fallback && looksLikeLangKey(trimmed)) {
    warnMissingLangKeyOnce(activeLocale, trimmed);
    // Keep the canvas readable. The exact missing key remains available in
    // Diagnostics, while the preview uses the same raw fallback text instead
    // of exposing an internal debug sentinel to the user.
    return trimmed;
  }

  return key;
}

/* --- S054: Reference validation support (global variables index) ------- */

const globalVarNamesRuntime = {
  generation: 0,
  status: 'idle', // idle | loading | ready | error
  names: new Set(),
  error: null,
  lastLoadedAtIso: null,
  source: {
    importedPackPath: null,
    importedOk: false,
    vanillaPackPath: null,
    vanillaOk: false,
  },
  inflight: null,
};

function resetGlobalVarNamesRuntime() {
  globalVarNamesRuntime.generation += 1;
  globalVarNamesRuntime.status = 'idle';
  globalVarNamesRuntime.names = new Set();
  globalVarNamesRuntime.error = null;
  globalVarNamesRuntime.lastLoadedAtIso = null;
  globalVarNamesRuntime.source = {
    importedPackPath: null,
    importedOk: false,
    vanillaPackPath: null,
    vanillaOk: false,
  };
  globalVarNamesRuntime.inflight = null;
}

/**
 * Extract variable names from ui/_global_variables.json.
 * Supports both "wrapped" ({variables:{...}}) and "bare" ({$foo:{...}}) styles.
 *
 * @param {any} doc
 * @returns {Set<string>}
 */
function extractGlobalVarNamesFromDoc(doc) {
  const names = new Set();
  if (!doc || typeof doc !== 'object') return names;

  const isWrapped =
    Object.prototype.hasOwnProperty.call(doc, 'variables') &&
    doc.variables &&
    typeof doc.variables === 'object' &&
    !Array.isArray(doc.variables);

  const varsObj = isWrapped ? doc.variables : doc;
  if (!varsObj || typeof varsObj !== 'object') return names;

  for (const k of Object.keys(varsObj)) {
    if (!k) continue;
    if (k === '$schema') continue;
    if (k.startsWith('$')) {
      names.add(k);
      continue;
    }
    // Some packs omit the '$' prefix inside the wrapped "variables" object.
    if (isWrapped) names.add(k);
  }
  return names;
}

/**
 * Best-effort: read a pack path with case-insensitive fallback when ZIP paths
 * use a different casing.
 *
 * @param {{
 *  desiredPackPath: string,
 *  packPaths: string[]|null,
 *  readTextFn: (packPath: string) => Promise<string>,
 * }} args
 */
async function readPackTextCaseInsensitive({ desiredPackPath, packPaths, readTextFn }) {
  try {
    return await readTextFn(desiredPackPath);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('ZIP_ENTRY_NOT_FOUND') && Array.isArray(packPaths)) {
      const caseIndex = buildPackPathCaseIndex({ packPaths });
      const actual = resolvePackPathCaseInsensitive({ caseIndex, packPath: desiredPackPath });
      if (actual && actual !== desiredPackPath) {
        return await readTextFn(actual);
      }
    }
    throw e;
  }
}

async function loadMergedGlobalVarNames() {
  const state = store.getState();
  const imported = state && state.pack ? state.pack.imported : null;

  const merged = new Set();
  const source = {
    importedPackPath: null,
    importedOk: false,
    vanillaPackPath: null,
    vanillaOk: false,
  };

  // Vanilla reference (base)
  if (vanillaReferenceRuntime && Array.isArray(vanillaReferenceRuntime.packPaths)) {
    const desired = 'ui/_global_variables.json';
    source.vanillaPackPath = desired;
    try {
      const text = await readPackTextCaseInsensitive({
        desiredPackPath: desired,
        packPaths: vanillaReferenceRuntime.packPaths,
        readTextFn: readVanillaReferenceText,
      });
      const parsed = parseJsonc(text, { filePath: desired });
      if (!parsed.ok) throw parsed.error;
      for (const name of extractGlobalVarNamesFromDoc(parsed.value)) merged.add(name);
      source.vanillaOk = true;
    } catch (_e) {
      // Missing or invalid vanilla global vars should not crash the app.
      // The validator will emit a single "context unavailable" warning when needed.
    }
  }

  // Imported pack overrides
  if (importedPackRuntime && imported) {
    const desired = getGlobalVariablesPackPath(imported);
    source.importedPackPath = desired;
    try {
      const text = await readPackTextCaseInsensitive({
        desiredPackPath: desired,
        packPaths: importedPackRuntime.packPaths,
        readTextFn: readImportedPackText,
      });
      const parsed = parseJsonc(text, { filePath: desired });
      if (!parsed.ok) throw parsed.error;
      for (const name of extractGlobalVarNamesFromDoc(parsed.value)) merged.add(name);
      source.importedOk = true;
    } catch (_e) {
      // It is valid for an imported pack to omit the file; vanilla may still provide it.
    }
  }

  return { names: merged, source };
}

function requestGlobalVarNamesLoad(reason = '') {
  if (globalVarNamesRuntime.status === 'loading') return globalVarNamesRuntime.inflight;

  globalVarNamesRuntime.status = 'loading';
  globalVarNamesRuntime.error = null;
  const generation = globalVarNamesRuntime.generation;

  const p = loadMergedGlobalVarNames()
    .then(({ names, source }) => {
      if (generation !== globalVarNamesRuntime.generation) return;
      globalVarNamesRuntime.names = names;
      globalVarNamesRuntime.status = 'ready';
      globalVarNamesRuntime.error = null;
      globalVarNamesRuntime.lastLoadedAtIso = new Date().toISOString();
      globalVarNamesRuntime.source = source;
      scheduleReferenceContextRevalidation();
    })
    .catch((e) => {
      if (generation !== globalVarNamesRuntime.generation) return;
      globalVarNamesRuntime.status = 'error';
      globalVarNamesRuntime.error = String(e && e.message ? e.message : e);
    })
    .finally(() => {
      if (generation === globalVarNamesRuntime.generation && globalVarNamesRuntime.inflight === p) {
        globalVarNamesRuntime.inflight = null;
        safeRender();
      }
    });

  globalVarNamesRuntime.inflight = p;
  return p;
}

/**
 * @returns {Set<string>|null}
 */
function getGlobalVarNamesSync() {
  if (globalVarNamesRuntime.status === 'ready') return globalVarNamesRuntime.names;

  // Auto-load on-demand if a pack source exists.
  if (globalVarNamesRuntime.status === 'idle' && (importedPackRuntime || vanillaReferenceRuntime)) {
    requestGlobalVarNamesLoad('auto');
  }
  return null;
}

/**
 * Visit bounded effective native-renderer property bags without assuming a
 * Vanilla screen name. Resource packs may place a supported renderer in any
 * namespace/control tree, so capability and export decisions are driven by
 * the resolved renderer property itself.
 */
function scanEffectiveNativeRenderers(uiModel, evaluatedPropsById, visitor, maximum = 50_000) {
  if (!uiModel?.root || typeof visitor !== 'function') return { complete: true, count: 0 };
  const stack = [uiModel.root];
  let inspected = 0;
  let count = 0;
  while (stack.length > 0) {
    if (inspected >= maximum) return { complete: false, count };
    const node = stack.pop();
    inspected += 1;
    const children = Array.isArray(node?.children) ? node.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    const evaluated = evaluatedPropsById && typeof evaluatedPropsById === 'object'
      ? evaluatedPropsById[String(node?.id || '')]
      : null;
    const props = mergeNativeRendererProps(node?.unknownProps, node?.props, evaluated);
    if (!props) return { complete: false, count };
    if (typeof props.renderer !== 'string' || !props.renderer.trim()) continue;
    count += 1;
    try {
      visitor(props, node);
    } catch {
      return { complete: false, count };
    }
  }
  return { complete: true, count };
}

function evaluateNativeRendererUsage(file, evaluatedPropsByIdOverride = null, mockDataOverride = undefined) {
  const uiModel = file?.uiModel || null;
  const qualifiedName = String(getSelectedPreviewQualifiedName(file) || '');
  let evaluatedPropsById = evaluatedPropsByIdOverride;
  if (!evaluatedPropsById && uiModel) {
    try {
      evaluatedPropsById = evaluateBindingsWithRepresentativeRuntime(
        uiModel,
        qualifiedName,
        mockDataOverride === undefined
          ? store.getState()?.preview?.mockData
          : mockDataOverride,
      )?.propsById || null;
    } catch {
      return { complete: false, evaluatedPropsById: null, renderers: new Set() };
    }
  }
  const renderers = new Set();
  const scan = scanEffectiveNativeRenderers(uiModel, evaluatedPropsById, (props) => {
    renderers.add(props.renderer.trim());
  });
  return { complete: scan.complete, evaluatedPropsById, renderers };
}

function buildReferenceContextForValidation(
  file = null,
  qualifiedNameOverride = '',
  uiModelOverride = null,
  contextOverride = null,
) {
  const state = store.getState();
  const hasPreviewLocaleOverride = contextOverride
    && Object.prototype.hasOwnProperty.call(contextOverride, 'previewLocale');
  const previewLocaleRaw = hasPreviewLocaleOverride
    ? contextOverride.previewLocale
    : state && state.ui ? state.ui.previewLocale : 'en_US';
  const previewLocale = SUPPORTED_PREVIEW_LOCALES.includes(previewLocaleRaw) ? previewLocaleRaw : 'en_US';

  const qualifiedName = String(qualifiedNameOverride || getSelectedPreviewQualifiedName(file) || '');
  const userVariables = contextOverride
    && Object.prototype.hasOwnProperty.call(contextOverride, 'mockData')
    ? contextOverride.mockData
    : state?.preview?.mockData;
  const validationModel = uiModelOverride || file?.uiModel || null;
  let evaluatedPropsById = null;
  if (validationModel) {
    try {
      evaluatedPropsById = evaluateBindingsWithRepresentativeRuntime(
        validationModel,
        qualifiedName,
        userVariables,
      )?.propsById || null;
    } catch {
      evaluatedPropsById = null;
    }
  }
  let usesHorseRenderer = false;
  let usesPlayerRenderer = false;
  if (validationModel) {
    scanEffectiveNativeRenderers(validationModel, evaluatedPropsById, (props) => {
      if (props.renderer === 'live_horse_renderer') usesHorseRenderer = true;
      if (props.renderer === 'live_player_renderer') usesPlayerRenderer = true;
    });
  }
  const horseSnapshot = usesHorseRenderer
    ? requestNativeHorsePreview()
    : nativeHorsePreviewState;
  const playerSnapshot = usesPlayerRenderer ? requestNativePlayerPreview() : nativePlayerPreviewState;
  const nativeTextureFailures = Object.create(null);
  let recordedTextureFailures = 0;
  for (const [cacheKey, code] of nativeTextureFailureCodes) {
    if (recordedTextureFailures >= MAX_NATIVE_TEXTURE_FAILURE_CODES) break;
    nativeTextureFailures[cacheKey] = code;
    recordedTextureFailures += 1;
  }
  return {
    importedIndex: importedPackRuntime ? importedPackRuntime.assetIndex : null,
    vanillaIndex: vanillaReferenceRuntime ? vanillaReferenceRuntime.assetIndex : null,
    langTable: getLangTableSync(previewLocale),
    globalVarNames: getGlobalVarNamesSync(),
    itemTextureAtlases: buildItemTextureAtlasReferenceContext(),
    evaluatedPropsById,
    nativeTextureFailures,
    nativeModelPreviews: {
      bookTextureRef: 'textures/entity/enchanting_table_book',
      horse: {
        status: horseSnapshot.status,
        textureRef: horseSnapshot.textureRef || '',
        textureRefs: Array.isArray(horseSnapshot.textureRefs) ? horseSnapshot.textureRefs : [],
        issue: horseSnapshot.issue || null,
        detail: horseSnapshot.detail || null,
        previewState: horseSnapshot.previewState || null,
        camera: horseSnapshot.camera || null,
      },
      player: { status: playerSnapshot.status, textureRef: playerSnapshot.textureRef || '',
        textureRefs: playerSnapshot.textureRefs || [], issue: playerSnapshot.issue || null,
        provenance: playerSnapshot.provenance || null },
    },
    runtimeVarNames: buildRepresentativeClassicRuntimeVariableNames({
      qualifiedName,
      userVariables,
    }),
  };
}

/* --- S026: _ui_defs.json management (screen registry) ------------------ */

/**
 * In-memory editor for ui/_ui_defs.json (list of UI screens to load).
 *
 * This state is kept outside the store for now (similar to importedPackRuntime),
 * because it depends on ZipReader (non-serializable) and is still a focused
 * feature (S026 only).
 *
 * @type {{
 *  status: 'idle'|'loading'|'ready'|'error',
 *  error: string|null,
 *  packPath: string|null,
 *  formatVersion: number,
 *  uiDefs: string[],
 *  dirty: boolean,
 *  newEntryText: string,
 *  lastLoadedAtIso: string|null,
 *  lastSavedAtIso: string|null,
 *  savedText: string,
 *  generation: number,
 *  sourceRuntime: any,
 *  sourceImportedState: any,
 * }}
 */
const uiDefsEditorState = {
  status: 'idle',
  error: null,
  packPath: null,
  formatVersion: 1,
  uiDefs: [],
  dirty: false,
  newEntryText: '',
  lastLoadedAtIso: null,
  lastSavedAtIso: null,
  savedText: '',
  generation: 0,
  sourceRuntime: null,
  sourceImportedState: null,
};

function resetUiDefsEditorState() {
  uiDefsEditorState.generation += 1;
  uiDefsEditorState.status = 'idle';
  uiDefsEditorState.error = null;
  uiDefsEditorState.packPath = null;
  uiDefsEditorState.formatVersion = 1;
  uiDefsEditorState.uiDefs = [];
  uiDefsEditorState.dirty = false;
  uiDefsEditorState.newEntryText = '';
  uiDefsEditorState.lastLoadedAtIso = null;
  uiDefsEditorState.lastSavedAtIso = null;
  uiDefsEditorState.savedText = '';
  uiDefsEditorState.sourceRuntime = null;
  uiDefsEditorState.sourceImportedState = null;
}

/**
 * @param {{ formatVersion: number, uiDefs: string[] }} params
 */
function buildUiDefsJsonObject(params) {
  const fv = Number.isFinite(params.formatVersion) ? Number(params.formatVersion) : 1;
  const defs = Array.isArray(params.uiDefs)
    ? params.uiDefs.map((s) => String(s || '').trim()).filter((s) => s.length > 0)
    : [];
  return {
    format_version: fv,
    ui_defs: defs,
  };
}

/**
 * Read a text file from the imported pack, honoring in-memory overrides.
 *
 * @param {string} packPath pack-relative path (e.g. "ui/_ui_defs.json")
 * @param {{ maxTextBytes?: number }} [options]
 * @returns {Promise<string>}
 */
async function readImportedPackText(packPath, options = {}) {
  if (!importedPackRuntime) throw new Error('PACK_NOT_LOADED');
  const p = String(packPath || '');
  const override = importedPackRuntime.overridesTextByPackPath
    ? importedPackRuntime.overridesTextByPackPath[p]
    : undefined;
  if (typeof override === 'string') return override;

  const zipPath = `${importedPackRuntime.rootPrefix}${p}`;
  return importedPackRuntime.zipReader.readText(zipPath, {
    maxBytes: Number.isFinite(options.maxTextBytes)
      ? Math.max(0, Number(options.maxTextBytes))
      : DEFAULT_ZIP_LIMITS.maxTextFileBytesForRead,
    encoding: 'utf-8',
  });
}

/**
 * Non-throwing adapter used by best-effort export assembly.
 * The interactive editor intentionally continues to use readImportedPackText,
 * which returns a raw string and throws on failure.
 *
 * @param {string} packPath
 * @param {{ maxTextBytes?: number }} [options]
 */
async function readImportedPackTextResult(packPath, options = {}) {
  return captureTextRead(() => readImportedPackText(packPath, options));
}

/**
 * Open and resolve a UI definition from the preview stack, and populate the
 * editor Tree with its element hierarchy.  The imported pack remains the
 * editable target; an optional Vanilla pack is a read-only base/fallback.
 *
 * Property editing is intentionally read-only at this stage. Tree structure edits are enabled in S032.
 *
 * @param {string} requestedPackPath
 * @param {string|null} [requestedDefinition]
 */
async function openUiScreenFromImportedPack(requestedPackPath, requestedDefinition = null, options = {}) {
  assertStudioProjectionChange21(options);
  const expectedGeneration = screenOpenState.generation + 1;
  try {
    return await openUiScreenFromImportedPackInternal(requestedPackPath, requestedDefinition, options);
  } catch (error) {
    if (screenOpenState.generation === expectedGeneration && screenOpenState.status === 'loading') {
      screenOpenState.status = 'error';
      screenOpenState.error = error instanceof Error ? error.message : String(error || 'UI_OPEN_FAILED');
      safeRender();
    }
    throw error;
  } finally {
    // A foreground open may have held a pending composition refresh. Resume
    // only after its terminal state, never by superseding it in the background.
    if (!projectionRefreshRunning) drainProjectionRefreshQueue();
  }
}

async function openUiScreenFromImportedPackInternal(requestedPackPath, requestedDefinition = null, options = {}) {
  const openGeneration = ++screenOpenState.generation;
  let catalogGeneration = null;
  let guardedProjectionIdentity = options.expectedProjectionIdentity || null;
  const isExpectedProjectionOpen = () => !guardedProjectionIdentity
    || isOpenPreviewProjectionIdentity(store.getState(), guardedProjectionIdentity);
  const isCurrentOpen = () => openGeneration === screenOpenState.generation
    && (catalogGeneration === null || catalogGeneration === uiCatalogState.generation)
    && isExpectedProjectionOpen()
    && (typeof options.canCommit !== 'function' || options.canCommit());
  const superseded = () => {
    if (openGeneration === screenOpenState.generation && typeof options.canCommit === 'function' && !options.canCommit()) {
      const files = store.getState()?.files;
      screenOpenState.status = files?.openFileIds?.some(id => files.byId?.[id]?.meta?.previewProjection) ? 'ready' : 'idle';
      screenOpenState.error = null;
      safeRender();
      return { ok: false, code: 'UI_INTERACTION_NAVIGATION_CANCELLED', error: 'UI_INTERACTION_NAVIGATION_CANCELLED' };
    }
    // Closing a projection is an explicit user decision. If its stable lifetime
    // token no longer names an open tab while background replacement awaits I/O,
    // terminate the open without leaving the shared picker in `loading`.
    if (guardedProjectionIdentity && openGeneration === screenOpenState.generation && !isExpectedProjectionOpen()) {
      const files = store.getState()?.files;
      const hasRemainingProjection = files?.openFileIds?.some((id) => files.byId?.[id]?.meta?.previewProjection);
      screenOpenState.status = hasRemainingProjection ? 'ready' : 'idle';
      screenOpenState.error = null;
      safeRender();
      return { ok: false, code: 'UI_PROJECTION_CLOSED', error: 'UI_PROJECTION_CLOSED' };
    }
    return { ok: false, code: 'UI_OPEN_SUPERSEDED', error: 'UI_OPEN_SUPERSEDED' };
  };

  if (!importedPackRuntime && !vanillaReferenceRuntime) {
    screenOpenState.status = 'error';
    screenOpenState.error = siteText('リソースパックを読み込んでください。');
    safeRender();
    return { ok: false, error: screenOpenState.error };
  }

  const state = store.getState();
  const imported = state.pack?.imported || (vanillaReferenceRuntime ? { id: vanillaReferenceRuntime.zipReader?.nodePackId || 'vanilla-only' } : null);
  if (!imported) {
    screenOpenState.status = 'error';
    screenOpenState.error = 'No imported pack state is available.';
    safeRender();
    return { ok: false, error: screenOpenState.error };
  }

  let packPath;
  try {
    packPath = normalizePackPath(requestedPackPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || 'UNKNOWN');
    screenOpenState.status = 'error';
    screenOpenState.error = `Invalid screen path: ${msg}`;
    safeRender();
    return { ok: false, error: screenOpenState.error };
  }
  const fileId = `screen:${packPath}`;
  if (!guardedProjectionIdentity) {
    const existingIdentity = readPreviewProjectionIdentity(store.getState()?.files?.byId?.[fileId]);
    if (existingIdentity && isOpenPreviewProjectionIdentity(store.getState(), existingIdentity)) {
      guardedProjectionIdentity = existingIdentity;
    }
  }
  if (guardedProjectionIdentity && guardedProjectionIdentity.fileId !== fileId) return superseded();

  screenOpenState.status = 'loading';
  screenOpenState.error = null;
  safeRender();

  let textSource = '';
  let parsed = null;
  let rootJson = null;
  let resolution = null;
  let sourceEditPreviewOptions = null;
  let selected = null;
  let selectedSourceKind = 'imported';

  // Build the cross-file symbol catalog before choosing a definition. The
  // catalog reads JSON/JSONC only; textures and other heavy assets remain lazy.
  let catalog = uiCatalogState.status === 'ready' ? uiCatalogState.catalog : null;
  if (!catalog) {
    catalog = await requestUiCatalogBuild('open-screen');
    if (!isCurrentOpen()) return superseded();
  }
  if (!catalog || uiCatalogState.status !== 'ready' || catalog !== uiCatalogState.catalog) {
    screenOpenState.status = 'error';
    screenOpenState.error = uiCatalogState.error || 'UI_CATALOG_UNAVAILABLE';
    safeRender();
    return { ok: false, code: 'UI_CATALOG_UNAVAILABLE', error: screenOpenState.error };
  }
  catalogGeneration = uiCatalogState.generation;
  const definitions = listEffectiveDefinitionsForPath(catalog, packPath);
  if (definitions.length) {
    const requested = String(requestedDefinition || '').trim();
    try { selected = selectUiDefinition(definitions, requested); }
    catch (error) {
      screenOpenState.status = 'error'; screenOpenState.error = error.message; safeRender();
      return { ok: false, code: error.message, error: error.message };
    }

    if (!selected) {
      screenOpenState.status = 'error';
      screenOpenState.error = siteText`UI定義が見つかりません: ${packPath}`;
      safeRender();
      return { ok: false, error: screenOpenState.error };
    }

    if (selected.profile === 'pocket') {
      screenOpenState.status = 'error';
      screenOpenState.error = siteText`POCKET_PREVIEW_BLOCKED: ${selected.localName} は読込・索引のみ可能です。`;
      screenOpenState.selectedDefinition = selected.id;
      safeRender();
      return { ok: false, error: screenOpenState.error, code: 'POCKET_PREVIEW_BLOCKED' };
    }

    selectedSourceKind = selected.sourceKind === 'vanilla' ? 'vanilla' : 'imported';
    const sourcePath = selected.filePath || packPath;
    try {
      textSource = selectedSourceKind === 'vanilla'
        ? await readVanillaReferenceText(sourcePath)
        : await readImportedPackText(sourcePath);
      if (!isCurrentOpen()) return superseded();
    } catch (err) {
      if (!isCurrentOpen()) return superseded();
      const code = err instanceof Error ? err.message : String(err || 'UNKNOWN');
      screenOpenState.status = 'error';
      screenOpenState.error = `Failed to read ${sourcePath} from ${selectedSourceKind}: ${code}`;
      safeRender();
      return { ok: false, error: screenOpenState.error };
    }
    parsed = parseJsonc(textSource, {
      fileName: sourcePath,
      allowTrailingComma: true,
      allowEmptyContent: false,
    });
    if (!parsed.ok) {
      screenOpenState.status = 'error';
      screenOpenState.error = parsed.errors && parsed.errors.length
        ? parsed.errors[0].message
        : `Failed to parse ${sourcePath}.`;
      safeRender();
      return { ok: false, error: screenOpenState.error };
    }

    // Let the loading state paint before the bounded but synchronous resolver
    // expands a dense Vanilla-backed definition. This also gives a newer UI
    // selection one event-loop turn to supersede the pending request.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!isCurrentOpen()) return superseded();
    const previewMockData = store.getState()?.preview?.mockData;
    const previewCollectionData = previewMockData?.__collections && typeof previewMockData.__collections === 'object'
      && !Array.isArray(previewMockData.__collections)
      ? previewMockData.__collections
      : {};
    const resolveOptions = {
      catalog,
      recordId: selected.id,
      eventFactorySelections: previewMockData?.__event_factory_selections,
      variables: buildRepresentativeClassicResolverVariables({
        qualifiedName: selected.qualifiedName,
        userVariables: previewMockData,
      }),
      representativeCollections: buildRepresentativeClassicCollections({
        qualifiedName: selected.qualifiedName,
        collectionData: previewCollectionData,
      }),
    };
    sourceEditPreviewOptions = { variables: resolveOptions.variables, representativeCollections: resolveOptions.representativeCollections,
      ...(resolveOptions.eventFactorySelections ? { eventFactorySelections: resolveOptions.eventFactorySelections } : {}) };
    resolution = catalog.nodeCatalogId ? await resolveNodeUi(resolveOptions, options.signal) : resolveEffectiveUi(resolveOptions);
    if (!isCurrentOpen()) return superseded();
    if (!resolution.ok) {
      const code = resolution.error && resolution.error.code ? resolution.error.code : 'UI_RESOLVE_FAILED';
      screenOpenState.status = 'error';
      screenOpenState.error = `${code}: ${selected.qualifiedName}`;
      screenOpenState.lastResolution = resolution;
      safeRender();
      return { ok: false, error: screenOpenState.error, code };
    }

    rootJson = resolution.document;
    screenOpenState.selectedDefinition = selected.id;
  } else {
    screenOpenState.status = 'error';
    screenOpenState.error = siteText('UI_DEFINITION_NOT_REGISTERED: ui/_ui_defs.json と診断を確認してください。');
    safeRender();
    return { ok: false, code: 'UI_DEFINITION_NOT_REGISTERED', error: screenOpenState.error };
  }

  const catalogFile = selected
    ? findCatalogFile(catalog, selectedSourceKind, selected.filePath || packPath)
    : findAnyCatalogFile(catalog, packPath);
  // S029: Internal UI model normalization
  const uiModel = buildUiScreenModelFromJson(rootJson, {
    filePath: packPath,
  });

  // S028/S032/S048: Build tree nodes for editor/preview from UiScreenModel.
  // IMPORTANT: Use the model-derived tree so ids match UiNode.id and unknown props
  // (e.g., placeholder_text / keep_ratio / grid_position) remain available.
  const tree = buildTreeFromUiScreenModel(uiModel);
  const treeStats = tree && tree.stats ? tree.stats : { nodeCount: Object.keys(tree.nodesById || {}).length, maxDepth: 0 };

  // S039: Baseline validation (schema-ish) for supported types/properties.
  const uiModelValidation = resolution?.nodeProjectionId
    ? (await nodeValidatePreview({ projectionId: resolution.nodeProjectionId, filePath: packPath,
        recordId: resolution.selected?.recordId, mockData: store.getState().preview?.mockData || {},
        locale: store.getState().ui?.previewLocale || 'en_US' }, options.signal)).validation
    : validateUiScreenModel(uiModel, { filePath: packPath, sourceJson: rootJson,
        supportedTypes: VALID_UI_ELEMENT_TYPES,
        referenceContext: buildReferenceContextForValidation(null, selected?.qualifiedName || '', uiModel) });

  // S030: Deterministic serialization back to JSON
  const uiModelOutputText = uiScreenModelToJsonText(uiModel, {
    indent: 2,
    sortKeys: false,
    finalNewline: true,
  });

  // Summary for UI/debug panels
  const uiModelSummary = summarizeUiScreenModel(uiModel);

  // This model is a resolved, single-definition preview projection. It is not
  // the original multi-definition source document, so editing or serializing
  // it back to the same pack path would discard sibling definitions and
  // flatten inheritance. Keep the projection inspectable but read-only.
  if (!isCurrentOpen()) return superseded();
  const activeFileIdBeforeCommit = options.preserveActiveFile
    ? String(store.getState()?.files?.currentFileId || '')
    : '';
  const projectionInstanceId = String(guardedProjectionIdentity?.instanceId || uuidv4());
  const preparedFile = {
      id: fileId,
      path: packPath,
      kind: 'screen',
      dirty: false,
      rootId: tree.rootId,
      nodesById: tree.nodesById,
      readOnly: true,
      treeEditable: false,
      sourceText: textSource,
      sourceJson: parsed.value,
      validationSourceJson: rootJson,
      modelOutputText: uiModelOutputText,
      uiModel,
      validation: uiModelValidation,
      meta: {
        source: selectedSourceKind === 'vanilla' ? 'vanillaReference' : 'importedPack',
        previewProjection: true,
        sourceEditPreviewOptions,
        previewProjectionInstanceId: projectionInstanceId,
        navigationCatalogGeneration: catalogGeneration,
        originalDefinitionCount: definitions.length || (catalogFile ? listDefinitionsForFile(catalog, catalogFile.id).length : null),
        importedPackId: imported.id || null,
        treeStats,
        uiModelSummary,
        selectedDefinition: resolution && resolution.selected ? { ...resolution.selected, rawKey: selected.rawKey } : screenOpenState.selectedDefinition,
        resolution: resolution
          ? {
              semanticsProfile: resolution.semanticsProfile,
              previewContext: resolution.previewContext || null,
              provenance: resolution.provenance,
              dependencyTrace: resolution.dependencyTrace || null,
              nodeSources: resolution.nodeSources || null,
              diagnostics: resolution.diagnostics,
              stats: resolution.stats,
              animationDefinitions: resolution.animationDefinitions || null,
              nodeProjectionId: resolution.nodeProjectionId || null,
            }
          : null,
      },
    };
  if (options.prepareOnly) return { ok: true, file: preparedFile, fileId, packPath, definition: selected.id, resolution };
  if (typeof options.onBeforeCommit === 'function') options.onBeforeCommit();
  dispatchStudioProjection21(actions.openFile(preparedFile), options);
  if (activeFileIdBeforeCommit && activeFileIdBeforeCommit !== fileId) {
    const afterCommit = store.getState();
    if (afterCommit?.files?.openFileIds?.includes(activeFileIdBeforeCommit)) {
      dispatchStudioProjection21(actions.setCurrentFile(activeFileIdBeforeCommit), options);
    }
  }

  screenOpenState.status = 'ready';
  screenOpenState.error = null;
  screenOpenState.lastOpenedPath = packPath;
  screenOpenState.lastOpenedDefinition = resolution && resolution.selected
    ? resolution.selected.recordId
    : screenOpenState.selectedDefinition;
  screenOpenState.lastOpenedAtIso = new Date().toISOString();
  screenOpenState.selectedPath = packPath;
  screenOpenState.lastResolution = resolution;
  if (sourceWorkspace.state.mode === 'edit' && sourceWorkspace.state.workspaceId && !sourceWorkspace.state.busy) {
    void ensureSourceWorkspace(packPath, workspacePreviewSourceId(preparedFile)).catch(reportWorkspaceError);
  }
  safeRender();
  setStatus(`Loaded UI: ${packPath}#${screenOpenState.lastOpenedDefinition || ''}`);

  return { ok: true, fileId, packPath, definition: screenOpenState.lastOpenedDefinition, resolution };
}

/** Re-resolve the current projection after adding/removing the Vanilla base. */
async function refreshCurrentPreviewAfterCompositionChange() {
  return requestProjectionRefreshAfterCompositionChange();
}

async function rebuildOpenPreviewProjections(options = {}) {
  assertStudioProjectionChange21(options);
  if (!importedPackRuntime && !vanillaReferenceRuntime) return;
  if (screenOpenState.status === 'loading') {
    return { ok: false, code: 'UI_OPEN_SUPERSEDED', error: 'UI_OPEN_SUPERSEDED' };
  }
  // Every open preview projection was flattened against the previous pack
  // stack. Keep the old projection until its replacement has resolved: a
  // foreground open may supersede this batch, and must never make unrelated
  // tabs disappear. A terminal failure closes only that one stale projection.
  const state = store.getState();
  const openIds = Array.isArray(state?.files?.openFileIds) ? state.files.openFileIds.slice() : [];
  const activeFileId = String(state?.files?.currentFileId || '');
  const projections = openIds.map((id) => {
    const file = state?.files?.byId?.[id];
    if (!file?.meta?.previewProjection || typeof file.path !== 'string') return null;
    const identity = readPreviewProjectionIdentity(file);
    if (!identity) return null;
    const selectedDefinition = file.meta.selectedDefinition;
    const recordId = selectedDefinition && typeof selectedDefinition === 'object'
      ? selectedDefinition.recordId
      : selectedDefinition;
    return {
      fileId: String(id),
      path: file.path,
      definition: String(recordId || '').trim() || null,
      wasActive: String(id) === activeFileId,
      identity,
    };
  }).filter(Boolean);
  if (!projections.length) {
    return { ok: true, code: 'UI_PROJECTION_REFRESH_NOOP' };
  }
  // Reopen the active projection last so the user's selected tab and global
  // screen picker remain stable. Every open projection is rebuilt against the
  // same mock/runtime environment; none is left silently stale.
  projections.sort((left, right) => Number(left.wasActive) - Number(right.wasActive));
  let activeResult = null;
  let lastResult = null;
  const failures = [];
  let ownedGeneration = screenOpenState.generation;
  for (const projection of projections) {
    if (!isOpenPreviewProjectionIdentity(store.getState(), projection.identity)) {
      continue;
    }
    // A direct user selection owns any newer generation. Stop the background
    // rebuild before it can launch the next projection and supersede that
    // foreground open.
    if (screenOpenState.generation !== ownedGeneration) {
      return { ok: false, code: 'UI_OPEN_SUPERSEDED', error: 'UI_OPEN_SUPERSEDED' };
    }
    let result;
    try {
      result = await openUiScreenFromImportedPack(
        projection.path,
        projection.definition,
        { preserveActiveFile: true, expectedProjectionIdentity: projection.identity, workspaceRefreshToken: options.workspaceRefreshToken },
      );
    } catch (error) {
      result = {
        ok: false,
        code: 'UI_PROJECTION_REFRESH_FAILED',
        error: String(error?.message || error || 'UI_PROJECTION_REFRESH_FAILED'),
      };
      diagnostics.captureError(error, {
        module: 'uiScreenOpen',
        where: 'rebuildOpenPreviewProjections',
        path: projection.path,
      });
    }
    if (result?.code === 'UI_OPEN_SUPERSEDED') return result;
    ownedGeneration = screenOpenState.generation;
    if (result?.code === 'UI_PROJECTION_CLOSED') continue;
    lastResult = result;
    if (!result?.ok) {
      failures.push({
        path: projection.path,
        code: String(result?.code || 'UI_PROJECTION_REFRESH_FAILED'),
        error: String(result?.error || result?.code || 'UI_PROJECTION_REFRESH_FAILED'),
      });
      if (isOpenPreviewProjectionIdentity(store.getState(), projection.identity)) {
        dispatchStudioProjection21(actions.closeFile(projection.fileId), options);
      }
    }
    if (projection.wasActive) activeResult = result;
  }
  if (failures.length > 0) {
    return {
      ok: false,
      code: 'UI_PROJECTION_REFRESH_FAILED',
      error: failures[0].error,
      failures,
    };
  }
  return activeResult || lastResult || { ok: true, code: 'UI_PROJECTION_REFRESH_NOOP' };
}


/* --- S050: Export resource pack ZIP (UI_PLUS_DEPS) -------------------------------- */

/**
 * A small built-in pack icon PNG used when the imported pack has no pack_icon.png.
 * 256x256 RGBA.
 */
const DEFAULT_EXPORT_PACK_ICON_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAXQElEQVR4nO3de2BMZ94H8O8kYSa3iUREJETcEkElJNHWdlGKiiARlKZutW5Lm+LdV7vrpez2bekFpbYtpcSlKgRvUC0l27qGIqJpEi1JSMhNLpPLNJmZ9w/LIjNnLplI4vl+/mrnOed3nkw73znneZ5zRubp2VYHIhKSTUN3gIgaDgOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoHZGdtg7964x9EPIqoHERFjJNt5BkAkMAYAkcAYAEQCMzoG8Chj1xRE1HDMHbPjGQCRwBgARAJjABAJjAFAJDAGAJHAGABEAmMAEAnM7HUAxjzzXra1SxLRv51+s51V6/EMgEhgDAAigVn9EuBB1j5dIRJRfV5W8wyASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiARm19AdaEzkcjkGDhyA4ODe6N69Ozw9W8PZ2Rn29g6orv4dlZWVuHOnGLm5ucjJyUVGRgbS0tKRmvoLSktLrdIHhUKBP/yhL0JCeiMgIADe3t5wc3OFQmEPrVaDiooK5OfnIzMzCykpV3Dy5GkkJydDp9NZ5fgkliYbAD4+Pvj224MG25OSzmHixCkm1ZLL5Zg9eyYmTHgJLi4uerextVVAoVDA1dUVHTt2eKhNp9MhPT0DZ88mYc2atSgtLTP577jHx8cHf/rTVIwcOQIKhcJAH2zg4uICFxcXdO7cGYMGDURMzGvIzb2FHTu+QmzsNlRWVpp9XKn3EQDy8vIwZMgwVFWpjdYLCOiK+Pg4g+2zZs3B8eOJFvXFnP+m77//HkaMCDfYPmnSVJw9m1Tv/WjshL8E8PX1xd69uzFr1gyDH35jZDIZ/P39MHFiNNzd3c3a187ODvPnx+Dgwf0YN26swQ+/lDZtPDF//hv49tuDGDx4kNn7G+Ph4YHo6JetXpcantAB0KaNJzZt2oAOHXwb5Phubq7Ytm0LZsyYDju7up+MtWrVCmvWrMbChf8FmUxmhR7+x/Tp0+Dk5GTVmtTwhA6AJUv+B23aeDbIsVu0aIGtW7cgMLCn1WtPnToFS5cusWrNFi1aYOrUyVatSQ1P2AAICgrEgAH9G+TYtrY2WLt2da2xBGsaN24Mpk2batWaU6ZMgqurq1VrUsNqsoOAdTV06GDJ9uTky9ixYyeSk5ORm3sLanUV5HIFnJ2d4OXlhS5dOiMgIABPP93H7A/ytGnTEBISbHS7c+fOY/fueCQlJaGgoADNmzdHmzZtMGBAf4wf/5LRs5d582Lw448nkJaWblb/DHF0dMSMGX/C8uXvW6UeNTxhA6BPnz4G244cOYrXX58HrVb70OsVFRWoqKjA7dt5uHDh4v3XPTw8MGTIYISHh0GrlZ6Oc3d3x+zZMyS30Wi0WLp0Gb7++uHR9KoqNUpLy5CWlo7Y2G1YunSx5Ei3nZ0dFi78C159dbrk8czx8svj8eWXm3H7dp7ValLDEfYSwMOjlcG2LVu21vrwS8nLy8PWrdswfnw0rl+/LrntxInRsLe3l9xm0aLFtT78j6qoqMDChX/Fd98dldyub99n0b17N8ltzCGXyzFnzmyr1aOGJWwAODsrDbbZ2trWyzFlMhlGj46Q3CYx8V+Ij99rUj2tVou3315qdN3B2LFjTOyhaaKiRsPHx8eqNalhCBsA5eXlBtumTJkEW1vrvzU9ez6FVq0Mn3kAwNq168yqWVhYhO3bd0hu8/zzA8yq+SCNRlPrNVtbW8TEzLW4JjUewgbAzZs3Dbb1798P+/bFY9KkV6y6RiA4uLdke2ZmJi5fTjG77r59+yXbW7f2QLt2bc2uCwC7d+/R+3pY2DD4+XWxqCY1HsIGwJkzZyXbO3fuhL/+9U0cOpSAM2dOYOPG9ViwYB5efHGo0W9xQ7p27SrZnpR03qK6165dR2FhkeQ2AQEBFtU+c+YsTp06Xet1mUyGefNiLKpJjYewAbBrVxw0GtMG+lxcXNC377OYPn0aVq36ED/8cAzffJOAt95aiB49upt8zLZtvSXbU1N/MbnWo9LS0iTbvb29LK69cuVqva8///wABAYGWlyXGp6wAZCVlY2NGzdZvL+vry8mT56IuLid2LlzG0JDQ4zu07Klm2R7QUGBxf3Jz5fet2XLlhbXTk6+jCNH9M82zJ/Ps4CmTNgAAIBVq1bjwAHpO+FMERgYiNjYL7FgwTzY2Bh+SxUK6ek/qYFJY1QqlWS7QiG3uDYArFq1Ru/U6NNP90Hfvs/WqTY1HKEDQKPRYsGC/8Y777xr0S28j5o+fRpef93y0fG63dMvvW9dbw66evUqEhL0h+Ubb7xep9rUcIQOgHtiY7dh8OAX8eGHK40u5DFm5szp8Pf309umVldJ7luXu+2cnJwl2ysrpY9tijVr1qKmpqbW6z17PoUXXrD+bchU/xgA/1ZSUoL167/Aiy+GY+jQ4Xj77WVISDggOV2oj0wmM3jXnLGRend3y6/Tje1r7NimyM6+gbg4/dOCMTFzJS9/qHES9l4AKZmZmcjMzMRXX30N4O76/dDQYDz77LMYMuQFtGjRQnJ/Q9fEN27cQK9eQQb3MzZNKKVrV3/J9pycHItrP2jduk8RETGq1phCly5dMGLEcKSnZ1hc+/ffpZ84ZM4KTTu7ZpLtavXvJtd6kjGyTVBQUIBDhw5j8eK30b//IHz++QbJ7T08PKBU1l5qbGyaLzTU+B2C+nTo4Gt0lD81NdWi2o/Ky8szuPJw7tw5dXqwibFxGAcHB5NrOThID7iWlJSYXOtJxgAwk1qtxkcfrdK7OOZB+s4Szp+/ILmPr6+vWesK7hk5coRke15eHrKyss2ua8jnn2/QO+vQrl1bjB0bZXHdiooKvWMM93h5mb6Wwdtbes1FaSkDAGAAWOzcOelVe/r+R758+bLRuf65c+eY1Q83N1dER0+Q3ObYseNm1TSmuLgYX365RW9bVNToOtW+ceOGwTal0hk+Pu2M1nBycoKvb3uD7SqVCsXFDABA4ABYtmwJpk6dbPHIu7EHiBYV1R5002q12LMnXnK/AQP6ITIywqQ+2NjYYOnSJXovNx5kaOCuLjZt2ow7d+7Uer2ud1I++JwFfYYPDzNaY9iwoZKXIpcuJZt1u/eTTNgA8PLywsKFf8Hx40ewePEihIQEmzxX3qGDLyIiRhlsLywsQlWV/mm32NjtRh/d/Y9/LDN6Ku3g4IDly/8Xgwe/ILndqVOnLbrByJjy8nKjYyGWMHZmNW3aVHTpYvgmJC8vL6NrMc6f/8mivj2JhA2Ae5ycnPDyy+OxdetmJCYexfLl7yI6+mUEBQXCy8sLjo6OsLW1gVKpRFBQIObPj0Fc3E4olYbn3U+dOmWwLT8/H599tl6yT7a2Nvj735di69bNiIgYhbZtvSGXy+Hs7AR/fz/MmDEdBw7sl3waEHD3MmTFig+k34A62L79K9y6dduqNQ8f/k5yVaOTkxO2b4/F7Nkz0blzZygUcsjlcrRv3x6TJ0/Erl1fSd6spdFoEB+/z6p9bso4DfgADw8PjBo1AqNGSQ+qGfPNN99Ktq9f/wX69+8nOSUIACEhwSY9O9CQjz9eW6cbjIxRq9VYt+5TLFtmvScQq1QqfP11HF59dYrBbZydnRAT8xpiYl4zu/6BA4eQm5tbhx4+WYQ/A7A2qRtn7tFoNJgz57U6rzqUsmdPfL2coj9q9+49yMrKsmrNTz/9zKqzFvcUFhbhww8/snrdpqzJBoCx6/WGGOQpLi7GW2/9zaRti4ruIDp6ElJSrli9H7Gx2/C3vy22el19NBoNPv74E6vWLC0tw9y5r9fp5qhHVVdX44035vNhpo9osgHg5OQo2W5sUYm5S3yNycnJwbRpM/Drr7+ZvE9hYREmTHgFX3yxSXL+2/R6hYiJmY933nn3sf5Y6IEDB6326PF70tMzMHbseGRkWL6y8J6bN29iwoRXkJR0zgo9e7I02QDo3LmTZLuxlV5LlizDwIFD8MEHH+HChYsWfwBLSkqwYcNGDB8+Cleu/Gz2/tXV1Xj//Q8RHh6BuLg9Jv0A56Nu3bqNlStXY8iQMBw+LD3+UB90Oh1Wr15j9bq//XYNY8eOx/LlH1gU2AUFBViz5hNERo6plzOtJ0GTHQQcNmyYZLspa99zcnKwYcNGbNiwEQqFAr1790KPHj3QsaMvfH194eHRCo6OjnB0dIROp4NKpYJKVY7s7Gykpv6CCxcuIjHxX6iurq7z33P9+nUsWrQY77zzLp57ri+Cg4MRENAVbdt6w9XVFXK5AjqdFhUVlcjPz0dW1r2fBz/VKOa1v//+GC5evISgIOs+IaiqSo1Nm77Eli1bEBoail69ghAUFIh27dpBqXSGs7MzZDIZyspUKC0tRW5uLi5evISLFy/h1KnTVvlv8yRrkgEwfHgYBgzoJ7mNuad7VVVVOHnyFE6eNDyF9zhUVlbiu++OGn3ev7VkZWWha9ceVqk1fny0Veroo9Focfr0GZw+fabejnGPNd+Txq7JBIC9vT06deqIyMgITJjwkuS2FRUVuHQp+TH1jKjpavQBMHJkOFaseM+sfbZu3Y7ff+ftnkTGNNlBQEPu3LmDTZs2N3Q3iJqEJyoAqqurMXdujN6bVIioticmAPLz8zFz5p95oweRGRr9GIAxZWUq7N27D5988k8UFxc3dHeImpQmEwAajQYqlQplZSrk5uYiJeUKkpOTcexYosFbb4lIWqMPgP37E7B/f0JDd4PoifTEjAEQkfkYAEQCYwAQCYwBQCQwBgCRwBgARAJjABAJjAFAJDAGAJHAGABEAmMAEAmMAUAkMAYAkcAYAEQCYwAQCYwBQCQwBgCRwBr9E4GaqgUL3kCrVu5Gt9u8ORapqWkAAD+/Lnj11cmoqqrCypUfo6SkVO8+48ZFoXfvXkhNTcPmzbGSx6ypqUFpaRmuXbuOH374Ebdu3dZb08bGBr16BeKpp3rA29sLDg4OUKt/R1FREdLS0nHy5GnJX+vVd2yNRoPy8nJkZ9/E2bNJSEtLh729AkuWLDL6vjzqyJHvceTI92bvR9IYAI1IenoGkpLOIzQ0GKNHR2DTpi21tunRoxt69+6F8vIK7N4db7SmnZ0d3Nxc4ebmiqCgnti+fWetHzF1c3PFpEmvwNOz9UOvOzjYw8HBG23beuO55/pi167dSEkx/QdQbW1toVQq0b27Et27B+Do0WP48ccTJu9P9Y8BUM+2bduBy5dN/2XahISD8PPrDH9/P4SE9Ma5c/95zLmTkxMiIyMAAPHxe6FSqYwe095eAR8fH4wYEQZ3d3eMGROJq1d/hVqtvl9z1qwZUCqdUVlZhePHE5GScgXFxSVQKOTo0MEXAwc+Dy+vNoiOnoDY2G34+edfTPp75XI5Wrf2wNChg9GpU0cMHDgAFy9ewptv1j4DCA7ujbFjRyM39xZWr15r8vtFdcMxgEZGrVYjLu7uN3t4eBiUSuX9tqioSDg6OuCnny6Y/E1cWVmFtLR0bN68FVqtFvb29vDz63K/PTJyFJRKZ6hU5Vi37lMkJv6AwsKif5++VyAl5WesW/cZ0tLSIZPJMGZMFOztFSb/LVlZ2diyZRvUajVkMpnRn3Wnx4sB0AhlZFxFUtI5KBQKREVFAAD69AlFQIA/iouLsX//AbNr5ucXoKioCADg7t4SANCqVSt069YVwN2nL+fnF+jdt6amBjt3xqGqqgoODvbo06ePWcdWq9UoKrr7a0329vZm953qDwOgkUpIOISSkhL4+/th8OBBCA8fBp1Oh1279ljtdxACAvwhk8lQWlqGy5dTJLetqKjAhQuX7u9nDrlcjpYt3QCAP97SyDAAGqkHLwUGDXoezZs3x4kTp/Drr79ZVK9VK3e4ud39EBYUFAIAvL29AACZmZnQ6XRGa1y7dv2h/YyRy+Vo394HU6ZMRPPmzVFeXoErV1It6D3VFw4C1rPo6AkG22pqarBo0dsG2zMyriItLR3+/n6oqqrC4cPfmX18hUKB9u19EB4eBhsbG1RWViEj4yoAwNHREQBQWlpmUq2ysrvbNWvWDM2aNUN1dXWtbQz9vfn5+dix4+v7g4/UODAAGjFPz9bo1KkjgLsf5KCgnkhKOm90P0MfQo1Ggz174mtdQpjy7V8XNTU1+P7748jJya3X45D5GAD1zNxpwHtsbW3x0ktjYWdnh9TUXxAQ0BXh4WFIT88wuEBIH41G89BCoNzcW/fb7i3sUSqdTarl7Hx3u+rqar3f/sB//l6ZTAYnJyf07h2EoUMHY9y4MaiqUiM11fAUIj1+DIBGasiQF9CmjSeys28gNnY7IiNHITQ0GFFRkdi4cbPkvqaGzs2bOQgM7AlfX1/IZDKjZwIdOvje388YnU6HsrIyJCb+AK1Wh+HDX8To0aOwYsWvBsODHj8OAjZCvr7t0a/fc6iursbOnXHQarVISDiIkpIS+Pl1QWhosFWOk5qaBp1OB6XSGU891UNyWwcHBwQFBd7fzxwnTpxEQUEBnJ2d0bfvMxb3l6yPAdDIyOVyjBs3BjKZDAcPfoOCgrtz848uEHJxUUqVMUl+fv79VX0jR4YbvHfh7uXIGNjbK1BZWYmzZ8+adRytVotjxxIBAP36PYdmzZrVreNkNQyARmbEiDC4ubkiPT0Dp06deajt3gIhuVyOqKhIqxwvPn4fysrK4OTkiD//eSb69fsj3NzcYGtrCwcHB3Tv3g1z5syCv7/f/XUIlZXmr0O4cOESioruwNHREU8/HWqVvlPdcQygnklNAwIP3+XWrVtXhIQEo7KyEnFxe/Run5BwCH5+Xe5fCpgyKyBFpVLhn/9cj8mTo9G6dWuEhQ1FWNjQWtup1Wrs2rUHP/9s2Ty+VqtFYuK/EBk5Cv36/RGnT59FTU1NnfpOdcczgEbC0dERo0ff/Vbfu/f/DM7N174UcKnzsYuKirB69SfYtWsP0tLSUVamgkajQWVlFW7cuImjR49hxYqPkJJi/mzGg86d+wklJaVQKp0REtK7zv2mupN5eraVHPrduzfuoX+PiBgjWfCZ97Lv//PpN9vVoWtEBJj3mTL388ozACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigTEAiATGACASGAOASGAMACKBMQCIBMYAIBKYXX0Wf+a97PosT0R1xDMAIoExAIgEZvVLgNNvtrN2SSKqJzwDIBIYA4BIYAwAIoExAIgExgAgEhgDgEhgDAAigZm9DmDv3rj66AcRNQCeARAJjAFAJDAGAJHAZJ6ebXUN3Qkiahg8AyASGAOASGAMACKBMQCIBMYAIBIYA4BIYAwAIoH9PwNCMmH6QVeXAAAAAElFTkSuQmCC';

/**
 * @returns {string}
 */
function uuidv4() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Non-crypto fallback (should be rare). Still produce a UUID-like string.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 v4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * @param {{ base64: string, mime: string }} params
 * @returns {{ ok: true, blob: Blob } | {{ ok: false, error: string }}}
 */
function blobFromBase64({ base64, mime }) {
  try {
    const bin = atob(String(base64 || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { ok: true, blob: new Blob([bytes], { type: mime }) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || 'BASE64_DECODE_FAILED') };
  }
}

/**
 * Build a case-insensitive index for packPaths.
 * @param {{ packPaths: string[] }} params
 * @returns {{ map: Map<string, string>, collisions: Map<string, string[]> }}
 */
function buildPackPathCaseIndex({ packPaths }) {
  const map = new Map();
  const collisions = new Map();
  for (const p of Array.isArray(packPaths) ? packPaths : []) {
    const key = String(p || '').toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, String(p));
      continue;
    }
    const prev = map.get(key);
    if (prev !== p) {
      if (!collisions.has(key)) collisions.set(key, [prev]);
      collisions.get(key).push(String(p));
    }
  }
  return { map, collisions };
}

/**
 * @param {{ caseIndex: {{ map: Map<string, string> }}, packPath: string }} params
 * @returns {string|null}
 */
function resolvePackPathCaseInsensitive({ caseIndex, packPath }) {
  const key = String(packPath || '').toLowerCase();
  if (!key) return null;
  return caseIndex?.map?.get(key) || null;
}

/**
 * Read a blob from the imported pack by packPath.
 * @param {{ packPath: string, maxBytes?: number }} params
 */
async function readImportedPackBlob({ packPath, maxBytes = 50 * 1024 * 1024 }) {
  if (!importedPackRuntime) {
    return { ok: false, error: 'NO_IMPORTED_PACK' };
  }
  const p = normalizePackPath(packPath);
  const zipPath = importedPackRuntime.rootPrefix + p;
  return captureBlobRead(() => importedPackRuntime.zipReader.readBlob(zipPath, { maxBytes }));
}

/**
 * @param {{ caseIndex: {{ map: Map<string, string> }} }} params
 * @returns {{ ok: true, blob: Blob, usedDefault: boolean } | {{ ok: false, error: string }}}
 */
async function getExportPackIconBlob({ caseIndex }) {
  // Prefer imported pack_icon.png if present.
  const actual = resolvePackPathCaseInsensitive({ caseIndex, packPath: 'pack_icon.png' });
  if (actual) {
    const b = await readImportedPackBlob({ packPath: actual, maxBytes: 10 * 1024 * 1024 });
    if (b.ok) return { ok: true, blob: b.blob, usedDefault: false };
    diagnostics.log('warn', `pack_icon.png exists but could not be read: ${b.error}`, { source: 'export' });
  }

  const builtIn = blobFromBase64({ base64: DEFAULT_EXPORT_PACK_ICON_PNG_BASE64, mime: 'image/png' });
  if (!builtIn.ok) return { ok: false, error: builtIn.error };
  return { ok: true, blob: builtIn.blob, usedDefault: true };
}

/**
 * @param {{ imported: any }} params
 * @returns {{ ok: true, text: string, warnings: string[] } | {{ ok: false, error: string }}}
 */
async function buildExportManifestText({ imported }) {
  /** @type {string[]} */
  const warnings = [];

  // Try to parse original manifest.json (preferred to preserve metadata).
  let base = null;
  try {
    const t = await readImportedPackTextResult('manifest.json', { maxTextBytes: 2 * 1024 * 1024 });
    if (t.ok) {
      const parsed = parseJsonc(t.text, { fileName: 'manifest.json' });
      if (parsed.ok && parsed.value && typeof parsed.value === 'object') {
        base = parsed.value;
      } else {
        warnings.push('manifest.json parse failed; exporting a regenerated manifest.json.');
      }
    } else {
      warnings.push('manifest.json could not be read; exporting a regenerated manifest.json.');
    }
  } catch {
    warnings.push('manifest.json parse failed; exporting a regenerated manifest.json.');
  }

  if (!base) {
    // Fallback based on summary.
    const name = imported?.manifestSummary?.header?.name || 'JSONUI Export';
    const desc = imported?.manifestSummary?.header?.description || 'Exported by JSONUI Web Editor';
    const headerUuid = imported?.manifestSummary?.header?.uuid || uuidv4();
    const moduleUuid = imported?.manifestSummary?.modules?.[0]?.uuid || uuidv4();
    const version = imported?.manifestSummary?.header?.version || [0, 0, 1];

    base = {
      format_version: 2,
      header: {
        name,
        description: desc,
        uuid: headerUuid,
        version,
        min_engine_version: [1, 21, 130],
      },
      modules: [
        {
          type: 'resources',
          uuid: moduleUuid,
          version,
        },
      ],
    };
  }

  // Normalize/patch.
  if (!base.format_version || typeof base.format_version !== 'number') {
    base.format_version = 2;
  }

  if (!base.header || typeof base.header !== 'object') base.header = {};
  if (!base.header.uuid) base.header.uuid = uuidv4();
  if (!Array.isArray(base.header.version) || base.header.version.length !== 3) {
    base.header.version = [0, 0, 1];
  }
  if (!base.header.name) base.header.name = imported?.manifestSummary?.header?.name || 'JSONUI Export';
  if (!base.header.description) base.header.description = imported?.manifestSummary?.header?.description || 'Exported by JSONUI Web Editor';

  // If missing, align with project target version (1.21.130+). Preserve if already present.
  if (!Array.isArray(base.header.min_engine_version) || base.header.min_engine_version.length !== 3) {
    base.header.min_engine_version = [1, 21, 130];
  }

  if (!Array.isArray(base.modules)) base.modules = [];
  if (base.modules.length === 0) {
    base.modules.push({
      type: 'resources',
      uuid: uuidv4(),
      version: base.header.version,
    });
  }

  // Ensure at least one 'resources' module.
  const hasResources = base.modules.some((m) => m && typeof m === 'object' && m.type === 'resources');
  if (!hasResources) {
    base.modules.unshift({
      type: 'resources',
      uuid: uuidv4(),
      version: base.header.version,
    });
  }

  for (const m of base.modules) {
    if (!m || typeof m !== 'object') continue;
    if (!m.uuid) m.uuid = uuidv4();
    if (!Array.isArray(m.version) || m.version.length !== 3) m.version = base.header.version;
    if (m.type === 'resources') {
      if (!Array.isArray(m.min_engine_version) || m.min_engine_version.length !== 3) {
        // Some packs place min_engine_version on modules; keep consistent if missing.
        m.min_engine_version = base.header.min_engine_version;
      }
    }
  }

  // Deterministic output. Treat hostile/deep parsed input as an export error.
  try {
    const text = stableStringify(base, { indent: 2, sortKeys: false });
    return { ok: true, text, warnings };
  } catch (error) {
    return { ok: false, error: `MANIFEST_SERIALIZATION_FAILED:${String(error?.message || error)}` };
  }
}

/**
 * Export a minimal resource pack ZIP per EXPORT_PACKAGING_POLICY=UI_PLUS_DEPS.
 *
 * Rules:
 * - Always include: manifest.json, pack_icon.png, ui/ (system files + referenced UI JSON).
 * - Include only referenced dependency assets from imported pack: textures/, texts/, font/
 * - Block export if validation errors exist.
 */
async function exportResourcePackZip() {
  if (workspaceSources().length && workspaceSources().every(source => source.id)) {
    try { await exportCurrentSourceWorkspacePack(); } catch (error) { reportWorkspaceError(error); }
    return;
  }
  if (exportPackState.status === 'working') return;
  if (!importedPackRuntime) {
    exportPackState.status = 'error';
    exportPackState.error = 'No imported pack is loaded.';
    safeRender();
    return;
  }

  const inputFlush = flushPendingPreviewInputsForExport();
  if (!inputFlush.ok) {
    exportPackState.status = 'error';
    exportPackState.error = inputFlush.error;
    setStatus({ text: exportPackState.error, level: 'error' });
    diagnostics.log('error', exportPackState.error, {
      source: 'export', data: { code: 'EXPORT_PENDING_INPUT_INVALID' },
    });
    safeRender();
    return;
  }

  const initialState = store.getState();
  const imported = initialState.pack?.imported;
  if (!imported) {
    exportPackState.status = 'error';
    exportPackState.error = 'No imported pack state is available.';
    safeRender();
    return;
  }

  const setupImportedRuntime = importedPackRuntime;
  const setupVanillaRuntime = vanillaReferenceRuntime;
  const setupImportedState = imported;
  const setupSourceStillCurrent = () => (
    importedPackRuntime === setupImportedRuntime
    && vanillaReferenceRuntime === setupVanillaRuntime
    && store.getState()?.pack?.imported === setupImportedState
  );
  const failExportSourceChanged = () => {
    exportPackState.status = 'error';
    exportPackState.error = 'The resource pack or UI changed during export. No ZIP was downloaded; run export again.';
    setStatus({ text: exportPackState.error, level: 'error' });
    diagnostics.log('error', exportPackState.error, {
      source: 'export', data: { code: 'EXPORT_SOURCE_CHANGED' },
    });
    safeRender();
  };

  exportPackState.status = 'working';
  exportPackState.error = null;
  exportPackState.lastSummary = null;
  exportPackState.lastExportAtIso = null;
  setStatus({ text: t('exportPack.status.exporting'), level: 'info' });
  safeRender();

  // Ensure ui_defs is loaded (and create if missing).
  if (uiDefsEditorState.status !== 'ready') {
    try {
      await loadUiDefsFromImportedPack({ createIfMissing: true });
      if (!setupSourceStillCurrent()) {
        failExportSourceChanged();
        return;
      }
    } catch (err) {
      exportPackState.status = 'error';
      exportPackState.error = `Failed to load ui/_ui_defs.json: ${String(err?.message || err)}`;
      setStatus({ text: exportPackState.error, level: 'error' });
      safeRender();
      return;
    }
  }

  if (uiDefsEditorState.status !== 'ready'
    || uiDefsEditorState.sourceRuntime !== setupImportedRuntime
    || uiDefsEditorState.sourceImportedState !== setupImportedState) {
    failExportSourceChanged();
    return;
  }
  if (globalVarsEditorState.status === 'ready'
    && (globalVarsEditorState.sourceRuntime !== setupImportedRuntime
      || globalVarsEditorState.sourceImportedState !== setupImportedState)) {
    failExportSourceChanged();
    return;
  }

  // Commit dirty system files (ui_defs / global vars) before export so overrides are included.
  let pendingGlobalNamesLoad = null;
  if (uiDefsEditorState.status === 'ready' && uiDefsEditorState.dirty) {
    const saved = saveUiDefsToImportedPack({ rebuildProjection: false });
    if (!saved.ok) {
      exportPackState.status = 'error';
      exportPackState.error = t('exportPack.error.uiDefsInvalid');
      setStatus({ text: exportPackState.error, level: 'error' });
      safeRender();
      return;
    }
  }

  if (globalVarsEditorState.status === 'ready' && globalVarsEditorState.dirty) {
    const saved = saveGlobalVariablesToImportedPack({ rebuildProjection: false });
    if (!saved.ok || globalVarsEditorState.error) {
      exportPackState.status = 'error';
      exportPackState.error = t('exportPack.error.globalVarsInvalid');
      setStatus({ text: exportPackState.error, level: 'error' });
      safeRender();
      return;
    }
    pendingGlobalNamesLoad = saved.globalNamesPromise || null;
  }

  if (!setupSourceStillCurrent()) {
    failExportSourceChanged();
    return;
  }

  // A manual save may already have a catalog refresh in flight, and the two
  // system-file writers above deliberately suppress their own duplicate
  // refresh. Build and await one latest-generation catalog/projection before
  // capturing any export inputs. If the user changes an authored or preview
  // input while this bounded synchronization is running, abort instead of
  // mixing pre-save projections with post-save pack bytes.
  const preSnapshotMutationEpoch = resourcePackMutationEpoch;
  const preSnapshotPreviewContextEpoch = previewContextMutationEpoch;
  const preSnapshotState = store.getState();
  const preSnapshotMockDataVersion = Number(preSnapshotState?.preview?.mockDataVersion) || 0;
  const preSnapshotPreviewLocale = String(preSnapshotState?.ui?.previewLocale || 'en_US');
  const [projectionRefreshResult] = await Promise.all([
    rebuildUiCatalogAndCurrentProjection('export-baseline-sync'),
    pendingGlobalNamesLoad || Promise.resolve(null),
  ]);
  const afterBaselineSyncState = store.getState();
  const preSnapshotInputsStillCurrent = setupSourceStillCurrent()
    && resourcePackMutationEpoch === preSnapshotMutationEpoch
    && previewContextMutationEpoch === preSnapshotPreviewContextEpoch
    && (Number(afterBaselineSyncState?.preview?.mockDataVersion) || 0) === preSnapshotMockDataVersion
    && String(afterBaselineSyncState?.ui?.previewLocale || 'en_US') === preSnapshotPreviewLocale
    && uiDefsEditorState.dirty !== true
    && globalVarsEditorState.dirty !== true;
  if (!preSnapshotInputsStillCurrent || projectionRefreshResult?.code === 'UI_OPEN_SUPERSEDED') {
    failExportSourceChanged();
    return;
  }
  if (uiCatalogState.status !== 'ready'
    || !uiCatalogState.catalog
    || projectionRefreshResult?.ok !== true) {
    exportPackState.status = 'error';
    exportPackState.error = 'The current UI catalog could not be rebuilt safely; no ZIP was downloaded.';
    setStatus({ text: exportPackState.error, level: 'error' });
    diagnostics.log('error', exportPackState.error, {
      source: 'export', data: { code: 'EXPORT_CATALOG_REBUILD_FAILED' },
    });
    safeRender();
    return;
  }
  // Everything below must describe one immutable source generation. Runtime
  // identities cover import/unload; the explicit mutation epoch covers saved
  // UI/global edits without depending on incidental render/store updates.
  const hydratedCatalog = uiCatalogState.catalog;
  try { await hydrateNodeCatalog(hydratedCatalog); }
  catch (error) { failExportSourceChanged(); return; }
  if (hydratedCatalog !== uiCatalogState.catalog) { failExportSourceChanged(); return; }
  const state = store.getState();
  if (!setupSourceStillCurrent()
    || resourcePackMutationEpoch !== preSnapshotMutationEpoch
    || previewContextMutationEpoch !== preSnapshotPreviewContextEpoch
    || (Number(state?.preview?.mockDataVersion) || 0) !== preSnapshotMockDataVersion
    || String(state?.ui?.previewLocale || 'en_US') !== preSnapshotPreviewLocale
    || uiDefsEditorState.dirty === true || globalVarsEditorState.dirty === true) {
    failExportSourceChanged(); return;
  }
  const stableImported = state.pack?.imported;
  if (!stableImported || stableImported !== imported) {
    failExportSourceChanged();
    return;
  }
  const exportSourceSnapshot = Object.freeze({
    importedRuntime: importedPackRuntime,
    vanillaRuntime: vanillaReferenceRuntime,
    importedState: stableImported,
    mutationEpoch: resourcePackMutationEpoch,
    compositionEpoch: textureCompositionEpoch,
    atlasEpoch: itemTextureAtlasEpoch,
    horseEpoch: nativeHorsePreviewEpoch,
    importedAssetIndex: importedPackRuntime?.assetIndex || null,
    vanillaAssetIndex: vanillaReferenceRuntime?.assetIndex || null,
    previewContextEpoch: previewContextMutationEpoch,
    mockData: state.preview?.mockData || null,
    mockDataVersion: Number(state.preview?.mockDataVersion) || 0,
    previewLocale: String(state.ui?.previewLocale || 'en_US'),
    uiCatalog: uiCatalogState.catalog,
    uiCatalogGeneration: uiCatalogState.generation,
    uiCatalogStatus: uiCatalogState.status,
    uiDefsGeneration: uiDefsEditorState.generation,
    globalVarsGeneration: globalVarsEditorState.generation,
  });
  const exportSourceStillCurrent = () => (
    importedPackRuntime === exportSourceSnapshot.importedRuntime
    && vanillaReferenceRuntime === exportSourceSnapshot.vanillaRuntime
    && store.getState()?.pack?.imported === exportSourceSnapshot.importedState
    && resourcePackMutationEpoch === exportSourceSnapshot.mutationEpoch
    && textureCompositionEpoch === exportSourceSnapshot.compositionEpoch
    && itemTextureAtlasEpoch === exportSourceSnapshot.atlasEpoch
    && nativeHorsePreviewEpoch === exportSourceSnapshot.horseEpoch
    && importedPackRuntime?.assetIndex === exportSourceSnapshot.importedAssetIndex
    && (vanillaReferenceRuntime?.assetIndex || null) === exportSourceSnapshot.vanillaAssetIndex
    && previewContextMutationEpoch === exportSourceSnapshot.previewContextEpoch
    && store.getState()?.preview?.mockData === exportSourceSnapshot.mockData
    && (Number(store.getState()?.preview?.mockDataVersion) || 0) === exportSourceSnapshot.mockDataVersion
    && String(store.getState()?.ui?.previewLocale || 'en_US') === exportSourceSnapshot.previewLocale
    && uiCatalogState.catalog === exportSourceSnapshot.uiCatalog
    && uiCatalogState.generation === exportSourceSnapshot.uiCatalogGeneration
    && uiCatalogState.status === exportSourceSnapshot.uiCatalogStatus
    && uiDefsEditorState.generation === exportSourceSnapshot.uiDefsGeneration
    && globalVarsEditorState.generation === exportSourceSnapshot.globalVarsGeneration
    && uiDefsEditorState.status === 'ready'
    && uiDefsEditorState.dirty !== true
    && globalVarsEditorState.dirty !== true
  );
  const stopIfExportSourceChanged = () => {
    if (exportSourceStillCurrent()) return false;
    failExportSourceChanged();
    return true;
  };
  const makeExportSourceChangedError = () => {
    const error = new Error('EXPORT_SOURCE_CHANGED');
    error.code = 'EXPORT_SOURCE_CHANGED';
    return error;
  };
  const awaitExportStage = async (factory) => {
    if (stopIfExportSourceChanged()) return { ok: false, value: undefined };
    const value = await factory();
    if (stopIfExportSourceChanged()) return { ok: false, value: undefined };
    return { ok: true, value };
  };
  const awaitExportStageOrThrow = async (factory) => {
    if (!exportSourceStillCurrent()) throw makeExportSourceChangedError();
    const value = await factory();
    if (!exportSourceStillCurrent()) throw makeExportSourceChangedError();
    return value;
  };
  const exportCatalogPolicyErrors = (exportSourceSnapshot.uiCatalog?.diagnostics || [])
    .filter((item) => item?.severity === 'error' || [
      'UI_DEFS_PARSE_FAILED',
      'UI_DEFS_READ_FAILED',
      'UI_CATALOG_PARSE_FAILED',
      'UI_CATALOG_READ_FAILED',
    ].includes(String(item?.code || '')));
  if (exportCatalogPolicyErrors.length > 0) {
    exportPackState.status = 'error';
    exportPackState.error = 'The current UI catalog is incomplete or contains unreadable registered files; no ZIP was downloaded.';
    setStatus({ text: exportPackState.error, level: 'error' });
    diagnostics.log('error', exportPackState.error, {
      source: 'export',
      data: {
        code: 'EXPORT_CATALOG_INCOMPLETE',
        catalogCodes: exportCatalogPolicyErrors.slice(0, 8).map((item) => item?.code || null),
      },
    });
    safeRender();
    return;
  }
  const openFiles = Object.values(state.files?.byId || {});
  const openScreenCount = openFiles.filter((f) => f && f.kind === 'screen').length;
  const stableUiDefsPaths = (uiDefsEditorState.status === 'ready' && Array.isArray(uiDefsEditorState.uiDefs))
    ? uiDefsEditorState.uiDefs.slice()
    : [];

  diagnostics.log('info', 'Export started', {
    source: 'export',
    data: {
      importedFileName: imported.fileName,
      importedZipBytes: imported.zipBytes,
      openFileCount: openFiles.length,
      openScreenCount,
      previewLocale: state.ui?.previewLocale || null,
      vanillaReferenceEnabled: Boolean(vanillaReferenceRuntime),
    },
  });

  const exportNativeUsage = [];
  let nativeUsageScanComplete = true;
  for (const file of openFiles) {
    if (!file || file.kind !== 'screen' || !file.uiModel) continue;
    if (file.meta?.source === 'vanillaReference') continue;
    const usage = evaluateNativeRendererUsage(file, null, exportSourceSnapshot.mockData);
    exportNativeUsage.push({ file, ...usage });
    if (!usage.complete) nativeUsageScanComplete = false;
  }
  if (!nativeUsageScanComplete) {
    exportPackState.status = 'error';
    exportPackState.error = 'Native renderer dependencies exceeded the safe scan limit; export was stopped.';
    setStatus({ text: exportPackState.error, level: 'error' });
    diagnostics.log('error', exportPackState.error, {
      source: 'export', data: { code: 'NATIVE_PREVIEW_DEPENDENCY_SCAN_INCOMPLETE' },
    });
    safeRender();
    return;
  }
  const includeHorseNativeReferences = exportNativeUsage.some((usage) => (
    usage.renderers.has('live_horse_renderer')
  ));
  const includePlayerNativeReferences = exportNativeUsage.some((usage) => usage.renderers.has('live_player_renderer'));
  const nativeSettleStage = await awaitExportStage(() => settleNativeReferenceContextForExport({
    includeHorse: includeHorseNativeReferences,
    includePlayer: includePlayerNativeReferences,
  }));
  if (!nativeSettleStage.ok) return;
  const nativeReferencesSettled = nativeSettleStage.value;
  if (!nativeReferencesSettled) {
    exportPackState.status = 'error';
    exportPackState.error = 'Native renderer references are still loading; export was stopped before dependency validation.';
    setStatus({ text: exportPackState.error, level: 'error' });
    diagnostics.log('error', exportPackState.error, {
      source: 'export',
      data: { code: 'REFERENCE_CONTEXT_PENDING' },
    });
    safeRender();
    return;
  }

  // Re-run UI screen validations for currently opened screens (best-effort).
  const exportErrors = [];
  const exportWarnings = [];
  const maxRetainedExportWarnings = 2_000;
  let exportWarningCount = 0;
  const pushExportWarning = (rawMessage) => {
    exportWarningCount += 1;
    if (exportWarnings.length < maxRetainedExportWarnings) {
      exportWarnings.push(String(rawMessage || 'Export warning.'));
    }
  };
  const exportReferenceScreenFiles = [];

  for (const file of openFiles) {
    if (!file || file.kind !== 'screen') continue;
    if (!file.uiModel) continue;
    if (file.meta?.source === 'vanillaReference') continue;

    const v = validateUiScreenModel(file.uiModel, {
      filePath: file.packPath || 'UNKNOWN',
      sourceJson: file.sourceJson || file.validationSourceJson,
      supportedTypes: VALID_UI_ELEMENT_TYPES,
      referenceContext: buildReferenceContextForValidation(file, '', null, {
        mockData: exportSourceSnapshot.mockData,
        previewLocale: exportSourceSnapshot.previewLocale,
      }),
    });
    exportReferenceScreenFiles.push({
      ...file,
      meta: { ...file.meta, selectedDefinition: null },
      validation: v,
    });
    const fileLabel = file.packPath || 'UNKNOWN';
    if (!v.ok && Number(v.errorCount || 0) > 0) {
      exportErrors.push(`Validation errors in ${fileLabel} (${v.errorCount} error(s)).`);
    }
    if (Array.isArray(v.warnings) && v.warnings.length > 0) {
      pushExportWarning(`Validation warnings in ${fileLabel} (${v.warnings.length} warning(s)).`);
    }
  }

  if (uiDefsEditorState.status === 'ready' && uiDefsEditorState.validation && !uiDefsEditorState.validation.ok) {
    exportErrors.push(`Validation errors in ${uiDefsEditorState.packPath} (${uiDefsEditorState.validation.errorCount} error(s)).`);
  }

  diagnostics.log('info', 'Export validation summary', {
    source: 'export',
    data: {
      openScreenCount,
      validatedScreenCount: openFiles.filter((f) => (
        f && f.kind === 'screen' && f.uiModel && f.meta?.source !== 'vanillaReference'
      )).length,
      errorMessages: exportErrors.length,
      warningMessages: exportWarnings.length,
      sampleErrors: exportErrors.slice(0, 5),
      sampleWarnings: exportWarnings.slice(0, 5),
    },
  });

  if (exportErrors.length > 0) {
    exportPackState.status = 'error';
    exportPackState.error = t('exportPack.error.validationBlocked');
    setStatus({ text: exportPackState.error, level: 'error' });
    diagnostics.log('error', exportPackState.error, { source: 'export' });
    safeRender();
    return;
  }

  

// S055: Preflight warning for missing references before export.
try {
  const missing = collectMissingReferencesFromScreenFiles(exportReferenceScreenFiles, { scope: 'open' });
  const totalMissing = countTotalMissingReferences(missing);

  if (totalMissing > 0) {
    const actionLabel = t('exportPack.title');
    const msg = buildMissingReferencesPreflightMessage({ actionLabel, missing });
    const ok = window.confirm(msg);

    if (!ok) {
      exportPackState.status = 'idle';
      exportPackState.error = null;
      setStatus({ text: t('impactWarnings.preflight.cancelled', { action: actionLabel }), level: 'info' });
      diagnostics.log('info', 'Export cancelled by user (missing references preflight)', { source: 'export' });
      safeRender();
      return;
    }

    pushExportWarning(t('impactWarnings.preflight.recorded', { action: actionLabel, count: totalMissing }));
  }
} catch (err) {
  diagnostics.captureError(err, { module: 'impactWarnings', where: 'exportPreflight' });
}
  if (stopIfExportSourceChanged()) return;

// Build case index once for the pack.
  const caseIndex = buildPackPathCaseIndex({ packPaths: importedPackRuntime.packPaths });
  if (caseIndex.collisions.size > 0) {
    pushExportWarning(`Case-insensitive path collisions detected (count=${caseIndex.collisions.size}). Export will stop if an ambiguous path is required.`);
  }

  // Build UI file set.
  const uiFilesToInclude = new Set();
  const serializedUiJsonByPackPath = new Map();

  const uiDefsPackPath = getUiDefsPackPath(imported) || 'ui/_ui_defs.json';
  const uiDefsActual = resolvePackPathCaseInsensitive({ caseIndex, packPath: uiDefsPackPath }) || uiDefsPackPath;
  uiFilesToInclude.add(uiDefsActual);

  const gvPackPath = getGlobalVariablesPackPath(imported);
  const gvActual = gvPackPath
    ? (resolvePackPathCaseInsensitive({ caseIndex, packPath: gvPackPath }) || gvPackPath)
    : null;
  if (gvActual) {
    // Only include if present in packPaths OR the editor created an override.
    const hasInOverrides = Boolean(importedPackRuntime.overridesTextByPackPath?.[gvActual]);
    const hasInPack = Boolean(resolvePackPathCaseInsensitive({ caseIndex, packPath: gvActual }));
    if (hasInOverrides || hasInPack) uiFilesToInclude.add(gvActual);
  }

  const uiRoot = String(uiDefsActual || 'ui/_ui_defs.json').split('/')[0] || 'ui';

  // Include every imported physical UI file admitted by the effective
  // catalog. A sparse overlay may rely on the lower Vanilla `_ui_defs.json`
  // registration and therefore need not repeat that path in its own registry.
  for (const catalogFile of exportSourceSnapshot.uiCatalog?.files || []) {
    if (catalogFile?.sourceKind !== 'imported') continue;
    const catalogPath = String(catalogFile.filePath || '');
    const lower = catalogPath.toLowerCase();
    if (!lower.startsWith(`${uiRoot.toLowerCase()}/`)) continue;
    if (!lower.endsWith('.json') && !lower.endsWith('.jsonc')) continue;
    uiFilesToInclude.add(catalogPath);
  }

  // Screens from ui_defs.
  const screenPaths = stableUiDefsPaths;

  for (const sp of screenPaths) {
    let norm;
    try {
      norm = normalizePackPath(sp);
    } catch (error) {
      exportErrors.push(`Invalid ui_defs path ${String(sp).slice(0, 160)}: ${String(error?.message || error)}.`);
      break;
    }
    const actual = resolvePackPathCaseInsensitive({ caseIndex, packPath: norm });
    if (actual) uiFilesToInclude.add(actual);
    else {
      // Might exist in vanilla; warn only.
      pushExportWarning(`UI screen listed in ui_defs not found in imported pack: ${norm} (may exist in vanilla).`);
    }
  }

  // Include any overridden ui/* file (so edits are not lost).
  const overrides = importedPackRuntime.overridesTextByPackPath || {};
  for (const p of Object.keys(overrides)) {
    const lower = String(p || '').toLowerCase();
    if (lower.startsWith(`${uiRoot.toLowerCase()}/`)) {
      uiFilesToInclude.add(p);
    }
  }

  // BFS: parse included UI JSON files, discover additional ui/*.json refs and asset refs.
  const outTextureRefs = new Set();
  const outFontRefs = new Set();
  const outLangKeys = new Set();
  const nativeDirectAssetPaths = new Set();
  const generatedTextByPackPath = new Map();
  const rawNativeRenderers = [];
  const rawNativeItemIds = [];
  const rawUiSymbolRefs = new Set();
  const exportDependencyDiagnostics = [];

  // Native custom renderers often do not author a literal `texture` field in
  // JSON UI. Merge their now-settled, resource-backed dependencies explicitly
  // so UI_PLUS_DEPS exports preserve the same appearance as the preview.
  const settledAtlasContext = buildItemTextureAtlasReferenceContext();
  const requiredImportedAtlasEntries = new Map();
  const requiredImportedAtlasTextureRefs = new Set();
  const requiredNativeTextureRefs = new Set();
  const requiredNativeAssetPaths = new Set();
  let requiredImportedAtlasPackPath = null;
  const nativeExportWarningKeys = new Set();
  const warnNativeExportOnce = (key, message, data = {}) => {
    if (nativeExportWarningKeys.has(key)) return;
    nativeExportWarningKeys.add(key);
    pushExportWarning(message);
    diagnostics.log('warn', message, {
      source: 'export', data: { code: key, ...data },
    });
  };
  const mergeNativeRendererExportProps = (props, { warnRuntimeItem = true } = {}) => {
    const safeProps = mergeNativeRendererProps(props);
    if (!safeProps || typeof safeProps.renderer !== 'string') return false;
    const renderer = safeProps.renderer.trim();
    if (renderer === 'inventory_item_renderer') {
      const resolvedNativeTexture = resolveNativeRendererTexture(safeProps, settledAtlasContext);
      if (resolvedNativeTexture?.status === 'resolved'
        && isConcretePreviewTextureRef(resolvedNativeTexture.textureRef)) {
        if (resolvedNativeTexture.source === 'imported') {
          const atlasState = itemTextureAtlasCacheByRuntime.get(importedPackRuntime);
          const atlasKey = String(resolvedNativeTexture.atlasKey || '');
          const textureRefs = Array.isArray(resolvedNativeTexture.textureRefs)
            ? resolvedNativeTexture.textureRefs.filter(isConcretePreviewTextureRef)
            : [];
          if (atlasState?.status !== 'ready' || typeof atlasState.packPath !== 'string'
            || !atlasKey || textureRefs.length === 0) {
            exportErrors.push('An imported native item atlas dependency could not be represented safely.');
            return false;
          }
          const previous = requiredImportedAtlasEntries.get(atlasKey);
          if (previous && JSON.stringify(previous) !== JSON.stringify(textureRefs)) {
            exportErrors.push(`Conflicting imported item atlas entry detected: ${atlasKey}.`);
            return false;
          }
          requiredImportedAtlasEntries.set(atlasKey, textureRefs.slice());
          for (const textureRef of textureRefs) {
            outTextureRefs.add(textureRef);
            requiredImportedAtlasTextureRefs.add(textureRef);
            requiredNativeTextureRefs.add(textureRef);
          }
          if (requiredImportedAtlasPackPath && requiredImportedAtlasPackPath !== atlasState.packPath) {
            exportErrors.push('Conflicting imported item atlas paths were detected.');
            return false;
          }
          requiredImportedAtlasPackPath = atlasState.packPath;
        } else {
          outTextureRefs.add(resolvedNativeTexture.textureRef);
          requiredNativeTextureRefs.add(resolvedNativeTexture.textureRef);
        }
        return true;
      }
      if (resolvedNativeTexture?.status === 'pending') {
        exportErrors.push('A native item texture dependency was still loading after the bounded settle step.');
      } else if (resolvedNativeTexture?.status === 'blocked' || resolvedNativeTexture?.status === 'unresolved') {
        warnNativeExportOnce(
          `EXPORT_NATIVE_ITEM_${String(resolvedNativeTexture.issue || 'UNRESOLVED')}`,
          `A native inventory item texture could not be resolved (${String(resolvedNativeTexture.issue || 'unknown')}); the export records this warning instead of inventing an asset.`,
          { issue: resolvedNativeTexture.issue || null },
        );
      } else if (warnRuntimeItem) {
        warnNativeExportOnce(
          'EXPORT_NATIVE_ITEM_RUNTIME_DEPENDENT',
          'A native inventory renderer chooses its item at runtime; UI_PLUS_DEPS cannot statically include every possible item texture.',
        );
      }
      return false;
    }
    if (renderer === 'enchanting_book_renderer') {
      outTextureRefs.add('textures/entity/enchanting_table_book');
      requiredNativeTextureRefs.add('textures/entity/enchanting_table_book');
      return true;
    }
    if (renderer === 'live_horse_renderer' || renderer === 'live_player_renderer') {
      const modelSnapshot = renderer === 'live_player_renderer' ? nativePlayerPreviewState : nativeHorsePreviewState;
      if (modelSnapshot.status === 'ready') {
        for (const textureRef of modelSnapshot.textureRefs || []) {
          if (isConcretePreviewTextureRef(textureRef)) {
            outTextureRefs.add(textureRef);
            requiredNativeTextureRefs.add(textureRef);
          }
        }
        const provenance = modelSnapshot.provenance || {};
        if (['entitySource', 'controllerSource', 'modelSource'].some((key) => provenance[key] === 'imported')) {
          const omittedPaths = ['entityPath', 'controllerPath', 'modelPath']
            .map((key) => provenance[key])
            .filter((path) => typeof path === 'string' && path)
            .slice(0, 3);
          warnNativeExportOnce(
            'EXPORT_NATIVE_MODEL_PROVENANCE_OMITTED',
            'The native model preview uses imported entity/controller/geometry data. The locked UI_PLUS_DEPS export includes its referenced textures but excludes non-UI model documents.',
            { omittedPaths },
          );
        }
        return true;
      }
      warnNativeExportOnce(
        renderer === 'live_player_renderer' ? 'EXPORT_NATIVE_PLAYER_UNRESOLVED' : 'EXPORT_NATIVE_HORSE_UNRESOLVED',
        `The native model preview could not be resolved (${String(modelSnapshot.issue || modelSnapshot.status || 'unknown')}); no model asset was guessed.`,
      );
      return false;
    }
    if (renderer === 'banner_pattern_renderer') return true;
    warnNativeExportOnce(
      `EXPORT_NATIVE_RENDERER_UNSUPPORTED:${renderer}`,
      `Native renderer ${renderer} is not statically supported by UI_PLUS_DEPS; any renderer-owned runtime assets remain explicitly unresolved.`,
      { code: 'EXPORT_NATIVE_RENDERER_UNSUPPORTED', renderer },
    );
    return false;
  };
  let exportNativeDependencyScanComplete = true;
  const initialIncludedUiPathKeys = new Set(Array.from(uiFilesToInclude, (value) => String(value).toLowerCase()));
  for (const usage of exportNativeUsage) {
    const usagePath = String(usage.file?.packPath || usage.file?.path || '').toLowerCase();
    if (!initialIncludedUiPathKeys.has(usagePath)) continue;
    const scan = scanEffectiveNativeRenderers(
      usage.file.uiModel,
      usage.evaluatedPropsById,
      (props) => mergeNativeRendererExportProps(props),
    );
    if (!scan.complete) exportNativeDependencyScanComplete = false;
  }
  if (!exportNativeDependencyScanComplete) {
    exportErrors.push('Native renderer dependency scan did not complete within its safe bound.');
  }

  /** @type {string[]} */
  const queue = Array.from(uiFilesToInclude).filter((p) => {
    const lower = String(p).toLowerCase();
    return lower.endsWith('.json') || lower.endsWith('.jsonc');
  });
  // Parse imported globals before screens so exact `$variable` asset refs in
  // every UI file can be resolved against the correct root environment.
  queue.sort((a, b) => {
    const aGlobal = String(a).toLowerCase() === String(gvActual || '').toLowerCase();
    const bGlobal = String(b).toLowerCase() === String(gvActual || '').toLowerCase();
    return Number(bGlobal) - Number(aGlobal);
  });

  const scanned = new Set();
  // Catalog globals are already overlaid low-to-high across the active pack
  // stack. They are required for sparse overlays that use a Vanilla-defined
  // variable whose concrete asset is supplied by the imported pack.
  const exportRootVariables = Object.assign(
    Object.create(null),
    exportSourceSnapshot.uiCatalog?.globalVariables || {},
  );
  const exportUiScanLimits = Object.freeze({
    files: 5_000,
    decodedTextBytes: 64 * 1024 * 1024,
    serializedTextBytes: 96 * 1024 * 1024,
    nodes: 1_000_000,
    references: 250_000,
    symbols: 100_000,
    records: 100_000,
  });
  let queueIndex = 0;
  let decodedTextBytes = 0;
  let serializedTextBytes = 0;
  let scannedJsonNodes = 0;
  let exportRawDependencyScanComplete = true;

  if (queue.length > exportUiScanLimits.files) {
    exportErrors.push(`UI dependency scanning exceeded its file safety limit (${exportUiScanLimits.files}).`);
  }

  while (queueIndex < queue.length && exportErrors.length === 0) {
    if (scanned.size >= exportUiScanLimits.files) {
      exportErrors.push(`UI dependency scanning exceeded its file safety limit (${exportUiScanLimits.files}).`);
      break;
    }
    const packPath = queue[queueIndex++];
    const key = String(packPath).toLowerCase();
    if (scanned.has(key)) continue;
    scanned.add(key);

    // Read text (overrides first)
    const readStage = await awaitExportStage(() => readImportedPackTextResult(
      packPath,
      { maxTextBytes: 10 * 1024 * 1024 },
    ));
    if (!readStage.ok) return;
    const tRes = readStage.value;
    if (!tRes.ok) {
      exportErrors.push(`Could not read required UI file: ${packPath} (${tRes.error}).`);
      break;
    }

    const textBytes = boundedUtf8Length(tRes.text);
    decodedTextBytes += textBytes;
    if (!Number.isSafeInteger(textBytes) || decodedTextBytes > exportUiScanLimits.decodedTextBytes) {
      exportErrors.push(`UI dependency scanning exceeded its decoded-text safety limit (${exportUiScanLimits.decodedTextBytes} bytes).`);
      break;
    }

    const parsed = parseJsonc(tRes.text, { fileName: packPath });
    if (!parsed.ok) {
      exportErrors.push(`UI JSON parse error in ${packPath}: ${parsed.error}`);
      continue;
    }

    if (String(packPath).toLowerCase() === String(gvActual || '').toLowerCase()) {
      Object.assign(exportRootVariables, extractExportRootVariables(parsed.value));
    }

    const discoveredUi = new Set();
    const remainingNodeBudget = exportUiScanLimits.nodes - scannedJsonNodes;
    if (remainingNodeBudget <= 0) {
      exportErrors.push(`UI dependency scanning exceeded its JSON-node safety limit (${exportUiScanLimits.nodes}).`);
      break;
    }
    const dependencyScan = scanJsonForExportDeps({
      value: parsed.value,
      outUiJsonRefs: discoveredUi,
      outTextureRefs,
      outFontRefs,
      outLangKeys,
      outNativeRenderers: rawNativeRenderers,
      outNativeItemIds: rawNativeItemIds,
      outUiSymbolRefs: rawUiSymbolRefs,
      outDiagnostics: exportDependencyDiagnostics,
      sourcePath: packPath,
      rootVariables: exportRootVariables,
      limits: {
        maxNodes: Math.min(100_000, remainingNodeBudget),
        maxUiSymbolRefs: exportUiScanLimits.symbols,
      },
    });
    scannedJsonNodes += Number(dependencyScan?.stats?.nodes) || 0;
    if (!dependencyScan?.complete) {
      exportRawDependencyScanComplete = false;
      break;
    }

    const referenceCount = discoveredUi.size
      + outTextureRefs.size
      + outFontRefs.size
      + outLangKeys.size
      + rawUiSymbolRefs.size
      + rawNativeRenderers.length
      + rawNativeItemIds.length;
    if (referenceCount > exportUiScanLimits.references) {
      exportErrors.push(`UI dependency scanning exceeded its reference safety limit (${exportUiScanLimits.references}).`);
      break;
    }

    // Enforce the bounded walk before formatting. Compact serialization keeps
    // indentation from multiplying a deeply nested but otherwise small file.
    let serializedUiJson;
    try {
      serializedUiJson = stableStringify(parsed.value, { indent: 0, sortKeys: false });
    } catch (error) {
      exportErrors.push(`UI JSON serialization failed in ${packPath}: ${String(error?.message || error)}`);
      break;
    }
    const serializedBytes = boundedUtf8Length(serializedUiJson);
    serializedTextBytes += serializedBytes;
    if (!Number.isSafeInteger(serializedBytes) || serializedTextBytes > exportUiScanLimits.serializedTextBytes) {
      exportErrors.push(`UI dependency scanning exceeded its serialized-text safety limit (${exportUiScanLimits.serializedTextBytes} bytes).`);
      break;
    }
    serializedUiJsonByPackPath.set(packPath, serializedUiJson);

    for (const ref of discoveredUi) {
      // Keep only refs that resolve to imported/overridden files.
      const actual = resolvePackPathCaseInsensitive({ caseIndex, packPath: ref }) || null;
      const hasOverride = Boolean(overrides?.[ref]) || (actual ? Boolean(overrides?.[actual]) : false);

      if (actual || hasOverride) {
        const chosen = actual || ref;
        if (!uiFilesToInclude.has(chosen)) {
          uiFilesToInclude.add(chosen);
          const lower = String(chosen).toLowerCase();
          if (lower.endsWith('.json') || lower.endsWith('.jsonc')) {
            queue.push(chosen);
            if (queue.length > exportUiScanLimits.files) {
              exportErrors.push(`UI dependency scanning exceeded its file safety limit (${exportUiScanLimits.files}).`);
              break;
            }
          }
        }
      } else {
        // Might exist in vanilla; warn only (no expansion).
        pushExportWarning(`Referenced UI JSON not found in imported pack: ${ref} (may exist in vanilla).`);
      }
    }
  }

  if (!exportRawDependencyScanComplete) {
    exportErrors.push('UI dependency scanning did not complete within its safe bounds.');
  }

  // Close fixed UI-symbol dependencies against every bounded catalog layer.
  // Scanning all candidates (not only the winning symbol) is intentional: an
  // imported `control@namespace.control` commonly inherits the renderer from
  // the lower Vanilla candidate with the same qualified name.
  const catalog = exportSourceSnapshot.uiCatalog;
  const includedUiPathKeys = new Set(Array.from(uiFilesToInclude, (value) => String(value).toLowerCase()));
  const symbolQueue = [];
  const queuedSymbols = new Set();
  const enqueueUiSymbol = (rawReference) => {
    const reference = String(rawReference || '').trim();
    if (!reference || queuedSymbols.has(reference)) return true;
    if (queuedSymbols.size >= exportUiScanLimits.symbols) {
      exportErrors.push(`UI symbol closure exceeded its safety limit (${exportUiScanLimits.symbols}).`);
      return false;
    }
    queuedSymbols.add(reference);
    symbolQueue.push(reference);
    return true;
  };
  for (const reference of rawUiSymbolRefs) enqueueUiSymbol(reference);
  for (const record of catalog?.records || []) {
    if (record?.sourceKind !== 'imported') continue;
    if (!includedUiPathKeys.has(String(record.filePath || '').toLowerCase())) continue;
    // Every authored imported definition is a composition root. Scanning only
    // its referenced base loses caller `$variables` consumed by that base.
    enqueueUiSymbol(record.qualifiedName);
    for (const reference of record.references || []) enqueueUiSymbol(reference);
  }

  const resolveExportUiSymbolCandidates = (qualifiedName) => {
    const symbol = catalog?.symbols?.[qualifiedName];
    if (!symbol || !Array.isArray(symbol.candidateIds)) return [];
    return symbol.candidateIds.map((recordId) => catalog.recordsById?.[recordId]).filter(Boolean);
  };

  const scannedSymbolRecords = new Set();
  let symbolQueueIndex = 0;
  while (symbolQueueIndex < symbolQueue.length && exportErrors.length === 0) {
    const reference = symbolQueue[symbolQueueIndex++];
    const symbol = catalog?.symbols?.[reference];
    if (!symbol || !Array.isArray(symbol.candidateIds) || symbol.candidateIds.length === 0) {
      if (exportDependencyDiagnostics.length >= 128) {
        exportErrors.push('UI symbol diagnostics exceeded their safety limit.');
        break;
      }
      exportDependencyDiagnostics.push({
        code: 'EXPORT_UI_SYMBOL_UNRESOLVED',
        severity: 'warning',
        assetKind: 'ui-symbol',
        property: '@composition/template',
        reference: reference.slice(0, 160),
        sourcePath: null,
        jsonPath: '$',
        reason: 'ui-symbol-missing',
        message: `UI symbol ${reference.slice(0, 160)} could not be resolved in the active pack stack; dependencies inherited through it may be omitted.`,
      });
      continue;
    }

    for (const recordId of symbol.candidateIds) {
      if (scannedSymbolRecords.has(recordId)) continue;
      if (scannedSymbolRecords.size >= exportUiScanLimits.records) {
        exportErrors.push(`UI symbol record closure exceeded its safety limit (${exportUiScanLimits.records}).`);
        break;
      }
      scannedSymbolRecords.add(recordId);
      const record = catalog.recordsById?.[recordId];
      if (!record) {
        exportErrors.push(`UI symbol record was unavailable during export: ${String(recordId).slice(0, 160)}.`);
        break;
      }
      for (const nestedReference of record.references || []) enqueueUiSymbol(nestedReference);

      // Scan every catalog record as its own bounded composition root. Raw
      // physical-file scanning cannot carry a derived control's lexical
      // variables into a referenced base/factory template.
      const remainingNodeBudget = exportUiScanLimits.nodes - scannedJsonNodes;
      if (remainingNodeBudget <= 0) {
        exportErrors.push(`UI dependency scanning exceeded its JSON-node safety limit (${exportUiScanLimits.nodes}).`);
        break;
      }
      const nestedSymbols = new Set();
      const lowerScan = scanJsonForExportDeps({
        value: record.value,
        outUiJsonRefs: new Set(),
        outTextureRefs,
        outFontRefs,
        outLangKeys,
        outUiSymbolRefs: nestedSymbols,
        outNativeRenderers: rawNativeRenderers,
        outNativeItemIds: rawNativeItemIds,
        outDiagnostics: exportDependencyDiagnostics,
        sourcePath: `${String(record.sourceKind || 'base')}:${String(record.filePath || '')}#${String(record.rawKey || '')}`,
        rootVariables: exportRootVariables,
        rootNamespace: String(record.namespace || ''),
        rootAuthoredKey: String(record.rawKey || ''),
        rootRecordId: String(record.id || ''),
        resolveUiSymbolCandidates: resolveExportUiSymbolCandidates,
        limits: {
          maxNodes: Math.min(100_000, remainingNodeBudget),
          maxUiSymbolRefs: exportUiScanLimits.symbols,
        },
      });
      scannedJsonNodes += Number(lowerScan?.stats?.nodes) || 0;
      if (!lowerScan?.complete) {
        exportRawDependencyScanComplete = false;
        break;
      }
      for (const nestedReference of nestedSymbols) enqueueUiSymbol(nestedReference);

      const referenceCount = outTextureRefs.size
        + outFontRefs.size
        + outLangKeys.size
        + queuedSymbols.size
        + rawNativeRenderers.length
        + rawNativeItemIds.length;
      if (referenceCount > exportUiScanLimits.references) {
        exportErrors.push(`UI dependency scanning exceeded its reference safety limit (${exportUiScanLimits.references}).`);
        break;
      }
    }
  }
  if (!exportRawDependencyScanComplete) {
    exportErrors.push('UI symbol dependency scanning did not complete within its safe bounds.');
  }

  const rawRendererNames = new Set(rawNativeRenderers.map((entry) => (
    typeof entry?.props?.renderer === 'string' ? entry.props.renderer.trim() : ''
  )).filter(Boolean));
  if (rawRendererNames.has('live_horse_renderer') && !includeHorseNativeReferences) {
    const rawHorseStage = await awaitExportStage(() => (
      settleNativeReferenceContextForExport({ includeHorse: true })
    ));
    if (!rawHorseStage.ok) return;
    const rawHorseReferencesSettled = rawHorseStage.value;
    if (!rawHorseReferencesSettled) {
      exportErrors.push('A horse renderer in an included UI file did not settle within the safe export bound.');
    }
  }
  if (rawRendererNames.has('live_player_renderer') && !includePlayerNativeReferences) {
    const stage = await awaitExportStage(() => settleNativeReferenceContextForExport({ includePlayer: true }));
    if (!stage.ok) return;
    if (!stage.value) exportErrors.push('A player renderer in an included UI file did not settle within the safe export bound.');
  }

  let unresolvedRawInventoryRenderers = 0;
  for (const entry of rawNativeRenderers) {
    const renderer = typeof entry?.props?.renderer === 'string' ? entry.props.renderer.trim() : '';
    if (renderer === 'inventory_item_renderer') {
      if (!mergeNativeRendererExportProps(entry.props, { warnRuntimeItem: false })) {
        unresolvedRawInventoryRenderers += 1;
      }
    } else {
      mergeNativeRendererExportProps(entry?.props);
    }
  }
  // A fixed item-id specialization may inherit its renderer through @
  // composition (including from Vanilla), so process these facts even when no
  // renderer literal appears in the imported JSON closure.
  for (const entry of rawNativeItemIds) {
    mergeNativeRendererExportProps(entry?.props, { warnRuntimeItem: false });
  }
  if (rawRendererNames.has('inventory_item_renderer') && unresolvedRawInventoryRenderers > 0) {
    warnNativeExportOnce(
      'EXPORT_NATIVE_ITEM_RUNTIME_DEPENDENT',
      `Native inventory renderer input remained runtime-dependent for ${unresolvedRawInventoryRenderers} control(s); UI_PLUS_DEPS cannot statically include those unknown item textures.`,
    );
  }

  if (requiredImportedAtlasEntries.size > 0) {
    const atlasState = itemTextureAtlasCacheByRuntime.get(importedPackRuntime);
    const prunedAtlas = buildPrunedItemTextureAtlasForExport(
      atlasState?.atlas,
      [...requiredImportedAtlasEntries.keys()],
      { fallbackResourcePackName: String(imported?.manifestSummary?.header?.name || 'JSONUI Export') },
    );
    if (!requiredImportedAtlasPackPath || atlasState?.status !== 'ready' || !prunedAtlas.ok) {
      exportErrors.push(`Imported item atlas pruning failed (${String(prunedAtlas.error || 'ITEM_TEXTURE_ATLAS_NOT_READY')}).`);
    } else {
      for (const textureRef of prunedAtlas.textureRefs) outTextureRefs.add(textureRef);
      generatedTextByPackPath.set(
        requiredImportedAtlasPackPath,
        stableStringify(prunedAtlas.value, { indent: 2, sortKeys: false, finalNewline: true }),
      );
      nativeDirectAssetPaths.add(requiredImportedAtlasPackPath);
    }
  }

  for (const item of exportDependencyDiagnostics) {
    const message = String(item?.message || 'Export dependency could not be resolved statically.');
    pushExportWarning(message);
    diagnostics.log('warn', message, {
      source: 'export',
      data: {
        code: item?.code || null,
        assetKind: item?.assetKind || null,
        reference: item?.reference || null,
        packPath: item?.sourcePath || null,
        jsonPath: item?.jsonPath || null,
        reason: item?.reason || null,
      },
    });
  }

  diagnostics.log('info', 'Export dependency scan summary', {
    source: 'export',
    data: {
      uiFilesToIncludeCount: uiFilesToInclude.size,
      uiJsonScannedCount: scanned.size,
      textureRefCount: outTextureRefs.size,
      fontRefCount: outFontRefs.size,
      langKeyCount: outLangKeys.size,
      unresolvedDependencyCount: exportDependencyDiagnostics.length,
      warningsSoFar: exportWarningCount,
    },
  });

  if (exportErrors.length > 0) {
    exportPackState.status = 'error';
    exportPackState.error = exportErrors[0];
    setStatus({ text: exportPackState.error, level: 'error' });
    safeRender();
    return;
  }

  // Resolve dependency assets (include only those that exist in imported pack).
  const assetsToInclude = new Set(nativeDirectAssetPaths);

  const importedIndex = importedPackRuntime.assetIndex || buildAssetIndexFromPackPaths(importedPackRuntime.packPaths);
  const vanillaIndex = vanillaReferenceRuntime?.assetIndex || null;

  for (const texRef of outTextureRefs) {
    const res = resolveTextureRef(texRef, { importedIndex, vanillaIndex });
    if (res.resolved && res.resolved.source === 'imported') {
      assetsToInclude.add(res.resolved.packPath);
      if (requiredNativeTextureRefs.has(texRef)) requiredNativeAssetPaths.add(res.resolved.packPath);
    } else if (res.resolved && res.resolved.source === 'vanilla') {
      // skip (vanilla-provided)
    } else {
      const message = `Texture reference could not be resolved: ${texRef}`;
      if (requiredImportedAtlasTextureRefs.has(texRef)) {
        exportErrors.push(`${message} (required by the pruned imported item atlas).`);
      } else {
        pushExportWarning(message);
      }
    }
  }

  if (exportErrors.length > 0) {
    exportPackState.status = 'error';
    exportPackState.error = exportErrors[0];
    setStatus({ text: exportPackState.error, level: 'error' });
    safeRender();
    return;
  }

  for (const fontRef of outFontRefs) {
    const res = resolveFontTypeRef(fontRef, { importedIndex, vanillaIndex });
    if (res.resolved && res.resolved.source === 'imported') {
      assetsToInclude.add(res.resolved.packPath);
    } else if (res.resolved && res.resolved.source === 'vanilla') {
      // skip
    } else if (res.ok && res.builtIn) {
      // Engine-provided semantic family; no pack file is required.
    } else {
      pushExportWarning(`Font reference could not be resolved: ${fontRef}`);
    }
  }

  // Texts: include only .lang files from imported pack that contain referenced keys.
  if (outLangKeys.size > 0) {
    const candidateTextFiles = new Set();
    for (const p of importedPackRuntime.packPaths || []) {
      const lower = String(p || '').toLowerCase();
      if (lower.startsWith('texts/')) candidateTextFiles.add(String(p));
    }
    for (const p of Object.keys(overrides || {})) {
      const lower = String(p || '').toLowerCase();
      if (lower.startsWith('texts/')) candidateTextFiles.add(String(p));
    }

    const langFiles = Array.from(candidateTextFiles)
      .filter((p) => String(p).toLowerCase().endsWith('.lang'))
      .sort();
    const exportLangLimits = Object.freeze({
      files: 512,
      decodedTextBytes: 64 * 1024 * 1024,
      entriesPerFile: 120_000,
      entriesTotal: 2_000_000,
    });
    let decodedLangTextBytes = 0;
    let parsedLangEntries = 0;
    const foundLangKeys = new Set();

    if (langFiles.length > exportLangLimits.files) {
      exportErrors.push(`Language dependency scanning exceeded its file safety limit (${exportLangLimits.files}).`);
    }

    for (const langPath of langFiles.slice(0, exportLangLimits.files)) {
      if (exportErrors.length > 0) break;
      const langReadStage = await awaitExportStage(() => readImportedPackTextResult(
        langPath,
        { maxTextBytes: 5 * 1024 * 1024 },
      ));
      if (!langReadStage.ok) return;
      const tr = langReadStage.value;
      if (!tr.ok) {
        exportErrors.push(`Could not read language file ${langPath}: ${tr.error}.`);
        break;
      }
      const langBytes = boundedUtf8Length(tr.text);
      decodedLangTextBytes += langBytes;
      if (!Number.isSafeInteger(langBytes) || decodedLangTextBytes > exportLangLimits.decodedTextBytes) {
        exportErrors.push(`Language dependency scanning exceeded its decoded-text safety limit (${exportLangLimits.decodedTextBytes} bytes).`);
        break;
      }
      const parsed = parseLangFile(tr.text, { maxEntries: exportLangLimits.entriesPerFile });
      if (parsed.stats?.truncated) {
        exportErrors.push(`Language file ${langPath} exceeded its entry safety limit (${exportLangLimits.entriesPerFile}).`);
        break;
      }
      parsedLangEntries += Number(parsed.stats?.entries) || 0;
      if (!Number.isSafeInteger(parsedLangEntries)
        || parsedLangEntries > exportLangLimits.entriesTotal) {
        exportErrors.push(`Language dependency scanning exceeded its total-entry safety limit (${exportLangLimits.entriesTotal}).`);
        break;
      }

      let hit = false;
      // Iterate each bounded table once. Walking every requested key for every
      // locale can otherwise multiply two individually valid limits.
      for (const k of Object.keys(parsed.table)) {
        if (outLangKeys.has(k)) {
          hit = true;
          foundLangKeys.add(k);
        }
      }
      if (hit) assetsToInclude.add(langPath);
    }

    const remaining = new Set(Array.from(outLangKeys).filter((key) => !foundLangKeys.has(key)));
    if (remaining.size > 0) {
      // Could be vanilla keys; warn but do not block.
      pushExportWarning(`Some localized keys were not found in imported pack texts/ (count=${remaining.size}). They may exist in vanilla.`);
    }
  }

  if (exportErrors.length > 0) {
    exportPackState.status = 'error';
    exportPackState.error = exportErrors[0];
    setStatus({ text: exportPackState.error, level: 'error' });
    safeRender();
    return;
  }

  // If we included any .lang file, also include texts/languages.json when present (required for language registration in many packs).
  const hasLangInExport = Array.from(assetsToInclude).some((p) => String(p).toLowerCase().endsWith('.lang'));
  if (hasLangInExport) {
    const langJsonActual = resolvePackPathCaseInsensitive({ caseIndex, packPath: 'texts/languages.json' }) || null;
    const langJsonOverride = overrides?.['texts/languages.json'] ? 'texts/languages.json' : null;
    const chosen = langJsonActual || langJsonOverride;
    if (chosen) assetsToInclude.add(chosen);
  }

  // Build manifest + pack icon.
  const manifestStage = await awaitExportStage(() => buildExportManifestText({ imported }));
  if (!manifestStage.ok) return;
  const manifestRes = manifestStage.value;
  if (!manifestRes.ok) {
    exportPackState.status = 'error';
    exportPackState.error = `Failed to build manifest.json: ${manifestRes.error}`;
    setStatus({ text: exportPackState.error, level: 'error' });
    safeRender();
    return;
  }
  for (const w of manifestRes.warnings || []) pushExportWarning(w);

  const iconStage = await awaitExportStage(() => getExportPackIconBlob({ caseIndex }));
  if (!iconStage.ok) return;
  const iconRes = iconStage.value;
  if (!iconRes.ok) {
    exportPackState.status = 'error';
    exportPackState.error = `Failed to build pack_icon.png: ${iconRes.error}`;
    setStatus({ text: exportPackState.error, level: 'error' });
    safeRender();
    return;
  }

  // Create ZIP (zip.js).
  let zipLib = null;
  try {
    zipLib = globalThis.zip;
    if (!zipLib || !zipLib.ZipWriter || !zipLib.BlobWriter || !zipLib.TextReader || !zipLib.BlobReader) {
      throw new Error('ZIP_LIB_NOT_LOADED');
    }
  } catch (err) {
    exportPackState.status = 'error';
    exportPackState.error = `ZIP library is not available: ${String(err?.message || err)}`;
    setStatus({ text: exportPackState.error, level: 'error' });
    safeRender();
    return;
  }

  /** @type {{ path: string, kind: 'text'|'blob' }[]} */
  const filesInOrder = [];

  // Root required files.
  filesInOrder.push({ path: 'manifest.json', kind: 'text' });
  filesInOrder.push({ path: 'pack_icon.png', kind: 'blob' });

  // UI files.
  for (const p of Array.from(uiFilesToInclude).sort()) {
    filesInOrder.push({ path: p, kind: 'text' });
  }

  // Dependency assets.
  for (const p of Array.from(assetsToInclude).sort()) {
    const lower = String(p).toLowerCase();
    const kind = (lower.endsWith('.json') || lower.endsWith('.jsonc') || lower.endsWith('.lang') || lower.endsWith('.txt'))
      ? 'text'
      : 'blob';
    filesInOrder.push({ path: p, kind });
  }

  // Bound the complete output before constructing the writer. Per-entry read
  // limits alone do not prevent a pack containing thousands of individually
  // valid files from exhausting browser memory while ZIP output is buffered.
  const exportOutputLimits = Object.freeze({
    files: 20_000,
    uncompressedBytes: isLikelyMobileViewport()
      ? 256 * 1024 * 1024
      : 512 * 1024 * 1024,
  });
  if (filesInOrder.length > exportOutputLimits.files) {
    exportPackState.status = 'error';
    exportPackState.error = `Export output exceeded its file safety limit (${exportOutputLimits.files}).`;
    setStatus({ text: exportPackState.error, level: 'error' });
    safeRender();
    return;
  }

  const outputPathOwners = new Map();
  const normalizedOutputPaths = new Map();
  let outputPathError = null;
  for (const file of filesInOrder) {
    let outPath;
    try {
      outPath = normalizeZipPath(file.path);
    } catch (error) {
      outputPathError = `Export contains an invalid output path (${String(file.path)}): ${String(error?.message || error)}.`;
      break;
    }
    const lower = outPath.toLowerCase();
    const previous = outputPathOwners.get(lower);
    if (previous) {
      outputPathError = previous === outPath
        ? `Export contains a duplicate output path: ${outPath}.`
        : `Export contains case-colliding output paths: ${previous} and ${outPath}.`;
      break;
    }
    if (caseIndex.collisions.has(lower)) {
      outputPathError = `Export requires an ambiguous case-colliding source path: ${outPath}.`;
      break;
    }
    outputPathOwners.set(lower, outPath);
    normalizedOutputPaths.set(file, outPath);
  }
  if (outputPathError) {
    exportPackState.status = 'error';
    exportPackState.error = outputPathError;
    setStatus({ text: exportPackState.error, level: 'error' });
    safeRender();
    return;
  }

  const declaredOutputSizeFor = (file) => {
    if (file.path === 'manifest.json') return boundedUtf8Length(manifestRes.text);
    if (file.path === 'pack_icon.png') return Number(iconRes.blob?.size);
    const generatedText = generatedTextByPackPath.get(file.path);
    if (typeof generatedText === 'string') return boundedUtf8Length(generatedText);
    const serializedUiJson = serializedUiJsonByPackPath.get(file.path);
    if (typeof serializedUiJson === 'string'
      && (String(file.path).toLowerCase().endsWith('.json') || String(file.path).toLowerCase().endsWith('.jsonc'))) {
      return boundedUtf8Length(serializedUiJson);
    }
    const overrideText = overrides?.[file.path];
    if (typeof overrideText === 'string') return boundedUtf8Length(overrideText);
    let zipPath;
    try {
      zipPath = normalizeZipPath(`${importedPackRuntime.rootPrefix}${normalizePackPath(file.path)}`);
    } catch {
      return Number.NaN;
    }
    const record = importedPackRuntime.zipReader?.entryIndex instanceof Map
      ? importedPackRuntime.zipReader.entryIndex.get(zipPath)
      : null;
    return Number(record?.info?.uncompressedSize);
  };

  let declaredOutputBytes = 0;
  for (const file of filesInOrder) {
    const declaredBytes = declaredOutputSizeFor(file);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      exportPackState.status = 'error';
      exportPackState.error = `Export could not verify the declared size of ${file.path}.`;
      setStatus({ text: exportPackState.error, level: 'error' });
      safeRender();
      return;
    }
    declaredOutputBytes += declaredBytes;
    if (!Number.isSafeInteger(declaredOutputBytes)
      || declaredOutputBytes > exportOutputLimits.uncompressedBytes) {
      exportPackState.status = 'error';
      exportPackState.error = `Export output exceeded its uncompressed-byte safety limit (${exportOutputLimits.uncompressedBytes} bytes).`;
      setStatus({ text: exportPackState.error, level: 'error' });
      safeRender();
      return;
    }
  }

  // Stream-write to zip blob.
  const writer = new zipLib.ZipWriter(new zipLib.BlobWriter('application/zip'));
  let addedCount = 0;
  let actualOutputBytes = 0;
  const reserveActualOutputBytes = (byteLength, path) => {
    const bytes = Number(byteLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`EXPORT_OUTPUT_SIZE_INVALID:${path}`);
    }
    actualOutputBytes += bytes;
    if (!Number.isSafeInteger(actualOutputBytes)
      || actualOutputBytes > exportOutputLimits.uncompressedBytes) {
      throw new Error(`EXPORT_OUTPUT_SIZE_LIMIT:${path}`);
    }
  };

  try {
    for (const f of filesInOrder) {
      const outPath = normalizedOutputPaths.get(f);

      if (f.path === 'manifest.json') {
        reserveActualOutputBytes(boundedUtf8Length(manifestRes.text), f.path);
        await awaitExportStageOrThrow(() => writer.add(outPath, new zipLib.TextReader(manifestRes.text)));
        addedCount++;
        continue;
      }

      if (f.path === 'pack_icon.png') {
        reserveActualOutputBytes(iconRes.blob.size, f.path);
        await awaitExportStageOrThrow(() => writer.add(outPath, new zipLib.BlobReader(iconRes.blob)));
        addedCount++;
        continue;
      }

      if (f.kind === 'text') {
        const generatedText = generatedTextByPackPath.get(f.path);
        // Prefer deterministic JSON output for UI JSON files that passed the
        // bounded dependency scan. Store serialized text rather than parsed
        // trees so export does not retain a second object graph for every UI.
        const serializedUiJson = serializedUiJsonByPackPath.get(f.path);
        if (typeof generatedText === 'string') {
          reserveActualOutputBytes(boundedUtf8Length(generatedText), f.path);
          await awaitExportStageOrThrow(() => writer.add(outPath, new zipLib.TextReader(generatedText)));
          addedCount++;
        } else if (typeof serializedUiJson === 'string'
          && (String(f.path).toLowerCase().endsWith('.json') || String(f.path).toLowerCase().endsWith('.jsonc'))) {
          reserveActualOutputBytes(boundedUtf8Length(serializedUiJson), f.path);
          await awaitExportStageOrThrow(() => writer.add(outPath, new zipLib.TextReader(serializedUiJson)));
          addedCount++;
        } else {
          const tr = await awaitExportStageOrThrow(() => readImportedPackTextResult(
            f.path,
            { maxTextBytes: 10 * 1024 * 1024 },
          ));
          if (!tr.ok) {
            if (uiFilesToInclude.has(f.path)) {
              throw new Error(`EXPORT_REQUIRED_UI_FILE_UNREADABLE:${f.path}:${tr.error}`);
            }
            pushExportWarning(`Skipped (unreadable): ${f.path} (${tr.error})`);
            continue;
          }
          reserveActualOutputBytes(boundedUtf8Length(tr.text), f.path);
          await awaitExportStageOrThrow(() => writer.add(outPath, new zipLib.TextReader(tr.text)));
          addedCount++;
        }
      } else {
        const br = await awaitExportStageOrThrow(() => readImportedPackBlob({
          packPath: f.path,
          maxBytes: 50 * 1024 * 1024,
        }));
        if (!br.ok) {
          if (requiredNativeAssetPaths.has(f.path)) {
            throw new Error(`EXPORT_REQUIRED_NATIVE_ASSET_UNREADABLE:${f.path}:${br.error}`);
          }
          pushExportWarning(`Skipped (unreadable): ${f.path} (${br.error})`);
          continue;
        }
        reserveActualOutputBytes(br.blob.size, f.path);
        await awaitExportStageOrThrow(() => writer.add(outPath, new zipLib.BlobReader(br.blob)));
        addedCount++;
      }

      if (addedCount % 50 === 0) {
        // Yield to the main thread periodically.
        await awaitExportStageOrThrow(() => new Promise((resolve) => setTimeout(resolve, 0)));
      }
    }

    const zipBlob = await awaitExportStageOrThrow(() => writer.close());
    if (!Number.isSafeInteger(zipBlob?.size) || zipBlob.size < 0
      || zipBlob.size > exportOutputLimits.uncompressedBytes) {
      throw new Error('EXPORT_ZIP_BLOB_SIZE_LIMIT');
    }

    const packName = String(imported?.manifestSummary?.header?.name || imported?.fileName || 'resource_pack');
    const safeName = packName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'resource_pack';
    const filename = `${safeName}_export.zip`;

    if (!exportSourceStillCurrent()) throw makeExportSourceChangedError();
    downloadBlobFile({ filename, blob: zipBlob });

    exportPackState.status = 'done';
    exportPackState.error = null;
    exportPackState.lastExportAtIso = new Date().toISOString();
    exportPackState.lastSummary = {
      fileCount: addedCount,
      uiFileCount: uiFilesToInclude.size,
      assetFileCount: assetsToInclude.size,
      usedDefaultPackIcon: iconRes.usedDefault,
      warningCount: exportWarningCount,
      warningsTruncated: exportWarningCount > 50,
      warnings: exportWarnings.slice(0, 50),
      declaredOutputBytes,
      actualOutputBytes,
    };

    diagnostics.log('info', 'Export completed', {
      source: 'export',
      data: {
        fileCount: addedCount,
        warningCount: exportWarningCount,
        retainedWarningCount: exportWarnings.length,
        declaredOutputBytes,
        actualOutputBytes,
        zipBytes: zipBlob.size,
      },
    });

    setStatus({ text: t('exportPack.status.done', { filename, count: addedCount }), level: 'info' });
    safeRender();
  } catch (err) {
    try {
      await writer.close();
    } catch {
      // ignore
    }
    if (err?.code === 'EXPORT_SOURCE_CHANGED' || err?.message === 'EXPORT_SOURCE_CHANGED') {
      failExportSourceChanged();
    } else {
      exportPackState.status = 'error';
      exportPackState.error = `Export failed: ${String(err?.message || err)}`;
      setStatus({ text: exportPackState.error, level: 'error' });
      diagnostics.captureError(err, { source: 'export', message: exportPackState.error });
      safeRender();
    }
  }

  // NOTE: Keep this function block properly closed. A missing closing brace
  // previously caused a hard startup parse failure:
  //   Uncaught SyntaxError: Unexpected end of input (at main.js:11182:1)
  // This comment is here as a regression guard.
}


/**
 * Resolve a manifest display-name key when a matching texts/*.lang table is
 * available. A raw localization key is never exposed as the pack name.
 * @param {any} importedPackState
 */
function getImportedPackDisplayName(importedPackState) {
  const headerName = String(importedPackState?.manifestSummary?.header?.name || '').trim();
  const fileName = String(importedPackState?.fileName || '').trim();
  const fileFallback = fileName.replace(/\.(?:zip|mcpack)$/i, '').trim() || 'resource-pack';
  if (!headerName) return fileFallback;
  if (!looksLikeLangKey(headerName)) return headerName;

  const state = store.getState();
  const localeRaw = state.ui && typeof state.ui.previewLocale === 'string' ? state.ui.previewLocale : 'ja_JP';
  const locale = SUPPORTED_PREVIEW_LOCALES.includes(localeRaw) ? localeRaw : 'ja_JP';
  const resolved = resolvePreviewLocalizedText(headerName, locale);
  if (resolved && resolved !== headerName) return resolved;
  return fileFallback;
}

function clampNumber(n, min, max, fallback = min) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/* --- Pack display helpers ------------------------------------------------ */

function getUiDefsPackPath(importedPackState) {
  const fileIndex = importedPackState && importedPackState.fileIndex ? importedPackState.fileIndex : null;
  const ui = fileIndex && fileIndex.ui ? fileIndex.ui : null;
  const sys = ui && ui.systemFiles ? ui.systemFiles : null;
  const existing = sys && sys.uiDefs ? String(sys.uiDefs) : null;
  if (existing) return existing;

  const root = ui && ui.rootFolder ? String(ui.rootFolder) : 'ui';
  return `${root}/_ui_defs.json`;
}

/**
 * Load and parse ui/_ui_defs.json into uiDefsEditorState.
 *
 * @param {{ createIfMissing?: boolean }} [opts]
 */
async function loadUiDefsFromImportedPack(opts = {}) {
  assertStudioExternalChange21('UI 登録情報の読み込み');
  const loadGeneration = uiDefsEditorState.generation + 1;
  uiDefsEditorState.generation = loadGeneration;
  const runtimeSnapshot = importedPackRuntime;
  const state = store.getState();
  const importedSnapshot = state.pack && state.pack.imported ? state.pack.imported : null;
  const isCurrentLoad = () => (
    uiDefsEditorState.generation === loadGeneration
    && importedPackRuntime === runtimeSnapshot
    && store.getState()?.pack?.imported === importedSnapshot
  );

  uiDefsEditorState.sourceRuntime = null;
  uiDefsEditorState.sourceImportedState = null;

  if (!runtimeSnapshot) {
    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = 'No imported pack is loaded.';
    safeRender();
    return;
  }

  if (!importedSnapshot) {
    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = 'No imported pack state is available.';
    safeRender();
    return;
  }

  markResourcePackMutation();
  uiDefsEditorState.status = 'loading';
  uiDefsEditorState.error = null;
  uiDefsEditorState.savedText = '';
  uiDefsEditorState.sourceRuntime = runtimeSnapshot;
  uiDefsEditorState.sourceImportedState = importedSnapshot;
  safeRender();

  const packPath = getUiDefsPackPath(importedSnapshot);
  uiDefsEditorState.packPath = packPath;

  let text;
  try {
    text = await readImportedPackText(packPath);
  } catch (e) {
    if (!isCurrentLoad()) return;
    const code = e instanceof Error ? e.message : String(e || 'UNKNOWN');
    if (code === 'ZIP_ENTRY_NOT_FOUND' && opts.createIfMissing) {
      // Create a new file in-memory.
      uiDefsEditorState.status = 'ready';
      uiDefsEditorState.error = null;
      uiDefsEditorState.formatVersion = 1;
      uiDefsEditorState.uiDefs = [];
      uiDefsEditorState.dirty = true;
      markResourcePackMutation();
      uiDefsEditorState.lastLoadedAtIso = new Date().toISOString();
      uiDefsEditorState.savedText = stableStringify(buildUiDefsJsonObject({
        formatVersion: uiDefsEditorState.formatVersion,
        uiDefs: uiDefsEditorState.uiDefs,
      }), { indent: 2, sortKeys: false, finalNewline: true });

      // S039: Baseline validation (schema-ish) for ui_defs.
      uiDefsEditorState.validation = validateUiDefsState({
        filePath: packPath,
        formatVersion: uiDefsEditorState.formatVersion,
        uiDefs: uiDefsEditorState.uiDefs,
      });
      if (uiDefsEditorState.validation.warningCount) {
        diagnostics.log('warn', `ui_defs validation warnings: ${summarizeValidation(uiDefsEditorState.validation)}`, {
          source: 'validation',
          data: { packPath, ...uiDefsEditorState.validation },
        });
      }
      safeRender();
      return;
    }

    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = `Failed to read ${packPath}: ${code}`;
    safeRender();
    return;
  }
  if (!isCurrentLoad()) return;

  const parsed = parseJsonc(text, {
    fileName: packPath,
    allowTrailingComma: true,
    allowEmptyContent: true,
  });

  if (!parsed.ok) {
    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = parsed.errors && parsed.errors.length
      ? parsed.errors[0].message
      : `Failed to parse ${packPath}.`;
    safeRender();
    return;
  }

  const value = parsed.value;
  const isObj = value && typeof value === 'object' && !Array.isArray(value);
  if (!isObj) {
    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = `${packPath} is not a JSON object.`;
    safeRender();
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'ui_defs') || !Array.isArray(value.ui_defs)) {
    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = `${packPath} must contain a ui_defs array.`;
    safeRender();
    return;
  }
  if (value.ui_defs.length > 5_000) {
    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = `${packPath} exceeds the ui_defs safety limit (5000 entries).`;
    safeRender();
    return;
  }
  if (value.ui_defs.some((entry) => typeof entry !== 'string')) {
    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = `${packPath} ui_defs entries must all be strings.`;
    safeRender();
    return;
  }
  if (value.ui_defs.some((entry) => entry.length > 1_024)) {
    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = `${packPath} contains a ui_defs entry longer than 1024 characters.`;
    safeRender();
    return;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'format_version')
    && (!Number.isInteger(value.format_version) || value.format_version < 1)) {
    uiDefsEditorState.status = 'error';
    uiDefsEditorState.error = `${packPath} format_version must be a positive integer.`;
    safeRender();
    return;
  }

  const formatVersion = value.format_version ?? 1;
  const uiDefsArr = value.ui_defs;

  uiDefsEditorState.status = 'ready';
  uiDefsEditorState.error = null;
  uiDefsEditorState.formatVersion = formatVersion;
  uiDefsEditorState.uiDefs = uiDefsArr.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  uiDefsEditorState.dirty = false;
  uiDefsEditorState.lastLoadedAtIso = new Date().toISOString();
  uiDefsEditorState.savedText = stableStringify(buildUiDefsJsonObject({
    formatVersion: uiDefsEditorState.formatVersion,
    uiDefs: uiDefsEditorState.uiDefs,
  }), { indent: 2, sortKeys: false, finalNewline: true });

  // S039: Baseline validation (schema-ish) for ui_defs.
  uiDefsEditorState.validation = validateUiDefsState({
    filePath: packPath,
    formatVersion: uiDefsEditorState.formatVersion,
    uiDefs: uiDefsEditorState.uiDefs,
  });
  try {
    const summary = summarizeValidation(uiDefsEditorState.validation);
    if (!uiDefsEditorState.validation.ok) {
      diagnostics.log('error', `ui_defs validation failed: ${summary}`, {
        source: 'validation',
        data: { packPath, ...uiDefsEditorState.validation },
      });
    } else if (uiDefsEditorState.validation.warningCount) {
      diagnostics.log('warn', `ui_defs validation warnings: ${summary}`, {
        source: 'validation',
        data: { packPath, ...uiDefsEditorState.validation },
      });
    }
  } catch {
    // Ignore validation logging failures.
  }

  safeRender();
}

/**
 * Save the current uiDefsEditorState into the imported pack override map.
 */
function saveUiDefsToImportedPack(options = {}) {
  assertStudioExternalChange21('UI 登録情報の保存');
  if (uiDefsEditorState.status !== 'ready' || !uiDefsEditorState.packPath) {
    return { ok: false, error: 'UI_DEFS_NOT_READY' };
  }
  if (!importedPackRuntime) return { ok: false, error: 'IMPORTED_PACK_NOT_READY' };
  const imported = store.getState()?.pack?.imported || null;
  if (uiDefsEditorState.sourceRuntime !== importedPackRuntime
    || uiDefsEditorState.sourceImportedState !== imported) {
    uiDefsEditorState.error = 'Save blocked because the loaded ui_defs belongs to a replaced resource pack.';
    safeRender();
    return { ok: false, error: 'UI_DEFS_SOURCE_CHANGED' };
  }

  // S039: Validate before saving/exporting.
  const v = validateUiDefsState({
    filePath: uiDefsEditorState.packPath,
    formatVersion: uiDefsEditorState.formatVersion,
    uiDefs: uiDefsEditorState.uiDefs,
  });
  uiDefsEditorState.validation = v;
  if (!v.ok) {
    uiDefsEditorState.error = v.errors && v.errors.length ? v.errors[0].message : summarizeValidation(v);
    safeRender();
    setStatus(`Save blocked: ${summarizeValidation(v)}`);
    return { ok: false, error: 'UI_DEFS_INVALID' };
  }

  const obj = buildUiDefsJsonObject({
    formatVersion: uiDefsEditorState.formatVersion,
    uiDefs: uiDefsEditorState.uiDefs,
  });

  const out = stableStringify(obj, { indent: 2, sortKeys: false, finalNewline: true });

  // Validate that output is strict JSON.
  try {
    JSON.parse(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || 'UNKNOWN');
    uiDefsEditorState.error = `Save failed: output JSON is invalid (${msg}).`;
    uiDefsEditorState.status = 'error';
    safeRender();
    return { ok: false, error: 'UI_DEFS_SERIALIZATION_INVALID' };
  }

  if (!importedPackRuntime.overridesTextByPackPath) {
    importedPackRuntime.overridesTextByPackPath = {};
  }
  importedPackRuntime.overridesTextByPackPath[String(uiDefsEditorState.packPath)] = out;
  markResourcePackMutation();

  uiDefsEditorState.savedText = out;
  uiDefsEditorState.dirty = false;
  uiDefsEditorState.lastSavedAtIso = new Date().toISOString();
  uiDefsEditorState.error = null;

  setStatus(t('editor.uiDefs.status.saved', { path: uiDefsEditorState.packPath }));
  safeRender();
  const refreshPromise = options.rebuildProjection === false
    ? null
    : rebuildUiCatalogAndCurrentProjection('ui-defs-saved');
  return { ok: true, refreshPromise };
}

/**
 * Download the current saved ui_defs JSON as a file.
 */
function downloadUiDefsJson() {
  if (uiDefsEditorState.status !== 'ready') return;

  // S039: Validate before exporting.
  const v = validateUiDefsState({
    filePath: uiDefsEditorState.packPath || 'ui/_ui_defs.json',
    formatVersion: uiDefsEditorState.formatVersion,
    uiDefs: uiDefsEditorState.uiDefs,
  });
  uiDefsEditorState.validation = v;
  if (!v.ok) {
    uiDefsEditorState.error = v.errors && v.errors.length ? v.errors[0].message : summarizeValidation(v);
    safeRender();
    setStatus(`Download blocked: ${summarizeValidation(v)}`);
    return;
  }

  const name = uiDefsEditorState.packPath
    ? String(uiDefsEditorState.packPath).split('/').pop() || '_ui_defs.json'
    : '_ui_defs.json';

  const out = stableStringify(buildUiDefsJsonObject({
    formatVersion: uiDefsEditorState.formatVersion,
    uiDefs: uiDefsEditorState.uiDefs,
  }), { indent: 2, sortKeys: false, finalNewline: true });

  const blob = new Blob([out], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/* --- S027: _global_variables.json editor ------------------------------- */

/**
 * @typedef {'string'|'number'|'boolean'|'json'} GlobalVarValueType
 */

/**
 * @typedef {{ name: string, type: GlobalVarValueType, valueText: string }} GlobalVarEntry
 */

/**
 * Editor state for ui/_global_variables.json.
 *
 * NOTE: This is intentionally kept as a local module state (like uiDefsEditorState)
 * rather than part of the global store. Undo/redo is explicitly out of scope.
 *
 * @type {{
 *  status: 'idle'|'loading'|'ready'|'error',
 *  error: string|null,
 *  packPath: string|null,
 *  fileFormat: 'bare'|'wrapped'|null,
 *  extraRootFields: Record<string, any>,
 *  formatVersion: number,
 *  entries: GlobalVarEntry[],
 *  dirty: boolean,
 *  newNameText: string,
 *  newType: GlobalVarValueType,
 *  newValueText: string,
 *  lastLoadedAtIso: string|null,
 *  lastSavedAtIso: string|null,
 *  savedText: string,
 *  generation: number,
 *  sourceRuntime: any,
 *  sourceImportedState: any,
 * }}
 */
const globalVarsEditorState = {
  status: 'idle',
  error: null,
  packPath: null,
  fileFormat: null,
  extraRootFields: Object.create(null),
  formatVersion: 1,
  entries: [],
  dirty: false,
  newNameText: '',
  newType: 'string',
  newValueText: '',
  lastLoadedAtIso: null,
  lastSavedAtIso: null,
  savedText: '',
  generation: 0,
  sourceRuntime: null,
  sourceImportedState: null,
};

function resetGlobalVarsEditorState() {
  globalVarsEditorState.generation += 1;
  globalVarsEditorState.status = 'idle';
  globalVarsEditorState.error = null;
  globalVarsEditorState.packPath = null;
  globalVarsEditorState.fileFormat = null;
  globalVarsEditorState.extraRootFields = Object.create(null);
  globalVarsEditorState.formatVersion = 1;
  globalVarsEditorState.entries = [];
  globalVarsEditorState.dirty = false;
  globalVarsEditorState.newNameText = '';
  globalVarsEditorState.newType = 'string';
  globalVarsEditorState.newValueText = '';
  globalVarsEditorState.lastLoadedAtIso = null;
  globalVarsEditorState.lastSavedAtIso = null;
  globalVarsEditorState.savedText = '';
  globalVarsEditorState.sourceRuntime = null;
  globalVarsEditorState.sourceImportedState = null;
}

/* --- S028/S032: UI screen file loader (tree + basic structure edits) --------------------------- */

/**
 * Lightweight UI state for opening a UI screen file.
 *
 * NOTE: Property editing is not implemented yet. Tree structure edits are implemented in S032.
 */
const screenOpenState = {
  status: 'idle', // idle|loading|ready|error
  generation: 0,
  error: null,
  selectedPath: '',
  selectedDefinition: '',
  manualPath: '',
  lastOpenedPath: null,
  lastOpenedDefinition: null,
  lastOpenedAtIso: null,
  lastResolution: null,
};

const uiCatalogState = {
  status: 'idle', // idle|loading|ready|error
  error: null,
  catalog: null,
  generation: 0,
  inflight: null,
  abortController: null,
  progress: { processed: 0, total: 0, filePath: null },
  builtAtIso: null,
};

function resetScreenOpenState() {
  workspaceNavigationState.file.query = '';
  workspaceNavigationState.file.page = 0;
  workspaceNavigationState.definition.query = '';
  workspaceNavigationState.definition.page = 0;
  workspaceNavigationState.advanced.open = false;
  // Invalidate every in-flight screen read/resolve before clearing visible
  // state. A late ZIP read from the previous pack must never reopen a stale
  // projection after a pack replacement or project reset.
  screenOpenState.generation += 1;
  screenOpenState.status = 'idle';
  screenOpenState.error = null;
  screenOpenState.selectedPath = '';
  screenOpenState.selectedDefinition = '';
  screenOpenState.manualPath = '';
  screenOpenState.lastOpenedPath = null;
  screenOpenState.lastOpenedDefinition = null;
  screenOpenState.lastOpenedAtIso = null;
  screenOpenState.lastResolution = null;
  resetUiCatalogState();
}

function resetUiCatalogState() {
  try { uiCatalogState.abortController?.abort('UI_CATALOG_RESET'); } catch {}
  // Catalog identity is part of an open request's consistency token. A late
  // ZIP read must not commit a projection resolved against the replaced
  // composition, and the refresh queue must not remain parked in `loading`.
  screenOpenState.generation += 1;
  if (screenOpenState.status === 'loading') {
    screenOpenState.status = 'idle';
    screenOpenState.error = null;
  }
  uiCatalogState.generation += 1;
  uiCatalogState.status = 'idle';
  uiCatalogState.error = null;
  uiCatalogState.catalog = null;
  uiCatalogState.inflight = null;
  uiCatalogState.abortController = null;
  uiCatalogState.progress = { processed: 0, total: 0, filePath: null };
  uiCatalogState.builtAtIso = null;
}

function requestUiCatalogBuild(reason = '') {
  if (uiCatalogState.status === 'loading' && uiCatalogState.inflight) return uiCatalogState.inflight;
  if (!importedPackRuntime && !vanillaReferenceRuntime) return Promise.resolve(null);

  const generation = uiCatalogState.generation + 1;
  try { uiCatalogState.abortController?.abort('UI_CATALOG_REPLACED'); } catch {}
  const abortController = new AbortController();
  uiCatalogState.generation = generation;
  uiCatalogState.status = 'loading';
  uiCatalogState.error = null;
  uiCatalogState.abortController = abortController;
  uiCatalogState.progress = { processed: 0, total: 0, filePath: null };

  const importedSnapshot = importedPackRuntime;
  const vanillaSnapshot = vanillaReferenceRuntime;
  const sources = [];
  if (vanillaSnapshot) {
    sources.push({
      id: 'vanilla-reference',
      kind: 'vanilla',
      precedence: 10,
      filePaths: vanillaSnapshot.packPaths,
      readText: async (packPath, options = {}) => vanillaSnapshot.zipReader.readText(`${vanillaSnapshot.rootPrefix}${packPath}`, {
        maxBytes: Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : DEFAULT_ZIP_LIMITS.maxTextFileBytesForRead,
        encoding: 'utf-8',
        signal: options.signal,
      }),
    });
  }
  if (importedSnapshot) {
    // Editor-created system files (for example a previously missing
    // ui/_ui_defs.json) live in the in-memory override map until export.  They
    // must participate in catalog discovery immediately; limiting filePaths
    // to the original ZIP would make Save appear to succeed while every
    // resolver continued to use the stale registry.
    const importedCatalogPaths = Array.from(new Set([
      ...(Array.isArray(importedSnapshot.packPaths) ? importedSnapshot.packPaths : []),
      ...Object.keys(importedSnapshot.overridesTextByPackPath || {}),
    ]));
    sources.push({
      id: 'imported-pack',
      kind: 'imported',
      precedence: 20,
      filePaths: importedCatalogPaths,
      readText: async (packPath, options = {}) => {
        const override = importedSnapshot.overridesTextByPackPath
          ? importedSnapshot.overridesTextByPackPath[packPath]
          : undefined;
        if (typeof override === 'string') return override;
        return importedSnapshot.zipReader.readText(`${importedSnapshot.rootPrefix}${packPath}`, {
          maxBytes: Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : DEFAULT_ZIP_LIMITS.maxTextFileBytesForRead,
          encoding: 'utf-8',
          signal: options.signal,
        });
      },
    });
  }

  const promise = (async () => {
    const remote = await buildNodeCatalog(importedSnapshot, vanillaSnapshot, abortController.signal);
    if (remote) return remote;
    return buildUiCatalog({
    sources,
    parseJsonc,
    signal: abortController.signal,
    limits: {
      maxFiles: 5000,
      maxDefinitions: 100000,
      maxTextBytesPerFile: DEFAULT_ZIP_LIMITS.maxTextFileBytesForRead,
      maxTotalTextBytes: 64 * 1024 * 1024,
    },
    onProgress: (progress) => {
      if (generation !== uiCatalogState.generation) return;
      uiCatalogState.progress = {
        processed: Number(progress.processed) || 0,
        total: Number(progress.total) || 0,
        filePath: progress.filePath ? String(progress.filePath) : null,
      };
      if (uiCatalogState.progress.processed % 8 === 0) {
        setStatus(`UI catalog… ${uiCatalogState.progress.processed}/${uiCatalogState.progress.total}`);
      }
    },
    });
  })()
    .then((catalog) => {
      if (generation !== uiCatalogState.generation) return null;
      uiCatalogState.catalog = catalog;
      uiCatalogState.status = 'ready';
      uiCatalogState.error = null;
      uiCatalogState.builtAtIso = new Date().toISOString();
      diagnostics.log('info', 'UI catalog built', {
        source: 'ui-catalog',
        data: { reason, summary: catalog.summary },
      });
      return catalog;
    })
    .catch((error) => {
      if (generation !== uiCatalogState.generation) return null;
      uiCatalogState.status = 'error';
      uiCatalogState.error = String(error && error.message ? error.message : error || 'UI_CATALOG_FAILED');
      diagnostics.captureError(error, { source: 'ui-catalog', message: 'UI catalog build failed', data: { reason } });
      return null;
    })
    .finally(() => {
      if (generation === uiCatalogState.generation) {
        uiCatalogState.inflight = null;
        uiCatalogState.abortController = null;
        safeRender();
      }
    });

  uiCatalogState.inflight = promise;
  safeRender();
  return promise;
}

function rebuildUiCatalogAndCurrentProjection(reason) {
  resetUiCatalogState();
  return requestUiCatalogBuild(reason)
    .then(() => refreshCurrentPreviewAfterCompositionChange())
    .catch((error) => {
      diagnostics.captureError(error, {
        source: 'ui-catalog',
        message: 'UI catalog/projection refresh failed',
        data: { reason },
      });
      return null;
    });
}

/* --- S050: Resource pack ZIP export (minimal packaging) --------------------------- */

/**
 * Lightweight UI state for exporting a minimal resource pack ZIP (UI_PLUS_DEPS).
 *
 * @type {{
 *  status: 'idle'|'working'|'done'|'error',
 *  error: string|null,
 *  lastSummary: any,
 *  lastExportAtIso: string|null,
 * }}
 */
const exportPackState = {
  status: 'idle',
  error: null,
  lastSummary: null,
  lastExportAtIso: null,
};

function resetExportPackState() {
  exportPackState.status = 'idle';
  exportPackState.error = null;
  exportPackState.lastSummary = null;
  exportPackState.lastExportAtIso = null;
}

/** @param {string} name */
function validateGlobalVarName(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length === 0) return t('editor.globalVars.errors.nameRequired');
  if (!trimmed.startsWith('$')) return t('editor.globalVars.errors.nameMustStartWithDollar');
  if (trimmed.length < 2) return t('editor.globalVars.errors.nameTooShort');
  if (/\s/.test(trimmed)) return t('editor.globalVars.errors.nameNoWhitespace');
  return null;
}

/**
 * @param {GlobalVarValueType} type
 * @param {string} valueText
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
function parseGlobalVarValue(type, valueText) {
  if (type === 'string') return { ok: true, value: String(valueText ?? '') };
  if (type === 'number') {
    const n = Number(String(valueText ?? ''));
    if (!Number.isFinite(n)) return { ok: false, error: t('editor.globalVars.errors.invalidNumber') };
    return { ok: true, value: n };
  }
  if (type === 'boolean') {
    const v = String(valueText ?? '').trim().toLowerCase();
    if (v === 'true') return { ok: true, value: true };
    if (v === 'false') return { ok: true, value: false };
    return { ok: false, error: t('editor.globalVars.errors.invalidBoolean') };
  }
  // json
  try {
    const parsed = JSON.parse(String(valueText ?? ''));
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: t('editor.globalVars.errors.invalidJson') };
  }
}

/**
 * Determine the pack path for the global variables system file.
 *
 * @param {{ fileIndex: any }} imported
 */
function getGlobalVariablesPackPath(imported) {
  const sysPath = imported?.fileIndex?.ui?.systemFiles?.globalVariables ?? null;
  if (typeof sysPath === 'string' && sysPath.trim().length > 0) return sysPath;
  // Fallback to the same folder used by detected UI root.
  const uiRootFolder = imported?.fileIndex?.ui?.uiRootFolder ?? 'ui';
  return `${uiRootFolder}/_global_variables.json`;
}

/**
 * @param {{ fileFormat: 'bare'|'wrapped', extraRootFields: Record<string, any>, formatVersion: number, entries: GlobalVarEntry[] }} input
 * @returns {{ ok: true, obj: any } | { ok: false, error: string }}
 */
function buildGlobalVarsOutputObject(input) {
  const { fileFormat, extraRootFields, formatVersion, entries } = input;

  /** @type {Record<string, number>} */
  const nameCounts = Object.create(null);
  for (const e of entries) {
    const n = String(e?.name ?? '').trim();
    nameCounts[n] = (nameCounts[n] ?? 0) + 1;
  }

  /** @type {Record<string, any>} */
  const varsObj = Object.create(null);
  for (const entry of entries) {
    const name = String(entry?.name ?? '').trim();
    const nameErr = validateGlobalVarName(name);
    if (nameErr) return { ok: false, error: nameErr };
    if ((nameCounts[name] ?? 0) > 1) return { ok: false, error: t('editor.globalVars.errors.duplicateName', { name }) };

    const parsed = parseGlobalVarValue(entry.type, entry.valueText);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    varsObj[name] = parsed.value;
  }

  const extras = extraRootFields && typeof extraRootFields === 'object' ? extraRootFields : {};

  if (fileFormat === 'wrapped') {
    // Preserve extra root keys, but do not allow overriding reserved keys.
    const out = Object.create(null);
    // Keep $schema first if present.
    if (typeof extras.$schema === 'string') out.$schema = extras.$schema;
    for (const [k, v] of Object.entries(extras)) {
      if (k === '$schema') continue;
      if (k === 'format_version') continue;
      if (k === 'variables') continue;
      out[k] = v;
    }
    out.format_version = formatVersion;
    out.variables = varsObj;
    return { ok: true, obj: out };
  }

  // bare map format
  const out = Object.create(null);
  if (typeof extras.$schema === 'string') out.$schema = extras.$schema;
  for (const [k, v] of Object.entries(extras)) {
    if (k === '$schema') continue;
    // In bare format, do not allow extras to shadow variables.
    if (k in varsObj) continue;
    out[k] = v;
  }
  for (const [k, v] of Object.entries(varsObj)) out[k] = v;
  return { ok: true, obj: out };
}

/**
 * Load _global_variables.json from the imported pack overlay.
 *
 * @param {{ createIfMissing?: boolean }} [opts]
 */
async function loadGlobalVariablesFromImportedPack(opts = {}) {
  assertStudioExternalChange21('共通変数の読み込み');
  const { createIfMissing = false } = opts;
  const loadGeneration = globalVarsEditorState.generation + 1;
  globalVarsEditorState.generation = loadGeneration;
  const runtimeSnapshot = importedPackRuntime;
  const state = store.getState();
  const importedSnapshot = state.pack && state.pack.imported ? state.pack.imported : null;
  const isCurrentLoad = () => (
    globalVarsEditorState.generation === loadGeneration
    && importedPackRuntime === runtimeSnapshot
    && store.getState()?.pack?.imported === importedSnapshot
  );

  globalVarsEditorState.sourceRuntime = null;
  globalVarsEditorState.sourceImportedState = null;

  if (!runtimeSnapshot) {
    globalVarsEditorState.status = 'error';
    globalVarsEditorState.error = t('editor.globalVars.errors.noImportedPack');
    safeRender();
    return;
  }

  if (!importedSnapshot) {
    globalVarsEditorState.status = 'error';
    globalVarsEditorState.error = t('editor.globalVars.errors.noImportedPack');
    safeRender();
    return;
  }

  markResourcePackMutation();
  globalVarsEditorState.status = 'loading';
  globalVarsEditorState.error = null;
  globalVarsEditorState.sourceRuntime = runtimeSnapshot;
  globalVarsEditorState.sourceImportedState = importedSnapshot;
  safeRender();

  const packPath = getGlobalVariablesPackPath(importedSnapshot);
  globalVarsEditorState.packPath = packPath;

  let text;
  try {
    text = await readImportedPackText(packPath);
  } catch (e) {
    if (!isCurrentLoad()) return;
    const code = e instanceof Error ? e.message : String(e || 'UNKNOWN');
    if (code === 'ZIP_ENTRY_NOT_FOUND' && createIfMissing) {
      // Default to the documented "bare map" format.
      globalVarsEditorState.fileFormat = 'bare';
      globalVarsEditorState.extraRootFields = Object.create(null);
      globalVarsEditorState.formatVersion = 1;
      globalVarsEditorState.entries = [];
      globalVarsEditorState.dirty = true;
      markResourcePackMutation();
      globalVarsEditorState.lastLoadedAtIso = new Date().toISOString();
      const out = buildGlobalVarsOutputObject({
        fileFormat: 'bare',
        extraRootFields: Object.create(null),
        formatVersion: 1,
        entries: [],
      });
      try {
        globalVarsEditorState.savedText = out.ok
          ? stableStringify(out.obj, { indent: 2, sortKeys: false, finalNewline: true })
          : '';
      } catch (error) {
        globalVarsEditorState.status = 'error';
        globalVarsEditorState.error = `Failed to serialize ${packPath}: ${String(error?.message || error)}`;
        safeRender();
        return;
      }
      globalVarsEditorState.status = 'ready';
      safeRender();
      return;
    }

    globalVarsEditorState.status = 'error';
    globalVarsEditorState.error = code === 'ZIP_ENTRY_NOT_FOUND'
      ? t('editor.globalVars.errors.fileNotFound', { path: packPath })
      : `Failed to read ${packPath}: ${code}`;
    diagnostics.captureError(e, {
      source: 'global-vars',
      message: globalVarsEditorState.error,
      data: { packPath },
    });
    safeRender();
    return;
  }
  if (!isCurrentLoad()) return;

  const parsed = parseJsonc(text, { fileName: packPath });
  if (!parsed.ok) {
    const first = parsed.errors && parsed.errors.length ? parsed.errors[0].message : 'Parse failed.';
    globalVarsEditorState.status = 'error';
    globalVarsEditorState.error = t('editor.globalVars.errors.parseFailed', { message: first });
    safeRender();
    return;
  }

  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    globalVarsEditorState.status = 'error';
    globalVarsEditorState.error = t('editor.globalVars.errors.rootMustBeObject');
    safeRender();
    return;
  }

  const rootObj = /** @type {Record<string, any>} */ (parsed.value);
  const rootKeys = Object.keys(rootObj);
  if (rootKeys.length > 20_000) {
    globalVarsEditorState.status = 'error';
    globalVarsEditorState.error = `${packPath} exceeds the global-variable safety limit (20000 root entries).`;
    safeRender();
    return;
  }

  // Support two observed formats:
  // - "bare": { "$var": ... }
  // - "wrapped": { "format_version": 1, "variables": { "$var": ... } }
  const hasVariablesField = Object.prototype.hasOwnProperty.call(rootObj, 'variables');
  const isWrapped = hasVariablesField
    && rootObj.variables
    && typeof rootObj.variables === 'object'
    && !Array.isArray(rootObj.variables);
  if (hasVariablesField && !isWrapped) {
    globalVarsEditorState.status = 'error';
    globalVarsEditorState.error = `${packPath} variables must be a JSON object.`;
    safeRender();
    return;
  }

  const fileFormat = isWrapped ? 'wrapped' : 'bare';
  globalVarsEditorState.fileFormat = fileFormat;
  globalVarsEditorState.extraRootFields = Object.create(null);

  let varsObj = Object.create(null);
  if (fileFormat === 'wrapped') {
    varsObj = /** @type {Record<string, any>} */ (rootObj.variables ?? {});
    if (Object.keys(varsObj).length > 20_000) {
      globalVarsEditorState.status = 'error';
      globalVarsEditorState.error = `${packPath} exceeds the global-variable safety limit (20000 variables).`;
      safeRender();
      return;
    }
    if (Object.prototype.hasOwnProperty.call(rootObj, 'format_version')
      && (!Number.isInteger(rootObj.format_version) || rootObj.format_version < 1)) {
      globalVarsEditorState.status = 'error';
      globalVarsEditorState.error = `${packPath} format_version must be a positive integer.`;
      safeRender();
      return;
    }
    globalVarsEditorState.formatVersion = rootObj.format_version ?? 1;
    for (const [k, v] of Object.entries(rootObj)) {
      if (k === 'format_version') continue;
      if (k === 'variables') continue;
      globalVarsEditorState.extraRootFields[k] = v;
    }
  } else {
    // In bare format, only treat "$*" keys (except $schema) as variables.
    for (const [k, v] of Object.entries(rootObj)) {
      if (k === '$schema') {
        globalVarsEditorState.extraRootFields.$schema = v;
        continue;
      }
      if (k.startsWith('$')) {
        varsObj[k] = v;
        continue;
      }
      globalVarsEditorState.extraRootFields[k] = v;
    }
    globalVarsEditorState.formatVersion = 1;
  }

  /** @type {GlobalVarEntry[]} */
  const entries = [];
  try {
    for (const [name, value] of Object.entries(varsObj)) {
      /** @type {GlobalVarValueType} */
      let type = 'json';
      let valueText = '';
      if (typeof value === 'string') {
        type = 'string';
        valueText = value;
      } else if (typeof value === 'number') {
        type = 'number';
        valueText = String(value);
      } else if (typeof value === 'boolean') {
        type = 'boolean';
        valueText = value ? 'true' : 'false';
      } else {
        type = 'json';
        valueText = stableStringify(value, { indent: 0, sortKeys: false, finalNewline: false });
      }
      entries.push({ name, type, valueText });
    }
  } catch (error) {
    globalVarsEditorState.status = 'error';
    globalVarsEditorState.error = `Failed to normalize ${packPath}: ${String(error?.message || error)}`;
    safeRender();
    return;
  }

  globalVarsEditorState.entries = entries;
  globalVarsEditorState.dirty = false;
  globalVarsEditorState.newNameText = '';
  globalVarsEditorState.newType = 'string';
  globalVarsEditorState.newValueText = '';
  globalVarsEditorState.lastLoadedAtIso = new Date().toISOString();

  const out = buildGlobalVarsOutputObject({
    fileFormat,
    extraRootFields: globalVarsEditorState.extraRootFields,
    formatVersion: globalVarsEditorState.formatVersion,
    entries: globalVarsEditorState.entries,
  });
  try {
    globalVarsEditorState.savedText = out.ok
      ? stableStringify(out.obj, { indent: 2, sortKeys: false, finalNewline: true })
      : '';
  } catch (error) {
    globalVarsEditorState.status = 'error';
    globalVarsEditorState.error = `Failed to serialize ${packPath}: ${String(error?.message || error)}`;
    safeRender();
    return;
  }

  globalVarsEditorState.status = 'ready';
  safeRender();
}

function saveGlobalVariablesToImportedPack(options = {}) {
  assertStudioExternalChange21('共通変数の保存');
  if (globalVarsEditorState.status !== 'ready') return { ok: false, error: 'GLOBAL_VARS_NOT_READY' };
  if (!importedPackRuntime) return { ok: false, error: 'IMPORTED_PACK_NOT_READY' };
  const state = store.getState();
  const imported = state.pack && state.pack.imported ? state.pack.imported : null;
  if (!imported) return { ok: false, error: 'IMPORTED_PACK_STATE_NOT_READY' };
  if (globalVarsEditorState.sourceRuntime !== importedPackRuntime
    || globalVarsEditorState.sourceImportedState !== imported) {
    globalVarsEditorState.error = 'Save blocked because the loaded global variables belong to a replaced resource pack.';
    safeRender();
    return { ok: false, error: 'GLOBAL_VARS_SOURCE_CHANGED' };
  }
  const packPath = globalVarsEditorState.packPath;
  if (!packPath) return { ok: false, error: 'GLOBAL_VARS_PATH_MISSING' };

  globalVarsEditorState.error = null;

  const fileFormat = globalVarsEditorState.fileFormat ?? 'bare';
  const out = buildGlobalVarsOutputObject({
    fileFormat,
    extraRootFields: globalVarsEditorState.extraRootFields,
    formatVersion: globalVarsEditorState.formatVersion,
    entries: globalVarsEditorState.entries,
  });
  if (!out.ok) {
    globalVarsEditorState.error = out.error;
    safeRender();
    return { ok: false, error: out.error };
  }

  let outputText;
  try {
    outputText = stableStringify(out.obj, { indent: 2, sortKeys: false, finalNewline: true });
  } catch (error) {
    globalVarsEditorState.error = `Save failed: ${String(error?.message || error)}`;
    safeRender();
    return { ok: false, error: 'GLOBAL_VARS_SERIALIZATION_FAILED' };
  }

  if (!importedPackRuntime.overridesTextByPackPath) {
    importedPackRuntime.overridesTextByPackPath = {};
  }
  importedPackRuntime.overridesTextByPackPath[packPath] = outputText;
  markResourcePackMutation();

  globalVarsEditorState.dirty = false;
  globalVarsEditorState.lastSavedAtIso = new Date().toISOString();
  globalVarsEditorState.savedText = outputText;

  // Keep the merged global variable name index in sync for reference checks.
  resetGlobalVarNamesRuntime();
  const globalNamesPromise = requestGlobalVarNamesLoad('globalVarsSaved');
  safeRender();
  const refreshPromise = options.rebuildProjection === false
    ? null
    : rebuildUiCatalogAndCurrentProjection('global-vars-saved');
  return { ok: true, refreshPromise, globalNamesPromise };
}

function downloadGlobalVariablesJson() {
  if (globalVarsEditorState.status !== 'ready') return;
  const packPath = globalVarsEditorState.packPath;
  if (!packPath) return;

  const fileName = packPath.split('/').pop() || '_global_variables.json';
  const blob = new Blob([globalVarsEditorState.savedText || ''], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function addNewGlobalVarEntry() {
  assertStudioExternalChange21('共通変数の追加');
  if (globalVarsEditorState.status !== 'ready') return;

  const name = String(globalVarsEditorState.newNameText ?? '').trim();
  const nameErr = validateGlobalVarName(name);
  if (nameErr) {
    globalVarsEditorState.error = nameErr;
    safeRender();
    return;
  }
  const existingNames = new Set(globalVarsEditorState.entries.map((e) => String(e.name ?? '').trim()));
  if (existingNames.has(name)) {
    globalVarsEditorState.error = t('editor.globalVars.errors.duplicateName', { name });
    safeRender();
    return;
  }

  globalVarsEditorState.entries = [
    ...globalVarsEditorState.entries,
    {
      name,
      type: globalVarsEditorState.newType,
      valueText: String(globalVarsEditorState.newValueText ?? ''),
    },
  ];
  globalVarsEditorState.newNameText = '';
  globalVarsEditorState.newType = 'string';
  globalVarsEditorState.newValueText = '';
  globalVarsEditorState.dirty = true;
  markResourcePackMutation();
  globalVarsEditorState.error = null;
  safeRender();
}



/* --- S055: Impact warnings for breaking changes --------------------- */

const IMPACT_GLOBAL_VAR_REF_RE = /^\$[A-Za-z0-9_.]+$/;

/**
 * @param {any} v
 * @returns {string|null}
 */
function normalizeImpactVarRef(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!IMPACT_GLOBAL_VAR_REF_RE.test(s)) return null;
  return s;
}

/**
 * @typedef {{
 *  file: string,
 *  nodeId?: (string|null),
 *  nodeKey?: (string|null),
 *  propKey?: (string|null),
 *  where?: (string|null),
 * }} ImpactLocation
 */

/**
 * Scan an arbitrary JSON-ish value for "$var" style references.
 *
 * @param {{ v:any, onVar:(name:string)=>void, depth?:number, maxDepth?:number }} params
 */
function walkForImpactVarRefs({ v, onVar, depth = 0, maxDepth = 12 }) {
  if (depth > maxDepth) return;
  if (typeof v === 'string') {
    const ref = normalizeImpactVarRef(v);
    if (ref) onVar(ref);
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) walkForImpactVarRefs({ v: item, onVar, depth: depth + 1, maxDepth });
    return;
  }
  if (v && typeof v === 'object') {
    for (const child of Object.values(v)) walkForImpactVarRefs({ v: child, onVar, depth: depth + 1, maxDepth });
  }
}

/**
 * @param {Map<string, ImpactLocation[]>} map
 * @param {string} ref
 * @param {ImpactLocation} loc
 * @param {number} maxPerRef
 */
function addImpactLocation(map, ref, loc, maxPerRef = 50) {
  if (!ref) return;
  if (!map.has(ref)) map.set(ref, []);
  const arr = map.get(ref);
  if (arr.length >= maxPerRef) return;
  arr.push(loc);
}

/**
 * @param {{
 *  node:any,
 *  fileLabel:string,
 *  outVarMap:Map<string,ImpactLocation[]>,
 *  outTextureMap:Map<string,ImpactLocation[]>,
 *  maxPerRef:number,
 * }} params
 */
function scanUiNodeForImpactRefs({ node, fileLabel, outVarMap, outTextureMap, maxPerRef }) {
  if (!node || typeof node !== 'object') return;

  const nodeId = typeof node.id === 'string' ? node.id : null;
  const nodeKey =
    node && node.key && typeof node.key === 'object'
      ? (typeof node.key.raw === 'string' ? node.key.raw : (typeof node.key.local_name === 'string' ? node.key.local_name : null))
      : null;

  const baseLoc = { file: fileLabel, nodeId, nodeKey };

  const propsList = [];
  if (node.props && typeof node.props === 'object') propsList.push(['props', node.props]);
  if (node.unknownProps && typeof node.unknownProps === 'object') propsList.push(['unknownProps', node.unknownProps]);

  for (const [where, obj] of propsList) {
    for (const [k, val] of Object.entries(obj)) {
      // Texture refs: keys ending with "texture"
      if (typeof val === 'string' && isLikelyTexturePropKey({ key: k })) {
        const tex = String(val || '').trim();
        if (tex) addImpactLocation(outTextureMap, tex, { ...baseLoc, propKey: k, where }, maxPerRef);
      }

      // Global var refs: anywhere in the value tree
      walkForImpactVarRefs({
        v: val,
        onVar: (ref) => addImpactLocation(outVarMap, ref, { ...baseLoc, propKey: k, where }, maxPerRef),
      });
    }
  }

  // Bindings (scan known fields and unknown_fields)
  if (Array.isArray(node.bindings)) {
    for (let i = 0; i < node.bindings.length; i += 1) {
      const b = node.bindings[i];
      if (!b || typeof b !== 'object') continue;
      const bindLoc = { ...baseLoc, propKey: `bindings[${i}]`, where: 'bindings' };
      for (const val of Object.values(b)) {
        walkForImpactVarRefs({
          v: val,
          onVar: (ref) => addImpactLocation(outVarMap, ref, bindLoc, maxPerRef),
        });
      }
    }
  }

  // Recurse children
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      scanUiNodeForImpactRefs({ node: child, fileLabel, outVarMap, outTextureMap, maxPerRef });
    }
  }
}

/**
 * Build a simple references graph from currently open screen models.
 *
 * @param {any} state
 * @param {{ maxPerRef?: number }} opts
 */
function buildImpactReferenceGraphFromOpenScreens(state, opts = {}) {
  const maxPerRef = Number.isFinite(Number(opts.maxPerRef)) ? Math.max(1, Number(opts.maxPerRef)) : 50;

  const outVarMap = new Map();
  const outTextureMap = new Map();
  const openFiles = getOpenFilesList(state?.files);

  let scannedScreens = 0;
  for (const f of openFiles) {
    if (!f || f.kind !== 'screen' || !f.uiModel) continue;
    scannedScreens += 1;
    const fileLabel = typeof f.packPath === 'string' ? f.packPath : typeof f.path === 'string' ? f.path : String(f.id);
    try {
      scanUiNodeForImpactRefs({
        node: f.uiModel.root,
        fileLabel,
        outVarMap,
        outTextureMap,
        maxPerRef,
      });
    } catch (err) {
      diagnostics.captureError(err, { module: 'impactWarnings', where: 'buildImpactReferenceGraphFromOpenScreens', fileLabel });
    }
  }

  return { scannedScreens, globalVars: outVarMap, textures: outTextureMap };
}

/**
 * @param {{ graph: { globalVars: Map<string, ImpactLocation[]> }, name: string }} params
 */
function summarizeImpactLocationsForVar({ graph, name }) {
  const locs = graph && graph.globalVars ? graph.globalVars.get(name) : null;
  if (!locs || !locs.length) return { fileCount: 0, locationCount: 0, sampleLines: [] };

  const files = new Set();
  const lines = [];
  for (const loc of locs) {
    files.add(loc.file);
    const bits = [loc.file];
    if (loc.nodeKey) bits.push(String(loc.nodeKey));
    else if (loc.nodeId) bits.push(String(loc.nodeId));
    if (loc.propKey) bits.push(`[${loc.propKey}]`);
    lines.push(bits.join(' :: '));
  }

  return {
    fileCount: files.size,
    locationCount: locs.length,
    sampleLines: lines.slice(0, 12),
  };
}



/**
 * S055: Preflight confirm message builder for missing reference categories.
 *
 * @param {{ actionLabel: string, missing: any, maxEach?: number }} params
 */
function buildMissingReferencesPreflightMessage({ actionLabel, missing, maxEach = 6 }) {
  const m = missing || {};
  const textures = Array.isArray(m.textures) ? m.textures : [];
  const fonts = Array.isArray(m.fonts) ? m.fonts : [];
  const langKeys = Array.isArray(m.langKeys) ? m.langKeys : [];
  const globalVars = Array.isArray(m.globalVars) ? m.globalVars : [];

  const total = textures.length + fonts.length + langKeys.length + globalVars.length;

  const lines = [
    t('impactWarnings.preflight.title', { action: actionLabel }),
    '',
    t('impactWarnings.preflight.body'),
    '',
    `${t(m.scope === 'open-screens' ? 'references.openScreensScopeNote' : 'references.scopeNote')} (screens_scanned=${Number(m.scannedScreens || 0)})`,
  ];

  /** @param {string} title @param {Array<any>} arr */
  function pushCat(title, arr) {
    if (!arr.length) return;
    lines.push('');
    lines.push(`${title} (${arr.length})`);
    for (const item of arr.slice(0, maxEach)) {
      if (!item) continue;
      const refValue = getMissingReferenceDisplayValue(item);
      const count = Number(item.count || 0);
      lines.push(`- ${refValue}${count ? ` (x${count})` : ''}`);
    }
    if (arr.length > maxEach) lines.push(`- … (${arr.length - maxEach} more)`);
  }

  pushCat(t('references.missingTextures'), textures);
  pushCat(t('references.missingFonts'), fonts);
  pushCat(t('references.missingLangKeys'), langKeys);
  pushCat(t('references.missingGlobalVars'), globalVars);

  lines.push('');
  lines.push(t('impactWarnings.preflight.proceed', { action: actionLabel, count: total }));

  return lines.join('\n');
}

/** @param {any} missing */
function countTotalMissingReferences(missing) {
  const m = missing || {};
  const textures = Array.isArray(m.textures) ? m.textures.length : 0;
  const fonts = Array.isArray(m.fonts) ? m.fonts.length : 0;
  const langKeys = Array.isArray(m.langKeys) ? m.langKeys.length : 0;
  const globalVars = Array.isArray(m.globalVars) ? m.globalVars.length : 0;
  return textures + fonts + langKeys + globalVars;
}

/** @param {number} index */
function deleteGlobalVarEntry(index) {
  assertStudioExternalChange21('共通変数の削除');
  if (globalVarsEditorState.status !== 'ready') return;
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0 || i >= globalVarsEditorState.entries.length) return;

  const entry = globalVarsEditorState.entries[i];
  const nameRaw = String(entry?.name ?? '').trim();
  const varName = normalizeImpactVarRef(nameRaw);

  // High-impact edit warning (S055): deleting a referenced global variable.
  if (varName) {
    try {
      const graph = buildImpactReferenceGraphFromOpenScreens(store.getState(), { maxPerRef: 20 });
      const summary = summarizeImpactLocationsForVar({ graph, name: varName });

      if (summary.fileCount > 0) {
        const msgLines = [
          t('impactWarnings.deleteGlobalVar.title', { name: varName }),
          '',
          t('impactWarnings.deleteGlobalVar.usedBy', {
            count: summary.locationCount,
            fileCount: summary.fileCount,
          }),
        ];

        if (summary.sampleLines.length) {
          msgLines.push('');
          msgLines.push(t('impactWarnings.deleteGlobalVar.sampleLocations'));
          for (const line of summary.sampleLines) msgLines.push(`- ${line}`);
        }

        msgLines.push('');
        msgLines.push(t('impactWarnings.deleteGlobalVar.proceed'));

        const ok = window.confirm(msgLines.join('\n'));
        if (!ok) {
          setStatus({ text: t('impactWarnings.deleteGlobalVar.cancelled', { name: varName }), level: 'info' });
          return;
        }

        diagnostics.log('warn', 'Impact warning: delete global var', {
          source: 'impactWarnings',
          name: varName,
          fileCount: summary.fileCount,
        });
      }
    } catch (err) {
      diagnostics.captureError(err, { module: 'impactWarnings', where: 'deleteGlobalVarEntry', varName });
    }
  }

  globalVarsEditorState.entries = globalVarsEditorState.entries.filter((_, idx) => idx !== i);
  globalVarsEditorState.dirty = true;
  markResourcePackMutation();
  safeRender();
}


/**
 * @param {number} index
 * @param {Partial<GlobalVarEntry>} patch
 */
function patchGlobalVarEntry(index, patch) {
  assertStudioExternalChange21('共通変数の変更');
  if (globalVarsEditorState.status !== 'ready') return;
  globalVarsEditorState.entries = globalVarsEditorState.entries.map((e, i) => {
    if (i !== index) return e;
    return {
      name: patch.name ?? e.name,
      type: patch.type ?? e.type,
      valueText: patch.valueText ?? e.valueText,
    };
  });
  globalVarsEditorState.dirty = true;
  markResourcePackMutation();
  safeRender();
}


/** @param {number} bytes */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  const b = Math.max(0, Number(bytes));
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let u = 0;
  let v = b;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  const digits = u === 0 ? 0 : u === 1 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[u]}`;
}

/**
 * Convert internal error codes into a short, user-readable message.
 * @param {any} err
 */
function zipDemoErrorToMessage(err) {
  const code = err instanceof Error ? err.message : String(err || 'UNKNOWN');
  // Keep it simple for now; diagnostics UI comes later (S020).
  switch (code) {
    case 'ZIP_LIB_NOT_LOADED':
      return 'zip.js is not loaded (check network or script tag in app/index.html).';
    case 'ZIP_TOO_LARGE':
      return `ZIP is too large (limit: ${formatBytes(DEFAULT_ZIP_LIMITS.maxZipBytes)}).`;
    case 'ZIP_TOO_MANY_ENTRIES':
      return `ZIP has too many entries (limit: ${DEFAULT_ZIP_LIMITS.maxEntryCount}).`;
    case 'ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE':
      return `ZIP total uncompressed size exceeds limit (${formatBytes(DEFAULT_ZIP_LIMITS.maxTotalUncompressedBytes)}).`;
    case 'ZIP_ENCRYPTED_NOT_ALLOWED':
      return 'Encrypted ZIPs are not allowed by policy.';
    case 'ZIP_DUPLICATE_PATH_AFTER_NORMALIZATION':
      return 'ZIP contains duplicate paths after normalization.';
    case 'ZIP_LIST_ABORTED':
    case 'ZIP_READ_ABORTED':
      return 'ZIP operation was cancelled safely.';
    default:
      return `ZIP error: ${code}`;
  }
}

/** @param {File} file */
async function loadZipDemoFile(file, options = {}) {
  const generation = options.generation ?? ++zipDemoLoadGeneration;
  if (generation !== zipDemoLoadGeneration) return;
  zipDemoPreviewGeneration += 1;
  const candidate = new ZipReader();
  let adopted = false;
  const isCurrent = () => generation === zipDemoLoadGeneration;
  Object.assign(zipDemoState, { status: 'loading', error: null, meta: null, entries: [], warnings: [],
    truncated: false, selectedPath: null, previewText: null, previewError: null });
  setStatus('Loading ZIP (demo)…');
  render();
  try {
    await candidate.openFromFile(file);
    if (!isCurrent()) return;
    const result = await candidate.listEntries({ previewLimit: 200 });
    if (!isCurrent()) return;
    const previous = zipDemoReader;
    zipDemoReader = candidate;
    adopted = true;
    Object.assign(zipDemoState, { status: 'ready', meta: result.meta, entries: result.entries,
      warnings: result.warnings, truncated: result.truncated });
    setStatus(`ZIP loaded: ${result.meta.fileName} (${result.meta.entryCount} entries)`);
    await previous.close().catch(() => {});
  } catch (e) {
    if (!isCurrent()) return;
    zipDemoState.status = 'error';
    zipDemoState.error = zipDemoErrorToMessage(e);
    setStatus(zipDemoState.error);
  } finally {
    if (!adopted) await candidate.close().catch(() => {});
    if (isCurrent()) render();
  }
}

async function loadZipDemoFixture() {
  const generation = ++zipDemoLoadGeneration;
  zipDemoPreviewGeneration += 1;
  Object.assign(zipDemoState, { status: 'loading', error: null, selectedPath: null, previewText: null, previewError: null });
  render();
  const url = editorResourceUrl('../app/fixtures/s018-small-fixture.zip');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    const blob = await res.blob();
    if (generation !== zipDemoLoadGeneration) return;
    const file = new File([blob], 's018-small-fixture.zip', { type: 'application/zip' });
    await loadZipDemoFile(file, { generation });
  } catch (e) {
    if (generation !== zipDemoLoadGeneration) return;
    zipDemoState.status = 'error';
    zipDemoState.error = `Failed to load built-in fixture (${url}). ${zipDemoErrorToMessage(e)}`;
    setStatus(zipDemoState.error);
    render();
  }
}

/* --- S025: Resource Pack ZIP import ------------------------------------ */

/**
 * Convert import errors (pack + zip) into a user-readable message.
 * @param {any} err
 */
function packImportErrorToMessage(err) {
  // ZipReader errors typically come in the Error.message.
  const zipLikeCode = err instanceof Error ? err.message : String(err || 'UNKNOWN');
  if (zipLikeCode.startsWith('ZIP_')) return zipDemoErrorToMessage(err);

  // pack-importer errors are created via makePackError(...), with err.code.
  const code =
    err && typeof err === 'object' && 'code' in err ? String(err.code) : zipLikeCode;

  switch (code) {
    case 'PACK_ABORTED':
    case 'ZIP_LIST_ABORTED':
    case 'ZIP_READ_ABORTED':
      return 'Import was cancelled safely.';
    case 'PACK_IMPORT_MANIFEST_NOT_FOUND':
      return 'manifest.json was not found. Ensure the ZIP contains a valid Bedrock Resource Pack at the root (or inside one top-level folder).';
    case 'PACK_IMPORT_MANIFEST_READ_FAILED':
      return 'manifest.json exists, but could not be read (blocked by size limits or ZIP read failure).';
    case 'PACK_IMPORT_MANIFEST_PARSE_FAILED':
      return 'manifest.json exists, but could not be parsed as JSON.';
    case 'PACK_IMPORT_MANIFEST_INVALID':
      return 'manifest.json is present but invalid (missing required fields).';
    case 'PACK_IMPORT_NOT_RESOURCE_PACK':
      return 'This ZIP does not appear to be a Resource Pack (no "resources" module in manifest.json).';
    default:
      // If the error has a useful message, surface it.
      if (err && typeof err === 'object' && typeof err.message === 'string' && err.message) {
        return `Import error: ${err.message}`;
      }
      return `Import error: ${code}`;
  }
}

/**
 * Close and clear the current imported pack runtime (if any).
 */
async function unloadImportedPackRuntime() {
  assertStudioExternalChange21('リソースパックの解除');
  pendingAddonSelection38 = null;
  sourceWorkspace.reset();
  importedPackLoadGeneration += 1;
  try { importedPackLoadAbortController?.abort('PACK_UNLOADED'); } catch {}
  importedPackLoadAbortController = null;
  importedPackLoadProgress.phase = 'idle';
  importedPackLoadProgress.processed = 0;
  importedPackLoadProgress.total = null;
  if (!importedPackRuntime) return;
  const runtimeToClose = importedPackRuntime;
  importedPackRuntime = null;
  try {
    resetNativeTexturePreviewComposition();
    clearTextureSidecarCache();
    fontFaceCache.clear();
    resetLangTableRuntime();
    resetGlobalVarNamesRuntime();
    resetUiCatalogState();
  } catch {
    // ignore
  }
  resetUiDefsEditorState();
  resetGlobalVarsEditorState();
  resetScreenOpenState();
  try {
    await runtimeToClose.zipReader.close();
  } catch {
    // ignore
  }
}

/**
 * Close and clear the optional vanilla reference runtime (if any).
 */
async function unloadVanillaReferenceRuntime(options = {}) {
  assertStudioExternalChange21('バニラの解除');
  const suppliedGeneration = Number.isInteger(options.generationToken) ? options.generationToken : null;
  const generation = suppliedGeneration === null ? ++vanillaReferenceLoadGeneration : suppliedGeneration;
  if (generation !== vanillaReferenceLoadGeneration) return;
  sourceWorkspace.reset();
  try { vanillaReferenceLoadAbortController?.abort('VANILLA_REFERENCE_UNLOADED'); } catch {}
  vanillaReferenceLoadAbortController = null;

  const runtimeToClose = vanillaReferenceRuntime;
  vanillaReferenceRuntime = null;
  vanillaReferenceUiState.status = 'idle';
  vanillaReferenceUiState.error = null;
  vanillaReferenceUiState.audit = null;
  try {
    resetNativeTexturePreviewComposition();
    clearTextureSidecarCache();
    fontFaceCache.clear();
    resetLangTableRuntime();
    resetGlobalVarNamesRuntime();
  } catch {
    // ignore
  }
  if (runtimeToClose) {
    try {
      await runtimeToClose.zipReader.close();
    } catch {
      // ignore
    }
  }
  resetUiCatalogState();
  if (importedPackRuntime && options.rebuildCatalog !== false) {
    await requestUiCatalogBuild('vanilla-reference-unloaded');
    if (options.refreshPreview !== false) await refreshCurrentPreviewAfterCompositionChange();
  }
}


async function invalidateVanillaReferenceAfterMetadataChange(label) {
  assertStudioExternalChange21('バニラの対象バージョン変更');
  // Native-scene selection depends on the declared target even when no
  // Vanilla ZIP is attached. Never reuse a horse mesh resolved for the old
  // version/channel after those metadata fields change.
  clearNativeHorsePreviewCache();
  markPreviewContextMutation();
  scheduleReferenceContextRevalidation();
  if (!vanillaReferenceRuntime && !vanillaReferenceUiState.audit && vanillaReferenceUiState.status !== 'loading') return;
  // Metadata edits participate in the same generation protocol as ZIP loads.
  // Without this token, an older edit handler can finish closing runtime A
  // after a newer load B has committed and overwrite B's truthful UI state.
  const invalidationGeneration = ++vanillaReferenceLoadGeneration;
  await unloadVanillaReferenceRuntime({ generationToken: invalidationGeneration });
  if (invalidationGeneration !== vanillaReferenceLoadGeneration) return;
  vanillaReferenceUiState.status = 'warning';
  vanillaReferenceUiState.error = t('editor.packStack.error.metadataChanged', { label });
  setStatus(vanillaReferenceUiState.error);
  render();
}

/**
 * Load a user-provided Vanilla Resource Pack ZIP as the base reference.
 *
 * This is a best-effort fallback for environments where network access to the
 * GitHub raw mirror is slow/unavailable.
 *
 * @param {File} file
 */
async function loadVanillaReferenceFromFile(file) {
  assertStudioExternalChange21('バニラの読み込み');
  const f = file;
  if (!f) return;

  if (!vanillaReferenceRuntime && sourceWorkspace.state.workspaceId) sourceWorkspace.reset();
  const loadGeneration = ++vanillaReferenceLoadGeneration;
  const metadataSnapshot = Object.freeze({
    expectedBedrockVersion: vanillaReferenceUiState.expectedBedrockVersion,
    sourceRelease: vanillaReferenceUiState.sourceRelease,
    expectedChannel: vanillaReferenceUiState.expectedChannel,
    sourceChannel: vanillaReferenceUiState.sourceChannel,
  });
  const isCurrentLoad = () => loadGeneration === vanillaReferenceLoadGeneration
    && metadataSnapshot.expectedBedrockVersion === vanillaReferenceUiState.expectedBedrockVersion
    && metadataSnapshot.sourceRelease === vanillaReferenceUiState.sourceRelease
    && metadataSnapshot.expectedChannel === vanillaReferenceUiState.expectedChannel
    && metadataSnapshot.sourceChannel === vanillaReferenceUiState.sourceChannel;
  const closeImportResult = async (importResult) => {
    if (importResult?.ok && importResult.zipReader) await importResult.zipReader.close().catch(() => {});
  };

  // Detach an existing runtime under this request token before replacing it.
  // On the first Vanilla load there is nothing to close or rebuild, so only
  // clear stale attempt state and leave the imported-only preview untouched.
  if (vanillaReferenceRuntime) {
    await unloadVanillaReferenceRuntime({ generationToken: loadGeneration });
    if (!isCurrentLoad()) return;
  } else {
    try { vanillaReferenceLoadAbortController?.abort('VANILLA_REFERENCE_SUPERSEDED'); } catch {}
    vanillaReferenceLoadAbortController = null;
    vanillaReferenceUiState.status = 'idle';
    vanillaReferenceUiState.error = null;
    vanillaReferenceUiState.audit = null;
  }

  const abortController = new AbortController();
  vanillaReferenceLoadAbortController = abortController;

  vanillaReferenceUiState.status = 'loading';
  vanillaLoadProgress26.startedAt = Date.now(); vanillaLoadProgress26.progress = {};
  vanillaReferenceUiState.error = null;
  setStatus(`Loading vanilla reference: ${f.name}`);
  render();

  const result = await importResourcePackZip(f, {
    // Keep the UI summary small; listing all paths still happens.
    previewLimit: 50,
    // Defensive: keep manifest small.
    manifestMaxBytes: 1024 * 1024,
    // Vanilla ZIPs should not contain multiple manifest candidates, but keep it tight.
    maxManifestCandidates: 4,
    signal: abortController.signal,
    onProgress: (progress) => {
      if (!isCurrentLoad()) return;
      const processed = Number(progress?.processed) || 0;
      const phase = String(progress?.phase || 'index');
      vanillaLoadProgress26.progress = { ...progress, processed };
      setStatus(`Vanilla ZIP ${phase}… ${processed ? `${processed} entries` : f.name}`);
    },
  });

  if (!isCurrentLoad()) {
    await closeImportResult(result);
    return;
  }

  if (!result.ok) {
    const msg = t('editor.packStack.error.importFailed', { message: packImportErrorToMessage(result.error) });
    vanillaReferenceUiState.status = 'error';
    vanillaReferenceUiState.error = msg;
    diagnostics.captureError(result.error, {
      source: 'vanilla-reference',
      message: msg,
      data: { fileName: f?.name || null, zipBytes: f?.size || 0 },
    });
    setStatus(msg);
    render();
    if (vanillaReferenceLoadAbortController === abortController) vanillaReferenceLoadAbortController = null;
    return;
  }

  let parsedCounts;
  try {
    parsedCounts = await inspectVanillaReferenceCounts(result, { signal: abortController.signal });
  } catch (error) {
    if (!isCurrentLoad()) {
      await closeImportResult(result);
      return;
    }
    diagnostics.captureError(error, {
      source: 'vanilla-reference',
      message: 'Vanilla readiness index inspection failed',
    });
    // 通信・読取失敗を「パック内容の不足」として監査結果へ偽装しない。
    abortController.abort(error);
    await closeImportResult(result);
    if (!isCurrentLoad()) return;
    const msg = t('editor.packStack.error.importFailed', { message: packImportErrorToMessage(error) });
    vanillaReferenceUiState.status = 'error';
    vanillaReferenceUiState.error = msg;
    vanillaReferenceUiState.audit = null;
    if (vanillaReferenceLoadAbortController === abortController) vanillaReferenceLoadAbortController = null;
    setStatus(msg);
    render();
    return;
  }
  if (!isCurrentLoad()) {
    await closeImportResult(result);
    return;
  }
  const readinessAudit = auditVanillaReference({
    packPaths: result.packPaths,
    manifestValidation: result.manifestValidation,
    ...metadataSnapshot,
    ...parsedCounts,
  });
  vanillaReferenceUiState.audit = readinessAudit;
  diagnostics.log(
    readinessAudit.verifiedReferenceInputReady ? 'info' : 'warn',
    `Vanilla reference readiness: ${readinessAudit.readiness}`,
    {
      source: 'vanilla-reference',
      data: {
        readiness: readinessAudit.readiness,
        structuralReferenceReady: readinessAudit.structuralReferenceReady,
        declaredCompatibleReferenceReady: readinessAudit.declaredCompatibleReferenceReady,
        verifiedReferenceInputReady: readinessAudit.verifiedReferenceInputReady,
        highFidelityPreviewReady: readinessAudit.highFidelityPreviewReady,
        version: readinessAudit.version,
        categoryCounts: readinessAudit.categoryCounts,
        missingCriticalPaths: readinessAudit.missingCriticalPaths,
        parsedCounts: readinessAudit.parsedCounts,
        limitation: readinessAudit.limitation,
      },
    },
  );
  if (!readinessAudit.usableBaseReference) {
    await result.zipReader.close().catch(() => {});
    if (!isCurrentLoad()) return;
    vanillaReferenceUiState.status = readinessAudit.readiness === 'INVALID' ? 'error' : 'warning';
    vanillaReferenceUiState.error = t('editor.packStack.error.rejected', { readiness: readinessAudit.readiness });
    setStatus(vanillaReferenceUiState.error);
    render();
    return;
  }
const vanillaAssetIndexStartMs =
  typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
const vanillaPackPathCount = Array.isArray(result.packPaths) ? result.packPaths.length : 0;
const vanillaBuilderKind = typeof AssetIndexer.buildAssetIndexFromPackPathsAsync === 'function' ? 'async' : 'sync';
const vanillaYieldEveryMs = isLikelyMobileViewport() ? 8 : 12;

diagnostics.log('debug', 'Building asset index (vanilla reference)', {
  source: 'asset-index',
  data: {
    packPaths: vanillaPackPathCount,
    builder: vanillaBuilderKind,
    yieldEveryMs: vanillaYieldEveryMs,
  },
});

/** @type {import('./assets/asset-indexer.js').AssetIndex|null} */
let vanillaAssetIndex = null;

try {
  let lastStatusUpdateMs = 0;
  vanillaAssetIndex = await buildAssetIndexFromPackPathsAsync(result.packPaths, {
    yieldEveryMs: vanillaYieldEveryMs,
    signal: abortController.signal,
    onProgress: (info) => {
      try {
        if (!isCurrentLoad()) return;
        const now = Date.now();
        if (now - lastStatusUpdateMs < 150) return;
        lastStatusUpdateMs = now;

        const phase = info && info.phase === 'finalize'
          ? `finalize:${String(info.category || '')}`
          : 'scan';
        const processed = info && typeof info.processed === 'number' ? info.processed : 0;
        const total = info && typeof info.total === 'number' ? info.total : vanillaPackPathCount;

        setStatus(`Indexing assets (vanilla, ${vanillaBuilderKind} ${phase})… ${processed}/${total}`);
      } catch {
        // ignore progress UI errors
      }
    },
  });
} catch (e) {
  if (abortController.signal.aborted) {
    await closeImportResult(result);
    if (!isCurrentLoad()) return;
    vanillaReferenceUiState.status = 'warning';
    vanillaReferenceUiState.error = t('editor.packStack.cancelled');
    if (vanillaReferenceLoadAbortController === abortController) vanillaReferenceLoadAbortController = null;
    setStatus(vanillaReferenceUiState.error);
    render();
    return;
  }
  if (!isCurrentLoad()) {
    await closeImportResult(result);
    return;
  }
  const msg = 'Asset index build failed for vanilla reference.';
  diagnostics.captureError(e, {
    source: 'asset-index',
    message: msg,
    data: {
      packPaths: vanillaPackPathCount,
      builder: vanillaBuilderKind,
      yieldEveryMs: vanillaYieldEveryMs,
      samplePaths: Array.isArray(result.packPaths) ? result.packPaths.slice(0, 5) : [],
    },
  });

  // Last-resort retry using the sync builder.
  if (typeof buildAssetIndexFromPackPaths === 'function') {
    diagnostics.log('warn', 'Retrying asset index build using sync builder (vanilla reference)', {
      source: 'asset-index',
      data: { packPaths: vanillaPackPathCount },
    });
    vanillaAssetIndex = buildAssetIndexFromPackPaths(result.packPaths);
  } else {
    const userMsg = t('editor.packStack.error.indexFailed');
    await closeImportResult(result);
    if (!isCurrentLoad()) return;
    vanillaReferenceUiState.status = 'error';
    vanillaReferenceUiState.error = userMsg;
    setStatus(userMsg);
    render();
    return;
  }
}

if (!isCurrentLoad()) {
  await closeImportResult(result);
  return;
}

const vanillaAssetIndexDurationMs = Math.round(
  (typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()) - vanillaAssetIndexStartMs
);

diagnostics.log('info', 'Asset index built (vanilla reference)', {
  source: 'asset-index',
  data: {
    builder: vanillaBuilderKind,
    durationMs: vanillaAssetIndexDurationMs,
    texturesPaths: vanillaAssetIndex.textures.totalPaths,
    fontPaths: vanillaAssetIndex.font.totalPaths,
    textsPaths: vanillaAssetIndex.texts.totalPaths,
    texturesUnique: vanillaAssetIndex.textures.uniqueLowerKeys,
    fontUnique: vanillaAssetIndex.font.uniqueLowerKeys,
    textsUnique: vanillaAssetIndex.texts.uniqueLowerKeys,
  },
});

  if (!isCurrentLoad()) {
    await closeImportResult(result);
    return;
  }

  vanillaReferenceRuntime = {
    loadGeneration,
    metadataSnapshot,
    zipReader: result.zipReader,
    rootPrefix: result.rootPrefix,
    packPaths: result.packPaths,
    manifestZipPath: result.manifestZipPath,
    manifestSummary: result.manifestSummary,
    fileName: f.name,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    assetIndex: vanillaAssetIndex,
    assetIndexSummary: null,
    audit: readinessAudit,
  };
  vanillaReferenceRuntime.assetIndexSummary = summarizeAssetIndex(vanillaReferenceRuntime.assetIndex);

  // The logical sidecar overlay changes even on the first Vanilla load.
  // Invalidate both completed and in-flight lookups so an earlier imported-
  // only miss cannot hide the newly available base metadata.
  clearTextureSidecarCache();

  // Vanilla reference availability changes merged lookups.
  // Invalidate any imported-only build that may still be in flight so this
  // request always builds a catalog for the newly committed composition.
  resetUiCatalogState();
  resetLangTableRuntime();
  resetGlobalVarNamesRuntime();
  requestGlobalVarNamesLoad('vanillaReferenceLoaded');
  await requestUiCatalogBuild('vanilla-reference-loaded');
  if (!isCurrentLoad()) return;
  await refreshCurrentPreviewAfterCompositionChange();
  if (!isCurrentLoad()) return;

  vanillaReferenceUiState.status = readinessAudit.verifiedReferenceInputReady ? 'ready' : 'warning';
  vanillaReferenceUiState.error = readinessAudit.verifiedReferenceInputReady
    ? null
    : readinessAudit.declaredCompatibleReferenceReady
      ? t('editor.packStack.warning.receiptUnverified')
      : t('editor.packStack.warning.usable', { readiness: readinessAudit.readiness });
  setStatus(readinessAudit.verifiedReferenceInputReady
    ? `Verified Vanilla reference input loaded: ${f.name}`
    : `Vanilla reference loaded without verified input receipt (${readinessAudit.readiness}): ${f.name}`);
  if (vanillaReferenceLoadAbortController === abortController) vanillaReferenceLoadAbortController = null;
  render();
}

async function rebuildAssetIndexes() {
  const builderKind = typeof AssetIndexer.buildAssetIndexFromPackPathsAsync === 'function' ? 'async' : 'sync';
  const yieldEveryMs = isLikelyMobileViewport() ? 8 : 12;

  /**
   * @param {'imported pack'|'vanilla reference'} label
   * @param {{ packPaths?: string[], assetIndex?: any, assetIndexSummary?: any }|null} runtime
   * @param {(nextIndex: any) => void} assignIndex
   */
  async function rebuildOne(label, runtime, assignIndex) {
    if (!runtime) return;
    const isCurrentRuntime = () => label === 'imported pack'
      ? importedPackRuntime === runtime
      : vanillaReferenceRuntime === runtime;
    const packPaths = Array.isArray(runtime.packPaths) ? runtime.packPaths : [];
    const packPathsCount = packPaths.length;

    const startMs =
      typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    diagnostics.log('debug', `Rebuilding asset index (${label})`, {
      source: 'asset-index',
      data: { packPaths: packPathsCount, builder: builderKind, yieldEveryMs },
    });

    try {
      let lastStatusUpdateMs = 0;
      setStatus(`Rebuilding asset index (${label})…`);

      const nextIndex = runtime.zipReader?.nodePackId ? await nodeAssetIndex(runtime.zipReader) : await buildAssetIndexFromPackPathsAsync(packPaths, {
        yieldEveryMs,
        onProgress: (info) => {
          try {
            if (!isCurrentRuntime()) return;
            const now = Date.now();
            if (now - lastStatusUpdateMs < 150) return;
            lastStatusUpdateMs = now;

            const phase = info && info.phase === 'finalize'
              ? `finalize:${String(info.category || '')}`
              : 'scan';
            const processed = info && typeof info.processed === 'number' ? info.processed : 0;
            const total = info && typeof info.total === 'number' ? info.total : packPathsCount;

            setStatus(`Rebuilding asset index (${label}, ${builderKind} ${phase})… ${processed}/${total}`);
          } catch {
            // ignore progress UI errors
          }
        },
      });

      // The build yields repeatedly.  The captured runtime may therefore have
      // been unloaded/replaced while the index was being produced.  Never
      // attach an index derived from runtime A to a newer runtime B.
      if (!isCurrentRuntime()) return;
      assignIndex(nextIndex);

      const durationMs = Math.round(
        (typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()) - startMs
      );

      diagnostics.log('info', `Rebuilt asset index (${label})`, {
        source: 'asset-index',
        data: { durationMs, packPaths: packPathsCount, builder: builderKind },
      });

      setStatus(`Rebuilt asset index (${label})`);
    } catch (e) {
      if (!isCurrentRuntime()) return;
      const msg = `Rebuild asset index failed (${label}).`;
      diagnostics.captureError(e, {
        source: 'asset-index',
        message: msg,
        data: { packPaths: packPathsCount, builder: builderKind, yieldEveryMs, label },
      });
      setStatus(`${msg} See Logs.`);
    }
  }

  await rebuildOne('imported pack', importedPackRuntime, (nextIndex) => {
    importedPackRuntime.assetIndex = nextIndex;
    importedPackRuntime.assetIndexSummary = summarizeAssetIndex(importedPackRuntime.assetIndex);
  });

  await rebuildOne('vanilla reference', vanillaReferenceRuntime, (nextIndex) => {
    vanillaReferenceRuntime.assetIndex = nextIndex;
    vanillaReferenceRuntime.assetIndexSummary = summarizeAssetIndex(vanillaReferenceRuntime.assetIndex);
  });
}

function debugResolveTextureRef() {
  const importedIndex = importedPackRuntime && importedPackRuntime.assetIndex ? importedPackRuntime.assetIndex : null;
  const vanillaIndex = vanillaReferenceRuntime && vanillaReferenceRuntime.assetIndex ? vanillaReferenceRuntime.assetIndex : null;
  assetLookupState.lastTextureResult = resolveTextureRef(assetLookupState.textureRefInput, {
    importedIndex,
    vanillaIndex,
  });
}

/**
 * @param {File} file
 */
async function importPackFromFile(file, options = {}) {
  assertStudioExternalChange21('リソースパックの読み込み');
  pendingAddonSelection38 = null;
  store.dispatch(actions.packImportStart());
  setStatus(t('editor.import.status.importing', { fileName: file?.name || '...' }));
  render();

  // Replace any existing imported ZIP reader to avoid leaking resources.
  const unloadPromise = unloadImportedPackRuntime();
  const loadGeneration = importedPackLoadGeneration;
  const abortController = new AbortController();
  importedPackLoadAbortController = abortController;
  importedPackLoadProgress.phase = 'open';
  importedPackLoadProgress.startedAt26 = Date.now();
  importedPackLoadProgress.processed = 0;
  importedPackLoadProgress.total = null;
  const isCurrentLoad = () => loadGeneration === importedPackLoadGeneration
    && importedPackLoadAbortController === abortController;
  const releaseUncommittedLoad = async (importResult) => {
    if (importResult?.ok && importResult.zipReader) await importResult.zipReader.close().catch(() => {});
    // A newer request may take ownership while close() yields.
    if (!isCurrentLoad()) return;
    importedPackLoadAbortController = null;
    importedPackLoadProgress.phase = 'cancelled';
    const message = siteText('リソースパックの読み込みをキャンセルしました。');
    store.dispatch(actions.packImportError(message));
    setStatus(message);
    render();
  };
  await unloadPromise;
  if (!isCurrentLoad() || abortController.signal.aborted) {
    await releaseUncommittedLoad(null);
    return;
  }

  // Reset UI defs editor state for the new import.
  resetUiDefsEditorState();
  resetGlobalVarsEditorState();
  resetScreenOpenState();

  const result = await importResourcePackZip(file, {
    previewLimit: 200,
    ...(options.resourcePack ? { resourcePack: options.resourcePack } : {}),
    // Defensive: keep manifest small.
    manifestMaxBytes: 1024 * 1024,
    signal: abortController.signal,
    onProgress: (progress) => {
      if (!isCurrentLoad() || abortController.signal.aborted) return;
      importedPackLoadProgress.phase = String(progress?.phase || 'index');
      importedPackLoadProgress.processed = Number(progress?.processed) || 0;
      importedPackLoadProgress.total = Number.isFinite(progress?.total) ? Number(progress.total) : null;
      const total = importedPackLoadProgress.total === null ? '' : `/${importedPackLoadProgress.total}`;
      setStatus(`ZIP ${importedPackLoadProgress.phase}… ${importedPackLoadProgress.processed}${total} entries`);
    },
  });

  if (!isCurrentLoad() || abortController.signal.aborted) {
    await releaseUncommittedLoad(result);
    return;
  }

  if (!result.ok) {
    if (result.error?.code === 'ADDON_RESOURCE_SELECTION_REQUIRED' && Array.isArray(result.error.addonCandidates)) {
      const candidates = result.error.addonCandidates.filter(row => typeof row?.uuid === 'string' && typeof row?.path === 'string').slice(0, 32);
      if (candidates.length) pendingAddonSelection38 = { file, candidates };
    }
    const msg = packImportErrorToMessage(result.error);
    store.dispatch(actions.packImportError(msg));
    diagnostics.captureError(result.error, {
      source: 'pack-import',
      message: msg,
      data: { fileName: file?.name || null, zipBytes: file?.size || 0 },
    });
    setStatus(msg);
    importedPackLoadAbortController = null;
    render();
    return;
  }
const assetIndexStartMs =
  typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
const importedPackPathCount = Array.isArray(result.packPaths) ? result.packPaths.length : 0;
const importedBuilderKind = typeof AssetIndexer.buildAssetIndexFromPackPathsAsync === 'function' ? 'async' : 'sync';
const importedYieldEveryMs = isLikelyMobileViewport() ? 8 : 12;

diagnostics.log('debug', 'Building asset index (imported pack)', {
  source: 'asset-index',
  data: {
    packPaths: importedPackPathCount,
    builder: importedBuilderKind,
    yieldEveryMs: importedYieldEveryMs,
  },
});

/** @type {import('./assets/asset-indexer.js').AssetIndex|null} */
let importedAssetIndex = null;

try {
  let lastStatusUpdateMs = 0;
  importedAssetIndex = await buildAssetIndexFromPackPathsAsync(result.packPaths, {
    yieldEveryMs: importedYieldEveryMs,
    signal: abortController.signal,
    onProgress: (info) => {
      try {
        if (!isCurrentLoad() || abortController.signal.aborted) return;
        const now = Date.now();
        if (now - lastStatusUpdateMs < 150) return;
        lastStatusUpdateMs = now;

        const phase = info && info.phase === 'finalize'
          ? `finalize:${String(info.category || '')}`
          : 'scan';
        const processed = info && typeof info.processed === 'number' ? info.processed : 0;
        const total = info && typeof info.total === 'number' ? info.total : importedPackPathCount;

        setStatus(`Indexing assets (imported, ${importedBuilderKind} ${phase})… ${processed}/${total}`);
      } catch {
        // ignore progress UI errors
      }
    },
  });
} catch (e) {
  if (abortController.signal.aborted || !isCurrentLoad()) {
    await releaseUncommittedLoad(result);
    return;
  }
  const msg = 'Asset index build failed for imported pack.';
  diagnostics.captureError(e, {
    source: 'asset-index',
    message: msg,
    data: {
      packPaths: importedPackPathCount,
      builder: importedBuilderKind,
      yieldEveryMs: importedYieldEveryMs,
      samplePaths: Array.isArray(result.packPaths) ? result.packPaths.slice(0, 5) : [],
    },
  });

  // Last-resort retry using the sync builder.
  if (typeof buildAssetIndexFromPackPaths === 'function') {
    diagnostics.log('warn', 'Retrying asset index build using sync builder (imported pack)', {
      source: 'asset-index',
      data: { packPaths: importedPackPathCount },
    });
    importedAssetIndex = buildAssetIndexFromPackPaths(result.packPaths);
  } else {
    throw e;
  }
}

const assetIndexDurationMs = Math.round(
  (typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()) - assetIndexStartMs
);

if (!isCurrentLoad() || abortController.signal.aborted) {
  await releaseUncommittedLoad(result);
  return;
}

diagnostics.log('info', 'Asset index built (imported pack)', {
  source: 'asset-index',
  data: {
    builder: importedBuilderKind,
    durationMs: assetIndexDurationMs,
    texturesPaths: importedAssetIndex.textures.totalPaths,
    fontPaths: importedAssetIndex.font.totalPaths,
    textsPaths: importedAssetIndex.texts.totalPaths,
    texturesUnique: importedAssetIndex.textures.uniqueLowerKeys,
    fontUnique: importedAssetIndex.font.uniqueLowerKeys,
    textsUnique: importedAssetIndex.texts.uniqueLowerKeys,
  },
});

  const nextImportedPackRuntime = {
    zipReader: result.zipReader,
    rootPrefix: result.rootPrefix,
    packPaths: result.packPaths,
    manifestZipPath: result.manifestZipPath,
    manifestSummary: result.manifestSummary,
    overridesTextByPackPath: {},
    assetIndex: importedAssetIndex,
    assetIndexSummary: null,
    observedUiScale: DEFAULT_CLASSIC_UI_SCALE,
    uiScaleCalibrationSource: 'classic-default',
  };

  // Builder-generated packs can carry device-observed logical/physical pairs.
  // Use their median integer scale, while retaining a truthful 4x Classic
  // fallback for ordinary packs that omit build-info.json.
  try {
    const buildInfoPath = result.packPaths.find((path) => String(path || '').toLowerCase() === 'build-info.json');
    if (buildInfoPath) {
      const buildInfoText = await result.zipReader.readText(`${result.rootPrefix}${buildInfoPath}`, {
        maxBytes: 2 * 1024 * 1024,
        encoding: 'utf-8',
        signal: abortController.signal,
      });
      const buildInfoParsed = parseJsonc(buildInfoText, { filePath: buildInfoPath, allowTrailingComma: true });
      if (buildInfoParsed.ok) {
        nextImportedPackRuntime.observedUiScale = inferPackUiScaleFromBuildInfo(buildInfoParsed.value);
        nextImportedPackRuntime.uiScaleCalibrationSource = buildInfoPath;
      }
    }
  } catch (error) {
    if (!isCurrentLoad() || abortController.signal.aborted) {
      await releaseUncommittedLoad(result);
      return;
    }
    diagnostics.log('warn', 'UI scale calibration metadata could not be read; using Classic 4x.', {
      source: 'preview/canvas',
      data: { code: error instanceof Error ? error.message : String(error || 'UNKNOWN') },
    });
  }
  // Metadata IO may complete after cancel or after a newer pack was committed.
  // Keep the candidate local until every asynchronous preparation has finished.
  if (!isCurrentLoad() || abortController.signal.aborted) {
    await releaseUncommittedLoad(result);
    return;
  }
  importedPackRuntime = nextImportedPackRuntime;
  clearTextureSidecarCache();
  for (const canvasState of Object.values(canvasUiState.byFileKey)) {
    if (canvasState && canvasState.view) canvasState.view.initialized = false;
  }

  // Precompute a small JSON-safe summary for debug UI.
  importedPackRuntime.assetIndexSummary = summarizeAssetIndex(importedPackRuntime.assetIndex);
  // New pack may change available language files.
  resetLangTableRuntime();
  resetGlobalVarNamesRuntime();
  // Best-effort precompute merged global variable names for reference checks.
  requestGlobalVarNamesLoad('importedPackLoaded');
  requestUiCatalogBuild('imported-pack-loaded');

  const importedAtIso = new Date().toISOString();
  const packId = result.manifestSummary?.header?.uuid || `pack-${Date.now()}`;
  const projectName = getImportedPackDisplayName({
    manifestSummary: result.manifestSummary,
    fileName: file?.name || 'resource-pack.zip',
  });

  store.dispatch(
    actions.packImportSuccess({
      id: packId,
      fileName: file?.name || 'unknown.zip',
      zipBytes: file?.size || 0,
      importedAtIso,
      rootPrefix: result.rootPrefix,
      manifestZipPath: result.manifestZipPath,
      manifestSummary: result.manifestSummary,
      fileIndex: result.fileIndex,
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    })
  );

  store.dispatch(
    actions.setProject({
      id: String(packId),
      name: String(projectName),
      loadedAtIso: importedAtIso,
    })
  );

  setStatus(t('editor.import.status.importOk', { fileName: file?.name || '...' }));
  importedPackLoadAbortController = null;
  importedPackLoadProgress.phase = 'complete';
  render();
// S026: If the pack contains _ui_defs.json, load it automatically so the user
// immediately sees the screen registry list.
try {
  const uiDefsPath = result.fileIndex?.ui?.systemFiles?.uiDefs;
  if (uiDefsPath) {
    await loadUiDefsFromImportedPack({ createIfMissing: false });
  }
} catch (e) {
  diagnostics.captureError(e, {
    source: 'ui-defs',
    message: 'Auto-load ui/_ui_defs.json failed',
  });
}

}

async function importPackFixture() {
  const url = editorResourceUrl('../app/fixtures/s025-minimal-resource-pack.zip');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], 's025-minimal-resource-pack.zip', {
      type: 'application/zip',
    });
    await importPackFromFile(file);
  } catch (e) {
    const msg = `Failed to load built-in fixture (${url}). ${packImportErrorToMessage(e)}`;
    store.dispatch(actions.packImportError(msg));
    setStatus(msg);
    render();
  }
}

function cancelImportedPackLoad() {
  if (!importedPackLoadAbortController || importedPackLoadAbortController.signal.aborted) return;
  importedPackLoadProgress.phase = 'cancelling';
  importedPackLoadAbortController.abort('USER_CANCELLED_IMPORT');
  setStatus('Cancelling Resource Pack import…');
  render();
}

async function cancelVanillaReferenceLoad() {
  if (!vanillaReferenceLoadAbortController || vanillaReferenceLoadAbortController.signal.aborted) return;
  vanillaReferenceLoadAbortController.abort('USER_CANCELLED_VANILLA_REFERENCE');
  setStatus('Cancelling Vanilla reference import…');
  render();
  // Invalidate the load generation, abort any in-flight catalog build, close a
  // base that may already have reached the commit phase, and re-resolve the
  // active preview against the remaining imported pack only.
  const cancelGeneration = ++vanillaReferenceLoadGeneration;
  await unloadVanillaReferenceRuntime({ generationToken: cancelGeneration });
  if (cancelGeneration !== vanillaReferenceLoadGeneration) return;
  setStatus(t('editor.packStack.cancelled'));
  render();
}

/** @param {string} path */
async function previewZipDemoText(path) {
  if (zipDemoState.status !== 'ready') return;
  const generation = ++zipDemoPreviewGeneration;
  const loadGeneration = zipDemoLoadGeneration;
  const reader = zipDemoReader;
  const isCurrent = () => generation === zipDemoPreviewGeneration
    && loadGeneration === zipDemoLoadGeneration && reader === zipDemoReader
    && zipDemoState.selectedPath === path && zipDemoState.status === 'ready';
  zipDemoState.selectedPath = path;
  zipDemoState.previewText = null;
  zipDemoState.previewError = null;
  setStatus(`Reading ${path} (text)…`);
  render();

  try {
    const text = await reader.readText(path, {
      maxBytes: DEFAULT_ZIP_LIMITS.maxTextFileBytesForRead,
      encoding: 'utf-8',
    });
    if (!isCurrent()) return;
    const maxChars = 2000;
    zipDemoState.previewText = text.length > maxChars
      ? `${text.slice(0, maxChars)}\n…(truncated)…`
      : text;
    setStatus(`Read ${path}`);
  } catch (e) {
    if (!isCurrent()) return;
    zipDemoState.previewError = zipDemoErrorToMessage(e);
    setStatus(zipDemoState.previewError);
  }
  if (isCurrent()) render();
}

/* --- S019: JSONC demo state (About page) -------------------------------- */

const JSONC_DEMO_SAMPLE = `// JSONC sample (comments + trailing commas)
{
  // Standard JSON works too.
  "format_version": 1,

  "ui": {
    "type": "panel",
    "size": [ 100, 30, ],
  },
}
`;

/**
 * @type {{
 *  status: 'idle'|'parsed'|'error',
 *  statusMessage: string|null,
 *  inputText: string,
 *  sortKeys: boolean,
 *  outputText: string,
 *  roundTripOk: boolean,
 *  roundTripError: string|null,
 *  errors: import('./json/jsonc.js').JsoncParseError[],
 * }}
 */
const jsoncDemoState = {
  status: 'idle',
  statusMessage: null,
  inputText: JSONC_DEMO_SAMPLE,
  sortKeys: false,
  outputText: '',
  roundTripOk: false,
  roundTripError: null,
  errors: [],
};

/**
 * Convert internal error codes into a short, user-readable message.
 * @param {any} err
 */
function jsoncDemoErrorToMessage(err) {
  const code = err instanceof Error ? err.message : String(err || 'UNKNOWN');
  switch (code) {
    case 'JSONC_LIB_NOT_LOADED':
      return 'jsonc-parser is not loaded (check network or script tag in app/index.html).';
    default:
      return `JSONC error: ${code}`;
  }
}

function resetJsoncDemoSample() {
  jsoncDemoState.status = 'idle';
  jsoncDemoState.statusMessage = null;
  jsoncDemoState.inputText = JSONC_DEMO_SAMPLE;
  jsoncDemoState.outputText = '';
  jsoncDemoState.roundTripOk = false;
  jsoncDemoState.roundTripError = null;
  jsoncDemoState.errors = [];
  setStatus('JSONC demo reset');
  render();
}

function parseJsoncDemo() {
  jsoncDemoState.status = 'idle';
  jsoncDemoState.statusMessage = null;
  jsoncDemoState.outputText = '';
  jsoncDemoState.roundTripOk = false;
  jsoncDemoState.roundTripError = null;
  jsoncDemoState.errors = [];

  try {
    const result = parseJsonc(jsoncDemoState.inputText, {
      fileName: 'demo.jsonc',
      allowTrailingComma: true,
      allowEmptyContent: true,
    });

    if (!result.ok) {
      jsoncDemoState.status = 'error';
      jsoncDemoState.errors = result.errors;
      jsoncDemoState.statusMessage = 'JSONC parse error (see panel)';
      setStatus(jsoncDemoState.statusMessage);
      render();
      return;
    }

    const out = stableStringify(result.value, {
      indent: 2,
      sortKeys: jsoncDemoState.sortKeys,
      finalNewline: true,
    });
    jsoncDemoState.outputText = out;

    // Round-trip check (output must be valid strict JSON).
    try {
      JSON.parse(out);
      jsoncDemoState.roundTripOk = true;
      jsoncDemoState.roundTripError = null;
    } catch (e) {
      jsoncDemoState.roundTripOk = false;
      jsoncDemoState.roundTripError = e instanceof Error ? e.message : String(e || 'UNKNOWN');
    }

    jsoncDemoState.status = 'parsed';
    jsoncDemoState.statusMessage = jsoncDemoState.roundTripOk
      ? 'JSONC parsed OK (round-trip OK)'
      : 'JSONC parsed OK (round-trip FAILED)';
    setStatus(jsoncDemoState.statusMessage);
  } catch (e) {
    jsoncDemoState.status = 'error';
    jsoncDemoState.statusMessage = jsoncDemoErrorToMessage(e);
    jsoncDemoState.errors = [
      {
        code: 'EXCEPTION',
        message: jsoncDemoState.statusMessage,
        offset: 0,
        length: 0,
        line: 1,
        column: 1,
      },
    ];
    setStatus(jsoncDemoState.statusMessage);
  }

  render();
}

/* --- S053: JSON Schema export (About page) ------------------------------ */

/**
 * @type {{
 *  status: 'idle'|'building'|'done'|'error',
 *  statusMessage: string|null,
 *  lastFilename: string|null,
 *  lastAtIso: string|null,
 * }}
 */
const schemaExportState = {
  status: 'idle',
  statusMessage: null,
  lastFilename: null,
  lastAtIso: null,
};

/**
 * @param {any} err
 */
function schemaExportErrorToMessage(err) {
  const code = err instanceof Error ? err.message : String(err || 'UNKNOWN');
  switch (code) {
    case 'ZIP_LIB_NOT_LOADED':
      return 'zip.js is not loaded (check network or script tag in app/index.html).';
    default:
      return `Schema export error: ${code}`;
  }
}

function makeSafeTimestampForFilename() {
  // 2026-02-11T13:19:09.123Z -> 20260211_131909Z
  const iso = new Date().toISOString();
  return iso
    .replace(/\..*Z$/, 'Z')
    .replace(/[-:]/g, '')
    .replace('T', '_');
}

async function downloadSchemaBundleZip() {
  schemaExportState.status = 'building';
  schemaExportState.statusMessage = t('schemaExport.status.building');
  schemaExportState.lastFilename = null;
  schemaExportState.lastAtIso = null;
  setStatus(schemaExportState.statusMessage);
  render();

  try {
    const zipLib = globalThis.zip;
    if (!zipLib || !zipLib.ZipWriter || !zipLib.BlobWriter || !zipLib.TextReader) {
      throw new Error('ZIP_LIB_NOT_LOADED');
    }

    const files = generateSchemaFilesDraft07();
    const index = {
      generated_at_utc: new Date().toISOString(),
      files: files.map((f) => ({ path: `schemas/${f.path}`, kind: f.kind })),
    };

    const filename = `jsonui_schemas_${makeSafeTimestampForFilename()}.zip`;
    const writer = new zipLib.ZipWriter(new zipLib.BlobWriter('application/zip'));

    // Put everything under schemas/ for clarity.
    for (const f of files) {
      const text = stableStringify(f.json, { indent: 2, sortKeys: true, finalNewline: true });
      await writer.add(normalizeZipPath(`schemas/${f.path}`), new zipLib.TextReader(text));
    }
    await writer.add(
      normalizeZipPath('schemas/index.json'),
      new zipLib.TextReader(stableStringify(index, { indent: 2, sortKeys: true, finalNewline: true }))
    );
    await writer.add(
      normalizeZipPath('schemas/README.txt'),
      new zipLib.TextReader(
        [
          'JSONUI schema bundle (Draft-07).',
          'Generated by JSONUI Web Editor (S053).',
          'These schemas are an editor-aligned subset, not a full Bedrock spec.',
          '',
          'Files:',
          ...files.map((f) => `- ${f.path}`),
          '- index.json',
          '',
          'Tip: You can also find the generated files in the repo under PROJECT/app/schemas/.',
          '',
        ].join('\n')
      )
    );

    const blob = await writer.close();
    downloadBlobFile({ filename, blob });

    schemaExportState.status = 'done';
    schemaExportState.lastFilename = filename;
    schemaExportState.lastAtIso = new Date().toISOString();
    schemaExportState.statusMessage = t('schemaExport.status.done', { filename });
    setStatus(schemaExportState.statusMessage);
  } catch (e) {
    schemaExportState.status = 'error';
    schemaExportState.statusMessage = schemaExportErrorToMessage(e);
    setStatus(schemaExportState.statusMessage);
    diagnostics.captureError(e, {
      source: 'schema-export',
      message: schemaExportState.statusMessage,
    });
  }

  render();
}

/**
 * Download a single schema/metadata file as JSON.
 * @param {string} name
 */
function downloadSingleSchemaFile(name) {
  schemaExportState.status = 'idle';
  schemaExportState.statusMessage = null;

  try {
    const files = generateSchemaFilesDraft07();
    const match = files.find((f) => f.path === name);
    if (!match) {
      throw new Error(`UNKNOWN_SCHEMA_FILE:${name}`);
    }
    const text = stableStringify(match.json, { indent: 2, sortKeys: true, finalNewline: true });
    downloadTextFile({ filename: name, text });
    setStatus(`Downloaded ${name}`);
  } catch (e) {
    const msg = schemaExportErrorToMessage(e);
    setStatus(msg);
    diagnostics.captureError(e, {
      source: 'schema-export',
      message: msg,
    });
  }

  render();
}


/**
 * Update the status bar text.
 * Back-compat: accepts either a string or { text, level }.
 *
 * @param {string|{text:string, level?:'info'|'warn'|'error'}} message
 */
function setStatus(message) {
  if (!statusText) return;

  // Support the newer {text, level} shape without breaking old call sites.
  if (message && typeof message === 'object') {
    const text = String(message.text ?? '');
    const level = String(message.level ?? '');
    statusText.textContent = translateSiteMessage(text);

    // Optional styling hook for CSS (non-breaking if unused).
    try {
      statusText.dataset.level = level;
    } catch {
      // ignore
    }
    return;
  }

  statusText.textContent = translateSiteMessage(String(message));
}
/**
 * Very small helper to build elements without a framework.
 * @param {string} tag
 * @param {Record<string, any>} attrs
 * @param {Array<Node|string>} children
 */
function h(tag, attrs = {}, ...children) {
  // Back-compat:
  // - h(tag, attrs, [child1, child2])
  // - h(tag, attrs, child1, child2, ...)
  if (children.length === 1 && Array.isArray(children[0])) {
    children = children[0];
  }

  /** @type {Array<any>} */
  const flat = [];
  for (const c of children) {
    if (c === undefined || c === null) continue;
    if (Array.isArray(c)) {
      for (const cc of c) {
        if (cc === undefined || cc === null) continue;
        flat.push(cc);
      }
      continue;
    }
    flat.push(c);
  }

  const el = document.createElement(tag);
  // A select cannot adopt a value until its option children exist. Defer the
  // generic value property until after child insertion; this also preserves
  // the existing behavior for inputs and textareas.
  let deferredValue = null;
  let hasDeferredValue = false;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === "class" || k === "className") {
      el.className = String(v);
      continue;
    }
    // Boolean and value props should be set as properties, not attributes.
    // (HTML boolean attributes are truthy by presence, even when set to "false".)
    if (k === 'disabled') {
      el.disabled = Boolean(v);
      continue;
    }
    if (k === 'checked') {
      el.checked = Boolean(v);
      continue;
    }
    if (k === 'open') {
      el.open = Boolean(v);
      continue;
    }
    if (k === 'value') {
      deferredValue = String(v);
      hasDeferredValue = true;
      continue;
    }
    if (k === 'hidden') {
      el.hidden = Boolean(v);
      continue;
    }

    // Prevent string-based inline event handlers (e.g. onclick="...").
    // We only allow function listeners.
    if (k.startsWith('on')) {
      if (typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), event => {
          try {
            const result = v.call(el, event);
            if (result && typeof result.then === 'function') void Promise.resolve(result).catch(reportWorkspaceError);
          } catch (error) { reportWorkspaceError(error); }
        });
      }
      continue;
    }

    // Defense-in-depth: block dangerous URL attribute values such as `javascript:`.
    // (Most callers do not set href/src from untrusted data, but this prevents
    // accidental sink creation.)
    const lk = k.toLowerCase();
    if (lk === 'href' || lk === 'src' || lk === 'xlink:href' || lk === 'formaction') {
      const safe = sanitizeUrlForAttribute(v);
      if (!safe) continue;
      el.setAttribute(k, safe);
      continue;
    }

    el.setAttribute(k, String(v));
  }
  for (const c of flat) {
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  if (hasDeferredValue) el.value = deferredValue;
  return el;
}

/**
 * @param {{type: string, [k: string]: any}} action
 */
function summarizeAction(action) {
  if (!action || typeof action !== 'object') return '';
  switch (action.type) {
    case 'ui/setRoute':
      return `route=${String(action.route || '')}`;
    case 'ui/setEditorTab':
      return `${String(action.area || '')}=${String(action.tabId || '')}`;
    case 'ui/setPanelSizes':
      return `left=${action.leftPx}px right=${action.rightPx}px`;
    case 'files/openFile':
      return String(action.file?.path || action.file?.id || '');
    case 'files/closeFile':
      return String(action.fileId || '');
    case 'files/setCurrentFile':
      return String(action.fileId || '');
    case 'editor/selectNode':
      return String(action.nodeId || '');
    case 'editor/updateProperty':
      return `${String(action.nodeId || '')}.${String(action.key || '')}`;
    default:
      return '';
  }
}

function getRoute() {
  const hash = window.location.hash || "#/editor";
  if (!hash.startsWith("#/")) return "editor";

  const raw = hash.slice(2);
  const route = raw.split("?")[0].split("/")[0];
  if (route === 'diagnostics' || route === 'about') return 'logs';
  return route || "editor";
}

/**
 * Sync route into store so route changes can be observed like other state changes.
 */
function syncRouteToStore() {
  store.dispatch(actions.setRoute(getRoute()));
}

function setActiveNav(route) {
  const links = document.querySelectorAll(".topnav a[data-route]");
  for (const a of links) {
    a.classList.toggle("active", a.dataset.route === route);
  }
}

function render() {
  if (!routeRoot) {
    // If the DOM is missing expected IDs, fail softly.
    console.warn("route-root not found; cannot render app scaffold");
    return;
  }

  const state = store.getState();
  const route = state.ui.route || getRoute();

  // S049: edit_box overlay input lives outside routeRoot and must be explicitly hidden
  // when leaving the editor/canvas view.
  const centerTab = state.ui && state.ui.tabs && typeof state.ui.tabs.center === 'string' ? state.ui.tabs.center : null;
  if (route !== 'editor' || centerTab !== 'canvas') {
    void previewViewport.exit();
    previewPlayback.pause();
    hidePreviewEditBoxOverlay('render-route-change');
  }
  setActiveNav(route);
  routeRoot.replaceChildren();

  if (route === "editor") {
    routeRoot.append(renderEditor(state));
    setStatus(buildStatusLine(state));
    return;
  }

  if (route === 'help') {
    routeRoot.append(renderHelp());
    setStatus('Route: help');
    return;
  }

  if (route === 'logs') {
    routeRoot.append(renderLogs());
    const c = diagnostics.getCounts();
    setStatus(t('logs.status', { error: c.error, warn: c.warn, info: c.info, debug: c.debug }));
    return;
  }

  routeRoot.append(renderNotFound(route));
  setStatus(`Route: ${route} (not found)`);
}

function renderPanel(title, bodyNodes, options = {}) {
  const headerActions = Array.isArray(options.headerActions) ? options.headerActions : [];
  const panelClass = `panel${options.className ? ` ${options.className}` : ''}`;
  const bodyClass = `panel-body${options.bodyClassName ? ` ${options.bodyClassName}` : ''}`;
  const bodyAttrs = options.bodyAttrs && typeof options.bodyAttrs === 'object'
    ? options.bodyAttrs
    : {};

  return h("section", { class: panelClass }, [
    h("div", { class: "panel-header" }, [
      h("span", { class: "panel-title" }, [title]),
      headerActions.length
        ? h('div', { class: 'panel-header-actions' }, headerActions)
        : '',
    ]),
    h("div", { ...bodyAttrs, class: bodyClass }, bodyNodes),
  ]);
}

function renderZipDemoPanel() {
  const isLoading = zipDemoState.status === 'loading';

  const limitHint = `Limits: max ZIP=${formatBytes(DEFAULT_ZIP_LIMITS.maxZipBytes)}, max entries=${DEFAULT_ZIP_LIMITS.maxEntryCount}, max total uncompressed=${formatBytes(DEFAULT_ZIP_LIMITS.maxTotalUncompressedBytes)}, max text read=${formatBytes(DEFAULT_ZIP_LIMITS.maxTextFileBytesForRead)}`;

  const body = [];

  body.push(
    h('p', {}, [
      'Minimal ZIP integration demo (S018). Open a .zip file and list its entries using the ZipReader wrapper with safety limits.',
    ]),
    h('p', { class: 'hint' }, [limitHint]),
    h('div', { style: 'display: flex; flex-direction: column; gap: 8px; margin: 8px 0;' }, [
      h('input', {
        type: 'file',
        accept: '.zip,application/zip',
        disabled: isLoading,
        onChange: (e) => {
          const file = e?.target?.files && e.target.files[0];
          if (file) loadZipDemoFile(file);
        },
      }, []),
      h('div', { style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap;' }, [
        h('button', {
          type: 'button',
          class: 'btn',
          disabled: isLoading,
          onClick: () => loadZipDemoFixture(),
        }, ['Load built-in fixture']),
        h('span', { class: 'hint' }, ['(app/fixtures/s018-small-fixture.zip)']),
      ]),
    ])
  );

  if (zipDemoState.status === 'loading') {
    body.push(h('p', { class: 'hint' }, ['Loading…']));
  }

  if (zipDemoState.error) {
    body.push(h('p', { class: 'hint' }, [`Error: ${zipDemoState.error}`]));
  }

  if (zipDemoState.meta) {
    const m = zipDemoState.meta;
    body.push(
      h('p', { class: 'hint', style: 'margin-top: 10px;' }, ['ZIP meta']),
      h('ul', { style: 'list-style: none; padding-left: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;' }, [
        h('li', {}, [h('span', { class: 'hint' }, ['File: ']), h('span', { class: 'code' }, [m.fileName])]),
        h('li', {}, [h('span', { class: 'hint' }, ['ZIP bytes: ']), h('span', { class: 'code' }, [formatBytes(m.zipBytes)])]),
        h('li', {}, [h('span', { class: 'hint' }, ['Entries: ']), h('span', { class: 'code' }, [String(m.entryCount)])]),
        h('li', {}, [h('span', { class: 'hint' }, ['Files/dirs: ']), h('span', { class: 'code' }, [`${m.fileCount}/${m.dirCount}`])]),
        h('li', {}, [h('span', { class: 'hint' }, ['Total uncompressed: ']), h('span', { class: 'code' }, [formatBytes(m.totalUncompressedBytes)])]),
        h('li', {}, [h('span', { class: 'hint' }, ['Blocked reads: ']), h('span', { class: 'code' }, [String(m.blockedReadCount)])]),
      ]),
    );
  }

  if (zipDemoState.warnings && zipDemoState.warnings.length > 0) {
    const first = zipDemoState.warnings.slice(0, 3);
    body.push(
      h('p', { class: 'hint', style: 'margin-top: 10px;' }, [
        `${zipDemoState.warnings.length} warning(s) (showing up to 3):`,
      ]),
      h('ul', {}, first.map((w) => h('li', {}, [h('span', { class: 'hint' }, [`${w.code}: ${w.message}`])]))),
    );
  }

  if (zipDemoState.entries && zipDemoState.entries.length > 0) {
    const total = zipDemoState.meta ? zipDemoState.meta.entryCount : zipDemoState.entries.length;
    const shown = zipDemoState.entries.length;
    body.push(
      h('p', { class: 'hint', style: 'margin-top: 10px;' }, [
        `Entries preview: showing ${shown}${zipDemoState.truncated ? ` of ${total}` : ''}. Click "Text" to read small files.`,
      ]),
      h('ul', { style: 'list-style: none; padding-left: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;' },
        zipDemoState.entries.map((entry) => {
          const displayPath = entry.directory ? `${entry.path}/` : entry.path;
          const sizeText = entry.directory ? '' : formatBytes(entry.uncompressedSize);
          const blocked = entry.blockedReason ? `blocked:${entry.blockedReason}` : '';

          return h('li', {}, [
            h('div', { style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap;' }, [
              h('button', {
                type: 'button',
                class: 'btn',
                disabled: isLoading || entry.directory || Boolean(entry.blockedReason),
                title: entry.directory ? 'Directories cannot be read as text.' : (entry.blockedReason ? `Read blocked: ${entry.blockedReason}` : 'Read as text'),
                onClick: () => previewZipDemoText(entry.path),
              }, ['Text']),
              h('span', { class: 'code' }, [displayPath]),
              sizeText ? h('span', { class: 'hint' }, [sizeText]) : null,
              blocked ? h('span', { class: 'hint' }, [blocked]) : null,
            ].filter(Boolean)),
          ]);
        })
      ),
    );
  }

  if (zipDemoState.selectedPath) {
    body.push(
      h('p', { class: 'hint', style: 'margin-top: 10px;' }, [
        `Text preview: ${zipDemoState.selectedPath}`,
      ]),
    );
    if (zipDemoState.previewError) {
      body.push(h('p', { class: 'hint' }, [`Preview error: ${zipDemoState.previewError}`]));
    }
    if (zipDemoState.previewText) {
      body.push(
        h('pre', {
          class: 'code',
          style: 'white-space: pre-wrap; border: 1px solid var(--border); border-radius: 6px; padding: 8px; background: rgba(127, 127, 127, 0.06);',
        }, [zipDemoState.previewText])
      );
    }
  }

  return renderPanel('ZIP demo (S018)', body);
}

function renderJsoncDemoPanel() {
  const body = [];
  body.push(
    h('p', {}, [
      'JSONC parsing demo (S019). This accepts comments and trailing commas in the input, and outputs strict JSON using a deterministic formatter.',
    ]),
    h('p', { class: 'hint' }, [
      'The output is plain JSON (no comments). Enable "Sort keys" for fully deterministic key order.',
    ])
  );

  body.push(
    h('div', { style: 'display:flex; gap: 8px; align-items:center; flex-wrap: wrap; margin-top: 8px;' }, [
      h('button', { type: 'button', class: 'btn', onClick: () => parseJsoncDemo() }, ['Parse JSONC']),
      h('button', { type: 'button', class: 'btn', onClick: () => resetJsoncDemoSample() }, ['Reset sample']),
      h('label', { class: 'hint', style: 'display:flex; gap: 6px; align-items:center;' }, [
        h('input', {
          type: 'checkbox',
          checked: jsoncDemoState.sortKeys,
          onChange: (e) => {
            jsoncDemoState.sortKeys = Boolean(e?.target?.checked);
            // Do not re-parse automatically; just re-render to reflect the toggle.
            render();
          },
        }, []),
        'Sort keys',
      ]),
    ]),
  );

  body.push(
    h('p', { class: 'hint', style: 'margin-top: 8px;' }, ['Input (JSONC):']),
    h('textarea', {
      class: 'code',
      style: 'width: 100%; height: 170px; white-space: pre; resize: vertical;',
      onInput: (e) => {
        jsoncDemoState.inputText = String(e?.target?.value || '');
      },
    }, [jsoncDemoState.inputText]),
  );

  if (jsoncDemoState.status === 'error' && jsoncDemoState.errors.length > 0) {
    body.push(
      h('p', { class: 'hint', style: 'margin-top: 10px;' }, [`${jsoncDemoState.errors.length} error(s):`]),
      h('ul', {}, jsoncDemoState.errors.slice(0, 10).map((er) => (
        h('li', {}, [h('span', { class: 'code' }, [er.message])])
      ))),
      jsoncDemoState.errors.length > 10
        ? h('p', { class: 'hint' }, ['(Only the first 10 errors are shown.)'])
        : null,
    );
  }

  if (jsoncDemoState.status === 'parsed') {
    body.push(
      h('p', { class: 'hint', style: 'margin-top: 10px;' }, [
        `Round-trip: ${jsoncDemoState.roundTripOk ? 'OK' : 'FAILED'}`,
      ]),
    );
    if (!jsoncDemoState.roundTripOk && jsoncDemoState.roundTripError) {
      body.push(h('p', { class: 'hint' }, [`Round-trip error: ${jsoncDemoState.roundTripError}`]));
    }

    body.push(
      h('p', { class: 'hint', style: 'margin-top: 8px;' }, ['Output (strict JSON):']),
      h('pre', {
        class: 'code',
        style: 'white-space: pre-wrap; border: 1px solid var(--border); border-radius: 6px; padding: 8px; background: rgba(127, 127, 127, 0.06); max-height: 260px; overflow: auto;',
      }, [jsoncDemoState.outputText || '']),
    );
  }

  return renderPanel('JSONC demo (S019)', body);
}

/**
 * @param {{
 *  prefix: string,
 *  title: string,
 *  tabs: { id: string, label: string }[],
 *  activeTabId: string,
 *  onSelect: (tabId: string) => void,
 *  renderBody: (tabId: string) => Node,
 * }} params
 */
function renderTabbedPanel({ prefix, title, tabs, activeTabId, onSelect, renderBody }) {
  const active = tabs.find((t) => t.id === activeTabId) ? activeTabId : tabs[0].id;
  const tabList = tabs.length > 1 ? h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': `${title} tabs` },
    tabs.map((t, idx) => {
      const isActive = t.id === active;
      const tabId = `${prefix}-tab-${t.id}`;
      const panelId = `${prefix}-tabpanel-${t.id}`;

      return h(
        'button',
        {
          type: 'button',
          class: `tab-btn${isActive ? ' active' : ''}`,
          title: t.label,
          role: 'tab',
          id: tabId,
          'aria-selected': isActive ? 'true' : 'false',
          'aria-controls': panelId,
          tabindex: isActive ? '0' : '-1',
          onClick: () => onSelect(t.id),
          onKeyDown: (e) => {
            if (e.isComposing) return;
            const key = e.key;
            const count = tabs.length;
            if (count <= 1) return;

            let nextIdx = idx;
            if (key === 'ArrowLeft') nextIdx = (idx - 1 + count) % count;
            else if (key === 'ArrowRight') nextIdx = (idx + 1) % count;
            else if (key === 'Home') nextIdx = 0;
            else if (key === 'End') nextIdx = count - 1;
            else return;

            e.preventDefault();
            const next = tabs[nextIdx];
            onSelect(next.id);

            // Focus the newly selected tab after re-render.
            requestAnimationFrame(() => {
              const el = document.getElementById(`${prefix}-tab-${next.id}`);
              if (el) el.focus();
            });
          },
        },
        [t.label]
      );
    })
  ) : '';

  return h('section', { class: 'panel' }, [
    h('div', { class: `panel-header${tabs.length > 1 ? ' has-tabs' : ''}` }, [
      tabs.length > 1 ? '' : h('span', { class: 'panel-title' }, [title]),
      tabList,
    ]),
    h('div', { class: 'panel-body' }, [
      ...tabs.map((t) => {
        const isActive = t.id === active;
        const panelId = `${prefix}-tabpanel-${t.id}`;
        return h(
          'div',
          {
            class: 'tab-panel',
            role: 'tabpanel',
            id: panelId,
            'aria-labelledby': `${prefix}-tab-${t.id}`,
            hidden: isActive ? null : 'hidden',
          },
          [isActive ? renderBody(t.id) : '']
        );
      }),
    ]),
  ]);
}

/**
 * @param {import('./state-store/app-store.js').AppState} state
 */
const runtimeStateEditor = { preset: '', text: '{\n  "mockData": {},\n  "collectionData": {}\n}', message: '' };
const statePresetRows = [
  { id: 'empty', label: '指定なし' }, { id: 'furnace', label: 'かまど（稼働中）' },
  { id: 'brewing', label: '醸造台（醸造中）' }, { id: 'trade', label: '交易の一覧' },
  { id: 'action_form', label: 'ActionFormの項目' }, { id: 'modal_form', label: 'ModalFormの入力欄' },
  { id: 'inventory', label: 'インベントリの内容' },
  { id: 'anvil', label: '金床の名前・スロット' }, { id: 'enchanting', label: 'エンチャント候補' },
  { id: 'horse', label: '動物の装備・収納' }, { id: 'book', label: '本のタイトル・本文' },
];
let debugBundleBusy = false;
async function downloadCompleteDebugBundle() {
  if (debugBundleBusy) return;
  debugBundleBusy = true;
  let payload;
  try {
    setStatus(siteText('ブラウザとNodeのログをまとめています…'));
    const context = buildCurrentPreviewDiagnosticContext();
    payload = createPreviewDebugRequest23({
      browser: { userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language },
      selection: { filePath: context.selectedUi.filePath, definitionKey: context.selectedUi.definitionId, screenId: context.selectedUi.fileId },
      state: { transport: getNodeRequestLog35(), context, previewState: store.getState().preview?.mockData || {}, input: (() => { try { return JSON.parse(runtimeStateEditor.text); } catch { return { parseStatus: 'invalid', characters: runtimeStateEditor.text.length }; } })() },
      diagnostics: diagnostics.getEntries().slice(-500), events: actionLog,
    });
    const blob = await downloadNodeDebugBundle(payload);
    downloadBlobFile({ filename: `jsonui_debug_bundle_${makeSafeFileTimestamp()}.json`, blob });
    setStatus(siteText('ブラウザ・Node・起動ログをまとめたファイルを保存しました。'));
  } catch (error) {
    diagnostics.captureError(error, { source: 'debug-bundle', message: siteText('Nodeログの取得に失敗しました。ブラウザの記録を保存します。') });
    const fallback = payload || createPreviewDebugRequest23({ state: { captureFailed: true, transport: getNodeRequestLog35() }, diagnostics: diagnostics.getEntries().slice(-500), events: actionLog });
    // 各枠は既に安全化済み。全体を旧単一枠へ再投影すると直近履歴が欠落する。
    const failure = sanitizePreviewDebugPayload({ nodeLogsUnavailable: String(error?.message || error) });
    downloadTextFile({ filename: `jsonui_debug_browser_only_${makeSafeFileTimestamp()}.json`, text: JSON.stringify({ ...fallback, ...failure }) });
    setStatus(siteText('Nodeログを取得できなかったため、ブラウザの記録のみ保存しました。'));
  } finally { debugBundleBusy = false; }
}

const runtimeInputEditorStates = new Map();
const emptyRuntimeInputEditorState = {};
function renderRuntimeStatePanel() {
  const appState = store.getState();
  const file = appState.files.byId[appState.files.currentFileId];
  const model = file?.uiModel;
  const draftKey = model ? [file.meta?.importedPackId || appState.pack?.imported?.id || file.id, file.meta?.source || '', file.path, getSelectedPreviewQualifiedName(file)].join('|') : '';
  let inputState = model ? runtimeInputEditorStates.get(draftKey) : emptyRuntimeInputEditorState;
  if (!inputState) { inputState = {}; runtimeInputEditorStates.set(draftKey, inputState); }
  // 以前のパックの未適用入力を新しいパックへ持ち越さない。
  const activePackId = appState.pack?.imported?.id;
  if (activePackId) for (const key of runtimeInputEditorStates.keys()) if (key !== draftKey && !key.startsWith(String(activePackId) + '|')) runtimeInputEditorStates.delete(key);
  const jsonControls = renderPreviewStateControls(studioRuntimeControlsH21, {
    beforeChange: () => assertStudioExternalChange21('プレビュー状態 JSON の変更'),
    onError: reportWorkspaceError,
    state: runtimeStateEditor, presets: statePresetRows.map(row => ({ ...row, label: siteText(row.label) })), 
    disabled: store.getState().pack?.status === 'loading' || screenOpenState.status === 'loading',
    onPreset: (kind) => {
      if (!statePresetRows.some((row) => row.id === kind)) return;
      assertStudioExternalChange21('プレビュー状態の例の入力');
      runtimeStateEditor.preset = kind;
      runtimeStateEditor.dirty = true;
      runtimeStateEditor.text = JSON.stringify(createPreviewStatePreset(kind), null, 2);
      const input = document.getElementById('preview-state-json');
      if (input) input.value = runtimeStateEditor.text;
      runtimeStateEditor.message = siteText('例を入力しました。「状態を適用」で反映します。');
      const message = document.getElementById('preview-state-message');
      if (message) message.textContent = runtimeStateEditor.message;
    },
    onDownload: () => downloadTextFile({ filename: `jsonui_preview_state_${makeSafeFileTimestamp()}.json`, text: runtimeStateEditor.text }),
    onCurrent: () => { const values = store.getState().preview?.mockData || {}; const { __collections = {}, ...mockData } = values; runtimeStateEditor.text = JSON.stringify({ mockData, collectionData: __collections, font_profile: store.getState().ui?.previewFontProfile || 'bitmap' }, null, 2); runtimeStateEditor.dirty = false; runtimeStateEditor.message = siteText('現在適用中の値を入力欄へ取り込みました。'); safeRender(); },
    onApply: (text) => {
      try {
        assertStudioExternalChange21('プレビュー状態の適用');
        const latest = store.getState();
        if (latest.pack?.status === 'loading' || screenOpenState.status === 'loading') throw new Error(siteText('読み込み中です。完了後に適用してください。'));
        if (latest.files.byId[latest.files.currentFileId]?.uiModel !== model) throw new Error(siteText('UIが切り替わりました。現在のUIの状態を確認してください。'));
        if (String(text).length > 262144) throw new Error(siteText('状態JSONは256Ki文字以下にしてください。'));
        const result = normalizePreviewState(JSON.parse(text));
        previewPlayback.pause();
        const notices = result.diagnostics || [];
        for (const item of notices.slice(0, 30)) diagnostics.log(item.severity === 'info' ? 'info' : 'warn', item.message || siteText('状態データに未対応の指定があります。'), { source: 'preview-state', data: item });
        runtimeStateEditor.dirty = false;
        runtimeStateEditor.message = siteText`状態を適用しました。${notices.length ? siteText`注意 ${notices.length} 件。` : ''}${result.recommendedDefinition ? siteText`推奨UI定義: ${result.recommendedDefinition}` : ''}`;
        if (result.fontProfile !== undefined) store.dispatch(actions.setPreviewFontProfile(result.fontProfile));
        store.dispatch(actions.setMockData({ ...result.mockData, __collections: result.collectionData }));
      } catch (error) {
        runtimeStateEditor.message = siteText`適用できません: ${error.message || error}`;
        reportWorkspaceError(error);
        const message = document.getElementById('preview-state-message');
        if (message) message.textContent = runtimeStateEditor.message;
      }
    },
  });
  const directInputs = renderRuntimeInputEditor(studioRuntimeControlsH21, {
    model, current: appState.preview?.mockData || {}, getCurrent: () => store.getState().preview?.mockData || {}, state: inputState,
    disabled: appState.pack?.status === 'loading' || screenOpenState.status === 'loading',
    onOpenJson: () => { const input = document.getElementById('preview-state-json'); input?.focus(); input?.scrollIntoView({ block: 'nearest' }); },
    onApply: drafts => {
      assertStudioExternalChange21('プレビュー入力値の適用');
      const latest = store.getState();
      if (latest.pack?.status === 'loading' || screenOpenState.status === 'loading') throw new Error(siteText('読み込み中です。完了後に入力してください。'));
      if (latest.files.byId[latest.files.currentFileId]?.uiModel !== model) throw new Error(siteText('UIが切り替わりました。現在のUIで入力を開き直してください。'));
      if (runtimeStateEditor.dirty) throw new Error(siteText('状態JSONに未適用の変更があります。先に「状態を適用」するか「適用中の値を取得」で戻してください。'));
      const normalized = normalizePreviewState(applyRuntimeInputDraft(store.getState().preview?.mockData || {}, drafts));
      const text = JSON.stringify({ mockData: normalized.mockData, collectionData: normalized.collectionData }, null, 2);
      if (text.length > 262144) throw new Error(siteText('状態JSONは256Ki文字以下にしてください。'));
      previewPlayback.pause();
      runtimeStateEditor.text = text; runtimeStateEditor.dirty = false;
      runtimeStateEditor.message = siteText('一覧で指定した入力値を適用しました。');
      const input = document.getElementById('preview-state-json'); if (input) input.value = text;
      const message = document.getElementById('preview-state-message'); if (message) message.textContent = runtimeStateEditor.message;
      store.dispatch(actions.setMockData({ ...normalized.mockData, __collections: normalized.collectionData }));
      return store.getState().preview?.mockData || {};
    },
  });
  const itemCatalog = [
    ...listItemTextureAtlasEntries(getItemTextureAtlas('imported', importedPackRuntime), { limit: 4096 }),
    ...listItemTextureAtlasEntries(getItemTextureAtlas('vanilla', vanillaReferenceRuntime), { limit: 4096 }),
  ];
  const uiInputs = renderUiDataEditor(studioRuntimeControlsH21, {
    model, state: inputState.uiData ||= {}, current: appState.preview?.mockData || {},
    getCurrent: () => store.getState().preview?.mockData || {}, itemCatalog,
    disabled: !model || appState.pack?.status === 'loading' || screenOpenState.status === 'loading',
    onOpenJson: () => document.getElementById('preview-state-json')?.focus(),
    onApply: operations => {
      assertStudioExternalChange21('一覧・スロット・文字の適用');
      if (store.getState().pack?.status === 'loading' || screenOpenState.status === 'loading') throw new Error(siteText('読み込み中です。完了後に入力してください。'));
      if (runtimeStateEditor.dirty) throw new Error(siteText('状態JSONに未適用の変更があります。先に適用するか、適用中の値を取得してください。'));
      if (store.getState().files.byId[store.getState().files.currentFileId]?.uiModel !== model) throw new Error(siteText('UIが切り替わりました。現在のUIでデータ入力を開き直してください。'));
      const normalized = normalizePreviewState(applyUiDataDraft(store.getState().preview?.mockData || {}, operations, { catalog: buildUiDataCatalog(model) }));
      const text = JSON.stringify({ mockData: normalized.mockData, collectionData: normalized.collectionData }, null, 2);
      if (text.length > 262144) throw new Error(siteText('状態JSONは256Ki文字以下にしてください。'));
      previewPlayback.pause();
      runtimeStateEditor.text = text; runtimeStateEditor.dirty = false;
      runtimeStateEditor.message = siteText('このUIのデータを適用しました。');
      const input = document.getElementById('preview-state-json'); if (input) input.value = text;
      store.dispatch(actions.setMockData({ ...normalized.mockData, __collections: normalized.collectionData }));
      return store.getState().preview?.mockData || {};
    },
  });
  const blocked = studioRuntimeChangesBlocked21();
  const current = appState.preview?.mockData || {};
  const { __collections = {}, ...mockData } = current;
  return h('div', { class: 'runtime-state-workspace' }, [
    h('p', { id: 'studio-runtime-lock-note', class: 'hint', hidden: !blocked }, ['未反映の編集・原文、または処理中のため、状態データの変更を停止しています。変更を反映または破棄すると再開できます。']),
    h('details', { class: 'studio-runtime-current' }, [h('summary', {}, ['適用中の状態データを閲覧']), h('pre', { class: 'code-block' }, [JSON.stringify({ mockData, collectionData: __collections }, null, 2)])]),
    h('fieldset', { id: 'studio-runtime-mutation-controls', disabled: blocked, style: 'border:0;padding:0;margin:0;min-width:0;' }, [uiInputs, directInputs, jsonControls]),
  ]);
}

const animationPlans = new WeakMap();
let previewAnimationEvent = 'screen.entrance_push';
function getPreviewAnimationPlan(file) {
  if (!file?.uiModel) return null;
  if (nodeFrameAvailability !== false) return getCanvasState(getCanvasKey(file.id)).nodeAnimationSummary || null;
  const cached = animationPlans.get(file);
  const cs = getCanvasState(getCanvasKey(file.id));
  const mockVersion=store.getState().preview?.mockDataVersion, localRevision=cs.localToggleState?.revision??0;
  if (cached?.event === previewAnimationEvent && cached.mockVersion === mockVersion && cached.localRevision === localRevision
    && cached.uiInstanceId === cs.uiInstanceId && cached.baseProps === cs.basePropsByIdOverride) return cached.plan;
  const payload = file.meta?.resolution?.animationDefinitions || {};
  const plan = compilePreviewAnimations(file.uiModel, { definitions: payload.definitions || {}, variables: payload.variables || {}, basePropsById: cs.basePropsByIdOverride || {}, bindingDiagnostics: cs.bindingDiagnostics || [], bindingObservationCaptureComplete: cs.bindingObservationComplete, event: previewAnimationEvent });
  animationPlans.set(file, { event: previewAnimationEvent, mockVersion, localRevision, uiInstanceId:cs.uiInstanceId, baseProps:cs.basePropsByIdOverride, plan });
  for (const item of [...(payload.diagnostics || []), ...(plan.diagnostics || [])].slice(0, 40)) {
    diagnostics.log('warn', item.message || siteText('アニメーションの一部を再現できません。'), { source: 'preview-animation', data: item });
  }
  return plan;
}

let animationIdentity = null;
const previewPlayback = createPreviewPlayback({
  requestFrame: requestAnimationFrame, cancelFrame: cancelAnimationFrame, maxSeconds: 60, fps: 30,
  canPlay: () => !studioRuntimeChangesBlocked21() && !document.hidden && getRoute() === 'editor' && Boolean(store.getState().files.currentFileId),
  onChange: ({ playing, seconds }) => {
    const button = document.getElementById('preview-animation-play');
    if (button) { button.textContent = playing ? siteText('一時停止') : siteText('再生'); button.setAttribute('aria-pressed', String(playing)); }
    const input = document.getElementById('preview-animation-seek');
    if (input && document.activeElement !== input) input.value = String(seconds);
    const label = document.getElementById('preview-animation-time');
    if (label) label.textContent = siteText`${seconds.toFixed(2)} 秒`;
  },
  onFrame: (seconds) => {
    if (studioRuntimeChangesBlocked21()) return;
    const state = store.getState();
    const file = state.files.byId[state.files.currentFileId];
    if (!file) return;
    const start = performance.now();
    const cs = ensurePreviewLayout(state);
    if (nodeFrameAvailability === true) { requestPreviewNodeFrame(state, file, cs, cs.layoutInputKey, seconds); return; }
    const plan = getPreviewAnimationPlan(file);
    if (!plan) return;
    const sampled = samplePreviewAnimations(plan, seconds, { basePropsById: cs.basePropsByIdOverride || {} });
    const animated = sampled.changedPropsById || {};
    cs.propsByIdOverride = { ...(cs.basePropsByIdOverride || {}) };
    let changesLayout = Boolean(sampled.affectsLayout);
    for (const [id, props] of Object.entries(animated)) {
      cs.propsByIdOverride[id] = { ...(cs.basePropsByIdOverride?.[id] || {}), ...props };
      if (['size', 'offset', 'visible', 'ignored', 'layer', 'text'].some((name) => Object.hasOwn(props, name))) changesLayout = true;
    }
    if (changesLayout) {
      cs.layout = computeLayoutBoxesForFile(file, getLogicalCanvasPreset(cs), { maxBoxes: 5000, propsByIdOverride: cs.propsByIdOverride, scrollById: cs.scrollById, visibilityMode: cs.structureMode ? 'structure' : 'safe' });
    } else cs.layout = applyPreviewPaintAnimation(cs.baseLayout, file.nodesById, cs.propsByIdOverride);
    drawCanvasNow(getCanvasKey(file.id));
    const elapsed = performance.now() - start;
    previewPerformance.record('animation', elapsed);
    // Commit the terminal frame before stopping a completed, non-looping plan.
    if (sampled.active === false && previewPlayback.state.playing) previewPlayback.pause();
    if (elapsed > 250 && previewPlayback.state.playing) {
      previewPlayback.pause();
      diagnostics.log('warn', siteText('1フレームが250msを超えたため再生を停止しました。時間指定で確認できます。'), { source: 'preview-animation', data: { code: 'ANIMATION_FRAME_BUDGET', elapsedMs: elapsed } });
    }
  },
});

function previewAnimationQualityText41(plan) {
  const quality=plan?.quality || summarizeAnimationQuality({observation:plan?.observation,timeSeconds:previewPlayback.state.seconds});
  const label={passed:'対応範囲の計算済み',unknown:'未対応・未確定あり',not_evaluated:'未評価',failed:'観測エラー'}[quality.status]||'未評価';
  return siteText(`時間指定プレビュー: ${label} / 実機の時間・イベント一致は未検証`);
}
function renderPreviewTimeline(file) {
  const h = studioRuntimeControlsH21;
  const key = file?.uiModel || null;
  if (animationIdentity !== key) { animationIdentity = key; previewPlayback.pause(); previewPlayback.seek(0); }
  const plan = getPreviewAnimationPlan(file);
  const trackCount = Number.isFinite(plan?.trackCount) ? plan.trackCount : Array.isArray(plan?.tracks) ? plan.tracks.length : 0;
  const timelineLimit = plan?.loop ? 60 : Math.max(1, Math.min(3600, Math.ceil(Number(plan?.duration) || 60)));
  previewPlayback.setLimit(timelineLimit);
  const status = !file ? siteText('UIを選択してください。') : trackCount ? siteText`${trackCount} 本のアニメーションを確認できます。` : siteText('この定義に再生可能なアニメーションはありません。');
  return h('div', { class: 'preview-timeline', role: 'group', 'aria-label': siteText('アニメーションの再生と時間指定') }, [
    h('label', { class: 'preview-event-label' }, [siteText('イベント'), h('select', { id: 'preview-animation-event', value: previewAnimationEvent, disabled: !file, 'aria-label': siteText('再生するアニメーションイベント'), onChange: (event) => { previewPlayback.pause(); previewAnimationEvent = event.currentTarget.value; previewPlayback.seek(0); safeRender(); } }, [...new Set(['screen.entrance_push', ...(plan?.availableEvents || [])])].map((event) => h('option', { value: event }, [event])))]),
    h('button', { id: 'preview-animation-play', type: 'button', class: 'btn', disabled: !trackCount, 'aria-pressed': String(previewPlayback.state.playing), onClick: () => previewPlayback.state.playing ? previewPlayback.pause() : previewPlayback.play() }, [previewPlayback.state.playing ? siteText('一時停止') : siteText('再生')]),
    h('button', { type: 'button', class: 'btn', disabled: !trackCount, onClick: () => { previewPlayback.pause(); previewPlayback.seek(0); } }, [siteText('先頭')]),
    h('input', { id: 'preview-animation-seek', type: 'range', min: '0', max: String(timelineLimit), step: '0.01', value: previewPlayback.state.seconds, disabled: !trackCount, 'aria-label': siteText('アニメーション時間（秒）'), onInput: (event) => { previewPlayback.pause(); previewPlayback.seek(event.currentTarget.value); } }),
    h('button', { type: 'button', class: 'btn', disabled: !trackCount, title: siteText('1/30秒進める'), onClick: () => { previewPlayback.pause(); previewPlayback.seek(previewPlayback.state.seconds + 1 / 30); } }, [siteText('1コマ')]),
    h('output', { id: 'preview-animation-time', for: 'preview-animation-seek' }, [siteText`${previewPlayback.state.seconds.toFixed(2)} 秒`]),
    h('span', { class: 'hint' }, [status]),
    h('span', { id:'preview-animation-quality', class:'hint', role:'status' }, [previewAnimationQualityText41(plan)]),
    h('span', { id: 'preview-processing-status', class: 'preview-processing-status', role: 'status' }, [translateSiteMessage(previewProcessingStatus)]),
    h('button', { type: 'button', class: 'btn preview-frame-retry', onClick: () => {
      // 利用者が明示的に再計算した時だけ、失敗した字形を有限回再取得する。
      // 通信失敗では読込済み字形を保持する。容量超過では明示操作による
      // キャッシュ再構築を許可し、恒久的な欠字の自動再試行ループは作らない。
      bitmapFontCache.retryFailures();
      bitmapFontNotices.clear();
      const state = store.getState(); const current = state.files.byId[state.files.currentFileId];
      if (current) {
        const cs = getCanvasState(getCanvasKey(current.id));
        cs.nodeFrameRequestKey = null; cs.layoutInputKey = null;
        ensurePreviewLayout(state);
        requestCanvasTextureRedraw();
      }
    } }, [siteText('表示を再計算')]),
  ]);
}

function renderWorkspaceOverview(state) {
  const imported = state.pack?.imported;
  const currentFile = state.files?.byId?.[state.files.currentFileId];
  const currentDefinition = currentFile?.meta?.selectedDefinition;
  const currentName = currentDefinition && typeof currentDefinition === 'object'
    ? currentDefinition.qualifiedName || currentDefinition.definition || currentFile.path
    : currentDefinition || currentFile?.path || '';
  const loading = state.pack?.status === 'loading' || uiCatalogState.status === 'loading' || screenOpenState.status === 'loading';
  const errors = Number(diagnostics.getCounts().error) || 0;
  const warnings = Number(diagnostics.getCounts().warn) || 0;
  const step = !imported && !vanillaReferenceRuntime ? 1 : !currentFile ? 2 : 3;
  function focusNavigation() {
    if (Number(store.getState().ui?.panels?.leftPx) === 0) toggleLeftPanel(getCommandContext());
    const target = document.getElementById(imported || vanillaReferenceRuntime ? 'workspace-file-picker-search' : 'resource-pack-file-button');
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }
  return h('section', { class: 'workspace-overview', 'aria-label': siteText('作業の状況と手順') }, [
    h('div', { class: 'workspace-overview-heading' }, [
      h('div', { class: 'workspace-title' }, [
        h('strong', {}, [siteText('ローカルワークスペース')]),
        h('span', { class: `workspace-state${loading ? ' is-working' : ''}`, role: 'status' }, [loading ? siteText('処理中') : imported ? siteText('パック読込済み') : vanillaReferenceRuntime ? siteText('バニラ単体読込済み') : siteText('パック未選択')]),
      ]),
      h('div', { class: 'workspace-overview-actions' }, [
        h('button', { type: 'button', class: 'btn btn-primary', onClick: downloadCompleteDebugBundle }, [siteText('ログを一括保存')]),
        h('button', { type: 'button', class: 'workspace-text-button', 'aria-pressed': String(workspaceNavigationState.detailedEditor), onClick: () => { workspaceNavigationState.detailedEditor = !workspaceNavigationState.detailedEditor; safeRender(); } }, [workspaceNavigationState.detailedEditor ? siteText('プレビュー中心に戻る') : siteText('編集・詳細を表示')]),
        h('button', { type: 'button', class: 'workspace-text-button', onClick: () => { if (Number(store.getState().ui?.panels?.leftPx) === 0) toggleLeftPanel(getCommandContext()); requestAnimationFrame(() => { const input = document.getElementById('preview-state-json'); input?.focus(); input?.scrollIntoView({ block: 'center' }); }); } }, [siteText('状態データを編集')]),
        h('button', { type: 'button', class: 'workspace-text-button', onClick: focusNavigation, title: siteText('ファイル検索: Ctrl+K / ⌘K') }, [siteText('ファイル検索 '), h('kbd', {}, ['Ctrl+K'])]),
        h('a', { id: 'workspace-diagnostic-summary', class: `workspace-diagnostic-link${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`, href: '#/logs', title: siteText('このセッションに記録されたログ件数。現在のUIの再現度判定とは別です。') }, [siteText`ログ: エラー ${errors} / 警告 ${warnings}`]),
      ]),
    ]),
    h('ol', { class: 'workspace-steps' }, [
      [siteText('パックを読み込む'), imported ? getImportedPackDisplayName(imported) : vanillaReferenceRuntime ? siteText('バニラ単体を読み込み済み') : siteText('通常パックまたはバニラ単体を読み込み')],
      [siteText('ファイルと定義を選ぶ'), siteText('同じJSON内の複数UIも個別に選択')],
      [siteText('Classic UIを確認する'), currentName || siteText('表示・文字・素材・診断を確認')],
    ].map(([title, description], index) => h('li', { class: `workspace-step${step === index + 1 ? ' is-current' : ''}${step > index + 1 ? ' is-done' : ''}`, 'aria-current': step === index + 1 ? 'step' : null }, [
      h('span', { class: 'workspace-step-number' }, [String(index + 1)]),
      h('div', {}, [h('strong', {}, [title]), h('span', { title: description }, [description])]),
    ]))),
  ]);
}

// 原文の編集は Node 作業領域へ集約し、Canvas の解決済みモデルは保存しない。
const workspacePickerStates = new Map();
const packExportSettings = createPackExportSettings();
let workspaceExportDetailsOpen = false;
let workspaceSourceFrameRequired = false;
const studioUi = { layoutRestore28: null, tab: 'home', leftOpen: true, rightOpen: false, leftView26: 'screens', compactRibbon26: false, elementQuery26: '', elementPage26: 0, rightView: 'properties', viewControls: null, contextMenu: null, rangeSelecting: false, details: Object.create(null) };
const studioActivities26 = new Map();
const vanillaLoadProgress26 = { startedAt: 0, progress: {} };
let studioActivityNumber26 = 0, studioProgressTimer26 = null;
function studioWorkspaceRequest26(operation, data, options = {}) {
  const id = ++studioActivityNumber26;
  const item = { operation, startedAt: Date.now(), progress: {} };
  studioActivities26.set(id, item);
  const onProgress = progress => { item.progress = progress || {}; options.onProgress?.(progress); syncStudioProgress26(); };
  let request;
  try { request = nodeWorkspaceRequest(operation, data, { ...options, onProgress }); }
  catch (error) { studioActivities26.delete(id); throw error; }
  syncStudioProgress26();
  return Promise.resolve(request).finally(() => { studioActivities26.delete(id); syncStudioProgress26(); });
}
function syncStudioProgress26() {
  const host = document.getElementById('studio-progress26');
  if (!host) return;
  const now = Date.now(), pack = store.getState().pack;
  let work = [...studioActivities26.values()].filter(item => item.operation !== 'frame' || now - item.startedAt >= 400).sort((a, b) => a.startedAt - b.startedAt)[0];
  const names = { frame: '表示を計算中', open: '編集データを準備中', read: '要素の原文を準備中', edit: '変更を検査中', commit: '変更を確定中', export: 'パックを書き出し中', 'preview-draft': '変更の表示を更新中' };
  let label = work ? names[work.operation] || '編集データを処理中' : '';
  if (pack?.status === 'loading') {
    work = { progress: importedPackLoadProgress, startedAt: importedPackLoadProgress.startedAt26 || now };
    label = `パック読込 · ${formatWorkspaceImportPhase(importedPackLoadProgress.phase)}`;
  } else if (vanillaReferenceUiState.status === 'loading') {
    work = { progress: vanillaLoadProgress26.progress, startedAt: vanillaLoadProgress26.startedAt || now }; label = 'バニラパックを読み込み中';
  } else host._vanillaStart26 = null;
  if (!work && uiCatalogState.status === 'loading') {
    work = { progress: uiCatalogState.progress, startedAt: host._catalogStart26 ||= now }; label = 'UI一覧を準備中';
  } else if (uiCatalogState.status !== 'loading') host._catalogStart26 = null;
  host.hidden = !work;
  if (!work) { host.removeAttribute('aria-valuenow'); host.removeAttribute('data-slow'); return; }
  const model = studioProgressModel26({ label, progress: work.progress, startedAt: work.startedAt, now });
  host.querySelector('span').textContent = model.text;
  const meter = host.querySelector('progress');
  if (model.percent === null) meter.removeAttribute('value'); else meter.value = model.percent;
  meter.setAttribute('aria-label', model.text); host.dataset.slow = String(model.slow);
}
const sourceWorkspace = createWorkspaceEditor({
  resolvePreviewEditTargets(selected, plan) {
    const state = store.getState(), file = state.files.byId[state.files.currentFileId];
    if (!selected || selected.fileId !== file?.id || selected.previewDefinitionId !== workspacePreviewDefinitionIdentity(file)) {
      throw Object.assign(new Error('編集中の UI が変わりました。要素を選び直してください。'), { code: 'WORKSPACE_LAYOUT_CHANGED' });
    }
    return resolvePlannedPreviewNodeIds22(buildWorkspacePreviewSourceMap(file), plan);
  },
  request: (operation, data, options) => {
    if (!['open', 'close'].includes(operation) && sourceWorkspace.state.sourceKey && sourceWorkspace.state.sourceKey !== workspaceSourceKey()) {
      throw new Error(siteText('パックの構成または原文が更新されました。「編集モード」を押して再読み込みしてください。'));
    }
    return studioWorkspaceRequest26(operation, data, options);
  },
  onChange: (_state, kind) => {
    if (kind === 'edit-options') log.info('Minecraft用UIの編集対象設定を変更しました。', {
      targetMode: _state.editTargetMode, scope: _state.editScope, pendingCount: _state.pendingOperations.length,
      appliesToExistingPending: false, previewNavigationIndependent: true });
    if (kind === 'reset') workspaceSourceFrameRequired = false;
    if (kind === 'pending') { clearPendingMockDataApply(); hidePreviewEditBoxOverlay('pending-edit'); previewPlayback.pause(); nodeFrameController.invalidate(); updateStudioPendingUi(); sourceWorkspaceDraft23.request(); requestCanvasTextureRedraw(); return; }
    if (kind === 'reset' || kind === 'busy' || kind === 'pending-error') sourceWorkspaceDraft23.cancel();
    // 原文の更新は Node の旧 projection を失効させる。失効する直前に
    // 待機フレームと検証世代を破棄し、同じ旧モデルを再送しない。
    if (kind === 'busy' || kind === 'draft') {
      nodeFrameController.invalidate();
      validationGeneration += 1;
      validationPending = null;
      for (const cs of Object.values(canvasUiState.byFileKey)) {
        cs.layoutInputKey = null;
        cs.nodeFrameRequestKey = null;
      }
    }
    syncWorkspacePreviewGate();
    if (kind === 'draft') {
      resumeWorkspacePreviewAfterDraft(sourceWorkspace, {
        pause: () => previewPlayback.pause(),
        requestFrame: () => scheduledWorkspaceRender.request(),
      });
      return;
    }
    safeRender();
    requestAnimationFrame(syncWorkspacePreviewGate);
  },
  onCommit: async (committed, operation) => {
    workspaceSourceFrameRequired = true;
    const activeFile = store.getState().files.byId[store.getState().files.currentFileId];
    const previousDefinition = activeFile?.meta?.selectedDefinition;
    const previousEditSelection = operation?.previewSelectionBefore || sourceWorkspace.state.previewSelection
      || (activeFile ? { fileId: activeFile.id, nodeId: studioSelection21(activeFile).snapshot().selectedIds[0] } : null);
    for (const source of committed.sources || []) {
      const runtime = source.kind === 'vanilla' ? vanillaReferenceRuntime : importedPackRuntime;
      if (!runtime || runtime.zipReader?.nodePackId !== source.id) throw new Error('WORKSPACE_SOURCE_CHANGED');
      runtime.overridesTextByPackPath = Object.assign(Object.create(null), source.overrides || {});
      runtime.overridesJsonByPackPath = Object.create(null);
    }
    markResourcePackMutation();
    sourceWorkspace.adoptSourceKey(workspaceSourceKey());
    resetNativeTexturePreviewComposition(); clearTextureSidecarCache(); resetLangTableRuntime();
    resetUiCatalogState();
    const catalog = await requestUiCatalogBuild('source-workspace-commit');
    if (!catalog) throw new Error('WORKSPACE_CATALOG_FAILED');
    const refreshed = await rebuildOpenPreviewProjections({ workspaceRefreshToken: STUDIO_INTERNAL_REFRESH21 });
    if (refreshed?.ok === false && !['UI_PROJECTION_CLOSED', 'UI_PROJECTION_REFRESH_FAILED'].includes(refreshed.code)) throw new Error(refreshed.error || 'WORKSPACE_PREVIEW_REBUILD_FAILED');
    if (activeFile?.path && !store.getState().files.byId[activeFile.id]) {
      const definitions = listEffectiveDefinitionsForPath(catalog, activeFile.path);
      const remaining = definitions.find(item => item.qualifiedName === previousDefinition?.qualifiedName)
        || definitions.find(item => item.profile !== 'pocket');
      if (remaining) {
        const result = await openUiScreenFromImportedPack(activeFile.path, remaining.id, { workspaceRefreshToken: STUDIO_INTERNAL_REFRESH21 });
        if (!result.ok) throw new Error(result.error || 'WORKSPACE_PREVIEW_REBUILD_FAILED');
      }
    }
    if (refreshed?.ok === false && operation?.type !== 'delete' && !store.getState().files.byId[activeFile?.id]
      && listEffectiveDefinitionsForPath(catalog, activeFile?.path || '').some(item => item.profile !== 'pocket')) {
      throw new Error(refreshed.error || 'WORKSPACE_PREVIEW_REBUILD_FAILED');
    }
    // UI 専用の継承分岐へ保存した後は、更新済み投影から新しい原文対応を取得する。
    const currentFile = store.getState().files.byId[store.getState().files.currentFileId];
    const structureSelection31 = sourceWorkspace.state.lastStructureSelection31;
    const lastOperation31 = operation?.type === 'batch' ? operation.operations?.at(-1) : operation;
    if (lastOperation31?.scope === 'screen' && ['add', 'delete'].includes(lastOperation31.type)) {
      // 追加・削除は更新済みの原文配置へ選択を移す。旧選択IDから兄弟を誤選択しない。
      const match31 = structureSelection31 && [...buildWorkspacePreviewSourceMap(currentFile)].find(([, origin]) =>
        origin.path === structureSelection31.path && origin.pointer === structureSelection31.pointer
        && workspaceRecordSourceId(origin, sourceWorkspace.state.sources) === structureSelection31.sourceId);
      if (match31) {
        studioSelection21(currentFile).setSelection([match31[0]]);
        await selectSourceForCanvasNode(currentFile, match31[0], { plan: false });
      } else if (currentFile) { studioSelection21(currentFile).setSelection([]); store.dispatch(actions.clearSelection()); }
    } else if ((operation?.scope || operation?.type === 'batch' || operation?.historyAction?.editPlan) && previousEditSelection?.fileId === currentFile?.id
      && currentFile?.nodesById?.[previousEditSelection.nodeId]) {
      await selectSourceForCanvasNode(currentFile, previousEditSelection.nodeId, { plan: false });
    }
  },
});
// 構造変更も画面選択・ロックを確認する。詳細側の確認ボタンからも迂回させない。
const prepareStructureBase31 = sourceWorkspace.prepareStructure31.bind(sourceWorkspace);
sourceWorkspace.prepareStructure31 = async (change, options = {}) => {
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  const selected = options.targetSelection || sourceWorkspace.state.previewSelection;
  if (!file || selected?.fileId !== file.id || !file.nodesById?.[selected.nodeId]) throw new Error('WORKSPACE_LAYOUT_CHANGED');
  assertStudioUnlocked26(file, [selected.nodeId]);
  const result = await prepareStructureBase31(change, options);
  if (store.getState().files.byId[store.getState().files.currentFileId]?.uiModel !== file.uiModel) throw new Error('WORKSPACE_LAYOUT_CHANGED');
  const targets = resolvePlannedPreviewNodeIds22(buildWorkspacePreviewSourceMap(file), result.result?.editPlan);
  assertStudioUnlocked26(file, targets.length ? targets : [selected.nodeId]);
  return result;
};
const confirmDeleteBase31 = sourceWorkspace.confirmDelete.bind(sourceWorkspace);
sourceWorkspace.confirmDelete = async () => {
  if (sourceWorkspace.state.deletePlan?.operation?.scope === 'screen') {
    const state = store.getState(), file = state.files.byId[state.files.currentFileId], selected = sourceWorkspace.state.previewSelection;
    if (!file || selected?.fileId !== file.id || !file.nodesById?.[selected.nodeId]) throw new Error('WORKSPACE_LAYOUT_CHANGED');
    const targets = resolvePlannedPreviewNodeIds22(buildWorkspacePreviewSourceMap(file), sourceWorkspace.state.deletePlan.result?.editPlan);
    assertStudioUnlocked26(file, targets.length ? targets : [selected.nodeId]);
  }
  return confirmDeleteBase31();
};
// 通常の数値欄と詳細属性欄を同じロック境界で保護する。
const studioEditPreviewProperty26 = sourceWorkspace.editPreviewProperty.bind(sourceWorkspace);
sourceWorkspace.editPreviewProperty = async (property, value) => {
  if (['offset', 'size', 'min_size', 'max_size', 'anchor_from', 'anchor_to', 'layer', 'text', 'texture'].includes(property)) {
    const policy = captureGeometryPolicy29(sourceWorkspace.state), selection = workspaceEditSelectionIdentity(sourceWorkspace.state.previewSelection);
    const state = store.getState(), file = state.files.byId[state.files.currentFileId];
    const plan = await sourceWorkspace.planPreviewEdit({ type: 'set', property });
    assertGeometryPolicy29(sourceWorkspace.state, policy);
    if (selection !== workspaceEditSelectionIdentity(sourceWorkspace.state.previewSelection)) throw Object.assign(new Error('WORKSPACE_SELECTION_SUPERSEDED'), { code: 'WORKSPACE_SELECTION_SUPERSEDED' });
    const ids = plan ? resolvePlannedPreviewNodeIds22(buildWorkspacePreviewSourceMap(file), plan)
      : sourceWorkspace.state.previewSelection?.nodeId ? [sourceWorkspace.state.previewSelection.nodeId] : [];
    assertStudioUnlocked26(file, ids);
  }
  return studioEditPreviewProperty26(property, value);
};
const studioMovePreviewElement26 = sourceWorkspace.movePreviewElement.bind(sourceWorkspace);
sourceWorkspace.movePreviewElement = async delta => {
  const policy = captureGeometryPolicy29(sourceWorkspace.state), selection = workspaceEditSelectionIdentity(sourceWorkspace.state.previewSelection);
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  const plan = await sourceWorkspace.planPreviewEdit({ type: 'move', delta });
  assertGeometryPolicy29(sourceWorkspace.state, policy);
  if (selection !== workspaceEditSelectionIdentity(sourceWorkspace.state.previewSelection)) throw Object.assign(new Error('WORKSPACE_SELECTION_SUPERSEDED'), { code: 'WORKSPACE_SELECTION_SUPERSEDED' });
  assertStudioUnlocked26(file, resolvePlannedPreviewNodeIds22(buildWorkspacePreviewSourceMap(file), plan));
  return studioMovePreviewElement26(delta);
};
const studioEditPendingAddition26 = sourceWorkspace.editPendingAddition.bind(sourceWorkspace);
sourceWorkspace.editPendingAddition = (id, change) => {
  if ((Array.isArray(change)?change:[change]).some(item=>item?.type === 'move' || item?.type === 'delete' || ['offset', 'size', 'anchor_from', 'anchor_to', 'layer'].includes(item?.property))) assertStudioPendingAdditionUnlocked26(id);
  return studioEditPendingAddition26(id, change);
};
function workspaceDraftSnapshot23() {
  const ws = sourceWorkspace.state, state = store.getState(), file = state.files.byId[state.files.currentFileId];
  if (!ws.workspaceId || ws.busy || ws.pendingCommitUncertain || ws.projectionError || !ws.pendingOperations.length
    || ws.pendingBaseRevision !== ws.revision || !file?.meta?.previewProjection) return null;
  const operations = sourceWorkspace.pendingCompiledOperations();
  if (!operations.length) return null;
  const cs = getCanvasState(getCanvasKey(file.id)), selected = file.meta.selectedDefinition;
  const rawKey = selected?.rawKey || file.uiModel?.root?.children?.[0]?.key?.raw;
  if (!rawKey) return null;
  const preview = file.meta.sourceEditPreviewOptions || {};
  return { workspaceId: ws.workspaceId, expectedRevision: ws.revision, pendingVersion: ws.pendingVersion,
    operation: { type: 'batch', pointerBasis: 'base-revision', operations },
    screen: { path: file.path, pointer: `/${escapeSourcePointer(rawKey)}`, sourceId: workspacePreviewSourceId(file) },
    preview, variables: preview.variables, representativeCollections: preview.representativeCollections,
    eventFactorySelections: preview.eventFactorySelections,
    frame: { generation: ws.pendingVersion, preset: getLogicalCanvasPreset(cs),
      qualifiedName: getSelectedPreviewQualifiedName(file), mockData: state.preview?.mockData || {},
      collectionData: state.preview?.mockData?.__collections || {}, scrollById: { ...(cs.scrollById || {}) },
      propsByIdOverride: cs.previewTopicRootId ? { [cs.previewTopicRootId]: { visible: true } } : undefined,
      visibilityMode: cs.structureMode ? 'structure' : 'safe', animationTime: previewPlayback.state.seconds,
      animationEvent: previewAnimationEvent } };
}
const sourceWorkspaceDraft23 = createWorkspaceDraftPreview23({
  readSnapshot: workspaceDraftSnapshot23,
  async project(snapshot, options) {
    const result = await studioWorkspaceRequest26('preview-draft', snapshot, options);
    if (result?.ok && snapshot.pendingVersion === sourceWorkspace.state.pendingVersion
      && snapshot.expectedRevision === sourceWorkspace.state.revision) {
      const state = store.getState(), file = state.files.byId[state.files.currentFileId];
      if (file) {
        const cs = getCanvasState(getCanvasKey(file.id));
        result.clientScene23 = buildWorkspaceDraftScene23({ file, result,
          additions: sourceWorkspace.pendingAdditions(file.id), transforms: sourceWorkspace.pendingNodeTransforms(file.id),
          basePropsByIdOverride: cs.propsByIdOverride });
      }
    }
    return result;
  },
  onChange(status, kind) {
    const state = store.getState(), file = state.files.byId[state.files.currentFileId];
    if (kind === 'draft-ready' && file) {
      const cs = getCanvasState(getCanvasKey(file.id)), result = sourceWorkspaceDraft23.getResult();
      if (!result?.clientScene23 || result.clientScene23.baseFile !== file) return;
        cs.workspaceDraftScene23 = result.clientScene23;
        cs.workspaceDraftPaint23 = null;
        if (cs.pendingAdditionSelection23 && !sourceWorkspace.pendingAdditions(file.id).some(item => item.id === cs.pendingAdditionSelection23)) cs.pendingAdditionSelection23 = null;
        requestCanvasTextureRedraw();
    }
    if (kind === 'draft-error') diagnostics.log('warn', status.error?.message || '草稿プレビューを計算できませんでした。',
      { source: 'workspace-draft', data: { code: status.error?.code, pendingVersion: status.version } });
    const label = document.getElementById('studio-draft-status23');
    if (label) label.textContent = status.status === 'loading' || status.status === 'queued' ? '未反映の変更をプレビューへ反映中…'
      : status.status === 'error' ? status.error?.message : status.status === 'ready' ? 'プレビュー更新済み・JSON UIへの反映は未確定' : '';
  },
});
function studioDraftScene23(cs, file) {
  const scene = cs.workspaceDraftScene23, ws = sourceWorkspace.state;
  if (!ws.pendingOperations.length || ws.pendingCommitUncertain || ws.projectionError || ws.pendingBaseRevision !== ws.revision
    || !sameWorkspacePreviewModel(scene?.baseFile, file) || scene.baseRevision !== ws.revision) return null;
  if (scene.pendingVersion === ws.pendingVersion) return scene;
  if (cs.workspaceDraftPaint23?.scene === scene && cs.workspaceDraftPaint23.version === ws.pendingVersion) return cs.workspaceDraftPaint23.result;
  const result = advanceWorkspaceDraftScene23(scene, { transforms: sourceWorkspace.pendingNodeTransforms(file.id), additions: sourceWorkspace.pendingAdditions(file.id) });
  cs.workspaceDraftPaint23 = { scene, version: ws.pendingVersion, result };
  return result;
}
// UI のファイルタブ・検索・キーボードも、副作用の直前に同じ境界を通す。
const studioDispatch21 = store.dispatch.bind(store);
store.dispatch = action => {
  if (['preview/setMockData', 'ui/setPreviewLocale'].includes(action?.type)) assertStudioExternalChange21('プレビュー状態・言語の変更');
  if (['files/openFile', 'files/closeFile', 'files/setCurrentFile', 'preview/navCommit', 'project/setProject', 'pack/unload'].includes(action?.type)
    && action[STUDIO_INTERNAL_REFRESH21] !== true
    && !(action.type === 'files/setCurrentFile' && action.fileId === store.getState().files.currentFileId)) {
    assertStudioExternalChange21('UI の切り替え');
  }
  return studioDispatch21(action);
};
function assertStudioExternalChange21(label = 'パックや UI の変更') {
  const ws = sourceWorkspace.state;
  let message = '';
  if (ws.busy) message = '変更を反映・検査しています。処理が完了してから操作してください。';
  else if (ws.pendingCommitUncertain || ws.pendingConflict) message = '前回の確定内容を確認する必要があります。「確定済みの内容を確認」を先に選んでください。';
  else if (ws.pendingOperations.length) message = '未確定の変更があります。「JSON UIに確定」または「未確定の変更を破棄」を先に選んでください。';
  else if ([...ws.drafts.values()].some(draft => draft.dirty || draft.invalid)) message = '未適用の原文があります。先に原文を反映するか、未適用の変更を取り消してください。';
  if (message) throw Object.assign(new Error(`${label}: ${message}`), { code: 'WORKSPACE_EXTERNAL_CHANGE_BLOCKED' });
}
function assertStudioProjectionChange21(options = {}) {
  if (options.workspaceRefreshToken === STUDIO_INTERNAL_REFRESH21) return;
  assertStudioExternalChange21('UI の切り替え');
}
function dispatchStudioProjection21(action, options = {}) {
  if (options.workspaceRefreshToken === STUDIO_INTERNAL_REFRESH21) action[STUDIO_INTERNAL_REFRESH21] = true;
  return store.dispatch(action);
}
function workspaceSources() {
  return [['vanilla', vanillaReferenceRuntime], ['imported', importedPackRuntime]]
    .filter(([, runtime]) => runtime)
    .map(([kind, runtime]) => ({ kind, id: runtime.zipReader?.nodePackId, overrides: runtime.overridesTextByPackPath || {} }));
}
function workspaceSourceKey() {
  return `${workspaceSources().map(source => `${source.kind}:${source.id}`).join('|')}|${resourcePackMutationEpoch}`;
}
function workspacePreviewBlocked() {
  if (!sourceWorkspace.state.workspaceId) return false;
  if (sourceWorkspace.previewBlocked()) return true;
  if (!workspaceSourceFrameRequired || nodeFrameAvailability === false) return false;
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  if (!file?.meta?.previewProjection) return false;
  const cs = getCanvasState(getCanvasKey(file.id));
  return cs.nodeFrameAppliedFile?.uiModel !== file.uiModel || cs.nodeFrameAppliedFile?.nodesById !== file.nodesById;
}
function syncWorkspacePreviewGate() {
  const blocked = workspacePreviewBlocked();
  for (const cs of Object.values(canvasUiState.byFileKey)) { cs.sourceEditing = sourceWorkspace.state.mode === 'edit'; cs.sourcePreviewBlocked = blocked; }
  const gate = document.getElementById('workspace-preview-gate');
  if (gate) { gate.hidden = !blocked; gate.textContent = sourceWorkspace.state.busy
    ? siteText('編集内容を検証しています。完了後にプレビューを更新します。')
    : !sourceWorkspace.previewBlocked() ? siteText('編集した UI の描画を準備しています。新しい計算結果が届くまでお待ちください。')
    : siteText('原文が未適用、無効、または再描画に失敗したためプレビューを停止しています。原文を修正して反映するか、変更を取り消してください。'); }
  const canvas = document.getElementById('preview-canvas');
  if (canvas) canvas.style.visibility = blocked || getCanvasState(getCanvasKey(store.getState().files.currentFileId)).previewClosed ? 'hidden' : '';
  const message = document.getElementById('workspace-editor-message');
  if (message) message.textContent = translateSiteMessage(sourceWorkspace.state.error) || (blocked ? siteText('原文を変更しました。「検証して反映」でプレビューを更新します。') : translateSiteMessage(sourceWorkspace.state.message));
}
function reportWorkspaceError(error) {
  if (['WORKSPACE_READ_SUPERSEDED', 'WORKSPACE_SELECTION_SUPERSEDED', 'WORKSPACE_SUPERSEDED'].includes(error?.code)) return;
  const message = error instanceof Error ? error.message : String(error);
  if (error?.exportResult) workspaceExportDetailsOpen = true;
  sourceWorkspace.state.error = message;
  setStatus({ text: message, level: 'error' });
  diagnostics.captureError(error, { source: 'source-workspace', message,
    data: error?.exportResult ? { code: error.code, export: workspaceExportDiagnosticSummary(error.exportResult, { maxIssues: 20 }) } : undefined });
  safeRender();
}
function workspacePreviewSourceId(file) {
  const selected = file?.meta?.selectedDefinition;
  const record = uiCatalogState.catalog?.recordsById?.[selected?.recordId] || selected;
  return workspaceRecordSourceId(record, workspaceSources());
}
async function ensureSourceWorkspace(path, requestedSourceId) {
  await sourceWorkspace.ensure(workspaceSources(), workspaceSourceKey());
  if (path) {
    const file = store.getState().files.byId[store.getState().files.currentFileId];
    const sourceId = requestedSourceId ?? (file?.path === path ? workspacePreviewSourceId(file) : undefined);
    const preserveSource = keepWorkspacePreviewSourceSelection(sourceWorkspace.state, file);
    if (!preserveSource && (!sourceWorkspace.getDocument(path, sourceId) || sourceWorkspace.state.activePath !== path || (sourceId && sourceWorkspace.state.activeSourceId !== sourceId))) {
      await sourceWorkspace.readDocument(path, sourceId ? { sourceId } : {});
    }
  }
  // 編集モードを開いた直後から、表示している定義の属性を操作できる。
  const currentFile = store.getState().files.byId[store.getState().files.currentFileId];
  if (path === currentFile?.path) {
    selectWorkspacePreviewDefinition(sourceWorkspace, currentFile, workspacePreviewSourceId(currentFile));
  }
  return sourceWorkspace.state;
}
function sourceNodeForPreview(file, nodeId) {
  const sourceId = workspacePreviewSourceId(file);
  return findAuthoredNodeForPreview({ file, nodeId, nodes: sourceWorkspace.state.nodes, sourceId, sources: workspaceSources() });
}
function selectPreviewForSource(pointer, path, sourceId) {
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  const match = Object.keys(file?.nodesById || {}).find(id => {
    const target = sourceNodeForPreview(file, id);
    return target?.pointer === pointer && matchesWorkspaceDocument(target, path, sourceId);
  });
  if (match) {
    if (sourceWorkspace.state.mode === 'edit') studioSelection21(file).select(match, { single: true });
    store.dispatch(actions.selectNode(match));
    requestCanvasTextureRedraw();
  } else {
    // 別定義などCanvas対応のない原文選択は保持し、古い可視選択だけを解除する。
    if (file?.nodesById && sourceWorkspace.state.mode === 'edit') studioSelection21(file).setSelection([]);
    store.dispatch(actions.clearSelection());
    requestCanvasTextureRedraw();
  }
}
async function selectSourceForCanvasNode(file, nodeId, { plan = true } = {}) {
  const target = sourceNodeForPreview(file, nodeId);
  if (!target) throw new Error(siteText('この要素に対応する原文を特定できません。プレビューを再計算してください。'));
  const current = store.getState().files.byId[store.getState().files.currentFileId];
  if (current?.uiModel !== file.uiModel) throw new Error('WORKSPACE_LAYOUT_CHANGED');
  const definition = file.meta?.selectedDefinition;
  const rawKey = definition?.rawKey || file.uiModel?.root?.children?.[0]?.key?.raw;
  const selected = await sourceWorkspace.selectPreviewTarget(target, { fileId: file.id, nodeId, previewDefinitionId: workspacePreviewDefinitionIdentity(file),
    effectivePointer: target.previewPointer,
    preview: file.meta?.sourceEditPreviewOptions || undefined,
    screen: rawKey ? { path: file.path, pointer: `/${escapeSourcePointer(rawKey)}`, sourceId: workspacePreviewSourceId(file) } : null });
  if (store.getState().files.byId[store.getState().files.currentFileId]?.uiModel !== file.uiModel) throw new Error('WORKSPACE_LAYOUT_CHANGED');
  store.dispatch(actions.selectNode(nodeId));
  if (plan) void sourceWorkspace.planPreviewEdit().catch(reportWorkspaceError);
  return selected;
}
async function commitSourceCanvasMove(file, nodeId, layout, box, startBox) {
  const policy = captureGeometryPolicy29(sourceWorkspace.state);
  const targetMode = sourceWorkspace.state.editTargetMode || 'visual';
  const original = startBox || studioPaintLayout21(getCanvasState(getCanvasKey(file.id)),file).boxes.find(item => item.id === nodeId);
  if (!original) throw new Error('WORKSPACE_LAYOUT_CHANGED');
  const selected = studioSelection21(file);
  if (!selected.snapshot().selectedIds.includes(nodeId)) selected.select(nodeId);
  const ids = selected.movementRoots();
  assertStudioUnlocked26(file, ids);
  const selections = ids.map(id => studioPreviewSelection21(file,id));
  if (sourceWorkspace.state.sourceKey !== workspaceSourceKey()) throw new Error('パックの構成が変わっています。「編集」を選び直してから操作してください。');
  const targetIdentities = selections.map(selection => JSON.stringify([selection.sourceId, selection.path, selection.pointer]));
  if (targetMode === 'visual' && ids.length > 1 && (new Set(targetIdentities).size !== ids.length || selections.some(selection => selection.generated || Number(selection.instances) > 1))) {
    throw new Error('同じ原文や反復テンプレートに対応する要素は、まとめて移動できません。要素を個別に選び、適用範囲を確認してください。');
  }
  const delta = movementDelta21(original,box);
  if (ids.length === 1) {
    // selectPreviewTarget は同じ選択なら同意を維持し、変われば必ず失効する。
    await selectSourceForCanvasNode(file, ids[0], { plan: false });
    assertGeometryPolicy29(sourceWorkspace.state, policy);
    await sourceWorkspace.movePreviewElement(delta);
    requestCanvasTextureRedraw();
    return;
  }
  if (targetMode === 'interaction') {
    // 旧版で未対応だった複数の機能親も、事前計画と全対象ロックを通す。
    // 部分的にキューへ入れず、全件の確認ができた場合だけまとめて追加する。
    const planned = [];
    for (const id of ids) {
      await selectSourceForCanvasNode(file, id, { plan: false });
      assertGeometryPolicy29(sourceWorkspace.state, policy);
      const selection = { ...sourceWorkspace.state.previewSelection };
      const plan = await sourceWorkspace.planPreviewEdit({ type: 'move', delta });
      assertGeometryPolicy29(sourceWorkspace.state, policy);
      if (workspaceEditSelectionIdentity(selection) !== workspaceEditSelectionIdentity(sourceWorkspace.state.previewSelection)) throw Object.assign(new Error('WORKSPACE_SELECTION_SUPERSEDED'), { code: 'WORKSPACE_SELECTION_SUPERSEDED' });
      const targetIds = resolvePlannedPreviewNodeIds22(buildWorkspacePreviewSourceMap(file), plan);
      planned.push({ plan, targetIds, selection, operation: workspacePreviewEditOperation(sourceWorkspace.state, { type: 'move', delta }) });
    }
    const unique = distinctPlannedMoves29(planned);
    assertStudioUnlocked26(file, unique.flatMap(entry => entry.targetIds));
    sourceWorkspace.queueOperations(unique.map(entry => entry.operation), { label: '操作要素全体を移動',
      previewSelections: unique.map(entry => entry.selection), previewNodeIds: unique.map(entry => entry.targetIds) });
  } else {
    const operations = selections.map(selection => ({ type:'move',delta,path:selection.path,pointer:selection.pointer,sourceId:selection.sourceId,
      screen:selection.screen,effectivePointer:selection.effectivePointer,preview:selection.preview,scope:sourceWorkspace.state.editScope,
      targetMode }));
    sourceWorkspace.queueOperations(operations,{label:ids.length>1?'グループを移動':'要素を移動',previewSelections:selections});
  }
  requestCanvasTextureRedraw();
}
async function commitSourceCanvasResize33(file,nodeId,layout,end,start) {
  const policy=captureGeometryPolicy29(sourceWorkspace.state);
  await selectSourceForCanvasNode(file,nodeId,{plan:false});
  assertGeometryPolicy29(sourceWorkspace.state,policy);
  const plan=await sourceWorkspace.planPreviewEdit({type:'set',property:'size'});
  assertGeometryPolicy29(sourceWorkspace.state,policy);
  const targets=resolvePlannedPreviewNodeIds22(buildWorkspacePreviewSourceMap(file),plan);
  assertStudioUnlocked26(file,targets.length?targets:[nodeId]);
  if(plan.promoted)throw new Error('操作要素全体のサイズ変更は、要素一覧でその親のボタンやパネルを選んでから行ってください。見た目の部品だけなら編集対象を切り替えられます。');
  const changes=resizeChanges33(start,end,{...(plan.target.props||file.nodesById[nodeId].props),...plan.target.authoredGeometry33,...sourceWorkspace.pendingNodeTransforms(file.id).get(nodeId)?.properties});
  await sourceWorkspace.transformPreviewElement(changes);
  requestCanvasTextureRedraw();
}
function currentInsertionParent33(file) {
  const screenId = file?.uiModel?.root?.children?.[0]?.id;
  return insertionParent33({nodesById:file?.nodesById, screenId,
    selectedId:sourceWorkspace.state.previewSelection?.fileId===file?.id ? sourceWorkspace.state.previewSelection.nodeId : null,
    relation:sourceWorkspace.state.insertionRelation32||'inside'});
}
function describeInsertionParent32(file) {
  const ws=sourceWorkspace.state;
  if(!ws.addType)return '';
  try {
    const node=currentInsertionParent33(file);
    return `追加先: ${node.id.split('/').slice(-5).join(' → ')} (${node.type})。状態表示内の場合は、その状態に従います。`;
  } catch(error) { return error.message; }
}
async function addSourceCanvasElement(file, layout, world, size33 = null) {
  const ws=sourceWorkspace.state, token=beginAdd32(ws);
  if(!token)return; // 同じ押下の重複送信を防ぐ
  let accepted=false, failure=null;
  try {
    const structurePolicy32=captureGeometryPolicy29(ws);
    const parentNode=currentInsertionParent33(file);
    if(ws.previewSelection?.fileId!==file.id) await selectSourceForCanvasNode(file,parentNode.id,{plan:false});
    const original=ws.previewSelection;
    const parentId=parentNode.id, parent=sourceNodeForPreview(file,parentId);
    if(!parent)throw Object.assign(new Error('追加先の原文を特定できません。通常の親を明示選択してください。'),{code:'WORKSPACE_ADD_PARENT_REQUIRED'});
    assertStudioUnlocked26(file,[parentId]);
    const parentBox=layout.boxes.find(box=>box.id===parentId);
    if(!parentBox)throw Object.assign(new Error('追加先は表示されていません。表示された通常の親を選択してください。'),{code:'WORKSPACE_ADD_PARENT_HIDDEN'});
    const effectiveParent=findUiNodeById(file.uiModel.root,parentId), type=token.type;
    const siblings=ws.nodes.filter(node=>matchesWorkspaceDocument(node,parent.path,parent.sourceId)&&node.parentPointer===parent.pointer);
    const pendingNames=ws.pendingOperations.map(entry=>entry.operation).filter(op=>op.type==='add'&&op.parentPointer===parent.pointer&&matchesWorkspaceDocument(op,parent.path,parent.sourceId)).map(op=>op.name);
    const names=new Set([...siblings.map(node=>node.localName),...(effectiveParent?.children||[]).map(node=>node.key?.local_name),...pendingNames]);
    let number=1;while(names.has(`new_${type}_${number}`))number++;
    const value=newElementValue33(type,[world.x-parentBox.x,world.y-parentBox.y]);
    if(size33)value.size=[size33.w,size33.h];
    const change={name:`new_${type}_${number}`,value,operationId:token.id,insertionRelation:token.relation};
    const targetSelection={...parent,fileId:file.id,nodeId:parentId,previewDefinitionId:workspacePreviewDefinitionIdentity(file),
      effectivePointer:parent.previewPointer,screen:{...original.screen},...(original.preview?{preview:original.preview}:{})};
    const stillCurrent=()=>currentAdd32(ws,token)&&store.getState().files.byId[store.getState().files.currentFileId]?.uiModel===file.uiModel;
    assertGeometryPolicy29(ws,structurePolicy32);
    if(!stillCurrent())throw Object.assign(new Error('追加の設定が変わりました。新しい設定は保持しています。'),{code:'WORKSPACE_SELECTION_SUPERSEDED'});
    if(ws.editScope==='screen')await sourceWorkspace.addScreenElement31(change,{targetSelection,isCurrent:stillCurrent});
    else sourceWorkspace.queueOperations([{...change,type:'add',path:parent.path,sourceId:parent.sourceId,parentPointer:parent.pointer,
      preserveInheritedControls:Boolean(effectiveParent?.children?.length)}],{previewSelections:[targetSelection]});
    accepted=true;
    getCanvasState(getCanvasKey(file.id)).pendingAdditionSelection23=sourceWorkspace.pendingAdditions(file.id).at(-1)?.id||null;
  } catch(error) {
    failure=error;
    // キュー受理後の再描画エラーでは二度追加しない。
    accepted ||= ws.pendingOperations.some(entry=>entry.operation?.operationId===token.id);
    if(!accepted&&currentAdd32(ws,token))ws.lastStructureAttempt32={type:'add',status:'rejected',code:error.code||'WORKSPACE_REQUEST_FAILED',message:String(error.message||error).slice(0,1024),operationId:token.id,reference:error.referenceInfo32?.[0]||null};
    throw error;
  } finally {
    finishAdd32(ws,token,{accepted,error:failure});
    safeRender();
  }
}
async function exportCurrentSourceWorkspacePack() {
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  const record = uiCatalogState.catalog?.recordsById?.[file?.meta?.selectedDefinition?.recordId];
  if (!record) throw new Error(siteText('書き出す UI 定義を先にプレビューしてください。'));
  const exportOptions = packExportSettings.options();
  await ensureSourceWorkspace();
  if (!sourceWorkspace.state.selections.length) sourceWorkspace.selectExport({ filePath: record.filePath, rawKey: record.rawKey, sourceId: workspaceRecordSourceId(record, workspaceSources()) });
  const blob = await sourceWorkspace.export('zip', exportOptions);
  downloadBlobFile({ filename: `jsonui_selected_${makeSafeFileTimestamp()}.mcpack`, blob });
  setStatus(siteText('選択した UI と必要な依存ファイルを書き出しました。'));
}
function renderSourceWorkspaceToolbar(state) {
  const current = state.files.byId[state.files.currentFileId];
  const ws = sourceWorkspace.state;
  const invoke = action => void Promise.resolve().then(action).catch(reportWorkspaceError);
  const editing = ws.mode === 'edit';
  const selected = current?.meta?.selectedDefinition;
  const currentSelection = () => {
    const record = uiCatalogState.catalog?.recordsById?.[selected?.recordId];
    if (!record) throw new Error(siteText('書き出す UI 定義を先にプレビューしてください。'));
    return { filePath: record.filePath, rawKey: record.rawKey, sourceId: workspaceRecordSourceId(record, workspaceSources()) };
  };
  return h('section', { class: 'workspace-edit-toolbar', 'aria-label': siteText('プレビューと編集の切り替え') }, [
    h('div', { class: 'workspace-mode-switch', role: 'group', 'aria-label': siteText('作業モード') }, [
      h('button', { type: 'button', class: `btn${!editing ? ' btn-primary' : ''}`, 'aria-pressed': String(!editing), disabled: ws.busy,
        onClick: () => sourceWorkspace.setMode('preview') }, [siteText('プレビューモード')]),
      h('button', { type: 'button', class: `btn${editing ? ' btn-primary' : ''}`, 'aria-pressed': String(editing), disabled: ws.busy || (!importedPackRuntime && !vanillaReferenceRuntime),
        onClick: () => invoke(async () => { await ensureSourceWorkspace(current?.path || screenOpenState.selectedPath); sourceWorkspace.setMode('edit'); previewPlayback.pause(); hidePreviewEditBoxOverlay('source-edit-mode'); }) }, [siteText('編集モード')]),
    ]),
    h('span', { class: 'workspace-mode-description' }, [editing ? siteText('要素をドラッグして原文を編集。Alt＋ドラッグで表示を移動。') : siteText('表示・ボタン・入力の動作を確認。')]),
    editing ? renderWorkspaceEditPolicy(h, { controller: sourceWorkspace, onError: reportWorkspaceError }) : '',
    ws.workspaceId ? h('div', { class: 'workspace-editor-actions' }, [
      h('button', { type: 'button', class: 'btn', disabled: ws.busy || !ws.canUndo, onClick: () => invoke(() => sourceWorkspace.history('undo')) }, [siteText('元に戻す')]),
      h('button', { type: 'button', class: 'btn', disabled: ws.busy || !ws.canRedo, onClick: () => invoke(() => sourceWorkspace.history('redo')) }, [siteText('やり直す')]),
      ws.projectionError ? h('button', { type: 'button', class: 'btn', disabled: ws.busy, onClick: () => invoke(() => sourceWorkspace.refresh()) }, [siteText('プレビューを再検証')]) : '',
    ]) : '',
    editing ? h('div', { class: 'workspace-editor-actions' }, [
      h('label', { for: 'workspace-add-type' }, [siteText('追加する要素')]),
      h('select', { id: 'workspace-add-type', disabled: ws.busy || ws.editScope !== 'shared', value: ws.addType || '', onChange: event => { setAddType32(ws, event.currentTarget.value); safeRender(); } }, [
        h('option', { value: '' }, [siteText('選択・移動')]), ...[['panel',siteText('パネル')],['label',siteText('ラベル')],['image',siteText('画像')],['button',siteText('ボタン')]].map(([value,label]) => h('option', { value, selected: ws.addType === value ? 'selected' : null }, [label])),
      ]),
      ws.addType ? h('span', { class: 'hint' }, [siteText('追加先の親を選び、プレビュー内の位置をクリック。画像のテクスチャやボタンの動作は追加後に設定できます。')]) : '',
      ws.editScope !== 'shared' ? h('span', { class: 'hint' }, [siteText('画面限定の追加・削除は編集リボンから行います。継承・直接 JSON 編集は共有元を変更します。')]) : '',
    ]) : '',
    h('details', { class: 'workspace-export-section', open: workspaceExportDetailsOpen, onToggle: event => { if (event.currentTarget.isConnected) workspaceExportDetailsOpen = event.currentTarget.open; } }, [
      h('summary', {}, [siteText`選択した UI を書き出す（${ws.selections.length} 件）`]),
      h('p', { class: 'hint' }, [siteText('現在の UI を追加し、依存する JSON・画像・音声・文字を含むリソースパックを作成します。複数の UI を追加できます。')]),
      ws.lastStructureAttempt32?.status==='rejected' ? h('p',{class:'hint',role:'status'},['直前に拒否された追加・削除は出力に含まれません。確定済みの変更だけを書き出します。']) : '',
      packExportSettings.render(h, { disabled: ws.busy, onError: reportWorkspaceError,
        onChange: render => {
          ws.exportPlan = null;
          for (const button of document.querySelectorAll('[data-pack-export-action]')) button.disabled = ws.busy || packExportSettings.state.loading || !ws.selections.length;
          if (render) safeRender();
        } }),
      h('div', { class: 'workspace-editor-actions' }, [
        h('button', { type: 'button', class: 'btn', disabled: ws.busy || !current?.meta?.previewProjection, onClick: () => invoke(async () => { const selection = currentSelection(); await ensureSourceWorkspace(); sourceWorkspace.selectExport(selection); }) }, [siteText('現在の UI を追加')]),
        h('button', { type: 'button', class: 'btn', 'data-pack-export-action': 'plan', disabled: ws.busy || packExportSettings.state.loading || !ws.selections.length, onClick: () => invoke(() => sourceWorkspace.export('plan', packExportSettings.options())) }, [siteText('依存範囲を検査')]),
        h('button', { type: 'button', class: 'btn btn-primary', 'data-pack-export-action': 'zip', disabled: ws.busy || packExportSettings.state.loading || !ws.selections.length, onClick: () => invoke(async () => {
          const blob = await sourceWorkspace.export('zip', packExportSettings.options());
          downloadBlobFile({ filename: `jsonui_selected_${makeSafeFileTimestamp()}.mcpack`, blob });
          setStatus(siteText('選択した UI と必要な依存ファイルを書き出しました。'));
        }) }, [siteText('リソースパックを保存')]),
      ]),
      h('ul', {}, ws.selections.map((item, index) => {
        const kind = workspaceSources().find(source => source.id === item.sourceId)?.kind;
        const origin = kind === 'vanilla' ? siteText('バニラ') : kind === 'imported' ? siteText('通常パック') : siteText('選択したパック');
        return h('li', {}, [`${origin} · ${item.filePath} # ${item.rawKey || '*'}`, h('button', { type: 'button', class: 'btn btn-small', 'aria-label': siteText`${origin}の ${item.rawKey} を書出し対象から外す`, disabled: ws.busy, onClick: () => sourceWorkspace.removeExport(index) }, [siteText('外す')])]);
      })),
      renderWorkspaceExportReport(h, ws.exportPlan),
    ]),
    ws.error ? h('p', { class: 'workspace-error', role: 'alert' }, [translateSiteMessage(ws.error)]) : '',
  ]);
}
const studioLocks26 = new Map();
const studioElementCollapsed26 = new Map();
const studioPropertyDrafts26 = new Map();
function studioLockSet26(file) {
  const identity = studioSelection21(file).snapshot().identity;
  if (!studioLocks26.has(identity)) {
    if (studioLocks26.size >= 512) {
      const free = [...studioLocks26].find(([, value]) => !value.size);
      if (free) studioLocks26.delete(free[0]);
      else throw new Error('ロック設定を保持できる画面数の上限です。不要な画面のロックを解除してください。');
    }
    studioLocks26.set(identity, new Set());
  }
  return studioLocks26.get(identity);
}
function assertStudioUnlocked26(file, ids) {
  if (!file?.nodesById) return;
  const blocked = lockedMovement26(ids, file.nodesById, studioLockSet26(file));
  if (blocked) throw Object.assign(new Error(blocked.relation === 'descendant'
    ? 'このまとまりにはロック中の要素があります。左の要素一覧でロックを解除してください。'
    : 'この要素または親がロックされています。左の要素一覧でロックを解除してください。'), { code: 'EDITOR_ELEMENT_LOCKED', nodeId: blocked.id });
}
function assertStudioPendingAdditionUnlocked26(id) {
  const addition = sourceWorkspace.pendingAdditions().find(item => item.id === id);
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  const parentId = addition?.previewSelection?.nodeId;
  if (!file?.nodesById || addition?.previewSelection?.fileId !== file.id || !file.nodesById[parentId]) throw new Error('追加予定の要素と親の対応を確認できません。');
  let virtualId = `__pending_lock26_${id}`; while (file.nodesById[virtualId]) virtualId += '_';
  const blocked = lockedMovement26([virtualId], { ...file.nodesById, [virtualId]: { parentId, children: [] } }, studioLockSet26(file));
  if (blocked) throw Object.assign(new Error('追加予定の要素の親がロックされています。要素一覧で解除してください。'), { code: 'EDITOR_ELEMENT_LOCKED' });
}
function studioToggleLock26(nodeId = null) {
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  if (!file?.nodesById) return;
  const selected = nodeId ? [nodeId] : studioSelection21(file).snapshot().selectedIds;
  if (!selected.length) { setStatus('ロックする要素を左の一覧で選んでください。'); return; }
  const locks = studioLockSet26(file), remove = selected.every(id => locks.has(id));
  for (const id of selected) { if (remove) locks.delete(id); else locks.add(id); }
  requestCanvasTextureRedraw(); safeRender();
  setStatus(remove ? '要素のロックを解除しました。' : '要素をロックしました。このブラウザーの作業中は誤操作を防ぎます。');
}
async function studioArrange26(direction) {
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  if (sourceWorkspace.state.mode !== 'edit' || !file?.nodesById) return;
  const ids = studioSelection21(file).snapshot().selectedIds;
  if (ids.length !== 1) throw new Error('重なり順を変更する要素を1つ選んでください。');
  assertStudioUnlocked26(file, ids);
  const id = ids[0], cs = getCanvasState(getCanvasKey(file.id));
  const pending = sourceWorkspace.pendingNodeTransforms(file.id).get(id);
  const properties = { ...file.nodesById[id]?.props, ...pending?.properties };
  const plan = planLayerMove26({ nodeId: id, nodesById: file.nodesById, boxes: studioPaintLayout21(cs, file).boxes, direction, properties });
  if (!plan) { setStatus(direction === 'front' ? '同じ親の中では既に最前面です。' : '同じ親の中では既に最背面です。'); return; }
  await selectSourceForCanvasNode(file, id, { plan: false });
  assertStudioUnlocked26(file, ids);
  await sourceWorkspace.editPreviewProperty('layer', plan.value);
  requestCanvasTextureRedraw(); safeRender();
  setStatus('重なり順を変更しました。「JSON UIに確定」で原文へ反映します。');
}
function studioNodeLabel26(node, id) {
  return String(node?.key?.local_name || node?.name || node?.rawKey || id?.split('/').at(-1) || '要素');
}
function renderStudioNavigation26(state) {
  const file = state.files.byId[state.files.currentFileId];
  const nav = h('div', { class: 'studio-navigation26' }, [
    h('div', { class: 'studio-navigation-tabs26', role: 'group', 'aria-label': '一覧の種類' }, [
      ...[['screens', '画面を選ぶ'], ['elements', '要素と重なり']].map(([id, label]) => h('button', { type: 'button', class: 'btn', 'aria-pressed': String(studioUi.leftView26 === id), disabled: id === 'elements' && !file, onClick: () => { studioUi.leftView26 = id; safeRender(); } }, [label])),
    ]),
  ]);
  if (studioUi.leftView26 === 'advanced') { nav.append(renderEditorTreePanel(state)); return nav; }
  if (studioUi.leftView26 !== 'elements' || !file?.nodesById) { nav.append(renderPackImportSection(state.pack)); return nav; }
  const selection = studioSelection21(file).snapshot(), locked = studioLockSet26(file);
  const identity = selection.identity;
  let collapsed = studioElementCollapsed26.get(identity);
  if (!collapsed) { if (studioElementCollapsed26.size >= 512) studioElementCollapsed26.delete(studioElementCollapsed26.keys().next().value); collapsed = new Set(); studioElementCollapsed26.set(identity, collapsed); }
  const nodes = file.nodesById, children = new Map(), childIds = new Set();
  for (const [id, node] of Object.entries(nodes)) {
    const ids = (node.children || []).map(child => typeof child === 'string' ? child : child?.id).filter(id => nodes[id]);
    children.set(id, ids); for (const child of ids) childIds.add(child);
  }
  const rows = [], visited = new Set(), search = studioUi.elementQuery26.trim().toLocaleLowerCase();
  const stack = Object.keys(nodes).filter(id => !childIds.has(id)).reverse().map(id => ({ id, depth: 0 }));
  while (stack.length && visited.size < 50000) {
    const row = stack.pop(); if (visited.has(row.id)) continue; visited.add(row.id);
    const node = nodes[row.id], label = studioNodeLabel26(node, row.id), root = node.isFileRoot || row.id === file.uiModel?.root?.id;
    if (!root && (!search || `${row.id} ${label} ${node.type || ''}`.toLocaleLowerCase().includes(search))) rows.push({ ...row, label, node });
    if (search || root || !collapsed.has(row.id)) for (const id of [...(children.get(row.id) || [])].reverse()) stack.push({ id, depth: root ? row.depth : row.depth + 1 });
  }
  const pageSize = 80, pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  studioUi.elementPage26 = Math.max(0, Math.min(studioUi.elementPage26, pageCount - 1));
  nav.append(h('div', { class: 'studio-elements-heading26' }, [h('strong', {}, [file.meta?.selectedDefinition?.definition || file.path]), h('p', { class: 'hint' }, ['階層は親子関係です。重なり順は「最前面へ・最背面へ」で変更します。'])]));
  let searchTimer;
  nav.append(h('input', { id: 'studio-elements-search26', type: 'search', class: 'workspace-picker-search', value: studioUi.elementQuery26, placeholder: '要素の名前で検索', 'aria-label': '要素の名前で検索', onInput: event => { studioUi.elementQuery26 = event.currentTarget.value; studioUi.elementPage26 = 0; clearTimeout(searchTimer); searchTimer = setTimeout(() => { safeRender(); requestAnimationFrame(() => document.getElementById('studio-elements-search26')?.focus()); }, 180); } }, []));
  nav.append(h('ul', { class: 'studio-elements26', 'aria-label': '表示中のUIの要素' }, rows.slice(studioUi.elementPage26 * pageSize, (studioUi.elementPage26 + 1) * pageSize).map(row => h('li', { class: `studio-element-row26${selection.selectedIds.includes(row.id) ? ' is-selected' : ''}`, style: `--element-depth:${Math.min(12, row.depth)}`, 'data-node-id': row.id }, [
    h('button', { id: `studio-element-toggle26-${row.id}`, type: 'button', class: 'studio-element-toggle26', disabled: !children.get(row.id)?.length, 'aria-label': `${row.label}の子要素を${collapsed.has(row.id) ? '開く' : '畳む'}`, 'aria-expanded': children.get(row.id)?.length ? String(!collapsed.has(row.id)) : null, onClick: () => { if (collapsed.has(row.id)) collapsed.delete(row.id); else collapsed.add(row.id); safeRender(); } }, [children.get(row.id)?.length ? collapsed.has(row.id) ? '▸' : '▾' : '·']),
    h('button', { id: `studio-element-select26-${row.id}`, type: 'button', class: 'studio-element-select26', title: `${row.label}\n${row.node.type || ''}\n${row.id}`, 'aria-pressed': String(selection.selectedIds.includes(row.id)), onClick: event => { studioSelection21(file).select(row.id, { single: true, toggle: event.shiftKey || event.ctrlKey || event.metaKey }); if (sourceWorkspace.state.mode === 'edit') syncStudioSourceSelection21(file, row.id); else store.dispatch(actions.selectNode(row.id)); studioUi.rightOpen = true; requestCanvasTextureRedraw(); safeRender(); } }, [h('span', {}, [row.label]), h('small', {}, [String(row.node.type || '')])]),
    h('button', { id: `studio-element-lock26-${row.id}`, type: 'button', class: 'studio-element-lock26', 'aria-label': `${row.label}の${locked.has(row.id) ? 'ロックを解除' : '位置とサイズをロック'}`, 'aria-pressed': String(locked.has(row.id)), title: '編集画面での誤操作を防ぎます。パックには保存されません。', onClick: () => studioInvoke(() => studioToggleLock26(row.id)) }, [locked.has(row.id) ? '鍵' : '○']),
  ]))));
  nav.append(h('div', { class: 'studio-element-pages26' }, [h('span', {}, [`${rows.length} 要素 · ${studioUi.elementPage26 + 1} / ${pageCount}`]), h('button', { type: 'button', class: 'btn', disabled: !studioUi.elementPage26, onClick: () => { studioUi.elementPage26--; safeRender(); } }, ['前へ']), h('button', { type: 'button', class: 'btn', disabled: studioUi.elementPage26 + 1 >= pageCount, onClick: () => { studioUi.elementPage26++; safeRender(); } }, ['次へ'])]));
  return nav;
}
function renderStudioProperties26(file) {
  const ids = file?.nodesById ? studioSelection21(file).snapshot().selectedIds : [];
  if (ids.length !== 1) return h('section', { class: 'studio-properties26' }, [h('h3', {}, ['プロパティ']), h('p', { class: 'hint' }, [ids.length ? `${ids.length}要素を選択中です。位置の数値編集は要素を1つ選択してください。` : 'キャンバスまたは左の要素一覧で編集する要素を選択してください。'])]);
  const id = ids[0], ws = sourceWorkspace.state, policy = captureGeometryPolicy29(ws);
  let targetId = id;
  if (ws.editTargetMode === 'interaction') {
    const selected = ws.previewSelection, plan = ws.editPlan;
    let targets = [];
    if (selected?.nodeId === id && selected.fileId === file.id && plan?.targetMode === 'interaction' && !ws.editPlanBusy) {
      try { targets = resolvePlannedPreviewNodeIds22(buildWorkspacePreviewSourceMap(file), plan); } catch { /* 古い対応表を数値欄へ流用しない */ }
    }
    if (targets.length !== 1 || !file.nodesById[targets[0]]) return h('section', { class: 'studio-properties26' }, [
      h('h3', {}, [siteText('Minecraft側の操作要素全体')]),
      h('p', { class: 'hint' }, [siteText('数値は実際に変更する操作本体の位置・サイズです。先に対象を確認してください。')]),
      h('button', { type: 'button', class: 'btn', disabled: ws.busy || ws.editPlanBusy, onClick: () => studioInvoke(async () => {
        assertGeometryPolicy29(ws, policy);
        await selectSourceForCanvasNode(file, id, { plan: false });
        assertGeometryPolicy29(ws, policy);
        await sourceWorkspace.planPreviewEdit({ type: 'set', property: 'offset' }); safeRender();
      }) }, [siteText('操作本体を確認')]),
    ]);
    targetId = targets[0];
  }
  const node = file.nodesById[targetId], locked = lockedMovement26([targetId], file.nodesById, studioLockSet26(file));
  const change = sourceWorkspace.pendingNodeTransforms(file.id).get(targetId), props = { ...node.props, ...change?.properties };
  const disabled = Boolean(locked || ws.busy || ws.pendingCommitUncertain || ws.pendingConflict);
  const sections = [h('h3', {}, [studioNodeLabel26(node, targetId)]), h('p', { class: 'hint' }, [locked ? 'ロック中です。要素一覧の鍵で解除できます。'
    : ws.editTargetMode === 'interaction' ? siteText('Minecraft用の操作本体を変更します。サイトの動作確認ON/OFFとは別の設定です。')
      : siteText('選択した部品自身の位置・サイズを変更します。画像だけを動かす場合は画像を選択してください。')])];
  for (const [property, label, names] of [['offset', '位置', ['横位置', '縦位置']], ['size', 'サイズ', ['幅', '高さ']]]) {
    const original = props[property] ?? (property === 'offset' ? [0, 0] : null);
    const absolute = Array.isArray(original) && original.length === 2 && original.every(value => typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/u.test(value.trim()));
    if (!absolute) { sections.push(h('p', { class: 'hint' }, [`${label}には比率・変数・計算式を使用中です。「属性を詳しく編集」で設定を確認できます。`])); continue; }
    const values = original.map(value => typeof value === 'number' ? value : Number(value.trim().replace(/px$/u, '')));
    if (property === 'offset') { values[0] += change?.dx || 0; values[1] += change?.dy || 0; }
    const key = JSON.stringify([file.id, id, targetId, policy, ws.revision, ws.pendingVersion, property]);
    if (!studioPropertyDrafts26.has(key)) { if (studioPropertyDrafts26.size >= 256) studioPropertyDrafts26.delete(studioPropertyDrafts26.keys().next().value); studioPropertyDrafts26.set(key, values.map(String)); }
    const draft = studioPropertyDrafts26.get(key);
    const fields = names.map((name, index) => h('label', {}, [name, h('span', {}, [h('input', { id: `studio-geometry26-${property}-${index}`, type: 'number', step: 'any', min: property === 'size' ? 0 : null, value: draft[index], disabled, 'aria-label': name, onInput: event => { draft[index] = event.currentTarget.value; } }, []), ' px'])]));
    sections.push(h('fieldset', { class: 'studio-geometry26', disabled }, [h('legend', {}, [label]), ...fields, h('button', { type: 'button', class: 'btn', onClick: () => studioInvoke(async () => {
      if (draft.some(value => !value.trim()) || !draft.map(Number).every(Number.isFinite) || property === 'size' && draft.map(Number).some(value => value < 0)) throw new Error(`${label}には${property === 'size' ? '0以上の' : ''}数値を入力してください。`);
      assertGeometryPolicy29(sourceWorkspace.state, policy);
      assertStudioUnlocked26(file, [targetId]);
      await selectSourceForCanvasNode(file, id, { plan: false });
      assertGeometryPolicy29(sourceWorkspace.state, policy);
      assertStudioUnlocked26(file, [targetId]);
      await sourceWorkspace.editPreviewProperty(property, draft.map(Number));
      requestCanvasTextureRedraw(); safeRender();
    }) }, [`${label}を変更`])]));
  }
  sections.push(h('div', { class: 'studio-arrange26' }, [h('button', { type: 'button', class: 'btn', onClick: () => studioToggleLock26(id) }, [studioLockSet26(file).has(id) ? 'ロックを解除' : '位置とサイズをロック']), h('button', { type: 'button', class: 'btn', disabled, onClick: () => studioInvoke(() => studioArrange26('front')) }, ['最前面へ']), h('button', { type: 'button', class: 'btn', disabled, onClick: () => studioInvoke(() => studioArrange26('back')) }, ['最背面へ'])]));
  sections.push(h('p', { class: 'hint' }, ['重なりは同じ親の要素に対して変更します。ロックはこのブラウザーの作業中だけ有効です。']));
  return h('section', { class: 'studio-properties26' }, sections);
}

const studioAppearanceDrafts35 = new Map();
function renderStudioAppearancePanel35(file) {
  const ids = file?.nodesById ? studioSelection21(file).snapshot().selectedIds : [];
  if (ids.length !== 1) return '';
  const id = ids[0], node = file.nodesById[id], ws = sourceWorkspace.state;
  if (!['label', 'image'].includes(node?.type)) return '';
  const property = node.type === 'label' ? 'text' : 'texture';
  const props = { ...node.props, ...sourceWorkspace.pendingNodeTransforms(file.id).get(id)?.properties };
  const value = props[property] ?? '';
  if (typeof value !== 'string') return '';
  const policy = captureGeometryPolicy29(ws), key = JSON.stringify([file.id, id, ws.revision, ws.pendingVersion, property]);
  if (!studioAppearanceDrafts35.has(key)) {
    if (studioAppearanceDrafts35.size >= 128) studioAppearanceDrafts35.delete(studioAppearanceDrafts35.keys().next().value);
    studioAppearanceDrafts35.set(key, { value });
  }
  return renderStudioAppearance35(h, { type: node.type, value, draft: studioAppearanceDrafts35.get(key),
    disabled: ws.busy || ws.pendingCommitUncertain || ws.pendingConflict || Boolean(lockedMovement26([id], file.nodesById, studioLockSet26(file))),
    suggestions: property === 'texture' ? textureSuggestions35([importedPackRuntime?.assetIndex, vanillaReferenceRuntime?.assetIndex]) : [],
    onApply: (name, nextValue) => studioInvoke(async () => {
      if (name !== property || typeof nextValue !== 'string') throw new Error('WORKSPACE_PROPERTY_INVALID');
      if (nextValue === value) return;
      assertGeometryPolicy29(ws, policy); assertStudioUnlocked26(file, [id]);
      const current = store.getState().files.byId[store.getState().files.currentFileId];
      if (current?.uiModel !== file.uiModel) throw new Error('WORKSPACE_LAYOUT_CHANGED');
      if (name === 'texture' && nextValue && !/^[($#]/u.test(nextValue) && !resolveTextureRef(nextValue, { importedIndex: importedPackRuntime?.assetIndex, vanillaIndex: vanillaReferenceRuntime?.assetIndex })?.resolved) {
        throw Object.assign(new Error('このテクスチャが読み込んだパック内にありません。パスと参照パックを確認してください。'), { code: 'WORKSPACE_TEXTURE_NOT_FOUND' });
      }
      await selectSourceForCanvasNode(file, id, { plan: false });
      assertGeometryPolicy29(ws, policy); assertStudioUnlocked26(file, [id]);
      await sourceWorkspace.editPreviewProperty(name, nextValue);
      requestCanvasTextureRedraw(); safeRender();
    }),
  }) || '';
}

function renderSourceWorkspaceInspector() {
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  const cs = getCanvasState(getCanvasKey(file?.id));
  if (cs.pendingAdditionSelection23) {
    const panel = renderWorkspaceDraftControls23(h, { controller: sourceWorkspace, selectionId: cs.pendingAdditionSelection23,
      onUpdate: () => { requestCanvasTextureRedraw(); safeRender(); }, onError: reportWorkspaceError,
      onBack: () => { cs.pendingAdditionSelection23 = null; safeRender(); } });
    if (panel) return panel;
  }
  const selection = sourceWorkspace.state.previewSelection;
  const previewNode = selection?.fileId === file?.id && selection?.pointer === sourceWorkspace.state.selectedPointer
    && matchesWorkspaceDocument(selection, sourceWorkspace.state.activePath, sourceWorkspace.state.activeSourceId)
    ? findUiNodeById(file.uiModel?.root, selection.nodeId) : null;
  const raw = renderWorkspaceSourceEditor(h, {
    controller: sourceWorkspace, onSelectNode: selectPreviewForSource, onError: reportWorkspaceError,
    previewProperties: previewNode ? { ...previewNode.props, ...previewNode.unknownProps, bindings: previewNode.bindings } : null,
    renderPicker: options => {
      if (!workspacePickerStates.has(options.id)) workspacePickerStates.set(options.id, { query: '', page: 0 });
      return renderWorkspacePicker(h, { ...options, state: workspacePickerStates.get(options.id) });
    },
  });
  if (studioUi.rightView === 'source') return raw;
  return h('div', { class: 'studio-inspector26' }, [renderStudioProperties26(file), renderStudioAppearancePanel35(file), studioDetails(h, { id: 'studio-properties-advanced26', label: '属性を詳しく編集', state: studioUi.details }, [raw])]);
}

const editorSelection21 = createEditorSelection21({ maxScreens: 512, evictUnmodified: true });
function studioSelection21(file = store.getState().files.byId[store.getState().files.currentFileId]) {
  if (!file?.nodesById) return editorSelection21;
  const definition = file.meta?.selectedDefinition;
  const identity = JSON.stringify([workspaceSources().map(source => [source.kind,source.id]), file.path,
    definition?.qualifiedName || definition?.definition || '']);
  editorSelection21.useScreen(identity, { ...file, rootId: file.uiModel?.root?.id || 'root' });
  return editorSelection21;
}
function syncStudioSourceSelection21(file, preferredId = null) {
  if(file?.id)getCanvasState(getCanvasKey(file.id)).pendingAdditionSelection23=null;
  const snapshot = studioSelection21(file).snapshot();
  const primary = snapshot.selectedIds.includes(String(preferredId)) ? String(preferredId) : snapshot.selectedIds.at(-1);
  // 原文の遅延選択・削除予定を先に失効させ、以前の対象を次の操作へ残さない。
  sourceWorkspace.selectPointer('');
  if (!primary) store.dispatch(actions.clearSelection());
  else store.dispatch(actions.selectNode(primary));
  // 複数選択は移動とグループ操作に使う。単一属性・削除の対象は右クリックで明示する。
  if (snapshot.selectedIds.length === 1 && sourceNodeForPreview(file, primary)) {
    void selectSourceForCanvasNode(file, primary, { plan: false }).catch(error => {
      if (!['WORKSPACE_READ_SUPERSEDED', 'WORKSPACE_SELECTION_SUPERSEDED'].includes(error?.code)) reportWorkspaceError(error);
    });
  }
  syncStudioSelectionUi21(snapshot);
}
function clearStudioSelection21(file) {
  if (file?.nodesById) studioSelection21(file).setSelection([]);
  sourceWorkspace.selectPointer('');
  store.dispatch(actions.clearSelection());
}
async function studioDelete31() {
  const state=store.getState(), file=state.files.byId[state.files.currentFileId], ws=sourceWorkspace.state;
  if (!file || ws.mode!=='edit' || ws.busy) return;
  const cs=getCanvasState(getCanvasKey(file.id));
  if (cs.pendingAdditionSelection23) {
    assertStudioPendingAdditionUnlocked26(cs.pendingAdditionSelection23);
    const result=sourceWorkspace.editPendingAddition(cs.pendingAdditionSelection23,{type:'delete'});
    cs.pendingAdditionSelection23=null;requestCanvasTextureRedraw();safeRender();return result;
  }
  const ids=studioSelection21(file).snapshot().selectedIds;
  if(ids.length!==1)throw new Error('削除する要素を1つ選択してください。親要素を選ぶと子要素もまとめて削除できます。');
  assertStudioUnlocked26(file,ids);
  await selectSourceForCanvasNode(file,ids[0],{plan:false});
  await (ws.editScope==='screen' ? sourceWorkspace.planScreenDelete31() : sourceWorkspace.planDelete());
  const result=await sourceWorkspace.confirmDelete();
  requestCanvasTextureRedraw();safeRender();return result;
}
function studioGroupSelection21() { return commandSystem.execute('editor.group', getCommandContext()); }
function studioUngroupSelection21() { return commandSystem.execute('editor.ungroup', getCommandContext()); }
function performStudioGroup31() { studioSelection21().groupSelected({ name: 'グループ' }); syncStudioSourceSelection21(store.getState().files.byId[store.getState().files.currentFileId]); requestCanvasTextureRedraw(); safeRender(); }
function performStudioUngroup31() { studioSelection21().ungroupSelected(); syncStudioSourceSelection21(store.getState().files.byId[store.getState().files.currentFileId]); requestCanvasTextureRedraw(); safeRender(); }
function syncStudioSelectionUi21(snapshot) {
  const editing = sourceWorkspace.state.mode === 'edit';
  for (const [id, key] of [['studio-group','canGroup'],['studio-ungroup','canUngroup'],['studio-group-undo','canUndoGroup'],['studio-group-redo','canRedoGroup']]) {
    const button = document.getElementById(id);
    if (button) button.disabled = !editing || !snapshot[key];
  }
}
function studioGroupHistory21(direction) {
  const selection = studioSelection21();
  if (direction === 'redo') selection.redoGroup(); else selection.undoGroup();
  syncStudioSourceSelection21(store.getState().files.byId[store.getState().files.currentFileId]);
  requestCanvasTextureRedraw(); safeRender();
}
function studioGroupFileSnapshot21() {
  const state = store.getState();
  const file = state.files.byId[state.files.currentFileId];
  if (!file?.meta?.previewProjection || !file.nodesById) {
    throw new Error('グループ設定を保存・読込する UI を選択してください。');
  }
  const selection = studioSelection21(file);
  const identity = selection.snapshot().identity;
  const metadata = selection.exportMetadata();
  const metadataText = JSON.stringify(metadata);
  const sourceKey = workspaceSourceKey();
  const nodesById = file.nodesById;
  const options = {
    file, identity, metadata, path: file.path,
    qualifiedName: file.meta.selectedDefinition?.qualifiedName,
    packContext: groupPackContext21({ vanilla: vanillaReferenceRuntime, imported: importedPackRuntime }),
    maxScreens: 512,
  };
  return {
    options,
    assertCurrent() {
      const current = store.getState();
      const active = current.files.byId[current.files.currentFileId];
      if (active !== file || active?.nodesById !== nodesById
        || workspaceSourceKey() !== sourceKey
        || selection.snapshot().identity !== identity
        || JSON.stringify(selection.exportMetadata()) !== metadataText) {
        throw new Error('処理中に UI・パック・グループ設定が変更されました。もう一度操作してください。');
      }
    },
  };
}

async function studioSaveGroups21() {
  const snapshot = studioGroupFileSnapshot21();
  const text = await exportCurrentScreenGroups21(snapshot.options);
  snapshot.assertCurrent();
  downloadTextFile({ filename: `jsonui_groups_${makeSafeFileTimestamp()}.json`, text });
}

async function studioLoadGroups21(input) {
  const chosen = input.files?.[0];
  try {
    if (!chosen) return;
    if (chosen.size > GROUP_FILE_MAX_BYTES21) throw new Error('グループ設定は 1 MiB 以下の JSON を指定してください。');
    const snapshot = studioGroupFileSnapshot21();
    const text = await chosen.text();
    snapshot.assertCurrent();
    const metadata = await mergeCurrentScreenGroups21({ ...snapshot.options, text });
    snapshot.assertCurrent();
    editorSelection21.importMetadata(metadata);
    studioSelection21(); syncStudioSourceSelection21(store.getState().files.byId[store.getState().files.currentFileId]); requestCanvasTextureRedraw(); safeRender();
    setStatus('現在の UI のグループ設定を読み込みました。');
  } finally {
    input.value = '';
  }
}
function studioPaintLayout21(cs, file, transforms = sourceWorkspace.pendingNodeTransforms?.(file?.id) || new Map()) {
  const draftScene = studioDraftScene23(cs, file);
  if (draftScene) return draftScene.layout;
  const version = sourceWorkspace.state.pendingVersion;
  const cached = cs.pendingPaintLayout21;
  if (cached?.layout === cs.layout && cached.version === version
    && cached.nodesById === file?.nodesById && cached.propsByIdOverride === cs.propsByIdOverride) return cached.result;
  let result;
  try {
    result = applyPendingLayout21(cs.layout, transforms, {
      nodesById: file?.nodesById,
      propsByIdOverride: cs.propsByIdOverride,
    });
  } catch (error) {
    const warningKey = `${version}:${error?.code || 'EDITOR_DRAFT_LAYOUT_FAILED'}`;
    if (cs.pendingLayoutWarning21 !== warningKey) {
      cs.pendingLayoutWarning21 = warningKey;
      diagnostics.log('warn', siteText('未反映の仮配置を表示できません。確定済みの配置を保持しています。変更内容を確認してください。'), {
        source: 'source-workspace', data: { code: error?.code || 'EDITOR_DRAFT_LAYOUT_FAILED', reason: String(error?.message || error) },
      });
    }
    result = cs.layout;
  }
  cs.pendingPaintLayout21 = { layout: cs.layout, version, nodesById: file?.nodesById, propsByIdOverride: cs.propsByIdOverride, result };
  return result;
}
function drawStudioSelection21(canvas, cs, layout, file) {
  if (sourceWorkspace.state.mode !== 'edit' || !file?.nodesById || !layout?.boxes) return;
  const selectionSnapshot = studioSelection21(file).snapshot();
  syncStudioSelectionUi21(selectionSnapshot);
  const ids = new Set(selectionSnapshot.selectedIds);
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  if (!ctx || !rect.width || !rect.height) return;
  ctx.save(); ctx.setTransform(canvas.width / rect.width,0,0,canvas.height / rect.height,0,0);
  ctx.strokeStyle = '#85baff'; ctx.lineWidth = 1.5; ctx.setLineDash([5,3]);
  const z = cs.view.zoom || 1;
  for (const box of layout.boxes) if (ids.has(String(box.id))) {
    ctx.strokeRect((box.x-cs.view.viewX)*z, (box.y-cs.view.viewY)*z, box.w*z, box.h*z);
  }
  if (['marquee','insert'].includes(cs.interaction.mode) && cs.interaction.draftBox) {
    const box = cs.interaction.draftBox; ctx.fillStyle = '#5f9ee42b';
    ctx.fillRect((box.x-cs.view.viewX)*z, (box.y-cs.view.viewY)*z, box.w*z, box.h*z);
    ctx.strokeRect((box.x-cs.view.viewX)*z, (box.y-cs.view.viewY)*z, box.w*z, box.h*z);
  }
  ctx.restore();
}
function studioPreviewSelection21(file, nodeId) {
  const target = sourceNodeForPreview(file,nodeId);
  if (!target) throw new Error('原文を特定できない要素は移動できません。');
  const definition = file.meta?.selectedDefinition;
  const rawKey = definition?.rawKey || file.uiModel?.root?.children?.[0]?.key?.raw;
  return { ...target, fileId:file.id, nodeId, previewDefinitionId:workspacePreviewDefinitionIdentity(file), effectivePointer:target.previewPointer,
    preview:file.meta?.sourceEditPreviewOptions || undefined,
    screen:{path:file.path,pointer:`/${escapeSourcePointer(rawKey)}`,sourceId:workspacePreviewSourceId(file)} };
}
function closeStudioContextMenu21({restoreFocus=false}={}) {
  document.getElementById('studio-context-menu')?.remove(); document.getElementById('studio-context-scrim')?.remove(); studioUi.contextMenu=null;
  if(restoreFocus) document.getElementById('preview-canvas')?.focus({preventScroll:true});
}
function openStudioContextMenu21(ev, file, hitId) {
  closeStudioContextMenu21();
  const editing=sourceWorkspace.state.mode==='edit';
  const cs33=file?getCanvasState(getCanvasKey(file.id)):null;
  const pendingId33=editing&&hitId?studioDraftScene23(cs33,file)?.additionsByNodeId.get(hitId):null;
  if(pendingId33) {
    cs33.pendingAdditionSelection23=pendingId33;
    const menu=h('div',{id:'studio-context-menu',class:'studio-context-menu',role:'menu','aria-label':'追加予定の要素',style:`left:${Math.max(8,Math.min(ev.clientX,window.innerWidth-250))}px;top:${Math.max(8,Math.min(ev.clientY,window.innerHeight-160))}px;`,onKeydown:event=>{if(event.key==='Escape'){event.preventDefault();closeStudioContextMenu21({restoreFocus:true});}}},[
      h('strong',{},['追加予定の要素']),
      h('button',{type:'button',role:'menuitem',onClick:()=>{closeStudioContextMenu21();studioUi.rightOpen=true;studioUi.rightView='properties';safeRender();}},['プロパティを編集']),
      h('button',{type:'button',role:'menuitem',onClick:()=>{closeStudioContextMenu21({restoreFocus:true});studioInvoke(studioDelete31);}},['削除',h('kbd',{},['Del'])])]);
    const scrim=h('div',{id:'studio-context-scrim',class:'studio-context-scrim',onPointerdown:()=>closeStudioContextMenu21(),onContextmenu:event=>{event.preventDefault();closeStudioContextMenu21();}},[]);
    document.body.append(scrim,menu);menu.querySelector('button')?.focus();return;
  }
  if(hitId && cs33)cs33.pendingAdditionSelection23=null;
  if(hitId) { const groupSelection = studioSelection21(file); if (ev.altKey === true || !groupSelection.snapshot().selectedIds.includes(String(hitId))) groupSelection.select(hitId, { single: ev.altKey===true }); if (editing) syncStudioSourceSelection21(file, hitId); else store.dispatch(actions.selectNode(hitId)); }
  // 原文の対応がない生成表示にも、閲覧用のメニューを提供する。
  const authoredTarget = hitId ? sourceNodeForPreview(file, hitId) : null;
  const selection = authoredTarget ? studioPreviewSelection21(file, hitId) : null;
  const title = file?.nodesById?.[hitId]?.key?.local_name || file?.nodesById?.[hitId]?.name || 'プレビュー';
  const show = view => { studioUi.rightOpen=true; studioUi.rightView=view; safeRender(); };
  const action = (label, handler, disabled=false, shortcut='') => h('button',{type:'button',role:'menuitem',disabled,onClick:()=>{closeStudioContextMenu21({restoreFocus:true});studioInvoke(handler);}},[label,h('kbd',{},[shortcut])]);
  const menu=h('div',{id:'studio-context-menu',class:'studio-context-menu',role:'menu','aria-label':'要素の操作',style:`left:${Math.max(8,Math.min(ev.clientX,window.innerWidth-262))}px;top:${Math.max(8,Math.min(ev.clientY,window.innerHeight-390))}px;`,onKeydown:event=>{
    if(event.key==='Escape'){event.preventDefault();closeStudioContextMenu21({restoreFocus:true});return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const buttons=[...menu.querySelectorAll('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();
    }
    if(event.key==='Tab')closeStudioContextMenu21({restoreFocus:true});
  }},[
    h('strong',{},[title]),
    action(editing?'プロパティを編集':'プロパティを表示',async()=>{if(editing&&hitId)await selectSourceForCanvasNode(file,hitId);show('properties');},!hitId||(editing&&!selection)),
    action(editing?'原文データを編集':'原文データを表示',async()=>{if(editing&&hitId)await selectSourceForCanvasNode(file,hitId);show('source');},!hitId||(editing&&!selection)),
    action('プレビューの状態データ',()=>{studioUi.tab='data';show('data');}),
    action('継承・参照を表示',()=>show('references'),!hitId),
    ...(editing ? [
      action('この要素だけを選択',()=>{studioSelection21(file).select(hitId,{single:true});syncStudioSourceSelection21(file,hitId);requestCanvasTextureRedraw();},!hitId),
      action('グループ化',studioGroupSelection21,!studioSelection21(file).snapshot().canGroup,'Ctrl+Alt+G'),
      action('グループ解除',studioUngroupSelection21,!studioSelection21(file).snapshot().canUngroup,'Ctrl+Alt+Shift+G'),
      action('削除',async()=>{studioSelection21(file).select(hitId,{single:true});await selectSourceForCanvasNode(file,hitId,{plan:false});await studioDelete31();},!selection||sourceWorkspace.state.busy,'Del'),
      action('JSON UIに確定',()=>sourceWorkspace.applyPending(),sourceWorkspace.state.busy || sourceWorkspace.state.pendingCommitUncertain || sourceWorkspace.state.pendingConflict || sourceWorkspace.state.projectionError || !sourceWorkspace.state.pendingOperations?.length,'Ctrl+Enter'),
    ]:[]),
  ]);
  const scrim=h('div',{id:'studio-context-scrim',class:'studio-context-scrim',onPointerdown:()=>closeStudioContextMenu21(),onContextmenu:event=>{event.preventDefault();closeStudioContextMenu21();}},[]);
  document.body.append(scrim,menu);
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(ev.clientX, window.innerWidth - menuRect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(ev.clientY, window.innerHeight - menuRect.height - 8))}px`;
  studioUi.contextMenu={fileId:file?.id,nodeId:hitId};menu.querySelector('button:not(:disabled)')?.focus();
}

function studioInvoke(action) { return void Promise.resolve().then(action).catch(reportWorkspaceError); }
function studioSetTab(tab) {
  studioUi.tab = tab;
  studioUi.compactRibbon26 = false;
  if (previewViewport.active) previewViewport.showRibbon();
  if (tab === 'data' || tab === 'diagnostics') { studioUi.rightOpen = true; studioUi.rightView = tab; }
  else if (studioUi.rightView === 'data' || studioUi.rightView === 'diagnostics') studioUi.rightView = 'properties';
  safeRender();
}
function studioRuntimeChangesBlocked21() {
  const ws = sourceWorkspace.state;
  return Boolean(ws.busy || ws.pendingOperations.length || ws.pendingCommitUncertain
    || [...ws.drafts.values()].some(draft => draft.dirty || draft.invalid));
}
function studioRuntimeControlsH21(tag, attrs = {}, ...children) {
  const guarded = { ...attrs };
  const mutates = ['onInput', 'onChange', 'onClick'].some(key => typeof attrs[key] === 'function');
  if (mutates && ['button', 'input', 'select', 'textarea'].includes(tag)) {
    guarded['data-studio-runtime-control'] = attrs.disabled ? 'disabled' : 'enabled';
    guarded.disabled = Boolean(attrs.disabled || studioRuntimeChangesBlocked21());
  }
  for (const key of ['onInput', 'onChange', 'onClick']) {
    if (typeof attrs[key] !== 'function') continue;
    guarded[key] = function(event) {
      assertStudioExternalChange21('プレビュー状態の変更');
      return attrs[key].call(this, event);
    };
  }
  return h(tag, guarded, ...children);
}
function syncStudioRuntimeControls21() {
  const blocked = studioRuntimeChangesBlocked21();
  for (const control of document.querySelectorAll('[data-studio-runtime-control]')) {
    control.disabled = blocked || control.getAttribute('data-studio-runtime-control') === 'disabled';
  }
  const controls = document.getElementById('studio-runtime-mutation-controls');
  if (controls) controls.disabled = blocked;
  const note = document.getElementById('studio-runtime-lock-note');
  if (note) note.hidden = !blocked;
}
function updateStudioPendingUi() {
  syncStudioRuntimeControls21();
  const ws = sourceWorkspace.state;
  // 確認済み削除がキューへ移った後の古い確認ボタンを残さない。原文再計算は行わない。
  if (!ws.deletePlan) for (const section of document.querySelectorAll('.workspace-delete-plan')) section.remove();
  const count = ws.pendingOperations?.length || 0;
  const recovering = Boolean(ws.pendingCommitUncertain || ws.pendingConflict || ws.projectionError);
  const button = document.getElementById('studio-apply-pending');
  if (button) { button.disabled = ws.busy || recovering || !count; button.textContent = pendingApplyText(count); }
  const status = document.getElementById('studio-pending-status');
  if (status) { status.textContent = ws.pendingCommitUncertain || ws.pendingConflict ? siteText('確定内容の確認が必要です・旧草稿を保持中') : pendingPreviewText(count); status.classList.toggle('is-pending', count > 0); }
  const undo = document.getElementById('studio-undo');
  if (undo) undo.disabled = ws.busy || recovering || !(count || ws.canUndo);
  const redo = document.getElementById('studio-redo');
  if (redo) redo.disabled = ws.busy || recovering || !(ws.pendingRedoOperations?.length || ws.canRedo);
  const discard = document.getElementById('studio-discard-pending');
  if (discard) discard.disabled = ws.busy || !count;
  const retryDraft = document.getElementById('studio-recalculate-draft');
  if (retryDraft) retryDraft.disabled = ws.busy || recovering || !count;
  const scope = document.getElementById('workspace-edit-scope');
  if (scope) scope.disabled = Boolean(ws.busy || count || ws.pendingCommitUncertain);
}
function renderStudioRibbon(state) {
  const file = state.files.byId[state.files.currentFileId];
  const ws = sourceWorkspace.state, editing = ws.mode === 'edit';
  const count = ws.pendingOperations?.length || 0;
  const recovering = Boolean(ws.pendingCommitUncertain || ws.pendingConflict || ws.projectionError);
  const uncertain = Boolean(ws.pendingCommitUncertain || ws.pendingConflict);
  const draftStatus = sourceWorkspaceDraft23.getStatus();
  const selectionState = file?.nodesById ? studioSelection21(file).snapshot() : {};
  const button = (id, label, action, disabled = false, primary = false) => h('button', { id, type: 'button', class: `btn${primary ? ' btn-primary' : ''}`, disabled, onClick: () => studioInvoke(action) }, [label]);
  const group = (label, content) => studioCommandGroup(h, label, content);
  const details = (id, label, content) => studioDetails(h, { id, label, state: studioUi.details }, content);
  const quick = h('div', { class: 'studio-quickbar' }, [
    h('div', { class: 'studio-mode-buttons', role: 'group', 'aria-label': '作業モード' }, [
      button('studio-mode-preview', 'プレビュー', () => sourceWorkspace.setMode('preview'), ws.busy, !editing),
      button('studio-mode-edit', '編集', async () => { await ensureSourceWorkspace(file?.path || screenOpenState.selectedPath); sourceWorkspace.setMode('edit'); previewPlayback.pause(); hidePreviewEditBoxOverlay('source-edit-mode'); studioUi.tab = 'edit'; studioUi.leftView26 = 'elements'; studioUi.rightOpen = true; safeRender(); }, ws.busy || (!importedPackRuntime && !vanillaReferenceRuntime), editing),
    ]),
    button('studio-undo', '元に戻す', () => sourceWorkspace.history('undo'), ws.busy || recovering || !(count || ws.canUndo)),
    button('studio-redo', 'やり直す', () => sourceWorkspace.history('redo'), ws.busy || recovering || !(ws.pendingRedoOperations?.length || ws.canRedo)),
    h('div', { class: 'studio-pending-stack' }, [
      h('span', { id: 'studio-pending-status', class: `studio-pending-status${count ? ' is-pending' : ''}`, role: 'status', title: '配置は操作直後からプレビューに表示されます。「JSON UIに確定」はパック原文へ変更を書き込む操作です。' }, [uncertain ? siteText('確定内容の確認が必要です・旧草稿を保持中') : pendingPreviewText(count)]),
      h('span', { id: 'studio-draft-status23', class: 'studio-draft-status', role: 'status' }, [recovering ? siteText('草稿の再計算を停止しています。確定内容を確認してください。') : draftStatus.status === 'error' ? draftStatus.error?.message : count ? draftStatus.status === 'ready' ? 'プレビュー更新済み' : 'プレビューを更新中…' : '']),
    ]),
    details('studio-undo-more', '変更の管理', [button('studio-recalculate-draft', '草稿プレビューを再計算', () => sourceWorkspaceDraft23.flush(), ws.busy || recovering || !count), button('studio-discard-pending', '未確定の変更を破棄', () => { sourceWorkspace.discardPending(); safeRender(); }, ws.busy || !count), h('p', { class: 'hint' }, [uncertain
      ? siteText('破棄するのはブラウザーが保持する旧草稿だけです。Nodeで確定済みの変更は取り消しません。先に確定済みの内容を確認してください。')
      : siteText('プレビューが更新されない場合は再計算できます。破棄すると、JSON UIに確定する前の配置へ戻ります。')])]),
    button('studio-apply-pending', pendingApplyText(count), async () => { await sourceWorkspace.applyPending(); safeRender(); }, ws.busy || recovering || !count, true),
    button('studio-layout-restore28', '配置を戻す', () => { applyStudioLayout28(studioUi, 'restore', window.innerWidth); safeRender(); }, !studioUi.layoutRestore28),
    button('studio-quick-debug28', 'ログ保存', downloadCompleteDebugBundle),
  ]);
  const recoveryNotice = uncertain ? h('div', { id: 'studio-commit-recovery', class: 'workspace-error', role: 'alert' }, [
    h('p', {}, [ws.pendingCommitUncertain
      ? siteText('前回の確定結果が不明です。Nodeで確定済みの可能性があるため、同じ変更は再送しません。')
      : siteText('確定内容との競合があります。旧草稿を再送せず、現在の確定内容を確認してください。')]),
    button('studio-check-committed', siteText('確定済みの内容を確認'), () => sourceWorkspace.refresh(), ws.busy || !ws.workspaceId),
    h('p', { class: 'hint' }, [siteText('確認では草稿を保持したまま、Nodeの現在の原文とプレビューを取得します。内容を確認後、「変更の管理」→「未確定の変更を破棄」で旧草稿を除きます。これは確定済みの変更の取り消しではありません。')]),
  ]) : '';
  const tabs = [['home', 'ファイル'], ['edit', '編集'], ['insert', '挿入'], ['view', '表示'], ['data', '詳細'], ['export', '書き出し'], ['diagnostics', 'ログ']];
  const tabbar = renderStudioTabs(h, { tabs, selected: studioUi.tab, onSelect: studioSetTab,
    focusTab: id => requestAnimationFrame(() => document.getElementById(`studio-tab-${id}`)?.focus()) });
  let content;
  if (studioUi.tab === 'home') content = [
    group('ファイルとUI', [button('studio-toggle-files', studioUi.leftOpen ? '一覧を隠す' : 'UI一覧', () => toggleLeftPanel()), button('studio-search-files', 'UIを検索', () => focusStudioNavigation23({ select: true }))]),
    group('作業領域', [renderStudioLayoutTools28(h, preset => { applyStudioLayout28(studioUi, preset, window.innerWidth); safeRender(); })]),
    group('プレビュー', [button('studio-fit-canvas', '画面に合わせる', () => fitCanvasUiView(getCanvasKey(file?.id)), !file)]),
    details('studio-home-advanced', '詳細ツール', [button('studio-open-tree', workspaceNavigationState.detailedEditor ? 'パック一覧に戻る' : '要素ツリーを開く', () => { workspaceNavigationState.detailedEditor = !workspaceNavigationState.detailedEditor; studioUi.leftView26 = workspaceNavigationState.detailedEditor ? 'advanced' : 'screens'; studioUi.leftOpen = true; if (window.innerWidth <= 900) studioUi.rightOpen = false; safeRender(); }), button('studio-search-elements', 'UI内の要素を検索', () => focusTreeSearchInput({ select: true }), !file), h('p', { class: 'hint' }, ['要素ツリーには検索と詳細情報があります。解決済みプレビューの原文編集は右側の「原文」から行います。'])]),
    details('studio-home-help', '操作ガイド', [h('p', { class: 'studio-ribbon-help' }, [editing ? 'Shift＋クリックで複数選択。Alt＋クリックでグループ内を単体選択、Alt＋ドラッグで画面を移動します。右クリックで要素の操作を開きます。' : '左の一覧でファイルとUI定義を選び、「選択したUIをプレビュー」を押します。編集したいときは上の「編集」に切り替えます。']), h('a', { href: '#/help' }, ['詳しい使い方・コマンドモード'])]),
  ];
  else if (studioUi.tab === 'edit') content = [
    group('選択', [button('studio-range-select', studioUi.rangeSelecting ? '範囲選択中' : '範囲を選択', () => { studioUi.rangeSelecting = !studioUi.rangeSelecting; safeRender(); }, !editing || !file), button('studio-group', 'グループ化', studioGroupSelection21, !editing || !selectionState.canGroup), button('studio-ungroup', 'グループ解除', studioUngroupSelection21, !editing || !selectionState.canUngroup)]),
    details('studio-group-more', 'グループ設定', [button('studio-group-undo', 'グループ設定を戻す', () => studioGroupHistory21('undo'), !editing || !selectionState.canUndoGroup), button('studio-group-redo', 'グループ設定をやり直す', () => studioGroupHistory21('redo'), !editing || !selectionState.canRedoGroup), button('studio-save-groups', '設定を保存', studioSaveGroups21, !file), button('studio-load-groups', '設定を読み込む', () => document.getElementById('studio-group-file').click(), !editing || !file), h('input', { id: 'studio-group-file', type: 'file', accept: '.json,application/json', hidden: true, onChange: event => { const input = event.currentTarget; studioInvoke(() => studioLoadGroups21(input)); } }, [])]),
    group('重なりと保護', [button('studio-lock26', 'ロック切替', () => studioToggleLock26(), !editing || !file), button('studio-front26', '最前面へ', () => studioArrange26('front'), !editing || !file || ws.busy), button('studio-back26', '最背面へ', () => studioArrange26('back'), !editing || !file || ws.busy)]),
    group('要素', [button('studio-show-properties', 'プロパティ', () => { studioUi.rightOpen = true; studioUi.rightView = 'properties'; safeRender(); }),
      button('studio-show-source', '原文データ', () => { studioUi.rightOpen = true; studioUi.rightView = 'source'; safeRender(); })]),
    group('編集操作', [button('studio-insert-open35', '要素を挿入', () => studioSetTab('insert'), !editing || !file),
      button('studio-delete', '削除', studioDelete31, ws.busy || !editing || !ws.selectedPointer || recovering)]),
    details('studio-edit-options35', '削除の詳細設定', [h('label',{for:'workspace-delete-unit32'},['削除単位 ',h('select',{id:'workspace-delete-unit32',value:ws.deleteUnit32||'selected',disabled:ws.busy||!editing||ws.editScope!=='screen',
        onChange:event=>{ws.deleteUnit32=event.currentTarget.value;ws.deletePlan=null;safeRender();}},[['selected','選択した部品だけ'],['functional','機能単位全体']].map(([value,label])=>h('option',{value,selected:(ws.deleteUnit32||'selected')===value?'selected':null},[label])))])]),
    h('p', { class: 'studio-edit-hint35' }, ['右クリック / Del：削除　　枠のハンドル：サイズ変更　　Shift：縦横比を維持　　Ctrl+Z：元に戻す']),
    details('studio-edit-advanced28', '適用範囲・詳細', [renderWorkspaceEditPolicy(h, { controller: sourceWorkspace, onError: reportWorkspaceError })]),
  ];
  else if (studioUi.tab === 'insert') content = [renderStudioInsert35(h, {
    type: ws.addType || '', disabled: ws.busy || !editing || !file || recovering,
    prerequisite: !file ? '左の一覧でUIを選び、「選択したUIをプレビュー」を押してください。' : !editing ? '上部の作業モードで「編集」に切り替えてから、挿入する要素を選びます。' : recovering ? '確定内容を確認してから挿入できます。' : ws.busy ? '現在の処理が終わると挿入できます。' : '',
    onChoose: type => { setAddType32(ws, type); safeRender(); },
    onCancel: () => { setAddType32(ws, ''); safeRender(); },
    parentLabel: ws.addType ? describeInsertionParent32(file) : '',
    status: ws.addStatus32?.status === 'rejected' ? ws.addStatus32.message : '',
    advanced: details('studio-insert-options35', '追加先・詳細設定', [h('label', {for:'workspace-add-type'}, ['追加 ', h('select', { id:'workspace-add-type',value:ws.addType||'',disabled:ws.busy||!editing||!file||recovering,
      onChange:event=>{setAddType32(ws,event.currentTarget.value);safeRender();}}, [['','選択・移動'],['panel','パネル'],['label','ラベル'],['image','画像'],['button','ボタン']].map(([value,label])=>h('option',{value,selected:ws.addType===value?'selected':null},[label])))]),
      h('label',{for:'workspace-add-relation32'},['追加先 ',h('select',{id:'workspace-add-relation32',value:ws.insertionRelation32||'inside',disabled:!editing||!file,
        onChange:event=>{setInsertionRelation32(ws,event.currentTarget.value);safeRender();}},[['inside','選択要素の中へ'],['sibling','選択要素と同じ階層へ']].map(([value,label])=>h('option',{value,selected:(ws.insertionRelation32||'inside')===value?'selected':null},[label])))]),
      ws.addType ? h('span',{class:'hint',role:'status'},[describeInsertionParent32(file)]) : '',
      ws.addStatus32 ? h('span',{class:'hint',role:'status'},[ws.addStatus32.message]) : '',
      h('p', { class: 'hint' }, ['通常は選択中のパネルへ追加します。画像や文字を選択している場合は、その親へ追加します。ボタンのMinecraft側の動作は原文で割り当ててください。']),
    ]),
  })];
  else if (studioUi.tab === 'view') content = [
    group('プレビュー', [button('studio-view-fit28', '画面に合わせる', () => fitCanvasUiView(getCanvasKey(file?.id)), !file),
      button('studio-view-maximize28', previewViewport.active ? '最大化を終了' : '最大化', () => toggleStudioViewport23(getCanvasKey(file?.id)), !file)]),
    group('作業領域', [renderStudioLayoutTools28(h, preset => { applyStudioLayout28(studioUi, preset, window.innerWidth); safeRender(); })]),
    details('studio-view-advanced28', '表示・アニメーションの詳細設定', [studioUi.viewControls || h('p', {}, ['UIを選択してください。'])]),
  ];
  else if (studioUi.tab === 'data') content = [group('要素と状態', [button('studio-data-source', '原文を表示', () => { studioUi.rightOpen = true; studioUi.rightView = 'source'; safeRender(); }), button('studio-data-runtime', 'プレビューの状態データ', () => { studioUi.rightOpen = true; studioUi.rightView = 'data'; safeRender(); }), button('studio-data-references', '継承・参照', () => { studioUi.rightOpen = true; studioUi.rightView = 'references'; safeRender(); })]), h('p', { class: 'studio-ribbon-help' }, ['選択した要素の原文と、表示に使う状態データを右側で確認できます。'])];
  else if (studioUi.tab === 'export') { const legacy = renderSourceWorkspaceToolbar(state); const section = legacy.querySelector('.workspace-export-section'); if (section) section.open = true; content = [section || '']; }
  else content = [group('検査と記録', [button('studio-save-debug', 'ログを一括保存', downloadCompleteDebugBundle), button('studio-inspect', '診断を表示', () => { studioUi.rightOpen = true; studioUi.rightView = 'diagnostics'; safeRender(); }), button('studio-refresh', '反映済み状態を再確認', () => sourceWorkspace.refresh(), ws.busy || !ws.workspaceId || (!!count && !uncertain))]), h('p', { class: 'studio-ribbon-help' }, ['未対応・不足している文字や素材は診断で確認します。'])];
  return h('section', { id: 'studio-ribbon', class: `studio-ribbon studio-ribbon-${studioUi.tab}`, 'aria-label': '編集コマンド' }, [quick, recoveryNotice,
    h('div', { class: 'studio-tabline' }, [tabbar, h('button', { id: 'studio-ribbon-collapse26', type: 'button', class: 'btn', 'aria-controls': 'studio-ribbon-content', 'aria-expanded': String(!studioUi.compactRibbon26), onClick: () => { studioUi.compactRibbon26 = !studioUi.compactRibbon26; safeRender(); } }, [studioUi.compactRibbon26 ? 'コマンドを開く ▾' : 'コマンドを畳む ▴']), h('button', { type: 'button', class: 'btn studio-ribbon-hide', onClick: () => { previewViewport.setRibbonPinned(false); previewViewport.hideRibbon({ focusCanvas: true }); } }, ['コマンドを隠す'])]),
    ws.lastStructureAttempt32?.status==='rejected' ? h('p',{class:'hint',role:'status'},[`直前の${ws.lastStructureAttempt32.type==='add'?'追加':'削除'}は未受理で、出力に含まれません。${ws.lastStructureAttempt32.message}`]) : '',
    h('div', { id: 'studio-ribbon-content', class: 'studio-ribbon-content', role: 'tabpanel', 'aria-labelledby': `studio-tab-${studioUi.tab}`, tabindex: 0 }, content)]);
}

function renderEditor(state) {
  if (window.innerWidth <= 900 && studioUi.rightOpen && studioUi.leftOpen) studioUi.leftOpen = false;
  const leftPxRaw = Number(state.ui?.panels?.leftPx);
  const leftPx = Number.isFinite(leftPxRaw) && leftPxRaw > 0 ? Math.max(PANEL_MIN_LEFT, leftPxRaw) : PANEL_DEFAULT_LEFT_PX;
  const rightPxRaw = Number(state.ui?.panels?.rightPx);
  const rightPx = Number.isFinite(rightPxRaw) && rightPxRaw > 0 ? Math.max(PANEL_MIN_RIGHT, rightPxRaw) : PANEL_DEFAULT_RIGHT_PX;
  const leftPanelOpen = studioUi.leftOpen;
  const rightPanelOpen = studioUi.rightOpen;

  const left = leftPanelOpen ? renderPanel(siteText('画面と要素'), [renderStudioNavigation26(state)], {
    className: 'workspace-panel',
    headerActions: [
      h('button', { type: 'button', class: 'btn studio-panel-close', 'aria-label': '左のUI一覧を閉じる', onClick: () => { studioUi.leftOpen = false; safeRender(); } }, ['×']),
      h('span', {
        class: 'panel-width-value',
        title: t('editor.panel.leftWidth'),
        'aria-label': `${t('editor.panel.leftWidth')}: ${Math.round(leftPx)}px`,
      }, [`${Math.round(leftPx)}px`]),
      h('button', {
        type: 'button',
        class: 'btn panel-header-btn',
        title: t('editor.panel.leftNarrower'),
        'aria-label': t('editor.panel.leftNarrower'),
        onClick: () => adjustPanelWidth('left', -80),
      }, ['−']),
      h('button', {
        type: 'button',
        class: 'btn panel-header-btn',
        title: t('editor.panel.leftWider'),
        'aria-label': t('editor.panel.leftWider'),
        onClick: () => adjustPanelWidth('left', 80),
      }, ['＋']),
      h('button', {
        type: 'button',
        class: 'btn panel-header-reset',
        title: t('editor.panel.leftResetHint'),
        onClick: () => resetPanelWidth('left'),
      }, [t('editor.panel.leftReset')]),
    ],
    bodyClassName: 'left-pane-scroll',
    bodyAttrs: {
      id: 'left-pane-scroll',
      onScroll: (event) => {
        const el = event?.currentTarget;
        if (el instanceof HTMLElement) leftPaneScrollState.scrollTop = el.scrollTop;
      },
    },
  }) : "";

  requestAnimationFrame(() => {
    const scrollEl = document.getElementById('left-pane-scroll');
    if (!(scrollEl instanceof HTMLElement)) return;
    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    scrollEl.scrollTop = Math.min(leftPaneScrollState.scrollTop, maxScroll);
  });

  // The project currently provides the interactive "preview" via the Canvas
  // renderer (layout boxes + zoom/pan + selection). To avoid user confusion in
  // late-phase snapshots, we expose a single Preview tab backed by Canvas.
  const centerTabs = [
    { id: 'canvas', label: t('tab.preview') },
  ];
  const activeCenterTab = state.ui?.tabs?.center || 'canvas';
  /** @param {string} tabId */
  const renderCenterBody = (tabId) =>
    tabId === 'canvas'
      ? renderCanvasPanel(state)
      : h('div', { class: 'hint' }, [t('preview.placeholder.p1')]);

  const center = renderTabbedPanel({
    prefix: 'center',
    title: t('panel.preview'),
    tabs: centerTabs,
    activeTabId: activeCenterTab,
    onSelect: (tabId) => store.dispatch(actions.setEditorTab({ area: 'center', tabId })),
    renderBody: renderCenterBody,
  });
  const previewFile = state.files.byId[state.files.currentFileId];
  const previewKey = getCanvasKey(previewFile?.id);
  const previewName = previewFile?.meta?.selectedDefinition?.definition || previewFile?.path || 'UIを選択してください';
  center.querySelector('.panel-header')?.append(h('div', { class: 'studio-canvas-quicktools' }, [
    h('button', { id: 'studio-elements-toggle26', type: 'button', class: 'btn', 'aria-controls': 'panel-left', 'aria-expanded': String(studioUi.leftOpen && studioUi.leftView26 === 'elements'), onClick: () => { studioUi.leftOpen = studioUi.leftView26 !== 'elements' || !studioUi.leftOpen; studioUi.leftView26 = 'elements'; if (studioUi.leftOpen && window.innerWidth <= 900) studioUi.rightOpen = false; safeRender(); } }, ['要素']),
    h('button', { id: 'studio-properties-toggle26', type: 'button', class: 'btn', 'aria-controls': 'panel-right', 'aria-expanded': String(studioUi.rightOpen), onClick: () => { studioUi.rightOpen = !studioUi.rightOpen; studioUi.rightView = 'properties'; safeRender(); } }, ['プロパティ']),
    h('span', { class: 'studio-current-definition', title: String(previewName) }, [String(previewName)]),
    h('button', { type: 'button', class: 'btn', disabled: !previewFile, title: 'UI全体を画面に合わせる', onClick: () => fitCanvasUiView(previewKey) }, ['画面に合わせる']),
    h('button', { id: 'studio-preview-expand', type: 'button', class: 'btn', disabled: !previewFile, 'aria-pressed': String(previewViewport.active), onClick: () => toggleStudioViewport23(previewKey) }, [previewViewport.active ? '最大化を終了' : '最大化']),
  ]));

  const rightTabs = [
    { id: 'properties', label: 'プロパティ' },
    { id: 'source', label: '原文' },
    { id: 'data', label: '状態' },
    { id: 'references', label: '参照' },
    { id: 'diagnostics', label: '診断' },
  ];
  const activeRightTab = studioUi.rightView;
  /** @param {string} tabId */
  const renderRightBody = (tabId) => {
    if (tabId === 'data') return renderRuntimeStatePanel();
    if (tabId === 'diagnostics' || tabId === 'debug') return renderDebugPanel(state);
    if (tabId === 'references') return renderReferencesPanel(state);
    if (sourceWorkspace.state.mode === 'edit') { sourceWorkspace.state.sourceDetailsOpen = tabId === 'source'; return renderSourceWorkspaceInspector(); }
    return tabId === 'rawJson' || tabId === 'source' ? renderRawJsonPanel(state) : renderEditorPropertiesPanel(state);
  };

  const right = rightPanelOpen ? renderTabbedPanel({
    prefix: 'right',
    title: t('panel.inspector'),
    tabs: rightTabs,
    activeTabId: activeRightTab,
    onSelect: (tabId) => { studioUi.rightView = tabId; safeRender(); },
    renderBody: renderRightBody,
  }) : '';
  if (right) right.querySelector('.panel-header')?.append(h('button', { type: 'button', class: 'btn studio-panel-close', 'aria-label': '右のプロパティパネルを閉じる', onClick: () => { studioUi.rightOpen = false; safeRender(); } }, ['×']));

  const style = `--left-w:${leftPx}px;--right-w:${rightPx}px;`;
  const classes = [
    'editor-layout',
    leftPanelOpen ? '' : 'left-panel-hidden',
    rightPanelOpen ? '' : 'right-panel-hidden',
  ].filter(Boolean).join(' ');

  const layout = h('div', { class: classes, id: 'editor-layout', 'aria-label': t('nav.editor'), style }, [
    h('div', { class: 'editor-panel-slot', id: 'panel-left' }, [left]),
    h('div', { class: 'editor-splitter-slot splitter-left' }, [renderSplitter({ side: 'left', leftPx, rightPx })]),
    h('div', { class: 'editor-panel-slot', id: 'panel-center' }, [center]),
    h('div', { class: 'editor-splitter-slot splitter-right' }, [renderSplitter({ side: 'right', leftPx, rightPx })]),
    h('div', { class: 'editor-panel-slot', id: 'panel-right' }, [right]),
  ]);
  return h('div', { class: `studio-workspace studio-workspace28 studio-workspace35${sourceWorkspace.state.mode === 'edit' ? ' is-source-editing' : ''}${studioUi.compactRibbon26 ? ' is-ribbon-collapsed26' : ''}` }, [renderStudioExpandedBar(h, previewViewport), renderStudioRibbon(state), layout]);
}

/* --- S033: Canvas viewport (zoom/pan + selection) --------------------- */

const canvasUiState = {
  byFileKey: /** @type {Record<string, any>} */ ({}),
};

// Preview-time bindings runtime cache (S044).
// Avoids re-evaluating bindings on every render when unrelated UI state changes.
const bindingsRuntimeState = {
  lastFileId: /** @type {string|null} */ (null),
  lastUiModelRef: /** @type {any} */ (null),
  lastMockDataVersion: -1,
  lastResult: /** @type {any|null} */ (null),
};

// A truthful, explicitly representative Classic state prevents stock
// inventory branches from disappearing merely because Minecraft runtime data
// is unavailable in the browser. User mock values always override this base.
function getSelectedPreviewQualifiedName(file) {
  const selected = file?.meta?.selectedDefinition;
  return selected && typeof selected === 'object' && typeof selected.qualifiedName === 'string'
    ? selected.qualifiedName
    : '';
}

function setInventoryPreviewScenario(scenario) {
  assertStudioExternalChange21('インベントリの状態変更');
  const state = store.getState();
  const current = state.preview?.mockData && typeof state.preview.mockData === 'object'
    ? state.preview.mockData
    : {};
  const creative = scenario === 'creative';
  store.dispatch(actions.setMockData({
    ...current,
    '#is_survival_layout': !creative,
    '#is_creative_layout': creative,
    '#is_creative_and_creative_layout': creative,
    '#is_creative_and_recipe_book_layout': false,
    '#is_recipe_book_layout': false,
    '#is_creative_mode': creative,
    '#is_left_tab_inventory': !creative,
  }));
}

/**
 * Compute (or reuse cached) bindings evaluation for the active file.
 * @param {string|null} fileId
 * @param {any|null} file
 * @param {any} state
 * @returns {any|null}
 */
function getOrComputeBindingsEvalResult(fileId, file, state) {
  if (!fileId || !file || !file.uiModel || !state || !state.preview) return null;

  const mockDataVersion = Number(state.preview.mockDataVersion) || 0;
  const localCanvas = getCanvasState(getCanvasKey(fileId));
  ensureLocalToggleSession40(localCanvas, file);
  if (nodeFrameAvailability === true) {
    const cs = getCanvasState(getCanvasKey(fileId));
    return { propsById: cs.basePropsByIdOverride || {}, stats: cs.bindingsEvalStats || {}, warnings: cs.bindingsWarnings || [], diagnostics: cs.bindingDiagnostics || [], observationCaptureComplete: cs.bindingObservationComplete === true, localToggleState: cs.localToggleState };
  }
  if (
    bindingsRuntimeState.lastFileId === String(fileId) &&
    bindingsRuntimeState.lastUiModelRef === file.uiModel &&
    bindingsRuntimeState.lastMockDataVersion === mockDataVersion &&
    bindingsRuntimeState.lastLocalState === localCanvas.localToggleState &&
    bindingsRuntimeState.lastResult
  ) {
    return bindingsRuntimeState.lastResult;
  }

  const userMockData = state.preview.mockData && typeof state.preview.mockData === 'object'
    ? state.preview.mockData
    : {};
  const qualifiedName = getSelectedPreviewQualifiedName(file);
  const evalResult = evaluateBindingsWithRepresentativeRuntime(file.uiModel, qualifiedName, userMockData, localCanvas);
  if (evalResult?.localToggleState) localCanvas.localToggleState = evalResult.localToggleState;
  bindingsRuntimeState.lastFileId = String(fileId);
  bindingsRuntimeState.lastUiModelRef = file.uiModel;
  bindingsRuntimeState.lastMockDataVersion = mockDataVersion;
  bindingsRuntimeState.lastLocalState = localCanvas.localToggleState;
  bindingsRuntimeState.lastResult = evalResult;
  return evalResult;
}

function getCanvasKey(fileId) {
  if (!fileId) return 'file:__NONE__';
  // Different definitions in one JSON file need independent zoom/pan/layout
  // state even though the editor tab id remains path-based.
  try {
    const file = store.getState()?.files?.byId?.[String(fileId)];
    const selected = file?.meta?.selectedDefinition;
    const recordId = selected && typeof selected === 'object'
      ? selected.recordId || selected.definition || ''
      : selected || '';
    return recordId
      ? `file:${String(fileId)}#${encodeURIComponent(String(recordId))}`
      : `file:${String(fileId)}`;
  } catch {
    return `file:${String(fileId)}`;
  }
}

/** Redraws retain this state; a new model or reopened screen starts a new instance. */
function ensureLocalToggleSession40(canvasState, file, reset = false) {
  if (!file?.uiModel) return;
  if (reset || canvasState.localStateModel !== file.uiModel || !canvasState.uiInstanceId) {
    canvasState.localStateModel = file.uiModel;
    canvasState.uiInstanceId = globalThis.crypto.randomUUID();
    canvasState.localToggleState = createLocalToggleState(canvasState.uiInstanceId);
    canvasState.layoutInputKey = null;
    canvasState.nodeFrameRequestKey = null;
    canvasState.nodeFrameContext = null;
    canvasState.nodeFrameAppliedContext = null;
  }
}

function getCanvasState(key) {
  const k = String(key || 'file:__NONE__');
  if (!canvasUiState.byFileKey[k]) {
    canvasUiState.byFileKey[k] = {
      view: { zoom: 1, viewX: 0, viewY: 0, initialized: false },
      uiScaleMode: 'auto',
      manualUiScale: DEFAULT_CLASSIC_UI_SCALE,
      devicePresetKey: DEFAULT_DEVICE_PRESET_KEY,
      focusBounds: null,
      layout: {
        preset: DEFAULT_CANVAS_PRESET,
        boxes: [],
        stats: { totalNodes: 0, renderedBoxes: 0, boxCount: 0, truncated: false, maxBoxes: 5000 },
        warnings: [],
        scrollMetaById: {},
      },
      scrollById: Object.create(null),
      // Safe preview hides unresolved runtime-only branches. Structure mode is
      // opt-in because it deliberately shows mutually-exclusive candidates.
      structureMode: false,
      bindingsEvalStats: null,
      bindingsWarnings: [],
      layoutError: null,
      hoverId: null,
      hoverHandle: null,
      interaction: {
        active: false,
        pointerId: null,
        mode: 'none',
        targetId: null,
        handle: null,
        startClientX: 0,
        startClientY: 0,
        startWorldX: 0,
        startWorldY: 0,
        startViewX: 0,
        startViewY: 0,
        startBox: null,
        draftBox: null,
        moved: false,
      },
    };
  }
  return canvasUiState.byFileKey[k];
}

function hitTestSourceCanvas(key, file, world) {
  const cs = getCanvasState(key);
  if (cs.sourcePreviewBlocked) return null;
  const draftScene = studioDraftScene23(cs, file);
  if (draftScene?.additionsByNodeId.size) {
    const additionHit = hitTestBoxes(draftScene.layout.boxes.filter(box => draftScene.additionsByNodeId.has(box.id)), world.x, world.y, draftScene.layout.preset);
    if (additionHit) return additionHit;
  }
  if (cs.structureMode) return hitTestBoxes(studioPaintLayout21(cs, file).boxes || [], world.x, world.y, cs.layout?.preset);
  const isCurrent = snapshot => snapshot?.file === file && snapshot.layout === cs.layout && snapshot.pendingVersion === sourceWorkspace.state.pendingVersion && snapshot.zoom === cs.view.zoom;
  if (!isCurrent(cs.editPaintSnapshot)) drawCanvasNow(key);
  const snapshot = cs.editPaintSnapshot;
  if (!isCurrent(snapshot)) return null;
  cs.editPicker ||= createCanvasEditPicker({ onIssue: issue => diagnostics.log('warn',
    siteText('描画された画素を読み取れないため、この位置を選択できません。原文一覧または構造表示から要素を選択してください。'),
    { source: 'source-workspace', data: { code: issue.code } }) });
  return cs.editPicker.hitTest({ layout: snapshot.paintLayout || snapshot.layout, selection: snapshot.selection, view: cs.view,
    worldX: world.x, worldY: world.y, sourceCanvas: snapshot.canvas });
}

function getActiveCanvasUiScale(cs) {
  return activeClassicUiScale({ mode: cs?.uiScaleMode, manualUiScale: cs?.manualUiScale,
    observedUiScale: importedPackRuntime?.observedUiScale });
}

function getLogicalCanvasPreset(cs) {
  const scale = getActiveCanvasUiScale(cs);
  const devicePreset = DEVICE_CANVAS_PRESETS[String(cs && cs.devicePresetKey || '')]
    || DEVICE_CANVAS_PRESETS[DEFAULT_DEVICE_PRESET_KEY]
    || DEFAULT_CANVAS_PRESET;
  return logicalCanvasPreset(devicePreset, scale);
}

function findCanvasUiFocusBounds(file, layout, propsByIdOverride = null) {
  const importedIndex = importedPackRuntime?.assetIndex || null;
  const vanillaIndex = vanillaReferenceRuntime?.assetIndex || null;
  return findDrawableCanvasBounds({
    layout,
    nodesById: file?.nodesById,
    propsByIdOverride,
    isCustomDrawable: isCustomPreviewDrawable,
    isTextureResolvable: (textureRef) => Boolean(
      resolveTextureRef(String(textureRef), { importedIndex, vanillaIndex })?.resolved,
    ),
  });
}

function formatZoomLabel(z) {
  const pct = Math.round((Number(z) || 1) * 100);
  return `${pct}%`;
}

function updateCanvasZoomLabel(key) {
  const el = document.getElementById('canvas-zoom-label');
  if (!el) return;

  const cs = canvasUiState.byFileKey[String(key || 'file:__NONE__')];
  if (!cs || !cs.view) return;

  el.textContent = formatZoomLabel(cs.view.zoom);
}

const CANVAS_INTERACTION_THRESHOLD_PX = 3;
const CANVAS_POS_LIMIT = 10000;
const CANVAS_MIN_SIZE = 4;
const CANVAS_MAX_SIZE = 10000;

// Shared numeric clamping helper is defined near the pack-display helpers.

/** @param {number} n */
function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * @param {any} v
 * @returns {number|null}
 */
function toFiniteNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    // Allow numeric strings like "12" or "12.5"
    const num = Number(s);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

/**
 * Normalize Bedrock-style anchor tokens into unit coordinates.
 *
 * @param {any} name
 * @returns {{ ax: number, ay: number }}
 */
function anchorToUnit(name) {
  const n = String(name || 'center').trim().toLowerCase().replace(/[-\s]/g, '_');
  switch (n) {
    case 'top_left':
    case 'topleft':
      return { ax: 0, ay: 0 };
    case 'top_middle':
    case 'topmid':
    case 'top_center':
      return { ax: 0.5, ay: 0 };
    case 'top_right':
    case 'topright':
      return { ax: 1, ay: 0 };
    case 'left_middle':
    case 'middle_left':
    case 'mid_left':
    case 'center_left':
      return { ax: 0, ay: 0.5 };
    case 'middle':
    case 'mid':
    case 'center':
      return { ax: 0.5, ay: 0.5 };
    case 'right_middle':
    case 'middle_right':
    case 'mid_right':
    case 'center_right':
      return { ax: 1, ay: 0.5 };
    case 'bottom_left':
    case 'bottomleft':
      return { ax: 0, ay: 1 };
    case 'bottom_middle':
    case 'bottommid':
    case 'bottom_center':
      return { ax: 0.5, ay: 1 };
    case 'bottom_right':
    case 'bottomright':
      return { ax: 1, ay: 1 };
    default:
      return { ax: 0.5, ay: 0.5 };
  }
}

/**
 * Whether the selected node should be transformable via canvas interactions.
 *
 * @param {any} file
 * @param {string|null} nodeId
 */
function isCanvasNodeTransformable(file, nodeId) {
  if (!file || !nodeId) return false;
  if (file.readOnly && !(file.meta?.previewProjection && sourceWorkspace.state.mode === 'edit')) return false;
  if (file.rootId && String(file.rootId) === String(nodeId)) return false;
  return true;
}

/**
 * Best-effort predicate for whether a node can be resized via handles.
 *
 * @param {any} node
 */
function isCanvasNodeResizable(node) {
  return Boolean(node && node.props && !['factory', 'grid'].includes(node.type));
}

/**
 * @param {'nw'|'ne'|'sw'|'se'|null} kind
 */
function cursorForHandle(kind) {
  if (kind === 'ne' || kind === 'sw') return 'nesw-resize';
  if (kind === 'nw' || kind === 'se') return 'nwse-resize';
  if (kind === 'n' || kind === 's') return 'ns-resize';
  if (kind === 'e' || kind === 'w') return 'ew-resize';
  return 'default';
}

/**
 * Return the parent box for a node box (screen box if parent not found).
 *
 * @param {any} layout
 * @param {any} box
 */
function getParentBoxForNodeBox(layout, box) {
  const preset = layout && layout.preset ? layout.preset : DEFAULT_CANVAS_PRESET;
  const screen = { x: 0, y: 0, w: Number(preset.width) || 1280, h: Number(preset.height) || 720 };

  if (!box || !box.parentId) return screen;
  const pid = String(box.parentId);
  const boxes = layout && Array.isArray(layout.boxes) ? layout.boxes : [];
  const parent = boxes.find((b) => b && String(b.id) === pid);
  if (!parent) return screen;
  return { x: Number(parent.x) || 0, y: Number(parent.y) || 0, w: Number(parent.w) || 0, h: Number(parent.h) || 0 };
}

/**
 * Apply an in-progress draft transform (move/resize) to a layout object for drawing.
 *
 * This is purely visual; the actual model is updated on pointerup.
 *
 * @param {any} layout
 * @param {any} interaction
 */
function applyCanvasDraftToLayout(layout, interaction) {
  if (!layout || !interaction || !interaction.active || !interaction.moved) return layout;
  if (interaction.mode !== 'move' && interaction.mode !== 'resize') return layout;
  const targetId = interaction.targetId ? String(interaction.targetId) : null;
  const startBox = interaction.startBox;
  const draftBox = interaction.draftBox;
  if (!targetId || !startBox || !draftBox) return layout;

  const boxes = Array.isArray(layout.boxes) ? layout.boxes : [];
  if (boxes.length === 0) return layout;

  const dx = Number(draftBox.x) - Number(startBox.x);
  const dy = Number(draftBox.y) - Number(startBox.y);

  // Build parent map for subtree checks.
  const parentById = new Map();
  for (const b of boxes) {
    if (!b) continue;
    parentById.set(String(b.id), b.parentId ? String(b.parentId) : null);
  }

  const movingRoots = new Set(interaction.groupIds?.length ? interaction.groupIds : [targetId]);
  const isInSubtree = (id) => {
    const needle = String(id);
    let cur = needle;
    let guard = 0;
    while (cur && guard < 200) {
      if (movingRoots.has(cur)) return true;
      cur = parentById.get(cur) || null;
      guard++;
    }
    return false;
  };

  const nextBoxes = boxes.map((b) => {
    if (!b) return b;
    const id = String(b.id);
    if (!isInSubtree(id)) return b;

    if (id === targetId) {
      return { ...b, x: Number(draftBox.x) || 0, y: Number(draftBox.y) || 0, w: Number(draftBox.w) || 0, h: Number(draftBox.h) || 0 };
    }
    return { ...b, x: (Number(b.x) || 0) + dx, y: (Number(b.y) || 0) + dy };
  });

  return { ...layout, boxes: nextBoxes };
}

/**
 * Commit a move/resize transform to the current file's node props.
 *
 * @param {any} layout
 * @param {string} nodeId
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {'move'|'resize'} mode
 */
function commitCanvasTransform(layout, nodeId, box, mode) {
  const state = store.getState();
  const fileId = state.files.currentFileId;
  const file = fileId ? state.files.byId[fileId] : null;
  const selectedDefinition = file?.meta?.selectedDefinition;
  const definitionId = selectedDefinition && typeof selectedDefinition === 'object'
    ? selectedDefinition.recordId || selectedDefinition.definition || selectedDefinition.rawKey || ''
    : selectedDefinition || '';
  const previewLocale = state.ui && typeof state.ui.previewLocale === 'string' ? state.ui.previewLocale : 'en_US';
  if (!file || file.readOnly) return;
  if (!nodeId) return;
  if (file.rootId && String(file.rootId) === String(nodeId)) return;

  const node = file.nodesById ? file.nodesById[String(nodeId)] : null;
  if (!node) return;

  const layoutBoxes = layout && Array.isArray(layout.boxes) ? layout.boxes : [];
  const nodeBox = layoutBoxes.find((b) => b && String(b.id) === String(nodeId)) || null;
  const parentBox = getParentBoxForNodeBox(layout, nodeBox);

  const x = clampNumber(box.x, -CANVAS_POS_LIMIT, CANVAS_POS_LIMIT);
  const y = clampNumber(box.y, -CANVAS_POS_LIMIT, CANVAS_POS_LIMIT);
  const w = clampNumber(box.w, CANVAS_MIN_SIZE, CANVAS_MAX_SIZE);
  const h = clampNumber(box.h, CANVAS_MIN_SIZE, CANVAS_MAX_SIZE);

  const props = node.props ? node.props : {};
  const usesJsonUi =
    Object.prototype.hasOwnProperty.call(props, 'offset') ||
    Object.prototype.hasOwnProperty.call(props, 'size') ||
    Object.prototype.hasOwnProperty.call(props, 'anchor_to') ||
    Object.prototype.hasOwnProperty.call(props, 'anchor_from');

  /** @type {Record<string, any>} */
  const patchProps = {};

  if (usesJsonUi) {
    const aTo = anchorToUnit(props.anchor_to);
    const aFrom = anchorToUnit(props.anchor_from);

    const parentAx = (Number(parentBox.x) || 0) + (Number(parentBox.w) || 0) * aFrom.ax;
    const parentAy = (Number(parentBox.y) || 0) + (Number(parentBox.h) || 0) * aFrom.ay;

    const elAx = w * aTo.ax;
    const elAy = h * aTo.ay;

    const offX = x - parentAx + elAx;
    const offY = y - parentAy + elAy;

    patchProps.offset = [round2(offX), round2(offY)];
    if (mode === 'resize') {
      patchProps.size = [round2(w), round2(h)];
    }
  } else {
    patchProps.x = round2(x - (Number(parentBox.x) || 0));
    patchProps.y = round2(y - (Number(parentBox.y) || 0));
    if (mode === 'resize') {
      patchProps.w = round2(w);
      patchProps.h = round2(h);
    }
  }

  const nodesById = file.nodesById ? file.nodesById : {};
  const oldNode = nodesById[String(nodeId)];

  // If this is a real imported UI screen file, patch the UiScreenModel so
  // the deterministic serializer and raw JSON output stay in sync.
  if (file.uiModel) {
    const nextModel = updateUiModelNodeProps(file.uiModel, String(nodeId), patchProps);
    const patch = buildScreenFilePatchFromModel(file, nextModel);
    store.dispatch(actions.patchFile({ fileId, patch }));
    updateImportedPackOverridesIfNeeded(file, patch.modelOutputText, patch.sourceJson);
    return;
  }

  const nextNode = { ...oldNode, props: { ...(oldNode.props || {}), ...patchProps } };
  const nextNodesById = { ...nodesById, [String(nodeId)]: nextNode };

  store.dispatch(
    actions.patchFile({
      fileId,
      patch: {
        dirty: true,
        nodesById: nextNodesById,
      },
    })
  );
}


function ensureCanvasViewInitialized(canvas, cs, preset) {
  if (!canvas || !cs) return;
  if (cs.view && cs.view.initialized) return;

  const rect = canvas.getBoundingClientRect();
  // Fidelity mode starts from the complete logical device viewport. Content
  // fitting remains available as an explicit action, but must never let a
  // resource name or a bad unresolved branch change the initial camera.
  const next = fitViewToPreset(rect.width, rect.height, preset || getLogicalCanvasPreset(cs), 24);
  cs.view = { ...next, initialized: true };
}

// 入力overlayはroute DOMの再生成から独立して保持する。書き込みは純粋engineで
// ON/OFF・Pocket・現在のmodel/行・文字数を再確認してから一括適用する。
const previewEditBoxOverlayState = { inputEl: null, active: null };

function ensurePreviewEditBoxOverlayInput(multiline = false) {
  const existing = previewEditBoxOverlayState.inputEl;
  const wantedTag = multiline ? 'TEXTAREA' : 'INPUT';
  if (existing?.isConnected && existing.tagName === wantedTag) return existing;
  hidePreviewEditBoxOverlay('input-kind-changed');
  existing?.remove();
  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = 'text';
  input.id = 'preview-editbox-overlay';
  input.className = 'preview-editbox-overlay';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', siteText('プレビュー内の文字入力'));
  input.style.display = 'none';
  input.style.resize = 'none';
  input.addEventListener('compositionstart', () => {
    const active = previewEditBoxOverlayState.active;
    if (!active) return;
    active.composing = true;
    if (active.pendingTimer) { clearTimeout(active.pendingTimer); active.pendingTimer = 0; }
  });
  input.addEventListener('compositionend', () => {
    const active = previewEditBoxOverlayState.active;
    if (!active) return;
    active.composing = false;
    schedulePreviewEditBoxMockDataCommit();
  });
  input.addEventListener('input', (event) => {
    if (event?.isComposing || previewEditBoxOverlayState.active?.composing) return;
    schedulePreviewEditBoxMockDataCommit();
  });
  input.addEventListener('blur', () => {
    commitPreviewEditBoxMockDataNow();
    hidePreviewEditBoxOverlay('blur');
  });
  input.addEventListener('keydown', (event) => {
    if (!event || event.isComposing || previewEditBoxOverlayState.active?.composing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      hidePreviewEditBoxOverlay('escape-cancel');
      input.blur();
    } else if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      input.blur();
    }
  });
  document.body.appendChild(input);
  previewEditBoxOverlayState.inputEl = input;
  return input;
}

function readPreviewEditBoxValue(context, edit) {
  if (edit.collection) return context.collectionData?.[edit.collection]?.[edit.index]?.[edit.binding];
  const current = context.mockData || {};
  if (Object.hasOwn(current, edit.binding)) return current[edit.binding];
  return current[edit.binding.slice(1)];
}

function schedulePreviewEditBoxMockDataCommit() {
  const active = previewEditBoxOverlayState.active;
  if (!previewEditBoxOverlayState.inputEl || !active?.edit || active.composing) return;
  if (active.pendingTimer) clearTimeout(active.pendingTimer);
  active.pendingTimer = setTimeout(() => {
    if (previewEditBoxOverlayState.active === active) commitPreviewEditBoxMockDataNow();
  }, 60);
}

function commitPreviewEditBoxMockDataNow() {
  const input = previewEditBoxOverlayState.inputEl;
  const active = previewEditBoxOverlayState.active;
  if (!input || !active?.edit || active.composing) return;
  if (active.pendingTimer) { clearTimeout(active.pendingTimer); active.pendingTimer = 0; }
  const context = getInteractionPreviewContext(active.fileKey);
  const selectedFileId = context?.state?.files?.currentFileId;
  if (!context?.enabled || context.pocket || context.model !== active.model || selectedFileId !== active.fileId || context.screenDefinition !== active.screenDefinition || getCanvasState(active.fileKey).previewClosed) {
    hidePreviewEditBoxOverlay('interaction-context-changed');
    return;
  }
  const uiNode = getUiInteractionSourceNode(context, active.nodeId);
  const effectiveProps = getInteractionHitProps(context, active.nodeId);
  const currentDescriptor = describeTextInteraction({ ...context, node: uiNode, effectiveProps, collectionIndex: active.edit.index });
  const edit = currentDescriptor.edit;
  if (!edit || edit.binding !== active.edit.binding || edit.collection !== active.edit.collection || edit.index !== active.edit.index) {
    hidePreviewEditBoxOverlay('input-source-changed');
    return;
  }
  const currentValue = readPreviewEditBoxValue(context, edit);
  if (currentValue !== active.expectedValue) {
    setStatus(siteText('入力中に同じデータが変更されたため、上書きを取り消しました。'));
    hidePreviewEditBoxOverlay('input-data-changed');
    return;
  }
  const nextValue = String(input.value);
  if (currentValue === nextValue) return;
  const answer = commitTextInteraction({ ...context, effectiveProps, edit, value: nextValue });
  if (answer.status !== 'applied') {
    const reason = answer.diagnostics.map(entry => translateSiteMessage(entry.message)).join(' ') || siteText('文字入力を適用できません。');
    input.setCustomValidity(reason);
    setStatus(reason);
    return;
  }
  input.setCustomValidity('');
  if (commitPreviewInteractionEffects(answer.effects, siteText('プレビューの入力値を更新しました。')) === false) return;
  active.expectedValue = nextValue;
  active.edit = edit;
}

function focusPreviewEditBoxOverlay(opts) {
  if (!opts?.edit) return;
  const fileKey = String(opts.fileKey), nodeId = String(opts.nodeId);
  const context = getInteractionPreviewContext(fileKey);
  if (!context?.enabled || context.pocket || !context.model || getCanvasState(fileKey).previewClosed) return;
  hidePreviewEditBoxOverlay('focus-new-input');
  const input = ensurePreviewEditBoxOverlayInput(opts.edit.multiline === true);
  previewEditBoxOverlayState.active = {
    fileKey, nodeId, edit: opts.edit, model: context.model, fileId: context.state?.files?.currentFileId,
    screenDefinition: context.screenDefinition, expectedValue: readPreviewEditBoxValue(context, opts.edit),
    pendingTimer: 0, composing: false,
  };
  input.value = typeof opts.value === 'string' ? opts.value : String(opts.value ?? '');
  input.placeholder = typeof opts.placeholder === 'string' ? opts.placeholder : '';
  input.inputMode = opts.edit.textType === 'Numeric' ? 'numeric' : 'text';
  if (input.tagName === 'INPUT') input.type = opts.edit.textType === 'Password' ? 'password' : 'text';
  if (Number.isInteger(opts.edit.maxLength) && opts.edit.maxLength >= 0) input.maxLength = opts.edit.maxLength;
  else input.removeAttribute('maxlength');
  input.disabled = false;
  input.setCustomValidity('');
  input.style.display = 'block';
  const cs = getCanvasState(fileKey), canvas = document.getElementById('preview-canvas');
  if (canvas) syncPreviewEditBoxOverlayPosition(fileKey, canvas, cs.view, cs.layout, nodeId);
  try { input.focus({ preventScroll: true }); } catch { input.focus(); }
}

function hidePreviewEditBoxOverlay(_reason) {
  const input = previewEditBoxOverlayState.inputEl, active = previewEditBoxOverlayState.active;
  if (active?.pendingTimer) clearTimeout(active.pendingTimer);
  previewEditBoxOverlayState.active = null;
  if (input?.isConnected) input.style.display = 'none';
}

function inferEditBoxBoundMockKeyFromUiNode(uiNode) {
  if (!uiNode) return null;
  const stack = [{ node: uiNode, depth: 0 }];
  let visited = 0;
  while (stack.length && visited < 1024) {
    const current = stack.pop();
    if (!current || !current.node || current.depth > 64) continue;
    visited += 1;
    const node = current.node;
    const authoredProps = {
      ...(node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {}),
      ...(node.props && typeof node.props === 'object' ? node.props : {}),
    };
    const textToken = typeof authoredProps.text === 'string' && /^#[A-Za-z0-9_:@.\-]+$/.test(authoredProps.text.trim())
      ? authoredProps.text.trim().slice(1)
      : '';
    const bindings = Array.isArray(node.bindings) ? node.bindings : [];
    for (const b of bindings) {
      if (!b) continue;
      const bindingType = typeof b.binding_type === 'string' ? b.binding_type.toLowerCase() : 'global';
      if (bindingType !== 'global' && bindingType !== 'collection') continue;
      const targetRaw = typeof b.binding_name_override === 'string'
        ? b.binding_name_override
        : typeof b.target_property_name === 'string'
          ? b.target_property_name
          : typeof b.binding_name === 'string'
            ? b.binding_name
            : '';
      const normalizedTarget = String(targetRaw || '').trim().replace(/^[#$]/, '');
      if (normalizedTarget !== 'text' && (!textToken || normalizedTarget !== textToken)) continue;
      const bindingName = typeof b.binding_name === 'string' ? b.binding_name.trim() : '';
      if (bindingName && /^[#$][A-Za-z0-9_:@.\-]+$/.test(bindingName)) return bindingName;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: children[i], depth: current.depth + 1 });
    }
  }
  // text_box_name identifies the control; it is not the runtime value source.
  return null;
}

function syncPreviewEditBoxOverlayPosition(key, canvas, view, layoutForDraw, selectedId) {
  const input = previewEditBoxOverlayState.inputEl;
  const active = previewEditBoxOverlayState.active;
  if (!input || !active || input.style.display === 'none') return;

  const context = getInteractionPreviewContext(key);
  if (!context?.enabled || context.pocket || context.model !== active.model || context.screenDefinition !== active.screenDefinition || getCanvasState(key).previewClosed) {
    hidePreviewEditBoxOverlay('interaction-mode-changed');
    return;
  }

  const selected = selectedId ? String(selectedId) : null;
  if (String(active.fileKey) !== String(key) || String(active.nodeId) !== String(selected)) {
    hidePreviewEditBoxOverlay('file_or_selection_changed');
    return;
  }

  const boxes = layoutForDraw && Array.isArray(layoutForDraw.boxes) ? layoutForDraw.boxes : [];
  const box = boxes.find((b) => b && String(b.id) === String(active.nodeId));
  if (!box) {
    hidePreviewEditBoxOverlay('missing_box');
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const zoom = view && Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
  const viewX = view && Number.isFinite(view.viewX) ? view.viewX : 0;
  const viewY = view && Number.isFinite(view.viewY) ? view.viewY : 0;

  const left = rect.left + (toFiniteNumber(box.x) - viewX) * zoom;
  const top = rect.top + (toFiniteNumber(box.y) - viewY) * zoom;
  const width = Math.max(0, toFiniteNumber(box.w) * zoom);
  const height = Math.max(0, toFiniteNumber(box.h) * zoom);

  input.style.left = `${Math.round(left)}px`;
  input.style.top = `${Math.round(top)}px`;
  input.style.width = `${Math.round(width)}px`;
  input.style.height = `${Math.round(height)}px`;

  const fontPx = clampNumber(getBedrockLogicalFontPx('normal') * zoom, 6, 96);
  input.style.fontSize = `${fontPx}px`;
  input.style.lineHeight = active.edit?.multiline === true ? '1.2' : `${Math.max(1, Math.round(height))}px`;
}

function clampUnit(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function bedrockColorToCss(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4)) return '';
  const channels = value.map((channel) => Number(channel));
  if (channels.some((channel) => !Number.isFinite(channel))) return '';
  const rgb = channels.slice(0, 3).map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255));
  const alpha = value.length === 4 ? clampUnit(channels[3], 1) : 1;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function isConcretePreviewTextureRef(value) {
  const ref = typeof value === 'string' ? value.trim() : '';
  if (!ref || /^[#$@]/.test(ref)) return false;
  return !(ref.startsWith('(') && ref.endsWith(')'));
}

function resolveLocalRuntimePropertyToken(value, props, maxDepth = 8) {
  let current = value;
  const seen = new Set();
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (typeof current !== 'string') return current;
    const token = current.trim();
    if (!/^[#$][A-Za-z0-9_:@.\-]+$/.test(token)) return current;
    if (seen.has(token)) return current;
    seen.add(token);
    const bare = token.slice(1);
    if (props && Object.prototype.hasOwnProperty.call(props, bare)) {
      current = props[bare];
      continue;
    }
    if (props && Object.prototype.hasOwnProperty.call(props, token)) {
      current = props[token];
      continue;
    }
    return current;
  }
  return current;
}

/**
 * Resolve a recognized native custom renderer through the effective item
 * atlas stack. A hard-coded same-path reference is retained only when neither
 * pack declares the recognized atlas key.
 *
 * @param {Record<string, unknown>|null} props
 * @returns {string|null}
 */
function resolveCustomPreviewTextureResult(props) {
  // Start both bounded atlas loads, then resolve through the same structured
  // precedence contract used by validation.
  return resolveNativeRendererTexture(props, buildItemTextureAtlasReferenceContext());
}

function resolveCustomPreviewTextureRef(props) {
  const result = resolveCustomPreviewTextureResult(props);
  return result?.status === 'resolved' ? result.textureRef : null;
}

/**
 * Keep empty-state and “fit UI” decisions aligned with the native controls the
 * normal canvas path can actually paint. Unknown custom renderers retain their
 * authored layout geometry but are not counted as drawable pixels.
 *
 * @param {unknown} props
 */
function isCustomPreviewDrawable(props) {
  const safeProps = mergeNativeRendererProps(props);
  if (!safeProps) return false;
  if (getNativeRendererPlaceholderKind(safeProps)) return true;
  const textureRef = resolveCustomPreviewTextureRef(safeProps);
  if (!isConcretePreviewTextureRef(textureRef)) return false;
  const fileSystem = typeof safeProps.texture_file_system === 'string'
    ? safeProps.texture_file_system
    : '';
  if (fileSystem && fileSystem !== 'InUserPackage' && fileSystem !== 'InAppPackage') return false;
  const resolved = resolveTextureRef(String(textureRef), {
    importedIndex: importedPackRuntime?.assetIndex || null,
    vanillaIndex: vanillaReferenceRuntime?.assetIndex || null,
  });
  return Boolean(resolved?.ok && resolved.resolved);
}
function buildImageDrawMetadata(props) {
  return buildImageDrawMetadataFromProps(props);
}

function mergeCachedTextureIntrinsicSizes(file, baseOverrides) {
  const nodesById = file && file.nodesById && typeof file.nodesById === 'object' ? file.nodesById : null;
  if (!nodesById) return baseOverrides;
  const importedIndex = importedPackRuntime && importedPackRuntime.assetIndex ? importedPackRuntime.assetIndex : null;
  const vanillaIndex = vanillaReferenceRuntime && vanillaReferenceRuntime.assetIndex ? vanillaReferenceRuntime.assetIndex : null;
  if (!importedIndex && !vanillaIndex) return baseOverrides;

  let out = baseOverrides;
  for (const [id, node] of Object.entries(nodesById)) {
    if (!node || String(node.type || '').toLowerCase() !== 'image') continue;
    const unknownProps = node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {};
    const authored = { ...unknownProps, ...(node.props || {}), ...(baseOverrides && baseOverrides[id] || {}) };
    const textureRef = resolveLocalRuntimePropertyToken(authored.texture, authored);
    if (!isConcretePreviewTextureRef(textureRef)) continue;
    const currentSize = Array.isArray(authored.size) && authored.size.length >= 2
      ? [authored.size[0], authored.size[1]]
      : ['default', 'default'];
    const resolved = resolveTextureRef(String(textureRef), { importedIndex, vanillaIndex });
    if (!resolved || !resolved.ok || !resolved.resolved) continue;
    const packPath = String(resolved.resolved.packPath || '');
    const sidecar = getTextureSidecarMetadata(String(resolved.resolved.source || ''), packPath);
    const baseSize = sidecar && Array.isArray(sidecar.baseSize)
      ? [Number(sidecar.baseSize[0]), Number(sidecar.baseSize[1])]
      : null;
    // Only authored texture metadata is a density-independent logical size.
    // Raw raster pixels may be a 2x/4x resource override, so treating them as UI
    // units makes otherwise-correct HD packs grow with raster density.
    // Omitted image sizes fill their parent; they must not be confused with an
    // explicitly-authored `default` axis merely because the normalized model
    // represents both using the same value.
    const nextSize = mergeExplicitTextureBaseSize(node, currentSize, baseSize);
    if (!nextSize) continue;
    if (out === baseOverrides) out = { ...(baseOverrides || {}) };
    out[id] = {
      ...(out[id] || {}),
      size: nextSize,
    };
  }
  return out;
}

let previewTextMeasureCanvas = null;
const bitmapFontCache = new BitmapFontCache(nodeFontSheet,
  () => requestCanvasTextureMetadataRefresh(),
  (error,sheet) => diagnostics.log('warn',siteText('画像フォントを表示できません。'),{source:'preview',data:{code:error.message,sheet}}));
const bitmapTextLayoutCache = new BitmapTextLayoutCache(bitmapFontCache);
const bitmapFontNotices=new Set();
function fontNotice(code,data){
  const key=`${code}:${String(data?.fontType||'')}:${String(data?.sheet||'')}`;
  if(bitmapFontNotices.has(key)||bitmapFontNotices.size>=256)return;
  bitmapFontNotices.add(key);
  const messages={
    FONT_SOURCE_UNAVAILABLE:siteText('文字の原本フォントがありません。バニラ参照パックを指定してください。'),
    FONT_GLYPH_LOADING:siteText('文字の画像フォントを読み込んでいます。取得済み文字はそのまま表示します。'),
    FONT_GLYPH_UNAVAILABLE:siteText('一部の文字画像が存在しないか表示できません。該当文字だけを診断用の枠で示します。'),
    FONT_FACE_LOADING:siteText('パックのフォントファイルを読み込んでいます。'),
    FONT_BACKEND_UNAVAILABLE:siteText('指定フォントの描画方式に未対応か、必要なフォントファイルがありません。標準フォントには置換しません。'),
    FONT_FACE_GLYPH_UNAVAILABLE:siteText('指定フォントに存在しない文字があります。該当文字をOSフォントへ置換せず診断用の枠で示します。'),
    FONT_COVERAGE_UNVERIFIED:siteText('このフォント形式では文字の対応範囲を検査できません。文字ごとのOSフォント代替は未検証です。'),
    FONT_UNICODE_ADVANCE_APPROXIMATION:siteText('Unicodeの字送りには実機6文字で確認した近似式を使用しています。他の文字や画面は未検証です。'),
    FONT_FORMAT_UNSUPPORTED:siteText('一部の文字書式に未対応です。診断の書式コードを確認してください。'),
  };
  const severity=code.endsWith('_LOADING')?'info':'warn';
  diagnostics.log(severity,messages[code]||siteText('文字プレビューの状態を確認してください。'),{source:'preview',data:{code,...data}});
}

function bitmapTextLayout(text,fontType,fontPx,color='#ffffff',linePadding=0,maxWidth=undefined,roundingScale=1) {
  const sources=[['imported',importedPackRuntime],['vanilla',vanillaReferenceRuntime]].filter(([,r])=>r?.zipReader?.nodePackId).map(([kind,r])=>({kind,id:r.zipReader.nodePackId}));
  fontType=String(fontType||'default').trim().toLowerCase();
  const fontProfile=store.getState()?.ui?.previewFontProfile||'bitmap';
  if(fontProfile==='observed-smooth'&&['default','smooth'].includes(fontType))fontType='smooth';
  if(!['default','unicode','rune','smooth'].includes(fontType))return null;
  if(!sources.length)fontNotice('FONT_SOURCE_UNAVAILABLE',{fontType});
  const locale=String(store.getState()?.ui?.previewLocale||'en_US');
  bitmapFontCache.ensure(text,fontType,sources,locale,fontProfile);
  const remapping=fontType==='smooth'?bitmapFontCache.get(sources,locale,'smooth_remapping')?.remapping:undefined;
  const layout=bitmapTextLayoutCache.getOrCreate(text,{fontType,fontPx,color,linePadding,maxWidth,remapping,fontProfile,roundingScale},{sources,locale},()=>layoutBitmapText(text,{fontType,fontPx,color,linePadding,maxWidth,remapping,roundingScale,getSheet:sheet=>{
    const row=bitmapFontCache.get(sources,locale,sheet);
    if(row?.metrics?.metricsProfile?.includes('approximation'))fontNotice('FONT_UNICODE_ADVANCE_APPROXIMATION',{profile:row.metrics.metricsProfile,provenance:row.provenance});
    return row;
  }}));
  if(layout.diagnostics?.length)fontNotice('FONT_FORMAT_UNSUPPORTED',{codes:layout.diagnostics});
  if(!layout.ready)fontNotice(layout.loadingGlyphCount===layout.missingGlyphCount?'FONT_GLYPH_LOADING':'FONT_GLYPH_UNAVAILABLE',{fontType,missingGlyphCount:layout.missingGlyphCount,loadingGlyphCount:layout.loadingGlyphCount,sheets:layout.missing,issues:layout.issues,placeholderProfile:layout.placeholderProfile});
  return layout;
}

function stripBedrockFormattingCodes(value) {
  return String(value ?? '').replace(/\u00a7./gu, '');
}

function resolveMeasuredPreviewFontFamily(fontType) {
  const fallback = mapFontTypeToFallbackFamily(fontType);
  const importedIndex = importedPackRuntime?.assetIndex || null;
  const vanillaIndex = vanillaReferenceRuntime?.assetIndex || null;
  if (!importedIndex && !vanillaIndex) return fallback;
  const resolved = resolveFontTypeRef(String(fontType || 'default'), { importedIndex, vanillaIndex });
  if (!resolved?.ok || !resolved.resolved) return fallback;
  const cacheKey = `${resolved.resolved.source}:${String(resolved.resolved.packPath || '')}`;
  return fontFaceCache.get(cacheKey) || null;
}

function measurePreviewLabelIntrinsicSize(props, resolvedText, maxWidth = undefined) {
  const fallback = estimateTextIntrinsicSize(props, resolvedText);
  try {
    if (typeof document === 'undefined') return fallback;
    if (!previewTextMeasureCanvas) previewTextMeasureCanvas = document.createElement('canvas');
    const context = previewTextMeasureCanvas.getContext('2d');
    if (!context) return fallback;
    const scaleRaw = Number(props && props.font_scale_factor);
    const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
    const logicalPx = getBedrockLogicalFontPx(props && props.font_size) * scale;
    const padding=Number(props?.line_padding);const linePadding=Number.isFinite(padding)&&padding>=0?Math.min(4096,padding):0;
    const bitmap = bitmapTextLayout(resolvedText,String(props?.font_type||'default'),logicalPx,'#ffffff',linePadding,maxWidth);
    if(bitmap?.drawable)return {w:bitmap.width,h:bitmap.height};
    const fontEntry = resolveMeasuredPreviewFontFamily(props && props.font_type ? props.font_type : 'default');
    if(!fontEntry?.family)return fallback;
    context.font = `${logicalPx}px "${fontEntry.family}"`;
    const lines = stripBedrockFormattingCodes(resolvedText).split(/\r?\n/u);
    let width = 0;
    for (const line of lines) width = Math.max(width, measureCoveredFontLine(context,line,fontEntry.coverage,logicalPx).width);
    return {
      w: Math.max(0, Math.round(width * 100) / 100),
      h: Math.max(0, Math.round((logicalPx * Math.max(1, lines.length)+Math.max(0,lines.length-1)*linePadding) * 100) / 100),
    };
  } catch {
    return fallback;
  }
}

function mergeTextIntrinsicSizes(file, baseOverrides, previewLocale, layout = null) {
  const nodesById = file && file.nodesById && typeof file.nodesById === 'object' ? file.nodesById : null;
  if (!nodesById) return baseOverrides;
  let out = baseOverrides;
  const boxById = new Map((layout?.boxes || []).map(box => [String(box.id), box]));
  for (const [id, node] of Object.entries(nodesById)) {
    if (!node || String(node.type || '').toLowerCase() !== 'label') continue;
    const unknownProps = node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {};
    const props = { ...unknownProps, ...(node.props || {}), ...(baseOverrides && baseOverrides[id] || {}) };
    const authoredSize = Boolean(node.propsPresent && node.propsPresent.size === true);
    const currentSize = Array.isArray(props.size) && props.size.length >= 2
      ? [props.size[0], props.size[1]]
      : ['default', 'default'];
    const widthIsIntrinsic = !authoredSize || String(currentSize[0]).trim().toLowerCase() === 'default';
    const heightIsIntrinsic = !authoredSize || String(currentSize[1]).trim().toLowerCase() === 'default';
    const contentMetricNeeded = [props.size, props.min_size, props.max_size].some(vector =>
      Array.isArray(vector) && vector.some(value => typeof value === 'string' && /%cm?\b/iu.test(value)));
    if (!widthIsIntrinsic && !heightIsIntrinsic && !contentMetricNeeded) continue;

    let textValue = resolveLocalRuntimePropertyToken(props.text, props);
    if (typeof textValue !== 'string' || /^[#$]/u.test(textValue.trim())) textValue = '';
    const localized = props.localize === false
      ? textValue
      : resolvePreviewLocalizedText(textValue, previewLocale);
    const measuredWidth = Number(boxById.get(id)?.w);
    const maxWidth = !widthIsIntrinsic && heightIsIntrinsic && props.text_wrap !== false && measuredWidth > 0 ? measuredWidth : undefined;
    const intrinsic = measurePreviewLabelIntrinsicSize(props, localized, maxWidth);
    const nextSize = [
      widthIsIntrinsic ? intrinsic.w : currentSize[0],
      heightIsIntrinsic ? intrinsic.h : currentSize[1],
    ];
    if (out === baseOverrides) out = { ...(baseOverrides || {}) };
    // Measured text is content, not an authored control size. Keep it separate
    // so %c/%cm constraints can use real glyphs without changing fixed axes.
    out[id] = { ...(out[id] || {}),
      ...(widthIsIntrinsic || heightIsIntrinsic ? { size: nextSize } : {}),
      __jsonui_preview_text_intrinsic_size: [intrinsic.w, intrinsic.h] };
  }
  return out;
}

function drawCanvasNow(key, options = {}) {
  const drawStarted = performance.now();
  try { return drawCanvasFrame(key, options); } finally { previewPerformance.record('draw', performance.now() - drawStarted); }
}

function drawCanvasFrame(key, options = {}) {
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('preview-canvas'));
  if (!canvas) return;

  const cs = getCanvasState(key);
  if (options.nativeOnly === true && drawNativeMotionFromSnapshot(key, canvas, cs)) return;
  if (nativeMotionSnapshotOwner && nativeMotionSnapshotOwner !== cs) nativeMotionSnapshotOwner.nativeMotionSnapshot = null;
  nativeMotionSnapshotOwner = cs;
  cs.nativeMotionSnapshot = null;
  cs.nativeMotionHasBook = false;
  ensureCanvasViewInitialized(canvas, cs, cs.layout?.preset || DEFAULT_CANVAS_PRESET);

  const state = store.getState();

  // NOTE(S064): The canvas preview render path (drawCanvasNow) must NOT assume that
  // previewLocale exists as a global. It is a per-session UI setting.
  // A missing declaration here caused a runtime ReferenceError and prevented text draw
  // metadata from being built (best-effort). Keep this local and robust.
  const previewLocaleRaw = state.ui && typeof state.ui.previewLocale === 'string' ? state.ui.previewLocale : 'en_US';
  const previewLocale = SUPPORTED_PREVIEW_LOCALES.includes(previewLocaleRaw) ? previewLocaleRaw : 'en_US';

  const fileId = state.files.currentFileId;
  const committedFile23 = fileId ? state.files.byId[fileId] : null;
  const draftScene23 = studioDraftScene23(cs, committedFile23);
  const file = draftScene23?.file || committedFile23;
  const selectedDefinition = file?.meta?.selectedDefinition;
  const definitionId = selectedDefinition && typeof selectedDefinition === 'object'
    ? selectedDefinition.recordId || selectedDefinition.definition || selectedDefinition.rawKey || ''
    : selectedDefinition || '';

  const selectedAdditionNode23 = draftScene23 && cs.pendingAdditionSelection23
    ? [...draftScene23.additionsByNodeId].find(([, id]) => id === cs.pendingAdditionSelection23)?.[0] : null;
  const selectedRaw = selectedAdditionNode23 || (state.editor && state.editor.selection ? state.editor.selection.nodeId : null);
  const selectedId = selectedRaw ? String(selectedRaw) : null;

  const node = file && file.nodesById && selectedId ? file.nodesById[selectedId] : null;

  const showResizeHandles = Boolean(
    selectedId && file && isCanvasNodeTransformable(file, selectedId) && node && isCanvasNodeResizable(node)
  );

  const pendingTransforms = draftScene23 ? new Map() : sourceWorkspace.pendingNodeTransforms?.(fileId) || new Map();
  const pendingLayout = draftScene23?.layout || studioPaintLayout21(cs, committedFile23, pendingTransforms);
  // drag中のclip再交差も、画面に出している草稿と同じ評価済み属性を参照する。
  const propsByIdOverride = draftScene23?.propsByIdOverride || mergePendingProperties21(cs.propsByIdOverride, pendingTransforms);
  const commitInteraction = cs.sourceCommitDraft ? workspaceSourceCommitDraftInteraction(cs.sourceCommitDraft, {
    file: committedFile23, revision: sourceWorkspace.state.revision, layout: cs.layout, context: cs.nodeFrameContext,
    view: cs.view, pendingVersion: sourceWorkspace.state.pendingVersion, selectionIds: studioSelection21(committedFile23).movementRoots(),
  }) : null;
  const movingLayout = applyCanvasDraftToLayout(pendingLayout, cs.interaction.active ? cs.interaction : commitInteraction || cs.interaction);
  const layoutForDraw = movingLayout === pendingLayout ? pendingLayout
    : applyPendingGeometry21(pendingLayout, movingLayout.boxes, {
      nodesById: file?.nodesById, propsByIdOverride,
    });

  // Cached evaluated props per node (from the bindings evaluator).
  // Stored on the canvas state during full renders so interactive redraws (zoom/pan)
  // do not require re-evaluating bindings.


  // S041: Provide decoded texture images for image elements (best-effort).
  /** @type {Record<string, any>} */
  const imageDrawById = {};
  try {
    const boxes = layoutForDraw && Array.isArray(layoutForDraw.boxes) ? layoutForDraw.boxes : [];
    const nodesById = file && file.nodesById && typeof file.nodesById === 'object' ? file.nodesById : null;

    const importedIndex = importedPackRuntime && importedPackRuntime.assetIndex ? importedPackRuntime.assetIndex : null;
    const vanillaIndex = vanillaReferenceRuntime && vanillaReferenceRuntime.assetIndex ? vanillaReferenceRuntime.assetIndex : null;

    // Geometry-only native placeholders do not require an asset index. Normal
    // images still fall through to a bounded “missing texture” state when no
    // imported/Vanilla index is available.
    if (boxes.length && nodesById) {
      const rect = canvas.getBoundingClientRect();
      const cssW = rect.width;
      const cssH = rect.height;

      const z = clampZoom(cs.view && typeof cs.view.zoom === 'number' ? cs.view.zoom : 1);
      const viewX = Number(cs.view && typeof cs.view.viewX === 'number' ? cs.view.viewX : 0) || 0;
      const viewY = Number(cs.view && typeof cs.view.viewY === 'number' ? cs.view.viewY : 0) || 0;
      const sx = (wx) => (wx - viewX) * z;
      const sy = (wy) => (wy - viewY) * z;

      let startedLoads = 0;
      const MAX_LOADS_PER_DRAW = 24;

      for (const b of boxes) {
        if (!b) continue;
        const type = String(b.type || '').toLowerCase();
        if (type !== 'image' && type !== 'custom') continue;

        const id = String(b.id);
        const node = nodesById[id] || null;
        const unknownProps = node && node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {};
        const overrideProps = propsByIdOverride && propsByIdOverride[id] && typeof propsByIdOverride[id] === 'object' ? propsByIdOverride[id] : null;
        const props = type === 'custom'
          ? mergeNativeRendererProps(unknownProps, node && node.props, overrideProps)
          : {
              ...unknownProps,
              ...(node && node.props || {}),
              ...(overrideProps || {}),
            };
        if (!props) continue;

        const nativePlaceholderKind = type === 'custom'
          ? getNativeRendererPlaceholderKind(props)
          : null;
        const nativeBannerState = nativePlaceholderKind === 'banner-pattern'
          ? getNativeBannerPreviewState(props)
          : null;
        const nativePlaceholderMetadata = nativeBannerState
          ? {
              bannerPatternIndex: nativeBannerState.patternIndex,
              bannerColorIndex: nativeBannerState.colorIndex,
            }
          : {};
        let nativeScene = null;
        let nativeResourceIssue = null;
        let nativeResourcePending = false;
        let nativeTextureRefs = [];
        let customTextureResolution = null;
        let textureRef;
        if (nativePlaceholderKind === 'enchanting-book') {
          nativeScene = resolveEnchantingBookPreviewScene(enchantingBookPreviewScene, props);
          if (!nativeScene) nativeResourceIssue = 'NATIVE_PREVIEW_STATE_INVALID';
          textureRef = nativeScene ? 'textures/entity/enchanting_table_book' : null;
          nativeTextureRefs = textureRef ? [textureRef] : [];
        } else if (nativePlaceholderKind === 'horse-entity') {
          const snapshot = requestNativeHorsePreview();
          if (snapshot.status === 'ready' && snapshot.scene && isConcretePreviewTextureRef(snapshot.textureRef)) {
            nativeScene = snapshot.scene;
            textureRef = snapshot.textureRef;
            nativeTextureRefs = Array.isArray(snapshot.textureRefs) && snapshot.textureRefs.length
              ? snapshot.textureRefs
              : [textureRef];
          } else {
            nativeResourceIssue = snapshot.issue || null;
            nativeResourcePending = snapshot.status === 'loading';
            textureRef = null;
          }
        } else if (nativePlaceholderKind === 'player-entity') {
          const snapshot = requestNativePlayerPreview();
          if (snapshot.status === 'ready' && snapshot.scene && isConcretePreviewTextureRef(snapshot.textureRef)) {
            nativeScene = snapshot.scene;
            textureRef = snapshot.textureRef;
            nativeTextureRefs = [textureRef];
          } else {
            nativeResourceIssue = snapshot.issue || null;
            nativeResourcePending = snapshot.status === 'loading';
            textureRef = null;
          }
        } else {
          if (type === 'custom') {
            customTextureResolution = resolveCustomPreviewTextureResult(props);
            textureRef = customTextureResolution?.status === 'resolved'
              ? customTextureResolution.textureRef
              : null;
            nativeResourceIssue = customTextureResolution?.issue || null;
          } else {
            textureRef = resolveLocalRuntimePropertyToken(props && props.texture, props);
          }
        }
        if (!isConcretePreviewTextureRef(textureRef) && nativePlaceholderKind) {
          imageDrawById[id] = {
            // Only the banner is an intentional, clearly diagnosed
            // surrogate. A missing/loading horse or book must never be drawn
            // as a fake model: use the ordinary loading/error marker instead.
            state: nativePlaceholderKind === 'banner-pattern'
              ? 'native-placeholder'
              : nativeResourcePending ? 'loading' : 'missing',
            placeholderKind: nativePlaceholderKind,
            resourceIssue: nativeResourceIssue || (nativeResourcePending ? null : 'MISSING_TEXTURE_REF'),
            alpha: clampUnit(b.renderAlpha, 1),
            ...nativePlaceholderMetadata,
          };
          continue;
        }
        if (!isConcretePreviewTextureRef(textureRef)
          && type === 'custom'
          && customTextureResolution?.status !== 'not-applicable') {
          imageDrawById[id] = {
            state: customTextureResolution?.status === 'pending' ? 'loading' : 'missing',
            resourceIssue: nativeResourceIssue,
            alpha: clampUnit(b.renderAlpha, 1),
          };
          continue;
        }
        if (!isConcretePreviewTextureRef(textureRef)) continue;

        const requiredTextureRefs = nativeScene && nativeTextureRefs.length
          ? nativeTextureRefs
          : [textureRef];
        if (requiredTextureRefs.some((ref) => !isConcretePreviewTextureRef(ref))) {
          imageDrawById[id] = { state: 'missing', resourceIssue: 'MISSING_TEXTURE_REF', ...nativePlaceholderMetadata };
          continue;
        }

        // Only resolve supported file systems (best-effort).
        const fs = props && typeof props.texture_file_system === 'string' ? props.texture_file_system : '';
        if (fs && fs !== 'InUserPackage' && fs !== 'InAppPackage') {
          imageDrawById[id] = {
            state: 'unsupported',
            keepRatio: typeof props.keep_ratio === 'boolean' ? props.keep_ratio : true,
            bilinear: typeof props.bilinear === 'boolean' ? props.bilinear : false,
          };
          continue;
        }

        // Skip offscreen boxes for loading.
        const x = sx(Number(b.x) || 0);
        const y = sy(Number(b.y) || 0);
        const w = (Number(b.w) || 0) * z;
        const h = (Number(b.h) || 0) * z;
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
        if (x > cssW + 50 || y > cssH + 50 || x + w < -50 || y + h < -50) continue;

        const imageMetadata = buildImageDrawMetadata(props);
        imageMetadata.alpha = clampUnit(b.renderAlpha, imageMetadata.alpha);

        const resolvedLayers = requiredTextureRefs.map((ref) => {
          const result = resolveTextureRef(String(ref), { importedIndex, vanillaIndex });
          return nativePlaceholderKind === 'player-entity'
            ? resolveDefaultPlayerTexture(result, ref, nativePlayerPreviewState) : result;
        });
        const failedResolution = resolvedLayers.find((entry) => (
          !entry || !entry.ok || !entry.resolved || (type === 'custom' && entry.collision)
        ));
        const resolved = resolvedLayers[0];
        if (failedResolution) {
          imageDrawById[id] = {
            state: 'missing',
            resourceIssue: failedResolution?.collision ? 'NATIVE_PREVIEW_TEXTURE_AMBIGUOUS' : 'MISSING_TEXTURE_REF',
            ...imageMetadata,
          };
          continue;
        }

        const textureLayers = resolvedLayers.map((entry) => {
          const packPath = String(entry.resolved.packPath || '');
          const extension = packPath.toLowerCase().match(/\.(tga|png|jpg|jpeg)$/u)?.[1] || '';
          return {
            resolved: entry.resolved,
            packPath,
            extension,
            cacheKey: `${entry.resolved.source}:${packPath}`,
          };
        });
        if (textureLayers.some((layer) => !layer.extension)) {
          imageDrawById[id] = { state: 'unsupported', ...imageMetadata };
          continue;
        }
        const nativeTextureSetLayerLimit = nativeScene
          ? computeNativeTextureSetLayerLimit(textureLayers.length, textureImageCache.limits)
          : 0;
        const requestedTextureDecodeCap = nativeScene
          ? nativeTextureSetLayerLimit
          : textureImageCache.limits.perImageMaxDecodedBytes;
        if (nativeScene && nativeTextureSetLayerLimit < 1) {
          imageDrawById[id] = {
            state: 'missing',
            resourceIssue: 'NATIVE_PREVIEW_TEXTURE_SET_TOO_LARGE',
            ...nativePlaceholderMetadata, ...imageMetadata,
          };
          continue;
        }
        const [{ packPath }] = textureLayers;

        getTextureSidecarMetadata(String(resolved.resolved.source || ''), packPath);
        const sidecarState = resolveTextureSidecarDrawState(
          { ...imageMetadata, tiledAuthored: Object.prototype.hasOwnProperty.call(props, 'tiled') },
          getTextureSidecarDrawRecord(packPath),
        );
        if (sidecarState.state !== 'ready') {
          if (sidecarState.issue) {
            const issueKey = `${sidecarState.issue}:${sidecarState.issue === 'TEXTURE_SIDECAR_CACHE_LIMIT' ? 'budget' : packPath}`;
            if (!warnedTextureSidecarDrawIssues.has(issueKey) && warnedTextureSidecarDrawIssues.size < 256) {
              warnedTextureSidecarDrawIssues.add(issueKey);
              const record = getTextureSidecarDrawRecord(packPath);
              diagnostics.log('warn', siteText('テクスチャの枠・寸法メタデータを適用できないため表示を停止しています。'), { source: 'preview/texture-sidecar', data: { code: sidecarState.issue, packPath, sourcePath: record.value?.sourcePath || packPath.replace(/\.[^.]+$/u, '.json'), sourceKind: record.value?.sourceKind || resolved.resolved.source } });
            }
          }
          imageDrawById[id] = { ...imageMetadata, state: sidecarState.state,
            resourceIssue: sidecarState.issue };
          continue;
        }
        Object.assign(imageMetadata, sidecarState.metadata);

        const cachedLayers = textureLayers.map((layer) => textureImageCache.get(layer.cacheKey));
        const oversizedCachedLayer = nativeScene
          ? cachedLayers.find((entry) => entry && Number(entry.decodedBytes) > nativeTextureSetLayerLimit)
          : null;
        if (oversizedCachedLayer) {
          if (type === 'custom') {
            for (let index = 0; index < cachedLayers.length; index += 1) {
              if (cachedLayers[index] && Number(cachedLayers[index].decodedBytes) > nativeTextureSetLayerLimit) {
                recordNativeTextureFailure(textureLayers[index].cacheKey, 'NATIVE_PREVIEW_TEXTURE_SET_TOO_LARGE');
              }
            }
          }
          imageDrawById[id] = {
            state: 'missing',
            resourceIssue: 'NATIVE_PREVIEW_TEXTURE_SET_TOO_LARGE',
            ...nativePlaceholderMetadata, ...imageMetadata,
          };
          continue;
        }
        if (cachedLayers.every(Boolean)) {
          if (type === 'custom') {
            for (const layer of textureLayers) forgetNativeTextureFailure(layer.cacheKey);
          }
          const cached = cachedLayers[0];
          imageDrawById[id] = {
            state: nativeScene ? 'native-scene' : 'ready',
            image: cached.image,
            width: cached.width,
            height: cached.height,
            nativeBaseScene: nativeScene,
            nativeControlBox: { x: b.x, y: b.y, w: b.w, h: b.h },
            nativePointerEnabled: props.property_bag?.['#look_at_cursor'] !== false && props['#look_at_cursor'] !== false,
            nativeScene: sampleNativePreviewMotion(nativeScene, {
              enabled: nativeMotionEnabled, visible: !document.hidden && !cs.previewClosed,
              timeMs: nativeMotionElapsedMs, seed: `${key}:${id}`,
              pointer: props.property_bag?.['#look_at_cursor'] === false || props['#look_at_cursor'] === false ? { active: false }
                : nativePreviewPointerForBox(cs.nativePointerWorld, b, cs.nativePointer),
            }),
            imageLayers: cachedLayers.map((entry) => ({
              image: entry.image, width: entry.width, height: entry.height,
            })),
            placeholderKind: nativePlaceholderKind,
            ...nativePlaceholderMetadata,
            ...imageMetadata,
          };
          continue;
        }

        if (textureLayers.some((layer) => textureImageCache.isLoading(layer.cacheKey))) {
          imageDrawById[id] = { state: 'loading', ...nativePlaceholderMetadata, ...imageMetadata };
          continue;
        }

        const failedLayers = textureLayers
          .map((layer) => ({
            layer,
            failure: textureImageCache.getFailure(layer.cacheKey, requestedTextureDecodeCap),
          }))
          .filter((entry) => entry.failure);
        if (failedLayers.length) {
          if (type === 'custom') {
            for (const failedLayer of failedLayers) {
              const rawFailureCode = failedLayer.failure.code || 'TEXTURE_DECODE_FAILED';
              const failureCode = nativeScene && /(?:TOO_LARGE|RESERVATION|EXCEEDS_BUDGET)/u.test(rawFailureCode)
                ? 'NATIVE_PREVIEW_TEXTURE_SET_TOO_LARGE'
                : rawFailureCode;
              recordNativeTextureFailure(
                failedLayer.layer.cacheKey,
                failureCode,
              );
            }
          }
          imageDrawById[id] = nativeScene
            ? { state: 'missing', resourceIssue: 'TEXTURE_DECODE_FAILED', ...nativePlaceholderMetadata, ...imageMetadata }
            : { state: 'missing', ...imageMetadata };
          continue;
        }

        imageDrawById[id] = { state: 'loading', ...nativePlaceholderMetadata, ...imageMetadata };

        for (const layer of textureLayers) {
          if (startedLoads >= MAX_LOADS_PER_DRAW) break;
          if (textureImageCache.get(layer.cacheKey) || textureImageCache.isLoading(layer.cacheKey)
            || textureImageCache.getFailure(layer.cacheKey, requestedTextureDecodeCap)) continue;
          const sourceKind = String(layer.resolved.source || '');
          const scheduledRuntime = nativeTextureRuntime(sourceKind);
          const scheduledCompositionEpoch = textureCompositionEpoch;
          if (!scheduledRuntime) continue;
          startedLoads += 1;

          textureImageCache
          .load(layer.cacheKey, async ({ signal, maxDecodedBytes }) => {
            const zipPath = `${scheduledRuntime.rootPrefix}${layer.packPath}`;
            const mimeType = layer.extension === 'png'
              ? 'image/png'
              : layer.extension === 'tga'
                ? 'image/x-tga'
                : 'image/jpeg';
            const previewImageReader = typeof scheduledRuntime.zipReader.readPreviewImageBlob === 'function'
              ? scheduledRuntime.zipReader.readPreviewImageBlob.bind(scheduledRuntime.zipReader)
              : scheduledRuntime.zipReader.readBlob.bind(scheduledRuntime.zipReader);
            const blob = await previewImageReader(zipPath, {
              mimeType,
              maxBytes: MAX_CANVAS_TEXTURE_BLOB_BYTES,
              signal,
            });
            return decodeImageFromBlob(blob, {
              maxPixels: textureImageCache.limits.perImageMaxPixels,
              maxDecodedBytes: Math.min(
                textureImageCache.limits.perImageMaxDecodedBytes,
                maxDecodedBytes,
              ),
              preferImageBitmap: textureImageCache.limits.preferImageBitmap,
              signal,
            });
          }, nativeScene ? { decodedByteReservation: nativeTextureSetLayerLimit } : {})
          .then(() => {
            const currentRuntime = nativeTextureRuntime(sourceKind);
            if (scheduledCompositionEpoch !== textureCompositionEpoch || currentRuntime !== scheduledRuntime) return;
            if (type === 'custom') forgetNativeTextureFailure(layer.cacheKey);
            requestCanvasTextureRedraw();
            scheduleReferenceContextRevalidation();
          })
          .catch((err) => {
            const currentRuntime = nativeTextureRuntime(sourceKind);
            if (scheduledCompositionEpoch !== textureCompositionEpoch || currentRuntime !== scheduledRuntime) return;
            const code = err instanceof Error ? err.message : String(err || 'TEXTURE_DECODE_FAILED');
            if (err?.name === 'AbortError' || /(?:ABORT|UNLOADED|SOURCE_NOT_AVAILABLE)/iu.test(code)) return;
            if (type === 'custom') {
              const nativeCode = nativeScene && /(?:TOO_LARGE|RESERVATION|EXCEEDS_BUDGET)/u.test(code)
                ? 'NATIVE_PREVIEW_TEXTURE_SET_TOO_LARGE'
                : code;
              recordNativeTextureFailure(layer.cacheKey, nativeCode);
            }
            requestCanvasTextureRedraw();
            // Avoid spamming diagnostics for repeated failures.
            try {
              logTextureFailureOnce(layer.cacheKey, () => {
                diagnostics.log('warn', `Texture preview failed: ${layer.cacheKey}`, {
                  source: 'preview',
                  data: { code, cacheKey: layer.cacheKey, packPath: layer.packPath },
                });
              });
            } catch {
              // ignore
            }
          });
        }
      }
    }
  } catch (err) {
    // Texture drawing is best-effort, but failures should be visible in Diagnostics.
    try {
      if (!drawCanvasNow._loggedTextureBuildErrors) drawCanvasNow._loggedTextureBuildErrors = new Set();
      const set = /** @type {Set<string>} */ (drawCanvasNow._loggedTextureBuildErrors);

      const signature =
        err && typeof err === 'object' && 'message' in err
          ? String(/** @type {any} */ (err).message)
          : String(err || 'UNKNOWN');

      if (!set.has(signature)) {
        set.add(signature);

        diagnostics.captureError(err, {
          source: 'preview',
          message: 'Texture draw info build failed (drawCanvasNow)',
          data: {
            fileId: fileId ? String(fileId) : null,
            filePath: file && typeof file.path === 'string' ? file.path : null,
            selectedId,
            hasPropsByIdOverride: Boolean(propsByIdOverride),
            hasImportedAssetIndex: Boolean(importedPackRuntime && importedPackRuntime.assetIndex),
            hasVanillaAssetIndex: Boolean(vanillaReferenceRuntime && vanillaReferenceRuntime.assetIndex),
          },
        });
      }
    } catch {
      // ignore
    }
  }

  // S042: Provide text draw metadata for label/button/edit_box elements (best-effort).
  /** @type {Record<string, any>} */
  const textDrawById = {};
  const textCopyCapture = preparePreviewTextCopyCapture(file, cs, layoutForDraw, canvas, selectedId);

  /** @type {any} */
  const textBuildStats = {
    previewLocale,
    totalBoxes: 0,
    nodeCount: 0,
    candidateTextBoxes: 0,
    processedTextBoxes: 0,
    skippedEmptyTextBoxes: 0,
    skippedOffscreenBoxes: 0,
    builtTextDrawCount: 0,
    startedFontLoads: 0,
    maxFontLoadsPerDraw: 0,
    hasImportedAssetIndex: false,
    hasVanillaAssetIndex: false,
    canvasCssW: null,
    canvasCssH: null,
    zoom: null,
    viewX: null,
    viewY: null,
    lastProcessedId: null,
    lastProcessedType: null,
    lastProcessedFontType: null,
  };

  try {
    const boxes = layoutForDraw && Array.isArray(layoutForDraw.boxes) ? layoutForDraw.boxes : [];
    const nodesById = file && file.nodesById && typeof file.nodesById === 'object' ? file.nodesById : null;

    textBuildStats.totalBoxes = boxes.length;
    textBuildStats.nodeCount = nodesById ? Object.keys(nodesById).length : 0;

    const importedIndex = importedPackRuntime && importedPackRuntime.assetIndex ? importedPackRuntime.assetIndex : null;
    const vanillaIndex = vanillaReferenceRuntime && vanillaReferenceRuntime.assetIndex ? vanillaReferenceRuntime.assetIndex : null;

    textBuildStats.hasImportedAssetIndex = Boolean(importedIndex);
    textBuildStats.hasVanillaAssetIndex = Boolean(vanillaIndex);

    if (boxes.length && nodesById) {
      const rect = canvas.getBoundingClientRect();
      const cssW = rect.width;
      const cssH = rect.height;

      textBuildStats.canvasCssW = cssW;
      textBuildStats.canvasCssH = cssH;

      const z = clampZoom(cs.view && typeof cs.view.zoom === 'number' ? cs.view.zoom : 1);
      const viewX = Number(cs.view && typeof cs.view.viewX === 'number' ? cs.view.viewX : 0) || 0;
      const viewY = Number(cs.view && typeof cs.view.viewY === 'number' ? cs.view.viewY : 0) || 0;

      textBuildStats.zoom = z;
      textBuildStats.viewX = viewX;
      textBuildStats.viewY = viewY;

      const sx = (wx) => (wx - viewX) * z;
      const sy = (wy) => (wy - viewY) * z;

      let startedLoads = 0;
      const MAX_FONT_LOADS_PER_DRAW = 6;

      textBuildStats.maxFontLoadsPerDraw = MAX_FONT_LOADS_PER_DRAW;

      for (const b of boxes) {
        if (!b) continue;
        const type = String(b.type || '').toLowerCase();
        if (type !== 'label' && type !== 'button' && type !== 'dropdown' && type !== 'edit_box') continue;

        textBuildStats.candidateTextBoxes += 1;

        const id = String(b.id);
        const node = nodesById[id] || null;
        const unknownProps = node && node.unknownProps && typeof node.unknownProps === 'object' ? node.unknownProps : {};
        const baseProps = node && typeof node === 'object' ? { ...unknownProps, ...(node.props || {}) } : {};
        const overrideProps = propsByIdOverride && propsByIdOverride[id] && typeof propsByIdOverride[id] === 'object' ? propsByIdOverride[id] : null;
        const props = overrideProps ? { ...baseProps, ...overrideProps } : baseProps;

        // Determine text payload.
        const textValue = selectPreviewText(type, props, resolveLocalRuntimePropertyToken);
        if (!textValue || !String(textValue).trim()) {
          textBuildStats.skippedEmptyTextBoxes += 1;
          continue;
        }

        // Skip offscreen boxes for font loading.
        const x = sx(Number(b.x) || 0);
        const y = sy(Number(b.y) || 0);
        const w = (Number(b.w) || 0) * z;
        const h = (Number(b.h) || 0) * z;
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
        if (x > cssW + 50 || y > cssH + 50 || x + w < -50 || y + h < -50) {
          textBuildStats.skippedOffscreenBoxes += 1;
          continue;
        }

        // Font size approximation.
        const fontSizeKey = typeof props.font_size === 'string' ? props.font_size : 'normal';
        const fs = String(fontSizeKey || '').trim().toLowerCase();
        const basePx = getBedrockLogicalFontPx(fs);

        let scaleFactor = 1;
        if (typeof props.font_scale_factor === 'number' && Number.isFinite(props.font_scale_factor)) {
          scaleFactor = props.font_scale_factor;
        } else if (typeof props.font_scale_factor === 'string') {
          const n = Number.parseFloat(props.font_scale_factor);
          if (Number.isFinite(n)) scaleFactor = n;
        }

        const fontPx = clampNumber(basePx * scaleFactor * z, 0.01, 256);

        const fontTypeRaw = typeof props.font_type === 'string' ? props.font_type : 'default';
        const fontType = String(fontTypeRaw || '').trim();

        textBuildStats.lastProcessedId = id;
        textBuildStats.lastProcessedType = type;
        textBuildStats.lastProcessedFontType = fontType;

        // Alignment approximation.
        let align = type === 'button' || type === 'dropdown' ? 'center' : 'left';
        if (typeof props.text_alignment === 'string') {
          const a = String(props.text_alignment).trim().toLowerCase();
          if (a === 'center' || a === 'right' || a === 'left') align = a;
        }

        const color = bedrockColorToCss(props.color);
        const shadow = Boolean(props.shadow);

        // A ready pack FontFace is required for CSS text. Engine-only families
        // stay visibly diagnosed until their actual resource backend is supported.
        let family = '';
        let state = 'unsupported';
        let fontBackend = 'unavailable';
        let fontCoverage = null;

        if (fontType && fontType.toLowerCase() !== 'default' && (importedIndex || vanillaIndex)) {
          const resolved = resolveFontTypeRef(fontType, { importedIndex, vanillaIndex });
          if (resolved && resolved.ok && resolved.resolved) {
            const packPath = String(resolved.resolved.packPath || '');
            const cacheKey = `${resolved.resolved.source}:${packPath}`;

            const cached = fontFaceCache.get(cacheKey);
            if (cached) {
              family = cached.family;
              state = 'ready';
              fontBackend = 'resource-font-face';
              fontCoverage = cached.coverage;
            } else if (fontFaceCache.isLoading(cacheKey)) {
              state = 'loading';
            } else if (fontFaceCache.getFailure(cacheKey)) {
              state = 'missing';
            } else {
              state = 'loading';
              if (startedLoads < MAX_FONT_LOADS_PER_DRAW) {
                startedLoads += 1;
                textBuildStats.startedFontLoads = startedLoads;
                fontFaceCache
                  .load(cacheKey, async (signal) => {
                    const src = resolved.resolved.source;
                    const runtime = src === 'imported' ? importedPackRuntime : vanillaReferenceRuntime;
                    if (!runtime) throw new Error('FONT_SOURCE_NOT_AVAILABLE');
                    const zipPath = `${runtime.rootPrefix}${packPath}`;
                    const nodeId = runtime.zipReader.nodePackId;
                    const coverage = nodeId ? await nodeFontCoverage({source:{kind:src,id:nodeId},path:packPath},signal)
                      : {supported:false,reasonCode:'FONT_COVERAGE_NODE_SOURCE_UNAVAILABLE'};
                    if (signal.aborted) throw new Error('FONT_LOAD_CANCELLED');

                    const ext = packPath.toLowerCase().split('.').pop() || '';
                    const mimeType = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'otf' ? 'font/otf' : 'font/ttf';
                    const blob = await runtime.zipReader.readBlob(zipPath, {
                      mimeType,
                      maxBytes: MAX_CANVAS_FONT_BLOB_BYTES,
                    });

                    if (signal.aborted) throw new Error('FONT_LOAD_CANCELLED');
                    const buf = await blob.arrayBuffer();
                    if (signal.aborted) throw new Error('FONT_LOAD_CANCELLED');
                    const family = makeFontFamilyName(src, packPath);
                    const face = new FontFace(family, buf);
                    await face.load();
                    if (signal.aborted) throw new Error('FONT_LOAD_CANCELLED');
                    try {
                      if (document && document.fonts && typeof document.fonts.add === 'function') {
                        document.fonts.add(face);
                      }
                    } catch {
                      // ignore
                    }

                    return { family, face, bytes: blob.size, coverage };
                  })
                  .then(() => {
                    // Custom glyph metrics can change default/content-sized
                    // labels and every ancestor that depends on them.
                    requestCanvasTextureMetadataRefresh();
                  })
                  .catch((err) => {
                    if (warnedFontLoadKeys.has(cacheKey)) return;
                    warnedFontLoadKeys.add(cacheKey);
                    const code = err instanceof Error ? err.message : String(err || 'UNKNOWN');
                    diagnostics.log('warn', `Font preview failed: ${cacheKey}`, {
                      source: 'preview',
                      data: { code, cacheKey, packPath },
                    });
                  });
              }
            }
          } else if (resolved && resolved.ok && resolved.builtIn) {
            state = 'unsupported';
          } else {
            state = 'missing';
          }
        }

        const runtimeToken = String(textValue).trim();
        const isUnresolvedRuntimeText = runtimeToken.startsWith('#') || runtimeToken.startsWith('$');
        if (isUnresolvedRuntimeText && !cs.structureMode) {
          textBuildStats.skippedEmptyTextBoxes += 1;
          continue;
        }

        const localizedText = props.localize === false
          ? String(textValue)
          : resolvePreviewLocalizedText(String(textValue), previewLocale);
        const padding=Number(props.line_padding);const linePadding=Number.isFinite(padding)&&padding>=0?Math.min(4096,padding)*z:0;
        const authoredTextSize = node?.props?.size;
        const wrapLabel = type === 'label' && node?.propsPresent?.size === true && Array.isArray(authoredTextSize)
          && String(authoredTextSize[0]).trim().toLowerCase() !== 'default' && String(authoredTextSize[1]).trim().toLowerCase() === 'default'
          && props.text_wrap !== false;
        const bitmapLayout = bitmapTextLayout(localizedText,fontType||'default',fontPx,color,linePadding,wrapLabel ? w : undefined,z);
        if(bitmapLayout)state=bitmapLayout.ready?'ready':bitmapLayout.loadingGlyphCount?'loading':'missing';
        else if(state!=='ready')fontNotice(state==='loading'?'FONT_FACE_LOADING':'FONT_BACKEND_UNAVAILABLE',{fontType,state});
        let textCopyGlyphsReady = true;
        if(fontBackend==='resource-font-face'){
          const coverageResult=splitFontCoverageRuns(stripBedrockFormattingCodes(localizedText).replace(/\r?\n/gu,''),fontCoverage);
          textCopyGlyphsReady = coverageResult.coverageVerified === true && !coverageResult.missingGlyphCount;
          if(!coverageResult.coverageVerified)fontNotice('FONT_COVERAGE_UNVERIFIED',{fontType,reasonCode:fontCoverage?.reasonCode||'FONT_COVERAGE_UNAVAILABLE'});
          else if(coverageResult.missingGlyphCount)fontNotice('FONT_FACE_GLYPH_UNAVAILABLE',{fontType,missingGlyphCount:coverageResult.missingGlyphCount,codepoints:coverageResult.missingCodepoints});
        }
        textDrawById[id] = {
          state,
          fontCoverage,
          fontBackend: bitmapLayout ? 'resource-bitmap' : fontBackend,
          text: bitmapLayout ? localizedText : stripBedrockFormattingCodes(localizedText),
          bitmapLayout,
          fontFamily: family,
          fontPx,
          linePadding,
          color,
          align,
          verticalAlign: resolvePreviewVerticalAlignment(type, props),
          alpha: clampUnit(b.renderAlpha, clampUnit(props.alpha, 1)),
          shadow,
        };
        if (textCopyCapture.nodesById[id]) {
          const copyNode = textCopyCapture.nodesById[id];
          textCopyCapture.segments.set(id, createRenderedTextSegment({ nodeId: id,
            visible: copyNode.visible, secret: copyNode.secret, unresolved: isUnresolvedRuntimeText,
            ready: state === 'ready' && textCopyGlyphsReady, text: copyNode.secret ? undefined : localizedText,
            provenance: previewTextCopyProvenance(String(textValue), props, previewLocale),
          }));
        }

        textBuildStats.processedTextBoxes += 1;
      }

      // Best-effort: record how many text nodes we actually built.
      textBuildStats.builtTextDrawCount = Object.keys(textDrawById).length;

      // Debug logging: print a once-per-screen summary so users can diagnose missing font/assets
      // without being spammed every frame.
      try {
        if (!drawCanvasNow._loggedTextBuildSummaries) drawCanvasNow._loggedTextBuildSummaries = new Set();
        const set = /** @type {Set<string>} */ (drawCanvasNow._loggedTextBuildSummaries);
        const activeUiScale = getActiveCanvasUiScale(cs);
        const devicePresetKey = String(cs.devicePresetKey || DEFAULT_DEVICE_PRESET_KEY);
        const mockDataVersion = Number(state.preview?.mockDataVersion) || 0;
        const k = [
          String(fileId || 'none'),
          String(file && file.path ? file.path : ''),
          String(definitionId),
          String(previewLocale),
          `${cs.uiScaleMode}:${activeUiScale}`,
          devicePresetKey,
          cs.structureMode ? 'structure' : 'safe',
          String(mockDataVersion),
        ].join('|');
        if (!set.has(k) && textBuildStats.candidateTextBoxes > 0) {
          set.add(k);
          diagnostics.log('debug', 'Text draw info build summary (drawCanvasNow)', {
            source: 'preview/canvas',
            data: {
              fileId: fileId ? String(fileId) : null,
              filePath: file && typeof file.path === 'string' ? file.path : null,
              definitionId: String(definitionId || ''),
              previewLocale,
              uiScaleMode: cs.uiScaleMode,
              activeUiScale,
              devicePresetKey,
              logicalPreset: cs.layout?.preset || null,
              displayZoom: cs.view?.zoom || null,
              structureMode: Boolean(cs.structureMode),
              mockDataVersion,
              selectedId,
              ...textBuildStats,
            },
          });
        }
      } catch {
        // ignore
      }
    }
  } catch (err) {
    // Font drawing is best-effort, but failures should be visible in Diagnostics.
    try {
      if (!drawCanvasNow._loggedFontBuildErrors) drawCanvasNow._loggedFontBuildErrors = new Set();
      const set = /** @type {Set<string>} */ (drawCanvasNow._loggedFontBuildErrors);

      const errName = err && typeof err === 'object' && 'name' in err ? String(/** @type {any} */ (err).name) : '';
      const signature =
        err && typeof err === 'object' && 'message' in err
          ? String(/** @type {any} */ (err).message)
          : String(err || 'UNKNOWN');

      const hint =
        errName === 'ReferenceError' && signature.includes('previewLocale')
          ? 'RefError: previewLocale. Likely stale cache / partial deploy OR a missing local declaration in drawCanvasNow. Ensure app/index.html and src/main.js are from the same snapshot.'
          : undefined;

      if (!set.has(signature)) {
        set.add(signature);

        diagnostics.captureError(err, {
          source: 'preview',
          message: 'Font draw info build failed (drawCanvasNow)',
          data: {
            fileId: fileId ? String(fileId) : null,
            filePath: file && typeof file.path === 'string' ? file.path : null,
            selectedId,
            previewLocale,
            hasPropsByIdOverride: Boolean(propsByIdOverride),
            hasImportedAssetIndex: Boolean(importedPackRuntime && importedPackRuntime.assetIndex),
            hasVanillaAssetIndex: Boolean(vanillaReferenceRuntime && vanillaReferenceRuntime.assetIndex),
            errorName: errName || null,
            errorMessage: signature,
            hint,
            textBuildStats,
          },
        });
      }
    } catch {
      // ignore
    }
  }

  // Keep the edit_box overlay (DOM input) aligned with the canvas view and current selection.
  // This MUST happen after layoutForDraw/cs.view are available.
  syncPreviewEditBoxOverlayPosition(key, canvas, cs.view, layoutForDraw, selectedId);

  const nativeDrawSelection = {
    selectedId,
    hoverId: cs.interaction && cs.interaction.active ? null : cs.hoverId,
    showResizeHandles,
    handlePx: 10,
    imageDrawById,
    cacheStableSources: true,
    rasterCacheEpoch: textureCompositionEpoch,
    textDrawById,
    showGuides: Boolean(cs.structureMode),
    showMissingTexturePlaceholders: Boolean(cs.structureMode),
    onImageDrawIssue: (issue) => {
      try {
        const code = String(issue?.code || 'IMAGE_DRAW_FAILED');
        const signature = `image:${String(fileId || '')}:${String(definitionId || '')}:${code}`;
        if (loggedNativeSceneIssueKeys.has(signature)) return;
        while (loggedNativeSceneIssueKeys.size >= MAX_NATIVE_TEXTURE_FAILURE_CODES) {
          loggedNativeSceneIssueKeys.delete(loggedNativeSceneIssueKeys.values().next().value);
        }
        loggedNativeSceneIssueKeys.add(signature);
        diagnostics.log('warn', siteText('画像の描画または指定された画像効果を完了できません。'), {
          source: 'preview', data: { code, fileId: String(fileId || ''), definitionId: String(definitionId || ''), nodeId: String(issue?.nodeId || '') },
        });
      } catch { /* 診断は描画を中断しない。 */ }
    },
    onNativeSceneIssue: (issue) => {
      try {
        const code = String(issue?.code || 'NATIVE_PREVIEW_DRAW_FAILED');
        const signature = `${String(fileId || '')}:${String(definitionId || '')}:${code}`;
        if (loggedNativeSceneIssueKeys.has(signature)) return;
        while (loggedNativeSceneIssueKeys.size >= MAX_NATIVE_TEXTURE_FAILURE_CODES) {
          const oldest = loggedNativeSceneIssueKeys.values().next().value;
          if (oldest === undefined) break;
          loggedNativeSceneIssueKeys.delete(oldest);
        }
        loggedNativeSceneIssueKeys.add(signature);
        diagnostics.log('warn', 'Static native preview used a bounded fallback.', {
          source: 'preview',
          data: { code, fileId: String(fileId || ''), definitionId: String(definitionId || ''), nodeId: String(issue?.nodeId || '') },
        });
      } catch {
        // Diagnostics must not interrupt canvas drawing.
      }
    },
  };
  drawCanvasPreview(canvas, layoutForDraw, cs.view, nativeDrawSelection);
  if (!cs.interaction.active) cs.editPaintSnapshot = { file: committedFile23, layout: cs.layout, paintLayout: layoutForDraw, pendingVersion: sourceWorkspace.state.pendingVersion, zoom: cs.view.zoom,
    canvas, selection: nativeDrawSelection };
  drawStudioSelection21(canvas, cs, layoutForDraw, committedFile23);
  commitPreviewTextCopyCapture(textCopyCapture);
  prepareCurrentPreviewAudio(key);
  const nativeEntries = Object.entries(imageDrawById).filter(([, info]) => info.state === 'native-scene' && info.alpha > 0 && info.nativeBaseScene?.motionMesh);
  cs.nativeMotionHasBook = nativeEntries.some(([, info]) => info.nativeBaseScene.kind === 'book' && info.nativeBaseScene.bookIdleMotion === true);
  const nativeReady = nativeEntries.length > 0 && !Object.values(imageDrawById).some((info) => info.state === 'loading')
    && !Object.values(textDrawById).some((info) => info.state === 'loading');
  if (nativeReady) {
    const rect = canvas.getBoundingClientRect();
    cs.nativeMotionSnapshot = { canvas, key, state, layout: cs.layout, props: cs.propsByIdOverride,
      view: [cs.view.zoom, cs.view.viewX, cs.view.viewY], width: rect.width, height: rect.height,
      dpr: window.devicePixelRatio, textureEpoch: textureCompositionEpoch,
      structureMode: cs.structureMode, interaction: cs.interaction, activeInteraction: Boolean(cs.interaction?.active),
      hoverId: cs.hoverId, drawLayout: layoutForDraw, drawSelection: nativeDrawSelection, nativeEntries };
  }
  startNativeMotionPreview();
  updateCanvasZoomLabel(key);
}

let nativeMotionFrameTimer = null;
let nativeMotionLastTickMs = 0;
let nativeMotionElapsedMs = 0;
let nativeMotionSnapshotOwner = null;

function stopNativeMotionPreview({ retainSnapshot = false } = {}) {
  if (nativeMotionFrameTimer !== null) clearTimeout(nativeMotionFrameTimer);
  nativeMotionFrameTimer = null;
  nativeMotionLastTickMs = 0;
  if (!retainSnapshot) {
    if (nativeMotionSnapshotOwner) nativeMotionSnapshotOwner.nativeMotionSnapshot = null;
    nativeMotionSnapshotOwner = null;
  }
}

function startNativeMotionPreview() {
  if (nativeMotionFrameTimer !== null) return;
  const state = store.getState();
  if (!nativeMotionEnabled || document.hidden || state.ui?.tabs?.center !== 'canvas') { stopNativeMotionPreview(); return; }
  const key = getCanvasKey(state.files.currentFileId), cs = getCanvasState(key);
  const canvas = document.getElementById('preview-canvas');
  // Cursor-only models redraw on pointer events; no idle timer is necessary.
  if (!canvas || cs.previewClosed) { stopNativeMotionPreview(); return; }
  if (!cs.nativeMotionHasBook) { stopNativeMotionPreview({ retainSnapshot: true }); return; }
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) { stopNativeMotionPreview(); return; }
  nativeMotionLastTickMs = performance.now();
  nativeMotionFrameTimer = setTimeout(() => {
    nativeMotionFrameTimer = null;
    const currentState = store.getState(), currentCs = getCanvasState(getCanvasKey(currentState.files.currentFileId));
    if (!nativeMotionEnabled || document.hidden || currentState.ui?.tabs?.center !== 'canvas'
      || currentCs !== cs || currentCs.previewClosed || !currentCs.nativeMotionHasBook
      || document.getElementById('preview-canvas') !== canvas) { stopNativeMotionPreview(); return; }
    const now = performance.now();
    nativeMotionElapsedMs += Math.max(0, Math.min(100, now - nativeMotionLastTickMs));
    requestCanvasTextureRedraw({ nativeOnly: true });
    startNativeMotionPreview();
  }, 40);
}

function drawNativeMotionFromSnapshot(key, canvas, cs) {
  const snapshot = cs.nativeMotionSnapshot;
  if (!snapshot || cs.previewClosed || document.hidden || snapshot.key !== key || snapshot.canvas !== canvas
    || snapshot.state !== store.getState() || snapshot.layout !== cs.layout || snapshot.props !== cs.propsByIdOverride
    || snapshot.textureEpoch !== textureCompositionEpoch || snapshot.structureMode !== cs.structureMode
    || snapshot.interaction !== cs.interaction || snapshot.activeInteraction || cs.interaction?.active
    || snapshot.hoverId !== cs.hoverId || snapshot.dpr !== window.devicePixelRatio
    || snapshot.view.some((v, i) => v !== [cs.view.zoom, cs.view.viewX, cs.view.viewY][i])) return false;
  const rect = canvas.getBoundingClientRect();
  if (rect.width !== snapshot.width || rect.height !== snapshot.height) return false;
  for (const [id, info] of snapshot.nativeEntries) {
    info.nativeScene = sampleNativePreviewMotion(info.nativeBaseScene, {
      enabled: nativeMotionEnabled, visible: true, timeMs: nativeMotionElapsedMs,
      seed: `${key}:${id}`, pointer: info.nativePointerEnabled === false ? { active: false }
        : nativePreviewPointerForBox(cs.nativePointerWorld, info.nativeControlBox, cs.nativePointer),
    });
  }
  drawCanvasPreview(canvas, snapshot.drawLayout, cs.view, snapshot.drawSelection);
  if (snapshot.drawLayout === cs.layout) cs.editPaintSnapshot = {
    file: snapshot.state.files.byId[snapshot.state.files.currentFileId], layout: cs.layout,
    zoom: cs.view.zoom, canvas, selection: { ...snapshot.drawSelection },
  };
  return true;
}

function zoomCanvasAtPivotPx(key, factor, pivotPx) {
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('preview-canvas'));
  if (!canvas) return;

  const cs = getCanvasState(key);
  ensureCanvasViewInitialized(canvas, cs, cs.layout?.preset || DEFAULT_CANVAS_PRESET);

  const rect = canvas.getBoundingClientRect();
  const px = Math.max(0, Math.min(Number.isFinite(pivotPx?.x) ? pivotPx.x : rect.width / 2, rect.width));
  const py = Math.max(0, Math.min(Number.isFinite(pivotPx?.y) ? pivotPx.y : rect.height / 2, rect.height));

  const before = canvasPxToWorld(px, py, cs.view);
  const nextZoom = clampZoom((Number(cs.view.zoom) || 1) * (Number(factor) || 1));

  cs.view.zoom = nextZoom;
  cs.view.viewX = before.x - px / nextZoom;
  cs.view.viewY = before.y - py / nextZoom;

  drawCanvasNow(key);
}

function fitCanvasView(key) {
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('preview-canvas'));
  if (!canvas) return;

  const cs = getCanvasState(key);
  const rect = canvas.getBoundingClientRect();
  const preset = cs.layout?.preset || DEFAULT_CANVAS_PRESET;

  const next = fitViewToPreset(rect.width, rect.height, preset, 24);
  cs.view = { ...next, initialized: true };

  drawCanvasNow(key);
}

function fitCanvasUiView(key) {
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('preview-canvas'));
  if (!canvas) return;
  const cs = getCanvasState(key);
  const bounds = cs.focusBounds;
  if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) {
    fitCanvasView(key);
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const next = fitViewToBounds(rect.width, rect.height, bounds, 24, getActiveCanvasUiScale(cs));
  cs.view = { ...next, initialized: true };
  drawCanvasNow(key);
}

/**
 * Canvas panel body (Center > Canvas tab).
 * Renders bounding boxes for the currently open file.
 *
 * @param {import('./state-store/app-store.js').AppState} state
 */
let previewAssetMetricsRevision = 0;

let nodeFrameAvailability = null;
let nodeFrameCapabilityPending = false;
let previewProcessingStatus = '処理方式を確認しています…';
let previewProcessingStatusUpdatedAt = 0;
function updatePreviewProcessingStatus(message) {
  const now = performance.now();
  if (message.startsWith(siteText('Node計算 /')) && previewProcessingStatus.startsWith(siteText('Node計算 /')) && now - previewProcessingStatusUpdatedAt < 500) return;
  previewProcessingStatusUpdatedAt = now;
  previewProcessingStatus = message;
  const status = document.getElementById('preview-processing-status');
  if (status) status.textContent = translateSiteMessage(message);
}
function checkNodeFrameAvailability() {
  if (nodeFrameCapabilityPending || nodeFrameAvailability !== null) return;
  nodeFrameCapabilityPending = true;
  supportsNodeFrameIr().then((available) => {
    nodeFrameAvailability = available;
    updatePreviewProcessingStatus(available ? siteText('Nodeで解釈・配置を計算') : siteText('ブラウザ互換モード'));
    for (const cs of Object.values(canvasUiState.byFileKey)) cs.layoutInputKey = null;
    scheduledWorkspaceRender.request();
  }).catch((error) => {
    // A failed connection is visible and is never silently a heavy fallback.
    updatePreviewProcessingStatus(siteText`Node接続エラー: ${error.message}。表示を再計算で再試行できます。`);
    diagnostics.captureError(error, { source: 'node-frame' });
  }).finally(() => { nodeFrameCapabilityPending = false; });
}
const nodeFrameController = createNodeFrameController({
  onStatus(status) {
    if (status === 'working') studioActivities26.set('frame', { operation: 'frame', startedAt: Date.now(), progress: {} });
    else { studioActivities26.delete('frame'); syncStudioProgress26(); }
  },
  request: payload => requestNodeFramePayload(payload, { request: renderNodeFrame, prepareFile: prepareNodeFrameFile }),
  onResult: (result, job) => {
    const state = store.getState();
    const activeFile = state.files.byId[state.files.currentFileId];
    if (activeFile?.id !== job.file.id || activeFile.uiModel !== job.file.uiModel || activeFile.nodesById !== job.file.nodesById) return;
    const cs = getCanvasState(getCanvasKey(job.file.id));
    const currentContext = `${previewLayoutInputKey({ state, canvasState: cs, preset: getLogicalCanvasPreset(cs), assetMetricsRevision: previewAssetMetricsRevision })}|${previewAnimationEvent}`;
    if (cs.nodeFrameContext !== job.contextKey || currentContext !== job.contextKey) return;
    if (result.uiInstanceId !== cs.uiInstanceId) return;
    const checkedFrameState = normalizeLocalToggleState(result.bindings?.localToggleState, { instanceId: cs.uiInstanceId });
    if (!result.bindings?.localToggleState || !checkedFrameState.ok || checkedFrameState.state.revision !== cs.localToggleState?.revision) {
      updatePreviewProcessingStatus(siteText('描画結果の状態が一致しません。表示を再計算してください。')); return;
    }
    const firstContextFrame = cs.nodeFrameAppliedContext !== job.contextKey;
    cs.nodeFrameAppliedContext = job.contextKey;
    cs.nodeFrameAppliedFile = job.file;
    cs.layout = result.layout;
    cs.propsByIdOverride = result.propsById || {};
    cs.basePropsByIdOverride = result.basePropsById || result.propsById || {};
    cs.baseLayout = result.layout;
    cs.bindingsEvalStats = result.bindings?.stats || {};
    cs.bindingsWarnings = result.bindings?.warnings || [];
    cs.localToggleState = result.bindings?.localToggleState || cs.localToggleState;
    cs.bindingDiagnostics = result.bindings?.diagnostics || [];
    cs.bindingObservationComplete = result.bindings?.observationCaptureComplete === true;
    cs.bindingQuality = summarizeBindingQuality(result.bindings, { model: activeFile.uiModel, propsById: result.propsById, visibilityMode: cs.structureMode ? 'structure' : 'safe' });
    cs.layoutError = null;
    cs.nodeFrameMetrics = result.metrics;
    cs.nodeAnimationSummary = result.animation;
    const animationStatus41=document.getElementById('preview-animation-quality');
    if(animationStatus41) animationStatus41.textContent=previewAnimationQualityText41(result.animation);
    // 最初の有効フレームは DOM の再構築を伴わない場合もある。
    syncWorkspacePreviewGate();
    cs.focusBounds = findCanvasUiFocusBounds(job.file, cs.layout, cs.propsByIdOverride);
    updatePreviewProcessingStatus(cs.bindingQuality.status === 'passed'
      ? siteText`Node計算 / ${cs.layout.boxes.length} 要素 / ${Number(result.metrics?.durationMs ?? result.metrics?.elapsedMs ?? 0).toFixed(1)} ms`
      : siteText`表示・操作の条件が未確定です (${cs.bindingQuality.critical_count || 0})。この表示は確認用です。`);
    // 同じUIへの値更新でリソース一覧・エディター全体を破棄しない。
    if (firstContextFrame && cs.nodeWorkspaceFile?.uiModel !== job.file.uiModel) {
      cs.nodeWorkspaceFile = job.file;
      scheduledWorkspaceRender.request();
    } else {
      if (firstContextFrame) {
        const timeline = document.querySelector?.('.preview-timeline');
        if (timeline) timeline.replaceWith(renderPreviewTimeline(job.file));
      }
      drawCanvasNow(getCanvasKey(job.file.id));
    }
    if (result.animation?.active === false && previewPlayback.state.playing) previewPlayback.pause();
    if (cs.nodeMeasuredContext !== job.contextKey) {
      cs.nodeMeasuredContext = job.contextKey;
      const base = result.basePropsById || result.propsById || {};
      const textured = mergeCachedTextureIntrinsicSizes(job.file, base);
      const measured = mergeTextIntrinsicSizes(job.file, textured, state.ui?.previewLocale || 'en_US', cs.layout);
      cs.nodeIntrinsicOverrides = intrinsicSizeOverrides(base, measured);
      if (Object.keys(cs.nodeIntrinsicOverrides).length) {
        cs.nodeFrameRequestKey = null;
        requestPreviewNodeFrame(state, job.file, cs, cs.layoutInputKey, previewPlayback.state.seconds);
      }
    }
  },
  onError: (error, job) => {
    if (sourceWorkspace.state.workspaceId && sourceWorkspace.previewBlocked()) return;
    const state = store.getState(), activeFile = state.files.byId[state.files.currentFileId];
    if (activeFile?.id !== job.file.id || activeFile.uiModel !== job.file.uiModel || activeFile.nodesById !== job.file.nodesById) return;
    const cs = getCanvasState(getCanvasKey(job.file.id));
    const currentContext = `${previewLayoutInputKey({ state, canvasState: cs, preset: getLogicalCanvasPreset(cs), assetMetricsRevision: previewAssetMetricsRevision })}|${previewAnimationEvent}`;
    if (cs.nodeFrameContext !== job.contextKey || currentContext !== job.contextKey) return;
    const explanation = describeNodeFrameError(error);
    cs.layoutError = { name: error.name || 'Error', message: explanation };
    previewPlayback.pause();
    updatePreviewProcessingStatus(siteText`Node計算エラー: ${explanation}`);
    diagnostics.captureError(error, { source: 'node-frame', message: siteText('Nodeの解釈・配置計算に失敗しました。') });
    scheduledWorkspaceRender.request();
  },
});
function requestPreviewNodeFrame(state, file, cs, cacheKey, seconds = previewPlayback.state.seconds) {
  if (studioRuntimeChangesBlocked21()) return;
  if (sourceWorkspace.state.workspaceId && sourceWorkspace.previewBlocked()) return;
  const contextKey = `${cacheKey}|${previewAnimationEvent}`;
  const requestKey = `${contextKey}|${seconds}`;
  if (cs.nodeFrameRequestKey === requestKey) return;
  if (cs.nodeFrameContext !== contextKey) {
    cs.nodeFrameContext = contextKey;
    cs.nodeIntrinsicOverrides = undefined;
    cs.nodeMeasuredContext = null;
  }
  cs.nodeFrameRequestKey = requestKey;
  if (cs.nodeFrameAppliedContext !== contextKey) updatePreviewProcessingStatus(siteText('Nodeで計算中…'));
  nodeFrameController.submit({ file, contextKey, input: {
    contextRevision: contextKey,
    preset: getLogicalCanvasPreset(cs), qualifiedName: getSelectedPreviewQualifiedName(file),
    mockData: state.preview?.mockData || {}, collectionData: state.preview?.mockData?.__collections || {},
    uiInstanceId: cs.uiInstanceId, localToggleState: cs.localToggleState,
    propsByIdOverride: cs.previewTopicRootId ? { ...cs.nodeIntrinsicOverrides, [cs.previewTopicRootId]: { ...cs.nodeIntrinsicOverrides?.[cs.previewTopicRootId], visible: true } } : cs.nodeIntrinsicOverrides, scrollById: { ...(cs.scrollById || {}) },
    visibilityMode: cs.structureMode ? 'structure' : 'safe', animationTime: seconds,
    animationEvent: previewAnimationEvent,
  } });
}

function ensurePreviewLayout(state) {
  if (sourceWorkspace.state.pendingOperations?.length) return getCanvasState(getCanvasKey(state.files.currentFileId));
  const fileId = state.files.currentFileId;
  const key = getCanvasKey(fileId);
  const file = fileId ? state.files.byId[fileId] : null;
  const cs = getCanvasState(key);
  const canvasPreset = getLogicalCanvasPreset(cs);
  ensureLocalToggleSession40(cs, file);
  const previewLocale = state.ui?.previewLocale || 'en_US';
  // 待機中の旧モデルを layoutInputFile に記憶すると、確定後も同じ入力と
  // 誤判定されて新フレームを要求できなくなるため、記憶より先に止める。
  if (sourceWorkspace.state.workspaceId && sourceWorkspace.previewBlocked()) return cs;
  const cacheKey = previewLayoutInputKey({ state, canvasState: cs, preset: canvasPreset, assetMetricsRevision: previewAssetMetricsRevision });
  const sameLayoutFile = cs.layoutInputFile === file || Boolean(file?.meta?.previewProjection && cs.layoutInputFile?.id === file.id
    && cs.layoutInputFile.uiModel === file.uiModel && cs.layoutInputFile.nodesById === file.nodesById);
  if (sameLayoutFile && cs.layoutInputKey === cacheKey) return cs;
  const layoutStarted = performance.now();
  checkNodeFrameAvailability();
  if (file && nodeFrameAvailability !== false) {
    const changedFile = !sameLayoutFile;
    cs.layoutInputFile = file;
    cs.layoutInputKey = cacheKey;
    if (changedFile) { cs.nodeFrameRequestKey = null; cs.nodeFrameContext = null; }
    if (nodeFrameAvailability === true) requestPreviewNodeFrame(state, file, cs, cacheKey);
    return cs;
  }
  if (!file) nodeFrameController.invalidate();
  if (file) {
    const evalResult = getOrComputeBindingsEvalResult(fileId ? String(fileId) : null, file, state);
    let propsByIdOverride = evalResult && evalResult.propsById ? evalResult.propsById : null;
    propsByIdOverride = mergeCachedTextureIntrinsicSizes(file, propsByIdOverride);
    propsByIdOverride = mergeTextIntrinsicSizes(file, propsByIdOverride, previewLocale, cs.layout);
    if (cs.previewTopicRootId) propsByIdOverride = { ...propsByIdOverride, [cs.previewTopicRootId]: { ...propsByIdOverride?.[cs.previewTopicRootId], visible: true } };
    cs.propsByIdOverride = propsByIdOverride;
    cs.bindingsEvalStats = evalResult && evalResult.stats ? { ...evalResult.stats } : null;
    cs.bindingsWarnings = evalResult && Array.isArray(evalResult.warnings) ? evalResult.warnings.slice() : [];
    cs.bindingDiagnostics = evalResult?.diagnostics || [];
    cs.bindingObservationComplete = evalResult?.observationCaptureComplete === true;
    cs.bindingQuality = summarizeBindingQuality(evalResult, { model: file.uiModel, propsById: evalResult?.propsById, visibilityMode: cs.structureMode ? 'structure' : 'safe' });


    try {
      cs.layout = computeLayoutBoxesForFile(file, canvasPreset, {
        maxBoxes: 5000,
        propsByIdOverride: propsByIdOverride || undefined,
        scrollById: cs.scrollById || undefined,
        visibilityMode: cs.structureMode ? 'structure' : 'safe',
      });
      cs.focusBounds = findCanvasUiFocusBounds(file, cs.layout, propsByIdOverride);
      cs.layoutError = null;
    } catch (err) {
      // Defense-in-depth: a preview/layout bug must not crash the entire app render.
      // Capture context-rich diagnostics for debugging.
      const filePath = file && typeof file.path === 'string' ? file.path : '';
      const rootId = file && typeof file.rootId === 'string' ? file.rootId : '';
      const nodeCount = file && file.nodesById && typeof file.nodesById === 'object' ? Object.keys(file.nodesById).length : 0;

      const errName =
        err && typeof err === 'object' && 'name' in err ? String(/** @type {any} */ (err).name) : '';
      const errMessage =
        err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err || '');
      cs.layoutError = {
        name: errName || 'Error',
        message: errMessage || 'CANVAS_LAYOUT_ERROR',
      };
      const isIsVisibleRefError = errName === 'ReferenceError' && errMessage.includes('isVisibleFromProps');
      const isOverridePropsRefError = errName === 'ReferenceError' && errMessage.includes('overrideProps');

      diagnostics.captureError(err, {
        source: 'preview/canvas',
        message: 'Canvas layout compute failed',
        data: {
          fileId: fileId ? String(fileId) : '',
          filePath,
          rootId,
          nodeCount,
          maxBoxes: 5000,
          previewLocale,
          hasPropsByIdOverride: Boolean(propsByIdOverride),
          propsByIdOverrideCount:
            propsByIdOverride && typeof propsByIdOverride === 'object' ? Object.keys(propsByIdOverride).length : 0,
          selectedNodeId: state && state.editor && state.editor.selection ? state.editor.selection.nodeId : null,
          uiRoute: state && state.ui ? state.ui.route : null,
          uiCenterTab: state && state.ui && state.ui.tabs ? state.ui.tabs.center : null,
          uiRightTab: state && state.ui && state.ui.tabs ? state.ui.tabs.right : null,
          errorName: errName,
          errorMessage: errMessage,
          canvasPreviewUrl: new URL('./preview/canvas-preview.js', import.meta.url).toString(),
          hint: isIsVisibleRefError
            ? 'Likely stale cache / partial deploy. Ensure app/index.html, src/main.js, and src/preview/canvas-preview.js are from the same snapshot. (RefError: isVisibleFromProps)'
            : isOverridePropsRefError
              ? 'Likely stale cache / partial deploy. Ensure app/index.html, src/main.js, and src/preview/canvas-preview.js are from the same snapshot. (RefError: overrideProps)'
              : undefined,
        },
      });

      cs.layout = {
        preset: { ...canvasPreset },
        boxes: [],
        stats: { totalNodes: 0, renderedBoxes: 0, boxCount: 0, truncated: false, maxBoxes: 5000 },
        warnings: ['CANVAS_LAYOUT_ERROR'],
        scrollMetaById: {},
      };
    }
  } else {
    cs.propsByIdOverride = null;
    cs.bindingsEvalStats = null;
    cs.bindingsWarnings = [];
    cs.layoutError = null;
    cs.focusBounds = null;
    cs.layout = {
      preset: { ...canvasPreset },
      boxes: [],
      stats: { totalNodes: 0, renderedBoxes: 0, boxCount: 0, truncated: false, maxBoxes: 5000 },
      warnings: [],
      scrollMetaById: {},
    };
  }

  cs.layoutInputFile = file;
  cs.layoutInputKey = cacheKey;
  cs.baseLayout = cs.layout;
  cs.basePropsByIdOverride = cs.propsByIdOverride;
  previewPerformance.record('layout', performance.now() - layoutStarted);
  return cs;
}

const previewViewport = createPreviewViewportController({
  document,
  onResize: expanded => {
    const generation = previewViewport.generation;
    requestAnimationFrame(() => {
      if (previewViewport.generation !== generation || previewViewport.active !== expanded) return;
      const state = store.getState(); const key = getCanvasKey(state.files.currentFileId);
      hidePreviewEditBoxOverlay('viewport-resize');
      if (expanded) fitCanvasUiView(key); else drawCanvasNow(key);
    });
  },
  onExit: snapshot => {
    if (snapshot?.key && snapshot.view) Object.assign(getCanvasState(snapshot.key).view, snapshot.view);
    if (snapshot?.panels) { studioUi.leftOpen = snapshot.panels.leftOpen; studioUi.rightOpen = snapshot.panels.rightOpen; safeRender(); }
  },
  onNotice: message => setStatus(message),
});

function toggleStudioViewport23(key) {
  if (previewViewport.active) return previewViewport.exit();
  const snapshot = { key, view: { ...getCanvasState(key).view }, panels: { leftOpen: studioUi.leftOpen, rightOpen: studioUi.rightOpen } };
  studioUi.leftOpen = false; studioUi.rightOpen = false; safeRender();
  return previewViewport.enter(snapshot);
}

function renderCanvasPanel(state) {
  const fileId = state.files.currentFileId;
  const key = getCanvasKey(fileId);
  const file = fileId ? state.files.byId[fileId] : null;

  const previewLocaleRaw = state.ui && typeof state.ui.previewLocale === 'string' ? state.ui.previewLocale : 'en_US';
  const previewLocale = SUPPORTED_PREVIEW_LOCALES.includes(previewLocaleRaw) ? previewLocaleRaw : 'en_US';

  /** @param {Event} ev */
  const onChangePreviewLocale = (ev) => {
    const target = /** @type {HTMLSelectElement|null} */ (ev.target);
    const next = String(target && target.value ? target.value : 'en_US');
    store.dispatch(actions.setPreviewLocale(next));
    safeWriteStoredPreviewLocale(next);
    requestCanvasTextureRedraw();
  };
  const previewFontProfile = state.ui?.previewFontProfile || 'bitmap';
  const onChangePreviewFontProfile = (ev) => {
    assertStudioExternalChange21('プレビュー字体の変更');
    const next = String(ev.target?.value || 'bitmap');
    store.dispatch(actions.setPreviewFontProfile(next));
    requestCanvasTextureMetadataRefresh();
  };

  const cs = getCanvasState(key);
  cs.sourceEditing = sourceWorkspace.state.mode === 'edit';
  cs.sourcePreviewBlocked = workspacePreviewBlocked();
  const canvasUiScale = getActiveCanvasUiScale(cs);
  const canvasPreset = getLogicalCanvasPreset(cs);

  /** @param {Event} ev */
  const onChangeCanvasUiScale = (ev) => {
    assertStudioExternalChange21('プレビューの UI スケール変更');
    const target = /** @type {HTMLSelectElement|null} */ (ev.target);
    const raw = String(target && target.value ? target.value : 'auto');
    if (raw === 'auto') {
      cs.uiScaleMode = 'auto';
    } else {
      cs.uiScaleMode = 'manual';
      cs.manualUiScale = Math.max(1, Math.min(8, Math.round(Number(raw) || DEFAULT_CLASSIC_UI_SCALE)));
    }
    cs.view.initialized = false;
    safeRender();
  };

  /** @param {Event} ev */
  const onChangeDevicePreset = (ev) => {
    assertStudioExternalChange21('プレビューの端末サイズ変更');
    const target = /** @type {HTMLSelectElement|null} */ (ev.target);
    const next = String(target && target.value ? target.value : DEFAULT_DEVICE_PRESET_KEY);
    cs.devicePresetKey = Object.prototype.hasOwnProperty.call(DEVICE_CANVAS_PRESETS, next)
      ? next
      : DEFAULT_DEVICE_PRESET_KEY;
    cs.view.initialized = false;
    safeRender();
  };

  ensurePreviewLayout(state);

  const truncated = Boolean(cs.layout?.stats?.truncated);
  const renderedBoxes = Number(cs.layout?.stats?.renderedBoxes) || 0;
  const totalNodes = Number(cs.layout?.stats?.totalNodes) || 0;

  const hint = t('editor.canvas.hint');
  const hintText =
    hint && !String(hint).startsWith('⟦MISSING:')
      ? String(hint)
      : 'Wheel: zoom • Drag: pan • Click: select';

  const devicePreset = DEVICE_CANVAS_PRESETS[String(cs.devicePresetKey || '')]
    || DEVICE_CANVAS_PRESETS[DEFAULT_DEVICE_PRESET_KEY];
  const presetLabel = `${devicePreset.width}×${devicePreset.height} physical → ${Math.round(canvasPreset.width)}×${Math.round(canvasPreset.height)} logical • UI ${canvasUiScale}×`;

  /** @param {WheelEvent} ev */
    const onWheel = (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch {
        // ignore
      }

      const canvas = /** @type {HTMLCanvasElement|null} */ (ev.currentTarget);
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;

      const cs2 = getCanvasState(key);
      ensureCanvasViewInitialized(canvas, cs2, (cs2.layout && cs2.layout.preset) || DEFAULT_CANVAS_PRESET);

      const world = canvasPxToWorld(px, py, cs2.view);
      const boxes = cs2.layout && Array.isArray(cs2.layout.boxes) ? cs2.layout.boxes : [];

      // If the pointer is over a scroll_view, treat wheel as scrolling (unless Ctrl/Meta is held).
      if (getInteractionPreviewContext(key).enabled && !ev.ctrlKey && !ev.metaKey && boxes.length) {
        const hit = hitTestBoxes(boxes, world.x, world.y, cs2.layout?.preset || null);
        if (hit) {
          /** @type {Map<string, import('./preview/canvas-preview.js').LayoutBox>} */
          const byId = new Map();
          for (const b of boxes) {
            if (b && b.id) byId.set(String(b.id), b);
          }

          let curId = String(hit.id);
          /** @type {import('./preview/canvas-preview.js').LayoutBox|null} */
          let svBox = null;

          for (let guard = 0; guard < 256 && curId; guard++) {
            const b = byId.get(curId);
            if (!b) break;
            if (String(b.type || '').toLowerCase() === 'scroll_view') {
              svBox = b;
              break;
            }
            curId = b.parentId ? String(b.parentId) : '';
          }

          if (svBox) {
            const svId = String(svBox.id);

            const z = clampZoom(cs2.view && typeof cs2.view.zoom === 'number' ? cs2.view.zoom : 1);

            let dx = (Number(ev.deltaX) || 0) / z;
            let dy = (Number(ev.deltaY) || 0) / z;

            // Common mouse wheel pattern: Shift+wheel = horizontal scrolling.
            if (ev.shiftKey && Math.abs(dx) < 0.001) {
              dx = dy;
              dy = 0;
            }

            const current = cs2.scrollById && typeof cs2.scrollById === 'object' ? cs2.scrollById[svId] : null;
            const curX = current ? Number(current.x) || 0 : 0;
            const curY = current ? Number(current.y) || 0 : 0;

            let nextX = curX + dx;
            let nextY = curY + dy;

            const meta =
              cs2.layout && cs2.layout.scrollMetaById && typeof cs2.layout.scrollMetaById === 'object'
                ? cs2.layout.scrollMetaById[svId]
                : null;

            if (meta) {
              const maxX = Number(meta.maxScrollX) || 0;
              const maxY = Number(meta.maxScrollY) || 0;
              nextX = clampNumber(nextX, 0, maxX);
              nextY = clampNumber(nextY, 0, maxY);
            } else {
              nextX = Math.max(0, nextX);
              nextY = Math.max(0, nextY);
            }

            if (!cs2.scrollById || typeof cs2.scrollById !== 'object') cs2.scrollById = Object.create(null);
            cs2.scrollById[svId] = { x: nextX, y: nextY };
            cs2.scrollRevision = (cs2.scrollRevision || 0) + 1;

            // Bindings/layout/animation use the same Node path as data changes.
            ensurePreviewLayout(store.getState());

            drawCanvasNow(key);
            return;
          }
        }
      }

      // Otherwise: zoom.
      // Trackpads can produce small continuous deltas, so use an exponential mapping.
      const factor = Math.pow(1.001, -Number(ev.deltaY || 0));
      zoomCanvasAtPivotPx(key, factor, { x: px, y: py });
    };

    /** @param {PointerEvent} ev */
  const onPointerDown = (ev) => {
    const canvas = /** @type {HTMLCanvasElement|null} */ (ev.currentTarget);
    if (!canvas || ev.button === 2) return;
    closeStudioContextMenu21();
    canvas.focus({preventScroll:true});

    const cs2 = getCanvasState(key);
    if (cs2.sourceCommitDraft) return;
    ensureCanvasViewInitialized(canvas, cs2, cs2.layout?.preset || DEFAULT_CANVAS_PRESET);

    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const world = canvasPxToWorld(px, py, cs2.view);

    const s = store.getState();
    const fid = s.files.currentFileId;
    const f = fid ? s.files.byId[fid] : null;
    if (cs2.sourcePreviewBlocked) return;
    const sourceEditing = Boolean(cs2.sourceEditing && f?.meta?.previewProjection);
    const canEdit = Boolean(f && !f.readOnly);

    const selectedRaw = s.editor && s.editor.selection ? s.editor.selection.nodeId : null;
    const selectedId = selectedRaw ? String(selectedRaw) : null;

    const hitContext = getInteractionPreviewContext(key);
    const hit = sourceEditing ? hitTestSourceCanvas(key, f, world) : hitContext.enabled && !hitContext.pocket
      ? hitTestUiInteraction(hitContext, world.x, world.y, cs2.layout?.preset || null)
      : hitTestBoxes(cs2.layout?.boxes || [], world.x, world.y, cs2.layout?.preset || null);
    const hitId = hit ? String(hit.id) : null;

    // Reset interaction state.
    cs2.interaction.active = true;
    cs2.interaction.pointerId = ev.pointerId;
    cs2.interaction.mode = 'none';
    cs2.interaction.sourceFile = null;
    cs2.interaction.insertionDrag33 = null;
    cs2.interaction.pendingAdditionDrag23 = null;
    cs2.interaction.groupIds = null;
    cs2.interaction.sourceDrag = null;
    cs2.interaction.targetId = null;
    cs2.interaction.handle = null;
    cs2.interaction.startClientX = ev.clientX;
    cs2.interaction.startClientY = ev.clientY;
    cs2.interaction.startWorldX = world.x;
    cs2.interaction.startWorldY = world.y;
    cs2.interaction.startViewX = cs2.view.viewX;
    cs2.interaction.startViewY = cs2.view.viewY;
    cs2.interaction.startBox = null;
    cs2.interaction.draftBox = null;
    cs2.interaction.moved = false;

    if(sourceEditing && sourceWorkspace.state.addType && ev.button===0 && !ev.altKey) {
      cs2.interaction.mode='insert';cs2.interaction.sourceFile=f;
      cs2.interaction.startBox={x:world.x,y:world.y,w:0,h:0};cs2.interaction.draftBox={...cs2.interaction.startBox};
      cs2.interaction.insertionDrag33={file:f,workspaceId:sourceWorkspace.state.workspaceId,revision:sourceWorkspace.state.revision,pendingVersion:sourceWorkspace.state.pendingVersion,generation:sourceWorkspace.state.addGeneration32};
      try{canvas.setPointerCapture(ev.pointerId);}catch{}canvas.style.cursor='crosshair';return;
    }
    const additionScene23 = sourceEditing ? studioDraftScene23(cs2, f) : null;
    const pendingAdditionId23 = additionScene23?.additionsByNodeId.get(hitId);
    const selectedAdditionNode33=additionScene23 && cs2.pendingAdditionSelection23
      ? [...additionScene23.additionsByNodeId].find(([,id])=>id===cs2.pendingAdditionSelection23)?.[0] : null;
    const resizeId33=selectedAdditionNode33||selectedId;
    const resizeLayout33=sourceEditing&&resizeId33 ? additionScene23?.layout||studioPaintLayout21(cs2,f) : null;
    const resizeBoxStart33=resizeLayout33?.boxes.find(box=>box.id===resizeId33);
    const resizeNode33=(additionScene23?.file||f)?.nodesById?.[resizeId33];
    if(sourceEditing && ev.button===0 && !ev.altKey && !sourceWorkspace.state.addType && resizeBoxStart33 && isCanvasNodeResizable(resizeNode33)) {
      const handle33=hitTestResizeHandles(getResizeHandlesForBox(resizeBoxStart33,cs2.view),world.x,world.y,cs2.layout?.preset||null);
      if(handle33) {
        try {
          if(selectedAdditionNode33)assertStudioPendingAdditionUnlocked26(cs2.pendingAdditionSelection23);
          else { if(studioSelection21(f).snapshot().selectedIds.length!==1)throw new Error('サイズ変更する要素を1つ選んでください。');assertStudioUnlocked26(f,[resizeId33]); }
        } catch(error) {cs2.interaction.active=false;reportWorkspaceError(error);return;}
        cs2.interaction.mode='resize';cs2.interaction.targetId=resizeId33;cs2.interaction.handle=handle33.kind;
        cs2.interaction.groupIds=[resizeId33];cs2.interaction.startBox={x:resizeBoxStart33.x,y:resizeBoxStart33.y,w:resizeBoxStart33.w,h:resizeBoxStart33.h};
        cs2.interaction.draftBox={...cs2.interaction.startBox};
        if(selectedAdditionNode33)cs2.interaction.pendingAdditionDrag23={scene:additionScene23,file:f,version:sourceWorkspace.state.pendingVersion,view:[cs2.view.zoom,cs2.view.viewX,cs2.view.viewY]};
        else {cs2.interaction.sourceFile=f;cs2.interaction.sourceDrag=captureWorkspaceSourceDrag({file:f,revision:sourceWorkspace.state.revision,layout:cs2.layout,context:cs2.nodeFrameContext,view:cs2.view,pendingVersion:sourceWorkspace.state.pendingVersion,selectionIds:[resizeId33]});}
        canvas.focus({preventScroll:true});try{canvas.setPointerCapture(ev.pointerId);}catch{}
        canvas.style.cursor=cursorForHandle(handle33.kind);return;
      }
    }

    if (sourceEditing && pendingAdditionId23 && ev.button === 0 && !ev.altKey && !sourceWorkspace.state.addType) {
      try { assertStudioPendingAdditionUnlocked26(pendingAdditionId23); }
      catch (error) { cs2.interaction.active = false; reportWorkspaceError(error); return; }
      cs2.pendingAdditionSelection23 = pendingAdditionId23;
      cs2.interaction.mode = 'move'; cs2.interaction.targetId = hitId; cs2.interaction.groupIds = [hitId];
      cs2.interaction.startBox = { x: hit.x, y: hit.y, w: hit.w, h: hit.h };
      cs2.interaction.draftBox = { ...cs2.interaction.startBox };
      cs2.interaction.pendingAdditionDrag23 = { scene: additionScene23, file: f, version: sourceWorkspace.state.pendingVersion,
        view: [cs2.view.zoom, cs2.view.viewX, cs2.view.viewY] };
      try { canvas.setPointerCapture(ev.pointerId); } catch {}
      canvas.style.cursor = 'move';
      studioSelection21(f).setSelection([]); sourceWorkspace.selectPointer('');
      requestCanvasTextureRedraw(); return;
    }
    if (sourceEditing && ev.button === 0 && !ev.ctrlKey && !ev.metaKey && (studioUi.rangeSelecting || (ev.shiftKey && !hitId))) {
      cs2.interaction.mode='marquee';cs2.interaction.rangeToggle=ev.shiftKey;cs2.interaction.startBox={x:world.x,y:world.y,w:0,h:0};
      cs2.interaction.draftBox={...cs2.interaction.startBox};canvas.setPointerCapture(ev.pointerId);return;
    }
    if (sourceEditing && ev.button === 0 && hitId && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
      cs2.interaction.active=false;studioSelection21(f).select(hitId,{toggle:true});syncStudioSourceSelection21(f,hitId);requestCanvasTextureRedraw();return;
    }
    if (sourceEditing && ev.button === 0 && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      const authored = hitId ? sourceNodeForPreview(f, hitId) : null;
      if (authored) {
        cs2.pendingAdditionSelection23 = null;
        const selected = studioSelection21(f);
        if (!selected.snapshot().selectedIds.includes(hitId)) selected.select(hitId);
        cs2.interaction.groupIds = selected.movementRoots();
        try { assertStudioUnlocked26(f, cs2.interaction.groupIds); }
        catch (error) { cs2.interaction.active = false; syncStudioSourceSelection21(f, hitId); reportWorkspaceError(error); return; }
        cs2.interaction.mode = 'move'; cs2.interaction.targetId = hitId;
        cs2.interaction.sourceFile = f;
        cs2.interaction.sourceDrag = captureWorkspaceSourceDrag({ file: f, revision: sourceWorkspace.state.revision,
          layout: cs2.layout, context: cs2.nodeFrameContext, view: cs2.view, pendingVersion: sourceWorkspace.state.pendingVersion,
          selectionIds: cs2.interaction.groupIds });
        cs2.interaction.startBox = { x: hit.x, y: hit.y, w: hit.w, h: hit.h };
        cs2.interaction.draftBox = { ...cs2.interaction.startBox };
        try { canvas.setPointerCapture(ev.pointerId); } catch {}
        canvas.style.cursor = 'move';
        // 同期通知はCanvasを再描画し得る。操作の所有者とcaptureを設定してから通知する。
        syncStudioSourceSelection21(f,hitId);
        return;
      }
      if (hitId && hitId !== f.uiModel?.root?.id) {
        cs2.interaction.active = false;
        reportWorkspaceError(new Error(siteText('この要素に対応する原文を特定できません。プレビューを再計算してください。')));
        return;
      }
    }
    const context = getInteractionPreviewContext(key);
    cs2.interaction.drag = null;
    if (context.enabled && !context.pocket && ev.button === 0 && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      if (previewAudioEnabled && buildPreviewAudioIntent(context, findUiInteractionTarget(context, hit), 'unlock')) {
        void getPreviewAudioPlayer().unlock(ev);
      }
      cs2.interaction.mode = 'ui';
      cs2.interaction.targetId = hitId;
      cs2.interaction.model = context.model;
      cs2.interaction.mockVersion = s.preview?.mockDataVersion;
      cs2.interaction.inputSnapshot41 = capturePreviewInputSnapshot(context, ev.pointerId, hitId);
      previewInputTrace.append({kind:'pointer-down',nodeId:hitId,fileId:context.file?.id,definition:context.screenDefinition,
        uiInstanceId:context.uiInstanceId,pointerId:ev.pointerId,x:world.x,y:world.y,trusted:ev.isTrusted,
        localRevision:context.localToggleState?.revision,mockRevision:context.state.preview?.mockDataVersion,animationTime:previewPlayback.state.seconds});
      const from = hit ? findInteractionCollectionAddress({ ...context, nodeId: hit.id }) : null;
      if (from && context.collectionData[from.collection]?.[from.index]) cs2.interaction.drag = {
        from, fromSlotProps: getInteractionHitProps(context, hit.id), expectedSource: context.collectionData[from.collection][from.index],
        collectionData: context.collectionData, x: px, y: py,
      };
      canvas.focus({ preventScroll: true });
      try { canvas.setPointerCapture(ev.pointerId); } catch {}
      return;
    }

    // Determine whether we should start a resize/move (only for editable files, and never for the root node).
    if (canEdit && selectedId && isCanvasNodeTransformable(f, selectedId)) {
      const selectedNode = f && f.nodesById ? f.nodesById[selectedId] : null;
      const selectedBox = (cs2.layout?.boxes || []).find((b) => b && String(b.id) === selectedId) || null;

      if (selectedNode && selectedBox && isCanvasNodeResizable(selectedNode)) {
        const handles = getResizeHandlesForBox(selectedBox, cs2.view, { handlePx: 10 });
        const hh = hitTestResizeHandles(handles, world.x, world.y, cs2.layout?.preset || null);
        if (hh) {
          cs2.interaction.mode = 'resize';
          cs2.interaction.targetId = selectedId;
          cs2.interaction.handle = hh.kind;
          cs2.interaction.startBox = {
            x: Number(selectedBox.x) || 0,
            y: Number(selectedBox.y) || 0,
            w: Number(selectedBox.w) || 0,
            h: Number(selectedBox.h) || 0,
          };
          cs2.interaction.draftBox = { ...cs2.interaction.startBox };
        }
      }

      // Dragging the selected node moves it (pan still works by dragging non-selected areas).
      if (cs2.interaction.mode !== 'resize' && hitId && hitId === selectedId && hit) {
        cs2.interaction.mode = 'move';
        cs2.interaction.targetId = selectedId;
        cs2.interaction.startBox = { x: Number(hit.x) || 0, y: Number(hit.y) || 0, w: Number(hit.w) || 0, h: Number(hit.h) || 0 };
        cs2.interaction.draftBox = { ...cs2.interaction.startBox };
      }
    }

    // Default to pan (also used for click-to-select when not moved).
    if (cs2.interaction.mode === 'none') {
      cs2.interaction.mode = 'pan';
    }
    // Alt パン中も同じ Canvas を保持する。targetId は設定しないため、
    // pointerup の原文編集経路へ入らず表示原点だけが変わる。
    if (sourceEditing && cs2.interaction.mode === 'pan') cs2.interaction.sourceFile = f;

    // Cursor.
    if (cs2.interaction.mode === 'resize') {
      canvas.style.cursor = cursorForHandle(cs2.interaction.handle);
    } else if (cs2.interaction.mode === 'move') {
      canvas.style.cursor = 'move';
    } else {
      canvas.style.cursor = 'grabbing';
    }

    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
  };

  /** @param {PointerEvent} ev */
  const onPointerMove = (ev) => {
    const canvas = /** @type {HTMLCanvasElement|null} */ (ev.currentTarget);
    if (!canvas) return;

    const cs2 = getCanvasState(key);

    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const world = canvasPxToWorld(px, py, cs2.view);

    cs2.nativePointerWorld = { x: world.x, y: world.y, active: true };
    const nativeFile = store.getState().files.byId[store.getState().files.currentFileId];
    const nativeBox = (cs2.layout?.boxes || []).find(box => {
      const override = cs2.propsByIdOverride?.[box.id];
      const renderer = override && Object.hasOwn(override, 'renderer')
        ? override.renderer : nativeFile?.nodesById?.[box.id]?.props?.renderer;
      return renderer === 'live_horse_renderer' || renderer === 'live_player_renderer';
    });
    if (nativeBox) {
      cs2.nativePointer = { active: true, x: Math.max(-1, Math.min(1, (world.x - nativeBox.x - nativeBox.w / 2) / Math.max(1, nativeBox.w / 2))),
        y: Math.max(-1, Math.min(1, (world.y - nativeBox.y - nativeBox.h / 2) / Math.max(1, nativeBox.h / 2))) };
      requestCanvasTextureRedraw({ nativeOnly: true });
      startNativeMotionPreview();
    }

    if (cs2.interaction.active && cs2.interaction.pointerId === ev.pointerId) {
      const dxClient = ev.clientX - cs2.interaction.startClientX;
      const dyClient = ev.clientY - cs2.interaction.startClientY;

      const dist = Math.abs(dxClient) + Math.abs(dyClient);
      if (dist > CANVAS_INTERACTION_THRESHOLD_PX) cs2.interaction.moved = true;

      if(cs2.interaction.mode==='insert') {
        const start=cs2.interaction.startBox;
        let w=world.x-start.x,h=world.y-start.y;
        if(ev.shiftKey){const size=Math.max(Math.abs(w),Math.abs(h));w=(w<0?-1:1)*size;h=(h<0?-1:1)*size;}
        cs2.interaction.draftBox={x:Math.min(start.x,start.x+w),y:Math.min(start.y,start.y+h),w:Math.min(CANVAS_MAX_SIZE,Math.max(CANVAS_MIN_SIZE,Math.abs(w))),h:Math.min(CANVAS_MAX_SIZE,Math.max(CANVAS_MIN_SIZE,Math.abs(h)))};
        requestCanvasTextureRedraw();return;
      }
      if (cs2.interaction.mode === 'marquee') {
        cs2.interaction.draftBox={x:cs2.interaction.startWorldX,y:cs2.interaction.startWorldY,w:world.x-cs2.interaction.startWorldX,h:world.y-cs2.interaction.startWorldY};
        requestCanvasTextureRedraw();return;
      }
      if (cs2.interaction.mode === 'ui') {
        const context = getInteractionPreviewContext(key);
        if (!isPreviewInputContextCurrent(cs2.interaction.inputSnapshot41, context)) {
          previewInputTrace.append({kind:'pointer-invalidated',code:'INPUT_CONTEXT_CHANGED',pointerId:ev.pointerId,accepted:false});
          cancelPreviewPointerInteraction(key, canvas); return;
        }
        const ghost = document.getElementById('preview-slot-drag');
        if (cs2.interaction.drag && cs2.interaction.moved && ghost) {
          ghost.hidden = false; ghost.style.left = `${px + 12}px`; ghost.style.top = `${py + 12}px`;
          const row = cs2.interaction.drag.expectedSource;
          ghost.textContent = String(row.__jsonui_preview_item_id || row['#item_name'] || siteText('アイテム'));
        }
        canvas.style.cursor = cs2.interaction.drag && cs2.interaction.moved ? 'grabbing' : 'pointer';
        return;
      }

      if (cs2.interaction.mode === 'pan') {
        const z = Number(cs2.view.zoom) || 1;
        cs2.view.viewX = cs2.interaction.startViewX - dxClient / z;
        cs2.view.viewY = cs2.interaction.startViewY - dyClient / z;
        canvas.style.cursor = 'grabbing';
        requestCanvasTextureRedraw();
        return;
      }

      if ((cs2.interaction.mode === 'move' || cs2.interaction.mode === 'resize') && cs2.interaction.startBox) {
        // Only update draft after the drag threshold, to avoid accidental edits.
        if (!cs2.interaction.moved) return;

        const dxWorld = world.x - cs2.interaction.startWorldX;
        const dyWorld = world.y - cs2.interaction.startWorldY;

        const start = cs2.interaction.startBox;

        if (cs2.interaction.mode === 'move') {
          const nx = clampNumber(start.x + dxWorld, -CANVAS_POS_LIMIT, CANVAS_POS_LIMIT);
          const ny = clampNumber(start.y + dyWorld, -CANVAS_POS_LIMIT, CANVAS_POS_LIMIT);
          cs2.interaction.draftBox = { ...start, x: nx, y: ny };
          canvas.style.cursor = 'move';
          requestCanvasTextureRedraw();
          return;
        }

        const handle = cs2.interaction.handle;
        cs2.interaction.draftBox = resizeBox33(start,handle,dxWorld,dyWorld,{preserveRatio:ev.shiftKey,fromCenter:ev.ctrlKey||ev.metaKey,minSize:CANVAS_MIN_SIZE,maxSize:CANVAS_MAX_SIZE});
        canvas.style.cursor = cursorForHandle(handle);
        requestCanvasTextureRedraw();
        return;
      }
    }

    // Hover (best-effort): update hover highlight without re-rendering the app.
    const s = store.getState();
    const fid = s.files.currentFileId;
    const f = fid ? s.files.byId[fid] : null;
    const canEdit = Boolean(f && !f.readOnly);

    const selectedRaw = s.editor && s.editor.selection ? s.editor.selection.nodeId : null;
    const selectedId = selectedRaw ? String(selectedRaw) : null;

    let hoverHandle = null;

    if ((canEdit || cs2.sourceEditing) && selectedId && isCanvasNodeTransformable(f, selectedId)) {
      const selectedNode = f && f.nodesById ? f.nodesById[selectedId] : null;
      const selectedBox = (studioPaintLayout21(cs2,f)?.boxes || []).find((b) => b && String(b.id) === selectedId) || null;
      if (selectedNode && selectedBox && isCanvasNodeResizable(selectedNode)) {
        const handles = getResizeHandlesForBox(selectedBox, cs2.view, { handlePx: 10 });
        const hh = hitTestResizeHandles(handles, world.x, world.y, cs2.layout?.preset || null);
        if (hh) hoverHandle = hh.kind;
      }
    }

    const hoverContext = getInteractionPreviewContext(key);
    const hit = cs2.sourceEditing && f?.meta?.previewProjection ? hitTestSourceCanvas(key, f, world) : hoverContext.enabled && !hoverContext.pocket
      ? hitTestUiInteraction(hoverContext, world.x, world.y, cs2.layout?.preset || null)
      : hitTestBoxes(cs2.layout?.boxes || [], world.x, world.y, cs2.layout?.preset || null);
    const hitId = hit ? String(hit.id) : null;

    // Cursor priority: handle > selected box (move) > pan.
    if (hoverHandle) {
      canvas.style.cursor = cursorForHandle(hoverHandle);
    } else if (canEdit && selectedId && hitId && hitId === selectedId && isCanvasNodeTransformable(f, selectedId)) {
      canvas.style.cursor = 'move';
    } else {
      canvas.style.cursor = cs2.sourceEditing && hitId && sourceNodeForPreview(f, hitId) ? 'move' : hoverContext.enabled && hit ? 'pointer' : 'grab';
    }

    const nextHover = hoverHandle ? null : hitId;
    if (hoverHandle !== cs2.hoverHandle || nextHover !== cs2.hoverId) {
      cs2.hoverHandle = hoverHandle;
      cs2.hoverId = nextHover;
      requestCanvasTextureRedraw();
    }
  };

  /** @param {PointerEvent} ev */
  const onPointerUp = (ev) => {
    requestAnimationFrame(flushDeferredWorkspaceRender);
    const canvas = /** @type {HTMLCanvasElement|null} */ (ev.currentTarget);
    if (!canvas) return;

    const cs2 = getCanvasState(key);

    if (cs2.interaction.active && cs2.interaction.pointerId !== ev.pointerId) return;
    const wasActive = cs2.interaction.active && cs2.interaction.pointerId === ev.pointerId;
    const moved = Boolean(cs2.interaction.moved);
    const mode = cs2.interaction.mode;
    const targetId = cs2.interaction.targetId ? String(cs2.interaction.targetId) : null;
    const draftBox = cs2.interaction.draftBox;
    const sourceStartBox = cs2.interaction.startBox;
    const sourceFile = cs2.interaction.sourceFile, sourceDrag = cs2.interaction.sourceDrag;
    const additionDrag23 = cs2.interaction.pendingAdditionDrag23;
    const insertionDrag33=cs2.interaction.insertionDrag33;cs2.interaction.insertionDrag33=null;
    cs2.interaction.pendingAdditionDrag23 = null;
    cs2.interaction.sourceFile = null;
    cs2.interaction.sourceDrag = null;
    const drag = cs2.interaction.drag, inputSnapshot41 = cs2.interaction.inputSnapshot41;
    cs2.interaction.inputSnapshot41 = null;
    cs2.interaction.drag = null;
    const ghost = document.getElementById('preview-slot-drag'); if (ghost) ghost.hidden = true;

    // Reset interaction state.
    cs2.interaction.active = false;
    cs2.interaction.pointerId = null;
    cs2.interaction.mode = 'none';
    cs2.interaction.targetId = null;
    cs2.interaction.handle = null;
    cs2.interaction.startBox = null;
    cs2.interaction.draftBox = null;
    cs2.interaction.moved = false;

    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      // ignore
    }

    if (!wasActive) return;
    if(mode==='insert' && insertionDrag33) {
      const ws=sourceWorkspace.state,current=store.getState().files.byId[store.getState().files.currentFileId];
      if(!sameWorkspacePreviewModel(current,insertionDrag33.file)||ws.workspaceId!==insertionDrag33.workspaceId||ws.revision!==insertionDrag33.revision||ws.pendingVersion!==insertionDrag33.pendingVersion||ws.addGeneration32!==insertionDrag33.generation) {
        reportWorkspaceError(new Error('挿入中にUIまたは設定が更新されました。新しい設定で配置し直してください。'));return;
      }
      const placement=moved&&draftBox?draftBox:sourceStartBox;
      void addSourceCanvasElement(current,studioPaintLayout21(cs2,current),placement,moved?placement:null).catch(reportWorkspaceError);
      canvas.style.cursor='grab';requestCanvasTextureRedraw();return;
    }
    if (mode === 'marquee' && draftBox) {
      try {
        const current=store.getState().files.byId[store.getState().files.currentFileId];
        const layout=studioPaintLayout21(cs2,current), rect=canvas.getBoundingClientRect();
        const viewport=marqueeViewport21({view:cs2.view,canvasWidth:rect.width,canvasHeight:rect.height,
          logicalWidth:layout.preset.width,logicalHeight:layout.preset.height});
        studioSelection21(current).selectBox(draftBox,layout.boxes,{toggle:cs2.interaction.rangeToggle,mode:'contain',viewport});
        syncStudioSourceSelection21(current);
      } catch(error) { reportWorkspaceError(error); }
      studioUi.rangeSelecting=false;requestCanvasTextureRedraw();safeRender();return;
    }

    if (mode === 'ui') {
      const context = getInteractionPreviewContext(key);
      if (!isPreviewInputContextCurrent(inputSnapshot41, context)) {
        const verdict=evaluatePreviewInputRelease(inputSnapshot41,context,{pointerId:ev.pointerId,hitId:targetId});
        previewInputTrace.append({kind:'pointer-release',...verdict,pointerId:ev.pointerId,nodeId:targetId,trusted:ev.isTrusted,animationTime:previewPlayback.state.seconds});
        canvas.style.cursor='grab'; return;
      }
      const rect = canvas.getBoundingClientRect();
      const world = canvasPxToWorld(ev.clientX - rect.left, ev.clientY - rect.top, cs2.view);
      const hit = hitTestUiInteraction(context, world.x, world.y, cs2.layout?.preset || null);
      if (moved && drag) {
        const to = hit ? findInteractionCollectionAddress({ ...context, nodeId: hit.id }) : null;
        presentPreviewInteractionResult(applySlotTransfer({ ...context, from: drag.from, to, fromSlotProps: drag.fromSlotProps, toSlotProps: getInteractionHitProps(context, hit?.id), expectedSource: drag.expectedSource, collectionData: drag.collectionData }));
      } else {
        const verdict=evaluatePreviewInputRelease(inputSnapshot41,context,{pointerId:ev.pointerId,moved,hitId:hit?.id});
        previewInputTrace.append({kind:'pointer-release',...verdict,pointerId:ev.pointerId,nodeId:hit?.id,x:world.x,y:world.y,trusted:ev.isTrusted,animationTime:previewPlayback.state.seconds});
        if(verdict.accepted) activatePreviewHit(key, hit, 'activate', ev);
      }
      canvas.style.cursor = 'grab';
      return;
    }

    if (additionDrag23 && targetId) {
      try {
        const current = store.getState().files.byId[store.getState().files.currentFileId];
        if (!sameWorkspacePreviewModel(current, additionDrag23.file) || sourceWorkspace.state.pendingVersion !== additionDrag23.version
          || additionDrag23.view.some((value, index) => value !== [cs2.view.zoom, cs2.view.viewX, cs2.view.viewY][index])) {
          throw Object.assign(new Error('移動中に草稿の表示が更新されました。要素を選び直してください。'), { code: 'WORKSPACE_DRAFT_ADDITION_STALE' });
        }
        if (moved && draftBox) (mode==='resize'?resizePendingAddition33:moveWorkspaceDraftAddition23)(sourceWorkspace,
          { ...additionDrag23.scene, pendingVersion: additionDrag23.version }, targetId, sourceStartBox, draftBox);
      } catch (error) { reportWorkspaceError(error); }
      canvas.style.cursor = 'grab'; requestCanvasTextureRedraw(); safeRender(); return;
    }
    if (sourceFile && targetId) {
      if (!isWorkspaceSourceDragCurrent(sourceDrag, { file: store.getState().files.byId[store.getState().files.currentFileId],
        revision: sourceWorkspace.state.revision, layout: cs2.layout, context: cs2.nodeFrameContext, view: cs2.view, pendingVersion: sourceWorkspace.state.pendingVersion,
        selectionIds: studioSelection21(store.getState().files.byId[store.getState().files.currentFileId]).movementRoots() })) {
        reportWorkspaceError(new Error(siteText('編集中に UI の配置が更新されました。移動は保存されていません。再度要素を選んでください。'))); return;
      }
      if (moved && draftBox) {
        const held = captureWorkspaceSourceCommitDraft(sourceDrag, { targetId, startBox: sourceStartBox, draftBox, mode });
        cs2.sourceCommitDraft = held;
        requestCanvasTextureRedraw();
        void (mode==='resize'?commitSourceCanvasResize33:commitSourceCanvasMove)(sourceFile, targetId, cs2.layout, draftBox, sourceStartBox).catch(reportWorkspaceError).finally(() => {
          if (cs2.sourceCommitDraft === held) cs2.sourceCommitDraft = null;
          requestCanvasTextureRedraw();
        });
      }
      else syncStudioSourceSelection21(sourceFile,targetId);
      canvas.style.cursor = 'grab'; return;
    }
    // Commit move/resize.
    if ((mode === 'move' || mode === 'resize') && moved && targetId && draftBox) {
      commitCanvasTransform(cs2.layout, targetId, draftBox, mode);
      canvas.style.cursor = 'grab';
      drawCanvasNow(key);
      return;
    }

    // Click-to-select for pan mode.
    if (mode === 'pan' && !moved) {
      const rect = canvas.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;

      const world = canvasPxToWorld(px, py, cs2.view);
      const currentState = store.getState();
      const currentFile = currentState.files.byId[currentState.files.currentFileId];
      const hit = cs2.sourceEditing && currentFile?.meta?.previewProjection ? hitTestSourceCanvas(key, currentFile, world)
        : hitTestBoxes(cs2.layout?.boxes || [], world.x, world.y, cs2.layout?.preset || null);

      if (hit) {
        if (cs2.sourceEditing && currentFile?.meta?.previewProjection) {
          studioSelection21(currentFile).select(String(hit.id), { single: ev.altKey === true });
          syncStudioSourceSelection21(currentFile,String(hit.id));
        } else store.dispatch(actions.selectNode(String(hit.id)));
      } else {
        if (cs2.sourceEditing && currentFile?.meta?.previewProjection) clearStudioSelection21(currentFile);
        else store.dispatch(actions.clearSelection());
      }


    }

    canvas.style.cursor = 'grab';
  };

  /** @param {PointerEvent} _ev */
  const onPointerCancel = (_ev) => {
    requestAnimationFrame(flushDeferredWorkspaceRender);
    const cs2 = getCanvasState(key);
    cs2.interaction.sourceFile = null;
    cs2.interaction.sourceDrag = null;
    cs2.interaction.pendingAdditionDrag23 = null;
    cs2.interaction.insertionDrag33 = null;
    requestCanvasTextureRedraw();
    cs2.interaction.active = false;
    cs2.interaction.pointerId = null;
    cs2.interaction.mode = 'none';
    cs2.interaction.targetId = null;
    cs2.interaction.handle = null;
    cs2.interaction.startBox = null;
    cs2.interaction.draftBox = null;
    cs2.interaction.moved = false;
    cs2.interaction.drag = null;
    const ghost = document.getElementById('preview-slot-drag'); if (ghost) ghost.hidden = true;
  };

/** @param {MouseEvent} ev */
  const onContextMenu = (ev) => {
    ev.preventDefault();
    if(!file?.meta?.previewProjection || workspacePreviewBlocked()) return;
    const canvas=ev.currentTarget, rect=canvas.getBoundingClientRect();
    const world=canvasPxToWorld(ev.clientX-rect.left,ev.clientY-rect.top,cs.view);
    const hit=hitTestSourceCanvas(key,file,world);
    try { openStudioContextMenu21(ev,file,hit?.id||null); } catch(error) { reportWorkspaceError(error); }
  };

  // Schedule a draw after this render commits to DOM.
  requestAnimationFrame(() => {
    const canvas = document.getElementById('preview-canvas');
    if (!canvas || !canvas.isConnected) return;
    drawCanvasNow(key);
    startNativeMotionPreview();
  });



  // S046: Navigation simulator UI state
  const navState = state.preview && state.preview.navigation && typeof state.preview.navigation === 'object'
    ? state.preview.navigation
    : null;
  const navEnabled = Boolean(navState && navState.enabled);
  const navStack = Array.isArray(navState && navState.stack) ? navState.stack : [];
  const navIndex = Number.isFinite(navState && navState.index) ? Number(navState.index) : -1;

  const canNavBack = navIndex > 0;
  const canNavForward = navIndex >= 0 && navIndex < navStack.length - 1;
  const canNavReset = Boolean(file && file.kind === 'screen');
  const isHudPreview = Boolean(file && /hud/i.test(`${String(file.path || '')} ${String(file?.meta?.selectedDefinition?.definition || '')}`));
  const isInventoryLayoutPreview = Boolean(file && /(^|\/)inventory_screen\.jsonc?$/i.test(String(file.path || '')));
  const inventoryScenario = state.preview?.mockData?.['#is_creative_layout'] === true ? 'creative' : 'survival';

  const navClickModeLabel = siteText`プレビュー操作: ${navEnabled ? 'ON' : 'OFF'}`;

  const onNavBack = () => {
    const st = store.getState();
    const nav = st.preview && st.preview.navigation ? st.preview.navigation : null;
    const stack = Array.isArray(nav && nav.stack) ? nav.stack : [];
    const index = Number.isFinite(nav && nav.index) ? Number(nav.index) : -1;
    const targetIndex = index - 1;
    if (targetIndex < 0 || targetIndex >= stack.length) return;
    const targetFileId = stack[targetIndex];
    void navigateToScreenFile(targetFileId, 'setIndex', targetIndex);
  };

  const onNavForward = () => {
    const st = store.getState();
    const nav = st.preview && st.preview.navigation ? st.preview.navigation : null;
    const stack = Array.isArray(nav && nav.stack) ? nav.stack : [];
    const index = Number.isFinite(nav && nav.index) ? Number(nav.index) : -1;
    const targetIndex = index + 1;
    if (targetIndex < 0 || targetIndex >= stack.length) return;
    const targetFileId = stack[targetIndex];
    void navigateToScreenFile(targetFileId, 'setIndex', targetIndex);
  };

  const onNavReset = () => {
    const st = store.getState();
    const fid = st.files.currentFileId;
    const f = fid && st.files.byId ? st.files.byId[fid] : null;
    if (!f || f.kind !== 'screen') return;
    void navigateToScreenFile(screenRefFromFile(f), 'reset');
  };

  const onToggleNavClickMode = () => {
    hidePreviewEditBoxOverlay('mode-toggle'); cancelPreviewPointerInteraction(key);
    store.dispatch(actions.setPreviewNavEnabled(!navEnabled));
  };

  const onToggleStructureMode = () => {
    assertStudioExternalChange21('プレビューの構造表示変更');
    cs.structureMode = !cs.structureMode;
    safeRender();
  };

  const bindingStats = cs.bindingsEvalStats && typeof cs.bindingsEvalStats === 'object'
    ? cs.bindingsEvalStats
    : {};
  const collectionQuality = summarizeCollectionQuality(cs.bindingsEvalStats
    ? { warnings: cs.bindingsWarnings } : null);
  const bindingsSeen = Number(bindingStats.bindingsSeen) || 0;
  const bindingsApplied = Number(bindingStats.bindingsApplied) || 0;
  const bindingsSkipped = Number(bindingStats.bindingsSkipped) || 0;
  const runtimeDependentNodes = new Set();
  if (file && file.nodesById && typeof file.nodesById === 'object') {
    for (const [nodeId, uiNode] of Object.entries(file.nodesById)) {
      if (!uiNode || typeof uiNode !== 'object') continue;
      const props = uiNode.props && typeof uiNode.props === 'object' ? uiNode.props : {};
      const nodeType = String(uiNode.type || '').toLowerCase();
      const textValue = typeof props.text === 'string' ? props.text.trim() : '';
      if (
        nodeType === 'custom'
        || nodeType === 'factory'
        || Object.prototype.hasOwnProperty.call(props, 'collection_name')
        || Object.prototype.hasOwnProperty.call(props, 'binding_collection_name')
        || Object.prototype.hasOwnProperty.call(props, 'grid_dimension_binding')
        || textValue.startsWith('#')
        || textValue.startsWith('$')
      ) {
        runtimeDependentNodes.add(String(nodeId));
      }
    }
  }
  const unresolvedRuntimeCount = Math.max(bindingsSkipped, bindingsSeen - bindingsApplied, 0)
    + (Array.isArray(cs.bindingsWarnings) ? cs.bindingsWarnings.length : 0)
    + runtimeDependentNodes.size;
  const layoutWarnings = Array.isArray(cs.layout?.warnings)
    ? cs.layout.warnings.filter((warning) => String(warning || '') !== 'CANVAS_LAYOUT_ERROR')
    : [];
  const resolverDiagnostics = Array.isArray(file?.meta?.resolution?.diagnostics)
    ? file.meta.resolution.diagnostics.filter((item) => {
        const severity = String(item?.severity || '').toLowerCase();
        return severity === 'warning' || severity === 'error';
      })
    : [];
  const missingBaseDiagnosticCodes = new Set([
    'UI_BASE_NOT_FOUND',
    'UI_CONTROL_BASE_NOT_FOUND',
    'UI_DYNAMIC_BASE_TARGET_NOT_FOUND',
    'UI_GRID_TEMPLATE_NOT_FOUND',
  ]);
  const missingBaseCount = resolverDiagnostics.filter((item) => (
    missingBaseDiagnosticCodes.has(String(item?.code || ''))
  )).length;
  const missingVanillaBase = Boolean(importedPackRuntime && !vanillaReferenceRuntime && missingBaseCount > 0);
  const hasPreviewFile = Boolean(file);
  const hasLayoutError = Boolean(cs.layoutError);
  const preparingNodeFrame = hasPreviewFile && !hasLayoutError && nodeFrameAvailability !== false && (!cs.nodeFrameAppliedContext || cs.nodeFrameAppliedContext !== cs.nodeFrameContext);
  const fidelityLimited = hasPreviewFile && !hasLayoutError && (
    cs.structureMode
    || unresolvedRuntimeCount > 0
    || layoutWarnings.length > 0
    || resolverDiagnostics.length > 0
    || collectionQuality.status === 'failed' || collectionQuality.status === 'unknown'
    || truncated
  );
  const fidelityLabel = preparingNodeFrame ? siteText('表示を準備しています') : !hasPreviewFile
    ? t('editor.canvas.fidelity.unavailable')
    : hasLayoutError
      ? t('editor.canvas.previewError')
    : cs.structureMode
      ? t('editor.canvas.mode.structure')
    : collectionQuality.status === 'failed'
      ? t('editor.canvas.collection.failed')
    : fidelityLimited
      ? t('editor.canvas.fidelity.limited')
      : t('editor.canvas.fidelity.high');
  const baseRuntimeSummary = !hasPreviewFile
    ? t('editor.canvas.fidelity.unavailableHint')
    : hasLayoutError
      ? t('editor.canvas.previewErrorHint')
    : cs.structureMode
      ? t('editor.canvas.mode.hintStructure')
    : fidelityLimited
      ? [
          unresolvedRuntimeCount > 0 ? t('editor.canvas.runtimeUnknown', { count: unresolvedRuntimeCount }) : '',
          layoutWarnings.length > 0 ? t('editor.canvas.layoutWarning', { count: layoutWarnings.length }) : '',
          resolverDiagnostics.length > 0 ? t('editor.canvas.resolverWarning', { count: resolverDiagnostics.length }) : '',
        ].filter(Boolean).join(' • ')
      : t('editor.canvas.runtimeResolved');
  const sourceSummary = importedPackRuntime
    ? (() => {
        const provenance = Array.isArray(file?.meta?.resolution?.provenance)
          ? file.meta.resolution.provenance
          : [];
        const kinds = new Set(provenance.map((item) => String(item?.sourceKind || '')));
        if (kinds.has('imported') && kinds.has('vanilla')) return t('editor.canvas.sourceStacked');
        if (kinds.has('vanilla')) return t('editor.canvas.sourceVanilla');
        if (kinds.has('imported')) return t('editor.canvas.sourceSingle');
        return t(vanillaReferenceRuntime ? 'editor.canvas.lookupStacked' : 'editor.canvas.lookupSingle');
      })()
    : '';
  const runtimeSummary = [
    sourceSummary,
    missingVanillaBase ? t('editor.canvas.missingVanillaBase') : '',
    ['failed', 'unknown'].includes(collectionQuality.status)
      ? t('editor.canvas.collection.hint', { codes: collectionQuality.reason_codes.slice(0, 4).join(', ') }) : '',
    baseRuntimeSummary,
  ].filter(Boolean).join(' • ');
  const drawableBoxes = countDrawableCanvasBoxes({
    boxes: cs.layout?.boxes,
    nodesById: file?.nodesById,
    propsByIdOverride: cs.propsByIdOverride,
    isCustomDrawable: isCustomPreviewDrawable,
    isTextureResolvable: (textureRef) => {
      const resolved = resolveTextureRef(String(textureRef || ''), {
        importedIndex: importedPackRuntime?.assetIndex || null,
        vanillaIndex: vanillaReferenceRuntime?.assetIndex || null,
      });
      return Boolean(resolved?.ok && resolved.resolved);
    },
  });

  const toolbar = h('div', {
    class: 'canvas-toolbar',
    role: 'toolbar',
    'aria-label': t('editor.canvas.toolbar'),
  }, [
    h('div', { class: 'canvas-toolbar-primary' }, [
      h('div', { class: 'canvas-view-tools', role: 'group', 'aria-label': t('editor.canvas.viewTools') }, [
        h('button', { id: 'preview-expand', type: 'button', class: 'btn btn-primary', 'aria-pressed': String(previewViewport.active), disabled: !file, onClick: () => toggleStudioViewport23(key) }, [previewViewport.active ? siteText('元の大きさに戻す') : siteText('全画面でプレビュー')]),
        h(
          'button',
          { type: 'button', class: 'btn', onClick: () => fitCanvasView(key), title: t('editor.canvas.fit') },
          [t('editor.canvas.fit')]
        ),
        h(
          'button',
          { type: 'button', class: 'btn btn-primary canvas-fit-ui', onClick: () => fitCanvasUiView(key), title: t('editor.canvas.fitUiHint') },
          [t('editor.canvas.fitUi')]
        ),
        h(
          'button',
          {
            type: 'button',
            class: `btn${cs.structureMode ? ' is-active' : ''}`,
            onClick: onToggleStructureMode,
            'aria-pressed': cs.structureMode ? 'true' : 'false',
            title: cs.structureMode ? t('editor.canvas.mode.hintStructure') : t('editor.canvas.mode.hintSafe'),
          },
          [cs.structureMode ? t('editor.canvas.mode.structure') : t('editor.canvas.mode.safe')]
        ),
      ]),
      h('div', { class: 'canvas-zoom-tools', role: 'group', 'aria-label': t('editor.canvas.displayZoom') }, [
        h('span', { class: 'canvas-tool-label' }, [t('editor.canvas.displayZoom')]),
        h('button', { type: 'button', class: 'btn canvas-icon-btn', onClick: () => zoomCanvasAtPivotPx(key, 1 / 1.15), title: t('editor.canvas.zoomOut'), 'aria-label': t('editor.canvas.zoomOut') }, [
          '−',
        ]),
        h('span', { class: 'canvas-zoom', id: 'canvas-zoom-label' }, [formatZoomLabel(cs.view.zoom)]),
        h('button', { type: 'button', class: 'btn canvas-icon-btn', onClick: () => zoomCanvasAtPivotPx(key, 1.15), title: t('editor.canvas.zoomIn'), 'aria-label': t('editor.canvas.zoomIn') }, ['＋']),
      ]),
      h('label', { class: 'canvas-lang-label canvas-ui-scale-control', title: t('editor.canvas.uiScaleHint') }, [
        `${t('editor.canvas.uiScale')}:`,
        studioRuntimeControlsH21('select', {
          id: 'preview-ui-scale',
          class: 'canvas-lang-select',
          value: cs.uiScaleMode === 'manual' ? String(cs.manualUiScale) : 'auto',
          onChange: onChangeCanvasUiScale,
        }, [
          h('option', { value: 'auto' }, [t('editor.canvas.uiScaleAuto', { scale: canvasUiScale })]),
          ...[1, 2, 3, 4, 5, 6].map((scale) => h('option', { value: String(scale) }, [`${scale}×`])),
        ]),
      ]),
      h('label', { class: 'canvas-lang-label canvas-device-preset-control', title: t('editor.canvas.devicePresetHint') }, [
        `${t('editor.canvas.devicePreset')}:`,
        studioRuntimeControlsH21('select', {
          id: 'preview-device-preset',
          class: 'canvas-lang-select',
          value: String(cs.devicePresetKey || DEFAULT_DEVICE_PRESET_KEY),
          onChange: onChangeDevicePreset,
        }, Object.entries(DEVICE_CANVAS_PRESETS).map(([value, preset]) => (
          h('option', { value }, [preset.name])
        ))),
      ]),
    ]),
    h('div', { class: 'canvas-toolbar-secondary' }, [
      studioUi.leftOpen
        ? ''
        : h('button', {
            type: 'button',
            class: 'btn btn-primary canvas-left-toggle',
            'aria-controls': 'panel-left',
            onClick: () => toggleLeftPanel(getCommandContext()),
          }, [t('editor.panel.leftOpen')]),
    h('span', {
      class: 'canvas-current-ui',
      title: file
        ? `${String(file.path || file.id)}#${String(file?.meta?.selectedDefinition?.definition || file?.meta?.selectedDefinition || '')}`
        : t('editor.canvas.noFile'),
    }, [file
      ? String(file?.meta?.selectedDefinition?.definition || file?.meta?.selectedDefinition || file.path || file.id)
      : t('editor.canvas.noFile')]),
    h('button', { type: 'button', class: navEnabled ? 'btn btn-primary' : 'btn', 'aria-pressed': String(navEnabled), onClick: onToggleNavClickMode, title: siteText('ONでボタン・文字入力・スロット移動を有効にします。') }, [navClickModeLabel]),
    h('button', { type: 'button', class: 'btn', 'aria-pressed': String(nativeMotionEnabled), onClick: () => { nativeMotionEnabled = !nativeMotionEnabled; if (nativeMotionEnabled) startNativeMotionPreview(); else stopNativeMotionPreview(); requestCanvasTextureRedraw(); safeRender(); } }, [siteText`3Dの動き: ${nativeMotionEnabled ? 'ON' : 'OFF'}`]),
    h('details', { class: 'canvas-settings' }, [
      h('summary', {}, [t('editor.canvas.settings')]),
      h('div', { class: 'canvas-settings-content' }, [
        h('button', { type: 'button', class: 'btn', disabled: !canNavBack, onClick: onNavBack, title: t('editor.nav.back') }, [
          t('editor.nav.back'),
        ]),
        h('button', { type: 'button', class: 'btn', disabled: !canNavForward, onClick: onNavForward, title: t('editor.nav.forward') }, [
          t('editor.nav.forward'),
        ]),
        h('button', { type: 'button', class: 'btn', disabled: !canNavReset, onClick: onNavReset, title: t('editor.nav.reset') }, [
          t('editor.nav.reset'),
        ]),

        isInventoryLayoutPreview
          ? h('label', { class: 'canvas-lang-label', title: t('editor.canvas.inventoryScenarioHint') }, [
              `${t('editor.canvas.inventoryScenario')}:`,
              studioRuntimeControlsH21('select', {
                id: 'preview-inventory-scenario',
                class: 'canvas-lang-select',
                value: inventoryScenario,
                onChange: (e) => setInventoryPreviewScenario(e?.target?.value === 'creative' ? 'creative' : 'survival'),
              }, [
                h('option', { value: 'survival' }, [t('editor.canvas.inventoryScenario.survival')]),
                h('option', { value: 'creative' }, [t('editor.canvas.inventoryScenario.creative')]),
              ]),
            ])
          : '',
        isHudPreview
          ? studioRuntimeControlsH21('button', {
              id: 'preview-hud-preset',
              type: 'button',
              class: 'btn',
              title: t('editor.canvas.hudPresetHint'),
              onClick: () => {
                const current = state.preview?.mockData && typeof state.preview.mockData === 'object'
                  ? state.preview.mockData
                  : {};
                store.dispatch(actions.setMockData({
                  ...current,
                  '#hud_visible': true,
                  '#hud_visible_centered': true,
                  '#hud_visible_centered_gui_elements': true,
                  '#hotbar_visible': true,
                  '#level_number_visible': true,
                }));
              },
            }, [t('editor.canvas.hudPreset')])
          : '',
        h('label', { class: 'canvas-lang-label', title: t('editor.previewText.languageHint') }, [
          `${t('editor.previewText.language')}:`,
          studioRuntimeControlsH21(
            'select',
            {
              id: 'preview-locale',
              class: 'canvas-lang-select',
              value: previewLocale,
              title: t('editor.previewText.languageHint'),
              onChange: onChangePreviewLocale,
            },
            [
              h('option', { value: 'en_US' }, [t('editor.previewText.language.en_US')]),
              h('option', { value: 'ja_JP' }, [t('editor.previewText.language.ja_JP')]),
            ]
          ),
        ]),
        h('label', { class: 'canvas-lang-label' }, [
          siteText('字体:'),
          studioRuntimeControlsH21('select', { id: 'preview-font-profile', class: 'canvas-lang-select', value: previewFontProfile,
            title: siteText('観測smoothは明示指定です。実機完全一致は未検証です。'), onChange: onChangePreviewFontProfile }, [
            h('option', { value: 'bitmap' }, [siteText('Bitmap（従来）')]),
            h('option', { value: 'observed-smooth' }, [siteText('観測smooth')]),
          ]),
        ]),
        h('label', { class: 'canvas-lang-label' }, [
          siteText('アイテムID:'),
          studioRuntimeControlsH21('select', { id: 'preview-item-id-profile', class: 'canvas-lang-select', value: previewItemIdProfile,
            title: siteText('数値IDの参照版です。ゲーム本体の描画や追加アイテムの実行時IDを再現する指定ではありません。'),
            onChange: (event) => {
              const value = event?.target?.value;
              previewItemIdProfile = value === 'r41-legacy-five' ? value : 'bedrock-v1.26.50.4';
              clearItemTextureAtlasCache();
              requestCanvasTextureMetadataRefresh();
              scheduleReferenceContextRevalidation();
              safeRender();
            },
          }, [
            h('option', { value: 'bedrock-v1.26.50.4' }, ['Bedrock 1.26.50.4']),
            h('option', { value: 'r41-legacy-five' }, [siteText('旧r41（5アイテム）')]),
          ]),
        ]),
        h('span', { class: 'canvas-meta' }, [
          `${presetLabel} • ${t('editor.canvas.stats', { rendered: renderedBoxes, total: Math.max(totalNodes, renderedBoxes) })}`,
          navStack.length && navIndex >= 0 ? ` • ${t('editor.nav.stack')}: ${navIndex + 1}/${navStack.length}` : '',
          truncated ? ` • ${t('editor.canvas.truncated')}` : '',
        ]),
      ]),
    ]),
    h('button', {
      type: 'button',
      class: 'btn canvas-inspector-toggle',
      'aria-expanded': String(studioUi.rightOpen),
      title: studioUi.rightOpen ? t('editor.inspector.close') : t('editor.inspector.open'),
      onClick: () => { studioUi.rightOpen = !studioUi.rightOpen; studioUi.rightView = 'properties'; safeRender(); },
    }, [studioUi.rightOpen ? t('editor.inspector.close') : t('editor.inspector.open')]),
    ]),
  ]);

  const fidelityNotice = h(
    'div',
    {
      class: `preview-fidelity${!hasPreviewFile ? ' is-unavailable' : hasLayoutError || collectionQuality.status === 'failed' ? ' is-error' : fidelityLimited ? ' is-limited' : ' is-high'}`,
      role: 'status',
      title: cs.structureMode ? t('editor.canvas.mode.hintStructure') : t('editor.canvas.mode.hintSafe'),
    },
    [
      h('strong', { class: 'preview-status-label' }, [`${t('editor.canvas.fidelityLabel')}: ${fidelityLabel}`]),
      h('span', { class: 'preview-status-summary' }, [runtimeSummary]),
    ]
  );

  const below = h('div', { class: 'canvas-hint' }, [
    hintText,
    ` • ${navClickModeLabel}`,
    !file ? ` • ${t('editor.canvas.noFile')}` : '',
  ]);

  const nativeRendererUsage = evaluateNativeRendererUsage(file, cs.propsByIdOverride);
  const nativeModelSettings = renderNativeModelSettings(h, {
    options: nativeModelPreviewOptions, uiState: nativeModelPreviewUiState,
    usesHorse: nativeRendererUsage.renderers.has('live_horse_renderer'),
    usesBook: nativeRendererUsage.renderers.has('enchanting_book_renderer'),
    snapshot: nativeHorsePreviewState, onApply: options => studioInvoke(() => applyNativeModelPreviewOptions(options)),
  });

    studioUi.viewControls = h('div', { class: 'studio-view-controls' }, [studioDetails(h, { id: 'studio-view-advanced26', label: '表示倍率・解像度・操作設定', state: studioUi.details }, [toolbar]),
      studioDetails(h, { id: 'studio-playback-settings', label: '再生・アニメーション', state: studioUi.details }, [renderPreviewTimeline(file)]),
      studioDetails(h, { id: 'studio-model-audio-settings', label: '3Dモデル・音声', state: studioUi.details }, [nativeModelSettings, renderPreviewAudioControls()])]);
  return h('div', { class: 'canvas-shell' }, [
    nativeRendererUsage.renderers.has('live_player_renderer')
      ? h('p', { class: 'hint' }, [siteText('パック既定のプレイヤーモデルを表示します。本人のスキン・装備・Personaの再現には対応していません。')]) : '',
    nativeRendererUsage.renderers.has('enchanting_book_renderer')
      ? h('p', { class: 'hint' }, [siteText('本はエンチャント対象を置くと開き、取り除くと閉じます。時間経過だけでは開閉しません。')]) : '',
    cs.previewTopicRootId ? h('div', { class: 'preview-topic-notice' }, [
      h('p', {}, [siteText('パック内の説明項目を表示しています。百科事典全体の操作を再現するものではありません。画面に収まらない場合は縮小・移動してください。')]),
      h('button', { type: 'button', class: 'btn', onClick: () => { const target = cs.previewTopicReturn; if (target) void navigateToScreenFile(target, 'push'); } }, [siteText('元のUIへ戻る')]),
    ]) : '',
    fidelityNotice,
    h('div', { class: 'canvas-stage' }, [
      h(
        'canvas',
        {
          id: 'preview-canvas',
          class: 'preview-canvas',
          style: cs.previewClosed || workspacePreviewBlocked() ? 'visibility:hidden' : '',
          tabindex: '0',
          role: 'img',
          'aria-label': t('panel.preview'),
          onKeydown:event=>{
            if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();openStudioContextMenu21({clientX:rect.x+20,clientY:rect.y+20},file,store.getState().editor.selection.nodeId);return;}
            if(sourceWorkspace.state.mode!=='edit'){if(event.key==='Escape'){event.preventDefault();activatePreviewHit(key,null,'escape',event);}return;}
            // グループ操作は共通コマンドで受理。Ctrl+Gはブラウザー検索へ渡す。
            else if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();studioInvoke(()=>sourceWorkspace.applyPending());}
            else if(event.key==='Escape'){
              event.preventDefault();
              if(sourceWorkspace.state.addType){const pointerId=cs.interaction.pointerId;onPointerCancel(event);if(pointerId!==null){try{event.currentTarget.releasePointerCapture(pointerId);}catch{}}setAddType32(sourceWorkspace.state,'');requestCanvasTextureRedraw();safeRender();return;}
              const pointerId=cs.interaction.pointerId;
              onPointerCancel(event);
              if(pointerId!==null){try{event.currentTarget.releasePointerCapture(pointerId);}catch{}}
              studioUi.rangeSelecting=false;clearStudioSelection21(file);closeStudioContextMenu21();requestCanvasTextureRedraw();
            }
          },
          onWheel,
          onPointerdown: onPointerDown,
          onPointermove: onPointerMove,
          onPointerup: onPointerUp,
          onPointercancel: onPointerCancel,
          onLostpointercapture: onPointerCancel,
          onPointerleave: () => { cs.nativePointerWorld = { x: 0, y: 0, active: false }; cs.nativePointer = { x: 0, y: 0, active: false }; requestCanvasTextureRedraw(); },
          onContextmenu: onContextMenu,
        },
        []
      ),
      h('div', { id: 'workspace-preview-gate', class: 'workspace-preview-gate', hidden: !workspacePreviewBlocked(), role: 'alert' }, [siteText('原文を検証しているためプレビューを停止しています。変更を反映するか、未適用の変更を取り消してください。')]),
      h('div', { id: 'preview-slot-drag', class: 'preview-slot-drag', hidden: true }, []),
      cs.previewClosed ? h('div', { class: 'canvas-empty-overlay preview-closed', role: 'status' }, [h('strong', {}, [siteText('プレビューを閉じました')]), h('button', { type: 'button', class: 'btn btn-primary', onClick: () => { ensureLocalToggleSession40(cs, file, true); cs.previewClosed = false; safeRender(); } }, [siteText('再表示')])]) : '',
      hasLayoutError
        ? h('div', { class: 'canvas-error-overlay', role: 'alert' }, [
            h('strong', {}, [t('editor.canvas.previewError')]),
            h('span', {}, [t('editor.canvas.previewErrorHint')]),
          ])
        : preparingNodeFrame
          ? h('div', { class: 'canvas-empty-overlay canvas-preparing-overlay', role: 'status' }, [h('strong', {}, [siteText('表示を準備しています…')]), h('span', {}, [siteText('解釈・配置計算の完了後に操作できます。')])])
        : shouldShowCanvasEmptyState({ hasPreviewFile, hasLayoutError, renderedBoxes, drawableBoxes })
          ? h('div', { class: 'canvas-empty-overlay', role: 'status' }, [
              h('strong', {}, [preparingNodeFrame ? siteText('表示を準備しています…') : t('editor.canvas.emptyPreview')]),
              h('span', {}, [preparingNodeFrame ? siteText('解釈・配置計算の完了後にプレビューを表示します。') : missingVanillaBase ? t('editor.canvas.missingVanillaBase') : t('editor.canvas.emptyPreviewHint')]),
            ])
        : '',
    ]),
    h('p', { id: 'preview-operation-status', role: 'status', class: 'preview-operation-status' }, [navEnabled ? siteText('操作はプレビュー内の模擬状態です。Minecraft本体のフォーム送信やScript APIは実行しません。Alt＋ドラッグで表示を移動します。') : siteText('プレビュー内の操作は無効です。')]),
    ...(cs.navigationChoices || []).map(choice => h('button', { type: 'button', class: 'btn preview-navigation-choice', onClick: () => { cs.navigationChoices = null; commitPreviewInteractionEffects([{type:'navigate', ...choice}]); } }, [navigationChoiceLabel(choice)])),
    renderPreviewOperationCapabilities(key),
    renderSelectedTextCopyControls(),
    below,
  ]);
}

/**
 * @param {any} v
 * @returns {any}
 */
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (!v || typeof v !== 'object') return v;

  const out = Object.create(null);
  for (const k of Object.keys(v).sort()) {
    out[k] = sortKeysDeep(v[k]);
  }
  return out;
}

/**
 * Deterministic stringify for debug/raw JSON panels.
 * NOTE: Later steps (S019+) implement an official JSON serializer for output files.
 * @param {any} v
 * @returns {string}
 */
function stableStringifyDebug(v) {
  try {
    return JSON.stringify(sortKeysDeep(v), null, 2);
  } catch (err) {
    return `<<stringify error: ${err?.message || String(err)}>>`;
  }
}

const JSON_HIGHLIGHT_MAX_CHARS = 200000;

// Clipboard preparation belongs to the committed frame and explicit selection.
// Scope contains opaque numbers, never raw model/binding/pack references or secrets.
function previewClipboardIdentity(value) {
  if (value === null || typeof value !== 'object' && typeof value !== 'function') return value;
  if (!previewClipboardIdentities.has(value)) previewClipboardIdentities.set(value, ++previewClipboardIdentitySequence);
  return previewClipboardIdentities.get(value);
}

function capturePreviewClipboardScope() {
  const state = store.getState(), file = state.files.byId[state.files.currentFileId];
  const cs = getCanvasState(getCanvasKey(file?.id));
  return Object.freeze({ epoch: previewTextCopyEpoch, pack: previewClipboardIdentity(state.pack?.imported),
    imported: previewClipboardIdentity(importedPackRuntime), vanilla: previewClipboardIdentity(vanillaReferenceRuntime), fileId: file?.id,
    model: previewClipboardIdentity(file?.uiModel), nodes: previewClipboardIdentity(file?.nodesById), instance: file?.meta?.previewProjectionInstanceId,
    stateRevision: state.preview?.mockDataVersion, raw: previewClipboardIdentity(state.preview?.mockData),
    locale: state.ui?.previewLocale, localeGeneration: langTableRuntime.generation,
    activeTable: previewClipboardIdentity(langTableRuntime.tablesByLocale.get(state.ui?.previewLocale || 'en_US')),
    fallbackTable: previewClipboardIdentity(langTableRuntime.tablesByLocale.get('en_US')),
    layout: previewClipboardIdentity(cs.layout), props: previewClipboardIdentity(cs.propsByIdOverride), closed: cs.previewClosed,
    zoom: cs.view?.zoom, viewX: cs.view?.viewX, viewY: cs.view?.viewY,
    packStatus: state.pack?.status, screenStatus: screenOpenState.status,
  });
}

function previewTextCopyProvenance(raw, props, locale) {
  if (props.localize === false) return 'literal-or-binding';
  const key = raw.trim(), active = getLangTableSync(locale), fallback = getLangTableSync('en_US');
  if (active && Object.hasOwn(active, key)) return `locale:${locale}`;
  if (fallback && Object.hasOwn(fallback, key)) return 'fallback:en_US';
  return looksLikeLangKey(key) ? 'untranslated' : 'literal-or-binding';
}

function preparePreviewTextCopyCapture(file, cs, layout, canvas, selectedId) {
  const scope = capturePreviewClipboardScope();
  const out = { scope, nodesById: Object.create(null), segments: new Map(), selectedId, pocket: false };
  const state = store.getState();
  out.pocket = /pocket/iu.test(`${file?.path || ''} ${getSelectedPreviewQualifiedName(file) || ''}`)
    || file?.uiModel?.unknownFields?.$pocket_screen === true;
  const preset = getLogicalCanvasPreset(cs);
  const frameReady = isPreviewInteractionFrameCurrent({ state, file, canvasState: cs, preset,
    assetMetricsRevision: previewAssetMetricsRevision, nodeFrameAvailability, animationEvent: previewAnimationEvent });
  if (!selectedId || !file || out.pocket || cs.previewClosed || cs.layoutError || cs.interaction?.active
    || state.pack?.status === 'loading' || screenOpenState.status === 'loading'
    || !frameReady) {
    out.code = out.pocket ? 'COPY_POCKET_BLOCKED' : 'COPY_SNAPSHOT_STALE'; return out;
  }
  const boxes = new Map((layout?.boxes || []).map(box => [String(box.id), box]));
  const ids = new Set(), pending = [{ id: String(selectedId), depth: 0 }];
  while (pending.length) {
    const { id, depth } = pending.pop();
    if (ids.has(id)) continue;
    if (depth > 64 || ids.size >= 2000) { out.code = 'COPY_SELECTION_LIMIT'; return out; }
    ids.add(id);
    for (const child of file.nodesById?.[id]?.children || []) pending.push({ id: String(child), depth: depth + 1 });
  }
  const rect = canvas.getBoundingClientRect(), z = clampZoom(cs.view?.zoom || 1);
  const viewport = { x: Number(cs.view?.viewX) || 0, y: Number(cs.view?.viewY) || 0, w: rect.width / z, h: rect.height / z };
  const allParentIds = new Map();
  for (const box of boxes.values()) allParentIds.set(String(box.id), box.parentId == null ? null : String(box.parentId));
  const flags = id => {
    let visible = true, secret = false, depth = 0, cursor = id;
    const seen = new Set();
    while (cursor != null && !seen.has(cursor) && depth++ <= 64) {
      seen.add(cursor);
      const node = file.nodesById?.[cursor];
      const props = { ...node?.unknownProps, ...node?.props, ...cs.propsByIdOverride?.[cursor] };
      const textType = resolveLocalRuntimePropertyToken(props.text_type, props);
      if (String(textType || '').toLowerCase() === 'password' || /^[#$]/u.test(String(textType || ''))
        || props.password === true || props.is_password === true) secret = true;
      if (props.visible !== undefined && ![true, 1, 'true', '1'].includes(props.visible)) visible = false;
      if (props.ignored !== undefined && ![false, 0, 'false', '0'].includes(props.ignored)) visible = false;
      cursor = allParentIds.get(cursor) ?? null;
    }
    if (depth > 64) secret = true;
    return { visible, secret };
  };
  for (const id of ids) {
    const node = file.nodesById?.[id], box = boxes.get(id), inherited = flags(id);
    if (!node) continue;
    let visible = inherited.visible && Boolean(box) && (box.renderAlpha ?? 1) > 0;
    if (box) {
      const clip = box.clipRect;
      const left = Math.max(box.x, viewport.x, clip ? clip.x : -Infinity);
      const top = Math.max(box.y, viewport.y, clip ? clip.y : -Infinity);
      const right = Math.min(box.x + box.w, viewport.x + viewport.w, clip ? clip.x + clip.w : Infinity);
      const bottom = Math.min(box.y + box.h, viewport.y + viewport.h, clip ? clip.y + clip.h : Infinity);
      visible = visible && right > left && bottom > top;
    }
    const copyNode = { id, parentId: box?.parentId, children: node.children || [], visible,
      secret: inherited.secret, unsupportedText: visible && ['custom', 'custom_renderer'].includes(node.type) };
    out.nodesById[id] = copyNode;
    const props = { ...node.unknownProps, ...node.props, ...cs.propsByIdOverride?.[id] };
    if (visible && ['label', 'button', 'dropdown', 'edit_box'].includes(node.type)) {
      // If text building skips an unresolved/loading label, retain a reason, never its token.
      const text = inherited.secret ? undefined : resolveLocalRuntimePropertyToken(props.text, props);
      const unresolved = typeof text === 'string' && /^[#$]/u.test(text.trim());
      if (inherited.secret || unresolved || typeof text === 'string' && text.length) {
        // The renderer deliberately skips whitespace-only strings; their logical spaces remain exact.
        const whitespaceOnly = typeof text === 'string' && text.length > 0 && !text.trim();
        out.segments.set(id, createRenderedTextSegment({ nodeId: id, secret: inherited.secret, unresolved,
          ready: whitespaceOnly, text: whitespaceOnly ? text : undefined }));
      }
    }
  }
  return out;
}

function commitPreviewTextCopyCapture(capture) {
  if (!sameClipboardScope(capture.scope, capturePreviewClipboardScope())) return;
  previewTextCopySnapshot = capture.code ? null : buildRenderedTextSnapshot({ scope: capture.scope,
    renderRevision: ++previewTextCopyRenderRevision, nodes: Object.values(capture.nodesById),
    segments: [...capture.segments.values()], pocket: capture.pocket });
  previewTextCopyPrepared = capture.code ? { status: 'unavailable', code: capture.code }
    : describeSelectedTextCopy(previewTextCopySnapshot, capture.selectedId);
  if (previewTextCopyFallback && !sameClipboardScope(previewTextCopyFallback.scope, capture.scope)) previewTextCopyFallback = null;
  refreshPreviewTextCopyControls();
}

function refreshPreviewTextCopyControls() {
  const button = document.getElementById('preview-copy-selected-text');
  const status = document.getElementById('preview-copy-text-status');
  const prepared = previewTextCopyPrepared;
  if (button) button.disabled = prepared?.status !== 'ready' || applicationClipboardBroker.isBusy();
  if (status) status.textContent = prepared?.status === 'ready'
    ? siteText`要素の全文: ${prepared.count}件・${prepared.codeUnits}文字。${prepared.provenance.includes('fallback:en_US') ? siteText('英語へのfallbackを含みます。') : ''}${prepared.provenance.includes('untranslated') ? siteText('未翻訳の表示文字を含みます。') : ''}`
    : translateSiteMessage(clipboardStatusMessage(prepared?.code || 'COPY_SELECTION_NOT_READY'));
  const fallback = document.getElementById('preview-copy-manual');
  const text = document.getElementById('preview-copy-manual-text');
  if (fallback) fallback.hidden = !previewTextCopyFallback;
  if (text && text.value !== (previewTextCopyFallback?.text || '')) text.value = previewTextCopyFallback?.text || '';
}

function displayPreviewClipboardResult(result, intent) {
  const current = sameClipboardScope(intent.scope, capturePreviewClipboardScope());
  if (!result.ok && current && ['COPY_API_UNAVAILABLE', 'COPY_WRITE_DENIED', 'COPY_WRITE_FAILED'].includes(result.code)) {
    previewTextCopyFallback = { text: intent.text, sourceLabel: intent.sourceLabel, scope: intent.scope };
  }
  const message = `${clipboardSourceLabel(result.sourceLabel, intent)}: ${translateSiteMessage(clipboardStatusMessage(result.code))}`;
  setStatus(message);
  const status = document.getElementById('preview-copy-text-status');
  refreshPreviewTextCopyControls();
  if (status) status.textContent = translateSiteMessage(message);
  // Fixed fields only: no payload, raw browser exception, account URL, or scope object.
  if (result.status !== 'writing') diagnostics.log(result.ok ? 'info' : 'warn', siteText('表示文字コピーの結果'), {
    source: 'preview-clipboard', data: { code: result.code, requestId: result.requestId, mode: intent.mode, currentScope: current },
  });
}

/** Root interaction entry calls this synchronously with its trusted event, before awaits. */
function submitPreviewClipboardEffect(effect, event) {
  const context = getInteractionPreviewContext();
  if (!context.enabled || context.pocket || runtimeStateEditor.dirty || !effect?.intent) return false;
  const intent = effect.intent;
  const ticket = applicationClipboardBroker.writePrepared(intent, { event,
    isCurrent: () => sameClipboardScope(intent.scope, capturePreviewClipboardScope()),
    onResult: result => displayPreviewClipboardResult(result, intent),
    onSlow: result => displayPreviewClipboardResult(result, intent),
  });
  displayPreviewClipboardResult(ticket, intent);
  return ticket;
}

function renderSelectedTextCopyControls() {
  const status = previewTextCopyPrepared;
  const controls = h('div', { class: 'element-crud-section', id: 'preview-text-copy-controls' }, [
    h('button', { type: 'button', class: 'btn', id: 'preview-copy-selected-text', disabled: status?.status !== 'ready',
      // Preserve a live edit_box's focus, selection and IME when the pointer uses this tool.
      onPointerDown: event => { if (event.button === 0) event.preventDefault(); },
      onClick: event => {
        const prepared = previewTextCopyPrepared;
        if (prepared?.status !== 'ready') { setStatus(translateSiteMessage(clipboardStatusMessage(prepared?.code))); return; }
        const intent = Object.freeze({ kind: 'clipboardWriteText', mode: 'editor', text: prepared.text,
          scope: prepared.scope, sourceLabel: siteText`選択要素の表示文字（${store.getState().files.currentFileId || ''}）` });
        const ticket = applicationClipboardBroker.writePrepared(intent, { event,
          isCurrent: () => sameClipboardScope(intent.scope, capturePreviewClipboardScope()),
          onResult: result => displayPreviewClipboardResult(result, intent),
          onSlow: result => displayPreviewClipboardResult(result, intent),
        });
        displayPreviewClipboardResult(ticket, intent);
      },
    }, [siteText('選択要素の表示テキストをコピー')]),
    h('div', { class: 'hint', id: 'preview-copy-text-status', role: 'status' }, [status?.status === 'ready'
      ? siteText`要素の全文: ${status.count}件・${status.codeUnits}文字。` : translateSiteMessage(clipboardStatusMessage(status?.code || 'COPY_SELECTION_NOT_READY'))]),
    h('div', { id: 'preview-copy-manual', hidden: !previewTextCopyFallback }, [
      h('p', { class: 'hint' }, [siteText('この文字を選択してコピーできます。要素の全文で、自動折り返しの改行は追加しません。')]),
      h('textarea', { id: 'preview-copy-manual-text', readonly: true, rows: 5,
        'aria-label': siteText('手動コピー用の表示文字（要素の全文）'), style: 'width:100%;box-sizing:border-box;user-select:text;' }, [previewTextCopyFallback?.text || '']),
    ]),
  ]);
  return controls;
}

/**
 * Best-effort clipboard copy for text.
 *
 * Prefers the Async Clipboard API when available, and falls back to a hidden
 * textarea + document.execCommand('copy') (deprecated; best-effort).
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyTextToClipboard(text) {
  try { return await applicationClipboardBroker.runExclusive(() => copyLegacyTextToClipboard(text)); }
  catch { return false; }
}

async function copyLegacyTextToClipboard(text) {
  const value = String(text ?? '');

  // Prefer async clipboard API when available.
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (e) {
    // continue to fallback below
  }

  // Fallback: textarea selection + execCommand('copy') (deprecated).
  let ta;
  try {
    ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    return Boolean(ok);
  } catch (e) {
    return false;
  } finally {
    ta?.remove();
  }
}

/**
 * Render a <pre> code block with optional JSON syntax highlighting.
 *
 * Highlighting is disabled automatically for large texts to avoid DOM bloat.
 *
 * @param {string} text
 * @param {{ className?: string, highlight?: boolean }} [opts]
 */
function renderJsonCodeBlock(text, opts = {}) {
  const className = opts.className || 'code-block';
  const highlight = opts.highlight === undefined ? true : Boolean(opts.highlight);
  const s = String(text ?? '');

  if (!highlight || s.length === 0 || s.length > JSON_HIGHLIGHT_MAX_CHARS) {
    return h('pre', { class: className }, [s]);
  }

  let tokens;
  try {
    tokens = tokenizeJsonForHighlight(s);
  } catch (e) {
    return h('pre', { class: className }, [s]);
  }

  const children = tokens.map((t) => {
    if (t.type === 'whitespace') return t.value;
    return h('span', { class: `json-token json-${t.type}` }, [t.value]);
  });

  return h('pre', { class: className }, [h('code', {}, children)]);
}

/**
 * @param {{ label: string, getText: () => string, statusOk: string }} params
 * @returns {HTMLButtonElement}
 */
function makeCopyButton(params) {
  return h(
    'button',
    {
      type: 'button',
      class: 'btn',
      onClick: async () => {
        const text = params.getText();
        const ok = await copyTextToClipboard(text);
        setStatus(ok ? params.statusOk : 'Copy failed (clipboard unavailable).');
      },
    },
    [params.label]
  );
}

/**
 * @param {import('./state-store/app-store.js').AppState} state
 */
function renderRawJsonPanel(state) {
  const fileId = state.files.currentFileId;
  const file = fileId ? state.files.byId[fileId] : null;
  const selection = state.editor.selection.nodeId;

  if (!file) {
    return h('div', {}, [
      h('div', {}, ['No file open.']),
      h('div', { class: 'hint' }, [
        'Open a sample file from the Tree panel to see a raw JSON representation of the current file state.',
      ]),
    ]);
  }

  const payload = {
    path: file.path,
    kind: file.kind,
    dirty: file.dirty,
    rootId: file.rootId,
    selection,
    nodesById: file.nodesById,
  };

  const hasSourceText = typeof file.sourceText === 'string';
  const sourceText = hasSourceText ? String(file.sourceText) : null;

  const hasModelText = typeof file.modelOutputText === 'string' && String(file.modelOutputText).trim().length > 0;
  const modelText = hasModelText ? String(file.modelOutputText) : null;

  const text = file.meta?.previewProjection ? sourceText || '' : modelText || sourceText || stableStringifyDebug(payload);
  const hintText = file.meta?.previewProjection ? siteText('元ファイルの JSON 原文です。編集モードで変更できます。') : modelText
    ? 'Showing deterministic model output (strict JSON, S030).'
    : hasSourceText
      ? 'Showing the file source text (read-only).'
      : 'This view shows the current in-memory model (stub for now).';
  const copiedStatus = file.meta?.previewProjection ? siteText('元ファイルの JSON 原文をコピーしました。') : modelText
    ? 'Copied model output JSON to clipboard.'
    : hasSourceText
      ? 'Copied source JSON to clipboard.'
      : 'Copied raw JSON to clipboard.';

  const highlightMain = Boolean(modelText || !hasSourceText);
  const hintParts = [hintText];
  if (highlightMain && String(text).length > JSON_HIGHLIGHT_MAX_CHARS) {
    hintParts.push('Syntax highlighting disabled (large text).');
  }

  const validation = file && file.validation && typeof file.validation === 'object' ? file.validation : null;
  const validationSummary = validation ? summarizeValidation(validation) : null;
  const exportBlocked = Boolean(validation && Array.isArray(validation.errors) && validation.errors.length > 0);

  function makeSafeDownloadName(packPath) {
    const raw = String(packPath || 'file.json');
    const base = raw.split('/').pop() || 'file.json';
    const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return cleaned.toLowerCase().endsWith('.json') ? cleaned : `${cleaned}.json`;
  }

  function exportCurrentFileJson() {
    assertStudioExternalChange21('原文ファイルの書き出し');
    const s = store.getState();
    const currentId = s.files.currentFileId;
    const f = currentId ? s.files.byId[currentId] : null;
    if (!f) return;
    if (f.meta?.previewProjection) {
      if (workspacePreviewBlocked()) { setStatus(siteText('未適用または無効な原文があります。先に編集内容を確認してください。')); return; }
      const filename = makeSafeDownloadName(f.path);
      downloadTextFile({ filename, text: String(f.sourceText || ''), mime: 'application/json' });
      setStatus(siteText`原文を保存しました: ${filename}`);
      return;
    }

    // Re-run validation right before exporting.
    let v = f.validation;
    try {
      if (f.uiModel) {
        v = validateUiScreenModel(f.uiModel, {
          filePath: typeof f.packPath === 'string' ? f.packPath : typeof f.path === 'string' ? f.path : undefined,
          sourceJson: f.validationSourceJson || f.sourceJson,
          supportedTypes: [...VALID_UI_ELEMENT_TYPES],
          referenceContext: buildReferenceContextForValidation(f),
        });
        store.dispatch(actions.patchFile({ fileId: f.id, patch: { validation: v } }));
      }
    } catch {
      // If validation fails unexpectedly, block export defensively.
      setStatus('Export blocked: validator threw an unexpected error. See Logs.');
      return;
    }

    if (v && Array.isArray(v.errors) && v.errors.length > 0) {
      setStatus(`Export blocked: ${v.errors.length} validation error(s).`);
      return;
    }

    if (workspacePreviewBlocked()) { setStatus(siteText('原文に未適用の変更があります。修正を反映するか取り消してください。')); return; }
    const outText = f.meta?.previewProjection ? f.sourceText :
      (typeof f.modelOutputText === 'string' && f.modelOutputText.trim().length > 0)
        ? f.modelOutputText
        : (typeof f.sourceText === 'string' ? f.sourceText : stableStringifyDebug({ id: f.id, path: f.path, kind: f.kind }));
    const filename = makeSafeDownloadName(f.path);
    downloadTextFile({ filename, text: String(outText), mime: 'application/json' });
    setStatus(`Downloaded ${filename}`);
  }

  const validationDetails = validation
    ? h('details', { style: 'margin-top: 8px;', open: exportBlocked ? 'open' : null }, [
        h('summary', {}, [validationSummary || 'Validation'] ),
        exportBlocked ? h('div', { class: 'hint error', style: 'margin-top: 6px;' }, ['Export is blocked while errors exist.']) : null,
        Array.isArray(validation.errors) && validation.errors.length
          ? h('div', { style: 'margin-top: 8px;' }, [
              h('div', { class: 'text-error', style: 'font-weight: 600; margin-bottom: 4px;' }, [`Errors (${validation.errors.length})`]),
              h('ul', { style: 'margin: 0; padding-left: 18px;' },
                validation.errors.slice(0, 100).map((it) =>
                  h('li', { class: 'validation-issue' }, [
                    h('div', {}, [
                      h('span', { class: 'code' }, [String(it.code || 'ERROR')]),
                      ': ',
                      String(it.message || ''),
                      it.nodeKey ? h('span', { class: 'code' }, [` (${it.nodeKey})`]) : null,
                      it.propKey ? h('span', { class: 'code' }, [` [${it.propKey}]`]) : null,
                    ]),
                    h('div', { class: 'text-subtle', style: 'font-size: 12px; margin-top: 2px;' }, [
                      [
                        it.filePath ? `file: ${it.filePath}` : null,
                        it.nodeId ? `id: ${it.nodeId}` : null,
                      ].filter(Boolean).join(' • '),
                    ]),
                  ])
                )
              ),
            ])
          : null,
        Array.isArray(validation.warnings) && validation.warnings.length
          ? h('div', { style: 'margin-top: 8px;' }, [
              h('div', { class: 'text-warn', style: 'font-weight: 600; margin-bottom: 4px;' }, [`Warnings (${validation.warnings.length})`]),
              h('ul', { style: 'margin: 0; padding-left: 18px;' },
                validation.warnings.slice(0, 100).map((it) =>
                  h('li', { class: 'validation-issue' }, [
                    h('div', {}, [
                      h('span', { class: 'code' }, [String(it.code || 'WARN')]),
                      ': ',
                      String(it.message || ''),
                      it.nodeKey ? h('span', { class: 'code' }, [` (${it.nodeKey})`]) : null,
                      it.propKey ? h('span', { class: 'code' }, [` [${it.propKey}]`]) : null,
                    ]),
                    h('div', { class: 'text-subtle', style: 'font-size: 12px; margin-top: 2px;' }, [
                      [
                        it.filePath ? `file: ${it.filePath}` : null,
                        it.nodeId ? `id: ${it.nodeId}` : null,
                      ].filter(Boolean).join(' • '),
                    ]),
                  ])
                )
              ),
            ])
          : null,
      ])
    : null;

  return h('div', {}, [
    h('div', { class: 'raw-json-actions' }, [
      makeCopyButton({
        label: modelText ? 'Copy Output' : 'Copy',
        getText: () => String(text),
        statusOk: copiedStatus,
      }),
      sourceText && modelText
        ? makeCopyButton({
            label: 'Copy Source',
            getText: () => String(sourceText),
            statusOk: 'Copied source JSON to clipboard.',
          })
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          disabled: exportBlocked ? 'disabled' : null,
          title: exportBlocked && validationSummary ? validationSummary : 'Download current JSON',
          onClick: exportCurrentFileJson,
        },
        ['Download JSON']
      ),
      h('span', { class: 'hint' }, [hintParts.join(' ')]),
      validationSummary
        ? h(
            'span',
            {
              class: exportBlocked ? 'text-error' : (validation && validation.warningCount ? 'text-warn' : null),
              style: 'margin-left: 8px;',
            },
            [validationSummary]
          )
        : null,
    ]),
    renderJsonCodeBlock(String(text), { className: 'code-block', highlight: highlightMain }),
    validationDetails,
    sourceText && modelText
      ? h('details', { style: 'margin-top: 8px;' }, [
          h('summary', {}, ['Show original source (read-only)']),
          renderJsonCodeBlock(String(sourceText), { className: 'code-block', highlight: false }),
        ])
      : null,
  ]);
}

/* --- S054: Missing references report panel ---------------------------- */

/**
 * Return the currently open file objects (openFileIds order).
 * Defensive helper used by panels that need to iterate open files.
 *
 * @param {{ openFileIds?: string[], byId?: Record<string, any> }|null|undefined} filesState
 * @returns {any[]}
 */
function getOpenFilesList(filesState) {
  try {
    if (!filesState || typeof filesState !== 'object') return [];
    const ids = Array.isArray(filesState.openFileIds) ? filesState.openFileIds : [];
    const byId = filesState.byId && typeof filesState.byId === 'object' ? filesState.byId : {};
    const out = [];
    for (const id of ids) {
      const f = byId[id];
      if (f) out.push(f);
    }
    return out;
  } catch (err) {
    // Ensure the References panel never hard-crashes the whole UI.
    try {
      diagnostics.captureError(err, { module: 'state', where: 'getOpenFilesList' });
    } catch {
      // ignore
    }
    return [];
  }
}

function collectMissingReferencesFromState(state, options = {}) {
  return collectMissingReferences(state, options);
}

function validationContentKey(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const { updatedAtIso, ...content } = value;
  return JSON.stringify(content);
}
let validationRunActive = false;
let validationPending = null;
let validationGeneration = 0;
let referenceValidationAbort = null;
async function revalidateScreenFiles(screenFiles, scopeLabel) {
  if (referenceRevalidationSuspended) return;
  if (sourceWorkspace.state.workspaceId && sourceWorkspace.previewBlocked()) return;
  validationPending = { screenFiles, scopeLabel, generation: ++validationGeneration };
  if (validationRunActive) return;
  validationRunActive = true;
  try {
    while (validationPending && !referenceRevalidationSuspended) {
      const job = validationPending; validationPending = null;
      const validationAbort = new AbortController();
      referenceValidationAbort = validationAbort;
      const state = store.getState(), mockData = state.preview?.mockData || {}, locale = state.ui?.previewLocale || 'en_US';
      const validationUpdates = [];
      for (const f of job.screenFiles) {
        if (referenceRevalidationSuspended || validationPending || job.generation !== validationGeneration) break;
        if (!f || f.kind !== 'screen' || !f.uiModel) continue;
        if (sourceWorkspace.state.workspaceId && sourceWorkspace.previewBlocked()) break;
        if (store.getState().files.byId[f.id]?.uiModel !== f.uiModel) continue;
        try {
          const projectionId = f.meta?.resolution?.nodeProjectionId;
          const horse = nativeHorsePreviewState;
          const nativeModelPreviews = { bookTextureRef: 'textures/entity/enchanting_table_book', horse: {
            status: horse.status, textureRef: horse.textureRef || '', textureRefs: horse.textureRefs || [],
            issue: horse.issue || null, detail: horse.detail || null, previewState: horse.previewState || null, camera: horse.camera || null },
            player: { status: nativePlayerPreviewState.status, textureRef: nativePlayerPreviewState.textureRef || '',
              textureRefs: nativePlayerPreviewState.textureRefs || [], issue: nativePlayerPreviewState.issue || null,
              provenance: nativePlayerPreviewState.provenance || null } };
          const v = projectionId ? (await nodeValidatePreview({ projectionId, filePath: f.path,
            recordId: f.meta?.selectedDefinition?.recordId, mockData, locale, nativeModelPreviews,
            nativeTextureFailures: Object.fromEntries([...nativeTextureFailureCodes].slice(0, MAX_NATIVE_TEXTURE_FAILURE_CODES)) }, AbortSignal.any([validationAbort.signal, AbortSignal.timeout(30000)]))).validation
            : validateUiScreenModel(f.uiModel, { filePath: f.path, sourceJson: f.validationSourceJson || uiScreenModelToJson(f.uiModel),
                supportedTypes: [...VALID_UI_ELEMENT_TYPES], referenceContext: buildReferenceContextForValidation(f) });
          const current = store.getState();
          if (current.files.byId[f.id]?.uiModel !== f.uiModel || current.preview?.mockData !== mockData || (current.ui?.previewLocale || 'en_US') !== locale || job.generation !== validationGeneration) continue;
          if (validationContentKey(current.files.byId[f.id]?.validation) !== validationContentKey(v)) validationUpdates.push({ fileId: f.id, patch: { validation: v } });
        } catch (error) {
          // 開始時には有効だった要求でも、原文編集が後から開始し得る。
          // 現在の UI の失敗と、失効した世代の応答を区別する。
          if (referenceRevalidationSuspended || job.generation !== validationGeneration || store.getState().files.byId[f.id]?.uiModel !== f.uiModel
            || (sourceWorkspace.state.workspaceId && sourceWorkspace.previewBlocked())) continue;
          diagnostics.captureError(error, { source: 'validation', message: siteText`検証を更新できません: ${f.path}` });
        }
        // 一度に全タブの同期計算でUIを占有しない。Node失敗時にも同期重処理へ戻さない。
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const latest = store.getState();
      if (job.generation === validationGeneration && latest.preview?.mockData === mockData && (latest.ui?.previewLocale || 'en_US') === locale) {
        const models = new Map(job.screenFiles.map(file => [file.id, file.uiModel]));
        const currentUpdates = validationUpdates.filter(update => latest.files.byId[update.fileId]?.uiModel === models.get(update.fileId));
        if (currentUpdates.length) store.dispatch(actions.patchFiles(currentUpdates));
      }
    }
  } finally { validationRunActive = false; referenceValidationAbort = null; }
}

function revalidateOpenScreenFiles() {
  const state = store.getState();
  const screenFiles = getOpenFilesList(state?.files).filter((file) => file?.kind === 'screen');
  revalidateScreenFiles(screenFiles, 'open');
}

function revalidateCurrentScreenFile() {
  const state = store.getState();
  const currentFileId = String(state?.files?.currentFileId || '');
  const currentFile = currentFileId ? state?.files?.byId?.[currentFileId] : null;
  const screenFiles = currentFile && currentFile.kind === 'screen' ? [currentFile] : [];
  revalidateScreenFiles(screenFiles, 'current');
}

/**
 * @param {import('./state-store/app-store.js').AppState} state
 */
function renderReferencesPanel(state) {
  const previewLocaleRaw = state && state.ui ? state.ui.previewLocale : 'en_US';
  const previewLocale = SUPPORTED_PREVIEW_LOCALES.includes(previewLocaleRaw) ? previewLocaleRaw : 'en_US';

  
let missing = null;
try {
  missing = collectMissingReferencesFromState(state);
} catch (err) {
  diagnostics.captureError(err, {
    source: 'references',
    message: 'collectMissingReferencesFromState failed',
    data: {
      openFileIdsCount: Array.isArray(state?.files?.openFileIds) ? state.files.openFileIds.length : 0,
    },
  });
  missing = {
    scannedScreens: 0,
    textures: [],
    fonts: [],
    langKeys: [],
    globalVars: [],
    error: String(err && err.message ? err.message : err),
  };
}
  const missingCounts = {
    textures: missing.textures.length,
    fonts: missing.fonts.length,
    langKeys: missing.langKeys.length,
    globalVars: missing.globalVars.length,
  };

  const langTable = langTableRuntime.tablesByLocale.get(previewLocale) || null;
  const langTableLoaded = Boolean(langTable && langTable.status === 'ready');
  const langTableLoading = langTableRuntime.inflightByLocale.has(previewLocale);
  const langCount = langTableLoaded && langTable.table && typeof langTable.table === 'object'
    ? Object.keys(langTable.table).length
    : 0;

  const globalVarStatus = globalVarNamesRuntime.status;
  const globalVarCount = globalVarStatus === 'ready' ? globalVarNamesRuntime.names.size : 0;

  const runtimeInfo = h('div', { class: 'small', style: 'margin-bottom: 8px;' }, [
    h('div', {}, [
      h('strong', {}, ['Reference context: ']),
      `previewLocale=${previewLocale}`,
    ]),
  ]);



const panelErrorNote =
  missing && missing.error
    ? h('div', { class: 'hint error', style: 'margin-bottom: 8px;' }, [
        `References panel error: ${missing.error}`,
      ])
    : null;

  const actionsRow = h('div', { class: 'row', style: 'gap: 8px; margin-bottom: 8px;' }, [
    h('button', { class: 'btn', onClick: () => revalidateCurrentScreenFile() }, [t('references.refresh')]),
    h(
      'button',
      {
        class: 'btn',
        onClick: () => {
          const nowIso = new Date().toISOString();
          const report = {
            generatedAtIso: nowIso,
            validationStatus: missing.error ? 'INCONCLUSIVE' : 'OBSERVED',
            error: missing.error || null,
            previewLocale,
            scope: missing.scope,
            scannedScreens: missing.scannedScreens,
            screen: missing.screen,
            missing: {
              textures: missing.textures,
              fonts: missing.fonts,
              langKeys: missing.langKeys,
              globalVars: missing.globalVars,
            },
            runtime: {
              assetIndex: {
                imported: importedPackRuntime ? importedPackRuntime.assetIndexSummary : null,
                vanilla: vanillaReferenceRuntime ? vanillaReferenceRuntime.assetIndexSummary : null,
              },
              langTable: {
                loaded: langTableLoaded,
                loading: langTableLoading,
                entryCount: langCount,
              },
              globalVarNames: {
                status: globalVarNamesRuntime.status,
                entryCount: globalVarCount,
                lastLoadedAtIso: globalVarNamesRuntime.lastLoadedAtIso,
                error: globalVarNamesRuntime.error,
                source: globalVarNamesRuntime.source,
              },
            },
          };

          const text = stableStringify(report, { sortKeys: true, indent: 2 });
          downloadTextFile({
            filename: 'missing_references_report.json',
            text,
            mime: 'application/json',
          });
        },
      },
      [t('references.export')]
    ),
  ]);

  const renderCategory = (title, items) => {
    if (!items || items.length === 0) {
      return h('details', { style: 'margin-top: 6px;' }, [h('summary', {}, [`${title}: 0`])]);
    }
    return h('details', { open: 'open', style: 'margin-top: 6px;' }, [
      h('summary', {}, [`${title}: ${items.length}`]),
      h(
        'ul',
        { class: 'list', style: 'margin-top: 6px;' },
        items.slice(0, 200).map((it) =>
          h('li', { class: 'list-item' }, [
            h('div', {}, [h('code', {}, [String(it.ref)]), ` (${it.count} file(s))`]),
            it.files && it.files.length
              ? h('div', { class: 'small', style: 'opacity: 0.8;' }, [it.files.slice(0, 5).join(', ') + (it.files.length > 5 ? ' ...' : '')])
              : null,
          ])
        )
      ),
      items.length > 200
        ? h('div', { class: 'small', style: 'opacity: 0.75; margin-top: 4px;' }, [`(List truncated to first 200 items)`])
        : null,
    ]);
  };

  const emptyState =
    !missing.error &&
    missingCounts.textures === 0 &&
    missingCounts.fonts === 0 &&
    missingCounts.langKeys === 0 &&
    missingCounts.globalVars === 0
      ? h('div', { class: 'small', style: 'margin-top: 8px; opacity: 0.85;' }, [t('references.noMissing')])
      : null;

  return h('div', { class: 'panel panel-right-body' }, [
    h('div', { class: 'panel-header' }, [h('strong', {}, [t('references.title')])]),
    h('div', { class: 'panel-content' }, [
      actionsRow,
      runtimeInfo,
      panelErrorNote,
      h('div', { class: 'small', style: 'opacity: 0.85; margin-bottom: 6px;' }, [
        t('references.scopeNote'),
      ]),
      renderCategory(t('references.missingTextures'), missing.textures),
      renderCategory(t('references.missingFonts'), missing.fonts),
      renderCategory(t('references.missingLangKeys'), missing.langKeys),
      renderCategory(t('references.missingGlobalVars'), missing.globalVars),
      emptyState,
    ]),
  ]);
}

/**
 * @param {import('./state-store/app-store.js').AppState} state
 */
function renderDebugPanel(state) {
  const fileId = state.files.currentFileId;
  const file = fileId ? state.files.byId[fileId] : null;

  const debugToggle = h('label', { class: 'props-debug' }, [
    h('input', {
      type: 'checkbox',
      checked: state.ui.debug ? 'checked' : null,
      onChange: () => store.dispatch(actions.toggleDebug()),
    }),
    ' Console action log',
  ]);

  const summary = {
    route: state.ui.route,
    panels: state.ui.panels,
    tabs: state.ui.tabs,
    selection: state.editor.selection,
    currentFile: file
      ? {
          id: file.id,
          path: file.path,
          kind: file.kind || null,
          dirty: Boolean(file.dirty),
          readOnly: Boolean(file.readOnly),
          treeStats: file.meta && file.meta.treeStats ? file.meta.treeStats : null,
          uiModelSummary: file.meta && file.meta.uiModelSummary ? file.meta.uiModelSummary : null,
        }
      : null,
    openFiles: state.files.openFileIds.map((id) => {
      const f = state.files.byId[id];
      return f ? { id: f.id, path: f.path, dirty: f.dirty } : { id, path: id, dirty: false };
    }),
  };

  return h('div', {}, [
    h('div', { class: 'hint' }, [
      'Use the Logs route for captured errors, warnings, and detailed exports. This tab is a lightweight state view.',
    ]),
    debugToggle,
    h('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0;' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: () => {
            window.location.hash = '#/logs';
          },
        },
        [t('nav.logs')]
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: () => {
            // Quick sample entry to verify the panel without causing an exception.
            diagnostics.log('info', 'Sample info log (from Debug tab)', { source: 'debug-tab' });
            safeRender();
          },
        },
        ['Add sample log']
      ),
    ]),
    (() => {
      const importedSummary = importedPackRuntime
        ? importedPackRuntime.assetIndexSummary || summarizeAssetIndex(importedPackRuntime.assetIndex)
        : null;
      const vanillaSummary = vanillaReferenceRuntime
        ? vanillaReferenceRuntime.assetIndexSummary || summarizeAssetIndex(vanillaReferenceRuntime.assetIndex)
        : null;

      return h('div', { class: 'debug-block' }, [
        h('div', { class: 'debug-title' }, ['Asset lookup (S040)']),
        h('div', { class: 'hint' }, [
          'Resolve texture refs to an existing file path using indexed pack assets. Order: imported override → Vanilla base.',
        ]),
        h('pre', { class: 'code-block' }, [stableStringifyDebug({ imported: importedSummary, vanilla: vanillaSummary })]),
        h('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0;' }, [
          h('input', {
            class: 'ui-defs-input',
            type: 'text',
            value: assetLookupState.textureRefInput,
            placeholder: 'ui/test',
            onInput: (e) => {
              const v = e && e.target ? e.target.value : '';
              assetLookupState.textureRefInput = String(v);
            },
          }, []),
          h('button', {
            type: 'button',
            class: 'btn',
            disabled: !importedPackRuntime,
            onClick: () => {
              debugResolveTextureRef();
              render();
            },
          }, ['Resolve texture']),
          h('button', {
            type: 'button',
            class: 'btn',
            onClick: async () => {
              try {
                await rebuildAssetIndexes();
              } catch (err) {
                diagnostics.captureError(err, {
                  source: 'asset-index',
                  message: 'Rebuild asset index failed',
                });
              }
              render();
            },
          }, ['Rebuild indexes']),
          h('button', {
            type: 'button',
            class: 'btn',
            onClick: () => {
              assetLookupState.lastTextureResult = null;
              render();
            },
          }, ['Clear result']),
        ]),
        h('div', { class: 'hint', style: 'margin-top: 8px;' }, [
          t('editor.packStack.versionSettingsDebugHint'),
        ]),
        h('div', {
          id: 'vanilla-reference-settings',
          'aria-label': t('editor.packStack.versionSettings'),
          style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin: 8px 0;',
        }, [
          h('input', {
            class: 'ui-defs-input',
            type: 'text',
            value: vanillaReferenceUiState.expectedBedrockVersion,
            'aria-label': t('editor.packStack.targetVersion'),
            placeholder: t('editor.packStack.targetVersionPlaceholder'),
            onInput: async (e) => {
              const next = String(e?.target?.value || '').trim();
              if (next === vanillaReferenceUiState.expectedBedrockVersion) return;
              assertStudioExternalChange21('バニラの対象バージョン変更');
              vanillaReferenceUiState.expectedBedrockVersion = next;
              await invalidateVanillaReferenceAfterMetadataChange(t('editor.packStack.targetVersion'));
            },
          }, []),
          h('input', {
            class: 'ui-defs-input',
            type: 'text',
            value: vanillaReferenceUiState.sourceRelease,
            'aria-label': t('editor.packStack.sourceRelease'),
            placeholder: t('editor.packStack.sourceReleasePlaceholder'),
            onInput: async (e) => {
              const next = String(e?.target?.value || '').trim();
              if (next === vanillaReferenceUiState.sourceRelease) return;
              assertStudioExternalChange21('バニラの対象バージョン変更');
              vanillaReferenceUiState.sourceRelease = next;
              await invalidateVanillaReferenceAfterMetadataChange(t('editor.packStack.sourceRelease'));
            },
          }, []),
          h('select', {
            class: 'ui-defs-input',
            value: vanillaReferenceUiState.expectedChannel,
            'aria-label': t('editor.packStack.targetChannel'),
            onChange: async (e) => {
              const next = e?.target?.value === 'preview' ? 'preview' : 'stable';
              if (next === vanillaReferenceUiState.expectedChannel) return;
              assertStudioExternalChange21('バニラの対象バージョン変更');
              vanillaReferenceUiState.expectedChannel = next;
              await invalidateVanillaReferenceAfterMetadataChange(t('editor.packStack.targetChannel'));
            },
          }, [
            h('option', { value: 'stable' }, [t('editor.packStack.targetChannelStable')]),
            h('option', { value: 'preview' }, [t('editor.packStack.targetChannelPreview')]),
          ]),
          h('select', {
            class: 'ui-defs-input',
            value: vanillaReferenceUiState.sourceChannel,
            'aria-label': t('editor.packStack.sourceChannel'),
            onChange: async (e) => {
              const next = e?.target?.value === 'preview' ? 'preview' : 'stable';
              if (next === vanillaReferenceUiState.sourceChannel) return;
              assertStudioExternalChange21('バニラの対象バージョン変更');
              vanillaReferenceUiState.sourceChannel = next;
              await invalidateVanillaReferenceAfterMetadataChange(t('editor.packStack.sourceChannel'));
            },
          }, [
            h('option', { value: 'stable' }, [t('editor.packStack.sourceChannelStable')]),
            h('option', { value: 'preview' }, [t('editor.packStack.sourceChannelPreview')]),
          ]),
        ]),
        h('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0;' }, [
          h('input', {
            type: 'file',
            accept: '.zip,application/zip',
            disabled: vanillaReferenceUiState.status === 'loading' ? 'disabled' : null,
            onChange: async (e) => {
              const f = e && e.target && e.target.files ? e.target.files[0] : null;
              if (!f) return;
              await loadVanillaReferenceFromFile(f);
            },
          }, []),
          vanillaReferenceUiState.status === 'loading'
            ? h('button', {
                type: 'button',
                class: 'btn',
                disabled: vanillaReferenceLoadAbortController?.signal.aborted ? 'disabled' : null,
                onClick: () => cancelVanillaReferenceLoad(),
              }, ['Stop vanilla import safely'])
            : null,
          h('button', {
            type: 'button',
            class: 'btn',
            disabled: !vanillaReferenceRuntime,
            onClick: async () => {
              await unloadVanillaReferenceRuntime();
              render();
            },
          }, ['Clear vanilla reference']),
          h('span', { class: 'code' }, [`Status: ${vanillaReferenceUiState.status}`]),
          vanillaReferenceUiState.error
            ? h('span', { class: 'hint error' }, [String(vanillaReferenceUiState.error)])
            : null,
        ].filter(Boolean)),
        vanillaReferenceUiState.audit
          ? h('pre', { class: 'code-block' }, [stableStringifyDebug(vanillaReferenceUiState.audit)])
          : h('div', { class: 'hint' }, ['No Vanilla readiness audit has been recorded in this session.']),
        h('pre', { class: 'code-block' }, [
          assetLookupState.lastTextureResult
            ? stableStringifyDebug(assetLookupState.lastTextureResult)
            : 'No lookup result yet.',
        ]),
      ]);
    })(),
    (() => {
      const currentVersion = state.preview ? Number(state.preview.mockDataVersion) || 0 : 0;
      const currentMockData = state.preview && state.preview.mockData && typeof state.preview.mockData === 'object'
        ? state.preview.mockData
        : {};

      syncMockDataUiFromStore(currentMockData, currentVersion);

      const evalResult = getOrComputeBindingsEvalResult(fileId ? String(fileId) : null, file, state);

      const onAddRow = () => {
        assertStudioExternalChange21('プレビュー状態の行追加');
        mockDataUiState.rows.push({
          id: makeMockDataRowId(),
          keyText: '',
          type: 'boolean',
          boolValue: true,
          valueText: '',
          error: null,
        });
        safeRender();
      };

      const applyKnownObject = (v) => {
        assertStudioExternalChange21('プレビュー状態の読込・初期化');
        clearPendingMockDataApply();
        mockDataUiState.rows = makeMockDataRowsFromObject(v);
        mockDataUiState.error = null;
        mockDataUiState.lastImportError = null;
        mockDataUiState.lastAppliedSerialized = serializeMockDataForCompare(v);
        mockDataUiState.lastSyncedVersion = currentVersion + 1; // avoid resync overwriting UI during store-driven render
        store.dispatch(actions.setMockData(/** @type {any} */ (v)));
        // store.subscribe triggers safeRender()
      };

      const onResetExample = () => {
        applyKnownObject({ "#example_visible": true });
      };

      const onClearAll = () => {
        assertStudioExternalChange21('プレビュー状態の消去');
        clearPendingMockDataApply();
        mockDataUiState.rows = [];
        mockDataUiState.error = null;
        mockDataUiState.lastImportError = null;
        mockDataUiState.lastAppliedSerialized = serializeMockDataForCompare({});
        mockDataUiState.lastSyncedVersion = currentVersion + 1;
        store.dispatch(actions.setMockData({}));
        // store.subscribe triggers safeRender()
      };

      const onApplyNow = () => {
        assertStudioExternalChange21('プレビュー状態の適用');
        clearPendingMockDataApply();
        applyMockDataNow();
      };

      const onExport = () => {
        if (!studioRuntimeChangesBlocked21()) { clearPendingMockDataApply(); applyMockDataNow(); }
        const md = store.getState().preview && store.getState().preview.mockData ? store.getState().preview.mockData : {};
        const filename = `mockData_${makeSafeFileTimestamp()}.json`;
        downloadTextFile({
          filename,
          text: stableStringify(md, { indent: 2, sortKeys: true, finalNewline: true }),
          mime: 'application/json',
        });
      };

      const onImport = async (e) => {
        let isCurrent = () => true;
        try {
          assertStudioExternalChange21('プレビュー状態ファイルの読込');
          const input = e && e.target ? e.target : null;
          const fileObj = input && input.files && input.files.length ? input.files[0] : null;
          if (!fileObj) return;
          const owner = {};
          mockDataUiState.importOwner = owner;
          const initialState = store.getState();
          const initialFileId = initialState.files.currentFileId;
          const initialFile = initialState.files.byId[initialFileId];
          const initialVersion = initialState.preview?.mockDataVersion;
          const initialRows = JSON.stringify(mockDataUiState.rows);
          const initialImported = importedPackRuntime, initialVanilla = vanillaReferenceRuntime;
          const initialMutation = resourcePackMutationEpoch;
          isCurrent = () => {
            const latest = store.getState();
            return mockDataUiState.importOwner === owner
              && latest.files.currentFileId === initialFileId && latest.files.byId[initialFileId] === initialFile
              && latest.preview?.mockDataVersion === initialVersion
              && importedPackRuntime === initialImported && vanillaReferenceRuntime === initialVanilla
              && resourcePackMutationEpoch === initialMutation
              && JSON.stringify(mockDataUiState.rows) === initialRows;
          };
          if (!Number.isSafeInteger(fileObj.size) || fileObj.size < 0 || fileObj.size > 262144) {
            throw new Error('プレビュー状態ファイルは 256 KiB 以下の JSON を指定してください。');
          }
          const txt = await fileObj.text();
          if (!isCurrent()) return;
          if (boundedUtf8Length(txt) > 262144) throw new Error('プレビュー状態ファイルは 256 KiB 以下の JSON を指定してください。');
          assertStudioExternalChange21('プレビュー状態ファイルの読込');
          const res = parseJsonc(String(txt), {
            fileName: String(fileObj.name || 'mockData.jsonc'),
            allowTrailingComma: true,
            allowEmptyContent: true,
          });

          if (!res.ok) {
            mockDataUiState.lastImportError = res.errors.map((er) => er.message).join('\n');
            safeRender();
            return;
          }

          const v = res.value;
          if (!v || typeof v !== 'object' || Array.isArray(v)) {
            mockDataUiState.lastImportError = 'Mock data must be a JSON object (not an array).';
            safeRender();
            return;
          }

          mockDataUiState.lastImportError = null;
          applyKnownObject(/** @type {any} */ (v));
        } catch (err) {
          if (!isCurrent()) return;
          mockDataUiState.lastImportError = String(err && err.message ? err.message : err);
          reportWorkspaceError(err);
        }
      };

      const summaryText = evalResult
        ? stableStringifyDebug({ stats: evalResult.stats, warnings: evalResult.warnings })
        : 'No bindings evaluation result yet (open a UI screen file first).';

      const renderValueInput = (row) => {
        if (row.type === 'boolean') {
          return h('label', { class: 'hint', style: 'display:flex; align-items:center; gap:6px;' }, [
            h('input', {
              type: 'checkbox',
              checked: Boolean(row.boolValue),
              onChange: (e) => {
                assertStudioExternalChange21('プレビュー状態の行変更');
                row.boolValue = Boolean(e && e.target ? e.target.checked : false);
                scheduleMockDataApply({ immediate: true });
              },
            }, []),
            h('span', {}, [Boolean(row.boolValue) ? 'true' : 'false']),
          ]);
        }

        if (row.type === 'json') {
          return h('textarea', {
            class: `code-textarea ${row.error ? 'input-error' : ''}`,
            style: 'width: 100%; min-height: 60px; resize: vertical;',
            value: String(row.valueText ?? ''),
            placeholder: '{ "example": 1 }',
            onInput: (e) => {
              assertStudioExternalChange21('プレビュー状態の行変更');
              row.valueText = String(e && e.target ? e.target.value : '');
              scheduleMockDataApply();
            },
          }, []);
        }

        // number|string
        const isNumber = row.type === 'number';
        return h('input', {
          type: 'text',
          class: `global-vars-value ${row.error ? 'input-error' : ''}`,
          value: String(row.valueText ?? ''),
          placeholder: isNumber ? '0' : 'text',
          onInput: (e) => {
            assertStudioExternalChange21('プレビュー状態の行変更');
            row.valueText = String(e && e.target ? e.target.value : '');
            scheduleMockDataApply();
          },
        }, []);
      };

      const rowsUi = mockDataUiState.rows.length === 0
        ? [h('div', { class: 'hint' }, ['No mock entries. Click "Add row" to define keys used by bindings.'])]
        : mockDataUiState.rows.map((row) => h('div', { style: 'margin: 6px 0;' }, [
            h('div', { class: 'global-vars-row' }, [
              h('input', {
                type: 'text',
                class: `global-vars-name ${row.error === 'Duplicate key' ? 'input-error' : ''}`,
                value: String(row.keyText ?? ''),
                placeholder: '#example_visible',
                onInput: (e) => {
                  assertStudioExternalChange21('プレビュー状態の行変更');
                  row.keyText = String(e && e.target ? e.target.value : '');
                },
                onBlur: () => scheduleMockDataApply({ immediate: true }),
              }, []),
              h('select', {
                class: 'global-vars-type',
                value: row.type,
                onChange: (e) => {
                  assertStudioExternalChange21('プレビュー状態の行変更');
                  const v = e && e.target ? e.target.value : 'string';
                  row.type = /** @type {any} */ (String(v));
                  if (row.type === 'boolean') {
                    row.boolValue = Boolean(row.boolValue);
                  } else {
                    row.valueText = String(row.valueText ?? '');
                  }
                  safeRender();
                  scheduleMockDataApply({ immediate: true });
                },
              }, [
                h('option', { value: 'boolean' }, ['boolean']),
                h('option', { value: 'number' }, ['number']),
                h('option', { value: 'string' }, ['string']),
                h('option', { value: 'json' }, ['json']),
              ]),
              renderValueInput(row),
              h('button', {
                type: 'button',
                class: 'btn btn-danger',
                title: 'Remove',
                onClick: () => {
                  assertStudioExternalChange21('プレビュー状態の行変更');
                  const idx = mockDataUiState.rows.findIndex((r) => r && r.id === row.id);
                  if (idx >= 0) mockDataUiState.rows.splice(idx, 1);
                  safeRender();
                  scheduleMockDataApply({ immediate: true });
                },
              }, ['×']),
            ]),
            row.error && row.error !== 'Duplicate key'
              ? h('div', { class: 'hint error', style: 'margin-top: 4px;' }, [String(row.error)])
              : null,
            row.error === 'Duplicate key'
              ? h('div', { class: 'hint error', style: 'margin-top: 4px;' }, ['Duplicate key (only the first entry is applied).'])
              : null,
          ].filter(Boolean)));

      const topError = mockDataUiState.lastImportError || mockDataUiState.error;

      return h('div', { class: 'debug-block' }, [
        h('div', { class: 'debug-title' }, ['Bindings mock data (S045)']),
        h('div', { class: 'hint' }, [
          'Define mock values for binding keys (e.g. "#example_visible"). ',
          'Changes auto-apply after you pause typing (debounced), and the Canvas preview should update.',
        ]),
        h('div', { class: 'hint' }, [
          'Tip: Import the built-in fixture, open ui/sample_screen.json, then toggle #example_visible and view the Canvas tab.',
        ]),
        h('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0;' }, [
          h('button', { type: 'button', class: 'btn', onClick: onAddRow }, ['Add row']),
          h('button', { type: 'button', class: 'btn', onClick: onResetExample }, ['Reset example']),
          h('button', { type: 'button', class: 'btn btn-danger', onClick: onClearAll }, ['Clear all']),
          h('button', { type: 'button', class: 'btn', onClick: onApplyNow }, ['Apply now']),
          h('button', { type: 'button', class: 'btn', onClick: onExport }, ['Export JSON']),
          h('label', { class: 'btn', style: 'display: inline-flex; align-items:center; gap:8px;' }, [
            h('span', {}, ['Import']),
            h('input', {
              type: 'file',
              accept: '.json,.jsonc,application/json',
              style: 'display:none;',
              onChange: onImport,
            }, []),
          ]),
          h('span', { class: 'code' }, [`Version: ${currentVersion}`]),
          h('span', { class: 'code' }, [`Debounce: ${Math.min(2000, Math.max(80, Number(mockDataUiState.debounceMs) || 0))}ms`]),
          topError ? h('span', { class: 'hint error' }, [String(topError)]) : null,
        ].filter(Boolean)),
        h('div', { class: 'global-vars-section' }, rowsUi),
        h('div', { class: 'hint', style: 'margin-top: 8px;' }, ['Last evaluation (active file)']),
        h('pre', { class: 'code-block' }, [summaryText]),
      ]);
    })(),
    (() => {
      const nav = getPreviewNavigationStateFrom(state), navStack = nav.stack, navIndex = nav.index;
      const map = readNavigationMappings(nav.actionMap);
      const currentRef = screenRefFromFile(file);
      const sourceRef = navigationUiState.newSourceScope === 'global' ? null
        : navigationUiState.newSourceScope === 'selected' ? navigationUiState.newSourceRef : currentRef;
      const pathFilter = String(navigationUiState.pathFilter || '').toLowerCase();
      const definitionFilter = String(navigationUiState.definitionFilter || '').toLowerCase();
      const allScreens = listAvailableScreenPackPaths(state);
      const screens = allScreens.filter(path => !pathFilter || path.toLowerCase().includes(pathFilter)).slice(0, 200);
      const selectedPath = navigationUiState.newTargetPackPath;
      if (selectedPath && !screens.includes(selectedPath)) screens.unshift(selectedPath);
      const definitions = uiCatalogState.catalog ? listEffectiveDefinitionsForPath(uiCatalogState.catalog, selectedPath).filter(record => record.profile !== 'pocket') : [];
      const nameCounts = new Map();
      for (const record of definitions) nameCounts.set(record.qualifiedName, (nameCounts.get(record.qualifiedName) || 0) + 1);
      const candidates = definitions.filter(record => (!definitionFilter || record.qualifiedName.toLowerCase().includes(definitionFilter))).slice(0, 200);
      const targetRef = { packPath: selectedPath, qualifiedName: navigationUiState.newTargetDefinition, presentation: navigationUiState.newPresentation };
      const canAdd = Boolean(navigationUiState.newActionId.trim() && selectedPath && targetRef.qualifiedName
        && nameCounts.get(targetRef.qualifiedName) === 1 && (sourceRef || navigationUiState.newSourceScope === 'global')
        && (targetRef.presentation !== 'topic' || TOPIC_DEFINITION.test(targetRef.qualifiedName)));
      const mappings = [
        ...map.entries.map(entry => ({ ...entry, legacy: false })),
        ...Object.entries(map.legacy).map(([actionId, value]) => {
          try { return { actionId, source: null, target: normalizeScreenRef(value), legacy: true }; }
          catch { return { actionId, source: null, target: null, legacy: true }; }
        }),
      ].sort((a, b) => a.actionId.localeCompare(b.actionId));
      const describe = ref => ref ? `${ref.packPath} # ${ref.qualifiedName || siteText('定義の選択待ち')}` : siteText('不正な旧設定');
      const detectedActionIds = [...new Set([...walkUiNodes(file?.uiModel?.root)].filter(node => node.type === 'button').flatMap(extractButtonActionIds))].slice(0, 40);
      const editMapping = mapping => {
        navigationUiState.newActionId = mapping.actionId;
        navigationUiState.newSourceScope = mapping.source ? 'selected' : 'global';
        navigationUiState.newSourceRef = mapping.source;
        navigationUiState.newTargetPackPath = mapping.target?.packPath || '';
        navigationUiState.newTargetDefinition = mapping.target?.qualifiedName || '';
        navigationUiState.newPresentation = mapping.target?.presentation || 'screen';
        navigationUiState.pathFilter = ''; navigationUiState.definitionFilter = '';
        safeRender();
      };
      return h('div', { class: 'debug-block preview-navigation-settings' }, [
        h('div', { class: 'debug-title' }, [siteText('画面遷移の設定')]),
        h('div', { class: 'hint' }, [siteText('操作ONでCanvasのボタンから遷移します。Alt/Ctrl/Shift/Metaを押している間は要素選択になります。対応未登録のactionは、確認済みの個別操作だけを実行します。')]),
        h('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:8px 0;' }, [
          h('label', {}, [h('input', { type: 'checkbox', checked: nav.enabled, onChange: e => store.dispatch(actions.setPreviewNavEnabled(Boolean(e.target.checked))) }, []), siteText` 操作 ${nav.enabled ? 'ON' : 'OFF'}`]),
          h('button', { type: 'button', class: 'btn', disabled: !currentRef, onClick: () => void navigateToScreenFile(currentRef, 'reset') }, [siteText('現在の定義から履歴を開始')]),
          h('button', { type: 'button', class: 'btn', disabled: navIndex <= 0, onClick: () => void navigateToScreenFile(navStack[navIndex - 1], 'setIndex', navIndex - 1) }, [siteText('戻る')]),
          h('button', { type: 'button', class: 'btn', disabled: navIndex < 0 || navIndex >= navStack.length - 1, onClick: () => void navigateToScreenFile(navStack[navIndex + 1], 'setIndex', navIndex + 1) }, [siteText('進む')]),
          h('span', { class: 'hint' }, [siteText`履歴 ${Math.max(0, navIndex + 1)}/${navStack.length}（最大100件）`]),
        ]),
        h('div', { class: 'hint' }, [siteText('遷移元UIとactionの組で対応を登録します。全画面共通の対応は明示的に選んだ場合に限ります。')]),
        h('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; margin:8px 0;' }, [
          h('select', { id: 'navigation-source', class: 'ui-defs-select', value: navigationUiState.newSourceScope, onChange: e => { navigationUiState.newSourceScope = e.target.value; safeRender(); } }, [
            h('option', { value: 'current', disabled: !currentRef }, [siteText`現在のUI: ${currentRef?.qualifiedName || siteText('未選択')}`]),
            h('option', { value: 'global' }, [siteText('全画面共通')]),
            navigationUiState.newSourceRef ? h('option', { value: 'selected' }, [siteText`登録済みUI: ${navigationUiState.newSourceRef.qualifiedName}`]) : null,
          ].filter(Boolean)),
          h('input', { id: 'navigation-action', type: 'text', class: 'ui-defs-input', placeholder: 'action id', value: navigationUiState.newActionId, onInput: e => { navigationUiState.newActionId = e.target.value; safeRender(); } }, []),
          h('input', { id: 'navigation-path-filter', type: 'search', class: 'ui-defs-input', placeholder: siteText('ファイルを絞り込み（表示は200件まで）'), value: navigationUiState.pathFilter || '', onInput: e => { navigationUiState.pathFilter = e.target.value; safeRender(); } }, []),
          h('select', { id: 'navigation-target-file', class: 'ui-defs-select', value: selectedPath, onChange: e => { navigationUiState.newTargetPackPath = e.target.value; navigationUiState.newTargetDefinition = ''; navigationUiState.definitionFilter = ''; safeRender(); } }, [
            h('option', { value: '' }, [siteText('遷移先ファイルを選択')]), ...screens.map(path => h('option', { value: path }, [path])),
          ]),
          h('input', { id: 'navigation-definition-filter', type: 'search', class: 'ui-defs-input', placeholder: siteText('定義を絞り込み'), value: navigationUiState.definitionFilter || '', onInput: e => { navigationUiState.definitionFilter = e.target.value; safeRender(); } }, []),
          h('select', { id: 'navigation-target-definition', class: 'ui-defs-select', value: targetRef.qualifiedName, onChange: e => { navigationUiState.newTargetDefinition = e.target.value; if (!TOPIC_DEFINITION.test(e.target.value)) navigationUiState.newPresentation = 'screen'; safeRender(); } }, [
            h('option', { value: '' }, [siteText('ファイル内の定義を明示選択')]),
            ...candidates.map(record => h('option', { value: record.qualifiedName, disabled: nameCounts.get(record.qualifiedName) !== 1 }, [`${record.qualifiedName}${nameCounts.get(record.qualifiedName) !== 1 ? siteText('（重複のため選択不可）') : ''}`])),
          ]),
          h('select', { id: 'navigation-presentation', class: 'ui-defs-select', value: targetRef.presentation, onChange: e => { navigationUiState.newPresentation = e.target.value; safeRender(); } }, [
            h('option', { value: 'screen' }, [siteText('通常の画面')]), h('option', { value: 'topic', disabled: !TOPIC_DEFINITION.test(targetRef.qualifiedName) }, [siteText('百科事典の説明項目')]),
          ]),
          h('button', { type: 'button', class: 'btn', disabled: !canAdd, onClick: () => store.dispatch(actions.navSetActionMapping({ actionId: navigationUiState.newActionId.trim(), source: sourceRef, target: targetRef })) }, [siteText('追加 / 更新')]),
          h('button', { type: 'button', class: 'btn', disabled: !canAdd, onClick: () => void navigateToScreenFile(targetRef, 'push') }, [siteText('遷移を試す')]),
          h('button', { type: 'button', class: 'btn btn-danger', disabled: !mappings.length, onClick: () => store.dispatch(actions.navClearActionMappings()) }, [siteText('対応をすべて削除')]),
        ]),
        ...mappings.map(mapping => h('div', { class: 'global-vars-row', style: 'margin:6px 0; flex-wrap:wrap;' }, [
          h('span', { class: 'code' }, [`${mapping.source?.qualifiedName || siteText('全画面')} / ${mapping.actionId} → ${describe(mapping.target)}`]),
          mapping.legacy ? h('span', { class: 'hint' }, [siteText('旧ファイル指定を保持中。単一定義なら解決、複数定義なら選択が必要です。新対応が優先します。')]) : null,
          h('button', { type: 'button', class: 'btn', onClick: () => editMapping(mapping) }, [siteText('編集')]),
          h('button', { type: 'button', class: 'btn btn-danger', onClick: () => store.dispatch(actions.navRemoveActionMapping(mapping.actionId, mapping.source, mapping.legacy)) }, [siteText('削除')]),
        ].filter(Boolean))),
        !mappings.length ? h('div', { class: 'hint' }, [siteText('明示対応は未登録です。ファイル名からの推測遷移は行いません。')]) : null,
        h('div', { class: 'hint' }, [detectedActionIds.length ? siteText`現在のUIで検出したaction（最大40件）: ${detectedActionIds.join(', ')}` : siteText('現在のUIからactionを検出していません。')]),
        h('pre', { class: 'code-block' }, [navigationUiState.lastResolution ? stableStringifyDebug(navigationUiState.lastResolution) : siteText('遷移はまだ実行していません。')]),
      ].filter(Boolean));
    })(),
    (() => {
      const c = diagnostics.getCounts();
      return h('div', { class: 'debug-block' }, [
        h('div', { class: 'debug-title' }, ['Diagnostics summary']),
        h('pre', { class: 'code-block' }, [stableStringifyDebug(c)]),
      ]);
    })(),
    h('div', { class: 'debug-block' }, [
      h('div', { class: 'debug-title' }, ['UI summary']),
      h('pre', { class: 'code-block' }, [stableStringifyDebug(summary)]),
    ]),
    h('div', { class: 'debug-block' }, [
      h('div', { class: 'debug-title' }, ['Recent actions (latest last)']),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: () => {
            actionLog.length = 0;
            render();
          },
        },
        ['Clear']
      ),
      actionLog.length === 0
        ? h('div', { class: 'hint' }, ['No actions yet.'])
        : h(
            'ul',
            { class: 'debug-actions' },
            actionLog.slice(-20).map((a) =>
              h('li', { class: 'debug-action' }, [
                h('span', { class: 'code' }, [a.tsIso]),
                ' ',
                h('span', { class: 'code' }, [a.type]),
                a.summary ? ` — ${a.summary}` : '',
              ])
            )
          ),
    ]),
  ]);
}

/* --- S020: Diagnostics route UI ---------------------------------------- */

function getVisibleDiagnosticsEntries() {
  return filterLocalizedDiagnostics(diagnostics.getEntries(), {
    level: diagnosticsUiState.levelFilter,
    source: diagnosticsUiState.sourceFilter,
    query: diagnosticsUiState.searchQuery,
  }, filterDiagnosticEntries);
}

function makeSafeFileTimestamp() {
  // 2026-02-03T12-34-56-789Z
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * @param {{ filename: string, text: string, mime?: string }} params
 */
function downloadTextFile({ filename, text, mime = 'application/json' }) {
  const blob = new Blob([String(text)], { type: String(mime) });
  downloadBlobSafely23({ filename, blob });
}

/**
 * @param {{ filename: string, blob: Blob }} params
 */
function downloadBlobFile({ filename, blob }) {
  downloadBlobSafely23({ filename, blob });
}

function exportDiagnosticsLog() {
  const snapshot = diagnostics.exportSnapshot({
    includeEnv: diagnosticsUiState.includeEnvOnExport,
    extra: {
      previewContext: buildCurrentPreviewDiagnosticContext(),
      actionLog: actionLog.slice(-200),
    actionHistory: actionHistory28.stats(),
    },
  });

  const text = stableStringify(snapshot, { indent: 2, sortKeys: true, finalNewline: true });
  const filename = `jsonui_diagnostics_${makeSafeFileTimestamp()}.json`;
  downloadTextFile({ filename, text, mime: 'application/json' });
}

function buildCurrentPreviewDiagnosticContext() {
  const state = store.getState();
  const fileId = state.files?.currentFileId || null;
  const file = fileId ? state.files?.byId?.[fileId] : null;
  const cs = fileId ? getCanvasState(getCanvasKey(fileId)) : null;
  const selectedDefinition = file?.meta?.selectedDefinition;
  const definitionId = selectedDefinition && typeof selectedDefinition === 'object'
    ? selectedDefinition.recordId || selectedDefinition.definition || selectedDefinition.rawKey || null
    : selectedDefinition || null;
  const logicalPreset = cs ? getLogicalCanvasPreset(cs) : null;
  const devicePresetKey = cs ? String(cs.devicePresetKey || DEFAULT_DEVICE_PRESET_KEY) : DEFAULT_DEVICE_PRESET_KEY;
  const audit = vanillaReferenceUiState?.audit || null;
  return {
    appBuild: '0.14.0',
    frameTransport: nodeFrameController.snapshot(),
    processingMode: nodeFrameAvailability === true ? 'node-ir' : nodeFrameAvailability === false ? 'browser' : 'pending',
    performance: previewPerformance.snapshot(),
    animation: previewPlayback.state,
    animationQuality: cs?.nodeAnimationSummary?.quality || summarizeAnimationQuality(null),
    inputObservation: previewInputTrace.snapshot(),
    audioObservation: previewAudioPlayer?.snapshot() || {audibleVerified:false,nativeVerified:false,contextState:'uncreated'},
    appLocale: i18n.getLocale(),
    previewLocale: state.ui?.previewLocale || null,
    selectedUi: {
      fileId,
      filePath: file?.path || null,
      definitionId,
    },
    display: cs ? {
      devicePresetKey,
      physicalPreset: DEVICE_CANVAS_PRESETS[devicePresetKey] || null,
      logicalPreset,
      uiScaleMode: cs.uiScaleMode,
      activeUiScale: getActiveCanvasUiScale(cs),
      displayZoom: cs.view?.zoom || null,
      structureMode: Boolean(cs.structureMode),
    } : null,
    runtime: cs ? {
      mockDataVersion: Number(state.preview?.mockDataVersion) || 0,
      bindingStats: cs.bindingsEvalStats || null,
      bindingWarningCount: Array.isArray(cs.bindingsWarnings) ? cs.bindingsWarnings.length : 0,
      collectionQuality: summarizeCollectionQuality(cs.bindingsEvalStats ? { warnings: cs.bindingsWarnings } : null),
      nodeFrameMetrics: cs.nodeFrameMetrics || null,
      layoutStats: cs.layout?.stats || null,
      layoutWarnings: cs.layout?.warnings || [],
      resolverDiagnostics: file?.meta?.resolution?.diagnostics || [],
      resolverDependencyTrace: file?.meta?.resolution?.dependencyTrace || null,
    } : null,
    nativeModels: {
      horse: { status: nativeHorsePreviewState.status, issue: nativeHorsePreviewState.issue || null,
        detail: nativeHorsePreviewState.detail || null, provenance: nativeHorsePreviewState.provenance || null },
      player: { status: nativePlayerPreviewState.status, issue: nativePlayerPreviewState.issue || null,
        detail: nativePlayerPreviewState.detail || null, provenance: nativePlayerPreviewState.provenance || null },
    },
    fonts: {
      bitmap: bitmapFontCache.snapshot(),
      layoutCache: bitmapTextLayoutCache.stats(),
      normalFontCssPx: cs ? 8 * Number(cs.view?.zoom || 1) : null,
      devicePixelRatio: Number(window.devicePixelRatio) || 1,
    },
    workspace: {
      editorUi: {
        leftView: studioUi.leftView26, rightView: studioUi.rightView,
        leftOpen: studioUi.leftOpen, rightOpen: studioUi.rightOpen, ribbonCollapsed: studioUi.compactRibbon26,
        selectedIds: editorSelection21.snapshot().selectedIds.slice(0, 64),
        lockedIds: [...(studioLocks26.get(editorSelection21.snapshot().identity) || [])].slice(0, 64),
        lockedCount: studioLocks26.get(editorSelection21.snapshot().identity)?.size || 0,
        operationsInFlight: [...studioActivities26.values()].slice(0, 16).map(item => ({
          operation: item.operation, elapsedMs: Math.max(0, Date.now() - item.startedAt),
          status: String(item.progress?.status || '').slice(0, 80), phase: String(item.progress?.phase || '').slice(0, 80),
          completed: Number.isFinite(item.progress?.completed) ? item.progress.completed : null,
          total: Number.isFinite(item.progress?.total) ? item.progress.total : null,
        })),
      },
      mode: sourceWorkspace.state.mode,
      busy: sourceWorkspace.state.busy,
      projectionError: sourceWorkspace.state.projectionError,
      activePath: sourceWorkspace.state.activePath,
      activeSourceId: sourceWorkspace.state.activeSourceId,
      revision: sourceWorkspace.state.revision,
      editScope: sourceWorkspace.state.editScope,
      editTargetMode: sourceWorkspace.state.editTargetMode,
      editGeneratedTemplate: sourceWorkspace.state.editGeneratedTemplate,
      pending: pendingEditDiagnosticSummary22(sourceWorkspace.state),
      draftPreview: sourceWorkspaceDraft23.getStatus(),
      editPlan: sourceWorkspace.state.editPlan,
      lastEditPlan: sourceWorkspace.state.lastEditPlan,
      lastHistoryAction: sourceWorkspace.state.lastHistoryAction,
      structureAttempt: sourceWorkspace.state.lastStructureAttempt32,
      additionState: {type: sourceWorkspace.state.addType, relation: sourceWorkspace.state.insertionRelation32,
        generation: sourceWorkspace.state.addGeneration32, status: sourceWorkspace.state.addStatus32,
        requestInFlight: Boolean(sourceWorkspace.state.addFlight32)},
      deletionUnit: sourceWorkspace.state.deleteUnit32,
      export: workspaceExportDiagnosticSummary(sourceWorkspace.state.exportPlan),
      packExportSettings: packExportSettings.diagnosticSummary(),
      selectedPointer: sourceWorkspace.state.selectedPointer,
      previewBlocked: workspacePreviewBlocked(),
      canvasSize: (() => { const box = document.getElementById('preview-canvas')?.getBoundingClientRect();
        return box ? { width: box.width, height: box.height } : null; })(),
    },
    assets: {
      textureMetadata: textureSidecarCache.snapshot({ diagnostics: true }),
      previewPackLoaded: Boolean(importedPackRuntime),
      previewPackPathCount: importedPackRuntime?.packPaths?.length || 0,
      vanillaLoaded: Boolean(vanillaReferenceRuntime),
      vanillaPathCount: vanillaReferenceRuntime?.packPaths?.length || 0,
    },
    vanillaReference: {
      readiness: audit?.readiness || vanillaReferenceUiState?.status || null,
      highFidelityPreviewReady: Boolean(audit?.highFidelityPreviewReady),
      expectedVersion: vanillaReferenceUiState?.expectedBedrockVersion || null,
      sourceRelease: vanillaReferenceUiState?.sourceRelease || null,
      targetChannel: vanillaReferenceUiState?.expectedChannel || null,
      sourceChannel: vanillaReferenceUiState?.sourceChannel || null,
    },
  };
}

function exportDiagnosticsText(entries, suffix) {
  const text = formatDiagnosticsText(entries, { includeData: true });
  const filename = `jsonui_${suffix}_${makeSafeFileTimestamp()}.log`;
  downloadTextFile({ filename, text, mime: 'text/plain;charset=utf-8' });
}

function rerenderLogsPreservingFocus(id, selectionStart) {
  safeRender();
  requestAnimationFrame(() => {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) return;
    input.focus();
    if (Number.isFinite(selectionStart)) input.setSelectionRange(selectionStart, selectionStart);
  });
}

function renderLogs() {
  const counts = diagnostics.getCounts();
  const allEntries = diagnostics.getEntries();
  const visibleEntries = getVisibleDiagnosticsEntries().slice().reverse();
  const sources = Array.from(new Set(allEntries.map((entry) => String(entry.source || 'app')))).sort();
  const selected = visibleEntries.find((entry) => entry.id === diagnosticsUiState.selectedEntryId)
    || visibleEntries[0]
    || null;
  const sessionStatus = siteDiagnosticSession.status();

  const countCards = h('div', { class: 'logs-counts', 'aria-label': t('logs.summary') }, [
    ...['error', 'warn', 'info', 'debug', 'total'].map((level) => h('div', { class: `logs-count-card ${level}` }, [
      h('span', { class: 'logs-count-value' }, [String(counts[level] || 0)]),
      h('span', { class: 'logs-count-label' }, [t(`logs.level.${level}`)]),
    ])),
  ]);

  const filters = h('div', { class: 'logs-filters', role: 'search' }, [
    h('div', { class: 'logs-level-filters', role: 'group', 'aria-label': t('logs.filter.level') }, [
      ...['all', 'error', 'warn', 'info', 'debug'].map((level) => h('button', {
        type: 'button',
        class: `btn ${diagnosticsUiState.levelFilter === level ? 'btn-primary' : ''}`,
        'aria-pressed': diagnosticsUiState.levelFilter === level ? 'true' : 'false',
        onClick: () => {
          diagnosticsUiState.levelFilter = level;
          diagnosticsUiState.selectedEntryId = null;
          safeRender();
        },
      }, [t(`logs.level.${level}`)])),
    ]),
    h('label', { class: 'logs-filter-field' }, [
      h('span', {}, [t('logs.filter.source')]),
      h('select', {
        value: diagnosticsUiState.sourceFilter,
        onChange: (event) => {
          diagnosticsUiState.sourceFilter = String(event?.target?.value || 'all');
          diagnosticsUiState.selectedEntryId = null;
          safeRender();
        },
      }, [
        h('option', { value: 'all' }, [t('logs.source.all')]),
        ...sources.map((source) => h('option', { value: source }, [source])),
      ]),
    ]),
    h('label', { class: 'logs-filter-field logs-search-field' }, [
      h('span', {}, [t('logs.filter.search')]),
      h('input', {
        id: 'logs-search-input',
        type: 'search',
        value: diagnosticsUiState.searchQuery,
        placeholder: t('logs.filter.searchPlaceholder'),
        onInput: (event) => {
          const input = event?.currentTarget;
          diagnosticsUiState.searchQuery = String(input?.value || '');
          diagnosticsUiState.selectedEntryId = null;
          rerenderLogsPreservingFocus('logs-search-input', Number(input?.selectionStart));
        },
      }),
    ]),
  ]);

  const logList = visibleEntries.length
    ? h('ul', { class: 'logs-list', 'aria-label': t('logs.list'), 'aria-live': 'polite' }, visibleEntries.map((entry) => h('li', {}, [
        h('button', {
          type: 'button',
          class: `logs-entry ${entry.level}${selected?.id === entry.id ? ' selected' : ''}`,
          'aria-pressed': selected?.id === entry.id ? 'true' : 'false',
          onClick: () => {
            diagnosticsUiState.selectedEntryId = entry.id;
            safeRender();
          },
        }, [
          h('span', { class: `logs-entry-level ${entry.level}` }, [entry.level.toUpperCase()]),
          h('span', { class: 'logs-entry-time code' }, [entry.tsIso]),
          h('span', { class: 'logs-entry-source code' }, [entry.source]),
          h('span', { class: 'logs-entry-message' }, [translateSiteMessage(entry.message)]),
        ]),
      ])))
    : h('div', { class: 'logs-empty hint' }, [t('logs.empty')]);

  const detail = selected
    ? h('div', { class: 'logs-detail-content' }, [
        h('dl', { class: 'logs-detail-meta' }, [
          h('div', {}, [h('dt', {}, [t('logs.detail.time')]), h('dd', { class: 'code' }, [selected.tsIso])]),
          h('div', {}, [h('dt', {}, [t('logs.detail.level')]), h('dd', { class: `logs-entry-level ${selected.level}` }, [selected.level.toUpperCase()])]),
          h('div', {}, [h('dt', {}, [t('logs.detail.source')]), h('dd', { class: 'code' }, [selected.source])]),
          h('div', {}, [h('dt', {}, ['ID']), h('dd', { class: 'code' }, [selected.id])]),
        ]),
        h('h3', {}, [t('logs.detail.message')]),
        h('pre', { class: 'code-block logs-code-block' }, [translateSiteMessage(String(selected.message || ''))]),
        selected.error?.stack || selected.error?.message
          ? h('div', {}, [
              h('h3', {}, [t('logs.detail.stack')]),
              h('pre', { class: 'code-block logs-code-block' }, [String(selected.error.stack || selected.error.message || '')]),
            ])
          : '',
        selected.data !== undefined
          ? h('div', {}, [
              h('h3', {}, [t('logs.detail.data')]),
              h('pre', { class: 'code-block logs-code-block' }, [stableStringifyDebug(selected.data)]),
            ])
          : '',
      ])
    : h('div', { class: 'logs-empty hint' }, [t('logs.detail.none')]);

  const exportTools = h('div', { class: 'logs-actions' }, [
    h('button', { type: 'button', class: 'btn btn-primary', onClick: downloadCompleteDebugBundle }, [siteText('ログを一括保存（ブラウザ＋Node）')]),
    h('button', { type: 'button', class: 'btn', onClick: exportDiagnosticsLog }, [t('logs.download.json')]),
    h('button', { type: 'button', class: 'btn', onClick: () => exportDiagnosticsText(visibleEntries.slice().reverse(), 'filtered_log') }, [t('logs.download.filtered')]),
    h('button', { type: 'button', class: 'btn', disabled: counts.error ? null : 'disabled', onClick: () => exportDiagnosticsText(allEntries.filter((entry) => entry.level === 'error'), 'errors') }, [t('logs.download.errors')]),
    h('label', { class: 'logs-check' }, [
      h('input', {
        type: 'checkbox',
        checked: diagnosticsUiState.includeEnvOnExport,
        onChange: () => {
          diagnosticsUiState.includeEnvOnExport = !diagnosticsUiState.includeEnvOnExport;
          safeRender();
        },
      }),
      h('span', {}, [t('logs.includeEnvironment')]),
    ]),
    h('button', {
      type: 'button',
      class: 'btn logs-clear',
      onClick: () => {
        if (!window.confirm(t('logs.clearConfirm'))) return;
        diagnostics.clear();
        diagnosticsUiState.selectedEntryId = null;
      },
    }, [t('logs.clear')]),
  ]);

  const sessionTools = h('details', { class: 'logs-session' }, [
    h('summary', {}, [t('logs.session.title')]),
    h('p', { class: 'hint' }, [t('logs.session.hint')]),
    h('div', { class: 'logs-session-grid' }, [
      h('label', { class: 'logs-check' }, [
        h('input', {
          type: 'checkbox',
          checked: diagnosticsUiState.sessionIncludeUserAgent,
          disabled: sessionStatus.active ? 'disabled' : null,
          onChange: () => {
            diagnosticsUiState.sessionIncludeUserAgent = !diagnosticsUiState.sessionIncludeUserAgent;
            safeRender();
          },
        }),
        h('span', {}, [t('logs.session.userAgent')]),
      ]),
      h('label', { class: 'logs-check' }, [
        h('input', {
          type: 'checkbox',
          checked: diagnosticsUiState.sessionCaptureConsole,
          disabled: sessionStatus.active ? 'disabled' : null,
          onChange: () => {
            diagnosticsUiState.sessionCaptureConsole = !diagnosticsUiState.sessionCaptureConsole;
            safeRender();
          },
        }),
        h('span', {}, [t('logs.session.console')]),
      ]),
      h('div', { class: 'logs-session-buttons' }, [
        h('button', {
          type: 'button',
          class: 'btn btn-primary',
          disabled: sessionStatus.active ? 'disabled' : null,
          onClick: () => {
            const result = siteDiagnosticSession.start({
              includeUserAgent: diagnosticsUiState.sessionIncludeUserAgent,
              captureConsole: diagnosticsUiState.sessionCaptureConsole,
            });
            diagnosticsUiState.sessionStatusMessage = result.code;
            safeRender();
          },
        }, [t('logs.session.start')]),
        h('button', {
          type: 'button',
          class: 'btn',
          disabled: sessionStatus.active ? null : 'disabled',
          onClick: () => {
            const result = siteDiagnosticSession.stop();
            diagnosticsUiState.sessionStatusMessage = result.code;
            safeRender();
          },
        }, [t('logs.session.stop')]),
        h('button', {
          type: 'button',
          class: 'btn',
          disabled: !sessionStatus.sessionId || sessionStatus.active ? 'disabled' : null,
          onClick: async () => {
            const result = await siteDiagnosticSession.download();
            diagnosticsUiState.sessionStatusMessage = result.code;
            safeRender();
          },
        }, [t('logs.session.download')]),
        h('button', {
          type: 'button',
          class: 'btn',
          disabled: !sessionStatus.sessionId || sessionStatus.active ? 'disabled' : null,
          onClick: async () => {
            const result = await siteDiagnosticSession.copy();
            diagnosticsUiState.sessionStatusMessage = result.code;
            safeRender();
          },
        }, [t('logs.session.copy')]),
      ]),
      h('pre', { class: 'code-block logs-session-status' }, [stableStringifyDebug({
        ...sessionStatus,
        uiMessage: diagnosticsUiState.sessionStatusMessage || null,
      })]),
    ]),
  ]);

  const contextTools = h('details', { class: 'logs-session' }, [
    h('summary', {}, [t('logs.context.title')]),
    h('p', { class: 'hint' }, [t('logs.context.hint')]),
    h('pre', { class: 'code-block logs-session-status' }, [stableStringifyDebug(buildCurrentPreviewDiagnosticContext())]),
    h('div', { class: 'logs-session-buttons' }, [
      h('button', {
        type: 'button',
        class: 'btn',
        disabled: schemaExportState.status === 'building' ? 'disabled' : null,
        onClick: downloadSchemaBundleZip,
      }, [t('schemaExport.action.downloadZip')]),
      h('button', {
        type: 'button',
        class: 'btn',
        disabled: schemaExportState.status === 'building' ? 'disabled' : null,
        onClick: () => downloadSingleSchemaFile('jsonui-element.schema.json'),
      }, [t('schemaExport.action.downloadElement')]),
    ]),
  ]);

  return h('section', { class: 'logs-page', 'aria-labelledby': 'logs-page-title' }, [
    h('header', { class: 'logs-header' }, [
      h('div', {}, [
        h('h1', { id: 'logs-page-title' }, [t('logs.title')]),
        h('p', { class: 'hint' }, [t('logs.description')]),
      ]),
      countCards,
    ]),
    filters,
    exportTools,
    h('div', { class: 'logs-workspace' }, [
      h('section', { class: 'logs-pane', 'aria-labelledby': 'logs-list-title' }, [
        h('h2', { id: 'logs-list-title' }, [`${t('logs.list')} (${visibleEntries.length})`]),
        logList,
      ]),
      h('section', { class: 'logs-pane logs-detail', 'aria-labelledby': 'logs-detail-title' }, [
        h('h2', { id: 'logs-detail-title' }, [t('logs.detail.title')]),
        detail,
      ]),
    ]),
    sessionTools,
    contextTools,
  ]);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getLayoutEl() {
  return document.getElementById('editor-layout');
}

/**
 * @param {HTMLElement} el
 * @param {string} varName
 * @param {number} fallback
 */
function getCssNumber(el, varName, fallback) {
  const raw = getComputedStyle(el).getPropertyValue(varName);
  const n = Number.parseFloat(String(raw || '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function getLayoutWidthPx() {
  const layout = getLayoutEl();
  if (layout) return layout.getBoundingClientRect().width;
  return window.innerWidth || 1200;
}

function getSplitterWidthPx() {
  const layout = getLayoutEl();
  if (!layout) return 8;
  return getCssNumber(layout, '--splitter-w', 8);
}

const PANEL_MIN_LEFT = 240;
const PANEL_MIN_RIGHT = 240;
const PANEL_MIN_CENTER = 400;

/**
 * Resize one side panel while protecting the preview's minimum width.
 * Positive deltas widen the requested panel.
 * @param {'left'|'right'} side
 * @param {number} delta
 */
function adjustPanelWidth(side, delta) {
  const state = store.getState();
  let leftPx = Number(state.ui?.panels?.leftPx);
  let rightPx = Number(state.ui?.panels?.rightPx);
  leftPx = Number.isFinite(leftPx) ? Math.max(0, leftPx) : PANEL_DEFAULT_LEFT_PX;
  rightPx = Number.isFinite(rightPx) ? Math.max(0, rightPx) : PANEL_DEFAULT_RIGHT_PX;

  const layoutW = getLayoutWidthPx();
  const splitterW = getSplitterWidthPx();
  if (side === 'left') {
    const maxLeft = Math.max(
      PANEL_MIN_LEFT,
      layoutW - rightPx - splitterW * 2 - PANEL_MIN_CENTER
    );
    leftPx = clamp(Math.max(PANEL_MIN_LEFT, leftPx) + delta, PANEL_MIN_LEFT, maxLeft);
    panelToggleState.lastLeftPx = leftPx;
  } else {
    const maxRight = Math.max(
      PANEL_MIN_RIGHT,
      layoutW - leftPx - splitterW * 2 - PANEL_MIN_CENTER
    );
    rightPx = clamp(Math.max(PANEL_MIN_RIGHT, rightPx) + delta, PANEL_MIN_RIGHT, maxRight);
    panelToggleState.lastRightPx = rightPx;
  }

  store.dispatch(actions.setPanelSizes({
    leftPx: Math.round(leftPx),
    rightPx: Math.round(rightPx),
  }));
}

/** @param {'left'|'right'} side */
function resetPanelWidth(side) {
  const state = store.getState();
  const rawLeft = Number(state.ui?.panels?.leftPx);
  const rawRight = Number(state.ui?.panels?.rightPx);
  const leftPx = side === 'left'
    ? PANEL_DEFAULT_LEFT_PX
    : (Number.isFinite(rawLeft) ? Math.max(0, rawLeft) : PANEL_DEFAULT_LEFT_PX);
  const rightPx = side === 'right'
    ? PANEL_DEFAULT_RIGHT_PX
    : (Number.isFinite(rawRight) ? Math.max(0, rawRight) : 0);
  store.dispatch(actions.setPanelSizes({ leftPx, rightPx }));
}

/**
 * @param {{ side: 'left'|'right', leftPx: number, rightPx: number }} params
 */
function renderSplitter({ side, leftPx, rightPx }) {
  const layoutW = getLayoutWidthPx();
  const splitterW = getSplitterWidthPx();

  const maxLeft = Math.max(
    PANEL_MIN_LEFT,
    layoutW - rightPx - splitterW * 2 - PANEL_MIN_CENTER
  );
  const maxRight = Math.max(
    PANEL_MIN_RIGHT,
    layoutW - leftPx - splitterW * 2 - PANEL_MIN_CENTER
  );

  const ariaNow = side === 'left' ? leftPx : rightPx;
  const ariaMin = side === 'left' ? PANEL_MIN_LEFT : PANEL_MIN_RIGHT;
  const ariaMax = side === 'left' ? Math.floor(maxLeft) : Math.floor(maxRight);

  const label = side === 'left'
    ? t('editor.panel.resizeLeft')
    : t('editor.panel.resizeRight');

  return h(
    'div',
    {
      class: 'splitter',
      role: 'separator',
      tabindex: '0',
      'aria-orientation': 'vertical',
      'aria-label': label,
      'aria-valuenow': String(Math.floor(ariaNow)),
      'aria-valuemin': String(Math.floor(ariaMin)),
      'aria-valuemax': String(Math.floor(ariaMax)),
      onPointerDown: (e) => startSplitterDrag(side, e),
      onKeyDown: (e) => onSplitterKeyDown(side, e),
      onDblClick: () => {
        resetPanelWidth(side);
      },
    },
    [h('div', { class: 'splitter-handle', 'aria-hidden': 'true' }, [])]
  );
}

/**
 * @param {'left'|'right'} side
 * @param {KeyboardEvent} e
 */
function onSplitterKeyDown(side, e) {
  const key = e.key;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
  e.preventDefault();

  const step = e.shiftKey ? 40 : 20;
  const delta = key === 'ArrowRight' ? step : -step;

  const state = store.getState();
  let leftPx = Number(state.ui?.panels?.leftPx);
  let rightPx = Number(state.ui?.panels?.rightPx);
  leftPx = Number.isFinite(leftPx) ? Math.max(0, leftPx) : PANEL_DEFAULT_LEFT_PX;
  rightPx = Number.isFinite(rightPx) ? Math.max(0, rightPx) : PANEL_DEFAULT_RIGHT_PX;

  const layoutW = getLayoutWidthPx();
  const splitterW = getSplitterWidthPx();

  if (side === 'left') {
    const maxLeft = Math.max(
      PANEL_MIN_LEFT,
      layoutW - rightPx - splitterW * 2 - PANEL_MIN_CENTER
    );
    leftPx = clamp(leftPx + delta, PANEL_MIN_LEFT, maxLeft);
  } else {
    const maxRight = Math.max(
      PANEL_MIN_RIGHT,
      layoutW - leftPx - splitterW * 2 - PANEL_MIN_CENTER
    );
    // Moving splitter right decreases right panel width; left increases.
    rightPx = clamp(rightPx - delta, PANEL_MIN_RIGHT, maxRight);
  }

  store.dispatch(actions.setPanelSizes({ leftPx: Math.round(leftPx), rightPx: Math.round(rightPx) }));

  requestAnimationFrame(() => {
    const el = document.activeElement;
    if (el && el instanceof HTMLElement) el.setAttribute('aria-valuenow', String(Math.floor(side === 'left' ? leftPx : rightPx)));
  });
}

/**
 * @param {'left'|'right'} side
 * @param {PointerEvent} e
 */
function startSplitterDrag(side, e) {
  if (!(e.currentTarget instanceof HTMLElement)) return;
  const splitterEl = e.currentTarget;
  const layout = getLayoutEl();
  if (!layout) return;

  splitterEl.setPointerCapture(e.pointerId);

  const startX = e.clientX;
  const startState = store.getState();
  const startLeft = Number(startState.ui?.panels?.leftPx) || PANEL_DEFAULT_LEFT_PX;
  const startRight = Number(startState.ui?.panels?.rightPx) || PANEL_DEFAULT_RIGHT_PX;

  const layoutW = getLayoutWidthPx();
  const splitterW = getSplitterWidthPx();

  document.body.classList.add('is-resizing');

  /** @type {{ leftPx: number, rightPx: number }} */
  let next = { leftPx: startLeft, rightPx: startRight };

  function updateAria() {
    const ariaNow = side === 'left' ? next.leftPx : next.rightPx;
    splitterEl.setAttribute('aria-valuenow', String(Math.floor(ariaNow)));
  }

  /** @param {PointerEvent} ev */
  function onMove(ev) {
    const dx = ev.clientX - startX;

    if (side === 'left') {
      const maxLeft = Math.max(
        PANEL_MIN_LEFT,
        layoutW - startRight - splitterW * 2 - PANEL_MIN_CENTER
      );
      const leftPx = clamp(startLeft + dx, PANEL_MIN_LEFT, maxLeft);
      next = { leftPx, rightPx: startRight };
    } else {
      const maxRight = Math.max(
        PANEL_MIN_RIGHT,
        layoutW - startLeft - splitterW * 2 - PANEL_MIN_CENTER
      );
      // Moving splitter right decreases right panel width.
      const rightPx = clamp(startRight - dx, PANEL_MIN_RIGHT, maxRight);
      next = { leftPx: startLeft, rightPx };
    }

    layout.style.setProperty('--left-w', `${Math.round(next.leftPx)}px`);
    layout.style.setProperty('--right-w', `${Math.round(next.rightPx)}px`);
    updateAria();
  }

  /** @param {PointerEvent} ev */
  function onEnd(ev) {
    splitterEl.removeEventListener('pointermove', onMove);
    splitterEl.removeEventListener('pointerup', onEnd);
    splitterEl.removeEventListener('pointercancel', onEnd);
    document.body.classList.remove('is-resizing');

    try {
      splitterEl.releasePointerCapture(ev.pointerId);
    } catch {
      // ignore
    }

    store.dispatch(
      actions.setPanelSizes({
        leftPx: Math.round(next.leftPx),
        rightPx: Math.round(next.rightPx),
      })
    );
  }

  splitterEl.addEventListener('pointermove', onMove);
  splitterEl.addEventListener('pointerup', onEnd);
  splitterEl.addEventListener('pointercancel', onEnd);
}

/**
 * @param {import('./state-store/app-store.js').AppState} state
 */
function buildStatusLine(state) {
  const route = state.ui.route;
  const fileId = state.files.currentFileId;
  const file = fileId ? state.files.byId[fileId] : null;
  const selection = state.editor.selection.nodeId;

  let routeName = t(`route.${route}`);
  if (routeName.startsWith('⟦MISSING:')) routeName = String(route);

  const parts = [`${t('status.route')}: ${routeName}`];
  if (file) parts.push(`${t('status.file')}: ${file.path}${file.dirty ? ' *' : ''}`);
  if (selection) parts.push(`${t('status.selection')}: ${selection}`);
  return parts.join(' | ');
}

/**
 * Minimal stub file used to demonstrate selection + updateProperty in S016.
 * @param {{ id: string, path: string, titleText: string }} params
 * @returns {import('./state-store/app-store.js').OpenFile}
 */
function createStubFile({ id, path, titleText }) {
  return {
    id,
    path,
    kind: 'screen',
    dirty: false,
    rootId: 'root',
    nodesById: {
      root: {
        id: 'root',
        type: 'panel',
        // Use Bedrock-like common layout props so the Properties panel
        // can be verified without importing a real pack.
        props: {
          name: 'root',
          size: ['fill', 'fill'],
          offset: [0, 0],
          anchor_from: 'top_left',
          anchor_to: 'top_left',
          visible: true,
        },
        children: ['title', 'btn_primary'],
      },
      title: {
        id: 'title',
        type: 'label',
        props: {
          text: titleText,
          size: ['default', 'default'],
          offset: [40, 40],
          anchor_from: 'top_left',
          anchor_to: 'top_left',
          visible: true,
        },
        children: [],
      },
      btn_primary: {
        id: 'btn_primary',
        type: 'button',
        props: {
          text: 'Play',
          size: [200, 40],
          offset: [40, 120],
          anchor_from: 'top_left',
          anchor_to: 'top_left',
          visible: true,
        },
        children: [],
      },
    },
  };
}

function openVanillaVersionSettings() {
  studioUi.rightOpen = true;
  studioUi.rightView = 'diagnostics';
  safeRender();

  requestAnimationFrame(() => requestAnimationFrame(() => {
    const settings = document.getElementById('vanilla-reference-settings');
    if (!(settings instanceof HTMLElement)) return;
    settings.scrollIntoView({ block: 'nearest' });
    const firstControl = settings.querySelector('input, select, button');
    if (firstControl instanceof HTMLElement) firstControl.focus();
  }));
}

/**
 * @param {import('./state-store/app-store.js').PackState} packState
 */
function renderPackImportSection(packState) {
  const imported = packState.imported;
  const isLoading = packState.status === 'loading';
  const isError = packState.status === 'error';

  const fileInput = h('input', {
    id: 'resource-pack-file-input',
    class: 'visually-hidden-file',
    type: 'file',
    accept: '.zip,.mcpack,.mcaddon,application/zip',
    tabindex: '-1',
    disabled: isLoading ? 'disabled' : null,
    onChange: async (e) => {
      const input = e.currentTarget;
      if (!(input instanceof HTMLInputElement)) return;
      const file = input.files && input.files[0] ? input.files[0] : null;
      if (!file) return;
      // Keep the FileList alive for browsers that lazily read the selected
      // file during the asynchronous import. The picker is reset on its next
      // explicit open so selecting the same file still emits change.
      await importPackFromFile(file);
    },
  });

  const vanillaFileInput = h('input', {
    id: 'vanilla-base-file-input',
    class: 'visually-hidden-file',
    type: 'file',
    accept: '.zip,.mcpack,application/zip',
    tabindex: '-1',
    disabled: vanillaReferenceUiState.status === 'loading' ? 'disabled' : null,
    onChange: async (e) => {
      const input = e.currentTarget;
      if (!(input instanceof HTMLInputElement)) return;
      const file = input.files && input.files[0] ? input.files[0] : null;
      if (!file) return;
      // See the preview-pack input above: do not detach the selected file
      // before the asynchronous ZIP reader has finished with it.
      await loadVanillaReferenceFromFile(file);
    },
  });

  const fixtureBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      disabled: isLoading ? 'disabled' : null,
      onClick: () => importPackFixture(),
    },
    [t('editor.import.loadFixture')]
  );

  const cancelBtn = isLoading
    ? h('button', {
        type: 'button',
        class: 'btn',
        disabled: importedPackLoadAbortController?.signal.aborted ? 'disabled' : null,
        onClick: () => cancelImportedPackLoad(),
      }, [importedPackLoadProgress.phase === 'cancelling' ? t('editor.import.cancelling') : t('editor.import.cancel')])
    : '';

  const unloadBtn = imported
    ? h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: async () => {
            await unloadImportedPackRuntime();
            store.dispatch(actions.packUnload());
            store.dispatch(actions.setProject(null));
            setStatus(t('editor.import.status.unloaded'));
            render();
          },
        },
        [t('editor.import.unload')]
      )
    : '';

  const statusLine =
    isLoading
      ? h('div', { class: 'hint', role: 'status', 'aria-live': 'polite' }, [
          `${t('editor.import.status.loading')} — ${formatWorkspaceImportPhase(importedPackLoadProgress.phase)}`,
          importedPackLoadProgress.processed
            ? ` (${importedPackLoadProgress.total === null
              ? t('editor.import.progress.entries', { processed: importedPackLoadProgress.processed })
              : t('editor.import.progress.entriesWithTotal', {
                  processed: importedPackLoadProgress.processed,
                  total: importedPackLoadProgress.total,
                })})`
            : '',
        ])
      : isError
        ? h('div', { class: 'text-error', role: 'alert' }, [
            t('editor.import.status.failed', { message: String(packState.errorMessage || '-') }),
          ])
        : '';

  const uiSummary = imported && imported.fileIndex ? imported.fileIndex.ui || {} : {};
  const definitionCount = uiCatalogState.status === 'ready' && uiCatalogState.catalog?.summary
    ? Number(uiCatalogState.catalog.summary.definitions) || 0
    : null;
  const compactSummary = imported
    ? h('div', { class: 'import-compact-summary' }, [
        h('strong', {}, [getImportedPackDisplayName(imported)]),
        h('span', { class: 'hint' }, [
          `${t('editor.import.summary.uiFiles')}: ${Number(uiSummary.fileCount) || 0}`,
          definitionCount === null
            ? ''
            : ` • ${t('editor.import.summary.definitions', { count: definitionCount })}`,
        ]),
      ])
    : '';

  const hasVanillaBase = Boolean(vanillaReferenceRuntime);
  const vanillaLoading = vanillaReferenceUiState.status === 'loading';
  const vanillaAudit = vanillaReferenceUiState.audit || vanillaReferenceRuntime?.audit || null;
  const vanillaRejected = !hasVanillaBase && vanillaAudit?.usableBaseReference === false;
  const vanillaNeedsAttention = !hasVanillaBase
    && !vanillaLoading
    && (vanillaReferenceUiState.status === 'warning' || vanillaReferenceUiState.status === 'error')
    && Boolean(vanillaReferenceUiState.error || vanillaRejected);
  const vanillaReceiptUnverified = hasVanillaBase
    && vanillaReferenceUiState.status === 'warning'
    && vanillaAudit?.declaredCompatibleReferenceReady === true
    && vanillaAudit?.verifiedReferenceInputReady !== true;
  const vanillaVersionUnverified = hasVanillaBase
    && vanillaReferenceUiState.status === 'warning'
    && !vanillaReceiptUnverified;
  const stackMode = vanillaRejected
    ? imported
      ? t('editor.packStack.mode.singleRejected')
      : t('editor.packStack.mode.vanillaRejected')
    : vanillaNeedsAttention
      ? imported
        ? t('editor.packStack.mode.singleNeedsAttention')
        : t('editor.packStack.mode.vanillaNeedsAttention')
      : imported
        ? hasVanillaBase
          ? vanillaReferenceUiState.status === 'ready'
            ? t('editor.packStack.mode.stacked')
            : vanillaReceiptUnverified
              ? t('editor.packStack.mode.stackedReceiptUnverified')
              : t('editor.packStack.mode.stackedUnverified')
          : t('editor.packStack.mode.single')
        : hasVanillaBase ? vanillaReferenceUiState.status === 'ready' ? siteText('バニラ単体') : siteText('バニラ単体（参照検証の警告あり）') : t('editor.packStack.mode.none');
  const vanillaStatus = vanillaLoading
    ? t('editor.packStack.loading')
    : hasVanillaBase
      ? vanillaReferenceUiState.status === 'ready'
        ? t('editor.packStack.active')
        : vanillaReceiptUnverified
          ? t('editor.packStack.activeReceiptUnverified')
          : t('editor.packStack.activeUnverified')
      : vanillaRejected
        ? t('editor.packStack.rejected')
        : vanillaReferenceUiState.status === 'error'
          ? t('editor.packStack.failed')
          : vanillaReferenceUiState.status === 'warning'
            ? t('editor.packStack.needsAttention')
            : t('editor.packStack.unselected');
  const previewPackStatus = isLoading
    ? t('editor.packStack.loading')
    : isError
      ? t('editor.packStack.failed')
      : imported
        ? t('editor.packStack.active')
        : t('editor.packStack.unselected');

  return h('div', { class: 'tree-import', id: 'workspace-pack-import' }, [
    h('details', {
      class: 'import-loader',
      open: !imported || isLoading || isError || vanillaLoading || vanillaNeedsAttention ? 'open' : null,
    }, [
      h('summary', { class: 'pack-stack-summary' }, [
        h('span', {}, [siteText('1 · パックを読み込む')]),
        h('span', {
          class: `pack-stack-mode${vanillaNeedsAttention || vanillaReceiptUnverified || vanillaVersionUnverified
            ? ' is-warning'
            : imported && hasVanillaBase
              ? ' is-stacked'
              : ''}`,
          title: stackMode,
        }, [stackMode]),
      ]),
      h('div', { class: 'pack-stack-order hint' }, [t('editor.packStack.order')]),
      fileInput,
      vanillaFileInput,
      h('div', { class: 'pack-layer-row' }, [
        h('div', { class: 'pack-layer-copy' }, [
          h('strong', {}, [t('editor.packStack.previewPack')]),
          h('span', { class: 'pack-layer-state', role: 'status', 'aria-live': 'polite' }, [
            imported ? `${previewPackStatus} • ${getImportedPackDisplayName(imported)}` : previewPackStatus,
          ]),
        ]),
        h('div', { class: 'pack-layer-actions' }, [
          h('button', {
            type: 'button',
            class: 'btn btn-primary',
            id: 'resource-pack-file-button',
            disabled: isLoading ? 'disabled' : null,
            onClick: () => {
              const input = document.getElementById('resource-pack-file-input');
              if (input instanceof HTMLInputElement) {
                input.value = '';
                input.click();
              }
            },
          }, [imported ? t('editor.packStack.change') : t('editor.packStack.selectZip')]),
          !imported ? fixtureBtn : '',
          cancelBtn,
          unloadBtn,
        ]),
      ]),
      statusLine,
      pendingAddonSelection38 ? h('div', { class: 'addon-resource-choice', role: 'group', 'aria-label': siteText('アドオン内のリソースパック選択') }, [
        h('p', {}, [siteText('プレビューするリソースパックを選択してください。')]),
        ...pendingAddonSelection38.candidates.map(candidate => h('button', {
          type: 'button', class: 'btn', disabled: isLoading ? 'disabled' : null,
          onClick: async () => {
            const pending = pendingAddonSelection38;
            if (pending && pending.candidates.includes(candidate)) await importPackFromFile(pending.file, { resourcePack: candidate.uuid });
          },
        }, [`${String(candidate.name || candidate.path).slice(0, 160)} (${candidate.uuid})`])),
        h('button', { type: 'button', class: 'btn', onClick: () => { pendingAddonSelection38 = null; render(); } }, [siteText('選択を取り消す')]),
      ]) : '',
      h('div', { class: 'pack-layer-row' }, [
        h('div', { class: 'pack-layer-copy' }, [
          h('strong', {}, [t('editor.packStack.vanillaBase')]),
          h('span', { class: 'pack-layer-state', role: 'status', 'aria-live': 'polite' }, [
            hasVanillaBase ? `${vanillaStatus} • ${vanillaReferenceRuntime.fileName}` : vanillaStatus,
          ]),
        ]),
        h('div', { class: 'pack-layer-actions' }, [
          h('button', {
            type: 'button',
            class: 'btn',
            disabled: vanillaLoading ? 'disabled' : null,
            onClick: () => {
              const input = document.getElementById('vanilla-base-file-input');
              if (input instanceof HTMLInputElement) {
                input.value = '';
                input.click();
              }
            },
          }, [hasVanillaBase ? t('editor.packStack.change') : t('editor.packStack.selectZip')]),
          h('button', {
            type: 'button',
            class: 'btn',
            title: t('editor.packStack.versionSettingsHint'),
            'aria-controls': 'vanilla-reference-settings',
            onClick: () => openVanillaVersionSettings(),
          }, [t('editor.packStack.versionSettings')]),
          vanillaLoading
            ? h('button', {
                type: 'button',
                class: 'btn',
                onClick: () => cancelVanillaReferenceLoad(),
              }, [t('editor.import.cancel')])
            : '',
          hasVanillaBase
            ? h('button', {
                type: 'button',
                class: 'btn',
                onClick: async () => {
                  await unloadVanillaReferenceRuntime();
                  render();
                },
              }, [t('editor.packStack.remove')])
            : '',
        ]),
      ]),
      h('div', { class: 'hint pack-stack-hint' }, [hasVanillaBase && !imported ? siteText('バニラ単体の UI を選択できます。追加パックが必要になった場合は上の欄から読み込めます。') : t('editor.packStack.vanillaHint')]),
      vanillaReferenceUiState.error
        ? h('div', {
            class: hasVanillaBase ? 'hint text-warn' : 'text-error',
            role: hasVanillaBase ? 'status' : 'alert',
          }, [String(vanillaReferenceUiState.error)])
        : '',
    ]),
    imported ? compactSummary : '',
    (imported || hasVanillaBase) ? renderScreenOpenSection(imported) : '',
    imported
      ? renderLazyWorkspaceDetails(h, {
          className: 'import-advanced', title: t('editor.import.detailsSummary'),
          openState: workspaceNavigationState.advanced,
          renderBody: () => renderImportedPackSummary(imported, { includeScreenOpen: false }),
          onError: (error) => diagnostics.captureError(error, { source: 'workspace-details', message: siteText('詳細設定の描画に失敗しました。') }),
        })
      : '',
  ]);
}

/**
 * @param {import('./state-store/app-store.js').ImportedPack} imported
 */
function renderUiDefsEditorSection(imported) {
  const fileIndex = imported && imported.fileIndex ? imported.fileIndex : {};
  const ui = fileIndex && fileIndex.ui ? fileIndex.ui : {};
  const sys = ui && ui.systemFiles ? ui.systemFiles : {};

  const detectedPath = sys && sys.uiDefs ? String(sys.uiDefs) : null;
  const expectedPath = getUiDefsPackPath(imported);
  const pathLabel = detectedPath || expectedPath || 'ui/_ui_defs.json';

  const hasRuntime = Boolean(importedPackRuntime);
  const isLoading = uiDefsEditorState.status === 'loading';
  const isReady = uiDefsEditorState.status === 'ready';
  const isError = uiDefsEditorState.status === 'error';

  // S039: live validation state for export gating.
  const uiDefsValidation = isReady
    ? validateUiDefsState({
        filePath: uiDefsEditorState.packPath || expectedPath || 'ui/_ui_defs.json',
        formatVersion: uiDefsEditorState.formatVersion,
        uiDefs: uiDefsEditorState.uiDefs,
      })
    : null;
  const uiDefsValidationSummary = uiDefsValidation ? summarizeValidation(uiDefsValidation) : null;
  const uiDefsExportBlocked = Boolean(uiDefsValidation && uiDefsValidation.errorCount > 0);

  const actionBar = h('div', { class: 'ui-defs-actions' }, [
    h('button', {
      type: 'button',
      class: 'btn',
      disabled: !hasRuntime || isLoading,
      onClick: () => loadUiDefsFromImportedPack({ createIfMissing: false }),
      title: t('editor.uiDefs.loadHint'),
    }, [isReady ? t('editor.uiDefs.reload') : t('editor.uiDefs.load')]),
    h('button', {
      type: 'button',
      class: 'btn',
      disabled: !hasRuntime || isLoading,
      onClick: () => loadUiDefsFromImportedPack({ createIfMissing: true }),
      title: t('editor.uiDefs.createHint'),
    }, [t('editor.uiDefs.create')]),
    h('button', {
      type: 'button',
      class: 'btn',
      disabled: !hasRuntime || isLoading || !isReady || uiDefsExportBlocked,
      onClick: () => saveUiDefsToImportedPack(),
      title: t('editor.uiDefs.saveHint'),
    }, [t('editor.uiDefs.save')]),
    h('button', {
      type: 'button',
      class: 'btn',
      disabled: !isReady || uiDefsExportBlocked,
      onClick: () => downloadUiDefsJson(),
      title: t('editor.uiDefs.downloadHint'),
    }, [t('editor.uiDefs.download')]),
  ]);

  const statusParts = [];
  statusParts.push(h('span', { class: 'code' }, [pathLabel]));
  if (!hasRuntime) statusParts.push(' — ', t('editor.uiDefs.noRuntime'));
  if (isLoading) statusParts.push(' — ', t('editor.uiDefs.loading'));
  if (isReady) {
    const count = Array.isArray(uiDefsEditorState.uiDefs) ? uiDefsEditorState.uiDefs.length : 0;
    statusParts.push(' — ', t('editor.uiDefs.loaded', { count }));
    if (uiDefsEditorState.dirty) statusParts.push(' — ', t('editor.uiDefs.unsaved'));
    if (uiDefsValidationSummary) statusParts.push(' — ', uiDefsValidationSummary);
  }
  if (isError && uiDefsEditorState.error) statusParts.push(' — ', uiDefsEditorState.error);

  /** Build a preview JSON string from current state (even if unsaved). */
  let previewText = '';
  if (isReady) {
    try {
      previewText = stableStringify(buildUiDefsJsonObject({
        formatVersion: uiDefsEditorState.formatVersion,
        uiDefs: uiDefsEditorState.uiDefs,
      }), { indent: 2, sortKeys: false, finalNewline: true });
    } catch (e) {
      previewText = `PREVIEW_ERROR: ${e instanceof Error ? e.message : String(e || 'UNKNOWN')}`;
    }
  }

  // Dedupe/validation helpers
  const counts = new Map();
  if (isReady && Array.isArray(uiDefsEditorState.uiDefs)) {
    for (const raw of uiDefsEditorState.uiDefs) {
      const key = String(raw || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const listRows = [];
  if (isReady) {
    const arr = Array.isArray(uiDefsEditorState.uiDefs) ? uiDefsEditorState.uiDefs : [];
    for (let i = 0; i < arr.length; i += 1) {
      const raw = String(arr[i] || '');
      const trimmed = raw.trim();

      let pathError = null;
      if (trimmed) {
        try {
          normalizePackPath(trimmed);
        } catch (e) {
          pathError = e instanceof Error ? e.message : String(e || 'INVALID');
        }
      }

      const isDup = trimmed && (counts.get(trimmed) || 0) > 1;

      listRows.push(
        h('div', { class: 'ui-defs-row' }, [
          h('input', {
            id: `ui-defs-path-${i}`,
            class: `ui-defs-input${pathError ? ' input-error' : ''}`,
            type: 'text',
            value: raw,
            placeholder: 'ui/some_screen.json',
            onInput: (e) => {
              const v = e && e.target ? e.target.value : '';
              assertStudioExternalChange21('UI 登録情報・共通変数の変更');
              uiDefsEditorState.uiDefs[i] = String(v);
              uiDefsEditorState.dirty = true;
              markResourcePackMutation();
              uiDefsEditorState.error = null;
              safeRender();
            },
          }, []),
          h('div', { class: 'ui-defs-row-actions' }, [
            h('button', {
              type: 'button',
              class: 'btn btn-small',
              disabled: isLoading || i === 0,
              onClick: () => {
                if (i === 0) return;
                assertStudioExternalChange21('UI 登録情報・共通変数の変更');
                const tmp = uiDefsEditorState.uiDefs[i - 1];
                uiDefsEditorState.uiDefs[i - 1] = uiDefsEditorState.uiDefs[i];
                uiDefsEditorState.uiDefs[i] = tmp;
                uiDefsEditorState.dirty = true;
                markResourcePackMutation();
                safeRender();
              },
              title: t('editor.uiDefs.moveUp'),
            }, ['↑']),
            h('button', {
              type: 'button',
              class: 'btn btn-small',
              disabled: isLoading || i === arr.length - 1,
              onClick: () => {
                if (i >= uiDefsEditorState.uiDefs.length - 1) return;
                assertStudioExternalChange21('UI 登録情報・共通変数の変更');
                const tmp = uiDefsEditorState.uiDefs[i + 1];
                uiDefsEditorState.uiDefs[i + 1] = uiDefsEditorState.uiDefs[i];
                uiDefsEditorState.uiDefs[i] = tmp;
                uiDefsEditorState.dirty = true;
                markResourcePackMutation();
                safeRender();
              },
              title: t('editor.uiDefs.moveDown'),
            }, ['↓']),
            h('button', {
              type: 'button',
              class: 'btn btn-small',
              disabled: isLoading,
              onClick: () => {
                assertStudioExternalChange21('UI 登録情報・共通変数の変更');
                uiDefsEditorState.uiDefs.splice(i, 1);
                uiDefsEditorState.dirty = true;
                markResourcePackMutation();
                safeRender();
              },
              title: t('editor.uiDefs.remove'),
            }, ['✕']),
          ]),
          (pathError || isDup)
            ? h('div', { class: 'ui-defs-row-hint' }, [
                pathError ? h('span', { class: 'hint error' }, [t('editor.uiDefs.invalidPath', { error: pathError })]) : '',
                isDup ? h('span', { class: 'hint error' }, [t('editor.uiDefs.duplicate')]) : '',
              ])
            : '',
        ])
      );
    }
  }

  const addRow = isReady
    ? h('div', { class: 'ui-defs-add-row' }, [
        h('input', {
          class: 'ui-defs-input',
          type: 'text',
          id: 'ui-defs-new-entry',
          value: uiDefsEditorState.newEntryText,
          placeholder: 'ui/another_screen.json',
          onInput: (e) => {
            const v = e && e.target ? e.target.value : '';
            assertStudioExternalChange21('UI 登録情報の変更');
            uiDefsEditorState.newEntryText = String(v);
            safeRender();
          },
        }, []),
        h('button', {
          type: 'button',
          class: 'btn',
          disabled: isLoading,
          onClick: () => {
            const v = String(uiDefsEditorState.newEntryText || '').trim();
            if (!v) return;
            assertStudioExternalChange21('UI 登録情報・共通変数の変更');
            uiDefsEditorState.uiDefs.push(v);
            uiDefsEditorState.newEntryText = '';
            uiDefsEditorState.dirty = true;
            markResourcePackMutation();
            safeRender();
          },
        }, [t('editor.uiDefs.add')]),
      ])
    : '';

  const formatRow = isReady
    ? h('div', { class: 'ui-defs-format-row' }, [
        h('label', { class: 'hint' }, [t('editor.uiDefs.formatVersion')]),
        h('input', {
          type: 'number',
          id: 'ui-defs-format-version',
          class: 'ui-defs-format-input',
          value: String(uiDefsEditorState.formatVersion),
          min: '1',
          step: '1',
          onInput: (e) => {
            const v = e && e.target ? Number(e.target.value) : 1;
            assertStudioExternalChange21('UI 登録情報・共通変数の変更');
            uiDefsEditorState.formatVersion = Number.isFinite(v) ? v : 1;
            uiDefsEditorState.dirty = true;
            markResourcePackMutation();
            safeRender();
          },
        }, []),
      ])
    : '';

  return h('div', { class: 'ui-defs-section' }, [
    h('div', { class: 'tree-open-files-title' }, [t('editor.uiDefs.title')]),
    h('div', { class: 'hint' }, [t('editor.uiDefs.desc')]),
    h('div', { class: 'ui-defs-status' }, statusParts),
    actionBar,
    formatRow,
    isReady ? h('div', { class: 'ui-defs-list' }, listRows) : '',
    addRow,
    isReady
      ? h('details', { open: false }, [
          h('summary', {}, [t('editor.uiDefs.outputPreview')]),
          h('div', { class: 'json-viewer-actions' }, [
            makeCopyButton({
              label: 'Copy',
              getText: () => String(previewText),
              statusOk: 'Copied ui_defs preview JSON to clipboard.',
            }),
          ]),
          renderJsonCodeBlock(String(previewText), { className: 'ui-defs-json', highlight: true }),
        ])
      : '',
  ]);
}

/**
 * @param {import('./state-store/app-store.js').ImportedPack} imported
 */
function renderGlobalVarsEditorSection(imported) {
  const fileIndex = imported && imported.fileIndex ? imported.fileIndex : {};
  const ui = fileIndex && fileIndex.ui ? fileIndex.ui : {};
  const sys = ui && ui.systemFiles ? ui.systemFiles : {};

  const detectedPath = sys && sys.globalVariables ? String(sys.globalVariables) : null;
  const expectedPath = getGlobalVariablesPackPath(imported);
  const pathLabel = detectedPath || expectedPath || 'ui/_global_variables.json';

  const hasRuntime = Boolean(importedPackRuntime);
  const isLoading = globalVarsEditorState.status === 'loading';
  const isReady = globalVarsEditorState.status === 'ready';
  const isError = globalVarsEditorState.status === 'error';

  const actionBar = h('div', { class: 'global-vars-actions' }, [
    h('button', {
      type: 'button',
      class: 'btn',
      disabled: !hasRuntime || isLoading,
      onClick: () => loadGlobalVariablesFromImportedPack({ createIfMissing: false }),
      title: t('editor.globalVars.loadHint'),
    }, [isReady ? t('editor.globalVars.reload') : t('editor.globalVars.load')]),
    h('button', {
      type: 'button',
      class: 'btn',
      disabled: !hasRuntime || isLoading,
      onClick: () => loadGlobalVariablesFromImportedPack({ createIfMissing: true }),
      title: t('editor.globalVars.createHint'),
    }, [t('editor.globalVars.create')]),
    h('button', {
      type: 'button',
      class: 'btn',
      disabled: !hasRuntime || isLoading || !isReady,
      onClick: () => saveGlobalVariablesToImportedPack(),
      title: t('editor.globalVars.saveHint'),
    }, [t('editor.globalVars.save')]),
    h('button', {
      type: 'button',
      class: 'btn',
      disabled: !isReady,
      onClick: () => downloadGlobalVariablesJson(),
      title: t('editor.globalVars.downloadHint'),
    }, [t('editor.globalVars.download')]),
  ]);

  // Dedupe helpers
  const nameCounts = new Map();
  if (isReady && Array.isArray(globalVarsEditorState.entries)) {
    for (const raw of globalVarsEditorState.entries) {
      const key = String(raw?.name ?? '').trim();
      if (!key) continue;
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
  }

  const statusParts = [];
  statusParts.push(h('span', { class: 'code' }, [pathLabel]));
  if (!hasRuntime) statusParts.push(' — ', t('editor.globalVars.noRuntime'));
  if (isLoading) statusParts.push(' — ', t('editor.globalVars.loading'));
  if (isReady) {
    const count = Array.isArray(globalVarsEditorState.entries) ? globalVarsEditorState.entries.length : 0;
    statusParts.push(' — ', t('editor.globalVars.loaded', { count }));
    if (globalVarsEditorState.dirty) statusParts.push(' — ', t('editor.globalVars.unsaved'));
  }
  if (globalVarsEditorState.error) statusParts.push(' — ', globalVarsEditorState.error);
  if (isError && globalVarsEditorState.error) statusParts.push('');

  // Preview JSON
  let previewText = '';
  let previewError = null;
  if (isReady) {
    const out = buildGlobalVarsOutputObject({
      fileFormat: globalVarsEditorState.fileFormat ?? 'bare',
      extraRootFields: globalVarsEditorState.extraRootFields,
      formatVersion: globalVarsEditorState.formatVersion,
      entries: globalVarsEditorState.entries,
    });
    if (!out.ok) {
      previewError = out.error;
    } else {
      previewText = stableStringify(out.obj, { indent: 2, sortKeys: false, finalNewline: true });
    }
  }

  const formatRow =
    isReady && (globalVarsEditorState.fileFormat ?? 'bare') === 'wrapped'
      ? h('div', { class: 'global-vars-format-row' }, [
          h('label', { class: 'hint' }, [t('editor.globalVars.formatVersion')]),
          h(
            'input',
            {
              type: 'number',
              id: 'global-vars-format-version',
              class: 'global-vars-format-input',
              value: String(globalVarsEditorState.formatVersion),
              min: '1',
              step: '1',
              onInput: (e) => {
                const v = e && e.target ? Number(e.target.value) : 1;
                assertStudioExternalChange21('UI 登録情報・共通変数の変更');
                globalVarsEditorState.formatVersion = Number.isFinite(v) ? v : 1;
                globalVarsEditorState.dirty = true;
                markResourcePackMutation();
                safeRender();
              },
            },
            []
          ),
        ])
      : '';

  const listRows = [];
  if (isReady) {
    const arr = Array.isArray(globalVarsEditorState.entries) ? globalVarsEditorState.entries : [];
    for (let i = 0; i < arr.length; i += 1) {
      const entry = arr[i];
      const name = String(entry?.name ?? '');
      const nameTrimmed = name.trim();
      const nameErr = validateGlobalVarName(nameTrimmed);
      const isDup = nameTrimmed && (nameCounts.get(nameTrimmed) || 0) > 1;

      const type = /** @type {GlobalVarValueType} */ (entry?.type ?? 'string');
      const valueText = String(entry?.valueText ?? '');

      const valueParse = parseGlobalVarValue(type, valueText);
      const valueErr = valueParse.ok ? null : valueParse.error;

      const valueEditor =
        type === 'boolean'
          ? h(
              'select',
              {
                id: `global-vars-value-${i}`,
                class: 'global-vars-value',
                value: valueText.trim().toLowerCase() === 'true' ? 'true' : 'false',
                onChange: (e) => {
                  const v = e && e.target ? e.target.value : 'false';
                  patchGlobalVarEntry(i, { valueText: String(v) });
                },
              },
              [
                h('option', { value: 'true' }, ['true']),
                h('option', { value: 'false' }, ['false']),
              ]
            )
          : type === 'json'
            ? h(
                'textarea',
                {
                  id: `global-vars-value-${i}`,
                  class: `global-vars-value global-vars-json-input${valueErr ? ' input-error' : ''}`,
                  value: valueText,
                  rows: 2,
                  onInput: (e) => {
                    const v = e && e.target ? e.target.value : '';
                    patchGlobalVarEntry(i, { valueText: String(v) });
                  },
                },
                []
              )
            : h(
                'input',
                {
                  id: `global-vars-value-${i}`,
                  class: `global-vars-value${valueErr ? ' input-error' : ''}`,
                  type: 'text',
                  value: valueText,
                  placeholder: type === 'number' ? '12' : '#ffffff',
                  onInput: (e) => {
                    const v = e && e.target ? e.target.value : '';
                    patchGlobalVarEntry(i, { valueText: String(v) });
                  },
                },
                []
              );

      listRows.push(
        h('div', { class: 'global-vars-row', 'data-global-var-index': String(i), 'data-global-var-name': nameTrimmed }, [
          h('input', {
            id: `global-vars-name-${i}`,
            class: `global-vars-name${nameErr || isDup ? ' input-error' : ''}`,
            type: 'text',
            value: name,
            placeholder: '$my_var',
            onInput: (e) => {
              const v = e && e.target ? e.target.value : '';
              patchGlobalVarEntry(i, { name: String(v) });
            },
          }, []),
          h(
            'select',
            {
              id: `global-vars-type-${i}`,
              class: 'global-vars-type',
              value: type,
              onChange: (e) => {
                const v = e && e.target ? e.target.value : 'string';
                patchGlobalVarEntry(i, { type: /** @type {GlobalVarValueType} */ (String(v)) });
              },
            },
            [
              h('option', { value: 'string' }, [t('editor.globalVars.types.string')]),
              h('option', { value: 'number' }, [t('editor.globalVars.types.number')]),
              h('option', { value: 'boolean' }, [t('editor.globalVars.types.boolean')]),
              h('option', { value: 'json' }, [t('editor.globalVars.types.json')]),
            ]
          ),
          valueEditor,
          h('div', { class: 'global-vars-row-actions' }, [
            h('button', {
              type: 'button',
              class: 'btn btn-small',
              disabled: isLoading,
              onClick: () => deleteGlobalVarEntry(i),
              title: t('editor.globalVars.remove'),
            }, ['✕']),
          ]),
          (nameErr || isDup || valueErr)
            ? h('div', { class: 'global-vars-row-hint' }, [
                nameErr ? h('span', { class: 'hint error' }, [nameErr]) : '',
                isDup ? h('span', { class: 'hint error' }, [t('editor.globalVars.errors.duplicateName', { name: nameTrimmed })]) : '',
                valueErr ? h('span', { class: 'hint error' }, [valueErr]) : '',
              ])
            : '',
        ])
      );
    }
  }

  const addRow = isReady
    ? h('div', { class: 'global-vars-add-row' }, [
        h('input', {
          class: 'global-vars-name',
          type: 'text',
          id: 'global-vars-new-name',
          value: globalVarsEditorState.newNameText,
          placeholder: '$new_var',
          onInput: (e) => {
            const v = e && e.target ? e.target.value : '';
            globalVarsEditorState.newNameText = String(v);
            safeRender();
          },
        }, []),
        h(
          'select',
          {
            class: 'global-vars-type',
            value: globalVarsEditorState.newType,
            onChange: (e) => {
              const v = e && e.target ? e.target.value : 'string';
              globalVarsEditorState.newType = /** @type {GlobalVarValueType} */ (String(v));
              safeRender();
            },
          },
          [
            h('option', { value: 'string' }, [t('editor.globalVars.types.string')]),
            h('option', { value: 'number' }, [t('editor.globalVars.types.number')]),
            h('option', { value: 'boolean' }, [t('editor.globalVars.types.boolean')]),
            h('option', { value: 'json' }, [t('editor.globalVars.types.json')]),
          ]
        ),
        h('input', {
          class: 'global-vars-value',
          type: 'text',
          id: 'global-vars-new-value',
            value: globalVarsEditorState.newValueText,
          placeholder: t('editor.globalVars.addValuePlaceholder'),
          onInput: (e) => {
            const v = e && e.target ? e.target.value : '';
            globalVarsEditorState.newValueText = String(v);
            safeRender();
          },
        }, []),
        h('button', {
          type: 'button',
          class: 'btn',
          disabled: isLoading,
          onClick: () => addNewGlobalVarEntry(),
        }, [t('editor.globalVars.add')]),
      ])
    : '';

  return h('div', { class: 'global-vars-section' }, [
    h('div', { class: 'tree-open-files-title' }, [t('editor.globalVars.title')]),
    h('div', { class: 'hint' }, [t('editor.globalVars.desc')]),
    h('div', { class: 'global-vars-status' }, statusParts),
    actionBar,
    formatRow,
    isReady ? h('div', { class: 'global-vars-list' }, listRows) : '',
    addRow,
    isReady
      ? h('details', { open: false }, [
          h('summary', {}, [t('editor.globalVars.outputPreview')]),
          previewError ? h('div', { class: 'text-error' }, [previewError]) : '',
          previewText
            ? h('div', {}, [
                h('div', { class: 'json-viewer-actions' }, [
                  makeCopyButton({
                    label: 'Copy',
                    getText: () => String(previewText),
                    statusOk: 'Copied global variables preview JSON to clipboard.',
                  }),
                ]),
                renderJsonCodeBlock(String(previewText), { className: 'global-vars-json', highlight: true }),
              ])
            : '',
        ])
      : '',
  ]);
}

function formatDefinitionClassification(classification) {
  const value = String(classification || '').toUpperCase();
  if (value === 'SCREEN') return t('editor.screenPicker.class.screen');
  if (value === 'COMPONENT') return t('editor.screenPicker.class.component');
  if (value === 'ANIMATION_OR_DATA') return t('editor.screenPicker.class.animation');
  if (value === 'UNREFERENCED_ROOT') return t('editor.screenPicker.class.root');
  if (value === 'POCKET_ONLY') return t('editor.screenPicker.class.pocket');
  return t('editor.screenPicker.class.unknown');
}

function renderScreenOpenSection(imported) {
  const ui = imported && imported.fileIndex ? imported.fileIndex.ui || {} : {};
  const detected = Array.isArray(ui.screenFilesPreview) ? ui.screenFilesPreview : [];
  const uiDefs = uiDefsEditorState.status === 'ready' && uiDefsEditorState.uiDefs.length
    ? uiDefsEditorState.uiDefs
    : [];

  const catalog = uiCatalogState.catalog;
  const catalogFiles = catalog && Array.isArray(catalog.files)
    ? catalog.files.filter((file) => (file.sourceKind === 'imported' || !importedPackRuntime && file.sourceKind === 'vanilla') && Array.isArray(file.definitionIds) && file.definitionIds.length)
    : [];
  const catalogPaths = Array.from(new Set(catalogFiles.map((file) => String(file.filePath)))).sort((a, b) => a.localeCompare(b));
  const importedPathSet = new Set([...catalogPaths, ...uiDefs, ...detected].map((path) => String(path).toLowerCase()));
  const vanillaScreenPaths = vanillaReferenceRuntime && catalog && catalog.symbols && catalog.recordsById
    ? Array.from(new Set(Object.values(catalog.symbols)
        .map((symbol) => catalog.recordsById[symbol.winnerId])
        .filter((record) => record && record.profile !== 'pocket' && record.classification === 'SCREEN')
        .map((record) => String(record.filePath || ''))
        .filter(Boolean)))
    : [];
  // Keep registry/detected paths visible even when the bounded catalog could
  // index only part of a very large pack. Unindexed files still open through
  // the single-file safe fallback.
  const options = Array.from(new Set([...catalogPaths, ...uiDefs, ...detected, ...vanillaScreenPaths].map(String)))
    .sort((a, b) => {
      const aImported = importedPathSet.has(a.toLowerCase()) ? 0 : 1;
      const bImported = importedPathSet.has(b.toLowerCase()) ? 0 : 1;
      return aImported - bImported || a.localeCompare(b);
    });
  const sourceLabel = catalogPaths.length
    ? siteText`カタログ（${catalogPaths.length} ファイル）`
    : uiDefs.length
      ? '_ui_defs.json'
      : siteText('検出結果');

  const defaultPath = options.includes(screenOpenState.selectedPath)
    ? screenOpenState.selectedPath
    : (options.length ? options[0] : screenOpenState.selectedPath || '');
  const definitions = listEffectiveDefinitionsForPath(catalog, defaultPath);
  const selectedDefinition = definitions.find((item) => item.id === screenOpenState.selectedDefinition)
    || definitions.find((item) => item.profile !== 'pocket' && item.classification === 'SCREEN')
    || definitions.find((item) => item.profile !== 'pocket')
    || definitions[0]
    || null;
  const selectedDefinitionId = selectedDefinition ? selectedDefinition.id : '';
  const pocketBlocked = Boolean(selectedDefinition && selectedDefinition.profile === 'pocket');

  const statusBits = [];
  if (uiCatalogState.status === 'loading') {
    statusBits.push(siteText`索引作成 ${uiCatalogState.progress.processed}/${uiCatalogState.progress.total}`);
  }
  if (uiCatalogState.status === 'ready' && catalog && catalog.summary) {
    statusBits.push(siteText`定義 ${catalog.summary.definitions} 件 / シンボル ${catalog.summary.symbols} 件`);
    statusBits.push(siteText`Pocket ${catalog.summary.pocketDefinitions} 件（プレビュー不可）`);
    statusBits.push(t(vanillaReferenceRuntime ? 'editor.screenPicker.compositionStacked' : 'editor.screenPicker.compositionSingle'));
  }
  if (uiCatalogState.error) statusBits.push(siteText`索引エラー: ${uiCatalogState.error}`);
  if (screenOpenState.status === 'loading') statusBits.push(siteText('読み込み中…'));
  if (screenOpenState.status === 'ready' && screenOpenState.lastOpenedPath) {
    statusBits.push(siteText`直前: ${screenOpenState.lastOpenedPath}#${screenOpenState.lastOpenedDefinition || ''}`);
  }
  if (screenOpenState.error) statusBits.push(siteText`エラー: ${screenOpenState.error}`);

  const loading = screenOpenState.status === 'loading';
  const manualSelected = Boolean(String(screenOpenState.manualPath || '').trim());
  const blocked = pocketBlocked && !manualSelected;
  return h('div', { class: 'screen-open-section', id: 'workspace-screen-picker', 'aria-busy': loading ? 'true' : 'false' }, [
    h('div', { class: 'workspace-section-title' }, [siteText('2 · ファイルと定義を選ぶ')]),
    h('p', { class: 'hint screen-picker-hint' }, [siteText('検索で絞り込み、一覧から選択してください。検索しても現在の選択は変わりません。')]),
    renderWorkspacePicker(h, {
      id: 'workspace-file-picker', label: siteText('JSON UIファイル'),
      entries: options.map((path) => ({ value: path, label: `${path}${importedPathSet.has(path.toLowerCase()) ? '' : siteText(' — バニラ参照')}` })),
      selectedValue: defaultPath, state: workspaceNavigationState.file,
      disabled: loading || !options.length, placeholder: siteText('ファイル名で検索（例: inventory）'),
      onSelect: (value) => {
        screenOpenState.selectedPath = value;
        screenOpenState.manualPath = '';
        workspaceNavigationState.definition.query = '';
        workspaceNavigationState.definition.page = 0;
        const nextDefinitions = listEffectiveDefinitionsForPath(catalog, value);
        const nextDefinition = nextDefinitions.find((item) => item.profile !== 'pocket' && item.classification === 'SCREEN')
          || nextDefinitions.find((item) => item.profile !== 'pocket') || nextDefinitions[0];
        screenOpenState.selectedDefinition = nextDefinition?.id || '';
        safeRender();
      },
    }),
    renderWorkspacePicker(h, {
      id: 'workspace-definition-picker', label: siteText`このファイルのUI定義（${definitions.length}件）`,
      entries: definitions.map((item) => ({
        value: item.id,
        label: `${item.localName}${item.baseRef ? ` @ ${item.baseRef}` : ''} — ${formatDefinitionClassification(item.classification)}${item.profile === 'pocket' ? siteText(' / Pocket・解析のみ') : ''}`,
        search: `${item.localName} ${item.qualifiedName} ${item.baseRef || ''} ${item.classification} ${item.profile}`,
      })),
      selectedValue: selectedDefinitionId, state: workspaceNavigationState.definition,
      disabled: loading || !definitions.length, placeholder: siteText('定義名・継承元で検索'),
      onSelect: (value) => {
        screenOpenState.selectedDefinition = value;
        screenOpenState.manualPath = '';
        safeRender();
      },
    }),
    selectedDefinition
      ? h('div', { class: 'workspace-selection-card' }, [
          h('div', { class: 'workspace-selection-meta' }, [
            h('span', { class: `workspace-profile${pocketBlocked ? ' is-pocket' : ''}` }, [pocketBlocked ? siteText('Pocket / 解析のみ') : siteText('Classic / プレビュー対象')]),
            h('span', {}, [selectedDefinition.sourceKind === 'vanilla' ? siteText('バニラ参照から解決') : siteText('読込パックから解決')]),
          ]),
          h('code', {}, [selectedDefinition.qualifiedName]),
          selectedDefinition.baseRef ? h('span', { class: 'hint' }, [siteText`継承元: ${selectedDefinition.baseRef}（別ファイルも参照）`]) : '',
        ])
      : h('div', { class: 'hint', role: 'status' }, [uiCatalogState.status === 'loading' ? siteText('UI定義の索引を作成しています。') : siteText('選択できるUI定義がありません。再索引またはログを確認してください。')]),
    pocketBlocked
      ? h('div', { class: 'fidelity-notice is-blocked' }, [
          h('strong', {}, [siteText('Pocket UIはプレビュー対象外です')]),
          h('span', {}, [siteText('パック内の読み込み・定義索引は保持しています。Classicの定義へ切り替えるとプレビューできます。')]),
        ]) : '',
    uiCatalogState.error || screenOpenState.error
      ? h('div', { class: 'workspace-error', role: 'alert' }, [
          h('strong', {}, [siteText('UIを開けませんでした')]),
          h('span', {}, [String(screenOpenState.error || uiCatalogState.error)]),
          h('a', { href: '#/logs' }, [siteText('ログ・診断を開く')]),
        ]) : '',
    h('div', { class: 'screen-open-actions' }, [
      h('button', {
        id: 'workspace-open-preview', type: 'button', class: 'btn btn-primary',
        disabled: loading || blocked || (!defaultPath && !manualSelected),
        onClick: async () => {
          const manual = String(screenOpenState.manualPath || '').trim();
          const effective = manual || defaultPath;
          if (!effective) return;
          const res = await openUiScreenFromImportedPack(effective, manual ? null : (selectedDefinitionId || null));
          if (res?.ok && res.fileId) store.dispatch(actions.navReset(screenRefFromFile(store.getState().files.byId[res.fileId])));
        },
      }, [loading ? siteText('UIを読み込み中…') : blocked ? siteText('Pocketはプレビュー不可') : siteText('3 · 選択したUIをプレビュー')]),
    ]),
    screenOpenState.status === 'ready'
      ? h('div', { class: 'workspace-reference-action' }, [
          h('button', { type: 'button', class: 'workspace-text-button', onClick: () => {
            studioUi.rightOpen = true; studioUi.rightView = 'references'; safeRender();
          } }, [siteText('欠落している素材・参照を確認')]),
        ]) : '',
    h('details', { class: 'screen-open-advanced' }, [
      h('summary', {}, [siteText('索引・手動パス・詳細状態')]),
      h('p', { class: 'hint' }, [siteText`索引元: ${sourceLabel}。手動パスを入力すると上の選択より優先します。`]),
      h('div', { class: 'screen-open-row' }, [
        h('label', { class: 'screen-open-label', for: 'workspace-manual-path' }, [siteText('手動パス')]),
        h('input', {
          id: 'workspace-manual-path', class: 'screen-open-input', type: 'text',
          value: screenOpenState.manualPath, placeholder: 'ui/example_screen.json',
          onInput: (event) => {
            screenOpenState.manualPath = String(event.currentTarget.value || '');
            const hasManualPath = Boolean(screenOpenState.manualPath.trim());
            const button = document.getElementById('workspace-open-preview');
            if (button instanceof HTMLButtonElement) {
              button.disabled = loading || (!hasManualPath && pocketBlocked) || (!defaultPath && !hasManualPath);
              if (!loading) button.textContent = !hasManualPath && pocketBlocked ? siteText('Pocketはプレビュー不可') : siteText('3 · 選択したUIをプレビュー');
            }
          },
        }),
        h('button', {
          type: 'button', class: 'btn', disabled: uiCatalogState.status === 'loading' || loading,
          onClick: () => { resetUiCatalogState(); requestUiCatalogBuild('manual-reindex'); },
        }, [siteText('UI定義を再索引')]),
      ]),
      statusBits.length ? h('div', { class: 'hint workspace-index-status' }, [statusBits.join(' | ')]) : '',
    ]),
  ]);
}

function renderPackExportSection(imported) {
  const status = exportPackState.status;
  const summary = exportPackState.lastSummary;

  const statusLine =
    status === 'working'
      ? t('exportPack.status.exporting')
      : status === 'done'
        ? t('exportPack.status.doneShort')
        : status === 'error'
          ? (exportPackState.error || t('exportPack.status.error'))
          : t('exportPack.status.idle');

  const canClick = status !== 'working';

  const buttonLabel = status === 'working'
    ? t('exportPack.action.exporting')
    : t('exportPack.action.export');

  const details = summary
    ? h('details', {}, [
        h('summary', {}, [t('exportPack.lastSummary.title')]),
        h('div', { class: 'hint' }, [
          t('exportPack.lastSummary.line', {
            count: summary.fileCount,
            uiCount: summary.uiFileCount,
            assetCount: summary.assetFileCount,
          }),
        ]),
        summary.usedDefaultPackIcon
          ? h('div', { class: 'hint' }, [t('exportPack.lastSummary.defaultIconUsed')])
          : '',
        exportPackState.lastExportAtIso
          ? h('div', { class: 'hint' }, [
              t('exportPack.lastSummary.when', { iso: exportPackState.lastExportAtIso }),
            ])
          : '',
        Array.isArray(summary.warnings) && summary.warnings.length
          ? h('details', {}, [
              h('summary', {}, [t('exportPack.lastSummary.warnings', {
                count: Number.isFinite(Number(summary.warningCount))
                  ? Number(summary.warningCount)
                  : summary.warnings.length,
              })]),
              h('ul', { class: 'hint-list' }, summary.warnings.map((w) => h('li', {}, [String(w)]))),
              summary.warningsTruncated
                ? h('div', { class: 'hint' }, [
                    `(showing ${summary.warnings.length} of ${summary.warningCount})`,
                  ])
                : '',
            ])
          : '',
      ])
    : '';

  return h('div', { class: 'pack-export-section' }, [
    h('div', { class: 'tree-open-files-title' }, [t('exportPack.title')]),
    h('div', { class: 'hint' }, [t('exportPack.hint')]),
    h('div', { class: 'screen-open-row' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary',
          disabled: canClick ? null : 'disabled',
          onClick: () => exportResourcePackZip(),
        },
        [buttonLabel]
      ),
      h('div', { class: 'hint' }, [statusLine]),
    ]),
    details,
  ]);
}




function renderImportedPackSummary(imported, options = {}) {
  const includeScreenOpen = options.includeScreenOpen !== false;
  const header = imported.manifestSummary?.header || {};
  const fileIndex = imported.fileIndex || {};
  const ui = fileIndex.ui || {};

  const rows = [
    [t('editor.import.summary.file'), `${imported.fileName} (${formatBytes(imported.zipBytes)})`],
    [t('editor.import.summary.packName'), getImportedPackDisplayName(imported)],
    [t('editor.import.summary.uuid'), header.uuid || '-'],
    [t('editor.import.summary.version'), header.version || '-'],
    [t('editor.import.summary.manifestPath'), imported.manifestZipPath || '-'],
    [t('editor.import.summary.rootPrefix'), imported.rootPrefix || '(root)'],
    [t('editor.import.summary.totalFiles'), String(fileIndex.totalFiles ?? '-')],
    [t('editor.import.summary.uiRoot'), ui.rootFolder ? `${ui.rootFolder}/` : t('editor.import.summary.notFound')],
    [t('editor.import.summary.uiFiles'), String(ui.fileCount ?? 0)],
  ];

  /** @param {any} v */
  const safe = (v) => (v == null ? '-' : String(v));

  const systemRows = [
    [t('editor.import.summary.uiDefs'), safe(ui.systemFiles?.uiDefs)],
    [t('editor.import.summary.globalVars'), safe(ui.systemFiles?.globalVariables)],
  ];

  const screenCount = Number(ui.screenFilesCount || 0);
  const screenPreview = Array.isArray(ui.screenFilesPreview) ? ui.screenFilesPreview : [];

  const filePreview = Array.isArray(fileIndex.pathsPreview) ? fileIndex.pathsPreview : [];
  const totalFilesNum = Number(fileIndex.totalFiles || 0);

  const warnings = Array.isArray(imported.warnings) ? imported.warnings : [];

  return h('div', { class: 'tree-import-summary' }, [
    h(
      'table',
      { class: 'kv-table' },
      rows.map(([k, v]) =>
        h('tr', {}, [h('th', {}, [String(k)]), h('td', { class: 'code' }, [String(v)])])
      )
    ),
    filePreview.length
      ? h('details', {}, [
          h('summary', {}, [
            `${t('editor.import.summary.filesPreview')} (${filePreview.length})`,
          ]),
          h(
            'ul',
            { class: 'hint-list' },
            filePreview.map((p) => h('li', {}, [h('code', {}, [p])]))
          ),
          totalFilesNum > filePreview.length
            ? h('div', { class: 'hint' }, [
                t('editor.import.summary.filesTruncated', {
                  shown: filePreview.length,
                  total: totalFilesNum,
                }),
              ])
            : '',
        ])
      : '',
    h('div', { class: 'tree-open-files-title' }, [t('editor.import.summary.systemFiles')]),
    h(
      'table',
      { class: 'kv-table' },
      systemRows.map(([k, v]) =>
        h('tr', {}, [h('th', {}, [String(k)]), h('td', { class: 'code' }, [String(v)])])
      )
    ),
    renderUiDefsEditorSection(imported),
    renderGlobalVarsEditorSection(imported),
    h('div', { class: 'tree-open-files-title' }, [
      `${t('editor.import.summary.screens')} (${screenCount})`,
    ]),
    screenCount === 0
      ? h('div', { class: 'hint' }, [t('editor.import.summary.noScreensDetected')])
      : h(
          'ul',
          { class: 'hint-list' },
          screenPreview.map((p) => h('li', {}, [h('code', {}, [p])]))
        ),
    screenCount > screenPreview.length
      ? h('div', { class: 'hint' }, [
          t('editor.import.summary.screensTruncated', {
            shown: screenPreview.length,
            total: screenCount,
          }),
        ])
      : '',
    includeScreenOpen ? renderScreenOpenSection(imported) : '',
    h('hr', {}),
    renderPackExportSection(imported),
    warnings.length
      ? h('details', {}, [
          h('summary', {}, [t('editor.import.summary.warnings', { count: warnings.length })]),
          h(
            'ul',
            { class: 'hint-list' },
            warnings.slice(0, 50).map((w) => {
              const code = w && typeof w === 'object' && 'code' in w ? String(w.code) : 'WARN';
              const msg = w && typeof w === 'object' && 'message' in w ? String(w.message) : String(w);
              const path = w && typeof w === 'object' && 'path' in w && w.path ? ` (${w.path})` : '';
              return h('li', {}, [h('code', {}, [`${code}${path}`]), ': ', msg]);
            })
          ),
          warnings.length > 50 ? h('div', { class: 'hint' }, ['(truncated)']) : '',
        ])
      : '',
  ]);
}

/**
 * @param {import('./state-store/app-store.js').AppState} state
 */

// --- Tree search and jump (S037) ---------------------------------------

/**
 * @typedef {'element'|'textKey'|'variable'} TreeSearchKind
 */

/**
 * @typedef {{
 *  kind: TreeSearchKind,
 *  label: string,
 *  fileId: string|null,
 *  nodeId: string|null,
 *  varIndex: number|null,
 *  textKey: string|null,
 * }} TreeSearchResult
 */

/**
 * UI-only state for the Tree search box.
 * Kept outside the central store (no undo/redo).
 */
const treeSearchState = {
  query: '',
  activeIndex: 0,
};

/**
 * @param {string} s
 */
function normalizeSearchQuery(s) {
  return String(s || '').trim().toLowerCase();
}

// NOTE: clampNumber(n,min,max) is already defined in the Canvas helper section.
// Reuse it here to avoid duplicate identifiers in the ES module scope.

/**
 * @param {import('./state-store/app-store.js').AppState} state
 * @param {string} query
 * @returns {{ results: TreeSearchResult[], matchNodeIds: Set<string> }}
 */
function computeTreeSearchResults(state, query) {
  const q = normalizeSearchQuery(query);
  /** @type {TreeSearchResult[]} */
  const results = [];
  const matchNodeIds = new Set();
  const seen = new Set();

  if (!q) return { results, matchNodeIds };

  const MAX_RESULTS = 200;

  // 1) Element ids/names/text (current file only)
  try {
    const fileId = state.files.currentFileId;
    const file = fileId ? state.files.byId[fileId] : null;
    const nodesById = file && file.nodesById ? file.nodesById : null;

    if (fileId && nodesById) {
      for (const node of Object.values(nodesById)) {
        if (!node) continue;
        const nodeId = String(node.id || '');
        if (!nodeId) continue;

        const nodeType = String(node.type || '');
        const nodeName = String(node.props?.name ?? '');
        const nodeText = String(node.props?.text ?? '');
        const localize = Boolean(node.props?.localize);

        const idMatch = nodeId.toLowerCase().includes(q);
        const nameMatch = nodeName.toLowerCase().includes(q);
        const textKeyMatch = localize && nodeText && nodeText.toLowerCase().includes(q);

        if (idMatch || nameMatch) {
          const nameSuffix = nodeName ? ` (${nodeName})` : '';
          const label = `${nodeId} — ${nodeType}${nameSuffix}`;
          const key = `element:${fileId}:${nodeId}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              kind: 'element',
              label,
              fileId: String(fileId),
              nodeId,
              varIndex: null,
              textKey: null,
            });
          }
          matchNodeIds.add(nodeId);
        }

        if (textKeyMatch && results.length < MAX_RESULTS) {
          const label = `${nodeText} — ${nodeType} (${nodeId})`;
          const key = `textKey:${fileId}:${nodeId}:${nodeText}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              kind: 'textKey',
              label,
              fileId: String(fileId),
              nodeId,
              varIndex: null,
              textKey: String(nodeText),
            });
          }
          matchNodeIds.add(nodeId);
        }

        if (results.length >= MAX_RESULTS) break;
      }
    }
  } catch (err) {
    diagnostics.captureError(err, { module: 'tree-search', where: 'computeTreeSearchResults(elements)' });
  }

  // 2) Global variable names (when loaded)
  try {
    if (globalVarsEditorState.status === 'ready' && Array.isArray(globalVarsEditorState.entries)) {
      for (let i = 0; i < globalVarsEditorState.entries.length; i += 1) {
        if (results.length >= MAX_RESULTS) break;
        const entry = globalVarsEditorState.entries[i];
        const name = String(entry?.name ?? '').trim();
        if (!name) continue;
        if (!name.toLowerCase().includes(q)) continue;

        const key = `var:${i}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          kind: 'variable',
          label: name,
          fileId: null,
          nodeId: null,
          varIndex: i,
          textKey: null,
        });

        if (results.length >= MAX_RESULTS) break;
      }
    }
  } catch (err) {
    diagnostics.captureError(err, { module: 'tree-search', where: 'computeTreeSearchResults(globalVars)' });
  }

  return { results, matchNodeIds };
}

function clearTreeSearch() {
  treeSearchState.query = '';
  treeSearchState.activeIndex = 0;
  safeRender();
}

/**
 * @param {TreeSearchKind} kind
 */
function treeSearchKindLabel(kind) {
  if (kind === 'variable') return t('editor.search.kind.variable');
  if (kind === 'textKey') return t('editor.search.kind.textKey');
  return t('editor.search.kind.element');
}

/**
 * Expand all ancestors so the given node is visible.
 * @param {string} fileId
 * @param {import('./state-store/app-store.js').OpenFile} file
 * @param {string} nodeId
 */
function expandTreeToNode(fileId, file, nodeId) {
  try {
    if (!file || !file.nodesById || !file.rootId) return;
    const nodesById = file.nodesById;
    const rootId = String(file.rootId);

    let cur = String(nodeId);
    let safety = 0;
    while (true) {
      const parentId = findParentId(nodesById, rootId, cur);
      if (!parentId) break;
      getCollapsedMap(fileId)[String(parentId)] = false;
      cur = String(parentId);
      safety += 1;
      if (safety > 2000) break;
    }
  } catch (err) {
    diagnostics.captureError(err, { module: 'tree-search', where: 'expandTreeToNode' });
  }
}

/**
 * @param {string} nodeId
 */
function scrollTreeNodeIntoView(nodeId) {
  try {
    const want = String(nodeId);
    const rows = document.querySelectorAll('[data-tree-node-id]');
    let row = null;

    for (const r of rows) {
      if (!r || typeof r.getAttribute !== 'function') continue;
      if (r.getAttribute('data-tree-node-id') === want) {
        row = r;
        break;
      }
    }

    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });

    const btn = row.querySelector('button.tree-item-btn');
    if (btn && typeof btn.focus === 'function') btn.focus();
  } catch (err) {
    diagnostics.captureError(err, { module: 'tree-search', where: 'scrollTreeNodeIntoView' });
  }
}

/**
 * @param {number} index
 */
function scrollGlobalVarIntoView(index) {
  try {
    const sel = `[data-global-var-index="${String(index)}"]`;
    const row = document.querySelector(sel);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });

    const input = row.querySelector('input.global-vars-name');
    if (input && typeof input.focus === 'function') {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }
  } catch (err) {
    diagnostics.captureError(err, { module: 'tree-search', where: 'scrollGlobalVarIntoView' });
  }
}

/**
 * @param {TreeSearchResult} result
 */
function jumpToTreeSearchResult(result) {
  try {
    const state = store.getState();

    if (result.kind === 'variable') {
      if (typeof result.varIndex !== 'number') return;
      requestAnimationFrame(() => scrollGlobalVarIntoView(result.varIndex));
      return;
    }

    const nodeId = result.nodeId ? String(result.nodeId) : '';
    if (!nodeId) return;

    const fileId = result.fileId ? String(result.fileId) : state.files.currentFileId;
    if (!fileId) return;

    if (state.files.currentFileId !== fileId) {
      store.dispatch(actions.setCurrentFile(fileId));
    }

    const file = state.files.byId[fileId];
    if (!file) return;

    expandTreeToNode(fileId, file, nodeId);
    store.dispatch(actions.selectNode(nodeId));

    requestAnimationFrame(() => scrollTreeNodeIntoView(nodeId));
  } catch (err) {
    reportWorkspaceError(err);
  }
}

/**
 * @param {KeyboardEvent} e
 * @param {number} resultsLen
 */
function handleTreeSearchKeydown(e, resultsLen) {
  if (!e) return;
  if (!resultsLen) {
    if (e.key === 'Escape' && treeSearchState.query) {
      e.preventDefault();
      clearTreeSearch();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    treeSearchState.activeIndex = clampNumber(treeSearchState.activeIndex + 1, 0, Math.max(0, resultsLen - 1));
    safeRender();
    requestAnimationFrame(() => {
      const active = document.getElementById(`tree-search-opt-${treeSearchState.activeIndex}`);
      if (active) active.scrollIntoView({ block: 'nearest' });
    });
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    treeSearchState.activeIndex = clampNumber(treeSearchState.activeIndex - 1, 0, Math.max(0, resultsLen - 1));
    safeRender();
    requestAnimationFrame(() => {
      const active = document.getElementById(`tree-search-opt-${treeSearchState.activeIndex}`);
      if (active) active.scrollIntoView({ block: 'nearest' });
    });
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const state = store.getState();
    const vm = computeTreeSearchResults(state, treeSearchState.query);
    const results = vm.results;
    const idx = clampNumber(treeSearchState.activeIndex, 0, Math.max(0, results.length - 1));
    const r = results.length ? results[idx] : null;
    if (r) jumpToTreeSearchResult(r);
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    clearTreeSearch();
    return;
  }
}

function renderEditorTreePanel(state) {
  const project = state.project;
  const hasProject = Boolean(project);

  const packState = state.pack;
  const hasImportedPack = Boolean(packState.imported);

  const openFileId = state.files.currentFileId;
  const currentFile = openFileId ? state.files.byId[openFileId] : null;

  const toolbar = h('div', { class: 'tree-toolbar' }, [
    renderPackImportSection(packState),
    !hasProject
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: async () => {
              // Ensure we don't keep an imported ZIP open when switching to the stub project.
              await unloadImportedPackRuntime();
              store.dispatch(actions.packUnload());

              store.dispatch(
                actions.setProject({
                  id: 'stub-project',
                  name: 'Stub Project',
                  loadedAtIso: new Date().toISOString(),
                })
              );
              store.dispatch(
                actions.openFile(
                  createStubFile({
                    id: 'ui:sample_screen',
                    path: 'ui/sample_screen.json',
                    titleText: 'Sample Screen',
                  })
                )
              );
            },
          },
          [t('editor.tree.loadSample')]
        )
      : hasImportedPack
        ? ''
        : h('div', { class: 'tree-project' }, [
            h('div', { class: 'tree-project-name' }, [project.name]),
            h('div', { class: 'hint' }, [t('editor.tree.loadedAt', { time: project.loadedAtIso })]),
          ]),
  ]);

  const openFiles = h('div', { class: 'tree-open-files' }, [
    h('div', { class: 'tree-open-files-title' }, [t('editor.tree.openFiles')]),
    state.files.openFileIds.length === 0
      ? h('div', { class: 'hint' }, [t('editor.tree.none')])
      : h(
          'ul',
          { class: 'tree-open-files-list' },
          state.files.openFileIds.map((id) => {
            const f = state.files.byId[id];
            const isActive = id === state.files.currentFileId;
            return h('li', { class: 'tree-open-file-row' }, [
              h(
                'button',
                {
                  type: 'button',
                  class: `tree-open-file-btn${isActive ? ' active' : ''}`,
                  onClick: () => {
                    store.dispatch(actions.setCurrentFile(id));
                    const selected = f?.meta?.selectedDefinition;
                    if (f?.path && selected) {
                      screenOpenState.selectedPath = String(f.path);
                      screenOpenState.selectedDefinition = String(
                        typeof selected === 'object'
                          ? selected.recordId || selected.rawKey || selected.definition || ''
                          : selected
                      );
                    }
                  },
                },
                [f
                  ? `${f.path}${f?.meta?.selectedDefinition
                    ? `#${String(typeof f.meta.selectedDefinition === 'object'
                        ? f.meta.selectedDefinition.definition || f.meta.selectedDefinition.rawKey || ''
                        : f.meta.selectedDefinition)}`
                    : ''}`
                  : id]
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'tree-open-file-close',
                  title: t('editor.tree.closeFile'),
                  onClick: () => store.dispatch(actions.closeFile(id)),
                },
                ['×']
              ),
            ]);
          })
        ),
  ]);

  const sampleButtons = hasProject && !hasImportedPack
    ? h('div', { class: 'tree-samples' }, [
        h('div', { class: 'tree-open-files-title' }, [t('editor.tree.samples')]),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: () =>
              store.dispatch(
                actions.openFile(
                  createStubFile({
                    id: 'ui:sample_screen',
                    path: 'ui/sample_screen.json',
                    titleText: 'Sample Screen',
                  })
                )
              ),
          },
          [t('editor.tree.openSampleScreen')]
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: () =>
              store.dispatch(
                actions.openFile(
                  createStubFile({
                    id: 'ui:sample_hud',
                    path: 'ui/sample_hud.json',
                    titleText: 'Sample HUD',
                  })
                )
              ),
          },
          [t('editor.tree.openSampleHud')]
        ),
      ])
    : hasImportedPack
      ? h('div', { class: 'hint' }, [
          t('editor.tree.importedHint'),
        ])
      : h('div', { class: 'hint' }, [
          t('editor.tree.noProjectHint'),
        ]);

  const searchVm = computeTreeSearchResults(state, treeSearchState.query);
  const searchResults = searchVm.results;
  const hasQuery = Boolean(normalizeSearchQuery(treeSearchState.query));

  const activeIndex = searchResults.length
    ? clampNumber(treeSearchState.activeIndex, 0, Math.max(0, searchResults.length - 1))
    : 0;
  treeSearchState.activeIndex = activeIndex;

  const activeResult = searchResults.length ? searchResults[activeIndex] : null;
  const activeNodeId =
    activeResult && (activeResult.kind === 'element' || activeResult.kind === 'textKey') && activeResult.nodeId
      ? String(activeResult.nodeId)
      : null;

  const activeDescId = searchResults.length ? `tree-search-opt-${activeIndex}` : null;

  const searchSection = h('div', { class: 'tree-search' }, [
    h('div', { class: 'tree-search-row' }, [
      h(
        'input',
        {
          id: 'tree-search-input',
          class: 'tree-search-input',
          type: 'search',
          value: treeSearchState.query,
          placeholder: t('editor.search.placeholder'),
          title: t('editor.search.shortcutHint'),
          'aria-label': t('editor.search.ariaLabel'),
          'aria-keyshortcuts': 'Control+F Meta+F',
          'aria-controls': 'tree-search-results',
          'aria-activedescendant': activeDescId || null,
          onInput: (e) => {
            const v = e && e.target ? e.target.value : '';
            treeSearchState.query = String(v);
            treeSearchState.activeIndex = 0;
            safeRender();
          },
          onKeydown: (e) => handleTreeSearchKeydown(e, searchResults.length),
        },
        []
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small tree-search-clear',
          disabled: !treeSearchState.query,
          title: t('editor.search.clear'),
          'aria-label': t('editor.search.clear'),
          onClick: () => clearTreeSearch(),
        },
        ['×']
      ),
    ]),
    hasQuery
      ? searchResults.length
        ? h(
            'div',
            {
              id: 'tree-search-results',
              class: 'tree-search-results',
              role: 'listbox',
              'aria-label': t('editor.search.resultsAriaLabel'),
            },
            searchResults.map((r, i) => {
              const isActive = i === activeIndex;
              return h(
                'button',
                {
                  type: 'button',
                  id: `tree-search-opt-${i}`,
                  class: `tree-search-result-btn${isActive ? ' active' : ''}`,
                  role: 'option',
                  'aria-selected': isActive ? 'true' : 'false',
                  onMouseenter: () => {
                    treeSearchState.activeIndex = i;
                    safeRender();
                  },
                  onClick: () => {
                    treeSearchState.activeIndex = i;
                    safeRender();
                    jumpToTreeSearchResult(r);
                  },
                },
                [
                  h('span', { class: 'tree-search-kind' }, [treeSearchKindLabel(r.kind)]),
                  h('span', { class: 'tree-search-label' }, [r.label]),
                ]
              );
            })
          )
        : h('div', { class: 'hint tree-search-empty' }, [t('editor.search.noResults')])
      : '',
  ]);

  const tree = currentFile
    ? renderTree(currentFile, state.editor.selection.nodeId, {
        matchNodeIds: searchVm.matchNodeIds,
        activeNodeId,
      })
    : h('div', { class: 'hint' }, [
        hasImportedPack
          ? t('editor.tree.noFileImported')
          : t('editor.tree.noFileSample'),
      ]);

  return h('div', { id: 'tree-root' }, [
    toolbar,
    openFiles,
    searchSection,
    sampleButtons,
    h('div', { class: 'tree-scroll', 'aria-label': t('panel.tree') }, [tree]),
  ]);
}


// --- Tree interactions (S032) -------------------------------------------

const treeUiState = {
  collapsedByFileId: /** @type {Record<string, Record<string, boolean>>} */ ({}),
  contextMenu: {
    open: false,
    fileId: null,
    nodeId: null,
    parentId: null,
    x: 0,
    y: 0,
    restoreFocusId: null,
  },
  drag: {
    active: false,
    fileId: null,
    nodeId: null,
    parentId: null,
    fromIndex: -1,
    toIndex: null,
    indicatorEl: null,
    handleEl: null,
  },
};


/**
 * Stable DOM id for Tree controls (used for focus restoration when closing menus).
 * We intentionally keep it simple and deterministic to work across re-renders.
 *
 * @param {string} prefix
 * @param {string|null} fileId
 * @param {string|null} nodeId
 */
function makeTreeDomId(prefix, fileId, nodeId) {
  const f = encodeURIComponent(String(fileId || ''));
  const n = encodeURIComponent(String(nodeId || ''));
  return `${prefix}-${f}-${n}`;
}

/**
 * @param {import('./state-store/app-store.js').OpenFile} file
 */
function canEditTreeForFile(file) {
  if (!file) return false;
  if (file.readOnly && !file.treeEditable) return false;
  return true;
}

function getCollapsedMap(fileId) {
  const k = String(fileId || '');
  if (!treeUiState.collapsedByFileId[k]) treeUiState.collapsedByFileId[k] = {};
  return treeUiState.collapsedByFileId[k];
}

function isTreeNodeCollapsed(fileId, nodeId, nodesById = null) {
  const map = getCollapsedMap(fileId);
  const key = String(nodeId);
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key] === true;
  return shouldDefaultCollapseGeneratedCollectionNode(nodesById && nodesById[key], nodesById);
}

function toggleTreeNodeCollapsed(fileId, nodeId, nodesById = null) {
  const map = getCollapsedMap(fileId);
  const key = String(nodeId);
  map[key] = !isTreeNodeCollapsed(fileId, nodeId, nodesById);
  safeRender();
}

function closeTreeContextMenu(opts = { silent: false, restoreFocus: true }) {
  const restoreId = treeUiState.contextMenu.restoreFocusId;

  treeUiState.contextMenu.open = false;
  treeUiState.contextMenu.fileId = null;
  treeUiState.contextMenu.nodeId = null;
  treeUiState.contextMenu.parentId = null;
  treeUiState.contextMenu.restoreFocusId = null;

  if (!opts || !opts.silent) {
    safeRender();

    const shouldRestore = !opts || opts.restoreFocus !== false;
    if (shouldRestore && restoreId) {
      requestAnimationFrame(() => {
        const el = document.getElementById(String(restoreId));
        if (el && typeof el.focus === 'function') el.focus();
      });
    }

    return;
  }

  const overlay = document.getElementById('tree-context-overlay');
  if (overlay) overlay.remove();
  const menu = document.getElementById('tree-context-menu');
  if (menu) menu.remove();
}

function openTreeContextMenu({ fileId, nodeId, parentId, x, y, restoreFocusId }) {
  const pad = 8;
  const maxX = Math.max(pad, window.innerWidth - pad);
  const maxY = Math.max(pad, window.innerHeight - pad);

  treeUiState.contextMenu.open = true;
  treeUiState.contextMenu.fileId = String(fileId);
  treeUiState.contextMenu.nodeId = String(nodeId);
  treeUiState.contextMenu.parentId = parentId != null ? String(parentId) : null;
  treeUiState.contextMenu.x = Math.max(pad, Math.min(Number(x) || 0, maxX));
  treeUiState.contextMenu.y = Math.max(pad, Math.min(Number(y) || 0, maxY));
  treeUiState.contextMenu.restoreFocusId = restoreFocusId || (document.activeElement && document.activeElement.id) || null;

  safeRender();

  requestAnimationFrame(() => {
    const first = document.querySelector('#tree-context-menu button');
    if (first && typeof first.focus === 'function') first.focus();
  });
}

function applyTreeEditPatch(fileId, patch, nextSelectedNodeId = null) {
  assertStudioExternalChange21('原文ツリーの変更');
  store.dispatch(actions.patchFile({ fileId, patch }));
  if (nextSelectedNodeId != null) {
    store.dispatch(actions.selectNode(nextSelectedNodeId));
  }
}

function updateImportedPackOverridesIfNeeded(file, jsonText, jsonValue) {
  assertStudioExternalChange21('原文ファイルの変更');
  try {
    if (!file || !file.meta) return;
    if (file.meta.source !== 'importedPack') return;
    if (file.meta.previewProjection === true) return;
    if (!importedPackRuntime) return;
    if (typeof file.path !== 'string') return;

    // S039: Be tolerant of either Map or plain object storage.
    // Earlier steps used a plain object; later refactors may switch to Map.
    const textStore = importedPackRuntime.overridesTextByPackPath;
    if (textStore && typeof textStore.set === 'function') {
      textStore.set(file.path, jsonText);
    } else {
      if (!importedPackRuntime.overridesTextByPackPath || typeof importedPackRuntime.overridesTextByPackPath !== 'object') {
        importedPackRuntime.overridesTextByPackPath = {};
      }
      importedPackRuntime.overridesTextByPackPath[file.path] = jsonText;
    }
    markResourcePackMutation();
    if (/^(?:items\/.+\.json|textures\/item_texture\.json)$/iu.test(file.path)) {
      clearItemTextureAtlasCache();
      requestCanvasTextureMetadataRefresh();
      scheduleReferenceContextRevalidation();
    }

    if (jsonValue !== undefined) {
      const jsonStore = importedPackRuntime.overridesJsonByPackPath;
      if (jsonStore && typeof jsonStore.set === 'function') {
        jsonStore.set(file.path, jsonValue);
      } else {
        if (!importedPackRuntime.overridesJsonByPackPath || typeof importedPackRuntime.overridesJsonByPackPath !== 'object') {
          importedPackRuntime.overridesJsonByPackPath = {};
        }
        importedPackRuntime.overridesJsonByPackPath[file.path] = jsonValue;
      }
    }
  } catch (err) {
    diagnostics.captureError(err, {
      module: 'tree',
      where: 'updateImportedPackOverridesIfNeeded',
    });
  }
}

function buildScreenFilePatchFromModel(file, nextModel) {
  const modelOutputText = uiScreenModelToJsonText(nextModel, { indent: 2, finalNewline: true });
  const modelOutputJson = uiScreenModelToJson(nextModel);

  // S039: Re-run baseline validation whenever the model changes.
  // Avoid spamming diagnostics here; the UI consumes this for export gating.
  const validation = validateUiScreenModel(nextModel, {
    filePath:
      typeof file?.packPath === 'string'
        ? file.packPath
        : typeof file?.path === 'string'
          ? file.path
          : nextModel.filePath,
    sourceJson: modelOutputJson,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES],
    referenceContext: buildReferenceContextForValidation(file, '', nextModel),
  });

  const tree = buildTreeFromUiScreenModel(nextModel);
  const uiModelSummary = summarizeUiScreenModel(nextModel);
  const treeStats = { ...nextModel.stats };

  const nextMeta = { ...(file.meta || {}), uiModelSummary, treeStats };

  return {
    uiModel: nextModel,
    nodesById: tree.nodesById,
    rootId: tree.rootId,
    modelOutputText,
    sourceJson: modelOutputJson,
    validation,
    dirty: true,
    meta: nextMeta,
  };
}

function applyTreeReorder(fileId, parentId, nodeId, toIndex) {
  const state = store.getState();
  const file = state.files.byId[fileId];
  if (!file) return;
  if (!canEditTreeForFile(file)) return;

  if (file.uiModel) {
    const nextModel = reorderUiModelChild(file.uiModel, parentId, nodeId, toIndex);
    if (nextModel === file.uiModel) return;

    const patch = buildScreenFilePatchFromModel(file, nextModel);
    applyTreeEditPatch(fileId, patch);
    updateImportedPackOverridesIfNeeded(file, patch.modelOutputText, patch.sourceJson);
    return;
  }

  const nextNodesById = reorderChildInNodeMap(file.nodesById || {}, parentId, nodeId, toIndex);
  if (nextNodesById === file.nodesById) return;
  applyTreeEditPatch(fileId, { nodesById: nextNodesById, dirty: true });
}

function collectSubtreeIds(nodesById, nodeId) {
  const ids = [];
  const seen = new Set();
  const stack = [String(nodeId)];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    const n = nodesById && nodesById[id];
    if (n && Array.isArray(n.children)) {
      for (const c of n.children) stack.push(String(c));
    }
  }
  return ids;
}

function applyTreeDuplicate(fileId, nodeId) {
  const state = store.getState();
  const file = state.files.byId[fileId];
  if (!file) return;
  if (!canEditTreeForFile(file)) return;

  closeTreeContextMenu({ silent: true });

  if (file.uiModel) {
    const result = duplicateUiModelNode(file.uiModel, nodeId);
    if (!result || !result.newNodeId || result.model === file.uiModel) return;

    const patch = buildScreenFilePatchFromModel(file, result.model);
    applyTreeEditPatch(fileId, patch, result.newNodeId);
    updateImportedPackOverridesIfNeeded(file, patch.modelOutputText, patch.sourceJson);
    return;
  }

  const result = duplicateSubtreeInNodeMap(file.nodesById || {}, file.rootId, nodeId);
  if (!result || !result.newNodeId) return;
  applyTreeEditPatch(fileId, { nodesById: result.nodesById, dirty: true }, result.newNodeId);
}

function applyTreeDelete(fileId, nodeId) {
  const state = store.getState();
  const file = state.files.byId[fileId];
  if (!file) return;
  if (!canEditTreeForFile(file)) return;

  closeTreeContextMenu({ silent: true });

  if (String(nodeId) === String(file.rootId)) return;

  const selected = state.editor && state.editor.selection ? state.editor.selection.nodeId : null;
  const subtreeIds = collectSubtreeIds(file.nodesById || {}, nodeId);
  const selectionWillBeDeleted = selected != null && subtreeIds.includes(String(selected));

  if (file.uiModel) {
    const result = deleteUiModelNode(file.uiModel, nodeId);
    if (!result || !result.deleted || result.model === file.uiModel) return;

    const patch = buildScreenFilePatchFromModel(file, result.model);
    const nextSelected = selectionWillBeDeleted ? result.parentId || file.rootId : null;

    applyTreeEditPatch(fileId, patch, nextSelected);
    updateImportedPackOverridesIfNeeded(file, patch.modelOutputText, patch.sourceJson);
    return;
  }

  const result = deleteSubtreeInNodeMap(file.nodesById || {}, file.rootId, nodeId);
  if (!result || !result.deletedIds || result.deletedIds.length == 0) return;

  const nextSelected = selectionWillBeDeleted ? result.parentId || file.rootId : null;
  applyTreeEditPatch(fileId, { nodesById: result.nodesById, dirty: true }, nextSelected);
}



function cloneDefaultValue(v) {
  if (Array.isArray(v)) return v.slice();
  if (v && typeof v === 'object') {
    try {
      return JSON.parse(JSON.stringify(v));
    } catch {
      return v;
    }
  }
  return v;
}

function buildDefaultPropsForElementType(elementType) {
  const type = String(elementType || '').trim().toLowerCase();
  if (!type) return {};

  const groups = getEditablePropertyGroupsForType(type);
  const props = {};

  for (const g of groups) {
    const fields = Array.isArray(g.fields) ? g.fields : [];
    for (const f of fields) {
      if (!f || !f.key) continue;
      const key = String(f.key);
      props[key] = cloneDefaultValue(f.defaultValue);
    }
  }

  return props;
}

function applyTreeAddElement(fileId, parentId, elementType) {
  const state = store.getState();
  const file = state.files.byId[fileId];
  if (!file) return;
  if (!canEditTreeForFile(file)) return;

  const pid = String(parentId || file.rootId || '');
  if (!pid) return;

  const type = String(elementType || '').trim().toLowerCase();
  if (!type) return;

  // Ensure the parent is expanded so the new node is immediately visible.
  getCollapsedMap(fileId)[pid] = false;

  const defaultProps = buildDefaultPropsForElementType(type);

  if (file.uiModel) {
    const result = addUiModelChild(file.uiModel, pid, type, defaultProps);
    if (!result || !result.newNodeId || !result.model || result.model === file.uiModel) return;

    const patch = buildScreenFilePatchFromModel(file, result.model);
    applyTreeEditPatch(fileId, patch, result.newNodeId);
    updateImportedPackOverridesIfNeeded(file, patch.modelOutputText, patch.sourceJson);
    return;
  }

  const result = addChildInNodeMap(file.nodesById || {}, file.rootId, pid, type, defaultProps);
  if (!result || !result.newNodeId) return;

  applyTreeEditPatch(fileId, { nodesById: result.nodesById, dirty: true }, result.newNodeId);
}
function applyTreeMoveByDelta(fileId, parentId, nodeId, delta) {
  const state = store.getState();
  const file = state.files.byId[fileId];
  if (!file) return;
  if (!canEditTreeForFile(file)) return;

  const parent = (file.nodesById || {})[String(parentId)];
  if (!parent || !Array.isArray(parent.children)) return;

  const idx = parent.children.findIndex((c) => String(c) === String(nodeId));
  if (idx < 0) return;

  const nextIndex = idx + Number(delta || 0);
  if (nextIndex < 0 || nextIndex > parent.children.length - 1) return;

  applyTreeReorder(fileId, parentId, nodeId, nextIndex);
}

function startTreeReorderDrag(e, { fileId, nodeId, parentId, fromIndex }) {
  try {
    if (!e || typeof e.preventDefault !== 'function') return;
    if (e.button != null && e.button !== 0) return;

    closeTreeContextMenu({ silent: true });

    const state = store.getState();
    const file = state.files.byId[fileId];
    if (!file) return;
    if (!canEditTreeForFile(file)) return;

    const handleEl = e.currentTarget;
    if (!handleEl || typeof handleEl.setPointerCapture !== 'function') return;

    treeUiState.drag.active = true;
    treeUiState.drag.fileId = String(fileId);
    treeUiState.drag.nodeId = String(nodeId);
    treeUiState.drag.parentId = String(parentId);
    treeUiState.drag.fromIndex = Number(fromIndex);
    treeUiState.drag.toIndex = null;
    treeUiState.drag.handleEl = handleEl;

    const indicator = document.createElement('div');
    indicator.className = 'tree-drop-indicator';
    indicator.id = 'tree-drop-indicator';
    indicator.style.display = 'none';
    document.body.appendChild(indicator);
    treeUiState.drag.indicatorEl = indicator;

    handleEl.setPointerCapture(e.pointerId);
    e.preventDefault();

    const onMove = (ev) => {
      if (!treeUiState.drag.active) return;

      const x = ev.clientX;
      const y = ev.clientY;
      const el = document.elementFromPoint(x, y);
      const row = el && el.closest ? el.closest('[data-tree-node-id]') : null;
      if (!row) {
        indicator.style.display = 'none';
        treeUiState.drag.toIndex = null;
        return;
      }

      const targetId = row.getAttribute('data-tree-node-id');
      const targetParentId = row.getAttribute('data-tree-parent-id');
      if (!targetId || !targetParentId) {
        indicator.style.display = 'none';
        treeUiState.drag.toIndex = null;
        return;
      }

      if (String(targetParentId) !== String(parentId)) {
        indicator.style.display = 'none';
        treeUiState.drag.toIndex = null;
        return;
      }

      if (String(targetId) === String(nodeId)) {
        indicator.style.display = 'none';
        treeUiState.drag.toIndex = null;
        return;
      }

      const rect = row.getBoundingClientRect();
      const before = y < rect.top + rect.height / 2;

      const currentState = store.getState();
      const currentFile = currentState.files.byId[fileId];
      const parentNode =
        (currentFile && currentFile.nodesById ? currentFile.nodesById[String(parentId)] : null) || null;
      const siblings = parentNode && Array.isArray(parentNode.children)
        ? parentNode.children.map(String)
        : [];

      const from = siblings.findIndex((c) => c === String(nodeId));
      const targetIndex = siblings.findIndex((c) => c === String(targetId));
      if (from < 0 || targetIndex < 0) {
        indicator.style.display = 'none';
        treeUiState.drag.toIndex = null;
        return;
      }

      let insertionIndex = before ? targetIndex : targetIndex + 1;
      if (insertionIndex > from) insertionIndex -= 1;
      insertionIndex = Math.max(0, Math.min(insertionIndex, Math.max(0, siblings.length - 1)));

      treeUiState.drag.toIndex = insertionIndex;

      const lineY = before ? rect.top : rect.bottom;
      indicator.style.display = 'block';
      indicator.style.left = `${rect.left}px`;
      indicator.style.width = `${rect.width}px`;
      indicator.style.top = `${Math.max(0, lineY - 1)}px`;
    };

    const onEnd = (ev) => {
      if (!treeUiState.drag.active) return;

      const toIndex = treeUiState.drag.toIndex;
      const fromIndexLocal = treeUiState.drag.fromIndex;

      treeUiState.drag.active = false;

      if (treeUiState.drag.indicatorEl) {
        treeUiState.drag.indicatorEl.remove();
      }
      treeUiState.drag.indicatorEl = null;

      try {
        if (handleEl && typeof handleEl.releasePointerCapture === 'function') {
          handleEl.releasePointerCapture(ev.pointerId);
        }
      } catch (_) {}

      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);

      treeUiState.drag.fileId = null;
      treeUiState.drag.nodeId = null;
      treeUiState.drag.parentId = null;
      treeUiState.drag.fromIndex = -1;
      treeUiState.drag.toIndex = null;
      treeUiState.drag.handleEl = null;

      if (ev.type !== 'pointercancel' && typeof toIndex === 'number' && toIndex !== fromIndexLocal) {
        applyTreeReorder(fileId, parentId, nodeId, toIndex);
      }
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd, { passive: true });
    window.addEventListener('pointercancel', onEnd, { passive: true });
  } catch (err) {
    diagnostics.captureError(err, {
      module: 'tree',
      where: 'startTreeReorderDrag',
    });
  }
}

/**
 * @param {import('./state-store/app-store.js').OpenFile} file
 * @param {string|null} selectedNodeId
 */
function renderTree(file, selectedNodeId, search = null) {
  const nodes = (file && file.nodesById) || {};
  const root = nodes[file.rootId];
  if (!root) {
    return h('div', { className: 'hint' }, 'No tree available.');
  }

  const fileId = file.id;
  const canEditTree = canEditTreeForFile(file);

  function formatNodeLabel(node) {
    const name = (node.props && (node.props.name || node.props.text)) || node.id;
    return `${node.type} (${name})`;
  }

  function renderContextMenu() {
    const menu = treeUiState.contextMenu;
    if (!menu.open) return null;
    if (String(menu.fileId) !== String(fileId)) return null;

    const node = nodes[menu.nodeId];
    if (!node) return null;

    const parentId = menu.parentId;
    const parentNode = parentId ? nodes[parentId] : null;
    const siblings = parentNode && Array.isArray(parentNode.children) ? parentNode.children.map(String) : [];
    const idx = parentId ? siblings.findIndex((c) => c === String(menu.nodeId)) : -1;

    const canMoveUp = canEditTree && parentId && idx > 0;
    const canMoveDown = canEditTree && parentId && idx >= 0 && idx < siblings.length - 1;
    const canDuplicate = canEditTree && String(menu.nodeId) !== String(file.rootId);
    const canDelete = canEditTree && String(menu.nodeId) !== String(file.rootId);

    return h(
      'div',
      null,
      h('div', {
        id: 'tree-context-overlay',
        className: 'tree-context-overlay',
        onClick: () => closeTreeContextMenu(),
        onContextmenu: (e) => {
          e.preventDefault();
          closeTreeContextMenu();
        },
      }),
      h(
        'div',
        {
          id: 'tree-context-menu',
          className: 'tree-context-menu',
          style: `left:${menu.x}px;top:${menu.y}px;`,
          role: 'menu',
          onClick: (e) => e.stopPropagation(),
          onKeydown: (e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              closeTreeContextMenu();
              return;
            }

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              const items = Array.from(e.currentTarget.querySelectorAll('button.tree-menu-item')).filter((el) => !el.disabled);
              if (!items.length) return;

              const active = document.activeElement;
              const idx = items.indexOf(active);

              let nextIdx = 0;
              if (e.key === 'ArrowDown') nextIdx = idx >= 0 ? (idx + 1) % items.length : 0;
              else if (e.key === 'ArrowUp') nextIdx = idx >= 0 ? (idx - 1 + items.length) % items.length : items.length - 1;
              else if (e.key === 'Home') nextIdx = 0;
              else if (e.key === 'End') nextIdx = items.length - 1;

              items[nextIdx].focus();
              return;
            }
          },
        },
        h('div', { className: 'tree-context-title' }, formatNodeLabel(node)),
        h(
          'button',
          {
            type: 'button',
            className: 'tree-menu-item',
            disabled: !canMoveUp,
            onClick: () => {
              if (!canMoveUp) return;
              applyTreeMoveByDelta(fileId, parentId, menu.nodeId, -1);
              closeTreeContextMenu();
            },
          },
          t('editor.tree.menu.moveUp')
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'tree-menu-item',
            disabled: !canMoveDown,
            onClick: () => {
              if (!canMoveDown) return;
              applyTreeMoveByDelta(fileId, parentId, menu.nodeId, 1);
              closeTreeContextMenu();
            },
          },
          t('editor.tree.menu.moveDown')
        ),
        h('div', { className: 'tree-context-sep' }),
        h(
          'button',
          {
            type: 'button',
            className: 'tree-menu-item',
            disabled: !canDuplicate,
            onClick: () => {
              if (!canDuplicate) return;
              applyTreeDuplicate(fileId, menu.nodeId);
              closeTreeContextMenu();
            },
          },
          t('editor.tree.menu.duplicate')
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'tree-menu-item danger',
            disabled: !canDelete,
            onClick: () => {
              if (!canDelete) return;
              applyTreeDelete(fileId, menu.nodeId);
              closeTreeContextMenu();
            },
          },
          t('editor.tree.menu.delete')
        )
      )
    );
  }

  function renderNode(nodeId, parentId) {
    const node = nodes[nodeId];
    if (!node) return null;

    const isSelected = selectedNodeId === node.id;
    const isMatch = Boolean(search && search.matchNodeIds && search.matchNodeIds.has(String(node.id)));
    const isActiveMatch = Boolean(search && search.activeNodeId && String(search.activeNodeId) === String(node.id));
    const itemClass =
      'tree-item-btn' +
      (isSelected ? ' selected' : '') +
      (isMatch ? ' search-match' : '') +
      (isActiveMatch ? ' search-active' : '');
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const collapsed = hasChildren ? isTreeNodeCollapsed(fileId, node.id, nodes) : false;

    const label = formatNodeLabel(node);

    const parentNode = parentId ? nodes[parentId] : null;
    const siblings = parentNode && Array.isArray(parentNode.children) ? parentNode.children.map(String) : [];
    const fromIndex = parentId ? siblings.findIndex((c) => c === String(nodeId)) : -1;

    const disclosure = hasChildren
      ? h(
          'button',
          {
            type: 'button',
            className: 'tree-disclosure',
            title: collapsed ? t('editor.tree.expand') : t('editor.tree.collapse'),
            'aria-label': collapsed ? t('editor.tree.expand') : t('editor.tree.collapse'),
            onClick: (e) => {
              e.stopPropagation();
              toggleTreeNodeCollapsed(fileId, node.id, nodes);
            },
          },
          collapsed ? '▶' : '▼'
        )
      : h('span', { className: 'tree-disclosure-spacer', 'aria-hidden': 'true' }, '');

    const dragHandle = canEditTree && parentId && siblings.length > 1
      ? h(
          'button',
          {
            type: 'button',
            className: 'tree-drag-handle',
            title: t('editor.tree.dragToReorder'),
            'aria-label': t('editor.tree.dragToReorder'),
            onPointerdown: (e) => {
              e.stopPropagation();
              startTreeReorderDrag(e, { fileId, nodeId: node.id, parentId, fromIndex });
            },
          },
          '↕'
        )
      : h('span', { className: 'tree-drag-spacer', 'aria-hidden': 'true' }, '');

    const itemButton = h(
      'button',
      {
        type: 'button',
        id: makeTreeDomId('tree-item-btn', fileId, node.id),
        className: itemClass,
        onClick: () => {
          closeTreeContextMenu({ silent: true });
          store.dispatch(actions.selectNode(node.id));
        },
        onContextmenu: (e) => {
          e.preventDefault();
          e.stopPropagation();
          openTreeContextMenu({
            fileId,
            nodeId: node.id,
            parentId,
            x: e.clientX,
            y: e.clientY,
            restoreFocusId: e.currentTarget && e.currentTarget.id,
          });
        },
        onKeydown: (e) => {
          if (e.key === 'ArrowLeft' && hasChildren && !collapsed) {
            e.preventDefault();
            toggleTreeNodeCollapsed(fileId, node.id, nodes);
          } else if (e.key === 'ArrowRight' && hasChildren && collapsed) {
            e.preventDefault();
            toggleTreeNodeCollapsed(fileId, node.id, nodes);
          } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            openTreeContextMenu({
              fileId,
              nodeId: node.id,
              parentId,
              x: rect.left,
              y: rect.bottom,
              restoreFocusId: e.currentTarget && e.currentTarget.id,
            });
          }
        },
      },
      label
    );

    const menuButton = h(
      'button',
      {
        type: 'button',
        id: makeTreeDomId('tree-menu-btn', fileId, node.id),
        className: 'tree-menu-btn',
        title: t('editor.tree.menu.open'),
        'aria-label': t('editor.tree.menu.open'),
        onClick: (e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          openTreeContextMenu({
            fileId,
            nodeId: node.id,
            parentId,
            x: rect.left,
            y: rect.bottom,
            restoreFocusId: e.currentTarget && e.currentTarget.id,
          });
        },
      },
      '⋯'
    );

    const children =
      hasChildren && !collapsed
        ? h(
            'ul',
            { className: 'tree-list', role: 'group' },
            ...(node.children.map((cid) => renderNode(cid, node.id)).filter(Boolean))
          )
        : null;

    return h(
      'li',
      {
        className: 'tree-node',
        role: 'treeitem',
        'aria-selected': isSelected ? 'true' : null,
        'aria-expanded': hasChildren ? String(!collapsed) : null,
      },
      h(
        'div',
        {
          className: 'tree-row',
          'data-tree-node-id': node.id,
          'data-tree-parent-id': parentId || '',
        },
        disclosure,
        dragHandle,
        itemButton,
        menuButton
      ),
      children
    );
  }

  return h(
    'div',
    { className: 'tree-wrapper' },
    h(
      'ul',
      { className: 'tree-list', role: 'tree', 'aria-label': 'UI tree' },
      renderNode(file.rootId, null)
    ),
    renderContextMenu()
  );
}

/**
 * @param {import('./state-store/app-store.js').AppState} state
 */
function renderEditorPropertiesPanel(state) {
  const fileId = state.files.currentFileId;
  const file = fileId ? state.files.byId[fileId] : null;
  const nodeId = state.editor.selection.nodeId;
  const node = file && nodeId ? file.nodesById[String(nodeId)] : null;
  const isReadOnly = Boolean(file && file.readOnly);
  const canEditTree = canEditTreeForFile(file);

  function elementTypeLabel(type) {
    const rawType = String(type || '');
    const label = t(`elementType.${rawType}`);
    return label.startsWith('⟦MISSING:') ? rawType : label;
  }

  /**
   * Render a simple element palette (add-new-element buttons).
   * @param {{ targetId: string, targetLabel: string }} opts
   */
  function renderElementPaletteSection(opts) {
    const targetId = String(opts?.targetId || '');
    const targetLabel = String(opts?.targetLabel || '');
    if (!targetId) return '';

    const disabled = !canEditTree;

    const btnEls = SUPPORTED_UI_ELEMENT_TYPES.map((et) =>
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small element-palette-btn',
          disabled,
          onClick: () => applyTreeAddElement(fileId, targetId, et),
        },
        [elementTypeLabel(et)]
      )
    );

    return h('div', { class: 'element-crud-section' }, [
      h('div', { class: 'element-crud-title' }, [t('editor.elementPalette.title')]),
      h('div', { class: 'element-crud-target' }, [t('editor.elementPalette.addTo', { target: targetLabel })]),
      h('div', { class: 'element-palette' }, btnEls),
      h('div', { class: 'hint element-palette-hint' }, [
        disabled ? t('editor.elementPalette.disabledHint') : t('editor.elementPalette.hint'),
      ]),
    ]);
  }

  const debugToggle = h('label', { class: 'props-debug' }, [
    h('input', {
      type: 'checkbox',
      checked: state.ui.debug ? 'checked' : null,
      onChange: () => store.dispatch(actions.toggleDebug()),
    }),
    ` ${t('editor.properties.debugLog')}`,
  ]);

  /**
   * @param {any} v
   */
  function dimToString(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string') return v;
    return '';
  }

  /**
   * @param {any} v
   * @param {any} fallback
   */
  function readDim2(v, fallback) {
    const fv = Array.isArray(v) && v.length >= 2 ? v : null;
    const fb = Array.isArray(fallback) && fallback.length >= 2 ? fallback : [0, 0];
    return [fv ? fv[0] : fb[0], fv ? fv[1] : fb[1]];
  }

  /**
   * @param {string} raw
   * @param {any} fallback
   * @param {number|undefined} min
   * @param {number|undefined} max
   */
  function parseDim(raw, fallback, min, max) {
    const s = String(raw || '').trim();
    if (!s) return fallback;

    // Treat strictly numeric strings as numbers (px). Everything else stays as a string
    // (e.g. "75%", "100% - 4px", "fill", "default").
    if (/^-?\d+(?:\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return fallback;
      let v = n;
      if (typeof min === 'number') v = Math.max(min, v);
      if (typeof max === 'number') v = Math.min(max, v);
      return v;
    }

    return s;
  }

  /**
   * Apply a props patch to the currently open file.
   *
   * - For imported screen files (UiScreenModel), we patch the model so Raw JSON stays in sync.
   * - For stub-only files, we patch nodesById directly.
   *
   * @param {Record<string, any>} propPatch
   */
  function applyPropsPatch(propPatch) {
    if (!file || !fileId || isReadOnly) return;
    if (!nodeId) return;

    if (file.uiModel) {
      const nextModel = updateUiModelNodeProps(file.uiModel, String(nodeId), propPatch);
      const patch = buildScreenFilePatchFromModel(file, nextModel);
      store.dispatch(actions.patchFile({ fileId, patch }));
      updateImportedPackOverridesIfNeeded(file, patch.modelOutputText, patch.sourceJson);
      return;
    }

    const nodesById = file.nodesById ? file.nodesById : {};
    const oldNode = nodesById[String(nodeId)];
    if (!oldNode) return;
    const nextNode = { ...oldNode, props: { ...(oldNode.props || {}), ...propPatch } };
    const nextNodesById = { ...nodesById, [String(nodeId)]: nextNode };

    store.dispatch(
      actions.patchFile({
        fileId,
        patch: {
          dirty: true,
          nodesById: nextNodesById,
        },
      })
    );
  }

  if (!file) {
    return h('div', { id: 'properties-root' }, [
      t('editor.properties.noFile'),
      h('div', { class: 'hint' }, [t('editor.properties.openFileHint')]),
      debugToggle,
    ]);
  }

  if (!node) {
    return h('div', { id: 'properties-root' }, [
      t('editor.properties.currentFile', { path: `${file.path}${file.dirty ? ' *' : ''}` }),
      h('div', { class: 'hint' }, [
        isReadOnly
          ? t('editor.properties.selectNodeReadOnly')
          : t('editor.properties.selectNodeEditable'),
      ]),
      renderElementPaletteSection({ targetId: String(file.rootId), targetLabel: t('editor.elementPalette.target.root') }),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: () => store.dispatch(actions.clearSelection()),
          disabled: state.editor.selection.nodeId ? null : 'disabled',
        },
        [t('editor.properties.clearSelection')]
      ),
      debugToggle,
    ]);
  }

  const groups = getEditablePropertyGroupsForType(node.type);
  const editableKeys = getEditablePropertyKeysForType(node.type);
  const props = node.props || {};

  const groupEls = [];

  for (const g of groups) {
    groupEls.push(h('div', { class: 'props-group-title' }, [g.title]));

    for (const f of g.fields) {
      const key = String(f.key);

      if (f.kind === 'dim2') {
        const cur = readDim2(props[key], f.defaultValue);
        const axisLabels = Array.isArray(f.axisLabels) && f.axisLabels.length >= 2 ? f.axisLabels : ['X', 'Y'];

        const onAxisChange = (axisIndex, raw) => {
          const base = readDim2((store.getState().files.byId[fileId]?.nodesById?.[String(nodeId)]?.props || {})[key], f.defaultValue);
          const fallbackAxis = base[axisIndex];
          const nextAxis = parseDim(raw, fallbackAxis, f.min, f.max);
          const next = axisIndex === 0 ? [nextAxis, base[1]] : [base[0], nextAxis];
          applyPropsPatch({ [key]: next });
        };

        groupEls.push(
          h('div', { class: 'props-row' }, [
            h('label', { class: 'props-label' }, [f.label]),
            h('div', { class: 'props-dim2' }, [
              h('input', {
                class: 'props-input',
                type: 'text',
                value: dimToString(cur[0]),
                disabled: isReadOnly ? 'disabled' : null,
                title: axisLabels[0],
                'aria-label': `${f.label} ${axisLabels[0]}`,
                onChange: (e) => {
                  const t = e.currentTarget;
                  if (!(t instanceof HTMLInputElement)) return;
                  onAxisChange(0, t.value);
                },
              }),
              h('input', {
                class: 'props-input',
                type: 'text',
                value: dimToString(cur[1]),
                disabled: isReadOnly ? 'disabled' : null,
                title: axisLabels[1],
                'aria-label': `${f.label} ${axisLabels[1]}`,
                onChange: (e) => {
                  const t = e.currentTarget;
                  if (!(t instanceof HTMLInputElement)) return;
                  onAxisChange(1, t.value);
                },
              }),
            ]),
          ])
        );
        continue;
      }

      if (f.kind === 'boolean') {
        const cur = typeof props[key] === 'boolean' ? props[key] : Boolean(f.defaultValue);
        groupEls.push(
          h('div', { class: 'props-row' }, [
            h('label', { class: 'props-label' }, [f.label]),
            h('input', {
              class: 'props-input',
              type: 'checkbox',
              checked: cur ? 'checked' : null,
              disabled: isReadOnly ? 'disabled' : null,
              onChange: (e) => {
                const t = e.currentTarget;
                if (!(t instanceof HTMLInputElement)) return;
                applyPropsPatch({ [key]: Boolean(t.checked) });
              },
            }),
          ])
        );
        continue;
      }

      if (f.kind === 'enum') {
        const options = Array.isArray(f.options) ? f.options.map(String) : [];
        const rawCur = props[key];
        const cur = typeof rawCur === 'string' && rawCur ? rawCur : String(f.defaultValue || '');
        const effectiveOptions = options.includes(cur) ? options : [cur, ...options];
        const deduped = Array.from(new Set(effectiveOptions));

        groupEls.push(
          h('div', { class: 'props-row' }, [
            h('label', { class: 'props-label' }, [f.label]),
            h(
              'select',
              {
                class: 'props-input',
                disabled: isReadOnly ? 'disabled' : null,
                value: cur,
                onChange: (e) => {
                  const t = e.currentTarget;
                  if (!(t instanceof HTMLSelectElement)) return;
                  applyPropsPatch({ [key]: String(t.value) });
                },
              },
              deduped.map((opt) => h('option', { value: opt }, [opt]))
            ),
          ])
        );
        continue;
      }

      // string
      const cur = typeof props[key] === 'string' ? props[key] : String(f.defaultValue || '');
      groupEls.push(
        h('div', { class: 'props-row' }, [
          h('label', { class: 'props-label' }, [f.label]),
          h('input', {
            class: 'props-input',
            type: 'text',
            value: cur,
            disabled: isReadOnly ? 'disabled' : null,
            onChange: (e) => {
              const t = e.currentTarget;
              if (!(t instanceof HTMLInputElement)) return;
              applyPropsPatch({ [key]: String(t.value) });
            },
          }),
        ])
      );
    }
  }

  // Show additional props that exist on this node but are not covered by the
  // minimal schema (read-only; useful for debugging without expanding scope).
  const otherKeys = Object.keys(props)
    .filter((k) => k !== 'name' && !editableKeys.has(String(k)))
    .sort();
  const otherProps = otherKeys.length
    ? h('details', { class: 'props-other' }, [
        h('summary', { class: 'props-other-title' }, [
          t('editor.properties.otherProperties', { count: otherKeys.length }),
        ]),
        ...otherKeys.map((k) =>
          h('div', { class: 'props-row' }, [
            h('label', { class: 'props-label' }, [k]),
            h('input', {
              class: 'props-input',
              type: 'text',
              value: (() => {
                try {
                  const v = props[k];
                  if (typeof v === 'string') return v;
                  return JSON.stringify(v);
                } catch {
                  return String(props[k]);
                }
              })(),
              disabled: 'disabled',
            }),
          ])
        ),
      ])
    : '';

  const hint = isReadOnly
    ? t('editor.properties.readOnlyHint')
    : file.uiModel
      ? t('editor.properties.modelEditHint')
      : t('editor.properties.stubEditHint');

  const nodeDisplayName = String((node.props && (node.props.name || node.props.text)) || node.id);
  const isRootNode = String(node.id) === String(file.rootId);
  const disableStructureOps = !canEditTree || isRootNode;

  const elementActionsSection = h('div', { class: 'element-crud-section' }, [
    h('div', { class: 'element-crud-title' }, [t('editor.elementActions.title')]),
    h('div', { class: 'element-crud-actions' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small',
          disabled: disableStructureOps ? 'disabled' : null,
          onClick: () => applyTreeDuplicate(fileId, String(node.id)),
        },
        [t('editor.elementActions.duplicate')]
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small',
          disabled: disableStructureOps ? 'disabled' : null,
          onClick: () => applyTreeDelete(fileId, String(node.id)),
        },
        [t('editor.elementActions.delete')]
      ),
    ]),
    h('div', { class: 'hint element-crud-hint' }, [
      isRootNode ? t('editor.elementActions.rootDisabledHint') : t('editor.elementActions.hint'),
    ]),
  ]);

  const elementPaletteSection = renderElementPaletteSection({
    targetId: String(node.id),
    targetLabel: nodeDisplayName,
  });


  return h('div', { id: 'properties-root' }, [
    h('div', { class: 'props-title' }, [`${node.type} (${node.id})`]),
    h('div', { class: 'hint' }, [hint]),
    ...groupEls,
    otherProps,
    elementActionsSection,
    elementPaletteSection,
    h('div', { class: 'props-actions' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: () => store.dispatch(actions.clearSelection()),
        },
        [t('editor.properties.clearSelection')]
      ),
    ]),
    debugToggle,
  ]);
}

function renderHelp() {
  const loc = i18n.getLocale();
  const isJa = loc === 'ja_JP';

  const userGuideHref = editorResourceUrl(isJa
    ? '../docs/user_guide_ja.md'
    : '../docs/user_guide_en.md');

  const body = [];
  body.push(
    h('p', {}, [t('help.intro')]),
    h('p', { class: 'hint' }, [t('help.introHint')]),
  );

  body.push(
    h('h3', {}, [t('help.quickStart.title')]),
    h('ol', {}, [
      h('li', {}, [siteText('start.bat で起動し、左の「1 · パックを読み込む」で ZIP または MCPACK を選びます。')]),
      h('li', {}, [siteText('左の一覧でファイルと UI 定義を選び、「3 · 選択したUIをプレビュー」を押します。同じファイルの定義も個別に選べます。')]),
      h('li', {}, [siteText('上の「編集」に切り替え、要素を移動・配置します。プレビューは自動更新され、原文への確定は「JSON UIに確定」で行います。')]),
      h('li', {}, [siteText('「書き出し」で現在の UI を追加し、依存範囲を検査してリソースパックを保存します。')]),
    ]),
  );

  body.push(
    h('div', { class: 'workspace-help-cards' }, [
      h('div', { class: 'workspace-help-card' }, [
        h('strong', {}, [siteText('画像と操作位置を一緒に動かす')]),
        h('p', {}, [siteText('編集モードの初期設定は「この UI だけ」「見た目の部品だけ」です。動作も一緒に移動する場合は「操作要素全体」を選び、右のプロパティで変更先と影響範囲を確認します。スロットなど同じテンプレートを使う複数要素は、範囲を確認してから移動します。他の UI も変更したい場合は「共有元を編集」を選びます。')]),
      ]),
      h('div', { class: 'workspace-help-card' }, [
        h('strong', {}, [siteText('画面の拡大とGUIスケールの違い')]),
        h('p', {}, [siteText('拡大・縮小は確認画面の見せ方を変えます。GUIスケールや端末プリセットはUIの配置条件を変えます。実機と比べるときは、画面サイズ・GUIスケール・UIの状態・リソースパックの版を揃えてください。')]),
      ]),
      h('div', { class: 'workspace-help-card' }, [
        h('strong', {}, [siteText('文字・素材・3Dの欠落を確認する')]),
        h('p', {}, [siteText('背景が表示されても、文字やアイテム素材が揃っているとは限りません。「欠落している素材・参照を確認」で不足を調べ、必要なバニラ参照を追加します。実行時にゲームから渡される値は代表状態を含み、実機一致の確認とは分けて表示します。')]),
      ]),
      h('div', { class: 'workspace-help-card' }, [
        h('strong', {}, [siteText('大きなパックを読み込むとき')]),
        h('p', {}, [siteText('起動 BAT が開いた画面で ZIP または MCPACK を選びます。展開・解釈などはローカルの Node で処理し、読み込み中はキャンセルできます。MCADDON は非対応です。Pocket は読み込み・索引の対象ですがプレビューできません。')]),
      ]),
      h('div', { class: 'workspace-help-card' }, [
        h('strong', {}, [siteText('最大化と詳細ツール')]),
        h('p', {}, [siteText('最大化中も上端の「タブ・コマンド」から操作できます。マウスを上端へ移すか F6 を押して表示し、「コマンドを固定」で常時表示、Esc で終了します。要素ツリーは「ホーム」→「詳細ツール」にあります。')]),
      ]),
      h('div', { class: 'workspace-help-card' }, [
        h('strong', {}, [siteText('コマンドモード')]),
        h('p', {}, [siteText('アプリのフォルダーで端末を開き、次のコマンドで一覧を確認できます。ブラウザの編集中状態とは別のセッションを使います。操作例とセッション保存方法は同梱の local-node/CLI-ja.md を参照してください。')]),
        h('pre', { class: 'code' }, ['node .\\local-node\\cli.mjs help']),
        h('p', { class: 'hint' }, [siteText('node が見つからない場合は、start.bat で準備された .\\.jsonui\\runtime\\node.exe を使用できます。')]),
      ]),
      h('div', { class: 'workspace-help-card' }, [
        h('strong', {}, [siteText('作業を閉じる前に')]),
        h('p', {}, [siteText('編集内容や開いたパックはページを再読み込みすると失われます。必要な変更は「JSON UIに確定」で確定し、「書き出し」タブから保存してください。グループ設定は「編集」→「グループ設定」で別に保存できます。問題を相談するときは「診断」→「ログを一括保存」を使います。')]),
      ]),
    ]),
    h('h3', {}, [siteText('キーボード操作')]),
    h('table', { class: 'workspace-shortcuts' }, [
      h('thead', {}, [h('tr', {}, [h('th', { scope: 'col' }, [siteText('キー')]), h('th', { scope: 'col' }, [siteText('操作')])])]),
      h('tbody', {}, [
        ['Ctrl+K / ⌘K', siteText('ファイル検索へ移動（閉じた左パネルも開く）')],
        ['Ctrl+F / ⌘F', siteText('開いたUI内の要素を検索')],
        ['Enter / ↓', siteText('ファイル・定義の検索欄から一覧へ移動')],
        ['Esc', siteText('通常表示のファイル・定義検索欄で検索条件を解除')],
        ['Ctrl+Alt+1 / ⌘⌥1', siteText('左パネルを表示・非表示')],
        ['Ctrl+Alt+2 / ⌘⌥2', siteText('右の詳細パネルを表示・非表示')],
        ['F6', siteText('最大化中にコマンドとキャンバスのフォーカスを切り替え')],
        ['Esc', siteText('最大化を終了（プレビューの文字入力欄・IME 変換中を除く）')],
        ['Shift+F10 / Menu', siteText('キャンバスで選択要素の操作メニューを開く')],
        ['Ctrl+Alt+G / Ctrl+Alt+Shift+G', siteText('編集領域でグループ化・解除（文字入力中は除外）')],
        ['Ctrl+Enter / ⌘Enter', siteText('キャンバスの編集モードで未確定変更を JSON UI に確定')],
      ].map(([key, description]) => h('tr', {}, [h('td', {}, [h('kbd', {}, [key])]), h('td', {}, [description])]))),
    ]),
  );

  body.push(
    h('h3', { style: 'margin-top: 14px;' }, [t('help.docs.title')]),
    h('ul', {}, [
      h('li', {}, [
        h('a', { href: userGuideHref, target: '_blank', rel: 'noopener noreferrer' }, [t('help.docs.userGuide')]),
      ]),
      h('li', {}, [h('a', { href: editorResourceUrl('../docs/EDITOR-STUDIO-26-JA.md'), target: '_blank', rel: 'noopener noreferrer' }, ['編集画面の使い方・ロック・重なり・進捗表示'])]),
      h('li', {}, [
        h('a', {
          href: editorResourceUrl('../docs/DEMO_SCENARIOS.md'),
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [t('help.docs.demoScenarios')]),
      ]),
      h('li', {}, [
        h('a', {
          href: editorResourceUrl('../docs/ACCEPTANCE_CHECKLIST.md'),
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [t('help.docs.acceptanceChecklist')]),
      ]),
    ]),
  );

  body.push(
    h('h3', { style: 'margin-top: 14px;' }, [t('help.troubleshooting.title')]),
    h('ul', {}, [
      h('li', {}, [t('help.troubleshooting.preview')]),
      h('li', {}, [t('help.troubleshooting.vanillaWarnings')]),
      h('li', {}, [t('help.troubleshooting.mobile')]),
    ]),
  );

  return renderPanel(t('route.help'), body, { className: 'workspace-help' });
}

function renderNotFound(route) {
  return h("div", { class: "layout3" }, [
    renderPanel("Not found", [
      h("p", {}, [`Unknown route: ${route}`]),
      h("p", {}, ["Try:", h("span", { class: "code" }, [" #/editor "])]),
    ]),
    renderPanel("", []),
    renderPanel("", []),
  ]);
}

/* --- S020: error boundary + render wiring ------------------------------ */

let isRendering = false;
let workspaceRenderDeferred = false;
function flushDeferredWorkspaceRender() {
  if (!workspaceRenderDeferred) return;
  workspaceRenderDeferred = false;
  safeRender();
}
const previewPerformance = createPreviewPerformanceMetrics();
const scheduledWorkspaceRender = createFrameCoalescer(requestAnimationFrame, cancelAnimationFrame, () => safeRender());
const scheduledPreviewDataRender = createFrameCoalescer(requestAnimationFrame, cancelAnimationFrame, () => {
  const state = store.getState();
  if (state.ui?.route !== 'editor') return;
  ensurePreviewLayout(state);
  requestCanvasTextureRedraw();
  const message = document.getElementById('preview-state-message');
  if (message) { message.textContent = runtimeStateEditor.message; message.classList.toggle('is-dirty', Boolean(runtimeStateEditor.dirty)); }
  document.querySelector('.runtime-input-editor')?.refreshRuntimeInputs?.();
  document.querySelector('.ui-data-editor')?.refreshUiData?.();
});

/**
 * Render with a simple error boundary.
 * - Captures exceptions to the diagnostics store.
 * - Shows a minimal fallback UI instead of a blank screen.
 */
function safeRender() {
  if (isRendering) return;
  const currentState = store.getState();
  const currentFile = currentState.files.byId[currentState.files.currentFileId];
  const currentInteraction = getCanvasState(getCanvasKey(currentFile?.id)).interaction;
  if (getRoute() === 'editor' && shouldDeferWorkspaceCanvasRender({ mode: sourceWorkspace.state.mode,
    blocked: sourceWorkspace.previewBlocked(), file: currentFile, interaction: currentInteraction })) {
    workspaceRenderDeferred = true;
    return;
  }
  workspaceRenderDeferred = false;
  isRendering = true;
  scheduledWorkspaceRender.cancel();
  const renderStarted = performance.now();
  // Full UI is currently rebuilt on store changes. Restore a named control's
  // focus/caret so search, editing, and selection remain keyboard accessible.
  const previousFocus = document.activeElement;
  const focusId = previousFocus?.id || '';
  const selectionStart = previousFocus instanceof HTMLInputElement || previousFocus instanceof HTMLTextAreaElement
    ? previousFocus.selectionStart : null;
  const selectionEnd = previousFocus instanceof HTMLInputElement || previousFocus instanceof HTMLTextAreaElement
    ? previousFocus.selectionEnd : null;
  try {
    render();
  } catch (err) {
    diagnostics.captureError(err, { source: 'render', message: 'Render crashed' });
    try {
      if (routeRoot) {
        const msg = err instanceof Error
          ? `${err.name}: ${err.message}`
          : String(err || 'Unknown error');

        routeRoot.replaceChildren(
          h('div', { class: 'layout3' }, [
            renderPanel('Render error', [
              h('p', {}, [t('logs.renderErrorHint')]),
              h('p', { class: 'hint' }, [msg]),
              h('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;' }, [
                h('button', { type: 'button', class: 'btn', onClick: () => { window.location.hash = '#/logs'; } }, [t('nav.logs')]),
                h('button', { type: 'button', class: 'btn', onClick: () => { window.location.reload(); } }, ['Reload']),
              ]),
            ]),
            renderPanel('', []),
            renderPanel('', []),
          ])
        );
      }
    } catch {
      // ignore
    }
    try {
      setStatus(t('logs.renderErrorStatus'));
    } catch {
      // ignore
    }
  } finally {
    previewPerformance.record('dom', performance.now() - renderStarted);
    isRendering = false;
    if (focusId && previousFocus && !previousFocus.isConnected
      && (!document.activeElement || document.activeElement === document.body)) {
      const nextFocus = document.getElementById(focusId);
      if (nextFocus && !nextFocus.disabled) {
        try {
          nextFocus.focus({ preventScroll: true });
          if (selectionStart !== null && selectionEnd !== null && typeof nextFocus.setSelectionRange === 'function') {
            nextFocus.setSelectionRange(selectionStart, selectionEnd);
          }
        } catch {
          // Selection ranges are not supported by every input type.
        }
      }
    }
  }
}

function setupLanguageToggle() {
  const btn = document.getElementById('btn-lang');
  if (!btn) return;

  btn.disabled = false;

  btn.addEventListener('click', async () => {
    const cur = i18n.getLocale();
    const next = cur === 'ja_JP' ? 'en_US' : 'ja_JP';
    btn.disabled = true;
    try {
      await i18n.setLocale(next);
      applyI18nToStaticDom();
      safeRender();
    } catch (error) {
      reportWorkspaceError(error);
    } finally {
      btn.disabled = false;
    }
  });
}

function startApp() {
  // Keep the dedicated logs route live without interrupting editor inputs on
  // every debug entry emitted by the renderer.
  diagnostics.events.on('change', () => {
    if (getRoute() === 'logs') scheduledWorkspaceRender.request();
    else {
      // Update the small summary without disrupting Canvas or focused input.
      const link = document.getElementById('workspace-diagnostic-summary');
      if (link) {
        const counts = diagnostics.getCounts();
        link.textContent = siteText`ログ: エラー ${counts.error} / 警告 ${counts.warn}`;
        link.classList.toggle('has-errors', counts.error > 0);
        link.classList.toggle('has-warnings', !counts.error && counts.warn > 0);
      }
    }
  });

  // Keep status text helpful for captured errors.
  diagnostics.events.on('entry', (entry) => {
    if (!entry || entry.level !== 'error') return;
    setStatus(t('logs.errorCaptured', { message: entry.message }));
  });

  window.addEventListener('hashchange', () => {
    syncRouteToStore();
    safeRender();
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) { previewPlayback.pause(); stopNativeMotionPreview(); } else startNativeMotionPreview(); });
  window.addEventListener('pagehide', () => { suspendReferenceContextRevalidation(); previewPlayback.pause(); stopNativeMotionPreview(); scheduledWorkspaceRender.cancel(); scheduledPreviewDataRender.cancel(); });
  window.addEventListener('pageshow', event => { if (event?.persisted) resumeReferenceContextRevalidation(); });
  if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) previewPerformance.record('longtask', entry.duration); });
    observer.observe({ type: 'longtask', buffered: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  // Global keyboard shortcuts (S038)
  installGlobalKeyboardShortcuts();

  // Keep the canvas crisp on resize (no full re-render; redraw only).
  window.addEventListener('resize', () => {
    const s = store.getState();
    const activeCenterTab = s.ui?.tabs?.center || 'preview';
    if (activeCenterTab !== 'canvas') return;

    const fileId = s.files.currentFileId;
    const key = getCanvasKey(fileId);
    requestAnimationFrame(() => drawCanvasNow(key));
  });

  // Selection and debug toggles do not rebuild the full resource tree/canvas.
  store.subscribe((next, previous, action) => {
    if (previewAudioPlayer) {
      if (next.preview?.navigation?.enabled !== previous.preview?.navigation?.enabled) previewAudioPreparation = null;
      previewAudioPlayer.setEnabled(previewAudioEnabled && next.preview?.navigation?.enabled === true);
      if (next.pack !== previous.pack) syncPreviewAudioPack();
      if (action?.type !== 'preview/navCommit' && (next.files?.currentFileId !== previous.files?.currentFileId
        || next.ui?.tabs?.center !== previous.ui?.tabs?.center
        || next.files?.byId?.[next.files?.currentFileId]?.uiModel !== previous.files?.byId?.[previous.files?.currentFileId]?.uiModel)) {
        invalidatePreviewAudioForNavigation();
      }
    }
    const change = classifyPreviewStoreChange(next, previous, action, { detailed: workspaceNavigationState.detailedEditor });
    if (change === 'canvas') requestCanvasTextureRedraw();
    else if (change === 'data') scheduledPreviewDataRender.request();
    else if (change === 'full') scheduledWorkspaceRender.request();
  });

  window.addEventListener('blur', () => {
    const fileId = store.getState().files.currentFileId;
    const cs = getCanvasState(getCanvasKey(fileId));
    if (cs.interaction?.sourceFile || cs.interaction?.pendingAdditionDrag23) { cancelPreviewPointerInteraction(getCanvasKey(fileId)); flushDeferredWorkspaceRender(); }
  });
  window.addEventListener('pagehide', () => previewAudioPlayer?.invalidate({ reason: 'pagehide' }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) previewAudioPlayer?.invalidate({ reason: 'hidden' });
  });

  // Debug logging (toggleable in the Properties panel).
  store.events.on('action', ({ action, prev, next }) => {
    const actionType = String(action?.type || '');
    if (actionType === 'preview/setMockData') {
      markPreviewContextMutation();
      const beforeComposition = pickResolverCompositionData(prev?.preview?.mockData);
      const afterComposition = pickResolverCompositionData(next?.preview?.mockData);
      if (serializeMockDataForCompare(beforeComposition) !== serializeMockDataForCompare(afterComposition)) {
        scheduleProjectionRefreshAfterMockChange();
      } else {
        // `#...` binding values do not change the resolved JSON shape, but
        // they can change concrete texture/font/text dependencies consumed by
        // the canvas. Keep References/Validation in sync with those pixels.
        scheduleReferenceContextRevalidation();
      }
    }
    if (actionType === 'ui/setPreviewLocale'
      && String(prev?.ui?.previewLocale || '') !== String(next?.ui?.previewLocale || '')) {
      markPreviewContextMutation();
    }
    if (actionType === 'ui/setPreviewFontProfile' && prev?.ui?.previewFontProfile !== next?.ui?.previewFontProfile) {
      bitmapFontCache.clear(); bitmapTextLayoutCache.clear(); bitmapFontNotices.clear();
      markPreviewContextMutation();
      requestCanvasTextureMetadataRefresh();
    }

    // Keep a bounded in-memory list for the Debug tab.
    actionHistory28.record({
      type: String(action?.type || ''),
      summary: summarizeAction(action),
    });


    if (next.ui.debug) {
      // eslint-disable-next-line no-console
      console.log('[store]', action.type, action);

      // Record minimal action info to diagnostics (bounded buffer).
      try {
        diagnostics.log('debug', `action: ${String(action?.type || '')}`, {
          source: 'store',
          data: { summary: summarizeAction(action) },
        });
      } catch {
        // ignore
      }
    }
  });

  // Initial render.
  syncRouteToStore();
  safeRender();
}

const STARTUP_STATE_PROPERTY = '__JSONUI_PREVIEW_STUDIO_STARTUP__';
const STARTUP_STATE_EVENT = 'jsonui-preview-studio-startup';

/** @param {'loading'|'ready'|'error'} status */
function publishStartupState(status) {
  const detail = Object.freeze({
    status,
    error: status === 'error' ? 'STARTUP_FAILED' : null,
  });
  try {
    Object.defineProperty(globalThis, STARTUP_STATE_PROPERTY, {
      value: detail,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  } catch {
    // The DOM marker/event below remain observable if a host locks this name.
  }
  try {
    document.documentElement?.setAttribute('data-jsonui-startup', status);
  } catch {
    // A partial host document must not hide the original startup result.
  }
  try {
    globalThis.dispatchEvent(new CustomEvent(STARTUP_STATE_EVENT, { detail }));
  } catch {
    // CustomEvent is optional in non-browser smoke harnesses.
  }
}

// Initialize i18n first to avoid a "missing key" flash in translated UI labels.
publishStartupState('loading');
void (async () => {
  try {
    await i18n.init();
  } catch (err) {
    diagnostics.captureError(err, {
      source: 'i18n',
      message: 'i18n init failed (continuing with placeholders)',
    });
  }

  // Best-effort: restore the user's preview text language preference.
  try {
    const stored = safeReadStoredPreviewLocale();
    if (stored) store.dispatch(actions.setPreviewLocale(stored));
  } catch {
    // ignore
  }

  setupLanguageToggle();
  applyI18nToStaticDom();
  startApp();
  // 実処理の状態だけを監視する。DOM全体の再生成や解釈処理は起動しない。
  studioProgressTimer26 = setInterval(syncStudioProgress26, 1000);
  window.addEventListener('pagehide', () => { clearInterval(studioProgressTimer26); studioProgressTimer26 = null; });
  window.addEventListener('pageshow', () => { if (!studioProgressTimer26) studioProgressTimer26 = setInterval(syncStudioProgress26, 1000); });
  publishStartupState('ready');
})().catch((err) => {
  try {
    diagnostics.captureError(err, {
      source: 'startup',
      message: 'Application startup failed',
    });
  } catch {
    // Preserve the externally observable error state even if diagnostics fail.
  }
  try {
    setStatus('Application startup failed. Open logs for details.');
  } catch {
    // The state marker/event below are the final fallback for production smoke.
  }
  publishStartupState('error');
});
