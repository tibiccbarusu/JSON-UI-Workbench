/*
  Verify a local Vanilla archive against independently retrieved GitHub
  Release asset metadata. URL shape or an operator-supplied digest alone is
  never sufficient for a verified result.
*/

export function verifyOfficialReleaseUrl(rawUrl, sourceRelease) {
  if (!rawUrl || !sourceRelease) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com'
      || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return false;
    const parts = parsed.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts.length !== 6) return false;
    if (parts[0].toLowerCase() !== 'mojang' || parts[1].toLowerCase() !== 'bedrock-samples') return false;
    if (parts[2] !== 'releases' || parts[3] !== 'download') return false;
    return parts[4] === String(sourceRelease).trim() && Boolean(parts[5]);
  } catch {
    return false;
  }
}

/**
 * @param {{sourceAssetUrl?:string|null,sourceRelease?:string|null,sourceChannel?:string|null,localDigest?:string|null}} input
 * @param {{fetchImpl?:typeof fetch,timeoutMs?:number}} [options]
 */
export async function verifyOfficialReleaseAsset(input = {}, options = {}) {
  const sourceAssetUrl = String(input.sourceAssetUrl || '');
  const sourceRelease = String(input.sourceRelease || '');
  const sourceChannel = String(input.sourceChannel || '').toLowerCase();
  const localDigest = String(input.localDigest || '').toLowerCase();
  const base = {
    checked_online: false,
    official_url_shape_valid: verifyOfficialReleaseUrl(sourceAssetUrl, sourceRelease),
    release_tag_match: false,
    release_channel_match: false,
    full_asset_match: false,
    asset_digest_available: false,
    asset_digest_match: false,
    result_code: 'OFFICIAL_ASSET_NOT_CHECKED',
  };
  if (!base.official_url_shape_valid) return { ...base, result_code: 'OFFICIAL_ASSET_URL_INVALID_OR_MISSING' };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ...base, result_code: 'OFFICIAL_METADATA_FETCH_UNAVAILABLE' };

  const apiUrl = `https://api.github.com/repos/Mojang/bedrock-samples/releases/tags/${encodeURIComponent(sourceRelease)}`;
  let timer;
  const controller = new AbortController();
  try {
    const timeoutMs = Math.max(1000, Math.min(60000, Number(options.timeoutMs) || 15000));
    // Bound headers and the complete JSON body, including host adapters that
    // ignore AbortSignal. A late response cannot install a verified result.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error('OFFICIAL_METADATA_TIMEOUT'), { name: 'TimeoutError' });
        reject(error);
        controller.abort(error);
      }, timeoutMs);
    });
    const response = await Promise.race([Promise.resolve().then(() => fetchImpl(apiUrl, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'jsonui-web-editor-s066-vanilla-audit',
        'x-github-api-version': '2022-11-28',
      },
      signal: controller.signal,
      redirect: 'error',
    })), deadline]);
    if (!response?.ok) return { ...base, checked_online: true, result_code: `OFFICIAL_METADATA_HTTP_${response?.status || 'UNKNOWN'}` };
    const release = await Promise.race([Promise.resolve().then(() => response.json()), deadline]);
    const releaseTagMatch = release?.tag_name === sourceRelease;
    const expectedPrerelease = sourceChannel === 'preview';
    const knownChannel = expectedPrerelease || sourceChannel === 'stable';
    const tagDeclaresPreview = /(?:-preview|-beta)$/i.test(sourceRelease);
    const sourceChannelMatchesTag = knownChannel && tagDeclaresPreview === expectedPrerelease;
    const releaseChannelMatch = sourceChannelMatchesTag
      && typeof release?.prerelease === 'boolean'
      && release.prerelease === expectedPrerelease;
    const asset = Array.isArray(release?.assets)
      ? release.assets.find((item) => item?.browser_download_url === sourceAssetUrl)
      : null;
    const expectedFullAssetName = `bedrock-samples-${sourceRelease}-full.zip`;
    const fullAssetMatch = Boolean(asset && String(asset.name || '') === expectedFullAssetName);
    const officialDigest = typeof asset?.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)
      ? asset.digest.toLowerCase()
      : null;
    const assetDigestMatch = officialDigest === `sha256:${localDigest}`;
    const resultCode = !releaseTagMatch
      ? 'OFFICIAL_RELEASE_TAG_MISMATCH'
      : !releaseChannelMatch
        ? 'OFFICIAL_RELEASE_CHANNEL_MISMATCH'
        : !asset
          ? 'OFFICIAL_RELEASE_ASSET_NOT_FOUND'
          : !fullAssetMatch
            ? 'OFFICIAL_RELEASE_ASSET_NOT_FULL'
            : !officialDigest
              ? 'OFFICIAL_RELEASE_DIGEST_UNAVAILABLE'
              : !assetDigestMatch
                ? 'OFFICIAL_RELEASE_DIGEST_MISMATCH'
                : 'OFFICIAL_RELEASE_ASSET_VERIFIED';
    return {
      ...base,
      checked_online: true,
      release_tag_match: releaseTagMatch,
      release_channel_match: releaseChannelMatch,
      full_asset_match: fullAssetMatch,
      asset_digest_available: Boolean(officialDigest),
      asset_digest_match: assetDigestMatch,
      result_code: resultCode,
    };
  } catch (error) {
    const category = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT' : 'FAILED';
    return { ...base, result_code: `OFFICIAL_METADATA_FETCH_${category}` };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
