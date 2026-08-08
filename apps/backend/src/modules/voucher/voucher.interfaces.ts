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
  /**
   * True when the codes are on their way to the buyer's WhatsApp — i.e. the
   * order carries a phone number and the delivery has been handed to
   * VoucherNotifyService. NOT a delivery receipt: the send happens after this
   * call returns. It replaced `whatsappDelivered`, which claimed a receipt it
   * never had — it reported the result of a Meta Business API template send
   * against a vendor this platform has never used, so it was permanently false.
   */
  whatsappQueued: boolean;
}

/** Result of validating a voucher code at the POS. */
export interface ValidateVoucherResult {
  status: string;
  type?: VoucherType;
  discountValue?: number;
  /** Computed discount for the current cart (fixed/percentage). */
  discountAmount?: number;
  /**
   * For a service-type voucher, the service this code covers. `discountAmount` is
   * 0 for those — the amount depends on the covered line's price, which the order
   * pipeline resolves — so without this the POS could not show the effect of the
   * code in its running total, and a cashier applying two free-service vouchers
   * saw the total refuse to move.
   */
  benefitServiceIds?: string[];
  reason?: string;
  message: string;
  /**
   * When this code was redeemed, for a code that is already spent. The cashier's
   * first question about a rejected voucher is "when was it used?", and answering
   * it turns an argument at the counter into a fact (AIRIN-158).
   */
  usedAt?: string;
}
