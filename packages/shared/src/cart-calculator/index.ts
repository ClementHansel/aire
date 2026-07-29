/**
 * Cart calculation engine for the AIRE Operations Platform.
 *
 * Handles subtotal computation, service charge, tax/PPN, voucher & promo discounts,
 * quantity adjustment, manual discount (capped), and item management.
 *
 * Requirements: 6.7, 6.8
 */

// Re-export membership pricing module
export * from './membership-pricing';

export { calculateUpgradeCredit } from './upgrade-credit';
export type { UpgradeCreditInput, UpgradeCreditResult } from './upgrade-credit';

export interface CartItem {
  serviceId: string;
  serviceName: string;
  quantity: number;
  unitPrice: number; // per unit price
  discount: number; // manual discount amount per item (total, not per-unit)
  isMainService: boolean;
}

export interface CartConfig {
  serviceChargePct: number; // e.g., 0.05 for 5%
  taxPct: number; // e.g., 0.11 for 11% PPN
  maxManualDiscountPct?: number; // cap for manual discount per item (e.g., 0.5 = 50%)
}

export interface CartSummary {
  items: CartItem[];
  subtotal: number; // sum of (qty * unitPrice - discount) for each item
  serviceCharge: number; // subtotal * serviceChargePct
  tax: number; // subtotal * taxPct
  voucherDiscount: number;
  promoDiscount: number;
  total: number; // subtotal + serviceCharge + tax - voucherDiscount - promoDiscount
}

/**
 * Calculates the full cart summary given items, config, and optional discounts.
 *
 * - subtotal = sum of (item.quantity * item.unitPrice - item.discount) for each item
 * - serviceCharge = subtotal * config.serviceChargePct
 * - tax = subtotal * config.taxPct
 * - total = subtotal + serviceCharge + tax - voucherDiscount - promoDiscount
 * - total is floored at 0 (never negative)
 */
export function calculateCartSummary(
  items: CartItem[],
  config: CartConfig,
  voucherDiscount: number = 0,
  promoDiscount: number = 0,
): CartSummary {
  const subtotal = items.reduce((sum, item) => {
    const itemTotal = item.quantity * item.unitPrice - item.discount;
    return sum + Math.max(0, itemTotal);
  }, 0);

  const serviceCharge = subtotal * config.serviceChargePct;
  const tax = subtotal * config.taxPct;

  const rawTotal = subtotal + serviceCharge + tax - voucherDiscount - promoDiscount;
  const total = Math.max(0, rawTotal);

  return {
    items,
    subtotal,
    serviceCharge,
    tax,
    voucherDiscount,
    promoDiscount,
    total,
  };
}

/**
 * Adds an item to the cart. If an item with the same serviceId already exists,
 * increments its quantity by the new item's quantity.
 * Otherwise, appends the new item to the cart.
 */
export function addToCart(items: CartItem[], item: CartItem): CartItem[] {
  const existingIndex = items.findIndex((i) => i.serviceId === item.serviceId);

  if (existingIndex >= 0) {
    return items.map((i, idx) =>
      idx === existingIndex ? { ...i, quantity: i.quantity + item.quantity } : i,
    );
  }

  return [...items, { ...item }];
}

/**
 * Removes an item from the cart by serviceId.
 * Returns a new array without the removed item.
 */
export function removeFromCart(items: CartItem[], serviceId: string): CartItem[] {
  return items.filter((i) => i.serviceId !== serviceId);
}

/**
 * Updates the quantity of an item in the cart by serviceId.
 * If quantity is 0 or less, removes the item from the cart.
 */
export function updateQuantity(
  items: CartItem[],
  serviceId: string,
  quantity: number,
): CartItem[] {
  if (quantity <= 0) {
    return removeFromCart(items, serviceId);
  }

  return items.map((i) => (i.serviceId === serviceId ? { ...i, quantity } : i));
}

/**
 * A sellable item's own manual-discount permission, set per product/service in
 * the dashboard (AIRIN-122/123). Shape mirrors the `dynamic_discount_*` /
 * `max_discount` columns on `services`.
 */
export interface DynamicDiscountRule {
  enabled?: boolean;
  kind?: 'fixed' | 'percentage' | null;
  /** Rupiah when kind='fixed'; percent 0-100 when kind='percentage'. */
  maxDiscount?: number | null;
}

/**
 * Largest manual discount (in Rupiah) allowed on one cart line.
 *
 * Returns 0 when the item has not opted in — a cashier may only discount items
 * the dashboard has explicitly enabled, rather than anything on the menu up to a
 * single tenant-wide percentage (AIRIN-121). Callers must treat 0 as "no
 * discount field at all", not "unlimited".
 *
 * The per-item rule is authoritative and deliberately ignores the outlet's
 * maxManualDiscountPct: the whole point of the flag is a per-item ceiling.
 */
export function maxLineDiscount(
  rule: DynamicDiscountRule | undefined | null,
  unitPrice: number,
  quantity: number,
): number {
  if (!rule?.enabled || rule.maxDiscount == null || rule.maxDiscount <= 0) return 0;
  const lineTotal = Math.max(0, unitPrice) * Math.max(0, quantity);
  if (rule.kind === 'percentage') {
    // Guard against a stored percentage above 100 producing more than the line.
    return Math.min(lineTotal, (Math.min(rule.maxDiscount, 100) / 100) * lineTotal);
  }
  // 'fixed' (and any unexpected kind) is a Rupiah amount, never above the line.
  return Math.min(lineTotal, rule.maxDiscount);
}

/**
 * Applies a manual discount to an item in the cart by serviceId.
 * The discount is capped by maxManualDiscountPct * item.unitPrice * item.quantity.
 * If maxManualDiscountPct is not configured, no cap is applied.
 *
 * Prefer maxLineDiscount() for items carrying their own dynamic-discount rule;
 * this remains for the tenant-wide cap on paths that have no per-item rule.
 */
export function applyManualDiscount(
  items: CartItem[],
  serviceId: string,
  discount: number,
  config: CartConfig,
): CartItem[] {
  return items.map((i) => {
    if (i.serviceId !== serviceId) {
      return i;
    }

    let cappedDiscount = Math.max(0, discount);

    if (config.maxManualDiscountPct !== undefined) {
      const maxDiscount = config.maxManualDiscountPct * i.unitPrice * i.quantity;
      cappedDiscount = Math.min(cappedDiscount, maxDiscount);
    }

    return { ...i, discount: cappedDiscount };
  });
}
