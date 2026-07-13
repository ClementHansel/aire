import { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

const toBase36 = (n: number, width: number) => n.toString(36).toUpperCase().padStart(width, '0');
const fromBase36 = (s?: string | null) => {
  if (!s) return 0;
  const v = parseInt(s.trim(), 36);
  return Number.isFinite(v) ? v : 0;
};

/**
 * Assign a tenant its globally-unique 6-char base-36 code (idempotent). Called at
 * tenant registration so the code exists from the start and feeds membership
 * numbers. Uses MAX(code)+1 (fixed-width zero-padded base-36 sorts numerically);
 * a unique index guards concurrent races. Best-effort: pass the shared pool, not
 * a transaction client, so a rare collision retries instead of poisoning a tx.
 */
export async function assignTenantCode(db: Queryable, tenantId: string): Promise<string | null> {
  const cur = await db.query<{ tenant_code: string | null }>(`SELECT tenant_code FROM tenants WHERE id = $1`, [tenantId]);
  if (cur.rows[0]?.tenant_code) return cur.rows[0].tenant_code.trim();
  for (let i = 0; i < 6; i++) {
    const mx = await db.query<{ code: string }>(
      `SELECT tenant_code AS code FROM tenants WHERE tenant_code IS NOT NULL ORDER BY tenant_code DESC LIMIT 1`,
    );
    const code = toBase36(fromBase36(mx.rows[0]?.code) + 1, 6);
    const upd = await db
      .query(`UPDATE tenants SET tenant_code = $2 WHERE id = $1 AND tenant_code IS NULL`, [tenantId, code])
      .catch(() => ({ rowCount: 0 }));
    if ((upd.rowCount ?? 0) > 0) return code;
    const re = await db.query<{ tenant_code: string | null }>(`SELECT tenant_code FROM tenants WHERE id = $1`, [tenantId]);
    if (re.rows[0]?.tenant_code) return re.rows[0].tenant_code.trim();
  }
  return null;
}
