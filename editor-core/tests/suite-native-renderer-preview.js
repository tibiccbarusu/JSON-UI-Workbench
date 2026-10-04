import { test, assert, assertDeepEqual, assertEqual } from './test-harness.js';
import {
  ITEM_TEXTURE_ATLAS_MAX_TEXTURES_PER_ENTRY,
  ITEM_TEXTURE_ATLAS_MAX_TOTAL_TEXTURE_REFS,
  buildPrunedItemTextureAtlasForExport,
  computeNativeTextureSetLayerLimit,
  getNativeBannerPreviewState,
  getNativeRendererPlaceholderKind,
  getNativeRendererTextureRef,
  resolveNativeRendererTexture,
  indexItemTextureAtlas,
  mergeNativeRendererProps,
  parseItemTextureAtlas,
} from '../src/preview/native-renderer-preview.js';
import { buildAssetIndexFromPackPaths, resolveTextureRef } from '../src/assets/asset-indexer.js';
import {
  composeNativePreviewPackPaths,
  inspectBestNativePreviewVersionLayer,
  inspectFirstNativePreviewCandidateLayer,
  selectNativePreviewCandidateLayer,
  selectNativePreviewTargetEngineVersion,
} from '../src/preview/native-pack-stack.js';
import {
  buildEnchantingBookPreviewScene,
  compareEngineVersions,
  compileBedrockGeometryScene,
  extractHorseClientEntity,
  extractHorseClientEntityResult,
  findGeometryRecordResult,
  inspectHorseRenderControllerDocument,
  isHorseClientEntityDocument,
  parseEngineVersion,
  rotateBedrockPoint,
} from '../src/preview/native-model-preview.js';

const renderer = 'inventory_item_renderer';
const pack = (legacyId, aux = 0) => legacyId * 0x1_0000 + aux;

test('native model pack stack overlays paths individually and retains sparse Vanilla dependencies', () => {
  const imported = {
    packPaths: ['models/entity/horse_v3.geo.json'],
    overridesTextByPackPath: {},
  };
  const vanilla = {
    packPaths: [
      'entity/horse_v3.entity.json',
      'models/entity/horse_v3.geo.json',
      'render_controllers/horse_v3.render_controllers.json',
    ],
    overridesTextByPackPath: {},
  };
  const result = composeNativePreviewPackPaths([
    { source: 'imported', runtime: imported },
    { source: 'vanilla', runtime: vanilla },
  ], /^(?:entity|models|render_controllers)\/.*\.json$/iu);
  assertEqual(result.invalid, false);
  assertEqual(result.collision, false);
  assertDeepEqual(result.entries.map(({ source, packPath }) => ({ source, packPath })), [
    { source: 'imported', packPath: 'models/entity/horse_v3.geo.json' },
    { source: 'vanilla', packPath: 'entity/horse_v3.entity.json' },
    { source: 'vanilla', packPath: 'render_controllers/horse_v3.render_controllers.json' },
  ]);
});

test('native model pack stack shadows case-insensitively and includes edited new paths', () => {
  const imported = {
    packPaths: [],
    overridesTextByPackPath: {
      'Entity/Horse_v3.entity.json': '{}',
      'models/entity/custom.geo.json': '{}',
    },
  };
  const vanilla = {
    packPaths: ['entity/horse_v3.entity.json', 'models/entity/base.geo.json'],
    overridesTextByPackPath: {},
  };
  const result = composeNativePreviewPackPaths([
    { source: 'imported', runtime: imported },
    { source: 'vanilla', runtime: vanilla },
  ], /^(?:entity|models)\/.*\.json$/iu);
  assertDeepEqual(result.entries.map(({ source, packPath }) => ({ source, packPath })), [
    { source: 'imported', packPath: 'Entity/Horse_v3.entity.json' },
    { source: 'imported', packPath: 'models/entity/custom.geo.json' },
    { source: 'vanilla', packPath: 'models/entity/base.geo.json' },
  ]);
});

test('native model pack stack distinguishes layer collisions from fully shadowed lower paths', () => {
  const collision = composeNativePreviewPackPaths([
    {
      source: 'imported',
      runtime: { packPaths: ['entity/Horse.json', 'entity/horse.json'], overridesTextByPackPath: {} },
    },
  ], /^entity\/.*\.json$/iu);
  assertEqual(collision.collision, true);

  const fullyShadowed = composeNativePreviewPackPaths([
    {
      source: 'imported',
      runtime: { packPaths: ['entity/horse.json'], overridesTextByPackPath: {} },
    },
    {
      source: 'vanilla',
      runtime: { packPaths: ['entity/Horse.json', 'entity/horse.json'], overridesTextByPackPath: {} },
    },
  ], /^entity\/.*\.json$/iu);
  assertEqual(fullyShadowed.collision, false);
  assertEqual(fullyShadowed.entries.length, 1);
  assertEqual(fullyShadowed.entries[0].source, 'imported');
});

test('native model pack stack enforces raw and visible path limits', () => {
  const runtime = {
    packPaths: ['entity/a.json', 'entity/b.json'],
    overridesTextByPackPath: {},
  };
  assertEqual(composeNativePreviewPackPaths(
    [{ source: 'imported', runtime }],
    /^entity\/.*\.json$/iu,
    { maxRawPathsPerLayer: 1 },
  ).truncated, true);
  assertEqual(composeNativePreviewPackPaths(
    [{ source: 'imported', runtime }],
    /^entity\/.*\.json$/iu,
    { maximum: 1 },
  ).truncated, true);
});

test('native model identifier selection treats lower layers as overrides, not ambiguity', () => {
  const imported = { source: 'imported', packPath: 'models/custom.geo.json' };
  const vanilla = { source: 'vanilla', packPath: 'models/horse.geo.json' };
  const layered = selectNativePreviewCandidateLayer(
    [vanilla, imported],
    ['imported', 'vanilla'],
  );
  assertEqual(layered.status, 'found');
  assertEqual(layered.source, 'imported');
  assertDeepEqual(layered.candidates, [imported]);

  const duplicate = selectNativePreviewCandidateLayer(
    [imported, { source: 'imported', packPath: 'models/duplicate.geo.json' }, vanilla],
    ['imported', 'vanilla'],
  );
  assertEqual(duplicate.status, 'found');
  assertEqual(duplicate.candidates.length, 2);
});

test('native identifier inspection stops at the authoritative resource-pack layer', async () => {
  const entries = [
    { source: 'imported', packPath: 'upper-a.json' },
    { source: 'imported', packPath: 'upper-b.json' },
    { source: 'vanilla', packPath: 'lower.json' },
  ];
  const sourceOrder = ['imported', 'vanilla'];

  const visitedValidUpper = [];
  const validUpper = await inspectFirstNativePreviewCandidateLayer(entries, sourceOrder, async (entry) => {
    visitedValidUpper.push(entry.packPath);
    if (entry.packPath === 'upper-a.json') {
      return { status: 'candidate', candidate: { kind: 'supported', source: entry.source } };
    }
    if (entry.packPath === 'upper-b.json') return { status: 'missing' };
    return { status: 'candidate', candidate: { kind: 'unsupported', source: entry.source } };
  });
  assertEqual(validUpper.status, 'found');
  assertDeepEqual(validUpper.candidates.map((candidate) => candidate.kind), ['supported']);
  assertDeepEqual(visitedValidUpper, ['upper-a.json', 'upper-b.json']);

  const visitedUnsupportedUpper = [];
  const unsupportedUpper = await inspectFirstNativePreviewCandidateLayer(entries, sourceOrder, async (entry) => {
    visitedUnsupportedUpper.push(entry.packPath);
    if (entry.packPath === 'upper-a.json') {
      return { status: 'candidate', candidate: { kind: 'unsupported', source: entry.source } };
    }
    if (entry.packPath === 'upper-b.json') return { status: 'missing' };
    return { status: 'candidate', candidate: { kind: 'supported', source: entry.source } };
  });
  assertEqual(unsupportedUpper.status, 'found');
  assertDeepEqual(unsupportedUpper.candidates.map((candidate) => candidate.kind), ['unsupported']);
  assertDeepEqual(visitedUnsupportedUpper, ['upper-a.json', 'upper-b.json']);

  const duplicateUpper = await inspectFirstNativePreviewCandidateLayer(entries, sourceOrder, async (entry) => (
    entry.source === 'imported'
      ? { status: 'candidate', candidate: { path: entry.packPath } }
      : { status: 'missing' }
  ));
  assertEqual(duplicateUpper.status, 'found');
  assertEqual(duplicateUpper.candidates.length, 2);
});

test('client-entity version selection precedes pack priority across distinct visible paths', async () => {
  const entries = [
    { source: 'imported', packPath: 'entity/custom_horse.entity.json', minEngineVersion: [1, 2, 6] },
    { source: 'vanilla', packPath: 'entity/horse_v3.entity.json', minEngineVersion: [1, 17, 10] },
  ];
  const inspect = async (entry) => ({
    status: 'candidate',
    candidate: {
      source: entry.source,
      packPath: entry.packPath,
      minEngineVersion: entry.minEngineVersion,
    },
  });

  const newerLower = await inspectBestNativePreviewVersionLayer(
    entries,
    ['imported', 'vanilla'],
    [1, 26, 40],
    inspect,
  );
  assertEqual(newerLower.status, 'found');
  assertEqual(newerLower.source, 'vanilla');
  assertDeepEqual(newerLower.minEngineVersion, [1, 17, 10]);
  assertDeepEqual(newerLower.candidates.map((candidate) => candidate.packPath), [
    'entity/horse_v3.entity.json',
  ]);

  const equalVersion = await inspectBestNativePreviewVersionLayer(
    entries.map((entry) => ({ ...entry, minEngineVersion: [1, 17, 10] })),
    ['imported', 'vanilla'],
    [1, 26, 40],
    inspect,
  );
  assertEqual(equalVersion.status, 'found');
  assertEqual(equalVersion.source, 'imported');
  assertDeepEqual(equalVersion.candidates.map((candidate) => candidate.packPath), [
    'entity/custom_horse.entity.json',
  ]);

  const futureUpper = await inspectBestNativePreviewVersionLayer(
    [
      { ...entries[0], minEngineVersion: [1, 30, 0] },
      entries[1],
    ],
    ['imported', 'vanilla'],
    [1, 26, 40],
    inspect,
  );
  assertEqual(futureUpper.status, 'found');
  assertEqual(futureUpper.source, 'vanilla');

  const futureOnly = await inspectBestNativePreviewVersionLayer(
    [{ ...entries[0], minEngineVersion: [1, 30, 0] }],
    ['imported', 'vanilla'],
    [1, 26, 40],
    inspect,
  );
  assertEqual(futureOnly.status, 'incompatible');
});

test('client-entity version selection retains same-layer ambiguity and rejects malformed versions', async () => {
  const inspect = async (entry) => ({ status: 'candidate', candidate: entry });
  const duplicate = await inspectBestNativePreviewVersionLayer([
    { source: 'imported', packPath: 'entity/a.json', minEngineVersion: [1, 17, 10] },
    { source: 'imported', packPath: 'entity/b.json', minEngineVersion: [1, 17, 10] },
    { source: 'vanilla', packPath: 'entity/c.json', minEngineVersion: [1, 17, 10] },
  ], ['imported', 'vanilla'], [1, 26, 40], inspect);
  assertEqual(duplicate.status, 'found');
  assertEqual(duplicate.source, 'imported');
  assertEqual(duplicate.candidates.length, 2);

  const malformed = await inspectBestNativePreviewVersionLayer([
    { source: 'imported', packPath: 'entity/broken.json', minEngineVersion: '1.x' },
  ], ['imported'], [1, 26, 40], inspect);
  assertEqual(malformed.status, 'invalid');
  assertEqual(malformed.reason, 'candidate-version');
});

test('native entity target version follows the top pack and falls back to explicit Vanilla metadata', () => {
  assertDeepEqual(selectNativePreviewTargetEngineVersion({
    hasImportedPack: true,
    importedMinEngineVersion: '1.16.0',
    expectedBedrockVersion: '1.26.40',
    sourceRelease: 'release-1.26.40',
    fallback: [1, 26, 40],
  }), [1, 16, 0]);
  assertDeepEqual(selectNativePreviewTargetEngineVersion({
    hasImportedPack: true,
    importedMinEngineVersion: '1.26.20',
    expectedBedrockVersion: '1.25.0',
    fallback: [1, 26, 40],
  }), [1, 26, 20]);
  assertDeepEqual(selectNativePreviewTargetEngineVersion({
    hasImportedPack: false,
    expectedBedrockVersion: 'Bedrock 1.25.80 stable',
    fallback: [1, 26, 40],
  }), [1, 25, 80]);

  for (const importedMinEngineVersion of [
    undefined,
    'garbage',
    [-1, 16, 0],
    [1, 16.5, 0],
    [1, 2, 3, 4, 5],
  ]) {
    assertEqual(selectNativePreviewTargetEngineVersion({
      hasImportedPack: true,
      importedMinEngineVersion,
      expectedBedrockVersion: '1.26.40',
      fallback: [1, 26, 40],
    }), null);
  }
});

test('native texture-set reservations leave shared-cache headroom', () => {
  const limits = { maxDecodedBytesTotal: 8, perImageMaxDecodedBytes: 8 };
  assertEqual(computeNativeTextureSetLayerLimit(3, limits), 2);
  assertEqual(computeNativeTextureSetLayerLimit(1, limits), 4);
  assertEqual(computeNativeTextureSetLayerLimit(0, limits), 0);
  assertEqual(computeNativeTextureSetLayerLimit(5, limits), 0);
  assertEqual(computeNativeTextureSetLayerLimit(3, { ...limits, maxDecodedBytesTotal: 7 }), 1);
});

test('engine versions accept strict manifest strings and arrays only', () => {
  assertDeepEqual(parseEngineVersion('1.21.130'), [1, 21, 130]);
  assertDeepEqual(parseEngineVersion([1, 16, 0]), [1, 16, 0]);
  assertEqual(parseEngineVersion('1.02.0'), null);
  assertEqual(parseEngineVersion([1, '21', 0]), null);
});

test('native inventory renderer maps the five bounded representative item ids', () => {
  const cases = [
    [624, 'textures/items/netherite_ingot'],
    [523, 'textures/items/emerald'],
    [306, 'textures/items/diamond'],
    [308, 'textures/items/gold_ingot'],
    [307, 'textures/items/iron_ingot'],
  ];
  for (const [legacyId, texture] of cases) {
    assertEqual(getNativeRendererTextureRef({
      renderer,
      property_bag: { '#item_id_aux': pack(legacyId) },
    }), texture);
  }
});

test('native inventory renderer accepts resolved current item IDs and rejects unmodeled auxiliary data', () => {
  assertEqual(resolveNativeRendererTexture({ renderer, '#item_id_aux': pack(523, 91) }).issue, 'NATIVE_ITEM_AUX_DATA_UNSUPPORTED');
  assertEqual(resolveNativeRendererTexture({ renderer, item_id_aux: pack(306, 0xffff) }).issue, 'NATIVE_ITEM_AUX_DATA_UNSUPPORTED');
  assertEqual(getNativeRendererTextureRef({
    renderer,
    __jsonui_preview_collection_details: { '#item_id_aux': pack(523) },
  }), 'textures/items/emerald');
  assertEqual(getNativeRendererTextureRef(Object.assign(Object.create(null), {
    renderer,
    property_bag: Object.assign(Object.create(null), { item_id_aux: pack(307) }),
  })), 'textures/items/iron_ingot');
});

test('resolved direct native item id overrides the authored property bag default', () => {
  assertEqual(getNativeRendererTextureRef({
    renderer,
    item_id_aux: pack(306),
    property_bag: { '#item_id_aux': pack(523) },
  }), 'textures/items/diamond');

  assertEqual(getNativeRendererTextureRef({
    renderer,
    '#item_id_aux': pack(523),
    item_id_aux: pack(306),
  }), null);
  assertEqual(getNativeRendererTextureRef({
    renderer,
    property_bag: {
      '#item_id_aux': pack(523),
      item_id_aux: pack(306),
    },
  }), null);
});

test('native inventory renderer leaves unknown ids and other renderers unresolved', () => {
  assertEqual(getNativeRendererTextureRef({ renderer, '#item_id_aux': pack(999) }), null);
  assertEqual(getNativeRendererTextureRef({ renderer: 'banner_pattern_renderer', '#item_id_aux': pack(523) }), null);
  assertEqual(getNativeRendererTextureRef({ '#item_id_aux': pack(523) }), null);
});

test('signed Bedrock packed item ids are valid inputs even when the item is unsupported', () => {
  const signed = resolveNativeRendererTexture({ renderer, '#item_id_aux': -13_369_344 });
  assertEqual(signed.status, 'unresolved');
  assertEqual(signed.issue, 'NATIVE_ITEM_MODEL_REQUIRED');
  const unknownPositive = resolveNativeRendererTexture({ renderer, '#item_id_aux': pack(999) });
  assertEqual(unknownPositive.issue, 'NATIVE_PREVIEW_ITEM_ID_UNSUPPORTED');
});

test('empty native inventory slots are runtime-dependent, not malformed item ids', () => {
  const empty = resolveNativeRendererTexture({ renderer });
  assertEqual(empty.status, 'not-applicable');
  assertEqual(empty.issue, null);
  const malformed = resolveNativeRendererTexture({ renderer, '#item_id_aux': '25427968' });
  assertEqual(malformed.status, 'unresolved');
  assertEqual(malformed.issue, 'NATIVE_PREVIEW_ITEM_ID_INVALID');
});

test('native inventory renderer fails closed for malformed packed values', () => {
  const malformed = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000, '25427968', 1n, null];
  for (const value of malformed) {
    assertEqual(getNativeRendererTextureRef({ renderer, '#item_id_aux': value }), null);
  }
  assertEqual(getNativeRendererTextureRef(null), null);
  assertEqual(getNativeRendererTextureRef([]), null);
});

test('native inventory renderer rejects inherited, accessor, and conflicting values', () => {
  const inherited = Object.create({ renderer, '#item_id_aux': pack(523) });
  assertEqual(getNativeRendererTextureRef(inherited), null);

  const accessor = { renderer };
  Object.defineProperty(accessor, '#item_id_aux', { get() { throw new Error('must not run'); } });
  assertEqual(getNativeRendererTextureRef(accessor), null);

  // A resolved direct value has higher precedence than an authored bag value.
  assertEqual(getNativeRendererTextureRef({
    renderer,
    item_id_aux: pack(523),
    property_bag: { '#item_id_aux': pack(306) },
  }), 'textures/items/emerald');
});

test('native property composition never invokes accessors', () => {
  let getterCalls = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'renderer', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return renderer;
    },
  });
  assertEqual(mergeNativeRendererProps({ renderer }, hostile), null);
  assertEqual(getterCalls, 0);

  const merged = mergeNativeRendererProps(
    { renderer, property_bag: { '#item_id_aux': pack(523) } },
    { item_id_aux: pack(306) },
  );
  assert(merged && Object.getPrototypeOf(merged) === null);
  assertEqual(getNativeRendererTextureRef(merged), 'textures/items/diamond');
});

test('item texture atlas uses imported key remaps before Vanilla and the raster resolver stays imported-first', () => {
  const imported = parseItemTextureAtlas(`{
    // Resource packs may contain JSONC comments.
    "texture_data": {
      "emerald": { "textures": "textures/custom/beacon_payment.png" }
    }
  }`);
  const vanilla = parseItemTextureAtlas(`{
    "texture_name": "atlas.items",
    "texture_data": {
      "emerald": { "textures": "textures/items/emerald" }
    }
  }`);
  assert(imported.ok && vanilla.ok);

  const textureRef = getNativeRendererTextureRef(
    { renderer, '#item_id_aux': pack(523) },
    { importedAtlas: imported.atlas, vanillaAtlas: vanilla.atlas },
  );
  assertEqual(textureRef, 'textures/custom/beacon_payment.png');

  const importedIndex = buildAssetIndexFromPackPaths(['textures/custom/beacon_payment.png']);
  const vanillaIndex = buildAssetIndexFromPackPaths([
    'textures/custom/beacon_payment.png',
    'textures/items/emerald.png',
  ]);
  assertEqual(
    resolveTextureRef(textureRef, { importedIndex, vanillaIndex }).resolved?.source,
    'imported',
  );
});

test('item texture atlas falls through missing imported keys and preserves direct-path fallback', () => {
  const imported = parseItemTextureAtlas('{"texture_data":{"diamond":{"textures":"textures/custom/diamond"}}}');
  const vanilla = parseItemTextureAtlas('{"texture_data":{"emerald":{"textures":"textures/vanilla/emerald"}}}');
  assert(imported.ok && vanilla.ok);
  assertEqual(getNativeRendererTextureRef(
    { renderer, '#item_id_aux': pack(523) },
    { importedAtlas: imported.atlas, vanillaAtlas: vanilla.atlas },
  ), 'textures/vanilla/emerald');
  assertEqual(
    getNativeRendererTextureRef({ renderer, '#item_id_aux': pack(523) }),
    'textures/items/emerald',
  );
});

test('a ready atlas with no required key reports the omission instead of inventing a path', () => {
  const imported = parseItemTextureAtlas('{"texture_data":{"diamond":{"textures":"textures/custom/diamond"}}}');
  assert(imported.ok);
  const result = resolveNativeRendererTexture(
    { renderer, '#item_id_aux': pack(624) },
    { importedStatus: 'ready', importedAtlas: imported.atlas, vanillaStatus: 'missing' },
  );
  assertEqual(result.status, 'unresolved');
  assertEqual(result.issue, 'ITEM_TEXTURE_ATLAS_ENTRY_MISSING');
  assertEqual(result.textureRef, null);
  assertEqual(result.atlasKey, 'netherite_ingot');
});

test('item texture atlas preserves ordered texture arrays and does not guess out of range', () => {
  const indexed = indexItemTextureAtlas({
    texture_data: {
      emerald: {
        textures: [
          'textures/custom/emerald_0',
          'textures/entity/emerald_1.tga',
          'textures/custom/emerald_1',
        ],
      },
    },
  });
  assert(indexed.ok);
  assertEqual(getNativeRendererTextureRef(
    { renderer, __jsonui_preview_item_atlas_key: 'emerald', __jsonui_preview_item_variant: 0 },
    { importedAtlas: indexed.atlas },
  ), 'textures/custom/emerald_0');
  assertEqual(getNativeRendererTextureRef(
    { renderer, __jsonui_preview_item_atlas_key: 'emerald', __jsonui_preview_item_variant: 1 },
    { importedAtlas: indexed.atlas },
  ), 'textures/entity/emerald_1.tga');
  assertEqual(getNativeRendererTextureRef(
    { renderer, __jsonui_preview_item_atlas_key: 'emerald', __jsonui_preview_item_variant: 99 },
    { importedAtlas: indexed.atlas },
  ), null);

  const exportResolution = resolveNativeRendererTexture(
    { renderer, __jsonui_preview_item_atlas_key: 'emerald', __jsonui_preview_item_variant: 1 },
    { importedAtlas: indexed.atlas },
  );
  assertEqual(exportResolution.atlasKey, 'emerald');
  assertDeepEqual([...exportResolution.textureRefs], [
    'textures/custom/emerald_0',
    'textures/entity/emerald_1.tga',
    'textures/custom/emerald_1',
  ]);
});

test('item texture atlas export is pruned to requested keys and retains every selected variation', () => {
  const indexed = indexItemTextureAtlas({
    resource_pack_name: 'Imported RP',
    texture_name: 'atlas.items',
    texture_data: {
      emerald: { textures: ['textures/custom/emerald_0', 'textures/custom/emerald_1'] },
      diamond: { textures: 'textures/custom/diamond' },
      unrelated: { textures: 'textures/custom/unrelated' },
    },
  });
  assert(indexed.ok);
  const pruned = buildPrunedItemTextureAtlasForExport(indexed.atlas, ['emerald']);
  assert(pruned.ok);
  assertEqual(pruned.value.resource_pack_name, 'Imported RP');
  assertEqual(pruned.value.texture_name, 'atlas.items');
  assertDeepEqual(Object.keys(pruned.value.texture_data), ['emerald']);
  assertDeepEqual(pruned.value.texture_data.emerald.textures, [
    'textures/custom/emerald_0',
    'textures/custom/emerald_1',
  ]);
  assertDeepEqual(pruned.textureRefs, [
    'textures/custom/emerald_0',
    'textures/custom/emerald_1',
  ]);
  assertEqual(buildPrunedItemTextureAtlasForExport(indexed.atlas, ['netherite_ingot']).ok, false);
  assertEqual(buildPrunedItemTextureAtlasForExport({}, ['emerald']).ok, false);
});

test('item atlas retains arbitrary namespaced keys and exports more than five selected entries', () => {
  const keys = [
    'demo:amber', 'demo:beryl', 'demo:citrine',
    'demo:diamond', 'demo:emerald', 'demo:fluorite',
  ];
  const textureData = Object.fromEntries(keys.map((key, index) => [
    key,
    { textures: `textures/demo/item_${index}` },
  ]));
  const indexed = indexItemTextureAtlas({ texture_data: textureData });
  assert(indexed.ok);
  assertEqual(indexed.entryCount, keys.length);
  assertEqual(indexed.recognizedEntryCount, keys.length);
  const exported = buildPrunedItemTextureAtlasForExport(indexed.atlas, keys);
  assert(exported.ok);
  assertDeepEqual(Object.keys(exported.value.texture_data), [...keys].sort());
  assertEqual(exported.textureRefs.length, keys.length);
});

test('item atlas status blocks unsafe lower-priority fallback deterministically', () => {
  const vanilla = parseItemTextureAtlas('{"texture_data":{"emerald":{"textures":"textures/vanilla/emerald"}}}');
  assert(vanilla.ok);
  const props = { renderer, '#item_id_aux': pack(523) };
  for (const issue of ['ITEM_TEXTURE_ATLAS_AMBIGUOUS', 'ITEM_TEXTURE_ATLAS_INVALID', 'ITEM_TEXTURE_ATLAS_READ_FAILED']) {
    const blocked = resolveNativeRendererTexture(props, {
      importedStatus: 'error', importedIssue: issue,
      vanillaStatus: 'ready', vanillaAtlas: vanilla.atlas,
    });
    assertEqual(blocked.status, 'blocked');
    assertEqual(blocked.issue, issue);
    assertEqual(blocked.textureRef, null);
  }
  assertEqual(resolveNativeRendererTexture(props, {
    importedStatus: 'loading', vanillaStatus: 'ready', vanillaAtlas: vanilla.atlas,
  }).status, 'pending');
  assertEqual(resolveNativeRendererTexture(props, {
    importedStatus: 'missing', vanillaStatus: 'ready', vanillaAtlas: vanilla.atlas,
  }).textureRef, 'textures/vanilla/emerald');
});

test('item texture atlas rejects unsafe, ambiguous, accessor, and oversized shapes', () => {
  const unsafeRefs = [
    '../secret',
    '/absolute/secret',
    'C:\\secret',
    'https://example.invalid/texture',
    `textures/${'x'.repeat(600)}`,
  ];
  for (const textureRef of unsafeRefs) {
    assertEqual(indexItemTextureAtlas({
      texture_data: { emerald: { textures: textureRef } },
    }).ok, false);
  }

  assertEqual(indexItemTextureAtlas({
    texture_data: {
      emerald: { textures: 'textures/items/emerald' },
      Emerald: { textures: 'textures/items/other' },
    },
  }).ok, false);

  const excessiveTotalRefs = Object.create(null);
  const variantsPerEntry = ITEM_TEXTURE_ATLAS_MAX_TEXTURES_PER_ENTRY;
  const entryCount = Math.floor(ITEM_TEXTURE_ATLAS_MAX_TOTAL_TEXTURE_REFS / variantsPerEntry) + 1;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    excessiveTotalRefs[`custom_${entryIndex}`] = {
      textures: Array.from(
        { length: variantsPerEntry },
        (_, textureIndex) => `textures/items/${entryIndex}_${textureIndex}`,
      ),
    };
  }
  assertEqual(indexItemTextureAtlas({ texture_data: excessiveTotalRefs }).error, 'ITEM_TEXTURE_ATLAS_TOTAL_TEXTURE_REFS_TOO_LARGE');

  assertEqual(indexItemTextureAtlas({
    texture_data: { 'bad\nkey': { textures: 'textures/items/bad' } },
  }).error, 'ITEM_TEXTURE_ATLAS_KEY_INVALID');

  let stringCoercions = 0;
  const hostileExportKey = { toString() { stringCoercions += 1; return 'emerald'; } };
  const exportAtlas = indexItemTextureAtlas({
    texture_data: { emerald: { textures: 'textures/items/emerald' } },
  });
  assert(exportAtlas.ok);
  assertEqual(buildPrunedItemTextureAtlasForExport(exportAtlas.atlas, [hostileExportKey]).ok, false);
  assertEqual(stringCoercions, 0);

  const accessorEntry = {};
  let getterCalls = 0;
  Object.defineProperty(accessorEntry, 'textures', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'textures/items/emerald';
    },
  });
  assertEqual(indexItemTextureAtlas({ texture_data: { emerald: accessorEntry } }).ok, false);
  assertEqual(getterCalls, 0);

  const tooMany = Object.create(null);
  tooMany.a = { textures: 'textures/a' };
  tooMany.b = { textures: 'textures/b' };
  assertEqual(indexItemTextureAtlas({ texture_data: tooMany }, { maxEntries: 1 }).ok, false);

  assertEqual(indexItemTextureAtlas({
    texture_data: {
      emerald: {
        textures: Array.from(
          { length: ITEM_TEXTURE_ATLAS_MAX_TEXTURES_PER_ENTRY + 1 },
          (_, index) => `textures/items/${index}`,
        ),
      },
    },
  }).ok, false);

  const inherited = Object.create({ texture_data: {} });
  assertEqual(indexItemTextureAtlas(inherited).ok, false);
  assertEqual(parseItemTextureAtlas('{}', { maxTextLength: 1 }).ok, false);
  assertEqual(parseItemTextureAtlas('{broken').ok, false);
  assertEqual(
    parseItemTextureAtlas(`{"padding":"${'🚀'.repeat(140_000)}"}`).error,
    'ITEM_TEXTURE_ATLAS_TEXT_TOO_LARGE',
  );
});

test('only explicitly supported live renderers receive bounded native placeholders', () => {
  assertEqual(getNativeRendererPlaceholderKind({ renderer: 'banner_pattern_renderer' }), 'banner-pattern');
  assertEqual(getNativeRendererPlaceholderKind({ renderer: 'enchanting_book_renderer' }), 'enchanting-book');
  assertEqual(getNativeRendererPlaceholderKind({ renderer: 'live_horse_renderer' }), 'horse-entity');
  assertEqual(getNativeRendererPlaceholderKind({ renderer: 'inventory_item_renderer' }), null);
  assertEqual(getNativeRendererPlaceholderKind({ renderer: 'future_renderer' }), null);
  assertEqual(getNativeRendererPlaceholderKind({ renderer: 'Enchanting_Book_Renderer' }), null);
  assertEqual(getNativeRendererPlaceholderKind(Object.create({ renderer: 'banner_pattern_renderer' })), null);

  let getterReads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'renderer', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'live_horse_renderer';
    },
  });
  assertEqual(getNativeRendererPlaceholderKind(accessor), null);
  assertEqual(getterReads, 0);
});

test('banner surrogate reads only bounded own runtime pattern and color arrays', () => {
  assertDeepEqual(getNativeBannerPreviewState({
    renderer: 'banner_pattern_renderer',
    banner_patterns: [41],
    banner_colors: [9],
  }), { patternIndex: 41, colorIndex: 9 });
  assertDeepEqual(getNativeBannerPreviewState({
    renderer: 'banner_pattern_renderer',
    '#banner_patterns': [0],
    '#banner_colors': [0],
  }), { patternIndex: 0, colorIndex: 0 });
  assertEqual(getNativeBannerPreviewState({
    renderer: 'banner_pattern_renderer',
    banner_patterns: [1],
    '#banner_patterns': [1],
    banner_colors: [1],
  }), null);
  assertEqual(getNativeBannerPreviewState({
    renderer: 'banner_pattern_renderer',
    banner_patterns: Array.from({ length: 65 }, () => 0),
    banner_colors: [1],
  }), null);
  assertEqual(getNativeBannerPreviewState(Object.create({
    renderer: 'banner_pattern_renderer',
    banner_patterns: [1],
    banner_colors: [1],
  })), null);
});

test('native model preview extracts horse aliases and compiles planar cubes safely', () => {
  const entity = extractHorseClientEntity({
    format_version: '1.21.0',
    'minecraft:client_entity': {
      description: {
        identifier: 'minecraft:horse', min_engine_version: '1.17.10',
        materials: { default: 'horse_leather_armor' },
        geometry: { default: 'geometry.horse.test' },
        textures: {
          base_brown: 'textures/entity/horse/brown',
          base_white: 'textures/entity/horse/white.png',
          markings_none: 'textures/entity/horse/markings_none',
          armor_none: 'textures/entity/horse/armor/none',
        },
        render_controllers: ['controller.render.horse.v4'],
      },
    },
  });
  assertEqual(entity.geometryIdentifier, 'geometry.horse.test');
  assertEqual(entity.textureAlias, 'base_white');
  assertEqual(entity.textureRef, 'textures/entity/horse/white');
  assert(compareEngineVersions(entity.minEngineVersion, [1, 16, 0]) > 0);

  const document = {
    format_version: '1.21.0',
    'minecraft:geometry': [{
      description: { identifier: 'geometry.horse.test', texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'body', pivot: [0, 0, 0], cubes: [{ origin: [-4, 0, -2], size: [8, 6, 4], uv: [0, 0] }] },
        { name: 'Reins', parent: 'body', cubes: [{ origin: [-2, 2, 2], size: [4, 0, 4], uv: [8, 8] }] },
      ],
    }],
  };
  const geometryResult = findGeometryRecordResult(document, entity.geometryIdentifier);
  assertEqual(geometryResult.status, 'found');
  const compiled = compileBedrockGeometryScene(geometryResult.geometry, {
    hiddenBonePatterns: ['Reins*'],
    geometryFormatVersion: geometryResult.formatVersion,
  });
  assertEqual(compiled.ok, true);
  // Unsaddled representative bones are hidden, but the parser accepts and
  // retains zero-thickness geometry when it belongs to a visible bone.
  const visiblePlaneGeometry = {
    description: { texture_width: 64, texture_height: 64 },
    bones: [{ name: 'mane', cubes: [{ origin: [0, 0, 0], size: [4, 0, 4], uv: [0, 0] }] }],
  };
  const plane = compileBedrockGeometryScene(visiblePlaneGeometry);
  assertEqual(plane.ok, true);
  assertEqual(plane.stats.planarCubeCount, 1);
  assert(plane.scene.faces.length > 0);
});

test('horse client entity detection does not guess unsupported custom texture aliases', () => {
  const unsupported = {
    'minecraft:client_entity': {
      description: {
        identifier: 'minecraft:horse',
        geometry: { default: 'geometry.horse.custom' },
        textures: { controller_selected_variant: 'textures/entity/horse/custom' },
      },
    },
  };
  assertEqual(isHorseClientEntityDocument(unsupported), true);
  assertEqual(extractHorseClientEntity(unsupported), null);
  assertEqual(isHorseClientEntityDocument({
    'minecraft:client_entity': { description: { identifier: 'minecraft:cow' } },
  }), false);
});

test('horse controller support requires the bounded Vanilla variant-zero contract', () => {
  const supported = inspectHorseRenderControllerDocument({
    format_version: '1.21.0',
    render_controllers: {
      'controller.render.horse.v4': {
        arrays: { textures: {
          'Array.base': ['Texture.base_white', 'Texture.base_brown'],
          'Array.markings': ['Texture.markings_none'],
          'Array.armor': ['Texture.armor_none'],
          'Array.baby_base': ['Texture.baby_base_white'],
          'Array.baby_markings': ['Texture.markings_none'],
        } },
        geometry: 'query.is_baby ? Geometry.baby : Geometry.default',
        materials: [{ '*': 'Material.default' }],
        color: {
          r: 'variable.armor_texture_slot ? query.armor_color_slot(4, 0) : this',
          g: 'variable.armor_texture_slot ? query.armor_color_slot(4, 1) : this',
          b: 'variable.armor_texture_slot ? query.armor_color_slot(4, 2) : this',
          a: 'variable.armor_texture_slot ? query.armor_color_slot(4, 3) : this',
        },
        textures: [
          'query.is_baby ? Array.baby_base[query.variant] : Array.base[query.variant]',
          'query.is_baby ? Array.baby_markings[query.mark_variant] : Array.markings[query.mark_variant]',
          'query.is_baby ? Texture.armor_none : Array.armor[variable.armor_texture_slot]',
        ],
        part_visibility: [
          { Saddle: 'query.is_saddled' }, { 'Bit*': 'query.is_saddled' },
          { Bridle: 'query.is_saddled' }, { 'Reins*': 'query.is_saddled && query.has_rider' },
          { 'Bag*': false }, { 'MuleEar*': false },
        ],
      },
    },
  });
  assertEqual(supported.status, 'supported');
  const materialOverride = inspectHorseRenderControllerDocument({
    format_version: '1.21.0',
    render_controllers: {
      'controller.render.horse.v4': {
        arrays: { textures: {
          'Array.base': ['Texture.base_white'], 'Array.markings': ['Texture.markings_none'],
          'Array.armor': ['Texture.armor_none'], 'Array.baby_base': ['Texture.baby_base_white'],
          'Array.baby_markings': ['Texture.markings_none'],
        } },
        geometry: 'query.is_baby ? Geometry.baby : Geometry.default',
        materials: [{ '*': 'Material.default', Body: 'Material.invisible' }],
        color: {
          r: 'variable.armor_texture_slot ? query.armor_color_slot(4, 0) : this',
          g: 'variable.armor_texture_slot ? query.armor_color_slot(4, 1) : this',
          b: 'variable.armor_texture_slot ? query.armor_color_slot(4, 2) : this',
          a: 'variable.armor_texture_slot ? query.armor_color_slot(4, 3) : this',
        },
        textures: [
          'query.is_baby ? Array.baby_base[query.variant] : Array.base[query.variant]',
          'query.is_baby ? Array.baby_markings[query.mark_variant] : Array.markings[query.mark_variant]',
          'query.is_baby ? Texture.armor_none : Array.armor[variable.armor_texture_slot]',
        ],
        part_visibility: [
          { Saddle: 'query.is_saddled' }, { 'Bit*': 'query.is_saddled' },
          { Bridle: 'query.is_saddled' }, { 'Reins*': 'query.is_saddled && query.has_rider' },
          { 'Bag*': false }, { 'MuleEar*': false },
        ],
      },
    },
  });
  assertEqual(materialOverride.status, 'unsupported');
  const unsupported = inspectHorseRenderControllerDocument({
    format_version: '1.21.0',
    render_controllers: {
      'controller.render.horse.v4': {
        arrays: { textures: { 'Array.base': ['Texture.base_brown'] } },
        geometry: 'Geometry.default', textures: ['Texture.base_brown'], part_visibility: [],
      },
    },
  });
  assertEqual(unsupported.status, 'unsupported');
});

test('official legacy horse entities and v1/v2 controller use a bounded adult snapshot', () => {
  const entity = extractHorseClientEntityResult({
    format_version: '1.10.0',
    'minecraft:client_entity': { description: {
      identifier: 'minecraft:horse', min_engine_version: '1.2.6',
      materials: { default: 'horse_leather_armor' },
      geometry: { default: 'geometry.horse.v2' },
      textures: {
        base_white: 'textures/entity/horse2/horse_white',
        markings_none: 'textures/entity/horse2/horse_markings_none',
        armor_none: 'textures/entity/horse2/armor/horse_armor_none',
      },
      render_controllers: ['controller.render.horse.v1.and.v2'],
    } },
  });
  assertEqual(entity.status, 'found');
  assertEqual(entity.descriptor.controllerId, 'controller.render.horse.v1.and.v2');
  assertDeepEqual(entity.descriptor.textureLayers, [
    'textures/entity/horse2/horse_white',
    'textures/entity/horse2/horse_markings_none',
    'textures/entity/horse2/armor/horse_armor_none',
  ]);

  const inspected = inspectHorseRenderControllerDocument({
    format_version: '1.8.0',
    render_controllers: { 'controller.render.horse.v1.and.v2': {
      part_visibility: [
        { '*saddle*': 'query.is_saddled' },
        { SaddleMouthLine: 'query.is_saddled && query.has_rider' },
        { SaddleMouthLineR: 'query.is_saddled && query.has_rider' },
        { 'MuleEar*': false }, { 'Bag*': false },
      ],
      arrays: { textures: {
        'Array.base': ['Texture.base_white'],
        'Array.markings': ['Texture.markings_none'],
        'Array.armor': ['Texture.armor_none'],
      } },
      geometry: 'Geometry.default',
      materials: [{ '*': 'Material.default' }],
      textures: [
        'Array.base[query.variant]',
        'Array.markings[query.mark_variant]',
        'Array.armor[variable.armor_texture_slot]',
      ],
      color: {
        r: 'variable.armor_texture_slot ? query.armor_color_slot(4, 0) : this',
        g: 'variable.armor_texture_slot ? query.armor_color_slot(4, 1) : this',
        b: 'variable.armor_texture_slot ? query.armor_color_slot(4, 2) : this',
        a: 'variable.armor_texture_slot ? query.armor_color_slot(4, 3) : this',
      },
    } },
  }, 'controller.render.horse.v1.and.v2');
  assertEqual(inspected.status, 'supported');
  assert(inspected.hiddenBonePatterns.includes('*saddle*'));
});

test('legacy horse bone parents resolve case-insensitively but collisions fail closed', () => {
  const legacy = compileBedrockGeometryScene({
    description: { texture_width: 64, texture_height: 64 },
    bones: [
      { name: 'Head', rotation: [0, 10, 0], cubes: [{ origin: [0, 0, 0], size: [2, 2, 2], uv: [0, 0] }] },
      { name: 'UMouth', parent: 'head', cubes: [{ origin: [2, 0, 0], size: [2, 1, 1], uv: [8, 0] }] },
    ],
  });
  assertEqual(legacy.ok, true);

  const collision = compileBedrockGeometryScene({
    description: { texture_width: 64, texture_height: 64 },
    bones: [
      { name: 'Head', cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] },
      { name: 'head', cubes: [{ origin: [2, 0, 0], size: [1, 1, 1], uv: [4, 0] }] },
    ],
  });
  assertEqual(collision.error, 'NATIVE_PREVIEW_MODEL_INVALID');
});

test('native model preview rejects cycles and excessive geometry', () => {
  const cycle = compileBedrockGeometryScene({
    description: { texture_width: 64, texture_height: 64 },
    bones: [
      { name: 'a', parent: 'b', cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] },
      { name: 'b', parent: 'a' },
    ],
  });
  assertEqual(cycle.ok, false);
  const excessive = compileBedrockGeometryScene({
    description: { texture_width: 64, texture_height: 64 },
    bones: [{
      name: 'body',
      cubes: Array.from({ length: 4 }, () => ({ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] })),
    }],
  }, { limits: { maxCubes: 3 } });
  assertEqual(excessive.ok, false);
  assertEqual(excessive.error, 'NATIVE_PREVIEW_LIMIT_EXCEEDED');

  const hiddenExcessive = compileBedrockGeometryScene({
    description: { texture_width: 64, texture_height: 64 },
    bones: [{
      name: 'Bag',
      cubes: Array.from({ length: 4 }, () => ({ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] })),
    }],
  }, { limits: { maxCubes: 3 }, hiddenBonePatterns: ['Bag*'] });
  assertEqual(hiddenExcessive.error, 'NATIVE_PREVIEW_LIMIT_EXCEEDED');

  const legitimateName = compileBedrockGeometryScene({
    description: { texture_width: 64, texture_height: 64 },
    bones: [{ name: 'BagelBody', cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }],
  });
  assertEqual(legitimateName.ok, true);

  const unsupportedBoneTransform = compileBedrockGeometryScene({
    description: { texture_width: 64, texture_height: 64 },
    bones: [{ name: 'body', bind_pose_rotation: [0, 1, 0], cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }],
  });
  assertEqual(unsupportedBoneTransform.error, 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED');

  const hardLimitCannotBeRaised = compileBedrockGeometryScene({
    description: { texture_width: 64, texture_height: 64 },
    bones: [{ name: 'body', cubes: Array.from({ length: 2049 }, () => ({ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] })) }],
  }, { limits: { maxCubes: Number.POSITIVE_INFINITY } });
  assertEqual(hardLimitCannotBeRaised.error, 'NATIVE_PREVIEW_LIMIT_EXCEEDED');

  const drawWorkLimited = compileBedrockGeometryScene({
    description: { texture_width: 64, texture_height: 64 },
    bones: [{
      name: 'body',
      cubes: Array.from({ length: 342 }, (_, index) => ({
        origin: [index * 2, 0, 0], size: [1, 1, 1], uv: [0, 0],
      })),
    }],
  });
  assertEqual(drawWorkLimited.error, 'NATIVE_PREVIEW_LIMIT_EXCEEDED');
});

test('native model preview rejects unknown geometry document versions', () => {
  const result = findGeometryRecordResult({
    format_version: '9.99.0',
    'minecraft:geometry': [{ description: { identifier: 'geometry.future' }, bones: [] }],
  }, 'geometry.future');
  assertEqual(result.status, 'unsupported');
  assertEqual(findGeometryRecordResult({
    format_version: '9.99.0',
    'minecraft:geometry': [{ description: { identifier: 'geometry.other' }, bones: [] }],
  }, 'geometry.target').status, 'missing');
});

test('geometry cube features are gated by their 1.8 and 1.12 schemas', () => {
  const geometryWithCube = (cube) => ({
    description: { texture_width: 32, texture_height: 32 },
    bones: [{ name: 'body', cubes: [{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0], ...cube }] }],
  });
  const compileAt = (cube, geometryFormatVersion) => compileBedrockGeometryScene(
    geometryWithCube(cube),
    { geometryFormatVersion },
  );

  assertEqual(compileAt({}, [1, 8, 0]).ok, true);
  for (const modernCubeFeature of [
    { uv: { north: { uv: [0, 0] } } },
    { rotation: [0, 90, 0] },
    { pivot: [2, 2, 2] },
  ]) {
    assertEqual(
      compileAt(modernCubeFeature, [1, 8, 0]).error,
      'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED',
    );
    assertEqual(
      compileBedrockGeometryScene(geometryWithCube(modernCubeFeature)).error,
      'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED',
    );
  }

  assertEqual(compileAt({ uv: { north: { uv: [0, 0] } } }, [1, 12, 0]).ok, true);
  assertEqual(compileAt({ rotation: [0, 90, 0] }, [1, 12, 0]).ok, true);
  assertEqual(compileAt({ pivot: [2, 2, 2] }, [1, 12, 0]).ok, true);
  // Mojang's valid Vanilla horse_v1/horse_v2 files declare 1.8 while using
  // cube inflate, so preserving that established pack behavior is required.
  assertEqual(compileAt({ inflate: 0.25 }, [1, 8, 0]).ok, true);
  assertEqual(compileAt({ inflate: 0.25 }, [1, 12, 0]).ok, true);
  assertEqual(compileAt({}, [9, 99, 0]).error, 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED');
  assertEqual(compileAt({}, '1.x').error, 'NATIVE_PREVIEW_MODEL_INVALID');
});

test('unrelated future entity and controller documents do not poison horse lookup', () => {
  assertEqual(extractHorseClientEntityResult({
    format_version: '9.99.0',
    'minecraft:client_entity': { description: { identifier: 'minecraft:cow' } },
  }).status, 'not-horse');
  const futureHorse = extractHorseClientEntityResult({
    format_version: '9.99.0',
    'minecraft:client_entity': { description: { identifier: 'minecraft:horse', min_engine_version: [9, 99, 0] } },
  });
  assertEqual(futureHorse.status, 'invalid');
  assertDeepEqual(futureHorse.minEngineVersion, [9, 99, 0]);
  assertEqual(inspectHorseRenderControllerDocument({
    format_version: '9.99.0',
    render_controllers: { 'controller.render.cow': {} },
  }).status, 'missing');
});

test('legacy geometry fails closed for version-sensitive cube pivots and UV rotation', () => {
  const rotatedPivot = compileBedrockGeometryScene({
    description: { texture_width: 32, texture_height: 32 },
    bones: [{ name: 'body', cubes: [{
      origin: [0, 0, 0], size: [4, 4, 4], pivot: [0, 2, 0], rotation: [90, 0, 0], uv: [0, 0],
    }] }],
  }, { geometryFormatVersion: [1, 12, 0] });
  assertEqual(rotatedPivot.error, 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED');

  const rotatedUv = compileBedrockGeometryScene({
    description: { texture_width: 32, texture_height: 32 },
    bones: [{ name: 'body', cubes: [{
      origin: [0, 0, 0], size: [4, 4, 4],
      uv: { north: { uv: [0, 0], uv_rotation: 90 } },
    }] }],
  }, { geometryFormatVersion: [1, 12, 0] });
  assertEqual(rotatedUv.error, 'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED');

  const legacyBoneInflate = {
    description: { texture_width: 32, texture_height: 32 },
    bones: [{ name: 'body', inflate: 1, cubes: [{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }] }],
  };
  assertEqual(compileBedrockGeometryScene(
    legacyBoneInflate,
    { geometryFormatVersion: [1, 12, 0] },
  ).ok, true);

  const mixedInflate = (inflate) => ({
    description: { texture_width: 64, texture_height: 64 },
    bones: [{ name: 'body', inflate, cubes: [
      { origin: [0, 0, 0], size: [2, 2, 2], uv: [0, 0] },
      { origin: [10, 0, 0], size: [2, 2, 2], inflate: 0, uv: [8, 0] },
    ] }],
  });
  const legacyInflated = compileBedrockGeometryScene(mixedInflate(1), { geometryFormatVersion: [1, 14, 0] });
  const legacyPlain = compileBedrockGeometryScene(mixedInflate(0), { geometryFormatVersion: [1, 14, 0] });
  const legacy8Inflated = compileBedrockGeometryScene(mixedInflate(1), { geometryFormatVersion: [1, 8, 0] });
  const legacy8Plain = compileBedrockGeometryScene(mixedInflate(0), { geometryFormatVersion: [1, 8, 0] });
  assertEqual(legacyInflated.ok, true);
  assertEqual(legacyPlain.ok, true);
  assertEqual(legacy8Inflated.ok, true);
  assertEqual(legacy8Plain.ok, true);
  assert(JSON.stringify(legacyInflated.scene.faces) !== JSON.stringify(legacyPlain.scene.faces));
  assert(JSON.stringify(legacy8Inflated.scene.faces) !== JSON.stringify(legacy8Plain.scene.faces));

  const modern16Inflated = compileBedrockGeometryScene(mixedInflate(1), { geometryFormatVersion: [1, 16, 0] });
  const modernInflated = compileBedrockGeometryScene(mixedInflate(1), { geometryFormatVersion: [1, 21, 0] });
  const modernPlain = compileBedrockGeometryScene(mixedInflate(0), { geometryFormatVersion: [1, 21, 0] });
  assertEqual(modern16Inflated.ok, true);
  assertEqual(modernInflated.ok, true);
  assertDeepEqual(modern16Inflated.scene.faces, modernPlain.scene.faces);
  assertDeepEqual(modernInflated.scene.faces, modernPlain.scene.faces);
  assertDeepEqual(
    compileBedrockGeometryScene(mixedInflate(-2), { geometryFormatVersion: [1, 21, 0] }).scene.faces,
    modernPlain.scene.faces,
  );

  const modernCubeInflatedGeometry = mixedInflate(0);
  modernCubeInflatedGeometry.bones[0].cubes[0].inflate = 1;
  const modernCubeInflated = compileBedrockGeometryScene(
    modernCubeInflatedGeometry,
    { geometryFormatVersion: [1, 21, 0] },
  );
  assertEqual(modernCubeInflated.ok, true);
  assert(JSON.stringify(modernCubeInflated.scene.faces) !== JSON.stringify(modernPlain.scene.faces));

  assertEqual(
    compileBedrockGeometryScene(modernCubeInflatedGeometry, { geometryFormatVersion: [1, 15, 0] }).error,
    'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED',
  );
  assertEqual(
    compileBedrockGeometryScene(mixedInflate(1), { geometryFormatVersion: [9, 99, 0] }).error,
    'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED',
  );
  assertEqual(
    compileBedrockGeometryScene(mixedInflate(1)).error,
    'NATIVE_PREVIEW_MODEL_FEATURE_UNSUPPORTED',
  );
  assertEqual(
    compileBedrockGeometryScene(mixedInflate('1'), { geometryFormatVersion: [1, 21, 0] }).error,
    'NATIVE_PREVIEW_MODEL_INVALID',
  );
});

test('rotated cubes without an authored pivot use the Bedrock box center', () => {
  const makeGeometry = (pivot) => ({
    description: { texture_width: 32, texture_height: 32 },
    bones: [{
      name: 'body',
      cubes: [{
        origin: [4, 0, 0], size: [2, 2, 2], rotation: [0, 90, 0], uv: [0, 0],
        ...(pivot === undefined ? {} : { pivot }),
      }],
    }],
  });
  const modernOptions = { geometryFormatVersion: [1, 14, 0] };
  const implicit = compileBedrockGeometryScene(makeGeometry(), modernOptions);
  const explicitOrigin = compileBedrockGeometryScene(makeGeometry([0, 0, 0]), modernOptions);
  const explicitCenter = compileBedrockGeometryScene(makeGeometry([5, 1, 1]), modernOptions);
  assertEqual(implicit.ok, true);
  assertDeepEqual(implicit.scene.faces, explicitCenter.scene.faces);
  assert(JSON.stringify(implicit.scene.faces) !== JSON.stringify(explicitOrigin.scene.faces));
});

test('native model preview applies Bedrock rotation signs and rejects malformed authored transforms', () => {
  const close = (actual, expected) => Math.abs(actual - expected) < 1e-9;
  const x = rotateBedrockPoint([0, 1, 0], [0, 0, 0], [90, 0, 0]);
  assert(close(x[0], 0) && close(x[1], 0) && close(x[2], -1));
  const y = rotateBedrockPoint([1, 0, 0], [0, 0, 0], [0, 90, 0]);
  assert(close(y[0], 0) && close(y[1], 0) && close(y[2], -1));
  const z = rotateBedrockPoint([1, 0, 0], [0, 0, 0], [0, 0, 90]);
  assert(close(z[0], 0) && close(z[1], -1) && close(z[2], 0));

  for (const bone of [
    { name: 'bad-rotation', rotation: 'invalid' },
    { name: 'bad-pivot', pivot: [0, 0, 'NaN'] },
    { name: 'bad-parent', parent: {} },
  ]) {
    const result = compileBedrockGeometryScene({
      description: { texture_width: 64, texture_height: 64 },
      bones: [{ ...bone, cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }],
    });
    assertEqual(result.error, 'NATIVE_PREVIEW_MODEL_INVALID');
  }
  for (const invalidVector of [[0, true, 2], ['0', 0, 0], [0, 0, 0, 0]]) {
    const result = compileBedrockGeometryScene({
      description: { texture_width: 64, texture_height: 64 },
      bones: [{ name: 'body', rotation: invalidVector, cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }],
    });
    assertEqual(result.error, 'NATIVE_PREVIEW_MODEL_INVALID');
  }
  const zeroTexture = compileBedrockGeometryScene({
    description: { texture_width: 0, texture_height: 64 },
    bones: [{ name: 'body', cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }],
  });
  assertEqual(zeroTexture.error, 'NATIVE_PREVIEW_MODEL_INVALID');
  const stringTextureSize = compileBedrockGeometryScene({
    description: { texture_width: '64', texture_height: 64 },
    bones: [{ name: 'body', cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }],
  });
  assertEqual(stringTextureSize.error, 'NATIVE_PREVIEW_MODEL_INVALID');
});

test('native model preview expands Bedrock box UVs per face and preserves mirror flips', () => {
  const makeGeometry = (cube, bone = {}) => ({
    description: { texture_width: 32, texture_height: 32 },
    bones: [{ name: 'body', ...bone, cubes: [cube] }],
  });
  const normal = compileBedrockGeometryScene(makeGeometry({
    origin: [0, 0, 0], size: [4, 6, 2], uv: [1, 3],
  }));
  assertEqual(normal.ok, true);
  const uvByFace = Object.fromEntries(normal.scene.faces.map((face) => [face.faceName, face.uv]));
  assertDeepEqual(uvByFace.up, { x: 7 / 32, y: 5 / 32, w: -4 / 32, h: -2 / 32 });
  assertDeepEqual(uvByFace.down, { x: 11 / 32, y: 3 / 32, w: -4 / 32, h: 2 / 32 });
  assertDeepEqual(uvByFace.east, { x: 1 / 32, y: 5 / 32, w: 2 / 32, h: 6 / 32 });
  assertDeepEqual(uvByFace.north, { x: 3 / 32, y: 5 / 32, w: 4 / 32, h: 6 / 32 });
  assertDeepEqual(uvByFace.west, { x: 7 / 32, y: 5 / 32, w: 2 / 32, h: 6 / 32 });
  assertDeepEqual(uvByFace.south, { x: 9 / 32, y: 5 / 32, w: 4 / 32, h: 6 / 32 });

  const mirrored = compileBedrockGeometryScene(makeGeometry({
    origin: [0, 0, 0], size: [4, 6, 2], uv: [1, 3], mirror: true,
  }));
  assertEqual(mirrored.ok, true);
  const mirroredUv = Object.fromEntries(mirrored.scene.faces.map((face) => [face.faceName, face.uv]));
  assertDeepEqual(mirroredUv.east, { x: 9 / 32, y: 5 / 32, w: -2 / 32, h: 6 / 32 });
  assertDeepEqual(mirroredUv.west, { x: 3 / 32, y: 5 / 32, w: -2 / 32, h: 6 / 32 });
});

test('per-face Bedrock UVs omit absent faces and preserve signed uv_size', () => {
  const compiled = compileBedrockGeometryScene({
    description: { texture_width: 32, texture_height: 32 },
    bones: [{
      name: 'body',
      cubes: [{
        origin: [0, 0, 0], size: [4, 6, 2],
        uv: { north: { uv: [8, 10], uv_size: [-4, 6] } },
      }],
    }],
  }, { geometryFormatVersion: [1, 12, 0] });
  assertEqual(compiled.ok, true);
  assertEqual(compiled.scene.faces.length, 1);
  assertEqual(compiled.scene.faces[0].faceName, 'north');
  assertDeepEqual(compiled.scene.faces[0].uv, { x: 8 / 32, y: 10 / 32, w: -4 / 32, h: 6 / 32 });
  assertEqual(compiled.scene.faces[0].uvPoints.length, 4);
});

test('per-face upper UV conversion and rotation preserve authored orientation', () => {
  const baseGeometry = (rotation) => ({
    description: { texture_width: 32, texture_height: 32 },
    bones: [{
      name: 'body',
      cubes: [{
        origin: [0, 0, 0], size: [4, 6, 2],
        uv: { up: { uv: [8, 10], uv_size: [4, 2], ...(rotation === undefined ? {} : { uv_rotation: rotation }) } },
      }],
    }],
  });
  const modernOptions = { geometryFormatVersion: [1, 21, 0] };
  const normal = compileBedrockGeometryScene(baseGeometry(0), modernOptions);
  const rotated = compileBedrockGeometryScene(baseGeometry(90), modernOptions);
  assertEqual(normal.ok, true);
  assertEqual(rotated.ok, true);
  assertDeepEqual(normal.scene.faces[0].uv, { x: 12 / 32, y: 12 / 32, w: -4 / 32, h: -2 / 32 });
  assertDeepEqual(rotated.scene.faces[0].uvPoints, [
    normal.scene.faces[0].uvPoints[1], normal.scene.faces[0].uvPoints[2],
    normal.scene.faces[0].uvPoints[3], normal.scene.faces[0].uvPoints[0],
  ]);
  assertEqual(compileBedrockGeometryScene(baseGeometry(45), modernOptions).error, 'NATIVE_PREVIEW_MODEL_INVALID');
});

test('geometry lookup fails closed on duplicate ids and candidate overflow', () => {
  const duplicate = findGeometryRecordResult({
    format_version: '1.21.0',
    'minecraft:geometry': [
      { description: { identifier: 'geometry.horse' }, bones: [] },
      { description: { identifier: 'geometry.horse' }, bones: [] },
    ],
  }, 'geometry.horse');
  assertEqual(duplicate.status, 'ambiguous');
  const overflow = findGeometryRecordResult({
    format_version: '1.21.0',
    'minecraft:geometry': Array.from({ length: 257 }, (_, index) => ({
      description: { identifier: `geometry.${index}` }, bones: [],
    })),
  }, 'geometry.256');
  assertEqual(overflow.status, 'limit');
});

test('enchanting book scene has finite volume, affine pack UVs and bounded opening', () => {
  const scene = buildEnchantingBookPreviewScene();
  assertEqual(scene.kind, 'book');
  assert(scene.faces.length > 5 && scene.faces.length <= 36);
  assertEqual(scene.geometrySource, 'bounded-procedural-preview');
  assert(scene.approximation.length > 0);
  assert(new Set(scene.faces.map((face) => face.depth)).size > 5);
  const names = new Set(scene.faces.map((face) => face.boneName));
  for (const name of ['left_cover', 'right_cover', 'left_pages', 'right_pages', 'spine']) assert(names.has(name));
  const close = (actual, expected) => Math.abs(actual - expected) < 1e-12;
  for (const face of scene.faces) {
    const [p0, p1, p2, p3] = face.points;
    assert(close(p2.x, p1.x + p3.x - p0.x));
    assert(close(p2.y, p1.y + p3.y - p0.y));
    for (const point of [...face.points, ...face.uvPoints]) {
      assert(point.x >= 0 && point.x <= 1);
      assert(point.y >= 0 && point.y <= 1);
    }
    assert(Math.min(face.uv.x, face.uv.x + face.uv.w) >= 0);
    assert(Math.max(face.uv.x, face.uv.x + face.uv.w) <= 1);
    assert(Math.min(face.uv.y, face.uv.y + face.uv.h) >= 0);
    assert(Math.max(face.uv.y, face.uv.y + face.uv.h) <= 1);
  }
  const narrow = buildEnchantingBookPreviewScene({ openingDegrees: 40 });
  assert(JSON.stringify(narrow.faces) !== JSON.stringify(scene.faces));
  for (const openingDegrees of [-1, 181, NaN, Infinity, '130']) {
    assertEqual(buildEnchantingBookPreviewScene({ openingDegrees }), null);
  }
});
