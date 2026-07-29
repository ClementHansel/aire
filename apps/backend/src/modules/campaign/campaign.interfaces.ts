import { CampaignStatus } from '@aire/shared';

/**
 * What purchase fires a campaign (AIRIN-102): a membership plan purchase
 * (original behavior, plan_id) or a voucher-pack/template purchase
 * (trigger_template_id — e.g. "buy the 10x wash pack -> get 3x spray wax
 * free"). Exactly one of plan_id/trigger_template_id is set, matching the
 * DB CHECK constraint added in migration 086.
 */
export type CampaignTriggerType = 'membership_plan' | 'voucher_pack';

/** Row shape for the `campaigns` table. */
export interface CampaignRow {
  id: string;
  tenant_id: string;
  name: string;
  plan_id: string | null;
  trigger_type: CampaignTriggerType;
  trigger_template_id: string | null;
  bonus_template_id: string;
  start_date: string;
  end_date: string;
  cap: number | null;
  per_customer_limit: number;
  grants_count: number;
  status: CampaignStatus;
  created_at: Date;
  updated_at: Date;
}

/** Public campaign entity (dashboard / API shape). */
export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  planId: string | null;
  triggerType: CampaignTriggerType;
  triggerTemplateId: string | null;
  bonusTemplateId: string;
  startDate: string;
  endDate: string;
  cap: number | null;
  perCustomerLimit: number;
  grantsCount: number;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** DTO to create a campaign. triggerType defaults to 'membership_plan' (backward compatible). */
export interface CreateCampaignDto {
  name: string;
  triggerType?: CampaignTriggerType;
  planId?: string | null;
  triggerTemplateId?: string | null;
  bonusTemplateId: string;
  startDate: string;
  endDate: string;
  cap?: number | null;
  perCustomerLimit?: number;
  status?: CampaignStatus;
}

/** DTO to update a campaign. All fields optional. */
export interface UpdateCampaignDto {
  name?: string;
  triggerType?: CampaignTriggerType;
  planId?: string | null;
  triggerTemplateId?: string | null;
  bonusTemplateId?: string;
  startDate?: string;
  endDate?: string;
  cap?: number | null;
  perCustomerLimit?: number;
  status?: CampaignStatus;
}
