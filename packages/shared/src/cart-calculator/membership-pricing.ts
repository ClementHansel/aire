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
    // services with percentage discount
    serviceId: string;
    discountPct: number; // 0-1, e.g., 0.2 = 20% off
  }>;
}

export interface AppliedMemberPricing {
  serviceId: string;
  originalPrice: number;
  appliedPrice: number;
  membershipId: string;
  discountType: 'free' | 'percentage';
  discountValue: number; // 1.0 for free, or the actual percentage
  badgeLabel: string; // "GRATIS" or "MEMBER -20%"
}

interface BenefitCandidate {
  membershipId: string;
  discountType: 'free' | 'percentage';
  discountPct: number; // 1.0 for free, or actual pct for discounted
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
    const bestBenefit = findBestBenefit(item.serviceId, benefits);

    if (!bestBenefit) {
      return { ...item };
    }

    const originalPrice = item.unitPrice * item.quantity;

    if (bestBenefit.discountType === 'free') {
      // Free service: set discount to cover the full item value
      const discount = item.unitPrice * item.quantity;

      appliedPricing.push({
        serviceId: item.serviceId,
        originalPrice,
        appliedPrice: 0,
        membershipId: bestBenefit.membershipId,
        discountType: 'free',
        discountValue: 1.0,
        badgeLabel: 'GRATIS',
      });

      return { ...item, discount };
    }

    // Percentage discount
    const discountAmount = item.unitPrice * item.quantity * bestBenefit.discountPct;
    const appliedPrice = originalPrice - discountAmount;
    const pctLabel = Math.round(bestBenefit.discountPct * 100);

    appliedPricing.push({
      serviceId: item.serviceId,
      originalPrice,
      appliedPrice,
      membershipId: bestBenefit.membershipId,
      discountType: 'percentage',
      discountValue: bestBenefit.discountPct,
      badgeLabel: `MEMBER -${pctLabel}%`,
    });

    return { ...item, discount: discountAmount };
  });

  return { items: updatedItems, appliedPricing };
}

/**
 * Finds the best (most beneficial) membership benefit for a given service across all plans.
 *
 * Priority:
 * 1. Free service (discountPct = 1.0) always wins
 * 2. Among percentage discounts, the highest percentage wins
 */
function findBestBenefit(
  serviceId: string,
  benefits: MembershipBenefit[],
): BenefitCandidate | null {
  let best: BenefitCandidate | null = null;

  for (const benefit of benefits) {
    // Check if the service is in freeServiceIds
    if (benefit.freeServiceIds.includes(serviceId)) {
      // Free always wins — return immediately
      return {
        membershipId: benefit.membershipId,
        discountType: 'free',
        discountPct: 1.0,
      };
    }

    // Check if the service is in discountedServices
    const discountEntry = benefit.discountedServices.find(
      (ds) => ds.serviceId === serviceId,
    );

    if (discountEntry) {
      if (!best || discountEntry.discountPct > best.discountPct) {
        best = {
          membershipId: benefit.membershipId,
          discountType: 'percentage',
          discountPct: discountEntry.discountPct,
        };
      }
    }
  }

  return best;
}
