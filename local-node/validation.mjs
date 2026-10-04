import { fail, LIMITS } from './limits.mjs';
import { loadPackItemIconIndex } from './item-icon-index.mjs';
import { buildAssetIndexFromPackPaths } from '../editor-core/src/assets/asset-indexer.js';
import { parseLangFile } from '../editor-core/src/assets/lang-table.js';
import { ITEM_TEXTURE_ATLAS_MAX_TEXT_BYTES, ITEM_TEXTURE_ATLAS_PACK_PATH, parseItemTextureAtlas } from '../editor-core/src/preview/native-renderer-preview.js';
import { buildUiScreenModelFromJson, VALID_UI_ELEMENT_TYPES } from '../editor-core/src/model/ui-screen-model.js';
import { evaluateBindingsWithRepresentativeRuntime } from '../editor-core/src/engine/preview-bindings-runtime.js';
import { buildRepresentativeClassicRuntimeVariableNames } from '../editor-core/src/engine/representative-classic-runtime.js';
import { validateUiScreenModel } from '../editor-core/src/validation/validator.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
export const VALIDATION_LIMITS = Object.freeze({ stateBytes: 1024 * 1024, nativeBytes: 128 * 1024,
  sourceCacheBytes: 8 * 1024 * 1024, sourceCacheEntries: 2, resultBytes: 8 * 1024 * 1024 });

export function checkedValidationRequest(input) {
  if (!object(input) || Object.keys(input).some(key => !['projectionId', 'filePath', 'recordId', 'mockData', 'locale', 'nativeModelPreviews', 'nativeTextureFailures'].includes(key))) fail('NODE_VALIDATION_REQUEST_INVALID');
  const mockData = input.mockData ?? {}, nativeModelPreviews = input.nativeModelPreviews ?? {}, nativeTextureFailures = input.nativeTextureFailures ?? {};
  if (!object(mockData) || Object.keys(mockData).length > 50000 || Object.keys(mockData).some(key => FORBIDDEN.has(key))) fail('NODE_VALIDATION_STATE_INVALID');
  if (Buffer.byteLength(JSON.stringify(mockData)) > VALIDATION_LIMITS.stateBytes) fail('NODE_VALIDATION_STATE_LIMIT', 413);
  if (!object(nativeModelPreviews) || !object(nativeTextureFailures) || Object.keys(nativeTextureFailures).length > 1024
    || Object.entries(nativeTextureFailures).some(([key, value]) => FORBIDDEN.has(key) || key.length > 2048 || typeof value !== 'string' || value.length > 256)) fail('NODE_VALIDATION_NATIVE_INVALID');
  if (Buffer.byteLength(JSON.stringify({ nativeModelPreviews, nativeTextureFailures })) > VALIDATION_LIMITS.nativeBytes) fail('NODE_VALIDATION_NATIVE_LIMIT', 413);
  const locale = input.locale ?? 'en_US';
  if (typeof locale !== 'string' || !/^[a-z]{2}_[A-Z]{2}$/u.test(locale)) fail('NODE_VALIDATION_LOCALE_INVALID');
  return { ...input, mockData, locale, nativeModelPreviews, nativeTextureFailures };
}

/** Private ZIP identities and catalog generations determine these contexts.
 * No browser-provided asset index, language table or model is authoritative. */
export async function buildValidationSourceContext(sources, packFor, globalVariables, locale) {
  const context = { importedIndex: null, vanillaIndex: null, langTable: Object.create(null),
    globalVarNames: new Set(Object.keys(globalVariables || {})),
    itemTextureAtlases: { importedAtlas: null, vanillaAtlas: null, importedStatus: 'unavailable',
      vanillaStatus: 'unavailable', importedIssue: null, vanillaIssue: null, pending: false } };
  let bytes = 0;
  for (const source of [...sources].sort((a, b) => (a.kind === 'vanilla' ? 0 : 1) - (b.kind === 'vanilla' ? 0 : 1))) {
    const item = packFor(source.id), overrides = source.overrides || {};
    item.assetIndex ||= buildAssetIndexFromPackPaths(item.packPaths);
    context[source.kind + 'Index'] = item.assetIndex;
    try {
      const index = await loadPackItemIconIndex(item, overrides);
      context.itemTextureAtlases[source.kind + 'Items'] = index;
      context.itemTextureAtlases[source.kind + 'ItemsStatus'] = 'ready';
      bytes += Buffer.byteLength(JSON.stringify(index));
    } catch {
      context.itemTextureAtlases[source.kind + 'ItemsStatus'] = 'error';
    }
    const wanted = name => [...new Set([...item.packPaths, ...Object.keys(overrides)])].find(p => p.toLowerCase() === name.toLowerCase());
    const read = async (name, maxBytes) => {
      if (Object.hasOwn(overrides, name)) {
        if (Buffer.byteLength(overrides[name]) > maxBytes) fail('ZIP_ENTRY_READ_LIMIT', 413);
        return overrides[name];
      }
      return item.zipReader.readText(item.rootPrefix + name, { maxBytes });
    };
    const language = wanted(`texts/${locale}.lang`);
    if (language) {
      const text = await read(language, LIMITS.textBytes), parsed = parseLangFile(text);
      if (parsed.stats.truncated) fail('LANG_ENTRY_LIMIT');
      Object.assign(context.langTable, parsed.table); bytes += Buffer.byteLength(text);
    }
    const atlas = wanted(ITEM_TEXTURE_ATLAS_PACK_PATH), status = source.kind + 'Status';
    context.itemTextureAtlases[status] = 'missing';
    if (atlas) {
      // Atlas errors remain explicit reference diagnostics rather than taking
      // the whole UI validation down; they never become a ready empty atlas.
      try {
        const text = await read(atlas, ITEM_TEXTURE_ATLAS_MAX_TEXT_BYTES), parsed = parseItemTextureAtlas(text);
        bytes += Buffer.byteLength(text);
        if (!parsed.ok) {
          context.itemTextureAtlases[status] = 'error';
          context.itemTextureAtlases[source.kind + 'Issue'] = 'ITEM_TEXTURE_ATLAS_INVALID';
        } else {
          context.itemTextureAtlases[status] = 'ready';
          context.itemTextureAtlases[source.kind + 'Atlas'] = parsed.atlas;
        }
      } catch {
        context.itemTextureAtlases[status] = 'error';
        context.itemTextureAtlases[source.kind + 'Issue'] = 'ITEM_TEXTURE_ATLAS_READ_FAILED';
      }
    }
  }
  return { context, bytes };
}

export function validateProjectionDocument(projection, request, sourceContext) {
  const model = buildUiScreenModelFromJson(projection.document, { filePath: request.filePath });
  const qualifiedName = projection.selected.qualifiedName || '';
  const evaluated = evaluateBindingsWithRepresentativeRuntime(model, qualifiedName, request.mockData);
  const referenceContext = { ...sourceContext, evaluatedPropsById: evaluated?.propsById || null,
    runtimeVarNames: buildRepresentativeClassicRuntimeVariableNames({ qualifiedName, userVariables: request.mockData }),
    nativeModelPreviews: { bookTextureRef: 'textures/entity/enchanting_table_book', ...request.nativeModelPreviews },
    nativeTextureFailures: request.nativeTextureFailures };
  return validateUiScreenModel(model, { filePath: request.filePath, sourceJson: projection.document,
    supportedTypes: [...VALID_UI_ELEMENT_TYPES], referenceContext });
}
