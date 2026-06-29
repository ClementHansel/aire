/**
 * DTOs for Membership Plan CRUD operations.
 */

export interface DiscountedServiceDto {
  serviceId: string;
  discountPct: number;
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
