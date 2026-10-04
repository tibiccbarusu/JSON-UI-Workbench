/** R38 read-only MCADDON selection. Node >=22.14; no BP script is evaluated.
 * Nested ZIP depth is one; ordinary RP ZIPs retain the existing disk reader. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { DiskZipReader } from './disk-zip.mjs';
import { ResourceZipReader } from './resource-zip.mjs';
import { LIMITS, fail } from './limits.mjs';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { validateManifest, normalizeUuid } from '../editor-core/src/pack-io/manifest-utils.js';

export const ADDON_LIMITS = Object.freeze({ candidates: 32, nestedArchives: 32, manifestBytes: 1024 * 1024,
  nestedReadBytes: 128 * 1024 * 1024, nestedArchiveBytes: LIMITS.entryBytes, depth: 1 });
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const sha = value => createHash('sha256').update(value).digest('hex');
export function checkedAddonSelection(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) fail('ADDON_RESOURCE_SELECTOR_INVALID');
  return value.toLowerCase();
}
export function publicAddonCandidates(value) {
  if (!Array.isArray(value) || value.length > ADDON_LIMITS.candidates) return undefined;
  return value.filter(item => item && UUID.test(item.uuid) && typeof item.path === 'string' && item.path.length <= 2050)
    .map(item => ({ uuid: item.uuid.toLowerCase(), path: item.path.slice(0, 512),
      path_truncated: item.path_truncated === true || item.path.length > 512, name: String(item.name || '').slice(0, 128) }));
}
function addonError(code, candidates) {
  const error = new Error(code); error.code = code; error.status = 409;
  error.addonCandidates = publicAddonCandidates(candidates); throw error;
}

/** Presents only the selected RP's paths to the existing pack importer. */
export class AddonResourceReader {
  constructor({ resourcePack } = {}) { this.selection = checkedAddonSelection(resourcePack); this.entryIndex = new Map(); this.closed = false; }
  async openFromFile(file) {
    this.file = file; this.outer = new DiskZipReader();
    await this.outer.openFromFile(file);
    const indexed = await this.outer.listEntries();
    const totals = { entries: indexed.meta.entryCount, expandedBytes: indexed.meta.totalUncompressedBytes,
      nestedReadBytes: 0, nestedArchives: 0, manifests: 0 };
    const candidates = [], identities = new Set();
    const charge = meta => {
      totals.entries += meta.entryCount; totals.expandedBytes += meta.totalUncompressedBytes;
      if (totals.entries > LIMITS.entries) fail('ADDON_ENTRY_COUNT_LIMIT', 413);
      if (totals.expandedBytes > LIMITS.expandedBytes) fail('ADDON_EXPANDED_TOTAL_LIMIT', 413);
    };
    const inspect = async (reader, containerPath, archiveHash) => {
      const paths = await reader.listAllFilePaths();
      if (containerPath && paths.some(key => /\.(?:zip|mcpack|mcaddon)$/iu.test(key))) fail('ADDON_NESTING_DEPTH_LIMIT', 413);
      const manifests = paths.filter(key => /(?:^|\/)manifest\.json$/iu.test(key));
      if (!manifests.length && containerPath) fail('ADDON_MANIFEST_MISSING');
      for (const manifestPath of manifests) {
        if (++totals.manifests > ADDON_LIMITS.candidates) fail('ADDON_MANIFEST_COUNT_LIMIT', 413);
        const bytes = await reader.bytes(manifestPath, ADDON_LIMITS.manifestBytes);
        const parsed = parseJsonc(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { allowTrailingComma: true });
        if (!parsed.ok) fail('ADDON_MANIFEST_PARSE_FAILED');
        const validation = validateManifest(parsed.value);
        // The shared validator's RP-only requirement is classification here;
        // every other manifest error remains fatal, including on ignored BP.
        if (validation.errors.some(error => error.code !== 'MANIFEST_NO_RESOURCES_MODULE')) fail('ADDON_MANIFEST_INVALID');
        const value = parsed.value;
        for (const object of [value.header, ...value.modules]) {
          const uuid = normalizeUuid(object.uuid)?.toLowerCase();
          if (!uuid || !UUID.test(uuid)) fail('ADDON_MANIFEST_UUID_INVALID');
          if (identities.has(uuid)) fail('ADDON_UUID_COLLISION');
          identities.add(uuid);
        }
        if (validation.isResourcePack) candidates.push({ uuid: normalizeUuid(value.header.uuid).toLowerCase(),
          name: value.header.name, path: containerPath ? `${containerPath}!/${manifestPath}` : manifestPath,
          containerPath, manifestPath, archiveHash, manifestHash: sha(bytes) });
      }
    };
    await inspect(this.outer, null, null);
    const nested = [...this.outer.entryIndex].filter(([key, item]) => !item.info.directory && /\.(?:zip|mcpack|mcaddon)$/iu.test(key));
    if (nested.length > ADDON_LIMITS.nestedArchives) fail('ADDON_ARCHIVE_COUNT_LIMIT', 413);
    const readNested = async key => {
      const item = this.outer.entryIndex.get(key);
      if (item.info.uncompressedSize > ADDON_LIMITS.nestedArchiveBytes) fail('ADDON_NESTED_SIZE_LIMIT', 413);
      totals.nestedReadBytes += item.info.uncompressedSize;
      if (totals.nestedReadBytes > ADDON_LIMITS.nestedReadBytes) fail('ADDON_NESTED_READ_LIMIT', 413);
      return this.outer.bytes(key, ADDON_LIMITS.nestedArchiveBytes);
    };
    for (const [key] of nested) {
      if (/\.mcaddon$/iu.test(key)) fail('ADDON_NESTING_DEPTH_LIMIT', 413);
      const bytes = await readNested(key), reader = new DiskZipReader();
      try {
        await reader.openFromBytes(bytes, key); const result = await reader.listEntries(); charge(result.meta);
        totals.nestedArchives++; await inspect(reader, key, sha(bytes));
      } finally { await reader.close(); }
    }
    if (!candidates.length) fail('ADDON_RESOURCE_PACK_NOT_FOUND');
    if (!this.selection && candidates.length > 1) addonError('ADDON_RESOURCE_SELECTION_REQUIRED', candidates);
    const selected = this.selection ? candidates.find(item => item.uuid === this.selection) : candidates[0];
    if (!selected) addonError('ADDON_RESOURCE_SELECTION_NOT_FOUND', candidates);
    const prefix = selected.manifestPath.slice(0, -'manifest.json'.length);
    this.delegate = new ResourceZipReader({ resourceRoot: prefix });
    if (selected.containerPath) await this.delegate.openFromBytes(await readNested(selected.containerPath), selected.containerPath);
    else await this.delegate.openFromFile(file);
    this.selectedIndex = await this.delegate.listEntries();
    const virtual = [...this.delegate.entryIndex.values()].filter(item => item.info.virtual);
    if (virtual.length) charge({ entryCount: virtual.length,
      totalUncompressedBytes: virtual.reduce((sum, item) => sum + item.info.uncompressedSize, 0) });
    this.entryIndex = new Map([...this.delegate.entryIndex].filter(([key]) => key.startsWith(prefix)));
    // A second pack under the selected directory would create ambiguous roots.
    if ([...this.entryIndex.keys()].filter(key => /(?:^|\/)manifest\.json$/iu.test(key)).length !== 1) fail('ADDON_RESOURCE_ROOT_AMBIGUOUS');
    const hash = createHash('sha256'); for await (const chunk of createReadStream(file.diskPath)) hash.update(chunk);
    this.provenance = { schema: 'jsonui-addon-selection-v1', container_sha256: hash.digest('hex'),
      container_size_bytes: this.outer.size, resource_pack_size_bytes: selected.containerPath ? this.delegate.size : null,
      resource_pack_uuid: selected.uuid, resource_pack_path: selected.path,
      resource_pack_sha256: selected.archiveHash, manifest_sha256: selected.manifestHash,
      resource_hash_scope: selected.containerPath ? 'nested-archive-bytes' : 'directory-manifest-only',
      candidates: publicAddonCandidates(candidates), budgets: { ...totals, limits: ADDON_LIMITS }, behavior_scripts_executed: false };
    await this.outer.close(); this.outer = null;
  }
  async listEntries() { if (this.closed) fail('ZIP_CLOSED');
    const entries = [...this.entryIndex.values()], directories = entries.filter(item => item.info.directory).length;
    return { ...this.selectedIndex, meta: { ...this.selectedIndex.meta, fileName: this.file.name,
      entryCount: entries.length, fileCount: entries.length - directories, dirCount: directories,
      totalUncompressedBytes: entries.reduce((sum, item) => sum + item.info.uncompressedSize, 0),
      blockedReadCount: entries.filter(item => item.info.blockedReason).length, container: this.provenance } }; }
  async listAllFilePaths() { return [...this.entryIndex].filter(([, item]) => !item.info.directory).map(([key]) => key); }
  async bytes(key, maximum) { if (this.closed) fail('ZIP_CLOSED'); if (!this.entryIndex.has(key)) fail('ZIP_ENTRY_NOT_FOUND', 404); return this.delegate.bytes(key, maximum); }
  async readText(key, options = {}) { return new TextDecoder(options.encoding || 'utf-8', { fatal: true, ignoreBOM: true }).decode(await this.bytes(key, options.maxBytes ?? LIMITS.textBytes)); }
  async readBlob(key, options = {}) { return new Blob([await this.bytes(key, options.maxBytes)], { type: options.mimeType || '' }); }
  async close() { if (this.closed) return; this.closed = true;
    try { await this.outer?.close(); } finally { try { await this.delegate?.close(); } finally { this.entryIndex.clear(); } } }
}
