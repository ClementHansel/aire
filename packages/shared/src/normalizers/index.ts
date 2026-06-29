/**
 * Shared normalizers for the AIRE Operations Platform.
 */

import { MIN_PHONE_LENGTH } from '../constants';

export interface PhoneNormalizationResult {
  normalized: string;
  valid: boolean;
}

/**
 * Normalizes an Indonesian phone number to canonical 62xxxxxxxxx format.
 *
 * Handles the following prefix variants:
 * - 0xxx → 62xxx
 * - 62xxx → 62xxx (already canonical)
 * - +62xxx → 62xxx (strip the +)
 *
 * After normalization, validates that the result has at least MIN_PHONE_LENGTH digits.
 * Returns { normalized, valid: true } on success, or { normalized: '', valid: false } on failure.
 */
export function normalizePhone(input: string): PhoneNormalizationResult {
  // Strip all non-digit characters
  const digits = input.replace(/\D/g, '');

  let normalized: string;

  if (digits.startsWith('62')) {
    // Already in canonical format (also handles +62 since + was stripped)
    normalized = digits;
  } else if (digits.startsWith('0')) {
    // Replace leading 0 with 62
    normalized = '62' + digits.slice(1);
  } else {
    // No valid Indonesian prefix found
    return { normalized: '', valid: false };
  }

  // Validate minimum length
  if (normalized.length < MIN_PHONE_LENGTH) {
    return { normalized: '', valid: false };
  }

  return { normalized, valid: true };
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export interface PlateNormalizationResult {
  normalized: string;
  valid: boolean;
}

/**
 * Normalizes a license plate input by stripping all whitespace and converting to uppercase.
 * Returns the normalized plate and a validity flag.
 *
 * Validation rules:
 * - Result must not be empty
 * - Result must contain at least one alphanumeric character
 *
 * @example normalizePlate("B 1234 abc") → { normalized: "B1234ABC", valid: true }
 * @example normalizePlate("   ")        → { normalized: "", valid: false }
 */
export function normalizePlate(input: string): PlateNormalizationResult {
  // Strip all whitespace (spaces, tabs, etc.)
  const stripped = input.replace(/\s/g, '');

  // Convert to uppercase
  const normalized = stripped.toUpperCase();

  // Validate: not empty and contains at least one alphanumeric character
  const valid = normalized.length > 0 && /[A-Z0-9]/.test(normalized);

  if (!valid) {
    return { normalized: '', valid: false };
  }

  return { normalized, valid: true };
}
