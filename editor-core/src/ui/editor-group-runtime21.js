/** ブラウザ ESM。既存 import runtime のフィールドをグループ保存用へ写像する。 */
function versionParts(value) {
  // extractManifestSummary() は元の配列 [1, 2, 3] も文字列 "1.2.3" にする。
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value)) {
    throw Object.assign(new Error('パックのバージョンを 3 個の整数として確認できません。グループ設定を保存・読込できません。'), { code: 'GROUP_FILE_PACK_VERSION_REQUIRED' });
  }
  const parts = value.split('.').map(Number);
  if (!parts.every(part => Number.isSafeInteger(part) && part <= 2147483647)) {
    throw Object.assign(new Error('パックのバージョンがグループ設定の許容範囲外です。'), { code: 'GROUP_FILE_PACK_VERSION_REQUIRED' });
  }
  return parts;
}

/**
 * workspaceSources() と同じ vanilla → imported 順。session ID は保存しない。
 * @param {{vanilla?: object|null, imported?: object|null}} runtimes 既存の runtime handle。
 * @returns {object[]} UUID・パス・件数の厳密検証は editor-group-file21 の境界が行う。
 */
export function groupPackContext21({ vanilla = null, imported = null } = {}) {
  return [['vanilla', vanilla], ['imported', imported]].filter(([, runtime]) => runtime).map(([kind, runtime]) => {
    const header = runtime.manifestSummary?.header;
    return { kind, uuid: header?.uuid, version: versionParts(header?.version), rootPrefix: runtime.rootPrefix,
      entryCount: Array.isArray(runtime.packPaths) ? runtime.packPaths.length : undefined };
  });
}
