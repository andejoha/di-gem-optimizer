/**
 * Regression tests against a real 430-gem player fixture, checking that
 * the gem power pool and the reported surplus behave monotonically.
 *
 * The fixture is the exact inventory/setup from the original bug report,
 * decoded from a share code (dormant gem power already subtracted from
 * gem_power).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runOptimization } from '../api/runOptimization';
import type { OptimizeRequest } from '../api/types';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/reported_shortfall_setup.json', import.meta.url));
const BASE_REQUEST: OptimizeRequest = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

function optimize(gemPower: number) {
  return runOptimization({ ...BASE_REQUEST, gem_power: gemPower }, true, true);
}

describe('optimizer monotonicity (real 430-gem fixture)', () => {
  it('the fixture reproduces the reported shortfall at the reported pool size', () => {
    const response = optimize(BASE_REQUEST.gem_power);
    expect(response.summary.status).toBe('shortfall');
    expect(response.summary.surplus_or_shortfall).toBeLessThan(0);
  });

  it('adding the reported shortfall makes it exactly feasible', () => {
    const baseline = optimize(BASE_REQUEST.gem_power);
    const shortfall = -baseline.summary.surplus_or_shortfall;
    expect(shortfall).toBeGreaterThan(0);

    const toppedUp = optimize(BASE_REQUEST.gem_power + shortfall);
    expect(toppedUp.summary.status).toBe('feasible');
    expect(toppedUp.summary.surplus_or_shortfall).toBe(0);
  });

  it(
    'surplus is non-decreasing as the gem power pool is swept upward (bounded to +230 gem power -- see note below)',
    () => {
      // NOTE: intentionally bounded to +230 gem power, well past the ~51 gem power needed
      // to close the reported shortfall. Farther out, the upgrade walk has a
      // separate, PRE-EXISTING, documented source of non-monotonicity: it
      // stops peeling upgrades as soon as netResidual <= availablePowerOrig,
      // a different reference point than the budget used by the final
      // full-pipeline re-run (availablePower - committedCost). This is a
      // distinct walk-selection issue, not the redistribute-phase budget bug
      // this test targets, and is deliberately NOT fixed as part of this
      // port -- porting a known-buggy behaviour as-is keeps the differential
      // golden corpus meaningful.
      const baseGp = BASE_REQUEST.gem_power;
      const surpluses: number[] = [];
      for (let delta = 0; delta < 235; delta += 5) {
        surpluses.push(optimize(baseGp + delta).summary.surplus_or_shortfall);
      }
      for (let i = 1; i < surpluses.length; i++) {
        expect(surpluses[i], `surplus decreased from ${surpluses[i - 1]} to ${surpluses[i]} after adding more gem power`).toBeGreaterThanOrEqual(
          surpluses[i - 1],
        );
      }
    },
    120_000,
  );
});
