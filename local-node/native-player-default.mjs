/** Node filesystem adapter for an optional, privately installed player reference. */
import { open } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { createDefaultPlayerRuntime, DEFAULT_PLAYER_ASSET_BASE } from '../editor-core/src/preview/native-player-default.js';

let runtime;

const REQUIRED_FILES = Object.freeze([
  'entity/player.entity.json',
  'models/entity/humanoid.custom.geo.json',
  'textures/entity/steve.png',
]);

/**
 * The public source package intentionally contains no Minecraft assets. An
 * optional reference must not advertise phantom files: version selection
 * inspects all client-entity candidates, including lower-priority layers.
 * Keeping missing paths there would poison a valid imported player model.
 * assetBase is a host-owned local URL, never an HTTP request parameter.
 */
export function createNodeDefaultPlayerRuntime(assetBase = DEFAULT_PLAYER_ASSET_BASE) {
  const installed = REQUIRED_FILES.every(path => {
    try { return statSync(new URL(path, assetBase)).isFile(); } catch { return false; }
  });
  if (!installed) return Object.freeze({
    rootPrefix: '', packPaths: Object.freeze([]),
    assetAvailability: 'not-installed', issue: 'DEFAULT_PLAYER_REFERENCE_NOT_INSTALLED',
    zipReader: Object.freeze({ entryIndex: new Map(),
      async readText() { throw new Error('DEFAULT_PLAYER_REFERENCE_NOT_INSTALLED'); },
      async readBlob() { throw new Error('DEFAULT_PLAYER_REFERENCE_NOT_INSTALLED'); },
    }),
  });
  return createDefaultPlayerRuntime({
    async readBytes(path, { signal, maxBytes }) {
      const file = await open(new URL(path, assetBase), 'r');
      try {
        const metadata = await file.stat();
        if (!metadata.isFile() || metadata.size > maxBytes) throw new Error('DEFAULT_PLAYER_READ_LIMIT');
        const data = new Uint8Array(maxBytes + 1);
        let count = 0;
        while (count < data.length) {
          if (signal?.aborted) throw new Error('NATIVE_PREVIEW_ABORTED');
          const { bytesRead } = await file.read(data, count, data.length - count, count);
          if (!bytesRead) break;
          count += bytesRead;
        }
        if (count > maxBytes) throw new Error('DEFAULT_PLAYER_READ_LIMIT');
        return data.subarray(0, count);
      } finally { await file.close(); }
    },
  });
}

/** Return one immutable source identity so the bounded native JSON cache works. */
export function getDefaultPlayerRuntime() {
  // Installed optional references are read on first use. Restart the server
  // after changing local reference files so this immutable identity is reset.
  runtime ??= createNodeDefaultPlayerRuntime();
  return runtime;
}
