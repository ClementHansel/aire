/**
 * DTOs for Membership Plan CRUD operations.
 */

/**
 * A discounted service on a membership plan. Carries EITHER a percentage
 * discount (1–100, stored as entered) OR a fixed member price in Rp — never
 * both. `discountPct` is optional for back-compat with fixed-price entries.
 */
export interface DiscountedServiceDto {
  serviceId: string;
  discountPct?: number;
  fixedPrice?: number;
}

export interface CreateMembershipPlanDto {
  name: string;
  durationMonths: number; // 1, 3, or 12
  maxUses: number; // lifetime quota cap
  dailyLimit?: number; // default 1
  maxPlates?: number; // default 3
  price: number;
  outletIds?: string[] | null; // null = all outlets
  freeServiceIds?: string[];
  discountedServices?: DiscountedServiceDto[];
  whatsappWelcomeEnabled?: boolean;
}

export interface UpdateMembershipPlanDto {
  name?: string;
  durationMonths?: number;
  maxUses?: number;
  dailyLimit?: number;
  maxPlates?: number;
  price?: number;
  outletIds?: string[] | null;
  freeServiceIds?: string[];
  discountedServices?: DiscountedServiceDto[];
  whatsappWelcomeEnabled?: boolean;
}
