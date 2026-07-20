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
 * ──────────────────────────────────────────────────────────────────────────
 * LEAN MODE — temporary product focus for early client testing.
 *
 * While `LEAN_MODE` is true the tenant product is pared back to the original
 * Aire POS PRD core (POS, memberships, vouchers, orders, reports, CRM, catalog)
 * plus the WhatsApp agent. Everything built beyond that PRD is HELD: hidden from
 * navigation, blocked on direct-URL access, and its interlinked backend routes
 * are disabled so a client can't wander into a half-configured flow.
 *
 * This is intentionally a single hardcoded switch, not a per-tenant flag: it is
 * a product-wide focus toggle. Flip to `false` to restore the full product in
 * one place (per-tenant module toggles in super-admin still work underneath for
 * later selective re-enable). NOTHING is deleted — only gated.
 * ──────────────────────────────────────────────────────────────────────────
 */
export const LEAN_MODE = true;

/**
 * Dashboard nav item ids that are held while lean. These map to `NavItem.id`
 * values in the dashboard layout. Sections left empty by this filtering drop out
 * of the sidebar automatically.
 */
export const HELD_NAV_IDS: string[] = [
  // Analytics
  'invoices', 'shifts',
  // Customers
  'bookings', 'feedback', 'broadcast',
  // Catalog & Outlets
  'legal-entities', 'kiosks', 'pos-devices', 'barcode-settings', 'vehicles',
  // Operations (whole section)
  'inventory', 'procurement', 'opname', 'cctv', 'topology', 'devices',
  // Finance & People (whole section)
  'finance-setup', 'finance', 'accounting', 'pnl', 'cogs', 'settlement',
  'tax-invoices', 'hr', 'payroll', 'commission',
  // AI (keep `conversations` + `ai-agent` slimmed to WhatsApp connection)
  'assistant', 'agents', 'monitoring',
  // Administration
  'audit',
];

/**
 * Route prefixes blocked from direct-URL access while lean. Covers the held
 * dashboard subroutes plus the customer/employee surfaces that are disabled
 * outright (self-order, employee self-service, customer portal). Super-admins
 * are exempt (enforced at the guard call site).
 */
export const HELD_ROUTE_PREFIXES: string[] = [
  // Held dashboard subroutes
  '/dashboard/invoices', '/dashboard/shifts', '/dashboard/bookings',
  '/dashboard/feedback', '/dashboard/broadcast', '/dashboard/legal-entities',
  '/dashboard/kiosks', '/dashboard/pos-devices', '/dashboard/barcode-settings',
  '/dashboard/vehicles', '/dashboard/inventory', '/dashboard/procurement',
  '/dashboard/opname', '/dashboard/cctv', '/dashboard/topology',
  '/dashboard/devices', '/dashboard/finance-setup', '/dashboard/finance',
  '/dashboard/accounting', '/dashboard/pnl', '/dashboard/cogs',
  '/dashboard/settlement', '/dashboard/tax-invoices', '/dashboard/hr',
  '/dashboard/payroll', '/dashboard/commission', '/dashboard/assistant',
  '/dashboard/agents', '/dashboard/monitoring', '/dashboard/audit',
];

/** Whether a nav item id is currently held (hidden) by lean mode. */
export function isHeld(id: string): boolean {
  return LEAN_MODE && HELD_NAV_IDS.includes(id);
}

/**
 * Whether a route path is held (blocked) by lean mode. Matches exact path or any
 * sub-path of a held prefix.
 */
export function isHeldRoute(path: string): boolean {
  if (!LEAN_MODE) return false;
  return HELD_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

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
