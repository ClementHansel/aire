import { Role, OrderStatus, PaymentMethod, BayStatus, MembershipStatus, VoucherType } from './enums';

// ─── Validation Constants ─────────────────────────────────────────────────────

/** Minimum phone number length after normalization (digits only) */
export const MIN_PHONE_LENGTH = 8;

/** Maximum phone number length after normalization */
export const MAX_PHONE_LENGTH = 15;

/** Minimum customer name length */
export const MIN_NAME_LENGTH = 1;

/** Maximum customer name length */
export const MAX_NAME_LENGTH = 100;

/** Maximum note length on an order */
export const MAX_NOTE_LENGTH = 500;

/** Maximum items allowed in a single order */
export const MAX_ORDER_ITEMS = 50;

/** Maximum voucher codes per order */
export const MAX_VOUCHER_CODES_PER_ORDER = 5;

/** Maximum plates per membership */
export const MAX_PLATES_PER_MEMBERSHIP = 5;

/** Minimum PIN length for admin void approval */
export const ADMIN_PIN_LENGTH = 6;

/** JWT access token expiry in seconds (15 minutes) */
export const ACCESS_TOKEN_EXPIRY_SECONDS = 900;

/** JWT refresh token expiry in seconds (7 days) */
export const REFRESH_TOKEN_EXPIRY_SECONDS = 604_800;

// ─── Valid Values ─────────────────────────────────────────────────────────────

/** All valid roles */
export const VALID_ROLES: readonly Role[] = Object.values(Role);

/** All valid order statuses */
export const VALID_ORDER_STATUSES: readonly OrderStatus[] = Object.values(OrderStatus);

/** All valid payment methods */
export const VALID_PAYMENT_METHODS: readonly PaymentMethod[] = Object.values(PaymentMethod);

/** All valid bay statuses */
export const VALID_BAY_STATUSES: readonly BayStatus[] = Object.values(BayStatus);

/** All valid membership statuses */
export const VALID_MEMBERSHIP_STATUSES: readonly MembershipStatus[] = Object.values(MembershipStatus);

/** All valid voucher types */
export const VALID_VOUCHER_TYPES: readonly VoucherType[] = Object.values(VoucherType);

// ─── Role Hierarchy ───────────────────────────────────────────────────────────

/**
 * Role privilege level. Higher number = more privileges.
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.PlatformSuperAdmin]: 4,
  [Role.TenantOwner]: 3,
  [Role.OutletAdmin]: 2,
  [Role.Cashier]: 1,
};

/**
 * Roles that require an outlet_id assignment.
 */
export const OUTLET_SCOPED_ROLES: readonly Role[] = [Role.OutletAdmin, Role.Cashier];

/**
 * Roles that have tenant-wide access (no specific outlet).
 */
export const TENANT_WIDE_ROLES: readonly Role[] = [Role.PlatformSuperAdmin, Role.TenantOwner];

// ─── Order State Transitions ──────────────────────────────────────────────────

/**
 * Valid order status transitions map.
 * Key is the current status, value is an array of statuses it can transition to.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.Ordered]: [OrderStatus.Paid, OrderStatus.Cancelled],
  [OrderStatus.Paid]: [OrderStatus.Confirmed, OrderStatus.Cancelled],
  [OrderStatus.Confirmed]: [OrderStatus.Completed],
  [OrderStatus.Completed]: [],
  [OrderStatus.Cancelled]: [],
};

// ─── Pagination Defaults ──────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE = 1;
