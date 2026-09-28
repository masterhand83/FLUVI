import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('traffic rule table', () => {
  it('preserves the effective key/value mapping and lookup outcomes', () => {
    const source = readFileSync(new URL('../src/js/core/reglas.js', import.meta.url), 'utf8');
    const context = {};
    runInNewContext(`${source}\nthis.rules = reglas;`, context);
    const expected = JSON.parse(readFileSync(new URL('./reglas.expected.json', import.meta.url), 'utf8'));

    expect(context.rules).toEqual(expected);
    expect(context.rules['0,0,0']).toBe(0); // empty cell
    for (let type = 1; type <= 6; type += 1) {
      expect(context.rules[`0,${type},${type}`]).toBe(type);
    }
    expect(context.rules['0,7,0']).toBe(7); // blockage
    expect(context.rules['99,99,99']).toBeUndefined(); // existing fallback condition
  });
});
