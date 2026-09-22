/**
 * Rupiah formatting for anything the customer agent may quote.
 *
 * WHY THIS EXISTS AT ALL: every money field handed to the WhatsApp agent used
 * to be a bare JavaScript number — `price: 750000`. The system prompt tells the
 * model "Write prices EXACTLY: Rp 60.000" and "Every Rp figure you send must
 * appear verbatim in a tool result", but no Rp string existed in ANY tool
 * result, so the instruction was unsatisfiable: the model had to invent the
 * separators itself. That is fine at four digits and progressively less fine
 * further up — a calibration price list runs to eight (Rp 27.500.000), which is
 * exactly where a model starts producing "Rp 27,5 juta", "Rp 27.500.00" or a
 * dropped digit.
 *
 * So every money value now travels with a pre-rendered string and the prompt
 * tells the model to copy THAT. Formatting stops being a thing the model does
 * and becomes a thing it quotes, which is the only version of "verbatim" that
 * is actually checkable.
 *
 * Indonesian convention: '.' groups thousands ("Rp 1.250.000"). `id-ID` gets
 * this right, but it is locale data, so the tests pin real values from the
 * client's own price list rather than trusting the runtime's ICU build.
 */

/**
 * Render a Rupiah amount the way the agent must repeat it.
 *
 * Rounds to whole Rupiah: sub-unit Rupiah does not exist in practice, prices
 * arrive from Postgres `DECIMAL` as strings like "750000.00", and a stray
 * ".00" or ",5" in a quoted price reads as an error to the customer.
 */
export function formatRupiah(value: number | string | null | undefined): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

/**
 * Attach `priceText` next to a numeric `price`.
 *
 * Both are kept: the number is what any caller should compare or sort on, the
 * string is the ONLY thing the model is allowed to repeat to a customer. Do not
 * "simplify" this by dropping the number — sorting on a formatted string is how
 * Rp 1.000.000 ends up cheaper than Rp 750.000.
 */
export function withPriceText<T extends { price: number }>(row: T): T & { priceText: string } {
  return { ...row, priceText: formatRupiah(row.price) ?? `Rp ${row.price}` };
}
