import gemPowerIconSrc from '../assets/images/gem-power.png';
import addGemIconSrc from '../assets/images/buttons/add-gem.png';

export { gemPowerIconSrc as gemPowerIcon };
export { addGemIconSrc as addGemIcon };

const inventoryImages = import.meta.glob<{ default: string }>(
  '../assets/images/inventory/*.png',
  { eager: true },
);

function getInventoryImageUrl(filename: string): string {
  const key = `../assets/images/inventory/${filename}`;
  return inventoryImages[key]?.default ?? '';
}

export const inventoryEmptyBg = getInventoryImageUrl('background-empty.png');
export const inventoryFilledBg = getInventoryImageUrl('background-filled.png');
