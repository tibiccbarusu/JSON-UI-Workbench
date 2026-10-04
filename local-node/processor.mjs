import { parentPort } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { ResourceZipReader } from './resource-zip.mjs';
import { AddonResourceReader, publicAddonCandidates } from './addon-resource38.mjs';
import { LIMITS, fail } from './limits.mjs';
import { importResourcePackZip } from '../editor-core/src/pack-io/pack-importer.js';
import { parseJsonc } from '../editor-core/src/json/jsonc.js';
import { buildUiCatalog } from '../editor-core/src/engine/ui-catalog.js';
import { resolveEffectiveUi } from '../editor-core/src/engine/effective-ui-resolver.js';
import { buildAssetIndexFromPackPaths } from '../editor-core/src/assets/asset-indexer.js';
import { loadHorsePreviewFromSources, loadPlayerPreviewFromSources } from '../editor-core/src/preview/native-model-loader.js';
import { getDefaultPlayerRuntime } from './native-player-default.mjs';
import { loadPackItemIconIndex } from './item-icon-index.mjs';
import { decodeFontSheet } from './font-sheet.mjs';
import { createHash } from 'node:crypto';
import { normalizeZipPath } from '../editor-core/src/path/normalize-zip-path.js';
import { publicErrorCode } from './public-error.mjs';
import { parseLangFile } from '../editor-core/src/assets/lang-table.js';
import { decodeTgaPixels } from '../editor-core/src/assets/texture-image-cache.js';
import pngjs from './vendor/pngjs/lib/png.js';
import { ResponseCache, responseKey } from './response-cache.mjs';
import { collectPreviewAnimationDefinitions } from '../editor-core/src/engine/preview-animation.js';
import { parseFontCoverage } from './font-coverage.mjs';
import { FrameIrProcessor } from './frame-ir.mjs';
import { summarizeEvaluationQuality } from '../editor-core/src/engine/evaluation-quality.js';
import { buildUiScreenModelFromJson } from '../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../editor-core/src/editor/ui-model-tree.js';
import { prepareNodeFrameFile } from '../editor-core/src/engine/node-frame-wire.js';
import { checkedValidationRequest, buildValidationSourceContext, validateProjectionDocument, VALIDATION_LIMITS } from './validation.mjs';
import { WorkspaceSessions } from './workspace-session.mjs';
import { WorkspaceDraftProjector } from './workspace-draft-preview.mjs';
import { createJobProgress } from './job-progress.mjs';
import { summarizeWorkspaceResult } from './workspace-operation-summary.mjs';
import { sanitizeDiagnostic } from './debug-bundle.mjs';
import { createSoundResolver } from './sound-resolver.mjs';
const packs = new Map(); let current = null;
const frames = new FrameIrProcessor();
const projectionModels = new Map();
let projectionModelBuilds = 0, projectionModelHits = 0;
const draftProjector = new WorkspaceDraftProjector();
const fontCache = new Map(); let fontCacheBytes = 0;
const responseCache = new ResponseCache({ maxBytes: 32 * 1024 * 1024, maxEntries: 64 });
const projectionCache = new ResponseCache({ maxBytes: 24 * 1024 * 1024, maxEntries: 16 });
const projectionRecipes = new ResponseCache({ maxBytes: 4 * 1024 * 1024, maxEntries: 64 });
const validationCache = new ResponseCache({ maxBytes: VALIDATION_LIMITS.resultBytes, maxEntries: 16 });
let validationBuilds = 0, validationSourceBuilds = 0;
let projectionRestores = 0;
let catalogHits = 0, catalogBuilds = 0;
function clearComposition() { current = null; responseCache.clear(); projectionCache.clear(); projectionRecipes.clear(); validationCache.clear(); clearFontCache(); frames.clear(); projectionModels.clear(); draftProjector.clear(); }
function clearFontCache() { fontCache.clear(); fontCacheBytes = 0; }
function retainFontResponse(cacheKey, response) {
  const responseBytes = Buffer.byteLength(response);
  while (fontCache.size && (fontCache.size >= 32 || fontCacheBytes + responseBytes > 16 * 1024 * 1024)) {
    const key = fontCache.keys().next().value;
    fontCacheBytes -= Buffer.byteLength(fontCache.get(key)); fontCache.delete(key);
  }
  if (responseBytes <= 16 * 1024 * 1024) { fontCache.set(cacheKey, response); fontCacheBytes += responseBytes; }
  return { kind: 'json', body: response };
}
function pack(id) { const p = packs.get(id); if (!p) fail('NODE_PACK_NOT_FOUND', 404); return p; }
function catalog(id) { if (!current || current.id !== id) fail('NODE_CATALOG_STALE', 409); return current.data; }
function boundedJson(value, max = LIMITS.replyBytes) { const json = JSON.stringify(value); if (Buffer.byteLength(json) > max) fail('NODE_REPLY_LIMIT', 413); return json; }
function assetWire(index) { return Object.fromEntries(Object.entries(index).map(([k,v])=>[k,{...v,byLower:[...v.byLower]}])); }
function checkedSources(sources) {
  if(!Array.isArray(sources)||sources.length<1||sources.length>2)fail('NODE_SOURCES_INVALID');
  const kinds=new Set();
  return sources.map(source=>{
    if(!source||!['vanilla','imported'].includes(source.kind)||kinds.has(source.kind))fail('NODE_SOURCE_KIND_INVALID');
    kinds.add(source.kind);const item=pack(source.id);
    const existing=item.pathsByLower;
    const overrides=source.overrides??{};
    if(typeof overrides!=='object'||Array.isArray(overrides)||Object.keys(overrides).length>5000)fail('NODE_OVERRIDES_INVALID');
    const keys=new Set();let bytes=0;
    for(const [key,value]of Object.entries(overrides)){
      if(normalizeZipPath(key)!==key||key.split('/').some(s=>/[<>:"|?*]/u.test(s)||/[. ]$/u.test(s))||typeof value!=='string')fail('NODE_OVERRIDE_INVALID');
      const lower=key.normalize('NFC').toLowerCase();if(keys.has(lower))fail('NODE_OVERRIDE_COLLISION');keys.add(lower);
      if(existing.has(lower)&&existing.get(lower)!==key)fail('NODE_OVERRIDE_COLLISION');
      const size=Buffer.byteLength(value);bytes+=size;if(size>LIMITS.textBytes||bytes>LIMITS.jsonBytes)fail('NODE_OVERRIDE_LIMIT');
    }
    return {...source,overrides};
  });
}

const workspaces = new WorkspaceSessions({ getPack: pack, checkSources: checkedSources, invalidate: clearComposition });

async function retainedProjection(p) {
    if (p.file !== undefined || p.modelId !== undefined || typeof p.projectionId !== 'string' || !/^[0-9a-f]{64}$/u.test(p.projectionId)) fail('NODE_FRAME_PROJECTION_INVALID');
    let retained = projectionCache.get(p.projectionId);
    if (!retained) {
      const recipe = projectionRecipes.get(p.projectionId);
      if (!recipe) fail('NODE_FRAME_PROJECTION_STALE', 409);
      // A single bounded restore uses the same catalog generation and inputs.
      // Import/catalog changes clear recipes so old packs are never resurrected.
      retained = await execute('project', JSON.parse(recipe.body)); projectionRestores++;
    }
    const projection = JSON.parse(retained.body);
    if (!projection.ok || projection.nodeProjectionId !== p.projectionId) fail('NODE_FRAME_PROJECTION_STALE', 409);
    if (p.filePath !== projection.selected.filePath || (p.recordId !== undefined && p.recordId !== projection.selected.recordId)) fail('NODE_FRAME_PROJECTION_IDENTITY_MISMATCH', 409);
    return projection;
}

async function execute(action, p, checkpoint = () => {}) {
  if (action.startsWith('workspace-')) {
    if (action === 'workspace-preview-draft') {
      const draft = await workspaces.previewDraft(p, checkpoint);
      const result = draft.ok ? await draftProjector.project({ draft, getPack: pack,
        variables: p.variables, representativeCollections: p.representativeCollections, eventFactorySelections: p.eventFactorySelections, frame: p.frame, checkpoint }) : draft;
      workspaces.assertRevision(workspaces.get(p.workspaceId), p.expectedRevision);
      return { kind: 'json', body: boundedJson(result), summary: summarizeWorkspaceResult(result) };
    }
    if (action === 'workspace-export') return workspaces.export(p);
    if (action === 'workspace-catalog') return execute('catalog', { sources: workspaces.sources(p.workspaceId) });
    let result;
    if (action === 'workspace-open') result = await workspaces.open(p);
    else if (action === 'workspace-read' || action === 'workspace-status') result = workspaces.describe(workspaces.get(p.workspaceId), p.path, p.sourceId);
    else if (action === 'workspace-edit') result = await workspaces.edit(p, checkpoint);
    else if (action === 'workspace-undo') result = workspaces.history(p, 'undo');
    else if (action === 'workspace-redo') result = workspaces.history(p, 'redo');
    else if (action === 'workspace-close') result = workspaces.close(p.workspaceId);
    else fail('WORKSPACE_ACTION_UNKNOWN', 404);
    return { kind: 'json', body: boundedJson(result), summary: summarizeWorkspaceResult(result) };
  }
  if (action === 'sound-resolve') {
    catalog(p.catalogId);
    current.soundResolver ||= createSoundResolver(current.sources, pack);
    return { kind: 'json', body: boundedJson({ ...(await current.soundResolver.resolve(p)), catalogId: current.id }, 16384) };
  }
  if (action === 'validate') {
    const started = performance.now(), request = checkedValidationRequest(p), projection = await retainedProjection(request);
    const key = responseKey(request), cached = validationCache.get(key);
    if (cached) return cached;
    let source = current.validationSources.get(request.locale);
    if (!source) {
      source = await buildValidationSourceContext(current.sources, pack, current.data.globalVariables, request.locale); validationSourceBuilds++;
      if (source.bytes <= VALIDATION_LIMITS.sourceCacheBytes) {
        while (current.validationSources.size && (current.validationSources.size >= VALIDATION_LIMITS.sourceCacheEntries
          || current.validationSourceBytes + source.bytes > VALIDATION_LIMITS.sourceCacheBytes)) {
          const first = current.validationSources.keys().next().value;
          current.validationSourceBytes -= current.validationSources.get(first).bytes; current.validationSources.delete(first);
        }
        current.validationSources.set(request.locale, source); current.validationSourceBytes += source.bytes;
      }
    } else { current.validationSources.delete(request.locale); current.validationSources.set(request.locale, source); }
    const validation = validateProjectionDocument(projection, request, source.context); validationBuilds++;
    return validationCache.set(key, { kind: 'json', body: boundedJson({ schema: 'jsonui-validation-v1',
      projectionId: p.projectionId, validation, metrics: { processing: 'node-worker', durationMs: performance.now() - started } }, VALIDATION_LIMITS.resultBytes) });
  }
  if (action === 'frame') {
    if (p.projectionId === undefined) return frames.execute(p);
    // Only immutable, content-addressed projections receive retained handles.
    // Validate identity even on a warm hit; never reuse across catalog changes.
    const retained = projectionModels.get(p.projectionId);
    if (retained && frames.hasModel(retained.modelId)) {
      if (p.file !== undefined || p.modelId !== undefined) fail('NODE_FRAME_PROJECTION_INVALID');
      if (p.filePath !== retained.filePath || (p.recordId !== undefined && p.recordId !== retained.recordId)) fail('NODE_FRAME_PROJECTION_IDENTITY_MISMATCH', 409);
      projectionModels.delete(p.projectionId); projectionModels.set(p.projectionId, retained);
      projectionModelHits++;
      const { projectionId, filePath, recordId, ...request } = p;
      return frames.execute({ ...request, modelId: retained.modelId });
    }
    const projection = await retainedProjection(p);
    const uiModel = buildUiScreenModelFromJson(projection.document, { filePath: p.filePath });
    const file = prepareNodeFrameFile({ ...buildTreeFromUiScreenModel(uiModel), uiModel,
      meta: { selectedDefinition: projection.selected, resolution: { animationDefinitions: projection.animationDefinitions,
        evaluation: summarizeEvaluationQuality({ projection }) } } });
    const modelId = frames.registerModel(file);
    projectionModelBuilds++;
    while (projectionModels.size >= 8) projectionModels.delete(projectionModels.keys().next().value);
    projectionModels.set(p.projectionId, { modelId, filePath: projection.selected.filePath, recordId: projection.selected.recordId });
    const { projectionId, filePath, recordId, ...request } = p;
    return frames.execute({ ...request, modelId });
  }
  if (action === 'import') {
    if (packs.size >= LIMITS.packs || packs.has(p.id)) fail('NODE_PACK_LIMIT', 429);
    const reader = /\.mcaddon$/iu.test(p.name) ? new AddonResourceReader({ resourcePack: p.resourcePack }) : new ResourceZipReader();
    const result = await importResourcePackZip({ diskPath: p.path, name: p.name, size: p.size }, { zipReader: reader });
    if (!result.ok) throw result.error;
    try {
      const { zipReader, ...metadata } = result;
      const entries = [...reader.entryIndex.values()].map(x=>x.info);
      const response = boundedJson({ ...metadata, id: p.id, entries }, LIMITS.jsonBytes);
      packs.set(p.id, { ...result, assetIndex: null, pathsByLower: new Map(result.packPaths.map(key=>[key.normalize('NFC').toLowerCase(),key])) }); clearComposition(); workspaces.clear();
      return { kind: 'json', body: response, packSummary:{entryCount:metadata.zipMeta?.entryCount??null} };
    } catch (error) { await reader.close(); throw error; }
  }
  if (action === 'remove') { const item = packs.get(p.id); if (item) { await item.zipReader.close(); packs.delete(p.id); clearComposition(); workspaces.clear(); } return { kind: 'json', body: '{"ok":true}' }; }
  if (action === 'read') { const bytes = await pack(p.id).zipReader.bytes(p.path, p.maxBytes); return { kind: 'bytes', body: bytes }; }
  if (action === 'preview-image') {
    if (typeof p.path !== 'string' || !/\.tga$/iu.test(p.path)) fail('NODE_TEXTURE_FORMAT_UNSUPPORTED',415);
    // Validate the caller's read cap before cache lookup; a warm cache must not bypass a smaller cap.
    const item = pack(p.id), normalizedPath = normalizeZipPath(p.path), entry = item.zipReader.entryIndex.get(normalizedPath)?.info;
    if (!entry) fail('ZIP_ENTRY_NOT_FOUND',404);
    if (entry.uncompressedSize > p.maxBytes) fail('ZIP_ENTRY_READ_LIMIT',413);
    const key = 'image:' + responseKey(p), cached = responseCache.get(key);
    if (cached) return cached;
    const bytes = await pack(p.id).zipReader.bytes(p.path,p.maxBytes);
    const decoded = decodeTgaPixels(bytes,{maxPixels:16*1024*1024,maxDecodedBytes:64*1024*1024});
    const png = pngjs.PNG.sync.write({width:decoded.width,height:decoded.height,data:Buffer.from(decoded.data)},{deflateLevel:3});
    if (png.byteLength > LIMITS.entryBytes) fail('NODE_TEXTURE_OUTPUT_LIMIT',413);
    return responseCache.set(key,{kind:'bytes',body:png,mimeType:'image/png'});
  }
  if (action === 'item-icons') {
    const [source] = checkedSources([p.source]);
    return { kind: 'json', body: boundedJson(await loadPackItemIconIndex(pack(source.id), source.overrides), 4 * 1024 * 1024) };
  }
  if (action === 'assets') { const item = pack(p.id); item.assetIndex ||= buildAssetIndexFromPackPaths(item.packPaths); return { kind: 'json', body: boundedJson(assetWire(item.assetIndex)) }; }
  if (action === 'font-coverage') {
    const [source]=checkedSources([p.source]), item=pack(source.id), normalized=normalizeZipPath(p.path);
    if(!/\.(?:ttf|otf|woff2?|ttc)$/iu.test(normalized))fail('FONT_COVERAGE_FORMAT_INVALID',415);
    const actual=item.pathsByLower.get(normalized.normalize('NFC').toLowerCase());if(!actual)fail('FONT_COVERAGE_FILE_MISSING',404);
    const key='font-coverage:'+responseKey({id:source.id,kind:source.kind,path:actual}),cached=responseCache.get(key);if(cached)return cached;
    const bytes=await item.zipReader.bytes(item.rootPrefix+actual,8*1024*1024);
    return responseCache.set(key,{kind:'json',body:boundedJson({...parseFontCoverage(bytes),processing:'node-worker',provenance:{source:source.kind,path:actual}},2*1024*1024)});
  }
  if (action === 'font') {
    if (!/^(default8|ascii_sga|glyph_[0-9A-F]{2}|smooth_(?:remapping|[0-9A-F]{2}))$/u.test(p.sheet)||!Array.isArray(p.sources)||p.sources.length>2||!p.sources.length) fail('FONT_REQUEST_INVALID');
    const locale = /^[a-z]{2}_[A-Z]{2}$/u.test(p.locale) ? p.locale : 'en_US';
    const ordered = checkedSources(p.sources).sort((a,b)=>(a.kind==='imported'?0:1)-(b.kind==='imported'?0:1));
    const smooth = p.sheet.startsWith('smooth_');
    if (p.includePixels !== undefined && (typeof p.includePixels !== 'boolean' || p.includePixels && (!smooth || p.sheet === 'smooth_remapping'))) fail('FONT_REQUEST_INVALID');
    const cacheKey=responseKey([ordered.map(s=>[s.kind,s.id,...(smooth ? [s.overrides] : [])]),locale,p.sheet,Boolean(p.includePixels)]);
    if(fontCache.has(cacheKey)){const hit=fontCache.get(cacheKey);fontCache.delete(cacheKey);fontCache.set(cacheKey,hit);return {kind:'json',body:hit};}
    if (smooth) {
      const { loadSmoothFontResource } = await import('./smooth-font37.mjs');
      return retainFontResponse(cacheKey, boundedJson(await loadSmoothFontResource({ sources: ordered, getPack: pack, sheet: p.sheet, includePixels: p.includePixels ?? false })));
    }
    for(const source of ordered){
      const item=pack(source.id);
      // The paired Classic ja_JP capture matches root glyphs exactly. Locale
      // sheets remain a fallback; this is an observed profile, not a claim
      // that every native game locale/font setting shares the same rule.
      for(const wanted of [`font/${p.sheet}.png`,`texts/${locale}/font/${p.sheet}.png`]){
        const paths=item.packPaths.filter(x=>x.toLowerCase()===wanted.toLowerCase());
        if(paths.length>1)fail('FONT_SHEET_AMBIGUOUS');
        if(!paths.length)continue;
        const bytes=await item.zipReader.bytes(item.rootPrefix+paths[0],4*1024*1024);
        const response=boundedJson({metrics:decodeFontSheet(bytes,p.sheet),png:bytes.toString('base64'),provenance:{source:source.kind,path:paths[0],resolutionProfile:'observed-classic-root-first-v1',sha256:createHash('sha256').update(bytes).digest('hex')}});
        return retainFontResponse(cacheKey,response);
      }
    }
    fail('FONT_SHEET_MISSING',404);
  }
  if (action === 'lang') {
    if(typeof p.locale!=='string'||! /^[a-z]{2}_[A-Z]{2}$/u.test(p.locale))fail('LANG_LOCALE_INVALID');
    const ordered=checkedSources(p.sources).sort((a,b)=>(a.kind==='vanilla'?0:1)-(b.kind==='vanilla'?0:1));
    const key = 'lang:' + responseKey({ locale:p.locale,sources:ordered }), cached = responseCache.get(key);
    if (cached) return cached;
    const table=Object.create(null),stats={vanilla:null,imported:null},sources=[];
    for(const source of ordered){
      const item=pack(source.id),wanted=`texts/${p.locale}.lang`;
      const paths=[...new Set([...item.packPaths,...Object.keys(source.overrides)])].filter(x=>x.toLowerCase()===wanted.toLowerCase());
      if(paths.length>1)fail('LANG_FILE_AMBIGUOUS');if(!paths.length)continue;
      const file=paths[0];
      const text=Object.hasOwn(source.overrides,file)?source.overrides[file]:await item.zipReader.readText(item.rootPrefix+file,{maxBytes:LIMITS.textBytes});
      const parsed=parseLangFile(text);if(parsed.stats.truncated)fail('LANG_ENTRY_LIMIT');
      Object.assign(table,parsed.table);stats[source.kind]=parsed.stats;sources.push(`${source.kind}:${file}`);
    }
    return responseCache.set(key,{kind:'json',body:boundedJson({table,stats,sources,processing:'node-worker'})});
  }
  if (action === 'horse' || action === 'player') {
    const checked = checkedSources(p.sources), key = action + ':' + responseKey({...p,sources:checked}), cached = responseCache.get(key);
    if (cached) return cached;
    const sources = checked
      .sort((a,b)=>(a.kind==='imported'?0:1)-(b.kind==='imported'?0:1)).map(s=>{
      return { source:s.kind,runtime:{...pack(s.id),overridesTextByPackPath:s.overrides||{}} };
    });
    const loader = action === 'horse' ? loadHorsePreviewFromSources : loadPlayerPreviewFromSources;
    if (action === 'player') sources.push({ source: 'default-player', runtime: getDefaultPlayerRuntime() });
    return responseCache.set(key,{kind:'json',body:boundedJson(await loader({sources,targetEngineVersion:p.targetEngineVersion,previewState:p.previewState,camera:p.camera,cacheDocuments:true}))});
  }
  if (action === 'catalog') {
    const checked = checkedSources(p.sources), key = responseKey(checked);
    if (current?.key === key) { catalogHits++; return { kind:'json',body:current.response }; }
    const sources = checked.map(source => {
      const item=pack(source.id),overrides=source.overrides;
      return { id: source.kind === 'vanilla' ? 'vanilla-reference' : 'imported-pack', kind: source.kind,
        precedence: source.kind === 'vanilla' ? 10 : 20, filePaths: [...new Set([...item.packPaths,...Object.keys(overrides)])],
        readText: (path, opts) => Object.hasOwn(overrides,path) ? Promise.resolve(overrides[path]) : item.zipReader.readText(item.rootPrefix+path,opts) };
    });
    current = null; projectionCache.clear(); projectionRecipes.clear(); validationCache.clear(); frames.clear(); projectionModels.clear(); catalogBuilds++;
    const data = await buildUiCatalog({ sources, parseJsonc,
      onProgress: progress => checkpoint(`catalog-${progress.phase}`, progress.processed, progress.total) });
    const id = randomUUID();
    const { recordsById, filesById, records, ...rest } = data;
    const response = boundedJson({ ...rest, records: records.map(({ value, ...r })=>r), nodeCatalogId: id });
    current = { id, data, key, response, sources: checked, validationSources: new Map(), validationSourceBytes: 0,
      animationDefinitions:collectPreviewAnimationDefinitions(data) };
    return { kind:'json', body:response };
  }
  if (action === 'project') {
    const c = catalog(p.catalogId), r = c.recordsById[p.recordId];
    if (!r) fail('UI_DEFINITION_NOT_FOUND',404);
    if (r.profile === 'pocket') fail('POCKET_PREVIEW_BLOCKED',422);
    const key = responseKey(p), cached = projectionCache.get(key);
    if (cached) return cached;
    const result = resolveEffectiveUi({ catalog:c,recordId:r.id,variables:p.variables,representativeCollections:p.representativeCollections,eventFactorySelections:p.eventFactorySelections });
    if (result.ok) { result.animationDefinitions = current.animationDefinitions; result.nodeProjectionId = key; projectionRecipes.set(key, { kind: 'json', body: boundedJson(p, LIMITS.jsonBytes) }); }
    return projectionCache.set(key,{ kind:'json', body:boundedJson(result) });
  }
  if (action === 'hydrate') {
    const c=catalog(p.catalogId);
    if (!Number.isSafeInteger(p.offset) || p.offset<0) fail('NODE_OFFSET_INVALID');
    return { kind:'json',body:boundedJson(c.records.slice(p.offset,p.offset+32).map(r=>({id:r.id,value:r.value}))) };
  }
  fail('NODE_ACTION_UNKNOWN',404);
}
parentPort.on('message', async ({id,action,payload,cancellation}) => {
  const checkpoint = createJobProgress({ cancellation: action === 'workspace-preview-draft' ? cancellation : undefined,
    send: progress => parentPort.postMessage({ id, progress }) });
  try { checkpoint('starting'); const value = await execute(action,payload,checkpoint); parentPort.postMessage({id,ok:true,value,metrics:{workspace_batches:workspaces.snapshot(),draft_projection:draftProjector.snapshot(),response_cache:responseCache.snapshot(),projection_cache:projectionCache.snapshot(),projection_recipes:projectionRecipes.snapshot(),projection_restores:projectionRestores,projection_models:{builds:projectionModelBuilds,hits:projectionModelHits,entries:projectionModels.size},catalog:{builds:catalogBuilds,hits:catalogHits},validation:{builds:validationBuilds,source_builds:validationSourceBuilds,source_entries:current?.validationSources.size||0,source_bytes:current?.validationSourceBytes||0,result_cache:validationCache.snapshot()},zip_io:[...packs].map(([packId,item])=>({id:packId,...item.zipReader.reader?.snapshot()})),font_cache:{entries:fontCache.size,bytes:fontCacheBytes},frame_ir:frames.snapshot(),worker_memory:process.memoryUsage()}}); }
  catch(error) { parentPort.postMessage({id,ok:false,error:publicErrorCode(error),status:error.status||400,
    ...(error.addonCandidates ? { addonCandidates: publicAddonCandidates(error.addonCandidates) } : {}),
    ...(typeof error.category === 'string' ? {category:error.category.slice(0,80)} : {}),
    ...(typeof error.retryable === 'boolean' ? {retryable:error.retryable} : {}),
    diagnostic: sanitizeDiagnostic({ name: error?.name, code: publicErrorCode(error), message: error?.message,
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, 4096) : null, details: error?.details || error?.detail || null }).data }); }
});
