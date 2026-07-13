/**
 * Barcode helpers shared by the barcode module and the product/service store.
 *
 * `generateInStoreBarcode` builds a valid EAN-13 using the GS1 "in-store" (a.k.a.
 * restricted-circulation) prefix `20`, which is reserved for retailer-internal
 * item numbering — perfect for products a tenant defines that have no
 * manufacturer GTIN. Layout: `20` + 10-digit zero-padded sequence + 1 check
 * digit = 13 digits total.
 */

/** Standard EAN-13 modulo-10 check digit for a 12-digit numeric base. */
export function ean13CheckDigit(base12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = base12.charCodeAt(i) - 48; // '0' => 0
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Build an EAN-13 in-store barcode for a zero-based sequence number.
 * `20` prefix + 10-digit sequence + check digit.
 */
export function generateInStoreBarcode(sequence: number): string {
  const seq = Math.max(0, Math.floor(sequence)) % 10_000_000_000; // 10 digits max
  const base12 = `20${String(seq).padStart(10, '0')}`;
  return `${base12}${ean13CheckDigit(base12)}`;
}
