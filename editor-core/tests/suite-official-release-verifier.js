import { test, assert, assertEqual } from './test-harness.js';
import { verifyOfficialReleaseAsset, verifyOfficialReleaseUrl } from '../src/vanilla/official-release-verifier.js';

const tag = 'v1.26.40.05';
const assetUrl = `https://github.com/Mojang/bedrock-samples/releases/download/${tag}/bedrock-samples-${tag}-full.zip`;
const localDigest = 'a'.repeat(64);

function mockRelease({ digest = `sha256:${localDigest}`, prerelease = false, url = assetUrl, name = `bedrock-samples-${tag}-full.zip` } = {}) {
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        tag_name: tag,
        prerelease,
        assets: [{ browser_download_url: url, name, digest }],
      };
    },
  });
}

test('official release verifier accepts only an exact online full-asset digest match', async () => {
  const result = await verifyOfficialReleaseAsset({
    sourceAssetUrl: assetUrl,
    sourceRelease: tag,
    sourceChannel: 'stable',
    localDigest,
  }, { fetchImpl: mockRelease() });
  assertEqual(result.result_code, 'OFFICIAL_RELEASE_ASSET_VERIFIED');
  assert(result.checked_online);
  assert(result.asset_digest_match);
});

test('official release verifier rejects a self-supplied local hash when official digest differs', async () => {
  const result = await verifyOfficialReleaseAsset({
    sourceAssetUrl: assetUrl,
    sourceRelease: tag,
    sourceChannel: 'stable',
    localDigest,
  }, { fetchImpl: mockRelease({ digest: `sha256:${'b'.repeat(64)}` }) });
  assertEqual(result.result_code, 'OFFICIAL_RELEASE_DIGEST_MISMATCH');
  assertEqual(result.asset_digest_match, false);
});

test('official release verifier rejects wrong repository URLs before network use', async () => {
  let fetched = false;
  const badUrl = assetUrl.replace('Mojang/bedrock-samples', 'attacker/bedrock-samples');
  const result = await verifyOfficialReleaseAsset({
    sourceAssetUrl: badUrl,
    sourceRelease: tag,
    sourceChannel: 'stable',
    localDigest,
  }, { fetchImpl: async () => { fetched = true; throw new Error('must not run'); } });
  assertEqual(verifyOfficialReleaseUrl(badUrl, tag), false);
  assertEqual(result.result_code, 'OFFICIAL_ASSET_URL_INVALID_OR_MISSING');
  assertEqual(fetched, false);
});

test('official release verifier enforces stable versus prerelease metadata', async () => {
  const result = await verifyOfficialReleaseAsset({
    sourceAssetUrl: assetUrl,
    sourceRelease: tag,
    sourceChannel: 'preview',
    localDigest,
  }, { fetchImpl: mockRelease({ prerelease: false }) });
  assertEqual(result.result_code, 'OFFICIAL_RELEASE_CHANNEL_MISMATCH');
});

test('official release verifier rejects preview tag suffix declared as stable', async () => {
  const previewTag = 'v1.26.40.05-preview';
  const previewUrl = `https://github.com/Mojang/bedrock-samples/releases/download/${previewTag}/bedrock-samples-${previewTag}-full.zip`;
  const result = await verifyOfficialReleaseAsset({
    sourceAssetUrl: previewUrl,
    sourceRelease: previewTag,
    sourceChannel: 'stable',
    localDigest,
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          tag_name: previewTag,
          prerelease: false,
          assets: [{ browser_download_url: previewUrl, name: `bedrock-samples-${previewTag}-full.zip`, digest: `sha256:${localDigest}` }],
        };
      },
    }),
  });
  assertEqual(result.result_code, 'OFFICIAL_RELEASE_CHANNEL_MISMATCH');
});

test('official release verifier rejects misleading asset names containing a full token', async () => {
  const misleadingUrl = `https://github.com/Mojang/bedrock-samples/releases/download/${tag}/not-full.zip`;
  const result = await verifyOfficialReleaseAsset({
    sourceAssetUrl: misleadingUrl,
    sourceRelease: tag,
    sourceChannel: 'stable',
    localDigest,
  }, { fetchImpl: mockRelease({ url: misleadingUrl, name: 'not-full.zip' }) });
  assertEqual(result.result_code, 'OFFICIAL_RELEASE_ASSET_NOT_FULL');
});

test('official release verifier rejects malformed stable metadata without a boolean prerelease field', async () => {
  const result = await verifyOfficialReleaseAsset({
    sourceAssetUrl: assetUrl,
    sourceRelease: tag,
    sourceChannel: 'stable',
    localDigest,
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          tag_name: tag,
          assets: [{ browser_download_url: assetUrl, name: `bedrock-samples-${tag}-full.zip`, digest: `sha256:${localDigest}` }],
        };
      },
    }),
  });
  assertEqual(result.result_code, 'OFFICIAL_RELEASE_CHANNEL_MISMATCH');
});
