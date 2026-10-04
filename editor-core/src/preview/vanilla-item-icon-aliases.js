/**
 * Conservative vanilla compatibility aliases. The public vanilla RP does not
 * ship items/*.json; its item IDs and atlas names are not always identical.
 * Verified against Mojang/bedrock-samples commit
 * 736072450c26a7c67f07b1661f29d9a5ebaa14b1, textures/item_texture.json.
 * Apply only AFTER explicit pack definitions and exact atlas-key resolution.
 * This contains no images; the caller must resolve the currently loaded atlas.
 */
const aliases = new Map();
const add = (identifier, atlasKey, variant = 0, textureRef = `textures/items/${atlasKey}`) => {
  aliases.set(`minecraft:${identifier}`, Object.freeze({ atlasKey, variant, textureRef }));
};

for (const [identifier, atlasKey] of Object.entries({
  book: 'book_normal',
  enchanted_book: 'book_enchanted',
  writable_book: 'book_writable',
  written_book: 'book_written',
  golden_apple: 'apple_golden',
  golden_carrot: 'carrot_golden',
  clock: 'clock_item',
  compass: 'compass_item',
  beef: 'beef_raw',
  cooked_beef: 'beef_cooked',
  chicken: 'chicken_raw',
  cooked_chicken: 'chicken_cooked',
  porkchop: 'porkchop_raw',
  cooked_porkchop: 'porkchop_cooked',
  cooked_rabbit: 'rabbit_cooked',
  baked_potato: 'potato_baked',
  poisonous_potato: 'potato_poisonous',
  slime_ball: 'slimeball',
  melon_seeds: 'seeds_melon',
  pumpkin_seeds: 'seeds_pumpkin',
  wheat_seeds: 'seeds_wheat',
  beetroot_seeds: 'seeds_beetroot',
  minecart: 'minecart_normal',
  chest_minecart: 'minecart_chest',
  hopper_minecart: 'minecart_hopper',
  tnt_minecart: 'minecart_tnt',
  command_block_minecart: 'minecart_command_block',
})) add(identifier, atlasKey);

// These are atlas variation indices, never numeric or packed item IDs.
const toolMaterials = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite', 'copper'];
for (const tool of ['sword', 'axe', 'pickaxe', 'shovel', 'hoe']) {
  toolMaterials.forEach((material, variant) => {
    const textureMaterial = material === 'wooden' ? 'wood' : material === 'golden' ? 'gold' : material;
    add(`${material}_${tool}`, tool, variant, `textures/items/${textureMaterial}_${tool}`);
  });
}
const armorMaterials = ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite'];
for (const armor of ['helmet', 'chestplate', 'leggings', 'boots']) {
  armorMaterials.forEach((material, variant) => {
    const textureMaterial = material === 'golden' ? 'gold' : material;
    add(`${material}_${armor}`, armor, variant, `textures/items/${textureMaterial}_${armor}`);
  });
}

// Standing signs use dedicated inventory sprites, not the planks material
// used by their in-world models. Keep namespaces and wood species exact.
for (const [wood, sprite] of Object.entries({
  acacia: 'sign_acacia', birch: 'sign_birch', dark_oak: 'sign_darkoak',
  jungle: 'sign_jungle', spruce: 'sign_spruce', crimson: 'sign_crimson',
  warped: 'sign_warped', mangrove: 'mangrove_sign', bamboo: 'bamboo_sign',
  cherry: 'cherry_sign', pale_oak: 'pale_oak_sign', poplar: 'poplar_sign',
})) {
  add(`${wood}_sign`, `${wood}_sign`, 0, `textures/items/${sprite}`);
}
add('oak_sign', 'sign', 0, 'textures/items/sign');
add('sign', 'sign', 0, 'textures/items/sign');

/** Only already-normalized minecraft IDs are accepted; never coerce objects. */
export function getVanillaItemIconAlias(normalizedId) {
  if (typeof normalizedId !== 'string') return null;
  return aliases.get(normalizedId) || null;
}
