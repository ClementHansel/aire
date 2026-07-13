import { Pool } from 'pg';
import type { PaymentKind } from './payment-method.service';

/**
 * Fixed placement order per kind so POS buttons stay in a predictable position
 * (cash first, then digital, then cards/transfer). Lower = shown first.
 */
export const KIND_RANK: Record<PaymentKind, number> = {
  cash: 0,
  qris: 1,
  edc: 2,
  cc: 3,
  transfer: 4,
};

export interface DefaultPaymentMethod {
  name: string;
  kind: PaymentKind;
  businessUnit: 'AIRE' | 'LEAD' | null;
  color: string;
}

/**
 * A sensible starter set every new tenant gets so cashiers can take payment on
 * day one. Kept generic (no bank-specific accounts) — tenants edit/add their own.
 */
export const DEFAULT_PAYMENT_METHODS: DefaultPaymentMethod[] = [
  { name: 'Cash', kind: 'cash', businessUnit: null, color: '#16a34a' },
  { name: 'QRIS', kind: 'qris', businessUnit: 'AIRE', color: '#4f46e5' },
  { name: 'Debit / Credit (EDC)', kind: 'edc', businessUnit: 'AIRE', color: '#ea580c' },
  { name: 'Bank Transfer', kind: 'transfer', businessUnit: 'AIRE', color: '#475569' },
];

/**
 * Seeds the default payment methods for a tenant, but only if it currently has
 * none — so it is safe to call on onboarding and idempotent on repeat. Returns
 * the number of rows inserted (0 when the tenant already had methods).
 */
export async function seedDefaultPaymentMethods(pool: Pool, tenantId: string): Promise<number> {
  const existing = await pool.query('SELECT 1 FROM payment_methods WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  if ((existing.rowCount ?? 0) > 0) return 0;

  let inserted = 0;
  for (const m of DEFAULT_PAYMENT_METHODS) {
    await pool.query(
      `INSERT INTO payment_methods (tenant_id, outlet_id, name, kind, business_unit, color, sort_order, is_active)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, true)`,
      [tenantId, m.name, m.kind, m.businessUnit, m.color, KIND_RANK[m.kind]],
    );
    inserted++;
  }
  return inserted;
}
