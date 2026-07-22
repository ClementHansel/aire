/**
 * Voucher pack code generation for the AIRE Operations Platform.
 *
 * Generates unique, collision-resistant alphanumeric voucher codes with
 * tenant-prefix format, and hashes them for secure storage.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Alphanumeric character set excluding visually confusing characters:
 * Excluded: 0 (zero), O (oh), 1 (one), I (eye), L (ell)
 */
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Options for generating a voucher pack.
 */
export interface CodeGeneratorOptions {
  /** Tenant prefix, e.g. "AIRE" */
  tenantPrefix: string;
  /** Number of child codes to generate */
  packSize: number;
  /** Length of the random portion of each code (default 8) */
  codeLength?: number;
}

/**
 * A generated voucher pack containing parent and child codes with their hashes.
 */
export interface GeneratedVoucherPack {
  /** Parent code, e.g. "AIRE-PK-AB12CD3E" */
  parentCode: string;
  /** Array of N unique child codes */
  childCodes: string[];
  /** SHA-256 hash of the parent code */
  parentCodeHash: string;
  /** SHA-256 hashes of the child codes (same order as childCodes) */
  childCodeHashes: string[];
}

/**
 * Generates a single unique alphanumeric code with the given prefix and random length.
 *
 * Format: `{prefix}-{RANDOM}` where RANDOM is composed of characters from SAFE_ALPHABET.
 * Uses crypto-safe random bytes for generation.
 *
 * @param prefix - The code prefix, e.g. "AIRE-PK" or "AIRE-VC"
 * @param length - Length of the random portion (default 8)
 * @returns A formatted code string
 */
export function generateCode(prefix: string, length: number = 8): string {
  const bytes = randomBytes(length);
  let random = '';
  for (let i = 0; i < length; i++) {
    random += SAFE_ALPHABET[bytes[i]! % SAFE_ALPHABET.length];
  }
  return `${prefix}-${random}`;
}

/**
 * Hashes a voucher code using SHA-256 for secure database storage.
 *
 * Codes are normalised (trimmed + upper-cased) before hashing so that a code
 * typed in lower case or with stray whitespace still matches the stored hash.
 * Generated codes are already upper-case, so this is idempotent for them — it
 * only rescues human entry (the cashier/customer typing "aire-vc-…").
 *
 * @param code - The plaintext voucher code
 * @returns Hex-encoded SHA-256 hash
 */
export function hashVoucherCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/**
 * Generates a complete voucher pack with a parent code and N unique child codes.
 *
 * Guarantees:
 * - All codes (parent + children) are unique within the pack
 * - Codes use crypto-safe random characters from a reduced alphabet (no confusing chars)
 * - Parent code uses format: `{TENANT}-PK-{RANDOM}`
 * - Child codes use format: `{TENANT}-VC-{RANDOM}`
 *
 * @param options - Configuration for pack generation
 * @returns Generated pack with codes and their hashes
 * @throws Error if packSize is less than 1
 */
export function generateVoucherPack(options: CodeGeneratorOptions): GeneratedVoucherPack {
  const { tenantPrefix, packSize, codeLength = 8 } = options;

  if (packSize < 1) {
    throw new Error('Pack size must be at least 1');
  }

  if (codeLength < 4) {
    throw new Error('Code length must be at least 4');
  }

  const parentPrefix = `${tenantPrefix}-PK`;
  const childPrefix = `${tenantPrefix}-VC`;

  // Generate parent code
  const parentCode = generateCode(parentPrefix, codeLength);
  const usedCodes = new Set<string>([parentCode]);

  // Generate unique child codes
  const childCodes: string[] = [];
  const maxAttempts = packSize * 10; // safety limit to prevent infinite loops
  let attempts = 0;

  while (childCodes.length < packSize) {
    if (attempts >= maxAttempts) {
      throw new Error(
        `Failed to generate ${packSize} unique codes after ${maxAttempts} attempts. Consider increasing code length.`,
      );
    }

    const code = generateCode(childPrefix, codeLength);
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      childCodes.push(code);
    }
    attempts++;
  }

  return {
    parentCode,
    childCodes,
    parentCodeHash: hashVoucherCode(parentCode),
    childCodeHashes: childCodes.map(hashVoucherCode),
  };
}
