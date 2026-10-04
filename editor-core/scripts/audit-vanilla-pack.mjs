import { createHash } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import '../vendor/zip.js-2.8.16/zip.min.js';
import { importResourcePackZip } from '../src/pack-io/pack-importer.js';
import { parseJsonc } from '../src/json/jsonc.js';
import { auditVanillaReference } from '../src/vanilla/vanilla-reference-audit.js';
import { verifyOfficialReleaseAsset } from '../src/vanilla/official-release-verifier.js';

const zipLib = globalThis.zip;
if (!zipLib) throw new Error('VENDORED_ZIP_LIBRARY_NOT_LOADED');
zipLib.configure({ useWebWorkers: false });

let failureCorrelationSessionId = null;

function parseArgs(argv) {
  const input = {
    zipPath: null,
    expectedBedrockVersion: null,
    sourceRelease: null,
    expectedChannel: null,
    sourceChannel: null,
    sourceAssetUrl: null,
    expectedSha256: null,
    sessionId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--expected-bedrock-version') input.expectedBedrockVersion = argv[++index] || null;
    else if (value === '--source-release') input.sourceRelease = argv[++index] || null;
    else if (value === '--expected-channel') input.expectedChannel = argv[++index] || null;
    else if (value === '--source-channel') input.sourceChannel = argv[++index] || null;
    else if (value === '--source-asset-url') input.sourceAssetUrl = argv[++index] || null;
    else if (value === '--expected-sha256') input.expectedSha256 = String(argv[++index] || '').toLowerCase() || null;
    else if (value === '--session-id') {
      input.sessionId = argv[++index] || null;
      if (input.sessionId && /^[A-Za-z0-9_-]{8,128}$/.test(input.sessionId)) {
        failureCorrelationSessionId = input.sessionId;
      }
    }
    else if (!input.zipPath) input.zipPath = value;
    else throw new Error('UNEXPECTED_ARGUMENT');
  }
  if (!input.zipPath) throw new Error('ZIP_PATH_REQUIRED');
  if (input.expectedSha256 && !/^[a-f0-9]{64}$/.test(input.expectedSha256)) {
    throw new Error('EXPECTED_SHA256_INVALID');
  }
  if (input.sessionId && !/^[A-Za-z0-9_-]{8,128}$/.test(input.sessionId)) throw new Error('SESSION_ID_INVALID');
  return input;
}

async function sha256File(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
}

function findPath(packPaths, desired) {
  const lower = String(desired).toLowerCase();
  return packPaths.find((path) => String(path).toLowerCase() === lower) || null;
}

async function countUiDefs(result) {
  const actual = findPath(result.packPaths, 'ui/_ui_defs.json');
  if (!actual) return null;
  const text = await result.zipReader.readText(`${result.rootPrefix}${actual}`, { maxBytes: 8 * 1024 * 1024 });
  const parsed = parseJsonc(text, { fileName: 'ui/_ui_defs.json', allowTrailingComma: true });
  if (!parsed.ok) return null;
  return Array.isArray(parsed.value?.ui_defs) ? parsed.value.ui_defs.length : null;
}

async function countGlobalVariables(result) {
  const actual = findPath(result.packPaths, 'ui/_global_variables.json');
  if (!actual) return null;
  const text = await result.zipReader.readText(`${result.rootPrefix}${actual}`, { maxBytes: 8 * 1024 * 1024 });
  const parsed = parseJsonc(text, { fileName: 'ui/_global_variables.json', allowTrailingComma: true });
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return null;
  const variables = parsed.value.variables && typeof parsed.value.variables === 'object' && !Array.isArray(parsed.value.variables)
    ? parsed.value.variables
    : parsed.value;
  return Object.keys(variables).filter((key) => key !== '$schema').length;
}

async function parsesJsonObject(result, path) {
  const actual = findPath(result.packPaths, path);
  if (!actual) return false;
  const text = await result.zipReader.readText(`${result.rootPrefix}${actual}`, { maxBytes: 8 * 1024 * 1024 });
  const parsed = parseJsonc(text, { fileName: path, allowTrailingComma: true });
  return Boolean(parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value));
}

async function countLanguageEntries(result) {
  const path = 'texts/en_US.lang';
  const actual = findPath(result.packPaths, path);
  if (!actual) return null;
  const text = await result.zipReader.readText(`${result.rootPrefix}${actual}`, { maxBytes: 8 * 1024 * 1024 });
  return text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#') && line.includes('=')).length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  failureCorrelationSessionId = args.sessionId;
  const info = await stat(args.zipPath);
  if (!info.isFile()) throw new Error('ZIP_INPUT_NOT_REGULAR_FILE');
  const digest = await sha256File(args.zipPath);
  if (args.expectedSha256 && digest !== args.expectedSha256) {
    throw new Error('VANILLA_ARCHIVE_SHA256_MISMATCH');
  }
  const provenanceCheck = await verifyOfficialReleaseAsset({
    sourceAssetUrl: args.sourceAssetUrl,
    sourceRelease: args.sourceRelease,
    sourceChannel: args.sourceChannel,
    localDigest: digest,
  });
  const sourceProvenanceVerified = provenanceCheck.result_code === 'OFFICIAL_RELEASE_ASSET_VERIFIED';
  const archiveIdentityVerified = provenanceCheck.asset_digest_match === true;
  const blob = await openAsBlob(args.zipPath, { type: 'application/zip' });
  const file = new File([blob], 'vanilla-resource-pack.zip', { type: 'application/zip' });
  const imported = await importResourcePackZip(file, { previewLimit: 0 });
  if (!imported.ok) {
    const error = new Error('VANILLA_PACK_IMPORT_FAILED');
    error.cause = imported.error;
    throw error;
  }

  try {
    const [uiDefsEntryCount, globalVariableCount, hudScreenParsed, uiCommonParsed, languageEntryCount] = await Promise.all([
      countUiDefs(imported),
      countGlobalVariables(imported),
      parsesJsonObject(imported, 'ui/hud_screen.json'),
      parsesJsonObject(imported, 'ui/ui_common.json'),
      countLanguageEntries(imported),
    ]);
    const audit = auditVanillaReference({
      packPaths: imported.packPaths,
      manifestValidation: imported.manifestValidation,
      expectedBedrockVersion: args.expectedBedrockVersion,
      sourceRelease: args.sourceRelease,
      expectedChannel: args.expectedChannel,
      sourceChannel: args.sourceChannel,
      uiDefsEntryCount,
      globalVariableCount,
      hudScreenParsed,
      uiCommonParsed,
      languageEntryCount,
      sourceProvenanceVerified,
      archiveIdentityVerified,
    });
    const accepted = audit.verifiedReferenceInputReady === true;
    return {
      schema_version: 'jsonui.vanilla-pack-cli-audit.v1',
      timestamp: new Date().toISOString(),
      event: 'VANILLA_PACK_AUDIT_COMPLETED',
      outcome: accepted ? 'success' : 'partial',
      validation_status: accepted ? 'PASS' : 'WARN',
      correlation: { session_id: args.sessionId },
      file: { bytes: info.size, sha256: digest, local_path_included: false, original_name_included: false },
      source_receipt: {
        online_github_asset_verified: sourceProvenanceVerified,
        official_digest_match: archiveIdentityVerified,
        operator_expected_sha_match: args.expectedSha256 ? args.expectedSha256 === digest : null,
        source_release: args.sourceRelease,
        source_url_included: false,
        provenance_check: provenanceCheck,
      },
      audit,
    };
  } finally {
    await imported.zipReader.close();
  }
}

try {
  const result = await main();
  console.log(JSON.stringify(result, null, 2));
  if (result.validation_status !== 'PASS') process.exitCode = 2;
} catch (error) {
  console.log(JSON.stringify({
    schema_version: 'jsonui.vanilla-pack-cli-audit.v1',
    timestamp: new Date().toISOString(),
    event: 'VANILLA_PACK_AUDIT_FAILED',
    outcome: 'failure',
    validation_status: 'FAIL',
    correlation: { session_id: failureCorrelationSessionId },
    error: {
      code: error instanceof Error ? error.message : 'VANILLA_PACK_AUDIT_FAILED',
      category: 'input_or_processing',
      message: 'Vanilla Resource Pack audit failed. Verify the ZIP and options.',
      retryable: false,
    },
  }, null, 2));
  process.exitCode = 1;
}
