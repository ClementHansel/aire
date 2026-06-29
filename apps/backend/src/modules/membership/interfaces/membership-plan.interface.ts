import { DiscountedServiceDto } from '../dto';

/**
 * Represents a membership plan row from the database.
 */
export interface MembershipPlan {
  id: string;
  tenantId: string;
  name: string;
  durationMonths: number;
  maxUses: number;
  dailyLimit: number;
  maxPlates: number;
  price: number;
  outletIds: string[] | null;
  freeServiceIds: string[] | null;
  discountedServices: DiscountedServiceDto[];
  whatsappWelcomeEnabled: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Raw row from the membership_plans table.
 */
export interface MembershipPlanRow {
  id: string;
  tenant_id: string;
  name: string;
  duration_months: number;
  max_uses: number;
  daily_limit: number;
  max_plates: number;
  price: string; // DECIMAL comes as string from pg
  outlet_ids: string[] | null;
  free_service_ids: string[] | null;
  discounted_services: DiscountedServiceDto[];
  whatsapp_welcome_enabled: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
