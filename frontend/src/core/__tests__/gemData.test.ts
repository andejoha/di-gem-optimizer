import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GEM_INFO } from '../api/gemData';

const GOLDEN_PATH = fileURLToPath(new URL('../../../../golden/gem-data.json', import.meta.url));

describe('GEM_INFO', () => {
  it('matches golden/gem-data.json byte-for-byte', () => {
    const expected = readFileSync(GOLDEN_PATH, 'utf-8').trimEnd();
    const actual = JSON.stringify(GEM_INFO, null, 2);
    expect(JSON.parse(actual)).toEqual(JSON.parse(expected));
    expect(actual).toBe(expected);
  });
});
