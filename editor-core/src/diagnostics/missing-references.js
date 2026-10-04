/*
  Missing-reference report scoping

  The interactive References panel is intentionally scoped to the selected
  screen. Export preflight may request every open screen explicitly. Keeping
  this pure and separate prevents a UI copy change from silently changing the
  safety boundary used by pack export.
*/

export const REFERENCE_ISSUE_CATEGORY = Object.freeze({
  MISSING_TEXTURE_REF: 'textures',
  MISSING_FONT_REF: 'fonts',
  MISSING_LANG_KEY: 'langKeys',
  MISSING_GLOBAL_VAR: 'globalVars',
});

/**
 * Read one reference value from the current report shape while retaining
 * compatibility with reports produced by older editor builds.
 *
 * @param {unknown} item
 */
export function getMissingReferenceDisplayValue(item) {
  if (!isObjectRecord(item)) return '';
  return String(item.ref ?? item.refValue ?? item.value ?? item.key ?? '').trim();
}

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function selectedDefinitionMetadata(file) {
  const selected = isObjectRecord(file?.meta?.selectedDefinition)
    ? file.meta.selectedDefinition
    : null;
  const definition = selected
    ? selected.definition || selected.rawKey || ''
    : typeof file?.meta?.selectedDefinition === 'string'
      ? file.meta.selectedDefinition
      : '';
  return {
    id: String(file?.id || ''),
    packPath: String(file?.packPath || file?.path || ''),
    qualifiedName: String(selected?.qualifiedName || ''),
    definition: String(definition || ''),
  };
}

/**
 * Return screen files for one deliberately selected report scope.
 *
 * @param {unknown} filesState
 * @param {'current'|'open'} scope
 * @returns {any[]}
 */
export function getReferenceScopeScreenFiles(filesState, scope = 'current') {
  if (!isObjectRecord(filesState)) return [];
  const byId = isObjectRecord(filesState.byId) ? filesState.byId : {};
  if (scope === 'current') {
    const id = typeof filesState.currentFileId === 'string' ? filesState.currentFileId : '';
    const openIds = Array.isArray(filesState.openFileIds) ? filesState.openFileIds : [];
    // A stale current id can coexist briefly with a replacement tab in an
    // asynchronous projection update. Never resurrect its old diagnostics.
    if (!id || !openIds.includes(id)) return [];
    const file = id ? byId[id] : null;
    return file && file.kind === 'screen' ? [file] : [];
  }
  if (scope !== 'open') return [];
  const ids = Array.isArray(filesState.openFileIds) ? filesState.openFileIds : [];
  const result = [];
  for (const id of ids) {
    const file = byId[id];
    if (file && file.kind === 'screen') result.push(file);
  }
  return result;
}

/**
 * Aggregate already-selected screen validation results without retaining
 * mutable file or issue objects in the report. Export uses this with temporary
 * full-document results so it cannot overwrite the interactive current-screen
 * result stored on the file.
 *
 * @param {unknown} screenFilesValue
 * @param {{scope?: 'current'|'open'}} options
 */
export function collectMissingReferencesFromScreenFiles(screenFilesValue, options = {}) {
  const scope = options?.scope === 'open' ? 'open' : 'current';
  let screenFiles = Array.isArray(screenFilesValue)
    ? screenFilesValue.filter((file) => file && file.kind === 'screen')
    : [];
  if (scope === 'current' && screenFiles.length !== 1) screenFiles = [];
  const byCategory = {
    textures: new Map(),
    fonts: new Map(),
    langKeys: new Map(),
    globalVars: new Map(),
  };

  for (const file of screenFiles) {
    const metadata = selectedDefinitionMetadata(file);
    const label = metadata.definition
      ? `${metadata.packPath}#${metadata.definition}`
      : metadata.packPath || metadata.id;
    const issues = Array.isArray(file?.validation?.issues) ? file.validation.issues : [];
    for (const issue of issues) {
      const category = REFERENCE_ISSUE_CATEGORY[issue?.code];
      if (!category) continue;
      const ref = String(issue?.refValue || issue?.message || '').trim();
      if (!ref) continue;
      const records = byCategory[category];
      if (!records.has(ref)) records.set(ref, { ref, files: new Set() });
      records.get(ref).files.add(label);
    }
  }

  const toArray = (records) => Array.from(records.values())
    .map((record) => ({
      ref: record.ref,
      count: record.files.size,
      files: Array.from(record.files).sort(),
    }))
    .sort((a, b) => b.count - a.count || String(a.ref).localeCompare(String(b.ref)));
  const currentScreen = scope === 'current' && screenFiles.length === 1
    ? selectedDefinitionMetadata(screenFiles[0])
    : null;

  return {
    scope: scope === 'open' ? 'open-screens' : 'current-screen',
    scannedScreens: screenFiles.length,
    screen: currentScreen,
    textures: toArray(byCategory.textures),
    fonts: toArray(byCategory.fonts),
    langKeys: toArray(byCategory.langKeys),
    globalVars: toArray(byCategory.globalVars),
  };
}

/**
 * Aggregate missing-reference validation issues for the requested UI scope.
 *
 * @param {unknown} state
 * @param {{scope?: 'current'|'open'}} options
 */
export function collectMissingReferences(state, options = {}) {
  const scope = options?.scope === 'open' ? 'open' : 'current';
  const filesState = isObjectRecord(state) && isObjectRecord(state.files) ? state.files : null;
  const screenFiles = getReferenceScopeScreenFiles(filesState, scope);
  return collectMissingReferencesFromScreenFiles(screenFiles, { scope });
}
