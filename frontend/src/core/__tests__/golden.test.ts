/**
 * Regression suite: every case in golden/ must be reproduced byte-for-byte
 * by runOptimization. See golden/README.md for how the corpus was built.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runOptimization } from '../api/runOptimization';
import type { OptimizeRequest } from '../api/types';
import { ValidationError } from '../api/validate';

const GOLDEN_DIR = fileURLToPath(new URL('../../../../golden', import.meta.url));

const FLAG_COMBOS: Array<[key: string, enableUpgrades: boolean, convert1Star: boolean]> = [
  ['0-0', false, false],
  ['0-1', false, true],
  ['1-0', true, false],
  ['1-1', true, true],
];

const caseNames = [
  ...new Set(
    readdirSync(GOLDEN_DIR)
      .filter((f) => f.endsWith('.request.json'))
      .map((f) => f.replace('.request.json', '')),
  ),
].sort();

// Sanity check the corpus itself loaded -- if this is 0, the path resolution
// above is wrong and every other test below would trivially "pass" by not
// running, which would be worse than useless.
if (caseNames.length === 0) {
  throw new Error(`No golden cases found under ${GOLDEN_DIR} -- check GOLDEN_DIR path resolution.`);
}

describe(`golden corpus differential harness (${caseNames.length} cases x 4 flag combos)`, () => {
  for (const caseName of caseNames) {
    const request: OptimizeRequest = JSON.parse(readFileSync(`${GOLDEN_DIR}/${caseName}.request.json`, 'utf-8'));

    for (const [flagKey, enableUpgrades, convert1Star] of FLAG_COMBOS) {
      it(`${caseName} [${flagKey}]`, () => {
        let actualJson: string;
        let expectedRaw: string;

        try {
          const response = runOptimization(request, enableUpgrades, convert1Star);
          actualJson = JSON.stringify(response, null, 2);
          expectedRaw = readFileSync(`${GOLDEN_DIR}/${caseName}.${flagKey}.expected.json`, 'utf-8').trimEnd();
          // Structural equality first (readable diff on failure) ...
          expect(JSON.parse(actualJson)).toEqual(JSON.parse(expectedRaw));
          // ... then byte-identity, which also catches key-order and
          // null-vs-omitted divergence that toEqual alone would miss.
          expect(actualJson).toBe(expectedRaw);
        } catch (err) {
          if (!(err instanceof ValidationError)) throw err;
          expectedRaw = readFileSync(`${GOLDEN_DIR}/${caseName}.${flagKey}.error.json`, 'utf-8').trimEnd();
          const expectedDetail = (JSON.parse(expectedRaw) as { detail: string }).detail;
          expect(err.detail).toBe(expectedDetail);
        }
      });
    }
  }
});
