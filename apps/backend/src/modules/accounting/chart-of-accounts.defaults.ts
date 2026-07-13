import { Pool } from 'pg';

/**
 * Default chart of accounts seeded per tenant. Codes are STABLE — the auto-poster
 * resolves accounts by these codes, so don't rename/renumber the system ones.
 * Kept intentionally small and SMB-friendly; tenants can add their own accounts.
 */
export interface DefaultAccount {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normalBalance: 'debit' | 'credit';
}

// Account codes the auto-poster relies on.
export const ACC = {
  CASH: '1000',
  BANK: '1010',
  INVENTORY: '1300',
  INTERBRANCH_RECEIVABLE: '1400',
  INTERBRANCH_PAYABLE: '2100',
  TAX_PAYABLE: '2300',
  OWNER_EQUITY: '3000',
  RETAINED_EARNINGS: '3900',
  SALES: '4000',
  INTERBRANCH_INCOME: '4800',
  COGS: '5000',
  OPEX: '6000',
  SALARIES: '6100',
  INTERBRANCH_CHARGE: '6300',
} as const;

export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  // Assets
  { code: ACC.CASH, name: 'Cash', type: 'asset', normalBalance: 'debit' },
  { code: ACC.BANK, name: 'Bank', type: 'asset', normalBalance: 'debit' },
  { code: ACC.INVENTORY, name: 'Inventory', type: 'asset', normalBalance: 'debit' },
  { code: ACC.INTERBRANCH_RECEIVABLE, name: 'Inter-branch Receivable', type: 'asset', normalBalance: 'debit' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'liability', normalBalance: 'credit' },
  { code: ACC.INTERBRANCH_PAYABLE, name: 'Inter-branch Payable', type: 'liability', normalBalance: 'credit' },
  { code: '2200', name: 'Salaries Payable', type: 'liability', normalBalance: 'credit' },
  { code: ACC.TAX_PAYABLE, name: 'Tax Payable (PPN)', type: 'liability', normalBalance: 'credit' },
  // Equity
  { code: ACC.OWNER_EQUITY, name: "Owner's Equity", type: 'equity', normalBalance: 'credit' },
  { code: '3900', name: 'Retained Earnings', type: 'equity', normalBalance: 'credit' },
  // Revenue
  { code: ACC.SALES, name: 'Sales Revenue', type: 'revenue', normalBalance: 'credit' },
  { code: ACC.INTERBRANCH_INCOME, name: 'Inter-branch Income', type: 'revenue', normalBalance: 'credit' },
  { code: '4900', name: 'Other Income', type: 'revenue', normalBalance: 'credit' },
  // Expenses
  { code: ACC.COGS, name: 'Cost of Goods Sold', type: 'expense', normalBalance: 'debit' },
  { code: ACC.OPEX, name: 'Operating Expenses', type: 'expense', normalBalance: 'debit' },
  { code: ACC.SALARIES, name: 'Salaries & Wages', type: 'expense', normalBalance: 'debit' },
  { code: ACC.INTERBRANCH_CHARGE, name: 'Inter-branch Charge', type: 'expense', normalBalance: 'debit' },
];

/**
 * Seed the default chart of accounts for a tenant. Idempotent — no-op if the
 * tenant already has any accounts. Mirrors seedDefaultPaymentMethods.
 */
export async function seedDefaultChartOfAccounts(pool: Pool, tenantId: string): Promise<number> {
  const existing = await pool.query('SELECT 1 FROM chart_of_accounts WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  if ((existing.rowCount ?? 0) > 0) return 0;
  let n = 0;
  for (const a of DEFAULT_ACCOUNTS) {
    await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, type, normal_balance, is_system)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenantId, a.code, a.name, a.type, a.normalBalance],
    );
    n++;
  }
  return n;
}
