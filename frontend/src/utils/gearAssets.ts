import type { SlotName } from '../types/api';
import starFilled from '../assets/images/buttons/star-filled.png';
import starEmpty from '../assets/images/buttons/star-empty.png';

export { starFilled, starEmpty };

interface SlotMeta {
  label: string;
  iconFile: string;
}

export const SLOT_META: Record<SlotName, SlotMeta> = {
  head:          { label: 'Head',          iconFile: 'head.png' },
  chest:         { label: 'Chest',         iconFile: 'chest.png' },
  shoulders:     { label: 'Shoulders',     iconFile: 'shoulders.png' },
  legs:          { label: 'Legs',          iconFile: 'legs.png' },
  main_hand:     { label: 'Main\u00A0Hand',               iconFile: 'main-hand.png' },
  off_hand:      { label: 'Off\u2011Hand',                iconFile: 'off-hand.png' },
  alt_main_hand: { label: 'Alternate Main\u00A0Hand',     iconFile: 'main-hand.png' },
  alt_off_hand:  { label: 'Alternate Off\u2011Hand',      iconFile: 'off-hand.png' },
};

export const SLOT_ORDER: SlotName[] = [
  'head', 'chest',
  'shoulders', 'legs',
  'main_hand', 'off_hand',
  'alt_main_hand', 'alt_off_hand',
];

const gearImages = import.meta.glob<{ default: string }>(
  '../assets/images/gear/*.png',
  { eager: true },
);

const gemImages = import.meta.glob<{ default: string }>(
  '../assets/images/gems/*.png',
  { eager: true },
);

export function getGearImageUrl(filename: string): string {
  const key = `../assets/images/gear/${filename}`;
  return gearImages[key]?.default ?? '';
}

export const defaultGemImage: string =
  gemImages['../assets/images/gems/default.png']?.default ?? '';

export function getGemImageUrl(gemId: number): string {
  const key = `../assets/images/gems/${gemId}.png`;
  return gemImages[key]?.default ?? '';
}
