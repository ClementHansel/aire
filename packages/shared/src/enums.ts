/**
 * User roles in the AIRE Platform hierarchy.
 * Order represents privilege level: platform_super_admin > tenant_owner > outlet_admin > cashier
 */
export enum Role {
  PlatformSuperAdmin = 'platform_super_admin',
  TenantOwner = 'tenant_owner',
  OutletAdmin = 'outlet_admin',
  Cashier = 'cashier',
}

/**
 * Order lifecycle states.
 * Valid transitions: ordered → paid → confirmed → completed
 *                   ordered → cancelled
 *                   paid → cancelled (void with refund)
 */
export enum OrderStatus {
  Ordered = 'ordered',
  Paid = 'paid',
  Confirmed = 'confirmed',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

/**
 * Supported payment methods.
 */
export enum PaymentMethod {
  Cash = 'cash',
  QrisStatic = 'qris_static',
  QrisDynamic = 'qris_dynamic',
  Edc = 'edc',
  CreditCard = 'cc',
  Transfer = 'transfer',
}

/**
 * Co-located business units within a single outlet.
 * AIRE = car wash; LEAD = detailing & polishing.
 * Every transaction is tagged to exactly one unit; service catalogs,
 * payment channels, and revenue reporting are segregated per unit.
 */
export enum BusinessUnit {
  Aire = 'AIRE',
  Lead = 'LEAD',
}

/**
 * Voucher discount types.
 */
export enum VoucherType {
  Fixed = 'fixed',
  Percentage = 'percentage',
  ServicePack = 'service_pack',
}

/**
 * Wash bay operational status.
 */
export enum BayStatus {
  Available = 'available',
  Occupied = 'occupied',
  Maintenance = 'maintenance',
}

/**
 * Membership subscription status.
 */
export enum MembershipStatus {
  Active = 'active',
  /** Paid period ended, within the H+1..H+14 renewable window (no benefits). */
  Grace = 'grace',
  /** Past the renewable window (H+15+) — terminal; a new membership is required. */
  Revoked = 'revoked',
  Expired = 'expired',
  Pending = 'pending',
  Cancelled = 'cancelled',
  /** Manually suspended by a higher-level role due to a rule breach (still within
   *  the paid duration, but blocked from use until reactivated). */
  Suspended = 'suspended',
}

/** Days after end_date a membership can still be renewed before it is revoked. */
export const MEMBERSHIP_GRACE_DAYS = 14;

/**
 * Service catalog categories.
 */
export enum ServiceCategory {
  CarWash = 'car_wash',
  Product = 'product',
  AddOn = 'add_on',
}

/**
 * IoT machine operational status.
 */
export enum MachineStatus {
  Idle = 'idle',
  Running = 'running',
  Error = 'error',
}
