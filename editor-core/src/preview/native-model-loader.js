// Shared native asset selection and mesh compilation; no DOM/global UI state.
import { compileBedrockGeometryScene, extractHorseClientEntityResult, findGeometryRecordResult,
  inspectHorseRenderControllerDocument, normalizeHorsePreviewState, normalizeNativePreviewCamera,
  selectHorsePreviewState, NATIVE_PREVIEW_MAX_DRAW_WORK_UNITS } from './native-model-preview.js';
import { parseEngineVersion, compareEngineVersions } from './native-model-preview.js';
import { composeNativePreviewPackPaths, inspectBestNativePreviewVersionLayer, inspectFirstNativePreviewCandidateLayer } from './native-pack-stack.js';
import { CLASSIC_HORSE_PLACEMENT_PROFILE } from './native-scene-placement.js';
import { createNativePreviewReadContext, inspectNativePreviewReadContext, readNativePreviewJson,
  nativePreviewReadFailure, validateNativePreviewSources } from './native-model-read.js';
const NATIVE_PREVIEW_MAX_CANDIDATE_PATHS = 2048;
const NATIVE_PREVIEW_MAX_PACK_PATHS_INSPECTED = 50000;
export async function loadHorsePreviewFromSources({ sources, targetEngineVersion, signal, previewState, camera, cacheDocuments = false }) {
  const selectedState = normalizeHorsePreviewState(previewState);
  const selectedCamera = normalizeNativePreviewCamera(camera);
  if (!selectedState) return { status: 'invalid', issue: 'NATIVE_PREVIEW_STATE_INVALID' };
  if (!selectedCamera) return { status: 'invalid', issue: 'NATIVE_PREVIEW_CAMERA_INVALID' };
  if (signal?.aborted) return { status: 'cancelled' };
  const sourceIssue = validateNativePreviewSources(sources);
  if (sourceIssue) return { status: 'invalid', issue: sourceIssue };
  const sourceOrder = sources.map((entry) => entry.source);
  if (!sources.length) return { status: 'missing', issue: 'NATIVE_PREVIEW_MODEL_MISSING' };
  const totalBudget = createNativePreviewReadContext({ cacheDocuments });
  if (!parseEngineVersion(targetEngineVersion)) {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENGINE_VERSION_INVALID' };
  }

  const entityPaths = composeNativePreviewPackPaths(sources, /^entity\/.*\.json$/iu, {
    maximum: NATIVE_PREVIEW_MAX_CANDIDATE_PATHS,
    maxRawPathsPerLayer: NATIVE_PREVIEW_MAX_PACK_PATHS_INSPECTED,
  });
  if (entityPaths.invalid) return { status: 'invalid', issue: 'NATIVE_PREVIEW_PACK_INDEX_INVALID' };
  if (entityPaths.truncated) return { status: 'invalid', issue: 'NATIVE_PREVIEW_LIMIT_EXCEEDED' };
  if (entityPaths.collision) return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENTITY_AMBIGUOUS' };
  let entityLayer;
  try {
    entityLayer = await inspectBestNativePreviewVersionLayer(
      entityPaths.entries,
      sourceOrder,
      targetEngineVersion,
      async (entry) => {
        if (signal?.aborted) {
          throw new Error('NATIVE_PREVIEW_ABORTED');
        }
        const document = await readNativePreviewJson(
          entry.runtime,
          entry.packPath,
          512 * 1024,
          totalBudget,
          signal,
          entry.source,
        );
        const extraction = extractHorseClientEntityResult(document);
        if (extraction.status === 'not-horse') return { status: 'missing' };
        return {
          status: 'candidate',
          candidate: {
            extraction,
            descriptor: extraction.descriptor,
            minEngineVersion: extraction.minEngineVersion,
            packPath: entry.packPath,
            source: entry.source,
          },
        };
      },
    );
  } catch (error) {
    return nativePreviewReadFailure(error, signal);
  }
  if (entityLayer.status === 'invalid') {
    if (entityLayer.reason === 'candidate-version') {
      return {
        status: 'invalid',
        issue: entityLayer.candidate?.extraction?.issue || 'NATIVE_PREVIEW_ENGINE_VERSION_INVALID',
      };
    }
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_PACK_INDEX_INVALID' };
  }
  if (entityLayer.status === 'incompatible') {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENGINE_VERSION_INCOMPATIBLE' };
  }
  if (entityLayer.status === 'missing') {
    return { status: 'missing', issue: 'NATIVE_PREVIEW_MODEL_MISSING' };
  }
  const candidates = [...entityLayer.candidates];
  // The version-aware inspector has already discarded older definitions and
  // broken cross-layer ties by pack priority. Multiple survivors therefore
  // mean the winning layer itself defines the same identifier and version
  // more than once, which cannot be previewed unambiguously.
  if (candidates.length > 1) {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENTITY_AMBIGUOUS' };
  }
  const selectedEntity = candidates[0] || null;
  const selectedEntitySource = entityLayer.source || null;
  if (!selectedEntity) {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENGINE_VERSION_INCOMPATIBLE' };
  }
  if (selectedEntity.extraction.status !== 'found' || !selectedEntity.descriptor) {
    return {
      status: 'invalid',
      issue: selectedEntity.extraction.issue || 'NATIVE_PREVIEW_MODEL_INVALID',
    };
  }

  let hiddenBonePatterns = [];
  let selectedControllerContract = null;
  if (selectedEntity.descriptor.controllerId) {
    const controllerPaths = composeNativePreviewPackPaths(sources, /^render_controllers\/.*\.json$/iu, {
      maximum: NATIVE_PREVIEW_MAX_CANDIDATE_PATHS,
      maxRawPathsPerLayer: NATIVE_PREVIEW_MAX_PACK_PATHS_INSPECTED,
    });
    if (controllerPaths.invalid) return { status: 'invalid', issue: 'NATIVE_PREVIEW_PACK_INDEX_INVALID' };
    if (controllerPaths.truncated) return { status: 'invalid', issue: 'NATIVE_PREVIEW_LIMIT_EXCEEDED' };
    if (controllerPaths.collision) return { status: 'invalid', issue: 'NATIVE_PREVIEW_CONTROLLER_AMBIGUOUS' };
    let controllerLayer;
    try {
      controllerLayer = await inspectFirstNativePreviewCandidateLayer(
        controllerPaths.entries,
        sourceOrder,
        async (entry) => {
          if (signal?.aborted) {
            throw new Error('NATIVE_PREVIEW_ABORTED');
          }
          const document = await readNativePreviewJson(
            entry.runtime,
            entry.packPath,
            2 * 1024 * 1024,
            totalBudget,
            signal,
            entry.source,
          );
          const inspected = inspectHorseRenderControllerDocument(
            document,
            selectedEntity.descriptor.controllerId,
          );
          return inspected.status === 'missing'
            ? { status: 'missing' }
            : {
                status: 'candidate',
                candidate: { inspected, packPath: entry.packPath, source: entry.source },
              };
        },
      );
    } catch (error) {
      return nativePreviewReadFailure(error, signal);
    }
    if (controllerLayer.status === 'invalid') {
      return { status: 'invalid', issue: 'NATIVE_PREVIEW_PACK_INDEX_INVALID' };
    }
    if (controllerLayer.status === 'missing') {
      return { status: 'invalid', issue: 'NATIVE_PREVIEW_CONTROLLER_MISSING' };
    }
    if (controllerLayer.candidates.length > 1) {
      return { status: 'invalid', issue: 'NATIVE_PREVIEW_CONTROLLER_AMBIGUOUS' };
    }
    const [controllerContract] = controllerLayer.candidates;
    if (controllerContract.inspected.status !== 'supported') {
      return { status: 'invalid', issue: 'NATIVE_PREVIEW_CONTROLLER_UNSUPPORTED' };
    }
    selectedControllerContract = controllerContract;
    hiddenBonePatterns = controllerContract.inspected.hiddenBonePatterns;
  }

  const selected = selectHorsePreviewState(selectedEntity.descriptor,
    selectedControllerContract?.inspected, selectedState);
  if (!selected.ok) return { status: 'invalid', issue: selected.issue };
  hiddenBonePatterns = selected.hiddenBonePatterns;
  const selectedDescriptor = selected.descriptor;

  const modelPaths = composeNativePreviewPackPaths(sources, /^models\/.*(?:\.geo)?\.json$/iu, {
    maximum: NATIVE_PREVIEW_MAX_CANDIDATE_PATHS,
    maxRawPathsPerLayer: NATIVE_PREVIEW_MAX_PACK_PATHS_INSPECTED,
  });
  if (modelPaths.invalid) return { status: 'invalid', issue: 'NATIVE_PREVIEW_PACK_INDEX_INVALID' };
  if (modelPaths.truncated) return { status: 'invalid', issue: 'NATIVE_PREVIEW_LIMIT_EXCEEDED' };
  if (modelPaths.collision) return { status: 'invalid', issue: 'NATIVE_PREVIEW_MODEL_AMBIGUOUS' };
  let modelLayer;
  try {
    modelLayer = await inspectFirstNativePreviewCandidateLayer(
      modelPaths.entries,
      sourceOrder,
      async (entry) => {
        if (signal?.aborted) {
          throw new Error('NATIVE_PREVIEW_ABORTED');
        }
        const document = await readNativePreviewJson(
          entry.runtime,
          entry.packPath,
          4 * 1024 * 1024,
          totalBudget,
          signal,
          entry.source,
        );
        const geometryResult = findGeometryRecordResult(
          document,
          selectedDescriptor.geometryIdentifier,
        );
        return geometryResult.status === 'missing'
          ? { status: 'missing' }
          : {
              status: 'candidate',
              candidate: { geometryResult, packPath: entry.packPath, source: entry.source },
            };
      },
    );
  } catch (error) {
    return nativePreviewReadFailure(error, signal);
  }
  if (modelLayer.status === 'invalid') {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_PACK_INDEX_INVALID' };
  }
  if (modelLayer.status === 'found' && modelLayer.candidates.length > 1) {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_MODEL_AMBIGUOUS' };
  }
  const selectedModel = modelLayer.status === 'found' ? modelLayer.candidates[0] : null;
  const geometryResult = selectedModel?.geometryResult || null;
  if (geometryResult?.status === 'limit') {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_LIMIT_EXCEEDED' };
  }
  if (geometryResult?.status === 'ambiguous') {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_MODEL_AMBIGUOUS' };
  }
  if (geometryResult?.status === 'unsupported') {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED' };
  }
  if (geometryResult?.status === 'invalid') {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_SCAN_INCOMPLETE' };
  }
  const found = geometryResult?.status === 'found' ? geometryResult.geometry : null;
  const foundPath = selectedModel?.packPath || '';
  const foundSource = selectedModel?.source || '';
  const foundFormatVersion = geometryResult?.formatVersion || null;
  if (found) {
    const textureRefs = selectedDescriptor.textureLayers || [selectedDescriptor.textureRef];
    const layerCount = Array.isArray(textureRefs) ? textureRefs.length : 0;
    if (layerCount < 1 || layerCount > 4) {
      return { status: 'invalid', issue: 'NATIVE_PREVIEW_TEXTURE_SET_TOO_LARGE' };
    }
    const compiled = compileBedrockGeometryScene(found, {
      hiddenBonePatterns,
      geometryFormatVersion: foundFormatVersion,
      camera: selectedCamera,
      retainMotionMesh: true,
      limits: { maxFaces: Math.floor(NATIVE_PREVIEW_MAX_DRAW_WORK_UNITS / layerCount) },
    });
    if (!compiled.ok) return { status: 'invalid', issue: compiled.error, detail: compiled.detail || null };
    return {
      status: 'ready',
      scene: Object.freeze({ ...compiled.scene, presentationProfile: CLASSIC_HORSE_PLACEMENT_PROFILE }),
      textureRef: selectedDescriptor.textureRef,
      textureRefs,
      stats: compiled.stats,
      previewState: selectedState,
      camera: selectedCamera,
      provenance: {
        scan: inspectNativePreviewReadContext(totalBudget),
        entitySource: selectedEntitySource,
        entityPath: selectedEntity.packPath,
        controllerSource: selectedControllerContract?.source || null,
        controllerPath: selectedControllerContract?.packPath || null,
        modelSource: foundSource,
        modelPath: foundPath,
        geometryIdentifier: selectedDescriptor.geometryIdentifier,
        textureAlias: selectedDescriptor.textureAlias,
        armorTextureAlias: selectedDescriptor.armorTextureAlias || null,
        materialStatus: selectedState.armorVariant ? 'EXPLICIT_UNTINTED_ARMOR_TEXTURE_LAYERS' : 'NO_ARMOR',
        stateSource: 'explicit-static-preview',
        animationStatus: 'NOT_EVALUATED',
        deviceCameraStatus: 'UNVERIFIED',
        placementProfile: CLASSIC_HORSE_PLACEMENT_PROFILE,
        placementStatus: 'OBSERVED_CLASSIC_SCREEN_APPROXIMATION',
      },
    };
  }
  return { status: 'missing', issue: 'NATIVE_PREVIEW_MODEL_MISSING' };
}

/**
 * Resource-pack default player snapshot. Account skins, Persona, attachables,
 * render-controller/Molang state and equipment are explicitly not simulated.
 * Missing or computed defaults are diagnosed; no substitute human is created.
 */
export async function loadPlayerPreviewFromSources({ sources, targetEngineVersion, signal, camera, cacheDocuments = false }) {
  const selectedCamera = normalizeNativePreviewCamera(camera ?? { yaw: 160, pitch: 5 });
  if (!selectedCamera) return { status: 'invalid', issue: 'NATIVE_PREVIEW_CAMERA_INVALID' };
  if (signal?.aborted) return { status: 'cancelled' };
  const sourceIssue = validateNativePreviewSources(sources);
  if (sourceIssue) return { status: 'invalid', issue: sourceIssue };
  if (!parseEngineVersion(targetEngineVersion)) return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENGINE_VERSION_INVALID' };
  if (!Array.isArray(sources) || !sources.length) return { status: 'missing', issue: 'NATIVE_PREVIEW_MODEL_MISSING' };
  const totalBudget = createNativePreviewReadContext({ cacheDocuments });
  const sourceOrder = sources.map((entry) => entry.source);
  const pathsFor = (pattern) => composeNativePreviewPackPaths(sources, pattern, {
    maximum: NATIVE_PREVIEW_MAX_CANDIDATE_PATHS, maxRawPathsPerLayer: NATIVE_PREVIEW_MAX_PACK_PATHS_INSPECTED,
  });
  const pathIssue = (paths, kind) => paths.invalid ? 'NATIVE_PREVIEW_PACK_INDEX_INVALID'
    : paths.truncated ? 'NATIVE_PREVIEW_LIMIT_EXCEEDED' : paths.collision ? `NATIVE_PREVIEW_${kind}_AMBIGUOUS` : null;
  const entities = pathsFor(/^entity\/.*\.json$/iu);
  const entityIssue = pathIssue(entities, 'ENTITY');
  if (entityIssue) return { status: 'invalid', issue: entityIssue };
  let entityLayer;
  try {
    entityLayer = await inspectBestNativePreviewVersionLayer(entities.entries, sourceOrder, targetEngineVersion, async (entry) => {
      const document = await readNativePreviewJson(entry.runtime, entry.packPath, 512 * 1024, totalBudget, signal, entry.source);
      const desc = document['minecraft:client_entity']?.description;
      if (!desc || desc.identifier !== 'minecraft:player') return { status: 'missing' };
      return { status: 'candidate', candidate: { document, desc, minEngineVersion: desc.min_engine_version === undefined ? [0] : parseEngineVersion(desc.min_engine_version),
        packPath: entry.packPath, source: entry.source } };
    });
  } catch (error) { return nativePreviewReadFailure(error, signal); }
  if (entityLayer.status === 'missing') return { status: 'missing', issue: 'NATIVE_PREVIEW_MODEL_MISSING' };
  if (entityLayer.status === 'incompatible') return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENGINE_VERSION_INCOMPATIBLE' };
  if (entityLayer.status !== 'found') return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENGINE_VERSION_INVALID' };
  if (entityLayer.candidates.length !== 1) return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENTITY_AMBIGUOUS' };
  const entity = entityLayer.candidates[0], desc = entity.desc;
  const format = parseEngineVersion(entity.document.format_version);
  if (!format || compareEngineVersions(format, [1, 8, 0]) < 0 || compareEngineVersions(format, [1, 26, 10]) > 0) {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_ENTITY_FORMAT_UNSUPPORTED' };
  }
  const geometryIdentifier = desc.geometry?.default, textureRef = desc.textures?.default;
  if (typeof geometryIdentifier !== 'string' || !/^geometry\.[a-zA-Z0-9_.-]{1,240}$/u.test(geometryIdentifier)) {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_PLAYER_DEFAULT_GEOMETRY_UNRESOLVED' };
  }
  if (typeof textureRef !== 'string' || !/^textures\/[a-zA-Z0-9_./-]{1,480}$/u.test(textureRef) || textureRef.includes('..')) {
    return { status: 'invalid', issue: 'NATIVE_PREVIEW_PLAYER_DEFAULT_TEXTURE_UNRESOLVED' };
  }
  // Only the audited default alpha-test material is a supported snapshot.
  if (desc.materials?.default !== 'entity_alphatest') return { status: 'invalid', issue: 'NATIVE_PREVIEW_MATERIAL_UNSUPPORTED' };
  const modelPaths = pathsFor(/^models\/entity\/.*\.json$/iu);
  const modelIssue = pathIssue(modelPaths, 'MODEL');
  if (modelIssue) return { status: 'invalid', issue: modelIssue };
  let models;
  try {
    models = await inspectFirstNativePreviewCandidateLayer(modelPaths.entries, sourceOrder, async (entry) => {
      const document = await readNativePreviewJson(entry.runtime, entry.packPath, 4 * 1024 * 1024, totalBudget, signal, entry.source);
      const result = findGeometryRecordResult(document, geometryIdentifier);
      return result.status === 'missing' ? { status: 'missing' }
        : { status: 'candidate', candidate: { result, packPath: entry.packPath, source: entry.source } };
    });
  } catch (error) { return nativePreviewReadFailure(error, signal); }
  if (models.status === 'missing') return { status: 'missing', issue: 'NATIVE_PREVIEW_MODEL_MISSING' };
  if (models.status !== 'found') return { status: 'invalid', issue: 'NATIVE_PREVIEW_PACK_INDEX_INVALID' };
  if (models.candidates.length !== 1) return { status: 'invalid', issue: 'NATIVE_PREVIEW_MODEL_AMBIGUOUS' };
  const model = models.candidates[0];
  if (model.result.status !== 'found') return { status: 'invalid', issue: model.result.status === 'limit'
    ? 'NATIVE_PREVIEW_LIMIT_EXCEEDED' : 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED' };
  const compiled = compileBedrockGeometryScene(model.result.geometry, { camera: selectedCamera,
    geometryFormatVersion: model.result.formatVersion, retainMotionMesh: true });
  if (!compiled.ok) return { status: 'invalid', issue: compiled.error, detail: compiled.detail || null };
  return { status: 'ready', scene: Object.freeze({ ...compiled.scene, kind: 'player',
    approximation: 'resource-pack-default-player-not-account-skin', presentationProfile: 'classic-player-panel-v2' }),
    textureRef, textureRefs: [textureRef], camera: selectedCamera, stats: compiled.stats,
    provenance: { scan: inspectNativePreviewReadContext(totalBudget),
      entitySource: entity.source, entityPath: entity.packPath, modelSource: model.source, modelPath: model.packPath,
      geometryIdentifier, textureAlias: 'default', materialStatus: 'EXPLICIT_DEFAULT_ALPHA_TEST',
      stateSource: 'RESOURCE_PACK_DEFAULT_PLAYER', accountSkinStatus: 'NOT_AVAILABLE',
      defaultPlayerStatus: entity.source === 'default-player' || model.source === 'default-player'
        ? 'BUNDLED_ORIGINAL_STEVE_REFERENCE' : 'PACK_RESOURCES',
      controllerStatus: 'NOT_EVALUATED', equipmentStatus: 'NOT_EVALUATED', animationStatus: 'CURSOR_PREVIEW_APPROXIMATION',
      deviceCameraStatus: 'UNVERIFIED', placementStatus: 'CLASSIC_PANEL_RATIO_CALIBRATED_DEVICE_UNVERIFIED' } };
}
