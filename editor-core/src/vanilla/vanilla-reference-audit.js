/*
  Vanilla Resource Pack readiness audit.

  This module deliberately evaluates metadata and known paths only. It never
  stores pack contents, local paths, account data, or filenames supplied by the
  user. A successful result means the reference is structurally useful to this
  editor; it does not prove Minecraft Bedrock rendering parity.
*/

const EXPECTED_PATHS = Object.freeze([
  Object.freeze({ path: 'ui/_ui_defs.json', role: 'screen_registry', critical: true }),
  Object.freeze({ path: 'ui/_global_variables.json', role: 'global_variables', critical: true }),
  Object.freeze({ path: 'ui/hud_screen.json', role: 'hud_target', critical: true }),
  Object.freeze({ path: 'ui/ui_common.json', role: 'base_controls', critical: true }),
  Object.freeze({ path: 'texts/en_US.lang', role: 'fallback_language', critical: true }),
]);

function normalizeVersionParts(value, allowChannelSuffix = false) {
  const text = String(value ?? '').trim().replace(/^v/i, '');
  if (!text) return null;
  // Accept only a complete 3- or 4-component numeric version declaration.
  // Partial regex matches would incorrectly accept extra components/suffixes.
  const pattern = allowChannelSuffix
    ? /^(\d+(?:\.\d+){2,3})(?:-(?:preview|beta))?$/i
    : /^(\d+(?:\.\d+){2,3})$/;
  const match = text.match(pattern);
  if (!match) return null;
  // Canonical decimal strings avoid Number safe-integer rounding while still
  // treating release component "05" as equivalent to game component "5".
  return match[1].split('.').map((part) => part.replace(/^0+(?=\d)/, '') || '0');
}

function normalizeChannel(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'stable' || text === 'retail') return 'stable';
  if (text === 'preview' || text === 'beta') return 'preview';
  return null;
}

function inferSourceChannel(sourceRelease, explicitChannel) {
  const explicit = normalizeChannel(explicitChannel);
  if (explicit) return explicit;
  // A numeric Mojang release tag is not sufficient evidence of the channel.
  // Stable/Preview assets can coexist and must be declared independently.
  return null;
}

function sourceTagChannel(sourceRelease) {
  const text = String(sourceRelease ?? '').trim().toLowerCase();
  if (/(?:-preview|-beta)$/.test(text)) return 'preview';
  return normalizeVersionParts(sourceRelease, true) ? 'stable' : null;
}

function compareVersions(expected, sourceRelease, expectedChannel, sourceChannel) {
  const expectedParts = normalizeVersionParts(expected, false);
  const sourceParts = normalizeVersionParts(sourceRelease, true);
  const normalizedExpectedChannel = normalizeChannel(expectedChannel);
  const normalizedSourceChannel = inferSourceChannel(sourceRelease, sourceChannel);
  const tagChannel = sourceTagChannel(sourceRelease);
  const sourceTagChannelStatus = !normalizedSourceChannel || !tagChannel
    ? 'UNKNOWN'
    : normalizedSourceChannel === tagChannel
      ? 'MATCH'
      : 'MISMATCH';
  const channelStatus = !normalizedExpectedChannel || !normalizedSourceChannel
    ? 'UNKNOWN'
    : normalizedExpectedChannel !== normalizedSourceChannel || sourceTagChannelStatus === 'MISMATCH'
      ? 'MISMATCH'
      : sourceTagChannelStatus;
  if (!expectedParts || !sourceParts) {
    return {
      status: 'UNKNOWN',
      expected: expected || null,
      sourceRelease: sourceRelease || null,
      expectedChannel: normalizedExpectedChannel,
      sourceChannel: normalizedSourceChannel,
      sourceTagChannel: tagChannel,
      sourceTagChannelStatus,
      channelStatus,
    };
  }

  const exactNumeric = expectedParts.length === sourceParts.length
    && expectedParts.every((part, index) => part === sourceParts[index]);
  const lineMatch = expectedParts.length >= 3
    && sourceParts.length >= 3
    && expectedParts.slice(0, 3).every((part, index) => sourceParts[index] === part);
  // A missing channel declaration cannot turn an explicit numeric version
  // conflict into UNKNOWN. Block clear release-line drift even when the user
  // has not filled the optional channel fields yet.
  const status = !lineMatch
    ? 'MISMATCH'
    : channelStatus === 'MISMATCH'
    ? 'MISMATCH'
    : channelStatus === 'UNKNOWN'
      ? 'UNKNOWN'
    : exactNumeric
      ? 'MATCH'
      : lineMatch
        ? 'PATCH_LINE_MATCH'
        : 'MISMATCH';
  return {
    status,
    expected: expectedParts.join('.'),
    sourceRelease: sourceParts.join('.'),
    expectedChannel: normalizedExpectedChannel,
    sourceChannel: normalizedSourceChannel,
    sourceTagChannel: tagChannel,
    sourceTagChannelStatus,
    channelStatus,
  };
}

function lowerPathSet(packPaths) {
  const paths = Array.isArray(packPaths) ? packPaths : [];
  return new Set(paths.map((value) => String(value || '').replace(/\\/g, '/').toLowerCase()));
}

function countPrefix(paths, prefix, suffix = '') {
  let count = 0;
  for (const path of paths) {
    if (path.startsWith(prefix) && (!suffix || path.endsWith(suffix))) count += 1;
  }
  return count;
}

/**
 * @param {{
 *   packPaths?: string[],
 *   manifestValidation?: {ok?: boolean,isResourcePack?: boolean}|null,
 *   expectedBedrockVersion?: string|null,
 *   sourceRelease?: string|null,
 *   expectedChannel?: string|null,
 *   sourceChannel?: string|null,
 *   uiDefsEntryCount?: number|null,
 *   globalVariableCount?: number|null,
 *   hudScreenParsed?: boolean|null,
 *   uiCommonParsed?: boolean|null,
 *   languageEntryCount?: number|null,
 *   sourceProvenanceVerified?: boolean,
 *   archiveIdentityVerified?: boolean,
 * }} input
 */
export function auditVanillaReference(input = {}) {
  const paths = lowerPathSet(input.packPaths);
  const version = compareVersions(
    input.expectedBedrockVersion,
    input.sourceRelease,
    input.expectedChannel,
    input.sourceChannel,
  );
  const manifestOk = Boolean(input.manifestValidation?.ok && input.manifestValidation?.isResourcePack);
  const expectedFiles = EXPECTED_PATHS.map((spec) => ({
    ...spec,
    present: paths.has(spec.path.toLowerCase()),
  }));
  const missingCriticalPaths = expectedFiles.filter((item) => item.critical && !item.present).map((item) => item.path);
  const categoryCounts = {
    totalFiles: paths.size,
    uiJson: countPrefix(paths, 'ui/', '.json'),
    uiTextures: countPrefix(paths, 'textures/ui/'),
    fonts: countPrefix(paths, 'font/'),
    languages: countPrefix(paths, 'texts/', '.lang'),
  };

  const warnings = [];
  if (!paths.size) warnings.push({ code: 'VANILLA_REFERENCE_NOT_LOADED', severity: 'ERROR' });
  if (paths.size && !manifestOk) warnings.push({ code: 'VANILLA_MANIFEST_INVALID', severity: 'ERROR' });
  for (const path of missingCriticalPaths) {
    warnings.push({ code: 'VANILLA_REQUIRED_PATH_MISSING', severity: 'ERROR', context: { expectedPath: path } });
  }
  if (categoryCounts.uiTextures === 0) warnings.push({ code: 'VANILLA_UI_TEXTURES_MISSING', severity: 'ERROR' });
  // Current official bedrock-samples full releases can omit a top-level
  // `font/` tree while still carrying all UI JSON, UI textures, localization,
  // and locale glyphs. The preview has a diagnosed system-font fallback, so
  // absence of optional font overrides must not reject an otherwise usable
  // Vanilla base.
  if (categoryCounts.fonts === 0) warnings.push({ code: 'VANILLA_FONTS_MISSING', severity: 'WARN' });
  if (version.status === 'UNKNOWN') warnings.push({ code: 'VANILLA_VERSION_PROVENANCE_UNKNOWN', severity: 'WARN' });
  if (version.status === 'MISMATCH') warnings.push({ code: 'VANILLA_VERSION_MISMATCH', severity: 'ERROR' });

  const uiDefsEntryCount = Number.isInteger(input.uiDefsEntryCount) && input.uiDefsEntryCount >= 0
    ? input.uiDefsEntryCount
    : null;
  const globalVariableCount = Number.isInteger(input.globalVariableCount) && input.globalVariableCount >= 0
    ? input.globalVariableCount
    : null;
  if (uiDefsEntryCount === null) warnings.push({ code: 'VANILLA_UI_DEFS_UNPARSED', severity: 'ERROR' });
  else if (uiDefsEntryCount === 0) warnings.push({ code: 'VANILLA_UI_DEFS_EMPTY', severity: 'ERROR' });
  if (globalVariableCount === null) warnings.push({ code: 'VANILLA_GLOBAL_VARIABLES_UNPARSED', severity: 'ERROR' });
  else if (globalVariableCount === 0) warnings.push({ code: 'VANILLA_GLOBAL_VARIABLES_EMPTY', severity: 'ERROR' });
  const hudScreenParsed = typeof input.hudScreenParsed === 'boolean' ? input.hudScreenParsed : null;
  const uiCommonParsed = typeof input.uiCommonParsed === 'boolean' ? input.uiCommonParsed : null;
  const languageEntryCount = Number.isInteger(input.languageEntryCount) && input.languageEntryCount >= 0
    ? input.languageEntryCount
    : null;
  if (hudScreenParsed !== true) warnings.push({ code: 'VANILLA_HUD_SCREEN_UNPARSED', severity: 'ERROR' });
  if (uiCommonParsed !== true) warnings.push({ code: 'VANILLA_UI_COMMON_UNPARSED', severity: 'ERROR' });
  if (languageEntryCount === null) warnings.push({ code: 'VANILLA_LANGUAGE_UNPARSED', severity: 'ERROR' });
  else if (languageEntryCount === 0) warnings.push({ code: 'VANILLA_LANGUAGE_EMPTY', severity: 'ERROR' });

  const sourceProvenanceVerified = input.sourceProvenanceVerified === true;
  const archiveIdentityVerified = input.archiveIdentityVerified === true;
  if (!sourceProvenanceVerified) warnings.push({ code: 'VANILLA_OFFICIAL_SOURCE_RECEIPT_UNVERIFIED', severity: 'WARN' });
  if (!archiveIdentityVerified) warnings.push({ code: 'VANILLA_ARCHIVE_IDENTITY_UNVERIFIED', severity: 'WARN' });

  const structurallyComplete = manifestOk
    && missingCriticalPaths.length === 0
    && categoryCounts.uiTextures > 0
    && uiDefsEntryCount !== null
    && uiDefsEntryCount > 0
    && globalVariableCount !== null
    && globalVariableCount > 0
    && hudScreenParsed === true
    && uiCommonParsed === true
    && languageEntryCount !== null
    && languageEntryCount > 0;
  const declaredCompatibleReferenceReady = structurallyComplete && version.status === 'MATCH';
  // Browser users can safely use a structurally complete reference when its
  // exact release metadata is unknown.  That is useful but unverified, so it
  // remains a warning and never becomes a parity claim.  An explicit version
  // or channel mismatch still fails closed.
  const usableBaseReference = structurallyComplete && version.status !== 'MISMATCH';
  const verifiedReferenceInputReady = declaredCompatibleReferenceReady
    && sourceProvenanceVerified
    && archiveIdentityVerified;
  let readiness = 'NOT_LOADED';
  if (paths.size && (!manifestOk || !paths.has('ui/_ui_defs.json'))) readiness = 'INVALID';
  else if (paths.size && !structurallyComplete) readiness = 'PARTIAL';
  else if (structurallyComplete && version.status === 'MISMATCH') readiness = 'READY_VERSION_MISMATCH';
  else if (structurallyComplete && version.status === 'UNKNOWN') readiness = 'READY_UNVERIFIED_VERSION';
  else if (structurallyComplete && version.status === 'PATCH_LINE_MATCH') readiness = 'READY_VERSION_PATCH_LINE';
  else if (verifiedReferenceInputReady) readiness = 'READY_VERIFIED_INPUT';
  else if (declaredCompatibleReferenceReady) readiness = 'READY_DECLARED_VERSION_MATCH';

  // Input audit alone cannot prove resolver completeness or Bedrock rendering
  // parity. Retain the old field as an explicit false compatibility marker.
  const highFidelityPreviewReady = false;
  return {
    schemaVersion: 'jsonui.vanilla-reference-audit.v1',
    readiness,
    highFidelityPreviewReady,
    structuralReferenceReady: structurallyComplete,
    usableBaseReference,
    declaredCompatibleReferenceReady,
    verifiedReferenceInputReady,
    manifest: { ok: manifestOk },
    version,
    expectedFiles,
    missingCriticalPaths,
    categoryCounts,
    parsedCounts: { uiDefsEntryCount, globalVariableCount, hudScreenParsed, uiCommonParsed, languageEntryCount },
    provenance: { sourceProvenanceVerified, archiveIdentityVerified },
    warnings,
    limitation: 'A verified reference input is not effective-resolver completeness or Minecraft Bedrock rendering parity.',
  };
}

export { EXPECTED_PATHS };
