/*
  Representative Classic runtime context

  Minecraft normally supplies these values when a JSON UI screen is opened.
  The browser preview has no game runtime, so it uses a deliberately small,
  deterministic Classic/desktop context. Screen titles are inferred only for
  exact Vanilla screen symbols whose default localization key is stable.
*/

import { buildClassicEmptySlotCollections, EMPTY_CLASSIC_SLOT_ROW } from './classic-empty-slots.js';
const ZERO_SAFE_ZONE = Object.freeze([0, 0]);
const MAX_COLLECTION_ENTRIES_INSPECTED = 512;
const MAX_REPRESENTATIVE_ROWS_PER_COLLECTION = 512;
const MAX_REPRESENTATIVE_ROWS_TOTAL = 2048;
const PROTECTED_COLLECTION_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const FACTORY_CONTROL_ID_SELECTOR_KEYS = Object.freeze([
  '__jsonui_preview_factory_control_id',
]);

export const REPRESENTATIVE_CLASSIC_PLATFORM_VARIABLES = Object.freeze({
  '$desktop_screen': true,
  '$pocket_screen': false,
  '$scroll_bar_contained': false,
  '$touch': false,
  '$left_horizontal_safezone_size': ZERO_SAFE_ZONE,
  '$right_horizontal_safezone_size': ZERO_SAFE_ZONE,
  '$top_vertical_safezone_size': ZERO_SAFE_ZONE,
  '$bottom_vertical_safezone_size': ZERO_SAFE_ZONE,
  '$is_ps4': false,
  '$is_full_screen_layout': false,
  '$show_close_button': true,
  '$use_compact_close_button': false,
  '$default_button_alpha': 1,
});

// Exact names supplied by the Classic screen/runtime rather than by
// `_global_variables.json`. This list is intentionally conservative: unknown
// `$...` names must still be reported as possible pack mistakes.
export const REPRESENTATIVE_CLASSIC_RUNTIME_VARIABLE_NAMES = Object.freeze([
  ...Object.keys(REPRESENTATIVE_CLASSIC_PLATFORM_VARIABLES),
  '$container_title',
  '$localize_title',
  '$food_index',
  '$blocks_index',
  '$items_index',
  '$search_index',
  '$construction_index',
  '$equipment_index',
  '$nature_index',
  '$recipe_book_layout_index',
  '$survival_layout_index',
  '$creative_layout_index',
]);

// Qualified names and fixed title keys come from the corresponding Mojang
// Classic screen definitions. Runtime-polymorphic screens (for example horse
// and trade screens) are intentionally absent because their title cannot be
// inferred safely from the JSON UI symbol alone.
export const STANDARD_CLASSIC_SCREEN_TITLE_KEYS = Object.freeze({
  'anvil.anvil_screen': 'container.repair',
  'beacon.beacon_screen': 'container.beacon',
  'blast_furnace.blast_furnace_screen': 'container.blast_furnace',
  'brewing_stand.brewing_stand_screen': 'container.brewing',
  'cartography.cartography_screen': 'tile.cartography_table.name',
  'chest.small_chest_screen': 'container.chest',
  'chest.large_chest_screen': 'container.chestDouble',
  'chest.ender_chest_screen': 'container.enderchest',
  'chest.shulker_box_screen': 'container.shulkerBox',
  'chest.barrel_screen': 'container.barrel',
  'crafting.crafting_screen': 'container.crafting',
  'crafting.inventory_screen': 'container.inventory',
  'enchanting.enchanting_screen': 'container.enchant',
  'furnace.furnace_screen': 'container.furnace',
  'grindstone.grindstone_screen': 'container.repairAndDisenchant',
  'loom.loom_screen': 'container.loom',
  'redstone.hopper_screen': 'container.hopper',
  'redstone.dispenser_screen': 'container.dispenser',
  'redstone.dropper_screen': 'container.dropper',
  'redstone.crafter_screen': 'container.crafter',
  'smithing_table.smithing_table_screen': 'container.smithing_table.upgrade',
  'smoker.smoker_screen': 'container.smoker',
  'stonecutter.stonecutter_screen': 'container.stonecutter',
});

// Unlike the fixed titles above, horse_screen is runtime-polymorphic. The
// same exact representative scenario used for its bindings below is a normal
// horse, so its title may be supplied coherently without claiming that every
// live entity opened by Minecraft has that name. Explicit user data still
// wins in buildRepresentativeClassicResolverVariables().
const STANDARD_CLASSIC_REPRESENTATIVE_VARIANT_TITLE_KEYS = Object.freeze({
  'horse.horse_screen': 'entity.horse.name',
});

const STANDARD_CLASSIC_RECIPE_BOOK_SCREENS = new Set([
  'blast_furnace.blast_furnace_screen',
  'crafting.crafting_screen',
  'crafting.inventory_screen',
  'furnace.furnace_screen',
  'smoker.smoker_screen',
]);

const STANDARD_CLASSIC_RECIPE_BOOK_RUNTIME_VARIABLE_NAMES = Object.freeze([
  '$food_index',
  '$blocks_index',
  '$items_index',
  '$search_index',
  '$construction_index',
  '$equipment_index',
  '$nature_index',
  '$recipe_book_layout_index',
  '$survival_layout_index',
  '$creative_layout_index',
]);

const STANDARD_CLASSIC_CARTOGRAPHY_BINDING_DEFAULTS = Object.freeze({
  '#is_none_mode': true,
  '#is_clone_mode': false,
  '#is_rename_mode': false,
  '#is_basic_map_mode': false,
  '#is_locator_map_mode': false,
  '#is_extend_mode': false,
  '#is_locked_mode': false,
});

const STANDARD_CLASSIC_BEACON_COLLECTION_NAMES = Object.freeze([
  'speed',
  'haste',
  'resist',
  'jump',
  'strength',
  'regen',
  'extra',
  'confirm',
  'cancel',
]);

// A representative collection needs enough bounded rows to exercise the
// authored scrolling grid. Banner pattern/color pixels remain native runtime
// data and are intentionally not fabricated.
export const REPRESENTATIVE_CLASSIC_LOOM_PATTERN_COUNT = 42;

const REPRESENTATIVE_LOOM_PATTERN_ROWS = Object.freeze(Array.from(
  { length: REPRESENTATIVE_CLASSIC_LOOM_PATTERN_COUNT },
  (_, index) => Object.freeze({
    '#pattern_selector_total_items': REPRESENTATIVE_CLASSIC_LOOM_PATTERN_COUNT,
    '#pattern_cell_background_texture': 'textures/ui/recipe_book_item_bg',
    '#banner_patterns': Object.freeze([index]),
    '#banner_colors': Object.freeze([index % 16]),
  }),
));

const packLegacyItem = (legacyId, aux = 0) => legacyId * 0x1_0000 + aux;

const REPRESENTATIVE_BOOK_PAGES = Object.freeze([
  Object.freeze({
    '#page_visible': true,
    '#is_text_page': true,
    '#is_photo_page': false,
    '#page_number': '1 / 2',
    '#text_box_item_name': 'Preview page 1',
    '#editable': true,
    '#edit_controls_active': false,
    '#edit_button_active': true,
    '#insert_page_active': true,
    '#insert_photo_page_active': true,
    '#swap_left_active': false,
    '#swap_right_active': true,
  }),
  Object.freeze({
    '#page_visible': true,
    '#is_text_page': true,
    '#is_photo_page': false,
    '#page_number': '2 / 2',
    '#text_box_item_name': 'Preview page 2',
    '#editable': true,
    '#edit_controls_active': false,
    '#edit_button_active': true,
    '#insert_page_active': true,
    '#insert_photo_page_active': true,
    '#swap_left_active': true,
    '#swap_right_active': false,
  }),
]);

const REPRESENTATIVE_CHAT_MESSAGE_ROWS = Object.freeze([
  Object.freeze({
    __jsonui_preview_factory_control_id: 'chat_screen_messages',
    '#text': '<Alex> Hello!',
    '#text_tts': 'Alex says hello',
    '#chat_visible': true,
  }),
  Object.freeze({
    __jsonui_preview_factory_control_id: 'chat_screen_messages',
    '#text': '<Steve> Welcome!',
    '#text_tts': 'Steve says welcome',
    '#chat_visible': true,
  }),
]);

// These are exact-screen runtime/template inputs in Mojang's stock Classic
// definitions. They are names only: photo textures and tooltip targets are not
// fabricated because their values depend on live game state. Keeping the list
// screen-scoped prevents a custom pack that reuses one name from hiding a typo.
const STANDARD_CLASSIC_SCREEN_RUNTIME_VARIABLE_NAMES = Object.freeze({
  'chat.chat_screen': Object.freeze([
    '$chat_font_type',
    '$chat_font_scale_factor',
    '$chat_line_spacing',
    '$max_text_edit_length',
    '$option_tooltip_area',
    '$options_dropdown_toggle_label_text',
  ]),
  'book.book_screen': Object.freeze([
    '$screenshot_file_system',
    '$screenshot_frame_texture',
  ]),
});

const REPRESENTATIVE_TRADE_OFFERS = Object.freeze([
  Object.freeze({
    '#trade_toggle_enabled': true,
    '#trade_cross_out_visible': false,
    '#padding_around_sell_item': true,
    '#trade_possible': true,
    '#trade_toggle_state': true,
    '#hover_text': '',
  }),
  Object.freeze({
    '#trade_toggle_enabled': true,
    '#trade_cross_out_visible': false,
    '#padding_around_sell_item': true,
    '#trade_possible': true,
    '#trade_toggle_state': false,
    '#hover_text': '',
  }),
]);

function makeRepresentativeItemRow(legacyId, count = '') {
  return Object.freeze({
    '#is_selected_slot': false,
    '#item_id_aux': packLegacyItem(legacyId),
    // 数量labelの入力契約をpreview-stateと揃える。1個のstackは非表示、
    // 交易数量は文字列。ここで生成する代表行だけを対象にする。
    '#item_stack_count': count > 1 ? String(count) : '',
    '#inventory_stack_count': count > 1 ? String(count) : '',
    '#trade_item_count': String(count),
    '#second_trade_item_count': '',
    '#trade_price_different': false,
    '#item_valid': true,
    '#inactive_item': false,
    '#item_grayed_out': false,
    '#bundle_selected_item_visible': false,
    '#empty_image_visible': false,
    '#hover_text': '',
  });
}

export const REPRESENTATIVE_CLASSIC_RECIPE_BOOK_COLLECTION = Object.freeze({
  count: 136,
  bindingValues: Object.freeze({
    '#recipe_book_total_items': 136,
    '#container_item_background': 0,
    '#container_item_background_texture': 'textures/ui/recipe_book_item_bg',
  }),
});

function makeBeaconRepresentativeCollection(name) {
  return {
    count: 1,
    rowTemplate: Object.freeze({
      '#button_visible': true,
      '#active': true,
      '#inactive': false,
      '#selected': false,
      '#button_hover': '',
      '#extra_image_selection': name === 'speed',
    }),
  };
}

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copyDollarVariables(target, source) {
  if (!isObjectRecord(source)) return;
  for (const key of Object.keys(source)) {
    if (!key.startsWith('$')) continue;
    target[key] = source[key];
  }
}

function normalizeQualifiedName(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.startsWith('@') ? raw.slice(1) : raw;
}

/**
 * Return the representative localization key for an exact standard Classic
 * screen symbol, or null when the selected screen is custom or ambiguous.
 *
 * @param {unknown} qualifiedName
 * @returns {string|null}
 */
export function getStandardClassicScreenTitleKey(qualifiedName) {
  const normalized = normalizeQualifiedName(qualifiedName);
  return Object.prototype.hasOwnProperty.call(STANDARD_CLASSIC_SCREEN_TITLE_KEYS, normalized)
    ? STANDARD_CLASSIC_SCREEN_TITLE_KEYS[normalized]
    : null;
}

/**
 * Return true only for exact stock Classic screen symbols whose runtime owns
 * the recipe_book collection. A custom screen may reuse that collection name;
 * it must never receive fabricated rows solely because of the name collision.
 */
export function isStandardClassicRecipeBookScreen(qualifiedName) {
  return STANDARD_CLASSIC_RECIPE_BOOK_SCREENS.has(normalizeQualifiedName(qualifiedName));
}

function collectionRowCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!isObjectRecord(value)) return null;
  let maximumIndex = -1;
  let inspected = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (inspected >= MAX_COLLECTION_ENTRIES_INSPECTED) break;
    inspected += 1;
    if (!/^(?:0|[1-9]\d*)$/u.test(key)) continue;
    const index = Number(key);
    if (Number.isSafeInteger(index)) maximumIndex = Math.max(maximumIndex, index);
  }
  return maximumIndex >= 0 ? maximumIndex + 1 : 0;
}

function projectFactoryControlIdSelectors(rows, count, maximumRows, depth = 0, budget = { remaining: maximumRows }) {
  if (depth > 16 || budget.remaining <= 0) return null;
  const inspectedCount = Math.min(
    Number.isSafeInteger(count) && count >= 0 ? count : 0,
    Number.isSafeInteger(maximumRows) && maximumRows >= 0 ? maximumRows : 0,
    MAX_REPRESENTATIVE_ROWS_PER_COLLECTION,
    budget.remaining,
  );
  if (inspectedCount === 0) return null;
  const projected = Array.from({ length: inspectedCount }, () => Object.create(null));
  let found = false;
  budget.remaining -= inspectedCount;
  for (let index = 0; index < inspectedCount; index += 1) {
    let row;
    try {
      const rowDescriptor = Object.getOwnPropertyDescriptor(rows, String(index));
      row = rowDescriptor && Object.prototype.hasOwnProperty.call(rowDescriptor, 'value')
        ? rowDescriptor.value
        : null;
    } catch {
      row = null;
    }
    if (!isObjectRecord(row)) continue;
    for (const selectorKey of FACTORY_CONTROL_ID_SELECTOR_KEYS) {
      let selectorDescriptor;
      try {
        selectorDescriptor = Object.getOwnPropertyDescriptor(row, selectorKey);
      } catch {
        selectorDescriptor = null;
      }
      if (!selectorDescriptor || !Object.prototype.hasOwnProperty.call(selectorDescriptor, 'value')) continue;
      projected[index][selectorKey] = selectorDescriptor.value;
      found = true;
      break;
    }
    const nestedDescriptor = Object.getOwnPropertyDescriptor(row, '__collections');
    const nested = nestedDescriptor && Object.hasOwn(nestedDescriptor, 'value') ? nestedDescriptor.value : null;
    if (isObjectRecord(nested)) {
      const projectedCollections = Object.create(null);
      for (const name of Object.keys(nested).slice(0, 128)) {
        if (!name || PROTECTED_COLLECTION_NAMES.has(name)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(nested, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
        const nestedRows = descriptor.value;
        const nestedCount = collectionRowCount(nestedRows);
        if (nestedCount === null) continue;
        const projectedRows = projectFactoryControlIdSelectors(nestedRows, nestedCount, budget.remaining, depth + 1, budget);
        projectedCollections[name] = { count: nestedCount, ...(projectedRows ? { rows: projectedRows } : {}) };
      }
      if (Object.keys(projectedCollections).length) {
        projected[index].__collections = projectedCollections;
        found = true;
      }
    }
  }
  return found ? projected : null;
}

/**
 * Build the bounded collection scenario supplied to the static resolver.
 * Stock recipe-book rows are enabled only on exact stock screens. Explicit
 * user `__collections` data is marker/name-sensitive and always wins.
 */
export function buildRepresentativeClassicCollections(options = {}) {
  const safeOptions = isObjectRecord(options) ? options : {};
  const output = Object.create(null);
  const qualifiedName = normalizeQualifiedName(safeOptions.qualifiedName);
  const standardInventory = Object.hasOwn(STANDARD_CLASSIC_SCREEN_TITLE_KEYS, qualifiedName)
    || ['horse.horse_screen', 'trade.trade_screen', 'trade2.trade_screen'].includes(qualifiedName);
  Object.assign(output, buildClassicEmptySlotCollections(qualifiedName, standardInventory));
  if (isStandardClassicRecipeBookScreen(qualifiedName)) {
    output.recipe_book = REPRESENTATIVE_CLASSIC_RECIPE_BOOK_COLLECTION;
  }
  if (qualifiedName === 'beacon.beacon_screen') {
    for (const name of STANDARD_CLASSIC_BEACON_COLLECTION_NAMES) {
      output[name] = makeBeaconRepresentativeCollection(name);
    }
  }
  if (qualifiedName === 'loom.loom_screen') {
    output.patterns = {
      count: REPRESENTATIVE_CLASSIC_LOOM_PATTERN_COUNT,
      bindingValues: {
        '#pattern_selector_total_items': REPRESENTATIVE_CLASSIC_LOOM_PATTERN_COUNT,
      },
      rows: REPRESENTATIVE_LOOM_PATTERN_ROWS,
    };
    output.loom_input_items = {
      count: 1,
      rowTemplate: { ...EMPTY_CLASSIC_SLOT_ROW, '#empty_image_visible': true },
    };
    output.loom_dye_items = {
      count: 1,
      rowTemplate: { ...EMPTY_CLASSIC_SLOT_ROW, '#empty_image_visible': true },
    };
    output.loom_material_items = {
      count: 1,
      rowTemplate: {
        ...EMPTY_CLASSIC_SLOT_ROW,
        '#empty_image_visible': true,
        '#container_cell_background_texture': 'textures/ui/cell_image',
      },
    };
    output.loom_result_items = { count: 1, rowTemplate: { ...EMPTY_CLASSIC_SLOT_ROW, '#empty_image_visible': false } };
  }
  if (qualifiedName === 'enchanting.enchanting_screen') {
    output['#enchant_buttons'] = {
      count: 3,
      rowTemplate: {
        '#selectable_button_visibility': false,
        '#unselectable_button_visibility': true,
        '#selectable_dust_is_visible': false,
        '#unselectable_dust_is_visible': false,
        '#runes': '',
        '#cost': '',
        '#hover_text': '',
      },
    };
  }
  if (qualifiedName === 'horse.horse_screen') {
    output.horse_equip_items = { count: 2, rowTemplate: EMPTY_CLASSIC_SLOT_ROW };
  }
  if (qualifiedName === 'trade2.trade_screen') {
    output.trade_tiers = {
      count: 1,
      rowTemplate: {
        '#tier_visible': true,
        '#show_level': true,
        '#tier_name': 'trade.level.1',
        '#is_tier_unlocked': true,
        '#trade_tier_total': 2,
      },
    };
    output.trades = { count: REPRESENTATIVE_TRADE_OFFERS.length, rows: REPRESENTATIVE_TRADE_OFFERS };
    output.trade_item_1 = { count: 1, rowTemplate: makeRepresentativeItemRow(388, 1) };
    output.trade_item_2 = { count: 1, rowTemplate: makeRepresentativeItemRow(265, '') };
    output.sell_item = { count: 1, rowTemplate: makeRepresentativeItemRow(264, 1) };
    output.trade2_ingredient1_item = { count: 1, rowTemplate: makeRepresentativeItemRow(388, 1) };
    output.trade2_ingredient2_item = { count: 1, rowTemplate: makeRepresentativeItemRow(265, '') };
    output.trade2_result_item = { count: 1, rowTemplate: makeRepresentativeItemRow(264, 1) };
  }
  if (qualifiedName === 'trade.trade_screen') {
    // The legacy screen lays three independently-bound singleton collections
    // into a decorative 4x1 grid. They are not four rows of one collection.
    output.trade_item_A = { count: 1, rowTemplate: makeRepresentativeItemRow(388, 1) };
    output.trade_item_B = { count: 1, rowTemplate: makeRepresentativeItemRow(265, 1) };
    output.sell_item = { count: 1, rowTemplate: makeRepresentativeItemRow(264, 1) };
    output.trade_ingredient1_items = { count: 1, rowTemplate: makeRepresentativeItemRow(388, 1) };
    output.trade_ingredient2_items = { count: 1, rowTemplate: makeRepresentativeItemRow(265, 1) };
    output.trade_result_item = { count: 1, rowTemplate: makeRepresentativeItemRow(264, 1) };
    output.arrow_text = { count: 1, rowTemplate: { '#hover_text': '' } };
  }
  if (qualifiedName === 'book.book_screen') {
    output.book_pages = { count: REPRESENTATIVE_BOOK_PAGES.length, rows: REPRESENTATIVE_BOOK_PAGES };
  }
  if (qualifiedName === 'chat.chat_screen') {
    output.messages_factory = {
      count: REPRESENTATIVE_CHAT_MESSAGE_ROWS.length,
      rows: REPRESENTATIVE_CHAT_MESSAGE_ROWS,
    };
  }

  const collectionData = isObjectRecord(safeOptions.collectionData)
    ? safeOptions.collectionData
    : {};
  let inspected = 0;
  let projectedFactorySelectorRows = 0;
  const structuralRowBudget = { remaining: MAX_REPRESENTATIVE_ROWS_TOTAL };
  for (const name in collectionData) {
    if (!Object.prototype.hasOwnProperty.call(collectionData, name)) continue;
    if (inspected >= MAX_COLLECTION_ENTRIES_INSPECTED) break;
    inspected += 1;
    if (!name || PROTECTED_COLLECTION_NAMES.has(name)) continue;
    const rows = collectionData[name];
    const count = collectionRowCount(rows);
    if (count === null) continue;
    const next = {
      ...(isObjectRecord(output[name]) ? output[name] : {}),
      count,
    };
    // Explicit user rows replace the stock scenario by name. Preserve only
    // the bounded dispatch selector projection needed by the structural
    // factory resolver; the complete row remains in collectionData for the
    // bindings evaluator and is never duplicated into resolver state.
    delete next.rows;
    delete next.rowTemplate;
    const selectors = projectFactoryControlIdSelectors(
      rows,
      count,
      Math.max(0, MAX_REPRESENTATIVE_ROWS_TOTAL - projectedFactorySelectorRows),
      0,
      structuralRowBudget,
    );
    if (selectors) {
      next.rows = selectors;
      projectedFactorySelectorRows += selectors.length;
    }
    output[name] = next;
  }
  return output;
}

/**
 * Build collection-scoped representative rows for the bindings evaluator.
 * Repeated binding names such as Beacon's `#active` must never be flattened
 * into global mock data. Explicit user collections replace a representative
 * collection by name, including an intentionally empty collection.
 */
export function buildRepresentativeClassicCollectionData(representativeCollections, userCollectionData = {}) {
  const output = Object.create(null);
  const representative = isObjectRecord(representativeCollections) ? representativeCollections : {};
  let totalRows = 0;
  let inspectedRepresentative = 0;
  for (const name in representative) {
    if (!Object.prototype.hasOwnProperty.call(representative, name)) continue;
    if (
      inspectedRepresentative >= MAX_COLLECTION_ENTRIES_INSPECTED
      || totalRows >= MAX_REPRESENTATIVE_ROWS_TOTAL
    ) break;
    inspectedRepresentative += 1;
    if (!name || PROTECTED_COLLECTION_NAMES.has(name)) continue;
    const entry = representative[name];
    if (!isObjectRecord(entry)) continue;
    const requestedCount = Number(entry.count);
    if (!Number.isSafeInteger(requestedCount) || requestedCount < 0) continue;
    const count = Math.min(
      requestedCount,
      MAX_REPRESENTATIVE_ROWS_PER_COLLECTION,
      Math.max(0, MAX_REPRESENTATIVE_ROWS_TOTAL - totalRows),
    );
    const authoredRows = Array.isArray(entry.rows) ? entry.rows : null;
    if (!authoredRows && !isObjectRecord(entry.rowTemplate)) continue;
    output[name] = Array.from({ length: count }, (_, index) => {
      const row = authoredRows && isObjectRecord(authoredRows[index])
        ? authoredRows[index]
        : entry.rowTemplate;
      return { ...(isObjectRecord(row) ? row : {}) };
    });
    totalRows += count;
  }

  if (isObjectRecord(userCollectionData)) {
    let inspectedUser = 0;
    for (const name in userCollectionData) {
      if (!Object.prototype.hasOwnProperty.call(userCollectionData, name)) continue;
      if (inspectedUser >= MAX_COLLECTION_ENTRIES_INSPECTED) break;
      inspectedUser += 1;
      if (!name || PROTECTED_COLLECTION_NAMES.has(name)) continue;
      const rows = userCollectionData[name];
      if (!Array.isArray(rows) && !isObjectRecord(rows)) continue;
      output[name] = rows;
    }
  }
  return output;
}

/**
 * Screen-global bindings for exact stock Classic screens. Custom screens that
 * merely reuse a familiar local name receive no fabricated engine state.
 */
export function buildRepresentativeClassicBindingMockData(options = {}) {
  const safeOptions = isObjectRecord(options) ? options : {};
  const qualifiedName = normalizeQualifiedName(safeOptions.qualifiedName);
  const userMockData = isObjectRecord(safeOptions.userMockData) ? safeOptions.userMockData : {};
  const output = {};
  const standardInventory = Object.hasOwn(STANDARD_CLASSIC_SCREEN_TITLE_KEYS, qualifiedName)
    || ['horse.horse_screen', 'trade.trade_screen', 'trade2.trade_screen'].includes(qualifiedName);
  if (standardInventory && (!Object.hasOwn(userMockData, '#inventory_selected_item') || userMockData['#inventory_selected_item'] === 0)) {
    // 空の持ち上げスロットと、長押ししていない代表状態。実アイテムの
    // 耐久値を推測しない。末尾で明示された利用者値を必ず優先する。
    Object.assign(output, {
      '#inventory_selected_item_stack_count': '',
      '#selected_item_durability_visible': false,
      '#selected_item_durability_total_amount': 0,
      '#selected_item_durability_current_amount': 0,
      '#selected_item_storage_visible': false,
      '#selected_item_storage_total_amount': 0,
      '#selected_item_storage_current_amount': 0,
      '#progress_bar_visible': false,
      '#touch_progress_bar_visible': false,
    });
  }
  if (qualifiedName === 'anvil.anvil_screen') {
    const rows = userMockData.__collections?.anvil_input_items;
    const row = Array.isArray(rows) ? rows[0] : isObjectRecord(rows) ? rows['0'] : null;
    const hasInput = row?.['#item_valid'] === true || Number(row?.__jsonui_preview_item_count) > 0
      || Number(row?.['#item_id_aux']) !== 0 && row?.['#item_id_aux'] !== undefined;
    if (!hasInput) { output['#text_box_item_name'] = ''; output['#cost_text'] = ''; }
  } else if (qualifiedName === 'cartography.cartography_screen') {
    Object.assign(output, STANDARD_CLASSIC_CARTOGRAPHY_BINDING_DEFAULTS);
  } else if (qualifiedName === 'beacon.beacon_screen') {
    output['#supports_netherite'] = true;
  } else if (qualifiedName === 'enchanting.enchanting_screen') {
    // Recompute from the target slot for drag/drop, typed state and direct data edits.
    // Lapis alone does not open the book. Explicit user #open still wins below.
    const rows = userMockData.__collections?.enchanting_input_items;
    const row = Array.isArray(rows) ? rows[0] : isObjectRecord(rows) ? rows['0'] : null;
    output['#open'] = row?.['#item_valid'] === true
      || Number(row?.__jsonui_preview_item_count) > 0 || Number(row?.['#item_id_aux']) > 0;
  } else if (qualifiedName === 'crafting.inventory_screen' || qualifiedName === 'crafting.crafting_screen') {
    // Representative empty recipe: no selected recipe requires a workbench.
    output['#needs_crafting_table'] = false;
    output['#crafting_label_text'] = 'container.crafting';
  } else if (qualifiedName === 'horse.horse_screen') {
    Object.assign(output, {
      '#entity_id': 0,
      '#equip_grid_dimensions': [1, 2],
      '#inv_grid_dimensions': [5, 3],
      '#has_saddle_slot': true,
      '#has_only_horse_armor_slot': false,
      '#has_only_carpet_slot': false,
      '#has_only_nautilus_armor_slot': false,
      '#has_horse_armor_and_saddle_slot': true,
      '#has_carpet_and_saddle_slot': false,
      '#has_nautilus_armor_and_saddle_slot': false,
      '#is_chested': false,
    });
  } else if (qualifiedName === 'redstone.crafter_screen') {
    output['#redstone_arrow_texture'] = 'textures/ui/redstone_arrow_unpowered';
    output['#output_stack_count'] = '';
    for (let index = 0; index < 9; index += 1) output[`#button_visible${index}`] = false;
  } else if (qualifiedName === 'trade2.trade_screen') {
    Object.assign(output, {
      '#trade_selector_total': 1,
      '#trade_tier_total': REPRESENTATIVE_TRADE_OFFERS.length,
      '#trade_button_enabled': true,
      '#exp_bar_visible': true,
      '#exp_progress': 0.35,
      '#exp_possible_progress': 0.5,
      '#trade_details_button_1_visible': false,
      '#trade_details_button_2_visible': false,
    });
  } else if (qualifiedName === 'trade.trade_screen') {
    Object.assign(output, {
      '#show_second_trade_slot': true,
      '#left_button_enabled': false,
      '#right_button_enabled': true,
      '#cross_out_icon': false,
      '#is_using_gamepad': false,
      '#gamepad_helper_visible': false,
    });
  } else if (qualifiedName === 'chat.chat_screen') {
    Object.assign(output, {
      '#is_using_gamepad': false,
      '#chat_title_visible': false,
      '#chat_coordinate_dropdown_visible': true,
      '#chat_coordinate_dropdown_label': 'chat.coordinateTypePosition',
      '#chat_coordinate_dropdown': false,
      '#coordinates_text': '0, 0, 0',
      '#keyboard_button_visible': true,
      '#keyboard_being_used': false,
      '#gamepad_helper_visible': false,
      '#host_main_visible': true,
      '#send_button_visible': true,
      '#text_box_enabled': true,
      '#copy_button_enabled': true,
      '#cheats_on': false,
      '#has_new_messages': false,
      '#chat_visible': true,
    });
  } else if (qualifiedName === 'book.book_screen') {
    const suppliedPages = userMockData.__collections?.__jsonui_preview_book_pages ?? userMockData.__collections?.book_pages;
    const pageCount = Array.isArray(suppliedPages) ? Math.min(256, suppliedPages.length) : 2;
    const spread = Number.isInteger(userMockData.__jsonui_preview_book_spread) && userMockData.__jsonui_preview_book_spread >= 0 ? userMockData.__jsonui_preview_book_spread : 0;
    const explicitAlternateMode = ['#signing', '#picking', '#exporting']
      .some((key) => userMockData[key] === true);
    const modeDefaults = {
      '#viewing': !explicitAlternateMode,
      '#signing': false,
      '#picking': false,
      '#exporting': false,
    };
    for (const [key, value] of Object.entries(modeDefaults)) {
      if (!Object.prototype.hasOwnProperty.call(userMockData, key)) output[key] = value;
    }
    Object.assign(output, {
      '#editable': true,
      '#edit_controls_active': false,
      '#prev_page_button_active': spread > 0 && spread * 2 < pageCount,
      '#next_page_button_active': (spread + 1) * 2 < pageCount,
      '#close_button_visible': true,
      '#gamepad_helper_visible': false,
    });
  }

  for (const [key, value] of Object.entries(userMockData)) {
    if (key.startsWith('#')) output[key] = value;
  }
  return output;
}

/**
 * Build resolver variables for a representative Classic preview.
 *
 * `baseVariables` lets the caller add other platform facts without changing
 * this module. `userVariables` is applied last, but only resolver-style `$...`
 * entries are accepted; binding mock data (`#...`) belongs to the bindings
 * evaluator. Consequently explicit user title/localize/platform values always
 * win, including false and empty-string values.
 *
 * @param {{
 *   qualifiedName?: unknown,
 *   baseVariables?: unknown,
 *   userVariables?: unknown,
 * }} [options]
 * @returns {Record<string, unknown>}
 */
export function buildRepresentativeClassicResolverVariables(options = {}) {
  const safeOptions = isObjectRecord(options) ? options : {};
  const output = {};

  copyDollarVariables(output, REPRESENTATIVE_CLASSIC_PLATFORM_VARIABLES);
  copyDollarVariables(output, safeOptions.baseVariables);

  const qualifiedName = normalizeQualifiedName(safeOptions.qualifiedName);
  const variantTitleKey = Object.prototype.hasOwnProperty.call(
    STANDARD_CLASSIC_REPRESENTATIVE_VARIANT_TITLE_KEYS,
    qualifiedName,
  )
    ? STANDARD_CLASSIC_REPRESENTATIVE_VARIANT_TITLE_KEYS[qualifiedName]
    : null;
  const titleKey = getStandardClassicScreenTitleKey(qualifiedName)
    || variantTitleKey
    || null;
  if (titleKey !== null) {
    output.$container_title = titleKey;
    output.$localize_title = true;
  }

  // Keep the representative offer coherent across the selector rows and the
  // detail pane: it is a normal two-input emerald+iron -> diamond trade.
  if (qualifiedName === 'trade2.trade_screen') output.$second_item_slot_ignored = false;
  // 公開Classic rootはこのゲーム変数で旧2入力/現行3入力UIを選ぶ。
  // 未指定時の代表状態のみ現行を選び、base/userの明示値とPocket別名は維持する。
  if (qualifiedName === 'smithing_table.smithing_table_screen' && !Object.prototype.hasOwnProperty.call(output, '$use_smithing_table_2_ui')) output.$use_smithing_table_2_ui = true;
  if (qualifiedName === 'chat.chat_screen') {
    output.$is_pregame = false;
    output.$chat_font_type = 'default';
    output.$chat_font_scale_factor = 1;
    output.$chat_line_spacing = 0;
    output.$max_text_edit_length = 256;
  }
  if (qualifiedName === 'book.book_screen') {
    output.$education_edition = false;
    output.$max_page_length = 798;
    output.$max_title_length = 64;
  }

  copyDollarVariables(output, safeOptions.userVariables);
  return output;
}

/**
 * Return only the runtime variable names actually available to this preview
 * scenario. This prevents a stock-screen superset from hiding typos in custom
 * packs while keeping platform/title/user mock variables diagnostic-free.
 */
export function buildRepresentativeClassicRuntimeVariableNames(options = {}) {
  const names = new Set(Object.keys(buildRepresentativeClassicResolverVariables(options)));
  if (isStandardClassicRecipeBookScreen(options && options.qualifiedName)) {
    for (const name of STANDARD_CLASSIC_RECIPE_BOOK_RUNTIME_VARIABLE_NAMES) names.add(name);
  }
  const qualifiedName = normalizeQualifiedName(options && options.qualifiedName);
  const screenRuntimeNames = Object.hasOwn(STANDARD_CLASSIC_SCREEN_RUNTIME_VARIABLE_NAMES, qualifiedName)
    ? STANDARD_CLASSIC_SCREEN_RUNTIME_VARIABLE_NAMES[qualifiedName] : null;
  if (screenRuntimeNames) {
    for (const name of screenRuntimeNames) names.add(name);
  }
  return names;
}
