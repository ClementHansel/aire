import { Pool } from 'pg';

/**
 * What both voucher WhatsApp notifications need to know about a book: what to
 * CALL it, who owns it, and which of its codes are still usable.
 *
 * A book is named by its template ("Voucher Cuci 10x"); books sold ad-hoc from
 * the dashboard have no template, so they fall back to the benefit service
 * ("Cuci Mobil"), then to a generic label. Samuel's ask was explicit that the
 * customer must see the voucher's NAME, not just a bare code list.
 */
export interface VoucherBookSummary {
  name: string;
  buyerPhone: string | null;
  buyerName: string | null;
  expiryDate: string | null;
  source: 'sale' | 'bonus' | 'adhoc';
  outletId: string | null;
}

/** A voucher message never lists more codes than this — see formatCodeList. */
export const MAX_CODES_LISTED = 40;

export async function loadBookSummary(
  pool: Pool,
  tenantId: string,
  bookId: string,
): Promise<VoucherBookSummary | null> {
  const res = await pool.query<{
    buyer_phone: string | null; buyer_name: string | null; expiry_date: string | null;
    source: string | null; outlet_id: string | null;
    template_name: string | null; benefit_name: string | null;
    benefit_type: string | null;
  }>(
    `SELECT b.buyer_phone, b.buyer_name, b.expiry_date::text AS expiry_date, b.source, b.outlet_id,
            vt.name AS template_name, bs.name AS benefit_name, b.benefit_type
     FROM voucher_books b
     LEFT JOIN voucher_templates vt ON vt.id = b.template_id
     LEFT JOIN services bs ON bs.id = b.benefit_service_id
     WHERE b.id = $1 AND b.tenant_id = $2`,
    [bookId, tenantId],
  );
  const b = res.rows[0];
  if (!b) return null;

  return {
    name: b.template_name?.trim() || b.benefit_name?.trim() || genericName(b.benefit_type),
    buyerPhone: b.buyer_phone,
    buyerName: b.buyer_name,
    expiryDate: b.expiry_date,
    source: (b.source as VoucherBookSummary['source']) ?? 'adhoc',
    outletId: b.outlet_id,
  };
}

/** Codes in a book that can still be used, oldest first. */
export async function loadActiveCodes(pool: Pool, tenantId: string, bookId: string): Promise<string[]> {
  const res = await pool.query<{ code: string }>(
    `SELECT code FROM voucher_tickets
     WHERE book_id = $1 AND tenant_id = $2 AND status = 'active'
     ORDER BY code`,
    [bookId, tenantId],
  );
  return res.rows.map((r) => r.code);
}

/**
 * Numbered code list for a WhatsApp bubble. A book can hold up to 1000 tickets
 * (sellBook's cap) and WhatsApp truncates long messages, so past MAX_CODES_LISTED
 * we say how many are left rather than emitting a wall of text that gets cut off
 * mid-code — a half-printed code is worse than an honest count, because the
 * customer cannot tell it was truncated.
 */
export function formatCodeList(codes: string[]): string {
  const shown = codes.slice(0, MAX_CODES_LISTED);
  const lines = shown.map((c, i) => `${i + 1}. ${c}`);
  const rest = codes.length - shown.length;
  if (rest > 0) lines.push(`...dan ${rest} kode lainnya (bisa dicek di kasir ya kak)`);
  return lines.join('\n');
}

function genericName(benefitType: string | null): string {
  if (benefitType === 'fixed' || benefitType === 'percentage') return 'Voucher Diskon';
  return 'Voucher';
}
