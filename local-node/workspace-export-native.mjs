/** 有限の pack 宣言から確定できる native UI 素材だけを列挙する。 */
import { indexItemTextureAtlas, buildPrunedItemTextureAtlasForExport, resolveNativeRendererTexture } from '../editor-core/src/preview/native-renderer-preview.js';
import { parseEngineVersion, compareEngineVersions } from '../editor-core/src/preview/native-model-preview.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sorted = values => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const MAX_CANDIDATES = 2048, MAX_NODES = 150000, MAX_DEPTH = 96;
const KNOWN_ENGINE_HORSE_MATERIALS = new Set(['horse_leather_armor', 'entity_alphatest', 'entity_alphatest_change_color', 'entity']);
const ENGINE_UI_RENDERERS = new Set(['progress_bar_renderer', 'hover_text_renderer', 'flying_item_renderer', 'bundle_tooltip_renderer']);
const ENGINE_ITEM_COLLECTIONS = new Set(['inventory_items', 'hotbar_items', 'combined_hotbar_and_inventory_items',
  'anvil_input_items', 'anvil_material_items', 'anvil_result_items', 'bundle_items']);
function engineInventoryBinding(props) {
  return Array.isArray(props.bindings) && props.bindings.some(binding => {
    if (binding?.binding_name === '#inventory_selected_item' && binding.binding_name_override === '#item_id_aux'
      && (binding.binding_type === undefined || binding.binding_type === 'global')) return true;
    return ['#item_renderer_data', '#item_id_aux', '#bundle_item_renderer_data', '#bundle_open_back', '#bundle_open_front'].includes(binding?.binding_name)
      && binding.binding_type === 'collection' && ENGINE_ITEM_COLLECTIONS.has(binding.binding_collection_name);
  });
}
function recordEngineInventoryDependency(ctx, usage) {
  // Arbitrary items are selected by the game, not by a finite fixed item id in
  // this UI. Engine assets remain engine dependencies. Custom item resources
  // cannot be dropped under that rule: reject until their closure is provable.
  const custom = ctx.sources.filter(source => source.kind === 'imported').flatMap(source =>
    [...source.index.values()].filter(path => /^(?:textures\/(?:item_texture\.json|terrain_texture\.json|items\/|blocks\/)|items\/|attachables\/|models\/|entity\/)/u.test(path)));
  if (custom.length) {
    ctx.diagnose('EXPORT_NATIVE_RUNTIME_CUSTOM_ASSETS_UNRESOLVED', { renderer: usage.props.renderer,
      path: usage.sourcePath, references: custom.slice(0, 16), count: custom.length }); return;
  }
  ctx.diagnose('EXPORT_NATIVE_ENGINE_INVENTORY_DEPENDENCY', { renderer: usage.props.renderer,
    path: usage.sourcePath, reason: '標準 collection が選ぶアイテムは Minecraft の実行時データと組込素材に依存します。UI 原文の binding は維持します。' }, true);
  ctx.evidence.push({ renderer: usage.props.renderer, sourcePath: usage.sourcePath,
    status: 'game-engine-runtime-inventory', completePackOwnedItemClosure: true,
    runtimeItemSelection: 'game-inventory-collection', gameAssetsBundled: false });
}
function checkAbort(ctx) { if (ctx.signal?.aborted) throw Object.assign(new Error('EXPORT_ABORTED'), { code: 'EXPORT_ABORTED' }); }
function walk(value, callback, budget = { nodes: 0 }, depth = 0, path = '$') {
  if (++budget.nodes > MAX_NODES || depth > MAX_DEPTH) throw Object.assign(new Error('EXPORT_NATIVE_SCAN_LIMIT'), { code: 'EXPORT_NATIVE_SCAN_LIMIT' });
  callback(value, path);
  if (Array.isArray(value)) value.forEach((child, i) => walk(child, callback, budget, depth + 1, `${path}[${i}]`));
  else if (object(value)) for (const [key, child] of Object.entries(value)) walk(child, callback, budget, depth + 1, `${path}.${key}`);
}

async function itemDependencies(ctx, usages) {
  const atlases = {}, layers = new Map(), retained = new Map();
  for (const source of ctx.sources) {
    const path = source.index.get('textures/item_texture.json');
    if (!path) { atlases[`${source.kind}Status`] = 'missing'; continue; }
    const document = await ctx.readJson(source, path), indexed = indexItemTextureAtlas(document);
    atlases[`${source.kind}Status`] = indexed.ok ? 'ready' : 'error';
    if (!indexed.ok) { atlases[`${source.kind}Issue`] = indexed.error; continue; }
    atlases[`${source.kind}Atlas`] = indexed.atlas;
    layers.set(source.kind, { source, path, atlas: indexed.atlas });
  }
  const resolvedIds = new Map();
  function resolve(props, location) {
    const key = JSON.stringify(props), prior = resolvedIds.get(key);
    if (prior) return prior;
    const result = resolveNativeRendererTexture(props, atlases);
    resolvedIds.set(key, result);
    if (result?.status !== 'resolved') {
      ctx.diagnose('EXPORT_NATIVE_ITEM_UNRESOLVED', { path: location.sourcePath, jsonPath: location.jsonPath, issue: result?.issue || 'runtime-item-selection' }); return result;
    }
    for (const texture of result.textureRefs || [result.textureRef]) if (texture) ctx.addTexture(texture);
    const layer = layers.get(result.source);
    if (layer && result.atlasKey) {
      if (!retained.has(result.source)) retained.set(result.source, new Set());
      retained.get(result.source).add(result.atlasKey);
    }
    ctx.evidence.push({ renderer: 'inventory_item_renderer', status: 'fixed-item-dependencies-resolved',
      sourcePath: location.sourcePath, jsonPath: location.jsonPath, packedItemId: props['#item_id_aux'] ?? props.item_id_aux ?? null,
      atlasSource: result.source, atlasKey: result.atlasKey || null, textureRefs: result.textureRefs || [result.textureRef] });
    return result;
  }
  for (const item of ctx.itemIds) resolve(item.props, item);
  for (const usage of usages) {
    // Existing scanner separately records an instance's fixed item input and
    // its inherited renderer. Match only lexical ancestors of this instance.
    const matches = ctx.itemIds.filter(item => item.sourcePath === usage.sourcePath
      && (item.jsonPath === usage.jsonPath || usage.jsonPath.startsWith(item.jsonPath)
        && /^(?:@[A-Za-z0-9_.-]+)+$/u.test(usage.jsonPath.slice(item.jsonPath.length))));
    const direct = usage.props['#item_id_aux'] ?? usage.props.item_id_aux ?? usage.props.property_bag?.['#item_id_aux'];
    if (matches.length) continue; // Their lexical variable alternatives were resolved above.
    if (direct !== undefined) resolve({ renderer: 'inventory_item_renderer', '#item_id_aux': direct }, usage);
    else if (engineInventoryBinding(usage.props)) recordEngineInventoryDependency(ctx, usage);
    else if (!matches.length) ctx.diagnose('EXPORT_NATIVE_ITEM_UNRESOLVED', { path: usage.sourcePath, jsonPath: usage.jsonPath,
      issue: 'runtime-item-selection', runtimeBindings: usage.props.bindings || [] });
  }
  let output = null;
  for (const [kind, keys] of retained) {
    const layer = layers.get(kind), pruned = buildPrunedItemTextureAtlasForExport(layer.atlas, sorted(keys));
    if (!pruned.ok) { ctx.diagnose('EXPORT_NATIVE_ITEM_ATLAS_PRUNE_FAILED', { issue: pruned.error }); continue; }
    if (!output) output = { ...pruned.value, texture_data: Object.create(null) };
    for (const [key, value] of Object.entries(pruned.value.texture_data)) {
      if (Object.hasOwn(output.texture_data, key) && JSON.stringify(output.texture_data[key]) !== JSON.stringify(value)) {
        ctx.diagnose('EXPORT_NATIVE_ITEM_ATLAS_COLLISION', { reference: key }); continue;
      }
      output.texture_data[key] = value;
    }
  }
  if (output) ctx.addJson('textures/item_texture.json', output, 'fixed-native-item-atlas-closure');
}

function geometryRecords(document) {
  if (!object(document)) return [];
  if (Array.isArray(document['minecraft:geometry'])) return document['minecraft:geometry'].map(value => ({ key: value?.description?.identifier, value, modern: true }));
  return Object.entries(document).filter(([key, value]) => key.startsWith('geometry.') && object(value)).map(([key, value]) => ({ key, value, modern: false }));
}
function version(value) { return parseEngineVersion(value || [0, 0, 0]); }

async function horseDependencies(ctx) {
  const registries = new Map(), outputDocuments = new Map();
  async function registry(kind) {
    if (registries.has(kind)) return registries.get(kind);
    const pattern = { entity: /^entity\/.+\.json$/iu, geometry: /^models\/.+\.json$/iu,
      controller: /^render_controllers\/.+\.json$/iu, animation: /^animations\/.+\.json$/iu,
      animationController: /^animation_controllers\/.+\.json$/iu, material: /^materials\/.+\.material$/iu }[kind];
    const result = new Map(); let count = 0;
    for (const source of ctx.sources) {
      for (const path of sorted(source.index.values()).filter(path => pattern.test(path))) {
        checkAbort(ctx);
        if (++count > MAX_CANDIDATES) throw Object.assign(new Error('EXPORT_NATIVE_DOCUMENT_LIMIT'), { code: 'EXPORT_NATIVE_DOCUMENT_LIMIT' });
        const document = await ctx.readJson(source, path);
        let entries;
        if (kind === 'entity') {
          const value = document?.['minecraft:client_entity'], description = value?.description;
          entries = typeof description?.identifier === 'string' ? [{ key: description.identifier, value, minVersion: version(description.min_engine_version) }] : [];
        } else if (kind === 'geometry') entries = geometryRecords(document);
        else {
          const rootKey = { controller: 'render_controllers', animation: 'animations', animationController: 'animation_controllers', material: 'materials' }[kind];
          entries = object(document?.[rootKey]) ? Object.entries(document[rootKey]).filter(([, value]) => object(value))
            .map(([key, value]) => ({ key: kind === 'material' ? key.split(':')[0] : key, rawKey: key, value, rootKey })) : [];
        }
        for (const entry of entries) {
          if (typeof entry.key !== 'string') continue;
          const list = result.get(entry.key) || []; list.push({ ...entry, source, path, document }); result.set(entry.key, list);
        }
      }
    }
    registries.set(kind, result); return result;
  }
  async function select(kind, identifier) {
    const candidates = (await registry(kind)).get(identifier) || [];
    if (!candidates.length) return null;
    const priority = Math.max(...candidates.map(item => item.source.precedence));
    let selected = candidates.filter(item => item.source.precedence === priority);
    if (kind === 'entity') {
      selected.sort((a, b) => compareEngineVersions(b.minVersion || [0, 0, 0], a.minVersion || [0, 0, 0]));
      const newest = selected[0].minVersion;
      selected = selected.filter(item => compareEngineVersions(item.minVersion || [0, 0, 0], newest || [0, 0, 0]) === 0);
    }
    if (selected.length !== 1) { ctx.diagnose('EXPORT_NATIVE_SYMBOL_AMBIGUOUS', { kind, reference: identifier }); return null; }
    return selected[0];
  }
  function retain(record, reason) {
    const key = record.path.toLowerCase();
    let output = outputDocuments.get(key);
    if (!output) {
      output = { path: record.path, sourceId: record.source.id, value: Object.create(null), reasons: new Set() };
      if (record.document.format_version !== undefined) output.value.format_version = record.document.format_version;
      outputDocuments.set(key, output);
    }
    if (output.sourceId !== record.source.id) { ctx.diagnose('EXPORT_NATIVE_DOCUMENT_LAYER_CONFLICT', { path: record.path }); return; }
    output.reasons.add(reason);
    if (record.modern) {
      output.value['minecraft:geometry'] ||= [];
      if (!output.value['minecraft:geometry'].some(item => item.description?.identifier === record.key)) output.value['minecraft:geometry'].push(record.value);
    } else if (record.rootKey) {
      output.value[record.rootKey] ||= Object.create(null); output.value[record.rootKey][record.rawKey] = record.value;
    } else if (record.key.startsWith('geometry.')) output.value[record.key] = record.value;
    else output.value['minecraft:client_entity'] = record.value;
  }
  const entity = await select('entity', 'minecraft:horse');
  if (!entity) { ctx.diagnose('EXPORT_NATIVE_HORSE_ENTITY_MISSING'); return; }
  const description = entity.value.description;
  if (description.sound_effects || description.particle_effects) ctx.diagnose('EXPORT_NATIVE_ENTITY_EFFECT_DEPENDENCY', { path: entity.path });
  // Spawn-egg icon is unrelated to rendering this entity in the UI.
  const retainedDescription = { ...description }; delete retainedDescription.spawn_egg;
  retain({ ...entity, value: { ...entity.value, description: retainedDescription } }, 'horse-client-entity');
  const dependencies = { entity: entity.path, textures: [], geometry: [], controllers: [], animations: [], materials: [] };
  for (const value of Object.values(description.textures || {})) {
    if (typeof value !== 'string' || !value.startsWith('textures/')) { ctx.diagnose('EXPORT_NATIVE_HORSE_TEXTURE_DYNAMIC', { reference: value }); continue; }
    ctx.addTexture(value); dependencies.textures.push(value);
  }
  for (const identifier of new Set(Object.values(description.geometry || {}))) {
    const record = typeof identifier === 'string' ? await select('geometry', identifier) : null;
    if (!record) { ctx.diagnose('EXPORT_NATIVE_GEOMETRY_MISSING', { reference: identifier }); continue; }
    retain(record, 'horse-geometry'); dependencies.geometry.push({ identifier, path: record.path });
  }
  for (const name of new Set(Object.values(description.materials || {}))) {
    const record = typeof name === 'string' ? await select('material', name) : null;
    if (record) {
      retain(record, 'horse-material'); dependencies.materials.push({ identifier: name, path: record.path });
      const base = record.rawKey?.split(':')[1];
      if (base) ctx.diagnose('EXPORT_NATIVE_MATERIAL_INHERITANCE_UNRESOLVED', { reference: base, path: record.path });
      walk(record.value, value => { if (typeof value === 'string' && /\.(?:vertex|fragment|geometry|hlsl|glsl)$/iu.test(value)) ctx.diagnose('EXPORT_NATIVE_SHADER_DEPENDENCY_UNRESOLVED', { reference: value }); });
    } else if (KNOWN_ENGINE_HORSE_MATERIALS.has(name)) {
      dependencies.materials.push({ identifier: name, source: 'game-engine' });
      ctx.diagnose('EXPORT_NATIVE_ENGINE_MATERIAL_DEPENDENCY', { reference: name, reason: '既知の組込 material。パックに実体がないため実機の描画エンジンに依存します。' }, true);
    } else ctx.diagnose('EXPORT_NATIVE_MATERIAL_MISSING', { reference: name });
  }
  const renderNames = [];
  for (const row of description.render_controllers || []) {
    if (typeof row === 'string') renderNames.push(row);
    else if (object(row)) renderNames.push(...Object.keys(row));
    else ctx.diagnose('EXPORT_NATIVE_CONTROLLER_REFERENCE_INVALID');
  }
  for (const identifier of new Set(renderNames)) {
    const record = await select('controller', identifier);
    if (!record) { ctx.diagnose('EXPORT_NATIVE_CONTROLLER_MISSING', { reference: identifier }); continue; }
    retain(record, 'horse-render-controller'); dependencies.controllers.push({ identifier, path: record.path });
    const aliases = { Texture: description.textures || {}, Geometry: description.geometry || {}, Material: description.materials || {} };
    walk(record.value, value => {
      if (typeof value !== 'string') return;
      for (const match of value.matchAll(/\b(Texture|Geometry|Material)\.([A-Za-z0-9_]+)/gu)) {
        if (!Object.hasOwn(aliases[match[1]], match[2])) ctx.diagnose('EXPORT_NATIVE_CONTROLLER_ALIAS_MISSING', { reference: match[0], path: record.path });
      }
      if (/\b(?:Texture|Geometry|Material)\s*\[/u.test(value)) ctx.diagnose('EXPORT_NATIVE_CONTROLLER_DYNAMIC_ALIAS', { reference: value, path: record.path });
    });
  }
  const animationQueue = sorted(new Set(Object.values(description.animations || {}))), seen = new Set();
  for (let index = 0; index < animationQueue.length; index++) {
    const identifier = animationQueue[index];
    if (seen.has(identifier)) continue; seen.add(identifier);
    const kind = typeof identifier === 'string' && identifier.startsWith('controller.animation.') ? 'animationController' : 'animation';
    const record = typeof identifier === 'string' ? await select(kind, identifier) : null;
    if (!record) { ctx.diagnose('EXPORT_NATIVE_ANIMATION_MISSING', { reference: identifier }); continue; }
    retain(record, 'horse-animation'); dependencies.animations.push({ identifier, path: record.path });
    walk(record.value, current => {
      if (!object(current)) return;
      if (current.sound_effects || current.particle_effects) ctx.diagnose('EXPORT_NATIVE_ANIMATION_EFFECT_DEPENDENCY', { reference: identifier, path: record.path });
      if (kind === 'animationController' && Array.isArray(current.animations)) for (const entry of current.animations) {
        const aliases = typeof entry === 'string' ? [entry] : object(entry) ? Object.keys(entry) : [];
        for (const alias of aliases) {
          const target = description.animations?.[alias];
          if (typeof target === 'string') animationQueue.push(target);
          else ctx.diagnose('EXPORT_NATIVE_ANIMATION_ALIAS_MISSING', { reference: alias, path: record.path });
        }
      }
    });
  }
  for (const output of outputDocuments.values()) ctx.addJson(output.path, output.value, sorted(output.reasons).join(','), output.sourceId);
  ctx.evidence.push({ renderer: 'live_horse_renderer', status: 'known-horse-dependency-closure',
    entityIdentifier: 'minecraft:horse', minEngineVersion: description.min_engine_version || null, dependencies,
    runtimeEntitySelection: 'unresolved-other-entity-types-possible' });
  ctx.diagnose('EXPORT_NATIVE_ENTITY_SELECTION_DYNAMIC', { renderer: 'live_horse_renderer',
    reason: '通常の馬について宣言された全色・模様・装備・幼体・animation素材は列挙しましたが、#entity_id が選ぶ他の動物種は確定できません。' });
}

/** ctx は親サービスの有限な読取/出力 callback と診断台帳を所有する。 */
export async function collectKnownNativeExportDependencies(ctx) {
  const usagesByRenderer = new Map();
  for (const usage of ctx.usages) {
    const name = usage.props.renderer, rows = usagesByRenderer.get(name) || []; rows.push(usage); usagesByRenderer.set(name, rows);
  }
  if (usagesByRenderer.has('inventory_item_renderer')) await itemDependencies(ctx, usagesByRenderer.get('inventory_item_renderer'));
  if (usagesByRenderer.has('enchanting_book_renderer')) {
    ctx.addTexture('textures/entity/enchanting_table_book');
    if (ctx.sources.some(source => source.index.has('textures/entity/enchanting_table_book_shadow.png'))) ctx.addTexture('textures/entity/enchanting_table_book_shadow');
    ctx.evidence.push({ renderer: 'enchanting_book_renderer', status: 'pack-textures-resolved', geometrySource: 'game-engine',
      textureRef: 'textures/entity/enchanting_table_book' });
    ctx.diagnose('EXPORT_NATIVE_BOOK_ENGINE_GEOMETRY', { reason: '本の形状は実機内蔵。存在しないモデルJSONを生成せず、提供されたtextureとsidecarを同梱します。' }, true);
  }
  if (usagesByRenderer.has('live_horse_renderer')) await horseDependencies(ctx);
  for (const [renderer, rows] of usagesByRenderer) if (!['inventory_item_renderer', 'enchanting_book_renderer', 'live_horse_renderer'].includes(renderer)) {
    if (ENGINE_UI_RENDERERS.has(renderer)) {
      if (renderer === 'flying_item_renderer' || renderer === 'bundle_tooltip_renderer') recordEngineInventoryDependency(ctx, rows[0]);
      else ctx.diagnose('EXPORT_NATIVE_ENGINE_UI_DEPENDENCY', { renderer, path: rows[0].sourcePath,
        reason: '標準 UI レンダラーの文字・進捗描画は実機エンジンが提供します。原文と明示的な素材依存は維持します。' }, true);
      continue;
    }
    ctx.diagnose('EXPORT_NATIVE_RUNTIME_DEPENDENCY_UNRESOLVED', { renderer, path: rows[0].sourcePath,
      reason: 'このネイティブレンダラーが実行時に選ぶ素材集合は確定できません。' });
  }
}
