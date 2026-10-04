/** デバッグ用の限定メタデータ。原文・テキスト値・画像本体は記録しない。 */
const GEOMETRY_PROPERTIES = new Set(['offset', 'size', 'min_size', 'max_size']);
function geometryValue(operation) {
  // ログだけでサイズ変更を再現できるよう固定寸法に限定して記録する。
  // 任意の式・変数・text・texture の値は含めない。
  if (operation?.type !== 'set' || !GEOMETRY_PROPERTIES.has(operation.property)
    || !Array.isArray(operation.value) || operation.value.length !== 2) return null;
  const fixed = value => typeof value === 'number' ? Number.isFinite(value)
    : typeof value === 'string' && value.length <= 64
      && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:%|px)?$/u.test(value)
      && Number.isFinite(Number(value.replace(/(?:%|px)$/u, '')));
  return operation.value.every(fixed) ? [...operation.value] : null;
}

export function summarizeWorkspaceOperation(input) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const string = item => typeof item === 'string' ? item.slice(0, 512) : null;
  const vector = item => Array.isArray(item) && item.length === 2 && item.every(Number.isFinite) ? [...item] : null;
  const shape = item => item === null ? 'null' : Array.isArray(item) ? `array:${item.length}` : typeof item;
  const operation = item => ({ type: string(item?.type), intendedType: string(item?.intendedType), operationId: string(item?.operationId),
    newElementType: string(item?.value?.type), insertionRelation: string(item?.insertionRelation), deletionUnit: string(item?.deletionUnit), path: string(item?.path), sourceId: string(item?.sourceId),
    pointer: string(item?.pointer), effectivePointer: string(item?.effectivePointer), parentPointer: string(item?.parentPointer), property: string(item?.property),
    scope: string(item?.scope), targetMode: string(item?.targetMode), offset: vector(item?.offset), delta: vector(item?.delta),
    valueKind: shape(item?.value), valueStringLength: typeof item?.value === 'string' ? item.value.length : null,
    geometryValue: geometryValue(item),
    screen: item?.screen ? { path: string(item.screen.path), pointer: string(item.screen.pointer), sourceId: string(item.screen.sourceId) } : null });
  const operations = value.operation?.type === 'batch' && Array.isArray(value.operation.operations)
    ? value.operation.operations : value.operation ? [value.operation] : [];
  const selections = Array.isArray(value.selections) ? value.selections : [];
  return { workspaceId: string(value.workspaceId), expectedRevision: string(value.expectedRevision),
    pendingVersion: Number.isSafeInteger(value.pendingVersion) ? value.pendingVersion : null,
    path: string(value.path), sourceId: string(value.sourceId), mode: string(value.mode),
    screen: value.screen ? { path: string(value.screen.path), pointer: string(value.screen.pointer), sourceId: string(value.screen.sourceId) } : null,
    operationCount: operations.length, operations: operations.slice(0, 16).map(operation), omittedOperations: Math.max(0, operations.length - 16),
    selectionCount: selections.length, selections: selections.slice(0, 16).map(item => ({ path: string(item?.filePath), rawKey: string(item?.rawKey), sourceId: string(item?.sourceId) })),
    omittedSelections: Math.max(0, selections.length - 16),
    packOptionsConfigured: value.packOptions !== undefined, iconProvided: typeof value.iconPngBase64 === 'string' };
}

function editPlanSummary(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const string = value => typeof value === 'string' ? value.slice(0, 1024) : null;
  const location = value => value ? { path: string(value.path), source_id: string(value.sourceId),
    pointer: string(value.pointer), effective_pointer: string(value.effectivePointer), type: string(value.type) } : null;
  const one = item => ({ scope: string(item.scope), target_mode: string(item.targetMode),
    target_policy: string(item.targetPolicyVersion), target_decision: string(item.targetDecision),
    affected_descendants: Number.isSafeInteger(item.affectedDescendants) ? item.affectedDescendants : null,
    target_analysis_complete: typeof item.targetAnalysisComplete === 'boolean' ? item.targetAnalysisComplete : null,
    structure_operation: string(item.structure?.operation), deletion_unit: string(item.structure?.deletionUnit),
    reference_policy: string(item.structure?.referenceCheck), reference_analysis: item.structure?.referenceAnalysis ? {
      checkedNodes: item.structure.referenceAnalysis.checkedNodes, references: item.structure.referenceAnalysis.references,
      work: item.structure.referenceAnalysis.work, limit: item.structure.referenceAnalysis.limit, coverage: string(item.structure.referenceAnalysis.coverage) } : null,
    instance_isolation: string(item.instanceIsolation), selected: location(item.selected), target: location(item.target),
    committed_target: location(item.committedTarget), committed_screen: location(item.committedScreen),
    affected_instances: Number.isSafeInteger(item.affectedInstances) ? item.affectedInstances : null,
    shared_source_instances: Number.isSafeInteger(item.sharedSourceInstances) ? item.sharedSourceInstances : null,
    requires_template_consent: item.requiresTemplateConsent === true,
    cloned_definition_count: Array.isArray(item.clonedDefinitions) ? item.clonedDefinitions.length : 0,
    device_validation: string(item.deviceValidation) });
  if (plan.type !== 'batch') return one(plan);
  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  return { type: 'batch', operation_count: operations.length,
    operations: operations.slice(-8).map(item => ({ index: item.index, ...one(item.editPlan || {}) })),
    omitted_operations: Math.max(0, operations.length - 8) };
}

export function summarizeWorkspaceResult(result) {
  const plan = result?.plan || result;
  const diagnostics = [...(plan?.unresolved || []), ...(result?.diagnostics || [])];
  const limited = value => typeof value==='string'?value.slice(0,1024):null;
  const reasons = result?.details || result?.error?.details || [];
  return { failure_code: limited(result?.code || result?.error?.code), failure_message: limited(result?.message || result?.error?.message),
    reference_reasons: (Array.isArray(reasons)?reasons:[]).filter(item=>item&&typeof item==='object').slice(0,8).map(item=>({sourceProperty:limited(item.sourceProperty),referenceKind:limited(item.referenceKind),sourcePath:limited(item.sourcePath),sourcePointer:limited(item.sourcePointer),candidateTarget:limited(item.candidateTarget),reason:limited(item.reason),policy:limited(item.policy)})),
    edit_plan: editPlanSummary(result?.editPlan), ok: result?.ok !== false && plan?.ok !== false, revision: result?.revision || result?.baseRevision || null,
    draftRevision: result?.draftRevision || null, pendingVersion: result?.pendingVersion ?? null,
    committed: result?.committed ?? null, editCount: result?.editCount ?? null,
    changedFileCount: result?.changes?.length ?? result?.metrics?.changedFiles ?? null,
    batch: result?.batch ? { operationCount: result.batch.operationCount, appliedCount: result.batch.appliedCount,
      failedOperationIndex: result.batch.failedOperationIndex, atomic: result.batch.atomic,
      validationCache: ['hit', 'miss'].includes(result.batch.validationCache) ? result.batch.validationCache : null,
      validationDurationMs: Number.isFinite(result.batch.validationDurationMs) ? result.batch.validationDurationMs : null,
      cacheReason: ['exact-match', 'key-changed', 'not-retained', 'decode-failed'].includes(result.batch.cacheReason) ? result.batch.cacheReason : null,
      storageReason: ['retained', 'expanded-limit', 'retained-limit', 'encode-failed'].includes(result.batch.storageReason) ? result.batch.storageReason : null,
      storageEncoding: ['json-string', 'utf8', 'deflate-raw', 'utf16le', 'deflate-raw-utf16le', 'none'].includes(result.batch.storageEncoding) ? result.batch.storageEncoding : null,
      jsonUtf8Bytes: Number.isSafeInteger(result.batch.jsonUtf8Bytes) ? result.batch.jsonUtf8Bytes : null,
      expandedBytes: Number.isSafeInteger(result.batch.expandedBytes) ? result.batch.expandedBytes : null,
      retainedBytes: Number.isSafeInteger(result.batch.retainedBytes) ? result.batch.retainedBytes : null,
      cacheEncodeMs: Number.isFinite(result.batch.cacheEncodeMs) ? result.batch.cacheEncodeMs : null,
      cacheDecodeMs: Number.isFinite(result.batch.cacheDecodeMs) ? result.batch.cacheDecodeMs : null } : null,
    processing: result?.metrics ? { durationMs: result.metrics.durationMs ?? null,
      projectionCache: result.metrics.projectionCache ?? null, catalogReadFiles: result.metrics.catalogReadFiles ?? null,
      phases: result.metrics.phases ?? null } : null,
    diagnosticCount: diagnostics.length, diagnosticCodes: diagnostics.slice(0, 32).map(item => item?.code || 'UNKNOWN'),
    omittedDiagnostics: Math.max(0, diagnostics.length - 32),
    outputFileCount: plan?.files?.length ?? null, outputBytes: plan?.metrics?.expandedBytes ?? null,
    frameNodeCount: result?.frame?.layout?.stats?.totalNodes ?? null };
}
