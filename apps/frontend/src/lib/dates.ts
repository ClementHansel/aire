/**
 * Date helpers shared across dashboard pages.
 *
 * The API returns date-only columns (campaign start_date, promotion windows) as
 * either `YYYY-MM-DD` or a full ISO timestamp, depending on the driver's type
 * mapping. Two things break when a raw value is used directly:
 *
 * 1. `<input type="date">` silently renders BLANK for anything that isn't
 *    exactly `YYYY-MM-DD` — an edit form prefilled with a timestamp looks like
 *    it lost the value. Use `toDateInput` on every date input's `value`.
 * 2. Raw ISO strings in a table read as machine output. Use `fmtDate` /
 *    `fmtDateRange` for anything a tenant sees.
 */

/** Locale used for all human-facing dates. Indonesian tenants, Indonesian dates. */
const LOCALE = 'id-ID';

/**
 * Normalize an API date value to the `YYYY-MM-DD` that `<input type="date">`
 * requires. Accepts date-only strings, ISO timestamps, and Date objects.
 * Returns '' for null/undefined/unparseable input so the input renders empty
 * rather than throwing.
 */
export function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : localIsoDate(value);
  }
  // Already date-only — the common case; avoid Date parsing (which would treat
  // it as UTC midnight and can shift the day in negative-offset timezones).
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (m) return m[1]!;
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : localIsoDate(d);
}

/** `YYYY-MM-DD` in local time (not UTC — avoids off-by-one-day). */
function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Human-readable date, e.g. `29 Jul 2026`. Returns '—' for empty/unparseable
 * values so tables don't show blank cells.
 */
export function fmtDate(value: string | Date | null | undefined): string {
  const iso = toDateInput(value);
  if (!iso) return '—';
  // Parse the normalized date-only string as local time so the displayed day
  // matches the stored day regardless of timezone.
  const [y, mo, da] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, mo - 1, da).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Human-readable inclusive date range for a "Period" column, e.g.
 * `29 Jul 2026 – 31 Aug 2026`. Collapses to a single date when both ends match.
 */
export function fmtDateRange(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): string {
  const a = toDateInput(from);
  const b = toDateInput(to);
  if (!a && !b) return '—';
  if (a && b && a === b) return fmtDate(a);
  if (!b) return `${fmtDate(a)} –`;
  if (!a) return `– ${fmtDate(b)}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}
