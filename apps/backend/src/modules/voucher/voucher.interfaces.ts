import { VoucherType } from '@aire/shared';

/** Row shape for voucher_templates. */
export interface VoucherTemplateRow {
  id: string;
  tenant_id: string;
  name: string;
  type: VoucherType;
  value: string;
  max_uses: number;
  start_date: string | null;
  expiry_date: string | null;
  outlet_ids: string[] | null;
  brand_scope: string[] | null;
  service_ids: string[] | null;
  min_order_amount: string;
  sale_price: string;
  validity_days: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Public template (catalog) entity. */
export interface VoucherTemplate {
  id: string;
  name: string;
  type: VoucherType;
  value: number;
  maxUses: number;
  salePrice: number;
  validityDays: number | null;
  serviceIds: string[] | null;
  outletIds: string[] | null;
  brandScope: string[] | null;
  minOrderAmount: number;
  startDate: string | null;
  expiryDate: string | null;
  isActive: boolean;
}

/** DTO to create a voucher template (dashboard). */
export interface CreateVoucherTemplateDto {
  name: string;
  type: VoucherType;
  value: number;
  maxUses: number;
  salePrice: number;
  validityDays?: number | null;
  serviceIds?: string[] | null;
  outletIds?: string[] | null;
  brandScope?: string[] | null;
  minOrderAmount?: number;
  startDate?: string | null;
  expiryDate?: string | null;
}

/** Result of selling (reserving) a voucher pack — before payment. */
export interface SellVoucherPackResult {
  order: { id: string; orderNumber: string; total: number };
  templateId: string;
  templateName: string;
  packSize: number;
  customerId: string;
}

/**
 * Result of issuing a voucher pack — after payment.
 *
 * Since AIRIN-145 a pack is issued as a voucher BOOK of plaintext tickets, so
 * the codes remain readable in the dashboard forever rather than being shown
 * once and then surviving only as hashes. `parentCode` is therefore optional:
 * the retired hashed-pack model had a parent code wrapping its children, books
 * have no such wrapper.
 */
export interface IssueVoucherPackResult {
  /** voucher_books.id (was voucher_packs.id before the convergence). */
  packId: string;
  parentCode?: string | null;
  childCodes: string[];
  expiryDate: string | null;
  whatsappDelivered: boolean;
}

/** Result of validating a voucher code at the POS. */
export interface ValidateVoucherResult {
  status: string;
  type?: VoucherType;
  discountValue?: number;
  /** Computed discount for the current cart (fixed/percentage). */
  discountAmount?: number;
  reason?: string;
  message: string;
}
