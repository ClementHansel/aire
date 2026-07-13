/**
 * Per-tenant module registry.
 *
 * The platform super-admin can enable/disable these functional modules for each
 * tenant. Modules default to ENABLED — a module is only hidden when its flag is
 * explicitly `false` — so existing tenants keep full functionality until an
 * admin turns something off.
 *
 * Core areas (Hub, Overview, Users & Roles, Settings) are intentionally NOT in
 * this list: they are always available and cannot be disabled.
 */

export interface TenantModuleDef {
  /** Stable key stored in tenants.settings.featureFlags and used for nav gating. */
  key: string;
  /** Human label shown in the super-admin toggle panel. */
  label: string;
  /** Short description of what the module covers. */
  description: string;
}

export const TENANT_MODULES: TenantModuleDef[] = [
  { key: 'analytics', label: 'Analytics & Reports', description: 'Transactions, invoices, reports, and sales/leads.' },
  { key: 'crm', label: 'Customers & Bookings', description: 'Customer directory (CRM) and booking management.' },
  { key: 'memberships', label: 'Memberships', description: 'Membership plans, plates, and usage tracking.' },
  { key: 'vouchers', label: 'Vouchers', description: 'Voucher packs, codes, and redemption.' },
  { key: 'promotions', label: 'Promotions', description: 'Promotional campaigns and rewards.' },
  { key: 'catalog', label: 'Catalog & Outlets', description: 'Branches, services, catalog, and payment methods.' },
  { key: 'inventory', label: 'Inventory & Procurement', description: 'Stock tracking and purchasing.' },
  { key: 'finance', label: 'Finance & Settlement', description: 'Finance dashboard and inter-branch settlement.' },
  { key: 'hr', label: 'HR & Payroll', description: 'Employee management and payroll.' },
  { key: 'ai_assistant', label: 'AI Assistant', description: 'In-app AI assistant and agent workflows.' },
  { key: 'whatsapp', label: 'WhatsApp AI Agent', description: 'WhatsApp agent, conversations, and AI monitoring.' },
];

export const TENANT_MODULE_KEYS: string[] = TENANT_MODULES.map((m) => m.key);

export type TenantModuleFlags = Record<string, boolean>;

/**
 * Resolve the enabled/disabled state of every known module for a tenant.
 * Default is ENABLED; a module is disabled only when its flag is explicitly false.
 */
export function resolveTenantModules(
  featureFlags?: TenantModuleFlags | null,
): Record<string, boolean> {
  const flags = featureFlags ?? {};
  const out: Record<string, boolean> = {};
  for (const key of TENANT_MODULE_KEYS) {
    out[key] = flags[key] !== false;
  }
  return out;
}

/**
 * Whether a given module is enabled for a tenant. Unknown/core keys are always
 * enabled (they are not toggleable).
 */
export function isModuleEnabled(
  featureFlags: TenantModuleFlags | null | undefined,
  key: string,
): boolean {
  if (!TENANT_MODULE_KEYS.includes(key)) return true;
  return (featureFlags ?? {})[key] !== false;
}
