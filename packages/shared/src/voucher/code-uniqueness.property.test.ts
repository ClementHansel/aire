import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateVoucherPack, generateCode, hashVoucherCode } from './code-generator';

/**
 * Property-based tests for voucher code uniqueness.
 *
 * **Validates: Requirements 18.2**
 *
 * Property 21: For any batch of generated voucher codes, all codes within the batch
 * and across all existing codes SHALL be unique. No two voucher_codes rows SHALL
 * share the same code_hash.
 */

// --- Arbitrary Generators ---

/** Safe alphabet used by the code generator (no confusing chars: 0, O, 1, I, L) */
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generates a valid tenant prefix (1-6 uppercase letters) */
const arbTenantPrefix: fc.Arbitrary<string> = fc
  .stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), {
    minLength: 2,
    maxLength: 6,
  });

/** Generates a valid pack size (1-30, kept small for test performance) */
const arbPackSize: fc.Arbitrary<number> = fc.integer({ min: 1, max: 30 });

/** Generates a valid code length (4-12) */
const arbCodeLength: fc.Arbitrary<number> = fc.integer({ min: 4, max: 12 });

/** Generates a valid CodeGeneratorOptions object */
const arbCodeGeneratorOptions = fc.record({
  tenantPrefix: arbTenantPrefix,
  packSize: arbPackSize,
  codeLength: arbCodeLength,
});

describe('Voucher Code Uniqueness - Property-Based Tests (Property 21)', () => {
  describe('Intra-batch uniqueness', () => {
    it('all codes (parent + children) within a generated pack are unique', () => {
      fc.assert(
        fc.property(arbCodeGeneratorOptions, (options) => {
          const pack = generateVoucherPack(options);
          const allCodes = [pack.parentCode, ...pack.childCodes];
          const uniqueCodes = new Set(allCodes);

          expect(uniqueCodes.size).toBe(allCodes.length);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Hash uniqueness', () => {
    it('all hashes (parentCodeHash + childCodeHashes) within a pack are unique', () => {
      fc.assert(
        fc.property(arbCodeGeneratorOptions, (options) => {
          const pack = generateVoucherPack(options);
          const allHashes = [pack.parentCodeHash, ...pack.childCodeHashes];
          const uniqueHashes = new Set(allHashes);

          expect(uniqueHashes.size).toBe(allHashes.length);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Cross-batch uniqueness', () => {
    it('multiple generated packs from the same config produce distinct codes', () => {
      fc.assert(
        fc.property(arbCodeGeneratorOptions, (options) => {
          // Generate 3 packs with the same configuration
          const pack1 = generateVoucherPack(options);
          const pack2 = generateVoucherPack(options);
          const pack3 = generateVoucherPack(options);

          // Collect all codes from all packs
          const allCodes = [
            pack1.parentCode,
            ...pack1.childCodes,
            pack2.parentCode,
            ...pack2.childCodes,
            pack3.parentCode,
            ...pack3.childCodes,
          ];
          const uniqueCodes = new Set(allCodes);

          expect(uniqueCodes.size).toBe(allCodes.length);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Code-hash correspondence', () => {
    it('each unique code produces a unique hash (no hash collisions within a pack)', () => {
      fc.assert(
        fc.property(arbCodeGeneratorOptions, (options) => {
          const pack = generateVoucherPack(options);
          const allCodes = [pack.parentCode, ...pack.childCodes];
          const allHashes = [pack.parentCodeHash, ...pack.childCodeHashes];

          // Since all codes are unique and SHA-256 is collision-resistant,
          // all hashes should also be unique
          const uniqueHashes = new Set(allHashes);
          expect(uniqueHashes.size).toBe(allCodes.length);

          // Verify each hash corresponds to its code
          expect(allHashes[0]).toBe(hashVoucherCode(allCodes[0]));
          for (let i = 1; i < allCodes.length; i++) {
            expect(allHashes[i]).toBe(hashVoucherCode(allCodes[i]));
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Format consistency', () => {
    it('all generated codes follow the expected format pattern', () => {
      fc.assert(
        fc.property(arbCodeGeneratorOptions, (options) => {
          const pack = generateVoucherPack(options);
          const { tenantPrefix, codeLength } = options;

          // Parent code format: {TENANT}-PK-{RANDOM}
          const parentPattern = new RegExp(
            `^${tenantPrefix}-PK-[A-Z2-9]{${codeLength}}$`,
          );
          expect(pack.parentCode).toMatch(parentPattern);

          // Child codes format: {TENANT}-VC-{RANDOM}
          const childPattern = new RegExp(
            `^${tenantPrefix}-VC-[A-Z2-9]{${codeLength}}$`,
          );
          for (const code of pack.childCodes) {
            expect(code).toMatch(childPattern);
          }

          // All random portions use only safe alphabet characters
          const allCodes = [pack.parentCode, ...pack.childCodes];
          for (const code of allCodes) {
            const parts = code.split('-');
            // Random part is after the prefix (e.g., AIRE-PK-RANDOM or AIRE-VC-RANDOM)
            const randomPart = parts.slice(2).join('-');
            for (const char of randomPart) {
              expect(SAFE_ALPHABET).toContain(char);
            }
          }
        }),
        { numRuns: 200 },
      );
    });

    it('all hashes are valid 64-character hex strings (SHA-256)', () => {
      fc.assert(
        fc.property(arbCodeGeneratorOptions, (options) => {
          const pack = generateVoucherPack(options);
          const allHashes = [pack.parentCodeHash, ...pack.childCodeHashes];

          for (const hash of allHashes) {
            expect(hash).toHaveLength(64);
            expect(hash).toMatch(/^[a-f0-9]{64}$/);
          }
        }),
        { numRuns: 200 },
      );
    });
  });
});
