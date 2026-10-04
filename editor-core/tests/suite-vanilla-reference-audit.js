import { test, assert, assertEqual } from './test-harness.js';
import { auditVanillaReference } from '../src/vanilla/vanilla-reference-audit.js';

const completePaths = [
  'manifest.json',
  'ui/_ui_defs.json',
  'ui/_global_variables.json',
  'ui/hud_screen.json',
  'ui/ui_common.json',
  'textures/ui/White.png',
  'font/glyph_E0.png',
  'texts/en_US.lang',
];

const validManifest = { ok: true, isResourcePack: true };
const parsedCriticalDocuments = {
  uiDefsEntryCount: 180,
  globalVariableCount: 250,
  hudScreenParsed: true,
  uiCommonParsed: true,
  languageEntryCount: 1000,
};

test('vanilla audit reports NOT_LOADED without paths', () => {
  const result = auditVanillaReference();
  assertEqual(result.readiness, 'NOT_LOADED');
  assert(!result.highFidelityPreviewReady, 'Missing pack must not be high-fidelity ready');
});

test('vanilla audit rejects a non-resource manifest', () => {
  const result = auditVanillaReference({ packPaths: completePaths, manifestValidation: { ok: true, isResourcePack: false } });
  assertEqual(result.readiness, 'INVALID');
  assert(result.warnings.some((item) => item.code === 'VANILLA_MANIFEST_INVALID'), 'Expected manifest warning');
});

test('vanilla audit classifies missing base controls as PARTIAL', () => {
  const result = auditVanillaReference({
    packPaths: completePaths.filter((path) => path !== 'ui/ui_common.json'),
    manifestValidation: validManifest,
  });
  assertEqual(result.readiness, 'PARTIAL');
  assert(result.missingCriticalPaths.includes('ui/ui_common.json'), 'Expected missing ui_common');
});

test('vanilla audit keeps a text-only min pack PARTIAL for visual work', () => {
  const result = auditVanillaReference({
    packPaths: completePaths.filter((path) => !path.startsWith('textures/ui/') && !path.startsWith('font/')),
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40.05',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
  });
  assertEqual(result.readiness, 'PARTIAL');
  assert(!result.highFidelityPreviewReady, 'Text-only pack must not be accepted for visual preview');
  assert(result.warnings.some((item) => item.code === 'VANILLA_UI_TEXTURES_MISSING'), 'Expected texture warning');
  assert(result.warnings.some((item) => item.code === 'VANILLA_FONTS_MISSING'), 'Expected font warning');
});

test('vanilla audit keeps a complete but unversioned pack unverified', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_UNVERIFIED_VERSION');
  assert(result.usableBaseReference, 'A structurally complete, unversioned browser upload should be usable with a warning');
  assert(!result.highFidelityPreviewReady, 'Unknown version must remain unverified');
});

test('vanilla audit accepts the official full-pack shape without optional top-level font overrides', () => {
  const result = auditVanillaReference({
    packPaths: [
      ...completePaths.filter((path) => !path.startsWith('font/')),
      'texts/ja_JP/font/glyph_41.png',
    ],
    manifestValidation: validManifest,
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_UNVERIFIED_VERSION');
  assert(result.usableBaseReference);
  const fontWarning = result.warnings.find((item) => item.code === 'VANILLA_FONTS_MISSING');
  assert(fontWarning);
  assertEqual(fontWarning.severity, 'WARN');
});

test('vanilla audit treats matching declared versions as unverified input', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40.05',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_DECLARED_VERSION_MATCH');
  assert(result.declaredCompatibleReferenceReady, 'Declared versions and structure should match');
  assert(!result.verifiedReferenceInputReady, 'Provenance and archive identity are still unverified');
  assert(!result.highFidelityPreviewReady, 'Input audit alone must not claim high-fidelity preview');
});

test('vanilla audit requires parsed non-empty indexes before structural readiness', () => {
  const unparsed = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40.05',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
  });
  assertEqual(unparsed.readiness, 'PARTIAL');
  assert(unparsed.warnings.some((item) => item.code === 'VANILLA_UI_DEFS_UNPARSED'));

  const empty = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40.05',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    uiDefsEntryCount: 0,
    globalVariableCount: 0,
  });
  assertEqual(empty.readiness, 'PARTIAL');
  assert(!empty.structuralReferenceReady);
});

test('vanilla audit distinguishes a verified input receipt from preview parity', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40.05',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
    sourceProvenanceVerified: true,
    archiveIdentityVerified: true,
  });
  assertEqual(result.readiness, 'READY_VERIFIED_INPUT');
  assert(result.verifiedReferenceInputReady);
  assert(!result.highFidelityPreviewReady, 'Resolver and Bedrock gates remain separate');
});

test('vanilla audit does not treat a patch-line-only match as exact', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_VERSION_PATCH_LINE');
  assert(!result.highFidelityPreviewReady, 'Exact source release must be required for high-fidelity readiness');
});

test('vanilla audit exposes a version mismatch without hiding structural readiness', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.21.120.4',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_VERSION_MISMATCH');
  assert(!result.usableBaseReference, 'An explicit version mismatch must not be activated');
  assert(result.warnings.some((item) => item.code === 'VANILLA_VERSION_MISMATCH'), 'Expected mismatch warning');
});

test('vanilla audit blocks explicit numeric release drift even when channels are omitted', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.21.120.4',
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_VERSION_MISMATCH');
  assert(!result.usableBaseReference);
});

test('vanilla audit rejects stable versus preview channel drift', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    expectedChannel: 'stable',
    sourceRelease: 'v1.26.40.5',
    sourceChannel: 'preview',
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_VERSION_MISMATCH');
  assertEqual(result.version.channelStatus, 'MISMATCH');
});

test('vanilla audit does not zero-pad a three-component version into an exact match', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40',
    expectedChannel: 'stable',
    sourceRelease: 'v1.26.40.00',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_VERSION_PATCH_LINE');
});

test('vanilla audit rejects partial regex matches with extra version content', () => {
  const extraSuffix = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5.extra',
    sourceRelease: 'v1.26.40.05',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
  });
  assertEqual(extraSuffix.readiness, 'READY_UNVERIFIED_VERSION');

  const extraComponent = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40.05.99',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
  });
  assertEqual(extraComponent.readiness, 'READY_UNVERIFIED_VERSION');
});

test('vanilla audit requires an explicit source channel for numeric release tags', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40.05',
    expectedChannel: 'stable',
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_UNVERIFIED_VERSION');
  assertEqual(result.version.channelStatus, 'UNKNOWN');
});

test('vanilla audit accepts a strict preview tag only with matching explicit channels', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.50.27',
    sourceRelease: 'v1.26.50.27-preview',
    expectedChannel: 'preview',
    sourceChannel: 'preview',
    ...parsedCriticalDocuments,
  });
  assertEqual(result.readiness, 'READY_DECLARED_VERSION_MATCH');
});

test('vanilla audit rejects present-but-unparseable critical reference documents', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40.05',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
    hudScreenParsed: false,
  });
  assertEqual(result.readiness, 'PARTIAL');
  assert(result.warnings.some((item) => item.code === 'VANILLA_HUD_SCREEN_UNPARSED'));
});

test('vanilla audit rejects source tag suffix and explicit channel contradiction', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5',
    sourceRelease: 'v1.26.40.05-preview',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
    sourceProvenanceVerified: true,
    archiveIdentityVerified: true,
  });
  assertEqual(result.readiness, 'READY_VERSION_MISMATCH');
  assertEqual(result.version.sourceTagChannelStatus, 'MISMATCH');
  assertEqual(result.verifiedReferenceInputReady, false);
});

test('vanilla audit compares arbitrarily large version components without Number rounding', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.2.9007199254740992',
    sourceRelease: 'v1.2.9007199254740993',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
    sourceProvenanceVerified: true,
    archiveIdentityVerified: true,
  });
  assertEqual(result.readiness, 'READY_VERSION_MISMATCH');
  assertEqual(result.verifiedReferenceInputReady, false);
});

test('vanilla audit rejects a channel suffix embedded in the target game version', () => {
  const result = auditVanillaReference({
    packPaths: completePaths,
    manifestValidation: validManifest,
    expectedBedrockVersion: '1.26.40.5-preview',
    sourceRelease: 'v1.26.40.05',
    expectedChannel: 'stable',
    sourceChannel: 'stable',
    ...parsedCriticalDocuments,
    sourceProvenanceVerified: true,
    archiveIdentityVerified: true,
  });
  assertEqual(result.readiness, 'READY_UNVERIFIED_VERSION');
  assertEqual(result.verifiedReferenceInputReady, false);
});
