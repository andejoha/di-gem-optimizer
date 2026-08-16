/**
 * Ported from backend/tests/test_dormant_gems.py (4 tests). Tests
 * suppressing "make this dormant" recommendations for gems the player
 * already marked dormant before submitting the request.
 *
 * Fixture setup: main gem 5001 (5-star) at target_rank "1" unlocks zero
 * sockets, so every inventory copy is left unassigned regardless of star
 * rating -- a simple way to guarantee "unused" without reasoning about
 * socket assignment.
 */

import { describe, expect, it } from 'vitest';
import { runOptimization } from '../api/runOptimization';
import type { InventoryItem, OptimizeResponse } from '../api/types';

const HEAD_SETUP = { gem_id: 5001, target_rank: '1', active_stars: 5 };

function request(inventory: InventoryItem[], gemPower = 100) {
  return {
    gem_power: gemPower,
    gem_setup: { head: HEAD_SETUP },
    inventory,
  };
}

function optimize(inventory: InventoryItem[]): OptimizeResponse {
  return runOptimization(request(inventory), false, false);
}

function dormantEntry(response: OptimizeResponse, gemId: number) {
  return response.dormant_gems.find((d) => d.gem_id === gemId) ?? null;
}

describe('dormant gem recommendation suppression', () => {
  it('an unused non-dormant gem is recommended', () => {
    const response = optimize([{ gem_id: 2001, rank: '3', active_stars: 2 }]);
    const entry = dormantEntry(response, 2001);
    expect(entry).not.toBeNull();
    expect(entry!.quantity).toBe(1);
    expect(entry!.gem_power_gained).toBe(20);
    expect(entry!.already_dormant_quantity).toBe(0);
    expect(response.summary.dormant_gem_power).toBe(20);
    expect(response.summary.newly_dormant_gem_power).toBe(20);
  });

  it('an already-dormant gem is not recommended but still counted', () => {
    const response = optimize([{ gem_id: 2001, rank: '3', active_stars: 2, dormant: true }]);
    const entry = dormantEntry(response, 2001);
    expect(entry).not.toBeNull();
    expect(entry!.quantity).toBe(0);
    expect(entry!.gem_power_gained).toBe(0);
    expect(entry!.already_dormant_quantity).toBe(1);
    // Accounting (dormant_gem_power/surplus) is unaffected by the dormant
    // flag -- only the recommendation surfaced to the player changes.
    expect(response.summary.dormant_gem_power).toBe(20);
    expect(response.summary.newly_dormant_gem_power).toBe(0);

    const nonDormant = optimize([{ gem_id: 2001, rank: '3', active_stars: 2 }]);
    expect(response.summary.surplus_or_shortfall).toBe(nonDormant.summary.surplus_or_shortfall);
    expect(response.summary.dormant_gem_power).toBe(nonDormant.summary.dormant_gem_power);
  });

  it('mixed dormant and active copies split correctly', () => {
    const response = optimize([
      { gem_id: 2001, rank: '3', active_stars: 2, dormant: true },
      { gem_id: 2001, rank: '3', active_stars: 2, dormant: false },
    ]);
    const entry = dormantEntry(response, 2001);
    expect(entry).not.toBeNull();
    expect(entry!.quantity).toBe(1);
    expect(entry!.gem_power_gained).toBe(20);
    expect(entry!.already_dormant_quantity).toBe(1);
    expect(response.summary.dormant_gem_power).toBe(40);
    expect(response.summary.newly_dormant_gem_power).toBe(20);
  });

  it('omits net-new recommendations when everything is already dormant (idempotency)', () => {
    const response = optimize([{ gem_id: 2001, rank: '3', active_stars: 2, dormant: true }]);
    expect(response.dormant_gems.every((d) => d.quantity === 0)).toBe(true);
  });
});
