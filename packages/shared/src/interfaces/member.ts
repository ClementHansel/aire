import { MembershipStatus } from '../enums';

/**
 * Plate information associated with a customer or membership.
 */
export interface PlateInfo {
  plate: string;
  brand?: string;
  model?: string;
}

/**
 * Voucher information returned in member lookup.
 */
export interface VoucherInfo {
  id: string;
  code: string;
  type: 'fixed' | 'percentage' | 'service_pack';
  value: number;
  expiresAt: string;
  isUsed: boolean;
}

/**
 * Service discount detail within a membership.
 */
export interface DiscountedServiceInfo {
  serviceId: string;
  discountPct: number;
}

/**
 * Membership detail within a member lookup response.
 */
export interface MembershipDetail {
  id: string;
  planName: string;
  status: MembershipStatus;
  startDate: string;
  endDate: string;
  usesCount: number;
  maxUses: number;
  dailyLimit: number;
  plates: PlateInfo[];
  freeServices: string[];
  discountedServices: DiscountedServiceInfo[];
  /** Map of plate → uses today */
  dailyUsageToday: Record<string, number>;
  /** Max registered plates allowed by the plan (default 3). Optional so older
   *  callers/fixtures that predate this field keep type-checking. */
  maxPlates?: number;
}

/**
 * Member lookup response.
 * GET /api/members/lookup?phone=&plate=
 */
export interface MemberLookupResponse {
  customer: {
    id: string;
    name: string;
    phone: string;
    /** 12-char membership number (present once the member has been issued one). */
    membershipNumber?: string;
    plates: PlateInfo[];
  };
  memberships: MembershipDetail[];
  vouchers?: VoucherInfo[];
}

/**
 * Sell membership request body.
 * POST /api/memberships/sell
 */
export interface SellMembershipRequest {
  planId: string;
  customerId: string;
  orderId: string;
  plates: PlateInfo[];
}

/**
 * Update membership plates request.
 * PUT /api/memberships/:id/plates
 */
export interface UpdateMembershipPlatesRequest {
  plates: PlateInfo[];
}
