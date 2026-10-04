/** 原文編集と素材JSONを混同しない、登録情報に基づくUIファイル選択。 */
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { normalizeZipPath } from '../editor-core/src/path/normalize-zip-path.js';
import { LIMITS, fail } from './limits.mjs';

const rootUi = path => /^ui\/.*\.jsonc?$/iu.test(path);
const registry = path => /^ui\/_ui_defs\.jsonc?$/iu.test(path);
const global = path => /^ui\/_global_variables\.jsonc?$/iu.test(path);

export async function selectWorkspaceUiPaths(sources, getPack) {
  const rows = [], registered = new Set();
  for (const source of sources) {
    const pack = getPack(source.id);
    const paths = [...new Set([...pack.packPaths, ...Object.keys(source.overrides || {})])].sort();
    const registryPath = paths.find(registry);
    if (registryPath) {
      const text = Object.hasOwn(source.overrides || {}, registryPath) ? source.overrides[registryPath]
        : await pack.zipReader.readText(pack.rootPrefix + registryPath, { maxBytes: LIMITS.textBytes });
      if (Buffer.byteLength(text) > LIMITS.textBytes) fail('WORKSPACE_UI_DEFS_LIMIT', 413);
      const parsed = parseJsonc(text, { fileName: registryPath });
      if (!parsed.ok || !Array.isArray(parsed.value?.ui_defs)) fail('WORKSPACE_UI_DEFS_INVALID', 422);
      if (parsed.value.ui_defs.length > 5000) fail('WORKSPACE_UI_DEFS_LIMIT', 413);
      for (const entry of parsed.value.ui_defs) {
        if (typeof entry !== 'string' || !entry || entry.length > 1024) fail('WORKSPACE_UI_DEFS_INVALID', 422);
        const normalized = normalizeZipPath(entry);
        if (!normalized || normalized !== entry.replace(/\\/gu, '/').replace(/^\.\//u, '')
          || !/\.jsonc?$/iu.test(normalized)) fail('WORKSPACE_UI_DEFS_INVALID', 422);
        // Mojang uses pack-relative paths; a bare filename is relative to ui/.
        registered.add((normalized.includes('/') ? normalized : 'ui/' + normalized).toLowerCase());
      }
    }
    rows.push({ sourceId: source.id, paths, hasRegistry: Boolean(registryPath) });
  }
  return new Map(rows.map(row => [row.sourceId, row.paths.filter(path => registry(path) || global(path)
    || registered.has(path.toLowerCase()) || (!row.hasRegistry && rootUi(path)))]));
}
