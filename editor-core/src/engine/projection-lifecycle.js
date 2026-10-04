/**
 * Return the stable lifetime identity of one open preview projection.
 *
 * File records are immutable Redux values and may be replaced by validation or
 * other harmless patches. The instance id survives those patches, while a user
 * close followed by an explicit reopen receives a new id.
 */
export function readPreviewProjectionIdentity(file) {
  const fileId = String(file?.id || '');
  const instanceId = String(file?.meta?.previewProjectionInstanceId || '');
  if (!fileId || !instanceId || !file?.meta?.previewProjection) return null;
  return { fileId, instanceId };
}

/**
 * Check that an identity still names the same currently open projection.
 */
export function isOpenPreviewProjectionIdentity(state, identity) {
  const fileId = String(identity?.fileId || '');
  const instanceId = String(identity?.instanceId || '');
  if (!fileId || !instanceId) return false;
  const files = state?.files;
  const file = files?.byId?.[fileId];
  return Boolean(
    files?.openFileIds?.includes(fileId)
    && file?.meta?.previewProjection
    && String(file.meta.previewProjectionInstanceId || '') === instanceId,
  );
}
