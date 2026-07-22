import { CampaignStatus } from '@aire/shared';

/** Row shape for the `campaigns` table. */
export interface CampaignRow {
  id: string;
  tenant_id: string;
  name: string;
  plan_id: string;
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
  planId: string;
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

/** DTO to create a campaign. */
export interface CreateCampaignDto {
  name: string;
  planId: string;
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
  planId?: string;
  bonusTemplateId?: string;
  startDate?: string;
  endDate?: string;
  cap?: number | null;
  perCustomerLimit?: number;
  status?: CampaignStatus;
}
