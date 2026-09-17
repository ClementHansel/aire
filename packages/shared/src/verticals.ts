/**
 * Tenant verticals — what SHAPE of business a tenant runs.
 *
 * This is deliberately a different axis from `TENANT_MODULES` (see modules.ts):
 *
 *   - A MODULE is a feature a tenant may or may not have bought. A car wash can
 *     switch CCTV off and still be a car wash.
 *   - A VERTICAL is what the business fundamentally is. It decides whether a
 *     concept EXISTS at all — a lab-services company has no license plates to
 *     type, no matter which modules it pays for.
 *
 * The platform was built with exactly one vertical baked in: a car wash. Plate,
 * brand and model were captured on every order and the POS refused to take an
 * order without a plate. That is right for the founding tenant and wrong for
 * everyone else, so the assumptions now live here, behind `tenants.vertical`.
 *
 * Adding a vertical is a code change here plus a value in the CHECK constraint
 * in migration 100 — never a new set of columns.
 */

export type TenantVertical = 'carwash' | 'services' | 'fnb' | 'laundry';

export const TENANT_VERTICALS: { key: TenantVertical; label: string; description: string }[] = [
  { key: 'carwash', label: 'Car Wash & Detailing', description: 'Vehicles arrive, are queued into bays, and leave. Captures plate, brand and model.' },
  { key: 'services', label: 'Services / B2B', description: 'Jobs are booked against a customer, not a vehicle. Testing, calibration, inspection, consulting.' },
  { key: 'fnb', label: 'Food & Beverage', description: 'Counter or table orders. No vehicle identity, no bays.' },
  { key: 'laundry', label: 'Laundry', description: 'Items are dropped off, processed, and collected against a ticket.' },
];

export const TENANT_VERTICAL_KEYS = TENANT_VERTICALS.map((v) => v.key);

/** The default a tenant gets when nothing is set. Every tenant that existed before
 *  migration 100 is a car wash, so this default is also the correct backfill. */
export const DEFAULT_VERTICAL: TenantVertical = 'carwash';

/**
 * What a vertical can do. Every flag gates a CONCEPT, not a screen — if
 * `vehicles` is false the plate field is not merely hidden, it is not required
 * and not written.
 */
export interface TenantCapabilities {
  /** Capture vehicle identity (plate / brand / model) on orders, queue entries
   *  and memberships. When false the plate input disappears and plate-based
   *  membership activation falls back to activating against the customer. */
  vehicles: boolean;
  /** Physical service bays and the live queue board that assigns work to them. */
  bays: boolean;
  /** Automatic number-plate recognition from branch cameras. Implies `vehicles`. */
  lpr: boolean;
  /** The noun the UI uses for the thing a job is performed on. Shown wherever
   *  the car-wash build said "Vehicle". */
  subjectNoun: string;
}

const CAPABILITIES: Record<TenantVertical, TenantCapabilities> = {
  carwash: { vehicles: true, bays: true, lpr: true, subjectNoun: 'Vehicle' },
  services: { vehicles: false, bays: false, lpr: false, subjectNoun: 'Job' },
  fnb: { vehicles: false, bays: false, lpr: false, subjectNoun: 'Order' },
  laundry: { vehicles: false, bays: false, lpr: false, subjectNoun: 'Item' },
};

/** Narrow an arbitrary DB string to a known vertical, falling back to the default. */
export function asVertical(value: unknown): TenantVertical {
  return typeof value === 'string' && (TENANT_VERTICAL_KEYS as string[]).includes(value)
    ? (value as TenantVertical)
    : DEFAULT_VERTICAL;
}

/**
 * Effective capabilities = the vertical's preset overlaid with any explicit
 * per-tenant override from `tenants.settings.features`.
 *
 * An ABSENT key inherits the preset; only an explicit boolean overrides it. That
 * mirrors how `settings.entitlementOverrides` layers over plan limits, and means
 * an empty/missing `features` object is always safe to pass.
 */
export function resolveCapabilities(
  vertical: unknown,
  overrides?: Partial<Record<keyof TenantCapabilities, unknown>> | null,
): TenantCapabilities {
  const base = CAPABILITIES[asVertical(vertical)];
  if (!overrides || typeof overrides !== 'object') return { ...base };

  const out: TenantCapabilities = { ...base };
  if (typeof overrides.vehicles === 'boolean') out.vehicles = overrides.vehicles;
  if (typeof overrides.bays === 'boolean') out.bays = overrides.bays;
  if (typeof overrides.lpr === 'boolean') out.lpr = overrides.lpr;
  if (typeof overrides.subjectNoun === 'string' && overrides.subjectNoun.trim()) {
    out.subjectNoun = overrides.subjectNoun.trim();
  }
  // LPR reads plates off a camera; without vehicle identity there is nothing for
  // it to match against, so it can never be on alone.
  if (!out.vehicles) out.lpr = false;
  return out;
}

/**
 * Business units a BRAND-NEW tenant of this vertical starts with.
 *
 * Historically this list was hardcoded to AIRE/LEAD — the founding tenant's two
 * brands — which meant a second car wash was seeded with someone else's brand
 * names, and every `?? 'AIRE'` fallback in the codebase silently wrote them a
 * unit code they did not own. Codes are now generic; the founding tenant keeps
 * AIRE/LEAD because the seed is idempotent and skips any tenant that already
 * has units (migration 096 gave them theirs).
 */
export const DEFAULT_BUSINESS_UNITS_BY_VERTICAL: Record<
  TenantVertical,
  { code: string; name: string; color: string }[]
> = {
  carwash: [
    { code: 'WASH', name: 'Wash', color: '#0ea5e9' },
    { code: 'DETAIL', name: 'Detailing', color: '#8b5cf6' },
  ],
  services: [{ code: 'MAIN', name: 'Services', color: '#0ea5e9' }],
  fnb: [
    { code: 'FOOD', name: 'Food', color: '#f97316' },
    { code: 'BEVERAGE', name: 'Beverage', color: '#0ea5e9' },
  ],
  laundry: [{ code: 'MAIN', name: 'Laundry', color: '#0ea5e9' }],
};

/**
 * How to describe this kind of business to an LLM, in the prompt's own voice.
 *
 * The WhatsApp agent used to hardcode "an Indonesian car wash & detailing
 * business (brands: AIRE car wash, LEAD detailing)" into every tenant's system
 * prompt — so a second company's bot would introduce itself as a car wash and
 * offer to wash cars. The tenant's own name is substituted at call time; this
 * only supplies the KIND of business.
 */
export const VERTICAL_BUSINESS_DESCRIPTION: Record<TenantVertical, string> = {
  carwash: 'car wash & detailing business',
  services: 'testing, inspection, certification & calibration services business',
  fnb: 'food & beverage business',
  laundry: 'laundry business',
};

/**
 * Wording the deterministic (non-LLM) WhatsApp fallback replies use for the
 * thing a customer is buying. The car-wash copy said "cuci mobil" everywhere,
 * which is nonsense for a lab or a laundry.
 */
export const VERTICAL_COPY: Record<TenantVertical, { serviceWord: string; emoji: string }> = {
  carwash: { serviceWord: 'cuci mobil', emoji: '\u{1F697}' },
  services: { serviceWord: 'layanan', emoji: '\u{1F9EA}' },
  fnb: { serviceWord: 'pesanan', emoji: '\u{1F37D}' },
  laundry: { serviceWord: 'laundry', emoji: '\u{1F9FA}' },
};

/** Modules that make no sense for a vertical and are forced off regardless of
 *  what the super-admin toggled. Keeps nav honest for non-vehicle tenants. */
export const MODULES_BLOCKED_BY_VERTICAL: Record<TenantVertical, string[]> = {
  carwash: [],
  services: ['cctv'],
  fnb: ['cctv'],
  laundry: ['cctv'],
};
