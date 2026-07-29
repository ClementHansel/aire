'use client';

import { normalizePlate } from '@aire/shared';

/**
 * License-plate text input that canonicalises as the user types.
 *
 * Every plate the product stores must be whitespace-stripped and uppercased, so
 * that one vehicle has exactly one spelling across POS orders, the arrival queue,
 * memberships, portal bookings and the kiosk. Before this existed each surface
 * had its own bare `<input>`, so "B 8882 CST" and "B8882CST" became two different
 * cars and a search for one missed the other (AIRIN-117).
 *
 * Normalising on change rather than on submit is deliberate: the user sees exactly
 * the value that will be stored and searched, instead of it silently changing
 * underneath them after they hit save.
 *
 * The server normalises again on write — this is the UX half, never the guarantee.
 */
export function PlateInput({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  id,
  required,
  disabled,
  testId,
}: {
  value: string;
  /** Receives the already-normalised value. */
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <input
      id={id}
      className={className ?? 'input-field'}
      placeholder={placeholder}
      aria-label={ariaLabel}
      required={required}
      disabled={disabled}
      data-testid={testId}
      value={value}
      // normalizePlate returns '' for input with no alphanumerics, which correctly
      // lets the field be cleared.
      onChange={(e) => onChange(normalizePlate(e.target.value).normalized)}
      autoCapitalize="characters"
      spellCheck={false}
    />
  );
}
