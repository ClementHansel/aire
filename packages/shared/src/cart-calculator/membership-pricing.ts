/**
 * Membership pricing application logic for the AIRE Operations Platform.
 *
 * Applies free services (price = 0, "GRATIS" badge) for services in a plan's free_services list,
 * discounted services (price * (1 - discountPct)) for services in discounted_services,
 * and handles multiple active plans by applying the most beneficial discount per service.
 *
 * Requirements: 6.6, 12.3, 12.4, 12.5
 */

import { CartItem } from './index';

export interface MembershipBenefit {
  membershipId: string;
  planName: string;
  freeServiceIds: string[]; // services fully covered (price = 0)
  discountedServices: Array<{
    // A discounted service carries EITHER a percentage discount OR a fixed
    // member price (never both). The caller passes discountPct as a 0-1 fraction.
    serviceId: string;
    discountPct?: number; // 0-1, e.g. 0.2 = 20% off
    fixedPrice?: number; // per-unit member price in Rp (overrides the list price)
  }>;
}

export interface AppliedMemberPricing {
  serviceId: string;
  originalPrice: number;
  appliedPrice: number;
  membershipId: string;
  discountType: 'free' | 'percentage' | 'fixed';
  discountValue: number; // 1.0 for free, the fraction for percentage, or the fixed unit price
  badgeLabel: string; // "GRATIS", "MEMBER -20%", or "HARGA MEMBER"
}

/** A candidate member price for one cart item, resolved against its actual price. */
interface PricingCandidate {
  membershipId: string;
  discountType: 'free' | 'percentage' | 'fixed';
  appliedPrice: number; // total (unit × qty) the member would pay
  discountValue: number;
}

/**
 * Applies membership pricing to cart items based on the provided benefits (from one or more plans).
 *
 * For each cart item:
 * - If a service is in `freeServiceIds` of ANY plan → price = 0, badge "GRATIS"
 * - If a service is in `discountedServices` of ANY plan → apply best (highest) discount
 * - When multiple plans cover the same service, the most beneficial one is applied
 *
 * Returns modified items with discount applied and metadata about applied pricing.
 */
export function applyMembershipPricing(
  items: CartItem[],
  benefits: MembershipBenefit[],
): { items: CartItem[]; appliedPricing: AppliedMemberPricing[] } {
  if (benefits.length === 0) {
    return { items: [...items], appliedPricing: [] };
  }

  const appliedPricing: AppliedMemberPricing[] = [];

  const updatedItems = items.map((item) => {
    const originalPrice = item.unitPrice * item.quantity;
    const best = findBestPricing(item.serviceId, originalPrice, item.quantity, benefits);

    if (!best) {
      return { ...item };
    }

    const badgeLabel =
      best.discountType === 'free'
        ? 'GRATIS'
        : best.discountType === 'fixed'
          ? 'HARGA MEMBER'
          : `MEMBER -${Math.round(best.discountValue * 100)}%`;

    appliedPricing.push({
      serviceId: item.serviceId,
      originalPrice,
      appliedPrice: best.appliedPrice,
      membershipId: best.membershipId,
      discountType: best.discountType,
      discountValue: best.discountValue,
      badgeLabel,
    });

    return { ...item, discount: originalPrice - best.appliedPrice };
  });

  return { items: updatedItems, appliedPricing };
}

/**
 * Resolves the most beneficial member price for one service across all plans.
 *
 * Priority:
 * 1. A free service (in any plan's freeServiceIds) always wins → price 0.
 * 2. Otherwise every percentage and fixed-price benefit is turned into a
 *    concrete applied price for THIS item, and the lowest one wins — but only
 *    if it actually beats the list price (a fixed price above list is ignored).
 */
function findBestPricing(
  serviceId: string,
  originalPrice: number,
  quantity: number,
  benefits: MembershipBenefit[],
): PricingCandidate | null {
  let freeMembership: string | null = null;
  let bestPct: { membershipId: string; pct: number } | null = null;
  let bestFixed: { membershipId: string; fixedPrice: number } | null = null;

  for (const benefit of benefits) {
    if (benefit.freeServiceIds.includes(serviceId)) {
      freeMembership = benefit.membershipId;
      continue;
    }
    const entry = benefit.discountedServices.find((ds) => ds.serviceId === serviceId);
    if (!entry) continue;

    if (typeof entry.discountPct === 'number' && entry.discountPct > 0) {
      // Highest percentage wins among percentage benefits.
      if (!bestPct || entry.discountPct > bestPct.pct) {
        bestPct = { membershipId: benefit.membershipId, pct: entry.discountPct };
      }
    } else if (typeof entry.fixedPrice === 'number' && entry.fixedPrice >= 0) {
      // Lowest fixed price wins among fixed-price benefits.
      if (!bestFixed || entry.fixedPrice < bestFixed.fixedPrice) {
        bestFixed = { membershipId: benefit.membershipId, fixedPrice: entry.fixedPrice };
      }
    }
  }

  // Free always wins — nothing beats a price of 0.
  if (freeMembership) {
    return { membershipId: freeMembership, discountType: 'free', appliedPrice: 0, discountValue: 1.0 };
  }

  const candidates: PricingCandidate[] = [];
  if (bestPct) {
    // A percentage always applies (it can only lower or keep the price).
    candidates.push({
      membershipId: bestPct.membershipId,
      discountType: 'percentage',
      appliedPrice: originalPrice * (1 - bestPct.pct),
      discountValue: bestPct.pct,
    });
  }
  if (bestFixed && bestFixed.fixedPrice * quantity < originalPrice) {
    // A fixed price applies only when it genuinely undercuts the list price —
    // a "discount" must never raise what the member pays.
    candidates.push({
      membershipId: bestFixed.membershipId,
      discountType: 'fixed',
      appliedPrice: bestFixed.fixedPrice * quantity,
      discountValue: bestFixed.fixedPrice,
    });
  }
  if (candidates.length === 0) return null;
  // Cheapest applied price wins when a member has both kinds across plans.
  return candidates.reduce((a, b) => (b.appliedPrice < a.appliedPrice ? b : a));
}
