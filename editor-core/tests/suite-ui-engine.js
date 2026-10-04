import { assert, assertDeepEqual, assertEqual, test } from './test-harness.js';
import {
  buildUiCatalog,
  findCatalogFile,
  isPocketUiPath,
  listDefinitionsForFile,
  listEffectiveDefinitionsForPath,
} from '../src/engine/ui-catalog.js';
import { mergeRepresentativeCollectionMockData, resolveEffectiveUi } from '../src/engine/effective-ui-resolver.js';
import { evaluateBindingsForUiModel } from '../src/bindings/bindings-evaluator.js';
import {
  buildRepresentativeClassicBindingMockData,
  buildRepresentativeClassicCollectionData,
  buildRepresentativeClassicCollections,
  buildRepresentativeClassicResolverVariables,
  buildRepresentativeClassicRuntimeVariableNames,
  getStandardClassicScreenTitleKey,
  isStandardClassicRecipeBookScreen,
  REPRESENTATIVE_CLASSIC_LOOM_PATTERN_COUNT,
} from '../src/engine/representative-classic-runtime.js';
import { buildUiScreenModelFromJson, uiScreenModelToJson } from '../src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel, shouldDefaultCollapseGeneratedCollectionNode } from '../src/editor/ui-model-tree.js';
import {
  compareCanvasPaintOrder,
  computeLayoutBoxesForFile,
  drawCanvasPreview,
  findDrawableCanvasBounds,
  fitViewToBounds,
  getResizeHandlesForBox,
  hitTestBoxes,
  hitTestResizeHandles,
  inferObservedUiScale,
  isVisibleFromProps,
  countDrawableCanvasBoxes,
  shouldShowCanvasEmptyState,
  estimateTextIntrinsicSize,
  buildImageDrawMetadataFromProps,
  mergeExplicitTextureBaseSize,
  computeImageSourceRect,
  computeImageClipRect,
  computeTiledImagePatches,
} from '../src/preview/canvas-preview.js';

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text), errors: [] };
  } catch (error) {
    return { ok: false, value: null, errors: [{ message: String(error.message || error) }] };
  }
}

function makeSource(id, kind, precedence, docs) {
  return {
    id,
    kind,
    precedence,
    filePaths: Object.keys(docs),
    async readText(path) {
      if (!Object.prototype.hasOwnProperty.call(docs, path)) throw new Error('PACK_NOT_FOUND');
      return JSON.stringify(docs[path]);
    },
  };
}

function findModelNodeByLocalName(model, localName) {
  const stack = model?.root ? [model.root] : [];
  while (stack.length) {
    const node = stack.pop();
    if (node?.key?.local_name === localName) return node;
    for (const child of node?.children || []) stack.push(child);
  }
  return null;
}

function findAllModelNodesByLocalName(model, localName) {
  const matches = [];
  const stack = model?.root ? [model.root] : [];
  while (stack.length) {
    const node = stack.pop();
    if (node?.key?.local_name === localName) matches.push(node);
    for (let index = (node?.children || []).length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]);
    }
  }
  return matches;
}

async function makeCatalog() {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/_global_variables.json': { '$default_texture': 'textures/ui/vanilla' },
    'ui/common.json': {
      namespace: 'common',
      base_screen: { type: 'panel', size: [320, 180], layer: 1 },
      base_label: { type: 'label', text: 'base', color: [1, 1, 1] },
    },
    'ui/example_pocket.json': {
      namespace: 'pocket_example',
      pocket_screen: { type: 'panel' },
    },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/custom.json': {
      namespace: 'custom',
      'main_screen@common.base_screen': {
        '$title': 'menu.title',
        layer: 4,
        controls: [
          { 'title@common.base_label': { text: '$title' } },
        ],
      },
      helper_panel: { type: 'panel', size: [40, 40] },
    },
    'ui/common_override.json': {
      namespace: 'common',
      base_label: { type: 'label', text: 'override', shadow: true },
    },
  });
  return buildUiCatalog({ sources: [vanilla, imported], parseJsonc: parseJson });
}

test('UI catalog closes official fixed factory specs and lexical variable alternatives', async () => {
  // Keep the globals after the UI document to prove ZIP entry order does not
  // decide whether a fixed variable-backed control reference is discovered.
  const source = makeSource('factory-refs', 'imported', 20, {
    'ui/factory_refs.json': {
      namespace: 'factory_refs',
      screen: {
        '$control_ids': {
          row: 'row_instance@factory_refs.row',
          toast: '@factory_refs.toast',
        },
        '$template': 'factory_refs.alt_row',
        variables: [
          { requires: '$touch', '$template': 'factory_refs.touch_row' },
        ],
        grid_item_template: '$global_template',
        factory: {
          control_name: 'message@factory_refs.row',
          control_ids: '$control_ids',
        },
        controls: [
          { 'dynamic_child@$template': {} },
        ],
      },
      row: { type: 'panel' },
      toast: { type: 'panel' },
      standalone_row: { type: 'panel' },
      standalone_factory: {
        type: 'factory',
        control_name: '@factory_refs.standalone_row',
      },
      alt_row: { type: 'panel' },
      touch_row: { type: 'panel' },
      global_row: { type: 'panel' },
    },
    'ui/_global_variables.json': {
      '$global_template': 'factory_refs.global_row',
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const screen = catalog.records.find((record) => record.qualifiedName === 'factory_refs.screen');
  assertDeepEqual(screen.references, [
    'factory_refs.alt_row',
    'factory_refs.global_row',
    'factory_refs.row',
    'factory_refs.toast',
    'factory_refs.touch_row',
  ]);
  const standaloneFactory = catalog.records.find((record) => (
    record.qualifiedName === 'factory_refs.standalone_factory'
  ));
  const standaloneRow = catalog.records.find((record) => (
    record.qualifiedName === 'factory_refs.standalone_row'
  ));
  assertDeepEqual(standaloneFactory.references, ['factory_refs.standalone_row']);
  assertEqual(standaloneRow.classification, 'COMPONENT');
  assert(!catalog.diagnostics.some((item) => item.code === 'UI_REFERENCE_SCAN_LIMIT'));
});

test('UI catalog carries derived lexical variables into inherited factory dependencies', async () => {
  const source = makeSource('inherited-factory-refs', 'imported', 20, {
    'ui/inherited_factory_refs.json': {
      namespace: 'inherited_factory_refs',
      target: { type: 'label', text: 'resolved target' },
      base: {
        type: 'stack_panel',
        factory: {
          name: 'rows_factory',
          control_ids: '$ids',
        },
      },
      'screen@inherited_factory_refs.base': {
        '$ids': { only: 'generated@inherited_factory_refs.target' },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const screen = catalog.records.find((record) => (
    record.qualifiedName === 'inherited_factory_refs.screen'
  ));
  const target = catalog.records.find((record) => (
    record.qualifiedName === 'inherited_factory_refs.target'
  ));
  assertDeepEqual(screen.references, [
    'inherited_factory_refs.base',
    'inherited_factory_refs.target',
  ]);
  assertEqual(target.classification, 'COMPONENT');
  assert(!catalog.diagnostics.some((item) => item.code === 'UI_REFERENCE_SCAN_LIMIT'));
});

test('UI catalog fails closed when contextual inheritance exceeds its record budget', async () => {
  const definitions = {
    namespace: 'reference_record_limit',
    target: { type: 'panel' },
    screen: {
      '$ids': { only: 'generated@reference_record_limit.target' },
      controls: [{ 'content@reference_record_limit.base_0': {} }],
    },
  };
  for (let index = 0; index < 12; index += 1) {
    const next = index + 1;
    definitions[`base_${index}@reference_record_limit.base_${next}`] = {
      type: 'panel',
      factory: { control_ids: '$ids' },
    };
  }
  definitions.base_12 = { type: 'panel', factory: { control_ids: '$ids' } };
  const source = makeSource('reference-record-limit', 'imported', 20, {
    'ui/reference_record_limit.json': definitions,
  });
  const catalog = await buildUiCatalog({
    sources: [source],
    parseJsonc: parseJson,
    limits: { maxReferenceRecordVisits: 4 },
  });
  const diagnostic = catalog.diagnostics.find((item) => (
    item.code === 'UI_REFERENCE_SCAN_LIMIT' && item.definition === 'screen'
  ));
  assert(diagnostic, 'Expected an explicit incomplete-scan diagnostic');
  assert(diagnostic.reasons.includes('record-visits'));
});

test('UI catalog keeps cross-definition depth cumulative to bound recursive composition', async () => {
  const definitions = {
    namespace: 'reference_depth_limit',
    screen: {
      type: 'screen',
      '$context_marker': true,
      controls: [{ 'content@reference_depth_limit.base_0': {} }],
    },
  };
  for (let index = 0; index < 200; index += 1) {
    definitions[`base_${index}`] = {
      type: 'panel',
      controls: [{ [`next@reference_depth_limit.base_${index + 1}`]: {} }],
    };
  }
  definitions.base_200 = { type: 'panel' };
  const source = makeSource('reference-depth-limit', 'imported', 20, {
    'ui/reference_depth_limit.json': definitions,
  });
  const catalog = await buildUiCatalog({
    sources: [source],
    parseJsonc: parseJson,
    limits: { maxScanDepth: 24 },
  });
  const diagnostic = catalog.diagnostics.find((item) => (
    item.code === 'UI_REFERENCE_SCAN_LIMIT' && item.definition === 'screen'
  ));
  assert(diagnostic, 'Expected recursive composition to stop with a bounded diagnostic');
  assert(diagnostic.reasons.includes('depth'));
});

test('UI catalog fails closed when a definition exceeds its reference node budget', async () => {
  const source = makeSource('reference-node-limit', 'imported', 20, {
    'ui/reference_node_limit.json': {
      namespace: 'reference_node_limit',
      screen: {
        type: 'screen',
        controls: Array.from({ length: 20 }, (_, index) => ({
          [`child_${index}`]: { type: 'panel' },
        })),
      },
    },
  });
  const catalog = await buildUiCatalog({
    sources: [source],
    parseJsonc: parseJson,
    limits: { maxReferenceNodesPerDefinition: 8 },
  });
  const diagnostic = catalog.diagnostics.find((item) => (
    item.code === 'UI_REFERENCE_SCAN_LIMIT' && item.definition === 'screen'
  ));
  assert(diagnostic, 'Expected an explicit incomplete-scan diagnostic');
  assert(diagnostic.reasons.includes('nodes'));
});

test('representative Classic resolver context supplies stable desktop platform facts', () => {
  const variables = buildRepresentativeClassicResolverVariables();
  assertEqual(variables.$desktop_screen, true);
  assertEqual(variables.$pocket_screen, false);
  assertEqual(variables.$touch, false);
  assertDeepEqual(variables.$left_horizontal_safezone_size, [0, 0]);
  assertEqual(Object.prototype.hasOwnProperty.call(variables, '$container_title'), false);
  assertEqual(Object.prototype.hasOwnProperty.call(variables, '$localize_title'), false);
});

test('representative Classic resolver context adds titles only for exact standard screens', () => {
  const furnace = buildRepresentativeClassicResolverVariables({
    qualifiedName: 'furnace.furnace_screen',
  });
  assertEqual(furnace.$container_title, 'container.furnace');
  assertEqual(furnace.$localize_title, true);

  assertEqual(getStandardClassicScreenTitleKey(' @grindstone.grindstone_screen '), 'container.repairAndDisenchant');
  assertEqual(getStandardClassicScreenTitleKey('beacon.beacon_screen'), 'container.beacon');
  assertEqual(getStandardClassicScreenTitleKey('chest.large_chest_screen'), 'container.chestDouble');
  assertEqual(getStandardClassicScreenTitleKey('cartography.cartography_screen'), 'tile.cartography_table.name');
  assertEqual(getStandardClassicScreenTitleKey('blast_furnace.blast_furnace_screen'), 'container.blast_furnace');
  assertEqual(getStandardClassicScreenTitleKey('smoker.smoker_screen'), 'container.smoker');
  assertEqual(getStandardClassicScreenTitleKey('redstone.crafter_screen'), 'container.crafter');
  assertEqual(getStandardClassicScreenTitleKey('horse.horse_screen'), null);

  const representativeHorse = buildRepresentativeClassicResolverVariables({
    qualifiedName: 'horse.horse_screen',
  });
  assertEqual(representativeHorse.$container_title, 'entity.horse.name');
  assertEqual(representativeHorse.$localize_title, true);

  for (const qualifiedName of [
    'custom.furnace_screen',
    'custom.screen@furnace.furnace_screen',
    'custom.horse_screen',
    'trade.trade_screen',
    'constructor',
    'toString',
    '__proto__',
    '',
  ]) {
    const variables = buildRepresentativeClassicResolverVariables({ qualifiedName });
    assertEqual(Object.prototype.hasOwnProperty.call(variables, '$container_title'), false, qualifiedName);
    assertEqual(Object.prototype.hasOwnProperty.call(variables, '$localize_title'), false, qualifiedName);
  }
});

test('representative Classic resolver context lets explicit dollar-variable overrides win', () => {
  const variables = buildRepresentativeClassicResolverVariables({
    qualifiedName: 'chest.barrel_screen',
    baseVariables: {
      '$show_close_button': false,
      '$base_only': 17,
      '#binding_data_does_not_belong_here': true,
    },
    userVariables: {
      '$container_title': 'pack.custom_barrel_title',
      '$localize_title': false,
      '$touch': true,
      '$base_only': 23,
      '#is_survival_layout': false,
    },
  });

  assertEqual(variables.$container_title, 'pack.custom_barrel_title');
  assertEqual(variables.$localize_title, false);
  assertEqual(variables.$touch, true);
  assertEqual(variables.$show_close_button, false);
  assertEqual(variables.$base_only, 23);
  assertEqual(Object.prototype.hasOwnProperty.call(variables, '#binding_data_does_not_belong_here'), false);
  assertEqual(Object.prototype.hasOwnProperty.call(variables, '#is_survival_layout'), false);

  const horseOverride = buildRepresentativeClassicResolverVariables({
    qualifiedName: 'horse.horse_screen',
    userVariables: { $container_title: 'pack.custom_mount', $localize_title: false },
  });
  assertEqual(horseOverride.$container_title, 'pack.custom_mount');
  assertEqual(horseOverride.$localize_title, false);
});

test('representative recipe rows are scoped to exact stock screens or explicit collection data', () => {
  assertEqual(isStandardClassicRecipeBookScreen('furnace.furnace_screen'), true);
  assertEqual(isStandardClassicRecipeBookScreen('custom.furnace_screen'), false);

  const stock = buildRepresentativeClassicCollections({ qualifiedName: 'furnace.furnace_screen' });
  assertEqual(stock.recipe_book.count, 136);

  const custom = buildRepresentativeClassicCollections({ qualifiedName: 'custom.furnace_screen' });
  assertEqual(Object.prototype.hasOwnProperty.call(custom, 'recipe_book'), false);

  const explicit = buildRepresentativeClassicCollections({
    qualifiedName: 'custom.furnace_screen',
    collectionData: {
      recipe_book: [{ '#item_name': 'one' }, { '#item_name': 'two' }],
      sparse: { 0: {}, 3: {} },
    },
  });
  assertEqual(explicit.recipe_book.count, 2);
  assertEqual(explicit.sparse.count, 4);
});

test('representative collection discovery caps inspected entries and object-row keys', () => {
  const collectionData = Object.create(null);
  let valueReads = 0;
  for (let index = 0; index < 512; index += 1) {
    Object.defineProperty(collectionData, `invalid_${String(index).padStart(3, '0')}`, {
      enumerable: true,
      get() {
        valueReads += 1;
        return 'not-a-collection';
      },
    });
  }
  Object.defineProperty(collectionData, 'late_valid', {
    enumerable: true,
    get() {
      valueReads += 1;
      return [{ '#value': 'must-not-be-inspected' }];
    },
  });

  const bounded = buildRepresentativeClassicCollections({
    qualifiedName: 'custom.screen',
    collectionData,
  });
  assertEqual(valueReads, 512, 'The entry budget must count rejected entries');
  assertEqual(Object.prototype.hasOwnProperty.call(bounded, 'late_valid'), false);

  const objectRows = Object.create(null);
  for (let index = 0; index < 513; index += 1) objectRows[String(index)] = {};
  const boundedRows = buildRepresentativeClassicCollections({
    qualifiedName: 'custom.screen',
    collectionData: { object_rows: objectRows },
  });
  assertEqual(boundedRows.object_rows.count, 512, 'Object row discovery must share the inspection bound');
});

test('exact stock screens receive isolated representative binding states', () => {
  const cartography = buildRepresentativeClassicBindingMockData({
    qualifiedName: 'cartography.cartography_screen',
  });
  const modeKeys = [
    '#is_none_mode', '#is_clone_mode', '#is_rename_mode', '#is_basic_map_mode',
    '#is_locator_map_mode', '#is_extend_mode', '#is_locked_mode',
  ];
  assertDeepEqual(modeKeys.filter((key) => cartography[key] === true), ['#is_none_mode']);

  const overridden = buildRepresentativeClassicBindingMockData({
    qualifiedName: 'cartography.cartography_screen',
    userMockData: { '#is_none_mode': false, '#is_clone_mode': true, '$not_a_binding': true },
  });
  assertEqual(overridden['#is_none_mode'], false);
  assertEqual(overridden['#is_clone_mode'], true);
  assertEqual(Object.prototype.hasOwnProperty.call(overridden, '$not_a_binding'), false);

  const beacon = buildRepresentativeClassicBindingMockData({ qualifiedName: 'beacon.beacon_screen' });
  assertEqual(beacon['#supports_netherite'], true);
  assertEqual(buildRepresentativeClassicBindingMockData({ qualifiedName: 'enchanting.enchanting_screen' })['#open'], false);
  const horse = buildRepresentativeClassicBindingMockData({ qualifiedName: 'horse.horse_screen' });
  assertDeepEqual(horse['#equip_grid_dimensions'], [1, 2]);
  assertDeepEqual(horse['#inv_grid_dimensions'], [5, 3]);
  assertEqual(horse['#has_saddle_slot'], true);
  assertEqual(horse['#has_horse_armor_and_saddle_slot'], true);
  assertEqual(horse['#is_chested'], false);
  const horseOverride = buildRepresentativeClassicBindingMockData({
    qualifiedName: 'horse.horse_screen',
    userMockData: { '#is_chested': true, '#inv_grid_dimensions': [5, 5] },
  });
  assertEqual(horseOverride['#is_chested'], true);
  assertDeepEqual(horseOverride['#inv_grid_dimensions'], [5, 5]);

  const crafter = buildRepresentativeClassicBindingMockData({ qualifiedName: 'redstone.crafter_screen' });
  assertEqual(crafter['#redstone_arrow_texture'], 'textures/ui/redstone_arrow_unpowered');
  assertEqual(crafter['#output_stack_count'], '');
  for (let index = 0; index < 9; index += 1) assertEqual(crafter[`#button_visible${index}`], false);
  const crafterOverride = buildRepresentativeClassicBindingMockData({
    qualifiedName: 'redstone.crafter_screen',
    userMockData: { '#button_visible4': true, '#redstone_arrow_texture': 'textures/ui/custom_arrow' },
  });
  assertEqual(crafterOverride['#button_visible4'], true);
  assertEqual(crafterOverride['#redstone_arrow_texture'], 'textures/ui/custom_arrow');

  const chat = buildRepresentativeClassicBindingMockData({ qualifiedName: 'chat.chat_screen' });
  assertEqual(chat['#chat_title_visible'], false);
  assertEqual(chat['#chat_coordinate_dropdown_label'], 'chat.coordinateTypePosition');
  assertEqual(chat['#chat_coordinate_dropdown'], false);
  assertEqual(chat['#coordinates_text'], '0, 0, 0');
  assertEqual(chat['#keyboard_button_visible'], true);

  const book = buildRepresentativeClassicBindingMockData({ qualifiedName: 'book.book_screen' });
  assertEqual(book['#viewing'], true);
  assertEqual(book['#edit_controls_active'], false);
  const signingBook = buildRepresentativeClassicBindingMockData({
    qualifiedName: 'book.book_screen', userMockData: { '#signing': true },
  });
  assertEqual(signingBook['#signing'], true);
  assertEqual(signingBook['#viewing'], false);
  assertEqual(signingBook['#picking'], false);
  assertEqual(signingBook['#exporting'], false);

  assertDeepEqual(buildRepresentativeClassicBindingMockData({ qualifiedName: 'custom.cartography_screen' }), {});
  assertDeepEqual(buildRepresentativeClassicBindingMockData({ qualifiedName: 'custom.crafter_screen' }), {});
  assertDeepEqual(buildRepresentativeClassicBindingMockData({ qualifiedName: 'custom.horse_screen' }), {});
  const chatVariables = buildRepresentativeClassicResolverVariables({ qualifiedName: 'chat.chat_screen' });
  assertEqual(chatVariables.$is_pregame, false);
  assertEqual(chatVariables.$chat_font_type, 'default');
  assertEqual(chatVariables.$chat_font_scale_factor, 1);
  assertEqual(chatVariables.$chat_line_spacing, 0);
  assertEqual(chatVariables.$max_text_edit_length, 256);
  assertEqual(buildRepresentativeClassicResolverVariables({ qualifiedName: 'book.book_screen' }).$education_edition, false);
});

test('representative stock collections stay exact-screen scoped and user data wins', () => {
  const beaconDefinitions = buildRepresentativeClassicCollections({ qualifiedName: 'beacon.beacon_screen' });
  const beaconRows = buildRepresentativeClassicCollectionData(beaconDefinitions);
  assertDeepEqual(Object.keys(beaconRows), [
    'inventory_items', 'hotbar_items', 'beacon_payment_items',
    'speed', 'haste', 'resist', 'jump', 'strength', 'regen', 'extra', 'confirm', 'cancel',
  ]);
  assertEqual(beaconRows.inventory_items.length, 27);
  assertEqual(beaconRows.hotbar_items.length, 9);
  assertEqual(beaconRows.beacon_payment_items.length, 1);
  assertEqual(beaconRows.beacon_payment_items[0]['#item_valid'], false);
  assertEqual(beaconRows.hotbar_items[0]['#is_selected_slot'], false);
  assertEqual(beaconRows.speed[0]['#button_visible'], true);
  assertEqual(beaconRows.speed[0]['#extra_image_selection'], true);
  assertEqual(beaconRows.haste[0]['#extra_image_selection'], false);
  beaconRows.speed[0]['#active'] = false;
  assertEqual(beaconRows.haste[0]['#active'], true, 'Representative rows must not share mutable state');

  const userSpeed = [{ '#button_visible': false, '#active': false }];
  const overridden = buildRepresentativeClassicCollectionData(beaconDefinitions, { speed: userSpeed });
  assertEqual(overridden.speed, userSpeed);
  assertEqual(overridden.speed[0]['#button_visible'], false);
  assertEqual(overridden.haste[0]['#button_visible'], true);

  const loomDefinitions = buildRepresentativeClassicCollections({ qualifiedName: 'loom.loom_screen' });
  assertEqual(loomDefinitions.patterns.count, REPRESENTATIVE_CLASSIC_LOOM_PATTERN_COUNT);
  const loomRows = buildRepresentativeClassicCollectionData(loomDefinitions);
  assertEqual(loomRows.patterns.length, REPRESENTATIVE_CLASSIC_LOOM_PATTERN_COUNT);
  assertEqual(loomRows.patterns[0]['#pattern_selector_total_items'], REPRESENTATIVE_CLASSIC_LOOM_PATTERN_COUNT);
  assertEqual(loomRows.patterns[0]['#pattern_cell_background_texture'], 'textures/ui/recipe_book_item_bg');

  const enchantingDefinitions = buildRepresentativeClassicCollections({
    qualifiedName: 'enchanting.enchanting_screen',
  });
  const enchantingRows = buildRepresentativeClassicCollectionData(enchantingDefinitions);
  assertEqual(enchantingRows['#enchant_buttons'].length, 3);
  for (const row of enchantingRows['#enchant_buttons']) {
    assertEqual(row['#selectable_button_visibility'], false);
    assertEqual(row['#unselectable_button_visibility'], true);
    assertEqual(row['#runes'], '');
    assertEqual(row['#cost'], '');
  }

  const horseDefinitions = buildRepresentativeClassicCollections({ qualifiedName: 'horse.horse_screen' });
  assertEqual(horseDefinitions.horse_equip_items.count, 2);
  assertEqual(buildRepresentativeClassicCollectionData(horseDefinitions).horse_equip_items.length, 2);
  const emptyEnchanting = { '#enchant_buttons': [] };
  const emptyEnchantingDefinitions = buildRepresentativeClassicCollections({
    qualifiedName: 'enchanting.enchanting_screen',
    collectionData: emptyEnchanting,
  });
  assertEqual(emptyEnchantingDefinitions['#enchant_buttons'].count, 0);
  assertEqual(buildRepresentativeClassicCollectionData(
    emptyEnchantingDefinitions,
    emptyEnchanting,
  )['#enchant_buttons'].length, 0);
  const emptyHorse = { horse_equip_items: [] };
  const emptyHorseDefinitions = buildRepresentativeClassicCollections({
    qualifiedName: 'horse.horse_screen',
    collectionData: emptyHorse,
  });
  assertEqual(emptyHorseDefinitions.horse_equip_items.count, 0);
  assertEqual(buildRepresentativeClassicCollectionData(
    emptyHorseDefinitions,
    emptyHorse,
  ).horse_equip_items.length, 0);

  const emptyUserPatterns = { patterns: [] };
  const emptyDefinitions = buildRepresentativeClassicCollections({
    qualifiedName: 'loom.loom_screen',
    collectionData: emptyUserPatterns,
  });
  assertEqual(emptyDefinitions.patterns.count, 0);
  assertEqual(buildRepresentativeClassicCollectionData(emptyDefinitions, emptyUserPatterns).patterns.length, 0);
  assertEqual(Object.prototype.hasOwnProperty.call(
    buildRepresentativeClassicCollections({ qualifiedName: 'custom.loom_screen' }),
    'patterns',
  ), false);
  assertEqual(Object.prototype.hasOwnProperty.call(
    buildRepresentativeClassicCollections({ qualifiedName: 'custom.enchanting_screen' }),
    '#enchant_buttons',
  ), false);
  assertEqual(Object.prototype.hasOwnProperty.call(
    buildRepresentativeClassicCollections({ qualifiedName: 'custom.horse_screen' }),
    'horse_equip_items',
  ), false);

  const loomGhostRows = buildRepresentativeClassicCollectionData(loomDefinitions);
  assertEqual(loomGhostRows.loom_input_items[0]['#empty_image_visible'], true);
  assertEqual(loomGhostRows.loom_dye_items[0]['#empty_image_visible'], true);
  assertEqual(loomGhostRows.loom_material_items[0]['#empty_image_visible'], true);

  const tradeDefinitions = buildRepresentativeClassicCollections({ qualifiedName: 'trade2.trade_screen' });
  const tradeRows = buildRepresentativeClassicCollectionData(tradeDefinitions);
  assertEqual(tradeDefinitions.trade_tiers.count, 1);
  assertEqual(tradeRows.trades.length, 2);
  assertEqual(tradeRows.trade_item_1[0]['#item_id_aux'], 388 * 0x1_0000);
  assertEqual(
    buildRepresentativeClassicResolverVariables({ qualifiedName: 'trade2.trade_screen' }).$second_item_slot_ignored,
    false,
  );
  assertEqual(Object.prototype.hasOwnProperty.call(
    buildRepresentativeClassicCollections({ qualifiedName: 'custom.trade_screen' }),
    'trade_tiers',
  ), false);

  const legacyTradeDefinitions = buildRepresentativeClassicCollections({ qualifiedName: 'trade.trade_screen' });
  const legacyTradeRows = buildRepresentativeClassicCollectionData(legacyTradeDefinitions);
  assertEqual(legacyTradeRows.trade_item_A[0]['#item_id_aux'], 388 * 0x1_0000);
  assertEqual(legacyTradeRows.trade_item_B[0]['#item_id_aux'], 265 * 0x1_0000);
  assertEqual(legacyTradeRows.sell_item[0]['#item_id_aux'], 264 * 0x1_0000);
  assertEqual(legacyTradeRows.trade_ingredient1_items[0]['#inactive_item'], false);
  assertEqual(legacyTradeRows.trade_result_item[0]['#bundle_selected_item_visible'], false);
  assertEqual(
    buildRepresentativeClassicBindingMockData({ qualifiedName: 'trade.trade_screen' })['#show_second_trade_slot'],
    true,
  );

  const bookDefinitions = buildRepresentativeClassicCollections({ qualifiedName: 'book.book_screen' });
  const bookRows = buildRepresentativeClassicCollectionData(bookDefinitions);
  assertEqual(bookRows.book_pages.length, 2);
  assertEqual(bookRows.book_pages[0]['#page_number'], '1 / 2');
  assertEqual(bookRows.book_pages[1]['#page_number'], '2 / 2');
  assertEqual(Object.prototype.hasOwnProperty.call(
    buildRepresentativeClassicCollections({ qualifiedName: 'custom.book_screen' }),
    'book_pages',
  ), false);

  const chatDefinitions = buildRepresentativeClassicCollections({ qualifiedName: 'chat.chat_screen' });
  const chatRows = buildRepresentativeClassicCollectionData(chatDefinitions);
  assertEqual(chatRows.messages_factory.length, 2);
  assertEqual(
    chatRows.messages_factory[0].__jsonui_preview_factory_control_id,
    'chat_screen_messages',
  );
  assertEqual(chatRows.messages_factory[0]['#text'], '<Alex> Hello!');
  assertEqual(chatRows.messages_factory[1]['#text'], '<Steve> Welcome!');
  assertEqual(Object.prototype.hasOwnProperty.call(
    buildRepresentativeClassicCollections({ qualifiedName: 'custom.chat_screen' }),
    'messages_factory',
  ), false);
  const userChatDefinitions = buildRepresentativeClassicCollections({
    qualifiedName: 'chat.chat_screen',
    collectionData: { messages_factory: [] },
  });
  assertEqual(userChatDefinitions.messages_factory.count, 0);
  assertEqual(Object.prototype.hasOwnProperty.call(userChatDefinitions.messages_factory, 'rows'), false);
});

test('collection-backed structural factories materialize nested bounded templates', async () => {
  const source = makeSource('factory', 'vanilla', 10, {
    'ui/factory.json': {
      namespace: 'factory_test',
      row: {
        type: 'panel',
        controls: [{ nested: {
          type: 'stack_panel',
          collection_name: 'inner_rows',
          factory: { name: 'selected_pack_factory', control_name: 'factory_test.leaf' },
        } }],
      },
      leaf: { type: 'label', text: '#name' },
      screen: {
        type: 'screen',
        controls: [{ list: {
          type: 'stack_panel',
          collection_name: 'outer_rows',
          factory: { name: 'selected_pack_factory', control_name: 'factory_test.row' },
        } }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_test.screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections: {
      outer_rows: { count: 2 },
      inner_rows: { count: 3 },
    },
  });
  assertEqual(result.ok, true);
  assertEqual(result.stats.materializedFactoryItems, 8);
  const outer = result.document.screen.controls[0].list.controls;
  assertEqual(outer.length, 2);
  assertEqual(outer[0].preview_factory_0.controls[0].nested.controls.length, 3);
  assertEqual(outer[1].preview_factory_1.controls[0].nested.controls.length, 3);
});

test('structural control_ids dispatches explicit factory rows without guessing', async () => {
  const source = makeSource('factory-control-ids', 'vanilla', 10, {
    'ui/factory-control-ids.json': {
      namespace: 'factory_control_ids',
      text_row: {
        type: 'panel',
        '$message_text': '#text',
        controls: [{ message: { type: 'label', text: '$message_text' } }],
      },
      image_row: { type: 'image', texture: 'textures/ui/example' },
      screen: {
        type: 'stack_panel',
        factory: {
          name: 'messages_factory',
          max_children_size: 2,
          control_ids: {
            message: 'chat_message@factory_control_ids.text_row',
            image: '@factory_control_ids.image_row',
          },
        },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_control_ids.screen');
  const representativeCollections = {
    messages_factory: {
      count: 3,
      rows: [
        { __jsonui_preview_factory_control_id: 'message', '#text': 'Hello from the factory' },
        { __jsonui_preview_factory_control_id: 'image' },
        { __jsonui_preview_factory_control_id: 'message', '#text': 'Capped row' },
      ],
    },
  };
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections,
  });
  assertEqual(result.ok, true);
  assertEqual(result.stats.materializedFactoryItems, 2);
  assertEqual(result.document.screen.controls.length, 2);
  assertEqual(result.document.screen.controls[0].chat_message.controls[0].message.text, '#text');
  const model = buildUiScreenModelFromJson(result.document, { filePath: 'ui/factory-control-ids.json' });
  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: buildRepresentativeClassicCollectionData(representativeCollections),
  });
  const messageNode = findModelNodeByLocalName(model, 'message');
  assert(messageNode);
  assertEqual(evaluated.propsById[messageNode.id].text, 'Hello from the factory');
  assert(estimateTextIntrinsicSize(evaluated.propsById[messageNode.id]).w > 0);
  assertEqual(result.document.screen.controls[1].image.type, 'image');
  assertEqual(
    result.document.screen.controls[1].image.__jsonui_preview_factory_control_id,
    'image',
  );
  const limit = result.diagnostics.find((item) => item.code === 'UI_FACTORY_MATERIALIZATION_LIMIT');
  assert(limit);
  assertEqual(limit.requested, 3);
  assertEqual(limit.materialized, 2);
  assert(!result.diagnostics.some((item) => item.code === 'UI_FACTORY_CONTROL_ID_UNRESOLVED'));
});

test('explicit user collection rows carry the bounded reserved factory selector into the resolver', async () => {
  const source = makeSource('factory-user-selector', 'imported', 20, {
    'ui/factory-user-selector.json': {
      namespace: 'factory_user_selector',
      a: { type: 'label', text: 'A' },
      b: { type: 'label', text: 'B' },
      screen: {
        type: 'stack_panel',
        collection_name: 'events',
        factory: {
          control_ids: {
            a: '@factory_user_selector.a',
            b: 'chosen@factory_user_selector.b',
          },
        },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_user_selector.screen');
  const collectionData = {
    events: [{ __jsonui_preview_factory_control_id: 'b', '#text': 'kept outside resolver state' }],
  };
  const representativeCollections = buildRepresentativeClassicCollections({
    qualifiedName: selected.qualifiedName,
    collectionData,
  });
  assertEqual(representativeCollections.events.rows[0].__jsonui_preview_factory_control_id, 'b');
  assertEqual(Object.prototype.hasOwnProperty.call(representativeCollections.events.rows[0], '#text'), false);
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections,
  });
  assertEqual(result.ok, true);
  assertEqual(result.document.screen.controls[0].chosen.text, 'B');
  assert(!result.diagnostics.some((item) => item.code === 'UI_FACTORY_CONTROL_ID_UNRESOLVED'));
});

test('exact stock Chat supplies distinct messages_factory rows and concrete rendered text', async () => {
  const source = makeSource('stock-chat-factory', 'vanilla', 10, {
    'ui/chat_screen.json': {
      namespace: 'chat',
      message_tts_wrapper: {
        type: 'panel',
        controls: [{ text: { type: 'label', text: '#text', text_tts: '#text_tts' } }],
      },
      messages_stack_panel: {
        type: 'stack_panel',
        factory: {
          name: 'messages_factory',
          max_children_size: 100,
          control_ids: {
            chat_screen_messages: 'chat_screen_messages@chat.message_tts_wrapper',
          },
        },
      },
      chat_screen: {
        type: 'screen',
        controls: [{ 'messages@chat.messages_stack_panel': {} }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'chat.chat_screen');
  const representativeCollections = buildRepresentativeClassicCollections({
    qualifiedName: selected.qualifiedName,
  });
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections,
  });
  assertEqual(result.ok, true);
  assertEqual(result.stats.materializedFactoryItems, 2);
  assertEqual(
    result.document.chat_screen.controls[0].messages.controls[0]
      .chat_screen_messages.controls[0].text.text,
    '#text',
  );

  const model = buildUiScreenModelFromJson(result.document, { filePath: 'ui/chat_screen.json' });
  const evaluated = evaluateBindingsForUiModel(model, {
    mockData: buildRepresentativeClassicBindingMockData({ qualifiedName: selected.qualifiedName }),
    collectionData: buildRepresentativeClassicCollectionData(representativeCollections),
  });
  const textNodes = findAllModelNodesByLocalName(model, 'text');
  assertEqual(textNodes.length, 2);
  assertDeepEqual(
    textNodes.map((node) => evaluated.propsById[node.id].text),
    ['<Alex> Hello!', '<Steve> Welcome!'],
  );
  assertDeepEqual(
    textNodes.map((node) => evaluated.propsById[node.id].text_tts),
    ['Alex says hello', 'Steve says welcome'],
  );
  for (const node of textNodes) {
    assert(estimateTextIntrinsicSize(evaluated.propsById[node.id]).w > 0);
  }
});

test('duplicate factory instance names keep unique model nodes and isolated row scopes', async () => {
  const source = makeSource('duplicate-factory-instances', 'vanilla', 10, {
    'ui/duplicate-factory-instances.json': {
      namespace: 'duplicate_factory',
      row: {
        type: 'panel',
        controls: [{ message_text: { type: 'label', text: '#text' } }],
      },
      screen: {
        type: 'stack_panel',
        factory: {
          name: 'messages_factory',
          control_ids: { message: 'same_instance@duplicate_factory.row' },
        },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'duplicate_factory.screen');
  const representativeCollections = {
    messages_factory: {
      count: 2,
      rows: [{ '#text': 'First row' }, { '#text': 'Second row' }],
    },
  };
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections,
  });
  assertEqual(result.document.screen.controls[0].same_instance.collection_index, 0);
  assertEqual(result.document.screen.controls[1].same_instance.collection_index, 1);

  const model = buildUiScreenModelFromJson(result.document, {
    filePath: 'ui/duplicate-factory-instances.json',
  });
  const messageNodes = findAllModelNodesByLocalName(model, 'message_text');
  assertEqual(messageNodes.length, 2);
  assert(messageNodes[0].id !== messageNodes[1].id);
  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: buildRepresentativeClassicCollectionData(representativeCollections),
  });
  assertDeepEqual(
    messageNodes.map((node) => evaluated.propsById[node.id].text),
    ['First row', 'Second row'],
  );
});

test('factory row scope resolves direct tokens and bindings but stops at nested collection markers', () => {
  const json = {
    namespace: 'factory_scope',
    screen: {
      type: 'screen',
      controls: [{ outer_row: {
        type: 'panel',
        collection_index: 0,
        __jsonui_preview_collection_name: 'outer_factory',
        controls: [
          { outer_direct: {
            type: 'label',
            '$row_text': '#text',
            text: '$row_text',
            collection_name: '#enchant_buttons',
            grid_item_template: '#row_template_must_stay_literal',
            size: ['#width', 10],
            offset: [0, '#offset_y'],
            font_scale_factor: '$font_scale',
            custom_data: { tint: '#tint' },
          } },
          { outer_bound: {
            type: 'label',
            text: '',
            bindings: [{ binding_name: '#bound_text', binding_name_override: '#text' }],
          } },
          { outer_expression: {
            type: 'label',
            visible: false,
            bindings: [{ binding_name: '(#flag = true)', binding_name_override: '#visible' }],
          } },
          { outer_property_expression: {
            type: 'label',
            // Arbitrary property strings are not binding expressions. Keep
            // this authored rather than guessing a runtime-only evaluation.
            visible: '(#flag)',
          } },
          { inner_row: {
            type: 'panel',
            collection_index: 0,
            __jsonui_preview_collection_name: 'inner_factory',
            controls: [{ inner_direct: { type: 'label', text: '#text' } }],
          } },
          { nested_collection: {
            type: 'stack_panel',
            collection_name: 'not_materialized',
            controls: [{ nested_direct: { type: 'label', text: '#text' } }],
          } },
        ],
      } }],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/factory-scope.json' });
  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: {
      outer_factory: [{
        '#text': 'Outer text',
        '#bound_text': 'Outer binding',
        '#width': 77,
        '#offset_y': 8,
        '$font_scale': 1.25,
        '#tint': 'blue',
        '#flag': true,
        '#enchant_buttons': 'attacker-chosen-collection',
        '#row_template_must_stay_literal': 'attacker-chosen-template',
      }],
      inner_factory: [{ '#text': 'Inner text', '#bound_text': 'Inner binding' }],
    },
  });
  const outerDirect = findModelNodeByLocalName(model, 'outer_direct');
  const outerBound = findModelNodeByLocalName(model, 'outer_bound');
  const outerExpression = findModelNodeByLocalName(model, 'outer_expression');
  const outerPropertyExpression = findModelNodeByLocalName(model, 'outer_property_expression');
  const innerDirect = findModelNodeByLocalName(model, 'inner_direct');
  const nestedDirect = findModelNodeByLocalName(model, 'nested_direct');
  assertEqual(evaluated.propsById[outerDirect.id].text, 'Outer text');
  assertEqual(evaluated.propsById[outerDirect.id].collection_name, '#enchant_buttons');
  assertEqual(evaluated.propsById[outerDirect.id].grid_item_template, '#row_template_must_stay_literal');
  assertDeepEqual(evaluated.propsById[outerDirect.id].size, [77, 10]);
  assertDeepEqual(evaluated.propsById[outerDirect.id].offset, [0, 8]);
  assertEqual(evaluated.propsById[outerDirect.id].font_scale_factor, 1.25);
  assertEqual(evaluated.propsById[outerDirect.id].custom_data.tint, 'blue');
  assertEqual(evaluated.propsById[outerBound.id].text, 'Outer binding');
  assertEqual(evaluated.propsById[outerExpression.id].visible, true);
  // The authored expression is preserved, but the effective visibility is
  // deliberately unknown: a collection row must not be borrowed to evaluate
  // an arbitrary property expression. This sentinel was already emitted by
  // the r41 evaluator; the old expectation predated its implicit-gate pass.
  assertEqual(outerPropertyExpression.unknownProps.visible, '(#flag)');
  assertEqual(evaluated.propsById[outerPropertyExpression.id].visible, '#__jsonui_unresolved_runtime_visibility__');
  assert(evaluated.diagnostics.some(row => row.nodeId === outerPropertyExpression.id
    && row.targetProperty === 'visible' && row.status === 'unresolved'
    && row.reason === 'PROPERTY_UNRESOLVED'));
  assertEqual(evaluated.propsById[innerDirect.id].text, 'Inner text');
  assertEqual(evaluated.propsById[nestedDirect.id].text, '#text');

  const custom = buildUiScreenModelFromJson({
    namespace: 'custom',
    screen: { type: 'screen', controls: [{ plain: { type: 'label', text: '#text' } }] },
  }, { filePath: 'ui/custom-no-factory-scope.json' });
  const customEvaluated = evaluateBindingsForUiModel(custom, {
    collectionData: { outer_factory: [{ '#text': 'Must not leak' }] },
  });
  const plain = findModelNodeByLocalName(custom, 'plain');
  assertEqual(Object.prototype.hasOwnProperty.call(customEvaluated.propsById[plain.id], '#text'), false);
});

test('runtime and property-bag collection boundaries block outer factory row leakage', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'runtime_collection_boundary',
    screen: {
      type: 'screen',
      controls: [{ generated: {
        type: 'panel',
        collection_index: 0,
        __jsonui_preview_collection_name: 'outer_rows',
        controls: [
          { runtime_boundary: {
            type: 'stack_panel',
            bindings: [{
              binding_name: '#inner_collection',
              binding_name_override: '#collection_name',
            }],
            controls: [{ runtime_child: { type: 'label', text: '#text' } }],
          } },
          { property_bag_boundary: {
            type: 'stack_panel',
            property_bag: { '#collection_name': 'inner_rows' },
            controls: [{ property_bag_child: { type: 'label', text: '#text' } }],
          } },
        ],
      } }],
    },
  }, { filePath: 'ui/runtime-collection-boundary.json' });
  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: {
      outer_rows: [{ '#inner_collection': 'inner_rows', '#text': 'OUTER MUST NOT LEAK' }],
      inner_rows: [{ '#text': 'INNER MUST NOT BE GUESSED' }],
    },
  });
  const runtimeBoundary = findModelNodeByLocalName(model, 'runtime_boundary');
  const runtimeChild = findModelNodeByLocalName(model, 'runtime_child');
  const propertyBagChild = findModelNodeByLocalName(model, 'property_bag_child');
  assertEqual(evaluated.propsById[runtimeBoundary.id].collection_name, 'inner_rows');
  assertEqual(evaluated.propsById[runtimeChild.id].text, '#text');
  assertEqual(evaluated.propsById[propertyBagChild.id].text, '#text');
});

test('authored collection grids map explicit cell positions to isolated row scopes', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'authored_collection_grid',
    screen: {
      type: 'screen',
      controls: [{ book_grid: {
        type: 'grid',
        grid_dimensions: [2, 1],
        collection_name: 'book_pages',
        controls: [
          { left_page: {
            type: 'panel',
            grid_position: [0, 0],
            controls: [{ page_number: { type: 'label', text: '#page_number' } }],
          } },
          { right_page: {
            type: 'panel',
            grid_position: [1, 0],
            controls: [{ page_number: { type: 'label', text: '#page_number' } }],
          } },
        ],
      } }],
    },
  }, { filePath: 'ui/authored-collection-grid.json' });
  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: {
      book_pages: [
        { '#page_number': '1 / 2' },
        { '#page_number': '2 / 2' },
      ],
    },
  });
  const pageNumbers = findAllModelNodesByLocalName(model, 'page_number');
  assertEqual(pageNumbers.length, 2);
  assertDeepEqual(
    pageNumbers.map((node) => evaluated.propsById[node.id].text),
    ['1 / 2', '2 / 2'],
  );

  const malformedBoundary = buildUiScreenModelFromJson({
    namespace: 'malformed_collection_boundary',
    screen: {
      type: 'screen',
      controls: [{ generated: {
        type: 'panel',
        collection_index: 0,
        __jsonui_preview_collection_name: 'outer_rows',
        controls: [{ malformed: {
          type: 'grid',
          collection_name: { unexpected: true },
          controls: [{ child: { type: 'label', text: '#text' } }],
        } }],
      } }],
    },
  }, { filePath: 'ui/malformed-collection-boundary.json' });
  const malformedEvaluated = evaluateBindingsForUiModel(malformedBoundary, {
    collectionData: { outer_rows: [{ '#text': 'must not leak' }] },
  });
  const child = findModelNodeByLocalName(malformedBoundary, 'child');
  assertEqual(malformedEvaluated.propsById[child.id].text, '#text');
});

test('authored collection grids derive row scopes from bounded dimension bindings', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'bound_authored_collection_grid',
    screen: {
      type: 'screen',
      controls: [{ book_grid: {
        type: 'grid',
        collection_name: 'book_pages',
        grid_dimension_binding: '#page_grid_dimensions',
        controls: [
          { left_page: { type: 'label', grid_position: [0, 0], text: '#page_number' } },
          { right_page: { type: 'label', grid_position: [1, 0], text: '#page_number' } },
        ],
      } }],
    },
  }, { filePath: 'ui/bound-authored-collection-grid.json' });
  const evaluated = evaluateBindingsForUiModel(model, {
    mockData: {
      '#page_grid_dimensions': '#resolved_page_grid_dimensions',
      '#resolved_page_grid_dimensions': [2, 1],
    },
    collectionData: {
      book_pages: [
        { '#page_number': '1 / 2' },
        { '#page_number': '2 / 2' },
      ],
    },
  });
  const pages = [
    findModelNodeByLocalName(model, 'left_page'),
    findModelNodeByLocalName(model, 'right_page'),
  ];
  assertDeepEqual(
    pages.map((node) => evaluated.propsById[node.id].text),
    ['1 / 2', '2 / 2'],
  );
});

test('factory row scope ignores inherited and accessor data without enumerating oversized rows', () => {
  const json = {
    namespace: 'factory_scope_guard',
    screen: {
      type: 'screen',
      controls: [{ generated: {
        type: 'panel',
        collection_index: 0,
        __jsonui_preview_collection_name: 'guarded_factory',
        controls: [
          { text: { type: 'label', text: '#text' } },
          { bound: {
            type: 'label',
            text: 'authored',
            bindings: [{ binding_name: '#text', binding_name_override: '#text' }],
          } },
        ],
      } }],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/factory-scope-guard.json' });
  let accessorReads = 0;
  const row = Object.create({ '#text': 'Inherited text must not resolve' });
  for (let index = 0; index < 2048; index += 1) {
    Object.defineProperty(row, `#unused_${index}`, {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'unused';
      },
    });
  }
  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: { guarded_factory: [row] },
  });
  const text = findModelNodeByLocalName(model, 'text');
  assertEqual(Object.prototype.hasOwnProperty.call(evaluated.propsById[text.id], '#text'), false);
  assertEqual(evaluated.propsById[text.id].text, '#text');
  assertEqual(accessorReads, 0);
  assertEqual(Object.prototype.polluted, undefined);

  const throwingRow = new Proxy({ '#text': 'row text' }, {
    getOwnPropertyDescriptor() {
      throw new Error('descriptor denied');
    },
  });
  const hostile = evaluateBindingsForUiModel(model, {
    collectionData: { guarded_factory: [throwingRow] },
    mockData: { '#text': 'global text must not leak' },
  });
  const bound = findModelNodeByLocalName(model, 'bound');
  assertEqual(hostile.propsById[text.id].text, '#text');
  assertEqual(hostile.propsById[bound.id].text, 'authored');
});

test('factory row expressions project only referenced own data and follow bounded aliases', () => {
  const controls = Array.from({ length: 100 }, (_, index) => ({
    [`value_${index}`]: {
      type: 'label',
      bindings: [{
        binding_name: '((#left + #right_alias) * $scale_alias)',
        binding_name_override: '#font_scale_factor',
      }],
    },
  }));
  const model = buildUiScreenModelFromJson({
    namespace: 'factory_expression_scope',
    screen: {
      type: 'screen',
      controls: [{ generated: {
        type: 'panel',
        collection_index: 0,
        __jsonui_preview_collection_name: 'expression_factory',
        controls: [...controls, { nested_collection_expression: {
          type: 'label',
          bindings: [{
            binding_type: 'collection',
            binding_collection_name: 'inner_expression_rows',
            binding_name: '(#left + #right)',
            binding_name_override: '#font_scale_factor',
          }],
        } }],
      } }],
    },
  }, { filePath: 'ui/factory-expression-scope.json' });

  const rowTarget = {
    '#left': 3,
    '#right_alias': '#right',
    '#right': 4,
    '$scale_alias': '$scale',
    '$scale': 2,
  };
  for (let index = 0; index < 500; index += 1) rowTarget[`#unused_${index}`] = index;
  let ownKeysCalls = 0;
  const row = new Proxy(rowTarget, {
    ownKeys(target) {
      ownKeysCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  const innerRowTarget = { '#left': 10, '#right': 20 };
  for (let index = 0; index < 500; index += 1) innerRowTarget[`#unused_${index}`] = index;
  let innerOwnKeysCalls = 0;
  const innerRow = new Proxy(innerRowTarget, {
    ownKeys(target) {
      innerOwnKeysCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: {
      expression_factory: [row],
      inner_expression_rows: [innerRow],
    },
  });
  for (let index = 0; index < 100; index += 1) {
    const node = findModelNodeByLocalName(model, `value_${index}`);
    assertEqual(evaluated.propsById[node.id].font_scale_factor, 14);
  }
  const nestedCollectionExpression = findModelNodeByLocalName(model, 'nested_collection_expression');
  assertEqual(evaluated.propsById[nestedCollectionExpression.id].font_scale_factor, 30);
  assertEqual(ownKeysCalls, 0);
  assertEqual(innerOwnKeysCalls, 0);
  assert(!evaluated.warnings.some((warning) => warning.startsWith('FACTORY_ROW_EXPRESSION_REF_LIMIT')));

  const collectionExpression = buildUiScreenModelFromJson({
    namespace: 'collection_expression_projection',
    label: {
      type: 'label',
      ready: false,
      collection_index: 0,
      bindings: [{
        binding_type: 'collection',
        binding_collection_name: 'expression_rows',
        binding_name: '(#ready)',
        binding_name_override: '#visible',
      }],
    },
  }, { filePath: 'ui/collection-expression-projection.json' });
  const collectionRowTarget = { '#ready': true };
  for (let index = 0; index < 500; index += 1) collectionRowTarget[`#unused_${index}`] = index;
  let collectionOwnKeysCalls = 0;
  const collectionRow = new Proxy(collectionRowTarget, {
    ownKeys(target) {
      collectionOwnKeysCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  const collectionEvaluated = evaluateBindingsForUiModel(collectionExpression, {
    collectionData: { expression_rows: [collectionRow] },
  });
  const collectionLabel = findModelNodeByLocalName(collectionExpression, 'label');
  assertEqual(collectionEvaluated.propsById[collectionLabel.id].visible, true);
  assertEqual(collectionOwnKeysCalls, 0);
});

test('factory expressions use row-first hash and lexical-first dollar precedence', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'factory_expression_precedence',
    screen: {
      type: 'screen',
      controls: [{ generated: {
        type: 'panel',
        collection_index: 0,
        __jsonui_preview_collection_name: 'precedence_rows',
        '$local': 2,
        '$alias': '#flag',
        controls: [
          { row_hash: {
            type: 'panel', flag: false, visible: false,
            bindings: [{ binding_name: '(#flag = true)', binding_name_override: '#visible' }],
          } },
          { lexical_dollar: {
            type: 'panel', visible: false,
            bindings: [{ binding_name: '($local = 2)', binding_name_override: '#visible' }],
          } },
          { lexical_alias_to_row: {
            type: 'panel', visible: false,
            bindings: [{ binding_name: '($alias = true)', binding_name_override: '#visible' }],
          } },
          { incomplete_row_alias: {
            type: 'panel', visible: true,
            bindings: [{ binding_name: '(#incomplete = true)', binding_name_override: '#visible' }],
          } },
        ],
      } }],
    },
  }, { filePath: 'ui/factory-expression-precedence.json' });
  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: {
      precedence_rows: [{
        '#flag': true,
        '#incomplete': '#global_only',
        '$local': 99,
        '$alias': false,
      }],
    },
    mockData: { '#global_only': true },
  });
  for (const localName of ['row_hash', 'lexical_dollar', 'lexical_alias_to_row']) {
    const node = findModelNodeByLocalName(model, localName);
    assertEqual(evaluated.propsById[node.id].visible, true);
  }
  const incomplete = findModelNodeByLocalName(model, 'incomplete_row_alias');
  assert(String(evaluated.propsById[incomplete.id].visible).includes('unresolved_runtime_visibility'));
  assert(!evaluated.warnings.some((warning) => warning.startsWith('FACTORY_ROW_EXPRESSION_REF_LIMIT')));
});

test('view expression aliases cannot bypass disabled mock fallback', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'isolated_view_alias',
    screen: {
      type: 'screen',
      controls: [
        { source: { type: 'panel', flag: '#missing', '$alias': '#missing' } },
        { hash_target: {
          type: 'panel', visible: true,
          bindings: [{
            binding_type: 'view', source_control_name: 'source', resolve_sibling_scope: true,
            source_property_name: '(#flag = true)', target_property_name: '#visible',
          }],
        } },
        { dollar_target: {
          type: 'panel', visible: true,
          bindings: [{
            binding_type: 'view', source_control_name: 'source', resolve_sibling_scope: true,
            source_property_name: '($alias = true)', target_property_name: '#visible',
          }],
        } },
        { undefined_target: {
          type: 'panel', visible: true,
          bindings: [{
            binding_type: 'view', source_control_name: 'source', resolve_sibling_scope: true,
            source_property_name: '(#explicit_undefined = true)', target_property_name: '#visible',
          }],
        } },
      ],
    },
  }, { filePath: 'ui/isolated-view-alias.json' });
  const source = findModelNodeByLocalName(model, 'source');
  Object.defineProperty(source.unknownProps, 'explicit_undefined', {
    value: undefined,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const evaluated = evaluateBindingsForUiModel(model, {
    mockData: { '#missing': true, '#explicit_undefined': true },
  });
  for (const localName of ['hash_target', 'dollar_target', 'undefined_target']) {
    const node = findModelNodeByLocalName(model, localName);
    assert(String(evaluated.propsById[node.id].visible).includes('unresolved_runtime_visibility'));
  }
});

test('factory row expression reference limits fail closed instead of using global fallbacks', () => {
  const references = Array.from({ length: 257 }, (_, index) => `#value_${index}`);
  const expressionGroups = [];
  for (let index = 0; index < references.length; index += 64) {
    expressionGroups.push(`(${references.slice(index, index + 64).join(' + ')})`);
  }
  const expression = `(${expressionGroups.join(' + ')})`;
  const model = buildUiScreenModelFromJson({
    namespace: 'factory_expression_limit',
    screen: {
      type: 'screen',
      controls: [{ generated: {
        type: 'panel',
        collection_index: 0,
        __jsonui_preview_collection_name: 'limited_factory',
        controls: [{ value: {
          type: 'label',
          font_scale_factor: 1,
          bindings: [{ binding_name: expression, binding_name_override: '#font_scale_factor' }],
        } }],
      } }],
    },
  }, { filePath: 'ui/factory-expression-limit.json' });
  const row = Object.fromEntries(references.map((reference, index) => [reference, index === 256 ? 1 : 0]));
  const mockData = Object.fromEntries(references.map((reference, index) => [reference, index === 256 ? 999 : 0]));
  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: { limited_factory: [row] },
    mockData,
  });
  const value = findModelNodeByLocalName(model, 'value');
  assertEqual(evaluated.propsById[value.id].font_scale_factor, 1);
  assertEqual(
    evaluated.warnings.filter((warning) => warning.startsWith('FACTORY_ROW_EXPRESSION_REF_LIMIT')).length,
    1,
  );
});

test('factory row nested token scanning fails closed for cycles accessors and limits', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'factory_nested_scope_guard',
    screen: {
      type: 'screen',
      controls: [{ generated: {
        type: 'panel',
        collection_index: 0,
        __jsonui_preview_collection_name: 'nested_guard_factory',
        controls: [{ guarded: {
          type: 'label',
          custom_data: { ordinary: '#text' },
        } }],
      } }],
    },
  }, { filePath: 'ui/factory-nested-scope-guard.json' });
  const guarded = findModelNodeByLocalName(model, 'guarded');
  const cycle = Object.create(null);
  cycle.self = cycle;
  let accessorReads = 0;
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'secret', {
    enumerable: true,
    get() {
      accessorReads += 1;
      return '#text';
    },
  });
  guarded.unknownProps.cycle = cycle;
  guarded.unknownProps.accessor = accessor;
  const prototypeNamedArray = ['#text'];
  Object.defineProperty(prototypeNamedArray, '__proto__', {
    value: '#text',
    enumerable: true,
    configurable: true,
    writable: true,
  });
  guarded.unknownProps.prototype_named_array = prototypeNamedArray;
  guarded.unknownProps.over_limit = Array.from({ length: 2050 }, () => '#text');

  const evaluated = evaluateBindingsForUiModel(model, {
    collectionData: { nested_guard_factory: [{ '#text': 'resolved' }] },
  });
  const props = evaluated.propsById[guarded.id];
  assertEqual(props.custom_data.ordinary, 'resolved');
  assertEqual(props.cycle, cycle);
  assertEqual(props.accessor, accessor);
  assertEqual(Object.getPrototypeOf(props.prototype_named_array), Array.prototype);
  assertEqual(props.prototype_named_array[0], 'resolved');
  assertEqual(
    Object.getOwnPropertyDescriptor(props.prototype_named_array, '__proto__').value,
    'resolved',
  );
  assertEqual(props.over_limit[0], '#text');
  assertEqual(accessorReads, 0);
  assertEqual(
    evaluated.warnings.filter((warning) => warning.startsWith('FACTORY_ROW_TOKEN_SCAN_LIMIT')).length,
    1,
  );
  assertEqual(Object.prototype.polluted, undefined);
});

test('factory row token aliases commit only after complete bounded resolution', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'factory_alias_transaction',
    screen: {
      type: 'screen',
      controls: [{ generated: {
        type: 'panel',
        collection_index: 0,
        __jsonui_preview_collection_name: 'transaction_rows',
        controls: [
          { missing_alias: { type: 'label', text: '#head' } },
          { long_alias: { type: 'label', text: '#alias_0' } },
          { cyclic_alias: { type: 'label', text: '#cycle' } },
          { accessor_alias: { type: 'label', text: '#accessor' } },
          { resolved_value: { type: 'label', font_scale_factor: '#scale' } },
        ],
      } }],
    },
  }, { filePath: 'ui/factory-alias-transaction.json' });
  let accessorReads = 0;
  const row = {
    '#head': '#missing',
    '#cycle': '#cycle',
    '#scale': 1.5,
  };
  for (let index = 0; index < 9; index += 1) {
    row[`#alias_${index}`] = `#alias_${index + 1}`;
  }
  row['#alias_9'] = 'terminal';
  Object.defineProperty(row, '#accessor', {
    enumerable: true,
    get() {
      accessorReads += 1;
      return 'must not execute';
    },
  });
  const evaluated = evaluateBindingsForUiModel(model, {
    mockData: { '#missing': 'GLOBAL MUST NOT COMPLETE THE ROW ALIAS' },
    collectionData: { transaction_rows: [row] },
  });
  const prop = (localName, property) => {
    const node = findModelNodeByLocalName(model, localName);
    return evaluated.propsById[node.id][property];
  };
  assertEqual(prop('missing_alias', 'text'), '#head');
  assertEqual(prop('long_alias', 'text'), '#alias_0');
  assertEqual(prop('cyclic_alias', 'text'), '#cycle');
  assertEqual(prop('accessor_alias', 'text'), '#accessor');
  assertEqual(prop('resolved_value', 'font_scale_factor'), 1.5);
  assertEqual(accessorReads, 0);
  assertEqual(
    evaluated.warnings.filter((warning) => warning.startsWith('FACTORY_ROW_TOKEN_SCAN_LIMIT')).length,
    1,
  );
  assertEqual(
    evaluated.warnings.filter((warning) => (
      warning.startsWith('FACTORY_ROW_TOKEN_RESOLUTION_INCOMPLETE')
    )).length,
    1,
  );
});

test('structural control_ids requires an explicit unambiguous scenario and keeps standalone factories runtime-only', async () => {
  const source = makeSource('factory-control-id-guards', 'vanilla', 10, {
    'ui/factory-control-id-guards.json': {
      namespace: 'factory_control_id_guards',
      a: { type: 'label', text: 'A' },
      b: { type: 'label', text: 'B' },
      ambiguous: {
        type: 'stack_panel',
        factory: {
          name: 'ambiguous_factory',
          control_ids: {
            a: '@factory_control_id_guards.a',
            b: '@factory_control_id_guards.b',
          },
        },
      },
      sole: {
        type: 'stack_panel',
        factory: {
          name: 'sole_factory',
          control_ids: { only: '@factory_control_id_guards.a' },
        },
      },
      named_collection: {
        type: 'stack_panel',
        collection_name: 'authored_rows',
        factory: {
          name: 'fallback_must_not_apply',
          control_ids: { only: '@factory_control_id_guards.a' },
        },
      },
      unknown_selector: {
        type: 'stack_panel',
        factory: {
          name: 'unknown_selector_factory',
          control_ids: {
            a: '@factory_control_id_guards.a',
            b: '@factory_control_id_guards.b',
          },
        },
      },
      invalid_selector: {
        type: 'stack_panel',
        factory: {
          name: 'invalid_selector_factory',
          control_ids: {
            a: '@factory_control_id_guards.a',
            b: '@factory_control_id_guards.b',
          },
        },
      },
      dynamic_target: {
        type: 'stack_panel',
        factory: {
          name: 'dynamic_target_factory',
          control_ids: { only: '$runtime_template' },
        },
      },
      unsafe_target_local: {
        type: 'stack_panel',
        factory: {
          name: 'unsafe_target_local_factory',
          control_ids: { only: '$runtime_instance@factory_control_id_guards.a' },
        },
      },
      unsafe_control_name_local: {
        type: 'stack_panel',
        factory: {
          name: 'unsafe_control_name_factory',
          control_name: '$runtime_instance@factory_control_id_guards.a',
        },
      },
      unresolved_collection_name: {
        type: 'stack_panel',
        collection_name: '$runtime_rows',
        factory: {
          name: 'must_not_fallback',
          control_name: 'row@factory_control_id_guards.a',
        },
      },
      hash_collection_name: {
        type: 'stack_panel',
        collection_name: '#literal_rows',
        factory: {
          control_name: 'row@factory_control_id_guards.a',
        },
      },
      zero_limit: {
        type: 'stack_panel',
        factory: {
          name: 'zero_limit_factory',
          max_children_size: 0,
          control_name: 'row@factory_control_id_guards.a',
        },
      },
      syntax_control_id: {
        type: 'stack_panel',
        factory: {
          name: 'syntax_control_id_factory',
          control_ids: { 'branch@syntax': '@factory_control_id_guards.b' },
        },
      },
      standalone: {
        type: 'factory',
        factory: { name: 'standalone_factory' },
        control_ids: { only: '@factory_control_id_guards.a' },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const resolve = (localName, representativeCollections) => resolveEffectiveUi({
    catalog,
    recordId: catalog.records.find((record) => (
      record.qualifiedName === `factory_control_id_guards.${localName}`
    )).id,
    representativeCollections,
  });

  const ambiguous = resolve('ambiguous', {
    // This is an ordinary game-data key, not permission to choose a factory
    // branch. Only the preview's reserved selector may do that.
    ambiguous_factory: { count: 2, rowTemplate: { '#control_id': 'a' } },
  });
  assertEqual(Object.prototype.hasOwnProperty.call(ambiguous.document.ambiguous, 'controls'), false);
  const selectorWarning = ambiguous.diagnostics.find((item) => (
    item.code === 'UI_FACTORY_CONTROL_ID_UNRESOLVED' && item.reason === 'SELECTOR_REQUIRED'
  ));
  assert(selectorWarning);
  assertEqual(selectorWarning.occurrences, 2);

  const sole = resolve('sole', { sole_factory: { count: 1, rowTemplate: {} } });
  assertEqual(sole.document.sole.controls[0].only.text, 'A');

  const noScenario = resolve('sole', {});
  assertEqual(Object.prototype.hasOwnProperty.call(noScenario.document.sole, 'controls'), false);

  const noFactoryFallback = resolve('named_collection', {
    fallback_must_not_apply: { count: 1, rowTemplate: {} },
  });
  assertEqual(
    Object.prototype.hasOwnProperty.call(noFactoryFallback.document.named_collection, 'controls'),
    false,
  );

  const unknownSelector = resolve('unknown_selector', {
    unknown_selector_factory: {
      count: 1,
      rows: [{ __jsonui_preview_factory_control_id: 'missing' }],
    },
  });
  assertEqual(Object.prototype.hasOwnProperty.call(unknownSelector.document.unknown_selector, 'controls'), false);
  assert(unknownSelector.diagnostics.some((item) => (
    item.code === 'UI_FACTORY_CONTROL_ID_UNRESOLVED' && item.reason === 'SELECTOR_NOT_FOUND'
  )));

  const invalidSelectorCollections = buildRepresentativeClassicCollections({
    qualifiedName: 'factory_control_id_guards.invalid_selector',
    collectionData: {
      invalid_selector_factory: [{ __jsonui_preview_factory_control_id: false }],
    },
  });
  const invalidSelector = resolve('invalid_selector', invalidSelectorCollections);
  assertEqual(Object.prototype.hasOwnProperty.call(invalidSelector.document.invalid_selector, 'controls'), false);
  assert(invalidSelector.diagnostics.some((item) => (
    item.code === 'UI_FACTORY_CONTROL_ID_UNRESOLVED' && item.reason === 'SELECTOR_INVALID'
  )));

  const dynamicTarget = resolve('dynamic_target', {
    dynamic_target_factory: { count: 1, rowTemplate: {} },
  });
  assertEqual(Object.prototype.hasOwnProperty.call(dynamicTarget.document.dynamic_target, 'controls'), false);
  assert(dynamicTarget.diagnostics.some((item) => (
    item.code === 'UI_FACTORY_CONTROL_ID_UNRESOLVED' && item.reason === 'TARGET_VARIABLE'
  )));

  const unsafeTargetLocal = resolve('unsafe_target_local', {
    unsafe_target_local_factory: { count: 1, rowTemplate: {} },
  });
  assertEqual(unsafeTargetLocal.document.unsafe_target_local.controls[0].only.text, 'A');
  assert(unsafeTargetLocal.diagnostics.some((item) => (
    item.code === 'UI_FACTORY_CONTROL_ID_UNRESOLVED'
      && item.reason === 'TARGET_LOCAL_NAME_INVALID_FALLBACK'
  )));

  const unsafeControlName = resolve('unsafe_control_name_local', {
    unsafe_control_name_factory: { count: 1, rowTemplate: {} },
  });
  assertEqual(unsafeControlName.document.unsafe_control_name_local.controls[0].preview_factory_0.text, 'A');
  assert(unsafeControlName.diagnostics.some((item) => (
    item.code === 'UI_FACTORY_CONTROL_ID_UNRESOLVED'
      && item.reason === 'CONTROL_NAME_LOCAL_NAME_INVALID_FALLBACK'
  )));

  const unresolvedCollectionName = resolve('unresolved_collection_name', {
    '$runtime_rows': { count: 1, rowTemplate: {} },
    must_not_fallback: { count: 1, rowTemplate: {} },
  });
  assertEqual(
    Object.prototype.hasOwnProperty.call(
      unresolvedCollectionName.document.unresolved_collection_name,
      'controls',
    ),
    false,
  );

  const hashCollectionName = resolve('hash_collection_name', {
    '#literal_rows': { count: 1, rowTemplate: {} },
  });
  assertEqual(hashCollectionName.document.hash_collection_name.controls[0].row.text, 'A');

  const zeroLimit = resolve('zero_limit', {
    zero_limit_factory: { count: 1, rowTemplate: {} },
  });
  assertDeepEqual(zeroLimit.document.zero_limit.controls, []);
  assertEqual(zeroLimit.document.zero_limit.__jsonui_preview_factory_materialized, true);
  assert(zeroLimit.diagnostics.some((item) => (
    item.code === 'UI_FACTORY_MATERIALIZATION_LIMIT'
      && item.requested === 1
      && item.materialized === 0
  )));

  const syntaxControlId = resolve('syntax_control_id', {
    syntax_control_id_factory: { count: 1, rowTemplate: {} },
  });
  assertEqual(syntaxControlId.document.syntax_control_id.controls[0].preview_factory_0.text, 'B');
  assertEqual(
    Object.prototype.hasOwnProperty.call(
      syntaxControlId.document.syntax_control_id.controls[0],
      'branch@syntax',
    ),
    false,
  );

  const standalone = resolve('standalone', {
    standalone_factory: { count: 1, rowTemplate: {} },
  });
  assertEqual(standalone.stats.materializedFactoryItems, 0);
  assertEqual(Object.prototype.hasOwnProperty.call(standalone.document.standalone, 'controls'), false);
});

test('inherited control_ids retain each mapping property namespace', async () => {
  const base = makeSource('factory-control-id-base', 'vanilla', 10, {
    'ui/base-factory-control-ids.json': {
      namespace: 'factory_base',
      base_x: { type: 'label', text: 'base x' },
      base_y: { type: 'label', text: 'base y' },
      owner: {
        type: 'stack_panel',
        factory: {
          name: 'rows_factory',
          control_ids: {
            x: 'x_instance@base_x',
            y: 'y_instance@base_y',
          },
        },
      },
    },
  });
  const derived = makeSource('factory-control-id-derived', 'imported', 20, {
    'ui/derived-factory-control-ids.json': {
      namespace: 'factory_derived',
      derived_x: { type: 'label', text: 'derived x' },
      'screen@factory_base.owner': {
        factory: {
          control_ids: { x: 'x_instance@derived_x' },
        },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [base, derived], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_derived.screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections: {
      rows_factory: {
        count: 2,
        rows: [
          { __jsonui_preview_factory_control_id: 'x' },
          { __jsonui_preview_factory_control_id: 'y' },
        ],
      },
    },
  });
  assertEqual(result.ok, true);
  assertEqual(result.document.screen.controls[0].x_instance.text, 'derived x');
  assertEqual(result.document.screen.controls[1].y_instance.text, 'base y');
});

test('control_ids template cycles are blocked within shared materialization budgets', async () => {
  const source = makeSource('factory-control-id-cycle', 'vanilla', 10, {
    'ui/factory-control-id-cycle.json': {
      namespace: 'factory_cycle',
      recursive_row: {
        type: 'stack_panel',
        factory: {
          name: 'recursive_factory',
          control_ids: { recurse: 'again@factory_cycle.recursive_row' },
        },
      },
      screen: {
        type: 'stack_panel',
        factory: {
          name: 'recursive_factory',
          control_ids: { recurse: 'again@factory_cycle.recursive_row' },
        },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_cycle.screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections: {
      recursive_factory: { count: 2, rowTemplate: {} },
    },
    limits: {
      maxMaterializedCollectionItemsTotal: 4,
      maxMaterializedObjects: 32,
    },
  });
  assertEqual(result.ok, true);
  assertEqual(result.stats.materializedFactoryItems, 2);
  assert(result.stats.materializedObjects <= 32);
  const cycle = result.diagnostics.find((item) => item.code === 'UI_FACTORY_TEMPLATE_CYCLE');
  assert(cycle);
  assertEqual(cycle.occurrences, 2);
  assertEqual(result.document.screen.controls.length, 2);
  assertEqual(Object.prototype.hasOwnProperty.call(result.document.screen.controls[0].again, 'controls'), false);
});

test('a factory cannot materialize the selected definition as its own template', async () => {
  const source = makeSource('factory-selected-cycle', 'vanilla', 10, {
    'ui/factory-selected-cycle.json': {
      namespace: 'factory_selected_cycle',
      screen: {
        type: 'stack_panel',
        factory: {
          name: 'self_factory',
          control_name: 'self@factory_selected_cycle.screen',
        },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_selected_cycle.screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections: { self_factory: { count: 1, rowTemplate: {} } },
  });
  assertEqual(result.ok, true);
  assertEqual(result.stats.materializedFactoryItems, 0);
  assertEqual(Object.prototype.hasOwnProperty.call(result.document.screen, 'controls'), false);
  const cycles = result.diagnostics.filter((item) => item.code === 'UI_FACTORY_TEMPLATE_CYCLE');
  assertEqual(cycles.length, 1);
  assertEqual(cycles[0].occurrences, 1);
  assert(!result.diagnostics.some((item) => item.code === 'UI_FACTORY_TEMPLATE_MATERIALIZED'));
});

test('dynamic or malformed authored controls are never replaced by representative instances', async () => {
  const source = makeSource('dynamic-controls', 'vanilla', 10, {
    'ui/dynamic-controls.json': {
      namespace: 'dynamic_controls',
      row: { type: 'label', text: 'must not be synthesized' },
      factory_screen: {
        type: 'stack_panel', controls: '$runtime_controls', collection_name: 'rows',
        factory: { name: 'rows_factory', control_name: 'dynamic_controls.row' },
      },
      grid_screen: {
        type: 'grid', controls: '$runtime_controls', collection_name: 'rows',
        grid_dimensions: [1, 1], grid_item_template: 'dynamic_controls.row',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  for (const localName of ['factory_screen', 'grid_screen']) {
    const selected = catalog.records.find((record) => record.localName === localName);
    const result = resolveEffectiveUi({
      catalog, recordId: selected.id, representativeCollections: { rows: { count: 1 } },
    });
    assertEqual(result.ok, true);
    assertEqual(result.document[localName].controls, '$runtime_controls');
    assertEqual(result.stats.materializedFactoryItems, 0);
    assertEqual(result.stats.materializedGridItems, 0);
    assert(result.diagnostics.some((item) => (
      item.code === 'UI_VARIABLE_UNRESOLVED' && item.variable === '$runtime_controls'
    )));
  }
});

test('nested factory shared-cap warnings are bounded and aggregated', async () => {
  const source = makeSource('factory', 'vanilla', 10, {
    'ui/factory.json': {
      namespace: 'factory_limit',
      row: {
        type: 'panel',
        controls: [{ nested: {
          type: 'stack_panel', collection_name: 'inner_rows',
          factory: { name: 'nested_factory', control_name: 'factory_limit.leaf' },
        } }],
      },
      leaf: { type: 'label', text: 'leaf' },
      screen: {
        type: 'stack_panel', collection_name: 'outer_rows',
        factory: { name: 'outer_factory', control_name: 'factory_limit.row' },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_limit.screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections: {
      outer_rows: { count: 2 },
      inner_rows: { count: 100 },
    },
    limits: { maxMaterializedCollectionItemsTotal: 3 },
  });
  assertEqual(result.ok, true);
  assertEqual(result.stats.materializedFactoryItems, 3);
  const warnings = result.diagnostics.filter((entry) => entry.code === 'UI_FACTORY_MATERIALIZATION_LIMIT');
  assertEqual(warnings.length, 1);
  assertEqual(warnings[0].occurrences, 2);
  assertEqual(warnings[0].requestedTotal, 200);
  assertEqual(warnings[0].materializedTotal, 1);
});

test('factory and grid template replication share a bounded object budget', async () => {
  const countObjects = (value) => {
    const stack = [value];
    let count = 0;
    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      count += 1;
      for (const child of Object.values(current)) stack.push(child);
    }
    return count;
  };
  const wideControls = Array.from({ length: 8 }, (_, index) => ({
    [`child_${index}`]: { type: 'panel', controls: [{ leaf: { type: 'label', text: String(index) } }] },
  }));
  const source = makeSource('materialization-budget', 'vanilla', 10, {
    'ui/materialization-budget.json': {
      namespace: 'materialization_budget',
      row: { type: 'panel', controls: wideControls },
      slot: { type: 'panel', controls: wideControls },
      factory_screen: {
        type: 'stack_panel', collection_name: 'rows',
        factory: { name: 'row_factory', control_name: 'materialization_budget.row' },
      },
      grid_screen: {
        type: 'grid', collection_name: 'slots', grid_dimensions: [16, 16],
        grid_item_template: 'materialization_budget.slot',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  for (const [qualifiedName, representativeCollections] of [
    ['materialization_budget.factory_screen', { rows: { count: 256 } }],
    ['materialization_budget.grid_screen', { slots: { count: 256 } }],
  ]) {
    const selected = catalog.records.find((record) => record.qualifiedName === qualifiedName);
    const result = resolveEffectiveUi({
      catalog,
      recordId: selected.id,
      representativeCollections,
      limits: { maxMaterializedObjects: 80 },
    });
    assertEqual(result.ok, true);
    assert(result.stats.materializedObjects <= 80);
    assert(result.stats.materializedObjects > 0);
    const localName = qualifiedName.slice(qualifiedName.indexOf('.') + 1);
    assertEqual(countObjects(result.document[localName].controls), result.stats.materializedObjects);
    assert(
      result.stats.materializedFactoryItems < 256 || result.stats.materializedGridItems < 256,
      'Object budget must reduce at least one materialization kind',
    );
    assert(result.diagnostics.some((entry) => /MATERIALIZATION_LIMIT$/u.test(entry.code)));
  }
});

test('factory templates preserve nested property origin and parse local-at-base references', async () => {
  const base = makeSource('base', 'vanilla', 10, {
    'ui/base.json': {
      namespace: 'a',
      row: { type: 'label', text: 'A' },
      owner: {
        type: 'stack_panel', collection_name: 'rows',
        factory: { name: 'base_factory', control_name: 'generated@a.row' },
      },
    },
  });
  const derived = makeSource('derived', 'imported', 20, {
    'ui/derived.json': {
      namespace: 'b',
      row: { type: 'label', text: 'B' },
      'screen@a.owner': { factory: { name: 'derived_factory' } },
    },
  });
  const catalog = await buildUiCatalog({ sources: [base, derived], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'b.screen');
  const result = resolveEffectiveUi({
    catalog, recordId: selected.id, representativeCollections: { rows: { count: 1 } },
  });
  assertEqual(result.ok, true);
  assertEqual(result.document.screen.controls[0].generated.text, 'A');
  assert(!result.diagnostics.some((item) => item.code === 'UI_FACTORY_TEMPLATE_NOT_FOUND'));
});

test('factory materialization requires safe own counts and honors explicit zero', async () => {
  const source = makeSource('factory', 'vanilla', 10, {
    'ui/factory.json': {
      namespace: 'factory_guard',
      row: { type: 'label', text: 'row' },
      screen: {
        type: 'stack_panel', collection_name: '#rows',
        factory: { name: 'rows_factory', control_name: 'factory_guard.row' },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_guard.screen');

  const inherited = Object.create({ '#rows': { count: 1 } });
  const noInherited = resolveEffectiveUi({ catalog, recordId: selected.id, representativeCollections: inherited });
  assertEqual(Object.prototype.hasOwnProperty.call(noInherited.document.screen, 'controls'), false);

  const zero = resolveEffectiveUi({
    catalog, recordId: selected.id, representativeCollections: { '#rows': { count: 0 } },
  });
  assertDeepEqual(zero.document.screen.controls, []);
  assert(!zero.diagnostics.some((item) => item.code === 'UI_FACTORY_TEMPLATE_NOT_FOUND'));

  let getterReads = 0;
  const getterEntry = {};
  Object.defineProperty(getterEntry, 'count', { enumerable: true, get() { getterReads += 1; return 1; } });
  const getter = resolveEffectiveUi({
    catalog, recordId: selected.id, representativeCollections: { '#rows': getterEntry },
  });
  assertEqual(Object.prototype.hasOwnProperty.call(getter.document.screen, 'controls'), false);
  assertEqual(getterReads, 0);
});

test('empty structural factories still validate and classify fixed templates', async () => {
  const source = makeSource('factory-empty-reference', 'imported', 20, {
    'ui/factory-empty-reference.json': {
      namespace: 'factory_empty',
      row: { type: 'label', text: 'row' },
      valid_screen: {
        type: 'stack_panel', collection_name: 'rows',
        factory: { name: 'rows_factory', control_name: 'local@factory_empty.row' },
      },
      missing_screen: {
        type: 'stack_panel', collection_name: 'rows',
        factory: { name: 'rows_factory', control_name: 'factory_empty.absent' },
      },
      dynamic_screen: {
        type: 'stack_panel', collection_name: 'rows',
        factory: { name: 'rows_factory', control_name: '$runtime_template' },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const row = catalog.records.find((record) => record.qualifiedName === 'factory_empty.row');
  assertEqual(row.classification, 'COMPONENT');

  const resolve = (name) => resolveEffectiveUi({
    catalog,
    recordId: catalog.records.find((record) => record.qualifiedName === `factory_empty.${name}`).id,
    representativeCollections: { rows: { count: 0 } },
  });
  const valid = resolve('valid_screen');
  assertDeepEqual(valid.document.valid_screen.controls, []);
  assertEqual(valid.diagnostics.some((entry) => entry.code === 'UI_FACTORY_TEMPLATE_NOT_FOUND'), false);

  const missing = resolve('missing_screen');
  assertEqual(Object.prototype.hasOwnProperty.call(missing.document.missing_screen, 'controls'), false);
  assertEqual(missing.diagnostics.filter((entry) => entry.code === 'UI_FACTORY_TEMPLATE_NOT_FOUND').length, 1);

  const dynamic = resolve('dynamic_screen');
  assertEqual(dynamic.diagnostics.some((entry) => entry.code === 'UI_FACTORY_TEMPLATE_NOT_FOUND'), false);
});

test('factory names and collection names support bounded static expressions', async () => {
  const source = makeSource('factory', 'vanilla', 10, {
    'ui/factory.json': {
      namespace: 'factory_expr',
      row: { type: 'label', text: 'row' },
      screen: {
        type: 'stack_panel', '$prefix': 'rows', collection_name: '($prefix)',
        factory: { name: "($prefix + '_factory')", control_name: 'factory_expr.row' },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_expr.screen');
  const result = resolveEffectiveUi({
    catalog, recordId: selected.id, representativeCollections: { rows: { count: 1 } },
  });
  assertEqual(result.document.screen.controls.length, 1);
  assertEqual(result.document.screen.controls[0].preview_factory_0.text, 'row');
});

test('malformed factory collection expressions never become literal collection names', async () => {
  const source = makeSource('factory', 'vanilla', 10, {
    'ui/factory.json': {
      namespace: 'factory_bad_expr',
      row: { type: 'label', text: 'row' },
      screen: {
        type: 'stack_panel', collection_name: '(rows',
        factory: { name: 'rows_factory', control_name: 'factory_bad_expr.row' },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const selected = catalog.records.find((record) => record.qualifiedName === 'factory_bad_expr.screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: selected.id,
    representativeCollections: {
      '(rows': { count: 1 },
      rows: { count: 1 },
      rows_factory: { count: 1 },
    },
  });
  assertEqual(result.ok, true);
  assertEqual(Object.prototype.hasOwnProperty.call(result.document.screen, 'controls'), false);
  assertEqual(result.stats.materializedFactoryItems, 0);
});

test('collection row data caps rejected entries and preserves safe own empty overrides', () => {
  const representative = Object.create(null);
  const userCollections = Object.create(null);
  let representativeReads = 0;
  let userReads = 0;
  for (let index = 0; index < 512; index += 1) {
    const suffix = String(index).padStart(3, '0');
    Object.defineProperty(representative, `invalid_representative_${suffix}`, {
      enumerable: true,
      get() {
        representativeReads += 1;
        return 'not-a-definition';
      },
    });
    Object.defineProperty(userCollections, `invalid_user_${suffix}`, {
      enumerable: true,
      get() {
        userReads += 1;
        return 'not-row-data';
      },
    });
  }
  Object.defineProperty(representative, 'late_representative', {
    enumerable: true,
    get() {
      representativeReads += 1;
      return { count: 1, rowTemplate: { '#late': true } };
    },
  });
  Object.defineProperty(userCollections, 'late_user', {
    enumerable: true,
    get() {
      userReads += 1;
      return [{ '#late': true }];
    },
  });

  const bounded = buildRepresentativeClassicCollectionData(representative, userCollections);
  assertEqual(representativeReads, 512, 'Rejected representative definitions must consume the budget');
  assertEqual(userReads, 512, 'Rejected user collections must consume the budget');
  assertEqual(Object.prototype.hasOwnProperty.call(bounded, 'late_representative'), false);
  assertEqual(Object.prototype.hasOwnProperty.call(bounded, 'late_user'), false);

  const inheritedRows = [{ '#inherited': true }];
  const protectedUserData = Object.create({ inherited_rows: inheritedRows });
  let protectedReads = 0;
  for (const name of ['__proto__', 'prototype', 'constructor']) {
    Object.defineProperty(protectedUserData, name, {
      enumerable: true,
      get() {
        protectedReads += 1;
        return [{ '#unsafe': true }];
      },
    });
  }
  const emptyPatterns = [];
  const safeRows = [{ '#safe': true }];
  protectedUserData.patterns = emptyPatterns;
  protectedUserData.safe_rows = safeRows;

  const definitions = buildRepresentativeClassicCollections({
    qualifiedName: 'loom.loom_screen',
    collectionData: protectedUserData,
  });
  const rows = buildRepresentativeClassicCollectionData(definitions, protectedUserData);
  assertEqual(protectedReads, 0, 'Protected keys must be rejected before their values are read');
  assertEqual(rows.patterns, emptyPatterns, 'An explicit empty collection must replace representative rows');
  assertEqual(rows.safe_rows, safeRows);
  assertEqual(Object.prototype.hasOwnProperty.call(rows, 'inherited_rows'), false);
  assertEqual(Object.prototype.hasOwnProperty.call(rows, '__proto__'), false);
  assertEqual(Object.prototype.hasOwnProperty.call(rows, 'prototype'), false);
  assertEqual(Object.prototype.hasOwnProperty.call(rows, 'constructor'), false);
  assertEqual(Object.getPrototypeOf(rows), null);
});

test('Cartography representative state selects exactly the empty-map image through normal bindings', () => {
  const modes = [
    ['none', '#is_none_mode'],
    ['clone', '#is_clone_mode'],
    ['rename', '#is_rename_mode'],
    ['basic', '#is_basic_map_mode'],
    ['locator', '#is_locator_map_mode'],
    ['extend', '#is_extend_mode'],
    ['locked', '#is_locked_mode'],
  ];
  const json = {
    namespace: 'cartography',
    screen: {
      type: 'screen',
      controls: modes.map(([name, binding]) => ({
        [name]: {
          type: 'image',
          texture: `textures/ui/${name}`,
          bindings: [{ binding_name: binding, binding_name_override: '#visible' }],
        },
      })),
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/cartography-test.json' });
  const mockData = buildRepresentativeClassicBindingMockData({ qualifiedName: 'cartography.cartography_screen' });
  const evaluated = evaluateBindingsForUiModel(model, { mockData });
  const controls = model.root.children[0].children;
  const visibleNames = controls
    .filter((node) => evaluated.propsById[node.id]?.visible === true)
    .map((node) => node.key.local_name);
  assertDeepEqual(visibleNames, ['none']);
});

test('Beacon bindings read their own collection row instead of a flattened shared value', () => {
  const json = {
    namespace: 'beacon',
    screen: {
      type: 'screen',
      controls: [
        { speed: { type: 'image', bindings: [{ binding_type: 'collection', binding_collection_name: 'speed', binding_name: '#active', binding_name_override: '#visible' }] } },
        { haste: { type: 'image', bindings: [{ binding_type: 'collection', binding_collection_name: 'haste', binding_name: '#active', binding_name_override: '#visible' }] } },
      ],
    },
  };
  const model = buildUiScreenModelFromJson(json, { filePath: 'ui/beacon-test.json' });
  const definitions = buildRepresentativeClassicCollections({ qualifiedName: 'beacon.beacon_screen' });
  const collectionData = buildRepresentativeClassicCollectionData(definitions, {
    speed: [{ '#active': false }],
  });
  const evaluated = evaluateBindingsForUiModel(model, {
    mockData: { '#active': true },
    collectionData,
  });
  const controls = model.root.children[0].children;
  const propsByName = Object.fromEntries(controls.map((node) => [
    node.key.local_name,
    evaluated.propsById[node.id],
  ]));
  assertEqual(propsByName.speed.visible, false);
  assertEqual(propsByName.haste.visible, true);
  assert(!evaluated.warnings.some((warning) => warning.startsWith('COLLECTION_SCOPE_AMBIGUOUS')));
});

test('runtime variable diagnostics use only values available to the selected screen', () => {
  const custom = buildRepresentativeClassicRuntimeVariableNames({
    qualifiedName: 'custom.furnace_screen',
  });
  assert(custom.has('$desktop_screen'));
  assert(!custom.has('$container_title'));
  assert(!custom.has('$food_index'));

  const stock = buildRepresentativeClassicRuntimeVariableNames({
    qualifiedName: 'furnace.furnace_screen',
    userVariables: { '$pack_runtime_value': 3 },
  });
  assert(stock.has('$container_title'));
  assert(stock.has('$localize_title'));
  assert(stock.has('$pack_runtime_value'));
  assert(stock.has('$food_index'));
  assert(stock.has('$recipe_book_layout_index'));

  const chat = buildRepresentativeClassicRuntimeVariableNames({ qualifiedName: 'chat.chat_screen' });
  assert(chat.has('$chat_font_type'));
  assert(chat.has('$chat_font_scale_factor'));
  assert(chat.has('$chat_line_spacing'));
  assert(chat.has('$max_text_edit_length'));
  assert(chat.has('$option_tooltip_area'));
  assert(chat.has('$options_dropdown_toggle_label_text'));
  const book = buildRepresentativeClassicRuntimeVariableNames({ qualifiedName: 'book.book_screen' });
  assert(book.has('$screenshot_file_system'));
  assert(book.has('$screenshot_frame_texture'));

  const customChat = buildRepresentativeClassicRuntimeVariableNames({ qualifiedName: 'custom.chat_screen' });
  const customBook = buildRepresentativeClassicRuntimeVariableNames({ qualifiedName: 'custom.book_screen' });
  for (const name of [
    '$chat_font_type',
    '$chat_font_scale_factor',
    '$chat_line_spacing',
    '$max_text_edit_length',
    '$option_tooltip_area',
    '$options_dropdown_toggle_label_text',
  ]) assert(!customChat.has(name));
  for (const name of ['$screenshot_file_system', '$screenshot_frame_texture']) {
    assert(!customBook.has(name));
  }
});

test('ui catalog lists each top-level definition separately', async () => {
  const catalog = await makeCatalog();
  const file = findCatalogFile(catalog, 'imported', 'ui/custom.json');
  assert(file, 'Expected imported custom file');
  const definitions = listDefinitionsForFile(catalog, file.id);
  assertDeepEqual(definitions.map((item) => item.localName), ['main_screen', 'helper_panel']);
  assertEqual(catalog.summary.definitions, 6);
});

test('ui catalog keeps inherited definitions with the same local name distinct', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/variants.json': {
      namespace: 'variants',
      'same@base_a': { type: 'panel', layer: 1 },
      'same@base_b': { type: 'panel', layer: 2 },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const file = findCatalogFile(catalog, 'imported', 'ui/variants.json');
  const definitions = listDefinitionsForFile(catalog, file.id);
  assertEqual(definitions.length, 2);
  assert(definitions[0].id !== definitions[1].id, 'Raw inherited keys must produce unique record ids');
  assertEqual(Object.keys(catalog.recordsById).length, 2);
});

test('exact local variable wins over its default regardless of member order', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/variables.json': {
      namespace: 'vars',
      real: { type: 'panel', layer: 7 },
      fallback: { type: 'panel', layer: 2 },
      screen: {
        type: 'screen',
        '$target': 'vars.real',
        '$target|default': 'vars.fallback',
        controls: [{ 'content@$target': {} }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const file = findCatalogFile(catalog, 'imported', 'ui/variables.json');
  const screen = listDefinitionsForFile(catalog, file.id).find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: screen.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls[0].content.layer, 7);
});

test('resolver reports only variables that remain unresolved in the final document', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/final-variable-diagnostics.json': {
      namespace: 'final_variable_diagnostics',
      base: { type: 'label', text: '$late_value' },
      'resolved@final_variable_diagnostics.base': { '$late_value': 'resolved later' },
      unresolved: {
        type: 'panel',
        controls: [
          { first: { type: 'label', text: '$actually_missing' } },
          { second: { type: 'label', text: '$actually_missing' } },
        ],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const resolvedRecord = catalog.records.find((item) => item.qualifiedName === 'final_variable_diagnostics.resolved');
  const resolved = resolveEffectiveUi({ catalog, recordId: resolvedRecord.id });
  assertEqual(resolved.ok, true);
  assertEqual(resolved.document.resolved.text, 'resolved later');
  assertEqual(resolved.diagnostics.filter((item) => item.code === 'UI_VARIABLE_UNRESOLVED').length, 0);

  const unresolvedRecord = catalog.records.find((item) => item.qualifiedName === 'final_variable_diagnostics.unresolved');
  const unresolved = resolveEffectiveUi({ catalog, recordId: unresolvedRecord.id });
  const issues = unresolved.diagnostics.filter((item) => item.code === 'UI_VARIABLE_UNRESOLVED');
  assertEqual(issues.length, 1);
  assertEqual(issues[0].variable, '$actually_missing');
  assertEqual(issues[0].occurrences, 2);
  assertEqual(issues[0].examples.length, 2);
});

test('Classic conditional variables override inherited defaults', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/conditional.json': {
      namespace: 'conditional',
      background: {
        type: 'image',
        '$texture|default': 'textures/default',
        texture: '$texture',
      },
      'screen@conditional.background': {
        variables: [
          { requires: '$desktop_screen', '$texture': 'textures/classic' },
          { requires: '$pocket_screen', '$texture': 'textures/pocket' },
        ],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.texture, 'textures/classic');
});

test('conditional variables evaluate balanced compound requirements and reject malformed parentheses', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/conditional-parentheses.json': {
      namespace: 'conditional_parentheses',
      screen: {
        type: 'screen',
        '$positive|default': 'positive-fallback',
        '$negative|default': 'negative-fallback',
        '$compound|default': 'compound-fallback',
        '$quoted|default': 'quoted-fallback',
        '$literal_paren|default': '(',
        '$unbalanced_open|default': 'unbalanced-open-fallback',
        '$unbalanced_close|default': 'unbalanced-close-fallback',
        variables: [
          { requires: ' ( ( $desktop_screen ) ) ', '$positive': 'positive-match' },
          { requires: '(( not   $pocket_screen ))', '$negative': 'negative-match' },
          { requires: '($desktop_screen and (not $pocket_screen))', '$compound': 'compound-match' },
          { requires: '$literal_paren == "("', '$quoted': 'quoted-match' },
          { requires: '(not $pocket_screen', '$unbalanced_open': 'unbalanced-open-match' },
          { requires: 'not $pocket_screen)', '$unbalanced_close': 'unbalanced-close-match' },
        ],
        positive: '$positive',
        negative: '$negative',
        compound: '$compound',
        quoted: '$quoted',
        unbalanced_open: '$unbalanced_open',
        unbalanced_close: '$unbalanced_close',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.positive, 'positive-match');
  assertEqual(result.document.screen.negative, 'negative-match');
  assertEqual(result.document.screen.compound, 'compound-match');
  assertEqual(result.document.screen.quoted, 'quoted-match');
  assertEqual(result.document.screen.unbalanced_open, 'unbalanced-open-fallback');
  assertEqual(result.document.screen.unbalanced_close, 'unbalanced-close-fallback');
});

test('ui catalog gives imported symbols precedence over Vanilla', async () => {
  const catalog = await makeCatalog();
  const symbol = catalog.symbols['common.base_label'];
  assert(symbol, 'Expected common.base_label symbol');
  assert(String(symbol.winnerId).startsWith('imported:'), 'Imported record should win');
  assert(catalog.diagnostics.some((item) => item.code === 'UI_SYMBOL_SHADOWED'));
});

test('catalog lookup is source-exact and effective path list keeps lower fallback symbols', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/beacon_screen.json': {
      namespace: 'beacon',
      icon_template: { type: 'image', texture: 'textures/ui/confirm' },
      panel_template: { type: 'panel', controls: [{ 'icon@beacon.icon_template': {} }] },
      payment_panel: { type: 'panel', vanilla_only_marker: true },
    },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/beacon_screen.json': {
      namespace: 'beacon',
      beacon_panel: { type: 'panel' },
      payment_panel: { type: 'panel', controls: [{ 'confirm_panel@beacon.panel_template': {} }] },
    },
  });
  const catalog = await buildUiCatalog({ sources: [imported, vanilla], parseJsonc: parseJson });
  const importedFile = findCatalogFile(catalog, 'imported', 'ui/beacon_screen.json');
  assert(importedFile, 'Expected exact imported file');
  assertEqual(findCatalogFile(catalog, 'missing-source', 'ui/beacon_screen.json'), null);
  assertDeepEqual(listDefinitionsForFile(catalog, importedFile.id).map((item) => item.localName), ['beacon_panel', 'payment_panel']);

  const effective = listEffectiveDefinitionsForPath(catalog, 'ui/beacon_screen.json');
  assert(effective.some((item) => item.qualifiedName === 'beacon.panel_template' && item.sourceKind === 'vanilla'));
  const payment = effective.find((item) => item.qualifiedName === 'beacon.payment_panel');
  assertEqual(payment.sourceKind, 'imported');
  const result = resolveEffectiveUi({ catalog, recordId: payment.id });
  assert(result.ok, result.error ? result.error.code : 'Expected payment resolver success');
  const confirm = result.document.payment_panel.controls[0].confirm_panel;
  assertEqual(confirm.type, 'panel');
  assertEqual(confirm.controls[0].icon.texture, 'textures/ui/confirm');
  assertEqual(result.document.payment_panel.vanilla_only_marker, undefined);
  assert(!result.diagnostics.some((item) => item.code === 'UI_CONTROL_BASE_NOT_FOUND'));
});

test('effective path list keeps raw-key variants and never substitutes a winner from another path', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/a.json': {
      namespace: 'variants',
      base_a: { type: 'panel' },
      base_b: { type: 'panel' },
      'same@variants.base_a': { marker: 'a' },
      'same@variants.base_b': { marker: 'b' },
    },
    'ui/b.json': {
      namespace: 'variants',
      same: { type: 'screen', marker: 'other-path' },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const listed = listEffectiveDefinitionsForPath(catalog, 'ui/a.json');
  const variants = listed.filter((item) => item.localName === 'same');
  assertEqual(variants.length, 2);
  assert(variants.every((item) => item.filePath === 'ui/a.json'));
  assertDeepEqual(variants.map((item) => item.rawKey).sort(), ['same@variants.base_a', 'same@variants.base_b']);
});

test('global variable precedence is deterministic regardless of caller source order', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/_global_variables.json': { '$accent': 'vanilla', '$base_only': true },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/_global_variables.json': { '$accent': 'imported' },
  });
  const forward = await buildUiCatalog({ sources: [vanilla, imported], parseJsonc: parseJson });
  const reverse = await buildUiCatalog({ sources: [imported, vanilla], parseJsonc: parseJson });
  assertDeepEqual(forward.globalVariables, reverse.globalVariables);
  assertEqual(reverse.globalVariables.$accent, 'imported');
  assertEqual(reverse.globalVariables.$base_only, true);
});

test('catalog honours _ui_defs and ignores unregistered backup files', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/_ui_defs.json': { ui_defs: ['ui/registered.json'] },
    'ui/registered.json': { namespace: 'registry', screen: { type: 'screen', marker: 'registered' } },
    'ui/backup.json': { namespace: 'registry', screen: { type: 'screen', marker: 'backup' } },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  assertEqual(catalog.summary.registeredSources, 1);
  assertEqual(catalog.files.length, 1);
  assertEqual(catalog.files[0].filePath, 'ui/registered.json');
  assertEqual(catalog.recordsById[catalog.symbols['registry.screen'].winnerId].value.marker, 'registered');
  assert(catalog.diagnostics.some((item) => item.code === 'UI_UNREGISTERED_FILES_SKIPPED'));
});

test('stacked _ui_defs union retains a sparse overlay of a Vanilla-registered path', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/_ui_defs.json': { ui_defs: ['ui/hud_screen.json'] },
    'ui/hud_screen.json': { namespace: 'hud', screen: { type: 'screen', marker: 'vanilla' } },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/_ui_defs.json': { ui_defs: ['ui/custom.json'] },
    'ui/custom.json': { namespace: 'custom', screen: { type: 'screen' } },
    'ui/hud_screen.json': { namespace: 'hud', screen: { type: 'screen', marker: 'imported' } },
  });
  const catalog = await buildUiCatalog({ sources: [imported, vanilla], parseJsonc: parseJson });
  const hudFiles = catalog.files.filter((file) => file.filePath === 'ui/hud_screen.json');
  assertEqual(hudFiles.length, 2);
  assertEqual(catalog.recordsById[catalog.symbols['hud.screen'].winnerId].value.marker, 'imported');
});

test('self-qualified overlay inheritance selects the lower Vanilla candidate', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/hud_screen.json': { namespace: 'hud', hud_screen: { type: 'screen', size: [320, 180], layer: 2 } },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/hud_screen.json': { namespace: 'hud', 'hud_screen@hud.hud_screen': { layer: 8 } },
  });
  const catalog = await buildUiCatalog({ sources: [vanilla, imported], parseJsonc: parseJson });
  const selected = catalog.records.find((item) => item.sourceKind === 'imported');
  const result = resolveEffectiveUi({ catalog, recordId: selected.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertDeepEqual(result.document.hud_screen.size, [320, 180]);
  assertEqual(result.document.hud_screen.layer, 8);
  assert(result.provenance.some((item) => item.sourceKind === 'vanilla' && item.qualifiedName === 'hud.hud_screen'));
  assert(!result.diagnostics.some((item) => item.code === 'UI_INHERITANCE_CYCLE'));
});

test('self-qualified inheritance skips every same-precedence duplicate before using Vanilla', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/hud_screen.json': { namespace: 'hud', hud_screen: { type: 'screen', size: [300, 180], vanilla: true } },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/hud_screen.json': {
      namespace: 'hud',
      'hud_screen@hud.hud_screen': { marker: 'first' },
      'hud_screen@hud.hud_screen ': { marker: 'second' },
    },
  });
  const catalog = await buildUiCatalog({ sources: [imported, vanilla], parseJsonc: parseJson });
  const selected = catalog.records.find((item) => item.rawKey === 'hud_screen@hud.hud_screen');
  const result = resolveEffectiveUi({ catalog, recordId: selected.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.hud_screen.vanilla, true);
  assert(result.provenance.some((item) => item.sourceKind === 'vanilla'));
});

test('grid materialization infers one unambiguous inherited template namespace', async () => {
  const base = makeSource('vanilla', 'vanilla', 10, {
    'ui/base_grid.json': {
      namespace: 'basegrid',
      slot: { type: 'image', texture: 'textures/ui/slot' },
      panel: { type: 'grid', grid_dimensions: [2, 1], grid_item_template: 'slot' },
    },
    'ui/other_grid.json': {
      namespace: 'othergrid',
      slot: { type: 'image', texture: 'textures/ui/wrong-slot' },
    },
  });
  const overlay = makeSource('imported', 'imported', 20, {
    'ui/screen.json': {
      namespace: 'screen',
      'screen@basegrid.panel': {},
    },
  });
  const catalog = await buildUiCatalog({ sources: [overlay, base], parseJsonc: parseJson });
  const selected = catalog.records.find((item) => item.sourceKind === 'imported');
  const result = resolveEffectiveUi({ catalog, recordId: selected.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls.length, 2);
  assertEqual(result.document.screen.controls[0].preview_slot_0.texture, 'textures/ui/slot');
  assert(!result.diagnostics.some((item) => item.code === 'UI_GRID_TEMPLATE_NAMESPACE_AMBIGUOUS'));
});

test('collection-backed grids materialize a variable-backed lower Vanilla slot template', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/inventory_screen.json': {
      namespace: 'crafting',
      slot: {
        type: 'image',
        '$slot_texture|default': 'textures/ui/confirm',
        texture: '$slot_texture',
      },
      inventory_panel: {
        type: 'grid',
        grid_dimensions: [3, 2],
        '$grid_item_template|default': 'crafting.slot',
        grid_item_template: '$grid_item_template',
        collection_name: 'inventory_items',
      },
    },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/inventory_screen.json': {
      namespace: 'crafting',
      inventory_screen: {
        type: 'screen',
        controls: [{
          'inventory@crafting.inventory_panel': {
            '$slot_texture': 'textures/ui/player_preview_border',
          },
        }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [imported, vanilla], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.sourceKind === 'imported' && item.localName === 'inventory_screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  const grid = result.document.inventory_screen.controls[0].inventory;
  assertEqual(grid.controls.length, 6);
  assertDeepEqual(grid.controls[5].preview_slot_5.grid_position, [2, 1]);
  assertEqual(grid.controls[0].preview_slot_0.texture, 'textures/ui/player_preview_border');
  assert(result.provenance.some((item) => item.sourceKind === 'vanilla' && item.qualifiedName === 'crafting.inventory_panel'));
  assert(result.provenance.some((item) => item.sourceKind === 'vanilla' && item.qualifiedName === 'crafting.slot'));
  assertEqual(result.stats.materializedGridItems, 6);
  assert(result.diagnostics.some((item) => item.code === 'UI_GRID_TEMPLATE_MATERIALIZED'));
});

test('missing-dimension collection grids require an explicit representative opt-in', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/collection.json': {
      namespace: 'collection',
      slot: { type: 'image', size: [18, 18], texture: 'textures/ui/cell_image' },
      grid: {
        type: 'grid',
        size: [90, 54],
        collection_name: 'runtime_only',
        grid_rescaling_type: 'horizontal',
        grid_item_template: 'collection.slot',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'grid');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.grid.controls, undefined);
  assertEqual(result.stats.materializedGridItems, 0);
});

test('an explicit zero grid maximum suppresses representative materialization without a policy warning', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/zero-grid.json': {
      namespace: 'zero_grid',
      slot: { type: 'image', size: [18, 18], texture: 'textures/ui/cell_image' },
      grid: {
        type: 'grid',
        grid_dimensions: [2, 2],
        maximum_grid_items: 0,
        grid_item_template: 'zero_grid.slot',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'grid');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.grid.controls, undefined);
  assertEqual(result.stats.materializedGridItems, 0);
  assert(!result.diagnostics.some((item) => item.code === 'UI_GRID_MATERIALIZATION_LIMIT'));
});

test('opted-in collection grid materialization is bounded and preserves dynamic properties', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/collection.json': {
      namespace: 'collection',
      slot: { type: 'image', size: [18, 18], texture: 'textures/ui/cell_image' },
      grid: {
        type: 'grid',
        size: [90, 54],
        collection_name: 'recipe_book',
        grid_rescaling_type: 'horizontal',
        grid_item_template: 'collection.slot',
        maximum_grid_items: '#recipe_book_total_items',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'grid');
  const result = resolveEffectiveUi({
    catalog,
    recordId: record.id,
    representativeCollections: { recipe_book: { count: 12 } },
    limits: { maxMaterializedGridItems: 5, maxMaterializedGridItemsTotal: 4 },
  });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.grid.controls.length, 4);
  assertEqual(result.document.grid.collection_name, 'recipe_book');
  assertEqual(result.document.grid.maximum_grid_items, '#recipe_book_total_items');
  assertEqual(result.document.grid.grid_dimensions, undefined);
  assertEqual(result.document.grid.controls[0].preview_slot_0.grid_position, undefined);
  assertEqual(result.stats.materializedGridItems, 4);
  assert(result.diagnostics.some((item) => item.code === 'UI_GRID_MATERIALIZATION_LIMIT' && item.materialized === 4));
  assert(result.diagnostics.some((item) => item.code === 'UI_GRID_TEMPLATE_MATERIALIZED'
    && item.countSource === 'representative-collection'));
});

test('user mock values override representative collection binding defaults', () => {
  const merged = mergeRepresentativeCollectionMockData({
    recipe_book: {
      count: 136,
      bindingValues: {
        '#recipe_book_total_items': 136,
        '#container_item_background': 0,
      },
    },
  }, {
    '#recipe_book_total_items': 18,
    '#container_item_background': 4,
  });
  assertEqual(merged['#recipe_book_total_items'], 18);
  assertEqual(merged['#container_item_background'], 4);
});

test('Creative-like recipe collection resolves representative slots into inferred rows', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/inventory_screen.json': {
      namespace: 'crafting',
      grid_item_for_recipe_book: {
        type: 'image',
        size: [18, 18],
        texture: 'textures/ui/recipe_book_item_bg',
      },
      scroll_grid: {
        type: 'grid',
        size: [72, 54],
        '$grid_item_template|default': 'crafting.grid_item_for_recipe_book',
        grid_item_template: '$grid_item_template',
        collection_name: '$collection_name',
        grid_rescaling_type: 'horizontal',
        maximum_grid_items: '#recipe_book_total_items',
      },
    },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/inventory_screen.json': {
      namespace: 'crafting',
      inventory_screen: {
        type: 'screen',
        size: [72, 54],
        controls: [{
          'catalog@crafting.scroll_grid': {
            '$collection_name': 'recipe_book',
          },
        }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [vanilla, imported], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.sourceKind === 'imported' && item.localName === 'inventory_screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: record.id,
    representativeCollections: { recipe_book: { count: 12 } },
  });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  const grid = result.document.inventory_screen.controls[0].catalog;
  assertEqual(grid.controls.length, 12);
  assertEqual(grid.collection_name, 'recipe_book');

  const model = buildUiScreenModelFromJson(result.document, { filePath: 'ui/inventory_screen.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 72, height: 54, name: 'creative-recipe' });
  const slots = layout.boxes.filter((box) => box.type === 'image' && String(box.id).includes('preview_slot_'));
  assertEqual(slots.length, 12);
  assertEqual(new Set(slots.map((box) => box.x)).size, 4);
  assertEqual(new Set(slots.map((box) => box.y)).size, 3);
  assert(layout.warnings.some((warning) => warning.includes('GRID_DIMENSIONS_INFERRED') && warning.includes('4x3')));
});

test('variable-backed control names preserve inheritance and expose a nested recipe grid', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/common.json': {
      namespace: 'common',
      scroll_view_control: {
        type: 'panel',
        controls: [{
          'grid@crafting.scroll_grid': {
            '$collection_name': 'recipe_book',
          },
        }],
      },
      forwarding_panel: {
        type: 'panel',
        '$scroll_view_name|default': 'default_scroll',
        controls: [{ '$scroll_view_name@common.scroll_view_control': {} }],
      },
    },
    'ui/inventory_screen.json': {
      namespace: 'crafting',
      recipe_slot: { type: 'image', size: [18, 18], texture: 'textures/ui/recipe_book_item_bg' },
      scroll_grid: {
        type: 'grid',
        size: [72, 54],
        '$grid_item_template|default': 'crafting.recipe_slot',
        grid_item_template: '$grid_item_template',
        collection_name: '$collection_name',
        grid_rescaling_type: 'horizontal',
      },
      inventory_screen: {
        type: 'screen',
        '$scroll_view_name|default': 'default_scroll',
        '$scroll_view_name': 'scroll_mouse',
        '$ordinary_value|default': 'fallback',
        '$ordinary_value': 'exact',
        controls: [
          {
            'pane@common.forwarding_panel': {
              '$scroll_view_name': '$scroll_view_name',
            },
          },
          { label: { type: 'label', text: '$ordinary_value' } },
        ],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'inventory_screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: record.id,
    representativeCollections: { recipe_book: { count: 12 } },
  });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  const screen = result.document.inventory_screen;
  assertEqual(screen.$scroll_view_name, 'scroll_mouse');
  assertEqual(screen['$scroll_view_name|default'], 'default_scroll');
  assertEqual(screen.controls[1].label.text, 'exact');
  const forwarded = screen.controls[0].pane.controls[0].scroll_mouse;
  assert(forwarded, 'Expected the forwarded dynamic control name to resolve');
  assertEqual(forwarded.controls[0].grid.collection_name, 'recipe_book');
  assertEqual(forwarded.controls[0].grid.controls.length, 12);
});

test('cyclic variable-backed control names fail closed with a diagnostic', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/common.json': {
      namespace: 'common',
      base: { type: 'panel', marker: 'base' },
      screen: {
        type: 'screen',
        '$a': '$b',
        '$b': '$a',
        controls: [{ '$a@common.base': {} }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected bounded resolver success');
  assert(result.document.screen.controls[0].$a, 'Unresolved dynamic key should remain inspectable');
  assert(result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_CONTROL_NAME_UNRESOLVED'
    && item.reason === 'VARIABLE_CYCLE'));
});

test('representative grids materialize only the statically active Classic branch', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/branches.json': {
      namespace: 'branches',
      slot: { type: 'image', size: [18, 18], texture: 'textures/ui/cell_image' },
      grid: {
        type: 'grid',
        collection_name: 'recipe_book',
        grid_item_template: 'branches.slot',
        grid_rescaling_type: 'horizontal',
      },
      screen: {
        type: 'screen',
        controls: [
          {
            touch: {
              type: 'panel',
              ignored: '(not $touch)',
              controls: [{ 'touch_grid@branches.grid': {} }],
            },
          },
          {
            mouse: {
              type: 'panel',
              ignored: '$touch',
              controls: [{ 'mouse_grid@branches.grid': {} }],
            },
          },
        ],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: record.id,
    variables: { '$touch': false },
    representativeCollections: { recipe_book: { count: 12 } },
  });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  const touchGrid = result.document.screen.controls[0].touch.controls[0]['touch_grid@branches.grid'];
  const mouseGrid = result.document.screen.controls[1].mouse.controls[0].mouse_grid;
  assertEqual(touchGrid.controls, undefined);
  assertEqual(mouseGrid.controls.length, 12);
  assertEqual(result.stats.materializedGridItems, 12);
});

test('unknown runtime visibility does not prune a representative grid', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/unknown-branch.json': {
      namespace: 'unknown_branch',
      slot: { type: 'image', size: [18, 18], texture: 'textures/ui/cell_image' },
      screen: {
        type: 'panel',
        ignored: '$runtime_mode',
        controls: [{
          grid: {
            type: 'grid',
            collection_name: 'recipe_book',
            grid_item_template: 'unknown_branch.slot',
            grid_rescaling_type: 'horizontal',
          },
        }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: record.id,
    variables: { '$runtime_mode': 'false' },
    representativeCollections: { recipe_book: { count: 7 } },
  });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls[0].grid.controls.length, 7);
  assertEqual(result.stats.materializedGridItems, 7);
});

test('a binding that can activate visible false prevents static grid pruning', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/bound-branch.json': {
      namespace: 'bound_branch',
      slot: { type: 'image', size: [18, 18], texture: 'textures/ui/cell_image' },
      screen: {
        type: 'panel',
        visible: false,
        bindings: [{
          binding_type: 'global',
          binding_name: '#show_catalog',
          binding_name_override: '#visible',
        }],
        controls: [{
          grid: {
            type: 'grid',
            collection_name: 'recipe_book',
            grid_item_template: 'bound_branch.slot',
            grid_rescaling_type: 'horizontal',
          },
        }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: record.id,
    representativeCollections: { recipe_book: { count: 6 } },
  });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls[0].grid.controls.length, 6);
  assertEqual(result.stats.materializedGridItems, 6);
});

test('vertical rescaling infers multiple rows before adding columns', () => {
  const controls = Array.from({ length: 8 }, (_, index) => ({
    [`slot_${index}`]: { type: 'image', size: [20, 20], texture: 'textures/ui/cell_image' },
  }));
  const model = buildUiScreenModelFromJson({
    namespace: 'vertical_grid',
    screen: {
      type: 'screen',
      size: [40, 80],
      controls: [{
        grid: {
          type: 'grid',
          size: [40, 80],
          grid_rescaling_type: 'vertical',
          grid_fill_direction: 'vertical',
          controls,
        },
      }],
    },
  }, { filePath: 'ui/vertical-grid.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 40, height: 80, name: 'vertical-grid' });
  const slots = layout.boxes.filter((box) => box.type === 'image');
  assertEqual(slots.length, 8);
  assertEqual(new Set(slots.map((box) => box.x)).size, 2);
  assertEqual(new Set(slots.map((box) => box.y)).size, 4);
  assert(layout.warnings.some((warning) => warning.includes('GRID_DIMENSIONS_INFERRED') && warning.includes('2x4')));
});

test('a partially filled inferred recipe grid keeps 18px row and column tracks', () => {
  const controls = Array.from({ length: 18 }, (_, index) => ({
    [`slot_${index}`]: { type: 'image', size: [18, 18], texture: 'textures/ui/cell_image' },
  }));
  const model = buildUiScreenModelFromJson({
    namespace: 'recipe_tracks',
    screen: {
      type: 'screen',
      size: [314, 154],
      controls: [{
        grid: {
          type: 'grid',
          size: [314, 154],
          grid_rescaling_type: 'horizontal',
          controls,
        },
      }],
    },
  }, { filePath: 'ui/recipe-tracks.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 314, height: 154, name: 'recipe-tracks' });
  const slots = layout.boxes.filter((box) => box.type === 'image');
  const xs = [...new Set(slots.map((box) => box.x))].sort((a, b) => a - b);
  const ys = [...new Set(slots.map((box) => box.y))].sort((a, b) => a - b);
  assertEqual(xs.length, 17);
  assertEqual(ys.length, 2);
  assertEqual(xs[1] - xs[0], 18);
  assertEqual(ys[1] - ys[0], 18);
  assert(layout.warnings.some((warning) => warning.includes('GRID_DIMENSIONS_INFERRED') && warning.includes('17x2')));
});

test('inferred grids clamp a sub-cell viewport to one track and honor an explicit zero maximum', () => {
  const controls = Array.from({ length: 8 }, (_, index) => ({
    [`slot_${index}`]: { type: 'image', size: [20, 20], texture: 'textures/ui/cell_image' },
  }));
  const makeTree = (maximumGridItems) => buildTreeFromUiScreenModel(buildUiScreenModelFromJson({
    namespace: 'narrow_grid',
    screen: {
      type: 'screen',
      size: [10, 80],
      controls: [{
        grid: {
          type: 'grid',
          size: [10, 80],
          grid_rescaling_type: 'horizontal',
          maximum_grid_items: maximumGridItems,
          controls,
        },
      }],
    },
  }, { filePath: 'ui/narrow-grid.json' }));

  const narrow = computeLayoutBoxesForFile(makeTree(8), { width: 10, height: 80, name: 'narrow-grid' });
  const narrowSlots = narrow.boxes.filter((box) => box.type === 'image');
  assertEqual(narrowSlots.length, 8);
  assertEqual(new Set(narrowSlots.map((box) => box.x)).size, 1);
  assertEqual(new Set(narrowSlots.map((box) => box.y)).size, 8);
  assert(narrow.warnings.some((warning) => warning.includes('GRID_DIMENSIONS_INFERRED') && warning.includes('1x8')));

  const empty = computeLayoutBoxesForFile(makeTree(0), { width: 10, height: 80, name: 'empty-grid' });
  assertEqual(empty.boxes.filter((box) => box.type === 'image').length, 0);
  assert(!empty.warnings.some((warning) => warning.includes('GRID_MISSING_DIMENSIONS')));
});

test('generated collection grids and slots default collapsed without collapsing ordinary trees', () => {
  const nodes = {
    grid: { id: 'grid', children: ['grid/preview_slot_0', 'grid/preview_slot_1'], props: { name: 'grid' } },
    'grid/preview_slot_0': {
      id: 'grid/preview_slot_0',
      children: ['grid/preview_slot_0/frame'],
      props: { name: 'preview_slot_0' },
    },
    'grid/preview_slot_1': { id: 'grid/preview_slot_1', children: [], props: { name: 'preview_slot_1' } },
    ordinary: { id: 'ordinary', children: ['ordinary/child'], props: { name: 'ordinary' } },
    'ordinary/child': { id: 'ordinary/child', children: [], props: { name: 'child' } },
    root: { id: 'root', isFileRoot: true, descendantCount: 900, children: ['large'], props: { name: 'root' } },
    large: { id: 'large', isFileRoot: false, descendantCount: 201, children: ['ordinary'], props: { name: 'large' } },
  };
  assertEqual(shouldDefaultCollapseGeneratedCollectionNode(nodes.grid, nodes), true);
  assertEqual(shouldDefaultCollapseGeneratedCollectionNode(nodes['grid/preview_slot_0'], nodes), true);
  assertEqual(shouldDefaultCollapseGeneratedCollectionNode(nodes.ordinary, nodes), false);
  assertEqual(shouldDefaultCollapseGeneratedCollectionNode(nodes.large, nodes), true);
  assertEqual(shouldDefaultCollapseGeneratedCollectionNode(nodes.root, nodes), false);
});

test('tree model records bounded descendant counts for collapse decisions', () => {
  const controls = Array.from({ length: 3 }, (_, index) => ({
    [`child_${index}`]: { type: 'panel', controls: [{ leaf: { type: 'label', text: 'x' } }] },
  }));
  const model = buildUiScreenModelFromJson({
    namespace: 'tree_counts',
    screen: { type: 'screen', controls },
  }, { filePath: 'ui/tree-counts.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const root = tree.nodesById[tree.rootId];
  const screen = Object.values(tree.nodesById).find((node) => node.props?.name === 'screen');
  assertEqual(root.descendantCount, 7);
  assertEqual(root.isFileRoot, true);
  assertEqual(screen.descendantCount, 6);
  assertEqual(screen.isFileRoot, false);
});

test('single rendered box is not classified as an empty preview', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'single',
    only_image: { type: 'image', texture: 'textures/ui/player_preview_border', size: [64, 64] },
  }, { filePath: 'ui/single-image.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 320, height: 180, name: 'single-image' });
  assertEqual(layout.stats.renderedBoxes, 1);
  const drawableBoxes = countDrawableCanvasBoxes({ boxes: layout.boxes, nodesById: tree.nodesById });
  assertEqual(drawableBoxes, 1);
  assertEqual(shouldShowCanvasEmptyState({
    hasPreviewFile: true,
    hasLayoutError: false,
    renderedBoxes: layout.stats.renderedBoxes,
    drawableBoxes,
  }), false);
  assertEqual(shouldShowCanvasEmptyState({ hasPreviewFile: true, hasLayoutError: false, renderedBoxes: 1, drawableBoxes: 0 }), true);
  assertEqual(shouldShowCanvasEmptyState({ hasPreviewFile: true, hasLayoutError: false, renderedBoxes: 0, drawableBoxes: 0 }), true);
  assertEqual(shouldShowCanvasEmptyState({ hasPreviewFile: false, hasLayoutError: false, renderedBoxes: 0 }), false);
  assertEqual(shouldShowCanvasEmptyState({ hasPreviewFile: true, hasLayoutError: true, renderedBoxes: 0 }), false);
});

test('layout resolves bounded percent-minus-pixel dimensions and max_size', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'linear',
    screen: {
      type: 'screen',
      size: [220, 240],
      controls: [{
        background: {
          type: 'image',
          texture: 'textures/ui/background',
          size: ['100% - 44px', '100% + 20px'],
          max_size: [200, 250],
        },
      }],
    },
  }, { filePath: 'ui/linear-size.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 320, height: 300, name: 'linear-size' });
  const background = layout.boxes.find((box) => box.type === 'image');
  assert(background, 'Expected background image box');
  assertEqual(background.w, 176);
  assertEqual(background.h, 250);
});

test('layout applies anchor_from to the parent and anchor_to to the element', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'anchors',
    screen: {
      type: 'screen',
      size: [200, 100],
      anchor_from: 'top_left',
      anchor_to: 'top_left',
      controls: [{
        child: {
          type: 'panel',
          size: [20, 10],
          offset: [-5, -2],
          anchor_from: 'bottom_right',
          anchor_to: 'top_left',
        },
      }],
    },
  }, { filePath: 'ui/anchors.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 320, height: 180, name: 'anchors' });
  const child = layout.boxes.find((box) => String(box.id).endsWith('/child'));
  assert(child, 'Expected anchored child box');
  assertEqual(child.x, 195);
  assertEqual(child.y, 98);
});

test('content dimensions converge for a horizontal stack panel', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'content_size',
    screen: {
      type: 'screen',
      size: [200, 100],
      anchor_from: 'top_left',
      anchor_to: 'top_left',
      controls: [{
        row: {
          type: 'stack_panel',
          orientation: 'horizontal',
          size: ['100%c', '100%cm'],
          anchor_from: 'top_left',
          anchor_to: 'top_left',
          controls: [
            { first: { type: 'panel', size: [20, 10] } },
            { second: { type: 'panel', size: [30, 15] } },
          ],
        },
      }],
    },
  }, { filePath: 'ui/content-size.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 320, height: 180, name: 'content-size' });
  const row = layout.boxes.find((box) => String(box.id).endsWith('/row'));
  assert(row, 'Expected stack panel box');
  assertEqual(row.w, 50);
  assertEqual(row.h, 15);
  assert(!layout.warnings.some((warning) => String(warning).startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('stack panels resolve percentages once and reserve remaining space only for fill', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'stack_percentages',
    screen: {
      type: 'screen',
      size: [200, 100],
      anchor_from: 'top_left',
      anchor_to: 'top_left',
      controls: [
        {
          row: {
            type: 'stack_panel',
            orientation: 'horizontal',
            size: [100, 20],
            anchor_from: 'top_left',
            anchor_to: 'top_left',
            controls: [
              { half: { type: 'panel', size: ['50%', 20] } },
              { fixed: { type: 'panel', size: [20, 20] } },
              { remainder: { type: 'panel', size: ['fill', 20] } },
            ],
          },
        },
        {
          overflow_row: {
            type: 'stack_panel',
            orientation: 'horizontal',
            size: [100, 20],
            offset: [0, 30],
            anchor_from: 'top_left',
            anchor_to: 'top_left',
            controls: [
              { prefix: { type: 'panel', size: [20, 20] } },
              { full_percent: { type: 'panel', size: ['100%', 20] } },
            ],
          },
        },
      ],
    },
  }, { filePath: 'ui/stack-percentages.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 200, height: 100, name: 'stack-percentages' });
  const bySuffix = (suffix) => layout.boxes.find((box) => String(box.id).endsWith(`/${suffix}`));
  const half = bySuffix('half');
  const fixed = bySuffix('fixed');
  const remainder = bySuffix('remainder');
  const fullPercent = bySuffix('full_percent');
  assert(half && fixed && remainder && fullPercent, 'Expected every stack child');
  assertEqual(half.w, 50);
  assertEqual(fixed.w, 20);
  assertEqual(remainder.w, 30);
  assertEqual(half.x, 0);
  assertEqual(fixed.x, 50);
  assertEqual(remainder.x, 70);
  assertEqual(fullPercent.w, 100);
  assertEqual(fullPercent.x, 20);
});

test('Classic UI scale calibration and focus fit preserve the observed 4x geometry', () => {
  assertEqual(inferObservedUiScale({
    logicalWidth: 176,
    logicalHeight: 166,
    observedWidth: 676,
    observedHeight: 638,
  }), 4);
  const fitted = fitViewToBounds(800, 600, { x: 50, y: 20, w: 200, h: 100 }, 0, 4);
  assertEqual(fitted.zoom, 4);
  assertEqual(fitted.viewX, 50);
  assertEqual(fitted.viewY, -5);
});

test('paint order includes ancestor layers so foreground controls stay above pack backgrounds', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'effective_layers',
    screen: {
      type: 'screen',
      size: [100, 100],
      anchor_from: 'top_left',
      anchor_to: 'top_left',
      controls: [
        {
          foreground_branch: {
            type: 'panel',
            layer: 5,
            size: [100, 100],
            anchor_from: 'top_left',
            anchor_to: 'top_left',
            controls: [{ foreground: { type: 'panel', layer: 0, size: [100, 100] } }],
          },
        },
        { background: { type: 'image', layer: 2, size: [100, 100], texture: 'textures/ui/background' } },
      ],
    },
  }, { filePath: 'ui/effective-layers.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 100, height: 100, name: 'effective-layers' });
  const foreground = layout.boxes.find((box) => String(box.id).endsWith('/foreground'));
  const background = layout.boxes.find((box) => String(box.id).endsWith('/background'));
  assert(foreground && background, 'Expected foreground and background boxes');
  assert(compareCanvasPaintOrder(foreground, background) > 0, 'Foreground branch must paint above the background');
  assertEqual(hitTestBoxes(layout.boxes, 50, 50).id, foreground.id);
});

test('controls modifications implicitly overlay the lower same-symbol definition', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/modifications.json': {
      namespace: 'mods',
      keep_template: { type: 'panel', marker: 'keep' },
      remove_template: { type: 'panel', marker: 'remove' },
      replace_template: { type: 'panel', marker: 'old' },
      screen: {
        type: 'screen',
        controls: [
          { 'keep@mods.keep_template': {} },
          { 'remove_me@mods.remove_template': {} },
          { 'replace_me@mods.replace_template': {} },
        ],
      },
    },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/modifications.json': {
      namespace: 'mods',
      front_template: { type: 'label', text: 'front' },
      back_template: { type: 'label', text: 'back' },
      replacement_template: { type: 'label', text: 'replacement' },
      screen: {
        modifications: [
          { array_name: 'controls', operation: 'insert_front', value: { 'front@mods.front_template': {} } },
          { array_name: 'controls', operation: 'insert_back', value: [{ 'back@mods.back_template': {} }] },
          { array_name: 'controls', operation: 'remove', control_name: 'remove_me' },
          {
            array_name: 'controls',
            operation: 'replace',
            where: { control_name: 'replace_me' },
            value: { 'replacement@mods.replacement_template': {} },
          },
        ],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [vanilla, imported], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.sourceKind === 'imported' && item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertDeepEqual(result.document.screen.controls.map((control) => Object.keys(control)[0]), [
    'front',
    'keep',
    'replacement',
    'back',
  ]);
  assertEqual(result.document.screen.controls[0].front.text, 'front');
  assertEqual(result.document.screen.controls[1].keep.marker, 'keep');
  assertEqual(result.document.screen.controls[2].replacement.text, 'replacement');
  assertEqual(result.document.screen.modifications, undefined);
  assertEqual(result.stats.modificationsSeen, 4);
  assertEqual(result.stats.appliedModifications, 4);
  assertEqual(result.stats.unsupportedModifications, 0);
  assertEqual(result.semanticsProfile, 'deep-object-array-replace-array-modifications-v3');
  assert(result.provenance.some((item) => item.sourceKind === 'vanilla' && item.qualifiedName === 'mods.screen'));
  assert(result.diagnostics.some((item) => item.code === 'UI_MODIFICATIONS_IMPLICIT_BASE'));
});

test('unsupported and over-budget controls modifications are skipped with fidelity diagnostics', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/modifications.json': {
      namespace: 'mods',
      screen: {
        type: 'screen',
        controls: [{ first: { type: 'panel' } }, { second: { type: 'panel' } }],
      },
    },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/modifications.json': {
      namespace: 'mods',
      screen: {
        modifications: [
          { array_name: 'controls', operation: 'unsupported_operation', control_name: 'first', value: { third: {} } },
          { array_name: 'controls', operation: 'insert_back', value: { third: {} } },
        ],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [vanilla, imported], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.sourceKind === 'imported' && item.localName === 'screen');
  const result = resolveEffectiveUi({
    catalog,
    recordId: record.id,
    limits: { maxModifiedArrayItems: 2 },
  });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertDeepEqual(result.document.screen.controls.map((control) => Object.keys(control)[0]), ['first', 'second']);
  assertEqual(result.stats.modificationsSeen, 2);
  assertEqual(result.stats.appliedModifications, 0);
  assertEqual(result.stats.unsupportedModifications, 2);
  assert(result.diagnostics.some((item) => item.code === 'UI_MODIFICATION_SKIPPED' && item.reason === 'OPERATION_UNSUPPORTED'));
  assert(result.diagnostics.some((item) => item.code === 'UI_MODIFICATION_SKIPPED' && item.reason === 'ARRAY_ITEM_LIMIT'));
  assert(result.diagnostics.some((item) => item.code === 'UI_MODIFICATIONS_UNSUPPORTED'));
});

test('deferred dynamic control bases retain the namespace where the raw key was authored', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/common.json': {
      namespace: 'common',
      slot: { type: 'label', text: 'Vanilla slot' },
      base: {
        type: 'panel',
        '$template|default': 'slot',
        controls: [{ 'item@$template': {} }],
      },
    },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/custom.json': {
      namespace: 'custom',
      'screen@common.base': {},
    },
  });
  const catalog = await buildUiCatalog({ sources: [vanilla, imported], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.sourceKind === 'imported');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls[0].item.text, 'Vanilla slot');
  assert(result.provenance.some((item) => item.qualifiedName === 'common.slot'));
  assert(!result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND'));
});

test('effective resolver handles cross-file inheritance and selected root only', async () => {
  const catalog = await makeCatalog();
  const file = findCatalogFile(catalog, 'imported', 'ui/custom.json');
  const definition = listDefinitionsForFile(catalog, file.id).find((item) => item.localName === 'main_screen');
  const result = resolveEffectiveUi({ catalog, recordId: definition.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertDeepEqual(Object.keys(result.document).sort(), ['main_screen', 'namespace']);
  assertDeepEqual(result.document.main_screen.size, [320, 180]);
  assertEqual(result.document.main_screen.layer, 4);
  assertEqual(result.document.main_screen.controls[0].title.text, 'menu.title');
  assertEqual(result.document.main_screen.controls[0].title.shadow, true);
  assert(result.provenance.length >= 3, 'Expected selected, screen base, and label base provenance');
});

test('Pocket path classification blocks preview at resolver boundary', async () => {
  const catalog = await makeCatalog();
  const file = findCatalogFile(catalog, 'vanilla', 'ui/example_pocket.json');
  const definition = listDefinitionsForFile(catalog, file.id)[0];
  assertEqual(definition.profile, 'pocket');
  const result = resolveEffectiveUi({ catalog, recordId: definition.id });
  assertEqual(result.ok, false);
  assertEqual(result.error.code, 'POCKET_PREVIEW_BLOCKED');
  assertEqual(isPocketUiPath('ui/inventory_screen_pocket.json'), true);
  assertEqual(isPocketUiPath('ui/inventory_screen.json'), false);
});

test('resolver reports a missing base without fabricating it', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/missing.json': { namespace: 'broken', 'screen@not_here.base': { type: 'panel' } },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records[0];
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assertEqual(result.ok, true);
  assert(result.diagnostics.some((item) => item.code === 'UI_BASE_NOT_FOUND'));
});

test('resolver detects inheritance cycles and keeps the result bounded', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/cycle.json': {
      namespace: 'cycle',
      'a@cycle.b': { type: 'panel' },
      'b@cycle.a': { type: 'panel' },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const result = resolveEffectiveUi({ catalog, recordId: catalog.records[0].id });
  assertEqual(result.ok, true);
  assert(result.diagnostics.some((item) => item.code === 'UI_INHERITANCE_CYCLE'));
});

test('resolver bounds record-level dynamic inheritance cycles', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/dynamic-cycle.json': {
      namespace: 'dynamic_cycle',
      'a@$a_base': { '$a_base': 'dynamic_cycle.b', type: 'panel' },
      'b@$b_base': { '$b_base': 'dynamic_cycle.a', type: 'panel' },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'a');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assertEqual(result.ok, true);
  assert(result.diagnostics.some((item) => item.code === 'UI_INHERITANCE_CYCLE'));
  assert(JSON.stringify(result.document).length < 10_000);
});

test('resolver caps conditional variable branches with an explicit diagnostic', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/variable-branch-limit.json': {
      namespace: 'variable_branch_limit',
      screen: {
        type: 'panel',
        variables: Array.from({ length: 257 }, (_, index) => ({ '$selected': index })),
        marker: '$selected',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const result = resolveEffectiveUi({ catalog, recordId: catalog.records[0].id });
  assertEqual(result.ok, true);
  assertEqual(result.document.screen.marker, 255);
  assert(result.diagnostics.some((item) => item.code === 'UI_VARIABLE_BRANCH_LIMIT' && item.maximum === 256));
});

test('dynamic variable-backed bases resolve defaults and derived overrides', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/dynamic.json': {
      namespace: 'dynamic',
      template_a: { type: 'label', text: 'A' },
      template_b: { type: 'label', text: 'B' },
      base: {
        type: 'panel',
        '$runtime_template|default': 'dynamic.template_a',
        controls: [{ 'content@$runtime_template': {} }],
      },
      'screen@dynamic.base': { '$runtime_template': 'dynamic.template_b' },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assertEqual(result.ok, true);
  assertEqual(result.document.screen.controls[0].content.text, 'B');
  assert(!result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_UNRESOLVED'));
  assertDeepEqual(record.references, ['dynamic.base', 'dynamic.template_b']);
});

test('record-level dynamic bases keep defaults, derived overrides, and intermediate ancestors', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/dynamic-record-chain.json': {
      namespace: 'dynamic_record_chain',
      ancestor_a: { type: 'panel', marker: 'A', size: [31, 17] },
      ancestor_b: { type: 'label', marker: 'B', text: 'selected' },
      'wrapper@$runtime_template': {
        '$runtime_template|default': 'dynamic_record_chain.ancestor_a',
        wrapper_marker: true,
      },
      'default_screen@dynamic_record_chain.wrapper': {},
      'override_screen@dynamic_record_chain.wrapper': {
        '$runtime_template': 'dynamic_record_chain.ancestor_b',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });

  const defaultRecord = catalog.records.find((item) => item.localName === 'default_screen');
  const defaultResult = resolveEffectiveUi({ catalog, recordId: defaultRecord.id });
  assert(defaultResult.ok, defaultResult.error ? defaultResult.error.code : 'Expected resolver success');
  assertEqual(defaultResult.document.default_screen.type, 'panel');
  assertEqual(defaultResult.document.default_screen.marker, 'A');
  assertEqual(defaultResult.document.default_screen.wrapper_marker, true);

  const overrideRecord = catalog.records.find((item) => item.localName === 'override_screen');
  const overrideResult = resolveEffectiveUi({ catalog, recordId: overrideRecord.id });
  assert(overrideResult.ok, overrideResult.error ? overrideResult.error.code : 'Expected resolver success');
  assertEqual(overrideResult.document.override_screen.type, 'label');
  assertEqual(overrideResult.document.override_screen.marker, 'B');
  assertEqual(overrideResult.document.override_screen.text, 'selected');
  assertEqual(overrideResult.document.override_screen.wrapper_marker, true);
  assert(!overrideResult.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND'));
});

test('dynamic child bases resolve multi-hop variable aliases to a symbol', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/common.json': {
      namespace: 'common',
      empty_panel: { type: 'image', texture: 'textures/ui/empty', marker: 'terminal' },
      toggle_panel: {
        type: 'panel',
        '$toggle_image|default': '$unchecked_image',
        '$unchecked_image|default': 'common.empty_panel',
        controls: [{ 'image@$toggle_image': {} }],
      },
    },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/custom.json': {
      namespace: 'custom',
      'screen@common.toggle_panel': {},
    },
  });
  const catalog = await buildUiCatalog({ sources: [vanilla, imported], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.sourceKind === 'imported');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls[0].image.marker, 'terminal');
  assertEqual(result.document.screen.controls[0].image.texture, 'textures/ui/empty');
  assert(result.provenance.some((item) => item.qualifiedName === 'common.empty_panel'));
  assert(!result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND'));
});

test('object-map controls resolve inheritance through the same path as array controls', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/object-controls.json': {
      namespace: 'object_controls',
      base_icon: { type: 'image', texture: 'textures/ui/icon', marker: 'inherited' },
      screen: {
        type: 'screen',
        controls: {
          'icon@object_controls.base_icon': { alpha: 0.25 },
        },
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  const icon = result.document.screen.controls.icon;
  assertEqual(icon.type, 'image');
  assertEqual(icon.texture, 'textures/ui/icon');
  assertEqual(icon.marker, 'inherited');
  assertEqual(icon.alpha, 0.25);
  assert(!result.diagnostics.some((item) => item.code === 'UI_CONTROL_BASE_NOT_FOUND'));
});

test('inline controls remain controls instead of being split into named properties', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/inline-controls.json': {
      namespace: 'inline_controls',
      screen: {
        type: 'screen',
        controls: [
          { type: 'panel', size: [10, 20], marker: 'inline' },
          { size: [7, 9], anchor_from: 'top_left', marker: 'inline-typeless' },
        ],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls.length, 2);
  assertEqual(result.document.screen.controls[0].type, 'panel');
  assertDeepEqual(result.document.screen.controls[0].size, [10, 20]);
  assertEqual(result.document.screen.controls[0].marker, 'inline');
  assertDeepEqual(result.document.screen.controls[1].size, [7, 9]);
  assertEqual(result.document.screen.controls[1].marker, 'inline-typeless');

  const model = buildUiScreenModelFromJson(result.document, { filePath: 'ui/inline-controls.json' });
  const inlineChildren = model.root.children.find((node) => node.key.local_name === 'screen').children;
  const inline = inlineChildren[0];
  assertEqual(inline.type, 'panel');
  assertDeepEqual(inline.props.size, [10, 20]);
  assertDeepEqual(inlineChildren[1].props.size, [7, 9]);
  assertEqual(inlineChildren[1].unknownProps.marker, 'inline-typeless');
});

test('variable-backed controls arrays and maps are traversed after substitution', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/variable-controls.json': {
      namespace: 'variable_controls',
      base: { type: 'image', texture: 'textures/ui/inherited', marker: 'base' },
      array_screen: {
        type: 'screen',
        '$child_controls': [{ 'array_child@variable_controls.base': { alpha: 0.5 } }],
        controls: '$child_controls',
      },
      map_screen: {
        type: 'screen',
        '$child_controls': { 'map_child@variable_controls.base': { layer: 3 } },
        controls: '$child_controls',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });

  const arrayRecord = catalog.records.find((item) => item.localName === 'array_screen');
  const arrayResult = resolveEffectiveUi({ catalog, recordId: arrayRecord.id });
  assert(arrayResult.ok, arrayResult.error ? arrayResult.error.code : 'Expected resolver success');
  assertEqual(arrayResult.document.array_screen.controls[0].array_child.marker, 'base');
  assertEqual(arrayResult.document.array_screen.controls[0].array_child.alpha, 0.5);

  const mapRecord = catalog.records.find((item) => item.localName === 'map_screen');
  const mapResult = resolveEffectiveUi({ catalog, recordId: mapRecord.id });
  assert(mapResult.ok, mapResult.error ? mapResult.error.code : 'Expected resolver success');
  assertEqual(mapResult.document.map_screen.controls.map_child.marker, 'base');
  assertEqual(mapResult.document.map_screen.controls.map_child.layer, 3);
});

test('deferred object-map controls retain their authored namespace', async () => {
  const vanilla = makeSource('vanilla', 'vanilla', 10, {
    'ui/common.json': {
      namespace: 'common',
      slot: { type: 'image', marker: 'common-slot' },
      base: {
        type: 'panel',
        '$template|default': 'slot',
        controls: { 'item@$template': {} },
      },
    },
  });
  const imported = makeSource('imported', 'imported', 20, {
    'ui/custom.json': { namespace: 'custom', 'screen@common.base': {} },
  });
  const catalog = await buildUiCatalog({ sources: [vanilla, imported], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.sourceKind === 'imported');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls.item.marker, 'common-slot');
  assert(!result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND'));
});

test('whole control-key variables support base-only terminal references', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/base-only.json': {
      namespace: 'base_only',
      button_panel: { type: 'stack_panel', marker: 'base-only-target' },
      screen: {
        type: 'screen',
        '$button_layout': '@base_only.button_panel',
        controls: [{ '$button_layout': {} }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls[0].button_panel.type, 'stack_panel');
  assertEqual(result.document.screen.controls[0].button_panel.marker, 'base-only-target');
  assert(!result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND'));
});

test('collection materialization preserves object controls and vertical order', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/grids.json': {
      namespace: 'grids',
      slot: { type: 'panel', size: [10, 10] },
      object_grid: {
        type: 'grid', grid_dimensions: [2, 2], grid_item_template: 'grids.slot',
        controls: { authored: { type: 'panel', marker: 'keep' } },
      },
      vertical_grid: {
        type: 'grid', grid_dimensions: [2, 3], grid_fill_direction: 'vertical',
        grid_item_template: 'grids.slot',
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const objectRecord = catalog.records.find((item) => item.localName === 'object_grid');
  const objectResult = resolveEffectiveUi({ catalog, recordId: objectRecord.id });
  assertEqual(objectResult.document.object_grid.controls.authored.marker, 'keep');
  assertEqual(Array.isArray(objectResult.document.object_grid.controls), false);

  const verticalRecord = catalog.records.find((item) => item.localName === 'vertical_grid');
  const verticalResult = resolveEffectiveUi({ catalog, recordId: verticalRecord.id });
  assertDeepEqual(verticalResult.document.vertical_grid.controls.map((entry) => {
    const item = Object.values(entry)[0];
    return item.grid_position;
  }), [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
});

test('controls can contain a named child literally called type', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'named_type',
    screen: {
      type: 'screen',
      controls: [{ type: { type: 'panel', size: [10, 12], marker: 'preserved' } }],
    },
  }, { filePath: 'ui/named-type.json' });
  const child = model.root.children[0].children[0];
  assertEqual(child.key.local_name, 'type');
  assertEqual(child.type, 'panel');
  assertDeepEqual(child.props.size, [10, 12]);
  assertEqual(child.unknownProps.marker, 'preserved');
});

test('resolver materialization preserves an inherited named child literally called type', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/resolved-named-type.json': {
      namespace: 'resolved_named_type',
      world_list_text: { type: 'image', texture: 'textures/ui/world' },
      screen: {
        type: 'screen',
        controls: [{ 'type@resolved_named_type.world_list_text': {} }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.controls[0].type.type, 'image');
  assertEqual(result.document.screen.controls[0].type.texture, 'textures/ui/world');
  assert(!result.diagnostics.some((item) => item.code === 'Cannot convert object to primitive value'));
});

test('whole control-key variables retain terminal local and base references', async () => {
  const source = makeSource('vanilla', 'vanilla', 10, {
    'ui/dynamic-key.json': {
      namespace: 'dynamic_key',
      icon_base: { type: 'image', texture: 'textures/ui/icon', marker: 'inherited' },
      explicit_base: { type: 'label', text: 'explicit', marker: 'explicit' },
      screen: {
        type: 'screen',
        '$direct': 'icon@dynamic_key.icon_base',
        '$alias': '$direct',
        controls: [
          { '$direct': { alpha: 0.5 } },
          { '$alias': { layer: 2 } },
          { '$direct@dynamic_key.explicit_base': {} },
        ],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  const controls = result.document.screen.controls;
  assertEqual(controls[0].icon.type, 'image');
  assertEqual(controls[0].icon.marker, 'inherited');
  assertEqual(controls[0].icon.alpha, 0.5);
  assertEqual(controls[1].icon.type, 'image');
  assertEqual(controls[1].icon.layer, 2);
  assertEqual(controls[2].icon.type, 'label');
  assertEqual(controls[2].icon.marker, 'explicit');
});

test('dynamic top-level bases resolve multi-hop global aliases to a symbol', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/_global_variables.json': {
      '$screen_template': '$screen_template_alias',
      '$screen_template_alias': 'dynamic.base_screen',
    },
    'ui/dynamic-record.json': {
      namespace: 'dynamic',
      base_screen: { type: 'screen', size: [320, 180], marker: 'terminal' },
      'screen@$screen_template': { layer: 7 },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id });
  assert(result.ok, result.error ? result.error.code : 'Expected resolver success');
  assertEqual(result.document.screen.marker, 'terminal');
  assertDeepEqual(result.document.screen.size, [320, 180]);
  assertEqual(result.document.screen.layer, 7);
  assert(!result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND'));
});

test('dynamic base alias failures remain bounded and use unresolved diagnostics', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/dynamic-failures.json': {
      namespace: 'dynamic',
      screen: {
        type: 'screen',
        '$cycle_a': '$cycle_b',
        '$cycle_b': '$cycle_a',
        '$non_string': 42,
        controls: [
          { 'cycle@$cycle_a': {} },
          { 'non_string@$non_string': {} },
          { 'missing@$missing': {} },
        ],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const result = resolveEffectiveUi({ catalog, recordId: catalog.records[0].id });
  assert(result.ok, result.error ? result.error.code : 'Expected fail-safe resolver success');
  const unresolved = result.diagnostics.filter((item) => item.code === 'UI_DYNAMIC_BASE_UNRESOLVED');
  assert(unresolved.some((item) => item.reason === 'VARIABLE_CYCLE'));
  assert(unresolved.some((item) => item.reason === 'VARIABLE_NON_STRING'));
  assert(unresolved.some((item) => item.reason === 'VARIABLE_UNDEFINED'));
  assert(!result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_TARGET_NOT_FOUND'));
});

test('dynamic base alias expansion obeys the inheritance depth limit', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/dynamic-depth.json': {
      namespace: 'dynamic',
      terminal: { type: 'panel' },
      screen: {
        type: 'screen',
        '$a': '$b',
        '$b': '$c',
        '$c': 'dynamic.terminal',
        controls: [{ 'bounded@$a': {} }],
      },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const record = catalog.records.find((item) => item.localName === 'screen');
  const result = resolveEffectiveUi({ catalog, recordId: record.id, limits: { maxInheritanceDepth: 2 } });
  assert(result.ok, result.error ? result.error.code : 'Expected fail-safe resolver success');
  assert(result.diagnostics.some((item) => (
    item.code === 'UI_DYNAMIC_BASE_UNRESOLVED' && item.reason === 'VARIABLE_DEPTH_LIMIT'
  )));
});

test('unbound dynamic bases remain visible as approximation diagnostics', async () => {
  const source = makeSource('imported', 'imported', 20, {
    'ui/unbound.json': {
      namespace: 'dynamic',
      screen: { type: 'panel', controls: [{ 'content@$runtime_template': {} }] },
    },
  });
  const catalog = await buildUiCatalog({ sources: [source], parseJsonc: parseJson });
  const result = resolveEffectiveUi({ catalog, recordId: catalog.records[0].id });
  assertEqual(result.ok, true);
  assert(result.diagnostics.some((item) => item.code === 'UI_DYNAMIC_BASE_UNRESOLVED'));
});

test('catalog cancellation is observed after an in-flight read', async () => {
  const controller = new AbortController();
  const source = {
    id: 'slow',
    kind: 'imported',
    precedence: 20,
    filePaths: ['ui/slow.json'],
    async readText() {
      controller.abort();
      return JSON.stringify({ namespace: 'slow', screen: { type: 'screen' } });
    },
  };
  const { assertThrows } = await import('./test-harness.js');
  await assertThrows(
    () => buildUiCatalog({ sources: [source], parseJsonc: parseJson, signal: controller.signal }),
    { predicate: (error) => error && error.message === 'UI_CATALOG_ABORTED' },
  );
});

test('assertThrows evaluates predicates instead of accepting any error', async () => {
  const { assertThrows } = await import('./test-harness.js');
  await assertThrows(() => { throw new Error('EXPECTED_CODE'); }, {
    predicate: (error) => error && error.message === 'EXPECTED_CODE',
  });
});

test('model preserves UV, nine-slice, alpha, and texture policy properties', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'visual',
    screen: {
      type: 'screen',
      controls: [{
        image: {
          type: 'image',
          texture: 'textures/ui/White',
          uv: [2, 3],
          uv_size: [12, 13],
          nineslice_size: 4,
          alpha: 0.5,
          keep_ratio: false,
        },
      }],
    },
  }, { filePath: 'ui/visual.json' });
  const image = model.root.children[0].children[0];
  assertDeepEqual(image.props.uv, [2, 3]);
  assertDeepEqual(image.props.uv_size, [12, 13]);
  assertEqual(image.props.nineslice_size, 4);
  assertEqual(image.props.alpha, 0.5);
  assertEqual(image.props.keep_ratio, false);
});

test('layout and hit testing honor higher authored layer', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'layers',
    root: {
      type: 'screen',
      controls: [
        { low: { type: 'panel', layer: 1, size: [100, 100], anchor_from: 'top_left', anchor_to: 'top_left' } },
        { high: { type: 'panel', layer: 9, size: [100, 100], anchor_from: 'top_left', anchor_to: 'top_left' } },
      ],
    },
  }, { filePath: 'ui/layers.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile({ rootId: tree.rootId, nodesById: tree.nodesById }, { width: 320, height: 180, name: 'test' });
  const low = layout.boxes.find((box) => String(box.id).endsWith('/low'));
  const high = layout.boxes.find((box) => String(box.id).endsWith('/high'));
  assert(low && high, 'Expected overlapping layer fixtures');
  assertEqual(low.layer, 1);
  assertEqual(high.layer, 9);
  const hit = hitTestBoxes(layout.boxes, 10, 10);
  assertEqual(hit.id, high.id);
});

test('hit testing follows painter order instead of preferring deeper nodes', () => {
  const boxes = [
    { id: 'deep-earlier', x: 0, y: 0, w: 100, h: 100, layer: 2, order: 10, depth: 4 },
    { id: 'shallow-later', x: 0, y: 0, w: 100, h: 100, layer: 2, order: 11, depth: 1 },
  ];
  assertEqual(hitTestBoxes(boxes, 20, 20).id, 'shallow-later');
});

test('canvas layout omits ignored subtrees and approximates propagate_alpha', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'visibility',
    root: {
      type: 'screen',
      controls: [
        {
          ignored_parent: {
            type: 'panel',
            ignored: true,
            controls: [{ ignored_child: { type: 'image', alpha: 0.2 } }],
          },
        },
        {
          propagated_parent: {
            type: 'panel',
            alpha: 0.5,
            propagate_alpha: true,
            controls: [
              {
                local_only_child: {
                  type: 'image',
                  alpha: 0.4,
                  propagate_alpha: false,
                  controls: [{ descendant: { type: 'label', alpha: 0.25 } }],
                },
              },
            ],
          },
        },
        {
          non_propagated_parent: {
            type: 'panel',
            alpha: 0.5,
            propagate_alpha: false,
            controls: [{ independent_child: { type: 'image', alpha: 0.4 } }],
          },
        },
      ],
    },
  }, { filePath: 'ui/visibility.json' });

  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(
    { rootId: tree.rootId, nodesById: tree.nodesById },
    { width: 320, height: 180, name: 'test' },
  );
  const find = (suffix) => layout.boxes.find((box) => String(box.id).endsWith(`/${suffix}`));

  assert(!find('ignored_parent'), 'ignored parent must not participate in layout or rendering');
  assert(!find('ignored_child'), 'ignored subtree descendants must not be traversed');
  assertEqual(find('propagated_parent').renderAlpha, 0.5);
  assertEqual(find('local_only_child').renderAlpha, 0.2);
  assertEqual(find('descendant').renderAlpha, 0.125);
  assertEqual(find('non_propagated_parent').renderAlpha, 0.5);
  assertEqual(find('independent_child').renderAlpha, 0.4);
});

test('safe preview hides unresolved visibility while structure preview can inspect it', () => {
  assertEqual(isVisibleFromProps({ visible: true }), true);
  assertEqual(isVisibleFromProps({ visible: 'true' }), true);
  assertEqual(isVisibleFromProps({ visible: false }), false);
  assertEqual(isVisibleFromProps({ visible: 'false' }), false);
  assertEqual(isVisibleFromProps({ visible: '#runtime_visible' }), false);
  assertEqual(isVisibleFromProps({ visible: '$runtime_visible' }), false);
  assertEqual(isVisibleFromProps({ ignored: '(not $runtime_flag)' }), false);
  assertEqual(isVisibleFromProps({ ignored: '(not $runtime_flag)' }, { mode: 'structure' }), true);
  assertEqual(isVisibleFromProps({ visible: '#runtime_visible' }, { mode: 'structure' }), true);

  const file = {
    rootId: 'root',
    nodesById: {
      root: {
        id: 'root',
        type: 'screen',
        props: {},
        children: ['unknown', 'literal_true', 'literal_false', 'factory', 'collection'],
      },
      unknown: {
        id: 'unknown',
        type: 'panel',
        props: { visible: '#runtime_visible' },
        children: [],
      },
      literal_true: {
        id: 'literal_true',
        type: 'panel',
        props: { visible: 'true' },
        children: [],
      },
      literal_false: {
        id: 'literal_false',
        type: 'panel',
        props: { visible: 'false' },
        children: [],
      },
      factory: {
        id: 'factory',
        type: 'factory',
        props: {},
        children: [],
      },
      collection: {
        id: 'collection',
        type: 'grid',
        props: { collection_name: 'runtime_items' },
        children: [],
      },
    },
  };

  const safe = computeLayoutBoxesForFile(file, { width: 320, height: 180, name: 'test' });
  const safeIds = safe.boxes.map((box) => box.id);
  assert(!safeIds.includes('unknown'), 'Safe preview must hide an unresolved runtime branch');
  assert(safeIds.includes('literal_true'), 'A literal true value must remain visible');
  assert(!safeIds.includes('literal_false'), 'A literal false value must remain hidden');
  assert(!safeIds.includes('factory'), 'Safe preview must not invent factory output without runtime data');
  assert(
    safeIds.includes('collection'),
    'Safe preview must preserve an authored collection prototype instead of blanking the whole subtree',
  );

  const mockResolved = computeLayoutBoxesForFile(file, { width: 320, height: 180, name: 'test' }, {
    propsByIdOverride: { unknown: { visible: true } },
  });
  assert(
    mockResolved.boxes.some((box) => box.id === 'unknown'),
    'A mock/binding override resolved to true must make the branch visible',
  );

  const structure = computeLayoutBoxesForFile(file, { width: 320, height: 180, name: 'test' }, {
    visibilityMode: 'structure',
  });
  assert(
    structure.boxes.some((box) => box.id === 'unknown'),
    'Structure preview must expose unresolved branches for inspection',
  );
  assert(structure.boxes.some((box) => box.id === 'factory'), 'Structure preview must expose factory position');
  assert(structure.boxes.some((box) => box.id === 'collection'), 'Structure preview must expose collection position');
});

test('grid layout renders children without throwing or blanking the preview', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'screen', props: {}, children: ['grid'] },
      grid: {
        id: 'grid',
        type: 'grid',
        props: { size: [180, 80], grid_dimensions: [2, 1] },
        children: ['left', 'right'],
      },
      left: { id: 'left', type: 'panel', props: { grid_position: [0, 0] }, children: [] },
      right: { id: 'right', type: 'panel', props: { grid_position: [1, 0] }, children: [] },
    },
  };

  const layout = computeLayoutBoxesForFile(file, { width: 320, height: 180, name: 'grid-regression' });
  const ids = layout.boxes.map((box) => box.id);
  assert(ids.includes('grid'), 'Grid box must be present');
  assert(ids.includes('left'), 'First grid child must be present');
  assert(ids.includes('right'), 'Second grid child must be present');
  assertEqual(layout.stats.truncated, false);
});

test('grid positions use column-row order and never relocate invalid authored cells', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'screen', props: {}, children: ['grid'] },
      grid: {
        id: 'grid', type: 'grid', props: { size: [100, 90], grid_dimensions: [2, 3] },
        children: ['valid', 'invalid', 'malformed'],
      },
      valid: { id: 'valid', type: 'panel', props: { size: [20, 10], grid_position: [1, 2] }, children: [] },
      invalid: { id: 'invalid', type: 'panel', props: { size: [20, 10], grid_position: [2, 0] }, children: [] },
      malformed: { id: 'malformed', type: 'panel', props: { size: [500, 10], grid_position: ['bad', 0] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 320, height: 180, name: 'grid-position-order' });
  assert(layout.boxes.some((box) => box.id === 'valid'));
  assert(!layout.boxes.some((box) => box.id === 'invalid'));
  assert(!layout.boxes.some((box) => box.id === 'malformed'));
  assert(layout.warnings.includes('GRID_POSITION_OUT_OF_BOUNDS:invalid'));
  assert(layout.warnings.includes('GRID_POSITION_INVALID:malformed'));
});

test('grids with omitted rescaling keep authored cell size instead of stretching it', () => {
  const file = {
    rootId: 'grid',
    nodesById: {
      grid: {
        id: 'grid', type: 'grid', props: { size: [200, 100], grid_dimensions: [2, 1] },
        children: ['cell'],
      },
      cell: { id: 'cell', type: 'panel', props: { size: [18, 18], grid_position: [0, 0] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 320, height: 180, name: 'grid-natural-cells' });
  const cell = layout.boxes.find((box) => box.id === 'cell');
  assertEqual(cell.w, 18);
  assertEqual(cell.h, 18);
});

test('explicit grid percentages use the grid box once and retain track placement', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'grid',
    nodesById: {
      grid: {
        id: 'grid',
        type: 'grid',
        props: { size: [108, 57], grid_dimensions: [1, 3] },
        children: ['a', 'b', 'c'],
      },
      a: {
        id: 'a',
        type: 'panel',
        props: { size: ['100%', '33.333333%'], grid_position: [0, 0], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: ['inner'],
      },
      inner: { id: 'inner', type: 'panel', props: { size: ['100%', '100%'], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: ['100%', '33.333333%'], grid_position: [0, 1], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
      c: { id: 'c', type: 'panel', props: { size: ['100%', '33.333333%'], grid_position: [0, 2], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  }, { width: 108, height: 57, name: 'grid-box-percent-once' });

  for (const [index, id] of ['a', 'b', 'c'].entries()) {
    const box = layout.boxes.find((item) => item.id === id);
    assert(Math.abs(box.x) < 0.0001);
    assert(Math.abs(box.y - index * 19) < 0.0001);
    assert(Math.abs(box.w - 108) < 0.0001);
    assert(Math.abs(box.h - 19) < 0.0001);
  }
  const inner = layout.boxes.find((box) => box.id === 'inner');
  assert(Math.abs(inner.w - 108) < 0.0001);
  assert(Math.abs(inner.h - 19) < 0.0001);
  assert(!layout.warnings.some((warning) => warning.startsWith('ALLOCATED_SUBTREE_CONTEXT_LIMIT')));
});

test('explicit grid percentage children may span multiple tracks', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: [500, 500], grid_dimensions: [5, 5] }, children: ['smithingA', 'smithingB'] },
      smithingA: {
        id: 'smithingA',
        type: 'panel',
        props: { size: ['20%', '60%'], grid_position: [0, 1], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: [],
      },
      smithingB: {
        id: 'smithingB',
        type: 'panel',
        props: { size: ['40%', '60%'], grid_position: [3, 1], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: [],
      },
    },
  }, { width: 500, height: 500, name: 'smithing-grid-percent-spans' });

  assertDeepEqual(
    ['smithingA', 'smithingB'].map((id) => {
      const box = layout.boxes.find((item) => item.id === id);
      return [box.x, box.y, box.w, box.h];
    }),
    [[0, 100, 100, 300], [300, 100, 200, 300]],
  );
});

test('explicit grid omitted axes use the track basis', () => {
  const omittedIds = ['omittedA', 'omittedB', 'omittedC'];
  const layout = computeLayoutBoxesForFile({
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: [54, 18], grid_dimensions: [3, 1] }, children: omittedIds },
      ...Object.fromEntries(omittedIds.map((id, index) => [id, {
        id,
        type: 'panel',
        props: { grid_position: [index, 0], anchor_from: 'top_left', anchor_to: 'top_left' },
        propsPresent: { size: false },
        children: [],
      }])),
    },
  }, { width: 54, height: 18, name: 'grid-track-default-fill' });

  for (const id of omittedIds) {
    const box = layout.boxes.find((item) => item.id === id);
    assertDeepEqual([box.w, box.h], [18, 18]);
  }
});

test('explicit grid percent min and max constraints use the grid box basis', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: [500, 500], grid_dimensions: [5, 5] }, children: ['constrained'] },
      constrained: {
        id: 'constrained',
        type: 'panel',
        props: {
          size: ['fill', 'fill'],
          min_size: ['20%', 0],
          max_size: [500, '10%'],
          grid_position: [0, 0],
          anchor_from: 'top_left',
          anchor_to: 'top_left',
        },
        children: [],
      },
    },
  }, { width: 500, height: 500, name: 'grid-percent-constraints' });

  const constrained = layout.boxes.find((box) => box.id === 'constrained');
  assertDeepEqual([constrained.w, constrained.h], [100, 50]);
});

test('raw runtime visibility is preserved by the model tree and hidden safely', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'runtime',
    screen: {
      type: 'screen',
      controls: [{ conditional: { type: 'panel', visible: '#runtime_visible' } }],
    },
  }, { filePath: 'ui/runtime.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const conditional = Object.values(tree.nodesById).find((node) => node.props?.name === 'conditional');
  assert(conditional, 'Expected conditional node');
  assertEqual(conditional.props.visible, '#runtime_visible');

  const safe = computeLayoutBoxesForFile(tree, { width: 320, height: 180, name: 'runtime' });
  assert(!safe.boxes.some((box) => box.id === conditional.id));
  const structure = computeLayoutBoxesForFile(tree, { width: 320, height: 180, name: 'runtime' }, { visibilityMode: 'structure' });
  assert(structure.boxes.some((box) => box.id === conditional.id));
});

test('input_panel defaults to its parent size instead of a 120 by 80 fallback', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'screen', props: {}, children: ['input'] },
      input: { id: 'input', type: 'input_panel', props: {}, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 640, height: 360, name: 'input-panel' });
  const box = layout.boxes.find((item) => item.id === 'input');
  assert(box, 'Expected input_panel layout box');
  assertEqual(box.w, 640);
  assertEqual(box.h, 360);
});

test('clips_children propagates an intersected ancestor clip into layout and hit testing', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'screen', props: {}, children: ['outer'] },
      outer: {
        id: 'outer',
        type: 'panel',
        props: { offset: [10, 10], size: [100, 100], clips_children: true },
        children: ['inner'],
      },
      inner: {
        id: 'inner',
        type: 'panel',
        props: { offset: [80, 0], size: [80, 80] },
        children: [],
      },
    },
  };

  const layout = computeLayoutBoxesForFile(file, { width: 320, height: 180, name: 'clip-ancestor' });
  const inner = layout.boxes.find((box) => box.id === 'inner');
  assert(inner, 'Expected clipped descendant box');
  assertDeepEqual(inner.clipRect, { x: 10, y: 10, w: 100, h: 100 });
  assertEqual(hitTestBoxes(layout.boxes, 100, 40).id, 'inner');
  assert(hitTestBoxes(layout.boxes, 140, 40)?.id !== 'inner', 'Clipped-away geometry must not be selectable');
  const handles = getResizeHandlesForBox(inner, { zoom: 1, viewX: 0, viewY: 0 });
  assert(hitTestResizeHandles(handles, 90, 10), 'A visible resize handle must remain selectable');
  assertEqual(hitTestResizeHandles(handles, 170, 10), null);
});

test('allow_clipping false exempts a node and descendants from a parent clips_children boundary', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'screen', props: {}, children: ['outer'] },
      outer: {
        id: 'outer',
        type: 'panel',
        props: { offset: [10, 10], size: [100, 100], clips_children: true },
        children: ['escaped'],
      },
      escaped: {
        id: 'escaped',
        type: 'panel',
        props: { offset: [80, 0], size: [100, 80], allow_clipping: false },
        children: ['escaped-child'],
      },
      'escaped-child': {
        id: 'escaped-child',
        type: 'panel',
        props: { offset: [40, 0], size: [40, 40] },
        children: [],
      },
    },
  };

  const layout = computeLayoutBoxesForFile(file, { width: 320, height: 180, name: 'allow-clipping-parent' });
  const escaped = layout.boxes.find((box) => box.id === 'escaped');
  const escapedChild = layout.boxes.find((box) => box.id === 'escaped-child');
  assert(escaped && escapedChild, 'Expected escaped subtree boxes');
  assertEqual(escaped.clipRect, null);
  assertEqual(escapedChild.clipRect, null);
  assertEqual(hitTestBoxes(layout.boxes, 140, 30).id, 'escaped-child');
});

test('scroll_view clips only its content subtree to the viewport for layout and hit testing', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'screen', props: {}, children: ['scroll'] },
      scroll: {
        id: 'scroll',
        type: 'scroll_view',
        props: { offset: [20, 10], size: [100, 80], scroll_content: 'content' },
        children: ['content'],
      },
      content: {
        id: 'content',
        type: 'panel',
        props: { name: 'content', size: [220, 120] },
        children: [],
      },
    },
  };

  const layout = computeLayoutBoxesForFile(
    file,
    { width: 320, height: 180, name: 'scroll-clip' },
    { scrollById: { scroll: { x: 40, y: 0 } } },
  );
  const content = layout.boxes.find((box) => box.id === 'content');
  assert(content, 'Expected scroll content box');
  assertDeepEqual(content.clipRect, { x: 20, y: 10, w: 100, h: 80 });
  assertEqual(hitTestBoxes(layout.boxes, 30, 30).id, 'content');
  assert(hitTestBoxes(layout.boxes, 130, 30)?.id !== 'content', 'Content outside the viewport must not be selectable');
  assertEqual(layout.scrollMetaById.scroll.maxScrollX, 120);
});

test('allow_clipping false exempts scroll content and descendants from the viewport clip', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'screen', props: {}, children: ['scroll'] },
      scroll: {
        id: 'scroll',
        type: 'scroll_view',
        props: { offset: [20, 10], size: [100, 80], scroll_content: 'content' },
        children: ['content'],
      },
      content: {
        id: 'content',
        type: 'panel',
        props: { name: 'content', size: [220, 120], allow_clipping: false },
        children: ['escaped-child'],
      },
      'escaped-child': {
        id: 'escaped-child',
        type: 'panel',
        props: { offset: [150, 0], size: [30, 30] },
        children: [],
      },
    },
  };

  const layout = computeLayoutBoxesForFile(
    file,
    { width: 320, height: 180, name: 'allow-clipping-scroll' },
    { scrollById: { scroll: { x: 40, y: 0 } } },
  );
  const content = layout.boxes.find((box) => box.id === 'content');
  const escapedChild = layout.boxes.find((box) => box.id === 'escaped-child');
  assert(content && escapedChild, 'Expected unclipped scroll subtree boxes');
  assertEqual(content.clipRect, null);
  assertEqual(escapedChild.clipRect, null);
  assertEqual(hitTestBoxes(layout.boxes, 140, 20).id, 'escaped-child');
});

test('canvas drawing applies the same layout clip used by hit testing', () => {
  const clipCalls = [];
  const context = {
    setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {}, setLineDash() {},
    save() {}, restore() {}, beginPath() {},
    rect(x, y, w, h) { this.lastRect = { x, y, w, h }; },
    clip() { clipCalls.push(this.lastRect); },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; },
    getBoundingClientRect() { return { width: 320, height: 180 }; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    drawCanvasPreview(
      canvas,
      {
        preset: { width: 320, height: 180, name: 'draw-clip' },
        boxes: [{
          id: 'child', type: 'panel', x: 80, y: 0, w: 80, h: 80,
          depth: 1, parentId: 'parent', layer: 0, order: 0, renderAlpha: 1,
          clipRect: { x: 10, y: 10, w: 100, h: 100 },
        }],
        stats: { totalNodes: 1, renderedBoxes: 1, boxCount: 1, truncated: false, maxBoxes: 10 },
        warnings: [],
        scrollMetaById: {},
      },
      { zoom: 1, viewX: 0, viewY: 0 },
      { showScreenBoundary: false },
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assertDeepEqual(clipCalls, [
    { x: 0, y: 0, w: 320, h: 180 },
    { x: 10, y: 10, w: 100, h: 100 },
  ]);
});

test('canvas drawing paints authored label newlines as separate aligned lines', () => {
  const painted = [];
  const context = {
    setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {}, setLineDash() {},
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    measureText(value) { return { width: String(value).length * 5 }; },
    fillText(value, x, y) { painted.push({ value, x, y }); },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; },
    getBoundingClientRect() { return { width: 320, height: 180 }; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    drawCanvasPreview(
      canvas,
      {
        preset: { width: 320, height: 180, name: 'multiline-label' },
        boxes: [{
          id: 'label', type: 'label', x: 20, y: 30, w: 100, h: 40,
          depth: 0, parentId: null, layer: 0, order: 0, renderAlpha: 1, clipRect: null,
        }],
        stats: { totalNodes: 1, renderedBoxes: 1, boxCount: 1, truncated: false, maxBoxes: 10 },
        warnings: [],
        scrollMetaById: {},
      },
      { zoom: 1, viewX: 0, viewY: 0 },
      {
        showScreenBoundary: false,
        showGuides: false,
        textDrawById: {
          label: {
            text: 'First\nSecond', fontFamily: 'fixture-loaded-face', fontPx: 10,
            fontBackend: 'resource-font-face', state: 'ready',
            align: 'left', verticalAlign: 'top', color: '#fff', alpha: 1,
          },
        },
      },
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  assertDeepEqual(painted, [
    { value: 'First', x: 20, y: 35 },
    { value: 'Second', x: 20, y: 45 },
  ]);
});

test('canvas drawing preserves full text and fractional font size inside a narrow clip', () => {
  const painted = [];
  const clipped = [];
  const context = {
    font: '',
    setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {}, setLineDash() {},
    save() {}, restore() {}, beginPath() {},
    rect(x, y, w, h) { this.lastRect = { x, y, w, h }; },
    clip() { clipped.push(this.lastRect); },
    measureText() { return { width: 500 }; },
    fillText(value) { painted.push({ value, font: this.font }); },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; },
    getBoundingClientRect() { return { width: 320, height: 180 }; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    drawCanvasPreview(
      canvas,
      {
        preset: { width: 320, height: 180, name: 'full-furnace-title' },
        boxes: [{
          id: 'title', type: 'label', x: 20, y: 30, w: 8, h: 10,
          depth: 0, parentId: null, layer: 0, order: 0, renderAlpha: 1, clipRect: null,
        }],
        stats: { totalNodes: 1, renderedBoxes: 1, boxCount: 1, truncated: false, maxBoxes: 10 },
        warnings: [],
        scrollMetaById: {},
      },
      { zoom: 1, viewX: 0, viewY: 0 },
      {
        showScreenBoundary: false,
        showGuides: false,
        textDrawById: {
          title: {
            text: 'かまど', fontFamily: 'fixture-loaded-face', fontPx: 23.52,
            fontBackend: 'resource-font-face', state: 'ready',
            align: 'left', verticalAlign: 'center', color: '#fff', alpha: 1,
          },
        },
      },
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  assertDeepEqual(painted, [{ value: 'かまど', font: '23.52px "fixture-loaded-face"' }]);
  assert(clipped.some((rect) => rect && rect.x === 20 && rect.y === 30 && rect.w === 8 && rect.h === 10));
});

test('hit testing rejects geometry outside the logical device viewport', () => {
  const boxes = [{
    id: 'outside', type: 'panel', x: 330, y: 10, w: 30, h: 30,
    depth: 1, parentId: null, layer: 0, order: 0,
  }];
  assertEqual(hitTestBoxes(boxes, 340, 20)?.id, 'outside');
  assertEqual(hitTestBoxes(boxes, 340, 20, { width: 320, height: 180 }), null);

  const handles = [{ kind: 'se', x: 335, y: 15, w: 10, h: 10, clipRect: null }];
  assertEqual(hitTestResizeHandles(handles, 340, 20)?.kind, 'se');
  assertEqual(hitTestResizeHandles(handles, 340, 20, { width: 320, height: 180 }), null);
});

test('explicit UI-fit bounds use drawable geometry and never resource-pack names', () => {
  const layout = {
    preset: { width: 320, height: 180 },
    boxes: [
      { id: 'background', type: 'image', x: 0, y: 0, w: 320, h: 180, renderAlpha: 1 },
      { id: 'icon', type: 'image', x: 100, y: 40, w: 40, h: 30, renderAlpha: 1 },
      { id: 'title', type: 'label', x: 90, y: 25, w: 80, h: 10, renderAlpha: 1 },
      { id: 'offscreen', type: 'image', x: 400, y: 10, w: 20, h: 20, renderAlpha: 1 },
    ],
  };
  const makeNodes = (backgroundTexture, iconTexture) => ({
    background: { id: 'background', type: 'image', props: { texture: backgroundTexture }, children: [] },
    icon: { id: 'icon', type: 'image', props: { texture: iconTexture }, children: [] },
    title: { id: 'title', type: 'label', props: { text: 'Inventory' }, children: [] },
    offscreen: { id: 'offscreen', type: 'image', props: { texture: 'textures/ui/offscreen' }, children: [] },
  });
  const resolvable = (value) => !String(value).includes('background') && !String(value).includes('offscreen');
  const first = findDrawableCanvasBounds({
    layout,
    nodesById: makeNodes('textures/ui/background_a', 'textures/pack_a/icon'),
    isTextureResolvable: resolvable,
  });
  const renamed = findDrawableCanvasBounds({
    layout,
    nodesById: makeNodes('textures/ui/background_b', 'textures/another_pack/arbitrary_name'),
    isTextureResolvable: resolvable,
  });
  assertDeepEqual(first, { x: 90, y: 25, w: 80, h: 45 });
  assertDeepEqual(renamed, first);

  const fullScreenOnly = findDrawableCanvasBounds({
    layout: { ...layout, boxes: [layout.boxes[0]] },
    nodesById: makeNodes('textures/ui/fullscreen', 'textures/ui/unused'),
    isTextureResolvable: () => true,
  });
  assertEqual(fullScreenOnly, null);

  const clipped = findDrawableCanvasBounds({
    layout: {
      preset: { width: 320, height: 180 },
      boxes: [{ id: 'progress', type: 'image', x: 20, y: 30, w: 100, h: 20, renderAlpha: 1 }],
    },
    nodesById: {
      progress: {
        id: 'progress', type: 'image',
        props: { texture: 'textures/ui/progress', clip_ratio: 0.25, clip_direction: 'right' },
        children: [],
      },
    },
    isTextureResolvable: () => true,
  });
  assertDeepEqual(clipped, { x: 95, y: 30, w: 25, h: 20 });
});

test('native custom surrogates participate in drawable count, empty state, and UI-fit bounds', () => {
  const layout = {
    preset: { width: 100, height: 100 },
    boxes: [
      { id: 'item', type: 'custom', x: 10, y: 20, w: 18, h: 18, renderAlpha: 1 },
      { id: 'banner', type: 'custom', x: 50, y: 30, w: 20, h: 40, renderAlpha: 1 },
      { id: 'future', type: 'custom', x: 80, y: 80, w: 10, h: 10, renderAlpha: 1 },
    ],
  };
  const nodesById = {
    item: { type: 'custom', unknownProps: { renderer: 'inventory_item_renderer' }, props: {} },
    banner: { type: 'custom', props: { renderer: 'banner_pattern_renderer' } },
    future: { type: 'custom', props: { renderer: 'future_native_renderer' } },
  };
  const isCustomDrawable = (props) => (
    props.renderer === 'inventory_item_renderer' || props.renderer === 'banner_pattern_renderer'
  );

  const drawableBoxes = countDrawableCanvasBoxes({
    boxes: layout.boxes,
    nodesById,
    isCustomDrawable,
  });
  assertEqual(drawableBoxes, 2);
  assertEqual(shouldShowCanvasEmptyState({
    hasPreviewFile: true,
    hasLayoutError: false,
    renderedBoxes: layout.boxes.length,
    drawableBoxes,
  }), false);
  assertDeepEqual(findDrawableCanvasBounds({ layout, nodesById, isCustomDrawable }), {
    x: 10, y: 20, w: 60, h: 50,
  });

  const unknownOnly = { ...layout, boxes: [layout.boxes[2]] };
  const unknownCount = countDrawableCanvasBoxes({
    boxes: unknownOnly.boxes,
    nodesById,
    isCustomDrawable,
  });
  assertEqual(unknownCount, 0);
  assertEqual(shouldShowCanvasEmptyState({
    hasPreviewFile: true,
    hasLayoutError: false,
    renderedBoxes: 1,
    drawableBoxes: unknownCount,
  }), true);
  assertEqual(findDrawableCanvasBounds({ layout: unknownOnly, nodesById, isCustomDrawable }), null);
});

test('a failing decoded texture is isolated without leaking canvas state', () => {
  let depth = 0;
  const context = {
    setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {}, setLineDash() {},
    save() { depth += 1; },
    restore() { depth -= 1; },
    beginPath() {}, rect() {}, clip() {},
    drawImage() { throw new Error('detached image'); },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; },
    getBoundingClientRect() { return { width: 320, height: 180 }; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    drawCanvasPreview(
      canvas,
      {
        preset: { width: 320, height: 180, name: 'broken-texture' },
        boxes: [{
          id: 'broken', type: 'image', x: 0, y: 0, w: 16, h: 16,
          depth: 0, parentId: null, layer: 0, order: 0, renderAlpha: 1, clipRect: null,
        }],
        stats: { totalNodes: 1, renderedBoxes: 1, boxCount: 1, truncated: false, maxBoxes: 10 },
        warnings: [],
        scrollMetaById: {},
      },
      { zoom: 1, viewX: 0, viewY: 0 },
      {
        showScreenBoundary: false,
        showGuides: false,
        imageDrawById: {
          broken: { state: 'ready', image: { width: 16, height: 16 }, width: 16, height: 16, keepRatio: false },
        },
      },
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assertEqual(depth, 0);
});

test('a failing native scene draw falls back visibly and cannot abort the frame', () => {
  const fills = [];
  let depth = 0;
  const context = {
    setTransform() {}, clearRect() {}, strokeRect() {}, setLineDash() {},
    save() { depth += 1; }, restore() { depth -= 1; }, beginPath() {}, rect() {}, clip() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {},
    fillRect(x, y, w, h) { fills.push({ x, y, w, h }); },
    transform() { throw new Error('native transform unavailable'); },
    drawImage() {},
  };
  const canvas = {
    width: 0, height: 0,
    getContext() { return context; },
    getBoundingClientRect() { return { width: 160, height: 100 }; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    drawCanvasPreview(
      canvas,
      {
        preset: { width: 160, height: 100, name: 'native-failure' },
        boxes: [{
          id: 'horse', type: 'custom', x: 20, y: 20, w: 40, h: 40,
          depth: 0, parentId: null, layer: 0, order: 0, renderAlpha: 1, clipRect: null,
        }],
        stats: { totalNodes: 1, renderedBoxes: 1, boxCount: 1, truncated: false, maxBoxes: 10 },
        warnings: [], scrollMetaById: {},
      },
      { zoom: 1, viewX: 0, viewY: 0 },
      {
        showScreenBoundary: false,
        showGuides: false,
        imageDrawById: {
          horse: {
            state: 'native-scene', image: { width: 64, height: 64 }, width: 64, height: 64,
            placeholderKind: 'horse-entity', alpha: 1,
            nativeScene: {
              kind: 'horse',
              faces: [{
                points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
                uv: { x: 0, y: 0, w: 1, h: 1 }, shade: Symbol('invalid shade'), texture: true,
              }],
            },
          },
        },
      },
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assertEqual(depth, 0);
  const fallback = fills.find((rect) => rect.x > 20 && rect.y > 20 && rect.x + rect.w < 60 && rect.y + rect.h < 60);
  assert(fallback, 'Expected a bounded visible fallback after native draw failure');
});

test('multi-layer native scenes compose offscreen and apply element alpha once', () => {
  const mainDrawAlphas = [];
  const scratchDrawAlphas = [];
  let depth = 0;
  const makeContext = (drawAlphas) => ({
    globalAlpha: 1,
    setTransform() {}, clearRect() {}, strokeRect() {}, setLineDash() {},
    save() { depth += 1; }, restore() { depth -= 1; }, beginPath() {}, rect() {}, clip() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, fillRect() {},
    transform() {}, drawImage() { drawAlphas.push(this.globalAlpha); },
  });
  const mainContext = makeContext(mainDrawAlphas);
  const scratchContext = makeContext(scratchDrawAlphas);
  const canvas = {
    width: 0, height: 0, getContext() { return mainContext; },
    getBoundingClientRect() { return { width: 100, height: 100 }; },
  };
  const previousWindow = globalThis.window;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return scratchContext; }
  };
  try {
    drawCanvasPreview(
      canvas,
      {
        preset: { width: 100, height: 100, name: 'native-alpha' },
        boxes: [{ id: 'horse', type: 'custom', x: 25, y: 25, w: 20, h: 20,
          depth: 0, parentId: null, layer: 0, order: 0, renderAlpha: 0.5, clipRect: null }],
        stats: { totalNodes: 1, renderedBoxes: 1, boxCount: 1, truncated: false, maxBoxes: 10 },
        warnings: [], scrollMetaById: {},
      },
      { zoom: 1, viewX: 0, viewY: 0 },
      { showScreenBoundary: false, showGuides: false, imageDrawById: { horse: {
        state: 'native-scene', image: { width: 1, height: 1 }, width: 1, height: 1, alpha: 0.5,
        imageLayers: [0, 1, 2].map(() => ({ image: {}, width: 1, height: 1 })),
        nativeScene: { kind: 'horse', faces: [{
          points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
          uv: { x: 0, y: 0, w: 1, h: 1 }, shade: 1, texture: true,
        }] },
      } } },
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
  assertEqual(depth, 0);
  assertDeepEqual(scratchDrawAlphas, [1, 1, 1]);
  assertDeepEqual(mainDrawAlphas, [0.5]);
});

test('a failed later native texture layer never commits earlier model pixels', () => {
  let mainDraws = 0;
  let scratchDraws = 0;
  const fills = [];
  const baseContext = {
    globalAlpha: 1, setTransform() {}, clearRect() {}, strokeRect() {}, setLineDash() {},
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {},
    closePath() {}, stroke() {}, fill() {}, transform() {},
  };
  const mainContext = { ...baseContext, fillRect(...args) { fills.push(args); }, drawImage() { mainDraws += 1; } };
  const scratchContext = { ...baseContext, fillRect() {}, drawImage() {
    scratchDraws += 1;
    if (scratchDraws === 2) throw new Error('second layer failed');
  } };
  const canvas = { width: 0, height: 0, getContext() { return mainContext; }, getBoundingClientRect() { return { width: 80, height: 80 }; } };
  const previousWindow = globalThis.window;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.OffscreenCanvas = class { getContext() { return scratchContext; } };
  try {
    drawCanvasPreview(canvas, {
      preset: { width: 80, height: 80, name: 'native-atomic' },
      boxes: [{ id: 'horse', type: 'custom', x: 20, y: 20, w: 20, h: 20,
        depth: 0, parentId: null, layer: 0, order: 0, renderAlpha: 1, clipRect: null }],
      stats: { totalNodes: 1, renderedBoxes: 1, boxCount: 1, truncated: false, maxBoxes: 10 }, warnings: [], scrollMetaById: {},
    }, { zoom: 1, viewX: 0, viewY: 0 }, { showScreenBoundary: false, showGuides: false, imageDrawById: { horse: {
      state: 'native-scene', image: {}, width: 1, height: 1,
      imageLayers: [{ image: {}, width: 1, height: 1 }, { image: {}, width: 1, height: 1 }],
      nativeScene: { kind: 'horse', faces: [{ points: [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      ], uv: { x: 0, y: 0, w: 1, h: 1 }, shade: 1, texture: true }] },
    } } });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
  assertEqual(scratchDraws, 2);
  assertEqual(mainDraws, 0);
  assert(fills.length > 0, 'Expected the neutral fallback after atomic model failure');
});

test('native scenes share one bounded per-frame control budget', () => {
  const issues = [];
  let depth = 0;
  const context = {
    setTransform() {}, clearRect() {}, strokeRect() {}, setLineDash() {},
    save() { depth += 1; }, restore() { depth -= 1; }, beginPath() {}, rect() {}, clip() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, fillRect() {},
    transform() {}, drawImage() {},
  };
  const boxes = Array.from({ length: 129 }, (_, index) => ({
    id: `native-${index}`, type: 'custom', x: 5, y: 5, w: 4, h: 4,
    depth: 0, parentId: null, layer: 0, order: index, renderAlpha: 1, clipRect: null,
  }));
  const face = {
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    uv: { x: 0, y: 0, w: 1, h: 1 }, shade: 1, texture: true,
  };
  const imageDrawById = Object.fromEntries(boxes.map((box) => [box.id, {
    state: 'native-scene', image: { width: 1, height: 1 }, width: 1, height: 1,
    alpha: 1, nativeScene: { kind: 'book', faces: [face] },
  }]));
  const canvas = {
    width: 0, height: 0, getContext() { return context; },
    getBoundingClientRect() { return { width: 40, height: 40 }; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    drawCanvasPreview(
      canvas,
      {
        preset: { width: 40, height: 40, name: 'native-budget' }, boxes,
        stats: { totalNodes: boxes.length, renderedBoxes: boxes.length, boxCount: boxes.length, truncated: false, maxBoxes: 5000 },
        warnings: [], scrollMetaById: {},
      },
      { zoom: 1, viewX: 0, viewY: 0 },
      {
        showScreenBoundary: false, showGuides: false, imageDrawById,
        onNativeSceneIssue(issue) { issues.push(issue); },
      },
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assertEqual(depth, 0);
  assertDeepEqual(issues.map((issue) => issue.code), ['NATIVE_PREVIEW_FRAME_BUDGET_EXCEEDED']);
});

test('one oversized native scene is rejected before synchronous face drawing', () => {
  const issues = [];
  let transforms = 0;
  const context = {
    setTransform() {}, clearRect() {}, strokeRect() {}, setLineDash() {},
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, fillRect() {},
    transform() { transforms += 1; }, drawImage() {},
  };
  const face = {
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    uv: { x: 0, y: 0, w: 1, h: 1 }, shade: 1, texture: true,
  };
  const canvas = {
    width: 0, height: 0, getContext() { return context; },
    getBoundingClientRect() { return { width: 80, height: 80 }; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    drawCanvasPreview(canvas, {
      preset: { width: 80, height: 80, name: 'native-scene-budget' },
      boxes: [{ id: 'hostile', type: 'custom', x: 20, y: 20, w: 20, h: 20,
        depth: 0, parentId: null, layer: 0, order: 0, renderAlpha: 1, clipRect: null }],
      stats: { totalNodes: 1, renderedBoxes: 1, boxCount: 1, truncated: false, maxBoxes: 10 },
      warnings: [], scrollMetaById: {},
    }, { zoom: 1, viewX: 0, viewY: 0 }, {
      showScreenBoundary: false,
      showGuides: false,
      imageDrawById: {
        hostile: {
          state: 'native-scene', image: { width: 1, height: 1 }, width: 1, height: 1,
          alpha: 1, nativeScene: { kind: 'horse', faces: Array(2049).fill(face) },
        },
      },
      onNativeSceneIssue(issue) { issues.push(issue); },
    });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assertEqual(transforms, 0);
  assertDeepEqual(issues.map((issue) => issue.code), ['NATIVE_PREVIEW_FRAME_BUDGET_EXCEEDED']);
});

test('canvas draws only the explicitly diagnosed banner surrogate, never fake book or horse models', () => {
  const fills = [];
  const context = {
    setTransform() {}, clearRect() {}, strokeRect() {}, setLineDash() {},
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect(x, y, w, h) { fills.push({ x, y, w, h }); },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; },
    getBoundingClientRect() { return { width: 320, height: 180 }; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    drawCanvasPreview(
      canvas,
      {
        preset: { width: 320, height: 180, name: 'native-live-placeholders' },
        boxes: [
          { id: 'banner', type: 'custom', x: 20, y: 30, w: 20, h: 40, depth: 0, parentId: null, layer: 0, order: 0, renderAlpha: 1, clipRect: null },
          { id: 'book', type: 'custom', x: 80, y: 20, w: 40, h: 40, depth: 0, parentId: null, layer: 0, order: 1, renderAlpha: 1, clipRect: null },
          { id: 'horse', type: 'custom', x: 150, y: 30, w: 60, h: 60, depth: 0, parentId: null, layer: 0, order: 2, renderAlpha: 1, clipRect: null },
          { id: 'unknown', type: 'custom', x: 240, y: 30, w: 20, h: 40, depth: 0, parentId: null, layer: 0, order: 3, renderAlpha: 1, clipRect: null },
        ],
        stats: { totalNodes: 4, renderedBoxes: 4, boxCount: 4, truncated: false, maxBoxes: 10 },
        warnings: [], scrollMetaById: {},
      },
      { zoom: 1, viewX: 0, viewY: 0 },
      {
        showScreenBoundary: false,
        showGuides: false,
        imageDrawById: {
          banner: {
            state: 'native-placeholder', placeholderKind: 'banner-pattern', alpha: 1,
            bannerPatternIndex: 17, bannerColorIndex: 4,
          },
          book: { state: 'native-placeholder', placeholderKind: 'enchanting-book', alpha: 1 },
          horse: { state: 'native-placeholder', placeholderKind: 'horse-entity', alpha: 1 },
          unknown: { state: 'native-placeholder', placeholderKind: 'future-renderer', alpha: 1 },
        },
      },
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  // Ignore the canvas background and ensure every surrogate remains bounded.
  const drawn = fills.slice(1);
  const inside = (rect, box) => (
    rect.x >= box.x && rect.y >= box.y
    && rect.x + rect.w <= box.x + box.w
    && rect.y + rect.h <= box.y + box.h
  );
  const bannerBox = { x: 20, y: 30, w: 20, h: 40 };
  const bannerRects = drawn.filter((rect) => inside(rect, bannerBox));
  assert(bannerRects.length >= 1 && bannerRects.length <= 3, 'An undocumented pattern must retain only its neutral bounded silhouette');
  assert(drawn.every((rect) => inside(rect, bannerBox)));
});

test('model round-tripping preserves prototype-named controls and properties without pollution', () => {
  const source = JSON.parse(`{
    "namespace":"prototype_keys",
    "__proto__":{"type":"panel","marker":"top"},
    "screen":{
      "type":"panel",
      "__proto__":{"polluted":true},
      "controls":{"__proto__":{"type":"label","text":"safe"}}
    }
  }`);
  const model = buildUiScreenModelFromJson(source, { filePath: 'ui/prototype-keys.json' });
  const output = uiScreenModelToJson(model);
  assert(Object.prototype.hasOwnProperty.call(output, '__proto__'));
  assertEqual(output.__proto__.marker, 'top');
  assert(Object.prototype.hasOwnProperty.call(output.screen, '__proto__'));
  assertEqual(output.screen.__proto__.polluted, true);
  assert(Object.prototype.hasOwnProperty.call(output.screen.controls, '__proto__'));
  assertEqual(output.screen.controls.__proto__.text, 'safe');
  assertEqual({}.polluted, undefined);
});

test('structural panel default and omitted axes inherit the parent extent', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'default_boundary',
    screen: {
      type: 'screen', size: [120, 80], anchor_from: 'top_left', anchor_to: 'top_left',
      controls: [
        { explicit: { type: 'panel', size: ['default', 'default'], anchor_from: 'top_left', anchor_to: 'top_left', controls: [{ leaf: { type: 'panel', size: [30, 20] } }] } },
        { omitted: { type: 'panel', offset: [60, 0], anchor_from: 'top_left', anchor_to: 'top_left', controls: [{ other: { type: 'panel', size: [40, 25] } }] } },
      ],
    },
  }, { filePath: 'ui/default-boundary.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 120, height: 80, name: 'default-boundary' });
  const byName = (name) => {
    const node = Object.values(tree.nodesById).find((item) => item.props?.name === name);
    return layout.boxes.find((box) => box.id === node.id);
  };
  assertDeepEqual([byName('explicit').w, byName('explicit').h], [120, 80]);
  assertDeepEqual([byName('omitted').w, byName('omitted').h], [120, 80]);
});

test('workbench structural panels preserve the authored input arrow and output offsets', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'workbench_geometry',
    crafting_panel: {
      type: 'panel', size: [176, 83], anchor_from: 'top_left', anchor_to: 'top_left',
      controls: [{
        work_bench: {
          type: 'panel', offset: [29, 0], anchor_from: 'top_left', anchor_to: 'top_left',
          controls: [
            { arrow: { type: 'image', size: [22, 15], offset: [61, 35.5], anchor_from: 'top_left', anchor_to: 'top_left' } },
            {
              input_with_label: {
                type: 'panel', size: ['default', 65], offset: [0, 5], anchor_from: 'top_middle', anchor_to: 'top_middle',
                controls: [{ input: { type: 'grid', size: [54, 54], grid_dimensions: [3, 3], offset: [0, 11], anchor_from: 'top_left', anchor_to: 'top_left' } }],
              },
            },
            { output: { type: 'grid', size: [26, 26], grid_dimensions: [1, 1], offset: [94, 30], anchor_from: 'top_left', anchor_to: 'top_left' } },
          ],
        },
      }],
    },
  }, { filePath: 'ui/workbench-geometry.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 176, height: 83, name: 'workbench-geometry' });
  const byName = (name) => {
    const node = Object.values(tree.nodesById).find((item) => item.props?.name === name);
    return layout.boxes.find((box) => box.id === node.id);
  };
  assertDeepEqual([byName('work_bench').x, byName('work_bench').w], [29, 176]);
  assertDeepEqual([byName('input_with_label').x, byName('input_with_label').w], [29, 176]);
  assertDeepEqual([byName('input').x, byName('input').y, byName('input').w, byName('input').h], [29, 16, 54, 54]);
  assertDeepEqual([byName('arrow').x, byName('arrow').y, byName('arrow').w, byName('arrow').h], [90, 35.5, 22, 15]);
  assertDeepEqual([byName('output').x, byName('output').y, byName('output').w, byName('output').h], [123, 30, 26, 26]);
});

test('non-stack percent-content sum and maximum remain distinct and ignore inactive children', () => {
  const makeFile = (axis, dimension = 'height') => ({
    rootId: 'host',
    nodesById: {
      host: {
        id: 'host',
        type: 'image',
        props: { size: dimension === 'width' ? [`100%${axis} + 7px`, 26] : [26, `100%${axis} + 7px`] },
        children: ['close', 'help', 'hidden', 'ignored'],
      },
      close: { id: 'close', type: 'button', props: { size: [21, 21] }, children: [] },
      help: { id: 'help', type: 'button', props: { size: [15, 15] }, children: [] },
      hidden: { id: 'hidden', type: 'panel', props: { size: [400, 400], visible: false }, children: [] },
      ignored: { id: 'ignored', type: 'panel', props: { size: [500, 500], ignored: true }, children: [] },
    },
  });
  const sum = computeLayoutBoxesForFile(makeFile('c'), { width: 200, height: 200, name: 'content-sum' });
  const maximum = computeLayoutBoxesForFile(makeFile('cm'), { width: 200, height: 200, name: 'content-maximum' });
  assertEqual(sum.boxes.find((box) => box.id === 'host').h, 43);
  assertEqual(maximum.boxes.find((box) => box.id === 'host').h, 28);
  assertDeepEqual(sum.boxes.map((box) => box.id).sort(), ['close', 'help', 'host']);

  const widthSum = computeLayoutBoxesForFile(makeFile('c', 'width'), { width: 200, height: 200, name: 'content-width-sum' });
  const widthMaximum = computeLayoutBoxesForFile(makeFile('cm', 'width'), { width: 200, height: 200, name: 'content-width-maximum' });
  assertEqual(widthSum.boxes.find((box) => box.id === 'host').w, 43);
  assertEqual(widthMaximum.boxes.find((box) => box.id === 'host').w, 28);
  assertDeepEqual(widthSum.boxes.map((box) => box.id).sort(), ['close', 'help', 'host']);
});

test('stack sibling inheritance supports the zero-width Classic toolbar anchor', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'toolbar_inherit',
    row: {
      type: 'stack_panel', orientation: 'horizontal', size: ['100%c', '100%cm'],
      anchor_from: 'top_left', anchor_to: 'top_left',
      controls: [
        { body: { type: 'panel', size: [30, 40] } },
        { toolbar_anchor: { type: 'panel', size: [0, 0], inherit_max_sibling_height: true, controls: [{ toolbar: { type: 'panel', size: [12, 6], anchor_from: 'top_right', anchor_to: 'bottom_right' } }] } },
      ],
    },
  }, { filePath: 'ui/toolbar-inherit.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 100, height: 80, name: 'toolbar-inherit' });
  const byName = (name) => {
    const node = Object.values(tree.nodesById).find((item) => item.props?.name === name);
    return layout.boxes.find((box) => box.id === node.id);
  };
  assertDeepEqual([byName('row').x, byName('row').y, byName('row').w, byName('row').h], [0, 0, 30, 40]);
  assertDeepEqual([byName('toolbar_anchor').x, byName('toolbar_anchor').y, byName('toolbar_anchor').w, byName('toolbar_anchor').h], [30, 0, 0, 40]);
  assertDeepEqual([byName('toolbar').x, byName('toolbar').y, byName('toolbar').w, byName('toolbar').h], [18, -6, 12, 6]);
});

test('self-axis size units preserve stock aspect-ratio idioms', () => {
  const aspectFromHeight = computeLayoutBoxesForFile({
    rootId: 'aspect',
    nodesById: {
      aspect: { id: 'aspect', type: 'panel', props: { size: ['177.78%y', '100%'] }, children: [] },
    },
  }, { width: 320, height: 180, name: 'aspect-from-height' });
  const first = aspectFromHeight.boxes.find((box) => box.id === 'aspect');
  assert(Math.abs(first.w - 320.004) < 0.001);
  assertEqual(first.h, 180);

  const squareFromWidth = computeLayoutBoxesForFile({
    rootId: 'square',
    nodesById: {
      square: { id: 'square', type: 'panel', props: { size: ['50%', '100%x'] }, children: [] },
    },
  }, { width: 200, height: 300, name: 'square-from-width' });
  const second = squareFromWidth.boxes.find((box) => box.id === 'square');
  assertDeepEqual([second.w, second.h], [100, 100]);
});

test('self-axis units in offsets use the final control size', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'offset',
    nodesById: {
      offset: {
        id: 'offset', type: 'panel',
        props: { size: [80, 40], offset: ['50%x', '-100%y - 2px'], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: [],
      },
    },
  }, { width: 200, height: 100, name: 'self-offset' });
  const box = layout.boxes.find((item) => item.id === 'offset');
  assertDeepEqual([box.x, box.y, box.w, box.h], [40, -42, 80, 40]);
});

test('self-axis aspect ratios re-evaluate inside stack allocations', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 400], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 400] }, children: [] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 400] }, children: ['aspect'] },
      aspect: { id: 'aspect', type: 'panel', props: { size: ['100%', '56.25%x'], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  }, { width: 1000, height: 400, name: 'allocated-aspect' });
  const aspect = layout.boxes.find((box) => box.id === 'aspect');
  assert(Math.abs(aspect.w - 500) < 0.001);
  assert(Math.abs(aspect.h - 281.25) < 0.001);
});

test('allocated subtree contexts accelerate slow convergent content equations', () => {
  const file = {
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 20], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 20] }, children: [] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 20] }, children: ['target'] },
      target: { id: 'target', type: 'panel', props: { size: ['99.99%c + 1px', 10], max_size: ['100%', 10], offset: ['100%c', 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['inner'] },
      inner: { id: 'inner', type: 'panel', props: { size: ['100%', 10] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 1000, height: 20, name: 'local-slow' });
  assertEqual(layout.boxes.find((box) => box.id === 'fill').w, 500);
  assert(Math.abs(layout.boxes.find((box) => box.id === 'target').x - 1000) < 0.01);
  assert(!layout.warnings.some((warning) => warning.startsWith('ALLOCATED_SUBTREE_CONTEXT_LIMIT')));
});

test('allocated subtree damping solves a finite negative-gain content equation', () => {
  const file = {
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 20], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 20] }, children: [] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 20], offset: ['100%c', 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['target'] },
      target: { id: 'target', type: 'panel', props: { size: ['10px - 150%c', 10], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['inner'] },
      inner: { id: 'inner', type: 'panel', props: { size: ['100%', 10], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 1000, height: 20, name: 'local-negative-gain' });
  const box = (id) => layout.boxes.find((item) => item.id === id);
  assert(Math.abs(box('fill').x - 504) < 0.001);
  assert(Math.abs(box('target').w - 4) < 0.001);
  assert(Math.abs(box('inner').w - 4) < 0.001);
  assert(!layout.warnings.some((warning) => warning.startsWith('ALLOCATED_SUBTREE_CONTEXT_LIMIT')));
});

test('allocated subtree convergence pins a root whose authored natural size differs', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: {
        id: 'outer',
        type: 'stack_panel',
        props: { size: [100, 20], orientation: 'horizontal' },
        children: ['wide', 'slowHolder', 'dampedHolder'],
      },
      wide: { id: 'wide', type: 'panel', props: { size: [30, 20] }, children: [] },
      // Both holders author 10px but are allocated 30px by sibling inheritance.
      // Recomputing their authored natural size during local measurement must
      // not be mistaken for an unresolved 30 -> 10 fixed-point transition.
      slowHolder: {
        id: 'slowHolder',
        type: 'panel',
        props: { size: [10, 20], inherit_max_sibling_width: true },
        children: ['slow'],
      },
      slow: {
        id: 'slow',
        type: 'panel',
        props: { size: ['99.99%c + 1px', 10], max_size: ['100%', 10] },
        children: ['slowInner'],
      },
      slowInner: { id: 'slowInner', type: 'panel', props: { size: ['100%', 10] }, children: [] },
      dampedHolder: {
        id: 'dampedHolder',
        type: 'panel',
        props: { size: [10, 20], inherit_max_sibling_width: true },
        children: ['damped'],
      },
      damped: {
        id: 'damped',
        type: 'panel',
        props: { size: ['10px - 150%c', 10] },
        children: ['dampedInner'],
      },
      dampedInner: { id: 'dampedInner', type: 'panel', props: { size: ['100%', 10] }, children: [] },
    },
  }, { width: 100, height: 20, name: 'allocated-repin-root' });

  assertDeepEqual(
    ['slowHolder', 'slow', 'slowInner', 'dampedHolder'].map((id) => layout.boxes.find((box) => box.id === id).w),
    [30, 30, 30, 30],
  );
  assert(Math.abs(layout.boxes.find((box) => box.id === 'damped').w - 4) < 0.001);
  assert(Math.abs(layout.boxes.find((box) => box.id === 'dampedInner').w - 4) < 0.001);
  assert(!layout.warnings.some((warning) => warning.startsWith('ALLOCATED_SUBTREE_CONTEXT_LIMIT')));
});

test('allocated stack and grid contexts use their actual child allocations', () => {
  const stack = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 20], orientation: 'horizontal' }, children: ['fixed', 'allocated'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 20] }, children: [] },
      allocated: { id: 'allocated', type: 'stack_panel', props: { size: ['fill', 20], orientation: 'horizontal', offset: ['100%c', 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['innerFixed', 'innerFill'] },
      innerFixed: { id: 'innerFixed', type: 'panel', props: { size: [100, 20] }, children: [] },
      innerFill: { id: 'innerFill', type: 'panel', props: { size: ['fill', 20] }, children: [] },
    },
  }, { width: 1000, height: 20, name: 'allocated-stack-context' });
  assertEqual(stack.boxes.find((box) => box.id === 'allocated').x, 1000);
  assertEqual(stack.boxes.find((box) => box.id === 'innerFill').w, 400);

  const grid = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 20], orientation: 'horizontal' }, children: ['fixed', 'allocated'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 20] }, children: [] },
      allocated: { id: 'allocated', type: 'grid', props: { size: ['fill', 20], grid_dimensions: [2, 1], grid_rescaling_type: 'none', offset: ['100%c', 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['cellA', 'cellB'] },
      cellA: { id: 'cellA', type: 'panel', props: { size: ['fill', 20] }, children: [] },
      cellB: { id: 'cellB', type: 'panel', props: { size: ['fill', 20] }, children: [] },
    },
  }, { width: 1000, height: 20, name: 'allocated-grid-context' });
  assertEqual(grid.boxes.find((box) => box.id === 'allocated').x, 1000);
  assertDeepEqual(['cellA', 'cellB'].map((id) => grid.boxes.find((box) => box.id === id).w), [250, 250]);
});

test('allocated grids refine empty and runtime-filtered child groups to zero content', () => {
  const makeFile = (gridProps, childProps) => ({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 20], orientation: 'horizontal' }, children: ['fixed', 'allocated'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 20] }, children: [] },
      allocated: {
        id: 'allocated',
        type: 'grid',
        props: {
          size: ['fill', 20],
          offset: ['100%c', 0],
          anchor_from: 'top_left',
          anchor_to: 'top_left',
          ...gridProps,
        },
        children: ['cell'],
      },
      cell: { id: 'cell', type: 'panel', props: { size: [100, 20], ...childProps }, children: [] },
    },
  });
  const hidden = computeLayoutBoxesForFile(
    makeFile({ grid_dimensions: [2, 1], grid_rescaling_type: 'none' }, { visible: false }),
    { width: 1000, height: 20, name: 'allocated-grid-hidden' },
  );
  assertEqual(hidden.boxes.find((box) => box.id === 'allocated').x, 500);
  assert(!hidden.boxes.some((box) => box.id === 'cell'));

  const capped = computeLayoutBoxesForFile(
    makeFile({ grid_dimensions: [2, 1], grid_rescaling_type: 'none', maximum_grid_items: 0 }, {}),
    { width: 1000, height: 20, name: 'allocated-grid-capped' },
  );
  assertEqual(capped.boxes.find((box) => box.id === 'allocated').x, 500);
  assert(!capped.boxes.some((box) => box.id === 'cell'));

  const unresolved = computeLayoutBoxesForFile(
    makeFile({ grid_dimension_binding: '#shape', grid_rescaling_type: 'none' }, {}),
    { width: 1000, height: 20, name: 'allocated-grid-unresolved-binding' },
  );
  assertEqual(unresolved.boxes.find((box) => box.id === 'allocated').x, 500);
  assert(!unresolved.boxes.some((box) => box.id === 'cell'));
  assert(unresolved.warnings.includes('GRID_DIMENSION_BINDING_UNRESOLVED:allocated:#shape'));

  const inferredInvalid = computeLayoutBoxesForFile(
    makeFile({ grid_rescaling_type: 'horizontal' }, { grid_position: [99, 99] }),
    { width: 1000, height: 20, name: 'allocated-grid-inferred-invalid-position' },
  );
  assertEqual(inferredInvalid.boxes.find((box) => box.id === 'allocated').x, 500);
  assert(!inferredInvalid.boxes.some((box) => box.id === 'cell'));
  assert(inferredInvalid.warnings.includes('GRID_POSITION_OUT_OF_BOUNDS:cell'));
});

test('allocated grid refinement solves cell-local sibling percentages', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 20], orientation: 'horizontal' }, children: ['fixed', 'allocated'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 20] }, children: [] },
      allocated: {
        id: 'allocated',
        type: 'grid',
        props: { size: ['fill', 20], grid_dimensions: [2, 1], grid_rescaling_type: 'none', offset: ['100%c', 0], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: ['cellA', 'cellB'],
      },
      cellA: { id: 'cellA', type: 'panel', props: { size: ['50%sm + 10px', 20] }, children: [] },
      cellB: { id: 'cellB', type: 'panel', props: { size: ['50%sm + 10px', 20] }, children: [] },
    },
  }, { width: 1000, height: 20, name: 'allocated-grid-peer-percent' });
  assert(Math.abs(layout.boxes.find((box) => box.id === 'allocated').x - 1000) < 0.001);
  assert(layout.boxes
    .filter((box) => box.id === 'cellA' || box.id === 'cellB')
    .every((box) => Math.abs(box.w - 20) < 0.001));
});

test('allocated grid refinement uses overrides and final rescaled cell sizes', () => {
  const makeFile = (offset, childProps, propsPresent) => ({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 20], orientation: 'horizontal' }, children: ['fixed', 'allocated'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 20] }, children: [] },
      allocated: {
        id: 'allocated',
        type: 'grid',
        props: { size: ['fill', 20], grid_dimensions: [2, 1], grid_rescaling_type: 'horizontal', offset, anchor_from: 'top_left', anchor_to: 'top_left' },
        children: ['cellA', 'cellB'],
      },
      cellA: { id: 'cellA', type: 'panel', props: childProps, propsPresent, children: [] },
      cellB: { id: 'cellB', type: 'panel', props: childProps, propsPresent, children: [] },
    },
  });
  const overridden = computeLayoutBoxesForFile(
    makeFile(['100%c', 0], {}, { size: false }),
    { width: 1000, height: 20, name: 'allocated-grid-overrides' },
    { propsByIdOverride: { cellA: { size: [100, 20] }, cellB: { size: [100, 20] } } },
  );
  assertEqual(overridden.boxes.find((box) => box.id === 'allocated').x, 1000);
  assertDeepEqual(['cellA', 'cellB'].map((id) => overridden.boxes.find((box) => box.id === id).w), [100, 100]);

  const finalCells = computeLayoutBoxesForFile(
    makeFile(['100%cm', 0], { size: ['fill', 20] }, undefined),
    { width: 1000, height: 20, name: 'allocated-grid-final-cell-max' },
  );
  assertEqual(finalCells.boxes.find((box) => box.id === 'allocated').x, 750);
  assertDeepEqual(['cellA', 'cellB'].map((id) => finalCells.boxes.find((box) => box.id === id).w), [250, 250]);
});

test('allocated grid refinement includes child anchors in its content bounds', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 20], orientation: 'horizontal' }, children: ['fixed', 'allocated'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 20] }, children: [] },
      allocated: {
        id: 'allocated',
        type: 'grid',
        props: { size: ['fill', 20], grid_dimensions: [2, 1], grid_rescaling_type: 'none', use_child_anchors: true, offset: ['100%c', 0], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: ['cellA', 'cellB'],
      },
      cellA: { id: 'cellA', type: 'panel', props: { size: [100, 20], anchor_from: 'top_right', anchor_to: 'top_left' }, children: [] },
      cellB: { id: 'cellB', type: 'panel', props: { size: [100, 20], anchor_from: 'top_right', anchor_to: 'top_left' }, children: [] },
    },
  }, { width: 1000, height: 20, name: 'allocated-grid-child-anchors' });
  assertEqual(layout.boxes.find((box) => box.id === 'allocated').x, 1100);
});

test('allocated fallback preserves a stable sibling axis', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 100], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 100] }, children: [] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 100] }, children: ['a', 'b', 'c'] },
      a: { id: 'a', type: 'panel', props: { size: ['100%sm + 1px', 20] }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: ['100%sm + 1px', 30] }, children: [] },
      c: { id: 'c', type: 'panel', props: { size: [0, '100%sm'] }, children: [] },
    },
  }, { width: 1000, height: 100, name: 'allocated-axis-local-fallback' });
  assertEqual(layout.boxes.find((box) => box.id === 'c').h, 30);
  assert(layout.warnings.includes('ALLOCATED_SUBTREE_CONTEXT_LIMIT:fill'));
});

test('allocated fallback captures mixed axes without tainting an independent content branch', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 100], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 100] }, children: [] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 100] }, children: ['bad', 'widthDriver', 'heightGroup', 'stable'] },
      bad: { id: 'bad', type: 'panel', props: { size: ['200%x + 100%sm + 490px - 100%', 0] }, children: [] },
      widthDriver: { id: 'widthDriver', type: 'panel', props: { size: [20, 0] }, children: [] },
      heightGroup: { id: 'heightGroup', type: 'panel', props: { size: [0, 20] }, children: ['heightA', 'heightB'] },
      heightA: { id: 'heightA', type: 'panel', props: { size: [0, '10px - 150%sm'] }, children: [] },
      heightB: { id: 'heightB', type: 'panel', props: { size: [0, '10px - 150%sm'] }, children: [] },
      stable: { id: 'stable', type: 'panel', props: { size: ['100%c', 20] }, children: ['leaf'] },
      leaf: { id: 'leaf', type: 'panel', props: { size: [30, 20] }, children: [] },
    },
  }, { width: 1000, height: 100, name: 'allocated-mixed-axis-isolation' });
  const box = (id) => layout.boxes.find((item) => item.id === id);
  assertEqual(box('fill').w, 500);
  assertEqual(box('bad').w, 10);
  assertDeepEqual([box('heightA').h, box('heightB').h], [10, 10]);
  assertEqual(box('stable').w, 30);
  assertEqual(box('leaf').w, 30);
  assert(layout.warnings.includes('ALLOCATED_SUBTREE_CONTEXT_LIMIT:fill'));
});

test('allocated direct-limit fallback preserves an independently settled axis', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [200, 100], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [100, 100] }, children: [] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 100] }, children: ['bad', 'follower'] },
      bad: { id: 'bad', type: 'panel', props: { size: ['200%x + 1px', '100%c'] }, children: ['heightDriver'] },
      // This takes three finite measurement frames to reach the 30px clamp.
      // Early-frame unioning used to misclassify its height as divergent merely
      // because the unrelated width equation hit the direct safety limit.
      heightDriver: { id: 'heightDriver', type: 'panel', props: { size: [10, '100% + 10px'], max_size: [10, 30] }, children: [] },
      follower: { id: 'follower', type: 'panel', props: { size: [10, '100%sm'] }, children: [] },
    },
  }, { width: 200, height: 100, name: 'allocated-direct-axis-limit' });

  assertDeepEqual(
    ['bad', 'heightDriver', 'follower'].map((id) => layout.boxes.find((box) => box.id === id).h),
    [30, 30, 30],
  );
  assert(layout.warnings.some((warning) => warning.includes('bad:width:cross-axis-fixed-point')));
  assert(layout.warnings.includes('ALLOCATED_SUBTREE_CONTEXT_LIMIT:fill'));
});

test('allocated fallback propagates direct failure through stack natural sizing', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [200, 100], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [100, 100] }, children: [] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 100] }, children: ['holder'] },
      holder: {
        id: 'holder',
        type: 'stack_panel',
        props: { size: ['default', 20], orientation: 'horizontal', offset: ['100%c', 0], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: ['bad'],
      },
      bad: { id: 'bad', type: 'panel', props: { size: ['200%x + 1px', 20] }, children: [] },
    },
  }, { width: 200, height: 100, name: 'allocated-default-content-fallback' });

  const holder = layout.boxes.find((box) => box.id === 'holder');
  assertDeepEqual([holder.x, holder.w, holder.h], [100, 0, 20]);
  assert(layout.warnings.includes('ALLOCATED_SUBTREE_CONTEXT_LIMIT:fill'));
});

test('allocated offset fallback reaches anchored ancestors and sibling offsets', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [200, 100], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [100, 100] }, children: [] },
      fill: {
        id: 'fill',
        type: 'panel',
        props: { size: ['fill', 100], offset: ['100%c', 0], use_child_anchors: true, anchor_from: 'top_left', anchor_to: 'top_left' },
        children: ['unstable', 'observer'],
      },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['200%x + 1px', 20] }, children: [] },
      observer: {
        id: 'observer',
        type: 'panel',
        props: { size: [20, 20], offset: ['100%sm', 0], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: [],
      },
    },
  }, { width: 200, height: 100, name: 'allocated-offset-ancestor-fallback' });

  assertDeepEqual(
    ['fill', 'unstable', 'observer'].map((id) => {
      const box = layout.boxes.find((item) => item.id === id);
      return [box.x, box.w, box.h];
    }),
    [[100, 100, 100], [100, 1, 20], [100, 20, 20]],
  );
});

test('allocated sibling fallback remains bounded for a wide peer group', () => {
  const peerIds = Array.from({ length: 1024 }, (_, index) => `peer-${index}`);
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [200, 20], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [100, 20] }, children: [] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 20] }, children: ['bad', ...peerIds] },
      bad: { id: 'bad', type: 'panel', props: { size: ['200%x + 1px', 10] }, children: [] },
      ...Object.fromEntries(peerIds.map((id) => [id, {
        id,
        type: 'panel',
        props: { size: ['100%sm', 10] },
        children: [],
      }])),
    },
  }, { width: 200, height: 20, name: 'allocated-wide-sibling-fallback' }, { maxBoxes: 1100 });

  assertEqual(layout.boxes.length, peerIds.length + 4);
  assert(layout.boxes.every((box) => [box.x, box.y, box.w, box.h].every(Number.isFinite)));
  assert(peerIds.every((id) => layout.boxes.find((box) => box.id === id).w === 0));
  assert(layout.warnings.includes('ALLOCATED_SUBTREE_CONTEXT_LIMIT:fill'));
});

test('allocated grid refinement uses anchored child extents for percent-content offsets', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [200, 100], orientation: 'horizontal' }, children: ['fixed', 'grid'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [100, 100] }, children: [] },
      grid: {
        id: 'grid',
        type: 'grid',
        props: {
          size: ['fill', 100],
          grid_dimensions: [1, 1],
          grid_rescaling_type: 'none',
          use_child_anchors: true,
          offset: ['100%c', 0],
          anchor_from: 'top_left',
          anchor_to: 'top_left',
        },
        children: ['cell'],
      },
      cell: {
        id: 'cell',
        type: 'panel',
        props: { size: [20, 20], offset: [30, 0], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: [],
      },
    },
  }, { width: 200, height: 100, name: 'allocated-grid-anchored-content' });

  const grid = layout.boxes.find((box) => box.id === 'grid');
  const cell = layout.boxes.find((box) => box.id === 'cell');
  assertDeepEqual([grid.x, grid.w, cell.x, cell.w], [150, 100, 180, 20]);
  assert(!layout.warnings.some((warning) => warning.startsWith('ALLOCATED_SUBTREE_CONTEXT_LIMIT')));
});

test('nested containers use their allocation-local content contexts', () => {
  const file = {
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [1000, 20], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [500, 20] }, children: [] },
      fill: { id: 'fill', type: 'stack_panel', props: { size: ['fill', 20], orientation: 'vertical' }, children: ['contentSized'] },
      contentSized: { id: 'contentSized', type: 'panel', props: { size: ['100%c', 10], min_size: ['100%', 10], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['inner'] },
      inner: { id: 'inner', type: 'panel', props: { size: ['100%', 10], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 1000, height: 20, name: 'nested-allocated' });
  assertDeepEqual(['fill', 'contentSized', 'inner'].map((id) => layout.boxes.find((box) => box.id === id).w), [500, 500, 500]);
});

test('allocated subtree discovery limits fail closed without retaining partial global contexts', () => {
  const file = {
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [100, 20], orientation: 'horizontal' }, children: ['fill'] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 20] }, children: ['a'] },
      a: { id: 'a', type: 'panel', props: { size: ['100%c', 10] }, children: ['b'] },
      b: { id: 'b', type: 'panel', props: { size: ['100%c', 10] }, children: ['leaf'] },
      leaf: { id: 'leaf', type: 'panel', props: { size: [7, 10] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(
    file,
    { width: 100, height: 20, name: 'allocated-discovery-limit' },
    { maxBoxes: 3 },
  );
  assert(layout.warnings.includes('ALLOCATED_SUBTREE_DISCOVERY_LIMIT:fill'));
  assertEqual(layout.boxes.find((box) => box.id === 'a').w, 0);
  assert(layout.boxes.every((box) => [box.x, box.y, box.w, box.h].every(Number.isFinite)));
});

test('allocated subtree discovery ignores safe-hidden branches when sizing visible content', () => {
  const hiddenIds = Array.from({ length: 20 }, (_, index) => `hidden-${index}`);
  const file = {
    rootId: 'outer',
    nodesById: {
      outer: { id: 'outer', type: 'stack_panel', props: { size: [100, 20], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [40, 20] }, children: [] },
      fill: { id: 'fill', type: 'panel', props: { size: ['fill', 20], offset: ['100%c', 0] }, children: ['visible', ...hiddenIds] },
      visible: { id: 'visible', type: 'panel', props: { size: [20, 10] }, children: [] },
      ...Object.fromEntries(hiddenIds.map((id) => [id, {
        id, type: 'panel', props: { size: [500, 10], visible: false }, children: [],
      }])),
    },
  };
  const layout = computeLayoutBoxesForFile(
    file,
    { width: 100, height: 20, name: 'allocated-hidden-branches' },
    { maxBoxes: 8 },
  );
  assertEqual(layout.boxes.find((box) => box.id === 'fill').x, 60);
  assert(!layout.warnings.some((warning) => warning.startsWith('ALLOCATED_SUBTREE_DISCOVERY_LIMIT')));
});

test('nonconvergence fallback does not collapse an independent sibling branch', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [400, 200] }, children: ['unstable', 'stable'] },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['100%c', 20] }, children: ['loopChild'] },
      loopChild: { id: 'loopChild', type: 'panel', props: { size: ['100% + 1px', 20] }, children: [] },
      stable: { id: 'stable', type: 'panel', props: { size: ['100%c', 20], offset: [0, 50] }, children: ['fixed'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [20, 20] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 480, height: 270, name: 'isolated-fallback' });
  assertEqual(layout.boxes.find((box) => box.id === 'unstable').w, 0);
  assertEqual(layout.boxes.find((box) => box.id === 'stable').w, 20);
});

test('nonconvergence fallback clears only content contexts consumed by stable offsets', () => {
  const makeFile = (unit) => ({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [400, 100] }, children: ['holder'] },
      holder: {
        id: 'holder',
        type: 'panel',
        props: { size: [20, 20], offset: [`100%${unit}`, 0], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: ['unstable'],
      },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['100%c + 10px', 20] }, children: ['driver'] },
      driver: { id: 'driver', type: 'panel', props: { size: ['100%', 20] }, children: [] },
    },
  });

  for (const unit of ['c', 'cm']) {
    const layout = computeLayoutBoxesForFile(makeFile(unit), { width: 400, height: 100, name: `offset-${unit}-fallback` });
    const holder = layout.boxes.find((box) => box.id === 'holder');
    assertDeepEqual([holder.x, holder.y, holder.w, holder.h], [0, 0, 20, 20]);
    assertDeepEqual(['unstable', 'driver'].map((id) => layout.boxes.find((box) => box.id === id).w), [10, 10]);
    assert(layout.warnings.includes('CONTENT_SIZE_FIXED_POINT_LIMIT:10.00'));
  }
});

test('nonconvergence fallback clears sibling context consumed only by an offset', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [400, 100] }, children: ['unstable', 'offsetPeer'] },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['100%c + 10px', 20] }, children: ['driver'] },
      driver: { id: 'driver', type: 'panel', props: { size: ['100%', 20] }, children: [] },
      offsetPeer: {
        id: 'offsetPeer',
        type: 'panel',
        props: { size: [20, 20], offset: ['100%sm', 40], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: [],
      },
    },
  }, { width: 400, height: 100, name: 'offset-sm-fallback' });

  const peer = layout.boxes.find((box) => box.id === 'offsetPeer');
  assertDeepEqual([peer.x, peer.y, peer.w, peer.h], [0, 40, 20, 20]);
  assertDeepEqual(['unstable', 'driver'].map((id) => layout.boxes.find((box) => box.id === id).w), [10, 10]);
  assert(layout.warnings.includes('CONTENT_SIZE_FIXED_POINT_LIMIT:10.00'));
});

test('container-local placement cannot restore a failed sibling offset context', () => {
  const makeFile = (rootType, rootProps) => ({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: rootType, props: { size: [400, 200], anchor_from: 'top_left', anchor_to: 'top_left', ...rootProps }, children: ['unstable', 'offsetPeer'] },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['100%c + 10px', 20], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['driver'] },
      driver: { id: 'driver', type: 'panel', props: { size: ['100%', 20], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
      offsetPeer: { id: 'offsetPeer', type: 'panel', props: { size: [20, 20], offset: ['100%sm', 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  });

  const stack = computeLayoutBoxesForFile(
    makeFile('stack_panel', { orientation: 'vertical' }),
    { width: 400, height: 200, name: 'stack-offset-sm-fallback' },
  );
  // R37: a vertical stack owns cross-axis placement when use_child_anchors
  // is absent. Preserve the failed-offset reset while using the left origin,
  // consistent with the source form and supplied native left-aligned content.
  assertDeepEqual(['unstable', 'driver', 'offsetPeer'].map((id) => {
    const box = stack.boxes.find((item) => item.id === id);
    return [box.x, box.y, box.w, box.h];
  }), [[0, 0, 10, 20], [0, 0, 10, 20], [0, 20, 20, 20]]);

  const grid = computeLayoutBoxesForFile(
    makeFile('grid', { grid_dimensions: [2, 1], grid_rescaling_type: 'none' }),
    { width: 400, height: 200, name: 'grid-offset-sm-fallback' },
  );
  assertDeepEqual(['unstable', 'offsetPeer'].map((id) => {
    const box = grid.boxes.find((item) => item.id === id);
    return [box.x, box.y, box.w, box.h];
  }), [[0, 0, 10, 20], [200, 0, 20, 20]]);
});

test('offset fallback keeps an independent content-sized peer intact', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [400, 100] }, children: ['unstable', 'offsetPeer'] },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['100%c + 10px', 20] }, children: ['driver'] },
      driver: { id: 'driver', type: 'panel', props: { size: ['100%', 20] }, children: [] },
      offsetPeer: { id: 'offsetPeer', type: 'panel', props: { size: ['100%c', 20], offset: ['100%sm', 40] }, children: ['fixed'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [30, 20] }, children: [] },
    },
  }, { width: 400, height: 100, name: 'offset-sm-independent-content' });

  const peer = layout.boxes.find((box) => box.id === 'offsetPeer');
  const fixed = layout.boxes.find((box) => box.id === 'fixed');
  assertDeepEqual([peer.x, peer.y, peer.w, peer.h], [0, 40, 30, 20]);
  assertDeepEqual([fixed.x, fixed.y, fixed.w, fixed.h], [0, 40, 30, 20]);
});

test('offset-only fallback taint propagates through anchored content bounds', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [400, 100], offset: ['100%c', 0], use_child_anchors: true, anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['holder'] },
      holder: { id: 'holder', type: 'panel', props: { size: [20, 20], offset: ['100%c', 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['unstable'] },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['100%c + 10px', 20], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['driver'] },
      driver: { id: 'driver', type: 'panel', props: { size: ['100%', 20], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  }, { width: 400, height: 100, name: 'nested-offset-content-fallback' });

  assertDeepEqual(['root', 'holder', 'unstable', 'driver'].map((id) => {
    const box = layout.boxes.find((item) => item.id === id);
    return [box.x, box.w];
  }), [[0, 400], [0, 20], [0, 10], [0, 10]]);
});

test('cross-axis self offsets propagate fallback taint into anchored content', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [400, 100], offset: [0, '100%c'], use_child_anchors: true, anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['unstable'] },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['100%c + 10px', 20], offset: [0, '100%x'], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['driver'] },
      driver: { id: 'driver', type: 'panel', props: { size: ['100%', 20], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  }, { width: 400, height: 100, name: 'cross-axis-offset-content-fallback' });

  assertDeepEqual(['root', 'unstable', 'driver'].map((id) => {
    const box = layout.boxes.find((item) => item.id === id);
    return [box.y, box.w];
  }), [[0, 400], [10, 10], [10, 10]]);
});

test('anchored offsets do not taint a stack default axis backed by content max', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [400, 100] }, children: ['stack', 'observer'] },
      stack: { id: 'stack', type: 'stack_panel', props: { size: ['default', 20], orientation: 'vertical', use_child_anchors: true }, children: ['holder'] },
      holder: { id: 'holder', type: 'panel', props: { size: [20, 20], offset: ['100%c', 0] }, children: ['unstable'] },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['100%c + 10px', 20] }, children: ['driver'] },
      driver: { id: 'driver', type: 'panel', props: { size: ['100%', 20] }, children: [] },
      observer: { id: 'observer', type: 'panel', props: { size: [20, 20], offset: ['100%sm', 50] }, children: [] },
    },
  }, { width: 400, height: 100, name: 'stack-content-max-stability' });

  assertEqual(layout.boxes.find((box) => box.id === 'stack').w, 20);
  assertEqual(layout.boxes.find((box) => box.id === 'observer').x, 20);
});

test('default image size is not treated as child-content feedback', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [400, 100] }, children: ['image', 'observer'] },
      image: { id: 'image', type: 'image', props: { size: ['default', 20] }, children: ['unstable'] },
      unstable: { id: 'unstable', type: 'panel', props: { size: ['100%c + 10px', 20] }, children: ['driver'] },
      driver: { id: 'driver', type: 'panel', props: { size: ['100%', 20] }, children: [] },
      observer: { id: 'observer', type: 'panel', props: { size: [20, 20], offset: ['100%sm', 50] }, children: [] },
    },
  }, { width: 400, height: 100, name: 'image-default-stability' });

  assertEqual(layout.boxes.find((box) => box.id === 'image').w, 96);
  assertEqual(layout.boxes.find((box) => box.id === 'observer').x, 96);
});

test('unstable self-axis equations fail closed to finite geometry', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'loop',
    nodesById: {
      loop: { id: 'loop', type: 'panel', props: { size: ['200%y + 1px', '200%x + 1px'] }, children: [] },
    },
  }, { width: 100, height: 100, name: 'self-axis-loop' });
  const box = layout.boxes.find((item) => item.id === 'loop');
  assert([box.x, box.y, box.w, box.h].every(Number.isFinite));
  assert(box.w < 1000 && box.h < 1000);
  assert(layout.warnings.some((warning) => warning.includes('cross-axis-fixed-point')));
});

test('self-axis failure marks only the unstable axis and keeps stable sibling height', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [100, 100] }, children: ['bad', 'follower'] },
      bad: { id: 'bad', type: 'panel', props: { size: ['200%x + 1px', 20] }, children: [] },
      follower: { id: 'follower', type: 'panel', props: { size: [10, '100%sm'], offset: [0, 30] }, children: [] },
    },
  }, { width: 100, height: 100, name: 'self-axis-width-only' });
  assertEqual(layout.boxes.find((box) => box.id === 'bad').h, 20);
  assertEqual(layout.boxes.find((box) => box.id === 'follower').h, 20);
  assert(layout.warnings.some((warning) => warning.includes('bad:width:cross-axis-fixed-point')));
  assert(!layout.warnings.some((warning) => warning.includes('bad:height:cross-axis-fixed-point')));
});

test('direct recursive limits also fail closed an independent unstable axis', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [200, 100] }, children: ['bad', 'heightA', 'heightB'] },
      bad: { id: 'bad', type: 'panel', props: { size: ['200%x + 1px', 0] }, children: [] },
      heightA: { id: 'heightA', type: 'panel', props: { size: [10, '10px - 150%sm'] }, children: [] },
      heightB: { id: 'heightB', type: 'panel', props: { size: [10, '10px - 150%sm'] }, children: [] },
    },
  }, { width: 200, height: 100, name: 'mixed-axis-direct-limit' });
  const box = (id) => layout.boxes.find((item) => item.id === id);
  assertEqual(box('bad').w, 1);
  assertDeepEqual([box('heightA').h, box('heightB').h], [10, 10]);
  assert(layout.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT:limit')));
});

test('near-singular self-axis equations accept a finite verified solution', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'near',
    nodesById: {
      near: { id: 'near', type: 'panel', props: { size: ['99.99999999999%x + 0.0000005px', 10] }, children: [] },
    },
  }, { width: 100, height: 100, name: 'near-singular-self-axis' });
  const width = layout.boxes.find((box) => box.id === 'near').w;
  assert(width > 4_000_000 && width < 6_000_000, `Expected finite near-singular solution, got ${width}`);
  assert(!layout.warnings.some((warning) => warning.includes('cross-axis-fixed-point')));
});

test('safe measurement excludes factory templates even when they have authored children', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: ['100%c', 20] }, children: ['factory'] },
      factory: { id: 'factory', type: 'factory', props: {}, children: ['template'] },
      template: { id: 'template', type: 'panel', props: { size: [500, 20] }, children: [] },
    },
  };
  const safe = computeLayoutBoxesForFile(file, { width: 600, height: 100, name: 'factory-safe' });
  assertEqual(safe.boxes.find((box) => box.id === 'root').w, 0);
  assertDeepEqual(safe.boxes.map((box) => box.id), ['root']);
  const structure = computeLayoutBoxesForFile(
    file,
    { width: 600, height: 100, name: 'factory-structure' },
    { visibilityMode: 'structure' },
  );
  assert(structure.boxes.some((box) => box.id === 'factory'));
  assert(structure.boxes.some((box) => box.id === 'template'));
});

test('extreme positions and layers are clamped with diagnostics instead of dropping boxes', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [10, 10], offset: [Number.MAX_VALUE, -Number.MAX_VALUE], layer: Number.MAX_VALUE }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: [10, 10], offset: [Number.MAX_VALUE, Number.MAX_VALUE], layer: Number.MAX_VALUE }, children: [] },
    },
  }, { width: 100, height: 100, name: 'extreme-coordinates' });
  assertDeepEqual(layout.boxes.map((box) => box.id), ['root', 'child']);
  assert(layout.boxes.every((box) => [box.x, box.y, box.w, box.h, box.layer, box.effectiveLayer].every(Number.isFinite)));
  assert(layout.boxes.every((box) => Math.abs(box.x) <= 10_000_000 && Math.abs(box.y) <= 10_000_000));
  assert(layout.warnings.some((warning) => warning.startsWith('LAYOUT_POSITION_LIMIT:')));
  assert(layout.warnings.some((warning) => warning.startsWith('LAYOUT_LAYER_LIMIT:')));
  assert(!layout.warnings.some((warning) => warning.startsWith('LAYOUT_NONFINITE_BOX_DROPPED:')));
});

test('grid peer damping solves finite negative gain and preserves a stable axis on fallback', () => {
  const finite = computeLayoutBoxesForFile({
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: [20, 10], grid_dimensions: [2, 1], grid_rescaling_type: 'none' }, children: ['a', 'b'] },
      a: { id: 'a', type: 'panel', props: { size: ['10px - 150%sm', 10] }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: ['10px - 150%sm', 10] }, children: [] },
    },
  }, { width: 20, height: 10, name: 'grid-negative-gain' });
  assert(finite.boxes.filter((box) => box.id === 'a' || box.id === 'b').every((box) => Math.abs(box.w - 4) < 0.001));
  assert(!finite.warnings.some((warning) => warning.startsWith('GRID_CELL_SIBLING_FIXED_POINT_LIMIT:')));

  const divergent = computeLayoutBoxesForFile({
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: [30, 100], grid_dimensions: [3, 1], grid_rescaling_type: 'none' }, children: ['a', 'b', 'c'] },
      a: { id: 'a', type: 'panel', props: { size: ['100%sm + 1px', 20] }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: ['100%sm + 1px', 30] }, children: [] },
      c: { id: 'c', type: 'panel', props: { size: [0, '100%sm'] }, children: [] },
    },
  }, { width: 30, height: 100, name: 'grid-axis-local-fallback' });
  assertEqual(divergent.boxes.find((box) => box.id === 'c').h, 30);
  assert(divergent.warnings.some((warning) => warning.startsWith('GRID_CELL_SIBLING_FIXED_POINT_LIMIT:')));
});

test('use_child_anchors includes anchored child extents in content sizing', () => {
  const file = {
    rootId: 'row',
    nodesById: {
      row: { id: 'row', type: 'stack_panel', props: { orientation: 'horizontal', size: ['100%c', '100%cm'], use_child_anchors: true, anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['a', 'b'] },
      a: { id: 'a', type: 'panel', props: { size: [20, 10], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: [30, 10], anchor_from: 'top_right', anchor_to: 'top_left' }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 100, height: 50, name: 'child-anchor-bounds' });
  const row = layout.boxes.find((box) => box.id === 'row');
  const b = layout.boxes.find((box) => box.id === 'b');
  assertDeepEqual([row.x, row.y, row.w, row.h], [0, 0, 80, 10]);
  assertDeepEqual([b.x, b.y, b.w, b.h], [50, 0, 30, 10]);
});

test('stacks own direct-child placement unless use_child_anchors is enabled', () => {
  const makeFile = (useChildAnchors) => ({
    rootId: 'row',
    nodesById: {
      row: {
        id: 'row', type: 'stack_panel',
        props: { size: [50, 60], orientation: 'horizontal', ...(useChildAnchors === undefined ? {} : { use_child_anchors: useChildAnchors }) },
        children: ['a', 'b'],
      },
      a: { id: 'a', type: 'panel', props: { size: [20, 16], anchor_from: 'bottom_right', anchor_to: 'bottom_right' }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: [30, 16], anchor_from: 'top_right', anchor_to: 'top_left' }, children: [] },
    },
  });
  const managed = computeLayoutBoxesForFile(makeFile(undefined), { width: 50, height: 60, name: 'stack-managed-anchors' });
  const managedA = managed.boxes.find((box) => box.id === 'a');
  const managedB = managed.boxes.find((box) => box.id === 'b');
  assertDeepEqual([managedA.x, managedA.y], [0, 22]);
  assertDeepEqual([managedB.x, managedB.y], [20, 22]);

  const authored = computeLayoutBoxesForFile(makeFile(true), { width: 50, height: 60, name: 'stack-authored-anchors' });
  assertDeepEqual(
    [authored.boxes.find((box) => box.id === 'a').x, authored.boxes.find((box) => box.id === 'a').y],
    [0, 44],
  );
});

test('safe toggle preview paints exactly one known state and omits unresolved states', () => {
  const makeFile = (toggleProps) => ({
    rootId: 'toggle',
    nodesById: {
      toggle: { id: 'toggle', type: 'toggle', props: { size: [20, 20], ...toggleProps }, children: ['unchecked', 'checked', 'helper'] },
      unchecked: { id: 'unchecked', type: 'image', props: { name: 'unchecked', size: [20, 20] }, children: [] },
      checked: { id: 'checked', type: 'image', props: { name: 'checked', size: [20, 20] }, children: [] },
      helper: { id: 'helper', type: 'label', props: { name: 'helper', size: [5, 5], text: 'x' }, children: [] },
    },
  });
  const unchecked = computeLayoutBoxesForFile(makeFile({ toggle_state: false }), { width: 40, height: 40, name: 'toggle-off' });
  assertDeepEqual(unchecked.boxes.map((box) => box.id).sort(), ['helper', 'toggle', 'unchecked']);
  const checked = computeLayoutBoxesForFile(makeFile({ toggle_state: true }), { width: 40, height: 40, name: 'toggle-on' });
  assertDeepEqual(checked.boxes.map((box) => box.id).sort(), ['checked', 'helper', 'toggle']);
  const unresolved = computeLayoutBoxesForFile(makeFile({ toggle_state: '#runtime_state' }), { width: 40, height: 40, name: 'toggle-runtime' });
  assertDeepEqual(unresolved.boxes.map((box) => box.id).sort(), ['helper', 'toggle']);
  const unresolvedWithDefault = computeLayoutBoxesForFile(
    makeFile({ toggle_state: '#runtime_state', toggle_default_state: true }),
    { width: 40, height: 40, name: 'toggle-runtime-with-default' },
  );
  assertDeepEqual(unresolvedWithDefault.boxes.map((box) => box.id).sort(), ['helper', 'toggle']);
});

test('dropdowns inherited from toggle contracts paint exactly one toggle state', () => {
  const stateNames = [
    'unchecked', 'checked', 'unchecked_hover', 'checked_hover',
    'unchecked_locked', 'checked_locked', 'unchecked_locked_hover', 'checked_locked_hover',
  ];
  const file = {
    rootId: 'dropdown',
    nodesById: {
      dropdown: {
        id: 'dropdown', type: 'dropdown',
        props: {
          size: [100, 16], toggle_state: false,
          unchecked_control: 'unchecked', checked_control: 'checked',
          unchecked_hover_control: 'unchecked_hover', checked_hover_control: 'checked_hover',
          unchecked_locked_control: 'unchecked_locked', checked_locked_control: 'checked_locked',
          unchecked_locked_hover_control: 'unchecked_locked_hover', checked_locked_hover_control: 'checked_locked_hover',
        },
        children: [...stateNames, 'label'],
      },
      ...Object.fromEntries(stateNames.map((name) => [name, {
        id: name, type: 'image', props: { name, size: [100, 16] }, children: [],
      }])),
      label: { id: 'label', type: 'label', props: { name: 'label', text: 'Position', size: [60, 10] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 120, height: 30, name: 'dropdown-toggle-state' });
  assertDeepEqual(layout.boxes.map((box) => box.id).sort(), ['dropdown', 'label', 'unchecked']);
});

test('content measurement uses the same active button state as safe drawing', () => {
  const file = {
    rootId: 'button',
    nodesById: {
      button: {
        id: 'button',
        type: 'button',
        props: { size: ['default', 'default'], default_control: 'default', hover_control: 'hover' },
        children: ['default', 'hover'],
      },
      default: { id: 'default', type: 'panel', props: { name: 'default', size: [20, 10] }, children: [] },
      hover: { id: 'hover', type: 'panel', props: { name: 'hover', size: [200, 100] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 300, height: 200, name: 'button-active-state' });
  const button = layout.boxes.find((box) => box.id === 'button');
  assertDeepEqual([button.w, button.h], [20, 10]);
  assertDeepEqual(layout.boxes.map((box) => box.id), ['button', 'default']);
});

test('a size-omitted toggle fills its authored toolbar host without changing explicit buttons', () => {
  const model = buildUiScreenModelFromJson({
    namespace: 'toolbar_toggle',
    host: {
      type: 'panel', size: [25, 18], anchor_from: 'top_left', anchor_to: 'top_left',
      controls: [{
        layout_toggle: {
          type: 'toggle', toggle_state: false,
          unchecked_control: 'unchecked', checked_control: 'checked',
          controls: [
            { unchecked: { type: 'panel' } },
            { checked: { type: 'panel' } },
          ],
        },
      }],
    },
  }, { filePath: 'ui/toolbar-toggle.json' });
  const tree = buildTreeFromUiScreenModel(model);
  const layout = computeLayoutBoxesForFile(tree, { width: 25, height: 18, name: 'toolbar-toggle' });
  const byName = (name) => {
    const node = Object.values(tree.nodesById).find((item) => item.props?.name === name);
    return layout.boxes.find((box) => box.id === node.id);
  };
  assertDeepEqual([byName('layout_toggle').w, byName('layout_toggle').h], [25, 18]);
  assertDeepEqual([byName('unchecked').w, byName('unchecked').h], [25, 18]);
  assertEqual(byName('checked'), undefined);
});

test('grid_dimension_binding uses a concrete vector and fails closed when unresolved', () => {
  const file = {
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: [90, 30], grid_dimension_binding: '#shape', anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['a', 'b', 'c'] },
      a: { id: 'a', type: 'panel', props: {}, children: [] },
      b: { id: 'b', type: 'panel', props: {}, children: [] },
      c: { id: 'c', type: 'panel', props: {}, children: [] },
    },
  };
  const valid = computeLayoutBoxesForFile(file, { width: 90, height: 30, name: 'grid-valid' }, { propsByIdOverride: { grid: { shape: [3, 1] } } });
  assertDeepEqual(['a', 'b', 'c'].map((id) => {
    const box = valid.boxes.find((item) => item.id === id);
    return [box.x, box.y, box.w, box.h];
  }), [[0, 0, 30, 30], [30, 0, 30, 30], [60, 0, 30, 30]]);
  const invalidAuthoredDimensions = {
    ...file,
    nodesById: {
      ...file.nodesById,
      grid: {
        ...file.nodesById.grid,
        props: { ...file.nodesById.grid.props, grid_dimensions: [0, 0] },
      },
    },
  };
  const recovered = computeLayoutBoxesForFile(
    invalidAuthoredDimensions,
    { width: 90, height: 30, name: 'grid-binding-recovery' },
    { propsByIdOverride: { grid: { shape: [3, 1] } } },
  );
  assertDeepEqual(['a', 'b', 'c'].map((id) => {
    const box = recovered.boxes.find((item) => item.id === id);
    return [box.x, box.y, box.w, box.h];
  }), [[0, 0, 30, 30], [30, 0, 30, 30], [60, 0, 30, 30]]);
  const missing = computeLayoutBoxesForFile(file, { width: 90, height: 30, name: 'grid-missing' });
  assertDeepEqual(missing.boxes.map((box) => box.id), ['grid']);
  assert(missing.warnings.includes('GRID_DIMENSION_BINDING_UNRESOLVED:grid:#shape'));
  const invalid = computeLayoutBoxesForFile(
    file,
    { width: 90, height: 30, name: 'grid-invalid' },
    { propsByIdOverride: { grid: { shape: [0, 0] } } },
  );
  assertDeepEqual(invalid.boxes.map((box) => box.id), ['grid']);
  assert(invalid.warnings.includes('GRID_DIMENSION_BINDING_INVALID:grid:#shape'));

  const emptyBinding = computeLayoutBoxesForFile({
    rootId: 'grid',
    nodesById: {
      grid: {
        id: 'grid',
        type: 'grid',
        props: { size: [20, 'default'], grid_dimension_binding: '  ', grid_rescaling_type: 'horizontal' },
        children: ['a', 'b'],
      },
      a: { id: 'a', type: 'panel', props: { size: [10, 10] }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: [10, 10] }, children: [] },
    },
  }, { width: 20, height: 30, name: 'grid-empty-binding' });
  assertEqual(emptyBinding.boxes.find((box) => box.id === 'grid').h, 10);
  assertDeepEqual(['a', 'b'].map((id) => emptyBinding.boxes.find((box) => box.id === id).x), [0, 10]);
  assert(emptyBinding.warnings.some((warning) => warning.includes('GRID_DIMENSIONS_INFERRED:grid:2x1')));
});

test('grid dimensions are bounded consistently before cell arithmetic', () => {
  const file = {
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: [90, 30], grid_dimensions: [1e308, 1e308] }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: [10, 10] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 90, height: 30, name: 'grid-bounded' });
  const child = layout.boxes.find((box) => box.id === 'child');
  assert(child && [child.x, child.y, child.w, child.h].every(Number.isFinite));
  assert(layout.warnings.some((warning) => warning.startsWith('GRID_DIMENSION_LIMIT:grid:authored:')));
});

test('content-size nonconvergence is finite, deterministic, and fails to a zero content basis', () => {
  const file = {
    rootId: 'loop',
    nodesById: {
      loop: { id: 'loop', type: 'stack_panel', props: { orientation: 'horizontal', size: ['100%c + 10px', 10], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: ['100%', 10], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  };
  const run = () => computeLayoutBoxesForFile(file, { width: 200, height: 100, name: 'nonconvergent' });
  const first = run();
  const second = run();
  const geometry = (result) => result.boxes.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
  assertDeepEqual(geometry(first), geometry(second));
  assertDeepEqual(first.warnings, second.warnings);
  assert(first.warnings.includes('CONTENT_SIZE_FIXED_POINT_LIMIT:10.00'));
  assertEqual(first.boxes.find((box) => box.id === 'loop').w, 10);
  assert(first.boxes.every((box) => [box.x, box.y, box.w, box.h].every(Number.isFinite)));
});

test('nonconvergent sibling fallback clears clamped peers in the same constraint component', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [500, 20] }, children: ['a', 'b', 'clamped'] },
      a: { id: 'a', type: 'panel', props: { size: ['100%sm + 10px', 10] }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: ['100%sm + 10px', 10] }, children: [] },
      clamped: { id: 'clamped', type: 'panel', props: { size: ['100%sm', 10], max_size: [100, 10] }, children: [] },
    },
  }, { width: 500, height: 20, name: 'sibling-fallback-component' });
  assertDeepEqual(
    ['a', 'b', 'clamped'].map((id) => layout.boxes.find((box) => box.id === id).w),
    [10, 10, 0],
  );
  assert(layout.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('cyclic authored node graphs terminate before layout recursion', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'a',
    nodesById: {
      a: { id: 'a', type: 'panel', props: { size: [20, 20] }, children: ['b'] },
      b: { id: 'b', type: 'panel', props: { size: [10, 10] }, children: ['a'] },
    },
  }, { width: 40, height: 40, name: 'cycle' });
  assertDeepEqual(layout.boxes.map((box) => box.id), ['a', 'b']);
  assert(layout.warnings.includes('CONTENT_SIZE_NODE_CYCLE:a'));
});

test('deep untrusted node chains stop at an explicit layout depth boundary', () => {
  const nodesById = {};
  for (let index = 0; index < 800; index += 1) {
    nodesById[`node-${index}`] = {
      id: `node-${index}`,
      type: 'panel',
      props: { size: [10, 10] },
      children: index < 799 ? [`node-${index + 1}`] : [],
    };
  }
  const layout = computeLayoutBoxesForFile(
    { rootId: 'node-0', nodesById },
    { width: 20, height: 20, name: 'depth-bounded' },
  );
  assert(layout.boxes.length <= 513);
  assert(layout.warnings.includes('LAYOUT_DEPTH_LIMIT:512'));
});

test('image metadata preserves UV state and normalizes clip, tile, fill, and effects safely', () => {
  assertEqual(buildImageDrawMetadataFromProps({}).uvSizeState, 'absent');
  assertEqual(buildImageDrawMetadataFromProps({ uv_size: [] }).uvSizeState, 'absent');
  assertEqual(buildImageDrawMetadataFromProps({ uv_size: [0, 0] }).uvSizeState, 'zero');
  assertEqual(buildImageDrawMetadataFromProps({ uv_size: [16, 8] }).uvSizeState, 'valid');
  assertEqual(buildImageDrawMetadataFromProps({ uv_size: ['bad', 8] }).uvSizeState, 'invalid');
  assertDeepEqual(buildImageDrawMetadataFromProps({ nine_slice_left: 2 }).nineSlice, [2, 0, 0, 0]);
  const metadata = buildImageDrawMetadataFromProps({
    fill: true, tiled: 'x', tiled_scale: [2, 3], clip_ratio: 2, clip_direction: 'down',
    color: [2, -1, 0.5, 0.25], grayscale: true,
  });
  assertEqual(metadata.fill, true);
  assertEqual(metadata.tiled, 'x');
  assertDeepEqual(metadata.tiledScale, [2, 3]);
  assertEqual(metadata.clipRatio, 1);
  assertEqual(metadata.clipDirection, 'down');
  assertDeepEqual(metadata.tint, [1, 0, 0.5, 0.25]);
  assertEqual(metadata.grayscale, true);
  assertEqual(buildImageDrawMetadataFromProps({ clip_ratio: '#runtime' }).clipRatio, 0);
  assertEqual(buildImageDrawMetadataFromProps({ clip_ratio: 0.5, clip_direction: 'sideways' }).clipRatio, 0);
});

test('image source clipping and tiling helpers preserve authored crop boundaries', () => {
  assertDeepEqual(computeImageSourceRect({ width: 32, height: 16 }, [4, 2], null, 'absent'), { x: 4, y: 2, w: 28, h: 14 });
  assertEqual(computeImageSourceRect({ width: 32, height: 16 }, [0, 0], [0, 0], 'zero'), null);
  assertDeepEqual(computeImageSourceRect({ width: 32, height: 16 }, [4, 2], [8, 6], 'valid'), { x: 4, y: 2, w: 8, h: 6 });
  assertDeepEqual(
    computeImageSourceRect({ width: 100, height: 50 }, [10, 5], [20, 10], 'valid', [50, 25]),
    { x: 20, y: 10, w: 40, h: 20 },
  );
  const destination = { x: 10, y: 20, w: 100, h: 80 };
  const source = { x: 0, y: 0, w: 10, h: 10 };
  assertDeepEqual(computeImageClipRect(destination, 0.25, 'left', false, source), { x: 10, y: 20, w: 25, h: 80 });
  assertDeepEqual(computeImageClipRect(destination, 0.25, 'right', false, source), { x: 85, y: 20, w: 25, h: 80 });
  assertDeepEqual(computeImageClipRect(destination, 0.25, 'up', false, source), { x: 10, y: 20, w: 100, h: 20 });
  assertDeepEqual(computeImageClipRect(destination, 0.25, 'down', false, source), { x: 10, y: 80, w: 100, h: 20 });
  assertDeepEqual(computeImageClipRect(destination, 0.25, 'center', false, source), { x: 47.5, y: 20, w: 25, h: 80 });
  assertEqual(computeImageClipRect(destination, 0, 'left', true, source), null);
  assertEqual(computeImageClipRect(destination, 0.51, 'left', true, source).w, 50);
  const tiled = computeTiledImagePatches(
    { x: 0, y: 0, w: 16, h: 8 },
    { x: 0, y: 0, w: 36, h: 8 },
    'x', [1, 1], null,
  );
  assertEqual(tiled.patches.length, 3);
  assertDeepEqual(tiled.patches[2], { sx: 0, sy: 0, sw: 4, sh: 8, dx: 32, dy: 0, dw: 4, dh: 8 });
  const bounded = computeTiledImagePatches(
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: 10000, h: 1 },
    'x', [1, 1], null, 16,
  );
  assertEqual(bounded.patches.length, 0);
  assertEqual(bounded.truncated, true);
  assertEqual(bounded.requiredPatches, 10000);
  const scaled = computeTiledImagePatches(
    { x: 0, y: 0, w: 16, h: 8 },
    { x: 0, y: 0, w: 72, h: 16 },
    'x', [1, 1], null, 16, 2,
  );
  assertEqual(scaled.patches.length, 3);
  assertDeepEqual(scaled.patches[2], { sx: 0, sy: 0, sw: 4, sh: 8, dx: 64, dy: 0, dw: 8, dh: 16 });
});

test('sibling inheritance never shrinks a larger child and applies outside stacks', () => {
  const stack = {
    rootId: 'row',
    nodesById: {
      row: { id: 'row', type: 'stack_panel', props: { orientation: 'horizontal', size: ['100%c', '100%cm'] }, children: ['large', 'small'] },
      large: { id: 'large', type: 'panel', props: { size: [50, 40], inherit_max_sibling_height: true }, children: [] },
      small: { id: 'small', type: 'panel', props: { size: [20, 10] }, children: [] },
    },
  };
  const stackLayout = computeLayoutBoxesForFile(stack, { width: 100, height: 80, name: 'sibling-max-stack' });
  assertEqual(stackLayout.boxes.find((box) => box.id === 'large').h, 40);

  const panel = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [50, 50] }, children: ['tall', 'inherited'] },
      tall: { id: 'tall', type: 'panel', props: { size: [10, 20] }, children: [] },
      inherited: { id: 'inherited', type: 'panel', props: { size: [10, 0], inherit_max_sibling_height: true }, children: [] },
    },
  };
  const panelLayout = computeLayoutBoxesForFile(panel, { width: 50, height: 50, name: 'sibling-max-panel' });
  assertEqual(panelLayout.boxes.find((box) => box.id === 'inherited').h, 20);
});

test('omitted stack children content-fit the main axis and fill the cross axis', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'stack_panel', props: { size: [100, 130], orientation: 'vertical' }, children: ['pad', 'text-box', 'gap', 'fill-a', 'main', 'fill-b'] },
      pad: { id: 'pad', type: 'panel', props: { size: ['100%', 6] }, children: [] },
      'text-box': { id: 'text-box', type: 'stack_panel', props: { size: ['default', 'default'], orientation: 'vertical' }, propsPresent: { size: false }, children: ['label', 'edit'] },
      label: { id: 'label', type: 'label', props: { text: 'map.name', size: ['default', 'default'] }, propsPresent: { size: false }, children: [] },
      edit: { id: 'edit', type: 'panel', props: { size: [80, 20] }, children: [] },
      gap: { id: 'gap', type: 'panel', props: { size: ['100%', 4] }, children: [] },
      'fill-a': { id: 'fill-a', type: 'panel', props: { size: ['100%', 'fill'] }, children: [] },
      main: { id: 'main', type: 'panel', props: { size: ['100%', 20] }, children: [] },
      'fill-b': { id: 'fill-b', type: 'panel', props: { size: ['100%', 'fill'] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 100, height: 130, name: 'cartography-stack' });
  const textBox = layout.boxes.find((box) => box.id === 'text-box');
  const main = layout.boxes.find((box) => box.id === 'main');
  assertDeepEqual([textBox.w, textBox.h], [100, 28]);
  assertEqual(main.y, 74);
});

test('content-sized grids aggregate authored rows instead of collapsing to one row', () => {
  const file = {
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: [100, '100%c'], grid_dimensions: [1, 3] }, children: ['a', 'b', 'c'] },
      a: { id: 'a', type: 'panel', props: { size: [10, 20] }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: [10, 20] }, children: [] },
      c: { id: 'c', type: 'panel', props: { size: [10, 20] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 100, height: 100, name: 'grid-content-size' });
  assertEqual(layout.boxes.find((box) => box.id === 'grid').h, 60);
  assertDeepEqual(['a', 'b', 'c'].map((id) => {
    const box = layout.boxes.find((item) => item.id === id);
    return [box.y, box.h];
  }), [[0, 20], [20, 20], [40, 20]]);
});

test('grid default axes, item caps, gap aliases, and sibling inheritance share measured geometry', () => {
  const gridWith = (gridProps, children) => ({
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: gridProps, children: children.map((child) => child.id) },
      ...Object.fromEntries(children.map((child) => [child.id, child])),
    },
  });
  const six = Array.from({ length: 6 }, (_, index) => ({
    id: `item-${index}`,
    type: 'panel',
    props: { size: [10, 10] },
    children: [],
  }));
  const defaultAxis = computeLayoutBoxesForFile(gridWith({
    size: [100, 'default'],
    grid_dimensions: [2, 3],
    grid_rescaling_type: 'horizontal',
  }, six), { width: 100, height: 80, name: 'grid-default-axis' });
  assertEqual(defaultAxis.boxes.find((box) => box.id === 'grid').h, 30);

  const cappedEmpty = computeLayoutBoxesForFile(gridWith({
    size: ['100%c', '100%c'],
    grid_dimensions: [2, 1],
    maximum_grid_items: 0,
  }, six.slice(0, 2)), { width: 100, height: 80, name: 'grid-empty-cap' });
  assertDeepEqual(
    ['w', 'h'].map((axis) => cappedEmpty.boxes.find((box) => box.id === 'grid')[axis]),
    [0, 0],
  );

  const cappedSiblingGroup = computeLayoutBoxesForFile(gridWith({
    size: ['100%cm', 10],
    grid_dimensions: [1, 1],
    maximum_grid_items: 1,
    grid_rescaling_type: 'none',
  }, [
    { id: 'included', type: 'panel', props: { size: [10, 10], inherit_max_sibling_width: true }, children: [] },
    { id: 'excluded', type: 'panel', props: { size: [100, 10] }, children: [] },
  ]), { width: 100, height: 20, name: 'grid-capped-sibling-group' });
  assertEqual(cappedSiblingGroup.boxes.find((box) => box.id === 'grid').w, 10);
  assertEqual(cappedSiblingGroup.boxes.find((box) => box.id === 'included').w, 10);
  assert(!cappedSiblingGroup.boxes.some((box) => box.id === 'excluded'));

  const withGap = computeLayoutBoxesForFile(gridWith({
    size: ['100%c', '100%c'],
    grid_dimensions: [2, 1],
    grid_gapx: 20,
  }, six.slice(0, 2)), { width: 100, height: 80, name: 'grid-gap-alias' });
  assertEqual(withGap.boxes.find((box) => box.id === 'grid').w, 40);
  assertEqual(withGap.boxes.find((box) => box.id === 'item-1').x, 30);

  const siblings = computeLayoutBoxesForFile(gridWith({
    size: [40, 10],
    grid_dimensions: [2, 1],
    grid_rescaling_type: 'none',
  }, [
    { id: 'wide', type: 'panel', props: { size: [20, 10] }, children: [] },
    { id: 'inheriting', type: 'panel', props: { size: [5, 10], inherit_max_sibling_width: true }, children: [] },
  ]), { width: 40, height: 10, name: 'grid-sibling-inheritance' });
  assertEqual(siblings.boxes.find((box) => box.id === 'inheriting').w, 20);

  const cellRelativeSiblings = computeLayoutBoxesForFile(gridWith({
    size: [100, 20],
    grid_dimensions: [2, 1],
  }, [
    { id: 'cell-fill', type: 'panel', props: { size: ['100%', 10] }, children: [] },
    { id: 'cell-inheriting', type: 'panel', props: { size: [10, 10], inherit_max_sibling_width: true }, children: [] },
  ]), { width: 100, height: 20, name: 'grid-cell-sibling-inheritance' });
  assertDeepEqual(
    ['cell-fill', 'cell-inheriting'].map((id) => cellRelativeSiblings.boxes.find((box) => box.id === id).w),
    [100, 100],
  );

  const cellRelativeOffset = computeLayoutBoxesForFile(gridWith({
    size: [100, 20],
    grid_dimensions: [2, 1],
  }, [
    { id: 'offset-peer', type: 'panel', props: { size: ['100%', 10], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    { id: 'offset-child', type: 'panel', props: { size: [20, 10], offset: ['100%sm', 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
  ]), { width: 100, height: 20, name: 'grid-cell-local-offset' });
  assertEqual(cellRelativeOffset.boxes.find((box) => box.id === 'offset-child').x, 150);

  const peerGrid = (coefficient) => computeLayoutBoxesForFile(gridWith({
    size: [500, 20],
    grid_dimensions: [2, 1],
    grid_rescaling_type: 'none',
  }, [
    { id: 'peer-a', type: 'panel', props: { size: [`${coefficient}%sm + 1px`, 10] }, children: [] },
    { id: 'peer-b', type: 'panel', props: { size: [`${coefficient}%sm + 1px`, 10] }, children: [] },
  ]), { width: 500, height: 20, name: `grid-cell-peer-${coefficient}` });
  const finitePeers = peerGrid(99);
  assert(Math.abs(finitePeers.boxes.find((box) => box.id === 'peer-a').w - 100) < 0.001);
  assert(!finitePeers.warnings.some((warning) => warning.startsWith('GRID_CELL_SIBLING_FIXED_POINT_LIMIT')));
  const divergentPeers = peerGrid(100);
  assertDeepEqual(
    ['peer-a', 'peer-b'].map((id) => divergentPeers.boxes.find((box) => box.id === id).w),
    [1, 1],
  );
  assert(divergentPeers.warnings.some((warning) => warning.startsWith('GRID_CELL_SIBLING_FIXED_POINT_LIMIT')));

  const inferredItems = Array.from({ length: 36 }, (_, index) => ({
    id: `inferred-${index}`,
    type: 'panel',
    props: { size: [18, 18] },
    children: [],
  }));
  const inferred = computeLayoutBoxesForFile(gridWith({
    size: [90, 'default'],
    grid_rescaling_type: 'horizontal',
    maximum_grid_items: 36,
  }, inferredItems), { width: 90, height: 200, name: 'grid-inferred-default' });
  assertEqual(inferred.boxes.find((box) => box.id === 'grid').h, 144);
  const inferredLast = inferred.boxes.find((box) => box.id === 'inferred-35');
  assertEqual(inferredLast.y + inferredLast.h, 144);
});

test('size-omitted fixed-template grids use natural tracks across standard dimensions', () => {
  const cases = [
    { name: 'hopper', dimensions: [5, 1], expected: [90, 18] },
    { name: 'crafter', dimensions: [3, 3], expected: [54, 54] },
    { name: 'horse', dimensions: [1, 2], expected: [18, 36] },
  ];
  for (const item of cases) {
    const [columns, rows] = item.dimensions;
    const children = Array.from({ length: columns * rows }, (_, index) => `slot-${index}`);
    const nodesById = {
      grid: {
        id: 'grid', type: 'grid',
        props: { size: ['default', 'default'], grid_dimensions: item.dimensions },
        propsPresent: { size: false },
        children,
      },
    };
    for (const childId of children) {
      nodesById[childId] = { id: childId, type: 'panel', props: { size: [18, 18] }, children: [] };
    }
    const layout = computeLayoutBoxesForFile(
      { rootId: 'grid', nodesById },
      { width: 176, height: 166, name: `natural-grid-${item.name}` },
    );
    const grid = layout.boxes.find((box) => box.id === 'grid');
    assertDeepEqual([grid.w, grid.h], item.expected);
    const slots = children.map((id) => layout.boxes.find((box) => box.id === id));
    for (let index = 1; index < slots.length; index += 1) {
      const previous = slots[index - 1];
      const current = slots[index];
      if (index % columns === 0) {
        assertEqual(current.x, slots[0].x);
        assertEqual(current.y - previous.y, 18);
      } else {
        assertEqual(current.x - previous.x, 18);
        assertEqual(current.y, previous.y);
      }
    }
  }
});

test('size-omitted grids use parent extent only for initial percentage constraints', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'host',
    nodesById: {
      host: { id: 'host', type: 'panel', props: { size: [320, 207], anchor_from: 'top_left', anchor_to: 'top_left' }, children: ['grid'] },
      grid: {
        id: 'grid', type: 'grid', props: { size: ['default', 'default'], grid_dimensions: [2, 1], anchor_from: 'top_left', anchor_to: 'top_left' },
        propsPresent: { size: false }, children: ['left', 'right'],
      },
      left: { id: 'left', type: 'panel', props: { size: [160, 207], max_size: ['100%', '100%'] }, children: [] },
      right: { id: 'right', type: 'panel', props: { size: [160, 207], max_size: ['100%', '100%'] }, children: [] },
    },
  }, { width: 320, height: 207, name: 'book-natural-grid' });
  const grid = layout.boxes.find((box) => box.id === 'grid');
  const left = layout.boxes.find((box) => box.id === 'left');
  const right = layout.boxes.find((box) => box.id === 'right');
  assertDeepEqual([grid.w, grid.h], [320, 207]);
  assertDeepEqual([left.w, left.h, right.w, right.h], [160, 207, 160, 207]);
  assertEqual(right.x, left.x + 160);

  const empty = computeLayoutBoxesForFile({
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: ['default', 'default'], grid_dimensions: [2, 1] }, propsPresent: { size: false }, children: [] },
    },
  }, { width: 320, height: 207, name: 'empty-natural-grid' });
  assertDeepEqual([empty.boxes[0].w, empty.boxes[0].h], [0, 0]);

  const percentOnly = computeLayoutBoxesForFile({
    rootId: 'grid',
    nodesById: {
      grid: { id: 'grid', type: 'grid', props: { size: ['default', 'default'], grid_dimensions: [1, 1] }, propsPresent: { size: false }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: ['100%', '100%'], max_size: ['100%', '100%'] }, children: [] },
    },
  }, { width: 320, height: 207, name: 'percent-cycle-natural-grid' });
  assertDeepEqual([percentOnly.boxes.find((box) => box.id === 'grid').w, percentOnly.boxes.find((box) => box.id === 'grid').h], [0, 0]);
});

test('stack fill allocation remeasures descendant content bases in the allocated extent', () => {
  const layout = computeLayoutBoxesForFile({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'stack_panel', props: { size: [100, 20], orientation: 'horizontal' }, children: ['fixed', 'fill'] },
      fixed: { id: 'fixed', type: 'panel', props: { size: [40, 20], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
      fill: {
        id: 'fill',
        type: 'panel',
        props: { size: ['fill', 20], offset: ['100%c', 0], anchor_from: 'top_left', anchor_to: 'top_left' },
        children: ['inner'],
      },
      inner: { id: 'inner', type: 'panel', props: { size: ['100%', 20], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  }, { width: 100, height: 20, name: 'stack-allocated-content' });
  assertDeepEqual(['fill', 'inner'].map((id) => {
    const box = layout.boxes.find((item) => item.id === id);
    return [box.x, box.w];
  }), [[100, 60], [100, 60]]);
  assert(!layout.warnings.some((warning) => warning.startsWith('ALLOCATED_SUBTREE_CONTEXT_LIMIT')));
});

test('slowly convergent content equations reach their finite fixed point within a bounded work budget', () => {
  const makeFile = (coefficient) => ({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [`${coefficient}%c + 10px`, 10] }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: ['100%', 10] }, children: [] },
    },
  });
  const ninety = computeLayoutBoxesForFile(makeFile(90), { width: 1000, height: 100, name: 'content-90' });
  const ninetyEight = computeLayoutBoxesForFile(makeFile(98), { width: 1000, height: 100, name: 'content-98' });
  assert(Math.abs(ninety.boxes.find((box) => box.id === 'root').w - 100) < 0.01);
  assert(Math.abs(ninetyEight.boxes.find((box) => box.id === 'root').w - 500) < 0.01);
  assert(!ninety.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
  assert(!ninetyEight.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('stack default content sizing participates in convergence and fails closed on divergence', () => {
  const makeFile = (childWidth) => ({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'stack_panel', props: { size: ['default', 10], orientation: 'horizontal' }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: [childWidth, 10] }, children: [] },
    },
  });
  const convergent = computeLayoutBoxesForFile(makeFile('50% + 10px'), { width: 500, height: 20, name: 'default-convergent' });
  assert(Math.abs(convergent.boxes.find((box) => box.id === 'root').w - 20) < 0.01);
  assert(Math.abs(convergent.boxes.find((box) => box.id === 'child').w - 20) < 0.01);
  assert(!convergent.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));

  const divergent = computeLayoutBoxesForFile(makeFile('100% + 10px'), { width: 500, height: 20, name: 'default-divergent' });
  assertEqual(divergent.boxes.find((box) => box.id === 'root').w, 0);
  assertEqual(divergent.boxes.find((box) => box.id === 'child').w, 10);
  assert(divergent.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('mutually dependent sibling percentages converge without coordinate-wise extrapolation', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [500, 20] }, children: ['a', 'b'] },
      a: { id: 'a', type: 'panel', props: { size: ['90%sm + 10px', 10] }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: ['80%sm + 5px', 10] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 500, height: 20, name: 'sibling-fixed-point' });
  assert(Math.abs(layout.boxes.find((box) => box.id === 'a').w - 51.785714) < 0.01);
  assert(Math.abs(layout.boxes.find((box) => box.id === 'b').w - 46.428571) < 0.01);
  assert(!layout.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('cached absolute leaf sizes still refresh sibling contexts used by offsets', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: {
        id: 'root',
        type: 'panel',
        props: { size: ['100%c', 10], use_child_anchors: true, anchor_from: 'top_left', anchor_to: 'top_left' },
        children: ['a', 'b'],
      },
      a: { id: 'a', type: 'panel', props: { size: [10, 10], offset: ['100%sm', 0], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: [20, 10], anchor_from: 'top_left', anchor_to: 'top_left' }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 100, height: 20, name: 'static-leaf-offset-context' });
  assertEqual(layout.boxes.find((box) => box.id === 'root').w, 30);
  assertEqual(layout.boxes.find((box) => box.id === 'a').x, 20);
});

test('oscillating signed content equations converge to their finite fixed point', () => {
  const makeFile = (coefficient) => ({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'stack_panel', props: { size: [`100px - ${coefficient}%c`, 10] }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: ['100%', 10] }, children: [] },
    },
  });
  const fifty = computeLayoutBoxesForFile(makeFile(50), { width: 500, height: 20, name: 'signed-content-50' });
  const eighty = computeLayoutBoxesForFile(makeFile(80), { width: 500, height: 20, name: 'signed-content-80' });
  assert(Math.abs(fifty.boxes.find((box) => box.id === 'root').w - (100 / 1.5)) < 0.01);
  assert(Math.abs(eighty.boxes.find((box) => box.id === 'root').w - (100 / 1.8)) < 0.01);
  assert(!fifty.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
  assert(!eighty.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('verified acceleration resolves near-unit content equations without premature convergence', () => {
  const makeFile = (coefficient, constant) => ({
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [`${coefficient}%c + ${constant}px`, 10] }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: ['100%', 10] }, children: [] },
    },
  });
  const five = computeLayoutBoxesForFile(makeFile(99.999, 0.00005), { width: 100, height: 20, name: 'near-unit-five' });
  const fiveThousand = computeLayoutBoxesForFile(makeFile(99.999999, 0.00005), { width: 100, height: 20, name: 'near-unit-five-thousand' });
  assert(Math.abs(five.boxes.find((box) => box.id === 'root').w - 5) < 0.001);
  assert(Math.abs(fiveThousand.boxes.find((box) => box.id === 'root').w - 5000) < 0.001);
  assert(!five.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
  assert(!fiveThousand.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('convergence validation observes high-gain sibling updates before accepting geometry', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [1, 20] }, children: ['a', 'b'] },
      a: { id: 'a', type: 'panel', props: { size: ['0.0001%sm', 10] }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: ['10000000%sm + 10px', 10] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 1, height: 20, name: 'high-gain-siblings' });
  assert(Math.abs(layout.boxes.find((box) => box.id === 'a').w - 0.0000111111) < 1e-7);
  assert(Math.abs(layout.boxes.find((box) => box.id === 'b').w - 11.111111) < 0.001);
  assert(!layout.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('convergence tracks natural sibling sizes hidden by inheritance', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [200, 20] }, children: ['a', 'b'] },
      a: { id: 'a', type: 'panel', props: { size: ['100px - 150%sm', 10], inherit_max_sibling_width: true }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: ['100px - 150%sm', 10], inherit_max_sibling_width: true }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 200, height: 20, name: 'natural-inheritance-state' });
  assert(Math.abs(layout.boxes.find((box) => box.id === 'a').w - 40) < 0.001);
  assert(Math.abs(layout.boxes.find((box) => box.id === 'b').w - 40) < 0.001);
});

test('nonconvergent content fallback preserves a stable axis and recomputes descendants', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: ['100%c + 10px', '100%c'] }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: ['100%', 20] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 200, height: 100, name: 'axis-fallback' });
  assertDeepEqual(['root', 'child'].map((id) => {
    const box = layout.boxes.find((item) => item.id === id);
    return [box.w, box.h];
  }), [[10, 20], [10, 20]]);
  assert(layout.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('extreme authored extents stay finite and report the shared layout safety limit', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'stack_panel', props: { orientation: 'horizontal', size: ['100%c', 10] }, children: ['a', 'b'] },
      a: { id: 'a', type: 'panel', props: { size: [Number.MAX_VALUE, 10] }, children: [] },
      b: { id: 'b', type: 'panel', props: { size: [Number.MAX_VALUE, 10] }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 100, height: 20, name: 'extreme-layout' });
  assert(layout.boxes.length === 3);
  assert(layout.boxes.every((box) => [box.x, box.y, box.w, box.h].every(Number.isFinite)));
  assert(layout.warnings.some((warning) => warning.startsWith('LAYOUT_SIZE_LIMIT:')));
});

test('a recursive size safety clamp is treated as divergence and recomputes descendants from fallback geometry', () => {
  const clampedLoop = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: ['200%c + 10px', 10] }, children: ['child'] },
      child: { id: 'child', type: 'panel', props: { size: ['100%', 10] }, children: [] },
    },
  };
  const limited = computeLayoutBoxesForFile(clampedLoop, { width: 100, height: 20, name: 'clamped-loop' });
  assertDeepEqual(['root', 'child'].map((id) => limited.boxes.find((box) => box.id === id).w), [10, 10]);
  assert(limited.warnings.includes('CONTENT_SIZE_FIXED_POINT_LIMIT:limit'));

  const descendantClosure = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: ['100%c + 10px', 20] }, children: ['driver', 'clamped'] },
      driver: { id: 'driver', type: 'panel', props: { size: ['100% + 10px', 10] }, children: [] },
      clamped: { id: 'clamped', type: 'panel', props: { size: ['100%', 10], max_size: [100, 10] }, children: [] },
    },
  };
  const fallback = computeLayoutBoxesForFile(descendantClosure, { width: 200, height: 20, name: 'fallback-closure' });
  assertDeepEqual(['root', 'driver', 'clamped'].map((id) => fallback.boxes.find((box) => box.id === id).w), [10, 20, 10]);
  assert(fallback.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_FIXED_POINT_LIMIT')));
});

test('content measurement budget charges cached leaves in divergent trees', () => {
  const staticIds = Array.from({ length: 100 }, (_, index) => `static-${index}`);
  const nodesById = {
    root: { id: 'root', type: 'panel', props: { size: ['100%c + 10px', 20] }, children: ['driver', ...staticIds] },
    driver: { id: 'driver', type: 'panel', props: { size: ['100%', 10] }, children: [] },
    ...Object.fromEntries(staticIds.map((id) => [id, { id, type: 'panel', props: { size: [1, 1] }, children: [] }])),
  };
  const layout = computeLayoutBoxesForFile(
    { rootId: 'root', nodesById },
    { width: 200, height: 20, name: 'bounded-divergent-tree' },
    { maxBoxes: 60 },
  );
  assert(layout.warnings.includes('CONTENT_SIZE_MEASUREMENT_BUDGET:10000'));
  assert(layout.warnings.includes('CONTENT_SIZE_FIXED_POINT_LIMIT:budget'));
  assert(layout.boxes.every((box) => [box.x, box.y, box.w, box.h].every(Number.isFinite)));
});

test('an explicitly default-sized empty grid uses zero content instead of inheriting its parent extent', () => {
  const file = {
    rootId: 'scrolling-content',
    nodesById: {
      'scrolling-content': {
        id: 'scrolling-content',
        type: 'input_panel',
        props: { size: [132, '100%c + 2px'] },
        children: ['runtime-grid'],
      },
      'runtime-grid': {
        id: 'runtime-grid',
        type: 'grid',
        props: {
          size: ['100%', 'default'],
          collection_name: 'runtime_rows',
          grid_item_template: 'pack.row',
          grid_rescaling_type: 'horizontal',
        },
        children: [],
      },
    },
  };
  const layout = computeLayoutBoxesForFile(
    file,
    { width: 480, height: 270, name: 'empty-runtime-grid' },
    { maxBoxes: 60 },
  );
  assertDeepEqual(['scrolling-content', 'runtime-grid'].map((id) => {
    const box = layout.boxes.find((item) => item.id === id);
    return [box.w, box.h];
  }), [[132, 2], [132, 0]]);
  assert(!layout.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_')));

  const implicit = computeLayoutBoxesForFile({
    rootId: 'implicit-grid',
    nodesById: {
      'implicit-grid': { id: 'implicit-grid', type: 'grid', props: {}, children: [] },
    },
  }, { width: 480, height: 270, name: 'implicit-empty-grid' });
  const implicitBox = implicit.boxes.find((item) => item.id === 'implicit-grid');
  assertDeepEqual([implicitBox.w, implicitBox.h], [480, 270]);
});

test('a populated default-sized runtime grid derives its height from materialized rows', () => {
  const itemIds = Array.from({ length: 12 }, (_, index) => `runtime-item-${index}`);
  const file = {
    rootId: 'scrolling-content',
    nodesById: {
      'scrolling-content': {
        id: 'scrolling-content',
        type: 'input_panel',
        props: { size: [132, '100%c + 2px'] },
        children: ['runtime-grid'],
      },
      'runtime-grid': {
        id: 'runtime-grid',
        type: 'grid',
        props: { size: ['100%', 'default'], grid_rescaling_type: 'horizontal' },
        children: itemIds,
      },
      ...Object.fromEntries(itemIds.map((id) => [id, {
        id,
        type: 'panel',
        props: { size: [18, 18] },
        children: [],
      }])),
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 480, height: 270, name: 'populated-runtime-grid' });
  assertDeepEqual(['scrolling-content', 'runtime-grid'].map((id) => {
    const box = layout.boxes.find((item) => item.id === id);
    return [box.w, box.h];
  }), [[132, 38], [132, 36]]);
  assert(!layout.warnings.some((warning) => warning.startsWith('CONTENT_SIZE_')));
});

test('safe preview omits a factory-backed leaf panel until runtime instances exist', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [40, 40] }, children: ['factory-owner'] },
      'factory-owner': { id: 'factory-owner', type: 'panel', props: { factory: { name: 'tips' }, size: [20, 20] }, children: [] },
    },
  };
  assertDeepEqual(computeLayoutBoxesForFile(file, { width: 40, height: 40, name: 'factory-safe' }).boxes.map((box) => box.id), ['root']);
  assertDeepEqual(computeLayoutBoxesForFile(file, { width: 40, height: 40, name: 'factory-debug' }, { visibilityMode: 'structure' }).boxes.map((box) => box.id), ['root', 'factory-owner']);
});

test('texture base_size changes only explicitly-authored default axes', () => {
  const omitted = { type: 'image', propsPresent: { size: false } };
  const explicit = { type: 'image', propsPresent: { size: true } };
  assertEqual(mergeExplicitTextureBaseSize(omitted, ['default', 'default'], [6, 6]), null);
  assertDeepEqual(mergeExplicitTextureBaseSize(explicit, ['default', 'default'], [6, 6]), [6, 6]);
  assertDeepEqual(mergeExplicitTextureBaseSize(explicit, ['default', 20], [6, 6]), [6, 20]);
  assertEqual(mergeExplicitTextureBaseSize(explicit, [130, 20], [6, 6]), null);
  assertEqual(mergeExplicitTextureBaseSize(explicit, ['default', 'default'], [0, 6]), null);

  const file = {
    rootId: 'edit',
    nodesById: {
      edit: { id: 'edit', type: 'edit_box', props: { size: [130, 20] }, propsPresent: { size: true }, children: ['state'] },
      state: { id: 'state', type: 'image', props: { size: ['default', 'default'] }, propsPresent: { size: false }, children: [] },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 480, height: 270, name: 'omitted-image-size' });
  const state = layout.boxes.find((box) => box.id === 'state');
  assertDeepEqual([state.w, state.h], [130, 20]);
});

test('safe preview preserves an authored native renderer size for content-sized parents', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [100, 100] }, children: ['outline'] },
      outline: {
        id: 'outline', type: 'image', props: { size: ['100%c + 2px', '100%c + 2px'] },
        propsPresent: { size: true }, children: ['banner'],
      },
      banner: {
        id: 'banner', type: 'custom', props: { renderer: 'banner_pattern_renderer', size: [20, 40] },
        propsPresent: { size: true }, children: [],
      },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 100, height: 100, name: 'loom-result-banner' });
  const byId = Object.fromEntries(layout.boxes.map((box) => [box.id, box]));
  assertDeepEqual([byId.banner.w, byId.banner.h], [20, 40]);
  assertDeepEqual([byId.outline.w, byId.outline.h], [22, 42]);
});

test('size-omitted native renderer geometry fills its parent without inventing a fallback extent', () => {
  const file = {
    rootId: 'slot',
    nodesById: {
      slot: {
        id: 'slot', type: 'panel', props: { size: [18, 18] },
        propsPresent: { size: true }, children: ['item', 'future'],
      },
      item: {
        id: 'item', type: 'custom',
        props: { renderer: 'inventory_item_renderer', size: ['default', 'default'] },
        propsPresent: { size: false }, children: [],
      },
      future: {
        id: 'future', type: 'custom',
        props: { renderer: 'future_native_renderer', size: ['default', 'default'] },
        propsPresent: { size: false }, children: [],
      },
    },
  };
  const layout = computeLayoutBoxesForFile(file, { width: 100, height: 100, name: 'native-parent-fill' });
  const byId = Object.fromEntries(layout.boxes.map((box) => [box.id, box]));
  assertDeepEqual([byId.item.w, byId.item.h], [18, 18]);
  assertDeepEqual([byId.future.w, byId.future.h], [18, 18]);
});

test('safe preview preserves native custom geometry and authored renderer children', () => {
  const file = {
    rootId: 'root',
    nodesById: {
      root: { id: 'root', type: 'panel', props: { size: [60, 30] }, children: ['runtime-custom', 'static-factory'] },
      'runtime-custom': { id: 'runtime-custom', type: 'custom', props: { renderer: 'bundle_tooltip_renderer' }, children: ['purple'] },
      purple: { id: 'purple', type: 'image', props: { size: [40, 20], texture: 'textures/ui/purpleBorder' }, children: [] },
      'static-factory': { id: 'static-factory', type: 'panel', props: { factory: { name: 'slider_step' }, size: [20, 10] }, children: ['track'] },
      track: { id: 'track', type: 'image', props: { size: [20, 5], texture: 'textures/ui/track' }, children: [] },
    },
  };
  assertDeepEqual(
    computeLayoutBoxesForFile(file, { width: 60, height: 30, name: 'runtime-safe' }).boxes.map((box) => box.id),
    ['root', 'runtime-custom', 'purple', 'static-factory', 'track'],
  );
  assertDeepEqual(
    computeLayoutBoxesForFile(file, { width: 60, height: 30, name: 'runtime-structure' }, { visibilityMode: 'structure' }).boxes.map((box) => box.id),
    ['root', 'runtime-custom', 'purple', 'static-factory', 'track'],
  );
});

test('drawable image count excludes zero UV and fully transparent tint states', () => {
  const boxes = [{ id: 'zero-uv', type: 'image', w: 10, h: 10, renderAlpha: 1 }, { id: 'zero-tint', type: 'image', w: 10, h: 10, renderAlpha: 1 }];
  const nodesById = {
    'zero-uv': { type: 'image', props: { texture: 'textures/ui/a', uv_size: [0, 0] } },
    'zero-tint': { type: 'image', props: { texture: 'textures/ui/b', color: [1, 1, 1, 0] } },
  };
  assertEqual(countDrawableCanvasBoxes({ boxes, nodesById, isTextureResolvable: () => true }), 0);
});
