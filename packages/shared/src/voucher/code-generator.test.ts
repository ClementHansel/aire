import { describe, it, expect } from 'vitest';
import {
  generateCode,
  hashVoucherCode,
  generateVoucherPack,
  CodeGeneratorOptions,
} from './code-generator';

describe('generateCode', () => {
  it('generates a code with the correct prefix', () => {
    const code = generateCode('AIRE-PK', 8);
    expect(code.startsWith('AIRE-PK-')).toBe(true);
  });

  it('generates a code with the correct random length', () => {
    const code = generateCode('AIRE-VC', 8);
    const randomPart = code.split('-').slice(2).join('-');
    expect(randomPart).toHaveLength(8);
  });

  it('generates a code with custom length', () => {
    const code = generateCode('TEST-PK', 12);
    const randomPart = code.split('-').slice(2).join('-');
    expect(randomPart).toHaveLength(12);
  });

  it('generates only safe alphanumeric characters (no 0, O, 1, I, L)', () => {
    // Generate many codes to increase probability of catching bad chars
    const confusingChars = ['0', 'O', '1', 'I', 'L'];
    for (let i = 0; i < 100; i++) {
      const code = generateCode('TEST-VC', 16);
      const randomPart = code.split('-').slice(2).join('-');
      for (const char of confusingChars) {
        expect(randomPart).not.toContain(char);
      }
    }
  });

  it('generates codes matching expected format pattern', () => {
    const code = generateCode('AIRE-PK', 8);
    // Format: PREFIX-RANDOM where RANDOM is uppercase alphanumeric (safe set)
    expect(code).toMatch(/^AIRE-PK-[A-Z2-9]{8}$/);
  });

  it('generates codes with only characters from the safe alphabet', () => {
    const safeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 50; i++) {
      const code = generateCode('X-VC', 10);
      const randomPart = code.split('-').slice(2).join('-');
      for (const char of randomPart) {
        expect(safeAlphabet).toContain(char);
      }
    }
  });
});

describe('hashVoucherCode', () => {
  it('produces a consistent hash for the same input', () => {
    const code = 'AIRE-PK-AB12CD3E';
    const hash1 = hashVoucherCode(code);
    const hash2 = hashVoucherCode(code);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', () => {
    const hash1 = hashVoucherCode('AIRE-PK-AAAAAAAA');
    const hash2 = hashVoucherCode('AIRE-PK-BBBBBBBB');
    expect(hash1).not.toBe(hash2);
  });

  it('produces a 64-character hex string (SHA-256)', () => {
    const hash = hashVoucherCode('AIRE-VC-12345678');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is a one-way hash (cannot be reversed)', () => {
    const code = 'AIRE-VC-TESTCODE';
    const hash = hashVoucherCode(code);
    // The hash should not contain the original code
    expect(hash).not.toContain(code);
    expect(hash).not.toContain('TESTCODE');
  });

  it('normalises case and whitespace so human-typed codes still match', () => {
    const canonical = hashVoucherCode('AIRE-VC-AB12CD3E');
    expect(hashVoucherCode('aire-vc-ab12cd3e')).toBe(canonical);
    expect(hashVoucherCode('  AIRE-VC-AB12CD3E  ')).toBe(canonical);
    expect(hashVoucherCode('Aire-Vc-Ab12Cd3e')).toBe(canonical);
  });
});

describe('generateVoucherPack', () => {
  const defaultOptions: CodeGeneratorOptions = {
    tenantPrefix: 'AIRE',
    packSize: 5,
    codeLength: 8,
  };

  it('generates the correct number of child codes', () => {
    const pack = generateVoucherPack(defaultOptions);
    expect(pack.childCodes).toHaveLength(5);
  });

  it('generates the correct number of child code hashes', () => {
    const pack = generateVoucherPack(defaultOptions);
    expect(pack.childCodeHashes).toHaveLength(5);
  });

  it('generates a parent code with PK prefix format', () => {
    const pack = generateVoucherPack(defaultOptions);
    expect(pack.parentCode).toMatch(/^AIRE-PK-[A-Z2-9]{8}$/);
  });

  it('generates child codes with VC prefix format', () => {
    const pack = generateVoucherPack(defaultOptions);
    for (const code of pack.childCodes) {
      expect(code).toMatch(/^AIRE-VC-[A-Z2-9]{8}$/);
    }
  });

  it('generates all unique codes within the pack (no duplicates)', () => {
    const pack = generateVoucherPack({ ...defaultOptions, packSize: 20 });
    const allCodes = [pack.parentCode, ...pack.childCodes];
    const uniqueCodes = new Set(allCodes);
    expect(uniqueCodes.size).toBe(allCodes.length);
  });

  it('generates a valid SHA-256 hash for the parent code', () => {
    const pack = generateVoucherPack(defaultOptions);
    expect(pack.parentCodeHash).toHaveLength(64);
    expect(pack.parentCodeHash).toMatch(/^[a-f0-9]{64}$/);
    // Verify hash matches the code
    expect(pack.parentCodeHash).toBe(hashVoucherCode(pack.parentCode));
  });

  it('generates valid SHA-256 hashes for child codes', () => {
    const pack = generateVoucherPack(defaultOptions);
    for (let i = 0; i < pack.childCodes.length; i++) {
      expect(pack.childCodeHashes[i]).toHaveLength(64);
      expect(pack.childCodeHashes[i]).toBe(hashVoucherCode(pack.childCodes[i]));
    }
  });

  it('respects custom code length', () => {
    const pack = generateVoucherPack({ ...defaultOptions, codeLength: 12 });
    const parentRandom = pack.parentCode.split('-').slice(2).join('-');
    expect(parentRandom).toHaveLength(12);
    for (const code of pack.childCodes) {
      const randomPart = code.split('-').slice(2).join('-');
      expect(randomPart).toHaveLength(12);
    }
  });

  it('uses default code length of 8 when not specified', () => {
    const pack = generateVoucherPack({ tenantPrefix: 'AIRE', packSize: 3 });
    const parentRandom = pack.parentCode.split('-').slice(2).join('-');
    expect(parentRandom).toHaveLength(8);
  });

  it('works with different tenant prefixes', () => {
    const pack = generateVoucherPack({ tenantPrefix: 'WASH', packSize: 2, codeLength: 8 });
    expect(pack.parentCode).toMatch(/^WASH-PK-[A-Z2-9]{8}$/);
    for (const code of pack.childCodes) {
      expect(code).toMatch(/^WASH-VC-[A-Z2-9]{8}$/);
    }
  });

  it('throws an error when packSize is less than 1', () => {
    expect(() => generateVoucherPack({ ...defaultOptions, packSize: 0 })).toThrow(
      'Pack size must be at least 1',
    );
  });

  it('throws an error when codeLength is less than 4', () => {
    expect(() => generateVoucherPack({ ...defaultOptions, codeLength: 3 })).toThrow(
      'Code length must be at least 4',
    );
  });

  it('generates a pack with a single child code', () => {
    const pack = generateVoucherPack({ ...defaultOptions, packSize: 1 });
    expect(pack.childCodes).toHaveLength(1);
    expect(pack.childCodeHashes).toHaveLength(1);
  });

  it('generates a large pack without collisions', () => {
    const pack = generateVoucherPack({ ...defaultOptions, packSize: 50, codeLength: 10 });
    const allCodes = [pack.parentCode, ...pack.childCodes];
    const uniqueCodes = new Set(allCodes);
    expect(uniqueCodes.size).toBe(51); // 1 parent + 50 children
  });
});
