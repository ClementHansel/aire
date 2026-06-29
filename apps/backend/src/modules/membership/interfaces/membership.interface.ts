/**
 * Interfaces for Membership entities (subscriptions, not plans).
 */

import { MembershipStatus } from '@aire/shared';

/**
 * Domain entity for a membership subscription.
 */
export interface Membership {
  id: string;
  tenantId: string;
  customerId: string;
  planId: string;
  status: MembershipStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  usesCount: number;
  maxUses: number;
  dailyLimit: number;
  orderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Raw row from the memberships table.
 */
export interface MembershipRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  plan_id: string;
  status: string;
  start_date: string;
  end_date: string;
  uses_count: number;
  max_uses: number;
  daily_limit: number;
  order_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Domain entity for a membership plate registration.
 */
export interface MembershipPlate {
  id: string;
  membershipId: string;
  plate: string;
  plateNormalized: string;
  brand: string | null;
  model: string | null;
  createdAt: Date;
}

/**
 * Raw row from the membership_plates table.
 */
export interface MembershipPlateRow {
  id: string;
  membership_id: string;
  plate: string;
  plate_normalized: string;
  brand: string | null;
  model: string | null;
  created_at: Date;
}
