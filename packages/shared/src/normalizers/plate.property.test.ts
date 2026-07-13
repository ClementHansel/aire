import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizePlate } from './index';

/**
 * Property-Based Tests: License Plate Normalization Equivalence
 *
 * **Validates: Requirements 12.2, 38.2, 38.4**
 *
 * Property 5: For any valid license plate, all spacing/casing variants
 * produce the same canonical uppercase no-space form.
 */
describe('normalizePlate - Property Tests (Property 5: Normalization Equivalence)', () => {
  /**
   * Generator: produces non-empty strings containing at least one alphanumeric character.
   * These represent valid plate inputs that will pass the normalizePlate validation.
   */
  const validPlateArb = fc
    .tuple(
      fc.string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), minLength: 1,
        maxLength: 12, }),
      fc.array(
        fc.string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'), minLength: 0,
          maxLength: 4, }),
        { minLength: 0, maxLength: 3 },
      ),
    )
    .map(([first, rest]) => [first, ...rest].join(''));

  it('casing equivalence: normalizePlate(P) === normalizePlate(P.toLowerCase()) === normalizePlate(P.toUpperCase())', () => {
    fc.assert(
      fc.property(validPlateArb, (plate) => {
        const original = normalizePlate(plate);
        const lower = normalizePlate(plate.toLowerCase());
        const upper = normalizePlate(plate.toUpperCase());

        expect(original.normalized).toBe(lower.normalized);
        expect(original.normalized).toBe(upper.normalized);
        expect(original.valid).toBe(true);
        expect(lower.valid).toBe(true);
        expect(upper.valid).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('spacing equivalence: normalizePlate(P) === normalizePlate(P with random spaces inserted)', () => {
    const plateWithRandomSpaces = validPlateArb.chain((plate) =>
      fc
        .array(fc.nat({ max: 3 }), {
          minLength: plate.length + 1,
          maxLength: plate.length + 1,
        })
        .map((spaceCounts) => {
          let result = '';
          for (let i = 0; i < plate.length; i++) {
            result += ' '.repeat(spaceCounts[i]) + plate[i];
          }
          result += ' '.repeat(spaceCounts[plate.length]);
          return { original: plate, spaced: result };
        }),
    );

    fc.assert(
      fc.property(plateWithRandomSpaces, ({ original, spaced }) => {
        const normalResult = normalizePlate(original);
        const spacedResult = normalizePlate(spaced);

        expect(normalResult.normalized).toBe(spacedResult.normalized);
        expect(normalResult.valid).toBe(true);
        expect(spacedResult.valid).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('no whitespace in output: normalized result never contains whitespace', () => {
    fc.assert(
      fc.property(validPlateArb, (plate) => {
        const result = normalizePlate(plate);
        expect(result.valid).toBe(true);
        expect(result.normalized).not.toMatch(/\s/);
      }),
      { numRuns: 200 },
    );
  });

  it('all uppercase output: normalized result is entirely uppercase', () => {
    fc.assert(
      fc.property(validPlateArb, (plate) => {
        const result = normalizePlate(plate);
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe(result.normalized.toUpperCase());
      }),
      { numRuns: 200 },
    );
  });

  it('idempotency: normalizePlate(normalizePlate(P).normalized).normalized === normalizePlate(P).normalized', () => {
    fc.assert(
      fc.property(validPlateArb, (plate) => {
        const firstPass = normalizePlate(plate);
        expect(firstPass.valid).toBe(true);

        const secondPass = normalizePlate(firstPass.normalized);
        expect(secondPass.valid).toBe(true);
        expect(secondPass.normalized).toBe(firstPass.normalized);
      }),
      { numRuns: 200 },
    );
  });
});
