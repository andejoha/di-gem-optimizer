/**
 * Binary codec for import/export of gem optimizer state.
 *
 * Binary layout:
 *   Byte 0:       Version (0x01)
 *   Bytes 1-2:    GemPower uint16 big-endian
 *   Byte 3:       SlotCount (non-empty slots only)
 *   Per slot (5 bytes):
 *     Byte 0:   SlotIndex (0-7, position in SLOT_ORDER)
 *     Bytes 1-2: GemId uint16 big-endian
 *     Byte 3:   EncodedRank = (mainRank-1)*18 + subRank
 *     Byte 4:   ActiveStars (1-5)
 *   Byte after slots: StackCount
 *   Per stack (5 bytes):
 *     Bytes 0-1: GemId uint16 big-endian
 *     Byte 2:   EncodedRank
 *     Byte 3:   ActiveStars (1-5)
 *     Byte 4:   Quantity (1-255)
 */

import type { GemInfo, GemSetup } from '../types/api';
import type { InventoryGemStack } from '../types/inventory';
import { SLOT_ORDER } from './gearAssets';
import { parseRank } from './rankUtils';

const VERSION = 0x01;

// crypto.randomUUID() requires a secure context (HTTPS); fall back to a
// Math.random-based UUID v4 for plain-HTTP environments (e.g. local Pi).
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface CodecState {
  gemSetup: GemSetup;
  gemPower: number;
  stacks: InventoryGemStack[];
}

function encodeRank(rankStr: string): number {
  const [main, sub] = parseRank(rankStr);
  return (main - 1) * 18 + sub;
}

function decodeRank(encoded: number): string {
  const main = Math.floor(encoded / 18) + 1;
  const sub = encoded % 18;
  return sub === 0 ? String(main) : `${main}.${sub}`;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeSetup(state: CodecState): string {
  const slots = SLOT_ORDER
    .map((slotName, idx) => ({ slotName, slotIdx: idx, item: state.gemSetup[slotName] }))
    .filter(({ item }) => item != null && item != undefined);

  const totalBytes = 1 + 2 + 1 + slots.length * 5 + 1 + state.stacks.length * 5;
  const buf = new Uint8Array(totalBytes);
  let pos = 0;

  buf[pos++] = VERSION;
  const gp = Math.min(state.gemPower, 0xFFFF);
  buf[pos++] = (gp >> 8) & 0xFF;
  buf[pos++] = gp & 0xFF;

  buf[pos++] = slots.length;
  for (const { slotIdx, item } of slots) {
    const gem = item!;
    buf[pos++] = slotIdx;
    buf[pos++] = (gem.gem_id >> 8) & 0xFF;
    buf[pos++] = gem.gem_id & 0xFF;
    buf[pos++] = encodeRank(gem.target_rank);
    buf[pos++] = gem.active_stars;
  }

  buf[pos++] = state.stacks.length;
  for (const stack of state.stacks) {
    buf[pos++] = (stack.gem_id >> 8) & 0xFF;
    buf[pos++] = stack.gem_id & 0xFF;
    buf[pos++] = encodeRank(stack.rank);
    buf[pos++] = stack.active_stars;
    buf[pos++] = Math.min(stack.quantity, 255);
  }

  return toBase64Url(buf);
}

export function decodeSetup(encoded: string, gemById: Map<number, GemInfo>): CodecState {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(encoded);
  } catch {
    throw new Error('Invalid import code');
  }

  if (bytes.length < 4) throw new Error('Invalid import code');

  let pos = 0;
  const version = bytes[pos++];
  if (version !== VERSION) throw new Error(`Unsupported version (${version})`);

  const gemPower = (bytes[pos++] << 8) | bytes[pos++];
  const slotCount = bytes[pos++];

  if (bytes.length < pos + slotCount * 5 + 1) throw new Error('Unexpected data length');

  const gemSetup: GemSetup = {};
  for (let i = 0; i < slotCount; i++) {
    const slotIdx = bytes[pos++];
    const gemId = (bytes[pos++] << 8) | bytes[pos++];
    const encodedRank = bytes[pos++];
    const activeStars = bytes[pos++];

    if (slotIdx >= SLOT_ORDER.length) continue;
    if (!gemById.has(gemId)) continue;
    if (activeStars < 1 || activeStars > 5) throw new Error(`Invalid active_stars value: ${activeStars}`);
    if (encodedRank > 179) throw new Error(`Invalid rank value: ${encodedRank}`);

    const slotName = SLOT_ORDER[slotIdx];
    gemSetup[slotName] = {
      gem_id: gemId,
      target_rank: decodeRank(encodedRank),
      active_stars: activeStars,
    };
  }

  if (bytes.length < pos + 1) throw new Error('Unexpected data length');
  const stackCount = bytes[pos++];

  if (bytes.length < pos + stackCount * 5) throw new Error('Unexpected data length');

  const stacks: InventoryGemStack[] = [];
  for (let i = 0; i < stackCount; i++) {
    const gemId = (bytes[pos++] << 8) | bytes[pos++];
    const encodedRank = bytes[pos++];
    const activeStars = bytes[pos++];
    const quantity = bytes[pos++];

    if (!gemById.has(gemId)) continue;
    if (activeStars < 1 || activeStars > 5) throw new Error(`Invalid active_stars value: ${activeStars}`);
    if (encodedRank > 179) throw new Error(`Invalid rank value: ${encodedRank}`);

    const gem = gemById.get(gemId)!;
    stacks.push({
      id: generateId(),
      gem_id: gemId,
      star_rating: gem.star_rating,
      rank: decodeRank(encodedRank),
      active_stars: activeStars,
      quantity,
    });
  }

  return { gemSetup, gemPower, stacks };
}
