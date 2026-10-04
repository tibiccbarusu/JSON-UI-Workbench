/**
 * 公開バニラのClassic画面名・slot collection名・固定寸法を照合した
 * 「何も選択していない空スロット」の明示的代表状態。実ワールド状態ではない。
 * 任意パックの未知collectionへは適用しない。
 */
export const EMPTY_CLASSIC_SLOT_ROW = Object.freeze({
  '#is_selected_slot': false,
  '#item_valid': false,
  '#item_id_aux': 0,
  '#item_stack_count': '',
  '#inventory_stack_count': '',
  '#inactive_item': false,
  '#item_grayed_out': false,
  '#bundle_selected_item_visible': false,
  '#item_durability_visible': false,
  '#item_durability_total_amount': 0,
  '#item_durability_current_amount': 0,
  '#item_storage_visible': false,
  '#item_storage_total_amount': 0,
  '#item_storage_current_amount': 0,
  '#hover_text': '',
});
// Stock crafting.container_cell_images selects its Classic background at 0;
// leaving this game-provided value unresolved hides every empty grid cell.
const EMPTY_CRAFTING_SLOT_ROW = Object.freeze({
  ...EMPTY_CLASSIC_SLOT_ROW,
  '#container_item_background': 0,
  '#container_item_modifier': 0,
});
const COUNTS = Object.freeze({
  'chest.small_chest_screen': { container_items: 27 },
  'chest.large_chest_screen': { container_items: 54 },
  'chest.ender_chest_screen': { container_items: 27 },
  'chest.shulker_box_screen': { container_items: 27 },
  'chest.barrel_screen': { container_items: 27 },
  'redstone.hopper_screen': { container_items: 5 },
  'redstone.dispenser_screen': { container_items: 9 },
  'redstone.dropper_screen': { container_items: 9 },
  'redstone.crafter_screen': { container_items: 9 },
  'anvil.anvil_screen': { anvil_input_items: 1, anvil_material_items: 1, anvil_result_items: 1 },
  'brewing_stand.brewing_stand_screen': { brewing_result_items: 3, brewing_input_item: 1, brewing_fuel_item: 1 },
  'enchanting.enchanting_screen': { enchanting_input_items: 1, enchanting_lapis_items: 1 },
  'beacon.beacon_screen': { beacon_payment_items: 1 },
  'cartography.cartography_screen': { cartography_input_items: 1, cartography_additional_items: 1, cartography_result_items: 1 },
  'grindstone.grindstone_screen': { grindstone_input_items: 1, grindstone_additional_items: 1, grindstone_result_items: 1 },
  'stonecutter.stonecutter_screen': { stonecutter_input_items: 1, stonecutter_result_items: 1 },
  'crafting.inventory_screen': { armor_items: 4, offhand_items: 1, crafting_input_items: 4, crafting_output_items: 1 },
  'crafting.crafting_screen': { crafting_input_items: 9, crafting_output_items: 1 },
  'furnace.furnace_screen': { furnace_ingredient_items: 1, furnace_fuel_items: 1, furnace_output_items: 1 },
  'smoker.smoker_screen': { furnace_ingredient_items: 1, furnace_fuel_items: 1, furnace_output_items: 1 },
  'blast_furnace.blast_furnace_screen': { furnace_ingredient_items: 1, furnace_fuel_items: 1, furnace_output_items: 1 },
  'smithing_table.smithing_table_screen': { smithing_table_template_items: 1, smithing_table_input_items: 1, smithing_table_material_items: 1, smithing_table_result_items: 1 },
});
export function buildClassicEmptySlotCollections(qualifiedName, hasStandardInventory) {
  const output = Object.create(null);
  const rowTemplate = qualifiedName === 'crafting.inventory_screen' || qualifiedName === 'crafting.crafting_screen'
    ? EMPTY_CRAFTING_SLOT_ROW : EMPTY_CLASSIC_SLOT_ROW;
  if (hasStandardInventory) {
    output.inventory_items = { count: 27, rowTemplate };
    output.hotbar_items = { count: 9, rowTemplate };
  }
  const counts = Object.hasOwn(COUNTS, qualifiedName) ? COUNTS[qualifiedName] : {};
  for (const [name, count] of Object.entries(counts)) output[name] = { count, rowTemplate };
  return output;
}
